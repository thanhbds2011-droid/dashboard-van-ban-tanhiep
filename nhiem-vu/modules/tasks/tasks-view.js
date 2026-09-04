import { UserContext } from "../../core/user-context.js?v=20260903.V1_22_5";
import { Permissions } from "../../core/permissions.js?v=20260903.V1_22_5";
import { ToastService } from "../../core/toast-service.js?v=20260903.V1_22_5";
import { TaskReadService } from "../../services/task-read-service.js?v=20260903.V1_22_5";
import { TaskWriteService } from "../../services/task-write-service.js?v=20260903.V1_22_5";
import { openTaskCreateModal } from "./task-form-modal.js?v=20260903.V1_22_5";
import { openTaskDetailModal } from "./task-detail-modal.js?v=20260903.V1_22_5";
import { effectiveDepartmentAssignmentStatus } from "../../core/task-display-order.js?v=20260903.V1_22_5";

let renderSequence = 0;
let currentTasks = [];
let currentOutlet = null;
let stopTaskRealtime = null;
let taskRealtimeCleanupBound = false;
let taskRealtimeErrorShown = false;
let taskViewMode = "MINE";

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

function taskWorkspaceId(task) {
  const organizationId = String(task?.organizationId || "").toUpperCase();
  const standardDepartmentId = String(task?.standardTaskDepartmentId || "").toUpperCase();
  const primaryDepartmentId = String(task?.primaryDepartmentId || "").toUpperCase();
  const taskCode = String(task?.taskCode || task?.standardTaskCode || "").toUpperCase();
  if (organizationId === "CDTN" || standardDepartmentId === "CDTN" || primaryDepartmentId === "CDTN" || taskCode.startsWith("CDTN")) return "CDTN";
  return primaryDepartmentId;
}

function stopTasksRealtime() {
  try { stopTaskRealtime?.(); } catch (_) { /* Đóng listener an toàn. */ }
  stopTaskRealtime = null;
}

function bindTasksRealtimeCleanup() {
  if (taskRealtimeCleanupBound) return;
  taskRealtimeCleanupBound = true;
  document.addEventListener("v3:route-changed", event => {
    if (event.detail?.route !== "#/tasks") stopTasksRealtime();
  });
}

function startTasksRealtime(outlet, sequence) {
  stopTasksRealtime();
  bindTasksRealtimeCleanup();
  taskRealtimeErrorShown = false;
  stopTaskRealtime = TaskReadService.subscribe(
    tasks => {
      if (sequence !== renderSequence || currentOutlet !== outlet || window.location.hash !== "#/tasks") return;
      currentTasks = tasks;
      updateTasksPage(currentTasks);
      const live = document.getElementById("taskRealtimeState");
      if (live) {
        live.textContent = "";
        live.hidden = true;
      }
    },
    error => {
      console.warn("Không thể đồng bộ nhiệm vụ trực tiếp:", error);
      if (!taskRealtimeErrorShown && window.location.hash === "#/tasks") {
        taskRealtimeErrorShown = true;
        ToastService.error("Đồng bộ trực tiếp tạm gián đoạn; nút Cập nhật vẫn sử dụng được.");
      }
    },
    { startDelayMs: 0, jitterMs: 1200 }
  );
}


export async function renderTasksView(outlet) {
  currentOutlet = outlet;
  taskViewMode = "MINE";
  const sequence = ++renderSequence;
  outlet.innerHTML = loadingCard("Đang tải danh sách nhiệm vụ…");

  try {
    const [tasks, canCreateUnexpectedTask] = await Promise.all([
      TaskReadService.list({ force: false }),
      TaskWriteService.canCreateUnexpectedTask().catch(() => false)
    ]);
    currentTasks = tasks;
    if (sequence !== renderSequence || currentOutlet !== outlet || window.location.hash !== "#/tasks") return;
    mountTasksPage(outlet, canCreateUnexpectedTask && !Permissions.isDirector());
    updateTasksPage(currentTasks);
    startTasksRealtime(outlet, sequence);
  } catch (error) {
    renderTaskLoadError(outlet, error);
  }
}

function renderTaskLoadError(outlet, error) {
  outlet.innerHTML = `<section class="page-card error-card">
    <h2>Chưa tải được nhiệm vụ</h2>
    <p>${escapeHtml(userFacingLoadError(error))}</p>
    <div class="page-actions"><button id="retryTaskLoad" class="primary-button" type="button">↻ Thử lại</button></div>
  </section>`;
  document.getElementById("retryTaskLoad")?.addEventListener("click", () => {
    TaskReadService.invalidate();
    void renderTasksView(outlet);
  });
}

function userFacingLoadError(error) {
  const code = String(error?.code || "").toLowerCase();
  const detail = String(error?.message || "");
  if (["permission-denied", "firestore/permission-denied"].includes(code)
      || /missing or insufficient permissions/i.test(detail)) {
    return "Chưa tải được nhiệm vụ theo phạm vi tài khoản. Vui lòng bấm Cập nhật; nếu lỗi vẫn còn, liên hệ quản trị viên.";
  }
  return "Không thể tải dữ liệu nhiệm vụ vào lúc này. Vui lòng kiểm tra kết nối và thử lại.";
}

function mountTasksPage(outlet, canCreateUnexpectedTask = false) {
  outlet.innerHTML = `<section class="page-card tasks-page-card">
    <div class="page-header"><div><h2>Nhiệm vụ</h2><p>Bàn làm việc cá nhân: theo dõi nhiệm vụ của chính bạn, tiến độ và kết quả hoàn thành.</p><small id="taskRealtimeState" class="realtime-state" hidden></small></div>${canCreateUnexpectedTask ? '<button id="btnCreateTask" class="primary-button" type="button">＋ Giao nhiệm vụ đột xuất</button>' : ""}</div>
    ${(Permissions.canReviewStaffTask() || Permissions.isDepartmentLeader()) ? `<div class="task-scope-tabs">
      <button type="button" class="secondary-button is-active" data-task-scope="MINE">Nhiệm vụ của tôi</button>
      <button type="button" class="secondary-button" data-task-scope="MANAGEMENT">Điều hành Phòng/Khu</button>
    </div>` : ""}
    <div class="summary-grid compact-grid tasks-summary-grid">
      ${card("Tất cả", 0, "taskMetricTotal")}
      ${card("Đang xử lý", 0, "taskMetricInProgress")}
      ${card("Chờ phân công", 0, "taskMetricWaiting")}
      ${card("Trễ hạn", 0, "taskMetricOverdue")}
      ${card("Hoàn thành", 0, "taskMetricCompleted")}
      ${card("Chờ duyệt điều chỉnh", 0, "taskMetricAdjustment")}
      ${card("Miễn đánh giá", 0, "taskMetricExempt")}
    </div>
    <div class="toolbar tasks-toolbar tasks-toolbar-compact">
      <label class="field-grow"><span>Tìm kiếm</span><input id="taskSearch" type="search" placeholder="Tìm mã, tiêu đề, người thực hiện…"></label>
      ${(Permissions.canViewAllDepartments() || Permissions.isCdtnMember()) ? '<label><span>Phạm vi</span><select id="taskDepartmentFilter"><option value="ALL">Tất cả nhiệm vụ</option></select></label>' : ""}
      <label><span>Trạng thái</span><select id="taskStatusFilter"><option value="ALL">Tất cả trạng thái</option><option value="IN_PROGRESS">Đang xử lý</option><option value="WAITING">Chờ tiếp nhận/phân công</option><option value="OVERDUE">Trễ hạn</option><option value="COMPLETED">Hoàn thành</option><option value="ADJUSTMENT_PENDING">Chờ duyệt điều chỉnh</option><option value="EXEMPT">Miễn đánh giá</option></select></label>
      <button id="refreshTasks" class="secondary-button compact-sync-button" type="button" title="Cập nhật danh sách nhiệm vụ" aria-label="Cập nhật danh sách nhiệm vụ">↻</button>
    </div>
    <div id="taskWorkspaceContainer" class="task-workspace-grid">
      <section class="task-workspace-panel" data-task-workspace="PROFESSIONAL">
        <header><div><h3>Nhiệm vụ Phòng/Khu</h3></div><span id="taskProfessionalCount" class="task-workspace-count">0</span></header>
        <div id="taskProfessionalList" class="task-list-scroll"></div>
      </section>
      <section id="taskCdtnPanel" class="task-workspace-panel task-workspace-cdtn" data-task-workspace="CDTN">
        <header><div><h3>Nhiệm vụ Chi đoàn</h3></div><span id="taskCdtnCount" class="task-workspace-count">0</span></header>
        <div id="taskCdtnList" class="task-list-scroll"></div>
      </section>
    </div>
  </section>`;

  const refreshOnce = async () => {
    const button = document.getElementById("refreshTasks");
    if (button) {
      button.disabled = true;
      button.classList.add("is-loading");
    }
    try {
      currentTasks = await TaskReadService.list({ force: true });
      updateTasksPage(currentTasks);
    } catch (error) {
      ToastService.error(userFacingLoadError(error));
    } finally {
      if (button) {
        button.disabled = false;
        button.classList.remove("is-loading");
      }
    }
  };

  document.getElementById("btnCreateTask")?.addEventListener("click", () => openTaskCreateModal({ onSaved: refreshOnce }));
  document.getElementById("refreshTasks")?.addEventListener("click", refreshOnce);
  document.getElementById("taskSearch")?.addEventListener("input", renderFilteredTasks);
  document.getElementById("taskStatusFilter")?.addEventListener("change", renderFilteredTasks);
  document.getElementById("taskDepartmentFilter")?.addEventListener("change", renderFilteredTasks);
  document.querySelectorAll("[data-task-scope]").forEach(button => button.addEventListener("click", () => {
    taskViewMode = button.dataset.taskScope === "MANAGEMENT" ? "MANAGEMENT" : "MINE";
    document.querySelectorAll("[data-task-scope]").forEach(item => item.classList.toggle("is-active", item === button));
    updateTasksPage(currentTasks);
  }));
}

function scopedTasks(tasks = currentTasks) {
  const uid = UserContext.requireUser().uid;
  if (taskViewMode === "MANAGEMENT") {
    return tasks.filter(task => String(task.ownerUserId || "") !== uid);
  }
  return tasks.filter(task => String(task.ownerUserId || "") === uid);
}

function populateDepartmentFilter(tasks) {
  const select = document.getElementById("taskDepartmentFilter");
  if (!select) return;
  const current = select.value || "ALL";
  const departments = [...new Set(tasks.map(task => String(task.primaryDepartmentId || "").toUpperCase()).filter(Boolean))]
    .sort((a, b) => (DEPARTMENT_NAMES[a] || a).localeCompare(DEPARTMENT_NAMES[b] || b, "vi"));
  const allLabel = Permissions.canViewAllDepartments() ? "Toàn Trung tâm" : "Tất cả nhiệm vụ của tôi";
  select.innerHTML = `<option value="ALL">${allLabel}</option>${departments.map(id => `<option value="${escapeHtml(id)}">${escapeHtml(DEPARTMENT_NAMES[id] || id)}</option>`).join("")}`;
  select.value = departments.includes(current) ? current : "ALL";
}

function updateTasksPage(tasks) {
  const visibleTasks = scopedTasks(tasks);
  const summary = TaskReadService.summarize(visibleTasks);
  setText("taskMetricTotal", summary.total);
  setText("taskMetricInProgress", summary.inProgress);
  setText("taskMetricWaiting", summary.waitingAssignment);
  setText("taskMetricOverdue", summary.overdue);
  setText("taskMetricCompleted", summary.completed);
  setText("taskMetricAdjustment", summary.adjustmentPending);
  setText("taskMetricExempt", summary.exempt);
  populateDepartmentFilter(visibleTasks);
  renderFilteredTasks();
}

function renderFilteredTasks() {
  const search = document.getElementById("taskSearch");
  const filter = document.getElementById("taskStatusFilter");
  const departmentFilter = document.getElementById("taskDepartmentFilter");
  const keyword = String(search?.value || "").trim().toLowerCase();
  const status = filter?.value || "ALL";
  const departmentId = departmentFilter?.value || "ALL";
  const filtered = scopedTasks(currentTasks).filter(task => {
    const text = [task.taskCode, task.title, task.ownerName, task.createdByName, taskWorkspaceId(task)].join(" ").toLowerCase();
    const keywordMatch = !keyword || text.includes(keyword);
    const departmentMatch = departmentId === "ALL" || taskWorkspaceId(task) === departmentId;
    const statusMatch = status === "ALL" ||
      (status === "IN_PROGRESS" && !task._completed && !task._exempt && !task._overdue && !["CHO_PHONG_KHU_TIEP_NHAN", "CHO_PHAN_CONG", "PENDING_ASSIGNMENT", "DA_PHAN_CONG", "MOI_TIEP_NHAN"].includes(task._status)) ||
      (status === "WAITING" && !task._exempt && ["CHO_PHONG_KHU_TIEP_NHAN", "CHO_PHAN_CONG", "PENDING_ASSIGNMENT", "DA_PHAN_CONG", "MOI_TIEP_NHAN"].includes(task._status)) ||
      (status === "OVERDUE" && task._overdue) ||
      (status === "COMPLETED" && task._completed) ||
      (status === "ADJUSTMENT_PENDING" && String(task.adjustmentStatus || "").toUpperCase() === "REQUESTED") ||
      (status === "EXEMPT" && String(task.scoringStatus || "").toUpperCase() === "ADJUSTMENT_EXEMPT");
    return keywordMatch && departmentMatch && statusMatch;
  });

  const professional = filtered.filter(task => taskWorkspaceId(task) !== "CDTN");
  const cdtn = filtered.filter(task => taskWorkspaceId(task) === "CDTN");
  const professionalContainer = document.getElementById("taskProfessionalList");
  const cdtnContainer = document.getElementById("taskCdtnList");
  const cdtnPanel = document.getElementById("taskCdtnPanel");
  if (!professionalContainer || !cdtnContainer || !cdtnPanel) return;

  professionalContainer.innerHTML = renderTaskList(professional, "Chưa có nhiệm vụ chuyên môn trong phạm vi hiển thị");
  cdtnContainer.innerHTML = renderTaskList(cdtn, "Chưa có nhiệm vụ Chi đoàn trong phạm vi hiển thị");
  cdtnPanel.hidden = cdtn.length === 0 && !scopedTasks(currentTasks).some(task => taskWorkspaceId(task) === "CDTN");
  setText("taskProfessionalCount", professional.length);
  setText("taskCdtnCount", cdtn.length);
  bindRows(filtered);
}

function taskOwnerSummary(task) {
  if (String(task?.ownerName || "").trim()) return task.ownerName;
  const departmentId = taskWorkspaceId(task);
  const department = DEPARTMENT_NAMES[departmentId] || departmentId || "Phòng/Khu";
  const departmentStatus = String(task?._departmentAssignmentStatus || task?.departmentAssignmentStatus || "").toUpperCase();
  if (departmentStatus === "PENDING_ACCEPTANCE" || task?._status === "CHO_PHONG_KHU_TIEP_NHAN") {
    return `${department} — Chờ tiếp nhận`;
  }
  return `${department} — Chờ phân công`;
}

function taskStatusDescriptor(task) {
  const scoringStatus = String(task.scoringStatus || "").toUpperCase();
  const adjustmentStatus = String(task.adjustmentStatus || "").toUpperCase();
  const status = String(task._status || task.status || "").toUpperCase();
  const departmentStatus = effectiveDepartmentAssignmentStatus(task);
  if (scoringStatus === "ADJUSTMENT_EXEMPT") return { label: "Miễn đánh giá", className: "info" };
  if (adjustmentStatus === "REQUESTED") return { label: "Chờ duyệt điều chỉnh", className: "warning" };
  if (task._overdue) return { label: "Trễ hạn", className: "danger" };
  const eventDriven = String(task.deadlineMode || "").toUpperCase() === "EVENT_DRIVEN";
  if (eventDriven && task._completed) return { label: "Đã kết thúc theo dõi", className: "success" };
  if (task._completed) return { label: "Hoàn thành", className: "success" };
  if (eventDriven && status === "TAM_DUNG") return { label: "Tạm dừng", className: "warning" };
  if (eventDriven) return { label: "Theo dõi phát sinh", className: "info" };
  if (departmentStatus === "PENDING_ACCEPTANCE" || status === "CHO_PHONG_KHU_TIEP_NHAN") {
    return { label: "Chờ Phòng/Khu tiếp nhận", className: "warning" };
  }
  if (["CHO_PHAN_CONG", "PENDING_ASSIGNMENT"].includes(status)) return { label: "Phòng/Khu đã nhận — Chờ phân công", className: "warning" };
  if (["DA_PHAN_CONG", "MOI_TIEP_NHAN"].includes(status)) return { label: "Chờ cá nhân tiếp nhận", className: "warning" };
  return { label: "Đang xử lý", className: "neutral" };
}

function bindRows(tasks) {
  document.querySelectorAll("[data-task-id]").forEach(row => {
    row.addEventListener("click", () => {
      const task = tasks.find(item => item.id === row.dataset.taskId);
      if (!task) return;
      openTaskDetailModal(task, {
        onSaved: async () => {
          /* V1.22.0: thao tác hằng ngày chỉ tải lại đúng task vừa đổi; realtime vẫn là lớp đồng bộ nền. */
          try {
            const refreshed = await TaskReadService.getById(task.id);
            currentTasks = currentTasks.filter(item => item.id !== task.id);
            if (refreshed) currentTasks.push(refreshed);
            updateTasksPage(currentTasks);
          } catch (error) {
            console.warn("Không cập nhật cục bộ được nhiệm vụ; fallback tải lại phạm vi hiện tại:", error);
            currentTasks = await TaskReadService.list({ force: true });
            updateTasksPage(currentTasks);
          }
        }
      });
    });
  });
}

function renderTaskList(tasks, emptyTitle = "Không có nhiệm vụ trong phạm vi hiển thị") {
  if (!tasks.length) return `<div class="empty-state compact-empty-state"><div class="empty-icon">📋</div><strong>${escapeHtml(emptyTitle)}</strong><p>Hãy thay đổi bộ lọc hoặc chờ nhiệm vụ được giao.</p></div>`;
  return `<div class="data-list">${tasks.slice(0, 500).map(task => {
    const status = taskStatusDescriptor(task);
    const eventDriven = String(task.deadlineMode || "").toUpperCase() === "EVENT_DRIVEN";
    const eventCount = Math.max(0, Number(task.eventWorkItemCount || 0));
    const eventEligible = Math.max(0, Number(task.eventEligibleCount || 0));
    const eventProgress = task.eventProgressRate === null || task.eventProgressRate === undefined ? null : Number(task.eventProgressRate);
    const eventCompleted = Math.max(0, Number(task.eventCompletedCount || 0));
    const progressValue = eventDriven
      ? (task._completed ? 100 : (eventProgress ?? 0))
      : Number(task.progress || 0);
    const progressLabel = eventDriven
      ? (task._completed
          ? "100% hoàn thành"
          : eventCount === 0
            ? "Chưa phát sinh"
            : eventEligible === 0
              ? `${eventCount} lượt · chưa đến hạn`
              : `KPI ${eventProgress ?? 0}%`)
      : `${Number(task.progress || 0)}%`;
    const secondary = eventDriven
      ? (task._completed
          ? `${eventCompleted || eventCount}/${eventCount || eventCompleted} lượt hoàn thành · KPI tiến độ ${eventProgress ?? 0}%`
          : (eventCount ? `${eventCount} lượt đã ghi nhận` : "Theo từng lượt phát sinh"))
      : formatDate(task._deadline);
    return `<button type="button" class="data-row task-row-button" data-task-id="${escapeHtml(task.id)}"><div class="data-row-main"><strong>${escapeHtml(task.title || task.taskCode || "Nhiệm vụ không có tiêu đề")}</strong><small>${escapeHtml(task.taskCode || task.id)} • ${escapeHtml(DEPARTMENT_NAMES[taskWorkspaceId(task)] || taskWorkspaceId(task) || "-")} • ${escapeHtml(taskOwnerSummary(task))}</small><div class="progress-track"><span style="width:${Math.min(100, Math.max(0, progressValue))}%"></span></div></div><div class="data-row-meta"><span class="status-pill ${status.className}">${status.label}</span><small>${escapeHtml(secondary)}</small><strong>${escapeHtml(progressLabel)}</strong></div></button>`;
  }).join("")}</div>`;
}

function setText(id, value) {
  const target = document.getElementById(id);
  if (target) target.textContent = String(value);
}
function formatDate(date) { return date instanceof Date ? new Intl.DateTimeFormat("vi-VN").format(date) : "Không có hạn"; }
function card(label, value, id) { return `<article class="summary-card"><span>${label}</span><strong id="${id}">${value}</strong></article>`; }
function loadingCard(message) { return `<section class="page-card"><div class="empty-state"><div class="empty-icon">⏳</div><strong>${escapeHtml(message)}</strong></div></section>`; }
function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
