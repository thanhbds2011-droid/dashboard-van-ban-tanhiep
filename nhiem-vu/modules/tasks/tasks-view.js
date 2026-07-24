import { Permissions } from "../../core/permissions.js";
import { ToastService } from "../../core/toast-service.js";

export async function renderTasksView(outlet) {
  outlet.innerHTML = `<section class="page-card">
    <div class="page-header"><div><span class="page-eyebrow">NHIỆM VỤ</span><h2>Quản lý nhiệm vụ</h2><p>Theo dõi nhiệm vụ được giao, tiến độ và kết quả xử lý.</p></div>${Permissions.canRegisterTask()?'<button id="btnTaskPreview" class="primary-button" type="button">＋ Ghi nhận nhiệm vụ</button>':""}</div>
    <div class="summary-grid compact-grid">${card("Tất cả","0")}${card("Đang xử lý","0")}${card("Chờ phân công","0")}${card("Trễ hạn","0")}</div>
    <div class="toolbar"><label class="field-grow"><span>Tìm kiếm</span><input type="search" placeholder="Tìm mã, tiêu đề hoặc người thực hiện…" disabled></label><label><span>Trạng thái</span><select disabled><option>Tất cả trạng thái</option></select></label><button class="secondary-button" type="button" disabled>Đặt lại</button></div>
    <div class="tab-bar"><button class="tab-button active" type="button">Nhiệm vụ của tôi</button>${Permissions.canAssignTask()?'<button class="tab-button" type="button">Nhiệm vụ đơn vị</button>':""}<button class="tab-button" type="button">Đã hoàn thành</button></div>
    <div class="empty-state"><div class="empty-icon">📋</div><strong>Chưa kết nối dữ liệu nhiệm vụ</strong><p>Module giao diện đã sẵn sàng. Collection tasks sẽ được kết nối ở giai đoạn tiếp theo.</p></div>
  </section>`;
  document.getElementById("btnTaskPreview")?.addEventListener("click", () => ToastService.info("Chức năng ghi nhận nhiệm vụ sẽ được kết nối ở phiên bản dữ liệu thật."));
}
function card(label,value){return `<article class="summary-card"><span>${label}</span><strong>${value}</strong><small>Chưa kết nối dữ liệu</small></article>`;}
