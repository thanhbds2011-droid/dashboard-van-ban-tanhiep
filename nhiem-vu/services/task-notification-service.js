/**
 * V1.23.2 — NOTIFICATIONS OFF.
 *
 * Toàn bộ Push/Notification Center đã được tắt theo yêu cầu production.
 * Giữ nguyên public API để các luồng nghiệp vụ cũ không phải thay đổi call-site.
 * Hàm send() không đọc/ghi Firestore, không lấy ID token và không gọi Apps Script.
 */
const DISABLED_RESULT = true;

export const TaskNotificationService = Object.freeze({
  async send() {
    return DISABLED_RESULT;
  },

  pendingCount() {
    return 0;
  }
});
