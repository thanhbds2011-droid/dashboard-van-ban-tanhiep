const CACHE_NAME = "nhiem-vu-20260805-v1-9-0-diag1";
const SHELL = [
  "./",
  "./index.html",
  "./v3.css?v=20260805.V1_9_0",
  "./kpi.css?v=20260805.V1_9_0",
  "./ai-assistant.css?v=20260805.V1_9_0",
  "./ui-v1.3.0.css?v=20260805.V1_9_0",
  "./offline.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-64.png",
  "./pwa.js?v=20260805.V1_9_0",
  "./ai-assistant.js?v=20260805.V1_9_0",
  "./app-v3.js?v=20260805.V1_9_0",
  "./core/auth-service.js?v=20260805.V1_9_0",
  "./core/firebase-service.js?v=20260805.V1_9_0",
  "./core/friendly-error.js?v=20260805.V1_9_0",
  "./core/modal-service.js?v=20260805.V1_9_0",
  "./core/permissions.js?v=20260805.V1_9_0",
  "./core/router.js?v=20260805.V1_9_0",
  "./core/task-display-order.js?v=20260805.V1_9_0",
  "./core/toast-service.js?v=20260805.V1_9_0",
  "./core/user-context.js?v=20260805.V1_9_0",
  "./firebase-config.js?v=20260805.V1_9_0",
  "./kpi-engine.js?v=20260805.V1_9_0",
  "./modules/admin/admin-view.js?v=20260805.V1_9_0",
  "./modules/dashboard/dashboard-view.js?v=20260805.V1_9_0",
  "./modules/evaluations/evaluations-view.js?v=20260805.V1_9_0",
  "./modules/kpi/kpi-workflow.js?v=20260805.V1_9_0",
  "./modules/periods/periods-view.js?v=20260805.V1_9_0",
  "./modules/plans/plans-view.js?v=20260805.V1_9_0",
  "./modules/reports/reports-view.js?v=20260805.V1_9_0",
  "./modules/standard-tasks/standard-tasks-view.js?v=20260805.V1_9_0",
  "./modules/tasks/task-adjustment-panel.js?v=20260805.V1_9_0",
  "./modules/tasks/task-detail-modal.js?v=20260805.V1_9_0_DIAG1",
  "./modules/tasks/task-form-modal.js?v=20260805.V1_9_0",
  "./modules/tasks/task-form-validator.js?v=20260805.V1_9_0",
  "./modules/tasks/task-progress-modal.js?v=20260805.V1_9_0",
  "./modules/tasks/tasks-view.js?v=20260805.V1_9_0",
  "./notification-config.js?v=20260805.V1_9_0",
  "./onesignal.js?v=20260805.V1_9_0",
  "./services/admin-maintenance-service.js?v=20260805.V1_9_0",
  "./services/admin-read-service.js?v=20260805.V1_9_0",
  "./services/dashboard-read-service.js?v=20260805.V1_9_0",
  "./services/department-read-service.js?v=20260805.V1_9_0",
  "./services/drive-evidence-service.js?v=20260805.V1_9_0",
  "./services/period-archive-service.js?v=20260805.V1_9_0",
  "./services/period-read-service.js?v=20260805.V1_9_0",
  "./services/standard-task-read-service.js?v=20260805.V1_9_0",
  "./services/standard-task-write-service.js?v=20260805.V1_9_0",
  "./services/task-adjustment-service.js?v=20260805.V1_9_0",
  "./services/task-log-service.js?v=20260805.V1_9_0",
  "./services/task-notification-service.js?v=20260805.V1_9_0",
  "./services/task-read-service.js?v=20260805.V1_9_0",
  "./services/task-registration-service.js?v=20260805.V1_9_0",
  "./services/task-work-item-service.js?v=20260805.V1_9_0",
  "./services/task-write-service.js?v=20260805.V1_9_0",
  "./services/user-read-service.js?v=20260805.V1_9_0",
  "./work-item-score-engine.js?v=20260805.V1_9_0"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(SHELL.map(asset => cache.add(asset)));
  })());
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request, { cache: "no-store" })
      .catch(async () => (await caches.match("./index.html")) || (await caches.match("./offline.html"))));
    return;
  }

  event.respondWith(fetch(request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
    }
    return response;
  }).catch(() => caches.match(request, { ignoreSearch: true }).then(hit => hit || caches.match(url.pathname.split('/').pop()))));
});
