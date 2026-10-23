#!/usr/bin/env node
"use strict";
/* Récupère de VRAIES skills Claude par métier/catégorie depuis des repos réputés, les RANGE dans
 * NOTRE bibliothèque (~/.fleet-office-skills/<catégorie>/<skill>/SKILL.md + manifest.json), et les
 * INSTALLE (auto-usage) dans ~/.claude/skills/ — localement (symlink) et/ou sur un hôte distant.
 * Zéro dépendance (https natif). Remplace l'ancien scrape_skills.py.
 * Usage: node skills_fetch.js "<role>" "<indexFile.md>" "<skillsDir>" ["<installHost|local>"] */
const fs = require("fs"), path = require("path"), https = require("https");
const cp = require("child_process"), os = require("os");

const role = (process.argv[2] || "developer").trim();
const indexFile = process.argv[3] || path.join(os.homedir(), ".fleet-office-skills", "index.md");
const SKILLS_DIR = process.argv[4] || path.dirname(indexFile);
const installHost = (process.argv[5] || "local").trim();
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";

const SOURCES = [
  { repo: "anthropics/skills", branch: "main" },
  { repo: "wshobson/agents", branch: "main" },
];
const SSH_OPTS = ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=10"];
const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "x";
const KW = role.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
const relevant = (p) => { const s = p.toLowerCase(); return KW.some((k) => s.includes(k)); };

function get(url, json) {
  return new Promise((resolve, reject) => {
    const headers = { "User-Agent": "fleet-office-skills" };
    if (json) { headers.Accept = "application/vnd.github+json"; if (TOKEN) headers.Authorization = "Bearer " + TOKEN; }
    https.get(url, { headers }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) return resolve(get(r.headers.location, json));
      let b = ""; r.on("data", (d) => (b += d)); r.on("end", () => resolve({ status: r.statusCode, body: b }));
    }).on("error", reject);
  });
}
const descOf = (t) => { const m = t.match(/description:\s*(.+)/i); if (m) return m[1].trim().replace(/^["']|["']$/g, "").slice(0, 220); const l = t.split("\n").find((x) => x.trim() && !/^[#<-]/.test(x.trim())); return (l || "").trim().slice(0, 220); };

(async () => {
  const cat = slug(role);
  const catDir = path.join(SKILLS_DIR, cat);
  fs.mkdirSync(catDir, { recursive: true });
  const found = [];
  for (const src of SOURCES) {
    try {
      const t = await get(`https://api.github.com/repos/${src.repo}/git/trees/${src.branch}?recursive=1`, true);
      if (t.status !== 200) continue;
      const tree = (JSON.parse(t.body).tree) || [];
      const skillMd = tree.filter((n) => n.type === "blob" && /(^|\/)SKILL\.md$/i.test(n.path));
      const agentMd = tree.filter((n) => n.type === "blob" && /(^|\/)agents?\/.+\.md$/i.test(n.path) && !/readme/i.test(n.path));
      const pick = [...skillMd, ...agentMd].filter((n) => relevant(n.path)).slice(0, 8);
      for (const n of pick) {
        const r = await get(`https://raw.githubusercontent.com/${src.repo}/${src.branch}/${n.path}`, false);
        if (!r || r.status !== 200 || !r.body) continue;
        const nm = slug(n.path.replace(/\/SKILL\.md$/i, "").split("/").pop().replace(/\.md$/i, ""));
        if (found.some((f) => f.name === nm)) continue;
        const dir = path.join(catDir, nm); fs.mkdirSync(dir, { recursive: true });
        const header = `<!-- fleet-office · source: https://github.com/${src.repo}/blob/${src.branch}/${n.path} · métier: ${role} -->\n`;
        fs.writeFileSync(path.join(dir, "SKILL.md"), header + r.body);
        found.push({ name: nm, desc: descOf(r.body), repo: src.repo, source: n.path, dir });
      }
    } catch { /* source en échec -> continue */ }
  }
  // manifest de la catégorie
  try { fs.writeFileSync(path.join(catDir, "manifest.json"), JSON.stringify({ category: role, updated: new Date().toISOString(), sources: SOURCES.map((s) => s.repo), skills: found.map((f) => ({ name: f.name, desc: f.desc, source: f.repo + "/" + f.source })) }, null, 2)); } catch {}
  // index markdown (référencé dans le prompt des agents)
  const out = [`# Skills — ${role}`, `_Auto (${SOURCES.map((s) => s.repo).join(", ")}), ${new Date().toISOString().slice(0, 16).replace("T", " ")}. Rangées dans ${catDir}/ et installées dans ~/.claude/skills/ (préfixe fleet-${cat}-)._`, ""];
  found.length ? found.forEach((f) => out.push(`- **${f.name}** — ${f.desc || "(voir SKILL.md)"}\n  ${f.repo}/${f.source}`)) : out.push("_Aucune skill pertinente à ce passage._");
  try { fs.writeFileSync(indexFile, out.join("\n") + "\n"); } catch {}

  // ---- INSTALL (auto-usage) : ~/.claude/skills/fleet-<cat>-<skill>/SKILL.md ----
  if (found.length) {
    if (installHost === "local") {
      try {
        const dst = path.join(os.homedir(), ".claude", "skills"); fs.mkdirSync(dst, { recursive: true });
        for (const f of found) { const link = path.join(dst, "fleet-" + cat + "-" + f.name); try { fs.rmSync(link, { recursive: true, force: true }); } catch {} try { fs.symlinkSync(f.dir, link, "dir"); } catch { try { fs.mkdirSync(link, { recursive: true }); fs.copyFileSync(path.join(f.dir, "SKILL.md"), path.join(link, "SKILL.md")); } catch {} } }
      } catch {}
    } else {
      // hôte distant : on empaquette un staging fleet-<cat>-<skill>/SKILL.md et on l'extrait dans ~/.claude/skills
      try {
        const stage = fs.mkdtempSync(path.join(os.tmpdir(), "fleetskills-"));
        for (const f of found) { const d = path.join(stage, "fleet-" + cat + "-" + f.name); fs.mkdirSync(d, { recursive: true }); fs.copyFileSync(path.join(f.dir, "SKILL.md"), path.join(d, "SKILL.md")); }
        const tar = cp.spawnSync("tar", ["c", "-C", stage, "."], { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
        if (tar.status === 0) {
          const ssh = cp.spawnSync("ssh", [...SSH_OPTS, installHost, "bash -lc 'mkdir -p ~/.claude/skills && tar x -C ~/.claude/skills'"], { input: tar.stdout, timeout: 20000 });
          if (ssh.status !== 0) console.error("skills push ssh:", ssh.status);
        }
        try { fs.rmSync(stage, { recursive: true, force: true }); } catch {}
      } catch (e) { console.error("skills push:", e.message); }
    }
  }
  console.log(`skills_fetch: role=${role} found=${found.length} host=${installHost} -> ${catDir}`);
})().catch((e) => { console.error("skills_fetch error:", e.message); process.exit(0); });
