/** Production 3C - Firestore Read Only */
import { Router } from "./core/router.js";
import { AuthService } from "./core/auth-service.js";
import { Permissions } from "./core/permissions.js";
import { ToastService } from "./core/toast-service.js";

import { renderDashboardView } from "./modules/dashboard/dashboard-view.js";
import { renderTasksView } from "./modules/tasks/tasks-view.js";
import { renderStandardTasksView } from "./modules/standard-tasks/standard-tasks-view.js";
import { renderPeriodsView } from "./modules/periods/periods-view.js";
import { renderPlansView } from "./modules/plans/plans-view.js";
import { renderEvaluationsView } from "./modules/evaluations/evaluations-view.js";
import { renderReportsView } from "./modules/reports/reports-view.js";
import { renderAdminView } from "./modules/admin/admin-view.js";

async function bootstrap() {
  const outlet = document.getElementById("appOutlet");
  if (!outlet) throw new Error("Không tìm thấy vùng hiển thị appOutlet.");

  const user = await AuthService.initializeUserContext();
  if (!user) return;

  renderCurrentUser(user);
  applyRoleBasedNavigation();
  bindLogout();
  bindMobileNavigation();

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
  ToastService.success("Production 3C đã khởi động thành công ở chế độ chỉ đọc.", 2200);
}

function renderCurrentUser(user) {
  const userInfo = document.getElementById("currentUserInfo");
  if (!userInfo) return;
  userInfo.innerHTML = `<strong>${escapeHtml(user.fullName || "Người dùng")}</strong><span>${escapeHtml(user.position || formatRole(user.role))}${user.departmentId ? ` • ${escapeHtml(user.departmentId)}` : ""}</span>`;
  const avatar = document.getElementById("currentUserAvatar");
  if (avatar) avatar.textContent = getInitials(user.fullName || user.email);
}

function applyRoleBasedNavigation() {
  const adminMenu = document.getElementById("adminMenuItem");
  if (adminMenu) adminMenu.hidden = !Permissions.canAccessAdmin();
}

function bindLogout() {
  const button = document.getElementById("btnLogout");
  if (!button) return;
  button.addEventListener("click", async () => {
    button.disabled = true;
    try { await AuthService.logout(); }
    catch (error) {
      console.error("Logout error:", error);
      ToastService.error("Không thể đăng xuất. Vui lòng thử lại.");
      button.disabled = false;
    }
  });
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

function formatRole(role) {
  return ({ ADMIN: "Quản trị viên", DIRECTOR: "Ban Giám đốc", DEPARTMENT_LEADER: "Trưởng/Phó phòng, khu", TCHC_COORDINATOR: "Đầu mối TCHC", STAFF: "Viên chức, người lao động" })[String(role || "").toUpperCase()] || role || "Người dùng";
}
function getInitials(value) {
  return String(value || "ND").trim().split(/\s+/).slice(-2).map(item => item[0] || "").join("").toUpperCase();
}
function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

bootstrap().catch(error => {
  console.error("Production 3C bootstrap error:", error);
  const outlet = document.getElementById("appOutlet");
  if (outlet) outlet.innerHTML = `<section class="page-card error-card"><h2>Không thể khởi động Production 3C</h2><p>${escapeHtml(error?.message || "Lỗi không xác định.")}</p></section>`;
});
