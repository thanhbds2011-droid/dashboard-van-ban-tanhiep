/**
 * Production 3B.1 - Dashboard View
 * Màn hình tổng quan thử nghiệm.
 *
 * Giai đoạn này:
 * - Chỉ đọc UserContext.
 * - Chưa đọc dữ liệu nhiệm vụ từ Firestore.
 * - Không ghi dữ liệu.
 */

import { UserContext } from "../../core/user-context.js";
import { Permissions } from "../../core/permissions.js";

export async function renderDashboardView(outlet) {
  if (!(outlet instanceof HTMLElement)) {
    throw new Error("Dashboard View không nhận được vùng hiển thị hợp lệ.");
  }

  const user = UserContext.requireUser();

  outlet.innerHTML = `
    <section class="page-card">
      <div class="page-header">
        <div>
          <span class="page-eyebrow">PRODUCTION 3B.1</span>
          <h2>Trang chủ</h2>
          <p>
            Tổng quan hệ thống nhiệm vụ và đánh giá KPI.
          </p>
        </div>

        <button
          id="btnDashboardRefresh"
          type="button"
          class="secondary-button"
        >
          ↻ Làm mới
        </button>
      </div>

      <section class="welcome-panel">
        <div>
          <span class="welcome-label">Xin chào</span>

          <h3>${escapeHtml(user.fullName || "Người dùng")}</h3>

          <p>
            ${escapeHtml(user.position || "Chưa cập nhật chức danh")}
            ${
              user.departmentId
                ? ` • ${escapeHtml(user.departmentId)}`
                : ""
            }
          </p>
        </div>

        <span class="role-badge">
          ${escapeHtml(formatRole(user.role))}
        </span>
      </section>

      <div class="summary-grid">
        <article class="summary-card">
          <span>Nhiệm vụ đang xử lý</span>
          <strong>0</strong>
          <small>Chưa kết nối dữ liệu thật</small>
        </article>

        <article class="summary-card">
          <span>Sắp đến hạn</span>
          <strong>0</strong>
          <small>Chưa kết nối dữ liệu thật</small>
        </article>

        <article class="summary-card">
          <span>Trễ hạn</span>
          <strong>0</strong>
          <small>Chưa kết nối dữ liệu thật</small>
        </article>

        <article class="summary-card">
          <span>Hoàn thành</span>
          <strong>0</strong>
          <small>Chưa kết nối dữ liệu thật</small>
        </article>

        <article class="summary-card">
          <span>Kỳ KPI hiện tại</span>
          <strong>—</strong>
          <small>Chưa kết nối kỳ đánh giá</small>
        </article>
      </div>

      <section class="dashboard-grid">
        <article class="dashboard-section">
          <div class="section-heading">
            <div>
              <h3>Truy cập nhanh</h3>
              <p>Mở nhanh các phân hệ chính.</p>
            </div>
          </div>

          <div class="action-grid">
            <a class="quick-action-card" href="#/tasks">
              <strong>📋 Nhiệm vụ</strong>
              <span>Xem nhiệm vụ và tiến độ xử lý.</span>
            </a>

            <a class="quick-action-card" href="#/standard-tasks">
              <strong>📁 Danh mục công việc</strong>
              <span>Tra cứu đầu việc chuẩn của đơn vị.</span>
            </a>

            <a class="quick-action-card" href="#/kpi">
              <strong>📊 Kế hoạch KPI</strong>
              <span>Đăng ký và theo dõi kế hoạch quý.</span>
            </a>

            <a class="quick-action-card" href="#/reports">
              <strong>📄 Báo cáo</strong>
              <span>Xem trước báo cáo và biểu mẫu.</span>
            </a>

            ${
              Permissions.isAdmin()
                ? `
                  <a class="quick-action-card" href="#/admin">
                    <strong>⚙️ Quản trị</strong>
                    <span>Quản lý kỳ và cấu hình hệ thống.</span>
                  </a>
                `
                : ""
            }
          </div>
        </article>

        <article class="dashboard-section">
          <div class="section-heading">
            <div>
              <h3>Trạng thái hệ thống</h3>
              <p>Thông tin kiểm tra khung Production 3B.1.</p>
            </div>
          </div>

          <dl class="system-status-list">
            <div>
              <dt>Firebase Core</dt>
              <dd class="status-success">Hoạt động</dd>
            </div>

            <div>
              <dt>Xác thực người dùng</dt>
              <dd class="status-success">Hoạt động</dd>
            </div>

            <div>
              <dt>User Context</dt>
              <dd class="status-success">Đã nạp</dd>
            </div>

            <div>
              <dt>Router</dt>
              <dd class="status-success">Hoạt động</dd>
            </div>

            <div>
              <dt>Dữ liệu Dashboard thật</dt>
              <dd class="status-pending">Chưa kết nối</dd>
            </div>
          </dl>
        </article>
      </section>

      <div class="info-banner">
        Đây là giao diện kiểm tra kiến trúc Production 3B.1.
        Số liệu nhiệm vụ thật sẽ được kết nối ở giai đoạn tiếp theo.
      </div>
    </section>
  `;

  bindDashboardEvents();
}

function bindDashboardEvents() {
  const refreshButton = document.getElementById("btnDashboardRefresh");

  if (!refreshButton) {
    return;
  }

  refreshButton.addEventListener("click", () => {
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

function formatRole(role) {
  const roleMap = {
    ADMIN: "Quản trị viên",
    DIRECTOR: "Ban Giám đốc",
    DEPARTMENT_LEADER: "Trưởng/Phó phòng, khu",
    TCHC_COORDINATOR: "Đầu mối TCHC",
    STAFF: "Viên chức, người lao động"
  };

  return roleMap[String(role || "").toUpperCase()] || role || "Chưa xác định";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
