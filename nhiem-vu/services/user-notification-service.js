/**
 * V1.24.1 — NOTIFICATION CENTER OFF.
 *
 * Public API được giữ nguyên để Evidence / Registration / Work Item không bị lỗi import.
 * Không tạo userNotifications, không mở onSnapshot, không mark read.
 */
export const UserNotificationService = Object.freeze({
  subscribeCurrentUser(onData) {
    try { onData?.([]); } catch (_) { /* no-op */ }
    return () => {};
  },

  async markRead() {
    return false;
  },

  async markAllRead() {
    return 0;
  },

  async notifyTaskAction() {
    return false;
  },

  async notifyRegistrationDecision() {
    return false;
  }
});
