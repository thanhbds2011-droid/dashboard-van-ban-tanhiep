/*
 * =========================================================
 * ONESIGNAL WEB PUSH — BẢN SỬA 8.4.2A
 * =========================================================
 */

(() => {
  "use strict";

  const ONESIGNAL_APP_ID =
    "673200ba-0b27-489c-a596-84515dfc7d33";

  const SERVICE_WORKER_PATH =
    "dashboard-van-ban-tanhiep/OneSignalSDKWorker.js";

  const SERVICE_WORKER_SCOPE =
    "/dashboard-van-ban-tanhiep/push/onesignal/";

  const state = {
    OneSignal: null,
    initPromise: null,
    initialized: false,
    currentUid: null
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function getUi() {
    return {
      button:
        byId("notificationButton"),

      buttonText:
        byId("notificationButtonText"),

      statusBox:
        byId("pushStatusBox"),

      statusTitle:
        byId("pushStatusTitle"),

      statusText:
        byId("pushStatusText"),

      statusAction:
        byId("pushStatusAction")
    };
  }

  function setUi({
    mode = "neutral",
    buttonText = "Bật thông báo",
    title = "Thông báo nhiệm vụ",
    text = "",
    showBox = false,
    showAction = false
  } = {}) {
    const ui = getUi();

    if (ui.buttonText) {
      ui.buttonText.textContent =
        buttonText;
    }

    if (ui.button) {
      ui.button.classList.toggle(
        "is-enabled",
        mode === "success"
      );

      ui.button.classList.toggle(
        "is-blocked",
        mode === "error"
      );
    }

    if (ui.statusBox) {
      ui.statusBox.classList.toggle(
        "hidden",
        !showBox
      );

      ui.statusBox.classList.toggle(
        "is-success",
        mode === "success"
      );

      ui.statusBox.classList.toggle(
        "is-warning",
        mode === "warning"
      );

      ui.statusBox.classList.toggle(
        "is-error",
        mode === "error"
      );
    }

    if (ui.statusTitle) {
      ui.statusTitle.textContent =
        title;
    }

    if (ui.statusText) {
      ui.statusText.textContent =
        text;
    }

    if (ui.statusAction) {
      ui.statusAction.classList.toggle(
        "hidden",
        !showAction
      );
    }
  }

  function browserPermission() {
    if (!("Notification" in window)) {
      return "unsupported";
    }

    return Notification.permission;
  }

  async function initOneSignal() {
    if (
      state.initialized &&
      state.OneSignal
    ) {
      return state.OneSignal;
    }

    if (state.initPromise) {
      return state.initPromise;
    }

    state.initPromise =
      new Promise((resolve, reject) => {
        window.OneSignalDeferred =
          window.OneSignalDeferred || [];

        window.OneSignalDeferred.push(
          async function(OneSignal) {
            try {
              await OneSignal.init({
                appId:
                  ONESIGNAL_APP_ID,

                serviceWorkerPath:
                  SERVICE_WORKER_PATH,

                serviceWorkerParam: {
                  scope:
                    SERVICE_WORKER_SCOPE
                },

                notifyButton: {
                  enable: false
                }
              });

              OneSignal.Debug
                .setLogLevel("warn");

              state.OneSignal =
                OneSignal;

              state.initialized =
                true;

              OneSignal.Notifications
                .addEventListener(
                  "permissionChange",
                  refreshStatus
                );

              OneSignal.User
                .PushSubscription
                .addEventListener(
                  "change",
                  refreshStatus
                );

              resolve(OneSignal);

            } catch (error) {
              state.initPromise = null;
              reject(error);
            }
          }
        );
      });

    return state.initPromise;
  }

  async function refreshStatus() {
    try {
      const OneSignal =
        await initOneSignal();

      if (
        !OneSignal.Notifications
          .isPushSupported()
      ) {
        setUi({
          mode: "error",
          buttonText: "Không hỗ trợ",
          title:
            "Thiết bị không hỗ trợ thông báo web",
          text:
            "Hãy sử dụng Chrome, Edge, Firefox hoặc Safari phiên bản mới.",
          showBox: true,
          showAction: false
        });

        return;
      }

      const permission =
        browserPermission();

      const subscriptionId =
        OneSignal.User
          .PushSubscription
          .id;

      const optedIn =
        OneSignal.User
          .PushSubscription
          .optedIn === true;

      if (
        permission === "granted" &&
        subscriptionId &&
        optedIn
      ) {
        setUi({
          mode: "success",
          buttonText:
            "Thông báo đã bật",
          title:
            "Đã bật thông báo nhiệm vụ",
          text:
            "Thiết bị này đã đăng ký nhận thông báo.",
          showBox: false,
          showAction: false
        });

        return;
      }

      if (permission === "denied") {
        setUi({
          mode: "error",
          buttonText: "Đã chặn",
          title:
            "Trình duyệt đang chặn thông báo",
          text:
            "Bấm biểu tượng bên trái thanh địa chỉ, mở Quyền của trang và chuyển Thông báo thành Cho phép.",
          showBox: true,
          showAction: false
        });

        return;
      }

      setUi({
        mode: "warning",
        buttonText: "Bật thông báo",
        title:
          "Thiết bị chưa bật thông báo",
        text:
          "Bấm Bật thông báo để nhận nhiệm vụ mới, sắp hạn và quá hạn.",
        showBox: true,
        showAction: true
      });

    } catch (error) {
      console.error(
        "OneSignal refreshStatus:",
        error
      );

      setUi({
        mode: "error",
        buttonText: "Thử lại",
        title:
          "Chưa khởi tạo được OneSignal",
        text:
          "Kiểm tra file OneSignalSDKWorker.js, cấu hình Web Push và tải lại trang.",
        showBox: true,
        showAction: true
      });
    }
  }

  async function requestPermission() {
    const ui = getUi();

    if (ui.button) {
      ui.button.disabled = true;
    }

    if (ui.statusAction) {
      ui.statusAction.disabled = true;
    }

    try {
      const OneSignal =
        await initOneSignal();

      if (
        !OneSignal.Notifications
          .isPushSupported()
      ) {
        await refreshStatus();
        return;
      }

      if (
        browserPermission() ===
        "denied"
      ) {
        await refreshStatus();
        return;
      }

      if (
        !OneSignal.Notifications
          .permission
      ) {
        await OneSignal.Notifications
          .requestPermission();
      }

      if (
        OneSignal.Notifications
          .permission
      ) {
        await OneSignal.User
          .PushSubscription
          .optIn();
      }

      window.setTimeout(
        refreshStatus,
        1200
      );

    } catch (error) {
      console.error(
        "OneSignal requestPermission:",
        error
      );

      setUi({
        mode: "error",
        buttonText: "Thử lại",
        title:
          "Không bật được thông báo",
        text:
          "Mở Console để xem lỗi hoặc kiểm tra quyền Thông báo của trang.",
        showBox: true,
        showAction: true
      });

    } finally {
      if (ui.button) {
        ui.button.disabled = false;
      }

      if (ui.statusAction) {
        ui.statusAction.disabled = false;
      }
    }
  }

  async function identify(
    uid,
    profile
  ) {
    if (!uid || !profile) {
      return;
    }

    try {
      const OneSignal =
        await initOneSignal();

      await OneSignal.login(uid);

      OneSignal.User.addTags({
        module:
          "TASKS",

        departmentId:
          String(
            profile.departmentId || ""
          ),

        role:
          String(
            profile.role || ""
          ),

        active:
          profile.active === true
            ? "true"
            : "false"
      });

      state.currentUid = uid;

      await refreshStatus();

    } catch (error) {
      console.error(
        "OneSignal identify:",
        error
      );

      setUi({
        mode: "error",
        buttonText: "Thử lại",
        title:
          "Chưa liên kết được tài khoản",
        text:
          "Ứng dụng vẫn hoạt động nhưng thiết bị chưa đăng ký nhận thông báo.",
        showBox: true,
        showAction: true
      });
    }
  }

  async function logout() {
    try {
      const OneSignal =
        await initOneSignal();

      await OneSignal.logout();

    } catch (error) {
      console.warn(
        "OneSignal logout:",
        error
      );

    } finally {
      state.currentUid = null;

      setUi({
        buttonText:
          "Bật thông báo",
        showBox: false
      });
    }
  }

  function bindUi() {
    const ui = getUi();

    if (!ui.button) {
      console.error(
        "Không tìm thấy notificationButton trong index.html."
      );
    }

    ui.button?.addEventListener(
      "click",
      requestPermission
    );

    ui.statusAction
      ?.addEventListener(
        "click",
        requestPermission
      );
  }

  window.TaskPush = {
    identify,
    logout,
    refreshStatus,
    requestPermission
  };

  function start() {
    bindUi();

    initOneSignal()
      .then(refreshStatus)
      .catch((error) => {
        console.error(
          "OneSignal init:",
          error
        );

        setUi({
          mode: "error",
          buttonText: "Thử lại",
          title:
            "OneSignal chưa khởi tạo",
          text:
            "Kiểm tra cấu hình Service Worker hoặc mã SDK trong index.html.",
          showBox: true,
          showAction: true
        });
      });
  }

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      start,
      {
        once: true
      }
    );
  } else {
    start();
  }
})();
