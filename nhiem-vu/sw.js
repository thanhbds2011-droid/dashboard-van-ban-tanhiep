const BUILD_VERSION = "20260805.V1_9_1";
const CACHE_NAME = "nhiem-vu-" + BUILD_VERSION.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const SHELL = ["./", "./index.html", "./offline.html", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png", "./icons/favicon-64.png"];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => Promise.allSettled(SHELL.map(url => cache.add(url)))));
});
self.addEventListener("message", event => { if (event.data?.type === "SKIP_WAITING") self.skipWaiting(); });
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request, { cache: "no-store" }).then(response => {
      const copy=response.clone(); caches.open(CACHE_NAME).then(c=>c.put("./index.html",copy)); return response;
    }).catch(async()=>await caches.match("./index.html") || await caches.match("./offline.html")));
    return;
  }
  const dynamic = /\.(?:js|css|json|webmanifest)$/i.test(url.pathname);
  if (dynamic) {
    event.respondWith(fetch(request, { cache: "no-store" }).then(response => {
      if (response.ok) caches.open(CACHE_NAME).then(c=>c.put(request,response.clone()));
      return response;
    }).catch(()=>caches.match(request,{ignoreSearch:true})));
    return;
  }
  event.respondWith(caches.match(request,{ignoreSearch:true}).then(hit=>hit || fetch(request).then(response=>{
    if(response.ok) caches.open(CACHE_NAME).then(c=>c.put(request,response.clone())); return response;
  })));
});
