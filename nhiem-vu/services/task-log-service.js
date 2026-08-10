/** Ghi và đọc nhật ký nhiệm vụ bất biến. */
import { FirebaseService } from "../core/firebase-service.js?v=20260810.V1_10_6";
import { UserContext } from "../core/user-context.js?v=20260810.V1_10_6";

export function buildTaskLog({ taskId, taskCode, periodId = "", action, before = null, after = null, note = "" }) {
  const user = UserContext.requireUser();
  return {
    appVersion: "1.10.2",
    schemaVersion: 2,
    taskId,
    taskCode: taskCode || "",
    periodId: periodId || "",
    action,
    before,
    after,
    note: String(note || "").trim(),
    performedByUserId: user.uid,
    performedByName: user.fullName || user.email || "",
    performedByRole: user.role || "",
    performedByDepartmentId: user.departmentId || "",
    createdAt: FirebaseService.serverTimestamp()
  };
}

function timestampMillis(value) {
  if (value?.toMillis) return value.toMillis();
  if (value?.seconds) return Number(value.seconds) * 1000;
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

async function list(taskId) {
  if (!String(taskId || "").trim()) return [];
  const snapshot = await FirebaseService.getDocs(
    FirebaseService.query(
      FirebaseService.collection(FirebaseService.db, "taskLogs"),
      FirebaseService.where("taskId", "==", taskId),
      FirebaseService.limit(300)
    )
  );
  return snapshot.docs
    .map(item => ({ id: item.id, ...item.data() }))
    .sort((a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt));
}

export const TaskLogService = Object.freeze({ buildTaskLog, list });
