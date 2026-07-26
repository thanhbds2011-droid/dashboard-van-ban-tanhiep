import { UserContext } from "../../core/user-context.js";
import { Permissions } from "../../core/permissions.js";
import { ToastService } from "../../core/toast-service.js";
import { ModalService } from "../../core/modal-service.js";
import { AdminReadService } from "../../services/admin-read-service.js";
import { FirebaseService } from "../../core/firebase-service.js";
export async function renderAdminView(outlet){const user=UserContext.requireUser();if(!Permissions.isAdmin())return renderDenied(outlet,user);outlet.innerHTML=loadingCard("Đang tải thống kê quản trị…");try{const summary=await AdminReadService.summary();outlet.innerHTML=`<section class="page-card"><div class="page-header"><div><span class="page-eyebrow">QUẢN TRỊ HỆ THỐNG</span><h2>Trung tâm quản trị</h2><p>Quản lý kỳ đánh giá, tài khoản và dữ liệu nghiệp vụ.</p></div><span class="role-badge">ADMIN</span></div><div class="success-banner">Tài khoản <strong>${escapeHtml(user.fullName||user.email)}</strong> có quyền quản trị.</div><div class="summary-grid compact-grid">${metric("Kỳ đánh giá",display(summary.periods))}${metric("Tài khoản hoạt động",display(summary.activeUsers))}${metric("Đầu việc chuẩn",display(summary.activeStandardTasks))}${metric("Thông tin cần kiểm tra",summary.warnings.length)}</div><div class="admin-tools-grid"><a class="admin-action-card" href="#/kpi/periods"><span>🗓️</span><strong>Quản lý kỳ đánh giá</strong><small>Tạo, sửa, kích hoạt và kết thúc kỳ đánh giá.</small></a><button id="btnAdminCheckData" class="admin-action-card" type="button"><span>🔍</span><strong>Kiểm tra dữ liệu</strong><small>Kiểm tra tình trạng dữ liệu nghiệp vụ.</small></button><button id="btnAdminAudit" class="admin-action-card" type="button"><span>📜</span><strong>Nhật ký hệ thống</strong><small>Xem 100 hoạt động KPI gần nhất.</small></button><a class="admin-action-card danger" href="#/kpi/periods"><span>🗑️</span><strong>Xóa dữ liệu kỳ</strong><small>Mở Quản lý kỳ để kết thúc hoặc xóa vĩnh viễn dữ liệu kỳ.</small></a></div>${summary.warnings.length?`<div class="warning-banner">Một số thông tin chưa truy cập được. Vui lòng kiểm tra quyền tài khoản.</div>`:'<div class="success-banner">Dữ liệu quản trị đã sẵn sàng.</div>'}</section>`;document.getElementById("btnAdminCheckData")?.addEventListener("click",()=>ToastService.success("Đã kiểm tra dữ liệu nền."));document.getElementById("btnAdminAudit")?.addEventListener("click",openAuditLog);}catch(error){outlet.innerHTML=errorCard("Không thể tải dữ liệu quản trị",error);}}

async function openAuditLog(){
  try{
    ToastService.info("Đang tải nhật ký…",1200);
    const ref=FirebaseService.collection(FirebaseService.db,"kpiAuditLogs");
    const snap=await FirebaseService.getDocs(FirebaseService.query(ref,FirebaseService.orderBy("performedAt","desc"),FirebaseService.limit(100)));
    const rows=snap.docs.map(d=>({id:d.id,...d.data()}));
    const overlay=document.createElement("div");
    overlay.className="modal-overlay modal-visible";
    overlay.innerHTML=`<section class="modal-card admin-audit-modal" role="dialog" aria-modal="true"><div class="modal-header"><div><span class="page-eyebrow">NHẬT KÝ HỆ THỐNG</span><h2>100 hoạt động KPI gần nhất</h2></div><button class="modal-x" type="button">×</button></div><div class="modal-body"><div class="admin-audit-list">${rows.length?rows.map(item=>`<article class="admin-audit-row"><strong>${escapeHtml(actionLabel(item.action))}</strong><span>${escapeHtml(item.performedByName||item.performedByUserId||"")}</span><small>${escapeHtml(formatTime(item.performedAt))} · Kỳ ${escapeHtml(item.periodId||"—")}</small></article>`).join(""):'<div class="empty-state"><strong>Chưa có nhật ký KPI.</strong></div>'}</div></div><div class="modal-actions"><button class="primary-button" data-close-audit type="button">Đóng</button></div></section>`;
    const close=()=>overlay.remove();
    overlay.querySelector(".modal-x")?.addEventListener("click",close);
    overlay.querySelector("[data-close-audit]")?.addEventListener("click",close);
    overlay.addEventListener("click",e=>{if(e.target===overlay)close();});
    document.body.appendChild(overlay);
  }catch(error){
    ToastService.error(error?.code==="permission-denied"?"Tài khoản chưa được phép đọc nhật ký hệ thống.":(error.message||"Không tải được nhật ký."));
  }
}
function actionLabel(action){return ({CREATE_PERIOD:"Tạo kỳ",UPDATE_PERIOD:"Cập nhật kỳ",ACTIVATE_PERIOD:"Kích hoạt kỳ",COMPLETE_PERIOD:"Kết thúc kỳ",LOCK_DEPARTMENT_PLAN:"Khóa kế hoạch",SUBMIT_SELF_ASSESSMENT:"Gửi tự đánh giá",CONFIRM_TASK_SCORE:"Xác nhận điểm nhiệm vụ",SAVE_COMMON_CRITERIA:"Lưu tiêu chí chung",CONFIRM_COMMON_CRITERIA:"Xác nhận tiêu chí chung",APPROVE_PLAN_TASK:"Duyệt kế hoạch",REJECT_PLAN_TASK:"Trả lại kế hoạch"})[String(action||"")]||String(action||"Hoạt động");}
function formatTime(value){try{const date=value?.toDate?value.toDate():new Date(value);return new Intl.DateTimeFormat("vi-VN",{dateStyle:"short",timeStyle:"short"}).format(date);}catch{return "";}}

function renderDenied(outlet,user){outlet.innerHTML=`<section class="page-card"><div class="empty-state"><div class="empty-icon">🔒</div><strong>Không có quyền truy cập</strong><p>Tài khoản ${escapeHtml(user.fullName||user.email)} không có vai trò ADMIN.</p><a class="secondary-button" href="#/dashboard">Quay về Trang chủ</a></div></section>`;}
function metric(label,value){return `<article class="summary-card"><span>${label}</span><strong>${value}</strong></article>`;}
function display(value){return value===null?"—":value;}
function loadingCard(message){return `<section class="page-card"><div class="empty-state"><div class="empty-icon">⏳</div><strong>${escapeHtml(message)}</strong></div></section>`;}
function errorCard(title,error){return `<section class="page-card error-card"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(error?.message||"Lỗi không xác định")}</p></section>`;}
function escapeHtml(value){return String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");}
