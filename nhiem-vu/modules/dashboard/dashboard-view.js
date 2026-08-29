import { UserContext } from "../../core/user-context.js?v=20260829.V1_20_0";
import { Permissions } from "../../core/permissions.js?v=20260829.V1_20_0";
import { ToastService } from "../../core/toast-service.js?v=20260829.V1_20_0";
import { DashboardReadService } from "../../services/dashboard-read-service.js?v=20260829.V1_20_0";
import { TaskReadService } from "../../services/task-read-service.js?v=20260829.V1_20_0";
let currentData = null;
let dashboardRenderSequence = 0;
let dashboardDepartmentScope = "ALL";
let stopDashboardRealtime = null;
let dashboardRealtimeCleanupBound = false;

const DEPARTMENT_NAMES = Object.freeze({
  BGD: "Ban Giám đốc",
  TCHC: "Phòng Tổ chức - Hành chính",
  CTXH: "Phòng Công tác xã hội",
  KHTC: "Phòng Kế hoạch - Tài chính",
  YT: "Phòng Y tế",
  KI: "Khu I",
  KII: "Khu II",
  KIII: "Khu III",
  CDTN: "Chi đoàn Trung tâm"
});


const ADDITIONAL_ROLE_NAMES = Object.freeze({
  CDTN_BI_THU: "Bí thư Chi đoàn",
  CDTN_PHO_BI_THU: "Phó Bí thư Chi đoàn",
  CDTN_UY_VIEN_BCH: "Ủy viên BCH Chi đoàn",
  CDTN_DOAN_VIEN: "Đoàn viên Chi đoàn"
});

function professionalLine(user = {}) {
  const department = DEPARTMENT_NAMES[String(user.departmentId || "").toUpperCase()] || String(user.departmentId || "").trim();
  const position = String(user.position || formatRole(user.role) || "").trim();
  const professional = [position, department].filter(Boolean).join(" ").trim();
  const additional = [...new Set((Array.isArray(user.additionalRoles) ? user.additionalRoles : [])
    .map(role => ADDITIONAL_ROLE_NAMES[String(role || "").toUpperCase()])
    .filter(Boolean))];
  return [professional, ...additional].filter(Boolean).join(", ") || "Chưa cập nhật chức danh và đơn vị";
}

function stopDashboardTaskRealtime() {
  try { stopDashboardRealtime?.(); } catch (_) { /* Đóng listener an toàn. */ }
  stopDashboardRealtime = null;
}

function bindDashboardRealtimeCleanup() {
  if (dashboardRealtimeCleanupBound) return;
  dashboardRealtimeCleanupBound = true;
  document.addEventListener("v3:route-changed", event => {
    if (event.detail?.route !== "#/dashboard") stopDashboardTaskRealtime();
  });
}

function startDashboardTaskRealtime(outlet, sequence) {
  stopDashboardTaskRealtime();
  bindDashboardRealtimeCleanup();
  stopDashboardRealtime = TaskReadService.subscribe(
    tasks => {
      if (sequence !== dashboardRenderSequence || window.location.hash !== "#/dashboard" || !outlet.isConnected) return;
      currentData = { ...(currentData || {}), tasks };
      updateDashboard(currentData);
      const live = document.getElementById("dashboardRealtimeState");
      if (live) {
        live.textContent = "Đang đồng bộ trực tiếp";
        live.classList.add("is-live");
      }
    },
    error => console.warn("Không thể đồng bộ trang chủ trực tiếp:", error),
    { startDelayMs: 90 * 1000, jitterMs: 30 * 1000 }
  );
}

export async function renderDashboardView(outlet) {
  const sequence = ++dashboardRenderSequence;
  const user = UserContext.requireUser();
  outlet.innerHTML = loadingCard("Đang tải dữ liệu trang chủ…");

  try {
    currentData = await DashboardReadService.load({ force: false });
    if (sequence !== dashboardRenderSequence || window.location.hash !== "#/dashboard") return;
    mountDashboard(outlet, user);
    updateDashboard(currentData);
    startDashboardTaskRealtime(outlet, sequence);
  } catch (error) {
    outlet.innerHTML = errorCard("Không thể tải trang chủ", error);
  }
}

function mountDashboard(outlet, user) {
  outlet.innerHTML = `
    <section class="page-card">
      <div class="page-header"><div><h2>Tổng quan</h2><p>Theo dõi nhiệm vụ và kỳ đánh giá theo phạm vi tài khoản.</p><small id="dashboardRealtimeState" class="realtime-state kpi-hidden"></small></div><div class="dashboard-header-actions">${Permissions.canViewAllDepartments() ? '<label class="dashboard-department-filter"><span>Phòng/Khu</span><select id="dashboardDepartmentFilter"><option value="ALL">Toàn Trung tâm</option></select></label>' : ''}<button id="btnDashboardRefresh" class="secondary-button compact-sync-button" type="button" title="Cập nhật dữ liệu" aria-label="Cập nhật dữ liệu">↻</button></div></div>
      <section class="welcome-panel"><div><span class="welcome-label">Xin chào</span><h3>Đồng chí ${escapeHtml(user.fullName || "Người dùng")}</h3><p>${escapeHtml(professionalLine(user))}</p></div><span class="role-badge">${escapeHtml(formatRole(user.role))}</span></section>
      <div class="dashboard-period-inline"><span>Kỳ KPI hiện tại</span><strong id="dashboardPeriod">—</strong><small id="dashboardPeriodNote">Chưa có kỳ hoạt động</small></div>
      <div class="summary-grid dashboard-summary-grid">
        ${metric("Nhiệm vụ đang xử lý", 0, "Đang thực hiện", "blue", "dashboardInProgress")}
        ${metric("Sắp đến hạn", 0, "Trong 72 giờ", "amber", "dashboardDueSoon")}
        ${metric("Trễ hạn", 0, "Đã quá hạn", "red", "dashboardOverdue")}
        ${metric("Hoàn thành", 0, "Trong phạm vi", "green", "dashboardCompleted")}
        ${metric("Chờ duyệt điều chỉnh", 0, "Đang chờ xử lý", "amber", "dashboardAdjustmentPending")}
        ${metric("Miễn đánh giá", 0, "Không tính KPI", "violet", "dashboardExempt")}
      </div>
      ${Permissions.canViewAllDepartments() ? '<section class="dashboard-department-overview"><div class="section-heading"><div><h3>Theo dõi theo Phòng/Khu</h3><p>Chọn Phòng/Khu ở phía trên hoặc xem nhanh số nhiệm vụ theo từng đơn vị.</p></div></div><div id="dashboardDepartmentBreakdown" class="dashboard-department-grid"></div></section>' : ''}
      <div id="dashboardWarning"></div>
    </section>`;

  document.getElementById("btnDashboardRefresh")?.addEventListener("click", refreshDashboard);
  document.getElementById("dashboardDepartmentFilter")?.addEventListener("change", event => {
    dashboardDepartmentScope = event.target.value || "ALL";
    updateDashboard(currentData || {});
  });
}

async function refreshDashboard() {
  const button = document.getElementById("btnDashboardRefresh");
  if (button) button.disabled = true;
  try {
    currentData = await DashboardReadService.load({ force: true });
    updateDashboard(currentData);
  } catch (error) {
    ToastService.error("Không thể cập nhật trang chủ vào lúc này. Vui lòng kiểm tra kết nối và thử lại.");
  } finally {
    if (button) button.disabled = false;
  }
}

function updateDashboard(data) {
  const allTasks = Array.isArray(data.tasks) ? data.tasks : [];
  const departments = [...new Set(allTasks.map(task => String(task.primaryDepartmentId || "").toUpperCase()).filter(Boolean))]
    .sort((a, b) => (DEPARTMENT_NAMES[a] || a).localeCompare(DEPARTMENT_NAMES[b] || b, "vi"));
  const filter = document.getElementById("dashboardDepartmentFilter");
  if (filter) {
    const current = dashboardDepartmentScope;
    filter.innerHTML = `<option value="ALL">Toàn Trung tâm</option>${departments.map(id => `<option value="${escapeHtml(id)}">${escapeHtml(DEPARTMENT_NAMES[id] || id)}</option>`).join("")}`;
    dashboardDepartmentScope = departments.includes(current) ? current : "ALL";
    filter.value = dashboardDepartmentScope;
  }
  const tasks = dashboardDepartmentScope === "ALL"
    ? allTasks
    : allTasks.filter(task => String(task.primaryDepartmentId || "").toUpperCase() === dashboardDepartmentScope);
  const summary = TaskReadService.summarize(tasks);
  const period = data.activePeriod || null;
  setText("dashboardInProgress", summary.inProgress);
  setText("dashboardDueSoon", summary.dueSoon);
  setText("dashboardOverdue", summary.overdue);
  setText("dashboardCompleted", summary.completed);
  setText("dashboardAdjustmentPending", summary.adjustmentPending || 0);
  setText("dashboardExempt", summary.exempt || 0);
  setText("dashboardPeriod", period ? period.name || period.code || period.id : "—");
  setText("dashboardPeriodNote", period ? formatPeriodStatus(period._status) : "Chưa có kỳ hoạt động");
  setText("dashboardTaskQuick", `${summary.total} nhiệm vụ trong phạm vi`);
  setText("dashboardStandardQuick", "Mở phân hệ để tải danh mục");
  setText("dashboardKpiQuick", period ? "Đã nhận diện kỳ hoạt động" : "Chưa có kỳ hoạt động");
  setText("dashboardTaskStatus", `${tasks.length} nhiệm vụ${dashboardDepartmentScope === "ALL" ? "" : ` · ${DEPARTMENT_NAMES[dashboardDepartmentScope] || dashboardDepartmentScope}`}`);
  setText("dashboardStandardStatus", "Chỉ tải khi mở phân hệ");
  setText("dashboardPeriodStatus", `${data.periods?.length || 0} kỳ`);

  const breakdown = document.getElementById("dashboardDepartmentBreakdown");
  if (breakdown) {
    breakdown.innerHTML = departments.map(departmentId => {
      const departmentTasks = allTasks.filter(task => String(task.primaryDepartmentId || "").toUpperCase() === departmentId);
      const departmentSummary = TaskReadService.summarize(departmentTasks);
      return `<button type="button" class="dashboard-department-card ${dashboardDepartmentScope === departmentId ? "is-active" : ""}" data-dashboard-department="${escapeHtml(departmentId)}"><strong>${escapeHtml(DEPARTMENT_NAMES[departmentId] || departmentId)}</strong><span>${departmentSummary.total} nhiệm vụ</span><small>${departmentSummary.inProgress} đang xử lý · ${departmentSummary.overdue} trễ hạn · ${departmentSummary.completed} hoàn thành</small></button>`;
    }).join("") || '<div class="task-history-empty">Chưa có nhiệm vụ theo Phòng/Khu trong kỳ hiện tại.</div>';
    breakdown.querySelectorAll("[data-dashboard-department]").forEach(button => button.addEventListener("click", () => {
      dashboardDepartmentScope = button.dataset.dashboardDepartment || "ALL";
      updateDashboard(currentData || {});
    }));
  }

  const warning = document.getElementById("dashboardWarning");
  if (warning) {
    warning.innerHTML = data.warnings?.length
      ? `<div class="warning-banner"><strong>Có dữ liệu chưa tải được:</strong><br>${data.warnings.map(escapeHtml).join("<br>")}</div>`
      : "";
  }
}

function setText(id, value) { const target = document.getElementById(id); if (target) target.textContent = String(value); }
function loadingCard(message){return `<section class="page-card"><div class="empty-state"><div class="empty-icon">⏳</div><strong>${escapeHtml(message)}</strong></div></section>`;}
function errorCard(title,error){return `<section class="page-card error-card"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(error?.message || "Lỗi không xác định")}</p></section>`;}
function metric(label,value,note,tone,id,noteId=""){return `<article class="summary-card tone-${tone}"><span>${label}</span><strong id="${id}">${value}</strong><small${noteId?` id="${noteId}"`:""}>${note}</small></article>`;}
function quick(href,icon,title,note){return `<a class="quick-action-card" href="${href}"><span class="quick-icon">${icon}</span><span><strong>${title}</strong><small>${note}</small></span><b>→</b></a>`;}
function status(label,value,type){return `<div><dt>${label}</dt><dd class="status-${type}">${value}</dd></div>`;}
function formatPeriodStatus(status){return ({DRAFT:"Dự thảo",OPEN:"Đang mở",IN_PROGRESS:"Đang thực hiện",ASSESSMENT:"Đang đánh giá",REPORTING:"Đang báo cáo",COMPLETED:"Hoàn tất"})[status] || status || "Chưa xác định";}
function formatRole(role){return ({ADMIN:"Quản trị viên",DIRECTOR:"Ban Giám đốc",DEPARTMENT_LEADER:"Trưởng/Phó phòng, khu",TCHC_COORDINATOR:"Đầu mối TCHC",STAFF:"Viên chức"})[String(role||"").toUpperCase()] || role || "Người dùng";}
function escapeHtml(value){return String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");}
