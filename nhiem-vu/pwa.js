import { BUILD_VERSION } from "./core/app-version.js?v=20260824.V1_16_0";

let deferredInstallPrompt = null;
let refreshing = false;
let registration = null;
let lastHiddenAt = 0;
let lastUpdateCheckAt = 0;
let updateCheckPromise = null;
const UPDATE_CHECK_MIN_MS = 30 * 60 * 1000;

function isStandalone() { return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true; }
function isIos() { return /iphone|ipad|ipod/i.test(navigator.userAgent || ""); }
function show(id) { document.getElementById(id)?.classList.remove("hidden"); }
function hide(id) { document.getElementById(id)?.classList.add("hidden"); }
function setOnlineState() {
  const offline = !navigator.onLine;
  document.body.classList.toggle("is-offline", offline);
  document.getElementById("offlineBanner")?.classList.toggle("hidden", !offline);
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
  /* iOS PWA có thể khôi phục nguyên process từ BFCache. Reload để bootstrap lại quyền/profile. */
  if (event.persisted && isStandalone()) { window.location.reload(); return; }
  void checkForUpdate();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") { lastHiddenAt = Date.now(); return; }
  void checkForUpdate();
  if (isStandalone() && lastHiddenAt && Date.now() - lastHiddenAt > 5 * 60 * 1000) {
    window.dispatchEvent(new CustomEvent("app:pwa-resumed", { detail: { hiddenMs: Date.now() - lastHiddenAt } }));
  }
  lastHiddenAt = 0;
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
