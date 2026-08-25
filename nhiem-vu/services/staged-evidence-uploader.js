/**
 * Hàng đợi minh chứng V1.16.0.
 * - Chọn tệp -> tải Drive ngay, không chờ nút Lưu.
 * - Có thể gỡ từng tệp trước khi Lưu; tệp đã tải sẽ được đưa vào Thùng rác Drive.
 * - Nếu Lưu nghiệp vụ lỗi, tệp đã tải vẫn giữ trong hàng đợi để người dùng thử Lưu lại mà không upload lần hai.
 */
import { DriveEvidenceService } from "./drive-evidence-service.js?v=20260825.V1_16_1";
import { TaskEvidenceService } from "./task-evidence-service.js?v=20260825.V1_16_1";

function id() {
  return `STAGED_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export class StagedEvidenceUploader {
  constructor(task, { existingCount = 0, onChange = null } = {}) {
    this.task = task;
    this.existingCount = Math.max(0, Number(existingCount || 0));
    this.onChange = typeof onChange === "function" ? onChange : null;
    this.items = [];
    this.runner = null;
    this.closed = false;
  }

  snapshot() {
    return this.items.map(item => ({ ...item }));
  }

  notify() {
    try { this.onChange?.(this.snapshot()); } catch (_) { /* UI không được làm hỏng upload. */ }
  }

  get busy() {
    return this.items.some(item => ["QUEUED", "UPLOADING", "REMOVING"].includes(item.status));
  }

  get uploaded() {
    return this.items.filter(item => item.status === "UPLOADED" && item.uploaded).map(item => item.uploaded);
  }

  get uploadedItems() {
    return this.items.filter(item => item.status === "UPLOADED" && item.uploaded);
  }

  async addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    if (files.length > TaskEvidenceService.MAX_PER_SELECTION) {
      throw new Error(`Mỗi lần chỉ được chọn tối đa ${TaskEvidenceService.MAX_PER_SELECTION} tệp.`);
    }
    const activeStaged = this.items.filter(item => !["REMOVED", "DISCARDED"].includes(item.status)).length;
    if (this.existingCount + activeStaged + files.length > TaskEvidenceService.MAX_PER_TASK) {
      throw new Error(`Nhiệm vụ được lưu tối đa ${TaskEvidenceService.MAX_PER_TASK} tệp minh chứng. Hiện đã có ${this.existingCount} tệp đã lưu.`);
    }
    files.forEach(file => DriveEvidenceService.validateFile(file));
    files.forEach(file => this.items.push({
      id: id(),
      file,
      originalName: file.name || "Tệp minh chứng",
      status: "QUEUED",
      phase: "QUEUED",
      percent: 0,
      message: "Đang chờ tải lên…",
      uploaded: null,
      error: "",
      cancelRequested: false,
      committed: false
    }));
    this.notify();
    this.start();
  }

  start() {
    if (this.runner) return this.runner;
    this.runner = this.run().finally(() => {
      this.runner = null;
      this.notify();
      if (this.items.some(item => item.status === "QUEUED")) this.start();
    });
    return this.runner;
  }

  async run() {
    while (!this.closed) {
      const item = this.items.find(entry => entry.status === "QUEUED");
      if (!item) break;
      if (item.cancelRequested) {
        item.status = "DISCARDED";
        this.notify();
        continue;
      }
      item.status = "UPLOADING";
      item.message = "Đang chuẩn bị tệp…";
      this.notify();
      try {
        const uploaded = await DriveEvidenceService.upload(item.file, this.task, {
          onProgress: state => {
            item.phase = state?.phase || "UPLOADING";
            item.percent = Math.max(0, Math.min(100, Number(state?.percent || 0)));
            item.message = state?.message || "Đang tải lên Google Drive…";
            item.optimized = state?.optimized === true;
            item.originalSize = Number(state?.originalSize || item.file?.size || 0);
            item.uploadedSize = Number(state?.uploadedSize || 0);
            this.notify();
          }
        });
        item.uploaded = {
          ...uploaded,
          mimeType: item.file?.type || uploaded?.mimeType || "",
          uploadedSize: uploaded?.uploadedSize || uploaded?.sizeBytes || item.file?.size || 0
        };
        item.percent = 100;
        item.phase = "COMPLETED";
        item.status = "UPLOADED";
        item.message = "Đã tải lên Google Drive";
        this.notify();
        if (item.cancelRequested) await this.remove(item.id);
      } catch (error) {
        item.status = item.cancelRequested ? "DISCARDED" : "ERROR";
        item.phase = "ERROR";
        item.error = error?.message || "Không tải được tệp.";
        item.message = item.error;
        this.notify();
      }
    }
  }

  async retry(itemId) {
    const item = this.items.find(entry => entry.id === itemId);
    if (!item || item.status !== "ERROR") return;
    item.status = "QUEUED";
    item.error = "";
    item.percent = 0;
    item.message = "Đang chờ tải lại…";
    this.notify();
    await this.start();
  }

  async remove(itemId) {
    const item = this.items.find(entry => entry.id === itemId);
    if (!item || item.committed) return;
    if (item.status === "QUEUED" || item.status === "ERROR") {
      item.status = "DISCARDED";
      this.notify();
      return;
    }
    if (item.status === "UPLOADING") {
      item.cancelRequested = true;
      item.message = "Sẽ gỡ ngay khi tải xong…";
      this.notify();
      return;
    }
    if (item.status === "UPLOADED" && item.uploaded) {
      item.status = "REMOVING";
      item.message = "Đang gỡ khỏi Google Drive…";
      this.notify();
      try {
        await DriveEvidenceService.trash(item.uploaded, this.task);
        item.status = "DISCARDED";
        item.message = "Đã gỡ";
      } catch (error) {
        item.status = "UPLOADED";
        item.error = error?.message || "Không gỡ được tệp khỏi Google Drive.";
        item.message = item.error;
        throw error;
      } finally {
        this.notify();
      }
    }
  }

  markCommitted(uploadedFiles = []) {
    const ids = new Set((uploadedFiles || []).map(file => String(file?.fileId || file?.driveFileId || file?.storagePath || "")).filter(Boolean));
    this.items.forEach(item => {
      const fileId = String(item.uploaded?.fileId || item.uploaded?.driveFileId || item.uploaded?.storagePath || "");
      if (item.status === "UPLOADED" && (!ids.size || ids.has(fileId))) item.committed = true;
    });
    this.notify();
  }

  async cleanup() {
    this.closed = true;
    this.items.forEach(item => {
      if (["QUEUED", "UPLOADING"].includes(item.status) && !item.committed) item.cancelRequested = true;
    });
    if (this.runner) {
      try { await this.runner; } catch (_) { /* cleanup best effort */ }
    }
    for (const item of this.items) {
      if (item.committed || item.status !== "UPLOADED" || !item.uploaded) continue;
      try {
        item.status = "REMOVING";
        this.notify();
        await DriveEvidenceService.trash(item.uploaded, this.task);
        item.status = "DISCARDED";
      } catch (_) {
        // Không chặn đóng modal nếu Drive tạm thời lỗi; file chưa được gắn Firestore và có thể dọn thủ công.
        item.status = "ERROR";
      }
      this.notify();
    }
  }
}
