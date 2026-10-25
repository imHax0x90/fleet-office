// Génère les textures ORIGINALES du monde 3D (pixel-art, dessinées par code, déterministes).
// Aucune donnée tierce : tout est écrit ici, licence CC0 (voir public/world3d/assets/LICENCES.md).
// usage : node tools/world3d/gen-textures.mjs   → public/world3d/assets/tex/*.png
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { Img, hex, rng, shade } from "./png.mjs";
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../public/world3d/assets/tex"); fs.mkdirSync(OUT, { recursive: true });
const save = (name, img) => { fs.writeFileSync(path.join(OUT, name + ".png"), img.png()); console.log("tex", name, img.w + "x" + img.h); };
const speckle = (img, r, base, amt, n, x0 = 0, y0 = 0, w = img.w, h = img.h) => { for (let i = 0; i < n; i++) img.px(x0 + (r() * w | 0), y0 + (r() * h | 0), shade(base, 1 + (r() - .5) * amt)); };

// ---- atlas de sol : 8 tuiles de 16 px -------------------------------------------------------------------
{
  const T = 16, img = new Img(T * 12, T), r = rng(11);
  const tile = (i, f) => f(i * T);
  const grass = (x0, base, seed) => { const q = rng(seed); img.rect(x0, 0, T, T, base); speckle(img, q, base, .30, 70, x0); for (let k = 0; k < 14; k++) { const x = x0 + (q() * T | 0), y = q() * T | 0; img.px(x, y, shade(base, 1.22)); img.px(x, y + 1, shade(base, .82)); } };
  tile(0, (x) => grass(x, hex("#5fae45"), 5));
  tile(1, (x) => grass(x, hex("#59a540"), 6));
  tile(2, (x) => { grass(x, hex("#5fae45"), 7); const q = rng(9); const cols = ["#fff6c8", "#ff7a8a", "#ffd24a", "#f4f4ff"]; for (let k = 0; k < 7; k++) { const px = x + 1 + (q() * 13 | 0), py = 1 + (q() * 13 | 0), c = cols[k % 4]; img.px(px, py, c); img.px(px + 1, py, shade(hex(c), .88)); img.px(px, py + 1, "#3f8a35"); } });
  const cobble = (x0, edge) => { // pavés arrondis, joints sombres, deux tons
    const mortar = hex("#7a6c5c"); img.rect(x0, 0, T, T, mortar); const q = rng(21);
    const rows = [[0, 4], [4, 4], [8, 4], [12, 4]]; rows.forEach(([ry, rh], ri) => { let x = (ri % 2) * 2 - 2; while (x < T) { const w = 4 + (q() * 2 | 0); const base = [hex("#b9a98f"), hex("#a8997f"), hex("#c4b59b")][(q() * 3) | 0]; for (let j = 0; j < rh - 1; j++) for (let i = 0; i < w - 1; i++) { const px = x + i, py = ry + j; if (px < 0 || px >= T) continue; const corner = (i === 0 || i === w - 2) && (j === 0 || j === rh - 2); if (corner) continue; img.px(x0 + px, py, shade(base, j === 0 ? 1.12 : j === rh - 2 ? .86 : 1 + (q() - .5) * .08)); } x += w; } });
    if (edge) { for (let i = 0; i < T; i++) { img.px(x0 + i, 0, "#6b5d4c"); img.px(x0 + i, T - 1, "#6b5d4c"); img.px(x0, i, "#6b5d4c"); img.px(x0 + T - 1, i, "#6b5d4c"); img.px(x0 + i, 1, "#d8c9ac"); img.px(x0 + 1, i, "#d8c9ac"); } }
  };
  tile(3, (x) => cobble(x, false)); tile(4, (x) => cobble(x, true));
  tile(5, (x) => { const base = hex("#d9d2c0"), q = rng(31); img.rect(x, 0, T, T, base); speckle(img, q, base, .12, 40, x); for (let i = 0; i < T; i++) { img.px(x + i, 7, "#a79f8b"); img.px(x + i, 15, "#a79f8b"); img.px(x + 7, i < 8 ? i : 99, "#a79f8b"); img.px(x + 15, i, "#a79f8b"); img.px(x + 3, i >= 8 ? i : 99, "#a79f8b"); img.px(x + i, 0, "#efe9d9"); } });
  tile(6, (x) => { const base = hex("#c9a46a"), q = rng(41); img.rect(x, 0, T, T, base); speckle(img, q, base, .22, 80, x); for (let k = 0; k < 5; k++) img.px(x + (q() * T | 0), q() * T | 0, "#8a6a3c"); });
  tile(7, (x) => { const base = hex("#3f86d8"); img.rect(x, 0, T, T, base); const q = rng(51); for (let k = 0; k < 8; k++) { const px = x + (q() * 12 | 0), py = q() * T | 0; img.rect(px, py, 3, 1, "#8dc4ff"); } });
  tile(8, (x) => { const base = hex("#e8d49a"), q = rng(81); img.rect(x, 0, T, T, base); speckle(img, q, base, .14, 60, x); for (let k = 0; k < 7; k++) img.px(x + (q() * T | 0), q() * T | 0, "#c9b270"); });
  tile(9, (x) => { const base = hex("#3f8a35"), q = rng(82); img.rect(x, 0, T, T, base); speckle(img, q, base, .25, 70, x); for (let k = 0; k < 26; k++) { const px = x + (q() * 15 | 0), py = 2 + (q() * 13 | 0); img.px(px, py, "#79c457"); img.px(px, py - 1, "#79c457"); img.px(px + 1, py + 1, "#2b6b2a"); } });
  tile(10, (x) => { const base = hex("#3f86d8"); img.rect(x, 0, T, T, base); const q = rng(52); for (let k = 0; k < 8; k++) { const px = x + (q() * 12 | 0), py = q() * T | 0; img.rect(px, py, 3, 1, "#8dc4ff"); } for (let k = 0; k < 4; k++) img.px(x + (q() * 15 | 0), q() * 15 | 0, "#ffffff"); });
  tile(11, (x) => { grass(x, hex("#5fae45"), 91); const q = rng(92), cols = ["#fff6c8", "#ff7a8a", "#ffd24a", "#f4f4ff", "#b48cff"]; for (let k = 0; k < 22; k++) { const px = x + 1 + (q() * 14 | 0), py = 1 + (q() * 14 | 0), c = cols[k % 5]; img.px(px, py, c); img.px(px + 1, py, shade(hex(c), .85)); } });
  save("ground", img);
}

// ---- murs (32×32, répétables) ---------------------------------------------------------------------------
const wall = (name, base, seed, opt = {}) => {
  const img = new Img(32, 32), q = rng(seed); img.rect(0, 0, 32, 32, base); speckle(img, q, hex(base), .10, 120);
  if (opt.brick) { const d = shade(hex(base), .7); for (let y = 0; y < 32; y += 4) { img.rect(0, y + 3, 32, 1, d); for (let x = ((y / 4) % 2) * 4; x < 32; x += 8) img.rect(x, y, 1, 4, d); } for (let k = 0; k < 40; k++) img.px(q() * 32 | 0, q() * 32 | 0, shade(hex(base), .85 + q() * .3)); }
  if (opt.panel) { const d = shade(hex(base), .75), l = shade(hex(base), 1.15); for (const x of [0, 16]) { img.rect(x, 0, 1, 32, d); img.rect(x + 1, 0, 1, 32, l); } for (const y of [10, 22]) { img.rect(0, y, 32, 1, d); } for (const [x, y] of [[4, 4], [12, 4], [20, 4], [28, 4], [4, 27], [12, 27], [20, 27], [28, 27]]) img.px(x, y, d); }
  if (opt.timber) { const w = hex("#6b4a2b"); for (const x of [0, 15]) img.rect(x, 0, 2, 32, w); img.rect(0, 0, 32, 2, w); img.rect(0, 30, 32, 2, w); for (let i = 0; i < 14; i++) { img.px(2 + i, 2 + i, w); img.px(3 + i, 2 + i, w); } }
  if (opt.clap) { const d = shade(hex(base), .8), l = shade(hex(base), 1.12); for (let y = 0; y < 32; y += 4) { img.rect(0, y, 32, 1, l); img.rect(0, y + 3, 32, 1, d); } }
  save(name, img);
};
wall("wall_cream", "#f1e3c0", 101, { clap: true }); wall("wall_blue", "#8fb2d8", 102, { clap: true }); wall("wall_brick", "#b9583f", 103, { brick: true });
wall("wall_mint", "#a8d8b9", 104, { clap: true }); wall("wall_sand", "#e0c08a", 105, { clap: true }); wall("wall_rose", "#e7a7a0", 106, { clap: true });
wall("wall_panel", "#8c97a6", 107, { panel: true }); wall("wall_timber", "#eadcb8", 108, { timber: true }); wall("wall_lab", "#e7f0f4", 109, { panel: true });
wall("wall_stone", "#b8b2a6", 110, { brick: true });

// ---- toits (32×32) : rangées de tuiles avec relief (arête claire / ombre portée) ----------------------------
const roof = (name, base, seed, flat = false) => {
  const img = new Img(32, 32), q = rng(seed), b = hex(base); img.rect(0, 0, 32, 32, b);
  if (flat) { speckle(img, q, b, .16, 200); for (let x = 0; x < 32; x += 8) img.rect(x, 0, 1, 32, shade(b, .8)); }
  else for (let y = 0; y < 32; y += 4) { const off = ((y / 4) % 2) * 4; for (let x = 0; x < 32; x += 8) { const t = shade(b, .92 + q() * .16); img.rect(x + off - 8, y, 8, 4, t); img.rect(x + off - 8, y, 8, 1, shade(b, 1.28)); img.rect(x + off - 8, y + 3, 8, 1, shade(b, .62)); img.rect(x + off - 8, y, 1, 4, shade(b, .74)); img.rect(x + off, y, 1, 4, shade(b, .74)); } }
  save(name, img);
};
roof("roof_red", "#c8503c", 201); roof("roof_blue", "#4a6fb8", 202); roof("roof_green", "#4e9b62", 203); roof("roof_slate", "#59616e", 204);
roof("roof_orange", "#dd8a3a", 205); roof("roof_teal", "#2f9aa0", 206); roof("roof_flat", "#6a6f78", 207, true); roof("roof_crimson", "#a82f45", 208);

// ---- ouvertures / détails ------------------------------------------------------------------------------
{ // fenêtre 32×32 : cadre bois, vitre dégradée, croisillon, reflet, appui
  const img = new Img(32, 32); img.rect(0, 0, 32, 32, "#5a3e24"); img.rect(2, 2, 28, 26, "#2d3d57");
  for (let y = 0; y < 26; y++) img.rect(3, 3 + y, 26, 1, y < 13 ? "#8fd0f0" : "#5b9ccc"); img.rect(15, 2, 2, 26, "#5a3e24"); img.rect(2, 14, 28, 2, "#5a3e24");
  for (let i = 0; i < 6; i++) { img.px(5 + i, 9 - Math.min(i, 5), "#e9f8ff"); } img.rect(0, 28, 32, 4, "#8c6a43"); img.rect(0, 28, 32, 1, "#b88f5b"); save("window", img);
}
{ // fenêtre « écran » (centres tech) : bande sombre avec lumières
  const img = new Img(32, 32), q = rng(33); img.rect(0, 0, 32, 32, "#1f2735"); img.rect(2, 3, 28, 24, "#0e1522");
  for (let y = 5; y < 25; y += 4) for (let x = 4; x < 28; x += 1) if (q() > .35) img.px(x, y, ["#5af2c0", "#58b7ff", "#ffd45a"][(q() * 3) | 0]); img.rect(0, 28, 32, 4, "#566174"); save("window_tech", img);
}
{ // porte bois 32×48
  const img = new Img(32, 48); img.rect(0, 0, 32, 48, "#4b3320"); img.rect(2, 2, 28, 46, "#8a5a33");
  for (let x = 6; x < 30; x += 7) img.rect(x, 2, 1, 46, "#6e4524"); img.rect(4, 6, 10, 14, "#6e4524"); img.rect(18, 6, 10, 14, "#6e4524"); img.rect(4, 26, 10, 18, "#6e4524"); img.rect(18, 26, 10, 18, "#6e4524");
  img.rect(24, 24, 3, 3, "#f0c75a"); img.rect(0, 0, 32, 2, "#d8c9ac"); save("door", img);
}
{ // porte vitrée automatique 32×48
  const img = new Img(32, 48); img.rect(0, 0, 32, 48, "#39424f"); img.rect(2, 3, 12, 43, "#8fd0f0"); img.rect(18, 3, 12, 43, "#8fd0f0"); img.rect(2, 3, 12, 6, "#c9ecfb"); img.rect(18, 3, 12, 6, "#c9ecfb"); img.rect(14, 3, 4, 43, "#39424f"); img.rect(12, 24, 1, 6, "#fff"); img.rect(19, 24, 1, 6, "#fff"); save("door_glass", img);
}
{ // enseigne/bandeau 64×16 vierge (les noms sont posés en canvas par le moteur)
  const img = new Img(32, 16); img.rect(0, 0, 32, 16, "#2c3a56"); img.rect(0, 0, 32, 2, "#7f9ad0"); img.rect(0, 14, 32, 2, "#1d2740"); save("signboard", img);
}
{ const img = new Img(16, 16), q = rng(61); img.rect(0, 0, 16, 16, "#8c6a43"); for (let y = 0; y < 16; y += 4) img.rect(0, y, 16, 1, "#6e4f2e"); speckle(img, q, hex("#8c6a43"), .2, 40); save("wood", img); }
{ const img = new Img(16, 16), q = rng(62); img.rect(0, 0, 16, 16, "#4a3524"); for (let x = 0; x < 16; x += 3) img.rect(x, 0, 1, 16, "#352415"); speckle(img, q, hex("#4a3524"), .25, 30); save("bark", img); }
{ const img = new Img(16, 16), q = rng(63); img.rect(0, 0, 16, 16, "#79828f"); speckle(img, q, hex("#79828f"), .2, 60); img.rect(0, 0, 16, 1, "#aeb6c2"); save("metal", img); }
{ const img = new Img(16, 16), q = rng(64); img.rect(0, 0, 16, 16, "#9aa0a8"); speckle(img, q, hex("#9aa0a8"), .22, 70); for (let k = 0; k < 4; k++) img.rect(q() * 14 | 0, q() * 14 | 0, 2, 1, "#6d747c"); save("stone", img); }
{ // feuillage : amas de feuilles à 3 tons (pixels nets)
  const mk = (name, base, seed) => { const img = new Img(16, 16), q = rng(seed), b = hex(base); img.rect(0, 0, 16, 16, shade(b, .85)); for (let k = 0; k < 26; k++) { const x = q() * 14 | 0, y = q() * 14 | 0, t = q(); const c = t > .6 ? shade(b, 1.25) : t > .25 ? b : shade(b, .7); img.rect(x, y, 3, 2, c); img.px(x + 1, y, shade(c, 1.15)); } save(name, img); };
  mk("leaf", "#3f9a45", 71); mk("leaf_dark", "#2f7d3c", 72); mk("leaf_autumn", "#d9822b", 73);
}
{ // fleurs : tiges + corolles sur fond transparent (billboard croisé)
  const img = new Img(16, 16), q = rng(81); for (let k = 0; k < 5; k++) { const x = 1 + k * 3 + (q() * 2 | 0), top = 3 + (q() * 5 | 0), c = ["#ff6f8d", "#ffd24a", "#f6f6ff", "#b48cff", "#ff9a4a"][k]; for (let y = top + 2; y < 16; y++) img.px(x, y, "#3f8a35"); img.px(x - 1, top + 1, hex(c)); img.px(x + 1, top + 1, hex(c)); img.px(x, top, hex(c)); img.px(x, top + 2, hex(c)); img.px(x, top + 1, "#ffe9a0"); } save("flowers", img);
}
{ // halo de lampadaire / verre
  const img = new Img(8, 8); img.rect(0, 0, 8, 8, "#fff2b0"); img.rect(1, 1, 6, 6, "#ffe27a"); save("lamp_glass", img);
}
{ // drapeau
  const img = new Img(16, 8); img.rect(0, 0, 16, 8, "#d9483a"); img.rect(0, 3, 16, 2, "#fbfbff"); save("flag", img);
}

// ---- personnages : proportions « overworld » (grosse tête, petit corps), contour sombre, 4 directions × 4 frames, cellule 16×24
// feuille : colonnes = idle, marche A, idle bis, marche B ; lignes = bas, gauche, droite, haut. Six à huit tenues originales (aucun personnage existant).
const PAL = [ // coat, pants, hair, skin, acc (écharpe/col), head: 0 cheveux / 1 casquette / 2 bonnet / 3 capuche, bag, skirt
  { coat: "#2f9aa0", pants: "#2b3a55", hair: "#4a2f1d", skin: "#f1c6a0", acc: "#ff9a3a", head: 1, hat: "#d9483a", bag: true }, // 0 joueur
  { coat: "#d9483a", pants: "#3a3347", hair: "#1f1a18", skin: "#e0ac84", acc: "#ffe27a", head: 0 },
  { coat: "#4a6fb8", pants: "#2e3340", hair: "#8a5a2b", skin: "#f1c6a0", acc: "#ffffff", head: 2, hat: "#ffd24a" },
  { coat: "#4e9b62", pants: "#40382c", hair: "#d8c27a", skin: "#c58a62", acc: "#ffe27a", head: 0, bag: true },
  { coat: "#b48cff", pants: "#6b4a8a", hair: "#2a1d3a", skin: "#f1c6a0", acc: "#ffd24a", head: 0, skirt: true },
  { coat: "#e0a02f", pants: "#3b3b3b", hair: "#6b3a1f", skin: "#8c5a3c", acc: "#fbfbff", head: 1, hat: "#2f9aa0" },
  { coat: "#e8e8f0", pants: "#4a5878", hair: "#7a5a3a", skin: "#f1c6a0", acc: "#d9483a", head: 3, hat: "#e8e8f0" },
  { coat: "#e86a9a", pants: "#8a3a5a", hair: "#3a2418", skin: "#e0ac84", acc: "#ffffff", head: 0, skirt: true, bag: true },
  { coat: "#8a6a4a", pants: "#4a4a4a", hair: "#e6e6e6", skin: "#e0ac84", acc: "#d9483a", head: 0 },               // 8 ancien
  { coat: "#2f6f9a", pants: "#3a4a3a", hair: "#6b3a1f", skin: "#f1c6a0", acc: "#ffe27a", head: 2, hat: "#e8c870", bag: true }, // 9 pêcheur
  { coat: "#5a8a3a", pants: "#6b5a3a", hair: "#4a2f1d", skin: "#c58a62", acc: "#fbfbff", head: 1, hat: "#e8c870" },   // 10 jardinier
  { coat: "#2f4aa0", pants: "#2e3340", hair: "#1f1a18", skin: "#f1c6a0", acc: "#ffd24a", head: 1, hat: "#2f4aa0", bag: true }, // 11 facteur
];
const LINE = [29, 26, 36, 255];
const drawChar = (img, ox, oy, p, dir, f) => {
  const C = (h) => hex(h), walk = f === 1 || f === 3, stepL = f === 1, by = f === 2 ? 1 : 0, coat = C(p.coat), hair = C(p.hair), skin = C(p.skin), pants = C(p.pants), acc = C(p.acc);
  const R = (x, y, w, h, c) => img.rect(ox + x, oy + y, w, h, c);
  // jambes (3 px de haut), pieds sombres
  const legTop = p.skirt ? 17 : 16;
  if (dir === 1 || dir === 2) { R(5, legTop + by, 6, 22 - legTop - by - 1, pants); if (walk) { R(stepL ? 4 : 7, 20, 4, 2, pants); } R(5, 21, 6, 1, [60, 52, 60, 255]); }
  else { const lh = (l) => (walk && l === (stepL ? 0 : 1) ? 1 : 0); R(5, legTop + by, 3, 21 - legTop - by - lh(0), pants); R(8, legTop + by, 3, 21 - legTop - by - lh(1), pants); R(5, 21 - lh(0), 3, 1, [60, 52, 60, 255]); R(8, 21 - lh(1), 3, 1, [60, 52, 60, 255]); }
  if (p.skirt) R(4, 15 + by, 8, 3, shade(coat, .9));
  // corps + bras
  R(4, 10 + by, 8, 7 - (p.skirt ? 1 : 0), coat); R(4, 10 + by, 8, 1, shade(coat, 1.25)); R(4, 15 + by, 8, 1, shade(coat, .8)); R(4, 10 + by, 8, 1, acc);
  if (dir === 1 || dir === 2) { const ax = dir === 1 ? 5 : 8; R(ax, 11 + by, 3, 4, shade(coat, .85)); R(ax, 15 + by + (walk ? (stepL ? 0 : 1) : 0), 3, 1, skin); }
  else { R(3, 11 + by, 2, 4, shade(coat, .85)); R(11, 11 + by, 2, 4, shade(coat, .85)); R(3, 15 + by + (walk && stepL ? 1 : 0), 2, 1, skin); R(11, 15 + by + (walk && !stepL ? 1 : 0), 2, 1, skin); }
  if (p.bag) { if (dir === 3) R(5, 11 + by, 6, 5, shade(C("#c9a46a"), .95)); else if (dir === 1) R(10, 11 + by, 2, 4, C("#c9a46a")); else if (dir === 2) R(4, 11 + by, 2, 4, C("#c9a46a")); }
  // tête (10 × 9)
  R(3, 2 + by, 10, 8, skin);
  const eye = (x, y) => { R(x, y, 2, 2, LINE); R(x, y, 1, 1, [255, 255, 255, 255]); };
  if (dir === 0) { eye(5, 6 + by); eye(9, 6 + by); R(7, 8 + by, 2, 1, shade(skin, .8)); }
  if (dir === 1) { eye(4, 6 + by); } if (dir === 2) { eye(10, 6 + by); }
  // cheveux / couvre-chef
  const hat = p.hat && C(p.hat);
  if (p.head === 3) { R(2, 1 + by, 12, 5, hat); R(2, 4 + by, 2, 6, hat); R(12, 4 + by, 2, 6, hat); if (dir === 3) R(3, 5 + by, 10, 5, hat); if (dir === 0) { R(4, 4 + by, 8, 1, shade(hat, .85)); } }
  else { // cheveux
    if (dir === 0) { R(3, 1 + by, 10, 3, hair); R(3, 4 + by, 2, 2, hair); R(11, 4 + by, 2, 2, hair); }
    else if (dir === 3) { R(3, 1 + by, 10, 8, hair); }
    else { R(3, 1 + by, 10, 3, hair); R(dir === 1 ? 8 : 3, 3 + by, 5, 6, hair); }
    if (p.head === 1) { R(3, 0 + by, 10, 3, hat); if (dir === 0) R(3, 3 + by, 10, 1, shade(hat, .75)); if (dir === 1) R(0, 2 + by, 5, 1, shade(hat, .75)); if (dir === 2) R(11, 2 + by, 5, 1, shade(hat, .75)); }
    if (p.head === 2) { R(3, 0 + by, 10, 4, hat); R(3, 3 + by, 10, 1, shade(hat, .8)); R(7, -1 + by, 2, 1, shade(hat, 1.2)); }
  }
};
const outline = (img, ox, oy, w, h) => { const keep = []; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { if (img.get(ox + x, oy + y)[3]) continue; let n = false; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < w && Y < h && img.get(ox + X, oy + Y)[3]) n = true; } if (n) keep.push([x, y]); } for (const [x, y] of keep) img.px(ox + x, oy + y, LINE); };
PAL.forEach((p, i) => { const img = new Img(64, 96); for (let d = 0; d < 4; d++) for (let f = 0; f < 4; f++) { drawChar(img, f * 16, d * 24, p, d, f); outline(img, f * 16, d * 24, 16, 24); } save("char_" + i, img); });

// ---- touffes d'herbe haute (billboard croisé), voile de moulin, cadran d'horloge
{ const img = new Img(16, 16), q = rng(95); for (let b = 0; b < 7; b++) { const x0 = 1 + b * 2 + (q() * 2 | 0), h = 7 + (q() * 8 | 0), lean = (q() * 3 | 0) - 1; for (let y = 0; y < h; y++) { const x = x0 + Math.round(lean * y / h * 2); img.px(x, 15 - y, y > h - 3 ? "#9be06a" : y > h / 2 ? "#4aa63f" : "#2f7d3c"); img.px(x + 1, 15 - y, y > h - 3 ? "#79c457" : "#2f7d3c"); } } save("tallgrass", img); }
{ const img = new Img(16, 32); img.rect(0, 0, 16, 32, "#f4ecd0"); for (let y = 0; y < 32; y += 4) img.rect(0, y, 16, 1, "#d9cfa8"); img.rect(0, 0, 16, 2, "#6b4a2b"); img.rect(0, 30, 16, 2, "#6b4a2b"); img.rect(0, 0, 2, 32, "#6b4a2b"); img.rect(14, 0, 2, 32, "#6b4a2b"); img.rect(7, 0, 2, 32, "#8c6a43"); for (let y = 6; y < 30; y += 8) img.rect(0, y, 16, 2, "#8c6a43"); save("sail", img); }
{ const img = new Img(16, 16); img.rect(0, 0, 16, 16, "#2a3347"); img.rect(1, 1, 14, 14, "#f6f1dc"); for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; img.px(8 + Math.round(Math.sin(a) * 5.5), 8 - Math.round(Math.cos(a) * 5.5), "#2a3347"); } img.rect(8, 3, 1, 5, "#2a3347"); img.rect(8, 8, 4, 1, "#2a3347"); img.rect(7, 7, 3, 3, "#d9483a"); save("clock", img); }

{ // roche de falaise : strates horizontales, fissures, mousse en haut
  const img = new Img(16, 16), q = rng(121), base = hex("#9a8a76"); img.rect(0, 0, 16, 16, base); speckle(img, q, base, .16, 90);
  for (const [y, c] of [[3, "#7e6f5d"], [7, "#b4a48c"], [11, "#7e6f5d"], [14, "#8c7c68"]]) { for (let x = 0; x < 16; x++) img.px(x, y + ((x * 7 + y) % 3 === 0 ? 1 : 0), c); }
  for (let k = 0; k < 5; k++) { const x = q() * 16 | 0, y = q() * 12 | 0; for (let j = 0; j < 4; j++) img.px(x + (j % 2), y + j, "#6a5c4c"); }
  img.rect(0, 0, 16, 2, "#5f9a45"); for (let x = 0; x < 16; x += 2) img.px(x, 2, "#4a8038"); save("cliff", img);
}
