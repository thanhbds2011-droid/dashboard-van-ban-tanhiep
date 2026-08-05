import { BUILD_VERSION } from "./core/app-version.js?v=20260805.V1_9_2";

let deferredInstallPrompt = null;
let refreshing = false;
let registration = null;

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}
function show(id) { document.getElementById(id)?.classList.remove("hidden"); }
function hide(id) { document.getElementById(id)?.classList.add("hidden"); }
function setOnlineState() {
  const offline = !navigator.onLine;
  document.body.classList.toggle("is-offline", offline);
  const box = document.getElementById("offlineBanner");
  if (box) box.classList.toggle("hidden", !offline);
}
function showUpdate(reg) {
  const bar = document.getElementById("appUpdateBanner");
  if (!bar || !reg?.waiting) return;
  bar.classList.remove("hidden");
  document.getElementById("btnApplyUpdate")?.addEventListener("click", () => {
    reg.waiting.postMessage({ type: "SKIP_WAITING" });
  }, { once: true });
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
    await registration.update();
    window.setInterval(() => registration?.update().catch(() => {}), 60 * 60 * 1000);
  } catch (error) { console.warn("Không đăng ký được chế độ ứng dụng:", error); }
}
window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  if (!isStandalone()) show("btnInstallApp");
});
window.addEventListener("appinstalled", () => { deferredInstallPrompt = null; hide("btnInstallApp"); });
window.addEventListener("online", setOnlineState);
window.addEventListener("offline", setOnlineState);
document.addEventListener("DOMContentLoaded", () => {
  setOnlineState();
  if (isStandalone()) hide("btnInstallApp");
  document.getElementById("btnInstallApp")?.addEventListener("click", async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      hide("btnInstallApp");
      return;
    }
    show("iosInstallHelp");
  });
  document.getElementById("btnCloseIosInstall")?.addEventListener("click", () => hide("iosInstallHelp"));
  document.getElementById("btnDismissUpdate")?.addEventListener("click", () => hide("appUpdateBanner"));
  registerPwa();
}, { once: true });
