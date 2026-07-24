import { UserContext } from "../../core/user-context.js";
import { Permissions } from "../../core/permissions.js";
import { ToastService } from "../../core/toast-service.js";

export async function renderDashboardView(outlet) {
  const user = UserContext.requireUser();
  outlet.innerHTML = `
    <section class="page-card">
      <div class="page-header"><div><span class="page-eyebrow">PRODUCTION 3B.2</span><h2>Trang chủ</h2><p>Tổng quan nhiệm vụ, kỳ đánh giá và các thao tác nhanh.</p></div><button id="btnDashboardRefresh" class="secondary-button" type="button">↻ Làm mới</button></div>
      <section class="welcome-panel"><div><span class="welcome-label">Xin chào</span><h3>${escapeHtml(user.fullName || "Người dùng")}</h3><p>${escapeHtml(user.position || "Chưa cập nhật chức danh")} ${user.departmentId ? `• ${escapeHtml(user.departmentId)}` : ""}</p></div><span class="role-badge">${escapeHtml(formatRole(user.role))}</span></section>
      <div class="summary-grid">
        ${metric("Nhiệm vụ đang xử lý", "0", "Chưa kết nối dữ liệu thật", "blue")}
        ${metric("Sắp đến hạn", "0", "Chưa kết nối dữ liệu thật", "amber")}
        ${metric("Trễ hạn", "0", "Chưa kết nối dữ liệu thật", "red")}
        ${metric("Hoàn thành", "0", "Chưa kết nối dữ liệu thật", "green")}
        ${metric("Kỳ KPI hiện tại", "—", "Chưa kết nối kỳ đánh giá", "violet")}
      </div>
      <section class="dashboard-grid">
        <article class="dashboard-section"><div class="section-heading"><div><h3>Truy cập nhanh</h3><p>Mở nhanh các phân hệ chính.</p></div></div><div class="quick-grid">
          ${quick("#/tasks", "📋", "Nhiệm vụ", "Xem nhiệm vụ và tiến độ xử lý.")}
          ${quick("#/standard-tasks", "📁", "Danh mục công việc", "Tra cứu đầu việc chuẩn của đơn vị.")}
          ${quick("#/kpi", "📊", "Kế hoạch KPI", "Đăng ký và theo dõi kế hoạch quý.")}
          ${quick("#/reports", "📄", "Báo cáo", "Xem trước báo cáo và biểu mẫu.")}
          ${Permissions.isAdmin() ? quick("#/admin", "⚙️", "Quản trị", "Quản lý kỳ và cấu hình hệ thống.") : ""}
        </div></article>
        <article class="dashboard-section"><div class="section-heading"><div><h3>Trạng thái hệ thống</h3><p>Kiểm tra khung Production 3B.2.</p></div></div><dl class="system-status-list">
          ${status("Firebase Core", "Hoạt động", "success")}${status("Xác thực người dùng", "Hoạt động", "success")}${status("User Context", "Đã nạp", "success")}${status("Router", "Hoạt động", "success")}${status("Dữ liệu nghiệp vụ thật", "Chưa kết nối", "pending")}
        </dl></article>
      </section>
      <div class="info-banner">Đây là giao diện kiểm tra kiến trúc Production 3B.2. Dữ liệu thật sẽ được kết nối ở phiên bản kế tiếp.</div>
    </section>`;
  document.getElementById("btnDashboardRefresh")?.addEventListener("click", () => ToastService.info("Đã làm mới giao diện Dashboard."));
}
function metric(label, value, note, tone) { return `<article class="summary-card tone-${tone}"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`; }
function quick(href, icon, title, note) { return `<a class="quick-action-card" href="${href}"><span class="quick-icon">${icon}</span><span><strong>${title}</strong><small>${note}</small></span><b>→</b></a>`; }
function status(label, value, type) { return `<div><dt>${label}</dt><dd class="status-${type}">${value}</dd></div>`; }
function formatRole(role) { return ({ADMIN:"Quản trị viên",DIRECTOR:"Ban Giám đốc",DEPARTMENT_LEADER:"Trưởng/Phó phòng, khu",TCHC_COORDINATOR:"Đầu mối TCHC",STAFF:"Viên chức, người lao động"})[String(role||"").toUpperCase()] || role || "Người dùng"; }
function escapeHtml(value) { return String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;"); }
