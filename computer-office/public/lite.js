"use strict";
/* FLEET OFFICE — AI Agent Command Center (2D). Même orchestrateur que le 3D/APK :
   SSE /events + API /api/*. 3 volets : rail agents · conversation · contexte. Zéro WebGL. */

const getJSON = (p) => fetch(p, { cache: "no-store" }).then((r) => r.json());
const post = (p, b) => fetch(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e.message || e) }));
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const STATUS = {
  working: { c: "var(--work)", l: "au travail" }, coworking: { c: "var(--cowork)", l: "collabore" },
  done: { c: "var(--done)", l: "terminé" }, idle: { c: "var(--idle)", l: "au repos" },
  queued: { c: "var(--idle)", l: "en file" }, blocked: { c: "var(--blocked)", l: "en attente" },
  failed: { c: "var(--failed)", l: "erreur" },
};
const st = (a) => STATUS[a && a.status] || STATUS.idle;
// avatars graphite (homogènes) — distinction par nuance, pas par couleur
const AVPAL = ["#1e1e21", "#242427", "#2a2226", "#26262a", "#221e1e", "#2b2b2f", "#201f22", "#282024"];
const hashc = (s) => { let h = 0; for (let i = 0; i < (s || "").length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AVPAL[h % AVPAL.length]; };
const fmtCost = (n) => { n = n || 0; return n >= 1 ? "$" + n.toFixed(0) : "$" + n.toFixed(2); };
const fmtTok = (n) => { n = n || 0; return n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(0) + "k" : "" + n; };
const initial = (s) => (String(s || "?").trim()[0] || "?").toUpperCase();
// rendu markdown léger (échappé d'abord -> sûr ; liens http(s) uniquement)
function mdToHtml(src) {
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
const ago = (ms) => { if (!ms) return ""; const s = (Date.now() - ms) / 1000; if (s < 60) return "à l'instant"; if (s < 3600) return Math.floor(s / 60) + " min"; if (s < 86400) return Math.floor(s / 3600) + " h"; return Math.floor(s / 86400) + " j"; };

const MODELS = [{ v: "opus", l: "Opus 5" }, { v: "sonnet", l: "Sonnet 5" }, { v: "fable", l: "Fable 5" }, { v: "haiku", l: "Haiku 4.5" }];

let snap = { agents: [], teams: [], cto: {} };
let detailId = null, view = "agents", ctxTab = "ctx", query = "";
let feedTimer = null, hostTimer = null, machTimer = null, railHostsTimer = null;
let slashList = [];
// rail gauche : carte du sous-réseau tailnet (railView="nodes") ou arborescence d'UNE machine (railView="tree")
let railView = "nodes", railHost = null;
let railHostsCache = [{ id: "local", label: "local", ip: "127.0.0.1", online: true }];
let openLeafId = null, leafMode = null; // agent (feuille de l'arbre) dont le menu d'actions est ouvert, et son sous-mode ("rename"/"train")

// ---- SSE ----------------------------------------------------------------------
let es = null, reconnectT = null;
function connect() {
  if (es) try { es.close(); } catch {}
  setNet(false, "connexion…");
  try { es = new EventSource("/events"); } catch { return scheduleReconnect(); }
  es.addEventListener("snapshot", (e) => {
    setNet(true, "en direct");
    try { snap = JSON.parse(e.data); } catch { return; }
    onSnapshot();
  });
  es.onerror = () => { setNet(false, "hors-ligne"); scheduleReconnect(); };
}
function scheduleReconnect() { clearTimeout(reconnectT); reconnectT = setTimeout(connect, 2500); }
function setNet(live, label) { const n = $("net"); n.classList.toggle("live", live); $("net-label").textContent = label; }

function onSnapshot() {
  $("nav-agents").textContent = (snap.agents || []).length;
  $("nav-machines").textContent = new Set((snap.agents || []).map((a) => a.host).filter(Boolean)).size + 1;
  // NB : on ne re-render PAS le rail (ni la vue Skills) tant qu'une saisie est en cours dans le
  // panneau d'action d'une feuille (renommer/entraîner) — sinon la frappe serait effacée à
  // chaque tick SSE (~1,5 s), même bug que l'assistant skills.
  if (leafMode !== "rename" && leafMode !== "train") renderRail();
  if (view === "machines") renderMachines();
  // idem pour la vue Skills : refresh seulement à l'ouverture et après ajout/suppression/actualisation.
  if (detailId) {
    const a = agentById(detailId);
    // le centre (en-tête/composer) ne se rafraîchit QUE si on regarde la vue Agents — sinon ça
    // écraserait à chaque tick SSE (~1,5 s) l'écran Machines/Skills qu'on est en train de consulter.
    // Le panneau contexte (droite), lui, continue de suivre l'agent sélectionné en permanence.
    if (a) { if (view === "agents") { updateHead(a); updateComposer(a); } if (ctxTab === "ctx") renderCtx(a); }
  } else if (view === "agents") { renderFleetCtx(); }
}
const agentById = (id) => (snap.agents || []).find((x) => x.id === id) ||
  (snap.agents || []).flatMap((a) => a.subAgents || []).find((x) => x.id === id) || null;

// ---- RAIL gauche --------------------------------------------------------------
// ============================================================================
// RAIL GAUCHE — carte du sous-réseau tailnet (§nodes) -> clic = arborescence
// agentique de la machine (§tree), où chaque agent est une feuille avec un
// menu d'actions (chat / renommer / entraîner / supprimer).
// ============================================================================
async function pollRailHosts() {
  try { const j = await getJSON("/api/hosts"); if (j.hosts && j.hosts.length) railHostsCache = j.hosts; } catch { /* garde le cache précédent */ }
  if (leafMode !== "rename" && leafMode !== "train") renderRail();
}
function renderRail() {
  if (railView === "tree" && railHost) renderRailTree(); else renderRailNodes();
}
// §nodes — mini carte réseau : tronc vertical + une branche par machine tailnet
function renderRailNodes() {
  const q = query;
  const hosts = railHostsCache.filter((h) => !q || [h.label, h.id, h.ip].filter(Boolean).join(" ").toLowerCase().includes(q));
  const agents = snap.agents || [];
  const countFor = (id) => agents.filter((a) => (a.host || "local") === id).length;
  const rows = hosts.map((h) => {
    const n = countFor(h.id), off = h.online === false;
    return `<div class="net-node ${off ? "offline" : ""}" data-host="${esc(h.id)}">
      <span class="ndot ${off ? "offline" : "online"}"></span>
      <div class="net-info"><div class="net-name">${esc(h.label || h.id)}</div><div class="net-ip">${esc(h.ip || "")}${off ? " · hors-ligne" : ""}</div></div>
      ${n ? `<span class="net-badge">${n}</span>` : ""}
      <span class="net-arrow">›</span>
    </div>`;
  }).join("");
  const el = $("rail-groups");
  el.innerHTML = `<div class="net-root">◉ <b>Tailnet</b><span class="net-count">${hosts.length} machine${hosts.length > 1 ? "s" : ""}</span></div>
    <div class="net-trunk">${rows || `<div class="empty" style="padding:20px 8px">Aucune machine${q ? " pour « " + esc(q) + " »" : ""}.</div>`}</div>`;
  el.querySelectorAll("[data-host]").forEach((r) => (r.onclick = () => { railHost = r.dataset.host; railView = "tree"; openLeafId = null; leafMode = null; renderRail(); }));
  const s = $("q"); if (s && document.activeElement !== s) s.placeholder = "rechercher une machine…";
}
// §tree — arborescence agentique de LA machine sélectionnée (imite un file-tree ; feuille = agent)
function renderRailTree() {
  const host = railHostsCache.find((h) => h.id === railHost) || { id: railHost, label: railHost };
  const agentsHere = (snap.agents || []).filter((a) => (a.host || "local") === railHost);
  const q = query;
  const filtered = q ? agentsHere.filter((a) => [a.name, a.role, a.cwd].filter(Boolean).join(" ").toLowerCase().includes(q)) : agentsHere;
  const t = buildHostTree(filtered);
  const treeHtml = t ? ftreeFull(t, railLeaf, railHost)
    : `<div class="empty" style="padding:16px 8px">${agentsHere.length ? "Aucun résultat pour « " + esc(q) + " »." : "Aucun agent sur cette machine.<br>Clique sur ＋ pour en déployer un ici."}</div>`;
  const rootLine = t ? `<div class="ftree-root" style="margin:0 0 6px">📂 <span class="froot-path">${esc(t.commonPrefix || "/")}/</span></div>` : "";
  const el = $("rail-groups");
  el.innerHTML = `<div class="rail-back" id="rail-back-wrap"><button class="back-btn" id="rail-back-btn" title="retour aux machines">←</button>
      <div class="rb-info"><div class="rb-name">${esc(host.label || host.id)}</div><div class="rb-ip">${esc(host.ip || "")}${host.online === false ? " · hors-ligne" : " · en ligne"} · ${agentsHere.length} agent${agentsHere.length > 1 ? "s" : ""}</div></div></div>
    <div class="ftree" style="padding:0 4px">${rootLine}${treeHtml}</div>`;
  $("rail-back-btn").onclick = () => { railView = "nodes"; railHost = null; renderRail(); };
  wireRailTree(el);
  const s = $("q"); if (s && document.activeElement !== s) s.placeholder = "rechercher un agent sur " + (host.label || host.id) + "…";
}
// feuille interactive de l'arbre (rail) : clic = ouvre un panneau d'actions sous la ligne
function railLeaf(a) {
  const open = openLeafId === a.id, viewing = detailId === a.id;
  const team = a.teamName ? `<span class="fteam" title="${esc(a.teamName)}">${a.chief ? "👑" : "👥"}</span>` : "";
  const row = `<div class="ftree-leaf rail-leaf ${open ? "open" : ""} ${viewing ? "viewing" : ""}" data-leaf="${esc(a.id)}">
      <span class="fdot" style="background:${st(a).c}"></span><span class="fnm">${esc(a.name)}</span>${team}
      <span class="frole">${esc(a.role || "")}</span></div>`;
  return row + (open ? railLeafPanel(a) : "");
}
function railLeafPanel(a) {
  if (leafMode === "rename") {
    return `<div class="leaf-panel">
      <input class="leaf-input" id="lp-rename-input" value="${esc(a.name)}" maxlength="60" />
      <div class="leaf-actions"><button class="lp-btn ok" data-lpsave="${esc(a.id)}">✓ enregistrer</button><button class="lp-btn" data-lpcancel="1">✕ annuler</button></div>
    </div>`;
  }
  if (leafMode === "train") {
    return `<div class="leaf-panel">
      <div class="leaf-hint">Métier à entraîner — les skills sont téléchargées en ligne (repos réputés) et installées sur <b>${esc(a.host || "local")}</b> :</div>
      <input class="leaf-input" id="lp-train-input" value="${esc(a.role || "")}" maxlength="40" placeholder="ex. Backend Senior" />
      <div class="leaf-actions"><button class="lp-btn ok" data-lptrain="${esc(a.id)}">🏋️ lancer</button><button class="lp-btn" data-lpcancel="1">✕ annuler</button></div>
    </div>`;
  }
  const subs = (a.subAgents || []).length
    ? `<div class="subwrap" style="margin:8px 0 0;border-left:1px dashed var(--line2);padding-left:10px">` + a.subAgents.map((s) => `<div class="subrow" data-id="${esc(s.id)}"><span class="sd" style="background:${(STATUS[s.status] || STATUS.idle).c}"></span>${esc(s.name || s.role || "sous-agent")}<span style="color:var(--mut2);margin-left:auto">${esc(s.role || "")}</span></div>`).join("") + `</div>`
    : "";
  return `<div class="leaf-panel">
    <div class="leaf-menu">
      <button class="lp-btn" data-lpchat="${esc(a.id)}">💬 Chat</button>
      <button class="lp-btn" data-lprenamestart="${esc(a.id)}">✎ Renommer</button>
      <button class="lp-btn" data-lptrainstart="${esc(a.id)}">🏋️ Entraîner</button>
      <button class="lp-btn danger" data-lpdel="${esc(a.id)}">🗑 Supprimer</button>
    </div>${subs}</div>`;
}
function wireRailTree(el) {
  el.querySelectorAll("[data-fold]").forEach((f) => (f.onclick = (e) => { e.stopPropagation(); const k = f.dataset.fold; collapsedFolders.has(k) ? collapsedFolders.delete(k) : collapsedFolders.add(k); renderRail(); }));
  el.querySelectorAll("[data-leaf]").forEach((r) => (r.onclick = (e) => { e.stopPropagation(); const id = r.dataset.leaf; if (openLeafId === id) { openLeafId = null; leafMode = null; } else { openLeafId = id; leafMode = null; } renderRail(); }));
  el.querySelectorAll("[data-id]").forEach((r) => (r.onclick = (e) => { e.stopPropagation(); select(r.dataset.id); })); // sous-agents
  el.querySelectorAll("[data-lpchat]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); openLeafId = null; leafMode = null; select(b.dataset.lpchat); }));
  el.querySelectorAll("[data-lprenamestart]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); leafMode = "rename"; renderRail(); setTimeout(() => { const i = $("lp-rename-input"); if (i) { i.focus(); i.select(); } }, 0); }));
  el.querySelectorAll("[data-lptrainstart]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); leafMode = "train"; renderRail(); setTimeout(() => { const i = $("lp-train-input"); if (i) { i.focus(); i.select(); } }, 0); }));
  el.querySelectorAll("[data-lpcancel]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); leafMode = null; renderRail(); }));
  el.querySelectorAll("[data-lpdel]").forEach((b) => (b.onclick = async (e) => {
    e.stopPropagation();
    const id = b.dataset.lpdel, a = agentById(id);
    if (!confirm("Supprimer/fermer définitivement « " + ((a && a.name) || id) + " » ?")) return;
    await post("/api/kill", { id });
    openLeafId = null; leafMode = null; toast("🗑 agent supprimé"); if (detailId === id) clearDetail();
  }));
  el.querySelectorAll("[data-lpsave]").forEach((b) => (b.onclick = async (e) => {
    e.stopPropagation();
    const id = b.dataset.lpsave, i = $("lp-rename-input"), v = i ? i.value.trim() : "";
    if (!v) return toast("nom vide");
    const j = await post("/api/rename", { id, name: v });
    if (!j.ok) return toast("Erreur : " + (j.error || ""));
    toast("✎ renommé : " + v); openLeafId = null; leafMode = null; renderRail();
  }));
  el.querySelectorAll("[data-lptrain]").forEach((b) => (b.onclick = async (e) => {
    e.stopPropagation();
    const id = b.dataset.lptrain, i = $("lp-train-input"), role = i ? i.value.trim() : "";
    if (!role) return toast("indique un métier");
    const j = await post("/api/train", { id, role });
    if (!j.ok) return toast("Erreur : " + (j.error || ""));
    toast("🏋️ entraînement lancé — " + role); openLeafId = null; leafMode = null; renderRail();
  }));
}

// ---- sélection + centre -------------------------------------------------------
function select(id) {
  const a = agentById(id); if (!a) return;
  detailId = id;
  setView("agents");
  slashList = a.slashCommands || [];
  $("conv").classList.remove("hidden"); $("composer").classList.remove("hidden");
  renderConv._html = null; updateQuickReplies._sig = null; $("c-quickreply").classList.add("hidden");
  resetHistoryState(); // fenêtre d'historique propre à chaque agent
  updateHead(a); updateComposer(a); renderCtx(a);
  $("conv").innerHTML = `<div class="empty">chargement du flux…</div>`;
  clearInterval(feedTimer); pollFeed(); feedTimer = setInterval(pollFeed, 1500);
  clearInterval(hostTimer); pollHost(a); hostTimer = setInterval(() => pollHost(agentById(detailId)), 15000);
  renderRail();
}
function updateHead(a) {
  const col = hashc((a.role || "") + (a.name || ""));
  const prov = a.provider === "bedrock" ? `<span class="prov bedrock" style="margin-left:2px">Bedrock</span>` : "";
  $("center-head").innerHTML = `
    <div class="hav" style="background:${col}">${esc(initial(a.name))}</div>
    <div class="hid"><div class="hn"><span id="h-name-txt">${esc(a.name || "—")}</span><button class="rename-btn" id="h-rename" title="renommer l'agent">✎</button> ${prov}</div>
      <div class="status"><span class="d" style="background:${st(a).c};box-shadow:0 0 7px ${st(a).c}"></span>${esc(st(a).l)}${a.busy ? " · réfléchit" : ""}</div></div>
    <div class="facts">
      <div class="fact"><span class="ic">🖥️</span><div><div class="k">Machine</div><div class="v">${esc(a.host || "local")}</div></div></div>
      <div class="fact"><span class="ic">◇</span><div><div class="k">Modèle</div><div class="v">${esc(a.model || "—")}${a.effort ? " · " + esc(a.effort) : ""}</div></div></div>
      <div class="fact"><span class="ic">◎</span><div><div class="k">Tâche</div><div class="v" title="${esc(a.intent || a.lastPrompt || "")}">${esc(a.intent || a.detail || a.lastPrompt || "—")}</div></div></div>
    </div>
    <div class="hact">
      <button class="icon-btn" id="h-refresh" title="rafraîchir">⟳</button>
      <button class="icon-btn" id="h-team" title="équipe">👥</button>
      <a class="icon-btn" href="/3d" title="3D">🏢</a>
    </div>`;
  $("h-refresh").onclick = () => { pollFeed(); pollHost(a); };
  $("h-team").onclick = openTeam;
  $("h-rename").onclick = () => startRename(a);
}
// édition inline du nom (remplace le texte par un <input>, Enter/blur = enregistre, Échap = annule)
function startRename(a) {
  const hn = $("h-rename").closest(".hn"); if (!hn || hn.querySelector(".hn-input")) return;
  const txt = $("h-name-txt");
  const input = document.createElement("input");
  input.className = "hn-input"; input.value = a.name || ""; input.maxLength = 60;
  txt.replaceWith(input); $("h-rename").classList.add("hidden");
  input.focus(); input.select();
  let done = false;
  const commit = async () => {
    if (done) return; done = true;
    const v = input.value.trim();
    if (!v || v === a.name) return renderCtxOnlyRestore();
    const j = await post("/api/rename", { id: a.id, name: v });
    if (!j.ok) { toast("Erreur : " + (j.error || "renommage impossible")); return renderCtxOnlyRestore(); }
    toast("✎ renommé : " + v);
  };
  const renderCtxOnlyRestore = () => { const t = document.createElement("span"); t.id = "h-name-txt"; t.textContent = a.name || "—"; input.replaceWith(t); $("h-rename").classList.remove("hidden"); };
  input.onblur = commit;
  input.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); input.blur(); } else if (e.key === "Escape") { e.preventDefault(); done = true; renderCtxOnlyRestore(); } };
}
function updateComposer(a) {
  $("c-busy").classList.toggle("hidden", !a.busy);
  const termBtn = $("c-term"); if (termBtn) { termBtn.disabled = snap.terminal === false; termBtn.title = snap.terminal === false ? "terminal indisponible sur ce nœud (node-pty non installé)" : "terminal — shell direct sur la machine de l'agent"; }
  if (a.slashCommands) slashList = a.slashCommands;
  const sg = $("c-suggest"), ssig = a.suggestion && !a.busy ? a.suggestion : "";
  if (updateComposer._ssig !== ssig) {
    updateComposer._ssig = ssig;
    if (ssig) { sg.classList.remove("hidden"); sg.innerHTML = `<span class="sg-l">💡 suite</span><button class="sg-chip" type="button">${esc(ssig)}</button>`; sg.querySelector(".sg-chip").onclick = () => { const i = $("c-input"); i.value = ssig; i.focus(); i.dispatchEvent(new Event("input")); }; }
    else { sg.classList.add("hidden"); sg.innerHTML = ""; }
  }
}
// ---- historique de conversation (l'API ne tenait qu'une fenêtre récente -> "trou" en haut) ----
// olderFeed = messages chargés explicitement via "charger l'historique" (jamais touchés par le
// poll). lastLiveFeed = fenêtre récente du poll normal (~1,5 s). Affiché = olderFeed + lastLiveFeed.
// historyFrontier = curseur (offset octet) d'où repartir pour charger ENCORE plus ancien ;
// tant qu'aucun historique n'a été chargé manuellement, il suit la fenêtre live (comportement
// naturel : "il y a plus avant ce qui est affiché").
let olderFeed = [], lastLiveFeed = [], historyFrontier = null, historyAtStart = true, historyLoading = false;
function resetHistoryState() { olderFeed = []; lastLiveFeed = []; historyFrontier = null; historyAtStart = true; historyLoading = false; }
async function pollFeed() {
  if (!detailId) return;
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
  historyLoading = true;
  const btn = $("conv-loadmore"); if (btn) { btn.disabled = true; btn.textContent = "Chargement…"; }
  try {
    const j = await getJSON("/api/transcript?id=" + encodeURIComponent(detailId) + "&before=" + historyFrontier);
    olderFeed = (j.feed || []).concat(olderFeed);
    historyFrontier = j.nextBefore; historyAtStart = !!j.atStart;
    const el = $("conv"), oldH = el.scrollHeight, oldTop = el.scrollTop;
    renderConv._html = null;
    renderConv(olderFeed.concat(lastLiveFeed), { preserveScroll: true });
    el.scrollTop = oldTop + (el.scrollHeight - oldH); // garde le regard sur le même message qu'avant le chargement
  } catch { toast("Erreur de chargement de l'historique"); }
  historyLoading = false;
}
// Le mode headless de Claude Code n'expose PAS l'outil de question interactive (à choix cliquables) —
// un agent qui pose un QCM le fait donc en texte simple ("A. …", "**B.** …"). On le détecte dans le
// DERNIER message de l'agent (feed non vide, agent au repos = vraiment en attente d'une réponse) et
// on propose des puces cliquables qui renvoient le choix comme un message normal (aucun changement
// backend requis). Repli propre : rien n'est détecté -> pas de puces, on tape la réponse comme avant.
function detectQuickReplies(feed) {
  const last = feed[feed.length - 1];
  if (!last || (last.kind !== "say" && last.kind !== "result")) return null;
  const lines = String(last.text || "").split("\n");
  const re = /^\s*(?:[-*]\s*)?\*{0,2}([A-Za-z]|\d{1,2})[.)]\*{0,2}\s+(.+?)\s*$/;
  // ne retient QUE le bloc d'options FINAL et CONTIGU (en partant de la fin du message, lignes
  // vides finales ignorées) — un plan/une liste d'étapes numérotée au milieu d'un message ne doit
  // PAS déclencher de puces (ce n'est pas une question qui attend un choix).
  const opts = [];
  let i = lines.length - 1;
  while (i >= 0 && !lines[i].trim()) i--;
  while (i >= 0) { const m = lines[i].match(re); if (!m) break; opts.unshift({ key: m[1].toUpperCase(), label: m[2].replace(/\*\*/g, "").trim() }); i--; }
  if (opts.length < 2 || opts.length > 8) return null;
  // les clés doivent être cohérentes (toutes lettres, ou toutes numériques) pour éviter les faux positifs
  const allLetters = opts.every((o) => /^[A-Z]$/.test(o.key)), allDigits = opts.every((o) => /^\d+$/.test(o.key));
  if (!allLetters && !allDigits) return null;
  // et il doit vraiment y avoir une QUESTION avant ce bloc (signal "?") — sinon ce sont juste des
  // puces/étapes explicatives, pas une question qui attend une réponse.
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
// blocs "Outil exécuté" repliables : repliés par défaut (résumé 1 ligne), l'état déplié est
// mémorisé par clé de contenu (stable même quand la fenêtre glissante /api/transcript décale
// les index) pour survivre aux re-render toutes les 1,5 s.
const expandedTools = new Set();
function toolKey(s) { s = String(s || ""); let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h.toString(36); }
let lastConvFeed = [];
function renderConv(feed, opts) {
  opts = opts || {};
  const el = $("conv"); if (!el) return;
  lastConvFeed = feed;
  let html = "", i = 0;
  const AV = { say: "🤖", think: "💭", prompt: "🧑" };
  while (i < feed.length) {
    const e = feed[i];
    if (e.kind === "tool") {
      const key = toolKey(e.text), open = expandedTools.has(key);
      const firstLine = String(e.text || "").split("\n")[0];
      let box = `<div class="tool ${open ? "open" : ""}"><div class="th" data-tool="${key}"><span class="chev">${open ? "▾" : "▸"}</span><span class="ok">✓</span> Outil exécuté<span class="tool-sum">${esc(firstLine)}</span></div>`;
      if (open) box += `<pre>${esc(e.text)}</pre>`;
      const hasResult = feed[i + 1] && feed[i + 1].kind === "result";
      if (open && hasResult) box += `<div class="res"><pre>${esc(feed[i + 1].text)}</pre></div>`;
      if (hasResult) i++;
      box += `</div>`; html += box; i++;
    } else if (e.kind === "result") {
      html += `<div class="msg result"><div class="mh"><span class="mav">↳</span><span class="mwho">Résultat</span></div><div class="mbody md">${mdToHtml(e.text)}</div></div>`; i++;
    } else {
      const who = e.kind === "prompt" ? "Vous" : (e.kind === "think" ? "Réflexion" : "Agent");
      const cls = e.kind === "prompt" ? "you" : "agent";
      const bodyHtml = e.kind === "say" ? `<div class="mbody md">${mdToHtml(e.text)}</div>` : `<div class="mbody"${e.kind === "think" ? ' style="color:var(--mut)"' : ""}>${esc(e.text)}</div>`;
      html += `<div class="msg ${cls}"><div class="mh"><span class="mav">${AV[e.kind] || "🤖"}</span><span class="mwho">${who}</span></div>${bodyHtml}</div>`; i++;
    }
  }
  if (!html) html = `<div class="empty">en attente d'activité…</div>`;
  // bannière d'historique en tête — tant qu'on n'a pas atteint le tout début de la session, il y a
  // des messages plus anciens que ceux chargés (la conversation n'est pas "non persistée", elle
  // était juste coupée à une fenêtre récente ; ce bouton va chercher la suite en amont).
  const loadMoreHtml = !historyAtStart
    ? `<div class="conv-loadmore-wrap"><button id="conv-loadmore" class="loadmore-btn">📜 Charger les messages précédents</button></div>`
    : (olderFeed.length || lastLiveFeed.length ? `<div class="conv-loadmore-wrap done">— début de la conversation —</div>` : "");
  const fullHtml = loadMoreHtml + html;
  if (renderConv._html === fullHtml) return;
  const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  renderConv._html = fullHtml; el.innerHTML = fullHtml;
  const lm = $("conv-loadmore"); if (lm) lm.onclick = loadOlderHistory;
  el.querySelectorAll("[data-tool]").forEach((h) => (h.onclick = () => {
    const k = h.dataset.tool;
    expandedTools.has(k) ? expandedTools.delete(k) : expandedTools.add(k);
    renderConv._html = null; renderConv(lastConvFeed); // re-render immédiat (pas d'attente du prochain poll)
  }));
  if (!opts.preserveScroll && near) el.scrollTop = el.scrollHeight;
}

// ---- composer / pilotage ------------------------------------------------------
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
  $("c-term").onclick = () => openTerminal(agentById(detailId));
}
// ---- terminal PTY (▹_) : vrai shell direct sur la machine/dossier de l'agent, via WebSocket ----
// Chaque ouverture crée une instance xterm.js + une connexion WS dédiée (le serveur spawn un vrai
// pty par connexion — voir server.js). Protocole JSON : {type:"input"|"resize"} envoyé,
// {type:"data"|"exit"} reçu. Zéro état partagé entre 2 ouvertures : fermer nettoie tout.
let termWs = null, termInstance = null, termFit = null, termResizeHandler = null;
function teardownTerminal() {
  if (termResizeHandler) { window.removeEventListener("resize", termResizeHandler); termResizeHandler = null; }
  if (termWs) { try { termWs.close(); } catch { /* */ } termWs = null; }
  if (termInstance) { try { termInstance.dispose(); } catch { /* */ } termInstance = null; }
  termFit = null;
}
function closeTerminal() { teardownTerminal(); closeModal("term"); }
function openTerminal(agent) {
  if (!agent) return;
  if (snap.terminal === false) return toast("Terminal indisponible sur ce nœud (node-pty non installé).");
  if (typeof Terminal === "undefined" || typeof FitAddon === "undefined") return toast("Bibliothèque terminal non chargée (xterm.js).");
  teardownTerminal(); // au cas où une session précédente traînerait encore
  openModal("term");
  $("term-sub").textContent = (agent.name || "agent") + " · " + (agent.host || "local") + " · " + (agent.cwd || "~");
  const statusEl = $("term-status"); statusEl.textContent = "connexion…"; statusEl.className = "term-status";
  const body = $("term-body"); body.innerHTML = "";
  const term = new Terminal({
    fontFamily: "JetBrains Mono, ui-monospace, monospace", fontSize: 13, cursorBlink: true,
    theme: { background: "#08080a", foreground: "#ececed", cursor: "#c62f36", selectionBackground: "#2b2b2f" },
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(body);
  fit.fit();
  termInstance = term; termFit = fit;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(proto + "//" + location.host + "/api/term?id=" + encodeURIComponent(agent.id));
  termWs = ws;
  ws.onopen = () => { statusEl.textContent = "en direct"; statusEl.className = "term-status live"; ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows })); term.focus(); };
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type === "data") term.write(m.data);
    else if (m.type === "exit") { statusEl.textContent = m.reason ? ("erreur : " + m.reason) : ("session terminée" + (m.code ? " (code " + m.code + ")" : "")); statusEl.className = "term-status err"; }
  };
  ws.onerror = () => { statusEl.textContent = "erreur de connexion"; statusEl.className = "term-status err"; };
  ws.onclose = () => { if (statusEl.classList.contains("live")) { statusEl.textContent = "déconnecté"; statusEl.className = "term-status"; } };
  term.onData((data) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input", data })); });
  termResizeHandler = () => { try { fit.fit(); if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows })); } catch { /* */ } };
  window.addEventListener("resize", termResizeHandler);
}
function renderSlash(input, dd) {
  const m = input.value.match(/^\/(\S*)$/); if (!m) return dd.classList.add("hidden");
  const q = m[1].toLowerCase(), matches = (slashList || []).filter((c) => c.toLowerCase().includes(q)).slice(0, 12);
  if (!matches.length) return dd.classList.add("hidden");
  dd.innerHTML = matches.map((c) => `<div class="slash-item">/${esc(c)}</div>`).join(""); dd.classList.remove("hidden");
  [...dd.children].forEach((el, i) => (el.onmousedown = (e) => { e.preventDefault(); input.value = "/" + matches[i] + " "; dd.classList.add("hidden"); input.focus(); }));
}

// ---- volet CONTEXTE -----------------------------------------------------------
const _host = new Map(); // agentId -> métriques machine
async function pollHost(a) {
  if (!a) return;
  try { const m = await getJSON("/api/host?name=" + encodeURIComponent(a.host || "local")); _host.set(a.id, m); if (detailId === a.id && (ctxTab === "ctx" || ctxTab === "machine")) renderCtx(a); } catch {}
}
function permInfo(a) {
  const danger = ["bypassPermissions", "dontAsk", "auto"].includes(a.perm);
  return { level: danger ? "Élevé" : "Restreint", cls: danger ? "red" : "grn", note: danger ? "push/merge/deploy sans validation" : "pas de push/merge/deploy" };
}
function ring(pct) { const p = Math.max(0, Math.min(100, pct || 0)); const cls = p >= 85 ? "crit" : p >= 65 ? "hot" : ""; return `<div class="ring ${cls}" style="--p:${p}"><i></i></div>`; }
function renderCtx(a) {
  $("ctx-title").textContent = a.name || "Agent";
  const body = $("ctx-body");
  if (ctxTab === "logs") { renderLogsTab(a); return; }
  if (ctxTab === "machine") {
    body.innerHTML = machineCard(a, true) + `<div class="card2"><h3>Agents sur cette machine</h3>${hostTreeHtml(a.host || "local", snap.agents || [])}</div>`;
    wireFtree(body, () => renderCtx(a));
    return;
  }
  const pi = permInfo(a), h = _host.get(a.id) || {};
  const prov = a.provider === "bedrock" ? "AWS Bedrock (Askeal)" : "Anthropic (abonnement)";
  body.innerHTML = `
    <div class="card2"><h3>Profil agent</h3>
      <div class="kv"><span class="k">Nom</span><span class="v">${esc(a.name || "—")}</span></div>
      <div class="kv"><span class="k">Rôle</span><span class="v">${esc(a.role || "—")}</span></div>
      <div class="kv"><span class="k">ID</span><span class="v">${esc(String(a.id).slice(0, 12))}</span></div>
      <div class="kv"><span class="k">Provider</span><span class="v ${a.provider === "bedrock" ? "amber" : ""}">${esc(prov)}</span></div>
      <div class="kv"><span class="k">Statut</span><span class="v" style="color:${st(a).c}">${esc(st(a).l)}</span></div>
      <div class="kv"><span class="k">Dernière activité</span><span class="v">${esc(ago(a.updatedAt) || "—")}</span></div>
    </div>
    <div class="card2"><h3>Politiques & Permissions</h3>
      <div class="kv"><span class="k">Mode</span><span class="v">${esc(a.perm || "acceptEdits")}</span></div>
      <div class="kv"><span class="k">Niveau d'accès</span><span class="v ${pi.cls}">${pi.level}</span></div>
      <div class="kv"><span class="k">Réseau</span><span class="v">Tailscale</span></div>
      <div class="kv"><span class="k">Effet</span><span class="v" style="max-width:170px;white-space:normal;text-align:right">${esc(pi.note)}</span></div>
    </div>
    <div class="card2"><h3>Workspace</h3>
      <div class="kv"><span class="k">Chemin</span><span class="v" title="${esc(a.cwd || "")}">${esc(a.cwd || "—")}</span></div>
      <div class="kv"><span class="k">Projet</span><span class="v">${esc(a.project || "—")}</span></div>
      ${a.gitBranch ? `<div class="kv"><span class="k">Branche</span><span class="v">${esc(a.gitBranch)}</span></div>` : ""}
    </div>
    ${(a.intent || a.busy) ? `<div class="card2"><h3>Tâche actuelle</h3>
      <div style="font-size:12.5px;color:var(--ink);margin-bottom:6px">${esc(a.intent || a.lastPrompt || "—")}</div>
      ${a.busy ? `<div class="prog"><i style="width:60%"></i></div><div style="font-size:11px;color:var(--mut2)">en cours…</div>` : `<div style="font-size:11px;color:var(--mut2)">${esc(a.detail || "en attente")}</div>`}
    </div>` : ""}
    <div class="card2"><h3>Actions rapides</h3>
      <div class="qa"><button class="warn" id="qa-stop">⏸ Stop</button><button id="qa-gym">🏋️ Gym</button><button class="danger" id="qa-kill">✖ Fermer</button></div>
    </div>
    <div class="card2"><h3>Ressources — ${esc(a.host || "local")}</h3>
      <div class="meters">
        <div class="meter"><div class="ml">CPU</div><div class="mv">${h.cpuPct != null ? h.cpuPct + "%" : "—"}</div>${ring(h.cpuPct)}</div>
        <div class="meter"><div class="ml">RAM</div><div class="mv">${h.memPct != null ? h.memPct + "%" : "—"}</div>${ring(h.memPct)}</div>
        <div class="meter"><div class="ml">Disque</div><div class="mv">${h.diskPct != null ? h.diskPct + "%" : "—"}</div>${ring(h.diskPct)}</div>
        <div class="meter"><div class="ml">Coût session</div><div class="mv" style="font-size:16px">${fmtCost(a.costUsd)}</div><div style="font-size:10px;color:var(--mut2)">${fmtTok(a.tokens)} tok</div></div>
      </div>
    </div>
    <div class="card2"><h3>Réseau</h3>
      <div class="kv"><span class="k">Tailscale</span><span class="v grn">${h.online ? "connecté" : "—"}</span></div>
      <div class="kv"><span class="k">IP</span><span class="v">${esc(h.tsip || "—")}</span></div>
    </div>`;
  const stop = $("qa-stop"), gym = $("qa-gym"), kill = $("qa-kill");
  if (stop) stop.onclick = () => post("/api/stop", { id: a.id }).then(() => toast("⏸ stop demandé"));
  if (gym) gym.onclick = () => post("/api/train", { id: a.id }).then((j) => toast(j.ok ? "🏋️ direction le gym" : "Erreur"));
  if (kill) kill.onclick = () => { if (confirm("Fermer la session de « " + a.name + " » ?")) post("/api/kill", { id: a.id }).then(() => { if (detailId === a.id) clearDetail(); }); };
}
function machineCard(a, full) {
  const h = _host.get(a.id) || {};
  return `<div class="card2"><h3>${esc(a.host || "local")}</h3>
    <div class="meters" style="margin-bottom:10px">
      <div class="meter"><div class="ml">CPU (${h.ncpu || "?"} c)</div><div class="mv">${h.cpuPct != null ? h.cpuPct + "%" : "—"}</div>${ring(h.cpuPct)}</div>
      <div class="meter"><div class="ml">RAM</div><div class="mv">${h.memPct != null ? h.memPct + "%" : "—"}</div>${ring(h.memPct)}</div>
    </div>
    <div class="kv"><span class="k">RAM</span><span class="v">${h.memUsedMb || "?"} / ${h.memTotalMb || "?"} Mo</span></div>
    <div class="kv"><span class="k">Disque /</span><span class="v">${h.diskPct != null ? h.diskPct + "%" : "—"}</span></div>
    <div class="kv"><span class="k">Charge</span><span class="v">${h.load != null ? h.load : "—"}</span></div>
    <div class="kv"><span class="k">IP Tailscale</span><span class="v">${esc(h.tsip || "—")}</span></div>
    <div class="kv"><span class="k">Uptime</span><span class="v">${h.uptimeS ? Math.floor(h.uptimeS / 86400) + " j" : "—"}</span></div>
  </div>`;
}

// ---- arborescence : où sont les agents sur une machine (imite un file-tree) ---
// Construit un arbre à partir des cwd de tous les agents d'un hôte : préfixe commun replié en
// racine, puis dossiers imbriqués, avec le(s) agent(s) accroché(s) au dossier exact de son cwd.
function buildHostTree(agents) {
  const withCwd = agents.filter((a) => a.cwd && a.cwd !== "~" && a.cwd !== "-");
  if (!withCwd.length) return null;
  let common = withCwd[0].cwd.split("/").filter(Boolean);
  for (const a of withCwd.slice(1)) {
    const parts = a.cwd.split("/").filter(Boolean);
    let i = 0; while (i < common.length && i < parts.length && common[i] === parts[i]) i++;
    common = common.slice(0, i);
  }
  const root = { seg: "", path: "", children: [], agents: [] };
  const findOrCreate = (parent, seg) => { let c = parent.children.find((x) => x.seg === seg); if (!c) { c = { seg, path: (parent.path ? parent.path + "/" : "") + seg, children: [], agents: [] }; parent.children.push(c); } return c; };
  for (const a of withCwd) {
    const parts = a.cwd.split("/").filter(Boolean).slice(common.length);
    let node = root;
    for (const seg of parts) node = findOrCreate(node, seg);
    node.agents.push(a);
  }
  return { commonPrefix: "/" + common.join("/"), root };
}
function ftreeLeaf(a) {
  return `<div class="ftree-leaf" data-id="${esc(a.id)}"><span class="fdot" style="background:${st(a).c}"></span><span class="fnm">${esc(a.name)}</span><span class="frole">${esc(a.role || "")}</span></div>`;
}
function countTreeAgents(node) { let n = node.agents.length; for (const c of node.children) n += countTreeAgents(c); return n; }
// clés (hostKey::chemin) des dossiers actuellement repliés — partagées entre les 3 usages de l'arbre
const collapsedFolders = new Set();
// leafFn optionnel : permet de réutiliser le même bâtisseur d'arbre avec une feuille différente
// (ex. railLeaf, avec menu d'actions) sans dupliquer la logique de nesting. hostKey identifie
// l'arbre (typiquement l'id de la machine) pour que l'état replié/déplié soit propre à CE contexte.
function ftreeChildren(node, leafFn, hostKey) {
  leafFn = leafFn || ftreeLeaf;
  const kids = node.children.slice().sort((x, y) => x.seg.localeCompare(y.seg));
  return kids.map((c) => {
    const key = hostKey + "::" + c.path;
    const collapsed = collapsedFolders.has(key);
    const total = countTreeAgents(c);
    return `<div class="ftree-node">
      <div class="ftree-folder" data-fold="${esc(key)}"><span class="fchev">${collapsed ? "▸" : "▾"}</span><span class="fic">📁</span> ${esc(c.seg)}${collapsed ? `<span class="fcount">${total}</span>` : ""}</div>
      ${!collapsed ? (c.agents.length ? `<div class="ftree-agents">${c.agents.map(leafFn).join("")}</div>` : "") : ""}
      ${!collapsed && c.children.length ? `<div class="ftree-children">${ftreeChildren(c, leafFn, hostKey)}</div>` : ""}
    </div>`;
  }).join("");
}
// rend un arbre COMPLET (racine + ses agents propres + ses dossiers), pour un hostKey donné.
function ftreeFull(t, leafFn, hostKey) {
  const rootAgents = t.root.agents.length ? `<div class="ftree-agents" style="margin:0 0 4px">${t.root.agents.map(leafFn || ftreeLeaf).join("")}</div>` : "";
  return rootAgents + ftreeChildren(t.root, leafFn, hostKey);
}
function hostTreeHtml(host, allAgents, leafFn) {
  const agents = (allAgents || []).filter((a) => (a.host || "local") === host);
  const t = buildHostTree(agents);
  if (!t) return `<div class="empty" style="padding:20px 4px;text-align:left">Aucun chemin de travail connu pour ${esc(host)}.</div>`;
  return `<div class="ftree"><div class="ftree-root">📍 <b>${esc(host)}</b> : <span class="froot-path">${esc(t.commonPrefix || "/")}/</span></div>${ftreeFull(t, leafFn, host)}</div>`;
}
// wire les feuilles (clic = ouvre le chat) ET les replis de dossiers (clic = toggle + re-render).
function wireFtree(el, rerenderFn) {
  el.querySelectorAll(".ftree-leaf").forEach((r) => (r.onclick = () => select(r.dataset.id)));
  el.querySelectorAll("[data-fold]").forEach((f) => (f.onclick = (e) => {
    e.stopPropagation();
    const k = f.dataset.fold;
    collapsedFolders.has(k) ? collapsedFolders.delete(k) : collapsedFolders.add(k);
    if (rerenderFn) rerenderFn();
  }));
}
function renderLogsTab(a) {
  getJSON("/api/transcript?id=" + encodeURIComponent(a.id) + "&n=60").then((j) => {
    const tools = (j.feed || []).filter((e) => e.kind === "tool").slice(-16);
    $("ctx-body").innerHTML = `<div class="card2"><h3>Derniers outils</h3>` +
      (tools.length ? tools.map((e) => `<div style="font-family:var(--mono);font-size:11.5px;color:#9fb3cf;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.03)">⚙ ${esc(e.text)}</div>`).join("") : `<div style="color:var(--mut2);font-size:12px">—</div>`) + `</div>`;
  }).catch(() => {});
}
function renderFleetCtx() {
  if (detailId) return;
  $("ctx-title").textContent = "Contexte flotte";
  const a = snap.agents || [], cto = snap.cto || {};
  const by = (s) => a.filter((x) => x.status === s).length;
  $("ctx-body").innerHTML = `
    <div class="card2"><h3>Flotte</h3>
      <div class="kv"><span class="k">Agents</span><span class="v">${a.length}</span></div>
      <div class="kv"><span class="k">Actifs</span><span class="v grn">${a.filter((x) => x.status === "working" || x.busy).length}</span></div>
      <div class="kv"><span class="k">À voir</span><span class="v amber">${by("blocked") + by("failed")}</span></div>
      <div class="kv"><span class="k">Distants</span><span class="v">${a.filter((x) => x.host).length}</span></div>
      <div class="kv"><span class="k">Sous-agents</span><span class="v">${cto.subagents || 0}</span></div>
    </div>
    <div class="card2"><h3>Coût & tokens</h3>
      <div class="kv"><span class="k">Coût cumulé</span><span class="v">${fmtCost(cto.costUsd)}</span></div>
      <div class="kv"><span class="k">Tokens</span><span class="v">${fmtTok(cto.tokens)}</span></div>
      <div class="kv"><span class="k">Équipes</span><span class="v">${(snap.teams || []).length}</span></div>
    </div>
    <div class="card2"><h3>Providers</h3>
      <div class="kv"><span class="k">Anthropic</span><span class="v grn">abonnement</span></div>
      <div class="kv"><span class="k">AWS Bedrock</span><span class="v ${snap.bedrock ? "grn" : ""}">${snap.bedrock ? "clés Askeal prêtes" : "non configuré"}</span></div>
    </div>`;
}
function clearDetail() { detailId = null; clearInterval(feedTimer); clearInterval(hostTimer); $("conv").innerHTML = `<div class="empty"><span class="big">🛰️</span>Sélectionne un agent à gauche.</div>`; $("composer").classList.add("hidden"); $("center-head").innerHTML = `<div class="hid"><div class="hn">Fleet Office</div><div class="status">sélectionne un agent</div></div><div class="hact"><button id="team-btn2" class="ghost-btn" type="button">👥 Équipe</button><a class="ghost-btn" href="/3d">🏢 3D</a></div>`; const t = $("team-btn2"); if (t) t.onclick = openTeam; renderFleetCtx(); renderRail(); }

// ---- vues (nav) ---------------------------------------------------------------
function setView(v) {
  view = v;
  $("nav").querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("sel", b.dataset.view === v));
  const isMach = v === "machines", isSkills = v === "skills", isAudit = v === "audit", isAgents = v === "agents";
  $("mach").classList.toggle("hidden", !isMach);
  $("skills").classList.toggle("hidden", !isSkills);
  $("audit").classList.toggle("hidden", !isAudit);
  $("conv").classList.toggle("hidden", !isAgents || !detailId);
  $("composer").classList.toggle("hidden", !isAgents || !detailId);
  clearInterval(machTimer);
  if (isMach) { renderMachines(); machTimer = setInterval(renderMachines, 15000); $("center-head").innerHTML = `<div class="hid"><div class="hn">Machines</div><div class="status">nœuds Tailscale pilotables</div></div>`; }
  if (isSkills) { renderSkills(); $("center-head").innerHTML = `<div class="hid"><div class="hn">Bibliothèque de skills</div><div class="status">rangées par métier · installées dans ~/.claude/skills</div></div>`; }
  if (isAudit) { renderAudit(); $("center-head").innerHTML = `<div class="hid"><div class="hn">Audit</div><div class="status">journal des actions sur la flotte</div></div>`; }
  if (isAgents && !detailId) $("center-head").innerHTML = `<div class="hid"><div class="hn">Fleet Office</div><div class="status">sélectionne un agent</div></div><div class="hact"><button id="team-btn3" class="ghost-btn" type="button">👥 Équipe</button><a class="ghost-btn" href="/3d">🏢 3D</a></div>`, (()=>{const t=$("team-btn3"); if(t) t.onclick=openTeam;})();
}
let machSelectedHost = null;
async function renderMachines() {
  if (!$("mach").innerHTML.trim()) $("mach").innerHTML = `<div class="empty" style="padding:40px">chargement des machines…</div>`; // 1er affichage seulement (pas de flicker au refresh périodique)
  let hosts = [{ id: "local", label: "local" }];
  try { const j = await getJSON("/api/hosts"); if (j.hosts) hosts = j.hosts; } catch {}
  const agents = snap.agents || [];
  const cards = await Promise.all(hosts.map(async (host) => {
    // Tailscale sait déjà que cet hôte est hors-ligne -> inutile de le sonder en SSH (lent, timeout).
    let m = {}; if (host.online !== false) { try { m = await getJSON("/api/host?name=" + encodeURIComponent(host.id)); } catch {} }
    const n = agents.filter((x) => (x.host || "local") === host.id).length;
    const open = machSelectedHost === host.id;
    return `<div class="card2 mach-card"><h3>${esc(host.label || host.id)} ${host.online === false ? '<span style="color:var(--mut2);font-size:10px">hors-ligne</span>' : ""}</h3>
      <div class="meters" style="margin-bottom:10px">
        <div class="meter"><div class="ml">CPU</div><div class="mv">${m.cpuPct != null ? m.cpuPct + "%" : "—"}</div>${ring(m.cpuPct)}</div>
        <div class="meter"><div class="ml">RAM</div><div class="mv">${m.memPct != null ? m.memPct + "%" : "—"}</div>${ring(m.memPct)}</div>
      </div>
      <div class="kv"><span class="k">Disque</span><span class="v">${m.diskPct != null ? m.diskPct + "%" : "—"}</span></div>
      <div class="kv"><span class="k">IP</span><span class="v">${esc(m.tsip || host.ip || "—")}</span></div>
      <div class="kv"><span class="k">Agents</span><span class="v">${n}</span></div>
      ${n ? `<button class="linkbtn2" data-treehost="${esc(host.id)}">🌳 ${open ? "masquer" : "voir"} l'arborescence</button>` : ""}
    </div>`;
  }));
  if (machSelectedHost && hosts.some((h) => h.id === machSelectedHost)) {
    const idx = hosts.findIndex((h) => h.id === machSelectedHost);
    const treeHtml = `<div class="card2" style="grid-column:1/-1"><h3>🌳 ${esc(machSelectedHost)} — où sont les agents</h3>${hostTreeHtml(machSelectedHost, agents)}</div>`;
    cards.splice(idx + 1, 0, treeHtml);
  }
  $("mach").innerHTML = cards.join("");
  $("mach").querySelectorAll("[data-treehost]").forEach((b) => (b.onclick = () => { machSelectedHost = machSelectedHost === b.dataset.treehost ? null : b.dataset.treehost; renderMachines(); }));
  wireFtree($("mach"), renderMachines);
}

// ---- vue AUDIT (journal des actions sur la flotte) -----------------------------
const AUDIT_ICON = { spawn: "🚀", kill: "🗑", rename: "✎", train: "🏋️", team: "👥", "skill-add": "➕", "skill-del": "✕", "skill-refetch": "↻" };
function auditDesc(e) {
  switch (e.action) {
    case "spawn": return `Agent déployé « ${e.name} » (${e.role || "—"}) sur ${e.host || "local"}${e.provider === "bedrock" ? " · Bedrock" : ""}`;
    case "kill": return `Agent fermé « ${e.name} »`;
    case "rename": return `« ${e.from} » renommé en « ${e.to} »`;
    case "train": return `Entraînement de « ${e.name} »${e.targeted ? " — métier : " + e.role : ""}`;
    case "team": return `Équipe « ${e.name} » lancée (${e.members} rôle${e.members > 1 ? "s" : ""})${e.provider === "bedrock" ? " · Bedrock" : ""}`;
    case "skill-add": return `Skill ajoutée « ${e.name} » dans ${e.category}`;
    case "skill-del": return `Skill supprimée « ${e.name} »`;
    case "skill-refetch": return `Actualisation des skills « ${e.category} »`;
    default: return e.action;
  }
}
async function renderAudit() {
  const el = $("audit");
  if (!el.innerHTML.trim()) el.innerHTML = `<div class="empty">chargement…</div>`;
  let j; try { j = await getJSON("/api/audit?n=200"); } catch { j = null; }
  if ($("nav-audit")) $("nav-audit").textContent = (j && j.total) || 0;
  const entries = (j && j.entries) || [];
  el.innerHTML = entries.length
    ? `<div class="audit-list">` + entries.map((e) => `<div class="audit-row"><span class="aic">${AUDIT_ICON[e.action] || "•"}</span><div class="adesc">${esc(auditDesc(e))}</div><span class="ats" title="${esc(new Date(e.at).toLocaleString("fr-FR"))}">${esc(ago(e.at))}</span></div>`).join("") + `</div>`
    : `<div class="empty"><span class="big">▧</span>Aucune action enregistrée pour l'instant.<br>Chaque déploiement, renommage, entraînement… apparaîtra ici.</div>`;
}

// ---- vue SKILLS (bibliothèque rangée + consultable) ---------------------------
let _skillsData = null;
async function renderSkills() {
  const el = $("skills");
  if (!_skillsData) el.innerHTML = `<div class="empty">chargement de la bibliothèque…</div>`;
  try { _skillsData = await getJSON("/api/skills"); } catch { el.innerHTML = `<div class="empty">bibliothèque inaccessible</div>`; return; }
  const cats = _skillsData.categories || [];
  if ($("nav-skills")) $("nav-skills").textContent = _skillsData.total || 0;
  const asst = `<div class="skills-asst">
    <div class="asst-h">◇ Assistant skills — ajoute / supprime / actualise</div>
    <div class="asst-log" id="skasst-log"></div>
    <div class="asst-row"><input id="skasst-in" placeholder="Colle un lien GitHub (owner/repo, blob, raw, .md)…  ex: « catégorie: backend https://github.com/… », « supprime <nom> », « actualise <catégorie> »" /><button id="skasst-go">Ajouter</button></div>
  </div>`;
  const body = cats.length ? cats.map((c) => `<div class="skills-cat"><h3>◈ ${esc(c.category)} <span class="badge">${c.count}</span><button class="catbtn" data-refetch="${esc(c.category)}">↻ actualiser</button></h3>
    <div class="skill-grid">` + c.skills.map((s) => `<div class="skill-card" data-skill="${esc(s.path)}"><button class="skx" data-del="${esc(s.path)}" title="supprimer">✕</button><div class="sn">${esc(s.name)}</div><div class="sd">${esc(s.desc || "—")}</div><div class="sm">${esc(String(s.path).split("/").slice(0, -1).join("/"))}</div></div>`).join("") + `</div></div>`).join("")
    : `<div class="empty"><span class="big">◈</span>Aucune skill encore. Ajoute-en une via l'assistant ci-dessus, ou elles arrivent automatiquement par métier quand un agent finit.</div>`;
  el.innerHTML = asst + body;
  el.querySelectorAll("[data-skill]").forEach((c) => (c.onclick = () => openSkill(c.dataset.skill)));
  el.querySelectorAll("[data-del]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); skillDel(b.dataset.del); }));
  el.querySelectorAll("[data-refetch]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); skillRefetch(b.dataset.refetch); }));
  const go = $("skasst-go"), inp = $("skasst-in");
  if (go) go.onclick = skAsstSend;
  if (inp) inp.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); skAsstSend(); } };
}
function asstLog(text, cls) { const l = $("skasst-log"); if (!l) return; const d = document.createElement("div"); d.className = "asst-msg " + (cls || "bot"); d.textContent = text; l.appendChild(d); l.scrollTop = l.scrollHeight; }
async function skAsstSend() {
  const inp = $("skasst-in"); if (!inp) return; const raw = inp.value.trim(); if (!raw) return;
  asstLog(raw, "me"); inp.value = "";
  const low = raw.toLowerCase();
  let m;
  if ((m = raw.match(/\b(?:supprime|retire|delete|remove)\b\s+(.+)$/i))) {
    const q = m[1].trim().toLowerCase();
    const hit = (_skillsData.categories || []).flatMap((c) => c.skills).find((s) => s.name.toLowerCase() === q || s.path.toLowerCase().includes(q));
    if (!hit) return asstLog("Skill introuvable : « " + m[1].trim() + " »", "bot err");
    return skillDel(hit.path);
  }
  if ((m = raw.match(/\b(?:actualise|refetch|met[s]?\s*à\s*jour|update)\b\s+(.+)$/i))) return skillRefetch(m[1].trim());
  // sinon : ajout depuis un lien
  const urlMatch = raw.match(/https?:\/\/\S+/) || raw.match(/\b[\w.-]+\/[\w.-]+\b/);
  if (!urlMatch) return asstLog("Donne un lien GitHub (owner/repo, blob, raw ou .md), ou « supprime <nom> » / « actualise <catégorie> ».", "bot");
  const catM = raw.match(/(?:cat[ée]gorie|cat)\s*[:=]\s*([\w -]+?)(?:\s+https?:|\s+[\w.-]+\/|$)/i);
  const category = catM ? catM[1].trim() : "";
  asstLog("Téléchargement…", "bot");
  const j = await post("/api/skill-add", { url: urlMatch[0], category });
  if (!j.ok) return asstLog("Échec : " + (j.error || "ajout impossible"), "bot err");
  if (j.bulk) {
    asstLog(`✓ ${j.count} skills importées dans « ${j.category} » : ` + j.added.map((a) => a.name).join(", ") + " → installées dans ~/.claude/skills", "bot ok");
    toast(`✓ ${j.count} skills ajoutées (${j.category})`);
  } else {
    asstLog("✓ ajoutée : « " + j.name + " » dans « " + j.category + " » → installée dans ~/.claude/skills", "bot ok");
    toast("✓ skill ajoutée : " + j.name);
  }
  _skillsData = null; renderSkills();
}
async function skillDel(path) {
  const j = await post("/api/skill-del", { path });
  if (!j.ok) return asstLog("Suppression impossible : " + (j.error || ""), "bot err");
  asstLog("🗑 supprimée : " + (j.name || path), "bot");
  toast("🗑 skill supprimée"); _skillsData = null; renderSkills();
}
async function skillRefetch(category) {
  const j = await post("/api/skill-refetch", { category });
  if (!j.ok) return asstLog("Actualisation impossible : " + (j.error || ""), "bot err");
  asstLog("↻ actualisation de « " + category + " » lancée (repos réputés) — recharge dans ~30 s.", "bot ok");
  toast("↻ actualisation « " + category + " »");
  setTimeout(() => { _skillsData = null; renderSkills(); }, 8000);
}
async function openSkill(rel) {
  openModal("skillview");
  $("sk-name").textContent = rel.split("/").pop() === "SKILL.md" ? rel.split("/").slice(-2)[0] : rel.split("/").pop();
  $("sk-meta").textContent = rel; $("sk-body").textContent = "chargement…";
  try { const j = await getJSON("/api/skill?path=" + encodeURIComponent(rel)); $("sk-body").textContent = j.content || j.error || "(vide)"; }
  catch { $("sk-body").textContent = "lecture impossible"; }
}

// ---- explorateur de chemin ----------------------------------------------------
let fxState = { host: "local", path: "", targetInput: null };
async function openBrowser(targetInputId, host) {
  fxState = { host: host || "local", path: ($(targetInputId).value || "").trim(), targetInput: targetInputId };
  openModal("fx"); $("fx-host").textContent = "📍 " + fxState.host;
  await fxLoad(fxState.path);
}
async function fxLoad(p) {
  $("fx-list").innerHTML = `<div class="fx-row"><span class="fi">…</span> chargement…</div>`;
  let j; try { j = await getJSON("/api/ls?host=" + encodeURIComponent(fxState.host) + "&path=" + encodeURIComponent(p || "")); } catch { j = null; }
  if (!j || j.error) { $("fx-list").innerHTML = `<div class="fx-row" style="color:var(--acc2)">${esc((j && j.error) || "dossier illisible")}</div>`; return; }
  fxState.path = j.path; fxState._parent = j.parent; fxState._home = j.home;
  $("fx-path").textContent = j.path;
  const dirs = j.dirs || [];
  $("fx-list").innerHTML = dirs.length ? dirs.map((d) => `<div class="fx-row" data-d="${esc(d)}"><span class="fi">📁</span> ${esc(d)}</div>`).join("") : `<div class="fx-row" style="color:var(--mut2)">— aucun sous-dossier —</div>`;
  $("fx-list").querySelectorAll("[data-d]").forEach((r) => (r.onclick = () => fxLoad((fxState.path.endsWith("/") ? fxState.path : fxState.path + "/") + r.dataset.d)));
}
function wireBrowser() {
  $("fx-up").onclick = () => { if (fxState._parent) fxLoad(fxState._parent); };
  $("fx-home").onclick = () => fxLoad(fxState._home || "");
  $("fx-pick").onclick = () => { if (fxState.targetInput) { $(fxState.targetInput).value = fxState.path; if (fxState.targetInput === "sp-cwd") $("sp-cwd-hint").textContent = fxState.host === "local" ? "" : "(sur " + fxState.host + ")"; } closeModal("fx"); };
}

// ---- reprise d'une session existante (dans la modale de déploiement) ----------
let resumeId = null;
function renderResumeList() {
  const box = $("sp-resume"); if (!box) return;
  const agents = (snap.agents || []).slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 40);
  if (!agents.length) { box.innerHTML = `<div class="resume-item" style="color:var(--mut2);cursor:default">aucune session dans l'historique</div>`; return; }
  box.innerHTML = agents.map((a) => `<div class="resume-item" data-rid="${esc(a.id)}"><span class="rn">${esc(a.name || "—")}</span><span class="rp">${esc(a.role || "")}${a.project ? " · " + esc(a.project) : ""}${a.host ? " · " + esc(a.host) : ""}</span><span class="rt">${esc(ago(a.updatedAt))}</span></div>`).join("");
  box.querySelectorAll("[data-rid]").forEach((r) => (r.onclick = () => {
    const on = r.classList.contains("sel");
    box.querySelectorAll(".resume-item").forEach((x) => x.classList.remove("sel"));
    if (on) { resumeId = null; return; }
    r.classList.add("sel"); resumeId = r.dataset.rid;
    const a = agentById(resumeId);
    if (a) { if (a.cwd) $("sp-cwd").value = a.cwd; if (a.name) $("sp-name").value = a.name; if (a.role) $("sp-role").value = a.role; }
    toast("↩ reprise : « " + ((a && a.name) || resumeId) + " » — écris la suite de la mission");
  }));
}

// ---- déploiement --------------------------------------------------------------
let spawnHost = "local", spawnProv = "anthropic", teamProv = "anthropic";
function fillModels() {
  $("sp-model").innerHTML = MODELS.map((m) => `<option value="${m.v}">${m.l}</option>`).join("");
  $("tm-model").innerHTML = `<option value="auto">Auto (le chef choisit) 👑</option>` + MODELS.map((m) => `<option value="${m.v}">${m.l}</option>`).join("");
}
function provSeg(segId, cur, set) {
  const seg = $(segId); if (!seg) return;
  seg.querySelectorAll("button").forEach((b) => {
    if (b.dataset.prov === "bedrock" && !snap.bedrock) { b.disabled = true; b.title = "configure ~/.fleet/bedrock.env"; b.style.opacity = ".5"; }
    b.classList.toggle("sel", b.dataset.prov === cur);
    b.onclick = () => { if (b.disabled) return; seg.querySelectorAll("button").forEach((x) => x.classList.remove("sel")); b.classList.add("sel"); set(b.dataset.prov); };
  });
}
async function openSpawn() {
  openModal("spawn"); $("sp-err").textContent = ""; fillModels();
  attS.length = 0; renderTray($("sp-attach-list"), attS);
  resumeId = null; renderResumeList();
  spawnProv = "anthropic"; provSeg("sp-prov", spawnProv, (v) => (spawnProv = v));
  const wrap = $("sp-hosts"); wrap.innerHTML = `<div class="host-pick sel">chargement…</div>`;
  let hosts = [{ id: "local", label: "local", ip: "127.0.0.1", online: true }];
  try { const j = await getJSON("/api/hosts"); if (j.hosts && j.hosts.length) hosts = j.hosts; } catch {}
  // pré-sélectionne la machine qu'on est en train de consulter dans l'arbre du rail, si disponible
  const preferred = (railView === "tree" && railHost && hosts.some((h) => h.id === railHost && h.online !== false)) ? railHost : "local";
  spawnHost = preferred;
  wrap.innerHTML = hosts.map((h) => `<button type="button" class="host-pick ${h.id === preferred ? "sel" : ""}" data-host="${esc(h.id)}" ${h.online ? "" : "disabled style='opacity:.45'"}><div class="hn"><span class="hdot ${h.online ? "" : "off"}"></span>${esc(h.label)}</div><div class="hi">${esc(h.ip || "")}${h.id === "local" ? "" : (h.online ? " · ssh" : " · hors-ligne")}</div></button>`).join("");
  if (preferred !== "local") $("sp-cwd-hint").textContent = "(sur " + preferred + ")";
  wrap.querySelectorAll(".host-pick").forEach((b) => (b.onclick = () => { if (b.disabled) return; wrap.querySelectorAll(".host-pick").forEach((x) => x.classList.remove("sel")); b.classList.add("sel"); spawnHost = b.dataset.host; $("sp-cwd-hint").textContent = spawnHost === "local" ? "" : "(sur " + spawnHost + ")"; }));
}
async function doSpawn() {
  const prompt = $("sp-prompt").value.trim();
  if (attS.some((x) => x.pending)) { $("sp-err").textContent = "Upload en cours…"; return; }
  // reprise d'une session existante : on continue son fil (contexte intact) au lieu d'en créer un
  if (resumeId) {
    if (!prompt && !readyIds(attS).length) { $("sp-err").textContent = "Écris la suite de la mission (ou décoche la reprise)."; return; }
    $("sp-go").disabled = true; $("sp-err").textContent = "";
    const j = await post("/api/send", { id: resumeId, prompt, attachments: readyIds(attS), origin: "web" });
    $("sp-go").disabled = false;
    if (!j.ok) { $("sp-err").textContent = j.error || "reprise impossible"; return; }
    const rid = resumeId; attS.length = 0; renderTray($("sp-attach-list"), attS); closeModal("spawn");
    toast("↩ session reprise"); $("sp-prompt").value = ""; resumeId = null;
    setTimeout(() => select(rid), 300); return;
  }
  const body = { host: spawnHost, name: $("sp-name").value.trim(), role: $("sp-role").value.trim(), cwd: $("sp-cwd").value.trim(), prompt, model: $("sp-model").value, effort: $("sp-effort").value, perm: $("sp-perm").value, provider: spawnProv, attachments: readyIds(attS) };
  if (!body.cwd || !body.prompt) { $("sp-err").textContent = "Workspace et mission requis."; return; }
  $("sp-go").disabled = true; $("sp-err").textContent = "";
  const j = await post("/api/spawn", body); $("sp-go").disabled = false;
  if (!j.ok) { $("sp-err").textContent = j.error || "échec"; return; }
  attS.length = 0; renderTray($("sp-attach-list"), attS); closeModal("spawn");
  toast("🚀 agent déployé" + (spawnProv === "bedrock" ? " (Bedrock)" : "") + (spawnHost !== "local" ? " · " + spawnHost : ""));
  $("sp-name").value = $("sp-role").value = $("sp-cwd").value = $("sp-prompt").value = "";
  if (j.id) setTimeout(() => select(j.id), 400);
}

// ---- équipes ------------------------------------------------------------------
let rolesCache = ["Architecte", "Backend", "Frontend", "DevOps", "QA"];
const DEFAULT_CHECKED = new Set(["Architecte", "Backend", "Frontend"]);
function renderRoles(checked) {
  const box = $("tm-roles"); if (!box) return;
  box.innerHTML = rolesCache.map((r) => `<label><input type="checkbox" value="${esc(r)}" ${(checked ? checked.has(r) : DEFAULT_CHECKED.has(r)) ? "checked" : ""}/> ${esc(r)}</label>`).join("");
  box.querySelectorAll("input").forEach((c) => (c.onchange = populateChief));
}
async function loadRoles(checked) { try { const j = await getJSON("/api/roles"); if (j.roles && j.roles.length) rolesCache = j.roles; } catch {} renderRoles(checked); populateChief(); }
const checkedRoles = () => [...$("tm-roles").querySelectorAll("input:checked")].map((c) => c.value);
function populateChief() {
  const sel = $("tm-chief"); if (!sel) return;
  const prev = sel.value, roles = checkedRoles(), managed = (snap.agents || []).filter((a) => a.managed);
  let html = `<optgroup label="Nouveau rôle">` + (roles.length ? roles.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join("") : `<option value="">(coche un rôle)</option>`) + `</optgroup>`;
  if (managed.length) html += `<optgroup label="Agent existant">` + managed.map((a) => `<option value="agent:${a.id}">${esc(a.name)} · ${esc(a.role)}</option>`).join("") + `</optgroup>`;
  sel.innerHTML = html; if (prev) sel.value = prev;
}
async function addRole() {
  const inp = $("tm-newrole"), v = inp.value.trim(); if (!v) return;
  const checked = new Set(checkedRoles()); checked.add(v);
  const j = await post("/api/roles", { role: v }); if (!j.ok) return toast("Erreur : " + (j.error || ""));
  rolesCache = j.roles || rolesCache; inp.value = ""; renderRoles(checked); populateChief(); toast("✅ métier ajouté : " + v);
}
function openTeam() { openModal("team"); $("tm-err").textContent = ""; fillModels(); teamProv = "anthropic"; provSeg("tm-prov", teamProv, (v) => (teamProv = v)); loadRoles(); }
async function doTeam() {
  const roles = checkedRoles();
  const body = { name: $("tm-name").value.trim(), goal: $("tm-goal").value.trim(), cwd: $("tm-cwd").value.trim(), model: $("tm-model").value, perm: $("tm-perm").value, roles, chief: $("tm-chief").value, provider: teamProv };
  if (!body.cwd || !body.goal) { $("tm-err").textContent = "Objectif et workspace requis."; return; }
  if (!roles.length) { $("tm-err").textContent = "Choisis au moins un rôle."; return; }
  $("tm-go").disabled = true; $("tm-err").textContent = "";
  const j = await post("/api/team", body); $("tm-go").disabled = false;
  if (!j.ok) { $("tm-err").textContent = j.error || "échec"; return; }
  closeModal("team"); toast("🚀 équipe « " + (body.name || "sans nom") + " » lancée" + (teamProv === "bedrock" ? " (Bedrock)" : ""));
  $("tm-name").value = $("tm-goal").value = $("tm-cwd").value = "";
}

// ---- modales / utilitaires ----------------------------------------------------
function openModal(id) { $("backdrop").classList.remove("hidden"); $(id).classList.remove("hidden"); }
function closeModal(id) { $(id).classList.add("hidden"); $("backdrop").classList.add("hidden"); }
let toastT = null;
function toast(msg) { const t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2600); }

// ---- pièces jointes -----------------------------------------------------------
const attC = [], attS = [];
const fmtSize = (n) => { n = n || 0; return n >= 1048576 ? (n / 1048576).toFixed(1) + " Mo" : n >= 1024 ? Math.round(n / 1024) + " Ko" : n + " o"; };
const readyIds = (arr) => arr.filter((a) => a.uploadId).map((a) => a.uploadId);
function renderTray(listEl, arr) {
  if (!listEl) return;
  listEl.classList.toggle("hidden", arr.length === 0);
  listEl.innerHTML = arr.map((a, i) => `<span class="fchip ${a.pending ? "pending" : ""}"><span>${a.pending ? "⏳" : "📎"}</span><span>${esc(a.name)}</span><small style="color:var(--mut2)">${a.size != null ? fmtSize(a.size) : ""}</small><button class="fx" data-rm="${i}">✕</button></span>`).join("");
  listEl.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); arr.splice(+b.dataset.rm, 1); renderTray(listEl, arr); }));
}
async function uploadOne(file, arr, listEl) {
  const item = { name: file.name, size: file.size, pending: true, uploadId: null };
  arr.push(item); renderTray(listEl, arr);
  try { const r = await fetch("/api/upload", { method: "POST", headers: { "X-Filename": encodeURIComponent(file.name) }, body: file }); const j = await r.json();
    if (j.ok) { item.uploadId = j.uploadId; item.pending = false; item.size = j.size; } else { toast("Upload échoué : " + (j.error || file.name)); arr.splice(arr.indexOf(item), 1); }
  } catch { toast("Upload échoué : " + file.name); const k = arr.indexOf(item); if (k >= 0) arr.splice(k, 1); }
  renderTray(listEl, arr);
}
const addFiles = (files, arr, listEl) => [...files].forEach((f) => uploadOne(f, arr, listEl));
function wireDrop(zoneEl, arr, listEl) {
  if (!zoneEl) return;
  zoneEl.addEventListener("dragover", (e) => { e.preventDefault(); zoneEl.classList.add("drag"); });
  zoneEl.addEventListener("dragleave", (e) => { if (e.target === zoneEl) zoneEl.classList.remove("drag"); });
  zoneEl.addEventListener("drop", (e) => { e.preventDefault(); zoneEl.classList.remove("drag"); if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files, arr, listEl); });
}

// ---- câblage ------------------------------------------------------------------
$("deploy-btn").onclick = openSpawn;
$("team-btn").onclick = openTeam;
$("sp-go").onclick = doSpawn;
$("tm-go").onclick = doTeam;
$("sp-clip").onclick = () => $("sp-file").click();
$("sp-file").onchange = (e) => { addFiles(e.target.files, attS, $("sp-attach-list")); e.target.value = ""; };
$("tm-addrole").onclick = addRole;
$("tm-newrole").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); addRole(); } };
$("nav").querySelectorAll(".nav-item").forEach((b) => (b.onclick = () => { if (b.classList.contains("soon")) return toast("Vue « " + b.dataset.view + " » à venir"); setView(b.dataset.view); }));
$("ctx-tabs").querySelectorAll(".ctx-tab").forEach((b) => (b.onclick = () => { ctxTab = b.dataset.tab; $("ctx-tabs").querySelectorAll(".ctx-tab").forEach((x) => x.classList.toggle("sel", x === b)); const a = agentById(detailId); if (a) renderCtx(a); else renderFleetCtx(); }));
document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => (b.dataset.close === "term" ? closeTerminal() : closeModal(b.dataset.close))));
// NB : le terminal ne se ferme QUE via le ✕ explicite (pas backdrop/Escape — Escape a un sens
// DANS un shell (vim, less…) et un clic externe accidentel ne doit pas tuer une session en cours).
$("backdrop").onclick = () => { closeModal("spawn"); closeModal("team"); closeModal("fx"); closeModal("skillview"); };
$("sp-browse").onclick = () => openBrowser("sp-cwd", spawnHost);
$("tm-browse").onclick = () => openBrowser("tm-cwd", "local");
wireBrowser();
$("q").oninput = (e) => { query = e.target.value.trim().toLowerCase(); renderRail(); };
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { for (const m of ["fx", "skillview", "spawn", "team"]) if (!$(m).classList.contains("hidden")) { closeModal(m); break; } }
  if (e.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) { e.preventDefault(); $("q").focus(); }
});
wireComposer(); wireDrop($("sp-attach"), attS, $("sp-attach-list")); wireDrop($("composer"), attC, $("c-attach"));

// ---- panneaux redimensionnables (glisser la poignée) — largeur mémorisée par appareil ---------
// Le centre garde TOUJOURS un minimum vital (CENTER_MIN) : le max autorisé pour un panneau tient
// compte en direct de la largeur de fenêtre ET de la largeur actuelle de L'AUTRE panneau, pour ne
// jamais écraser le centre (ex. les deux panneaux élargis sur une fenêtre ensuite rétrécie).
const CENTER_MIN = 360;
const PANEL_LIMITS = { "--rail-w": { min: 220, max: 520, other: "--ctx-w" }, "--ctx-w": { min: 260, max: 560, other: "--rail-w" } };
function cssVarPx(v) { return parseInt(getComputedStyle(document.documentElement).getPropertyValue(v), 10) || 0; }
function dynMax(cssVar) {
  const lim = PANEL_LIMITS[cssVar];
  return Math.max(lim.min, Math.min(lim.max, window.innerWidth - CENTER_MIN - cssVarPx(lim.other)));
}
// Reclampe les 2 panneaux au boot ET si la fenêtre est redimensionnée (jamais de centre écrasé).
function clampPanelWidths() {
  for (const cssVar of ["--rail-w", "--ctx-w"]) {
    const lim = PANEL_LIMITS[cssVar];
    const w = Math.max(lim.min, Math.min(dynMax(cssVar), cssVarPx(cssVar) || lim.min));
    document.documentElement.style.setProperty(cssVar, w + "px");
  }
}
function wireResize(handle, cssVar, opts) {
  if (!handle) return;
  const min = opts.min, storeKey = opts.storeKey, dir = opts.dir; // dir=1 : la largeur grandit vers la droite ; -1 : vers la gauche
  try { const saved = parseInt(localStorage.getItem(storeKey), 10); if (saved) document.documentElement.style.setProperty(cssVar, saved + "px"); } catch { /* stockage indispo (navigation privée…) -> largeur par défaut */ }
  let startX = 0, startW = 0;
  const onMove = (e) => {
    const w = Math.max(min, Math.min(dynMax(cssVar), startW + dir * (e.clientX - startX)));
    document.documentElement.style.setProperty(cssVar, w + "px");
  };
  const onUp = () => {
    document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp);
    document.body.classList.remove("resizing"); handle.classList.remove("dragging");
    try { const w = cssVarPx(cssVar); if (w) localStorage.setItem(storeKey, w); } catch { /* per-appareil seulement, pas grave si indispo */ }
  };
  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    startX = e.clientX;
    startW = cssVarPx(cssVar) || min;
    document.body.classList.add("resizing"); handle.classList.add("dragging");
    document.addEventListener("mousemove", onMove); document.addEventListener("mouseup", onUp);
  });
}

// ---- boot ---------------------------------------------------------------------
fillModels(); renderFleetCtx(); connect();
pollRailHosts(); railHostsTimer = setInterval(pollRailHosts, 20000); // carte tailnet du rail (indépendante du SSE)
getJSON("/api/skills").then((j) => { _skillsData = j; if ($("nav-skills")) $("nav-skills").textContent = j.total || 0; }).catch(() => {});
getJSON("/api/audit?n=1").then((j) => { if ($("nav-audit")) $("nav-audit").textContent = j.total || 0; }).catch(() => {});
wireResize($("rail-resize"), "--rail-w", { min: 220, max: 520, storeKey: "fleetoffice.railW", dir: 1 });
wireResize($("ctx-resize"), "--ctx-w", { min: 260, max: 560, storeKey: "fleetoffice.ctxW", dir: -1 });
clampPanelWidths(); // les 2 largeurs restaurées peuvent, ensemble, dépasser la fenêtre -> reclampe
let _resizeT = null;
window.addEventListener("resize", () => { clearTimeout(_resizeT); _resizeT = setTimeout(clampPanelWidths, 120); });
