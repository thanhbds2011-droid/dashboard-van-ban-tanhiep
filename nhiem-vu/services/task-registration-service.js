import { FirebaseService } from "../core/firebase-service.js";
import { UserContext } from "../core/user-context.js";
import { TaskLogService } from "./task-log-service.js";

function clean(value) { return String(value ?? "").trim(); }
function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function taskCode() {
  const now = new Date();
  return `NV-${dateKey(now).replaceAll("-", "")}-${String(now.getHours()).padStart(2,"0")}${String(now.getMinutes()).padStart(2,"0")}${String(now.getSeconds()).padStart(2,"0")}-${Math.random().toString(36).slice(2,5).toUpperCase()}`;
}
async function activePeriod() {
  const snap = await FirebaseService.getDocs(FirebaseService.query(
    FirebaseService.collection(FirebaseService.db, "evaluationPeriods"),
    FirebaseService.where("active", "==", true)
  ));
  return snap.docs.map(d => ({ id:d.id, ...d.data() })).find(p => clean(p.status).toUpperCase() !== "DELETED") || null;
}
function registrationId(periodId, uid, standardTaskId) {
  return `${periodId}_${uid}_${standardTaskId}`.replace(/[^A-Za-z0-9_-]/g, "_");
}
function taskLogRef() { return FirebaseService.doc(FirebaseService.collection(FirebaseService.db, "taskLogs")); }

export const TaskRegistrationService = Object.freeze({
  async getActivePeriod() { return activePeriod(); },

  async listForCurrentUser(periodId) {
    const user = UserContext.requireUser();
    if (!periodId) return [];
    const snap = await FirebaseService.getDocs(FirebaseService.query(
      FirebaseService.collection(FirebaseService.db, "taskRegistrations"),
      FirebaseService.where("periodId", "==", periodId),
      FirebaseService.where("userId", "==", user.uid)
    ));
    return snap.docs.map(d => ({ id:d.id, ...d.data() }));
  },

  async registerMany(items, period) {
    const user = UserContext.requireUser();
    if (user.role !== "STAFF") throw new Error("Chỉ viên chức được đăng ký đầu việc định kỳ.");
    if (!period?.id) throw new Error("Chưa có kỳ đánh giá đang hoạt động.");
    if (!items.length) throw new Error("Chưa chọn đầu việc để đăng ký.");
    const batch = FirebaseService.writeBatch(FirebaseService.db);
    items.forEach(item => {
      const id = registrationId(period.id, user.uid, item.id || item.code);
      const ref = FirebaseService.doc(FirebaseService.db, "taskRegistrations", id);
      batch.set(ref, {
        periodId: period.id,
        periodName: period.name || period.id,
        standardTaskId: item.id || item.code,
        standardTaskCode: item.code || item.id,
        standardTaskName: item.name || "",
        title: item.name || "",
        description: item.outputRequirement || "",
        departmentId: user.departmentId || "",
        userId: user.uid,
        userName: user.fullName || "",
        userPosition: user.position || "",
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
    });
    await batch.commit();
    return items.length;
  },

  async approve(registration, { isCoreTask = false, deadline = null } = {}) {
    const leader = UserContext.requireUser();
    if (leader.role !== "DEPARTMENT_LEADER" && leader.role !== "ADMIN") throw new Error("Bạn không có quyền duyệt đăng ký.");
    if (clean(registration.departmentId).toUpperCase() !== clean(leader.departmentId).toUpperCase() && leader.role !== "ADMIN") throw new Error("Đăng ký không thuộc Phòng/Khu của bạn.");
    if (registration.status !== "PENDING") throw new Error("Đăng ký này đã được xử lý.");
    const code = taskCode();
    const taskRef = FirebaseService.doc(FirebaseService.collection(FirebaseService.db, "tasks"));
    const regRef = FirebaseService.doc(FirebaseService.db, "taskRegistrations", registration.id);
    const due = deadline || new Date(registration.deadlineDateKey || new Date(new Date().getFullYear(), new Date().getMonth()+1, 0));
    const payload = {
      active: true,
      taskCode: code,
      title: registration.title || registration.standardTaskName,
      description: registration.description || "",
      sourceType: "DANG_KY_KE_HOACH",
      sourceReference: registration.standardTaskCode || "",
      sourceDetail: "Viên chức đăng ký đầu việc theo vị trí việc làm.",
      sourceDate: FirebaseService.Timestamp.fromDate(new Date()),
      sourceDateKey: dateKey(new Date()),
      entryMode: "SELF_REGISTERED_APPROVED",
      primaryDepartmentId: registration.departmentId,
      supportDepartmentIds: [], relatedDepartmentIds: [], visibleDepartmentIds: [registration.departmentId],
      ownerUserId: registration.userId,
      ownerName: registration.userName || "",
      ownerPosition: registration.userPosition || "",
      teamId: "",
      visibleUserIds: [registration.userId],
      assignedByUserId: leader.uid,
      assignedByName: leader.fullName || "",
      assignedByPosition: leader.position || "",
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
      confirmer: leader.fullName || "",
      scoringVersion: "PRODUCTION_FINAL_REGISTRATION_V1",
      periodId: registration.periodId,
      periodName: registration.periodName || registration.periodId,
      planType: "KE_HOACH",
      planApprovalStatus: "APPROVED",
      includedInA: true,
      isCoreTask: Boolean(isCoreTask),
      scoringEnabled: true,
      scoringStatus: "NOT_ASSESSED",
      result: "", resultSummary: "", difficulties: "", proposal: "",
      evidenceType: "", evidenceUrl: "", evidenceLink: "", evidenceText: "", evidenceFileName: "", evidenceStoragePath: "",
      completedAt: null,
      createdAt: FirebaseService.serverTimestamp(),
      createdByUserId: leader.uid,
      createdByName: leader.fullName || "",
      createdByRole: leader.role || "",
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: leader.uid,
      updatedByName: leader.fullName || ""
    };
    const batch = FirebaseService.writeBatch(FirebaseService.db);
    batch.set(taskRef, payload);
    batch.update(regRef, {
      status: "APPROVED", taskId: taskRef.id, taskCode: code,
      approvedAt: FirebaseService.serverTimestamp(), approvedByUserId: leader.uid,
      approvedByName: leader.fullName || "", isCoreTask: Boolean(isCoreTask), updatedAt: FirebaseService.serverTimestamp()
    });
    batch.set(taskLogRef(), TaskLogService.buildTaskLog({
      taskId: taskRef.id, taskCode: code, action: "TASK_REGISTRATION_APPROVED",
      after: { ...payload, createdAt:null, updatedAt:null, assignedAt:null },
      note: `Duyệt đăng ký ${registration.standardTaskCode || ""} của ${registration.userName || ""}.`
    }));
    await batch.commit();
    return taskRef.id;
  },

  async reject(registration, reason) {
    const leader = UserContext.requireUser();
    const ref = FirebaseService.doc(FirebaseService.db, "taskRegistrations", registration.id);
    await FirebaseService.updateDoc(ref, {
      status: "REJECTED", rejectionReason: clean(reason), rejectedAt: FirebaseService.serverTimestamp(),
      rejectedByUserId: leader.uid, rejectedByName: leader.fullName || "", updatedAt: FirebaseService.serverTimestamp()
    });
  }
});
