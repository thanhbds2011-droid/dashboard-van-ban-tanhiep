/*
 * =========================================================
 * CÀI ĐẶT PWA VÀ TỰ KIỂM TRA PHIÊN BẢN MỚI
 * =========================================================
 */

const PWA_VERSION = "20260717.1200";
const UPDATE_CHECK_INTERVAL = 30 * 60 * 1000;

let deferredInstallPrompt = null;
let serviceWorkerRegistration = null;
let reloadingForUpdate = false;
let checkingForUpdate = false;

const installButtons = [
  document.getElementById("installAppButton"),
  document.getElementById("loginInstallButton")
].filter(Boolean);

const installModal = document.getElementById("installHelpModal");
const closeInstallHelpButton = document.getElementById("closeInstallHelpButton");
const installHelpTitle = document.getElementById("installHelpTitle");
const installHelpContent = document.getElementById("installHelpContent");
const offlineBanner = document.getElementById("offlineBanner");
const updateBanner = document.getElementById("updateBanner");
const updateNowButton = document.getElementById("updateNowButton");
const dismissUpdateButton = document.getElementById("dismissUpdateButton");

function isStandaloneMode() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

function isIOSDevice() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

function showInstallButtons() {
  if (isStandaloneMode()) {
    hideInstallButtons();
    return;
  }

  installButtons.forEach((button) => button.classList.remove("hidden"));
}

function hideInstallButtons() {
  installButtons.forEach((button) => button.classList.add("hidden"));
}

function openInstallHelp() {
  if (!installModal) {
    return;
  }

  if (isIOSDevice()) {
    installHelpTitle.textContent = "Cài ứng dụng trên iPhone/iPad";
    installHelpContent.innerHTML = `
      <ol class="install-steps">
        <li>Mở trang này bằng <strong>Safari</strong>.</li>
        <li>Nhấn nút <strong>Chia sẻ</strong> ở thanh công cụ.</li>
        <li>Chọn <strong>Thêm vào Màn hình chính</strong>.</li>
        <li>Bật <strong>Mở dưới dạng ứng dụng web</strong> nếu thiết bị hiển thị tùy chọn này.</li>
        <li>Nhấn <strong>Thêm</strong>.</li>
      </ol>
      <p class="install-note">
        Sau khi cài, mở bằng biểu tượng “Nhiệm vụ”. Ứng dụng đã cài sẽ tự kiểm tra phiên bản mới mỗi khi mở và không cần cài lại.
      </p>
    `;
  } else {
    installHelpTitle.textContent = "Cài ứng dụng trên thiết bị";
    installHelpContent.innerHTML = `
      <ol class="install-steps">
        <li>Mở menu của trình duyệt.</li>
        <li>Chọn <strong>Cài đặt ứng dụng</strong>, <strong>Install app</strong> hoặc <strong>Thêm vào màn hình chính</strong>.</li>
        <li>Xác nhận cài đặt.</li>
      </ol>
      <p class="install-note">
        Sau khi cài một lần, ứng dụng tự kiểm tra bản cập nhật khi được mở. Không cần mở lại đường link để thêm vào màn hình chính.
      </p>
    `;
  }

  installModal.classList.remove("hidden");
  document.body.classList.add("modal-open");
}

function closeInstallHelp() {
  installModal?.classList.add("hidden");
  document.body.classList.remove("modal-open");
}

async function handleInstallClick() {
  if (isStandaloneMode()) {
    hideInstallButtons();
    return;
  }

  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;

    if (choice.outcome === "accepted") {
      hideInstallButtons();
    }
    return;
  }

  openInstallHelp();
}

function updateConnectionBanner() {
  offlineBanner?.classList.toggle("hidden", window.navigator.onLine);
}

function showUpdateBanner() {
  updateBanner?.classList.remove("hidden");
}

function hideUpdateBanner() {
  updateBanner?.classList.add("hidden");
}

function watchInstallingWorker(worker) {
  if (!worker) {
    return;
  }

  worker.addEventListener("statechange", () => {
    if (
      worker.state === "installed" &&
      navigator.serviceWorker.controller
    ) {
      showUpdateBanner();
    }
  });
}

async function checkForUpdate() {
  if (!serviceWorkerRegistration || checkingForUpdate || !navigator.onLine) {
    return;
  }

  checkingForUpdate = true;

  try {
    await serviceWorkerRegistration.update();

    if (serviceWorkerRegistration.waiting) {
      showUpdateBanner();
    }
  } catch (error) {
    console.warn("Chưa kiểm tra được phiên bản PWA mới:", error);
  } finally {
    checkingForUpdate = false;
  }
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  try {
    serviceWorkerRegistration = await navigator.serviceWorker.register(
      `./sw.js?v=${PWA_VERSION}`,
      {
        scope: "./",
        updateViaCache: "none"
      }
    );

    serviceWorkerRegistration.addEventListener("updatefound", () => {
      watchInstallingWorker(serviceWorkerRegistration.installing);
    });

    if (serviceWorkerRegistration.installing) {
      watchInstallingWorker(serviceWorkerRegistration.installing);
    }

    if (serviceWorkerRegistration.waiting) {
      showUpdateBanner();
    }

    await checkForUpdate();
  } catch (error) {
    console.error("Không đăng ký được Service Worker:", error);
  }
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  showInstallButtons();
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  hideInstallButtons();
  closeInstallHelp();
});

window.addEventListener("online", () => {
  updateConnectionBanner();
  checkForUpdate();
});

window.addEventListener("offline", updateConnectionBanner);
window.addEventListener("focus", checkForUpdate);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    checkForUpdate();
  }
});

installButtons.forEach((button) => {
  button.addEventListener("click", handleInstallClick);
});

closeInstallHelpButton?.addEventListener("click", closeInstallHelp);

installModal?.addEventListener("click", (event) => {
  if (event.target === installModal) {
    closeInstallHelp();
  }
});

updateNowButton?.addEventListener("click", async () => {
  updateNowButton.disabled = true;
  updateNowButton.textContent = "Đang cập nhật...";

  try {
    await checkForUpdate();
    const waitingWorker = serviceWorkerRegistration?.waiting;

    if (waitingWorker) {
      waitingWorker.postMessage({ type: "SKIP_WAITING" });
      return;
    }

    window.location.reload();
  } finally {
    window.setTimeout(() => {
      updateNowButton.disabled = false;
      updateNowButton.textContent = "Cập nhật";
    }, 1500);
  }
});

dismissUpdateButton?.addEventListener("click", hideUpdateBanner);

navigator.serviceWorker?.addEventListener("controllerchange", () => {
  if (reloadingForUpdate) {
    return;
  }

  reloadingForUpdate = true;
  window.location.reload();
});

document.addEventListener("DOMContentLoaded", () => {
  updateConnectionBanner();

  if (isIOSDevice() && !isStandaloneMode()) {
    showInstallButtons();
  }

  if (isStandaloneMode()) {
    hideInstallButtons();
  }

  registerServiceWorker();
  window.setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL);
});
