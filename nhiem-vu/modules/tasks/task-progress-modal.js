/** Production 3D - modal tiếp nhận/cập nhật tiến độ/minh chứng/hoàn thành. */
import { UserContext } from "../../core/user-context.js";
import { Permissions } from "../../core/permissions.js";
import { TaskWriteService } from "../../services/task-write-service.js";
import { DriveEvidenceService } from "../../services/drive-evidence-service.js";
import { validateProgressInput, cleanText } from "./task-form-validator.js";

function mayUpdate(task) {
  const user = UserContext.requireUser();
  return Permissions.isAdmin() || Permissions.isDirector() ||
    (Permissions.isDepartmentLeader() && task.primaryDepartmentId === user.departmentId) ||
    task.ownerUserId === user.uid || task.createdByUserId === user.uid;
}

export async function openTaskProgressModal(task, { onSaved }) {
  if (!mayUpdate(task)) throw new Error("Bạn không có quyền cập nhật nhiệm vụ này.");
  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop";
  overlay.innerHTML = `
    <section class="modal-panel modal-large" role="dialog" aria-modal="true">
      <div class="modal-header"><div><span class="page-eyebrow">${escapeHtml(task.taskCode || task.id)}</span><h2>Cập nhật nhiệm vụ</h2><p>${escapeHtml(task.title || "")}</p></div><button class="icon-button" type="button" data-close>✕</button></div>
      <div class="modal-body task-form-grid">
        <label><span>Trạng thái</span><select id="progressStatus"><option value="DANG_XU_LY">Đang xử lý</option><option value="TAM_DUNG">Tạm dừng</option><option value="HOAN_THANH">Hoàn thành</option></select></label>
        <label><span>Tiến độ (%)</span><input id="progressValue" type="number" min="0" max="100" step="10" value="${Number(task.progress || 0)}"></label>
        <label class="field-full"><span>Nội dung cập nhật</span><textarea id="progressNote" rows="3" maxlength="3000"></textarea></label>
        <label class="field-full"><span>Kết quả thực hiện</span><textarea id="resultSummary" rows="3" maxlength="5000">${escapeHtml(task.resultSummary || task.result || "")}</textarea></label>
        <label class="field-full"><span>Khó khăn, vướng mắc</span><textarea id="difficulties" rows="2" maxlength="3000">${escapeHtml(task.difficulties || "")}</textarea></label>
        <label class="field-full"><span>Đề xuất hỗ trợ</span><textarea id="proposal" rows="2" maxlength="3000">${escapeHtml(task.proposal || "")}</textarea></label>
        <label class="field-full"><span>Minh chứng dạng nội dung/liên kết</span><textarea id="evidenceText" rows="2" maxlength="3000">${escapeHtml(task.evidenceText || "")}</textarea></label>
        <label class="field-full"><span>Tải tệp/hình ảnh minh chứng lên Google Drive</span><input id="evidenceFile" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"><small>Tối đa 8 MB. Tệp được lưu trong thư mục Drive minh chứng của hệ thống.</small></label>
        ${task.evidenceUrl ? `<div class="field-full info-banner">Tệp hiện tại: <a href="${escapeHtml(task.evidenceUrl)}" target="_blank" rel="noopener">${escapeHtml(task.evidenceFileName || "Mở minh chứng")}</a></div>` : ""}
      </div>
      <div class="modal-footer">${task.ownerUserId === UserContext.getUser()?.uid && task.assignmentStatus !== "DA_TIEP_NHAN" ? '<button id="acceptTaskButton" class="secondary-button" type="button">Tiếp nhận nhiệm vụ</button>' : ''}<button class="secondary-button" type="button" data-close>Hủy</button><button id="saveProgressButton" class="primary-button" type="button">Lưu cập nhật</button></div>
    </section>`;
  document.body.appendChild(overlay);
  const $ = id => overlay.querySelector(`#${id}`);
  const close = () => overlay.remove();
  overlay.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", close));

  $("acceptTaskButton")?.addEventListener("click", async () => {
    const button = $("acceptTaskButton");
    try { button.disabled = true; button.textContent = "Đang tiếp nhận..."; await TaskWriteService.accept(task); close(); await onSaved?.(); }
    catch (error) { window.alert(error?.message || "Không tiếp nhận được nhiệm vụ."); button.disabled = false; button.textContent = "Tiếp nhận nhiệm vụ"; }
  });

  $("progressStatus").addEventListener("change", () => {
    if ($("progressStatus").value === "HOAN_THANH") $("progressValue").value = "100";
  });

  $("saveProgressButton").addEventListener("click", async () => {
    const button = $("saveProgressButton");
    try {
      button.disabled = true;
      button.textContent = "Đang lưu...";
      let evidenceUrl = task.evidenceUrl || task.evidenceLink || "";
      let evidenceFileName = task.evidenceFileName || "";
      let evidenceStoragePath = task.evidenceStoragePath || "";
      const file = $("evidenceFile").files?.[0] || null;
      if (file) {
        button.textContent = "Đang tải minh chứng lên Drive...";
        const uploaded = await DriveEvidenceService.upload(file, task);
        evidenceUrl = uploaded.fileUrl || "";
        evidenceFileName = uploaded.fileName || file.name;
        evidenceStoragePath = uploaded.fileId || "";
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
      await TaskWriteService.updateProgress(task, changes);
      close();
      await onSaved?.();
    } catch (error) {
      window.alert(error?.message || "Không lưu được cập nhật.");
      button.disabled = false;
      button.textContent = "Lưu cập nhật";
    }
  });
}

function escapeHtml(value) { return String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;"); }
