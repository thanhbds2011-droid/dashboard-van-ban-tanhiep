import { ToastService } from "../../core/toast-service.js";
export async function renderReportsView(outlet){
 outlet.innerHTML=`<section class="page-card"><div class="page-header"><div><span class="page-eyebrow">BÁO CÁO</span><h2>Xem trước và in báo cáo</h2><p>Báo cáo cá nhân, KPI và tổng hợp Phòng/Khu.</p></div></div>
 <div class="report-grid">${report("📝","Mẫu 01","Tiêu chí chung 30 điểm")}${report("📊","Bảng KPI","A, B, KPI 70 và tổng 100")}${report("🏢","Báo cáo Phòng/Khu","Tổng hợp theo đơn vị")}${report("🖨️","Bản in trình ký","Xem trước trước khi in")}</div>
 <div class="empty-state"><div class="empty-icon">📄</div><strong>Chưa có dữ liệu báo cáo</strong><p>Production 3B.2 chỉ hoàn thiện giao diện; chưa xuất hoặc tải tệp.</p></div></section>`;
 document.querySelectorAll("[data-report-preview]").forEach(button=>button.addEventListener("click",()=>ToastService.info("Chức năng xem trước báo cáo sẽ được kết nối ở giai đoạn báo cáo.")));
}
function report(icon,title,note){return `<button class="report-card" type="button" data-report-preview><span>${icon}</span><strong>${title}</strong><small>${note}</small></button>`;}
