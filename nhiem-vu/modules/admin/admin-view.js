import { UserContext } from "../../core/user-context.js";
import { Permissions } from "../../core/permissions.js";
import { ToastService } from "../../core/toast-service.js";
import { ModalService } from "../../core/modal-service.js";
export async function renderAdminView(outlet){
 const user=UserContext.requireUser();
 if(!Permissions.isAdmin()) return renderDenied(outlet,user);
 outlet.innerHTML=`<section class="page-card"><div class="page-header"><div><span class="page-eyebrow">QUẢN TRỊ HỆ THỐNG</span><h2>Trung tâm quản trị</h2><p>Quản lý kỳ, kiểm tra dữ liệu và nhật ký hệ thống.</p></div><span class="role-badge">ADMIN</span></div>
 <div class="success-banner">Tài khoản <strong>${escapeHtml(user.fullName||user.email)}</strong> có quyền quản trị.</div>
 <div class="summary-grid compact-grid">${metric("Kỳ đang hoạt động","0")}${metric("Tài khoản hoạt động","—")}${metric("Đầu việc chuẩn","—")}${metric("Cảnh báo dữ liệu","0")}</div>
 <div class="admin-tools-grid"><a class="admin-action-card" href="#/kpi/periods"><span>🗓️</span><strong>Quản lý kỳ đánh giá</strong><small>Tạo, mở và kết thúc kỳ.</small></a><button id="btnAdminCheckData" class="admin-action-card" type="button"><span>🔍</span><strong>Kiểm tra dữ liệu</strong><small>Phát hiện dữ liệu thiếu hoặc không hợp lệ.</small></button><button id="btnAdminAudit" class="admin-action-card" type="button"><span>📜</span><strong>Nhật ký hệ thống</strong><small>Theo dõi thao tác quan trọng.</small></button><button id="btnAdminCleanup" class="admin-action-card danger" type="button"><span>🗑️</span><strong>Xóa dữ liệu kỳ</strong><small>Chỉ dùng sau khi lưu hồ sơ giấy.</small></button></div>
 <div class="warning-banner">Production 3B.2 chưa ghi hoặc xóa dữ liệu thật. Firestore Rules vẫn là lớp bảo vệ cuối cùng.</div></section>`;
 document.getElementById("btnAdminCheckData")?.addEventListener("click",()=>ToastService.info("Kiểm tra dữ liệu sẽ được kết nối ở phiên bản quản trị."));
 document.getElementById("btnAdminAudit")?.addEventListener("click",()=>ToastService.info("Nhật ký hệ thống chưa kết nối kpiAuditLogs."));
 document.getElementById("btnAdminCleanup")?.addEventListener("click",async()=>{const ok=await ModalService.open({title:"Xóa dữ liệu kỳ",message:"Production 3B.2 chỉ mô phỏng giao diện và không xóa dữ liệu thật.",confirmText:"Đã hiểu",showCancel:false,danger:true}); if(ok) ToastService.warning("Không có dữ liệu nào bị xóa.");});
}
function renderDenied(outlet,user){outlet.innerHTML=`<section class="page-card"><div class="empty-state"><div class="empty-icon">🔒</div><strong>Không có quyền truy cập</strong><p>Tài khoản ${escapeHtml(user.fullName||user.email)} không có vai trò ADMIN.</p><a class="secondary-button" href="#/dashboard">Quay về Trang chủ</a></div></section>`;}
function metric(label,value){return `<article class="summary-card"><span>${label}</span><strong>${value}</strong><small>Chưa kết nối dữ liệu</small></article>`;}
function escapeHtml(value){return String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");}
