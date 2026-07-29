import { Permissions } from "../../core/permissions.js";
import { ToastService } from "../../core/toast-service.js";
import { TaskReadService } from "../../services/task-read-service.js?v=20260728.V1_1_7";
import { openTaskCreateModal } from "./task-form-modal.js";
import { openTaskDetailModal } from "./task-detail-modal.js?v=20260728.V1_1_7";

let renderSequence = 0;
let stopRealtime = () => {};
let routeCleanupBound = false;
let currentTasks = [];
let currentOutlet = null;

function bindRouteCleanup() {
  if (routeCleanupBound) return;
  routeCleanupBound = true;
  document.addEventListener("v3:route-changed", event => {
    if (event.detail?.route !== "#/tasks") {
      stopRealtime();
      stopRealtime = () => {};
      currentOutlet = null;
    }
  });
}

export async function renderTasksView(outlet) {
  bindRouteCleanup();
  stopRealtime();
  stopRealtime = () => {};
  currentOutlet = outlet;
  const sequence = ++renderSequence;
  outlet.innerHTML = loadingCard("Đang tải danh sách nhiệm vụ…");

  try {
    currentTasks = await TaskReadService.list();
    if (sequence !== renderSequence || currentOutlet !== outlet) return;
    mountTasksPage(outlet);
    updateTasksPage(currentTasks);
    startRealtime(outlet, sequence);
  } catch (error) {
    outlet.innerHTML = errorCard("Không thể tải nhiệm vụ", error);
  }
}

function mountTasksPage(outlet) {
  outlet.innerHTML = `<section class="page-card">
    <div class="page-header"><div><h2>Nhiệm vụ</h2><p>Theo dõi nhiệm vụ được giao, tiến độ thực hiện và kết quả hoàn thành.</p></div>${Permissions.canCreateUnexpectedTask()?'<button id="btnCreateTask" class="primary-button" type="button">＋ Giao nhiệm vụ đột xuất</button>':""}</div>
    <div class="summary-grid compact-grid tasks-summary-grid">
      ${card("Tất cả", 0, "taskMetricTotal")}
      ${card("Đang xử lý", 0, "taskMetricInProgress")}
      ${card("Chờ phân công", 0, "taskMetricWaiting")}
      ${card("Trễ hạn", 0, "taskMetricOverdue")}
      ${card("Hoàn thành", 0, "taskMetricCompleted")}
    </div>
    <div class="toolbar"><label class="field-grow"><span>Tìm kiếm</span><input id="taskSearch" type="search" placeholder="Tìm mã, tiêu đề, người thực hiện…"></label><label><span>Trạng thái</span><select id="taskStatusFilter"><option value="ALL">Tất cả trạng thái</option><option value="IN_PROGRESS">Đang xử lý</option><option value="WAITING">Chờ phân công</option><option value="OVERDUE">Trễ hạn</option><option value="COMPLETED">Hoàn thành</option></select></label><button id="refreshTasks" class="secondary-button" type="button">↻ Cập nhật</button></div>
    <div id="taskListContainer"></div>
  </section>`;

  const refreshOnce = async () => {
    const button = document.getElementById("refreshTasks");
    if (button) button.disabled = true;
    try {
      currentTasks = await TaskReadService.list();
      updateTasksPage(currentTasks);
    } catch (error) {
      ToastService.error(error?.message || "Không tải lại được danh sách nhiệm vụ.");
    } finally {
      if (button) button.disabled = false;
    }
  };

  document.getElementById("btnCreateTask")?.addEventListener("click", () => openTaskCreateModal({ onSaved: refreshOnce }));
  document.getElementById("refreshTasks")?.addEventListener("click", refreshOnce);
  document.getElementById("taskSearch")?.addEventListener("input", renderFilteredTasks);
  document.getElementById("taskStatusFilter")?.addEventListener("change", renderFilteredTasks);
}

function startRealtime(outlet, sequence) {
  stopRealtime = TaskReadService.subscribe(
    tasks => {
      if (sequence !== renderSequence || currentOutlet !== outlet || window.location.hash !== "#/tasks") return;
      currentTasks = tasks;
      updateTasksPage(tasks);
    },
    error => {
      if (error?.code !== "permission-denied") {
        console.warn("Theo dõi nhiệm vụ bị gián đoạn:", error);
      }
    }
  );
}

function updateTasksPage(tasks) {
  const summary = TaskReadService.summarize(tasks);
  setText("taskMetricTotal", summary.total);
  setText("taskMetricInProgress", summary.inProgress);
  setText("taskMetricWaiting", summary.waitingAssignment);
  setText("taskMetricOverdue", summary.overdue);
  setText("taskMetricCompleted", summary.completed);
  renderFilteredTasks();
}

function renderFilteredTasks() {
  const search = document.getElementById("taskSearch");
  const filter = document.getElementById("taskStatusFilter");
  const keyword = String(search?.value || "").trim().toLowerCase();
  const status = filter?.value || "ALL";
  const filtered = currentTasks.filter(task => {
    const text = [task.taskCode, task.title, task.ownerName, task.createdByName, task.primaryDepartmentId].join(" ").toLowerCase();
    const keywordMatch = !keyword || text.includes(keyword);
    const statusMatch = status === "ALL" ||
      (status === "IN_PROGRESS" && !task._completed && !task._overdue && !["CHO_PHAN_CONG","PENDING_ASSIGNMENT","MOI_TIEP_NHAN"].includes(task._status)) ||
      (status === "WAITING" && ["CHO_PHAN_CONG","PENDING_ASSIGNMENT","MOI_TIEP_NHAN"].includes(task._status)) ||
      (status === "OVERDUE" && task._overdue) ||
      (status === "COMPLETED" && task._completed);
    return keywordMatch && statusMatch;
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
          currentTasks = await TaskReadService.list();
          updateTasksPage(currentTasks);
        }
      });
    });
  });
}

function renderTaskList(tasks) {
  if (!tasks.length) return `<div class="empty-state"><div class="empty-icon">📋</div><strong>Không có nhiệm vụ trong phạm vi hiển thị</strong><p>Các đầu việc được duyệt hoặc nhiệm vụ đột xuất sẽ xuất hiện tại đây.</p></div>`;
  return `<div class="data-list">${tasks.slice(0,300).map(task => {
    const status = task._overdue
      ? { label: "Trễ hạn", className: "danger" }
      : task._completed
        ? { label: "Hoàn thành", className: "success" }
        : ["CHO_PHAN_CONG", "PENDING_ASSIGNMENT"].includes(task._status)
          ? { label: "Chờ phân công", className: "warning" }
          : task._status === "MOI_TIEP_NHAN"
            ? { label: "Chờ tiếp nhận", className: "warning" }
            : { label: "Đang xử lý", className: "neutral" };
    return `<button type="button" class="data-row task-row-button" data-task-id="${escapeHtml(task.id)}"><div class="data-row-main"><strong>${escapeHtml(task.title || task.taskCode || "Nhiệm vụ không có tiêu đề")}</strong><small>${escapeHtml(task.taskCode || task.id)} • ${escapeHtml(task.primaryDepartmentId || "-")} • ${escapeHtml(task.ownerName || "Chưa phân công")}</small><div class="progress-track"><span style="width:${Math.min(100,Math.max(0,Number(task.progress || 0)))}%"></span></div></div><div class="data-row-meta"><span class="status-pill ${status.className}">${status.label}</span><small>${formatDate(task._deadline)}</small><strong>${Number(task.progress || 0)}%</strong></div></button>`;
  }).join("")}</div>`;
}

function setText(id, value) {
  const target = document.getElementById(id);
  if (target) target.textContent = String(value);
}
function formatDate(date){return date instanceof Date ? new Intl.DateTimeFormat("vi-VN").format(date) : "Không có hạn";}
function card(label,value,id){return `<article class="summary-card"><span>${label}</span><strong id="${id}">${value}</strong></article>`;}
function loadingCard(message){return `<section class="page-card"><div class="empty-state"><div class="empty-icon">⏳</div><strong>${escapeHtml(message)}</strong></div></section>`;}
function errorCard(title,error){return `<section class="page-card error-card"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(error?.message || "Lỗi không xác định")}</p></section>`;}
function escapeHtml(value){return String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");}
