/* Service worker FleetCtrl — cache du shell pour usage hors-ligne (jamais l'API/SSE). */
const C = "fleetctrl-v2";
const ASSETS = ["./", "./index.html", "./app.css", "./app.js", "./manifest.webmanifest", "./icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(C).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== C).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (u.pathname.startsWith("/api/") || u.pathname === "/events" || e.request.method !== "GET") return; // direct au réseau
  e.respondWith(
    caches.match(e.request).then((r) =>
      r || fetch(e.request).then((resp) => {
        if (resp.ok && u.origin === location.origin) { const cc = resp.clone(); caches.open(C).then((c) => c.put(e.request, cc)); }
        return resp;
      }).catch(() => caches.match("./index.html"))
    )
  );
});
