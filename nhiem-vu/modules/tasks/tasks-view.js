import { Permissions } from "../../core/permissions.js";
import { TaskReadService } from "../../services/task-read-service.js";
import { openTaskCreateModal } from "./task-form-modal.js";
import { openTaskDetailModal } from "./task-detail-modal.js";

let renderSequence = 0;

export async function renderTasksView(outlet) {
  const sequence = ++renderSequence;
  outlet.innerHTML = loadingCard("Đang tải nhiệm vụ từ Firestore…");
  try {
    const tasks = await TaskReadService.list();
    if (sequence !== renderSequence) return;
    const summary = TaskReadService.summarize(tasks);
    outlet.innerHTML = `<section class="page-card">
      <div class="page-header"><div><span class="page-eyebrow">PRODUCTION 3D • TASK LIFECYCLE</span><h2>Quản lý nhiệm vụ</h2><p>Ghi nhận, phân công, tiếp nhận, cập nhật tiến độ, minh chứng và hoàn thành.</p></div>${Permissions.canRegisterTask()?'<button id="btnCreateTask" class="primary-button" type="button">＋ Ghi nhận nhiệm vụ</button>':""}</div>
      <div class="summary-grid compact-grid">${card("Tất cả",summary.total)}${card("Đang xử lý",summary.inProgress)}${card("Chờ phân công",summary.waitingAssignment)}${card("Trễ hạn",summary.overdue)}${card("Hoàn thành",summary.completed)}</div>
      <div class="toolbar"><label class="field-grow"><span>Tìm kiếm</span><input id="taskSearch" type="search" placeholder="Tìm mã, tiêu đề, người thực hiện…"></label><label><span>Trạng thái</span><select id="taskStatusFilter"><option value="ALL">Tất cả trạng thái</option><option value="IN_PROGRESS">Đang xử lý</option><option value="WAITING">Chờ phân công</option><option value="OVERDUE">Trễ hạn</option><option value="COMPLETED">Hoàn thành</option></select></label><button id="refreshTasks" class="secondary-button" type="button">↻ Làm mới</button></div>
      <div id="taskListContainer">${renderTaskList(tasks)}</div>
    </section>`;

    const rerender = () => renderTasksView(outlet);
    document.getElementById("btnCreateTask")?.addEventListener("click", () => openTaskCreateModal({ onSaved: rerender }));
    document.getElementById("refreshTasks")?.addEventListener("click", rerender);
    const search = document.getElementById("taskSearch");
    const filter = document.getElementById("taskStatusFilter");
    const updateFiltered = () => {
      const keyword = String(search?.value || "").trim().toLowerCase();
      const status = filter?.value || "ALL";
      const filtered = tasks.filter(task => {
        const text = [task.taskCode, task.title, task.ownerName, task.createdByName, task.primaryDepartmentId].join(" ").toLowerCase();
        const keywordMatch = !keyword || text.includes(keyword);
        const statusMatch = status === "ALL" ||
          (status === "IN_PROGRESS" && !task._completed && !task._overdue && !["CHO_PHAN_CONG","PENDING_ASSIGNMENT"].includes(task._status)) ||
          (status === "WAITING" && ["CHO_PHAN_CONG","PENDING_ASSIGNMENT"].includes(task._status)) ||
          (status === "OVERDUE" && task._overdue) ||
          (status === "COMPLETED" && task._completed);
        return keywordMatch && statusMatch;
      });
      document.getElementById("taskListContainer").innerHTML = renderTaskList(filtered);
      bindRows(filtered, rerender);
    };
    search?.addEventListener("input", updateFiltered);
    filter?.addEventListener("change", updateFiltered);
    bindRows(tasks, rerender);
  } catch (error) {
    outlet.innerHTML = errorCard("Không thể tải nhiệm vụ", error);
  }
}

function bindRows(tasks, rerender) {
  document.querySelectorAll("[data-task-id]").forEach(row => {
    row.addEventListener("click", () => {
      const task = tasks.find(item => item.id === row.dataset.taskId);
      if (task) openTaskDetailModal(task, { onSaved: rerender });
    });
  });
}

function renderTaskList(tasks) {
  if (!tasks.length) return `<div class="empty-state"><div class="empty-icon">📋</div><strong>Không có nhiệm vụ trong phạm vi hiển thị</strong><p>Bấm “Ghi nhận nhiệm vụ” để tạo đầu việc mới.</p></div>`;
  return `<div class="data-list">${tasks.slice(0,300).map(task => `<button type="button" class="data-row task-row-button" data-task-id="${escapeHtml(task.id)}"><div class="data-row-main"><strong>${escapeHtml(task.title || task.taskCode || "Nhiệm vụ không có tiêu đề")}</strong><small>${escapeHtml(task.taskCode || task.id)} • ${escapeHtml(task.primaryDepartmentId || "-")} • ${escapeHtml(task.ownerName || "Chưa phân công")}</small><div class="progress-track"><span style="width:${Math.min(100,Math.max(0,Number(task.progress || 0)))}%"></span></div></div><div class="data-row-meta"><span class="status-pill ${task._overdue?"danger":task._completed?"success":["CHO_PHAN_CONG","PENDING_ASSIGNMENT"].includes(task._status)?"warning":"neutral"}">${task._overdue?"Trễ hạn":task._completed?"Hoàn thành":["CHO_PHAN_CONG","PENDING_ASSIGNMENT"].includes(task._status)?"Chờ phân công":"Đang xử lý"}</span><small>${formatDate(task._deadline)}</small><strong>${Number(task.progress || 0)}%</strong></div></button>`).join("")}</div>`;
}
function formatDate(date){return date instanceof Date ? new Intl.DateTimeFormat("vi-VN").format(date) : "Không có hạn";}
function card(label,value){return `<article class="summary-card"><span>${label}</span><strong>${value}</strong><small>Dữ liệu thật</small></article>`;}
function loadingCard(message){return `<section class="page-card"><div class="empty-state"><div class="empty-icon">⏳</div><strong>${escapeHtml(message)}</strong></div></section>`;}
function errorCard(title,error){return `<section class="page-card error-card"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(error?.message || "Lỗi không xác định")}</p></section>`;}
function escapeHtml(value){return String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");}
