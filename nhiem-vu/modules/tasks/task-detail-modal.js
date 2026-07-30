/** Chi tiết và phân công nhiệm vụ. */
import { UserContext } from "../../core/user-context.js";
import { Permissions } from "../../core/permissions.js?v=20260730.V1_1_10";
import { UserReadService } from "../../services/user-read-service.js";
import { TaskWriteService } from "../../services/task-write-service.js?v=20260730.V1_1_10";
import { openTaskProgressModal } from "./task-progress-modal.js?v=20260730.V1_1_10";

const TEAM_LABELS = Object.freeze({
  BAO_VE: "Tổ Bảo vệ",
  DIEN_NUOC: "Tổ Điện nước",
  HAU_CAN: "Tổ Hậu cần"
});

function normalizeTeamId(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function teamLabel(value) {
  const id = normalizeTeamId(value);
  if (!id) return "";
  return TEAM_LABELS[id] || id
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function canAssign(task) {
  const user = UserContext.requireUser();
  return Permissions.isAdmin() || Permissions.isDirector() ||
    (Permissions.isDepartmentLeader() && task.primaryDepartmentId === user.departmentId);
}

function coefficientLabel(value) {
  const coefficient = Number(value || 1);
  return `${Math.round(coefficient * 100)}%`;
}

function numberVi(value) {
  return Number(value || 0).toLocaleString("vi-VN", { maximumFractionDigits: 2 });
}

function departmentTeams(users) {
  const map = new Map();
  for (const user of users || []) {
    const id = normalizeTeamId(user.teamId);
    if (id) map.set(id, teamLabel(id));
  }
  return [...map.entries()]
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "vi"));
}

export async function openTaskDetailModal(task, { onSaved }) {
  const currentUser = UserContext.requireUser();
  const isOwner = task.ownerUserId === currentUser.uid;
  const accepted = task.assignmentStatus === "DA_TIEP_NHAN";
  const completed = task._completed === true ||
    ["HOAN_THANH", "COMPLETED", "DA_HOAN_THANH"].includes(String(task.status || "").toUpperCase()) ||
    Boolean(task.completedAt);
  const users = canAssign(task) ? await UserReadService.listActive() : [];
  const departmentUsers = users.filter(user => user.departmentId === task.primaryDepartmentId);
  const teams = departmentTeams(departmentUsers);

  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop";
  overlay.innerHTML = `
    <section class="modal-panel modal-large" role="dialog" aria-modal="true">
      <div class="modal-header">
        <div>
          <span class="page-eyebrow">${escapeHtml(task.taskCode || task.id)}</span>
          <h2>${escapeHtml(task.title || "Nhiệm vụ")}</h2>
          <p>${escapeHtml(task.primaryDepartmentId || "")} • ${escapeHtml(statusName(task))}</p>
        </div>
        <button class="icon-button" type="button" data-close>✕</button>
      </div>
      <div class="modal-body">
        <div class="detail-grid">
          ${detail("Người giao", task.createdByName || task.assignedByName || "—")}
          ${detail("Người phụ trách", task.ownerName || "Chưa phân công")}
          ${detail("Tổ/Nhóm", task.teamId ? teamLabel(task.teamId) : "Không áp dụng")}
          ${detail("Tiến độ", `${Number(task.progress || 0)}%`)}
          ${detail("Hạn xử lý", formatDate(task._deadline || task.deadline))}
          ${detail("Loại công việc", task.workType === "DOT_XUAT" ? "Đột xuất" : "Thường xuyên")}
          ${detail("Điểm chuẩn", numberVi(task.baseScore || 0))}
          ${detail("Hệ số độ khó", coefficientLabel(task.difficultyCoefficient))}
          ${detail("Điểm tối đa", numberVi(task.maximumConvertedScore || 0))}
          ${detail("Tính vào A", task.includedInA === true ? "Có" : "Chưa")}
        </div>
        <section class="detail-section"><h3>Nội dung thực hiện</h3><p>${escapeHtml(task.description || "Chưa có nội dung chi tiết.")}</p></section>
        <section class="detail-section"><h3>Kết quả và minh chứng</h3><p>${escapeHtml(task.resultSummary || task.result || "Chưa ghi nhận kết quả.")}</p>${task.evidenceUrl ? `<a class="primary-link" target="_blank" rel="noopener" href="${escapeHtml(task.evidenceUrl)}">📎 ${escapeHtml(task.evidenceFileName || "Mở tệp minh chứng")}</a>` : ""}${task.evidenceText ? `<p>${escapeHtml(task.evidenceText)}</p>` : ""}</section>
        ${isOwner && !accepted && !completed ? '<div class="info-banner">Bạn cần xác nhận đã nhận nhiệm vụ trước khi cập nhật tiến độ, kết quả hoặc minh chứng.</div>' : ""}
        ${canAssign(task) ? `<section class="detail-section"><h3>Phân công nội bộ</h3><div class="inline-form assignment-inline-form">
          <select id="assignTeam"><option value="">— Không chọn Tổ/Nhóm —</option>${teams.map(team => `<option value="${escapeHtml(team.id)}" ${team.id === normalizeTeamId(task.teamId) ? "selected" : ""}>${escapeHtml(team.label)}</option>`).join("")}</select>
          <select id="assignOwner"><option value="">— Chưa phân công cá nhân —</option></select>
          <button id="assignTaskButton" class="secondary-button" type="button">Lưu phân công</button>
        </div></section>` : ""}
      </div>
      <div class="modal-footer"><button class="secondary-button" type="button" data-close>Đóng</button>${isOwner && !accepted && !completed ? '<button id="acceptTaskButton" class="primary-button" type="button">Xác nhận đã nhận nhiệm vụ</button>' : ""}${isOwner && accepted && !completed ? '<button id="updateTaskButton" class="primary-button" type="button">Cập nhật nhiệm vụ</button>' : ""}</div>
    </section>`;

  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", close));

  const teamSelect = overlay.querySelector("#assignTeam");
  const ownerSelect = overlay.querySelector("#assignOwner");

  const refreshOwners = () => {
    if (!ownerSelect) return;
    const teamId = normalizeTeamId(teamSelect?.value);
    const candidates = departmentUsers.filter(user => !teamId || normalizeTeamId(user.teamId) === teamId);
    ownerSelect.innerHTML = `<option value="">— Chưa phân công cá nhân —</option>${candidates.map(user => `<option value="${escapeHtml(user.id)}" ${user.id === task.ownerUserId ? "selected" : ""}>${escapeHtml(user.fullName || user.email)} — ${escapeHtml(user.position || user.role)}</option>`).join("")}`;
    if (task.ownerUserId && candidates.some(user => user.id === task.ownerUserId)) ownerSelect.value = task.ownerUserId;
  };
  refreshOwners();
  teamSelect?.addEventListener("change", refreshOwners);
  ownerSelect?.addEventListener("change", () => {
    const owner = departmentUsers.find(user => user.id === ownerSelect.value);
    const ownerTeam = normalizeTeamId(owner?.teamId);
    if (ownerTeam && teamSelect) {
      teamSelect.value = ownerTeam;
      refreshOwners();
      ownerSelect.value = owner?.id || "";
    }
  });

  overlay.querySelector("#assignTaskButton")?.addEventListener("click", async () => {
    const button = overlay.querySelector("#assignTaskButton");
    try {
      button.disabled = true;
      button.textContent = "Đang lưu...";
      const id = ownerSelect?.value || "";
      const owner = departmentUsers.find(user => user.id === id);
      await TaskWriteService.assign(task, {
        ownerUserId: owner?.id || "",
        ownerName: owner?.fullName || "",
        ownerPosition: owner?.position || "",
        teamId: normalizeTeamId(teamSelect?.value || owner?.teamId)
      });
      close();
      await onSaved?.();
    } catch (error) {
      window.alert(error?.message || "Không lưu được phân công.");
      button.disabled = false;
      button.textContent = "Lưu phân công";
    }
  });

  overlay.querySelector("#acceptTaskButton")?.addEventListener("click", async () => {
    const button = overlay.querySelector("#acceptTaskButton");
    try {
      button.disabled = true;
      button.textContent = "Đang xác nhận...";
      await TaskWriteService.accept(task);
      close();
      await onSaved?.();
    } catch (error) {
      window.alert(error?.message || "Không xác nhận được nhiệm vụ.");
      button.disabled = false;
      button.textContent = "Xác nhận đã nhận nhiệm vụ";
    }
  });

  overlay.querySelector("#updateTaskButton")?.addEventListener("click", async () => {
    close();
    await openTaskProgressModal(task, { onSaved });
  });
}

function detail(label, value) {
  return `<div class="detail-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}
function statusName(task) {
  if (task._overdue) return "Trễ hạn";
  if (task._completed) return "Hoàn thành";
  const map = { CHO_PHAN_CONG: "Chờ phân công", MOI_TIEP_NHAN: "Chờ tiếp nhận", DANG_XU_LY: "Đang xử lý", TAM_DUNG: "Tạm dừng" };
  return map[task.status] || "Đang xử lý";
}
function formatDate(value) {
  const date = value?.toDate ? value.toDate() : value instanceof Date ? value : value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat("vi-VN").format(date) : "Không có hạn";
}
function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
