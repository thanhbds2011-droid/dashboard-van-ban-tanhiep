/** Production 3D - ghi nhật ký nhiệm vụ bất biến. */
import { FirebaseService } from "../core/firebase-service.js";
import { UserContext } from "../core/user-context.js";

export function buildTaskLog({ taskId, taskCode, action, before = null, after = null, note = "" }) {
  const user = UserContext.requireUser();
  return {
    taskId,
    taskCode: taskCode || "",
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

export const TaskLogService = Object.freeze({
  buildTaskLog,

  async list(taskId) {
    if (!taskId) return [];
    const snapshot = await FirebaseService.getDocs(
      FirebaseService.query(
        FirebaseService.collection(FirebaseService.db, "taskLogs"),
        FirebaseService.where("taskId", "==", taskId)
      )
    );
    return snapshot.docs
      .map(item => ({ id: item.id, ...item.data() }))
      .sort((a, b) => Number(b.createdAt?.seconds || 0) - Number(a.createdAt?.seconds || 0));
  }
});
