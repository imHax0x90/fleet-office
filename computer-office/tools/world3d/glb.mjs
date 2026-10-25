// Mini constructeur de modèles low-poly + écrivain GLB (glTF 2.0 binaire, textures PNG embarquées, échantillonnage « nearest »).
import fs from "node:fs"; import path from "node:path";
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (v) => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

export class Model {
  constructor(name, texDir) { this.name = name; this.texDir = texDir; this.parts = new Map(); this.center = [0, 0, 0]; }
  part(tex, o = {}) { const k = tex + "|" + (o.double ? "d" : "") + (o.mask ? "m" : "") + (o.emissive ? "e" : ""); if (!this.parts.has(k)) this.parts.set(k, { tex, o, pos: [], nrm: [], uv: [], idx: [] }); return this.parts.get(k); }
  // quad p[0..3] dans l'ordre BG, BD, HD, HG vu de l'extérieur ; uv = [[u,v]×4] (v=0 en haut de l'image)
  quad(tex, p, uv, o = {}) { this.tri(tex, [p[0], p[1], p[2]], [uv[0], uv[1], uv[2]], o, p); this.tri(tex, [p[0], p[2], p[3]], [uv[0], uv[2], uv[3]], o, p); }
  tri(tex, p, uv, o = {}, ctxPts) {
    const P = this.part(tex, o); let n = norm(cross(sub(p[1], p[0]), sub(p[2], p[0]))); const pts = ctxPts || p;
    const fc = [0, 1, 2].map((i) => pts.reduce((s, q) => s + q[i], 0) / pts.length);
    let q = p, u = uv;
    if (!o.double && !o.noOrient && dot(n, sub(fc, o.center || this.center)) < 0) { q = [p[0], p[2], p[1]]; u = [uv[0], uv[2], uv[1]]; n = [-n[0], -n[1], -n[2]]; }
    const base = P.pos.length / 3; q.forEach((v, i) => { P.pos.push(...v); P.nrm.push(...n); P.uv.push(...u[i]); }); P.idx.push(base, base + 1, base + 2);
  }
  bbox() { const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; let tris = 0; for (const P of this.parts.values()) { tris += P.idx.length / 3; for (let i = 0; i < P.pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], P.pos[i + k]); mx[k] = Math.max(mx[k], P.pos[i + k]); } } return { min: mn, max: mx, size: mx.map((v, i) => +(v - mn[i]).toFixed(3)), tris }; }
  glb() {
    const bin = []; let off = 0; const views = [], acc = [], images = [], textures = [], materials = [], prims = [], imgIdx = new Map();
    const push = (buf, target) => { const pad = (4 - (buf.length % 4)) % 4; const b = Buffer.concat([buf, Buffer.alloc(pad)]); views.push({ buffer: 0, byteOffset: off, byteLength: buf.length, ...(target ? { target } : {}) }); bin.push(b); off += b.length; return views.length - 1; };
    for (const P of this.parts.values()) {
      if (!imgIdx.has(P.tex)) { const f = path.join(this.texDir, P.tex + ".png"); if (!fs.existsSync(f)) throw new Error("texture manquante: " + f); const bv = push(fs.readFileSync(f)); images.push({ bufferView: bv, mimeType: "image/png", name: P.tex }); textures.push({ source: images.length - 1, sampler: 0 }); imgIdx.set(P.tex, textures.length - 1); }
      const m = { name: P.tex, pbrMetallicRoughness: { baseColorTexture: { index: imgIdx.get(P.tex) }, metallicFactor: 0, roughnessFactor: 1 } }; if (P.o.double) m.doubleSided = true; if (P.o.mask) { m.alphaMode = "MASK"; m.alphaCutoff = .5; } if (P.o.emissive) m.emissiveFactor = [1, .85, .45]; materials.push(m);
      const vc = P.pos.length / 3, big = vc > 65535, F = (a) => Buffer.from(new Float32Array(a).buffer);
      const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (let i = 0; i < P.pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], P.pos[i + k]); mx[k] = Math.max(mx[k], P.pos[i + k]); }
      const a = (bv, ct, count, type, extra = {}) => { acc.push({ bufferView: bv, componentType: ct, count, type, ...extra }); return acc.length - 1; };
      const aP = a(push(F(P.pos), 34962), 5126, vc, "VEC3", { min: mn, max: mx }), aN = a(push(F(P.nrm), 34962), 5126, vc, "VEC3"), aU = a(push(F(P.uv), 34962), 5126, vc, "VEC2");
      const aI = a(push(Buffer.from((big ? new Uint32Array(P.idx) : new Uint16Array(P.idx)).buffer), 34963), big ? 5125 : 5123, P.idx.length, "SCALAR");
      prims.push({ attributes: { POSITION: aP, NORMAL: aN, TEXCOORD_0: aU }, indices: aI, material: materials.length - 1 });
    }
    const json = { asset: { version: "2.0", generator: "fleet-office tools/world3d" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: this.name }], meshes: [{ name: this.name, primitives: prims }], materials, textures, images, samplers: [{ magFilter: 9728, minFilter: 9986, wrapS: 10497, wrapT: 10497 }], buffers: [{ byteLength: off }], bufferViews: views, accessors: acc };
    let js = Buffer.from(JSON.stringify(json)); js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
    const bb = Buffer.concat(bin), head = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
    head.write("glTF", 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + bb.length, 8); jh.writeUInt32LE(js.length, 0); jh.write("JSON", 4); bh.writeUInt32LE(bb.length, 0); bh.write("BIN\0", 4);
    return Buffer.concat([head, jh, js, bh, bb]);
  }
}

// ---- primitives ----------------------------------------------------------------------------------------------
const T = 2; // 1 texture de mur/toit (32 px) = 2 unités → 16 px par unité, même densité que le sol
export const box = (m, x0, y0, z0, x1, y1, z1, t, o = {}) => {
  const tex = typeof t === "string" ? { side: t, top: t } : t, C = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], oo = { ...o, center: C }, W = x1 - x0, H = y1 - y0, D = z1 - z0;
  const side = (p, len) => m.quad(tex.side, p, [[0, H / T], [len / T, H / T], [len / T, 0], [0, 0]], oo);
  side([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], W); side([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], W);
  side([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], D); side([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], D);
  if (tex.top) m.quad(tex.top, [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [[0, D / T], [W / T, D / T], [W / T, 0], [0, 0]], oo);
};
// plaque posée sur une face (fenêtre, porte, enseigne). face: "+z" | "-z" | "+x" | "-x" ; h0<h1 = étendue horizontale (x pour ±z, z pour ±x)
export const plate = (m, tex, face, plane, h0, h1, y0, y1, o = {}) => {
  const e = 0.02, uv = o.uv || [[0, 1], [1, 1], [1, 0], [0, 0]]; let p;
  if (face === "+z") p = [[h0, y0, plane + e], [h1, y0, plane + e], [h1, y1, plane + e], [h0, y1, plane + e]];
  else if (face === "-z") p = [[h1, y0, plane - e], [h0, y0, plane - e], [h0, y1, plane - e], [h1, y1, plane - e]];
  else if (face === "+x") p = [[plane + e, y0, h1], [plane + e, y0, h0], [plane + e, y1, h0], [plane + e, y1, h1]];
  else p = [[plane - e, y0, h0], [plane - e, y0, h1], [plane - e, y1, h1], [plane - e, y1, h0]];
  m.quad(tex, p, uv, { noOrient: true, ...o });
};
export const prism = (m, cx, cz, r, y0, y1, n, t, o = {}) => {
  const tex = typeof t === "string" ? { side: t, top: t } : t, a0 = o.a0 ?? 0, C = [cx, (y0 + y1) / 2, cz], oo = { ...o, center: C }, seg = (2 * Math.PI * r) / n;
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2, b = a0 + ((i + 1) / n) * Math.PI * 2, A = [cx + Math.sin(a) * r, cz + Math.cos(a) * r], B = [cx + Math.sin(b) * r, cz + Math.cos(b) * r];
    m.quad(tex.side, [[A[0], y0, A[1]], [B[0], y0, B[1]], [B[0], y1, B[1]], [A[0], y1, A[1]]], [[0, (y1 - y0) / T], [seg / T, (y1 - y0) / T], [seg / T, 0], [0, 0]], oo);
    if (tex.top) m.tri(tex.top, [[cx, y1, cz], [A[0], y1, A[1]], [B[0], y1, B[1]]], [[.5, .5], [.5 + Math.sin(a) / 2, .5 + Math.cos(a) / 2], [.5 + Math.sin(b) / 2, .5 + Math.cos(b) / 2]], oo);
  }
};
export const cone = (m, cx, cz, r, y0, y1, n, tex, o = {}) => {
  const a0 = o.a0 ?? 0, C = [cx, (y0 + y1) / 2, cz], oo = { ...o, center: C };
  for (let i = 0; i < n; i++) { const a = a0 + (i / n) * Math.PI * 2, b = a0 + ((i + 1) / n) * Math.PI * 2, L = Math.hypot(r, y1 - y0) / T, w = (2 * Math.PI * r / n) / T;
    m.tri(tex, [[cx + Math.sin(a) * r, y0, cz + Math.cos(a) * r], [cx + Math.sin(b) * r, y0, cz + Math.cos(b) * r], [cx, y1, cz]], [[0, L], [w, L], [w / 2, 0]], oo); }
};
export const dome = (m, cx, cy, cz, r, lat, lon, tex, o = {}) => { // demi-sphère (ou sphère si o.full)
  const oo = { ...o, center: [cx, cy, cz] };
  const rows = o.full ? lat * 2 : lat, sc = (2 * Math.PI * r) / T / lon;
  for (let i = 0; i < rows; i++) for (let j = 0; j < lon; j++) {
    const P = (a, b) => { const th = (a / rows) * Math.PI * (o.full ? 1 : 0.5), ph = (b / lon) * Math.PI * 2; return [cx + Math.sin(th) * Math.sin(ph) * r, cy + Math.cos(th) * r, cz + Math.sin(th) * Math.cos(ph) * r]; };
    const a = P(i, j), b = P(i, j + 1), c = P(i + 1, j + 1), d = P(i + 1, j), v0 = i * 0.9, v1 = (i + 1) * 0.9;
    if (i === 0) m.tri(tex, [a, d, c], [[j * sc, v0], [j * sc, v1], [(j + 1) * sc, v1]], oo); else m.quad(tex, [a, b, c, d], [[j * sc, v0], [(j + 1) * sc, v0], [(j + 1) * sc, v1], [j * sc, v1]], oo);
  }
};
// toit à deux pans (faîtage le long de X) avec débord, tranche d'avant-toit et faîtière → relief
export const gable = (m, x0, z0, x1, z1, yEave, rise, over, roofTex, wallTex, o = {}) => {
  const zm = (z0 + z1) / 2, hd = (z1 - z0) / 2, s = rise / hd, yE = yEave - s * over, yR = yEave + rise, xa = x0 - over, xb = x1 + over, zf = z1 + over, zb = z0 - over, th = 0.16, L = Math.hypot(hd + over, yR - yE) / T, W = (xb - xa) / T;
  const C = [(x0 + x1) / 2, yEave + rise / 3, zm], oo = { center: C };
  m.quad(roofTex, [[xa, yE, zf], [xb, yE, zf], [xb, yR, zm], [xa, yR, zm]], [[0, L], [W, L], [W, 0], [0, 0]], oo);
  m.quad(roofTex, [[xb, yE, zb], [xa, yE, zb], [xa, yR, zm], [xb, yR, zm]], [[0, L], [W, L], [W, 0], [0, 0]], oo);
  m.quad(roofTex, [[xa, yE - th, zf], [xb, yE - th, zf], [xb, yE, zf], [xa, yE, zf]], [[0, .5], [W, .5], [W, 0], [0, 0]], oo);
  m.quad(roofTex, [[xb, yE - th, zb], [xa, yE - th, zb], [xa, yE, zb], [xb, yE, zb]], [[0, .5], [W, .5], [W, 0], [0, 0]], oo);
  if (wallTex) for (const [x, sg] of [[x0, -1], [x1, 1]]) m.tri(wallTex, [[x, yEave, z1], [x, yEave, z0], [x, yR, zm]].map((p) => p), [[0, .5], [hd * 2 / T, .5], [hd / T, 0]], { center: [x - sg, yEave, zm] });
  box(m, xa - 0.02, yR - 0.05, zm - 0.12, xb + 0.02, yR + 0.1, zm + 0.12, roofTex, o);
};
// toit en croupe / pyramide
export const hip = (m, x0, z0, x1, z1, yEave, rise, over, tex) => {
  const xa = x0 - over, xb = x1 + over, za = z0 - over, zb = z1 + over, zm = (za + zb) / 2, xm = (xa + xb) / 2, hd = (zb - za) / 2, hw = (xb - xa) / 2, yR = yEave + rise, th = 0.16, C = [xm, yEave + rise / 3, zm], oo = { center: C };
  const rx0 = hw > hd ? xm - (hw - hd) : xm, rx1 = hw > hd ? xm + (hw - hd) : xm, rz0 = hd > hw ? zm - (hd - hw) : zm, rz1 = hd > hw ? zm + (hd - hw) : zm, L = Math.hypot(hd, rise) / T, W = (xb - xa) / T;
  m.quad(tex, [[xa, yEave, zb], [xb, yEave, zb], [rx1, yR, rz1], [rx0, yR, rz1]], [[0, L], [W, L], [W * .75, 0], [W * .25, 0]], oo);
  m.quad(tex, [[xb, yEave, za], [xa, yEave, za], [rx0, yR, rz0], [rx1, yR, rz0]], [[0, L], [W, L], [W * .75, 0], [W * .25, 0]], oo);
  m.quad(tex, [[xb, yEave, zb], [xb, yEave, za], [rx1, yR, rz0], [rx1, yR, rz1]], [[0, L], [W, L], [W * .75, 0], [W * .25, 0]], oo);
  m.quad(tex, [[xa, yEave, za], [xa, yEave, zb], [rx0, yR, rz1], [rx0, yR, rz0]], [[0, L], [W, L], [W * .75, 0], [W * .25, 0]], oo);
  for (const [a, b] of [[[xa, zb], [xb, zb]], [[xb, za], [xa, za]], [[xb, zb], [xb, za]], [[xa, za], [xa, zb]]]) m.quad(tex, [[a[0], yEave - th, a[1]], [b[0], yEave - th, b[1]], [b[0], yEave, b[1]], [a[0], yEave, a[1]]], [[0, .5], [1, .5], [1, 0], [0, 0]], oo);
};
export const writeGLB = (m, file) => fs.writeFileSync(file, m.glb());
