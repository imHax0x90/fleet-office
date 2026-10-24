/* Fleet Office — ÉVALUATION des agents (l'« Arène »).
   Pour un agent : métriques calculées sur son transcript (outils, erreurs, tests, durée, coût, skills utilisées),
   score heuristique, puis revue rédigée par un LLM (ce qui a marché / raté / quoi améliorer), et chat de suivi.
   Boucle de rétroaction : la note nourrit le classement des skills réellement utilisées (vote auto) et l'XP du métier.
   Stockage : ~/.fleet/reviews.json (écriture atomique, 300 revues max). */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const TEST_RE = /\b(pytest|jest|vitest|mocha|go test|cargo test|npm (run )?test|pnpm (run )?test|yarn test|phpunit|rspec|unittest|ctest|playwright test)\b/i;
const OK_RE = /\b(\d+ passed|all tests? passed|tests? passed|PASS(ED)?\b|0 failed|ok\b.*\b\d+ tests?)/i;
const KO_RE = /\b(\d+ failed|FAIL(ED)?\b|AssertionError|Traceback|npm ERR|Error:|panic:|exit code [1-9])/i;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const clip = (s, n) => { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

function metricsOf(feed, info) {
  const m = { prompts: 0, says: 0, toolCalls: 0, errors: 0, retries: 0, tests: 0, testsPassed: 0, testsFailed: 0, filesTouched: 0, skillsUsed: [], bash: 0, durationMin: null, costUsd: info && info.costUsd != null ? +(+info.costUsd).toFixed(3) : null };
  const files = new Set(), skills = {}; let prevTool = "", t0 = null, t1 = null, lastWasTest = false;
  for (const e of feed) {
    const ts = e.at ? Date.parse(e.at) : NaN; if (!isNaN(ts)) { if (t0 == null || ts < t0) t0 = ts; if (t1 == null || ts > t1) t1 = ts; }
    if (e.kind === "prompt") m.prompts++;
    else if (e.kind === "say") m.says++;
    else if (e.kind === "tool") {
      m.toolCalls++; const key = (e.name || "") + "|" + (e.arg || e.text);
      if (key === prevTool) m.retries++; prevTool = key;
      if (e.name === "Bash") { m.bash++; lastWasTest = TEST_RE.test(e.arg || e.text); if (lastWasTest) m.tests++; } else lastWasTest = false;
      if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(e.name || "") && e.arg) files.add(e.arg);
      if (e.name === "Skill" && e.arg) skills[e.arg] = (skills[e.arg] || 0) + 1;
    } else if (e.kind === "result") {
      if (e.err) m.errors++;
      if (lastWasTest) { if (KO_RE.test(e.text) && !OK_RE.test(e.text)) m.testsFailed++; else if (OK_RE.test(e.text)) m.testsPassed++; lastWasTest = false; }
    }
  }
  m.filesTouched = files.size; m.skillsUsed = Object.entries(skills).map(([name, n]) => ({ name, n }));
  if (t0 != null && t1 != null) m.durationMin = +((t1 - t0) / 60000).toFixed(1);
  m.errorRate = m.toolCalls ? +(m.errors / m.toolCalls).toFixed(3) : 0;
  return m;
}
// note de base, déterministe (sert de repli et de garde-fou si le LLM est indisponible)
function heuristic(m, info) {
  let s = 72;
  s -= clamp(m.errorRate * 60, 0, 28);
  s -= clamp(m.retries * 1.5, 0, 12);
  if (m.tests) s += clamp((m.testsPassed - m.testsFailed * 2) * 4, -12, 10);
  if (info && info.status === "failed") s -= 20;
  if (info && info.status === "blocked") s -= 6;
  if (!m.toolCalls && !m.says) s = 40;
  if (m.filesTouched) s += 3;
  return Math.round(clamp(s, 5, 98));
}
function digestOf(feed) {
  const mission = feed.find((e) => e.kind === "prompt"), tools = feed.filter((e) => e.kind === "tool").slice(-28);
  const says = feed.filter((e) => e.kind === "say").slice(-6);
  const errs = []; for (let i = 0; i < feed.length && errs.length < 6; i++) if (feed[i].kind === "result" && feed[i].err) errs.push(clip(feed[i].text.replace(/\s+/g, " "), 220));
  return [
    "MISSION (premier message) :\n" + clip(mission ? mission.text : "(inconnue)", 1500),
    "DERNIERS APPELS D'OUTILS :\n" + (tools.map((e) => "- " + clip(e.text.split("\n")[0], 150)).join("\n") || "(aucun)"),
    errs.length ? "ERREURS D'OUTILS :\n" + errs.map((e) => "- " + e).join("\n") : "ERREURS D'OUTILS : aucune",
    "DERNIERS MESSAGES DE L'AGENT :\n" + (says.map((e) => "> " + clip(e.text.replace(/\s+/g, " "), 520)).join("\n") || "(aucun)"),
  ].join("\n\n");
}
const jparse = (raw) => { try { const m = String(raw).match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null; } catch { return null; } };
const arr = (x, n, len) => (Array.isArray(x) ? x : []).map((v) => clip(typeof v === "string" ? v : (v && v.text) || "", len || 260)).filter(Boolean).slice(0, n);

function createReviews({ dir, collect, agentInfo, llm, skills }) {
  const FILE = path.join(dir, "reviews.json");
  let db = { reviews: [], applied: {} };
  try { const j = JSON.parse(fs.readFileSync(FILE, "utf8")); if (j && Array.isArray(j.reviews)) db = { reviews: j.reviews, applied: j.applied || {} }; } catch { /* première fois */ }
  let t = null; const saveNow = () => { try { fs.mkdirSync(dir, { recursive: true }); const tmp = FILE + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(db)); fs.renameSync(tmp, FILE); } catch (e) { console.error("[reviews] save:", e.message); } };
  const save = () => { clearTimeout(t); t = setTimeout(saveNow, 400); if (t.unref) t.unref(); };
  const light = (r) => ({ id: r.id, agentId: r.agentId, name: r.name, role: r.role, project: r.project, host: r.host, at: r.at, score: r.score, heuristic: r.heuristic, verdict: r.verdict, metrics: r.metrics, llm: r.llm });

  function list(opts) {
    opts = opts || {}; let L = db.reviews.slice().sort((a, b) => b.at - a.at);
    if (opts.agent) L = L.filter((r) => r.agentId === opts.agent);
    const byRole = {}; for (const r of db.reviews) { const k = r.role || "—"; (byRole[k] = byRole[k] || []).push(r.score); }
    return { reviews: L.slice(0, opts.limit || 100).map(light), byRole: Object.entries(byRole).map(([role, a]) => ({ role, n: a.length, avg: Math.round(a.reduce((x, y) => x + y, 0) / a.length) })).sort((a, b) => b.avg - a.avg), total: db.reviews.length };
  }
  const get = (id) => { const r = db.reviews.find((x) => x.id === id); if (!r) throw new Error("revue introuvable"); return r; };

  async function run(agentId) {
    const info = agentInfo(agentId); if (!info) throw new Error("agent introuvable");
    const feed = collect(agentId); if (!feed.length) throw new Error("aucune activité à évaluer pour cet agent");
    const metrics = metricsOf(feed, info), base = heuristic(metrics, info), digest = digestOf(feed);
    const prompt = `Tu es le PROFESSEUR D'ÉVALUATION d'une flotte d'agents IA (« l'Arène »). Tu évalues le travail d'un agent à partir de ses métriques et de sa trace. Sois juste, concret et exigeant : ne flatte pas, ne descends pas sans raison.\n\nAGENT : ${info.name} — métier « ${info.role || "?"} » — projet ${info.project || "?"} — machine ${info.host || "local"} — état ${info.status}\nMÉTRIQUES : ${JSON.stringify({ appels_outils: metrics.toolCalls, erreurs: metrics.errors, taux_erreur: metrics.errorRate, retries_identiques: metrics.retries, tests_lancés: metrics.tests, tests_ok: metrics.testsPassed, tests_ko: metrics.testsFailed, fichiers_modifiés: metrics.filesTouched, durée_min: metrics.durationMin, coût_usd: metrics.costUsd, skills_utilisées: metrics.skillsUsed })}\nNOTE HEURISTIQUE (indicative) : ${base}/100\n\n${digest}\n\nRéponds UNIQUEMENT par un objet JSON :\n{"score":<0-100>,"verdict":"une phrase de bilan","worked":["ce qui a bien marché (concret)"],"failed":["ce qui a raté ou été inefficace (concret)"],"suggestions":[{"kind":"skill|prompt|process|model","text":"action précise pour faire mieux la prochaine fois","query":"mots-clés anglais pour chercher une skill (uniquement si kind=skill)"}]}\nRègles : 2 à 5 éléments par liste, en français, tutoiement interdit (tu parles de l'agent à la 3e personne), score cohérent avec les faits (erreurs, tests, résultat final).`;
    let j = null, raw = null, llmOk = false;
    try { raw = await llm(prompt); j = jparse(raw); llmOk = !!(j && typeof j.score === "number"); } catch (e) { raw = null; }
    const score = llmOk ? Math.round(clamp(+j.score, 0, 100)) : base;
    const rev = {
      id: crypto.randomUUID().slice(0, 10), agentId, name: info.name, role: info.role || "", project: info.project || "", host: info.host || "local", at: Date.now(),
      metrics, heuristic: base, score, llm: llmOk, verdict: llmOk ? clip(j.verdict, 240) : (base >= 70 ? "Travail globalement propre d'après les métriques (revue détaillée indisponible)." : "Plusieurs signaux d'alerte dans les métriques (revue détaillée indisponible)."),
      worked: llmOk ? arr(j.worked, 5) : [], failed: llmOk ? arr(j.failed, 5) : [],
      suggestions: llmOk ? (Array.isArray(j.suggestions) ? j.suggestions : []).slice(0, 5).map((s) => ({ kind: ["skill", "prompt", "process", "model"].includes(s && s.kind) ? s.kind : "process", text: clip(s && s.text, 260), query: s && s.kind === "skill" ? clip(s.query, 60) : "" })).filter((s) => s.text) : [],
      digest, chat: [], applied: { xp: 0, votes: [] },
    };
    // boucle de rétroaction : skills réellement utilisées -> vote auto ; XP du métier proportionnelle à la note
    try {
      if (skills) {
        for (const u of metrics.skillsUsed) { const k = agentId + "|" + u.name; if (db.applied[k]) continue; if (score >= 70 && skills.autoVote(u.name, "up")) { db.applied[k] = 1; rev.applied.votes.push({ skill: u.name, vote: "up" }); } else if (score <= 40 && skills.autoVote(u.name, "down")) { db.applied[k] = 1; rev.applied.votes.push({ skill: u.name, vote: "down" }); } }
        rev.applied.xp = skills.awardXp(info.role, score / 10);
      }
    } catch { /* jamais bloquant */ }
    db.reviews = db.reviews.filter((r) => !(r.agentId === agentId && r.at > Date.now() - 60000)); // évite les doublons en rafale
    db.reviews.push(rev); if (db.reviews.length > 300) db.reviews.splice(0, db.reviews.length - 300); save();
    return rev;
  }

  async function chat(id, message) {
    const r = get(id), msg = String(message || "").trim().slice(0, 1500); if (!msg) throw new Error("message vide");
    const hist = r.chat.slice(-8).map((h) => `${h.role === "user" ? "Humain" : "Professeur"} : ${clip(h.text, 500)}`).join("\n");
    const prompt = `Tu es le PROFESSEUR D'ÉVALUATION d'une flotte d'agents IA. Tu discutes avec l'humain d'une revue que tu as rédigée. Réponds en français, tutoiement, de façon concrète et brève (max 8 lignes). Appuie-toi sur les faits ci-dessous ; si l'humain conteste, réexamine honnêtement et dis ce qui te ferait changer d'avis. Si une skill ou un changement de prompt aiderait, propose-le.\n\nREVUE : agent « ${r.name} » (métier « ${r.role} », projet ${r.project}) — note ${r.score}/100 — ${r.verdict}\nA marché : ${r.worked.join(" | ") || "—"}\nA raté : ${r.failed.join(" | ") || "—"}\nSuggestions : ${r.suggestions.map((s) => s.text).join(" | ") || "—"}\nMétriques : ${JSON.stringify(r.metrics)}\n\n${r.digest}\n\n${hist ? "Conversation :\n" + hist + "\n\n" : ""}Humain : ${msg}\n\nRéponds UNIQUEMENT par un objet JSON : {"reply":"ta réponse","skillQueries":["mots-clés anglais si tu recommandes de chercher des skills, sinon []"]}`;
    let reply = null, sq = [];
    try { const raw = await llm(prompt), j = jparse(raw); if (j && typeof j.reply === "string") { reply = j.reply; sq = arr(j.skillQueries, 3, 60); } else reply = clip(String(raw), 1200); } catch (e) { reply = "Le professeur est indisponible pour le moment (" + clip(e.message || e, 120) + ")."; }
    r.chat.push({ role: "user", text: msg, at: Date.now() }, { role: "bot", text: reply, skillQueries: sq, at: Date.now() }); save();
    return { reply, skillQueries: sq };
  }
  return { list, get, run, chat, flush: saveNow };
}

module.exports = { createReviews, metricsOf, heuristic };
