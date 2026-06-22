#!/usr/bin/env node
"use strict";
/* Petit serveur de distribution de l'APK FleetCtrl (accessible via Tailscale). */
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PORT = parseInt(process.env.PORT || "4180", 10);
const APK = path.join(__dirname, "FleetCtrl-debug.apk");
const ICON = path.join(__dirname, "www", "icon.svg");
const size = (() => { try { return (fs.statSync(APK).size / 1048576).toFixed(1) + " Mo"; } catch { return "?"; } })();

const PAGE = (host) => `<!doctype html><html lang="fr"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#05030c"><title>Installer FleetCtrl</title>
<style>
  :root{--cyan:#36f0ff;--mag:#ff3df0;--vio:#a15bff}
  *{box-sizing:border-box}html,body{margin:0;height:100%}
  body{background:radial-gradient(900px 500px at 80% -10%,rgba(255,61,240,.16),transparent 60%),radial-gradient(900px 600px at -10% 110%,rgba(54,240,255,.14),transparent 60%),#05030c;
    color:#e9ecff;font-family:ui-monospace,"JetBrains Mono",monospace;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100%;padding:32px 22px;text-align:center}
  body::before{content:"";position:fixed;inset:0;pointer-events:none;background-image:linear-gradient(rgba(120,130,255,.05)1px,transparent 1px),linear-gradient(90deg,rgba(120,130,255,.05)1px,transparent 1px);background-size:40px 40px;mask-image:linear-gradient(180deg,transparent,#000 30%,#000 70%,transparent)}
  img{width:104px;height:104px;filter:drop-shadow(0 0 24px rgba(54,240,255,.5));animation:f 5s ease-in-out infinite}
  @keyframes f{50%{transform:translateY(-8px)}}
  h1{font-family:"Chakra Petch",sans-serif;letter-spacing:3px;font-size:30px;margin:20px 0 4px}h1 b{color:var(--cyan)}
  p{color:#8a86b8;font-size:13px;line-height:1.6;max-width:420px}
  .dl{display:inline-block;margin:26px 0 10px;padding:18px 34px;border-radius:18px;border:1px solid var(--cyan);
    background:linear-gradient(135deg,var(--cyan),var(--vio));color:#05030c;font-family:"Chakra Petch",sans-serif;font-weight:700;
    font-size:17px;letter-spacing:1px;text-decoration:none;box-shadow:0 10px 36px -8px rgba(54,240,255,.6)}
  .dl small{display:block;font-weight:500;opacity:.8;font-size:11px;letter-spacing:0;margin-top:3px}
  ol{text-align:left;max-width:420px;color:#b9b6dd;font-size:12.5px;line-height:1.9;margin-top:24px;padding-left:20px}
  code{background:rgba(54,240,255,.12);border:1px solid rgba(54,240,255,.3);border-radius:6px;padding:2px 7px;color:#bdf3ff}
  .host{margin-top:18px;font-size:11px;color:#6a668c}
</style></head><body>
  <img src="/icon.svg" alt="">
  <h1>FLEET<b>CTRL</b></h1>
  <p>Pilote tes agents Claude Code depuis ton téléphone, sur ton mesh Tailscale.</p>
  <a class="dl" href="/FleetCtrl-debug.apk" download>⬇ Télécharger l'APK<small>${size} · Android</small></a>
  <ol>
    <li>Télécharge, puis ouvre le fichier <code>.apk</code>.</li>
    <li>Autorise « installer des applis de cette source » si demandé.</li>
    <li>Ouvre <b>FleetCtrl</b> → ⚙ → URL de l'orchestrateur : <code>http://fleetoffice</code>.</li>
  </ol>
  <div class="host">servi depuis ${host}</div>
</body></html>`;

const server = http.createServer((req, res) => {
  const p = req.url.split("?")[0];
  if (p === "/FleetCtrl-debug.apk" || p === "/download") {
    if (!fs.existsSync(APK)) { res.writeHead(404); return res.end("APK introuvable"); }
    res.writeHead(200, {
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Disposition": 'attachment; filename="FleetCtrl.apk"',
      "Content-Length": fs.statSync(APK).size,
    });
    return fs.createReadStream(APK).pipe(res);
  }
  if (p === "/icon.svg") {
    try { res.writeHead(200, { "Content-Type": "image/svg+xml" }); return res.end(fs.readFileSync(ICON)); } catch { res.writeHead(404); return res.end(); }
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(PAGE(req.headers.host || "?"));
});

server.listen(PORT, "0.0.0.0", () => {
  const ips = [].concat(...Object.values(os.networkInterfaces())).filter((i) => i.family === "IPv4" && !i.internal).map((i) => i.address);
  console.log(`\n  📦  Serveur APK FleetCtrl en ligne (${size})`);
  console.log(`  ➜  http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  ➜  http://${ip}:${PORT}`);
  console.log("");
});
