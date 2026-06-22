import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

// ===========================================================================
//  Constantes
// ===========================================================================

const ROOMS = {
  office:    { label: "BUREAU",    sub: "tête dans le guidon", color: 0x36f0ff },
  coworking: { label: "COWORKING", sub: "ils collaborent",      color: 0xb15bff },
  gym:       { label: "GYM",       sub: "repos & skills",        color: 0x4df0a0 },
};
// couleurs alignées sur la légende du cahier des charges :
// vert=travaille · orange=attente · bleu=révision/repos · rouge=erreur · violet=collaboration
const STATUS = {
  working:   { color: 0x57d977, label: "au travail", emoji: "💻", css: "s-working" },
  coworking: { color: 0xa779f0, label: "collabore",  emoji: "🤝", css: "s-coworking" },
  done:      { color: 0x4fd1c5, label: "terminé",    emoji: "✅", css: "s-done" },
  idle:      { color: 0x5b8cff, label: "au repos",   emoji: "🧘", css: "s-idle" },
  queued:    { color: 0x5b8cff, label: "en attente", emoji: "⏳", css: "s-queued" },
  blocked:   { color: 0xf6ad55, label: "attente",    emoji: "🙋", css: "s-blocked" },
  failed:    { color: 0xfc5d5d, label: "erreur",     emoji: "⚠️", css: "s-failed" },
};
function fmtTokens(n) { n = n || 0; if (n >= 1e6) return (n / 1e6).toFixed(1) + "M"; if (n >= 1e3) return (n / 1e3).toFixed(0) + "k"; return "" + n; }
function fmtCost(n) { n = n || 0; return n >= 1 ? "$" + n.toFixed(0) : "$" + n.toFixed(2); }
const ROLE_PALETTE = [0x6aa3ff, 0xb78bff, 0x4fd1c5, 0xf6ad55, 0xf786c2, 0x63d471, 0xffd35c, 0xff7e7e];
function hashColor(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return ROLE_PALETTE[h % ROLE_PALETTE.length]; }
function hashInt(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
function hexCss(n) { return "#" + n.toString(16).padStart(6, "0"); }
function statusOf(a) { return STATUS[a.status] || STATUS.idle; }

// ===========================================================================
//  Renderer / scène / caméra / post-processing
// ===========================================================================

const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.94;

const scene = new THREE.Scene();
// CYBERPUNK : nuit synthwave — dégradé indigo profond -> lueur magenta sur l'horizon bas
const bgTex = (() => {
  const cv = document.createElement("canvas"); cv.width = 16; cv.height = 256; const c = cv.getContext("2d");
  const g = c.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, "#04030a"); g.addColorStop(0.55, "#0d0a20"); g.addColorStop(0.82, "#2a1146"); g.addColorStop(1, "#591a52");
  c.fillStyle = g; c.fillRect(0, 0, 16, 256);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
scene.background = bgTex;
// brouillard néon : les lointains se noient dans l'indigo -> profondeur + halo des néons
scene.fog = new THREE.Fog(0x0c0a1e, 42, 124);

// éclairage par image (IBL) : contribution faible (nuit) juste pour accrocher les reflets
try {
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.32;
} catch (e) { console.warn("IBL indisponible", e); }

const camera = new THREE.PerspectiveCamera(36, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(27, 22, 34);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.49; controls.minDistance = 16; controls.maxDistance = 140;
controls.target.set(-2, 3.5, -6);
// hook debug (captures d'écran) : repositionne librement la caméra depuis la console/CDP
window.__view = (px, py, pz, tx, ty, tz) => { camera.position.set(px, py, pz); controls.target.set(tx, ty, tz); controls.update(); };

// ---- vue première personne (touche Y) ----
const fp = new PointerLockControls(camera, renderer.domElement);
let fpMode = false;
let fpPanelOpen = false; // panneau agent ouvert depuis la 1re personne (curseur libéré, on reste en FP)
const FP_REACH = 3.8;    // portée (m, plan x/z) pour interagir avec un agent via "E"
const fpKeys = { forward: false, back: false, left: false, right: false };
const savedCam = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
function enterFP() {
  fpMode = true; controls.enabled = false;
  savedCam.pos.copy(camera.position); savedCam.target.copy(controls.target);
  camera.position.set(2, 1.7, 6); camera.lookAt(2, 1.7, -4);
  fp.lock();
  document.getElementById("fp-hint").classList.remove("hidden");
}
function exitFP() {
  if (!fpMode) return; fpMode = false; fpPanelOpen = false; fp.unlock();
  camera.position.copy(savedCam.pos); controls.target.copy(savedCam.target);
  camera.up.set(0, 1, 0); controls.enabled = true;
  document.getElementById("fp-hint").classList.add("hidden");
}
// L'unlock ne fait sortir de la FP que s'il n'est PAS volontaire (ouverture d'un panneau).
fp.addEventListener("unlock", () => { if (fpMode && !fpPanelOpen) exitFP(); });

// Agent le plus proche de la caméra dans le rayon d'interaction (plan x/z), ou null.
function nearestAgentInReach() {
  let best = null, bestD = FP_REACH * FP_REACH;
  for (const rec of agents.values()) {
    if (!rec || !rec.data) continue;
    const dx = rec.group.position.x - camera.position.x;
    const dz = rec.group.position.z - camera.position.z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = rec; }
  }
  return best;
}
// "E" en 1re personne : ouvre le panneau de l'agent à portée.
function openNearestAgent() {
  const best = nearestAgentInReach();
  if (!best) { flashFpHint("🚶 Aucun agent à portée — approche-toi"); return; }
  fpPanelOpen = true;
  fp.unlock(); // libère le curseur pour utiliser le panneau, sans quitter la 1re personne
  openDetail(best.data.id);
}
// Message éphémère dans le bandeau FP (puis retour à l'aide habituelle).
const FP_HINT_DEFAULT = "🎮 Vue première personne · <b>ZQSD/WASD</b> bouger · souris regarder · <b>E</b> parler à un agent · <b>Y</b>/<b>Échap</b> sortir";
let fpHintTimer = null;
function flashFpHint(msg) {
  const el = document.getElementById("fp-hint"); if (!el) return;
  el.innerHTML = msg; clearTimeout(fpHintTimer);
  fpHintTimer = setTimeout(() => { el.innerHTML = FP_HINT_DEFAULT; }, 1400);
}
// vrai si on tape dans un champ OU qu'un menu/panneau est ouvert -> on n'intercepte pas les touches
function uiBusy() {
  const ae = document.activeElement;
  if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT" || ae.isContentEditable)) return true;
  for (const id of ["detail", "spawn-modal", "team-modal", "fs-picker", "cto-panel"]) {
    const el = document.getElementById(id); if (el && !el.classList.contains("hidden")) return true;
  }
  return false;
}
window.addEventListener("keydown", (e) => {
  if (uiBusy()) return; // ne pas voler les touches quand un champ/menu est actif (ex. taper "y" dans le chat)
  const k = e.key.toLowerCase();
  if (k === "y") { e.preventDefault(); fpMode ? exitFP() : enterFP(); return; }
  if (!fpMode) return;
  if (k === "e") { e.preventDefault(); openNearestAgent(); return; }
  if (k === "z" || k === "w" || e.key === "ArrowUp") fpKeys.forward = true;
  if (k === "s" || e.key === "ArrowDown") fpKeys.back = true;
  if (k === "q" || k === "a" || e.key === "ArrowLeft") fpKeys.left = true;
  if (k === "d" || e.key === "ArrowRight") fpKeys.right = true;
});
window.addEventListener("keyup", (e) => {
  const k = e.key.toLowerCase();
  if (k === "z" || k === "w" || e.key === "ArrowUp") fpKeys.forward = false;
  if (k === "s" || e.key === "ArrowDown") fpKeys.back = false;
  if (k === "q" || k === "a" || e.key === "ArrowLeft") fpKeys.left = false;
  if (k === "d" || e.key === "ArrowRight") fpKeys.right = false;
});

// lumières — CYBERPUNK : nuit froide + remplissages néon magenta / cyan / violet
scene.add(new THREE.AmbientLight(0x3a3470, 0.34));
scene.add(new THREE.HemisphereLight(0x2c6cb0, 0x3a1550, 0.46));
// « clair de lune » froid = lumière clé (ombres nettes)
const sun = new THREE.DirectionalLight(0xbcd0ff, 1.55);
const magFill  = new THREE.PointLight(0xff3df0, 0.5, 55, 2.0); magFill.position.set(-6, 9, 9);  scene.add(magFill);
const cyanFill = new THREE.PointLight(0x36f0ff, 0.5, 52, 2.0); cyanFill.position.set(16, 8, -5); scene.add(cyanFill);
const purpFill = new THREE.PointLight(0x8a5cff, 0.38, 48, 2.0); purpFill.position.set(2, 7, -14); scene.add(purpFill);
sun.position.set(34, 46, 28); sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096); sun.shadow.radius = 3.2;
const sc = sun.shadow.camera; sc.left = -42; sc.right = 42; sc.top = 40; sc.bottom = -40; sc.far = 160;
sun.shadow.bias = -0.00035; sun.shadow.normalBias = 0.03; scene.add(sun);
const fill = new THREE.DirectionalLight(0x5a78ff, 0.28); fill.position.set(-30, 20, 30); scene.add(fill);

// post-processing : bloom léger, seuil haut -> seuls les néons rayonnent (avec fallback)
// MSAA dans le pipeline : sans cible multisamplée, l'EffectComposer perd l'antialiasing
// du canvas (bords crénelés dès qu'un pass est actif). On rend en HalfFloat (HDR -> bloom
// propre) avec 4 échantillons -> arêtes nettes + bloom correct.
let composer = null;
let gradePass = null;
try {
  const dpr = Math.min(window.devicePixelRatio, 2);
  const rt = new THREE.WebGLRenderTarget(
    Math.floor(window.innerWidth * dpr), Math.floor(window.innerHeight * dpr),
    { type: THREE.HalfFloatType, samples: 4 }
  );
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  // bloom marqué : néons, écrans et émissifs rayonnent (signature cyberpunk)
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.6, 0.62, 0.75));
  composer.addPass(new OutputPass());
  // étalonnage final cyberpunk (LDR) : aberration chromatique radiale, duotone bleu/magenta,
  // saturation, scanlines fines, vignette dense.
  gradePass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null }, uTime: { value: 0 },
      uVignette: { value: 0.38 }, uContrast: { value: 1.07 }, uSaturation: { value: 1.24 },
      uChroma: { value: 0.0019 }, uScan: { value: 0.05 },
      uShadowTint: { value: new THREE.Color(0x3a55ff) }, uHighTint: { value: new THREE.Color(0xff5ae6) },
    },
    vertexShader: "varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
    fragmentShader: [
      "uniform sampler2D tDiffuse; uniform float uVignette,uContrast,uSaturation,uChroma,uScan,uTime; uniform vec3 uShadowTint,uHighTint; varying vec2 vUv;",
      "void main(){",
      "  vec2 d = vUv - 0.5; float r2 = dot(d, d);",
      "  vec2 off = d * uChroma * (1.0 + r2 * 2.5);",                       // aberration chromatique radiale
      "  vec3 col;",
      "  col.r = texture2D(tDiffuse, vUv + off).r;",
      "  col.g = texture2D(tDiffuse, vUv).g;",
      "  col.b = texture2D(tDiffuse, vUv - off).b;",
      "  col = (col - 0.5) * uContrast + 0.5;",                             // contraste
      "  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));",
      "  vec3 tint = mix(uShadowTint, uHighTint, smoothstep(0.12, 0.9, l));",
      "  col = mix(col, col * tint * 1.7, 0.13);",                          // duotone subtil ombres->hautes
      "  col = mix(vec3(l), col, uSaturation);",                           // saturation
      "  float scan = sin(vUv.y * 900.0 + uTime * 3.0) * 0.5 + 0.5;",       // scanlines fines
      "  col *= 1.0 - uScan * scan;",
      "  float vig = smoothstep(0.85, 0.26, length(d));",
      "  col *= mix(1.0 - uVignette, 1.0, vig);",
      "  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);",
      "}",
    ].join("\n"),
  });
  composer.addPass(gradePass);
} catch (e) { console.warn("post-processing désactivé", e); composer = null; }

// ===========================================================================
//  Matériaux & helpers
// ===========================================================================

const MAT = {
  floor:  new THREE.MeshStandardMaterial({ color: 0x0f0c1c, roughness: 0.34, metalness: 0.55 }),
  mezz:   new THREE.MeshStandardMaterial({ color: 0x14111f, roughness: 0.5, metalness: 0.4 }),
  wallLight: new THREE.MeshStandardMaterial({ color: 0x181327, roughness: 0.85 }),
  wallDark:  new THREE.MeshStandardMaterial({ color: 0x0b0914, roughness: 0.85 }),
  wood:   new THREE.MeshStandardMaterial({ color: 0x241b3e, roughness: 0.5, metalness: 0.25 }),
  woodDk: new THREE.MeshStandardMaterial({ color: 0x161029, roughness: 0.55, metalness: 0.25 }),
  metal:  new THREE.MeshStandardMaterial({ color: 0x2b2f3e, roughness: 0.28, metalness: 0.9 }),
  dark:   new THREE.MeshStandardMaterial({ color: 0x09090f, roughness: 0.4, metalness: 0.45 }),
  fabric: new THREE.MeshStandardMaterial({ color: 0x3a1d54, roughness: 0.85 }),
  fabric2:new THREE.MeshStandardMaterial({ color: 0x1d2a58, roughness: 0.85 }),
  pot:    new THREE.MeshStandardMaterial({ color: 0x1a1730, roughness: 0.7, metalness: 0.2 }),
  leaf:   new THREE.MeshStandardMaterial({ color: 0x18c7b0, roughness: 0.7, emissive: 0x0a5f56, emissiveIntensity: 0.6 }),
  leaf2:  new THREE.MeshStandardMaterial({ color: 0x4ff0d6, roughness: 0.7, emissive: 0x0e7a6c, emissiveIntensity: 0.6 }),
  glass:  new THREE.MeshStandardMaterial({ color: 0x36f0ff, emissive: 0x36f0ff, emissiveIntensity: 0.9, roughness: 0.12, metalness: 0.1 }),
  rug:    new THREE.MeshStandardMaterial({ color: 0x1a1240, roughness: 0.9 }),
  whiteboard: new THREE.MeshStandardMaterial({ color: 0x0c1430, roughness: 0.5, emissive: 0x0a2a4a, emissiveIntensity: 0.35 }),
};
// tempère l'apport de l'IBL pour éviter la surexposition
for (const k in MAT) { if (MAT[k].isMeshStandardMaterial) MAT[k].envMapIntensity = 0.4; }

// textures procédurales (bruit) pour casser l'aspect "plastique" des aplats
function noiseTex(hex, contrast, size = 256) {
  const cv = document.createElement("canvas"); cv.width = cv.height = size; const c = cv.getContext("2d");
  c.fillStyle = "#" + hex.toString(16).padStart(6, "0"); c.fillRect(0, 0, size, size);
  const img = c.getImageData(0, 0, size, size), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * contrast; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  c.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
const tFloor = noiseTex(0x0f0c1c, 14); tFloor.repeat.set(16, 11); MAT.floor.map = tFloor; MAT.floor.roughness = 0.32; MAT.floor.metalness = 0.58;
const tMezz = noiseTex(0x14111f, 14); tMezz.repeat.set(8, 7); MAT.mezz.map = tMezz;
const tWall = noiseTex(0x181327, 12); tWall.repeat.set(9, 3); MAT.wallLight.map = tWall;
const tWood = noiseTex(0x241b3e, 16); tWood.repeat.set(4, 1); MAT.wood.map = tWood;
for (const m of [MAT.floor, MAT.mezz, MAT.wallLight, MAT.wood]) m.needsUpdate = true;

// ---------------------------------------------------------------------------
//  Textures PBR procédurales : relief (normal) + variation de rugosité.
//  Génération canvas une seule fois ; les couleurs de base sont préservées.
//  -> casse l'aspect "plastique" des aplats et fait réagir la lumière au grain.
// ---------------------------------------------------------------------------
function _canvas(size) { const cv = document.createElement("canvas"); cv.width = cv.height = size; return cv; }
function _texFrom(canvas, { srgb = false, repeat = 1, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  const r = Array.isArray(repeat) ? repeat : [repeat, repeat]; t.repeat.set(r[0], r[1]);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso; return t;
}
// bruit de valeur lissé (fbm) -> champ de hauteur Float32 normalisé [0..1]
function _fbm(size, { octaves = 5, gain = 0.55, lac = 2.0, base = 4, seed = 1 } = {}) {
  const h = new Float32Array(size * size); let amp = 1, freq = base, norm = 0;
  const smooth = (t) => t * t * (3 - 2 * t);
  for (let o = 0; o < octaves; o++) {
    const gg = (freq | 0) + 1, rnd = new Float32Array(gg * gg);
    for (let i = 0; i < rnd.length; i++) { const s = Math.sin((i + 1) * 12.9898 + o * 78.233 + seed * 3.17) * 43758.5453; rnd[i] = s - Math.floor(s); }
    for (let y = 0; y < size; y++) {
      const fy = y / size * freq, y0 = fy | 0, ty = smooth(fy - y0), ya = (y0 % gg) * gg, yb = ((y0 + 1) % gg) * gg;
      for (let x = 0; x < size; x++) {
        const fx = x / size * freq, x0 = fx | 0, tx = smooth(fx - x0), xa = x0 % gg, xb = (x0 + 1) % gg;
        const top = rnd[ya + xa] * (1 - tx) + rnd[ya + xb] * tx;
        const bot = rnd[yb + xa] * (1 - tx) + rnd[yb + xb] * tx;
        h[y * size + x] += (top * (1 - ty) + bot * ty) * amp;
      }
    }
    norm += amp; amp *= gain; freq *= lac;
  }
  for (let i = 0; i < h.length; i++) h[i] /= norm; return h;
}
// champ de hauteur -> carte de normales (linéaire), via gradient de Sobel simplifié
function _normalCanvas(h, size, strength) {
  const cv = _canvas(size), c = cv.getContext("2d"), img = c.createImageData(size, size), d = img.data;
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (at(x - 1, y) - at(x + 1, y)) * strength, dy = (at(x, y - 1) - at(x, y + 1)) * strength;
    const len = Math.hypot(dx, dy, 1), i = (y * size + x) * 4;
    d[i] = (dx / len * 0.5 + 0.5) * 255; d[i + 1] = (dy / len * 0.5 + 0.5) * 255; d[i + 2] = (1 / len * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  c.putImageData(img, 0, 0); return cv;
}
// champ de hauteur -> carte de rugosité (gris) entre lo et hi
function _grayCanvas(h, size, lo, hi) {
  const cv = _canvas(size), c = cv.getContext("2d"), img = c.createImageData(size, size), d = img.data;
  for (let i = 0; i < h.length; i++) { const v = (lo + (hi - lo) * h[i]) * 255; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
  c.putImageData(img, 0, 0); return cv;
}
// reliefs spécialisés ---------------------------------------------------------
function _woodHeight(size) {
  const grain = _fbm(size, { octaves: 5, base: 3, gain: 0.6, seed: 7 }), h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const ring = Math.sin(x / size * 16 + grain[i] * 7) * 0.5 + 0.5;            // veines étirées en X
    const seam = (Math.abs((y / size * 5 % 1) - 0.5) > 0.475) ? 0.35 : 0;       // joints de lames
    h[i] = Math.max(0, ring * 0.7 + grain[i] * 0.3 - seam);
  }
  return h;
}
function _fabricHeight(size) {
  const n = _fbm(size, { octaves: 4, base: 10, seed: 11 }), h = new Float32Array(size * size), f = 48 * 2 * Math.PI;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, weave = (Math.sin(x / size * f) * Math.cos(y / size * f)) * 0.5 + 0.5;
    h[i] = weave * 0.6 + n[i] * 0.4;
  }
  return h;
}
function _metalHeight(size) {
  const n = _fbm(size, { octaves: 3, base: 5, seed: 5 }), h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    h[i] = (Math.sin(x / size * 230 + n[i] * 4) * 0.5 + 0.5) * 0.35 + n[i] * 0.65;  // brossé horizontal
  }
  return h;
}
const _texCache = {};
function pbrSet(family) {
  if (family in _texCache) return _texCache[family];
  const S = 256; let h, ns, lo, hi, rep;
  try {
    if (family === "wood") { h = _woodHeight(S); ns = 2.0; lo = 0.45; hi = 0.72; rep = [2, 2]; }
    else if (family === "fabric") { h = _fabricHeight(S); ns = 1.3; lo = 0.78; hi = 0.95; rep = [5, 5]; }
    else if (family === "metal") { h = _metalHeight(S); ns = 0.7; lo = 0.22; hi = 0.5; rep = [3, 3]; }
    else if (family === "rubber") { h = _fbm(S, { octaves: 5, base: 26, seed: 9 }); ns = 1.1; lo = 0.7; hi = 0.92; rep = [3, 3]; }
    else if (family === "concrete") { h = _fbm(S, { octaves: 6, base: 5, seed: 3 }); ns = 1.0; lo = 0.6; hi = 0.9; rep = [1, 1]; }
    else { h = _fbm(S, { octaves: 5, base: 6, seed: 2 }); ns = 0.6; lo = 0.85; hi = 0.98; rep = [1, 1]; } // plaster
    _texCache[family] = { normal: _texFrom(_normalCanvas(h, S, ns), { repeat: rep }), rough: _texFrom(_grayCanvas(h, S, lo, hi), { repeat: rep }) };
  } catch (e) { console.warn("pbrSet KO", family, e); _texCache[family] = null; }
  return _texCache[family];
}
function applyPbr(mat, family, { normalScale = 0.6, repeat } = {}) {
  const s = pbrSet(family); if (!s || !mat || !mat.isMeshStandardMaterial) return mat;
  let nm = s.normal, rm = s.rough;
  if (repeat) { const r = Array.isArray(repeat) ? repeat : [repeat, repeat]; nm = nm.clone(); rm = rm.clone(); nm.repeat.set(r[0], r[1]); rm.repeat.set(r[0], r[1]); nm.needsUpdate = rm.needsUpdate = true; }
  mat.normalMap = nm; mat.normalScale = new THREE.Vector2(normalScale, normalScale);
  if (!mat.roughnessMap) mat.roughnessMap = rm;
  mat.needsUpdate = true; return mat;
}
// albédo bois (lames + veines) pour les surfaces qu'on contrôle
function _woodAlbedoCanvas(size, c1, c2) {
  const h = _woodHeight(size), grain = _fbm(size, { octaves: 4, base: 3, seed: 7 });
  const cv = _canvas(size), c = cv.getContext("2d"), img = c.createImageData(size, size), d = img.data;
  const r1 = (c1 >> 16) & 255, g1 = (c1 >> 8) & 255, b1 = c1 & 255, r2 = (c2 >> 16) & 255, g2 = (c2 >> 8) & 255, b2 = c2 & 255;
  for (let i = 0; i < h.length; i++) {
    const t = Math.min(1, Math.max(0, h[i] * 0.65 + grain[i] * 0.35));
    d[i * 4] = r1 + (r2 - r1) * t; d[i * 4 + 1] = g1 + (g2 - g1) * t; d[i * 4 + 2] = b1 + (b2 - b1) * t; d[i * 4 + 3] = 255;
  }
  c.putImageData(img, 0, 0); return cv;
}

// --- application aux grandes surfaces (couleurs chaudes conservées) ---
try {
  // sol cyber : sombre, lisse et réfléchissant (le quadrillage néon est ajouté par-dessus)
  MAT.floor.roughness = 0.3; MAT.floor.metalness = 0.62; MAT.floor.envMapIntensity = 1.15;
  applyPbr(MAT.mezz, "concrete", { normalScale: 0.55, repeat: [10, 8] });
  applyPbr(MAT.wallLight, "plaster", { normalScale: 0.3, repeat: [6, 2] });
  applyPbr(MAT.wallDark, "plaster", { normalScale: 0.35, repeat: [4, 2] });
  applyPbr(MAT.wood, "wood", { normalScale: 0.6, repeat: [3, 1] });
  applyPbr(MAT.woodDk, "wood", { normalScale: 0.6, repeat: [3, 1] }); MAT.woodDk.roughness = 0.6;
  applyPbr(MAT.metal, "metal", { normalScale: 0.25 }); MAT.metal.envMapIntensity = 0.9;
  applyPbr(MAT.fabric, "fabric", { normalScale: 0.5 });
  applyPbr(MAT.fabric2, "fabric", { normalScale: 0.5 });
  applyPbr(MAT.rug, "fabric", { normalScale: 0.6, repeat: [5, 5] });
} catch (e) { console.warn("PBR surfaces KO", e); }

// enrichit un matériau de GLB d'après son nom Blender (sans changer sa couleur)
const _PBR_BY_NAME = [[/wood/i, "wood"], [/fabric|cushion|seat|pad/i, "fabric"], [/metal|steel|chrome/i, "metal"], [/rubber|belt|tire/i, "rubber"]];
function enhanceGlbMaterial(mat) {
  if (!mat || !mat.isMeshStandardMaterial) return;
  mat.envMapIntensity = 0.55;
  const name = (mat.name || "").toLowerCase();
  for (const [re, fam] of _PBR_BY_NAME) if (re.test(name)) { applyPbr(mat, fam, { normalScale: fam === "metal" ? 0.2 : 0.45 }); break; }
}

// ombre de contact douce (ancre les objets au sol)
const SHADOW_TEX = (() => {
  const cv = document.createElement("canvas"); cv.width = cv.height = 128; const c = cv.getContext("2d");
  const g = c.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, "rgba(0,0,0,0.5)"); g.addColorStop(0.6, "rgba(0,0,0,0.22)"); g.addColorStop(1, "rgba(0,0,0,0)");
  c.fillStyle = g; c.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
function shadowBlob(x, z, rx, rz = rx, y = 0.03) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(rx * 2, rz * 2),
    new THREE.MeshBasicMaterial({ map: SHADOW_TEX, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); scene.add(m); return m;
}

function box(w, h, d, mat, x = 0, y = 0, z = 0, parent = scene) {
  const r = Math.min(0.1, Math.min(w, h, d) * 0.45);
  const geo = r > 0.012 ? new RoundedBoxGeometry(w, h, d, 2, r) : new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
function cyl(rt, rb, h, mat, x = 0, y = 0, z = 0, parent = scene, seg = 16) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
function makeLabelSprite(w, h, draw) {
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  draw(cv.getContext("2d"), cv);
  const tex = new THREE.CanvasTexture(cv); tex.anisotropy = 4; tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  spr.userData.tex = tex; return spr;
}
function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }

// ===========================================================================
//  DÉCOR — bâtiment deux niveaux
// ===========================================================================

const MEZZ_Y = 4.4; // hauteur du plancher de la mezzanine (gym)
// hauteur du sol sous (x,z) pour la marche en 1ʳᵉ personne (escalier + mezzanine)
function floorHeightAt(x, z) {
  if (x > 21.3 && x < 25.7 && z > -3 && z < 4.4) {         // escalier : bas à z=4 (sol), haut à z=-3 (mezzanine)
    const t = (4 - z) / 7;
    return Math.max(0, Math.min(1, t)) * MEZZ_Y;
  }
  if (x > 8 && x < 26.5 && z > -19.5 && z < -3) return MEZZ_Y; // plateau gym
  return 0;
}
const anchors = { office: [], coworking: [], gym: [] };

// sol + murs en L
box(54, 1, 38, MAT.floor, 0, -0.5, -2);

// hooks d'animation des éléments cyber (panneaux holo, etc.) — appelés chaque frame
const cyberAnim = [];

// --- quadrillage néon synthwave sur le sol (lignes émissives captées par le bloom) ---
let gridMat = null;
try {
  gridMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uA: { value: new THREE.Color(0x1f9fff) }, uB: { value: new THREE.Color(0xff3df0) } },
    vertexShader: "varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
    fragmentShader: [
      "varying vec2 vP; uniform float uTime; uniform vec3 uA, uB;",
      "void main(){",
      "  vec2 cell = vP / 2.0;",                                   // cellules de 2 m
      "  vec2 gv = abs(fract(cell) - 0.5);",
      "  vec2 fw = fwidth(cell);",
      "  vec2 lw = smoothstep(fw * 1.6, vec2(0.0), gv);",          // proximité d'une ligne
      "  float line = max(lw.x, lw.y);",
      "  if (line < 0.02) discard;",
      "  float m = 0.5 + 0.5 * sin(cell.x * 0.35 + cell.y * 0.22 - uTime * 1.1);",
      "  vec3 col = mix(uA, uB, m);",
      "  float pulse = 0.55 + 0.45 * sin(uTime * 1.4 + length(cell) * 0.45);",
      "  gl_FragColor = vec4(col, line * pulse * 0.8);",
      "}",
    ].join("\n"),
  });
  const gridMesh = new THREE.Mesh(new THREE.PlaneGeometry(54, 38), gridMat);
  gridMesh.rotation.x = -Math.PI / 2; gridMesh.position.set(0, 0.015, -2); gridMesh.renderOrder = 1;
  scene.add(gridMesh);
} catch (e) { console.warn("grille néon KO", e); gridMat = null; }

function zoneTint(x, w, z, d, color, opacity = 0.07) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, 0.02, z); scene.add(m);
}
zoneTint(-15, 22, -4, 30, ROOMS.office.color);
zoneTint(1, 12, 2, 22, ROOMS.coworking.color);

box(54, 15, 0.4, MAT.wallLight, 0, 7, -21);   // mur du fond
box(0.4, 15, 38, MAT.wallLight, -27, 7, -2);  // mur gauche
box(20, 15, 0.4, MAT.wallDark, 17, 7.2, -20.7); // section gym (au-dessus, sombre)

// ---- décor mural : vitres sur monde futuriste (Star Wars), cadres, lambris, surfboard ----
// ---- vitres ANIMÉES : skylines NYC nocturnes (trafic qui défile, fenêtres qui scintillent) ----
const SKY_MOODS = [
  ["#0a1230", "#1a2350", "#3a2a5a", "#c25a8a"], // violet/rose
  ["#08122a", "#16203f", "#4a3a66", "#d98a4a"], // ambre
  ["#0b1a33", "#1c2f4a", "#2f5a7a", "#7ac6e0"], // cyan
  ["#120a26", "#2a1a44", "#6a2f5e", "#f0a060"], // crépuscule
];
function rndf(s) { const x = Math.sin(s) * 9999; return x - Math.floor(x); }
function makeCityBase(seed) {
  const W = 256, H = 256, cv = document.createElement("canvas"); cv.width = W; cv.height = H; const c = cv.getContext("2d");
  const m = SKY_MOODS[Math.floor(seed) % SKY_MOODS.length];
  const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, m[0]); g.addColorStop(.45, m[1]); g.addColorStop(.78, m[2]); g.addColorStop(1, m[3]);
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  c.globalAlpha = .8; c.fillStyle = "#cfd6ff"; c.beginPath(); c.arc(40 + rndf(seed + 1) * 180, 40 + rndf(seed + 2) * 30, 10 + rndf(seed + 3) * 12, 0, 7); c.fill(); c.globalAlpha = 1;
  for (let i = 0; i < 26; i++) {
    const bw = 7 + rndf(seed + i) * 16, bx = (i * 11 + rndf(seed + i * 2) * 6) % W, bh = 50 + rndf(seed + i * 3) * 170, by = H - bh;
    c.fillStyle = "#0a0e26"; c.fillRect(bx, by, bw, bh);
    for (let wy = by + 4; wy < H - 3; wy += 7) for (let wx = bx + 2; wx < bx + bw - 2; wx += 5)
      if (rndf(wx * .3 + wy + i + seed) > .5) { c.fillStyle = rndf(wx + wy) > .75 ? "#ffe6a0" : "#9fd6ff"; c.fillRect(wx, wy, 2, 3); }
  }
  return cv;
}
function makeSky(seed) {
  const W = 256, H = 256, cv = document.createElement("canvas"); cv.width = W; cv.height = H; const ctx = cv.getContext("2d");
  const base = makeCityBase(seed), traffic = [];
  for (let i = 0; i < 22; i++) traffic.push({ x: Math.random() * W, y: 25 + Math.random() * 140, vx: (Math.random() > .5 ? 1 : -1) * (12 + Math.random() * 26), len: 5 + Math.random() * 14, col: Math.random() > .5 ? "rgba(150,225,255,.95)" : "rgba(255,175,95,.95)" });
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  return { ctx, base, traffic, tex, W, H, seed };
}
function updateSky(s, dt, t) {
  const { ctx, base, traffic, W } = s; ctx.drawImage(base, 0, 0);
  ctx.lineWidth = 1.6;
  for (const p of traffic) { p.x += p.vx * dt; if (p.x > W + 20) p.x = -20; if (p.x < -20) p.x = W + 20; ctx.strokeStyle = p.col; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - Math.sign(p.vx) * p.len, p.y); ctx.stroke(); }
  for (let i = 0; i < 5; i++) { const tw = Math.abs(Math.sin(t * 2.5 + i * 1.7 + s.seed)); if (tw > .72) { ctx.fillStyle = `rgba(255,240,180,${tw})`; ctx.fillRect((rndf(i * 7 + s.seed) * .9 + .05) * W, (rndf(i * 3 + s.seed) * .55 + .15) * s.H, 2, 3); } }
  s.tex.needsUpdate = true;
}
const SKIES = [makeSky(0), makeSky(1), makeSky(2), makeSky(3)];
const SKY_MATS = SKIES.map((s) => new THREE.MeshBasicMaterial({ map: s.tex }));
const FRAME = new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.5, metalness: 0.3 });
const SLAT = new THREE.MeshStandardMaterial({ color: 0x1a1336, roughness: 0.6, metalness: 0.2 });
// vitres = panneaux affichant les skylines NYC animées (une variante différente par fenêtre)
for (let i = 0; i < 5; i++) box(0.1, 4.2, 4.6, SKY_MATS[i % SKY_MATS.length], -26.62, 7, -16 + i * 6.6);  // mur gauche
for (let i = 0; i < 4; i++) box(4.2, 4, 0.1, SKY_MATS[(i + 1) % SKY_MATS.length], 9 + i * 4.6, 9.5, -20.5); // gym
// cadres (meneaux) des fenêtres
for (let i = 0; i < 5; i++) { const z = -16 + i * 6.6; box(0.12, 4.4, 0.18, FRAME, -26.75, 7, z - 2.4); box(0.12, 4.4, 0.18, FRAME, -26.75, 7, z + 2.4); box(0.12, 0.18, 4.8, FRAME, -26.75, 9.2, z); box(0.12, 0.18, 4.8, FRAME, -26.75, 4.8, z); box(0.12, 0.18, 4.8, FRAME, -26.75, 7, z); }
for (let i = 0; i < 4; i++) { const x = 9 + i * 4.6; box(0.18, 4.2, 0.12, FRAME, x - 2.2, 9.5, -20.55); box(0.18, 4.2, 0.12, FRAME, x + 2.2, 9.5, -20.55); box(4.4, 0.12, 0.12, FRAME, x, 11.4, -20.55); box(4.4, 0.12, 0.12, FRAME, x, 7.6, -20.55); }
// lambris bois vertical (panneau d'accent, mur du fond bureau)
for (let i = 0; i < 14; i++) box(0.28, 9, 0.12, SLAT, -6 + i * 0.34, 4.8, -20.78);
// (surfboard + wall art : modèles GLB, placés dans buildGym car placeModel/MODELS définis plus bas)

// néons
function neon(text, color, x, y, z, sx = 7) {
  const spr = makeLabelSprite(512, 140, (c) => {
    c.clearRect(0, 0, 512, 140); c.font = "italic 700 64px 'Brush Script MT', cursive"; c.textAlign = "center";
    c.fillStyle = hexCss(color); c.shadowColor = hexCss(color); c.shadowBlur = 30; c.fillText(text, 256, 86);
    c.shadowBlur = 14; c.fillText(text, 256, 86);
  });
  spr.scale.set(sx, sx * 0.27, 1); spr.position.set(x, y, z); scene.add(spr);
}
neon("Good Vibes Only", 0xff3df0, -16, 10.5, -20.6, 9);
neon("Stronger Everyday", 0x36f0ff, 14, 12, -20.4, 8.5);

function roomTitle(r, x) {
  const spr = makeLabelSprite(512, 168, (c) => {
    c.clearRect(0, 0, 512, 168); c.font = "800 72px Inter, sans-serif"; c.textAlign = "center";
    c.fillStyle = hexCss(r.color); c.shadowColor = hexCss(r.color); c.shadowBlur = 16; c.fillText(r.label, 256, 74); c.shadowBlur = 0;
    c.font = "400 28px Inter, sans-serif"; c.fillStyle = "rgba(235,240,255,.75)"; c.fillText(r.sub, 256, 118);
  });
  spr.scale.set(8.8, 2.9, 1); spr.position.set(x, 16.1, -10); scene.add(spr);
}
roomTitle(ROOMS.office, -16); roomTitle(ROOMS.coworking, 1); roomTitle(ROOMS.gym, 14.5);

// --- panneaux holographiques (katakana défilant + scanlines + cadre néon), façon CyberFX ---
const KATAKANA = "アイウエオカキクケコサシスセソタチツテトナニヌネノﾊﾋﾌﾍﾎ0123456789ABCDEF<>=/";
function makeHoloTexture(title, lines, colorCss) {
  const W = 256, H = 512, c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d");
  const block = (oy) => {
    g.fillStyle = colorCss; g.textAlign = "left";
    g.font = "800 42px 'JetBrains Mono', monospace"; g.fillText(title, 14, oy + 50);
    g.font = "700 19px monospace";
    lines.forEach((l, i) => g.fillText(l, 14, oy + 92 + i * 28));
    g.globalAlpha = 0.5;
    for (let col = 0; col < 3; col++) for (let row = 0; row < 5; row++)
      g.fillText(KATAKANA[Math.floor(Math.random() * KATAKANA.length)], 16 + col * 80, oy + 196 + row * 22);
    g.globalAlpha = 1;
    g.fillRect(14, oy + 318, 90 + Math.random() * 130, 5);
  };
  block(0); block(H / 2);
  g.fillStyle = "rgba(0,0,0,0.5)"; for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1.4);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function holoPanel(x, y, z, w, h, title, lines, colorHex, rotY = 0, speed = 0.06) {
  const tex = makeHoloTexture(title, lines, hexCss(colorHex));
  const grp = new THREE.Group(); grp.position.set(x, y, z); grp.rotation.y = rotY;
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, color: colorHex }));
  grp.add(panel);
  const frameMat = new THREE.MeshBasicMaterial({ color: colorHex, toneMapped: false });
  const bar = (bw, bh, px, py) => { const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.04), frameMat); m.position.set(px, py, 0); grp.add(m); };
  bar(w + 0.16, 0.05, 0, h / 2 + 0.05); bar(w + 0.16, 0.05, 0, -h / 2 - 0.05);
  bar(0.05, h + 0.16, -w / 2 - 0.05, 0); bar(0.05, h + 0.16, w / 2 + 0.05, 0);
  scene.add(grp);
  cyberAnim.push((t) => {
    tex.offset.y = (t * speed) % 1;
    const glitch = Math.sin(t * 31) > 0.96 ? 0.4 : 1;
    panel.material.opacity = (0.82 + Math.sin(t * 9) * 0.1) * glitch;
  });
  return grp;
}
holoPanel(-21.5, 6.6, -19.2, 2.4, 3.2, "BUREAU", ["AGENTS//ACTIVE", "BUILD · TEST", "UPTIME 99.9%"], 0x36f0ff, 0.25);
holoPanel(-2.6, 6.9, -19.6, 2.2, 3.0, "SYNC", ["COLLAB MODE", "SHARED REPO", "LATENCY 12ms"], 0xff3df0, 0.12, 0.08);
holoPanel(4.6, 5.2, -19.2, 1.9, 2.6, ">_HAX", ["FLEET ONLINE", "CLAUDE-CODE", "ACCESS: OK"], 0xb15bff, -0.15, 0.09);

// plante
// ---- bibliothèque de modèles 3D générés (Blender) — placement différé ----
const MODELS = {};
const pendingModels = [];
function useModel(name, cb) {
  if (MODELS[name]) cb(MODELS[name].clone(true));
  else pendingModels.push({ name, cb });
}
// Ombre de contact : disque dégradé (noir -> transparent) posé au sol sous un prop.
// Complète l'ombre directionnelle du soleil par une occlusion ambiante douce -> les
// objets sont "posés" au lieu de flotter (effet AO de contact, sans pass coûteux).
const CONTACT_TEX = (() => {
  const cv = document.createElement("canvas"); cv.width = cv.height = 128; const c = cv.getContext("2d");
  const g = c.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, "rgba(0,0,0,0.55)"); g.addColorStop(0.55, "rgba(0,0,0,0.22)"); g.addColorStop(1, "rgba(0,0,0,0)");
  c.fillStyle = g; c.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const CONTACT_MAT = new THREE.MeshBasicMaterial({ map: CONTACT_TEX, transparent: true, depthWrite: false, opacity: 0.9 });
const CONTACT_GEO = new THREE.PlaneGeometry(1, 1);
function addContactShadow(group, box) {
  const sx = box.max.x - box.min.x, sz = box.max.z - box.min.z;
  if (!isFinite(sx) || !isFinite(sz) || sx <= 0 || sz <= 0) return;
  const blob = new THREE.Mesh(CONTACT_GEO, CONTACT_MAT);
  blob.rotation.x = -Math.PI / 2;
  blob.position.set((box.min.x + box.max.x) / 2, 0.02 - group.position.y, (box.min.z + box.max.z) / 2);
  blob.scale.set(sx * 1.5, sz * 1.5, 1); // un peu plus large que l'empreinte -> pénombre
  blob.renderOrder = -1; blob.matrixAutoUpdate = false; blob.updateMatrix();
  group.add(blob);
}
// instancie un modèle généré à (x,y,z), échelle s, rotation rotY, dans parent
function placeModel(name, x, y, z, s, rotY = 0, parent = scene) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rotY; parent.add(g);
  useModel(name, (m) => {
    m.scale.setScalar(s);
    // prop posé au sol -> on glisse une ombre de contact sous son empreinte
    if (Math.abs(g.position.y) < 0.3) {
      m.updateWorldMatrix(true, true); // m pas encore parenté : matrice monde = échelle locale
      addContactShadow(g, new THREE.Box3().setFromObject(m));
    }
    g.add(m);
  });
  return g;
}

function placeOnSurface(name, x, y, z, s, rotY = 0, parent = scene, surfaceLift = 0) {
  return placeModel(name, x, y + surfaceLift, z, s, rotY, parent);
}

function plant(x, z, s = 1, y = 0, parent = scene) {
  const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g);
  useModel("plant", (m) => { m.scale.setScalar(1.55 * s); g.add(m); });
  return g;
}

// ---- BUREAU : 2 rangées de bureaux partagés ----
function buildOffice() {
  const rows = [-11, -5.5];
  const xs = [-23, -20, -17, -14, -11, -8];
  box(18.8, 0.04, 14.6, new THREE.MeshStandardMaterial({ color: 0x141026, roughness: 1 }), -15.5, 0.03, -8);
  box(17.8, 0.02, 12.8, new THREE.MeshStandardMaterial({ color: 0x0d0a18, roughness: 1 }), -15.5, 0.06, -8);
  for (const z of rows) {
    for (const x of xs) {
      placeModel("workstation", x, 0, z, 1.0, 0); // poste individuel complet (bureau+écran+laptop+mug+plante)
      anchors.office.push({ pos: new THREE.Vector3(x, 0, z + 1.05), face: Math.PI, screen: null }); // employé assis face à son écran
    }
  }
  placeModel("storage_cabinet", -24.0, 0, -15.2, 0.95, 0);
  placeModel("storage_cabinet", -6.6, 0, -15.3, 0.95, 0);
  placeModel("task_lamp", -22.0, 0.78, -12.6, 0.9, 0.15);
  placeModel("task_lamp", -17.8, 0.78, -8.6, 0.9, 0);
  placeModel("task_lamp", -12.0, 0.78, -6.2, 0.9, -0.08);
  placeModel("task_lamp", -8.6, 0.78, -12.8, 0.9, 0.22);
}

// ---- COWORKING : lounge + grande table conviviale ----
function buildCoworking() {
  const cx = 1, cz = 1;
  const rug = new THREE.Mesh(new THREE.CircleGeometry(5, 40), MAT.rug); rug.rotation.x = -Math.PI / 2; rug.position.set(cx, 0.03, cz); rug.receiveShadow = true; scene.add(rug);
  placeModel("sofa", cx - 1.6, 0, cz + 1.6, 1.05, Math.PI + 0.5);   // canapé généré
  cyl(0.85, 0.85, 0.1, MAT.woodDk, cx, 0.5, cz); cyl(0.6, 0.6, 0.5, MAT.metal, cx, 0.25, cz); // table basse
  for (const dx of [-3, 3]) placeModel("armchair", cx + dx, 0, cz - 0.6, 1.0, dx > 0 ? -0.7 : 0.7); // fauteuils générés
  // grande table haute + tabourets (devant)
  box(3, 0.12, 1.2, MAT.wood, cx + 1, 1.05, cz + 4); for (const sx of [-1, 0, 1]) cyl(0.06, 0.06, 1.05, MAT.metal, cx + 1 + sx, 0.52, cz + 4);
  for (const sx of [-1, 0, 1]) for (const sz of [-0.8, 0.8]) { box(0.4, 0.08, 0.4, MAT.dark, cx + 1 + sx, 0.62, cz + 4 + sz); cyl(0.03, 0.03, 0.6, MAT.metal, cx + 1 + sx, 0.31, cz + 4 + sz); }
  placeModel("meeting_table", 2.2, 0, 4.6, 0.95, 0);
  const ring = 3.4;
  for (let i = 0; i < 6; i++) { const a = Math.PI * 0.15 + (i / 6) * Math.PI * 1.7; const x = cx + Math.cos(a) * ring, z = cz + Math.sin(a) * ring; anchors.coworking.push({ pos: new THREE.Vector3(x, 0, z), face: Math.atan2(cx - x, cz - z) }); }
  // sous la mezzanine : bibliothèque générée + whiteboard "Design Build Grow"
  placeModel("bookshelf", 8, 0, -16, 0.95);
  for (let i = 0; i < 4; i++) plant(6.5 + i * 1.0, -16.3, 0.4, 2.7);
  const wb = box(3, 2, 0.1, MAT.whiteboard, 13.5, 2.4, -19.4);
  const dbg = makeLabelSprite(256, 256, (c) => { c.clearRect(0, 0, 256, 256); c.font = "italic 700 40px 'Brush Script MT', cursive"; c.fillStyle = "#e9c46a"; c.textAlign = "center"; c.fillText("Design", 128, 100); c.fillText("Build", 128, 150); c.fillText("Grow", 128, 200); });
  dbg.scale.set(3, 3, 1); dbg.position.set(16.5, 2.6, -19.3); scene.add(dbg);
}

// ---- MEZZANINE GYM + escalier ----
function buildGym() {
  // plancher mezzanine
  box(20, 0.6, 17, MAT.mezz, 17, MEZZ_Y - 0.3, -11.5);
  box(18.8, 0.04, 14.6, new THREE.MeshStandardMaterial({ color: 0x1f2228, roughness: 1 }), 17, MEZZ_Y + 0.03, -11.8);
  box(13.0, 0.03, 6.0, new THREE.MeshStandardMaterial({ color: 0x272b32, roughness: 1 }), 17.4, MEZZ_Y + 0.05, -10.0);
  box(7.8, 0.03, 5.6, new THREE.MeshStandardMaterial({ color: 0x2e3239, roughness: 1 }), 22.8, MEZZ_Y + 0.05, -14.8);
  box(7.4, 0.03, 4.6, new THREE.MeshStandardMaterial({ color: 0x252931, roughness: 1 }), 11.0, MEZZ_Y + 0.05, -8.9);
  // colonnes de soutien
  for (const [x, z] of [[7.5, -3.5], [7.5, -19], [26, -3.5]]) cyl(0.25, 0.25, MEZZ_Y, MAT.metal, x, MEZZ_Y / 2, z);
  // garde-corps avant (z=-3) et gauche (x=7.5)
  function railing(x1, z1, x2, z2) {
    const len = Math.hypot(x2 - x1, z2 - z1), mx = (x1 + x2) / 2, mz = (z1 + z2) / 2, ang = Math.atan2(z2 - z1, x2 - x1);
    const bar = box(len, 0.06, 0.06, MAT.metal, mx, MEZZ_Y + 1.05, mz); bar.rotation.y = -ang;
    const n = Math.floor(len / 1.1);
    for (let i = 0; i <= n; i++) { const t = i / n; cyl(0.03, 0.03, 1.05, MAT.metal, x1 + (x2 - x1) * t, MEZZ_Y + 0.52, z1 + (z2 - z1) * t); }
    // grillage léger
    const mesh = box(len, 0.95, 0.02, new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.6, transparent: true, opacity: 0.35 }), mx, MEZZ_Y + 0.52, mz); mesh.rotation.y = -ang;
  }
  railing(7.5, -3, 26.5, -3); railing(7.5, -3, 7.5, -19.5);

  // escalier (descend vers l'avant droit)
  const steps = 11;
  // marches qui MONTENT vers la mezzanine : bas à z≈4 (sol), haut à z≈-3 (bord mezzanine)
  for (let i = 0; i < steps; i++) { const y = (i + 1) * (MEZZ_Y / steps); box(3.2, 0.25, 0.72, MAT.wood, 23.5, y - 0.12, 4 - i * 0.7); }
  box(0.15, MEZZ_Y + 1, steps * 0.62, MAT.metal, 25.2, MEZZ_Y / 2, 0.6).rotation.x = 0; // limon
  box(2, 0.5, 0.5, MAT.woodDk, 28, 0.25, 4); // vélo (placeholder sous l'escalier)
  cyl(0.5, 0.5, 0.1, MAT.dark, 28, 0.5, 3.3); cyl(0.5, 0.5, 0.1, MAT.dark, 28, 0.5, 4.7);

  const M = MEZZ_Y;
  box(11.8, 3.2, 0.18, MAT.wallDark, 15.3, M + 1.6, -18.9);
  // VRAIE salle de sport — zones lisibles : force / cardio / mobilité
  const gymLights = [
    [10.2, -16.0], [14.2, -17.0], [18.0, -16.8], [22.3, -15.2], [24.8, -11.8], [11.4, -9.0], [16.0, -10.0]
  ];
  for (const [lx, lz] of gymLights) {
    const p = new THREE.PointLight(0x7fd4ff, 0.7, 14, 2.0);
    p.position.set(lx, M + 2.8, lz);
    scene.add(p);
  }
  const stripLight = (x, z, w, d, color, intensity = 1.0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.07, d), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.25 }));
    m.position.set(x, M + 3.25, z);
    m.castShadow = false; m.receiveShadow = false;
    scene.add(m);
  };
  stripLight(13.4, -17.7, 6.8, 0.08, 0xff3df0, 2.0);
  stripLight(20.9, -14.9, 6.2, 0.08, 0x36f0ff, 1.6);
  stripLight(11.7, -9.2, 5.8, 0.08, 0x4df0a0, 1.6);
  const strip = (x1, z1, x2, z2, color) => {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.95), new THREE.MeshStandardMaterial({ color, roughness: 1 }));
    m.rotation.x = -Math.PI / 2;
    m.position.set((x1 + x2) / 2, M + 0.04, (z1 + z2) / 2);
    m.rotation.z = Math.atan2(z2 - z1, x2 - x1);
    m.receiveShadow = true;
    scene.add(m);
  };
  strip(8.6, -17.8, 20.0, -17.8, 0x2a2d33);
  strip(20.4, -15.6, 26.0, -15.6, 0x26282e);
  strip(8.6, -9.6, 15.2, -9.6, 0x30343a);
  strip(8.8, -18.35, 20.2, -18.35, 0x14161a);
  strip(21.0, -15.3, 25.8, -15.3, 0x181b20);
  strip(10.2, -8.95, 14.6, -8.95, 0x1b1f26);

  placeModel("squat_rack", 10.0, M, -17.2, 1.0, 0);
  placeModel("weight_bench", 11.2, M, -14.4, 1.0, Math.PI / 2);
  placeModel("bench", 12.8, M, -11.6, 1.0, Math.PI / 2);
  placeModel("dumbbell_rack", 13.6, M, -17.0, 1.0, 0);
  placeModel("plate_tree", 16.2, M, -17.1, 1.0, 0);
  placeModel("cable_machine", 18.8, M, -17.0, 1.0, 0);
  placeModel("mirror_panel", 8.7, M, -11.0, 1.0, 0);
  placeModel("mirror_panel", 10.4, M, -18.7, 1.2, 0);
  placeModel("mirror_panel", 13.3, M, -18.7, 1.2, 0);
  placeModel("mirror_panel", 16.2, M, -18.7, 1.2, 0);
  placeModel("mirror_panel", 19.1, M, -18.7, 1.2, 0);
  placeModel("mirror_panel", 22.2, M, -18.7, 1.15, 0);
  placeModel("storage_cabinet", 25.8, M, -10.2, 0.86, 0);
  placeModel("treadmill_pro", 22.4, M, -14.8, 1.0, 0);   // coureur face -Z (vers les vitres)
  placeModel("treadmill_pro", 24.9, M, -14.8, 1.0, 0);
  placeModel("spin_bike", 23.5, M, -11.0, 1.0, Math.PI);
  for (const [kx, kz] of [[10.7, -12.0], [11.5, -12.4], [12.2, -12.0], [13.0, -11.6], [13.8, -12.0]]) placeModel("kettlebell", kx, M, kz, 0.95);
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 2.15), new THREE.MeshStandardMaterial({ color: [0x14d9b0, 0x4a6cff, 0xb15bff][i], roughness: 1 }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(10.8 + i * 1.35, M + 0.31, -8.8);
    m.receiveShadow = true;
    scene.add(m);
  }
  plant(8.6, -19, 1.0, M); plant(26.0, -18, 1.0, M);
  plant(25.2, -4.5, 1.15, M); plant(8.2, -4.8, 1.0, M);
  plant(20.6, -18.1, 0.85, M);
  plant(9.0, -10.0, 0.7, M);

  const backGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(10.8, 2.4),
    new THREE.MeshStandardMaterial({ color: 0x36f0ff, emissive: 0xff3df0, emissiveIntensity: 0.6, roughness: 0.6, transparent: true, opacity: 0.1 })
  );
  backGlow.position.set(15.3, M + 1.55, -18.78);
  scene.add(backGlow);
  neon("Stronger Everyday", 0x36f0ff, 15.1, M + 2.9, -18.72, 7.8);

  // ancrages gym (sur la mezzanine)
  const spots = [[10.0, -16.8, "lift"], [14.0, -17.2, "lift"], [18.0, -17.0, "lift"], [22.6, -14.8, "run"], [24.7, -14.8, "run"], [23.4, -11.0, "run"], [10.8, -8.8, "yoga"], [12.2, -8.8, "yoga"], [13.6, -8.8, "yoga"], [12.8, -11.6, "lift"]];
  for (const [x, z, k] of spots) anchors.gym.push({ pos: new THREE.Vector3(x, M, z), face: Math.PI, kind: k });
}

buildOffice(); buildCoworking(); buildGym();
plant(-26, -18, 1.4); plant(-7.5, 1, 1.1); plant(-26, 6, 1.2); plant(5.5, 5.5, 1); plant(-5, -19, 1.3);
plant(-26, -2, 1.1); plant(-7, -13, 0.95); plant(2.5, 6.5, 0.9); plant(-12, 7, 1);
// ombres de contact sous le mobilier (ancrage)
shadowBlob(-15.5, -11, 9.5, 1.3); shadowBlob(-15.5, -5.5, 9.5, 1.3);   // rangées de bureaux
shadowBlob(1, 1, 5.2, 5.2);                                            // tapis lounge
shadowBlob(2, 5, 2, 0.9);                                             // table haute
for (const [x, z] of [[-26, -18], [-7.5, 1], [-26, 6], [5.5, 5.5], [-5, -19], [-26, -2]]) shadowBlob(x, z, 0.7);

// densité végétale (références saturées de plantes)
const plantSpots = [[-24, 9], [-18, 9], [-3, 9], [-9, -1], [-2, -1], [-24, -8], [3, 8], [-13, -19], [-19, -19], [6, -8.5], [-26, 1], [-3, 7]];
for (let i = 0; i < plantSpots.length; i++) { const [px, pz] = plantSpots[i]; plant(px, pz, 0.7 + (i % 3) * 0.18); shadowBlob(px, pz, 0.5); }
// petites plantes posées sur les rebords/étagères + livres colorés sur la bibliothèque
const bookCols = [0xc96f4a, 0x4a6fb0, 0x68a357, 0xe0b34a, 0xb05a8a, 0x5a8ab0];
for (let lvl = 0; lvl < 4; lvl++) {
  for (let b = 0; b < 7; b++) {
    const bx = 6.2 + b * 0.52, by = 0.62 + lvl * 1.0;
    box(0.4, 0.55, 0.08 + (b % 3) * 0.04, new THREE.MeshStandardMaterial({ color: bookCols[(lvl + b) % bookCols.length], roughness: 0.8 }), bx, by + 0.27, -16.3);
  }
  if (lvl % 2 === 0) plant(7.8, -16, 0.4, 0.6 + lvl * 1.0);
}

// jardinières le long des murs (densité végétale façon références)
function planter(x, z, w, n, rot = 0) {
  const g = new THREE.Group();
  box(w, 0.4, 0.7, new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.9 }), 0, 0.2, 0, g);
  for (let i = 0; i < n; i++) { const px = (i / (n - 1) - 0.5) * (w - 0.5); plant(px, 0, 0.55 + (i % 2) * 0.12, 0.35, g); }
  g.position.set(x, 0, z); g.rotation.y = rot; scene.add(g); shadowBlob(x, z, w / 2 + 0.2, 0.7);
}
planter(-13, -19.4, 7, 5);          // mur du fond, bureau
planter(-26.2, -6, 6, 4, Math.PI / 2); // mur gauche
planter(-3, 7.5, 5, 4);             // devant, ouverture
// petites plantes en plus, dispersées
for (const [px, pz] of [[-22, -2], [-10, -2], [-16, 8], [-7, 8], [4, 7.5], [-24, 3], [-20, -19], [6.5, -10]]) { plant(px, pz, 0.6 + Math.random() * 0.3); shadowBlob(px, pz, 0.45); }

// suspensions chaudes au-dessus des rangées de bureaux
function pendant(x, z) {
  cyl(0.01, 0.01, 1.4, new THREE.MeshStandardMaterial({ color: 0x222 }), x, 5.3, z);
  const sh = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.3, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0x2a2a30, side: THREE.DoubleSide }));
  sh.position.set(x, 4.6, z); scene.add(sh);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 12), new THREE.MeshStandardMaterial({ color: 0xc8f6ff, emissive: 0x36f0ff, emissiveIntensity: 2.6 }));
  bulb.position.set(x, 4.5, z); scene.add(bulb);
  const pl = new THREE.PointLight(0x36f0ff, 0.4, 10); pl.position.set(x, 4.3, z); scene.add(pl);
}
for (const x of [-19, -14, -9]) for (const z of [-11, -5.5]) pendant(x, z);
// horloge murale
(function(){ const cx=-6, cy=10, cz=-20.5; const face=new THREE.Mesh(new THREE.CircleGeometry(0.6,28), new THREE.MeshStandardMaterial({color:0x0c0a16,roughness:0.5,emissive:0x0a2230,emissiveIntensity:0.5})); face.position.set(cx,cy,cz); scene.add(face); const rim=new THREE.Mesh(new THREE.TorusGeometry(0.6,0.05,10,28), new THREE.MeshStandardMaterial({color:0x36f0ff,emissive:0x36f0ff,emissiveIntensity:0.9,toneMapped:false})); rim.position.set(cx,cy,cz); scene.add(rim); const hh=new THREE.Mesh(new THREE.BoxGeometry(0.05,0.32,0.02), new THREE.MeshStandardMaterial({color:0x36f0ff,emissive:0x36f0ff,emissiveIntensity:0.7})); hh.position.set(cx,cy+0.12,cz+0.04); scene.add(hh); const mh=new THREE.Mesh(new THREE.BoxGeometry(0.04,0.45,0.02), new THREE.MeshStandardMaterial({color:0x36f0ff,emissive:0x36f0ff,emissiveIntensity:0.7})); mh.position.set(cx+0.13,cy+0.05,cz+0.04); mh.rotation.z=-0.9; scene.add(mh); })();

// tapis colorés + cadres muraux (chaleur & déco)
function rug(x, z, w, d, color, rotY = 0) { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color, roughness: 1 })); m.rotation.x = -Math.PI / 2; m.rotation.z = rotY; m.position.set(x, 0.025, z); m.receiveShadow = true; scene.add(m); }
rug(-15.5, -8, 14, 9, 0x161033, 0);
for (let i = 0; i < 5; i++) box(1.3, 1.0, 0.08, new THREE.MeshStandardMaterial({ color: 0x0c0a16, emissive: [0x36f0ff,0xff3df0,0x8a5cff,0x36f0ff,0xff3df0][i], emissiveIntensity: 0.55, roughness: 0.5 }), -23 + i * 3.6, 8.5, -20.55);

// lampadaires sur pied (lumiere chaude lounge)
function floorLamp(x, z) {
  cyl(0.05, 0.07, 2.0, new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.5, metalness: 0.5 }), x, 1.0, z);
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.5, 18, 1, true), new THREE.MeshStandardMaterial({ color: 0xffd6f5, emissive: 0xff3df0, emissiveIntensity: 1.9, side: THREE.DoubleSide, roughness: 0.8 }));
  shade.position.set(x, 2.15, z); scene.add(shade);
  const pl = new THREE.PointLight(0xff3df0, 0.6, 12); pl.position.set(x, 2.0, z); scene.add(pl); shadowBlob(x, z, 0.4);
}
floorLamp(-3.5, 4.5); floorLamp(5.5, -1.5);
// plantes suspendues (verdure verticale)
function hangPlant(x, z, y) {
  cyl(0.008, 0.008, y - 4.4, new THREE.MeshStandardMaterial({ color: 0x333 }), x, (y + 4.4) / 2, z);
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.16, 0.3, 12), new THREE.MeshStandardMaterial({ color: 0xcfa46a, roughness: 0.8 })); pot.position.set(x, 4.4, z); pot.castShadow = true; scene.add(pot);
  for (let i = 0; i < 6; i++) { const a2 = i / 6 * Math.PI * 2; const v = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), i % 2 ? MAT.leaf : MAT.leaf2); v.scale.set(0.4, 1.6, 0.4); v.position.set(x + Math.cos(a2) * 0.14, 4.15, z + Math.sin(a2) * 0.14); v.rotation.x = Math.PI; scene.add(v); }
}
for (const [hx, hz] of [[-20, 0], [-12, 4], [-4, -2], [3, 5], [-23, -10]]) hangPlant(hx, hz, 6.5);
// etageres murales garnies (livres + plante)
function wallShelf(x, y) {
  box(2.6, 0.1, 0.45, MAT.woodDk, x, y, -20.5);
  const cols = [0xc96f4a, 0x4a6fb0, 0x68a357, 0xe0b34a, 0xb05a8a];
  for (let i = 0; i < 6; i++) box(0.28, 0.5, 0.07, new THREE.MeshStandardMaterial({ color: cols[i % cols.length], roughness: 0.8 }), x - 1.1 + i * 0.32, y + 0.3, -20.55);
  plant(x + 1.0, 0, 0.35, y + 0.15);
}
wallShelf(-19, 6.2); wallShelf(-19, 4.4); wallShelf(-11, 5.3);
// kitchenette + machine a cafe (le long du mur gauche)
box(2.6, 0.9, 0.7, new THREE.MeshStandardMaterial({ color: 0x1c1438, roughness: 0.7 }), -25.4, 0.45, 2.5);
box(2.6, 0.08, 0.75, new THREE.MeshStandardMaterial({ color: 0x0d0d16, roughness: 0.4, metalness: 0.4 }), -25.4, 0.92, 2.5);
box(0.4, 0.5, 0.35, new THREE.MeshStandardMaterial({ color: 0x1a1a20, roughness: 0.4, metalness: 0.3 }), -25.6, 1.2, 2.2);
cyl(0.07, 0.07, 0.16, new THREE.MeshStandardMaterial({ color: 0x36f0ff, emissive: 0x36f0ff, emissiveIntensity: 0.5 }), -25.6, 1.04, 2.7);
shadowBlob(-25.4, 2.5, 1.5, 0.5);

// ===========================================================================
//  Personnages (robots animés CC0, fallback primitif)
// ===========================================================================

const agents = new Map();
const pickables = [];
let proto = null;          // { scene, animations } (RobotExpressive, mode ?robot)
let assetsReady = false;

// --- personnages humanoïdes riggés (Quaternius Ultimate Animated Character Pack, CC0) ---
// 16 clips embarqués (Idle, Walk, Run, Jump, Victory, Defeat, SitDown…) — bien mieux que le chibi.
const QCHARS = {};
const Q_MODELS = ["Casual_Male", "Casual_Female", "Casual2_Male", "Casual2_Female", "Suit_Male", "Suit_Female", "Worker_Male", "OldClassy_Male"];
const Q_TARGET_H = 1.82; // hauteur cible (unités scène) -> échelle calculée par modèle (modèles quantifiés)
function loadQuaternius() {
  const loader = new GLTFLoader();
  return Promise.all(Q_MODELS.map((n) => new Promise((res) => {
    loader.load("./vendor/models/quaternius/characters/" + n + ".glb",
      (g) => {
        const box = new THREE.Box3().setFromObject(g.scene);
        const h = box.max.y - box.min.y;
        const scale = (h > 0.01 && isFinite(h)) ? Q_TARGET_H / h : 1;
        QCHARS[n] = { scene: g.scene, animations: g.animations, scale, foot: box.min.y * scale };
        res();
      }, undefined, () => res());
  })));
}

// statut -> clip d'animation
function clipFor(a) {
  if (a.room === "gym") {
    if (a.status === "done") return "Dance";
    const slot = a._slotKind;
    if (slot === "run") return "Running";
    if (slot === "yoga") return "Idle";
    return "Jump"; // lift
  }
  switch (a.status) {
    case "working": return "Idle";
    case "coworking": return "Idle";
    case "done": return "Dance";
    case "blocked": return "Idle";
    case "failed": return "Death";
    default: return "Idle";
  }
}

// mapping statut -> clip Quaternius (jeu de noms différent de RobotExpressive)
function clipForQ(a) {
  if (a.room === "gym") {
    if (a.status === "done") return "Victory";
    const slot = a._slotKind;
    if (slot === "run") return "Run";
    if (slot === "yoga") return "SitDown";
    return "Jump"; // lift
  }
  switch (a.status) {
    case "working": return "Idle";
    case "coworking": return "Idle";
    case "done": return "Victory";
    case "blocked": return "Idle";
    case "failed": return "Defeat";
    default: return "Idle";
  }
}

function tintRobot(root, color) {
  root.traverse((o) => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    o.frustumCulled = false; // bbox de skinning gonflée -> éviter un culling abusif
    if (o.material) {
      const m = o.material.clone();
      if (m.color) {
        const l = (m.color.r + m.color.g + m.color.b) / 3;
        if (l > 0.55) m.color.setHex(color); // teinte les parties claires
      }
      m.envMapIntensity = 0.8;
      o.material = m;
    }
  });
}

function buildRobot(a) {
  const root = cloneSkeleton(proto.scene);
  const team = hashColor(a.role + a.name);
  tintRobot(root, team);
  root.scale.setScalar(0.34); // échelle fixe (bbox de skinning non fiable)
  root.position.y = 0;        // origine du modèle = pieds
  const group = new THREE.Group(); group.add(root);

  const mixer = new THREE.AnimationMixer(root);
  const actions = {};
  proto.animations.forEach((c) => { actions[c.name] = mixer.clipAction(c); });

  const rec = finishCharacter(a, group, team, { mixer, actions, root, current: null, currentAction: null });
  rec.charType = "robot";
  return rec;
}

// personnage humanoïde riggé Quaternius : modèle choisi par hash, animations status-driven
function buildQuaternius(a) {
  const names = Object.keys(QCHARS);
  const proto = QCHARS[names[hashInt(a.id + a.name) % names.length]];
  const root = cloneSkeleton(proto.scene);
  root.traverse((o) => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
    if (o.material) { const m = o.material.clone(); m.envMapIntensity = 0.55; o.material = m; }
  });
  root.scale.setScalar(proto.scale);
  root.position.y = -(proto.foot || 0);
  const group = new THREE.Group(); group.add(root);
  const mixer = new THREE.AnimationMixer(root);
  const actions = {};
  proto.animations.forEach((c) => { actions[c.name] = mixer.clipAction(c); });
  const rec = finishCharacter(a, group, hashColor(a.role + a.name), { mixer, actions, root, current: null, currentAction: null });
  rec.charType = "q";
  return rec;
}

// petit EMPLOYÉ chibi sympathique (chemise colorée, cheveux, visage souriant)
const SHIRT_COLORS = [0x5b8cff, 0xe07a5f, 0x57a86a, 0xe0b34a, 0xa779f0, 0x4fb0c5, 0xf2849e, 0xf08a3c];
const HAIR_COLORS = [0x3a2a1a, 0x141414, 0x6b4423, 0xc9a24b, 0x8a8a8a, 0x4a2f1c];
const PANTS_COLORS = [0x33384a, 0x3a3f33, 0x4a4540, 0x2c2f38];
const SKIN_COLORS = [0xf4d3b5, 0xe8b893, 0xc88e5a, 0xf8ddc0, 0xd9a066];
function buildEmployee(a) {
  const group = new THREE.Group();
  const h = hashInt(a.role + a.name);
  const shirtHex = SHIRT_COLORS[h % SHIRT_COLORS.length];
  const shirt = new THREE.MeshStandardMaterial({ color: shirtHex, roughness: 0.78 });
  const pants = new THREE.MeshStandardMaterial({ color: PANTS_COLORS[(h >> 3) % PANTS_COLORS.length], roughness: 0.82 });
  const skin = new THREE.MeshStandardMaterial({ color: SKIN_COLORS[(h >> 5) % SKIN_COLORS.length], roughness: 0.7 });
  const hair = new THREE.MeshStandardMaterial({ color: HAIR_COLORS[(h >> 2) % HAIR_COLORS.length], roughness: 0.85 });
  const shoeMat = new THREE.MeshStandardMaterial({ color: 0x26262e, roughness: 0.6 });
  // jambes + chaussures
  const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.34, 4, 8), pants); legL.position.set(-0.13, 0.33, 0); legL.castShadow = true; group.add(legL);
  const legR = legL.clone(); legR.position.x = 0.13; group.add(legR);
  for (const sx of [-0.13, 0.13]) {
    const shoe = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), shoeMat); shoe.scale.set(1, 0.5, 1.5); shoe.position.set(sx, 0.07, 0.06); shoe.castShadow = true; group.add(shoe);
  }
  // torse animable
  const tg = new THREE.Group(); group.add(tg);
  const build = 0.29 + (h % 5) * 0.018; // carrure variable
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(build, 0.3, 6, 16), shirt); torso.position.y = 0.82; torso.castShadow = true; tg.add(torso);
  const armGeo = new THREE.CapsuleGeometry(0.08, 0.3, 4, 8);
  const armL = new THREE.Mesh(armGeo, shirt); armL.position.set(-0.35, 0.86, 0.02); armL.castShadow = true; tg.add(armL);
  const armR = new THREE.Mesh(armGeo, shirt); armR.position.set(0.35, 0.86, 0.02); armR.castShadow = true; tg.add(armR);
  for (const sx of [-0.3, 0.3]) { const hand = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), skin); hand.position.set(sx, 0.69, 0.04); tg.add(hand); }
  // grosse tête chibi
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 22, 22), skin); head.position.y = 1.42; head.castShadow = true; tg.add(head);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.36, 20, 16, 0, Math.PI * 2, 0, Math.PI / 1.7), hair); cap.position.y = 1.46; cap.castShadow = true; tg.add(cap);
  for (const sx of [-0.12, 0.12]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 10), new THREE.MeshStandardMaterial({ color: 0x2a2230 })); eye.position.set(sx, 1.43, 0.31); tg.add(eye); }
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.018, 8, 12, Math.PI), new THREE.MeshStandardMaterial({ color: 0xb5645a, roughness: 0.6 }));
  smile.position.set(0, 1.35, 0.30); smile.rotation.x = Math.PI; tg.add(smile);
  for (const sx of [-0.2, 0.2]) { const ch = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), new THREE.MeshStandardMaterial({ color: 0xf0a0a0, transparent: true, opacity: 0.55 })); ch.position.set(sx, 1.36, 0.26); ch.scale.set(1, 0.7, 0.4); tg.add(ch); }
  // ---- accessoires variés (chaque agent distinct, selon le hash) ----
  const hv = (h >> 9) % 3;
  if (hv === 1) { const pony = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), hair); pony.scale.set(0.8, 1.5, 0.8); pony.position.set(0, 1.34, -0.3); pony.castShadow = true; tg.add(pony); }      // queue de cheval
  if (hv === 2) { const bun = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 10), hair); bun.position.set(0, 1.76, -0.02); bun.castShadow = true; tg.add(bun); }                                          // chignon
  if ((h >> 11) & 1) { const gl = new THREE.MeshStandardMaterial({ color: 0x22242c, roughness: 0.4, metalness: 0.3 }); for (const sx of [-0.12, 0.12]) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.013, 8, 16), gl); r.position.set(sx, 1.43, 0.31); tg.add(r); } const br = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.014, 0.014), gl); br.position.set(0, 1.43, 0.33); tg.add(br); } // lunettes
  if ((h >> 12) & 1) { const beard = new THREE.Mesh(new THREE.SphereGeometry(0.27, 12, 10), hair); beard.scale.set(1, 0.62, 0.62); beard.position.set(0, 1.27, 0.16); beard.castShadow = true; tg.add(beard); } // barbe
  if ((h >> 13) & 1) { const tie = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.32, 0.04), new THREE.MeshStandardMaterial({ color: [0xc0392b, 0x2c3e7a, 0x27632a, 0x8e44ad][h % 4], roughness: 0.6 })); tie.position.set(0, 0.82, 0.30); tg.add(tie); } // cravate
  group.scale.setScalar(1.24 + ((h >> 7) % 5) * 0.035); // taille variable
  const rec = finishCharacter(a, group, shirtHex, null);
  rec.tg = tg; rec.armL = armL; rec.armR = armR; rec.head = head; rec.legL = legL; rec.legR = legR;
  rec.charType = "chibi";
  return rec;
}

function finishCharacter(a, group, team, anim) {
  const ringMat = new THREE.MeshStandardMaterial({ emissive: 0x4fd1c5, emissiveIntensity: 1.4, color: 0x000000 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.055, 12, 36), ringMat);
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.05; group.add(ring);
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.7), new THREE.MeshBasicMaterial({ map: SHADOW_TEX, transparent: true, depthWrite: false }));
  sh.rotation.x = -Math.PI / 2; sh.position.y = 0.04; group.add(sh);
  const label = makeLabelSprite(280, 176, () => {}); label.scale.set(3.7, 2.32, 1); label.position.y = 2.75; group.add(label);
  group.userData = { agentId: a.id };
  group.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) o.userData.agentId = a.id; });
  scene.add(group); pickables.push(group);
  return { group, ring, ringMat, label, team, anim, phase: hashInt(a.id) % 628 / 100,
    target: new THREE.Vector3(), targetY: 0, faceTarget: 0, screen: null, labelKey: "", emoteAt: 0 };
}

// humanoïdes Quaternius par défaut ; ?robot = RobotExpressive ; ?chibi = anciens chibis
const _q = new URLSearchParams(location.search);
const USE_ROBOT = _q.has("robot");
const USE_CHIBI = _q.has("chibi");
function buildCharacter(a) {
  if (USE_ROBOT && proto) return buildRobot(a);
  if (!USE_CHIBI && Object.keys(QCHARS).length) return buildQuaternius(a);
  return buildEmployee(a);
}

function playClip(rec, name) {
  if (!rec.anim) return;
  const want = rec.anim.actions[name] ? name : (rec.anim.actions.Idle ? "Idle" : null);
  if (!want || rec.anim.current === want) return;
  const next = rec.anim.actions[want];
  if (rec.anim.currentAction) rec.anim.currentAction.fadeOut(0.35);
  next.reset().fadeIn(0.35).play();
  rec.anim.currentAction = next; rec.anim.current = want;
}

function updateAgentLabel(rec, a) {
  const st = statusOf(a), act = a.lastAction || "", key = a.name + "|" + a.status + "|" + a.kind + "|" + act;
  if (rec.labelKey === key) return; rec.labelKey = key;
  const cv = rec.label.userData.tex.image, c = cv.getContext("2d"), W = cv.width;
  const hasAct = !!act, boxH = hasAct ? 128 : 78, top = 22;
  c.clearRect(0, 0, W, cv.height);
  c.fillStyle = "rgba(12,16,24,.88)"; roundRect(c, 6, top, W - 12, boxH, 16); c.fill();
  c.strokeStyle = hexCss(st.color); c.lineWidth = 2.5; roundRect(c, 6, top, W - 12, boxH, 16); c.stroke();
  c.textAlign = "center";
  c.fillStyle = "#eef3ff"; c.font = "700 27px Inter, sans-serif"; c.fillText(truncate(a.name, 18), W / 2, top + 32);
  c.font = "500 20px Inter, sans-serif"; c.fillStyle = hexCss(st.color);
  c.fillText((a.kind === "interactive" ? "🗎 " : "") + st.emoji + " " + st.label, W / 2, top + 60);
  if (hasAct) { c.font = "500 19px Inter, sans-serif"; c.fillStyle = "#cdd6ea"; c.fillText(truncate(act, 24), W / 2, top + 96); }
  rec.label.userData.tex.needsUpdate = true;
}

function layoutRoom(roomKey, list) {
  const slots = anchors[roomKey];
  list.forEach((a, i) => {
    const rec = agents.get(a.id); if (!rec) return;
    if (slots.length) {
      const slot = slots[i % slots.length], wrap = Math.floor(i / slots.length);
      rec.target.set(slot.pos.x, slot.pos.y, slot.pos.z + wrap * 2);
      rec.targetY = slot.pos.y; rec.faceTarget = slot.face || 0; rec.screen = slot.screen || null;
      a._slotKind = slot.kind || null;
    } else { rec.target.set(0, 0, 0); rec.targetY = 0; rec.faceTarget = 0; }
    rec.seated = roomKey === "office"; // assis à leur bureau (chibi)
    playClip(rec, rec.charType === "q" ? clipForQ(a) : clipFor(a));
  });
}

// ===========================================================================
//  Réconciliation
// ===========================================================================

let latestSnap = null;
function applySnapshot(snap) {
  latestSnap = snap;
  if (!document.getElementById("cto-panel").classList.contains("hidden")) renderCTO();
  const seen = new Set();
  for (const a of snap.agents) {
    seen.add(a.id);
    let rec = agents.get(a.id);
    if (!rec) { rec = buildCharacter(a); rec.group.position.set(0, 14, -6); agents.set(a.id, rec); }
    rec.data = a;
    rec.ringMat.emissive.setHex(statusOf(a).color);
    updateAgentLabel(rec, a);
  }
  for (const [id, rec] of agents) if (!seen.has(id)) { scene.remove(rec.group); const i = pickables.indexOf(rec.group); if (i >= 0) pickables.splice(i, 1); agents.delete(id); }
  for (const k of Object.keys(ROOMS)) layoutRoom(k, snap.agents.filter((a) => a.room === k));
  updateHUD(snap);
  // panneau de pilotage ouvert : rafraîchit chips/occupé/commandes en direct (sans casser l'input)
  if (selectedId && !document.getElementById("detail").classList.contains("hidden")) {
    const a2 = snap.agents.find((x) => x.id === selectedId);
    if (a2) updateControlDynamic(a2);
  }
}

// ===========================================================================
//  Animation
// ===========================================================================

const clock = new THREE.Clock();
let skyClock = 0;

// ---- Visualisation de la collaboration : nœud central + faisceaux animés ----
// Quand >= 2 agents sont en « coworking », on matérialise leur échange par un cœur
// lumineux violet à leur barycentre et des rayons le long desquels circulent des
// « paquets » (les messages qu'ils s'envoient). Purement décoratif → 100 % additif.
const collabGroup = new THREE.Group(); scene.add(collabGroup);
const collabHub = new THREE.Mesh(
  new THREE.IcosahedronGeometry(0.42, 1),
  new THREE.MeshStandardMaterial({ color: 0x2a1c44, emissive: 0xa779f0, emissiveIntensity: 1.6, roughness: 0.3, metalness: 0.2 })
);
collabHub.visible = false; collabGroup.add(collabHub);
const collabHalo = new THREE.Mesh(
  new THREE.RingGeometry(0.5, 0.62, 40),
  new THREE.MeshBasicMaterial({ color: 0xa779f0, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false })
);
collabHalo.rotation.x = -Math.PI / 2; collabHalo.visible = false; collabGroup.add(collabHalo);
const beamPool = [];
function getBeam(i) {
  if (beamPool[i]) return beamPool[i];
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(geom, new THREE.LineBasicMaterial({ color: 0xc9a8ff, transparent: true, opacity: 0.55 }));
  line.frustumCulled = false;
  const packet = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 8), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xe2d2ff, emissiveIntensity: 2 }));
  collabGroup.add(line); collabGroup.add(packet);
  return (beamPool[i] = { line, geom, packet });
}
function updateCollab(t) {
  const crew = [];
  for (const rec of agents.values()) if (rec.data && rec.data.status === "coworking") crew.push(rec);
  const active = crew.length >= 2;
  collabHub.visible = collabHalo.visible = active;
  for (const b of beamPool) { b.line.visible = false; b.packet.visible = false; }
  if (!active) return;
  let cx = 0, cz = 0; for (const rec of crew) { cx += rec.group.position.x; cz += rec.group.position.z; }
  cx /= crew.length; cz /= crew.length;
  const pulse = Math.abs(Math.sin(t * 2.5)), hubY = 2.6 + Math.sin(t * 1.5) * 0.12;
  collabHub.position.set(cx, hubY, cz);
  collabHub.rotation.set(t * 0.4, t * 0.6, 0);
  collabHub.material.emissiveIntensity = 1.3 + pulse * 0.9;
  collabHalo.position.set(cx, 0.06, cz); collabHalo.scale.setScalar(1 + pulse * 0.55);
  collabHalo.material.opacity = 0.45 - pulse * 0.3;
  crew.forEach((rec, i) => {
    const b = getBeam(i); b.line.visible = true; b.packet.visible = true;
    const p = rec.group.position, hy = 1.7, arr = b.geom.attributes.position.array;
    arr[0] = p.x; arr[1] = hy; arr[2] = p.z; arr[3] = cx; arr[4] = hubY; arr[5] = cz;
    b.geom.attributes.position.needsUpdate = true;
    b.line.material.opacity = 0.28 + Math.abs(Math.sin(t * 2 + i)) * 0.42;
    const u = (t * 0.6 + i * 0.31) % 1; // paquet agent -> hub
    b.packet.position.set(p.x + (cx - p.x) * u, hy + (hubY - hy) * u, p.z + (cz - p.z) * u);
  });
}

// ---- Halo de sélection : cercle au sol sous l'agent ouvert dans le panneau ----
let selectedId = null;
const selRing = new THREE.Mesh(
  new THREE.RingGeometry(0.72, 0.9, 56),
  new THREE.MeshBasicMaterial({ color: 0x5b8cff, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })
);
selRing.rotation.x = -Math.PI / 2; selRing.visible = false; scene.add(selRing);
function updateSelection(t) {
  const rec = selectedId && agents.get(selectedId);
  if (!rec || !rec.data) { selRing.visible = false; return; }
  selRing.visible = true;
  selRing.position.set(rec.group.position.x, 0.07, rec.group.position.z);
  selRing.scale.setScalar(1 + Math.abs(Math.sin(t * 3)) * 0.12);
  selRing.material.color.setHex(statusOf(rec.data).color);
  selRing.material.opacity = 0.6 + Math.abs(Math.sin(t * 3)) * 0.35;
}

// ---- Visée 1re personne : anneau au sol sur la cible + réticule HTML « E » ----
const tgtRing = new THREE.Mesh(
  new THREE.RingGeometry(0.78, 1.0, 56),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
);
tgtRing.rotation.x = -Math.PI / 2; tgtRing.visible = false; scene.add(tgtRing);
const reticleEl = document.getElementById("reticle");
const reticlePrompt = document.getElementById("reticle-prompt");
function updateFpReticle(t) {
  if (!fpMode || fpPanelOpen) { reticleEl.classList.add("hidden"); tgtRing.visible = false; return; }
  reticleEl.classList.remove("hidden");
  const rec = nearestAgentInReach();
  if (!rec || !rec.data) {
    reticleEl.classList.remove("active"); tgtRing.visible = false; return;
  }
  reticleEl.classList.add("active");
  reticlePrompt.textContent = `E · ${rec.data.name}`;
  const col = statusOf(rec.data).color;
  tgtRing.visible = true;
  tgtRing.position.set(rec.group.position.x, 0.08, rec.group.position.z);
  tgtRing.scale.setScalar(1 + Math.abs(Math.sin(t * 4)) * 0.1);
  tgtRing.material.color.setHex(col);
  tgtRing.material.opacity = 0.55 + Math.abs(Math.sin(t * 4)) * 0.4;
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  if (t - skyClock > 0.05) { for (const s of SKIES) updateSky(s, t - skyClock, t); skyClock = t; } // vitres animées (~20 fps)
  for (const rec of agents.values()) {
    const a = rec.data; if (!a) continue;
    if (rec.anim) rec.anim.mixer.update(dt);
    const g = rec.group;
    g.position.x += (rec.target.x - g.position.x) * 0.06;
    g.position.y += (rec.target.y - g.position.y) * 0.08;
    g.position.z += (rec.target.z - g.position.z) * 0.06;
    let dy = rec.faceTarget - g.rotation.y; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
    g.rotation.y += dy * 0.08;
    // animation procédurale des employés chibi
    if (rec.tg) {
      const ph = rec.phase, tg = rec.tg;
      tg.position.y = 0; tg.rotation.set(0, 0, 0); rec.armL.rotation.set(0, 0, 0); rec.armR.rotation.set(0, 0, 0); rec.head.rotation.set(0, 0, 0);
      rec.legL.rotation.set(0, 0, 0); rec.legL.position.set(-0.13, 0.33, 0); rec.legR.rotation.set(0, 0, 0); rec.legR.position.set(0.13, 0.33, 0);
      switch (a.status) {
        case "working":
          tg.rotation.x = 0.14; tg.position.y = Math.sin(t * 7 + ph) * 0.012;
          rec.armL.rotation.x = -0.85 + Math.sin(t * 9 + ph) * 0.3; rec.armR.rotation.x = -0.85 + Math.sin(t * 9 + ph + 1) * 0.3; break;
        case "coworking":
          tg.rotation.z = Math.sin(t * 1.2 + ph) * 0.06; rec.armR.rotation.x = -0.4 + Math.sin(t * 2 + ph) * 0.6; rec.head.rotation.y = Math.sin(t * 0.8 + ph) * 0.3; break;
        case "idle": case "queued": {
          const hop = Math.max(0, Math.sin(t * 3 + ph)); tg.position.y = hop * 0.12; rec.armL.rotation.z = 0.4 + hop * 1.5; rec.armR.rotation.z = -0.4 - hop * 1.5; break;
        }
        case "blocked": rec.head.rotation.z = Math.sin(t * 2 + ph) * 0.18; rec.armR.rotation.x = -1.5 + Math.sin(t * 3 + ph) * 0.2; break;
        case "failed": rec.head.rotation.x = 0.25; break;
        default: tg.position.y = Math.sin(t * 1.5 + ph) * 0.02;
      }
      if (rec.seated) {
        tg.position.y -= 0.18;
        for (const lg of [rec.legL, rec.legR]) { lg.rotation.x = -1.4; lg.position.y = 0.46; lg.position.z = 0.2; }
      }
    }
    rec.ring.rotation.z = t * 0.5;
    if (a.status === "blocked" || a.status === "failed") rec.ringMat.emissiveIntensity = 0.8 + Math.abs(Math.sin(t * 4 + rec.phase)) * 1.1;
    else rec.ringMat.emissiveIntensity = 1.3;
    if (rec.screen) rec.screen.emissiveIntensity = a.status === "working" ? 0.8 + Math.abs(Math.sin(t * 5 + rec.phase)) * 0.7 : 0.4;
    // émote ponctuelle
    if (rec.anim && (a.status === "coworking" || a.status === "blocked") && t - rec.emoteAt > 6) {
      rec.emoteAt = t + Math.random() * 4;
      const em = rec.charType === "q"
        ? (a.status === "blocked" ? "RecieveHit" : "Victory")
        : (a.status === "blocked" ? "No" : (Math.random() > 0.5 ? "Wave" : "Yes"));
      const act = rec.anim.actions[em];
      if (act) { act.reset(); act.setLoop(THREE.LoopOnce, 1); act.clampWhenFinished = false; act.fadeIn(0.2).play(); }
    }
  }
  if (fpMode) {
    const sp = dt * 7;
    if (fpKeys.forward) fp.moveForward(sp);
    if (fpKeys.back) fp.moveForward(-sp);
    if (fpKeys.left) fp.moveRight(-sp);
    if (fpKeys.right) fp.moveRight(sp);
    // hauteur du sol sous les pieds (escalier + mezzanine) -> on monte vraiment les marches
    const floorH = floorHeightAt(camera.position.x, camera.position.z);
    camera.position.y += ((floorH + 1.7) - camera.position.y) * 0.25;
    camera.position.x = Math.max(-26, Math.min(26.5, camera.position.x));
    camera.position.z = Math.max(-20, Math.min(14, camera.position.z));
  } else {
    controls.update();
  }
  updateCollab(t);
  updateSelection(t);
  updateFpReticle(t);
  if (gradePass) gradePass.uniforms.uTime.value = t;
  if (gridMat) gridMat.uniforms.uTime.value = t;
  for (const f of cyberAnim) f(t);
  if (composer) composer.render(); else renderer.render(scene, camera);
}
animate();

// ===========================================================================
//  Interaction / détails
// ===========================================================================

const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(); let downXY = null;
renderer.domElement.addEventListener("pointerdown", (e) => { downXY = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener("pointerup", (e) => {
  if (!downXY) return; const moved = Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]); downXY = null; if (moved > 6) return;
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1; pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(pickables, true);
  if (hits.length) { let o = hits[0].object; while (o && !o.userData.agentId) o = o.parent; if (o) openDetail(o.userData.agentId); }
});
function openDetail(id) {
  const rec = agents.get(id); if (!rec || !rec.data) return; const a = rec.data, st = statusOf(a);
  document.getElementById("detail-name").textContent = a.name;
  const role = document.getElementById("detail-role");
  role.textContent = "🤖 " + a.role + " · " + (a.kind === "interactive" ? "session interactive" : "job de fond") + " · " + st.emoji + " " + st.label;
  role.style.color = hexCss(st.color);
  const rel = (ms) => { const s = Math.floor(ms / 1000); if (s < 60) return s + "s"; if (s < 3600) return Math.floor(s / 60) + "min"; return Math.floor(s / 3600) + "h " + Math.floor((s % 3600) / 60) + "min"; };
  const rows = [
    ["📍 Machine", a.host || "local"],
    ["Salle", { office: "🏢 Bureau", coworking: "🤝 Coworking", gym: "🏋️ Gym" }[a.room]],
    ["Projet", a.project], a.gitBranch ? ["Branche git", a.gitBranch] : null,
    a.model ? ["Modèle", a.model] : null,
    (a.tokens ? ["Tokens", fmtTokens(a.tokens) + "  ·  " + fmtCost(a.costUsd) + " est."] : null),
    ["Tâches en vol", a.inFlightTasks + (a.queued ? ` (+${a.queued} en file)` : "")],
    ["Sous-agents", a.childrenCount || 0],
    ["Actif depuis", rel(a.ageMs)], ["Dernière MAJ", "il y a " + rel(a.sinceUpdateMs)],
    a.intent ? ["Mission", a.intent] : null, a.detail ? ["Dernier état", a.detail] : null,
  ].filter(Boolean);
  document.getElementById("detail-body").innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(String(v))}</dd>`).join("");
  document.getElementById("detail").classList.remove("hidden");
  selectedId = id; highlightRosterCard();
  startFeed(id);
  renderControl(a);
}
function highlightRosterCard() {
  document.querySelectorAll("#roster-list .card").forEach((el) => el.classList.toggle("active", el.dataset.id === selectedId));
}

// ---- contrôle bidirectionnel (agents pilotés) ----
let pendingImage = null; // image collée à joindre au prochain message
let slashList = []; // commandes / annoncées par l'agent (custom / skills / projet)
function renderControl(a) {
  const el = document.getElementById("detail-control");
  pendingImage = null;
  slashList = a.slashCommands || [];
  const danger = ["bypassPermissions", "dontAsk", "auto"].includes(a.perm);
  const permNote = danger
    ? `Permissions : <b style="color:var(--failed)">${escapeHtml(a.perm)}</b> — ⚠️ PEUT push/merge/deploy/supprimer <b>sans validation</b>.`
    : `Permissions : <b>${escapeHtml(a.perm || "acceptEdits")}</b> — pas de push/merge/deploy sans validation.`;
  el.innerHTML = `<div class="ctrl-title">🎮 Piloter l'agent ${a.managed ? "" : "<span style='color:var(--muted);text-transform:none;letter-spacing:0'>· session du PC (reprend sa conversation)</span>"}</div>
    <div id="ctrl-suggest" class="ctrl-suggest hidden"></div>
    <div class="ctrl-row ctrl-input-row">
      <button class="ctrl-btn" id="ctrl-clip" title="Joindre des fichiers (ou glisser-déposer / coller)" style="background:rgba(91,140,255,.18);color:var(--txt)">📎</button>
      <input id="ctrl-input" autocomplete="off" placeholder="Message / follow-up…  ( / commandes · 📎 / glisser / coller = fichiers )" />
      <button class="ctrl-btn ctrl-send" id="ctrl-send">Envoyer</button>
      <button class="ctrl-btn ctrl-stop" id="ctrl-stop" style="display:none">Stop</button>
      <div id="ctrl-slash" class="ctrl-slash hidden"></div>
    </div>
    <div id="ctrl-busy" class="ctrl-busy hidden">⏳ l'agent réfléchit… ton message sera enchaîné à la suite</div>
    <div id="ctrl-att" class="ctrl-tray hidden"></div>
    <input id="ctrl-file" type="file" multiple hidden />
    <div class="ctrl-title" style="margin-top:12px">📁 Répertoire de travail (cd)</div>
    <div class="ctrl-row">
      <input id="ctrl-cd" value="${escapeHtml(a.cwd || "")}" placeholder="/chemin/projet" />
      <button class="ctrl-btn" id="ctrl-cd-browse" style="background:rgba(91,140,255,.18);color:var(--txt)">…</button>
      <button class="ctrl-btn ctrl-send" id="ctrl-cd-go">Déplacer ici</button>
    </div>
    <div class="ctrl-row" style="margin-top:12px">
      <button class="ctrl-btn" id="ctrl-train" style="flex:1;background:rgba(104,211,153,.18);color:var(--done)">🏋️ Terminer → Gym (s'améliorer)</button>
    </div>
    <div class="ctrl-row" style="margin-top:8px">
      <button class="ctrl-btn ctrl-stop" id="ctrl-kill" style="flex:1">✖️ Fermer / tuer la session</button>
    </div>
    <div class="ctrl-note">${permNote}</div>`;
  const post = (url, body) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
  const input = document.getElementById("ctrl-input"), send = document.getElementById("ctrl-send");
  const slashDD = document.getElementById("ctrl-slash");
  // pièces jointes (réinitialisées à chaque ouverture du panneau)
  ctrlAtt = [];
  const attList = document.getElementById("ctrl-att");
  const clip = document.getElementById("ctrl-clip"), fileIn = document.getElementById("ctrl-file");
  if (clip) clip.onclick = () => fileIn.click();
  if (fileIn) fileIn.onchange = (e) => { attAddFiles(e.target.files, ctrlAtt, attList); e.target.value = ""; };
  wireFleetDrop(el, ctrlAtt, attList);
  const doSend = async () => {
    const prompt = input.value.trim(); const files = attReadyIds(ctrlAtt);
    if (!prompt && !files.length) return;
    if (ctrlAtt.some((a) => a.pending)) return;
    slashDD.classList.add("hidden");
    const j = await post("/api/send", { id: a.id, prompt, attachments: files, origin: "3d" }).catch(() => ({ ok: false, error: "réseau" }));
    if (!j.ok) { alert("Erreur : " + (j.error || "échec")); return; }
    input.value = ""; ctrlAtt = []; renderAtt(attList, ctrlAtt);
  };
  if (send) send.onclick = doSend;
  if (input) {
    input.addEventListener("input", () => renderSlash(input, slashDD));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { slashDD.classList.add("hidden"); return; }
      if (e.key === "Enter") { slashDD.classList.add("hidden"); doSend(); }
    });
    input.addEventListener("blur", () => setTimeout(() => slashDD.classList.add("hidden"), 150));
    // coller des fichiers (image ou autre) -> joints au prochain message
    input.addEventListener("paste", (e) => {
      const files = [...(e.clipboardData?.items || [])].filter((it) => it.kind === "file").map((it) => it.getAsFile()).filter(Boolean);
      if (files.length) { e.preventDefault(); attAddFiles(files, ctrlAtt, attList); }
    });
  }
  const stop = document.getElementById("ctrl-stop"); if (stop) stop.onclick = () => post("/api/stop", { id: a.id });
  // changer de répertoire
  const cdBrowse = document.getElementById("ctrl-cd-browse");
  if (cdBrowse) cdBrowse.onclick = () => { fsTarget = "ctrl-cd"; document.getElementById("fs-picker").classList.remove("hidden"); fsLoad(document.getElementById("ctrl-cd").value); };
  const cdGo = document.getElementById("ctrl-cd-go");
  if (cdGo) cdGo.onclick = async () => { const cwd = document.getElementById("ctrl-cd").value.trim(); if (!cwd) return; const j = await post("/api/cd", { id: a.id, cwd }); if (!j.ok) alert("Erreur : " + j.error); else cdGo.textContent = "✓"; };
  // terminer -> gym
  const train = document.getElementById("ctrl-train");
  if (train) train.onclick = async () => { train.disabled = true; const j = await post("/api/train", { id: a.id }); if (!j.ok) { alert("Erreur : " + j.error); train.disabled = false; } };
  // fermer / tuer la session
  const kill = document.getElementById("ctrl-kill");
  if (kill) kill.onclick = async () => { if (!confirm("Fermer définitivement la session de « " + a.name + " » ? (le process est tué)")) return; await post("/api/kill", { id: a.id }); closeDetail(); };
  updateControlDynamic(a);
}

// Met à jour les éléments dynamiques (chips de follow-up, état « occupé », commandes /) à chaque
// snapshot SANS détruire l'input en cours de saisie -> les suggestions apparaissent en direct.
function updateControlDynamic(a) {
  if (!a || a.id !== selectedId) return;
  if (a.slashCommands) slashList = a.slashCommands;
  const stop = document.getElementById("ctrl-stop"); if (stop) stop.style.display = a.busy ? "" : "none";
  const busyEl = document.getElementById("ctrl-busy"); if (busyEl) busyEl.classList.toggle("hidden", !a.busy);
  const sg = document.getElementById("ctrl-suggest");
  if (sg) {
    const input = document.getElementById("ctrl-input");
    if (a.suggestion && !a.busy) {
      sg.classList.remove("hidden");
      sg.innerHTML = `<span class="sg-label">💡 suite :</span> <button class="sg-chip" type="button"></button>`;
      const chip = sg.querySelector(".sg-chip"); chip.textContent = a.suggestion;
      chip.onclick = () => { if (input) { input.value = a.suggestion; input.focus(); } };
    } else { sg.classList.add("hidden"); sg.innerHTML = ""; }
  }
}

// Autocomplétion des commandes / : se déclenche pendant la saisie du nom (avant tout espace).
function renderSlash(input, dd) {
  const m = input.value.match(/^\/([^\s]*)$/);
  if (!m) { dd.classList.add("hidden"); return; }
  const q = m[1].toLowerCase();
  const matches = (slashList || []).filter((c) => c.toLowerCase().includes(q)).slice(0, 8);
  if (!matches.length) { dd.classList.add("hidden"); return; }
  dd.innerHTML = matches.map((c) => `<div class="slash-item">/${escapeHtml(c)}</div>`).join("");
  dd.classList.remove("hidden");
  [...dd.children].forEach((elc, i) => { elc.onmousedown = (e) => { e.preventDefault(); input.value = "/" + matches[i] + " "; dd.classList.add("hidden"); input.focus(); }; });
}

// ---- formulaire de recrutement (Nouvel agent) ----
// === PIÈCES JOINTES (upload → orchestrateur → machine RÉELLE de l'agent) ==============
// L'orchestrateur reçoit le fichier (POST /api/upload, streamé) et le livre via SSH/SCP dans
// ~/.fleet/inbox/<session> sur la machine de l'agent ; le prompt reçoit le chemin absolu.
let ctrlAtt = [], spawnAtt = [];
function fmtBytes(n) { n = n || 0; return n >= 1048576 ? (n / 1048576).toFixed(1) + " Mo" : n >= 1024 ? Math.round(n / 1024) + " Ko" : n + " o"; }
function attReadyIds(arr) { return arr.filter((a) => a.uploadId).map((a) => a.uploadId); }
function renderAtt(listEl, arr) {
  if (!listEl) return;
  listEl.classList.toggle("hidden", arr.length === 0);
  listEl.innerHTML = arr.map((a, i) => `<span class="fchip ${a.pending ? "pending" : ""}"><span>${a.pending ? "⏳" : "📎"}</span> <span class="nm">${escapeHtml(a.name)}</span> <small>${a.size != null ? fmtBytes(a.size) : ""}</small><button class="fx" data-rm="${i}" title="retirer">✕</button></span>`).join("");
  listEl.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); arr.splice(+b.dataset.rm, 1); renderAtt(listEl, arr); }));
}
async function attUploadOne(file, arr, listEl) {
  const item = { name: file.name, size: file.size, pending: true, uploadId: null };
  arr.push(item); renderAtt(listEl, arr);
  try {
    const r = await fetch("/api/upload", { method: "POST", headers: { "X-Filename": encodeURIComponent(file.name) }, body: file });
    const j = await r.json();
    if (j.ok) { item.uploadId = j.uploadId; item.pending = false; item.size = j.size; }
    else { const k = arr.indexOf(item); if (k >= 0) arr.splice(k, 1); }
  } catch { const k = arr.indexOf(item); if (k >= 0) arr.splice(k, 1); }
  renderAtt(listEl, arr);
}
function attAddFiles(files, arr, listEl) { [...files].forEach((f) => attUploadOne(f, arr, listEl)); }
function wireFleetDrop(zone, arr, listEl) {
  if (!zone) return;
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("drag"); });
  zone.addEventListener("dragleave", (e) => { if (e.target === zone) zone.classList.remove("drag"); });
  zone.addEventListener("drop", (e) => { e.preventDefault(); zone.classList.remove("drag"); if (e.dataTransfer && e.dataTransfer.files.length) attAddFiles(e.dataTransfer.files, arr, listEl); });
}

const spawnModal = document.getElementById("spawn-modal");
function val(id) { return document.getElementById(id).value.trim(); }
function populatePerms(selId = "sp-perm") {
  const sel = document.getElementById(selId);
  const unsafe = latestSnap && latestSnap.allowUnsafe;
  const base = [["acceptEdits", "Édite fichiers (sûr)"], ["plan", "Plan (lecture seule)"], ["default", "Strict (tout valider)"]];
  const danger = [["bypassPermissions", "⚠️ bypassPermissions — AUCUNE limite"], ["dontAsk", "⚠️ dontAsk — ne demande jamais"], ["auto", "⚠️ auto"]];
  sel.innerHTML = (unsafe ? base.concat(danger) : base).map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
  if (selId !== "sp-perm") return;
  const note = document.querySelector(".spawn-note");
  if (note) note.innerHTML = unsafe
    ? "⚠️ Modes dangereux ACTIVÉS : <b>bypassPermissions/dontAsk/auto</b> laissent l'agent agir (push/merge/deploy) <b>sans validation</b>. À utiliser en connaissance de cause."
    : "🔒 Aucun mode ici ne permet push/merge/deploy sans validation — conforme au cahier des charges. (Pour débloquer les modes avancés, relance le serveur avec <code>FLEET_ALLOW_UNSAFE_PERMS=1</code>.)";
}
function populateTeams() {
  const sel = document.getElementById("sp-team"); if (!sel) return;
  const teams = (latestSnap && latestSnap.teams) || [];
  sel.innerHTML = `<option value="">Aucune (autonome)</option>` + teams.map((t) => {
    const label = (t.name || t.goal || ("Équipe " + t.id)).slice(0, 42) + ` · ${t.members.length} agent${t.members.length > 1 ? "s" : ""}`;
    return `<option value="${t.id}">${escapeHtml(label)}</option>`;
  }).join("");
}
// Sélecteur de machine (local + nœuds Tailscale) — l'agent peut tourner sur n'importe quel nœud via SSH.
async function populateHosts() {
  const sel = document.getElementById("sp-host"); if (!sel) return;
  try {
    const r = await fetch("/api/hosts", { cache: "no-store" }); const j = await r.json();
    const hosts = (j.hosts && j.hosts.length) ? j.hosts : [{ id: "local", label: "local", online: true }];
    sel.innerHTML = hosts.map((h) => `<option value="${escapeHtml(h.id)}"${h.online ? "" : " disabled"}>${escapeHtml(h.label)}${h.id === "local" ? "" : " · " + escapeHtml(h.ip || "") + (h.online ? "" : " (hors-ligne)")}</option>`).join("");
  } catch { sel.innerHTML = `<option value="local">cette machine · local</option>`; }
  sel.onchange = updateHostHint; updateHostHint();
}
function updateHostHint() {
  const host = (document.getElementById("sp-host") || {}).value || "local";
  const remote = host !== "local";
  const browse = document.querySelector('#spawn-modal .fs-browse[data-target="sp-cwd"]');
  if (browse) { browse.disabled = remote; browse.style.opacity = remote ? 0.4 : 1; browse.title = remote ? "indispo pour une machine distante" : "Parcourir…"; }
  const cwd = document.getElementById("sp-cwd");
  if (cwd) cwd.placeholder = remote ? `/chemin/sur/${host}` : "/home/imhax0x90/Bureau/Projects/api";
}
document.getElementById("add-agent").onclick = () => { populatePerms(); populateTeams(); populateHosts(); spawnAtt = []; renderAtt(document.getElementById("sp-attach-list"), spawnAtt); spawnModal.classList.remove("hidden"); document.getElementById("sp-name").focus(); };
// pièces jointes du déploiement (bureau 3D)
(() => {
  const clip = document.getElementById("sp-clip"), fileIn = document.getElementById("sp-file"), list = document.getElementById("sp-attach-list");
  if (clip) clip.onclick = () => fileIn.click();
  if (fileIn) fileIn.onchange = (e) => { attAddFiles(e.target.files, spawnAtt, list); e.target.value = ""; };
  wireFleetDrop(document.getElementById("sp-attach"), spawnAtt, list);
})();
document.getElementById("spawn-close").onclick = () => spawnModal.classList.add("hidden");
spawnModal.addEventListener("click", (e) => { if (e.target === spawnModal) spawnModal.classList.add("hidden"); });
document.getElementById("spawn-go").onclick = async () => {
  const go = document.getElementById("spawn-go"), err = document.getElementById("spawn-err");
  const body = { name: val("sp-name"), role: val("sp-role"), cwd: val("sp-cwd"), prompt: val("sp-prompt"), model: val("sp-model"), perm: val("sp-perm"), host: val("sp-host") || "local", teamId: val("sp-team") || undefined, attachments: attReadyIds(spawnAtt) };
  if (!body.cwd || !body.prompt) { err.textContent = "Workspace et mission sont requis."; return; }
  if (spawnAtt.some((a) => a.pending)) { err.textContent = "Upload de pièce jointe en cours…"; return; }
  go.disabled = true; go.textContent = "🚀 Lancement…"; err.textContent = "";
  try {
    const r = await fetch("/api/spawn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json(); if (!j.ok) throw new Error(j.error || "échec");
    spawnAtt = []; renderAtt(document.getElementById("sp-attach-list"), spawnAtt);
    spawnModal.classList.add("hidden");
  } catch (e) { err.textContent = "Erreur : " + e.message; }
  finally { go.disabled = false; go.textContent = "🚀 Lancer la mission"; }
};

// ---- explorateur de dossiers (bouton …) ----
let fsCurrent = null;
async function fsLoad(p) {
  try {
    const r = await fetch("/api/ls?path=" + encodeURIComponent(p || ""), { cache: "no-store" });
    const j = await r.json();
    const pathEl = document.getElementById("fs-path"), list = document.getElementById("fs-list");
    if (j.error) { pathEl.textContent = "⚠️ " + j.error; return; }
    fsCurrent = j.path; pathEl.textContent = j.path;
    let html = "";
    if (j.parent) html += `<div class="fs-item" data-p="${encodeURIComponent(j.parent)}">⬆️ ..</div>`;
    html += j.dirs.map((d) => `<div class="fs-item" data-p="${encodeURIComponent(j.path.replace(/\/$/, "") + "/" + d)}">📁 ${escapeHtml(d)}</div>`).join("");
    list.innerHTML = html || `<div class="fs-item">(aucun sous-dossier)</div>`;
    list.querySelectorAll(".fs-item[data-p]").forEach((el) => (el.onclick = () => fsLoad(decodeURIComponent(el.dataset.p))));
  } catch (e) { document.getElementById("fs-path").textContent = "⚠️ " + e.message; }
}
let fsTarget = "sp-cwd";
document.querySelectorAll(".fs-browse").forEach((btn) => (btn.onclick = () => { fsTarget = btn.dataset.target; document.getElementById("fs-picker").classList.remove("hidden"); fsLoad(val(fsTarget)); }));
document.getElementById("fs-cancel").onclick = () => document.getElementById("fs-picker").classList.add("hidden");
document.getElementById("fs-pick").onclick = () => { if (fsCurrent) document.getElementById(fsTarget).value = fsCurrent; document.getElementById("fs-picker").classList.add("hidden"); };

// ---- mission d'équipe (collaboration multi-agents) ----
const teamModal = document.getElementById("team-modal");
function populateChief() {
  const sel = document.getElementById("tm-chief"); if (!sel) return;
  const prev = sel.value;
  const roles = [...document.querySelectorAll("#tm-roles input:checked")].map((c) => c.value);
  const agents = ((latestSnap && latestSnap.agents) || []).filter((a) => a.managed);
  let html = `<optgroup label="Nouveau rôle (créé)">` + (roles.length ? roles.map((r) => `<option value="${r}">${r}</option>`).join("") : `<option value="">(coche un rôle)</option>`) + `</optgroup>`;
  if (agents.length) html += `<optgroup label="Agent existant">` + agents.map((a) => `<option value="agent:${a.id}">${escapeHtml(a.name)} · ${escapeHtml(a.role)}</option>`).join("") + `</optgroup>`;
  sel.innerHTML = html;
  if (prev) sel.value = prev;
}
// rôles personnalisables, partagés via /api/roles (mêmes métiers que la console & l'APK)
let rolesCache = ["Architecte", "Backend", "Frontend", "DevOps", "QA"];
const DEFAULT_CHECKED = new Set(["Architecte", "Backend", "Frontend"]);
function renderRoles(checkedSet) {
  const box = document.getElementById("tm-roles"); if (!box) return;
  box.innerHTML = rolesCache.map((r) => {
    const on = checkedSet ? checkedSet.has(r) : DEFAULT_CHECKED.has(r);
    return `<label><input type="checkbox" value="${escapeHtml(r)}" ${on ? "checked" : ""}/> ${escapeHtml(r)}</label>`;
  }).join("");
  box.querySelectorAll("input").forEach((c) => c.addEventListener("change", populateChief));
}
async function loadRoles(checkedSet) {
  try { const r = await fetch("/api/roles", { cache: "no-store" }); const j = await r.json(); if (j.roles && j.roles.length) rolesCache = j.roles; } catch { /* défauts */ }
  renderRoles(checkedSet); populateChief();
}
async function addRole() {
  const inp = document.getElementById("tm-newrole"), v = inp.value.trim(); if (!v) return;
  const checked = new Set([...document.querySelectorAll("#tm-roles input:checked")].map((c) => c.value)); checked.add(v);
  try {
    const r = await fetch("/api/roles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: v }) });
    const j = await r.json(); if (!j.ok) throw new Error(j.error || "échec");
    rolesCache = j.roles || rolesCache; inp.value = "";
    renderRoles(checked); populateChief();
  } catch (e) { const err = document.getElementById("team-err"); if (err) err.textContent = "Erreur métier : " + e.message; }
}
document.getElementById("tm-addrole").onclick = addRole;
document.getElementById("tm-newrole").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addRole(); } });
document.getElementById("add-team").onclick = () => { populatePerms("tm-perm"); loadRoles(); teamModal.classList.remove("hidden"); };
document.getElementById("team-close").onclick = () => teamModal.classList.add("hidden");
teamModal.addEventListener("click", (e) => { if (e.target === teamModal) teamModal.classList.add("hidden"); });
document.getElementById("team-go").onclick = async () => {
  const go = document.getElementById("team-go"), err = document.getElementById("team-err");
  const roles = [...document.querySelectorAll("#tm-roles input:checked")].map((c) => c.value);
  const body = { name: val("tm-name"), goal: val("tm-goal"), cwd: val("tm-cwd"), model: val("tm-model"), perm: val("tm-perm"), roles, chief: val("tm-chief") };
  if (!body.cwd || !body.goal) { err.textContent = "Objectif et workspace requis."; return; }
  if (!roles.length) { err.textContent = "Choisis au moins un rôle."; return; }
  go.disabled = true; go.textContent = "🚀 Lancement…"; err.textContent = "";
  try {
    const r = await fetch("/api/team", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json(); if (!j.ok) throw new Error(j.error || "échec");
    teamModal.classList.add("hidden");
  } catch (e) { err.textContent = "Erreur : " + e.message; }
  finally { go.disabled = false; go.textContent = "🚀 Lancer l'équipe"; }
};

// ---- flux "live Claude Code" (lecture seule, polling) ----
let feedTimer = null, feedId = null;
const FEED_KIND = { say: "🤖", prompt: "🧑", think: "💭", tool: "▸", result: "↳" };
async function pollFeed() {
  if (!feedId) return;
  try {
    const r = await fetch("/api/transcript?id=" + encodeURIComponent(feedId) + "&n=60", { cache: "no-store" });
    const j = await r.json();
    const el = document.getElementById("detail-feed");
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    el.innerHTML = (j.feed || []).map((e) => `<div class="fe ${e.kind}">${FEED_KIND[e.kind] || ""} ${escapeHtml(e.text)}</div>`).join("")
      || `<div class="fe think">En attente d'activité…</div>`;
    if (atBottom) el.scrollTop = el.scrollHeight;
  } catch { /* ignore */ }
}
function startFeed(id) { feedId = id; document.getElementById("detail-feed").innerHTML = `<div class="fe think">Chargement…</div>`; pollFeed(); clearInterval(feedTimer); feedTimer = setInterval(pollFeed, 1600); }
function stopFeed() { feedId = null; clearInterval(feedTimer); feedTimer = null; }
function closeDetail() {
  document.getElementById("detail").classList.add("hidden"); stopFeed(); selectedId = null; highlightRosterCard();
  // ouvert depuis la 1re personne : on re-verrouille le curseur pour reprendre la marche
  if (fpMode && fpPanelOpen) { fpPanelOpen = false; try { fp.lock(); } catch { /* ignore */ } }
}

document.getElementById("detail-close").onclick = closeDetail;
document.getElementById("roster-search")?.addEventListener("input", () => { if (latestSnap) updateHUD(latestSnap); });
window.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeDetail(); document.getElementById("cto-panel").classList.add("hidden"); } });
function escapeHtml(s) { return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

// ===========================================================================
//  HUD
// ===========================================================================

const lastFeedKey = new Map();
function updateHUD(snap) {
  const s = snap.byStatus, cto = snap.cto || { tokens: 0, costUsd: 0 };
  document.getElementById("stats").innerHTML = [
    ["agents", snap.total, "#c8d8ff"], ["actifs", s.working || 0, "#57d977"],
    ["cowork", snap.counts.coworking || 0, "#a779f0"], ["attente", s.blocked || 0, "#f6ad55"],
    ["tokens", fmtTokens(cto.tokens), "#9fc0ff"], ["coût est.", fmtCost(cto.costUsd), "#ffd35c"],
  ].map(([l, n, c]) => `<div class="stat"><div class="n" style="color:${c}">${n}</div><div class="l">${l}</div></div>`).join("");
  document.getElementById("roster-count").textContent = snap.total;
  const list = document.getElementById("roster-list");
  const q = (document.getElementById("roster-search")?.value || "").trim().toLowerCase();
  const shown = q ? snap.agents.filter((a) => `${a.name} ${a.role} ${a.project} ${statusOf(a).label}`.toLowerCase().includes(q)) : snap.agents;
  list.innerHTML = shown.map((a) => { const st = statusOf(a), col = hexCss(hashColor(a.role + a.name)); return `<div class="card" data-id="${a.id}"><div class="av" style="background:${col}">${(a.name[0] || "?").toUpperCase()}</div><div class="meta"><div class="nm">${escapeHtml(a.name)}</div><div class="ro">${a.kind === "interactive" ? "🗎" : "⚙️"} ${escapeHtml(a.role)} · ${escapeHtml(a.project)}${a.host ? ` · 📍${escapeHtml(a.host)}` : ""}</div></div><div class="st ${st.css}">${st.emoji}</div><button class="card-x" data-kill="${a.id}" title="Supprimer l'agent">✕</button></div>`; }).join("") || `<p style="color:var(--muted);font-size:12px">${q ? "Aucun agent ne correspond." : "Aucun agent en cours."}</p>`;
  list.querySelectorAll(".card").forEach((el) => (el.onclick = () => openDetail(el.dataset.id)));
  highlightRosterCard();
  list.querySelectorAll(".card-x").forEach((el) => (el.onclick = async (e) => { e.stopPropagation(); if (!confirm("Supprimer / tuer cet agent ?")) return; await fetch("/api/kill", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: el.dataset.kill }) }); }));
  // section Équipes (avec dissolution)
  const teamsEl = document.getElementById("roster-teams"), teams = snap.teams || [];
  if (teamsEl) {
    teamsEl.innerHTML = teams.length ? `<div class="rt-title">Équipes</div>` + teams.map((t) => {
      const aw = t.awaitingDecision, nm = escapeHtml(t.name || ("Équipe " + t.id));
      const meta = `(${t.members.length})${t.chief ? " · chef " + escapeHtml(t.chief) : ""}`;
      return `<div class="rt${aw ? " rt-await" : ""}">
        <div class="rt-n">${aw ? "🏁" : "👥"} ${nm} <span style="color:var(--muted)">${meta}</span>${aw ? `<div class="rt-msg">tâche terminée — en attente de ta décision</div>` : ""}</div>
        <div class="rt-btns">${t.chiefId ? `<button class="rt-b" data-chief="${t.chiefId}" title="Parler au chef / nouvelle mission">💬 chef</button>` : ""}<button class="rt-x" data-team="${t.id}">dissoudre</button></div>
      </div>`;
    }).join("") : "";
    teamsEl.querySelectorAll(".rt-x").forEach((el) => (el.onclick = async () => { if (!confirm("Dissoudre cette équipe (tuer tous ses membres) ?")) return; await fetch("/api/team-kill", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ teamId: el.dataset.team }) }); }));
    teamsEl.querySelectorAll("[data-chief]").forEach((el) => (el.onclick = () => openDetail(el.dataset.chief)));
  }
  emptyEl.classList.toggle("hidden", snap.total > 0);
  const feed = document.getElementById("feed-list"), now = new Date();
  for (const a of snap.agents) { const prev = lastFeedKey.get(a.id); if (prev !== undefined && prev !== a.status) { const st = statusOf(a), it = document.createElement("div"); it.className = "fitem"; it.innerHTML = `<span class="who" style="color:${hexCss(st.color)}">${escapeHtml(a.name)}</span> → ${st.emoji} ${st.label} <span class="tm">${now.toLocaleTimeString("fr-FR")}</span>`; feed.prepend(it); while (feed.children.length > 30) feed.removeChild(feed.lastChild); } lastFeedKey.set(a.id, a.status); }
}
// ---- Dashboard CTO ----
function renderCTO() {
  const s = latestSnap; if (!s) return;
  const cto = s.cto || { tokens: 0, costUsd: 0, subagents: 0, branches: [] };
  const by = s.byStatus;
  // extrapolation simple du coût (sur la base de l'agent le plus ancien encore actif)
  const oldest = s.agents.reduce((m, a) => Math.max(m, a.ageMs || 0), 1);
  const perHour = cto.costUsd / Math.max(oldest / 3.6e6, 0.05);
  const kpis = [
    ["Agents", s.total, "#c8d8ff"], ["Au travail", by.working || 0, "#57d977"],
    ["Collaboration", s.counts.coworking || 0, "#a779f0"], ["Attente/erreur", (by.blocked || 0) + (by.failed || 0), "#f6ad55"],
    ["Tokens", fmtTokens(cto.tokens), "#9fc0ff"], ["Coût session", fmtCost(cto.costUsd), "#ffd35c"],
    ["~ /heure", fmtCost(perHour), "#ffd35c"], ["Sous-agents", cto.subagents || 0, "#c8d8ff"],
  ];
  const missions = s.agents.filter((a) => a.intent || a.lastAction)
    .map((a) => `<div class="cto-row"><span class="nm">${escapeHtml(a.name)}</span><span class="vv">${escapeHtml(a.lastAction || a.intent || "—")}</span></div>`).join("") || `<div class="cto-row"><span class="vv">aucune</span></div>`;
  const blockers = s.agents.filter((a) => a.status === "blocked" || a.status === "failed")
    .map((a) => `<div class="cto-row"><span class="nm">${escapeHtml(a.name)}</span><span class="vv">${statusOf(a).emoji} ${statusOf(a).label}</span></div>`).join("") || `<div class="cto-row"><span class="vv">aucun ✅</span></div>`;
  const branches = (cto.branches || []).length ? cto.branches.map((b) => escapeHtml(b)).join(", ") : "—";
  document.getElementById("cto-body").innerHTML =
    `<div class="cto-grid">` + kpis.map(([k, v, c]) => `<div class="cto-kpi"><div class="v" style="color:${c}">${v}</div><div class="k">${k}</div></div>`).join("") + `</div>` +
    `<div class="cto-sec">Missions / activité</div>${missions}` +
    `<div class="cto-sec">Blocages</div>${blockers}` +
    `<div class="cto-sec">Activité git</div><div class="cto-row"><span class="nm">branches</span><span class="vv">${branches}</span></div>` +
    `<p style="font-size:10px;color:var(--muted);margin-top:10px">Coût estimé d'après les tokens des transcripts (cache inclus) — approximatif.</p>`;
}
document.getElementById("cto-btn").onclick = () => { const p = document.getElementById("cto-panel"); p.classList.toggle("hidden"); if (!p.classList.contains("hidden")) renderCTO(); };
document.getElementById("cto-close").onclick = () => document.getElementById("cto-panel").classList.add("hidden");

const emptyEl = document.createElement("div"); emptyEl.id = "empty"; emptyEl.className = "hidden";
emptyEl.innerHTML = `<div class="big">🪑</div><div>Le bureau est vide pour l'instant.<br>Lancez une session Claude Code et elle apparaîtra ici.</div>`;
document.body.appendChild(emptyEl);

// ===========================================================================
//  SSE — démarré une fois les assets résolus
// ===========================================================================

const connEl = document.getElementById("conn"), connLabel = document.getElementById("conn-label");
function connect() {
  const es = new EventSource("/events");
  es.addEventListener("snapshot", (e) => { connEl.classList.add("live"); connLabel.textContent = "en direct"; try { applySnapshot(JSON.parse(e.data)); } catch (err) { console.error(err); } });
  es.onerror = () => { connEl.classList.remove("live"); connLabel.textContent = "reconnexion…"; };
}

// vraie chaise de bureau (modèle 3D) clonée à chaque poste + lounge
function placeChairs(src) {
  const bb = new THREE.Box3().setFromObject(src); const sz = bb.getSize(new THREE.Vector3());
  const s = 0.92 / (sz.y || 1);
  const put = (x, z, rotY) => {
    const ch = src.clone(true); ch.scale.setScalar(s);
    ch.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    ch.position.set(x, -bb.min.y * s, z); ch.rotation.y = rotY; scene.add(ch);
    shadowBlob(x, z, 0.45);
  };
  for (const slot of anchors.office) put(slot.pos.x, slot.pos.z + 0.32, Math.PI); // derrière l'employé, face au bureau
}
new GLTFLoader().load("./vendor/models/SheenChair.glb",
  (g) => { try { placeChairs(g.scene); } catch (e) { console.warn("chairs", e); } },
  undefined, (e) => console.warn("SheenChair indispo", e));

// modèles 3D générés (Blender) -> remplissent les placements différés (plantes, mobilier, gym)
const GEN_MODELS = ["plant", "desk", "chair", "sofa", "armchair", "bookshelf", "treadmill", "dumbbells", "bench",
  "workstation", "squat_rack", "treadmill_pro", "spin_bike", "weight_bench", "dumbbell_rack", "cable_machine", "kettlebell", "plate_tree", "wall_art", "surfboard",
  "task_lamp", "storage_cabinet", "meeting_table", "mirror_panel"];
const _genLoader = new GLTFLoader();
GEN_MODELS.forEach((n) => _genLoader.load("./vendor/models/gen/" + n + ".glb",
  (g) => {
    const isPlant = (n === "plant");
    g.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true;
      const isScreen = /screen|monitor|console|display/i.test(o.name || "");
      if (o.material) for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
        if (!m.isMeshStandardMaterial) continue;
        m.envMapIntensity = 0.5; // scène nocturne : on tempère l'apport de l'IBL
        if (isScreen) { // écran "allumé" : néon cyan froid -> vie + bloom
          m.emissive = new THREE.Color(0x36f0ff); m.emissiveIntensity = 1.1;
        } else {
          if (m.emissive && m.emissive.r > m.emissive.b + 0.06) m.emissive.setHex(0x36f0ff); // émissif chaud -> cyan
          if (m.color) {
            if (isPlant && m.color.g >= m.color.r && m.color.g >= m.color.b) { m.color.setHex(0x16d6b4); m.emissive = new THREE.Color(0x0a6f5e); m.emissiveIntensity = 0.7; } // feuillage néon
            else m.color.multiplyScalar(isPlant ? 0.4 : 0.6); // props clairs/pots assombris -> intègrent la nuit cyber
          }
        }
        m.needsUpdate = true;
      }
    });
    MODELS[n] = g.scene;
    for (let i = pendingModels.length - 1; i >= 0; i--)
      if (pendingModels[i].name === n) { try { pendingModels[i].cb(g.scene.clone(true)); } catch (e) { /* ignore */ } pendingModels.splice(i, 1); }
  }, undefined, (e) => console.warn("modèle gen indispo:", n, e && e.message)));

// robot conservé en option (mode ?robot)
if (USE_ROBOT) new GLTFLoader().load("./vendor/models/RobotExpressive.glb",
  (g) => { proto = { scene: g.scene, animations: g.animations }; }, undefined, () => {});

// mode démo (?demo) : peuple le bureau d'agents fictifs (tous rôles/états) pour la mise au point visuelle
function startDemo() {
  const who = [["Aria","Backend Senior"],["Max","Architecte"],["Nova","Frontend"],["Kai","DevOps"],["Lena","QA"],["Rin","Data Eng"],["Sol","Designer"],["Vex","SecOps"],["Mira","ML Eng"],["Dex","Fullstack"]];
  const defs = [
    { room:"office", status:"working" }, { room:"office", status:"working" }, { room:"office", status:"working" }, { room:"office", status:"blocked" },
    { room:"coworking", status:"coworking" }, { room:"coworking", status:"coworking" },
    { room:"gym", status:"idle" }, { room:"gym", status:"done" }, { room:"gym", status:"idle" },
    { room:"office", status:"failed" },
  ];
  const demoSlash = ["review","security-review","graphify","model","effort","compact","cost","init","verify","run"];
  const agents = defs.map((d, i) => ({ id:"demo"+i, name:who[i][0], role:who[i][1], project:"demo", status:d.status, room:d.room, kind:"job", lastAction:"build · test · ship",
    managed:true, perm:"acceptEdits", busy:d.status==="working", slashCommands:demoSlash, suggestion: i===0 ? "Ajoute des tests unitaires pour le module d'auth." : (i===4 ? "Ouvre une PR avec le récap des changements." : null) }));
  const snap = () => ({ agents, total: agents.length,
    byStatus: agents.reduce((m,a)=>((m[a.status]=(m[a.status]||0)+1),m),{}),
    counts: { coworking: agents.filter(a=>a.status==="coworking").length },
    cto: { tokens: 12900000, costUsd: 49 }, teams: [] });
  applySnapshot(snap());
  setInterval(() => applySnapshot(snap()), 3000);
}

// démarrage : on attend les humanoïdes Quaternius (avec garde-fou réseau) puis on se connecte
let _started = false;
function _start() { if (_started) return; _started = true; assetsReady = true; (_q.has("demo") ? startDemo : connect)(); }
loadQuaternius().then(_start);
setTimeout(_start, 2800);

// ===========================================================================
//  Resize
// ===========================================================================

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (composer) composer.setSize(window.innerWidth, window.innerHeight);
});
