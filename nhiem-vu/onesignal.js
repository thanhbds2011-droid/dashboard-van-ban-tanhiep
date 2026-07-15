/*
 * =========================================================
 * ONESIGNAL WEB PUSH SDK v16
 * Phân hệ: QUẢN LÝ NHIỆM VỤ
 * =========================================================
 *
 * Yêu cầu:
 * 1. Trang phải tải SDK:
 *
 * <script
 *   src="https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js"
 *   defer>
 * </script>
 *
 * 2. Worker phải tồn tại tại:
 *
 * /dashboard-van-ban-tanhiep/push/onesignal/OneSignalSDKWorker.js
 *
 * Nội dung Worker:
 *
 * importScripts(
 *   "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js"
 * );
 */

(() => {
  "use strict";

  /* =======================================================
   * CẤU HÌNH
   * ======================================================= */

  const ONESIGNAL_APP_ID =
    "673200ba-0b27-489c-a596-84515dfc7d33";

  /*
   * serviceWorkerPath:
   * - Không có dấu "/" ở đầu.
   * - Tính từ gốc origin.
   */
  const SERVICE_WORKER_PATH =
    "dashboard-van-ban-tanhiep/push/onesignal/OneSignalSDKWorker.js";

  /*
   * Scope riêng cho OneSignal.
   * Không trùng với PWA worker:
   * /dashboard-van-ban-tanhiep/nhiem-vu/
   */
  const SERVICE_WORKER_SCOPE =
    "/dashboard-van-ban-tanhiep/push/onesignal/";

  const MODULE_NAME = "TASKS";

  const SUBSCRIPTION_WAIT_TIMEOUT_MS = 30000;
  const IDENTITY_WAIT_TIMEOUT_MS = 20000;
  const POLLING_INTERVAL_MS = 500;

  /* =======================================================
   * TRẠNG THÁI NỘI BỘ
   * ======================================================= */

  const state = {
    OneSignal: null,

    initialized: false,
    initializingPromise: null,

    requestedUid: null,
    requestedProfile: null,

    identifiedUid: null,

    identitySyncPromise: null,
    subscriptionWaitPromise: null,

    listenersBound: false,
    buttonsBound: false
  };

  /* =======================================================
   * HÀM TIỆN ÍCH
   * ======================================================= */

  function sleep(milliseconds) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, milliseconds);
    });
  }

  function getElement(id) {
    return document.getElementById(id);
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

  function normalizeText(value) {
    return String(value ?? "").trim();
  }

  function getSubscriptionId(OneSignal = state.OneSignal) {
    return (
      OneSignal
        ?.User
        ?.PushSubscription
        ?.id ||
      null
    );
  }

  function getSubscriptionToken(OneSignal = state.OneSignal) {
    return (
      OneSignal
        ?.User
        ?.PushSubscription
        ?.token ||
      null
    );
  }

  function isOptedIn(OneSignal = state.OneSignal) {
    return (
      OneSignal
        ?.User
        ?.PushSubscription
        ?.optedIn === true
    );
  }

  function getExternalId(OneSignal = state.OneSignal) {
    return (
      OneSignal
        ?.User
        ?.externalId ||
      null
    );
  }

  function getOneSignalId(OneSignal = state.OneSignal) {
    return (
      OneSignal
        ?.User
        ?.onesignalId ||
      null
    );
  }

  function isPushReady(OneSignal = state.OneSignal) {
    return (
      getBrowserPermission() === "granted" &&
      isOptedIn(OneSignal) &&
      Boolean(getSubscriptionId(OneSignal))
    );
  }

  /* =======================================================
   * GIAO DIỆN TRẠNG THÁI
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

      ui.statusAction.disabled =
        actionDisabled;

      ui.statusAction.textContent =
        actionText;
    }
  }

  function showRegisteringStatus() {
    setStatus({
      mode: "loading",
      title: "Đang đăng ký thông báo",
      text:
        "Hệ thống đang liên kết thiết bị với OneSignal. Vui lòng chờ trong giây lát.",
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

  function hideStatusBox() {
    setStatus({
      showBox: false,
      showAction: false
    });
  }

  /* =======================================================
   * SNAPSHOT VÀ SỰ KIỆN GỬI CHO APP.JS
   * ======================================================= */

  function buildSubscriptionSnapshot() {
    const OneSignal = state.OneSignal;

    return {
      subscriptionId:
        getSubscriptionId(OneSignal),

      token:
        getSubscriptionToken(OneSignal),

      optedIn:
        isOptedIn(OneSignal),

      permission:
        getBrowserPermission(),

      externalId:
        getExternalId(OneSignal) ||
        state.identifiedUid ||
        state.requestedUid ||
        null,

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
              state.initialized =
                false;

              state.OneSignal =
                null;

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
   * LISTENER ONESIGNAL
   * ======================================================= */

  function bindOneSignalListeners(OneSignal) {
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
            "Push Subscription thay đổi:",
            event
          );

          await handlePushStateChange();
        }
      );

    /*
     * Một số bản SDK cung cấp sự kiện change trên User.
     * Dùng optional chaining để không làm lỗi nếu API chưa có.
     */
    OneSignal.User
      ?.addEventListener?.(
        "change",
        async (event) => {
          console.info(
            "OneSignal User thay đổi:",
            event
          );

          await handlePushStateChange();
        }
      );
  }

  async function handlePushStateChange() {
    await refreshStatus();

    emitSubscriptionChange();

    if (
      getSubscriptionId() &&
      state.requestedUid &&
      state.requestedProfile
    ) {
      await syncIdentityIfReady();
    }
  }

  /* =======================================================
   * CHỜ SUBSCRIPTION ID
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
      new Promise(async (resolve) => {
        const startedAt =
          Date.now();

        while (
          Date.now() - startedAt <
          timeoutMs
        ) {
          const subscriptionId =
            getSubscriptionId();

          if (subscriptionId) {
            resolve(subscriptionId);
            return;
          }

          await sleep(
            POLLING_INTERVAL_MS
          );
        }

        resolve(null);
      }).finally(() => {
        state.subscriptionWaitPromise =
          null;
      });

    return state.subscriptionWaitPromise;
  }

  /* =======================================================
   * NHẬN DIỆN NGƯỜI DÙNG
   * ======================================================= */

  async function identify(uid, profile) {
    const normalizedUid =
      normalizeText(uid);

    if (
      !normalizedUid ||
      !profile
    ) {
      return;
    }

    /*
     * Chỉ lưu yêu cầu nhận diện.
     * Chưa login ngay nếu thiết bị chưa có Subscription ID.
     */
    state.requestedUid =
      normalizedUid;

    state.requestedProfile =
      profile;

    try {
      await ensureInitialized();

      /*
       * Nếu Subscription đã sẵn sàng thì liên kết ngay.
       * Nếu chưa, listener change sẽ gọi lại sau.
       */
      if (getSubscriptionId()) {
        await syncIdentityIfReady();
      }

      await refreshStatus();

      emitSubscriptionChange();

    } catch (error) {
      console.error(
        "Không chuẩn bị được nhận diện OneSignal:",
        error
      );

      setStatus({
        mode: "warning",
        title: "Chưa kết nối được thông báo",
        text:
          "Ứng dụng vẫn sử dụng được nhưng chưa thể liên kết tài khoản với OneSignal.",
        showBox: true,
        showAction: true,
        actionText: "Thử lại"
      });
    }
  }

  async function syncIdentityIfReady() {
    if (state.identitySyncPromise) {
      return state.identitySyncPromise;
    }

    state.identitySyncPromise =
      performIdentitySync()
        .finally(() => {
          state.identitySyncPromise =
            null;
        });

    return state.identitySyncPromise;
  }

  async function performIdentitySync() {
    const OneSignal =
      await ensureInitialized();

    const uid =
      normalizeText(
        state.requestedUid
      );

    const profile =
      state.requestedProfile;

    if (!uid || !profile) {
      return false;
    }

    const subscriptionId =
      getSubscriptionId(OneSignal);

    if (!subscriptionId) {
      console.info(
        "Chưa đồng bộ danh tính vì chưa có Subscription ID."
      );

      return false;
    }

    /*
     * Không login lặp lại nếu đã đúng UID.
     */
    const currentExternalId =
      normalizeText(
        getExternalId(OneSignal)
      );

    if (
      currentExternalId !== uid ||
      state.identifiedUid !== uid
    ) {
      console.info(
        "Đang liên kết OneSignal với Firebase UID:",
        uid
      );

      await OneSignal.login(uid);

      /*
       * Đợi User Model cập nhật External ID.
       * Không gọi addTags ngay sau login.
       */
      await waitForExternalId(
        uid,
        IDENTITY_WAIT_TIMEOUT_MS
      );
    }

    /*
     * Chỉ ghi tag sau khi login hoàn thành.
     */
    await OneSignal.User.addTags({
      module:
        MODULE_NAME,

      departmentId:
        normalizeText(
          profile.departmentId
        ),

      role:
        normalizeText(
          profile.role
        ),

      active:
        profile.active === true
          ? "true"
          : "false"
    });

    state.identifiedUid =
      uid;

    console.info(
      "OneSignal đã liên kết tài khoản thành công:",
      {
        externalId:
          getExternalId(OneSignal) ||
          uid,

        oneSignalId:
          getOneSignalId(OneSignal),

        subscriptionId:
          getSubscriptionId(OneSignal),

        departmentId:
          profile.departmentId,

        role:
          profile.role,

        module:
          MODULE_NAME
      }
    );

    emitSubscriptionChange();

    return true;
  }

  async function waitForExternalId(
    expectedUid,
    timeoutMs
  ) {
    const startedAt =
      Date.now();

    while (
      Date.now() - startedAt <
      timeoutMs
    ) {
      const externalId =
        normalizeText(
          getExternalId()
        );

      /*
       * Một số phiên bản SDK không cập nhật thuộc tính
       * externalId ngay lập tức dù login đã thành công.
       * Nếu đã có OneSignal ID thì có thể tiếp tục.
       */
      if (
        externalId === expectedUid ||
        getOneSignalId()
      ) {
        return true;
      }

      await sleep(
        POLLING_INTERVAL_MS
      );
    }

    /*
     * Không ném lỗi chỉ vì thuộc tính local chưa cập nhật.
     * OneSignal.login() đã resolve thì vẫn tiếp tục ghi tags.
     */
    console.warn(
      "OneSignal chưa phản ánh External ID trên SDK sau thời gian chờ.",
      {
        expectedUid,
        currentExternalId:
          getExternalId(),
        oneSignalId:
          getOneSignalId()
      }
    );

    return false;
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

      if (
        permission === "granted" &&
        optedIn &&
        subscriptionId
      ) {
        /*
         * Đã đăng ký thành công:
         * ẩn toàn bộ khung thông báo.
         */
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

      if (
        permission === "granted" &&
        optedIn &&
        !subscriptionId
      ) {
        /*
         * Đây là trạng thái đồng bộ,
         * không hiển thị lỗi đỏ.
         */
        showSynchronizingStatus();
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
   * YÊU CẦU BẬT THÔNG BÁO
   * ======================================================= */

  async function requestPermission() {
    showRegisteringStatus();

    try {
      const OneSignal =
        await ensureInitialized();

      if (
        !OneSignal.Notifications
          .isPushSupported()
      ) {
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
       * Chỉ yêu cầu quyền nếu chưa được cấp.
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
       * Người dùng đã cấp quyền nhưng có thể đang opt-out.
       */
      if (!isOptedIn(OneSignal)) {
        await OneSignal.User
          .PushSubscription
          .optIn();
      }

      showSynchronizingStatus();

      /*
       * Đợi tối đa 30 giây để OneSignal tạo Subscription ID.
       */
      const subscriptionId =
        await waitForSubscriptionId({
          timeoutMs:
            SUBSCRIPTION_WAIT_TIMEOUT_MS
        });

      if (!subscriptionId) {
        /*
         * Không kết luận là lỗi vĩnh viễn.
         * Cho phép người dùng thử đồng bộ lại.
         */
        setStatus({
          mode: "warning",
          title:
            "Thiết bị đang chờ đồng bộ",
          text:
            "Trình duyệt đã cấp quyền nhưng OneSignal chưa hoàn tất đồng bộ. Hãy tải lại trang hoặc bấm thử lại sau ít phút.",
          showBox: true,
          showAction: true,
          actionText:
            "Thử đồng bộ lại"
        });

        emitSubscriptionChange();

        return false;
      }

      /*
       * Khi đã có Subscription ID mới login và add tags.
       */
      if (
        state.requestedUid &&
        state.requestedProfile
      ) {
        await syncIdentityIfReady();
      }

      emitSubscriptionChange();

      /*
       * Đăng ký hoàn tất:
       * ẩn khung.
       */
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
   * ĐĂNG XUẤT
   * ======================================================= */

  async function logout() {
    try {
      const OneSignal =
        await ensureInitialized();

      /*
       * logout chỉ gỡ External ID khỏi OneSignal User.
       * Không gọi optOut để thiết bị vẫn có thể đăng nhập
       * bằng tài khoản khác và tái liên kết.
       */
      await OneSignal.logout();

    } catch (error) {
      console.warn(
        "Không thể đăng xuất OneSignal:",
        error
      );

    } finally {
      state.requestedUid =
        null;

      state.requestedProfile =
        null;

      state.identifiedUid =
        null;

      emitSubscriptionChange();

      hideStatusBox();
    }
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
   * API CÔNG KHAI
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

  document.addEventListener(
    "DOMContentLoaded",
    () => {
      bindButtons();

      ensureInitialized()
        .then(async () => {
          await refreshStatus();

          emitSubscriptionChange();
        })
        .catch((error) => {
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
        });
    }
  );
})();
