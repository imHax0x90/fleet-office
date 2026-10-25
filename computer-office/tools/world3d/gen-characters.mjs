#!/usr/bin/env node
// Crée des personnages « overworld » dans l'esprit des feuilles IcyEthics : cellules 32×48, 4 directions × 4 frames (repos, pas, repos, pas),
// grosse tête, contour sombre, deux tons d'ombrage. Dessins originaux faits à la main par code (aucune ressource existante copiée).
// usage : node tools/world3d/gen-characters.mjs → assets/tex/chr_<id>.png + entrées de registre
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url"; import { Img, hex, shade } from "./png.mjs";
const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../public/world3d/assets"), TEX = path.join(ASSETS, "tex");
const LINE = [29, 26, 36, 255], WHITE = [255, 255, 255, 255];
// ---- personnages : palette + options (hair: short|swept|long|bun|bald|curly|spiky, hat: cap|hard|beanie|none, coat: long|vest|plain)
const CHARS = [
  { id: "rene", name: "René", note: "père de Barry, version retravaillée : cheveux blonds en brosse, moustache, gilet bleu sur marinière, jean", skin: "#f0c8a0", hair: "#e8c050", hairStyle: "swept", top: "#e8e8f0", stripe: "#d03a3a", vest: "#2f4f9a", pants: "#3a5a8a", shoes: "#5a3a2a", mustache: "#c9a238", coat: "vest", belt: "#5a3a2a" },
  { id: "ingenieur", name: "Ingénieur", skin: "#e0ac84", hair: "#4a2f1d", hairStyle: "short", hat: "hard", hatColor: "#f0c020", top: "#e8902f", topDark: null, pants: "#4a4a58", shoes: "#3a3028", coat: "vest", vest: "#e8902f", beard: "#4a2f1d", bag: "#8a6a4a" },
  { id: "scientifique", name: "Scientifique", skin: "#f1c6a0", hair: "#d8d8e4", hairStyle: "spiky", top: "#f4f4f8", pants: "#5a6a8a", shoes: "#3a3a48", coat: "long", glasses: true, collar: "#4a6fb8" },
  { id: "analyste", name: "Analyste", skin: "#f1c6a0", hair: "#5a3a22", hairStyle: "swept", top: "#8a5a3a", pants: "#3a3a4a", shoes: "#2a2a30", glasses: true, coat: "plain", collar: "#f4f4f8", badge: "#4a6fb8" },
  { id: "operateur", name: "Opérateur", skin: "#c58a62", hair: "#2a1d1a", hairStyle: "short", hat: "cap", hatColor: "#3f7f4a", top: "#4e8a4a", pants: "#40382c", shoes: "#2a2218", coat: "plain", collar: "#e8d060" },
  { id: "securite", name: "Sécurité", skin: "#e0ac84", hair: "#1f1a18", hairStyle: "short", hat: "cap", hatColor: "#1f2230", top: "#262a3a", pants: "#161824", shoes: "#0e0f16", coat: "plain", collar: "#8a93a8", badge: "#e8c020" },
  { id: "livreur", name: "Livreur", skin: "#f1c6a0", hair: "#6b3a1f", hairStyle: "short", hat: "cap", hatColor: "#d03a3a", top: "#d03a3a", pants: "#2e3340", shoes: "#2a2a30", coat: "plain", collar: "#f4f4f8", bag: "#c9a46a" },
  { id: "etudiant", name: "Étudiant", skin: "#f1c6a0", hair: "#3a2418", hairStyle: "swept", hat: "none", top: "#3a66c8", pants: "#2e3340", shoes: "#d8d8e4", coat: "plain", scarf: "#f0c020", bag: "#d03a3a" },
  { id: "medecin", name: "Médecin", skin: "#f1c6a0", hair: "#6a3a2a", hairStyle: "bun", top: "#f4f4f8", pants: "#3aa0a8", shoes: "#e8e8f0", coat: "long", collar: "#3aa0a8", badge: "#d03a3a" },
];
function drawFrame(img, ox, oy, c, dir, f) {
  const C = (h) => (typeof h === "string" ? hex(h) : h), skin = C(c.skin), hair = C(c.hair), top = C(c.top), pants = C(c.pants), shoes = C(c.shoes), step = f === 1 ? 0 : f === 3 ? 1 : -1, bob = step >= 0 ? -1 : 0;
  const R = (x, y, w, h, col) => img.rect(ox + x, oy + y, w, h, col), P = (x, y, col) => img.px(ox + x, oy + y, col);
  const side = dir === 1 || dir === 2, mir = dir === 2, mx = (x, w = 1) => (mir ? 32 - x - w : x);
  const SR = (x, y, w, h, col) => R(mx(x, w), y, w, h, col), SP = (x, y, col) => P(mx(x), y, col);
  const hi = (col) => shade(col, 1.22), lo = (col) => shade(col, 0.78), longCoat = c.coat === "long";
  // ----- jambes (y 31→43) et chaussures
  const legTop = longCoat ? 37 : 31, legEnd = (l) => 43 - (step === l ? 2 : 0);
  if (!side) for (const [l, x] of [[0, 11], [1, 16]]) { const e = legEnd(l); if (e - 3 > legTop) { R(x, legTop, 5, e - 3 - legTop, pants); R(x + 4, legTop, 1, e - 3 - legTop, lo(pants)); } R(x - 1, e - 3, 7, 4, shoes); R(x - 1, e - 3, 7, 1, hi(shoes)); }
  else { const g = step < 0 ? 0 : 3; SR(13 - g, legTop, 5, 40 - legTop, pants); SR(12 - g, 40, 8, 4, shoes); SR(14 + g, legTop, 5, 40 - legTop - (step >= 0 ? 1 : 0), lo(pants)); SR(13 + g, 39 + (step >= 0 ? 0 : 1), 8, 4, lo(shoes)); }
  // ----- sac
  if (c.bag && dir === 3) { R(9, 21 + bob, 14, 11, C(c.bag)); R(9, 21 + bob, 14, 2, hi(C(c.bag))); R(9, 30 + bob, 14, 2, lo(C(c.bag))); }
  // ----- torse
  const tx = side ? 11 : 10, tw = side ? 10 : 12, hem = longCoat ? 41 : 32, tdark = lo(top);
  if (!side) { R(tx, 20 + bob, tw, hem - 20, top); R(tx + tw - 3, 21 + bob, 3, hem - 21, tdark); R(tx, 20 + bob, tw, 1, hi(top)); if (longCoat) { R(tx - 1, 32, tw + 2, 9, top); R(tx + tw - 2, 32, 3, 9, tdark); R(15, 23 + bob, 2, 17, lo(top)); } }
  else { SR(tx, 20 + bob, tw, hem - 20, top); SR(tx + tw - 3, 21 + bob, 3, hem - 21, tdark); SR(tx, 20 + bob, tw, 1, hi(top)); }
  if (dir === 0) {
    if (c.stripe) for (let y = 22 + bob; y < 31; y += 3) R(11, y, 10, 1, C(c.stripe));
    if (c.vest) { R(10, 20 + bob, 5, 12, C(c.vest)); R(17, 20 + bob, 5, 12, C(c.vest)); R(10, 20 + bob, 5, 1, hi(C(c.vest))); R(17, 20 + bob, 5, 1, hi(C(c.vest))); R(10, 31, 12, 1, lo(C(c.vest))); }
    if (c.belt) { R(10, 30, 12, 2, C(c.belt)); R(15, 30, 2, 2, [240, 210, 90, 255]); }
    if (c.collar) R(12, 20 + bob, 8, 2, C(c.collar)); if (c.badge) R(18, 24 + bob, 3, 3, C(c.badge)); if (c.scarf) { R(10, 19 + bob, 12, 3, C(c.scarf)); R(10, 21 + bob, 3, 5, C(c.scarf)); }
  } else if (side) { if (c.scarf) SR(11, 19 + bob, 10, 3, C(c.scarf)); if (c.collar) SR(11, 20 + bob, 5, 2, C(c.collar)); if (c.vest) SR(11, 20 + bob, 5, 11, C(c.vest)); }
  // ----- bras
  const aL = step === 0 ? 1 : step === 1 ? -1 : 0, aR = -aL;
  if (!side) for (const [x, sw] of [[7, aL], [22, aR]]) { R(x, 21 + bob, 3, 8 + sw, top); R(x + (x < 10 ? 0 : 2), 21 + bob, 1, 8 + sw, tdark); R(x, 29 + bob + sw, 3, 3, skin); if (c.vest && dir === 0) R(x, 21 + bob, 3, 3, C(c.vest)); }
  else { const sw = step < 0 ? 0 : step === 0 ? 2 : -2; SR(14 + sw, 21 + bob, 4, 9, lo(top)); SR(14 + sw, 29 + bob, 4, 3, skin); }
  // ----- tête : 20×17
  const hx = side ? 7 : 6, hw = side ? 18 : 20, insets = [4, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 5];
  insets.forEach((n, y) => SR(hx + n, 4 + y + bob, hw - n * 2, 1, y > 12 ? lo(skin) : skin));
  if (side) { SR(14, 12 + bob, 3, 4, lo(skin)); SR(5, 14 + bob, 2, 3, skin); SR(5, 16 + bob, 2, 1, lo(skin)); }
  if (dir === 0) {
    for (const x of [10, 19]) { R(x, 12 + bob, 3, 4, LINE); P(x, 12 + bob, WHITE); P(x + 1, 12 + bob, WHITE); R(x - 1, 16 + bob, 5, 1, lo(skin)); }
    R(14, 17 + bob, 4, 1, [170, 90, 80, 255]);
    if (c.glasses) { for (const x of [9, 18]) { R(x, 11 + bob, 6, 1, LINE); R(x, 16 + bob, 6, 1, LINE); R(x, 11 + bob, 1, 6, LINE); R(x + 5, 11 + bob, 1, 6, LINE); } R(15, 13 + bob, 2, 1, LINE); }
    if (c.beard) { R(7, 14 + bob, 18, 6, C(c.beard)); R(13, 17 + bob, 6, 1, lo(C(c.beard))); R(12, 16 + bob, 8, 2, skin); R(14, 17 + bob, 4, 1, [170, 90, 80, 255]); }
    if (c.mustache) { R(11, 16 + bob, 10, 2, C(c.mustache)); R(10, 17 + bob, 2, 1, C(c.mustache)); R(20, 17 + bob, 2, 1, C(c.mustache)); R(14, 15 + bob, 4, 1, lo(C(c.mustache))); }
  }
  if (side) { SR(9, 12 + bob, 2, 4, LINE); SP(9, 12 + bob, WHITE); if (c.glasses) { SR(8, 11 + bob, 6, 1, LINE); SR(8, 16 + bob, 6, 1, LINE); SR(8, 11 + bob, 1, 6, LINE); SR(13, 11 + bob, 1, 6, LINE); } if (c.beard) SR(7, 14 + bob, 8, 6, C(c.beard)); if (c.mustache) SR(5, 15 + bob, 7, 2, C(c.mustache)); }
  // ----- cheveux / couvre-chef
  const H = hair, Hh = hi(hair), Hl = lo(hair), style = c.hairStyle;
  if (dir === 0 && style !== "bald") { R(6, 6 + bob, 20, 6, H); R(8, 4 + bob, 16, 3, H); R(10, 3 + bob, 12, 1, H); R(6, 12 + bob, 3, 5, H); R(23, 12 + bob, 3, 5, H); R(9, 5 + bob, 9, 1, Hh);
    if (style === "swept") { R(6, 10 + bob, 11, 3, H); R(15, 10 + bob, 5, 2, H); R(11, 2 + bob, 10, 2, H); R(12, 2 + bob, 5, 1, Hh); R(18, 11 + bob, 6, 1, Hl); } if (style === "spiky") { for (const x of [7, 11, 15, 19, 23]) R(x, 1 + bob, 2, 4, H); R(8, 3 + bob, 16, 2, H); R(10, 10 + bob, 12, 2, H); } if (style === "long") { R(5, 12 + bob, 3, 12, H); R(24, 12 + bob, 3, 12, H); R(10, 10 + bob, 12, 2, H); } if (style === "bun") { R(13, 0 + bob, 6, 5, H); R(14, 0 + bob, 3, 1, Hh); R(10, 10 + bob, 12, 2, H); } if (style === "short") R(9, 10 + bob, 14, 2, H); }
  else if (dir === 3) { R(6, 5 + bob, 20, 14, H); R(8, 3 + bob, 16, 2, H); R(7, 16 + bob, 18, 3, Hl); R(8, 5 + bob, 14, 1, Hh); if (style === "bun") R(13, 0 + bob, 6, 5, H); if (style === "spiky") for (const x of [7, 11, 15, 19, 23]) R(x, 1 + bob, 2, 4, H); if (style === "long") R(5, 12 + bob, 22, 12, H); }
  else if (style !== "bald") { SR(7, 6 + bob, 18, 6, H); SR(9, 4 + bob, 14, 3, H); SR(11, 3 + bob, 9, 1, H); SR(15, 11 + bob, 9, 9, H); SR(9, 5 + bob, 7, 1, Hh); if (style === "swept") { SR(6, 9 + bob, 6, 4, H); SR(11, 2 + bob, 8, 2, H); } if (style === "spiky") for (const x of [9, 13, 17, 21]) SR(x, 1 + bob, 2, 4, H); if (style === "bun") SR(17, 0 + bob, 6, 5, H); if (style === "long") SR(15, 12 + bob, 10, 12, H); }
  if (c.hat === "cap" || c.hat === "hard" || c.hat === "beanie") {
    const hc = C(c.hatColor), t = c.hat === "hard" ? 2 : 3;
    if (dir === 3) { R(6, t + bob, 20, 9, hc); R(8, t - 1 + bob, 16, 1, hc); R(8, t + bob, 16, 1, hi(hc)); }
    else if (dir === 0) { R(6, t + bob, 20, 8, hc); R(8, t - 1 + bob, 16, 1, hc); R(8, t + bob, 16, 1, hi(hc)); if (c.hat !== "beanie") { R(4, 10 + bob, 24, 2, lo(hc)); R(4, 10 + bob, 24, 1, hc); } if (c.hat === "hard") R(14, 0 + bob, 4, 3, hi(hc)); }
    else { SR(7, t + bob, 18, 8, hc); SR(9, t - 1 + bob, 12, 1, hc); SR(9, t + bob, 12, 1, hi(hc)); if (c.hat !== "beanie") { SR(2, 10 + bob, 12, 2, lo(hc)); SR(2, 10 + bob, 12, 1, hc); } if (c.hat === "hard") SR(12, 0 + bob, 4, 3, hi(hc)); }
  }
}
function outline(img, ox, oy) { const add = []; for (let y = 0; y < 48; y++) for (let x = 0; x < 32; x++) { if (img.get(ox + x, oy + y)[3]) continue; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < 32 && Y < 48 && img.get(ox + X, oy + Y)[3]) { add.push([x, y]); break; } } } for (const [x, y] of add) img.px(ox + x, oy + y, LINE); }
const regPath = path.join(ASSETS, "registry.json"), reg = JSON.parse(fs.readFileSync(regPath, "utf8"));
reg.assets = reg.assets.filter((a) => !/^(chr_|npc_|hero_)/.test(a.id));
for (const c of CHARS) {
  const img = new Img(128, 192); for (let d = 0; d < 4; d++) for (let f = 0; f < 4; f++) { drawFrame(img, f * 32, d * 48, c, d, f); outline(img, f * 32, d * 48); }
  const file = "tex/chr_" + c.id + ".png"; fs.writeFileSync(path.join(ASSETS, file), img.png());
  reg.assets.push({ id: "chr_" + c.id, label: c.name, category: "character", tags: ["personnage", "overworld", "3/4", "créé"], file, format: "png-spritesheet", source: { kind: "created", from: "dessiné pour ce projet par tools/world3d/gen-characters.mjs, dans l'esprit des feuilles IcyEthics", note: c.note || null }, licence: "oeuvre-utilisateur", licenceUrl: null, licenceVerified: true,
    dimensions: { w: 1.25, h: 1.875, d: 0 }, sheet: { px: [128, 192], cell: [32, 48], cols: 4, rows: 4, rowsOrder: ["bas", "gauche", "droite", "haut"], colsOrder: ["statique", "marche1", "statique2", "marche2"], footPx: 3 }, anchor: "bottom-center", scale: 1, billboard: "yaw", materials: ["alphaTest 0.5, nearest"], occlusion: { mode: "none" }, collision: { type: "circle", r: 0.3 },
    animations: [{ name: "idle", frames: [0], fps: 1 }, { name: "walk", frames: [1, 2, 3, 0], fps: 6 }, { name: "run", frames: [1, 2, 3, 0], fps: 10 }], fallback: { shape: "capsule", color: "#8a6a4a" } });
  console.log("✓ chr_" + c.id);
}
fs.writeFileSync(regPath, JSON.stringify(reg, null, 1));
