const BUILD_VERSION = "20260810.V1_10_9";
const CACHE_NAME = "nhiem-vu-" + BUILD_VERSION.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const SHELL = [
  "./",
  "./index.html",
  "./offline.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-64.png"
];

async function cacheResponse(request, response) {
  if (!response || !response.ok) return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response);
}

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => Promise.allSettled(SHELL.map(url => cache.add(url)))));
});

// Bắt message ngay ở lần đánh giá đầu tiên của worker.
self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith("nhiem-vu-") && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { cache: "no-store" });
        const copy = response.clone();
        event.waitUntil(cacheResponse("./index.html", copy));
        return response;
      } catch (_) {
        return (await caches.match("./index.html")) || (await caches.match("./offline.html")) || Response.error();
      }
    })());
    return;
  }

  const networkFirst = /\.(?:js|css|json|webmanifest)$/i.test(url.pathname);
  if (networkFirst) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { cache: "no-store" });
        const copy = response.clone();
        event.waitUntil(cacheResponse(request, copy));
        return response;
      } catch (_) {
        return (await caches.match(request, { ignoreSearch: true })) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    const response = await fetch(request);
    const copy = response.clone();
    event.waitUntil(cacheResponse(request, copy));
    return response;
  })());
});
