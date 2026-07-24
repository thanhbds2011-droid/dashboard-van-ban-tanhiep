import { Permissions } from "../../core/permissions.js";

export async function renderPeriodsView(outlet) {
  const canCreate = Permissions.canCreatePeriod();

  outlet.innerHTML = `
    <section class="page-card">
      <div class="page-header">
        <div>
          <h2>Quản lý kỳ đánh giá</h2>
          <p>Tạo, mở, kết thúc và quản lý các kỳ đánh giá KPI.</p>
        </div>

        ${
          canCreate
            ? `
              <button
                id="btnCreatePeriodPreview"
                type="button"
                class="primary-button"
              >
                Tạo kỳ đánh giá
              </button>
            `
            : ""
        }
      </div>

      ${
        canCreate
          ? `
            <div class="success-banner">
              Tài khoản hiện tại có quyền quản lý kỳ đánh giá.
            </div>
          `
          : `
            <div class="warning-banner">
              Bạn không có quyền tạo hoặc quản lý kỳ đánh giá.
            </div>
          `
      }

      <div class="empty-state">
        Chưa kết nối collection evaluationPeriods.
      </div>
    </section>
  `;

  const button = document.getElementById("btnCreatePeriodPreview");

  if (button) {
    button.addEventListener("click", () => {
      window.alert(
        "Nút tạo kỳ đang hoạt động ở chế độ giao diện thử nghiệm. Chưa ghi Firestore."
      );
    });
  }
}
