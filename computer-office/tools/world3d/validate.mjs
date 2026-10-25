#!/usr/bin/env node
// Validation du pipeline d'assets 3D : registre, fichiers, GLB (structure binaire), licences, carte. Code de sortie ≠ 0 en cas d'erreur.
// usage : node tools/world3d/validate.mjs [dossier assets]
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const ASSETS = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), "../../public/world3d/assets"));
const err = [], warn = [], ok = []; const E = (m) => err.push(m), W = (m) => warn.push(m);
const reg = JSON.parse(fs.readFileSync(path.join(ASSETS, "registry.json"), "utf8")), lic = JSON.parse(fs.readFileSync(path.join(ASSETS, "licences.json"), "utf8")), map = JSON.parse(fs.readFileSync(path.join(ASSETS, "maps/pilot.json"), "utf8"));
const ids = new Set(); let glbs = 0, tris = 0;
const REQ = ["id", "category", "file", "format", "source", "licence", "dimensions", "anchor", "scale", "occlusion", "fallback"];
for (const a of reg.assets) {
  for (const k of REQ) if (a[k] === undefined) E(`${a.id || "?"} : champ « ${k} » manquant`);
  if (ids.has(a.id)) E("id dupliqué : " + a.id); ids.add(a.id);
  const L = lic.licences[a.licence]; if (!L) E(`${a.id} : licence « ${a.licence} » absente du registre de licences`); else if (!L.redistribuable) E(`${a.id} : licence « ${a.licence} » non redistribuable — l'asset ne doit pas être dans le dépôt`);
  if (a.source && a.source.kind === "imported" && !a.licenceVerified) W(`${a.id} : importé, licence NON vérifiée (licenceUrl manquante)`);
  const f = path.join(ASSETS, a.file); if (!fs.existsSync(f)) { E(`${a.id} : fichier absent ${a.file}`); continue; }
  const buf = fs.readFileSync(f);
  if (a.format === "glb") {
    glbs++; if (buf.toString("ascii", 0, 4) !== "glTF" || buf.readUInt32LE(4) !== 2) { E(`${a.id} : en-tête GLB invalide`); continue; } if (buf.readUInt32LE(8) !== buf.length) E(`${a.id} : longueur GLB incohérente`);
    const jl = buf.readUInt32LE(12), j = JSON.parse(buf.toString("utf8", 20, 20 + jl)), bin = buf.subarray(20 + jl + 8);
    if (j.buffers[0].byteLength > bin.length) E(`${a.id} : tampon binaire tronqué`);
    let t = 0; for (const m of j.meshes) for (const p of m.primitives) { const ia = j.accessors[p.indices], pa = j.accessors[p.attributes.POSITION], iv = j.bufferViews[ia.bufferView]; t += ia.count / 3;
      const arr = ia.componentType === 5123 ? new Uint16Array(bin.buffer.slice(bin.byteOffset + iv.byteOffset, bin.byteOffset + iv.byteOffset + iv.byteLength)) : new Uint32Array(bin.buffer.slice(bin.byteOffset + iv.byteOffset, bin.byteOffset + iv.byteOffset + iv.byteLength)); let mx = 0; for (const v of arr) if (v > mx) mx = v; if (mx >= pa.count) E(`${a.id} : indice hors limites`);
      if (!p.attributes.TEXCOORD_0 || !p.attributes.NORMAL) E(`${a.id} : UV/normales manquantes`); if (p.material === undefined) E(`${a.id} : primitive sans matériau`); }
    tris += t; if (a.triangles && Math.round(t) !== a.triangles) E(`${a.id} : ${t} triangles ≠ registre ${a.triangles}`);
    if (!j.images || !j.images.length) E(`${a.id} : aucune texture embarquée`); for (const s of j.samplers || []) if (s.magFilter !== 9728) W(`${a.id} : échantillonnage non « nearest » en agrandissement`);
    const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (const ac of j.accessors) if (ac.min) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], ac.min[k]); mx[k] = Math.max(mx[k], ac.max[k]); }
    const dx = mx[0] - mn[0], dy = mx[1] - mn[1], dz = mx[2] - mn[2]; if (Math.abs(dx - a.dimensions.w) > 0.06 || Math.abs(dy - a.dimensions.h) > 0.06 || Math.abs(dz - a.dimensions.d) > 0.06) E(`${a.id} : dimensions du registre ≠ géométrie (${dx.toFixed(2)}×${dy.toFixed(2)}×${dz.toFixed(2)})`);
    if (mn[1] < -0.01) W(`${a.id} : géométrie sous le sol (y=${mn[1].toFixed(2)})`);
  } else if (a.format.startsWith("png")) { if (buf.readUInt32BE(0) !== 0x89504e47) E(`${a.id} : PNG invalide`); else { const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20); if (a.sheet && (w !== a.sheet.px[0] || h !== a.sheet.px[1])) E(`${a.id} : feuille ${w}×${h} ≠ registre`); } }
}
if (!Array.isArray(map.rows) || new Set(map.rows.map((r) => r.length)).size !== 1 || map.rows.length !== map.size.h || map.rows[0].length !== map.size.w) E("carte : grille non rectangulaire / taille incohérente");
for (const c of new Set(map.rows.join(""))) if (!map.legend[c]) E(`carte : caractère « ${c} » absent de la légende`);
for (const o of map.objects) if (!ids.has(o.asset)) E(`carte : objet inconnu « ${o.asset} »`);
for (const z of map.zones) { if (!ids.has(z.asset)) E(`carte : zone ${z.id} → asset inconnu`); if (!z.view) E(`zone ${z.id} : vue console manquante`); }
for (const l of map.lots) if (l.x < 0 || l.y < 0 || l.x > map.size.w || l.y > map.size.h) E("carte : lot hors limites");
ok.push(`${reg.assets.length} assets (${glbs} GLB, ${Math.round(tris)} triangles), ${map.objects.length} objets, ${map.zones.length} zones, ${map.lots.length} lots`);
console.log(ok.join("\n")); warn.forEach((m) => console.log("⚠ " + m)); err.forEach((m) => console.log("✗ " + m)); console.log(err.length ? `\n${err.length} erreur(s)` : "\n✓ validation OK"); process.exit(err.length ? 1 : 0);
