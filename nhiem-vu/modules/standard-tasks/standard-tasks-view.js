import { UserContext } from "../../core/user-context.js";

export async function renderStandardTasksView(outlet) {
  const user = UserContext.getUser();

  outlet.innerHTML = `
    <section class="page-card">
      <div class="page-header">
        <div>
          <h2>Danh mục công việc chuẩn</h2>
          <p>
            Danh mục đầu việc được đồng bộ từ Google Sheet sang Firestore.
          </p>
        </div>
      </div>

      <div class="info-banner">
        Phạm vi hiển thị dự kiến:
        <strong>${escapeHtml(user?.departmentId || "Chưa xác định")}</strong>
      </div>

      <div class="toolbar">
        <input
          type="search"
          placeholder="Tìm mã hoặc tên công việc..."
          disabled
        >

        <select disabled>
          <option>Tất cả loại công việc</option>
        </select>
      </div>

      <div class="empty-state">
        Production 3.0A chưa đọc collection standardTasks.
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
