import { UserContext } from "../../core/user-context.js";
import { Permissions } from "../../core/permissions.js";
import { ToastService } from "../../core/toast-service.js";
import { StandardTaskReadService } from "../../services/standard-task-read-service.js";
import { TaskRegistrationService } from "../../services/task-registration-service.js";

export async function renderStandardTasksView(outlet) {
  const user = UserContext.requireUser();
  outlet.innerHTML = loadingCard("Đang tải danh mục công việc chuẩn…");
  try {
    const [items, period] = await Promise.all([StandardTaskReadService.list(), TaskRegistrationService.getActivePeriod()]);
    const regularItems = items.filter(item => String(item.workType || "THUONG_XUYEN").toUpperCase() !== "DOT_XUAT");
    const registrations = Permissions.isStaff() && period ? await TaskRegistrationService.listForCurrentUser(period.id) : [];
    const registeredMap = new Map(registrations.map(item => [String(item.standardTaskId || item.standardTaskCode), item]));
    const summary = StandardTaskReadService.summarize(regularItems);
    const staffMode = Permissions.isStaff();
    outlet.innerHTML = `<section class="page-card">
      <div class="page-header"><div><span class="page-eyebrow">DANH MỤC CÔNG VIỆC THEO VỊ TRÍ VIỆC LÀM</span><h2>${staffMode ? "Đăng ký kế hoạch công việc" : "Danh mục công việc"}</h2><p>${staffMode ? "Tick chọn các đầu việc dự kiến thực hiện trong kỳ và gửi Trưởng/Phó phòng duyệt." : "Danh mục chỉ để tra cứu; Trưởng/Phó phòng không giao việc thường xuyên tại đây."}</p></div><button id="btnStandardRefresh" class="secondary-button" type="button">↻ Làm mới</button></div>
      <div class="info-banner">Phạm vi: <strong>${escapeHtml(user.departmentId || "Toàn hệ thống")}</strong>. ${period ? `Kỳ hiện tại: <strong>${escapeHtml(period.name || period.id)}</strong>.` : '<strong>Chưa có kỳ hoạt động.</strong>'}</div>
      <div class="summary-grid compact-grid">${metric("Tổng đầu việc",summary.total)}${metric("Đã đăng ký",registrations.filter(r=>r.status!=="REJECTED").length)}${metric("Chờ duyệt",registrations.filter(r=>r.status==="PENDING").length)}${metric("Đã duyệt",registrations.filter(r=>r.status==="APPROVED").length)}</div>
      <div class="toolbar"><label class="field-grow"><span>Tìm kiếm</span><input id="standardTaskSearch" type="search" placeholder="Tìm mã, tên, sản phẩm đầu ra…"></label></div>
      <div id="standardTaskListContainer">${renderList(regularItems, registeredMap, staffMode, Boolean(period))}</div>
      ${staffMode ? `<div class="registration-sticky"><div><strong>Đã chọn: <span id="registrationSelectedCount">0</span> đầu việc</strong><small>Chỉ các đầu việc chưa đăng ký mới được chọn.</small></div><button id="btnRegisterSelected" class="primary-button" type="button" ${period ? "" : "disabled"}>Đăng ký kế hoạch</button></div>` : ""}
    </section>`;

    let visible = regularItems;
    const search = document.getElementById("standardTaskSearch");
    const apply = () => {
      const keyword = String(search?.value || "").trim().toLowerCase();
      visible = regularItems.filter(item => [item.code,item.name,item.outputRequirement].join(" ").toLowerCase().includes(keyword));
      document.getElementById("standardTaskListContainer").innerHTML = renderList(visible, registeredMap, staffMode, Boolean(period));
      bindChecks();
    };
    const bindChecks = () => {
      document.querySelectorAll("[data-registration-check]").forEach(input => input.addEventListener("change", updateCount));
      updateCount();
    };
    const updateCount = () => {
      const count = document.querySelectorAll("[data-registration-check]:checked").length;
      const target = document.getElementById("registrationSelectedCount");
      if (target) target.textContent = String(count);
    };
    search?.addEventListener("input", apply);
    document.getElementById("btnStandardRefresh")?.addEventListener("click", () => window.dispatchEvent(new HashChangeEvent("hashchange")));
    document.getElementById("btnRegisterSelected")?.addEventListener("click", async () => {
      const ids = [...document.querySelectorAll("[data-registration-check]:checked")].map(input => input.value);
      const selected = regularItems.filter(item => ids.includes(String(item.id || item.code)));
      if (!selected.length) return ToastService.error("Hãy tick ít nhất một đầu việc.");
      const button = document.getElementById("btnRegisterSelected");
      button.disabled = true;
      try {
        const count = await TaskRegistrationService.registerMany(selected, period);
        ToastService.success(`Đã gửi đăng ký ${count} đầu việc chờ duyệt.`);
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      } catch (error) { ToastService.error(error.message || "Không đăng ký được đầu việc."); button.disabled = false; }
    });
    bindChecks();
  } catch(error){ outlet.innerHTML = errorCard("Không thể tải danh mục công việc",error); }
}

function renderList(items, registeredMap, staffMode, hasPeriod) {
  if (!items.length) return `<div class="empty-state"><div class="empty-icon">📁</div><strong>Không có đầu việc phù hợp</strong></div>`;
  return `<div class="registration-list">${items.map(item => {
    const key = String(item.id || item.code);
    const reg = registeredMap.get(key) || registeredMap.get(String(item.code));
    const disabled = !staffMode || !hasPeriod || Boolean(reg && reg.status !== "REJECTED");
    const status = reg ? ({PENDING:"Chờ duyệt",APPROVED:"Đã duyệt",REJECTED:"Đã trả lại"}[reg.status] || reg.status) : "Chưa đăng ký";
    return `<article class="registration-row">
      ${staffMode ? `<label class="registration-check"><input type="checkbox" data-registration-check value="${escapeHtml(key)}" ${disabled ? "disabled" : ""}><span></span></label>` : ""}
      <div class="data-row-main"><strong>${escapeHtml(item.code||item.id)} — ${escapeHtml(item.name||"")}</strong><small>${escapeHtml(item.outputRequirement||"")}</small>${reg?.rejectionReason ? `<small class="text-danger">Lý do trả lại: ${escapeHtml(reg.rejectionReason)}</small>` : ""}</div>
      <div class="data-row-meta"><span class="status-pill ${reg?.status==="APPROVED"?"success":reg?.status==="PENDING"?"warning":reg?.status==="REJECTED"?"danger":"neutral"}">${escapeHtml(status)}</span><small>Điểm tối đa: ${formatNumber(item.maximumConvertedScore||0)}</small></div>
    </article>`;
  }).join("")}</div>`;
}
function metric(label,value){return `<article class="summary-card"><span>${label}</span><strong>${value}</strong><small>Dữ liệu thật</small></article>`;}
function formatNumber(value){return new Intl.NumberFormat("vi-VN",{maximumFractionDigits:1}).format(Number(value||0));}
function loadingCard(message){return `<section class="page-card"><div class="empty-state"><div class="empty-icon">⏳</div><strong>${escapeHtml(message)}</strong></div></section>`;}
function errorCard(title,error){return `<section class="page-card error-card"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(error?.message||"Lỗi không xác định")}</p></section>`;}
function escapeHtml(value){return String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");}
