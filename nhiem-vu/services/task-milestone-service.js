/**
 * Mốc tiến độ định kỳ của một nhiệm vụ KPI - V1.13.0.
 *
 * Một đầu việc "Theo tháng" chỉ tạo MỘT document tasks cho cả kỳ KPI.
 * Các hạn nội bộ được lưu tại taskMilestones; hoàn thành một mốc không tự kết thúc
 * nhiệm vụ, trừ khi đó là mốc cuối cùng và mọi mốc trước đã hoàn thành.
 */
import { FirebaseService } from "../core/firebase-service.js?v=20260903.V1_22_1";
import { UserContext } from "../core/user-context.js?v=20260903.V1_22_1";
import { TaskLogService } from "./task-log-service.js?v=20260903.V1_22_1";
import { TaskNotificationService } from "./task-notification-service.js?v=20260903.V1_22_1";
import { confirmWriteWithServerRecovery } from "./firestore-write-recovery.js?v=20260903.V1_22_1";

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


function displayDateKey(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value || "");
}

function hasOwn(object, field) {
  return Object.prototype.hasOwnProperty.call(object || {}, field);
}

function milestoneSchemaReady(milestone = {}) {
  return clean(milestone.taskId)
    && clean(milestone.ownerUserId)
    && clean(milestone.departmentId)
    && clean(milestone.dueDateKey)
    && hasOwn(milestone, "dueAt") && Boolean(milestone.dueAt)
    && hasOwn(milestone, "sequence") && Number.isFinite(Number(milestone.sequence)) && Number(milestone.sequence) > 0;
}

function parentMilestoneSchemaReady(task = {}) {
  return ["DAILY", "WEEKLY", "MONTHLY"].includes(clean(task.milestoneMode).toUpperCase())
    && typeof task.milestoneCount === "number" && Number.isFinite(task.milestoneCount) && task.milestoneCount > 0
    && typeof task.milestoneCompletedCount === "number" && Number.isFinite(task.milestoneCompletedCount) && task.milestoneCompletedCount >= 0
    && clean(task.finalMilestoneId);
}

function milestoneRepairError() {
  const error = new Error("Dữ liệu mốc của nhiệm vụ cũ chưa được chuẩn hóa đầy đủ. Quản trị viên cần chạy migration V1.18.3 rồi bấm Cập nhật trước khi thử lại.");
  error.code = "milestone-schema-repair-required";
  return error;
}

async function milestoneCompletionConfirmedOnServer(taskId, milestoneId, userId, finalMilestone) {
  const [milestoneSnapshot, taskSnapshot] = await Promise.all([
    FirebaseService.getDocFromServer(milestoneRef(milestoneId)),
    FirebaseService.getDocFromServer(taskRef(taskId))
  ]);
  if (!milestoneSnapshot.exists() || !taskSnapshot.exists()) return false;
  const liveMilestone = milestoneSnapshot.data() || {};
  const liveTask = taskSnapshot.data() || {};
  const milestoneDone = clean(liveMilestone.status).toUpperCase() === "COMPLETED"
    && Boolean(liveMilestone.completedAt)
    && clean(liveMilestone.completedByUserId) === clean(userId);
  const parentDone = clean(liveTask.lastCompletedMilestoneId) === clean(milestoneId)
    && Number(liveTask.milestoneCompletedCount || 0) > 0;
  if (!milestoneDone || !parentDone) return false;
  if (!finalMilestone) return true;
  return clean(liveTask.status).toUpperCase() === "HOAN_THANH"
    && Boolean(liveTask.completedAt)
    && clean(liveTask.completedByUserId) === clean(userId);
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
    if (!["DAILY", "WEEKLY", "MONTHLY"].includes(String(task.milestoneMode || "").toUpperCase())) throw new Error("Nhiệm vụ này không sử dụng mốc tiến độ định kỳ.");

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

    let finalMilestone = clean(task.finalMilestoneId) === milestone.id;
    const milestoneReference = milestoneRef(milestone.id);
    const taskReference = taskRef(task.id);
    const notificationLogReference = logRef();

    const transactionPromise = FirebaseService.runTransaction(FirebaseService.db, async transaction => {
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
      if (!milestoneSchemaReady(liveMilestone) || !parentMilestoneSchemaReady(liveTask)) {
        throw milestoneRepairError();
      }
      const liveCount = liveTask.milestoneCount;
      const liveCompletedCount = liveTask.milestoneCompletedCount;
      finalMilestone = clean(liveTask.finalMilestoneId) === milestone.id;

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
        liveCount,
        liveCompletedCount + 1
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

      if (finalMilestone && nextCompletedCount >= liveCount) {
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
          ? `Đã hoàn thành mốc cuối ngày ${displayDateKey(milestone.dueDateKey)}.`
          : `Đã hoàn thành mốc ngày ${displayDateKey(milestone.dueDateKey)}.`
      }));
    });

    await confirmWriteWithServerRecovery(
      transactionPromise,
      () => milestoneCompletionConfirmedOnServer(task.id, milestone.id, user.uid, finalMilestone)
    );

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
