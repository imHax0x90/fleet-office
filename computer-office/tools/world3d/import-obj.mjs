#!/usr/bin/env node
// Import OBJ/MTL (+ PNG) → GLB + entrée de registre. Chemin d'import pour Pokémon DS Map Studio (export OBJ) ou tout autre outil.
// Garde-fou : refuse d'importer sans licence déclarée ; marque l'asset « licence non vérifiée » tant que --licence-url manque.
// usage : node tools/world3d/import-obj.mjs --obj model.obj --id mon_batiment --category building --licence "CC-BY-4.0" --source "https://…" [--licence-url URL] [--author nom]
//         [--scale 1] [--up y|z] [--flip-v] [--assets-dir public/world3d/assets] [--collide-w 4 --collide-d 4]
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { Model } from "./glb.mjs";
const A = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, all) => { if (v.startsWith("--")) acc.push([v.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]); return acc; }, []));
const die = (m) => { console.error("✗ " + m); process.exit(1); };
for (const k of ["obj", "id", "category", "licence", "source"]) if (!A[k] || A[k] === true) die(`--${k} requis (la licence et la provenance de chaque asset doivent être déclarées)`);
if (!/^[a-z0-9_]+$/.test(A.id)) die("--id : minuscules, chiffres et _ uniquement");
const ASSETS = path.resolve(A["assets-dir"] || path.join(path.dirname(fileURLToPath(import.meta.url)), "../../public/world3d/assets")), TEX = path.join(ASSETS, "tex"), MOD = path.join(ASSETS, "models");
fs.mkdirSync(TEX, { recursive: true }); fs.mkdirSync(MOD, { recursive: true });
const objPath = path.resolve(A.obj), dir = path.dirname(objPath), scale = +A.scale || 1, up = A.up || "y";
const V = [], VT = [], faces = []; let mtlFile = null, cur = "default";
for (const line of fs.readFileSync(objPath, "utf8").split(/\r?\n/)) {
  const t = line.trim().split(/\s+/); if (!t[0] || t[0][0] === "#") continue;
  if (t[0] === "v") V.push([+t[1], +t[2], +t[3]]); else if (t[0] === "vt") VT.push([+t[1], +t[2]]); else if (t[0] === "mtllib") mtlFile = t.slice(1).join(" "); else if (t[0] === "usemtl") cur = t.slice(1).join(" ");
  else if (t[0] === "f") { const idx = t.slice(1).map((s) => { const [v, vt] = s.split("/").map((x) => (x ? parseInt(x, 10) : NaN)); const fix = (i, n) => (i < 0 ? n + i : i - 1); return { v: fix(v, V.length), vt: Number.isNaN(vt) ? -1 : fix(vt, VT.length) }; }); for (let i = 1; i < idx.length - 1; i++) faces.push({ mat: cur, tri: [idx[0], idx[i], idx[i + 1]] }); }
}
if (!V.length || !faces.length) die("OBJ vide ou illisible");
const mats = {}; // matériau → texture PNG
if (mtlFile && fs.existsSync(path.join(dir, mtlFile))) { let m = null; for (const line of fs.readFileSync(path.join(dir, mtlFile), "utf8").split(/\r?\n/)) { const t = line.trim().split(/\s+/); if (t[0] === "newmtl") { m = t.slice(1).join(" "); mats[m] = {}; } else if (m && t[0] === "map_Kd") mats[m].map = t.slice(1).join(" "); else if (m && t[0] === "Kd") mats[m].kd = t.slice(1, 4).map(Number); } }
const model = new Model(A.id, TEX); model.center = [0, 0, 0]; const warn = [];
const used = new Map(); const texFor = (mat) => { // copie la texture dans assets/tex sous un nom stable
  if (used.has(mat)) return used.get(mat); const m = mats[mat]; let name = "solid_default";
  if (m && m.map && fs.existsSync(path.join(dir, m.map))) { if (!/\.png$/i.test(m.map)) die("texture " + m.map + " : seul le PNG est accepté (convertir avant)"); name = A.id + "__" + mat.replace(/[^a-z0-9]+/gi, "_").toLowerCase(); fs.copyFileSync(path.join(dir, m.map), path.join(TEX, name + ".png")); }
  else { warn.push(`matériau « ${mat} » sans texture PNG → couleur unie`); const kd = (m && m.kd) || [.8, .8, .8], png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"); name = A.id + "__" + mat.replace(/[^a-z0-9]+/gi, "_").toLowerCase(); fs.writeFileSync(path.join(TEX, name + ".png"), png); void kd; }
  used.set(mat, name); return name; };
const P = (i) => { let [x, y, z] = V[i.v]; if (up === "z") [y, z] = [z, -y]; return [x * scale, y * scale, z * scale]; };
for (const f of faces) { const tex = texFor(f.mat), uv = f.tri.map((i) => { const t = i.vt >= 0 ? VT[i.vt] : [0, 0]; return [t[0], A["flip-v"] ? t[1] : 1 - t[1]]; }); model.tri(tex, f.tri.map(P), uv, { noOrient: true }); }
const b = model.bbox(); const file = A.id + ".glb"; fs.writeFileSync(path.join(MOD, file), model.glb());
const regPath = path.join(ASSETS, "registry.json"), reg = JSON.parse(fs.readFileSync(regPath, "utf8")); reg.assets = reg.assets.filter((a) => a.id !== A.id);
reg.assets.push({ id: A.id, category: A.category, file: "models/" + file, format: "glb", source: { kind: "imported", from: A.source, importer: "tools/world3d/import-obj.mjs", original: path.basename(objPath), author: A.author || null }, licence: A.licence, licenceUrl: A["licence-url"] || null, licenceVerified: !!A["licence-url"],
  dimensions: { w: b.size[0], h: b.size[1], d: b.size[2] }, bbox: { min: b.min, max: b.max }, triangles: b.tris, anchor: "bottom-center", scale: 1, front: "+z", materials: [...used.values()], occlusion: { mode: A.category === "building" ? "fade" : "none" },
  collision: A["collide-w"] ? { type: "box", w: +A["collide-w"], d: +A["collide-d"] || +A["collide-w"] } : null, instanced: A.category !== "building", animations: [], fallback: { shape: "box", color: "#c9a46a" } });
fs.writeFileSync(regPath, JSON.stringify(reg, null, 1));
console.log(`✓ ${A.id} : ${b.tris} triangles, ${b.size.join("×")} unités, ${used.size} matériau(x)` + (A["licence-url"] ? "" : "  ⚠ licence non vérifiée (ajoutez --licence-url)")); warn.forEach((w) => console.log("  ⚠ " + w));
