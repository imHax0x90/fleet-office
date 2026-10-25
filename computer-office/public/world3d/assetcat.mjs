/* Catalogue d'assets : identifiants stables, chargement à la demande avec cache et dédoublonnage des requêtes en vol, métadonnées de découpe des
   spritesheets (aucun fichier par frame), recherche par catégorie / tags / dimensions, placeholders pour les ressources absentes.
   Ne touche jamais aux fichiers sources. Sans dépendance DOM : testable sous Node (chargeur d'image injectable). */
export class AssetCatalog {
  constructor(entries, { base = "", loadImage = null } = {}) {
    this.base = base; this._load = loadImage; this.entries = new Map(); this.cache = new Map(); this.failed = new Map();
    for (const e of entries) { if (!e || !e.id) continue; if (this.entries.has(e.id)) throw new Error("identifiant dupliqué : " + e.id); this.entries.set(e.id, e); }
  }
  has(id) { return this.entries.has(id); }
  get(id) { return this.entries.get(id) || null; }
  /** Recherche : { category, tags:[…], text, minW, maxW, minH, maxH, sheet:true } — dimensions en pixels de l'image source (sheet.px) ou unités monde sinon. */
  find(q = {}) {
    const tags = (q.tags || []).map((t) => t.toLowerCase()), text = (q.text || "").toLowerCase(), out = [];
    for (const e of this.entries.values()) {
      if (q.category && e.category !== q.category) continue;
      if (tags.length && !tags.every((t) => (e.tags || []).map((x) => x.toLowerCase()).includes(t))) continue;
      if (text && !(e.id + " " + (e.tags || []).join(" ")).toLowerCase().includes(text)) continue;
      const [w, h] = e.sheet ? e.sheet.px : [e.dimensions && e.dimensions.w, e.dimensions && e.dimensions.h];
      if (q.minW != null && !(w >= q.minW)) continue; if (q.maxW != null && !(w <= q.maxW)) continue; if (q.minH != null && !(h >= q.minH)) continue; if (q.maxH != null && !(h <= q.maxH)) continue;
      if (q.sheet && !e.sheet) continue; out.push(e);
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }
  /** Rectangle source (px) d'une frame : { dir, state | frame }. Les directions suivent sheet.rowsOrder, les états sheet.colsOrder ou un index de colonne. */
  frameRect(id, { dir = "bas", state = null, frame = 0 } = {}) {
    const e = this.get(id); if (!e || !e.sheet) throw new Error("pas de spritesheet : " + id);
    const s = e.sheet, row = Math.max(0, s.rowsOrder ? s.rowsOrder.indexOf(dir) : 0); let col = state && s.colsOrder ? s.colsOrder.indexOf(state) : frame; if (col < 0) col = 0; col = Math.min(col, s.cols - 1);
    return { x: col * s.cell[0], y: row * s.cell[1], w: s.cell[0], h: s.cell[1] };
  }
  frameCount(id) { const e = this.get(id); return e && e.sheet ? e.sheet.cols * e.sheet.rows : 1; }
  /** Séquence d'animation nommée (idle/walk/run) → { frames:[colonnes], fps }. */
  animation(id, name) { const e = this.get(id), a = e && (e.animations || []).find((x) => x.name === name); return a ? { frames: a.frames.slice(), fps: a.fps || 6 } : null; }
  /** Description exploitable par le moteur : texture, découpe en grille, taille monde, pied, séquences. */
  sheetInfo(id) {
    const e = this.get(id); if (!e || !e.sheet) return null; const s = e.sheet, idle = this.animation(id, "idle") || { frames: [0], fps: 1 }, walk = this.animation(id, "walk") || idle, run = this.animation(id, "run") || walk;
    return { id, file: e.file, cols: s.cols, rows: s.rows, cell: s.cell, size: [e.dimensions.w, e.dimensions.h], foot: ((s.footPx || 0) / s.cell[1]) * e.dimensions.h, frames: { idle: idle.frames, walk: walk.frames, run: run.frames }, rates: { idle: idle.fps, walk: walk.fps, run: run.fps } };
  }
  /** Image en cache ; en cas d'échec ou d'absence, renvoie un placeholder identifiable (jamais d'exception bloquante). */
  async image(id) {
    if (this.cache.has(id)) return this.cache.get(id);
    const e = this.get(id); const p = (async () => {
      if (!e) return this.placeholder(id, "absent du catalogue");
      try { if (!this._load) throw new Error("aucun chargeur d'image"); return { id, placeholder: false, image: await this._load(this.base + e.file) }; }
      catch (err) { this.failed.set(id, String(err.message || err)); return this.placeholder(id, String(err.message || err)); }
    })(); this.cache.set(id, p); return p;
  }
  placeholder(id, reason) { const e = this.get(id), d = (e && e.dimensions) || { w: 1, h: 1 }; return { id, placeholder: true, reason, color: (e && e.fallback && e.fallback.color) || "#ff00ff", shape: (e && e.fallback && e.fallback.shape) || "box", w: d.w, h: d.h, label: "?" + id }; }
  stats() { return { entries: this.entries.size, cached: this.cache.size, failed: [...this.failed].map(([id, error]) => ({ id, error })) }; }
}

/** États métier d'un agent → représentation visuelle (animation du sprite + pastille + teinte). */
export const AGENT_STATES = ["idle", "working", "thinking", "success", "error", "offline", "blocked"];
const VISUALS = {
  idle: { anim: "idle", badge: null, tint: null, label: "en attente" }, working: { anim: "walk", badge: "working", tint: null, label: "au travail" },
  thinking: { anim: "idle", badge: "thinking", tint: null, label: "réflexion" }, success: { anim: "idle", badge: "success", tint: null, label: "terminé" },
  error: { anim: "idle", badge: "error", tint: null, label: "erreur" }, offline: { anim: "idle", badge: "offline", tint: "gray", label: "hors ligne" }, blocked: { anim: "idle", badge: "blocked", tint: null, label: "intervention requise" },
};
export const visualOf = (state) => VISUALS[state] || VISUALS.idle;
/** Convertit un agent du backend (status, busy, phase, host) en état métier. N'invente rien : sans signal, l'état reste `idle`. */
export function agentState(agent, { hostOnline } = {}) {
  if (!agent) return "idle"; if (hostOnline === false) return "offline";
  switch (agent.status) { case "failed": return "error"; case "blocked": return "blocked"; case "done": return "success"; case "working": return agent.phase === "thinking" ? "thinking" : "working"; default: return agent.busy ? "working" : "idle"; }
}
export const agentVisual = (agent, ctx) => { const state = agentState(agent, ctx); return { state, ...visualOf(state) }; };
