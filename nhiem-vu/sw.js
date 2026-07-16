const APP_VERSION = "20260716.0200";
const CACHE_NAME = `nhiem-vu-shell-v${APP_VERSION}`;
const APP_BASE_URL = new URL("./", self.location.href);

const APP_SHELL = [
  "./",
  "./index.html",
  `./styles.css?v=${APP_VERSION}`,
  `./app.js?v=${APP_VERSION}`,
  `./pwa.js?v=${APP_VERSION}`,
  `./firebase-config.js?v=${APP_VERSION}`,
  `./notification-config.js?v=${APP_VERSION}`,
  `./onesignal.js?v=${APP_VERSION}`,
  `./manifest.webmanifest?v=${APP_VERSION}`,
  "./offline.html",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-64.png"
];

function appUrl(relativePath) {
  return new URL(relativePath, APP_BASE_URL).href;
}

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME);

  await Promise.all(
    APP_SHELL.map(async (relativePath) => {
      const absoluteUrl = appUrl(relativePath);
      const response = await fetch(
        new Request(absoluteUrl, { cache: "reload" })
      );

      if (!response.ok) {
        throw new Error(`Không tải được tài nguyên PWA: ${relativePath}`);
      }

      await cache.put(absoluteUrl, response);
    })
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheAppShell());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith("nhiem-vu-shell-v") && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request, { cache: "no-store" })
        .then(async (response) => {
          if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(appUrl("./index.html"), response.clone());
          }
          return response;
        })
        .catch(async () => (
          (await caches.match(appUrl("./index.html"))) ||
          (await caches.match(appUrl("./offline.html")))
        ))
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then(async (response) => {
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
