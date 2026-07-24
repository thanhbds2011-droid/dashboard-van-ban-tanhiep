import { Permissions } from "../../core/permissions.js";

export async function renderTasksView(outlet) {
  outlet.innerHTML = `
    <section class="page-card">
      <div class="page-header">
        <div>
          <h2>Nhiệm vụ</h2>
          <p>Quản lý nhiệm vụ được giao, đang xử lý và đã hoàn thành.</p>
        </div>

        ${
          Permissions.canRegisterTask()
            ? `
              <button type="button" class="primary-button" disabled>
                Ghi nhận nhiệm vụ
              </button>
            `
            : ""
        }
      </div>

      <div class="toolbar">
        <input
          type="search"
          placeholder="Tìm kiếm nhiệm vụ..."
          disabled
        >

        <select disabled>
          <option>Tất cả trạng thái</option>
        </select>
      </div>

      <div class="empty-state">
        Phân hệ nhiệm vụ mới chưa kết nối dữ liệu trong Production 3.0A.
      </div>
    </section>
  `;
}
