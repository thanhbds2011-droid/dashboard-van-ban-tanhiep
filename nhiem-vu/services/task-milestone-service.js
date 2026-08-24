/**
 * Mốc tiến độ định kỳ của một nhiệm vụ KPI - V1.13.0.
 *
 * Một đầu việc "Theo tháng" chỉ tạo MỘT document tasks cho cả kỳ KPI.
 * Các hạn nội bộ được lưu tại taskMilestones; hoàn thành một mốc không tự kết thúc
 * nhiệm vụ, trừ khi đó là mốc cuối cùng và mọi mốc trước đã hoàn thành.
 */
import { FirebaseService } from "../core/firebase-service.js?v=20260824.V1_14_2";
import { UserContext } from "../core/user-context.js?v=20260824.V1_14_2";
import { TaskLogService } from "./task-log-service.js?v=20260824.V1_14_2";
import { TaskNotificationService } from "./task-notification-service.js?v=20260824.V1_14_2";

function clean(value) {
  return String(value ?? "").trim();
}

function milestoneRef(id) {
  return FirebaseService.doc(FirebaseService.db, "taskMilestones", id);
}

function taskRef(id) {
  return FirebaseService.doc(FirebaseService.db, "tasks", id);
}

function logRef() {
  return FirebaseService.doc(FirebaseService.collection(FirebaseService.db, "taskLogs"));
}

function sortMilestones(items = []) {
  return [...items].sort((a, b) =>
    Number(a.sequence || 0) - Number(b.sequence || 0)
    || clean(a.dueDateKey).localeCompare(clean(b.dueDateKey))
    || clean(a.id).localeCompare(clean(b.id))
  );
}

function evidencePayload(evidence = {}) {
  const evidenceUrl = clean(evidence.evidenceUrl || evidence.evidenceLink);
  const evidenceText = clean(evidence.evidenceText).slice(0, 3000);
  const evidenceFileName = clean(evidence.evidenceFileName).slice(0, 500);
  const evidenceStoragePath = clean(evidence.evidenceStoragePath).slice(0, 1000);
  return {
    evidenceType: evidenceUrl ? "FILE" : (evidenceText ? "TEXT" : ""),
    evidenceUrl,
    evidenceLink: evidenceUrl,
    evidenceText,
    evidenceFileName,
    evidenceStoragePath
  };
}

function snapshotMilestone(item = {}) {
  return {
    status: item.status || "",
    dueDateKey: item.dueDateKey || "",
    completedAt: item.completedAt || null,
    evidenceUrl: item.evidenceUrl || "",
    evidenceText: item.evidenceText || ""
  };
}

function scopedMilestoneQuery(taskOrId) {
  const user = UserContext.requireUser();
  const task = taskOrId && typeof taskOrId === "object" ? taskOrId : null;
  const taskId = clean(task?.id || taskOrId);
  if (!taskId) return null;

  const constraints = [
    FirebaseService.where("taskId", "==", taskId)
  ];

  /*
   * Firestore Rules không phải bộ lọc dữ liệu. Query phải chứng minh được nhánh
   * permission trước khi server trả kết quả:
   * - chính người thực hiện -> ownerUserId == UID;
   * - người quản lý/được ủy quyền -> departmentId == Phòng/Khu của task.
   *
   * V1.14.0 chỉ query theo taskId nên owner vẫn có thể bị
   * "Missing or insufficient permissions" dù từng document thực tế thuộc về họ.
   */
  if (task && clean(task.ownerUserId) === clean(user.uid)) {
    constraints.push(FirebaseService.where("ownerUserId", "==", user.uid));
  } else if (task && clean(task.primaryDepartmentId || task.departmentId)) {
    constraints.push(
      FirebaseService.where(
        "departmentId",
        "==",
        String(task.primaryDepartmentId || task.departmentId).trim().toUpperCase()
      )
    );
  } else {
    // Tương thích lời gọi cũ chỉ truyền taskId: chỉ cho đọc phạm vi chính UID.
    constraints.push(FirebaseService.where("ownerUserId", "==", user.uid));
  }

  return FirebaseService.query(
    FirebaseService.collection(FirebaseService.db, "taskMilestones"),
    ...constraints
  );
}

export const TaskMilestoneService = Object.freeze({
  async list(taskOrId) {
    const reference = scopedMilestoneQuery(taskOrId);
    if (!reference) return [];
    const snapshot = await FirebaseService.getDocs(reference);
    return sortMilestones(
      snapshot.docs
        .map(item => ({ id: item.id, ...item.data() }))
        .filter(item => item.active !== false)
    );
  },

  firstIncomplete(milestones = []) {
    return sortMilestones(milestones).find(item => !item.completedAt && String(item.status || "").toUpperCase() !== "COMPLETED") || null;
  },

  async complete(task, milestone, evidence = {}) {
    const user = UserContext.requireUser();
    if (!task?.id || !milestone?.id) throw new Error("Không xác định được mốc nhiệm vụ cần hoàn thành.");
    if (task.ownerUserId !== user.uid) throw new Error("Chỉ người thực hiện nhiệm vụ mới được hoàn thành mốc KPI.");
    if (task.assignmentStatus !== "DA_TIEP_NHAN") throw new Error("Bạn cần xác nhận đã nhận nhiệm vụ trước khi hoàn thành mốc KPI.");
    if (task.active === false || String(task.status || "").toUpperCase() === "HUY") throw new Error("Nhiệm vụ không còn hoạt động.");
    if (String(task.milestoneMode || "").toUpperCase() !== "MONTHLY") throw new Error("Nhiệm vụ này không sử dụng mốc tiến độ theo tháng.");

    const all = await this.list(task);
    const current = this.firstIncomplete(all);
    if (!current) throw new Error("Tất cả mốc của nhiệm vụ đã hoàn thành.");
    if (current.id !== milestone.id) {
      throw new Error(`Hãy hoàn thành mốc ${current.dueDateKey || current.label || "trước đó"} trước khi cập nhật mốc tiếp theo.`);
    }

    const evidenceFields = evidencePayload(evidence);
    const evidenceRequired = Boolean(task.mandatoryEvidence || task.standardTaskMandatoryEvidence || task.evidenceRequired === true);
    const hasEvidence = Boolean(
      evidenceFields.evidenceUrl || evidenceFields.evidenceText
      || task.evidenceUrl || task.evidenceText
    );
    if (evidenceRequired && !hasEvidence) throw new Error("Đầu việc này bắt buộc phải có minh chứng.");

    const finalMilestone = clean(task.finalMilestoneId) === milestone.id;
    const milestoneReference = milestoneRef(milestone.id);
    const taskReference = taskRef(task.id);
    const notificationLogReference = logRef();

    await FirebaseService.runTransaction(FirebaseService.db, async transaction => {
      const [milestoneSnapshot, taskSnapshot] = await Promise.all([
        transaction.get(milestoneReference),
        transaction.get(taskReference)
      ]);
      if (!milestoneSnapshot.exists()) throw new Error("Mốc KPI không còn tồn tại.");
      if (!taskSnapshot.exists()) throw new Error("Nhiệm vụ không còn tồn tại.");

      const liveMilestone = milestoneSnapshot.data() || {};
      const liveTask = taskSnapshot.data() || {};
      if (liveMilestone.completedAt || String(liveMilestone.status || "").toUpperCase() === "COMPLETED") {
        throw new Error("Mốc KPI này đã được hoàn thành trước đó.");
      }
      if (liveMilestone.ownerUserId !== user.uid || liveTask.ownerUserId !== user.uid) {
        throw new Error("Tài khoản không còn là người thực hiện nhiệm vụ.");
      }

      const milestoneUpdate = {
        ...evidenceFields,
        status: "COMPLETED",
        completedAt: FirebaseService.serverTimestamp(),
        completedByUserId: user.uid,
        completedByName: user.fullName || "",
        updatedAt: FirebaseService.serverTimestamp(),
        updatedByUserId: user.uid,
        updatedByName: user.fullName || ""
      };
      transaction.update(milestoneReference, milestoneUpdate);

      const nextCompletedCount = Math.min(
        Number(liveTask.milestoneCount || all.length || 0),
        Number(liveTask.milestoneCompletedCount || 0) + 1
      );
      const taskUpdate = {
        milestoneCompletedCount: nextCompletedCount,
        lastCompletedMilestoneId: milestone.id,
        lastCompletedMilestoneAt: FirebaseService.serverTimestamp(),
        ...evidenceFields,
        updatedAt: FirebaseService.serverTimestamp(),
        updatedByUserId: user.uid,
        updatedByName: user.fullName || ""
      };

      if (finalMilestone && nextCompletedCount >= Number(liveTask.milestoneCount || all.length || 0)) {
        taskUpdate.status = "HOAN_THANH";
        taskUpdate.progress = 100;
        taskUpdate.completedAt = FirebaseService.serverTimestamp();
        taskUpdate.completedByUserId = user.uid;
        taskUpdate.completedByName = user.fullName || "";
      }
      transaction.update(taskReference, taskUpdate);

      transaction.set(notificationLogReference, TaskLogService.buildTaskLog({
        taskId: task.id,
        taskCode: task.taskCode || "",
        periodId: task.periodId || "",
        action: finalMilestone ? "TASK_COMPLETED" : "TASK_MILESTONE_COMPLETED",
        before: snapshotMilestone({ ...milestone, id: milestone.id }),
        after: {
          ...snapshotMilestone({ ...milestone, ...milestoneUpdate, completedAt: null }),
          milestoneId: milestone.id,
          milestoneSequence: milestone.sequence || 0,
          finalMilestone
        },
        note: finalMilestone
          ? `Hoàn thành mốc cuối ${milestone.dueDateKey || ""}; nhiệm vụ được ghi nhận hoàn thành.`
          : `Hoàn thành mốc ${milestone.dueDateKey || ""}; nhiệm vụ tiếp tục đến mốc kế tiếp.`
      }));
    });

    const action = finalMilestone ? "TASK_COMPLETED" : "TASK_UPDATED";
    await TaskNotificationService.send(
      action,
      task.id,
      {
        sourceAction: finalMilestone ? "TASK_COMPLETED" : "TASK_MILESTONE_COMPLETED",
        taskCode: task.taskCode || "",
        periodId: task.periodId || "",
        oldStatus: task.status || "",
        newStatus: finalMilestone ? "HOAN_THANH" : (task.status || "DANG_XU_LY"),
        oldProgress: Number(task.progress || 0),
        newProgress: finalMilestone ? 100 : Number(task.progress || 0),
        performedByUserId: user.uid,
        performedByName: user.fullName || "",
        performedByRole: user.role || "",
        performedByDepartmentId: user.departmentId || ""
      },
      { eventId: `TASKLOG_${notificationLogReference.id}` }
    );

    return {
      taskCompleted: finalMilestone,
      milestoneId: milestone.id
    };
  }
});
