#!/usr/bin/env node
// Importe un pack de sprites « dossier/<role>/<direction>/<etat>.png » (64×64 RGBA) en feuilles du moteur et les déclare au registre.
// usage : node tools/world3d/import-sprites.mjs --pack <dossier du pack> --group pnj --prefix npc_ --licence <id> --source "<provenance>" [--author nom]
//   états : statique, marche, course ; directions : bas, gauche, droite, haut → feuille 3 colonnes × 4 lignes de cellules 64×64
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url"; import { Img, decodePNG } from "./png.mjs";
const A = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, all) => { if (v.startsWith("--")) acc.push([v.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]); return acc; }, []));
const die = (m) => { console.error("✗ " + m); process.exit(1); };
for (const k of ["pack", "group", "licence", "source"]) if (!A[k] || A[k] === true) die(`--${k} requis (provenance et licence obligatoires)`);
const ASSETS = path.resolve(A["assets-dir"] || path.join(path.dirname(fileURLToPath(import.meta.url)), "../../public/world3d/assets")), prefix = A.prefix || "npc_", root = path.resolve(A.pack, A.group);
const DIRS = ["bas", "gauche", "droite", "haut"], STATES = ["statique", "marche", "course"], regPath = path.join(ASSETS, "registry.json"), reg = JSON.parse(fs.readFileSync(regPath, "utf8"));
if (!JSON.parse(fs.readFileSync(path.join(ASSETS, "licences.json"), "utf8")).licences[A.licence]) die("licence inconnue : ajoutez-la à licences.json");
for (const role of fs.readdirSync(root).filter((d) => fs.statSync(path.join(root, d)).isDirectory()).sort()) {
  const sheet = new Img(192, 256); let ok = true;
  DIRS.forEach((d, r) => STATES.forEach((s, c) => { const f = path.join(root, role, d, s + ".png"); if (!fs.existsSync(f)) { ok = false; return; } const im = decodePNG(fs.readFileSync(f)); if (im.w !== 64 || im.h !== 64) throw new Error(f + " : 64×64 attendu"); sheet.blit(im, 0, 0, 64, 64, c * 64, r * 64); }));
  if (!ok) { console.log("⚠ " + role + " : fichiers manquants, ignoré"); continue; }
  const id = prefix + role; fs.writeFileSync(path.join(ASSETS, "tex", id + ".png"), sheet.png()); reg.assets = reg.assets.filter((a) => a.id !== id);
  reg.assets.push({ id, category: "character", file: "tex/" + id + ".png", format: "png-spritesheet", source: { kind: "imported", from: A.source, importer: "tools/world3d/import-sprites.mjs", author: A.author || null, original: A.group + "/" + role }, licence: A.licence, licenceUrl: null, licenceVerified: false,
    dimensions: { w: 2.4, h: 2.4, d: 0 }, sheet: { px: [192, 256], cell: [64, 64], cols: 3, rows: 4, rowsOrder: DIRS, colsOrder: STATES, footPx: 10 }, anchor: "bottom-center", scale: 1, billboard: "yaw", materials: ["alphaTest 0.5, nearest"], occlusion: { mode: "none" }, collision: { type: "circle", r: 0.3 },
    animations: [{ name: "idle", frames: [0], fps: 1 }, { name: "walk", frames: [0, 1, 0, 1], fps: 5 }, { name: "run", frames: [2, 1, 2, 1], fps: 8 }], fallback: { shape: "capsule", color: "#2f9aa0" } });
  console.log("✓ " + id);
}
fs.writeFileSync(regPath, JSON.stringify(reg, null, 1));
