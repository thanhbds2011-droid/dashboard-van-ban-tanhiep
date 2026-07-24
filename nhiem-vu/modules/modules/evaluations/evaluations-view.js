export async function renderEvaluationsView(outlet) {
  outlet.innerHTML = `
    <section class="page-card">
      <div class="page-header">
        <div>
          <h2>Đánh giá nhiệm vụ</h2>
          <p>
            Tự đánh giá, xác nhận điểm nhiệm vụ và tiêu chí chung Mẫu 01.
          </p>
        </div>
      </div>

      <div class="summary-grid">
        <article class="summary-card">
          <span>A – Kế hoạch</span>
          <strong>0</strong>
        </article>

        <article class="summary-card">
          <span>B – Thực tế</span>
          <strong>0</strong>
        </article>

        <article class="summary-card">
          <span>KPI công việc</span>
          <strong>0/70</strong>
        </article>

        <article class="summary-card">
          <span>Tiêu chí chung</span>
          <strong>0/30</strong>
        </article>

        <article class="summary-card">
          <span>Tổng điểm</span>
          <strong>0/100</strong>
        </article>
      </div>

      <div class="empty-state">
        Chưa có dữ liệu đánh giá trong Production 3.0A.
      </div>
    </section>
  `;
}
