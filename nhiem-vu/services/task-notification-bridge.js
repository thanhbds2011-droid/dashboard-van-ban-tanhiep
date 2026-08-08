/**
 * Cầu nối nhật ký nhiệm vụ -> Apps Script thông báo - V1.10.0.
 *
 * Không thay đổi luồng nghiệp vụ hiện tại. Các service V1.9.4 đã ghi taskLogs;
 * lớp này chỉ quan sát log MỚI do chính tài khoản hiện tại tạo và gọi đúng
 * action mà Apps Script V6.x đã hỗ trợ.
 */
import { FirebaseService } from "../core/firebase-service.js?v=20260808.V1_10_1";
import { UserContext } from "../core/user-context.js?v=20260808.V1_10_1";
import { TaskNotificationService } from "./task-notification-service.js?v=20260808.V1_10_1";

const DIRECT_ACTIONS = Object.freeze({
  TASK_CREATED: "TASK_CREATED",
  TASK_INTERNAL_ASSIGNED: "TASK_INTERNAL_ASSIGNED",
  TASK_COMPLETED: "TASK_COMPLETED",
  TASK_DELETED: "TASK_DELETED",
  TASK_UPDATED: "TASK_UPDATED",
  TASK_EDITED: "TASK_EDITED",
  TASK_SUPPORT_UPDATED: "TASK_SUPPORT_UPDATED",
  TASK_ADJUSTMENT_REQUESTED: "TASK_ADJUSTMENT_REQUESTED",
  TASK_ADJUSTMENT_APPROVED: "TASK_ADJUSTMENT_APPROVED",
  TASK_ADJUSTMENT_REJECTED: "TASK_ADJUSTMENT_REJECTED",
  TASK_TEAM_DIRECT_ASSIGNED: "TASK_TEAM_DIRECT_ASSIGNED",
  CDTN_ATTENDANCE_UPDATED: "CDTN_ATTENDANCE_UPDATED"
});

const DERIVED_ACTIONS = Object.freeze({
  TASK_DEPARTMENT_ACCEPTED: "TASK_UPDATED",
  TASK_ACCEPTED: "TASK_UPDATED",
  TASK_DIRECTOR_REASSIGNED: "TASK_UPDATED",
  TASK_DIRECTOR_RECALLED: "TASK_UPDATED"
});

const ACTION_PRIORITY = Object.freeze({
  TASK_DELETED: 100,
  TASK_COMPLETED: 90,
  TASK_TEAM_DIRECT_ASSIGNED: 85,
  TASK_INTERNAL_ASSIGNED: 80,
  TASK_CREATED: 70,
  TASK_ADJUSTMENT_REJECTED: 60,
  TASK_ADJUSTMENT_APPROVED: 60,
  TASK_ADJUSTMENT_REQUESTED: 60,
  TASK_SUPPORT_UPDATED: 50,
  TASK_EDITED: 45,
  TASK_UPDATED: 40,
  CDTN_ATTENDANCE_UPDATED: 30
});

const pendingByTask = new Map();
let unsubscribe = null;
let startedForUid = "";
let initialized = false;

function clean(value) { return String(value ?? "").trim(); }
function upper(value) { return clean(value).toUpperCase(); }
function mappedAction(sourceAction) {
  const source = upper(sourceAction);
  return DIRECT_ACTIONS[source] || DERIVED_ACTIONS[source] || "";
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
    // Dọn nhẹ các khóa cũ để localStorage không tăng vô hạn.
    const prefix = "nhiem-vu:push-log:";
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    if (keys.length > 500) {
      keys.slice(0, keys.length - 400).forEach(key => localStorage.removeItem(key));
    }
  } catch (_) { /* localStorage có thể bị chặn ở chế độ riêng tư. */ }
}

async function dispatch(taskId) {
  const pending = pendingByTask.get(taskId);
  if (!pending) return;
  pendingByTask.delete(taskId);

  const candidates = pending.logs
    .map(item => ({ ...item, mapped: mappedAction(item.action) }))
    .filter(item => item.mapped && !alreadySent(item.id));
  if (!candidates.length) return;

  // Nếu BGĐ vừa tạo nhiệm vụ rồi giao thẳng qua Tổ/Nhóm, hai log có thể xuất hiện
  // gần nhau. Giữ nguyên action TASK_TEAM_DIRECT_ASSIGNED để Apps Script xác thực đúng
  // actor BGĐ và chọn đúng người phụ trách; không phát sinh thêm TASK_CREATED.
  const hasTeamDirect = candidates.some(item => upper(item.action) === "TASK_TEAM_DIRECT_ASSIGNED");
  const filtered = hasTeamDirect
    ? candidates.filter(item => upper(item.action) === "TASK_TEAM_DIRECT_ASSIGNED")
    : candidates;
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
  if (!taskId || !mappedAction(log?.action)) return;
  const current = pendingByTask.get(taskId) || { logs: [], timer: null };
  current.logs.push(log);
  if (current.timer) clearTimeout(current.timer);
  current.timer = setTimeout(() => void dispatch(taskId), 2500);
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
      // Tuyệt đối không gửi lại task cũ khi tải/refresh app.
      snapshot.docs.forEach(doc => markSent(doc.id));
      initialized = true;
      return;
    }
    snapshot.docChanges().forEach(change => {
      if (change.type !== "added") return;
      scheduleLog({ id: change.doc.id, ...change.doc.data() });
    });
  }, error => {
    console.warn("Không theo dõi được nhật ký để kích hoạt push tự động:", error);
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
