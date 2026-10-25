/* Fleet Office — registre du MONDE (ville en pixel-art) : une maison par projet.
   Un « projet » = le dossier de travail d'un agent (racine du dépôt pour les worktrees). Les quartiers
   (districts) sont les workspaces dérivés du chemin (Projects/[MICRO/]<WS>/…), le reste = « Infra & perso ».
   Les maisons sont créées dès qu'un agent apparaît dans un dossier encore sans maison, et persistées
   (~/.fleet/world.json) : la ville ne perd jamais une maison, même quand plus aucun agent n'y est. */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const LOT_W = 10, LOT_H = 9, LOTS_PER_ROW = 3, DISTRICTS_PER_ROW = 3, DIST_GAP_X = 4, DIST_GAP_Y = 4, TOP = 18, MIN_W = 46;
const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "x";

function districtOf(cwd) {
  const m = String(cwd || "").match(/\/Projects\/(.+)$/i);
  if (m) {
    const seg = m[1].split("/").filter(Boolean).filter((x) => x.toLowerCase() !== "micro");
    if (seg.length) return { district: seg[0], name: seg.length > 1 ? seg.slice(-2).join(" / ") : seg[0] };
  }
  const base = path.posix.basename(String(cwd || "").replace(/\/+$/, ""));
  return { district: "Infra & perso", name: !cwd || /^\/home\/[^/]+$/.test(cwd) || base === "~" ? "Maison" : base };
}
const keyOf = (a) => String(a.repoRoot || a.cwd || "").replace(/\/+$/, "");

function createWorld({ dir, getAgents }) {
  const FILE = path.join(dir, "world.json");
  let db = { houses: {}, districts: [], seq: 0, hidden: [], closed: {} };
  try { const j = JSON.parse(fs.readFileSync(FILE, "utf8")); if (j && j.houses) db = { houses: j.houses, districts: j.districts || [], seq: j.seq || 0, hidden: j.hidden || [], closed: j.closed || {} }; } catch { /* première fois */ }
  let saveT = null;
  const saveNow = () => { try { fs.mkdirSync(dir, { recursive: true }); const t = FILE + ".tmp"; fs.writeFileSync(t, JSON.stringify(db, null, 1)); fs.renameSync(t, FILE); } catch (e) { console.error("[world] save:", e.message); } };
  const save = () => { clearTimeout(saveT); saveT = setTimeout(saveNow, 300); if (saveT.unref) saveT.unref(); };

  // synchronise le registre avec les agents vivants : crée les maisons manquantes
  function sync() {
    let created = 0;
    for (const a of getAgents()) {
      if (a.internal) continue;
      const key = keyOf(a); if (!key || key === "-" || key === "~") continue;
      if (db.houses[key] || db.hidden.includes(key)) continue;
      const d = districtOf(key);
      if (!db.districts.includes(d.district)) db.districts.push(d.district);
      db.houses[key] = { id: slug(d.name) + "-" + crypto.createHash("sha1").update(key).digest("hex").slice(0, 5), key, name: d.name, district: d.district, seq: db.seq++, style: parseInt(crypto.createHash("sha1").update(key).digest("hex").slice(5, 9), 16) % 6, createdAt: Date.now() };
      created++;
    }
    if (created) save();
    return created;
  }

  // positions (en tuiles) : quartiers en grille, lots remplis dans l'ordre de création
  function layout() {
    const byD = {}; for (const h of Object.values(db.houses)) (byD[h.district] = byD[h.district] || []).push(h);
    for (const L of Object.values(byD)) L.sort((a, b) => a.seq - b.seq);
    const districts = [], distW = LOTS_PER_ROW * LOT_W;
    let rowY = TOP, rowMax = 0, maxW = 0;
    db.districts.forEach((name, i) => {
      const col = i % DISTRICTS_PER_ROW; if (i > 0 && col === 0) { rowY += rowMax + DIST_GAP_Y; rowMax = 0; }
      const hs = byD[name] || [], rows = Math.max(1, Math.ceil(hs.length / LOTS_PER_ROW)), x0 = col * (distW + DIST_GAP_X);
      hs.forEach((h, k) => { h.x = x0 + (k % LOTS_PER_ROW) * LOT_W; h.y = rowY + 2 + Math.floor(k / LOTS_PER_ROW) * LOT_H; });
      districts.push({ name, x: x0, y: rowY, w: distW, h: rows * LOT_H + 2, count: hs.length });
      rowMax = Math.max(rowMax, rows * LOT_H + 2); maxW = Math.max(maxW, x0 + distW);
    });
    const w = Math.max(MIN_W, maxW), h = rowY + rowMax + 4;
    return { districts, size: { w, h }, plaza: { academy: { x: Math.floor(w / 2) - 14, y: 3 }, arena: { x: Math.floor(w / 2) + 4, y: 3 }, spawn: { x: Math.floor(w / 2), y: 16 } } };
  }

  function get() {
    sync(); const lay = layout(), ags = getAgents().filter((a) => !a.internal), byKey = {};
    for (const a of ags) { const k = keyOf(a); (byKey[k] = byKey[k] || []).push(a); }
    const houses = Object.values(db.houses).map((h) => {
      const members = byKey[h.key] || [], n = (s) => members.filter((a) => s(a)).length;
      return { id: h.id, key: h.key, name: h.name, district: h.district, x: h.x, y: h.y, style: h.style, createdAt: h.createdAt,
        agentIds: members.map((a) => a.id), closed: (db.closed[h.key] || []).map((c) => ({ id: c.id, name: c.name, role: c.role, closedAt: c.closedAt })), working: n((a) => a.busy || a.status === "working"), blocked: n((a) => a.status === "blocked"), failed: n((a) => a.status === "failed") };
    });
    return { lot: { w: LOT_W, h: LOT_H }, ...lay, houses, serverTime: Date.now() };
  }
  // supprime une maison (et l'empêche de réapparaître tant qu'on ne la rétablit pas)
  function remove(key) { if (!db.houses[key]) throw new Error("maison introuvable"); delete db.houses[key]; if (!db.hidden.includes(key)) db.hidden.push(key); save(); }
  // sessions fermées depuis la ville : mémorisées par maison pour pouvoir les rouvrir (la conversation reste sur disque)
  function recordClosed(key, meta) { const L = (db.closed[key] = (db.closed[key] || []).filter((c) => c.id !== meta.id)); L.unshift({ ...meta, closedAt: Date.now() }); db.closed[key] = L.slice(0, 30); save(); }
  function takeClosed(id) { for (const [k, L] of Object.entries(db.closed)) { const i = L.findIndex((c) => c.id === id); if (i >= 0) { const [m] = L.splice(i, 1); save(); return m; } } return null; }
  return { get, sync, remove, recordClosed, takeClosed, houseOf: (a) => db.houses[keyOf(a)] || null, keyOf, flush: saveNow };
}

module.exports = { createWorld, districtOf, keyOf };
