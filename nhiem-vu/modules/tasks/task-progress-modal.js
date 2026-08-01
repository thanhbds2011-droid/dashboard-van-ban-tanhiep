/** Cập nhật tiến độ, kết quả và minh chứng nhiệm vụ. */
import { UserContext } from "../../core/user-context.js";
import { TaskWriteService } from "../../services/task-write-service.js?v=20260801.V1_3_0";
import { DriveEvidenceService } from "../../services/drive-evidence-service.js?v=20260801.V1_3_0";
import { TaskWorkItemService } from "../../services/task-work-item-service.js?v=20260801.V1_3_0";
import { validateProgressInput, cleanText } from "./task-form-validator.js";

function mayUpdate(task) {
  const user = UserContext.requireUser();
  return Boolean(
    task &&
    task.ownerUserId === user.uid &&
    task.active !== false &&
    task.assignmentStatus === "DA_TIEP_NHAN"
  );
}

export async function openTaskProgressModal(task, { onSaved }) {
  if (!mayUpdate(task)) throw new Error("Bạn cần xác nhận đã nhận nhiệm vụ trước khi cập nhật.");
  const itemized = String(task.trackingMode || "FINAL_OUTPUT").toUpperCase() === "ITEMIZED";
  const workItems = itemized ? await TaskWorkItemService.list(task.id) : [];
  const workItemSummary = TaskWorkItemService.calculateSummary(workItems, task.workItemType);
  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop";
  overlay.innerHTML = `
    <section class="modal-panel modal-large" role="dialog" aria-modal="true">
      <div class="modal-header"><div><span class="page-eyebrow">${escapeHtml(task.taskCode || task.id)}</span><h2>Cập nhật nhiệm vụ</h2><p>${escapeHtml(task.title || "")}</p></div><button class="icon-button" type="button" data-close>✕</button></div>
      <div class="modal-body task-form-grid">
        ${itemized ? `<div class="field-full info-banner task-progress-tracking-note"><strong>Theo dõi theo từng lượt công việc</strong><span>Hiện có ${workItemSummary.count} lượt, đã hoàn thành/ghi nhận ${workItemSummary.completedCount}/${workItemSummary.count || 0}. Các lượt tạo tỷ lệ N–T–K; điểm của toàn đầu việc vẫn chỉ được tính một lần theo Phụ lục 04.</span>${workItemSummary.incompleteCount > 0 ? `<small>${workItemSummary.incompleteCount} lượt chưa hoàn thành sẽ vẫn nằm trong N và không được tính vào T/K khi đánh giá cuối kỳ.</small>` : ""}</div>` : `<div class="field-full info-banner final-output-banner"><strong>Đánh giá theo sản phẩm cuối cùng</strong><span>Không cần nhập từng lượt công việc. Hãy cập nhật kết quả và minh chứng cuối cùng bên dưới để chấm trực tiếp theo Phụ lục 04.</span></div>`}
        <label><span>Trạng thái</span><select id="progressStatus"><option value="DANG_XU_LY">Đang xử lý</option><option value="TAM_DUNG">Tạm dừng</option><option value="HOAN_THANH">Hoàn thành</option></select></label>
        <label><span>Tiến độ (%)</span><input id="progressValue" type="number" min="0" max="100" step="10" value="${Number(task.progress || 0)}"></label>
        <label class="field-full"><span>Nội dung cập nhật</span><textarea id="progressNote" rows="3" maxlength="3000"></textarea></label>
        <label class="field-full"><span>Kết quả thực hiện</span><textarea id="resultSummary" rows="3" maxlength="5000">${escapeHtml(task.resultSummary || task.result || "")}</textarea></label>
        <label class="field-full"><span>Khó khăn, vướng mắc</span><textarea id="difficulties" rows="2" maxlength="3000">${escapeHtml(task.difficulties || "")}</textarea></label>
        <label class="field-full"><span>Đề xuất hỗ trợ</span><textarea id="proposal" rows="2" maxlength="3000">${escapeHtml(task.proposal || "")}</textarea></label>
        <label class="field-full"><span>Minh chứng dạng nội dung/liên kết</span><textarea id="evidenceText" rows="2" maxlength="3000">${escapeHtml(task.evidenceText || "")}</textarea></label>
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

  $("progressStatus").addEventListener("change", () => {
    if ($("progressStatus").value === "HOAN_THANH") $("progressValue").value = "100";
  });

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

      if ($("progressStatus").value === "HOAN_THANH" && itemized) {
        if (workItemSummary.count === 0) {
          throw new Error("Chưa có lượt phát sinh nên không thể chấm hoàn thành. Hãy thêm nội dung chi tiết; nếu cả kỳ không phát sinh, dùng nút “Đề nghị Không phát sinh” tại Chi tiết nhiệm vụ.");
        }
      }

      const changes = {
        status: $("progressStatus").value,
        progress: Number($("progressValue").value),
        progressNote: cleanText($("progressNote").value, 3000),
        resultSummary: cleanText($("resultSummary").value, 5000),
        difficulties: cleanText($("difficulties").value, 3000),
        proposal: cleanText($("proposal").value, 3000),
        evidenceText: cleanText($("evidenceText").value, 3000),
        evidenceType: evidenceUrl ? "FILE" : ($("evidenceText").value.trim() ? "TEXT" : ""),
        evidenceUrl,
        evidenceFileName,
        evidenceStoragePath
      };
      validateProgressInput(changes, task);
      button.textContent = "Đang hoàn tất cập nhật…";
      await TaskWriteService.updateProgress(task, changes);
      uploading = false;
      overlay.remove();
      await onSaved?.();
    } catch (error) {
      uploading = false;
      window.alert(error?.message || "Không lưu được cập nhật.");
      showUploadError(error?.message || "Không lưu được cập nhật.");
      button.disabled = false;
      button.textContent = "Lưu cập nhật";
      overlay.querySelectorAll("[data-close]").forEach(item => item.disabled = false);
    }
  });
}

function escapeHtml(value) { return String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;"); }
