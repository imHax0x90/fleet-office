// Génère la carte pilote (public/world3d/assets/maps/pilot.json) — plan de VILLE compacte façon petite ville de RPG :
// grande place centrale, avenue nord-sud menant au Quartier général, bâtiments publics autour de la place, rues bordées de maisons
// alignées face à face (clôtures, chemin vers la porte, boîte aux lettres, parterres), ceinture d'arbres avec sorties aux bouts des rues.
// Format : legend = caractère → sol ; rows = grille ; objects = {asset,x,y,rot} ; lots = emplacements de maisons de projet ; zones = bâtiments fonctionnels.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../public/world3d/assets/maps/pilot.json");
const W = 64, H = 80, CX = 32, g = Array.from({ length: H }, () => Array(W).fill("g"));
const rect = (x0, y0, x1, y1, c) => { for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) g[y][x] = c; };
const rnd = ((s) => () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296))(42);
const objects = [], add = (asset, x, y, rot = 0, extra = {}) => objects.push({ asset, x: +x.toFixed(2), y: +y.toFixed(2), rot: +rot.toFixed(3), ...extra });
const STREETS = [51, 70]; // rues de lotissement (2 tuiles de large) ; maisons au nord (face au sud) et au sud (face au nord)
// --- voirie
rect(CX - 1, 0, CX + 1, H - 1, "c");        // avenue nord-sud
rect(0, 24, W - 1, 26, "c");                 // rue de la place
rect(0, 40, W - 1, 41, "c");                 // rue des ateliers
for (const ys of STREETS) rect(0, ys, W - 1, ys + 1, "c");
rect(CX - 7, 19, CX + 7, 31, "p");           // place centrale
rect(2, 28, 6, 31, "w"); rect(57, 28, 61, 31, "w"); // deux mares
// --- bâtiments publics autour de la place (façade vers le sud)
const zones = [
  { id: "hq", asset: "hq", x: CX, y: 9, rot: 0, label: "Quartier général", role: "headquarters", view: "board", blurb: "Vue d'ensemble de toute la flotte d'agents." },
  { id: "ai_lab", asset: "ai_lab", x: 13, y: 14, rot: 0, label: "Laboratoire IA", role: "ai-lab", view: "skills", view2: "jobs", blurb: "Bibliothèque de skills et métiers : où les agents se spécialisent." },
  { id: "ops_center", asset: "ops_center", x: 51, y: 14, rot: 0, label: "Centre d'opérations", role: "ops", view: "machines", blurb: "Machines et nœuds Tailscale qui hébergent les agents." },
  { id: "dev_workshop", asset: "dev_workshop", x: 13, y: 34, rot: 0, label: "Atelier dev", role: "workshop", view: "teams", blurb: "Équipes et missions de développement en cours." },
  { id: "supervision", asset: "supervision", x: 51, y: 34, rot: 0, label: "Centre de supervision", role: "supervision", view: "reviews", blurb: "Évaluations, arène et agents à surveiller (bloqués / en échec)." },
];
for (const z of zones) { const x = Math.round(z.x), yf = Math.round(z.y) + 4, road = z.y < 24 ? 24 : 40; rect(x - 3, yf, x + 3, yf, "c"); rect(x - 1, Math.min(yf, road), x, Math.max(yf, road), "c"); }
// --- lots : deux rangées face à face le long de chaque rue de lotissement, 4 maisons de chaque côté de l'avenue
const lots = [], XL = [5, 12.5, 20, 27.5], XR = [38, 45.5, 53, 60.5];
STREETS.forEach((ys, pair) => { for (const [row, y, rot] of [[0, ys - 5, 0], [1, ys + 6.5, Math.PI]]) for (const [side, xs] of [[0, XL], [1, XR]]) for (const x of xs) lots.push({ x, y, rot, district: pair * 2 + side, street: ys }); });
const loc = (l, lx, lz) => [l.x + lx * Math.cos(l.rot) + lz * Math.sin(l.rot), l.y - lx * Math.sin(l.rot) + lz * Math.cos(l.rot)];
for (const l of lots) { // chemin pavé de la porte à la rue
  const x = Math.round(l.x), a = l.rot === 0 ? Math.round(l.y + 2.4) : l.street, b = l.rot === 0 ? l.street : Math.round(l.y - 2.4); rect(x - 1, a, x, b, "c"); }
for (const l of lots) {
  for (const lx of [-3, -2, 2, 3]) add("fence", ...loc(l, lx, 3.4), l.rot);                                  // clôture de façade (portillon au centre)
  for (const lz of [2.6, 1.6, .6, -.4, -1.4, -2.4]) for (const sx of [-1, 1]) add("fence", ...loc(l, sx * 3.5, lz), l.rot + Math.PI / 2); // clôtures latérales
  add("flowerbed", ...loc(l, -2.2, 2.9), l.rot); add("flowerbed", ...loc(l, 2.2, 2.9), l.rot); add("mailbox", ...loc(l, 1.35, 3.1), l.rot);
  add("hedge", ...loc(l, -1.6, -2.5), l.rot); add("hedge", ...loc(l, 1.6, -2.5), l.rot);
}
// --- place : fontaine, bancs, lampadaires, parterres, panneau
add("fountain", CX, 25, 0);
[[-5.5, -4.3, 0], [5.5, -4.3, 0], [-5.5, 4.3, Math.PI], [5.5, 4.3, Math.PI]].forEach(([dx, dy, r]) => add("bench", CX + dx, 25 + dy, r));
[[-6.3, -5.5], [6.3, -5.5], [-6.3, 5.5], [6.3, 5.5]].forEach(([dx, dy]) => add("lamp", CX + dx, 25 + dy));
[[-4, -5.6], [4, -5.6], [-4, 5.6], [4, 5.6]].forEach(([dx, dy]) => add("flowerbed", CX + dx, 25 + dy, 0));
add("signpost", CX + 3.2, 28.4, 0, { text: "Fleet Office" });
// --- éclairage et mobilier le long des rues
for (let x = 3; x < W - 2; x += 8) { if (Math.abs(x - CX) > 8) { add("lamp", x, 23.6); add("lamp", x + 4, 27.4); } add("lamp", x + 2, 39.6); }
for (const ys of STREETS) for (let x = 3; x < W - 2; x += 8) if (Math.abs(x - CX) > 3) add("lamp", x + 3.6, ys - 0.4);
for (let y = 3; y < 19; y += 8) { add("lamp", CX - 2.4, y); add("lamp", CX + 2.4, y + 4); }
add("bench", 22, 23.4, 0); add("bench", 42, 27.6, Math.PI); add("bench", 26, 39.4, 0); add("bench", 38, 41.6, Math.PI);
for (const z of zones) { add("lamp", z.x - 4.6, z.y + 5.2); add("lamp", z.x + 4.6, z.y + 5.2); add("bush", z.x - 7.2, z.y + 3); add("bush", z.x + 7.6, z.y + 3); add("flowerbed", z.x - 2.6, z.y + 3.6, 0); add("flowerbed", z.x + 2.6, z.y + 3.6, 0); }
add("crate", 18.3, 36.4, 0.3); add("crate", 19.2, 36.9, 0.6);
// --- ceinture d'arbres (sorties aux bouts des rues) puis arbres isolés
const paved = (x, y) => { const c = (g[Math.floor(y)] || [])[Math.floor(x)]; return c === "c" || c === "p"; };
for (let i = 0; i < 2; i++) { for (let x = 0.8; x < W; x += 1.5) for (const y of [0.9 + i * 1.5, H - 0.9 - i * 1.5]) if (!paved(x, y) && !paved(x, y < 5 ? 3 : H - 4)) add(rnd() < .7 ? "tree_pine" : "tree_round", x + (rnd() - .5) * .4, y, rnd() * 6.28);
  for (let y = 2.4; y < H - 2; y += 1.5) for (const x of [0.9 + i * 1.5, W - 0.9 - i * 1.5]) if (!paved(x, y) && !paved(x < 5 ? 3 : W - 4, y)) add(rnd() < .7 ? "tree_pine" : "tree_round", x, y + (rnd() - .5) * .4, rnd() * 6.28); }
for (const [x, y, t] of [[CX, 2.5, "Nord"], [CX, H - 3, "Sud"], [3, 25, "Ouest"], [W - 3, 25, "Est"]]) add("signpost", x + (t === "Nord" || t === "Sud" ? 2.4 : 0), y + (t === "Ouest" || t === "Est" ? 2.2 : 0), 0, { text: t });
const solid = zones.map((z) => ({ x: z.x, y: z.y, rx: 7.5, ry: 5 })).concat(lots.map((l) => ({ x: l.x, y: l.y, rx: 4.4, ry: 4.4 })));
const free = (x, y, r = 0) => { for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if ((g[y + j] || [])[x + i] !== "g") return false; return true; };
const near = (x, y, pad) => solid.some((s) => Math.abs(x - s.x) < s.rx + pad && Math.abs(y - s.y) < s.ry + pad);
let tr = 0, bu = 0, fl = 0;
for (let t = 0; t < 9000 && (tr < 55 || bu < 40 || fl < 50); t++) {
  const x = 4 + Math.floor(rnd() * (W - 8)), y = 4 + Math.floor(rnd() * (H - 8)); if (!free(x, y, 1) || near(x, y, 1.2) || Math.hypot(x - CX, y - 25) < 9) continue;
  const r = rnd(); if (r < .4 && tr < 55) { add(rnd() < .5 ? "tree_round" : rnd() < .5 ? "tree_autumn" : "tree_pine", x, y, rnd() * 6.28); tr++; } else if (r < .7 && bu < 40) { add("bush", x, y, rnd() * 6.28); bu++; } else if (fl < 50) { add("flowers", x, y, rnd() * 3.14); fl++; }
}
const rows = g.map((r) => r.join(""));
fs.writeFileSync(OUT, JSON.stringify({ version: 2, name: "Fleet Office — ville pilote", tile: 1, size: { w: W, h: H }, spawn: { x: CX, y: 29.5 }, legend: { g: "herbe", c: "pavés", p: "dalles de plaza", d: "terre battue", w: "eau" }, rows, zones, lots, objects }).replace(/"rows":\[/, '"rows":[\n').replace(/","/g, '",\n"'));
console.log("carte", W + "x" + H, "objets", objects.length, "lots", lots.length, "zones", zones.length);
