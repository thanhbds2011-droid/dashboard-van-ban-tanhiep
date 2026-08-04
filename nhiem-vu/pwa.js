const PWA_VERSION = "20260804.V1_8_0";
let registration = null;

async function registerPwa() {
  if (!("serviceWorker" in navigator)) return;
  try {
    registration = await navigator.serviceWorker.register(`./sw.js?v=${PWA_VERSION}`, {
      scope: "./",
      updateViaCache: "none"
    });
    // Kiểm tra bản mới khi mở ứng dụng nhưng không tự động tải lại trang.
    await registration.update();
  } catch (error) {
    console.warn("Không đăng ký được chế độ ứng dụng:", error);
  }
}

document.addEventListener("DOMContentLoaded", registerPwa, { once: true });
