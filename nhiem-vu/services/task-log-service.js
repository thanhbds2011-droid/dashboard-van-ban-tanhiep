/** Production 3D - ghi nhật ký nhiệm vụ bất biến. */
import { FirebaseService } from "../core/firebase-service.js";
import { UserContext } from "../core/user-context.js";

export function buildTaskLog({ taskId, taskCode, periodId = "", action, before = null, after = null, note = "" }) {
  const user = UserContext.requireUser();
  return {
    appVersion: "1.5.0",
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

export const TaskLogService = Object.freeze({ buildTaskLog });
