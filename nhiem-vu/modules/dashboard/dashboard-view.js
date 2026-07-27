import { UserContext } from "../../core/user-context.js";
import { Permissions } from "../../core/permissions.js";
import { ToastService } from "../../core/toast-service.js";
import { DashboardReadService } from "../../services/dashboard-read-service.js";

export async function renderDashboardView(outlet) {
  const user = UserContext.requireUser();
  outlet.innerHTML = loadingCard("Đang tải dữ liệu trang chủ…");

  try {
    const data = await DashboardReadService.load();
    const summary = data.taskSummary;
    const period = data.activePeriod;

    outlet.innerHTML = `
      <section class="page-card">
        <div class="page-header"><div><h2>Tổng quan</h2><p>Theo dõi nhiệm vụ và kỳ đánh giá theo phạm vi tài khoản.</p></div><button id="btnDashboardRefresh" class="secondary-button" type="button">↻ Cập nhật</button></div>
        <section class="welcome-panel"><div><span class="welcome-label">Xin chào</span><h3>${escapeHtml(user.fullName || "Người dùng")}</h3><p>${escapeHtml(user.position || "Chưa cập nhật chức danh")} ${user.departmentId ? `• ${escapeHtml(user.departmentId)}` : ""}</p></div><span class="role-badge">${escapeHtml(formatRole(user.role))}</span></section>
        <div class="summary-grid">
          ${metric("Nhiệm vụ đang xử lý", summary.inProgress, "Nhiệm vụ đang thực hiện", "blue")}
          ${metric("Sắp đến hạn", summary.dueSoon, "Trong 72 giờ tới", "amber")}
          ${metric("Trễ hạn", summary.overdue, "Chưa hoàn thành và quá hạn", "red")}
          ${metric("Hoàn thành", summary.completed, "Theo phạm vi được phép xem", "green")}
          ${metric("Kỳ KPI hiện tại", period ? escapeHtml(period.name || period.code || period.id) : "—", period ? formatPeriodStatus(period._status) : "Chưa có kỳ hoạt động", "violet")}
        </div>
        <section class="dashboard-grid">
          <article class="dashboard-section"><div class="section-heading"><div><h3>Truy cập nhanh</h3><p>Truy cập nhanh các chức năng thường dùng.</p></div></div><div class="quick-grid">
            ${quick("#/tasks", "📋", "Nhiệm vụ", `${summary.total} nhiệm vụ trong phạm vi`)}
            ${quick("#/standard-tasks", "📁", "Danh mục công việc", `${data.standardTaskSummary.total} đầu việc đang hoạt động`)}
            ${quick("#/kpi", "📊", "Kế hoạch KPI", period ? "Đã nhận diện kỳ hoạt động" : "Chưa có kỳ hoạt động")}
            ${quick("#/reports", "📄", "Báo cáo", "Xem và in báo cáo đánh giá")}
            ${Permissions.isAdmin() ? quick("#/admin", "⚙️", "Quản trị", "Quản lý tài khoản, kỳ đánh giá và nhật ký") : ""}
          </div></article>
          <article class="dashboard-section"><div class="section-heading"><div><h3>Tình trạng dữ liệu</h3><p>Thông tin tổng hợp từ các phân hệ của hệ thống.</p></div></div><dl class="system-status-list">
            ${status("Nhiệm vụ", `${data.tasks.length} nhiệm vụ`, "success")}
            ${status("Danh mục công việc", `${data.standardTasks.length} đầu việc`, "success")}
            ${status("Kỳ đánh giá", `${data.periods.length} kỳ`, "success")}
            ${status("Quyền cập nhật", "Theo tài khoản được phân công", "success")}
          </dl></article>
        </section>
        ${data.warnings.length ? `<div class="warning-banner"><strong>Cảnh báo đọc dữ liệu:</strong><br>${data.warnings.map(escapeHtml).join("<br>")}</div>` : `<div class="success-banner">Dữ liệu đã được tải thành công theo quyền của tài khoản.</div>`}
      </section>`;

    document.getElementById("btnDashboardRefresh")?.addEventListener("click", () => {
      ToastService.info("Đang tải lại trang chủ…");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
  } catch (error) {
    outlet.innerHTML = errorCard("Không thể tải trang chủ", error);
  }
}

function loadingCard(message){return `<section class="page-card"><div class="empty-state"><div class="empty-icon">⏳</div><strong>${escapeHtml(message)}</strong></div></section>`;}
function errorCard(title,error){return `<section class="page-card error-card"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(error?.message || "Lỗi không xác định")}</p></section>`;}
function metric(label,value,note,tone){return `<article class="summary-card tone-${tone}"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`;}
function quick(href,icon,title,note){return `<a class="quick-action-card" href="${href}"><span class="quick-icon">${icon}</span><span><strong>${title}</strong><small>${note}</small></span><b>→</b></a>`;}
function status(label,value,type){return `<div><dt>${label}</dt><dd class="status-${type}">${escapeHtml(value)}</dd></div>`;}
function formatPeriodStatus(status){return ({DRAFT:"Dự thảo",OPEN:"Đang mở",IN_PROGRESS:"Đang thực hiện",ASSESSMENT:"Đang đánh giá",REPORTING:"Đang báo cáo",COMPLETED:"Hoàn tất"})[status] || status || "Chưa xác định";}
function formatRole(role){return ({ADMIN:"Quản trị viên",DIRECTOR:"Ban Giám đốc",DEPARTMENT_LEADER:"Trưởng/Phó phòng, khu",TCHC_COORDINATOR:"Đầu mối TCHC",STAFF:"Viên chức, người lao động"})[String(role||"").toUpperCase()] || role || "Người dùng";}
function escapeHtml(value){return String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");}
