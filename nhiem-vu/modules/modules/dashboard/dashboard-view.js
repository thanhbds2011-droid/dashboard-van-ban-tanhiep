import { UserContext } from "../../core/user-context.js";

export async function renderDashboardView(outlet) {
  const user = UserContext.getUser();

  outlet.innerHTML = `
    <section class="page-card">
      <div class="page-header">
        <div>
          <h2>Trang chủ</h2>
          <p>Tổng quan hệ thống nhiệm vụ và đánh giá KPI.</p>
        </div>
      </div>

      <div class="summary-grid">
        <article class="summary-card">
          <span>Người dùng</span>
          <strong>${escapeHtml(user?.fullName || "Chưa xác định")}</strong>
        </article>

        <article class="summary-card">
          <span>Phòng/Khu</span>
          <strong>${escapeHtml(user?.departmentId || "-")}</strong>
        </article>

        <article class="summary-card">
          <span>Vai trò</span>
          <strong>${escapeHtml(user?.role || "-")}</strong>
        </article>

        <article class="summary-card">
          <span>Trạng thái</span>
          <strong>${user?.active ? "Đang hoạt động" : "Chưa xác định"}</strong>
        </article>
      </div>

      <div class="empty-state">
        Production 3.0A đang chạy ở chế độ khung thử nghiệm.
      </div>
    </section>
  `;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
