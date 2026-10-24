/* Fleet Office — métiers, skills classées, bibliothèque partagée et conseiller.
   • Bibliothèque : ~/.fleet-office-skills/** (existante), vue enrichie d'un SCORE et d'un RANG (S→E) :
       prior (réputation de la source + qualité du texte) + usage réel (appels de l'outil Skill par les agents)
       + retours humains/agents (👍/👎).
   • Métiers : nom + description + skills attachées. Un agent créé avec ce métier HÉRITE de ses skills
       (installées sur SON nœud dans ~/.claude/skills, listées dans son prompt).
   • Partage : tous les agents reçoivent la méta-skill « fleet-skillhub » qui leur apprend à chercher / lire / noter
       n'importe quelle skill de la bibliothèque via l'API de l'orchestrateur.
   • Conseiller : retrieval local + appel LLM (claude -p sur un nœud) pour proposer des skills au fil d'une conversation.
   État persistant : ~/.fleet/skillsys.json (écriture atomique). */
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const cp = require("child_process");

const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "x";
const jkey = (s) => String(s || "").trim().toLowerCase();
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const STOP = new Set("le la les un une des de du et ou en pour par sur avec dans qui que quoi dont est sont être a au aux ce ces cet son sa ses the a an and or of to in for on with is are be that this it as at by from vos votre ton ta tes mon ma mes nous vous ils elles pas plus très tout tous toute toutes comme mais si se sa".split(" "));
const tokens = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9+#.]+/).filter((w) => w.length > 2 && !STOP.has(w));

const REPO_REP = { "anthropics/skills": 0.95, "wshobson/agents": 0.75 };
const TIERS = [["S", 0.78], ["A", 0.64], ["B", 0.5], ["C", 0.36], ["D", 0.22], ["E", 0]];
const tierOf = (score) => (TIERS.find(([, min]) => score >= min) || TIERS[TIERS.length - 1])[0];
const levelOf = (xp) => 1 + Math.floor(Math.sqrt(Math.max(0, xp) / 8));

function createSkillSys({ SKILLS_DIR, dir, listLibrary, addRole, fetchOnline, advisorHosts, sshOpts, publicUrl, onChange }) {
  const FILE = path.join(dir, "skillsys.json");
  let db = { stats: {}, jobs: {}, hub: {} };
  try { const j = JSON.parse(fs.readFileSync(FILE, "utf8")); if (j && typeof j === "object") db = { stats: j.stats || {}, jobs: j.jobs || {}, hub: j.hub || {} }; } catch { /* premier lancement */ }
  let saveT = null;
  const saveNow = () => { try { fs.mkdirSync(dir, { recursive: true }); const tmp = FILE + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(db, null, 1)); fs.renameSync(tmp, FILE); } catch (e) { console.error("[skillsys] save:", e.message); } };
  const save = () => { clearTimeout(saveT); saveT = setTimeout(saveNow, 400); if (saveT.unref) saveT.unref(); };
  const ZERO = Object.freeze({ uses: 0, loads: 0, up: 0, down: 0, lastUsed: 0 });
  const peek = (id) => db.stats[id] || ZERO;                                            // lecture : ne crée rien
  const st = (id) => (db.stats[id] = db.stats[id] || { uses: 0, loads: 0, up: 0, down: 0, lastUsed: 0 }); // écriture

  // ---- bibliothèque enrichie (cache 45 s) ----------------------------------------------------------------
  let cache = { at: 0, list: [], byId: new Map(), names: new Map(), alias: new Map() };
  function headerOf(rel) {
    try {
      const fd = fs.openSync(path.join(SKILLS_DIR, rel), "r"), b = Buffer.alloc(420); const n = fs.readSync(fd, b, 0, 420, 0); fs.closeSync(fd);
      const m = b.slice(0, n).toString("utf8").match(/source:\s*https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\//i); return m ? m[1] : null;
    } catch { return null; }
  }
  function scoreOf(sk) {
    const s = peek(sk.id);
    const rep = REPO_REP[sk.repo] != null ? REPO_REP[sk.repo] : (sk.repo ? 0.55 : 0.5);
    const quality = (sk.desc && sk.desc.length >= 40 ? 0.5 : sk.desc ? 0.25 : 0) + (sk.size >= 700 && sk.size <= 40000 ? 0.5 : sk.size > 40000 ? 0.25 : 0.1);
    const prior = rep * 0.7 + quality * 0.3;
    const usage = clamp01(Math.log10(1 + s.uses + 0.25 * s.loads) / 2);                 // ~100 usages = 1.0
    const fb = s.up + s.down ? (s.up + 1) / (s.up + s.down + 2) : 0.5;                   // lissage de Laplace
    const confidence = clamp01((s.up + s.down) / 6);                                     // un seul vote ne fait pas un rang
    const recent = s.lastUsed ? clamp01(1 - (Date.now() - s.lastUsed) / (90 * 86400000)) : 0;
    return clamp01(prior * 0.5 + usage * 0.3 + (fb * confidence + 0.5 * (1 - confidence)) * 0.15 + recent * 0.05);
  }
  function refresh(force) {
    if (!force && Date.now() - cache.at < 45000) return cache;
    const lb = listLibrary(), all = [];
    for (const c of lb.categories || []) for (const s of c.skills) all.push({ id: s.path, name: s.name, category: c.category, desc: s.desc || "", size: s.size || 0, repo: headerOf(s.path) });
    // fusion des doublons (même nom + même description : fichier à plat vs dossier, ou deux catégories) :
    // une seule entrée canonique par skill, les autres deviennent des alias (leurs votes/usages vont au canonique)
    const groups = new Map();
    for (const r of all) { const g = slug(r.name) + "|" + r.desc.slice(0, 80).toLowerCase(); (groups.get(g) || groups.set(g, []).get(g)).push(r); }
    const list = [], byId = new Map(), names = new Map(), alias = new Map();
    for (const g of groups.values()) {
      g.sort((a, b) => (/\/SKILL\.md$/i.test(b.id) - /\/SKILL\.md$/i.test(a.id)) || ((b.repo ? 1 : 0) - (a.repo ? 1 : 0)) || (b.size - a.size) || a.id.localeCompare(b.id));
      const rec = g[0]; rec.aliases = g.slice(1).map((x) => x.id);
      for (const a of g) { alias.set(a.id, rec.id); names.set(`fleet-${slug(a.category)}-${slug(a.name)}`, rec.id); }
      rec.score = +scoreOf(rec).toFixed(3); rec.tier = tierOf(rec.score); rec.stats = { ...peek(rec.id) };
      list.push(rec); byId.set(rec.id, rec);
    }
    for (const j of Object.values(db.jobs)) for (const id0 of j.skills || []) { const id = alias.get(id0) || id0, r = byId.get(id); if (r) names.set(installName(j.name, r.name), id); }
    cache = { at: Date.now(), list, byId, names, alias };
    return cache;
  }
  const installName = (job, skill) => `fleet-job-${slug(job)}-${slug(skill)}`;
  const lib = () => refresh(false);
  const canon = (id) => (lib().alias.get(id) || id);
  const view = (r) => ({ id: r.id, name: r.name, category: r.category, desc: r.desc, repo: r.repo, score: r.score, tier: r.tier, uses: r.stats.uses, loads: r.stats.loads, up: r.stats.up, down: r.stats.down, lastUsed: r.stats.lastUsed || null, size: r.size });

  // ---- recherche / classement ------------------------------------------------------------------------------
  function search(q, opts) {
    opts = opts || {}; const L = lib().list, toks = [...new Set(tokens(q))], limit = Math.min(opts.limit || 20, 100);
    let pool = opts.category ? L.filter((s) => slug(s.category) === slug(opts.category)) : L;
    if (!toks.length) return pool.slice().sort((a, b) => b.score - a.score).slice(0, limit).map(view);
    const out = [];
    for (const s of pool) {
      const nm = tokens(s.name.replace(/[-_]/g, " ")).join(" "), cat = tokens(s.category).join(" "), ds = tokens(s.desc).join(" ");
      let m = 0;
      for (const t of toks) { if (nm.includes(t)) m += 3; if (cat.includes(t)) m += 2; if (ds.includes(t)) m += 1; }
      if (m > 0) out.push({ s, rank: (m / (toks.length * 3)) * (0.55 + s.score) });
    }
    return out.sort((a, b) => b.rank - a.rank).slice(0, limit).map((x) => ({ ...view(x.s), match: +x.rank.toFixed(3) }));
  }
  function library(opts) {
    opts = opts || {}; let L = lib().list.slice();
    if (opts.category) L = L.filter((s) => slug(s.category) === slug(opts.category));
    const sort = opts.sort === "name" ? (a, b) => a.name.localeCompare(b.name) : opts.sort === "used" ? (a, b) => (b.stats.uses + b.stats.loads) - (a.stats.uses + a.stats.loads) : (a, b) => b.score - a.score;
    const cats = {}; for (const s of lib().list) cats[s.category] = (cats[s.category] || 0) + 1;
    const tiers = {}; for (const s of lib().list) tiers[s.tier] = (tiers[s.tier] || 0) + 1;
    return { total: lib().list.length, categories: Object.entries(cats).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count), tiers, skills: L.sort(sort).slice(0, opts.limit || 400).map(view) };
  }
  function readSkill(id) {
    id = canon(id); const r = lib().byId.get(id); if (!r) throw new Error("skill introuvable");
    const f = path.join(SKILLS_DIR, r.id); if (!path.resolve(f).startsWith(path.resolve(SKILLS_DIR) + path.sep)) throw new Error("chemin invalide");
    return { ...view(r), text: fs.readFileSync(f, "utf8").slice(0, 80000) };
  }
  function feedback(id, vote) {
    id = canon(id); if (!lib().byId.has(id)) throw new Error("skill introuvable");
    const s = st(id); if (vote === "up") s.up++; else if (vote === "down") s.down++; else throw new Error("vote invalide");
    cache.at = 0; save(); onChange && onChange(); return view(refresh(true).byId.get(id));
  }

  // ---- métiers -----------------------------------------------------------------------------------------------
  const ICONS = ["🛠️", "⚔️", "🧪", "🔮", "📜", "🛡️", "🏹", "🧭", "⚙️", "🎯", "🧬", "🪄"];
  function jobView(j) {
    const byId = lib().byId, skills = (j.skills || []).map((id) => byId.get(id)).filter(Boolean).map(view);
    return { name: j.name, desc: j.desc || "", icon: j.icon || "🛠️", skills, missing: (j.skills || []).filter((id) => !byId.has(id)), xp: j.xp || 0, level: levelOf(j.xp || 0), spawns: j.spawns || 0, runs: j.runs || 0, createdAt: j.createdAt, updatedAt: j.updatedAt };
  }
  const listJobs = () => Object.values(db.jobs).map(jobView).sort((a, b) => b.xp - a.xp || a.name.localeCompare(b.name));
  function saveJob(b) {
    const name = String(b.name || "").trim(); if (!name) throw new Error("nom du métier requis"); if (name.length > 40) throw new Error("nom trop long (40 max)");
    const k = jkey(name), prev = db.jobs[k], now = Date.now(), byId = lib().byId;
    const skills = [...new Set((Array.isArray(b.skills) ? b.skills : prev ? prev.skills : []).map(canon).filter((id) => byId.has(id)))].slice(0, 60);
    db.jobs[k] = { ...(prev || { createdAt: now, xp: 0, spawns: 0, runs: 0, icon: ICONS[Math.abs([...k].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)) % ICONS.length] }), name, desc: String(b.desc != null ? b.desc : (prev && prev.desc) || "").slice(0, 1200), icon: b.icon || (prev && prev.icon) || "🛠️", skills, updatedAt: now };
    try { addRole && addRole(name); } catch { /* déjà présent */ }
    cache.at = 0; save(); onChange && onChange(); return jobView(db.jobs[k]);
  }
  function deleteJob(name) { const k = jkey(name); if (!db.jobs[k]) throw new Error("métier introuvable"); delete db.jobs[k]; cache.at = 0; save(); onChange && onChange(); }
  const getJob = (name) => db.jobs[jkey(name)] || null;

  // ---- héritage : installation sur le nœud + bloc de prompt --------------------------------------------------
  function copyTree(srcDir, dstDir) { fs.mkdirSync(dstDir, { recursive: true }); for (const e of fs.readdirSync(srcDir, { withFileTypes: true })) { const s = path.join(srcDir, e.name), d = path.join(dstDir, e.name); if (e.isDirectory()) copyTree(s, d); else fs.copyFileSync(s, d); } }
  function stageSkill(stage, dirName, rel) {
    const abs = path.join(SKILLS_DIR, rel), d = path.join(stage, dirName); fs.mkdirSync(d, { recursive: true });
    if (/\/SKILL\.md$/i.test(rel)) { for (const e of fs.readdirSync(path.dirname(abs), { withFileTypes: true })) { const s = path.join(path.dirname(abs), e.name); if (e.isDirectory()) copyTree(s, path.join(d, e.name)); else fs.copyFileSync(s, path.join(d, e.name)); } }
    else fs.copyFileSync(abs, path.join(d, "SKILL.md"));
  }
  function hubSkillText() {
    const U = publicUrl();
    return `---\nname: fleet-skillhub\ndescription: Bibliothèque PARTAGÉE de skills Fleet Office, classées (S→E). À utiliser quand tu as besoin d'une méthode, d'un savoir-faire ou d'un guide que tu n'as pas déjà — pour chercher, lire et noter des skills utiles à ta mission.\n---\n# Bibliothèque de skills partagée (Fleet Office)\n\nTous les agents de la flotte partagent la même bibliothèque, classée par qualité (S = excellent … E = faible).\n\n**Chercher** (renvoie les meilleures skills pour ton besoin, avec leur rang) :\n\`\`\`bash\ncurl -s "${U}/api/skillhub/search?q=<mots-clés>&limit=8"\n\`\`\`\n**Lire une skill** (contenu complet, à appliquer ensuite) :\n\`\`\`bash\ncurl -s "${U}/api/skillhub/get?id=<id exact renvoyé par la recherche>"\n\`\`\`\n**Noter une skill après usage** (aide à améliorer le classement pour tous) :\n\`\`\`bash\ncurl -s -X POST "${U}/api/skillhub/feedback" -H 'Content-Type: application/json' -d '{"id":"<id>","vote":"up"}'   # ou "down"\n\`\`\`\nPrivilégie les rangs S/A/B. Si rien ne convient, dis-le dans ton rapport : l'humain peut recruter de nouvelles skills pour ton métier.\n`;
  }
  // installe (asynchrone, best-effort) les skills du métier + la méta-skill du hub sur le nœud de l'agent
  function installOn(host, entries) {
    try {
      const stage = fs.mkdtempSync(path.join(os.tmpdir(), "fleetjob-"));
      for (const [dirName, rel] of entries) stageSkill(stage, dirName, rel);
      const hubDir = path.join(stage, "fleet-skillhub"); fs.mkdirSync(hubDir, { recursive: true }); fs.writeFileSync(path.join(hubDir, "SKILL.md"), hubSkillText());
      const done = () => { try { fs.rmSync(stage, { recursive: true, force: true }); } catch {} };
      if (!host || host === "local") { const dst = path.join(os.homedir(), ".claude", "skills"); fs.mkdirSync(dst, { recursive: true }); copyTree(stage, dst); return done(); }
      const tar = cp.spawn("tar", ["c", "-C", stage, "."]);
      const ssh = cp.spawn("ssh", [...sshOpts, host, "bash -lc 'mkdir -p ~/.claude/skills && tar x -C ~/.claude/skills'"], { stdio: ["pipe", "ignore", "pipe"] });
      tar.stdout.pipe(ssh.stdin); ssh.stdin.on("error", () => {}); ssh.stderr.on("data", () => {});
      const kill = setTimeout(() => { try { ssh.kill("SIGKILL"); } catch {} }, 30000); if (kill.unref) kill.unref();
      ssh.on("close", () => { clearTimeout(kill); done(); }); ssh.on("error", done);
    } catch (e) { console.error("[skillsys] install:", e.message); }
  }
  // appelé à la création d'un agent : renvoie le bloc de prompt (ou "" si aucun métier correspondant)
  function applyToAgent(role, host) {
    const j = getJob(role); const entries = [];
    if (j) for (const id of j.skills || []) { const r = lib().byId.get(id); if (r) entries.push([installName(j.name, r.name), r.id, r]); }
    installOn(host, entries.map(([d, rel]) => [d, rel])); // la méta-skill du hub est installée pour TOUS les agents
    if (!j) return "";
    j.spawns = (j.spawns || 0) + 1; j.xp = (j.xp || 0) + 5; for (const [, , r] of entries) st(r.id).loads++; cache.at = 0; save();
    if (!entries.length) return `\n\n🎓 MÉTIER « ${j.name} » (niv. ${levelOf(j.xp)}) : aucune skill attachée pour l'instant. Tu peux en chercher dans la bibliothèque partagée (skill « fleet-skillhub »).`;
    const lines = entries.map(([d, , r]) => `- ${d} [${r.tier}] — ${(r.desc || r.name).slice(0, 140)}`).join("\n");
    return `\n\n🎓 MÉTIER « ${j.name} » (niv. ${levelOf(j.xp)}) — skills héritées, installées dans ~/.claude/skills ; invoque-les avec l'outil Skill dès qu'elles sont pertinentes :\n${lines}\n📚 Bibliothèque partagée : skill « fleet-skillhub » (rechercher / lire / noter d'autres skills classées).`;
  }
  // un agent vient d'appeler l'outil Skill : on crédite la skill (et le métier de l'agent)
  function recordUse(rawName, role) {
    const nm = String(rawName || "").trim().replace(/^\//, ""); if (!nm) return;
    const id = lib().names.get(nm) || lib().names.get(nm.toLowerCase()); if (!id) return;
    const s = st(id); s.uses++; s.lastUsed = Date.now();
    const j = getJob(role); if (j) { j.xp = (j.xp || 0) + 1; j.runs = (j.runs || 0) + 1; }
    cache.at = 0; save();
  }

  // ---- conseiller (retrieval + LLM) ---------------------------------------------------------------------------
  function runLLM(prompt, hostIdx) {
    return new Promise((resolve, reject) => {
      const hosts = advisorHosts(); const host = hosts[hostIdx || 0]; if (!host) return reject(new Error("aucun nœud disponible pour le conseiller"));
      const args = host === "local" ? ["claude", "-p", "--model", "haiku", "--output-format", "text"] : ["ssh", ...sshOpts, host, "claude -p --model haiku --output-format text"];
      const child = cp.spawn(args[0], args.slice(1), { stdio: ["pipe", "pipe", "pipe"] });
      let out = "", err = ""; const t = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 70000);
      child.stdout.on("data", (d) => (out += d)); child.stderr.on("data", (d) => (err += d));
      child.on("close", (code) => { clearTimeout(t); if (code === 0 && out.trim()) return resolve(out.trim()); if (hosts[(hostIdx || 0) + 1]) return resolve(runLLM(prompt, (hostIdx || 0) + 1)); reject(new Error((err || "conseiller indisponible").slice(0, 200))); });
      child.on("error", (e) => { clearTimeout(t); reject(e); });
      child.stdin.on("error", () => {}); child.stdin.end(prompt);
    });
  }
  async function advise(b) {
    const name = String(b.name || "").trim(), desc = String(b.desc || "").trim(), message = String(b.message || "").trim();
    const have = new Set(Array.isArray(b.skills) ? b.skills : []);
    const hist = (Array.isArray(b.history) ? b.history : []).slice(-8);
    const lastUsers = hist.filter((h) => h.role === "user").map((h) => h.text).join(" ");
    const query = [name, name, desc, message, lastUsers].join(" ");
    const cands = search(query, { limit: 28 }).filter((s) => !have.has(s.id));
    const fallback = () => ({ reply: cands.length ? `Voici les skills les mieux classées pour « ${name || "ce métier"} » dans la bibliothèque partagée. Dis-moi ce que ce métier doit savoir faire pour affiner.` : "Je ne trouve rien de pertinent dans la bibliothèque : décris-moi plus précisément le métier, ou lance une recherche en ligne.", propose: cands.slice(0, 6).map((s) => ({ ...s, why: "" })), searchOnline: [], llm: false });
    if (!name && !desc && !message) return fallback();
    const cl = cands.map((s) => `${s.id} | ${s.tier} | ${s.category}/${s.name} — ${(s.desc || "").slice(0, 110)}`).join("\n");
    const conv = hist.map((h) => `${h.role === "user" ? "Humain" : "Conseiller"} : ${String(h.text).slice(0, 400)}`).join("\n");
    const prompt = `Tu es le CONSEILLER DE RECRUTEMENT d'une flotte d'agents IA. Tu aides l'humain à définir un MÉTIER et à choisir ses skills (guides de savoir-faire invocables par l'agent).\n\nMétier : ${name || "(pas encore nommé)"}\nDescription : ${desc || "(aucune)"}\nSkills déjà attachées : ${have.size ? [...have].join(", ") : "aucune"}\n\nCandidats classés de la bibliothèque partagée (id | rang S→E | catégorie/nom — description) :\n${cl || "(aucun candidat)"}\n\n${conv ? "Conversation :\n" + conv + "\n\n" : ""}Dernier message de l'humain : ${message || "(propose-moi des skills pour ce métier)"}\n\nRéponds UNIQUEMENT par un objet JSON (pas de texte autour) :\n{"reply":"réponse courte et utile en français, tutoiement, qui dialogue avec l'humain (pose UNE question de précision si utile)","propose":[{"id":"<id EXACT d'un candidat>","why":"pourquoi cette skill pour ce métier (1 phrase)"}],"searchOnline":["mots-clés anglais courts pour chercher de nouvelles skills si les candidats ne couvrent pas un besoin"]}\nRègles : 3 à 7 skills maximum dans "propose", uniquement des ids présents dans les candidats, privilégie les rangs S/A/B, ne repropose pas une skill déjà attachée. "searchOnline" peut être vide.`;
    let raw; try { raw = await runLLM(prompt); } catch (e) { const f = fallback(); f.error = String(e.message || e); return f; }
    let j = null; try { const m = raw.match(/\{[\s\S]*\}/); j = m ? JSON.parse(m[0]) : null; } catch { j = null; }
    if (!j || typeof j.reply !== "string") { const f = fallback(); f.reply = raw.slice(0, 600); f.llm = true; return f; }
    const byId = new Map(cands.map((s) => [s.id, s])), seen = new Set(), propose = [];
    for (const p of Array.isArray(j.propose) ? j.propose : []) { const s = p && byId.get(p.id); if (s && !seen.has(s.id)) { seen.add(s.id); propose.push({ ...s, why: String(p.why || "").slice(0, 220) }); } }
    return { reply: j.reply.slice(0, 1500), propose, searchOnline: (Array.isArray(j.searchOnline) ? j.searchOnline : []).map((x) => String(x).slice(0, 40)).filter(Boolean).slice(0, 3), llm: true };
  }
  async function searchOnline(query) { const q = String(query || "").trim().slice(0, 60); if (!q) throw new Error("requête vide"); fetchOnline(q); setTimeout(() => { cache.at = 0; onChange && onChange(); }, 25000).unref?.(); return { started: true, query: q }; }

  return { library, search, readSkill, feedback, listJobs, saveJob, deleteJob, getJob, applyToAgent, recordUse, advise, searchOnline, refresh, installName, hubSkillText, flush: saveNow };
}

module.exports = { createSkillSys, tierOf, levelOf };
