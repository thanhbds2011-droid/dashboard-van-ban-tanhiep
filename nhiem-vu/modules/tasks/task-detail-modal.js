/** Chi tiết, phân công và các lượt công việc phát sinh của nhiệm vụ. */
import { UserContext } from "../../core/user-context.js?v=20260903.V1_22_3";
import { friendlyErrorMessage } from "../../core/friendly-error.js?v=20260903.V1_22_3";
import { ModalService } from "../../core/modal-service.js?v=20260903.V1_22_3";
import { Permissions } from "../../core/permissions.js?v=20260903.V1_22_3";
import { effectiveDepartmentAssignmentStatus, isTerminalTask } from "../../core/task-display-order.js?v=20260903.V1_22_3";
import { UserReadService } from "../../services/user-read-service.js?v=20260903.V1_22_3";
import { TaskWriteService } from "../../services/task-write-service.js?v=20260903.V1_22_3";
import { TaskWorkItemService } from "../../services/task-work-item-service.js?v=20260903.V1_22_3";
import { TaskEvidenceService } from "../../services/task-evidence-service.js?v=20260903.V1_22_3";
import { StagedEvidenceUploader } from "../../services/staged-evidence-uploader.js?v=20260903.V1_22_3";
import { openTaskProgressModal } from "./task-progress-modal.js?v=20260903.V1_22_3";
import { mountTaskAdjustmentPanel } from "./task-adjustment-panel.js?v=20260903.V1_22_3";
import { TaskLogService } from "../../services/task-log-service.js?v=20260903.V1_22_3";

const TEAM_LABELS = Object.freeze({
  BAO_VE: "Tổ Bảo vệ",
  DIEN_NUOC: "Tổ Điện nước",
  HAU_CAN: "Tổ Hậu cần"
});

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

function sameTaskDepartment(task, user = UserContext.requireUser()) {
  return String(task?.primaryDepartmentId || "").toUpperCase() === String(user?.departmentId || "").toUpperCase();
}

function isSelfRegisteredTask(task) {
  return String(task?.entryMode || "").toUpperCase() === "SELF_REGISTERED_APPROVED"
    || (String(task?.sourceType || "").toUpperCase() === "DANG_KY_KE_HOACH" && String(task?.registrationId || "").trim() !== "");
}

function canAssign(task) {
  const user = UserContext.requireUser();
  if (isSelfRegisteredTask(task)) return false;
  if (isTerminalTask(task) || String(task?.scoringStatus || "").toUpperCase() === "ADJUSTMENT_EXEMPT") return false;

  const assignmentStatus = String(task?.assignmentStatus || "").toUpperCase();
  if (assignmentStatus === "DA_TIEP_NHAN" || task?.acceptedAt) return false;

  const departmentStatus = effectiveDepartmentAssignmentStatus(task);
  if (departmentStatus !== "ACCEPTED") return false;

  return Permissions.isAdmin()
    || (Permissions.isDirector() && sameTaskDepartment(task, user))
    || (Permissions.isDepartmentLeader() && sameTaskDepartment(task, user));
}

function canAcceptDepartment(task) {
  const user = UserContext.requireUser();
  const departmentStatus = effectiveDepartmentAssignmentStatus(task);
  return Permissions.isDepartmentLeader()
    && sameTaskDepartment(task, user)
    && !String(task?.ownerUserId || "").trim()
    && departmentStatus === "PENDING_ACCEPTANCE"
    && !isTerminalTask(task);
}

function departmentName(task) {
  const id = String(task?.primaryDepartmentId || "").toUpperCase();
  return DEPARTMENT_NAMES[id] || id || "Phòng/Khu";
}

function ownerDisplayName(task) {
  if (String(task?.ownerName || "").trim()) return task.ownerName;
  const departmentStatus = effectiveDepartmentAssignmentStatus(task);
  if (departmentStatus === "PENDING_ACCEPTANCE") return `${departmentName(task)} — Chờ tiếp nhận`;
  return `${departmentName(task)} — Chờ phân công`;
}

function departmentAcceptanceLabel(task) {
  const status = effectiveDepartmentAssignmentStatus(task);
  if (status === "PENDING_ACCEPTANCE") return "Chờ Phòng/Khu tiếp nhận";
  if (status === "DIRECT_ASSIGNED") return "Ban Giám đốc đã giao trực tiếp";
  if (status === "ACCEPTED") {
    const actor = String(task?.departmentAcceptedByName || "").trim();
    return actor ? `Đã nhận — ${actor}` : "Phòng/Khu đã nhận";
  }
  return "Theo dữ liệu cũ";
}

function canReviewNoOccurrence(task) {
  const user = UserContext.requireUser();
  if (task.ownerUserId === user.uid) return false;
  const directApprover = String(
    task.adjustmentApproverUserId || task.assignedByUserId || task.createdByUserId || ""
  ) === user.uid;
  return Permissions.isAdmin() || directApprover;
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

function evidenceHtml(item, evidenceFiles = []) {
  const url = safeExternalUrl(item.evidenceUrl);
  const scoped = (evidenceFiles || []).filter(file => file.active !== false && file.scopeType === "WORK_ITEM" && file.scopeId === item.id);
  const list = scoped.map(file => `<a class="primary-link" target="_blank" rel="noopener" href="${escapeHtml(safeExternalUrl(file.fileUrl) || "#")}">📎 ${escapeHtml(file.fileName || "Mở minh chứng")}</a>`).join("");
  const legacy = url && !scoped.some(file => file.fileUrl === url)
    ? `<a class="primary-link" target="_blank" rel="noopener" href="${escapeHtml(url)}">📎 ${escapeHtml(item.evidenceFileName || "Mở minh chứng")}</a>`
    : "";
  return `${item.evidenceText ? `<small>Minh chứng: ${escapeHtml(item.evidenceText)}</small>` : ""}${list}${legacy}`;
}

function workItemContent(item, type, evidenceFiles = []) {
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
      ${evidenceHtml(item, evidenceFiles)}`;
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
    ${evidenceHtml(item, evidenceFiles)}`;
}

function workItemRows(items, canEdit, task, evidenceFiles = []) {
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
      <div class="task-work-item-main">${workItemContent(item, type, evidenceFiles)}</div>
      ${canEdit ? `<div class="task-work-item-actions"><button class="secondary-button compact-button" type="button" data-edit-work-item="${escapeHtml(item.id)}">Sửa</button><button class="danger-button compact-button" type="button" data-remove-work-item="${escapeHtml(item.id)}">Xóa</button></div>` : ""}
    </article>`).join("")}</div>`;
}

function eventDrivenKpiExplanation(items, task, summary) {
  if (String(task?.deadlineMode || "").toUpperCase() !== "EVENT_DRIVEN" || summary.workItemType === "ATTENDANCE" || !summary.count) return "";
  const activeCompleted = (items || []).filter(item => item?.active !== false && item?.completedDateKey);
  const rateCount = rate => activeCompleted.filter(item => Number(item.progressRate || 0) === rate).length;
  const buckets = [
    rateCount(100) ? `${rateCount(100)} lượt đúng hạn → 100%` : "",
    rateCount(80) ? `${rateCount(80)} lượt trễ 1–3 ngày → 80%` : "",
    rateCount(60) ? `${rateCount(60)} lượt trễ 4–5 ngày → 60%` : "",
    rateCount(0) ? `${rateCount(0)} lượt ở mức 0% (trễ trên 5 ngày hoặc không đạt điều kiện)` : ""
  ].filter(Boolean);
  const completionRate = summary.count > 0 ? Math.round((Number(summary.completedCount || 0) / Number(summary.count)) * 100) : 0;
  return `<div class="info-banner task-kpi-meaning-banner">
    <strong>Hoàn thành công việc và điểm tiến độ KPI là hai chỉ số khác nhau</strong>
    <span>Hoàn thành nghiệp vụ: <b>${summary.completedCount}/${summary.count} = ${completionRate}%</b>. Điểm tiến độ KPI được tính theo đúng/trễ hạn của từng lượt nên có thể thấp hơn 100% dù toàn bộ công việc đã làm xong.${buckets.length ? ` ${buckets.join("; ")}.` : ""}</span>
  </div>`;
}

function workItemSummaryHtml(items, task) {
  const type = workItemType(task);
  const summary = TaskWorkItemService.calculateSummary(items, type, task);
  if (!summary.count) return "";

  const typeSpecific = type === "ATTENDANCE"
    ? `<div><span>Có mặt (T)</span><strong>${summary.presentCount}/${summary.count}</strong></div>
       <div><span>Đạt yêu cầu (K)</span><strong>${summary.qualifiedCount}/${summary.count}</strong></div>
       <div><span>Vắng có phép</span><strong>${summary.excusedCount}</strong></div>
       <div><span>Vắng mặt</span><strong>${summary.absentCount}</strong></div>`
    : type === "QUANTITY"
      ? `<div><span>Đúng hạn 100%</span><strong>${summary.onTimeCount}/${summary.count}</strong></div>
         <div><span>Đạt yêu cầu từ 80%</span><strong>${summary.qualifiedCount}/${summary.count}</strong></div>
         <div><span>Tổng kế hoạch</span><strong>${numberVi(summary.totalPlannedQuantity)} ${escapeHtml(task.quantityUnit || "")}</strong></div>
         <div><span>Tổng thực tế</span><strong>${numberVi(summary.totalActualQuantity)} ${escapeHtml(task.quantityUnit || "")}</strong></div>`
      : `<div><span>Đúng hạn 100%</span><strong>${summary.onTimeCount}/${summary.count}</strong></div>
         <div><span>Đạt yêu cầu từ 80%</span><strong>${summary.qualifiedCount}/${summary.count}</strong></div>`;

  const incomplete = summary.incompleteCount > 0
    ? `<div class="is-warning"><span>Chưa hoàn thành</span><strong>${summary.incompleteCount}</strong></div>`
    : "";
  const actualProgressLabel = type === "ATTENDANCE" ? "Tỷ lệ tham gia thực tế T/N" : "Tỷ lệ tiến độ thực tế";
  const actualResultLabel = type === "ATTENDANCE" ? "Tỷ lệ kết quả thực tế K/N" : "Tỷ lệ kết quả thực tế";
  const completionRate = summary.count > 0 ? Math.round((Number(summary.completedCount || 0) / Number(summary.count)) * 100) : 0;

  return `${eventDrivenKpiExplanation(items, task, summary)}<div class="task-work-item-summary">
    ${Number(summary.totalRecordedCount || summary.count) !== Number(summary.count) ? `<div><span>Tổng lượt đã ghi nhận</span><strong>${summary.totalRecordedCount}</strong></div>` : ""}
    <div><span>Lượt đang được tính KPI (N)</span><strong>${summary.count}</strong></div>
    <div><span>Hoàn thành nghiệp vụ</span><strong>${summary.completedCount}/${summary.count} · ${completionRate}%</strong></div>
    ${Number(summary.futurePendingCount || 0) > 0 ? `<div><span>Chưa đến hạn, chưa tính</span><strong>${summary.futurePendingCount}</strong></div>` : ""}
    ${incomplete}
    ${typeSpecific}
    <div><span>${actualProgressLabel}</span><strong>${numberVi(summary.actualProgressRate)}%</strong></div>
    <div><span>${actualResultLabel}</span><strong>${numberVi(summary.actualResultRate)}%</strong></div>
    <div class="is-applied"><span>Điểm KPI áp dụng</span><strong>Tiến độ ${summary.appliedProgressRate}% · Kết quả ${summary.appliedResultRate}%</strong></div>
  </div>`;
}

function scoringMethodHtml(task) {
  const type = workItemType(task);
  if (type === "ATTENDANCE") {
    return `<div class="scoring-method-card">
      <div class="scoring-method-heading"><span>Cách tính điểm đầu việc</span><strong>Hoạt động và điểm danh theo buổi</strong></div>
      <div class="scoring-method-steps">
        <div><b>N</b><span>Tổng số buổi phải tham gia trong kỳ</span></div>
        <div><b>T</b><span>Số buổi có mặt</span></div>
        <div><b>K</b><span>Số buổi có mặt và đạt yêu cầu</span></div>
      </div>
      <p>Tính T/N và K/N, sau đó quy về thang 100% – 80% – 60% – 0%. Ví dụ 1/2 = 50% được quy về 0%. Toàn đầu việc chỉ được chấm một lần.</p>
    </div>`;
  }

  const title = type === "DOCUMENT"
    ? "Văn bản/hồ sơ phát sinh nhiều lượt"
    : type === "QUANTITY"
      ? "Sản lượng ghi nhận theo từng lượt"
      : "Công việc phát sinh nhiều lượt";
  return `<div class="scoring-method-card">
    <div class="scoring-method-heading"><span>Cách tính điểm đầu việc</span><strong>${escapeHtml(title)}</strong></div>
    <div class="scoring-method-steps">
      <div><b>1</b><span>Chấm tiến độ và kết quả từng lượt theo 100% – 80% – 60% – 0%</span></div>
      <div><b>2</b><span>Lấy trung bình chính xác của tất cả lượt hợp lệ</span></div>
      <div><b>3</b><span>Quy trung bình về thang Phụ lục 04 rồi tính điểm một lần</span></div>
    </div>
    <p>Ví dụ hai lượt 100% và 80% có trung bình 90%, sau đó quy về 80%. Không cộng điểm riêng và không nhân điểm chuẩn theo số lượt.</p>
  </div>`;
}

function resultRateOptions(selected) {
  return RESULT_RATE_OPTIONS.map(option => (
    `<option value="${option.value}" ${Number(selected || 0) === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`
  )).join("");
}

function commonDateFields(task, item) {
  const eventDriven = String(task?.deadlineMode || "").toUpperCase() === "EVENT_DRIVEN";
  return `
    <label><span>Người giao</span><input id="workItemAssignedBy" maxlength="300" value="${escapeHtml(item?.assignedByName || UserContext.getUser()?.fullName || "")}"></label>
    <label><span>${eventDriven ? "Ngày phát sinh/nhận yêu cầu" : "Ngày giao"}</span><input id="workItemAssignedDate" type="date" value="${escapeHtml(item?.assignedDateKey || localToday())}"></label>
    <label><span>Hạn hoàn thành cụ thể</span><input id="workItemDeadline" type="date" value="${escapeHtml(item?.deadlineDateKey || "")}" required></label>
    <label><span>Ngày hoàn thành thực tế</span><input id="workItemCompletedDate" type="date" value="${escapeHtml(item?.completedDateKey || "")}"></label>
    <div class="field-full info-banner compact-info-banner"><strong>Tiến độ được tính tự động</strong><span>${eventDriven ? "Mỗi lượt phát sinh bắt buộc có hạn riêng. " : ""}Hệ thống đối chiếu ngày hoàn thành với hạn xử lý theo hướng dẫn KPI; người dùng không phải tự chọn mức tiến độ.</span></div>`;
}

function editorFields(task, item) {
  const type = workItemType(task);
  if (type === "DOCUMENT") {
    return `
      <label class="field-full"><span>Trích yếu văn bản/hồ sơ được giao</span><input id="workItemTitle" maxlength="500" value="${escapeHtml(item?.title || "")}" placeholder="Ví dụ: Soạn thảo Thông báo triển khai kế hoạch quý III"></label>
      <label><span>Số/Ký hiệu hoặc căn cứ</span><input id="workItemReference" maxlength="500" value="${escapeHtml(item?.reference || "")}" placeholder="Ví dụ: 15/KH-TTBTXH"></label>
      ${commonDateFields(task, item)}
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
      ${commonDateFields(task, item)}
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
    ${commonDateFields(task, item)}
    <label class="field-full"><span>Mức kết quả</span><select id="workItemResultRate">${resultRateOptions(item?.resultRate)}</select><small>Chọn theo chất lượng sản phẩm và mức độ chỉnh sửa.</small></label>`;
}

function workItemStagedEvidenceHtml(items = []) {
  const visible = (items || []).filter(entry => entry.committed !== true && !["DISCARDED", "REMOVED"].includes(entry.status));
  if (!visible.length) return `<div class="task-evidence-empty staged-evidence-empty">Chưa chọn tệp bổ sung.</div>`;
  return `<div class="staged-evidence-list">${visible.map(entry => {
    const uploaded = entry.status === "UPLOADED";
    const selected = entry.status === "SELECTED";
    const error = entry.status === "ERROR";
    const busy = ["UPLOADING", "ROLLING_BACK"].includes(entry.status);
    const statusText = selected ? "Đã chọn · Chưa lưu" : uploaded ? "Đã tải · Đang hoàn tất lưu" : (entry.message || "Đang xử lý…");
    return `<div class="staged-evidence-row ${uploaded ? "is-uploaded" : error ? "is-error" : busy ? "is-busy" : ""}" data-work-item-staged-id="${escapeHtml(entry.id)}">
      <div class="staged-evidence-main"><strong>${escapeHtml(entry.originalName || entry.uploaded?.fileName || "Tệp minh chứng")}</strong><small>${escapeHtml(statusText)}</small>${busy ? `<div class="staged-evidence-progress"><span style="width:${Math.max(2, Math.min(100, Number(entry.percent || 0)))}%"></span></div>` : ""}</div>
      <div class="staged-evidence-actions">${error ? `<button type="button" class="secondary-button compact-button" data-retry-work-item-staged="${escapeHtml(entry.id)}">Thử lại</button>` : ""}<button type="button" class="evidence-remove-button" data-remove-work-item-staged="${escapeHtml(entry.id)}" title="Bỏ tệp" aria-label="Bỏ tệp">×</button></div>
    </div>`;
  }).join("")}</div>`;
}

function openWorkItemEditor(task, item, onSaved, existingEvidenceFiles = []) {
  const type = workItemType(task);
  let currentItem = item || null;
  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop nested-modal-backdrop";
  overlay.innerHTML = `
    <section class="modal-panel modal-medium" role="dialog" aria-modal="true">
      <div class="modal-header">
        <div><span class="page-eyebrow">${escapeHtml(task.taskCode || task.id)}</span><h2>${item ? "Cập nhật" : "Thêm"} ${WORK_ITEM_LABELS[type].name.toLowerCase()}</h2></div>
        <button class="icon-button" type="button" data-close-work-item>✕</button>
      </div>
      <div class="modal-body task-form-grid">
        ${editorFields(task, item)}
        <label class="field-full"><span>Kết quả/Ghi chú</span><textarea id="workItemResultNote" rows="3" maxlength="3000" placeholder="Nêu kết quả, tình trạng chỉnh sửa hoặc nguyên nhân chưa hoàn thành">${escapeHtml(item?.resultNote || "")}</textarea></label>
        <label class="field-full"><span>Mô tả minh chứng/liên kết</span><textarea id="workItemEvidence" rows="2" maxlength="3000" placeholder="Nêu số văn bản, biên bản, hình ảnh hoặc mô tả minh chứng">${escapeHtml(item?.evidenceText || "")}</textarea></label>
        <label class="field-full"><span>Bổ sung tệp/hình ảnh minh chứng</span><input id="workItemEvidenceFile" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"><small>10 tệp/lần · tối đa 20 tệp/nhiệm vụ · 8 MB/tệp</small></label>
        <div id="workItemFormError" class="field-full task-progress-form-error" hidden role="alert"></div>
        <div id="workItemEvidenceStagedBox" class="field-full task-evidence-staged" hidden><div class="task-evidence-existing-head"><strong>Tệp chờ lưu</strong></div><div id="workItemUploadStatus">${workItemStagedEvidenceHtml([])}</div></div>
      </div>
      <div class="modal-footer"><button class="secondary-button" type="button" data-close-work-item>Hủy</button><button id="saveWorkItemButton" class="primary-button" type="button">Lưu thông tin</button></div>
    </section>`;
  document.body.appendChild(overlay);

  let saving = false;
  let closing = false;
  const existingEvidence = Array.isArray(existingEvidenceFiles) ? existingEvidenceFiles : [];
  const staged = new StagedEvidenceUploader(task, {
    existingCount: existingEvidence.filter(file => file.active !== false).length,
    onChange: () => { renderStaged(); refreshSaveState(); }
  });

  const setError = message => {
    const box = overlay.querySelector("#workItemFormError");
    if (!box) return;
    box.hidden = !message;
    box.textContent = message || "";
  };
  const renderStaged = () => {
    const target = overlay.querySelector("#workItemUploadStatus");
    if (target) target.innerHTML = workItemStagedEvidenceHtml(staged.snapshot());
  };
  const refreshSaveState = () => {
    const button = overlay.querySelector("#saveWorkItemButton");
    if (!button) return;
    const hasError = staged.snapshot().some(entry => entry.status === "ERROR");
    button.disabled = saving || staged.busy || hasError;
    button.textContent = saving ? "Đang lưu…" : staged.busy ? "Đang xử lý minh chứng…" : hasError ? "Xử lý tệp lỗi trước khi lưu" : "Lưu thông tin";
  };
  const close = async () => {
    if (saving || closing) return;
    closing = true;
    overlay.querySelectorAll("[data-close-work-item]").forEach(button => { button.disabled = true; });
    try { await staged.cleanup(); } catch (_) { /* best effort */ }
    overlay.remove();
  };
  overlay.querySelectorAll("[data-close-work-item]").forEach(button => button.addEventListener("click", () => { void close(); }));

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

  overlay.querySelector("#workItemEvidenceFile")?.addEventListener("change", async event => {
    setError("");
    const input = event.currentTarget;
    const files = Array.from(input.files || []);
    input.value = "";
    try { await staged.addFiles(files); }
    catch (error) { setError(friendlyErrorMessage(error, "Tệp minh chứng không hợp lệ.")); }
    refreshSaveState();
  });

  overlay.addEventListener("click", async event => {
    const removeButton = event.target.closest("[data-remove-work-item-staged]");
    if (removeButton) {
      setError("");
      removeButton.disabled = true;
      try { await staged.remove(removeButton.dataset.removeWorkItemStaged); }
      catch (error) { setError(friendlyErrorMessage(error, "Không gỡ được tệp.")); }
      refreshSaveState();
      return;
    }
    const retryButton = event.target.closest("[data-retry-work-item-staged]");
    if (retryButton) {
      setError("");
      retryButton.disabled = true;
      try { await staged.retry(retryButton.dataset.retryWorkItemStaged); }
      catch (error) { setError(friendlyErrorMessage(error, "Không tải lại được tệp.")); }
      refreshSaveState();
    }
  });

  overlay.querySelector("#saveWorkItemButton")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    try {
      setError("");
      if (staged.busy) throw new Error("Vui lòng chờ minh chứng đang xử lý hoàn tất.");
      if (staged.snapshot().some(entry => entry.status === "ERROR")) throw new Error("Có tệp lỗi. Hãy Thử lại hoặc bấm × để bỏ tệp trước khi lưu.");
      saving = true;
      refreshSaveState();

      const uploadedFiles = await staged.uploadPending();
      const lastUploaded = uploadedFiles.at(-1) || null;
      const evidence = lastUploaded || {
        evidenceUrl: currentItem?.evidenceUrl || "",
        evidenceFileName: currentItem?.evidenceFileName || "",
        evidenceStoragePath: currentItem?.evidenceStoragePath || ""
      };

      const savedWorkItem = await TaskWorkItemService.save(task, {
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
        evidenceFileName: evidence.fileName || evidence.evidenceFileName || "",
        evidenceStoragePath: evidence.storagePath || evidence.fileId || evidence.evidenceStoragePath || ""
      }, currentItem);
      currentItem = savedWorkItem;

      // Work item đã lưu và đang tham chiếu file cuối; giữ file cuối an toàn ngay cả khi batch metadata nhiều file gặp lỗi.
      if (uploadedFiles.length) staged.markCommitted([uploadedFiles.at(-1)]);

      if (uploadedFiles.length) {
        const added = await TaskEvidenceService.addUploadedFiles(task, uploadedFiles, {
          scopeType: "WORK_ITEM",
          scopeId: savedWorkItem.id,
          existingFiles: existingEvidence
        });
        existingEvidence.push(...added);
      }
      staged.markCommitted(uploadedFiles);
      overlay.remove();
      try { await onSaved?.(); } catch (refreshError) { console.warn("Đã lưu lượt công việc nhưng chưa làm mới được giao diện:", refreshError); }
    } catch (error) {
      try { await staged.rollbackUncommitted(); } catch (_) { /* rollback best effort */ }
      setError(friendlyErrorMessage(error, "Không lưu được thông tin chi tiết."));
      saving = false;
      refreshSaveState();
    }
  });
  refreshSaveState();
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
  const completed = isTerminalTask(task);
  const eventDrivenTask = String(task.deadlineMode || "").toUpperCase() === "EVENT_DRIVEN";
  const adjustmentExempt = String(task.scoringStatus || "").toUpperCase() === "ADJUSTMENT_EXEMPT";
  const mayAssign = canAssign(task);
  const mayAcceptDepartment = canAcceptDepartment(task);
  const users = mayAssign ? await UserReadService.listActive({ force: true }) : [];
  const taskDepartmentId = String(task.primaryDepartmentId || "").trim().toUpperCase();
  const departmentUsers = users.filter(user =>
    user.active === true
    && String(user.departmentId || "").trim().toUpperCase() === taskDepartmentId
  );
  const teams = departmentTeams(departmentUsers);
  let workItems = [];
  if (isItemizedTask(task)) {
    try {
      workItems = await TaskWorkItemService.list(task);
    } catch (error) {
      console.warn("Không tải được dữ liệu lượt công việc:", error);
    }
  }
  let evidenceFiles = [];
  try {
    evidenceFiles = await TaskEvidenceService.list(task);
  } catch (error) {
    console.warn("Không tải được danh sách minh chứng:", error);
  }
  let taskLogs = [];
  try {
    taskLogs = await TaskLogService.list(task.id);
  } catch (error) {
    console.warn("Không tải được nhật ký nhiệm vụ:", error);
  }
  const workItemsLocked = task.scoreLocked === true ||
    ["CONFIRMED", "NO_OCCURRENCE_CONFIRMED", "ADJUSTMENT_EXEMPT"].includes(String(task.scoringStatus || "").toUpperCase());
  const canEditWorkItems = isItemizedTask(task) && TaskWorkItemService.mayManage(task) && !workItemsLocked;
  const labels = WORK_ITEM_LABELS[workItemType(task)];

  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop";
  overlay.innerHTML = `
    <section class="modal-panel modal-large task-detail-modal task-detail-tabbed" role="dialog" aria-modal="true">
      <div class="modal-header">
        <div>
          <span class="page-eyebrow">${escapeHtml(task.taskCode || task.id)}</span>
          <h2>${escapeHtml(task.title || "Nhiệm vụ")}</h2>
          <p>${escapeHtml(task.primaryDepartmentId || "")} • ${escapeHtml(statusName(task))}</p>
        </div>
        <button class="icon-button" type="button" data-close>✕</button>
      </div>
      <nav class="task-detail-tabs" aria-label="Các phần chi tiết nhiệm vụ">
        <button class="task-detail-tab is-active" type="button" data-task-tab="overview">1. Tổng quan</button>
        <button class="task-detail-tab" type="button" data-task-tab="progress">2. Tiến độ</button>
        <button class="task-detail-tab" type="button" data-task-tab="adjustment">3. Điều chỉnh</button>
        <button class="task-detail-tab" type="button" data-task-tab="evaluation">4. Đánh giá & KPI</button>
        <button class="task-detail-tab" type="button" data-task-tab="history">5. Minh chứng & lịch sử</button>
      </nav>
      <div class="modal-body task-detail-tab-body">
        <section class="task-detail-tab-panel is-active" data-task-panel="overview">
          <div class="detail-grid task-detail-summary task-detail-summary-compact">
            ${detail("Người thực hiện", ownerDisplayName(task))}
            ${detail("Trạng thái", statusName(task))}
            ${detail("Hạn hoàn thành", eventDrivenTask ? "Theo từng lượt phát sinh" : formatDate(task._deadline || task.deadline))}
            ${eventDrivenTask ? detail("Hoàn thành nghiệp vụ", completed ? "100%" : eventCompletionDisplay(task)) : detail("Tiến độ", taskProgressDisplay(task))}
            ${eventDrivenTask ? detail("KPI tiến độ", `${Number(task.eventProgressRate ?? 0)}%`) : ""}
            ${eventDrivenTask && task.eventResultRate !== null && task.eventResultRate !== undefined ? detail("KPI kết quả", `${Number(task.eventResultRate)}%`) : ""}
            ${task.teamId ? detail("Tổ/Nhóm", teamLabel(task.teamId)) : ""}
            ${detail("Điểm tối đa", numberVi(task.maximumConvertedScore || 0))}
          </div>
          <section class="detail-section"><h3>Nội dung thực hiện</h3><p>${escapeHtml(task.description || "Chưa có nội dung chi tiết.")}</p></section>
          ${(task.expectedOutput || task.resultRequirement || task.sixClearDirective) ? `<section class="detail-section six-clear-detail"><h3>Chỉ đạo theo tinh thần 6 rõ</h3><div class="detail-grid six-clear-grid">
            <div><span>Rõ người</span><strong>${escapeHtml(task.sixClearDirective?.person || ownerDisplayName(task))}</strong></div>
            <div><span>Rõ việc</span><strong>${escapeHtml(task.sixClearDirective?.work || task.title || "Chưa ghi")}</strong></div>
            <div><span>Rõ thời gian</span><strong>${escapeHtml(task.sixClearDirective?.time || formatDate(task._deadline || task.deadline))}</strong></div>
            <div><span>Rõ trách nhiệm</span><strong>${escapeHtml(task.sixClearDirective?.responsibility || `${departmentName(task)} chịu trách nhiệm chính`)}</strong></div>
            <div><span>Rõ sản phẩm</span><strong>${escapeHtml(task.sixClearDirective?.product || task.expectedOutput || "Chưa ghi")}</strong></div>
            <div><span>Rõ kết quả</span><strong>${escapeHtml(task.sixClearDirective?.result || task.resultRequirement || "Chưa ghi")}</strong></div>
          </div></section>` : ""}
          ${mayAssign ? `<section class="detail-section"><h3>Phân công nội bộ</h3><div class="inline-form assignment-inline-form">
            <select id="assignTeam"><option value="">— Không chọn Tổ/Nhóm —</option>${teams.map(team => `<option value="${escapeHtml(team.id)}" ${team.id === normalizeTeamId(task.teamId) ? "selected" : ""}>${escapeHtml(team.label)}</option>`).join("")}</select>
            <select id="assignOwner"><option value="">— Chưa phân công cá nhân —</option></select>
            <button id="assignTaskButton" class="secondary-button" type="button">Lưu phân công</button>
          </div></section>` : ""}
        </section>

        <section class="task-detail-tab-panel" data-task-panel="progress">
          ${isOwner && !accepted && !completed ? '<div class="info-banner">Bạn cần xác nhận đã nhận nhiệm vụ trước khi cập nhật tiến độ, kết quả hoặc minh chứng.</div>' : ""}
          ${isItemizedTask(task) ? `<section class="detail-section task-work-items-section">
            <div class="detail-section-heading"><div><h3>${String(task.deadlineMode || "").toUpperCase() === "EVENT_DRIVEN" ? "Các lượt phát sinh" : labels.name}</h3></div>${canEditWorkItems ? `<button id="addWorkItemButton" class="primary-button compact-button" type="button">+ ${String(task.deadlineMode || "").toUpperCase() === "EVENT_DRIVEN" ? "Ghi nhận phát sinh" : labels.add}</button>` : ""}</div>
            <div id="taskNoOccurrence">${noOccurrenceHtml(task, workItems, isOwner)}</div>
            <div id="taskWorkItemSummary">${workItemSummaryHtml(workItems, task)}</div>
            <div id="taskWorkItemList">${workItemRows(workItems, canEditWorkItems, task, evidenceFiles)}</div>
          </section>` : ["DAILY","WEEKLY","MONTHLY"].includes(String(task.milestoneMode || "").toUpperCase()) ? `<section class="detail-section"><h3>Tiến độ định kỳ</h3><div class="detail-grid task-evaluation-summary">${detail("Tiến độ", `${Number(task.progress || 0)}%`)}${detail("Mốc đã hoàn thành", `${Number(task.milestoneCompletedCount || 0)}/${Number(task.milestoneCount || 0)}`)}${detail("Trạng thái", statusName(task))}${detail("Mốc cuối", formatDate(task.deadline || task._deadline))}</div></section>` : `<div class="info-banner"><strong>Tiến độ nhiệm vụ</strong><span>${escapeHtml(statusName(task))} · ${Number(task.progress || 0)}%</span></div>`}
        </section>

        <section class="task-detail-tab-panel" data-task-panel="adjustment">
          <div id="taskAdjustmentPanel"></div>
        </section>

        <section class="task-detail-tab-panel" data-task-panel="evaluation">
          <div class="detail-grid task-evaluation-summary">
            ${detail("Điểm tối đa", numberVi(task.maximumConvertedScore || 0))}
            ${detail("Trạng thái chấm điểm", scoringStatusName(task.scoringStatus))}
            ${detail("Điểm tự đánh giá", numberVi(task.selfActualScore))}
            ${detail("Điểm chính thức", numberVi(task.confirmedActualScore))}
          </div>
          <section class="detail-section"><h3>Kết quả cuối cùng</h3><p>${escapeHtml(task.resultSummary || task.result || "Chưa ghi nhận kết quả.")}</p></section>
          ${adjustmentExempt ? '<div class="info-banner"><strong>Đã miễn đánh giá</strong><span>Nhiệm vụ được giữ trong lịch sử nhưng không tính 0 và không đưa vào mẫu số KPI.</span></div>' : ""}
        </section>

        <section class="task-detail-tab-panel" data-task-panel="history">
          <section class="detail-section"><h3>Minh chứng</h3>${evidenceFiles.length ? `<div class="task-evidence-file-list">${evidenceFiles.map((file,index)=>`<div class="task-evidence-file-row"><span class="task-evidence-file-index">${index+1}</span><div><strong>${escapeHtml(file.fileName || "Tệp minh chứng")}</strong><small>${file.scopeType === "WORK_ITEM" ? "Lượt phát sinh" : file.scopeType === "MILESTONE" ? "Mốc định kỳ" : "Nhiệm vụ"}</small></div><a class="secondary-button compact-button" target="_blank" rel="noopener" href="${escapeHtml(safeExternalUrl(file.fileUrl) || "#")}">Mở</a></div>`).join("")}</div>` : (safeExternalUrl(task.evidenceUrl) ? `<a class="primary-link" target="_blank" rel="noopener" href="${escapeHtml(safeExternalUrl(task.evidenceUrl))}">📎 ${escapeHtml(task.evidenceFileName || "Mở tệp minh chứng")}</a>` : '<p>Chưa có tệp minh chứng.</p>')}${task.evidenceText ? `<p>${escapeHtml(task.evidenceText)}</p>` : ""}</section>
          <section class="detail-section"><h3>Lịch sử thao tác</h3>${renderTaskLogs(taskLogs)}</section>
        </section>
      </div>
      <div class="modal-footer"><button class="secondary-button" type="button" data-close>Đóng</button>${mayAcceptDepartment ? '<button id="acceptDepartmentButton" class="primary-button" type="button">Xác nhận Phòng/Khu đã nhận</button>' : ""}${isOwner && !accepted && !completed ? '<button id="acceptTaskButton" class="primary-button" type="button">Xác nhận cá nhân đã nhận</button>' : ""}${isOwner && accepted && !completed && String(task.noOccurrenceStatus || "").toUpperCase() !== "CONFIRMED" && String(task.scoringStatus || "").toUpperCase() !== "ADJUSTMENT_EXEMPT" ? '<button id="updateTaskButton" class="primary-button" type="button">Cập nhật nhiệm vụ</button>' : ""}</div>
    </section>`;

  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", close));
  const activateTab = tabName => {
    overlay.querySelectorAll("[data-task-tab]").forEach(button => {
      const active = button.dataset.taskTab === tabName;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    overlay.querySelectorAll("[data-task-panel]").forEach(panel => {
      panel.classList.toggle("is-active", panel.dataset.taskPanel === tabName);
    });
  };
  overlay.querySelectorAll("[data-task-tab]").forEach(button => {
    button.addEventListener("click", () => activateTab(button.dataset.taskTab));
  });

  await mountTaskAdjustmentPanel({
    task,
    container: overlay.querySelector("#taskAdjustmentPanel"),
    onTaskChanged: async () => {
      close();
      await onSaved?.();
    }
  });

  const refreshWorkItems = async () => {
    [workItems, evidenceFiles] = await Promise.all([
      TaskWorkItemService.list(task),
      TaskEvidenceService.list(task).catch(() => evidenceFiles)
    ]);
    const list = overlay.querySelector("#taskWorkItemList");
    const summary = overlay.querySelector("#taskWorkItemSummary");
    const noOccurrence = overlay.querySelector("#taskNoOccurrence");
    if (list) list.innerHTML = workItemRows(workItems, canEditWorkItems, task, evidenceFiles);
    if (summary) summary.innerHTML = workItemSummaryHtml(workItems, task);
    if (noOccurrence) noOccurrence.innerHTML = noOccurrenceHtml(task, workItems, isOwner);
    bindWorkItemActions();
  };

  const bindWorkItemActions = () => {
    overlay.querySelectorAll("[data-edit-work-item]").forEach(button => button.addEventListener("click", () => {
      const item = workItems.find(entry => entry.id === button.dataset.editWorkItem);
      if (item) openWorkItemEditor(task, item, refreshWorkItems, evidenceFiles);
    }));
    overlay.querySelectorAll("[data-remove-work-item]").forEach(button => button.addEventListener("click", async () => {
      const item = workItems.find(entry => entry.id === button.dataset.removeWorkItem);
      if (!item) return;
      if (!await ModalService.confirm(`Xóa lượt công việc “${item.title}”?`, { title: "Xóa lượt phát sinh", confirmText: "Xóa lượt", danger: true })) return;
      try {
        button.disabled = true;
        await TaskWorkItemService.remove(task, item);
        await refreshWorkItems();
      } catch (error) {
        await ModalService.alert(friendlyErrorMessage(error, "Không xóa được công việc phát sinh."), { title: "Không thể xóa lượt", danger: true });
        button.disabled = false;
      }
    }));
  };

  overlay.querySelector("#addWorkItemButton")?.addEventListener("click", () => openWorkItemEditor(task, null, refreshWorkItems, evidenceFiles));
  bindWorkItemActions();

  overlay.querySelector("#requestNoOccurrenceButton")?.addEventListener("click", async () => {
    const reason = await ModalService.prompt("Nêu lý do đầu việc không phát sinh trong kỳ:", { title: "Đề nghị không phát sinh", label: "Lý do", required: true, confirmText: "Gửi đề nghị" });
    if (reason === null) return;
    try {
      await TaskWriteService.requestNoOccurrence(task, reason);
      close();
      await onSaved?.();
    } catch (error) {
      await ModalService.alert(friendlyErrorMessage(error, "Không gửi được đề nghị."), { title: "Không gửi được đề nghị", danger: true });
    }
  });
  overlay.querySelector("#confirmNoOccurrenceButton")?.addEventListener("click", async () => {
    if (!await ModalService.confirm("Xác nhận không phát sinh và loại đầu việc này khỏi điểm A của kỳ?", { title: "Xác nhận không phát sinh", confirmText: "Xác nhận", danger: true })) return;
    try {
      await TaskWriteService.confirmNoOccurrence(task);
      close();
      await onSaved?.();
    } catch (error) {
      await ModalService.alert(friendlyErrorMessage(error, "Không xác nhận được đề nghị."), { title: "Không xác nhận được", danger: true });
    }
  });
  overlay.querySelector("#rejectNoOccurrenceButton")?.addEventListener("click", async () => {
    const reason = await ModalService.prompt("Nêu lý do không chấp thuận:", { title: "Không chấp thuận đề nghị", label: "Lý do", required: true, confirmText: "Không chấp thuận", danger: true });
    if (reason === null) return;
    try {
      await TaskWriteService.rejectNoOccurrence(task, reason);
      close();
      await onSaved?.();
    } catch (error) {
      await ModalService.alert(friendlyErrorMessage(error, "Không xử lý được đề nghị."), { title: "Không xử lý được", danger: true });
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
      await ModalService.alert(friendlyErrorMessage(error, "Không lưu được phân công."), { title: "Không lưu được phân công", danger: true });
      button.disabled = false;
      button.textContent = "Lưu phân công";
    }
  });

  overlay.querySelector("#acceptDepartmentButton")?.addEventListener("click", async () => {
    const button = overlay.querySelector("#acceptDepartmentButton");
    try {
      button.disabled = true;
      button.textContent = "Đang xác nhận...";
      await TaskWriteService.acceptDepartment(task);
      close();
      await onSaved?.();
    } catch (error) {
      await ModalService.alert(friendlyErrorMessage(error, "Không xác nhận được Phòng/Khu đã nhận nhiệm vụ."), { title: "Không xác nhận được", danger: true });
      button.disabled = false;
      button.textContent = "Xác nhận Phòng/Khu đã nhận";
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
  console.error("TASK_PERSONAL_ACCEPT_FAILED", {
    taskId: task?.id || "",
    taskCode: task?.taskCode || "",
    ownerUserId: task?.ownerUserId || "",
    currentUserId: currentUser?.uid || "",
    primaryDepartmentId: task?.primaryDepartmentId || "",
    assignmentStatus: task?.assignmentStatus || "",
    departmentAssignmentStatus: task?.departmentAssignmentStatus || "",
    status: task?.status || "",
    active: task?.active,
    completedAt: task?.completedAt || null,
    scoreLocked: task?.scoreLocked,
    scoringStatus: task?.scoringStatus || "",
    errorCode: error?.code || "",
    errorMessage: error?.message || String(error),
    error
  });

  await ModalService.alert(
    friendlyErrorMessage(error, "Không xác nhận được nhiệm vụ."),
    { title: "Không xác nhận được nhiệm vụ", danger: true }
  );

  button.disabled = false;
  button.textContent = "Xác nhận cá nhân đã nhận";
}
  });

  overlay.querySelector("#updateTaskButton")?.addEventListener("click", async () => {
    const button = overlay.querySelector("#updateTaskButton");
    try {
      if (button) {
        button.disabled = true;
        button.textContent = "Đang mở...";
      }
      // openTaskProgressModal chỉ gắn modal sau khi đã tải xong dữ liệu phụ thuộc.
      // Vì vậy giữ modal chi tiết hiện tại cho đến khi màn hình cập nhật mở thành công.
      await openTaskProgressModal(task, { onSaved });
      close();
    } catch (error) {
      console.error("TASK_PROGRESS_MODAL_OPEN_FAILED", {
        taskId: task?.id || "",
        taskCode: task?.taskCode || "",
        ownerUserId: task?.ownerUserId || "",
        currentUserId: currentUser?.uid || "",
        errorCode: error?.code || "",
        errorMessage: error?.message || String(error),
        error
      });
      await ModalService.alert(
        friendlyErrorMessage(error, "Không mở được chức năng cập nhật nhiệm vụ."),
        { title: "Không mở được cập nhật nhiệm vụ", danger: true }
      );
      if (button) {
        button.disabled = false;
        button.textContent = "Cập nhật nhiệm vụ";
      }
    }
  });
}

function eventCompletionDisplay(task) {
  const total = Math.max(0, Number(task?.eventWorkItemCount || 0));
  const completed = Math.max(0, Number(task?.eventCompletedCount || 0));
  if (!total) return "Chưa phát sinh";
  const rate = Math.round((Math.min(completed, total) / total) * 100);
  return `${completed}/${total} · ${rate}%`;
}

function taskProgressDisplay(task) {
  if (String(task?.deadlineMode || "").toUpperCase() !== "EVENT_DRIVEN") return `${Number(task?.progress || 0)}%`;
  const total = Math.max(0, Number(task?.eventWorkItemCount || 0));
  const eligible = Math.max(0, Number(task?.eventEligibleCount || 0));
  if (!total) return "Chưa phát sinh";
  if (!eligible) return `${total} lượt · chưa đến hạn`;
  return `${Number(task?.eventProgressRate ?? 0)}%`;
}

function detail(label, value) {
  return `<div class="detail-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function statusName(task) {
  if (String(task.scoringStatus || "").toUpperCase() === "ADJUSTMENT_EXEMPT") return "Miễn đánh giá";
  if (String(task.noOccurrenceStatus || "").toUpperCase() === "CONFIRMED") return "Không phát sinh";
  if (task._overdue) return "Trễ hạn";
  const eventDriven = String(task.deadlineMode || "").toUpperCase() === "EVENT_DRIVEN";
  if (eventDriven && task._completed) return "Đã kết thúc theo dõi";
  if (task._completed) return "Hoàn thành";
  if (eventDriven && String(task.status || "").toUpperCase() === "TAM_DUNG") return "Tạm dừng";
  if (eventDriven) return "Theo dõi phát sinh";
  const map = {
    CHO_PHONG_KHU_TIEP_NHAN: "Chờ Phòng/Khu tiếp nhận",
    CHO_PHAN_CONG: "Phòng/Khu đã nhận — Chờ phân công",
    DA_PHAN_CONG: "Chờ cá nhân tiếp nhận",
    MOI_TIEP_NHAN: "Chờ cá nhân tiếp nhận",
    DANG_XU_LY: "Đang xử lý",
    TAM_DUNG: "Tạm dừng",
    HUY: "Đã hủy"
  };
  return map[task.status] || "Đang xử lý";
}

function scoringStatusName(value) {
  const status = String(value || "NOT_ASSESSED").toUpperCase();
  return ({
    NOT_ASSESSED: "Chưa tự đánh giá",
    PENDING_REVIEW: "Chờ xác nhận",
    CONFIRMED: "Đã xác nhận chính thức",
    ADJUSTMENT_EXEMPT: "Miễn đánh giá do điều động",
    NO_OCCURRENCE_CONFIRMED: "Không phát sinh đã xác nhận",
    CANCELLED: "Đã hủy"
  })[status] || status;
}

function logActionName(action) {
  return ({
    TASK_CREATED: "Tạo nhiệm vụ",
    TASK_REGISTRATION_APPROVED: "Duyệt đăng ký",
    TASK_ACCEPTED: "Tiếp nhận nhiệm vụ (dữ liệu cũ)",
    TASK_DEPARTMENT_ASSIGNED: "Ban Giám đốc giao Phòng/Khu",
    TASK_TEAM_DIRECT_ASSIGNED: "Ban Giám đốc giao trực tiếp qua Tổ/Nhóm",
    TASK_DEPARTMENT_ACCEPTED: "Phòng/Khu xác nhận đã nhận",
    TASK_SELF_ASSIGNED: "Lãnh đạo tự phân công",
    TASK_INTERNAL_ASSIGNED: "Phân công nội bộ",
    TASK_INTERNAL_UNASSIGNED: "Chuyển về chờ phân công",
    TASK_PERSONAL_ACCEPTED: "Cá nhân xác nhận đã nhận",
    TASK_UPDATED: "Cập nhật nhiệm vụ",
    TASK_COMPLETED: "Hoàn thành nhiệm vụ",
    TASK_MILESTONE_COMPLETED: "Hoàn thành mốc công việc",
    TASK_ADJUSTMENT_REQUESTED: "Gửi đề nghị điều chỉnh",
    TASK_ADJUSTMENT_APPROVED: "Duyệt điều chỉnh",
    TASK_ADJUSTMENT_REJECTED: "Không chấp thuận điều chỉnh",
    TASK_REGISTRATION_CANCELLED: "Hủy đăng ký đã duyệt",
    CDTN_ATTENDANCE_UPDATED: "Cập nhật điểm danh Chi đoàn"
  })[String(action || "").toUpperCase()] || String(action || "Thao tác");
}

function renderTaskLogs(logs = []) {
  if (!logs.length) return '<div class="task-history-empty">Chưa có nhật ký hoặc tài khoản hiện tại không có quyền xem nhật ký cũ.</div>';
  return `<div class="task-history-list">${logs.map(log => `<article class="task-history-item">
    <div><strong>${escapeHtml(logActionName(log.action))}</strong><span>${escapeHtml(log.performedByName || "Hệ thống")}</span></div>
    <time>${escapeHtml(formatDateTime(log.createdAt))}</time>
    ${log.note ? `<p>${escapeHtml(log.note)}</p>` : ""}
  </article>`).join("")}</div>`;
}

function formatDateTime(value) {
  const date = value?.toDate ? value.toDate() : value instanceof Date ? value : value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime())
    ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(date)
    : "—";
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
