const BUILD_VERSION = "20260904.V1_23_0";
const CACHE_NAME = "nhiem-vu-" + BUILD_VERSION.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const versioned = path => `${path}?v=${BUILD_VERSION}`;
const SHELL = [
  "./", "./index.html", "./offline.html", "./manifest.webmanifest",
  versioned("./pwa.js"), versioned("./app-v3.js"), versioned("./core/app-version.js"),
  versioned("./core/firebase-service.js"), versioned("./core/auth-service.js"),
  versioned("./core/user-context.js"), versioned("./core/permissions.js"), versioned("./core/router.js"),
  versioned("./v3.css"), versioned("./kpi.css"),
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png", "./icons/favicon-64.png"
];

async function cacheResponse(request, response) {
  if (!response || !response.ok) return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response);
}

async function cachedExact(request) {
  return caches.match(request);
}

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const target = await caches.open(CACHE_NAME);
    /*
     * V1.14.0: không sao chép asset từ cache release cũ sang release mới.
     * Mỗi build có URL ?v= riêng, tránh giữ nhầm JS/CSS cũ trên PWA iOS.
     */
    await Promise.allSettled(SHELL.map(url => target.add(url)));
  })());
});

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  if (event.data?.type === "GET_BUILD_VERSION") {
    try {
      event.source?.postMessage?.({ type: "APP_BUILD_VERSION", buildVersion: BUILD_VERSION });
    } catch (_) { /* no-op */ }
  }
});

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
        /* Revalidate HTML để vẫn nhận biết release mới, nhưng cho browser dùng conditional request/ETag. */
        const response = await fetch(request, { cache: "no-cache" });
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(cacheResponse("./index.html", copy));
          return response;
        }
        return (await cachedExact("./index.html")) || (await cachedExact("./offline.html")) || response;
      } catch (_) {
        return (await cachedExact("./index.html"))
          || (await cachedExact("./offline.html"))
          || new Response("Ứng dụng tạm thời chưa tải được. Hãy kết nối mạng và mở lại.", {
            status: 503,
            headers: { "Content-Type": "text/plain;charset=UTF-8" }
          });
      }
    })());
    return;
  }

  const isStaticCode = /\.(?:js|css|json|webmanifest)$/i.test(url.pathname);
  const isCurrentVersion = url.searchParams.get("v") === BUILD_VERSION;

  if (isStaticCode && isCurrentVersion) {
    /*
     * Asset bất biến theo BUILD_VERSION: cache-first chính xác URL.
     * 140 máy chỉ tải mỗi asset một lần/release thay vì chạm GitHub Pages ở mỗi lần mở PWA.
     */
    event.respondWith((async () => {
      const hit = await cachedExact(request);
      if (hit) return hit;
      try {
        const response = await fetch(request);
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(cacheResponse(request, copy));
        }
        return response;
      } catch (_) {
        return new Response("", { status: 503 });
      }
    })());
    return;
  }

  if (isStaticCode) {
    /* Manifest hoặc asset không version: network-first có cache fallback. */
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { cache: "no-cache" });
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(cacheResponse(request, copy));
        }
        return response;
      } catch (_) {
        return (await cachedExact(request)) || new Response("", { status: 503 });
      }
    })());
    return;
  }

  /* Hình/icon/font nội bộ: cache-first. */
  event.respondWith((async () => {
    const hit = await cachedExact(request);
    if (hit) return hit;
    try {
      const response = await fetch(request);
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(cacheResponse(request, copy));
      }
      return response;
    } catch (_) {
      return new Response("", { status: 503 });
    }
  })());
});
