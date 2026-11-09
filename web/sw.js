// Network first, so the forecast is always the newest; the last copy is kept for when there's no signal at the beach.
const C = "waveslave-v1";
self.addEventListener("install", e => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET" || new URL(r.url).origin !== location.origin) return;
  // The page itself skips the browser's 10-minute copy (it checks with GitHub, a quick "not changed" when nothing is new), so a
  // refresh that just went live shows at once instead of up to 10 minutes later (Bryan, Nov 8: the site lagging CWA's buoys).
  e.respondWith((r.mode === "navigate" ? fetch(r.url, { cache: "no-cache" }) : fetch(r)).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(C).then(c => c.put(r, copy)); }
    return res;
  }).catch(() => caches.match(r).then(m => m || caches.match("./"))));
});
