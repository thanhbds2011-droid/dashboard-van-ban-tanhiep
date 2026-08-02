/** Chi tiết, phân công và các lượt công việc phát sinh của nhiệm vụ. */
import { UserContext } from "../../core/user-context.js";
import { Permissions } from "../../core/permissions.js?v=20260802.V1_6_0";
import { UserReadService } from "../../services/user-read-service.js";
import { TaskWriteService } from "../../services/task-write-service.js?v=20260802.V1_6_0";
import { TaskWorkItemService } from "../../services/task-work-item-service.js?v=20260802.V1_6_0";
import { DriveEvidenceService } from "../../services/drive-evidence-service.js?v=20260802.V1_6_0";
import { openTaskProgressModal } from "./task-progress-modal.js?v=20260802.V1_6_0";
import { mountTaskAdjustmentPanel } from "./task-adjustment-panel.js?v=20260802.V1_6_0";
import { TaskLogService } from "../../services/task-log-service.js?v=20260802.V1_6_0";

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
  return Permissions.isAdmin() || Permissions.isDirector() ||
    (Permissions.isDepartmentLeader() && task.primaryDepartmentId === user.departmentId);
}

function canReviewNoOccurrence(task) {
  const user = UserContext.requireUser();
  if (task.ownerUserId === user.uid) return false;
  return Permissions.isAdmin() ||
    (Permissions.isDepartmentHead() && task.primaryDepartmentId === user.departmentId) ||
    (Permissions.isDirector() && task.primaryDepartmentId === "BGD");
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
    <div><span>Tiến độ thực tế T/N</span><strong>${numberVi(summary.actualProgressRate)}%</strong></div>
    <div><span>Kết quả thực tế K/N</span><strong>${numberVi(summary.actualResultRate)}%</strong></div>
    <div class="is-applied"><span>Mức KPI áp dụng</span><strong>${summary.appliedProgressRate}% tiến độ · ${summary.appliedResultRate}% kết quả</strong></div>
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
    <p>Tỷ lệ thực tế = T/N và K/N. Hệ thống giữ nguyên tỷ lệ, ví dụ 1/2 = 50%, sau đó chấm <strong>một lần cho toàn đầu việc</strong> theo công thức Phụ lục 04. Mỗi lượt không có điểm chuẩn riêng và không được cộng điểm riêng.</p>
  </div>`;
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
  const adjustmentExempt = String(task.scoringStatus || "").toUpperCase() === "ADJUSTMENT_EXEMPT";
  const mayAssign = canAssign(task) && !adjustmentExempt;
  const users = mayAssign ? await UserReadService.listActive() : [];
  const departmentUsers = users.filter(user => user.departmentId === task.primaryDepartmentId);
  const teams = departmentTeams(departmentUsers);
  let workItems = isItemizedTask(task) ? await TaskWorkItemService.list(task.id) : [];
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
          ${mayAssign ? `<section class="detail-section"><h3>Phân công nội bộ</h3><div class="inline-form assignment-inline-form">
            <select id="assignTeam"><option value="">— Không chọn Tổ/Nhóm —</option>${teams.map(team => `<option value="${escapeHtml(team.id)}" ${team.id === normalizeTeamId(task.teamId) ? "selected" : ""}>${escapeHtml(team.label)}</option>`).join("")}</select>
            <select id="assignOwner"><option value="">— Chưa phân công cá nhân —</option></select>
            <button id="assignTaskButton" class="secondary-button" type="button">Lưu phân công</button>
          </div></section>` : ""}
        </section>

        <section class="task-detail-tab-panel" data-task-panel="progress">
          ${isOwner && !accepted && !completed ? '<div class="info-banner">Bạn cần xác nhận đã nhận nhiệm vụ trước khi cập nhật tiến độ, kết quả hoặc minh chứng.</div>' : ""}
          ${isItemizedTask(task) ? `<section class="detail-section task-work-items-section">
            <div class="detail-section-heading"><div><h3>${labels.name}</h3><p>Mỗi văn bản/lượt được ghi riêng; hệ thống lấy trung bình chính xác rồi mới áp dụng Phụ lục 04.</p></div>${canEditWorkItems ? `<button id="addWorkItemButton" class="primary-button compact-button" type="button">+ ${labels.add}</button>` : ""}</div>
            ${scoringMethodHtml(task)}
            <div id="taskNoOccurrence">${noOccurrenceHtml(task, workItems, isOwner)}</div>
            <div id="taskWorkItemSummary">${workItemSummaryHtml(workItems, task)}</div>
            <div id="taskWorkItemList">${workItemRows(workItems, canEditWorkItems, task)}</div>
          </section>` : `<div class="info-banner final-output-banner"><strong>Đánh giá trực tiếp theo Phụ lục 04</strong><span>Đầu việc có một sản phẩm cuối cùng; không tạo lượt chi tiết và không áp dụng quy đổi cứng.</span></div>`}
        </section>

        <section class="task-detail-tab-panel" data-task-panel="adjustment">
          <div id="taskAdjustmentPanel"></div>
        </section>

        <section class="task-detail-tab-panel" data-task-panel="evaluation">
          <div class="detail-grid task-evaluation-summary">
            ${detail("Điểm chuẩn", numberVi(task.baseScore || 0))}
            ${detail("Hệ số độ khó", coefficientLabel(task.difficultyCoefficient))}
            ${detail("Điểm tối đa", numberVi(task.maximumConvertedScore || 0))}
            ${detail("Trạng thái chấm điểm", scoringStatusName(task.scoringStatus))}
            ${detail("Điểm tự đánh giá", numberVi(task.selfActualScore))}
            ${detail("Điểm chính thức", numberVi(task.confirmedActualScore))}
          </div>
          <section class="detail-section"><h3>Kết quả cuối cùng</h3><p>${escapeHtml(task.resultSummary || task.result || "Chưa ghi nhận kết quả.")}</p></section>
          ${adjustmentExempt ? '<div class="info-banner"><strong>Đã miễn đánh giá</strong><span>Nhiệm vụ được giữ trong lịch sử nhưng không tính 0 và không đưa vào mẫu số KPI.</span></div>' : ""}
        </section>

        <section class="task-detail-tab-panel" data-task-panel="history">
          <section class="detail-section"><h3>Minh chứng</h3>${safeExternalUrl(task.evidenceUrl) ? `<a class="primary-link" target="_blank" rel="noopener" href="${escapeHtml(safeExternalUrl(task.evidenceUrl))}">📎 ${escapeHtml(task.evidenceFileName || "Mở tệp minh chứng")}</a>` : '<p>Chưa có tệp minh chứng cuối cùng.</p>'}${task.evidenceText ? `<p>${escapeHtml(task.evidenceText)}</p>` : ""}</section>
          <section class="detail-section"><h3>Lịch sử thao tác</h3>${renderTaskLogs(taskLogs)}</section>
        </section>
      </div>
      <div class="modal-footer"><button class="secondary-button" type="button" data-close>Đóng</button>${isOwner && !accepted && !completed ? '<button id="acceptTaskButton" class="primary-button" type="button">Xác nhận đã nhận nhiệm vụ</button>' : ""}${isOwner && accepted && !completed && String(task.noOccurrenceStatus || "").toUpperCase() !== "CONFIRMED" && String(task.scoringStatus || "").toUpperCase() !== "ADJUSTMENT_EXEMPT" ? '<button id="updateTaskButton" class="primary-button" type="button">Cập nhật nhiệm vụ</button>' : ""}</div>
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
  if (String(task.scoringStatus || "").toUpperCase() === "ADJUSTMENT_EXEMPT") return "Miễn đánh giá";
  if (String(task.noOccurrenceStatus || "").toUpperCase() === "CONFIRMED") return "Không phát sinh";
  if (task._overdue) return "Trễ hạn";
  if (task._completed) return "Hoàn thành";
  const map = { CHO_PHAN_CONG: "Chờ phân công", MOI_TIEP_NHAN: "Chờ tiếp nhận", DANG_XU_LY: "Đang xử lý", TAM_DUNG: "Tạm dừng" };
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
    TASK_ACCEPTED: "Tiếp nhận nhiệm vụ",
    TASK_UPDATED: "Cập nhật nhiệm vụ",
    TASK_COMPLETED: "Hoàn thành nhiệm vụ",
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
