import { UserContext } from "../../core/user-context.js";
import { Permissions } from "../../core/permissions.js";
export async function renderEvaluationsView(outlet){
 const user=UserContext.requireUser();
 outlet.innerHTML=`<section class="page-card"><div class="page-header"><div><span class="page-eyebrow">ĐÁNH GIÁ KPI</span><h2>Đánh giá nhiệm vụ và chấm điểm</h2><p>Tự đánh giá, xác nhận điểm nhiệm vụ và tiêu chí chung Mẫu 01.</p></div><button class="secondary-button" type="button" disabled>↻ Làm mới</button></div>
 <section class="evaluation-user-panel"><div><span>Người được đánh giá</span><strong>${escapeHtml(user.fullName||user.email)}</strong></div><div><span>Đơn vị</span><strong>${escapeHtml(user.departmentId||"—")}</strong></div><div><span>Vai trò</span><strong>${escapeHtml(user.role||"—")}</strong></div><div><span>Kỳ đánh giá</span><strong>Chưa có kỳ hoạt động</strong></div></section>
 <div class="summary-grid">${metric("A – Kế hoạch","0")}${metric("B – Thực tế","0")}${metric("KPI công việc","0/70")}${metric("Tiêu chí chung","0/30")}${metric("Tổng điểm","0/100")}</div>
 <div class="tab-bar"><button class="tab-button active" type="button">Tự đánh giá</button>${Permissions.canReviewStaffTask()?'<button class="tab-button" type="button">Chờ xác nhận</button>':""}<button class="tab-button" type="button">Đã xác nhận</button><button class="tab-button" type="button">Mẫu 01 – 30 điểm</button></div>
 <div class="empty-state"><div class="empty-icon">🧭</div><strong>Chưa có nhiệm vụ cần đánh giá</strong><p>Dữ liệu taskEvaluations và công thức điểm sẽ được kết nối ở giai đoạn sau.</p></div></section>`;
}
function metric(label,value){return `<article class="summary-card"><span>${label}</span><strong>${value}</strong><small>Chưa kết nối dữ liệu</small></article>`;}
function escapeHtml(value){return String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");}
