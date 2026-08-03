/** Ứng dụng quản lý nhiệm vụ và đánh giá KPI. */
import { Router } from "./core/router.js";
import { AuthService } from "./core/auth-service.js?v=20260803.V1_7_1";
import { Permissions } from "./core/permissions.js?v=20260803.V1_7_1";
import { ToastService } from "./core/toast-service.js";
import { FirebaseService } from "./core/firebase-service.js";

import { renderDashboardView } from "./modules/dashboard/dashboard-view.js?v=20260803.V1_7_1";
import { renderTasksView } from "./modules/tasks/tasks-view.js?v=20260803.V1_7_1";
import { renderStandardTasksView } from "./modules/standard-tasks/standard-tasks-view.js?v=20260803.V1_7_1";
import { renderPeriodsView } from "./modules/periods/periods-view.js?v=20260803.V1_7_1";
import { renderPlansView } from "./modules/plans/plans-view.js?v=20260803.V1_7_1";
import { renderEvaluationsView } from "./modules/evaluations/evaluations-view.js?v=20260803.V1_7_1";
import { renderReportsView } from "./modules/reports/reports-view.js?v=20260803.V1_7_1";
import { renderAdminView } from "./modules/admin/admin-view.js?v=20260803.V1_7_1";

async function bootstrap() {
  const outlet = document.getElementById("appOutlet");
  if (!outlet) throw new Error("Không tìm thấy vùng hiển thị appOutlet.");

  setLoadingStatus("Đang xác thực tài khoản…");
  const user = await AuthService.initializeUserContext();
  if (!user) return;

  renderCurrentUser(user);
  setLoadingStatus("");
  applyRoleBasedNavigation();
  bindLogout();
  bindMobileNavigation();
  initializePushNotifications(user);
  bindPushSubscriptionSync(user);

  const router = new Router({
    outlet,
    routes: {
      "#/dashboard": renderDashboardView,
      "#/tasks": renderTasksView,
      "#/standard-tasks": renderStandardTasksView,
      "#/kpi": renderPlansView,
      "#/kpi/periods": renderPeriodsView,
      "#/kpi/evaluations": renderEvaluationsView,
      "#/reports": renderReportsView,
      "#/admin": renderAdminView
    }
  });
  router.start();
  ToastService.success("Ứng dụng đã sẵn sàng.", 1800);
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
    buttons.forEach(button => { button.disabled = true; });
    try { await AuthService.logout(); }
    catch (error) {
      console.error("Logout error:", error);
      ToastService.error("Không thể đăng xuất. Vui lòng thử lại.");
      buttons.forEach(button => { button.disabled = false; });
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
  const save = async snapshot => {
    const subscriptionId = String(snapshot?.subscriptionId || "").trim();
    if (!subscriptionId) return;
    const ref = FirebaseService.doc(FirebaseService.db, "taskPushSubscriptions", subscriptionId);
    await FirebaseService.setDoc(ref, {
      subscriptionId,
      userId: user.uid,
      uid: user.uid,
      departmentId: user.departmentId || "",
      role: user.role || "",
      module: "TASKS",
      active: snapshot.optedIn === true && snapshot.permission === "granted",
      notificationPermission: snapshot.permission || "default",
      oneSignalId: snapshot.oneSignalId || "",
      externalId: user.uid,
      platform: "WEB_PUSH",
      updatedAt: FirebaseService.serverTimestamp()
    }, { merge: true });
  };
  window.addEventListener("taskpush:subscription-change", event => {
    save(event.detail).catch(error => console.warn("Chưa lưu được thiết bị nhận thông báo:", error));
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
  const userInfo = document.getElementById("currentUserInfo");
  if (userInfo) userInfo.innerHTML = `<strong>Không tải được tài khoản</strong><span>Vui lòng xem thông báo bên dưới</span>`;
  const outlet = document.getElementById("appOutlet");
  if (outlet) outlet.innerHTML = `
    <section class="page-card error-card auth-error-card">
      <h2>Không thể tải tài khoản</h2>
      <p>${escapeHtml(error?.message || "Lỗi không xác định.")}</p>
      <div class="page-actions">
        <button id="btnRetryBootstrap" type="button" class="primary-button">↻ Thử lại</button>
        <button id="btnForceLogout" type="button" class="secondary-button">Đăng xuất và đăng nhập lại</button>
      </div>
      <p class="helper-text">Nếu lỗi lặp lại, vui lòng liên hệ quản trị viên để kiểm tra tài khoản và quyền truy cập.</p>
    </section>`;
  document.getElementById("btnRetryBootstrap")?.addEventListener("click", () => window.location.reload());
  document.getElementById("btnForceLogout")?.addEventListener("click", async () => {
    try { await AuthService.logout(); } catch (_) { window.location.replace("./login.html"); }
  });
});
