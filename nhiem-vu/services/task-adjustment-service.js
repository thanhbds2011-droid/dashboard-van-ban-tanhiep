/**
 * Quy trình đề nghị và phê duyệt điều chỉnh nhiệm vụ.
 * Không chuyển điểm giữa nhân sự; mọi thay đổi được lưu trong kpiAdjustments và taskLogs.
 */
import { FirebaseService } from "../core/firebase-service.js?v=20260826.V1_18_5";
import { UserContext } from "../core/user-context.js?v=20260826.V1_18_5";
import { TaskLogService } from "./task-log-service.js?v=20260826.V1_18_5";
import { TaskNotificationService } from "./task-notification-service.js?v=20260826.V1_18_5";
import { TaskMilestoneService } from "./task-milestone-service.js?v=20260826.V1_18_5";
import { daysInMonth, deadlineDateFromKey } from "../core/deadline-engine.js?v=20260826.V1_18_5";

const COLLECTION = "kpiAdjustments";
const TYPES = Object.freeze({
  ADJUST_SCOPE: "ADJUST_SCOPE",
  EXEMPT_FROM_SCORING: "EXEMPT_FROM_SCORING"
});

function clean(value, max = 3000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function validDateKey(value) {
  const text = clean(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
  const date = new Date(`${text}T12:00:00`);
  return Number.isNaN(date.getTime()) ? "" : text;
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
    scoringEnabled: task.scoringEnabled !== false,
    scoringStatus: task.scoringStatus || "NOT_ASSESSED"
  };
}

function approvalUserId(task) {
  return clean(task.adjustmentApproverUserId || task.assignedByUserId || task.createdByUserId, 200);
}

function label(type) {
  return type === TYPES.EXEMPT_FROM_SCORING
    ? "Miễn đánh giá do điều động"
    : "Điều chỉnh khối lượng/phạm vi";
}

function taskRef(taskId) {
  return FirebaseService.doc(FirebaseService.db, "tasks", taskId);
}

function adjustmentRef(adjustmentId) {
  return FirebaseService.doc(FirebaseService.db, COLLECTION, adjustmentId);
}

function logRef() {
  return FirebaseService.doc(FirebaseService.collection(FirebaseService.db, "taskLogs"));
}

function monthlyTask(task) {
  return String(task?.milestoneMode || "").toUpperCase() === "MONTHLY";
}

function dailyOrWeeklyTask(task) {
  return ["DAILY", "WEEKLY"].includes(String(task?.milestoneMode || "").toUpperCase());
}

function adjustedMonthDateKey(existingDateKey, newDay) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(validDateKey(existingDateKey));
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Math.min(Math.max(1, Number(newDay)), daysInMonth(year, month));
  return `${match[1]}-${match[2]}-${String(day).padStart(2, "0")}`;
}

async function loadTaskMilestones(task) {
  return TaskMilestoneService.list(task);
}

function completedTask(task) {
  return Boolean(
    task?.completedAt ||
    ["HOAN_THANH", "COMPLETED", "DA_HOAN_THANH"].includes(String(task?.status || "").toUpperCase())
  );
}

function pendingStatus(task) {
  return String(task?.adjustmentStatus || "").toUpperCase() === "REQUESTED" || Boolean(clean(task?.pendingAdjustmentId, 200));
}

function normalizeAdjustmentType(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return Object.values(TYPES).includes(normalized) ? normalized : "";
}

function baseRequestAllowed(task, user) {
  const scoringStatus = String(task?.scoringStatus || "").trim().toUpperCase();
  return Boolean(
    task?.active !== false &&
    task?.ownerUserId === user?.uid &&
    task?.scoreLocked !== true &&
    !["CONFIRMED", "ADJUSTMENT_EXEMPT", "NO_OCCURRENCE_CONFIRMED"].includes(scoringStatus) &&
    String(task?.noOccurrenceStatus || "").trim().toUpperCase() !== "CONFIRMED" &&
    !pendingStatus(task)
  );
}

function requestAllowedForType(task, user, requestedType) {
  if (!baseRequestAllowed(task, user)) return false;
  if (requestedType === TYPES.EXEMPT_FROM_SCORING) {
    /*
     * Có thể đề nghị miễn đánh giá cả khi nhiệm vụ đã được đánh dấu hoàn thành,
     * miễn là điểm chưa được xác nhận/khóa. Tình huống này dùng cho điều động,
     * đi học, nuôi bệnh hoặc lý do khách quan được người giao nhiệm vụ phê duyệt.
     */
    return true;
  }
  return requestedType === TYPES.ADJUST_SCOPE && !completedTask(task);
}

function proposedSnapshot(task, data, type) {
  if (type === TYPES.EXEMPT_FROM_SCORING) {
    return {
      description: task.description || "",
      adjustedWorkload: "",
      deadlineDateKey: task.deadlineDateKey || ""
    };
  }
  const description = clean(data.description || task.description, 5000);
  const adjustedWorkload = clean(data.adjustedWorkload, 1000);
  const deadlineDateKey = validDateKey(data.deadlineDateKey);
  if (dailyOrWeeklyTask(task) && deadlineDateKey && deadlineDateKey !== task.deadlineDateKey) {
    throw new Error("Đầu việc Theo ngày/Theo tuần dùng quy tắc mốc tự động trong cả kỳ. Không thể đổi chỉ ngày mốc cuối; hãy điều chỉnh chu kỳ/thời hạn ở danh mục cho kỳ tiếp theo để tránh làm sai toàn bộ các mốc đã duyệt.");
  }
  if (monthlyTask(task) && deadlineDateKey && deadlineDateKey !== task.deadlineDateKey) {
    const currentFinal = validDateKey(task.deadlineDateKey);
    if (!currentFinal || deadlineDateKey.slice(0, 7) !== currentFinal.slice(0, 7)) {
      throw new Error("Nhiệm vụ Theo tháng chỉ được điều chỉnh ngày của các mốc trong cùng kỳ; không được chuyển mốc cuối sang tháng/kỳ khác.");
    }
  }
  if (!adjustedWorkload && description === clean(task.description, 5000) && (!deadlineDateKey || deadlineDateKey === task.deadlineDateKey)) {
    throw new Error("Hãy nêu ít nhất một nội dung cần điều chỉnh: khối lượng, nội dung hoặc thời hạn.");
  }
  return { description, adjustedWorkload, deadlineDateKey };
}

export const TaskAdjustmentService = Object.freeze({
  TYPES,
  label,

  async list(taskOrId) {
    const task = taskOrId && typeof taskOrId === "object" ? taskOrId : null;
    const taskId = clean(task?.id || taskOrId, 200);
    if (!taskId) return [];

    const user = UserContext.requireUser();
    const constraints = [FirebaseService.where("taskId", "==", taskId)];
    const approverId = task ? approvalUserId(task) : "";
    const role = String(user.role || "").toUpperCase();
    const sameDepartment = clean(task?.primaryDepartmentId, 30).toUpperCase()
      === clean(user.departmentId, 30).toUpperCase();

    /*
     * Firestore Rules không tự lọc dữ liệu. Truy vấn của người dùng thường phải
     * mang theo điều kiện userId/approverUserId/departmentId để Rules chứng minh
     * toàn bộ kết quả đều thuộc phạm vi được phép đọc.
     */
    if (task?.ownerUserId === user.uid) {
      constraints.push(FirebaseService.where("userId", "==", user.uid));
    } else if (approverId === user.uid) {
      constraints.push(FirebaseService.where("approverUserId", "==", user.uid));
    } else if (["ADMIN", "DIRECTOR", "TCHC_COORDINATOR"].includes(role)) {
      // Tài khoản xem toàn Trung tâm được phép đọc theo taskId.
    } else if (role === "DEPARTMENT_LEADER" && sameDepartment) {
      constraints.push(FirebaseService.where("departmentId", "==", clean(task.primaryDepartmentId, 30)));
    } else {
      return [];
    }

    const snapshot = await FirebaseService.getDocs(
      FirebaseService.query(
        FirebaseService.collection(FirebaseService.db, COLLECTION),
        ...constraints
      )
    );
    return snapshot.docs
      .map(item => ({ id: item.id, ...item.data() }))
      .filter(item => item.recordType === "TASK_ADJUSTMENT")
      .sort((a, b) => Number(b.createdAt?.seconds || 0) - Number(a.createdAt?.seconds || 0));
  },

  canRequest(task, requestedType = "") {
    const user = UserContext.requireUser();
    const normalizedType = normalizeAdjustmentType(requestedType);
    if (normalizedType) return requestAllowedForType(task, user, normalizedType);
    return requestAllowedForType(task, user, TYPES.ADJUST_SCOPE)
      || requestAllowedForType(task, user, TYPES.EXEMPT_FROM_SCORING);
  },

  canApprove(task, adjustment = null) {
    const user = UserContext.requireUser();
    return Boolean(
      user.active === true &&
      approvalUserId(task) === user.uid &&
      (!adjustment || String(adjustment.status || "").toUpperCase() === "PENDING") &&
      (!adjustment || adjustment.approverUserId === user.uid)
    );
  },

  async request(task, data = {}) {
    const user = UserContext.requireUser();
    const requestedType = normalizeAdjustmentType(data.adjustmentType) || TYPES.ADJUST_SCOPE;
    if (!this.canRequest(task, requestedType)) {
      const scoringStatus = String(task?.scoringStatus || "").trim().toUpperCase();
      if (task?.scoreLocked === true || scoringStatus === "CONFIRMED") {
        throw new Error("Nhiệm vụ đã khóa hoặc đã xác nhận điểm nên không thể gửi đề nghị miễn/điều chỉnh.");
      }
      if (pendingStatus(task)) {
        throw new Error("Nhiệm vụ đã có một đề nghị đang chờ phê duyệt.");
      }
      if (completedTask(task) && requestedType === TYPES.ADJUST_SCOPE) {
        throw new Error("Nhiệm vụ đã hoàn thành; chỉ có thể chọn “Miễn đánh giá do điều động” nếu điểm chưa được khóa.");
      }
      throw new Error("Nhiệm vụ không đủ điều kiện gửi đề nghị hoặc tài khoản không phải người phụ trách.");
    }
    const reason = clean(data.reason, 3000);
    if (!reason) throw new Error("Hãy nêu lý do điều chỉnh hoặc điều động.");
    const approverId = approvalUserId(task);
    if (!approverId) throw new Error("Nhiệm vụ chưa xác định người giao để phê duyệt điều chỉnh.");
    const reference = FirebaseService.doc(FirebaseService.collection(FirebaseService.db, COLLECTION));
    const proposed = proposedSnapshot(task, data, requestedType);
    const evidenceUrl = clean(data.evidenceUrl, 2000);
    const evidenceFileName = clean(data.evidenceFileName, 500);
    const evidenceStoragePath = clean(data.evidenceStoragePath, 500);
    const evidenceText = clean(data.evidenceText, 3000);
    const payload = {
      recordType: "TASK_ADJUSTMENT",
      taskId: task.id,
      taskCode: clean(task.taskCode, 120),
      periodId: clean(task.periodId, 120),
      departmentId: clean(task.primaryDepartmentId, 30),
      userId: user.uid,
      userName: clean(user.fullName, 300),
      adjustmentType: requestedType,
      adjustmentLabel: label(requestedType),
      status: "PENDING",
      reason,
      evidenceText,
      evidenceUrl,
      evidenceFileName,
      evidenceStoragePath,
      originalPlanSnapshot: task.originalPlanSnapshot || planSnapshot(task),
      proposedSnapshot: proposed,
      approverUserId: approverId,
      approverName: clean(task.adjustmentApproverName || task.assignedByName || task.createdByName, 300),
      createdAt: FirebaseService.serverTimestamp(),
      createdByUserId: user.uid,
      createdByName: clean(user.fullName, 300),
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: user.uid,
      updatedByName: clean(user.fullName, 300)
    };
    const batch = FirebaseService.writeBatch(FirebaseService.db);
    batch.set(reference, payload);
    batch.update(taskRef(task.id), {
      adjustmentStatus: "REQUESTED",
      adjustmentType: requestedType,
      adjustmentLabel: label(requestedType),
      adjustmentReason: reason,
      adjustmentEvidenceText: evidenceText,
      adjustmentEvidenceUrl: evidenceUrl,
      adjustmentEvidenceFileName: evidenceFileName,
      adjustmentEvidenceStoragePath: evidenceStoragePath,
      pendingAdjustmentId: reference.id,
      adjustmentRequestedAt: FirebaseService.serverTimestamp(),
      adjustmentRequestedByUserId: user.uid,
      adjustmentRequestedByName: clean(user.fullName, 300),
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: user.uid,
      updatedByName: clean(user.fullName, 300)
    });
    batch.set(logRef(), TaskLogService.buildTaskLog({
      taskId: task.id,
      taskCode: task.taskCode,
      periodId: task.periodId || "",
      action: "TASK_ADJUSTMENT_REQUESTED",
      before: planSnapshot(task),
      after: { ...proposed, adjustmentType: requestedType, adjustmentLabel: label(requestedType) },
      note: reason
    }));
    try {
      await batch.commit();
    } catch (error) {
      console.error("TASK_ADJUSTMENT_REQUEST_FAILED", {
        taskId: task.id,
        taskCode: task.taskCode || "",
        ownerUserId: task.ownerUserId || "",
        requestedByUserId: user.uid,
        approverUserId: approverId,
        adjustmentType: requestedType,
        status: task.status || "",
        completedAt: task.completedAt || null,
        scoringStatus: task.scoringStatus || "",
        scoreLocked: task.scoreLocked === true,
        code: error?.code || "",
        message: error?.message || String(error)
      });
      throw error;
    }
    void TaskNotificationService.send("TASK_ADJUSTMENT_REQUESTED", task.id, {
      adjustmentType: requestedType,
      adjustmentLabel: label(requestedType),
      adjustmentReason: reason
    });
    return { id: reference.id, ...payload };
  },

  async approve(task, adjustment) {
    const user = UserContext.requireUser();
    if (!this.canApprove(task, adjustment)) throw new Error("Chỉ người giao nhiệm vụ được phê duyệt đề nghị này.");
    const approvedType = Object.values(TYPES).includes(String(adjustment.adjustmentType || "").toUpperCase())
      ? String(adjustment.adjustmentType).toUpperCase()
      : TYPES.ADJUST_SCOPE;
    const proposed = adjustment.proposedSnapshot || {};
    const proposedDeadlineDateKey = validDateKey(proposed.deadlineDateKey);
    const deadlineIsChanging = Boolean(proposedDeadlineDateKey && proposedDeadlineDateKey !== validDateKey(task.deadlineDateKey));
    const milestones = approvedType === TYPES.ADJUST_SCOPE && monthlyTask(task) && deadlineIsChanging
      ? await loadTaskMilestones(task)
      : [];
    const taskChanges = {
      originalPlanSnapshot: task.originalPlanSnapshot || adjustment.originalPlanSnapshot || planSnapshot(task),
      adjustmentStatus: "APPROVED",
      adjustmentType: approvedType,
      adjustmentLabel: label(approvedType),
      adjustmentReason: clean(adjustment.reason, 3000),
      adjustmentEvidenceText: clean(adjustment.evidenceText, 3000),
      adjustmentEvidenceUrl: clean(adjustment.evidenceUrl, 2000),
      adjustmentEvidenceFileName: clean(adjustment.evidenceFileName, 500),
      adjustmentEvidenceStoragePath: clean(adjustment.evidenceStoragePath, 500),
      pendingAdjustmentId: "",
      lastAdjustmentId: adjustment.id,
      lastAdjustmentApprovedAt: FirebaseService.serverTimestamp(),
      lastAdjustmentApprovedByUserId: user.uid,
      lastAdjustmentApprovedByName: clean(user.fullName, 300),
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: user.uid,
      updatedByName: clean(user.fullName, 300)
    };
    if (approvedType === TYPES.EXEMPT_FROM_SCORING) {
      Object.assign(taskChanges, {
        includedInA: false,
        scoringEnabled: false,
        scoringStatus: "ADJUSTMENT_EXEMPT",
        recognized: false,
        selfExecutionScore: null,
        selfActualScore: null,
        confirmedExecutionScore: null,
        confirmedActualScore: null
      });
    } else {
      Object.assign(taskChanges, {
        includedInA: task.includedInA === true,
        scoringEnabled: task.scoringEnabled !== false,
        scoringStatus: task.scoringStatus || "NOT_ASSESSED",
        adjustedWorkload: clean(proposed.adjustedWorkload, 1000),
        description: clean(proposed.description || task.description, 5000)
      });
      const deadlineDateKey = proposedDeadlineDateKey;
      if (deadlineDateKey) {
        if (monthlyTask(task) && deadlineIsChanging) {
          if (!milestones.length) throw new Error("Không tìm thấy các mốc tháng để điều chỉnh thời hạn an toàn.");
          const finalMilestone = milestones[milestones.length - 1];
          if (!finalMilestone || deadlineDateKey.slice(0, 7) !== String(finalMilestone.dueDateKey || "").slice(0, 7)) {
            throw new Error("Hạn đề xuất phải nằm trong tháng của mốc cuối kỳ hiện tại.");
          }
          taskChanges.completionDeadline = deadlineDateKey.slice(-2);
        }
        taskChanges.deadlineDateKey = deadlineDateKey;
        taskChanges.deadline = FirebaseService.Timestamp.fromDate(deadlineDateFromKey(deadlineDateKey));
      }
    }
    const batch = FirebaseService.writeBatch(FirebaseService.db);
    if (monthlyTask(task) && deadlineIsChanging) {
      const requestedDay = Number(proposedDeadlineDateKey.slice(-2));
      milestones.forEach(item => {
        if (item.completedAt || String(item.status || "").toUpperCase() === "COMPLETED") return;
        const nextDateKey = adjustedMonthDateKey(item.dueDateKey, requestedDay);
        if (!nextDateKey) throw new Error(`Mốc ${item.id} có ngày hiện tại không hợp lệ.`);
        batch.update(FirebaseService.doc(FirebaseService.db, "taskMilestones", item.id), {
          originalDueDateKey: item.originalDueDateKey || item.dueDateKey || "",
          dueDateKey: nextDateKey,
          dueAt: FirebaseService.Timestamp.fromDate(deadlineDateFromKey(nextDateKey)),
          label: String(item.label || "").replace(/\d{2}\/\d{2}\/\d{4}/, `${nextDateKey.slice(8, 10)}/${nextDateKey.slice(5, 7)}/${nextDateKey.slice(0, 4)}`),
          deadlineAdjustedAt: FirebaseService.serverTimestamp(),
          deadlineAdjustedByUserId: user.uid,
          deadlineAdjustedByName: clean(user.fullName, 300),
          updatedAt: FirebaseService.serverTimestamp(),
          updatedByUserId: user.uid,
          updatedByName: clean(user.fullName, 300)
        });
      });
    }
    batch.update(taskRef(task.id), taskChanges);
    batch.update(adjustmentRef(adjustment.id), {
      status: "APPROVED",
      approvedDecisionType: approvedType,
      approvedDecisionLabel: label(approvedType),
      approvedAt: FirebaseService.serverTimestamp(),
      approvedByUserId: user.uid,
      approvedByName: clean(user.fullName, 300),
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: user.uid,
      updatedByName: clean(user.fullName, 300)
    });
    batch.set(logRef(), TaskLogService.buildTaskLog({
      taskId: task.id,
      taskCode: task.taskCode,
      periodId: task.periodId || "",
      action: "TASK_ADJUSTMENT_APPROVED",
      before: adjustment.originalPlanSnapshot || planSnapshot(task),
      after: { ...proposed, decisionType: approvedType },
      note: adjustment.reason || ""
    }));
    await batch.commit();
    void TaskNotificationService.send("TASK_ADJUSTMENT_APPROVED", task.id, {
      adjustmentType: approvedType,
      adjustmentLabel: label(approvedType),
      adjustmentReason: adjustment.reason || ""
    });
  },

  async reject(task, adjustment, reason) {
    const user = UserContext.requireUser();
    if (!this.canApprove(task, adjustment)) throw new Error("Chỉ người giao nhiệm vụ được xử lý đề nghị này.");
    const normalizedReason = clean(reason, 2000);
    if (!normalizedReason) throw new Error("Hãy nêu lý do không chấp thuận.");
    const batch = FirebaseService.writeBatch(FirebaseService.db);
    batch.update(adjustmentRef(adjustment.id), {
      status: "REJECTED",
      rejectionReason: normalizedReason,
      rejectedAt: FirebaseService.serverTimestamp(),
      rejectedByUserId: user.uid,
      rejectedByName: clean(user.fullName, 300),
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: user.uid,
      updatedByName: clean(user.fullName, 300)
    });
    batch.update(taskRef(task.id), {
      adjustmentStatus: "REJECTED",
      pendingAdjustmentId: "",
      lastAdjustmentId: adjustment.id,
      lastAdjustmentRejectedAt: FirebaseService.serverTimestamp(),
      lastAdjustmentRejectedByUserId: user.uid,
      lastAdjustmentRejectedByName: clean(user.fullName, 300),
      lastAdjustmentRejectionReason: normalizedReason,
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: user.uid,
      updatedByName: clean(user.fullName, 300)
    });
    batch.set(logRef(), TaskLogService.buildTaskLog({
      taskId: task.id,
      taskCode: task.taskCode,
      periodId: task.periodId || "",
      action: "TASK_ADJUSTMENT_REJECTED",
      note: normalizedReason
    }));
    await batch.commit();
    void TaskNotificationService.send("TASK_ADJUSTMENT_REJECTED", task.id, {
      adjustmentType: adjustment.adjustmentType || "",
      adjustmentLabel: adjustment.adjustmentLabel || label(adjustment.adjustmentType),
      adjustmentReason: adjustment.reason || "",
      rejectionReason: normalizedReason
    });
  }
});
