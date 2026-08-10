/**
 * Gọi Apps Script thông báo nền - V1.10.2.
 *
 * Nguyên tắc:
 * - Không chặn thao tác nghiệp vụ chính nếu gateway tạm thời lỗi.
 * - eventId phải ổn định khi sự kiện đã có taskLog để Apps Script chống gửi trùng.
 * - mode no-cors được giữ để tương thích Google Apps Script Web App production.
 */
import { FirebaseService } from "../core/firebase-service.js?v=20260810.V1_10_6";
import { NOTIFICATION_WEB_APP_URL } from "../notification-config.js?v=20260810.V1_10_6";

function clean(value) {
  return String(value ?? "").trim();
}

function buildEventId(action, taskId, eventId = "") {
  const provided = clean(eventId);
  if (provided) return provided.slice(0, 500);
  return `${clean(action)}_${clean(taskId)}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export const TaskNotificationService = Object.freeze({
  async send(action, taskId, eventData = {}, options = {}) {
    const normalizedAction = clean(action).toUpperCase();
    const normalizedTaskId = clean(taskId);
    if (
      !normalizedTaskId ||
      !normalizedAction ||
      !NOTIFICATION_WEB_APP_URL ||
      NOTIFICATION_WEB_APP_URL.includes("DAN_LINK_WEB_APP")
    ) {
      return false;
    }

    try {
      const current = FirebaseService.auth.currentUser;
      if (!current) return false;

      const idToken = await current.getIdToken();
      const payload = {
        action: normalizedAction,
        taskId: normalizedTaskId,
        idToken,
        eventData: eventData && typeof eventData === "object" && !Array.isArray(eventData)
          ? eventData
          : {},
        eventId: buildEventId(normalizedAction, normalizedTaskId, options?.eventId),
        sentAt: new Date().toISOString()
      };

      await fetch(NOTIFICATION_WEB_APP_URL, {
        method: "POST",
        mode: "no-cors",
        cache: "no-store",
        credentials: "omit",
        keepalive: true,
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify(payload)
      });

      // no-cors không cho đọc response. true ở đây chỉ có nghĩa yêu cầu đã được
      // trình duyệt xếp gửi; Apps Script/OneSignal vẫn là nơi quyết định giao thành công.
      return true;
    } catch (error) {
      console.warn("Không gửi được yêu cầu thông báo nền:", error);
      return false;
    }
  }
});
