import { BUILD_VERSION } from "./core/app-version.js?v=20260811.V1_11_2";

let deferredInstallPrompt = null;
let refreshing = false;
let registration = null;

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}
function isIos() { return /iphone|ipad|ipod/i.test(navigator.userAgent || ""); }
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
function renderInstallHelp() {
  const title = document.getElementById("installHelpTitle");
  const text = document.getElementById("installHelpText");
  if (title) title.textContent = "Cài ứng dụng Nhiệm vụ và đánh giá KPI";
  if (!text) return;
  if (isIos()) {
    text.innerHTML = "Trên iPhone/iPad: mở trang bằng <strong>Safari</strong> → bấm <strong>Chia sẻ</strong> → <strong>Thêm vào Màn hình chính</strong> → bật <strong>Mở dưới dạng ứng dụng web</strong> nếu thiết bị hiển thị tùy chọn này.";
  } else {
    text.innerHTML = "Trên Chrome/Edge máy tính: dùng mục <strong>Cài đặt ứng dụng / Install app</strong> ở thanh địa chỉ hoặc menu trình duyệt. <strong>Không dùng “Tạo lối tắt”</strong>; lối tắt thường còn biểu tượng Chrome. Khi cài đúng PWA, ứng dụng mở ở cửa sổ riêng theo chế độ standalone.";
  }
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
  } catch (error) {
    console.warn("Không đăng ký được chế độ ứng dụng:", error);
  }
}
window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  if (!isStandalone()) show("btnInstallApp");
});
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  hide("btnInstallApp");
  document.body.classList.add("is-installed-app");
});
window.addEventListener("online", setOnlineState);
window.addEventListener("offline", setOnlineState);

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
      if (choice?.outcome === "accepted") {
        deferredInstallPrompt = null;
        hide("btnInstallApp");
      }
      return;
    }
    renderInstallHelp();
    show("iosInstallHelp");
  });
  document.getElementById("btnCloseIosInstall")?.addEventListener("click", () => hide("iosInstallHelp"));
  document.getElementById("btnDismissUpdate")?.addEventListener("click", () => hide("appUpdateBanner"));
  registerPwa();
}, { once: true });
