/** Tạo, phân công, tiếp nhận, cập nhật tiến độ và hoàn thành nhiệm vụ. */
import { FirebaseService } from "../core/firebase-service.js";
import { UserContext } from "../core/user-context.js";
import { Permissions } from "../core/permissions.js?v=20260804.V1_8_2";
import { TaskLogService } from "./task-log-service.js";
import { TaskWorkItemService } from "./task-work-item-service.js?v=20260804.V1_8_2";
import { PeriodReadService } from "./period-read-service.js?v=20260804.V1_8_2";

const MAX_CODE_SCAN = 1000;

function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function normalizeDepartmentId(value) {
  return String(value || "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
}

function parseUnexpectedSequence(code, departmentId) {
  const prefix = normalizeDepartmentId(departmentId);
  const text = String(code || "").trim().toUpperCase();
  if (!prefix || !text) return 0;
  const match = new RegExp(`^${prefix}-DX(\\d+)$`).exec(text);
  return match ? Number(match[1]) || 0 : 0;
}

function formatUnexpectedTaskCode(departmentId, sequence) {
  const prefix = normalizeDepartmentId(departmentId);
  if (!prefix) throw new Error("Không xác định được mã Phòng/Khu để cấp mã nhiệm vụ.");
  const value = Math.max(1, Number(sequence || 0));
  const width = Math.max(2, String(value).length);
  return `${prefix}-DX${String(value).padStart(width, "0")}`;
}

async function getStartingSequence(departmentId, periodId) {
  const normalizedDepartmentId = normalizeDepartmentId(departmentId);
  const taskSnapshot = await FirebaseService.getDocsFromServer(
    FirebaseService.query(
      FirebaseService.collection(FirebaseService.db, "tasks"),
      FirebaseService.where("periodId", "==", periodId),
      FirebaseService.where("primaryDepartmentId", "==", normalizedDepartmentId),
      FirebaseService.limit(MAX_CODE_SCAN)
    )
  );

  const used = new Set();
  taskSnapshot.docs.forEach(snapshot => {
    const data = snapshot.data() || {};
    const status = String(data.status || "").toUpperCase();
    if (data.active === false || ["HUY", "CANCELLED", "DELETED"].includes(status)) return;
    const sequence = parseUnexpectedSequence(data.taskCode, normalizedDepartmentId);
    if (sequence > 0) used.add(sequence);
  });

  for (let sequence = 1; sequence <= MAX_CODE_SCAN; sequence += 1) {
    if (!used.has(sequence)) return sequence;
  }
  throw new Error("Dãy mã nhiệm vụ đột xuất trong kỳ đã vượt giới hạn cho phép.");
}

async function reserveTaskReference(transaction, departmentId, periodId, startingSequence) {
  for (let offset = 0; offset < MAX_CODE_SCAN; offset += 1) {
    const sequence = startingSequence + offset;
    const code = formatUnexpectedTaskCode(departmentId, sequence);
    const slotId = `${periodId}_${code}`.replace(/[^A-Za-z0-9_-]/g, "_");
    const slotReference = FirebaseService.doc(FirebaseService.db, "taskCodeReservations", slotId);
    const slotSnapshot = await transaction.get(slotReference);
    if (!slotSnapshot.exists() || slotSnapshot.data()?.active !== true) {
      const reference = FirebaseService.doc(FirebaseService.collection(FirebaseService.db, "tasks"));
      transaction.set(slotReference, {
        periodId,
        departmentId: normalizeDepartmentId(departmentId),
        taskCode: code,
        taskId: reference.id,
        active: true,
        reservedByUserId: UserContext.requireUser().uid,
        reservedAt: FirebaseService.serverTimestamp()
      });
      return { code, reference };
    }
  }
  throw new Error("Không thể cấp mã nhiệm vụ tiếp theo. Vui lòng thử lại.");
}

async function getActivePeriod() {
  return PeriodReadService.getActive();
}

function taskRef(taskId) {
  return FirebaseService.doc(FirebaseService.db, "tasks", taskId);
}

function logRef() {
  return FirebaseService.doc(FirebaseService.collection(FirebaseService.db, "taskLogs"));
}

function snapshotTask(task) {
  const allowed = [
    "status", "assignmentStatus", "progress", "ownerUserId", "ownerName",
    "ownerPosition", "teamId", "resultSummary", "evidenceUrl",
    "evidenceFileName", "deadline", "priority", "difficultyCoefficient",
    "maximumConvertedScore"
  ];
  return Object.fromEntries(allowed.map(key => [key, task?.[key] ?? null]));
}

export const TaskWriteService = Object.freeze({
  async create(data) {
    const user = UserContext.requireUser();
    if (!Permissions.canCreateUnexpectedTask()) {
      throw new Error("Tài khoản không có quyền giao nhiệm vụ phát sinh.");
    }

    const departmentId = normalizeDepartmentId(data.primaryDepartmentId);
    const activePeriod = await getActivePeriod();

    if (!activePeriod?.id) {
      throw new Error("Chưa có kỳ đánh giá đang hoạt động. Hãy mở kỳ trước khi giao nhiệm vụ đột xuất để nhiệm vụ được tính vào A.");
    }
    const startingSequence = await getStartingSequence(departmentId, activePeriod.id);

    const ownerUserId = data.ownerUserId || "";
    const supportIds = [...new Set((data.supportDepartmentIds || [])
      .map(normalizeDepartmentId)
      .filter(Boolean)
      .filter(id => id !== departmentId))];
    const visibleDepartments = [...new Set([departmentId, ...supportIds])];
    const visibleUsers = [...new Set([ownerUserId].filter(Boolean))];
    const assignmentStatus = ownerUserId ? "DA_PHAN_CONG" : "CHO_PHAN_CONG";
    const status = ownerUserId ? "MOI_TIEP_NHAN" : "CHO_PHAN_CONG";
    const entryMode = Permissions.isDirector() || Permissions.isAdmin()
      ? "DIRECT_ASSIGNED"
      : "DEPARTMENT_ASSIGNED";

    const coefficient = Number(data.difficultyCoefficient || 1);
    const baseScore = Number(data.baseScore || 12);
    const maximumConvertedScore = Math.round(baseScore * coefficient * 100) / 100;
    const trackingMode = String(data.trackingMode || "FINAL_OUTPUT").toUpperCase() === "ITEMIZED"
      ? "ITEMIZED"
      : "FINAL_OUTPUT";
    const workItemType = trackingMode === "ITEMIZED"
      ? TaskWorkItemService.normalizeWorkItemType(data.workItemType)
      : "GENERIC";
    const quantityUnit = workItemType === "QUANTITY" ? String(data.quantityUnit || "").trim() : "";
    if (workItemType === "QUANTITY" && !quantityUnit) {
      throw new Error("Hãy nhập đơn vị sản lượng, ví dụ: kg rau.");
    }

    const result = await FirebaseService.runTransaction(
      FirebaseService.db,
      async transaction => {
        const { code, reference } = await reserveTaskReference(
          transaction,
          departmentId,
          activePeriod.id,
          startingSequence
        );

        const payload = {
          appVersion: "1.8.2",
          active: true,
          taskCode: code,
          title: data.title,
          description: data.description || "",
          expectedOutput: data.expectedOutput || "",
          resultRequirement: data.resultRequirement || "",
          sixClearDirective: {
            person: data.ownerName || `Cấp ${departmentId}`,
            work: data.title || "",
            time: dateKey(data.deadline),
            responsibility: `${departmentId} chịu trách nhiệm chính; ${data.ownerName || "cấp Phòng/Khu"} chịu trách nhiệm thực hiện và báo cáo.`,
            product: data.expectedOutput || "",
            result: data.resultRequirement || ""
          },
          sourceType: data.sourceType || "GIAO_NHIEM_VU_DOT_XUAT",
          sourceReference: data.sourceReference || data.title,
          sourceDetail: data.sourceDetail || data.description || "",
          sourceDate: FirebaseService.Timestamp.fromDate(data.sourceDate || new Date()),
          sourceDateKey: dateKey(data.sourceDate || new Date()),
          entryMode,
          primaryDepartmentId: departmentId,
          supportDepartmentIds: supportIds,
          relatedDepartmentIds: supportIds,
          visibleDepartmentIds: visibleDepartments,
          ownerUserId,
          ownerName: data.ownerName || "",
          ownerPosition: data.ownerPosition || "",
          teamId: String(data.teamId || "").toUpperCase(),
          visibleUserIds: visibleUsers,
          assignedByUserId: ownerUserId ? user.uid : "",
          assignedByName: ownerUserId ? (user.fullName || "") : "",
          assignedByPosition: ownerUserId ? (user.position || "") : "",
          adjustmentApproverUserId: user.uid,
          adjustmentApproverName: user.fullName || "",
          assignedAt: ownerUserId ? FirebaseService.serverTimestamp() : null,
          assignmentStatus,
          status,
          progress: 0,
          priority: "DOT_XUAT",
          deadline: FirebaseService.Timestamp.fromDate(data.deadline),
          deadlineDateKey: dateKey(data.deadline),
          standardTaskCode: "",
          standardTaskName: "",
          workType: "DOT_XUAT",
          baseScore,
          difficultyCoefficient: coefficient,
          maximumConvertedScore,
          mandatoryEvidence: data.mandatoryEvidence || "",
          trackingMode,
          workItemType,
          quantityUnit,
          confirmer: data.confirmer || user.fullName || "",
          scoringVersion: "KPI_2026_V1",
          periodId: activePeriod?.id || "",
          periodName: activePeriod?.name || "",
          planType: "DOT_XUAT",
          planApprovalStatus: "APPROVED",
          includedInA: true,
          scoringEnabled: true,
          scoringStatus: "NOT_ASSESSED",
          result: "",
          resultSummary: "",
          difficulties: "",
          proposal: "",
          evidenceType: "",
          evidenceUrl: "",
          evidenceLink: "",
          evidenceText: "",
          evidenceFileName: "",
          evidenceStoragePath: "",
          completedAt: null,
          createdAt: FirebaseService.serverTimestamp(),
          createdByUserId: user.uid,
          createdByName: user.fullName || "",
          createdByRole: user.role || "",
          updatedAt: FirebaseService.serverTimestamp(),
          updatedByUserId: user.uid,
          updatedByName: user.fullName || ""
        };

        transaction.set(reference, payload);
        transaction.set(logRef(), TaskLogService.buildTaskLog({
          taskId: reference.id,
          taskCode: code,
          periodId: activePeriod.id,
          action: "TASK_CREATED",
          after: {
            ...payload,
            createdAt: null,
            updatedAt: null,
            assignedAt: null
          },
          note: "Giao nhiệm vụ đột xuất; nhiệm vụ được tính vào A của kỳ đánh giá đang hoạt động."
        }));

        return { id: reference.id, ...payload };
      }
    );

    return result;
  },

  async assign(task, assignment) {
    const user = UserContext.requireUser();
    const before = snapshotTask(task);

    const ownerUserId = String(assignment?.ownerUserId || "").trim();
    const ownerName = String(assignment?.ownerName || "").trim();
    const ownerPosition = String(assignment?.ownerPosition || "").trim();
    const teamId = String(assignment?.teamId || "").trim();

    /*
     * Giữ nguyên các tài khoản đã có quyền xem nhiệm vụ và bổ sung
     * người vừa được phân công. Không thu hẹp visibleUserIds về một UID.
     */
    const currentVisibleUserIds = Array.isArray(task?.visibleUserIds)
      ? task.visibleUserIds.filter(Boolean)
      : [];

    const visibleUserIds = Array.from(new Set([
      ...currentVisibleUserIds,
      ...(ownerUserId ? [ownerUserId] : [])
    ]));

    /*
     * Luồng phân công nội bộ:
     * Ban Giám đốc giao Phòng/Khu → Phòng/Khu tiếp nhận
     * → Trưởng/Phó Phòng/Khu phân công cá nhân.
     */
    const payload = {
      assignmentMode: "DEPARTMENT_INTERNAL",

      ownerUserId,
      ownerName,
      ownerPosition,
      teamId,
      visibleUserIds,

      departmentAssignmentStatus: "ACCEPTED",

      assignedByUserId: user.uid,
      assignedByName: user.fullName || "",
      assignedByPosition: user.position || "",

      internalAssignedByUserId: user.uid,
      internalAssignedByName: user.fullName || "",
      internalAssignedByPosition: user.position || "",
      internalAssignedAt: FirebaseService.serverTimestamp(),

      adjustmentApproverUserId: user.uid,
      adjustmentApproverName: user.fullName || "",

      assignedAt: FirebaseService.serverTimestamp(),

      assignmentStatus: ownerUserId
        ? "DA_PHAN_CONG"
        : "CHO_PHAN_CONG",

      status: ownerUserId
        ? "MOI_TIEP_NHAN"
        : "CHO_PHAN_CONG",

      /* Người mới phải tự xác nhận tiếp nhận nhiệm vụ. */
      acceptedAt: null,
      acceptedByUserId: "",
      acceptedByName: "",

      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: user.uid,
      updatedByName: user.fullName || ""
    };

    try {
      await FirebaseService.updateDoc(taskRef(task.id), payload);
    } catch (error) {
      console.error("TASK_ASSIGN_UPDATE_DENIED", {
        taskId: task?.id || "",
        taskCode: task?.taskCode || "",
        currentUserId: user.uid,
        currentRole: user.role || "",
        currentLeaderLevel: user.leaderLevel || "",
        currentDepartmentId: user.departmentId || "",
        taskDepartmentId: task?.primaryDepartmentId || "",
        previousAssignmentMode: task?.assignmentMode || "",
        previousDepartmentAssignmentStatus: task?.departmentAssignmentStatus || "",
        newAssignmentMode: payload.assignmentMode,
        newDepartmentAssignmentStatus: payload.departmentAssignmentStatus,
        ownerUserId,
        ownerName,
        teamId,
        errorCode: error?.code || "",
        errorMessage: error?.message || String(error),
        error
      });
      throw error;
    }

    /*
     * Nhật ký là lớp kiểm toán bổ sung. Không để lỗi ghi nhật ký
     * làm hỏng thao tác phân công đã cập nhật thành công.
     */
    try {
      await FirebaseService.setDoc(logRef(), TaskLogService.buildTaskLog({
        taskId: task.id,
        taskCode: task.taskCode,
        periodId: task.periodId || "",
        action: "TASK_ASSIGNED",
        before,
        after: {
          ...before,
          ...payload,
          assignedAt: null,
          internalAssignedAt: null,
          updatedAt: null
        }
      }));
    } catch (logError) {
      console.warn(
        "Nhiệm vụ đã được phân công nhưng chưa ghi được nhật ký TASK_ASSIGNED:",
        logError
      );
    }
  },

  async accept(task) {
    const user = UserContext.requireUser();
    if (task.ownerUserId !== user.uid) throw new Error("Chỉ người được giao mới được xác nhận đã nhận nhiệm vụ.");
    if (task.active === false) throw new Error("Nhiệm vụ này không còn hiệu lực.");
    if (["HOAN_THANH", "COMPLETED", "DA_HOAN_THANH"].includes(String(task.status || "").toUpperCase()) || task.completedAt) {
      throw new Error("Nhiệm vụ đã hoàn thành nên không cần xác nhận tiếp nhận.");
    }
    if (task.assignmentStatus === "DA_TIEP_NHAN") throw new Error("Nhiệm vụ đã được tiếp nhận trước đó.");
    const payload = {
      assignmentStatus: "DA_TIEP_NHAN",
      status: "DANG_XU_LY",
      acceptedAt: FirebaseService.serverTimestamp(),
      acceptedByUserId: user.uid,
      acceptedByName: user.fullName || "",
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: user.uid,
      updatedByName: user.fullName || ""
    };
    await FirebaseService.updateDoc(taskRef(task.id), payload);

    // Nhật ký là lớp kiểm toán bổ sung, không được làm hỏng thao tác tiếp nhận hợp lệ.
    // Sau khi task đã cập nhật, Rules vẫn kiểm tra ownerUserId, assignmentStatus và updatedByUserId.
    try {
      await FirebaseService.setDoc(logRef(), TaskLogService.buildTaskLog({
        taskId: task.id,
        taskCode: task.taskCode,
        periodId: task.periodId || "",
        action: "TASK_ACCEPTED",
        before: snapshotTask(task),
        after: { ...snapshotTask(task), ...payload, acceptedAt: null, updatedAt: null }
      }));
    } catch (logError) {
      console.warn("Nhiệm vụ đã được tiếp nhận nhưng chưa ghi được nhật ký TASK_ACCEPTED:", logError);
    }
  },

  async updateProgress(task, changes) {
    const user = UserContext.requireUser();
    if (task.ownerUserId !== user.uid) throw new Error("Chỉ người thực hiện mới được cập nhật tiến độ và hoàn thành nhiệm vụ.");
    if (task.assignmentStatus !== "DA_TIEP_NHAN") {
      throw new Error("Bạn cần xác nhận đã nhận nhiệm vụ trước khi cập nhật tiến độ, kết quả hoặc minh chứng.");
    }
    const payload = {
      status: changes.status,
      progress: Number(changes.progress),
      progressNote: changes.progressNote || "",
      result: changes.resultSummary || "",
      resultSummary: changes.resultSummary || "",
      difficulties: changes.difficulties || "",
      proposal: changes.proposal || "",
      evidenceType: changes.evidenceType || "",
      evidenceUrl: changes.evidenceUrl || "",
      evidenceLink: changes.evidenceUrl || "",
      evidenceText: changes.evidenceText || "",
      evidenceFileName: changes.evidenceFileName || "",
      evidenceStoragePath: changes.evidenceStoragePath || "",
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: user.uid,
      updatedByName: user.fullName || ""
    };
    if (changes.status === "HOAN_THANH") {
      payload.progress = 100;
      payload.completedAt = FirebaseService.serverTimestamp();
      payload.completedByUserId = user.uid;
      payload.completedByName = user.fullName || "";
    }
    const batch = FirebaseService.writeBatch(FirebaseService.db);
    batch.update(taskRef(task.id), payload);
    batch.set(logRef(), TaskLogService.buildTaskLog({
      taskId: task.id,
      taskCode: task.taskCode,
      periodId: task.periodId || "",
      action: changes.status === "HOAN_THANH" ? "TASK_COMPLETED" : "PROGRESS_UPDATED",
      before: snapshotTask(task),
      after: { ...snapshotTask(task), ...payload, updatedAt: null, completedAt: null },
      note: changes.progressNote || ""
    }));
    await batch.commit();
  },

  async requestNoOccurrence(task, reason) {
    const user = UserContext.requireUser();
    const normalizedReason = String(reason || "").replace(/\s+/g, " ").trim().slice(0, 2000);
    if (task.ownerUserId !== user.uid) {
      throw new Error("Chỉ người thực hiện mới được đề nghị xác nhận không phát sinh.");
    }
    if (String(task.trackingMode || "").toUpperCase() !== "ITEMIZED") {
      throw new Error("Chỉ đầu việc theo từng lượt phát sinh mới áp dụng quy trình này.");
    }
    if (!normalizedReason) throw new Error("Hãy nêu lý do đầu việc không phát sinh trong kỳ.");
    if (task.scoreLocked === true || String(task.scoringStatus || "").toUpperCase() === "CONFIRMED") {
      throw new Error("Đánh giá đã khóa nên không thể gửi đề nghị.");
    }
    const items = await TaskWorkItemService.list(task.id);
    if (items.length) {
      throw new Error("Đầu việc đã có lượt phát sinh nên không thể đề nghị “Không phát sinh”.");
    }

    const payload = {
      noOccurrenceStatus: "REQUESTED",
      noOccurrenceReason: normalizedReason,
      noOccurrenceRequestedAt: FirebaseService.serverTimestamp(),
      noOccurrenceRequestedByUserId: user.uid,
      noOccurrenceRequestedByName: user.fullName || "",
      noOccurrenceConfirmedAt: null,
      noOccurrenceConfirmedByUserId: "",
      noOccurrenceConfirmedByName: "",
      noOccurrenceRejectionReason: "",
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: user.uid,
      updatedByName: user.fullName || ""
    };
    const batch = FirebaseService.writeBatch(FirebaseService.db);
    batch.update(taskRef(task.id), payload);
    batch.set(logRef(), TaskLogService.buildTaskLog({
      taskId: task.id,
      taskCode: task.taskCode,
      periodId: task.periodId || "",
      action: "NO_OCCURRENCE_REQUESTED",
      before: snapshotTask(task),
      after: {
        noOccurrenceStatus: "REQUESTED",
        noOccurrenceReason: normalizedReason,
        includedInA: task.includedInA !== false
      },
      note: normalizedReason
    }));
    await batch.commit();
  },

  async confirmNoOccurrence(task) {
    const user = UserContext.requireUser();
    if (task.ownerUserId === user.uid) {
      throw new Error("Người thực hiện không được tự xác nhận đề nghị “Không phát sinh” của chính mình.");
    }
    const sameDepartmentLeader = Permissions.isDepartmentHead() &&
      String(task.primaryDepartmentId || "") === String(user.departmentId || "");
    const otherDirectorForBgd = Permissions.isDirector() &&
      String(task.primaryDepartmentId || "") === "BGD";
    if (!(Permissions.isAdmin() || sameDepartmentLeader || otherDirectorForBgd)) {
      throw new Error("Chỉ Trưởng phòng, thành viên Ban Giám đốc phù hợp hoặc Admin được xác nhận.");
    }
    if (String(task.noOccurrenceStatus || "").toUpperCase() !== "REQUESTED") {
      throw new Error("Đầu việc chưa có đề nghị “Không phát sinh” đang chờ xác nhận.");
    }
    const items = await TaskWorkItemService.list(task.id);
    if (items.length) {
      throw new Error("Đầu việc đã có lượt phát sinh; không thể loại khỏi điểm A.");
    }

    const payload = {
      noOccurrenceStatus: "CONFIRMED",
      noOccurrenceConfirmedAt: FirebaseService.serverTimestamp(),
      noOccurrenceConfirmedByUserId: user.uid,
      noOccurrenceConfirmedByName: user.fullName || "",
      noOccurrenceRejectionReason: "",
      includedInA: false,
      scoringEnabled: false,
      scoringStatus: "NO_OCCURRENCE_CONFIRMED",
      recognized: false,
      selfExecutionScore: null,
      selfActualScore: null,
      confirmedExecutionScore: null,
      confirmedActualScore: null,
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: user.uid,
      updatedByName: user.fullName || ""
    };
    const batch = FirebaseService.writeBatch(FirebaseService.db);
    batch.update(taskRef(task.id), payload);
    batch.set(logRef(), TaskLogService.buildTaskLog({
      taskId: task.id,
      taskCode: task.taskCode,
      periodId: task.periodId || "",
      action: "NO_OCCURRENCE_CONFIRMED",
      before: {
        noOccurrenceStatus: task.noOccurrenceStatus || "",
        includedInA: task.includedInA !== false,
        scoringEnabled: task.scoringEnabled !== false
      },
      after: {
        noOccurrenceStatus: "CONFIRMED",
        includedInA: false,
        scoringEnabled: false,
        scoringStatus: "NO_OCCURRENCE_CONFIRMED"
      },
      note: "Đã xác nhận không phát sinh; loại đầu việc khỏi A và không cộng vào B của kỳ."
    }));
    await batch.commit();
  },

  async rejectNoOccurrence(task, reason) {
    const user = UserContext.requireUser();
    const normalizedReason = String(reason || "").replace(/\s+/g, " ").trim().slice(0, 2000);
    if (!normalizedReason) throw new Error("Hãy nêu lý do không chấp thuận.");
    if (task.ownerUserId === user.uid) {
      throw new Error("Người thực hiện không được tự xử lý đề nghị của chính mình.");
    }
    const sameDepartmentLeader = Permissions.isDepartmentHead() &&
      String(task.primaryDepartmentId || "") === String(user.departmentId || "");
    const otherDirectorForBgd = Permissions.isDirector() &&
      String(task.primaryDepartmentId || "") === "BGD";
    if (!(Permissions.isAdmin() || sameDepartmentLeader || otherDirectorForBgd)) {
      throw new Error("Tài khoản không có quyền xử lý đề nghị này.");
    }
    if (String(task.noOccurrenceStatus || "").toUpperCase() !== "REQUESTED") {
      throw new Error("Đầu việc không còn ở trạng thái chờ xác nhận.");
    }

    const payload = {
      noOccurrenceStatus: "REJECTED",
      noOccurrenceRejectionReason: normalizedReason,
      noOccurrenceRejectedAt: FirebaseService.serverTimestamp(),
      noOccurrenceRejectedByUserId: user.uid,
      noOccurrenceRejectedByName: user.fullName || "",
      includedInA: true,
      scoringEnabled: true,
      scoringStatus: "NOT_ASSESSED",
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: user.uid,
      updatedByName: user.fullName || ""
    };
    const batch = FirebaseService.writeBatch(FirebaseService.db);
    batch.update(taskRef(task.id), payload);
    batch.set(logRef(), TaskLogService.buildTaskLog({
      taskId: task.id,
      taskCode: task.taskCode,
      periodId: task.periodId || "",
      action: "NO_OCCURRENCE_REJECTED",
      before: { noOccurrenceStatus: task.noOccurrenceStatus || "" },
      after: { noOccurrenceStatus: "REJECTED", includedInA: true, scoringEnabled: true },
      note: normalizedReason
    }));
    await batch.commit();
  }
});
