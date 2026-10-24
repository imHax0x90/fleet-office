/* Fleet Office · World — prototype pixel-art (vue 3/4, tuiles 16px).
   JS vanilla + <canvas>, aucune dépendance. Assets : voir assets/LICENSES.txt */
(() => {
'use strict';
const TS = 16, MW = 26, MH = 18;
const qs = new URLSearchParams(location.search);
const DEMO = qs.has('demo');
const $ = id => document.getElementById(id);
const cv = $('game'), ctx = cv.getContext('2d');
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const buf = mk(8, 8), bx = buf.getContext('2d');
const lcv = mk(8, 8), lx = lcv.getContext('2d');
const dbg = $('dbg');
const R = (c, x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function hash(s) { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
function shade(h, f) { const [r, g, b] = rgb(h); const c = v => clamp(Math.round(v * f), 0, 255); return `rgb(${c(r)},${c(g)},${c(b)})`; }

/* ───────── palette ───────── */
const INK = '#1d1a2e';
const CAP = '#272c4a', CAP2 = '#3a4268';

/* ───────── chargement ───────── */
const sheet = new Image(); sheet.src = 'assets/indoor.png';
const fontFace = new FontFace('KP', 'url(assets/KenneyPixel.ttf)');
Promise.all([
  new Promise((res, rej) => { sheet.onload = res; sheet.onerror = () => rej(new Error('indoor.png')); }),
  fontFace.load().then(f => { document.fonts.add(f); }),
]).then(start).catch(e => console.warn('chargement', e && e.message));

/* ───────── monde statique ───────── */
const FL = mk(MW * TS, MH * TS);               // sol + murs + déco murale (pré-rendu)
const blk = new Uint8Array(MW * MH);            // collisions (tuiles)
const statics = [];                              // objets triés par y
const interact = [];                             // zones interactives
const lights = [];                               // lumières statiques
const desks = [], sofaSeats = [];
let camX = 0, camY = 0;

function block(tx, ty, w = 1, h = 1) { for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) if (x >= 0 && y >= 0 && x < MW && y < MH) blk[y * MW + x] = 1; }
const isBlocked = (tx, ty) => tx < 0 || ty < 0 || tx >= MW || ty >= MH || blk[ty * MW + tx] === 1;
const spr = (b, c, r, x, y) => b.drawImage(sheet, c * 17, r * 17, 16, 16, x - camX, y - camY, 16, 16);
function addObj(sy, draw) { const o = { sy, draw }; statics.push(o); return o; }
function addTiles(sy, list) { // list: [col,row,x,y]
  return addObj(sy, b => { for (const t of list) spr(b, t[0], t[1], t[2], t[3]); });
}
function shadowRect(px, py, w, h) {
  const c = FL.getContext('2d');
  R(c, px + 1, py + h - 3, w + 2, 5, 'rgba(12,14,44,.34)');
  R(c, px + w - 1, py + 3, 3, h - 3, 'rgba(12,14,44,.30)');
}
function bake(w, h, fn) { const c = mk(w, h); fn(c.getContext('2d'), w, h); return c; }

function buildFloor() {
  const c = FL.getContext('2d'); const r = rng(77);
  R(c, 0, 0, MW * TS, MH * TS, CAP);
  // moquette (zone bureaux)
  for (let ty = 3; ty < 12; ty++) for (let tx = 1; tx < MW - 1; tx++) {
    const x = tx * TS, y = ty * TS, a = (tx + ty) & 1;
    R(c, x, y, TS, TS, a ? '#566590' : '#5c6b97');
    R(c, x, y, TS, 1, 'rgba(10,12,50,.16)'); R(c, x, y, 1, TS, 'rgba(10,12,50,.16)');
    R(c, x + 1, y + 1, TS - 1, 1, 'rgba(255,255,255,.05)');
    for (let i = 0; i < 7; i++) R(c, x + 1 + (r() * 14 | 0), y + 1 + (r() * 14 | 0), 1, 1, r() < .5 ? 'rgba(255,255,255,.08)' : 'rgba(10,12,50,.14)');
  }
  // parquet (salon)
  const pl = ['#a06c44', '#a97550', '#98663f', '#b07c55'];
  for (let y = 12 * TS, row = 0; y < 17 * TS; y += 4, row++) {
    let x = 1 * TS - ((row * 9) % 28);
    while (x < (MW - 1) * TS) {
      const len = 28, x0 = Math.max(x, TS), x1 = Math.min(x + len, (MW - 1) * TS);
      if (x1 > x0) {
        R(c, x0, y, x1 - x0, 4, pl[(r() * 4) | 0]);
        R(c, x0, y, x1 - x0, 1, 'rgba(255,230,190,.22)');
        R(c, x0, y + 3, x1 - x0, 1, 'rgba(60,30,10,.30)');
        if (x >= TS) R(c, x, y, 1, 4, 'rgba(60,30,10,.35)');
      }
      x += len;
    }
  }
  // liseré de transition
  R(c, TS, 12 * TS - 3, (MW - 2) * TS, 3, '#53381f'); R(c, TS, 12 * TS - 3, (MW - 2) * TS, 1, '#74512f');
  // murs
  R(c, 0, 0, MW * TS, TS, CAP); R(c, 0, TS - 3, MW * TS, 3, CAP2); R(c, 0, TS - 1, MW * TS, 1, '#505a86');
  for (let x = 0; x < MW * TS; x++) {
    // face du mur : haut clair + lambris
    R(c, x, 16, 1, 22, '#dcd7ee');
    R(c, x, 38, 1, 10, '#6b87a8');
  }
  R(c, 0, 16, MW * TS, 2, '#b9b3d6'); R(c, 0, 18, MW * TS, 1, '#e9e6f6');
  for (let x = TS; x < MW * TS; x += 16) { R(c, x, 19, 1, 17, 'rgba(110,100,170,.20)'); }
  R(c, 0, 35, MW * TS, 1, '#f3f0fb'); R(c, 0, 36, MW * TS, 2, '#a9a6cc');
  R(c, 0, 38, MW * TS, 1, '#8fa8c4');
  for (let x = 4; x < MW * TS; x += 8) R(c, x, 40, 1, 5, 'rgba(30,50,90,.25)');
  R(c, 0, 45, MW * TS, 3, '#39446a'); R(c, 0, 45, MW * TS, 1, '#56638f');
  // ombre du mur sur le sol
  for (let i = 0; i < 7; i++) R(c, TS, 48 + i, (MW - 2) * TS, 1, `rgba(10,12,44,${0.30 - i * 0.045})`);
  // murs latéraux + bas
  for (const [x, w] of [[0, TS], [(MW - 1) * TS, TS]]) {
    R(c, x, 0, w, MH * TS, CAP); R(c, x + (x ? 0 : w - 3), 0, 3, MH * TS, CAP2);
  }
  R(c, 0, (MH - 1) * TS, MW * TS, TS, CAP); R(c, 0, (MH - 1) * TS, MW * TS, 3, CAP2);
  for (let i = 0; i < 6; i++) { R(c, TS, 48 + 0, 0, 0, 'rgba(0,0,0,0)'); R(c, TS + i, 48, 1, 12 * TS - 3 - 48 + 12 * 0, `rgba(10,12,44,${0.22 - i * 0.035})`); R(c, (MW - 1) * TS - 1 - i, 48, 1, 12 * TS - 3 - 48, `rgba(10,12,44,${0.22 - i * 0.035})`); }
  for (let i = 0; i < 6; i++) { R(c, TS + i, 12 * TS, 1, 5 * TS, `rgba(10,12,44,${0.22 - i * 0.035})`); R(c, (MW - 1) * TS - 1 - i, 12 * TS, 1, 5 * TS, `rgba(10,12,44,${0.22 - i * 0.035})`); R(c, TS, 17 * TS - 1 - i, (MW - 2) * TS, 1, `rgba(10,12,44,${0.22 - i * 0.035})`); }
  // porte (bas)
  const dx = 12 * TS; R(c, dx - 2, 16 * TS, 4 * TS + 4 - 32, 0, '#000');
  { const g = c.createLinearGradient(0, 17 * TS, 0, 18 * TS); g.addColorStop(0, '#d9f0ff'); g.addColorStop(1, '#7fb4de'); c.fillStyle = g; c.fillRect(dx, 17 * TS, 2 * TS, TS); }
  R(c, dx - 3, 17 * TS - 3, 2 * TS + 6, 3, '#7a4e2e'); R(c, dx - 3, 17 * TS - 3, 3, TS + 3, '#7a4e2e'); R(c, dx + 2 * TS, 17 * TS - 3, 3, TS + 3, '#7a4e2e'); R(c, dx - 3, 17 * TS - 3, 2 * TS + 6, 1, '#a06c44');
  R(c, dx + 15, 17 * TS, 2, TS, '#a4c4e0');
  // paillasson
  R(c, dx + 2, 16 * TS + 3, 2 * TS - 4, 11, '#7b2f34'); R(c, dx + 3, 16 * TS + 4, 2 * TS - 6, 9, '#a3434a');
  R(c, dx + 5, 16 * TS + 6, 2 * TS - 10, 5, '#7b2f34');
  lights.push({ x: dx + 16, y: 16 * TS, r: 46, col: 'win', k: .6 });
  // tapis du salon (8x4 tuiles)
  const rx = 3 * TS, ry = 13 * TS, rw = 8 * TS, rh = 4 * TS - 6;
  R(c, rx + 3, ry + 3, rw, rh, 'rgba(12,14,44,.28)');
  R(c, rx, ry, rw, rh, '#2a6f73'); R(c, rx + 2, ry + 2, rw - 4, rh - 4, '#efe2bd'); R(c, rx + 4, ry + 4, rw - 8, rh - 8, '#3b9a95');
  R(c, rx + 7, ry + 7, rw - 14, rh - 14, '#2a6f73');
  for (let x = rx + 9; x < rx + rw - 9; x += 8) { R(c, x, ry + rh / 2 - 2, 4, 4, '#d9694a'); R(c, x + 1, ry + rh / 2 - 3, 2, 6, '#d9694a'); R(c, x + 2, ry + rh / 2 - 1, 0, 0, '#000'); }
  for (let x = rx + 2; x < rx + rw - 2; x += 4) { R(c, x, ry + 2, 2, 2, '#d9694a'); R(c, x, ry + rh - 4, 2, 2, '#d9694a'); }
  for (let y = ry + 1; y < ry + rh; y += 3) { R(c, rx - 2, y, 2, 1, '#efe2bd'); R(c, rx + rw, y, 2, 1, '#efe2bd'); }
  // fenêtres + faisceaux de lumière
  for (const wx of [36, 132, 296]) windowAt(c, wx, 19, 40, 19);
  // tableau blanc
  whiteboard(c, 184, 19, 64, 24);
  // horloge + cadres
  clockAt(c, 109, 24); frame(c, 262 + 2, 22, 12, 11, '#d9694a', '#efe2bd'); frame(c, 336 + 14, 22, 10, 12, '#3b9a95', '#efe2bd');
  frame(c, 18, 22, 10, 11, '#e0b030', '#f6eed0');
  frame(c, 61, 21, 10, 8, '#d9694a', '#f6eed0');
}
function windowAt(c, x, y, w, h) {
  R(c, x - 2, y - 2, w + 4, h + 5, '#a4a1c6'); R(c, x - 1, y - 1, w + 2, h + 3, '#f4f2fb');
  const g = c.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, '#7fc4ee'); g.addColorStop(1, '#d4f0fc');
  c.fillStyle = g; c.fillRect(x, y, w, h);
  R(c, x + 4, y + 4, 9, 2, '#fff'); R(c, x + 6, y + 3, 6, 1, '#fff'); R(c, x + w - 15, y + 8, 10, 2, '#eefaff'); R(c, x + w - 13, y + 7, 6, 1, '#eefaff');
  R(c, x + (w >> 1) - 1, y, 2, h, '#f4f2fb'); R(c, x, y + (h >> 1), w, 2, '#f4f2fb');
  R(c, x - 2, y + h + 1, w + 4, 2, '#cfcbe6'); R(c, x - 2, y + h + 3, w + 4, 1, '#8d89b0');
  // faisceau sur le sol
  c.save(); c.fillStyle = 'rgba(255,246,200,.11)'; c.beginPath();
  c.moveTo(x, 48); c.lineTo(x + w, 48); c.lineTo(x + w + 34, 48 + 64); c.lineTo(x + 34, 48 + 64); c.closePath(); c.fill();
  c.fillStyle = 'rgba(255,246,200,.07)'; c.beginPath();
  c.moveTo(x + w / 2 - 1, 48); c.lineTo(x + w / 2 + 1, 48); c.lineTo(x + w / 2 + 35, 48 + 64); c.lineTo(x + w / 2 + 33, 48 + 64); c.fill();
  c.restore();
  lights.push({ x: x + w / 2 + 14, y: 70, r: 70, col: 'win', k: .5 });
}
function whiteboard(c, x, y, w, h) {
  R(c, x - 2, y - 2, w + 4, h + 4, '#8d8fb0'); R(c, x - 1, y - 1, w + 2, h + 2, '#e9ebf6'); R(c, x, y, w, h, '#fbfcff');
  R(c, x + 1, y + h, w - 2, 2, '#6a6d92');
  const cols = ['#d9694a', '#e0b030', '#3b9a95', '#6a7fd0'];
  for (let k = 0; k < 3; k++) {
    const cx = x + 3 + k * 20; R(c, cx, y + 2, 17, 1, '#aab0d0');
    for (let j = 0; j < 3; j++) if ((k + j) % 3 !== 2) { R(c, cx, y + 5 + j * 6, 17, 5, cols[(k * 2 + j) % 4]); R(c, cx + 1, y + 6 + j * 6, 9, 1, 'rgba(255,255,255,.7)'); }
  }
}
function clockAt(c, x, y) {
  R(c, x - 6, y - 5, 12, 12, '#39446a'); R(c, x - 5, y - 6, 10, 14, '#39446a'); R(c, x - 5, y - 5, 10, 12, '#f6f3ea'); R(c, x - 6 + 1, y - 4, 12 - 2, 10, '#f6f3ea');
  R(c, x - 5, y - 6, 10, 1, '#f6f3ea'); R(c, x, y - 3, 1, 4, '#2a2d4a'); R(c, x, y + 1, 3, 1, '#2a2d4a'); R(c, x, y, 1, 1, '#d9694a');
}
function frame(c, x, y, w, h, col, mat) { R(c, x - 1, y - 1, w + 2, h + 2, '#5a3a22'); R(c, x, y, w, h, mat); R(c, x + 2, y + 2, w - 4, h - 4, col); R(c, x + 3, y + h - 5, w - 6, 2, 'rgba(255,255,255,.35)'); }

/* meubles pré-dessinés */
function mkBookshelf() {
  return bake(32, 34, (c) => {
    const r = rng(5), pal = ['#d9694a', '#3b9a95', '#e0b030', '#6a7fd0', '#a3434a', '#79b36b', '#efe2bd', '#8a5fc0'];
    R(c, 0, 0, 32, 34, '#2e1c10'); R(c, 1, 1, 30, 32, '#7a4e2e'); R(c, 1, 1, 30, 1, '#9a6a42');
    for (let s = 0; s < 3; s++) {
      const y0 = 3 + s * 10; R(c, 3, y0, 26, 8, '#3b2414');
      let x = 4; while (x < 28) { const w = 2 + (r() * 2 | 0), h = 5 + (r() * 3 | 0), col = pal[(r() * 8) | 0]; if (r() < .1) { x += 3; continue; } R(c, x, y0 + 8 - h, w, h, col); R(c, x, y0 + 8 - h, 1, h, 'rgba(255,255,255,.25)'); x += w; }
      R(c, 3, y0 + 8, 26, 2, '#a06c44');
    }
    R(c, 0, 32, 32, 2, '#2e1c10');
  });
}
function mkSofa() {
  return bake(64, 32, (c) => {
    const base = '#c8554a', dk = '#8f3a3a', lt = '#e07a68', wood = '#4a2e1c';
    R(c, 2, 30, 4, 2, wood); R(c, 58, 30, 4, 2, wood);
    R(c, 0, 4, 64, 27, INK); R(c, 1, 3, 62, 1, INK);
    R(c, 1, 4, 62, 12, dk); R(c, 2, 4, 60, 11, base);
    for (let i = 0; i < 3; i++) { const x = 9 + i * 16; R(c, x, 5, 14, 11, lt); R(c, x + 1, 6, 12, 9, base); R(c, x + 1, 6, 12, 1, lt); R(c, x, 15, 14, 1, dk); }
    R(c, 8, 16, 48, 14, dk); R(c, 9, 17, 46, 11, base);
    for (let i = 0; i < 3; i++) { const x = 9 + i * 15.33 | 0; R(c, x, 17, 15, 11, base); R(c, x, 17, 15, 1, lt); R(c, x + 14, 17, 1, 11, dk); R(c, x + 1, 27, 14, 1, dk); }
    R(c, 1, 8, 8, 22, dk); R(c, 2, 9, 6, 20, base); R(c, 2, 9, 6, 2, lt); R(c, 2, 27, 6, 2, dk);
    R(c, 55, 8, 8, 22, dk); R(c, 56, 9, 6, 20, base); R(c, 56, 9, 6, 2, lt); R(c, 56, 27, 6, 2, dk);
    R(c, 20, 19, 7, 6, '#efe2bd'); R(c, 21, 20, 5, 4, '#e0b030'); R(c, 20, 25, 7, 1, '#b79a5a');
  });
}
function mkRack() {
  return bake(16, 34, (c) => {
    R(c, 0, 0, 16, 34, '#14172a'); R(c, 1, 1, 14, 32, '#2f3550'); R(c, 1, 1, 14, 1, '#4a5380');
    for (let i = 0; i < 6; i++) { const y = 3 + i * 5; R(c, 2, y, 12, 4, '#1d2138'); R(c, 3, y + 1, 5, 1, '#3b4268'); R(c, 3, y + 2, 5, 1, '#3b4268'); }
  });
}
function mkLamp() {
  return bake(16, 34, (c) => {
    R(c, 7, 12, 2, 20, '#2a2d4a'); R(c, 4, 30, 8, 3, '#2a2d4a'); R(c, 5, 30, 6, 1, '#4a5380');
    R(c, 3, 2, 10, 10, '#a37a28'); R(c, 4, 1, 8, 12, '#a37a28'); R(c, 4, 2, 8, 9, '#f4d878'); R(c, 5, 3, 6, 4, '#fff1b4'); R(c, 3, 11, 10, 1, '#6f5018');
  });
}
function mkCoffee() {
  return bake(12, 14, (c) => {
    R(c, 0, 0, 12, 14, INK); R(c, 1, 1, 10, 12, '#b8bdd8'); R(c, 1, 1, 10, 3, '#d8dcf0'); R(c, 2, 5, 8, 4, '#2a2d4a'); R(c, 3, 9, 6, 3, '#6a6f92');
    R(c, 3, 6, 6, 2, '#6b4a2e'); R(c, 8, 2, 2, 1, '#d9694a'); R(c, 4, 10, 4, 2, '#f6f3ea');
  });
}

function buildStatics() {
  const sofa = mkSofa(), bs = mkBookshelf(), rk = mkRack(), lp = mkLamp(), cf = mkCoffee();
  // bureaux (2 rangées x 4)
  const xs = [2, 8, 14, 20];
  [5, 9].forEach((ty, row) => xs.forEach((tx, i) => {
    const d = { tx, ty, cx: (tx + 1) * TS + 8, seatTop: (ty - 1) * TS, occ: null, id: row * 4 + i, seed: hash('d' + row + i) };
    desks.push(d);
    // chaise (vide ou occupée — le PNJ est trié séparément)
    addObj((ty - 1) * TS + 8, b => spr(b, 0, (d.seed & 1) ? 3 : 2, (tx + 1) * TS, (ty - 1) * TS));
    block(tx + 1, ty - 1, 1, 1);
    block(tx, ty, 3, 2);
    shadowRect(tx * TS, ty * TS, 3 * TS, 2 * TS);
    addObj((ty + 2) * TS, b => drawDesk(b, d));
    interact.push({ x: tx * TS, y: ty * TS, w: 3 * TS, h: 2 * TS, say: () => d.occ ? null : ['Un poste de travail libre.', 'L\'écran est en veille.'] });
  }));
  // étagères
  for (const bxp of [80, 256]) {
    addObj(64, b => b.drawImage(bs, bxp - camX, 30 - camY));
    block(bxp / TS, 3, 2, 1); shadowRect(bxp, 48, 32, 16);
    interact.push({ x: bxp, y: 32, w: 32, h: 32, say: () => ['Des classeurs d\'archives de sessions.', 'Une étiquette : « /sync pour rapatrier les échanges ».'] });
  }
  // racks serveurs
  for (const rx of [352, 368]) {
    addObj(64, b => { b.drawImage(rk, rx - camX, 30 - camY); const t = performance.now(); for (let i = 0; i < 6; i++) { const on = ((t / 300 + i * 3 + rx) | 0) % 5; R(b, rx + 10 - camX, 33 + i * 5 - camY, 1, 1, on === 0 ? '#ff5a4a' : '#4ae08a'); R(b, rx + 12 - camX, 33 + i * 5 - camY, 1, 1, on === 1 ? '#4a9aff' : '#2c3a5c'); } });
    block(rx / TS, 3, 1, 1); shadowRect(rx, 48, 16, 16);
    interact.push({ x: rx, y: 32, w: 16, h: 32, say: () => ['Un rack de serveurs. Les LED clignotent calmement.', 'Chaque machine du tailnet aura bientôt son propre bâtiment.'] });
    lights.push({ x: rx + 8, y: 50, r: 22, col: 'cool', k: .35 });
  }
  // plantes (Kenney) aux coins
  for (const [px, py] of [[1, 3], [24, 3], [1, 16], [24, 16], [11, 3], [24, 11]]) {
    block(px, py); shadowRect(px * TS + 2, py * TS, 12, 16);
    addTiles(py * TS + 16, [[(px + py) & 1 ? 17 : 16, 0, px * TS, py * TS]]);
    interact.push({ x: px * TS, y: py * TS, w: 16, h: 16, say: () => ['Une plante bien arrosée.', 'Elle ne bloque jamais, elle.'] });
  }
  // salon : canapé 4x2, table basse, fauteuils
  block(4, 12, 4, 2); shadowRect(4 * TS, 12 * TS, 4 * TS, 2 * TS);
  addObj(12 * TS + 13, b => b.drawImage(sofa, 0, 0, 64, 16, 4 * TS - camX, 12 * TS - camY, 64, 16));
  addObj(14 * TS - 2, b => b.drawImage(sofa, 0, 16, 64, 16, 4 * TS - camX, 13 * TS - camY, 64, 16));
  for (const sx of [84, 100, 114]) sofaSeats.push({ x: sx, y: 12 * TS + 15, tx: sx >> 4, occ: null });
  interact.push({ x: 4 * TS, y: 12 * TS, w: 4 * TS, h: 2 * TS, say: () => ['Un canapé moelleux.', 'Les agents au repos viennent s\'y détendre.'] });
  shadowRect(6 * TS, 15 * TS + 2, 2 * TS, TS - 2);
  addTiles(16 * TS + 4, [[3, 1, 6 * TS, 15 * TS + 2], [4, 1, 7 * TS, 15 * TS + 2]]);
  // (la table basse est posée sur 2x2 mais seule la moitié basse bloque)
  block(6, 15, 2, 1); block(4, 15); block(8, 15);
  addTiles(16 * TS + 4, [[3, 2, 4 * TS + 2, 15 * TS + 2]]); addTiles(16 * TS + 4, [[2, 2, 8 * TS + 6, 15 * TS + 2]]);
  // piano
  block(14, 12, 2, 2); shadowRect(14 * TS, 12 * TS, 2 * TS, 2 * TS);
  addTiles(14 * TS, [[23, 8, 14 * TS, 12 * TS], [24, 8, 15 * TS, 12 * TS], [23, 9, 14 * TS, 13 * TS], [24, 9, 15 * TS, 13 * TS]]);
  interact.push({ x: 14 * TS, y: 12 * TS, w: 32, h: 32, say: () => ['Un vieux piano.', 'Personne n\'a jamais le temps de jouer, mais il est accordé.'] });
  // lampadaire
  block(10, 13, 1, 1); shadowRect(10 * TS + 3, 13 * TS, 10, 16);
  addObj(14 * TS, b => b.drawImage(lp, 10 * TS - camX, 12 * TS - camY));
  lights.push({ x: 10 * TS + 8, y: 12 * TS + 10, r: 62, col: 'warm', k: .9 });
  interact.push({ x: 10 * TS, y: 12 * TS, w: 16, h: 32, say: () => ['Un lampadaire à la lumière chaude.'] });
  // kitchenette
  const kit = [0, 8, 9, 5, 6, 2];
  block(18, 12, 6, 1); shadowRect(18 * TS, 12 * TS, 6 * TS, TS);
  addObj(13 * TS, b => { kit.forEach((c, i) => spr(b, c, 12, (18 + i) * TS, 12 * TS)); });
  addObj(13 * TS + 1, b => { b.drawImage(cf, 20 * TS + 2 - camX, 12 * TS - 10 - camY); const t = performance.now() / 400; R(b, 20 * TS + 5 - camX, 12 * TS - 14 - camY - ((t | 0) & 1), 1, 3, 'rgba(255,255,255,.55)'); R(b, 20 * TS + 7 - camX, 12 * TS - 13 - camY + ((t | 0) & 1), 1, 2, 'rgba(255,255,255,.4)'); });
  interact.push({ x: 18 * TS, y: 12 * TS - 10, w: 6 * TS, h: TS + 10, say: () => ['Une machine à café. Ça sent bon.', 'Les agents ne boivent pas, mais l\'ambiance y gagne.'] });
  lights.push({ x: 20 * TS + 8, y: 12 * TS, r: 30, col: 'cool', k: .25 });
  // porte
  interact.push({ x: 12 * TS, y: 16 * TS, w: 2 * TS, h: TS + 8, say: () => ['La porte donne sur le réseau Tailscale.', 'Bientôt : une carte où chaque bâtiment est un nœud du tailnet.'] });
  // tableau
  interact.push({ x: 184, y: 19, w: 64, h: 40, say: () => boardSay() });
  // collisions murs
  block(0, 0, MW, 3); block(0, MH - 1, MW, 1); block(0, 0, 1, MH); block(MW - 1, 0, 1, MH);
  blk[(MH - 1) * MW + 12] = blk[(MH - 1) * MW + 13] = 1;
  for (const o of [lights]) o.sort((a, b) => a.y - b.y);
  statics.sort((a, b) => a.sy - b.sy);
}

function drawDesk(b, d) {
  const x0 = d.tx * TS - camX, y0 = d.ty * TS - camY;
  for (let i = 0; i < 3; i++) { b.drawImage(sheet, i * 17, 0, 16, 16, x0 + i * TS, y0, 16, 16); b.drawImage(sheet, i * 17, 17, 16, 16, x0 + i * TS, y0 + TS, 16, 16); }
  // accessoires (varient selon le bureau)
  const s = d.seed;
  R(b, x0 + 3 + (s % 2) * 30, y0 + 11, 3, 4, '#f6f3ea'); R(b, x0 + 3 + (s % 2) * 30, y0 + 11, 3, 1, '#d9694a'); // mug
  R(b, x0 + 35 - (s % 2) * 28, y0 + 10, 6, 5, (s & 2) ? '#f6f3ea' : '#e8d9a8'); R(b, x0 + 36 - (s % 2) * 28, y0 + 11, 4, 1, '#b0aac8'); // papiers
  // moniteur
  const cx = x0 + 24, on = !!d.occ, t = performance.now() / 1000;
  R(b, cx - 3, y0 + 13, 6, 2, '#2a2f45'); R(b, cx - 8, y0 + 1, 16, 12, '#14172a'); R(b, cx - 8, y0 + 1, 16, 1, '#3b4268');
  if (on) {
    R(b, cx - 7, y0 + 2, 14, 9, '#14243e');
    const hh = d.occ.mode === 'work';
    for (let i = 0; i < 4; i++) { const k = hash(d.id * 31 + i + ((t * 1.6) | 0) * (i + 3)); const w = 3 + (k % 8), ind = (k >>> 4) % 3; R(b, cx - 6 + ind * 2, y0 + 3 + i * 2, w, 1, ['#6fe3b0', '#7fb4ff', '#ffd27a', '#ff9ab0'][(k >>> 8) & 3]); }
    if (((t * 2) | 0) & 1) R(b, cx - 6, y0 + 3 + 8 - 1, 2, 1, '#fff');
    R(b, cx - 7, y0 + 2, 14, 1, 'rgba(255,255,255,.10)');
  } else {
    R(b, cx - 7, y0 + 2, 14, 9, '#1c2238'); R(b, cx - 6, y0 + 3, 4, 1, '#2c3552'); R(b, cx - 5, y0 + 4, 3, 1, '#2c3552'); R(b, cx + 4, y0 + 9, 2, 1, '#2c3552');
  }
  R(b, cx - 6, y0 + 16, 12, 3, '#d4d8ec'); R(b, cx - 6, y0 + 18, 12, 1, '#8d93b4'); // clavier
  if (d.occ && d.occ.mode === 'work') { const k = (t * 8 | 0) & 3; R(b, cx - 5 + k * 2, y0 + 16, 1, 1, '#fff'); }
}

/* ───────── personnages procéduraux ───────── */
const SKINS = ['#f2cba6', '#dba374', '#b07a52', '#7d5037'];
const HAIRS = ['#2b2233', '#5a3a22', '#c9902f', '#b5482a', '#c9cbd8', '#3a5a8a', '#6a3a7a'];
const SHIRTS = ['#d9694a', '#3b9a95', '#6a7fd0', '#e0b030', '#8a5fc0', '#79b36b', '#c8506a', '#4a8fd0'];
const ROLE_SHIRT = { chef: '#e0b030', chief: '#e0b030', interactif: null, sécurité: '#c8506a', security: '#c8506a', dev: '#4a8fd0', review: '#8a5fc0', test: '#79b36b', infra: '#3b9a95' };
function mkLook(a, chief) {
  const h = hash(a.id), role = String(a.role || '').toLowerCase();
  let shirt = ROLE_SHIRT[role]; if (!shirt) shirt = SHIRTS[hash(!role || role === 'interactif' ? a.id : role) % SHIRTS.length];
  if (chief) shirt = '#e0b030';
  return { skin: SKINS[h % 4], hair: HAIRS[(h >>> 3) % HAIRS.length], style: (h >>> 7) % 3, shirt, pants: (h >>> 9) & 1 ? '#2f3a5a' : '#4a4a62', crown: !!chief, cap: null, key: '' };
}
const PLAYER_LOOK = { skin: SKINS[0], hair: '#2b2233', style: 0, shirt: '#e8ecf8', pants: '#2f3a5a', crown: false, cap: '#d9483a', key: 'P' };
function lookKey(l) { return l.key || (l.key = [l.skin, l.hair, l.style, l.shirt, l.pants, l.crown, l.cap].join('|')); }
const charCache = new Map();
function charSprite(l, dir, fr, seated, hand) {
  const k = lookKey(l) + dir + fr + (seated ? 's' + hand : '');
  let s = charCache.get(k); if (s) return s;
  s = mk(16, 21);
  if (dir === 3) { // droite = miroir de gauche
    const l2 = charSprite(l, 2, fr, false, 0), c = s.getContext('2d'); c.translate(16, 0); c.scale(-1, 1); c.drawImage(l2, 0, 0);
  } else drawChar(s.getContext('2d'), l, dir, fr, seated, hand);
  charCache.set(k, s); return s;
}
function leg(c, x, len, pn) {
  R(c, x, 17, 4, len, INK); const ih = len - 1; R(c, x + 1, 17, 2, ih - 1, pn); R(c, x + 1, 16 + ih, 2, 1, '#e9e4f4');
}
function drawChar(c, l, dir, fr, seated, hand) {
  const sk = l.skin, skS = shade(sk, .86), hr = l.hair, hrH = shade(hr, 1.35), sh = l.shirt, shS = shade(sh, .78), pn = l.pants;
  const clearPx = (x, y) => c.clearRect(x, y, 1, 1);
  // jambes
  if (!seated) {
    if (dir === 0 || dir === 1) { const a = fr === 1 ? 4 : fr === 2 ? 3 : 4, b2 = fr === 1 ? 3 : fr === 2 ? 4 : 4; leg(c, 4, a, pn); leg(c, 8, b2, pn); }
    else { const xa = fr === 0 ? 6 : fr === 1 ? 4 : 8, xb = fr === 0 ? 6 : fr === 1 ? 8 : 4; leg(c, xb, 3, pn); leg(c, xa, 4, pn); }
    R(c, 4, 15, 8, 2, INK); R(c, 5, 15, 6, 2, pn); R(c, 5, 15, 6, 1, shade(pn, 1.2));
  } else { R(c, 4, 15, 8, 2, INK); R(c, 5, 15, 6, 1, pn); }
  // torse
  if (dir === 0 || dir === 1) {
    R(c, 2, 11, 12, 4, INK); R(c, 3, 11, 10, 3, sh); R(c, 3, 14, 10, 1, shS);
    R(c, 3, 11, 1, 3, shS); R(c, 12, 11, 1, 3, shS); // manches
    const sw = seated ? 0 : (fr === 1 ? 1 : fr === 2 ? -1 : 0);
    R(c, 3, 13 + sw, 1, 2, sk); R(c, 12, 13 - sw, 1, 2, sk);
    if (seated) { R(c, 3, 14, 1, 1, sk); R(c, 12, 14, 1, 1, sk); R(c, 4, 15 + (hand ? 1 : 0), 2, 1, sk); R(c, 10, 15 + (hand ? 0 : 1), 2, 1, sk); }
    if (dir === 0) { R(c, 7, 11, 2, 1, sk); R(c, 6, 11, 4, 1, sk); R(c, 7, 12, 2, 1, skS); }
    R(c, 7, 12, 2, 1, dir === 0 ? skS : sh);
  } else {
    R(c, 5, 11, 8, 4, INK); R(c, 6, 11, 6, 3, sh); R(c, 6, 14, 6, 1, shS);
    const sw = fr === 1 ? -1 : fr === 2 ? 1 : 0;
    R(c, 7 + sw, 12, 3, 3, INK); R(c, 8 + sw, 12, 1, 2, shS); R(c, 8 + sw, 14, 1, 1, sk);
  }
  // tête
  if (dir === 0 || dir === 1) {
    R(c, 3, 1, 10, 10, INK); [[3, 1], [12, 1], [3, 10], [12, 10]].forEach(p => clearPx(p[0], p[1]));
    R(c, 4, 2, 8, 8, dir === 1 ? hr : hr);
    if (dir === 0) {
      R(c, 5, 5, 6, 5, sk); R(c, 5, 9, 6, 1, skS);
      R(c, 4, 5, 1, 3, hr); R(c, 11, 5, 1, 3, hr);
      R(c, 5, 5, 6, 1, hr); R(c, 7, 5, 2, 1, sk); // frange
      R(c, 6, 6, 1, 2, INK); R(c, 9, 6, 1, 2, INK); R(c, 6, 6, 1, 1, '#fff'); R(c, 9, 6, 1, 1, '#fff');
      R(c, 7, 9, 2, 1, '#b8605a'); R(c, 5, 8, 1, 1, 'rgba(230,110,110,.35)'); R(c, 10, 8, 1, 1, 'rgba(230,110,110,.35)');
      R(c, 5, 2, 5, 1, hrH); R(c, 4, 3, 1, 2, hrH);
    } else { R(c, 4, 2, 8, 8, hr); R(c, 5, 2, 5, 1, hrH); R(c, 6, 4, 4, 1, shade(hr, .85)); R(c, 7, 9, 2, 1, sk); }
    if (l.style === 1) { R(c, 3, 5, 1, 6, INK); R(c, 4, 5, 1, 6, hr); R(c, 12, 5, 1, 6, INK); R(c, 11, 5, 1, 6, hr); R(c, 4, 10, 1, 1, INK); R(c, 11, 10, 1, 1, INK); }
    if (l.style === 2) { R(c, 6, 0, 4, 2, INK); R(c, 7, 1, 2, 1, hr); R(c, 6, 0, 1, 1, 'rgba(0,0,0,0)'); }
  } else {
    R(c, 4, 1, 9, 10, INK); [[4, 1], [12, 1], [4, 10], [12, 10]].forEach(p => clearPx(p[0], p[1]));
    R(c, 5, 2, 7, 8, hr); R(c, 5, 5, 4, 5, sk); R(c, 5, 5, 4, 1, hr); R(c, 5, 9, 4, 1, skS);
    R(c, 6, 6, 1, 2, INK); R(c, 4, 8, 1, 1, sk); R(c, 5, 8, 1, 1, sk);
    R(c, 6, 2, 4, 1, hrH); R(c, 9, 5, 3, 4, shade(hr, .9));
    if (l.style === 1) R(c, 9, 9, 3, 2, hr);
    if (l.style === 2) { R(c, 8, 0, 3, 2, INK); R(c, 9, 1, 1, 1, hr); }
  }
  if (l.cap) {
    const cc = l.cap, cS = shade(cc, .75);
    if (dir === 0) { R(c, 3, 2, 10, 4, INK); R(c, 4, 2, 8, 3, cc); R(c, 4, 5, 8, 1, cS); R(c, 6, 5, 4, 1, INK); R(c, 7, 3, 2, 1, '#fff'); R(c, 5, 2, 3, 1, shade(cc, 1.25)); c.clearRect(3, 2, 1, 1); c.clearRect(12, 2, 1, 1); }
    else if (dir === 1) { R(c, 3, 1, 10, 6, INK); R(c, 4, 2, 8, 4, cc); R(c, 7, 2, 2, 1, cS); R(c, 5, 2, 3, 1, shade(cc, 1.25)); }
    else { R(c, 4, 2, 9, 4, INK); R(c, 5, 2, 7, 3, cc); R(c, 2, 4, 5, 2, INK); R(c, 3, 4, 4, 1, cS); R(c, 6, 2, 3, 1, shade(cc, 1.25)); }
  }
  if (l.crown) { const g = '#f0c038'; const bx0 = dir >= 2 ? 6 : 5; R(c, bx0, 1, 6, 1, INK); R(c, bx0, 2, 6, 1, g); R(c, bx0, 0, 1, 2, g); R(c, bx0 + 2, 0, 1, 2, g); R(c, bx0 + 5, 0, 1, 2, g); R(c, bx0 + 3, 2, 1, 1, '#d9483a'); }
}

/* bulles */
const GEAR = [['...#...', '.#####.', '.##.##.', '###.###', '.##.##.', '.#####.', '...#...'], ['#.....#', '.#.#.#.', '..###..', '.##.##.', '..###..', '.#.#.#.', '#.....#']];
function bubble(b, x, y, kind, t) {
  R(b, x, y + 1, 13, 11, INK); R(b, x + 1, y, 11, 13, INK); R(b, x + 1, y + 1, 11, 11, '#fff');
  R(b, x + 3, y + 13, 3, 1, INK); R(b, x + 4, y + 14, 1, 1, INK); R(b, x + 4, y + 12, 1, 2, '#fff'); R(b, x + 3, y + 12, 3, 1, '#fff');
  if (kind === 'work') { const g = GEAR[(t * 3 | 0) & 1]; for (let j = 0; j < 7; j++) for (let i = 0; i < 7; i++) if (g[j][i] === '#') R(b, x + 3 + i, y + 3 + j, 1, 1, '#4f5878'); }
  else if (kind === 'blocked') { R(b, x + 5, y + 2, 3, 6, '#e23c3c'); R(b, x + 5, y + 9, 3, 2, '#e23c3c'); }
  else if (kind === 'failed') { for (let i = 0; i < 7; i++) { R(b, x + 3 + i, y + 3 + i, 1, 1, '#e23c3c'); R(b, x + 9 - i, y + 3 + i, 1, 1, '#e23c3c'); R(b, x + 4 + i, y + 3 + i, 1, 1, '#e23c3c'); R(b, x + 8 - i, y + 3 + i, 1, 1, '#e23c3c'); } }
  else { const k = (t * 3 | 0) % 3; for (let i = 0; i < 3; i++) R(b, x + 3 + i * 3, y + 7 - (k === i ? 1 : 0), 2, 2, '#4f5878'); }
}

/* ───────── entités ───────── */
const player = { x: 12.5 * TS + 0, y: 15 * TS + 10, dir: 1, t: 0, moving: false, look: PLAYER_LOOK, sy: 0, kind: 'player' };
const npcs = []; const npcById = new Map();
player.draw = (b) => drawPerson(b, player);
function drawPerson(b, p) {
  const seated = p.seated;
  const frames = [1, 0, 2, 0];
  const fr = p.moving ? frames[(p.t * 8 | 0) & 3] : 0;
  const hand = seated && p.mode === 'work' ? ((performance.now() / 110) | 0) & 1 : 0;
  const s = charSprite(p.look, seated ? 0 : p.dir, seated ? 0 : fr, seated, hand);
  const x = Math.round(p.x) - 8 - camX, y = Math.round(p.y) - (seated ? 12 : 20) - camY;
  if (!seated) { b.fillStyle = 'rgba(8,10,40,.32)'; b.fillRect(x + 4, y + 19, 8, 2); b.fillRect(x + 3, y + 20, 10, 1); b.fillRect(x + 5, y + 21, 6, 1); }
  b.drawImage(s, 0, 0, 16, seated ? 17 : 21, x, y, 16, seated ? 17 : 21);
}

function bfs(sx, sy, gx, gy) {
  if (sx === gx && sy === gy) return [];
  const prev = new Int16Array(MW * MH).fill(-1); const q = [sy * MW + sx]; prev[sy * MW + sx] = sy * MW + sx; let qi = 0;
  while (qi < q.length) {
    const cur = q[qi++], cx = cur % MW, cy = (cur / MW) | 0;
    if (cx === gx && cy === gy) break;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = cx + dx, ny = cy + dy, ni = ny * MW + nx;
      if (nx < 1 || ny < 3 || nx >= MW - 1 || ny >= MH - 1 || prev[ni] !== -1) continue;
      if (blk[ni] && !(nx === gx && ny === gy)) continue;
      prev[ni] = cur; q.push(ni);
    }
  }
  const gi = gy * MW + gx; if (prev[gi] === -1) return null;
  const path = []; let c = gi; while (c !== sy * MW + sx) { path.push([c % MW, (c / MW) | 0]); c = prev[c]; } return path.reverse();
}

const MODE_FR = { work: 'au travail', idle: 'au repos', blocked: 'bloqué, attend une réponse', failed: 'en échec', queued: 'en file d\'attente' };
function modeOf(a) {
  const s = String(a.status || '').toLowerCase();
  if (a.busy || s === 'working') return 'work';
  if (s === 'blocked') return 'blocked'; if (s === 'failed') return 'failed'; if (s === 'queued') return 'queued';
  return 'idle';
}
function syncAgents(list) {
  const seen = new Set();
  for (const a of list) {
    seen.add(a.id);
    let n = npcById.get(a.id);
    if (!n) {
      const spawn = pickSpawn();
      n = { kind: 'npc', id: a.id, x: spawn.x, y: spawn.y, dir: 0, t: 0, moving: false, path: null, wait: 1 + Math.random() * 3, seated: false, desk: null, mode: 'idle', sy: 0, bubble: null, said: null, a, first: true };
      n.draw = (b) => { drawPerson(b, n); if (n.bubble) { const h = n.seated ? 12 : 20; bubble(b, Math.round(n.x) + 6 - camX, Math.round(n.y) - h - 17 - camY, n.bubble, performance.now() / 1000); } };
      npcById.set(a.id, n); npcs.push(n);
    }
    n.a = a; n.name = a.name || a.id; n.role = a.role || '?'; n.host = a.host || '?';
    n.look = n.look && n.lookId === a.id + (a.chief ? 'c' : '') + a.role ? n.look : (n.lookId = a.id + (a.chief ? 'c' : '') + a.role, mkLook(a, a.chief));
    const m = modeOf(a);
    if (m !== n.mode) { n.mode = m; n.path = null; if (n.sofa && m !== 'idle' && m !== 'queued') { n.sofa.occ = null; n.sofa = null; n.seated = false; n.x = Math.round(n.x / TS) * TS + 8; n.y = 14 * TS + 12; } }
    n.bubble = m === 'work' ? 'work' : m === 'blocked' ? (((performance.now() / 450) | 0) & 1 ? 'blocked' : null) : m === 'failed' ? 'failed' : m === 'queued' ? 'queued' : null;
  }
  for (let i = npcs.length - 1; i >= 0; i--) if (!seen.has(npcs[i].id)) { const n = npcs[i]; if (n.desk) n.desk.occ = null; if (n.sofa) n.sofa.occ = null; npcById.delete(n.id); npcs.splice(i, 1); }
  // affectation des bureaux
  for (const n of npcs) {
    if (n.mode === 'work') {
      if (!n.desk) { const d = desks.find(d => !d.occ); if (d) { d.occ = n; n.desk = d; n.path = null; if (n.first) { n.x = d.cx; n.y = d.seatTop + 14; n.seated = true; } } }
    } else if (n.desk) { n.desk.occ = null; n.desk = null; if (n.seated) { n.seated = false; n.y = n.y - 12; n.x = Math.round(n.x); n.y = Math.max(n.y, 3 * TS + 8); n.y = Math.round((n.y - 8) / TS) * TS + 12; } }
    n.first = false;
  }
}
function pickSpawn() { for (let i = 0; i < 40; i++) { const tx = 2 + (Math.random() * 22 | 0), ty = 12 + (Math.random() * 5 | 0); if (!isBlocked(tx, ty)) return { x: tx * TS + 8, y: ty * TS + 12 }; } return { x: 12 * TS + 8, y: 14 * TS + 12 }; }

function updateNpc(n, dt) {
  n.moving = false;
  if (n.mode === 'blocked' || n.mode === 'failed') { n.t = 0; if (n.seated) return; n.dir = 0; return; }
  if (n.mode === 'work' && n.desk) {
    if (n.seated) { n.dir = 0; return; }
    const d = n.desk, gx = d.tx + 1, gy = d.ty - 1;
    if (!n.path) { n.path = bfs(clamp(n.x / TS | 0, 0, MW - 1), clamp(((n.y - 4) / TS) | 0, 0, MH - 1), gx, gy); if (!n.path) { n.path = []; n.x = d.cx; n.y = d.seatTop + 14; n.seated = true; return; } }
    if (!followPath(n, dt, 46)) { n.seated = true; n.x = d.cx; n.y = d.seatTop + 14; n.dir = 0; n.path = null; }
    return;
  }
  // idle / queued : flâne dans le salon (ou s'assoit sur le canapé)
  if (n.seated && !n.sofa) { n.seated = false; }
  if (n.sofa) {
    if (n.seated) { n.dir = 0; n.sit -= dt; if (n.sit > 0) return; n.sofa.occ = null; n.x = n.sofa.x; n.y = 14 * TS + 12; n.seated = false; n.path = null; n.wait = 2 + Math.random() * 4; n.sofa = null; return; }
    if (n.path && n.path.length) { if (!followPath(n, dt, 24)) { n.path = null; n.seated = true; n.x = n.sofa.x; n.y = n.sofa.y; n.dir = 0; n.sit = 12 + Math.random() * 18; } return; }
    n.sofa.occ = null; n.sofa = null;
  }
  if (n.path && n.path.length) { if (!followPath(n, dt, 24)) { n.path = null; n.wait = 2 + Math.random() * 6; } return; }
  n.wait -= dt;
  if (n.wait <= 0) {
    if (Math.random() < .4) { const free = sofaSeats.filter(z => !z.occ); if (free.length) { const z = free[(Math.random() * free.length) | 0]; const p = bfs(clamp(n.x / TS | 0, 0, MW - 1), clamp(((n.y - 4) / TS) | 0, 0, MH - 1), z.tx, 14); if (p) { z.occ = n; n.sofa = z; n.path = p.length ? p : [[z.tx, 14]]; return; } } }
    for (let k = 0; k < 8; k++) {
      const gx = 2 + (Math.random() * 22 | 0), gy = Math.random() < .8 ? 12 + (Math.random() * 5 | 0) : 7 + (Math.random() * 5 | 0);
      if (isBlocked(gx, gy) || gy > MH - 2) continue;
      const p = bfs(clamp(n.x / TS | 0, 0, MW - 1), clamp(((n.y - 4) / TS) | 0, 0, MH - 1), gx, gy); if (p && p.length) { n.path = p; break; }
    }
    n.wait = 1 + Math.random() * 3;
  } else if (n.wait < .02 || (n.wait | 0) !== ((n.wait + dt) | 0)) { if (Math.random() < .3) n.dir = (Math.random() * 4) | 0; }
}
function followPath(n, dt, speed) {
  if (!n.path || !n.path.length) return false;
  const [tx, ty] = n.path[0]; const gx = tx * TS + 8, gy = ty * TS + 12;
  const dx = gx - n.x, dy = gy - n.y, d = Math.hypot(dx, dy), st = speed * dt;
  if (d <= st) { n.x = gx; n.y = gy; n.path.shift(); return n.path.length > 0; }
  const ax = Math.abs(dx) > Math.abs(dy);
  n.dir = ax ? (dx > 0 ? 3 : 2) : (dy > 0 ? 0 : 1);
  n.x += dx / d * st; n.y += dy / d * st; n.moving = true; n.t += dt; return true;
}

/* ───────── entrée ───────── */
const keys = new Set(), order = [];
const KMAP = { ArrowUp: 'u', KeyW: 'u', KeyZ: 'u', ArrowDown: 'd', KeyS: 'd', ArrowLeft: 'l', KeyA: 'l', KeyQ: 'l', ArrowRight: 'r', KeyD: 'r' };
const ACT = new Set(['Enter', 'Space', 'KeyE', 'KeyF', 'KeyJ']);
let actQueued = false;
function press(d) { if (!keys.has(d)) { keys.add(d); order.push(d); } }
function release(d) { keys.delete(d); const i = order.indexOf(d); if (i >= 0) order.splice(i, 1); }
addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
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
cv.addEventListener('pointerdown', e => { if (dlg) { actQueued = true; e.preventDefault(); } });

/* ───────── collisions joueur ───────── */
function hitsAt(x, y) {
  const x0 = Math.floor((x - 4) / TS), x1 = Math.floor((x + 3.99) / TS), y0 = Math.floor((y - 5) / TS), y1 = Math.floor((y - .01) / TS);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (isBlocked(tx, ty)) return true;
  for (const n of npcs) if (Math.abs(n.x - x) < 8 && Math.abs(n.y - y) < 6) return true;
  return false;
}
function updatePlayer(dt) {
  player.moving = false;
  if (dlg) return;
  const d = order.length ? order[order.length - 1] : null;
  if (!d) return;
  const dx = d === 'l' ? -1 : d === 'r' ? 1 : 0, dy = d === 'u' ? -1 : d === 'd' ? 1 : 0;
  player.dir = dy > 0 ? 0 : dy < 0 ? 1 : dx < 0 ? 2 : 3;
  let left = 58 * dt;
  while (left > 0) {
    const st = Math.min(left, 1); left -= st;
    const nx = player.x + dx * st, ny = player.y + dy * st;
    if (!hitsAt(nx, ny)) { if (nx !== player.x || ny !== player.y) player.moving = true; player.x = nx; player.y = ny; }
    else if (dx) { for (const s of [-1, 1]) if (!hitsAt(nx, ny + s * 1)) { player.y += s * .6; player.moving = true; break; } }
    else if (dy) { for (const s of [-1, 1]) if (!hitsAt(nx + s * 1, ny)) { player.x += s * .6; player.moving = true; break; } }
  }
  if (player.moving) player.t += dt;
}

/* ───────── texte (police Kenney Pixel + accents minuscules dessinés à la main) ───────── */
const ACC = { 'é': ['e', 'a'], 'è': ['e', 'g'], 'ê': ['e', 'c'], 'ë': ['e', 'd'], 'à': ['a', 'g'], 'â': ['a', 'c'], 'ä': ['a', 'd'], 'ù': ['u', 'g'], 'û': ['u', 'c'], 'ü': ['u', 'd'], 'ô': ['o', 'c'], 'ö': ['o', 'd'], 'î': ['i', 'c'], 'ï': ['i', 'd'], 'ç': ['c', 's'], 'É': ['E', 'a'], 'È': ['E', 'g'], 'Ê': ['E', 'c'], 'À': ['A', 'g'], 'Â': ['A', 'c'], 'Ô': ['O', 'c'], 'Î': ['I', 'c'], 'Ç': ['C', 's'], 'Ù': ['U', 'g'] };
const wcache = new Map();
function cw(c, ch) { const k = c.font + ch; let w = wcache.get(k); if (w === undefined) { w = c.measureText(ch).width; wcache.set(k, w); } return w; }
function strW(c, s) { let w = 0; for (const ch of s) { const a = ACC[ch]; w += cw(c, a ? a[0] : ch); } return w; }
function drawStr(c, s, x, yb, col) {
  c.fillStyle = col; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  const pu = Math.max(1, Math.round(parseInt(c.font) / 8)), xh = c.measureText('x').actualBoundingBoxAscent, hh = c.measureText('H').actualBoundingBoxAscent;
  for (const ch of s) {
    const a = ACC[ch], base = a ? a[0] : ch, w = cw(c, base);
    c.fillText(base, x, yb);
    if (a) {
      const cx = Math.round((x + w / 2) / pu) * pu, top = Math.round(yb - (base === base.toUpperCase() ? hh : xh) - (base === 'i' ? 2 * pu : 0)), f = (dx, dy) => c.fillRect(cx + dx * pu, top - dy * pu, pu, pu);
      if (a[1] === 'a') { f(0, 2); f(-1, 1); } else if (a[1] === 'g') { f(-1, 2); f(0, 1); }
      else if (a[1] === 'c') { f(-1, 1); f(0, 2); f(1, 1); } else if (a[1] === 'd') { f(-1, 2); f(1, 2); }
      else if (a[1] === 's') { c.fillRect(cx, yb, pu, pu); c.fillRect(cx - pu, yb + pu, pu, pu); }
    }
    x += w;
  }
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

/* ───────── dialogue ───────── */
let COLS = 38, dlg = null, HS = 16, Z = 3, bw = 100, bh = 100, W = 100, H = 100, FS = 16, dpr = 1;
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
  dlg = loading; loading.pending = true;
  const finish = (say) => {
    if (dlg !== loading) return;
    const txt = strip(say);
    let more;
    if (!txt) more = paginate(wrap('Je n\'ai encore rien dit.', mc));
    else { let t = txt; let cut = false; if (t.length > 360) { t = t.slice(0, 360).replace(/\s+\S*$/, ''); cut = true; } more = paginate(wrap('« ' + t + (cut ? ' …' : '') + ' »', mc)); more.unshift(['Mes dernières paroles :']); }
    loading.pages.push(...more); loading.pending = false;
  };
  if (DEMO || n.demo) { setTimeout(() => finish(n.demoSay), 0); return; }
  const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 3500);
  fetch('/api/transcript?id=' + encodeURIComponent(n.id) + '&n=8', { signal: ac.signal, cache: 'no-store' }).then(r => r.json()).then(j => {
    const says = (j.feed || []).filter(f => f.kind === 'say'); finish(says.length ? says[says.length - 1].text : '');
  }).catch(() => finish('')).finally(() => clearTimeout(to));
}
function boardSay() {
  let w = 0, b = 0, f = 0, i = 0; for (const n of npcs) { if (n.mode === 'work') w++; else if (n.mode === 'blocked') b++; else if (n.mode === 'failed') f++; else i++; }
  return ['Le tableau des missions.', `${w} agent(s) au travail, ${b} en attente, ${f} en échec, ${i} au repos.`];
}
function doAction() {
  if (dlg) {
    const page = dlg.pages[dlg.page], total = page.join('').length;
    if (dlg.chars < total) { dlg.chars = total; return; }
    if (dlg.page < dlg.pages.length - 1) { dlg.page++; dlg.chars = 0; return; }
    if (dlg.pending) return;
    dlg = null; return;
  }
  const d = player.dir, px = player.x + (d === 2 ? -10 : d === 3 ? 10 : 0), py = player.y + (d === 0 ? 9 : d === 1 ? -13 : -4);
  let best = null, bd = 1e9;
  for (const n of npcs) { const ox = Math.abs(px - n.x), oy = Math.abs(py - (n.y - 5)); if (ox <= 10 && oy <= 11 && ox + oy < bd) { bd = ox + oy; best = n; } }
  if (best) { best.dir = d === 0 ? 1 : d === 1 ? 0 : d === 2 ? 3 : 2; if (best.seated) best.dir = 0; talkTo(best); return; }
  for (const z of interact) {
    if (px >= z.x - 2 && px <= z.x + z.w + 2 && py >= z.y - 2 && py <= z.y + z.h + 2) {
      const t = z.say(); if (!t) continue;
      const mc = maxChars(); openDialog('', paginate(t.flatMap(s => wrap(s, mc)), 3)); return;
    }
  }
}

/* ───────── lumières ───────── */
const lightSpr = {};
function mkLightSpr(r, c0, c1) {
  return bake(r * 2, r * 2, (c) => { const g = c.createRadialGradient(r, r, 0, r, r, r); g.addColorStop(0, c0); g.addColorStop(.45, c1); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(0, 0, r * 2, r * 2); });
}
function lightSprite(col, r) {
  const k = col + r; if (lightSpr[k]) return lightSpr[k];
  const m = { warm: ['rgba(255,226,160,1)', 'rgba(255,200,110,.55)'], cool: ['rgba(150,210,255,1)', 'rgba(110,170,255,.45)'], win: ['rgba(255,250,220,1)', 'rgba(255,240,190,.5)'] }[col];
  return lightSpr[k] = mkLightSpr(r, m[0], m[1]);
}
const AMBIENT = 'rgb(178,176,214)';

/* ───────── réseau ───────── */
let lastNet = 0, netOk = false;
function demoAgents() {
  const base = [['Aria', 'dev', 'work', 'black-station', 'Je refactore le module d\'authentification, trois tests restent à passer.'], ['Bolt', 'sécurité', 'work', 'kali', 'J\'ai trouvé un port ouvert sur le routeur de la VM de test, je prépare le rapport.'],
  ['Cleo', 'review', 'idle', 'microservices', 'Relecture terminée : deux remarques mineures sur le nommage.'], ['Dax', 'infra', 'blocked', 'debians', 'Je ne peux pas continuer sans ton accord pour redémarrer le conteneur Jellyfin. Dis-moi quand c\'est bon.'],
  ['Echo', 'test', 'failed', 'black-station', 'Les tests ont échoué : la base de données de recette ne répond plus.'], ['Fenn', 'chef', 'idle', 'pve', 'Tout est sous contrôle, chef.']];
  return base.map((b, i) => ({ id: 'demo-' + i, name: b[0], role: b[1], status: b[2], busy: b[2] === 'work', host: b[3], chief: b[1] === 'chef', demo: true, demoSay: b[4] }));
}
let demoList = null;
function poll() {
  if (DEMO) { if (!demoList) { demoList = demoAgents(); syncAgents(demoList); for (const a of demoList) npcById.get(a.id).demoSay = a.demoSay, npcById.get(a.id).demo = true; } return; }
  const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 4000);
  fetch('/api/agents', { signal: ac.signal, cache: 'no-store' }).then(r => r.json()).then(j => {
    netOk = true; let list = (j.agents || []).filter(a => !a.internal);
    if (!list.length) { if (!demoList) demoList = demoAgents(); list = demoList; }
    else demoList = null;
    syncAgents(list); for (const a of list) if (a.demo) { const n = npcById.get(a.id); n.demo = true; n.demoSay = a.demoSay; }
    stats.net = list === demoList ? 'demo' : 'live';
  }).catch(() => { netOk = false; if (!npcs.length) { demoList = demoAgents(); syncAgents(demoList); for (const a of demoList) { const n = npcById.get(a.id); n.demo = true; n.demoSay = a.demoSay; } stats.net = 'demo'; } }).finally(() => clearTimeout(to));
}
const stats = { net: '-', fps: 0 };

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

const all = [];
function nameTag(n, x, y) { const t = tagCanvas(n); ctx.drawImage(t, Math.round(x - t.width / 2), Math.round(y - t.height)); }
function panel(x, y, w, h, u) {
  ctx.fillStyle = '#1c2240'; ctx.fillRect(x + u, y, w - 2 * u, h); ctx.fillRect(x, y + u, w, h - 2 * u);
  ctx.fillStyle = '#7f9ad0'; ctx.fillRect(x + u, y + u, w - 2 * u, h - 2 * u);
  ctx.fillStyle = '#fbfbff'; ctx.fillRect(x + 2 * u, y + 2 * u, w - 4 * u, h - 4 * u);
  ctx.fillStyle = '#dfe5f6'; ctx.fillRect(x + 2 * u, y + h - 3 * u, w - 4 * u, u);
}
function drawHUD() {
  let w = 0, b = 0, i = 0, f = 0; for (const n of npcs) { if (n.mode === 'work') w++; else if (n.mode === 'blocked' || n.mode === 'queued') b++; else if (n.mode === 'failed') f++; else i++; }
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
    if (left <= 0) break;
  }
  if (dlg.chars >= total) {
    const last = dlg.page === dlg.pages.length - 1;
    if (!(last && dlg.pending) && (((dlg.t * 2.2) | 0) & 1) === 0) {
      const ax = x + bwid - 9 * u, ay = y + bhei - 7 * u; ctx.fillStyle = last ? '#d9483a' : '#20243a';
      for (let r = 0; r < 4; r++) ctx.fillRect(ax + r * u, ay + r * u, (7 - 2 * r) * u, u);
    }
  }
}
function frame(now) {
  const dt = Math.min(.05, (now - frame.last) / 1000 || 0.016); frame.last = now;
  stats.fps = stats.fps * .9 + (1 / Math.max(dt, .001)) * .1;
  if (now - lastNet > 2000) { lastNet = now; poll(); }
  if (actQueued) { actQueued = false; doAction(); }
  updatePlayer(dt); for (const n of npcs) updateNpc(n, dt);
  // caméra
  const rw = MW * TS, rh = MH * TS;
  let tx = player.x - bw / 2, ty = player.y - 10 - bh / 2;
  tx = rw <= bw ? -(bw - rw) / 2 : clamp(tx, 0, rw - bw); ty = rh <= bh ? -(bh - rh) / 2 : clamp(ty, 0, rh - bh);
  if (frame.cx === undefined) { frame.cx = tx; frame.cy = ty; }
  frame.cx += (tx - frame.cx) * Math.min(1, dt * 9); frame.cy += (ty - frame.cy) * Math.min(1, dt * 9);
  camX = Math.round(frame.cx); camY = Math.round(frame.cy);
  // buffer 1x
  bx.imageSmoothingEnabled = false;
  bx.fillStyle = '#12142a'; bx.fillRect(0, 0, bw, bh);
  bx.drawImage(FL, -camX, -camY);
  all.length = 0; for (const s of statics) all.push(s);
  player.sy = player.y; all.push(player);
  for (const n of npcs) { n.sy = n.seated ? n.y + 2 : n.y; all.push(n); }
  all.sort((a, b) => a.sy - b.sy);
  for (const o of all) o.draw(bx);
  // lumières
  lx.globalCompositeOperation = 'source-over'; lx.fillStyle = AMBIENT; lx.fillRect(0, 0, bw, bh);
  lx.globalCompositeOperation = 'lighter';
  const flick = .94 + Math.sin(now / 900) * .04;
  for (const l of lights) { const s = lightSprite(l.col, l.r); lx.globalAlpha = Math.min(1, l.k * (l.col === 'warm' ? flick : 1)); lx.drawImage(s, Math.round(l.x - l.r - camX), Math.round(l.y - l.r - camY)); }
  for (const d of desks) if (d.occ) { const s = lightSprite('cool', 34); lx.globalAlpha = .55; lx.drawImage(s, d.tx * TS + 24 - 34 - camX, d.ty * TS + 18 - 34 - camY); }
  { const s = lightSprite('warm', 26); lx.globalAlpha = .25; lx.drawImage(s, Math.round(player.x - 26 - camX), Math.round(player.y - 12 - 26 - camY)); }
  lx.globalAlpha = 1;
  bx.globalCompositeOperation = 'multiply'; bx.drawImage(lcv, 0, 0); bx.globalCompositeOperation = 'source-over';
  // reflets chauds additifs
  bx.globalCompositeOperation = 'lighter';
  for (const l of lights) if (l.col === 'warm') { bx.globalAlpha = .13 * flick; bx.drawImage(lightSprite('warm', l.r), Math.round(l.x - l.r - camX), Math.round(l.y - l.r - camY)); }
  bx.globalAlpha = 1; bx.globalCompositeOperation = 'source-over';
  // écran
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#12142a'; ctx.fillRect(0, 0, W, H);
  ctx.drawImage(buf, 0, 0, bw * Z, bh * Z);
  // noms
  for (const n of npcs) nameTag(n, (n.x - camX) * Z, (n.y - (n.seated ? 12 : 20) - 1 - camY) * Z - (n.look.crown ? 3 * Z : 0));
  drawHUD();
  if (dlg) drawDialog(dt);
  // debug
  if (((frame.n = (frame.n || 0) + 1) % 10) === 0) {
    dbg.textContent = JSON.stringify({ x: Math.round(player.x), y: Math.round(player.y), dir: player.dir, dialog: dlg ? (dlg.name + '|' + dlg.pages[dlg.page].join(' / ') + '|p' + (dlg.page + 1) + '/' + dlg.pages.length + (dlg.pending ? '|pending' : '')) : null, npcs: npcs.length, work: npcs.filter(n => n.mode === 'work').length, seated: npcs.filter(n => n.seated).length, net: stats.net, fps: Math.round(stats.fps), Z, bw, bh, cam: [camX, camY], touch: isTouch, names: npcs.map(n => n.name + ':' + n.mode + ':' + Math.round(n.x) + ',' + Math.round(n.y)) });
  }
  requestAnimationFrame(frame);
}

function start() {
  resize(); buildFloor(); buildStatics();
  const sx = qs.get('px'), sy = qs.get('py'); if (sx) player.x = +sx; if (sy) player.y = +sy;
  if (qs.get('dir')) player.dir = +qs.get('dir');
  poll(); lastNet = performance.now();
  requestAnimationFrame(frame);
}
window.addEventListener('error', e => { dbg.textContent = 'ERR ' + e.message; });
})();
