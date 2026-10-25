// Génère la carte pilote (public/world3d/assets/maps/pilot.json) — petite ville façon RPG, entièrement en sprites 2D verticaux (assets IcyEthics + pack utilisateur).
// Toutes les façades regardent le sud (caméra fixe) : les maisons sont en rangées au nord de chaque rue. Voir build-sprites.mjs pour les assets.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../public/world3d/assets/maps/pilot.json");
const W = 64, H = 80, CX = 32, g = Array.from({ length: H }, () => Array(W).fill("g"));
const rect = (x0, y0, x1, y1, c) => { for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) g[y][x] = c; };
const rnd = ((s) => () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296))(42);
const objects = [], add = (asset, x, y, rot = 0, extra = {}) => objects.push({ asset, x: +x.toFixed(2), y: +y.toFixed(2), rot: +rot.toFixed(3), ...extra });
const STREETS = [40, 51, 62, 73]; // rues de lotissement (2 tuiles) ; rangée de maisons au nord de chaque rue (y = rue - 5)
rect(CX - 1, 0, CX + 1, H - 1, "c"); rect(0, 24, W - 1, 26, "c"); for (const ys of STREETS) rect(0, ys, W - 1, ys + 1, "c");
rect(CX - 7, 19, CX + 7, 31, "p");
rect(2, 27, 6, 31, "w"); rect(2, 32, 3, 37, "w"); rect(57, 28, 62, 35, "w"); // étang, ruisseau, lac
for (const [x0, y0, x1, y1] of [[2, 20, 7, 24], [56, 17, 62, 22], [2, 35, 7, 39]]) rect(x0, y0, x1, y1, "t"); // hautes herbes
g[35][2] = g[35][3] = g[36][2] = g[36][3] = "w"; rect(2, 35, 7, 39, "t"); rect(2, 27, 6, 31, "w"); rect(2, 32, 3, 34, "w"); // le ruisseau s'arrête avant les hautes herbes
const plateaus = [{ x0: 1, y0: 2, x1: 9, y1: 13, level: 1, name: "Colline" }, { x0: 55, y0: 2, x1: 62, y1: 8, level: 1, name: "Terrasse" }];
const ramps = [{ x: 4, y: 14, w: 2, h: 5, dir: "n", lo: 0, hi: 1 }, { x: 59, y: 9, w: 2, h: 5, dir: "n", lo: 0, hi: 1 }];
const zones = [
  { id: "hq", asset: "hq", x: CX, y: 12, rot: 0, label: "Quartier général", role: "headquarters", view: "board", blurb: "Vue d'ensemble de toute la flotte d'agents." },
  { id: "ai_lab", asset: "ai_lab", x: 14, y: 17.5, rot: 0, label: "Laboratoire IA", role: "ai-lab", view: "skills", view2: "jobs", blurb: "Bibliothèque de skills et métiers : où les agents se spécialisent." },
  { id: "ops_center", asset: "ops_center", x: 51, y: 17.5, rot: 0, label: "Centre d'opérations", role: "ops", view: "machines", blurb: "Machines et nœuds Tailscale qui hébergent les agents." },
  { id: "dev_workshop", asset: "dev_workshop", x: 14, y: 36, rot: 0, label: "Atelier dev", role: "workshop", view: "teams", blurb: "Équipes et missions de développement en cours." },
  { id: "supervision", asset: "supervision", x: 51, y: 36, rot: 0, label: "Centre de supervision", role: "supervision", view: "reviews", blurb: "Évaluations, arène et agents à surveiller (bloqués / en échec)." },
];
for (const z of zones) { const x = Math.round(z.x), yf = Math.round(z.y) + 2, road = z.y < 24 ? 24 : 40; rect(x - 3, yf, x + 3, yf, "c"); if (z.id === "hq") rect(x - 1, yf, x + 1, 18, "c"); else rect(x - 1, Math.min(yf, road), x, Math.max(yf, road), "c"); }
// lots : toutes façades au sud ; 8 par rangée (4 de chaque côté de l'avenue) ; la rangée du haut n'en a que 4 (zones publiques de part et d'autre)
const lots = [], XL = [5, 12.5, 20, 27.5], XR = [38, 45.5, 53, 60.5];
STREETS.forEach((ys, row) => { const xs = row === 0 ? [21.5, 27.5, 38, 44] : [...XL, ...XR]; for (const x of xs) lots.push({ x, y: ys - 3.2, rot: 0, district: row === 0 ? 6 : (row - 1) * 2 + (x < CX ? 0 : 1), street: ys }); });
for (const l of lots) { const x = Math.round(l.x); rect(x - 1, Math.round(l.y) + 1, x, l.street, "c"); }
for (const l of lots) { for (const lx of [-2.5, 2.5]) add("fence", l.x + lx, l.y + 1.8, 0); add("flowerbed", l.x - 1.8, l.y + 1.3, 0); add("flowerbed", l.x + 1.8, l.y + 1.3, 0); add("bush_0", l.x - 3.4, l.y + 0.3); add("bush_1", l.x + 3.4, l.y + 0.3); }
// place : puits, bancs, lampadaires
add("well", CX, 25, 0); [[-5.5, -4.3], [5.5, -4.3], [-5.5, 4.3], [5.5, 4.3]].forEach(([dx, dy]) => add("bench", CX + dx, 25 + dy)); [[-6.3, -5.5], [6.3, -5.5], [-6.3, 5.5], [6.3, 5.5]].forEach(([dx, dy]) => add("lamp", CX + dx, 25 + dy));
[[-4, -5.6], [4, -5.6], [-4, 5.6], [4, 5.6]].forEach(([dx, dy]) => add("flowerbed", CX + dx, 25 + dy));
for (let x = 3; x < W - 2; x += 8) { if (Math.abs(x - CX) > 8) { add("lamp", x, 23.6); add("lamp", x + 4, 27.6); } for (const ys of STREETS) if (Math.abs(x - CX) > 3) add("lamp", x + 3.6, ys - 0.2); }
for (let y = 3; y < 19; y += 8) { add("lamp", CX - 2.4, y); add("lamp", CX + 2.4, y + 4); }
add("bench", 22, 23.4); add("bench", 42, 27.6); add("hay", 27.5, 14); add("hay", 29.2, 14.4); add("crate", 19.5, 38.4); add("crate", 7, 12);
for (const z of zones) { add("lamp", z.x - 5, z.y + 0.6); add("lamp", z.x + 5, z.y + 0.6); add("bush_big", z.x - 5.8, z.y + 0.4); add("bush_big", z.x + 5.8, z.y + 0.4); }
const paved = (x, y) => { const c = (g[Math.floor(y)] || [])[Math.floor(x)]; return c === "c" || c === "p"; };
const TREES = () => { const r = rnd(); return r < .35 ? "tree_green" : r < .55 ? "tree_autumn" : "tree_user"; };
for (let i = 0; i < 2; i++) { for (let x = 1; x < W; x += 2.2) for (const y of [1.6 + i * 2, H - 0.6 - i * 2]) if (Math.abs(x - CX) > 4.5 && !paved(x, y)) add(TREES(), x + (rnd() - .5) * .6, y); for (let y = 3; y < H - 2; y += 2.2) for (const x of [1.2 + i * 2, W - 1.2 - i * 2]) if (Math.abs(y - 25) > 4.5 && !paved(x, y)) add(TREES(), x, y + (rnd() - .5) * .6); }
for (let i = 0; i < 520; i++) { const side = i % 4, d = 2 + rnd() * 26, t = rnd(); const x = side === 0 ? -d : side === 1 ? W + d : t * (W + 56) - 28, y = side === 2 ? -d : side === 3 ? H + d : t * (H + 56) - 28; add(TREES(), x, y); } // forêt au-delà des limites
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (g[y][x] === "t") for (let k = 0; k < 2; k++) add("tallgrass", x + .2 + rnd() * .6, y + .3 + rnd() * .7);
const solid = zones.map((z) => ({ x: z.x, y: z.y, rx: 7, ry: 3.5 })).concat(lots.map((l) => ({ x: l.x, y: l.y, rx: 4.4, ry: 3 })), ramps.map((r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2, rx: r.w / 2 + 1, ry: r.h / 2 + 1 })));
const free = (x, y, r = 0) => { for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if ((g[y + j] || [])[x + i] !== "g") return false; return true; };
const near = (x, y, pad) => solid.some((s) => Math.abs(x - s.x) < s.rx + pad && Math.abs(y - s.y) < s.ry + pad);
let tr = 0, bu = 0, ro = 0;
for (let t = 0; t < 9000 && (tr < 40 || bu < 30 || ro < 10); t++) {
  const x = 4 + Math.floor(rnd() * (W - 8)), y = 4 + Math.floor(rnd() * (H - 8)); if (!free(x, y, 1) || near(x, y, 1.2) || Math.hypot(x - CX, y - 25) < 9) continue; const r = rnd();
  if (r < .5 && tr < 40) { add(TREES(), x, y); tr++; } else if (r < .85 && bu < 30) { add(rnd() < .5 ? "bush_0" : "bush_1", x, y); bu++; } else if (ro < 10) { add("rock", x, y); ro++; }
}
const npcs = [
  { id: "meunier", name: "Meunier", sheet: "ow_wilbur", kind: "wander", x: 6, y: 12, r: 2.5, lines: ["Le vent tourne bien aujourd'hui.", "Mes voiles tournent depuis ce matin !"] },
  { id: "pecheur", name: "Pêcheur", sheet: "ow_mrfrost", kind: "stand", x: 59.2, y: 31, dir: 2, lines: ["Chut… ça mord, peut-être.", "Le lac est calme ce soir."] },
  { id: "jardinier", name: "Jardinier", sheet: "ow_macdonald", kind: "wander", x: 32, y: 15, r: 3.5, lines: ["Les parterres sont fraîchement arrosés.", "Ne marchez pas sur les fleurs !"] },
  { id: "facteur", name: "Facteur", sheet: "npc_livreur", kind: "route", speed: 1.9, route: [[3, 53.8], [26, 53.8], [37, 53.8], [60, 53.8], [37, 53.8], [26, 53.8]], lines: ["Courrier ! Il y a beaucoup de lettres pour les agents.", "Je fais ma tournée."] },
  { id: "joggeur", name: "Joggeur", sheet: "hero_gold", kind: "route", speed: 2.6, route: [[22, 20], [42, 20], [42, 30], [22, 30]], lines: ["Un tour de place de plus !", "Pas le temps de parler…"] },
  { id: "enfant1", name: "Enfant", sheet: "hero_peter", scale: 0.8, kind: "wander", x: 28, y: 24, r: 4, lines: ["Tu veux jouer à chat ?", "J'ai vu le moulin tourner !"] },
  { id: "enfant2", name: "Enfant", sheet: "ow_scarlett", scale: 0.8, kind: "wander", x: 37, y: 27, r: 4, lines: ["La fontaine est trop belle.", "Mon papa dit que les agents travaillent dur."] },
  { id: "ancien", name: "Ancien", sheet: "ow_pliny", kind: "stand", x: 22.2, y: 22.4, dir: 0, lines: ["De mon banc, je vois toute la place.", "De mon temps, il n'y avait pas d'agents IA."] },
  { id: "promeneuse1", name: "Promeneuse", sheet: "ow_allison", kind: "route", speed: 1.1, route: [[6, 25], [22, 25], [6, 25]], lines: ["Quelle belle ville !", "Je profite des lampadaires."] },
  { id: "promeneur2", name: "Promeneur", sheet: "ow_elmyne", kind: "route", speed: 1.0, route: [[44, 25], [60, 25], [44, 25]], lines: ["On respire bien, ici.", "Le lac est juste à côté."] },
  { id: "gardien-n", name: "Gardien de porte", sheet: "npc_securite", kind: "stand", x: 29, y: 4.2, dir: 0, lines: ["Bienvenue à Fleet Office.", "Au nord : le Quartier général."] },
  { id: "gardien-e", name: "Gardien de porte", sheet: "npc_securite", kind: "stand", x: 60.5, y: 22.5, dir: 1, lines: ["La route de l'est mène au lac.", "Restez sur les pavés !"] },
  { id: "botaniste", name: "Botaniste", sheet: "ow_scarlett", kind: "wander", x: 4.5, y: 20, r: 2, lines: ["Ces hautes herbes sont magnifiques.", "Attention, on s'y perd facilement."] },
  { id: "scientifique", name: "Scientifique", sheet: "npc_scientifique", kind: "wander", x: 13, y: 19.5, r: 2.2, lines: ["Les métiers se forment ici, au laboratoire.", "Chaque skill est évalué avant d'être classé."] },
  { id: "ingenieur", name: "Ingénieur", sheet: "npc_ingenieur", kind: "wander", x: 13, y: 39, r: 2, lines: ["L'atelier ne désemplit pas.", "Un bon agent, ça se règle comme une machine."] },
  { id: "operateur", name: "Opérateur", sheet: "npc_operateur", kind: "wander", x: 51, y: 19.5, r: 2.2, lines: ["Tous les nœuds sont au vert, ou presque.", "Je surveille les machines."] },
  { id: "etudiant", name: "Étudiant", sheet: "hero_red", kind: "wander", x: 20, y: 20, r: 2.5, lines: ["J'apprends les skills du laboratoire.", "Un jour je serai un agent Senior !"] },
  { id: "fleuriste", name: "Grand-mère", sheet: "ow_grandmother", kind: "wander", x: 36, y: 31.5, r: 2.5, lines: ["Des fleurs fraîches pour vos agents ?", "Les parterres de la place, c'est moi."] },
];
const rows = g.map((r) => r.join(""));
fs.writeFileSync(OUT, JSON.stringify({ version: 3, name: "Fleet Office — village pixel art", tile: 1, size: { w: W, h: H }, spawn: { x: CX, y: 29.5 }, legend: { g: "herbe", c: "pavés", p: "dalles de plaza", d: "terre battue", w: "eau", t: "hautes herbes" }, rows, zones, lots, objects, animated: [], plateaus, ramps, npcs }).replace(/"rows":\[/, '"rows":[\n').replace(/","/g, '",\n"'));
console.log("carte", W + "x" + H, "objets", objects.length, "lots", lots.length, "zones", zones.length);
