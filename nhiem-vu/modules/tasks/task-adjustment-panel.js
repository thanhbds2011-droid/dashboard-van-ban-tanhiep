/**
 * Quy trình điều chỉnh/miễn đánh giá nhiệm vụ.
 * STAFF gửi đề nghị; người giao nhiệm vụ xem xét và phê duyệt hoặc trả lại.
 */
import { ToastService } from "../../core/toast-service.js?v=20260917.V1_24_8";
import { DriveEvidenceService } from "../../services/drive-evidence-service.js?v=20260917.V1_24_8";
import { TaskAdjustmentService } from "../../services/task-adjustment-service.js?v=20260917.V1_24_8";
import { TaskWriteService } from "../../services/task-write-service.js?v=20260917.V1_24_8";
import { TaskWorkItemService } from "../../services/task-work-item-service.js?v=20260917.V1_24_8";

const STATUS_LABELS = Object.freeze({
  PENDING: ["Chờ phê duyệt", "warning"],
  APPROVED: ["Đã phê duyệt", "success"],
  REJECTED: ["Không chấp thuận", "danger"]
});

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.href : "";
  } catch (_) {
    return "";
  }
}

function formatDateTime(value) {
  const date = value?.toDate ? value.toDate() : value instanceof Date ? value : value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime())
    ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(date)
    : "—";
}

function formatDateKey(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "Không thay đổi";
}

function taskCompleted(task) {
  return Boolean(
    task?.completedAt ||
    ["HOAN_THANH", "COMPLETED", "DA_HOAN_THANH"].includes(String(task?.status || "").trim().toUpperCase())
  );
}

function noOccurrenceEligible(task) {
  const scoringStatus = String(task?.scoringStatus || "").trim().toUpperCase();
  const noOccurrenceStatus = String(task?.noOccurrenceStatus || "").trim().toUpperCase();
  return Boolean(
    task?.active !== false
    && String(task?.ownerUserId || "").trim() !== ""
    && String(task?.deadlineMode || "").toUpperCase() === "EVENT_DRIVEN"
    && String(task?.trackingMode || "").toUpperCase() === "ITEMIZED"
    && Number(task?.eventWorkItemCount || 0) === 0
    && task?.scoreLocked !== true
    && !["CONFIRMED", "ADJUSTMENT_EXEMPT", "NO_OCCURRENCE_CONFIRMED"].includes(scoringStatus)
    && !["REQUESTED", "CONFIRMED"].includes(noOccurrenceStatus)
    && String(task?.adjustmentStatus || "").toUpperCase() !== "REQUESTED"
    && !String(task?.pendingAdjustmentId || "").trim()
  );
}

function noOccurrenceCard(task) {
  const status = String(task?.noOccurrenceStatus || "").toUpperCase();
  if (status === "CONFIRMED") {
    return `<article class="adjustment-card approved"><div class="adjustment-card-header"><div><strong>Không tính KPI — Không phát sinh trong kỳ</strong><small>Quyết định đã được xác nhận</small></div>${statusPill("APPROVED")}</div><p><strong>Lý do:</strong> ${escapeHtml(task.noOccurrenceReason || "Không ghi")}</p><p class="adjustment-review-note is-approved"><strong>Người phê duyệt:</strong> ${escapeHtml(task.noOccurrenceConfirmedByName || "—")} • ${formatDateTime(task.noOccurrenceConfirmedAt)}</p></article>`;
  }
  if (status === "REQUESTED") {
    const mayReview = TaskWriteService.canReviewNoOccurrence(task);
    return `<article class="adjustment-card pending"><div class="adjustment-card-header"><div><strong>Không tính KPI — Không phát sinh trong kỳ</strong><small>Người thực hiện đã gửi đề nghị</small></div>${statusPill("PENDING")}</div><p><strong>Lý do:</strong> ${escapeHtml(task.noOccurrenceReason || "Không ghi")}</p>${mayReview ? `<div class="adjustment-card-actions"><button id="approveNoOccurrenceAdjustment" class="primary-button compact-button" type="button">Phê duyệt</button><button id="rejectNoOccurrenceAdjustment" class="secondary-button compact-button" type="button">Không chấp thuận</button></div>` : ""}</article>`;
  }
  if (status === "REJECTED") {
    return `<article class="adjustment-card rejected"><div class="adjustment-card-header"><div><strong>Không tính KPI — Không phát sinh trong kỳ</strong><small>Đề nghị trước đã được xử lý</small></div>${statusPill("REJECTED")}</div><p><strong>Lý do đề nghị:</strong> ${escapeHtml(task.noOccurrenceReason || "Không ghi")}</p><p class="adjustment-review-note is-rejected"><strong>Lý do không chấp thuận:</strong> ${escapeHtml(task.noOccurrenceRejectionReason || "Không ghi")}</p></article>`;
  }
  return "";
}

function statusPill(status) {
  const normalized = String(status || "PENDING").toUpperCase();
  const [label, className] = STATUS_LABELS[normalized] || [normalized, "neutral"];
  return `<span class="status-pill ${className}">${escapeHtml(label)}</span>`;
}

function proposalSummary(adjustment) {
  if (adjustment.adjustmentType === TaskAdjustmentService.TYPES.EXEMPT_FROM_SCORING) {
    return `<div class="adjustment-effect-list">
      <span>• Không chấm 0 điểm</span>
      <span>• Loại khỏi điểm kế hoạch A và mẫu số KPI</span>
      <span>• Giữ nguyên nhiệm vụ, lý do và toàn bộ lịch sử</span>
    </div>`;
  }
  const proposed = adjustment.proposedSnapshot || {};
  return `<div class="adjustment-proposal-grid">
    <div><span>Khối lượng/phạm vi đề xuất</span><strong>${escapeHtml(proposed.adjustedWorkload || "Không ghi")}</strong></div>
    <div><span>Hạn đề xuất</span><strong>${escapeHtml(formatDateKey(proposed.deadlineDateKey))}</strong></div>
    ${proposed.description ? `<div class="field-full"><span>Nội dung sau điều chỉnh</span><strong>${escapeHtml(proposed.description)}</strong></div>` : ""}
  </div>`;
}

function evidenceLink(adjustment) {
  const url = safeUrl(adjustment.evidenceUrl);
  if (!url) return adjustment.evidenceText
    ? `<p class="adjustment-evidence-text"><strong>Minh chứng:</strong> ${escapeHtml(adjustment.evidenceText)}</p>`
    : "";
  return `<div class="adjustment-evidence-box">
    ${adjustment.evidenceText ? `<span>${escapeHtml(adjustment.evidenceText)}</span>` : ""}
    <a class="primary-link" target="_blank" rel="noopener" href="${escapeHtml(url)}">📎 ${escapeHtml(adjustment.evidenceFileName || "Mở minh chứng điều động")}</a>
  </div>`;
}

function adjustmentCard(task, adjustment) {
  const canApprove = TaskAdjustmentService.canApprove(task, adjustment);
  const status = String(adjustment.status || "PENDING").toUpperCase();
  const reviewerNote = status === "REJECTED"
    ? `<p class="adjustment-review-note is-rejected"><strong>Lý do không chấp thuận:</strong> ${escapeHtml(adjustment.rejectionReason || "Không ghi")}</p>`
    : status === "APPROVED"
      ? `<p class="adjustment-review-note is-approved"><strong>Người phê duyệt:</strong> ${escapeHtml(adjustment.approvedByName || "—")} • ${formatDateTime(adjustment.approvedAt)}</p>`
      : "";
  return `<article class="adjustment-card ${status.toLowerCase()}">
    <div class="adjustment-card-header">
      <div>
        <strong>${escapeHtml(TaskAdjustmentService.label(adjustment.adjustmentType))}</strong>
        <small>Người đề nghị: ${escapeHtml(adjustment.userName || adjustment.createdByName || "—")} • ${formatDateTime(adjustment.createdAt)}</small>
      </div>
      ${statusPill(status)}
    </div>
    <p><strong>Lý do:</strong> ${escapeHtml(adjustment.reason || "Không ghi")}</p>
    ${proposalSummary(adjustment)}
    ${evidenceLink(adjustment)}
    ${reviewerNote}
    ${canApprove ? `<div class="adjustment-card-actions">
      <button class="primary-button compact-button" type="button" data-approve-adjustment="${escapeHtml(adjustment.id)}">Phê duyệt</button>
      <button class="secondary-button compact-button" type="button" data-reject-adjustment="${escapeHtml(adjustment.id)}">Không chấp thuận</button>
    </div>` : ""}
  </article>`;
}

function panelHtml(task, adjustments) {
  const pending = adjustments.find(item => String(item.status || "").toUpperCase() === "PENDING");
  const exempted = String(task.scoringStatus || "").toUpperCase() === "ADJUSTMENT_EXEMPT";
  const noOccurrenceConfirmed = String(task.noOccurrenceStatus || "").toUpperCase() === "CONFIRMED";
  const canRequest = TaskAdjustmentService.canRequest(task);
  const noOccurrence = noOccurrenceCard(task);
  return `<section class="detail-section task-adjustment-section">
    <div class="detail-section-heading">
      <div>
        <h3>Điều chỉnh nhiệm vụ / Không tính KPI</h3>
        <p>Mọi đề nghị thay đổi phạm vi hoặc loại nhiệm vụ khỏi tính KPI được gửi và theo dõi tập trung tại đây.</p>
      </div>
      ${canRequest ? '<button id="requestTaskAdjustmentButton" class="secondary-button compact-button" type="button">＋ Gửi đề nghị</button>' : ""}
    </div>
    ${exempted ? `<div class="info-banner adjustment-exempt-banner"><strong>Không tính KPI</strong><span>Lý do: Điều động/chuyển công tác/lý do khách quan. Nhiệm vụ được giữ trong lịch sử và không bị tính 0 điểm.</span></div>` : ""}
    ${noOccurrenceConfirmed ? `<div class="info-banner adjustment-exempt-banner"><strong>Không tính KPI</strong><span>Lý do: Không phát sinh trong kỳ. Nhiệm vụ được giữ trong lịch sử và không bị tính 0 điểm.</span></div>` : ""}
    ${pending ? `<div class="info-banner adjustment-pending-banner"><strong>Đang chờ phê duyệt</strong><span>${escapeHtml(pending.adjustmentLabel || TaskAdjustmentService.label(pending.adjustmentType))}: ${escapeHtml(pending.reason || "")}</span></div>` : ""}
    <div class="adjustment-history">
      ${noOccurrence}
      ${adjustments.length ? adjustments.map(item => adjustmentCard(task, item)).join("") : (!noOccurrence ? `<div class="task-work-item-empty"><strong>Chưa có đề nghị điều chỉnh</strong><span>Khi cần thay đổi nhiệm vụ hoặc đề nghị không tính KPI, người thực hiện gửi đề nghị tại đây.</span></div>` : "")}
    </div>
  </section>`;
}

function toggleScopeFields(overlay) {
  const type = overlay.querySelector("#adjustmentType")?.value;
  const nonScoringReason = overlay.querySelector("#nonScoringReason")?.value || "NO_OCCURRENCE";
  overlay.querySelectorAll("[data-scope-field]").forEach(element => { element.hidden = type !== "ADJUST_SCOPE"; });
  overlay.querySelectorAll("[data-non-scoring-field]").forEach(element => { element.hidden = type !== "NON_SCORING"; });
  overlay.querySelectorAll("[data-evidence-field]").forEach(element => {
    element.hidden = type === "NON_SCORING" && nonScoringReason === "NO_OCCURRENCE";
  });
  const note = overlay.querySelector("#adjustmentTypeNote");
  if (!note) return;
  if (type === "ADJUST_SCOPE") {
    note.innerHTML = "<strong>Điều chỉnh phạm vi:</strong> dùng khi vẫn tiếp tục nhiệm vụ nhưng cần thay đổi khối lượng, nội dung hoặc thời hạn.";
  } else if (nonScoringReason === "NO_OCCURRENCE") {
    note.innerHTML = "<strong>Không phát sinh trong kỳ:</strong> chỉ áp dụng cho đầu việc Khi phát sinh theo từng lượt và chưa có bất kỳ lượt công việc thực tế nào.";
  } else {
    note.innerHTML = "<strong>Điều động/lý do khách quan:</strong> áp dụng khi nhiệm vụ không còn thuộc trách nhiệm thực tế của người thực hiện; có thể kèm minh chứng.";
  }
}

function openRequestModal(task, onSubmitted) {
  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop nested-modal-backdrop";
  overlay.innerHTML = `<section class="modal-panel modal-medium adjustment-modal" role="dialog" aria-modal="true" aria-labelledby="adjustmentModalTitle">
    <div class="modal-header">
      <div><span class="page-eyebrow">${escapeHtml(task.taskCode || task.id)}</span><h2 id="adjustmentModalTitle">Gửi đề nghị</h2><p>Đề nghị chỉ có hiệu lực sau khi cấp có thẩm quyền phê duyệt.</p></div>
      <button class="icon-button" type="button" data-close-adjustment>✕</button>
    </div>
    <div class="modal-body task-form-grid">
      <label class="field-full"><span>Loại đề nghị *</span><select id="adjustmentType">
        <option value="ADJUST_SCOPE" ${taskCompleted(task) ? "disabled" : ""}>Điều chỉnh khối lượng/phạm vi</option>
        <option value="NON_SCORING" ${taskCompleted(task) ? "selected" : ""}>Đề nghị không tính KPI</option>
      </select></label>
      <label class="field-full" data-non-scoring-field><span>Lý do không tính KPI *</span><select id="nonScoringReason">
        <option value="NO_OCCURRENCE" ${noOccurrenceEligible(task) && !taskCompleted(task) ? "" : "disabled"}>Không phát sinh trong kỳ</option>
        <option value="OBJECTIVE_EXEMPT" ${!noOccurrenceEligible(task) || taskCompleted(task) ? "selected" : ""}>Điều động/chuyển công tác/lý do khách quan</option>
      </select></label>
      ${taskCompleted(task) ? `<div class="field-full warning-banner"><strong>Nhiệm vụ đã được đánh dấu hoàn thành.</strong><br>Chỉ có thể đề nghị không tính KPI do điều động/lý do khách quan nếu điểm chưa được xác nhận hoặc khóa.</div>` : ""}
      <div id="adjustmentTypeNote" class="field-full info-banner compact-info-banner"></div>
      <label class="field-full"><span>Lý do *</span><textarea id="adjustmentReason" rows="4" maxlength="3000" placeholder="Nêu rõ căn cứ và lý do đề nghị."></textarea></label>
      <label class="field-full" data-scope-field><span>Khối lượng/phạm vi đề xuất</span><textarea id="adjustedWorkload" rows="3" maxlength="1000" placeholder="Nêu phần công việc giữ lại, giảm bớt hoặc thay đổi"></textarea></label>
      <label class="field-full" data-scope-field><span>Nội dung nhiệm vụ sau điều chỉnh</span><textarea id="adjustedDescription" rows="4" maxlength="5000">${escapeHtml(task.description || "")}</textarea></label>
      <label data-scope-field><span>Hạn hoàn thành đề xuất</span><input id="adjustedDeadline" type="date" value="${escapeHtml(task.deadlineDateKey || "")}"></label>
      <label class="field-full" data-evidence-field><span>Mô tả minh chứng</span><textarea id="adjustmentEvidenceText" rows="2" maxlength="3000" placeholder="Số, ngày lệnh điều động; tên bệnh viện; thời gian thực hiện…"></textarea></label>
      <label class="field-full" data-evidence-field><span>Tệp minh chứng trên Google Drive</span><input id="adjustmentEvidenceFile" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"><small>Không bắt buộc nếu đơn vị chưa yêu cầu; tối đa 8 MB.</small></label>
      <div id="adjustmentUploadStatus" data-evidence-field class="field-full task-work-item-upload-status" aria-live="polite"></div>
    </div>
    <div class="modal-footer"><button class="secondary-button" type="button" data-close-adjustment>Hủy</button><button id="submitTaskAdjustment" class="primary-button" type="button">Gửi đề nghị</button></div>
  </section>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelectorAll("[data-close-adjustment]").forEach(button => button.addEventListener("click", close));
  overlay.querySelector("#adjustmentType")?.addEventListener("change", () => toggleScopeFields(overlay));
  overlay.querySelector("#nonScoringReason")?.addEventListener("change", () => toggleScopeFields(overlay));
  toggleScopeFields(overlay);

  overlay.querySelector("#submitTaskAdjustment")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    try {
      const requestType = overlay.querySelector("#adjustmentType")?.value || "ADJUST_SCOPE";
      const nonScoringReason = overlay.querySelector("#nonScoringReason")?.value || "NO_OCCURRENCE";
      const reason = overlay.querySelector("#adjustmentReason")?.value || "";
      if (!reason.trim()) throw new Error("Hãy nhập lý do đề nghị.");

      if (requestType === "NON_SCORING" && nonScoringReason === "NO_OCCURRENCE") {
        if (!noOccurrenceEligible(task)) throw new Error("Nhiệm vụ không đủ điều kiện đề nghị Không phát sinh trong kỳ.");
        const items = await TaskWorkItemService.list(task);
        if (items.length) throw new Error("Không thể đề nghị Không phát sinh vì nhiệm vụ đã có công việc thực tế trong kỳ.");
        button.disabled = true;
        button.textContent = "Đang gửi…";
        await TaskWriteService.requestNoOccurrence(task, reason);
        ToastService.success("Đã gửi đề nghị Không phát sinh để xác nhận không tính KPI.");
        close();
        await onSubmitted?.();
        return;
      }

      const adjustmentType = requestType === "NON_SCORING"
        ? TaskAdjustmentService.TYPES.EXEMPT_FROM_SCORING
        : TaskAdjustmentService.TYPES.ADJUST_SCOPE;
      if (!TaskAdjustmentService.canRequest(task, adjustmentType)) {
        throw new Error(taskCompleted(task) && adjustmentType !== TaskAdjustmentService.TYPES.EXEMPT_FROM_SCORING
          ? "Nhiệm vụ đã hoàn thành; hãy chọn Đề nghị không tính KPI."
          : "Nhiệm vụ không còn đủ điều kiện gửi đề nghị hoặc đã có đề nghị đang chờ xử lý.");
      }
      button.disabled = true;
      button.textContent = "Đang gửi…";
      const selectedFile = overlay.querySelector("#adjustmentEvidenceFile")?.files?.[0] || null;
      let evidence = {};
      if (selectedFile) {
        evidence = await DriveEvidenceService.upload(selectedFile, task, {
          onProgress: progress => {
            const status = overlay.querySelector("#adjustmentUploadStatus");
            if (status) {
              const message = typeof progress === "string" ? progress : progress?.message;
              const percent = Number(progress?.percent);
              status.textContent = Number.isFinite(percent) && message
                ? `${message} (${Math.max(0, Math.min(100, Math.round(percent)))}%)`
                : (message || "Đang tải minh chứng…");
            }
          }
        });
      }
      await TaskAdjustmentService.request(task, {
        adjustmentType,
        reason,
        adjustedWorkload: overlay.querySelector("#adjustedWorkload")?.value || "",
        description: overlay.querySelector("#adjustedDescription")?.value || task.description || "",
        deadlineDateKey: overlay.querySelector("#adjustedDeadline")?.value || "",
        evidenceText: overlay.querySelector("#adjustmentEvidenceText")?.value || "",
        evidenceUrl: evidence.fileUrl || evidence.evidenceUrl || "",
        evidenceFileName: evidence.fileName || selectedFile?.name || "",
        evidenceStoragePath: evidence.storagePath || evidence.fileId || ""
      });
      ToastService.success("Đã gửi đề nghị đến cấp có thẩm quyền.");
      close();
      await onSubmitted?.();
    } catch (error) {
      ToastService.error(error?.message || "Không gửi được đề nghị điều chỉnh.");
      button.disabled = false;
      button.textContent = "Gửi đề nghị";
    }
  });
}

function openApprovalModal(task, adjustment, onCompleted) {
  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop nested-modal-backdrop";
  overlay.innerHTML = `<section class="modal-panel modal-medium adjustment-modal" role="dialog" aria-modal="true">
    <div class="modal-header"><div><span class="page-eyebrow">PHÊ DUYỆT ĐỀ NGHỊ</span><h2>${escapeHtml(TaskAdjustmentService.label(adjustment.adjustmentType))}</h2><p>${escapeHtml(task.title || task.taskCode || "Nhiệm vụ")}</p></div><button class="icon-button" type="button" data-close-approval>✕</button></div>
    <div class="modal-body">
      <div class="adjustment-approval-summary">
        <p><strong>Người đề nghị:</strong> ${escapeHtml(adjustment.userName || "—")}</p>
        <p><strong>Lý do:</strong> ${escapeHtml(adjustment.reason || "—")}</p>
        ${proposalSummary(adjustment)}
        ${evidenceLink(adjustment)}
      </div>
      <div class="info-banner ${adjustment.adjustmentType === "EXEMPT_FROM_SCORING" ? "adjustment-exempt-banner" : ""}">
        <strong>${adjustment.adjustmentType === "EXEMPT_FROM_SCORING" ? "Hệ quả sau khi phê duyệt" : "Xác nhận thay đổi"}</strong>
        <span>${adjustment.adjustmentType === "EXEMPT_FROM_SCORING" ? "Nhiệm vụ sẽ không bị tính 0 điểm, bị loại khỏi A và mẫu số KPI nhưng vẫn giữ nguyên lịch sử." : "Nội dung, khối lượng hoặc thời hạn mới sẽ được áp dụng; đăng ký gốc vẫn được giữ trong lịch sử."}</span>
      </div>
    </div>
    <div class="modal-footer"><button class="secondary-button" type="button" data-close-approval>Hủy</button><button id="confirmAdjustmentApproval" class="primary-button" type="button">Xác nhận phê duyệt</button></div>
  </section>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelectorAll("[data-close-approval]").forEach(button => button.addEventListener("click", close));
  overlay.querySelector("#confirmAdjustmentApproval")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    try {
      button.disabled = true;
      button.textContent = "Đang phê duyệt…";
      await TaskAdjustmentService.approve(task, adjustment);
      ToastService.success("Đã phê duyệt đề nghị điều chỉnh.");
      close();
      await onCompleted?.();
    } catch (error) {
      ToastService.error(error?.message || "Không phê duyệt được đề nghị.");
      button.disabled = false;
      button.textContent = "Xác nhận phê duyệt";
    }
  });
}

function openRejectionModal(task, adjustment, onCompleted) {
  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop nested-modal-backdrop";
  overlay.innerHTML = `<section class="modal-panel modal-medium adjustment-modal" role="dialog" aria-modal="true">
    <div class="modal-header"><div><span class="page-eyebrow">KHÔNG CHẤP THUẬN</span><h2>Trả lại đề nghị điều chỉnh</h2><p>${escapeHtml(task.title || task.taskCode || "Nhiệm vụ")}</p></div><button class="icon-button" type="button" data-close-rejection>✕</button></div>
    <div class="modal-body task-form-grid"><label class="field-full"><span>Lý do không chấp thuận *</span><textarea id="adjustmentRejectionReason" rows="4" maxlength="2000" placeholder="Nêu rõ nội dung cần bổ sung hoặc lý do không chấp thuận"></textarea></label></div>
    <div class="modal-footer"><button class="secondary-button" type="button" data-close-rejection>Hủy</button><button id="confirmAdjustmentRejection" class="danger-button" type="button">Không chấp thuận</button></div>
  </section>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelectorAll("[data-close-rejection]").forEach(button => button.addEventListener("click", close));
  overlay.querySelector("#confirmAdjustmentRejection")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    try {
      const reason = overlay.querySelector("#adjustmentRejectionReason")?.value || "";
      if (!reason.trim()) throw new Error("Hãy nhập lý do không chấp thuận.");
      button.disabled = true;
      button.textContent = "Đang xử lý…";
      await TaskAdjustmentService.reject(task, adjustment, reason);
      ToastService.success("Đã trả lại đề nghị cho người thực hiện.");
      close();
      await onCompleted?.();
    } catch (error) {
      ToastService.error(error?.message || "Không xử lý được đề nghị.");
      button.disabled = false;
      button.textContent = "Không chấp thuận";
    }
  });
}


function openNoOccurrenceRejectionModal(task, onCompleted) {
  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop nested-modal-backdrop";
  overlay.innerHTML = `<section class="modal-panel modal-medium adjustment-modal" role="dialog" aria-modal="true">
    <div class="modal-header"><div><span class="page-eyebrow">KHÔNG CHẤP THUẬN</span><h2>Đề nghị Không phát sinh</h2><p>${escapeHtml(task.title || task.taskCode || "Nhiệm vụ")}</p></div><button class="icon-button" type="button" data-close-no-occurrence-rejection>✕</button></div>
    <div class="modal-body task-form-grid"><label class="field-full"><span>Lý do không chấp thuận *</span><textarea id="noOccurrenceRejectionReason" rows="4" maxlength="2000" placeholder="Nêu rõ lý do không chấp thuận đề nghị Không phát sinh"></textarea></label></div>
    <div class="modal-footer"><button class="secondary-button" type="button" data-close-no-occurrence-rejection>Hủy</button><button id="confirmNoOccurrenceRejection" class="danger-button" type="button">Không chấp thuận</button></div>
  </section>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelectorAll("[data-close-no-occurrence-rejection]").forEach(button => button.addEventListener("click", close));
  overlay.querySelector("#confirmNoOccurrenceRejection")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    try {
      const reason = overlay.querySelector("#noOccurrenceRejectionReason")?.value || "";
      if (!reason.trim()) throw new Error("Hãy nhập lý do không chấp thuận.");
      button.disabled = true;
      button.textContent = "Đang xử lý…";
      await TaskWriteService.rejectNoOccurrence(task, reason);
      ToastService.success("Đã trả lại đề nghị Không phát sinh.");
      close();
      await onCompleted?.();
    } catch (error) {
      ToastService.error(error?.message || "Không xử lý được đề nghị Không phát sinh.");
      button.disabled = false;
      button.textContent = "Không chấp thuận";
    }
  });
}

export async function mountTaskAdjustmentPanel({ task, container, onTaskChanged }) {
  if (!container || !task?.id) return;
  container.innerHTML = `<section class="detail-section"><div class="empty-state compact-empty-state"><div class="empty-icon">⏳</div><strong>Đang tải đề nghị điều chỉnh…</strong></div></section>`;
  try {
    const adjustments = await TaskAdjustmentService.list(task);
    container.innerHTML = panelHtml(task, adjustments);
    container.querySelector("#requestTaskAdjustmentButton")?.addEventListener("click", () => {
      openRequestModal(task, onTaskChanged);
    });
    container.querySelectorAll("[data-approve-adjustment]").forEach(button => {
      button.addEventListener("click", () => {
        const adjustment = adjustments.find(item => item.id === button.dataset.approveAdjustment);
        if (adjustment) openApprovalModal(task, adjustment, onTaskChanged);
      });
    });
    container.querySelectorAll("[data-reject-adjustment]").forEach(button => {
      button.addEventListener("click", () => {
        const adjustment = adjustments.find(item => item.id === button.dataset.rejectAdjustment);
        if (adjustment) openRejectionModal(task, adjustment, onTaskChanged);
      });
    });
    container.querySelector("#approveNoOccurrenceAdjustment")?.addEventListener("click", async () => {
      try {
        await TaskWriteService.confirmNoOccurrence(task);
        ToastService.success("Đã xác nhận Không phát sinh; nhiệm vụ không tính KPI trong kỳ.");
        await onTaskChanged?.();
      } catch (error) {
        ToastService.error(error?.message || "Không xác nhận được đề nghị Không phát sinh.");
      }
    });
    container.querySelector("#rejectNoOccurrenceAdjustment")?.addEventListener("click", () => {
      openNoOccurrenceRejectionModal(task, onTaskChanged);
    });
  } catch (error) {
    console.error("Không tải được đề nghị điều chỉnh:", error);
    container.innerHTML = `<section class="detail-section"><div class="info-banner"><strong>Chưa tải được lịch sử điều chỉnh</strong><span>${escapeHtml(error?.message || "Vui lòng đóng và mở lại nhiệm vụ.")}</span></div></section>`;
  }
}
