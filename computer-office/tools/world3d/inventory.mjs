#!/usr/bin/env node
// Inventaire d'archives d'assets : inspecte les images (dimensions, transparence, grille probable, cellules vides), classe avec un niveau de confiance,
// et signale ce qui est exclu (contenu de franchise, licence floue). Les fichiers originaux ne sont jamais modifiés.
// usage : node tools/world3d/inventory.mjs --assets <dossier PokemonAssets> --sprites-list <liste de chemins zip PokemonSprites> --out public/world3d/assets/inventory.json
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url"; import { decodePNG } from "./png.mjs";
const A = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, all) => { if (v.startsWith("--")) acc.push([v.slice(2), all[i + 1]]); return acc; }, []));
const OUT = path.resolve(A.out || path.join(path.dirname(fileURLToPath(import.meta.url)), "../../public/world3d/assets/inventory.json"));
const slug = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
function inspect(img) { // transparence, boîte opaque, cellules non vides pour une grille donnée
  let alpha = false, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1; for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) { const a = img.d[(y * img.w + x) * 4 + 3]; if (a < 255) alpha = true; if (a > 0) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } }
  return { hasAlpha: alpha, bbox: x1 < 0 ? null : [x0, y0, x1 - x0 + 1, y1 - y0 + 1] };
}
function gridCells(img, cw, ch) { let filled = 0, total = 0; for (let cy = 0; cy + ch <= img.h; cy += ch) for (let cx = 0; cx + cw <= img.w; cx += cw) { total++; let any = false; for (let y = cy; y < cy + ch && !any; y++) for (let x = cx; x < cx + cw; x++) if (img.d[(y * img.w + x) * 4 + 3] > 0) { any = true; break; } if (any) filled++; } return { filled, total }; }
const entries = [];
const root = path.resolve(A.assets || "."); const SRC = { repo: "icyethics/PokemonAssets", licenceText: "README du dépôt : « utilisable pour tout projet NON COMMERCIAL, lié à Pokémon ou non ; projets dérivés eux aussi libres ; crédit à IcyEthics »" };
for (const f of walk(root).sort()) {
  const rel = path.relative(root, f), ext = path.extname(f).toLowerCase(), base = path.basename(f, ext), low = rel.toLowerCase();
  if (f.includes("/.git/") || rel === "README.md") continue;
  const e = { id: "icy:" + slug(rel.replace(/\.[^.]+$/, "")), path: rel, source: SRC.repo, ext };
  if (ext === ".aseprite" || ext === ".ase") { entries.push({ ...e, type: "source-editeur", category: "aseprite", confidence: 1, status: "ignoré", reason: "fichier source Aseprite (non chargeable par le navigateur)" }); continue; }
  if (ext !== ".png") { entries.push({ ...e, type: "autre", status: "ignoré", reason: "format non pris en charge" }); continue; }
  let img; try { img = decodePNG(fs.readFileSync(f)); } catch (err) { entries.push({ ...e, type: "illisible", status: "ignoré", reason: String(err.message) }); continue; }
  const ins = inspect(img); Object.assign(e, { type: "image", dimensions: [img.w, img.h], transparency: ins.hasAlpha ? "alpha" : "aucune (fond opaque)", opaqueBBox: ins.bbox, frames: null, directions: null, states: null, slicing: null });
  let c = { category: "inconnu", confidence: 0.3, status: "candidat", reason: "" };
  const nintendo = /^trchar\d+/i.test(base) || /hgss|hilda/i.test(low) || /pok[eé]mon sprites|assorted pok/i.test(low) ? "contenu probablement issu des jeux / créatures Pokémon" : null;
  if (/overworld sprites/.test(low) && img.w === 128 && img.h === 192) {
    const g = gridCells(img, 32, 48); c = { category: "personnage-overworld", confidence: g.filled === 16 ? (ins.hasAlpha ? 0.95 : 0.6) : 0.5, status: "candidat", reason: `${g.filled}/${g.total} cellules 32×48 non vides` };
    Object.assign(e, { frames: 4, directions: ["bas", "gauche", "droite", "haut"], states: ["statique", "marche"], slicing: { method: "grille", cell: [32, 48], cols: 4, rows: 4, rowsOrder: ["bas", "gauche", "droite", "haut"], note: "convention RPG Maker/Essentials : colonne 0 = pied au repos, 4 colonnes = cycle de marche" } });
    if (!ins.hasAlpha) { c.status = "écarté"; c.reason += " ; fond opaque (pas de transparence) : détourage nécessaire"; }
  } else if (/overworld sprites/.test(low)) c = { category: /^door|^ladder/i.test(base) ? "objet-decor" : /^item/i.test(base) ? "objet" : /^char_|^trainer_/i.test(base) ? "personnage-grille-atypique" : "overworld-autre", confidence: 0.5, status: "candidat", reason: `dimensions ${img.w}×${img.h} hors grille standard 128×192 : grille non déterminable avec certitude` };
  else if (/tilesets/.test(low) && img.w === 256 && img.h % 32 === 0) { Object.assign(e, { slicing: { method: "grille", cell: [32, 32], cols: 8, rows: img.h / 32, note: "planche d'autotiles annotée par sections (« Grass & Foliage », « Paths & Texture », « Trees »…) ; découpe par rectangles manuels" } }); c = { category: "tileset", confidence: 0.85, status: "candidat", reason: `${img.w / 32}×${img.h / 32} tuiles de 32 px, vue de dessus / 3-4` }; }
  else if (/trainer sprites/.test(low)) c = { category: img.w === 160 ? "portrait-combat" : "personnage-grille-atypique", confidence: 0.6, status: "candidat", reason: "image de dresseur (vue de face, usage combat) : peu utile en vue de village" };
  else if (/ui objects/.test(low)) c = { category: "interface", confidence: 0.7, status: "candidat", reason: "élément d'interface 2D" };
  e.category = c.category; e.confidence = c.confidence; e.status = c.status; e.reason = c.reason; e.perspective = /personnage-overworld|tileset|objet/.test(c.category) ? "3/4 (type Pokémon DS)" : "n/a";
  if (nintendo) { if (e.category === "inconnu") e.category = "creature-ou-ui-pokemon"; e.status = "exclu"; e.reason = nintendo + (e.reason ? " ; " + e.reason : ""); }
  entries.push(e);
}
// dépôt PokemonSprites : agrégat par dossier (64 000+ sprites de créatures, droits de The Pokémon Company)
const agg = {};
if (A["sprites-list"] && fs.existsSync(A["sprites-list"])) for (const l of fs.readFileSync(A["sprites-list"], "utf8").split("\n")) { const m = l.match(/^pokemon_assets\/PokemonSprites\/sprites\/(.*)\/[^/]+\.(\w+)$/); if (!m) continue; const k = m[1].split("/").slice(0, 3).join("/"); const o = (agg[k] = agg[k] || { dir: "sprites/" + k, files: 0, ext: {} }); o.files++; o.ext[m[2].toLowerCase()] = (o.ext[m[2].toLowerCase()] || 0) + 1; }
const groups = Object.values(agg).sort((a, b) => b.files - a.files).map((g) => ({ ...g, type: "creatures-pokemon", category: "sprites-creatures", status: "exclu", confidence: 0.99, reason: "sprites de créatures Pokémon (© The Pokémon Company, licence du dépôt : « All image contents within are Copyright The Pokémon Company ») — sans objet pour un village d'agents" }));
const by = (k) => entries.reduce((m, e) => ((m[e[k]] = (m[e[k]] || 0) + 1), m), {});
fs.writeFileSync(OUT, JSON.stringify({ version: 1, generated: new Date().toISOString().slice(0, 10), sources: { "icyethics/PokemonAssets": { licence: SRC.licenceText, remarque: "fichiers de jeu de fan ; certains éléments sont d'origine Pokémon (exclus ici)" }, "ukbigdave/PokemonSprites": { licence: "code CC0, mais « All image contents within are Copyright The Pokémon Company » : aucun droit sur les images", remarque: "fork de PokeAPI/sprites" } }, summary: { PokemonAssets: { fichiers: entries.length, parCategorie: by("category"), parStatut: by("status") }, PokemonSprites: { fichiers: groups.reduce((s, g) => s + g.files, 0), dossiers: groups.length } }, assets: entries, groupes: groups }, null, 1));
console.log("inventaire :", entries.length, "fichiers PokemonAssets ;", JSON.stringify(by("status")), ";", groups.reduce((s, g) => s + g.files, 0), "sprites de créatures agrégés ->", path.relative(process.cwd(), OUT));
