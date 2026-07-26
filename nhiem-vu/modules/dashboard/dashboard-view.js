import { UserContext } from "../../core/user-context.js";
import { Permissions } from "../../core/permissions.js";
import { ToastService } from "../../core/toast-service.js";
import { DashboardReadService } from "../../services/dashboard-read-service.js";

export async function renderDashboardView(outlet) {
  const user = UserContext.requireUser();
  outlet.innerHTML = loadingCard("Đang tải thông tin tổng hợp…");

  try {
    const data = await DashboardReadService.load();
    const summary = data.taskSummary;
    const period = data.activePeriod;

    outlet.innerHTML = `
      <section class="page-card">
        <div class="page-header"><div><span class="page-eyebrow">TỔNG QUAN CÔNG VIỆC</span><h2>Trang chủ</h2><p>Theo dõi nhiệm vụ, kế hoạch và kết quả đánh giá theo phạm vi tài khoản.</p></div><button id="btnDashboardRefresh" class="secondary-button" type="button">↻ Làm mới</button></div>
        <section class="welcome-panel"><div><span class="welcome-label">Xin chào</span><h3>${escapeHtml(user.fullName || "Người dùng")}</h3><p>${escapeHtml(user.position || "Chưa cập nhật chức danh")} ${user.departmentId ? `• ${escapeHtml(user.departmentId)}` : ""}</p></div><span class="role-badge">${escapeHtml(formatRole(user.role))}</span></section>
        <div class="summary-grid">
          ${metric("Nhiệm vụ đang xử lý", summary.inProgress, "Nhiệm vụ trong phạm vi phụ trách", "blue")}
          ${metric("Sắp đến hạn", summary.dueSoon, "Trong 72 giờ tới", "amber")}
          ${metric("Trễ hạn", summary.overdue, "Chưa hoàn thành và quá hạn", "red")}
          ${metric("Hoàn thành", summary.completed, "Theo phạm vi được phép xem", "green")}
          ${metric("Kỳ KPI hiện tại", period ? escapeHtml(period.name || period.code || period.id) : "—", period ? formatPeriodStatus(period._status) : "Chưa có kỳ hoạt động", "violet")}
        </div>
        <section class="dashboard-grid">
          <article class="dashboard-section"><div class="section-heading"><div><h3>Truy cập nhanh</h3><p>Mở nhanh các phân hệ đã kết nối dữ liệu đọc.</p></div></div><div class="quick-grid">
            ${quick("#/tasks", "📋", "Nhiệm vụ", `${summary.total} nhiệm vụ trong phạm vi`)}
            ${quick("#/standard-tasks", "📁", "Danh mục công việc", `${data.standardTaskSummary.total} đầu việc`)}
            ${quick("#/kpi", "📊", "Kế hoạch KPI", period ? "Đã nhận diện kỳ hoạt động" : "Chưa có kỳ hoạt động")}
            ${quick("#/reports", "📄", "Báo cáo", "Khung báo cáo chưa ghi dữ liệu")}
            ${Permissions.isAdmin() ? quick("#/admin", "⚙️", "Quản trị", "Xem thống kê dữ liệu nền") : ""}
          </div></article>
          <article class="dashboard-section"><div class="section-heading"><div><h3>Tổng quan dữ liệu</h3><p>Các thông tin phục vụ quản lý nhiệm vụ và đánh giá trong kỳ.</p></div></div><dl class="system-status-list">
            ${status("Nhiệm vụ", `${data.tasks.length} nhiệm vụ`, "success")}
            ${status("Danh mục công việc", `${data.standardTasks.length} đầu việc`, "success")}
            ${status("Kỳ đánh giá", `${data.periods.length} kỳ`, "success")}
            ${status("Chế độ ghi dữ liệu", "Đã khóa ở UI", "pending")}
          </dl></article>
        </section>
        ${data.warnings.length ? `<div class="warning-banner"><strong>Một số thông tin chưa tải được:</strong><br>Vui lòng liên hệ người quản trị để kiểm tra quyền truy cập.</div>` : `<div class="success-banner">Thông tin đã được cập nhật theo đúng phạm vi phụ trách.</div>`}
      </section>`;

    document.getElementById("btnDashboardRefresh")?.addEventListener("click", () => {
      ToastService.info("Đang tải lại Dashboard…");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
  } catch (error) {
    outlet.innerHTML = errorCard("Không thể tải Dashboard", error);
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
