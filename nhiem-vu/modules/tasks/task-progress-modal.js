/**
 * Cập nhật nhiệm vụ V1.13.0.
 * UI chỉ còn: Trạng thái + minh chứng nội dung/liên kết + tệp/hình ảnh.
 * Các field legacy progressNote/resultSummary/difficulties/proposal vẫn được giữ trong Firestore
 * để đọc lịch sử, nhưng không còn được nhập mới tại đây.
 */
import { UserContext } from "../../core/user-context.js?v=20260824.V1_15_0";
import { friendlyErrorMessage } from "../../core/friendly-error.js?v=20260824.V1_15_0";
import { TaskWriteService } from "../../services/task-write-service.js?v=20260824.V1_15_0";
import { TaskMilestoneService } from "../../services/task-milestone-service.js?v=20260824.V1_15_0";
import { DriveEvidenceService } from "../../services/drive-evidence-service.js?v=20260824.V1_15_0";
import { TaskWorkItemService } from "../../services/task-work-item-service.js?v=20260824.V1_15_0";
import { TaskEvidenceService } from "../../services/task-evidence-service.js?v=20260824.V1_15_0";
import { validateProgressInput, cleanText } from "./task-form-validator.js?v=20260824.V1_15_0";

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

function evidenceListHtml(files = [], task = {}) {
  const rows = (files || []).map((item, index) => `<div class="task-evidence-file-row"><span class="task-evidence-file-index">${index + 1}</span><div><strong>${escapeHtml(item.fileName || "Tệp minh chứng")}</strong><small>${item.scopeType === "MILESTONE" ? "Minh chứng mốc" : item.scopeType === "WORK_ITEM" ? "Minh chứng lượt phát sinh" : "Minh chứng nhiệm vụ"}</small></div><a class="secondary-button compact-button" href="${escapeHtml(item.fileUrl || "#")}" target="_blank" rel="noopener">Mở</a></div>`).join("");
  const legacyExists = task?.evidenceUrl && !(files || []).some(item => item.fileUrl === task.evidenceUrl);
  const legacy = legacyExists ? `<div class="task-evidence-file-row is-legacy"><span class="task-evidence-file-index">•</span><div><strong>${escapeHtml(task.evidenceFileName || "Minh chứng trước đây")}</strong><small>Tệp legacy được giữ để tương thích dữ liệu cũ</small></div><a class="secondary-button compact-button" href="${escapeHtml(task.evidenceUrl)}" target="_blank" rel="noopener">Mở</a></div>` : "";
  if (!rows && !legacy) return `<div class="task-evidence-empty">Chưa có tệp minh chứng trên Drive.</div>`;
  return `<div class="task-evidence-file-list">${rows}${legacy}</div>`;
}

function milestonePanel(milestones, current) {
  if (!milestones.length) {
    return `<div class="field-full info-banner"><strong>Chưa có mốc định kỳ</strong><span>Nhiệm vụ được đánh dấu Theo tháng nhưng chưa có dữ liệu mốc. Vui lòng liên hệ quản trị viên trước khi cập nhật.</span></div>`;
  }
  const rows = milestones.map((item, index) => {
    const completed = Boolean(item.completedAt);
    const isCurrent = current?.id === item.id;
    const completedText = completed ? `Đã hoàn thành ${timestampDateKey(item.completedAt) || ""}`.trim() : (isCurrent ? "Mốc cần xử lý tiếp theo" : "Chưa hoàn thành");
    return `<div class="task-milestone-row ${completed ? "is-complete" : isCurrent ? "is-current" : "is-upcoming"}"><span class="task-milestone-icon">${completed ? "✓" : isCurrent ? "●" : "○"}</span><div><strong>Mốc ${index + 1} · ${formatDateKey(item.dueDateKey)}</strong><small>${completedText}</small></div></div>`;
  }).join("");
  return `<div class="field-full task-milestone-panel">
    <div class="task-milestone-panel-head"><div><strong>Nhiệm vụ theo tháng</strong><span>01 nhiệm vụ cho cả kỳ KPI · ${milestones.filter(item => item.completedAt).length}/${milestones.length} mốc đã hoàn thành</span></div></div>
    <div class="task-milestone-timeline">${rows}</div>
    <div class="task-milestone-panel-note">${current ? `Mốc tiếp theo: <strong>${formatDateKey(current.dueDateKey)}</strong>. Có thể hoàn thành trước hạn; nếu hoàn thành đúng hoặc sớm hạn, hệ thống ghi nhận tiến độ mốc là <strong>100%</strong>.` : "Tất cả mốc trong kỳ đã hoàn thành."}</div>
  </div>`;
}

export async function openTaskProgressModal(task, { onSaved }) {
  if (!mayUpdate(task)) throw new Error("Bạn cần xác nhận đã nhận nhiệm vụ và nhiệm vụ phải còn đang thực hiện trước khi cập nhật.");
  const itemized = String(task.trackingMode || "FINAL_OUTPUT").toUpperCase() === "ITEMIZED";
  const monthlyMilestones = String(task.milestoneMode || "").toUpperCase() === "MONTHLY";
  const eventDriven = String(task.deadlineMode || "").toUpperCase() === "EVENT_DRIVEN";
  const [workItems, milestones, evidenceFiles] = await Promise.all([
    itemized ? TaskWorkItemService.list(task) : Promise.resolve([]),
    monthlyMilestones ? TaskMilestoneService.list(task) : Promise.resolve([]),
    TaskEvidenceService.list(task).catch(error => { console.warn("Không đọc được danh sách minh chứng:", error); return []; })
  ]);
  const workItemSummary = TaskWorkItemService.calculateSummary(workItems, task.workItemType, task);
  const currentMilestone = monthlyMilestones ? TaskMilestoneService.firstIncomplete(milestones) : null;

  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop";
  overlay.innerHTML = `
    <section class="modal-panel modal-large" role="dialog" aria-modal="true">
      <div class="modal-header"><div><span class="page-eyebrow">${escapeHtml(task.taskCode || task.id)}</span><h2>Cập nhật nhiệm vụ</h2><p>${escapeHtml(task.title || "")}</p></div><button class="icon-button" type="button" data-close>✕</button></div>
      <div class="modal-body task-form-grid">
        ${monthlyMilestones ? milestonePanel(milestones, currentMilestone) : itemized ? `<div class="field-full info-banner task-progress-tracking-note"><strong>${eventDriven ? "Đầu việc Khi phát sinh" : "Theo dõi theo từng lượt công việc"}</strong><span>${eventDriven ? "Deadline không được đặt ở đầu kỳ. Khi có yêu cầu thực tế, vào Chi tiết → Tiến độ và chọn “Ghi nhận việc phát sinh” để nhập hạn cụ thể cho từng lượt. " : ""}Hiện có ${Number(workItemSummary.totalRecordedCount || workItemSummary.count || 0)} lượt đã ghi nhận; ${workItemSummary.count || 0} lượt đang đủ điều kiện tính KPI. Tiến độ KPI được hệ thống tính tự động khi tự đánh giá.</span>${Number(workItemSummary.futurePendingCount || 0) > 0 ? `<small>${workItemSummary.futurePendingCount} lượt chưa hoàn thành và chưa đến hạn hiện chưa đưa vào mẫu số KPI.</small>` : (workItemSummary.incompleteCount > 0 ? `<small>${workItemSummary.incompleteCount} lượt đã đến hạn nhưng chưa hoàn thành đang được tính 0%.</small>` : "")}</div>` : `<div class="field-full info-banner final-output-banner"><strong>Đánh giá theo sản phẩm cuối cùng</strong><span>Khi chọn Hoàn thành, hệ thống tự ghi tiến độ 100% và thời điểm hoàn thành thực tế. Người dùng không nhập phần trăm tiến độ.</span></div>`}
        <label><span>Trạng thái</span><select id="progressStatus">
          ${statusOption("DANG_XU_LY", "Đang thực hiện", task.status)}
          ${statusOption("TAM_DUNG", "Tạm dừng", task.status)}
          ${monthlyMilestones || eventDriven ? "" : statusOption("HOAN_THANH", "Hoàn thành", task.status)}
        </select></label>
        ${monthlyMilestones && currentMilestone ? `<label class="field-full check-row task-milestone-complete-action"><input id="completeCurrentMilestone" type="checkbox"><span><strong>Xác nhận đã hoàn thành mốc ${formatDateKey(currentMilestone.dueDateKey)}</strong><small>Thời điểm hoàn thành được hệ thống ghi tự động. ${currentMilestone.id === task.finalMilestoneId ? "Đây là mốc cuối; sau khi xác nhận, nhiệm vụ sẽ tự chuyển sang Hoàn thành." : "Sau khi xác nhận, nhiệm vụ vẫn tiếp tục đến mốc kế tiếp."}</small></span></label>` : ""}
        <label class="field-full"><span>Minh chứng dạng nội dung/liên kết</span><textarea id="evidenceText" rows="3" maxlength="3000" placeholder="Mô tả kết quả, số văn bản hoặc dán liên kết minh chứng">${escapeHtml(task.evidenceText || "")}</textarea></label>
        <label class="field-full evidence-file-field"><span>Bổ sung tệp/hình ảnh minh chứng lên Google Drive</span><input id="evidenceFile" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"><small>Được chọn tối đa 10 tệp/lần, tối đa 20 tệp/nhiệm vụ. Mỗi tệp tối đa 8 MB; hình ảnh lớn được tự động tối ưu. Tệp mới được bổ sung, không ghi đè tệp cũ.</small></label>
        <div id="taskProgressFormError" class="field-full task-progress-form-error" hidden role="alert"></div>
        <div id="evidenceUploadStatus" class="field-full evidence-upload-status" hidden aria-live="polite">
          <div class="evidence-upload-heading"><strong id="evidenceUploadMessage">Đang chuẩn bị tệp…</strong><span id="evidenceUploadPercent">0%</span></div>
          <div class="evidence-upload-track"><span id="evidenceUploadBar"></span></div>
          <small id="evidenceUploadDetail"></small>
        </div>
        <div class="field-full task-evidence-existing"><div class="task-evidence-existing-head"><strong>Minh chứng đã lưu (${evidenceFiles.length + (task.evidenceUrl && !evidenceFiles.some(item => item.fileUrl === task.evidenceUrl) ? 1 : 0)})</strong><span>Có thể mở lại nhiệm vụ và bổ sung thêm tệp bất cứ lúc nào khi nhiệm vụ còn được phép cập nhật.</span></div>${evidenceListHtml(evidenceFiles, task)}</div>
      </div>
      <div class="modal-footer"><button class="secondary-button" type="button" data-close>Hủy</button><button id="saveProgressButton" class="primary-button" type="button">Lưu cập nhật</button></div>
    </section>`;
  document.body.appendChild(overlay);

  const $ = id => overlay.querySelector(`#${id}`);
  let uploading = false;
  let selectedFiles = [];

  const close = () => {
    if (uploading) return;
    overlay.remove();
  };
  overlay.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", close));

  const normalSaveLabel = () => {
    if (monthlyMilestones && $("completeCurrentMilestone")?.checked) {
      return currentMilestone?.id === task.finalMilestoneId
        ? "Hoàn thành nhiệm vụ"
        : `Hoàn thành mốc ${formatDateKey(currentMilestone?.dueDateKey)}`;
    }
    if (!monthlyMilestones && $("progressStatus")?.value === "HOAN_THANH") return "Hoàn thành nhiệm vụ";
    return "Lưu cập nhật";
  };
  const refreshSaveLabel = () => {
    const button = $("saveProgressButton");
    if (button && !uploading) button.textContent = normalSaveLabel();
  };
  $("completeCurrentMilestone")?.addEventListener("change", refreshSaveLabel);
  $("progressStatus")?.addEventListener("change", refreshSaveLabel);
  refreshSaveLabel();

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
    } else if (selectedFiles.length) {
      const totalSize = selectedFiles.reduce((sum, file) => sum + Number(file.size || 0), 0);
      $("evidenceUploadDetail").textContent = `${selectedFiles.length} tệp · Tổng dung lượng gốc: ${DriveEvidenceService.formatBytes(totalSize)}`;
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
    selectedFiles = Array.from($("evidenceFile").files || []);
    if (!selectedFiles.length) {
      $("evidenceUploadStatus").hidden = true;
      return;
    }
    try {
      if (selectedFiles.length > TaskEvidenceService.MAX_PER_SELECTION) {
        throw new Error(`Mỗi lần chỉ được chọn tối đa ${TaskEvidenceService.MAX_PER_SELECTION} tệp.`);
      }
      if (evidenceFiles.length + selectedFiles.length > TaskEvidenceService.MAX_PER_TASK) {
        throw new Error(`Nhiệm vụ được lưu tối đa ${TaskEvidenceService.MAX_PER_TASK} tệp minh chứng. Hiện đã có ${evidenceFiles.length} tệp.`);
      }
      selectedFiles.forEach(file => DriveEvidenceService.validateFile(file));
      updateUploadStatus({ phase: "SELECTED", percent: 2, message: `Đã chọn ${selectedFiles.length} tệp; sẵn sàng tải khi bấm Lưu.` });
    } catch (error) {
      selectedFiles = [];
      $("evidenceFile").value = "";
      showUploadError(error?.message || "Tệp không hợp lệ.");
    }
  });

  $("saveProgressButton").addEventListener("click", async () => {
    const button = $("saveProgressButton");
    try {
      const formError = $("taskProgressFormError");
      if (formError) { formError.hidden = true; formError.textContent = ""; }
      button.disabled = true;
      uploading = true;
      overlay.querySelectorAll("[data-close]").forEach(item => item.disabled = true);
      button.textContent = "Đang lưu…";

      let evidenceUrl = task.evidenceUrl || task.evidenceLink || "";
      let evidenceFileName = task.evidenceFileName || "";
      let evidenceStoragePath = task.evidenceStoragePath || "";
      const files = [...selectedFiles];
      const uploadedFiles = [];

      if (files.length) {
        for (let index = 0; index < files.length; index += 1) {
          const file = files[index];
          button.textContent = `Đang tải minh chứng ${index + 1}/${files.length}…`;
          const uploaded = await DriveEvidenceService.upload(file, task, {
            onProgress: state => updateUploadStatus({
              ...state,
              message: `[${index + 1}/${files.length}] ${state?.message || "Đang tải minh chứng…"}`
            })
          });
          uploadedFiles.push({ ...uploaded, mimeType: file.type || "", uploadedSize: uploaded.uploadedSize || file.size });
          evidenceUrl = uploaded.fileUrl || evidenceUrl;
          evidenceFileName = uploaded.fileName || file.name || evidenceFileName;
          evidenceStoragePath = uploaded.fileId || uploaded.storagePath || evidenceStoragePath;
        }
        await TaskEvidenceService.addUploadedFiles(task, uploadedFiles, {
          scopeType: monthlyMilestones && currentMilestone ? "MILESTONE" : "TASK",
          scopeId: monthlyMilestones && currentMilestone ? currentMilestone.id : "",
          existingFiles: evidenceFiles
        });
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
      const formError = $("taskProgressFormError");
      if (formError) {
        formError.hidden = false;
        formError.textContent = message;
        formError.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      if (selectedFiles.length) showUploadError(message);
      button.disabled = false;
      button.textContent = normalSaveLabel();
      overlay.querySelectorAll("[data-close]").forEach(item => item.disabled = false);
    }
  });
}

function escapeHtml(value) { return String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;"); }
