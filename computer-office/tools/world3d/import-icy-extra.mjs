#!/usr/bin/env node
// Importe les autres feuilles overworld d'IcyEthics (même direction artistique que les premières) : détourage des fonds opaques, cellules de taille variable,
// puis fabrique des variantes par échange de palette (René = base « Navy_Temp » recolorée blond + moustache). Originaux copiés intacts dans assets/sources/.
// usage : node tools/world3d/import-icy-extra.mjs --assets <dossier PokemonAssets>
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url"; import { Img, decodePNG } from "./png.mjs";
const A = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, all) => { if (v.startsWith("--")) acc.push([v.slice(2), all[i + 1]]); return acc; }, []));
const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../public/world3d/assets"), DST = path.join(ASSETS, "sources/icyethics_pokemonassets/Overworld Sprites"), root = path.join(path.resolve(A.assets), "Overworld Sprites");
fs.mkdirSync(DST, { recursive: true });
const regPath = path.join(ASSETS, "registry.json"), reg = JSON.parse(fs.readFileSync(regPath, "utf8"));
const LIC = { licence: "icyethics-noncommercial", licenceUrl: "https://github.com/icyethics/PokemonAssets", licenceVerified: false, licenceNote: "usage personnel" };
const key = (img) => { const [r, g, b] = img.get(0, 0); for (let i = 0; i < img.w * img.h; i++) if (img.d[i * 4] === r && img.d[i * 4 + 1] === g && img.d[i * 4 + 2] === b) img.d[i * 4 + 3] = 0; return img; };
const footOf = (img, cw, ch) => { let b = 0; for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (img.d[(y * img.w + x) * 4 + 3] > 0) b = Math.max(b, y); return Math.max(0, ch - 1 - b); };
function register(id, label, img, source, note) {
  const cw = img.w / 4, ch = img.h / 4, file = "tex/" + id + ".png"; fs.writeFileSync(path.join(ASSETS, file), img.png()); reg.assets = reg.assets.filter((a) => a.id !== id);
  reg.assets.push({ id, label, category: "character", tags: ["personnage", "overworld", "3/4", "icy"], file, format: "png-spritesheet", source: { kind: "imported", from: "https://github.com/icyethics/PokemonAssets", importer: "tools/world3d/import-icy-extra.mjs", author: "IcyEthics", original: source, note: note || null }, ...LIC,
    dimensions: { w: +(cw / 25.6).toFixed(2), h: +(ch / 25.6).toFixed(2), d: 0 }, sheet: { px: [img.w, img.h], cell: [cw, ch], cols: 4, rows: 4, rowsOrder: ["bas", "gauche", "droite", "haut"], colsOrder: ["statique", "marche1", "statique2", "marche2"], footPx: footOf(img, cw, ch) }, anchor: "bottom-center", scale: 1, billboard: "yaw", materials: ["alphaTest 0.5, nearest"], occlusion: { mode: "none" }, collision: { type: "circle", r: 0.3 },
    animations: [{ name: "idle", frames: [0], fps: 1 }, { name: "walk", frames: [0, 1, 2, 3], fps: 6 }, { name: "run", frames: [0, 1, 2, 3], fps: 10 }], fallback: { shape: "capsule", color: "#8a6a4a" } });
  console.log("✓", id, img.w + "×" + img.h);
}
const load = (n) => { const f = path.join(root, n + ".png"); fs.copyFileSync(f, path.join(DST, n + ".png")); return decodePNG(fs.readFileSync(f)); };
const recolor = (img, pairs) => { const o = new Img(img.w, img.h); o.d.set(img.d); for (let i = 0; i < img.w * img.h; i++) for (const [from, to] of pairs) if (o.d[i * 4] === from[0] && o.d[i * 4 + 1] === from[1] && o.d[i * 4 + 2] === from[2] && o.d[i * 4 + 3]) { o.d[i * 4] = to[0]; o.d[i * 4 + 1] = to[1]; o.d[i * 4 + 2] = to[2]; } return o; };
// --- feuilles telles quelles (fond détouré si besoin)
const BASES = [["Trchar074", "Chapeau de paille", false], ["Trchar075", "Capuche bleue", false], ["Trchar076", "Grand chapeau", false], ["trchar077", "Gentleman", true], ["trchar078", "Vieil homme chauve", true], ["Navy_Temp", "Garçon aux cheveux verts", false], ["Scarlet_Temp", "Garçon roux", false], ["OW_Cyan", "Magicien cyan", true], ["OW_Green", "Magicien vert", true], ["OW_Pink", "Magicien rose", true], ["OW_Purple", "Magicien violet", true], ["OW_Yellow", "Magicien jaune", true], ["char_magdalyne", "Magdalyne", false]];
const imgs = {};
for (const [n, label, k] of BASES) { let im = load(n); if (k) im = key(im); imgs[n] = im; register("ow_" + n.toLowerCase().replace(/^char_|^trainer_/, ""), label, im, "Overworld Sprites/" + n + ".png"); }
// --- variantes par échange de palette
const T = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const GREEN = [[[40, 174, 129], T("#e6b84c")], [[9, 73, 51], T("#8a5a18")], [[127, 255, 212], T("#fff0a0")]]; // cheveux verts → blonds
const VEST = [[[39, 84, 117], T("#2f4f9a")], [[72, 124, 162], T("#4f78c8")], [[9, 46, 73], T("#1c2f66")]];                    // salopette bleu-gris → gilet bleu franc
let rene = recolor(recolor(imgs["Navy_Temp"], GREEN), VEST);
// moustache : les sprites sont dessinés en blocs de 2×2 px ; les yeux (blocs noirs en x=12 de la cellule) donnent la ligne, la moustache va juste dessous au centre
const cw = rene.w / 4;
for (let f = 0; f < 4; f++) { let eyeY = -1; for (let y = 24; y < 36 && eyeY < 0; y++) { const p = rene.get(f * cw + 12, y); if (p[0] === 0 && p[1] === 0 && p[2] === 0 && p[3]) eyeY = y; } if (eyeY < 0) continue; rene.rect(f * cw + 14, eyeY + 2, 4, 2, [176, 120, 28, 255]); rene.rect(f * cw + 13, eyeY + 3, 1, 1, [176, 120, 28, 255]); rene.rect(f * cw + 18, eyeY + 3, 1, 1, [176, 120, 28, 255]); }
register("ow_rene", "René", rene, "Overworld Sprites/Navy_Temp.png", "père de Barry, version retravaillée : base Navy_Temp, cheveux blonds, gilet bleu, moustache");
// rotation de teinte limitée aux pixels colorés hors tons chair (vêtements, chapeaux) : nouvelle tenue, même dessin
const hueShift = (img, deg) => { const o = new Img(img.w, img.h); o.d.set(img.d); for (let i = 0; i < img.w * img.h; i++) { if (!o.d[i * 4 + 3]) continue; const r = o.d[i * 4] / 255, g = o.d[i * 4 + 1] / 255, b = o.d[i * 4 + 2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (d < 0.18) continue; let h = d === 0 ? 0 : mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h = (h * 60 + 360) % 360; if (h > 8 && h < 55) continue; const nh = ((h + deg) % 360 + 360) % 360, l = (mx + mn) / 2, sat = d / (1 - Math.abs(2 * l - 1)), c = (1 - Math.abs(2 * l - 1)) * sat, x = c * (1 - Math.abs(((nh / 60) % 2) - 1)), m = l - c / 2, [rr, gg, bb] = nh < 60 ? [c, x, 0] : nh < 120 ? [x, c, 0] : nh < 180 ? [0, c, x] : nh < 240 ? [0, x, c] : nh < 300 ? [x, 0, c] : [c, 0, x]; o.d[i * 4] = Math.round((rr + m) * 255); o.d[i * 4 + 1] = Math.round((gg + m) * 255); o.d[i * 4 + 2] = Math.round((bb + m) * 255); } return o; };
register("ow_operateur", "Opérateur", hueShift(imgs["Trchar075"], -100), "Overworld Sprites/Trchar075.png", "variante de teinte de Trchar075 (bleu → vert)");
const VAR = [["ow_ingenieur", "Ingénieur", "Trchar074", [[[240, 200, 120], T("#f2c61c")], [[200, 168, 80], T("#d49a10")], [[176, 144, 88], T("#a8720c")]]],
  ["ow_analyste", "Analyste", "Scarlet_Temp", [[[166, 42, 42], T("#7a4a2a")], [[117, 18, 18], T("#4e2c14")], [[73, 9, 9], T("#2e1a0c")], [[219, 97, 97], T("#a8703c")]]]];
for (const [id, label, base, pairs] of VAR) if (pairs) register(id, label, recolor(imgs[base], pairs), "Overworld Sprites/" + base + ".png", "variante de palette de " + base);
fs.writeFileSync(regPath, JSON.stringify(reg, null, 1));
