/**
 * Production 3B.1 - Evaluations View
 * Khung giao diện đánh giá nhiệm vụ và KPI.
 *
 * Giai đoạn này:
 * - Chưa đọc taskEvaluations.
 * - Chưa tính điểm thật.
 * - Không ghi dữ liệu Firestore.
 */

import { UserContext } from "../../core/user-context.js";
import { Permissions } from "../../core/permissions.js";

export async function renderEvaluationsView(outlet) {
  if (!(outlet instanceof HTMLElement)) {
    throw new Error(
      "Evaluations View không nhận được vùng hiển thị hợp lệ."
    );
  }

  const user = UserContext.requireUser();

  outlet.innerHTML = `
    <section class="page-card">
      <div class="page-header">
        <div>
          <span class="page-eyebrow">ĐÁNH GIÁ KPI</span>
          <h2>Đánh giá nhiệm vụ và chấm điểm KPI</h2>
          <p>
            Tự đánh giá, xác nhận điểm nhiệm vụ và tiêu chí chung Mẫu 01.
          </p>
        </div>

        <button
          id="btnEvaluationRefresh"
          type="button"
          class="secondary-button"
        >
          ↻ Làm mới
        </button>
      </div>

      <section class="evaluation-user-panel">
        <div>
          <span>Người được đánh giá</span>
          <strong>${escapeHtml(user.fullName || user.email)}</strong>
        </div>

        <div>
          <span>Đơn vị</span>
          <strong>${escapeHtml(user.departmentId || "—")}</strong>
        </div>

        <div>
          <span>Vai trò</span>
          <strong>${escapeHtml(formatRole(user.role))}</strong>
        </div>

        <div>
          <span>Kỳ đánh giá</span>
          <strong>Chưa có kỳ hoạt động</strong>
        </div>
      </section>

      <div class="warning-banner">
        Chưa có kỳ đánh giá đang hoạt động hoặc dữ liệu đánh giá chưa được
        kết nối trong Production 3B.1.
      </div>

      <div class="summary-grid">
        <article class="summary-card">
          <span>A – Kế hoạch</span>
          <strong>0</strong>
          <small>Tổng điểm tối đa kế hoạch đã khóa</small>
        </article>

        <article class="summary-card">
          <span>B – Thực tế</span>
          <strong>0</strong>
          <small>Tổng điểm thực tế được xác nhận</small>
        </article>

        <article class="summary-card">
          <span>KPI công việc</span>
          <strong>0/70</strong>
          <small>Tối đa 70 điểm</small>
        </article>

        <article class="summary-card">
          <span>Tiêu chí chung</span>
          <strong>0/30</strong>
          <small>Mẫu 01 – tối đa 30 điểm</small>
        </article>

        <article class="summary-card">
          <span>Tổng điểm</span>
          <strong>0/100</strong>
          <small>KPI công việc + tiêu chí chung</small>
        </article>
      </div>

      <section class="evaluation-section">
        <div class="tab-bar" role="tablist">
          <button
            type="button"
            class="tab-button active"
            data-evaluation-tab="self"
          >
            Tự đánh giá
          </button>

          ${
            Permissions.canReviewStaffTask()
              ? `
                <button
                  type="button"
                  class="tab-button"
                  data-evaluation-tab="review"
                >
                  Chờ xác nhận
                </button>
              `
              : ""
          }

          <button
            type="button"
            class="tab-button"
            data-evaluation-tab="confirmed"
          >
            Đã xác nhận
          </button>

          <button
            type="button"
            class="tab-button"
            data-evaluation-tab="criteria"
          >
            Mẫu 01 – 30 điểm
          </button>
        </div>

        <div id="evaluationTabContent" class="evaluation-tab-content">
          ${renderSelfAssessmentPlaceholder()}
        </div>
      </section>

      <section class="evaluation-workflow">
        <div class="section-heading">
          <div>
            <h3>Luồng xác nhận điểm</h3>
            <p>
              Quy trình được áp dụng theo vai trò của người được đánh giá.
            </p>
          </div>
        </div>

        <div class="workflow-grid">
          <article class="workflow-card">
            <span class="workflow-step">01</span>
            <strong>Viên chức tự đánh giá</strong>
            <p>
              Chọn tỷ lệ tiến độ, kết quả và gửi người xác nhận.
            </p>
          </article>

          <article class="workflow-card">
            <span class="workflow-step">02</span>
            <strong>Người có thẩm quyền rà soát</strong>
            <p>
              STAFF do Trưởng/Phó phòng xác nhận.
            </p>
          </article>

          <article class="workflow-card">
            <span class="workflow-step">03</span>
            <strong>Khóa kết quả</strong>
            <p>
              Điểm xác nhận được dùng để tính B và KPI công việc.
            </p>
          </article>

          <article class="workflow-card">
            <span class="workflow-step">04</span>
            <strong>In báo cáo</strong>
            <p>
              Xem trước, in và lưu hồ sơ giấy theo quy định.
            </p>
          </article>
        </div>
      </section>

      <div class="info-banner">
        Production 3B.1 chỉ kiểm tra giao diện đánh giá.
        Công thức và dữ liệu thật sẽ được kết nối ở giai đoạn sau.
      </div>
    </section>
  `;

  bindEvaluationEvents();
}

function bindEvaluationEvents() {
  const refreshButton = document.getElementById("btnEvaluationRefresh");
  const tabContent = document.getElementById("evaluationTabContent");
  const tabButtons = document.querySelectorAll("[data-evaluation-tab]");

  refreshButton?.addEventListener("click", () => {
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });

  tabButtons.forEach(button => {
    button.addEventListener("click", () => {
      tabButtons.forEach(item => item.classList.remove("active"));
      button.classList.add("active");

      const tab = button.dataset.evaluationTab || "self";

      if (!tabContent) {
        return;
      }

      switch (tab) {
        case "review":
          tabContent.innerHTML = renderReviewPlaceholder();
          break;

        case "confirmed":
          tabContent.innerHTML = renderConfirmedPlaceholder();
          break;

        case "criteria":
          tabContent.innerHTML = renderCommonCriteriaPlaceholder();
          break;

        case "self":
        default:
          tabContent.innerHTML = renderSelfAssessmentPlaceholder();
          break;
      }
    });
  });
}

function renderSelfAssessmentPlaceholder() {
  return `
    <div class="empty-state">
      <div>
        <strong>Chưa có nhiệm vụ cần tự đánh giá</strong>
        <p>
          Nhiệm vụ sẽ xuất hiện sau khi có kỳ đánh giá,
          kế hoạch được duyệt và nhiệm vụ đã thực hiện.
        </p>
      </div>
    </div>
  `;
}

function renderReviewPlaceholder() {
  return `
    <div class="empty-state">
      <div>
        <strong>Không có hồ sơ chờ xác nhận</strong>
        <p>
          Danh sách sẽ hiển thị các hồ sơ thuộc phạm vi xác nhận của bạn.
        </p>
      </div>
    </div>
  `;
}

function renderConfirmedPlaceholder() {
  return `
    <div class="empty-state">
      <div>
        <strong>Chưa có kết quả đã xác nhận</strong>
        <p>
          Kết quả sau xác nhận sẽ được lưu theo từng kỳ đánh giá.
        </p>
      </div>
    </div>
  `;
}

function renderCommonCriteriaPlaceholder() {
  return `
    <div class="common-criteria-preview">
      <div class="section-heading">
        <div>
          <h3>Mẫu 01 – Tiêu chí chung 30 điểm</h3>
          <p>
            Mỗi tiêu chí chọn Đảm bảo hoặc Không đảm bảo.
          </p>
        </div>
      </div>

      <div class="criteria-group-preview">
        <strong>Nhóm 1</strong>
        <span>9 tiêu chí × 2 điểm = 18 điểm</span>
      </div>

      <div class="criteria-group-preview">
        <strong>Nhóm 2</strong>
        <span>4 tiêu chí × 1 điểm = 4 điểm</span>
      </div>

      <div class="criteria-group-preview">
        <strong>Nhóm 3</strong>
        <span>4 tiêu chí × 2 điểm = 8 điểm</span>
      </div>

      <div class="empty-state">
        Nội dung chi tiết Mẫu 01 sẽ được kết nối ở giai đoạn đánh giá KPI.
      </div>
    </div>
  `;
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
