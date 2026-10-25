#!/usr/bin/env node
"use strict";

/**
 * Fleet Office — serveur de visualisation des agents Claude Code.
 *
 * Node natif pour tout le reste ; 2 dépendances ciblées pour le terminal PTY (bouton ▹_) :
 * node-pty (vrai pseudo-terminal) + ws (WebSocket). Absentes ou en échec de chargement -> le
 * terminal se désactive proprement (le reste de l'app est inchangé, aucun crash).
 * - Scanne ~/.claude/jobs/<id>/state.json en continu
 * - Mappe chaque job sur un "agent" placé dans une salle (bureau / coworking / gym)
 * - Diffuse l'état en temps réel au navigateur via Server-Sent Events (/events)
 * - Sert le frontend 3D statique depuis ./public
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn, execSync, exec } = require("child_process");
const os = require("os");
let pty = null, WebSocketServer = null;
try { pty = require("node-pty"); } catch { /* terminal PTY indisponible sur ce nœud */ }
try { ({ WebSocketServer } = require("ws")); } catch { /* terminal websocket indisponible */ }

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
// Retire les blocs injectés par le harness dans les tours "user" (ne viennent pas de l'utilisateur) :
// <system-reminder>, wrappers de slash-commands, tags de contenu collé. Renvoie "" s'il ne reste rien.
function cleanPrompt(s) {
  return String(s || "")
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, "")
    .replace(/<command-(?:message|name|args)>[\s\S]*?<\/command-[^>]*>/gi, "")
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/gi, "")
    .replace(/<\/?pasted_content[^>]*>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
// coeur du parsing JSONL -> feed d'affichage (partagé entre le tail "live" et le chargement d'historique)
function parseTranscriptChunk(text) {
  const feed = [];
  for (const line of String(text || "").split("\n")) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const at = o.timestamp || null;
    if (o.type === "user" && o.message) {
      const c = o.message.content;
      if (typeof c === "string") { const t = cleanPrompt(c); if (t) feed.push({ kind: "prompt", text: clip(t, 20000), at }); }
      else if (Array.isArray(c)) for (const b of c) {
        if (b.type === "text") { const t = cleanPrompt(b.text); if (t) feed.push({ kind: "prompt", text: clip(t, 20000), at }); }
        else if (b.type === "tool_result") { const t = clip(resultText(b.content), 8000); if (t) feed.push({ kind: "result", text: t, at, err: b.is_error ? 1 : 0 }); }
      }
    } else if (o.type === "assistant" && o.message) {
      for (const b of (o.message.content || [])) {
        if (b.type === "text" && b.text.trim()) feed.push({ kind: "say", text: clip(b.text, 20000), at });
        else if (b.type === "thinking" && (b.thinking || "").trim()) feed.push({ kind: "think", text: clip(b.thinking, 8000), at });
        else if (b.type === "tool_use") { const inp = b.input || {}; feed.push({ kind: "tool", text: toolLine(b.name, b.input), at, name: b.name, arg: String(inp.skill || inp.file_path || inp.path || inp.command || "").slice(0, 160) }); }
      }
    }
  }
  return feed;
}
// Inchangée (utilisée par noteToVault) : tail des 256 Ko finaux, dernières n entrées.
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
  return parseTranscriptChunk(lines.join("\n")).slice(-n);
}

// --- lecture par FENÊTRE d'octets (pagination de l'historique, local + distant) ---
function readFileWindowLocal(p, endOffset, maxBytes) {
  const st = fs.statSync(p);
  const end = Math.min(endOffset == null ? st.size : endOffset, st.size);
  const start = Math.max(0, end - maxBytes);
  if (end <= start) return { text: "", start: end, end };
  const fd = fs.openSync(p, "r");
  const buf = Buffer.alloc(end - start);
  fs.readSync(fd, buf, 0, buf.length, start);
  fs.closeSync(fd);
  return { text: buf.toString("utf8"), start, end };
}
// Même chose à distance : une seule commande SSH renvoie taille+bornes (ligne "META start end")
// puis le corps, pour ne pas multiplier les allers-retours SSH.
function remoteTranscriptWindow(host, sid, endOffset, maxBytes) {
  const endExpr = endOffset == null ? "$SZ" : String(Math.max(0, endOffset | 0));
  const cmd = `f=$(find ~/.claude/projects -name ${sid}.jsonl 2>/dev/null | head -1); [ -z "$f" ] && exit 1; SZ=$(stat -c%s "$f" 2>/dev/null || echo 0); END=${endExpr}; [ "$END" -gt "$SZ" ] && END=$SZ; W=${maxBytes}; START=$((END>W?END-W:0)); echo "META $START $END"; [ "$END" -gt "$START" ] && tail -c +$((START+1)) "$f" | head -c $((END-START))`;
  let out;
  try { out = execSync("ssh " + SSH_OPTS.join(" ") + " " + shq(host) + " " + shq(cmd), { encoding: "utf8", timeout: 9000, maxBuffer: 8 * 1024 * 1024 }); }
  catch { return null; }
  const nl = out.indexOf("\n"); if (nl < 0) return null;
  const m = out.slice(0, nl).match(/^META (\d+) (\d+)/); if (!m) return null;
  return { text: out.slice(nl + 1), start: +m[1], end: +m[2] };
}
// Lit une fenêtre de 512 Ko se terminant à `beforeOffset` (ou à la fin du fichier si absent), la
// parse, et renvoie de quoi enchaîner un chargement plus ancien (`nextBefore`, offset propre =
// début d'une ligne complète) jusqu'à `atStart` (début du fichier atteint = plus d'historique).
function renderTranscriptWindow(sessionId, beforeOffset) {
  const mrec = managed.get(sessionId);
  const remoteHost = (mrec && isRemote(mrec)) ? mrec.host : _remoteSessionHost.get(sessionId);
  const p = remoteHost ? null : ((trackers.get(sessionId) || {}).path || findTranscript(sessionId));
  if (!remoteHost && !p) return { feed: [], nextBefore: null, atStart: true };
  const readWin = (bytes) => remoteHost
    ? remoteTranscriptWindow(remoteHost, sessionId, beforeOffset, bytes)
    : (() => { try { return readFileWindowLocal(p, beforeOffset, bytes); } catch { return null; } })();
  // certains transcripts contiennent une ligne géante (ex. un fichier/image lu -> gros blob base64
  // en une seule ligne JSON, parfois > 512 Ko) : si la fenêtre ne contient QUE la fin de cette
  // ligne (un seul \n, tout au bord), couper dessus ne laisse rien d'exploitable derrière -> le
  // curseur resterait bloqué. Il faut DEUX \n (le début d'une ligne complète, pas juste sa fin) ;
  // sinon on élargit la fenêtre (jusqu'à 16 Mo) pour dépasser la ligne géante.
  const MAX_WINDOW = 16 * 1024 * 1024;
  let win = null, bytes = 512 * 1024;
  for (;;) {
    win = readWin(bytes);
    if (!win || win.start <= 0 || bytes >= MAX_WINDOW) break;
    const nl1 = win.text.indexOf("\n");
    if (nl1 >= 0 && win.text.indexOf("\n", nl1 + 1) >= 0) break; // au moins 1 ligne complète après la coupe
    bytes *= 2;
  }
  if (!win) return { feed: [], nextBefore: null, atStart: true };
  let keptText = win.text, keptStart = win.start;
  if (win.start > 0) {
    const nl1 = win.text.indexOf("\n");
    const nl2 = nl1 >= 0 ? win.text.indexOf("\n", nl1 + 1) : -1;
    if (nl2 >= 0) { keptStart = win.start + Buffer.byteLength(win.text.slice(0, nl1), "utf8") + 1; keptText = win.text.slice(nl1 + 1); }
    else { keptText = ""; keptStart = win.start; } // ligne géante toujours incomplète même à 16 Mo (rarissime) :
    // on saute cette portion, mais keptStart = win.start (déjà repoussé par l'élargissement, TOUJOURS
    // < l'offset de départ) garantit que le curseur avance quand même — jamais bloqué.
  }
  const atStart = win.start <= 0;
  return { feed: parseTranscriptChunk(keptText), nextBefore: atStart ? null : keptStart, atStart };
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

// ---- PROVIDER AWS Bedrock (clés Askeal) : OPTION par agent, jamais le défaut -----------
// Anthropic (abonnement Claude Code) reste le provider par défaut. Si un agent est déployé
// avec provider:"bedrock" ET que ~/.fleet/bedrock.env existe, on injecte les creds AWS +
// CLAUDE_CODE_USE_BEDROCK=1 dans SON process (local ou distant), sans toucher aux autres.
const FLEET_DIR = path.join(os.homedir(), ".fleet");

// --- journal d'audit : qui a fait quoi, quand (spawn/kill/renommage/entraînement/équipe/skills) ---
// Buffer mémoire (rapide, servi tel quel) + fichier JSONL append-only (survit aux redémarrages).
const AUDIT_FILE = path.join(FLEET_DIR, "audit.log");
const AUDIT_MAX = 500;
let auditLog = [];
(function loadAuditLog() {
  try {
    const lines = fs.readFileSync(AUDIT_FILE, "utf8").split("\n").filter(Boolean).slice(-AUDIT_MAX);
    auditLog = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { /* pas encore de journal */ }
})();
function logAudit(action, details) {
  const e = { at: Date.now(), action, ...details };
  auditLog.push(e); if (auditLog.length > AUDIT_MAX) auditLog.shift();
  try { fs.mkdirSync(FLEET_DIR, { recursive: true }); fs.appendFileSync(AUDIT_FILE, JSON.stringify(e) + "\n"); } catch { /* jamais bloquant */ }
}

const BEDROCK_ENV_FILE = path.join(FLEET_DIR, "bedrock.env");
let _bedrockCache = { at: 0, env: null };
function bedrockEnv() {
  const now = Date.now();
  if (now - _bedrockCache.at < 30000) return _bedrockCache.env;
  let env = null;
  try {
    const raw = fs.readFileSync(BEDROCK_ENV_FILE, "utf8");
    env = {};
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) env = null;
  } catch { env = null; }
  _bedrockCache = { at: now, env };
  return env;
}
function bedrockAvailable() { return !!bedrockEnv(); }
// alias interne (opus/sonnet/haiku/fable) -> inference profile Bedrock (overridable dans bedrock.env)
function bedrockModelId(alias, benv) {
  const a = String(alias || "sonnet").toLowerCase();
  const K = (s) => "BEDROCK_MODEL_" + s.toUpperCase();
  for (const k of ["opus", "sonnet", "haiku", "fable"]) if (a.includes(k) && benv[K(k)]) return benv[K(k)];
  if (/^(us|eu|apac|global)\.anthropic\./.test(a) || /^anthropic\./.test(a)) return alias; // déjà un id complet
  return benv[K("sonnet")] || "us.anthropic.claude-sonnet-5";
}
// env d'un agent LOCAL : Anthropic (défaut) ou Bedrock si rec.provider === "bedrock"
function agentEnv(rec) {
  if (rec.provider !== "bedrock") return process.env;
  const benv = bedrockEnv();
  if (!benv) return process.env; // pas de clés -> on retombe proprement sur Anthropic
  const e = { ...process.env };
  delete e.ANTHROPIC_API_KEY; delete e.ANTHROPIC_AUTH_TOKEN; // évite le conflit avec l'abonnement
  delete e.AWS_PROFILE; // sinon le SDK AWS préfère le profil aux clés statiques injectées
  e.CLAUDE_CODE_USE_BEDROCK = "1";
  e.AWS_REGION = benv.AWS_REGION || "us-east-1";
  e.AWS_ACCESS_KEY_ID = benv.AWS_ACCESS_KEY_ID;
  e.AWS_SECRET_ACCESS_KEY = benv.AWS_SECRET_ACCESS_KEY;
  if (benv.AWS_SESSION_TOKEN) e.AWS_SESSION_TOKEN = benv.AWS_SESSION_TOKEN;
  e.ANTHROPIC_MODEL = bedrockModelId(rec.model, benv);
  e.ANTHROPIC_SMALL_FAST_MODEL = bedrockModelId("haiku", benv);
  return e;
}
// vars Bedrock à exporter pour un agent DISTANT (SSH) — injectées inline dans la commande
function bedrockExports(rec) {
  if (rec.provider !== "bedrock") return "";
  const benv = bedrockEnv(); if (!benv) return "";
  const kv = {
    CLAUDE_CODE_USE_BEDROCK: "1",
    AWS_REGION: benv.AWS_REGION || "us-east-1",
    AWS_ACCESS_KEY_ID: benv.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: benv.AWS_SECRET_ACCESS_KEY,
    ANTHROPIC_MODEL: bedrockModelId(rec.model, benv),
    ANTHROPIC_SMALL_FAST_MODEL: bedrockModelId("haiku", benv),
  };
  if (benv.AWS_SESSION_TOKEN) kv.AWS_SESSION_TOKEN = benv.AWS_SESSION_TOKEN;
  return Object.entries(kv).map(([k, v]) => "export " + k + "=" + shq(v) + ";").join(" ") + " unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN AWS_PROFILE;";
}

// ---- MÉMOIRE OBSIDIAN : quand un agent finit (gym/idle), on grave une note dans le vault ----
// Vault markdown (graphe + wikilinks) sur le nœud backend. Sync avec l'Obsidian de black-station
// à brancher ensuite (Syncthing). FLEET_VAULT override le chemin.
const VAULT_DIR = process.env.FLEET_VAULT || path.join(FLEET_DIR, "vault");
const vaultCooldown = new Map(); // id -> dernier write (ms)
function vslug(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "x"; }
function noteToVault(a) {
  try {
    const now = Date.now();
    if (now - (vaultCooldown.get(a.id) || 0) < 10 * 60 * 1000) return; // 1 note / 10 min / agent
    vaultCooldown.set(a.id, now);
    const proj = projectName(a.cwd) || "divers";
    const dir = path.join(VAULT_DIR, "projets", vslug(proj));
    fs.mkdirSync(dir, { recursive: true });
    const feed = renderTranscript(a.id, 40) || [];
    const lastSay = [...feed].reverse().find((e) => e.kind === "say");
    const tools = feed.filter((e) => e.kind === "tool").slice(-8).map((e) => "- " + e.text);
    const d = new Date(), stamp = d.toISOString().slice(0, 16).replace("T", " ");
    const base = vslug(a.name) + "-" + d.toISOString().slice(0, 10);
    const file = path.join(dir, base + ".md");
    const md = [
      "---",
      "agent: " + JSON.stringify(a.name || ""),
      "role: " + JSON.stringify(a.role || ""),
      "projet: " + JSON.stringify(proj),
      "machine: " + JSON.stringify(a.host || "local"),
      "modele: " + JSON.stringify(a.model || ""),
      "date: " + d.toISOString(),
      "tags: [fleet-office, agent, " + vslug(a.role || "agent") + "]",
      "---",
      "",
      "# " + (a.name || "Agent") + " — " + proj,
      "",
      "> Au repos le " + stamp + " · machine [[" + (a.host || "local") + "]] · projet [[" + proj + "]] · rôle #" + vslug(a.role || "agent"),
      "",
      "## Mission",
      (a.intent || a.lastPrompt || "—"),
      "",
      "## Résumé",
      (lastSay ? lastSay.text : (a.detail || "—")),
      "",
      "## Actions clés",
      (tools.length ? tools.join("\n") : "—"),
      "",
      "## Liens",
      "- Projet : [[" + proj + "]]",
      "- Rôle : [[" + (a.role || "agent") + "]]",
      "",
    ].join("\n");
    fs.writeFileSync(file, md);
    // MOC projet : note-hub avec un wikilink vers chaque note (le graphe se construit)
    const moc = path.join(dir, "_" + vslug(proj) + ".md");
    const link = "- [[" + base + "]] — " + stamp + " (" + (a.role || "agent") + ")\n";
    fs.appendFileSync(moc, fs.existsSync(moc) ? link : ("# " + proj + " — journal de bord\n\nNotes des agents Fleet Office (auto).\n\n" + link));
    vaultCommit(); // versionne (git) -> clone/pull partout
  } catch { /* jamais bloquant */ }
}

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
const SKILLS_FETCHER = path.join(__dirname, "skills_fetch.js"); // fetcher node (repos réputés -> notre dossier)
const skillCooldown = new Map(); // role -> dernier lancement (ms)
const lastStatusSkills = new Map(); // sessionId -> dernier statut connu (pour déclencher à l'inactivité)
function skillsFileFor(role) { return path.join(SKILLS_DIR, String(role).toLowerCase().replace(/[^a-z0-9]+/gi, "_") + ".md"); }
function researchSkills(role, host, force) {
  role = String(role || "").trim(); if (!role) return;
  const installHost = (host && host !== "local") ? host : "local";
  const key = role.toLowerCase() + "@" + installHost, now = Date.now();
  if (!force && now - (skillCooldown.get(key) || 0) < 30 * 60 * 1000) return; // 1 passage / 30 min / (métier,hôte) — sauté si déclenché explicitement
  skillCooldown.set(key, now);
  try {
    fs.mkdirSync(SKILLS_DIR, { recursive: true });
    if (!fs.existsSync(SKILLS_FETCHER)) return;
    // télécharge + range + installe les skills du métier (dans ~/.claude/skills du nœud de l'agent)
    const p = spawn(process.execPath, [SKILLS_FETCHER, role, skillsFileFor(role), SKILLS_DIR, installHost], { cwd: __dirname, stdio: "ignore", detached: true });
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
  let model = rec.model || "sonnet";
  if (rec.provider === "bedrock") { const benv = bedrockEnv(); if (benv) model = bedrockModelId(rec.model, benv); }
  const args = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
    "--prompt-suggestions=true", "--model", model, "--permission-mode", perm];
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

// --- métriques machine (volet contexte) : CPU/RAM/disque + Tailscale, en cache 15 s -------
const _hostCache = new Map(); // name -> { at, val }
const HOST_PROBE = 'l=$(cut -d" " -f1 /proc/loadavg); n=$(nproc); ' +
  'm=$(free -m 2>/dev/null | awk "/Mem:/{print \\$3\\\":\\\"\\$2}"); ' +
  'd=$(df -P / 2>/dev/null | awk "NR==2{print \\$5\\\":\\\"\\$3\\\":\\\"\\$4}"); ' +
  'ip=$(tailscale ip -4 2>/dev/null | head -1); ' +
  'up=$(cut -d. -f1 /proc/uptime); ' +
  'echo "L=$l N=$n M=$m D=$d IP=$ip UP=$up"';
function parseHostProbe(name, out) {
  const g = (re) => { const m = String(out || "").match(re); return m ? m[1] : ""; };
  const load = parseFloat(g(/L=([\d.]+)/)) || 0;
  const ncpu = parseInt(g(/N=(\d+)/), 10) || 1;
  const mem = g(/M=(\d+:\d+)/).split(":").map(Number);
  const disk = g(/D=(\d+%?:\d+:\d+)/).split(":");
  const memUsed = mem[0] || 0, memTotal = mem[1] || 0;
  const diskPct = parseInt(disk[0], 10) || 0, diskUsed = parseInt(disk[1], 10) || 0, diskFree = parseInt(disk[2], 10) || 0;
  return {
    name, online: !!out,
    cpuPct: Math.min(100, Math.round((load / ncpu) * 100)), load, ncpu,
    memPct: memTotal ? Math.round((memUsed / memTotal) * 100) : 0, memUsedMb: memUsed, memTotalMb: memTotal,
    diskPct, diskUsedKb: diskUsed, diskFreeKb: diskFree,
    tsip: g(/IP=([\d.]+)/) || null, uptimeS: parseInt(g(/UP=(\d+)/), 10) || 0,
  };
}
function hostMetrics(name) {
  name = name || "local";
  const now = Date.now(); const c = _hostCache.get(name);
  if (c && now - c.at < 15000) return Promise.resolve(c.val);
  return new Promise((resolve) => {
    const done = (out) => { const val = parseHostProbe(name, out); _hostCache.set(name, { at: Date.now(), val }); resolve(val); };
    try {
      if (name === "local") exec(HOST_PROBE, { timeout: 8000 }, (e, out) => done(e ? "" : out));
      else {
        const child = spawn("ssh", [...SSH_OPTS, name, "bash -lc " + shq(HOST_PROBE)], { stdio: ["ignore", "pipe", "ignore"] });
        let buf = ""; child.stdout.on("data", (d) => (buf += d));
        child.on("close", () => done(buf)); child.on("error", () => done(""));
        setTimeout(() => { try { child.kill(); } catch {} }, 9000);
      }
    } catch { done(""); }
  });
}

// Liste les sous-dossiers d'un chemin sur un nœud DISTANT (explorateur de chemin, spawn distant).
function listRemoteDirs(host, want) {
  return new Promise((resolve, reject) => {
    const target = (want && String(want).trim()) ? shq(want) : '"$HOME"';
    const inner = 'd=' + target + '; cd "$d" 2>/dev/null || cd "$(dirname "$d")" 2>/dev/null || cd "$HOME"; echo "DIR=$PWD"; echo "HOME=$HOME"; echo "PARENT=$(dirname "$PWD")"; ls -1Ap 2>/dev/null';
    const child = spawn("ssh", [...SSH_OPTS, host, "bash -lc " + shq(inner)], { stdio: ["ignore", "pipe", "ignore"] });
    let buf = ""; child.stdout.on("data", (d) => (buf += d));
    child.on("close", () => {
      const g = (re) => { const m = buf.match(re); return m ? m[1].trim() : ""; };
      const dir = g(/DIR=(.*)/), home = g(/HOME=(.*)/), par = g(/PARENT=(.*)/);
      if (!dir) return reject(new Error("dossier illisible sur " + host));
      const dirs = buf.split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l.endsWith("/") && !l.startsWith(".")).map((l) => l.slice(0, -1)).sort().slice(0, 500);
      resolve({ path: dir, parent: par && par !== dir ? par : null, home: home || dir, dirs, host });
    });
    child.on("error", reject);
    setTimeout(() => { try { child.kill(); } catch {} }, 9000);
  });
}

// --- bibliothèque de skills (consultation, rangée par catégorie) ---
function skillDesc(txt) {
  const m = txt.match(/description:\s*(.+)/i);
  if (m) return m[1].trim().replace(/^["']|["']$/g, "").slice(0, 220);
  const l = txt.split("\n").find((x) => x.trim() && !x.startsWith("#") && !x.startsWith("---") && !x.startsWith("<!--"));
  return (l || "").trim().slice(0, 220);
}
function listSkills() {
  let ents = [];
  try { ents = fs.readdirSync(SKILLS_DIR, { withFileTypes: true }); } catch { return { dir: SKILLS_DIR, categories: [], total: 0 }; }
  const cats = [];
  for (const e of ents) {
    if (!e.isDirectory()) continue;
    const catDir = path.join(SKILLS_DIR, e.name), skills = [];
    let sub = []; try { sub = fs.readdirSync(catDir, { withFileTypes: true }); } catch {}
    for (const s of sub) {
      try {
        if (s.isDirectory()) {
          const f = path.join(catDir, s.name, "SKILL.md");
          if (fs.existsSync(f)) { const t = fs.readFileSync(f, "utf8"); skills.push({ name: s.name, desc: skillDesc(t), path: path.relative(SKILLS_DIR, f), size: t.length }); }
        } else if (s.name.endsWith(".md")) {
          const f = path.join(catDir, s.name), t = fs.readFileSync(f, "utf8");
          skills.push({ name: s.name.replace(/\.md$/, "").replace(/^[^_]*__/, ""), desc: skillDesc(t), path: path.relative(SKILLS_DIR, f), size: t.length });
        }
      } catch { /* skip */ }
    }
    if (skills.length) cats.push({ category: e.name, count: skills.length, skills: skills.sort((a, b) => a.name.localeCompare(b.name)) });
  }
  cats.sort((a, b) => a.category.localeCompare(b.category));
  return { dir: SKILLS_DIR, categories: cats, total: cats.reduce((n, c) => n + c.count, 0) };
}

// --- ajout/suppression manuels de skills (assistant, liens GitHub) ---
function httpGet(url, json) {
  return new Promise((resolve, reject) => {
    const headers = { "User-Agent": "fleet-office" };
    if (json) headers.Accept = "application/vnd.github+json";
    https.get(url, { headers }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) return resolve(httpGet(r.headers.location, json));
      let b = ""; r.on("data", (d) => (b += d)); r.on("end", () => resolve({ status: r.statusCode, body: b }));
    }).on("error", reject);
  });
}
function guessSkillName(p) {
  const parts = String(p).replace(/[?#].*$/, "").replace(/\/SKILL\.md$/i, "").split("/").filter(Boolean);
  return vslug((parts[parts.length - 1] || "skill").replace(/\.md$/i, ""));
}
// analyse un lien GitHub (raw / blob / tree / repo / owner-repo) -> {owner, repo, branch, subpath}.
// branch===null => pas précisée dans l'URL (repo/owner-repo nu) -> à résoudre via l'API (default_branch).
function parseGithubTarget(url) {
  url = String(url || "").trim(); let m;
  if ((m = url.match(/^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.*)$/i)))
    return { owner: m[1], repo: m[2], branch: m[3], subpath: m[4].replace(/\/$/, "") };
  if ((m = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/(blob|tree)\/([^/]+)\/(.*)$/i)))
    return { owner: m[1], repo: m[2], branch: m[4], subpath: m[5].replace(/\/$/, "") };
  if ((m = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/i)) || (m = url.match(/^([\w.-]+)\/([\w.-]+)$/)))
    return { owner: m[1], repo: m[2], branch: null, subpath: "" };
  return null;
}
async function resolveBranch(owner, repo, branch) {
  if (branch) return branch;
  try { const r = await httpGet(`https://api.github.com/repos/${owner}/${repo}`, true); if (r.status === 200) { const j = JSON.parse(r.body); if (j.default_branch) return j.default_branch; } } catch { /* */ }
  return "main"; // dernier recours si l'API échoue (repo privé, rate-limit…)
}
function installSkillLocal(dir, cat, name) {
  try {
    const dst = path.join(os.homedir(), ".claude", "skills"); fs.mkdirSync(dst, { recursive: true });
    const link = path.join(dst, "fleet-" + cat + "-" + name);
    try { fs.rmSync(link, { recursive: true, force: true }); } catch { /* */ }
    try { fs.symlinkSync(dir, link, "dir"); } catch { fs.mkdirSync(link, { recursive: true }); fs.copyFileSync(path.join(dir, "SKILL.md"), path.join(link, "SKILL.md")); }
  } catch { /* */ }
}
function saveSkill(cat, name, body, sourceUrl) {
  const dir = path.join(SKILLS_DIR, cat, name); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), `<!-- fleet-office · ajout manuel · source: ${sourceUrl} -->\n` + body);
  installSkillLocal(dir, cat, name);
  return dir;
}
// Ajoute une ou PLUSIEURS skills depuis un lien GitHub : essaie d'abord le lien comme UNE skill
// précise (blob/dossier-de-skill) ; si ça ne résout à rien, le traite comme un DOSSIER/REPO et
// importe TOUTES les SKILL.md trouvées dessous (ex. lien vers .../skills/ ou vers le repo entier).
async function addSkillFromUrl(url, category) {
  const t = parseGithubTarget(url);
  if (!t) {
    if (!/\.md(\?|$)/i.test(url)) throw new Error("lien non reconnu (github blob/tree, raw, owner/repo, ou .md)");
    const r = await httpGet(url);
    if (!r || r.status !== 200 || !r.body) throw new Error("fichier introuvable à ce lien");
    const cat = vslug(category || "ajouts"), name = guessSkillName(url);
    saveSkill(cat, name, r.body, url);
    return { ok: true, category: cat, name, desc: skillDesc(r.body), count: 1 };
  }
  const branch = await resolveBranch(t.owner, t.repo, t.branch);
  // 1) essai simple : le lien pointe-t-il DIRECTEMENT (ou +/SKILL.md) vers UNE skill ?
  let singlePath = t.subpath;
  if (!/\.md$/i.test(singlePath)) singlePath = (singlePath ? singlePath + "/" : "") + "SKILL.md";
  const single = await httpGet(`https://raw.githubusercontent.com/${t.owner}/${t.repo}/${branch}/${singlePath}`);
  if (single && single.status === 200 && single.body) {
    const cat = vslug(category || t.repo || "ajouts"), name = guessSkillName(singlePath);
    saveSkill(cat, name, single.body, url);
    return { ok: true, category: cat, name, desc: skillDesc(single.body), count: 1 };
  }
  // 2) sinon : lien de DOSSIER ou de DÉPÔT entier -> import groupé de toutes les SKILL.md dessous
  const tr = await httpGet(`https://api.github.com/repos/${t.owner}/${t.repo}/git/trees/${branch}?recursive=1`, true);
  if (tr.status !== 200) throw new Error("dépôt/branche introuvable (" + t.owner + "/" + t.repo + "@" + branch + ")");
  const tree = (JSON.parse(tr.body).tree) || [];
  const prefix = t.subpath ? t.subpath + "/" : "";
  const matches = tree.filter((n) => n.type === "blob" && /(^|\/)SKILL\.md$/i.test(n.path) && (!prefix || n.path.startsWith(prefix)));
  if (!matches.length) throw new Error("aucune SKILL.md trouvée sous ce lien");
  const cat = vslug(category || (t.subpath ? t.subpath.split("/").pop() : "") || t.repo || "ajouts");
  const added = [];
  for (const n of matches.slice(0, 40)) { // garde-fou : 40 skills max par import groupé
    try {
      const r = await httpGet(`https://raw.githubusercontent.com/${t.owner}/${t.repo}/${branch}/${n.path}`);
      if (!r || r.status !== 200 || !r.body) continue;
      const name = guessSkillName(n.path);
      saveSkill(cat, name, r.body, `https://github.com/${t.owner}/${t.repo}/blob/${branch}/${n.path}`);
      added.push({ name, desc: skillDesc(r.body) });
    } catch { /* une skill en échec ne bloque pas les autres */ }
  }
  if (!added.length) throw new Error("SKILL.md trouvées mais téléchargement échoué pour toutes");
  return { ok: true, category: cat, count: added.length, added, bulk: true, name: added.length === 1 ? added[0].name : (added.length + " skills") };
}
function delSkill(rel) {
  const rootAbs = path.resolve(SKILLS_DIR);
  const full = path.resolve(SKILLS_DIR, rel || "");
  if (full !== rootAbs && !full.startsWith(rootAbs + path.sep)) throw new Error("hors périmètre");
  const dir = full.endsWith("SKILL.md") ? path.dirname(full) : full;
  if (path.resolve(dir) === rootAbs || path.dirname(path.resolve(dir)) === rootAbs && !fs.existsSync(path.join(dir, "SKILL.md")) && !fs.statSync(dir).isDirectory()) throw new Error("chemin invalide");
  const cat = path.basename(path.dirname(dir)), name = path.basename(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  try { fs.rmSync(path.join(os.homedir(), ".claude", "skills", "fleet-" + cat + "-" + name), { recursive: true, force: true }); } catch { /* */ }
  return { cat, name };
}

// --- vault Obsidian versionné en git (sync « clone/pull partout », auto-commit) ---
let _vaultCommitAt = 0;
function vaultCommit() {
  const now = Date.now(); if (now - _vaultCommitAt < 60000) return; _vaultCommitAt = now;
  try {
    if (!fs.existsSync(path.join(VAULT_DIR, ".git"))) {
      execSync('git init -q; git config user.email fleet@office; git config user.name "Fleet Office"; git add -A; git commit -q -m "init vault" || true', { cwd: VAULT_DIR, stdio: "ignore" });
    }
    exec('git add -A && git commit -q -m "notes ' + new Date().toISOString().slice(0, 16).replace("T", " ") + '" || true', { cwd: VAULT_DIR }, () => {});
  } catch { /* jamais bloquant */ }
}

function spawnClaude(rec) {
  const args = claudeArgs(rec);
  if (!isRemote(rec)) return spawn(CLAUDE_BIN, args, { cwd: rec.cwd, env: agentEnv(rec), stdio: ["pipe", "pipe", "pipe"] });
  // `bash -lc` => login shell distant : charge le PATH user (ex. ~/.local/bin) sinon `claude`
  // installé en natif (kali) est introuvable en SSH non-login. Voir COORDINATION.md (blocage #1).
  const bex = bedrockExports(rec); // creds Bedrock exportés inline si provider bedrock (sinon "")
  const inner = (bex ? bex + " " : "") + 'export PATH="$HOME/.local/bin:$PATH"; cd ' + shq(rec.cwd || "~") + " && exec " + REMOTE_CLAUDE + " " + args.map(shq).join(" ");
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
      } else if (o.type === "assistant" && o.message && Array.isArray(o.message.content)) {
        for (const b of o.message.content) if (b && b.type === "tool_use" && b.name === "Skill" && b.input) { try { skillsys.recordUse(b.input.skill || b.input.name || b.input.command, rec.role); } catch { /* jamais bloquant */ } }
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

function spawnAgent({ name, role, cwd, prompt, model, perm, teamId: joinTeamId, host, id: fixedId, attachments, provider, effort, parentId, worktree, fanoutId, variant }) {
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
  // Worktree git dédié (Orca) : l'agent bosse sur une branche isolée. Best-effort — si le cwd n'est
  // pas un dépôt git ou que git échoue, on retombe silencieusement sur le cwd direct.
  let workCwd = cwd, wtMeta = null;
  if (worktree) {
    const wt = createWorktree(remote ? host : "local", cwd, name || role, sessionId);
    if (wt && !wt.error) { workCwd = wt.path; wtMeta = wt; }
    else if (wt && wt.error) console.error("[worktree] " + sessionId + " : " + wt.error);
  }
  let finalPrompt = prompt, teamId = null, teamGoal = null, teamName = null;
  // greffe explicite à une équipe existante (choisie dans l'UI)
  const teamPeers = joinTeamId ? [...managed.values()].filter((m) => m.teamId === joinTeamId) : [];
  if (joinTeamId && teamPeers.length) {
    teamId = joinTeamId; teamGoal = teamPeers[0].teamGoal || ("Équipe " + joinTeamId); teamName = teamPeers[0].teamName || teamGoal;
    const peerDesc = teamPeers.map((m) => `${m.name} (${m.role})`).join(", ");
    finalPrompt = `Tu REJOINS une équipe en cours sur cet objectif : « ${teamGoal} ». Coéquipiers : ${peerDesc}.\nAvant d'agir : lis TEAM_NOTES.md + les fichiers récents, coordonne-toi, évite les conflits, et ajoute une ligne « [${role || "agent"}] … » dans TEAM_NOTES.md. Utilise git (branches, pull avant push).\n\nTa mission : ${prompt}`;
  } else {
    // auto-coordination : si d'autres agents bossent sur le même répertoire, on les met en équipe.
    // Un worktree isole l'agent (cwd unique) -> on NE coordonne PAS (fan-out = variantes indépendantes).
    const coord = (remote || wtMeta) ? null : coordinateWorkspace(cwd, sessionId);
    if (coord) {
      teamId = coord.teamId; teamGoal = "Collaboration — " + projectName(cwd);
      const peerDesc = coord.peers.map((m) => `${m.name} (${m.role})`).join(", ");
      finalPrompt = `⚠️ D'AUTRES AGENTS travaillent DÉJÀ dans ce workspace (${cwd}) : ${peerDesc}.\nAvant d'agir : lis TEAM_NOTES.md + les fichiers récents pour voir leur travail, ÉVITE les conflits (ne réécris pas ce qu'ils font), coordonne-toi avec eux, et ajoute une ligne « [${role || "agent"}] … » dans TEAM_NOTES.md (crée-le s'il n'existe pas). Utilise git (branches, pull avant push) pour ne pas écraser leur travail.\n\nTa mission : ${prompt}`;
    }
  }
  if (!skillsys.getJob(role)) researchSkills(role, remote ? host : "local"); // métier non défini : téléchargement automatique par mots-clés (sinon : skills choisies)
  finalPrompt += skillsys.applyToAgent(role, remote ? host : "local"); // skills HÉRITÉES du métier (choisies) + bibliothèque partagée
  finalPrompt += `\n\n💡 Des skills réelles pour ton métier (${role || "agent"}) sont téléchargées depuis des repos réputés dans ${skillsFileFor(role || "agent")} (et le dossier voisin ${path.join(SKILLS_DIR, String(role || "agent").toLowerCase().replace(/[^a-z0-9]+/gi, "-"))}/) — consulte-les dès qu'elles existent et applique celles qui t'aident.`;
  if (wtMeta) finalPrompt += `\n\n🌿 Tu travailles dans un WORKTREE GIT dédié : branche « ${wtMeta.branch} » (basée sur « ${wtMeta.base} »), dossier ${wtMeta.path}. Committe régulièrement ton travail SUR CETTE BRANCHE — il sera revu (diff), puis mergé ou jeté depuis le command center. Ne touche pas aux autres branches.`;
  // pièces jointes de la mission initiale → livrées dans l'inbox de la session, sur la machine de l'agent
  if (Array.isArray(attachments) && attachments.length) {
    try { finalPrompt += attachBlock(deliverAttachments(sessionId, attachments, remote ? host : null)); }
    catch (e) { console.error("[attach] spawn:", e.message); }
  }
  managed.set(sessionId, {
    id: sessionId, name: name || projectName(cwd), role: role || "claude", cwd: workCwd, host: remote ? host : null,
    model: model || "sonnet", perm: SAFE_PERMS.includes(perm) ? perm : DEFAULT_PERM,
    status: "working", startedAt: Date.now(), lastPrompt: prompt, costUsd: 0, teamId, teamGoal, teamName,
    provider: provider === "bedrock" ? "bedrock" : "anthropic", effort: effort || null,
    // worktree git dédié (Orca) + appartenance à un fan-out (variantes parallèles)
    worktree: !!wtMeta, repoRoot: wtMeta ? wtMeta.root : null, branch: wtMeta ? wtMeta.branch : null, base: wtMeta ? wtMeta.base : null,
    fanoutId: fanoutId || null, variant: variant || null,
    // sous-agent créé PAR un autre agent (Task tool / spawn API) -> masqué du roster, géré par le parent
    parentId: (parentId && managed.has(parentId)) ? parentId : null,
  });
  runClaude({ sessionId, cwd: workCwd, prompt: finalPrompt, model, perm, resume: false });
  if (!parentId) logAudit("spawn", { id: sessionId, name: name || projectName(cwd), role: role || "claude", host: remote ? host : "local", cwd, provider: provider === "bedrock" ? "bedrock" : "anthropic" });
  if (wtMeta) setTimeout(() => { try { refreshWorktreeChanges(); } catch {} }, 4000);
  return sessionId;
}
function spawnTeam({ name, goal, cwd, model, perm, roles, chief, provider, effort, host }) {
  const remote = !!(host && host !== "local");
  if (!cwd || !String(cwd).trim()) throw new Error("workspace requis");
  if (!remote) {
    if (!fs.existsSync(cwd)) throw new Error("workspace introuvable : " + cwd);
    if (!fs.statSync(cwd).isDirectory()) throw new Error("workspace n'est pas un dossier : " + cwd);
  }
  if (!goal || !String(goal).trim()) throw new Error("objectif d'équipe requis");
  const list = (Array.isArray(roles) && roles.length) ? roles : ["Architecte", "Backend", "Frontend", "DevOps", "QA"];
  const prov = provider === "bedrock" ? "bedrock" : "anthropic";
  // modèle non imposé ("auto"/vide) -> le chef choisit : chef=opus (le plus capable), membres=sonnet par défaut,
  // et le chef reçoit la consigne de réaffecter le meilleur modèle par membre s'il le juge utile.
  const auto = !model || model === "auto";
  const chiefModel = auto ? "opus" : model;
  const memberModel = auto ? "sonnet" : model;
  const teamId = crypto.randomUUID().slice(0, 8);
  const teamName = (name && String(name).trim()) || ("Équipe " + projectName(cwd));
  // le chef peut être un AGENT EXISTANT ("agent:<id>") ou un des rôles à créer
  const chiefExistingId = (chief && String(chief).startsWith("agent:")) ? String(chief).slice(6) : null;
  const chiefRole = chiefExistingId ? null : ((chief && list.includes(chief)) ? chief : list[0]);
  const ids = [];
  const chiefTail = `\n\n👑 Tu es le CHEF de cette équipe. RÈGLE ABSOLUE : ne déclare JAMAIS l'équipe « terminée » et ne dissous JAMAIS de toi-même tant que l'humain n'a pas tranché. Quand tous les membres ont fini (« [FINI] » dans TEAM_NOTES.md), tu CONSOLIDES et tu écris « [CHEF][QUESTION] … » dans TEAM_NOTES.md résumant le travail et demandant à l'humain quoi faire — puis tu attends. SEULS toi (le chef) ou l'humain peuvent clore des sessions : avec l'accord humain, appelle POST http://127.0.0.1:${PORT}/api/team-kill {"teamId":"${teamId}"} ou /api/kill {"id":"<sessionId>"}. Tu peux aussi recruter des membres : POST /api/spawn {"name","role","cwd":"${cwd}","prompt","teamId":"${teamId}"${prov === "bedrock" ? ',"provider":"bedrock"' : ""}}.${auto ? ` ⚙️ Le MODÈLE n'a pas été imposé : c'est TOI qui choisis le meilleur modèle par membre (opus pour l'architecture/le raisonnement lourd, sonnet pour le gros du dev, haiku pour les tâches simples/rapides). Ajoute "model":"opus|sonnet|haiku|fable" à chaque /api/spawn, et n'hésite pas à fermer puis relancer un membre sous un modèle plus adapté.` : ""}${prov === "bedrock" ? " Les agents de cette équipe tournent via AWS Bedrock (clés Askeal)." : ""}
🧠 Sous-agents : si tu délègues via l'outil Task ou en appelant /api/spawn avec "parentId":"<ton sessionId>", ces sous-agents te sont RATTACHÉS (invisibles dans le roster, c'est toi qui les pilotes).`;

  // 1) chef = agent existant : on le rattache (pas de spawn)
  let chiefLabel = chiefRole;
  if (chiefExistingId) {
    const rec = ensureManaged(chiefExistingId);
    if (!rec) throw new Error("agent chef introuvable");
    rec.teamId = teamId; rec.teamName = teamName; rec.teamGoal = goal; rec.chief = true; rec.cwd = cwd;
    rec.provider = prov; if (effort) rec.effort = effort; if (!auto) rec.model = model;
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
    if (!skillsys.getJob(role)) researchSkills(role, remote ? host : "local");
    const jobBlock = skillsys.applyToAgent(role, remote ? host : "local");
    const base = `Tu fais partie de l'ÉQUIPE « ${teamName} » (chef : ${chiefLabel} ; membres : ${list.join(", ")}) dans le MÊME workspace (${cwd}). Objectif commun :\n\n« ${goal} »\n\nTon rôle : ${role}. Lis d'abord TEAM_NOTES.md + les fichiers présents, fais ton travail, ajoute des lignes « [${role}] … » dans TEAM_NOTES.md.\n💡 Skills/MCP de ton métier dans ${skillsFileFor(role)}.`;
    const tail = isChief ? chiefTail
      : `\n\nQuand ta tâche est finie : NE clos PAS la mission. Écris « [FINI][${role}] <résumé> » dans TEAM_NOTES.md à l'attention du chef (${chiefLabel}) et reste en attente de ses instructions / de la décision de l'humain.`;
    const mModel = isChief ? chiefModel : memberModel;
    managed.set(sessionId, {
      id: sessionId, name: isChief ? `${role} 👑` : role, role, cwd, model: mModel, host: remote ? host : null,
      perm: SAFE_PERMS.includes(perm) ? perm : DEFAULT_PERM, status: "working",
      startedAt: Date.now(), lastPrompt: "[équipe] " + goal, costUsd: 0, teamId, teamGoal: goal, teamName,
      chief: isChief, provider: prov, effort: effort || null,
    });
    runClaude({ sessionId, cwd, prompt: base + tail + jobBlock, model: mModel, perm, resume: false });
    ids.push(sessionId);
  });
  logAudit("team", { id: teamId, name: teamName, goal, cwd, members: list.length, provider: prov, host: remote ? host : "local" });
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
  logAudit("kill", { id, name: (rec && rec.name) || id, role: rec && rec.role, host: (rec && rec.host) || "local" });
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

// Termine la session active et envoie l'agent à la SALLE DE SPORT s'auto-améliorer. Si un métier
// est précisé (bouton "🏋️ Entraîner" du rail), on déclenche EN PLUS, tout de suite (force=true,
// sans attendre le cooldown de 30 min), le téléchargement + rangement + installation de vraies
// skills pour CE métier sur le nœud de l'agent (skills_fetch.js), et l'agent en est informé.
function trainAgent(id, role) {
  const rec = ensureManaged(id); if (!rec) throw new Error("session introuvable");
  if (rec.busy) throw new Error("agent occupé (arrête la tâche en cours d'abord)");
  role = String(role || "").trim() || rec.role;
  rec.training = true; rec.teamId = null; rec.teamGoal = null;
  const targeted = role.toLowerCase() !== String(rec.role || "").toLowerCase();
  if (targeted) researchSkills(role, rec.host, true); // fetch immédiat, sans cooldown
  const skillsPath = skillsFileFor(role) + " (et " + path.join(SKILLS_DIR, role.toLowerCase().replace(/[^a-z0-9]+/gi, "-")) + "/)";
  const p = targeted
    ? `Ta session de travail est TERMINÉE — direction la SALLE DE SPORT 🏋️ pour monter en compétence sur le métier « ${role} » (à la demande).\nDes skills réelles pour ce métier sont en cours de téléchargement (repos réputés) et d'installation dans ~/.claude/skills/ sur cette machine — consulte ${skillsPath} dans une minute ou deux (patiente/réessaie si le fichier n'existe pas encore), étudie-les, applique ce qui est pertinent pour ton contexte actuel, puis écris un rapport « SKILLS_LEARNED.md » dans ton workspace résumant ce que tu as retenu. Puis termine.`
    : `Ta session de travail est TERMINÉE — direction la SALLE DE SPORT 🏋️ pour monter en compétence sur ton métier (${rec.role}).\nEntraînement : recherche sur le web des **Claude Skills** et des **serveurs MCP** récents et pertinents pour un ${rec.role}. Évalue les 4 à 6 plus utiles (ce qu'ils font, pourquoi ils t'aideraient, comment les obtenir). Écris un rapport clair « SKILLS_LEARNED.md » dans ton workspace. NE les installe PAS — propose-les. Puis termine.`;
  rec.lastPrompt = "🏋️ Entraînement — " + role;
  runClaude({ sessionId: id, cwd: rec.cwd, prompt: p, model: rec.model, perm: rec.perm, resume: true });
  logAudit("train", { id, name: rec.name, role, host: rec.host || "local", targeted });
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

// Renomme l'agent (affichage uniquement — n'affecte pas le sessionId/dossier/process).
function renameAgent(id, name) {
  name = String(name || "").trim();
  if (!name) throw new Error("nom vide");
  if (name.length > 60) throw new Error("nom trop long (60 max)");
  const rec = ensureManaged(id); if (!rec) throw new Error("session introuvable");
  logAudit("rename", { id, from: rec.name, to: name, host: rec.host || "local" });
  rec.name = name;
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
    provider: m.provider || "anthropic", effort: m.effort || null,
    worktree: !!m.worktree, branch: m.branch || null, base: m.base || null, repoRoot: m.repoRoot || null, fanoutId: m.fanoutId || null, variant: m.variant || null, changes: _wtChanges.get(sid) || null,
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
// Permet de voir dans le bureau les agents qui tournent sur kali, archlinux, debian-lab,
// black-station… pas seulement ceux de la machine qui héberge l'orchestrateur.
const REMOTE_SCAN_TTL = 5000;
// Nœuds infra/proxy/services SANS agents Claude : on ne les scanne pas (évite SSH muets/hung).
const REMOTE_SCAN_SKIP = new Set(["debians", "pve", "proxy", "jellyfin", "nextcloud", "orchestratorbe", "microservices", "pixel-8-pro", "nsa-hidden-van", "fleetoffice", "fitness-backend", "jarvis-screen"]);
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
      a.provider = m.provider || "anthropic"; a.effort = m.effort || null;
      a.worktree = !!m.worktree; a.branch = m.branch || null; a.base = m.base || null; a.repoRoot = m.repoRoot || null;
      a.fanoutId = m.fanoutId || null; a.variant = m.variant || null; a.changes = _wtChanges.get(sid) || null;
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

  // Sous-agents créés PAR un autre agent (parentId, ex. chef auto ou délégation via /api/spawn) :
  // repliés sous le parent, JAMAIS en carte séparée. Les membres d'équipe (teamId, via les boutons)
  // restent visibles. Leur live reste accessible en drill-down par /api/transcript.
  const byId = new Map(agents.map((a) => [a.id, a]));
  for (const a of agents) {
    const m = managed.get(a.id);
    if (m && m.parentId && byId.has(m.parentId)) {
      a.internal = true; a.parentId = m.parentId;
      const p = byId.get(m.parentId);
      (p.subAgents = p.subAgents || []).push({ id: a.id, name: a.name, role: a.role, status: a.status, busy: !!a.busy, model: a.model, provider: a.provider || null });
      p.childrenCount = (p.childrenCount || 0) + 1;
    }
  }
  const visible = agents.filter((a) => !a.internal);
  return { agents: visible, jobsDir: JOBS_DIR, sessionsDir: SESSIONS_DIR, error: null };
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
    if ((a.status === "idle" || a.status === "done") && prev && prev !== "idle" && prev !== "done") {
      researchSkills(a.role, a.host);   // skills en ligne du métier, installées sur le nœud de l'agent
      noteToVault(a);           // mémoire Obsidian : grave une note quand l'agent finit
    }
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
    bedrock: bedrockAvailable(),
    terminal: !!(pty && WebSocketServer),
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
  ".glb": "model/gltf-binary",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".txt": "text/plain; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".webmanifest": "application/manifest+json",
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
  else if (urlPath === "/world" || urlPath === "/world/") filePath = path.join(PUBLIC_DIR, "world", "index.html"); // monde pixel-art
  else if (urlPath === "/world3d" || urlPath === "/world3d/") filePath = path.join(PUBLIC_DIR, "world3d", "index.html"); // ville 3D (Three.js)
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
// Équivalent distant de uniqueLocal (test -e via SSH) : évite qu'une 2e pièce jointe du même nom
// (ex. deux captures "image.png" collées coup sur coup) n'écrase silencieusement la 1re sur l'agent.
function remoteUniqueName(host, rel, name) {
  const ext = path.extname(name), base = ext ? name.slice(0, -ext.length) : name;
  let candidate = name, i = 0;
  while (i < 50) {
    try { execSync("ssh " + SSH_OPTS.join(" ") + " " + shq(host) + " " + shq("test -e " + rel + "/" + candidate), { timeout: 8000 }); }
    catch { return candidate; } // test -e en échec (code != 0) => chemin libre
    i++; candidate = base + "-" + i + ext;
  }
  return base + "-" + Date.now() + ext; // filet de sécurité si 50 collisions (improbable)
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
      const name = remoteUniqueName(host, rel, u.name);
      const remoteRel = rel + "/" + name;
      execSync("scp " + SSH_OPTS.join(" ") + " " + shq(u.path) + " " + shq(host + ":" + remoteRel), { timeout: 180000 });
      out.push({ name, size: u.size, absPath: (home ? home + "/" + remoteRel : "~/" + remoteRel) });
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

// ============================================================================
// ORCA UX — worktrees git, revue de diff, merge/discard, fan-out parallèle.
// Chaque agent peut tourner dans SON worktree git isolé (branche dédiée), local
// ou sur n'importe quel nœud Tailscale (via SSH, Bedrock inclus). On expose son
// diff vs la branche de base, un merge/discard, et le lancement de N variantes
// en parallèle (fan-out) chacune dans son worktree, pour comparer et garder la
// meilleure. Tout est best-effort : un échec git ne bloque jamais un spawn.
// ============================================================================
function posixDirname(p) { const s = String(p).replace(/\/+$/, ""); const i = s.lastIndexOf("/"); return i <= 0 ? "/" : s.slice(0, i); }
// Exécute une commande shell sur l'hôte de l'agent (local=bash, distant=ssh). Ne throw jamais.
function runAt(host, cmd) {
  const remote = !!(host && host !== "local");
  try {
    const out = remote
      ? execSync("ssh " + SSH_OPTS.join(" ") + " " + shq(host) + " " + shq(cmd), { encoding: "utf8", timeout: 30000, maxBuffer: 64 * 1024 * 1024 })
      : execSync(cmd, { encoding: "utf8", timeout: 30000, maxBuffer: 64 * 1024 * 1024, shell: "/bin/bash", stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, out: out || "", err: "", code: 0 };
  } catch (e) { return { ok: false, out: (e.stdout || "").toString(), err: (e.stderr || e.message || "").toString(), code: e.status || 1 }; }
}
function gitAt(host, dir, args) { return runAt(host, "git -C " + shq(dir) + " " + args.map(shq).join(" ")); }
// Repère la racine du dépôt + la branche de base (courante), sur l'hôte de l'agent.
function detectRepo(host, dir) {
  const r = gitAt(host, dir, ["rev-parse", "--show-toplevel"]);
  if (!r.ok) return null;
  const root = r.out.trim(); if (!root) return null;
  const b = gitAt(host, root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const base = (b.ok && b.out.trim() && b.out.trim() !== "HEAD") ? b.out.trim() : "HEAD";
  return { root, base };
}
// Crée un worktree dédié (branche fleet/<slug>-<id6>) à côté du dépôt. null = pas un dépôt git ;
// { error } = échec git (le caller retombe sur le cwd direct, sans jamais bloquer).
function createWorktree(host, cwd, name, sessionId) {
  const info = detectRepo(host, cwd); if (!info) return null;
  const slug = (vslug(name || "agent") || "agent").slice(0, 24);
  const short = String(sessionId).slice(0, 6);
  const branch = "fleet/" + slug + "-" + short;
  const repoName = info.root.replace(/\/+$/, "").split("/").pop() || "repo";
  const wtPath = posixDirname(info.root) + "/.fleet-wt/" + repoName + "__" + slug + "-" + short;
  const r = runAt(host, "mkdir -p " + shq(posixDirname(info.root) + "/.fleet-wt") + " && git -C " + shq(info.root) + " worktree add -b " + shq(branch) + " " + shq(wtPath) + " " + shq(info.base));
  if (!r.ok) return { error: (r.err || "worktree add a échoué").slice(0, 400) };
  return { root: info.root, base: info.base, branch, path: wtPath };
}
// Diff d'un agent vs sa base (worktree -> branche de base ; direct -> HEAD). Inclut les fichiers
// non suivis via `add -N` (intent-to-add, réversible). Renvoie numstat + patch unifié brut.
function agentDiff(id) {
  // ensureManaged adopte aussi les sessions interactives/distantes -> le diff marche pour TOUT agent
  // dans un dépôt git (pas seulement ceux spawnés par l'orchestrateur).
  const rec = managed.get(id) || ensureManaged(id); if (!rec) throw new Error("agent introuvable");
  const host = rec.host, dir = rec.cwd;
  if (!dir || dir === "~" || dir === "-") return { git: false, cwd: dir || "~", host: host || "local" };
  const info = detectRepo(host, dir);
  if (!info) return { git: false, cwd: dir, host: host || "local" };
  const cmp = rec.worktree ? (rec.base || info.base) : "HEAD";
  runAt(host, "git -C " + shq(dir) + " add -N -- . >/dev/null 2>&1");
  const num = gitAt(host, dir, ["--no-pager", "diff", "--numstat", cmp]);
  const patch = gitAt(host, dir, ["--no-pager", "diff", "--no-color", cmp]);
  const files = (num.ok ? num.out : "").trim().split("\n").filter(Boolean).map((l) => {
    const m = l.split("\t"); const bin = m[0] === "-";
    return { additions: bin ? 0 : (+m[0] || 0), deletions: bin ? 0 : (+m[1] || 0), binary: bin, path: m[2] || "" };
  }).filter((f) => f.path);
  return { git: true, worktree: !!rec.worktree, base: cmp, branch: rec.branch || info.base, root: info.root, cwd: dir, host: host || "local", files, patch: (patch.ok ? patch.out : "").slice(0, 700000) };
}
// Merge la branche du worktree dans la base (depuis le dépôt principal). Honnête sur les échecs
// (dépôt sale, conflit) : ne détruit jamais la branche, on peut résoudre à la main.
function mergeWorktree(id) {
  const rec = managed.get(id); if (!rec) throw new Error("agent introuvable");
  if (!rec.worktree || !rec.repoRoot) throw new Error("cet agent ne tourne pas dans un worktree dédié");
  const host = rec.host, root = rec.repoRoot, branch = rec.branch, base = rec.base, wt = rec.cwd;
  runAt(host, "cd " + shq(wt) + " && git add -A && (git diff --cached --quiet || git commit -q -m " + shq("fleet: travaux de " + (rec.name || "agent")) + ")");
  const dirty = gitAt(host, root, ["status", "--porcelain"]);
  if (dirty.ok && dirty.out.trim()) return { ok: false, error: "le dépôt principal (" + root + ") a des modifications non committées — commit/stash avant de merger" };
  const co = gitAt(host, root, ["checkout", base]);
  if (!co.ok) return { ok: false, error: "impossible de basculer sur « " + base + " » : " + co.err.slice(0, 300) };
  const mg = gitAt(host, root, ["merge", "--no-ff", "-m", "fleet: merge " + branch, branch]);
  if (!mg.ok) return { ok: false, error: "merge en conflit — résous à la main dans " + root + " : " + mg.err.slice(0, 300) };
  logAudit("merge", { id, name: rec.name, branch, base, root, host: host || "local" });
  return { ok: true, base, branch, root };
}
// Supprime le worktree + sa branche (travail jeté). À n'appeler qu'après confirmation UI.
function discardWorktree(id) {
  const rec = managed.get(id); if (!rec) throw new Error("agent introuvable");
  if (!rec.worktree || !rec.repoRoot) return { ok: false, error: "pas de worktree à nettoyer" };
  const host = rec.host, root = rec.repoRoot;
  runAt(host, "git -C " + shq(root) + " worktree remove --force " + shq(rec.cwd));
  runAt(host, "git -C " + shq(root) + " branch -D " + shq(rec.branch));
  logAudit("discard", { id, name: rec.name, branch: rec.branch, host: host || "local" });
  return { ok: true };
}
// Résumé de diff LÉGER par agent worktree (pour les cartes + colonne « En revue » du board).
// Calculé en ASYNCHRONE (jamais dans scanAgents/broadcast qui sont synchrones) et mis en cache ;
// scanAgents lit juste le cache. Borné au nombre d'agents en worktree.
const _wtChanges = new Map(); // id -> { files, add, del, untracked, at }
function refreshWorktreeChanges() {
  for (const [id, rec] of managed) {
    if (!rec.worktree || !rec.repoRoot) { _wtChanges.delete(id); continue; }
    const base = rec.base || "HEAD";
    const cmd = "git -C " + shq(rec.cwd) + " --no-pager diff --shortstat " + shq(base) + " 2>/dev/null; echo '@@SEP@@'; git -C " + shq(rec.cwd) + " ls-files --others --exclude-standard 2>/dev/null | wc -l";
    const remote = isRemote(rec);
    let child;
    try {
      child = remote
        ? spawn("ssh", [...SSH_OPTS, rec.host, cmd], { stdio: ["ignore", "pipe", "ignore"] })
        : spawn("bash", ["-lc", cmd], { stdio: ["ignore", "pipe", "ignore"] });
    } catch { continue; }
    let buf = ""; child.stdout.on("data", (d) => (buf += d)); child.on("error", () => {});
    child.on("close", () => {
      const parts = buf.split("@@SEP@@"); const stat = parts[0] || "", unt = parts[1] || "";
      const g = (re) => { const m = stat.match(re); return m ? +m[1] : 0; };
      const files = g(/(\d+) files? changed/), add = g(/(\d+) insertion/), del = g(/(\d+) deletion/);
      const untracked = parseInt(unt.trim(), 10) || 0;
      const prev = _wtChanges.get(id);
      const next = { files: files + untracked, add, del, untracked, at: Date.now() };
      _wtChanges.set(id, next);
      if (!prev || prev.files !== next.files || prev.add !== next.add || prev.del !== next.del) broadcast(false);
    });
    setTimeout(() => { try { child.kill(); } catch {} }, 12000);
  }
}
setInterval(refreshWorktreeChanges, 15000).unref?.();

// ---- Automations : tâches récurrentes (voir automations.js) -------------------------------------
const automations = require("./automations").createAutomations({
  spawnAgent: (o) => spawnAgent(o), logAudit: (a, d) => logAudit(a, d), broadcast: (f) => broadcast(f), dir: FLEET_DIR,
  isBusy: (id) => { const r = managed.get(id); return !!(r && r.busy); },
});
automations.start();

// ---- Évaluation des agents : « l'Arène » (voir reviews.js) — défini après skillsys (usage plus bas) ----------

// ---- Monde pixel-art : une maison par projet (voir worldsys.js) ---------------------------------------
const world = require("./worldsys").createWorld({ dir: FLEET_DIR, getAgents: () => snapshot().agents });

// ---- Métiers + skills classées + bibliothèque partagée (voir skillsys.js) -----------------------------
const skillsys = require("./skillsys").createSkillSys({
  SKILLS_DIR, dir: FLEET_DIR, listLibrary: () => listSkills(), addRole: (n) => addRole(n),
  fetchOnline: (q) => researchSkills(q, "local", true),
  advisorHosts: () => [...new Set([process.env.FLEET_ADVISOR_HOST, "black-station", ...[...managed.values()].map((m) => m.host)].filter((h) => h && h !== "local"))],
  sshOpts: SSH_OPTS, publicUrl: () => process.env.FLEET_PUBLIC_URL || ("http://" + os.hostname() + ":" + PORT), onChange: () => {},
});
const reviews = require("./reviews").createReviews({
  dir: FLEET_DIR, skills: skillsys, llm: (p) => skillsys.runLLM(p),
  collect: (id) => { let feed = [], before = null; for (let i = 0; i < 4; i++) { const w = renderTranscriptWindow(id, before); feed = w.feed.concat(feed); if (w.atStart || w.nextBefore == null) break; before = w.nextBefore; } return feed; },
  agentInfo: (id) => { const a = snapshot().agents.find((x) => x.id === id); return a ? { id: a.id, name: a.name, role: a.role, project: a.project, host: a.host, status: a.status, costUsd: a.costUsd } : null; },
});

// Fan-out : une mission -> N variantes en parallèle, chacune dans son worktree (modèles/efforts
// différents). Tag commun fanoutId pour la vue comparative. Les worktrees isolent les variantes.
function spawnFanout({ name, cwd, prompt, host, perm, provider, effort, variants }) {
  if (!cwd || !String(cwd).trim()) throw new Error("workspace requis");
  if (!prompt || !String(prompt).trim()) throw new Error("mission requise");
  const list = (Array.isArray(variants) && variants.length) ? variants : [{ model: "opus" }, { model: "sonnet" }];
  if (list.length < 2) throw new Error("le fan-out demande au moins 2 variantes");
  if (list.length > 6) throw new Error("6 variantes maximum");
  const fanoutId = crypto.randomUUID().slice(0, 8);
  const label = (name && String(name).trim()) || projectName(cwd);
  const ids = [];
  list.forEach((v, i) => {
    const vlabel = (v.label && String(v.label).trim()) || (v.model ? (v.model[0].toUpperCase() + v.model.slice(1)) : ("Variante " + (i + 1)));
    const id = spawnAgent({
      name: label + " · " + vlabel, role: "variante", cwd, prompt, host,
      perm, provider: v.provider || provider, model: v.model || "sonnet", effort: v.effort || effort,
      worktree: true, fanoutId, variant: vlabel,
    });
    ids.push(id);
  });
  logAudit("fanout", { id: fanoutId, name: label, cwd, variants: list.length, host: host || "local" });
  return { fanoutId, ids, name: label };
}

// ============================================================================
// ORCA — DESIGN MODE : proxy d'aperçu + sélecteur d'élément.
// On sert la page d'un serveur de dev (sur un nœud du tailnet) EN SAME-ORIGIN
// depuis l'orchestrateur, avec <base href> (les assets chargent depuis l'origine)
// et un script injecté : survol = surbrillance, clic = postMessage(outerHTML +
// styles calculés) vers le parent, qui l'envoie à l'agent. Best-effort : parfait
// pour du statique/SSR ; un SPA qui fait des fetch relatifs peut être limité (CORS).
// ============================================================================
const PICKER_JS = `(function(){var on=false,last=null,box=null;
function mkbox(){if(box)return box;box=document.createElement('div');box.setAttribute('data-fleet-pick','1');box.style.cssText='position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #c62f36;background:rgba(198,47,54,.14);border-radius:3px;box-shadow:0 0 0 1px rgba(198,47,54,.4)';document.documentElement.appendChild(box);return box;}
function sel(el){if(!el||el===document.body)return 'body';var t=el.tagName.toLowerCase();if(el.id)return t+'#'+el.id;if(typeof el.className==='string'&&el.className.trim()){var c=el.className.trim().split(/\\s+/).slice(0,2).join('.');if(c)t+='.'+c;}return t;}
function move(e){if(!on)return;var el=e.target;if(!el||el===last)return;last=el;var r=el.getBoundingClientRect();var b=mkbox();b.style.left=r.left+'px';b.style.top=r.top+'px';b.style.width=r.width+'px';b.style.height=r.height+'px';}
function click(e){if(!on)return;e.preventDefault();e.stopPropagation();var el=e.target;var cs=getComputedStyle(el);var st={};['color','background-color','font-size','font-family','font-weight','padding','margin','border','border-radius','display'].forEach(function(k){st[k]=cs.getPropertyValue(k);});var r=el.getBoundingClientRect();try{parent.postMessage({__fleetPick:{selector:sel(el),tag:el.tagName.toLowerCase(),id:el.id||'',cls:(typeof el.className==='string'?el.className:''),text:(el.innerText||'').slice(0,240),html:el.outerHTML.slice(0,1400),styles:st,rect:{w:Math.round(r.width),h:Math.round(r.height)}}},'*');}catch(_){}}
window.addEventListener('message',function(e){if(e.data&&typeof e.data.__fleetPickMode!=='undefined'){on=!!e.data.__fleetPickMode;if(!on&&box){box.style.width='0';box.style.height='0';}}},false);
document.addEventListener('mousemove',move,true);document.addEventListener('click',click,true);
})();`;
function fetchHtmlDoc(u, cb, redirs) {
  redirs = redirs || 0; if (redirs > 5) return cb(new Error("trop de redirections"));
  let mod, parsed; try { parsed = new URL(u); mod = parsed.protocol === "https:" ? https : require("http"); } catch { return cb(new Error("url invalide")); }
  const r = mod.get(u, { headers: { "User-Agent": "fleet-office-design", Accept: "text/html,*/*" }, timeout: 12000 }, (resp) => {
    if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) { resp.resume(); try { return fetchHtmlDoc(new URL(resp.headers.location, u).toString(), cb, redirs + 1); } catch { return cb(new Error("redirection illisible")); } }
    const ct = resp.headers["content-type"] || ""; const chunks = []; let len = 0;
    resp.on("data", (d) => { len += d.length; if (len > 8 * 1024 * 1024) { resp.destroy(); } else chunks.push(d); });
    resp.on("end", () => cb(null, { ct, body: Buffer.concat(chunks).toString("utf8"), finalUrl: u }));
  });
  r.on("error", (e) => cb(e)); r.on("timeout", () => { r.destroy(); cb(new Error("délai dépassé")); });
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
  if (p === "/api/host") {
    const name = url.searchParams.get("name") || "local";
    return hostMetrics(name).then((m) => sendJSON(res, 200, m)).catch((e) => sendJSON(res, 200, { name, online: false, error: String(e.message || e) }));
  }
  if (p === "/api/roles" && req.method !== "POST") { return sendJSON(res, 200, { roles: allRoles() }); }
  if (req.method === "POST" && p === "/api/roles") {
    const b = await readBody(req);
    try { return sendJSON(res, 200, { ok: true, roles: addRole(b.role) }); }
    catch (e) { return sendJSON(res, 400, { ok: false, error: String(e.message || e) }); }
  }
  // ---- vue d'équipe : TEAM_NOTES.md (local ou nœud distant, lecture asynchrone) + message à toute l'équipe ----
  if (p === "/api/teamnotes" && req.method === "GET") {
    const tid = url.searchParams.get("teamId") || "";
    const m = [...managed.values()].find((x) => x.teamId === tid && x.cwd && x.cwd !== "~" && x.cwd !== "-");
    if (!m) return sendJSON(res, 404, { ok: false, error: "équipe introuvable" });
    const file = String(m.cwd).replace(/\/+$/, "") + "/TEAM_NOTES.md", host = m.host && m.host !== "local" ? m.host : null;
    const done = (err, text) => sendJSON(res, 200, { ok: !err, text: err ? "" : text, path: file, host: host || "local", missing: !!err });
    if (!host) { fs.readFile(file, "utf8", (e, t) => done(e, (t || "").slice(-60000))); return; }
    exec("timeout -k 3 8 ssh " + SSH_OPTS.join(" ") + " " + shq(host) + " " + shq("tail -c 60000 " + shq(file)), { timeout: 12000, killSignal: "SIGKILL", maxBuffer: 4 * 1024 * 1024 }, (e, out) => done(e, out || ""));
    return;
  }
  if (req.method === "POST" && p === "/api/team-send") {
    const b = await readBody(req);
    try {
      const text = String(b.prompt || "").trim(); if (!text) throw new Error("message vide");
      const targets = [...managed.values()].filter((m) => m.teamId === b.teamId && (!b.onlyChief || m.chief));
      if (!targets.length) throw new Error("équipe introuvable");
      for (const m of targets) sendAgent(m.id, "📣 Message de l'humain à toute l'équipe : " + text);
      logAudit("team-send", { teamId: b.teamId, members: targets.length });
      broadcast(true); return sendJSON(res, 200, { ok: true, sent: targets.length });
    } catch (e) { return sendJSON(res, 400, { ok: false, error: String(e.message || e) }); }
  }
  // ---- skillhub (bibliothèque partagée, classée) + métiers + conseiller ----------------------------
  if (p === "/api/skillhub/search" && req.method === "GET") { const q = url.searchParams; return sendJSON(res, 200, { ok: true, results: skillsys.search(q.get("q") || "", { limit: +q.get("limit") || 12, category: q.get("category") || "" }) }); }
  if (p === "/api/skillhub/library" && req.method === "GET") { const q = url.searchParams; return sendJSON(res, 200, { ok: true, ...skillsys.library({ sort: q.get("sort") || "rank", category: q.get("category") || "", limit: +q.get("limit") || 400 }) }); }
  if (p === "/api/skillhub/get" && req.method === "GET") {
    try { const r = skillsys.readSkill(url.searchParams.get("id") || ""); if (url.searchParams.get("format") === "json") return sendJSON(res, 200, { ok: true, skill: r }); res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }); return res.end(r.text); }
    catch (e) { return sendJSON(res, 404, { ok: false, error: String(e.message || e) }); }
  }
  if (p === "/api/jobs" && req.method === "GET") return sendJSON(res, 200, { ok: true, jobs: skillsys.listJobs() });
  if (req.method === "POST" && (p.startsWith("/api/skillhub/") || p.startsWith("/api/jobs/"))) {
    const b = await readBody(req);
    try {
      if (p === "/api/skillhub/feedback") return sendJSON(res, 200, { ok: true, skill: skillsys.feedback(b.id, b.vote) });
      if (p === "/api/skillhub/fetch") return sendJSON(res, 200, { ok: true, ...(await skillsys.searchOnline(b.query)) });
      if (p === "/api/jobs/save") { const j = skillsys.saveJob(b); logAudit("job-save", { name: j.name, skills: j.skills.length }); return sendJSON(res, 200, { ok: true, job: j }); }
      if (p === "/api/jobs/delete") { skillsys.deleteJob(b.name); return sendJSON(res, 200, { ok: true }); }
      if (p === "/api/jobs/advise") return sendJSON(res, 200, { ok: true, ...(await skillsys.advise(b)) });
      return sendJSON(res, 404, { ok: false, error: "action inconnue" });
    } catch (e) { return sendJSON(res, 400, { ok: false, error: String(e.message || e) }); }
  }
  // ---- évaluations (Arène) -------------------------------------------------------------------------------
  if (p === "/api/reviews" && req.method === "GET") { const q = url.searchParams; return sendJSON(res, 200, { ok: true, ...reviews.list({ agent: q.get("agent") || "", limit: +q.get("limit") || 100 }) }); }
  if (p === "/api/reviews/get" && req.method === "GET") { try { return sendJSON(res, 200, { ok: true, review: reviews.get(url.searchParams.get("id") || "") }); } catch (e) { return sendJSON(res, 404, { ok: false, error: String(e.message || e) }); } }
  if (req.method === "POST" && (p === "/api/reviews/run" || p === "/api/reviews/chat")) {
    const b = await readBody(req);
    try {
      if (p === "/api/reviews/run") { const r = await reviews.run(b.id); logAudit("review", { agent: r.agentId, name: r.name, score: r.score }); return sendJSON(res, 200, { ok: true, review: r }); }
      return sendJSON(res, 200, { ok: true, ...(await reviews.chat(b.id, b.message)) });
    } catch (e) { return sendJSON(res, 400, { ok: false, error: String(e.message || e) }); }
  }
  if (p === "/api/world" && req.method === "GET") { try { return sendJSON(res, 200, { ok: true, ...world.get() }); } catch (e) { return sendJSON(res, 500, { ok: false, error: String(e.message || e) }); } }
  // ---- export d'une carte Tiled depuis le monde (fichiers écrits dans public/world/maps/ uniquement) ----
  if (req.method === "POST" && p === "/api/world/export") {
    const b = await readBody(req);
    try {
      const files = Array.isArray(b.files) ? b.files : []; if (!files.length || files.length > 200) throw new Error("fichiers invalides");
      const root = path.join(PUBLIC_DIR, "world", "maps"); let n = 0, bytes = 0;
      for (const f of files) {
        const rel = String(f.path || ""); if (!/^maps\/[a-z0-9_\-]+(\/[a-z0-9_\-]+)*\.(tmj|png|json)$/i.test(rel) || rel.includes("..")) throw new Error("chemin refusé : " + rel);
        const buf = f.b64 ? Buffer.from(String(f.b64), "base64") : Buffer.from(String(f.text || ""), "utf8"); bytes += buf.length; if (bytes > 12 * 1024 * 1024) throw new Error("export trop gros");
        const dest = path.join(PUBLIC_DIR, "world", rel); if (!dest.startsWith(root + path.sep)) throw new Error("chemin refusé");
        fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, buf); n++;
      }
      logAudit("world-export", { files: n, bytes }); return sendJSON(res, 200, { ok: true, files: n, bytes });
    } catch (e) { return sendJSON(res, 400, { ok: false, error: String(e.message || e) }); }
  }
  // fermer / rouvrir une session depuis la ville 3D (la maison mémorise les sessions fermées)
  if (req.method === "POST" && p === "/api/world/close") {
    const b = await readBody(req);
    try {
      const rec = managed.get(b.id), a = snapshot().agents.find((x) => x.id === b.id); if (!rec && !a) throw new Error("agent introuvable");
      const src = rec || a, key = world.keyOf(a || { cwd: src.cwd, repoRoot: src.repoRoot });
      world.recordClosed(key, { id: b.id, name: src.name, role: src.role, cwd: src.cwd, host: src.host || "local", model: src.model || "sonnet", perm: src.perm || DEFAULT_PERM, startedAt: src.startedAt });
      killAgent(b.id); broadcast(true); return sendJSON(res, 200, { ok: true });
    } catch (e) { return sendJSON(res, 400, { ok: false, error: String(e.message || e) }); }
  }
  if (req.method === "POST" && p === "/api/world/reopen") {
    const b = await readBody(req);
    try {
      const m = world.takeClosed(b.id); if (!m) throw new Error("session fermée introuvable");
      hidden.delete(m.id); managed.set(m.id, { id: m.id, name: m.name, role: m.role, cwd: m.cwd, host: m.host === "local" ? undefined : m.host, model: m.model, perm: m.perm, status: "idle", startedAt: m.startedAt || Date.now(), lastPrompt: null, costUsd: 0, adopted: true });
      broadcast(true); return sendJSON(res, 200, { ok: true });
    } catch (e) { return sendJSON(res, 400, { ok: false, error: String(e.message || e) }); }
  }
  if (req.method === "POST" && p === "/api/world/remove") { const b = await readBody(req); try { world.remove(b.key); return sendJSON(res, 200, { ok: true }); } catch (e) { return sendJSON(res, 400, { ok: false, error: String(e.message || e) }); } }
  if (p === "/api/automations" && req.method === "GET") return sendJSON(res, 200, { ok: true, automations: automations.list(), tz: require("./automations").TZ });
  if (req.method === "POST" && p.startsWith("/api/automations/")) {
    const b = await readBody(req);
    try {
      const act = p.slice("/api/automations/".length);
      if (act === "save") return sendJSON(res, 200, { ok: true, automation: automations.upsert(b) });
      if (act === "toggle") return sendJSON(res, 200, { ok: true, automation: automations.toggle(b.id, b.enabled) });
      if (act === "delete") { automations.remove(b.id); return sendJSON(res, 200, { ok: true }); }
      if (act === "run") { const id = automations.runNow(b.id); return sendJSON(res, 200, { ok: true, id }); }
      return sendJSON(res, 404, { ok: false, error: "action inconnue" });
    } catch (e) { return sendJSON(res, 400, { ok: false, error: String(e.message || e) }); }
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
    try { trainAgent(b.id, b.role); broadcast(true); return sendJSON(res, 200, { ok: true }); }
    catch (e) { return sendJSON(res, 400, { ok: false, error: String(e.message || e) }); }
  }
  if (req.method === "POST" && p === "/api/rename") {
    const b = await readBody(req);
    try { renameAgent(b.id, b.name); broadcast(true); return sendJSON(res, 200, { ok: true, name: String(b.name || "").trim() }); }
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

  // ---- ORCA : revue de diff, merge/discard, fan-out parallèle ----
  if (p === "/api/diff") {
    const id = url.searchParams.get("id") || "";
    try { return sendJSON(res, 200, agentDiff(id)); }
    catch (e) { return sendJSON(res, 400, { git: false, error: String(e.message || e) }); }
  }
  if (req.method === "POST" && p === "/api/merge") {
    const b = await readBody(req);
    try { const r = mergeWorktree(b.id); broadcast(true); return sendJSON(res, r.ok ? 200 : 409, r); }
    catch (e) { return sendJSON(res, 400, { ok: false, error: String(e.message || e) }); }
  }
  if (req.method === "POST" && p === "/api/discard") {
    const b = await readBody(req);
    try { const r = discardWorktree(b.id); if (b.kill) { killAgent(b.id); } broadcast(true); return sendJSON(res, 200, r); }
    catch (e) { return sendJSON(res, 400, { ok: false, error: String(e.message || e) }); }
  }
  if (req.method === "POST" && p === "/api/fanout") {
    const b = await readBody(req);
    try { const r = spawnFanout(b); broadcast(true); return sendJSON(res, 200, { ok: true, ...r }); }
    catch (e) { return sendJSON(res, 400, { ok: false, error: String(e.message || e) }); }
  }
  // Design mode : aperçu proxifié same-origin + script sélecteur injecté
  if (p === "/api/proxy") {
    const target = url.searchParams.get("url") || "";
    if (!/^https?:\/\//i.test(target)) { res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("url http(s) requise"); }
    return fetchHtmlDoc(target, (err, r) => {
      if (err) { res.writeHead(502, { "Content-Type": "text/html; charset=utf-8" }); return res.end(`<!doctype html><body style="font-family:system-ui;background:#0a0a0b;color:#bbb;padding:34px;line-height:1.6">⚠️ Impossible de charger cette page.<br><br><b style="color:#c62f36">${String(target).replace(/[<>&"]/g, "")}</b><br>${String(err.message || err).replace(/[<>&]/g, "")}<br><br><span style="color:#64646b">Le nœud est-il joignable depuis l'orchestrateur ? Le serveur de dev tourne-t-il ?</span>`); }
      if (!/text\/html/i.test(r.ct)) { res.writeHead(200, { "Content-Type": r.ct || "application/octet-stream" }); return res.end(r.body); }
      let html = r.body;
      const base = '<base href="' + String(r.finalUrl).replace(/"/g, "&quot;") + '">';
      const inject = "<scr" + "ipt>" + PICKER_JS + "</scr" + "ipt>";
      if (/<head[^>]*>/i.test(html)) html = html.replace(/<head[^>]*>/i, (m) => m + base);
      else if (/<html[^>]*>/i.test(html)) html = html.replace(/<html[^>]*>/i, (m) => m + "<head>" + base + "</head>");
      else html = base + html;
      html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, inject + "</body>") : html + inject;
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "frame-ancestors *" });
      res.end(html);
    });
  }

  if (p === "/api/ls") {
    const host = url.searchParams.get("host") || "local";
    if (host && host !== "local") {
      return listRemoteDirs(host, url.searchParams.get("path") || "").then((r) => sendJSON(res, 200, r)).catch((e) => sendJSON(res, 400, { error: String(e.message || e), host }));
    }
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

  if (p === "/api/skills") { return sendJSON(res, 200, listSkills()); }
  if (p === "/api/audit") {
    const n = Math.min(parseInt(url.searchParams.get("n") || "200", 10) || 200, AUDIT_MAX);
    return sendJSON(res, 200, { total: auditLog.length, entries: auditLog.slice(-n).slice().reverse() });
  }
  if (p === "/api/skill") {
    const rel = url.searchParams.get("path") || "";
    try {
      const rootAbs = path.resolve(SKILLS_DIR);
      const full = path.resolve(SKILLS_DIR, rel);
      if (full !== rootAbs && !full.startsWith(rootAbs + path.sep)) throw new Error("hors périmètre");
      return sendJSON(res, 200, { path: rel, content: fs.readFileSync(full, "utf8").slice(0, 80000) });
    } catch (e) { return sendJSON(res, 400, { error: String(e.message || e) }); }
  }

  if (req.method === "POST" && p === "/api/skill-add") {
    const b = await readBody(req);
    return addSkillFromUrl(b.url, b.category).then((x) => { logAudit("skill-add", { name: x.name, category: x.category, url: b.url }); return sendJSON(res, 200, x); }).catch((e) => sendJSON(res, 400, { ok: false, error: String(e.message || e) }));
  }
  if (req.method === "POST" && p === "/api/skill-del") {
    const b = await readBody(req);
    try { const r = delSkill(b.path); logAudit("skill-del", { name: r.name, category: r.cat }); return sendJSON(res, 200, { ok: true, ...r }); } catch (e) { return sendJSON(res, 400, { ok: false, error: String(e.message || e) }); }
  }
  if (req.method === "POST" && p === "/api/skill-refetch") {
    const b = await readBody(req); const role = String(b.category || b.role || "").trim();
    if (!role) return sendJSON(res, 400, { ok: false, error: "catégorie requise" });
    try {
      if (fs.existsSync(SKILLS_FETCHER)) { const pr = spawn(process.execPath, [SKILLS_FETCHER, role, skillsFileFor(role), SKILLS_DIR, b.host && b.host !== "local" ? b.host : "local"], { cwd: __dirname, stdio: "ignore", detached: true }); pr.unref(); }
      logAudit("skill-refetch", { category: role, host: b.host || "local" });
      return sendJSON(res, 200, { ok: true, category: role });
    } catch (e) { return sendJSON(res, 400, { ok: false, error: String(e.message || e) }); }
  }

  if (p === "/api/transcript") {
    const id = url.searchParams.get("id") || "";
    const beforeParam = url.searchParams.get("before");
    const before = beforeParam ? parseInt(beforeParam, 10) : null;
    const n = Math.min(parseInt(url.searchParams.get("n") || "90", 10) || 90, 400);
    const w = renderTranscriptWindow(id, Number.isFinite(before) ? before : null);
    // avec `before` (chargement d'historique) : toute la fenêtre lue (pas de coupe par n, pour ne
    // jamais créer de trou entre ce qu'on renvoie et le curseur nextBefore annoncé).
    const feed = before == null ? w.feed.slice(-n) : w.feed;
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache" });
    return res.end(JSON.stringify({ id, feed, nextBefore: w.nextBefore, atStart: w.atStart }));
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

// ============================================================================
// TERMINAL PTY (bouton ▹_ du composer) : vrai shell interactif sur la machine/dossier de l'agent.
// Une connexion WS = un process pty dédié : local via node-pty, ou distant via `ssh -tt <host>`
// (le -tt force un vrai pty CÔTÉ DISTANT ; le pty LOCAL fourni par node-pty permet en plus à ce
// process ssh de détecter sa propre taille de terminal et de relayer les redimensionnements —
// sans lui, ssh lancé via un pipe simple ne verrait aucun terminal contrôlant et ignorerait les
// resize). Protocole JSON dans les 2 sens sur la même connexion :
//   client -> serveur : {type:"input", data} (frappe clavier)  |  {type:"resize", cols, rows}
//   serveur -> client : {type:"data", data} (sortie du shell)  |  {type:"exit", code|reason}
// ⚠️ PAS D'AUTHENTIFICATION (comme le reste de l'API) : quiconque atteint ce nœud sur le tailnet
// obtient un shell réel sur la machine de l'agent — accepté en connaissance de cause (demande
// explicite), mais à garder en tête si Fleet Office est un jour exposé au-delà du tailnet.
function resolveTermTarget(id) {
  const rec = ensureManaged(id);
  if (!rec) return null;
  return { cwd: rec.cwd || os.homedir(), host: (rec.host && rec.host !== "local") ? rec.host : null };
}
function spawnTerminalPty(target, cols, rows) {
  const env = Object.assign({}, process.env, { TERM: "xterm-256color" });
  if (!target.host) {
    const shell = process.env.SHELL || "/bin/bash";
    return pty.spawn(shell, ["-il"], { name: "xterm-256color", cols, rows, cwd: target.cwd, env });
  }
  const inner = "cd " + shq(target.cwd || "~") + ' 2>/dev/null; exec "${SHELL:-/bin/bash}" -il';
  return pty.spawn("ssh", [...SSH_OPTS, "-tt", target.host, inner], { name: "xterm-256color", cols, rows, env });
}
function wireTerminalWs(ws, id) {
  if (!pty) { try { ws.send(JSON.stringify({ type: "exit", reason: "PTY indisponible sur ce nœud (node-pty non chargé)." })); } catch { /* */ } return ws.close(); }
  const target = resolveTermTarget(id);
  if (!target) { try { ws.send(JSON.stringify({ type: "exit", reason: "agent introuvable" })); } catch { /* */ } return ws.close(); }
  let proc;
  try { proc = spawnTerminalPty(target, 80, 24); }
  catch (e) { try { ws.send(JSON.stringify({ type: "exit", reason: String(e.message || e) })); } catch { /* */ } return ws.close(); }
  proc.onData((d) => { try { ws.send(JSON.stringify({ type: "data", data: d })); } catch { /* connexion déjà fermée */ } });
  proc.onExit(({ exitCode }) => { try { ws.send(JSON.stringify({ type: "exit", code: exitCode })); } catch { /* */ } try { ws.close(); } catch { /* */ } });
  ws.on("message", (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.type === "input" && typeof m.data === "string") { try { proc.write(m.data); } catch { /* */ } }
    else if (m.type === "resize" && m.cols && m.rows) { try { proc.resize(m.cols, m.rows); } catch { /* */ } }
  });
  ws.on("close", () => { try { proc.kill(); } catch { /* */ } });
}
let termWss = null;
if (WebSocketServer) {
  termWss = new WebSocketServer({ noServer: true });
  termWss.on("connection", (ws, req) => { const u = new URL(req.url, "http://x"); wireTerminalWs(ws, u.searchParams.get("id") || ""); });
  server.on("upgrade", (req, socket, head) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/api/term") termWss.handleUpgrade(req, socket, head, (ws) => termWss.emit("connection", ws, req));
    else socket.destroy();
  });
}

server.listen(PORT, HOST, () => {
  const snap = snapshot();
  const lan = getLanAddresses();
  console.log(`\n  🏢  Fleet Office en ligne`);
  console.log(`  ➜  http://localhost:${PORT}`);
  for (const addr of lan) console.log(`  ➜  http://${addr}:${PORT}`);
  console.log(`  ➜  jobs surveillés : ${JOBS_DIR}`);
  console.log(`  ➜  agents détectés au démarrage : ${snap.total}`);
  console.log(`  ➜  terminal PTY : ${pty && WebSocketServer ? "disponible" : "indisponible (node-pty/ws non chargés)"}`);
  bootAdminAgent();
});
