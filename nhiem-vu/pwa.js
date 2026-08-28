import { BUILD_VERSION } from "./core/app-version.js?v=20260826.V1_19_0";

let deferredInstallPrompt = null;
let refreshing = false;
let registration = null;
let lastHiddenAt = 0;
let lastUpdateCheckAt = 0;
let updateCheckPromise = null;
let buildRepairing = false;
const UPDATE_CHECK_MIN_MS = 30 * 60 * 1000;
const BUILD_MESSAGE_TIMEOUT_MS = 1500;

function isStandalone() { return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true; }
function isIos() { return /iphone|ipad|ipod/i.test(navigator.userAgent || ""); }
function show(id) { document.getElementById(id)?.classList.remove("hidden"); }
function hide(id) { document.getElementById(id)?.classList.add("hidden"); }
function setOnlineState() {
  const offline = !navigator.onLine;
  document.body.classList.toggle("is-offline", offline);
  document.getElementById("offlineBanner")?.classList.toggle("hidden", !offline);
}

async function purgeAppCaches() {
  if (!("caches" in window)) return;
  const keys = await caches.keys();
  await Promise.all(keys.filter(key => key.startsWith("nhiem-vu-")).map(key => caches.delete(key)));
}

function controllerBuildVersion() {
  const controller = navigator.serviceWorker?.controller;
  if (!controller) return Promise.resolve("");
  return new Promise(resolve => {
    let timer = null;
    const onMessage = event => {
      if (event.data?.type !== "APP_BUILD_VERSION") return;
      navigator.serviceWorker.removeEventListener("message", onMessage);
      if (timer) window.clearTimeout(timer);
      resolve(String(event.data?.buildVersion || ""));
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    timer = window.setTimeout(() => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
      resolve("");
    }, BUILD_MESSAGE_TIMEOUT_MS);
    controller.postMessage({ type: "GET_BUILD_VERSION" });
  });
}

async function repairMixedBuild(reason = "MIXED_BUILD") {
  if (buildRepairing) return;
  buildRepairing = true;
  console.warn("Đang tự phục hồi bộ nhớ đệm ứng dụng:", reason);
  try {
    await purgeAppCaches();
    const regs = await navigator.serviceWorker.getRegistrations();
    const appScope = new URL("./", window.location.href).href;
    const appRegs = regs.filter(reg => String(reg.scope || "") === appScope);
    await Promise.all(appRegs.map(reg => reg.update().catch(() => null)));
    const current = appRegs[0];
    current?.waiting?.postMessage({ type: "SKIP_WAITING" });
  } catch (error) {
    console.warn("Không tự phục hồi được build ứng dụng:", error);
  }
  window.setTimeout(() => window.location.reload(), 150);
}

async function verifyControllerBuild() {
  const htmlBuild = String(window.__APP_HTML_BUILD__ || document.querySelector('meta[name="app-build"]')?.content || "").trim();
  if (htmlBuild && htmlBuild !== BUILD_VERSION) {
    await repairMixedBuild("HTML_MODULE_BUILD_MISMATCH");
    return false;
  }
  const swBuild = await controllerBuildVersion();
  if (swBuild && swBuild !== BUILD_VERSION) {
    await repairMixedBuild("SERVICE_WORKER_BUILD_MISMATCH");
    return false;
  }
  return true;
}
function showUpdate(reg) {
  const bar = document.getElementById("appUpdateBanner");
  if (!bar || !reg?.waiting) return;
  bar.classList.remove("hidden");
  document.getElementById("btnApplyUpdate")?.addEventListener("click", () => reg.waiting.postMessage({ type: "SKIP_WAITING" }), { once: true });
}
function renderInstallHelp() {
  const title = document.getElementById("installHelpTitle");
  const text = document.getElementById("installHelpText");
  if (title) title.textContent = "Cài ứng dụng Nhiệm vụ và đánh giá KPI";
  if (!text) return;
  text.innerHTML = isIos()
    ? "Trên iPhone/iPad: mở trang bằng <strong>Safari</strong> → bấm <strong>Chia sẻ</strong> → <strong>Thêm vào Màn hình chính</strong> → bật <strong>Mở dưới dạng ứng dụng web</strong> nếu có."
    : "Trên Chrome/Edge máy tính: dùng <strong>Cài đặt ứng dụng / Install app</strong>. Không dùng Tạo lối tắt.";
}
async function checkForUpdate(options = {}) {
  const force = options.force === true;
  const now = Date.now();
  if (!force && lastUpdateCheckAt && now - lastUpdateCheckAt < UPDATE_CHECK_MIN_MS) return;
  if (updateCheckPromise) return updateCheckPromise;
  lastUpdateCheckAt = now;
  updateCheckPromise = Promise.resolve(registration?.update?.()).catch(() => { /* offline */ }).finally(() => {
    updateCheckPromise = null;
  });
  return updateCheckPromise;
}
async function registerPwa() {
  if (!("serviceWorker" in navigator)) return;
  try {
    registration = await navigator.serviceWorker.register(`./sw.js?v=${BUILD_VERSION}`, { scope: "./", updateViaCache: "none" });
    if (registration.waiting) showUpdate(registration);
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) showUpdate(registration);
      });
    });
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
    await checkForUpdate({ force: true });
    await verifyControllerBuild();
    window.setInterval(checkForUpdate, UPDATE_CHECK_MIN_MS);
  } catch (error) {
    console.warn("Không đăng ký được chế độ ứng dụng:", error);
  }
}
window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault(); deferredInstallPrompt = event; if (!isStandalone()) show("btnInstallApp");
});
window.addEventListener("appinstalled", () => { deferredInstallPrompt = null; hide("btnInstallApp"); document.body.classList.add("is-installed-app"); });
window.addEventListener("online", () => { setOnlineState(); void checkForUpdate(); });
window.addEventListener("offline", setOnlineState);
window.addEventListener("pageshow", event => {
  /* BFCache có thể giữ nguyên memory của tài khoản trước trên cả Chrome lẫn PWA. */
  if (event.persisted) {
    try { window.dispatchEvent(new CustomEvent("app:bfcache-restored")); } catch (_) { /* no-op */ }
    window.location.reload();
    return;
  }
  void checkForUpdate();
  void verifyControllerBuild();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") { lastHiddenAt = Date.now(); return; }
  void checkForUpdate();
  if (isStandalone() && lastHiddenAt && Date.now() - lastHiddenAt > 5 * 60 * 1000) {
    window.dispatchEvent(new CustomEvent("app:pwa-resumed", { detail: { hiddenMs: Date.now() - lastHiddenAt } }));
  }
  lastHiddenAt = 0;
});


window.AppPwaRuntime = Object.freeze({
  buildVersion: BUILD_VERSION,
  verifyControllerBuild,
  repairMixedBuild,
  purgeAppCaches
});

document.addEventListener("DOMContentLoaded", () => {
  setOnlineState();
  document.body.classList.toggle("is-installed-app", isStandalone());
  if (isStandalone()) hide("btnInstallApp");
  renderInstallHelp();
  document.getElementById("btnInstallApp")?.addEventListener("click", async () => {
    if (isStandalone()) return;
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      if (choice?.outcome === "accepted") { deferredInstallPrompt = null; hide("btnInstallApp"); }
      return;
    }
    renderInstallHelp(); show("iosInstallHelp");
  });
  document.getElementById("btnCloseIosInstall")?.addEventListener("click", () => hide("iosInstallHelp"));
  document.getElementById("btnDismissUpdate")?.addEventListener("click", () => hide("appUpdateBanner"));
  registerPwa();
}, { once: true });
