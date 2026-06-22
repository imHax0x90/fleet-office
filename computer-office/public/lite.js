"use strict";
/* FLEET OFFICE — console légère desktop. Même orchestrateur que le bureau 3D et l'APK :
   SSE /events + API /api/*. Zéro WebGL → chargement instantané sur machines modestes. */

const api = (p) => p; // app servie par l'orchestrateur lui-même (même origine)
const getJSON = (p) => fetch(api(p), { cache: "no-store" }).then((r) => r.json());
const post = (p, b) => fetch(api(p), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e.message || e) }));

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const STATUS = {
  working: { c: "var(--work)", l: "au travail", e: "💻" },
  coworking: { c: "var(--cowork)", l: "collabore", e: "🤝" },
  done: { c: "var(--done)", l: "terminé", e: "✅" },
  idle: { c: "var(--idle)", l: "au repos", e: "🧘" },
  queued: { c: "var(--idle)", l: "en file", e: "⏳" },
  blocked: { c: "var(--blocked)", l: "attente", e: "🙋" },
  failed: { c: "var(--failed)", l: "erreur", e: "⚠️" },
};
const ROOM = { office: "🏢", coworking: "👥", gym: "🏋️" };
const st = (a) => STATUS[a.status] || STATUS.idle;
const AVPAL = ["#36f0ff", "#ff3df0", "#a15bff", "#4fd1c5", "#f6ad55", "#57d977", "#ffd35c", "#ff7e7e"];
function hashc(s) { let h = 0; for (let i = 0; i < (s || "").length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AVPAL[h % AVPAL.length]; }
function fmtCost(n) { n = n || 0; return n >= 1 ? "$" + n.toFixed(0) : "$" + n.toFixed(2); }
function fmtTok(n) { n = n || 0; return n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(0) + "k" : "" + n; }

let snap = { agents: [] };
let everConnected = false;
let detailId = null;
let slashList = [];
let feedTimer = null;
let filter = "all";
let query = "";

// ---- connexion temps réel (SSE) -----------------------------------------------
let es = null;
function connect() {
  if (es) try { es.close(); } catch {}
  setNet(false, "connexion…");
  try { es = new EventSource(api("/events")); } catch { return scheduleReconnect(); }
  es.addEventListener("snapshot", (e) => {
    setNet(true, "en direct"); everConnected = true;
    try { snap = JSON.parse(e.data); } catch { return; }
    renderStats(); renderTeams(); renderRoster();
    if (detailId) { const a = snap.agents.find((x) => x.id === detailId); if (a) updateInspectorDynamic(a); }
  });
  es.onerror = () => { setNet(false, "hors-ligne"); scheduleReconnect(); };
}
let reconnectT = null;
function scheduleReconnect() { clearTimeout(reconnectT); reconnectT = setTimeout(connect, 2500); }
function setNet(live, label) { const n = $("net"); n.classList.toggle("live", live); $("net-label").textContent = label; }

// ---- stats --------------------------------------------------------------------
function renderStats() {
  const a = snap.agents || [];
  const by = (s) => a.filter((x) => x.status === s).length;
  const cards = [
    ["", a.length, "agents"],
    ["work", by("working"), "actifs"],
    ["magenta", a.filter((x) => x.host).length, "distants"],
    ["cost", fmtCost(snap.cto && snap.cto.costUsd), "coût"],
  ];
  const sig = cards.map((c) => c[1]).join("|");
  if (renderStats._sig === sig) return;
  renderStats._sig = sig;
  $("stats").innerHTML = cards.map(([cl, v, l]) => `<div class="stat ${cl}"><div class="stat-v">${esc(v)}</div><div class="stat-l">${esc(l)}</div></div>`).join("");
}

// ---- roster (grille, mise à jour incrémentale) --------------------------------
function matchFilter(x) {
  if (filter === "working") return x.status === "working" || x.busy;
  if (filter === "idle") return x.status === "idle" || x.status === "done";
  if (filter === "attn") return x.status === "blocked" || x.status === "failed";
  if (filter === "remote") return !!x.host;
  return true;
}
function matchQuery(x) {
  if (!query) return true;
  return [x.name, x.role, x.project, x.host, x.cwd].filter(Boolean).join(" ").toLowerCase().includes(query);
}
const cardEls = new Map();
function renderRoster() {
  const all = snap.agents || [];
  const a = all.filter((x) => matchFilter(x) && matchQuery(x));
  const el = $("roster");
  if (!a.length) {
    cardEls.forEach((c) => c.remove()); cardEls.clear();
    el.innerHTML = all.length
      ? `<div class="empty"><span class="big">🔭</span>Aucun agent ne correspond à ce filtre.</div>`
      : `<div class="empty"><span class="big">🛰️</span>Aucun agent en vol.<br>Clique sur <b style="color:var(--cyan)">＋ Déployer</b> pour en lancer un — ici ou sur ton réseau Tailscale.</div>`;
    return;
  }
  if (el.firstElementChild && el.firstElementChild.classList.contains("empty")) el.innerHTML = "";
  const seen = new Set();
  for (const x of a) {
    seen.add(x.id);
    let c = cardEls.get(x.id);
    if (!c) { c = document.createElement("div"); c.className = "card"; c.dataset.id = x.id; c.onclick = () => openInspector(x.id); el.appendChild(c); cardEls.set(x.id, c); }
    updateCard(c, x);
  }
  for (const [id, c] of cardEls) if (!seen.has(id)) { c.remove(); cardEls.delete(id); }
}
function updateCard(c, x) {
  const sig = [x.name, x.role, x.project, x.status, x.busy, x.host, x.room, x.teamName, x.model, x.id === detailId].join("|");
  if (c._sig === sig) return;
  c._sig = sig;
  const s = st(x), col = hashc(x.role + x.name);
  c.style.setProperty("--st", s.c);
  c.classList.toggle("active", x.id === detailId);
  const host = x.host ? `<span class="badge b-host">📍 ${esc(x.host)}</span>` : "";
  const team = x.teamName ? `<span class="badge b-team">👥 ${esc(x.teamName)}</span>` : "";
  const busy = x.busy ? `<span class="spin-busy"></span>` : `<span class="room">${ROOM[x.room] || ""}</span>`;
  const mini = x.model ? `<span class="mini">${esc(x.model)}${x.costUsd ? " · " + fmtCost(x.costUsd) : ""}</span>` : (x.costUsd ? `<span class="mini">${fmtCost(x.costUsd)}</span>` : "");
  c.innerHTML = `<div class="av" style="--av:${col};background:${col}">${esc((x.name || "?")[0].toUpperCase())}</div>
    <div class="card-main">
      <div class="card-nm">${esc(x.name)} ${host}${team}</div>
      <div class="card-ro">${esc(x.role || "")}${x.project ? " · " + esc(x.project) : ""}</div>
      <div class="card-foot"><span class="pill" style="--st:${s.c}">${s.e} ${esc(s.l)}</span>${mini}${busy}</div>
    </div>`;
}

// ---- inspecteur / pilotage ----------------------------------------------------
function openInspector(id) {
  const a = snap.agents.find((x) => x.id === id); if (!a) return;
  detailId = id;
  renderMeta._html = updateInspectorDynamic._ssig = pollFeed._html = null;
  slashList = a.slashCommands || [];
  const s = st(a), col = hashc(a.role + a.name);
  const av = $("i-av"); av.textContent = (a.name || "?")[0].toUpperCase(); av.style.background = col; av.style.boxShadow = "0 0 18px -2px " + col;
  $("i-name").textContent = a.name;
  $("i-sub").innerHTML = `${s.e} ${esc(s.l)} · ${ROOM[a.room] || ""} ${esc(a.room || "")}`;
  renderMeta(a);
  $("i-feed").innerHTML = `<div class="fe think">chargement…</div>`;
  $("i-input").value = "";
  $("i-perm").innerHTML = permNote(a);
  wirePilot(a);
  updateInspectorDynamic(a);
  attP.length = 0; renderTray($("i-attach"), attP);
  $("inspector").classList.remove("hidden"); document.body.classList.add("insp-open");
  renderRoster();
  clearInterval(feedTimer); pollFeed(); feedTimer = setInterval(pollFeed, 1500);
}
function closeInspector() {
  $("inspector").classList.add("hidden"); document.body.classList.remove("insp-open");
  detailId = null; clearInterval(feedTimer); renderRoster();
}
function renderMeta(a) {
  const chips = [
    ["📍 machine", a.host || "local"],
    ["modèle", a.model || "—"],
    ["coût", fmtCost(a.costUsd)],
    a.tokens ? ["tokens", fmtTok(a.tokens)] : null,
    a.gitBranch ? ["git", a.gitBranch] : null,
    a.cwd ? ["cwd", a.cwd] : null,
  ].filter(Boolean);
  const html = chips.map(([k, v]) => `<span class="meta-chip">${esc(k)} <b>${esc(v)}</b></span>`).join("");
  if (renderMeta._html === html) return;
  renderMeta._html = html; $("i-meta").innerHTML = html;
}
function permNote(a) {
  const danger = ["bypassPermissions", "dontAsk", "auto"].includes(a.perm);
  return danger
    ? `⚠️ <b style="color:var(--failed)">${esc(a.perm)}</b> — peut push/merge/deploy sans validation`
    : `🔒 ${esc(a.perm || "acceptEdits")} — pas de push/merge/deploy sans validation`;
}
async function pollFeed() {
  if (!detailId) return;
  try {
    const j = await getJSON("/api/transcript?id=" + encodeURIComponent(detailId) + "&n=80");
    const el = $("i-feed"); if (!el) return;
    const KIND = { say: "🤖", think: "💭", tool: "⚙", result: "↳", prompt: "🧑" };
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    const html = (j.feed || []).map((e) => `<div class="fe ${e.kind}">${KIND[e.kind] || ""} ${esc(e.text)}</div>`).join("") || `<div class="fe think">en attente d'activité…</div>`;
    if (pollFeed._html === html) return;
    pollFeed._html = html; el.innerHTML = html;
    if (near) el.scrollTop = el.scrollHeight;
  } catch {}
}
function wirePilot(a) {
  const input = $("i-input"), slash = $("i-slash");
  const send = async () => {
    const prompt = input.value.trim();
    const files = readyIds(attP);
    if (!prompt && !files.length) return;
    if (attP.some((a) => a.pending)) return toast("Upload en cours…");
    slash.classList.add("hidden");
    const j = await post("/api/send", { id: a.id, prompt, attachments: files, origin: "web" });
    if (!j.ok) return toast("Erreur : " + (j.error || "échec"));
    input.value = ""; input.style.height = "auto"; attP.length = 0; renderTray($("i-attach"), attP);
  };
  $("i-send").onclick = send;
  input.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } };
  input.oninput = () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 120) + "px"; renderSlash(input, slash); };
  input.onblur = () => setTimeout(() => slash.classList.add("hidden"), 180);
  $("i-stop").onclick = () => post("/api/stop", { id: a.id });
  $("i-train").onclick = async () => { const j = await post("/api/train", { id: a.id }); toast(j.ok ? "🏋️ direction le gym" : "Erreur : " + (j.error || "")); };
  $("i-kill").onclick = async () => { if (!confirm("Fermer/tuer la session de « " + a.name + " » ?")) return; await post("/api/kill", { id: a.id }); closeInspector(); };
}
function renderSlash(input, dd) {
  const m = input.value.match(/^\/(\S*)$/);
  if (!m) return dd.classList.add("hidden");
  const q = m[1].toLowerCase();
  const matches = (slashList || []).filter((c) => c.toLowerCase().includes(q)).slice(0, 12);
  if (!matches.length) return dd.classList.add("hidden");
  dd.innerHTML = matches.map((c) => `<div class="slash-item">/${esc(c)}</div>`).join("");
  dd.classList.remove("hidden");
  [...dd.children].forEach((el, i) => (el.onmousedown = (e) => { e.preventDefault(); input.value = "/" + matches[i] + " "; dd.classList.add("hidden"); input.focus(); }));
}
function updateInspectorDynamic(a) {
  if (a.id !== detailId) return;
  if (a.slashCommands) slashList = a.slashCommands;
  $("i-stop").classList.toggle("hidden", !a.busy);
  $("i-busy").classList.toggle("hidden", !a.busy);
  $("i-live").style.display = a.busy ? "" : "none";
  renderMeta(a);
  const sg = $("i-suggest");
  const ssig = a.suggestion && !a.busy ? a.suggestion : "";
  if (updateInspectorDynamic._ssig !== ssig) {
    updateInspectorDynamic._ssig = ssig;
    if (ssig) {
      sg.classList.remove("hidden");
      sg.innerHTML = `<span class="sg-l">💡 suite</span><button class="sg-chip" type="button"></button>`;
      const chip = sg.querySelector(".sg-chip"); chip.textContent = ssig;
      chip.onclick = () => { const i = $("i-input"); i.value = ssig; i.focus(); i.dispatchEvent(new Event("input")); };
    } else { sg.classList.add("hidden"); sg.innerHTML = ""; }
  }
}

// ---- déploiement --------------------------------------------------------------
let spawnHost = "local";
async function openSpawn() {
  $("backdrop").classList.remove("hidden"); $("spawn").classList.remove("hidden");
  $("sp-err").textContent = "";
  attS.length = 0; renderTray($("sp-attach-list"), attS);
  const wrap = $("sp-hosts");
  wrap.innerHTML = `<div class="host-pick sel"><div class="hn"><span class="hdot"></span>local</div><div class="hi">chargement…</div></div>`;
  let hosts = [{ id: "local", label: "local", ip: "127.0.0.1", online: true }];
  try { const j = await getJSON("/api/hosts"); if (j.hosts && j.hosts.length) hosts = j.hosts; } catch {}
  spawnHost = "local";
  wrap.innerHTML = hosts.map((h) => `<button type="button" class="host-pick ${h.id === "local" ? "sel" : ""}" data-host="${esc(h.id)}" ${h.online ? "" : "disabled style='opacity:.45'"}>
      <div class="hn"><span class="hdot ${h.online ? "" : "off"}"></span>${esc(h.label)}</div>
      <div class="hi">${esc(h.ip || "")}${h.id === "local" ? "" : (h.online ? " · ssh" : " · hors-ligne")}</div>
    </button>`).join("");
  wrap.querySelectorAll(".host-pick").forEach((b) => (b.onclick = () => {
    if (b.disabled) return;
    wrap.querySelectorAll(".host-pick").forEach((x) => x.classList.remove("sel"));
    b.classList.add("sel"); spawnHost = b.dataset.host;
    $("sp-cwd-hint").textContent = spawnHost === "local" ? "" : "(sur " + spawnHost + ")";
  }));
}
async function doSpawn() {
  const body = {
    host: spawnHost,
    name: $("sp-name").value.trim(),
    role: $("sp-role").value.trim(),
    cwd: $("sp-cwd").value.trim(),
    prompt: $("sp-prompt").value.trim(),
    model: $("sp-model").value,
    perm: $("sp-perm").value,
    attachments: readyIds(attS),
  };
  if (!body.cwd || !body.prompt) { $("sp-err").textContent = "Workspace et mission requis."; return; }
  if (attS.some((a) => a.pending)) { $("sp-err").textContent = "Upload de pièce jointe en cours…"; return; }
  $("sp-go").disabled = true; $("sp-err").textContent = "";
  const j = await post("/api/spawn", body);
  $("sp-go").disabled = false;
  if (!j.ok) { $("sp-err").textContent = j.error || "échec du lancement"; return; }
  attS.length = 0; renderTray($("sp-attach-list"), attS);
  closeModal("spawn");
  toast("🚀 agent déployé" + (spawnHost !== "local" ? " sur " + spawnHost : ""));
  $("sp-name").value = $("sp-role").value = $("sp-cwd").value = $("sp-prompt").value = "";
}

// ---- équipes ------------------------------------------------------------------
let rolesCache = ["Architecte", "Backend", "Frontend", "DevOps", "QA"];
const DEFAULT_CHECKED = new Set(["Architecte", "Backend", "Frontend"]);
function renderRoles(checkedSet) {
  const box = $("tm-roles"); if (!box) return;
  box.innerHTML = rolesCache.map((r) => {
    const on = checkedSet ? checkedSet.has(r) : DEFAULT_CHECKED.has(r);
    return `<label><input type="checkbox" value="${esc(r)}" ${on ? "checked" : ""}/> ${esc(r)}</label>`;
  }).join("");
  box.querySelectorAll("input").forEach((c) => (c.onchange = populateChief));
}
async function loadRoles(checkedSet) {
  try { const j = await getJSON("/api/roles"); if (j.roles && j.roles.length) rolesCache = j.roles; } catch {}
  renderRoles(checkedSet); populateChief();
}
function checkedRoles() { return [...$("tm-roles").querySelectorAll("input:checked")].map((c) => c.value); }
function populateChief() {
  const sel = $("tm-chief"); if (!sel) return;
  const prev = sel.value, roles = checkedRoles();
  const agents = (snap.agents || []).filter((a) => a.managed);
  let html = `<optgroup label="Nouveau rôle (créé)">` + (roles.length ? roles.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join("") : `<option value="">(coche un rôle)</option>`) + `</optgroup>`;
  if (agents.length) html += `<optgroup label="Agent existant">` + agents.map((a) => `<option value="agent:${a.id}">${esc(a.name)} · ${esc(a.role)}</option>`).join("") + `</optgroup>`;
  sel.innerHTML = html;
  if (prev) sel.value = prev;
}
async function addRole() {
  const inp = $("tm-newrole"), v = inp.value.trim();
  if (!v) return;
  const checked = new Set(checkedRoles()); checked.add(v);
  const j = await post("/api/roles", { role: v });
  if (!j.ok) return toast("Erreur : " + (j.error || "ajout métier"));
  rolesCache = j.roles || rolesCache; inp.value = "";
  renderRoles(checked); populateChief();
  toast("✅ métier ajouté : " + v);
}
function openTeam() {
  $("backdrop").classList.remove("hidden"); $("team").classList.remove("hidden");
  $("tm-err").textContent = "";
  loadRoles();
}
async function doTeam() {
  const roles = checkedRoles();
  const body = { name: $("tm-name").value.trim(), goal: $("tm-goal").value.trim(), cwd: $("tm-cwd").value.trim(), model: $("tm-model").value, perm: $("tm-perm").value, roles, chief: $("tm-chief").value };
  if (!body.cwd || !body.goal) { $("tm-err").textContent = "Objectif et workspace requis."; return; }
  if (!roles.length) { $("tm-err").textContent = "Choisis au moins un rôle."; return; }
  $("tm-go").disabled = true; $("tm-err").textContent = "";
  const j = await post("/api/team", body);
  $("tm-go").disabled = false;
  if (!j.ok) { $("tm-err").textContent = j.error || "échec du lancement"; return; }
  closeModal("team");
  toast("🚀 équipe « " + (body.name || "sans nom") + " » lancée");
  $("tm-name").value = $("tm-goal").value = $("tm-cwd").value = "";
}
function renderTeams() {
  const el = $("teams"); if (!el) return;
  const teams = snap.teams || [];
  const html = teams.map((t) => {
    const label = esc(t.name || t.goal || ("Équipe " + t.id));
    const n = (t.members || []).length;
    const chief = t.chiefId ? `<button class="t-chief" data-chief="${esc(t.chiefId)}" title="parler au chef">💬 chef</button>` : "";
    return `<div class="team-chip"><span class="t-nm">👥 ${label}</span><span class="t-n">${n} agent${n > 1 ? "s" : ""}</span>${chief}<button class="t-x" data-team="${esc(t.id)}" title="dissoudre">✖</button></div>`;
  }).join("");
  if (renderTeams._html === html) return;
  renderTeams._html = html; el.innerHTML = html;
  el.querySelectorAll(".t-x").forEach((b) => (b.onclick = async () => { if (!confirm("Dissoudre cette équipe (fermer tous ses membres) ?")) return; await post("/api/team-kill", { teamId: b.dataset.team }); }));
  el.querySelectorAll(".t-chief").forEach((b) => (b.onclick = () => openInspector(b.dataset.chief)));
}

// ---- utilitaires --------------------------------------------------------------
function closeModal(id) { $(id).classList.add("hidden"); $("backdrop").classList.add("hidden"); }
let toastT = null;
function toast(msg) { const t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2600); }

// ---- pièces jointes (upload → orchestrateur, livré sur la machine de l'agent) --
const attP = [];  // pièces jointes du message (inspecteur)
const attS = [];  // pièces jointes du déploiement
function fmtSize(n) { n = n || 0; return n >= 1048576 ? (n / 1048576).toFixed(1) + " Mo" : n >= 1024 ? Math.round(n / 1024) + " Ko" : n + " o"; }
function readyIds(arr) { return arr.filter((a) => a.uploadId).map((a) => a.uploadId); }
function renderTray(listEl, arr) {
  if (!listEl) return;
  listEl.classList.toggle("hidden", arr.length === 0);
  listEl.innerHTML = arr.map((a, i) => `<span class="fchip ${a.pending ? "pending" : ""}"><span>${a.pending ? "⏳" : "📎"}</span><span class="nm">${esc(a.name)}</span><small>${a.size != null ? fmtSize(a.size) : ""}</small><button class="fx" data-rm="${i}" title="retirer">✕</button></span>`).join("");
  listEl.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); arr.splice(+b.dataset.rm, 1); renderTray(listEl, arr); }));
}
async function uploadOne(file, arr, listEl) {
  const item = { name: file.name, size: file.size, pending: true, uploadId: null };
  arr.push(item); renderTray(listEl, arr);
  try {
    const r = await fetch("/api/upload", { method: "POST", headers: { "X-Filename": encodeURIComponent(file.name) }, body: file });
    const j = await r.json();
    if (j.ok) { item.uploadId = j.uploadId; item.pending = false; item.size = j.size; }
    else { toast("Upload échoué : " + (j.error || file.name)); arr.splice(arr.indexOf(item), 1); }
  } catch { toast("Upload échoué : " + file.name); const k = arr.indexOf(item); if (k >= 0) arr.splice(k, 1); }
  renderTray(listEl, arr);
}
function addFiles(files, arr, listEl) { [...files].forEach((f) => uploadOne(f, arr, listEl)); }
// drag-drop générique sur un élément → tray donné
function wireDrop(zoneEl, arr, listEl, dragClass) {
  if (!zoneEl) return;
  zoneEl.addEventListener("dragover", (e) => { e.preventDefault(); zoneEl.classList.add(dragClass || "drag"); });
  zoneEl.addEventListener("dragleave", (e) => { if (e.target === zoneEl) zoneEl.classList.remove(dragClass || "drag"); });
  zoneEl.addEventListener("drop", (e) => { e.preventDefault(); zoneEl.classList.remove(dragClass || "drag"); if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files, arr, listEl); });
}

// ---- câblage ------------------------------------------------------------------
$("deploy-btn").onclick = openSpawn;
$("sp-go").onclick = doSpawn;
$("team-btn").onclick = openTeam;
$("tm-go").onclick = doTeam;
$("tm-addrole").onclick = addRole;
$("tm-newrole").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); addRole(); } };
document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => { b.dataset.close === "inspector" ? closeInspector() : closeModal(b.dataset.close); }));
$("backdrop").onclick = () => { closeModal("spawn"); closeModal("team"); };
$("q").oninput = (e) => { query = e.target.value.trim().toLowerCase(); renderRoster(); };
$("filters").querySelectorAll(".chip").forEach((b) => (b.onclick = () => {
  $("filters").querySelectorAll(".chip").forEach((x) => x.classList.remove("sel"));
  b.classList.add("sel"); filter = b.dataset.f; renderRoster();
}));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { if (!$("spawn").classList.contains("hidden")) closeModal("spawn"); else if (!$("team").classList.contains("hidden")) closeModal("team"); else if (!$("inspector").classList.contains("hidden")) closeInspector(); }
  if (e.key === "/" && document.activeElement.tagName !== "INPUT" && document.activeElement.tagName !== "TEXTAREA") { e.preventDefault(); $("q").focus(); }
});

// pièces jointes — inspecteur (message)
$("i-clip").onclick = () => $("i-file").click();
$("i-file").onchange = (e) => { addFiles(e.target.files, attP, $("i-attach")); e.target.value = ""; };
wireDrop($("inspector"), attP, $("i-attach"), "drag");
$("i-input").addEventListener("paste", (e) => {
  const files = [...(e.clipboardData?.items || [])].filter((it) => it.kind === "file").map((it) => it.getAsFile()).filter(Boolean);
  if (files.length) { e.preventDefault(); addFiles(files, attP, $("i-attach")); }
});
// pièces jointes — déploiement
$("sp-clip").onclick = () => $("sp-file").click();
$("sp-file").onchange = (e) => { addFiles(e.target.files, attS, $("sp-attach-list")); e.target.value = ""; };
wireDrop($("sp-attach"), attS, $("sp-attach-list"), "drag");

// ---- boot ---------------------------------------------------------------------
renderStats(); renderTeams(); renderRoster(); connect();
