import { Permissions } from "../../core/permissions.js?v=20260803.V1_7_1";
import { ToastService } from "../../core/toast-service.js";
import { TaskReadService } from "../../services/task-read-service.js?v=20260803.V1_7_1";
import { openTaskCreateModal } from "./task-form-modal.js?v=20260803.V1_7_1";
import { openTaskDetailModal } from "./task-detail-modal.js?v=20260803.V1_7_1";

let renderSequence = 0;
let currentTasks = [];
let currentOutlet = null;

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

export async function renderTasksView(outlet) {
  currentOutlet = outlet;
  const sequence = ++renderSequence;
  outlet.innerHTML = loadingCard("Đang tải danh sách nhiệm vụ…");

  try {
    currentTasks = await TaskReadService.list({ force: false });
    if (sequence !== renderSequence || currentOutlet !== outlet || window.location.hash !== "#/tasks") return;
    mountTasksPage(outlet);
    updateTasksPage(currentTasks);
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
    return "Chưa tải được nhiệm vụ theo phạm vi tài khoản. Hệ thống đã ghi nhận lỗi phân quyền; hãy thử lại sau khi Rules V1.7.1 được Publish.";
  }
  return "Không thể tải dữ liệu nhiệm vụ vào lúc này. Vui lòng kiểm tra kết nối và thử lại.";
}

function mountTasksPage(outlet) {
  outlet.innerHTML = `<section class="page-card tasks-page-card">
    <div class="page-header"><div><h2>Nhiệm vụ</h2><p>Theo dõi nhiệm vụ được giao, tiến độ thực hiện và kết quả hoàn thành.</p></div>${Permissions.canCreateUnexpectedTask() ? '<button id="btnCreateTask" class="primary-button" type="button">＋ Giao nhiệm vụ đột xuất</button>' : ""}</div>
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
      <label><span>Trạng thái</span><select id="taskStatusFilter"><option value="ALL">Tất cả trạng thái</option><option value="IN_PROGRESS">Đang xử lý</option><option value="WAITING">Chờ phân công</option><option value="OVERDUE">Trễ hạn</option><option value="COMPLETED">Hoàn thành</option><option value="ADJUSTMENT_PENDING">Chờ duyệt điều chỉnh</option><option value="EXEMPT">Miễn đánh giá</option></select></label>
      <button id="refreshTasks" class="secondary-button compact-sync-button" type="button" title="Cập nhật danh sách nhiệm vụ" aria-label="Cập nhật danh sách nhiệm vụ">↻</button>
    </div>
    <div id="taskListContainer" class="task-list-scroll"></div>
  </section>`;

  const refreshOnce = async () => {
    const button = document.getElementById("refreshTasks");
    if (button) button.disabled = true;
    try {
      currentTasks = await TaskReadService.list({ force: true });
      updateTasksPage(currentTasks);
    } catch (error) {
      ToastService.error(userFacingLoadError(error));
    } finally {
      if (button) button.disabled = false;
    }
  };

  document.getElementById("btnCreateTask")?.addEventListener("click", () => openTaskCreateModal({ onSaved: refreshOnce }));
  document.getElementById("refreshTasks")?.addEventListener("click", refreshOnce);
  document.getElementById("taskSearch")?.addEventListener("input", renderFilteredTasks);
  document.getElementById("taskStatusFilter")?.addEventListener("change", renderFilteredTasks);
  document.getElementById("taskDepartmentFilter")?.addEventListener("change", renderFilteredTasks);
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
  const summary = TaskReadService.summarize(tasks);
  setText("taskMetricTotal", summary.total);
  setText("taskMetricInProgress", summary.inProgress);
  setText("taskMetricWaiting", summary.waitingAssignment);
  setText("taskMetricOverdue", summary.overdue);
  setText("taskMetricCompleted", summary.completed);
  setText("taskMetricAdjustment", summary.adjustmentPending);
  setText("taskMetricExempt", summary.exempt);
  populateDepartmentFilter(tasks);
  renderFilteredTasks();
}

function renderFilteredTasks() {
  const search = document.getElementById("taskSearch");
  const filter = document.getElementById("taskStatusFilter");
  const departmentFilter = document.getElementById("taskDepartmentFilter");
  const keyword = String(search?.value || "").trim().toLowerCase();
  const status = filter?.value || "ALL";
  const departmentId = departmentFilter?.value || "ALL";
  const filtered = currentTasks.filter(task => {
    const text = [task.taskCode, task.title, task.ownerName, task.createdByName, task.primaryDepartmentId].join(" ").toLowerCase();
    const keywordMatch = !keyword || text.includes(keyword);
    const departmentMatch = departmentId === "ALL" || String(task.primaryDepartmentId || "").toUpperCase() === departmentId;
    const statusMatch = status === "ALL" ||
      (status === "IN_PROGRESS" && !task._completed && !task._exempt && !task._overdue && !["CHO_PHAN_CONG", "PENDING_ASSIGNMENT", "MOI_TIEP_NHAN"].includes(task._status)) ||
      (status === "WAITING" && !task._exempt && ["CHO_PHAN_CONG", "PENDING_ASSIGNMENT", "MOI_TIEP_NHAN"].includes(task._status)) ||
      (status === "OVERDUE" && task._overdue) ||
      (status === "COMPLETED" && task._completed) ||
      (status === "ADJUSTMENT_PENDING" && String(task.adjustmentStatus || "").toUpperCase() === "REQUESTED") ||
      (status === "EXEMPT" && String(task.scoringStatus || "").toUpperCase() === "ADJUSTMENT_EXEMPT");
    return keywordMatch && departmentMatch && statusMatch;
  });

  const container = document.getElementById("taskListContainer");
  if (!container) return;
  container.innerHTML = renderTaskList(filtered);
  bindRows(filtered);
}

function bindRows(tasks) {
  document.querySelectorAll("[data-task-id]").forEach(row => {
    row.addEventListener("click", () => {
      const task = tasks.find(item => item.id === row.dataset.taskId);
      if (!task) return;
      openTaskDetailModal(task, {
        onSaved: async () => {
          TaskReadService.invalidate();
          currentTasks = await TaskReadService.list({ force: true });
          updateTasksPage(currentTasks);
        }
      });
    });
  });
}

function renderTaskList(tasks) {
  if (!tasks.length) return `<div class="empty-state"><div class="empty-icon">📋</div><strong>Không có nhiệm vụ trong phạm vi hiển thị</strong><p>Hãy thay đổi bộ lọc hoặc chờ nhiệm vụ được giao.</p></div>`;
  return `<div class="data-list">${tasks.slice(0, 500).map(task => {
    const scoringStatus = String(task.scoringStatus || "").toUpperCase();
    const adjustmentStatus = String(task.adjustmentStatus || "").toUpperCase();
    const status = scoringStatus === "ADJUSTMENT_EXEMPT"
      ? { label: "Miễn đánh giá", className: "info" }
      : adjustmentStatus === "REQUESTED"
        ? { label: "Chờ duyệt điều chỉnh", className: "warning" }
        : task._overdue
          ? { label: "Trễ hạn", className: "danger" }
          : task._completed
            ? { label: "Hoàn thành", className: "success" }
            : ["CHO_PHAN_CONG", "PENDING_ASSIGNMENT"].includes(task._status)
              ? { label: "Chờ phân công", className: "warning" }
              : task._status === "MOI_TIEP_NHAN"
                ? { label: "Chờ tiếp nhận", className: "warning" }
                : { label: "Đang xử lý", className: "neutral" };
    return `<button type="button" class="data-row task-row-button" data-task-id="${escapeHtml(task.id)}"><div class="data-row-main"><strong>${escapeHtml(task.title || task.taskCode || "Nhiệm vụ không có tiêu đề")}</strong><small>${escapeHtml(task.taskCode || task.id)} • ${escapeHtml(DEPARTMENT_NAMES[String(task.primaryDepartmentId || "").toUpperCase()] || task.primaryDepartmentId || "-")} • ${escapeHtml(task.ownerName || "Chưa phân công")}</small><div class="progress-track"><span style="width:${Math.min(100, Math.max(0, Number(task.progress || 0)))}%"></span></div></div><div class="data-row-meta"><span class="status-pill ${status.className}">${status.label}</span><small>${formatDate(task._deadline)}</small><strong>${Number(task.progress || 0)}%</strong></div></button>`;
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
