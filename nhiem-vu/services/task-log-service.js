/** Ghi và đọc nhật ký nhiệm vụ bất biến. */
import { FirebaseService } from "../core/firebase-service.js?v=20260826.V1_18_5";
import { UserContext } from "../core/user-context.js?v=20260826.V1_18_5";
import { Permissions } from "../core/permissions.js?v=20260826.V1_18_5";
import { APP_VERSION } from "../core/app-version.js?v=20260826.V1_18_5";

export function buildTaskLog({ taskId, taskCode, periodId = "", action, before = null, after = null, note = "" }) {
  const user = UserContext.requireUser();
  return {
    appVersion: APP_VERSION, schemaVersion: 2, taskId, taskCode: taskCode || "", periodId: periodId || "",
    action, before, after, note: String(note || "").trim(),
    performedByUserId: user.uid, performedByName: user.fullName || user.email || "",
    performedByRole: user.role || "", performedByDepartmentId: user.departmentId || "",
    createdAt: FirebaseService.serverTimestamp()
  };
}

function timestampMillis(value) {
  if (value?.toMillis) return value.toMillis();
  if (value?.seconds) return Number(value.seconds) * 1000;
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}
function mapLogs(snapshot) {
  return snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
}
function uniqueLogs(items) {
  return [...new Map(items.map(item => [item.id, item])).values()]
    .sort((a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt));
}
async function queryLogs(...filters) {
  return FirebaseService.getDocs(FirebaseService.query(
    FirebaseService.collection(FirebaseService.db, "taskLogs"),
    ...filters, FirebaseService.limit(300)
  ));
}
async function list(taskId) {
  const id = String(taskId || "").trim();
  if (!id) return [];
  try {
    return uniqueLogs(mapLogs(await queryLogs(FirebaseService.where("taskId", "==", id))));
  } catch (error) {
    const code = String(error?.code || "");
    if (!code.includes("permission-denied")) throw error;
    /* Rules production giới hạn log theo người/phòng. Query lại đúng scope để không phát warning giả. */
    const user = UserContext.requireUser();
    const requests = [];
    if (Permissions.isDepartmentLeader() || Permissions.isTchcCoordinator()) {
      requests.push(queryLogs(
        FirebaseService.where("taskId", "==", id),
        FirebaseService.where("performedByDepartmentId", "==", user.departmentId)
      ));
    }
    requests.push(queryLogs(
      FirebaseService.where("taskId", "==", id),
      FirebaseService.where("performedByUserId", "==", user.uid)
    ));
    const settled = await Promise.allSettled(requests);
    return uniqueLogs(settled
      .filter(item => item.status === "fulfilled")
      .flatMap(item => mapLogs(item.value)));
  }
}

export const TaskLogService = Object.freeze({ buildTaskLog, list });
