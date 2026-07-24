/** Production 3D - tải minh chứng lên Google Drive qua Apps Script Web App. */
import { FirebaseService } from "../core/firebase-service.js";
import { NOTIFICATION_WEB_APP_URL } from "../notification-config.js";

const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 180000;
const ALLOWED = [".pdf", ".jpg", ".jpeg", ".png", ".webp", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt"];

function validateFile(file) {
  if (!file) throw new Error("Vui lòng chọn tệp hoặc hình ảnh minh chứng.");
  if (file.size <= 0) throw new Error("Tệp đã chọn không có dữ liệu.");
  if (file.size > MAX_BYTES) throw new Error("Dung lượng tệp không được vượt quá 8 MB.");
  const name = String(file.name || "").toLowerCase();
  if (!ALLOWED.some(ext => name.endsWith(ext))) {
    throw new Error("Chỉ hỗ trợ PDF, hình ảnh, Word, Excel, PowerPoint hoặc TXT.");
  }
}

function readBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result || "");
      const comma = value.indexOf(",");
      resolve(comma >= 0 ? value.slice(comma + 1) : value);
    };
    reader.onerror = () => reject(new Error("Không đọc được tệp đã chọn."));
    reader.readAsDataURL(file);
  });
}

function requestId() {
  return `TASK_UPLOAD_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export const DriveEvidenceService = Object.freeze({
  validateFile,

  async upload(file, task) {
    validateFile(file);
    if (!NOTIFICATION_WEB_APP_URL || NOTIFICATION_WEB_APP_URL.includes("DAN_LINK_WEB_APP")) {
      throw new Error("Chưa cấu hình URL Apps Script tải minh chứng lên Google Drive.");
    }
    if (!FirebaseService.auth.currentUser || !task?.id) {
      throw new Error("Phiên đăng nhập hoặc nhiệm vụ không hợp lệ.");
    }

    const idToken = await FirebaseService.auth.currentUser.getIdToken();
    const base64Data = await readBase64(file);
    const currentRequestId = requestId();

    return new Promise((resolve, reject) => {
      const frameName = `evidenceFrame_${currentRequestId}`;
      const iframe = document.createElement("iframe");
      const form = document.createElement("form");
      const input = document.createElement("input");
      let settled = false;

      iframe.name = frameName;
      iframe.className = "hidden-upload-frame";
      iframe.setAttribute("aria-hidden", "true");

      form.method = "POST";
      form.action = NOTIFICATION_WEB_APP_URL;
      form.target = frameName;
      form.style.display = "none";

      input.type = "hidden";
      input.name = "payload";
      input.value = JSON.stringify({
        action: "UPLOAD_TASK_EVIDENCE",
        requestId: currentRequestId,
        taskId: task.id,
        taskCode: task.taskCode || "",
        idToken,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        base64Data
      });
      form.appendChild(input);

      const cleanup = () => {
        window.removeEventListener("message", onMessage);
        window.clearTimeout(timer);
        form.remove();
        iframe.remove();
      };
      const finish = callback => {
        if (settled) return;
        settled = true;
        cleanup();
        callback();
      };
      const onMessage = event => {
        const data = event?.data;
        if (!data || data.source !== "TASK_EVIDENCE_UPLOAD" || data.requestId !== currentRequestId) return;
        if (data.ok === true && data.fileUrl) finish(() => resolve(data));
        else finish(() => reject(new Error(data.error || "Không tải được tệp lên Google Drive.")));
      };

      window.addEventListener("message", onMessage);
      const timer = window.setTimeout(() => finish(() => reject(new Error("Quá thời gian tải tệp lên Google Drive."))), TIMEOUT_MS);
      document.body.append(iframe, form);
      form.submit();
    });
  }
});
