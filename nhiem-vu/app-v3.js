/** Ứng dụng quản lý nhiệm vụ và đánh giá KPI. */
import { Router } from "./core/router.js?v=20260914.V1_24_2";
import { APP_VERSION_LABEL, BUILD_VERSION } from "./core/app-version.js?v=20260914.V1_24_2";
import { AuthService } from "./core/auth-service.js?v=20260914.V1_24_2";
import { Permissions } from "./core/permissions.js?v=20260914.V1_24_2";
import { ToastService } from "./core/toast-service.js?v=20260914.V1_24_2";
import { FirebaseService } from "./core/firebase-service.js?v=20260914.V1_24_2";
import { UserContext } from "./core/user-context.js?v=20260914.V1_24_2";

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

const renderDashboardView = lazyRoute("./modules/dashboard/dashboard-view.js?v=20260914.V1_24_2", "renderDashboardView");
const renderExecutiveDirectivesView = lazyRoute("./modules/executive-directives/executive-directives-view.js?v=20260914.V1_24_2", "renderExecutiveDirectivesView");
const renderTasksView = lazyRoute("./modules/tasks/tasks-view.js?v=20260914.V1_24_2", "renderTasksView");
const renderStandardTasksView = lazyRoute("./modules/standard-tasks/standard-tasks-view.js?v=20260914.V1_24_2", "renderStandardTasksView");
const renderPeriodsView = lazyRoute("./modules/periods/periods-view.js?v=20260914.V1_24_2", "renderPeriodsView");
const renderPlansView = lazyRoute("./modules/plans/plans-view.js?v=20260914.V1_24_2", "renderPlansView");
const renderEvaluationsView = lazyRoute("./modules/evaluations/evaluations-view.js?v=20260914.V1_24_2", "renderEvaluationsView");
const renderReportsView = lazyRoute("./modules/reports/reports-view.js?v=20260914.V1_24_2", "renderReportsView");
const renderAdminView = lazyRoute("./modules/admin/admin-view.js?v=20260914.V1_24_2", "renderAdminView");

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
    const appScope = new URL("./", window.location.href).href;
    await Promise.all(registrations
      .filter(item => String(item.scope || "") === appScope)
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

/* V1.24.1 QUOTA SAFE: toàn bộ Push/Notification Center/Toast listener đã tắt. */

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
