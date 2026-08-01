import { FirebaseService } from "../core/firebase-service.js";
import { UserContext } from "../core/user-context.js";
import { Permissions } from "../core/permissions.js?v=20260801.V1_2_0";
import { TaskLogService } from "./task-log-service.js";
import { StandardTaskReadService } from "./standard-task-read-service.js?v=20260801.V1_2_0";
import { TaskNotificationService } from "./task-notification-service.js?v=20260801.V1_2_0";

const clean = value => String(value ?? "").trim();
const upper = value => clean(value).toUpperCase();
const lower = value => clean(value).toLowerCase();

function standardWorkType(value) {
  return upper(value) === "DOT_XUAT" ? "DOT_XUAT" : "THUONG_XUYEN";
}

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateAtStart(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean(value));
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0) : null;
}

function dateAtEnd(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean(value));
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 23, 59, 59) : null;
}

function registrationId(periodId, uid, standardTaskId) {
  return `${periodId}_${uid}_${standardTaskId}`.replace(/[^A-Za-z0-9_-]/g, "_");
}

function taskLogRef() {
  return FirebaseService.doc(FirebaseService.collection(FirebaseService.db, "taskLogs"));
}

async function activePeriod() {
  const snapshot = await FirebaseService.getDocs(
    FirebaseService.query(
      FirebaseService.collection(FirebaseService.db, "evaluationPeriods"),
      FirebaseService.where("active", "==", true)
    )
  );
  return snapshot.docs
    .map(item => ({ id: item.id, ...item.data() }))
    .find(period => upper(period.status) !== "DELETED") || null;
}

async function departmentPlan(periodId, departmentId) {
  if (!periodId || !departmentId) return null;
  const snapshot = await FirebaseService.getDoc(
    FirebaseService.doc(
      FirebaseService.db,
      "kpiPlans",
      `${periodId}_${upper(departmentId)}`
    )
  );
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

function delegationAllows(data, permissionName) {
  const permissions = Array.isArray(data?.permissions) ? data.permissions : [];
  if (permissions.includes(permissionName)) return true;
  return permissions.length === 0 && permissionName === "APPROVE_REGISTRATIONS";
}

async function hasDelegation(reviewer, departmentId, permissionName = "APPROVE_REGISTRATIONS") {
  if (!Permissions.isDepartmentDeputy(reviewer)) return false;
  const today = dateKey(new Date());
  const snapshot = await FirebaseService.getDoc(
    FirebaseService.doc(
      FirebaseService.db,
      "approvalDelegations",
      `${upper(departmentId)}_ACTIVE`
    )
  );
  if (!snapshot.exists()) return false;
  const data = snapshot.data();
  return (
    data.active === true &&
    data.delegateUserId === reviewer.uid &&
    upper(data.departmentId) === upper(departmentId) &&
    delegationAllows(data, permissionName) &&
    (!data.startDate || data.startDate <= today) &&
    (!data.endDate || data.endDate >= today)
  );
}

function canApprove(registration, reviewer) {
  if (!reviewer || reviewer.active !== true || !registration || registration.status !== "PENDING") return false;
  if (reviewer.role === "ADMIN") return true;

  if (registration.userRole === "DEPARTMENT_LEADER") {
    if (Permissions.isDepartmentDeputy({
      uid: registration.userId,
      active: true,
      role: registration.userRole,
      position: registration.userPosition,
      leaderLevel: registration.userLeaderLevel,
      isDepartmentHead: registration.userIsDepartmentHead
    })) {
      return Permissions.isDepartmentHead(reviewer) && upper(reviewer.departmentId) === upper(registration.departmentId);
    }
    return reviewer.role === "DIRECTOR";
  }

  return Permissions.isDepartmentHead(reviewer) && upper(reviewer.departmentId) === upper(registration.departmentId);
}

function endOfPeriod(period) {
  const parsed = dateAtEnd(period?.endDate);
  return parsed || new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 17, 0, 0);
}


function emptyTaskField(value) {
  return value === null || value === undefined || clean(value) === "";
}

function isUntouchedApprovedTask(task) {
  if (!task || task.active === false) return false;

  const status = upper(task.status);
  const assignmentStatus = upper(task.assignmentStatus);
  const scoringStatus = upper(task.scoringStatus);

  return (
    Number(task.progress || 0) === 0 &&
    assignmentStatus !== "DA_TIEP_NHAN" &&
    ["MOI_TIEP_NHAN", "CHO_PHAN_CONG", "DA_PHAN_CONG"].includes(status) &&
    emptyTaskField(task.acceptedAt) &&
    emptyTaskField(task.completedAt) &&
    emptyTaskField(task.result) &&
    emptyTaskField(task.resultSummary) &&
    emptyTaskField(task.evidenceUrl) &&
    emptyTaskField(task.evidenceLink) &&
    emptyTaskField(task.evidenceText) &&
    emptyTaskField(task.evidenceFileName) &&
    emptyTaskField(task.evidenceStoragePath) &&
    ["", "NOT_ASSESSED"].includes(scoringStatus)
  );
}

async function canCancelApprovedOwnRegistration(user, registration) {
  if (!registration || registration.userId !== user.uid) return false;
  if (upper(registration.status) !== "APPROVED" || !clean(registration.taskId)) return false;
  if (upper(registration.departmentId) !== upper(user.departmentId)) return false;
  if (Permissions.isDirector() && upper(user.departmentId) === "BGD") return true;
  if (!Permissions.isDepartmentLeader()) return false;
  if (Permissions.isDepartmentHead(user)) return true;

  return Permissions.isDepartmentDeputy(user)
    && await hasDelegation(user, registration.departmentId, "APPROVE_REGISTRATIONS");
}

function cancellationTaskSnapshot(task) {
  const fields = [
    "active", "status", "assignmentStatus", "progress", "ownerUserId", "ownerName",
    "primaryDepartmentId", "periodId", "registrationId", "includedInA",
    "scoringEnabled", "scoringStatus", "result", "resultSummary", "evidenceUrl",
    "evidenceText", "evidenceFileName"
  ];
  return Object.fromEntries(fields.map(key => [key, task?.[key] ?? null]));
}

function taskPayload(registration, reviewer, due, options = {}) {
  const code = upper(registration.standardTaskCode || registration.standardTaskId);
  if (!code) throw new Error("Đầu việc đăng ký chưa có mã danh mục hợp lệ.");
  const workType = standardWorkType(registration.workType);
  const isUnexpected = workType === "DOT_XUAT";
  const isSupplementary = upper(registration.registrationType) === "SUPPLEMENTARY";
  return {
    code,
    payload: {
      active: true,
      taskCode: code,
      title: registration.title || registration.standardTaskName,
      description: registration.description || "",
      sourceType: isSupplementary ? "DANG_KY_BO_SUNG" : "DANG_KY_KE_HOACH",
      sourceReference: registration.standardTaskCode || "",
      sourceDetail: isUnexpected ? "Đầu việc đột xuất trong danh mục được cá nhân đăng ký, phê duyệt và tính vào A." : "Đầu việc thường xuyên do cá nhân đăng ký và được phê duyệt.",
      sourceDate: FirebaseService.Timestamp.fromDate(new Date()),
      sourceDateKey: dateKey(new Date()),
      entryMode: isSupplementary ? "SELF_REGISTERED_SUPPLEMENTARY_APPROVED" : "SELF_REGISTERED_APPROVED",
      primaryDepartmentId: registration.departmentId,
      supportDepartmentIds: [],
      relatedDepartmentIds: [],
      visibleDepartmentIds: [registration.departmentId],
      ownerUserId: registration.userId,
      ownerName: registration.userName || "",
      ownerPosition: registration.userPosition || "",
      teamId: registration.teamId || "",
      visibleUserIds: [registration.userId],
      assignedByUserId: reviewer.uid,
      assignedByName: reviewer.fullName || "",
      assignedByPosition: reviewer.position || "",
      adjustmentApproverUserId: reviewer.uid,
      adjustmentApproverName: reviewer.fullName || "",
      assignedAt: FirebaseService.serverTimestamp(),
      assignmentStatus: "DA_PHAN_CONG",
      status: "MOI_TIEP_NHAN",
      progress: 0,
      priority: isUnexpected ? "DOT_XUAT" : "THUONG",
      deadline: FirebaseService.Timestamp.fromDate(due),
      deadlineDateKey: dateKey(due),
      standardTaskCode: registration.standardTaskCode || "",
      standardTaskName: registration.standardTaskName || "",
      registrationId: registration.id,
      workType,
      baseScore: Number(registration.baseScore || 0),
      difficultyCoefficient: Number(registration.difficultyCoefficient || 1),
      maximumConvertedScore: Number(registration.maximumConvertedScore || 0),
      mandatoryEvidence: registration.mandatoryEvidence || "",
      trackingMode: String(registration.trackingMode || "FINAL_OUTPUT").toUpperCase() === "ITEMIZED" ? "ITEMIZED" : "FINAL_OUTPUT",
      workItemType: String(registration.workItemType || "GENERIC").toUpperCase(),
      quantityUnit: String(registration.quantityUnit || "").trim(),
      confirmer: reviewer.fullName || "",
      scoringVersion: "KPI_2026_V1",
      periodId: registration.periodId,
      periodName: registration.periodName || registration.periodId,
      planType: isSupplementary ? "SUPPLEMENTARY" : (isUnexpected ? "DOT_XUAT" : "KE_HOACH"),
      registrationType: isSupplementary ? "SUPPLEMENTARY" : "PLANNED",
      isSupplementary,
      taskCategoryLabel: isSupplementary ? "Bổ sung phát sinh" : "",
      planApprovalStatus: "APPROVED",
      includedInA: true,
      isCoreTask: registration.isCoreTaskDefault === true,
      isManagementTask: registration.isManagementTask === true,
      audienceType: registration.audienceType || "ALL_DEPARTMENT",
      standardTaskDepartmentId: registration.standardTaskDepartmentId || registration.departmentId,
      organizationId: registration.standardTaskDepartmentId === "CDTN" ? "CDTN" : "",
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
      createdByUserId: reviewer.uid,
      createdByName: reviewer.fullName || "",
      createdByRole: reviewer.role || "",
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: reviewer.uid,
      updatedByName: reviewer.fullName || ""
    }
  };
}

async function createApprovedTasks(registrations, reviewer, options = {}) {
  const batch = FirebaseService.writeBatch(FirebaseService.db);
  const due = endOfPeriod({ endDate: options.periodEndDate || registrations[0]?.periodEndDate });
  const taskIds = [];

  for (const registration of registrations) {
    const { code, payload } = taskPayload(registration, reviewer, due, options);
    const taskReference = FirebaseService.doc(FirebaseService.collection(FirebaseService.db, "tasks"));
    const registrationReference = FirebaseService.doc(FirebaseService.db, "taskRegistrations", registration.id);

    batch.set(taskReference, payload);
    batch.set(registrationReference, {
      status: "APPROVED",
      taskId: taskReference.id,
      taskCode: code,
      approvedAt: FirebaseService.serverTimestamp(),
      approvedByUserId: reviewer.uid,
      approvedByName: reviewer.fullName || "",
      updatedAt: FirebaseService.serverTimestamp()
    }, { merge: true });
    batch.set(taskLogRef(), TaskLogService.buildTaskLog({
      taskId: taskReference.id,
      taskCode: code,
      action: "TASK_REGISTRATION_APPROVED",
      after: { ...payload, createdAt: null, updatedAt: null, assignedAt: null },
      note: `Duyệt ${registration.standardTaskCode || ""} của ${registration.userName || ""}.`
    }));
    taskIds.push(taskReference.id);
  }

  await batch.commit();
  taskIds.forEach(taskId => TaskNotificationService.send("TASK_CREATED", taskId));
  return taskIds;
}


function mapRegistrationSnapshot(snapshot) {
  return snapshot.docs
    .map(item => ({ id: item.id, ...item.data() }))
    .filter(item => item.active !== false);
}

export const TaskRegistrationService = Object.freeze({
  async getActivePeriod() {
    return activePeriod();
  },

  async getDepartmentPlan(periodId) {
    const user = UserContext.requireUser();
    return departmentPlan(periodId, user.departmentId);
  },

  async listForCurrentUser(periodId) {
    const user = UserContext.requireUser();
    if (!periodId) return [];
    const snapshot = await FirebaseService.getDocs(
      FirebaseService.query(
        FirebaseService.collection(FirebaseService.db, "taskRegistrations"),
        FirebaseService.where("periodId", "==", periodId),
        FirebaseService.where("userId", "==", user.uid)
      )
    );
    return snapshot.docs
      .map(item => ({ id: item.id, ...item.data() }))
      .filter(item => item.active !== false);
  },


  subscribeForCurrentUser(periodId, onData, onError) {
    const user = UserContext.requireUser();
    if (!periodId) {
      onData?.([]);
      return () => {};
    }
    const reference = FirebaseService.query(
      FirebaseService.collection(FirebaseService.db, "taskRegistrations"),
      FirebaseService.where("periodId", "==", periodId),
      FirebaseService.where("userId", "==", user.uid)
    );
    return FirebaseService.onSnapshot(
      reference,
      snapshot => onData?.(mapRegistrationSnapshot(snapshot)),
      error => {
        console.error("Không thể theo dõi đăng ký kế hoạch theo thời gian thực:", error);
        onError?.(error);
      }
    );
  },

  subscribeDepartmentPlan(periodId, onData, onError) {
    const user = UserContext.requireUser();
    if (!periodId || !user.departmentId) {
      onData?.(null);
      return () => {};
    }
    const reference = FirebaseService.doc(
      FirebaseService.db,
      "kpiPlans",
      `${periodId}_${upper(user.departmentId)}`
    );
    return FirebaseService.onSnapshot(
      reference,
      snapshot => onData?.(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null),
      error => {
        console.error("Không thể theo dõi trạng thái kế hoạch theo thời gian thực:", error);
        onError?.(error);
      }
    );
  },

  async registerMany(items, period) {
    const user = UserContext.requireUser();
    if (!Permissions.canRegisterStandardTasks()) throw new Error("Tài khoản không được đăng ký đầu việc chuẩn.");
    if (!period?.id) throw new Error("Chưa có kỳ đánh giá đang hoạt động.");
    if (!items?.length) throw new Error("Chưa chọn đầu việc để đăng ký.");

    const plan = await departmentPlan(period.id, user.departmentId);
    const supplementary = plan?.locked === true;

    const autoApprove = Permissions.isDepartmentHead(user) || Permissions.isDirector();
    const batch = FirebaseService.writeBatch(FirebaseService.db);
    const registrations = [];

    for (const item of items) {
      if (!StandardTaskReadService.canRegisterItem(item, user)) {
        throw new Error(`Vai trò hiện tại không thuộc đối tượng đăng ký đầu việc ${item.code || item.id || ""}.`);
      }
      const id = registrationId(period.id, user.uid, item.id || item.code);
      const workType = standardWorkType(item.workType);
      const registration = {
        id,
        periodId: period.id,
        periodName: period.name || period.id,
        periodEndDate: period.endDate || "",
        standardTaskId: item.id || item.code,
        standardTaskCode: item.code || item.id,
        standardTaskName: item.name || "",
        standardTaskDepartmentId: item.departmentId || user.departmentId || "",
        audienceType: item.audienceType || (item.isManagementTask === true ? "MANAGEMENT" : "ALL_DEPARTMENT"),
        isCoreTaskDefault: item.isCoreTaskDefault === true,
        isManagementTask: item.isManagementTask === true,
        title: item.name || "",
        description: item.outputRequirement || "",
        departmentId: user.departmentId || "",
        teamId: user.teamId || "",
        userId: user.uid,
        userName: user.fullName || "",
        userPosition: user.position || "",
        userRole: user.role || "",
        userLeaderLevel: user.leaderLevel || "",
        userIsDepartmentHead: user.isDepartmentHead === true,
        workType,
        planType: workType === "DOT_XUAT" ? "DOT_XUAT" : "KE_HOACH",
        registrationType: supplementary ? "SUPPLEMENTARY" : "PLANNED",
        submittedAfterPlanLock: supplementary,
        includedInA: true,
        baseScore: Number(item.baseScore || 0),
        difficultyCoefficient: Number(item.difficultyCoefficient || 1),
        maximumConvertedScore: Number(item.maximumConvertedScore || item.baseScore || 0),
        mandatoryEvidence: item.mandatoryEvidence || "",
        trackingMode: String(item.trackingMode || "FINAL_OUTPUT").toUpperCase() === "ITEMIZED" ? "ITEMIZED" : "FINAL_OUTPUT",
        workItemType: String(item.workItemType || "GENERIC").toUpperCase(),
        quantityUnit: String(item.quantityUnit || "").trim(),
        status: "PENDING",
        taskId: null,
        active: true,
        registeredAt: FirebaseService.serverTimestamp(),
        createdAt: FirebaseService.serverTimestamp(),
        createdByUserId: user.uid,
        updatedAt: FirebaseService.serverTimestamp()
      };
      batch.set(FirebaseService.doc(FirebaseService.db, "taskRegistrations", id), registration, { merge: true });
      registrations.push(registration);
    }

    await batch.commit();
    if (autoApprove) {
      await createApprovedTasks(registrations, user, { periodEndDate: period.endDate });
    }
    return items.length;
  },

  async approveMany(registrations, options = {}) {
    const reviewer = UserContext.requireUser();
    const selected = (registrations || []).filter(item => item?.status === "PENDING");
    if (!selected.length) throw new Error("Chưa chọn đầu việc để duyệt.");

    for (const item of selected) {
      const delegated = await hasDelegation(reviewer, item.departmentId, "APPROVE_REGISTRATIONS");
      if (!canApprove(item, reviewer) && !delegated) {
        throw new Error(`Bạn không có quyền duyệt đăng ký của ${item.userName || "người dùng"}.`);
      }
    }
    return createApprovedTasks(selected, reviewer, options);
  },

  async rejectMany(registrations, reason) {
    const reviewer = UserContext.requireUser();
    const selected = (registrations || []).filter(item => item?.status === "PENDING");
    if (!selected.length) throw new Error("Không có đăng ký để trả lại.");

    for (const item of selected) {
      const delegated = await hasDelegation(reviewer, item.departmentId, "APPROVE_REGISTRATIONS");
      if (!canApprove(item, reviewer) && !delegated) throw new Error("Bạn không có quyền trả lại đăng ký này.");
    }

    const batch = FirebaseService.writeBatch(FirebaseService.db);
    for (const item of selected) {
      batch.update(FirebaseService.doc(FirebaseService.db, "taskRegistrations", item.id), {
        status: "REJECTED",
        rejectionReason: clean(reason),
        rejectedAt: FirebaseService.serverTimestamp(),
        rejectedByUserId: reviewer.uid,
        rejectedByName: reviewer.fullName || "",
        updatedAt: FirebaseService.serverTimestamp()
      });
    }
    await batch.commit();
    return selected.length;
  },

  async getApprovedCancellationMap(registrations = []) {
    const user = UserContext.requireUser();
    const candidates = (registrations || []).filter(registration => (
      registration?.userId === user.uid &&
      upper(registration?.status) === "APPROVED" &&
      Boolean(clean(registration?.taskId)) &&
      upper(registration?.departmentId) === upper(user.departmentId)
    ));

    if (!candidates.length) return {};

    const authorized = Permissions.isDirector()
      || Permissions.isDepartmentHead(user)
      || (
        Permissions.isDepartmentDeputy(user) &&
        await hasDelegation(user, user.departmentId, "APPROVE_REGISTRATIONS")
      );

    if (!authorized) return {};

    const entries = await Promise.all(candidates.map(async registration => {
      try {
        const snapshot = await FirebaseService.getDoc(
          FirebaseService.doc(FirebaseService.db, "tasks", registration.taskId)
        );
        const task = snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
        return [registration.id, isUntouchedApprovedTask(task)];
      } catch (error) {
        console.warn("Không kiểm tra được điều kiện hủy đầu việc đã duyệt:", error);
        return [registration.id, false];
      }
    }));

    return Object.fromEntries(entries);
  },

  async cancelApprovedRegistration(registration, reason) {
    const user = UserContext.requireUser();
    const cancellationReason = clean(reason);

    if (!registration?.id) throw new Error("Không tìm thấy đăng ký cần hủy.");
    if (!cancellationReason) throw new Error("Vui lòng nhập lý do hủy đầu việc.");
    if (!(await canCancelApprovedOwnRegistration(user, registration))) {
      throw new Error("Tài khoản không có quyền hủy đầu việc đã duyệt này.");
    }

    const taskReference = FirebaseService.doc(
      FirebaseService.db,
      "tasks",
      registration.taskId
    );
    const taskSnapshot = await FirebaseService.getDoc(taskReference);

    if (!taskSnapshot.exists()) {
      throw new Error("Không tìm thấy nhiệm vụ đã hình thành từ đăng ký này.");
    }

    const task = { id: taskSnapshot.id, ...taskSnapshot.data() };
    if (!isUntouchedApprovedTask(task)) {
      throw new Error(
        "Chỉ được hủy khi nhiệm vụ chưa được tiếp nhận, chưa cập nhật tiến độ, kết quả hoặc minh chứng."
      );
    }

    const now = FirebaseService.serverTimestamp();
    const taskAfter = {
      active: false,
      status: "HUY",
      planApprovalStatus: "CANCELLED",
      includedInA: false,
      scoringEnabled: false,
      scoringStatus: "CANCELLED",
      deletedReason: cancellationReason,
      deletedAt: now,
      deletedByUserId: user.uid,
      deletedByName: user.fullName || "",
      updatedAt: now,
      updatedByUserId: user.uid,
      updatedByName: user.fullName || ""
    };

    const batch = FirebaseService.writeBatch(FirebaseService.db);
    batch.update(
      FirebaseService.doc(FirebaseService.db, "taskRegistrations", registration.id),
      {
        active: false,
        status: "CANCELLED",
        cancelReason: cancellationReason,
        cancelledAt: now,
        cancelledByUserId: user.uid,
        cancelledByName: user.fullName || "",
        updatedAt: now
      }
    );
    batch.update(taskReference, taskAfter);
    batch.set(taskLogRef(), TaskLogService.buildTaskLog({
      taskId: task.id,
      taskCode: task.taskCode || registration.taskCode || "",
      action: "TASK_REGISTRATION_CANCELLED",
      before: cancellationTaskSnapshot(task),
      after: {
        ...cancellationTaskSnapshot(task),
        active: false,
        status: "HUY",
        includedInA: false,
        scoringEnabled: false,
        scoringStatus: "CANCELLED"
      },
      note: `Hủy đầu việc đã duyệt trước khi tiếp nhận. Lý do: ${cancellationReason}`
    }));

    await batch.commit();
  },

  async cancelRegistration(registration, options = {}) {
    const user = UserContext.requireUser();
    if (!registration?.id) throw new Error("Không tìm thấy đăng ký cần hủy.");
    if (clean(registration.taskId)) throw new Error("Đăng ký đã hình thành nhiệm vụ nên không thể hủy tại đây.");

    const plan = await departmentPlan(registration.periodId, registration.departmentId);
    const planLocked = plan?.locked === true;
    const asManager = options.asManager === true;
    const delegated = asManager
      ? await hasDelegation(user, registration.departmentId, "APPROVE_REGISTRATIONS")
      : false;

    const allowed = Permissions.canCancelRegistration(registration, {
      asManager,
      planLocked,
      hasDelegation: delegated
    });

    if (!allowed) {
      if (!asManager && planLocked) {
        throw new Error("Kế hoạch đã khóa. Người đăng ký không thể tự hủy đầu việc; Trưởng phòng hoặc Phó Trưởng phòng được ủy quyền sẽ xử lý khi cần.");
      }
      if (asManager && !planLocked) {
        throw new Error("Kế hoạch đang mở. Người đăng ký có thể tự hủy đầu việc của mình.");
      }
      throw new Error("Tài khoản không có quyền hủy đăng ký này.");
    }

    await FirebaseService.deleteDoc(
      FirebaseService.doc(FirebaseService.db, "taskRegistrations", registration.id)
    );
  },

  async approve(registration, options = {}) {
    return (await this.approveMany([registration], options))[0];
  },

  async reject(registration, reason) {
    return this.rejectMany([registration], reason);
  }
});
