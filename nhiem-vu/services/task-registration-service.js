import { FirebaseService } from "../core/firebase-service.js";
import { UserContext } from "../core/user-context.js";
import { Permissions } from "../core/permissions.js?v=20260728.V1_1_2";
import { TaskLogService } from "./task-log-service.js";

const clean = value => String(value ?? "").trim();
const upper = value => clean(value).toUpperCase();
const lower = value => clean(value).toLowerCase();

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

function createTaskCode() {
  const now = new Date();
  return `NV-${dateKey(now).replaceAll("-", "")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
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
    return reviewer.role === "DIRECTOR" && (!registration.reviewerEmail || lower(registration.reviewerEmail) === lower(reviewer.email));
  }

  return Permissions.isDepartmentHead(reviewer) && upper(reviewer.departmentId) === upper(registration.departmentId);
}

function endOfPeriod(period) {
  const parsed = dateAtEnd(period?.endDate);
  return parsed || new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 17, 0, 0);
}

function taskPayload(registration, reviewer, due, options = {}) {
  const code = createTaskCode();
  return {
    code,
    payload: {
      active: true,
      taskCode: code,
      title: registration.title || registration.standardTaskName,
      description: registration.description || "",
      sourceType: "DANG_KY_KE_HOACH",
      sourceReference: registration.standardTaskCode || "",
      sourceDetail: "Đầu việc do cá nhân đăng ký và được phê duyệt.",
      sourceDate: FirebaseService.Timestamp.fromDate(new Date()),
      sourceDateKey: dateKey(new Date()),
      entryMode: "SELF_REGISTERED_APPROVED",
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
      assignedAt: FirebaseService.serverTimestamp(),
      assignmentStatus: "DA_PHAN_CONG",
      status: "MOI_TIEP_NHAN",
      progress: 0,
      priority: "THUONG",
      deadline: FirebaseService.Timestamp.fromDate(due),
      deadlineDateKey: dateKey(due),
      standardTaskCode: registration.standardTaskCode || "",
      standardTaskName: registration.standardTaskName || "",
      registrationId: registration.id,
      workType: "THUONG_XUYEN",
      baseScore: Number(registration.baseScore || 0),
      difficultyCoefficient: Number(registration.difficultyCoefficient || 1),
      maximumConvertedScore: Number(registration.maximumConvertedScore || 0),
      mandatoryEvidence: registration.mandatoryEvidence || "",
      confirmer: reviewer.fullName || "",
      reviewerEmail: registration.reviewerEmail || "",
      scoringVersion: "KPI_2026_V1",
      periodId: registration.periodId,
      periodName: registration.periodName || registration.periodId,
      planType: "KE_HOACH",
      planApprovalStatus: "APPROVED",
      includedInA: true,
      isCoreTask: Boolean(options.isCoreTask),
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
  return taskIds;
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

  async registerMany(items, period) {
    const user = UserContext.requireUser();
    if (!Permissions.canRegisterStandardTasks()) throw new Error("Tài khoản không được đăng ký đầu việc chuẩn.");
    if (!period?.id) throw new Error("Chưa có kỳ đánh giá đang hoạt động.");
    if (!items?.length) throw new Error("Chưa chọn đầu việc để đăng ký.");

    const plan = await departmentPlan(period.id, user.departmentId);
    if (plan?.locked === true) throw new Error("Đăng ký kế hoạch của Phòng/Khu đã được khóa.");

    const autoApprove = Permissions.isDepartmentHead(user);
    const batch = FirebaseService.writeBatch(FirebaseService.db);
    const registrations = [];

    for (const item of items) {
      const id = registrationId(period.id, user.uid, item.id || item.code);
      const registration = {
        id,
        periodId: period.id,
        periodName: period.name || period.id,
        periodEndDate: period.endDate || "",
        standardTaskId: item.id || item.code,
        standardTaskCode: item.code || item.id,
        standardTaskName: item.name || "",
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
        reviewerEmail: user.role === "DEPARTMENT_LEADER" ? lower(user.kpiReviewerEmail) : "",
        workType: "THUONG_XUYEN",
        baseScore: Number(item.baseScore || 0),
        difficultyCoefficient: Number(item.difficultyCoefficient || 1),
        maximumConvertedScore: Number(item.maximumConvertedScore || item.baseScore || 0),
        mandatoryEvidence: item.mandatoryEvidence || "",
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

  async cancelRegistration(registration) {
    if (!Permissions.canCancelRegistration(registration)) {
      throw new Error("Tài khoản không có quyền hủy đăng ký này.");
    }
    if (registration.taskId) throw new Error("Đăng ký đã hình thành nhiệm vụ nên không thể hủy tại đây.");
    await FirebaseService.deleteDoc(
      FirebaseService.doc(FirebaseService.db, "taskRegistrations", registration.id)
    );
  },

  async softDeleteApproved(registration, reason) {
    const user = UserContext.requireUser();
    if (!(Permissions.isAdmin() || (Permissions.isDepartmentHead() && upper(registration.departmentId) === upper(user.departmentId)))) {
      throw new Error("Chỉ quản trị viên hoặc Trưởng phòng được hủy đầu việc đã duyệt.");
    }
    const batch = FirebaseService.writeBatch(FirebaseService.db);
    batch.update(FirebaseService.doc(FirebaseService.db, "taskRegistrations", registration.id), {
      active: false,
      status: "CANCELLED",
      cancelReason: clean(reason),
      cancelledAt: FirebaseService.serverTimestamp(),
      cancelledByUserId: user.uid,
      updatedAt: FirebaseService.serverTimestamp()
    });
    if (registration.taskId) {
      batch.update(FirebaseService.doc(FirebaseService.db, "tasks", registration.taskId), {
        active: false,
        status: "HUY",
        deletedReason: clean(reason),
        deletedAt: FirebaseService.serverTimestamp(),
        deletedByUserId: user.uid,
        deletedByName: user.fullName || "",
        updatedAt: FirebaseService.serverTimestamp(),
        updatedByUserId: user.uid
      });
    }
    await batch.commit();
  },

  async approve(registration, options = {}) {
    return (await this.approveMany([registration], options))[0];
  },

  async reject(registration, reason) {
    return this.rejectMany([registration], reason);
  }
});
