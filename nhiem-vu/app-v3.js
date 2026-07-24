import { Router } from "./core/router.js";
import { initializeUserContext } from "./core/auth-service.js";
import { UserContext } from "./core/user-context.js";
import { Permissions } from "./core/permissions.js";

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
  const userInfo = document.getElementById("currentUserInfo");
  const adminMenu = document.getElementById("adminMenuItem");

  if (!outlet) {
    throw new Error("Không tìm thấy vùng hiển thị appOutlet.");
  }

  const user = await initializeUserContext();

  if (!user) {
    return;
  }

  if (userInfo) {
    userInfo.innerHTML = `
      <strong>${escapeHtml(user.fullName || "Người dùng")}</strong>
      <span>
        ${escapeHtml(user.position || "")}
        ${user.departmentId ? " • " + escapeHtml(user.departmentId) : ""}
      </span>
    `;
  }

  if (adminMenu) {
    adminMenu.hidden = !Permissions.isAdmin();
  }

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

  setupLogout();
}

function setupLogout() {
  const logoutButton = document.getElementById("btnLogout");

  if (!logoutButton) {
    return;
  }

  logoutButton.addEventListener("click", async () => {
    try {
      UserContext.clear();

      if (window.firebaseAuth) {
        await window.firebaseAuth.signOut();
      }

      window.location.href = "./login.html";
    } catch (error) {
      console.error(error);
      window.alert("Không thể đăng xuất. Vui lòng thử lại.");
    }
  });
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
  console.error("Production 3.0A bootstrap error:", error);

  const outlet = document.getElementById("appOutlet");

  if (outlet) {
    outlet.innerHTML = `
      <section class="page-card error-card">
        <h2>Không thể khởi động Production 3.0A</h2>
        <p>${escapeHtml(error.message || "Lỗi không xác định.")}</p>
      </section>
    `;
  }
});
