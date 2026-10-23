/* Fleet Office — tâches récurrentes (Automations, comme dans Orca).
   Une automation = un prompt lancé sur un nœud/dossier selon un horaire (préréglages ou cron 5 champs),
   dans un worktree neuf à chaque exécution si demandé. Stockage : ~/.fleet/automations.json.
   Règles : pas de rattrapage des occurrences manquées (serveur éteint) ; pas de chevauchement
   (si l'exécution précédente travaille encore, l'occurrence est sautée et signalée). */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const TZ = process.env.FLEET_TZ || "Europe/Paris";
const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const _fmt = new Map();
function zparts(ms, tz) {
  let f = _fmt.get(tz);
  if (!f) { f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" }); _fmt.set(tz, f); }
  const o = {}; for (const p of f.formatToParts(ms)) o[p.type] = p.value;
  return { min: +o.minute, hour: +o.hour % 24, dom: +o.day, mon: +o.month, dow: DOW[o.weekday] };
}

// ---- cron (5 champs : min heure jour-du-mois mois jour-de-semaine ; *, listes, plages, pas) ----------
function parseField(src, lo, hi, isDow) {
  const out = new Set();
  for (const part of String(src).split(",")) {
    const m = part.match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/);
    if (!m) throw new Error("champ cron invalide : " + src);
    const step = m[2] ? +m[2] : 1; if (step < 1) throw new Error("pas cron invalide : " + src);
    let a, b;
    if (m[1] === "*") { a = lo; b = hi; }
    else if (m[1].includes("-")) { [a, b] = m[1].split("-").map(Number); }
    else { a = +m[1]; b = m[2] ? hi : a; }
    if (isDow && b === 7 && a !== 7) { /* 7 = dimanche */ }
    if (a < lo || b > hi || a > b) throw new Error("valeur cron hors limites : " + src);
    for (let v = a; v <= b; v += step) out.add(isDow && v === 7 ? 0 : v);
  }
  return out;
}
function parseCron(expr) {
  const f = String(expr || "").trim().split(/\s+/);
  if (f.length !== 5) throw new Error("cron : 5 champs attendus (min heure jour mois jour-semaine)");
  return { min: parseField(f[0], 0, 59), hour: parseField(f[1], 0, 23), dom: parseField(f[2], 1, 31), mon: parseField(f[3], 1, 12), dow: parseField(f[4], 0, 7, true), domStar: f[2] === "*", dowStar: f[4] === "*" };
}
const dayMatch = (c, p) => c.mon.has(p.mon) && (c.domStar && c.dowStar ? true : c.domStar ? c.dow.has(p.dow) : c.dowStar ? c.dom.has(p.dom) : (c.dom.has(p.dom) || c.dow.has(p.dow)));
// prochaine occurrence STRICTEMENT après `from` (ms), ou null
function nextRun(expr, from, tz) {
  const c = typeof expr === "string" ? parseCron(expr) : expr; tz = tz || TZ;
  let t = Math.floor(from / 60000) * 60000 + 60000; const end = from + 400 * 86400000;
  while (t < end) {
    const p = zparts(t, tz);
    if (!dayMatch(c, p)) { t += (1440 - (p.hour * 60 + p.min)) * 60000; continue; }
    if (!c.hour.has(p.hour)) { t += (60 - p.min) * 60000; continue; }
    if (!c.min.has(p.min)) { t += 60000; continue; }
    return t;
  }
  return null;
}

// ---- préréglages -> cron ---------------------------------------------------------------------------
const hm = (s) => { const m = String(s || "").match(/^(\d{1,2}):(\d{2})$/); if (!m || +m[1] > 23 || +m[2] > 59) throw new Error("heure invalide (HH:MM)"); return [+m[2], +m[1]]; };
function toCron(s) {
  s = s || {};
  switch (s.kind) {
    case "hourly": { const m = +s.minute || 0; if (m < 0 || m > 59) throw new Error("minute invalide"); return `${m} * * * *`; }
    case "interval": { const n = Math.max(1, Math.min(+s.every || 1, 1440)); return s.unit === "h" ? `0 */${Math.min(n, 23)} * * *` : `*/${Math.min(n, 59)} * * * *`; }
    case "daily": { const [m, h] = hm(s.time); return `${m} ${h} * * *`; }
    case "weekdays": { const [m, h] = hm(s.time); return `${m} ${h} * * 1-5`; }
    case "weekly": { const [m, h] = hm(s.time); const d = Array.isArray(s.dow) && s.dow.length ? s.dow.map((x) => (+x === 7 ? 0 : +x)).filter((x) => x >= 0 && x <= 6) : [1]; return `${m} ${h} * * ${[...new Set(d)].sort().join(",")}`; }
    case "cron": parseCron(s.cron); return String(s.cron).trim();
    default: throw new Error("planification inconnue");
  }
}
const JOURS = ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"];
function describe(s) {
  try {
    switch (s.kind) {
      case "hourly": return `Toutes les heures à :${String(+s.minute || 0).padStart(2, "0")}`;
      case "interval": return `Toutes les ${s.every} ${s.unit === "h" ? "heure(s)" : "minute(s)"}`;
      case "daily": return `Tous les jours à ${s.time}`;
      case "weekdays": return `Du lundi au vendredi à ${s.time}`;
      case "weekly": return `Chaque ${(s.dow && s.dow.length ? s.dow : [1]).map((d) => JOURS[+d % 7]).join(", ")} à ${s.time}`;
      case "cron": return `cron ${s.cron}`;
    }
  } catch { /* ignore */ }
  return "—";
}

function createAutomations({ spawnAgent, isBusy, logAudit, broadcast, dir }) {
  const FILE = path.join(dir, "automations.json");
  let items = [];
  const load = () => { try { const j = JSON.parse(fs.readFileSync(FILE, "utf8")); items = Array.isArray(j) ? j : []; } catch { items = []; } };
  const save = () => { try { fs.mkdirSync(dir, { recursive: true }); const tmp = FILE + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(items, null, 2)); fs.renameSync(tmp, FILE); } catch (e) { console.error("[automations] save:", e.message); } };
  const view = (a) => ({ ...a, cron: (() => { try { return toCron(a.schedule); } catch { return null; } })(), when: describe(a.schedule), tz: TZ });
  const recompute = (a, from) => { try { a.nextRunAt = a.enabled ? nextRun(toCron(a.schedule), from || Date.now()) : null; } catch { a.nextRunAt = null; } };

  function clean(b, prev) {
    const name = String(b.name || "").trim(); if (!name) throw new Error("nom requis");
    const prompt = String(b.prompt || "").trim(); if (!prompt) throw new Error("prompt requis");
    const cwd = String(b.cwd || "").trim(); if (!cwd) throw new Error("dossier de travail requis");
    const schedule = b.schedule || {}; toCron(schedule); // valide
    return {
      ...(prev || {}), name: name.slice(0, 80), prompt: prompt.slice(0, 20000), cwd, host: b.host && b.host !== "local" ? String(b.host) : null,
      model: b.model || "sonnet", effort: b.effort || "", provider: b.provider === "bedrock" ? "bedrock" : "anthropic",
      worktree: !!b.worktree, schedule, enabled: b.enabled !== false,
    };
  }
  function upsert(b) {
    const prev = b.id ? items.find((x) => x.id === b.id) : null;
    if (b.id && !prev) throw new Error("automation introuvable");
    const a = clean(b, prev);
    if (!prev) { a.id = crypto.randomUUID(); a.createdAt = Date.now(); a.runs = 0; items.push(a); }
    recompute(a); save(); return view(a);
  }
  const find = (id) => { const a = items.find((x) => x.id === id); if (!a) throw new Error("automation introuvable"); return a; };
  function toggle(id, enabled) { const a = find(id); a.enabled = enabled !== false; recompute(a); save(); return view(a); }
  function remove(id) { find(id); items = items.filter((x) => x.id !== id); save(); }

  function run(a, trigger) {
    if (trigger === "schedule" && a.lastAgentId && isBusy(a.lastAgentId)) {
      a.lastStatus = "skipped"; a.lastError = "exécution précédente encore en cours"; a.lastRunAt = Date.now(); return null;
    }
    const d = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date());
    try {
      const id = spawnAgent({ name: `${a.name} · ${d}`, role: "automation", cwd: a.cwd, prompt: a.prompt, model: a.model, effort: a.effort || undefined, provider: a.provider, host: a.host || undefined, worktree: !!a.worktree });
      a.lastAgentId = id; a.lastStatus = "started"; a.lastError = null; a.runs = (a.runs || 0) + 1; a.lastRunAt = Date.now();
      logAudit("automation", { id: a.id, name: a.name, agent: id, trigger, host: a.host || "local" });
      return id;
    } catch (e) {
      a.lastStatus = "error"; a.lastError = String(e.message || e); a.lastRunAt = Date.now();
      logAudit("automation-error", { id: a.id, name: a.name, error: a.lastError, trigger });
      throw e;
    }
  }
  function runNow(id) { const a = find(id); try { return run(a, "manual"); } finally { save(); broadcast(true); } }

  let timer = null;
  function tick() {
    const now = Date.now(); let dirty = false;
    for (const a of items) {
      if (!a.enabled || !a.nextRunAt || a.nextRunAt > now) continue;
      try { run(a, "schedule"); } catch { /* statut déjà noté */ }
      recompute(a, now); dirty = true;
    }
    if (dirty) { save(); broadcast(true); }
  }
  function start() {
    load(); const now = Date.now();
    for (const a of items) recompute(a, now); // pas de rattrapage : on repart de « maintenant »
    save(); clearInterval(timer); timer = setInterval(tick, 20000); if (timer.unref) timer.unref();
  }
  return { start, list: () => items.map(view), upsert, toggle, remove, runNow, tick };
}

module.exports = { createAutomations, nextRun, parseCron, toCron, describe, TZ };
