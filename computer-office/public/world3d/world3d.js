/* Fleet Office — Ville 3D (pilote). Rendu Three.js « overworld DS » : caméra perspective oblique, textures nearest, modèles low-poly
   chargés depuis assets/registry.json (GLB originaux), personnages billboard animés. Les données (maisons, agents) viennent de l'orchestrateur :
   aucune donnée fictive — ce qui n'est pas connecté est affiché comme tel. */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const Q = new URLSearchParams(location.search), $ = (id) => document.getElementById(id);
const BASE = new URL("./assets/", import.meta.url).href, API = (Q.get("api") || "").replace(/\/$/, "");
const RES = Math.max(1, +Q.get("res") || 1);
const S = { assets: { total: 0, loaded: 0, failed: [], fallbacks: 0 }, data: { ok: false, error: null, at: 0 }, houses: 0, agents: 0, spill: 0, sel: null, fps: 0, followed: true, ready: false, extra: {} };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, t) => a + (b - a) * t;
const hashStr = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const bootErr = (m) => { $("boot-e").textContent += m + "\n"; };

// ---------------------------------------------------------------------------------------------- rendu
const canvas = $("gl"), renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
renderer.shadowMap.enabled = Q.get("shadows") !== "0"; renderer.shadowMap.type = THREE.PCFShadowMap;
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x8fcdf5); scene.fog = new THREE.Fog(0x9fd6f7, 120, 250);
const camera = new THREE.PerspectiveCamera(28, 1, 0.5, 400); // champ étroit : rendu « DS » presque orthogonal mais avec fuite de perspective
scene.add(new THREE.HemisphereLight(0xeaf5ff, 0x8a9a6a, 1.55));
const sun = new THREE.DirectionalLight(0xfff1d6, 2.2); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
Object.assign(sun.shadow.camera, { left: -42, right: 42, top: 42, bottom: -42, near: 1, far: 140 }); scene.add(sun, sun.target);
function resize() { const w = innerWidth, h = innerHeight; renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2) / RES); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
addEventListener("resize", resize); resize();

// ---------------------------------------------------------------------------------------------- registre & chargement
const reg = new Map(), protos = new Map(), texCache = new Map(), gltf = new GLTFLoader();
function nearest(t) { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t; }
function loadTex(file) { if (!texCache.has(file)) texCache.set(file, new THREE.TextureLoader().loadAsync(BASE + file).then(nearest)); return texCache.get(file); }
function fallbackProto(e) { // jamais de vide : une boîte colorée aux dimensions du registre, cerclée de fil, signale l'asset manquant
  const d = e.dimensions || { w: 1, h: 1, d: 1 }, g = new THREE.BoxGeometry(d.w || 1, d.h || 1, d.d || 1); g.translate(0, (d.h || 1) / 2, 0);
  const root = new THREE.Group(), m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: new THREE.Color((e.fallback && e.fallback.color) || "#c0c")})); m.castShadow = m.receiveShadow = true;
  root.add(m, new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: 0xff00ff }))); root.userData.fallback = true; S.assets.fallbacks++; return root;
}
function convert(root) {
  root.traverse((o) => { if (!o.isMesh) return; const old = o.material; if (old.map) { old.map.magFilter = THREE.NearestFilter; old.map.anisotropy = 4; old.map.colorSpace = THREE.SRGBColorSpace; }
    o.material = new THREE.MeshLambertMaterial({ map: old.map || null, side: old.side, alphaTest: old.alphaTest || 0, emissive: old.emissive ? old.emissive.clone() : new THREE.Color(0), emissiveMap: old.emissive && old.emissive.getHex() ? old.map : null });
    o.castShadow = true; o.receiveShadow = true; });
  return root;
}
function loadModel(id) {
  if (protos.has(id)) return protos.get(id);
  const p = (async () => {
    const e = reg.get(id); S.assets.total++;
    try { if (!e) throw new Error("absent du registre"); const g = await gltf.loadAsync(BASE + e.file); S.assets.loaded++; return convert(g.scene); }
    catch (err) { S.assets.failed.push({ id, error: String(err.message || err) }); return fallbackProto(e || { dimensions: { w: 1, h: 1, d: 1 } }); }
  })(); protos.set(id, p); return p;
}

// ---------------------------------------------------------------------------------------------- carte
const colliders = [], cgrid = new Map(), CELL = 4;
function addCollider(c) { colliders.push(c); const r = c.type === "circle" ? c.r : Math.hypot(c.w, c.d) / 2 + 0.3, cx = c.x, cz = c.z; for (let i = Math.floor((cx - r) / CELL); i <= Math.floor((cx + r) / CELL); i++) for (let j = Math.floor((cz - r) / CELL); j <= Math.floor((cz + r) / CELL); j++) { const k = i + "," + j; if (!cgrid.has(k)) cgrid.set(k, []); cgrid.get(k).push(c); } }
function removeColliders(tag) { for (let i = colliders.length - 1; i >= 0; i--) if (colliders[i].tag === tag) { const c = colliders[i]; colliders.splice(i, 1); for (const l of cgrid.values()) { const k = l.indexOf(c); if (k >= 0) l.splice(k, 1); } } }
let MAP = null, rows = null, levelGrid = null; const LH = 2.2; // hauteur d'un niveau
function buildRelief() {
  levelGrid = Array.from({ length: MAP.size.h }, () => new Uint8Array(MAP.size.w)); for (const p of MAP.plateaus || []) for (let y = p.y0; y <= p.y1; y++) for (let x = p.x0; x <= p.x1; x++) if (levelGrid[y]) levelGrid[y][x] = p.level;
}
function rampAt(x, z) { for (const r of MAP.ramps || []) if (x >= r.x && x < r.x + r.w && z >= r.y && z < r.y + r.h) return r; return null; }
function rampH(r, x, z) { const p = r.dir === "n" ? (r.y + r.h - z) / r.h : r.dir === "s" ? (z - r.y) / r.h : r.dir === "w" ? (r.x + r.w - x) / r.w : (x - r.x) / r.w; return lerp(r.lo, r.hi, clamp(p, 0, 1)) * LH; }
function heightAt(x, z) { if (!levelGrid) return 0; const r = rampAt(x, z); if (r) return rampH(r, x, z); const row = levelGrid[Math.floor(z)]; return row && row[Math.floor(x)] ? row[Math.floor(x)] * LH : 0; }
function cornerH(tx, tz, cx, cz) { const r = rampAt(tx + 0.5, tz + 0.5); if (r) return rampH(r, clamp(cx, tx + 0.001, tx + 0.999), clamp(cz, tz + 0.001, tz + 0.999)); const row = levelGrid[tz]; return row && row[tx] ? row[tx] * LH : 0; }
const tileAt = (x, z) => { const i = Math.floor(x), j = Math.floor(z); return rows[j] ? rows[j][i] : undefined; };
function blocked(x, z, r = 0.3) {
  if (x < 0.6 || z < 0.6 || x > MAP.size.w - 0.6 || z > MAP.size.h - 0.6) return true;
  if (tileAt(x, z) === "w") return true;
  for (const c of cgrid.get(Math.floor(x / CELL) + "," + Math.floor(z / CELL)) || []) {
    if (c.type === "circle") { if (Math.hypot(x - c.x, z - c.z) < c.r + r) return true; }
    else { const dx = x - c.x, dz = z - c.z, cs = Math.cos(-c.rot), sn = Math.sin(-c.rot), lx = dx * cs - dz * sn, lz = dx * sn + dz * cs; if (Math.abs(lx) < c.w / 2 + r && Math.abs(lz) < c.d / 2 + r) return true; }
  }
  return false;
}
const NT = 12; // tuiles dans l'atlas de sol
function quadsMesh(list, tex, y, name) {
  const pos = [], uv = [], idx = [], inset = 0.4 / (16 * NT); let n = 0;
  for (const [x, z, t, hs] of list) { const u0 = t / NT + inset, u1 = (t + 1) / NT - inset, h = hs || [0, 0, 0, 0]; pos.push(x, y + h[0], z + 1, x + 1, y + h[1], z + 1, x + 1, y + h[2], z, x, y + h[3], z); uv.push(u0, 0, u1, 0, u1, 1, u0, 1); idx.push(n, n + 1, n + 2, n, n + 2, n + 3); n += 4; }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: tex })); mesh.receiveShadow = true; mesh.name = name; return mesh;
}
let waterTex = null, groundObj = null;
function groundMesh(atlas) {
  const M = 36, W = MAP.size.w, H = MAP.size.h, land = [], wat = [], ix = { g: 0, c: 3, p: 5, d: 6, t: 9 }, isW = (c) => c === "w" || c === "b";
  for (let z = -M; z < H + M; z++) for (let x = -M; x < W + M; x++) {
    const ch = rows[z] && rows[z][x] ? rows[z][x] : "g", h = hashStr(x + "," + z);
    if (isW(ch)) { wat.push([x, z, 7]); continue; }
    let t = ix[ch] ?? 0;
    if (ch === "g" || ch === "d") { const nb = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([dx, dz]) => isW((rows[z + dz] || [])[x + dx])); if (nb) t = 8; else if (ch === "g") t = h % 23 === 0 ? 2 : h % 41 === 0 ? 11 : (h >> 3) % 3 === 0 ? 1 : 0; }
    const inMap = rows[z] && rows[z][x] !== undefined; land.push([x, z, t, inMap ? [cornerH(x, z, x, z + 1), cornerH(x, z, x + 1, z + 1), cornerH(x, z, x + 1, z), cornerH(x, z, x, z)] : null]);
  }
  waterTex = atlas.clone(); waterTex.needsUpdate = true;
  const grp = new THREE.Group(); grp.add(quadsMesh(land, atlas, 0, "ground"), quadsMesh(wat, waterTex, -0.04, "water")); const cl = cliffWalls(); if (cl) grp.add(cl); return grp;
}
async function cliffTex() { const t = await loadTex("tex/cliff.png"); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; }
let cliffMat = null, cliffCount = 0;
function cliffWalls() { // murs verticaux entre tuiles de hauteurs différentes (rampes comprises)
  const pos = [], uv = [], idx = []; let n = 0;
  const wall = (ax, az, bx, bz, hAlowA, hAlowB, hAhiA, hAhiB, alongX) => { pos.push(ax, hAlowA, az, bx, hAlowB, bz, bx, hAhiB, bz, ax, hAhiA, az); const u0 = alongX ? ax : az, u1 = alongX ? bx : bz; uv.push(u0, -hAlowA, u1, -hAlowB, u1, -hAhiB, u0, -hAhiA); idx.push(n, n + 1, n + 2, n, n + 2, n + 3); n += 4; };
  for (let z = 0; z < MAP.size.h; z++) for (let x = 0; x < MAP.size.w; x++) {
    if (x + 1 < MAP.size.w) { const a0 = cornerH(x, z, x + 1, z), a1 = cornerH(x, z, x + 1, z + 1), b0 = cornerH(x + 1, z, x + 1, z), b1 = cornerH(x + 1, z, x + 1, z + 1); if (Math.abs(a0 - b0) > 0.01 || Math.abs(a1 - b1) > 0.01) wall(x + 1, z, x + 1, z + 1, Math.min(a0, b0), Math.min(a1, b1), Math.max(a0, b0), Math.max(a1, b1), false); }
    if (z + 1 < MAP.size.h) { const a0 = cornerH(x, z, x, z + 1), a1 = cornerH(x, z, x + 1, z + 1), b0 = cornerH(x, z + 1, x, z + 1), b1 = cornerH(x, z + 1, x + 1, z + 1); if (Math.abs(a0 - b0) > 0.01 || Math.abs(a1 - b1) > 0.01) wall(x, z + 1, x + 1, z + 1, Math.min(a0, b0), Math.min(a1, b1), Math.max(a0, b0), Math.max(a1, b1), true); }
  }
  cliffCount = n / 4; if (!n) return null; const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, cliffMat); m.castShadow = true; m.receiveShadow = true; m.name = "cliffs"; return m;
}
async function kerbs() { // bordures de pavés : fine saillie en pierre là où le pavé touche l'herbe/la terre
  const stone = await loadTex("tex/stone.png"), list = [], paved = (c) => c === "c" || c === "p";
  for (let z = 0; z < MAP.size.h; z++) for (let x = 0; x < MAP.size.w; x++) { if (!paved(rows[z][x])) continue;
    for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) { const c = (rows[z + dz] || [])[x + dx]; if (c === undefined || paved(c)) continue; list.push([x + 0.5 + dx * 0.44, z + 0.5 + dz * 0.44, dx !== 0]); } }
  const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.1, 0.12), new THREE.MeshLambertMaterial({ map: stone }), list.length), m = new THREE.Matrix4();
  list.forEach(([x, z, vert], i) => { m.compose(new THREE.Vector3(x, 0.04, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), vert ? Math.PI / 2 : 0), new THREE.Vector3(1, 1, 1)); im.setMatrixAt(i, m); });
  im.receiveShadow = true; im.castShadow = false; im.frustumCulled = false; scene.add(im); return list.length;
}
// décor instancié par blocs de 16×16 tuiles (une InstancedMesh par bloc et par sous-maillage) → culling par le frustum
const instStats = { instances: 0, meshes: 0 };
async function instanced(objs, tag) {
  const buckets = new Map(); for (const o of objs) { const k = o.asset + "|" + Math.floor(o.x / 16) + "," + Math.floor(o.y / 16); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(o); }
  const made = [];
  for (const [k, arr] of buckets) {
    const proto = await loadModel(arr[0].asset); proto.updateMatrixWorld(true); const e = reg.get(arr[0].asset), meshes = []; proto.traverse((o) => { if (o.isMesh) meshes.push(o); });
    for (const src of meshes) {
      const im = new THREE.InstancedMesh(src.geometry, src.material, arr.length), m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
      arr.forEach((o, i) => { q.setFromAxisAngle(up, o.rot || 0); m.compose(new THREE.Vector3(o.x, heightAt(o.x, o.y), o.y), q, new THREE.Vector3(1, 1, 1)).multiply(src.matrixWorld); im.setMatrixAt(i, m); });
      im.castShadow = true; im.receiveShadow = true; im.instanceMatrix.needsUpdate = true; if (im.computeBoundingSphere) im.computeBoundingSphere(); im.userData.tag = tag; scene.add(im); made.push(im); instStats.meshes++;
    }
    instStats.instances += arr.length; const col = e && e.collision;
    if (col && tag === "decor") for (const o of arr) addCollider(col.type === "circle" ? { type: "circle", x: o.x, z: o.y, r: col.r, tag } : { type: "box", x: o.x, z: o.y, w: col.w, d: col.d, rot: o.rot || 0, tag });
  }
  return made;
}

// ---------------------------------------------------------------------------------------------- bâtiments
const spinners = [], halos = { pts: null }; let nightK = 0, nightMode = Q.get("time") ? "fix" : "auto";
const buildings = []; // { group, kind: zone|house, id, ... }
function cloneBuilding(proto) { const g = proto.clone(true); g.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.userData.base = o.material.emissive.clone(); } }); return g; }
async function placeBuilding(kind, id, asset, x, z, rot, info) {
  const proto = await loadModel(asset), g = cloneBuilding(proto); g.position.set(x, heightAt(x, z), z); g.rotation.y = rot || 0; g.userData = { kind, id, info }; g.name = kind + ":" + id; scene.add(g);
  const e = reg.get(asset), col = e && e.collision, b = { group: g, kind, id, asset, x, z, rot: rot || 0, fade: 1, info, height: (e && e.dimensions && e.dimensions.h) || 5 };
  if (col && col.type === "box") { const cx = (col.cx || 0) * Math.cos(rot || 0), cz = -(col.cx || 0) * Math.sin(rot || 0); addCollider({ type: "box", x: x + cx, z: z + cz, w: col.w, d: col.d, rot: rot || 0, tag: kind + ":" + id }); }
  buildings.push(b); lightWindows(b); return b;
}
function removeBuilding(b) { scene.remove(b.group); removeColliders(b.kind + ":" + b.id); const i = buildings.indexOf(b); if (i >= 0) buildings.splice(i, 1); b.group.traverse((o) => { if (o.isMesh) o.material.dispose(); }); }
function highlight(b, on) { b.group.traverse((o) => { if (o.isMesh) { o.material.emissive.copy(o.userData.base); if (on) o.material.emissive.addScalar(0.16); } }); }

// ---------------------------------------------------------------------------------------------- personnages (billboards)
const sheets = new Map(), badgeTex = new Map();
const ROLE_SHEETS = { 12: "scientifique", 13: "ingenieur", 14: "analyste", 15: "operateur", 16: "securite", 17: "livreur", 18: "etudiant", 19: "medecin" }; // feuilles importées (pack fourni) ; repli : tenues générées
async function sheet(i) {
  const role = typeof i === "string" ? null : ROLE_SHEETS[i % 20], e = typeof i === "string" ? reg.get(i) : role && reg.get("npc_" + role);
  if (e) { try { const m = e.sheet; return { tex: await loadTex(e.file), cols: m.cols, rows: m.rows, size: [e.dimensions.w, e.dimensions.h], foot: (m.footPx || 0) / m.cell[1] * e.dimensions.h, frames: { idle: [0], walk: [0, 1, 0, 1], run: [2, 1, 2, 1] } }; } catch (err) { S.assets.failed.push({ id: e.id, error: String(err.message || err) }); } }
  if (typeof i === "string") i = 0;
  return { tex: await loadTex("tex/char_" + (i % 12 < 12 && i % 20 < 12 ? i % 20 : i % 12) + ".png"), cols: 4, rows: 4, size: [1.25, 1.875], foot: 0, frames: null };
}
function badge(kind) { if (badgeTex.has(kind)) return badgeTex.get(kind); const c = document.createElement("canvas"); c.width = c.height = 32; const x = c.getContext("2d"); const col = { working: "#3ddc84", blocked: "#ffb020", failed: "#ff4d4d", queued: "#9fb0d0" }[kind] || "#9fb0d0"; x.fillStyle = "#0e1322"; x.beginPath(); x.arc(16, 16, 14, 0, 7); x.fill(); x.fillStyle = col; x.beginPath(); x.arc(16, 16, 11, 0, 7); x.fill(); x.fillStyle = "#0e1322"; x.font = "bold 17px sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(kind === "working" ? "…" : kind === "blocked" ? "!" : kind === "failed" ? "✕" : "z", 16, 17); const t = new THREE.CanvasTexture(c); nearest(t); badgeTex.set(kind, t); return t; }
const shadowGeo = new THREE.CircleGeometry(0.34, 14).rotateX(-Math.PI / 2), shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false });
class Actor {
  constructor(info, o = {}) {
    const tex = info.tex; this.info = info; this.hgt = info.size[1] * (info.frames ? 0.78 : 1);
    this.id = o.id; this.name = o.name || ""; this.kind = o.kind || "npc"; this.tex = tex.clone(); this.tex.needsUpdate = true; this.tex.repeat.set(1 / info.cols, 1 / info.rows);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(info.size[0], info.size[1]).translate(0, info.size[1] / 2 - info.foot, 0), new THREE.MeshBasicMaterial({ map: this.tex, alphaTest: 0.5, side: THREE.DoubleSide, fog: true, color: new THREE.Color(lerp(1, 0.55, nightK), lerp(1, 0.62, nightK), lerp(1, 0.95, nightK)) }));
    this.sh = new THREE.Mesh(shadowGeo, shadowMat); this.sh.position.y = 0.03; this.mesh.userData.actor = this; this.root = new THREE.Group(); this.root.add(this.mesh); scene.add(this.root, this.sh);
    this.x = o.x || 0; this.z = o.z || 0; this.dir = 0; this.moving = false; this.t = Math.random() * 10; this.status = "idle"; this.home = { x: this.x, z: this.z }; this.target = null; this.wait = Math.random() * 3; this.run = false;
    this.badge = null; this.agent = null; this.house = null; this.setFrame(0, 0);
  }
  setStatus(s) { this.status = s; const kind = ["working", "blocked", "failed", "queued"].includes(s) ? s : null; if (kind) { if (!this.badge) { this.badge = new THREE.Sprite(new THREE.SpriteMaterial({ map: badge(kind), depthTest: true })); this.badge.scale.set(0.5, 0.5, 1); this.root.add(this.badge); } this.badge.material.map = badge(kind); this.badge.material.needsUpdate = true; } else if (this.badge) { this.root.remove(this.badge); this.badge = null; } }
  setFrame(dir, f) { this.tex.offset.set(f / this.info.cols, 1 - (dir + 1) / this.info.rows); }
  face(vx, vz) { const cr = Math.cos(yaw), sr = -Math.sin(yaw), fx = -Math.sin(yaw), fz = -Math.cos(yaw), sx = vx * cr + vz * sr, sy = vx * fx + vz * fz; this.dir = Math.abs(sx) > Math.abs(sy) ? (sx < 0 ? 1 : 2) : (sy < 0 ? 0 : 3); }
  step(dt, vx, vz) { // déplacement avec glissement le long des obstacles
    const nx = this.x + vx * dt, nz = this.z + vz * dt; let moved = false, h0 = heightAt(this.x, this.z);
    if (!blocked(nx, this.z) && Math.abs(heightAt(nx, this.z) - h0) < 0.45) { this.x = nx; moved = true; } h0 = heightAt(this.x, this.z); if (!blocked(this.x, nz) && Math.abs(heightAt(this.x, nz) - h0) < 0.45) { this.z = nz; moved = true; } this.moving = moved && (vx || vz); if (vx || vz) this.face(vx, vz); return moved;
  }
  update(dt, bob = true) {
    this.t += dt; const fr = this.info.frames, f = fr ? (this.moving ? (this.run ? fr.run : fr.walk)[Math.floor(this.t * (this.run ? 8 : 5)) % 4] : fr.idle[0]) : (this.moving ? [0, 1, 2, 3][Math.floor(this.t * (this.run ? 11 : 7)) % 4] : (Math.floor(this.t * 1.5) % 2 ? 2 : 0));
    this.setFrame(this.dir, f); const hy = heightAt(this.x, this.z); this.root.position.set(this.x, hy, this.z); this.mesh.rotation.y = yaw; this.sh.position.set(this.x, hy + 0.03, this.z); const sc = this.scale || 1; this.root.scale.setScalar(sc); this.sh.scale.setScalar(sc);
    if (this.badge) { this.badge.position.set(0, this.hgt + 0.42 + Math.sin(this.t * 3) * 0.06, 0); }
  }
  dispose() { scene.remove(this.root, this.sh); this.tex.dispose(); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}

// ---------------------------------------------------------------------------------------------- apparence du joueur (touche C) : feuilles du pack utilisateur ou tenue générée
const HEROES = ["hero_peter", "hero_red", "hero_gold", "hero_cynthia", "hero_pierre_rochard", 0]; let heroIdx = 0;
try { const w = Q.get("hero") || localStorage.getItem("w3d.hero"); const i = HEROES.findIndex((h) => h === w || (h === 0 && w === "generated")); if (i >= 0) heroIdx = i; } catch { /* stockage indisponible */ }
async function setHero(i) {
  heroIdx = (i + HEROES.length) % HEROES.length; try { localStorage.setItem("w3d.hero", HEROES[heroIdx] || "generated"); } catch { /* ignoré */ }
  const info = await sheet(HEROES[heroIdx]), old = player; player = new Actor(info, { id: "player", name: "Vous", kind: "player", x: old ? old.x : MAP.spawn.x, z: old ? old.z : MAP.spawn.y }); player.dir = old ? old.dir : 0; if (old) old.dispose(); applyTime(true);
}

// ---------------------------------------------------------------------------------------------- habitants décoratifs (aucun lien avec les agents)
async function spawnNpcs() {
  for (const d of MAP.npcs || []) {
    const ac = new Actor(await sheet(d.sheet), { id: "npc:" + d.id, name: d.name, kind: "npc", x: d.x ?? d.route[0][0], z: d.y ?? d.route[0][1] }); ac.scale = d.scale || 1; ac.npc = d; ac.status = "idle"; ac.home = { x: ac.x, z: ac.z };
    if (d.kind === "stand") { ac.fixed = true; ac.dir = d.dir ?? 0; } else if (d.kind === "route") { ac.route = d.route.map(([x, z]) => ({ x, z })); ac.ri = 0; ac.speed = d.speed || 1.3; ac.run = (d.speed || 0) > 2; } else { ac.radius = d.r || 3; ac.speed = 1.0; }
    npcs.push(ac); mouthOf.set(ac, 0);
  }
  S.npcs = npcs.length;
}
const mouthOf = new Map();

// ---------------------------------------------------------------------------------------------- jour / nuit (heure locale ; ?time=22 pour forcer, touche N pour alterner)
const DAY = { sky: new THREE.Color(0x8fcdf5), fog: new THREE.Color(0x9fd6f7), hemiS: new THREE.Color(0xeaf5ff), hemiG: new THREE.Color(0x8a9a6a), sun: new THREE.Color(0xfff1d6) }, NIGHT = { sky: new THREE.Color(0x0e1633), fog: new THREE.Color(0x141c3d), hemiS: new THREE.Color(0x6f86d8), hemiG: new THREE.Color(0x1d2a4a), sun: new THREE.Color(0x8fa6ff) };
const hemi = scene.children.find((o) => o.isHemisphereLight), sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function hourNow() { if (nightMode === "day") return 12; if (nightMode === "night") return 23; if (Q.get("time")) return +Q.get("time"); const d = new Date(); return d.getHours() + d.getMinutes() / 60; }
function applyTime(force) {
  const h = hourNow(), n = h < 6 ? 1 : h < 8 ? 1 - sm(6, 8, h) : h < 18 ? 0 : h < 20.5 ? sm(18, 20.5, h) : 1; if (!force && Math.abs(n - nightK) < 0.005) return; nightK = n;
  scene.background.copy(DAY.sky).lerp(NIGHT.sky, n); scene.fog.color.copy(DAY.fog).lerp(NIGHT.fog, n); hemi.color.copy(DAY.hemiS).lerp(NIGHT.hemiS, n); hemi.groundColor.copy(DAY.hemiG).lerp(NIGHT.hemiG, n); hemi.intensity = lerp(1.55, 1.15, n); sun.color.copy(DAY.sun).lerp(NIGHT.sun, n); sun.intensity = lerp(2.2, 0.8, n);
  for (const b of buildings) lightWindows(b);
  if (halos.pts) { halos.pts.material.opacity = Math.min(1, n * 1.6); halos.pts.visible = n > 0.05; }
  for (const a of actorList()) a.mesh.material.color.setRGB(lerp(1, 0.55, n), lerp(1, 0.62, n), lerp(1, 0.95, n));
}
function lightWindows(b) { b.group.traverse((o) => { if (o.isMesh && /^window/.test(o.material.name || "")) { o.material.emissiveMap = o.material.map; o.material.emissive.setScalar(nightK * 0.9); o.userData.base.copy(o.material.emissive); } }); }
function buildHalos() { // lueur additive au sommet de chaque lampadaire (visible la nuit)
  const c = document.createElement("canvas"); c.width = c.height = 64; const x = c.getContext("2d"), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, "rgba(255,240,170,1)"); gr.addColorStop(0.35, "rgba(255,210,110,.55)"); gr.addColorStop(1, "rgba(255,200,100,0)"); x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  const lamps = MAP.objects.filter((o) => o.asset === "lamp"), g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(lamps.flatMap((o) => [o.x, 2.7 + heightAt(o.x, o.y), o.y]), 3));
  halos.pts = new THREE.Points(g, new THREE.PointsMaterial({ map: new THREE.CanvasTexture(c), size: 4.2, sizeAttenuation: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, color: 0xfff0b0 })); halos.pts.frustumCulled = false; halos.pts.visible = false; scene.add(halos.pts);
}

// ---------------------------------------------------------------------------------------------- caméra & entrée
let yaw = +Q.get("yaw") || 0, yawT = yaw, dist = +Q.get("zoom") || 22, distT = dist; const ELEV = THREE.MathUtils.degToRad(+Q.get("pitch") || 52);
const camTarget = new THREE.Vector3(), keys = new Set(); let player = null, goal = null, drag = null;
function placeCamera() {
  const ce = Math.cos(ELEV), se = Math.sin(ELEV); camera.position.set(camTarget.x + Math.sin(yaw) * ce * dist, camTarget.y + se * dist, camTarget.z + Math.cos(yaw) * ce * dist); camera.lookAt(camTarget);
  sun.target.position.copy(camTarget); sun.position.set(camTarget.x - 22, camTarget.y + 34, camTarget.z + 16); const ext = clamp(dist * 0.85, 22, 60); Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext }); sun.shadow.camera.updateProjectionMatrix();
}
addEventListener("keydown", (e) => { if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return; const k = e.key.toLowerCase(); if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
  if (!$("ov").hidden && k !== "escape") return; if (mapOpen) { if (k === "m" || k === "escape") closeMap(); return; }
  if (k === "p") { $("perf").hidden = !$("perf").hidden; } else if (k === "m") openMap(); else if (k === "f") { S.followed = true; } else if (k === "c") { setHero(heroIdx + 1); } else if (k === "n") { nightMode = nightMode === "auto" || nightMode === "fix" ? "night" : nightMode === "night" ? "day" : "auto"; applyTime(true); } else if (k === "a") yawT -= Math.PI / 4; else if (k === "e") yawT += Math.PI / 4; else if (k === "escape") { if (!$("ov").hidden) closeConsole(); else select(null); } else { keys.add(k); S.followed = true; goal = null; } });
addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase())); addEventListener("blur", () => keys.clear());
canvas.addEventListener("wheel", (e) => { e.preventDefault(); distT = clamp(distT * Math.exp(e.deltaY * 0.0012), 9, 90); }, { passive: false });
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
const pts = new Map(); let pinch = 0;
canvas.addEventListener("pointerdown", (e) => { canvas.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false, btn: e.button }; if (pts.size === 2) pinch = 0; });
canvas.addEventListener("pointermove", (e) => {
  const p = pts.get(e.pointerId); if (!p) { hover(e.clientX, e.clientY); return; }
  const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
  if (pts.size === 2) { const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch) distT = clamp(distT * (pinch / d), 9, 90); pinch = d; if (drag) drag.moved = true; return; }
  if (!drag || drag.id !== e.pointerId) return; if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 6) drag.moved = true;
  if (drag.moved) { const k = (2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / innerHeight, sx = Math.cos(yaw), sz = -Math.sin(yaw), fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    camTarget.x = clamp(camTarget.x - (dx * sx - dy * fx / Math.sin(ELEV)) * k, 0, MAP.size.w); camTarget.z = clamp(camTarget.z - (dx * sz - dy * fz / Math.sin(ELEV)) * k, 0, MAP.size.h); S.followed = false; }
});
canvas.addEventListener("pointerup", (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = 0; if (drag && drag.id === e.pointerId) { if (!drag.moved && drag.btn === 0) click(e.clientX, e.clientY); drag = null; } });
canvas.addEventListener("pointercancel", (e) => { pts.delete(e.pointerId); drag = null; });
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function pick(cx, cy) {
  ndc.set((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera);
  const actors = [...actorList()].map((a) => a.mesh), ha = ray.intersectObjects(actors, false)[0], hb = ray.intersectObjects(buildings.map((b) => b.group), true)[0];
  if (ha && (!hb || ha.distance < hb.distance)) return { type: "actor", actor: ha.object.userData.actor };
  if (hb) { let o = hb.object; while (o && !(o.userData && o.userData.kind)) o = o.parent; if (o) return { type: "building", b: buildings.find((b) => b.group === o) }; }
  const gh = groundObj && ray.intersectObject(groundObj, false)[0], pt = gh ? gh.point : ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3()); return pt ? { type: "ground", pt } : null;
}
function click(x, y) { const h = pick(x, y); if (!h) return; if (h.type === "actor") { if (h.actor !== player) select({ type: "actor", actor: h.actor }); } else if (h.type === "building") select({ type: "building", b: h.b }); else { select(null); goal = { x: clamp(h.pt.x, 1, MAP.size.w - 1), z: clamp(h.pt.z, 1, MAP.size.h - 1) }; S.followed = true; } }
let hoverA = null;
function hover(x, y) { const h = pick(x, y); canvas.style.cursor = h && h.type !== "ground" ? "pointer" : "default"; hoverA = h && h.type === "actor" && h.actor !== player ? h.actor : null; }

// ---------------------------------------------------------------------------------------------- données (orchestrateur) & monde dynamique
const actors = new Map(), npcs = [], houseObjs = new Map(); const actorList = function* () { if (player) yield player; yield* actors.values(); yield* npcs; };
let lotsAssign = new Map(), wdata = null, adata = null, agentsById = new Map(), houseOfAgent = new Map();
const getJSON = async (p) => { const r = await fetch(API + p, { cache: "no-cache" }); if (!r.ok) throw new Error(p + " → HTTP " + r.status); return r.json(); };
function assignLots(houses, districts) {
  const dIndex = new Map(districts.map((d, i) => [d.name, i])), used = new Set(), res = new Map(), spill = [];
  for (const h of [...houses].sort((a, b) => (dIndex.get(a.district) - dIndex.get(b.district)) || a.y - b.y || a.x - b.x)) {
    const di = dIndex.get(h.district), i = MAP.lots.findIndex((l, k) => l.district === di && !used.has(k)); if (i >= 0) { used.add(i); res.set(h.key, i); } else spill.push(h);
  }
  for (const h of spill) { const i = MAP.lots.findIndex((l, k) => !used.has(k)); if (i >= 0) { used.add(i); res.set(h.key, i); } }
  S.spill = spill.length; return res;
}
async function applyWorld() {
  if (!wdata) return; lotsAssign = assignLots(wdata.houses, wdata.districts); houseOfAgent.clear();
  const seen = new Set();
  for (const h of wdata.houses) { const li = lotsAssign.get(h.key); if (li === undefined) continue; seen.add(h.key); const lot = MAP.lots[li]; for (const a of h.agentIds) houseOfAgent.set(a, h);
    let o = houseObjs.get(h.key);
    if (o && (o.lot !== li || o.style !== h.style % 6)) { removeBuilding(o.b); houseObjs.delete(h.key); o = null; }
    if (!o) { const b = await placeBuilding("house", h.key, "house_" + (h.style % 6), lot.x, lot.y, lot.rot, h); o = { b, lot: li, style: h.style % 6, data: h }; houseObjs.set(h.key, o); }
    o.data = h; o.b.info = h; }
  for (const [k, o] of [...houseObjs]) if (!seen.has(k)) { removeBuilding(o.b); houseObjs.delete(k); }
  S.houses = houseObjs.size;
}
const OUTFIT = [[/architect/, 13], [/back/, 15], [/front/, 18], [/devops/, 17], [/\bqa\b|test/, 14], [/visual|valid/, 12], [/pentest|secur|sécur/, 16], [/m[ée]decin|doc/, 19]];
function outfitFor(a) { const r = String(a.role || "").toLowerCase(); for (const [re, i] of OUTFIT) if (re.test(r)) return i; return 1 + (hashStr(a.id) % 7); }
const hq = () => buildings.find((b) => b.id === "hq");
function homeFor(a) {
  const h = houseOfAgent.get(a.id), o = h && houseObjs.get(h.key);
  if (o) { const n = h.agentIds.length, i = h.agentIds.indexOf(a.id), r = o.b.rot, off = (i - (n - 1) / 2) * 1.15; return { x: o.b.x + Math.sin(r) * 4.3 + Math.cos(r) * off, z: o.b.z + Math.cos(r) * 4.3 - Math.sin(r) * off, house: h }; }
  const q = hq() || { x: MAP.spawn.x, z: MAP.spawn.y - 18 }, i = [...agentsById.keys()].indexOf(a.id); return { x: q.x + ((i % 6) - 2.5) * 1.3, z: q.z + 6.2 + Math.floor(i / 6) * 1.2, house: null };
}
async function applyAgents() {
  if (!adata) return; const list = (adata.agents || []).filter((a) => !a.internal); agentsById = new Map(list.map((a) => [a.id, a]));
  for (const a of list) {
    let ac = actors.get(a.id); if (!ac) { ac = new Actor(await sheet(outfitFor(a)), { id: a.id, name: a.name, kind: "agent" }); const hm = homeFor(a); ac.x = hm.x; ac.z = hm.z; actors.set(a.id, ac); }
    const hm = homeFor(a); ac.home = hm; ac.house = hm.house; ac.agent = a; ac.name = a.name; ac.setStatus(a.status);
  }
  for (const [id, ac] of [...actors]) if (!agentsById.has(id)) { ac.dispose(); actors.delete(id); }
  S.agents = actors.size;
}
async function poll() {
  try { const [w, a] = await Promise.all([getJSON("/api/world"), getJSON("/api/agents")]); wdata = w; adata = a; S.data = { ok: true, error: null, at: Date.now() }; await applyWorld(); await applyAgents(); }
  catch (e) { S.data = { ok: false, error: String(e.message || e), at: S.data.at }; }
  refreshHud(); const ae = document.activeElement; if (S.sel && !(ae && $("p-body").contains(ae) && /INPUT|TEXTAREA|SELECT/.test(ae.tagName))) renderPanel();
}
async function pollSlow() { for (const [k, p] of [["roles", "/api/roles"], ["hosts", "/api/hosts"], ["skills", "/api/skills"], ["reviews", "/api/reviews?limit=5"]]) { try { S.extra[k] = await getJSON(p); } catch { S.extra[k] = null; } } if (S.sel) renderPanel(); }

// ---------------------------------------------------------------------------------------------- panneau & étiquettes
const STATUS_COL = { working: "#3ddc84", blocked: "#ffb020", failed: "#ff4d4d", idle: "#9fb0d0", queued: "#9fb0d0", done: "#6aa9ff" }, STATUS_FR = { working: "au travail", blocked: "bloqué", failed: "en échec", idle: "au repos", queued: "en file", done: "terminé" };
function openConsole(path, title) { $("ovt").textContent = title; $("ovi").src = path; $("ov").hidden = false; keys.clear(); }
function closeConsole() { $("ov").hidden = true; $("ovi").src = "about:blank"; }
$("ovx").onclick = closeConsole; $("p-x").onclick = () => select(null);
function select(s) { if (S.sel && S.sel.type === "building") highlight(S.sel.b, false); S.sel = s; if (s && s.type === "building") highlight(s.b, true); $("panel").hidden = !s; if (s) renderPanel(); }
const dot = (s) => `<span class="dot" style="background:${STATUS_COL[s] || "#9fb0d0"}"></span>`;
const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "à l'instant" : m < 60 ? "il y a " + m + " min" : m < 1440 ? "il y a " + Math.round(m / 60) + " h" : "il y a " + Math.round(m / 1440) + " j"; };
const agentRow = (a, manage) => `<div class="row">${dot(a.status)}<div class="meta"><b>${esc(a.name)}</b><small>${esc(STATUS_FR[a.status] || a.status)}${a.role ? " · " + esc(a.role) : ""}${a.intent ? " — " + esc(String(a.intent).replace(/\s+/g, " ").slice(0, 70)) : ""}</small></div><button class="btn" data-open="${esc(a.id)}">Parler</button>${manage ? `<button class="btn ghost" data-close="${esc(a.id)}" title="Fermer la session (réouvrable)">Fermer</button>` : ""}</div>`;
const npcLine = {}; let formOpen = false, notice = null, draft = { name: "", role: "", prompt: "", worktree: false }, noticeT = 0;
async function post(path, body) { const r = await fetch(API + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok || j.ok === false) throw new Error(j.error || "HTTP " + r.status); return j; }
function say(msg, err) { notice = { msg, err }; clearTimeout(noticeT); noticeT = setTimeout(() => { notice = null; if (S.sel) renderPanel(); }, 6000); }
function wireForm(body) {
  const keep = () => { const g = (id) => body.querySelector(id); if (g("#f-name")) draft = { name: g("#f-name").value, role: g("#f-role").value, prompt: g("#f-prompt").value, worktree: g("#f-wt").checked }; };
  body.querySelectorAll("#f-name,#f-role,#f-prompt,#f-wt").forEach((el) => el.addEventListener("input", keep));
  const open = body.querySelector("#f-open"); if (open) open.onclick = () => { formOpen = true; renderPanel(); const n = $("p-body").querySelector("#f-prompt"); if (n) n.focus(); };
  const x = body.querySelector("#f-x"); if (x) x.onclick = () => { formOpen = false; renderPanel(); };
  const go = body.querySelector("#f-go"); if (go) go.onclick = async () => {
    keep(); const h = S.sel && S.sel.b && S.sel.b.info; if (!h) return; if (!draft.prompt.trim()) { say("Écris la mission de l'agent.", true); renderPanel(); return; }
    const peer = h.agentIds.map((id) => agentsById.get(id)).find((a) => a && a.host && a.host !== "local"); go.disabled = true;
    try { await post("/api/spawn", { cwd: h.key, name: draft.name.trim() || undefined, role: draft.role || undefined, prompt: draft.prompt.trim(), host: peer ? peer.host : undefined, worktree: draft.worktree }); formOpen = false; draft = { name: "", role: "", prompt: "", worktree: false }; say("Agent créé : il arrive devant la maison."); await poll(); }
    catch (e) { say("Création impossible : " + e.message, true); renderPanel(); }
  };
  body.querySelectorAll("[data-close]").forEach((b) => (b.onclick = async () => { const a = agentsById.get(b.dataset.close); if (a && a.status === "working" && !confirm("Cet agent travaille : l'interrompre et fermer sa session ?")) return; try { await post("/api/world/close", { id: b.dataset.close }); say("Session fermée — elle reste dans « Sessions fermées »."); await poll(); } catch (e) { say("Fermeture impossible : " + e.message, true); renderPanel(); } }));
  body.querySelectorAll("[data-reopen]").forEach((b) => (b.onclick = async () => { try { await post("/api/world/reopen", { id: b.dataset.reopen }); say("Session rouverte."); await poll(); } catch (e) { say("Réouverture impossible : " + e.message, true); renderPanel(); } }));
}
function renderPanel() {
  const s = S.sel; if (!s) return; const body = $("p-body"); let html = "";
  if (!S.data.ok) html += `<div class="warn">Orchestrateur injoignable${S.data.error ? " (" + esc(S.data.error) + ")" : ""} — données non connectées.</div>`;
  if (s.type === "building" && s.b.kind === "house") {
    const h = s.b.info, ags = h.agentIds.map((id) => agentsById.get(id)).filter(Boolean); $("p-title").textContent = h.name;
    html += `<div class="kv"><span>Quartier</span><span>${esc(h.district)}</span><span>Agents</span><span>${ags.length}</span><span>Au travail</span><span>${h.working}</span><span>Bloqués</span><span>${h.blocked}</span><span>En échec</span><span>${h.failed}</span></div>`;
    if (notice) html += `<div class="${notice.err ? "warn" : "okb"}">${esc(notice.msg)}</div>`;
    html += `<h4>Dossier</h4><div style="word-break:break-all;color:#5b6682">${esc(h.key)}</div><h4>Agents</h4>` + (ags.length ? ags.map((a) => agentRow(a, true)).join("") : `<div class="off">Aucun agent ouvert dans cette maison.</div>`);
    const cl = h.closed || []; if (cl.length) html += `<h4>Sessions fermées</h4>` + cl.map((c) => `<div class="row"><span class="dot" style="background:#6b7488"></span><div class="meta"><b>${esc(c.name)}</b><small>fermée ${esc(ago(c.closedAt))}${c.role ? " · " + esc(c.role) : ""}</small></div><button class="btn" data-reopen="${esc(c.id)}">Rouvrir</button></div>`).join("");
    const roles = (S.extra.roles && S.extra.roles.roles) || [];
    html += `<h4>Nouvel agent</h4>` + (formOpen ? `<div class="form"><input id="f-name" placeholder="Nom (facultatif)" maxlength="60" value="${esc(draft.name)}"><select id="f-role"><option value="">Rôle : aucun</option>${roles.map((r) => `<option ${draft.role === r ? "selected" : ""}>${esc(r)}</option>`).join("")}</select><textarea id="f-prompt" rows="4" placeholder="Mission : que doit faire cet agent ?">${esc(draft.prompt)}</textarea><label class="chk"><input type="checkbox" id="f-wt" ${draft.worktree ? "checked" : ""}> branche git isolée (worktree)</label><div class="acts"><button class="btn" id="f-go">Créer l'agent</button><button class="btn ghost" id="f-x">Annuler</button></div></div>` : `<button class="btn" id="f-open">+ Créer un agent dans cette maison</button>`);
  } else if (s.type === "building") {
    const z = MAP.zones.find((q) => q.id === s.b.id); $("p-title").textContent = z.label; html += `<p>${esc(z.blurb)}</p>` + zoneBody(z) + `<h4>Console</h4><button class="btn" data-view="${z.view}">Ouvrir « ${esc(viewName(z.view))} »</button>` + (z.view2 ? ` <button class="btn" data-view="${z.view2}">Ouvrir « ${esc(viewName(z.view2))} »</button>` : "");
  } else if (s.type === "actor" && s.actor.npc) {
    const d = s.actor.npc; $("p-title").textContent = d.name; html += `<div class="warn">Habitant décoratif : il ne représente aucun agent ni aucune donnée.</div><p>« ${esc(d.lines[(npcLine[d.id] = ((npcLine[d.id] ?? -1) + 1) % d.lines.length)])} »</p><small style="color:#5b6682">Cliquez de nouveau pour qu'il continue à parler.</small>`;
  } else if (s.type === "actor") {
    const a = s.actor.agent; $("p-title").textContent = s.actor.name; html += a ? agentRow(a) + (s.actor.house ? `<h4>Maison</h4><div>${esc(s.actor.house.name)}</div>` : `<h4>Maison</h4><div class="off">dossier sans maison — rassemblé au Quartier général</div>`) : "";
  }
  body.innerHTML = html;
  body.querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => openConsole("/lite?embed=1&select=" + encodeURIComponent(b.dataset.open), "Agent")));
  wireForm(body);
  body.querySelectorAll("[data-view]").forEach((b) => (b.onclick = () => openConsole("/lite?embed=1&view=" + b.dataset.view, viewName(b.dataset.view))));
}
const viewName = (v) => ({ board: "Tableau de bord", teams: "Équipes", jobs: "Métiers", reviews: "Évaluations", machines: "Machines", skills: "Skills" }[v] || v);
const na = `<span class="off">non connecté</span>`;
function zoneBody(z) {
  const A = adata, c = A && A.byStatus, X = S.extra;
  if (z.id === "hq") return A ? `<h4>Flotte</h4><div class="kv"><span>Agents</span><span>${(A.agents || []).filter((a) => !a.internal).length}</span><span>Au travail</span><span>${c ? c.working : 0}</span><span>Bloqués</span><span>${c ? c.blocked : 0}</span><span>En échec</span><span>${c ? c.failed : 0}</span><span>Maisons (projets)</span><span>${S.houses}</span></div>` : na;
  if (z.id === "ai_lab") return `<h4>Savoir-faire</h4><div class="kv"><span>Métiers</span><span>${X.roles ? (X.roles.roles || []).length : na}</span><span>Skills (bibliothèque)</span><span>${X.skills ? (X.skills.total ?? "?") : na}</span></div>` + (X.roles ? `<div style="margin-top:6px;color:#5b6682">${(X.roles.roles || []).map(esc).join(" · ")}</div>` : "");
  if (z.id === "ops_center") { const h = X.hosts && X.hosts.hosts; return `<h4>Machines</h4>` + (h ? `<div class="kv"><span>Nœuds en ligne</span><span>${h.filter((x) => x.online).length} / ${h.length}</span></div>` + h.slice(0, 14).map((x) => `<div class="row">${dot(x.online ? "working" : "failed")}<div class="meta"><b>${esc(x.label || x.id)}</b><small>${esc(x.ip || "")}</small></div></div>`).join("") : na); }
  if (z.id === "dev_workshop") return `<h4>Équipes</h4>` + (A ? `<div class="kv"><span>Équipes actives</span><span>${(A.teams || []).length}</span></div>` + (A.teams || []).slice(0, 8).map((t) => `<div class="row"><div class="meta"><b>${esc(t.name || t.id)}</b><small>${esc(String(t.goal || "").slice(0, 80))}</small></div></div>`).join("") : na);
  if (z.id === "supervision") { const bad = A ? (A.agents || []).filter((a) => !a.internal && (a.status === "blocked" || a.status === "failed")) : null; return `<h4>À surveiller</h4>` + (bad ? (bad.length ? bad.map(agentRow).join("") : `<div class="off">Rien à signaler : aucun agent bloqué ou en échec.</div>`) : na) + `<h4>Évaluations</h4>` + (X.reviews ? `<div class="kv"><span>Évaluations enregistrées</span><span>${(X.reviews.reviews || X.reviews.items || []).length}</span></div>` : na); }
  return "";
}
const labels = new Map(); const lbRoot = $("labels");
function label(key, cls) { let l = labels.get(key); if (!l) { l = document.createElement("div"); l.className = "lb " + (cls || ""); lbRoot.appendChild(l); labels.set(key, l); } l.dataset.used = "1"; return l; }
const v3 = new THREE.Vector3();
function place(l, x, y, z) { v3.set(x, y, z).project(camera); const vis = v3.z < 1 && Math.abs(v3.x) < 1.15 && v3.y > -1.1 && v3.y < 1.2; l.style.display = vis ? "" : "none"; if (vis) { l.style.left = ((v3.x + 1) / 2) * innerWidth + "px"; l.style.top = ((1 - v3.y) / 2) * innerHeight + "px"; } }
function counters(w, b, f) { return (w ? `<span class="c"><i class="d" style="background:${STATUS_COL.working}"></i>${w}</span>` : "") + (b ? `<span class="c"><i class="d" style="background:${STATUS_COL.blocked}"></i>${b}</span>` : "") + (f ? `<span class="c"><i class="d" style="background:${STATUS_COL.failed}"></i>${f}</span>` : ""); }
function updateLabels() {
  for (const l of labels.values()) l.dataset.used = "";
  for (const b of buildings) { const sel = S.sel && S.sel.type === "building" && S.sel.b === b; let name, extra = "";
    if (b.kind === "house") { name = b.info.name; extra = counters(b.info.working, b.info.blocked, b.info.failed); } else { const z = MAP.zones.find((q) => q.id === b.id); name = z.label; if (b.id === "supervision" && adata && adata.byStatus) extra = counters(0, adata.byStatus.blocked, adata.byStatus.failed); if (b.id === "hq" && adata && adata.byStatus) extra = counters(adata.byStatus.working, 0, 0); }
    const l = label(b.kind + b.id); const html = `<span class="n">${esc(name)}</span>${extra}`; if (l.dataset.h !== html) { l.innerHTML = html; l.dataset.h = html; l.title = name; } l.classList.toggle("sel", !!sel);
    place(l, b.x, b.height + 0.6, b.z + (b.kind === "house" ? 0 : 0)); }
  if (wdata) wdata.districts.forEach((d, i) => { const ls = MAP.lots.filter((l) => l.district === i); if (!ls.length || !wdata.houses.some((h) => h.district === d.name && lotsAssign.has(h.key) && MAP.lots[lotsAssign.get(h.key)].district === i)) return; const cx = ls.reduce((s, l) => s + l.x, 0) / ls.length, cz = Math.min(...ls.map((l) => l.y)) - 3.4; const l = label("d" + i, "dist"); if (l.dataset.h !== d.name) { l.textContent = d.name; l.dataset.h = d.name; } place(l, cx, 0.2, cz); });
  const showA = new Set([hoverA, S.sel && S.sel.type === "actor" ? S.sel.actor : null].filter(Boolean)); for (const a of showA) { const l = label("a" + a.id, "ag"); const t = a.name + (a.agent ? " · " + (STATUS_FR[a.agent.status] || a.agent.status) : a.npc ? " · décor" : ""); if (l.dataset.h !== t) { l.textContent = t; l.dataset.h = t; } place(l, a.x, (a.hgt + 0.7) * (a.scale || 1) + heightAt(a.x, a.z), a.z); }
  for (const [k, l] of [...labels]) if (!l.dataset.used) { l.remove(); labels.delete(k); }
}
function refreshHud() {
  const A = S.assets, bad = A.failed.length || A.fallbacks; const a = $("assets"); a.className = bad ? "bad" : "";
  a.textContent = `assets ${A.loaded}/${A.total} chargés${A.fallbacks ? " · " + A.fallbacks + " de secours" : ""} · ${S.houses} maisons · ${S.agents} agents${S.npcs ? " · " + S.npcs + " habitants (décor)" : ""}` + (S.spill ? ` · ${S.spill} hors quartier` : "") + (S.data.ok ? "" : ` · données : ${S.data.error ? "indisponibles" : "…"}`);
  if (A.failed.length) a.title = A.failed.map((f) => f.id + ": " + f.error).join("\n");
}

// ---------------------------------------------------------------------------------------------- carte (touche M)
let mapOpen = false, mapScale = 1, mapHit = [];
function openMap() { if (!S.ready) return; mapOpen = true; keys.clear(); goal = null; $("map").hidden = false; drawMap(); }
function closeMap() { mapOpen = false; $("map").hidden = true; $("maptip").style.display = "none"; }
function drawMap() {
  const cv = $("mapc"), W = MAP.size.w, H = MAP.size.h; mapScale = Math.max(4, Math.floor(Math.min((innerWidth * 0.92) / W, (innerHeight * 0.8) / H))); cv.width = W * mapScale; cv.height = H * mapScale; const g = cv.getContext("2d"), k = mapScale;
  const col = { g: "#5fae45", c: "#a8997f", p: "#d9d2c0", d: "#c9a46a", w: "#3f86d8", t: "#3f8a35", b: "#a0724a" }; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { g.fillStyle = col[rows[y][x]] || "#5fae45"; g.fillRect(x * k, y * k, k, k); }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (levelGrid[y][x] || rampAt(x + .5, y + .5)) { g.fillStyle = rampAt(x + .5, y + .5) ? "rgba(120,90,50,.55)" : "rgba(255,255,255,.28)"; g.fillRect(x * k, y * k, k, k); }
  g.fillStyle = "#2f7d3c"; for (const o of MAP.objects) if (o.asset.startsWith("tree")) g.fillRect((o.x - 0.4) * k, (o.y - 0.4) * k, k * 0.8, k * 0.8);
  mapHit = []; g.textAlign = "center"; g.font = "600 " + Math.max(10, k * 1.5) + "px Geist,sans-serif";
  for (const b of buildings) { const e = reg.get(b.asset), w = (e.collision ? e.collision.w : e.dimensions.w), d = (e.collision ? e.collision.d : e.dimensions.d), cx = b.x + ((e.collision && e.collision.cx) || 0);
    const st = b.kind === "house" ? (b.info.failed ? "failed" : b.info.blocked ? "blocked" : b.info.working ? "working" : "idle") : "zone"; g.fillStyle = b.kind === "zone" ? "#2c3a56" : "#7d8aa6"; g.fillRect((cx - w / 2) * k, (b.z - d / 2) * k, w * k, d * k);
    g.fillStyle = STATUS_COL[st] || "#ffd24a"; g.fillRect((cx - w / 2) * k + 2, (b.z - d / 2) * k + 2, Math.max(6, k * 1.2), Math.max(6, k * 1.2));
    const name = b.kind === "house" ? b.info.name : MAP.zones.find((z) => z.id === b.id).label; if (b.kind === "zone") { g.fillStyle = "#fff"; g.fillText(name, b.x * k, (b.z + 0.4) * k); }
    mapHit.push({ b, name, x0: (cx - w / 2) * k, y0: (b.z - d / 2) * k, x1: (cx + w / 2) * k, y1: (b.z + d / 2) * k }); }
  if (player) { g.fillStyle = "#ff3d6e"; g.strokeStyle = "#fff"; g.lineWidth = 2; g.beginPath(); g.arc(player.x * k, player.z * k, Math.max(4, k * 0.9), 0, 7); g.fill(); g.stroke(); }
}
$("mapbtn").onclick = () => (mapOpen ? closeMap() : openMap()); $("mapx").onclick = closeMap; $("map").addEventListener("pointerdown", (e) => { if (e.target === $("map")) closeMap(); });
$("mapc").addEventListener("pointermove", (e) => { const r = $("mapc").getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, h = mapHit.find((q) => x >= q.x0 && x <= q.x1 && y >= q.y0 && y <= q.y1), t = $("maptip"); if (h) { t.textContent = h.name; t.style.display = "block"; t.style.left = x + 12 + "px"; t.style.top = y + 40 + "px"; } else t.style.display = "none"; });
$("mapc").addEventListener("click", (e) => {
  const r = $("mapc").getBoundingClientRect(), px = (e.clientX - r.left) * ($("mapc").width / r.width), py = (e.clientY - r.top) * ($("mapc").height / r.height), h = mapHit.find((q) => px >= q.x0 && px <= q.x1 && py >= q.y0 && py <= q.y1);
  let tx = px / mapScale, tz = py / mapScale; if (h) { tx = h.b.x; tz = h.b.z + (reg.get(h.b.asset).collision ? reg.get(h.b.asset).collision.d / 2 + 1.3 : 4); }
  for (let rr = 0; rr < 8 && blocked(tx, tz, 0.3); rr += 0.5) { tz += 0.5; } // pose le joueur sur une case libre devant la cible
  player.x = clamp(tx, 1, MAP.size.w - 1); player.z = clamp(tz, 1, MAP.size.h - 1); camTarget.set(player.x, heightAt(player.x, player.z), player.z); S.followed = true; closeMap(); if (h) select({ type: "building", b: h.b });
});

// ---------------------------------------------------------------------------------------------- boucle
let last = performance.now(), fadeT = 0, perfT = 0, frames = 0; const raycaster2 = new THREE.Raycaster();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now; frames++;
  yaw = lerp(yaw, yawT, 1 - Math.exp(-dt * 8)); dist = lerp(dist, distT, 1 - Math.exp(-dt * 8));
  if (player && !mapOpen) {
    let ix = (keys.has("d") || keys.has("arrowright") ? 1 : 0) - (keys.has("q") || keys.has("arrowleft") ? 1 : 0), iz = (keys.has("s") || keys.has("arrowdown") ? 1 : 0) - (keys.has("z") || keys.has("arrowup") ? 1 : 0), run = keys.has("shift");
    let vx = 0, vz = 0; const sp = run ? 6.4 : 3.3;
    if (ix || iz) { const l = Math.hypot(ix, iz); ix /= l; iz /= l; vx = (ix * Math.cos(yawT) + iz * Math.sin(yawT)) * sp; vz = (-ix * Math.sin(yawT) + iz * Math.cos(yawT)) * sp; goal = null; }
    else if (goal) { const dx = goal.x - player.x, dz = goal.z - player.z, d = Math.hypot(dx, dz); if (d < 0.2) goal = null; else { vx = (dx / d) * 4; vz = (dz / d) * 4; } }
    player.run = run; if (!(player.step(dt, vx, vz)) && goal) goal = null; if (!vx && !vz) player.moving = false; player.update(dt);
  }
  // PNJ/agents : errent autour de leur maison quand ils travaillent, restent en place sinon
  for (const ac of [...actors.values(), ...npcs]) {
    const st = ac.status; if (!ac.npc) ac.run = false;
    if (ac.fixed) { ac.moving = false; ac.update(dt); continue; }
    if (ac.route && !ac.target) { ac.ri = (ac.ri + 1) % ac.route.length; ac.target = ac.route[ac.ri]; }
    if (ac.target) { const dx = ac.target.x - ac.x, dz = ac.target.z - ac.z, d = Math.hypot(dx, dz), sp = ac.speed || 1.25; if (d < 0.2) { ac.target = null; ac.moving = false; ac.wait = ac.route ? 0.1 : 1.5 + Math.random() * 3; } else { const mv = ac.step(dt, (dx / d) * sp, (dz / d) * sp); if (!mv) { ac.target = null; ac.moving = false; ac.wait = 0.5; } } }
    else { ac.moving = false; ac.wait -= dt; if (ac.wait <= 0) { const active = st === "working" || (st === "idle" && Math.random() < 0.35) || ac.radius; if (active) { for (let k = 0; k < 6; k++) { const R = ac.radius, t = R ? { x: ac.home.x + (Math.random() - 0.5) * 2 * R, z: ac.home.z + (Math.random() - 0.5) * 2 * R } : { x: ac.home.x + (Math.random() - 0.5) * 2.4, z: ac.home.z + (Math.random() - 0.5) * 1.2 }; if (!blocked(t.x, t.z, 0.35)) { ac.target = t; break; } } } ac.wait = 1.5 + Math.random() * 3; if (!ac.target && (st === "blocked" || st === "failed")) ac.dir = 0; } }
    ac.update(dt);
  }
  if (S.followed && player) { camTarget.x = lerp(camTarget.x, player.x, 1 - Math.exp(-dt * 6)); camTarget.z = lerp(camTarget.z, player.z, 1 - Math.exp(-dt * 6)); }
  camTarget.y = lerp(camTarget.y, S.followed && player ? heightAt(player.x, player.z) : camTarget.y, 1 - Math.exp(-dt * 4));
  for (const sp of spinners) sp.node.rotation.z -= sp.speed * dt; if (waterTex) waterTex.offset.x = (Math.floor(now / 550) % 2) * (3 / NT); if (now - (loop.t || 0) > 4000) { loop.t = now; applyTime(); }
  placeCamera();
  // bâtiments estompés quand ils masquent le joueur (rayon caméra → joueur)
  fadeT -= dt; if (fadeT <= 0 && player) { fadeT = 0.12; const head = new THREE.Vector3(player.x, heightAt(player.x, player.z) + 0.9, player.z), dir = head.clone().sub(camera.position), len = dir.length(); raycaster2.set(camera.position, dir.normalize()); raycaster2.far = len - 0.2;
    const hit = new Set(); for (const h of raycaster2.intersectObjects(buildings.map((b) => b.group), true)) { let o = h.object; while (o && !(o.userData && o.userData.kind)) o = o.parent; if (o) hit.add(o); } for (const b of buildings) b.fadeT = hit.has(b.group) ? 0.28 : 1; }
  for (const b of buildings) { const t = b.fadeT ?? 1; if (Math.abs(b.fade - t) > 0.01) { b.fade = lerp(b.fade, t, 1 - Math.exp(-dt * 10)); b.group.traverse((o) => { if (o.isMesh) { o.material.transparent = b.fade < 0.99; o.material.opacity = b.fade; o.castShadow = b.fade > 0.9; } }); } }
  renderer.render(scene, camera); updateLabels();
  perfT += dt; if (perfT > 0.5) { S.fps = Math.round(frames / perfT); frames = 0; perfT = 0; const i = renderer.info; $("perf").textContent = `${S.fps} fps · ${i.render.calls} draw calls · ${(i.render.triangles / 1000).toFixed(1)}k tris · ${i.memory.geometries} géom · ${i.memory.textures} tex · ${instStats.instances} instances / ${instStats.meshes} blocs · mode ${RES > 1 ? "basse résolution ×" + RES : "natif"}`; if (Q.get("dbg")) { $("dbg").hidden = false; $("dbg").style.display = "block"; $("dbg").textContent = JSON.stringify(dbgState()); } }
  requestAnimationFrame(loop);
}
const dbgState = () => ({ ready: S.ready, map: mapOpen, player: player && { h: +heightAt(player.x, player.z).toFixed(2), x: +player.x.toFixed(2), z: +player.z.toFixed(2), dir: player.dir, moving: player.moving }, cam: { yaw: +yaw.toFixed(2), dist: +dist.toFixed(1), x: +camTarget.x.toFixed(1), z: +camTarget.z.toFixed(1) }, assets: { total: S.assets.total, loaded: S.assets.loaded, failed: S.assets.failed, fallbacks: S.assets.fallbacks }, houses: S.houses, agents: S.agents, npcs: S.npcs, cliffs: cliffCount, spill: S.spill, data: S.data, sel: S.sel && (S.sel.type + ":" + (S.sel.b ? S.sel.b.id : S.sel.actor.id)), fps: S.fps, buildings: buildings.length, colliders: colliders.length, calls: renderer.info.render.calls, tris: renderer.info.render.triangles, instances: instStats, followed: S.followed });

// ---------------------------------------------------------------------------------------------- démarrage
(async () => {
  try {
    const r = await (await fetch(BASE + "registry.json", { cache: "no-cache" })).json(); for (const a of r.assets) reg.set(a.id, a);
    MAP = await (await fetch(BASE + "maps/pilot.json", { cache: "no-cache" })).json(); rows = MAP.rows;
    buildRelief(); cliffMat = new THREE.MeshLambertMaterial({ map: await cliffTex(), side: THREE.DoubleSide }); const atlas = await loadTex("tex/ground.png"); const gm = groundMesh(atlas); groundObj = gm.children[0]; scene.add(gm); const nk = await kerbs();
    // décor de la carte (arbres, buissons, fleurs, mobilier) + forêt de bordure
    const rnd = ((s) => () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296))(7), border = [];
    for (let i = 0; i < 520; i++) { const side = i % 4, t = rnd(), d = 1 + rnd() * 28, W = MAP.size.w, H = MAP.size.h; const x = side === 0 ? -d : side === 1 ? W + d : t * (W + 60) - 30, z = side === 2 ? -d : side === 3 ? H + d : t * (H + 60) - 30; border.push({ asset: ["tree_pine", "tree_round", "tree_pine", "tree_autumn"][(rnd() * 4) | 0], x, y: z, rot: rnd() * 6.28 }); }
    await instanced(MAP.objects, "decor"); await instanced(border, "border");
    for (const z of MAP.zones) await placeBuilding("zone", z.id, z.asset, z.x, z.y, z.rot, z);
    for (const a of MAP.animated || []) { const pr = await loadModel(a.asset), inner = pr.clone(true), P = new THREE.Group(); P.add(inner); P.position.set(a.x, a.h + heightAt(a.x, a.y), a.y); P.rotation.y = a.rot || 0; scene.add(P); spinners.push({ node: inner, speed: a.speed || 0.5 }); }
    buildHalos(); applyTime(true);
    // joueur
    await setHero(heroIdx); if (Q.get("px")) { player.x = +Q.get("px"); player.z = +Q.get("pz") || MAP.spawn.y; }
    camTarget.set(player.x, heightAt(player.x, player.z), player.z);
    await spawnNpcs(); S.ready = true; refreshHud(); $("boot").classList.add("done"); requestAnimationFrame(loop);
    poll().then(() => { const sel = Q.get("select"); if (sel) { const b = buildings.find((x) => x.id === sel || x.group.name === sel); if (b) select({ type: "building", b }); } }); setInterval(poll, 4000); pollSlow(); setInterval(pollSlow, 30000);
    if (Q.get("select")) { const b = buildings.find((x) => x.id === Q.get("select")); if (b) select({ type: "building", b }); }
    console.info("[world3d] prêt", { kerbs: nk, assets: S.assets.total });
  } catch (e) { console.error(e); bootErr("Échec du démarrage : " + (e && e.message || e)); $("boot-t").textContent = "Erreur de chargement"; }
})();
window.__w3d = { S, THREE, scene, camera, renderer, state: dbgState, select, get player() { return player; }, buildings, actors, reg, tp: (x, z) => { player.x = x; player.z = z; camTarget.set(x, 0, z); }, setZoom: (d) => { dist = distT = d; }, setYaw: (y) => { yaw = yawT = y; }, click: (x, y) => click(x, y), projectBuilding: (id) => { const b = buildings.find((q) => q.id === id); v3.set(b.x, 1.5, b.z).project(camera); return { x: ((v3.x + 1) / 2) * innerWidth, y: ((1 - v3.y) / 2) * innerHeight }; } };
