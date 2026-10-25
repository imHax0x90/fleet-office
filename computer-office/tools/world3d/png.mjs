// Encodeur PNG minimal (RGBA 8 bits, zéro dépendance) + petit « canvas » de pixels pour dessiner à la main.
import zlib from "node:zlib";
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
export function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
export const hex = (s) => { s = s.replace("#", ""); return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16), 255]; };
export class Img {
  constructor(w, h) { this.w = w; this.h = h; this.d = new Uint8ClampedArray(w * h * 4); }
  px(x, y, c) { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= this.w || y >= this.h || !c) return; const i = (y * this.w + x) * 4; const col = typeof c === "string" ? hex(c) : c; this.d[i] = col[0]; this.d[i + 1] = col[1]; this.d[i + 2] = col[2]; this.d[i + 3] = col[3] ?? 255; }
  get(x, y) { const i = (y * this.w + x) * 4; return [this.d[i], this.d[i + 1], this.d[i + 2], this.d[i + 3]]; }
  rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, c); }
  blit(src, sx, sy, sw, sh, dx, dy) { for (let j = 0; j < sh; j++) for (let i = 0; i < sw; i++) { const c = src.get(sx + i, sy + j); if (c[3]) this.px(dx + i, dy + j, c); } }
  png() { return encodePNG(this.w, this.h, this.d); }
}
// aléa déterministe (mulberry32) : mêmes textures à chaque génération
export const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
export const shade = (c, k) => [Math.max(0, Math.min(255, c[0] * k)) | 0, Math.max(0, Math.min(255, c[1] * k)) | 0, Math.max(0, Math.min(255, c[2] * k)) | 0, c[3] ?? 255];

// Décodeur PNG : non entrelacé, profondeurs 1/2/4/8 bits, gris / gris+alpha / RGB / RGBA / palette (suffit pour les planches de sprites).
export function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("PNG invalide");
  let o = 8, w = 0, h = 0, ct = 0, bd = 0, il = 0, plte = null, trns = null; const idat = [];
  while (o < buf.length) { const len = buf.readUInt32BE(o), type = buf.toString("ascii", o + 4, o + 8), d = buf.subarray(o + 8, o + 8 + len); if (type === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); bd = d[8]; ct = d[9]; il = d[12]; } else if (type === "PLTE") plte = d; else if (type === "tRNS") trns = d; else if (type === "IDAT") idat.push(d); else if (type === "IEND") break; o += 12 + len; }
  if (il !== 0 || (bd !== 8 && !(bd < 8 && (ct === 3 || ct === 0)))) throw new Error("PNG non supporté (entrelacé ou 16 bits)");
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct]; if (!ch) throw new Error("type de couleur PNG inconnu");
  const bpp = Math.max(1, (ch * bd) >> 3), line = Math.ceil((w * ch * bd) / 8), raw = zlib.inflateSync(Buffer.concat(idat)), out = new Uint8ClampedArray(w * h * 4); let prev = Buffer.alloc(line);
  for (let y = 0; y < h; y++) { const f = raw[y * (line + 1)], cur = Buffer.from(raw.subarray(y * (line + 1) + 1, (y + 1) * (line + 1)));
    for (let i = 0; i < line; i++) { const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0; let v = cur[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1; else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; } cur[i] = v & 255; }
    const sample = (x, k) => { if (bd === 8) return cur[x * ch + k]; const per = 8 / bd, byte = cur[Math.floor(x / per)], shift = 8 - bd * ((x % per) + 1); return (byte >> shift) & ((1 << bd) - 1); };
    for (let x = 0; x < w; x++) { const j = (y * w + x) * 4;
      if (ct === 6) { out[j] = cur[x * 4]; out[j + 1] = cur[x * 4 + 1]; out[j + 2] = cur[x * 4 + 2]; out[j + 3] = cur[x * 4 + 3]; }
      else if (ct === 2) { out[j] = cur[x * 3]; out[j + 1] = cur[x * 3 + 1]; out[j + 2] = cur[x * 3 + 2]; out[j + 3] = 255; }
      else if (ct === 3) { const k = sample(x, 0); out[j] = plte[k * 3]; out[j + 1] = plte[k * 3 + 1]; out[j + 2] = plte[k * 3 + 2]; out[j + 3] = trns && k < trns.length ? trns[k] : 255; }
      else if (ct === 0) { const k = sample(x, 0), v = bd === 8 ? k : Math.round((k * 255) / ((1 << bd) - 1)); out[j] = out[j + 1] = out[j + 2] = v; out[j + 3] = 255; }
      else { out[j] = out[j + 1] = out[j + 2] = cur[x * 2]; out[j + 3] = cur[x * 2 + 1]; } } prev = cur; }
  const img = new Img(w, h); img.d = out; return img;
}
