/** Chi tiết, phân công và các lượt công việc phát sinh của nhiệm vụ. */
import { UserContext } from "../../core/user-context.js";
import { Permissions } from "../../core/permissions.js?v=20260731.V1_1_14";
import { UserReadService } from "../../services/user-read-service.js";
import { TaskWriteService } from "../../services/task-write-service.js?v=20260731.V1_1_17";
import { TaskWorkItemService } from "../../services/task-work-item-service.js?v=20260731.V1_1_17";
import { openTaskProgressModal } from "./task-progress-modal.js?v=20260731.V1_1_17";

const TEAM_LABELS = Object.freeze({
  BAO_VE: "Tổ Bảo vệ",
  DIEN_NUOC: "Tổ Điện nước",
  HAU_CAN: "Tổ Hậu cần"
});

const PROGRESS_RATE_OPTIONS = Object.freeze([
  { value: 100, label: "100% — Đúng hoặc trước thời hạn" },
  { value: 80, label: "80% — Chậm 1–3 ngày làm việc" },
  { value: 60, label: "60% — Chậm 4–5 ngày làm việc" },
  { value: 0, label: "0% — Chậm trên 5 ngày hoặc không hoàn thành" }
]);

const RESULT_RATE_OPTIONS = Object.freeze([
  { value: 100, label: "100% — Đạt đầy đủ, không phải sửa đáng kể" },
  { value: 80, label: "80% — Đạt yêu cầu, chỉnh sửa nhỏ" },
  { value: 60, label: "60% — Hoàn thành cơ bản, chỉnh sửa đáng kể" },
  { value: 0, label: "0% — Không đạt, phải làm lại hoặc sửa trên 50%" }
]);

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

function isItemizedTask(task) {
  return String(task?.trackingMode || "FINAL_OUTPUT").toUpperCase() === "ITEMIZED";
}

function trackingModeLabel(task) {
  return isItemizedTask(task)
    ? "Theo từng lượt công việc phát sinh"
    : "Theo sản phẩm/kết quả cuối cùng";
}

function rateBadge(value, type = "progress") {
  const rate = Number(value || 0);
  const className = rate === 100 ? "success" : rate === 80 ? "info" : rate === 60 ? "warning" : "danger";
  const label = type === "progress" ? "Tiến độ" : "Kết quả";
  return `<span class="status-pill ${className}">${label}: ${rate}%</span>`;
}

function workItemRows(items, canEdit) {
  if (!items.length) {
    return `<div class="task-work-item-empty">
      <strong>Chưa có công việc phát sinh trong kỳ</strong>
      <span>Khi có văn bản, hồ sơ hoặc hoạt động được giao, hãy thêm tại đây để làm căn cứ tổng hợp cuối kỳ.</span>
    </div>`;
  }

  return `<div class="task-work-item-list">${items.map((item, index) => `
    <article class="task-work-item-card">
      <div class="task-work-item-index">${index + 1}</div>
      <div class="task-work-item-main">
        <strong>${escapeHtml(item.title)}</strong>
        <div class="task-work-item-meta">
          <span>Người giao: ${escapeHtml(item.assignedByName || "Chưa ghi")}</span>
          <span>Ngày giao: ${dateVi(item.assignedDateKey)}</span>
          <span>Hạn: ${dateVi(item.deadlineDateKey)}</span>
          <span>Hoàn thành: ${item.completedDateKey ? dateVi(item.completedDateKey) : "Chưa hoàn thành"}</span>
        </div>
        <div class="task-work-item-badges">${rateBadge(item.progressRate, "progress")}${rateBadge(item.resultRate, "result")}</div>
        ${item.reference ? `<small>Căn cứ/Số văn bản: ${escapeHtml(item.reference)}</small>` : ""}
        ${item.resultNote ? `<p>${escapeHtml(item.resultNote)}</p>` : ""}
        ${item.evidenceText ? `<small>Minh chứng: ${escapeHtml(item.evidenceText)}</small>` : ""}
      </div>
      ${canEdit ? `<div class="task-work-item-actions"><button class="secondary-button compact-button" type="button" data-edit-work-item="${escapeHtml(item.id)}">Sửa</button><button class="danger-button compact-button" type="button" data-remove-work-item="${escapeHtml(item.id)}">Xóa</button></div>` : ""}
    </article>`).join("")}</div>`;
}

function workItemSummaryHtml(items) {
  const summary = TaskWorkItemService.calculateSummary(items);
  if (!summary.count) return "";
  return `<div class="task-work-item-summary">
    <div><span>Tổng lượt ghi nhận (N)</span><strong>${summary.count}</strong></div>
    <div><span>Đã hoàn thành</span><strong>${summary.completedCount}/${summary.count}</strong></div>
    <div><span>Đúng hạn (T)</span><strong>${summary.onTimeCount}/${summary.count}</strong></div>
    <div><span>Đạt yêu cầu (K)</span><strong>${summary.qualifiedCount}/${summary.count}</strong></div>
    <div><span>Tiến độ thực tế</span><strong>${numberVi(summary.actualProgressRate)}%</strong></div>
    <div><span>Kết quả thực tế</span><strong>${numberVi(summary.actualResultRate)}%</strong></div>
    <div class="is-applied"><span>Mức KPI áp dụng</span><strong>${summary.appliedProgressRate}% tiến độ · ${summary.appliedResultRate}% kết quả</strong></div>
  </div>`;
}

function openWorkItemEditor(task, item, onSaved) {
  const currentUser = UserContext.requireUser();
  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop nested-modal-backdrop";
  overlay.innerHTML = `
    <section class="modal-panel modal-medium" role="dialog" aria-modal="true">
      <div class="modal-header">
        <div><span class="page-eyebrow">${escapeHtml(task.taskCode || task.id)}</span><h2>${item ? "Cập nhật công việc phát sinh" : "Thêm công việc được giao"}</h2><p>Ghi nhận từng văn bản, hồ sơ, hoạt động hoặc lượt công việc trong kỳ.</p></div>
        <button class="icon-button" type="button" data-close-work-item>✕</button>
      </div>
      <div class="modal-body task-form-grid">
        <label class="field-full"><span>Nội dung công việc được giao</span><input id="workItemTitle" maxlength="500" value="${escapeHtml(item?.title || "")}" placeholder="Ví dụ: Soạn thảo Thông báo triển khai kế hoạch quý III"></label>
        <label><span>Số/Ký hiệu hoặc căn cứ</span><input id="workItemReference" maxlength="500" value="${escapeHtml(item?.reference || "")}" placeholder="Không bắt buộc"></label>
        <label><span>Người giao</span><input id="workItemAssignedBy" maxlength="300" value="${escapeHtml(item?.assignedByName || currentUser.fullName || "")}"></label>
        <label><span>Ngày giao</span><input id="workItemAssignedDate" type="date" value="${escapeHtml(item?.assignedDateKey || new Date().toISOString().slice(0, 10))}"></label>
        <label><span>Hạn hoàn thành</span><input id="workItemDeadline" type="date" value="${escapeHtml(item?.deadlineDateKey || "")}"></label>
        <label><span>Ngày hoàn thành thực tế</span><input id="workItemCompletedDate" type="date" value="${escapeHtml(item?.completedDateKey || "")}"></label>
        <label><span>Mức tiến độ</span><select id="workItemProgressRate">${PROGRESS_RATE_OPTIONS.map(option => `<option value="${option.value}" ${Number(item?.progressRate || 0) === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select><small>Chọn theo số ngày làm việc chậm và hướng dẫn KPI.</small></label>
        <label><span>Mức kết quả</span><select id="workItemResultRate">${RESULT_RATE_OPTIONS.map(option => `<option value="${option.value}" ${Number(item?.resultRate || 0) === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select><small>Chọn theo chất lượng sản phẩm và mức độ chỉnh sửa.</small></label>
        <label class="field-full"><span>Kết quả/Ghi chú</span><textarea id="workItemResultNote" rows="3" maxlength="3000" placeholder="Nêu kết quả, tình trạng chỉnh sửa hoặc nguyên nhân chưa hoàn thành">${escapeHtml(item?.resultNote || "")}</textarea></label>
        <label class="field-full"><span>Minh chứng/liên kết</span><textarea id="workItemEvidence" rows="2" maxlength="3000" placeholder="Số văn bản, đường dẫn Drive hoặc mô tả minh chứng">${escapeHtml(item?.evidenceText || "")}</textarea></label>
      </div>
      <div class="modal-footer"><button class="secondary-button" type="button" data-close-work-item>Hủy</button><button id="saveWorkItemButton" class="primary-button" type="button">Lưu công việc</button></div>
    </section>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelectorAll("[data-close-work-item]").forEach(button => button.addEventListener("click", close));
  overlay.querySelector("#saveWorkItemButton")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    try {
      button.disabled = true;
      button.textContent = "Đang lưu…";
      await TaskWorkItemService.save(task, {
        title: overlay.querySelector("#workItemTitle")?.value,
        reference: overlay.querySelector("#workItemReference")?.value,
        assignedByName: overlay.querySelector("#workItemAssignedBy")?.value,
        assignedDateKey: overlay.querySelector("#workItemAssignedDate")?.value,
        deadlineDateKey: overlay.querySelector("#workItemDeadline")?.value,
        completedDateKey: overlay.querySelector("#workItemCompletedDate")?.value,
        progressRate: overlay.querySelector("#workItemProgressRate")?.value,
        resultRate: overlay.querySelector("#workItemResultRate")?.value,
        resultNote: overlay.querySelector("#workItemResultNote")?.value,
        evidenceText: overlay.querySelector("#workItemEvidence")?.value
      }, item);
      close();
      await onSaved?.();
    } catch (error) {
      window.alert(error?.message || "Không lưu được công việc phát sinh.");
      button.disabled = false;
      button.textContent = "Lưu công việc";
    }
  });
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
  let workItems = isItemizedTask(task) ? await TaskWorkItemService.list(task.id) : [];
  const workItemsLocked = task.scoreLocked === true || String(task.scoringStatus || "").toUpperCase() === "CONFIRMED";
  const canEditWorkItems = isItemizedTask(task) && TaskWorkItemService.mayManage(task) && !workItemsLocked;

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
        <div class="detail-grid task-detail-summary">
          ${detail("Người giao", task.createdByName || task.assignedByName || "—")}
          ${detail("Người phụ trách", task.ownerName || "Chưa phân công")}
          ${detail("Tổ/Nhóm", task.teamId ? teamLabel(task.teamId) : "Không áp dụng")}
          ${detail("Tiến độ", `${Number(task.progress || 0)}%`)}
          ${detail("Hạn xử lý", formatDate(task._deadline || task.deadline))}
          ${detail("Loại công việc", task.workType === "DOT_XUAT" ? "Đột xuất" : "Thường xuyên")}
          ${detail("Cách theo dõi", trackingModeLabel(task))}
          ${detail("Điểm chuẩn", numberVi(task.baseScore || 0))}
          ${detail("Hệ số độ khó", coefficientLabel(task.difficultyCoefficient))}
          ${detail("Điểm tối đa", numberVi(task.maximumConvertedScore || 0))}
        </div>
        <section class="detail-section"><h3>Nội dung thực hiện</h3><p>${escapeHtml(task.description || "Chưa có nội dung chi tiết.")}</p></section>
        ${isItemizedTask(task) ? `<section class="detail-section task-work-items-section">
          <div class="detail-section-heading"><div><h3>Công việc phát sinh trong kỳ</h3><p>Mỗi văn bản, hồ sơ hoặc hoạt động được ghi nhận thành một lượt để tổng hợp tiến độ và kết quả thực tế.</p></div>${canEditWorkItems ? '<button id="addWorkItemButton" class="primary-button compact-button" type="button">+ Thêm công việc được giao</button>' : ""}</div>
          <div id="taskWorkItemSummary">${workItemSummaryHtml(workItems)}</div>
          <div id="taskWorkItemList">${workItemRows(workItems, canEditWorkItems)}</div>
        </section>` : `<div class="info-banner final-output-banner"><strong>Đánh giá theo sản phẩm cuối cùng</strong><span>Đầu việc này không cần nhập từng lượt phát sinh. Khi hoàn thành, cập nhật kết quả và minh chứng cuối cùng tại nút “Cập nhật nhiệm vụ”.</span></div>`}
        <section class="detail-section"><h3>Kết quả và minh chứng cuối cùng</h3><p>${escapeHtml(task.resultSummary || task.result || "Chưa ghi nhận kết quả.")}</p>${task.evidenceUrl ? `<a class="primary-link" target="_blank" rel="noopener" href="${escapeHtml(task.evidenceUrl)}">📎 ${escapeHtml(task.evidenceFileName || "Mở tệp minh chứng")}</a>` : ""}${task.evidenceText ? `<p>${escapeHtml(task.evidenceText)}</p>` : ""}</section>
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

  const refreshWorkItems = async () => {
    workItems = await TaskWorkItemService.list(task.id);
    const list = overlay.querySelector("#taskWorkItemList");
    const summary = overlay.querySelector("#taskWorkItemSummary");
    if (list) list.innerHTML = workItemRows(workItems, canEditWorkItems);
    if (summary) summary.innerHTML = workItemSummaryHtml(workItems);
    bindWorkItemActions();
  };

  const bindWorkItemActions = () => {
    overlay.querySelectorAll("[data-edit-work-item]").forEach(button => button.addEventListener("click", () => {
      const item = workItems.find(entry => entry.id === button.dataset.editWorkItem);
      if (item) openWorkItemEditor(task, item, refreshWorkItems);
    }));
    overlay.querySelectorAll("[data-remove-work-item]").forEach(button => button.addEventListener("click", async () => {
      const item = workItems.find(entry => entry.id === button.dataset.removeWorkItem);
      if (!item || !window.confirm(`Xóa lượt công việc “${item.title}”?`)) return;
      try {
        button.disabled = true;
        await TaskWorkItemService.remove(task, item);
        await refreshWorkItems();
      } catch (error) {
        window.alert(error?.message || "Không xóa được công việc phát sinh.");
        button.disabled = false;
      }
    }));
  };

  overlay.querySelector("#addWorkItemButton")?.addEventListener("click", () => openWorkItemEditor(task, null, refreshWorkItems));
  bindWorkItemActions();

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
function dateVi(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "—";
}
function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
