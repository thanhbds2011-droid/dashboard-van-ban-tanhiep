/**
 * Cập nhật nhiệm vụ V1.16.0.
 * - Trạng thái + minh chứng nội dung/liên kết + nhiều tệp Drive.
 * - Tệp được tải lên Drive ngay khi chọn (staged upload), không chờ nút Lưu.
 * - Có thể gỡ tệp staged bằng dấu ×; tệp được đưa vào Thùng rác Drive.
 * - Mốc định kỳ hỗ trợ Theo ngày / Theo tuần / Theo tháng.
 */
import { UserContext } from "../../core/user-context.js?v=20260825.V1_16_1";
import { friendlyErrorMessage } from "../../core/friendly-error.js?v=20260825.V1_16_1";
import { TaskWriteService } from "../../services/task-write-service.js?v=20260825.V1_16_1";
import { TaskMilestoneService } from "../../services/task-milestone-service.js?v=20260825.V1_16_1";
import { DriveEvidenceService } from "../../services/drive-evidence-service.js?v=20260825.V1_16_1";
import { TaskWorkItemService } from "../../services/task-work-item-service.js?v=20260825.V1_16_1";
import { TaskEvidenceService } from "../../services/task-evidence-service.js?v=20260825.V1_16_1";
import { StagedEvidenceUploader } from "../../services/staged-evidence-uploader.js?v=20260825.V1_16_1";
import { validateProgressInput, cleanText } from "./task-form-validator.js?v=20260825.V1_16_1";

function mayUpdate(task) {
  const user = UserContext.requireUser();
  return Boolean(
    task &&
    task.ownerUserId === user.uid &&
    task.active !== false &&
    task.assignmentStatus === "DA_TIEP_NHAN" &&
    String(task.status || "").toUpperCase() !== "HOAN_THANH"
  );
}

function statusOption(value, label, current) {
  return `<option value="${value}" ${String(current || "").toUpperCase() === value ? "selected" : ""}>${label}</option>`;
}

function formatDateKey(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value || "—");
}

function timestampDateKey(value) {
  if (!value) return "";
  const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  if (Number.isNaN(date?.getTime?.())) return "";
  return new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function scopeLabel(item) {
  if (item?.scopeType === "MILESTONE") return "Minh chứng mốc";
  if (item?.scopeType === "WORK_ITEM") return "Minh chứng lượt phát sinh";
  return "Minh chứng nhiệm vụ";
}

function evidenceListHtml(files = [], task = {}) {
  const rows = (files || []).map((item, index) => `<div class="task-evidence-file-row" data-evidence-id="${escapeHtml(item.id || "")}">
    <span class="task-evidence-file-index">${index + 1}</span>
    <div><strong>${escapeHtml(item.fileName || "Tệp minh chứng")}</strong><small>${escapeHtml(scopeLabel(item))}</small></div>
    <div class="task-evidence-row-actions"><a class="secondary-button compact-button" href="${escapeHtml(item.fileUrl || "#")}" target="_blank" rel="noopener">Mở</a><button class="evidence-remove-button" type="button" data-remove-evidence-id="${escapeHtml(item.id || "")}" title="Gỡ minh chứng" aria-label="Gỡ ${escapeHtml(item.fileName || "tệp minh chứng")}">×</button></div>
  </div>`).join("");
  const legacyExists = task?.evidenceUrl && !(files || []).some(item => item.fileUrl === task.evidenceUrl);
  const legacy = legacyExists ? `<div class="task-evidence-file-row is-legacy"><span class="task-evidence-file-index">•</span><div><strong>${escapeHtml(task.evidenceFileName || "Minh chứng trước đây")}</strong><small>Tệp legacy được giữ để tương thích dữ liệu cũ</small></div><a class="secondary-button compact-button" href="${escapeHtml(task.evidenceUrl)}" target="_blank" rel="noopener">Mở</a></div>` : "";
  if (!rows && !legacy) return `<div class="task-evidence-empty">Chưa có tệp minh chứng trên Drive.</div>`;
  return `<div class="task-evidence-file-list">${rows}${legacy}</div>`;
}

function stagedListHtml(items = []) {
  const visible = items.filter(item => item.committed !== true && !["DISCARDED", "REMOVED"].includes(item.status));
  if (!visible.length) return `<div class="task-evidence-empty staged-evidence-empty">Chọn tệp để hệ thống tải lên Google Drive ngay.</div>`;
  return `<div class="staged-evidence-list">${visible.map(item => {
    const uploaded = item.status === "UPLOADED";
    const error = item.status === "ERROR";
    const busy = ["QUEUED", "UPLOADING", "REMOVING"].includes(item.status);
    const statusText = uploaded ? "Đã tải lên Drive · Chưa lưu" : error ? item.message : item.message || "Đang xử lý…";
    return `<div class="staged-evidence-row ${uploaded ? "is-uploaded" : error ? "is-error" : busy ? "is-busy" : ""}" data-staged-id="${escapeHtml(item.id)}">
      <div class="staged-evidence-main"><strong>${escapeHtml(item.originalName || item.uploaded?.originalFileName || item.uploaded?.fileName || "Tệp minh chứng")}</strong><small>${escapeHtml(statusText)}</small>${busy ? `<div class="staged-evidence-progress"><span style="width:${Math.max(2, Math.min(100, Number(item.percent || 0)))}%"></span></div>` : ""}${uploaded && item.uploaded?.uploadedSize ? `<small>${escapeHtml(DriveEvidenceService.formatBytes(item.uploaded.uploadedSize))}</small>` : ""}</div>
      <div class="staged-evidence-actions">${error ? `<button type="button" class="secondary-button compact-button" data-retry-staged-id="${escapeHtml(item.id)}">Thử lại</button>` : ""}<button type="button" class="evidence-remove-button" data-remove-staged-id="${escapeHtml(item.id)}" title="Bỏ tệp" aria-label="Bỏ tệp">×</button></div>
    </div>`;
  }).join("")}</div>`;
}

function milestonePanel(milestones, current, task = {}) {
  if (!milestones.length) {
    return `<div class="field-full info-banner"><strong>Chưa có mốc định kỳ</strong><span>Nhiệm vụ được đánh dấu định kỳ nhưng chưa có dữ liệu mốc. Vui lòng liên hệ quản trị viên trước khi cập nhật.</span></div>`;
  }
  const rows = milestones.map((item, index) => {
    const completed = Boolean(item.completedAt);
    const isCurrent = current?.id === item.id;
    const completedText = completed ? `Đã hoàn thành ${timestampDateKey(item.completedAt) || ""}`.trim() : (isCurrent ? "Mốc cần xử lý tiếp theo" : "Chưa hoàn thành");
    return `<div class="task-milestone-row ${completed ? "is-complete" : isCurrent ? "is-current" : "is-upcoming"}"><span class="task-milestone-icon">${completed ? "✓" : isCurrent ? "●" : "○"}</span><div><strong>Mốc ${index + 1} · ${formatDateKey(item.dueDateKey)}</strong><small>${completedText}</small></div></div>`;
  }).join("");
  return `<div class="field-full task-milestone-panel">
    <div class="task-milestone-panel-head"><div><strong>Nhiệm vụ ${String(task.frequency || "định kỳ").toLowerCase()}</strong><span>01 nhiệm vụ cho cả kỳ KPI · ${milestones.filter(item => item.completedAt).length}/${milestones.length} mốc đã hoàn thành</span></div></div>
    <div class="task-milestone-timeline">${rows}</div>
    <div class="task-milestone-panel-note">${current ? `Mốc tiếp theo: <strong>${formatDateKey(current.dueDateKey)}</strong>. Có thể hoàn thành trước hạn; nếu hoàn thành đúng hoặc sớm hạn, hệ thống ghi nhận tiến độ mốc là <strong>100%</strong>.` : "Tất cả mốc trong kỳ đã hoàn thành."}</div>
  </div>`;
}

export async function openTaskProgressModal(task, { onSaved }) {
  if (!mayUpdate(task)) throw new Error("Bạn cần xác nhận đã nhận nhiệm vụ và nhiệm vụ phải còn đang thực hiện trước khi cập nhật.");
  const itemized = String(task.trackingMode || "FINAL_OUTPUT").toUpperCase() === "ITEMIZED";
  const recurringMilestones = ["DAILY", "WEEKLY", "MONTHLY"].includes(String(task.milestoneMode || "").toUpperCase());
  const eventDriven = String(task.deadlineMode || "").toUpperCase() === "EVENT_DRIVEN";
  const [workItems, milestones, initialEvidenceFiles] = await Promise.all([
    itemized ? TaskWorkItemService.list(task) : Promise.resolve([]),
    recurringMilestones ? TaskMilestoneService.list(task) : Promise.resolve([]),
    TaskEvidenceService.list(task).catch(error => { console.warn("Không đọc được danh sách minh chứng:", error); return []; })
  ]);
  let evidenceFiles = [...initialEvidenceFiles];
  const workItemSummary = TaskWorkItemService.calculateSummary(workItems, task.workItemType, task);
  const currentMilestone = recurringMilestones ? TaskMilestoneService.firstIncomplete(milestones) : null;

  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop";
  overlay.innerHTML = `
    <section class="modal-panel modal-large" role="dialog" aria-modal="true">
      <div class="modal-header"><div><span class="page-eyebrow">${escapeHtml(task.taskCode || task.id)}</span><h2>Cập nhật nhiệm vụ</h2><p>${escapeHtml(task.title || "")}</p></div><button class="icon-button" type="button" data-close>✕</button></div>
      <div class="modal-body task-form-grid">
        ${recurringMilestones ? milestonePanel(milestones, currentMilestone, task) : itemized ? `<div class="field-full info-banner task-progress-tracking-note"><strong>${eventDriven ? "Đầu việc Khi phát sinh" : "Theo dõi theo từng lượt công việc"}</strong><span>${eventDriven ? "Deadline không được đặt ở đầu kỳ. Khi có yêu cầu thực tế, vào Chi tiết → Tiến độ và chọn “Ghi nhận việc phát sinh” để nhập hạn cụ thể cho từng lượt. " : ""}Hiện có ${Number(workItemSummary.totalRecordedCount || workItemSummary.count || 0)} lượt đã ghi nhận; ${workItemSummary.count || 0} lượt đang đủ điều kiện tính KPI. Tiến độ KPI được hệ thống tính tự động khi tự đánh giá.</span>${Number(workItemSummary.futurePendingCount || 0) > 0 ? `<small>${workItemSummary.futurePendingCount} lượt chưa hoàn thành và chưa đến hạn hiện chưa đưa vào mẫu số KPI.</small>` : (workItemSummary.incompleteCount > 0 ? `<small>${workItemSummary.incompleteCount} lượt đã đến hạn nhưng chưa hoàn thành đang được tính 0%.</small>` : "")}</div>` : `<div class="field-full info-banner final-output-banner"><strong>Đánh giá theo sản phẩm cuối cùng</strong><span>Khi chọn Hoàn thành, hệ thống tự ghi tiến độ 100% và thời điểm hoàn thành thực tế. Người dùng không nhập phần trăm tiến độ.</span></div>`}
        <label><span>Trạng thái</span><select id="progressStatus">
          ${statusOption("DANG_XU_LY", "Đang thực hiện", task.status)}
          ${statusOption("TAM_DUNG", "Tạm dừng", task.status)}
          ${recurringMilestones || eventDriven ? "" : statusOption("HOAN_THANH", "Hoàn thành", task.status)}
        </select></label>
        ${recurringMilestones && currentMilestone ? `<label class="field-full check-row task-milestone-complete-action"><input id="completeCurrentMilestone" type="checkbox"><span><strong>Xác nhận đã hoàn thành mốc ${formatDateKey(currentMilestone.dueDateKey)}</strong><small>Thời điểm hoàn thành được hệ thống ghi tự động. ${currentMilestone.id === task.finalMilestoneId ? "Đây là mốc cuối; sau khi xác nhận, nhiệm vụ sẽ tự chuyển sang Hoàn thành." : "Sau khi xác nhận, nhiệm vụ vẫn tiếp tục đến mốc kế tiếp."}</small></span></label>` : ""}
        <label class="field-full"><span>Minh chứng dạng nội dung/liên kết</span><textarea id="evidenceText" rows="3" maxlength="3000" placeholder="Mô tả kết quả, số văn bản hoặc dán liên kết minh chứng">${escapeHtml(task.evidenceText || "")}</textarea></label>
        <label class="field-full evidence-file-field"><span>Bổ sung tệp/hình ảnh minh chứng lên Google Drive</span><input id="evidenceFile" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"><small>Chọn tệp là hệ thống tải lên Drive ngay. Tối đa 10 tệp/lần, 20 tệp/nhiệm vụ, 8 MB/tệp. Có thể bấm × để bỏ tệp trước khi Lưu.</small></label>
        <div id="taskProgressFormError" class="field-full task-progress-form-error" hidden role="alert"></div>
        <div class="field-full task-evidence-staged"><div class="task-evidence-existing-head"><strong>Tệp đang bổ sung</strong><span>Tệp có dấu “Đã tải lên Drive · Chưa lưu” sẽ chỉ được gắn vào nhiệm vụ khi bấm Lưu.</span></div><div id="evidenceStagedList">${stagedListHtml([])}</div></div>
        <div class="field-full task-evidence-existing"><div class="task-evidence-existing-head"><strong id="savedEvidenceTitle">Minh chứng đã lưu (${evidenceFiles.length + (task.evidenceUrl && !evidenceFiles.some(item => item.fileUrl === task.evidenceUrl) ? 1 : 0)})</strong><span>Có thể mở lại nhiệm vụ và bổ sung thêm tệp bất cứ lúc nào khi nhiệm vụ còn được phép cập nhật.</span></div><div id="taskEvidenceSavedList">${evidenceListHtml(evidenceFiles, task)}</div></div>
      </div>
      <div class="modal-footer"><button class="secondary-button" type="button" data-close>Hủy</button><button id="saveProgressButton" class="primary-button" type="button">Lưu cập nhật</button></div>
    </section>`;
  document.body.appendChild(overlay);

  const $ = id => overlay.querySelector(`#${id}`);
  let saving = false;
  let closing = false;
  const staged = new StagedEvidenceUploader(task, {
    existingCount: evidenceFiles.length,
    onChange: () => {
      renderStaged();
      refreshSaveState();
    }
  });

  const setFormError = message => {
    const box = $("taskProgressFormError");
    if (!box) return;
    box.hidden = !message;
    box.textContent = message || "";
    if (message) box.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const normalSaveLabel = () => {
    if (recurringMilestones && $("completeCurrentMilestone")?.checked) {
      return currentMilestone?.id === task.finalMilestoneId ? "Hoàn thành nhiệm vụ" : `Hoàn thành mốc ${formatDateKey(currentMilestone?.dueDateKey)}`;
    }
    if (!recurringMilestones && $("progressStatus")?.value === "HOAN_THANH") return "Hoàn thành nhiệm vụ";
    return "Lưu cập nhật";
  };

  function refreshSaveState() {
    const button = $("saveProgressButton");
    if (!button) return;
    const hasError = staged.snapshot().some(item => item.status === "ERROR");
    button.disabled = saving || staged.busy || hasError;
    if (saving) return;
    if (staged.busy) button.textContent = "Đang tải minh chứng…";
    else if (hasError) button.textContent = "Xử lý tệp lỗi trước khi lưu";
    else button.textContent = normalSaveLabel();
  }

  function renderStaged() {
    const target = $("evidenceStagedList");
    if (target) target.innerHTML = stagedListHtml(staged.snapshot());
  }

  function renderSavedEvidence() {
    const target = $("taskEvidenceSavedList");
    if (target) target.innerHTML = evidenceListHtml(evidenceFiles, task);
    const title = $("savedEvidenceTitle");
    if (title) title.textContent = `Minh chứng đã lưu (${evidenceFiles.length + (task.evidenceUrl && !evidenceFiles.some(item => item.fileUrl === task.evidenceUrl) ? 1 : 0)})`;
  }

  const close = async () => {
    if (saving || closing) return;
    closing = true;
    overlay.querySelectorAll("[data-close]").forEach(button => { button.disabled = true; });
    try { await staged.cleanup(); } catch (_) { /* best effort */ }
    overlay.remove();
  };
  overlay.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", () => { void close(); }));

  $("completeCurrentMilestone")?.addEventListener("change", refreshSaveState);
  $("progressStatus")?.addEventListener("change", refreshSaveState);

  $("evidenceFile")?.addEventListener("change", async event => {
    setFormError("");
    const input = event.currentTarget;
    const files = Array.from(input.files || []);
    input.value = "";
    try {
      await staged.addFiles(files);
    } catch (error) {
      setFormError(friendlyErrorMessage(error, "Tệp minh chứng không hợp lệ."));
    }
    refreshSaveState();
  });

  overlay.addEventListener("click", async event => {
    const removeStagedButton = event.target.closest("[data-remove-staged-id]");
    if (removeStagedButton) {
      setFormError("");
      removeStagedButton.disabled = true;
      try { await staged.remove(removeStagedButton.dataset.removeStagedId); }
      catch (error) { setFormError(friendlyErrorMessage(error, "Không gỡ được tệp.")); }
      refreshSaveState();
      return;
    }
    const retryButton = event.target.closest("[data-retry-staged-id]");
    if (retryButton) {
      setFormError("");
      retryButton.disabled = true;
      try { await staged.retry(retryButton.dataset.retryStagedId); }
      catch (error) { setFormError(friendlyErrorMessage(error, "Không tải lại được tệp.")); }
      refreshSaveState();
      return;
    }
    const removeSavedButton = event.target.closest("[data-remove-evidence-id]");
    if (removeSavedButton) {
      const evidence = evidenceFiles.find(item => item.id === removeSavedButton.dataset.removeEvidenceId);
      if (!evidence) return;
      setFormError("");
      removeSavedButton.disabled = true;
      try {
        await TaskEvidenceService.remove(task, evidence);
        evidenceFiles = evidenceFiles.filter(item => item.id !== evidence.id);
        renderSavedEvidence();
        try { await DriveEvidenceService.trash(evidence, task); }
        catch (driveError) { console.warn("Đã gỡ minh chứng khỏi nhiệm vụ nhưng chưa đưa được file Drive vào Thùng rác:", driveError); }
      } catch (error) {
        setFormError(friendlyErrorMessage(error, "Không gỡ được minh chứng đã lưu."));
        removeSavedButton.disabled = false;
      }
      return;
    }
  });

  refreshSaveState();

  $("saveProgressButton").addEventListener("click", async () => {
    const button = $("saveProgressButton");
    try {
      setFormError("");
      if (staged.busy) throw new Error("Minh chứng đang được tải lên Google Drive. Hãy chờ hoàn tất trước khi lưu.");
      if (staged.snapshot().some(item => item.status === "ERROR")) throw new Error("Có tệp tải lên bị lỗi. Hãy Thử lại hoặc bấm × để bỏ tệp đó trước khi lưu.");
      saving = true;
      refreshSaveState();
      overlay.querySelectorAll("[data-close]").forEach(item => { item.disabled = true; });
      button.textContent = "Đang lưu…";

      let evidenceUrl = task.evidenceUrl || task.evidenceLink || "";
      let evidenceFileName = task.evidenceFileName || "";
      let evidenceStoragePath = task.evidenceStoragePath || "";
      const uploadedFiles = staged.uploaded;
      if (uploadedFiles.length) {
        const last = uploadedFiles[uploadedFiles.length - 1];
        evidenceUrl = last.fileUrl || evidenceUrl;
        evidenceFileName = last.fileName || last.originalFileName || evidenceFileName;
        evidenceStoragePath = last.fileId || last.storagePath || evidenceStoragePath;
        const records = await TaskEvidenceService.addUploadedFiles(task, uploadedFiles, {
          scopeType: recurringMilestones && currentMilestone ? "MILESTONE" : "TASK",
          scopeId: recurringMilestones && currentMilestone ? currentMilestone.id : "",
          existingFiles: evidenceFiles
        });
        evidenceFiles.push(...records);
        // Từ thời điểm record Firestore đã được tạo, file là minh chứng chính thức.
        // Nếu cập nhật trạng thái/mốc phía sau lỗi, không được cleanup làm file Drive biến mất.
        staged.markCommitted(uploadedFiles);
        renderSavedEvidence();
      }

      const changes = {
        status: $("progressStatus").value,
        evidenceText: cleanText($("evidenceText").value, 3000),
        evidenceType: evidenceUrl ? "FILE" : ($("evidenceText").value.trim() ? "TEXT" : ""),
        evidenceUrl,
        evidenceFileName,
        evidenceStoragePath
      };

      const completesMilestone = recurringMilestones && $("completeCurrentMilestone")?.checked === true;
      if (!recurringMilestones && changes.status === "HOAN_THANH" && itemized && workItemSummary.count === 0) {
        throw new Error("Chưa có lượt phát sinh nên không thể chấm hoàn thành. Hãy thêm nội dung chi tiết; nếu cả kỳ không phát sinh, dùng nút “Đề nghị Không phát sinh” tại Chi tiết nhiệm vụ.");
      }

      if (completesMilestone) {
        validateProgressInput({ ...changes, status: "MILESTONE_COMPLETED" }, task);
        button.textContent = "Đang hoàn tất mốc…";
        await TaskMilestoneService.complete(task, currentMilestone, changes);
      } else {
        validateProgressInput(changes, task);
        button.textContent = "Đang hoàn tất cập nhật…";
        await TaskWriteService.updateProgress(task, changes);
      }

      saving = false;
      overlay.remove();
      await onSaved?.();
    } catch (error) {
      saving = false;
      const message = friendlyErrorMessage(error, "Không lưu được cập nhật.");
      setFormError(message);
      refreshSaveState();
      overlay.querySelectorAll("[data-close]").forEach(item => { item.disabled = false; });
    }
  });
}

function escapeHtml(value) { return String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;"); }
