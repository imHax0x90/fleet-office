/* Fleet Office · World — intérieur d'une maison (pièce de bureau du prototype, adaptée).
   Dépend de FW (sprites.js). Reconstruit à chaque entrée : nb de bureaux = nb d'agents (2..8). */
(() => {
'use strict';
const FW = window.FW;
const { TS, mk, R, clamp, rng, hash, shade, INK, CAP, CAP2, bubble, drawPerson, mkLook, bake } = FW;
const MW = 26, MH = 18, cam = FW.cam, sheet = FW.sheet;
let FL, blk, statics, interact, lights, desks, sofaSeats, npcs, npcById, nDesks = 8, house = null;
const all = [];
const SPEED_DESK = 26, SPEED_IDLE = 15;   // px/s des PNJ (réglage unique)
const fpick = a => a;
function block(tx, ty, w = 1, h = 1) { for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) if (x >= 0 && y >= 0 && x < MW && y < MH) blk[y * MW + x] = 1; }
const isBlocked = (tx, ty) => tx < 0 || ty < 0 || tx >= MW || ty >= MH || blk[ty * MW + tx] === 1;
const spr = (b, c, r, x, y) => b.drawImage(sheet, c * 17, r * 17, 16, 16, x - cam.x, y - cam.y, 16, 16);
function addObj(sy, draw) { const o = { sy, draw }; statics.push(o); return o; }
function addTiles(sy, list) { // list: [col,row,x,y]
  return addObj(sy, b => { for (const t of list) spr(b, t[0], t[1], t[2], t[3]); });
}
function shadowRect(px, py, w, h) {
  const c = FL.getContext('2d');
  R(c, px + 1, py + h - 3, w + 2, 5, 'rgba(12,14,44,.34)');
  R(c, px + w - 1, py + 3, 3, h - 3, 'rgba(12,14,44,.30)');
}
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
    if (row * 4 + i >= nDesks) return;
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
    addObj(64, b => b.drawImage(bs, bxp - cam.x, 30 - cam.y));
    block(bxp / TS, 3, 2, 1); shadowRect(bxp, 48, 32, 16);
    interact.push({ x: bxp, y: 32, w: 32, h: 32, say: () => ['Des classeurs d\'archives de sessions.', 'Une étiquette : « /sync pour rapatrier les échanges ».'] });
  }
  // racks serveurs
  for (const rx of [352, 368]) {
    addObj(64, b => { b.drawImage(rk, rx - cam.x, 30 - cam.y); const t = performance.now(); for (let i = 0; i < 6; i++) { const on = ((t / 300 + i * 3 + rx) | 0) % 5; R(b, rx + 10 - cam.x, 33 + i * 5 - cam.y, 1, 1, on === 0 ? '#ff5a4a' : '#4ae08a'); R(b, rx + 12 - cam.x, 33 + i * 5 - cam.y, 1, 1, on === 1 ? '#4a9aff' : '#2c3a5c'); } });
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
  addObj(12 * TS + 13, b => b.drawImage(sofa, 0, 0, 64, 16, 4 * TS - cam.x, 12 * TS - cam.y, 64, 16));
  addObj(14 * TS - 2, b => b.drawImage(sofa, 0, 16, 64, 16, 4 * TS - cam.x, 13 * TS - cam.y, 64, 16));
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
  addObj(14 * TS, b => b.drawImage(lp, 10 * TS - cam.x, 12 * TS - cam.y));
  lights.push({ x: 10 * TS + 8, y: 12 * TS + 10, r: 62, col: 'warm', k: .9 });
  interact.push({ x: 10 * TS, y: 12 * TS, w: 16, h: 32, say: () => ['Un lampadaire à la lumière chaude.'] });
  // kitchenette
  const kit = [0, 8, 9, 5, 6, 2];
  block(18, 12, 6, 1); shadowRect(18 * TS, 12 * TS, 6 * TS, TS);
  addObj(13 * TS, b => { kit.forEach((c, i) => spr(b, c, 12, (18 + i) * TS, 12 * TS)); });
  addObj(13 * TS + 1, b => { b.drawImage(cf, 20 * TS + 2 - cam.x, 12 * TS - 10 - cam.y); const t = performance.now() / 400; R(b, 20 * TS + 5 - cam.x, 12 * TS - 14 - cam.y - ((t | 0) & 1), 1, 3, 'rgba(255,255,255,.55)'); R(b, 20 * TS + 7 - cam.x, 12 * TS - 13 - cam.y + ((t | 0) & 1), 1, 2, 'rgba(255,255,255,.4)'); });
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
  const x0 = d.tx * TS - cam.x, y0 = d.ty * TS - cam.y;
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
      n.draw = (b) => { drawPerson(b, n); if (n.bubble) { const h = n.seated ? 12 : 20; bubble(b, Math.round(n.x) + 6 - cam.x, Math.round(n.y) - h - 17 - cam.y, n.bubble, performance.now() / 1000); } };
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
    if (!followPath(n, dt, SPEED_DESK)) { n.seated = true; n.x = d.cx; n.y = d.seatTop + 14; n.dir = 0; n.path = null; }
    return;
  }
  // idle / queued : flâne dans le salon (ou s'assoit sur le canapé)
  if (n.seated && !n.sofa) { n.seated = false; }
  if (n.sofa) {
    if (n.seated) { n.dir = 0; n.sit -= dt; if (n.sit > 0) return; n.sofa.occ = null; n.x = n.sofa.x; n.y = 14 * TS + 12; n.seated = false; n.path = null; n.wait = 2 + Math.random() * 4; n.sofa = null; return; }
    if (n.path && n.path.length) { if (!followPath(n, dt, SPEED_IDLE)) { n.path = null; n.seated = true; n.x = n.sofa.x; n.y = n.sofa.y; n.dir = 0; n.sit = 12 + Math.random() * 18; } return; }
    n.sofa.occ = null; n.sofa = null;
  }
  if (n.path && n.path.length) { if (!followPath(n, dt, SPEED_IDLE)) { n.path = null; n.wait = 2 + Math.random() * 6; } return; }
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
  n.x += dx / d * st; n.y += dy / d * st; n.moving = true; n.t += dt * speed / 30; return true;
}
function boardSay() {
  let w = 0, b = 0, f = 0, i = 0; for (const n of npcs) { if (n.mode === 'work') w++; else if (n.mode === 'blocked') b++; else if (n.mode === 'failed') f++; else i++; }
  return ['Le tableau des missions.', `${w} agent(s) au travail, ${b} en attente, ${f} en échec, ${i} au repos.`];
}
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
/* ───────── API ───────── */
function build(h, nd) {
  house = h; nDesks = clamp(nd, 2, 8);
  FL = mk(MW * TS, MH * TS); blk = new Uint8Array(MW * MH); statics = []; interact = []; lights = []; desks = []; sofaSeats = [];
  npcs = []; npcById = new Map();
  for (const k in lightSpr) delete lightSpr[k];
  buildFloor(); buildStatics();
  // extra : si peu de bureaux, un coin lecture dans la 2e rangée
  if (nDesks <= 4) {
    for (const [px, py] of [[3, 10], [22, 10]]) { block(px, py); const x = px * TS, y = py * TS; FW.shadowFlat(FL.getContext('2d'), x + 2, y, 12, 16); statics.push({ sy: py * TS + 16, draw: b => b.drawImage(sheet, 16 * 17, 0, 16, 16, x - cam.x, y - cam.y, 16, 16) }); }
    statics.sort((a, b) => a.sy - b.sy);
  }
}
function isBlk(tx, ty) { return isBlocked(tx, ty); }
function draw(bx, lx, lcv, bw, bh, now, player) {
  bx.drawImage(FL, -cam.x, -cam.y);
  all.length = 0; for (const s of statics) all.push(s);
  player.sy = player.y; all.push(player);
  for (const n of npcs) { n.sy = n.seated ? n.y + 2 : n.y; all.push(n); }
  all.sort((a, b) => a.sy - b.sy);
  for (const o of all) o.draw(bx);
  lx.globalCompositeOperation = 'source-over'; lx.fillStyle = AMBIENT; lx.fillRect(0, 0, bw, bh);
  lx.globalCompositeOperation = 'lighter';
  const flick = .94 + Math.sin(now / 900) * .04;
  for (const l of lights) { const s = lightSprite(l.col, l.r); lx.globalAlpha = Math.min(1, l.k * (l.col === 'warm' ? flick : 1)); lx.drawImage(s, Math.round(l.x - l.r - cam.x), Math.round(l.y - l.r - cam.y)); }
  for (const d of desks) if (d.occ) { const s = lightSprite('cool', 34); lx.globalAlpha = .55; lx.drawImage(s, d.tx * TS + 24 - 34 - cam.x, d.ty * TS + 18 - 34 - cam.y); }
  { const s = lightSprite('warm', 26); lx.globalAlpha = .25; lx.drawImage(s, Math.round(player.x - 26 - cam.x), Math.round(player.y - 12 - 26 - cam.y)); }
  lx.globalAlpha = 1;
  bx.globalCompositeOperation = 'multiply'; bx.drawImage(lcv, 0, 0); bx.globalCompositeOperation = 'source-over';
  bx.globalCompositeOperation = 'lighter';
  for (const l of lights) if (l.col === 'warm') { bx.globalAlpha = .13 * flick; bx.drawImage(lightSprite('warm', l.r), Math.round(l.x - l.r - cam.x), Math.round(l.y - l.r - cam.y)); }
  bx.globalAlpha = 1; bx.globalCompositeOperation = 'source-over';
}
function update(dt) { for (const n of npcs) updateNpc(n, dt); }
FW.Interior = {
  MW, MH, build, draw, update, isBlocked: isBlk, sync: l => syncAgents(l), modeOf, MODE_FR,
  get npcs() { return npcs; }, get interact() { return interact; }, get house() { return house; },
  spawn: { x: 13 * TS, y: 15 * TS + 8 }, exitTest: p => p.y > 16 * TS + 6 && p.x > 12 * TS && p.x < 14 * TS,
  counts() { let w = 0, b = 0, f = 0, i = 0; for (const n of npcs) { if (n.mode === 'work') w++; else if (n.mode === 'blocked' || n.mode === 'queued') b++; else if (n.mode === 'failed') f++; else i++; } return [w, b, f, i]; },
};
})();
