/**
 * Thông báo riêng cho Chỉ đạo điều hành V1.11.1 - non-blocking dispatch.
 * Không dùng taskLogs, taskPushSubscriptions hoặc TaskNotificationService.
 */
import { FirebaseService } from "../core/firebase-service.js?v=20260904.V1_23_0";
import { EXECUTIVE_NOTIFICATION_WEB_APP_URL } from "../executive-notification-config.js?v=20260904.V1_23_0";

const LOGS = "executiveNotificationLogs";
function clean(value) { return String(value ?? "").trim(); }
function buildEventId(action, directiveId, provided = "") {
  const fixed = clean(provided);
  if (fixed) return fixed.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 180);
  return `EXEC_${clean(action).toUpperCase()}_${clean(directiveId)}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
function configured() {
  return Boolean(
    EXECUTIVE_NOTIFICATION_WEB_APP_URL &&
    /^https:\/\/script\.google\.com\/macros\/s\//i.test(EXECUTIVE_NOTIFICATION_WEB_APP_URL) &&
    !EXECUTIVE_NOTIFICATION_WEB_APP_URL.includes("DAN_LINK_WEB_APP")
  );
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function waitForLog(eventId, attempts = 4) {
  const current = FirebaseService.auth.currentUser;
  if (!current) return null;
  const ref = FirebaseService.doc(FirebaseService.db, LOGS, eventId);
  for (let i = 0; i < attempts; i += 1) {
    if (i) await sleep(450 + i * 150);
    try {
      const snapshot = await FirebaseService.getDoc(ref);
      if (snapshot.exists()) return { id: snapshot.id, ...snapshot.data() };
    } catch (error) {
      // Người dùng không có quyền đọc log hoặc log chưa tồn tại: không làm hỏng nghiệp vụ chính.
      if (String(error?.code || "").includes("permission-denied")) return null;
    }
  }
  return null;
}

export const ExecutiveNotificationService = Object.freeze({
  isConfigured: configured,

  async send(action, directiveId, eventData = {}, options = {}) {
    const normalizedAction = clean(action).toUpperCase();
    const normalizedDirectiveId = clean(directiveId);
    const id = buildEventId(normalizedAction, normalizedDirectiveId, options.eventId);
    if (!normalizedAction || !normalizedDirectiveId) return { ok: false, status: "INVALID_EVENT", eventId: id };
    if (!configured()) {
      console.warn("Push Chỉ đạo điều hành chưa cấu hình Web App URL.");
      return { ok: false, status: "NOT_CONFIGURED", eventId: id };
    }

    try {
      const current = FirebaseService.auth.currentUser;
      if (!current) return { ok: false, status: "NO_AUTH", eventId: id };
      const idToken = await current.getIdToken();
      const payload = {
        module: "EXECUTIVE_DIRECTIVES",
        action: normalizedAction,
        directiveId: normalizedDirectiveId,
        idToken,
        eventData: eventData && typeof eventData === "object" && !Array.isArray(eventData) ? eventData : {},
        eventId: id,
        sentAt: new Date().toISOString()
      };

      // Apps Script Web App không bảo đảm CORS cho browser. no-cors giúp request vẫn tới backend.
      await fetch(EXECUTIVE_NOTIFICATION_WEB_APP_URL, {
        method: "POST",
        mode: "no-cors",
        cache: "no-store",
        credentials: "omit",
        keepalive: true,
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify(payload)
      });

      // Luồng production bình thường không chờ log: nghiệp vụ Firestore đã hoàn tất trước khi dispatch Push.
      // Chỉ các màn hình/chẩn đoán chủ động yêu cầu confirmDelivery mới poll executiveNotificationLogs.
      if (options.confirmDelivery !== true) {
        return { ok: true, status: "SUBMITTED", eventId: id };
      }
      const log = await waitForLog(id);
      if (log) {
        if (log.status === "FAILED") console.warn("Push Chỉ đạo điều hành thất bại:", log.errorMessage || log);
        return { ok: log.status === "SENT", eventId: id, ...log };
      }
      return { ok: true, status: "SUBMITTED", eventId: id };
    } catch (error) {
      console.warn("Không gửi được thông báo Chỉ đạo điều hành:", error);
      return { ok: false, status: "CLIENT_ERROR", eventId: id, error: error?.message || String(error) };
    }
  }
});
