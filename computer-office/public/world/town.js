/* Fleet Office · World — la ville (carte extérieure) : génération déterministe depuis /api/world,
   sol pré-rendu dans un canvas hors-écran, objets (arbres, maisons...) triés par y et clippés. */
(() => {
'use strict';
const FW = window.FW;
const { TS, mk, R, px, ell, clamp, rng, hash, bake, INK, cam, bubble, treeSprites, houseSprite, buildingSprite, mkSign, mkDistrictSign, mkLamp, mkBench, mkMailbox, mkFountainBase } = FW;
const K = { GRASS: 0, STREET: 1, PATH: 2, PLAZA: 3, WATER: 4, SAND: 5 };
const BW = 12, BH = 7;   // grand bâtiment (tuiles)
const HW = 6, HH = 5;    // maison
let W = null, MW = 0, MH = 0, kind, blk, ground, gctx, objs = [], houses = new Map(), known = new Set(), decorated = new Set();
let lot = { w: 10, h: 9 }, first = true, sigKey = '', pond = null, plaza = null, bld = {}, nowT = 0;
const onNew = [];
const lampS = mkLamp(), benchS = mkBench(), mailS = mkMailbox(), fountS = mkFountainBase();
const glowS = bake(64, 40, c => { const g = c.createRadialGradient(32, 20, 0, 32, 20, 30); g.addColorStop(0, 'rgba(255,225,140,.55)'); g.addColorStop(1, 'rgba(255,225,140,0)'); c.fillStyle = g; c.fillRect(0, 0, 64, 40); });
const puffS = bake(10, 10, c => { ell(c, 5, 5, 4, 4, 'rgba(236,236,246,.95)'); ell(c, 4, 4, 2, 2, '#ffffff'); });

/* ───── bruit de valeur / dither pour l'herbe ───── */
const hn = (x, y) => { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const sm = t => t * t * (3 - 2 * t);
function vn(x, y) { const xi = Math.floor(x), yi = Math.floor(y), u = sm(x - xi), v = sm(y - yi); const a = hn(xi, yi), b = hn(xi + 1, yi), c = hn(xi, yi + 1), d = hn(xi + 1, yi + 1); return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v; }
const BAY = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => v / 16);
const GR = [[88, 168, 74], [101, 182, 82], [116, 197, 94]];
function paintGrass(x0, y0, w, h) {
  const im = gctx.createImageData(w, h), d = im.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const X = x0 + x, Y = y0 + y, v = vn(X / 26, Y / 26) * .62 + vn(X / 8, Y / 8) * .26 + hn(X >> 1, Y >> 1) * .12;
    const l = clamp(Math.floor(v * 3.2 - .1 + (BAY[(Y & 3) * 4 + (X & 3)] - .5) * .9), 0, 2), c = GR[l], i = (y * w + x) * 4;
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
  }
  gctx.putImageData(im, x0, y0);
}
const FLC = ['#ff7a8a', '#ffe14a', '#ffffff', '#ff9a4a', '#b99aff', '#7ad0ff'];
function flower(c, x, y, col) { px(c, x, y, '#ffd84a'); px(c, x - 1, y, col); px(c, x + 1, y, col); px(c, x, y - 1, col); px(c, x, y + 1, col); }
function tuft(c, x, y) { px(c, x, y, '#4a9a40'); px(c, x + 2, y, '#4a9a40'); px(c, x + 1, y - 1, '#4a9a40'); px(c, x + 1, y, '#3f8736'); px(c, x - 1, y + 1, '#86d16c'); }

const kd = (tx, ty) => (tx < 0 || ty < 0 || tx >= MW || ty >= MH) ? K.STREET : kind[ty * MW + tx];
const isRoad = k => k === K.STREET || k === K.PLAZA || k === K.PATH;
function bakeTile(tx, ty) {
  const k = kd(tx, ty), c = gctx, x = tx * TS, y = ty * TS, r = rng(hash(tx + ',' + ty));
  if (k === K.GRASS) {
    if (r() < .30) tuft(c, x + 2 + (r() * 11 | 0), y + 3 + (r() * 10 | 0));
    if (r() < .10) { const col = FLC[(r() * FLC.length) | 0], fx = x + 3 + (r() * 10 | 0), fy = y + 3 + (r() * 10 | 0); flower(c, fx, fy, col); if (r() < .5) flower(c, fx + 4 - (r() * 8 | 0), fy + 3, FLC[(r() * FLC.length) | 0]); }
    else if (r() < .08) { px(c, x + 4 + (r() * 8 | 0), y + 4 + (r() * 8 | 0), '#9ae07c'); }
    return;
  }
  if (k === K.STREET || k === K.PLAZA) {
    const pl = k === K.PLAZA;
    for (let by = 0; by < 4; by++) for (let bxi = 0; bxi < 4; bxi++) {
      const off = pl ? 0 : (by & 1) * 4, sh = r();
      const base = pl ? (((tx + ty + bxi + by) & 1) ? '#e4d9bd' : '#d8cba9') : (sh < .33 ? '#d9d0bb' : sh < .66 ? '#d2c8b2' : '#ddd5c2');
      if (pl) { R(c, x + bxi * 4, y + by * 4, 4, 4, base); }
      else { R(c, x + ((bxi * 4 + off) % 16), y + by * 4, 4, 4, base); if (off && bxi === 0) R(c, x, y + by * 4, 4, 4, base); }
    }
    c.fillStyle = pl ? 'rgba(150,130,90,.38)' : 'rgba(140,128,104,.45)';
    for (let i = 0; i < 4; i++) c.fillRect(x, y + i * 4 + 3, 16, 1);
    if (pl) { for (let i = 0; i < 4; i++) c.fillRect(x + i * 4 + 3, y, 1, 16); } else { for (let by = 0; by < 4; by++) for (let i = 0; i < 4; i++) c.fillRect(x + ((i * 4 + 3 + (by & 1) * 4) % 16), y + by * 4, 1, 3); }
    // bordures vers l'herbe / eau
    const soft = n => n === K.GRASS || n === K.SAND || n === K.WATER;
    if (soft(kd(tx, ty - 1))) { R(c, x, y, 16, 1, '#6f6652'); R(c, x, y + 1, 16, 1, '#b8ad92'); R(c, x, y + 2, 16, 1, '#ece6d4'); }
    if (soft(kd(tx, ty + 1))) { R(c, x, y + 13, 16, 1, '#ece6d4'); R(c, x, y + 14, 16, 1, '#b8ad92'); R(c, x, y + 15, 16, 1, '#6f6652'); }
    if (soft(kd(tx - 1, ty))) { R(c, x, y, 1, 16, '#6f6652'); R(c, x + 1, y, 1, 16, '#b8ad92'); R(c, x + 2, y, 1, 16, '#ece6d4'); }
    if (soft(kd(tx + 1, ty))) { R(c, x + 13, y, 1, 16, '#ece6d4'); R(c, x + 14, y, 1, 16, '#b8ad92'); R(c, x + 15, y, 1, 16, '#6f6652'); }
    return;
  }
  if (k === K.PATH) {
    R(c, x, y, 16, 16, '#e3cb9c');
    for (let i = 0; i < 9; i++) px(c, x + (r() * 16 | 0), y + (r() * 16 | 0), r() < .5 ? '#cdb182' : '#efdcb4');
    if (r() < .4) { const sx = x + 2 + (r() * 11 | 0), sy = y + 2 + (r() * 11 | 0); R(c, sx, sy, 2, 1, '#b79c6c'); px(c, sx, sy - 1, '#c9ad7c'); }
    const soft = n => n === K.GRASS || n === K.SAND;
    const edge = (a, b, w2, h2, dx, dy) => { R(c, x + a, y + b, w2, h2, '#bfa270'); };
    if (soft(kd(tx, ty - 1))) { edge(0, 0, 16, 1); R(c, x, y + 1, 16, 1, '#d2b886'); }
    if (soft(kd(tx, ty + 1))) { edge(0, 15, 16, 1); }
    if (soft(kd(tx - 1, ty))) { edge(0, 0, 1, 16); R(c, x + 1, y, 1, 16, '#d2b886'); }
    if (soft(kd(tx + 1, ty))) { edge(15, 0, 1, 16); }
    return;
  }
  if (k === K.SAND) {
    R(c, x, y, 16, 16, '#ecdfae'); for (let i = 0; i < 8; i++) px(c, x + (r() * 16 | 0), y + (r() * 16 | 0), r() < .5 ? '#d8c88f' : '#f7efca');
    return;
  }
  if (k === K.WATER) {
    R(c, x, y, 16, 16, '#4aa6d8'); R(c, x, y, 16, 8, '#52b0e0');
    for (let i = 0; i < 3; i++) { const sx = x + 1 + (r() * 11 | 0), sy = y + 2 + (r() * 12 | 0); R(c, sx, sy, 3, 1, '#8fd4f4'); }
    if (kd(tx, ty - 1) !== K.WATER) { R(c, x, y, 16, 2, '#2c7eae'); R(c, x, y + 2, 16, 1, '#3a92c4'); }
    if (kd(tx, ty + 1) !== K.WATER) { R(c, x, y + 14, 16, 2, '#7ac6ec'); }
    if (kd(tx - 1, ty) !== K.WATER) R(c, x, y, 2, 16, '#2c7eae');
    if (kd(tx + 1, ty) !== K.WATER) R(c, x + 14, y, 2, 16, '#2c7eae');
  }
}

/* ───── collisions / objets ───── */
function block(tx, ty, w = 1, h = 1) { for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) if (x >= 0 && y >= 0 && x < MW && y < MH) blk[y * MW + x] = 1; }
const blocked = (tx, ty) => tx < 0 || ty < 0 || tx >= MW || ty >= MH || blk[ty * MW + tx] === 1 || kind[ty * MW + tx] === K.WATER;
let dirtySort = false;
function addObj(o) { objs.push(o); dirtySort = true; return o; }
function addSpr(spr, x, y, sy, extra) { return addObj(Object.assign({ sy, x0: x, y0: y, x1: x + spr.width, y1: y + spr.height, spr, draw: b => b.drawImage(spr, x - cam.x, y - cam.y) }, extra)); }
function tree(tx, ty, r, opts = {}) {
  const pine = opts.pine !== undefined ? opts.pine : r() < .38;
  const spr = pine ? treeSprites.pine[(r() * 2) | 0] : treeSprites.oak[(r() * 3) | 0];
  const jx = opts.noj ? 0 : ((r() * 5 | 0) - 2), x = tx * TS + 8 - (spr.width >> 1) + jx, by = ty * TS + 15;
  addSpr(spr, x, by - spr.height + 3, by);
  if (!opts.nob) block(tx, ty);
}
function bush(tx, ty, r) { const s = treeSprites.bush[(r() * 3) | 0]; addSpr(s, tx * TS + 8 - 8, ty * TS + 15 - 12, ty * TS + 15); block(tx, ty); }
function bakeFence(tx, ty, gateL, gateR) {
  const c = gctx, x = tx * TS, y = ty * TS;
  R(c, x, y + 13, 16, 2, 'rgba(14,50,24,.30)');
  R(c, x, y + 5, 16, 2, '#7c789a'); R(c, x, y + 6, 16, 1, '#bdb8cf'); R(c, x, y + 10, 16, 2, '#7c789a'); R(c, x, y + 11, 16, 1, '#bdb8cf');
  for (let i = 0; i < 4; i++) { const px0 = x + 1 + i * 4; R(c, px0 - 1, y + 3, 4, 11, '#7c789a'); R(c, px0, y + 4, 2, 10, '#fbf8f0'); px(c, px0, y + 2 + 0, '#7c789a'); R(c, px0, y + 3, 2, 1, '#fbf8f0'); R(c, px0 + 1, y + 4, 1, 10, '#dcd7ea'); }
  if (gateL) { R(c, x, y + 1, 3, 14, '#7c789a'); R(c, x + 1, y + 2, 1, 12, '#fbf8f0'); }
  if (gateR) { R(c, x + 13, y + 1, 3, 14, '#7c789a'); R(c, x + 14, y + 2, 1, 12, '#fbf8f0'); }
  block(tx, ty);
}
function bakeObj(spr, x, y) { gctx.drawImage(spr, x, y); }

/* ───── layout ───── */
function layout(w) {
  const sz = w.size; MW = sz.w; MH = sz.h; lot = w.lot || lot;
  kind = new Uint8Array(MW * MH); blk = new Uint8Array(MW * MH);
  const fill = (x0, y0, x1, y1, k) => { for (let y = Math.max(0, y0); y < Math.min(MH, y1); y++) for (let x = Math.max(0, x0); x < Math.min(MW, x1); x++) kind[y * MW + x] = k; };
  const ds = w.districts || [], pz = w.plaza;
  const bands = [...new Set(ds.map(d => d.y))].sort((a, b) => a - b);
  const firstY = bands.length ? bands[0] : MH;
  const ac = pz.academy, ar = pz.arena;
  plaza = { x0: ac.x - 4, x1: ar.x + BW + 4, y0: ac.y + BH, y1: firstY - 2 };
  bld = { academy: { x: ac.x, y: ac.y }, arena: { x: ar.x, y: ar.y } };
  // place : devant les bâtiments, et passage entre eux
  fill(plaza.x0, plaza.y0, plaza.x1, plaza.y1, K.PLAZA);
  fill(ac.x + BW, ac.y, ar.x, plaza.y0, K.PLAZA);
  fill(ac.x + 1, ac.y + BH, ac.x + BW - 1, ac.y + BH + 1, K.PLAZA);
  // rues horizontales
  fill(2, firstY - 2, MW - 2, firstY, K.STREET);
  const lastStreet = [];
  for (const by of bands) { const ymax = Math.max(...ds.filter(d => d.y === by).map(d => d.y + d.h)); fill(2, ymax, MW - 2, ymax + 2, K.STREET); lastStreet.push(ymax + 1); }
  // ruelles entre deux rangées de lots d'un même quartier
  for (const d of ds) for (let j = 1; j < Math.floor((d.h - 2) / lot.h); j++) fill(Math.max(2, d.x - 2), d.y + 2 + j * lot.h, Math.min(MW - 2, d.x + d.w + 2), d.y + 3 + j * lot.h, K.PATH);
  // avenues dans les interstices
  const gx = new Set();
  for (const by of bands) { const row = ds.filter(d => d.y === by).sort((a, b) => a.x - b.x); for (let i = 0; i + 1 < row.length; i++) gx.add(Math.round((row[i].x + row[i].w + row[i + 1].x) / 2)); }
  const endY = lastStreet.length ? lastStreet[lastStreet.length - 1] + 1 : MH - 2;
  for (const x of gx) fill(x - 1, plaza.y1, x + 1, endY, K.STREET);
  // allée centrale de la place vers la 1re rue
  fill(plaza.x0, plaza.y1 - 0, plaza.x1, firstY - 2, K.PLAZA);
  // mare
  pond = null;
  if (MW >= 60) { const cx = Math.round(MW * .13), cy = Math.max(6, Math.round(ac.y + 4)); pond = { cx, cy, rx: 5.2, ry: 3.4 }; for (let y = cy - 6; y <= cy + 6; y++) for (let x = cx - 8; x <= cx + 8; x++) { const d = ((x - cx) / pond.rx) ** 2 + ((y - cy) / pond.ry) ** 2; if (d <= 1) fill(x, y, x + 1, y + 1, K.WATER); else if (d <= 1.9) fill(x, y, x + 1, y + 1, K.SAND); } }
}
function houseGeom(h) { const hx = h.x + ((lot.w - HW) >> 1), hy = h.y + 1; return { hx, hy, ly: h.y, lx: h.x }; }

function setPath(h) { const g = houseGeom(h); for (let y = g.hy + HH; y < h.y + lot.h; y++) for (const x of [g.hx + 2, g.hx + 3]) if (x < MW && y < MH) kind[y * MW + x] = K.PATH; }

function repaintRect(tx0, ty0, tw, th) {
  tx0 = Math.max(0, tx0); ty0 = Math.max(0, ty0); tw = Math.min(MW - tx0, tw); th = Math.min(MH - ty0, th);
  paintGrass(tx0 * TS, ty0 * TS, tw * TS, th * TS);
  for (let y = ty0; y < ty0 + th; y++) for (let x = tx0; x < tx0 + tw; x++) bakeTile(x, y);
}

/* ───── décor des lots ───── */
function decorLot(lx, ly) {
  const key = lx + ',' + ly; if (decorated.has(key)) return; decorated.add(key);
  const r = rng(hash('lot' + key));
  for (const ty of [ly + 1, ly + 4, ly + 7]) {
    if (r() < .75) tree(lx, ty + (r() * 2 | 0), r, { noj: false });
    if (r() < .75) tree(lx + lot.w - 1, ty + (r() * 2 | 0), r);
  }
  for (const c of [lx + 1, lx + lot.w - 2]) if (r() < .5) bush(c, ly + 1 + (r() * 3 | 0), r);
}
function meadowLot(lx, ly) { // lot vide : fleurs et quelques pierres
  const key = 'm' + lx + ',' + ly; if (decorated.has(key)) return; decorated.add(key);
  const r = rng(hash(key));
  for (let i = 0; i < 26; i++) flower(gctx, lx * TS + 40 + (r() * (lot.w * TS - 80) | 0), ly * TS + 20 + (r() * ((lot.h - 2) * TS - 20) | 0), FLC[(r() * FLC.length) | 0]);
}
function paintHouseGround(h) {
  const g = houseGeom(h), c = gctx, x = g.hx * TS, y = g.hy * TS;
  // ombre portée (lumière haut-gauche)
  c.fillStyle = 'rgba(12,40,24,.26)'; c.fillRect(x + 94, y + 24, 10, 60); c.fillRect(x + 6, y + HH * TS, HW * TS + 4, 5); c.fillRect(x + 94, y + 80, 10, 3);
  c.fillStyle = 'rgba(12,40,24,.14)'; c.fillRect(x + 104, y + 36, 3, 46); c.fillRect(x + 8, y + HH * TS + 5, HW * TS + 4, 2);
}
function paintGarden(o) {
  if (o.gardenDone) return; o.gardenDone = true;
  const h = o.d, g = o.g, c = gctx, r = rng(hash(h.id + 'g'));
  // fleurs sous la façade
  for (const tx of [g.hx, g.hx + 1, g.hx + 4, g.hx + 5]) {
    const ty = g.hy + HH; if (blocked(tx, ty) && kind[ty * MW + tx] !== K.GRASS) continue;
    for (let i = 0; i < 5; i++) flower(c, tx * TS + 3 + (r() * 10 | 0), ty * TS + 4 + (r() * 9 | 0), FLC[(r() * FLC.length) | 0]);
  }
  bush(g.hx - 0, g.hy + HH, r); bush(g.hx + 5, g.hy + HH, r);
  // panneau en bois avec le nom
  const sp = mkSign(h.name, 32), sx = (g.hx + 4) * TS, sy = (g.hy + HH + 1) * TS - 6;
  c.drawImage(sp, sx, sy); block(g.hx + 4, g.hy + HH + 1, 2, 1);
  o.signPos = { x: sx + 16, y: sy + 8 };
  // clôture sur certains jardins, boîte aux lettres sinon
  const fy = g.ly + lot.h - 1;
  if ((hash(h.id) >> 3) % 2 === 0) {
    for (let tx = g.lx + 1; tx <= g.lx + lot.w - 2; tx++) { if (tx === g.hx + 2 || tx === g.hx + 3) continue; if (tx === g.hx + 4) continue; bakeFence(tx, fy, tx === g.hx + 1, tx === g.hx + 4 || false); }
  } else { for (const tx of [g.lx + 1, g.lx + 2, g.lx + lot.w - 3]) if (r() < .8) flower(c, tx * TS + 8, fy * TS + 8, FLC[(r() * FLC.length) | 0]); }
  c.drawImage(mailS, (g.hx + 4) * TS + 3, fy * TS - 2);
  if ((hash(h.id) >> 5) % 3 === 0) { c.drawImage(benchS, (g.hx - 2) * TS + 2, (g.hy + HH + 1) * TS - 1); block(g.hx - 2, g.hy + HH + 1, 2, 1); }
}

/* ───── maisons ───── */
function addHouse(h, animate) {
  const g = houseGeom(h);
  const o = houses.get(h.id) || { id: h.id };
  o.d = h; o.g = g; o.born = animate ? performance.now() : 0;
  o.gardenDone = false;
  houses.set(h.id, o);
  setPath(h);
  block(g.hx, g.hy, HW, HH);
  // la porte (2 tuiles, rangée du bas) est franchissable
  for (const dx of [2, 3]) blk[(g.hy + HH - 1) * MW + g.hx + dx] = 0;
  o.door = { x0: (g.hx + 2) * TS, x1: (g.hx + 4) * TS, y: (g.hy + HH) * TS };
  const spr0 = g.hx * TS, spy0 = g.hy * TS - 8;
  o.obj = addObj({ sy: (g.hy + HH) * TS - 1, x0: spr0 - 6, y0: spy0 - 26, x1: spr0 + 102, y1: spy0 + 92, draw: b => drawHouse(b, o) });
  repaintRect(g.lx, g.ly, lot.w, lot.h + 1);
  paintHouseGround(h);
  if (animate) o.gardenAt = o.born + 2300; else paintGarden(o);
  return o;
}
function drawHouse(b, o) {
  const h = o.d, g = o.g, lit = h.working > 0, x = g.hx * TS - cam.x, y = g.hy * TS - 8 - cam.y, now = nowT;
  if (o.born) {
    const t = (now - o.born) / 1000;
    if (t < 2.6) { drawBuild(b, o, t, x, y); return; }
    o.born = 0;
  }
  b.drawImage(houseSprite(h.style, lit), x, y);
  if (lit) {
    b.globalCompositeOperation = 'lighter'; b.globalAlpha = .55 + .1 * Math.sin(now / 500 + g.hx);
    b.drawImage(glowS, x + 8 - 8, y + 70, 40, 24); b.drawImage(glowS, x + 60, y + 70, 40, 24);
    b.globalAlpha = 1; b.globalCompositeOperation = 'source-over';
  }
}
function drawBuild(b, o, t, x, y) {
  const h = o.d, base = y + 88;
  // échafaudage
  const sc = clamp(t / 0.8, 0, 1) * (t > 2.0 ? clamp(1 - (t - 2.0) / .5, 0, 1) : 1);
  if (sc > 0) {
    const hh = Math.round(72 * sc);
    b.fillStyle = INK; for (const px0 of [2, 30, 66, 94]) b.fillRect(x + px0, base - hh, 3, hh);
    b.fillStyle = '#c99a5a'; for (const px0 of [2, 30, 66, 94]) b.fillRect(x + px0 + 1, base - hh, 1, hh);
    for (let yy = 12; yy < hh; yy += 18) { b.fillStyle = INK; b.fillRect(x + 1, base - yy - 2, 96, 4); b.fillStyle = '#e0b878'; b.fillRect(x + 2, base - yy - 1, 94, 2); }
    b.fillStyle = INK; for (let k = 0; k < 3; k++) { const yy = 12 + k * 18; if (yy + 18 < hh) for (let s = 0; s < 18; s++) { b.fillRect(x + 4 + s, base - yy - s, 1, 1); b.fillRect(x + 94 - s, base - yy - s, 1, 1); } }
  }
  // la maison monte du sol
  const rev = clamp((t - .7) / 1.5, 0, 1), rh = Math.round(88 * rev);
  if (rh > 0) { b.drawImage(houseSprite(h.style, false), 0, 88 - rh, 96, rh, x, base - rh, 96, rh); }
  // nuages de poussière
  for (let i = 0; i < 14; i++) {
    const ph = (t * .9 + i * .37) % 1, side = (i * 53) % 100 / 100, px0 = x + 4 + side * 88 + Math.sin(t * 3 + i) * 5, py0 = base - 2 - ph * 24 - (i % 3) * 3;
    b.globalAlpha = (1 - ph) * (t > 2.2 ? clamp(1 - (t - 2.2) / .4, 0, 1) : 1) * .9; b.drawImage(puffS, Math.round(px0 - 5 - ph * 4), Math.round(py0 - 5), Math.round(10 + ph * 8), Math.round(10 + ph * 8));
  }
  b.globalAlpha = 1;
}
function drawOverlays(b, bw, bh, now) {
  for (const o of houses.values()) {
    const h = o.d, g = o.g, hx = g.hx * TS, hy = g.hy * TS;
    if (hx - cam.x > bw + 20 || hx - cam.x < -120 || hy - cam.y > bh + 20 || hy - cam.y < -60) continue;
    if (o.born) continue;
    if (h.working > 0) { // fumée de cheminée
      const cx = hx + 72 - cam.x, cy = hy - 8 - cam.y;
      for (let i = 0; i < 5; i++) { const ph = (now / 2600 + i * .2 + g.hx * .13) % 1; b.globalAlpha = (1 - ph) * .85; const s = Math.round(5 + ph * 8); b.drawImage(puffS, Math.round(cx - s / 2 + Math.sin(ph * 6 + i) * 3 + ph * 7), Math.round(cy - 4 - ph * 30 - s / 2), s, s); }
      b.globalAlpha = 1;
    }
    const bl = h.blocked > 0, fl = h.failed > 0;
    if (bl || fl) {
      const show = bl ? (((now / 450) | 0) & 1) === 0 : true, kindB = bl && (!fl || (((now / 1500) | 0) & 1) === 0) ? 'blocked' : 'failed';
      if (show) bubble(b, Math.round(hx + 42 - cam.x), Math.round(hy - 36 - cam.y - Math.abs(Math.sin(now / 300)) * 2), kindB, now / 1000);
    }
  }
}

/* ───── bâtiments, fontaine, place ───── */
function addBuilding(kindName) {
  const p = bld[kindName], x = p.x * TS, y = p.y * TS - 24, spr = buildingSprite(kindName);
  addObj({ sy: (p.y + BH) * TS - 1, x0: x - 4, y0: y - 4, x1: x + 196, y1: y + 140, draw: b => b.drawImage(spr, x - cam.x, y - cam.y) });
  block(p.x, p.y, BW, BH); for (const dx of [5, 6]) blk[(p.y + BH - 1) * MW + p.x + dx] = 0;
  // ombre
  gctx.fillStyle = 'rgba(12,40,24,.24)'; gctx.fillRect(x + 192, y + 52, 10, 108); gctx.fillRect(x + 4, (p.y + BH) * TS, 192, 6);
  p.door = { x0: (p.x + 5) * TS, x1: (p.x + 7) * TS, y: (p.y + BH) * TS };
}
function addFountain() {
  const ac = bld.academy, cx = Math.round((ac.x + BW + bld.arena.x) / 2), fx = cx * TS - 34, fy = (ac.y + BH) * TS + 2;
  const o = addObj({ sy: fy + 50, x0: fx, y0: fy - 10, x1: fx + 68, y1: fy + 52, draw: b => {
    b.drawImage(fountS, fx - cam.x, fy - cam.y);
    const t = nowT / 1000;
    for (let i = 0; i < 9; i++) { const ph = (t * 1.1 + i * .111) % 1, a = i * 0.7, rr = ph * 11; const x = fx + 34 + Math.cos(a) * rr * .9 - cam.x, y = fy + 18 + 6 * ph - Math.sin(ph * Math.PI) * 14 - cam.y; b.fillStyle = '#e8f8ff'; b.fillRect(Math.round(x), Math.round(y), 1, 2); }
    for (let i = 0; i < 6; i++) { const ph = (t * 1.6 + i * .17) % 1; b.fillStyle = '#ffffff'; b.fillRect(fx + 34 - cam.x + ((i % 3) - 1) * 2, Math.round(fy + 18 - ph * 12 - cam.y), 1, 2); }
    b.fillStyle = 'rgba(255,255,255,.7)'; for (let i = 0; i < 5; i++) { const ph = (t * .8 + i * .21) % 1; b.fillRect(fx + 12 + ((i * 11) % 44) - cam.x, fy + 30 + (i % 2) * 5 - cam.y, ph < .5 ? 2 : 1, 1); }
  } });
  block(cx - 2, ac.y + BH, 4, 3);
  // bancs
  for (const [bx0, by0] of [[cx - 6, ac.y + BH + 2], [cx + 4, ac.y + BH + 2]]) { addSpr(benchS, bx0 * TS - 1, by0 * TS, by0 * TS + 16); block(bx0, by0, 2, 1); }
  return { cx, cy: ac.y + BH + 2 };
}
function addLamp(tx, ty) { addSpr(lampS, tx * TS + 2, ty * TS - 18, ty * TS + 15); block(tx, ty); }

function decorWorld(w) {
  const r = rng(4242);
  // forêt de bordure : 2 rangées
  for (let tx = 0; tx < MW; tx++) for (const ty of [0, 1, MH - 2, MH - 1]) { const o = ty === 0 || ty === MH - 2 ? 0 : 0; tree(tx, ty, r, { nob: true }); }
  for (let ty = 2; ty < MH - 2; ty++) for (const tx of [0, 1, MW - 2, MW - 1]) tree(tx, ty, r, { nob: true });
  for (let ty = 0; ty < MH; ty++) for (let tx = 0; tx < MW; tx++) if (tx < 2 || ty < 2 || tx >= MW - 2 || ty >= MH - 2) block(tx, ty);
  for (let tx = 0; tx < MW; tx++) for (const ty of [1, MH - 1]) if (r() < .7) tree(tx, ty, r, { nob: true, noj: false });
  // grands bâtiments + fontaine
  addBuilding('academy'); addBuilding('arena');
  const fo = addFountain();
  // lampadaires de la place
  for (const [x, y] of [[plaza.x0 + 1, plaza.y0 + 1], [plaza.x1 - 2, plaza.y0 + 1], [bld.academy.x + 2, plaza.y0], [bld.arena.x + BW - 3, plaza.y0], [fo.cx - 4, plaza.y0 + 2], [fo.cx + 3, plaza.y0 + 2], [plaza.x0 + 1, plaza.y1 - 1], [plaza.x1 - 2, plaza.y1 - 1]]) addLamp(x, y);
  // massifs de fleurs et buissons sur la place
  for (const [x, y] of [[bld.academy.x + 1, plaza.y0], [bld.academy.x + BW - 2, plaza.y0], [bld.arena.x + 1, plaza.y0], [bld.arena.x + BW - 2, plaza.y0]]) { bush(x, y, r); }
  // mare : roseaux, nénuphars
  if (pond) {
    for (let i = 0; i < 6; i++) { const a = r() * 6.28, x = pond.cx * TS + 8 + Math.cos(a) * 22 * (.4 + r() * .5), y = pond.cy * TS + 8 + Math.sin(a) * 14 * (.4 + r() * .5); ell(gctx, Math.round(x), Math.round(y), 3, 2, '#3f9a4a'); px(gctx, Math.round(x) + 1, Math.round(y) - 1, '#ff9ab0'); px(gctx, Math.round(x), Math.round(y), '#2d7a3a'); }
    for (let tx = pond.cx - 7; tx <= pond.cx + 7; tx++) for (let ty = pond.cy - 5; ty <= pond.cy + 5; ty++) if (kd(tx, ty) === K.SAND && r() < .22) { const x = tx * TS + 4 + (r() * 8 | 0), y = ty * TS + 14; R(gctx, x, y - 9, 1, 9, '#4a8a3a'); R(gctx, x + 2, y - 7, 1, 7, '#5aa04a'); R(gctx, x - 1, y - 11, 3, 4, '#7a5a30'); }
    bakeObj(benchS, (pond.cx + 1) * TS, (pond.cy + 5) * TS); block(pond.cx + 1, pond.cy + 5, 2, 1);
  }
  // arbres épars (bosquets) dans la partie haute et sur les côtés de la place
  for (let ty = 3; ty < plaza.y1; ty++) for (let tx = 3; tx < MW - 3; tx++) {
    if (kd(tx, ty) !== K.GRASS || blk[ty * MW + tx]) continue;
    if (tx >= bld.academy.x - 1 && tx <= bld.arena.x + BW) { if (ty < plaza.y0 + 1) continue; }
    if (pond && Math.abs(tx - pond.cx) < 9 && Math.abs(ty - pond.cy) < 7) continue;
    let near = false; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (isRoad(kd(tx + dx, ty + dy))) near = true; if (near) continue;
    const n = vn(tx / 4.5 + 9, ty / 4.5 + 3);
    if (n > .6 && r() < .6) tree(tx, ty, r); else if (r() < .015) bush(tx, ty, r);
  }
  // parterre fleuri à droite de la place
  { const x0 = plaza.x1 + 3, y0 = plaza.y0 + 1; if (x0 + 8 < MW - 3) for (let i = 0; i < 70; i++) flower(gctx, x0 * TS + (r() * 8 * TS | 0), y0 * TS + (r() * 4 * TS | 0), FLC[(r() * FLC.length) | 0]); }
  // lots
  const slots = new Map();
  for (const d of w.districts) for (let j = 0; j < Math.max(1, Math.floor((d.h - 2) / lot.h)); j++) for (let i = 0; i < Math.floor(d.w / lot.w); i++) slots.set((d.x + i * lot.w) + ',' + (d.y + 2 + j * lot.h), [d.x + i * lot.w, d.y + 2 + j * lot.h]);
  for (const h of w.houses) slots.set(h.x + ',' + h.y, [h.x, h.y]);
  const hset = new Set(w.houses.map(h => h.x + ',' + h.y));
  for (const [k, [lx, ly]] of slots) { decorLot(lx, ly); if (!hset.has(k)) meadowLot(lx, ly); }
  // panneaux de quartier + lampadaires de rue
  for (const d of w.districts) { const s = mkDistrictSign(d.name), x = (d.x + 1) * TS, y = d.y * TS + 1; gctx.drawImage(s, x, y); block(d.x + 1, d.y + 1, 4, 1); d.signPos = { x: x + 32, y: y + 12 }; }
  const bands = [...new Set(w.districts.map(d => d.y + d.h))];
  for (const yb of bands) for (let x = 6; x < MW - 4; x += 10) { if (kd(x, yb + 2) === K.GRASS && !blk[(yb + 2) * MW + x]) addLamp(x, yb + 2); }
}

/* ───── API ───── */
function fullBuild(w) {
  layout(w); decorated = new Set(); objs = [];
  const oldHouses = houses; houses = new Map();
  ground = mk(MW * TS, MH * TS); gctx = ground.getContext('2d');
  for (const h of w.houses) setPath(h);
  paintGrass(0, 0, MW * TS, MH * TS);
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) bakeTile(x, y);
  decorWorld(w);
  for (const h of w.houses) {
    const old = oldHouses.get(h.id), o = addHouse(h, false);
    if (old && old.born) o.born = old.born;
  }
  objs.sort((a, b) => a.sy - b.sy); dirtySort = false;
}
function setWorld(w, serverTime) {
  if (!w || !w.size || !w.plaza) return [];
  const created = [];
  const key = JSON.stringify([w.size, w.lot, w.districts.map(d => [d.name, d.x, d.y, d.w, d.h]), w.plaza]);
  const ids = new Set(w.houses.map(h => h.id));
  const geomChanged = [...houses.values()].some(o => !ids.has(o.id) || o.g.lx !== (w.houses.find(h => h.id === o.id) || {}).x || o.g.ly !== (w.houses.find(h => h.id === o.id) || {}).y);
  const nowSrv = serverTime || Date.now();
  const fresh = w.houses.filter(h => !known.has(h.id));
  if (!W || key !== sigKey || geomChanged) {
    sigKey = key; W = w;
    for (const h of fresh) if (nowSrv - h.createdAt < 60000 || !first) { h._anim = true; created.push(h); }
    for (const h of w.houses) known.add(h.id);
    fullBuild(w);
    for (const h of created) { const o = houses.get(h.id); if (o) o.born = performance.now(); }
  } else {
    W = w;
    for (const h of w.houses) { const o = houses.get(h.id); if (o) { o.d = h; } }
    for (const h of fresh) {
      known.add(h.id);
      if (!first || nowSrv - h.createdAt < 60000) { created.push(h); addHouse(h, true); } else { addHouse(h, false); }
    }
    if (dirtySort) { objs.sort((a, b) => a.sy - b.sy); dirtySort = false; }
  }
  first = false;
  return created;
}
function update(dt, now) {
  nowT = now;
  for (const o of houses.values()) if (o.gardenAt && now >= o.gardenAt) { o.gardenAt = 0; paintGarden(o); if (dirtySort) { objs.sort((a, b) => a.sy - b.sy); dirtySort = false; } }
}
function lower(y) { let lo = 0, hi = objs.length; while (lo < hi) { const m = (lo + hi) >> 1; if (objs[m].sy < y) lo = m + 1; else hi = m; } return lo; }
function draw(bx, bw, bh, now, player) {
  nowT = now;
  bx.drawImage(ground, -cam.x, -cam.y);
  let i = lower(cam.y - 10), pd = false;
  const yMax = cam.y + bh + 170;
  for (; i < objs.length; i++) {
    const o = objs[i]; if (o.sy > yMax) break;
    if (!pd && player.y < o.sy) { player.draw(bx); pd = true; }
    if (o.x1 < cam.x || o.x0 > cam.x + bw || o.y1 < cam.y || o.y0 > cam.y + bh) continue;
    o.draw(bx);
  }
  if (!pd) player.draw(bx);
  drawOverlays(bx, bw, bh, now);
  // scintillements sur l'eau
  if (pond) { bx.fillStyle = 'rgba(255,255,255,.75)'; for (let k = 0; k < 7; k++) { const t = now / 700 + k * 1.9, x = pond.cx * TS + 8 + Math.cos(k * 2.3) * 30 * (.4 + .6 * Math.abs(Math.sin(k))), y = pond.cy * TS + 8 + Math.sin(k * 1.7) * 18 * .8; if (((t | 0) + k) % 3 === 0) bx.fillRect(Math.round(x - cam.x), Math.round(y - cam.y), 3, 1); } }
}
function doorAt(p) {
  for (const o of houses.values()) { const d = o.door; if (p.x > d.x0 + 2 && p.x < d.x1 - 2 && p.y < d.y + 2 && p.y > d.y - 14) return { type: 'house', house: o.d }; }
  for (const k of ['academy', 'arena']) { const b = bld[k]; if (b && b.door && p.x > b.door.x0 + 2 && p.x < b.door.x1 - 2 && p.y < b.door.y + 2 && p.y > b.door.y - 14) return { type: k }; }
  return null;
}
function nearHouse(p) {
  let best = null, bd = 1e9;
  for (const o of houses.values()) { const cx = (o.g.hx + 3) * TS, cy = (o.g.hy + HH + 1) * TS, d = Math.hypot(p.x - cx, p.y - cy); if (d < 52 && d < bd) { bd = d; best = o; } }
  if (best) return { house: best.d, label: best.d.name };
  for (const d of (W ? W.districts : [])) if (d.signPos && Math.hypot(p.x - d.signPos.x, p.y - (d.signPos.y + 16)) < 40) return { district: d, label: d.name };
  for (const k of ['academy', 'arena']) { const b = bld[k]; if (b && Math.hypot(p.x - (b.x + 6) * TS, p.y - (b.y + BH + 1) * TS) < 50) return { building: k, label: k === 'academy' ? 'Académie' : 'Arène' }; }
  return null;
}
function spawnPos(h) { const g = houseGeom(h); return { x: (g.hx + 3) * TS, y: (g.hy + HH) * TS + 12 }; }
FW.Town = {
  setWorld, update, draw, blocked, doorAt, nearHouse, spawnPos, houses,
  get w() { return MW * TS; }, get h() { return MH * TS; }, get tw() { return MW; }, get th() { return MH; },
  get data() { return W; }, get ready() { return !!W; }, plazaSpawn: () => W ? { x: W.plaza.spawn.x * TS + 8, y: W.plaza.spawn.y * TS + 12 } : { x: 100, y: 100 },
  doorOf(id) { const o = houses.get(id); return o ? { x: (o.g.hx + 3) * TS, y: (o.g.hy + HH) * TS } : null; },
  buildingDoor(k) { const b = bld[k]; return b ? { x: (b.x + 6) * TS, y: (b.y + BH) * TS } : null; },
};
})();
