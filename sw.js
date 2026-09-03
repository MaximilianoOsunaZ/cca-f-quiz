/* CCA-F Quiz service worker — shell cache-first, banco network-first */
const CACHE = "ccaf-shell-v4";
const SHELL = [
  "./", "./index.html", "./styles.css", "./app.js", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-512-maskable.png", "./icons/apple-touch-icon.png",
  "./fonts/archivo-700.woff2", "./fonts/archivo-800.woff2",
  "./fonts/plexsans-400.woff2", "./fonts/plexsans-600.woff2",
  "./fonts/plexmono-400.woff2", "./fonts/plexmono-500.woff2",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      // addAll fallaría todo si falta un archivo (p. ej. una fuente): cachear uno por uno
      Promise.allSettled(SHELL.map((u) => c.add(u)))
    ).then(() => self.skipWaiting())
  );
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.endsWith("/data/questions.json")) {
    // network-first con timeout 3s, fallback a caché — el banco se actualiza solo
    e.respondWith(
      Promise.race([
        fetch(e.request).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return res;
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 3000)),
      ]).catch(() => caches.match(e.request))
    );
    return;
  }
  // shell: cache-first
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request))
  );
});
