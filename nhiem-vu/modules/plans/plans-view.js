import { Permissions } from "../../core/permissions.js";

export async function renderPlansView(outlet) {
  outlet.innerHTML = `
    <section class="page-card">
      <div class="page-header">
        <div>
          <h2>Kế hoạch nhiệm vụ quý</h2>
          <p>Đăng ký, duyệt và khóa kế hoạch để hình thành điểm A.</p>
        </div>
      </div>

      <div class="tab-bar">
        <button type="button" class="tab-button active" disabled>
          Nhiệm vụ của tôi
        </button>

        ${
          Permissions.canApprovePlan()
            ? `
              <button type="button" class="tab-button" disabled>
                Chờ duyệt
              </button>
            `
            : ""
        }

        ${
          Permissions.canLockDepartmentPlan()
            ? `
              <button type="button" class="tab-button" disabled>
                Khóa kế hoạch
              </button>
            `
            : ""
        }
      </div>

      <div class="empty-state">
        Chưa có kỳ đánh giá hoạt động và chưa tải kế hoạch quý.
      </div>
    </section>
  `;
}
