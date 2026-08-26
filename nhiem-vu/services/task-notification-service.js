/**
 * Gọi Apps Script thông báo nền - V1.12.0.
 *
 * Nguyên tắc:
 * - Firestore nghiệp vụ là critical path; Push tuyệt đối không được làm UI chờ.
 * - send() chỉ xếp hàng gửi và trả về ngay. taskLogs/Apps Script bridge vẫn là lớp dự phòng.
 * - eventId ổn định khi sự kiện đã có taskLog để chống gửi trùng.
 */
import { FirebaseService } from "../core/firebase-service.js?v=20260826.V1_18_1";
import { NOTIFICATION_WEB_APP_URL } from "../notification-config.js?v=20260826.V1_18_1";

function clean(value) { return String(value ?? "").trim(); }
function buildEventId(action, taskId, eventId = "") {
  const provided = clean(eventId);
  if (provided) return provided.slice(0, 500);
  return `${clean(action)}_${clean(taskId)}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

const pendingJobs = new Set();

async function deliver(job) {
  try {
    const current = FirebaseService.auth.currentUser;
    if (!current) return false;
    const idToken = await current.getIdToken();
    const payload = {
      action: job.action,
      taskId: job.taskId,
      idToken,
      eventData: job.eventData,
      eventId: job.eventId,
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
    return true;
  } catch (error) {
    console.warn("Không gửi được yêu cầu thông báo nền; nghiệp vụ chính vẫn đã được lưu:", error);
    return false;
  }
}

function enqueue(job) {
  const promise = Promise.resolve().then(() => deliver(job));
  pendingJobs.add(promise);
  promise.finally(() => pendingJobs.delete(promise));
}

export const TaskNotificationService = Object.freeze({
  async send(action, taskId, eventData = {}, options = {}) {
    const normalizedAction = clean(action).toUpperCase();
    const normalizedTaskId = clean(taskId);
    if (!normalizedTaskId || !normalizedAction || !NOTIFICATION_WEB_APP_URL || NOTIFICATION_WEB_APP_URL.includes("DAN_LINK_WEB_APP")) {
      return false;
    }
    enqueue({
      action: normalizedAction,
      taskId: normalizedTaskId,
      eventData: eventData && typeof eventData === "object" && !Array.isArray(eventData) ? eventData : {},
      eventId: buildEventId(normalizedAction, normalizedTaskId, options?.eventId)
    });
    // Quan trọng: caller có await send() cũng không còn chờ getIdToken/fetch Apps Script.
    return true;
  },

  pendingCount() { return pendingJobs.size; }
});
