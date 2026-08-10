/**
 * Gửi sự kiện thông báo của phân hệ Chỉ đạo điều hành tới Apps Script riêng.
 * Hoàn toàn độc lập với TaskNotificationService và các collection Nhiệm vụ/KPI.
 */
import { FirebaseService } from "../core/firebase-service.js?v=20260810.V1_10_3";
import { EXECUTIVE_NOTIFICATION_WEB_APP_URL } from "../executive-notification-config.js?v=20260810.V1_10_4";

function clean(value) { return String(value ?? "").trim(); }
function eventId(action, directiveId, provided = "") {
  const fixed = clean(provided);
  if (fixed) return fixed.slice(0, 500);
  return `EXEC_${clean(action).toUpperCase()}_${clean(directiveId)}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
function configured() {
  return Boolean(
    EXECUTIVE_NOTIFICATION_WEB_APP_URL &&
    /^https:\/\/script\.google\.com\/macros\/s\//i.test(EXECUTIVE_NOTIFICATION_WEB_APP_URL) &&
    !EXECUTIVE_NOTIFICATION_WEB_APP_URL.includes("DAN_LINK_WEB_APP")
  );
}

export const ExecutiveNotificationService = Object.freeze({
  isConfigured: configured,

  async send(action, directiveId, eventData = {}, options = {}) {
    const normalizedAction = clean(action).toUpperCase();
    const normalizedDirectiveId = clean(directiveId);
    if (!normalizedAction || !normalizedDirectiveId || !configured()) return false;

    try {
      const current = FirebaseService.auth.currentUser;
      if (!current) return false;
      const idToken = await current.getIdToken();
      const payload = {
        module: "EXECUTIVE_DIRECTIVES",
        action: normalizedAction,
        directiveId: normalizedDirectiveId,
        idToken,
        eventData: eventData && typeof eventData === "object" && !Array.isArray(eventData) ? eventData : {},
        eventId: eventId(normalizedAction, normalizedDirectiveId, options.eventId),
        sentAt: new Date().toISOString()
      };

      await fetch(EXECUTIVE_NOTIFICATION_WEB_APP_URL, {
        method: "POST",
        mode: "no-cors",
        cache: "no-store",
        credentials: "omit",
        keepalive: true,
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify(payload)
      });
      return true;
    } catch (error) {
      console.warn("Không gửi được thông báo Chỉ đạo điều hành:", error);
      return false;
    }
  }
});
