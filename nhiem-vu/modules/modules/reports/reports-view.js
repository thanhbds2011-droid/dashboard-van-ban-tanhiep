export async function renderReportsView(outlet) {
  outlet.innerHTML = `
    <section class="page-card">
      <div class="page-header">
        <div>
          <h2>Báo cáo</h2>
          <p>Xem trước báo cáo cá nhân, KPI và báo cáo Phòng/Khu.</p>
        </div>
      </div>

      <div class="action-grid">
        <button type="button" class="secondary-button" disabled>
          Xem trước Mẫu 01
        </button>

        <button type="button" class="secondary-button" disabled>
          Xem trước bảng KPI
        </button>

        <button type="button" class="secondary-button" disabled>
          Báo cáo Phòng/Khu
        </button>
      </div>

      <div class="empty-state">
        Chức năng xem trước và in báo cáo sẽ được xây dựng ở giai đoạn sau.
      </div>
    </section>
  `;
}
