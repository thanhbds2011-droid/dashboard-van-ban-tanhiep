/** Gọi Apps Script thông báo theo cơ chế không chặn thao tác chính - V1.10.0. */
import { FirebaseService } from "../core/firebase-service.js?v=20260808.V1_10_1";
import { NOTIFICATION_WEB_APP_URL } from "../notification-config.js?v=20260808.V1_10_1";

export const TaskNotificationService = Object.freeze({
  async send(action, taskId, eventData = {}, options = {}) {
    if (!taskId || !action || !NOTIFICATION_WEB_APP_URL || NOTIFICATION_WEB_APP_URL.includes("DAN_LINK_WEB_APP")) {
      return false;
    }
    try {
      const current = FirebaseService.auth.currentUser;
      if (!current) return false;
      const idToken = await current.getIdToken();
      await fetch(NOTIFICATION_WEB_APP_URL, {
        method: "POST",
        mode: "no-cors",
        cache: "no-store",
        keepalive: true,
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify({
          action,
          taskId,
          idToken,
          eventData: eventData && typeof eventData === "object" ? eventData : {},
          eventId: String(options?.eventId || `${action}_${taskId}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`),
          sentAt: new Date().toISOString()
        })
      });
      return true;
    } catch (error) {
      console.warn("Không gửi được thông báo nền:", error);
      return false;
    }
  }
});
