// Construit les modèles 3D ORIGINAUX (GLB) et le registre d'assets (registry.json). usage : node tools/world3d/build-models.mjs
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { Model, box, plate, prism, cone, dome, gable, hip, writeGLB } from "./glb.mjs";
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../public/world3d/assets"), TEX = path.join(ROOT, "tex"), MOD = path.join(ROOT, "models");
fs.mkdirSync(MOD, { recursive: true });
const reg = [], LIC = "CC0-1.0", SRC = { kind: "generated", tool: "tools/world3d/build-models.mjs", note: "dessiné par code, aucune donnée tierce" };
const defs = {}; // id -> { category, build(m), collide, occlusion, extra }
const def = (id, category, build, extra = {}) => (defs[id] = { category, build, ...extra });
const door = (m, x, w = 1.1, h = 1.65, tex = "door", z = 0) => plate(m, tex, "+z", z, x - w / 2, x + w / 2, 0, h);
const win = (m, x, y, w = 0.9, h = 0.9, z = 0, tex = "window") => { plate(m, tex, "+z", z, x - w / 2, x + w / 2, y, y + h); box(m, x - w / 2 - .06, y - .08, z, x + w / 2 + .06, y, z + .1, "wood"); };
const sign = (m, x, y, z, w = 1.8) => box(m, x - w / 2, y, z, x + w / 2, y + .45, z + .12, { side: "signboard", top: "signboard" });

// ---- maisons de projet (6 styles) -----------------------------------------------------------------------------
const WALL = ["wall_cream", "wall_blue", "wall_mint", "wall_sand", "wall_rose", "wall_timber"], ROOF = ["roof_red", "roof_blue", "roof_green", "roof_orange", "roof_slate", "roof_crimson"];
WALL.forEach((w, i) => def("house_" + i, "building", (m) => {
  const two = i % 2 === 1, H = two ? 4.6 : 2.7, X0 = -2.3, X1 = 2.3, Z0 = -1.9, Z1 = 1.9;
  box(m, X0, 0, Z0, X1, .35, Z1, "stone"); box(m, X0 + .02, .35, Z0 + .02, X1 - .02, H, Z1 - .02, { side: w, top: w });
  gable(m, X0, Z0, X1, Z1, H, 1.5, .35, ROOF[i], w);
  door(m, 0, 1.1, 1.65, "door", Z1 - .02); box(m, -.9, 0, Z1, .9, .12, Z1 + .55, "stone");
  win(m, -1.5, 1.0, .9, .9, Z1 - .02); win(m, 1.5, 1.0, .9, .9, Z1 - .02); if (two) { for (const x of [-1.5, 0, 1.5]) win(m, x, 3.0, .9, .9, Z1 - .02); }
  if (i % 2 === 0) box(m, 1.2, H, -.5, 1.8, H + 1.9, .1, "wall_brick"), box(m, 1.15, H + 1.9, -.55, 1.85, H + 2.05, .15, "stone");
}, { collide: { type: "box", w: 4.6, d: 3.8 } }));

// ---- bâtiments fonctionnels ------------------------------------------------------------------------------------
def("hq", "building", (m) => { // Quartier général : corps large, tour centrale à croupe, portique, drapeau
  box(m, -4.2, 0, -2.7, 4.2, .4, 2.7, "stone"); box(m, -4.15, .4, -2.65, 4.15, 3.4, 2.65, { side: "wall_cream", top: "wall_cream" });
  hip(m, -4.15, -2.65, 4.15, 2.65, 3.4, 1.5, .4, "roof_blue");
  box(m, -1.5, 3.4, -1.5, 1.5, 6.0, 1.3, { side: "wall_cream", top: "wall_cream" }); hip(m, -1.5, -1.5, 1.5, 1.3, 6.0, 1.9, .35, "roof_blue");
  plate(m, "window", "+z", 1.3, -.5, .5, 4.2, 5.1); plate(m, "window", "+x", 1.5, -.6, .5, 4.2, 5.1); plate(m, "window", "-x", -1.5, -.6, .5, 4.2, 5.1);
  box(m, -.05, 7.9, -.1, .05, 9.4, 0, "metal"); plate(m, "flag", "+z", .02, .05, 1.1, 8.7, 9.3, { double: true });
  for (const x of [-1.6, -.6, .6, 1.6]) prism(m, x, 3.3, .22, .4, 3.4, 8, "stone");
  box(m, -2.2, 3.4, 2.65, 2.2, 3.6, 3.9, "stone"); box(m, -2.0, 3.6, 2.9, 2.0, 3.9, 3.8, "roof_blue");
  door(m, 0, 1.4, 2.0, "door", 2.65); sign(m, 0, 2.3, 2.65, 2.4);
  [-3.3, -2.4, 2.4, 3.3].forEach((x) => { win(m, x, 1.2, .9, 1.1, 2.65); win(m, x, 2.3, .9, .9, 2.65); });
}, { collide: { type: "box", w: 8.4, d: 6.4 } });
def("ai_lab", "building", (m) => { // Laboratoire IA : octogone à dôme + annexe vitrée
  const R = 2.9; prism(m, 0, 0, R + .1, 0, .35, 8, "stone", { a0: Math.PI / 8 }); prism(m, 0, 0, R, .35, 3.2, 8, "wall_lab", { a0: Math.PI / 8 });
  dome(m, 0, 3.2, 0, R + .25, 4, 8, "roof_teal"); prism(m, 0, 0, .12, 6.4, 7.6, 6, "metal"); dome(m, 0, 7.5, 0, .25, 2, 6, "lamp_glass", { full: true, emissive: true });
  for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + (i + .5) / 8 * Math.PI * 2, rr = R * Math.cos(Math.PI / 8) + .02, cx = Math.sin(a) * rr, cz = Math.cos(a) * rr; if (i === 0) continue; const w = 1.1, ux = Math.cos(a), uz = -Math.sin(a);
    m.quad("window_tech", [[cx - ux * w / 2, 1.3, cz - uz * w / 2], [cx + ux * w / 2, 1.3, cz + uz * w / 2], [cx + ux * w / 2, 2.6, cz + uz * w / 2], [cx - ux * w / 2, 2.6, cz - uz * w / 2]].map(([x, y, z]) => [x, y, z]), [[0, 1], [1, 1], [1, 0], [0, 0]], { center: [0, 1.9, 0] }); }
  const fz = R * Math.cos(Math.PI / 8); door(m, 0, 1.2, 1.9, "door_glass", fz); sign(m, 0, 2.4, fz - .02, 2.0);
  box(m, 3.2, 0, -1, 5.4, 2.4, 1.6, { side: "wall_lab", top: "roof_flat" }); plate(m, "window_tech", "+z", 1.6, 3.5, 5.1, 1.0, 2.0); box(m, 3.1, 2.4, -1.1, 5.5, 2.6, 1.7, "roof_flat");
}, { collide: { type: "box", w: 11, d: 6.2, cx: 1.2 } });
def("ops_center", "building", (m) => { // Centre d'opérations : bloc long, toit plat, parabole, mât
  box(m, -5, 0, -2.5, 5, .3, 2.5, "stone"); box(m, -4.95, .3, -2.45, 4.95, 2.9, 2.45, { side: "wall_panel", top: "roof_flat" }); box(m, -5.1, 2.9, -2.6, 5.1, 3.2, 2.6, "roof_flat");
  [-3.4, -1.2, 2.6].forEach((x) => plate(m, "window_tech", "+z", 2.45, x - .9, x + .9, 1.0, 2.3)); door(m, 4.0, 1.3, 1.9, "door_glass", 2.45); sign(m, 0, 2.45, 2.45, 2.6);
  prism(m, -2.5, -.5, .2, 3.2, 4.4, 8, "metal"); cone(m, -2.5, -.5, 1.0, 4.35, 4.9, 12, "metal", {}); dome(m, -2.5, 4.35, -.5, 1.0, 2, 12, "metal", { double: true });
  box(m, 2.2, 3.2, -1.6, 3.4, 4.0, -.4, "metal"); box(m, 3.7, 3.2, -1.8, 4.5, 3.9, -1.0, "metal");
  prism(m, 0.6, 1.2, .08, 3.2, 7.2, 6, "metal"); box(m, .45, 7.2, 1.05, .75, 7.5, 1.35, "lamp_glass", { emissive: true });
  box(m, 5.1, 0, -1.5, 6.3, 1.8, 1.2, { side: "wall_panel", top: "roof_flat" });
}, { collide: { type: "box", w: 12.6, d: 5.2, cx: .6 } });
def("dev_workshop", "building", (m) => { // Atelier dev : brique, toit orange, cheminée, appentis, caisses
  box(m, -3.5, 0, -2.5, 3.5, .3, 2.5, "stone"); box(m, -3.45, .3, -2.45, 3.45, 2.7, 2.45, { side: "wall_brick", top: "wall_brick" }); gable(m, -3.45, -2.45, 3.45, 2.45, 2.7, 1.8, .45, "roof_orange", "wall_brick");
  box(m, 1.4, 3.2, -1.5, 2.2, 5.3, -.7, "wall_brick"); box(m, 1.3, 5.3, -1.6, 2.3, 5.5, -.6, "stone");
  door(m, -1.4, 1.9, 1.9, "door", 2.45); win(m, 0.9, 1.0, 1.0, 1.0, 2.45); win(m, 2.4, 1.0, 1.0, 1.0, 2.45); sign(m, -1.4, 2.0, 2.45, 2.0);
  box(m, 3.5, 0, -1.8, 5.3, 1.9, 1.4, { side: "wood", top: "wood" }); box(m, 3.4, 1.9, -1.9, 5.5, 2.05, 1.6, "roof_slate");
  for (const [x, z, s] of [[-3.0, 3.1, .7], [-2.2, 3.4, .55], [-2.5, 2.9, .5]]) box(m, x - s / 2, 0, z - s / 2, x + s / 2, s, z + s / 2, "wood");
  prism(m, 4.4, 2.6, .35, 0, .55, 8, "metal");
}, { collide: { type: "box", w: 10.6, d: 6.0, cx: 1.0 } });
def("supervision", "building", (m) => { // Centre de supervision : tour, cabine vitrée panoramique, balise
  box(m, -2.6, 0, -2.6, 2.6, .35, 2.6, "stone"); box(m, -2.2, .35, -2.2, 2.2, 4.6, 2.2, { side: "wall_stone", top: "wall_stone" }); box(m, -2.45, 4.6, -2.45, 2.45, 4.85, 2.45, "stone");
  box(m, -1.8, 4.85, -1.8, 1.8, 6.6, 1.8, { side: "wall_panel", top: "wall_panel" });
  for (const [f, p, a, b] of [["+z", 1.8, -1.5, 1.5], ["-z", -1.8, -1.5, 1.5], ["+x", 1.8, -1.5, 1.5], ["-x", -1.8, -1.5, 1.5]]) plate(m, "window_tech", f, p, a, b, 5.2, 6.3);
  hip(m, -1.8, -1.8, 1.8, 1.8, 6.6, 1.5, .5, "roof_crimson"); prism(m, 0, 0, .1, 8.0, 9.0, 6, "metal"); dome(m, 0, 9.0, 0, .35, 2, 8, "lamp_glass", { full: true, emissive: true });
  door(m, 0, 1.3, 1.9, "door_glass", 2.2); sign(m, 0, 2.5, 2.2, 2.2); plate(m, "window_tech", "+z", 2.2, -1.7, -.6, 1.2, 2.2); plate(m, "window_tech", "+z", 2.2, .6, 1.7, 1.2, 2.2);
  box(m, 2.6, 0, -1.2, 4.2, 1.5, 1.2, { side: "wall_panel", top: "roof_flat" });
}, { collide: { type: "box", w: 8.8, d: 5.2, cx: 0.8 } });

// ---- végétation et mobilier ------------------------------------------------------------------------------------
def("tree_round", "vegetation", (m) => { prism(m, 0, 0, .2, 0, 1.4, 6, "bark"); dome(m, 0, 1.0, 0, 1.15, 3, 8, "leaf", { full: true }); dome(m, .55, 1.9, .2, .75, 2, 6, "leaf_dark", { full: true }); dome(m, -.5, 2.0, -.25, .7, 2, 6, "leaf", { full: true }); }, { collide: { type: "circle", r: .35 } });
def("tree_pine", "vegetation", (m) => { prism(m, 0, 0, .18, 0, 1.0, 6, "bark"); [[.95, 0.8, 1.2], [.75, 1.6, 1.1], [.5, 2.4, 1.0]].forEach(([r, y, h]) => cone(m, 0, 0, r, y, y + h, 8, "leaf_dark")); }, { collide: { type: "circle", r: .3 } });
def("tree_autumn", "vegetation", (m) => { prism(m, 0, 0, .2, 0, 1.3, 6, "bark"); dome(m, 0, 1.0, 0, 1.05, 3, 8, "leaf_autumn", { full: true }); dome(m, .4, 1.8, .1, .65, 2, 6, "leaf_autumn", { full: true }); }, { collide: { type: "circle", r: .35 } });
def("bush", "vegetation", (m) => { dome(m, 0, .25, 0, .5, 2, 7, "leaf", { full: true }); dome(m, .35, .2, .1, .35, 2, 6, "leaf_dark", { full: true }); }, { collide: { type: "circle", r: .4 } });
def("flowers", "vegetation", (m) => { for (const a of [0, Math.PI / 2]) { const c = Math.cos(a) * .5, s = Math.sin(a) * .5; m.quad("flowers", [[-c, 0, -s], [c, 0, s], [c, .55, s], [-c, .55, -s]], [[0, 1], [1, 1], [1, 0], [0, 0]], { double: true, mask: true }); } }, { collide: null });
def("lamp", "furniture", (m) => { prism(m, 0, 0, .14, 0, .25, 6, "metal"); prism(m, 0, 0, .06, .25, 2.5, 6, "metal"); box(m, -.17, 2.5, -.17, .17, 2.9, .17, "lamp_glass", { emissive: true }); box(m, -.24, 2.9, -.24, .24, 3.02, .24, "metal"); }, { collide: { type: "circle", r: .15 }, light: true });
def("bench", "furniture", (m) => { box(m, -.7, .4, -.22, .7, .5, .22, "wood"); box(m, -.7, .5, -.24, .7, 1.0, -.16, "wood"); for (const x of [-.6, .6]) box(m, x - .05, 0, -.2, x + .05, .4, .2, "metal"); }, { collide: { type: "box", w: 1.5, d: .5 } });
def("signpost", "furniture", (m) => { prism(m, 0, 0, .06, 0, 1.5, 6, "wood"); box(m, -.55, 1.1, .05, .55, 1.55, .15, { side: "signboard", top: "signboard" }); }, { collide: { type: "circle", r: .12 } });
def("fountain", "furniture", (m) => { prism(m, 0, 0, 1.7, 0, .55, 12, { side: "stone", top: "stone" }); for (let i = 0; i < 16; i++) { const a0 = i / 16 * Math.PI * 2, a1 = (i + 1) / 16 * Math.PI * 2; m.tri("ground_w", [[0, .56, 0], [Math.sin(a0) * 1.5, .56, Math.cos(a0) * 1.5], [Math.sin(a1) * 1.5, .56, Math.cos(a1) * 1.5]], [[0, 0], [0, 0], [0, 0]], { center: [0, 0, 0] }); } prism(m, 0, 0, .25, .55, 1.6, 8, "stone"); prism(m, 0, 0, .75, 1.6, 1.8, 10, "stone"); dome(m, 0, 1.8, 0, .55, 2, 8, "ground_w", {}); }, { collide: { type: "circle", r: 1.7 } });
def("fence", "furniture", (m) => { box(m, -.5, .12, -.03, .5, .2, .03, "wood"); box(m, -.5, .4, -.03, .5, .48, .03, "wood"); for (let i = 0; i < 5; i++) { const x = -.4 + i * .2; box(m, x - .05, 0, -.04, x + .05, .55, .04, { side: "stone", top: "stone" }); } }, { collide: { type: "box", w: 1, d: .2 } });
def("hedge", "vegetation", (m) => { box(m, -.5, 0, -.3, .5, .75, .3, { side: "leaf_dark", top: "leaf" }); }, { collide: { type: "box", w: 1, d: .6 } });
def("mailbox", "furniture", (m) => { prism(m, 0, 0, .04, 0, .8, 5, "wood"); box(m, -.16, .8, -.1, .16, 1.0, .1, "roof_red"); }, { collide: { type: "circle", r: .12 } });
def("flowerbed", "vegetation", (m) => { box(m, -.5, 0, -.25, .5, .15, .25, { side: "wood", top: "bark" }); for (const a of [0, Math.PI / 2]) { const c = Math.cos(a) * .5, s2 = Math.sin(a) * .25; m.quad("flowers", [[-c, .12, -s2], [c, .12, s2], [c, .6, s2], [-c, .12 + .48, -s2]], [[0, 1], [1, 1], [1, 0], [0, 0]], { double: true, mask: true }); } }, { collide: null });
def("tallgrass", "vegetation", (m) => { for (const a of [0, Math.PI / 3, 2 * Math.PI / 3]) { const c = Math.cos(a) * .55, s2 = Math.sin(a) * .55; m.quad("tallgrass", [[-c, 0, -s2], [c, 0, s2], [c, .8, s2], [-c, .8, -s2]], [[0, 1], [1, 1], [1, 0], [0, 0]], { double: true, mask: true }); } }, { collide: null, scenery: true });
def("windmill", "scenery", (m) => { prism(m, 0, 0, 2.3, 0, .5, 8, "stone"); prism(m, 0, 0, 2.0, .5, 3.2, 8, "wall_cream"); prism(m, 0, 0, 1.65, 3.2, 5.6, 8, "wall_cream"); cone(m, 0, 0, 2.1, 5.6, 7.8, 8, "roof_red"); box(m, -.55, 0, 1.95, .55, 1.7, 2.1, "door"); plate(m, "door", "+z", 2.0, -.55, .55, 0, 1.65); for (const a of [Math.PI / 8 + Math.PI / 4, -Math.PI / 8 - Math.PI / 4]) { const r = 1.9, cx = Math.sin(a) * r, cz = Math.cos(a) * r, ux = Math.cos(a), uz = -Math.sin(a); m.quad("window", [[cx - ux * .4, 1.6, cz - uz * .4], [cx + ux * .4, 1.6, cz + uz * .4], [cx + ux * .4, 2.5, cz + uz * .4], [cx - ux * .4, 2.5, cz - uz * .4]], [[0, 1], [1, 1], [1, 0], [0, 0]], { center: [0, 2, 0] }); } box(m, -.25, 5.05, 1.5, .25, 5.55, 1.95, "wood"); }, { collide: { type: "box", w: 4.4, d: 4.4 }, scenery: true });
def("windmill_sails", "scenery", (m) => { const o = { double: true, noOrient: true }; box(m, -.22, -.22, -.1, .22, .22, .3, { side: "wood", top: "wood" }, o); for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2, c = Math.cos(a), s = Math.sin(a), R = (x, y) => [x * c - y * s, x * s + y * c]; const pts = (x0, y0, x1, y1, z) => [R(x0, y0), R(x1, y0), R(x1, y1), R(x0, y1)].map(([x, y]) => [x, y, z]); m.quad("wood", pts(-.09, .2, .09, 4.2, .12), [[0, 1], [1, 1], [1, 0], [0, 0]], o); m.quad("sail", pts(.09, .9, 1.05, 4.1, .14), [[0, 1], [1, 1], [1, 0], [0, 0]], o); } }, { collide: null, scenery: true, anim: "spin" });
def("clock_tower", "scenery", (m) => { box(m, -1.6, 0, -1.6, 1.6, .4, 1.6, "stone"); box(m, -1.5, .4, -1.5, 1.5, 7.0, 1.5, { side: "wall_brick", top: "wall_brick" }); box(m, -1.8, 7.0, -1.8, 1.8, 7.3, 1.8, "stone"); box(m, -1.5, 7.3, -1.5, 1.5, 9.1, 1.5, { side: "wall_cream", top: "wall_cream" }); hip(m, -1.5, -1.5, 1.5, 1.5, 9.1, 2.6, .4, "roof_blue"); for (const [f, p] of [["+z", 1.5], ["-z", -1.5], ["+x", 1.5], ["-x", -1.5]]) plate(m, "clock", f, p, -.65, .65, 7.75, 9.05); door(m, 0, 1.0, 1.6, "door", 1.5); plate(m, "window", "+z", 1.5, -.4, .4, 4.0, 5.0); plate(m, "window", "+z", 1.5, -.4, .4, 5.4, 6.4); box(m, -.05, 11.6, -.05, .05, 12.6, .05, "metal"); }, { collide: { type: "box", w: 3.6, d: 3.6 }, scenery: true });
def("gate", "scenery", (m) => { for (const x of [-2.4, 2.4]) { box(m, x - .45, 0, -.45, x + .45, .4, .45, "stone"); box(m, x - .35, .4, -.35, x + .35, 3.3, .35, { side: "wall_stone", top: "stone" }); box(m, x - .5, 3.3, -.5, x + .5, 3.5, .5, "stone"); } box(m, -2.9, 3.5, -.3, 2.9, 4.0, .3, "stone"); box(m, -1.2, 3.0, .3, 1.2, 3.5, .38, { side: "signboard", top: "signboard" }); }, { collide: null, scenery: true });
def("pier", "scenery", (m) => { box(m, -2.6, .22, -1.1, 2.6, .34, 1.1, { side: "wood", top: "wood" }); for (const x of [-2.4, 0, 2.4]) for (const z of [-1, 1]) box(m, x - .09, -.4, z - .09, x + .09, .6, z + .09, "bark"); for (const z of [-1.05, 1.05]) box(m, -2.6, .34, z - .04, 2.6, .8, z + .04, "wood"); }, { collide: null, scenery: true });
def("bridge", "scenery", (m) => { box(m, -2.3, .12, -1.2, 2.3, .26, 1.2, { side: "wood", top: "wood" }); for (const z of [-1.15, 1.15]) { box(m, -2.3, .26, z - .05, 2.3, .85, z + .05, "wood"); for (const x of [-2.2, -.7, .7, 2.2]) box(m, x - .08, 0, z - .08, x + .08, .95, z + .08, "bark"); } }, { collide: null, scenery: true });
def("crate", "furniture", (m) => { box(m, -.35, 0, -.35, .35, .7, .35, { side: "wood", top: "wood" }); }, { collide: { type: "box", w: .7, d: .7 } });

// ---- build ----------------------------------------------------------------------------------------------------
const roofPrim = new Set();
for (const [id, d] of Object.entries(defs)) {
  const m = new Model(id, TEX); m.center = [0, 1, 0];
  // « ground_w » = pastille d'eau issue de l'atlas (la tuile eau est la 8e) : on remplace par la texture d'atlas avec UV d'eau
  const orig = m.quad.bind(m); m.quad = (tex, p, uv, o) => orig(tex === "ground_w" ? "ground" : tex, p, tex === "ground_w" ? uv.map(() => [.625, .5]) : uv, o);
  const oTri = m.tri.bind(m); m.tri = (tex, p, uv, o, c) => oTri(tex === "ground_w" ? "ground" : tex, p, tex === "ground_w" ? uv.map(() => [.625, .5]) : uv, o, c);
  d.build(m); const file = id + ".glb"; writeGLB(m, path.join(MOD, file)); const b = m.bbox();
  const isB = d.category === "building";
  reg.push({ id, category: d.category, file: "models/" + file, format: "glb", source: SRC, licence: LIC, dimensions: { w: +(b.size[0]).toFixed(2), h: +(b.size[1]).toFixed(2), d: +(b.size[2]).toFixed(2) }, bbox: { min: b.min.map((v) => +v.toFixed(2)), max: b.max.map((v) => +v.toFixed(2)) }, triangles: b.tris,
    anchor: "bottom-center", scale: 1, front: "+z", materials: [...m.parts.values()].map((p) => p.tex + (p.o.emissive ? " (émissif)" : "") + (p.o.mask ? " (découpe)" : "")),
    occlusion: isB ? { mode: "fade", note: "estompé quand il masque le personnage" } : { mode: d.category === "vegetation" && id.startsWith("tree") ? "none" : "none" },
    collision: d.collide === undefined ? null : d.collide, instanced: !isB, emitsLight: !!d.light, animations: d.anim ? [{ name: d.anim, axis: "z", note: "rotation continue pilotée par le moteur (props animés de la carte)" }] : [], fallback: { shape: "box", color: isB ? "#c9a46a" : "#4e9b62" } });
  console.log("glb", id.padEnd(13), b.size.join("×").padEnd(18), b.tris + " tris");
}
// feuilles de sprites de personnages + atlas de sol + textures déclarés au registre (pour inventaire/licences)
const sheets = fs.readdirSync(TEX).filter((f) => f.startsWith("char_")).sort().map((f) => f.replace(".png", ""));
for (const s of sheets) reg.push({ id: s, category: "character", file: "tex/" + s + ".png", format: "png-spritesheet", source: SRC, licence: LIC, dimensions: { w: 1, h: 1.5, d: 0 }, sheet: { px: [64, 96], cell: [16, 24], cols: 4, rows: 4, rowsOrder: ["bas", "gauche", "droite", "haut"] }, anchor: "bottom-center", scale: 1, billboard: "yaw", materials: ["alphaTest 0.5, nearest"], occlusion: { mode: "none" }, collision: { type: "circle", r: .3 }, animations: [{ name: "idle", frames: [0, 2], fps: 1.5 }, { name: "walk", frames: [0, 1, 2, 3], fps: 7 }], fallback: { shape: "capsule", color: "#2f9aa0" } });
reg.push({ id: "ground_atlas", category: "terrain", file: "tex/ground.png", format: "png-atlas", source: SRC, licence: LIC, dimensions: { w: 192, h: 16, d: 0 }, atlas: { tile: 16, tiles: ["grass_a", "grass_b", "grass_flowers", "cobble", "cobble_edge", "plaza_stone", "dirt", "water", "sand", "tall_grass", "water_b", "flower_field"] }, anchor: "tile", scale: 1, materials: ["nearest"], occlusion: { mode: "none" }, collision: null, animations: [], fallback: { shape: "plane", color: "#5fae45" } });
const prev = fs.existsSync(path.join(ROOT, "registry.json")) ? JSON.parse(fs.readFileSync(path.join(ROOT, "registry.json"), "utf8")).assets.filter((a) => a.source && a.source.kind === "imported") : []; // les assets importés survivent à une régénération
for (const a of prev) if (!reg.some((r) => r.id === a.id)) reg.push(a);
fs.writeFileSync(path.join(ROOT, "registry.json"), JSON.stringify({ version: 1, unit: "1 unité = 1 tuile = 16 px de texture ; Y vers le haut ; face avant des modèles = +Z", generated: new Date().toISOString().slice(0, 10), assets: reg }, null, 1));
console.log("registre :", reg.length, "assets");
