/**
 * Cập nhật nhiệm vụ V1.13.0.
 * UI chỉ còn: Trạng thái + minh chứng nội dung/liên kết + tệp/hình ảnh.
 * Các field legacy progressNote/resultSummary/difficulties/proposal vẫn được giữ trong Firestore
 * để đọc lịch sử, nhưng không còn được nhập mới tại đây.
 */
import { UserContext } from "../../core/user-context.js?v=20260824.V1_14_1";
import { friendlyErrorMessage } from "../../core/friendly-error.js?v=20260824.V1_14_1";
import { TaskWriteService } from "../../services/task-write-service.js?v=20260824.V1_14_1";
import { TaskMilestoneService } from "../../services/task-milestone-service.js?v=20260824.V1_14_1";
import { DriveEvidenceService } from "../../services/drive-evidence-service.js?v=20260824.V1_14_1";
import { TaskWorkItemService } from "../../services/task-work-item-service.js?v=20260824.V1_14_1";
import { validateProgressInput, cleanText } from "./task-form-validator.js?v=20260824.V1_14_1";

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

function milestonePanel(milestones, current) {
  if (!milestones.length) {
    return `<div class="field-full info-banner"><strong>Chưa có mốc định kỳ</strong><span>Nhiệm vụ được đánh dấu Theo tháng nhưng chưa có dữ liệu mốc. Vui lòng liên hệ quản trị viên trước khi cập nhật.</span></div>`;
  }
  return `<div class="field-full info-banner task-progress-tracking-note">
    <strong>Nhiệm vụ theo tháng · 01 nhiệm vụ cho cả kỳ KPI</strong>
    <span>${milestones.map(item => `${item.completedAt ? "✓" : "○"} ${formatDateKey(item.dueDateKey)}`).join(" · ")}</span>
    <small>${current ? `Mốc cần hoàn thành tiếp theo: ${formatDateKey(current.dueDateKey)}. Hoàn thành mốc này không kết thúc nhiệm vụ nếu vẫn còn mốc phía sau.` : "Tất cả mốc đã hoàn thành."}</small>
  </div>`;
}

export async function openTaskProgressModal(task, { onSaved }) {
  if (!mayUpdate(task)) throw new Error("Bạn cần xác nhận đã nhận nhiệm vụ và nhiệm vụ phải còn đang thực hiện trước khi cập nhật.");
  const itemized = String(task.trackingMode || "FINAL_OUTPUT").toUpperCase() === "ITEMIZED";
  const monthlyMilestones = String(task.milestoneMode || "").toUpperCase() === "MONTHLY";
  const [workItems, milestones] = await Promise.all([
    itemized ? TaskWorkItemService.list(task.id) : Promise.resolve([]),
    monthlyMilestones ? TaskMilestoneService.list(task) : Promise.resolve([])
  ]);
  const workItemSummary = TaskWorkItemService.calculateSummary(workItems, task.workItemType);
  const currentMilestone = monthlyMilestones ? TaskMilestoneService.firstIncomplete(milestones) : null;

  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop";
  overlay.innerHTML = `
    <section class="modal-panel modal-large" role="dialog" aria-modal="true">
      <div class="modal-header"><div><span class="page-eyebrow">${escapeHtml(task.taskCode || task.id)}</span><h2>Cập nhật nhiệm vụ</h2><p>${escapeHtml(task.title || "")}</p></div><button class="icon-button" type="button" data-close>✕</button></div>
      <div class="modal-body task-form-grid">
        ${monthlyMilestones ? milestonePanel(milestones, currentMilestone) : itemized ? `<div class="field-full info-banner task-progress-tracking-note"><strong>Theo dõi theo từng lượt công việc</strong><span>Hiện có ${workItemSummary.count} lượt, đã hoàn thành/ghi nhận ${workItemSummary.completedCount}/${workItemSummary.count || 0}. Tiến độ KPI được hệ thống tính tự động khi tự đánh giá.</span>${workItemSummary.incompleteCount > 0 ? `<small>${workItemSummary.incompleteCount} lượt chưa hoàn thành vẫn được tính trong tổng số lượt.</small>` : ""}</div>` : `<div class="field-full info-banner final-output-banner"><strong>Đánh giá theo sản phẩm cuối cùng</strong><span>Khi chọn Hoàn thành, hệ thống tự ghi tiến độ 100% và thời điểm hoàn thành thực tế. Người dùng không nhập phần trăm tiến độ.</span></div>`}
        <label><span>Trạng thái</span><select id="progressStatus">
          ${statusOption("DANG_XU_LY", "Đang xử lý", task.status)}
          ${statusOption("TAM_DUNG", "Tạm dừng", task.status)}
          ${monthlyMilestones ? "" : statusOption("HOAN_THANH", "Hoàn thành", task.status)}
        </select></label>
        ${monthlyMilestones && currentMilestone ? `<label class="field-full check-row"><input id="completeCurrentMilestone" type="checkbox"><span><strong>Hoàn thành mốc ${formatDateKey(currentMilestone.dueDateKey)}</strong><small>completedAt được ghi bằng thời gian thực tế của hệ thống. ${currentMilestone.id === task.finalMilestoneId ? "Đây là mốc cuối; khi hoàn tất, nhiệm vụ sẽ tự chuyển Hoàn thành và progress = 100." : "Nhiệm vụ vẫn tiếp tục đến mốc kế tiếp."}</small></span></label>` : ""}
        <label class="field-full"><span>Minh chứng dạng nội dung/liên kết</span><textarea id="evidenceText" rows="3" maxlength="3000" placeholder="Mô tả kết quả, số văn bản hoặc dán liên kết minh chứng">${escapeHtml(task.evidenceText || "")}</textarea></label>
        <label class="field-full evidence-file-field"><span>Tải tệp/hình ảnh minh chứng lên Google Drive</span><input id="evidenceFile" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"><small>Hình ảnh dung lượng lớn được tự động tối ưu trước khi tải. Tệp tối đa 8 MB.</small></label>
        <div id="evidenceUploadStatus" class="field-full evidence-upload-status" hidden aria-live="polite">
          <div class="evidence-upload-heading"><strong id="evidenceUploadMessage">Đang chuẩn bị tệp…</strong><span id="evidenceUploadPercent">0%</span></div>
          <div class="evidence-upload-track"><span id="evidenceUploadBar"></span></div>
          <small id="evidenceUploadDetail"></small>
        </div>
        ${task.evidenceUrl ? `<div class="field-full info-banner">Tệp hiện tại: <a href="${escapeHtml(task.evidenceUrl)}" target="_blank" rel="noopener">${escapeHtml(task.evidenceFileName || "Mở minh chứng")}</a></div>` : ""}
      </div>
      <div class="modal-footer"><button class="secondary-button" type="button" data-close>Hủy</button><button id="saveProgressButton" class="primary-button" type="button">Lưu cập nhật</button></div>
    </section>`;
  document.body.appendChild(overlay);

  const $ = id => overlay.querySelector(`#${id}`);
  let uploading = false;
  let preparedPromise = null;
  let selectedFile = null;

  const close = () => {
    if (uploading) return;
    overlay.remove();
  };
  overlay.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", close));

  const updateUploadStatus = info => {
    const box = $("evidenceUploadStatus");
    if (!box) return;
    box.hidden = false;
    box.classList.remove("is-error", "is-complete");
    if (info?.phase === "COMPLETED") box.classList.add("is-complete");
    const percent = Math.max(0, Math.min(100, Number(info?.percent || 0)));
    $("evidenceUploadMessage").textContent = info?.message || "Đang xử lý tệp…";
    $("evidenceUploadPercent").textContent = `${Math.round(percent)}%`;
    $("evidenceUploadBar").style.width = `${percent}%`;
    if (info?.optimized === true && info.originalSize && info.uploadedSize) {
      $("evidenceUploadDetail").textContent = `Dung lượng tải lên: ${DriveEvidenceService.formatBytes(info.uploadedSize)} · Tệp gốc: ${DriveEvidenceService.formatBytes(info.originalSize)}`;
    } else if (selectedFile) {
      $("evidenceUploadDetail").textContent = `Dung lượng: ${DriveEvidenceService.formatBytes(selectedFile.size)}`;
    }
  };

  const showUploadError = message => {
    const box = $("evidenceUploadStatus");
    box.hidden = false;
    box.classList.add("is-error");
    $("evidenceUploadMessage").textContent = message;
    $("evidenceUploadPercent").textContent = "";
    $("evidenceUploadBar").style.width = "0%";
  };

  $("evidenceFile").addEventListener("change", () => {
    selectedFile = $("evidenceFile").files?.[0] || null;
    preparedPromise = null;
    if (!selectedFile) {
      $("evidenceUploadStatus").hidden = true;
      return;
    }
    try {
      DriveEvidenceService.validateFile(selectedFile);
      updateUploadStatus({ phase: "SELECTED", percent: 2, message: `Đã chọn ${selectedFile.name}` });
      preparedPromise = DriveEvidenceService.prepare(selectedFile, { onProgress: updateUploadStatus });
      preparedPromise.then(prepared => {
        updateUploadStatus({
          phase: "READY",
          percent: 16,
          message: prepared.optimized ? "Hình ảnh đã được tối ưu, sẵn sàng tải lên." : "Tệp đã sẵn sàng tải lên.",
          ...prepared
        });
      }).catch(error => showUploadError(error?.message || "Không chuẩn bị được tệp."));
    } catch (error) {
      showUploadError(error?.message || "Tệp không hợp lệ.");
    }
  });

  $("saveProgressButton").addEventListener("click", async () => {
    const button = $("saveProgressButton");
    try {
      button.disabled = true;
      uploading = true;
      overlay.querySelectorAll("[data-close]").forEach(item => item.disabled = true);
      button.textContent = "Đang lưu…";

      let evidenceUrl = task.evidenceUrl || task.evidenceLink || "";
      let evidenceFileName = task.evidenceFileName || "";
      let evidenceStoragePath = task.evidenceStoragePath || "";
      const file = $("evidenceFile").files?.[0] || null;

      if (file) {
        if (preparedPromise) await preparedPromise;
        button.textContent = "Đang tải minh chứng…";
        const uploaded = await DriveEvidenceService.upload(file, task, { onProgress: updateUploadStatus });
        evidenceUrl = uploaded.fileUrl || "";
        evidenceFileName = uploaded.fileName || file.name;
        evidenceStoragePath = uploaded.fileId || "";
      }

      const changes = {
        status: $("progressStatus").value,
        evidenceText: cleanText($("evidenceText").value, 3000),
        evidenceType: evidenceUrl ? "FILE" : ($("evidenceText").value.trim() ? "TEXT" : ""),
        evidenceUrl,
        evidenceFileName,
        evidenceStoragePath
      };

      const completesMilestone = monthlyMilestones && $("completeCurrentMilestone")?.checked === true;
      if (!monthlyMilestones && changes.status === "HOAN_THANH" && itemized && workItemSummary.count === 0) {
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

      uploading = false;
      overlay.remove();
      await onSaved?.();
    } catch (error) {
      uploading = false;
      const message = friendlyErrorMessage(error, "Không lưu được cập nhật.");
      window.alert(message);
      showUploadError(message);
      button.disabled = false;
      button.textContent = "Lưu cập nhật";
      overlay.querySelectorAll("[data-close]").forEach(item => item.disabled = false);
    }
  });
}

function escapeHtml(value) { return String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;"); }
