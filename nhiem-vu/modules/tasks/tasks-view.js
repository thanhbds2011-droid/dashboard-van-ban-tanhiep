import { Permissions } from "../../core/permissions.js";
import { ToastService } from "../../core/toast-service.js";
import { TaskReadService } from "../../services/task-read-service.js";

export async function renderTasksView(outlet) {
  outlet.innerHTML = loadingCard("Đang tải nhiệm vụ từ Firestore…");
  try {
    const tasks = await TaskReadService.list();
    const summary = TaskReadService.summarize(tasks);
    outlet.innerHTML = `<section class="page-card">
      <div class="page-header"><div><span class="page-eyebrow">NHIỆM VỤ • READ ONLY</span><h2>Quản lý nhiệm vụ</h2><p>Danh sách nhiệm vụ thật theo đúng phạm vi Firestore Rules.</p></div>${Permissions.canRegisterTask()?'<button id="btnTaskPreview" class="primary-button" type="button">＋ Ghi nhận nhiệm vụ</button>':""}</div>
      <div class="summary-grid compact-grid">${card("Tất cả",summary.total)}${card("Đang xử lý",summary.inProgress)}${card("Chờ phân công",summary.waitingAssignment)}${card("Trễ hạn",summary.overdue)}</div>
      <div class="toolbar"><label class="field-grow"><span>Tìm kiếm</span><input id="taskSearch" type="search" placeholder="Tìm mã, tiêu đề hoặc người thực hiện…"></label><label><span>Trạng thái</span><select id="taskStatusFilter"><option value="ALL">Tất cả trạng thái</option><option value="IN_PROGRESS">Đang xử lý</option><option value="OVERDUE">Trễ hạn</option><option value="COMPLETED">Hoàn thành</option></select></label></div>
      <div id="taskListContainer">${renderTaskList(tasks)}</div>
    </section>`;

    const search = document.getElementById("taskSearch");
    const statusFilter = document.getElementById("taskStatusFilter");
    const renderFiltered = () => {
      const keyword = String(search?.value || "").trim().toLowerCase();
      const status = statusFilter?.value || "ALL";
      const filtered = tasks.filter(task => {
        const text = [task.taskCode, task.title, task.ownerName, task.createdByName, task.primaryDepartmentId].join(" ").toLowerCase();
        const keywordMatch = !keyword || text.includes(keyword);
        const statusMatch = status === "ALL" || (status === "IN_PROGRESS" && !task._completed && !task._overdue) || (status === "OVERDUE" && task._overdue) || (status === "COMPLETED" && task._completed);
        return keywordMatch && statusMatch;
      });
      document.getElementById("taskListContainer").innerHTML = renderTaskList(filtered);
    };
    search?.addEventListener("input", renderFiltered);
    statusFilter?.addEventListener("change", renderFiltered);
    document.getElementById("btnTaskPreview")?.addEventListener("click", () => ToastService.info("Production 3C chỉ đọc dữ liệu. Chức năng ghi nhận nhiệm vụ sẽ mở ở phiên bản sau."));
  } catch (error) {
    outlet.innerHTML = errorCard("Không thể tải nhiệm vụ", error);
  }
}

function renderTaskList(tasks){
  if(!tasks.length) return `<div class="empty-state"><div class="empty-icon">📋</div><strong>Không có nhiệm vụ trong phạm vi hiển thị</strong><p>Điều này có thể do chưa có dữ liệu hoặc Firestore Rules giới hạn đúng theo vai trò.</p></div>`;
  return `<div class="data-list">${tasks.slice(0,200).map(task=>`<article class="data-row"><div class="data-row-main"><strong>${escapeHtml(task.title || task.taskCode || "Nhiệm vụ không có tiêu đề")}</strong><small>${escapeHtml(task.taskCode || task.id)} • ${escapeHtml(task.primaryDepartmentId || "-")} • ${escapeHtml(task.ownerName || task.createdByName || "Chưa phân công")}</small></div><div class="data-row-meta"><span class="status-pill ${task._overdue?"danger":task._completed?"success":"neutral"}">${task._overdue?"Trễ hạn":task._completed?"Hoàn thành":"Đang xử lý"}</span><small>${formatDate(task._deadline)}</small></div></article>`).join("")}</div>`;
}
function formatDate(date){return date instanceof Date ? new Intl.DateTimeFormat("vi-VN").format(date) : "Không có hạn";}
function card(label,value){return `<article class="summary-card"><span>${label}</span><strong>${value}</strong><small>Dữ liệu thật</small></article>`;}
function loadingCard(message){return `<section class="page-card"><div class="empty-state"><div class="empty-icon">⏳</div><strong>${escapeHtml(message)}</strong></div></section>`;}
function errorCard(title,error){return `<section class="page-card error-card"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(error?.message || "Lỗi không xác định")}</p></section>`;}
function escapeHtml(value){return String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");}
