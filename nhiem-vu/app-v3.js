/** Ứng dụng quản lý nhiệm vụ và đánh giá KPI. */
import { Router } from "./core/router.js?v=20260825.V1_17_0";
import { APP_VERSION_LABEL, BUILD_VERSION } from "./core/app-version.js?v=20260825.V1_17_0";
import { AuthService } from "./core/auth-service.js?v=20260825.V1_17_0";
import { Permissions } from "./core/permissions.js?v=20260825.V1_17_0";
import { ToastService } from "./core/toast-service.js?v=20260825.V1_17_0";
import { FirebaseService } from "./core/firebase-service.js?v=20260825.V1_17_0";
import { UserContext } from "./core/user-context.js?v=20260825.V1_17_0";
import { PeriodReadService } from "./services/period-read-service.js?v=20260825.V1_17_0";
import { ExecutivePushSubscriptionService } from "./services/executive-push-subscription-service.js?v=20260825.V1_17_0";
import { ExecutiveInAppAlertService } from "./services/executive-in-app-alert-service.js?v=20260825.V1_17_0";

let currentPushUser = null;
let saveCurrentPushSnapshot = null;
let stopInAppTaskAlerts = null;
let activeRouter = null;
let sessionRecoveryInProgress = false;
let appLifecycleState = "BOOTSTRAP";

const SESSION_RECOVERY_KEY = `nhiem-vu:session-recovery:${BUILD_VERSION}`;
const routeModuleCache = new Map();

function lazyRoute(modulePath, exportName) {
  return async (outlet, context) => {
    let loader = routeModuleCache.get(modulePath);
    if (!loader) {
      loader = import(modulePath).catch(error => {
        routeModuleCache.delete(modulePath);
        throw error;
      });
      routeModuleCache.set(modulePath, loader);
    }
    const module = await loader;
    const handler = module?.[exportName];
    if (typeof handler !== "function") throw new Error(`Không tìm thấy màn hình ${exportName}.`);
    return handler(outlet, context);
  };
}

const renderDashboardView = lazyRoute("./modules/dashboard/dashboard-view.js?v=20260825.V1_17_0", "renderDashboardView");
const renderExecutiveDirectivesView = lazyRoute("./modules/executive-directives/executive-directives-view.js?v=20260825.V1_17_0", "renderExecutiveDirectivesView");
const renderTasksView = lazyRoute("./modules/tasks/tasks-view.js?v=20260825.V1_17_0", "renderTasksView");
const renderStandardTasksView = lazyRoute("./modules/standard-tasks/standard-tasks-view.js?v=20260825.V1_17_0", "renderStandardTasksView");
const renderPeriodsView = lazyRoute("./modules/periods/periods-view.js?v=20260825.V1_17_0", "renderPeriodsView");
const renderPlansView = lazyRoute("./modules/plans/plans-view.js?v=20260825.V1_17_0", "renderPlansView");
const renderEvaluationsView = lazyRoute("./modules/evaluations/evaluations-view.js?v=20260825.V1_17_0", "renderEvaluationsView");
const renderReportsView = lazyRoute("./modules/reports/reports-view.js?v=20260825.V1_17_0", "renderReportsView");
const renderAdminView = lazyRoute("./modules/admin/admin-view.js?v=20260825.V1_17_0", "renderAdminView");

async function purgeRuntimeCaches() {
  if (!("caches" in window)) return;
  try {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith("nhiem-vu-")).map(key => caches.delete(key)));
  } catch (error) {
    console.warn("Không xóa được cache phiên cũ:", error);
  }
}

async function refreshServiceWorkerRegistration() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations
      .filter(item => String(item.scope || "").includes("/nhiem-vu/"))
      .map(item => item.update().catch(() => null)));
  } catch (error) {
    console.warn("Không kiểm tra được Service Worker khi phục hồi phiên:", error);
  }
}

function sessionRecoveryRecord() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_RECOVERY_KEY) || "null") || null;
  } catch (_) {
    return null;
  }
}

function saveSessionRecoveryRecord(reason) {
  try {
    sessionStorage.setItem(SESSION_RECOVERY_KEY, JSON.stringify({ at: Date.now(), reason }));
  } catch (_) { /* sessionStorage có thể bị chặn */ }
}

function clearSessionRecoveryRecord() {
  try { sessionStorage.removeItem(SESSION_RECOVERY_KEY); } catch (_) { /* no-op */ }
}

async function recoverSession(reason = "SESSION_MISMATCH") {
  if (sessionRecoveryInProgress || appLifecycleState === "LOGGING_OUT") return;
  sessionRecoveryInProgress = true;
  appLifecycleState = "RECOVERING";
  activeRouter?.stop();
  UserContext.beginTransition("RECOVERY");

  const previous = sessionRecoveryRecord();
  const repeated = previous?.at && Date.now() - Number(previous.at) < 20000;
  saveSessionRecoveryRecord(reason);

  try {
    try { stopInAppTaskAlerts?.(); } catch (_) { /* listener đã đóng */ }
    stopInAppTaskAlerts = null;
    ExecutiveInAppAlertService.stop();
    await ExecutivePushSubscriptionService.stop({ deactivate: false }).catch(() => null);

    if (repeated) {
      // Nếu tự reload một lần vẫn không đồng bộ được, kết thúc phiên sạch để tránh vòng lặp vô hạn.
      await AuthService.logout();
      return;
    }

    await Promise.all([purgeRuntimeCaches(), refreshServiceWorkerRegistration()]);
    window.location.reload();
  } catch (error) {
    console.error("Không phục hồi được phiên đăng nhập:", error);
    try { await AuthService.logout(); } catch (_) { window.location.replace("./login.html"); }
  }
}

async function verifySessionConsistency(reason = "VERIFY") {
  if (sessionRecoveryInProgress || appLifecycleState !== "READY" || UserContext.isTransitioning()) return true;
  const contextUid = String(UserContext.getUser()?.uid || "").trim();
  const authUid = String(FirebaseService.auth.currentUser?.uid || "").trim();
  if (authUid && contextUid && authUid === contextUid) return true;
  console.warn("Phát hiện phiên không đồng nhất:", { reason, authUid, contextUid, build: BUILD_VERSION });
  await recoverSession(reason);
  return false;
}

function bindSessionConsistencyGuard() {
  window.addEventListener("app:session-recovery-needed", event => {
    void recoverSession(event.detail?.reason || "SESSION_RECOVERY_EVENT");
  });
  window.addEventListener("app:auth-transition-start", () => {
    appLifecycleState = "LOGGING_OUT";
    activeRouter?.stop();
  });
  window.addEventListener("app:bfcache-restored", () => {
    void verifySessionConsistency("BFCACHE_RESTORED");
  });
  window.addEventListener("pageshow", event => {
    if (event.persisted) void verifySessionConsistency("PAGESHOW_BFCACHE");
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void verifySessionConsistency("TAB_VISIBLE");
  });
}

async function verifyBuildConsistency() {
  const htmlBuild = String(window.__APP_HTML_BUILD__ || document.querySelector('meta[name="app-build"]')?.content || "").trim();
  if (!htmlBuild || htmlBuild === BUILD_VERSION) return true;
  console.warn("Phát hiện mixed release:", { htmlBuild, moduleBuild: BUILD_VERSION });
  await purgeRuntimeCaches();
  await refreshServiceWorkerRegistration();
  window.location.reload();
  return false;
}

bindSessionConsistencyGuard();

async function bootstrap() {
  if (!await verifyBuildConsistency()) return;
  const outlet = document.getElementById("appOutlet");
  if (!outlet) throw new Error("Không tìm thấy vùng hiển thị appOutlet.");

  setLoadingStatus("Đang xác thực tài khoản…");
  const user = await AuthService.initializeUserContext({
    onProgress: ({ message }) => setLoadingStatus(message || "Đang tải tài khoản…")
  });
  if (!user) return;

  renderCurrentUser(user);
  document.documentElement.dataset.buildVersion = BUILD_VERSION;
  const versionNode = document.getElementById("appVersionLabel");
  if (versionNode) versionNode.textContent = APP_VERSION_LABEL;
  setLoadingStatus("");
  applyRoleBasedNavigation();
  bindLogout();
  bindMobileNavigation();
  bindRouteBranding();
  initializePushNotifications(user);
  bindPushSubscriptionSync(user);
  bindPushSettings(user);
  void bindInAppTaskAssignmentAlerts(user);
  ExecutivePushSubscriptionService.start(user)
    .catch(error => console.warn("Chưa đồng bộ được Push Chỉ đạo điều hành:", error));
  ExecutiveInAppAlertService.start(user);

  const router = new Router({
    outlet,
    routes: {
      "#/dashboard": renderDashboardView,
      "#/directives": renderExecutiveDirectivesView,
      "#/tasks": renderTasksView,
      "#/standard-tasks": renderStandardTasksView,
      "#/kpi": renderPlansView,
      "#/kpi/periods": renderPeriodsView,
      "#/kpi/evaluations": renderEvaluationsView,
      "#/reports": renderReportsView,
      "#/admin": renderAdminView
    }
  });
  activeRouter = router;
  router.start();
  appLifecycleState = "READY";
  clearSessionRecoveryRecord();
  ToastService.success("Ứng dụng đã sẵn sàng.", 1800);
}

function applyRouteBrand(route = window.location.hash || "#/dashboard") {
  const executive = route === "#/directives";
  const title = document.getElementById("appBrandTitle");
  const subtitle = document.getElementById("appBrandSubtitle");
  if (title) title.textContent = executive ? "Chỉ đạo điều hành" : "Nhiệm vụ và đánh giá KPI";
  if (subtitle) subtitle.textContent = "Trung tâm Bảo trợ xã hội Tân Hiệp";
  document.body.classList.toggle("is-executive-route", executive);
  document.title = executive ? "Chỉ đạo điều hành - Tân Hiệp" : "Nhiệm vụ và đánh giá KPI";
}

function bindRouteBranding() {
  applyRouteBrand();
  document.addEventListener("v3:route-changed", event => applyRouteBrand(event.detail?.route));
}

function setLoadingStatus(text) {
  const userInfo = document.getElementById("currentUserInfo");
  if (userInfo && text) userInfo.textContent = text;
}

function renderCurrentUser(user) {
  const userInfo = document.getElementById("currentUserInfo");
  if (!userInfo) return;
  userInfo.innerHTML = `<strong>${escapeHtml(user.fullName || "Người dùng")}</strong><span>${escapeHtml(currentUserSubtitle(user))}</span>`;
  const avatar = document.getElementById("currentUserAvatar");
  if (avatar) avatar.textContent = getInitials(user.fullName || user.email);
}

function applyRoleBasedNavigation() {
  const adminMenu = document.getElementById("adminMenuItem");
  if (adminMenu) adminMenu.hidden = !Permissions.canAccessAdmin();
}

function bindLogout() {
  const buttons = [
    document.getElementById("btnLogout"),
    document.getElementById("btnMobileLogout")
  ].filter(Boolean);
  if (!buttons.length) return;

  const logout = async () => {
    if (appLifecycleState === "LOGGING_OUT") return;
    appLifecycleState = "LOGGING_OUT";
    activeRouter?.stop();
    UserContext.beginTransition("LOGOUT");
    buttons.forEach(button => { button.disabled = true; });
    try {
      /* Tắt đúng bản ghi thiết bị của tài khoản hiện tại trước khi Firebase logout. */
      const snapshot = await window.TaskPush?.getSubscriptionSnapshot?.().catch(() => null);
      if (snapshot?.subscriptionId && currentPushUser?.uid) {
        const ref = FirebaseService.doc(
          FirebaseService.db,
          "taskPushSubscriptions",
          `${currentPushUser.uid}_${snapshot.subscriptionId}`
        );
        await FirebaseService.setDoc(ref, {
          active: false,
          notificationPermission: snapshot.permission || "default",
          updatedAt: FirebaseService.serverTimestamp()
        }, { merge: true });
      }
      try { stopInAppTaskAlerts?.(); } catch (_) { /* listener đã dừng */ }
      stopInAppTaskAlerts = null;
      await ExecutivePushSubscriptionService.stop({ deactivate: true });
      ExecutiveInAppAlertService.stop();
      await window.TaskPush?.logout?.();
      await AuthService.logout();
    } catch (error) {
      console.error("Logout error:", error);
      ToastService.error("Không thể đăng xuất. Ứng dụng sẽ tải lại phiên hiện tại.");
      appLifecycleState = "RECOVERING";
      window.location.reload();
    }
  };

  buttons.forEach(button => button.addEventListener("click", logout));
}

function bindMobileNavigation() {
  const toggle = document.getElementById("btnMobileMenu");
  const nav = document.getElementById("v3Navigation");
  const overlay = document.getElementById("navOverlay");
  if (!toggle || !nav || !overlay) return;

  const close = () => {
    nav.classList.remove("open");
    overlay.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
  };
  const open = () => {
    nav.classList.add("open");
    overlay.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
  };
  toggle.addEventListener("click", () => nav.classList.contains("open") ? close() : open());
  overlay.addEventListener("click", close);
  nav.addEventListener("click", event => { if (event.target.closest("a")) close(); });
  document.addEventListener("v3:route-changed", close);
}

function bindPushSubscriptionSync(user) {
  currentPushUser = user;
  const save = async (snapshot, options = {}) => {
    const subscriptionId = String(snapshot?.subscriptionId || "").trim();
    if (!subscriptionId) return;
    const active = snapshot.optedIn === true && snapshot.permission === "granted";
    const fingerprint = [
      user.uid, subscriptionId, user.departmentId || "", user.role || "",
      active ? "1" : "0", snapshot.permission || "default", snapshot.oneSignalId || ""
    ].join("|");
    const storageKey = `taskPushSync:${user.uid}:${subscriptionId}`;
    if (options.force !== true) {
      try {
        const cached = JSON.parse(localStorage.getItem(storageKey) || "null");
        if (cached?.fingerprint === fingerprint && Date.now() - Number(cached.at || 0) < 12 * 60 * 60 * 1000) return;
      } catch (_) { /* localStorage không khả dụng thì đồng bộ bình thường */ }
    }
    const subscriptionDocumentId = `${user.uid}_${subscriptionId}`;
    const ref = FirebaseService.doc(FirebaseService.db, "taskPushSubscriptions", subscriptionDocumentId);
    await FirebaseService.setDoc(ref, {
      subscriptionId,
      userId: user.uid,
      uid: user.uid,
      departmentId: user.departmentId || "",
      role: user.role || "",
      module: "TASKS",
      active,
      notificationPermission: snapshot.permission || "default",
      oneSignalId: snapshot.oneSignalId || "",
      externalId: user.uid,
      platform: "WEB_PUSH",
      updatedAt: FirebaseService.serverTimestamp()
    }, { merge: true });
    try { localStorage.setItem(storageKey, JSON.stringify({ fingerprint, at: Date.now() })); } catch (_) { /* no-op */ }
  };
  saveCurrentPushSnapshot = snapshot => save(snapshot, { force: true });
  window.addEventListener("taskpush:subscription-change", event => {
    save(event.detail, { force: true }).catch(error => console.warn("Chưa lưu được thiết bị nhận thông báo:", error));
  });
  window.setTimeout(async () => {
    try {
      const snapshot = await window.TaskPush?.getSubscriptionSnapshot?.();
      await save(snapshot);
    } catch (error) {
      console.warn("Chưa đồng bộ được thiết bị nhận thông báo:", error);
    }
  }, 1500);
}

function bindPushSettings(user) {
  const openButtons = [
    document.getElementById("btnPushSettings"),
    document.getElementById("btnMobilePushSettings")
  ].filter(Boolean);
  const modal = document.getElementById("pushSettingsModal");
  if (!openButtons.length || !modal) return;

  const closeButtons = [
    document.getElementById("btnClosePushSettings"),
    document.getElementById("btnPushSettingsDone")
  ].filter(Boolean);
  const stateBox = document.getElementById("pushSettingsState");
  const syncButton = document.getElementById("btnPushResync");
  const permissionButton = document.getElementById("btnPushRequestPermission");

  const text = (id, value) => {
    const target = document.getElementById(id);
    if (target) target.textContent = String(value ?? "—");
  };

  const permissionLabel = value => ({
    granted: "Đã cho phép",
    denied: "Đang bị chặn",
    default: "Chưa lựa chọn"
  })[String(value || "default")] || String(value || "Không xác định");

  const refresh = async ({ resync = false } = {}) => {
    if (stateBox) {
      stateBox.className = "push-settings-state is-loading";
      stateBox.textContent = resync ? "Đang đồng bộ lại thiết bị…" : "Đang kiểm tra trạng thái…";
    }
    if (syncButton) syncButton.disabled = true;
    try {
      if (resync) await window.TaskPush?.identify?.(user.uid, user);
      const snapshot = await window.TaskPush?.getSubscriptionSnapshot?.();
      if (resync && saveCurrentPushSnapshot) await saveCurrentPushSnapshot(snapshot);
      if (resync) await ExecutivePushSubscriptionService.syncNow().catch(() => false);

      let firestoreState = "Chưa có mã thiết bị";
      let executiveState = "Chưa có mã thiết bị";
      if (snapshot?.subscriptionId) {
        const ref = FirebaseService.doc(
          FirebaseService.db,
          "taskPushSubscriptions",
          `${user.uid}_${snapshot.subscriptionId}`
        );
        const stored = await FirebaseService.getDoc(ref).catch(error => {
          console.warn("Không đọc được trạng thái liên kết thiết bị:", error);
          return null;
        });
        firestoreState = stored?.exists?.()
          ? (stored.data()?.active === true ? "Đã đồng bộ · đang hoạt động" : "Đã đồng bộ · đang tắt")
          : "Chưa liên kết với tài khoản";

        const executiveRef = FirebaseService.doc(
          FirebaseService.db,
          "executivePushSubscriptions",
          `${user.uid}_${snapshot.subscriptionId}`
        );
        const executiveStored = await FirebaseService.getDoc(executiveRef).catch(error => {
          console.warn("Không đọc được trạng thái Push Chỉ đạo điều hành:", error);
          return null;
        });
        executiveState = executiveStored?.exists?.()
          ? (executiveStored.data()?.active === true ? "Đã đồng bộ · đang hoạt động" : "Đã đồng bộ · đang tắt")
          : "Chưa liên kết";
      }

      text("pushSettingPermission", permissionLabel(snapshot?.permission));
      text("pushSettingOptedIn", snapshot?.optedIn === true ? "Đã đăng ký" : "Chưa đăng ký");
      text("pushSettingSubscription", snapshot?.subscriptionId || "Chưa có");
      text("pushSettingUid", user.fullName || user.email || "Tài khoản hiện tại");
      text("pushSettingFirestore", firestoreState);
      text("pushSettingExecutive", executiveState);
      text("pushSettingUpdatedAt", new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "medium" }).format(new Date()));

      const ready = snapshot?.permission === "granted" && snapshot?.optedIn === true && Boolean(snapshot?.subscriptionId);
      if (stateBox) {
        stateBox.className = `push-settings-state ${ready ? "is-ready" : "is-warning"}`;
        stateBox.textContent = ready
          ? "Thiết bị đã sẵn sàng nhận thông báo."
          : "Thiết bị chưa hoàn tất đăng ký thông báo; hãy mở quyền hoặc đồng bộ lại.";
      }
    } catch (error) {
      console.error("Không kiểm tra được cài đặt thông báo:", error);
      if (stateBox) {
        stateBox.className = "push-settings-state is-error";
        stateBox.textContent = error?.message || "Không kiểm tra được trạng thái thông báo.";
      }
    } finally {
      if (syncButton) syncButton.disabled = false;
    }
  };

  const open = () => {
    modal.classList.remove("hidden");
    document.body.classList.add("modal-open");
    void refresh();
  };
  const close = () => {
    modal.classList.add("hidden");
    document.body.classList.remove("modal-open");
  };

  openButtons.forEach(button => {
    if (button.dataset.pushSettingsBound === "V1.10.2") return;
    button.dataset.pushSettingsBound = "V1.10.2";
    button.addEventListener("click", () => {
      open();
      if (button.id === "btnMobilePushSettings") {
        document.getElementById("v3Navigation")?.classList.remove("open");
        const overlay = document.getElementById("navOverlay");
        if (overlay) overlay.hidden = true;
        document.getElementById("btnMobileMenu")?.setAttribute("aria-expanded", "false");
      }
    });
  });
  closeButtons.forEach(button => button.addEventListener("click", close));
  modal.addEventListener("click", event => { if (event.target === modal) close(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && !modal.classList.contains("hidden")) close(); });
  syncButton?.addEventListener("click", () => refresh({ resync: true }));
  permissionButton?.addEventListener("click", async () => {
    permissionButton.disabled = true;
    try {
      await ExecutivePushSubscriptionService.requestPermission().catch(() => false);
      await window.TaskPush?.requestPermission?.();
      await refresh({ resync: true });
    } finally {
      permissionButton.disabled = false;
    }
  });
}

async function bindInAppTaskAssignmentAlerts(user) {
  try { stopInAppTaskAlerts?.(); } catch (_) { /* listener cũ đã dừng */ }
  stopInAppTaskAlerts = null;
  if (!user?.uid) return;

  try {
    /*
     * V1.14.0 FREE-TIER:
     * - Chỉ nghe nhiệm vụ của kỳ đang hoạt động, không quét lịch sử của người dùng.
     * - Jitter thời điểm mở listener để 140 máy không cùng tạo một đợt kết nối Firestore.
     * - Push vẫn là kênh thông báo chính khi tab không mở; listener này chỉ phục vụ toast trong app.
     */
    const period = await PeriodReadService.getActive({ force: false });
    if (!period?.id || FirebaseService.auth.currentUser?.uid !== user.uid) return;

    const jitterMs = 2500 + Math.floor(Math.random() * 7500);
    await new Promise(resolve => window.setTimeout(resolve, jitterMs));
    if (FirebaseService.auth.currentUser?.uid !== user.uid) return;

    const reference = FirebaseService.query(
      FirebaseService.collection(FirebaseService.db, "tasks"),
      FirebaseService.where("periodId", "==", period.id),
      FirebaseService.where("ownerUserId", "==", user.uid),
      FirebaseService.limit(300)
    );
    const knownTaskIds = new Set();
    let initialized = false;

    stopInAppTaskAlerts = FirebaseService.onSnapshot(reference, snapshot => {
      if (!initialized) {
        snapshot.docs.forEach(doc => knownTaskIds.add(doc.id));
        initialized = true;
        return;
      }

      snapshot.docChanges().forEach(change => {
        if (change.type !== "added") return;
        const task = { id: change.doc.id, ...change.doc.data() };
        if (knownTaskIds.has(task.id)) return;
        knownTaskIds.add(task.id);
        if (task.active === false) return;
        if (String(task.assignmentStatus || "").toUpperCase() === "DA_TIEP_NHAN") return;
        const code = String(task.taskCode || "").trim();
        const title = String(task.title || "Nhiệm vụ mới").trim();
        ToastService.success(
          `Bạn vừa được giao ${code ? `${code} – ` : ""}${title}.`,
          6500
        );
      });
    }, error => {
      console.warn("Không theo dõi được nhiệm vụ mới của tài khoản hiện tại:", error);
    });
  } catch (error) {
    console.warn("Chưa khởi tạo được thông báo nhiệm vụ trong ứng dụng:", error);
  }
}

function initializePushNotifications(user) {
  window.setTimeout(async () => {
    try {
      if (window.TaskPush?.identify) {
        await window.TaskPush.identify(user.uid, user);
      }
    } catch (error) {
      console.warn("Chưa đồng bộ được thông báo đẩy:", error);
    }
  }, 0);
}

function currentUserSubtitle(user) {
  const departments = {
    BGD: "Ban Giám đốc", TCHC: "Phòng Tổ chức – Hành chính", CTXH: "Phòng Công tác xã hội",
    KHTC: "Phòng Kế hoạch – Tài chính", YT: "Phòng Y tế", KI: "Khu I", KII: "Khu II", KIII: "Khu III"
  };
  const additional = {
    CDTN_BI_THU: "Bí thư Chi đoàn", CDTN_PHO_BI_THU: "Phó Bí thư Chi đoàn",
    CDTN_UY_VIEN_BCH: "Ủy viên BCH Chi đoàn", CDTN_DOAN_VIEN: "Đoàn viên Chi đoàn"
  };
  const base = `${user.position || formatRole(user.role)} ${departments[user.departmentId] || user.departmentId || ""}`.trim();
  const labels = (user.additionalRoles || []).map(role => additional[String(role || "").toUpperCase()]).filter(Boolean);
  return labels.length ? `${base}, ${labels.join(", ")}` : base;
}

function formatRole(role) {
  return ({ ADMIN: "Quản trị viên", DIRECTOR: "Ban Giám đốc", DEPARTMENT_LEADER: "Trưởng/Phó phòng, khu", TCHC_COORDINATOR: "Đầu mối TCHC", STAFF: "Viên chức" })[String(role || "").toUpperCase()] || role || "Người dùng";
}
function getInitials(value) {
  return String(value || "ND").trim().split(/\s+/).slice(-2).map(item => item[0] || "").join("").toUpperCase();
}
function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

bootstrap().catch(error => {
  console.error("Lỗi khởi động ứng dụng:", error);
  const diagnostic = AuthService.getLastDiagnostic?.() || {};
  const errorCode = String(error?.code || diagnostic.errorCode || "AUTH_BOOTSTRAP_FAILED");
  const userInfo = document.getElementById("currentUserInfo");
  if (userInfo) userInfo.innerHTML = `<strong>Không tải được tài khoản</strong><span>${escapeHtml(errorCode)}</span>`;
  const outlet = document.getElementById("appOutlet");
  if (outlet) outlet.innerHTML = `
    <section class="page-card error-card auth-error-card">
      <h2>Không thể tải tài khoản</h2>
      <p>${escapeHtml(error?.message || "Lỗi không xác định.")}</p>
      <div class="auth-diagnostic-box">
        <strong>Mã chẩn đoán: ${escapeHtml(errorCode)}</strong>
        <span>Bước cuối: ${escapeHtml(diagnostic.lastStage || "không xác định")}</span>
        ${diagnostic.email ? `<span>Email: ${escapeHtml(diagnostic.email)}</span>` : ""}
      </div>
      <div class="page-actions">
        <button id="btnRetryBootstrap" type="button" class="primary-button">↻ Thử lại</button>
        <button id="btnForceLogout" type="button" class="secondary-button">Đăng xuất và đăng nhập lại</button>
      </div>
      <p class="helper-text">Nếu lỗi lặp lại, gửi ảnh màn hình có mã chẩn đoán cho quản trị viên. Không cần chờ ở màn hình tải vô thời hạn.</p>
    </section>`;
  document.getElementById("btnRetryBootstrap")?.addEventListener("click", () => window.location.reload());
  document.getElementById("btnForceLogout")?.addEventListener("click", async () => {
    try { await AuthService.logout(); } catch (_) { window.location.replace("./login.html"); }
  });
});
