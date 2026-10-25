// Génère la carte pilote (public/world3d/assets/maps/pilot.json) : sol ASCII + objets + lots de maisons.
// Format de carte (éditable à la main) : legend = caractère → type de sol ; rows = grille ; objects = {asset,x,y,rot,role?} (x,y en tuiles, centre) ;
// lots = emplacements de maisons de projet {x,y,rot,district} ; zones = bâtiments fonctionnels reliés aux vues de la console.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../public/world3d/assets/maps/pilot.json");
const W = 84, H = 70, g = Array.from({ length: H }, () => Array(W).fill("g"));
const rect = (x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (g[y] && g[y][x] !== undefined) g[y][x] = c; };
const CX = 42, CY = 24;
rect(0, CY - 1, W - 1, CY + 1, "c");   // avenue est-ouest
rect(CX - 1, 0, CX + 1, H - 1, "c");   // avenue nord-sud
rect(0, 40, W - 1, 41, "c");           // rue intérieure
rect(0, 47, W - 1, 48, "c");           // rue sud (quartiers)
rect(CX - 7, CY - 6, CX + 7, CY + 6, "p"); // plaza
rect(26, 28, 30, 31, "w"); rect(54, 52, 56, 54, "w"); // mares
const objects = [], rnd = ((s) => () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296))(42);
const add = (asset, x, y, rot = 0, extra = {}) => objects.push({ asset, x: +x.toFixed(2), y: +y.toFixed(2), rot: +rot.toFixed(2), ...extra });
const free = (x, y, r = 0) => { for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) { const c = (g[y + j] || [])[x + i]; if (c !== "g") return false; } return true; };
const zones = [
  { id: "hq", asset: "hq", x: CX, y: 11, rot: 0, label: "Quartier général", role: "headquarters", view: "board", blurb: "Vue d'ensemble de toute la flotte d'agents." },
  { id: "ai_lab", asset: "ai_lab", x: 22, y: 14, rot: 0, label: "Laboratoire IA", role: "ai-lab", view: "skills", view2: "jobs", blurb: "Bibliothèque de skills et métiers : où les agents se spécialisent." },
  { id: "ops_center", asset: "ops_center", x: 62, y: 14, rot: 0, label: "Centre d'opérations", role: "ops", view: "machines", blurb: "Machines et nœuds Tailscale qui hébergent les agents." },
  { id: "dev_workshop", asset: "dev_workshop", x: 22, y: 33, rot: 0, label: "Atelier dev", role: "workshop", view: "teams", blurb: "Équipes et missions de développement en cours." },
  { id: "supervision", asset: "supervision", x: 62, y: 33, rot: 0, label: "Centre de supervision", role: "supervision", view: "reviews", blurb: "Évaluations, arène et agents à surveiller (bloqués / en échec)." },
];
for (const z of zones) { // parvis pavé devant (au sud) + liaison vers la route la plus proche
  const x = Math.round(z.x), yf = Math.round(z.y) + 4; rect(x - 3, yf, x + 3, yf, "c");
  const road = z.y < CY ? CY - 1 : 40; rect(x - 1, Math.min(yf, road), x, Math.max(yf, road), "c");
}
const lots = [], block = (district, x0, y0, cols, rows, dx = 8, dy = 8) => { for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) lots.push({ x: x0 + c * dx, y: y0 + r * dy, rot: 0, district }); };
block(0, 6, 53, 3, 2); block(1, 32, 53, 3, 2); block(2, 58, 53, 3, 2);   // trois quartiers sud (18 lots)
block(3, 5.5, 6, 2, 3, 8, 8); lots.splice(lots.length - 6, 6); block(3, 5.5, 5, 2, 2); block(3, 5.5, 31, 2, 1); // quartier ouest (6 lots)
block(4, 70.5, 5, 2, 2); block(4, 70.5, 31, 2, 1);                       // quartier est (6 lots)
for (const l of lots) { const x = Math.round(l.x), y = Math.round(l.y); rect(x - 1, y + 3, x, y + 3, "d"); const road = y > 47 ? 47 : y < CY ? CY - 1 : 40; rect(x - 1, Math.min(y + 3, road), x - 1, Math.max(y + 3, road), "d"); }
add("fountain", CX, CY, 0); [[-5.2, -4.4], [5.2, -4.4], [-5.2, 4.4], [5.2, 4.4]].forEach(([dx, dy], i) => add("bench", CX + dx, CY + dy, i < 2 ? 0 : Math.PI));
[[-6.5, -5.5], [6.5, -5.5], [-6.5, 5.5], [6.5, 5.5], [0, -5.6], [0, 5.6]].forEach(([dx, dy]) => add("lamp", CX + dx, CY + dy));
add("signpost", CX + 3.2, CY + 3.0, 0, { text: "Fleet Office" });
for (let x = 4; x < W - 2; x += 8) { if (Math.abs(x - CX) > 9) { add("lamp", x, CY - 2.4); add("lamp", x + 4, CY + 2.4); add("lamp", x, 42.4); add("lamp", x + 4, 49.4); } }
for (let y = 3; y < H - 2; y += 8) { if (Math.abs(y - CY) > 9) { add("lamp", CX - 2.4, y); add("lamp", CX + 2.4, y + 4); } }
add("bench", 33, 22.2, 0); add("bench", 52, 26, Math.PI);
const solid = zones.map((z) => ({ x: z.x, y: z.y, rx: 7.5, ry: 5 })).concat(lots.map((l) => ({ x: l.x, y: l.y, rx: 4, ry: 3.6 })));
const nearSolid = (x, y, pad = 0) => solid.some((s) => Math.abs(x - s.x) < s.rx + pad && Math.abs(y - s.y) < s.ry + pad);
let trees = 0, bushes = 0, fl = 0;
for (let t = 0; t < 8000 && (trees < 150 || bushes < 100 || fl < 110); t++) {
  const x = 1 + Math.floor(rnd() * (W - 2)), y = 1 + Math.floor(rnd() * (H - 2));
  if (!free(x, y, 1) || nearSolid(x, y, 1.5) || Math.hypot(x - CX, y - CY) < 10) continue;
  const r = rnd();
  if (r < .42 && trees < 150) { add(rnd() < .55 ? "tree_round" : rnd() < .6 ? "tree_pine" : "tree_autumn", x + (rnd() - .5) * .6, y + (rnd() - .5) * .6, rnd() * 6.28); trees++; }
  else if (r < .72 && bushes < 100) { add("bush", x + (rnd() - .5) * .5, y + (rnd() - .5) * .5, rnd() * 6.28); bushes++; }
  else if (fl < 110) { add("flowers", x + (rnd() - .5) * .4, y + (rnd() - .5) * .4, rnd() * 3.14); fl++; }
}
for (const l of lots) { add(rnd() < .5 ? "bush" : "flowers", l.x - 3.3, l.y + 2.6); add("flowers", l.x + 3.1, l.y + 2.6); }
for (const z of zones) { add("lamp", z.x - 4.5, z.y + 5.2); add("lamp", z.x + 4.5, z.y + 5.2); add("bush", z.x - 7.2, z.y + 3); add("bush", z.x + 7.6, z.y + 3); }
add("crate", 27.3, 36.4, 0.3); add("crate", 28.2, 36.9, 0.6);
const rows = g.map((r) => r.join(""));
fs.writeFileSync(OUT, JSON.stringify({ version: 1, name: "Fleet Office — ville pilote", tile: 1, size: { w: W, h: H }, spawn: { x: CX, y: CY + 8.5 }, legend: { g: "herbe", c: "pavés", p: "dalles de plaza", d: "terre battue", w: "eau" }, rows, zones, lots, objects }, null, 0).replace(/\"rows\":\[/, '"rows":[\n').replace(/","/g, '",\n"'));
console.log("carte", W + "x" + H, "objets", objects.length, "lots", lots.length, "zones", zones.length);
