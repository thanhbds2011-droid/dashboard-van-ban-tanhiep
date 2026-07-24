/**
 * Production 3B.1 - Admin View
 * Màn hình khung quản trị hệ thống.
 *
 * Giai đoạn này:
 * - Kiểm tra quyền ADMIN.
 * - Chưa ghi dữ liệu.
 * - Chưa tạo hoặc xóa kỳ thật.
 */

import { UserContext } from "../../core/user-context.js";
import { Permissions } from "../../core/permissions.js";

export async function renderAdminView(outlet) {
  if (!(outlet instanceof HTMLElement)) {
    throw new Error("Admin View không nhận được vùng hiển thị hợp lệ.");
  }

  const user = UserContext.requireUser();

  if (!Permissions.isAdmin()) {
    renderAccessDenied(outlet, user);
    return;
  }

  outlet.innerHTML = `
    <section class="page-card">
      <div class="page-header">
        <div>
          <span class="page-eyebrow">QUẢN TRỊ HỆ THỐNG</span>
          <h2>Trung tâm quản trị</h2>
          <p>
            Quản lý kỳ đánh giá, kiểm tra dữ liệu và nhật ký hệ thống.
          </p>
        </div>

        <span class="role-badge">
          ADMIN
        </span>
      </div>

      <div class="success-banner">
        Tài khoản
        <strong>${escapeHtml(user.fullName || user.email)}</strong>
        có quyền truy cập phân hệ quản trị.
      </div>

      <div class="admin-summary-grid">
        <article class="summary-card">
          <span>Kỳ đang hoạt động</span>
          <strong>0</strong>
          <small>Chưa kết nối evaluationPeriods</small>
        </article>

        <article class="summary-card">
          <span>Tài khoản hoạt động</span>
          <strong>—</strong>
          <small>Chưa tải dữ liệu nhân sự</small>
        </article>

        <article class="summary-card">
          <span>Đầu việc chuẩn</span>
          <strong>—</strong>
          <small>Chưa tải standardTasks</small>
        </article>

        <article class="summary-card">
          <span>Cảnh báo dữ liệu</span>
          <strong>0</strong>
          <small>Chưa chạy kiểm tra dữ liệu</small>
        </article>
      </div>

      <section class="admin-section">
        <div class="section-heading">
          <div>
            <h3>Công cụ quản trị</h3>
            <p>
              Các chức năng nghiệp vụ sẽ được kích hoạt theo từng giai đoạn.
            </p>
          </div>
        </div>

        <div class="action-grid">
          <a class="admin-action-card" href="#/kpi/periods">
            <strong>🗓️ Quản lý kỳ đánh giá</strong>
            <span>
              Tạo, mở, kết thúc và theo dõi kỳ đánh giá.
            </span>
          </a>

          <button
            id="btnAdminCheckData"
            type="button"
            class="admin-action-card"
          >
            <strong>🔍 Kiểm tra dữ liệu</strong>
            <span>
              Kiểm tra tài khoản, phòng/khu và danh mục công việc.
            </span>
          </button>

          <button
            id="btnAdminAuditLogs"
            type="button"
            class="admin-action-card"
          >
            <strong>📜 Nhật ký hệ thống</strong>
            <span>
              Theo dõi các thao tác quản trị quan trọng.
            </span>
          </button>

          <button
            id="btnAdminPeriodCleanup"
            type="button"
            class="admin-action-card danger"
          >
            <strong>🗑️ Xóa dữ liệu kỳ</strong>
            <span>
              Chỉ sử dụng sau khi đã in và lưu hồ sơ giấy.
            </span>
          </button>
        </div>
      </section>

      <section class="admin-section">
        <div class="section-heading">
          <div>
            <h3>Phạm vi dữ liệu nền được bảo vệ</h3>
            <p>
              Các collection dưới đây không bị xóa khi chuyển kỳ.
            </p>
          </div>
        </div>

        <div class="protected-collection-grid">
          ${renderCollectionCard("users", "Hồ sơ người dùng")}
          ${renderCollectionCard("accessAccounts", "Danh sách được phép truy cập")}
          ${renderCollectionCard("departments", "Danh mục phòng/khu")}
          ${renderCollectionCard("standardTasks", "Danh mục công việc chuẩn")}
          ${renderCollectionCard(
            "taskPushSubscriptions",
            "Đăng ký nhận thông báo"
          )}
        </div>
      </section>

      <div class="warning-banner">
        Production 3B.1 chưa cho phép tạo, sửa hoặc xóa dữ liệu thật.
        Các nút hiện tại chỉ dùng để kiểm tra giao diện và phân quyền.
      </div>
    </section>
  `;

  bindAdminEvents();
}

function renderAccessDenied(outlet, user) {
  outlet.innerHTML = `
    <section class="page-card">
      <div class="page-header">
        <div>
          <span class="page-eyebrow">QUẢN TRỊ HỆ THỐNG</span>
          <h2>Không có quyền truy cập</h2>
          <p>
            Phân hệ này chỉ dành cho tài khoản ADMIN.
          </p>
        </div>
      </div>

      <div class="warning-banner">
        Tài khoản:
        <strong>${escapeHtml(user.fullName || user.email)}</strong><br>

        Vai trò hiện tại:
        <strong>${escapeHtml(user.role || "Chưa xác định")}</strong>
      </div>

      <div class="action-grid">
        <a class="secondary-button" href="#/dashboard">
          Quay về Trang chủ
        </a>

        <a class="secondary-button" href="#/tasks">
          Mở Nhiệm vụ
        </a>
      </div>
    </section>
  `;
}

function renderCollectionCard(collectionName, description) {
  return `
    <article class="collection-card">
      <strong>${escapeHtml(collectionName)}</strong>
      <span>${escapeHtml(description)}</span>
    </article>
  `;
}

function bindAdminEvents() {
  const checkDataButton = document.getElementById("btnAdminCheckData");
  const auditButton = document.getElementById("btnAdminAuditLogs");
  const cleanupButton = document.getElementById("btnAdminPeriodCleanup");

  checkDataButton?.addEventListener("click", () => {
    showPreviewMessage(
      "Kiểm tra dữ liệu",
      "Chức năng kiểm tra dữ liệu sẽ được kết nối ở giai đoạn quản trị tiếp theo."
    );
  });

  auditButton?.addEventListener("click", () => {
    showPreviewMessage(
      "Nhật ký hệ thống",
      "Chức năng nhật ký hệ thống chưa kết nối collection kpiAuditLogs."
    );
  });

  cleanupButton?.addEventListener("click", () => {
    showPreviewMessage(
      "Xóa dữ liệu kỳ",
      "Production 3B.1 không thực hiện xóa dữ liệu thật."
    );
  });
}

function showPreviewMessage(title, message) {
  window.alert(`${title}\n\n${message}`);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
