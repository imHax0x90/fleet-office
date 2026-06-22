#!/usr/bin/env node
"use strict";
/**
 * Mobile Controller — petit serveur de l'app mobile de pilotage de la flotte.
 *
 * Deux rôles, zéro dépendance (Node natif) :
 *  1. sert l'app statique (./www) — la PWA / le contenu embarqué dans l'APK ;
 *  2. proxifie /api/* et /events vers l'orchestrateur (computer-office/server.js),
 *     pour que le téléphone n'ait qu'UNE seule origine à joindre via Tailscale
 *     (pas de CORS, pas de souci de cleartext, l'URL de l'orchestrateur est côté serveur).
 *
 * En APK autonome, l'app appelle directement l'orchestrateur (URL réglée dans l'app).
 *
 * Variables : PORT (def. 4174), ORCHESTRATOR_URL (def. http://localhost:4173).
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = parseInt(process.env.PORT || "4174", 10);
const HOST = process.env.HOST || "0.0.0.0";
const ORCH = (process.env.ORCHESTRATOR_URL || "http://localhost:4173").replace(/\/$/, "");
const WWW = path.join(__dirname, "www");

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2",
};

// Reverse-proxy d'une requête (API simple ou flux SSE) vers l'orchestrateur.
function proxy(req, res, pathname, search) {
  const u = new URL(ORCH);
  const opts = {
    protocol: u.protocol, hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80),
    method: req.method, path: pathname + search,
    headers: { ...req.headers, host: u.host },
  };
  const lib = u.protocol === "https:" ? require("https") : http;
  const up = lib.request(opts, (ur) => {
    res.writeHead(ur.statusCode || 502, ur.headers);
    ur.pipe(res);
  });
  up.on("error", (e) => { if (!res.headersSent) res.writeHead(502, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: false, error: "orchestrateur injoignable : " + e.message })); });
  req.pipe(up);
}

function serveStatic(res, pathname) {
  let rel = pathname === "/" ? "/index.html" : pathname;
  let file = path.join(WWW, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(WWW)) { res.writeHead(403); return res.end("forbidden"); }
  fs.readFile(file, (err, data) => {
    if (err) { // SPA fallback
      return fs.readFile(path.join(WWW, "index.html"), (e2, html) => {
        if (e2) { res.writeHead(404); return res.end("not found"); }
        res.writeHead(200, { "Content-Type": MIME[".html"] }); res.end(html);
      });
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  // injecte l'URL de l'orchestrateur courante pour l'app (utile si servie par le proxy)
  if (p === "/config.json") { res.writeHead(200, { "Content-Type": MIME[".json"] }); return res.end(JSON.stringify({ proxied: true, orchestrator: ORCH })); }
  if (p === "/api" || p.startsWith("/api/") || p === "/events") return proxy(req, res, p, url.search);
  serveStatic(res, p);
});

server.listen(PORT, HOST, () => {
  console.log(`\n  📱  Mobile Controller en ligne`);
  console.log(`  ➜  http://localhost:${PORT}`);
  console.log(`  ➜  orchestrateur (proxy) : ${ORCH}\n`);
});
