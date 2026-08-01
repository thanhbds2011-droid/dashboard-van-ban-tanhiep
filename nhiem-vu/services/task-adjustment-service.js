/** Quy trình đề nghị và phê duyệt điều chỉnh nhiệm vụ, không chuyển điểm giữa nhân sự. */
import { FirebaseService } from "../core/firebase-service.js";
import { UserContext } from "../core/user-context.js";
import { TaskLogService } from "./task-log-service.js";
import { TaskNotificationService } from "./task-notification-service.js?v=20260801.V1_2_0";

const COLLECTION = "kpiAdjustments";
const TYPES = Object.freeze({
  ADJUST_SCOPE: "ADJUST_SCOPE",
  EXEMPT_FROM_SCORING: "EXEMPT_FROM_SCORING"
});

function clean(value, max = 3000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function planSnapshot(task) {
  return {
    title: task.title || "",
    description: task.description || "",
    deadline: task.deadline || null,
    deadlineDateKey: task.deadlineDateKey || "",
    baseScore: Number(task.baseScore || 0),
    difficultyCoefficient: Number(task.difficultyCoefficient || 1),
    maximumConvertedScore: Number(task.maximumConvertedScore || 0),
    includedInA: task.includedInA === true,
    scoringEnabled: task.scoringEnabled !== false
  };
}

function approvalUserId(task) {
  return clean(task.adjustmentApproverUserId || task.assignedByUserId || task.createdByUserId, 200);
}

function label(type) {
  return type === TYPES.EXEMPT_FROM_SCORING
    ? "Không đánh giá do điều động"
    : "Điều chỉnh khối lượng/phạm vi";
}

function taskRef(taskId) {
  return FirebaseService.doc(FirebaseService.db, "tasks", taskId);
}

function logRef() {
  return FirebaseService.doc(FirebaseService.collection(FirebaseService.db, "taskLogs"));
}

export const TaskAdjustmentService = Object.freeze({
  TYPES,
  label,

  async list(taskId) {
    if (!taskId) return [];
    const snapshot = await FirebaseService.getDocs(
      FirebaseService.query(
        FirebaseService.collection(FirebaseService.db, COLLECTION),
        FirebaseService.where("taskId", "==", taskId)
      )
    );
    return snapshot.docs
      .map(item => ({ id: item.id, ...item.data() }))
      .filter(item => item.recordType === "TASK_ADJUSTMENT")
      .sort((a, b) => Number(b.createdAt?.seconds || 0) - Number(a.createdAt?.seconds || 0));
  },

  canRequest(task) {
    const user = UserContext.requireUser();
    return Boolean(
      task?.active !== false &&
      task.ownerUserId === user.uid &&
      task.scoreLocked !== true &&
      !["CONFIRMED", "ADJUSTMENT_EXEMPT"].includes(String(task.scoringStatus || "").toUpperCase()) &&
      String(task.adjustmentStatus || "").toUpperCase() !== "REQUESTED"
    );
  },

  canApprove(task, adjustment = null) {
    const user = UserContext.requireUser();
    return Boolean(
      user.active === true &&
      approvalUserId(task) === user.uid &&
      (!adjustment || String(adjustment.status || "").toUpperCase() === "PENDING")
    );
  },

  async request(task, data = {}) {
    const user = UserContext.requireUser();
    if (!this.canRequest(task)) throw new Error("Nhiệm vụ không đủ điều kiện gửi đề nghị điều chỉnh.");
    const reason = clean(data.reason, 3000);
    if (!reason) throw new Error("Hãy nêu lý do điều chỉnh hoặc điều động.");
    const requestedType = Object.values(TYPES).includes(String(data.adjustmentType || "").toUpperCase())
      ? String(data.adjustmentType).toUpperCase()
      : TYPES.ADJUST_SCOPE;
    const approverId = approvalUserId(task);
    if (!approverId) throw new Error("Nhiệm vụ chưa xác định người giao để phê duyệt điều chỉnh.");
    const reference = FirebaseService.doc(FirebaseService.collection(FirebaseService.db, COLLECTION));
    const payload = {
      recordType: "TASK_ADJUSTMENT",
      taskId: task.id,
      taskCode: task.taskCode || "",
      periodId: task.periodId || "",
      departmentId: task.primaryDepartmentId || "",
      userId: user.uid,
      userName: user.fullName || "",
      adjustmentType: requestedType,
      adjustmentLabel: label(requestedType),
      status: "PENDING",
      reason,
      evidenceText: clean(data.evidenceText, 3000),
      originalPlanSnapshot: task.originalPlanSnapshot || planSnapshot(task),
      proposedSnapshot: {
        description: clean(data.description || task.description, 5000),
        adjustedWorkload: clean(data.adjustedWorkload, 1000),
        deadlineDateKey: clean(data.deadlineDateKey, 10)
      },
      approverUserId: approverId,
      approverName: task.adjustmentApproverName || task.assignedByName || task.createdByName || "",
      createdAt: FirebaseService.serverTimestamp(),
      createdByUserId: user.uid,
      createdByName: user.fullName || "",
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: user.uid
    };
    const batch = FirebaseService.writeBatch(FirebaseService.db);
    batch.set(reference, payload);
    batch.update(taskRef(task.id), {
      adjustmentStatus: "REQUESTED",
      adjustmentType: requestedType,
      adjustmentLabel: label(requestedType),
      pendingAdjustmentId: reference.id,
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: user.uid,
      updatedByName: user.fullName || ""
    });
    batch.set(logRef(), TaskLogService.buildTaskLog({
      taskId: task.id,
      taskCode: task.taskCode,
      action: "TASK_ADJUSTMENT_REQUESTED",
      before: planSnapshot(task),
      after: payload.proposedSnapshot,
      note: reason
    }));
    await batch.commit();
    TaskNotificationService.send("TASK_ADJUSTMENT_REQUESTED", task.id);
    return { id: reference.id, ...payload };
  },

  async approve(task, adjustment, decisionType = "") {
    const user = UserContext.requireUser();
    if (!this.canApprove(task, adjustment)) throw new Error("Chỉ người giao nhiệm vụ được phê duyệt điều chỉnh này.");
    const approvedType = Object.values(TYPES).includes(String(decisionType || "").toUpperCase())
      ? String(decisionType).toUpperCase()
      : adjustment.adjustmentType;
    const proposed = adjustment.proposedSnapshot || {};
    const taskChanges = {
      originalPlanSnapshot: task.originalPlanSnapshot || adjustment.originalPlanSnapshot || planSnapshot(task),
      adjustmentStatus: "APPROVED",
      adjustmentType: approvedType,
      adjustmentLabel: label(approvedType),
      pendingAdjustmentId: "",
      lastAdjustmentId: adjustment.id,
      lastAdjustmentApprovedAt: FirebaseService.serverTimestamp(),
      lastAdjustmentApprovedByUserId: user.uid,
      lastAdjustmentApprovedByName: user.fullName || "",
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: user.uid,
      updatedByName: user.fullName || ""
    };
    if (approvedType === TYPES.EXEMPT_FROM_SCORING) {
      Object.assign(taskChanges, {
        includedInA: false,
        scoringEnabled: false,
        scoringStatus: "ADJUSTMENT_EXEMPT",
        recognized: false
      });
    } else {
      Object.assign(taskChanges, {
        includedInA: true,
        scoringEnabled: true,
        scoringStatus: String(task.scoringStatus || "").toUpperCase() === "ADJUSTMENT_EXEMPT"
          ? "NOT_ASSESSED"
          : (task.scoringStatus || "NOT_ASSESSED"),
        adjustedWorkload: clean(proposed.adjustedWorkload, 1000),
        description: clean(proposed.description || task.description, 5000)
      });
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(proposed.deadlineDateKey || ""))) {
        taskChanges.deadlineDateKey = proposed.deadlineDateKey;
        taskChanges.deadline = FirebaseService.Timestamp.fromDate(new Date(`${proposed.deadlineDateKey}T23:59:59`));
      }
    }
    const batch = FirebaseService.writeBatch(FirebaseService.db);
    batch.update(taskRef(task.id), taskChanges);
    batch.update(FirebaseService.doc(FirebaseService.db, COLLECTION, adjustment.id), {
      status: "APPROVED",
      approvedDecisionType: approvedType,
      approvedDecisionLabel: label(approvedType),
      approvedAt: FirebaseService.serverTimestamp(),
      approvedByUserId: user.uid,
      approvedByName: user.fullName || "",
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: user.uid
    });
    batch.set(logRef(), TaskLogService.buildTaskLog({
      taskId: task.id,
      taskCode: task.taskCode,
      action: "TASK_ADJUSTMENT_APPROVED",
      before: adjustment.originalPlanSnapshot || planSnapshot(task),
      after: { ...proposed, decisionType: approvedType },
      note: adjustment.reason || ""
    }));
    await batch.commit();
    TaskNotificationService.send("TASK_ADJUSTMENT_APPROVED", task.id);
  },

  async reject(task, adjustment, reason) {
    const user = UserContext.requireUser();
    if (!this.canApprove(task, adjustment)) throw new Error("Chỉ người giao nhiệm vụ được xử lý đề nghị này.");
    const normalizedReason = clean(reason, 2000);
    if (!normalizedReason) throw new Error("Hãy nêu lý do không chấp thuận.");
    const batch = FirebaseService.writeBatch(FirebaseService.db);
    batch.update(FirebaseService.doc(FirebaseService.db, COLLECTION, adjustment.id), {
      status: "REJECTED",
      rejectionReason: normalizedReason,
      rejectedAt: FirebaseService.serverTimestamp(),
      rejectedByUserId: user.uid,
      rejectedByName: user.fullName || "",
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: user.uid
    });
    batch.update(taskRef(task.id), {
      adjustmentStatus: "REJECTED",
      pendingAdjustmentId: "",
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: user.uid,
      updatedByName: user.fullName || ""
    });
    batch.set(logRef(), TaskLogService.buildTaskLog({
      taskId: task.id,
      taskCode: task.taskCode,
      action: "TASK_ADJUSTMENT_REJECTED",
      note: normalizedReason
    }));
    await batch.commit();
    TaskNotificationService.send("TASK_ADJUSTMENT_REJECTED", task.id);
  }
});
