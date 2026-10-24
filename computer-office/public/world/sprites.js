/* Fleet Office · World — utilitaires partagés, personnages, bulles, texte, sprites de la ville.
   Tout est dessiné par script (aucun asset tiers hormis Kenney Roguelike Indoors pour l'intérieur). */
(() => {
'use strict';
const FW = window.FW = {};
const TS = 16;
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const R = (c, x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function hash(s) { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
function shade(h, f) { const [r, g, b] = rgb(h); const c = v => clamp(Math.round(v * f), 0, 255); return `rgb(${c(r)},${c(g)},${c(b)})`; }
function bake(w, h, fn) { const c = mk(w, h); fn(c.getContext('2d'), w, h); return c; }
const INK = '#1d1a2e', CAP = '#272c4a', CAP2 = '#3a4268';
const sheet = new Image(); sheet.src = 'assets/indoor.png';
const cam = { x: 0, y: 0 };
function shadowFlat(c, px, py, w, h) { R(c, px - 1, py + h - 3, w + 2, 5, 'rgba(12,14,44,.34)'); R(c, px + w - 1, py + 3, 3, h - 3, 'rgba(12,14,44,.30)'); }
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
function drawPerson(b, p) {
  const seated = p.seated;
  const frames = [1, 0, 2, 0];
  const fr = p.moving ? frames[(p.t * 5 | 0) & 3] : 0;
  const hand = seated && p.mode === 'work' ? ((performance.now() / 110) | 0) & 1 : 0;
  const s = charSprite(p.look, seated ? 0 : p.dir, seated ? 0 : fr, seated, hand);
  const x = Math.round(p.x) - 8 - cam.x, y = Math.round(p.y) - (seated ? 12 : 20) - cam.y;
  if (!seated) { b.fillStyle = 'rgba(8,10,40,.32)'; b.fillRect(x + 4, y + 19, 8, 2); b.fillRect(x + 3, y + 20, 10, 1); b.fillRect(x + 5, y + 21, 6, 1); }
  b.drawImage(s, 0, 0, 16, seated ? 17 : 21, x, y, 16, seated ? 17 : 21);
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
/* ═════════════ sprites de la ville (tout est dessiné par script) ═════════════ */
const px = (c, x, y, col) => { c.fillStyle = col; c.fillRect(x, y, 1, 1); };
function ell(c, cx, cy, rx, ry, col) { c.fillStyle = col; for (let y = -ry; y <= ry; y++) { const w = Math.round(rx * Math.sqrt(1 - (y * y) / (ry * ry + .01))); c.fillRect(cx - w, cy + y, w * 2 + 1, 1); } }
function ink(c, x0, y0, w, h, col) { // contour 1px des pixels opaques (4-voisins)
  const im = c.getImageData(x0, y0, w, h), d = im.data, o = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) o[i] = d[i * 4 + 3] > 40 ? 1 : 0;
  const [r, g, b] = rgb(col);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (o[y * w + x]) continue;
    if ((x > 0 && o[y * w + x - 1]) || (x < w - 1 && o[y * w + x + 1]) || (y > 0 && o[(y - 1) * w + x]) || (y < h - 1 && o[(y + 1) * w + x])) { const i = (y * w + x) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; }
  }
  c.putImageData(im, x0, y0);
}
/* texte pixel : police bitmap 3x5 maison (majuscules) => rendu net à toute échelle */
const G35 = { A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100', Q: '010101101111011', R: '110101110101101', S: '011100010001110', T: '111010010010010', U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010', Z: '111001010100111',
  0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110', 4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010', 8: '111101111101111', 9: '111101111001110',
  '-': '000000111000000', '/': '001001010100100', '_': '000000000000111', '&': '010101010101011', '.': '000000000000010', ':': '000010000010000', '!': '010010010000010', "'": '010010000000000', '?': '110001010000010', '(': '010100100100010', ')': '010001001001010' };
const tinyCache = new Map();
function tinyW(s) { let w = 0; for (const ch of s) w += ch === ' ' ? 3 : 4; return Math.max(0, w - 1); }
function tinyText(s, col, maxW) {
  s = String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase(); const key = s + col + maxW; let e = tinyCache.get(key); if (e) return e;
  if (tinyW(s) > maxW) { while (s.length > 1 && tinyW(s + '..') > maxW) s = s.slice(0, -1); s = s.trim() + '..'; }
  const w = Math.max(2, tinyW(s) + 1), cv2 = mk(w, 11), c = cv2.getContext('2d'); c.fillStyle = col; let x = 0;
  for (const ch of s) { if (ch === ' ') { x += 3; continue; } const g = G35[ch] || G35['?']; for (let i = 0; i < 15; i++) if (g[i] === '1') c.fillRect(x + (i % 3), 3 + ((i / 3) | 0), 1, 1); x += 4; }
  tinyCache.set(key, cv2); return cv2;
}
const simplify = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');

/* arbres */
const OAK_PAL = [['#17402a', '#25683a', '#3b9150', '#68c066', '#a2e585'], ['#173f3d', '#25695a', '#3a9576', '#66c496', '#a0eec0'], ['#3c4a16', '#5d7d24', '#87aa36', '#b4d357', '#e0f08a']];
function mkOak(v) {
  const pal = OAK_PAL[v % 3], r = rng(100 + v);
  return bake(28, 34, (c) => {
    ell(c, 14, 30, 11, 3, 'rgba(10,36,20,.30)');
    R(c, 12, 20, 5, 11, '#2a1a14'); R(c, 13, 20, 3, 10, '#7a4e2e'); R(c, 13, 20, 1, 10, '#9a6a42'); R(c, 11, 28, 7, 2, '#2a1a14'); R(c, 12, 28, 5, 1, '#6a4a30');
    const W = 28, H = 24, blobs = [[14, 10, 10.5], [7.5, 15, 7], [20.5, 15, 7], [14, 17, 8]];
    const m = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (const b of blobs) if ((x - b[0]) ** 2 + (y - b[1]) ** 2 <= b[2] * b[2]) { m[y * W + x] = 1; break; }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!m[y * W + x]) continue;
      const edge = !x || !y || x === W - 1 || y === H - 1 || !m[y * W + x - 1] || !m[y * W + x + 1] || !m[(y - 1) * W + x] || !m[(y + 1) * W + x];
      if (edge) { px(c, x, y, pal[0]); continue; }
      let t = Math.hypot(x - 9, (y - 6) * 1.1) / 17; t += (r() - .5) * .16 + (y > 16 ? .12 : 0);
      let k = 4 - Math.floor(t * 4.6); const fr = (t * 4.6) % 1; if (fr > .5 && ((x + y) & 1)) k--;
      px(c, x, y, pal[clamp(k, 1, 4)]);
    }
    for (let i = 0; i < 16; i++) { const x = 3 + (r() * 22 | 0), y = 3 + (r() * 17 | 0); if (m[y * W + x] && m[y * W + x + 1] && m[(y + 1) * W + x]) { R(c, x, y, 2, 1, pal[1 + (r() * 3 | 0)]); } }
  });
}
function mkPine(v) {
  const pal = v ? ['#14382d', '#1f5a46', '#2f7d62', '#52a684'] : ['#13351f', '#1f5a34', '#2f7d46', '#52a863'];
  return bake(22, 38, (c) => {
    ell(c, 11, 35, 8, 2, 'rgba(10,36,20,.30)');
    R(c, 9, 29, 4, 7, '#2a1a14'); R(c, 10, 29, 2, 6, '#7a4e2e');
    const tiers = [[2, 5, 11], [9, 7, 19], [17, 9, 29]]; // [yTop, halfW, yBottom]
    for (let ti = tiers.length - 1; ti >= 0; ti--) {
      const [y0, hw, y1] = tiers[ti];
      for (let y = y0; y <= y1; y++) {
        const t = (y - y0) / (y1 - y0), w = Math.round(1 + (hw - 1) * t);
        for (let x = -w; x <= w; x++) {
          const edge = x === -w || x === w || y === y1; let col = pal[2];
          if (edge) col = pal[0]; else if (x < -w * .25) col = (x + y) % 5 === 0 ? pal[2] : pal[3]; else if (x > w * .3) col = pal[1]; else col = ((x + y) & 3) === 0 ? pal[3] : pal[2];
          if (!edge && y === y1 - 1) col = pal[1];
          px(c, 11 + x, y, col);
        }
      }
    }
  });
}
function mkBush(v) {
  const pal = OAK_PAL[v % 3];
  return bake(16, 13, (c) => {
    ell(c, 8, 11, 7, 2, 'rgba(10,36,20,.28)');
    const m = []; const W = 16, H = 11;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) m[y * W + x] = ((x - 8) ** 2 / 49 + (y - 6) ** 2 / 20) <= 1 ? 1 : 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!m[y * W + x]) continue; const edge = !m[y * W + x - 1] || !m[y * W + x + 1] || !m[(y - 1) * W + x] || !m[(y + 1) * W + x];
      px(c, x, y, edge ? pal[0] : y < 4 && x < 9 ? pal[3] : y < 7 ? pal[2] : pal[1]);
    }
    px(c, 5, 3, pal[4]); px(c, 6, 3, pal[4]);
  });
}
/* maisons */
const HSTY = [
  { roof: '#c9514a', rd: '#98383e', rl: '#ec8472', wall: '#f4e7c6', wd: '#dccb9e', tr: '#fffaf0', sh: '#7b3a3a' },
  { roof: '#4a86c8', rd: '#33609a', rl: '#82b6ea', wall: '#efe9da', wd: '#d6cdb6', tr: '#ffffff', sh: '#2f4f7f' },
  { roof: '#4aa05a', rd: '#33753f', rl: '#7acb88', wall: '#f2ecd2', wd: '#d9d0a8', tr: '#fffdf0', sh: '#2f6a3a' },
  { roof: '#8a5fc0', rd: '#63408f', rl: '#b796e4', wall: '#ece4f0', wd: '#cfc2d8', tr: '#ffffff', sh: '#503a7a' },
  { roof: '#e0902f', rd: '#b0691f', rl: '#f7be6c', wall: '#f6e9d2', wd: '#dfc9a2', tr: '#fffaf0', sh: '#8a4f1c' },
  { roof: '#3b9a95', rd: '#2a716d', rl: '#6fc8c2', wall: '#e8efe6', wd: '#c9d6c5', tr: '#ffffff', sh: '#25605c' },
];
function roofHip(c, S, x0, x1, ytop, ybot, inset, ridgeH) {
  // trapèze : arête haute (x0+inset..x1-inset) -> bord bas (x0..x1)
  for (let y = ytop; y <= ybot; y++) {
    const t = (y - ytop) / (ybot - ytop), l = Math.round(x0 + inset * (1 - t)), r = Math.round(x1 - inset * (1 - t));
    R(c, l, y, r - l + 1, 1, S.roof);
    const row = Math.floor((y - ytop) / 4);
    if ((y - ytop) % 4 === 3) R(c, l, y, r - l + 1, 1, S.rd);
    else for (let x = l + 1 + ((row & 1) ? 3 : 0); x < r; x += 6) px(c, x, y, S.rd);
    if ((y - ytop) % 4 === 0) R(c, l + 2, y, r - l - 3, 1, 'rgba(255,255,255,.10)');
    // arêtes de croupe : gauche claire, droite sombre
    R(c, l, y, 2, 1, S.rl); R(c, r - 1, y, 2, 1, S.rd); px(c, l - 1, y, INK); px(c, r + 1, y, INK);
  }
  R(c, x0 + inset - 1, ytop - 2, x1 - x0 - 2 * inset + 3, 2, INK); R(c, x0 + inset, ytop - 1, x1 - x0 - 2 * inset + 1, 1, S.rl);
  R(c, x0 - 1, ybot, x1 - x0 + 3, 1, INK); R(c, x0, ybot - 3, x1 - x0 + 1, 3, S.rd); R(c, x0, ybot - 3, x1 - x0 + 1, 1, shade(S.roof, .85));
}
function windowSprite(c, x, y, S, lit, big) {
  const w = 16, h = 14;
  R(c, x - 5, y - 1, 4, h + 2, INK); R(c, x - 4, y, 3, h, S.sh); R(c, x - 4, y, 1, h, shade(S.sh, 1.25)); // volets
  R(c, x + w + 1, y - 1, 4, h + 2, INK); R(c, x + w + 2, y, 3, h, S.sh); R(c, x + w + 2, y, 1, h, shade(S.sh, 1.25));
  R(c, x - 1, y - 1, w + 2, h + 2, INK); R(c, x, y, w, h, S.tr);
  const g = c.createLinearGradient(0, y + 1, 0, y + h - 1);
  if (lit) { g.addColorStop(0, '#fff2b0'); g.addColorStop(1, '#ffc457'); } else { g.addColorStop(0, '#6f93c4'); g.addColorStop(1, '#34507c'); }
  c.fillStyle = g; c.fillRect(x + 1, y + 1, w - 2, h - 2);
  if (!lit) { R(c, x + 2, y + 2, 4, 1, 'rgba(255,255,255,.4)'); R(c, x + 3, y + 3, 3, 1, 'rgba(255,255,255,.25)'); } else { R(c, x + 3, y + 3, w - 6, h - 6, 'rgba(255,255,230,.55)'); }
  R(c, x + (w >> 1) - 1, y + 1, 1, h - 2, S.tr); R(c, x + 1, y + (h >> 1) - 1, w - 2, 1, S.tr);
  R(c, x - 2, y + h, w + 4, 2, S.tr); R(c, x - 2, y + h + 1, w + 4, 1, S.wd);
  // jardinière
  R(c, x - 1, y + h + 2, w + 2, 3, INK); R(c, x, y + h + 2, w, 2, '#7a4e2e');
  const fc = ['#ff7a8a', '#ffd84a', '#ffffff', '#ff9a4a']; for (let i = 0; i < 6; i++) { px(c, x + 1 + i * 3, y + h + 1, '#3b9150'); px(c, x + 1 + i * 3, y + h, fc[(i + (x >> 2)) & 3]); }
}
const houseCache = new Map();
function houseSprite(style, lit) {
  const k = style + (lit ? 'L' : 'D'); let s = houseCache.get(k); if (s) return s;
  const S = HSTY[style % 6];
  s = bake(96, 88, (c) => {
    // cheminée
    R(c, 65, 0, 14, 26, INK); R(c, 66, 3, 12, 22, '#b25a4e'); R(c, 66, 3, 3, 22, '#cf7a68'); R(c, 75, 3, 3, 22, '#8a4038');
    for (let y = 7; y < 24; y += 4) R(c, 66, y, 12, 1, '#8a4038'); R(c, 64, 0, 16, 4, INK); R(c, 65, 1, 14, 2, '#8d8aa0'); R(c, 65, 1, 14, 1, '#b9b6cc');
    roofHip(c, S, 1, 94, 12, 50, 17);
    // lucarne ronde
    ell(c, 48, 30, 7, 7, INK); ell(c, 48, 30, 6, 6, S.tr); ell(c, 48, 30, 4, 4, lit ? '#ffe28a' : '#44628f'); R(c, 47, 26, 2, 9, S.tr); R(c, 44, 29, 9, 1, S.tr);
    // murs
    R(c, 3, 51, 90, 37, INK); R(c, 4, 51, 88, 36, S.wall);
    for (let x = 10; x < 90; x += 8) R(c, x, 52, 1, 30, S.wd);
    R(c, 4, 51, 88, 3, 'rgba(30,20,50,.28)'); R(c, 4, 54, 88, 1, 'rgba(30,20,50,.12)');
    R(c, 86, 51, 6, 36, 'rgba(60,40,90,.10)');
    R(c, 3, 81, 90, 7, INK); R(c, 4, 82, 88, 5, '#9a96ac'); for (let x = 4; x < 92; x += 7) R(c, x, 82, 1, 5, '#7c7890'); R(c, 4, 82, 88, 1, '#bdb9cf');
    windowSprite(c, 14, 60, S, lit); windowSprite(c, 66, 60, S, lit);
    // porte + auvent
    R(c, 36, 62, 24, 26, INK); R(c, 37, 63, 22, 25, S.tr); R(c, 39, 65, 18, 23, '#6b4226'); R(c, 40, 66, 16, 22, '#8a5a36');
    R(c, 40, 66, 7, 22, '#9a6a42'); R(c, 47, 66, 1, 22, '#5a3820'); R(c, 42, 69, 4, 7, '#7a4e2e'); R(c, 49, 69, 5, 7, '#7a4e2e'); R(c, 42, 79, 4, 6, '#7a4e2e'); R(c, 49, 79, 5, 6, '#7a4e2e');
    R(c, 44, 76, 2, 2, '#f4c840'); R(c, 50, 76, 2, 2, '#f4c840');
    R(c, 32, 56, 32, 7, INK); R(c, 33, 57, 30, 5, S.roof); for (let x = 33; x < 63; x += 6) R(c, x, 57, 3, 5, S.rl); R(c, 33, 61, 30, 1, S.rd);
    R(c, 32, 63, 32, 1, 'rgba(20,10,40,.3)');
    R(c, 34, 86, 28, 2, '#bdb9cf'); R(c, 34, 86, 28, 1, '#dedbea');
    px(c, 31, 70, '#f4d878'); px(c, 31, 71, '#f4d878'); // petit éclairage
  });
  houseCache.set(k, s); return s;
}
/* grands bâtiments : 12x7 tuiles + 24 px de tour/drapeaux au-dessus */
const bCache = new Map();
function buildingSprite(kind) {
  if (bCache.has(kind)) return bCache.get(kind);
  const acad = kind === 'academy';
  const S = acad ? { roof: '#3f74c4', rd: '#2c4f94', rl: '#7aa8ec', wall: '#e9e0c9', wd: '#cbbf9f', tr: '#fffaf0', sh: '#2c4f94' } : { roof: '#c9433f', rd: '#8f2c35', rl: '#ec7e6c', wall: '#e9dccb', wd: '#c9b59f', tr: '#fffaf0', sh: '#8f2c35' };
  const gold = '#f0c038';
  const s = bake(192, 136, (c) => {
    // tour centrale
    R(c, 74, 14, 44, 60, INK); R(c, 75, 15, 42, 58, S.wall); R(c, 75, 15, 6, 58, S.wd); R(c, 111, 15, 6, 58, 'rgba(60,40,90,.14)');
    for (let y = 20; y < 70; y += 6) R(c, 75, y, 42, 1, 'rgba(120,100,70,.18)');
    for (let y = 0; y < 16; y++) { const w = Math.round(2 + 24 * (y / 15)); R(c, 96 - w, 0 + y, w * 2, 1, S.roof); R(c, 96 - w, y, 2, 1, S.rl); R(c, 96 + w - 2, y, 2, 1, S.rd); px(c, 96 - w - 1, y, INK); px(c, 96 + w, y, INK); }
    R(c, 94, -1 + 1, 4, 2, INK); R(c, 96, 0, 1, 1, gold);
    R(c, 70, 14, 52, 3, INK); R(c, 71, 14, 50, 2, S.rd);
    // roues / cadran ou blason
    if (acad) { ell(c, 96, 36, 11, 11, INK); ell(c, 96, 36, 10, 10, '#f6f1e2'); ell(c, 96, 36, 8, 8, '#fffdf4'); R(c, 96, 29, 1, 8, '#2a2d4a'); R(c, 96, 36, 6, 1, '#2a2d4a'); px(c, 96, 36, '#d9483a'); for (const [dx, dy] of [[0, -8], [8, 0], [0, 8], [-8, 0]]) px(c, 96 + dx, 36 + dy, '#2a2d4a'); }
    else { R(c, 84, 26, 24, 22, INK); R(c, 85, 27, 22, 20, '#7a1f2a'); R(c, 85, 27, 22, 2, gold); for (let i = 0; i < 12; i++) { px(c, 90 + i, 32 + i, '#f2f2fa'); px(c, 101 - i, 32 + i, '#f2f2fa'); } R(c, 94, 31, 4, 4, gold); }
    // toit principal
    roofHip(c, S, 1, 190, 50, 86, 26);
    // lucarnes
    for (const lx of [24, 150]) { R(c, lx, 62, 18, 16, INK); R(c, lx + 1, 63, 16, 14, S.tr); R(c, lx + 3, 65, 12, 12, '#456795'); R(c, lx + 8, 65, 1, 12, S.tr); R(c, lx + 3, 70, 12, 1, S.tr); R(c, lx - 1, 61, 20, 2, S.rd); }
    // murs
    R(c, 3, 87, 186, 49, INK); R(c, 4, 87, 184, 48, S.wall);
    for (let y = 91; y < 130; y += 6) { R(c, 4, y, 184, 1, 'rgba(120,100,70,.16)'); for (let x = 4 + ((y / 6 | 0) & 1) * 6; x < 188; x += 12) R(c, x, y, 1, 6, 'rgba(120,100,70,.12)'); }
    R(c, 4, 87, 184, 3, 'rgba(30,20,50,.30)');
    R(c, 3, 127, 186, 9, INK); R(c, 4, 128, 184, 7, '#a5a1b4'); for (let x = 4; x < 188; x += 9) R(c, x, 128, 1, 7, '#85819a'); R(c, 4, 128, 184, 1, '#c8c4d8');
    // pilastres
    for (const x of [8, 56, 128, 176]) { R(c, x, 90, 8, 38, INK); R(c, x + 1, 91, 6, 37, S.tr); R(c, x + 5, 91, 2, 37, S.wd); R(c, x - 1, 90, 10, 3, S.wd); R(c, x - 1, 125, 10, 3, S.wd); }
    // fenêtres en arc
    for (const x of [22, 38, 140, 156]) { R(c, x - 1, 100, 14, 26, INK); R(c, x, 101, 12, 25, S.tr); R(c, x + 1, 103, 10, 22, '#4f74a8'); R(c, x + 1, 103, 10, 6, '#7a9fd0'); R(c, x + 6, 103, 1, 22, S.tr); R(c, x + 1, 112, 10, 1, S.tr); R(c, x + 2, 104, 3, 1, 'rgba(255,255,255,.5)'); }
    // plaque d'enseigne
    R(c, 28, 91, 136, 14, INK); R(c, 29, 92, 134, 12, gold); R(c, 30, 93, 132, 10, '#3a2616');
    // porte monumentale (2 tuiles : x 80..112)
    R(c, 77, 100, 38, 36, INK); R(c, 78, 101, 36, 35, S.tr); R(c, 80, 103, 32, 33, '#5a3820'); R(c, 80, 103, 16, 33, '#7a4e2e'); R(c, 96, 103, 1, 33, '#2a1810');
    R(c, 82, 106, 12, 12, '#6b4226'); R(c, 99, 106, 12, 12, '#6b4226'); R(c, 82, 121, 12, 12, '#6b4226'); R(c, 99, 121, 12, 12, '#6b4226');
    R(c, 92, 119, 3, 3, gold); R(c, 98, 119, 3, 3, gold);
    for (let y = 0; y < 6; y++) { R(c, 76 + (y >> 1), 98 - 0 + y - 6, 40 - (y >> 1) * 2, 0, S.rd); }
    R(c, 74, 134, 44, 2, '#cfcbe0'); R(c, 74, 134, 44, 1, '#efedf8');
    // drapeaux
    for (const fx of [12, 172]) { R(c, fx, 52, 2, 36, INK); R(c, fx + 2, 54, 12, 9, S.roof); R(c, fx + 2, 54, 12, 2, S.rl); R(c, fx + 2, 63, 12, 1, S.rd); px(c, fx, 51, gold); }
    R(c, 28, 91, 136, 14, INK); R(c, 29, 92, 134, 12, gold); R(c, 30, 93, 132, 10, '#3a2616');
  });
  // texte de l'enseigne (au 1er appel après chargement de la police)
  const c = s.getContext('2d');
  const t = tinyText(acad ? 'ACADÉMIE - métiers & skills' : 'ARÈNE - évaluations', '#fff0c0', 128);
  c.drawImage(t, 96 - (t.width >> 1), 94);
  bCache.set(kind, s); return s;
}
function mkSign(name, w = 32) {
  const t = tinyText(simplify(name).toUpperCase(), '#4a2a14', w - 4);
  return bake(w, 22, (c) => {
    R(c, 3, 12, 3, 10, '#3a2210'); R(c, 4, 12, 1, 10, '#7a4e2e'); R(c, w - 6, 12, 3, 10, '#3a2210'); R(c, w - 5, 12, 1, 10, '#7a4e2e');
    ell(c, 4, 21, 4, 1, 'rgba(10,36,20,.3)'); ell(c, w - 5, 21, 4, 1, 'rgba(10,36,20,.3)');
    R(c, 0, 1, w, 13, INK); R(c, 1, 2, w - 2, 11, '#d9a867'); R(c, 1, 2, w - 2, 1, '#f0cc8c'); R(c, 1, 12, w - 2, 1, '#a8763f');
    for (let x = 6; x < w - 4; x += 9) px(c, x, 7, 'rgba(120,70,30,.18)');
    c.drawImage(t, Math.max(2, (w - t.width) >> 1), 2);
  });
}
function mkDistrictSign(name) {
  const t = tinyText(simplify(name).toUpperCase(), '#fff4d0', 58);
  return bake(64, 30, (c) => {
    R(c, 6, 14, 4, 16, '#3a2210'); R(c, 7, 14, 2, 16, '#7a4e2e'); R(c, 54, 14, 4, 16, '#3a2210'); R(c, 55, 14, 2, 16, '#7a4e2e');
    ell(c, 8, 29, 5, 1, 'rgba(10,36,20,.3)'); ell(c, 56, 29, 5, 1, 'rgba(10,36,20,.3)');
    R(c, 0, 1, 64, 16, INK); R(c, 1, 2, 62, 14, '#f0c038'); R(c, 2, 3, 60, 12, '#2f5d6a'); R(c, 2, 3, 60, 1, '#4a8798');
    c.drawImage(t, Math.max(3, (64 - t.width) >> 1), 4);
    px(c, 3, 4, '#f0c038'); px(c, 60, 4, '#f0c038'); px(c, 3, 13, '#f0c038'); px(c, 60, 13, '#f0c038');
  });
}
function mkLamp() {
  return bake(12, 34, (c) => {
    ell(c, 6, 32, 4, 1, 'rgba(10,36,20,.3)');
    R(c, 5, 10, 2, 22, INK); R(c, 5, 10, 1, 22, '#4a5070'); R(c, 3, 29, 6, 3, INK); R(c, 4, 29, 4, 2, '#4a5070');
    R(c, 2, 1, 8, 10, INK); R(c, 3, 2, 6, 8, '#fff0a0'); R(c, 4, 3, 2, 3, '#ffffff'); R(c, 3, 0, 6, 2, INK); R(c, 1, 10, 10, 1, INK);
  });
}
function mkBench() {
  return bake(34, 18, (c) => {
    ell(c, 17, 16, 15, 2, 'rgba(10,36,20,.3)');
    R(c, 2, 11, 3, 5, INK); R(c, 29, 11, 3, 5, INK);
    R(c, 1, 2, 32, 5, INK); R(c, 2, 3, 30, 3, '#b0743c'); R(c, 2, 3, 30, 1, '#d09a60');
    R(c, 1, 8, 32, 5, INK); R(c, 2, 9, 30, 3, '#c0844a'); R(c, 2, 9, 30, 1, '#e2ac72');
  });
}
function mkMailbox() {
  return bake(10, 18, (c) => {
    ell(c, 5, 17, 4, 1, 'rgba(10,36,20,.3)');
    R(c, 4, 9, 2, 8, '#3a2210'); R(c, 0, 1, 10, 9, INK); R(c, 1, 2, 8, 7, '#d9483a'); R(c, 1, 2, 8, 2, '#f07a6a'); R(c, 2, 5, 4, 1, '#7a1f2a'); R(c, 8, 0, 2, 4, INK); R(c, 8, 1, 1, 2, '#ffe27a');
  });
}
function mkFountainBase() {
  return bake(68, 52, (c) => {
    ell(c, 34, 44, 33, 7, 'rgba(10,36,20,.28)');
    ell(c, 34, 36, 31, 12, INK); ell(c, 34, 34, 30, 11, '#b9b6c8'); ell(c, 34, 34, 30, 11, '#cfccdd'); ell(c, 34, 36, 30, 10, '#9894ac');
    ell(c, 34, 33, 26, 8, INK); ell(c, 34, 33, 25, 7, '#6fc4e8'); ell(c, 34, 34, 22, 6, '#58b0dc'); ell(c, 30, 31, 12, 3, '#8ad6f2');
    R(c, 28, 20, 12, 12, INK); R(c, 29, 18, 10, 14, '#cfccdd'); R(c, 29, 18, 4, 14, '#e8e6f2'); R(c, 36, 18, 3, 14, '#9894ac');
    ell(c, 34, 18, 9, 3, INK); ell(c, 34, 17, 8, 2, '#cfccdd'); ell(c, 34, 17, 6, 1, '#6fc4e8');
  });
}
const treeSprites = { oak: [0, 1, 2].map(mkOak), pine: [0, 1].map(mkPine), bush: [0, 1, 2].map(mkBush) };

Object.assign(FW, { TS, mk, R, px, ell, clamp, rng, hash, rgb, shade, bake, INK, CAP, CAP2, sheet, cam, shadowFlat, mkLook, PLAYER_LOOK, charSprite, drawPerson, bubble, GEAR, ACC, strW, drawStr,
  tinyText, simplify, mkOak, houseSprite, buildingSprite, mkSign, mkDistrictSign, mkLamp, mkBench, mkMailbox, mkFountainBase, treeSprites, HSTY });
})();
