/**
 * Cầu nối nhật ký nhiệm vụ -> Apps Script thông báo - V1.10.2.
 *
 * V1.10.2:
 * - Giữ nguyên taskLogs làm lớp kiểm toán và lớp dự phòng phát push.
 * - Ánh xạ đúng các action Apps Script V6.4.0 đã hỗ trợ.
 * - Khi bridge khởi động muộn, chỉ xem xét các log vừa phát sinh gần đây thay vì
 *   đánh dấu toàn bộ là đã gửi; nhờ vậy giảm khả năng mất thông báo sau reload.
 */
import { FirebaseService } from "../core/firebase-service.js?v=20260825.V1_16_1";
import { UserContext } from "../core/user-context.js?v=20260825.V1_16_1";
import { TaskNotificationService } from "./task-notification-service.js?v=20260825.V1_16_1";

const DIRECT_ACTIONS = Object.freeze({
  TASK_CREATED: "TASK_CREATED",
  TASK_DEPARTMENT_ASSIGNED: "TASK_DEPARTMENT_ASSIGNED",
  TASK_TEAM_DIRECT_ASSIGNED: "TASK_TEAM_DIRECT_ASSIGNED",
  TASK_DEPARTMENT_ACCEPTED: "TASK_DEPARTMENT_ACCEPTED",
  TASK_INTERNAL_ASSIGNED: "TASK_INTERNAL_ASSIGNED",
  TASK_PERSONAL_ACCEPTED: "TASK_PERSONAL_ACCEPTED",
  TASK_COMPLETED: "TASK_COMPLETED",
  TASK_DELETED: "TASK_DELETED",
  TASK_UPDATED: "TASK_UPDATED",
  TASK_EDITED: "TASK_EDITED",
  TASK_SUPPORT_UPDATED: "TASK_SUPPORT_UPDATED",
  TASK_ADJUSTMENT_REQUESTED: "TASK_ADJUSTMENT_REQUESTED",
  TASK_ADJUSTMENT_APPROVED: "TASK_ADJUSTMENT_APPROVED",
  TASK_ADJUSTMENT_REJECTED: "TASK_ADJUSTMENT_REJECTED",
  CDTN_ATTENDANCE_UPDATED: "CDTN_ATTENDANCE_UPDATED"
});

const DERIVED_ACTIONS = Object.freeze({
  // Dữ liệu V1.10.1 ghi TASK_ACCEPTED; gateway production dùng TASK_PERSONAL_ACCEPTED.
  TASK_ACCEPTED: "TASK_PERSONAL_ACCEPTED",
  TASK_DIRECTOR_REASSIGNED: "TASK_EDITED",
  TASK_DIRECTOR_RECALLED: "TASK_UPDATED"
});

const ACTION_PRIORITY = Object.freeze({
  TASK_DELETED: 100,
  TASK_COMPLETED: 90,
  TASK_TEAM_DIRECT_ASSIGNED: 88,
  TASK_DEPARTMENT_ASSIGNED: 86,
  TASK_INTERNAL_ASSIGNED: 84,
  TASK_DEPARTMENT_ACCEPTED: 82,
  TASK_PERSONAL_ACCEPTED: 80,
  TASK_CREATED: 70,
  TASK_ADJUSTMENT_REJECTED: 60,
  TASK_ADJUSTMENT_APPROVED: 60,
  TASK_ADJUSTMENT_REQUESTED: 60,
  TASK_SUPPORT_UPDATED: 50,
  TASK_EDITED: 45,
  TASK_UPDATED: 40,
  CDTN_ATTENDANCE_UPDATED: 30
});

const RECENT_BOOTSTRAP_WINDOW_MS = 30 * 1000;
const pendingByTask = new Map();
let unsubscribe = null;
let startedForUid = "";
let initialized = false;

function clean(value) { return String(value ?? "").trim(); }
function upper(value) { return clean(value).toUpperCase(); }
function mappedAction(sourceAction, log = {}) {
  const source = upper(sourceAction);
  if (source === "TASK_CREATED" && ["DIRECTOR", "ADMIN"].includes(upper(log.performedByRole))) {
    return "TASK_DEPARTMENT_ASSIGNED";
  }
  return DIRECT_ACTIONS[source] || DERIVED_ACTIONS[source] || "";
}

function timestampMillis(value) {
  if (value?.toMillis) return value.toMillis();
  if (value?.seconds) return Number(value.seconds) * 1000;
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function sentStorageKey(logId) {
  return `nhiem-vu:push-log:${clean(logId)}`;
}

function alreadySent(logId) {
  if (!logId) return false;
  try { return Boolean(localStorage.getItem(sentStorageKey(logId))); }
  catch (_) { return false; }
}

function markSent(logId) {
  if (!logId) return;
  try {
    localStorage.setItem(sentStorageKey(logId), String(Date.now()));
    const prefix = "nhiem-vu:push-log:";
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    if (keys.length > 500) {
      keys.slice(0, keys.length - 400).forEach(key => localStorage.removeItem(key));
    }
  } catch (_) { /* localStorage có thể bị chặn. */ }
}

async function dispatch(taskId) {
  const pending = pendingByTask.get(taskId);
  if (!pending) return;
  pendingByTask.delete(taskId);

  const candidates = pending.logs
    .map(item => ({ ...item, mapped: mappedAction(item.action, item) }))
    .filter(item => item.mapped && !alreadySent(item.id));
  if (!candidates.length) return;

  // Một thao tác giao trực tiếp có thể phát sinh nhiều log gần nhau. Ưu tiên action
  // chuyên biệt để gateway xác định đúng người nhận và tránh push trùng nội dung.
  const specialized = candidates.filter(item => [
    "TASK_TEAM_DIRECT_ASSIGNED",
    "TASK_DEPARTMENT_ASSIGNED",
    "TASK_INTERNAL_ASSIGNED",
    "TASK_DEPARTMENT_ACCEPTED",
    "TASK_PERSONAL_ACCEPTED"
  ].includes(item.mapped));
  const filtered = specialized.length ? specialized : candidates;
  filtered.sort((a, b) => (ACTION_PRIORITY[b.mapped] || 0) - (ACTION_PRIORITY[a.mapped] || 0));
  const chosen = filtered[0];
  if (!chosen) return;

  const ok = await TaskNotificationService.send(
    chosen.mapped,
    taskId,
    {
      sourceAction: chosen.action || "",
      taskCode: chosen.taskCode || "",
      periodId: chosen.periodId || "",
      note: chosen.note || "",
      performedByUserId: chosen.performedByUserId || "",
      performedByName: chosen.performedByName || "",
      performedByRole: chosen.performedByRole || "",
      performedByDepartmentId: chosen.performedByDepartmentId || ""
    },
    { eventId: `TASKLOG_${chosen.id}` }
  );

  if (ok) filtered.forEach(item => markSent(item.id));
}

function scheduleLog(log) {
  const taskId = clean(log?.taskId);
  if (!taskId || !mappedAction(log?.action, log)) return;
  const current = pendingByTask.get(taskId) || { logs: [], timer: null };
  current.logs.push(log);
  if (current.timer) clearTimeout(current.timer);
  current.timer = setTimeout(() => void dispatch(taskId), 900);
  pendingByTask.set(taskId, current);
}

async function waitForUser(timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const user = UserContext.getUser?.();
      if (user?.uid && user.active !== false) return user;
    } catch (_) { /* app bootstrap chưa hoàn tất */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return null;
}

async function start() {
  const user = await waitForUser();
  if (!user?.uid) return false;
  if (startedForUid === user.uid && unsubscribe) return true;

  unsubscribe?.();
  unsubscribe = null;
  startedForUid = user.uid;
  initialized = false;

  const reference = FirebaseService.query(
    FirebaseService.collection(FirebaseService.db, "taskLogs"),
    FirebaseService.where("performedByUserId", "==", user.uid)
  );

  unsubscribe = FirebaseService.onSnapshot(reference, snapshot => {
    if (!initialized) {
      const cutoff = Date.now() - RECENT_BOOTSTRAP_WINDOW_MS;
      snapshot.docs.forEach(doc => {
        const log = { id: doc.id, ...doc.data() };
        if (timestampMillis(log.createdAt) >= cutoff && mappedAction(log.action, log) && !alreadySent(log.id)) {
          scheduleLog(log);
        } else {
          markSent(log.id);
        }
      });
      initialized = true;
      return;
    }

    snapshot.docChanges().forEach(change => {
      if (change.type !== "added") return;
      scheduleLog({ id: change.doc.id, ...change.doc.data() });
    });
  }, error => {
    console.warn("Không theo dõi được nhật ký để kích hoạt thông báo tự động:", error);
  });
  return true;
}

function stop() {
  unsubscribe?.();
  unsubscribe = null;
  startedForUid = "";
  initialized = false;
  pendingByTask.forEach(item => item.timer && clearTimeout(item.timer));
  pendingByTask.clear();
}

export const TaskNotificationBridge = Object.freeze({ start, stop });
