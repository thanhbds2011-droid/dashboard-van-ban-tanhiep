import { UserContext } from "../../core/user-context.js";
export async function renderStandardTasksView(outlet) {
  const user=UserContext.requireUser();
  outlet.innerHTML=`<section class="page-card"><div class="page-header"><div><span class="page-eyebrow">DANH MỤC CHUẨN</span><h2>Danh mục công việc</h2><p>Dữ liệu đồng bộ từ Google Sheet qua Firestore; ứng dụng chỉ đọc.</p></div><button class="secondary-button" type="button" disabled>↻ Làm mới</button></div>
  <div class="info-banner">Phạm vi mặc định: <strong>${escapeHtml(user.departmentId||"Chưa xác định")}</strong>. ADMIN, Ban Giám đốc và đầu mối TCHC có thể xem toàn bộ khi kết nối dữ liệu thật.</div>
  <div class="summary-grid compact-grid">${metric("Tổng đầu việc","0")}${metric("Thường xuyên","0")}${metric("Đột xuất","0")}${metric("Điểm tối đa bình quân","0")}</div>
  <div class="toolbar"><label class="field-grow"><span>Tìm kiếm</span><input type="search" placeholder="Tìm mã, tên, sản phẩm đầu ra…" disabled></label><label><span>Loại công việc</span><select disabled><option>Tất cả loại</option></select></label><label><span>Phòng/Khu</span><select disabled><option>${escapeHtml(user.departmentId||"Tất cả")}</option></select></label></div>
  <div class="empty-state"><div class="empty-icon">📁</div><strong>Danh mục giao diện đã sẵn sàng</strong><p>Collection standardTasks sẽ được đọc ở phiên bản tiếp theo; không sửa trực tiếp trên ứng dụng.</p></div></section>`;
}
function metric(label,value){return `<article class="summary-card"><span>${label}</span><strong>${value}</strong><small>Chưa kết nối dữ liệu</small></article>`;}
function escapeHtml(value){return String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");}
