/*
 * =========================================================
 * ONESIGNAL WEB PUSH SDK v16
 * Phân hệ: QUẢN LÝ NHIỆM VỤ
 * =========================================================
 *
 * Nguyên tắc:
 * - Dùng chung OneSignal App ID với hệ thống Nhắc việc văn bản.
 * - Không gọi OneSignal.login(), addTags() hoặc logout().
 * - Firebase chịu trách nhiệm liên kết:
 *   Subscription ID ↔ UID ↔ Phòng/Khu ↔ Vai trò.
 * - app.js lưu thiết bị vào collection taskPushSubscriptions.
 *
 * Worker nhiệm vụ:
 * /dashboard-van-ban-tanhiep/push/onesignal/OneSignalSDKWorker.js
 */

(() => {
  "use strict";

  /* =======================================================
   * CẤU HÌNH
   * ======================================================= */

  const ONESIGNAL_APP_ID =
    "673200ba-0b27-489c-a596-84515dfc7d33";

  /*
   * Không đặt dấu "/" ở đầu serviceWorkerPath.
   */
  const SERVICE_WORKER_PATH =
    "dashboard-van-ban-tanhiep/push/onesignal/OneSignalSDKWorker.js";

  /*
   * Scope riêng, không trùng với PWA worker của /nhiem-vu/.
   */
  const SERVICE_WORKER_SCOPE =
    "/dashboard-van-ban-tanhiep/push/onesignal/";

  const MODULE_NAME = "TASKS";

  const SUBSCRIPTION_WAIT_TIMEOUT_MS = 30000;
  const BACKGROUND_SYNC_TIMEOUT_MS = 120000;
  const POLLING_INTERVAL_MS = 500;

  /* =======================================================
   * TRẠNG THÁI NỘI BỘ
   * ======================================================= */

  const state = {
    OneSignal: null,

    initialized: false,
    initializingPromise: null,

    currentUid: null,
    currentProfile: null,

    listenersBound: false,
    buttonsBound: false,

    subscriptionWaitPromise: null,
    backgroundSyncPromise: null
  };

  /* =======================================================
   * HÀM HỖ TRỢ
   * ======================================================= */

  function sleep(milliseconds) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, milliseconds);
    });
  }

  function getElement(id) {
    return document.getElementById(id);
  }

  function cleanText(value) {
    return String(value ?? "").trim();
  }

  function getUi() {
    return {
      statusBox:
        getElement("pushStatusBox"),

      statusTitle:
        getElement("pushStatusTitle"),

      statusText:
        getElement("pushStatusText"),

      statusAction:
        getElement("pushStatusAction")
    };
  }

  function getBrowserPermission() {
    if (!("Notification" in window)) {
      return "unsupported";
    }

    return window.Notification.permission;
  }

  function getSubscriptionId(
    OneSignal = state.OneSignal
  ) {
    return (
      OneSignal
        ?.User
        ?.PushSubscription
        ?.id ||
      null
    );
  }

  function getSubscriptionToken(
    OneSignal = state.OneSignal
  ) {
    return (
      OneSignal
        ?.User
        ?.PushSubscription
        ?.token ||
      null
    );
  }

  function isOptedIn(
    OneSignal = state.OneSignal
  ) {
    return (
      OneSignal
        ?.User
        ?.PushSubscription
        ?.optedIn === true
    );
  }

  function getOneSignalId(
    OneSignal = state.OneSignal
  ) {
    return (
      OneSignal
        ?.User
        ?.onesignalId ||
      null
    );
  }

  function isPushReady(
    OneSignal = state.OneSignal
  ) {
    return (
      getBrowserPermission() === "granted" &&
      isOptedIn(OneSignal) &&
      Boolean(getSubscriptionId(OneSignal))
    );
  }

  /* =======================================================
   * HIỂN THỊ TRẠNG THÁI
   * ======================================================= */

  function setStatus({
    mode = "neutral",
    title = "Thông báo nhiệm vụ",
    text = "",
    showBox = false,
    showAction = false,
    actionText = "Bật thông báo",
    actionDisabled = false
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

      ui.statusBox.classList.toggle(
        "is-loading",
        mode === "loading"
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

      ui.statusAction.disabled =
        actionDisabled;

      ui.statusAction.textContent =
        actionText;
    }
  }

  function hideStatusBox() {
    setStatus({
      showBox: false,
      showAction: false
    });
  }

  function showRegisteringStatus() {
    setStatus({
      mode: "loading",
      title: "Đang đăng ký thông báo",
      text:
        "Hệ thống đang đăng ký thiết bị. Vui lòng chờ trong giây lát.",
      showBox: true,
      showAction: true,
      actionText: "Đang đăng ký...",
      actionDisabled: true
    });
  }

  function showSynchronizingStatus() {
    setStatus({
      mode: "loading",
      title: "Đang đồng bộ thiết bị",
      text:
        "Trình duyệt đã cấp quyền thông báo. OneSignal đang hoàn tất đăng ký thiết bị.",
      showBox: true,
      showAction: false
    });
  }

  /* =======================================================
   * SNAPSHOT GỬI SANG APP.JS
   * ======================================================= */

  function buildSubscriptionSnapshot() {
    const OneSignal =
      state.OneSignal;

    return {
      subscriptionId:
        getSubscriptionId(OneSignal),

      token:
        getSubscriptionToken(OneSignal),

      optedIn:
        isOptedIn(OneSignal),

      permission:
        getBrowserPermission(),

      /*
       * Đây là Firebase UID lưu cục bộ.
       * Không phải OneSignal External ID.
       */
      externalId:
        state.currentUid || null,

      oneSignalId:
        getOneSignalId(OneSignal),

      module:
        MODULE_NAME,

      ready:
        isPushReady(OneSignal)
    };
  }

  function emitSubscriptionChange() {
    const snapshot =
      buildSubscriptionSnapshot();

    window.dispatchEvent(
      new CustomEvent(
        "taskpush:subscription-change",
        {
          detail: snapshot
        }
      )
    );

    return snapshot;
  }

  async function getSubscriptionSnapshot() {
    await ensureInitialized();

    return buildSubscriptionSnapshot();
  }

  /* =======================================================
   * KHỞI TẠO ONESIGNAL
   * ======================================================= */

  async function ensureInitialized() {
    if (
      state.initialized &&
      state.OneSignal
    ) {
      return state.OneSignal;
    }

    if (state.initializingPromise) {
      return state.initializingPromise;
    }

    state.initializingPromise =
      new Promise((resolve, reject) => {
        window.OneSignalDeferred =
          window.OneSignalDeferred || [];

        window.OneSignalDeferred.push(
          async (OneSignal) => {
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

              bindOneSignalListeners(
                OneSignal
              );

              console.info(
                "OneSignal SDK v16 đã khởi tạo.",
                {
                  appId:
                    ONESIGNAL_APP_ID,

                  serviceWorkerPath:
                    SERVICE_WORKER_PATH,

                  serviceWorkerScope:
                    SERVICE_WORKER_SCOPE
                }
              );

              resolve(OneSignal);

            } catch (error) {
              state.OneSignal =
                null;

              state.initialized =
                false;

              state.initializingPromise =
                null;

              console.error(
                "OneSignal.init() thất bại:",
                error
              );

              reject(error);
            }
          }
        );
      });

    return state.initializingPromise;
  }

  /* =======================================================
   * SỰ KIỆN ONESIGNAL
   * ======================================================= */

  function bindOneSignalListeners(
    OneSignal
  ) {
    if (state.listenersBound) {
      return;
    }

    state.listenersBound = true;

    OneSignal.Notifications
      .addEventListener(
        "permissionChange",
        async () => {
          console.info(
            "Quyền thông báo thay đổi:",
            getBrowserPermission()
          );

          await handlePushStateChange();
        }
      );

    OneSignal.User
      .PushSubscription
      .addEventListener(
        "change",
        async (event) => {
          console.info(
            "OneSignal Push Subscription thay đổi:",
            event
          );

          await handlePushStateChange();
        }
      );
  }

  async function handlePushStateChange() {
    await refreshStatus();

    emitSubscriptionChange();
  }

  /* =======================================================
   * CHỜ ONESIGNAL TẠO SUBSCRIPTION ID
   * ======================================================= */

  async function waitForSubscriptionId({
    timeoutMs =
      SUBSCRIPTION_WAIT_TIMEOUT_MS
  } = {}) {
    const existingId =
      getSubscriptionId();

    if (existingId) {
      return existingId;
    }

    if (state.subscriptionWaitPromise) {
      return state.subscriptionWaitPromise;
    }

    state.subscriptionWaitPromise =
      (async () => {
        const startedAt =
          Date.now();

        while (
          Date.now() - startedAt <
          timeoutMs
        ) {
          const subscriptionId =
            getSubscriptionId();

          if (subscriptionId) {
            return subscriptionId;
          }

          await sleep(
            POLLING_INTERVAL_MS
          );
        }

        return null;
      })().finally(() => {
        state.subscriptionWaitPromise =
          null;
      });

    return state.subscriptionWaitPromise;
  }

  /*
   * Tiếp tục kiểm tra nền sau khi người dùng đã cấp quyền.
   * Khi có ID, hệ thống tự ẩn khung và gửi sự kiện cho app.js.
   */
  function startBackgroundSubscriptionSync() {
    if (state.backgroundSyncPromise) {
      return state.backgroundSyncPromise;
    }

    state.backgroundSyncPromise =
      (async () => {
        const startedAt =
          Date.now();

        while (
          Date.now() - startedAt <
          BACKGROUND_SYNC_TIMEOUT_MS
        ) {
          const subscriptionId =
            getSubscriptionId();

          if (subscriptionId) {
            console.info(
              "OneSignal đã đồng bộ Subscription ID:",
              subscriptionId
            );

            hideStatusBox();
            emitSubscriptionChange();

            return subscriptionId;
          }

          await sleep(1000);
        }

        console.warn(
          "OneSignal chưa tạo Subscription ID sau thời gian chờ nền."
        );

        return null;
      })().finally(() => {
        state.backgroundSyncPromise =
          null;
      });

    return state.backgroundSyncPromise;
  }

  /* =======================================================
   * NHẬN DIỆN TÀI KHOẢN FIREBASE
   * ======================================================= */

  async function identify(
    uid,
    profile
  ) {
    const normalizedUid =
      cleanText(uid);

    if (
      !normalizedUid ||
      !profile
    ) {
      return false;
    }

    /*
     * Không gọi:
     * - OneSignal.login()
     * - OneSignal.User.addTags()
     *
     * Vì hai phân hệ dùng chung OneSignal App ID.
     * Firebase quản lý quan hệ giữa Subscription ID và tài khoản.
     */
    state.currentUid =
      normalizedUid;

    state.currentProfile =
      profile;

    try {
      await ensureInitialized();

      await refreshStatus();

      /*
       * Nếu thiết bị đã có Subscription ID,
       * app.js sẽ nhận sự kiện và lưu vào Firestore.
       */
      emitSubscriptionChange();

      console.info(
        "Đã chuẩn bị thông báo nhiệm vụ cho tài khoản:",
        {
          uid:
            normalizedUid,

          departmentId:
            profile.departmentId || "",

          role:
            profile.role || "",

          module:
            MODULE_NAME
        }
      );

      return true;

    } catch (error) {
      console.error(
        "Không chuẩn bị được thông báo nhiệm vụ:",
        error
      );

      setStatus({
        mode: "warning",
        title:
          "Chưa kết nối được thông báo",
        text:
          "Ứng dụng vẫn sử dụng được nhưng tính năng thông báo chưa sẵn sàng.",
        showBox: true,
        showAction: true,
        actionText: "Thử lại"
      });

      return false;
    }
  }

  /* =======================================================
   * KIỂM TRA TRẠNG THÁI
   * ======================================================= */

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
          title:
            "Thiết bị không hỗ trợ thông báo",
          text:
            "Hãy sử dụng phiên bản mới của Chrome, Edge, Firefox hoặc Safari.",
          showBox: true,
          showAction: false
        });

        return;
      }

      const permission =
        getBrowserPermission();

      const optedIn =
        isOptedIn(OneSignal);

      const subscriptionId =
        getSubscriptionId(OneSignal);

      /*
       * Đã đăng ký thành công:
       * ẩn toàn bộ khung thông báo.
       */
      if (
        permission === "granted" &&
        optedIn &&
        subscriptionId
      ) {
        hideStatusBox();
        return;
      }

      if (permission === "denied") {
        setStatus({
          mode: "error",
          title:
            "Trình duyệt đang chặn thông báo",
          text:
            "Bấm biểu tượng cài đặt cạnh địa chỉ website, chuyển quyền Thông báo thành Cho phép rồi tải lại ứng dụng.",
          showBox: true,
          showAction: false
        });

        return;
      }

      /*
       * Trình duyệt đã có quyền và Push đã opt-in,
       * nhưng OneSignal chưa trả Subscription ID.
       * Đây là trạng thái chờ, không phải lỗi đỏ.
       */
      if (
        permission === "granted" &&
        optedIn &&
        !subscriptionId
      ) {
        showSynchronizingStatus();

        startBackgroundSubscriptionSync();

        return;
      }

      setStatus({
        mode: "warning",
        title:
          "Thiết bị chưa bật thông báo",
        text:
          "Bật thông báo để nhận nhiệm vụ mới, sắp đến hạn và quá hạn.",
        showBox: true,
        showAction: true,
        actionText:
          "Bật thông báo"
      });

    } catch (error) {
      console.error(
        "Không kiểm tra được trạng thái OneSignal:",
        error
      );

      setStatus({
        mode: "warning",
        title:
          "Chưa kiểm tra được thông báo",
        text:
          "Hãy kiểm tra kết nối mạng rồi thử lại.",
        showBox: true,
        showAction: true,
        actionText:
          "Thử lại"
      });
    }
  }

  /* =======================================================
   * BẬT THÔNG BÁO
   * ======================================================= */

  async function requestPermission() {
    showRegisteringStatus();

    try {
      const OneSignal =
        await ensureInitialized();

      const supported =
        OneSignal.Notifications
          .isPushSupported();

      if (!supported) {
        await refreshStatus();
        return false;
      }

      const permissionBefore =
        getBrowserPermission();

      if (
        permissionBefore ===
        "denied"
      ) {
        setStatus({
          mode: "error",
          title:
            "Trình duyệt đang chặn thông báo",
          text:
            "Mở cài đặt của trang, chuyển quyền Thông báo thành Cho phép rồi tải lại ứng dụng.",
          showBox: true,
          showAction: false
        });

        return false;
      }

      /*
       * Chỉ mở hộp thoại xin quyền khi chưa được cấp.
       */
      if (
        permissionBefore !==
        "granted"
      ) {
        await OneSignal.Notifications
          .requestPermission();
      }

      const permissionAfter =
        getBrowserPermission();

      if (
        permissionAfter !==
        "granted"
      ) {
        setStatus({
          mode: "warning",
          title:
            "Chưa cấp quyền thông báo",
          text:
            "Bạn chưa chọn Cho phép khi trình duyệt hỏi quyền thông báo.",
          showBox: true,
          showAction: true,
          actionText:
            "Bật thông báo"
        });

        return false;
      }

      /*
       * Trường hợp quyền đã cấp nhưng subscription đang opt-out.
       */
      if (!isOptedIn(OneSignal)) {
        await OneSignal.User
          .PushSubscription
          .optIn();
      }

      showSynchronizingStatus();

      const subscriptionId =
        await waitForSubscriptionId({
          timeoutMs:
            SUBSCRIPTION_WAIT_TIMEOUT_MS
        });

      if (!subscriptionId) {
        /*
         * Không báo lỗi đỏ.
         * Tiếp tục theo dõi đồng bộ ở chế độ nền.
         */
        setStatus({
          mode: "loading",
          title:
            "Đang đồng bộ thiết bị",
          text:
            "Trình duyệt đã cấp quyền. OneSignal đang hoàn tất đăng ký thiết bị; bạn có thể tiếp tục sử dụng ứng dụng.",
          showBox: true,
          showAction: false
        });

        startBackgroundSubscriptionSync();

        return false;
      }

      emitSubscriptionChange();
      hideStatusBox();

      console.info(
        "Đã bật thông báo nhiệm vụ:",
        buildSubscriptionSnapshot()
      );

      return true;

    } catch (error) {
      console.error(
        "Không bật được thông báo:",
        error
      );

      setStatus({
        mode: "error",
        title:
          "Không bật được thông báo",
        text:
          error?.message ||
          "Không đăng ký được thiết bị với OneSignal. Hãy tải lại ứng dụng rồi thử lại.",
        showBox: true,
        showAction: true,
        actionText:
          "Thử lại"
      });

      return false;
    }
  }

  /* =======================================================
   * ĐĂNG XUẤT PHÂN HỆ NHIỆM VỤ
   * ======================================================= */

  async function logout() {
    /*
     * Không gọi OneSignal.logout() hoặc optOut().
     *
     * Hai phân hệ dùng chung OneSignal App ID.
     * Gọi logout/optOut ở đây có thể ảnh hưởng tới
     * hệ thống Nhắc việc văn bản.
     *
     * app.js đã đánh dấu bản ghi taskPushSubscriptions
     * của tài khoản hiện tại thành active = false
     * trước khi gọi hàm này.
     */

    state.currentUid =
      null;

    state.currentProfile =
      null;

    /*
     * Không phát sự kiện subscription-change tại đây,
     * vì app.js có thể lưu lại active = true sau khi
     * vừa đánh dấu thiết bị là false.
     */
    hideStatusBox();

    return true;
  }

  /* =======================================================
   * GẮN NÚT
   * ======================================================= */

  function bindButtons() {
    if (state.buttonsBound) {
      return;
    }

    state.buttonsBound = true;

    const ui = getUi();

    ui.statusAction
      ?.addEventListener(
        "click",
        async () => {
          await requestPermission();
        }
      );
  }

  /* =======================================================
   * API CHO APP.JS
   * ======================================================= */

  window.TaskPush = {
    identify,
    logout,
    refreshStatus,
    requestPermission,
    getSubscriptionSnapshot
  };

  /* =======================================================
   * KHỞI ĐỘNG
   * ======================================================= */

  async function bootstrap() {
    bindButtons();

    try {
      await ensureInitialized();

      await refreshStatus();

      emitSubscriptionChange();

    } catch (error) {
      console.error(
        "OneSignal khởi tạo thất bại:",
        error
      );

      setStatus({
        mode: "error",
        title:
          "Chưa khởi tạo được thông báo",
        text:
          "Ứng dụng vẫn hoạt động nhưng tính năng thông báo chưa sẵn sàng.",
        showBox: true,
        showAction: true,
        actionText:
          "Thử lại"
      });
    }
  }

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      bootstrap,
      {
        once: true
      }
    );
  } else {
    bootstrap();
  }
})();