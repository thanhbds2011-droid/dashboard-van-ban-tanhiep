/** Production 3D - tạo, phân công, tiếp nhận, cập nhật tiến độ và hoàn thành nhiệm vụ. */
import { FirebaseService } from "../core/firebase-service.js";
import { UserContext } from "../core/user-context.js";
import { Permissions } from "../core/permissions.js";
import { TaskLogService } from "./task-log-service.js";

function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function taskCode() {
  const now = new Date();
  const stamp = [now.getFullYear(), String(now.getMonth()+1).padStart(2,"0"), String(now.getDate()).padStart(2,"0")].join("");
  const time = [String(now.getHours()).padStart(2,"0"), String(now.getMinutes()).padStart(2,"0"), String(now.getSeconds()).padStart(2,"0")].join("");
  return `NV-${stamp}-${time}-${Math.random().toString(36).slice(2,5).toUpperCase()}`;
}

function taskRef(taskId) {
  return FirebaseService.doc(FirebaseService.db, "tasks", taskId);
}

function logRef() {
  return FirebaseService.doc(FirebaseService.collection(FirebaseService.db, "taskLogs"));
}

function snapshotTask(task) {
  const allowed = ["status","assignmentStatus","progress","ownerUserId","ownerName","ownerPosition","teamId","resultSummary","evidenceUrl","evidenceFileName","deadline","priority"];
  return Object.fromEntries(allowed.map(key => [key, task?.[key] ?? null]));
}

export const TaskWriteService = Object.freeze({
  async create(data) {
    const user = UserContext.requireUser();
    const reference = FirebaseService.doc(FirebaseService.collection(FirebaseService.db, "tasks"));
    const code = taskCode();
    const ownerUserId = data.ownerUserId || "";
    const supportIds = [...new Set((data.supportDepartmentIds || []).filter(Boolean).filter(id => id !== data.primaryDepartmentId))];
    const visibleDepartments = [...new Set([data.primaryDepartmentId, ...supportIds])];
    const visibleUsers = [...new Set([ownerUserId].filter(Boolean))];
    const isStaffSelf = Permissions.isStaff();
    const entryMode = isStaffSelf ? "SELF_REGISTERED" : (Permissions.isDirector() || Permissions.isAdmin() ? "DIRECT_ASSIGNED" : "DEPARTMENT_CREATED");
    const assignmentStatus = ownerUserId ? "DA_PHAN_CONG" : "CHO_PHAN_CONG";
    const status = ownerUserId ? "MOI_TIEP_NHAN" : "CHO_PHAN_CONG";

    const payload = {
      active: true,
      taskCode: code,
      title: data.title,
      description: data.description || "",
      sourceType: data.sourceType || "DANG_KY_THUC_HIEN",
      sourceReference: data.sourceReference || data.title,
      sourceDetail: data.sourceDetail || data.description || "",
      sourceDate: FirebaseService.Timestamp.fromDate(data.sourceDate || new Date()),
      sourceDateKey: dateKey(data.sourceDate || new Date()),
      entryMode,
      primaryDepartmentId: data.primaryDepartmentId,
      supportDepartmentIds: supportIds,
      relatedDepartmentIds: supportIds,
      visibleDepartmentIds: visibleDepartments,
      ownerUserId,
      ownerName: data.ownerName || "",
      ownerPosition: data.ownerPosition || "",
      teamId: data.teamId || "",
      visibleUserIds: visibleUsers,
      assignedByUserId: ownerUserId ? user.uid : "",
      assignedByName: ownerUserId ? (user.fullName || "") : "",
      assignedByPosition: ownerUserId ? (user.position || "") : "",
      assignedAt: ownerUserId ? FirebaseService.serverTimestamp() : null,
      assignmentStatus,
      status,
      progress: 0,
      priority: data.priority,
      deadline: FirebaseService.Timestamp.fromDate(data.deadline),
      deadlineDateKey: dateKey(data.deadline),
      standardTaskCode: data.standardTaskCode || "",
      standardTaskName: data.standardTaskName || "",
      workType: data.workType || "THUONG_XUYEN",
      baseScore: Number(data.baseScore || 0),
      difficultyCoefficient: Number(data.difficultyCoefficient || 1),
      maximumConvertedScore: Number(data.maximumConvertedScore || 0),
      mandatoryEvidence: data.mandatoryEvidence || "",
      confirmer: data.confirmer || "",
      scoringVersion: "PRODUCTION_3D",
      planApprovalStatus: isStaffSelf ? "PENDING_APPROVAL" : "APPROVED",
      includedInA: false,
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

    const batch = FirebaseService.writeBatch(FirebaseService.db);
    batch.set(reference, payload);
    batch.set(logRef(), TaskLogService.buildTaskLog({
      taskId: reference.id,
      taskCode: code,
      action: "TASK_CREATED",
      after: { ...payload, createdAt: null, updatedAt: null, assignedAt: null },
      note: isStaffSelf ? "Cá nhân đăng ký thực hiện, chờ duyệt." : "Tạo nhiệm vụ mới."
    }));
    await batch.commit();
    return { id: reference.id, ...payload };
  },

  async assign(task, assignment) {
    const user = UserContext.requireUser();
    const before = snapshotTask(task);
    const ownerUserId = assignment.ownerUserId || "";
    const payload = {
      ownerUserId,
      ownerName: assignment.ownerName || "",
      ownerPosition: assignment.ownerPosition || "",
      teamId: assignment.teamId || "",
      visibleUserIds: ownerUserId ? [ownerUserId] : [],
      assignedByUserId: user.uid,
      assignedByName: user.fullName || "",
      assignedByPosition: user.position || "",
      assignedAt: FirebaseService.serverTimestamp(),
      assignmentStatus: ownerUserId ? "DA_PHAN_CONG" : "CHO_PHAN_CONG",
      status: ownerUserId ? "MOI_TIEP_NHAN" : "CHO_PHAN_CONG",
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: user.uid,
      updatedByName: user.fullName || ""
    };
    const batch = FirebaseService.writeBatch(FirebaseService.db);
    batch.update(taskRef(task.id), payload);
    batch.set(logRef(), TaskLogService.buildTaskLog({ taskId: task.id, taskCode: task.taskCode, action: "TASK_ASSIGNED", before, after: { ...before, ...payload, assignedAt: null, updatedAt: null } }));
    await batch.commit();
  },

  async accept(task) {
    const user = UserContext.requireUser();
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
    const batch = FirebaseService.writeBatch(FirebaseService.db);
    batch.update(taskRef(task.id), payload);
    batch.set(logRef(), TaskLogService.buildTaskLog({ taskId: task.id, taskCode: task.taskCode, action: "TASK_ACCEPTED", before: snapshotTask(task), after: { ...snapshotTask(task), ...payload, acceptedAt: null, updatedAt: null } }));
    await batch.commit();
  },

  async updateProgress(task, changes) {
    const user = UserContext.requireUser();
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
      action: changes.status === "HOAN_THANH" ? "TASK_COMPLETED" : "PROGRESS_UPDATED",
      before: snapshotTask(task),
      after: { ...snapshotTask(task), ...payload, updatedAt: null, completedAt: null },
      note: changes.progressNote || ""
    }));
    await batch.commit();
  }
});
