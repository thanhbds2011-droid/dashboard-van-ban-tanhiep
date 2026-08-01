import { UserContext } from "../../core/user-context.js";
import { Permissions } from "../../core/permissions.js";
import { ToastService } from "../../core/toast-service.js";
import { DashboardReadService } from "../../services/dashboard-read-service.js?v=20260801.V1_3_1";
import { TaskReadService } from "../../services/task-read-service.js?v=20260801.V1_3_1";
let currentData = null;
let dashboardRenderSequence = 0;

export async function renderDashboardView(outlet) {
  const sequence = ++dashboardRenderSequence;
  const user = UserContext.requireUser();
  outlet.innerHTML = loadingCard("Đang tải dữ liệu trang chủ…");

  try {
    currentData = await DashboardReadService.load({ force: false });
    if (sequence !== dashboardRenderSequence || window.location.hash !== "#/dashboard") return;
    mountDashboard(outlet, user);
    updateDashboard(currentData);
  } catch (error) {
    outlet.innerHTML = errorCard("Không thể tải trang chủ", error);
  }
}

function mountDashboard(outlet, user) {
  outlet.innerHTML = `
    <section class="page-card">
      <div class="page-header"><div><h2>Tổng quan</h2><p>Theo dõi nhiệm vụ và kỳ đánh giá theo phạm vi tài khoản.</p></div><button id="btnDashboardRefresh" class="secondary-button" type="button">↻ Cập nhật</button></div>
      <section class="welcome-panel"><div><span class="welcome-label">Xin chào</span><h3>${escapeHtml(user.fullName || "Người dùng")}</h3><p>${escapeHtml(user.position || "Chưa cập nhật chức danh")} ${user.departmentId ? `• ${escapeHtml(user.departmentId)}` : ""}</p></div><span class="role-badge">${escapeHtml(formatRole(user.role))}</span></section>
      <div class="summary-grid">
        ${metric("Nhiệm vụ đang xử lý", 0, "Nhiệm vụ đang thực hiện", "blue", "dashboardInProgress")}
        ${metric("Sắp đến hạn", 0, "Trong 72 giờ tới", "amber", "dashboardDueSoon")}
        ${metric("Trễ hạn", 0, "Chưa hoàn thành và quá hạn", "red", "dashboardOverdue")}
        ${metric("Hoàn thành", 0, "Theo phạm vi được phép xem", "green", "dashboardCompleted")}
        ${metric("Kỳ KPI hiện tại", "—", "Chưa có kỳ hoạt động", "violet", "dashboardPeriod", "dashboardPeriodNote")}
      </div>
      <section class="dashboard-grid">
        <article class="dashboard-section"><div class="section-heading"><div><h3>Truy cập nhanh</h3><p>Truy cập nhanh các chức năng thường dùng.</p></div></div><div class="quick-grid">
          ${quick("#/tasks", "📋", "Nhiệm vụ", '<span id="dashboardTaskQuick">0 nhiệm vụ trong phạm vi</span>')}
          ${quick("#/standard-tasks", "📁", "Danh mục công việc", '<span id="dashboardStandardQuick">0 đầu việc đang hoạt động</span>')}
          ${quick("#/kpi", "📊", "Kế hoạch KPI", '<span id="dashboardKpiQuick">Chưa có kỳ hoạt động</span>')}
          ${quick("#/reports", "📄", "Báo cáo", "Xem và in báo cáo đánh giá")}
          ${Permissions.isAdmin() ? quick("#/admin", "⚙️", "Quản trị", "Quản lý tài khoản, kỳ đánh giá và nhật ký") : ""}
        </div></article>
        <article class="dashboard-section"><div class="section-heading"><div><h3>Tình trạng dữ liệu</h3><p>Thông tin tổng hợp từ các phân hệ của hệ thống.</p></div></div><dl class="system-status-list">
          ${status("Nhiệm vụ", '<span id="dashboardTaskStatus">0 nhiệm vụ</span>', "success")}
          ${status("Danh mục công việc", '<span id="dashboardStandardStatus">0 đầu việc</span>', "success")}
          ${status("Kỳ đánh giá", '<span id="dashboardPeriodStatus">0 kỳ</span>', "success")}
          ${status("Quyền cập nhật", "Theo tài khoản được phân công", "success")}
        </dl></article>
      </section>
      <div id="dashboardWarning"></div>
    </section>`;

  document.getElementById("btnDashboardRefresh")?.addEventListener("click", refreshDashboard);
}

async function refreshDashboard() {
  const button = document.getElementById("btnDashboardRefresh");
  if (button) button.disabled = true;
  try {
    currentData = await DashboardReadService.load({ force: true });
    updateDashboard(currentData);
  } catch (error) {
    ToastService.error("Không thể cập nhật trang chủ vào lúc này. Vui lòng kiểm tra kết nối và thử lại.");
  } finally {
    if (button) button.disabled = false;
  }
}

function updateDashboard(data) {
  const summary = data.taskSummary || TaskReadService.summarize(data.tasks || []);
  const period = data.activePeriod || null;
  setText("dashboardInProgress", summary.inProgress);
  setText("dashboardDueSoon", summary.dueSoon);
  setText("dashboardOverdue", summary.overdue);
  setText("dashboardCompleted", summary.completed);
  setText("dashboardPeriod", period ? period.name || period.code || period.id : "—");
  setText("dashboardPeriodNote", period ? formatPeriodStatus(period._status) : "Chưa có kỳ hoạt động");
  setText("dashboardTaskQuick", `${summary.total} nhiệm vụ trong phạm vi`);
  setText("dashboardStandardQuick", "Mở phân hệ để tải danh mục");
  setText("dashboardKpiQuick", period ? "Đã nhận diện kỳ hoạt động" : "Chưa có kỳ hoạt động");
  setText("dashboardTaskStatus", `${data.tasks?.length || 0} nhiệm vụ`);
  setText("dashboardStandardStatus", "Chỉ tải khi mở phân hệ");
  setText("dashboardPeriodStatus", `${data.periods?.length || 0} kỳ`);

  const warning = document.getElementById("dashboardWarning");
  if (warning) {
    warning.innerHTML = data.warnings?.length
      ? `<div class="warning-banner"><strong>Có dữ liệu chưa tải được:</strong><br>${data.warnings.map(escapeHtml).join("<br>")}</div>`
      : "";
  }
}

function setText(id, value) { const target = document.getElementById(id); if (target) target.textContent = String(value); }
function loadingCard(message){return `<section class="page-card"><div class="empty-state"><div class="empty-icon">⏳</div><strong>${escapeHtml(message)}</strong></div></section>`;}
function errorCard(title,error){return `<section class="page-card error-card"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(error?.message || "Lỗi không xác định")}</p></section>`;}
function metric(label,value,note,tone,id,noteId=""){return `<article class="summary-card tone-${tone}"><span>${label}</span><strong id="${id}">${value}</strong><small${noteId?` id="${noteId}"`:""}>${note}</small></article>`;}
function quick(href,icon,title,note){return `<a class="quick-action-card" href="${href}"><span class="quick-icon">${icon}</span><span><strong>${title}</strong><small>${note}</small></span><b>→</b></a>`;}
function status(label,value,type){return `<div><dt>${label}</dt><dd class="status-${type}">${value}</dd></div>`;}
function formatPeriodStatus(status){return ({DRAFT:"Dự thảo",OPEN:"Đang mở",IN_PROGRESS:"Đang thực hiện",ASSESSMENT:"Đang đánh giá",REPORTING:"Đang báo cáo",COMPLETED:"Hoàn tất"})[status] || status || "Chưa xác định";}
function formatRole(role){return ({ADMIN:"Quản trị viên",DIRECTOR:"Ban Giám đốc",DEPARTMENT_LEADER:"Trưởng/Phó phòng, khu",TCHC_COORDINATOR:"Đầu mối TCHC",STAFF:"Viên chức, người lao động"})[String(role||"").toUpperCase()] || role || "Người dùng";}
function escapeHtml(value){return String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");}
