/**
 * Quyền điều hành nhiệm vụ của Ban Giám đốc - V1.10.2.
 *
 * Nguyên tắc nghiệp vụ:
 * - Giám đốc và Phó Giám đốc cùng vai trò DIRECTOR.
 * - Giao mặc định cho một Phòng/Khu.
 * - Chỉ được giao thẳng cá nhân khi đã chọn Tổ/Nhóm và cá nhân thuộc đúng Tổ/Nhóm đó.
 * - Phòng/Khu phối hợp chỉ theo dõi, không tiếp nhận/phân công.
 * - BGĐ được thu hồi, chuyển Phòng/Khu hoặc xóa mềm nhiệm vụ đã giao.
 * - Không dùng quyền này để xác nhận/chấm điểm KPI của người khác.
 */
import { FirebaseService } from "../core/firebase-service.js?v=20260824.V1_13_0";
import { UserContext } from "../core/user-context.js?v=20260824.V1_13_0";
import { Permissions } from "../core/permissions.js?v=20260824.V1_13_0";
import { TaskLogService } from "./task-log-service.js?v=20260824.V1_13_0";
import { TaskNotificationService } from "./task-notification-service.js?v=20260824.V1_13_0";

function clean(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return clean(value).toUpperCase();
}

function normalizeTeamId(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function taskRef(taskId) {
  return FirebaseService.doc(FirebaseService.db, "tasks", taskId);
}

function logRef() {
  return FirebaseService.doc(FirebaseService.collection(FirebaseService.db, "taskLogs"));
}

function assertDirector() {
  const user = UserContext.requireUser();
  if (!(Permissions.isDirector(user) || Permissions.isAdmin(user))) {
    throw new Error("Chỉ Ban Giám đốc hoặc Admin được thực hiện thao tác điều hành này.");
  }
  return user;
}

async function readTask(taskId) {
  const snapshot = await FirebaseService.getDoc(taskRef(taskId));
  if (!snapshot.exists()) throw new Error("Không tìm thấy nhiệm vụ trên hệ thống.");
  return { id: snapshot.id, ...snapshot.data() };
}

function taskSnapshot(task) {
  const keys = [
    "active", "status", "assignmentStatus", "assignmentMode", "departmentAssignmentStatus",
    "primaryDepartmentId", "supportDepartmentIds", "visibleDepartmentIds", "visibleUserIds",
    "ownerUserId", "ownerName", "ownerPosition", "teamId", "progress", "completedAt",
    "includedInA", "scoringEnabled", "scoringStatus", "scoreLocked", "confirmedActualScore"
  ];
  return Object.fromEntries(keys.map(key => [key, task?.[key] ?? null]));
}

async function writeLog(task, action, note, after) {
  const reference = logRef();
  try {
    await FirebaseService.setDoc(reference, TaskLogService.buildTaskLog({
      taskId: task.id,
      taskCode: task.taskCode || "",
      periodId: task.periodId || "",
      action,
      before: taskSnapshot(task),
      after,
      note
    }));
    return reference.id;
  } catch (error) {
    // Nhật ký là lớp kiểm toán bổ sung; không đảo ngược thao tác điều hành đã hợp lệ.
    console.warn(`Không ghi được nhật ký ${action}:`, error);
    return reference.id;
  }
}

async function ownerProfileForDirectAssignment(ownerUserId, departmentId, teamId) {
  const id = clean(ownerUserId);
  if (!id) throw new Error("Hãy chọn người phụ trách trực tiếp.");
  const snapshot = await FirebaseService.getDoc(FirebaseService.doc(FirebaseService.db, "users", id));
  if (!snapshot.exists()) throw new Error("Không tìm thấy hồ sơ người phụ trách.");
  const profile = { id: snapshot.id, ...snapshot.data() };
  if (profile.active !== true) throw new Error("Tài khoản người phụ trách đang ngừng hoạt động.");
  if (upper(profile.departmentId) !== upper(departmentId)) {
    throw new Error("Người phụ trách không thuộc Phòng/Khu đã chọn.");
  }
  const expectedTeam = normalizeTeamId(teamId);
  if (!expectedTeam) throw new Error("Ban Giám đốc phải chọn Tổ/Nhóm trước khi giao trực tiếp cá nhân.");
  if (normalizeTeamId(profile.teamId) !== expectedTeam) {
    throw new Error("Người phụ trách không thuộc đúng Tổ/Nhóm đã chọn.");
  }
  return profile;
}

function resetAcceptancePayload() {
  return {
    departmentAcceptedAt: null,
    departmentAcceptedByUserId: "",
    departmentAcceptedByName: "",
    departmentAcceptedByPosition: "",
    acceptedAt: null,
    acceptedByUserId: "",
    acceptedByName: ""
  };
}

export const DirectorTaskService = Object.freeze({
  async assignTeamDirect(taskOrId, { departmentId, teamId, ownerUserId } = {}) {
    const actor = assertDirector();
    const task = typeof taskOrId === "string" ? await readTask(taskOrId) : taskOrId;
    if (!task?.id) throw new Error("Không xác định được nhiệm vụ cần giao.");
    if (task.active === false) throw new Error("Nhiệm vụ đã bị hủy/xóa nên không thể phân công.");
    if (task.completedAt) throw new Error("Nhiệm vụ đã hoàn thành; không thể dùng thao tác giao trực tiếp ban đầu.");

    const targetDepartment = upper(departmentId || task.primaryDepartmentId);
    const targetTeam = normalizeTeamId(teamId);
    const owner = await ownerProfileForDirectAssignment(ownerUserId, targetDepartment, targetTeam);
    const supportIds = [...new Set((task.supportDepartmentIds || [])
      .map(upper)
      .filter(Boolean)
      .filter(id => id !== targetDepartment))];
    const visibleDepartments = [...new Set([targetDepartment, ...supportIds])];
    const visibleUsers = [...new Set([...(task.visibleUserIds || []), owner.id].filter(Boolean))];

    const payload = {
      primaryDepartmentId: targetDepartment,
      supportDepartmentIds: supportIds,
      relatedDepartmentIds: supportIds,
      visibleDepartmentIds: visibleDepartments,
      assignmentMode: "TEAM_DIRECT",
      departmentAssignmentStatus: "DIRECT_ASSIGNED",
      departmentAcceptedAt: FirebaseService.serverTimestamp(),
      departmentAcceptedByUserId: actor.uid,
      departmentAcceptedByName: actor.fullName || "",
      departmentAcceptedByPosition: actor.position || "Ban Giám đốc",
      ownerUserId: owner.id,
      ownerName: clean(owner.fullName || owner.email),
      ownerPosition: clean(owner.position || owner.role),
      teamId: targetTeam,
      visibleUserIds: visibleUsers,
      assignedByUserId: actor.uid,
      assignedByName: actor.fullName || "",
      assignedByPosition: actor.position || "Ban Giám đốc",
      internalAssignedByUserId: "",
      internalAssignedByName: "",
      internalAssignedByPosition: "",
      internalAssignedAt: null,
      assignedAt: FirebaseService.serverTimestamp(),
      adjustmentApproverUserId: actor.uid,
      adjustmentApproverName: actor.fullName || "",
      assignmentStatus: "DA_PHAN_CONG",
      status: "MOI_TIEP_NHAN",
      acceptedAt: null,
      acceptedByUserId: "",
      acceptedByName: "",
      directorControlType: "TEAM_DIRECT",
      directorControlledAt: FirebaseService.serverTimestamp(),
      directorControlledByUserId: actor.uid,
      directorControlledByName: actor.fullName || "",
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: actor.uid,
      updatedByName: actor.fullName || ""
    };

    await FirebaseService.updateDoc(taskRef(task.id), payload);
    const notificationLogId = await writeLog(task, "TASK_TEAM_DIRECT_ASSIGNED", "Ban Giám đốc giao trực tiếp qua Tổ/Nhóm.", {
      ...taskSnapshot(task),
      ...payload,
      departmentAcceptedAt: null,
      assignedAt: null,
      directorControlledAt: null,
      updatedAt: null
    });

    await TaskNotificationService.send(
      "TASK_TEAM_DIRECT_ASSIGNED",
      task.id,
      {
        sourceAction: "TASK_TEAM_DIRECT_ASSIGNED",
        taskCode: task.taskCode || "",
        periodId: task.periodId || "",
        performedByUserId: actor.uid,
        performedByName: actor.fullName || "",
        performedByRole: actor.role || "",
        performedByDepartmentId: actor.departmentId || ""
      },
      { eventId: `TASKLOG_${notificationLogId}` }
    );

    return { ...task, ...payload };
  },

  async reassignDepartment(taskOrId, newDepartmentId, reason = "") {
    const actor = assertDirector();
    const task = typeof taskOrId === "string" ? await readTask(taskOrId) : taskOrId;
    if (!task?.id) throw new Error("Không xác định được nhiệm vụ cần chuyển.");
    if (task.active === false) throw new Error("Nhiệm vụ đã bị hủy/xóa.");
    if (task.completedAt) throw new Error("Nhiệm vụ đã hoàn thành; hãy dùng quy trình điều chỉnh sau Hội đồng nếu cần thay đổi kết quả KPI.");

    const targetDepartment = upper(newDepartmentId);
    if (!targetDepartment) throw new Error("Hãy chọn Phòng/Khu nhận nhiệm vụ mới.");
    if (targetDepartment === upper(task.primaryDepartmentId)) throw new Error("Phòng/Khu mới đang trùng với Phòng/Khu hiện tại.");

    const supportIds = [...new Set((task.supportDepartmentIds || [])
      .map(upper)
      .filter(Boolean)
      .filter(id => id !== targetDepartment))];
    const payload = {
      primaryDepartmentId: targetDepartment,
      supportDepartmentIds: supportIds,
      relatedDepartmentIds: supportIds,
      visibleDepartmentIds: [...new Set([targetDepartment, ...supportIds])],
      visibleUserIds: [],
      assignmentMode: "DEPARTMENT",
      departmentAssignmentStatus: "PENDING_ACCEPTANCE",
      ...resetAcceptancePayload(),
      ownerUserId: "",
      ownerName: "",
      ownerPosition: "",
      teamId: "",
      assignedByUserId: "",
      assignedByName: "",
      assignedByPosition: "",
      internalAssignedByUserId: "",
      internalAssignedByName: "",
      internalAssignedByPosition: "",
      internalAssignedAt: null,
      assignedAt: null,
      assignmentStatus: "CHO_PHONG_KHU_TIEP_NHAN",
      status: "CHO_PHONG_KHU_TIEP_NHAN",
      directorControlType: "REASSIGN_DEPARTMENT",
      directorControlReason: clean(reason),
      reassignedFromDepartmentId: upper(task.primaryDepartmentId),
      reassignedAt: FirebaseService.serverTimestamp(),
      reassignedByUserId: actor.uid,
      reassignedByName: actor.fullName || "",
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: actor.uid,
      updatedByName: actor.fullName || ""
    };

    await FirebaseService.updateDoc(taskRef(task.id), payload);
    await writeLog(
      task,
      "TASK_DIRECTOR_REASSIGNED",
      `Ban Giám đốc chuyển nhiệm vụ từ ${upper(task.primaryDepartmentId)} sang ${targetDepartment}.${clean(reason) ? ` Lý do: ${clean(reason)}` : ""}`,
      { ...taskSnapshot(task), ...payload, reassignedAt: null, updatedAt: null }
    );
    return { ...task, ...payload };
  },

  async recall(taskOrId, reason = "") {
    const actor = assertDirector();
    const task = typeof taskOrId === "string" ? await readTask(taskOrId) : taskOrId;
    if (!task?.id) throw new Error("Không xác định được nhiệm vụ cần thu hồi.");
    if (task.active === false) throw new Error("Nhiệm vụ đã bị hủy/xóa.");
    if (task.completedAt) throw new Error("Nhiệm vụ đã hoàn thành nên không thực hiện thu hồi luồng giao việc.");

    const payload = {
      assignmentMode: "DIRECTOR_RECALLED",
      departmentAssignmentStatus: "RECALLED",
      ...resetAcceptancePayload(),
      ownerUserId: "",
      ownerName: "",
      ownerPosition: "",
      teamId: "",
      visibleUserIds: [],
      assignedByUserId: "",
      assignedByName: "",
      assignedByPosition: "",
      internalAssignedByUserId: "",
      internalAssignedByName: "",
      internalAssignedByPosition: "",
      internalAssignedAt: null,
      assignedAt: null,
      assignmentStatus: "THU_HOI",
      status: "TAM_DUNG",
      directorControlType: "RECALL",
      directorControlReason: clean(reason),
      recalledAt: FirebaseService.serverTimestamp(),
      recalledByUserId: actor.uid,
      recalledByName: actor.fullName || "",
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: actor.uid,
      updatedByName: actor.fullName || ""
    };

    await FirebaseService.updateDoc(taskRef(task.id), payload);
    await writeLog(task, "TASK_DIRECTOR_RECALLED", `Ban Giám đốc thu hồi nhiệm vụ.${clean(reason) ? ` Lý do: ${clean(reason)}` : ""}`, {
      ...taskSnapshot(task), ...payload, recalledAt: null, updatedAt: null
    });
    return { ...task, ...payload };
  },

  async softDelete(taskOrId, reason = "") {
    const actor = assertDirector();
    const task = typeof taskOrId === "string" ? await readTask(taskOrId) : taskOrId;
    if (!task?.id) throw new Error("Không xác định được nhiệm vụ cần xóa.");
    const normalizedReason = clean(reason);
    if (!normalizedReason) throw new Error("Hãy nhập lý do xóa nhiệm vụ.");
    if (task.active === false || ["HUY", "CANCELLED", "DELETED"].includes(upper(task.status))) {
      throw new Error("Nhiệm vụ đã được hủy/xóa trước đó.");
    }

    const payload = {
      active: false,
      status: "HUY",
      assignmentStatus: "HUY",
      departmentAssignmentStatus: "CANCELLED",
      includedInA: false,
      scoringEnabled: false,
      scoringStatus: "CANCELLED_BY_DIRECTOR",
      directorControlType: "DELETE",
      directorControlReason: normalizedReason,
      deletedReason: normalizedReason,
      deletedAt: FirebaseService.serverTimestamp(),
      deletedByUserId: actor.uid,
      deletedByName: actor.fullName || "",
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: actor.uid,
      updatedByName: actor.fullName || ""
    };

    await FirebaseService.updateDoc(taskRef(task.id), payload);
    await writeLog(task, "TASK_DELETED", `Ban Giám đốc xóa mềm nhiệm vụ. Lý do: ${normalizedReason}`, {
      ...taskSnapshot(task), ...payload, deletedAt: null, updatedAt: null
    });
    return { ...task, ...payload };
  }
});
