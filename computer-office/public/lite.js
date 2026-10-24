"use strict";
/* FLEET OFFICE — agent dev environment (2D, inspiré d'Orca).
   Même orchestrateur : SSE /events + API /api/*. Sidebar par projet · board kanban ·
   session à onglets (Conversation/Diff/Terminal/Aperçu) · palette ⌘K. Zéro WebGL. */

const getJSON = (p) => fetch(p, { cache: "no-store" }).then((r) => r.json());
const post = (p, b) => fetch(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e.message || e) }));
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const STATUS = {
  working: { c: "var(--s-work)", l: "au travail" }, coworking: { c: "var(--s-cowork)", l: "collabore" },
  done: { c: "var(--s-done)", l: "terminé" }, idle: { c: "var(--s-idle)", l: "au repos" },
  queued: { c: "var(--s-idle)", l: "en file" }, blocked: { c: "var(--s-ask)", l: "en attente" },
  failed: { c: "var(--s-fail)", l: "erreur" },
};
const st = (a) => STATUS[a && a.status] || STATUS.idle;
// ---- icônes (jeu Lucide, ISC — celui d'Orca) -----------------------------------
const IP = {
  board: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  server: '<rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/>',
  book: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  palette: '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  branch: '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  sliders: '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
  chevD: '<path d="m6 9 6 6 6-6"/>', chevR: '<path d="m9 18 6-6-6-6"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  term: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
  msg: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  diff: '<path d="M12 3v14"/><path d="M5 10h14"/><path d="M5 21h14"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  clip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  up: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  xc: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  checkc: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  gear: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  crown: '<path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z"/><path d="M5.5 21h13"/>',
  grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  panel: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
  power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>',
  expand: '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
  logo: '<path d="M2 18c2.5-4 5-6 8-6s4 3 7 3 3.5-2 5-5"/><path d="M5 6c1-1.5 2.5-2 4-1.5"/><circle cx="17" cy="6.5" r="1.2" fill="currentColor"/>',
};
const ico = (n, s = 16) => `<svg class="i" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IP[n] || ""}</svg>`;
function hydrateIcons(root) { (root || document).querySelectorAll("[data-ico]").forEach((e) => { if (!e.dataset.done) { e.innerHTML = ico(e.dataset.ico, +e.dataset.s || 16); e.dataset.done = "1"; } }); }
// indicateur d'état façon Orca : anneau qui tourne (travaille), « ? » orange (attend), check (terminé), point gris (repos)
function stGlyph(a, big) {
  const s = a && a.status, cls = "gl" + (big ? " lg" : ""), z = big ? 15 : 13;
  if (a && (a.busy || s === "working")) return `<span class="${cls}" title="au travail"><span class="spin"></span></span>`;
  if (s === "blocked") return `<span class="${cls} ask" title="attend une réponse">${ico("help", z)}</span>`;
  if (s === "failed") return `<span class="${cls} fail" title="erreur">${ico("xc", z)}</span>`;
  if (a && isReview(a)) return `<span class="${cls} rev" title="à revoir">${ico("diff", z - 1)}</span>`;
  if (s === "done") return `<span class="${cls} done" title="terminé">${ico("checkc", z)}</span>`;
  return `<span class="${cls}" title="${esc(st(a).l)}"><i class="dot"></i></span>`;
}
const AVPAL = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `var(--av${i})`);
const hashc = (s) => { let h = 0; for (let i = 0; i < (s || "").length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AVPAL[h % AVPAL.length]; };
const fmtCost = (n) => { n = n || 0; return n >= 1 ? "$" + n.toFixed(0) : "$" + n.toFixed(2); };
const fmtTok = (n) => { n = n || 0; return n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(0) + "k" : "" + n; };
const initial = (s) => (String(s || "?").trim()[0] || "?").toUpperCase();
const projectOf = (a) => a.project || (a.cwd ? (String(a.cwd).replace(/\/+$/, "").split("/").pop() || a.cwd) : "—");
function mdLegacy(src) {
  let s = esc(String(src == null ? "" : src));
  const blocks = [];
  s = s.replace(/```([\s\S]*?)```/g, (_, c) => { blocks.push(c.replace(/^\n/, "")); return "\u0000CB" + (blocks.length - 1) + "\u0000"; });
  s = s.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  s = s.replace(/^######\s+(.*)$/gm, "<h6>$1</h6>").replace(/^#####\s+(.*)$/gm, "<h6>$1</h6>").replace(/^####\s+(.*)$/gm, "<h5>$1</h5>").replace(/^###\s+(.*)$/gm, "<h5>$1</h5>").replace(/^##\s+(.*)$/gm, "<h4>$1</h4>").replace(/^#\s+(.*)$/gm, "<h4>$1</h4>");
  s = s.replace(/^\s*([-*_])\1{2,}\s*$/gm, "<hr>");
  s = s.replace(/^&gt;\s?(.*)$/gm, "<blockquote>$1</blockquote>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/__([^_]+)__/g, "<b>$1</b>");
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*/g, "$1<i>$2</i>");
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  s = s.replace(/(?:^|\n)((?:[ \t]*[-*]\s+.*(?:\n|$))+)/g, (_, it) => "\n<ul>" + it.trim().split(/\n/).map((l) => "<li>" + l.replace(/^[ \t]*[-*]\s+/, "").trim() + "</li>").join("") + "</ul>\n");
  s = s.replace(/(?:^|\n)((?:[ \t]*\d+\.\s+.*(?:\n|$))+)/g, (_, it) => "\n<ol>" + it.trim().split(/\n/).map((l) => "<li>" + l.replace(/^[ \t]*\d+\.\s+/, "").trim() + "</li>").join("") + "</ol>\n");
  s = s.split(/\n{2,}/).map((para) => /^\s*<(h4|h5|h6|ul|ol|blockquote|hr|pre)/.test(para.trim()) ? para : (para.trim() ? "<p>" + para.trim().replace(/\n/g, "<br>") + "</p>" : "")).join("");
  s = s.replace(/\u0000CB(\d+)\u0000/g, (_, i) => "<pre><code>" + blocks[+i] + "</code></pre>");
  return s;
}
function mdToHtml(src) { if (window.FleetMD) { try { return FleetMD.render(src); } catch {} } return mdLegacy(src); }
const ago = (ms) => { if (!ms) return ""; const s = (Date.now() - ms) / 1000; if (s < 60) return "à l'instant"; if (s < 3600) return Math.floor(s / 60) + " min"; if (s < 86400) return Math.floor(s / 3600) + " h"; return Math.floor(s / 86400) + " j"; };
const MODELS = [{ v: "opus", l: "Opus 5" }, { v: "sonnet", l: "Sonnet 5" }, { v: "fable", l: "Fable 5" }, { v: "haiku", l: "Haiku 4.5" }];
const chg = (c) => c ? `<span class="ac-stat"><span class="add">+${c.add || 0}</span> <span class="del">−${c.del || 0}</span></span>` : "";

let snap = { agents: [], teams: [], cto: {} };
let detailId = null, view = "board", centerTab = "conv", query = "", railFilter = "all", ctxTab = "ctx";
let diffData = null, pendingComments = [], openCommentKey = null;
let spawnMode = "solo", variantRows = [];
let feedTimer = null, hostTimer = null, machTimer = null, railHostsTimer = null, slashList = [];
let railHostsCache = [{ id: "local", label: "local", ip: "127.0.0.1", online: true }];

const agentById = (id) => (snap.agents || []).find((x) => x.id === id) ||
  (snap.agents || []).flatMap((a) => a.subAgents || []).find((x) => x.id === id) || null;
const isReview = (a) => a.worktree && a.changes && a.changes.files > 0 && !a.busy;
const isActive = (a) => a.busy || a.status === "working" || a.status === "queued";

// ---- SSE ----------------------------------------------------------------------
let es = null, reconnectT = null;
function connect() {
  if (es) try { es.close(); } catch {}
  setNet(false);
  try { es = new EventSource("/events"); } catch { return scheduleReconnect(); }
  es.addEventListener("snapshot", (e) => { setNet(true); try { snap = JSON.parse(e.data); } catch { return; } onSnapshot(); });
  es.onerror = () => { setNet(false); scheduleReconnect(); };
}
function scheduleReconnect() { clearTimeout(reconnectT); reconnectT = setTimeout(connect, 2500); }
function setNet(live) { $("net").classList.toggle("live", live); $("net").title = live ? "en direct" : "hors-ligne"; }

function onSnapshot() {
  const ags = snap.agents || [];
  $("nav-agents").textContent = ags.length;
  $("nav-machines").textContent = new Set(ags.map((a) => a.host).filter(Boolean)).size + 1;
  renderSidebar(); renderStatusline(); renderTabbar();
  if (view === "board" && !detailId) { applyCenterVisibility(); renderBoard(); }
  $("nav-teams").textContent = (snap.teams || []).length;
  if (view === "teams" && !detailId) renderTeams();
  if (view === "machines") renderMachines();
  if (detailId) {
    const a = agentById(detailId);
    if (a) { renderSessHead(a); updateComposer(a); updateFanoutBar(a); updateMobileTitle(a); if (ctxTab === "ctx" && $("app").classList.contains("ctx-open")) renderCtx(a); }
    else { clearDetail(); }
  }
}

// ---- SIDEBAR : sessions groupées par projet -----------------------------------
async function pollRailHosts() {
  try { const j = await getJSON("/api/hosts"); if (j.hosts && j.hosts.length) railHostsCache = j.hosts; } catch {}
}
function agentMatches(a) {
  if (query) { const hay = [a.name, a.role, projectOf(a), a.branch, a.host, a.model].filter(Boolean).join(" ").toLowerCase(); if (!hay.includes(query)) return false; }
  if (railFilter === "active") return isActive(a);
  if (railFilter === "review") return isReview(a);
  if (railFilter === "idle") return !isActive(a) && !isReview(a);
  return true;
}
// Workspace dérivé du chemin : ~/Bureau/Projects/[MICRO/]<WS>/<client…> -> ASKEAL / EXPLORIA / ARTHUR ; le reste = Infra & perso
const WS_SKIP = new Set(["micro"]);
function wsOf(a) {
  const cwd = String(a.cwd || "").replace(/\/+$/, "");
  const m = cwd.match(/\/Projects\/(.+)$/i);
  if (m) {
    const seg = m[1].split("/").filter(Boolean).filter((x) => !WS_SKIP.has(x.toLowerCase()));
    if (seg.length) { const rest = seg.slice(1); return { ws: seg[0], label: rest.length ? rest.slice(-2).join(" / ") : "", root: !rest.length }; }
  }
  if (!cwd || cwd === "~" || cwd === "-" || /^\/home\/[^/]+$/.test(cwd)) return { ws: "Infra & perso", label: "", root: true };
  return { ws: "Infra & perso", label: projectOf(a), root: false };
}
function relT(t) {
  if (typeof t === "string") t = Date.parse(t); if (!t) return "";
  const s = (Date.now() - t) / 1000;
  return s < 90 ? "à l'instant" : s < 3600 ? Math.round(s / 60) + " min" : s < 86400 ? Math.round(s / 3600) + " h" : Math.round(s / 86400) + " j";
}
const LSJ = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || ""); return v == null ? d : v; } catch { return d; } };
const LSW = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
let favs = new Set(LSJ("fleet.favs", [])), wsCollapsed = LSJ("fleet.wsCollapsed", {});
// ---- palettes par conversation : marqueur visuel (onglets, sidebar, board) + thème appliqué à l'ouverture
let sessThemes = LSJ("fleet.sessThemes", {}), thScope = "global";
const sessPal = (id) => { const T = window.FleetTheme, pid = sessThemes[id]; return (T && pid && T.get(pid)) || null; };
function applySessionTheme(id) { if (window.FleetTheme) FleetTheme.override(id && sessPal(id) ? sessThemes[id] : null); }
function setSessionTheme(id, pid) {
  if (pid) sessThemes[id] = pid; else delete sessThemes[id];
  LSW("fleet.sessThemes", sessThemes); applySessionTheme(id);
  renderTabbar._sig = null; renderTabbar(); renderSidebar(); if (view === "board" && !detailId) renderBoard();
}
const tcAttr = (id) => { const p = sessPal(id); return p ? ` tcol" style="--tc:${p.acc}` : ""; };
function toggleFav(id) { favs.has(id) ? favs.delete(id) : favs.add(id); LSW("fleet.favs", [...favs]); renderSidebar(); }

function agentCard(a) {
  const review = isReview(a), w = wsOf(a), fav = favs.has(a.id);
  const lab = w.label && w.label.toLowerCase() !== String(a.name).toLowerCase() ? w.label : "";
  const second = a.worktree && a.branch ? `<span class="ac-branch">${ico("branch", 11)}<span>${esc(a.branch)}</span></span>` : `<span class="ac-lab">${esc(lab || w.ws)}</span>`;
  const intent = a.busy ? (a.intent || a.lastPrompt || "") : "";
  const statusLine = intent ? `<div class="ac-status-line">${esc(String(intent).slice(0, 90))}</div>` : "";
  const sa = a.subAgents || [];
  const subs = sa.length ? `<div class="ac-subs"><div class="ac-subs-h">${sa.length} agent${sa.length > 1 ? "s" : ""}</div>${sa.map((s) => `<div class="subrow" data-sub="${esc(s.id)}">${stGlyph(s)}<span class="sn">${esc(s.name || s.role || "sous-agent")}</span></div>`).join("")}</div>` : "";
  const badge = a.teamName ? `<span class="ac-badge" data-team="${esc(a.teamId || "")}" title="Équipe « ${esc(a.teamName)} » — ouvrir la vue d'équipe">${ico("users", 11)}</span>` : (a.fanoutId ? `<span class="ac-badge" title="fan-out">${ico("branch", 11)}</span>` : "");
  return `<button class="acard ${detailId === a.id ? "sel" : ""} ${a.busy ? "working" : ""}${tcAttr(a.id)}" data-card="${esc(a.id)}" title="${esc((a.model || "") + (a.host ? " · " + a.host : ""))}">
    <div class="ac-top">${stGlyph(a)}<span class="ac-name">${esc(a.name)}</span>${badge}${review ? `<span class="ac-pill">à revoir</span>` : ""}${a.changes ? chg(a.changes) : ""}<span class="ac-star ${fav ? "on" : ""}" data-star="${esc(a.id)}" title="${fav ? "Retirer des favoris" : "Épingler"}">${ico("star", 12)}</span></div>
    <div class="ac-sub">${second}<span class="ac-right"><span class="ac-host">${esc(a.host || "local")}</span><span class="ac-time">${esc(relT(a.updatedAt) || "")}</span></span></div>
    ${statusLine}${subs}
  </button>`;
}
const recency = (x, y) => (b2(y) - b2(x)) || ((Date.parse(y.updatedAt) || y.updatedAt || 0) - (Date.parse(x.updatedAt) || x.updatedAt || 0));
function renderSidebar() {
  const el = $("rail-list");
  const ags = (snap.agents || []).filter((a) => !a.internal).filter(agentMatches);
  if (!ags.length) { el.innerHTML = `<div class="rail-empty">${query || railFilter !== "all" ? "Aucune session pour ce filtre." : "Aucune session.<br>＋ Nouvelle tâche pour commencer."}</div>`; wireSidebar(el); return; }
  const pinned = ags.filter((a) => favs.has(a.id)).sort(recency);
  const groups = {};
  for (const a of ags) if (!favs.has(a.id)) { const w = wsOf(a).ws; (groups[w] = groups[w] || []).push(a); }
  let html = pinned.length ? `<div class="proj-group fav"><div class="proj-h static"><span class="pi">${ico("star", 14)}</span><span class="pname">Favoris</span><span class="pn">${pinned.length}</span></div>${pinned.map(agentCard).join("")}</div>` : "";
  const names = Object.keys(groups).sort((x, y) => {
    const ax = groups[x].some(isActive), ay = groups[y].some(isActive);
    if (ax !== ay) return ax ? -1 : 1;
    if ((x === "Infra & perso") !== (y === "Infra & perso")) return x === "Infra & perso" ? 1 : -1;
    return (Math.max(...groups[y].map((q) => Date.parse(q.updatedAt) || q.updatedAt || 0))) - (Math.max(...groups[x].map((q) => Date.parse(q.updatedAt) || q.updatedAt || 0)));
  });
  html += names.map((w) => {
    const list = groups[w].sort(recency), nAct = list.filter(isActive).length, hasSel = list.some((a) => a.id === detailId);
    const def = !(nAct || hasSel || list.length <= 3);
    const col = !query && (w in wsCollapsed ? wsCollapsed[w] : def) && !hasSel;
    return `<div class="proj-group ${col ? "collapsed" : ""}"><div class="proj-h" data-ws="${esc(w)}"><span class="pi">${ico(w === "Infra & perso" ? "server" : "folder", 15)}</span><span class="pname">${esc(w)}</span>${nAct ? `<span class="pact" title="${nAct} au travail"><span class="spin"></span>${nAct}</span>` : ""}<span class="pn">${list.length}</span><span class="chev">${ico(col ? "chevR" : "chevD", 12)}</span></div>${col ? "" : list.map(agentCard).join("")}</div>`;
  }).join("");
  el.innerHTML = html;
  wireSidebar(el);
}
const b2 = (a) => isActive(a) ? 2 : isReview(a) ? 1 : 0;
function wireSidebar(el) {
  el.querySelectorAll("[data-card]").forEach((c) => (c.onclick = (e) => { if (e.target.closest("[data-sub]") || e.target.closest("[data-star]") || e.target.closest("[data-team]")) return; select(c.dataset.card); }));
  el.querySelectorAll("[data-team]").forEach((x) => (x.onclick = (e) => { e.stopPropagation(); if (x.dataset.team) openTeamView(x.dataset.team); }));
  el.querySelectorAll("[data-star]").forEach((x) => (x.onclick = (e) => { e.stopPropagation(); toggleFav(x.dataset.star); }));
  el.querySelectorAll("[data-ws]").forEach((h) => (h.onclick = () => { const w = h.dataset.ws, was = h.parentElement.classList.contains("collapsed"); wsCollapsed[w] = !was; LSW("fleet.wsCollapsed", wsCollapsed); renderSidebar(); }));
  el.querySelectorAll("[data-sub]").forEach((s) => (s.onclick = (e) => { e.stopPropagation(); select(s.dataset.sub); }));
}
$("rail-filter").querySelectorAll(".chip").forEach((b) => (b.onclick = () => { railFilter = b.dataset.filter; $("rail-filter").querySelectorAll(".chip").forEach((x) => x.classList.toggle("sel", x === b)); renderSidebar(); }));

function renderStatusline() {
  const a = snap.agents || [], cto = snap.cto || {};
  const active = a.filter(isActive).length, review = a.filter(isReview).length;
  $("statusline").innerHTML =
    `<span class="sl"><span class="mi">◉</span><b>${active}</b> actifs</span>` +
    `<span class="sl"><span class="mi">◇</span><b>${review}</b> à revoir</span>` +
    `<span class="sl"><span class="mi">∑</span><b>${a.length}</b> sessions</span>` +
    `<span class="sl"><span class="mi">$</span><b>${fmtCost(cto.costUsd)}</b></span>` +
    `<span class="sl"><span class="mi">⛁</span><b>${fmtTok(cto.tokens)}</b> tok</span>` +
    (snap.bedrock ? `<span class="sl" title="AWS Bedrock prêt"><span class="mi">☁</span>Bedrock</span>` : "");
}

// ---- BOARD kanban -------------------------------------------------------------
let boardMode = LSJ("fleet.boardMode", "status"), boardIdleAll = false;
const IDLE_CAP = 8;
function renderBoard() {
  const el = $("board");
  const ags = (snap.agents || []).filter((a) => !a.internal).filter((a) => !query || [a.name, projectOf(a), wsOf(a).ws, a.branch].filter(Boolean).join(" ").toLowerCase().includes(query)).sort(recency);
  let cols;
  if (boardMode === "project") {
    const g = {}; ags.forEach((a) => { const w = wsOf(a).ws; (g[w] = g[w] || []).push(a); });
    cols = Object.keys(g).sort((x, y) => (g[y].some(isActive) - g[x].some(isActive)) || ((x === "Infra & perso") - (y === "Infra & perso"))).map((w) => ({ key: "ws", label: w, dot: g[w].some(isActive) ? "var(--s-work)" : "var(--s-idle)", items: g[w] }));
  } else {
    const idle = ags.filter((a) => !isActive(a) && !isReview(a));
    cols = [
      { key: "work", label: "Au travail", dot: "var(--s-work)", items: ags.filter(isActive) },
      { key: "review", label: "En revue", dot: "var(--s-review)", items: ags.filter(isReview) },
      { key: "idle", label: "Au repos · à reprendre", dot: "var(--s-idle)", items: idle, more: !boardIdleAll && idle.length > IDLE_CAP },
    ];
  }
  const seg = (m, l) => `<button class="pseg ${boardMode === m ? "sel" : ""}" data-bmode="${m}">${l}</button>`;
  el.innerHTML = `<div class="board-bar"><div class="psegs">${seg("status", "Par statut")}${seg("project", "Par projet")}</div><span class="bb-sum">${ags.filter(isActive).length} au travail · ${ags.length} sessions</span></div>
  <div class="board-cols">${cols.map((c) => {
    const shown = c.more ? c.items.slice(0, IDLE_CAP) : c.items;
    return `<div class="bcol"><div class="bcol-h"><span class="bdot" style="background:${c.dot}"></span>${esc(c.label)}<span class="bn">${c.items.length}</span></div>
    <div class="bcol-body">${shown.length ? shown.map((a) => boardCard(a, c.key)).join("") : `<div class="bcol-empty">—</div>`}${c.more ? `<button class="bmore" data-bmore>+ ${c.items.length - IDLE_CAP} de plus</button>` : ""}</div></div>`;
  }).join("")}</div>`;
  el.querySelectorAll("[data-bmode]").forEach((b) => (b.onclick = () => { boardMode = b.dataset.bmode; LSW("fleet.boardMode", boardMode); renderBoard(); }));
  el.querySelectorAll("[data-bmore]").forEach((b) => (b.onclick = () => { boardIdleAll = true; renderBoard(); }));
  el.querySelectorAll("[data-bcard]").forEach((cd) => (cd.onclick = (e) => { if (e.target.closest("button")) return; select(cd.dataset.bcard); }));
  el.querySelectorAll("[data-review]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); select(b.dataset.review); setTimeout(() => setCenterTab("diff"), 60); }));
  el.querySelectorAll("[data-merge]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const a = agentById(b.dataset.merge); if (a) doMerge(a); }));
}
function boardCard(a, col) {
  const w = wsOf(a);
  const branch = a.worktree && a.branch ? `<div class="bc-branch">${ico("branch", 11)}<span>${esc(a.branch)}</span></div>` : "";
  const lab = w.label && w.label.toLowerCase() !== String(a.name).toLowerCase() ? w.label : "";
  const sub = (col !== "ws" ? w.ws + (lab ? " · " + lab : "") : lab) || "";
  const actions = col === "review"
    ? `<div class="bc-actions"><button class="review" data-review="${esc(a.id)}">Revoir</button><button class="merge" data-merge="${esc(a.id)}">Merger</button></div>` : "";
  return `<div class="bcard${tcAttr(a.id)}" data-bcard="${esc(a.id)}">
    <div class="bc-top">${stGlyph(a)}<span class="bc-name">${esc(a.name)}</span><span class="bc-model">${esc(a.model || "—")}</span></div>
    ${sub ? `<div class="bc-proj">${esc(sub)}</div>` : ""}${branch}
    <div class="bc-foot">${a.changes ? `<span class="bc-stat"><span class="add">+${a.changes.add || 0}</span> <span class="del">−${a.changes.del || 0}</span></span>` : `<span style="color:var(--mut2)">${esc(st(a).l)} · ${esc(relT(a.updatedAt) || "—")}</span>`}<span class="bc-host">${esc(a.host || "local")}</span></div>
    ${actions}</div>`;
}

// ---- sélection / session ------------------------------------------------------
function select(id) {
  const a = agentById(id); if (!a) return;
  detailId = id; applySessionTheme(id); slashList = a.slashCommands || [];
  centerTab = "conv"; diffData = null; pendingComments = []; openCommentKey = null;
  teardownTerminal();
  renderConv._html = null; updateQuickReplies._sig = null; $("c-quickreply").classList.add("hidden");
  resetHistoryState();
  renderSessHead(a); updateComposer(a); updateFanoutBar(a); updateMobileTitle(a);
  renderSessTabs(); applyCenterVisibility();
  $("conv").innerHTML = `<div class="empty">chargement du flux…</div>`;
  clearInterval(feedTimer); pollFeed(); feedTimer = setInterval(pollFeed, 1500);
  clearInterval(hostTimer); pollHost(a); hostTimer = setInterval(() => pollHost(agentById(detailId)), 15000);
  addTab(id); renderTabbar(); renderSidebar(); closeDrawers();
}
function clearDetail() {
  detailId = null; applySessionTheme(null); centerTab = "conv"; diffData = null; teardownTerminal();
  clearInterval(feedTimer); clearInterval(hostTimer);
  $("app").classList.remove("ctx-open");
  applyCenterVisibility(); renderSidebar(); renderTabbar();
}
function renderSessHead(a) {
  const branch = a.worktree && a.branch ? `<span class="sh-chip br">${ico("branch", 11)}${esc(a.branch)}</span>` : "";
  const prov = a.provider === "bedrock" ? `<span class="sh-chip bedrock">Bedrock</span>` : "";
  const changes = a.changes && a.changes.files ? `<span class="sh-chip"><span style="color:var(--ok)">+${a.changes.add || 0}</span> <span style="color:var(--del)">−${a.changes.del || 0}</span></span>` : "";
  if (renamingId === a.id) return;
  const html = `
    <div class="sh-l">${stGlyph(a, true)}<span class="sh-name" id="h-name-txt">${esc(a.name)}</span><button class="rename-btn" id="h-rename" title="renommer">${ico("pencil", 12)}</button></div>
    <div class="sh-meta"><span class="sh-st">${esc(st(a).l)}${a.busy ? " · réfléchit" : ""}</span>${branch}${a.model ? `<span class="sh-chip">${esc(a.model)}${a.effort ? " · " + esc(a.effort) : ""}</span>` : ""}${prov}${changes}<span class="sh-chip host">${ico("server", 11)}${esc(a.host || "local")}</span></div>
    <div class="sh-act">
      <button class="icon-btn" id="h-theme" title="palette de cette conversation">${ico("palette", 15)}</button>
      <button class="icon-btn" id="h-refresh" title="rafraîchir">${ico("refresh", 15)}</button>
      <button class="icon-btn" id="h-ctx" title="détails">${ico("info", 15)}</button>
      <button class="icon-btn" id="h-team" title="équipe">${ico("users", 15)}</button>
    </div>`;
  if (renderSessHead._h === html && $("h-rename")) return;
  renderSessHead._h = html; $("sess-head").innerHTML = html;
  $("h-theme").onclick = () => { thScope = "conv"; openTheme(); };
  const cur = () => agentById(a.id) || a;
  $("h-refresh").onclick = () => { pollFeed(); pollHost(cur()); if (centerTab === "diff") loadDiff(true); };
  $("h-ctx").onclick = () => { $("app").classList.toggle("ctx-open"); if ($("app").classList.contains("ctx-open")) renderCtx(cur()); };
  $("h-team").onclick = () => { const c = cur(); if (c.teamId) openTeamView(c.teamId); else openTeam(); };
  $("h-team").title = (agentById(a.id) || a).teamId ? "vue d'équipe" : "créer une équipe";
  $("h-rename").onclick = () => startRename(cur());
}
let renamingId = null;
function startRename(a) {
  const txt = $("h-name-txt"); if (!txt || renamingId) return;
  renamingId = a.id; const input = document.createElement("input");
  input.className = "hn-input"; input.value = a.name || ""; input.maxLength = 60; input.setAttribute("aria-label", "nom de la session");
  txt.replaceWith(input); $("h-rename").classList.add("hidden"); input.focus(); input.select();
  let done = false;
  const finish = () => { renamingId = null; renderSessHead._h = null; const cur = agentById(a.id); if (cur) renderSessHead(cur); updateMobileTitle(cur || a); renderTabbar._sig = null; renderTabbar(); };
  const commit = async () => {
    if (done) return; done = true; const v = input.value.trim();
    if (!v || v === a.name) return finish();
    const j = await post("/api/rename", { id: a.id, name: v });
    if (!j.ok) { toast("Erreur : " + (j.error || "")); return finish(); }
    const cur = agentById(a.id); if (cur) cur.name = v; // affichage immédiat, le prochain snapshot confirme
    toast("Renommé : " + v); finish();
  };
  input.onblur = commit;
  input.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); input.blur(); } else if (e.key === "Escape") { e.preventDefault(); done = true; finish(); } };
}
function renderSessTabs() {
  $("sess-tabs").querySelectorAll(".ctab").forEach((b) => b.classList.toggle("sel", b.dataset.ctab === centerTab));
}
$("sess-tabs").querySelectorAll(".ctab").forEach((b) => (b.onclick = () => setCenterTab(b.dataset.ctab)));
function setCenterTab(t) {
  if (!detailId) return;
  if (centerTab === "term" && t !== "term") teardownTerminal();
  centerTab = t; lastCenter[detailId] = t; renderSessTabs(); applyCenterVisibility();
  if (t === "diff") loadDiff(true);
  else if (t === "term") openTermTab();
  else if (t === "preview") initPreview();
}
function applyCenterVisibility() {
  const sess = !!detailId, agents = snap.agents || [];
  const boardEmpty = view === "board" && !agents.filter((a) => !a.internal).length;
  $("session").classList.toggle("hidden", !sess);
  $("welcome").classList.toggle("hidden", sess || view !== "board" || !boardEmpty);
  $("board").classList.toggle("hidden", sess || view !== "board" || boardEmpty);
  $("mach").classList.toggle("hidden", sess || view !== "machines");
  $("skills").classList.toggle("hidden", sess || view !== "skills");
  $("audit").classList.toggle("hidden", sess || view !== "audit");
  $("design").classList.toggle("hidden", sess || view !== "design");
  $("auto").classList.toggle("hidden", sess || view !== "auto");
  $("teams").classList.toggle("hidden", sess || view !== "teams");
  if (sess) {
    $("conv").classList.toggle("hidden", centerTab !== "conv");
    $("composer").classList.toggle("hidden", centerTab !== "conv");
    $("diff").classList.toggle("hidden", centerTab !== "diff");
    $("termpanel").classList.toggle("hidden", centerTab !== "term");
    $("preview").classList.toggle("hidden", centerTab !== "preview");
  }
}

// ---- conversation (flux live + historique paginé) -----------------------------
function updateComposer(a) {
  $("c-busy").classList.toggle("hidden", !a.busy);
  if (a.slashCommands) slashList = a.slashCommands;
  const sg = $("c-suggest"), ssig = a.suggestion && !a.busy ? a.suggestion : "";
  if (updateComposer._ssig !== ssig) {
    updateComposer._ssig = ssig;
    if (ssig) { sg.classList.remove("hidden"); sg.innerHTML = `<span class="sg-l">💡 suite</span><button class="sg-chip" type="button">${esc(ssig)}</button>`; sg.querySelector(".sg-chip").onclick = () => { const i = $("c-input"); i.value = ssig; i.focus(); i.dispatchEvent(new Event("input")); }; }
    else { sg.classList.add("hidden"); sg.innerHTML = ""; }
  }
}
let olderFeed = [], lastLiveFeed = [], historyFrontier = null, historyAtStart = true, historyLoading = false;
function resetHistoryState() { olderFeed = []; lastLiveFeed = []; historyFrontier = null; historyAtStart = true; historyLoading = false; }
async function pollFeed() {
  if (!detailId || centerTab !== "conv") return;
  try {
    const j = await getJSON("/api/transcript?id=" + encodeURIComponent(detailId) + "&n=90");
    lastLiveFeed = j.feed || [];
    if (!olderFeed.length) { historyFrontier = j.nextBefore != null ? j.nextBefore : historyFrontier; historyAtStart = j.atStart !== false; }
    renderConv(olderFeed.concat(lastLiveFeed));
    updateQuickReplies(lastLiveFeed, agentById(detailId));
  } catch {}
}
async function loadOlderHistory() {
  if (!detailId || historyLoading || historyAtStart || historyFrontier == null) return;
  historyLoading = true; const btn = $("conv-loadmore"); if (btn) { btn.disabled = true; btn.textContent = "Chargement…"; }
  try {
    const j = await getJSON("/api/transcript?id=" + encodeURIComponent(detailId) + "&before=" + historyFrontier);
    olderFeed = (j.feed || []).concat(olderFeed); historyFrontier = j.nextBefore; historyAtStart = !!j.atStart;
    const el = $("conv"), oldH = el.scrollHeight, oldTop = el.scrollTop;
    renderConv._html = null; renderConv(olderFeed.concat(lastLiveFeed), { preserveScroll: true });
    el.scrollTop = oldTop + (el.scrollHeight - oldH);
  } catch { toast("Erreur de chargement"); }
  historyLoading = false;
}
function detectQuickReplies(feed) {
  const last = feed[feed.length - 1];
  if (!last || (last.kind !== "say" && last.kind !== "result")) return null;
  const lines = String(last.text || "").split("\n");
  const re = /^\s*(?:[-*]\s*)?\*{0,2}([A-Za-z]|\d{1,2})[.)]\*{0,2}\s+(.+?)\s*$/;
  const opts = []; let i = lines.length - 1;
  while (i >= 0 && !lines[i].trim()) i--;
  while (i >= 0) { const m = lines[i].match(re); if (!m) break; opts.unshift({ key: m[1].toUpperCase(), label: m[2].replace(/\*\*/g, "").trim() }); i--; }
  if (opts.length < 2 || opts.length > 8) return null;
  const allLetters = opts.every((o) => /^[A-Z]$/.test(o.key)), allDigits = opts.every((o) => /^\d+$/.test(o.key));
  if (!allLetters && !allDigits) return null;
  if (!/\?/.test(lines.slice(0, i + 1).join("\n"))) return null;
  return opts;
}
let quickReplies = [];
function updateQuickReplies(feed, agent) {
  const box = $("c-quickreply"); if (!box) return;
  const opts = (agent && !agent.busy) ? detectQuickReplies(feed) : null;
  const sig = opts ? opts.map((o) => o.key + o.label).join("|") : "";
  if (updateQuickReplies._sig === sig) return;
  updateQuickReplies._sig = sig; quickReplies = opts || [];
  if (!opts) { box.classList.add("hidden"); box.innerHTML = ""; return; }
  box.classList.remove("hidden");
  box.innerHTML = `<span class="sg-l">🔘 réponse rapide</span>` + opts.map((o, i) => `<button class="qr-chip" data-qr="${i}">${esc(o.key)}. ${esc(o.label)}</button>`).join("");
  box.querySelectorAll("[data-qr]").forEach((b) => (b.onclick = async () => {
    const o = quickReplies[+b.dataset.qr]; const a = agentById(detailId); if (!o || !a) return;
    box.classList.add("hidden"); box.innerHTML = ""; updateQuickReplies._sig = "";
    const j = await post("/api/send", { id: a.id, prompt: o.key + ". " + o.label, origin: "web" });
    if (!j.ok) toast("Erreur : " + (j.error || "échec"));
  }));
}
const expandedTools = new Set();
function toolKey(s) { s = String(s || ""); let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h.toString(36); }
let lastConvFeed = [];
function renderConv(feed, opts) {
  opts = opts || {}; const el = $("conv"); if (!el) return; lastConvFeed = feed;
  let html = "", i = 0; const AV = { say: "🤖", think: "💭", prompt: "🧑" };
  while (i < feed.length) {
    const e = feed[i];
    if (e.kind === "tool") {
      const key = toolKey(e.text), open = expandedTools.has(key), firstLine = String(e.text || "").split("\n")[0];
      let box = `<div class="tool ${open ? "open" : ""}"><div class="th" data-tool="${key}"><span class="chev">${ico(open ? "chevD" : "chevR", 12)}</span><span class="tool-sum">${esc(firstLine)}</span><span class="ok">${feed[i + 1] && feed[i + 1].kind === "result" ? ico("checkc", 13) : ""}</span></div>`;
      if (open) box += `<pre>${esc(e.text)}</pre>`;
      const hasResult = feed[i + 1] && feed[i + 1].kind === "result";
      if (open && hasResult) box += `<div class="res"><pre>${esc(feed[i + 1].text)}</pre></div>`;
      if (hasResult) i++;
      box += `</div>`; html += box; i++;
    } else if (e.kind === "result") {
      html += `<div class="msg result"><div class="mh"><span class="mav">↳</span><span class="mwho">Résultat</span></div><div class="mbody md">${mdToHtml(e.text)}</div></div>`; i++;
    } else {
      const who = e.kind === "prompt" ? "Vous" : (e.kind === "think" ? "Réflexion" : "Agent");
      const cls = e.kind === "prompt" ? "you" : (e.kind === "think" ? "agent think" : "agent");
      const bodyHtml = e.kind === "say" ? `<div class="mbody md">${mdToHtml(e.text)}</div>` : `<div class="mbody"${e.kind === "think" ? ' style="color:var(--mut)"' : ""}>${esc(e.text)}</div>`;
      html += `<div class="msg ${cls}"><div class="mh"><span class="mav">${AV[e.kind] || "🤖"}</span><span class="mwho">${who}</span></div>${bodyHtml}</div>`; i++;
    }
  }
  if (!html) html = `<div class="empty">en attente d'activité…</div>`;
  const loadMoreHtml = !historyAtStart ? `<div class="conv-loadmore-wrap"><button id="conv-loadmore" class="loadmore-btn">📜 Charger les messages précédents</button></div>`
    : (olderFeed.length || lastLiveFeed.length ? `<div class="conv-loadmore-wrap done">— début de la conversation —</div>` : "");
  const fullHtml = loadMoreHtml + html;
  if (renderConv._html === fullHtml) return;
  const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  renderConv._html = fullHtml; el.innerHTML = fullHtml;
  const lm = $("conv-loadmore"); if (lm) lm.onclick = loadOlderHistory;
  el.querySelectorAll("[data-tool]").forEach((h) => (h.onclick = () => { const k = h.dataset.tool; expandedTools.has(k) ? expandedTools.delete(k) : expandedTools.add(k); renderConv._html = null; renderConv(lastConvFeed); }));
  if (!opts.preserveScroll && near) el.scrollTop = el.scrollHeight;
}

// ---- composer -----------------------------------------------------------------
function wireComposer() {
  const input = $("c-input"), slash = $("c-slash");
  const send = async () => {
    const a = agentById(detailId); if (!a) return;
    const prompt = input.value.trim(), files = readyIds(attC);
    if (!prompt && !files.length) return;
    if (attC.some((x) => x.pending)) return toast("Upload en cours…");
    slash.classList.add("hidden");
    const j = await post("/api/send", { id: a.id, prompt, attachments: files, origin: "web" });
    if (!j.ok) return toast("Erreur : " + (j.error || "échec"));
    input.value = ""; input.style.height = "auto"; attC.length = 0; renderTray($("c-attach"), attC);
  };
  $("c-send").onclick = send;
  input.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } };
  input.oninput = () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 160) + "px"; renderSlash(input, slash); };
  input.onblur = () => setTimeout(() => slash.classList.add("hidden"), 180);
  $("c-clip").onclick = () => $("c-file").click();
  $("c-file").onchange = (e) => { addFiles(e.target.files, attC, $("c-attach")); e.target.value = ""; };
  input.addEventListener("paste", (e) => { const f = [...(e.clipboardData?.items || [])].filter((it) => it.kind === "file").map((it) => it.getAsFile()).filter(Boolean); if (f.length) { e.preventDefault(); addFiles(f, attC, $("c-attach")); } });
}
function renderSlash(input, dd) {
  const m = input.value.match(/^\/(\S*)$/); if (!m) return dd.classList.add("hidden");
  const q = m[1].toLowerCase(), matches = (slashList || []).filter((c) => c.toLowerCase().includes(q)).slice(0, 12);
  if (!matches.length) return dd.classList.add("hidden");
  dd.innerHTML = matches.map((c) => `<div class="slash-item">/${esc(c)}</div>`).join(""); dd.classList.remove("hidden");
  [...dd.children].forEach((el, i) => (el.onmousedown = (e) => { e.preventDefault(); input.value = "/" + matches[i] + " "; dd.classList.add("hidden"); input.focus(); }));
}

// ---- TERMINAL (onglet, PTY via WS) --------------------------------------------
let termWs = null, termInstance = null, termResizeHandler = null, termFor = null;
function teardownTerminal() {
  if (termResizeHandler) { window.removeEventListener("resize", termResizeHandler); termResizeHandler = null; }
  if (termWs) { try { termWs.close(); } catch {} termWs = null; }
  if (termInstance) { try { termInstance.dispose(); } catch {} termInstance = null; }
  termFor = null;
}
function openTermTab() {
  const agent = agentById(detailId); if (!agent) return;
  if (snap.terminal === false) { $("term-status").textContent = "indisponible (node-pty non installé)"; $("term-status").className = "term-status err"; return; }
  if (typeof Terminal === "undefined" || typeof FitAddon === "undefined") { $("term-status").textContent = "xterm non chargé"; return; }
  if (termFor === agent.id && termInstance) { setTimeout(() => { try { termInstance.focus(); } catch {} }, 30); return; }
  teardownTerminal(); termFor = agent.id;
  $("term-sub").textContent = (agent.name || "agent") + " · " + (agent.host || "local") + " · " + (agent.cwd || "~");
  const statusEl = $("term-status"); statusEl.textContent = "connexion…"; statusEl.className = "term-status";
  const body = $("term-body"); body.innerHTML = "";
  const term = new Terminal({ fontFamily: "JetBrains Mono, ui-monospace, monospace", fontSize: 13, cursorBlink: true, theme: window.FleetTheme ? FleetTheme.xterm() : undefined });
  const fit = new FitAddon.FitAddon(); term.loadAddon(fit); term.open(body); setTimeout(() => { try { fit.fit(); } catch {} }, 40);
  termInstance = term;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(proto + "//" + location.host + "/api/term?id=" + encodeURIComponent(agent.id)); termWs = ws;
  ws.onopen = () => { statusEl.textContent = "en direct"; statusEl.className = "term-status live"; try { fit.fit(); ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows })); } catch {} term.focus(); };
  ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } if (m.type === "data") term.write(m.data); else if (m.type === "exit") { statusEl.textContent = m.reason ? ("erreur : " + m.reason) : ("session terminée" + (m.code ? " (code " + m.code + ")" : "")); statusEl.className = "term-status err"; } };
  ws.onerror = () => { statusEl.textContent = "erreur de connexion"; statusEl.className = "term-status err"; };
  ws.onclose = () => { if (statusEl.classList.contains("live")) { statusEl.textContent = "déconnecté"; statusEl.className = "term-status"; } };
  term.onData((data) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input", data })); });
  termResizeHandler = () => { try { fit.fit(); if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows })); } catch {} };
  window.addEventListener("resize", termResizeHandler);
}

// ---- DIFF ---------------------------------------------------------------------
async function loadDiff(fresh) {
  const a = agentById(detailId); if (!a) return;
  const el = $("diff"); if (fresh || !diffData) el.innerHTML = `<div class="empty" style="padding:48px">chargement du diff…</div>`;
  let j; try { j = await getJSON("/api/diff?id=" + encodeURIComponent(a.id)); } catch { j = { git: false, error: "diff inaccessible" }; }
  diffData = j;
  const n = (j.files || []).length, badge = $("ctab-diff-n"); if (badge) { badge.textContent = n; badge.classList.toggle("hidden", !n); }
  if (centerTab === "diff") renderDiff(a, j);
}
function parsePatch(patch) {
  const files = []; let cur = null, oldno = 0, newno = 0;
  for (const ln of String(patch || "").split("\n")) {
    if (ln.startsWith("diff --git")) { cur = { path: (ln.match(/ b\/(.+)$/) || [])[1] || "?", hunks: [], binary: false }; files.push(cur); continue; }
    if (!cur) continue;
    if (ln.startsWith("Binary ")) { cur.binary = true; continue; }
    if (ln.startsWith("+++ ")) { const m = ln.match(/^\+\+\+ b\/(.+)$/) || ln.match(/^\+\+\+ (.+)$/); if (m && m[1] !== "/dev/null") cur.path = m[1]; continue; }
    if (ln.startsWith("--- ") || ln.startsWith("index ") || ln.startsWith("new file") || ln.startsWith("deleted file") || ln.startsWith("old mode") || ln.startsWith("new mode") || ln.startsWith("rename ") || ln.startsWith("similarity")) continue;
    const hm = ln.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
    if (hm) { oldno = +hm[1]; newno = +hm[2]; cur.hunks.push({ head: ln, lines: [] }); continue; }
    const h = cur.hunks[cur.hunks.length - 1]; if (!h) continue; const c = ln[0];
    if (c === "+") { h.lines.push({ type: "add", newno, text: ln.slice(1) }); newno++; }
    else if (c === "-") { h.lines.push({ type: "del", oldno, text: ln.slice(1) }); oldno++; }
    else if (c === "\\") {} else { h.lines.push({ type: "ctx", oldno, newno, text: ln.slice(1) }); oldno++; newno++; }
  }
  return files;
}
const commentKey = (f, l) => f + "::" + l;
function renderDiff(a, j) {
  const el = $("diff");
  if (!j || !j.git) { el.innerHTML = `<div class="empty" style="padding:48px"><span class="big">◇</span>${esc((j && j.error) || "Ce workspace n'est pas un dépôt git — rien à comparer.")}<br><span style="color:var(--mut2);font-size:12px">Déploie une tâche avec « 🌿 worktree » sur un dépôt git pour revoir puis merger ses changements.</span></div>`; return; }
  const files = parsePatch(j.patch);
  const totAdd = (j.files || []).reduce((n, f) => n + (f.additions || 0), 0), totDel = (j.files || []).reduce((n, f) => n + (f.deletions || 0), 0);
  const actions = `<button class="refresh" id="diff-refresh">⟳</button>` + (j.worktree ? `<button class="discard" id="diff-discard">🗑 Jeter</button><button class="merge" id="diff-merge">✓ Merger dans ${esc(j.base)}</button>` : "");
  let html = `<div class="diff-head"><div class="diff-branch">${j.worktree ? `⑂ <b>${esc(j.branch)}</b> → ${esc(j.base)}` : `modifications non committées · ${esc(j.base)}`}</div><div class="diff-stat"><span class="add">+${totAdd}</span> <span class="del">−${totDel}</span> · ${(j.files || []).length} fichier${(j.files || []).length > 1 ? "s" : ""}</div><div class="diff-actions">${actions}</div></div>`;
  if (pendingComments.length) html += `<div class="diff-pending">💬 <b>${pendingComments.length}</b> commentaire${pendingComments.length > 1 ? "s" : ""} en attente <button id="diff-sendcomments">Envoyer à l'agent ➤</button></div>`;
  html += `<div class="diff-files">`;
  if (!files.length) html += `<div class="empty" style="padding:30px">Aucun changement — l'agent n'a encore rien modifié sur sa branche.</div>`;
  for (const f of files) {
    const fstat = (j.files || []).find((x) => x.path === f.path) || {};
    html += `<div class="dfile"><div class="dfile-h" data-dfile="${esc(f.path)}"><span class="dchev">▾</span><span class="dpath">${esc(f.path)}</span><span class="dnum"><span class="add">+${fstat.additions || 0}</span> <span class="del">−${fstat.deletions || 0}</span></span></div><div class="dfile-body">`;
    if (f.binary) html += `<div class="dline ctx"><span class="gut"></span><span class="code">(fichier binaire)</span></div>`;
    for (const h of f.hunks) {
      html += `<div class="dline hunk"><span class="gut">⋯</span><span class="code">${esc(h.head)}</span></div>`;
      for (const l of h.lines) {
        const commentable = l.type === "add" || l.type === "ctx", key = commentKey(f.path, l.newno);
        const gut = l.type === "add" ? ("+" + l.newno) : l.type === "del" ? ("−" + l.oldno) : (l.newno || "");
        const has = commentable && pendingComments.some((c) => c.file === f.path && c.line === l.newno);
        html += `<div class="dline ${l.type}${commentable ? " commentable" : ""}"${commentable ? ` data-cl="${esc(f.path)}" data-ln="${l.newno}"` : ""}><span class="gut">${esc(String(gut))}</span><span class="code">${esc(l.text) || "&nbsp;"}${has ? ' <span style="color:var(--acc)">💬</span>' : ""}</span></div>`;
        if (commentable && openCommentKey === key) html += `<div class="dcomment"><textarea id="dc-ta" placeholder="Commentaire pour l'agent sur cette ligne…"></textarea><button id="dc-add">Ajouter</button></div>`;
      }
    }
    html += `</div></div>`;
  }
  html += `</div>`; el.innerHTML = html;
  const r = $("diff-refresh"); if (r) r.onclick = () => loadDiff(true);
  const mg = $("diff-merge"); if (mg) mg.onclick = () => doMerge(a);
  const dc = $("diff-discard"); if (dc) dc.onclick = () => doDiscard(a);
  const sc = $("diff-sendcomments"); if (sc) sc.onclick = () => sendComments(a);
  el.querySelectorAll("[data-dfile]").forEach((hh) => (hh.onclick = () => { const b = hh.nextElementSibling; const open = b.style.display !== "none"; b.style.display = open ? "none" : ""; hh.querySelector(".dchev").textContent = open ? "▸" : "▾"; }));
  el.querySelectorAll("[data-cl]").forEach((ln) => (ln.onclick = () => { const key = commentKey(ln.dataset.cl, +ln.dataset.ln); openCommentKey = openCommentKey === key ? null : key; renderDiff(a, diffData); const ta = $("dc-ta"); if (ta) ta.focus(); }));
  const add = $("dc-add"); if (add) add.onclick = () => {
    const ta = $("dc-ta"), txt = ta ? ta.value.trim() : ""; if (!txt) return;
    const [file, lineS] = openCommentKey.split("::"), line = +lineS;
    let snippet = ""; const fs2 = parsePatch(diffData.patch); for (const f of fs2) if (f.path === file) for (const h of f.hunks) for (const l of h.lines) if ((l.type === "add" || l.type === "ctx") && l.newno === line) snippet = l.text;
    pendingComments.push({ file, line, text: txt, snippet }); openCommentKey = null; renderDiff(a, diffData);
  };
}
function sendComments(a) {
  if (!pendingComments.length) return;
  let msg = `Revue du diff${diffData && diffData.branch ? " (branche " + diffData.branch + ")" : ""} — commentaires ligne à ligne :\n\n`;
  msg += pendingComments.map((c) => `• \`${c.file}:${c.line}\`${c.snippet ? "  — sur : `" + c.snippet.trim().slice(0, 120) + "`" : ""}\n  ${c.text}`).join("\n\n");
  msg += `\n\nMerci de corriger en conséquence et de committer sur ta branche.`;
  post("/api/send", { id: a.id, prompt: msg, origin: "web" }).then((j) => { if (!j.ok) return toast("Erreur : " + (j.error || "")); pendingComments = []; openCommentKey = null; toast("💬 commentaires envoyés"); setCenterTab("conv"); });
}
function doMerge(a) {
  if (!confirm("Merger la branche de « " + a.name + " » dans « " + ((diffData && diffData.base) || a.base || "base") + " » ?")) return;
  toast("⏳ merge en cours…");
  post("/api/merge", { id: a.id }).then((j) => { if (!j.ok) return alert("Merge impossible :\n\n" + (j.error || "erreur inconnue")); toast("✓ mergé dans " + j.base); if (detailId === a.id && centerTab === "diff") loadDiff(true); });
}
function doDiscard(a) {
  if (!confirm("Jeter le travail de « " + a.name + " » (worktree + branche supprimés, agent fermé) ? Irréversible.")) return;
  post("/api/discard", { id: a.id, kill: true }).then((j) => { if (!j.ok && j.error) return toast("Erreur : " + j.error); toast("🗑 travail jeté"); if (detailId === a.id) clearDetail(); });
}
function updateFanoutBar(a) {
  const bar = $("fanout-bar"); if (!bar) return;
  if (!a || !a.fanoutId) { bar.classList.add("hidden"); bar.innerHTML = ""; return; }
  const sibs = (snap.agents || []).filter((x) => x.fanoutId === a.fanoutId);
  if (sibs.length < 2) { bar.classList.add("hidden"); return; }
  bar.classList.remove("hidden");
  bar.innerHTML = `<span class="fo-l">⑂ Fan-out · ${sibs.length} variantes</span>` + sibs.map((s) => `<button class="fo-chip ${s.id === a.id ? "sel" : ""}" data-fo="${esc(s.id)}"><span class="fo-dot" style="background:${st(s).c}"></span>${esc(s.variant || s.name)}${s.changes ? ` <span style="color:var(--mut2);font-size:10px">+${s.changes.add || 0}/−${s.changes.del || 0}</span>` : ""}</button>`).join("") + (a.worktree ? `<button class="fo-chip" id="fo-keep" title="merger cette variante, jeter les autres"><span class="fo-win">★</span> garder</button>` : "");
  bar.querySelectorAll("[data-fo]").forEach((b) => (b.onclick = () => select(b.dataset.fo)));
  const keep = $("fo-keep"); if (keep) keep.onclick = () => keepVariant(a);
}
async function keepVariant(a) {
  const sibs = (snap.agents || []).filter((x) => x.fanoutId === a.fanoutId && x.id !== a.id);
  if (!confirm("Garder « " + (a.variant || a.name) + " » : merger sa branche puis JETER les " + sibs.length + " autres ?")) return;
  toast("⏳ merge de la variante gagnante…");
  const j = await post("/api/merge", { id: a.id }); if (!j.ok) return alert("Merge impossible :\n\n" + (j.error || "erreur"));
  for (const s of sibs) await post("/api/discard", { id: s.id, kill: true });
  toast("★ variante gardée & mergée dans " + j.base); if (centerTab === "diff") loadDiff(true);
}

// ---- volet CONTEXTE (slide-over) ----------------------------------------------
const _host = new Map();
async function pollHost(a) { if (!a) return; try { const m = await getJSON("/api/host?name=" + encodeURIComponent(a.host || "local")); _host.set(a.id, m); if (detailId === a.id && $("app").classList.contains("ctx-open") && (ctxTab === "ctx" || ctxTab === "machine")) renderCtx(a); } catch {} }
function permInfo(a) { const danger = ["bypassPermissions", "dontAsk", "auto"].includes(a.perm); return { level: danger ? "Élevé" : "Restreint", cls: danger ? "red" : "grn", note: danger ? "push/merge/deploy sans validation" : "pas de push/merge/deploy" }; }
function ring(pct) { const p = Math.max(0, Math.min(100, pct || 0)), cls = p >= 85 ? "crit" : p >= 65 ? "hot" : ""; return `<div class="ring ${cls}" style="--p:${p}"><i></i></div>`; }
function renderCtx(a) {
  $("ctx-title").textContent = a.name || "Détails"; const body = $("ctx-body");
  if (ctxTab === "logs") { getJSON("/api/transcript?id=" + encodeURIComponent(a.id) + "&n=60").then((j) => { const tools = (j.feed || []).filter((e) => e.kind === "tool").slice(-16); body.innerHTML = `<div class="card2"><h3>Derniers outils</h3>` + (tools.length ? tools.map((e) => `<div style="font-family:var(--mono);font-size:11.5px;color:var(--mut);padding:4px 0;border-bottom:1px solid var(--line)">⚙ ${esc(e.text)}</div>`).join("") : `<div style="color:var(--mut2)">—</div>`) + `</div>`; }).catch(() => {}); return; }
  if (ctxTab === "machine") { body.innerHTML = machineCard(a) + `<div class="card2"><h3>Agents sur cette machine</h3>${hostTreeHtml(a.host || "local", snap.agents || [])}</div>`; wireFtree(body, () => renderCtx(a)); return; }
  const pi = permInfo(a), h = _host.get(a.id) || {};
  body.innerHTML = `
    <div class="card2"><h3>Profil</h3>
      <div class="kv"><span class="k">Rôle</span><span class="v">${esc(a.role || "—")}</span></div>
      ${a.worktree ? `<div class="kv"><span class="k">Branche</span><span class="v" style="font-family:var(--mono)">${esc(a.branch || "")}</span></div><div class="kv"><span class="k">Base</span><span class="v">${esc(a.base || "")}</span></div>` : ""}
      <div class="kv"><span class="k">Provider</span><span class="v ${a.provider === "bedrock" ? "amber" : ""}">${a.provider === "bedrock" ? "AWS Bedrock" : "Anthropic"}</span></div>
      <div class="kv"><span class="k">Dernière activité</span><span class="v">${esc(ago(a.updatedAt) || "—")}</span></div>
    </div>
    <div class="card2"><h3>Permissions</h3>
      <div class="kv"><span class="k">Mode</span><span class="v">${esc(a.perm || "acceptEdits")}</span></div>
      <div class="kv"><span class="k">Niveau</span><span class="v ${pi.cls}">${pi.level}</span></div>
      <div class="kv"><span class="k">Effet</span><span class="v" style="max-width:170px;white-space:normal;text-align:right">${esc(pi.note)}</span></div>
    </div>
    <div class="card2"><h3>Workspace</h3>
      <div class="kv"><span class="k">Chemin</span><span class="v" title="${esc(a.cwd || "")}" style="max-width:190px;white-space:normal;text-align:right;word-break:break-all">${esc(a.cwd || "—")}</span></div>
    </div>
    <div class="card2"><h3>Actions</h3><div class="qa"><button class="warn" id="qa-stop">⏸ Stop</button><button id="qa-gym">🏋️ Gym</button><button class="danger" id="qa-kill">✖ Fermer</button></div></div>
    <div class="card2"><h3>Ressources — ${esc(a.host || "local")}</h3>
      <div class="meters">
        <div class="meter"><div class="ml">CPU</div><div class="mv">${h.cpuPct != null ? h.cpuPct + "%" : "—"}</div>${ring(h.cpuPct)}</div>
        <div class="meter"><div class="ml">RAM</div><div class="mv">${h.memPct != null ? h.memPct + "%" : "—"}</div>${ring(h.memPct)}</div>
        <div class="meter"><div class="ml">Disque</div><div class="mv">${h.diskPct != null ? h.diskPct + "%" : "—"}</div>${ring(h.diskPct)}</div>
        <div class="meter"><div class="ml">Coût</div><div class="mv" style="font-size:16px">${fmtCost(a.costUsd)}</div><div style="font-size:10px;color:var(--mut2)">${fmtTok(a.tokens)} tok</div></div>
      </div>
    </div>`;
  const stop = $("qa-stop"), gym = $("qa-gym"), kill = $("qa-kill");
  if (stop) stop.onclick = () => post("/api/stop", { id: a.id }).then(() => toast("⏸ stop demandé"));
  if (gym) gym.onclick = () => post("/api/train", { id: a.id }).then((j) => toast(j.ok ? "🏋️ direction le gym" : "Erreur"));
  if (kill) kill.onclick = () => { if (confirm("Fermer la session de « " + a.name + " » ?")) post("/api/kill", { id: a.id }).then(() => { if (detailId === a.id) clearDetail(); }); };
}
function machineCard(a) {
  const h = _host.get(a.id) || {};
  return `<div class="card2"><h3>${esc(a.host || "local")}</h3>
    <div class="meters" style="margin-bottom:10px"><div class="meter"><div class="ml">CPU (${h.ncpu || "?"} c)</div><div class="mv">${h.cpuPct != null ? h.cpuPct + "%" : "—"}</div>${ring(h.cpuPct)}</div><div class="meter"><div class="ml">RAM</div><div class="mv">${h.memPct != null ? h.memPct + "%" : "—"}</div>${ring(h.memPct)}</div></div>
    <div class="kv"><span class="k">RAM</span><span class="v">${h.memUsedMb || "?"} / ${h.memTotalMb || "?"} Mo</span></div>
    <div class="kv"><span class="k">Disque /</span><span class="v">${h.diskPct != null ? h.diskPct + "%" : "—"}</span></div>
    <div class="kv"><span class="k">IP Tailscale</span><span class="v">${esc(h.tsip || "—")}</span></div></div>`;
}
$("ctx-tabs").querySelectorAll(".ctx-tab").forEach((b) => (b.onclick = () => { ctxTab = b.dataset.tab; $("ctx-tabs").querySelectorAll(".ctx-tab").forEach((x) => x.classList.toggle("sel", x === b)); const a = agentById(detailId); if (a) renderCtx(a); }));
$("ctx-close").onclick = () => $("app").classList.remove("ctx-open");

// ---- arborescence machine (vue Machines + ctx machine) ------------------------
function buildHostTree(agents) {
  const withCwd = agents.filter((a) => a.cwd && a.cwd !== "~" && a.cwd !== "-"); if (!withCwd.length) return null;
  let common = withCwd[0].cwd.split("/").filter(Boolean);
  for (const a of withCwd.slice(1)) { const parts = a.cwd.split("/").filter(Boolean); let i = 0; while (i < common.length && i < parts.length && common[i] === parts[i]) i++; common = common.slice(0, i); }
  const root = { seg: "", path: "", children: [], agents: [] };
  const foc = (parent, seg) => { let c = parent.children.find((x) => x.seg === seg); if (!c) { c = { seg, path: (parent.path ? parent.path + "/" : "") + seg, children: [], agents: [] }; parent.children.push(c); } return c; };
  for (const a of withCwd) { const parts = a.cwd.split("/").filter(Boolean).slice(common.length); let node = root; for (const seg of parts) node = foc(node, seg); node.agents.push(a); }
  return { commonPrefix: "/" + common.join("/"), root };
}
function ftreeLeaf(a) { return `<div class="ftree-leaf" data-id="${esc(a.id)}"><span class="fdot" style="background:${st(a).c}"></span><span class="fnm">${esc(a.name)}</span><span class="frole">${esc(a.role || "")}</span></div>`; }
function countTreeAgents(node) { let n = node.agents.length; for (const c of node.children) n += countTreeAgents(c); return n; }
const collapsedFolders = new Set();
function ftreeChildren(node, hostKey) {
  return node.children.slice().sort((x, y) => x.seg.localeCompare(y.seg)).map((c) => {
    const key = hostKey + "::" + c.path, collapsed = collapsedFolders.has(key), total = countTreeAgents(c);
    return `<div class="ftree-node"><div class="ftree-folder" data-fold="${esc(key)}"><span class="fchev">${collapsed ? "▸" : "▾"}</span><span class="fic">📁</span> ${esc(c.seg)}${collapsed ? `<span class="fcount">${total}</span>` : ""}</div>${!collapsed ? (c.agents.length ? `<div class="ftree-agents">${c.agents.map(ftreeLeaf).join("")}</div>` : "") : ""}${!collapsed && c.children.length ? `<div class="ftree-children">${ftreeChildren(c, hostKey)}</div>` : ""}</div>`;
  }).join("");
}
function ftreeFull(t, hostKey) { return (t.root.agents.length ? `<div class="ftree-agents" style="margin:0 0 4px">${t.root.agents.map(ftreeLeaf).join("")}</div>` : "") + ftreeChildren(t.root, hostKey); }
function hostTreeHtml(host, allAgents) {
  const agents = (allAgents || []).filter((a) => (a.host || "local") === host), t = buildHostTree(agents);
  if (!t) return `<div class="empty" style="padding:20px 4px;text-align:left">Aucun chemin de travail connu pour ${esc(host)}.</div>`;
  return `<div class="ftree"><div class="ftree-root">📍 <b>${esc(host)}</b> : <span class="froot-path">${esc(t.commonPrefix || "/")}/</span></div>${ftreeFull(t, host)}</div>`;
}
function wireFtree(el, rerenderFn) {
  el.querySelectorAll(".ftree-leaf").forEach((r) => (r.onclick = () => select(r.dataset.id)));
  el.querySelectorAll("[data-fold]").forEach((f) => (f.onclick = (e) => { e.stopPropagation(); const k = f.dataset.fold; collapsedFolders.has(k) ? collapsedFolders.delete(k) : collapsedFolders.add(k); if (rerenderFn) rerenderFn(); }));
}

// ---- vues (nav) ---------------------------------------------------------------
function setView(v) {
  view = v; detailId = null; applySessionTheme(null); teardownTerminal(); clearInterval(feedTimer); clearInterval(hostTimer);
  $("nav").querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("sel", b.dataset.view === v));
  clearInterval(machTimer); clearInterval(autoTimer); clearInterval(tvTimer); applyCenterVisibility(); renderSidebar(); renderTabbar();
  if (v === "board") renderBoard();
  if (v === "machines") { renderMachines(); machTimer = setInterval(renderMachines, 15000); }
  if (v === "skills") renderSkills();
  if (v === "audit") renderAudit();
  if (v === "design") renderDesign();
  if (v === "teams") { renderTeams(); pollTeams(true); tvTimer = setInterval(pollTeams, 3000); }
  if (v === "auto") { renderAuto(); loadAuto(); autoTimer = setInterval(loadAuto, 15000); }
  closeDrawers();
}
$("nav").querySelectorAll(".nav-item").forEach((b) => (b.onclick = () => setView(b.dataset.view)));

let machSelectedHost = null;
async function renderMachines() {
  if (!$("mach").innerHTML.trim()) $("mach").innerHTML = `<div class="empty" style="padding:40px">chargement…</div>`;
  let hosts = [{ id: "local", label: "local" }]; try { const j = await getJSON("/api/hosts"); if (j.hosts) hosts = j.hosts; } catch {}
  const agents = snap.agents || [];
  const cards = await Promise.all(hosts.map(async (host) => {
    let m = {}; if (host.online !== false) { try { m = await getJSON("/api/host?name=" + encodeURIComponent(host.id)); } catch {} }
    const n = agents.filter((x) => (x.host || "local") === host.id).length, open = machSelectedHost === host.id;
    return `<div class="card2 mach-card"><h3>${esc(host.label || host.id)} ${host.online === false ? '<span style="color:var(--mut2);font-size:10px">hors-ligne</span>' : ""}</h3>
      <div class="meters" style="margin-bottom:10px"><div class="meter"><div class="ml">CPU</div><div class="mv">${m.cpuPct != null ? m.cpuPct + "%" : "—"}</div>${ring(m.cpuPct)}</div><div class="meter"><div class="ml">RAM</div><div class="mv">${m.memPct != null ? m.memPct + "%" : "—"}</div>${ring(m.memPct)}</div></div>
      <div class="kv"><span class="k">Disque</span><span class="v">${m.diskPct != null ? m.diskPct + "%" : "—"}</span></div>
      <div class="kv"><span class="k">IP</span><span class="v">${esc(m.tsip || host.ip || "—")}</span></div>
      <div class="kv"><span class="k">Agents</span><span class="v">${n}</span></div>
      ${n ? `<button class="linkbtn2" data-treehost="${esc(host.id)}">🌳 ${open ? "masquer" : "voir"} l'arborescence</button>` : ""}</div>`;
  }));
  if (machSelectedHost && hosts.some((h) => h.id === machSelectedHost)) { const idx = hosts.findIndex((h) => h.id === machSelectedHost); cards.splice(idx + 1, 0, `<div class="card2" style="grid-column:1/-1"><h3>🌳 ${esc(machSelectedHost)}</h3>${hostTreeHtml(machSelectedHost, agents)}</div>`); }
  $("mach").innerHTML = cards.join("");
  $("mach").querySelectorAll("[data-treehost]").forEach((b) => (b.onclick = () => { machSelectedHost = machSelectedHost === b.dataset.treehost ? null : b.dataset.treehost; renderMachines(); }));
  wireFtree($("mach"), renderMachines);
}

// ---- vue AUDIT ----------------------------------------------------------------
const AUDIT_ICON = { spawn: "🚀", kill: "🗑", rename: "✎", train: "🏋️", team: "👥", "skill-add": "➕", "skill-del": "✕", "skill-refetch": "↻", merge: "✓", discard: "🗑", fanout: "⑂" };
function auditDesc(e) {
  switch (e.action) {
    case "spawn": return `Tâche déployée « ${e.name} » (${e.role || "—"}) sur ${e.host || "local"}${e.provider === "bedrock" ? " · Bedrock" : ""}`;
    case "kill": return `Agent fermé « ${e.name} »`;
    case "rename": return `« ${e.from} » → « ${e.to} »`;
    case "train": return `Entraînement « ${e.name} »${e.targeted ? " — " + e.role : ""}`;
    case "team": return `Équipe « ${e.name} » (${e.members} rôles)`;
    case "fanout": return `Fan-out « ${e.name} » (${e.variants} variantes) sur ${e.host || "local"}`;
    case "merge": return `Branche ${e.branch} mergée dans ${e.base}`;
    case "discard": return `Worktree ${e.branch} jeté`;
    case "skill-add": return `Skill « ${e.name} » → ${e.category}`;
    case "skill-del": return `Skill supprimée « ${e.name} »`;
    case "skill-refetch": return `Skills « ${e.category} » actualisées`;
    default: return e.action;
  }
}
async function renderAudit() {
  const el = $("audit"); if (!el.innerHTML.trim()) el.innerHTML = `<div class="empty">chargement…</div>`;
  let j; try { j = await getJSON("/api/audit?n=200"); } catch { j = null; }
  if ($("nav-audit")) $("nav-audit").textContent = (j && j.total) || 0;
  const entries = (j && j.entries) || [];
  el.innerHTML = entries.length ? `<div class="audit-list">` + entries.map((e) => `<div class="audit-row"><span class="aic">${AUDIT_ICON[e.action] || "•"}</span><div class="adesc">${esc(auditDesc(e))}</div><span class="ats" title="${esc(new Date(e.at).toLocaleString("fr-FR"))}">${esc(ago(e.at))}</span></div>`).join("") + `</div>` : `<div class="empty"><span class="big">▧</span>Aucune action enregistrée.</div>`;
}

// ---- vue SKILLS ---------------------------------------------------------------
let _skillsData = null;
async function renderSkills() {
  const el = $("skills"); if (!_skillsData) el.innerHTML = `<div class="empty">chargement…</div>`;
  try { _skillsData = await getJSON("/api/skills"); } catch { el.innerHTML = `<div class="empty">bibliothèque inaccessible</div>`; return; }
  const cats = _skillsData.categories || []; if ($("nav-skills")) $("nav-skills").textContent = _skillsData.total || 0;
  const asst = `<div class="skills-asst"><div class="asst-h">◇ Assistant skills — ajoute / supprime / actualise</div><div class="asst-log" id="skasst-log"></div><div class="asst-row"><input id="skasst-in" placeholder="Lien GitHub…  « supprime <nom> », « actualise <catégorie> »" /><button id="skasst-go">Ajouter</button></div></div>`;
  const bodyH = cats.length ? cats.map((c) => `<div class="skills-cat"><h3>◈ ${esc(c.category)} <span class="badge">${c.count}</span><button class="catbtn" data-refetch="${esc(c.category)}">↻</button></h3><div class="skill-grid">` + c.skills.map((s) => `<div class="skill-card" data-skill="${esc(s.path)}"><button class="skx" data-del="${esc(s.path)}">✕</button><div class="sn">${esc(s.name)}</div><div class="sd">${esc(s.desc || "—")}</div><div class="sm">${esc(String(s.path).split("/").slice(0, -1).join("/"))}</div></div>`).join("") + `</div></div>`).join("") : `<div class="empty"><span class="big">◈</span>Aucune skill. Ajoute-en via l'assistant.</div>`;
  el.innerHTML = asst + bodyH;
  el.querySelectorAll("[data-skill]").forEach((c) => (c.onclick = () => openSkill(c.dataset.skill)));
  el.querySelectorAll("[data-del]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); skillDel(b.dataset.del); }));
  el.querySelectorAll("[data-refetch]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); skillRefetch(b.dataset.refetch); }));
  const go = $("skasst-go"), inp = $("skasst-in"); if (go) go.onclick = skAsstSend; if (inp) inp.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); skAsstSend(); } };
}
function asstLog(text, cls) { const l = $("skasst-log"); if (!l) return; const d = document.createElement("div"); d.className = "asst-msg " + (cls || "bot"); d.textContent = text; l.appendChild(d); l.scrollTop = l.scrollHeight; }
async function skAsstSend() {
  const inp = $("skasst-in"); if (!inp) return; const raw = inp.value.trim(); if (!raw) return; asstLog(raw, "me"); inp.value = ""; let m;
  if ((m = raw.match(/\b(?:supprime|retire|delete|remove)\b\s+(.+)$/i))) { const q = m[1].trim().toLowerCase(); const hit = (_skillsData.categories || []).flatMap((c) => c.skills).find((s) => s.name.toLowerCase() === q || s.path.toLowerCase().includes(q)); if (!hit) return asstLog("Skill introuvable", "bot err"); return skillDel(hit.path); }
  if ((m = raw.match(/\b(?:actualise|refetch|met[s]?\s*à\s*jour|update)\b\s+(.+)$/i))) return skillRefetch(m[1].trim());
  const urlMatch = raw.match(/https?:\/\/\S+/) || raw.match(/\b[\w.-]+\/[\w.-]+\b/); if (!urlMatch) return asstLog("Donne un lien GitHub, ou « supprime <nom> » / « actualise <catégorie> ».", "bot");
  const catM = raw.match(/(?:cat[ée]gorie|cat)\s*[:=]\s*([\w -]+?)(?:\s+https?:|\s+[\w.-]+\/|$)/i); const category = catM ? catM[1].trim() : "";
  asstLog("Téléchargement…", "bot"); const j = await post("/api/skill-add", { url: urlMatch[0], category });
  if (!j.ok) return asstLog("Échec : " + (j.error || ""), "bot err");
  if (j.bulk) { asstLog(`✓ ${j.count} skills importées (${j.category})`, "bot ok"); toast(`✓ ${j.count} skills`); } else { asstLog("✓ ajoutée : " + j.name, "bot ok"); toast("✓ " + j.name); }
  _skillsData = null; renderSkills();
}
async function skillDel(path) { const j = await post("/api/skill-del", { path }); if (!j.ok) return asstLog("Suppression impossible", "bot err"); asstLog("🗑 " + (j.name || path), "bot"); toast("🗑 supprimée"); _skillsData = null; renderSkills(); }
async function skillRefetch(category) { const j = await post("/api/skill-refetch", { category }); if (!j.ok) return asstLog("Actualisation impossible", "bot err"); asstLog("↻ « " + category + " » — recharge ~30 s.", "bot ok"); toast("↻ " + category); setTimeout(() => { _skillsData = null; renderSkills(); }, 8000); }
async function openSkill(rel) { openModal("skillview"); $("sk-name").textContent = rel.split("/").pop() === "SKILL.md" ? rel.split("/").slice(-2)[0] : rel.split("/").pop(); $("sk-meta").textContent = rel; $("sk-body").textContent = "chargement…"; try { const j = await getJSON("/api/skill?path=" + encodeURIComponent(rel)); $("sk-body").textContent = j.content || j.error || "(vide)"; } catch { $("sk-body").textContent = "lecture impossible"; } }

// ---- explorateur de chemin ----------------------------------------------------
let fxState = { host: "local", path: "", targetInput: null };
async function openBrowser(targetInputId, host) { fxState = { host: host || "local", path: ($(targetInputId).value || "").trim(), targetInput: targetInputId }; openModal("fx"); $("fx-host").textContent = "📍 " + fxState.host; await fxLoad(fxState.path); }
async function fxLoad(p) {
  $("fx-list").innerHTML = `<div class="fx-row"><span class="fi">…</span> chargement…</div>`;
  let j; try { j = await getJSON("/api/ls?host=" + encodeURIComponent(fxState.host) + "&path=" + encodeURIComponent(p || "")); } catch { j = null; }
  if (!j || j.error) { $("fx-list").innerHTML = `<div class="fx-row" style="color:var(--del)">${esc((j && j.error) || "dossier illisible")}</div>`; return; }
  fxState.path = j.path; fxState._parent = j.parent; fxState._home = j.home; $("fx-path").textContent = j.path; const dirs = j.dirs || [];
  $("fx-list").innerHTML = dirs.length ? dirs.map((d) => `<div class="fx-row" data-d="${esc(d)}"><span class="fi">📁</span> ${esc(d)}</div>`).join("") : `<div class="fx-row" style="color:var(--mut2)">— aucun sous-dossier —</div>`;
  $("fx-list").querySelectorAll("[data-d]").forEach((r) => (r.onclick = () => fxLoad((fxState.path.endsWith("/") ? fxState.path : fxState.path + "/") + r.dataset.d)));
}
function wireBrowser() {
  $("fx-up").onclick = () => { if (fxState._parent) fxLoad(fxState._parent); };
  $("fx-home").onclick = () => fxLoad(fxState._home || "");
  $("fx-pick").onclick = () => { if (fxState.targetInput) { $(fxState.targetInput).value = fxState.path; if (fxState.targetInput === "sp-cwd") $("sp-cwd-hint").textContent = fxState.host === "local" ? "" : "(sur " + fxState.host + ")"; } closeModal("fx"); };
}

// ---- reprise de session (modale déploiement) ----------------------------------
let resumeId = null;
function renderResumeList() {
  const box = $("sp-resume"); if (!box) return;
  const agents = (snap.agents || []).slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 40);
  if (!agents.length) { box.innerHTML = `<div class="resume-item" style="color:var(--mut2);cursor:default">aucune session</div>`; return; }
  box.innerHTML = agents.map((a) => `<div class="resume-item" data-rid="${esc(a.id)}"><span class="rn">${esc(a.name || "—")}</span><span class="rp">${esc(a.role || "")}${a.host ? " · " + esc(a.host) : ""}</span><span class="rt">${esc(ago(a.updatedAt))}</span></div>`).join("");
  box.querySelectorAll("[data-rid]").forEach((r) => (r.onclick = () => { const on = r.classList.contains("sel"); box.querySelectorAll(".resume-item").forEach((x) => x.classList.remove("sel")); if (on) { resumeId = null; return; } r.classList.add("sel"); resumeId = r.dataset.rid; const a = agentById(resumeId); if (a) { if (a.cwd) $("sp-cwd").value = a.cwd; if (a.name) $("sp-name").value = a.name; if (a.role) $("sp-role").value = a.role; } toast("↩ reprise : " + ((a && a.name) || resumeId)); }));
}

// ---- déploiement + fan-out ----------------------------------------------------
let spawnHost = "local", spawnProv = "anthropic", teamProv = "anthropic";
function fillModels() { $("sp-model").innerHTML = MODELS.map((m) => `<option value="${m.v}">${m.l}</option>`).join(""); $("tm-model").innerHTML = `<option value="auto">Auto (le chef choisit) 👑</option>` + MODELS.map((m) => `<option value="${m.v}">${m.l}</option>`).join(""); }
function provSeg(segId, cur, set) { const seg = $(segId); if (!seg) return; seg.querySelectorAll("button").forEach((b) => { if (b.dataset.prov === "bedrock" && !snap.bedrock) { b.disabled = true; b.title = "configure ~/.fleet/bedrock.env"; b.style.opacity = ".5"; } b.classList.toggle("sel", b.dataset.prov === cur); b.onclick = () => { if (b.disabled) return; seg.querySelectorAll("button").forEach((x) => x.classList.remove("sel")); b.classList.add("sel"); set(b.dataset.prov); }; }); }
function setSpawnMode(mode) { spawnMode = mode; $("sp-mode").querySelectorAll("button").forEach((b) => b.classList.toggle("sel", b.dataset.mode === mode)); const fan = mode === "fanout"; $("sp-solo-model").classList.toggle("hidden", fan); $("sp-worktree-fld").classList.toggle("hidden", fan); $("sp-variants-fld").classList.toggle("hidden", !fan); $("sp-go").textContent = fan ? "⑂ Lancer les variantes" : "🚀 Lancer la mission"; }
function renderVariants() {
  const box = $("sp-variants"); if (!box) return;
  box.innerHTML = variantRows.map((v, i) => `<div class="vrow"><select data-vm="${i}">${MODELS.map((m) => `<option value="${m.v}" ${v.model === m.v ? "selected" : ""}>${m.l}</option>`).join("")}</select><select data-ve="${i}"><option value="">effort auto</option>${["low", "medium", "high"].map((e) => `<option value="${e}" ${v.effort === e ? "selected" : ""}>${e}</option>`).join("")}</select>${variantRows.length > 2 ? `<button type="button" class="vx" data-vx="${i}">✕</button>` : ""}</div>`).join("");
  box.querySelectorAll("[data-vm]").forEach((s) => (s.onchange = () => (variantRows[+s.dataset.vm].model = s.value)));
  box.querySelectorAll("[data-ve]").forEach((s) => (s.onchange = () => (variantRows[+s.dataset.ve].effort = s.value)));
  box.querySelectorAll("[data-vx]").forEach((b) => (b.onclick = () => { variantRows.splice(+b.dataset.vx, 1); renderVariants(); }));
}
async function openSpawn() {
  openModal("spawn"); $("sp-err").textContent = ""; fillModels();
  if (!variantRows.length) variantRows = [{ model: "opus" }, { model: "sonnet" }];
  setSpawnMode("solo"); renderVariants();
  attS.length = 0; renderTray($("sp-attach-list"), attS); resumeId = null; renderResumeList();
  spawnProv = "anthropic"; provSeg("sp-prov", spawnProv, (v) => (spawnProv = v));
  const wrap = $("sp-hosts"); wrap.innerHTML = `<div class="host-pick sel">chargement…</div>`;
  let hosts = [{ id: "local", label: "local", ip: "127.0.0.1", online: true }]; try { const j = await getJSON("/api/hosts"); if (j.hosts && j.hosts.length) hosts = j.hosts; } catch {}
  spawnHost = "local";
  wrap.innerHTML = hosts.map((h) => `<button type="button" class="host-pick ${h.id === "local" ? "sel" : ""}" data-host="${esc(h.id)}" ${h.online ? "" : "disabled style='opacity:.45'"}><div class="hn"><span class="hdot ${h.online ? "" : "off"}"></span>${esc(h.label)}</div><div class="hi">${esc(h.ip || "")}${h.id === "local" ? "" : (h.online ? " · ssh" : " · hors-ligne")}</div></button>`).join("");
  wrap.querySelectorAll(".host-pick").forEach((b) => (b.onclick = () => { if (b.disabled) return; wrap.querySelectorAll(".host-pick").forEach((x) => x.classList.remove("sel")); b.classList.add("sel"); spawnHost = b.dataset.host; $("sp-cwd-hint").textContent = spawnHost === "local" ? "" : "(sur " + spawnHost + ")"; }));
}
async function doSpawn() {
  const prompt = $("sp-prompt").value.trim();
  if (attS.some((x) => x.pending)) { $("sp-err").textContent = "Upload en cours…"; return; }
  if (resumeId) {
    if (!prompt && !readyIds(attS).length) { $("sp-err").textContent = "Écris la suite de la mission."; return; }
    $("sp-go").disabled = true; const j = await post("/api/send", { id: resumeId, prompt, attachments: readyIds(attS), origin: "web" }); $("sp-go").disabled = false;
    if (!j.ok) { $("sp-err").textContent = j.error || "reprise impossible"; return; }
    const rid = resumeId; attS.length = 0; renderTray($("sp-attach-list"), attS); closeModal("spawn"); toast("↩ session reprise"); $("sp-prompt").value = ""; resumeId = null; setTimeout(() => select(rid), 300); return;
  }
  if (spawnMode === "fanout") {
    const cwd = $("sp-cwd").value.trim(); if (!cwd || !prompt) { $("sp-err").textContent = "Workspace et mission requis."; return; } if (variantRows.length < 2) { $("sp-err").textContent = "Au moins 2 variantes."; return; }
    $("sp-go").disabled = true; const j = await post("/api/fanout", { name: $("sp-name").value.trim(), host: spawnHost, cwd, prompt, perm: $("sp-perm").value, provider: spawnProv, variants: variantRows.map((v) => ({ model: v.model, effort: v.effort || "" })) }); $("sp-go").disabled = false;
    if (!j.ok) { $("sp-err").textContent = j.error || "échec"; return; }
    closeModal("spawn"); toast("⑂ fan-out lancé — " + (j.ids ? j.ids.length : 0) + " variantes"); $("sp-name").value = $("sp-cwd").value = $("sp-prompt").value = ""; if (j.ids && j.ids[0]) setTimeout(() => select(j.ids[0]), 500); return;
  }
  const body = { host: spawnHost, name: $("sp-name").value.trim(), role: $("sp-role").value.trim(), cwd: $("sp-cwd").value.trim(), prompt, model: $("sp-model").value, effort: $("sp-effort").value, perm: $("sp-perm").value, provider: spawnProv, worktree: $("sp-worktree").checked, attachments: readyIds(attS) };
  if (!body.cwd || !body.prompt) { $("sp-err").textContent = "Workspace et mission requis."; return; }
  $("sp-go").disabled = true; const j = await post("/api/spawn", body); $("sp-go").disabled = false;
  if (!j.ok) { $("sp-err").textContent = j.error || "échec"; return; }
  attS.length = 0; renderTray($("sp-attach-list"), attS); closeModal("spawn"); toast("🚀 tâche lancée" + (spawnHost !== "local" ? " · " + spawnHost : "")); $("sp-name").value = $("sp-role").value = $("sp-cwd").value = $("sp-prompt").value = ""; if (j.id) setTimeout(() => select(j.id), 400);
}
$("sp-mode").querySelectorAll("button").forEach((b) => (b.onclick = () => setSpawnMode(b.dataset.mode)));
$("sp-addvar").onclick = () => { if (variantRows.length >= 6) return toast("6 variantes max"); variantRows.push({ model: "sonnet" }); renderVariants(); };

// ---- équipes ------------------------------------------------------------------
let rolesCache = ["Architecte", "Backend", "Frontend", "DevOps", "QA"];
const DEFAULT_CHECKED = new Set(["Architecte", "Backend", "Frontend"]);
function renderRoles(checked) { const box = $("tm-roles"); if (!box) return; box.innerHTML = rolesCache.map((r) => `<label><input type="checkbox" value="${esc(r)}" ${(checked ? checked.has(r) : DEFAULT_CHECKED.has(r)) ? "checked" : ""}/> ${esc(r)}</label>`).join(""); box.querySelectorAll("input").forEach((c) => (c.onchange = populateChief)); }
async function loadRoles(checked) { try { const j = await getJSON("/api/roles"); if (j.roles && j.roles.length) rolesCache = j.roles; } catch {} renderRoles(checked); populateChief(); }
const checkedRoles = () => [...$("tm-roles").querySelectorAll("input:checked")].map((c) => c.value);
function populateChief() { const sel = $("tm-chief"); if (!sel) return; const prev = sel.value, roles = checkedRoles(), managed = (snap.agents || []).filter((a) => a.managed); let html = `<optgroup label="Nouveau rôle">` + (roles.length ? roles.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join("") : `<option value="">(coche un rôle)</option>`) + `</optgroup>`; if (managed.length) html += `<optgroup label="Agent existant">` + managed.map((a) => `<option value="agent:${a.id}">${esc(a.name)} · ${esc(a.role)}</option>`).join("") + `</optgroup>`; sel.innerHTML = html; if (prev) sel.value = prev; }
async function addRole() { const inp = $("tm-newrole"), v = inp.value.trim(); if (!v) return; const checked = new Set(checkedRoles()); checked.add(v); const j = await post("/api/roles", { role: v }); if (!j.ok) return toast("Erreur"); rolesCache = j.roles || rolesCache; inp.value = ""; renderRoles(checked); populateChief(); toast("✅ métier : " + v); }
async function fillTeamHosts() {
  if (!railHostsCache.length) await pollRailHosts();
  const hosts = railHostsCache.length ? railHostsCache : [{ id: "local", label: "local", online: true }];
  $("tm-host").innerHTML = hosts.map((h) => `<option value="${esc(h.id)}" ${h.online === false ? "disabled" : ""}>${esc(h.label || h.id)}${h.online === false ? " (hors-ligne)" : ""}</option>`).join("");
  const c = detailId && agentById(detailId); $("tm-host").value = (c && c.host) || (hosts.find((h) => h.id !== "local" && h.online !== false) || hosts[0]).id;
}
function openTeam() { openModal("team"); fillTeamHosts(); $("tm-err").textContent = ""; fillModels(); teamProv = "anthropic"; provSeg("tm-prov", teamProv, (v) => (teamProv = v)); loadRoles(); }
async function doTeam() {
  const roles = checkedRoles(); const body = { name: $("tm-name").value.trim(), goal: $("tm-goal").value.trim(), cwd: $("tm-cwd").value.trim(), host: $("tm-host").value, model: $("tm-model").value, perm: $("tm-perm").value, roles, chief: $("tm-chief").value, provider: teamProv };
  if (!body.cwd || !body.goal) { $("tm-err").textContent = "Objectif et workspace requis."; return; } if (!roles.length) { $("tm-err").textContent = "Choisis au moins un rôle."; return; }
  $("tm-go").disabled = true; const j = await post("/api/team", body); $("tm-go").disabled = false; if (!j.ok) { $("tm-err").textContent = j.error || "échec"; return; }
  closeModal("team"); toast("Équipe lancée"); if (j.teamId) openTeamView(j.teamId); $("tm-name").value = $("tm-goal").value = $("tm-cwd").value = "";
}


// ---- AUTOMATIONS : tâches récurrentes ------------------------------------------
let autos = [], autoTz = "Europe/Paris", autoEdit = null, autoTimer = null, autoDelArm = null;
const fmtNext = (ms) => ms ? new Intl.DateTimeFormat("fr-FR", { timeZone: autoTz, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(ms) : "—";
async function loadAuto() { try { const j = await getJSON("/api/automations"); autos = j.automations || []; autoTz = j.tz || autoTz; $("nav-auto").textContent = autos.length; if (view === "auto") renderAuto(); } catch {} }
function renderAuto() {
  const el = $("auto"); if (!el) return;
  const rows = autos.map((a) => {
    const ag = a.lastAgentId ? agentById(a.lastAgentId) : null;
    const last = !a.lastRunAt ? `<span class="ar-none">jamais exécutée</span>` :
      a.lastStatus === "error" ? `<span class="ar-err" title="${esc(a.lastError || "")}">${ico("xc", 12)} erreur · ${esc(relT(a.lastRunAt))}</span>` :
      a.lastStatus === "skipped" ? `<span class="ar-skip" title="${esc(a.lastError || "")}">${ico("clock", 12)} sautée · ${esc(relT(a.lastRunAt))}</span>` :
      `<span class="ar-ok ${ag ? "link" : ""}" ${ag ? `data-auopen="${esc(a.lastAgentId)}"` : ""}>${ag ? stGlyph(ag) : ico("checkc", 12)} ${esc(relT(a.lastRunAt))}</span>`;
    return `<div class="arow ${a.enabled ? "" : "off"}" data-au="${esc(a.id)}">
      <label class="switch" title="${a.enabled ? "Désactiver" : "Activer"}"><input type="checkbox" data-autog="${esc(a.id)}" ${a.enabled ? "checked" : ""} /><i></i></label>
      <div class="ar-main"><div class="ar-name">${esc(a.name)}</div>
        <div class="ar-sub"><span>${ico("clock", 11)}${esc(a.when)}</span><span>${ico("server", 11)}${esc(a.host || "local")}</span><span class="mono ellip">${esc(a.cwd)}</span>${a.worktree ? `<span>${ico("branch", 11)}worktree</span>` : ""}</div></div>
      <div class="ar-last">${last}</div>
      <div class="ar-next">${a.enabled ? `<small>Prochaine</small>${esc(fmtNext(a.nextRunAt))}` : `<small>en pause</small>`}</div>
      <div class="ar-act">
        <button class="icon-btn" data-aurun="${esc(a.id)}" title="Lancer maintenant">${ico("play", 14)}</button>
        <button class="icon-btn" data-auedit="${esc(a.id)}" title="Modifier">${ico("pencil", 14)}</button>
        <button class="icon-btn" data-audel="${esc(a.id)}" title="Supprimer">${ico("trash", 14)}</button>
      </div></div>`;
  }).join("");
  el.innerHTML = `<div class="auto-inner">
    <div class="auto-head"><div><h2>Automations</h2><p>Lance un prompt sur un nœud de ton tailnet selon un horaire, dans un worktree neuf à chaque exécution si tu veux. Fuseau : ${esc(autoTz)}.</p></div><button class="primary" id="au-new" type="button">Nouvelle automation</button></div>
    ${autos.length ? `<div class="auto-list">${rows}</div>` : `<div class="auto-empty"><span class="big" data-ico="zap" data-s="30"></span><b>Aucune automation</b><span>Planifie un revue de dépendances, un point matinal, un audit nocturne…</span><button class="ghost-btn" id="au-new2" type="button">Créer la première</button></div>`}
  </div>`;
  hydrateIcons(el);
  const n1 = $("au-new"), n2 = $("au-new2"); if (n1) n1.onclick = () => openAuto(); if (n2) n2.onclick = () => openAuto();
  el.querySelectorAll("[data-autog]").forEach((c) => (c.onchange = async () => { const j = await post("/api/automations/toggle", { id: c.dataset.autog, enabled: c.checked }); if (!j.ok) toast(j.error || "échec"); loadAuto(); }));
  el.querySelectorAll("[data-aurun]").forEach((b) => (b.onclick = async () => { b.disabled = true; const j = await post("/api/automations/run", { id: b.dataset.aurun }); b.disabled = false; toast(j.ok ? "Automation lancée" : (j.error || "échec")); loadAuto(); }));
  el.querySelectorAll("[data-auedit]").forEach((b) => (b.onclick = () => openAuto(autos.find((x) => x.id === b.dataset.auedit))));
  el.querySelectorAll("[data-audel]").forEach((b) => (b.onclick = async () => {
    if (autoDelArm !== b.dataset.audel) { autoDelArm = b.dataset.audel; b.classList.add("arm"); b.title = "Cliquer encore pour confirmer"; setTimeout(() => { if (autoDelArm === b.dataset.audel) { autoDelArm = null; b.classList.remove("arm"); } }, 3000); return; }
    autoDelArm = null; const j = await post("/api/automations/delete", { id: b.dataset.audel }); if (!j.ok) toast(j.error || "échec"); loadAuto();
  }));
  el.querySelectorAll("[data-auopen]").forEach((s) => (s.onclick = () => select(s.dataset.auopen)));
}
const AU_DOW = [["1", "lun"], ["2", "mar"], ["3", "mer"], ["4", "jeu"], ["5", "ven"], ["6", "sam"], ["0", "dim"]];
function schedFields(kind, s) {
  s = s || {}; const t = s.time || "09:00";
  if (kind === "hourly") return `<label class="au-inl">à la minute <input id="au-min" type="number" min="0" max="59" value="${+s.minute || 0}" /></label>`;
  if (kind === "interval") return `<label class="au-inl">toutes les <input id="au-every" type="number" min="1" max="59" value="${+s.every || 30}" /> <select id="au-unit"><option value="min" ${s.unit !== "h" ? "selected" : ""}>minutes</option><option value="h" ${s.unit === "h" ? "selected" : ""}>heures</option></select></label>`;
  if (kind === "cron") return `<input id="au-cron" class="mono" placeholder="*/15 9-18 * * 1-5" value="${esc(s.cron || "")}" /><div class="modal-sub">min heure jour-du-mois mois jour-de-semaine</div>`;
  const days = kind === "weekly" ? `<div class="au-days">${AU_DOW.map(([v, l]) => `<label><input type="checkbox" data-dow="${v}" ${(s.dow || [1]).map(String).includes(v) ? "checked" : ""} /><span>${l}</span></label>`).join("")}</div>` : "";
  return `${days}<label class="au-inl">à <input id="au-time" type="time" value="${esc(t)}" /></label>`;
}
function readSched() {
  const kind = $("au-kind").value;
  if (kind === "hourly") return { kind, minute: +$("au-min").value || 0 };
  if (kind === "interval") return { kind, every: +$("au-every").value || 1, unit: $("au-unit").value };
  if (kind === "cron") return { kind, cron: $("au-cron").value.trim() };
  const s = { kind, time: $("au-time").value || "09:00" };
  if (kind === "weekly") s.dow = [...$("au-sched").querySelectorAll("[data-dow]:checked")].map((c) => c.dataset.dow);
  return s;
}
async function openAuto(a) {
  autoEdit = a || null; $("au-err").textContent = ""; $("au-title").textContent = a ? "Modifier l'automation" : "Nouvelle automation";
  if (!railHostsCache.length) await pollRailHosts();
  const hosts = railHostsCache.length ? railHostsCache : [{ id: "local", label: "local", online: true }];
  $("au-host").innerHTML = hosts.map((h) => `<option value="${esc(h.id)}" ${h.online === false ? "disabled" : ""}>${esc(h.label || h.id)}${h.online === false ? " (hors-ligne)" : ""}</option>`).join("");
  $("au-model").innerHTML = MODELS.map((m) => `<option value="${m.v}">${m.l}</option>`).join("");
  const dirs = [...new Set((snap.agents || []).map((x) => x.cwd).filter((c) => c && c.startsWith("/")))];
  $("au-dirs").innerHTML = dirs.map((d) => `<option value="${esc(d)}"></option>`).join("");
  const bed = $("au-prov").querySelector('[value="bedrock"]'); if (bed) bed.disabled = !snap.bedrock;
  $("au-name").value = a ? a.name : ""; $("au-prompt").value = a ? a.prompt : ""; $("au-cwd").value = a ? a.cwd : (detailId && agentById(detailId) && agentById(detailId).cwd) || "";
  $("au-host").value = a ? (a.host || "local") : ((detailId && agentById(detailId) && agentById(detailId).host) || (hosts.find((h) => h.id !== "local" && h.online !== false) || hosts[0]).id);
  $("au-model").value = a ? a.model : "sonnet"; $("au-prov").value = a ? a.provider : "anthropic"; $("au-wt").checked = a ? !!a.worktree : false; $("au-en").checked = a ? a.enabled : true;
  const kind = a ? a.schedule.kind : "daily"; $("au-kind").value = kind; $("au-sched").innerHTML = schedFields(kind, a && a.schedule);
  $("au-tz").textContent = "Fuseau horaire : " + autoTz;
  openModal("autom"); setTimeout(() => $("au-name").focus(), 60);
}
$("au-kind").onchange = () => { $("au-sched").innerHTML = schedFields($("au-kind").value, null); };
$("au-go").onclick = async () => {
  const body = { id: autoEdit && autoEdit.id, name: $("au-name").value, prompt: $("au-prompt").value, cwd: $("au-cwd").value, host: $("au-host").value, model: $("au-model").value, provider: $("au-prov").value, worktree: $("au-wt").checked, enabled: $("au-en").checked, schedule: readSched() };
  $("au-go").disabled = true; const j = await post("/api/automations/save", body); $("au-go").disabled = false;
  if (!j.ok) { $("au-err").textContent = j.error || "échec"; return; }
  closeModal("autom"); toast(autoEdit ? "Automation mise à jour" : "Automation créée"); loadAuto();
};


// ---- ÉQUIPES : supervision multi-agents (volets par agent, chef, TEAM_NOTES.md, message à tous) ------------
let tvFeedHtml = {}, tvNotesHtml = "", tvTeamId = null, tvLayout = LSJ("fleet.tvLayout", "focus"), tvNotes = LSJ("fleet.tvNotes", true), tvTimer = null, tvSig = "", tvFeedSig = {}, tvNotesSig = "", tvTick = 0, tvStopArm = false;
const membersOf = (tid) => (snap.agents || []).filter((a) => a.teamId === tid).sort((x, y) => (y.chief ? 1 : 0) - (x.chief ? 1 : 0) || String(x.name).localeCompare(String(y.name)));
let tvWantAt = 0;
function openTeamView(tid) { if (tid) { tvTeamId = tid; tvWantAt = Date.now(); } tvSig = ""; setView("teams"); }
function renderTeams() {
  const el = $("teams"); if (!el) return;
  const teams = snap.teams || [];
  if (!el.dataset.w) { el.dataset.w = "1"; el.addEventListener("click", (e) => { const m = e.target.closest(".tpm.you"); if (m) m.classList.toggle("open"); }); }
  if (!teams.length) {
    if (tvSig !== "empty") { tvSig = "empty"; el.innerHTML = `<div class="auto-empty" style="margin:60px auto;max-width:34rem"><span class="big" data-ico="users" data-s="30"></span><b>Aucune équipe en cours</b><span>Une équipe regroupe plusieurs agents (un chef + des métiers) qui travaillent ensemble sur un même dossier. Tu les supervises ici, tous en même temps.</span><button class="primary" id="tv-new0" type="button" style="margin-top:8px">Créer une équipe</button></div>`; hydrateIcons(el); $("tv-new0").onclick = () => openTeam(); }
    return;
  }
  if (tvTeamId && !teams.some((t) => t.id === tvTeamId) && Date.now() - tvWantAt < 8000) { el.innerHTML = `<div class="tp-wait" style="padding:60px">Lancement de l'équipe…</div>`; tvSig = ""; return; }
  if (!tvTeamId || !teams.some((t) => t.id === tvTeamId)) tvTeamId = teams[0].id;
  const t = teams.find((x) => x.id === tvTeamId), mem = membersOf(t.id);
  const sig = [t.id, tvLayout, tvNotes, teams.map((x) => x.id + x.name).join(","), mem.map((m) => m.id).join(",")].join("~");
  if (sig !== tvSig) { buildTeams(el, teams, t, mem); tvSig = sig; }
  updateTeamsLive(t, mem);
}
function buildTeams(el, teams, t, mem) {
  const drafts = {}; el.querySelectorAll("[data-tpin]").forEach((i) => { if (i.value) drafts[i.dataset.tpin] = i.value; });
  const bcDraft = ($("tv-bc") || {}).value || "";
  const seg = (v, l, ic) => `<button class="pseg ${tvLayout === v ? "sel" : ""}" data-tvlay="${v}" title="${l}" type="button">${ico(ic, 14)}</button>`;
  const chips = teams.length > 1 ? `<div class="psegs tv-chips">${teams.map((x) => `<button class="pseg ${x.id === t.id ? "sel" : ""}" data-tvteam="${esc(x.id)}" type="button">${esc(x.name)}</button>`).join("")}</div>` : "";
  const pane = (a) => `<section class="tp ${a.chief ? "chief" : ""}" data-tp="${esc(a.id)}">
    <header class="tp-h"><span class="tp-g" data-g></span><b class="tp-n">${esc(String(a.name).replace(/\s*👑\s*/g, ""))}</b>${a.chief ? `<span class="tp-crown" title="chef d'équipe">${ico("crown", 12)}</span>` : ""}<span class="tp-chip" data-role>${esc(a.role || "")}</span><span class="tp-chip mono" data-host></span><span class="tp-st" data-st></span><span class="sp"></span><button class="icon-btn" data-tpopen="${esc(a.id)}" title="Ouvrir la session" type="button">${ico("expand", 14)}</button></header>
    <div class="tp-feed" data-feed><div class="tp-wait">chargement…</div></div>
    <footer class="tp-f"><textarea rows="1" data-tpin="${esc(a.id)}" placeholder="Écrire à ${esc(String(a.name).replace(/\s*👑\s*/g, ""))}…"></textarea><button class="send-btn sm" data-tpsend="${esc(a.id)}" type="button" title="Envoyer">${ico("up", 14)}</button></footer>
  </section>`;
  el.innerHTML = `<div class="tv">
    <div class="tv-bar">
      ${chips}
      <div class="tv-title"><b>${esc(t.name)}</b>${t.goal && t.goal !== t.name ? `<span class="tv-goal" title="${esc(t.goal)}">${esc(t.goal)}</span>` : ""}</div>
      <div class="tv-sum" id="tv-sum"></div>
      <div class="tv-act">
        <div class="psegs">${seg("focus", "Chef en grand", "panel")}${seg("grid", "Grille égale", "grid")}</div>
        <button class="ghost-btn sm ${tvNotes ? "on" : ""}" id="tv-notes-btn" type="button">${ico("file", 13)}Notes</button>
        <button class="ghost-btn sm" id="tv-new" type="button">${ico("plus", 13)}Nouvelle équipe</button>
        <button class="ghost-btn sm danger" id="tv-stop" type="button">${ico("power", 13)}Arrêter</button>
      </div>
    </div>
    <div class="tv-bc"><span class="tv-bc-l">${ico("users", 14)}</span><input id="tv-bc" placeholder="Message à toute l'équipe…" autocomplete="off" /><label class="tv-only"><input type="checkbox" id="tv-bc-chief" />chef seul</label><button class="send-btn sm" id="tv-bc-go" type="button" title="Envoyer à l'équipe">${ico("up", 14)}</button></div>
    <div class="tv-body">
      <div class="tv-panes tv-${tvLayout}" style="--rows:${Math.max(1, mem.length - 1)}">${mem.map(pane).join("")}</div>
      <aside class="tv-notes ${tvNotes ? "" : "hidden"}"><div class="tv-notes-h">${ico("file", 13)}<b>TEAM_NOTES.md</b><span class="tv-notes-p" id="tv-notes-p"></span></div><div class="tv-notes-b mbody md" id="tv-notes-b"><div class="tp-wait">chargement…</div></div></aside>
    </div></div>`;
  hydrateIcons(el);
  mem.forEach((a) => { const f = el.querySelector(`[data-tp="${a.id}"] [data-feed]`); if (f && tvFeedHtml[a.id]) { f.innerHTML = tvFeedHtml[a.id]; f.scrollTop = f.scrollHeight; } });
  if (tvNotesHtml && $("tv-notes-b")) $("tv-notes-b").innerHTML = tvNotesHtml;
  el.querySelectorAll("[data-tvlay]").forEach((b) => (b.onclick = () => { tvLayout = b.dataset.tvlay; LSW("fleet.tvLayout", tvLayout); renderTeams(); }));
  el.querySelectorAll("[data-tvteam]").forEach((b) => (b.onclick = () => { tvTeamId = b.dataset.tvteam; tvFeedHtml = {}; tvFeedSig = {}; tvNotesHtml = ""; tvNotesSig = ""; renderTeams(); pollTeams(true); }));
  $("tv-notes-btn").onclick = () => { tvNotes = !tvNotes; LSW("fleet.tvNotes", tvNotes); renderTeams(); };
  $("tv-new").onclick = () => openTeam();
  $("tv-stop").onclick = async () => {
    const b = $("tv-stop"); if (!tvStopArm) { tvStopArm = true; b.classList.add("arm"); b.lastChild.textContent = "Confirmer ?"; setTimeout(() => { tvStopArm = false; const x = $("tv-stop"); if (x) { x.classList.remove("arm"); x.lastChild.textContent = "Arrêter"; } }, 3500); return; }
    tvStopArm = false; const j = await post("/api/team-kill", { teamId: t.id }); toast(j.ok ? `Équipe arrêtée (${j.killed})` : (j.error || "échec"));
  };
  const bc = async () => { const v = $("tv-bc").value.trim(); if (!v) return; $("tv-bc-go").disabled = true; const j = await post("/api/team-send", { teamId: t.id, prompt: v, onlyChief: $("tv-bc-chief").checked }); $("tv-bc-go").disabled = false; if (!j.ok) return toast(j.error || "échec"); $("tv-bc").value = ""; toast(`Envoyé à ${j.sent} agent${j.sent > 1 ? "s" : ""}`); setTimeout(() => pollTeams(true), 800); };
  $("tv-bc-go").onclick = bc; $("tv-bc").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); bc(); } }; $("tv-bc").value = bcDraft;
  el.querySelectorAll("[data-tpopen]").forEach((b) => (b.onclick = () => select(b.dataset.tpopen)));
  const send = async (id) => { const i = el.querySelector(`[data-tpin="${id}"]`), v = i.value.trim(); if (!v) return; i.value = ""; i.style.height = ""; const j = await post("/api/send", { id, prompt: v }); if (!j.ok) { i.value = v; toast(j.error || "échec"); } else setTimeout(() => pollTeams(true), 700); };
  el.querySelectorAll("[data-tpsend]").forEach((b) => (b.onclick = () => send(b.dataset.tpsend)));
  el.querySelectorAll("[data-tpin]").forEach((i) => {
    if (drafts[i.dataset.tpin]) i.value = drafts[i.dataset.tpin];
    i.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(i.dataset.tpin); } };
    i.oninput = () => { i.style.height = "auto"; i.style.height = Math.min(i.scrollHeight, 120) + "px"; };
  });
}
function updateTeamsLive(t, mem) {
  const work = mem.filter(isActive).length, ask = mem.filter((m) => m.status === "blocked").length, rest = mem.length - work - ask;
  const sum = $("tv-sum"); if (sum) sum.innerHTML = `${work ? `<span class="tv-pill w"><span class="spin"></span>${work} au travail</span>` : ""}${ask ? `<span class="tv-pill q">${ico("help", 12)}${ask} en attente</span>` : ""}${rest ? `<span class="tv-pill">${rest} au repos</span>` : ""}${t.awaitingDecision ? `<span class="tv-pill d" title="tous les membres ont fini">${ico("checkc", 12)}en attente de ta décision</span>` : ""}`;
  mem.forEach((a) => {
    const p = document.querySelector(`[data-tp="${a.id}"]`); if (!p) return;
    const g = p.querySelector("[data-g]"), h = stGlyph(a, true); if (g.dataset.k !== h) { g.dataset.k = h; g.innerHTML = h; }
    p.querySelector("[data-host]").textContent = a.host || "local"; p.querySelector("[data-st]").textContent = st(a).l + (a.model ? " · " + a.model : "");
    p.classList.toggle("working", !!a.busy);
  });
}
const tpClip = (s, n) => { s = String(s || ""); return s.length > n ? s.slice(0, n) + "…" : s; };
function tpFeedHTML(feed) {
  const items = feed.filter((e) => e.kind === "say" || e.kind === "prompt" || e.kind === "tool").slice(-14);
  if (!items.length) return `<div class="tp-wait">aucune activité</div>`;
  return items.map((e) => e.kind === "tool" ? `<div class="tpt">${esc(String(e.text || "").split("\n")[0].slice(0, 160))}</div>`
    : e.kind === "prompt" ? `<div class="tpm you">${esc(tpClip(e.text, 280))}</div>`
    : `<div class="tpm mbody md">${mdToHtml(tpClip(e.text, 1800))}</div>`).join("");
}
async function pollTeams(force) {
  if (view !== "teams" || detailId || !tvTeamId) return;
  tvTick++; const mem = membersOf(tvTeamId);
  await Promise.all(mem.map(async (a) => {
    const p = document.querySelector(`[data-tp="${a.id}"] [data-feed]`); if (!p) return;
    try {
      const j = await getJSON("/api/transcript?id=" + encodeURIComponent(a.id) + "&n=24");
      const f = j.feed || [], last = f[f.length - 1], sig = f.length + ":" + (last ? (last.text || "").length + last.kind : "");
      if (tvFeedSig[a.id] === sig) return; tvFeedSig[a.id] = sig;
      const near = p.scrollHeight - p.scrollTop - p.clientHeight < 80;
      p.innerHTML = tvFeedHtml[a.id] = tpFeedHTML(f); if (near || force) p.scrollTop = p.scrollHeight;
    } catch {}
  }));
  if (tvNotes && (force || tvTick % 2 === 1)) {
    try {
      const j = await getJSON("/api/teamnotes?teamId=" + encodeURIComponent(tvTeamId)), b = $("tv-notes-b"); if (!b) return;
      const sig = j.ok ? "ok:" + j.text.length + ":" + j.text.slice(-60) : "missing"; if (sig === tvNotesSig) return; tvNotesSig = sig;
      $("tv-notes-p").textContent = j.host ? j.host : "";
      b.innerHTML = tvNotesHtml = j.ok && j.text.trim() ? mdToHtml(j.text) : `<div class="tp-wait">Pas encore de TEAM_NOTES.md — le chef le crée dès que l'équipe démarre.</div>`;
    } catch {}
  }
}

// ---- modales / toast / pièces jointes -----------------------------------------
function openModal(id) { $("backdrop").classList.remove("hidden"); $(id).classList.remove("hidden"); }
function closeModal(id) { $(id).classList.add("hidden"); $("backdrop").classList.add("hidden"); }
let toastT = null;
function toast(msg) { const t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2600); }
const attC = [], attS = [];
const fmtSize = (n) => { n = n || 0; return n >= 1048576 ? (n / 1048576).toFixed(1) + " Mo" : n >= 1024 ? Math.round(n / 1024) + " Ko" : n + " o"; };
const readyIds = (arr) => arr.filter((a) => a.uploadId).map((a) => a.uploadId);
function renderTray(listEl, arr) { if (!listEl) return; listEl.classList.toggle("hidden", arr.length === 0); listEl.innerHTML = arr.map((a, i) => `<span class="fchip ${a.pending ? "pending" : ""}"><span>${a.pending ? "⏳" : "📎"}</span><span>${esc(a.name)}</span><small style="color:var(--mut2)">${a.size != null ? fmtSize(a.size) : ""}</small><button class="fx" data-rm="${i}">✕</button></span>`).join(""); listEl.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); arr.splice(+b.dataset.rm, 1); renderTray(listEl, arr); })); }
async function uploadOne(file, arr, listEl) { const item = { name: file.name, size: file.size, pending: true, uploadId: null }; arr.push(item); renderTray(listEl, arr); try { const r = await fetch("/api/upload", { method: "POST", headers: { "X-Filename": encodeURIComponent(file.name) }, body: file }); const j = await r.json(); if (j.ok) { item.uploadId = j.uploadId; item.pending = false; item.size = j.size; } else { toast("Upload échoué"); arr.splice(arr.indexOf(item), 1); } } catch { toast("Upload échoué"); const k = arr.indexOf(item); if (k >= 0) arr.splice(k, 1); } renderTray(listEl, arr); }
const addFiles = (files, arr, listEl) => [...files].forEach((f) => uploadOne(f, arr, listEl));
function wireDrop(zoneEl, arr, listEl) { if (!zoneEl) return; zoneEl.addEventListener("dragover", (e) => { e.preventDefault(); zoneEl.classList.add("drag"); }); zoneEl.addEventListener("dragleave", (e) => { if (e.target === zoneEl) zoneEl.classList.remove("drag"); }); zoneEl.addEventListener("drop", (e) => { e.preventDefault(); zoneEl.classList.remove("drag"); if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files, arr, listEl); }); }

// ---- DESIGN / PREVIEW (proxy same-origin + sélecteur) -------------------------
function mkDesign(cfg) { return { ...cfg, picking: false, url: "", lastPick: null, built: false }; }
const DESIGN = mkDesign({ url: "dz-url", frame: "dz-frame", empty: "dz-empty", pick: "dz-pick", card: "dz-card", load: "dz-load", target: "dz-target", storeKey: "fleet.designUrl", perAgent: false });
const PREVIEW = mkDesign({ url: "pv-url", frame: "pv-frame", empty: "pv-empty", pick: "pv-pick", card: "pv-card", load: "pv-load", target: null, storeKey: "fleet.previewUrl", perAgent: true });
function designAgentOptions(cur) { const ags = (snap.agents || []).filter((a) => !a.internal); if (!cur && detailId) cur = detailId; if (!cur && ags[0]) cur = ags[0].id; return { cur, html: ags.length ? ags.map((a) => `<option value="${esc(a.id)}" ${a.id === cur ? "selected" : ""}>${esc(a.name)} · ${esc(a.host || "local")}</option>`).join("") : `<option value="">(aucun)</option>` }; }
function renderDesign() {
  const el = $("design");
  if (!DESIGN.built) {
    const saved = (() => { try { return localStorage.getItem(DESIGN.storeKey) || ""; } catch { return ""; } })();
    el.innerHTML = `<div class="design-bar"><input id="dz-url" class="dz-url" placeholder="http://<nœud>:3000 — serveur de dev" value="${esc(saved)}" autocomplete="off" /><button id="dz-load" class="dz-btn" type="button">Charger</button><button id="dz-pick" class="dz-btn" type="button">◉ Sélectionner</button><select id="dz-target" class="dz-target"></select></div><div class="design-stage"><iframe id="dz-frame" class="dz-frame" referrerpolicy="no-referrer"></iframe><div id="dz-empty" class="dz-empty"><span class="big">🎨</span>Entre l'URL d'un serveur de dev (ex. <code>http://black-station:3000</code>) et « Charger ».<br><span style="color:var(--mut2);font-size:12px">Puis « ◉ Sélectionner » → clique un élément : HTML+CSS envoyés à l'agent cible.</span></div></div><div id="dz-card" class="dz-card hidden"></div>`;
    wireDesign(DESIGN); DESIGN.built = true; DESIGN.url = saved; if (saved) designLoad(DESIGN);
  }
  const o = designAgentOptions(DESIGN.targetVal); DESIGN.targetVal = o.cur; $("dz-target").innerHTML = o.html;
}
function initPreview() {
  if (!PREVIEW.built) { wireDesign(PREVIEW); PREVIEW.built = true; }
  const a = agentById(detailId);
  if (a && !$("pv-url").value) { const saved = (() => { try { return localStorage.getItem(PREVIEW.storeKey) || ""; } catch { return ""; } })(); $("pv-url").value = saved || ("http://" + (a.host || "localhost") + ":3000"); }
  PREVIEW.targetVal = detailId;
}
function wireDesign(D) {
  $(D.load).onclick = () => designLoad(D);
  $(D.url).onkeydown = (e) => { if (e.key === "Enter") designLoad(D); };
  $(D.pick).onclick = () => designTogglePick(D);
  if (D.target && $(D.target)) $(D.target).onchange = (e) => { D.targetVal = e.target.value; };
}
function designLoad(D) {
  const u = ($(D.url).value || "").trim(); if (!u) return;
  D.url = /^https?:\/\//i.test(u) ? u : ("http://" + u); try { localStorage.setItem(D.storeKey, D.url); } catch {}
  $(D.empty).classList.add("hidden"); const f = $(D.frame); f.classList.add("show"); f.src = "/api/proxy?url=" + encodeURIComponent(D.url);
  D.picking = false; $(D.pick).classList.remove("on"); $(D.card).classList.add("hidden");
}
function designTogglePick(D) {
  DESIGN.picking = false; PREVIEW.picking = false; $("dz-pick") && $("dz-pick").classList.remove("on"); $("pv-pick") && $("pv-pick").classList.remove("on");
  D.picking = true; $(D.pick).classList.add("on");
  const f = $(D.frame); try { f.contentWindow.postMessage({ __fleetPickMode: true }, "*"); } catch {}
  toast("◉ clique un élément dans l'aperçu");
}
window.addEventListener("message", (e) => { const d = e.data; if (!d || !d.__fleetPick) return; const D = DESIGN.picking ? DESIGN : PREVIEW.picking ? PREVIEW : null; if (!D) return; D.lastPick = d.__fleetPick; designShowPick(D, d.__fleetPick); });
function designShowPick(D, pk) {
  const card = $(D.card); if (!card) return;
  const styles = Object.entries(pk.styles || {}).filter(([, v]) => v && v !== "none" && v !== "normal").map(([k, v]) => `<span class="dz-st"><b>${esc(k)}</b> ${esc(v)}</span>`).join("");
  card.classList.remove("hidden");
  card.innerHTML = `<div class="dz-card-h"><span class="dz-sel">${esc(pk.selector)}</span><span class="dz-sz">${pk.rect ? pk.rect.w + "×" + pk.rect.h + "px" : ""}</span><button class="dz-x" data-dzx type="button">✕</button></div><div class="dz-styles">${styles}</div><pre class="dz-html">${esc(pk.html)}</pre><textarea class="dz-note" data-dznote placeholder="Que changer ? (ex. « agrandis le bouton, fond bleu, coins arrondis »)"></textarea><button class="dz-send" data-dzsend type="button">Envoyer à l'agent ➤</button>`;
  card.querySelector("[data-dzx]").onclick = () => card.classList.add("hidden");
  card.querySelector("[data-dzsend]").onclick = () => designSend(D);
  const n = card.querySelector("[data-dznote]"); if (n) n.focus();
}
function designSend(D) {
  const id = D.perAgent ? (detailId || D.targetVal) : ($(D.target) ? $(D.target).value : D.targetVal);
  const a = agentById(id); if (!a) return toast("choisis un agent cible"); const pk = D.lastPick; if (!pk) return;
  const note = (() => { const n = $(D.card).querySelector("[data-dznote]"); return n ? n.value.trim() : ""; })();
  const styles = Object.entries(pk.styles || {}).map(([k, v]) => `${k}: ${v}`).join("; ");
  let msg = `🎨 Design — élément \`${pk.selector}\` sur ${D.url}` + (pk.rect ? ` (${pk.rect.w}×${pk.rect.h}px)` : "") + ` :\n\n\`\`\`html\n${pk.html}\n\`\`\`\nStyles calculés : ${styles}\n`;
  if (note) msg += `\nDemande : ${note}`;
  msg += `\n\nTrouve le code source correspondant, applique le changement, committe sur ta branche.`;
  post("/api/send", { id: a.id, prompt: msg, origin: "web" }).then((j) => { if (!j.ok) return toast("Erreur : " + (j.error || "")); toast("🎨 envoyé à " + a.name); $(D.card).classList.add("hidden"); D.lastPick = null; });
}

// ---- command palette ----------------------------------------------------------
let palItems = [], palSel = 0, palOpen = false;
function paletteSource() {
  const items = [];
  items.push({ kind: "action", ic: "＋", name: "Nouvelle tâche", sub: "solo", run: () => { closePalette(); openSpawn(); } });
  items.push({ kind: "action", ic: "⑂", name: "Fan-out parallèle", sub: "N variantes à comparer", run: () => { closePalette(); openSpawn(); setSpawnMode("fanout"); } });
  items.push({ kind: "action", ic: "👥", name: "Lancer une équipe", run: () => { closePalette(); openTeam(); } });
  items.push({ kind: "action", ic: "◐", name: "Apparence — palettes", sub: "thème, couleurs, taille du texte", run: () => { closePalette(); openTheme(); } });
  if (window.FleetTheme && detailId) FleetTheme.list().forEach((p) => items.push({ kind: "conversation", ic: "◐", name: "Palette de cette conversation : " + p.name, run: () => { closePalette(); setSessionTheme(detailId, p.id); } }));
  if (window.FleetTheme) FleetTheme.list().forEach((p) => items.push({ kind: "thème", ic: "◐", name: "Thème : " + p.name, run: () => { closePalette(); FleetTheme.use(p.id); } }));
  if (detailId) items.push({ kind: "action", ic: "×", name: "Fermer l'onglet courant", run: () => { closePalette(); closeTab(detailId); } });
  [["board", "Board"], ["auto", "Automations"], ["machines", "Machines"], ["skills", "Skills"], ["audit", "Audit"], ["design", "Design"]].forEach(([v, l]) => items.push({ kind: "vue", ic: "›", name: "Aller à " + l, run: () => { closePalette(); setView(v); } }));
  (snap.agents || []).filter((a) => !a.internal).forEach((a) => items.push({ kind: "session", ic: "🤖", name: a.name, sub: (a.worktree && a.branch ? "⑂ " + a.branch + " · " : "") + (a.host || "local"), dot: st(a).c, run: () => { closePalette(); select(a.id); } }));
  (railHostsCache || []).forEach((h) => items.push({ kind: "machine", ic: "🖥", name: h.label || h.id, sub: h.ip || "", run: () => { closePalette(); machSelectedHost = h.id; setView("machines"); } }));
  if (_skillsData && _skillsData.categories) _skillsData.categories.forEach((c) => c.skills.forEach((s) => items.push({ kind: "skill", ic: "◈", name: s.name, sub: c.category, run: () => { closePalette(); setView("skills"); setTimeout(() => openSkill(s.path), 150); } })));
  return items;
}
function openPalette() { palOpen = true; $("palette").classList.remove("hidden"); const i = $("pal-input"); i.value = ""; buildPalette(""); i.focus(); }
function closePalette() { palOpen = false; $("palette").classList.add("hidden"); }
function buildPalette(q) { q = (q || "").toLowerCase().trim(); let items = paletteSource(); if (q) items = items.filter((it) => (it.name + " " + (it.sub || "") + " " + it.kind).toLowerCase().includes(q)); palItems = items.slice(0, 40); palSel = 0; renderPalette(); }
function renderPalette(keepScroll) {
  const box = $("pal-list");
  if (!palItems.length) { box.innerHTML = `<div class="pal-item" style="cursor:default;color:var(--mut2)">Aucun résultat</div>`; return; }
  box.innerHTML = palItems.map((it, i) => `<div class="pal-item ${i === palSel ? "sel" : ""}" data-pi="${i}"><span class="pi-ic">${it.dot ? `<span class="pi-dot" style="background:${it.dot}"></span>` : it.ic}</span><div class="pi-main"><div class="pi-name">${esc(it.name)}</div>${it.sub ? `<div class="pi-sub">${esc(it.sub)}</div>` : ""}</div><span class="pi-kind">${esc(it.kind)}</span></div>`).join("");
  box.querySelectorAll("[data-pi]").forEach((d) => { d.onmouseenter = () => { palSel = +d.dataset.pi; box.querySelectorAll(".pal-item").forEach((x, i) => x.classList.toggle("sel", i === palSel)); }; d.onclick = () => palRun(+d.dataset.pi); });
  if (!keepScroll) box.scrollTop = 0; const sel = box.querySelector(".pal-item.sel"); if (sel && keepScroll) sel.scrollIntoView({ block: "nearest" });
}
function palRun(i) { const it = palItems[i]; if (it && it.run) it.run(); }
$("pal-input").oninput = (e) => buildPalette(e.target.value);
$("palette").onclick = (e) => { if (e.target === $("palette")) closePalette(); };
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) { e.preventDefault(); palOpen ? closePalette() : openPalette(); return; }
  if (palOpen) { if (e.key === "Escape") { e.preventDefault(); closePalette(); } else if (e.key === "ArrowDown") { e.preventDefault(); palSel = Math.min(palSel + 1, palItems.length - 1); renderPalette(true); } else if (e.key === "ArrowUp") { e.preventDefault(); palSel = Math.max(palSel - 1, 0); renderPalette(true); } else if (e.key === "Enter") { e.preventDefault(); palRun(palSel); } return; }
  if (e.key === "Escape") { for (const m of ["fx", "skillview", "spawn", "team", "theme"]) if (!$(m).classList.contains("hidden")) { closeModal(m); return; } if ($("app").classList.contains("ctx-open")) $("app").classList.remove("ctx-open"); }
});


// ---- onglets de sessions (façon Orca) ------------------------------------------
const TABS_KEY = "fleet.tabs";
let openTabs = (() => { try { const a = JSON.parse(localStorage.getItem(TABS_KEY) || "[]"); return Array.isArray(a) ? a.filter((x) => typeof x === "string") : []; } catch { return []; } })();
const lastCenter = {};
let tabDrag = null;
function saveTabs() { try { localStorage.setItem(TABS_KEY, JSON.stringify(openTabs)); } catch {} }
function addTab(id) { if (!openTabs.includes(id)) { openTabs.push(id); saveTabs(); } }
function closeTab(id) {
  const i = openTabs.indexOf(id); if (i < 0) return;
  openTabs.splice(i, 1); saveTabs();
  if (detailId === id) { const next = openTabs[i] || openTabs[i - 1]; if (next && agentById(next)) select(next); else setView(view); }
  else renderTabbar();
}
const VIEW_LABEL = { board: ["board", "Board"], teams: ["users", "Équipes"], auto: ["zap", "Automations"], machines: ["server", "Machines"], skills: ["book", "Skills"], audit: ["file", "Audit"], design: ["palette", "Design"] };
function renderTabbar() {
  const el = $("tabbar"); if (!el || tabDrag) return;
  const ags = snap.agents || [];
  if (ags.length) { const keep = openTabs.filter((id) => ags.some((a) => a.id === id)); if (keep.length !== openTabs.length) { openTabs = keep; saveTabs(); } }
  const [vi, vl] = VIEW_LABEL[view] || VIEW_LABEL.board;
  const tabs = openTabs.map(agentById).filter(Boolean);
  const sig = [view, detailId, tabs.map((a) => a.id + a.name + (sessThemes[a.id] || "") + a.status + (a.busy ? 1 : 0) + (isReview(a) ? 1 : 0) + (a.busy ? "w" : "")).join("|")].join("~");
  if (renderTabbar._sig === sig) return; renderTabbar._sig = sig;
  el.innerHTML = `<div class="tab pin ${detailId ? "" : "sel"}" data-vtab><span class="tic">${ico(vi, 14)}</span><span class="tn">${vl}</span></div>` +
    tabs.map((a) => `<div class="tab ${detailId === a.id ? "sel" : ""} ${a.busy ? "work" : ""}${tcAttr(a.id)}" data-tab="${esc(a.id)}" draggable="true" title="${esc(a.name)}${a.branch ? " · " + esc(a.branch) : ""}"><span class="tgl">${stGlyph(a)}</span><span class="tn">${esc(a.name)}</span><button class="tx" data-tx="${esc(a.id)}" type="button" aria-label="fermer l'onglet">${ico("x", 12)}</button></div>`).join("") +
    `<button class="tab-add" id="tab-add" type="button" title="Nouvelle tâche">${ico("plus", 15)}</button><div class="tab-fill"></div>`;
  el.querySelector("[data-vtab]").onclick = () => setView(view);
  $("tab-add").onclick = () => openSpawn();
  el.querySelectorAll("[data-tab]").forEach((t) => {
    const id = t.dataset.tab;
    t.onclick = () => { if (detailId === id) return; const lc = lastCenter[id]; select(id); if (lc && lc !== "conv") setCenterTab(lc); };
    t.onauxclick = (e) => { if (e.button === 1) { e.preventDefault(); closeTab(id); } };
    t.ondragstart = (e) => { tabDrag = id; e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", id); } catch {} };
    t.ondragover = (e) => { if (tabDrag && tabDrag !== id) { e.preventDefault(); t.classList.add("dragover"); } };
    t.ondragleave = () => t.classList.remove("dragover");
    t.ondrop = (e) => { e.preventDefault(); const from = openTabs.indexOf(tabDrag), to = openTabs.indexOf(id); if (from >= 0 && to >= 0 && from !== to) { openTabs.splice(to, 0, openTabs.splice(from, 1)[0]); saveTabs(); } tabDrag = null; renderTabbar._sig = null; renderTabbar(); };
    t.ondragend = () => { tabDrag = null; renderTabbar._sig = null; renderTabbar(); };
  });
  el.querySelectorAll("[data-tx]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); closeTab(b.dataset.tx); }));
  const sel = el.querySelector(".tab.sel"); if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: "nearest", inline: "nearest" });
}

// ---- apparence : palettes -----------------------------------------------------
function openTheme() { if (!detailId) thScope = "global"; renderThemePanel(); openModal("theme"); }
function renderThemePanel() {
  const T = window.FleetTheme; if (!T) return;
  const sid = detailId, conv = thScope === "conv" && !!sid;
  if (thScope === "conv" && !sid) thScope = "global";
  const cur = conv ? (sessPal(sid) || T.global()) : T.global(), list = T.list();
  let sc = $("th-scope"); if (!sc) { sc = document.createElement("div"); sc.id = "th-scope"; $("th-grid").parentNode.insertBefore(sc, $("th-grid")); }
  sc.innerHTML = sid ? `<div class="psegs"><button class="pseg ${conv ? "" : "sel"}" data-scope="global" type="button">Global</button><button class="pseg ${conv ? "sel" : ""}" data-scope="conv" type="button">Cette conversation</button></div>${conv && sessThemes[sid] ? `<button class="ghost-btn" id="th-inherit" type="button">↩ Hériter du global</button>` : ""}<div class="modal-sub" style="margin:8px 0 0">${conv ? "La palette s'applique quand cette conversation est ouverte et colore son onglet." : "Thème par défaut de l'app."}</div>` : "";
  sc.querySelectorAll("[data-scope]").forEach((b) => (b.onclick = () => { thScope = b.dataset.scope; renderThemePanel(); }));
  if ($("th-inherit")) $("th-inherit").onclick = () => { setSessionTheme(sid, null); renderThemePanel(); };
  const pick = (id) => (conv ? setSessionTheme(sid, id) : T.use(id));
  const sw = (p) => { const d = T.derive(p).vars; return `<div class="th-sw"><i style="background:${d["--bg"]}"></i><i style="background:${d["--panel2"]}"></i><i style="background:${d["--ink"]}"></i><i style="background:${d["--acc"]}"></i></div>`; };
  $("th-grid").innerHTML = list.map((p) => `<button class="th-card ${p.id === cur.id ? "sel" : ""}" data-pal="${esc(p.id)}" type="button">${sw(p)}<div class="th-nm">${esc(p.name)}${p.preset ? "" : " <small>perso</small>"}</div></button>`).join("") +
    `<button class="th-card add" data-pal-new type="button">＋ Nouvelle palette</button>`;
  $("th-grid").querySelectorAll("[data-pal]").forEach((b) => (b.onclick = () => { pick(b.dataset.pal); renderThemePanel(); }));
  const dup = () => { const c = T.create(cur.id, conv ? { keep: true } : null); if (conv) setSessionTheme(sid, c.id); renderThemePanel(); };
  $("th-grid").querySelector("[data-pal-new]").onclick = dup;
  const ed = $("th-edit");
  if (cur.preset) {
    ed.innerHTML = `<h3>${esc(cur.name)}</h3><div class="modal-sub" style="margin:0 0 10px">Palette intégrée. Duplique-la pour ajuster fond, texte et accent.</div><div class="th-btns"><button class="ghost-btn" id="th-dup" type="button">⎘ Dupliquer et personnaliser</button></div>`;
    $("th-dup").onclick = dup;
  } else {
    ed.innerHTML = `<h3>Personnaliser</h3>
      <div class="th-row"><span>Nom</span><input type="text" id="th-name" value="${esc(cur.name)}" maxlength="24" /></div>
      <div class="th-row"><span>Fond</span><code class="hexv">${cur.bg}</code><input type="color" data-k="bg" value="${cur.bg}" /></div>
      <div class="th-row"><span>Texte</span><code class="hexv">${cur.ink}</code><input type="color" data-k="ink" value="${cur.ink}" /></div>
      <div class="th-row"><span>Accent</span><code class="hexv">${cur.acc}</code><input type="color" data-k="acc" value="${cur.acc}" /></div>
      <div class="th-row"><span>Statuts monochromes <small style="color:var(--mut2)">(gris + accent, sans vert/jaune/cyan)</small></span><input type="checkbox" id="th-mono" ${cur.mono ? "checked" : ""} /></div>
      <div class="th-btns"><button class="ghost-btn" id="th-del" type="button" style="color:var(--del)">🗑 Supprimer</button></div>`;
    ed.querySelectorAll("input[type=color]").forEach((i) => {
      i.oninput = () => { T.update(cur.id, { [i.dataset.k]: i.value }); i.previousElementSibling.textContent = i.value; refreshThemeSwatch(cur.id); };
    });
    $("th-name").oninput = (e) => { T.update(cur.id, { name: e.target.value || "Perso" }); refreshThemeSwatch(cur.id, true); };
    $("th-mono").onchange = (e) => { T.update(cur.id, { mono: e.target.checked }); renderThemePanel(); };
    $("th-del").onclick = () => { T.remove(cur.id); renderThemePanel(); };
  }
  $("th-fs").querySelectorAll("button").forEach((b) => { b.classList.toggle("sel", b.dataset.fs === T.fontSize()); b.onclick = () => { T.setFont(b.dataset.fs); renderThemePanel(); }; });
}
// met à jour la pastille de la palette en cours d'édition sans reconstruire le panneau (garde le focus du color-picker)
function refreshThemeSwatch(id, nameOnly) {
  const T = window.FleetTheme, p = T.list().find((x) => x.id === id), card = $("th-grid").querySelector(`[data-pal="${id}"]`); if (!p || !card) return;
  const nm = card.querySelector(".th-nm"); if (nm) nm.innerHTML = `${esc(p.name)} <small>perso</small>`;
  if (nameOnly) return;
  const d = T.derive(p).vars, s = card.querySelectorAll(".th-sw i");
  [d["--bg"], d["--panel2"], d["--ink"], d["--acc"]].forEach((c, i) => { if (s[i]) s[i].style.background = c; });
}
$("open-theme").onclick = () => { thScope = "global"; openTheme(); };
window.addEventListener("fleet-theme", () => { if (termInstance) { try { termInstance.options.theme = FleetTheme.xterm(); } catch {} } });

// ---- barre mobile -------------------------------------------------------------
(function mobileBar() {
  const bar = $("mbar");
  bar.innerHTML = `<button id="mb-rail" title="sessions">☰</button><div class="mtitle" id="mb-title">Fleet Office<small>command center</small></div><button id="mb-palette" title="recherche">⌕</button><button id="mb-ctx" title="détails">ⓘ</button>`;
  $("mb-rail").onclick = () => { $("app").classList.toggle("rail-open"); $("app").classList.remove("ctx-open"); };
  $("mb-ctx").onclick = () => { if (detailId) { $("app").classList.toggle("ctx-open"); const a = agentById(detailId); if (a && $("app").classList.contains("ctx-open")) renderCtx(a); } $("app").classList.remove("rail-open"); };
  $("mb-palette").onclick = openPalette;
  document.addEventListener("click", (e) => { const app = $("app"); if (!app.classList.contains("rail-open") && !app.classList.contains("ctx-open")) return; if (e.target.closest(".rail") || e.target.closest(".ctx") || e.target.closest(".mbar") || e.target.closest(".sh-act")) return; app.classList.remove("rail-open", "ctx-open"); });
})();
function closeDrawers() { $("app").classList.remove("rail-open", "ctx-open"); }
function updateMobileTitle(a) { const t = $("mb-title"); if (t && a) t.innerHTML = esc(a.name) + "<small>" + esc(a.role || "") + (a.host ? " · " + esc(a.host) : "") + "</small>"; }

// ---- panneaux redimensionnables (rail) ----------------------------------------
function wireResize(handle, cssVar, opts) {
  if (!handle) return; try { const saved = parseInt(localStorage.getItem(opts.storeKey), 10); if (saved) document.documentElement.style.setProperty(cssVar, saved + "px"); } catch {}
  let startX = 0, startW = 0;
  const onMove = (e) => { const w = Math.max(opts.min, Math.min(opts.max, startW + (e.clientX - startX))); document.documentElement.style.setProperty(cssVar, w + "px"); };
  const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); document.body.classList.remove("resizing"); handle.classList.remove("dragging"); try { localStorage.setItem(opts.storeKey, parseInt(getComputedStyle(document.documentElement).getPropertyValue(cssVar), 10)); } catch {} };
  handle.addEventListener("mousedown", (e) => { e.preventDefault(); startX = e.clientX; startW = parseInt(getComputedStyle(document.documentElement).getPropertyValue(cssVar), 10) || opts.min; document.body.classList.add("resizing"); handle.classList.add("dragging"); document.addEventListener("mousemove", onMove); document.addEventListener("mouseup", onUp); });
}

// ---- câblage global -----------------------------------------------------------
$("new-task").onclick = openSpawn;
$("w-new").onclick = openSpawn;
$("w-fanout").onclick = () => { openSpawn(); setSpawnMode("fanout"); };
$("w-board").onclick = () => setView("board");
$("sp-go").onclick = doSpawn;
$("tm-go").onclick = doTeam;
$("sp-clip").onclick = () => $("sp-file").click();
$("sp-file").onchange = (e) => { addFiles(e.target.files, attS, $("sp-attach-list")); e.target.value = ""; };
$("tm-addrole").onclick = addRole;
$("tm-newrole").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); addRole(); } };
document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => closeModal(b.dataset.close)));
$("backdrop").onclick = () => { closeModal("spawn"); closeModal("team"); closeModal("fx"); closeModal("skillview"); };
$("sp-browse").onclick = () => openBrowser("sp-cwd", spawnHost);
$("tm-browse").onclick = () => openBrowser("tm-cwd", $("tm-host").value || "local");
wireBrowser();
// dans l'APK (iframe) : le ⚙ serveur vit ici, plus en bouton flottant qui masquait le haut à droite
if (window.parent !== window) {
  window.addEventListener("message", (e) => { if (e.data && e.data.fleet === "shell") $("open-srv").classList.remove("hidden"); });
  $("open-srv").onclick = () => window.parent.postMessage({ fleet: "settings" }, "*");
  try { window.parent.postMessage({ fleet: "hello" }, "*"); } catch {}
}
$("nav-search").onclick = () => openPalette();
loadAuto();
$("rail-filter-btn").onclick = () => { $("rail-fp").classList.toggle("hidden"); if (!$("rail-fp").classList.contains("hidden")) $("q").focus(); };
hydrateIcons();
$("q").oninput = (e) => { query = e.target.value.trim().toLowerCase(); renderSidebar(); if (view === "board" && !detailId) renderBoard(); };
wireComposer(); wireDrop($("sp-attach"), attS, $("sp-attach-list")); wireDrop($("composer"), attC, $("c-attach"));
wireResize($("rail-resize"), "--rail-w", { min: 240, max: 460, storeKey: "fleetoffice.railW" });

// ---- boot ---------------------------------------------------------------------
fillModels(); applyCenterVisibility(); connect();
pollRailHosts(); railHostsTimer = setInterval(pollRailHosts, 20000);
getJSON("/api/skills").then((j) => { _skillsData = j; if ($("nav-skills")) $("nav-skills").textContent = j.total || 0; }).catch(() => {});
getJSON("/api/audit?n=1").then((j) => { if ($("nav-audit")) $("nav-audit").textContent = j.total || 0; }).catch(() => {});
