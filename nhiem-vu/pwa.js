/*
 * =========================================================
 * CÀI ĐẶT PWA VÀ QUẢN LÝ SERVICE WORKER
 * =========================================================
 */

const PWA_VERSION = "20260714.851";

let deferredInstallPrompt = null;
let serviceWorkerRegistration = null;
let reloadingForUpdate = false;

const installButtons = [
  document.getElementById("installAppButton"),
  document.getElementById("loginInstallButton")
].filter(Boolean);

const installModal =
  document.getElementById("installHelpModal");

const closeInstallHelpButton =
  document.getElementById("closeInstallHelpButton");

const installHelpTitle =
  document.getElementById("installHelpTitle");

const installHelpContent =
  document.getElementById("installHelpContent");

const offlineBanner =
  document.getElementById("offlineBanner");

const updateBanner =
  document.getElementById("updateBanner");

const updateNowButton =
  document.getElementById("updateNowButton");

const dismissUpdateButton =
  document.getElementById("dismissUpdateButton");


function isStandaloneMode() {
  return (
    window.matchMedia("(display-mode: standalone)").matches
    || window.navigator.standalone === true
  );
}


function isIOSDevice() {
  return /iphone|ipad|ipod/i.test(
    window.navigator.userAgent
  );
}


function showInstallButtons() {
  if (isStandaloneMode()) {
    hideInstallButtons();
    return;
  }

  installButtons.forEach((button) => {
    button.classList.remove("hidden");
  });
}


function hideInstallButtons() {
  installButtons.forEach((button) => {
    button.classList.add("hidden");
  });
}


function openInstallHelp() {
  if (!installModal) {
    return;
  }

  if (isIOSDevice()) {
    installHelpTitle.textContent =
      "Cài ứng dụng trên iPhone/iPad";

    installHelpContent.innerHTML = `
      <ol class="install-steps">
        <li>Mở trang này bằng <strong>Safari</strong>.</li>
        <li>Nhấn nút <strong>Chia sẻ</strong> ở thanh công cụ.</li>
        <li>Chọn <strong>Thêm vào Màn hình chính</strong>.</li>
        <li>Bật <strong>Mở dưới dạng ứng dụng web</strong> nếu thiết bị hiển thị tùy chọn này.</li>
        <li>Nhấn <strong>Thêm</strong>.</li>
      </ol>
      <p class="install-note">
        Sau khi cài, hãy mở bằng biểu tượng “Nhiệm vụ” trên màn hình chính để ứng dụng chạy không có thanh địa chỉ.
      </p>
    `;
  } else {
    installHelpTitle.textContent =
      "Cài ứng dụng trên thiết bị";

    installHelpContent.innerHTML = `
      <ol class="install-steps">
        <li>Mở menu của trình duyệt.</li>
        <li>Chọn <strong>Cài đặt ứng dụng</strong>, <strong>Install app</strong> hoặc <strong>Thêm vào màn hình chính</strong>.</li>
        <li>Xác nhận cài đặt.</li>
      </ol>
      <p class="install-note">
        Trên Chrome máy tính, biểu tượng cài đặt cũng có thể xuất hiện ở phía bên phải thanh địa chỉ.
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

    const choice =
      await deferredInstallPrompt.userChoice;

    deferredInstallPrompt = null;

    if (choice.outcome === "accepted") {
      hideInstallButtons();
    }

    return;
  }

  openInstallHelp();
}


function updateConnectionBanner() {
  if (!offlineBanner) {
    return;
  }

  offlineBanner.classList.toggle(
    "hidden",
    window.navigator.onLine
  );
}


function showUpdateBanner() {
  updateBanner?.classList.remove("hidden");
}


function hideUpdateBanner() {
  updateBanner?.classList.add("hidden");
}


async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  try {
    serviceWorkerRegistration =
      await navigator.serviceWorker.register(
        `./sw.js?v=${PWA_VERSION}`,
        {
          scope: "./"
        }
      );

    serviceWorkerRegistration.addEventListener(
      "updatefound",
      () => {
        const worker =
          serviceWorkerRegistration.installing;

        if (!worker) {
          return;
        }

        worker.addEventListener(
          "statechange",
          () => {
            if (
              worker.state === "installed"
              && navigator.serviceWorker.controller
            ) {
              showUpdateBanner();
            }
          }
        );
      }
    );

    if (serviceWorkerRegistration.waiting) {
      showUpdateBanner();
    }

  } catch (error) {
    console.error(
      "Không đăng ký được Service Worker:",
      error
    );
  }
}


window.addEventListener(
  "beforeinstallprompt",
  (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    showInstallButtons();
  }
);


window.addEventListener(
  "appinstalled",
  () => {
    deferredInstallPrompt = null;
    hideInstallButtons();
    closeInstallHelp();
  }
);


window.addEventListener(
  "online",
  updateConnectionBanner
);


window.addEventListener(
  "offline",
  updateConnectionBanner
);


installButtons.forEach((button) => {
  button.addEventListener(
    "click",
    handleInstallClick
  );
});


closeInstallHelpButton?.addEventListener(
  "click",
  closeInstallHelp
);


installModal?.addEventListener(
  "click",
  (event) => {
    if (event.target === installModal) {
      closeInstallHelp();
    }
  }
);


updateNowButton?.addEventListener(
  "click",
  () => {
    const waitingWorker =
      serviceWorkerRegistration?.waiting;

    if (waitingWorker) {
      waitingWorker.postMessage({
        type: "SKIP_WAITING"
      });

      return;
    }

    window.location.reload();
  }
);


dismissUpdateButton?.addEventListener(
  "click",
  hideUpdateBanner
);


navigator.serviceWorker?.addEventListener(
  "controllerchange",
  () => {
    if (reloadingForUpdate) {
      return;
    }

    reloadingForUpdate = true;
    window.location.reload();
  }
);


document.addEventListener(
  "DOMContentLoaded",
  () => {
    updateConnectionBanner();

    if (
      isIOSDevice()
      && !isStandaloneMode()
    ) {
      showInstallButtons();
    }

    if (isStandaloneMode()) {
      hideInstallButtons();
    }

    registerServiceWorker();
  }
);
