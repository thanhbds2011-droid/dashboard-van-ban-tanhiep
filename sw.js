/*
 * Migration worker for the root Nhắc việc application.
 *
 * The root path was accidentally deployed with the KPI PWA worker. This
 * worker intentionally does not cache or intercept requests. When an older
 * root registration checks for updates, this version activates and removes
 * that registration so the Nhắc việc OneSignal worker can own the root scope
 * again. It does not touch Cache Storage, so it cannot delete caches belonging
 * to /nhiem-vu/.
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    try {
      await self.registration.unregister();
    } finally {
      await self.clients.claim();
    }
  })());
});
