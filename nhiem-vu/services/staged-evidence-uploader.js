/**
 * Hàng đợi minh chứng V1.17.0.
 * - Chọn tệp chỉ giữ cục bộ trong trình duyệt, CHƯA tải lên Google Drive.
 * - Chỉ khi người dùng bấm Lưu, uploadPending() mới bắt đầu tải tệp.
 * - Bấm × trước khi Lưu chỉ loại tệp khỏi danh sách, không gọi Drive.
 * - Nếu lưu nghiệp vụ thất bại sau khi upload, rollbackUncommitted() đưa các tệp vừa tải vào Thùng rác Drive.
 */
import { DriveEvidenceService } from "./drive-evidence-service.js?v=20260825.V1_18_0";
import { TaskEvidenceService } from "./task-evidence-service.js?v=20260825.V1_18_0";

function id() {
  return `STAGED_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export class StagedEvidenceUploader {
  constructor(task, { existingCount = 0, onChange = null } = {}) {
    this.task = task;
    this.existingCount = Math.max(0, Number(existingCount || 0));
    this.onChange = typeof onChange === "function" ? onChange : null;
    this.items = [];
    this.closed = false;
  }

  snapshot() {
    return this.items.map(item => ({ ...item }));
  }

  notify() {
    try { this.onChange?.(this.snapshot()); } catch (_) { /* UI không được làm hỏng luồng lưu. */ }
  }

  get busy() {
    return this.items.some(item => ["UPLOADING", "ROLLING_BACK"].includes(item.status));
  }

  get uploaded() {
    return this.items.filter(item => item.status === "UPLOADED" && item.uploaded).map(item => item.uploaded);
  }

  get uploadedItems() {
    return this.items.filter(item => item.status === "UPLOADED" && item.uploaded);
  }

  get selectedCount() {
    return this.items.filter(item => !["DISCARDED", "REMOVED"].includes(item.status)).length;
  }

  async addFiles(fileList) {
    if (this.closed) throw new Error("Biểu mẫu đã đóng.");
    const files = Array.from(fileList || []);
    if (!files.length) return;
    if (files.length > TaskEvidenceService.MAX_PER_SELECTION) {
      throw new Error(`Mỗi lần chỉ được chọn tối đa ${TaskEvidenceService.MAX_PER_SELECTION} tệp.`);
    }
    const activeStaged = this.selectedCount;
    if (this.existingCount + activeStaged + files.length > TaskEvidenceService.MAX_PER_TASK) {
      throw new Error(`Nhiệm vụ được lưu tối đa ${TaskEvidenceService.MAX_PER_TASK} tệp minh chứng. Hiện đã có ${this.existingCount} tệp đã lưu.`);
    }
    files.forEach(file => DriveEvidenceService.validateFile(file));
    files.forEach(file => this.items.push({
      id: id(),
      file,
      originalName: file.name || "Tệp minh chứng",
      status: "SELECTED",
      phase: "LOCAL",
      percent: 0,
      message: "Đã chọn · Chưa lưu",
      uploaded: null,
      error: "",
      committed: false
    }));
    this.notify();
  }

  async uploadPending() {
    if (this.closed) throw new Error("Biểu mẫu đã đóng.");
    const candidates = this.items.filter(item => ["SELECTED", "ERROR"].includes(item.status) && !item.committed);
    for (const item of candidates) {
      item.status = "UPLOADING";
      item.phase = "PREPARING";
      item.percent = 0;
      item.error = "";
      item.message = "Đang chuẩn bị tệp…";
      this.notify();
      try {
        const uploaded = await DriveEvidenceService.upload(item.file, this.task, {
          onProgress: state => {
            item.phase = state?.phase || "UPLOADING";
            item.percent = Math.max(0, Math.min(100, Number(state?.percent || 0)));
            item.message = state?.message || "Đang tải minh chứng…";
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
        item.message = "Đã tải · Đang hoàn tất lưu";
        this.notify();
      } catch (error) {
        item.status = "ERROR";
        item.phase = "ERROR";
        item.error = error?.message || "Không tải được tệp.";
        item.message = item.error;
        this.notify();
        throw error;
      }
    }
    return this.uploaded;
  }

  async retry(itemId) {
    const item = this.items.find(entry => entry.id === itemId);
    if (!item || item.status !== "ERROR") return;
    item.status = "SELECTED";
    item.error = "";
    item.percent = 0;
    item.phase = "LOCAL";
    item.message = "Đã chọn · Chưa lưu";
    this.notify();
  }

  async remove(itemId) {
    const item = this.items.find(entry => entry.id === itemId);
    if (!item || item.committed) return;
    if (item.status === "UPLOADING" || item.status === "ROLLING_BACK") {
      throw new Error("Tệp đang được xử lý. Vui lòng chờ thao tác hoàn tất.");
    }
    if (item.status === "UPLOADED" && item.uploaded) {
      // Chỉ có thể xảy ra trong lúc thao tác Lưu đang xử lý. Dọn an toàn trước khi bỏ.
      item.status = "ROLLING_BACK";
      item.message = "Đang hoàn tác tệp…";
      this.notify();
      try {
        await DriveEvidenceService.trash(item.uploaded, this.task);
      } finally {
        item.uploaded = null;
        item.status = "DISCARDED";
        item.message = "Đã bỏ";
        this.notify();
      }
      return;
    }
    item.status = "DISCARDED";
    item.message = "Đã bỏ";
    this.notify();
  }

  markCommitted(uploadedFiles = []) {
    const ids = new Set((uploadedFiles || []).map(file => String(file?.fileId || file?.driveFileId || file?.storagePath || "")).filter(Boolean));
    this.items.forEach(item => {
      const fileId = String(item.uploaded?.fileId || item.uploaded?.driveFileId || item.uploaded?.storagePath || "");
      if (item.status === "UPLOADED" && (!ids.size || ids.has(fileId))) {
        item.committed = true;
        item.message = "Đã lưu";
      }
    });
    this.notify();
  }

  async rollbackUncommitted() {
    for (const item of this.items) {
      if (item.committed || item.status !== "UPLOADED" || !item.uploaded) continue;
      item.status = "ROLLING_BACK";
      item.message = "Đang hoàn tác tệp…";
      this.notify();
      try {
        await DriveEvidenceService.trash(item.uploaded, this.task);
        item.uploaded = null;
        item.status = "SELECTED";
        item.phase = "LOCAL";
        item.percent = 0;
        item.error = "";
        item.message = "Đã chọn · Chưa lưu";
      } catch (error) {
        item.status = "ERROR";
        item.phase = "ERROR";
        item.error = error?.message || "Không hoàn tác được tệp đã tải.";
        item.message = item.error;
      }
      this.notify();
    }
  }

  async cleanup() {
    this.closed = true;
    await this.rollbackUncommitted();
    this.items.forEach(item => {
      if (!item.committed && ["SELECTED", "ERROR"].includes(item.status)) {
        item.status = "DISCARDED";
      }
    });
    this.notify();
  }
}
