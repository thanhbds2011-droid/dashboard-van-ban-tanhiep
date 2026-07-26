/** Production 3D - chi tiết và phân công nhiệm vụ. */
import { UserContext } from "../../core/user-context.js";
import { Permissions } from "../../core/permissions.js";
import { UserReadService } from "../../services/user-read-service.js";
import { TaskWriteService } from "../../services/task-write-service.js";
import { openTaskProgressModal } from "./task-progress-modal.js";

function canAssign(task) {
  const user = UserContext.requireUser();
  return Permissions.isAdmin() || Permissions.isDirector() ||
    (Permissions.isDepartmentLeader() && task.primaryDepartmentId === user.departmentId);
}

export async function openTaskDetailModal(task, { onSaved }) {
  const users = canAssign(task) ? await UserReadService.listActive() : [];
  const departmentUsers = users.filter(user => user.departmentId === task.primaryDepartmentId);
  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop";
  overlay.innerHTML = `
    <section class="modal-panel modal-large" role="dialog" aria-modal="true">
      <div class="modal-header"><div><span class="page-eyebrow">${escapeHtml(task.taskCode || task.id)}</span><h2>${escapeHtml(task.title || "Nhiệm vụ")}</h2><p>${escapeHtml(task.primaryDepartmentId || "")} • ${escapeHtml(statusName(task))}</p></div><button class="icon-button" type="button" data-close>✕</button></div>
      <div class="modal-body">
        <div class="detail-grid">
          ${detail("Người giao", task.createdByName || task.assignedByName || "—")}
          ${detail("Người phụ trách", task.ownerName || "Chưa phân công")}
          ${detail("Tiến độ", `${Number(task.progress || 0)}%`)}
          ${detail("Hạn xử lý", formatDate(task._deadline || task.deadline))}
          ${detail("Mức ưu tiên", priorityName(task.priority))}
          ${detail("Loại công việc", task.workType === "DOT_XUAT" ? "Đột xuất" : "Thường xuyên")}
        </div>
        <section class="detail-section"><h3>Nội dung thực hiện</h3><p>${escapeHtml(task.description || "Chưa có nội dung chi tiết.")}</p></section>
        <section class="detail-section"><h3>Kết quả và minh chứng</h3><p>${escapeHtml(task.resultSummary || task.result || "Chưa ghi nhận kết quả.")}</p>${task.evidenceUrl ? `<a class="primary-link" target="_blank" rel="noopener" href="${escapeHtml(task.evidenceUrl)}">📎 ${escapeHtml(task.evidenceFileName || "Mở tệp minh chứng")}</a>` : ""}${task.evidenceText ? `<p>${escapeHtml(task.evidenceText)}</p>` : ""}</section>
        ${canAssign(task) ? `<section class="detail-section"><h3>Phân công nội bộ</h3><div class="inline-form"><select id="assignOwner"><option value="">— Chưa phân công cá nhân —</option>${departmentUsers.map(user => `<option value="${escapeHtml(user.id)}" ${user.id === task.ownerUserId ? "selected" : ""}>${escapeHtml(user.fullName || user.email)} — ${escapeHtml(user.position || user.role)}</option>`).join("")}</select><input id="assignTeam" placeholder="Tổ/Nhóm" value="${escapeHtml(task.teamId || "")}"><button id="assignTaskButton" class="secondary-button" type="button">Lưu phân công</button></div></section>` : ""}
      </div>
      <div class="modal-footer"><button class="secondary-button" type="button" data-close>Đóng</button><button id="updateTaskButton" class="primary-button" type="button">Cập nhật tiến độ</button></div>
    </section>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", close));

  overlay.querySelector("#assignTaskButton")?.addEventListener("click", async () => {
    const button = overlay.querySelector("#assignTaskButton");
    try {
      button.disabled = true;
      button.textContent = "Đang lưu...";
      const id = overlay.querySelector("#assignOwner").value;
      const owner = departmentUsers.find(user => user.id === id);
      await TaskWriteService.assign(task, {
        ownerUserId: owner?.id || "", ownerName: owner?.fullName || "", ownerPosition: owner?.position || "", teamId: overlay.querySelector("#assignTeam").value.trim().toUpperCase()
      });
      close();
      await onSaved?.();
    } catch (error) {
      window.alert(error?.message || "Không lưu được phân công.");
      button.disabled = false;
      button.textContent = "Lưu phân công";
    }
  });

  overlay.querySelector("#updateTaskButton")?.addEventListener("click", async () => {
    close();
    await openTaskProgressModal(task, { onSaved });
  });
}

function detail(label, value) { return `<div class="detail-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`; }
function statusName(task) { if (task._overdue) return "Trễ hạn"; if (task._completed) return "Hoàn thành"; const map={CHO_PHAN_CONG:"Chờ phân công",MOI_TIEP_NHAN:"Mới tiếp nhận",DANG_XU_LY:"Đang xử lý",TAM_DUNG:"Tạm dừng"}; return map[task.status] || "Đang xử lý"; }
function priorityName(value) { return {THUONG:"Thường",QUAN_TRONG:"Quan trọng",KHAN:"Khẩn",DOT_XUAT:"Đột xuất"}[value] || value || "Thường"; }
function formatDate(value) { const date = value?.toDate ? value.toDate() : value instanceof Date ? value : value ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat("vi-VN").format(date) : "Không có hạn"; }
function escapeHtml(value) { return String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;"); }
