"use strict";
/* FLEETCTRL — pilotage mobile de la flotte d'agents Claude Code (via l'orchestrateur). */

// ---- liaison à l'orchestrateur -------------------------------------------------
// '' = même origine (app servie par son proxy). Sinon URL Tailscale réglée dans l'app (APK).
let ORCH = localStorage.getItem("fc_orch") || "";
const api = (p) => ORCH + p;
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

// ---- connexion temps réel (SSE, avec reconnexion) ------------------------------
let es = null;
function connect() {
  if (es) try { es.close(); } catch {}
  setNet(false, "connexion…");
  try { es = new EventSource(api("/events")); } catch { return scheduleReconnect(); }
  es.addEventListener("snapshot", (e) => {
    setNet(true, "en direct"); everConnected = true;
    try { snap = JSON.parse(e.data); } catch { return; }
    renderStats(); renderTeams(); renderRoster();
    if (detailId) { const a = snap.agents.find((x) => x.id === detailId); if (a) updateDetailDynamic(a); }
  });
  es.onerror = () => { setNet(false, "hors-ligne"); scheduleReconnect(); };
}
let reconnectT = null;
function scheduleReconnect() { clearTimeout(reconnectT); reconnectT = setTimeout(connect, 2500); }
function setNet(live, label) { const n = $("net"); n.classList.toggle("live", live); $("net-label").textContent = label; }

// ---- stats ---------------------------------------------------------------------
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
  if (renderStats._sig === sig) return; // pas de changement -> pas de repaint (anti-clignotement)
  renderStats._sig = sig;
  $("stats").innerHTML = cards.map(([cl, v, l]) => `<div class="stat ${cl}"><div class="stat-v">${esc(v)}</div><div class="stat-l">${esc(l)}</div></div>`).join("");
}

// ---- roster --------------------------------------------------------------------
const cardEls = new Map(); // id -> élément carte (mise à jour incrémentale = zéro clignotement)
function renderRoster() {
  const a = snap.agents || [];
  const el = $("roster");
  if (!a.length) {
    cardEls.clear();
    el.innerHTML = `<div class="empty"><span class="big">🛰️</span>Aucun agent en vol.<br>Touche <b style="color:var(--cyan)">+</b> pour en déployer un — ici ou sur ton réseau.</div>`;
    return;
  }
  if (el.firstElementChild && el.firstElementChild.classList.contains("empty")) el.innerHTML = "";
  const seen = new Set();
  for (const x of a) {
    seen.add(x.id);
    let c = cardEls.get(x.id);
    if (!c) { c = document.createElement("div"); c.className = "card"; c.dataset.id = x.id; c.onclick = () => openDetail(x.id); el.appendChild(c); cardEls.set(x.id, c); }
    updateCard(c, x);
  }
  for (const [id, c] of cardEls) if (!seen.has(id)) { c.remove(); cardEls.delete(id); }
}
function updateCard(c, x) {
  const sig = [x.name, x.role, x.project, x.status, x.busy, x.host, x.room].join("|");
  if (c._sig === sig) return; // rien de visible n'a changé -> on ne touche pas au DOM
  c._sig = sig;
  const s = st(x), col = hashc(x.role + x.name);
  c.style.setProperty("--st", s.c);
  const host = x.host ? `<span class="badge b-host">📍 ${esc(x.host)}</span>` : "";
  const busy = x.busy ? `<span class="spin-busy"></span>` : `<span class="room">${ROOM[x.room] || ""}</span>`;
  c.innerHTML = `<div class="av" style="--av:${col};background:${col}">${esc((x.name || "?")[0].toUpperCase())}</div>
    <div class="card-main">
      <div class="card-nm">${esc(x.name)} ${host}</div>
      <div class="card-ro">${esc(x.role || "")}${x.project ? " · " + esc(x.project) : ""}</div>
    </div>
    <div class="card-st"><span class="pill" style="--st:${s.c}">${s.e} ${esc(s.l)}</span>${busy}</div>`;
}

// ---- détail / pilotage ---------------------------------------------------------
function openDetail(id) {
  const a = snap.agents.find((x) => x.id === id); if (!a) return;
  detailId = id;
  renderMeta._html = updateDetailDynamic._ssig = pollFeed._html = null; // reset des gardes (nouvel agent)
  slashList = a.slashCommands || [];
  const s = st(a);
  $("d-name").textContent = a.name;
  $("d-sub").innerHTML = `${s.e} ${esc(s.l)} · ${ROOM[a.room] || ""} ${esc(a.room || "")}`;
  renderMeta(a);
  $("d-feed").innerHTML = `<div class="fe think">chargement…</div>`;
  $("d-input").value = "";
  mAttD.length = 0; mRenderTray($("d-attach"), mAttD);
  $("d-perm").innerHTML = permNote(a);
  wirePilot(a);
  updateDetailDynamic(a);
  openSheet("detail");
  clearInterval(feedTimer); pollFeed(); feedTimer = setInterval(pollFeed, 1500);
}
function renderMeta(a) {
  const chips = [
    a.host ? ["📍 machine", a.host] : ["📍 machine", "local"],
    ["modèle", a.model || "—"],
    ["coût", fmtCost(a.costUsd)],
    a.tokens ? ["tokens", fmtTok(a.tokens)] : null,
    a.branch ? ["git", a.branch] : null,
    a.cwd ? ["cwd", a.cwd] : null,
  ].filter(Boolean);
  const html = chips.map(([k, v]) => `<span class="meta-chip">${esc(k)} <b>${esc(v)}</b></span>`).join("");
  if (renderMeta._html === html) return;
  renderMeta._html = html;
  $("d-meta").innerHTML = html;
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
    const j = await getJSON("/api/transcript?id=" + encodeURIComponent(detailId) + "&n=60");
    const el = $("d-feed"); if (!el) return;
    const KIND = { say: "🤖", think: "💭", tool: "⚙", result: "↳", prompt: "🧑" };
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    const html = (j.feed || []).map((e) => `<div class="fe ${e.kind}">${KIND[e.kind] || ""} ${esc(e.text)}</div>`).join("") || `<div class="fe think">en attente d'activité…</div>`;
    if (pollFeed._html === html) return; // contenu identique -> pas de re-render
    pollFeed._html = html; el.innerHTML = html;
    if (near) el.scrollTop = el.scrollHeight;
  } catch {}
}
function wirePilot(a) {
  const input = $("d-input"), slash = $("d-slash");
  const send = async () => {
    const prompt = input.value.trim(); const files = mReadyIds(mAttD);
    if (!prompt && !files.length) return;
    if (mAttD.some((x) => x.pending)) return toast("Upload en cours…");
    slash.classList.add("hidden");
    const j = await post("/api/send", { id: a.id, prompt, attachments: files, origin: "mobile" });
    if (!j.ok) return toast("Erreur : " + (j.error || "échec"));
    input.value = ""; input.style.height = "auto"; mAttD.length = 0; mRenderTray($("d-attach"), mAttD);
  };
  $("d-send").onclick = send;
  input.oninput = () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 120) + "px"; renderSlash(input, slash); };
  input.onblur = () => setTimeout(() => slash.classList.add("hidden"), 180);
  $("d-stop").onclick = () => post("/api/stop", { id: a.id });
  $("d-train").onclick = async () => { const j = await post("/api/train", { id: a.id }); toast(j.ok ? "🏋️ direction le gym" : "Erreur : " + (j.error || "")); };
  $("d-kill").onclick = async () => { if (!confirm("Fermer/tuer la session de « " + a.name + " » ?")) return; await post("/api/kill", { id: a.id }); closeSheet("detail"); detailId = null; clearInterval(feedTimer); };
}
function renderSlash(input, dd) {
  const m = input.value.match(/^\/(\S*)$/);
  if (!m) return dd.classList.add("hidden");
  const q = m[1].toLowerCase();
  const matches = (slashList || []).filter((c) => c.toLowerCase().includes(q)).slice(0, 10);
  if (!matches.length) return dd.classList.add("hidden");
  dd.innerHTML = matches.map((c) => `<div class="slash-item">/${esc(c)}</div>`).join("");
  dd.classList.remove("hidden");
  [...dd.children].forEach((el, i) => (el.onmousedown = el.ontouchstart = (e) => { e.preventDefault(); input.value = "/" + matches[i] + " "; dd.classList.add("hidden"); input.focus(); }));
}
function updateDetailDynamic(a) {
  if (a.id !== detailId) return;
  if (a.slashCommands) slashList = a.slashCommands;
  $("d-stop").classList.toggle("hidden", !a.busy);
  $("d-busy").classList.toggle("hidden", !a.busy);
  $("d-live").style.display = a.busy ? "" : "none";
  renderMeta(a);
  const sg = $("d-suggest");
  const ssig = a.suggestion && !a.busy ? a.suggestion : "";
  if (updateDetailDynamic._ssig !== ssig) {
    updateDetailDynamic._ssig = ssig;
    if (ssig) {
      sg.classList.remove("hidden");
      sg.innerHTML = `<span class="sg-l">💡 suite</span><button class="sg-chip" type="button"></button>`;
      const chip = sg.querySelector(".sg-chip"); chip.textContent = ssig;
      chip.onclick = () => { const i = $("d-input"); i.value = ssig; i.focus(); i.dispatchEvent(new Event("input")); };
    } else { sg.classList.add("hidden"); sg.innerHTML = ""; }
  }
}

// ---- déploiement ---------------------------------------------------------------
let spawnHost = "local";
async function openSpawn() {
  openSheet("spawn");
  $("sp-err").textContent = "";
  mAttS.length = 0; mRenderTray($("sp-attach-list"), mAttS);
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
    attachments: mReadyIds(mAttS),
  };
  if (!body.cwd || !body.prompt) { $("sp-err").textContent = "Workspace et mission requis."; return; }
  if (mAttS.some((x) => x.pending)) { $("sp-err").textContent = "Upload de pièce jointe en cours…"; return; }
  $("sp-go").disabled = true; $("sp-err").textContent = "";
  const j = await post("/api/spawn", body);
  $("sp-go").disabled = false;
  if (!j.ok) { $("sp-err").textContent = j.error || "échec du lancement"; return; }
  mAttS.length = 0; mRenderTray($("sp-attach-list"), mAttS);
  closeSheet("spawn");
  toast("🚀 agent déployé" + (spawnHost !== "local" ? " sur " + spawnHost : ""));
  $("sp-name").value = $("sp-role").value = $("sp-cwd").value = $("sp-prompt").value = "";
}

// ---- équipes -------------------------------------------------------------------
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
function openTeam() { openSheet("team"); $("tm-err").textContent = ""; loadRoles(); }
async function doTeam() {
  const roles = checkedRoles();
  const body = { name: $("tm-name").value.trim(), goal: $("tm-goal").value.trim(), cwd: $("tm-cwd").value.trim(), model: $("tm-model").value, perm: $("tm-perm").value, roles, chief: $("tm-chief").value };
  if (!body.cwd || !body.goal) { $("tm-err").textContent = "Objectif et workspace requis."; return; }
  if (!roles.length) { $("tm-err").textContent = "Choisis au moins un rôle."; return; }
  $("tm-go").disabled = true; $("tm-err").textContent = "";
  const j = await post("/api/team", body);
  $("tm-go").disabled = false;
  if (!j.ok) { $("tm-err").textContent = j.error || "échec du lancement"; return; }
  closeSheet("team");
  toast("🚀 équipe « " + (body.name || "sans nom") + " » lancée");
  $("tm-name").value = $("tm-goal").value = $("tm-cwd").value = "";
}
function renderTeams() {
  const el = $("teams"); if (!el) return;
  const teams = snap.teams || [];
  const html = teams.map((t) => {
    const label = esc(t.name || t.goal || ("Équipe " + t.id));
    const n = (t.members || []).length;
    const chief = t.chiefId ? `<button class="t-chief" data-chief="${esc(t.chiefId)}">💬 chef</button>` : "";
    return `<div class="team-chip"><span class="t-nm">👥 ${label}</span><span class="t-n">${n} agent${n > 1 ? "s" : ""}</span>${chief}<button class="t-x" data-team="${esc(t.id)}" aria-label="dissoudre">✖</button></div>`;
  }).join("");
  if (renderTeams._html === html) return;
  renderTeams._html = html; el.innerHTML = html;
  el.querySelectorAll(".t-x").forEach((b) => (b.onclick = async () => { if (!confirm("Dissoudre cette équipe (fermer tous ses membres) ?")) return; await post("/api/team-kill", { teamId: b.dataset.team }); }));
  el.querySelectorAll(".t-chief").forEach((b) => (b.onclick = () => openDetail(b.dataset.chief)));
}

// ---- réglages ------------------------------------------------------------------
function openSettings() {
  $("st-url").value = ORCH;
  $("st-state").textContent = "";
  openSheet("settings");
}
async function testConn() {
  const url = $("st-url").value.trim().replace(/\/$/, "");
  const s = $("st-state"); s.className = "st-state"; s.textContent = "test en cours…";
  try {
    const r = await fetch((url || "") + "/api/agents", { cache: "no-store" });
    const j = await r.json();
    s.className = "st-state ok"; s.textContent = "✓ connecté — " + (j.agents ? j.agents.length : 0) + " agent(s)";
  } catch (e) { s.className = "st-state ko"; s.textContent = "✗ injoignable — " + (e.message || e); }
}
function saveSettings() {
  ORCH = $("st-url").value.trim().replace(/\/$/, "");
  localStorage.setItem("fc_orch", ORCH);
  closeSheet("settings"); toast("Réglages enregistrés"); connect();
}

// ---- feuilles / utilitaires ----------------------------------------------------
function openSheet(id) { $("backdrop").classList.remove("hidden"); $(id).classList.remove("hidden"); }
function closeSheet(id) { $(id).classList.add("hidden"); if (![...document.querySelectorAll(".sheet")].some((s) => !s.classList.contains("hidden"))) $("backdrop").classList.add("hidden"); if (id === "detail") { detailId = null; clearInterval(feedTimer); } }
let toastT = null;
function toast(msg) { const t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2600); }

// ---- pièces jointes (upload → orchestrateur → machine de l'agent) --------------
const mAttD = [];  // pièces jointes du message
const mAttS = [];  // pièces jointes du déploiement
function mFmtSize(n) { n = n || 0; return n >= 1048576 ? (n / 1048576).toFixed(1) + " Mo" : n >= 1024 ? Math.round(n / 1024) + " Ko" : n + " o"; }
function mReadyIds(arr) { return arr.filter((a) => a.uploadId).map((a) => a.uploadId); }
function mRenderTray(listEl, arr) {
  if (!listEl) return;
  listEl.classList.toggle("hidden", arr.length === 0);
  listEl.innerHTML = arr.map((a, i) => `<span class="fchip ${a.pending ? "pending" : ""}"><span>${a.pending ? "⏳" : "📎"}</span><span class="nm">${esc(a.name)}</span><small>${a.size != null ? mFmtSize(a.size) : ""}</small><button class="fx" data-rm="${i}">✕</button></span>`).join("");
  listEl.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); arr.splice(+b.dataset.rm, 1); mRenderTray(listEl, arr); }));
}
async function mUploadOne(file, arr, listEl) {
  const item = { name: file.name, size: file.size, pending: true, uploadId: null };
  arr.push(item); mRenderTray(listEl, arr);
  try {
    const r = await fetch(api("/api/upload"), { method: "POST", headers: { "X-Filename": encodeURIComponent(file.name) }, body: file });
    const j = await r.json();
    if (j.ok) { item.uploadId = j.uploadId; item.pending = false; item.size = j.size; }
    else { toast("Upload échoué"); const k = arr.indexOf(item); if (k >= 0) arr.splice(k, 1); }
  } catch { toast("Upload échoué"); const k = arr.indexOf(item); if (k >= 0) arr.splice(k, 1); }
  mRenderTray(listEl, arr);
}
function mAddFiles(files, arr, listEl) { [...files].forEach((f) => mUploadOne(f, arr, listEl)); }

document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => closeSheet(b.dataset.close)));
$("backdrop").onclick = () => document.querySelectorAll(".sheet").forEach((s) => closeSheet(s.id));
$("fab").onclick = openSpawn;
$("set-btn").onclick = openSettings;
$("net").onclick = openSettings;
$("sp-go").onclick = doSpawn;
$("team-btn").onclick = openTeam;
$("tm-go").onclick = doTeam;
$("tm-addrole").onclick = addRole;
$("tm-newrole").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addRole(); } });
// pièces jointes : message (détail) + déploiement (spawn)
$("d-clip").onclick = () => $("d-file").click();
$("d-file").onchange = (e) => { mAddFiles(e.target.files, mAttD, $("d-attach")); e.target.value = ""; };
$("d-input").addEventListener("paste", (e) => {
  const files = [...(e.clipboardData?.items || [])].filter((it) => it.kind === "file").map((it) => it.getAsFile()).filter(Boolean);
  if (files.length) { e.preventDefault(); mAddFiles(files, mAttD, $("d-attach")); }
});
$("sp-clip").onclick = () => $("sp-file").click();
$("sp-file").onchange = (e) => { mAddFiles(e.target.files, mAttS, $("sp-attach-list")); e.target.value = ""; };
$("st-test").onclick = testConn;
$("st-save").onclick = saveSettings;

// ---- boot ----------------------------------------------------------------------
renderStats(); renderTeams(); renderRoster(); connect();
// 1er lancement (APK) sans orchestrateur joignable -> on guide vers les réglages
setTimeout(() => {
  if (!everConnected && !document.querySelector(".sheet:not(.hidden)")) {
    openSettings(); toast("Renseigne l'URL de l'orchestrateur pour démarrer ⚙");
  }
}, 4500);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
