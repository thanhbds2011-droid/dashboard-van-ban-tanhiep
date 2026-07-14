/*
 * =========================================================
 * ONESIGNAL WEB PUSH
 * Phân hệ Quản lý nhiệm vụ
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
    initialized: false,
    initializing: null,
    identifiedUid: null,
    profile: null,
    OneSignal: null
  };

  const getElement = (id) =>
    document.getElementById(id);

  function getUi() {
    return {
      button: getElement("notificationButton"),
      buttonText: getElement("notificationButtonText"),
      statusBox: getElement("pushStatusBox"),
      statusTitle: getElement("pushStatusTitle"),
      statusText: getElement("pushStatusText"),
      statusAction: getElement("pushStatusAction")
    };
  }

  function setStatus({
    mode = "neutral",
    buttonText = "Bật thông báo",
    title = "Thông báo nhiệm vụ",
    text = "",
    showBox = false,
    showAction = false
  } = {}) {
    const ui = getUi();

    if (ui.buttonText) {
      ui.buttonText.textContent = buttonText;
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
      ui.statusTitle.textContent = title;
    }

    if (ui.statusText) {
      ui.statusText.textContent = text;
    }

    if (ui.statusAction) {
      ui.statusAction.classList.toggle(
        "hidden",
        !showAction
      );
    }
  }

  function getBrowserPermission() {
    if (!("Notification" in window)) {
      return "unsupported";
    }

    return window.Notification.permission;
  }

  async function ensureInitialized() {
    if (state.initialized && state.OneSignal) {
      return state.OneSignal;
    }

    if (state.initializing) {
      return state.initializing;
    }

    state.initializing = new Promise(
      (resolve, reject) => {
        window.OneSignalDeferred =
          window.OneSignalDeferred || [];

        window.OneSignalDeferred.push(
          async function(OneSignal) {
            try {
              await OneSignal.init({
                appId: ONESIGNAL_APP_ID,
                serviceWorkerPath:
                  SERVICE_WORKER_PATH,
                serviceWorkerParam: {
                  scope: SERVICE_WORKER_SCOPE
                },
                notifyButton: {
                  enable: false
                }
              });

              state.OneSignal = OneSignal;
              state.initialized = true;

              OneSignal.Notifications
                .addEventListener(
                  "permissionChange",
                  refreshStatus
                );

              OneSignal.User.PushSubscription
                .addEventListener(
                  "change",
                  refreshStatus
                );

              resolve(OneSignal);

            } catch (error) {
              state.initializing = null;
              reject(error);
            }
          }
        );
      }
    );

    return state.initializing;
  }

  async function identify(uid, profile) {
    if (!uid || !profile) {
      return;
    }

    try {
      const OneSignal =
        await ensureInitialized();

      await OneSignal.login(uid);

      OneSignal.User.addTags({
        module: "TASKS",
        departmentId:
          String(profile.departmentId || ""),
        role:
          String(profile.role || ""),
        active:
          profile.active === true
            ? "true"
            : "false"
      });

      state.identifiedUid = uid;
      state.profile = profile;

      await refreshStatus();

      console.info(
        "OneSignal đã nhận diện tài khoản:",
        {
          externalId: uid,
          departmentId:
            profile.departmentId,
          role:
            profile.role
        }
      );

    } catch (error) {
      console.error(
        "Không liên kết được OneSignal:",
        error
      );

      setStatus({
        mode: "warning",
        buttonText: "Kiểm tra thông báo",
        title: "Chưa kết nối được OneSignal",
        text:
          "Ứng dụng vẫn sử dụng được, nhưng chưa thể nhận thông báo đẩy trên thiết bị này.",
        showBox: true,
        showAction: true
      });
    }
  }

  async function logout() {
    try {
      const OneSignal =
        await ensureInitialized();

      await OneSignal.logout();

    } catch (error) {
      console.warn(
        "Không thể đăng xuất OneSignal:",
        error
      );

    } finally {
      state.identifiedUid = null;
      state.profile = null;

      setStatus({
        buttonText: "Bật thông báo",
        showBox: false
      });
    }
  }

  async function refreshStatus() {
    try {
      const OneSignal =
        await ensureInitialized();

      const supported =
        OneSignal.Notifications
          .isPushSupported();

      if (!supported) {
        setStatus({
          mode: "error",
          buttonText: "Không hỗ trợ",
          title: "Thiết bị không hỗ trợ Web Push",
          text:
            "Hãy sử dụng Chrome, Edge, Firefox hoặc Safari hỗ trợ thông báo web.",
          showBox: true,
          showAction: false
        });

        return;
      }

      const browserPermission =
        getBrowserPermission();

      const optedIn =
        OneSignal.User
          .PushSubscription
          .optedIn === true;

      const subscriptionId =
        OneSignal.User
          .PushSubscription
          .id;

      if (
        browserPermission === "granted"
        && optedIn
        && subscriptionId
      ) {
        setStatus({
          mode: "success",
          buttonText: "Thông báo đã bật",
          title: "Đã bật thông báo nhiệm vụ",
          text:
            "Thiết bị này đã được liên kết với tài khoản đang đăng nhập.",
          showBox: false,
          showAction: false
        });

        return;
      }

      if (browserPermission === "denied") {
        setStatus({
          mode: "error",
          buttonText: "Đã chặn",
          title: "Trình duyệt đang chặn thông báo",
          text:
            "Mở cài đặt quyền của trang, đổi Thông báo thành Cho phép rồi tải lại ứng dụng.",
          showBox: true,
          showAction: false
        });

        return;
      }

      setStatus({
        mode: "warning",
        buttonText: "Bật thông báo",
        title: "Thiết bị chưa bật thông báo",
        text:
          "Bật thông báo để nhận nhiệm vụ mới, sắp đến hạn và quá hạn.",
        showBox: true,
        showAction: true
      });

    } catch (error) {
      console.error(
        "Không kiểm tra được trạng thái OneSignal:",
        error
      );

      setStatus({
        mode: "warning",
        buttonText: "Kiểm tra thông báo",
        title: "Chưa kiểm tra được thông báo",
        text:
          "Hãy kiểm tra kết nối mạng và cấu hình OneSignal.",
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
        await ensureInitialized();

      if (
        !OneSignal.Notifications
          .isPushSupported()
      ) {
        await refreshStatus();
        return;
      }

      if (
        getBrowserPermission() === "denied"
      ) {
        await refreshStatus();
        return;
      }

      if (
        OneSignal.Notifications.permission
        && !OneSignal.User
          .PushSubscription
          .optedIn
      ) {
        await OneSignal.User
          .PushSubscription
          .optIn();

      } else if (
        !OneSignal.Notifications.permission
      ) {
        await OneSignal.Slidedown
          .promptPush();

      } else {
        await OneSignal.User
          .PushSubscription
          .optIn();
      }

      window.setTimeout(
        refreshStatus,
        900
      );

    } catch (error) {
      console.error(
        "Không bật được thông báo:",
        error
      );

      setStatus({
        mode: "error",
        buttonText: "Thử lại",
        title: "Không bật được thông báo",
        text:
          "Trình duyệt chưa cấp quyền hoặc cấu hình OneSignal chưa hoàn chỉnh.",
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

  function bindButtons() {
    const ui = getUi();

    ui.button?.addEventListener(
      "click",
      requestPermission
    );

    ui.statusAction?.addEventListener(
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

  document.addEventListener(
    "DOMContentLoaded",
    () => {
      bindButtons();

      ensureInitialized()
        .then(refreshStatus)
        .catch((error) => {
          console.error(
            "OneSignal khởi tạo thất bại:",
            error
          );

          setStatus({
            mode: "warning",
            buttonText:
              "Kiểm tra thông báo",
            title:
              "Chưa khởi tạo được thông báo",
            text:
              "Ứng dụng vẫn hoạt động, nhưng tính năng thông báo chưa sẵn sàng.",
            showBox: true,
            showAction: true
          });
        });
    }
  );
})();
