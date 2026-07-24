import { Permissions } from "../../core/permissions.js";
export async function renderPlansView(outlet){
 outlet.innerHTML=`<section class="page-card"><div class="page-header"><div><span class="page-eyebrow">KẾ HOẠCH KPI</span><h2>Kế hoạch nhiệm vụ quý</h2><p>Đăng ký, duyệt và khóa kế hoạch để hình thành điểm A.</p></div><span class="status-pill neutral">Chưa có kỳ hoạt động</span></div>
 <div class="summary-grid compact-grid">${card("A – Kế hoạch","0")}${card("Đã duyệt","0")}${card("Chờ duyệt","0")}${card("Nhiệm vụ đột xuất","0")}</div>
 <div class="tab-bar"><button class="tab-button active" type="button">Nhiệm vụ của tôi</button>${Permissions.canApprovePlan()?'<button class="tab-button" type="button">Chờ duyệt</button>':""}${Permissions.canLockDepartmentPlan()?'<button class="tab-button" type="button">Khóa kế hoạch</button>':""}</div>
 <div class="empty-state"><div class="empty-icon">📊</div><strong>Chưa có kỳ đánh giá hoạt động</strong><p>Kế hoạch quý sẽ hiển thị sau khi ADMIN mở kỳ và dữ liệu được kết nối.</p></div></section>`;
}
function card(label,value){return `<article class="summary-card"><span>${label}</span><strong>${value}</strong><small>Chưa kết nối dữ liệu</small></article>`;}
