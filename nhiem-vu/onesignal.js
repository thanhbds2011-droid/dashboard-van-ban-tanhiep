/*
 * =========================================================
 * ONESIGNAL WEB PUSH SDK v16 — DUAL ORIGIN
 * Phân hệ: QUẢN LÝ NHIỆM VỤ
 * =========================================================
 *
 * Nguyên tắc:
 * - GitHub Pages tiếp tục dùng OneSignal App hiện hữu.
 * - kpi-tanhiep.vercel.app dùng OneSignal App riêng cho origin Vercel.
 * - Không gọi OneSignal.login(), addTags() hoặc logout().
 * - Firebase chịu trách nhiệm liên kết:
 *   Subscription ID ↔ UID ↔ Phòng/Khu ↔ Vai trò ↔ Push provider.
 * - app-v3.js lưu thiết bị vào collection taskPushSubscriptions.
 * - Chỉ cấu hình Push Nhiệm vụ; không thay đổi nghiệp vụ/KPI, phân quyền, UI hoặc phân hệ khác.
 */

(() => {
  "use strict";

  /* =======================================================
   * CẤU HÌNH
   * ======================================================= */

  const PUSH_PROVIDERS = Object.freeze({
    GITHUB: Object.freeze({
      key: "GITHUB",
      origin: "https://thanhbds2011-droid.github.io",
      appId: "673200ba-0b27-489c-a596-84515dfc7d33",
      serviceWorkerPath: "/dashboard-van-ban-tanhiep/OneSignalSDKWorker.js",
      serviceWorkerScope: "/dashboard-van-ban-tanhiep/",
      safariWebId: ""
    }),
    VERCEL: Object.freeze({
      key: "VERCEL",
      origin: "https://kpi-tanhiep.vercel.app",
      appId: "5816e774-5237-4773-bf24-195c09da25f0",
      serviceWorkerPath: "push/onesignal/OneSignalSDKWorker.js",
      serviceWorkerScope: "/push/onesignal/",
      safariWebId: "web.onesignal.auto.459ab5a0-25ed-43f1-a7b1-99d986ce9992"
    })
  });

  function resolvePushProvider() {
    const currentOrigin = String(window.location.origin || "").toLowerCase();

    if (currentOrigin === PUSH_PROVIDERS.VERCEL.origin.toLowerCase()) {
      return PUSH_PROVIDERS.VERCEL;
    }

    if (currentOrigin === PUSH_PROVIDERS.GITHUB.origin.toLowerCase()) {
      return PUSH_PROVIDERS.GITHUB;
    }

    return null;
  }

  const PUSH_PROVIDER = resolvePushProvider();
  const ONESIGNAL_APP_ID = PUSH_PROVIDER?.appId || "";
  const SERVICE_WORKER_PATH = PUSH_PROVIDER?.serviceWorkerPath || "";
  const SERVICE_WORKER_SCOPE = PUSH_PROVIDER?.serviceWorkerScope || "";
  const MODULE_NAME = "TASKS";

  const SUBSCRIPTION_WAIT_TIMEOUT_MS = 30000;
  const BACKGROUND_SYNC_TIMEOUT_MS = 120000;
  const POLLING_INTERVAL_MS = 500;

  /* =======================================================
   * TRẠNG THÁI NỘI BỘ
   * ======================================================= */

  const GLOBAL_STATE_KEY = "__TAN_HIEP_TASK_PUSH_SINGLETON_V1__";
  const state = window[GLOBAL_STATE_KEY] || (window[GLOBAL_STATE_KEY] = {
    OneSignal: null,
    initialized: false,
    initializingPromise: null,
    initializedAppId: "",
    currentUid: null,
    currentProfile: null,
    listenersBound: false,
    buttonsBound: false,
    subscriptionWaitPromise: null,
    backgroundSyncPromise: null
  });

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
        "Trình duyệt đã cấp quyền thông báo. Hệ thống đang hoàn tất đăng ký thiết bị.",
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

      pushProviderKey:
        PUSH_PROVIDER?.key || "UNSUPPORTED",

      pushOrigin:
        PUSH_PROVIDER?.origin || window.location.origin || "",

      oneSignalAppId:
        PUSH_PROVIDER?.appId || "",

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
    if (!PUSH_PROVIDER) {
      throw new Error(
        "Domain hiện tại chưa được cấu hình Web Push. Hãy sử dụng kpi-tanhiep.vercel.app hoặc GitHub Pages production."
      );
    }

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
              const initOptions = {
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
              };

              if (PUSH_PROVIDER.safariWebId) {
                initOptions.safari_web_id =
                  PUSH_PROVIDER.safariWebId;
              }

              try {
                await OneSignal.init(initOptions);
              } catch (initError) {
                const message = String(initError?.message || initError || "").toLowerCase();
                // Mixed cache/reload có thể đưa cùng SDK tới đây lần hai. Nếu SDK đã khởi tạo
                // đúng origin/App ID thì tái sử dụng thay vì biến Push thành lỗi toàn ứng dụng.
                if (!message.includes("already initialized") && !message.includes("already been initialized")) throw initError;
                console.info("OneSignal đã được khởi tạo trước đó; tái sử dụng singleton hiện tại.");
              }

              state.OneSignal = OneSignal;
              state.initialized = true;
              state.initializedAppId = ONESIGNAL_APP_ID;

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
                    SERVICE_WORKER_SCOPE,

                  pushProviderKey:
                    PUSH_PROVIDER.key,

                  pushOrigin:
                    PUSH_PROVIDER.origin
                }
              );

              resolve(OneSignal);

            } catch (error) {
              state.initializingPromise = null;
              if (!state.OneSignal) state.initialized = false;

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
     * Không dùng OneSignal External ID.
     * Firebase quản lý quan hệ giữa Subscription ID, tài khoản và provider.
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
            "Trình duyệt đã cấp quyền. Hệ thống đang hoàn tất đăng ký thiết bị; bạn có thể tiếp tục sử dụng ứng dụng.",
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
          "Không đăng ký được thiết bị nhận thông báo. Hãy tải lại ứng dụng rồi thử lại.",
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
     * Không gọi logout/optOut tại SDK khi đăng xuất tài khoản ứng dụng.
     * app-v3.js chỉ vô hiệu hóa đúng taskPushSubscriptions của tài khoản hiện tại.
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

  function getProviderInfo() {
    return {
      pushProviderKey: PUSH_PROVIDER?.key || "UNSUPPORTED",
      pushOrigin: PUSH_PROVIDER?.origin || window.location.origin || "",
      oneSignalAppId: PUSH_PROVIDER?.appId || "",
      serviceWorkerPath: PUSH_PROVIDER?.serviceWorkerPath || "",
      serviceWorkerScope: PUSH_PROVIDER?.serviceWorkerScope || ""
    };
  }

  /* =======================================================
   * API CHO APP.JS
   * ======================================================= */

  window.TaskPush = {
    identify,
    logout,
    refreshStatus,
    requestPermission,
    getSubscriptionSnapshot,
    getProviderInfo
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

      // Push là kênh bổ sung; không hiển thị banner lỗi lớn trên mọi màn hình.
      // Trạng thái chi tiết được hiển thị trong “Cài đặt Push” của Trung tâm thông báo.
      setStatus({
        mode: "error",
        title: "Thông báo Push chưa sẵn sàng",
        text: "Ứng dụng và Trung tâm thông báo vẫn hoạt động bình thường.",
        showBox: false,
        showAction: false,
        actionText: "Thử lại"
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