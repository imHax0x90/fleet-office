#!/usr/bin/env node
"use strict";

/**
 * Fleet Office — serveur de visualisation des agents Claude Code.
 *
 * Aucune dépendance externe (Node natif uniquement).
 * - Scanne ~/.claude/jobs/<id>/state.json en continu
 * - Mappe chaque job sur un "agent" placé dans une salle (bureau / coworking / gym)
 * - Diffuse l'état en temps réel au navigateur via Server-Sent Events (/events)
 * - Sert le frontend 3D statique depuis ./public
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn, execSync, exec } = require("child_process");
const os = require("os");

const PORT = parseInt(process.env.PORT || "4173", 10);
const HOST = process.env.HOST || "0.0.0.0";
const JOBS_DIR =
  process.env.CLAUDE_JOBS_DIR || path.join(os.homedir(), ".claude", "jobs");
const SESSIONS_DIR =
  process.env.CLAUDE_SESSIONS_DIR || path.join(os.homedir(), ".claude", "sessions");
const PROJECTS_DIR =
  process.env.CLAUDE_PROJECTS_DIR || path.join(os.homedir(), ".claude", "projects");
const PUBLIC_DIR = path.join(__dirname, "public");
const SCAN_INTERVAL_MS = 1200;

function getLanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const entries of Object.values(ifaces)) {
    for (const iface of entries || []) {
      if (!iface || iface.family !== "IPv4" || iface.internal) continue;
      out.push(iface.address);
    }
  }
  return [...new Set(out)];
}

// ---------------------------------------------------------------------------
// Lecture & normalisation de l'état des jobs
// ---------------------------------------------------------------------------

function safeReadJSON(file) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readLastTimeline(jobDir, max = 6) {
  try {
    const raw = fs.readFileSync(path.join(jobDir, "timeline.jsonl"), "utf8");
    const lines = raw.split("\n").filter((l) => l.trim());
    const tail = lines.slice(-max);
    const out = [];
    for (const line of tail) {
      try {
        const e = JSON.parse(line);
        out.push({ at: e.at || null, state: e.state || null, detail: e.detail || null });
      } catch {
        /* ligne corrompue ignorée */
      }
    }
    return out;
  } catch {
    return [];
  }
}

// Normalise les états bruts Claude Code vers un vocabulaire stable côté UI.
function normalizeState(job) {
  const raw = String(job.state || "").toLowerCase();
  const tempo = String(job.tempo || "").toLowerCase();
  const inFlight = (job.inFlight && job.inFlight.tasks) || 0;

  if (["failed", "error", "errored"].includes(raw)) return "failed";
  if (["blocked", "needs_input", "needs-input", "input", "waiting", "paused"].includes(raw))
    return "blocked";
  if (raw === "done" || raw === "completed" || raw === "complete") return "done";
  if (raw === "working" || raw === "running" || raw === "active") return "working";
  if (inFlight > 0 || tempo === "active") return "working";
  if (["queued", "pending", "scheduled"].includes(raw)) return "queued";
  return "idle";
}

// ---------------------------------------------------------------------------
// Activité temps réel + tokens/coût : lecture incrémentale des transcripts
// ~/.claude/projects/<cwd-encodé>/<sessionId>.jsonl
// ---------------------------------------------------------------------------

const PRICING = { // $ / million de tokens (entrée, sortie)
  opus: { in: 15, out: 75 }, sonnet: { in: 3, out: 15 }, haiku: { in: 0.8, out: 4 }, fable: { in: 5, out: 25 },
};
function priceFor(model) {
  const m = String(model || "").toLowerCase();
  for (const k of Object.keys(PRICING)) if (m.includes(k)) return PRICING[k];
  return PRICING.sonnet;
}
function costOf(tok, model) {
  const p = priceFor(model);
  return (tok.in * p.in + tok.out * p.out + tok.cacheR * p.in * 0.1 + tok.cacheW * p.in * 1.25) / 1e6;
}
function totalTokens(tok) { return tok.in + tok.out + tok.cacheR + tok.cacheW; }
function baseName(p) { return p ? String(p).split("/").pop() : ""; }

function describeTool(name, input) {
  input = input || {};
  const n = name || "tool";
  if (n.startsWith("mcp__")) return "🔌 " + n.replace(/^mcp__/, "").replace(/__/g, "·");
  switch (n) {
    case "Edit": case "MultiEdit": case "Write": case "NotebookEdit":
      return "✏️ écrit " + baseName(input.file_path || input.notebook_path || "fichier");
    case "Read": return "📖 lit " + baseName(input.file_path || "fichier");
    case "Bash": {
      const c = (input.command || "").trim();
      if (/^git\s+commit/.test(c)) return "🔧 git commit";
      if (/^git\s+push/.test(c)) return "🚀 git push";
      if (/^git\b/.test(c)) return "🔧 " + c.split(/\s+/).slice(0, 2).join(" ");
      if (/^(npm|pnpm|yarn|node|python3?|pytest|cargo|go|make)\b/.test(c)) return "⚙️ " + c.split(/\s+/).slice(0, 2).join(" ");
      return "⌨️ " + (c.length > 38 ? c.slice(0, 37) + "…" : c || "commande");
    }
    case "Grep": case "Glob": return "🔎 cherche dans le code";
    case "Task": case "Agent": return "🤝 délègue à un sous-agent";
    case "WebSearch": case "WebFetch": return "🌐 consulte le web";
    case "TodoWrite": return "🗒️ planifie";
    case "AskUserQuestion": return "🙋 pose une question";
    default: return "🛠️ " + n;
  }
}

const trackers = new Map(); // sessionId -> { path, offset, tok, model, branch, events }
function findTranscript(sessionId) {
  try {
    for (const d of fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const p = path.join(PROJECTS_DIR, d.name, sessionId + ".jsonl");
      if (fs.existsSync(p)) return p;
    }
  } catch { /* ignore */ }
  return null;
}
function readActivity(sessionId) {
  if (!sessionId) return { tok: { in: 0, out: 0, cacheR: 0, cacheW: 0 }, events: [], model: null, branch: null };
  let tr = trackers.get(sessionId);
  if (!tr) { tr = { path: findTranscript(sessionId), offset: 0, tok: { in: 0, out: 0, cacheR: 0, cacheW: 0 }, model: null, branch: null, events: [] }; trackers.set(sessionId, tr); }
  if (!tr.path) tr.path = findTranscript(sessionId);
  if (!tr.path) return tr;
  let st; try { st = fs.statSync(tr.path); } catch { return tr; }
  if (st.size < tr.offset) { tr.offset = 0; tr.tok = { in: 0, out: 0, cacheR: 0, cacheW: 0 }; tr.events = []; }
  if (st.size > tr.offset) {
    let chunk = "";
    try { const fd = fs.openSync(tr.path, "r"); const len = st.size - tr.offset; const buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, tr.offset); fs.closeSync(fd); chunk = buf.toString("utf8"); }
    catch { return tr; }
    tr.offset = st.size;
    const lines = chunk.split("\n");
    if (!chunk.endsWith("\n")) tr.offset -= Buffer.byteLength(lines.pop() || "", "utf8"); // ligne partielle -> prochaine fois
    for (const line of lines) {
      if (!line.trim()) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (o.type !== "assistant" || !o.message) continue;
      if (o.message.model) tr.model = o.message.model;
      if (o.gitBranch) tr.branch = o.gitBranch;
      const u = o.message.usage;
      if (u) { tr.tok.in += u.input_tokens || 0; tr.tok.out += u.output_tokens || 0; tr.tok.cacheR += u.cache_read_input_tokens || 0; tr.tok.cacheW += u.cache_creation_input_tokens || 0; }
      for (const b of (o.message.content || [])) if (b.type === "tool_use") tr.events.push({ at: o.timestamp || null, label: describeTool(b.name, b.input) });
    }
    if (tr.events.length > 12) tr.events = tr.events.slice(-12);
  }
  return tr;
}
function activityFields(sessionId) {
  const act = readActivity(sessionId);
  return {
    activity: act.events.slice(-6).map((e) => e.label),
    lastAction: act.events.length ? act.events[act.events.length - 1].label : null,
    tokens: totalTokens(act.tok),
    tokensBreakdown: { ...act.tok },
    costUsd: +costOf(act.tok, act.model).toFixed(4),
    model: act.model,
    gitBranch: act.branch,
  };
}

// Flux "live Claude Code" pour le panneau d'inspection (lecture seule).
function tailFile(p, maxBytes) {
  const st = fs.statSync(p);
  const start = Math.max(0, st.size - maxBytes);
  const fd = fs.openSync(p, "r");
  const buf = Buffer.alloc(st.size - start);
  fs.readSync(fd, buf, 0, buf.length, start);
  fs.closeSync(fd);
  return buf.toString("utf8");
}
function trunc(s, n) { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
// comme trunc, mais préserve les retours à la ligne (messages affichés en entier) ;
// n sert seulement de garde-fou contre des blocs géants (gros fichiers / sorties).
function clip(s, n) { s = String(s || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
function resultText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((b) => (typeof b === "string" ? b : b.text || "")).join(" ");
  return "";
}
function toolLine(name, input) {
  input = input || {};
  if (name === "Bash") return "$ " + trunc(input.command, 160);
  return describeTool(name, input);
}
function renderTranscript(sessionId, n = 50) {
  const mrec = managed.get(sessionId);
  let raw;
  const remoteHost = (mrec && isRemote(mrec)) ? mrec.host : _remoteSessionHost.get(sessionId);
  if (remoteHost) {
    raw = remoteTranscriptRaw(remoteHost, sessionId);
    if (!raw) return [];
  } else {
    const p = (trackers.get(sessionId) || {}).path || findTranscript(sessionId);
    if (!p) return [];
    try { raw = tailFile(p, 256 * 1024); } catch { return []; }
  }
  const lines = raw.split("\n");
  lines.shift(); // 1re ligne potentiellement tronquée
  const feed = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const at = o.timestamp || null;
    if (o.type === "user" && o.message) {
      const c = o.message.content;
      if (typeof c === "string") { if (c.trim()) feed.push({ kind: "prompt", text: clip(c, 20000), at }); }
      else if (Array.isArray(c)) for (const b of c) {
        if (b.type === "text" && b.text.trim()) feed.push({ kind: "prompt", text: clip(b.text, 20000), at });
        else if (b.type === "tool_result") { const t = clip(resultText(b.content), 8000); if (t) feed.push({ kind: "result", text: t, at }); }
      }
    } else if (o.type === "assistant" && o.message) {
      for (const b of (o.message.content || [])) {
        if (b.type === "text" && b.text.trim()) feed.push({ kind: "say", text: clip(b.text, 20000), at });
        else if (b.type === "thinking" && (b.thinking || "").trim()) feed.push({ kind: "think", text: clip(b.thinking, 8000), at });
        else if (b.type === "tool_use") feed.push({ kind: "tool", text: toolLine(b.name, b.input), at });
      }
    }
  }
  return feed.slice(-n);
}

// ---------------------------------------------------------------------------
// ORCHESTRATEUR : spawn / pilotage de vrais process Claude Code (bidirectionnel)
// ---------------------------------------------------------------------------

const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
// Modes SÛRS uniquement : aucun ne contourne les validations.
//  - acceptEdits : auto-accepte les éditions de fichiers dans le workspace, mais Bash / git /
//    réseau / chemins sensibles restent refusés en headless (donc pas de push/merge/deploy auto).
//  - plan : lecture seule (l'agent réfléchit/planifie, n'écrit rien).
//  - default : tout ce qui demande une permission est refusé.
// bypassPermissions / dontAsk / auto sont disponibles : le mode complet est le défaut
// (choix explicite de l'utilisateur). Pour revenir aux seuls modes sûrs, lancer le serveur
// avec FLEET_ALLOW_UNSAFE_PERMS=0 (opt-out conscient).
const ALLOW_UNSAFE = process.env.FLEET_ALLOW_UNSAFE_PERMS !== "0";
const SAFE_PERMS = ALLOW_UNSAFE
  ? ["acceptEdits", "plan", "default", "bypassPermissions", "dontAsk", "auto"]
  : ["acceptEdits", "plan", "default"];
// En mode avancé (FLEET_ALLOW_UNSAFE_PERMS=1), pleine capacité par défaut (git pull/push, shell…).
const DEFAULT_PERM = ALLOW_UNSAFE ? "bypassPermissions" : "acceptEdits";
const managed = new Map(); // sessionId -> état de l'agent piloté
const hidden = new Set(); // sessionId masqués (kill d'une session observée/dormante = on la retire de la vue)

// ---- recherche de skills/MCP par métier via scrapling (création / recrutement / inactivité) ----
const SKILLS_DIR = path.join(os.homedir(), ".fleet-office-skills");

// --- métiers (rôles) personnalisables, partagés entre tous les frontends (console, 3D, APK) ---
const ROLES_FILE = path.join(os.homedir(), ".fleet", "roles.json");
const DEFAULT_ROLES = ["Architecte", "Backend", "Frontend", "DevOps", "QA"];
function loadCustomRoles() {
  try { const a = JSON.parse(fs.readFileSync(ROLES_FILE, "utf8")); if (Array.isArray(a)) return a; } catch { /* pas encore de fichier */ }
  return [];
}
function allRoles() { // défauts + custom, dédupliqués (insensible à la casse), ordre stable
  const seen = new Set(), out = [];
  for (const r of [...DEFAULT_ROLES, ...loadCustomRoles()]) {
    const v = String(r || "").trim(), k = v.toLowerCase();
    if (v && !seen.has(k)) { seen.add(k); out.push(v); }
  }
  return out;
}
function addRole(role) {
  const v = String(role || "").trim();
  if (!v) throw new Error("rôle vide");
  if (v.length > 40) throw new Error("rôle trop long (40 max)");
  if (!allRoles().some((r) => r.toLowerCase() === v.toLowerCase())) {
    const custom = loadCustomRoles(); custom.push(v);
    fs.mkdirSync(path.dirname(ROLES_FILE), { recursive: true });
    fs.writeFileSync(ROLES_FILE, JSON.stringify(custom, null, 2));
  }
  return allRoles();
}
const VENV_PY = path.join(__dirname, ".venv", "bin", "python");
const SCRAPER = path.join(__dirname, "scrape_skills.py");
const skillCooldown = new Map(); // role -> dernier lancement (ms)
const lastStatusSkills = new Map(); // sessionId -> dernier statut connu (pour déclencher à l'inactivité)
function skillsFileFor(role) { return path.join(SKILLS_DIR, String(role).toLowerCase().replace(/[^a-z0-9]+/gi, "_") + ".md"); }
function researchSkills(role) {
  role = String(role || "").trim(); if (!role) return;
  const key = role.toLowerCase(), now = Date.now();
  if (now - (skillCooldown.get(key) || 0) < 30 * 60 * 1000) return; // 1 recherche / 30 min / métier
  skillCooldown.set(key, now);
  try {
    fs.mkdirSync(SKILLS_DIR, { recursive: true });
    if (!fs.existsSync(VENV_PY)) return;
    const p = spawn(VENV_PY, [SCRAPER, role, skillsFileFor(role)], { cwd: __dirname, stdio: "ignore", detached: true });
    p.unref();
  } catch { /* ignore */ }
}

// Deux agents partagent-ils le même répertoire (ou un sous-dossier) ?
function relatedCwd(a, b) { return a === b || a.startsWith(b + "/") || b.startsWith(a + "/"); }
// Détecte les agents déjà actifs sur le même workspace -> teamId commun + liste des pairs.
function coordinateWorkspace(cwd, selfId) {
  const peers = [];
  let teamId = null;
  for (const [sid, m] of managed) {
    if (sid === selfId || !m.cwd) continue;
    if (relatedCwd(cwd, m.cwd)) { peers.push(m); if (m.teamId) teamId = m.teamId; }
  }
  if (!peers.length) return null;
  if (!teamId) teamId = crypto.randomUUID().slice(0, 8);
  for (const m of peers) if (!m.teamId) { m.teamId = teamId; m.teamGoal = m.teamGoal || ("Collaboration — " + projectName(cwd)); }
  return { teamId, peers };
}

// === SESSION CLAUDE PERSISTANTE (streaming) ============================================
// Chaque agent piloté garde UN process `claude` vivant qui lit les messages utilisateur en
// streaming sur stdin (--input-format stream-json) et émet ses tours + suggestions de
// follow-up (--prompt-suggestions) sur stdout. -> expérience « terminal » : on enchaîne les
// follow-ups sans relancer, et les commandes / (custom/skills/projet) passent telles quelles.
// Process « chaud » : on garde le process claude vivant entre les tours -> follow-ups ~1,5 s au
// lieu de 6-10 s (plus de re-spawn ni de recharge MCP à chaque message). Un process chaud inactif
// est recyclé après IDLE_PROC_TTL (libère la RAM). NB : le chip de suggestion de follow-up est
// désactivé en mode chaud — il exigeait de fermer stdin à CHAQUE tour (= le mode lent one-shot, qui
// déclenche en plus un appel modèle dédié). FLEET_WARM=0 -> mode lent historique avec suggestions.
const WARM = process.env.FLEET_WARM !== "0";
function claudeArgs(rec) {
  const perm = SAFE_PERMS.includes(rec.perm) ? rec.perm : DEFAULT_PERM;
  const args = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
    "--prompt-suggestions=true", "--model", rec.model || "sonnet", "--permission-mode", perm];
  if (rec.effort) args.push("--effort", rec.effort);
  if (rec.fresh) args.push("--session-id", rec.id); else args.push("--resume", rec.id);
  return args;
}

// === MULTI-NŒUD (Tailscale/Proxmox via SSH) ============================================
// Un agent peut tourner en LOCAL ou sur n'importe quel nœud du réseau Tailscale : on enrobe
// l'appel `claude` dans `ssh <nœud> 'cd <cwd> && exec claude <flags>'`. Le stdin/stdout
// (streaming, follow-ups, commandes /) transite de façon transparente par SSH.
const REMOTE_CLAUDE = process.env.FLEET_REMOTE_CLAUDE || "claude";
const SSH_OPTS = ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=10"];
function shq(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; } // échappement single-quote POSIX
function isRemote(rec) { return !!(rec.host && rec.host !== "local"); }
function spawnClaude(rec) {
  const args = claudeArgs(rec);
  if (!isRemote(rec)) return spawn(CLAUDE_BIN, args, { cwd: rec.cwd, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
  // `bash -lc` => login shell distant : charge le PATH user (ex. ~/.local/bin) sinon `claude`
  // installé dans ~/.local/bin est introuvable en SSH non-login.
  const inner = 'export PATH="$HOME/.local/bin:$PATH"; cd ' + shq(rec.cwd || "~") + " && exec " + REMOTE_CLAUDE + " " + args.map(shq).join(" ");
  const remoteCmd = "bash -lc " + shq(inner);
  return spawn("ssh", [...SSH_OPTS, rec.host, remoteCmd], { env: process.env, stdio: ["pipe", "pipe", "pipe"] });
}
// Liste des hôtes pilotables : local + nœuds Tailscale (en ligne en premier).
function listHosts() {
  const me = os.hostname();
  const hosts = [{ id: "local", label: me + " · local", ip: "127.0.0.1", online: true }];
  try {
    for (const line of execSync("tailscale status", { encoding: "utf8", timeout: 5000 }).split("\n")) {
      const m = line.trim().split(/\s+/);
      if (m.length < 2 || !/^\d+\.\d+\.\d+\.\d+$/.test(m[0]) || m[1] === me) continue;
      hosts.push({ id: m[1], ip: m[0], label: m[1], online: !/offline/.test(line) });
    }
  } catch { /* tailscale absent / déconnecté */ }
  return hosts.sort((a, b) => (b.online - a.online) || (a.id === "local" ? -1 : 1));
}
// Transcript d'un agent distant : lu via ssh (cache court pour ne pas spammer le nœud).
const _remoteTx = new Map();
function remoteTranscriptRaw(host, sid) {
  const key = host + "|" + sid, c = _remoteTx.get(key);
  if (c && Date.now() - c.at < 1500) return c.raw;
  let raw = c ? c.raw : "";
  try {
    const cmd = `f=$(find ~/.claude/projects -name ${sid}.jsonl 2>/dev/null | head -1); [ -n "$f" ] && tail -c 262144 "$f"`;
    raw = execSync("ssh " + SSH_OPTS.join(" ") + " " + shq(host) + " " + shq(cmd), { encoding: "utf8", timeout: 9000, maxBuffer: 8 * 1024 * 1024 });
  } catch { /* garde l'ancien cache */ }
  _remoteTx.set(key, { at: Date.now(), raw });
  return raw;
}

// === SYNC MULTI-APPAREILS ============================================================
// Journalise les messages envoyés DEPUIS l'app (tel/web/3D) à une session adoptée — i.e. une
// session qui vit aussi dans un terminal. Le sidecar est écrit SUR LA MACHINE DE LA SESSION
// (~/.fleet/sync/<sessionId>.jsonl), là où l'utilisateur lancera la commande /sync pour rapatrier
// ces échanges dans le contexte mémoire de son terminal. On ne journalise que le message user :
// /sync relit les réponses de l'agent dans le transcript (qui les contient déjà via --resume).
function appendSyncLog(rec, userMsg, origin) {
  try {
    if (!rec || !rec.id || !userMsg || !String(userMsg).trim()) return;
    const line = JSON.stringify({ at: Date.now(), ts: new Date().toISOString(), device: String(origin || "app"), user: String(userMsg) });
    const rel = ".fleet/sync/" + rec.id + ".jsonl";
    if (isRemote(rec)) {
      const remoteCmd = "mkdir -p ~/.fleet/sync && cat >> " + shq(rel);
      const p = spawn("ssh", [...SSH_OPTS, rec.host, remoteCmd], { stdio: ["pipe", "ignore", "ignore"] });
      p.on("error", () => {}); p.stdin.write(line + "\n"); p.stdin.end();
    } else {
      const dir = path.join(os.homedir(), ".fleet", "sync");
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(path.join(dir, rec.id + ".jsonl"), line + "\n");
    }
  } catch (e) { console.error("[sync] appendSyncLog:", e.message); }
}

// Joue UN tour : process claude qui lit le message sur stdin, répond, puis — à la FERMETURE
// du flux d'entrée (stdin.end) — émet sa suggestion de follow-up (prompt_suggestion) et se
// termine. La session est persistée -> le tour suivant reprend la conversation en --resume.
// (La suggestion N'EST PAS émise tant que stdin reste ouvert : d'où un process par tour.)
function startProc(rec) {
  let proc;
  try { proc = spawnClaude(rec); }
  catch (e) { rec.status = "failed"; rec.error = String(e.message || e); return null; }
  rec.fresh = false; rec.proc = proc; rec.error = null; rec.intentionalKill = false;
  let buf = "";
  proc.stdout.on("data", (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (o.type === "system" && o.subtype === "init") {
        if (Array.isArray(o.slash_commands)) rec.slashCommands = o.slash_commands;
      } else if (o.type === "prompt_suggestion") {
        rec.suggestion = o.suggestion || null;
      } else if (o.type === "result") {
        rec.costUsd = (rec.costUsd || 0) + (o.total_cost_usd || 0);
        rec.lastResult = o.result || rec.lastResult;
        rec.denials = (o.permission_denials || []).length;
        rec.busy = false; rec.lastTurnAt = Date.now(); // réponse prête -> input libéré
        broadcast(true);
        if (WARM && rec.queue && rec.queue.length) pump(rec); // enchaîne la file sur le process chaud
      }
    }
    broadcast(false);
  });
  proc.stderr.on("data", (d) => { rec.stderr = String(d).slice(-400); });
  proc.on("close", (code) => {
    rec.proc = null; rec.busy = false; rec.lastTurnAt = Date.now();
    if (!rec.intentionalKill) rec.status = code === 0 ? "idle" : "failed";
    rec.exitCode = code; pump(rec); broadcast(true);
  });
  proc.on("error", (e) => { rec.proc = null; rec.busy = false; rec.status = "failed"; rec.error = String(e.message || e); broadcast(true); });
  return proc;
}

// Joue le prochain message de la file (un process par tour ; stdin fermé aussitôt -> suggestion).
function pump(rec) {
  if (rec.busy || !rec.queue || !rec.queue.length) return;
  const next = rec.queue.shift();
  if (next.label) rec.lastPrompt = next.label;
  rec.busy = true; rec.suggestion = null; rec.status = "working"; rec.lastTurnAt = Date.now();
  let proc = rec.proc;             // WARM : réutilise le process vivant -> pas de cold start
  if (!proc) { proc = startProc(rec); if (!proc) { rec.busy = false; return; } }
  try {
    proc.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: next.text } }) + "\n");
    if (!WARM) proc.stdin.end(); // mode lent historique : 1 process/tour (avec suggestion de follow-up)
  } catch (e) { rec.busy = false; rec.status = "failed"; rec.error = String(e.message || e); }
  broadcast(false);
}

// Envoie un message (mission ou follow-up) -> file d'attente puis lecture.
function sendToProc(rec, text, label) {
  if (!rec.queue) rec.queue = [];
  rec.queue.push({ text: String(text), label: label || null });
  pump(rec);
}

// Compat : ancienne signature one-shot -> nouveau modèle persistant streamé.
function runClaude({ sessionId, cwd, prompt, model, perm, resume }) {
  let rec = managed.get(sessionId);
  if (!rec) { rec = { id: sessionId, cwd, model: model || "sonnet", perm, status: "idle", costUsd: 0 }; managed.set(sessionId, rec); }
  if (cwd) rec.cwd = cwd;
  if (model) rec.model = model;
  if (perm) rec.perm = perm;
  if (resume === false && !rec.everStarted) rec.fresh = true; // nouvelle session -> --session-id
  rec.everStarted = true;
  sendToProc(rec, prompt, null);
}

function spawnAgent({ name, role, cwd, prompt, model, perm, teamId: joinTeamId, host, id: fixedId, attachments }) {
  const remote = !!(host && host !== "local");
  if (!cwd || !String(cwd).trim()) throw new Error("workspace requis");
  if (!remote) {
    if (!fs.existsSync(cwd)) throw new Error("workspace introuvable : " + cwd);
    if (!fs.statSync(cwd).isDirectory()) throw new Error("workspace n'est pas un dossier : " + cwd);
  }
  if (!prompt || !String(prompt).trim()) throw new Error("mission (prompt) requise");
  // id fixe optionnel (ex. watchdog d'un agent permanent) -> la conversation reste joignable après respawn
  const sessionId = (fixedId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fixedId)) ? fixedId : crypto.randomUUID();
  hidden.delete(sessionId); // un (re)spawn dé-masque (ex. watchdog JARVIS)
  let finalPrompt = prompt, teamId = null, teamGoal = null, teamName = null;
  // greffe explicite à une équipe existante (choisie dans l'UI)
  const teamPeers = joinTeamId ? [...managed.values()].filter((m) => m.teamId === joinTeamId) : [];
  if (joinTeamId && teamPeers.length) {
    teamId = joinTeamId; teamGoal = teamPeers[0].teamGoal || ("Équipe " + joinTeamId); teamName = teamPeers[0].teamName || teamGoal;
    const peerDesc = teamPeers.map((m) => `${m.name} (${m.role})`).join(", ");
    finalPrompt = `Tu REJOINS une équipe en cours sur cet objectif : « ${teamGoal} ». Coéquipiers : ${peerDesc}.\nAvant d'agir : lis TEAM_NOTES.md + les fichiers récents, coordonne-toi, évite les conflits, et ajoute une ligne « [${role || "agent"}] … » dans TEAM_NOTES.md. Utilise git (branches, pull avant push).\n\nTa mission : ${prompt}`;
  } else {
    // auto-coordination : si d'autres agents bossent sur le même répertoire, on les met en équipe
    const coord = remote ? null : coordinateWorkspace(cwd, sessionId);
    if (coord) {
      teamId = coord.teamId; teamGoal = "Collaboration — " + projectName(cwd);
      const peerDesc = coord.peers.map((m) => `${m.name} (${m.role})`).join(", ");
      finalPrompt = `⚠️ D'AUTRES AGENTS travaillent DÉJÀ dans ce workspace (${cwd}) : ${peerDesc}.\nAvant d'agir : lis TEAM_NOTES.md + les fichiers récents pour voir leur travail, ÉVITE les conflits (ne réécris pas ce qu'ils font), coordonne-toi avec eux, et ajoute une ligne « [${role || "agent"}] … » dans TEAM_NOTES.md (crée-le s'il n'existe pas). Utilise git (branches, pull avant push) pour ne pas écraser leur travail.\n\nTa mission : ${prompt}`;
    }
  }
  researchSkills(role); // skills/MCP du métier (création/recrutement) via scrapling
  finalPrompt += `\n\n💡 Des skills/MCP pertinents pour ton métier (${role || "agent"}) sont recherchés (scrapling) dans ${skillsFileFor(role || "agent")} — consulte ce fichier dès qu'il existe et propose ceux qui t'aideraient.`;
  // pièces jointes de la mission initiale → livrées dans l'inbox de la session, sur la machine de l'agent
  if (Array.isArray(attachments) && attachments.length) {
    try { finalPrompt += attachBlock(deliverAttachments(sessionId, attachments, remote ? host : null)); }
    catch (e) { console.error("[attach] spawn:", e.message); }
  }
  managed.set(sessionId, {
    id: sessionId, name: name || projectName(cwd), role: role || "claude", cwd, host: remote ? host : null,
    model: model || "sonnet", perm: SAFE_PERMS.includes(perm) ? perm : DEFAULT_PERM,
    status: "working", startedAt: Date.now(), lastPrompt: prompt, costUsd: 0, teamId, teamGoal, teamName,
  });
  runClaude({ sessionId, cwd, prompt: finalPrompt, model, perm, resume: false });
  return sessionId;
}
function spawnTeam({ name, goal, cwd, model, perm, roles, chief }) {
  if (!cwd || !fs.existsSync(cwd)) throw new Error("workspace introuvable : " + cwd);
  if (!fs.statSync(cwd).isDirectory()) throw new Error("workspace n'est pas un dossier : " + cwd);
  if (!goal || !String(goal).trim()) throw new Error("objectif d'équipe requis");
  const list = (Array.isArray(roles) && roles.length) ? roles : ["Architecte", "Backend", "Frontend", "DevOps", "QA"];
  const teamId = crypto.randomUUID().slice(0, 8);
  const teamName = (name && String(name).trim()) || ("Équipe " + projectName(cwd));
  // le chef peut être un AGENT EXISTANT ("agent:<id>") ou un des rôles à créer
  const chiefExistingId = (chief && String(chief).startsWith("agent:")) ? String(chief).slice(6) : null;
  const chiefRole = chiefExistingId ? null : ((chief && list.includes(chief)) ? chief : list[0]);
  const ids = [];
  const chiefTail = `\n\n👑 Tu es le CHEF de cette équipe. RÈGLE ABSOLUE : ne déclare JAMAIS l'équipe « terminée » et ne dissous JAMAIS de toi-même tant que l'humain n'a pas tranché. Quand tous les membres ont fini (« [FINI] » dans TEAM_NOTES.md), tu CONSOLIDES et tu écris « [CHEF][QUESTION] … » dans TEAM_NOTES.md résumant le travail et demandant à l'humain quoi faire — puis tu attends. SEULS toi (le chef) ou l'humain peuvent clore des sessions : avec l'accord humain, appelle POST http://127.0.0.1:${PORT}/api/team-kill {"teamId":"${teamId}"} ou /api/kill {"id":"<sessionId>"}. Tu peux aussi recruter des membres : POST /api/spawn {"name","role","cwd":"${cwd}","prompt","teamId":"${teamId}"}.`;

  // 1) chef = agent existant : on le rattache (pas de spawn)
  let chiefLabel = chiefRole;
  if (chiefExistingId) {
    const rec = ensureManaged(chiefExistingId);
    if (!rec) throw new Error("agent chef introuvable");
    rec.teamId = teamId; rec.teamName = teamName; rec.teamGoal = goal; rec.chief = true; rec.cwd = cwd;
    if (!/👑/.test(rec.name)) rec.name = rec.name + " 👑";
    chiefLabel = rec.name;
    if (!rec.busy) {
      const p = `Tu es désormais le CHEF de l'ÉQUIPE « ${teamName} » (membres : ${list.join(", ")}) dans le workspace ${cwd}. Objectif :\n\n« ${goal} »${chiefTail}`;
      runClaude({ sessionId: rec.id, cwd, prompt: p, model: rec.model, perm: rec.perm, resume: true });
    }
    ids.push(rec.id);
  }

  // 2) membres (les rôles cochés ; l'un d'eux est chef si aucun agent existant n'a été choisi)
  list.forEach((role) => {
    const sessionId = crypto.randomUUID();
    const isChief = !chiefExistingId && role === chiefRole;
    researchSkills(role);
    const base = `Tu fais partie de l'ÉQUIPE « ${teamName} » (chef : ${chiefLabel} ; membres : ${list.join(", ")}) dans le MÊME workspace (${cwd}). Objectif commun :\n\n« ${goal} »\n\nTon rôle : ${role}. Lis d'abord TEAM_NOTES.md + les fichiers présents, fais ton travail, ajoute des lignes « [${role}] … » dans TEAM_NOTES.md.\n💡 Skills/MCP de ton métier dans ${skillsFileFor(role)}.`;
    const tail = isChief ? chiefTail
      : `\n\nQuand ta tâche est finie : NE clos PAS la mission. Écris « [FINI][${role}] <résumé> » dans TEAM_NOTES.md à l'attention du chef (${chiefLabel}) et reste en attente de ses instructions / de la décision de l'humain.`;
    managed.set(sessionId, {
      id: sessionId, name: isChief ? `${role} 👑` : role, role, cwd, model: model || "sonnet",
      perm: SAFE_PERMS.includes(perm) ? perm : DEFAULT_PERM, status: "working",
      startedAt: Date.now(), lastPrompt: "[équipe] " + goal, costUsd: 0, teamId, teamGoal: goal, teamName,
      chief: isChief,
    });
    runClaude({ sessionId, cwd, prompt: base + tail, model, perm, resume: false });
    ids.push(sessionId);
  });
  return { teamId, ids, teamName };
}
// "Adopte" n'importe quelle session live (interactive ou bg) pour la rendre pilotable.
function ensureManaged(id) {
  if (managed.has(id)) return managed.get(id);
  const s = readSessions().find((x) => x.sessionId === id);
  if (s) {
    const act = readActivity(id);
    managed.set(id, {
      id, name: s.name || projectName(s.cwd), role: s.agent || (s.kind === "bg" ? "claude" : "interactif"),
      cwd: s.cwd, model: act.model || "sonnet", perm: DEFAULT_PERM, status: "idle",
      startedAt: s.startedAt || Date.now(), lastPrompt: null, costUsd: 0, adopted: true, pid: s.pid,
    });
    return managed.get(id);
  }
  // HANDOFF : session sur un autre nœud tailnet -> on l'adopte pour la reprendre via SSH.
  const rhost = _remoteSessionHost.get(id);
  if (rhost) {
    const ra = scanRemoteAgents().find((a) => a.id === id);
    // Continuité multi-appareils : on N'INTERDIT PLUS de reprendre une session encore vivante
    // dans un terminal. On l'adopte (--resume) ; `shared:true` = co-pilotée tel/PC. Le terminal
    // garde un contexte mémoire désynchronisé -> la commande /sync (côté nœud) le rapatrie.
    managed.set(id, {
      id, name: (ra && ra.name) || id, role: (ra && ra.role) || "interactif",
      cwd: (ra && ra.cwd) || "~", host: rhost, model: "sonnet", perm: DEFAULT_PERM, status: "idle",
      startedAt: (ra && ra.createdAt) || Date.now(), lastPrompt: null, costUsd: 0, adopted: true,
      shared: !!(ra && ra.dormant === false),
    });
    return managed.get(id);
  }
  return null;
}
function sendAgent(id, prompt) {
  const rec = ensureManaged(id); if (!rec) throw new Error("session introuvable");
  if (!prompt || !String(prompt).trim()) throw new Error("message vide");
  rec.lastPrompt = prompt; rec.training = false; // de retour au travail (mis en file si un tour est déjà en cours)
  runClaude({ sessionId: id, cwd: rec.cwd, prompt, model: rec.model, perm: rec.perm, resume: true });
}
// Stop = interrompt le tour en cours (tue le process ; la session reprend en --resume au prochain message).
function stopAgent(id) { const rec = managed.get(id); if (rec && rec.proc && rec.busy) { rec.intentionalKill = true; rec.queue = []; rec.busy = false; try { rec.proc.kill("SIGTERM"); } catch { /* */ } return true; } return false; }

// Retire du disque le dossier d'un job de fond orphelin (sans session vivante).
// Sans ça, readJobs() le ré-affiche à chaque scan -> agent "zombie" indéboulonnable.
function removeJobDir(id) {
  const entry = readJobs().get(id);
  if (!entry || !entry.dir) return false;
  try { fs.rmSync(entry.dir, { recursive: true, force: true }); return true; }
  catch { return false; }
}

// Ferme/tue définitivement la session (kill du process + retrait du monde).
function killAgent(id) {
  const rec = managed.get(id); // PAS d'ensureManaged ici (évitait de planter sur une session vivante)
  if (rec && !rec.adopted && rec.proc) {
    // agent lancé par l'orchestrateur -> on le termine réellement
    rec.intentionalKill = true; try { rec.proc.kill("SIGTERM"); } catch { /* ignore */ }
  } else {
    // session observée / dormante / adoptée (y compris tes sessions interactives) :
    // on NE tue PAS le process humain -> on la masque juste de la vue.
    hidden.add(id);
  }
  managed.delete(id);
  removeJobDir(id);
  trackers.delete(id);
  return true;
}

// Termine la session active et envoie l'agent à la SALLE DE SPORT s'auto-améliorer
// (recherche de Claude Skills & serveurs MCP pour son métier).
function trainAgent(id) {
  const rec = ensureManaged(id); if (!rec) throw new Error("session introuvable");
  if (rec.busy) throw new Error("agent occupé (arrête la tâche en cours d'abord)");
  rec.training = true; rec.teamId = null; rec.teamGoal = null;
  const p = `Ta session de travail est TERMINÉE — direction la SALLE DE SPORT 🏋️ pour monter en compétence sur ton métier (${rec.role}).\nEntraînement : recherche sur le web des **Claude Skills** et des **serveurs MCP** récents et pertinents pour un ${rec.role}. Évalue les 4 à 6 plus utiles (ce qu'ils font, pourquoi ils t'aideraient, comment les obtenir). Écris un rapport clair « SKILLS_LEARNED.md » dans ton workspace. NE les installe PAS — propose-les. Puis termine.`;
  rec.lastPrompt = "🏋️ Entraînement — skills & MCP (" + rec.role + ")";
  runClaude({ sessionId: id, cwd: rec.cwd, prompt: p, model: rec.model, perm: rec.perm, resume: true });
}

// Réaffecte le répertoire de travail de l'agent ("change directory").
function cdAgent(id, cwd) {
  const rec = ensureManaged(id); if (!rec) throw new Error("session introuvable");
  if (!cwd || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error("dossier invalide : " + cwd);
  if (rec.busy) throw new Error("agent occupé (arrête la tâche en cours d'abord)");
  rec.cwd = cwd; rec.training = false;
  // le cwd est figé au lancement du process : on coupe la session (reprise --resume dans le nouveau dossier au prochain message)
  if (rec.proc) { rec.intentionalKill = true; try { rec.proc.kill("SIGTERM"); } catch { /* */ } rec.proc = null; }
  return true;
}

// Récupère les process persistants restés inactifs trop longtemps (libère la RAM ;
// la session reprend en --resume au prochain message). Sans ça les process s'accumulent.
const IDLE_PROC_TTL = parseInt(process.env.FLEET_WARM_TTL || String(15 * 60 * 1000), 10); // recyclage d'un process chaud inactif (15 min par défaut)
setInterval(() => {
  const now = Date.now();
  for (const rec of managed.values()) {
    if (rec.proc && !rec.busy && rec.lastTurnAt && now - rec.lastTurnAt > IDLE_PROC_TTL) {
      rec.intentionalKill = true; try { rec.proc.kill("SIGTERM"); } catch { /* */ }
    }
  }
}, 60 * 1000).unref();

function managedAgentObject(sid, m) {
  const status = m.busy ? "working" : (m.status === "failed" ? "failed" : "idle");
  return finalizeAgent({
    id: sid, name: m.name, role: m.role, kind: "managed", managed: true, perm: m.perm,
    teamId: m.teamId || null, teamGoal: m.teamGoal || null, teamName: m.teamName || null, chief: !!m.chief, training: !!m.training,
    status, room: m.training ? "gym" : (m.teamId ? "coworking" : assignRoom(status)),
    detail: m.error || m.lastResult || null, intent: m.lastPrompt || null,
    project: projectName(m.cwd), cwd: m.cwd, inFlightTasks: m.busy ? 1 : 0, queued: (m.queue && m.queue.length) || 0,
    childrenCount: 0, children: [], tempo: null, sessionStatus: m.status,
    busy: !!m.busy, denials: m.denials || 0, suggestion: m.suggestion || null, slashCommands: m.slashCommands || null, host: m.host || null,
    createdAt: m.startedAt, updatedAt: Date.now(), timeline: [],
    ...activityFields(sid),
  });
}

// Une salle par "mode".
//  - coworking : RÉSERVÉ aux ÉQUIPES (agents avec un teamId). Géré ailleurs, jamais ici :
//    un agent solo — même s'il délègue des sous-agents — reste à SON bureau.
//  - gym       : au repos, terminé, ou en file d'attente (récupération / apprentissage).
//  - bureau    : il bosse (par défaut), est bloqué, ou a échoué.
function assignRoom(status) {
  if (status === "idle" || status === "done" || status === "queued") return "gym";
  return "office";
}

function projectName(cwd) {
  if (!cwd) return "—";
  const base = path.basename(cwd);
  return base || cwd;
}

// busy / idle / ready ... -> vocabulaire UI
function mapSessionStatus(st) {
  st = String(st || "").toLowerCase();
  if (["busy", "running", "active", "working", "thinking"].includes(st)) return "working";
  if (["idle", "ready", "waiting", "paused", "input"].includes(st)) return "idle";
  return "idle";
}

function pidAlive(pid) {
  try {
    return !!pid && fs.existsSync(`/proc/${pid}`);
  } catch {
    return false;
  }
}

function childrenOf(job) {
  const c = job && Array.isArray(job.children) ? job.children : [];
  return c.map((x) => (typeof x === "string" ? x : x && (x.name || x.id))).filter(Boolean);
}

// Lit ~/.claude/sessions/*.json -> uniquement les sessions dont le process tourne.
function readSessions() {
  let files = [];
  try {
    files = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    const s = safeReadJSON(path.join(SESSIONS_DIR, f));
    if (!s || !s.sessionId) continue;
    if (s.pid && !pidAlive(s.pid)) continue; // session morte -> on l'ignore
    out.push(s);
  }
  return out;
}

// Lit ~/.claude/jobs/<id>/state.json -> Map indexée par sessionId.
function readJobs() {
  const map = new Map();
  let entries = [];
  try {
    entries = fs.readdirSync(JOBS_DIR, { withFileTypes: true });
  } catch {
    return map;
  }
  for (const ent of entries) {
    if (!ent.isDirectory() || ent.name.startsWith(".")) continue;
    const dir = path.join(JOBS_DIR, ent.name);
    const job = safeReadJSON(path.join(dir, "state.json"));
    if (!job) continue;
    map.set(job.sessionId || ent.name, { job, dir, short: ent.name });
  }
  return map;
}

function finalizeAgent(a) {
  const now = Date.now();
  a.ageMs = now - (a.createdAt || now);
  a.sinceUpdateMs = now - (a.updatedAt || now);
  return a;
}

// Agent dérivé d'une session live (enrichi par son job de fond si présent).
function agentFromSession(s, jobEntry) {
  const job = jobEntry && jobEntry.job;
  const kind = s.kind === "bg" ? "bg" : "interactive";
  const inFlight = job && job.inFlight ? job.inFlight.tasks || 0 : 0;
  const children = childrenOf(job);
  let status = job ? normalizeState(job) : mapSessionStatus(s.status);
  // la session LIVE prime : si elle travaille en ce moment, l'état "done" périmé du job ne doit pas l'envoyer au gym
  if (mapSessionStatus(s.status) === "working" && status !== "blocked" && status !== "failed") status = "working";
  // Une session interactive n'écrit pas de statut "busy" dans son fichier -> elle paraîtrait
  // toujours "idle" (donc au gym). On déduit l'activité du transcript : un outil utilisé il y a
  // moins de 2 min => l'agent BOSSE -> à son bureau (ex. Max qui code seul).
  if (kind === "interactive" && status !== "blocked" && status !== "failed") {
    const act = readActivity(s.sessionId);
    const lastAt = act.events.length ? Date.parse(act.events[act.events.length - 1].at) : 0;
    if (lastAt && Date.now() - lastAt < 120000) status = "working";
  }
  return finalizeAgent({
    id: s.sessionId,
    name: s.name || (job && job.name) || projectName(s.cwd),
    role: kind === "bg" ? s.agent || (job && job.template) || "claude" : "interactif",
    kind,
    status,
    room: assignRoom(status),
    detail: job ? (job.detail || "").trim() || null : null,
    intent: job ? (job.intent || "").trim() || null : null,
    project: projectName(s.cwd),
    cwd: s.cwd || null,
    inFlightTasks: inFlight,
    queued: job && job.inFlight ? job.inFlight.queued || 0 : 0,
    childrenCount: children.length,
    children,
    tempo: job ? job.tempo || null : null,
    sessionStatus: s.status || null,
    createdAt: s.startedAt || (job && Date.parse(job.createdAt)) || Date.now(),
    updatedAt: s.updatedAt || (job && Date.parse(job.updatedAt)) || Date.now(),
    timeline: jobEntry ? readLastTimeline(jobEntry.dir) : [],
    ...activityFields(s.sessionId),
  });
}

// Agent dérivé d'un job de fond sans session live (ex: bg récemment terminé).
function agentFromJob(entry) {
  const { job, dir, short } = entry;
  const status = normalizeState(job);
  const inFlight = (job.inFlight && job.inFlight.tasks) || 0;
  const children = childrenOf(job);
  return finalizeAgent({
    id: job.sessionId || short,
    name: job.name || short,
    role: job.template || "claude",
    kind: "bg",
    status,
    room: assignRoom(status),
    detail: (job.detail || "").trim() || null,
    intent: (job.intent || "").trim() || null,
    project: projectName(job.cwd),
    cwd: job.cwd || null,
    inFlightTasks: inFlight,
    queued: (job.inFlight && job.inFlight.queued) || 0,
    childrenCount: children.length,
    children,
    tempo: job.tempo || null,
    sessionStatus: null,
    createdAt: job.createdAt ? Date.parse(job.createdAt) : Date.now(),
    updatedAt: job.updatedAt ? Date.parse(job.updatedAt) : Date.now(),
    timeline: readLastTimeline(dir),
    ...activityFields(job.sessionId || short),
  });
}

// === MULTI-NŒUD : agrège les sessions Claude de TOUS les nœuds tailnet (via SSH, async) ===
// Permet de voir dans le bureau les agents qui tournent sur d'autres nœuds du tailnet,
// pas seulement ceux de la machine qui héberge l'orchestrateur.
const REMOTE_SCAN_TTL = 5000;
// Nœuds infra/proxy/services SANS agents Claude : on ne les scanne pas (évite SSH muets/hung).
// Surchargeable via FLEET_SCAN_SKIP="hostA,hostB,…" (liste de hosts Tailscale à ignorer).
const REMOTE_SCAN_SKIP = new Set(
  (process.env.FLEET_SCAN_SKIP || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);
// commande distante : sort le JSON de chaque session dont le process est encore vivant (pid dans /proc)
// Remonte les sessions VIVANTES + DORMANTES récentes (<6h), avec un flag _alive (pid dans /proc).
// Les dormantes (terminal quitté) sont reprenables depuis l'app -> handoff PC<->tel.
const REMOTE_SESS_CMD = `python3 -c 'import json,glob,os,time
now=time.time(); seen=set()
for f in glob.glob(os.path.expanduser("~/.claude/sessions/*.json")):
    try: s=json.load(open(f))
    except Exception: continue
    sid=s.get("sessionId")
    if not sid: continue
    pid=s.get("pid"); s["_alive"]=bool(pid) and os.path.isdir("/proc/"+str(pid))
    seen.add(sid); print(json.dumps(s))
tx=[p for p in glob.glob(os.path.expanduser("~/.claude/projects/**/*.jsonl"),recursive=True) if now-os.path.getmtime(p)<=604800]
bydir={}
for p in tx:
    d=os.path.dirname(p)
    if d not in bydir or os.path.getmtime(p)>os.path.getmtime(bydir[d]): bydir[d]=p
for f in sorted(bydir.values(),key=os.path.getmtime,reverse=True)[:25]:
    sid=os.path.basename(f)[:-6]
    if sid in seen: continue
    seen.add(sid); cwd=""; n=0
    try:
        fh=open(f)
        for line in fh:
            n+=1
            if n>40: break
            line=line.strip()
            if not line: continue
            try: o=json.loads(line)
            except Exception: continue
            if o.get("cwd"): cwd=o["cwd"]; break
        fh.close()
    except Exception: pass
    print(json.dumps({"sessionId":sid,"_alive":False,"cwd":cwd,"kind":"interactive","updatedAt":int(os.path.getmtime(f)*1000)}))'`;
const _remoteSessionHost = new Map(); // sessionId -> host (pour lire le transcript distant)
const REMOTE_HOST_TTL = 20000;        // un nœud muet (SSH KO/hung) est évincé du roster après 20s
const _remoteByHost = new Map();      // hostId -> { at, agents }  (cache indépendant par nœud)
const _remoteHostBusy = new Map();    // hostId -> bool             (SSH en vol pour ce nœud)
let _remoteSweepAt = 0;
function remoteAgentObj(s, host) {
  const kind = s.kind === "bg" ? "bg" : "interactive";
  const alive = s._alive !== false; // dormante si _alive explicitement false
  let status = mapSessionStatus(s.status);
  const upd = s.updatedAt || s.startedAt || 0;
  if (alive && kind === "interactive" && status !== "blocked" && status !== "failed" && upd && Date.now() - upd < 120000) status = "working";
  if (!alive) status = "idle"; // dormante = au repos, reprenable (handoff PC<->tel)
  return finalizeAgent({
    id: s.sessionId, name: s.name || projectName(s.cwd), role: kind === "bg" ? (s.agent || "claude") : "interactif",
    kind, status, room: assignRoom(status), project: projectName(s.cwd), cwd: s.cwd || null, host,
    sessionStatus: s.status || null, createdAt: s.startedAt || Date.now(), updatedAt: upd || Date.now(),
    children: [], childrenCount: 0, timeline: [], remote: true, dormant: !alive, resumable: !alive,
  });
}
// Scan d'UN nœud, isolé des autres : un SSH muet/hung ne bloque plus jamais le roster global.
function scanOneHost(h) {
  if (_remoteHostBusy.get(h.id)) return;            // déjà un SSH en vol pour ce nœud
  _remoteHostBusy.set(h.id, true);
  // `timeout -k 5 10` garantit la mort du ssh (SIGKILL) même s'il ignore SIGTERM
  // (Tailscale-SSH en mode "check" qui attend une auth navigateur, nœud sans sshd, etc.).
  const cmd = "timeout -k 5 10 ssh " + SSH_OPTS.join(" ") + " " + shq(h.id) + " " + shq(REMOTE_SESS_CMD);
  exec(cmd, { timeout: 15000, killSignal: "SIGKILL", maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
    _remoteHostBusy.set(h.id, false);
    if (!err && stdout) {
      const agents = [];
      for (const line of stdout.split("\n")) {
        const t = line.trim(); if (!t) continue;
        try { const s = JSON.parse(t); if (s && s.sessionId) { _remoteSessionHost.set(s.sessionId, h.id); agents.push(remoteAgentObj(s, h.id)); } } catch {}
      }
      _remoteByHost.set(h.id, { at: Date.now(), agents });
    } else {
      // injoignable : on conserve l'ancien cache jusqu'à expiration TTL, puis on l'évince (host vide).
      const prev = _remoteByHost.get(h.id);
      if (!prev || Date.now() - prev.at > REMOTE_HOST_TTL) _remoteByHost.set(h.id, { at: Date.now(), agents: [] });
    }
  });
}
function refreshRemoteAgents() {
  _remoteSweepAt = Date.now();
  const hosts = listHosts().filter((h) => h.id !== "local" && h.online && !REMOTE_SCAN_SKIP.has(h.id));
  for (const h of hosts) scanOneHost(h); // chaque nœud est lancé indépendamment (pas de barrière commune)
}
function scanRemoteAgents() {
  if (Date.now() - _remoteSweepAt > REMOTE_SCAN_TTL) refreshRemoteAgents(); // relance async, renvoie le cache courant
  // agrège les caches frais de chaque nœud, en évinçant ceux muets depuis > TTL
  const now = Date.now(), all = [];
  for (const [, rec] of _remoteByHost) {
    if (now - rec.at > REMOTE_HOST_TTL) continue;
    for (const a of rec.agents) all.push(a);
  }
  const live = all.filter((a) => !a.dormant);
  const dorm = all.filter((a) => a.dormant).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 10);
  return [...live, ...dorm];
}

// Fusionne toutes les sessions Claude Code vivantes + les jobs de fond.
function scanAgents() {
  const jobs = readJobs();
  const sessions = readSessions();
  const bySession = new Map();

  for (const s of sessions) {
    bySession.set(s.sessionId, agentFromSession(s, jobs.get(s.sessionId)));
  }
  // jobs sans session vivante (terminés mais dossier encore là)
  for (const [sid, entry] of jobs) {
    if (bySession.has(sid)) continue;
    bySession.set(sid, agentFromJob(entry));
  }
  // agents pilotés par l'orchestrateur (bidirectionnel)
  for (const [sid, m] of managed) {
    if (bySession.has(sid)) {
      const a = bySession.get(sid);
      a.managed = true; a.perm = m.perm; a.busy = !!m.busy; a.training = !!m.training; a.host = m.host || null;
      a.suggestion = m.suggestion || null; a.slashCommands = m.slashCommands || a.slashCommands || null;
      a.name = m.name; a.role = m.role; // nom/rôle managés font foi (équipe, chef 👑…)
      a.cwd = m.cwd; a.project = projectName(m.cwd); // cwd piloté (cd) fait foi
      // dès qu'on a piloté l'agent, son état « busy » fait foi (sinon on garde l'activité déduite du transcript externe)
      if (m.busy || m.everStarted) a.status = m.busy ? "working" : (m.status === "failed" ? "failed" : "idle");
      a.room = m.training ? "gym" : (m.teamId ? "coworking" : assignRoom(a.status));
      if (m.teamId) { a.teamId = m.teamId; a.teamGoal = m.teamGoal; a.teamName = m.teamName; a.chief = !!m.chief; }
    } else bySession.set(sid, managedAgentObject(sid, m));
  }

  // sessions distantes (tous les nœuds tailnet) — sans écraser les locales/managées
  for (const a of scanRemoteAgents()) { if (!bySession.has(a.id)) bySession.set(a.id, a); }
  for (const id of hidden) { if (!managed.has(id)) bySession.delete(id); } // masquées via kill (jamais les managés)

  const agents = [...bySession.values()];
  agents.sort((a, b) => b.updatedAt - a.updatedAt); // plus récents d'abord
  return { agents, jobsDir: JOBS_DIR, sessionsDir: SESSIONS_DIR, error: null };
}

function snapshot() {
  const { agents, jobsDir, sessionsDir, error } = scanAgents();
  const counts = { office: 0, coworking: 0, gym: 0 };
  const byStatus = { working: 0, blocked: 0, done: 0, idle: 0, queued: 0, failed: 0 };
  let tokens = 0, costUsd = 0, subagents = 0;
  const branches = new Set();
  for (const a of agents) {
    // skills par métier dès qu'un agent devient inactif (transition -> idle)
    const prev = lastStatusSkills.get(a.id);
    if ((a.status === "idle" || a.status === "done") && prev && prev !== "idle" && prev !== "done") researchSkills(a.role);
    lastStatusSkills.set(a.id, a.status);
    counts[a.room] = (counts[a.room] || 0) + 1;
    byStatus[a.status] = (byStatus[a.status] || 0) + 1;
    tokens += a.tokens || 0;
    costUsd += a.costUsd || 0;
    subagents += a.childrenCount || 0;
    if (a.gitBranch) branches.add(a.gitBranch);
  }
  // équipes existantes (pour greffer un agent depuis l'UI)
  const teamMap = {};
  for (const a of agents) if (a.teamId) {
    const t = (teamMap[a.teamId] = teamMap[a.teamId] || { id: a.teamId, name: a.teamName || a.teamGoal || ("Équipe " + a.teamId), goal: a.teamGoal || null, members: [], chief: null, chiefId: null, _st: [] });
    t.members.push(a.name); t._st.push(a.status);
    if (a.chief) { t.chief = a.name; t.chiefId = a.id; }
  }
  const teams = Object.values(teamMap).map((t) => {
    const awaitingDecision = t._st.length > 0 && t._st.every((s) => s === "idle" || s === "done" || s === "failed"); // tâche finie -> en attente de la décision humaine
    delete t._st; return { ...t, awaitingDecision };
  });
  return {
    at: Date.now(),
    jobsDir,
    sessionsDir,
    error,
    total: agents.length,
    counts,
    byStatus,
    cto: { tokens, costUsd: +costUsd.toFixed(4), subagents, branches: [...branches] },
    allowUnsafe: ALLOW_UNSAFE,
    teams,
    agents,
  };
}

// ---------------------------------------------------------------------------
// SSE : diffusion temps réel
// ---------------------------------------------------------------------------

const clients = new Set();
let lastSerialized = "";

function broadcast(force = false) {
  const snap = snapshot();
  const serialized = JSON.stringify(snap);
  if (!force && serialized === lastSerialized) return; // rien n'a changé
  lastSerialized = serialized;
  const payload = `event: snapshot\ndata: ${serialized}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }
}

setInterval(() => broadcast(false), SCAN_INTERVAL_MS);
// heartbeat pour garder les connexions SSE ouvertes derrière les proxies
setInterval(() => {
  for (const res of clients) {
    try {
      res.write(": ping\n\n");
    } catch {
      clients.delete(res);
    }
  }
}, 15000);

// ---------------------------------------------------------------------------
// Serveur HTTP statique + endpoints
// ---------------------------------------------------------------------------

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function serveStatic(req, res, urlPath) {
  // empêche le path traversal
  const rel = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, "");
  let filePath = path.join(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  // Routage de la page d'accueil par nom d'hôte (les proxies Tailscale pointent tous vers
  // ce même backend :4173, mais socat préserve l'en-tête Host) :
  //   http://fleetoffice    → console légère (lite.html, sans WebGL)
  //   http://fleetoffice3d  → bureau 3D (index.html)
  //   autres hôtes (orchestratorbe, IP, localhost) → bureau 3D par défaut
  // Chemins explicites /3d et /lite pour forcer l'une ou l'autre quel que soit l'hôte.
  const reqHost = (req.headers.host || "").toLowerCase();
  if (urlPath === "/3d" || urlPath === "/3d/") filePath = path.join(PUBLIC_DIR, "index.html");
  else if (urlPath === "/lite" || urlPath === "/lite/") filePath = path.join(PUBLIC_DIR, "lite.html");
  else if (urlPath === "/" || urlPath === "") {
    const liteHost = reqHost.startsWith("fleetoffice") && !reqHost.startsWith("fleetoffice3d");
    filePath = path.join(PUBLIC_DIR, liteHost ? "lite.html" : "index.html");
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("404 — introuvable");
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = ""; req.on("data", (c) => { b += c; if (b.length > 16e6) req.destroy(); }); // images permises
    req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
  });
}
function sendJSON(res, code, obj) { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache" }); res.end(JSON.stringify(obj)); }
// sauve une image collée (data URL) -> fichier, renvoie le chemin (pour la passer à l'agent)
function saveImage(dataUrl) {
  const m = /^data:(image\/(png|jpe?g|webp|gif));base64,(.+)$/i.exec(dataUrl || "");
  if (!m) return null;
  const ext = m[2].toLowerCase().replace("jpeg", "jpg");
  const dir = path.join(os.tmpdir(), "fleet-uploads"); fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, crypto.randomUUID() + "." + ext);
  fs.writeFileSync(fp, Buffer.from(m[3], "base64"));
  return fp;
}

// === PIÈCES JOINTES — relais universel orchestrateur → machine RÉELLE de l'agent =========
// Problème : un agent peut tourner sur n'importe quel nœud ; il n'y a donc pas de dossier
// partagé unique. Solution : l'orchestrateur (qui a déjà un SSH/SCP par clé vers chaque nœud)
// REÇOIT le fichier (upload streamé sur disque), puis le LIVRE dans l'inbox de la session,
// SUR LA MACHINE de l'agent :  ~/.fleet/inbox/<sessionId>/<fichier>
//   - agent local  → simple copie ;  agent distant → scp via SSH_OPTS.
// Le prompt reçoit le CHEMIN ABSOLU côté agent. Agnostique au type de fichier (octets bruts).
const UPLOAD_DIR = path.join(os.tmpdir(), "fleet-uploads");
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch {}
const uploads = new Map(); // uploadId -> { path, name, size, at }
const UPLOAD_MAX = parseInt(process.env.FLEET_UPLOAD_MAX || String(300 * 1024 * 1024), 10); // 300 Mo
const UPLOAD_TTL = 6 * 3600e3; // purge des uploads non consommés au bout de 6 h
function fmtSize(n) { n = n || 0; return n >= 1048576 ? (n / 1048576).toFixed(1) + " Mo" : n >= 1024 ? Math.round(n / 1024) + " Ko" : n + " o"; }
function sanitizeName(n) {
  n = path.basename(String(n || "fichier")).replace(/[/\\\x00-\x1f]/g, "_").replace(/^\.+/, "_").trim();
  return n.slice(0, 180) || "fichier";
}
setInterval(() => {
  const now = Date.now();
  for (const [id, u] of uploads) if (now - u.at > UPLOAD_TTL) { try { fs.rmSync(u.path, { force: true }); } catch {} uploads.delete(id); }
}, 30 * 60e3).unref?.();

// POST /api/upload : body = octets bruts du fichier ; nom dans l'en-tête X-Filename (URL-encodé).
// Un fichier par requête (l'UI en envoie plusieurs en parallèle). Renvoie { uploadId, name, size }.
function handleUpload(req, res) {
  const name = sanitizeName(decodeURIComponent(req.headers["x-filename"] || "fichier"));
  const uploadId = crypto.randomUUID();
  const dest = path.join(UPLOAD_DIR, uploadId + "__" + name);
  const ws = fs.createWriteStream(dest);
  let size = 0, killed = false;
  req.on("data", (c) => { size += c.length; if (size > UPLOAD_MAX && !killed) { killed = true; ws.destroy(); try { req.destroy(); } catch {} try { fs.rmSync(dest, { force: true }); } catch {} sendJSON(res, 413, { ok: false, error: "fichier trop volumineux (> " + fmtSize(UPLOAD_MAX) + ")" }); } });
  req.on("error", () => { try { ws.destroy(); } catch {} });
  ws.on("error", () => { if (!res.headersSent) sendJSON(res, 500, { ok: false, error: "écriture échouée" }); });
  ws.on("finish", () => { if (killed) return; uploads.set(uploadId, { path: dest, name, size, at: Date.now() }); sendJSON(res, 200, { ok: true, uploadId, name, size }); });
  req.pipe(ws);
}

// data-URL (collage/legacy b.image) → entrée dans le registre uploads (réutilise le même pipeline).
function stageDataUrl(dataUrl, fallbackName) {
  const m = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(dataUrl || "");
  if (!m) return null;
  const mime = m[1] || "application/octet-stream";
  const buf = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]));
  const ext = (mime.split("/")[1] || "bin").replace(/[^a-z0-9]/gi, "").slice(0, 8) || "bin";
  const name = sanitizeName(fallbackName || ("collage." + ext));
  const id = crypto.randomUUID();
  const dest = path.join(UPLOAD_DIR, id + "__" + name);
  fs.writeFileSync(dest, buf);
  uploads.set(id, { path: dest, name, size: buf.length, at: Date.now() });
  return id;
}

// $HOME distant (pour bâtir un chemin absolu côté agent), caché par hôte.
const _remoteHome = new Map();
function remoteHome(host) {
  if (_remoteHome.has(host)) return _remoteHome.get(host);
  let h = "";
  try { h = execSync("ssh " + SSH_OPTS.join(" ") + " " + shq(host) + " " + shq("echo $HOME"), { encoding: "utf8", timeout: 9000 }).trim(); } catch {}
  if (h) _remoteHome.set(host, h);
  return h;
}
function uniqueLocal(dir, name) {
  let dest = path.join(dir, name);
  if (!fs.existsSync(dest)) return dest;
  const ext = path.extname(name), base = ext ? name.slice(0, -ext.length) : name;
  let i = 1; while (fs.existsSync(path.join(dir, base + "-" + i + ext))) i++;
  return path.join(dir, base + "-" + i + ext);
}
// Livre les pièces jointes (liste d'uploadIds) dans ~/.fleet/inbox/<sessionId> SUR la machine de
// l'agent. Renvoie [{ name, size, absPath }] (absPath = chemin absolu côté agent, pour le prompt).
function deliverAttachments(sessionId, uploadIds, host) {
  const items = (uploadIds || []).map((id) => uploads.get(id)).filter(Boolean);
  if (!items.length) return [];
  const remote = !!(host && host !== "local");
  const rel = ".fleet/inbox/" + sessionId;
  const out = [];
  if (!remote) {
    const inbox = path.join(os.homedir(), rel);
    fs.mkdirSync(inbox, { recursive: true });
    for (const u of items) { const dest = uniqueLocal(inbox, u.name); fs.copyFileSync(u.path, dest); out.push({ name: path.basename(dest), size: u.size, absPath: dest }); }
  } else {
    const home = remoteHome(host);
    execSync("ssh " + SSH_OPTS.join(" ") + " " + shq(host) + " " + shq("mkdir -p " + rel), { timeout: 12000 });
    for (const u of items) {
      const remoteRel = rel + "/" + u.name;
      execSync("scp " + SSH_OPTS.join(" ") + " " + shq(u.path) + " " + shq(host + ":" + remoteRel), { timeout: 180000 });
      out.push({ name: u.name, size: u.size, absPath: (home ? home + "/" + remoteRel : "~/" + remoteRel) });
    }
  }
  for (const id of uploadIds) { const u = uploads.get(id); if (u) { try { fs.rmSync(u.path, { force: true }); } catch {} uploads.delete(id); } }
  return out;
}
// Bloc texte ajouté au prompt pour pointer l'agent vers les fichiers livrés sur SA machine.
function attachBlock(items) {
  if (!items || !items.length) return "";
  return "\n\n📎 Pièces jointes (déposées sur TA machine — lis-les à ce chemin EXACT) :\n" +
    items.map((f) => `- ${f.absPath}  (${fmtSize(f.size)})`).join("\n");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  // CORS : l'app mobile (autre origine, via Tailscale) doit pouvoir appeler l'API + SSE
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Filename");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

  // ---- upload de pièce jointe (body streamé, AVANT tout readBody) ----
  if (req.method === "POST" && p === "/api/upload") { return handleUpload(req, res); }

  // ---- orchestrateur (bidirectionnel) ----
  if (p === "/api/hosts") { return sendJSON(res, 200, { hosts: listHosts() }); }
  if (p === "/api/roles" && req.method !== "POST") { return sendJSON(res, 200, { roles: allRoles() }); }
  if (req.method === "POST" && p === "/api/roles") {
    const b = await readBody(req);
    try { return sendJSON(res, 200, { ok: true, roles: addRole(b.role) }); }
    catch (e) { return sendJSON(res, 400, { ok: false, error: String(e.message || e) }); }
  }
  if (req.method === "POST" && p === "/api/spawn") {
    const b = await readBody(req);
    try { const id = spawnAgent(b); broadcast(true); return sendJSON(res, 200, { ok: true, id }); }
    catch (e) { return sendJSON(res, 400, { ok: false, error: String(e.message || e) }); }
  }
  if (req.method === "POST" && p === "/api/team") {
    const b = await readBody(req);
    try { const r = spawnTeam(b); broadcast(true); return sendJSON(res, 200, { ok: true, ...r }); }
    catch (e) { return sendJSON(res, 400, { ok: false, error: String(e.message || e) }); }
  }
  if (req.method === "POST" && p === "/api/send") {
    const b = await readBody(req);
    try {
      let prompt = b.prompt || "";
      const rec = ensureManaged(b.id); if (!rec) throw new Error("session introuvable");
      // Pièces jointes : livrées sur la machine de l'agent.
      const ids = Array.isArray(b.attachments) ? b.attachments.slice() : [];
      if (b.image) { const u = stageDataUrl(b.image); if (u) ids.push(u); } // legacy/collage
      if (ids.length) prompt += attachBlock(deliverAttachments(b.id, ids, rec.host));
      // Sync multi-appareils : journalise les messages app → session adoptée (vit aussi en terminal).
      if (rec.adopted) appendSyncLog(rec, b.prompt || "", b.origin);
      sendAgent(b.id, prompt); broadcast(true); return sendJSON(res, 200, { ok: true });
    } catch (e) { return sendJSON(res, 400, { ok: false, error: String(e.message || e) }); }
  }
  if (req.method === "POST" && p === "/api/kill") {
    const b = await readBody(req); const ok = killAgent(b.id); broadcast(true); return sendJSON(res, 200, { ok });
  }
  if (req.method === "POST" && p === "/api/team-kill") {
    const b = await readBody(req);
    const ids = [...managed.values()].filter((m) => m.teamId === b.teamId).map((m) => m.id);
    ids.forEach((id) => killAgent(id)); broadcast(true);
    return sendJSON(res, 200, { ok: true, killed: ids.length });
  }
  if (req.method === "POST" && p === "/api/train") {
    const b = await readBody(req);
    try { trainAgent(b.id); broadcast(true); return sendJSON(res, 200, { ok: true }); }
    catch (e) { return sendJSON(res, 400, { ok: false, error: String(e.message || e) }); }
  }
  if (req.method === "POST" && p === "/api/cd") {
    const b = await readBody(req);
    try { cdAgent(b.id, b.cwd); broadcast(true); return sendJSON(res, 200, { ok: true }); }
    catch (e) { return sendJSON(res, 400, { ok: false, error: String(e.message || e) }); }
  }
  if (req.method === "POST" && p === "/api/stop") {
    const b = await readBody(req);
    const ok = stopAgent(b.id); return sendJSON(res, 200, { ok });
  }

  if (p === "/api/ls") {
    let dir = url.searchParams.get("path") || os.homedir();
    try {
      dir = path.resolve(dir);
      if (!fs.statSync(dir).isDirectory()) dir = path.dirname(dir);
      const dirs = fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => { try { return e.isDirectory() && !e.name.startsWith("."); } catch { return false; } })
        .map((e) => e.name).sort().slice(0, 500);
      const parent = path.dirname(dir);
      return sendJSON(res, 200, { path: dir, parent: parent === dir ? null : parent, home: os.homedir(), dirs });
    } catch (e) { return sendJSON(res, 400, { error: String(e.message || e), path: dir }); }
  }

  if (p === "/api/transcript") {
    const id = url.searchParams.get("id") || "";
    const n = Math.min(parseInt(url.searchParams.get("n") || "50", 10) || 50, 120);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache" });
    return res.end(JSON.stringify({ id, feed: renderTranscript(id, n) }));
  }

  if (p === "/api/agents") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache" });
    return res.end(JSON.stringify(snapshot()));
  }

  if (p === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("retry: 2000\n\n");
    res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  return serveStatic(req, res, p);
});

// ---------------------------------------------------------------------------
// Intendant du bureau — agent permanent lancé au démarrage.
// Administre le Fleet Office (surveille la flotte, tient un journal, propose &
// implémente prudemment des évolutions). Remplace l'ancien "zombie" accidentel
// par un agent réel et utile. Désactivable avec FLEET_ADMIN_AGENT=0.
// ---------------------------------------------------------------------------
const ADMIN_NAME = "Intendant 🏢";
const ADMIN_ROLE = "Intendant du bureau";
const ADMIN_MODEL = process.env.FLEET_ADMIN_MODEL || "sonnet";
const ADMIN_STATE = path.join(__dirname, ".admin-agent.json"); // reprise au redémarrage

function adminMission(cwd) {
  return `Tu es l'INTENDANT du Fleet Office 🏢 — l'agent permanent qui administre ce bureau virtuel d'agents et veille à son évolution. Workspace : ${cwd} (le code du Fleet Office lui-même).

Ta mission permanente :
1. Bonne tenue du bureau : surveille la flotte via GET http://127.0.0.1:${PORT}/api/agents. Repère les agents bloqués, en échec, ou les jobs zombies orphelins, et signale-les.
2. Journal de bord : tiens « OFFICE_LOG.md » à la racine du workspace (état des lieux, incidents, décisions, idées d'évolution).
3. Évolution du bureau : propose puis, avec prudence, implémente des améliorations du Fleet Office (server.js / public) — fiabilité, ergonomie, nouvelles salles, etc.
4. Disponibilité : à la fin d'une passe, résume dans OFFICE_LOG.md et attends de nouvelles instructions.

RÈGLE NON NÉGOCIABLE : aucune action critique (merge sur main, suppression massive, push, déploiement) sans validation humaine explicite.

Commence par lire cahier-des-charges.md et README.md, fais un état des lieux de la flotte, puis écris ta première entrée dans OFFICE_LOG.md.`;
}

// Un intendant est-il déjà présent (dans ce process) ?
function adminAlreadyManaged() {
  for (const m of managed.values()) if (m.admin) return true;
  return false;
}

function spawnAdminAgent() {
  const cwd = __dirname;
  const sessionId = crypto.randomUUID();
  managed.set(sessionId, {
    id: sessionId, name: ADMIN_NAME, role: ADMIN_ROLE, cwd,
    model: ADMIN_MODEL, perm: "acceptEdits", // édite le workspace, mais pas de push/merge/deploy auto
    status: "working", startedAt: Date.now(),
    lastPrompt: "Administration & évolution du bureau", costUsd: 0, admin: true,
  });
  runClaude({ sessionId, cwd, prompt: adminMission(cwd), model: ADMIN_MODEL, perm: "acceptEdits", resume: false });
  try { fs.writeFileSync(ADMIN_STATE, JSON.stringify({ sessionId, startedAt: Date.now() })); } catch { /* ignore */ }
  return sessionId;
}

// Au démarrage : reprend l'intendant d'une exécution précédente s'il tourne
// encore (persistance), sinon en lance un neuf.
function bootAdminAgent() {
  if (process.env.FLEET_ADMIN_AGENT === "0") { console.log("  ➜  intendant désactivé (FLEET_ADMIN_AGENT=0)\n"); return; }
  if (adminAlreadyManaged()) return;
  const saved = safeReadJSON(ADMIN_STATE);
  if (saved && saved.sessionId) {
    const live = readSessions().find((s) => s.sessionId === saved.sessionId && pidAlive(s.pid));
    if (live) {
      const rec = ensureManaged(saved.sessionId);
      if (rec) { rec.admin = true; rec.name = ADMIN_NAME; rec.role = ADMIN_ROLE; console.log(`  ➜  intendant repris : ${saved.sessionId}\n`); return; }
    }
  }
  const id = spawnAdminAgent();
  console.log(`  ➜  intendant lancé : ${ADMIN_NAME} (${ADMIN_MODEL}) — session ${id}\n`);
}

server.listen(PORT, HOST, () => {
  const snap = snapshot();
  const lan = getLanAddresses();
  console.log(`\n  🏢  Fleet Office en ligne`);
  console.log(`  ➜  http://localhost:${PORT}`);
  for (const addr of lan) console.log(`  ➜  http://${addr}:${PORT}`);
  console.log(`  ➜  jobs surveillés : ${JOBS_DIR}`);
  console.log(`  ➜  agents détectés au démarrage : ${snap.total}`);
  bootAdminAgent();
});
