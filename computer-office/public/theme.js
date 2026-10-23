/* FLEET OFFICE — moteur de thèmes.
   Une palette = 3 couleurs (fond, texte, accent) + option « statuts monochromes ».
   Tout le reste (surfaces, lignes, statuts, diff, code…) est dérivé -> aucune palette ne peut casser l'UI.
   Chargé de façon synchrone dans <head> : le thème est appliqué avant le premier rendu (pas de flash). */
(function () {
  const KEY = "fleet.theme";

  // Valeurs relevées dans le CSS d'Orca (stablyai/orca, MIT) : shadcn neutre, bordures à 7 % de blanc.
  const ORCA_X = {
    "--bg2": "#141414", "--panel": "#171717", "--panel2": "#1e1e1e", "--raise": "#262626", "--hover": "rgba(255,255,255,.04)",
    "--line": "rgba(255,255,255,.07)", "--line2": "rgba(255,255,255,.10)", "--line3": "rgba(255,255,255,.18)",
    "--mut": "#a1a1a1", "--mut2": "#737373", "--ink2": "#d4d4d4", "--code": "#0f0f0f",
    "--s-work": "#eab308", "--s-review": "#16a34a", "--s-done": "#10b981", "--s-idle": "#737373",
  };
  const ORCA_SEM = { ok: "#22c55e", del: "#ef4444", warn: "#eab308", cyan: "#60a5fa", violet: "#a78bfa" };
  const PRESETS = [
    { id: "orca", name: "Orca", bg: "#0a0a0a", ink: "#fafafa", acc: "#e5e5e5", mono: false, sem: ORCA_SEM, x: { ...ORCA_X, "--acc-deep": "rgba(255,255,255,.09)", "--acc-ink": "#fafafa", "--you-line": "rgba(255,255,255,.12)" } },
    { id: "orca-rouge", name: "Orca · Rouge", bg: "#0a0a0a", ink: "#fafafa", acc: "#e5282e", mono: false, sem: ORCA_SEM, x: { ...ORCA_X } },
    { id: "noir-rouge", name: "Noir & Rouge", bg: "#0a0a0b", ink: "#ececec", acc: "#e5282e", mono: true },
    { id: "blanc-rouge", name: "Blanc & Rouge", bg: "#f4f4f2", ink: "#151515", acc: "#d4222a", mono: true },
    { id: "graphite", name: "Graphite", bg: "#17181b", ink: "#e4e4e6", acc: "#ff4d4f", mono: true },
    { id: "monochrome", name: "Monochrome", bg: "#0c0c0c", ink: "#f0f0f0", acc: "#f0f0f0", mono: true },
    { id: "terminal", name: "Terminal", bg: "#050805", ink: "#c9eac9", acc: "#39d353", mono: true },
    { id: "ambre", name: "Ambre", bg: "#0d0b08", ink: "#f0e5cf", acc: "#ffb000", mono: true },
    { id: "tokyonight", name: "Tokyo Night", bg: "#0d0f14", ink: "#e6e9ef", acc: "#7aa2f7", mono: false },
  ];
  const DEFAULT_ID = "orca";

  // ---- couleurs -----------------------------------------------------------------
  const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
  const rgb = (h) => { h = String(h || "#000").replace("#", ""); if (h.length === 3) h = h.replace(/./g, "$&$&"); const n = parseInt(h, 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const hex = (c) => "#" + c.map((v) => clamp(v).toString(16).padStart(2, "0")).join("");
  const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * t)); };
  const lum = (h) => { const [r, g, b] = rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const alpha = (h, a) => { const c = rgb(h); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; };

  function derive(p) {
    const light = lum(p.bg) > 0.4;
    const bg = p.bg, ink = p.ink, acc = p.acc;
    const white = "#ffffff", black = "#000000";
    const v = {};
    v["--bg"] = bg;
    if (light) {
      v["--bg2"] = mix(bg, ink, 0.035); v["--panel"] = mix(bg, white, 0.65); v["--panel2"] = mix(bg, ink, 0.05); v["--raise"] = mix(bg, ink, 0.08);
      v["--line"] = mix(bg, ink, 0.09); v["--line2"] = mix(bg, ink, 0.16); v["--line3"] = mix(bg, ink, 0.26);
      v["--mut"] = mix(bg, ink, 0.66); v["--mut2"] = mix(bg, ink, 0.46);
      v["--acc-deep"] = mix(bg, acc, 0.16); v["--acc-ink"] = mix(acc, black, 0.35);
      v["--code"] = mix(bg, ink, 0.05); v["--shadow"] = "0 18px 44px -22px rgba(0,0,0,.35)";
    } else {
      v["--bg2"] = mix(bg, ink, 0.028); v["--panel"] = mix(bg, ink, 0.055); v["--panel2"] = mix(bg, ink, 0.085); v["--raise"] = mix(bg, ink, 0.12);
      v["--line"] = mix(bg, ink, 0.085); v["--line2"] = mix(bg, ink, 0.15); v["--line3"] = mix(bg, ink, 0.24);
      v["--mut"] = mix(bg, ink, 0.62); v["--mut2"] = mix(bg, ink, 0.40);
      v["--acc-deep"] = mix(bg, acc, 0.24); v["--acc-ink"] = mix(acc, ink, 0.62);
      v["--code"] = mix(bg, black, 0.4); v["--shadow"] = "0 18px 44px -20px rgba(0,0,0,.8)";
    }
    v["--ink"] = ink; v["--ink2"] = mix(bg, ink, 0.78);
    v["--acc"] = acc; v["--acc2"] = mix(acc, ink, 0.2); v["--acc-d"] = mix(acc, bg, 0.28);
    v["--on-acc"] = lum(acc) > 0.4 ? "#0a0a0a" : "#ffffff";
    v["--you-line"] = mix(v["--acc-deep"], acc, 0.45);

    // sémantique : colorée, ou réduite aux gris + (rouge)
    let ok, del, warn, cyan, violet;
    if (p.mono) {
      ok = mix(bg, ink, 0.85); warn = mix(bg, ink, 0.62); cyan = ink; violet = mix(bg, ink, 0.5);
      del = p.del || (light ? "#d4222a" : "#ff5a5f");
    } else if (light) { ok = "#3b8a1e"; del = "#d1243b"; warn = "#b36b00"; cyan = "#0a7fa8"; violet = "#7a4fd1"; }
    else { ok = "#9ece6a"; del = "#f7768e"; warn = "#e0af68"; cyan = "#7dcfff"; violet = "#bb9af7"; }
    if (p.sem) { ok = p.sem.ok || ok; del = p.sem.del || del; warn = p.sem.warn || warn; cyan = p.sem.cyan || cyan; violet = p.sem.violet || violet; }
    v["--ok"] = ok; v["--del"] = del; v["--warn"] = warn; v["--cyan"] = cyan; v["--violet"] = violet;
    v["--okbg"] = alpha(ok, light ? 0.16 : 0.13); v["--delbg"] = alpha(del, light ? 0.13 : 0.13);
    v["--add-ink"] = mix(ok, ink, 0.4); v["--del-ink"] = mix(del, ink, 0.4);
    v["--s-work"] = p.mono ? ink : cyan; v["--s-idle"] = v["--mut2"]; v["--s-review"] = p.mono ? acc : warn;
    v["--s-done"] = ok; v["--s-fail"] = del; v["--s-cowork"] = p.mono ? v["--mut"] : violet;

    v["--result-bg"] = mix(bg, ok, 0.06); v["--result-line"] = mix(bg, ok, 0.2);
    v["--hunk"] = mix(bg, acc, 0.08); v["--hover"] = mix(bg, ink, 0.05);
    v["--fan-bg"] = mix(bg, p.mono ? acc : violet, 0.08);
    v["--sb"] = mix(bg, ink, 0.14); v["--sbh"] = mix(bg, ink, 0.24);
    v["--s-ask"] = "#f97316"; // agent qui attend une réponse / une permission
    for (let i = 0; i < 8; i++) v["--av" + i] = mix(bg, i % 3 === 0 ? acc : ink, 0.14 + i * 0.022);
    if (p.x) Object.assign(v, p.x);
    return { vars: v, light };
  }

  // ---- stockage -----------------------------------------------------------------
  function load() {
    try { const s = JSON.parse(localStorage.getItem(KEY) || "{}"); return { id: s.id || DEFAULT_ID, custom: Array.isArray(s.custom) ? s.custom : [], fs: s.fs || "m" }; }
    catch { return { id: DEFAULT_ID, custom: [], fs: "m" }; }
  }
  let state = load();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} }

  const all = () => PRESETS.map((p) => ({ ...p, preset: true })).concat(state.custom.map((c) => ({ ...c, preset: false })));
  const find = (id) => all().find((p) => p.id === id);
  let ov = null; // palette appliquée temporairement (par conversation), sans modifier le thème global
  const effective = () => (ov && find(ov)) || find(state.id) || PRESETS[0];
  const FS = { s: "12.5px", m: "13.5px", l: "15px" };

  function apply(p) {
    p = p || effective();
    const { vars, light } = derive(p);
    const root = document.documentElement;
    for (const k in vars) root.style.setProperty(k, vars[k]);
    root.style.setProperty("--fs", FS[state.fs] || FS.m);
    root.style.colorScheme = light ? "light" : "dark";
    root.dataset.mono = p.mono ? "1" : "0"; root.dataset.light = light ? "1" : "0";
    const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute("content", p.bg);
    try { window.dispatchEvent(new CustomEvent("fleet-theme", { detail: { palette: p, vars } })); } catch {}
  }

  const api = {
    presets: PRESETS,
    list: all,
    current: () => effective(),
    global: () => find(state.id) || PRESETS[0],
    get: (id) => find(id) || null,
    override(id) { const n = id && find(id) ? id : null; if (n === ov) return; ov = n; apply(); },
    fontSize: () => state.fs,
    use(id) { if (!find(id)) return; state.id = id; save(); apply(); },
    setFont(k) { if (!FS[k]) return; state.fs = k; save(); apply(); },
    // duplique la palette `fromId` en palette personnalisée et l'active
    create(fromId, opts) {
      const base = find(fromId) || PRESETS[0];
      const n = state.custom.length + 1;
      const c = { id: "c" + Date.now().toString(36), name: "Perso " + n, bg: base.bg, ink: base.ink, acc: base.acc, mono: !!base.mono, sem: base.sem, x: base.x };
      state.custom.push(c);
      if (opts && opts.keep) { save(); return c; } // palette de conversation : on ne change pas le thème global
      state.id = c.id; save(); apply(); return c;
    },
    update(id, patch) {
      const c = state.custom.find((x) => x.id === id); if (!c) return;
      Object.assign(c, patch); save(); if (state.id === id || ov === id) apply();
    },
    remove(id) {
      state.custom = state.custom.filter((x) => x.id !== id);
      if (state.id === id) state.id = DEFAULT_ID;
      if (ov === id) ov = null;
      save(); apply();
    },
    // thème xterm dérivé de la palette courante
    xterm() {
      const p = api.current(), d = derive(p).vars;
      return { background: d["--code"], foreground: p.ink, cursor: p.acc, selectionBackground: d["--line3"] };
    },
    derive,
  };
  window.FleetTheme = api;
  apply();
})();
