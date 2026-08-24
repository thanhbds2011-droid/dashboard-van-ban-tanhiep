const BUILD_VERSION = "20260824.V1_13_0";
const CACHE_NAME = "nhiem-vu-" + BUILD_VERSION.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const SHELL = [
  "./", "./index.html", "./offline.html", "./manifest.webmanifest",
  "./pwa.js", "./app-v3.js", "./core/app-version.js", "./core/firebase-service.js",
  "./core/auth-service.js", "./core/user-context.js", "./core/permissions.js", "./core/router.js", "./core/deadline-engine.js",
  "./services/task-milestone-service.js", "./v3.css", "./kpi.css",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png", "./icons/favicon-64.png"
];
async function cacheResponse(request, response) {
  if (!response || !response.ok) return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response);
}
async function cached(request) { return caches.match(request, { ignoreSearch: true }); }
self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const target = await caches.open(CACHE_NAME);
    /* Sao chép cache app trước sang cache mới trước khi activate xóa cache cũ. */
    const keys = await caches.keys();
    for (const key of keys.filter(key => key.startsWith("nhiem-vu-") && key !== CACHE_NAME)) {
      const oldCache = await caches.open(key);
      const requests = await oldCache.keys();
      for (const request of requests) {
        try {
          const response = await oldCache.match(request);
          if (response?.ok) await target.put(request, response);
        } catch (_) { /* entry cũ hỏng thì bỏ qua */ }
      }
    }
    await Promise.allSettled(SHELL.map(url => target.add(url)));
  })());
});
self.addEventListener("message", event => { if (event.data?.type === "SKIP_WAITING") self.skipWaiting(); });
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(key => key.startsWith("nhiem-vu-") && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
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
        if (response.ok) { const copy = response.clone(); event.waitUntil(cacheResponse("./index.html", copy)); return response; }
        return (await cached("./index.html")) || (await cached("./offline.html")) || response;
      } catch (_) {
        return (await cached("./index.html")) || (await cached("./offline.html")) || new Response("Ứng dụng tạm thời chưa tải được. Hãy kết nối mạng và mở lại.", { status: 503, headers: { "Content-Type": "text/plain;charset=UTF-8" } });
      }
    })());
    return;
  }
  const networkFirst = /\.(?:js|css|json|webmanifest)$/i.test(url.pathname);
  if (networkFirst) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { cache: "no-store" });
        if (response.ok) { const copy = response.clone(); event.waitUntil(cacheResponse(request, copy)); return response; }
        return (await cached(request)) || response;
      } catch (_) {
        return (await cached(request)) || new Response("", { status: 503 });
      }
    })());
    return;
  }
  event.respondWith((async () => {
    const hit = await cached(request);
    if (hit) return hit;
    try {
      const response = await fetch(request);
      if (response.ok) { const copy = response.clone(); event.waitUntil(cacheResponse(request, copy)); }
      return response;
    } catch (_) {
      return new Response("", { status: 503 });
    }
  })());
});
