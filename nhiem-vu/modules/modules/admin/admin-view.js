import { Permissions } from "../../core/permissions.js";

export async function renderAdminView(outlet) {
  if (!Permissions.isAdmin()) {
    outlet.innerHTML = `
      <section class="page-card">
        <h2>Quản trị hệ thống</h2>

        <div class="warning-banner">
          Bạn không có quyền truy cập phân hệ quản trị.
        </div>
      </section>
    `;
    return;
  }

  outlet.innerHTML = `
    <section class="page-card">
      <div class="page-header">
        <div>
          <h2>Quản trị hệ thống</h2>
          <p>Quản lý kỳ, kiểm tra dữ liệu và nhật ký hệ thống.</p>
        </div>
      </div>

      <div class="action-grid">
        <a class="admin-action-card" href="#/kpi/periods">
          <strong>Quản lý kỳ</strong>
          <span>Tạo, mở và kết thúc kỳ đánh giá.</span>
        </a>

        <button type="button" class="admin-action-card" disabled>
          <strong>Kiểm tra dữ liệu</strong>
          <span>Phát hiện dữ liệu thiếu hoặc không hợp lệ.</span>
        </button>

        <button type="button" class="admin-action-card" disabled>
          <strong>Nhật ký hệ thống</strong>
          <span>Theo dõi các thao tác quan trọng.</span>
        </button>

        <button type="button" class="admin-action-card danger" disabled>
          <strong>Xóa dữ liệu kỳ</strong>
          <span>Chỉ dùng sau khi đã in và lưu hồ sơ giấy.</span>
        </button>
      </div>
    </section>
  `;
}
