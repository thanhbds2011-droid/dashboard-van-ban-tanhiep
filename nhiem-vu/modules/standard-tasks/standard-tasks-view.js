import { UserContext } from "../../core/user-context.js";
import { StandardTaskReadService } from "../../services/standard-task-read-service.js";

export async function renderStandardTasksView(outlet) {
  const user = UserContext.requireUser();
  outlet.innerHTML = loadingCard("Đang tải danh mục công việc chuẩn…");
  try {
    const items = await StandardTaskReadService.list();
    const summary = StandardTaskReadService.summarize(items);
    outlet.innerHTML = `<section class="page-card"><div class="page-header"><div><span class="page-eyebrow">DANH MỤC CHUẨN • READ ONLY</span><h2>Danh mục công việc</h2><p>Dữ liệu thật đồng bộ từ Google Sheet sang Firestore.</p></div><button id="btnStandardRefresh" class="secondary-button" type="button">↻ Làm mới</button></div>
      <div class="info-banner">Phạm vi đang đọc: <strong>${escapeHtml(user.departmentId || "Toàn hệ thống")}</strong>. Tổng cộng <strong>${summary.total}</strong> đầu việc hoạt động.</div>
      <div class="summary-grid compact-grid">${metric("Tổng đầu việc",summary.total)}${metric("Thường xuyên",summary.regular)}${metric("Đột xuất",summary.unexpected)}${metric("Điểm tối đa bình quân",formatNumber(summary.averageMaximumScore))}</div>
      <div class="toolbar"><label class="field-grow"><span>Tìm kiếm</span><input id="standardTaskSearch" type="search" placeholder="Tìm mã, tên, sản phẩm đầu ra…"></label><label><span>Loại công việc</span><select id="standardTaskType"><option value="ALL">Tất cả loại</option><option value="THUONG_XUYEN">Thường xuyên</option><option value="DOT_XUAT">Đột xuất</option></select></label></div>
      <div id="standardTaskListContainer">${renderList(items)}</div>
    </section>`;
    const search=document.getElementById("standardTaskSearch");
    const type=document.getElementById("standardTaskType");
    const apply=()=>{const keyword=String(search?.value||"").trim().toLowerCase();const selected=type?.value||"ALL";const filtered=items.filter(item=>{const text=[item.code,item.name,item.outputRequirement,item.mandatoryEvidence,item.departmentId].join(" ").toLowerCase();return(!keyword||text.includes(keyword))&&(selected==="ALL"||String(item.workType||"").toUpperCase()===selected);});document.getElementById("standardTaskListContainer").innerHTML=renderList(filtered);};
    search?.addEventListener("input",apply);type?.addEventListener("change",apply);document.getElementById("btnStandardRefresh")?.addEventListener("click",()=>window.dispatchEvent(new HashChangeEvent("hashchange")));
  } catch(error){outlet.innerHTML=errorCard("Không thể tải danh mục công việc",error);}
}
function renderList(items){if(!items.length)return `<div class="empty-state"><div class="empty-icon">📁</div><strong>Không có đầu việc phù hợp</strong></div>`;return `<div class="data-list">${items.map(item=>`<article class="data-row"><div class="data-row-main"><strong>${escapeHtml(item.code||item.id)} — ${escapeHtml(item.name||"")}</strong><small>${escapeHtml(item.outputRequirement||"")}</small></div><div class="data-row-meta"><span class="status-pill neutral">${String(item.workType||"").toUpperCase()==="DOT_XUAT"?"Đột xuất":"Thường xuyên"}</span><small>Điểm tối đa: ${formatNumber(item.maximumConvertedScore||0)}</small></div></article>`).join("")}</div>`;}
function metric(label,value){return `<article class="summary-card"><span>${label}</span><strong>${value}</strong><small>Dữ liệu thật</small></article>`;}
function formatNumber(value){return new Intl.NumberFormat("vi-VN",{maximumFractionDigits:1}).format(Number(value||0));}
function loadingCard(message){return `<section class="page-card"><div class="empty-state"><div class="empty-icon">⏳</div><strong>${escapeHtml(message)}</strong></div></section>`;}
function errorCard(title,error){return `<section class="page-card error-card"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(error?.message||"Lỗi không xác định")}</p></section>`;}
function escapeHtml(value){return String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");}
