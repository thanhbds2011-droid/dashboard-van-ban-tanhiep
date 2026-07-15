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
  "dashboard-van-ban-tanhiep/nhiem-vu/OneSignalSDKWorker.js";

const SERVICE_WORKER_SCOPE =
  "/dashboard-van-ban-tanhiep/nhiem-vu/push/onesignal/";

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
      statusBox:
        getElement(
          "pushStatusBox"
        ),

      statusTitle:
        getElement(
          "pushStatusTitle"
        ),

      statusText:
        getElement(
          "pushStatusText"
        ),

      statusAction:
        getElement(
          "pushStatusAction"
        )
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

  function getBrowserPermission() {
    if (
      !(
        "Notification" in window
      )
    ) {
      return "unsupported";
    }

    return window.Notification.permission;
  }

  async function ensureInitialized() {
    if (
      state.initialized &&
      state.OneSignal
    ) {
      return state.OneSignal;
    }

    if (state.initializing) {
      return state.initializing;
    }

    state.initializing =
      new Promise(
        (resolve, reject) => {
          window.OneSignalDeferred =
            window.OneSignalDeferred || [];

          window.OneSignalDeferred.push(
            async function(
              OneSignal
            ) {
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

                state.OneSignal =
                  OneSignal;

                state.initialized =
                  true;

                OneSignal.Notifications
                  .addEventListener(
                    "permissionChange",
                    async () => {
                      await refreshStatus();

                      emitSubscriptionChange();
                    }
                  );

                OneSignal.User
                  .PushSubscription
                  .addEventListener(
                    "change",
                    async () => {
                      await refreshStatus();

                      emitSubscriptionChange();
                    }
                  );

                resolve(
                  OneSignal
                );

              } catch (error) {
                state.initializing =
                  null;

                reject(
                  error
                );
              }
            }
          );
        }
      );

    return state.initializing;
  }

  function buildSubscriptionSnapshot() {
    const OneSignal =
      state.OneSignal;

    return {
      subscriptionId:
        OneSignal
          ?.User
          ?.PushSubscription
          ?.id || null,

      optedIn:
        OneSignal
          ?.User
          ?.PushSubscription
          ?.optedIn === true,

      permission:
        getBrowserPermission(),

      externalId:
        OneSignal
          ?.User
          ?.externalId
        || state.identifiedUid
        || null,

      oneSignalId:
        OneSignal
          ?.User
          ?.onesignalId
        || null
    };
  }

  function emitSubscriptionChange() {
    window.dispatchEvent(
      new CustomEvent(
        "taskpush:subscription-change",
        {
          detail:
            buildSubscriptionSnapshot()
        }
      )
    );
  }

  async function getSubscriptionSnapshot() {
    await ensureInitialized();

    return buildSubscriptionSnapshot();
  }

  async function identify(
    uid,
    profile
  ) {
    if (
      !uid ||
      !profile
    ) {
      return;
    }

    try {
      const OneSignal =
        await ensureInitialized();

      await OneSignal.login(
        uid
      );

      OneSignal.User.addTags({
        module:
          "TASKS",

        departmentId:
          String(
            profile.departmentId ||
            ""
          ),

        role:
          String(
            profile.role ||
            ""
          ),

        active:
          profile.active === true
            ? "true"
            : "false"
      });

      state.identifiedUid =
        uid;

      state.profile =
        profile;

      await refreshStatus();

      emitSubscriptionChange();

      console.info(
        "OneSignal đã nhận diện tài khoản:",
        {
          externalId:
            uid,

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
        mode:
          "warning",

        buttonText:
          "Kiểm tra thông báo",

        title:
          "Chưa kết nối được OneSignal",

        text:
          "Ứng dụng vẫn sử dụng được, nhưng chưa thể nhận thông báo đẩy trên thiết bị này.",

        showBox:
          true,

        showAction:
          true
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
      state.identifiedUid =
        null;

      state.profile =
        null;

      setStatus({
        buttonText:
          "Bật thông báo",

        showBox:
          false
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
          mode:
            "error",

          buttonText:
            "Không hỗ trợ",

          title:
            "Thiết bị không hỗ trợ Web Push",

          text:
            "Hãy sử dụng Chrome, Edge, Firefox hoặc Safari hỗ trợ thông báo web.",

          showBox:
            true,

          showAction:
            false
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
        browserPermission ===
          "granted" &&
        optedIn &&
        subscriptionId
      ) {
        setStatus({
          mode:
            "success",

          buttonText:
            "Thông báo đã bật",

          title:
            "Đã bật thông báo nhiệm vụ",

          text:
            "Thiết bị này đã được liên kết với tài khoản đang đăng nhập.",

          showBox:
            false,

          showAction:
            false
        });

        return;
      }

      if (
        browserPermission ===
        "denied"
      ) {
        setStatus({
          mode:
            "error",

          buttonText:
            "Đã chặn",

          title:
            "Trình duyệt đang chặn thông báo",

          text:
            "Mở cài đặt quyền của trang, đổi Thông báo thành Cho phép rồi tải lại ứng dụng.",

          showBox:
            true,

          showAction:
            false
        });

        return;
      }

      setStatus({
        mode:
          "warning",

        buttonText:
          "Bật thông báo",

        title:
          "Thiết bị chưa bật thông báo",

        text:
          "Bật thông báo để nhận nhiệm vụ mới, sắp đến hạn và quá hạn.",

        showBox:
          true,

        showAction:
          true
      });

    } catch (error) {
      console.error(
        "Không kiểm tra được trạng thái OneSignal:",
        error
      );

      setStatus({
        mode:
          "warning",

        buttonText:
          "Kiểm tra thông báo",

        title:
          "Chưa kiểm tra được thông báo",

        text:
          "Hãy kiểm tra kết nối mạng và cấu hình OneSignal.",

        showBox:
          true,

        showAction:
          true
      });
    }
  }

  async function requestPermission() {
  const ui = getUi();

  if (ui.statusAction) {
    ui.statusAction.disabled = true;
    ui.statusAction.textContent = "Đang đăng ký...";
  }

  try {
    const OneSignal = await ensureInitialized();

    if (!OneSignal.Notifications.isPushSupported()) {
      await refreshStatus();
      return;
    }

    const currentPermission = getBrowserPermission();

    if (currentPermission === "denied") {
      setStatus({
        mode: "error",
        title: "Trình duyệt đang chặn thông báo",
        text:
          "Bấm biểu tượng cài đặt cạnh địa chỉ website, chuyển quyền Thông báo thành Cho phép rồi tải lại trang.",
        showBox: true,
        showAction: false
      });

      return;
    }

    if (currentPermission !== "granted") {
      await OneSignal.Notifications.requestPermission();
    }

    if (getBrowserPermission() !== "granted") {
      setStatus({
        mode: "warning",
        title: "Chưa cấp quyền thông báo",
        text:
          "Bạn chưa chọn Cho phép. Hãy bấm lại nút đăng ký và chọn Cho phép khi trình duyệt hỏi.",
        showBox: true,
        showAction: true
      });

      return;
    }

    if (
      !OneSignal.User.PushSubscription.optedIn
    ) {
      await OneSignal.User.PushSubscription.optIn();
    }

    let subscriptionId = null;

    for (let attempt = 0; attempt < 15; attempt += 1) {
      subscriptionId =
        OneSignal.User.PushSubscription.id || null;

      if (
        subscriptionId &&
        OneSignal.User.PushSubscription.optedIn
      ) {
        break;
      }

      await new Promise((resolve) => {
        window.setTimeout(resolve, 500);
      });
    }

    if (!subscriptionId) {
      throw new Error(
        "OneSignal chưa tạo được Subscription ID. Hãy tải lại trang và thử lại."
      );
    }

    await refreshStatus();
    emitSubscriptionChange();

  } catch (error) {
    console.error(
      "Không bật được thông báo:",
      error
    );

    setStatus({
      mode: "error",
      title: "Không bật được thông báo",
      text:
        error?.message ||
        "Không đăng ký được thiết bị với OneSignal. Hãy tải lại trang và thử lại.",
      showBox: true,
      showAction: true
    });

  } finally {
    if (ui.statusAction) {
      ui.statusAction.disabled = false;
      ui.statusAction.textContent = "Bật thông báo";
    }
  }
}

  function bindButtons() {
    const ui =
      getUi();

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
    requestPermission,
    getSubscriptionSnapshot
  };

  document.addEventListener(
    "DOMContentLoaded",
    () => {
      bindButtons();

      ensureInitialized()
        .then(
          refreshStatus
        )
        .catch(
          (error) => {
            console.error(
              "OneSignal khởi tạo thất bại:",
              error
            );

            setStatus({
              mode:
                "warning",

              buttonText:
                "Kiểm tra thông báo",

              title:
                "Chưa khởi tạo được thông báo",

              text:
                "Ứng dụng vẫn hoạt động, nhưng tính năng thông báo chưa sẵn sàng.",

              showBox:
                true,

              showAction:
                true
            });
          }
        );
    }
  );
})();
