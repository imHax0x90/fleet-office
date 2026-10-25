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
  addSpr(spr, x, by - spr.height + 3, by, { prop: (pine ? 'pine' : 'oak') + (pine ? treeSprites.pine : treeSprites.oak).indexOf(spr) });
  if (!opts.nob) block(tx, ty);
}
function bush(tx, ty, r) { const s = treeSprites.bush[(r() * 3) | 0]; addSpr(s, tx * TS + 8 - 8, ty * TS + 15 - 12, ty * TS + 15, { prop: 'bush' + treeSprites.bush.indexOf(s) }); block(tx, ty); }
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
  if (r() < .6) tallGrassPatch(lx + 2, ly + 2, 6, 4, r);
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
  clearTallGrass(g.lx, g.ly, lot.w, lot.h + 1);
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
function addBuilding(kindName, noShadow) {
  const p = bld[kindName], x = p.x * TS, y = p.y * TS - 24, spr = buildingSprite(kindName);
  addObj({ sy: (p.y + BH) * TS - 1, x0: x - 4, y0: y - 4, x1: x + 196, y1: y + 140, draw: b => b.drawImage(spr, x - cam.x, y - cam.y) });
  block(p.x, p.y, BW, BH); for (const dx of [5, 6]) blk[(p.y + BH - 1) * MW + p.x + dx] = 0;
  // ombre
  if (!noShadow) { gctx.fillStyle = 'rgba(12,40,24,.24)'; gctx.fillRect(x + 192, y + 52, 10, 108); gctx.fillRect(x + 4, (p.y + BH) * TS, 192, 6); }
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
function addLamp(tx, ty) { addSpr(lampS, tx * TS + 2, ty * TS - 18, ty * TS + 15, { prop: 'lamp' }); block(tx, ty); }

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

/* ═════════ Carte Tiled (https://www.mapeditor.org) : export de la ville, chargement d'une carte éditée ═════════
   Éditable à la main : sol (tuiles), décor peint (image), objets (arbres, buissons, lampadaires, herbes), collisions.
   Reste piloté par le serveur : maisons, grands bâtiments, fontaine, panneaux de quartier, villageois.
   Une carte n'est valable que pour la même grille (taille, quartiers, place) : sinon la ville revient à la génération procédurale. */
const worldKey = w => JSON.stringify([w.size, w.lot, (w.districts || []).map(d => [d.name, d.x, d.y, d.w, d.h]), w.plaza]);
let userMap = null, mapStatus = 'procédurale';
const KIND_NAME = ['grass', 'street', 'path', 'plaza', 'water', 'sand'], KIND_ID = { grass: 0, street: 1, path: 2, plaza: 3, water: 4, sand: 5 };
const propSprites = () => { const o = {}; treeSprites.oak.forEach((s, i) => o['oak' + i] = s); treeSprites.pine.forEach((s, i) => o['pine' + i] = s); treeSprites.bush.forEach((s, i) => o['bush' + i] = s); o.lamp = lampS; tuftS.forEach((s, i) => o['tuft' + i] = s); return o; };
function tileDefs() {   // ordre FIXE du tileset de sol (92 tuiles) : herbe ×8, sable ×4, puis rue / place (2 parités) / chemin / eau × 16 bordures
  const defs = []; for (let v = 0; v < 8; v++) defs.push({ k: K.GRASS, v }); for (let v = 0; v < 4; v++) defs.push({ k: K.SAND, v });
  for (const k of [K.STREET]) for (let m = 0; m < 16; m++) defs.push({ k, m, par: 0 });
  for (let p = 0; p < 2; p++) for (let m = 0; m < 16; m++) defs.push({ k: K.PLAZA, m, par: p });
  for (const k of [K.PATH, K.WATER]) for (let m = 0; m < 16; m++) defs.push({ k, m, par: 0 });
  return defs;
}
const softOf = (k, n) => k === K.WATER ? n !== K.WATER : k === K.PATH ? (n === K.GRASS || n === K.SAND) : (n === K.GRASS || n === K.SAND || n === K.WATER);
function maskAt(x, y) { const k = kd(x, y); let m = 0; if (softOf(k, kd(x, y - 1))) m |= 1; if (softOf(k, kd(x, y + 1))) m |= 2; if (softOf(k, kd(x - 1, y))) m |= 4; if (softOf(k, kd(x + 1, y))) m |= 8; return m; }
function renderCanon(def) {   // dessine UNE tuile canonique avec le vrai code de bakeTile, sur un mini-monde temporaire
  const sv = { MW, MH, kind, gctx }; let cx = 1, cy = 1;
  try {
    const out = mk(16, 16);
    if (def.k === K.GRASS || def.k === K.SAND) { MW = 12; MH = 1; kind = new Uint8Array(12).fill(def.k); gctx = mk(MW * 16, 16).getContext('2d'); bakeTile(def.v, 0); out.getContext('2d').drawImage(gctx.canvas, def.v * 16, 0, 16, 16, 0, 0, 16, 16); return out; }
    MW = 3; MH = 4; cy = 1 + def.par; kind = new Uint8Array(12).fill(def.k);
    const set = (x, y, soft) => { kind[y * 3 + x] = soft ? K.GRASS : def.k; };
    set(1, cy - 1, def.m & 1); set(1, cy + 1, def.m & 2); set(0, cy, def.m & 4); set(2, cy, def.m & 8);
    gctx = mk(48, 64).getContext('2d'); bakeTile(cx, cy); out.getContext('2d').drawImage(gctx.canvas, cx * 16, cy * 16, 16, 16, 0, 0, 16, 16); return out;
  } finally { MW = sv.MW; MH = sv.MH; kind = sv.kind; gctx = sv.gctx; }
}
function b64(cv) { return cv.toDataURL('image/png').split(',')[1]; }
function exportTiled() {
  if (!W) return null;
  const defs = tileDefs(), COLS = 16, rows = Math.ceil(defs.length / COLS), ts = mk(COLS * 16, rows * 16), tc = ts.getContext('2d'), gidOf = new Map();
  defs.forEach((d, i) => { tc.drawImage(renderCanon(d), (i % COLS) * 16, ((i / COLS) | 0) * 16); });
  const idFor = (k, m, par, v) => defs.findIndex(d => d.k === k && (k === K.GRASS || k === K.SAND ? d.v === v : d.m === m && (k !== K.PLAZA || d.par === par)));
  const data = new Array(MW * MH);
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    const k = kd(x, y); data[y * MW + x] = 1 + idFor(k, (k === K.GRASS || k === K.SAND) ? 0 : maskAt(x, y), (x + y) & 1, hash(x + ',' + y) % (k === K.SAND ? 4 : 8));
  }
  // décor peint = tout ce qui diffère d'un sol « nu » (fleurs, clôtures, jardins, ombres, panneaux…) : image transparente
  const live = ground.getContext('2d').getImageData(0, 0, MW * TS, MH * TS), keepG = { gctx, ground };
  ground = mk(MW * TS, MH * TS); gctx = ground.getContext('2d'); paintGrass(0, 0, MW * TS, MH * TS); for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) bakeTile(x, y);
  const base = gctx.getImageData(0, 0, MW * TS, MH * TS); ground = keepG.ground; gctx = keepG.gctx;
  const decor = mk(MW * TS, MH * TS), dctx = decor.getContext('2d'), dim = dctx.createImageData(MW * TS, MH * TS);
  for (let i = 0; i < live.data.length; i += 4) if (Math.abs(live.data[i] - base.data[i]) + Math.abs(live.data[i + 1] - base.data[i + 1]) + Math.abs(live.data[i + 2] - base.data[i + 2]) > 6) { dim.data[i] = live.data[i]; dim.data[i + 1] = live.data[i + 1]; dim.data[i + 2] = live.data[i + 2]; dim.data[i + 3] = 255; }
  dctx.putImageData(dim, 0, 0);
  // objets (tile objects) : arbres, buissons, lampadaires, herbes hautes
  const PS = propSprites(), names = Object.keys(PS), firstProps = 1 + COLS * rows;
  let oid = 1; const objects = [], baseOf = {};
  for (const o of objs) {
    if (o.tuft) { objects.push({ id: oid++, name: 'tuft' + o.tv, type: '', x: o.tx * TS, y: (o.ty + 1) * TS, width: 16, height: 16, rotation: 0, gid: firstProps + names.indexOf('tuft' + o.tv), visible: true }); baseOf['tuft' + o.tv] = 0; continue; }
    if (!o.prop || !PS[o.prop]) continue; const sp = PS[o.prop], bottom = o.y0 + sp.height;
    baseOf[o.prop] = o.sy - bottom;
    objects.push({ id: oid++, name: o.prop, type: '', x: o.x0, y: bottom, width: sp.width, height: sp.height, rotation: 0, gid: firstProps + names.indexOf(o.prop), visible: true });
  }
  // collisions : suites horizontales de cases bloquées -> rectangles (faciles à éditer dans Tiled)
  const coll = [];
  for (let y = 0; y < MH; y++) { let x = 0; while (x < MW) { if (blk[y * MW + x]) { let x1 = x; while (x1 < MW && blk[y * MW + x1]) x1++; coll.push({ id: oid++, name: '', type: 'solid', x: x * TS, y: y * TS, width: (x1 - x) * TS, height: TS, rotation: 0, visible: true }); x = x1; } else x++; } }
  const tilesProps = defs.map((d, i) => ({ id: i, properties: [{ name: 'kind', type: 'string', value: KIND_NAME[d.k] }, ...(d.m != null ? [{ name: 'mask', type: 'int', value: d.m }] : [])] }));
  const propTiles = names.map((n, i) => ({ id: i, image: 'props/' + n + '.png', imagewidth: PS[n].width, imageheight: PS[n].height, properties: [{ name: 'base', type: 'int', value: baseOf[n] != null ? baseOf[n] : -3 }] }));
  const tmj = {
    type: 'map', version: '1.10', tiledversion: '1.10.2', orientation: 'orthogonal', renderorder: 'right-down', infinite: false, compressionlevel: -1,
    width: MW, height: MH, tilewidth: 16, tileheight: 16, nextlayerid: 5, nextobjectid: oid,
    properties: [{ name: 'worldKey', type: 'string', value: worldKey(W) }, { name: 'aide', type: 'string', value: "Ground : tuiles du sol (propriété kind). decor : image peinte (fleurs, clôtures…). props : arbres/buissons/lampadaires. collision : rectangles solides. Maisons, bâtiments, fontaine et villageois restent gérés par le serveur." }],
    tilesets: [
      { firstgid: 1, name: 'town-ground', image: 'town-ground.png', imagewidth: COLS * 16, imageheight: rows * 16, tilewidth: 16, tileheight: 16, columns: COLS, tilecount: defs.length, margin: 0, spacing: 0, tiles: tilesProps },
      { firstgid: firstProps, name: 'town-props', tilewidth: 16, tileheight: 16, tilecount: names.length, columns: 0, grid: { orientation: 'orthogonal', width: 1, height: 1 }, tiles: propTiles },
    ],
    layers: [
      { id: 1, name: 'ground', type: 'tilelayer', x: 0, y: 0, width: MW, height: MH, opacity: 1, visible: true, data },
      { id: 2, name: 'decor', type: 'imagelayer', image: 'town-decor.png', imagewidth: MW * TS, imageheight: MH * TS, x: 0, y: 0, opacity: 1, visible: true },
      { id: 3, name: 'props', type: 'objectgroup', draworder: 'topdown', x: 0, y: 0, opacity: 1, visible: true, objects },
      { id: 4, name: 'collision', type: 'objectgroup', draworder: 'topdown', x: 0, y: 0, opacity: .5, visible: true, objects: coll },
    ],
  };
  const files = [{ path: 'maps/town.tmj', text: JSON.stringify(tmj, null, 1) }, { path: 'maps/town-ground.png', b64: b64(ts) }, { path: 'maps/town-decor.png', b64: b64(decor) }];
  for (const n of names) files.push({ path: 'maps/props/' + n + '.png', b64: b64(PS[n]) });
  return { files, stats: { w: MW, h: MH, tiles: defs.length, props: objects.length, collision: coll.length } };
}
function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('image ' + src)); i.src = src; }); }
async function loadUserMap() {
  if (new URLSearchParams(location.search).get('map') === 'off') { mapStatus = 'procédurale (map=off)'; return; }
  try {
    const r = await fetch('maps/town.tmj', { cache: 'no-store' }); if (!r.ok) return;
    const m = await r.json(), v = '?v=' + (r.headers.get('etag') || Date.now()), lay = n => m.layers.find(l => l.name === n);
    const gts = m.tilesets.find(s => s.name === 'town-ground'), pts = m.tilesets.find(s => s.name === 'town-props'); if (!gts || !pts) throw new Error('tilesets manquants');
    const gimg = await loadImg('maps/' + gts.image + v), dl = lay('decor'), dimg = dl && dl.image ? await loadImg('maps/' + dl.image + v) : null;
    const kinds = new Map(); for (const t of gts.tiles || []) { const pr = Object.fromEntries((t.properties || []).map(p => [p.name, p.value])); if (pr.kind in KIND_ID) kinds.set(gts.firstgid + t.id, KIND_ID[pr.kind]); }
    const props = new Map(); for (const t of pts.tiles || []) { const pr = Object.fromEntries((t.properties || []).map(p => [p.name, p.value])); props.set(pts.firstgid + t.id, { img: await loadImg('maps/' + t.image + v), name: (t.image.split('/').pop() || '').replace('.png', ''), base: pr.base != null ? pr.base : -3 }); }
    const wk = (m.properties || []).find(p => p.name === 'worldKey');
    userMap = { m, gts, gimg, dimg, kinds, props, layers: { ground: lay('ground'), props: lay('props'), collision: lay('collision') }, key: wk ? wk.value : '' };
    mapStatus = 'carte chargée';
    if (W) { sigKey = ''; setWorld(W, Date.now()); }
  } catch (e) { mapStatus = 'erreur carte : ' + (e && e.message); }
}
function applyUserMap(w, um) {
  const g = um.layers.ground, cols = um.gts.columns, f0 = um.gts.firstgid;
  paintGrass(0, 0, MW * TS, MH * TS);
  for (let i = 0; i < MW * MH; i++) {
    const gid = (g.data[i] || 0) & 0x0FFFFFFF; if (!gid) continue;
    const k = um.kinds.get(gid); if (k != null) kind[i] = k;
    const id = gid - f0, x = (i % MW) * TS, y = ((i / MW) | 0) * TS;
    gctx.drawImage(um.gimg, (id % cols) * 16, ((id / cols) | 0) * 16, 16, 16, x, y, 16, 16);
  }
  for (const h of w.houses) setPath(h);
  if (um.dimg) gctx.drawImage(um.dimg, 0, 0);
  const cl = um.layers.collision; if (cl) for (const o of cl.objects || []) block(Math.floor(o.x / TS), Math.floor(o.y / TS), Math.max(1, Math.round(o.width / TS)), Math.max(1, Math.round(o.height / TS)));
  const pl = um.layers.props; if (pl) for (const o of pl.objects || []) {
    const p = um.props.get((o.gid || 0) & 0x0FFFFFFF); if (!p) continue;
    if (/^tuft\d$/.test(p.name)) { const tx = Math.floor(o.x / TS), ty = Math.round(o.y / TS) - 1, tv = +p.name.slice(4), spr = tuftS[tv], ph = ((tx * 7 + ty * 13) % 63) / 10; addObj({ tuft: true, tx, ty, tv, sy: (ty + 1) * TS, x0: tx * TS, y0: ty * TS, x1: tx * TS + 16, y1: ty * TS + 16, draw: b => { const x = tx * TS - cam.x, y = ty * TS - cam.y, sw = Math.round(Math.sin(nowT / 430 + ph)); b.drawImage(spr, 0, 0, 16, 9, x + sw, y, 16, 9); b.drawImage(spr, 0, 9, 16, 7, x, y + 9, 16, 7); } }); continue; }
    const bottom = o.y, top = bottom - p.img.height; addSpr(p.img, Math.round(o.x), Math.round(top), Math.round(bottom + p.base), { prop: p.name });
  }
  addBuilding('academy', true); addBuilding('arena', true); addFountain();
  for (const d of w.districts || []) d.signPos = { x: (d.x + 1) * TS + 32, y: d.y * TS + 1 + 12 };
}
function fullBuild(w) {
  layout(w); decorated = new Set(); objs = [];
  const oldHouses = houses; houses = new Map();
  ground = mk(MW * TS, MH * TS); gctx = ground.getContext('2d');
  const um = userMap && userMap.key === worldKey(w) ? userMap : null;
  mapStatus = !userMap ? (mapStatus.startsWith('erreur') ? mapStatus : 'procédurale') : um ? 'carte Tiled' : 'carte Tiled ignorée (taille/quartiers changés : ré-exporte)';
  if (um) applyUserMap(w, um);
  else {
    for (const h of w.houses) setPath(h);
    paintGrass(0, 0, MW * TS, MH * TS);
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) bakeTile(x, y);
    decorWorld(w);
  }
  for (const h of w.houses) {
    const old = oldHouses.get(h.id), o = addHouse(h, false);
    if (old && old.born) o.born = old.born;
  }
  objs.sort((a, b) => a.sy - b.sy); dirtySort = false;
  ensureVillagers(w);
}
/* ───── hautes herbes animées (le personnage s'y enfonce) ───── */
const tuftS = [0, 1, 2].map(v => bake(16, 16, c => {
  const r = rng(900 + v * 17), D = '#2c7a3c', M = '#47a84c', L = '#8bdc6b', O = '#1d5230';
  R(c, 0, 13, 16, 3, D);
  for (let i = 0; i < 6; i++) {
    const x = 1 + i * 2.6 | 0, h = 6 + (r() * 6 | 0);
    for (let y = 0; y < h; y++) { const w = y > h - 3 ? 1 : 2; R(c, x, 15 - y, w, 1, y > h * .55 ? L : M); }
    R(c, x, 15 - h, 1, 1, O); R(c, x - 1 < 0 ? 0 : x - 1, 15 - Math.max(2, h - 3), 1, Math.max(2, h - 3), O);
  }
  R(c, 0, 15, 16, 1, O);
}));
function tallGrassPatch(tx0, ty0, w, h, r) {
  for (let ty = ty0; ty < ty0 + h; ty++) for (let tx = tx0; tx < tx0 + w; tx++) {
    if (kd(tx, ty) !== K.GRASS || blk[ty * MW + tx]) continue;
    const edge = tx === tx0 || tx === tx0 + w - 1 || ty === ty0 || ty === ty0 + h - 1; if (edge && r() < .35) continue;
    R(gctx, tx * TS, ty * TS, TS, TS, '#4f9d48');
    const tvi = (r() * 3) | 0, spr = tuftS[tvi], ph = r() * 6.28;
    addObj({ tuft: true, tx, ty, tv: tvi, sy: (ty + 1) * TS, x0: tx * TS, y0: ty * TS, x1: tx * TS + 16, y1: ty * TS + 16, draw: b => {
      const x = tx * TS - cam.x, y = ty * TS - cam.y, sw = Math.round(Math.sin(nowT / 430 + ph) * 1);
      b.drawImage(spr, 0, 0, 16, 9, x + sw, y, 16, 9); b.drawImage(spr, 0, 9, 16, 7, x, y + 9, 16, 7);
    } });
  }
}
function clearTallGrass(lx, ly, w, h) { objs = objs.filter(o => !(o.tuft && o.x0 >= lx * TS && o.x0 < (lx + w) * TS && o.y0 >= ly * TS && o.y0 < (ly + h) * TS)); }

/* ───── villageois (décor vivant : se promènent, parlent) ───── */
const villagers = [];
const VLOOKS = [
  { skin: '#f2cba6', hair: '#5a3a22', style: 1, shirt: '#e07a8a', pants: '#4a4a62' }, { skin: '#dba374', hair: '#2b2233', style: 0, shirt: '#4a8fd0', pants: '#2f3a5a' },
  { skin: '#f2cba6', hair: '#c9902f', style: 2, shirt: '#79b36b', pants: '#4a4a62' }, { skin: '#b07a52', hair: '#2b2233', style: 1, shirt: '#e0b030', pants: '#2f3a5a' },
  { skin: '#f2cba6', hair: '#b5482a', style: 0, shirt: '#8a5fc0', pants: '#4a4a62' }, { skin: '#7d5037', hair: '#2b2233', style: 2, shirt: '#3b9a95', pants: '#2f3a5a' },
];
const VLINES = [
  D => [`Bienvenue dans le quartier ${D} !`, 'Ici, chaque maison est un projet.'],
  () => ['Quand une cheminée fume, un agent travaille.', 'Regarde bien les maisons !'],
  () => ['Tu veux voir toute la ville ?', 'Appuie sur M pour ouvrir la carte.'],
  () => ['Maintiens Maj pour courir.', 'Mais ne piétine pas les fleurs !'],
  () => ['Les hautes herbes ? Aucun danger ici.', 'Ça chatouille, c\'est tout.'],
  () => ['Une fenêtre allumée, c\'est un agent au travail.', 'Un « ! », c\'est qu\'il t\'attend.'],
];
let v0 = 0;
function mkVillager(def) {
  const v = { kind: 'npc', villager: true, name: def.name, x: 0, y: 0, dir: def.dir || 0, t: 0, moving: false, seated: false, mode: 'idle', look: def.look, lines: def.lines, district: def.district, wait: 1 + Math.random() * 4, tgt: null, R: def.R || 4, speed: def.speed || 13, tx: 0, ty: 0, sy: 0 };
  v.look.key = ''; v.draw = b => FW.drawPerson(b, v);
  return v;
}
function freeSpot(tx, ty) {
  for (let rad = 0; rad < 8; rad++) for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue; const x = tx + dx, y = ty + dy;
    if (x < 3 || y < 3 || x >= MW - 3 || y >= MH - 3 || blocked(x, y) || kd(x, y) === K.WATER) continue;
    if (villagers.some(o => o.tx === x && o.ty === y)) continue; return { tx: x, ty: y };
  }
  return { tx, ty };
}
function ensureVillagers(w) {
  if (villagers.length) { for (const v of villagers) if (blocked(v.tx, v.ty)) { const s = freeSpot(v.tx, v.ty); v.tx = s.tx; v.ty = s.ty; v.x = s.tx * TS + 8; v.y = s.ty * TS + 12; v.tgt = null; } return; }
  const defs = [], ac = bld.academy, ar = bld.arena;
  defs.push({ name: 'Prof. Skill', look: { skin: '#dba374', hair: '#c9cbd8', style: 0, shirt: '#f6f6fa', pants: '#3a3f5c' }, at: [ac.x + 2, ac.y + BH + 3], R: 2, speed: 9, dir: 3,
    lines: () => ['Je suis le Professeur Skill.', 'L\'Académie t\'apprend les métiers des agents.', 'Chaque skill qu\'un agent utilise le fait monter de niveau.'] });
  defs.push({ name: 'Juge de l\'Arène', look: { skin: '#f2cba6', hair: '#2b2233', style: 0, shirt: '#c0463d', pants: '#2f3a5a' }, at: [ar.x + BW - 3, ar.y + BH + 3], R: 2, speed: 9, dir: 2,
    lines: () => ['L\'Arène évalue le travail de tes agents.', 'Le professeur y dit ce qui a marché… et ce qui a raté.'] });
  defs.push({ name: 'Enfant', look: { skin: '#f2cba6', hair: '#5a3a22', style: 2, shirt: '#d9483a', pants: '#4a4a62', cap: '#d9483a' }, at: [plaza.x0 + 4, plaza.y1 - 2], R: 5, speed: 15, lines: () => ['J\'adore courir sur la place !', 'Maj + flèches, essaie !'] });
  (w.districts || []).slice(0, 6).forEach((d, i) => defs.push({ name: ['Villageois', 'Villageoise', 'Promeneur', 'Voisine', 'Jardinier', 'Passant'][i % 6], look: Object.assign({}, VLOOKS[i % VLOOKS.length]), at: [d.x + 3 + (i % 3), d.y + d.h - 1], R: 5, speed: 12 + (i % 3), district: d.name }));
  defs.forEach(d => {
    const v = mkVillager({ name: d.name, look: d.look, lines: d.lines || (() => VLINES[(v0++) % VLINES.length](d.district || 'ici')), district: d.district, R: d.R, speed: d.speed, dir: d.dir });
    const s = freeSpot(d.at[0], d.at[1]); v.tx = v.hx = s.tx; v.ty = v.hy = s.ty; v.x = s.tx * TS + 8; v.y = s.ty * TS + 12; villagers.push(v);
  });
}
function updateVillagers(dt, player) {
  for (const v of villagers) {
    if (v.tgt) {
      const dx = v.tgt.x - v.x, dy = v.tgt.y - v.y, d = Math.hypot(dx, dy), st = v.speed * dt;
      if (d <= st) { v.x = v.tgt.x; v.y = v.tgt.y; v.tx = v.tgt.tx; v.ty = v.tgt.ty; v.tgt = null; v.moving = false; v.wait = 1.2 + Math.random() * 4.5; } else { v.x += dx / d * st; v.y += dy / d * st; v.moving = true; v.t += dt; }
      continue;
    }
    v.moving = false; if (v.talking > 0) { v.talking -= dt; continue; }
    v.wait -= dt; if (v.wait > 0) continue;
    const dirs = [[0, 1, 0], [0, -1, 1], [-1, 0, 2], [1, 0, 3]].sort(() => Math.random() - .5);
    for (const [ddx, ddy, dd] of dirs) {
      const nx = v.tx + ddx, ny = v.ty + ddy;
      if (Math.abs(nx - v.hx) > v.R || Math.abs(ny - v.hy) > v.R || blocked(nx, ny) || kd(nx, ny) === K.WATER) continue;
      const wx = nx * TS + 8, wy = ny * TS + 12;
      if (player && Math.abs(player.x - wx) < 12 && Math.abs(player.y - wy) < 10) continue;
      if (villagers.some(o => o !== v && (o.tgt ? o.tgt.tx === nx && o.tgt.ty === ny : o.tx === nx && o.ty === ny))) continue;
      v.dir = dd; v.tgt = { x: wx, y: wy, tx: nx, ty: ny }; break;
    }
    if (!v.tgt) v.wait = .8 + Math.random() * 2;
  }
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
function update(dt, now, player) {
  nowT = now; updateVillagers(dt, player);
  for (const o of houses.values()) if (o.gardenAt && now >= o.gardenAt) { o.gardenAt = 0; paintGarden(o); if (dirtySort) { objs.sort((a, b) => a.sy - b.sy); dirtySort = false; } }
}
function lower(y) { let lo = 0, hi = objs.length; while (lo < hi) { const m = (lo + hi) >> 1; if (objs[m].sy < y) lo = m + 1; else hi = m; } return lo; }
function draw(bx, bw, bh, now, player) {
  nowT = now;
  bx.drawImage(ground, -cam.x, -cam.y);
  let i = lower(cam.y - 10);
  const yMax = cam.y + bh + 170;
  const dyn = villagers.concat([player]).sort((a, b) => a.y - b.y); let di = 0;   // personnages mobiles triés avec le décor
  for (; i < objs.length; i++) {
    const o = objs[i]; if (o.sy > yMax) break;
    while (di < dyn.length && dyn[di].y < o.sy) dyn[di++].draw(bx);
    if (o.x1 < cam.x || o.x0 > cam.x + bw || o.y1 < cam.y || o.y0 > cam.y + bh) continue;
    o.draw(bx);
  }
  while (di < dyn.length) dyn[di++].draw(bx);
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
  setWorld, update, draw, blocked, doorAt, nearHouse, spawnPos, houses, villagers, exportTiled, loadUserMap, get mapStatus() { return mapStatus; },
  get w() { return MW * TS; }, get h() { return MH * TS; }, get tw() { return MW; }, get th() { return MH; },
  get data() { return W; }, get ready() { return !!W; }, plazaSpawn: () => W ? { x: W.plaza.spawn.x * TS + 8, y: W.plaza.spawn.y * TS + 12 } : { x: 100, y: 100 },
  doorOf(id) { const o = houses.get(id); return o ? { x: (o.g.hx + 3) * TS, y: (o.g.hy + HH) * TS } : null; },
  buildingDoor(k) { const b = bld[k]; return b ? { x: (b.x + 6) * TS, y: (b.y + BH) * TS } : null; },
};
})();
