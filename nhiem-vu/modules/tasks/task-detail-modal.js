/** Chi tiết, phân công và các lượt công việc phát sinh của nhiệm vụ. */
import { UserContext } from "../../core/user-context.js";
import { Permissions } from "../../core/permissions.js?v=20260801.V1_2_0";
import { UserReadService } from "../../services/user-read-service.js";
import { TaskWriteService } from "../../services/task-write-service.js?v=20260801.V1_2_0";
import { TaskWorkItemService } from "../../services/task-work-item-service.js?v=20260801.V1_2_0";
import { DriveEvidenceService } from "../../services/drive-evidence-service.js?v=20260801.V1_2_0";
import { TaskAdjustmentService } from "../../services/task-adjustment-service.js?v=20260801.V1_2_0";
import { TaskLogService } from "../../services/task-log-service.js";
import { CdtnAttendanceService } from "../../services/cdtn-attendance-service.js?v=20260801.V1_2_0";
import { openTaskProgressModal } from "./task-progress-modal.js?v=20260801.V1_2_0";

const TEAM_LABELS = Object.freeze({
  BAO_VE: "Tổ Bảo vệ",
  DIEN_NUOC: "Tổ Điện nước",
  HAU_CAN: "Tổ Hậu cần"
});

const RESULT_RATE_OPTIONS = Object.freeze([
  { value: 100, label: "100% — Đạt đầy đủ, không phải sửa đáng kể" },
  { value: 80, label: "80% — Đạt yêu cầu, chỉnh sửa nhỏ" },
  { value: 60, label: "60% — Hoàn thành cơ bản, chỉnh sửa đáng kể" },
  { value: 0, label: "0% — Không đạt, phải làm lại hoặc sửa trên 50%" }
]);

const WORK_ITEM_LABELS = Object.freeze({
  GENERIC: {
    name: "Lượt công việc phát sinh",
    add: "Thêm công việc được giao",
    empty: "Khi có công việc được giao, hãy thêm tại đây để làm căn cứ tổng hợp cuối kỳ."
  },
  DOCUMENT: {
    name: "Văn bản/hồ sơ được giao",
    add: "Thêm văn bản/hồ sơ",
    empty: "Mỗi văn bản hoặc hồ sơ được giao được ghi thành một lượt riêng."
  },
  QUANTITY: {
    name: "Sản lượng theo tháng",
    add: "Thêm sản lượng tháng",
    empty: "Ghi sản lượng từng tháng và đính kèm minh chứng để tổng hợp kết quả quý."
  },
  ATTENDANCE: {
    name: "Buổi hoạt động và tình trạng tham dự",
    add: "Thêm buổi hoạt động",
    empty: "Ghi từng buổi tổ chức để tổng hợp số buổi có mặt, vắng có phép và vắng mặt."
  }
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
  const executionStarted = task.assignmentStatus === "DA_TIEP_NHAN"
    || Number(task.progress || 0) > 0
    || Boolean(task.completedAt);
  if (executionStarted) return false;
  return Permissions.isAdmin() || Permissions.isDirector() ||
    (Permissions.isDepartmentLeader() && task.primaryDepartmentId === user.departmentId);
}

function canReviewNoOccurrence(task) {
  const user = UserContext.requireUser();
  if (task.ownerUserId === user.uid) return false;
  return String(task.adjustmentApproverUserId || task.assignedByUserId || task.createdByUserId || "") === user.uid;
}

function coefficientLabel(value) {
  const coefficient = Number(value || 1);
  return `${Math.round(coefficient * 100)}%`;
}

function numberVi(value) {
  if (value === null || value === undefined || value === "") return "—";
  return Number(value).toLocaleString("vi-VN", { maximumFractionDigits: 2 });
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

function workItemType(task) {
  return TaskWorkItemService.normalizeWorkItemType(task?.workItemType);
}

function trackingModeLabel(task) {
  return isItemizedTask(task)
    ? `${WORK_ITEM_LABELS[workItemType(task)].name}`
    : "Theo sản phẩm/kết quả cuối cùng";
}

function rateBadge(value, type = "progress") {
  const rate = Number(value || 0);
  const className = rate === 100 ? "success" : rate === 80 ? "info" : rate === 60 ? "warning" : "danger";
  const label = type === "progress" ? "Tiến độ" : "Kết quả";
  return `<span class="status-pill ${className}">${label}: ${rate}%</span>`;
}

function attendanceBadge(status) {
  const normalized = String(status || "").toUpperCase();
  const values = {
    PRESENT: ["Có mặt", "success"],
    EXCUSED: ["Vắng có phép", "warning"],
    ABSENT: ["Vắng mặt", "danger"]
  };
  const [label, className] = values[normalized] || ["Chưa ghi nhận", "neutral"];
  return `<span class="status-pill ${className}">${label}</span>`;
}

function evidenceHtml(item) {
  const url = safeExternalUrl(item.evidenceUrl);
  return `${item.evidenceText ? `<small>Minh chứng: ${escapeHtml(item.evidenceText)}</small>` : ""}
    ${url ? `<a class="primary-link" target="_blank" rel="noopener" href="${escapeHtml(url)}">📎 ${escapeHtml(item.evidenceFileName || "Mở minh chứng")}</a>` : ""}`;
}

function workItemContent(item, type) {
  if (type === "ATTENDANCE") {
    return `
      <strong>${escapeHtml(item.title)}</strong>
      <div class="task-work-item-meta">
        <span>Ngày tổ chức: ${dateVi(item.sessionDateKey)}</span>
        <span>Tình trạng: ${attendanceBadge(item.attendanceStatus)}</span>
      </div>
      <div class="task-work-item-badges">${rateBadge(item.resultRate, "result")}</div>
      ${item.participationNote ? `<p>${escapeHtml(item.participationNote)}</p>` : ""}
      ${item.resultNote ? `<p>${escapeHtml(item.resultNote)}</p>` : ""}
      ${evidenceHtml(item)}`;
  }

  const quantity = type === "QUANTITY"
    ? `<div class="task-work-item-quantity">
        <span>Tháng: <strong>${monthVi(item.reportingPeriod)}</strong></span>
        <span>Kế hoạch: <strong>${numberVi(item.plannedQuantity)} ${escapeHtml(item.quantityUnit || "")}</strong></span>
        <span>Thực tế: <strong>${numberVi(item.actualQuantity)} ${escapeHtml(item.quantityUnit || "")}</strong></span>
      </div>`
    : "";
  return `
    <strong>${escapeHtml(item.title)}</strong>
    ${quantity}
    <div class="task-work-item-meta">
      <span>Người giao: ${escapeHtml(item.assignedByName || "Chưa ghi")}</span>
      <span>Ngày giao: ${dateVi(item.assignedDateKey)}</span>
      <span>Hạn: ${dateVi(item.deadlineDateKey)}</span>
      <span>Hoàn thành: ${item.completedDateKey ? dateVi(item.completedDateKey) : "Chưa hoàn thành"}</span>
    </div>
    <div class="task-work-item-badges">${rateBadge(item.progressRate, "progress")}${rateBadge(item.resultRate, "result")}</div>
    ${item.reference ? `<small>Số/Ký hiệu hoặc căn cứ: ${escapeHtml(item.reference)}</small>` : ""}
    ${item.resultNote ? `<p>${escapeHtml(item.resultNote)}</p>` : ""}
    ${evidenceHtml(item)}`;
}

function workItemRows(items, canEdit, task) {
  const type = workItemType(task);
  if (!items.length) {
    return `<div class="task-work-item-empty">
      <strong>Chưa có ${WORK_ITEM_LABELS[type].name.toLowerCase()}</strong>
      <span>${WORK_ITEM_LABELS[type].empty}</span>
    </div>`;
  }

  return `<div class="task-work-item-list">${items.map((item, index) => `
    <article class="task-work-item-card">
      <div class="task-work-item-index">${index + 1}</div>
      <div class="task-work-item-main">${workItemContent(item, type)}</div>
      ${canEdit ? `<div class="task-work-item-actions"><button class="secondary-button compact-button" type="button" data-edit-work-item="${escapeHtml(item.id)}">Sửa</button><button class="danger-button compact-button" type="button" data-remove-work-item="${escapeHtml(item.id)}">Xóa</button></div>` : ""}
    </article>`).join("")}</div>`;
}

function workItemSummaryHtml(items, task) {
  const type = workItemType(task);
  const summary = TaskWorkItemService.calculateSummary(items, type);
  if (!summary.count) return "";
  const progressLabel = type === "ATTENDANCE" ? "Có mặt (T)" : "Đúng hạn (T)";
  const resultLabel = type === "ATTENDANCE" ? "Tham dự đạt yêu cầu (K)" : "Đạt yêu cầu (K)";
  const typeSpecific = type === "ATTENDANCE"
    ? `<div><span>Vắng có phép</span><strong>${summary.excusedCount}</strong></div>
       <div><span>Vắng mặt</span><strong>${summary.absentCount}</strong></div>`
    : type === "QUANTITY"
      ? `<div><span>Tổng kế hoạch</span><strong>${numberVi(summary.totalPlannedQuantity)} ${escapeHtml(task.quantityUnit || "")}</strong></div>
         <div><span>Tổng thực tế</span><strong>${numberVi(summary.totalActualQuantity)} ${escapeHtml(task.quantityUnit || "")}</strong></div>`
      : "";

  const incomplete = summary.incompleteCount > 0
    ? `<div class="is-warning"><span>Chưa hoàn thành</span><strong>${summary.incompleteCount}</strong></div>`
    : "";

  return `<div class="task-work-item-summary">
    <div><span>Tổng lượt hợp lệ (N)</span><strong>${summary.count}</strong></div>
    <div><span>Đã ghi nhận đầy đủ</span><strong>${summary.completedCount}/${summary.count}</strong></div>
    ${incomplete}
    <div><span>${progressLabel}</span><strong>${summary.onTimeCount}/${summary.count}</strong></div>
    <div><span>${resultLabel}</span><strong>${summary.qualifiedCount}/${summary.count}</strong></div>
    ${typeSpecific}
    <div><span>Tiến độ trung bình</span><strong>${numberVi(summary.actualProgressRate)}%</strong></div>
    <div><span>Kết quả trung bình</span><strong>${numberVi(summary.actualResultRate)}%</strong></div>
    <div class="is-applied"><span>Tỷ lệ đưa vào Phụ lục 04</span><strong>${summary.appliedProgressRate}% tiến độ · ${summary.appliedResultRate}% kết quả</strong></div>
  </div>`;
}

function scoringMethodHtml(task) {
  const type = workItemType(task);
  const methods = {
    GENERIC: {
      title: "Công việc phát sinh nhiều lượt",
      n: "Tổng số lượt công việc được giao hợp lệ",
      t: "Số lượt hoàn thành đúng hạn",
      k: "Số lượt hoàn thành đạt yêu cầu từ 80% trở lên"
    },
    DOCUMENT: {
      title: "Văn bản/hồ sơ phát sinh nhiều lượt",
      n: "Tổng số văn bản hoặc hồ sơ được giao hợp lệ",
      t: "Số văn bản hoặc hồ sơ hoàn thành đúng hạn",
      k: "Số văn bản hoặc hồ sơ đạt yêu cầu từ 80% trở lên"
    },
    QUANTITY: {
      title: "Sản lượng ghi nhận theo tháng",
      n: "Tổng số tháng/sản phẩm phải ghi nhận trong kỳ",
      t: "Số lượt cập nhật, hoàn thành đúng hạn",
      k: "Số lượt đạt sản lượng kế hoạch và chất lượng từ 80% trở lên"
    },
    ATTENDANCE: {
      title: "Hoạt động và điểm danh theo buổi",
      n: "Tổng số buổi phải tham gia trong kỳ",
      t: "Số buổi có mặt",
      k: "Số buổi có mặt và mức tham gia đạt yêu cầu từ 80% trở lên"
    }
  };
  const method = methods[type] || methods.GENERIC;
  return `<div class="scoring-method-card">
    <div class="scoring-method-heading"><span>Cách tính điểm đầu việc</span><strong>${escapeHtml(method.title)}</strong></div>
    <div class="scoring-method-steps">
      <div><b>N</b><span>${escapeHtml(method.n)}</span></div>
      <div><b>T</b><span>${escapeHtml(method.t)}</span></div>
      <div><b>K</b><span>${escapeHtml(method.k)}</span></div>
    </div>
    <p>Mỗi lượt được xác định tỷ lệ tiến độ và kết quả riêng. Hệ thống lấy trung bình chính xác của các lượt, sau đó chấm <strong>một lần cho toàn đầu việc</strong> theo công thức Phụ lục 04. Không ép tỷ lệ trung bình về bốn bậc và không cộng điểm chuẩn riêng cho từng lượt.</p>
  </div>`;
}

function adjustmentStatusHtml(task) {
  const status = String(task.adjustmentStatus || "").toUpperCase();
  const values = {
    REQUESTED: ["Đang chờ điều chỉnh", "warning"],
    APPROVED: [task.adjustmentLabel || "Đã điều chỉnh", "success"],
    REJECTED: ["Đề nghị điều chỉnh không được duyệt", "danger"]
  };
  const value = values[status];
  return value ? `<span class="status-pill ${value[1]}">${escapeHtml(value[0])}</span>` : "";
}

function timestampVi(value) {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime())
    ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(date)
    : "—";
}

function adjustmentsHtml(task, adjustments) {
  const canRequest = TaskAdjustmentService.canRequest(task);
  const pending = adjustments.find(item => String(item.status || "").toUpperCase() === "PENDING");
  return `<div class="adjustment-toolbar">
    <div><strong>Điều chỉnh không làm mất bản đăng ký gốc</strong><span>Nhiệm vụ chỉ được đổi phạm vi hoặc loại khỏi KPI sau khi chính người giao phê duyệt. Hệ thống không tự chuyển việc hay chia điểm cho người khác.</span></div>
    ${canRequest ? '<button id="requestAdjustmentButton" class="primary-button compact-button" type="button">Đề nghị điều chỉnh</button>' : ""}
  </div>
  ${pending && TaskAdjustmentService.canApprove(task, pending) ? `<div class="adjustment-decision-card">
    <strong>Đề nghị đang chờ anh/chị xử lý</strong>
    <span>${escapeHtml(pending.reason || "")}</span>
    <div class="adjustment-decision-actions">
      <button class="primary-button compact-button" data-approve-adjustment="ADJUST_SCOPE" data-adjustment-id="${escapeHtml(pending.id)}" type="button">Duyệt và chấm phần đã làm</button>
      <button class="secondary-button compact-button" data-approve-adjustment="EXEMPT_FROM_SCORING" data-adjustment-id="${escapeHtml(pending.id)}" type="button">Duyệt không đánh giá</button>
      <button class="secondary-button compact-button" data-reject-adjustment="${escapeHtml(pending.id)}" type="button">Không chấp thuận</button>
    </div>
  </div>` : ""}
  <div class="adjustment-history">${adjustments.length ? adjustments.map(item => `<article class="adjustment-history-item">
    <div><strong>${escapeHtml(item.adjustmentLabel || TaskAdjustmentService.label(item.adjustmentType))}</strong><span>${timestampVi(item.createdAt)} · ${escapeHtml(item.userName || "")}</span></div>
    <span class="status-pill ${item.status === "APPROVED" ? "success" : item.status === "REJECTED" ? "danger" : "warning"}">${item.status === "APPROVED" ? "Đã duyệt" : item.status === "REJECTED" ? "Không duyệt" : "Chờ duyệt"}</span>
    <p>${escapeHtml(item.reason || "")}</p>
    ${item.proposedSnapshot?.adjustedWorkload ? `<small>Khối lượng đề nghị: ${escapeHtml(item.proposedSnapshot.adjustedWorkload)}</small>` : ""}
    ${item.rejectionReason ? `<small class="text-danger">Lý do: ${escapeHtml(item.rejectionReason)}</small>` : ""}
  </article>`).join("") : '<div class="task-work-item-empty"><strong>Chưa có điều chỉnh</strong><span>Bản kế hoạch hiện hành vẫn giữ nguyên.</span></div>'}</div>`;
}

function historyHtml(logs) {
  const labels = {
    TASK_CREATED: "Tạo nhiệm vụ", TASK_ASSIGNED: "Phân công", TASK_ACCEPTED: "Tiếp nhận",
    PROGRESS_UPDATED: "Cập nhật tiến độ", TASK_COMPLETED: "Hoàn thành",
    TASK_REGISTRATION_APPROVED: "Duyệt đăng ký", TASK_ADJUSTMENT_REQUESTED: "Đề nghị điều chỉnh",
    TASK_ADJUSTMENT_APPROVED: "Duyệt điều chỉnh", TASK_ADJUSTMENT_REJECTED: "Không duyệt điều chỉnh"
  };
  return logs.length ? `<div class="task-history-list">${logs.map(item => `<article>
    <span class="task-history-dot" aria-hidden="true"></span>
    <div><strong>${escapeHtml(labels[item.action] || item.action || "Cập nhật")}</strong><span>${timestampVi(item.createdAt)} · ${escapeHtml(item.performedByName || "")}</span>${item.note ? `<p>${escapeHtml(item.note)}</p>` : ""}</div>
  </article>`).join("")}</div>` : '<div class="task-work-item-empty"><strong>Chưa có nhật ký</strong><span>Các thao tác tiếp theo sẽ được lưu tại đây.</span></div>';
}

function openAdjustmentRequest(task, onSaved) {
  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop nested-modal-backdrop";
  overlay.innerHTML = `<section class="modal-panel modal-medium" role="dialog" aria-modal="true">
    <div class="modal-header"><div><span class="page-eyebrow">${escapeHtml(task.taskCode || "")}</span><h2>Đề nghị điều chỉnh công việc</h2><p>Người giao nhiệm vụ sẽ quyết định chấm phần đã thực hiện hoặc không đánh giá toàn bộ.</p></div><button class="icon-button" data-close-adjustment type="button">✕</button></div>
    <div class="modal-body task-form-grid">
      <label class="field-full"><span>Phương án đề nghị</span><select id="adjustmentType"><option value="ADJUST_SCOPE">Điều chỉnh khối lượng và chấm phần đã thực hiện</option><option value="EXEMPT_FROM_SCORING">Không đánh giá do được điều động</option></select></label>
      <label class="field-full"><span>Lý do *</span><textarea id="adjustmentReason" rows="4" maxlength="3000" placeholder="Nêu quyết định điều động, thời gian và ảnh hưởng đến nhiệm vụ đã đăng ký"></textarea></label>
      <label class="field-full"><span>Khối lượng đã thực hiện/đề nghị điều chỉnh</span><input id="adjustedWorkload" maxlength="1000" placeholder="Ví dụ: Đã hoàn thành 4/10 hồ sơ trước ngày điều động"></label>
      <label class="field-full"><span>Nội dung thực hiện sau điều chỉnh</span><textarea id="adjustmentDescription" rows="3" maxlength="5000">${escapeHtml(task.description || "")}</textarea></label>
      <label><span>Hạn mới (nếu có)</span><input id="adjustmentDeadline" type="date" value="${escapeHtml(task.deadlineDateKey || "")}"></label>
      <label><span>Minh chứng/căn cứ</span><input id="adjustmentEvidence" maxlength="3000" placeholder="Số quyết định, nội dung phân công, lịch trực..."></label>
    </div>
    <div class="modal-footer"><button class="secondary-button" data-close-adjustment type="button">Hủy</button><button id="submitAdjustmentButton" class="primary-button" type="button">Gửi người giao phê duyệt</button></div>
  </section>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelectorAll("[data-close-adjustment]").forEach(button => button.addEventListener("click", close));
  overlay.querySelector("#submitAdjustmentButton")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    try {
      button.disabled = true;
      button.textContent = "Đang gửi...";
      await TaskAdjustmentService.request(task, {
        adjustmentType: overlay.querySelector("#adjustmentType")?.value,
        reason: overlay.querySelector("#adjustmentReason")?.value,
        adjustedWorkload: overlay.querySelector("#adjustedWorkload")?.value,
        description: overlay.querySelector("#adjustmentDescription")?.value,
        deadlineDateKey: overlay.querySelector("#adjustmentDeadline")?.value,
        evidenceText: overlay.querySelector("#adjustmentEvidence")?.value
      });
      close();
      await onSaved?.();
    } catch (error) {
      window.alert(error?.message || "Không gửi được đề nghị điều chỉnh.");
      button.disabled = false;
      button.textContent = "Gửi người giao phê duyệt";
    }
  });
}

async function openAttendanceDelegation(onSaved) {
  const [candidates, delegation] = await Promise.all([
    CdtnAttendanceService.listCandidates(),
    CdtnAttendanceService.getDelegation().catch(() => null)
  ]);
  const today = localToday();
  const end = new Date();
  end.setMonth(end.getMonth() + 3);
  const endKey = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop nested-modal-backdrop";
  overlay.innerHTML = `<section class="modal-panel modal-medium" role="dialog" aria-modal="true">
    <div class="modal-header"><div><span class="page-eyebrow">CHI ĐOÀN</span><h2>Ủy quyền điểm danh</h2><p>Người được ủy quyền có thể điểm danh trong thời hạn xác định; đoàn viên không được tự điểm danh.</p></div><button class="icon-button" data-close-delegation type="button">✕</button></div>
    <div class="modal-body task-form-grid">
      <label class="field-full"><span>Người được ủy quyền</span><select id="attendanceDelegate"><option value="">— Chọn thành viên —</option>${candidates.map(item => `<option value="${escapeHtml(item.id)}" ${delegation?.active && delegation.delegateUserId === item.id ? "selected" : ""}>${escapeHtml(item.fullName || item.email)} — ${escapeHtml(item.position || "Đoàn viên")}</option>`).join("")}</select></label>
      <label><span>Từ ngày</span><input id="attendanceDelegateStart" type="date" value="${escapeHtml(delegation?.startDate || today)}"></label>
      <label><span>Đến ngày</span><input id="attendanceDelegateEnd" type="date" value="${escapeHtml(delegation?.endDate || endKey)}"></label>
      <label class="field-full"><span>Lý do/phạm vi</span><textarea id="attendanceDelegateReason" rows="3" maxlength="1000">${escapeHtml(delegation?.reason || "Điểm danh hoạt động Chi đoàn theo phân công")}</textarea></label>
    </div>
    <div class="modal-footer">${delegation?.active ? '<button id="revokeAttendanceDelegation" class="secondary-button" type="button">Thu hồi ủy quyền</button>' : ""}<button class="secondary-button" data-close-delegation type="button">Hủy</button><button id="saveAttendanceDelegation" class="primary-button" type="button">Lưu ủy quyền</button></div>
  </section>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelectorAll("[data-close-delegation]").forEach(button => button.addEventListener("click", close));
  overlay.querySelector("#saveAttendanceDelegation")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    try {
      button.disabled = true;
      await CdtnAttendanceService.saveDelegation({
        delegateUserId: overlay.querySelector("#attendanceDelegate")?.value,
        startDate: overlay.querySelector("#attendanceDelegateStart")?.value,
        endDate: overlay.querySelector("#attendanceDelegateEnd")?.value,
        reason: overlay.querySelector("#attendanceDelegateReason")?.value
      });
      close();
      await onSaved?.();
    } catch (error) {
      window.alert(error?.message || "Không lưu được ủy quyền.");
      button.disabled = false;
    }
  });
  overlay.querySelector("#revokeAttendanceDelegation")?.addEventListener("click", async event => {
    if (!window.confirm("Thu hồi quyền điểm danh đang áp dụng?")) return;
    const button = event.currentTarget;
    try {
      button.disabled = true;
      await CdtnAttendanceService.revokeDelegation();
      close();
      await onSaved?.();
    } catch (error) {
      window.alert(error?.message || "Không thu hồi được ủy quyền.");
      button.disabled = false;
    }
  });
}

function resultRateOptions(selected) {
  return RESULT_RATE_OPTIONS.map(option => (
    `<option value="${option.value}" ${Number(selected || 0) === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`
  )).join("");
}

function commonDateFields(item) {
  return `
    <label><span>Người giao</span><input id="workItemAssignedBy" maxlength="300" value="${escapeHtml(item?.assignedByName || UserContext.getUser()?.fullName || "")}"></label>
    <label><span>Ngày giao</span><input id="workItemAssignedDate" type="date" value="${escapeHtml(item?.assignedDateKey || localToday())}"></label>
    <label><span>Hạn hoàn thành</span><input id="workItemDeadline" type="date" value="${escapeHtml(item?.deadlineDateKey || "")}"></label>
    <label><span>Ngày hoàn thành thực tế</span><input id="workItemCompletedDate" type="date" value="${escapeHtml(item?.completedDateKey || "")}"></label>
    <div class="field-full info-banner compact-info-banner"><strong>Tiến độ được tính tự động</strong><span>Hệ thống đối chiếu ngày hoàn thành với hạn xử lý theo hướng dẫn KPI; người dùng không phải tự chọn mức tiến độ.</span></div>`;
}

function editorFields(task, item) {
  const type = workItemType(task);
  if (type === "DOCUMENT") {
    return `
      <label class="field-full"><span>Trích yếu văn bản/hồ sơ được giao</span><input id="workItemTitle" maxlength="500" value="${escapeHtml(item?.title || "")}" placeholder="Ví dụ: Soạn thảo Thông báo triển khai kế hoạch quý III"></label>
      <label><span>Số/Ký hiệu hoặc căn cứ</span><input id="workItemReference" maxlength="500" value="${escapeHtml(item?.reference || "")}" placeholder="Ví dụ: 15/KH-TTBTXH"></label>
      ${commonDateFields(item)}
      <label class="field-full"><span>Mức kết quả</span><select id="workItemResultRate">${resultRateOptions(item?.resultRate)}</select><small>Chọn theo chất lượng văn bản/hồ sơ và mức độ phải chỉnh sửa.</small></label>`;
  }
  if (type === "QUANTITY") {
    return `
      <label><span>Tháng ghi nhận</span><input id="workItemReportingPeriod" type="month" value="${escapeHtml(item?.reportingPeriod || localToday().slice(0, 7))}"></label>
      <label><span>Sản phẩm</span><input id="workItemProductName" maxlength="300" value="${escapeHtml(item?.productName || "")}" placeholder="Ví dụ: Rau xanh thu hoạch"></label>
      <label><span>Sản lượng kế hoạch</span><input id="workItemPlannedQuantity" type="number" min="0.01" step="0.01" required value="${escapeHtml(item?.plannedQuantity ?? "")}"></label>
      <label><span>Sản lượng thực tế</span><input id="workItemActualQuantity" type="number" min="0" step="0.01" value="${escapeHtml(item?.actualQuantity ?? "")}"></label>
      <label class="field-full"><span>Đơn vị tính</span><input id="workItemQuantityUnit" maxlength="80" value="${escapeHtml(item?.quantityUnit || task.quantityUnit || "")}" placeholder="Ví dụ: kg rau"></label>
      <input id="workItemTitle" type="hidden" value="${escapeHtml(item?.title || "")}">
      ${commonDateFields(item)}
      <label class="field-full"><span>Chất lượng kết quả</span><select id="workItemResultRate">${resultRateOptions(item?.resultRate)}</select><small>Một tháng được tính K khi sản lượng thực tế đạt kế hoạch và chất lượng từ 80% trở lên.</small></label>`;
  }
  if (type === "ATTENDANCE") {
    return `
      <label class="field-full"><span>Tên buổi hoạt động</span><input id="workItemTitle" maxlength="500" value="${escapeHtml(item?.title || "")}" placeholder="Ví dụ: Sinh hoạt Chi đoàn tháng 8"></label>
      <label><span>Ngày tổ chức</span><input id="workItemSessionDate" type="date" value="${escapeHtml(item?.sessionDateKey || localToday())}"></label>
      <label><span>Tình trạng tham dự</span><select id="workItemAttendanceStatus">
        <option value="PRESENT" ${item?.attendanceStatus === "PRESENT" ? "selected" : ""}>Có mặt</option>
        <option value="EXCUSED" ${item?.attendanceStatus === "EXCUSED" ? "selected" : ""}>Vắng có phép</option>
        <option value="ABSENT" ${item?.attendanceStatus === "ABSENT" ? "selected" : ""}>Vắng mặt</option>
      </select></label>
      <label class="field-full"><span>Mức tham gia/kết quả</span><select id="workItemResultRate">${resultRateOptions(item?.resultRate)}</select><small id="attendanceResultHelp">Chỉ áp dụng khi có mặt; nếu vắng, hệ thống tự ghi nhận kết quả 0%.</small></label>
      <label class="field-full"><span>Ghi chú tham dự</span><textarea id="workItemParticipationNote" rows="2" maxlength="1000" placeholder="Nêu lý do vắng hoặc phần việc đã tham gia">${escapeHtml(item?.participationNote || "")}</textarea></label>`;
  }
  return `
    <label class="field-full"><span>Nội dung công việc được giao</span><input id="workItemTitle" maxlength="500" value="${escapeHtml(item?.title || "")}" placeholder="Nhập nội dung công việc"></label>
    <label><span>Số/Ký hiệu hoặc căn cứ</span><input id="workItemReference" maxlength="500" value="${escapeHtml(item?.reference || "")}" placeholder="Không bắt buộc"></label>
    ${commonDateFields(item)}
    <label class="field-full"><span>Mức kết quả</span><select id="workItemResultRate">${resultRateOptions(item?.resultRate)}</select><small>Chọn theo chất lượng sản phẩm và mức độ chỉnh sửa.</small></label>`;
}

function openWorkItemEditor(task, item, onSaved) {
  const type = workItemType(task);
  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop nested-modal-backdrop";
  overlay.innerHTML = `
    <section class="modal-panel modal-medium" role="dialog" aria-modal="true">
      <div class="modal-header">
        <div><span class="page-eyebrow">${escapeHtml(task.taskCode || task.id)}</span><h2>${item ? "Cập nhật" : "Thêm"} ${WORK_ITEM_LABELS[type].name.toLowerCase()}</h2><p>Các số liệu này là căn cứ tính N, T, K và điểm KPI cuối kỳ.</p></div>
        <button class="icon-button" type="button" data-close-work-item>✕</button>
      </div>
      <div class="modal-body task-form-grid">
        ${editorFields(task, item)}
        <label class="field-full"><span>Kết quả/Ghi chú</span><textarea id="workItemResultNote" rows="3" maxlength="3000" placeholder="Nêu kết quả, tình trạng chỉnh sửa hoặc nguyên nhân chưa hoàn thành">${escapeHtml(item?.resultNote || "")}</textarea></label>
        <label class="field-full"><span>Mô tả minh chứng/liên kết</span><textarea id="workItemEvidence" rows="2" maxlength="3000" placeholder="Nêu số văn bản, biên bản, hình ảnh hoặc mô tả minh chứng">${escapeHtml(item?.evidenceText || "")}</textarea></label>
        <label class="field-full"><span>Tệp minh chứng trên Google Drive</span><input id="workItemEvidenceFile" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"><small>${item?.evidenceFileName ? `Đang lưu: ${escapeHtml(item.evidenceFileName)}. Chọn tệp mới nếu cần thay thế.` : "Tối đa 8 MB; hỗ trợ PDF, ảnh, Word, Excel, PowerPoint và TXT."}</small></label>
        <div id="workItemUploadStatus" class="field-full task-work-item-upload-status" aria-live="polite"></div>
      </div>
      <div class="modal-footer"><button class="secondary-button" type="button" data-close-work-item>Hủy</button><button id="saveWorkItemButton" class="primary-button" type="button">Lưu thông tin</button></div>
    </section>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelectorAll("[data-close-work-item]").forEach(button => button.addEventListener("click", close));
  const attendanceStatus = overlay.querySelector("#workItemAttendanceStatus");
  const resultRate = overlay.querySelector("#workItemResultRate");
  const syncAttendanceResult = () => {
    if (!attendanceStatus || !resultRate) return;
    const present = attendanceStatus.value === "PRESENT";
    resultRate.disabled = !present;
    if (!present) resultRate.value = "0";
  };
  attendanceStatus?.addEventListener("change", syncAttendanceResult);
  syncAttendanceResult();
  overlay.querySelector("#saveWorkItemButton")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    try {
      button.disabled = true;
      button.textContent = "Đang lưu…";
      const selectedFile = overlay.querySelector("#workItemEvidenceFile")?.files?.[0] || null;
      let evidence = {
        evidenceUrl: item?.evidenceUrl || "",
        evidenceFileName: item?.evidenceFileName || "",
        evidenceStoragePath: item?.evidenceStoragePath || ""
      };
      if (selectedFile) {
        evidence = await DriveEvidenceService.upload(selectedFile, task, {
          onProgress: state => {
            const target = overlay.querySelector("#workItemUploadStatus");
            if (target) target.textContent = state.message || "Đang tải minh chứng…";
          }
        });
      }

      await TaskWorkItemService.save(task, {
        workItemType: type,
        title: overlay.querySelector("#workItemTitle")?.value,
        reference: overlay.querySelector("#workItemReference")?.value,
        assignedByName: overlay.querySelector("#workItemAssignedBy")?.value,
        assignedDateKey: overlay.querySelector("#workItemAssignedDate")?.value,
        deadlineDateKey: overlay.querySelector("#workItemDeadline")?.value,
        completedDateKey: overlay.querySelector("#workItemCompletedDate")?.value,
        reportingPeriod: overlay.querySelector("#workItemReportingPeriod")?.value,
        productName: overlay.querySelector("#workItemProductName")?.value,
        plannedQuantity: overlay.querySelector("#workItemPlannedQuantity")?.value,
        actualQuantity: overlay.querySelector("#workItemActualQuantity")?.value,
        quantityUnit: overlay.querySelector("#workItemQuantityUnit")?.value,
        sessionDateKey: overlay.querySelector("#workItemSessionDate")?.value,
        attendanceStatus: overlay.querySelector("#workItemAttendanceStatus")?.value,
        participationNote: overlay.querySelector("#workItemParticipationNote")?.value,
        resultRate: overlay.querySelector("#workItemResultRate")?.value,
        resultNote: overlay.querySelector("#workItemResultNote")?.value,
        evidenceText: overlay.querySelector("#workItemEvidence")?.value,
        evidenceUrl: evidence.fileUrl || evidence.evidenceUrl || "",
        evidenceFileName: evidence.fileName || evidence.evidenceFileName || selectedFile?.name || "",
        evidenceStoragePath: evidence.storagePath || evidence.fileId || evidence.evidenceStoragePath || ""
      }, item);
      close();
      await onSaved?.();
    } catch (error) {
      window.alert(error?.message || "Không lưu được thông tin chi tiết.");
      button.disabled = false;
      button.textContent = "Lưu thông tin";
    }
  });
}

function noOccurrenceHtml(task, workItems, isOwner) {
  const status = String(task.noOccurrenceStatus || "NONE").toUpperCase();
  if (status === "CONFIRMED") {
    return `<div class="info-banner no-occurrence-banner is-confirmed"><strong>Đã xác nhận không phát sinh</strong><span>Đầu việc đã được loại khỏi điểm A và không cộng vào B của kỳ. Lý do: ${escapeHtml(task.noOccurrenceReason || "Không ghi lý do")}.</span></div>`;
  }
  if (status === "REQUESTED") {
    return `<div class="info-banner no-occurrence-banner is-pending"><strong>Đang chờ xác nhận “Không phát sinh”</strong><span>${escapeHtml(task.noOccurrenceReason || "")}</span>${canReviewNoOccurrence(task) ? '<div class="no-occurrence-actions"><button id="confirmNoOccurrenceButton" class="primary-button compact-button" type="button">Xác nhận</button><button id="rejectNoOccurrenceButton" class="secondary-button compact-button" type="button">Không chấp thuận</button></div>' : ""}</div>`;
  }
  const rejection = status === "REJECTED"
    ? `<span class="text-danger">Đề nghị trước chưa được chấp thuận: ${escapeHtml(task.noOccurrenceRejectionReason || "")}</span>`
    : "";
  if (isOwner && !workItems.length) {
    return `<div class="info-banner no-occurrence-banner"><strong>Trong kỳ chưa có lượt công việc phát sinh</strong><span>Không chấm 0% hoặc 100%. Nếu chắc chắn không phát sinh, hãy gửi Trưởng phòng xác nhận để loại đầu việc khỏi A.</span>${rejection}<button id="requestNoOccurrenceButton" class="secondary-button compact-button" type="button">Đề nghị “Không phát sinh”</button></div>`;
  }
  return rejection ? `<div class="info-banner no-occurrence-banner">${rejection}</div>` : "";
}

export async function openTaskDetailModal(task, { onSaved }) {
  const currentUser = UserContext.requireUser();
  const isOwner = task.ownerUserId === currentUser.uid;
  const accepted = task.assignmentStatus === "DA_TIEP_NHAN";
  const completed = task._completed === true ||
    ["HOAN_THANH", "COMPLETED", "DA_HOAN_THANH"].includes(String(task.status || "").toUpperCase()) ||
    Boolean(task.completedAt);
  const [users, initialWorkItems, adjustments, logs, canManageAttendance] = await Promise.all([
    canAssign(task) ? UserReadService.listActive() : Promise.resolve([]),
    isItemizedTask(task) ? TaskWorkItemService.list(task.id) : Promise.resolve([]),
    TaskAdjustmentService.list(task.id),
    TaskLogService.list(task.id),
    String(task.organizationId || "").toUpperCase() === "CDTN" && workItemType(task) === "ATTENDANCE"
      ? CdtnAttendanceService.canManage()
      : Promise.resolve(false)
  ]);
  const departmentUsers = users.filter(user => user.departmentId === task.primaryDepartmentId);
  const teams = departmentTeams(departmentUsers);
  let workItems = initialWorkItems;
  const workItemsLocked = task.scoreLocked === true ||
    ["CONFIRMED", "NO_OCCURRENCE_CONFIRMED"].includes(String(task.scoringStatus || "").toUpperCase());
  const canEditWorkItems = isItemizedTask(task)
    && (canManageAttendance || await TaskWorkItemService.mayEditItemAsync(task, null))
    && !workItemsLocked;
  const labels = WORK_ITEM_LABELS[workItemType(task)];

  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop";
  overlay.innerHTML = `
    <section class="modal-panel modal-large task-detail-modal" role="dialog" aria-modal="true">
      <div class="modal-header">
        <div>
          <span class="page-eyebrow">${escapeHtml(task.taskCode || task.id)}</span>
          <h2>${escapeHtml(task.title || "Nhiệm vụ")}</h2>
          <p>${escapeHtml(task.primaryDepartmentId || "")} • ${escapeHtml(statusName(task))} ${adjustmentStatusHtml(task)}</p>
        </div>
        <button class="icon-button" type="button" data-close>✕</button>
      </div>
      <nav class="task-detail-tabs" aria-label="Chi tiết nhiệm vụ">
        <button class="active" data-task-tab="registration" type="button">Thông tin đăng ký</button>
        <button data-task-tab="process" type="button">Quá trình thực hiện</button>
        <button data-task-tab="adjustment" type="button">Điều chỉnh công việc</button>
        <button data-task-tab="evidence" type="button">Minh chứng</button>
        <button data-task-tab="history" type="button">Lịch sử</button>
      </nav>
      <div class="modal-body task-detail-tab-body">
        <section class="task-tab-panel active" data-task-panel="registration">
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
        ${canAssign(task) ? `<section class="detail-section"><h3>Phân công nội bộ</h3><div class="inline-form assignment-inline-form">
          <select id="assignTeam"><option value="">— Không chọn Tổ/Nhóm —</option>${teams.map(team => `<option value="${escapeHtml(team.id)}" ${team.id === normalizeTeamId(task.teamId) ? "selected" : ""}>${escapeHtml(team.label)}</option>`).join("")}</select>
          <select id="assignOwner"><option value="">— Chưa phân công cá nhân —</option></select>
          <button id="assignTaskButton" class="secondary-button" type="button">Lưu phân công</button>
        </div><small>Thay đổi người thực hiện không tự động chuyển điểm; mỗi nhân sự được tính theo nhiệm vụ đã đăng ký hoặc bổ sung được phê duyệt.</small></section>` : ""}
        </section>
        <section class="task-tab-panel" data-task-panel="process" hidden>
        ${isItemizedTask(task) ? `<section class="detail-section task-work-items-section">
          <div class="detail-section-heading"><div><h3>${labels.name}</h3><p>Mỗi lượt được chấm riêng, sau đó lấy trung bình chính xác để tính một lần theo Phụ lục 04.</p></div><div class="detail-section-actions">${Permissions.isCdtnSecretary() || Permissions.isCdtnDeputySecretary() ? '<button id="delegateAttendanceButton" class="secondary-button compact-button" type="button">Ủy quyền điểm danh</button>' : ""}${canEditWorkItems ? `<button id="addWorkItemButton" class="primary-button compact-button" type="button">+ ${labels.add}</button>` : ""}</div></div>
          ${scoringMethodHtml(task)}
          <div id="taskNoOccurrence">${noOccurrenceHtml(task, workItems, isOwner)}</div>
          <div id="taskWorkItemSummary">${workItemSummaryHtml(workItems, task)}</div>
          <div id="taskWorkItemList">${workItemRows(workItems, canEditWorkItems, task)}</div>
        </section>` : `<div class="info-banner final-output-banner"><strong>Đánh giá trực tiếp theo Phụ lục 04</strong><span>Đầu việc này có một sản phẩm/kết quả cuối cùng nên không tạo lượt chi tiết. Khi hoàn thành, hệ thống chấm một lần theo tiến độ, kết quả, điểm chuẩn và hệ số độ khó của chính đầu việc.</span></div>`}
        ${isOwner && !accepted && !completed ? '<div class="info-banner">Bạn cần xác nhận đã nhận nhiệm vụ trước khi cập nhật tiến độ, kết quả hoặc minh chứng.</div>' : ""}
        </section>
        <section class="task-tab-panel" data-task-panel="adjustment" hidden>${adjustmentsHtml(task, adjustments)}</section>
        <section class="task-tab-panel" data-task-panel="evidence" hidden>
          <section class="detail-section evidence-focus-card"><h3>Kết quả và minh chứng cuối cùng</h3><p>${escapeHtml(task.resultSummary || task.result || "Chưa ghi nhận kết quả.")}</p>${safeExternalUrl(task.evidenceUrl) ? `<a class="primary-link" target="_blank" rel="noopener" href="${escapeHtml(safeExternalUrl(task.evidenceUrl))}">📎 ${escapeHtml(task.evidenceFileName || "Mở tệp minh chứng")}</a>` : ""}${task.evidenceText ? `<p>${escapeHtml(task.evidenceText)}</p>` : ""}</section>
        </section>
        <section class="task-tab-panel" data-task-panel="history" hidden>${historyHtml(logs)}</section>
      </div>
      <div class="modal-footer"><button class="secondary-button" type="button" data-close>Đóng</button>${isOwner && !accepted && !completed ? '<button id="acceptTaskButton" class="primary-button" type="button">Xác nhận đã nhận nhiệm vụ</button>' : ""}${isOwner && accepted && !completed && String(task.noOccurrenceStatus || "").toUpperCase() !== "CONFIRMED" ? '<button id="updateTaskButton" class="primary-button" type="button">Cập nhật nhiệm vụ</button>' : ""}</div>
    </section>`;

  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", close));

  overlay.querySelectorAll("[data-task-tab]").forEach(button => button.addEventListener("click", () => {
    const selected = button.dataset.taskTab;
    overlay.querySelectorAll("[data-task-tab]").forEach(item => item.classList.toggle("active", item === button));
    overlay.querySelectorAll("[data-task-panel]").forEach(panel => {
      const active = panel.dataset.taskPanel === selected;
      panel.hidden = !active;
      panel.classList.toggle("active", active);
    });
  }));

  overlay.querySelector("#requestAdjustmentButton")?.addEventListener("click", () => {
    openAdjustmentRequest(task, async () => {
      close();
      await onSaved?.();
    });
  });

  overlay.querySelectorAll("[data-approve-adjustment]").forEach(button => button.addEventListener("click", async () => {
    const adjustment = adjustments.find(item => item.id === button.dataset.adjustmentId);
    if (!adjustment) return;
    const type = button.dataset.approveAdjustment;
    const message = type === "EXEMPT_FROM_SCORING"
      ? "Phê duyệt không đánh giá: nhiệm vụ vẫn lưu trong lịch sử nhưng bị loại khỏi A và không chấm 0 điểm. Tiếp tục?"
      : "Phê duyệt điều chỉnh khối lượng và chấm phần đã thực hiện?";
    if (!window.confirm(message)) return;
    try {
      button.disabled = true;
      await TaskAdjustmentService.approve(task, adjustment, type);
      close();
      await onSaved?.();
    } catch (error) {
      window.alert(error?.message || "Không phê duyệt được điều chỉnh.");
      button.disabled = false;
    }
  }));

  overlay.querySelectorAll("[data-reject-adjustment]").forEach(button => button.addEventListener("click", async () => {
    const adjustment = adjustments.find(item => item.id === button.dataset.rejectAdjustment);
    if (!adjustment) return;
    const reason = window.prompt("Nêu lý do không chấp thuận đề nghị điều chỉnh:");
    if (reason === null) return;
    try {
      button.disabled = true;
      await TaskAdjustmentService.reject(task, adjustment, reason);
      close();
      await onSaved?.();
    } catch (error) {
      window.alert(error?.message || "Không xử lý được đề nghị.");
      button.disabled = false;
    }
  }));

  const refreshWorkItems = async () => {
    workItems = await TaskWorkItemService.list(task.id);
    const list = overlay.querySelector("#taskWorkItemList");
    const summary = overlay.querySelector("#taskWorkItemSummary");
    const noOccurrence = overlay.querySelector("#taskNoOccurrence");
    if (list) list.innerHTML = workItemRows(workItems, canEditWorkItems, task);
    if (summary) summary.innerHTML = workItemSummaryHtml(workItems, task);
    if (noOccurrence) noOccurrence.innerHTML = noOccurrenceHtml(task, workItems, isOwner);
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
  overlay.querySelector("#delegateAttendanceButton")?.addEventListener("click", () => openAttendanceDelegation(async () => {
    close();
    await onSaved?.();
  }));
  bindWorkItemActions();

  overlay.querySelector("#requestNoOccurrenceButton")?.addEventListener("click", async () => {
    const reason = window.prompt("Nêu lý do đầu việc không phát sinh trong kỳ:");
    if (reason === null) return;
    try {
      await TaskWriteService.requestNoOccurrence(task, reason);
      close();
      await onSaved?.();
    } catch (error) {
      window.alert(error?.message || "Không gửi được đề nghị.");
    }
  });
  overlay.querySelector("#confirmNoOccurrenceButton")?.addEventListener("click", async () => {
    if (!window.confirm("Xác nhận không phát sinh và loại đầu việc này khỏi điểm A của kỳ?")) return;
    try {
      await TaskWriteService.confirmNoOccurrence(task);
      close();
      await onSaved?.();
    } catch (error) {
      window.alert(error?.message || "Không xác nhận được đề nghị.");
    }
  });
  overlay.querySelector("#rejectNoOccurrenceButton")?.addEventListener("click", async () => {
    const reason = window.prompt("Nêu lý do không chấp thuận:");
    if (reason === null) return;
    try {
      await TaskWriteService.rejectNoOccurrence(task, reason);
      close();
      await onSaved?.();
    } catch (error) {
      window.alert(error?.message || "Không xử lý được đề nghị.");
    }
  });

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
  if (String(task.noOccurrenceStatus || "").toUpperCase() === "CONFIRMED") return "Không phát sinh";
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

function monthVi(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value || ""));
  return match ? `${match[2]}/${match[1]}` : "—";
}

function localToday() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function safeExternalUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.href : "";
  } catch (_) {
    return "";
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
