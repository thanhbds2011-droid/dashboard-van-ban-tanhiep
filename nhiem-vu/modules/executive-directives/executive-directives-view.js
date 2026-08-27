import { UserContext } from "../../core/user-context.js?v=20260826.V1_19_0";
import { Permissions } from "../../core/permissions.js?v=20260826.V1_19_0";
import { ToastService } from "../../core/toast-service.js?v=20260826.V1_19_0";
import { ModalService } from "../../core/modal-service.js?v=20260826.V1_19_0";
import { DepartmentReadService } from "../../services/department-read-service.js?v=20260826.V1_19_0";
import { UserReadService } from "../../services/user-read-service.js?v=20260826.V1_19_0";
import { ExecutiveDirectiveService } from "../../services/executive-directive-service.js?v=20260826.V1_19_0";

let state = {
  directives: [],
  updates: [],
  departments: [],
  users: [],
  tab: "overview",
  search: "",
  status: "ALL",
  department: "ALL",
  stopRealtime: null,
  report: null
};
let renderSequence = 0;
let cleanupBound = false;
let directiveRefreshPromise = null;
let lastDirectiveRefreshAt = 0;
const DIRECTIVE_REFRESH_COOLDOWN_MS = 8000;

const SOURCE_LABELS = Object.freeze({
  MEETING_WEEKLY: "Họp giao ban",
  MEETING_OTHER: "Cuộc họp khác",
  DIRECT: "Chỉ đạo trực tiếp",
  PHONE: "Điện thoại",
  DOCUMENT: "Văn bản",
  OTHER: "Khác"
});
const PRIORITY_LABELS = Object.freeze({ NORMAL: "Bình thường", URGENT: "Khẩn", VERY_URGENT: "Rất khẩn" });
const STATUS_LABELS = Object.freeze({
  NOT_STARTED: "Chưa thực hiện",
  ACCEPTED: "Đã tiếp nhận",
  IN_PROGRESS: "Đang thực hiện",
  COMPLETED: "Hoàn thành",
  PAUSED: "Tạm dừng"
});

function clean(value) { return String(value ?? "").trim(); }
function upper(value) { return clean(value).toUpperCase(); }
function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function localDateKey(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}
function parseDateKey(value) {
  const [y, m, d] = clean(value).split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d, 12, 0, 0, 0) : null;
}
function addDays(dateKey, days) {
  const date = parseDateKey(dateKey);
  if (!date) return "";
  date.setDate(date.getDate() + Number(days || 0));
  return localDateKey(date);
}
function mondayOf(dateKey) {
  const date = parseDateKey(dateKey) || new Date();
  const day = date.getDay();
  const delta = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + delta);
  return localDateKey(date);
}
function defaultReportWeekStart() {
  const today = localDateKey();
  const date = parseDateKey(today);
  const currentMonday = mondayOf(today);
  return date?.getDay() === 1 ? addDays(currentMonday, -7) : currentMonday;
}
function formatDate(value) {
  const date = parseDateKey(value);
  return date ? new Intl.DateTimeFormat("vi-VN").format(date) : "—";
}
function normalizeText(value) {
  return clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
}
function departmentName(id) {
  const key = upper(id);
  const item = state.departments.find(d => upper(d.id || d.code) === key);
  return item?.name || item?.departmentName || key || "Chưa xác định";
}
function targetDepartments() {
  return state.departments.filter(item => !["BGD", "CDTN"].includes(upper(item.id || item.code)));
}
function directorUsers() {
  return state.users
    .filter(user => user.active !== false)
    .filter(user => upper(user.role) === "DIRECTOR" && upper(user.departmentId) === "BGD")
    .sort((a, b) => clean(a.fullName || a.email).localeCompare(clean(b.fullName || b.email), "vi"));
}

function directorLabel(user) {
  const name = clean(user?.fullName || user?.email || "");
  const position = clean(user?.position || "");
  return position ? `${name} - ${position}` : name;
}
const TEAM_LABELS = Object.freeze({
  BAO_VE: "Tổ Bảo vệ",
  DIEN_NUOC: "Tổ Điện nước",
  HAU_CAN: "Tổ Hậu cần"
});
function assignmentText(directive) {
  return "Giao cấp Phòng/Khu";
}
function canAcceptDepartmentUi(directive, departmentId, user = UserContext.requireUser()) {
  return ExecutiveDirectiveService.canAcceptDepartment(directive, departmentId);
}
function canProgressDepartmentUi(directive, departmentId) {
  return ExecutiveDirectiveService.canProgressDepartment(directive, departmentId);
}
function directiveUpdates(directiveId, departmentId = "", endDateKey = "9999-12-31") {
  const dep = upper(departmentId);
  return state.updates
    .filter(item => item.directiveId === directiveId)
    .filter(item => !dep || upper(item.departmentId) === dep)
    .filter(item => clean(item.actionDateKey || "0000-00-00") <= endDateKey)
    .sort((a, b) => {
      const dateCompare = clean(b.actionDateKey).localeCompare(clean(a.actionDateKey));
      if (dateCompare) return dateCompare;
      return (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0);
    });
}
function latestAcceptance(directive, departmentId = "", endDateKey = "9999-12-31") {
  const dep = upper(departmentId || directive.leadDepartmentId);
  const updates = directiveUpdates(directive.id, dep, endDateKey);
  const explicit = updates.find(item => upper(item.updateType) === "ACCEPTED");
  if (explicit) return explicit;
  // Nhân viên V1.11.1 chỉ được đọc lịch sử gắn assignedUserId của chính mình.
  // INTERNAL_ASSIGNED/PERSON_ACCEPTED/PROGRESS chỉ có thể tồn tại sau khi Phòng/Khu đã tiếp nhận,
  // nên dùng chúng để suy ra trạng thái ACCEPTED mà không mở rộng quyền đọc toàn bộ lịch sử đơn vị.
  const implied = updates.find(item => ["INTERNAL_ASSIGNED", "PERSON_ACCEPTED", "PROGRESS"].includes(upper(item.updateType)));
  return implied ? { ...implied, updateType: "ACCEPTED", inferred: true } : null;
}
function latestProgress(directive, departmentId = "", endDateKey = "9999-12-31") {
  const dep = upper(departmentId || directive.leadDepartmentId);
  return directiveUpdates(directive.id, dep, endDateKey).find(item => upper(item.updateType) === "PROGRESS") || null;
}
function latestInternalAssignment(directive, departmentId = "", endDateKey = "9999-12-31") {
  const dep = upper(departmentId || directive.leadDepartmentId);
  return directiveUpdates(directive.id, dep, endDateKey).find(item => upper(item.updateType) === "INTERNAL_ASSIGNED") || null;
}
function latestPersonalAcceptance(directive, departmentId = "", endDateKey = "9999-12-31") {
  const dep = upper(departmentId || directive.leadDepartmentId);
  const assignment = latestInternalAssignment(directive, dep, endDateKey);
  if (!assignment) return null;
  return directiveUpdates(directive.id, dep, endDateKey).find(item =>
    upper(item.updateType) === "PERSON_ACCEPTED"
    && (!clean(item.assignmentUpdateId) || clean(item.assignmentUpdateId) === clean(assignment.id))
  ) || null;
}
function isAssignedToCurrentUser(directive, departmentId = "", user = UserContext.requireUser()) {
  const assignment = latestInternalAssignment(directive, departmentId);
  return Boolean(assignment && clean(assignment.assignedUserId) === clean(user.uid));
}
function canAssignInternalUi(directive, departmentId = "", user = UserContext.requireUser()) {
  const dep = upper(departmentId || user.departmentId);
  if (!latestAcceptance(directive, dep)) return false;
  if (upper(latestProgress(directive, dep)?.status) && upper(latestProgress(directive, dep)?.status) !== "ACCEPTED") return false;
  return dep === upper(user.departmentId) && isDepartmentLeaderLike(user);
}
function statusFor(directive, departmentId = "", endDateKey = localDateKey()) {
  const latest = latestProgress(directive, departmentId, endDateKey);
  const accepted = latestAcceptance(directive, departmentId, endDateKey);
  const base = upper(latest?.status || "NOT_STARTED");
  if (base === "COMPLETED") return { code: "COMPLETED", label: STATUS_LABELS.COMPLETED, tone: "completed", latest, accepted };
  if (base === "PAUSED" || upper(directive.lifecycleStatus) === "CLOSED") return { code: "PAUSED", label: STATUS_LABELS.PAUSED, tone: "paused", latest, accepted };
  const due = clean(directive.dueDateKey);
  if (due && due < endDateKey) return { code: "OVERDUE", label: "Quá hạn", tone: "overdue", latest, accepted };
  if (base === "IN_PROGRESS") return { code: "IN_PROGRESS", label: STATUS_LABELS.IN_PROGRESS, tone: "progress", latest, accepted };
  if (accepted) return { code: "ACCEPTED", label: STATUS_LABELS.ACCEPTED, tone: "accepted", latest, accepted };
  return { code: "NOT_STARTED", label: STATUS_LABELS.NOT_STARTED, tone: "new", latest, accepted };
}
function roleForDepartment(directive, departmentId) {
  const dep = upper(departmentId);
  if (upper(directive.leadDepartmentId) === dep) return "Chủ trì";
  return (directive.supportDepartmentIds || []).map(upper).includes(dep) ? "Phối hợp" : "";
}
function statusPill(info) { return `<span class="directive-status is-${esc(info.tone)}">${esc(info.label)}</span>`; }
function priorityPill(priority) {
  const key = upper(priority || "NORMAL");
  return `<span class="directive-priority is-${key.toLowerCase()}">${esc(PRIORITY_LABELS[key] || key)}</span>`;
}
function reportScopeDepartment() {
  const user = UserContext.requireUser();
  return Permissions.canGenerateCenterExecutiveReports() ? upper(state.department || "ALL") : user.departmentId;
}
function visibleDirectives() {
  const user = UserContext.requireUser();
  const search = normalizeText(state.search);
  const scopeDepartment = Permissions.canViewAllExecutiveDirectives() ? upper(state.department || "ALL") : user.departmentId;
  return state.directives.filter(item => {
    if (item.isDeleted === true) return false;
    if (scopeDepartment !== "ALL" && !(item.visibleDepartmentIds || []).map(upper).includes(scopeDepartment)) return false;
    if (search) {
      const haystack = normalizeText([item.code, item.content, item.directedByName, item.meetingName, departmentName(item.leadDepartmentId)].join(" "));
      if (!haystack.includes(search)) return false;
    }
    if (state.status !== "ALL") {
      const target = scopeDepartment === "ALL" ? item.leadDepartmentId : scopeDepartment;
      if (statusFor(item, target).code !== state.status) return false;
    }
    return true;
  });
}
function metric(label, value, note, tone) {
  return `<article class="directive-metric is-${tone}"><span>${esc(label)}</span><strong>${Number(value || 0)}</strong><small>${esc(note)}</small></article>`;
}
function tabButton(id, label, icon, hidden = false) {
  if (hidden) return "";
  return `<button type="button" class="directive-tab ${state.tab === id ? "is-active" : ""}" data-directive-tab="${id}">${icon}<span>${esc(label)}</span></button>`;
}

export async function renderExecutiveDirectivesView(outlet) {
  const sequence = ++renderSequence;
  const user = UserContext.requireUser();
  stopRealtime();
  bindCleanup();
  outlet.innerHTML = loadingCard("Đang tải Chỉ đạo điều hành…");
  try {
    const [directives, updates, departments, users] = await Promise.all([
      ExecutiveDirectiveService.listDirectives(),
      ExecutiveDirectiveService.listUpdates(),
      DepartmentReadService.listActive(),
      UserReadService.listActive().catch(() => [])
    ]);
    if (sequence !== renderSequence || window.location.hash !== "#/directives") return;
    state = { ...state, directives, updates, departments, users, department: Permissions.canViewAllExecutiveDirectives() ? state.department : user.departmentId };
    mountShell(outlet);
    renderCurrentTab();
    startRealtime(outlet, sequence);
  } catch (error) {
    outlet.innerHTML = errorCard("Không thể tải Chỉ đạo điều hành", error);
  }
}

function bindCleanup() {
  if (cleanupBound) return;
  cleanupBound = true;
  document.addEventListener("v3:route-changed", event => {
    if (event.detail?.route !== "#/directives") stopRealtime();
  });
}
function stopRealtime() {
  try { state.stopRealtime?.(); } catch (_) { /* no-op */ }
  state.stopRealtime = null;
}
function startRealtime(outlet, sequence) {
  const rerender = () => {
    if (sequence !== renderSequence || window.location.hash !== "#/directives" || !outlet.isConnected) return false;
    renderCurrentTab();
    const live = document.getElementById("directiveRealtimeState");
    if (live) live.textContent = "Đang đồng bộ trực tiếp · tự động";
    return true;
  };
  const stops = [
    ExecutiveDirectiveService.subscribeDirectives(items => {
      if (sequence !== renderSequence || window.location.hash !== "#/directives" || !outlet.isConnected) return;
      state.directives = items;
      rerender();
    }, error => console.warn("Không thể đồng bộ nội dung chỉ đạo:", error), { startDelayMs: 60 * 1000, jitterMs: 30 * 1000 }),
    ExecutiveDirectiveService.subscribeUpdates(items => {
      if (sequence !== renderSequence || window.location.hash !== "#/directives" || !outlet.isConnected) return;
      state.updates = items;
      rerender();
    }, error => console.warn("Không thể đồng bộ tiến độ Chỉ đạo điều hành:", error), { startDelayMs: 60 * 1000, jitterMs: 30 * 1000 })
  ];
  state.stopRealtime = () => stops.forEach(stop => {
    try { stop?.(); } catch (_) { /* no-op */ }
  });
}

function mountShell(outlet) {
  const manager = Permissions.canManageExecutiveDirectives();
  const oralRecorder = Permissions.canRecordOralExecutiveDirective();
  outlet.innerHTML = `
    <section class="directive-shell page-card">
      <header class="directive-page-header">
        <div class="directive-header-copy"><h2>Chỉ đạo của Ban Giám đốc</h2><p>Giao việc, tiếp nhận, theo dõi và đôn đốc thực hiện.</p><small id="directiveRealtimeState" class="kpi-hidden"></small></div>
        <div class="directive-header-actions">${manager ? '<button id="btnCreateDirective" class="primary-button directive-main-action" type="button">＋ Thêm chỉ đạo</button>' : ""}${oralRecorder ? '<button id="btnRecordOralDirective" class="primary-button directive-main-action" type="button">🗣 Ghi nhận BGĐ</button>' : ""}<button id="btnDirectiveRefresh" class="secondary-button directive-sync-button" type="button" aria-label="Cập nhật dữ liệu" title="Cập nhật dữ liệu">↻</button></div>
      </header>
      <nav class="directive-tabs" aria-label="Chỉ đạo điều hành">
        ${tabButton("overview", "Tổng quan", "◫")}
        ${tabButton("list", "Chỉ đạo", "📌")}
        ${tabButton("tracking", "Theo dõi", "◎", !Permissions.canViewAllExecutiveDirectives())}
        ${tabButton("report", "Báo cáo tuần", "📄", !(Permissions.canGenerateCenterExecutiveReports() || upper(UserContext.requireUser().role) === "DEPARTMENT_LEADER"))}
      </nav>
      <div id="directiveContent"></div>
    </section>`;
  outlet.querySelectorAll("[data-directive-tab]").forEach(button => button.addEventListener("click", () => {
    state.tab = button.dataset.directiveTab;
    mountShell(outlet);
    renderCurrentTab();
  }));
  document.getElementById("btnCreateDirective")?.addEventListener("click", () => openDirectiveForm());
  document.getElementById("btnRecordOralDirective")?.addEventListener("click", () => openOralDirectiveForm());
  document.getElementById("btnDirectiveRefresh")?.addEventListener("click", refreshAll);
}

async function refreshAll() {
  if (directiveRefreshPromise) return directiveRefreshPromise;
  const now = Date.now();
  if (now - lastDirectiveRefreshAt < DIRECTIVE_REFRESH_COOLDOWN_MS) return null;
  lastDirectiveRefreshAt = now;

  const button = document.getElementById("btnDirectiveRefresh");
  if (button) button.disabled = true;
  directiveRefreshPromise = (async () => {
    try {
      const [directives, updates] = await Promise.all([ExecutiveDirectiveService.listDirectives(), ExecutiveDirectiveService.listUpdates()]);
      state.directives = directives;
      state.updates = updates;
      renderCurrentTab();
      ToastService.success("Đã cập nhật Chỉ đạo điều hành.");
    } catch (error) {
      ToastService.error(error?.message || "Không thể cập nhật dữ liệu.");
    } finally {
      if (button?.isConnected) button.disabled = false;
      directiveRefreshPromise = null;
    }
  })();
  return directiveRefreshPromise;
}

function renderCurrentTab() {
  const root = document.getElementById("directiveContent");
  if (!root) return;
  if (state.tab === "list") return renderList(root);
  if (state.tab === "tracking") return renderTracking(root);
  if (state.tab === "report") return renderReportTab(root);
  renderOverview(root);
}

function summarize(scopeDepartment = "ALL") {
  const relevant = state.directives.filter(item => item.isDeleted !== true && (scopeDepartment === "ALL" || (item.visibleDepartmentIds || []).map(upper).includes(scopeDepartment)));
  const counts = { total: relevant.length, NOT_STARTED: 0, ACCEPTED: 0, IN_PROGRESS: 0, COMPLETED: 0, PAUSED: 0, OVERDUE: 0 };
  relevant.forEach(item => {
    const dep = scopeDepartment === "ALL" ? item.leadDepartmentId : scopeDepartment;
    const status = statusFor(item, dep).code;
    counts[status] = (counts[status] || 0) + 1;
  });
  return counts;
}

function renderOverview(root) {
  const user = UserContext.requireUser();
  const scope = Permissions.canViewAllExecutiveDirectives() ? "ALL" : user.departmentId;
  const summary = summarize(scope);
  const recent = state.directives.filter(item => item.isDeleted !== true && (scope === "ALL" || (item.visibleDepartmentIds || []).map(upper).includes(scope))).slice(0, 6);
  root.innerHTML = `
    <section class="directive-overview">
      <div class="directive-metrics">
        ${metric("Tổng nội dung", summary.total, scope === "ALL" ? "Toàn Trung tâm" : departmentName(scope), "blue")}
        ${metric("Đã tiếp nhận / đang làm", summary.ACCEPTED + summary.IN_PROGRESS, "Đang xử lý", "amber")}
        ${metric("Quá hạn", summary.OVERDUE, "Cần theo dõi", "red")}
        ${metric("Hoàn thành", summary.COMPLETED, "Đã cập nhật kết quả", "green")}
      </div>
      <section class="directive-panel">
        <div class="section-heading"><div><h3>Nội dung gần đây</h3><p>${scope === "ALL" ? "Các chỉ đạo mới nhất của Ban Giám đốc." : `Các chỉ đạo liên quan ${esc(departmentName(scope))}.`}</p></div><button class="secondary-button" type="button" id="btnGoDirectiveList">Xem tất cả</button></div>
        <div class="directive-recent-list">${recent.length ? recent.map(item => recentCard(item, scope)).join("") : emptyState("Chưa có nội dung chỉ đạo trong phạm vi này.")}</div>
      </section>
    </section>`;
  document.getElementById("btnGoDirectiveList")?.addEventListener("click", () => { state.tab = "list"; mountShell(document.getElementById("appOutlet")); renderCurrentTab(); });
  root.querySelectorAll("[data-open-directive]").forEach(button => button.addEventListener("click", () => openDirectiveDetail(button.dataset.openDirective)));
}

function recentCard(item, scope) {
  const dep = scope === "ALL" ? item.leadDepartmentId : scope;
  const info = statusFor(item, dep);
  return `<button class="directive-recent-card" type="button" data-open-directive="${esc(item.id)}"><div><span>${esc(formatDate(item.directedDateKey))} · ${esc(SOURCE_LABELS[upper(item.sourceType)] || item.sourceType || "Chỉ đạo")}</span><strong>${esc(item.content)}</strong><small>${esc(departmentName(item.leadDepartmentId))}${scope !== "ALL" ? ` · ${esc(roleForDepartment(item, scope))}` : ""}</small></div>${statusPill(info)}</button>`;
}

function renderFilters() {
  const user = UserContext.requireUser();
  const canAll = Permissions.canViewAllExecutiveDirectives();
  const departmentOptions = canAll
    ? `<option value="ALL">Toàn Trung tâm</option>${targetDepartments().map(item => `<option value="${esc(upper(item.id || item.code))}" ${upper(item.id || item.code) === upper(state.department) ? "selected" : ""}>${esc(item.name || item.id)}</option>`).join("")}`
    : `<option value="${esc(user.departmentId)}">${esc(departmentName(user.departmentId))}</option>`;
  return `<div class="directive-filters"><label><span>Tìm kiếm</span><input id="directiveSearch" type="search" value="${esc(state.search)}" placeholder="Nội dung, người chỉ đạo…"></label><label><span>Phòng/Khu</span><select id="directiveDepartmentFilter" ${canAll ? "" : "disabled"}>${departmentOptions}</select></label><label><span>Trạng thái</span><select id="directiveStatusFilter"><option value="ALL">Tất cả</option>${["NOT_STARTED","ACCEPTED","IN_PROGRESS","OVERDUE","COMPLETED","PAUSED"].map(code => `<option value="${code}" ${state.status === code ? "selected" : ""}>${esc(code === "OVERDUE" ? "Quá hạn" : STATUS_LABELS[code])}</option>`).join("")}</select></label></div>`;
}

function bindDirectiveOpenButtons(container) {
  container?.querySelectorAll("[data-open-directive]").forEach(button => {
    button.addEventListener("click", () => openDirectiveDetail(button.dataset.openDirective));
  });
}

function bindFilters(root) {
  const searchInput = root.querySelector("#directiveSearch");
  let searchTimer = 0;

  searchInput?.addEventListener("input", event => {
    state.search = event.target.value;
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => renderListResults(root), 120);
  });

  root.querySelector("#directiveDepartmentFilter")?.addEventListener("change", event => {
    state.department = event.target.value || "ALL";
    renderListResults(root);
  });

  root.querySelector("#directiveStatusFilter")?.addEventListener("change", event => {
    state.status = event.target.value || "ALL";
    renderListResults(root);
  });
}

function renderListResults(root) {
  const resultRoot = root.querySelector("#directiveListResults");
  if (!resultRoot) return;

  const items = visibleDirectives();
  const user = UserContext.requireUser();
  const scope = Permissions.canViewAllExecutiveDirectives() ? upper(state.department || "ALL") : user.departmentId;
  const describe = item => {
    const dep = scope === "ALL" ? item.leadDepartmentId : scope;
    const status = statusFor(item, dep);
    const role = scope !== "ALL" ? roleForDepartment(item, scope) : "";
    const assignment = latestInternalAssignment(item, dep);
    const personAccepted = latestPersonalAcceptance(item, dep);
    const assignee = assignment
      ? `${clean(assignment.assignedUserName) || "Đã phân công"}${personAccepted ? " · Đã nhận việc" : " · Chờ nhận việc"}`
      : (latestAcceptance(item, dep) ? "Chưa phân công" : "—");
    return { dep, status, role, assignee };
  };

  const desktopRows = items.map(item => {
    const x = describe(item);
    return `<tr><td><strong>${esc(formatDate(item.directedDateKey))}</strong><small>${esc(SOURCE_LABELS[upper(item.sourceType)] || item.sourceType || "")}</small></td><td><button class="directive-title-link" type="button" data-open-directive="${esc(item.id)}">${esc(item.content)}</button><div class="directive-row-meta"><span>${esc(item.directedByName || "")}</span>${x.role ? `<span>${esc(x.role)}</span>` : ""}${priorityPill(item.priority)}</div></td><td>${esc(departmentName(item.leadDepartmentId))}</td><td>${esc(x.assignee)}</td><td>${esc(formatDate(item.dueDateKey))}</td><td>${statusPill(x.status)}</td><td><button class="secondary-button compact" type="button" data-open-directive="${esc(item.id)}">Chi tiết</button></td></tr>`;
  }).join("") || `<tr><td colspan="7">${emptyState("Không có nội dung phù hợp bộ lọc.")}</td></tr>`;

  const mobileCards = items.map(item => {
    const x = describe(item);
    return `<article class="directive-mobile-card"><header><div class="directive-mobile-card-title"><span>${esc(formatDate(item.directedDateKey))} · ${esc(SOURCE_LABELS[upper(item.sourceType)] || item.sourceType || "")}</span><button class="directive-title-link" type="button" data-open-directive="${esc(item.id)}">${esc(item.content)}</button><small>${esc(item.directedByName || "")}${upper(item.entryMode) === "LEADER_ORAL_CAPTURE" ? " · Ghi nhận BGĐ" : ""}</small></div>${statusPill(x.status)}</header><div class="directive-mobile-card-meta"><div><span>Chủ trì</span><strong>${esc(departmentName(item.leadDepartmentId))}</strong></div><div><span>Người thực hiện</span><strong>${esc(x.assignee)}</strong></div><div><span>Thời hạn</span><strong>${esc(formatDate(item.dueDateKey))}</strong></div><div><span>Mức độ</span><strong>${esc(PRIORITY_LABELS[upper(item.priority)] || "Bình thường")}</strong></div></div><footer><button class="secondary-button compact" type="button" data-open-directive="${esc(item.id)}">Xem chi tiết</button></footer></article>`;
  }).join("") || emptyState("Không có nội dung phù hợp bộ lọc.");

  resultRoot.innerHTML = `<div class="directive-list-meta"><strong>${items.length} nội dung</strong><span>Quá hạn được tự động xác định theo thời hạn.</span></div><div class="directive-desktop-list directive-table-wrap"><table class="directive-table"><thead><tr><th>Ngày</th><th>Nội dung chỉ đạo</th><th>Chủ trì</th><th>Người thực hiện</th><th>Thời hạn</th><th>Trạng thái</th><th></th></tr></thead><tbody>${desktopRows}</tbody></table></div><div class="directive-mobile-list">${mobileCards}</div>`;
  bindDirectiveOpenButtons(resultRoot);
}

function renderList(root) {
  // Nếu bộ lọc đã tồn tại (ví dụ realtime cập nhật khi người dùng đang gõ),
  // chỉ render vùng kết quả để không phá focus/caret của ô tìm kiếm.
  if (root.querySelector("#directiveSearch") && root.querySelector("#directiveListResults")) {
    renderListResults(root);
    return;
  }

  root.innerHTML = `${renderFilters()}<div id="directiveListResults"></div>`;
  bindFilters(root);
  renderListResults(root);
}

function renderTracking(root) {
  if (!Permissions.canViewAllExecutiveDirectives()) {
    root.innerHTML = emptyState("Tài khoản không có quyền theo dõi toàn Trung tâm.");
    return;
  }
  const rows = targetDepartments().map(dep => {
    const id = upper(dep.id || dep.code);
    const summary = summarize(id);
    return `<button type="button" class="directive-department-card" data-track-department="${esc(id)}"><strong>${esc(dep.name || id)}</strong><span>${summary.total} nội dung</span><small>${summary.ACCEPTED} đã tiếp nhận · ${summary.IN_PROGRESS} đang thực hiện · ${summary.OVERDUE} quá hạn · ${summary.COMPLETED} hoàn thành</small><div class="directive-mini-meter"><i style="width:${summary.total ? Math.round(summary.COMPLETED / summary.total * 100) : 0}%"></i></div></button>`;
  }).join("");
  const overdue = state.directives.filter(item => item.isDeleted !== true && statusFor(item, item.leadDepartmentId).code === "OVERDUE");
  root.innerHTML = `<section class="directive-tracking"><div class="section-heading"><div><h3>Theo dõi theo Phòng/Khu</h3><p>Phòng Tổ chức - Hành chính và Ban Giám đốc theo dõi toàn Trung tâm.</p></div></div><div class="directive-department-grid">${rows}</div><section class="directive-panel"><div class="section-heading"><div><h3>Nội dung quá hạn</h3><p>Các nội dung chủ trì chưa hoàn thành và đã qua thời hạn.</p></div></div><div class="directive-recent-list">${overdue.length ? overdue.map(item => recentCard(item, "ALL")).join("") : emptyState("Hiện không có nội dung quá hạn.")}</div></section></section>`;
  root.querySelectorAll("[data-track-department]").forEach(button => button.addEventListener("click", () => {
    state.department = button.dataset.trackDepartment;
    state.status = "ALL";
    state.tab = "list";
    mountShell(document.getElementById("appOutlet"));
    renderCurrentTab();
  }));
  root.querySelectorAll("[data-open-directive]").forEach(button => button.addEventListener("click", () => openDirectiveDetail(button.dataset.openDirective)));
}

function renderReportTab(root) {
  const user = UserContext.requireUser();
  const canCenter = Permissions.canGenerateCenterExecutiveReports();
  const canDepartmentReport = canCenter || (upper(user.role) === "DEPARTMENT_LEADER" && Boolean(user.departmentId));
  if (!canDepartmentReport) { root.innerHTML = emptyState("Chỉ Trưởng/Phó Phòng/Khu, BGĐ và TCHC được lập báo cáo tuần Chỉ đạo điều hành."); return; }
  const start = state.report?.weekStart || defaultReportWeekStart();
  const scope = canCenter ? (state.report?.departmentId || state.department || "ALL") : user.departmentId;
  root.innerHTML = `<section class="directive-report-builder"><div class="directive-report-controls"><label><span>Tuần bắt đầu từ thứ Hai</span><input id="directiveReportWeek" type="date" value="${esc(start)}"></label><label><span>Phạm vi báo cáo</span><select id="directiveReportDepartment" ${canCenter ? "" : "disabled"}>${canCenter ? `<option value="ALL" ${scope === "ALL" ? "selected" : ""}>Toàn Trung tâm</option>${targetDepartments().map(dep => { const id = upper(dep.id || dep.code); return `<option value="${esc(id)}" ${id === upper(scope) ? "selected" : ""}>${esc(dep.name || id)}</option>`; }).join("")}` : `<option value="${esc(user.departmentId)}">${esc(departmentName(user.departmentId))}</option>`}</select></label><button id="btnBuildDirectiveReport" class="primary-button" type="button">Tổng hợp báo cáo</button><button id="btnLoadSavedDirectiveReport" class="secondary-button" type="button">Mở bản đã lưu</button></div><div id="directiveReportResult">${state.report ? renderReport(state.report) : '<div class="directive-report-placeholder">Chọn tuần và bấm <strong>Tổng hợp báo cáo</strong>.</div>'}</div></section>`;
  document.getElementById("btnBuildDirectiveReport")?.addEventListener("click", async () => {
    const inputDate = clean(document.getElementById("directiveReportWeek")?.value || start);
    const weekStart = mondayOf(inputDate);
    const departmentId = upper(document.getElementById("directiveReportDepartment")?.value || scope);
    state.report = buildWeeklyReport(weekStart, departmentId);
    renderReportTab(root);
  });
  document.getElementById("btnLoadSavedDirectiveReport")?.addEventListener("click", async event => {
    const inputDate = clean(document.getElementById("directiveReportWeek")?.value || start);
    const weekStart = mondayOf(inputDate);
    const departmentId = upper(document.getElementById("directiveReportDepartment")?.value || scope);
    try {
      event.currentTarget.disabled = true;
      const saved = await ExecutiveDirectiveService.loadWeeklyReport(weekStart, departmentId);
      if (!saved) return ToastService.error("Chưa có bản báo cáo đã lưu cho tuần và phạm vi này.");
      state.report = {
        weekStart: saved.weekStart, weekEnd: saved.weekEnd, departmentId: saved.departmentId,
        title: saved.title, summary: saved.summary || {}, sections: saved.sections || { completed: [], ongoing: [], overdue: [] },
        savedAt: saved.updatedAt || saved.generatedAt || null
      };
      renderReportTab(root);
      ToastService.success("Đã mở bản báo cáo tuần đã lưu.");
    } catch (error) { ToastService.error(error?.message || "Không mở được bản báo cáo đã lưu."); }
    finally { event.currentTarget.disabled = false; }
  });
  bindReportActions(root);
}

function buildWeeklyReport(weekStart, departmentId) {
  const weekEnd = addDays(weekStart, 6);
  const target = upper(departmentId || "ALL");
  const directives = state.directives.filter(item => {
    if (clean(item.directedDateKey) > weekEnd) return false;
    if (item.isDeleted === true && clean(item.deletedDateKey) && clean(item.deletedDateKey) <= weekEnd) return false;
    if (target !== "ALL" && !(item.visibleDepartmentIds || []).map(upper).includes(target)) return false;
    return true;
  });
  const sections = { completed: [], ongoing: [], overdue: [] };
  directives.forEach(item => {
    const dep = target === "ALL" ? upper(item.leadDepartmentId) : target;
    let info = statusFor(item, dep, weekEnd);
    const latest = info.latest;
    if (info.code !== "COMPLETED" && info.code !== "PAUSED" && clean(item.dueDateKey) && clean(item.dueDateKey) <= weekEnd) {
      info = { ...info, code: "OVERDUE", label: "Quá hạn", tone: "overdue" };
    }
    const completedDate = clean(latest?.completedDateKey);
    const assignment = latestInternalAssignment(item, dep, weekEnd);
    const personalAccepted = latestPersonalAcceptance(item, dep, weekEnd);
    const row = {
      id: item.id,
      directedDateKey: item.directedDateKey || "",
      content: item.content || "",
      directedByName: item.directedByName || "",
      leadDepartmentId: item.leadDepartmentId || "",
      reportDepartmentId: dep,
      role: target === "ALL" ? "Chủ trì" : roleForDepartment(item, dep),
      dueDateKey: item.dueDateKey || "",
      assignedUserName: clean(assignment?.assignedUserName),
      assignmentStatus: assignment ? (personalAccepted ? "Đã nhận việc" : "Chờ nhận việc") : "Chưa phân công",
      status: info.code,
      statusLabel: info.label,
      resultSummary: latest?.resultSummary || latest?.progressSummary || "Chưa cập nhật kết quả",
      note: latest?.note || ""
    };
    if (info.code === "COMPLETED" && completedDate >= weekStart && completedDate <= weekEnd) {
      sections.completed.push(row);
      return;
    }
    if (info.code === "OVERDUE") {
      sections.overdue.push(row);
      return;
    }
    if (info.code !== "COMPLETED") {
      sections.ongoing.push(row);
      return;
    }
    // Hoàn thành trước tuần: không đưa lại vào báo cáo tuần mới.
  });
  const total = sections.completed.length + sections.ongoing.length + sections.overdue.length;
  return {
    weekStart,
    weekEnd,
    departmentId: target,
    title: target === "ALL" ? "Báo cáo kết quả thực hiện chỉ đạo của Ban Giám đốc" : `Báo cáo kết quả thực hiện chỉ đạo - ${departmentName(target)}`,
    summary: { total, completed: sections.completed.length, ongoing: sections.ongoing.length, overdue: sections.overdue.length },
    sections
  };
}

function reportRows(rows) {
  if (!rows.length) return '<tr><td colspan="8" class="directive-report-empty">Không có nội dung.</td></tr>';
  return rows.map((row, index) => `<tr><td>${index + 1}</td><td>${esc(formatDate(row.directedDateKey))}</td><td>${esc(row.content)}</td><td>${esc(departmentName(row.reportDepartmentId))}${row.role ? `<br><small>${esc(row.role)}</small>` : ""}</td><td>${esc(row.assignedUserName || "—")}${row.assignmentStatus ? `<br><small>${esc(row.assignmentStatus)}</small>` : ""}</td><td>${esc(formatDate(row.dueDateKey))}</td><td>${esc(row.resultSummary)}</td><td>${esc(row.statusLabel)}</td></tr>`).join("");
}
function reportSection(title, rows) {
  return `<section class="directive-report-section"><h4>${esc(title)}</h4><table><thead><tr><th>STT</th><th>Ngày chỉ đạo</th><th>Nội dung</th><th>Phòng/Khu</th><th>Người thực hiện</th><th>Thời hạn</th><th>Kết quả/tiến độ</th><th>Trạng thái</th></tr></thead><tbody>${reportRows(rows)}</tbody></table></section>`;
}
function renderReport(report) {
  return `<article id="directivePrintableReport" class="directive-report-document"><header><h3>${esc(report.title)}</h3><p>Tuần từ ngày <strong>${esc(formatDate(report.weekStart))}</strong> đến ngày <strong>${esc(formatDate(report.weekEnd))}</strong></p></header><div class="directive-report-summary"><span>Tổng: <strong>${report.summary.total}</strong></span><span>Hoàn thành: <strong>${report.summary.completed}</strong></span><span>Đang tiếp tục: <strong>${report.summary.ongoing}</strong></span><span>Quá hạn: <strong>${report.summary.overdue}</strong></span></div>${reportSection("I. KẾT QUẢ HOÀN THÀNH TRONG TUẦN", report.sections.completed)}${reportSection("II. NỘI DUNG ĐANG TIẾP TỤC THỰC HIỆN", report.sections.ongoing)}${reportSection("III. NỘI DUNG CHẬM/QUÁ HẠN", report.sections.overdue)}<footer><em>Báo cáo được tổng hợp từ phân hệ Chỉ đạo điều hành.</em></footer></article><div class="directive-report-actions"><button id="btnSaveDirectiveReport" class="primary-button" type="button">Lưu bản báo cáo tuần</button><button id="btnExportDirectiveWord" class="secondary-button" type="button">Xuất Word</button><button id="btnPrintDirectiveReport" class="secondary-button" type="button">In / Lưu PDF</button></div>`;
}
function bindReportActions(root) {
  if (!state.report) return;
  root.querySelector("#btnSaveDirectiveReport")?.addEventListener("click", async event => {
    try {
      event.currentTarget.disabled = true;
      await ExecutiveDirectiveService.saveWeeklyReport(state.report);
      ToastService.success("Đã lưu bản báo cáo tuần.");
    } catch (error) { ToastService.error(error?.message || "Không lưu được báo cáo tuần."); }
    finally { event.currentTarget.disabled = false; }
  });
  root.querySelector("#btnExportDirectiveWord")?.addEventListener("click", () => exportReportWord(state.report));
  root.querySelector("#btnPrintDirectiveReport")?.addEventListener("click", () => printReport(state.report));
}

function reportHtmlDocument(report) {
  const body = renderReport(report).replace(/<div class="directive-report-actions">[\s\S]*?<\/div>$/, "");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(report.title)}</title><style>body{font-family:"Times New Roman",serif;font-size:13pt;color:#111;margin:28px}h3{text-align:center;text-transform:uppercase}h4{margin:22px 0 8px}table{width:100%;border-collapse:collapse;font-size:11pt}th,td{border:1px solid #333;padding:6px;vertical-align:top}th{text-align:center}.directive-report-summary{display:flex;gap:18px;flex-wrap:wrap;margin:16px 0}.directive-report-section{break-inside:avoid}footer{margin-top:18px}</style></head><body>${body}</body></html>`;
}
function exportReportWord(report) {
  const blob = new Blob(["\ufeff", reportHtmlDocument(report)], { type: "application/msword;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `Bao-cao-chi-dao-${report.departmentId}-${report.weekStart}.doc`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function printReport(report) {
  const popup = window.open("", "_blank");
  if (!popup) return ToastService.error("Trình duyệt đang chặn cửa sổ in. Hãy cho phép pop-up rồi thử lại.");
  try { popup.opener = null; } catch (_) { /* no-op */ }
  popup.document.open();
  popup.document.write(reportHtmlDocument(report));
  popup.document.close();
  popup.focus();
  window.setTimeout(() => popup.print(), 250);
}

function openDirectiveForm(current = null) {
  if (!Permissions.canManageExecutiveDirectives()) return;
  const editing = Boolean(current?.id);
  const departments = targetDepartments();
  const directors = directorUsers();
  const selectedDirectorId = clean(current?.directedByUserId);
  const selectedDirectorExists = directors.some(item => item.id === selectedDirectorId || item.uid === selectedDirectorId);
  const directorValue = selectedDirectorExists ? selectedDirectorId : (editing && !selectedDirectorId ? "__OTHER__" : (directors[0]?.id || directors[0]?.uid || "__OTHER__"));
  const support = new Set((current?.supportDepartmentIds || []).map(upper));
  const backdrop = modalBackdrop(`
    <section class="directive-modal-card directive-form-modal">
      <header class="directive-modal-header"><div><h2>${editing ? "Chỉnh sửa nội dung chỉ đạo" : "Thêm nội dung chỉ đạo"}</h2><p>Ghi nhận nội dung và Phòng/Khu thực hiện.</p></div><button data-directive-close class="modal-close-button" type="button">×</button></header>
      <div class="directive-modal-body"><div class="directive-form-grid">
        <label><span>Hình thức chỉ đạo *</span><select id="directiveSourceType">${Object.entries(SOURCE_LABELS).map(([value, label]) => `<option value="${value}" ${upper(current?.sourceType || "DIRECT") === value ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></label>
        <label><span>Ngày chỉ đạo *</span><input id="directiveDate" type="date" value="${esc(current?.directedDateKey || localDateKey())}"></label>
        <label><span>Người chỉ đạo *</span><select id="directiveDirector">${directors.map(user => { const id = user.id || user.uid; return `<option value="${esc(id)}" ${id === directorValue ? "selected" : ""}>${esc(user.fullName || user.email)}</option>`; }).join("")}<option value="__OTHER__" ${directorValue === "__OTHER__" ? "selected" : ""}>Nhập tên khác</option></select></label>
        <label id="directiveOtherDirectorWrap" class="${directorValue === "__OTHER__" ? "" : "hidden"}"><span>Tên người chỉ đạo *</span><input id="directiveOtherDirector" maxlength="150" value="${esc(!selectedDirectorExists ? current?.directedByName || "" : "")}"></label>
        <label class="field-full"><span>Tên cuộc họp/nguồn chỉ đạo</span><input id="directiveMeetingName" maxlength="250" value="${esc(current?.meetingName || "")}" placeholder="Ví dụ: Họp giao ban Trung tâm"></label>
        <label class="field-full"><span>Số/ký hiệu văn bản hoặc ghi chú nguồn</span><input id="directiveReference" maxlength="250" value="${esc(current?.referenceText || "")}" placeholder="Không bắt buộc"></label>
        <label class="field-full"><span>Nội dung chỉ đạo *</span><textarea id="directiveContentInput" rows="5" maxlength="5000" placeholder="Nhập đầy đủ ý kiến chỉ đạo của Ban Giám đốc">${esc(current?.content || "")}</textarea></label>
        <label><span>Phòng/Khu chủ trì *</span><select id="directiveLeadDepartment"><option value="">— Chọn Phòng/Khu —</option>${departments.map(dep => { const id = upper(dep.id || dep.code); return `<option value="${esc(id)}" ${upper(current?.leadDepartmentId) === id ? "selected" : ""}>${esc(dep.name || id)}</option>`; }).join("")}</select></label>
        <label><span>Thời hạn</span><input id="directiveDueDate" type="date" value="${esc(current?.dueDateKey || "")}"></label>
        <fieldset class="field-full directive-support-field"><legend>Phòng/Khu phối hợp <small>(tùy chọn)</small></legend><div class="directive-checkbox-grid">${departments.map(dep => { const id = upper(dep.id || dep.code); return `<label><input type="checkbox" value="${esc(id)}" data-support-department ${support.has(id) ? "checked" : ""}><span>${esc(dep.name || id)}</span></label>`; }).join("")}</div></fieldset>
        <label><span>Mức độ</span><select id="directivePriority">${Object.entries(PRIORITY_LABELS).map(([value,label]) => `<option value="${value}" ${upper(current?.priority || "NORMAL") === value ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></label>
      </div></div>
      <footer class="directive-modal-footer"><button data-directive-close class="secondary-button" type="button">Hủy</button><button id="btnSaveDirective" class="primary-button" type="button">${editing ? "Lưu thay đổi" : "Lưu và giao thực hiện"}</button></footer>
    </section>`);
  const directorSelect = backdrop.querySelector("#directiveDirector");
  const otherWrap = backdrop.querySelector("#directiveOtherDirectorWrap");
  const leadSelect = backdrop.querySelector("#directiveLeadDepartment");
  const refreshSupport = () => backdrop.querySelectorAll("[data-support-department]").forEach(input => {
    input.disabled = input.value === leadSelect?.value;
    if (input.disabled) input.checked = false;
  });
  directorSelect?.addEventListener("change", () => otherWrap?.classList.toggle("hidden", directorSelect.value !== "__OTHER__"));
  leadSelect?.addEventListener("change", refreshSupport);
  refreshSupport();
  backdrop.querySelector("#btnSaveDirective")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    const selectedDirector = directorSelect?.value || "__OTHER__";
    const otherName = clean(backdrop.querySelector("#directiveOtherDirector")?.value);
    const directedByName = selectedDirector === "__OTHER__"
      ? otherName
      : (directors.find(item => (item.id || item.uid) === selectedDirector)?.fullName || "");
    const input = {
      sourceType: backdrop.querySelector("#directiveSourceType")?.value,
      directedDateKey: backdrop.querySelector("#directiveDate")?.value,
      directedByUserId: selectedDirector === "__OTHER__" ? "" : selectedDirector,
      directedByName,
      meetingName: backdrop.querySelector("#directiveMeetingName")?.value,
      referenceText: backdrop.querySelector("#directiveReference")?.value,
      content: backdrop.querySelector("#directiveContentInput")?.value,
      leadDepartmentId: leadSelect?.value,
      dueDateKey: backdrop.querySelector("#directiveDueDate")?.value,
      supportDepartmentIds: [...backdrop.querySelectorAll("[data-support-department]:checked")].map(input => input.value),
      priority: backdrop.querySelector("#directivePriority")?.value
    };
    if (!input.leadDepartmentId) return ToastService.error("Chưa chọn Phòng/Khu chủ trì.");
    if (!input.directedByName || !clean(input.content)) return ToastService.error("Vui lòng nhập đầy đủ người chỉ đạo và nội dung.");
    try {
      button.disabled = true;
      button.textContent = editing ? "Đang lưu…" : "Đang giao…";
      if (editing) await ExecutiveDirectiveService.updateDirective(current, input);
      else await ExecutiveDirectiveService.createDirective(input);
      backdrop.remove();
      await refreshAfterWrite();
      ToastService.success(editing ? "Đã cập nhật nội dung chỉ đạo." : "Đã ghi nhận và giao nội dung chỉ đạo.");
    } catch (error) {
      ToastService.error(error?.message || "Không lưu được nội dung chỉ đạo.");
      button.disabled = false;
      button.textContent = editing ? "Lưu thay đổi" : "Lưu và giao thực hiện";
    }
  });
}

function openOralDirectiveForm() {
  const user = UserContext.requireUser();
  if (!Permissions.canRecordOralExecutiveDirective(user)) {
    ToastService.error("Chỉ Trưởng/Phó Phòng/Khu mới được ghi nhận chỉ đạo của BGĐ cho đơn vị mình.");
    return;
  }

  const directors = directorUsers();
  if (!directors.length) {
    ToastService.error("Chưa có thành viên Ban Giám đốc đang hoạt động trong danh mục người dùng (role DIRECTOR, departmentId BGD). Vui lòng cập nhật danh mục trước khi ghi nhận chỉ đạo.");
    return;
  }

  const defaultDirectorId = directors[0]?.id || directors[0]?.uid || "";
  const backdrop = modalBackdrop(`
    <section class="directive-modal-card directive-form-modal">
      <header class="directive-modal-header"><div><h2>Ghi nhận chỉ đạo BGĐ</h2><p>Ghi nhận nội dung Ban Giám đốc đã chỉ đạo tại giao ban, cuộc họp, trao đổi trực tiếp hoặc điện thoại cho <strong>${esc(departmentName(user.departmentId))}</strong>.</p></div><button data-directive-close class="modal-close-button" type="button">×</button></header>
      <div class="directive-modal-body"><div class="directive-form-grid">
        <label class="field-full"><span>Người chỉ đạo *</span><select id="oralDirectiveDirector">${directors.map(item => { const id = item.id || item.uid; return `<option value="${esc(id)}" ${id === defaultDirectorId ? "selected" : ""}>${esc(directorLabel(item))}</option>`; }).join("")}</select></label>
        <label><span>Ngày chỉ đạo *</span><input id="oralDirectiveDate" type="date" value="${esc(localDateKey())}"></label>
        <label><span>Nguồn chỉ đạo *</span><select id="oralDirectiveSource">${Object.entries(SOURCE_LABELS).filter(([value]) => value !== "DOCUMENT").map(([value,label]) => `<option value="${value}" ${value === "MEETING_WEEKLY" ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></label>
        <label class="field-full"><span>Cuộc họp/bối cảnh</span><input id="oralDirectiveMeeting" maxlength="250" placeholder="Ví dụ: Họp giao ban Trung tâm sáng thứ Hai"></label>
        <label class="field-full"><span>Nội dung chỉ đạo *</span><textarea id="oralDirectiveContent" rows="5" maxlength="5000" placeholder="Ghi đúng, đủ ý kiến chỉ đạo cần thực hiện"></textarea></label>
        <label><span>Phòng/Khu thực hiện</span><input value="${esc(departmentName(user.departmentId))}" disabled></label>
        <label><span>Thời hạn</span><input id="oralDirectiveDueDate" type="date"></label>
        <label><span>Mức độ</span><select id="oralDirectivePriority">${Object.entries(PRIORITY_LABELS).map(([value,label]) => `<option value="${value}">${esc(label)}</option>`).join("")}</select></label>
        <label class="field-full"><span>Ghi chú nguồn</span><input id="oralDirectiveReference" maxlength="250" placeholder="Không bắt buộc"></label>
      </div></div>
      <footer class="directive-modal-footer"><button data-directive-close class="secondary-button" type="button">Hủy</button><button id="btnSaveOralDirective" class="primary-button" type="button">Ghi nhận và tiếp nhận</button></footer>
    </section>`);

  const directorSelect = backdrop.querySelector("#oralDirectiveDirector");

  backdrop.querySelector("#btnSaveOralDirective")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    const selectedDirector = directorSelect?.value || "";
    const selectedDirectorUser = directors.find(item => (item.id || item.uid) === selectedDirector);
    const directedByName = clean(selectedDirectorUser?.fullName || selectedDirectorUser?.email);
    const input = {
      directedByUserId: selectedDirector,
      directedByName,
      directedDateKey: backdrop.querySelector("#oralDirectiveDate")?.value,
      sourceType: backdrop.querySelector("#oralDirectiveSource")?.value,
      meetingName: backdrop.querySelector("#oralDirectiveMeeting")?.value,
      referenceText: backdrop.querySelector("#oralDirectiveReference")?.value,
      content: backdrop.querySelector("#oralDirectiveContent")?.value,
      dueDateKey: backdrop.querySelector("#oralDirectiveDueDate")?.value,
      priority: backdrop.querySelector("#oralDirectivePriority")?.value
    };

    if (!selectedDirector || !directedByName) return ToastService.error("Chưa xác định thành viên Ban Giám đốc đã chỉ đạo.");
    if (!clean(input.content)) return ToastService.error("Chưa nhập nội dung chỉ đạo.");
    try {
      button.disabled = true;
      button.textContent = "Đang ghi nhận…";
      await ExecutiveDirectiveService.createOralDirective(input);
      backdrop.remove();
      await refreshAfterWrite();
      ToastService.success("Đã ghi nhận chỉ đạo của BGĐ và tiếp nhận cho đơn vị.");
    } catch (error) {
      ToastService.error(error?.message || "Không ghi nhận được chỉ đạo.");
      button.disabled = false;
      button.textContent = "Ghi nhận và tiếp nhận";
    }
  });
}

function openDirectiveDetail(id) {
  const directive = state.directives.find(item => item.id === id);
  if (!directive) return ToastService.error("Không tìm thấy nội dung chỉ đạo.");
  const user = UserContext.requireUser();
  const manager = Permissions.canManageExecutiveDirectives();
  const visibleDepartments = (directive.visibleDepartmentIds || []).map(upper);
  const ownRelevant = visibleDepartments.includes(upper(user.departmentId));
  const ownAccepted = ownRelevant && Boolean(latestAcceptance(directive, user.departmentId));
  const canAcceptOwn = ownRelevant && !ownAccepted && canAcceptDepartmentUi(directive, user.departmentId, user);
  const acceptedVisibleDepartments = visibleDepartments.filter(dep => Boolean(latestAcceptance(directive, dep)));
  const scopeDepartment = manager ? upper(directive.leadDepartmentId) : upper(user.departmentId);
  const scopeAssignment = latestInternalAssignment(directive, scopeDepartment);
  const scopePersonalAccepted = latestPersonalAcceptance(directive, scopeDepartment);
  const scopeProgress = latestProgress(directive, scopeDepartment);
  const ownAssignment = ownRelevant ? latestInternalAssignment(directive, user.departmentId) : null;
  const ownPersonalAccepted = ownRelevant ? latestPersonalAcceptance(directive, user.departmentId) : null;
  const assignedToMe = Boolean(ownAssignment && clean(ownAssignment.assignedUserId) === clean(user.uid));
  const canPersonalAccept = ownAccepted && assignedToMe && !ownPersonalAccepted && !scopeProgress;
  const canProgressOwn = ownAccepted && assignedToMe && Boolean(ownPersonalAccepted) && canProgressDepartmentUi(directive, user.departmentId);
  const assignableDepartments = (!manager && ownAccepted && canAssignInternalUi(directive, user.departmentId, user) && !latestProgress(directive, user.departmentId))
    ? [upper(user.departmentId)] : [];
  const history = manager ? directiveUpdates(directive.id) : directiveUpdates(directive.id, user.departmentId);
  const status = statusFor(directive, scopeDepartment);
  const effectiveAssignee = clean(scopeAssignment?.assignedUserName) || clean(directive.assignedUserName) || "Chưa phân công";
  const assignmentState = scopeAssignment
    ? (scopePersonalAccepted ? `${effectiveAssignee} · Đã nhận việc` : `${effectiveAssignee} · Chờ xác nhận nhận việc`)
    : (ownAccepted || (manager && latestAcceptance(directive, scopeDepartment)) ? "Chưa phân công người thực hiện" : assignmentText(directive));

  const workflowNotice = (() => {
    if (!ownRelevant) return "";
    if (!ownAccepted) {
      return `<div class="directive-workflow-warning"><strong>Chưa được phép thực hiện.</strong><span>${canAcceptOwn ? "Phòng/Khu phải bấm Xác nhận tiếp nhận trước." : "Đang chờ Trưởng/Phó Phòng/Khu xác nhận tiếp nhận."}</span></div>`;
    }
    if (!ownAssignment) {
      return `<div class="directive-workflow-warning"><strong>Đã tiếp nhận.</strong><span>Trưởng/Phó Phòng/Khu cần phân công một người thực hiện. Có thể phân công chính Trưởng/Phó hoặc một nhân viên trong đơn vị.</span></div>`;
    }
    if (assignedToMe && !ownPersonalAccepted) {
      return `<div class="directive-workflow-warning"><strong>Bạn được phân công thực hiện.</strong><span>Hãy bấm Xác nhận nhận việc trước khi cập nhật tiến độ.</span></div>`;
    }
    if (!assignedToMe && !ownPersonalAccepted) {
      return `<div class="directive-workflow-warning"><strong>Đã phân công.</strong><span>Đang chờ ${esc(ownAssignment.assignedUserName || "người được giao")} xác nhận nhận việc.</span></div>`;
    }
    if (!assignedToMe && ownPersonalAccepted && !isDepartmentLeaderLike(user)) {
      return `<div class="directive-workflow-warning"><strong>Đã nhận việc.</strong><span>${esc(ownAssignment.assignedUserName || "Người được giao")} là người trực tiếp cập nhật tiến độ và kết quả.</span></div>`;
    }
    return "";
  })();

  const backdrop = modalBackdrop(`
    <section class="directive-modal-card directive-detail-modal">
      <header class="directive-modal-header"><div><span class="page-eyebrow">CHI TIẾT CHỈ ĐẠO</span><h2>${esc(directive.content)}</h2><p>${esc(formatDate(directive.directedDateKey))} · ${esc(directive.directedByName || "")}</p></div><button data-directive-close class="modal-close-button" type="button">×</button></header>
      <div class="directive-modal-body">
        <div class="directive-detail-summary"><div><span>Trạng thái</span>${statusPill(status)}</div><div><span>Hình thức</span><strong>${esc(SOURCE_LABELS[upper(directive.sourceType)] || directive.sourceType || "—")}</strong></div><div><span>Chủ trì</span><strong>${esc(departmentName(directive.leadDepartmentId))}</strong></div><div><span>Người thực hiện</span><strong>${esc(assignmentState)}</strong></div><div><span>Thời hạn</span><strong>${esc(formatDate(directive.dueDateKey))}</strong></div></div>
        <section class="directive-detail-section"><h3>Thông tin chỉ đạo</h3><dl class="directive-detail-grid"><div><dt>Người chỉ đạo</dt><dd>${esc(directive.directedByName || "—")}</dd></div><div><dt>Ngày chỉ đạo</dt><dd>${esc(formatDate(directive.directedDateKey))}</dd></div><div><dt>Cuộc họp/nguồn</dt><dd>${esc(directive.meetingName || directive.referenceText || "—")}</dd></div><div><dt>Mức độ</dt><dd>${esc(PRIORITY_LABELS[upper(directive.priority)] || "Bình thường")}</dd></div><div><dt>Cấp giao</dt><dd>Phòng/Khu</dd></div><div><dt>Người thực hiện</dt><dd>${esc(effectiveAssignee)}</dd></div><div class="field-full"><dt>Đơn vị phối hợp</dt><dd>${(directive.supportDepartmentIds || []).length ? directive.supportDepartmentIds.map(departmentName).map(esc).join(", ") : "Không có"}</dd></div><div class="field-full"><dt>Người nhập hệ thống</dt><dd>${esc(directive.createdByName || "—")} · ${esc(departmentName(directive.createdByDepartmentId))}</dd></div>${upper(directive.entryMode) === "LEADER_ORAL_CAPTURE" ? `<div class="field-full"><dt>Ghi nhận từ chỉ đạo BGĐ</dt><dd><strong>${esc(directive.recordedByName || directive.createdByName || "—")}</strong> · ${esc(departmentName(directive.recordedByDepartmentId || directive.createdByDepartmentId))}. Nội dung này được ghi nhận từ chỉ đạo của BGĐ, không phải bản ghi do BGĐ trực tiếp nhập.</dd></div>` : ""}</dl></section>
        ${workflowNotice}
        <section class="directive-detail-section"><div class="section-heading"><div><h3>Kết quả và lịch sử cập nhật</h3><p>${manager ? "Hiển thị lịch sử toàn bộ Phòng/Khu." : `Hiển thị cập nhật của ${esc(departmentName(user.departmentId))}.`}</p></div></div><div class="directive-history">${history.length ? history.map(historyItem).join("") : emptyState("Chưa có cập nhật tiến độ.")}</div></section>
      </div>
      <footer class="directive-modal-footer directive-detail-actions">${canAcceptOwn ? '<button id="btnDirectiveAccept" class="primary-button" type="button">✓ Xác nhận tiếp nhận</button>' : ""}${assignableDepartments.length ? '<button id="btnDirectiveAssignInternal" class="secondary-button" type="button">👤 Phân công người thực hiện</button>' : ""}${canPersonalAccept ? '<button id="btnDirectivePersonalAccept" class="primary-button" type="button">✓ Xác nhận nhận việc</button>' : ""}${canProgressOwn ? '<button id="btnDirectiveProgress" class="secondary-button" type="button">Cập nhật thực hiện</button>' : ""}${manager ? '<button id="btnDirectiveReminder" class="secondary-button" type="button">🔔 Đôn đốc</button><button id="btnDirectiveEdit" class="secondary-button" type="button">Chỉnh sửa</button><button id="btnDirectiveLifecycle" class="secondary-button" type="button">' + (upper(directive.lifecycleStatus) === "CLOSED" ? "Mở lại" : "Đóng chỉ đạo") + '</button><button id="btnDirectiveDelete" class="danger-button" type="button">Xóa</button>' : ""}<button data-directive-close class="secondary-button" type="button">Đóng</button></footer>
    </section>`);

  backdrop.querySelector("#btnDirectiveAccept")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    try {
      button.disabled = true;
      button.textContent = "Đang xác nhận…";
      await ExecutiveDirectiveService.acceptDirective(directive, user.departmentId);
      backdrop.remove();
      await refreshAfterWrite();
      ToastService.success("Đã xác nhận tiếp nhận chỉ đạo.");
    } catch (error) {
      ToastService.error(error?.message || "Không xác nhận tiếp nhận được.");
      button.disabled = false;
      button.textContent = "✓ Xác nhận tiếp nhận";
    }
  });
  backdrop.querySelector("#btnDirectiveAssignInternal")?.addEventListener("click", () => { backdrop.remove(); openInternalAssignmentForm(directive); });
  backdrop.querySelector("#btnDirectivePersonalAccept")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    try {
      button.disabled = true;
      button.textContent = "Đang nhận việc…";
      await ExecutiveDirectiveService.acceptPersonalAssignment(directive, user.departmentId);
      backdrop.remove();
      await refreshAfterWrite();
      ToastService.success("Đã xác nhận nhận việc.");
    } catch (error) {
      ToastService.error(error?.message || "Không xác nhận nhận việc được.");
      button.disabled = false;
      button.textContent = "✓ Xác nhận nhận việc";
    }
  });
  backdrop.querySelector("#btnDirectiveProgress")?.addEventListener("click", () => { backdrop.remove(); openProgressForm(directive); });
  backdrop.querySelector("#btnDirectiveReminder")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    const note = await ModalService.prompt(`Nhập nội dung đôn đốc ${departmentName(scopeDepartment)}:`, { title: "Gửi đôn đốc", label: "Nội dung đôn đốc", defaultValue: "Đề nghị khẩn trương triển khai và cập nhật tiến độ thực hiện.", required: true, confirmText: "Gửi đôn đốc" });
    if (note === null) return;
    if (!clean(note)) return ToastService.error("Cần nhập nội dung đôn đốc.");
    try {
      button.disabled = true;
      button.textContent = "Đang gửi…";
      await ExecutiveDirectiveService.sendReminder(directive, scopeDepartment, note);
      backdrop.remove();
      await refreshAfterWrite();
      ToastService.success("Đã gửi đôn đốc và ghi vào lịch sử chỉ đạo.");
    } catch (error) {
      ToastService.error(error?.message || "Không gửi được đôn đốc.");
      button.disabled = false;
      button.textContent = "🔔 Đôn đốc";
    }
  });
  backdrop.querySelector("#btnDirectiveEdit")?.addEventListener("click", () => { backdrop.remove(); openDirectiveForm(directive); });
  backdrop.querySelector("#btnDirectiveLifecycle")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    const closing = upper(directive.lifecycleStatus) !== "CLOSED";
    const reason = closing ? await ModalService.prompt("Nhập lý do đóng chỉ đạo (có thể để trống):", { title: "Đóng nội dung chỉ đạo", label: "Lý do", confirmText: "Tiếp tục" }) : "";
    if (closing && reason === null) return;
    try {
      button.disabled = true;
      await ExecutiveDirectiveService.setLifecycle(directive, closing, reason || "");
      backdrop.remove(); await refreshAfterWrite(); ToastService.success(closing ? "Đã đóng nội dung chỉ đạo." : "Đã mở lại nội dung chỉ đạo.");
    } catch (error) { ToastService.error(error?.message || "Không cập nhật được trạng thái chỉ đạo."); button.disabled = false; }
  });
  backdrop.querySelector("#btnDirectiveDelete")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    const reason = await ModalService.prompt("Nhập lý do xóa nội dung chỉ đạo:", { title: "Xóa nội dung chỉ đạo", label: "Lý do xóa", required: true, confirmText: "Tiếp tục", danger: true });
    if (reason === null) return;
    if (!clean(reason)) return ToastService.error("Cần nhập lý do xóa.");
    if (!await ModalService.confirm("Xóa nội dung này khỏi danh sách sử dụng? Hệ thống vẫn giữ lịch sử để đối chiếu.", { title: "Xác nhận xóa chỉ đạo", confirmText: "Xóa khỏi danh sách", danger: true })) return;
    try {
      button.disabled = true;
      await ExecutiveDirectiveService.softDelete(directive, reason);
      backdrop.remove(); await refreshAfterWrite(); ToastService.success("Đã xóa nội dung chỉ đạo khỏi danh sách sử dụng.");
    } catch (error) { ToastService.error(error?.message || "Không xóa được nội dung chỉ đạo."); button.disabled = false; }
  });
}

function isDepartmentLeaderLike(user) {
  return upper(user?.role) === "DEPARTMENT_LEADER" || (upper(user?.role) === "TCHC_COORDINATOR" && upper(user?.departmentId) === "TCHC");
}

function historyItem(item) {
  const system = upper(item.departmentId) === "__SYSTEM__";
  const status = upper(item.status);
  const links = (item.evidenceLinks || []).map(url => safeLink(url)).filter(Boolean);
  return `<article class="directive-history-item"><div class="directive-history-dot"></div><div><header><strong>${esc(system ? "Quản trị chỉ đạo" : departmentName(item.departmentId))}</strong><span>${esc(formatDate(item.actionDateKey))} · ${esc(item.createdByName || "")}</span></header>${status ? statusPill({ label: STATUS_LABELS[status] || status, tone: status === "COMPLETED" ? "completed" : status === "IN_PROGRESS" ? "progress" : status === "ACCEPTED" ? "accepted" : status === "PAUSED" ? "paused" : "new" }) : ""}${item.progressSummary ? `<p><b>Tiến độ:</b> ${esc(item.progressSummary)}</p>` : ""}${item.resultSummary ? `<p><b>Kết quả:</b> ${esc(item.resultSummary)}</p>` : ""}${item.note ? `<p>${esc(item.note)}</p>` : ""}${links.length ? `<div class="directive-evidence-links">${links.join("")}</div>` : ""}</div></article>`;
}
function safeLink(url) {
  const text = clean(url);
  if (!/^https?:\/\//i.test(text)) return "";
  return `<a href="${esc(text)}" target="_blank" rel="noopener noreferrer">Minh chứng ↗</a>`;
}

function openInternalAssignmentForm(directive) {
  const user = UserContext.requireUser();
  const manager = Permissions.canManageExecutiveDirectives();
  const visible = (directive.visibleDepartmentIds || []).map(upper);
  const eligible = !manager && visible.includes(upper(user.departmentId)) && latestAcceptance(directive, user.departmentId) && canAssignInternalUi(directive, user.departmentId, user) && !latestProgress(directive, user.departmentId)
    ? [upper(user.departmentId)] : [];
  if (!eligible.length) {
    ToastService.error("Chỉ được phân công sau khi Phòng/Khu đã tiếp nhận và trước khi bắt đầu thực hiện.");
    return;
  }
  const departmentOptions = eligible.map(dep => `<option value="${esc(dep)}">${esc(departmentName(dep))}</option>`).join("");
  const backdrop = modalBackdrop(`
    <section class="directive-modal-card directive-progress-modal">
      <header class="directive-modal-header"><div><span class="page-eyebrow">PHÂN CÔNG THỰC HIỆN</span><h2>${esc(directive.content)}</h2><p>Trưởng/Phó Phòng/Khu có thể tự nhận hoặc giao cho một nhân viên thuộc đơn vị. Người được giao phải xác nhận nhận việc trước khi cập nhật tiến độ.</p></div><button data-directive-close class="modal-close-button" type="button">×</button></header>
      <div class="directive-modal-body"><div class="directive-form-grid">
        <label><span>Phòng/Khu *</span><select id="internalAssignDepartment" disabled>${departmentOptions}</select></label>
        <label><span>Người thực hiện *</span><select id="internalAssignUser"></select></label>
        <div id="internalAssignHint" class="field-full directive-assignment-hint"></div>
      </div></div>
      <footer class="directive-modal-footer"><button data-directive-close class="secondary-button" type="button">Hủy</button><button id="btnSaveInternalAssign" class="primary-button" type="button">Lưu phân công</button></footer>
    </section>`);
  const departmentSelect = backdrop.querySelector("#internalAssignDepartment");
  const userSelect = backdrop.querySelector("#internalAssignUser");
  const hint = backdrop.querySelector("#internalAssignHint");

  const refreshUsers = () => {
    const dep = upper(departmentSelect?.value || eligible[0]);
    const users = state.users
      .filter(item => item.active !== false && upper(item.departmentId) === dep)
      .sort((a, b) => clean(a.fullName || a.email).localeCompare(clean(b.fullName || b.email), "vi"));
    const current = latestInternalAssignment(directive, dep);
    userSelect.innerHTML = users.length
      ? users.map(item => {
          const uid = item.id || item.uid;
          const extra = [clean(item.position), clean(item.teamName || item.teamId)].filter(Boolean).join(" · ");
          return `<option value="${esc(uid)}" ${clean(current?.assignedUserId) === clean(uid) ? "selected" : ""}>${esc(item.fullName || item.email || uid)}${extra ? ` · ${esc(extra)}` : ""}</option>`;
        }).join("")
      : '<option value="">Không có tài khoản hoạt động trong đơn vị</option>';
    if (hint) hint.innerHTML = `<strong>Quy trình:</strong> ${esc(departmentName(dep))} đã tiếp nhận → phân công người thực hiện → người được giao xác nhận nhận việc → Đang thực hiện → Hoàn thành.`;
  };
  refreshUsers();
  departmentSelect?.addEventListener("change", refreshUsers);
  backdrop.querySelector("#btnSaveInternalAssign")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    const dep = departmentSelect?.value || eligible[0];
    const uid = userSelect?.value || "";
    if (!uid) return ToastService.error("Chưa chọn người thực hiện.");
    try {
      button.disabled = true;
      button.textContent = "Đang lưu…";
      await ExecutiveDirectiveService.assignInternal(directive, dep, uid);
      backdrop.remove();
      await refreshAfterWrite();
      ToastService.success("Đã phân công người thực hiện.");
    } catch (error) {
      ToastService.error(error?.message || "Không lưu được phân công.");
      button.disabled = false;
      button.textContent = "Lưu phân công";
    }
  });
}

function openProgressForm(directive) {
  const user = UserContext.requireUser();
  const manager = Permissions.canManageExecutiveDirectives();
  const visible = (directive.visibleDepartmentIds || []).map(upper);
  const eligible = !manager && visible.includes(upper(user.departmentId))
        && latestPersonalAcceptance(directive, user.departmentId)
        && isAssignedToCurrentUser(directive, user.departmentId, user)
        && canProgressDepartmentUi(directive, user.departmentId)
      ? [upper(user.departmentId)] : [];
  if (!eligible.length) {
    ToastService.error("Phòng/Khu phải tiếp nhận, phân công người thực hiện và người được giao phải xác nhận nhận việc trước.");
    return;
  }
  const targetOptions = eligible.map(id => `<option value="${esc(id)}">${esc(departmentName(id))} · ${esc(roleForDepartment(directive, id))}</option>`).join("");
  const defaultDepartment = eligible.includes(upper(directive.leadDepartmentId)) ? upper(directive.leadDepartmentId) : eligible[0];
  const backdrop = modalBackdrop(`
    <section class="directive-modal-card directive-progress-modal"><header class="directive-modal-header"><div><span class="page-eyebrow">CẬP NHẬT THỰC HIỆN</span><h2>${esc(directive.content)}</h2><p>Quy trình bắt buộc: Phòng/Khu tiếp nhận → phân công cá nhân → cá nhân nhận việc → Đang thực hiện → Hoàn thành. Mỗi lần lưu tạo một dòng lịch sử mới.</p></div><button data-directive-close class="modal-close-button" type="button">×</button></header><div class="directive-modal-body"><div class="directive-form-grid"><label><span>Phòng/Khu cập nhật *</span><select id="progressDepartment" disabled>${targetOptions}</select></label><label><span>Trạng thái *</span><select id="progressStatus"></select></label><label class="field-full"><span>Tiến độ thực hiện</span><textarea id="progressSummary" rows="3" maxlength="3000" placeholder="Nêu ngắn gọn nội dung đang thực hiện"></textarea></label><label class="field-full"><span>Kết quả</span><textarea id="progressResult" rows="4" maxlength="4000" placeholder="Khi chọn Hoàn thành, bắt buộc nhập kết quả đã thực hiện"></textarea></label><label class="field-full"><span>Liên kết minh chứng</span><textarea id="progressEvidence" rows="3" placeholder="Mỗi dòng một liên kết http:// hoặc https://"></textarea></label><label class="field-full"><span>Ghi chú</span><textarea id="progressNote" rows="2" maxlength="2000"></textarea></label><div id="progressWorkflowHint" class="field-full directive-assignment-hint"></div></div></div><footer class="directive-modal-footer"><button data-directive-close class="secondary-button" type="button">Hủy</button><button id="btnSaveProgress" class="primary-button" type="button">Lưu cập nhật</button></footer></section>`);
  const departmentSelect = backdrop.querySelector("#progressDepartment");
  const statusSelect = backdrop.querySelector("#progressStatus");
  const hint = backdrop.querySelector("#progressWorkflowHint");
  if (departmentSelect) departmentSelect.value = defaultDepartment;

  const refreshForm = () => {
    const dep = departmentSelect?.value || defaultDepartment;
    const latest = latestProgress(directive, dep);
    const previous = upper(latest?.status || "ACCEPTED");
    const assignment = latestInternalAssignment(directive, dep);
    let options = [];
    if (["ACCEPTED", "PAUSED"].includes(previous)) options = [{ value: "IN_PROGRESS", label: "Đang thực hiện" }];
    else if (previous === "IN_PROGRESS") options = [
      { value: "IN_PROGRESS", label: "Đang thực hiện (cập nhật thêm tiến độ)" },
      { value: "PAUSED", label: "Tạm dừng" },
      { value: "COMPLETED", label: "Hoàn thành" }
    ];
    else if (previous === "COMPLETED") options = [];
    statusSelect.innerHTML = options.length
      ? options.map(item => `<option value="${item.value}">${item.label}</option>`).join("")
      : '<option value="">Đã hoàn thành</option>';
    statusSelect.disabled = !options.length;
    const progress = backdrop.querySelector("#progressSummary"); if (progress) progress.value = latest?.progressSummary || "";
    const result = backdrop.querySelector("#progressResult"); if (result) result.value = latest?.resultSummary || "";
    const evidence = backdrop.querySelector("#progressEvidence"); if (evidence) evidence.value = (latest?.evidenceLinks || []).join("\n");
    const note = backdrop.querySelector("#progressNote"); if (note) note.value = latest?.note || "";
    const who = clean(assignment?.assignedUserName) || "người được giao";
    if (hint) hint.innerHTML = previous === "ACCEPTED"
      ? `<strong>${esc(who)} đã nhận việc.</strong> Bước tiếp theo bắt buộc: chuyển sang Đang thực hiện.`
      : previous === "IN_PROGRESS"
        ? `<strong>${esc(who)} đang thực hiện:</strong> có thể cập nhật thêm tiến độ, Tạm dừng hoặc Hoàn thành.`
        : previous === "PAUSED"
          ? "<strong>Đang tạm dừng:</strong> phải chuyển lại Đang thực hiện trước khi Hoàn thành."
          : "<strong>Đã hoàn thành:</strong> không thể cập nhật thêm trạng thái thực hiện.";
    const save = backdrop.querySelector("#btnSaveProgress"); if (save) save.disabled = !options.length;
  };
  refreshForm();
  departmentSelect?.addEventListener("change", refreshForm);
  backdrop.querySelector("#btnSaveProgress")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    const evidenceLinks = clean(backdrop.querySelector("#progressEvidence")?.value).split(/\r?\n/).map(clean).filter(Boolean);
    const invalid = evidenceLinks.find(url => !/^https?:\/\//i.test(url));
    if (invalid) return ToastService.error("Liên kết minh chứng phải bắt đầu bằng http:// hoặc https://.");
    const status = statusSelect?.value;
    if (!status) return ToastService.error("Nội dung đã hoàn thành hoặc không có trạng thái hợp lệ để cập nhật.");
    if (status === "COMPLETED" && !clean(backdrop.querySelector("#progressResult")?.value)) {
      return ToastService.error("Khi hoàn thành phải nhập kết quả thực hiện.");
    }
    try {
      button.disabled = true;
      await ExecutiveDirectiveService.addProgressUpdate(directive, departmentSelect?.value || user.departmentId, {
        status,
        progressSummary: backdrop.querySelector("#progressSummary")?.value,
        resultSummary: backdrop.querySelector("#progressResult")?.value,
        evidenceLinks,
        note: backdrop.querySelector("#progressNote")?.value
      });
      backdrop.remove(); await refreshAfterWrite(); ToastService.success(status === "COMPLETED" ? "Đã cập nhật Hoàn thành." : "Đã lưu cập nhật thực hiện.");
    } catch (error) { ToastService.error(error?.message || "Không lưu được cập nhật thực hiện."); button.disabled = false; }
  });
}

async function refreshAfterWrite() {
  // Realtime onSnapshot là nguồn đồng bộ chính. Không query lại toàn bộ collection sau mỗi lần ghi.
  // Render trạng thái hiện có ngay; listener sẽ tự cập nhật bản mới khi Firestore phát snapshot.
  renderCurrentTab();
  await Promise.resolve();
}

function modalBackdrop(html) {
  const node = document.createElement("div");
  node.className = "directive-modal-backdrop";
  node.innerHTML = html;
  document.body.appendChild(node);
  const close = () => node.remove();
  node.querySelectorAll("[data-directive-close]").forEach(button => button.addEventListener("click", close));
  node.addEventListener("click", event => { if (event.target === node) close(); });
  return node;
}
function loadingCard(message) { return `<section class="page-card"><div class="empty-state"><div class="empty-icon">⏳</div><strong>${esc(message)}</strong></div></section>`; }
function errorCard(title, error) { return `<section class="page-card error-card"><h2>${esc(title)}</h2><p>${esc(error?.message || "Lỗi không xác định")}</p></section>`; }
function emptyState(message) { return `<div class="directive-empty"><span>📌</span><strong>${esc(message)}</strong></div>`; }
