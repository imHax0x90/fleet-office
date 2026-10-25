#!/usr/bin/env node
// Importe les personnages « overworld » (feuilles 4×4 de 32×48, fond transparent) et des découpes d'arbres de icyethics/PokemonAssets.
// Les originaux sont copiés tels quels dans assets/sources/ ; les découpes sont des dérivés (rectangle source consigné au registre).
// usage : node tools/world3d/import-overworld.mjs --assets <dossier PokemonAssets>
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url"; import { Img, decodePNG } from "./png.mjs";
const A = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, all) => { if (v.startsWith("--")) acc.push([v.slice(2), all[i + 1]]); return acc; }, []));
const here = path.dirname(fileURLToPath(import.meta.url)), ASSETS = path.join(here, "../../public/world3d/assets"), DST = path.join(ASSETS, "sources/icyethics_pokemonassets"), root = path.resolve(A.assets);
fs.mkdirSync(path.join(DST, "Overworld Sprites"), { recursive: true }); fs.mkdirSync(path.join(DST, "derived"), { recursive: true }); fs.mkdirSync(path.join(DST, "Tilesets"), { recursive: true });
const regPath = path.join(ASSETS, "registry.json"), reg = JSON.parse(fs.readFileSync(regPath, "utf8")), inv = JSON.parse(fs.readFileSync(path.join(ASSETS, "inventory.json"), "utf8"));
const CHARS = ["Allison", "Elmyne", "grandmother", "MacDonald", "Pliny", "Scarlett", "Wilbur", "mrFrost"];
const SRC = (rel) => ({ kind: "imported", from: "https://github.com/icyethics/PokemonAssets (fichier : " + rel + ")", importer: "tools/world3d/import-overworld.mjs", author: "IcyEthics", original: rel });
const LIC = { licence: "icyethics-noncommercial", licenceUrl: "https://github.com/icyethics/PokemonAssets", licenceVerified: false, licenceNote: "texte du README : usage non commercial, dérivés libres, crédit IcyEthics" };
const put = (e) => { reg.assets = reg.assets.filter((a) => a.id !== e.id); reg.assets.push(e); const i = inv.assets.find((a) => a.id === e.inventoryId); if (i) { i.status = "utilisé"; i.registryId = e.id; } };
for (const n of CHARS) {
  const rel = `Overworld Sprites/char_${n}.png`, src = path.join(root, rel), im = decodePNG(fs.readFileSync(src)); if (im.w !== 128 || im.h !== 192) throw new Error(rel + " : 128×192 attendu");
  fs.copyFileSync(src, path.join(DST, rel)); const id = "ow_" + n.toLowerCase();
  put({ id, inventoryId: "icy:overworld_sprites_char_" + n.toLowerCase(), category: "character", tags: ["personnage", "overworld", "3/4", "pnj"], file: "sources/icyethics_pokemonassets/" + rel, format: "png-spritesheet", source: SRC(rel), ...LIC, dimensions: { w: 1.25, h: 1.875, d: 0 },
    sheet: { px: [128, 192], cell: [32, 48], cols: 4, rows: 4, rowsOrder: ["bas", "gauche", "droite", "haut"], colsOrder: ["statique", "marche1", "marche2", "marche3"], footPx: 3 }, anchor: "bottom-center", scale: 1, billboard: "yaw", materials: ["alphaTest 0.5, nearest"], occlusion: { mode: "none" }, collision: { type: "circle", r: 0.3 },
    animations: [{ name: "idle", frames: [0], fps: 1 }, { name: "walk", frames: [0, 1, 2, 3], fps: 6 }, { name: "run", frames: [0, 1, 2, 3], fps: 10 }], fallback: { shape: "capsule", color: "#8a6a4a" } });
  console.log("✓ " + id);
}
// arbres (64×96) découpés dans la planche de tuiles 32 px : rectangles vérifiés visuellement
const tileSrc = "Tilesets/padded_mycorTown.png", sheet = decodePNG(fs.readFileSync(path.join(root, tileSrc))); fs.copyFileSync(path.join(root, tileSrc), path.join(DST, tileSrc));
for (const [id, rect, label] of [["ow_tree_green", [0, 928, 64, 96], "arbre vert"], ["ow_tree_autumn", [0, 1088, 64, 96], "arbre jaune"]]) {
  const out = new Img(rect[2], rect[3]); out.blit(sheet, rect[0], rect[1], rect[2], rect[3], 0, 0); const rel = "derived/" + id + ".png"; fs.writeFileSync(path.join(DST, rel), out.png());
  put({ id, inventoryId: "icy:tilesets_padded_mycortown", category: "vegetation", tags: ["arbre", "billboard", "3/4"], file: "sources/icyethics_pokemonassets/" + rel, format: "png", source: { ...SRC(tileSrc), derived: true, crop: rect, note: label }, ...LIC, dimensions: { w: 3.2, h: 4.8, d: 0 }, anchor: "bottom-center", scale: 1, materials: ["alphaTest 0.5, nearest"], occlusion: { mode: "none" }, collision: { type: "circle", r: 0.4 }, animations: [], fallback: { shape: "box", color: "#4e9b62" } });
  console.log("✓ " + id + " (découpe " + rect.join(",") + ")");
}
fs.copyFileSync(path.join(root, "README.md"), path.join(DST, "README.md"));
fs.writeFileSync(regPath, JSON.stringify(reg, null, 1)); fs.writeFileSync(path.join(ASSETS, "inventory.json"), JSON.stringify(inv, null, 1));
