/** Ứng dụng quản lý nhiệm vụ và đánh giá KPI. */
import { Router } from "./core/router.js";
import { AuthService } from "./core/auth-service.js";
import { Permissions } from "./core/permissions.js";
import { ToastService } from "./core/toast-service.js";

const BUILD_VERSION = "20260726.PRODUCTION10_HOTFIX_ASYNC";

function lazyRoute(modulePath, exportName) {
  return async (outlet, options = {}) => {
    try {
      const module = await import(`${modulePath}?v=${BUILD_VERSION}`);
      const renderer = module?.[exportName];
      if (typeof renderer !== "function") {
        throw new Error(`Không tìm thấy bộ hiển thị ${exportName}.`);
      }
      return await renderer(outlet, options);
    } catch (error) {
      console.error(`Không tải được phân hệ ${modulePath}:`, error);
      outlet.innerHTML = `
        <section class="page-card error-card">
          <h2>Không thể mở chức năng</h2>
          <p>${escapeHtml(error?.message || "Không tải được dữ liệu chức năng.")}</p><p class="helper-text">Mã phiên bản: ${BUILD_VERSION}</p>
          <div class="page-actions">
            <button type="button" class="primary-button" data-retry-route>↻ Thử lại</button>
            <a class="secondary-button" href="#/dashboard">Về Trang chủ</a>
          </div>
        </section>`;
      outlet.querySelector("[data-retry-route]")?.addEventListener("click", () => window.location.reload());
    }
  };
}

async function bootstrap() {
  const outlet = document.getElementById("appOutlet");
  if (!outlet) throw new Error("Không tìm thấy vùng hiển thị ứng dụng.");

  setLoadingStatus("Đang xác thực tài khoản…");
  const user = await AuthService.initializeUserContext();
  if (!user) return;

  renderCurrentUser(user);
  applyRoleBasedNavigation();
  bindLogout();
  bindMobileNavigation();

  const router = new Router({
    outlet,
    routes: {
      "#/dashboard": lazyRoute("./modules/dashboard/dashboard-view.js", "renderDashboardView"),
      "#/tasks": lazyRoute("./modules/tasks/tasks-view.js", "renderTasksView"),
      "#/standard-tasks": lazyRoute("./modules/standard-tasks/standard-tasks-view.js", "renderStandardTasksView"),
      "#/kpi": lazyRoute("./modules/plans/plans-view.js", "renderPlansView"),
      "#/kpi/periods": lazyRoute("./modules/periods/periods-view.js", "renderPeriodsView"),
      "#/kpi/evaluations": lazyRoute("./modules/evaluations/evaluations-view.js", "renderEvaluationsView"),
      "#/reports": lazyRoute("./modules/reports/reports-view.js", "renderReportsView"),
      "#/admin": lazyRoute("./modules/admin/admin-view.js", "renderAdminView")
    }
  });

  router.start();
  ToastService.success("Ứng dụng đã sẵn sàng.", 1600);
}

function setLoadingStatus(text) {
  const userInfo = document.getElementById("currentUserInfo");
  if (userInfo) userInfo.textContent = text || "";
}

function renderCurrentUser(user) {
  const userInfo = document.getElementById("currentUserInfo");
  if (userInfo) {
    userInfo.innerHTML = `<strong>${escapeHtml(user.fullName || "Người dùng")}</strong><span>${escapeHtml(user.position || formatRole(user.role))}${user.departmentId ? ` • ${escapeHtml(user.departmentId)}` : ""}</span>`;
  }
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
    try {
      await AuthService.logout();
    } catch (error) {
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
  return ({
    ADMIN: "Quản trị viên",
    DIRECTOR: "Ban Giám đốc",
    DEPARTMENT_LEADER: "Trưởng/Phó phòng, khu",
    TCHC_COORDINATOR: "Đầu mối TCHC",
    STAFF: "Viên chức, người lao động"
  })[String(role || "").toUpperCase()] || role || "Người dùng";
}

function getInitials(value) {
  return String(value || "ND").trim().split(/\s+/).slice(-2).map(item => item[0] || "").join("").toUpperCase();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

bootstrap().catch(error => {
  console.error("Khởi động ứng dụng không thành công:", error);
  const userInfo = document.getElementById("currentUserInfo");
  if (userInfo) userInfo.innerHTML = `<strong>Không tải được tài khoản</strong><span>Vui lòng thử lại</span>`;
  const outlet = document.getElementById("appOutlet");
  if (outlet) outlet.innerHTML = `
    <section class="page-card error-card auth-error-card">
      <h2>Không thể tải tài khoản</h2>
      <p>${escapeHtml(error?.message || "Lỗi không xác định.")}</p>
      <div class="page-actions">
        <button id="btnRetryBootstrap" type="button" class="primary-button">↻ Thử lại</button>
        <button id="btnForceLogout" type="button" class="secondary-button">Đăng xuất và đăng nhập lại</button>
      </div>
    </section>`;
  document.getElementById("btnRetryBootstrap")?.addEventListener("click", () => window.location.reload());
  document.getElementById("btnForceLogout")?.addEventListener("click", async () => {
    try { await AuthService.logout(); }
    catch (_) { window.location.replace("./login.html"); }
  });
});
