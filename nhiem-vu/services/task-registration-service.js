import { FirebaseService } from "../core/firebase-service.js";
import { UserContext } from "../core/user-context.js";
import { Permissions } from "../core/permissions.js";
import { TaskLogService } from "./task-log-service.js";

const clean = value => String(value ?? "").trim();
const upper = value => clean(value).toUpperCase();
const lower = value => clean(value).toLowerCase();

function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function createTaskCode() {
  const now = new Date();
  return `NV-${dateKey(now).replaceAll("-", "")}-${String(now.getHours()).padStart(2,"0")}${String(now.getMinutes()).padStart(2,"0")}${String(now.getSeconds()).padStart(2,"0")}-${Math.random().toString(36).slice(2,5).toUpperCase()}`;
}
function registrationId(periodId, uid, standardTaskId) {
  return `${periodId}_${uid}_${standardTaskId}`.replace(/[^A-Za-z0-9_-]/g, "_");
}
function taskLogRef() {
  return FirebaseService.doc(FirebaseService.collection(FirebaseService.db, "taskLogs"));
}
async function activePeriod() {
  const snapshot = await FirebaseService.getDocs(FirebaseService.query(
    FirebaseService.collection(FirebaseService.db, "evaluationPeriods"),
    FirebaseService.where("active", "==", true)
  ));
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() }))
    .find(p => upper(p.status) !== "DELETED") || null;
}
async function userProfile(uid) {
  const snapshot = await FirebaseService.getDoc(FirebaseService.doc(FirebaseService.db, "users", uid));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}
function canApproveRegistration(registration, reviewer) {
  if (!reviewer || reviewer.active !== true) return false;
  if (reviewer.role === "ADMIN") return true;
  if (registration.userRole === "DEPARTMENT_LEADER") {
    if (reviewer.role !== "DIRECTOR") return false;
    return !registration.reviewerEmail || lower(registration.reviewerEmail) === lower(reviewer.email);
  }
  return reviewer.role === "DEPARTMENT_LEADER" &&
    !String(reviewer.position || "").toLowerCase().includes("phó") &&
    upper(reviewer.departmentId) === upper(registration.departmentId);
}
function endOfPeriod(period) {
  const key = clean(period?.endDate);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 17, 0, 0);
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0, 17, 0, 0);
}

export const TaskRegistrationService = Object.freeze({
  async getActivePeriod() { return activePeriod(); },

  async listForCurrentUser(periodId) {
    const user = UserContext.requireUser();
    if (!periodId) return [];
    const snapshot = await FirebaseService.getDocs(FirebaseService.query(
      FirebaseService.collection(FirebaseService.db, "taskRegistrations"),
      FirebaseService.where("periodId", "==", periodId),
      FirebaseService.where("userId", "==", user.uid)
    ));
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async registerMany(items, period) {
    const user = UserContext.requireUser();
    if (!Permissions.canRegisterStandardTasks()) throw new Error("Tài khoản không được đăng ký đầu việc chuẩn.");
    if (!period?.id) throw new Error("Chưa có kỳ đánh giá đang hoạt động.");
    if (!Array.isArray(items) || !items.length) throw new Error("Chưa chọn đầu việc để đăng ký.");

    const batch = FirebaseService.writeBatch(FirebaseService.db);
    for (const item of items) {
      const standardTaskId = item.id || item.code;
      const id = registrationId(period.id, user.uid, standardTaskId);
      const ref = FirebaseService.doc(FirebaseService.db, "taskRegistrations", id);
      batch.set(ref, {
        periodId: period.id,
        periodName: period.name || period.id,
        standardTaskId,
        standardTaskCode: item.code || item.id,
        standardTaskName: item.name || "",
        title: item.name || "",
        description: item.outputRequirement || "",
        departmentId: user.departmentId || "",
        userId: user.uid,
        userName: user.fullName || "",
        userPosition: user.position || "",
        userRole: user.role || "",
        reviewerEmail: user.role === "DEPARTMENT_LEADER" ? lower(user.kpiReviewerEmail) : "",
        workType: "THUONG_XUYEN",
        baseScore: Number(item.baseScore || item.maximumConvertedScore || 0),
        difficultyCoefficient: Number(item.difficultyCoefficient || 1),
        maximumConvertedScore: Number(item.maximumConvertedScore || item.baseScore || 0),
        mandatoryEvidence: item.mandatoryEvidence || "",
        status: "PENDING",
        active: true,
        registeredAt: FirebaseService.serverTimestamp(),
        createdAt: FirebaseService.serverTimestamp(),
        createdByUserId: user.uid,
        updatedAt: FirebaseService.serverTimestamp()
      }, { merge: true });
    }
    await batch.commit();
    return items.length;
  },

  async approveMany(registrations, options = {}) {
    const reviewer = UserContext.requireUser();
    const selected = (registrations || []).filter(r => r?.status === "PENDING");
    if (!selected.length) throw new Error("Chưa chọn đầu việc để duyệt.");
    for (const registration of selected) {
      if (registration.userId === reviewer.uid) throw new Error("Không được tự duyệt kế hoạch của chính mình.");
      if (!canApproveRegistration(registration, reviewer)) throw new Error(`Bạn không có quyền duyệt đăng ký của ${registration.userName || "người dùng"}.`);
    }

    const batch = FirebaseService.writeBatch(FirebaseService.db);
    const due = options.deadline instanceof Date ? options.deadline : endOfPeriod({ endDate: selected[0].periodEndDate || options.periodEndDate });
    const createdTaskIds = [];

    for (const registration of selected) {
      const code = createTaskCode();
      const taskRef = FirebaseService.doc(FirebaseService.collection(FirebaseService.db, "tasks"));
      const regRef = FirebaseService.doc(FirebaseService.db, "taskRegistrations", registration.id);
      const payload = {
        active: true,
        taskCode: code,
        title: registration.title || registration.standardTaskName,
        description: registration.description || "",
        sourceType: "DANG_KY_KE_HOACH",
        sourceReference: registration.standardTaskCode || "",
        sourceDetail: "Đầu việc được cá nhân đăng ký và cấp có thẩm quyền duyệt.",
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
        teamId: "",
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
        scoringVersion: "PRODUCTION_FINAL_COMPLETE_V1",
        periodId: registration.periodId,
        periodName: registration.periodName || registration.periodId,
        planType: "KE_HOACH",
        planApprovalStatus: "APPROVED",
        includedInA: true,
        isCoreTask: Boolean(options.isCoreTask),
        scoringEnabled: true,
        scoringStatus: "NOT_ASSESSED",
        result: "", resultSummary: "", difficulties: "", proposal: "",
        evidenceType: "", evidenceUrl: "", evidenceLink: "", evidenceText: "", evidenceFileName: "", evidenceStoragePath: "",
        completedAt: null,
        createdAt: FirebaseService.serverTimestamp(),
        createdByUserId: reviewer.uid,
        createdByName: reviewer.fullName || "",
        createdByRole: reviewer.role || "",
        updatedAt: FirebaseService.serverTimestamp(),
        updatedByUserId: reviewer.uid,
        updatedByName: reviewer.fullName || ""
      };
      batch.set(taskRef, payload);
      batch.update(regRef, {
        status: "APPROVED",
        taskId: taskRef.id,
        taskCode: code,
        approvedAt: FirebaseService.serverTimestamp(),
        approvedByUserId: reviewer.uid,
        approvedByName: reviewer.fullName || "",
        updatedAt: FirebaseService.serverTimestamp()
      });
      batch.set(taskLogRef(), TaskLogService.buildTaskLog({
        taskId: taskRef.id,
        taskCode: code,
        action: "TASK_REGISTRATION_APPROVED",
        after: { ...payload, createdAt: null, updatedAt: null, assignedAt: null },
        note: `Duyệt đăng ký ${registration.standardTaskCode || ""} của ${registration.userName || ""}.`
      }));
      createdTaskIds.push(taskRef.id);
    }
    await batch.commit();
    return createdTaskIds;
  },

  async rejectMany(registrations, reason) {
    const reviewer = UserContext.requireUser();
    const selected = (registrations || []).filter(r => r?.status === "PENDING");
    if (!selected.length) throw new Error("Không có đăng ký để trả lại.");
    for (const registration of selected) {
      if (!canApproveRegistration(registration, reviewer)) throw new Error("Bạn không có quyền trả lại đăng ký này.");
    }
    const batch = FirebaseService.writeBatch(FirebaseService.db);
    for (const registration of selected) {
      batch.update(FirebaseService.doc(FirebaseService.db, "taskRegistrations", registration.id), {
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

  async approve(registration, options = {}) {
    const ids = await this.approveMany([registration], options);
    return ids[0];
  },

  async reject(registration, reason) {
    return this.rejectMany([registration], reason);
  },

  async getUserProfile(uid) { return userProfile(uid); }
});
