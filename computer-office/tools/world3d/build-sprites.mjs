#!/usr/bin/env node
// Construit les assets 2D du village « façon Pokémon » à partir des seules sources fournies : planches de tuiles IcyEthics (découpes manuelles de
// rectangles, rognées automatiquement sur la transparence) et pack de l'utilisateur (tuiles, arbre, banc, lampadaire). Originaux jamais modifiés.
// Écrit : assets/tex/sp_*.png (sprites), tex/ground.png (atlas de sol 12 × 32 px), tex/cliff.png, et les entrées de registre correspondantes.
// usage : node tools/world3d/build-sprites.mjs
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url"; import { Img, decodePNG } from "./png.mjs";
const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../public/world3d/assets"), SRC = path.join(ASSETS, "sources"), TEX = path.join(ASSETS, "tex"); fs.mkdirSync(TEX, { recursive: true });
const ICY = path.join(SRC, "icyethics_pokemonassets"), PACK = path.join(SRC, "persos_pixel_art_pack"), town = decodePNG(fs.readFileSync(path.join(ICY, "Tilesets/padded_mycorTown.png")));
const pk = (f) => decodePNG(fs.readFileSync(path.join(PACK, f)));
const trim = (img) => { let x0 = img.w, y0 = img.h, x1 = -1, y1 = -1; for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) if (img.d[(y * img.w + x) * 4 + 3] > 8) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } if (x1 < 0) throw new Error("découpe vide"); const o = new Img(x1 - x0 + 1, y1 - y0 + 1); o.blit(img, x0, y0, o.w, o.h, 0, 0); return o; };
const crop = (src, r, clear = []) => { const o = new Img(r[2], r[3]); o.blit(src, r[0], r[1], r[2], r[3], 0, 0); for (const [cx, cy, cw, ch] of clear) for (let y = cy - r[1]; y < cy - r[1] + ch; y++) for (let x = cx - r[0]; x < cx - r[0] + cw; x++) if (x >= 0 && y >= 0 && x < o.w && y < o.h) o.d[(y * o.w + x) * 4 + 3] = 0; return trim(o); }; // clear : rectangles d'artefacts (marqueurs de section) à effacer
const LIC_ICY = { licence: "icyethics-noncommercial", licenceUrl: "https://github.com/icyethics/PokemonAssets", licenceVerified: false, licenceNote: "README : usage non commercial, dérivés libres, crédit IcyEthics" };
const LIC_USER = { licence: "oeuvre-utilisateur", licenceUrl: null, licenceVerified: true, licenceNote: "déclaré par l'auteur (l'utilisateur a écrit le code générateur)" };
const entries = [];
function sprite(id, category, img, o) { // o: { ppu, collide:{w,d}|{r}, tags, source, lic, fallback }
  const file = "tex/sp_" + id + ".png"; fs.writeFileSync(path.join(ASSETS, file), img.png()); const w = +(img.w / o.ppu).toFixed(2), h = +(img.h / o.ppu).toFixed(2);
  entries.push({ id, category, tags: ["sprite", "2d", ...(o.tags || [])], file, format: "png-sprite", source: o.source, ...o.lic, dimensions: { w, h, d: 0 }, sprite: { px: [img.w, img.h], pxPerUnit: o.ppu, anchor: "bottom-center" }, anchor: "bottom-center", scale: 1, front: "+z",
    materials: ["alphaTest 0.5, nearest"], occlusion: { mode: category === "building" ? "fade" : "none" }, collision: o.collide || null, instanced: category !== "building", animations: [], fallback: { shape: "box", color: o.fallback || "#c9a46a" } });
  console.log("sprite", id.padEnd(14), img.w + "×" + img.h, "→", w + "×" + h, "u");
}
const fromTown = (rect, note) => ({ source: { kind: "imported", from: "https://github.com/icyethics/PokemonAssets (Tilesets/padded_mycorTown.png)", importer: "tools/world3d/build-sprites.mjs", author: "IcyEthics", original: "Tilesets/padded_mycorTown.png", derived: true, crop: rect, note }, lic: LIC_ICY });
const fromPack = (file, note) => ({ source: { kind: "imported", from: "persos_pixel_art_pack.zip (script de l'utilisateur)", importer: "tools/world3d/build-sprites.mjs", author: "utilisateur", original: file, derived: false, note }, lic: LIC_USER });
const T = (id, cat, rect, ppu, extra = {}) => sprite(id, cat, crop(town, rect, extra.clear), { ppu, ...fromTown(rect, extra.note || id), ...extra });
const box = (w, d) => ({ type: "box", w, d });
// --- maisons de projet (6 styles) : façade vers le sud, porte au centre-bas
T("house_0", "building", [0, 5374, 162, 170], 26, { collide: box(5.6, 2.6), note: "cottage toit rouge" });
T("house_1", "building", [0, 5706, 162, 184], 26, { collide: box(5.6, 2.6), note: "maison à pignon brique" });
T("house_2", "building", [0, 5897, 162, 93], 26, { collide: box(5.6, 2.6), note: "maison à pignon pierre" });
T("house_3", "building", [0, 6276, 162, 130], 26, { collide: box(5.6, 2.6), note: "chaumière" });
T("house_4", "building", [0, 4862, 160, 162], 26, { clear: [[0, 4862, 34, 34]], collide: box(5.6, 2.6), note: "maison blanche toit rouge" });
T("house_5", "building", [0, 4458, 240, 150], 36, { collide: box(6.2, 2.6), note: "maison à porte arquée" });
// --- bâtiments fonctionnels
T("hq", "building", [0, 8374, 226, 364], 28, { collide: box(7.4, 3.4), note: "église / Quartier général" });
T("ai_lab", "building", [0, 6928, 256, 146], 28, { collide: box(8.4, 3), note: "bâtiment à colombages / Laboratoire IA" });
T("ops_center", "building", [0, 8016, 194, 338], 30, { collide: box(6, 3.2), note: "entrepôt / Centre d'opérations" });
T("dev_workshop", "building", [0, 6668, 256, 222], 30, { collide: box(8, 3.2), note: "grand chalet / Atelier dev" });
T("supervision", "building", [0, 6434, 226, 224], 30, { collide: box(7, 3), note: "porte fortifiée / Centre de supervision" });
// --- décor et végétation
T("well", "furniture", [2, 3764, 92, 108], 30, { collide: { type: "circle", r: 1.3 }, note: "puits" });
T("hay", "furniture", [100, 3458, 60, 110], 30, { collide: { type: "circle", r: 0.8 }, note: "botte de foin" });
T("crate", "furniture", [0, 3680, 96, 66], 30, { collide: box(3, 1.2), note: "caisses" });
T("fence", "furniture", [66, 3656, 60, 24], 26, { collide: box(2.2, 0.3), note: "clôture blanche" });
T("flowerbed", "vegetation", [160, 4462, 80, 36], 40, { note: "jardinière fleurie", fallback: "#e0a02f" });
T("bush_0", "vegetation", [0, 128, 32, 32], 30, { collide: { type: "circle", r: 0.45 }, note: "buisson" }); T("bush_1", "vegetation", [64, 128, 32, 32], 30, { collide: { type: "circle", r: 0.45 }, note: "buisson" });
T("bush_big", "vegetation", [192, 160, 64, 64], 30, { collide: { type: "circle", r: 0.9 }, note: "gros buisson" });
T("rock", "vegetation", [64, 160, 64, 32], 30, { collide: { type: "circle", r: 0.6 }, note: "rochers" });
T("tallgrass", "vegetation", [176, 224, 64, 90], 60, { note: "hautes herbes", fallback: "#4aa63f" });
T("tree_green", "vegetation", [0, 928, 64, 96], 26, { collide: { type: "circle", r: 0.5 }, note: "arbre vert", fallback: "#4e9b62" });
T("tree_autumn", "vegetation", [0, 1088, 64, 96], 26, { collide: { type: "circle", r: 0.5 }, note: "arbre jaune", fallback: "#d9b400" });
sprite("tree_user", "vegetation", trim(pk("decor/arbre.png")), { ppu: 20, collide: { type: "circle", r: 0.45 }, tags: ["arbre"], fallback: "#4e9b62", ...fromPack("decor/arbre.png", "arbre du pack") });
sprite("bench", "furniture", trim(pk("decor/banc.png")), { ppu: 24, collide: box(1.9, 0.5), ...fromPack("decor/banc.png", "banc du pack") });
sprite("lamp", "furniture", trim(pk("decor/lampadaire.png")), { ppu: 22, collide: { type: "circle", r: 0.2 }, tags: ["lumiere"], ...fromPack("decor/lampadaire.png", "lampadaire du pack") });

// --- atlas de sol : 12 tuiles de 32 px (tuiles IcyEthics + tuiles de l'utilisateur agrandies ×2 en plus proche voisin)
const NTILE = 12, TS = 32, atlas = new Img(NTILE * TS, TS);
const put = (i, src, rx, ry, scale = 1, dx = 0) => { for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) atlas.px(i * TS + ((x + dx) % TS), y, src.get(rx + Math.floor(x / scale), ry + Math.floor(y / scale))); };
const water = pk("tilesets/eau.png"), cobble = pk("tilesets/pave_cobblestone.png"), sand = pk("tilesets/chemin_sable.png");
put(0, town, 0, 64); put(1, town, 32, 64); put(2, town, 0, 160); put(3, cobble, 0, 0, 2); put(4, town, 24, 700); put(5, town, 24, 700); put(6, town, 24, 500); put(7, water, 0, 0, 2); put(8, sand, 0, 0, 2); put(9, town, 0, 96); put(10, water, 0, 0, 2, 16); put(11, town, 32, 160);
fs.writeFileSync(path.join(TEX, "ground.png"), atlas.png());
const rock = new Img(32, 32); rock.blit(town, 0, 2456, 32, 32, 0, 0); fs.writeFileSync(path.join(TEX, "cliff.png"), rock.png());
const groundSrc = (note) => ({ kind: "imported", from: "IcyEthics (herbe, sable, gravier, pierre) + pack utilisateur (pavés, eau, sable)", importer: "tools/world3d/build-sprites.mjs", note });
entries.push({ id: "ground_atlas", category: "terrain", tags: ["sol", "tuiles"], file: "tex/ground.png", format: "png-atlas", source: groundSrc("atlas de sol 12 tuiles de 32 px"), licence: "icyethics-noncommercial", licenceUrl: null, licenceVerified: false, dimensions: { w: NTILE * TS, h: TS, d: 0 },
  atlas: { tile: TS, tiles: ["grass_a", "grass_b", "grass_flowers", "cobble", "stone_b", "plaza_stone", "dirt", "water", "sand", "grass_c", "water_b", "flower_field"] }, anchor: "tile", scale: 1, materials: ["nearest"], occlusion: { mode: "none" }, collision: null, animations: [], fallback: { shape: "plane", color: "#5fae45" } });
entries.push({ id: "cliff_rock", category: "terrain", tags: ["falaise"], file: "tex/cliff.png", format: "png", source: { ...fromTown([0, 2456, 32, 32], "roche de falaise").source }, ...LIC_ICY, dimensions: { w: 1, h: 1, d: 0 }, anchor: "tile", scale: 1, materials: ["nearest, repeat"], occlusion: { mode: "none" }, collision: null, animations: [], fallback: { shape: "plane", color: "#9a8a76" } });

// --- registre : on garde les personnages importés (feuilles), on remplace tout le reste par les sprites
const regPath = path.join(ASSETS, "registry.json"), old = JSON.parse(fs.readFileSync(regPath, "utf8"));
const keep = old.assets.filter((a) => a.category === "character"), assets = [...entries, ...keep];
fs.writeFileSync(regPath, JSON.stringify({ version: 2, unit: "1 unité = 1 tuile ; Y vers le haut ; sprites 2D verticaux face à la caméra (échelle pxPerUnit)", generated: new Date().toISOString().slice(0, 10), assets }, null, 1));
console.log("registre :", assets.length, "assets (" + entries.length + " sprites/sols, " + keep.length + " personnages)");
