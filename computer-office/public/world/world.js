/* Fleet Office · World — ville pixel-art (vue 3/4, tuiles 16px) : boucle, entrées, scènes, réseau, UI.
   Modules : sprites.js (dessin), town.js (extérieur), interior.js (intérieur). JS vanilla, aucune dépendance. */
(() => {
'use strict';
const FW = window.FW, Town = FW.Town, Int = FW.Interior;
const { TS, mk, R, clamp, hash, cam, INK, drawStr, strW, GEAR, bubble, drawPerson, PLAYER_LOOK } = FW;
const qs = new URLSearchParams(location.search);
const DEMO = qs.has('demo'), RUN = qs.has('run');
const SPEED_WALK = 38, SPEED_RUN = 58;   // px/s du joueur (réglage unique)
const $ = id => document.getElementById(id);
const cv = $('game'), ctx = cv.getContext('2d');
const buf = mk(8, 8), bx = buf.getContext('2d');
const lcv = mk(8, 8), lx = lcv.getContext('2d');
const dbg = $('dbg');
const MODE_FR = Int.MODE_FR;

/* ───────── chargement ───────── */
const fontFace = new FontFace('KP', 'url(assets/KenneyPixel.ttf)');
Promise.all([
  new Promise((res, rej) => { FW.sheet.complete && FW.sheet.naturalWidth ? res() : (FW.sheet.onload = res, FW.sheet.onerror = () => rej(new Error('indoor.png'))); }),
  fontFace.load().then(f => { document.fonts.add(f); }),
]).then(start).catch(e => console.warn('chargement', e && e.message));

/* ───────── état ───────── */
let scene = 'town', curHouse = null, fade = null, overlayOpen = false, banner = null, msgs = [], label = null;
const player = { x: 100, y: 100, dir: 0, t: 0, moving: false, look: PLAYER_LOOK, sy: 0, kind: 'player' };
player.draw = (b) => drawPerson(b, player);
const agentsById = new Map();
const stats = { net: '-', fps: 0, world: '-' };
const curNpcs = () => scene === 'interior' ? Int.npcs : [];
const curInteract = () => scene === 'interior' ? Int.interact : [];
const isBlockedT = (tx, ty) => scene === 'interior' ? Int.isBlocked(tx, ty) : Town.blocked(tx, ty);

let COLS = 38, dlg = null, HS = 16, Z = 3, bw = 100, bh = 100, W = 100, H = 100, FS = 16, dpr = 1;
/* ───────── entrée ───────── */
const keys = new Set(), order = [];
const KMAP = { ArrowUp: 'u', KeyW: 'u', KeyZ: 'u', ArrowDown: 'd', KeyS: 'd', ArrowLeft: 'l', KeyA: 'l', KeyQ: 'l', ArrowRight: 'r', KeyD: 'r' };
const ACT = new Set(['Enter', 'Space', 'KeyE', 'KeyF', 'KeyJ']);
let actQueued = false;
function press(d) { if (dlg && menuNav(d)) return; if (!keys.has(d)) { keys.add(d); order.push(d); } }
function release(d) { keys.delete(d); const i = order.indexOf(d); if (i >= 0) order.splice(i, 1); }
addEventListener('keydown', e => {
  if (typing || panelOpen) return;
  if (DEMO && e.code === 'KeyN' && !e.repeat) { demoNew++; lastNet = 0; }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (overlayOpen) { if (e.code === 'Escape' || e.code === 'KeyB') { closeOverlay(); e.preventDefault(); } return; }
  if (e.code === 'Escape' || e.code === 'KeyB') { if (dlg) { dlg = null; e.preventDefault(); } else if (scene === 'interior' && !fade) { exitHouse(); e.preventDefault(); } return; }
  const d = KMAP[e.code]; if (d && !(e.code === 'KeyA' && false)) { press(d); e.preventDefault(); return; }
  if (ACT.has(e.code)) { if (!e.repeat) actQueued = true; e.preventDefault(); }
});
addEventListener('keyup', e => { const d = KMAP[e.code]; if (d) release(d); });
addEventListener('blur', () => { keys.clear(); order.length = 0; });
// touch
const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0 || qs.has('touch');
if (isTouch) document.body.classList.add('touch');
for (const [id, d] of [['up', 'u'], ['down', 'd'], ['left', 'l'], ['right', 'r']]) {
  const el = $(id), on = e => { e.preventDefault(); el.classList.add('on'); try { el.setPointerCapture(e.pointerId); } catch (_) { } press(d); }, off = e => { e.preventDefault(); el.classList.remove('on'); release(d); };
  el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('lostpointercapture', off);
}
{ const el = $('a'); el.addEventListener('pointerdown', e => { e.preventDefault(); el.classList.add('on'); actQueued = true; }); const off = () => el.classList.remove('on'); el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); }
cv.addEventListener('pointerdown', e => {
  if (!dlg) return;
  if (dlg.rects) { const r = cv.getBoundingClientRect(), px = (e.clientX - r.left) * W / r.width, py = (e.clientY - r.top) * H / r.height; for (const z of dlg.rects) if (px >= z.x && px <= z.x + z.w && py >= z.y && py <= z.y + z.h) dlg.sel = z.i; }
  actQueued = true; e.preventDefault();
});
/* ───────── collisions joueur ───────── */
function hitsAt(x, y) {
  const x0 = Math.floor((x - 4) / TS), x1 = Math.floor((x + 3.99) / TS), y0 = Math.floor((y - 5) / TS), y1 = Math.floor((y - .01) / TS);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (isBlockedT(tx, ty)) return true;
  if (scene === 'interior') for (const n of Int.npcs) if (Math.abs(n.x - x) < 8 && Math.abs(n.y - y) < 6) return true;
  return false;
}
function updatePlayer(dt) {
  player.moving = false;
  if (dlg || fade || overlayOpen) return;
  const d = order.length ? order[order.length - 1] : null;
  if (!d) return;
  const dx = d === 'l' ? -1 : d === 'r' ? 1 : 0, dy = d === 'u' ? -1 : d === 'd' ? 1 : 0;
  player.dir = dy > 0 ? 0 : dy < 0 ? 1 : dx < 0 ? 2 : 3;
  let left = (RUN ? SPEED_RUN : SPEED_WALK) * dt;
  while (left > 0) {
    const st = Math.min(left, 1); left -= st;
    const nx = player.x + dx * st, ny = player.y + dy * st;
    if (!hitsAt(nx, ny)) { if (nx !== player.x || ny !== player.y) player.moving = true; player.x = nx; player.y = ny; }
    else if (dx) { for (const s of [-1, 1]) if (!hitsAt(nx, ny + s * 1)) { player.y += s * .6; player.moving = true; break; } }
    else if (dy) { for (const s of [-1, 1]) if (!hitsAt(nx + s * 1, ny)) { player.x += s * .6; player.moving = true; break; } }
  }
  if (player.moving) player.t += dt;
}

const tagCache = new Map();
function tagCanvas(n) {
  const col = n.mode === 'blocked' ? '#ffd0d0' : n.mode === 'failed' ? '#ff9a9a' : n.look.crown ? '#ffe27a' : '#ffffff';
  let t = String(n.name).normalize('NFC'); if (t.length > 11) t = t.slice(0, 10) + '…';
  const key = t + col + HS; let e = tagCache.get(key); if (e) return e;
  const c0 = mk(4, 4).getContext('2d'); c0.font = HS + 'px KP'; const pu = Math.max(1, Math.round(HS / 8)), w = Math.ceil(strW(c0, t)) + 4 * pu, h = HS + 4 * pu;
  const cv2 = mk(w, h), c = cv2.getContext('2d'); c.font = HS + 'px KP';
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [1, -1], [-1, 1], [0, 2], [-1, 2], [1, 2]]) drawStr(c, t, 2 * pu + dx * pu * .75, h - 2 * pu - pu + dy * pu * .75, '#14172a');
  drawStr(c, t, 2 * pu, h - 3 * pu, col);
  tagCache.set(key, cv2); return cv2;
}

const stateLine = n => MODE_FR[n.mode] || n.mode;
function strip(t) { return String(t || '').normalize('NFC').replace(/[^\u0020-\u00FF\u2013\u2014\u2018\u2019\u201C\u201D\u2026\n\t]/gu, '').replace(/```[\s\S]*?```/g, ' [code] ').replace(/[*_`#>]+/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim(); }
function wrap(text, max) {
  const words = text.split(' '), lines = []; let cur = '';
  for (let w of words) {
    while (w.length > max) { if (cur) { lines.push(cur); cur = ''; } lines.push(w.slice(0, max)); w = w.slice(max); }
    if ((cur + ' ' + w).trim().length > max) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur); return lines;
}
function paginate(lines, per = 3) { const p = []; for (let i = 0; i < lines.length; i += per) p.push(lines.slice(i, i + per)); return p; }
function maxChars() { return clamp(Math.floor((dlgW() - 12 * dU()) / Math.max(1, charW())), 16, 38); }
let _cw = 0; function charW() { ctx.font = FS + 'px KP'; return _cw = ctx.measureText('n').width; }
const dU = () => Math.max(2, Math.round(Z * .75));
function dlgW() { return Math.min(W - 6 * dU(), Math.ceil(COLS * charW()) + 16 * dU()) - (isTouch && W > H ? 160 * dpr : 0); }
function openDialog(name, pages) { dlg = { name, pages, page: 0, chars: 0, done: false, t: 0 }; }
function talkTo(n) {
  const mc = maxChars();
  const pages = [];
  pages.push(...paginate([`Je suis ${n.name}.`, `Rôle : ${n.role}`, `Machine : ${n.host}`, `État : ${stateLine(n)}`].flatMap(s => wrap(s, mc)), 3));
  const loading = { name: n.name, pages: pages.slice(), page: 0, chars: 0, done: false, t: 0 };
  dlg = loading; loading.pending = true; loading.menu = npcMenu(n, false); loading.sel = 0;
  const finish = (say) => {
    if (dlg !== loading) return;
    const txt = strip(say);
    let more;
    if (!txt) more = paginate(wrap('Je n\'ai encore rien dit.', mc));
    else { let t = txt; let cut = false; if (t.length > 360) { t = t.slice(0, 360).replace(/\s+\S*$/, ''); cut = true; } more = paginate(wrap('« ' + t + (cut ? ' …' : '') + ' »', mc)); more.unshift(['Mes dernières paroles :']); }
    loading.pages.push(...more); loading.pending = false;
  };
  if (DEMO || n.demo) { setTimeout(() => finish(n.a && n.a.demoSay), 0); return; }
  const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 3500);
  fetch('/api/transcript?id=' + encodeURIComponent(n.id) + '&n=8', { signal: ac.signal, cache: 'no-store' }).then(r => r.json()).then(j => {
    const says = (j.feed || []).filter(f => f.kind === 'say'); finish(says.length ? says[says.length - 1].text : '');
  }).catch(() => finish('')).finally(() => clearTimeout(to));
}
let typing = null, panelOpen = false;
const sayBox = document.getElementById('say'), sayIn = document.getElementById('say-in'), panelBox = document.getElementById('panel'), panelFrame = document.getElementById('panel-f');
function menuNav(d) {
  if (!dlg || !dlg.menu || dlg.pending || dlg.wait) return false;
  const last = dlg.page === dlg.pages.length - 1, total = dlg.pages[dlg.page].join('').length; if (!(last && dlg.chars >= total)) return false;
  if (d === 'u') { dlg.sel = (dlg.sel + dlg.menu.length - 1) % dlg.menu.length; return true; }
  if (d === 'd') { dlg.sel = (dlg.sel + 1) % dlg.menu.length; return true; }
  return d === 'l' || d === 'r';
}
function npcMenu(n, replying) {
  return [
    { label: replying ? 'RÉPONDRE' : 'PARLER', act: () => askText(n) },
    { label: 'ÉVALUER', act: () => openPanel('/?view=reviews&embed=1&agent=' + encodeURIComponent(n.id), 'Arène — ' + n.name) },
    { label: 'OUVRIR', act: () => openPanel('/?embed=1&select=' + encodeURIComponent(n.id), n.name) },
    { label: 'AU REVOIR', act: () => { dlg = null; } },
  ];
}
function reopenMenu(n, line) { dlg = { name: n.name, pages: [[line || 'Que veux-tu faire ?']], page: 0, chars: 0, done: false, t: 0, menu: npcMenu(n, true), sel: 0 }; }
function askText(n) {
  dlg = null; typing = n; keys.clear(); order.length = 0; document.body.classList.add('typing');
  document.getElementById('say-name').textContent = n.name; sayBox.style.display = 'flex'; sayIn.value = ''; sayIn.placeholder = 'Dis quelque chose à ' + n.name + '…';
  setTimeout(() => sayIn.focus(), 30);
}
function closeAsk(back) { if (!typing) return; const n = typing; typing = null; sayBox.style.display = 'none'; document.body.classList.remove('typing'); sayIn.blur(); if (back) reopenMenu(n); }
function sendAsk() { const t = sayIn.value.trim(); if (!t || !typing) return; const n = typing; closeAsk(false); converse(n, t); }
sayIn.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); sendAsk(); } else if (e.key === 'Escape') { e.preventDefault(); closeAsk(true); } });
document.getElementById('say-go').addEventListener('click', sendAsk);
document.getElementById('say-x').addEventListener('click', () => closeAsk(true));
function openPanel(url, title) { dlg = null; panelOpen = true; keys.clear(); order.length = 0; document.getElementById('panel-title').textContent = title || ''; panelFrame.src = url; panelBox.style.display = 'flex'; }
function closePanel() { panelOpen = false; panelBox.style.display = 'none'; panelFrame.src = 'about:blank'; }
document.getElementById('panel-x').addEventListener('click', closePanel);
addEventListener('keydown', e => { if (panelOpen && e.key === 'Escape') closePanel(); });
async function fetchFeed(id) {
  const ac = new AbortController(), to = setTimeout(() => ac.abort(), 5000);
  try { const r = await fetch('/api/transcript?id=' + encodeURIComponent(id) + '&n=40', { signal: ac.signal, cache: 'no-store' }); return (await r.json()).feed || []; } catch { return null; } finally { clearTimeout(to); }
}
function showReply(n, text, notice) {
  const mc = maxChars(), txt = strip(text); let t = txt, cut = false;
  if (t.length > 720) { t = t.slice(0, 720).replace(/\s+\S*$/, ''); cut = true; }
  const pages = paginate(wrap((notice ? '' : '« ') + t + (cut ? ' …' : '') + (notice ? '' : ' »'), mc), 3);
  if (cut) pages.push(['(Réponse longue : choisis OUVRIR', 'pour la lire en entier.)']);
  dlg = { name: n.name, pages: pages.length ? pages : [['…']], page: 0, chars: 0, done: false, t: 0, menu: npcMenu(n, true), sel: 0 };
}
async function converse(n, text) {
  const mine = { name: n.name, pages: [[n.name + ' réfléchit', '(A : le laisser travailler)']], page: 0, chars: 0, done: false, t: 0, wait: true, pending: true, dots: true };
  dlg = mine; let cancelled = false; mine.cancel = () => { cancelled = true; };
  if (DEMO || n.demo) { setTimeout(() => { if (!cancelled && dlg === mine) showReply(n, '(démo) Bien reçu : « ' + text + ' ». Je m\'y mets tout de suite !'); }, 1400); return; }
  let r; try { r = await fetch('/api/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: n.id, prompt: text, origin: 'world' }) }).then(x => x.json()); } catch { r = { ok: false }; }
  if (!r || !r.ok) { if (dlg === mine) showReply(n, 'Je n\'ai pas pu recevoir ton message (' + ((r && r.error) || 'réseau') + ').', true); return; }
  const key = text.slice(0, 40), t0 = performance.now();
  while (!cancelled && dlg === mine && performance.now() - t0 < 150000) {
    await new Promise(res => setTimeout(res, 1600));
    if (cancelled || dlg !== mine) return;
    const feed = await fetchFeed(n.id); if (!feed) continue;
    let idx = -1; for (let i = feed.length - 1; i >= 0; i--) if (feed[i].kind === 'prompt' && feed[i].text.includes(key)) { idx = i; break; }
    if (idx < 0) continue;
    const says = feed.slice(idx + 1).filter(f => f.kind === 'say'), busy = n.mode === 'work';
    if (says.length && !busy) { showReply(n, says[says.length - 1].text); return; }   // dernière parole = la réponse (les précédentes = narration de travail)
  }
  if (!cancelled && dlg === mine) showReply(n, 'Je n\'ai pas encore fini… reviens me voir dans un moment, ou choisis OUVRIR pour suivre mon travail.', true);
}
function plural(n, s) { return n + ' ' + s + (n > 1 ? 's' : ''); }
function doAction() {
  if (dlg) {
    if (typing || panelOpen) return;
    const page = dlg.pages[dlg.page], total = page.join('').length;
    if (dlg.chars < total) { dlg.chars = total; return; }
    if (dlg.page < dlg.pages.length - 1) { dlg.page++; dlg.chars = 0; return; }
    if (dlg.wait) { if (dlg.t > 1.2) { if (dlg.cancel) dlg.cancel(); dlg = null; } return; }
    if (dlg.pending) return;
    if (dlg.menu) { dlg.menu[dlg.sel].act(); return; }
    dlg = null; return;
  }
  if (fade || overlayOpen || typing || panelOpen) return;
  const mc = maxChars();
  if (scene === 'town') {
    const nh = Town.nearHouse(player); if (!nh) return;
    let lines;
    if (nh.house) { const h = nh.house; lines = [`Projet : ${h.name}`, `Quartier : ${h.district}`, `${plural(h.agentIds.length, 'agent')} : ${h.working} au travail, ${h.blocked} en attente, ${h.failed} en échec.`, 'Entre par la porte pour les voir.']; }
    else if (nh.district) { const n = (Town.data.houses || []).filter(h => h.district === nh.district.name).length; lines = [`Quartier : ${nh.district.name}`, `${plural(n, 'maison')} dans ce quartier.`]; }
    else lines = nh.building === 'academy' ? ['L\'Académie : les métiers et les skills des agents.', 'Entre par la grande porte.'] : ['L\'Arène : les évaluations des agents.', 'Entre par la grande porte.'];
    openDialog('', paginate(lines.flatMap(s => wrap(s, mc)), 3)); return;
  }
  const d = player.dir, px = player.x + (d === 2 ? -10 : d === 3 ? 10 : 0), py = player.y + (d === 0 ? 9 : d === 1 ? -13 : -4);
  let best = null, bd = 1e9;
  for (const n of Int.npcs) { const ox = Math.abs(px - n.x), oy = Math.abs(py - (n.y - 5)); if (ox <= 10 && oy <= 11 && ox + oy < bd) { bd = ox + oy; best = n; } }
  if (best) { best.dir = d === 0 ? 1 : d === 1 ? 0 : d === 2 ? 3 : 2; if (best.seated) best.dir = 0; talkTo(best); return; }
  for (const z of Int.interact) {
    if (px >= z.x - 2 && px <= z.x + z.w + 2 && py >= z.y - 2 && py <= z.y + z.h + 2) {
      const t = z.say(); if (!t) continue;
      openDialog('', paginate(t.flatMap(s => wrap(s, mc)), 3)); return;
    }
  }
}

/* ───────── scènes ───────── */
function startFade(cb) { if (fade) return; fade = { t: 0, phase: 0, cb }; }
function agentsOf(h) { return (h.agentIds || []).map(id => agentsById.get(id)).filter(Boolean); }
function enterHouse(h) {
  startFade(() => {
    scene = 'interior'; curHouse = h; const ags = agentsOf(h);
    Int.build(h, Math.max(ags.length, h.agentIds.length)); Int.sync(ags);
    player.x = Int.spawn.x; player.y = Int.spawn.y; player.dir = 1; order.length = 0; keys.clear();
    frame.cx = undefined; setBanner(h.name, h.district);
  });
}
function exitHouse() {
  startFade(() => {
    const h = curHouse, p = h ? Town.spawnPos(h) : Town.plazaSpawn();
    scene = 'town'; curHouse = null; player.x = p.x; player.y = p.y; player.dir = 0; order.length = 0; keys.clear(); frame.cx = undefined; banner = null; dlg = null;
  });
}
function openOverlay(kind) {
  const url = kind === 'academy' ? '/?view=jobs&embed=1' : '/?view=reviews&embed=1';
  $('ovt').textContent = kind === 'academy' ? 'ACADÉMIE - métiers & skills' : 'ARÈNE - évaluations';
  const f = $('ovi'); f.onerror = () => { }; f.src = url; $('ov').hidden = false; $('ov').className = kind;
  overlayOpen = true; order.length = 0; keys.clear();
}
function closeOverlay() { $('ov').hidden = true; try { $('ovi').src = 'about:blank'; } catch (_) { } overlayOpen = false; order.length = 0; keys.clear(); fadeOutPush = true; }
let fadeOutPush = false;
$('ovx').addEventListener('click', closeOverlay);
$('ovx').addEventListener('pointerdown', e => { e.preventDefault(); closeOverlay(); });
function setBanner(name, sub) { banner = { name, sub, t: 0 }; }
function pushMsg(text) { msgs.push({ text, t: 0 }); }
function counts() {
  if (scene === 'interior') return Int.counts();
  let w = 0, b = 0, f = 0, n = 0; const d = Town.data; if (d) for (const h of d.houses) { w += h.working | 0; b += h.blocked | 0; f += h.failed | 0; n += h.agentIds.length; }
  return [w, b, f, Math.max(0, n - w - b - f)];
}

/* ───────── réseau ───────── */
let demoNew = 0, lastNet = 0, worldFails = 0, lastWorldJson = '', demoT0 = 0;
function demoAgents() {
  const base = [['Aria', 'dev', 'work', 'black-station', 'Je refactore le module d\'authentification, trois tests restent à passer.'], ['Bolt', 'sécurité', 'work', 'kali', 'J\'ai trouvé un port ouvert sur le routeur de la VM de test, je prépare le rapport.'],
  ['Cleo', 'review', 'idle', 'microservices', 'Relecture terminée : deux remarques mineures sur le nommage.'], ['Dax', 'infra', 'blocked', 'debians', 'Je ne peux pas continuer sans ton accord pour redémarrer le conteneur Jellyfin. Dis-moi quand c\'est bon.'],
  ['Echo', 'test', 'failed', 'black-station', 'Les tests ont échoué : la base de données de recette ne répond plus.'], ['Fenn', 'chef', 'idle', 'pve', 'Tout est sous contrôle, chef.'],
  ['Gaia', 'dev', 'work', 'kali', 'Je migre le schéma de la base vers la nouvelle version.'], ['Hugo', 'dev', 'work', 'microservices', 'Je prépare le déploiement du front.']];
  return base.map((b, i) => ({ id: 'demo-' + i, name: b[0], role: b[1], status: b[2], busy: b[2] === 'work', host: b[3], chief: b[1] === 'chef', demo: true, demoSay: b[4] }));
}
function demoWorld(t) {
  const ds = [['Infra & perso', 0, 18], ['PERSO', 34, 18], ['EXPLORIA', 68, 18], ['ARTHUR', 0, 33], ['ASKEAL', 34, 33]].map(d => ({ name: d[0], x: d[1], y: d[2], w: 30, h: 11, count: 0 }));
  const mkH = (i, name, dist, x, y, style, ag, wk, bl, fl) => ({ id: 'dh' + i, key: '/demo/' + i, name, district: dist, x, y, style, createdAt: 1, agentIds: ag, working: wk, blocked: bl, failed: fl });
  const houses = [mkH(0, 'Maison', 'Infra & perso', 0, 20, 3, ['demo-0', 'demo-1', 'demo-2'], 2, 0, 0), mkH(1, 'fleet-office', 'Infra & perso', 10, 20, 5, ['demo-3', 'demo-5'], 0, 1, 0), mkH(2, 'APPS / FITNESS', 'PERSO', 34, 20, 0, ['demo-6'], 1, 0, 0),
    mkH(3, 'EXPLORIA / PUISSANCE_4_DEBARRAS', 'EXPLORIA', 68, 20, 0, ['demo-4'], 0, 0, 1), mkH(4, 'HAMID / SITES_WEB', 'ARTHUR', 0, 35, 4, ['demo-7'], 1, 0, 0), mkH(5, 'ASKEAL', 'ASKEAL', 34, 35, 1, [], 0, 0, 0)];
  const extra = [['OCTOBRE / JAMES', 'ARTHUR', 10, 35, 2], ['NOUVEAU PROJET', 'ARTHUR', 20, 35, 4], ['Labo', 'ASKEAL', 44, 35, 5]];
  const nAuto = qs.has('quiet') ? 0 : (t > 7000 ? 1 : 0);
  for (let i = 0; i < Math.max(nAuto, demoNew); i++) { const e = extra[i]; if (e) houses.push(mkH(6 + i, e[0], e[1], e[2], e[3], e[4], [], 0, 0, 0)); }
  return { ok: true, lot: { w: 10, h: 9 }, size: { w: 98, h: 48 }, districts: ds, plaza: { academy: { x: 35, y: 3 }, arena: { x: 53, y: 3 }, spawn: { x: 49, y: 13 } }, houses, serverTime: Date.now() };
}
function applyWorld(j) {
  if (!j || !j.ok || !j.houses) return;
  stats.world = j.houses.length;
  let created = []; try { created = Town.setWorld(j, j.serverTime); } catch (e) { stats.err = String(e && e.stack || e).slice(0, 400); console.warn('town build', e); return; }
  for (const h of created) { pushMsg('Nouvelle maison : ' + h.name); }
  if (scene === 'interior' && curHouse) { const nh = j.houses.find(h => h.id === curHouse.id); if (nh) { curHouse = nh; Int.sync(agentsOf(nh)); } }
}
function poll() {
  if (DEMO) {
    if (!demoT0) demoT0 = performance.now();
    const ags = demoAgents(); agentsById.clear(); for (const a of ags) agentsById.set(a.id, a);
    stats.net = 'demo'; applyWorld(demoWorld(performance.now() - demoT0)); return;
  }
  const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 4000);
  Promise.all([
    fetch('/api/agents', { signal: ac.signal, cache: 'no-store' }).then(r => r.json()).catch(() => null),
    fetch('/api/world', { signal: ac.signal, cache: 'no-store' }).then(r => r.json()).catch(() => null),
  ]).then(([a, w]) => {
    if (a && a.agents) { agentsById.clear(); for (const x of a.agents) if (!x.internal) agentsById.set(x.id, x); stats.net = 'live'; }
    if (w && w.ok) { worldFails = 0; applyWorld(w); }
    else if (++worldFails >= 2 && !Town.ready) { const ags = demoAgents(); agentsById.clear(); for (const x of ags) agentsById.set(x.id, x); stats.net = 'demo-fallback'; applyWorld(demoWorld(0)); }
  }).finally(() => clearTimeout(to));
}

/* ───────── rendu ───────── */
function resize() {
  dpr = window.devicePixelRatio || 1;
  const cw = innerWidth, ch = innerHeight;
  W = Math.round(cw * dpr); H = Math.round(ch * dpr);
  cv.width = W; cv.height = H;
  let zc = cw < 640 ? 3 : Math.round(Math.min(cw / 360, ch / 216));
  zc = clamp(zc, 2, 5);
  Z = Math.max(1, Math.round(zc * dpr));
  bw = Math.ceil(W / Z); bh = Math.ceil(H / Z);
  buf.width = bw; buf.height = bh; lcv.width = bw; lcv.height = bh;
  FS = 16; HS = 8 * Math.max(2, Math.round(Z * 1.0));
  COLS = cw < 640 ? 24 : 38;
  { const u = Math.max(2, Math.round(Z * .75)); for (const f of [96, 80, 64, 48, 32, 16]) { FS = f; ctx.font = f + 'px KP'; if (f <= 16 * Z && COLS * ctx.measureText('n').width + 16 * u <= W * .96) break; } }
  document.body.classList.toggle('land', cw > ch);
}
addEventListener('resize', resize);
function nameTag(n, x, y) { const t = tagCanvas(n); ctx.drawImage(t, Math.round(x - t.width / 2), Math.round(y - t.height)); }
function panel(x, y, w, h, u) {
  ctx.fillStyle = '#1c2240'; ctx.fillRect(x + u, y, w - 2 * u, h); ctx.fillRect(x, y + u, w, h - 2 * u);
  ctx.fillStyle = '#7f9ad0'; ctx.fillRect(x + u, y + u, w - 2 * u, h - 2 * u);
  ctx.fillStyle = '#fbfbff'; ctx.fillRect(x + 2 * u, y + 2 * u, w - 4 * u, h - 4 * u);
  ctx.fillStyle = '#dfe5f6'; ctx.fillRect(x + 2 * u, y + h - 3 * u, w - 4 * u, u);
}
function drawHUD() {
  const [w, b, f, i] = counts();
  const u = Math.max(2, Math.round(Z * .6)), fs = HS, pad = 3 * u, y = 2 * u + (isTouch ? 0 : 0), x = 2 * u;
  ctx.font = `${fs}px KP`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  const parts = [['work', String(w)], ['blocked', String(b)], ['failed', String(f)], ['idle', String(i)]];
  const iw = 9 * u; let tw = 0; for (const p of parts) tw += iw + ctx.measureText(p[1]).width + 4 * u;
  const h = fs + 2 * u + 2 * u; panel(x, y, tw + 2 * pad - 2 * u, h, u);
  let cx = x + pad + u;
  for (const p of parts) {
    const cy = y + h / 2; const k = u;
    ctx.fillStyle = p[0] === 'work' ? '#4f5878' : p[0] === 'blocked' ? '#e23c3c' : p[0] === 'failed' ? '#e23c3c' : '#6b87a8';
    if (p[0] === 'work') { const g = GEAR[((performance.now() / 400) | 0) & 1]; for (let j = 0; j < 7; j++) for (let ii = 0; ii < 7; ii++) if (g[j][ii] === '#') ctx.fillRect(cx + ii * k * 0.9, cy - 3.5 * k * .9 + j * k * .9, k * .9 + .5, k * .9 + .5); }
    else if (p[0] === 'blocked') { ctx.fillRect(cx + 3 * k, cy - 3.5 * k, 2 * k, 4 * k); ctx.fillRect(cx + 3 * k, cy + 1.5 * k, 2 * k, 2 * k); }
    else if (p[0] === 'failed') { for (let q = 0; q < 7; q++) { ctx.fillRect(cx + q * k * .9, cy - 3.5 * k + q * k * .9, k, k); ctx.fillRect(cx + (6 - q) * k * .9, cy - 3.5 * k + q * k * .9, k, k); } }
    else { ctx.fillStyle = '#6b87a8'; ctx.font = `${fs}px KP`; ctx.fillText('z', cx + 2 * k, cy - k); ctx.fillText('z', cx + 4.5 * k, cy - 3 * k); }
    drawStr(ctx, p[1], cx + iw, y + h / 2 + fs * .32, '#20243a'); cx += iw + ctx.measureText(p[1]).width + 4 * u;
  }
}
function drawDialog(dt) {
  const u = dU(), fs = FS; ctx.font = `${fs}px KP`; const ca = Math.round(ctx.measureText('M').actualBoundingBoxAscent), lh = Math.round(ca * 2.1);
  const bwid = dlgW(), bhei = lh * 3 + 7 * u;
  const bot = isTouch && H > W ? (210 * dpr) : 3 * u;
  const x = Math.round((W - bwid) / 2) - (isTouch && W > H ? 0 : 0), y = H - bot - bhei;
  const page = dlg.pages[dlg.page]; const total = page.join('').length;
  dlg.t += dt; if (dlg.chars < total) dlg.chars = Math.min(total, dlg.chars + dt * 48);
  // onglet nom
  if (dlg.name) {
    ctx.font = `${fs}px KP`; const tw = strW(ctx, dlg.name) + 8 * u, th = fs + 5 * u;
    panel(x + 2 * u, y - th + 2 * u, tw, th, u); drawStr(ctx, dlg.name, x + 2 * u + 4 * u, y - th + 2 * u + th / 2 + Math.round(fs * .3), '#20243a');
  }
  panel(x, y, bwid, bhei, u);
  ctx.font = `${fs}px KP`; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  let left = Math.floor(dlg.chars);
  for (let i = 0; i < page.length; i++) {
    const s = page[i].slice(0, Math.max(0, left)); left -= page[i].length;
    const ty = y + 4 * u + i * lh, tx = x + 6 * u;
    const yb = ty + ca + Math.round((lh - ca) / 2); drawStr(ctx, s, tx + u, yb + u, '#b4bcd6'); drawStr(ctx, s, tx, yb, '#20243a');
    if (dlg.dots && i === 0 && left < 0) { const nd = 1 + (((dlg.t * 2.6) | 0) % 3); drawStr(ctx, '.'.repeat(nd), tx + strW(ctx, s) + 2 * u, yb, '#20243a'); }
    if (left <= 0) break;
  }
  dlg.rects = null;
  if (dlg.chars >= total) {
    const last = dlg.page === dlg.pages.length - 1;
    if (last && dlg.menu && !dlg.pending && !dlg.wait) {
      let mw = 0; for (const o of dlg.menu) mw = Math.max(mw, strW(ctx, o.label)); mw += 18 * u;
      const mh = dlg.menu.length * lh + 5 * u, mx = x + bwid - mw, my = y - mh - 2 * u; panel(mx, my, mw, mh, u); dlg.rects = [];
      for (let i = 0; i < dlg.menu.length; i++) { const ty = my + 3 * u + i * lh, yb = ty + ca + Math.round((lh - ca) / 2); drawStr(ctx, dlg.menu[i].label, mx + 11 * u, yb, '#20243a');
        if (i === dlg.sel) { ctx.fillStyle = '#d9483a'; for (let r = 0; r < 4; r++) ctx.fillRect(mx + 4 * u + r * u, ty + lh / 2 - 3 * u + r * u, u, (7 - 2 * r) * u); }
        dlg.rects.push({ x: mx, y: ty, w: mw, h: lh, i }); }
    }
    if (!(last && (dlg.pending || dlg.menu)) && (((dlg.t * 2.2) | 0) & 1) === 0) {
      const ax = x + bwid - 9 * u, ay = y + bhei - 7 * u; ctx.fillStyle = last ? '#d9483a' : '#20243a';
      for (let r = 0; r < 4; r++) ctx.fillRect(ax + r * u, ay + r * u, (7 - 2 * r) * u, u);
    }
  }
}
function drawBanner(dt) {
  const u = Math.max(2, Math.round(Z * .75)), fs = HS;
  ctx.font = `${fs}px KP`;
  const lines = [];
  if (banner) { banner.t += dt; if (banner.t > 3.2) banner = null; else lines.push([banner.name, banner.sub, Math.min(1, banner.t * 4) * (banner.t > 2.7 ? Math.max(0, (3.2 - banner.t) * 2) : 1)]); }
  else if (label && scene === 'town') lines.push([label, '', 1]);
  let yy = 2 * u + (isTouch ? 0 : 0);
  for (const [name, sub, a] of lines) {
    const n = strW(ctx, name), s = sub ? strW(ctx, sub) : 0, tw = Math.max(n, s) + 12 * u, th = fs * (sub ? 2.1 : 1.3) + 5 * u, x = Math.round((W - tw) / 2), y = Math.round(yy - (1 - a) * th);
    ctx.globalAlpha = Math.max(0, a); panel(x, y, tw, th, u);
    drawStr(ctx, name, Math.round((W - n) / 2), y + 3 * u + Math.round(fs * .85), '#20243a');
    if (sub) drawStr(ctx, sub, Math.round((W - s) / 2), y + 3 * u + Math.round(fs * 1.85), '#6b7094');
    ctx.globalAlpha = 1; yy += th + u;
  }
  for (let i = msgs.length - 1; i >= 0; i--) { const m = msgs[i]; m.t += dt; if (m.t > 4.5) msgs.splice(i, 1); }
  if (msgs.length) {
    const m = msgs[msgs.length - 1], a = Math.min(1, m.t * 4) * (m.t > 3.9 ? Math.max(0, (4.5 - m.t) / .6) : 1), tw = strW(ctx, m.text) + 12 * u, th = fs * 1.3 + 5 * u, x = Math.round((W - tw) / 2), y = H - th - 4 * u - (isTouch && H > W ? 220 * dpr : 0) - (dlg ? 120 * dpr : 0);
    ctx.globalAlpha = a; panel(x, y, tw, th, u); drawStr(ctx, m.text, x + 6 * u, y + 3 * u + Math.round(fs * .85), '#20243a'); ctx.globalAlpha = 1;
  }
}
function frame(now) {
  const dt = Math.min(.05, (now - frame.last) / 1000 || 0.016); frame.last = now;
  stats.fps = stats.fps * .9 + (1 / Math.max(dt, .001)) * .1;
  if (now - lastNet > 2000) { lastNet = now; poll(); }
  if (actQueued) { actQueued = false; doAction(); }
  if (fade) {
    fade.t += dt; const D = .22;
    if (fade.phase === 0 && fade.t >= D) { fade.phase = 1; fade.t = 0; fade.cb(); }
    else if (fade.phase === 1 && fade.t >= D) fade = null;
  }
  updatePlayer(dt);
  let rw, rh;
  if (scene === 'town') {
    Town.update(dt, now); rw = Town.w; rh = Town.h; label = null;
    if (!fade && Town.ready) {
      const dr = Town.doorAt(player);
      if (dr && !overlayOpen) { if (dr.type === 'house') { enterHouse(dr.house); } else { startFade(() => { player.y += 20; }); openOverlay(dr.type); } }
      else { const nh = Town.nearHouse(player); label = nh ? nh.label : null; }
    }
  } else {
    Int.update(dt); rw = Int.MW * TS; rh = Int.MH * TS;
    if (!fade && Int.exitTest(player)) exitHouse();
  }
  let tx = player.x - bw / 2, ty = player.y - 10 - bh / 2;
  tx = rw <= bw ? -(bw - rw) / 2 : clamp(tx, 0, rw - bw); ty = rh <= bh ? -(bh - rh) / 2 : clamp(ty, 0, rh - bh);
  if (frame.cx === undefined) { frame.cx = tx; frame.cy = ty; }
  frame.cx += (tx - frame.cx) * Math.min(1, dt * 9); frame.cy += (ty - frame.cy) * Math.min(1, dt * 9);
  cam.x = Math.round(frame.cx); cam.y = Math.round(frame.cy);
  bx.imageSmoothingEnabled = false;
  bx.fillStyle = '#12142a'; bx.fillRect(0, 0, bw, bh);
  if (scene === 'town') { if (Town.ready) Town.draw(bx, bw, bh, now, player); } else Int.draw(bx, lx, lcv, bw, bh, now, player);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#12142a'; ctx.fillRect(0, 0, W, H);
  ctx.drawImage(buf, 0, 0, bw * Z, bh * Z);
  if (scene === 'interior') for (const n of Int.npcs) nameTag(n, (n.x - cam.x) * Z, (n.y - (n.seated ? 12 : 20) - 1 - cam.y) * Z - (n.look.crown ? 3 * Z : 0));
  drawHUD(); drawBanner(dt);
  if (dlg) drawDialog(dt);
  if (fade) { const a = fade.phase === 0 ? Math.min(1, fade.t / .22) : 1 - Math.min(1, fade.t / .22); ctx.fillStyle = `rgba(8,10,28,${a})`; ctx.fillRect(0, 0, W, H); }
  if (((frame.n = (frame.n || 0) + 1) % 8) === 0) debug();
  requestAnimationFrame(frame);
}
function debug() {
  const td = Town.data, tl = [];
  if (td) for (const h of td.houses) { const d = Town.doorOf(h.id); tl.push({ id: h.id, n: h.name, dx: d ? d.x : 0, dy: d ? d.y : 0, ag: h.agentIds.length, w: h.working, b: h.blocked, f: h.failed }); }
  const bn = Town.buildingDoor;
  const nn = scene === 'interior' ? Int.npcs : [];
  dbg.textContent = JSON.stringify({
    scene, map: scene === 'town' ? 'town' : 'interior', x: Math.round(player.x), y: Math.round(player.y), tx: Math.floor(player.x / TS), ty: Math.floor(player.y / TS), dir: player.dir,
    house: curHouse ? curHouse.name : null, near: label, overlay: overlayOpen, fade: !!fade, banner: banner ? banner.name : null, msg: msgs.length ? msgs[msgs.length - 1].text : null,
    menu: dlg && dlg.rects ? dlg.menu.map(o => o.label).join('/') + '@' + dlg.sel : null, typing: typing ? typing.name : null, panel: panelOpen, wait: !!(dlg && dlg.wait),
    dialog: dlg ? (dlg.name + '|' + dlg.pages[dlg.page].join(' / ') + '|p' + (dlg.page + 1) + '/' + dlg.pages.length + (dlg.pending ? '|pending' : '')) : null,
    houses: td ? td.houses.length : 0, hl: tl, academy: bn('academy'), arena: bn('arena'), size: td ? td.size : null, spawn: td ? td.plaza.spawn : null,
    npcs: nn.length, work: nn.filter(n => n.mode === 'work').length, seated: nn.filter(n => n.seated).length, net: stats.net, err: stats.err || null, fps: Math.round(stats.fps), Z, bw, bh, cam: [cam.x, cam.y], touch: isTouch,
    names: nn.map(n => n.name + ':' + n.mode + ':' + Math.round(n.x) + ',' + Math.round(n.y)),
  });
}

function start() {
  resize();
  const goto = qs.get('goto'), ent = qs.get('enter');
  let started = false;
  const boot = () => {
    if (started || !Town.ready) return; started = true;
    const sp = Town.plazaSpawn(); player.x = sp.x; player.y = sp.y; player.dir = 0;
    if (goto) { const [a, b] = goto.split(',').map(Number); player.x = a * TS + 8; player.y = b * TS + 12; }
    if (qs.get('px')) player.x = +qs.get('px'); if (qs.get('py')) player.y = +qs.get('py');
    if (qs.get('dir')) player.dir = +qs.get('dir');
    frame.cx = undefined;
    const tk = qs.get('talk');
    if (tk !== null) { const h = Town.data.houses.find(h => h.agentIds.length && (tk === 'first' || h.agentIds.includes(tk))); if (h) { fade = null; scene = 'interior'; curHouse = h; const ags = agentsOf(h); Int.build(h, ags.length); Int.sync(ags); player.x = Int.spawn.x; player.y = Int.spawn.y; player.dir = 1; setBanner(h.name, h.district); setTimeout(() => { const n = Int.npcs.find(n => tk === 'first' || n.id === tk) || Int.npcs[0]; if (n) talkTo(n); }, 400); } }
    if (ent !== null) { const h = Town.data.houses[+ent || 0]; if (h) { fade = null; scene = 'interior'; curHouse = h; const ags = agentsOf(h); Int.build(h, Math.max(ags.length, h.agentIds.length)); Int.sync(ags); player.x = Int.spawn.x; player.y = Int.spawn.y; player.dir = 1; setBanner(h.name, h.district); } }
  };
  const wait = () => { boot(); if (!started) setTimeout(wait, 60); };
  poll(); lastNet = performance.now(); wait();
  requestAnimationFrame(frame);
}
window.addEventListener('error', e => { try { console.warn('world error', e.message); } catch (_) { } });
})();
