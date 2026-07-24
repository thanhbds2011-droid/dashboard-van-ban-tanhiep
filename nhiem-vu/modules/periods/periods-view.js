import { Permissions } from "../../core/permissions.js";
import { ToastService } from "../../core/toast-service.js";
export async function renderPeriodsView(outlet){
 const canCreate=Permissions.canCreatePeriod();
 outlet.innerHTML=`<section class="page-card"><div class="page-header"><div><span class="page-eyebrow">QUẢN LÝ KỲ</span><h2>Kỳ đánh giá KPI</h2><p>Tạo, mở, chuyển giai đoạn và kết thúc kỳ đánh giá.</p></div>${canCreate?'<button id="btnCreatePeriodPreview" class="primary-button" type="button">＋ Tạo kỳ đánh giá</button>':""}</div>
 ${canCreate?'<div class="success-banner">Tài khoản hiện tại có quyền quản lý kỳ đánh giá.</div>':'<div class="warning-banner">Bạn không có quyền tạo hoặc quản lý kỳ đánh giá.</div>'}
 <div class="period-timeline">${step("01","Dự thảo")}${step("02","Đang mở")}${step("03","Đánh giá")}${step("04","Báo cáo")}${step("05","Hoàn tất")}</div>
 <div class="empty-state"><div class="empty-icon">🗓️</div><strong>Chưa có kỳ đánh giá được tải</strong><p>Collection evaluationPeriods chưa được kết nối trong Production 3B.2.</p></div></section>`;
 document.getElementById("btnCreatePeriodPreview")?.addEventListener("click",()=>ToastService.info("Nút tạo kỳ đang ở chế độ giao diện thử nghiệm; chưa ghi Firestore."));
}
function step(no,label){return `<div class="timeline-step"><b>${no}</b><span>${label}</span></div>`;}
