/** Tải minh chứng lên Google Drive qua Google Apps Script Web App. */
import { FirebaseService } from "../core/firebase-service.js?v=20260903.V1_22_2";
import { NOTIFICATION_WEB_APP_URL } from "../notification-config.js?v=20260903.V1_22_2";

const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 180000;
const IMAGE_OPTIMIZE_THRESHOLD = 700 * 1024;
const IMAGE_MAX_EDGE = 1800;
const IMAGE_QUALITY = 0.80;
const ALLOWED = [".pdf", ".jpg", ".jpeg", ".png", ".webp", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt"];
const preparedFiles = new WeakMap();
const activeUploads = new Map();

function validateFile(file) {
  if (!file) throw new Error("Vui lòng chọn tệp hoặc hình ảnh minh chứng.");
  if (file.size <= 0) throw new Error("Tệp đã chọn không có dữ liệu.");
  if (file.size > MAX_BYTES) throw new Error("Dung lượng tệp không được vượt quá 8 MB.");
  const name = String(file.name || "").toLowerCase();
  if (!ALLOWED.some(ext => name.endsWith(ext))) {
    throw new Error("Chỉ hỗ trợ PDF, hình ảnh, Word, Excel, PowerPoint hoặc TXT.");
  }
}

function report(onProgress, phase, percent, message, detail = {}) {
  try {
    onProgress?.({ phase, percent, message, ...detail });
  } catch (_) {
    /* Không để lỗi giao diện làm gián đoạn tải tệp. */
  }
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

function fileStem(name) {
  return String(name || "minh-chung").replace(/\.[^.]+$/, "");
}

function isOptimizableImage(file) {
  return Boolean(
    file &&
    /^image\/(jpeg|jpg|png|webp)$/i.test(String(file.type || "")) &&
    file.size >= IMAGE_OPTIMIZE_THRESHOLD
  );
}

async function imageBitmapFromFile(file) {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file, { imageOrientation: "from-image" });
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Không đọc được hình ảnh minh chứng."));
      element.src = objectUrl;
    });
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error("Không thể tối ưu hình ảnh minh chứng.")),
      type,
      quality
    );
  });
}

async function optimizeImage(file, onProgress) {
  if (!isOptimizableImage(file)) {
    return { file, optimized: false, originalSize: file.size, uploadedSize: file.size };
  }

  report(onProgress, "OPTIMIZING", 8, "Đang tối ưu hình ảnh trước khi tải lên…");
  const bitmap = await imageBitmapFromFile(file);
  try {
    const width = Number(bitmap.width || bitmap.naturalWidth || 0);
    const height = Number(bitmap.height || bitmap.naturalHeight || 0);
    if (!width || !height) return { file, optimized: false, originalSize: file.size, uploadedSize: file.size };

    const scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return { file, optimized: false, originalSize: file.size, uploadedSize: file.size };

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, targetWidth, targetHeight);
    context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);

    const outputType = "image/webp";
    const blob = await canvasBlob(canvas, outputType, IMAGE_QUALITY);
    if (blob.size >= file.size * 0.92 || blob.size > MAX_BYTES) {
      return { file, optimized: false, originalSize: file.size, uploadedSize: file.size };
    }

    const optimizedFile = new File(
      [blob],
      `${fileStem(file.name)}.webp`,
      { type: outputType, lastModified: Date.now() }
    );
    report(onProgress, "OPTIMIZED", 15, `Đã giảm dung lượng từ ${formatBytes(file.size)} xuống ${formatBytes(optimizedFile.size)}.`, {
      originalSize: file.size,
      uploadedSize: optimizedFile.size,
      optimized: true
    });
    return { file: optimizedFile, optimized: true, originalSize: file.size, uploadedSize: optimizedFile.size };
  } finally {
    if (typeof bitmap.close === "function") bitmap.close();
  }
}

async function prepare(file, options = {}) {
  validateFile(file);
  if (!preparedFiles.has(file)) {
    preparedFiles.set(file, optimizeImage(file, options.onProgress).catch(error => {
      console.warn("Không tối ưu được hình ảnh, hệ thống sẽ tải tệp gốc:", error);
      return { file, optimized: false, originalSize: file.size, uploadedSize: file.size };
    }));
  }
  const prepared = await preparedFiles.get(file);
  validateFile(prepared.file);
  return prepared;
}

function readBase64(file, onProgress) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadstart = () => report(onProgress, "READING", 18, "Đang chuẩn bị dữ liệu tệp…");
    reader.onprogress = event => {
      if (!event.lengthComputable) return;
      const ratio = event.loaded / event.total;
      report(onProgress, "READING", Math.round(18 + ratio * 12), "Đang chuẩn bị dữ liệu tệp…");
    };
    reader.onload = () => {
      const value = String(reader.result || "");
      const comma = value.indexOf(",");
      resolve(comma >= 0 ? value.slice(comma + 1) : value);
    };
    reader.onerror = () => reject(new Error("Không đọc được tệp đã chọn."));
    reader.readAsDataURL(file);
  });
}

function randomToken() {
  const values = new Uint32Array(8);
  crypto.getRandomValues(values);
  return Array.from(values, value => value.toString(36)).join("");
}

function requestId() {
  return `TASK_UPLOAD_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function uploadKey(file, task) {
  return [task?.id || "", file.name, file.size, file.lastModified].join("|");
}

async function performUpload(originalFile, task, options = {}) {
  validateFile(originalFile);
  if (!NOTIFICATION_WEB_APP_URL || NOTIFICATION_WEB_APP_URL.includes("DAN_LINK_WEB_APP")) {
    throw new Error("Chưa cấu hình URL Apps Script tải minh chứng lên Google Drive.");
  }
  if (!FirebaseService.auth.currentUser || !task?.id) {
    throw new Error("Phiên đăng nhập hoặc nhiệm vụ không hợp lệ.");
  }

  const prepared = await prepare(originalFile, options);
  const file = prepared.file;
  report(options.onProgress, "AUTHENTICATING", 31, "Đang xác thực quyền tải minh chứng…", prepared);
  const idToken = await FirebaseService.auth.currentUser.getIdToken(false);
  const base64Data = await readBase64(file, options.onProgress);
  const currentRequestId = requestId();
  const pollToken = randomToken();

  report(options.onProgress, "UPLOADING", 35, "Đang gửi minh chứng lên Google Drive…", prepared);

  return new Promise((resolve, reject) => {
    const frameName = `evidenceFrame_${currentRequestId}`;
    const iframe = document.createElement("iframe");
    const form = document.createElement("form");
    const input = document.createElement("input");
    const pendingScripts = new Set();
    const pendingCallbacks = new Set();
    let settled = false;
    let pollTimer = null;
    let pollDelay = 1500;
    const startedAt = Date.now();

    iframe.name = frameName;
    iframe.className = "hidden-upload-frame";
    iframe.setAttribute("aria-hidden", "true");

    form.method = "POST";
    form.action = NOTIFICATION_WEB_APP_URL;
    form.target = frameName;
    form.acceptCharset = "UTF-8";
    form.style.display = "none";

    input.type = "hidden";
    input.name = "payload";
    input.value = JSON.stringify({
      action: "UPLOAD_TASK_EVIDENCE",
      requestId: currentRequestId,
      pollToken,
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
      window.clearTimeout(timeoutTimer);
      window.clearTimeout(pollTimer);
      pendingScripts.forEach(script => script.remove());
      pendingCallbacks.forEach(name => { try { delete window[name]; } catch (_) { window[name] = undefined; } });
      form.remove();
      iframe.remove();
    };

    const finish = callback => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };

    const finishFromData = data => {
      if (data?.ok === true && data.fileUrl) {
        report(options.onProgress, "COMPLETED", 100, "Đã tải minh chứng lên Google Drive.", prepared);
        finish(() => resolve({ ...data, optimized: prepared.optimized, originalSize: prepared.originalSize, uploadedSize: prepared.uploadedSize }));
      } else {
        finish(() => reject(new Error(data?.error || "Không tải được tệp lên Google Drive.")));
      }
    };

    const onMessage = event => {
      const data = event?.data;
      if (!data || data.source !== "TASK_EVIDENCE_UPLOAD" || data.requestId !== currentRequestId) return;
      finishFromData(data);
    };

    const poll = () => {
      if (settled) return;
      if (Date.now() - startedAt > TIMEOUT_MS) {
        finish(() => reject(new Error("Quá thời gian tải tệp lên Google Drive.")));
        return;
      }

      const elapsed = Date.now() - startedAt;
      const percent = Math.min(94, 38 + Math.round((elapsed / TIMEOUT_MS) * 56));
      report(options.onProgress, "PROCESSING", percent, "Google Drive đang xử lý và tạo liên kết minh chứng…", prepared);

      const callbackName = `taskEvidenceCallback_${currentRequestId.replace(/[^A-Za-z0-9_$]/g, "_")}_${Date.now()}`;
      const script = document.createElement("script");
      pendingScripts.add(script);
      pendingCallbacks.add(callbackName);

      const release = () => {
        pendingScripts.delete(script);
        pendingCallbacks.delete(callbackName);
        script.remove();
        try { delete window[callbackName]; } catch (_) { window[callbackName] = undefined; }
      };

      window[callbackName] = data => {
        release();
        if (data?.ready === true) {
          finishFromData(data);
          return;
        }
        if (!settled) {
          pollDelay = Math.min(5000, Math.round(pollDelay * 1.45));
          pollTimer = window.setTimeout(poll, pollDelay);
        }
      };

      script.onerror = () => {
        release();
        if (!settled) {
          pollDelay = Math.min(5000, Math.round(pollDelay * 1.6));
          pollTimer = window.setTimeout(poll, pollDelay);
        }
      };
      script.src = `${NOTIFICATION_WEB_APP_URL}?action=TASK_EVIDENCE_GET_RESULT&requestId=${encodeURIComponent(currentRequestId)}&pollToken=${encodeURIComponent(pollToken)}&callback=${encodeURIComponent(callbackName)}&_=${Date.now()}`;
      document.head.appendChild(script);
    };

    window.addEventListener("message", onMessage);
    const timeoutTimer = window.setTimeout(
      () => finish(() => reject(new Error("Quá thời gian tải tệp lên Google Drive."))),
      TIMEOUT_MS
    );
    document.body.append(iframe, form);
    form.submit();
    pollTimer = window.setTimeout(poll, 1500);
  });
}


async function performTrash(evidence, task, options = {}) {
  const fileId = String(evidence?.driveFileId || evidence?.fileId || evidence?.storagePath || evidence?.evidenceStoragePath || "").trim();
  if (!fileId) throw new Error("Không xác định được tệp Google Drive cần gỡ.");
  if (!NOTIFICATION_WEB_APP_URL || NOTIFICATION_WEB_APP_URL.includes("DAN_LINK_WEB_APP")) {
    throw new Error("Chưa cấu hình URL Apps Script quản lý minh chứng Google Drive.");
  }
  if (!FirebaseService.auth.currentUser || !task?.id) {
    throw new Error("Phiên đăng nhập hoặc nhiệm vụ không hợp lệ.");
  }

  const idToken = await FirebaseService.auth.currentUser.getIdToken(false);
  const currentRequestId = `TASK_TRASH_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const pollToken = randomToken();
  report(options.onProgress, "REMOVING", 10, "Đang gỡ tệp khỏi Google Drive…");

  return new Promise((resolve, reject) => {
    const frameName = `evidenceTrashFrame_${currentRequestId}`;
    const iframe = document.createElement("iframe");
    const form = document.createElement("form");
    const input = document.createElement("input");
    const pendingScripts = new Set();
    const pendingCallbacks = new Set();
    let settled = false;
    let pollTimer = null;
    let pollDelay = 1200;
    const startedAt = Date.now();

    iframe.name = frameName;
    iframe.className = "hidden-upload-frame";
    iframe.setAttribute("aria-hidden", "true");
    form.method = "POST";
    form.action = NOTIFICATION_WEB_APP_URL;
    form.target = frameName;
    form.acceptCharset = "UTF-8";
    form.style.display = "none";
    input.type = "hidden";
    input.name = "payload";
    input.value = JSON.stringify({
      action: "TRASH_TASK_EVIDENCE",
      requestId: currentRequestId,
      pollToken,
      taskId: task.id,
      taskCode: task.taskCode || "",
      idToken,
      fileId
    });
    form.appendChild(input);

    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timeoutTimer);
      window.clearTimeout(pollTimer);
      pendingScripts.forEach(script => script.remove());
      pendingCallbacks.forEach(name => { try { delete window[name]; } catch (_) { window[name] = undefined; } });
      form.remove();
      iframe.remove();
    };
    const finish = callback => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const finishFromData = data => {
      if (data?.ok === true) {
        report(options.onProgress, "REMOVED", 100, "Đã gỡ tệp khỏi Google Drive.");
        finish(() => resolve(data));
      } else {
        finish(() => reject(new Error(data?.error || "Không gỡ được tệp khỏi Google Drive.")));
      }
    };
    const onMessage = event => {
      const data = event?.data;
      if (!data || data.source !== "TASK_EVIDENCE_UPLOAD" || data.requestId !== currentRequestId) return;
      finishFromData(data);
    };
    const poll = () => {
      if (settled) return;
      if (Date.now() - startedAt > TIMEOUT_MS) {
        finish(() => reject(new Error("Quá thời gian gỡ tệp khỏi Google Drive.")));
        return;
      }
      const callbackName = `taskEvidenceTrashCallback_${currentRequestId.replace(/[^A-Za-z0-9_$]/g, "_")}_${Date.now()}`;
      const script = document.createElement("script");
      pendingScripts.add(script);
      pendingCallbacks.add(callbackName);
      const release = () => {
        pendingScripts.delete(script);
        pendingCallbacks.delete(callbackName);
        script.remove();
        try { delete window[callbackName]; } catch (_) { window[callbackName] = undefined; }
      };
      window[callbackName] = data => {
        release();
        if (data?.ready === true) {
          finishFromData(data);
          return;
        }
        if (!settled) {
          pollDelay = Math.min(4000, Math.round(pollDelay * 1.4));
          pollTimer = window.setTimeout(poll, pollDelay);
        }
      };
      script.onerror = () => {
        release();
        if (!settled) pollTimer = window.setTimeout(poll, Math.min(4000, Math.round(pollDelay * 1.5)));
      };
      script.src = `${NOTIFICATION_WEB_APP_URL}?action=TASK_EVIDENCE_GET_RESULT&requestId=${encodeURIComponent(currentRequestId)}&pollToken=${encodeURIComponent(pollToken)}&callback=${encodeURIComponent(callbackName)}&_=${Date.now()}`;
      document.head.appendChild(script);
    };

    window.addEventListener("message", onMessage);
    const timeoutTimer = window.setTimeout(
      () => finish(() => reject(new Error("Quá thời gian gỡ tệp khỏi Google Drive."))),
      TIMEOUT_MS
    );
    document.body.append(iframe, form);
    form.submit();
    pollTimer = window.setTimeout(poll, 1200);
  });
}

export const DriveEvidenceService = Object.freeze({
  validateFile,
  prepare,
  formatBytes,

  async upload(file, task, options = {}) {
    const key = uploadKey(file, task);
    if (activeUploads.has(key)) return activeUploads.get(key);
    const promise = performUpload(file, task, options).finally(() => activeUploads.delete(key));
    activeUploads.set(key, promise);
    return promise;
  },

  async trash(evidence, task, options = {}) {
    return performTrash(evidence, task, options);
  }
});
