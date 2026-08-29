/** Tạo, phân công, tiếp nhận, cập nhật tiến độ và hoàn thành nhiệm vụ. */
import { FirebaseService } from "../core/firebase-service.js?v=20260829.V1_20_0";
import { UserContext } from "../core/user-context.js?v=20260829.V1_20_0";
import { Permissions } from "../core/permissions.js?v=20260829.V1_20_0";
import { TaskLogService } from "./task-log-service.js?v=20260829.V1_20_0";
import { TaskWorkItemService } from "./task-work-item-service.js?v=20260829.V1_20_0";
import { PeriodReadService } from "./period-read-service.js?v=20260829.V1_20_0";
import { TaskNotificationService } from "./task-notification-service.js?v=20260829.V1_20_0";
import { APP_VERSION, BUILD_VERSION } from "../core/app-version.js?v=20260829.V1_20_0";
import { deadlineDateFromKey, isDateKey } from "../core/deadline-engine.js?v=20260829.V1_20_0";
import { confirmWriteWithServerRecovery } from "./firestore-write-recovery.js?v=20260829.V1_20_0";

const TASK_WRITE_BUILD_VERSION = BUILD_VERSION;
const MAX_CODE_SCAN = 1000;

function cleanWriteValue(value) {
  return String(value ?? "").trim();
}

async function taskUpdateConfirmedOnServer(taskId, logId, userId, expected = {}) {
  const [snapshot, logSnapshot] = await Promise.all([
    FirebaseService.getDocFromServer(taskRef(taskId)),
    FirebaseService.getDocFromServer(FirebaseService.doc(FirebaseService.db, "taskLogs", logId))
  ]);
  if (!snapshot.exists() || !logSnapshot.exists()) return false;
  const log = logSnapshot.data() || {};
  if (cleanWriteValue(log.performedByUserId) !== cleanWriteValue(userId)) return false;
  const data = snapshot.data() || {};
  if (cleanWriteValue(data.updatedByUserId) !== cleanWriteValue(userId)) return false;
  if (expected.status && cleanWriteValue(data.status).toUpperCase() !== cleanWriteValue(expected.status).toUpperCase()) return false;
  if (Object.prototype.hasOwnProperty.call(expected, "evidenceText")
    && cleanWriteValue(data.evidenceText) !== cleanWriteValue(expected.evidenceText)) return false;
  if (Object.prototype.hasOwnProperty.call(expected, "evidenceUrl")
    && cleanWriteValue(data.evidenceUrl || data.evidenceLink) !== cleanWriteValue(expected.evidenceUrl)) return false;
  if (cleanWriteValue(expected.status).toUpperCase() === "HOAN_THANH") {
    if (!data.completedAt || cleanWriteValue(data.completedByUserId) !== cleanWriteValue(userId)) return false;
  }
  return true;
}

function firestoreRestString(document, fieldName) {
  return cleanWriteValue(document?.fields?.[fieldName]?.stringValue);
}

function firestoreRestHasTimestamp(document, fieldName) {
  return Boolean(document?.fields?.[fieldName]?.timestampValue);
}

async function readFirestoreDocumentViaRest(collectionName, documentId, idToken) {
  const projectId = cleanWriteValue(FirebaseService.app?.options?.projectId);
  if (!projectId || !idToken) return null;
  const path = [collectionName, documentId].map(part => encodeURIComponent(cleanWriteValue(part))).join("/");
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${path}`;
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    credentials: "omit",
    headers: { Authorization: `Bearer ${idToken}` }
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    const error = new Error(`Không đọc được xác nhận Firestore REST (${response.status}).`);
    error.code = response.status === 401 ? "unauthenticated" : `firestore-rest-${response.status}`;
    throw error;
  }
  return response.json();
}

async function eventTrackingClosedOnServerViaSdk(taskId, logId, userId) {
  const [snapshot, logSnapshot] = await Promise.all([
    FirebaseService.getDocFromServer(taskRef(taskId)),
    FirebaseService.getDocFromServer(FirebaseService.doc(FirebaseService.db, "taskLogs", logId))
  ]);
  if (!snapshot.exists() || !logSnapshot.exists()) return false;
  const log = logSnapshot.data() || {};
  if (cleanWriteValue(log.performedByUserId) !== cleanWriteValue(userId)) return false;
  const data = snapshot.data() || {};
  return String(data.status || "").toUpperCase() === "HOAN_THANH"
    && Number(data.progress || 0) === 100
    && Boolean(data.eventTrackingClosedAt || data.completedAt)
    && String(data.eventTrackingClosedByUserId || data.completedByUserId || "") === String(userId || "");
}

async function eventTrackingClosedOnServer(taskId, logId, userId) {
  /*
   * V1.18.6: ưu tiên REST GET để xác nhận server. Đây là HTTPS request ngắn,
   * không phụ thuộc ACK của WebChannel đang có thể bị proxy/QUIC giữ lâu.
   */
  try {
    const currentUser = FirebaseService.auth.currentUser;
    if (!currentUser || cleanWriteValue(currentUser.uid) !== cleanWriteValue(userId)) return false;
    const idToken = await currentUser.getIdToken();
    const [taskDocument, logDocument] = await Promise.all([
      readFirestoreDocumentViaRest("tasks", taskId, idToken),
      readFirestoreDocumentViaRest("taskLogs", logId, idToken)
    ]);
    if (!taskDocument || !logDocument) return false;
    return firestoreRestString(logDocument, "performedByUserId") === cleanWriteValue(userId)
      && firestoreRestString(taskDocument, "status").toUpperCase() === "HOAN_THANH"
      && Number(taskDocument?.fields?.progress?.integerValue ?? taskDocument?.fields?.progress?.doubleValue ?? 0) === 100
      && (firestoreRestHasTimestamp(taskDocument, "eventTrackingClosedAt") || firestoreRestHasTimestamp(taskDocument, "completedAt"))
      && cleanWriteValue(
        firestoreRestString(taskDocument, "eventTrackingClosedByUserId")
        || firestoreRestString(taskDocument, "completedByUserId")
      ) === cleanWriteValue(userId);
  } catch (restError) {
    console.warn("Xác nhận REST tạm thời không dùng được; thử lại bằng Firestore SDK:", restError);
    return eventTrackingClosedOnServerViaSdk(taskId, logId, userId);
  }
}

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


function taskCreateDelegationDocumentId(departmentId) {
  return `${normalizeDepartmentId(departmentId)}_STANDARD_TASK_EDITOR`;
}

async function hasTaskCreateDelegation(user, departmentId = user?.departmentId) {
  const department = normalizeDepartmentId(departmentId);
  if (!user?.uid || !department || department !== normalizeDepartmentId(user.departmentId)) return false;
  if (!(Permissions.isDepartmentDeputy(user) || Permissions.isStaff(user) || Permissions.isTchcCoordinator(user))) return false;
  try {
    const snapshot = await FirebaseService.getDoc(
      FirebaseService.doc(FirebaseService.db, "approvalDelegations", taskCreateDelegationDocumentId(department))
    );
    if (!snapshot.exists()) return false;
    const data = snapshot.data() || {};
    const now = Date.now();
    const start = data.startAt?.toDate?.()?.getTime?.() ?? null;
    const end = data.endAt?.toDate?.()?.getTime?.() ?? null;
    return data.active === true
      && data.delegateUserId === user.uid
      && normalizeDepartmentId(data.departmentId) === department
      && Array.isArray(data.permissions)
      && data.permissions.includes("CREATE_TASKS")
      && (start === null || start <= now)
      && (end === null || end >= now);
  } catch (error) {
    if (!String(error?.code || "").includes("permission-denied")) {
      console.warn("Không kiểm tra được ủy quyền giao nhiệm vụ:", error);
    }
    return false;
  }
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
  async canCreateUnexpectedTask() {
    const user = UserContext.requireUser();
    if (Permissions.canCreateUnexpectedTask(false, user)) return true;
    return hasTaskCreateDelegation(user, user.departmentId);
  },

  async create(data) {
    const user = UserContext.requireUser();
    if (!(await this.canCreateUnexpectedTask())) {
      throw new Error("Tài khoản không có quyền giao nhiệm vụ phát sinh.");
    }

    const departmentId = normalizeDepartmentId(data.primaryDepartmentId);
    const ownDepartmentId = normalizeDepartmentId(user.departmentId);
    if (!Permissions.isAdmin(user) && !Permissions.isDirector(user) && departmentId !== ownDepartmentId) {
      throw new Error("Chỉ được giao nhiệm vụ trong đúng Phòng/Khu thuộc phạm vi quyền của tài khoản.");
    }
    const requestedDeadlineDateKey = String(data.deadlineDateKey || "").trim();
    const fallbackDeadlineDateKey = data.deadline instanceof Date && !Number.isNaN(data.deadline.getTime())
      ? dateKey(data.deadline)
      : "";
    const deadlineDateKey = isDateKey(requestedDeadlineDateKey) ? requestedDeadlineDateKey : fallbackDeadlineDateKey;
    if (!isDateKey(deadlineDateKey)) {
      throw new Error("Hạn hoàn thành cụ thể là bắt buộc khi giao nhiệm vụ đột xuất.");
    }
    const deadlineDate = deadlineDateFromKey(deadlineDateKey);
    const activePeriod = await getActivePeriod();

    if (!activePeriod?.id) {
      throw new Error("Chưa có kỳ đánh giá đang hoạt động. Hãy mở kỳ trước khi giao nhiệm vụ đột xuất để nhiệm vụ được tính vào A.");
    }
    const startingSequence = await getStartingSequence(departmentId, activePeriod.id);

    const directorCreatesDepartmentTask = Permissions.isDirector() || Permissions.isAdmin();
    const ownerUserId = directorCreatesDepartmentTask ? "" : String(data.ownerUserId || "").trim();
    const supportIds = [...new Set((data.supportDepartmentIds || [])
      .map(normalizeDepartmentId)
      .filter(Boolean)
      .filter(id => id !== departmentId))];
    const visibleDepartments = [...new Set([departmentId, ...supportIds])];
    const visibleUsers = [...new Set([ownerUserId].filter(Boolean))];
    const assignmentMode = directorCreatesDepartmentTask ? "DEPARTMENT" : "DEPARTMENT_INTERNAL";
    const departmentAssignmentStatus = directorCreatesDepartmentTask ? "PENDING_ACCEPTANCE" : "ACCEPTED";
    const assignmentStatus = directorCreatesDepartmentTask
      ? "CHO_PHONG_KHU_TIEP_NHAN"
      : (ownerUserId ? "DA_PHAN_CONG" : "CHO_PHAN_CONG");
    const status = directorCreatesDepartmentTask
      ? "CHO_PHONG_KHU_TIEP_NHAN"
      : (ownerUserId ? "MOI_TIEP_NHAN" : "CHO_PHAN_CONG");
    const entryMode = directorCreatesDepartmentTask
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

    const notificationLogReference = logRef();
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
          appVersion: APP_VERSION,
          active: true,
          taskCode: code,
          title: data.title,
          description: data.description || "",
          expectedOutput: data.expectedOutput || "",
          resultRequirement: data.resultRequirement || "",
          sixClearDirective: {
            person: data.ownerName || `Cấp ${departmentId}`,
            work: data.title || "",
            time: deadlineDateKey,
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
          assignmentMode,
          departmentAssignmentStatus,
          departmentAcceptedAt: directorCreatesDepartmentTask ? null : FirebaseService.serverTimestamp(),
          departmentAcceptedByUserId: directorCreatesDepartmentTask ? "" : user.uid,
          departmentAcceptedByName: directorCreatesDepartmentTask ? "" : (user.fullName || ""),
          departmentAcceptedByPosition: directorCreatesDepartmentTask ? "" : (user.position || ""),
          primaryDepartmentId: departmentId,
          supportDepartmentIds: supportIds,
          relatedDepartmentIds: supportIds,
          visibleDepartmentIds: visibleDepartments,
          ownerUserId,
          ownerName: data.ownerName || "",
          ownerPosition: data.ownerPosition || "",
          teamId: directorCreatesDepartmentTask ? "" : String(data.teamId || "").toUpperCase(),
          visibleUserIds: visibleUsers,
          assignedByUserId: ownerUserId ? user.uid : "",
          assignedByName: ownerUserId ? (user.fullName || "") : "",
          assignedByPosition: ownerUserId ? (user.position || "") : "",
          internalAssignedByUserId: ownerUserId ? user.uid : "",
          internalAssignedByName: ownerUserId ? (user.fullName || "") : "",
          internalAssignedByPosition: ownerUserId ? (user.position || "") : "",
          internalAssignedAt: ownerUserId ? FirebaseService.serverTimestamp() : null,
          adjustmentApproverUserId: user.uid,
          adjustmentApproverName: user.fullName || "",
          assignedAt: ownerUserId ? FirebaseService.serverTimestamp() : null,
          assignmentStatus,
          status,
          progress: 0,
          priority: "DOT_XUAT",
          deadline: FirebaseService.Timestamp.fromDate(deadlineDate),
          deadlineDateKey,
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
          scoringVersion: "KPI_2026_V1_13",
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
        transaction.set(notificationLogReference, TaskLogService.buildTaskLog({
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

    // Gửi chủ động ngay sau khi transaction thành công. Bridge taskLogs vẫn được giữ
    // như lớp dự phòng và dùng cùng eventId để Apps Script chống gửi trùng.
    const createNotificationAction = directorCreatesDepartmentTask
      ? "TASK_DEPARTMENT_ASSIGNED"
      : "TASK_CREATED";
    await TaskNotificationService.send(
      createNotificationAction,
      result.id,
      {
        sourceAction: "TASK_CREATED",
        taskCode: result.taskCode || "",
        periodId: result.periodId || "",
        performedByUserId: user.uid,
        performedByName: user.fullName || "",
        performedByRole: user.role || "",
        performedByDepartmentId: user.departmentId || ""
      },
      { eventId: `TASKLOG_${notificationLogReference.id}` }
    );

    return result;
  },

  async acceptDepartment(task) {
    const user = UserContext.requireUser();
    const taskDepartmentId = normalizeDepartmentId(task?.primaryDepartmentId);
    const userDepartmentId = normalizeDepartmentId(user?.departmentId);
    const mayAccept = Permissions.isDepartmentLeader()
      && taskDepartmentId
      && taskDepartmentId === userDepartmentId;

    if (!mayAccept) {
      throw new Error("Chỉ Trưởng/Phó Phòng/Khu phụ trách mới được xác nhận tiếp nhận nhiệm vụ.");
    }
    if (String(task?.ownerUserId || "").trim()) {
      throw new Error("Nhiệm vụ đã có người phụ trách nên không còn ở bước Phòng/Khu tiếp nhận.");
    }
    if (task?.active === false || task?.completedAt) {
      throw new Error("Nhiệm vụ không còn hiệu lực để tiếp nhận.");
    }

    const departmentStatus = String(task?.departmentAssignmentStatus || "").trim().toUpperCase();
    const status = String(task?.status || "").trim().toUpperCase();
    const assignmentStatus = String(task?.assignmentStatus || "").trim().toUpperCase();
    const entryMode = String(task?.entryMode || "").trim().toUpperCase();
    const createdByRole = String(task?.createdByRole || "").trim().toUpperCase();
    const legacyDirectorTask = !departmentStatus
      && (entryMode === "DIRECT_ASSIGNED" || ["DIRECTOR", "ADMIN"].includes(createdByRole))
      && (status === "CHO_PHAN_CONG" || assignmentStatus === "CHO_PHAN_CONG");

    if (departmentStatus !== "PENDING_ACCEPTANCE" && !legacyDirectorTask) {
      if (departmentStatus === "ACCEPTED") {
        throw new Error("Phòng/Khu đã xác nhận tiếp nhận nhiệm vụ trước đó.");
      }
      throw new Error("Nhiệm vụ không ở trạng thái chờ Phòng/Khu tiếp nhận.");
    }

    const before = snapshotTask(task);
    const payload = {
      assignmentMode: "DEPARTMENT",
      departmentAssignmentStatus: "ACCEPTED",
      departmentAcceptedAt: FirebaseService.serverTimestamp(),
      departmentAcceptedByUserId: user.uid,
      departmentAcceptedByName: user.fullName || "",
      departmentAcceptedByPosition: user.position || "",
      assignmentStatus: "CHO_PHAN_CONG",
      status: "CHO_PHAN_CONG",
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: user.uid,
      updatedByName: user.fullName || ""
    };

    try {
      await FirebaseService.updateDoc(taskRef(task.id), payload);
    } catch (error) {
      console.error("TASK_DEPARTMENT_ACCEPT_FAILED", {
        buildVersion: TASK_WRITE_BUILD_VERSION,
        taskId: task?.id || "",
        taskCode: task?.taskCode || "",
        currentUserId: user.uid,
        currentDepartmentId: user.departmentId || "",
        taskDepartmentId: task?.primaryDepartmentId || "",
        sourceStatus: task?.status || "",
        sourceAssignmentStatus: task?.assignmentStatus || "",
        sourceDepartmentAssignmentStatus: task?.departmentAssignmentStatus || "",
        errorCode: error?.code || "",
        errorMessage: error?.message || String(error),
        error
      });
      throw error;
    }

    const notificationLogReference = logRef();
    try {
      await FirebaseService.setDoc(notificationLogReference, TaskLogService.buildTaskLog({
        taskId: task.id,
        taskCode: task.taskCode,
        periodId: task.periodId || "",
        action: "TASK_DEPARTMENT_ACCEPTED",
        before,
        after: {
          ...before,
          ...payload,
          departmentAcceptedAt: null,
          updatedAt: null
        }
      }));
    } catch (logError) {
      console.warn("Phòng/Khu đã tiếp nhận nhưng chưa ghi được nhật ký:", logError);
    }

    await TaskNotificationService.send(
      "TASK_DEPARTMENT_ACCEPTED",
      task.id,
      {
        sourceAction: "TASK_DEPARTMENT_ACCEPTED",
        taskCode: task.taskCode || "",
        periodId: task.periodId || "",
        performedByUserId: user.uid,
        performedByName: user.fullName || "",
        performedByRole: user.role || "",
        performedByDepartmentId: user.departmentId || ""
      },
      { eventId: `TASKLOG_${notificationLogReference.id}` }
    );
  },

  async assign(task, assignment) {
    const user = UserContext.requireUser();
    const selfRegistered = String(task?.entryMode || "").toUpperCase() === "SELF_REGISTERED_APPROVED"
      || (String(task?.sourceType || "").toUpperCase() === "DANG_KY_KE_HOACH" && String(task?.registrationId || "").trim() !== "");
    if (selfRegistered) {
      throw new Error("Đầu việc do cá nhân đăng ký phải do chính người đăng ký thực hiện; không được phân công lại.");
    }

    const taskDepartmentId = String(task?.primaryDepartmentId || "").trim().toUpperCase();
    const userDepartmentId = String(user?.departmentId || "").trim().toUpperCase();
    const delegatedTaskCreator = await hasTaskCreateDelegation(user, taskDepartmentId);
    const mayAssign = Permissions.isAdmin()
      || (Permissions.hasUnitApprovalAuthority(user) && taskDepartmentId === userDepartmentId)
      || (delegatedTaskCreator && String(task?.createdByUserId || "").trim() === String(user.uid || "").trim());

    if (!mayAssign) {
      throw new Error("Tài khoản không có thẩm quyền phân công nhiệm vụ của Phòng/Khu này.");
    }

    const sourceDepartmentStatus = String(task?.departmentAssignmentStatus || "").toUpperCase();
    const sourceAssignmentStatus = String(task?.assignmentStatus || "").toUpperCase();
    const sourceStatus = String(task?.status || "").toUpperCase();
    const sourceAccepted = sourceDepartmentStatus === "ACCEPTED";

    if (!sourceAccepted) {
      throw new Error("Phòng/Khu phải xác nhận tiếp nhận nhiệm vụ trước khi phân công nội bộ.");
    }

    if (sourceAssignmentStatus === "DA_TIEP_NHAN" || task?.acceptedAt) {
      throw new Error("Cá nhân đã tiếp nhận nhiệm vụ; không thể dùng thao tác phân công ban đầu để đổi người thực hiện.");
    }

    const before = snapshotTask(task);

    const ownerUserId = String(assignment?.ownerUserId || "").trim();
    let ownerName = String(assignment?.ownerName || "").trim();
    let ownerPosition = String(assignment?.ownerPosition || "").trim();
    const teamId = String(assignment?.teamId || "").trim().toUpperCase();

    if (ownerUserId) {
      const ownerSnapshot = await FirebaseService.getDoc(
        FirebaseService.doc(FirebaseService.db, "users", ownerUserId)
      );
      if (!ownerSnapshot.exists()) {
        throw new Error("Không tìm thấy hồ sơ người được phân công trên hệ thống.");
      }
      const ownerProfile = ownerSnapshot.data() || {};
      const ownerDepartmentId = normalizeDepartmentId(ownerProfile.departmentId);
      const ownerTeamId = String(ownerProfile.teamId || "").trim().toUpperCase();
      if (ownerProfile.active !== true) {
        throw new Error("Tài khoản người được phân công đang ngừng hoạt động.");
      }
      if (ownerDepartmentId !== taskDepartmentId) {
        throw new Error("Người được chọn không thuộc đúng Phòng/Khu của nhiệm vụ.");
      }
      if (teamId && ownerTeamId !== teamId) {
        throw new Error("Người được chọn không thuộc Tổ/Nhóm đang phân công.");
      }
      ownerName = String(ownerProfile.fullName || ownerName || "").trim();
      ownerPosition = String(ownerProfile.position || ownerPosition || "").trim();
    }

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
        buildVersion: TASK_WRITE_BUILD_VERSION,
        taskId: task?.id || "",
        taskCode: task?.taskCode || "",
        currentUserId: user.uid,
        currentRole: user.role || "",
        currentLeaderLevel: user.leaderLevel || "",
        currentDepartmentId: user.departmentId || "",
        taskDepartmentId: task?.primaryDepartmentId || "",
        sourceStatus: task?.status || "",
        sourceAssignmentStatus: task?.assignmentStatus || "",
        sourceDepartmentAssignmentStatus: task?.departmentAssignmentStatus || "",
        previousAssignmentMode: task?.assignmentMode || "",
        previousDepartmentAssignmentStatus: task?.departmentAssignmentStatus || "",
        newAssignmentMode: payload.assignmentMode,
        newDepartmentAssignmentStatus: task?.departmentAssignmentStatus || "",
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
    const notificationLogReference = logRef();
    try {
      await FirebaseService.setDoc(notificationLogReference, TaskLogService.buildTaskLog({
        taskId: task.id,
        taskCode: task.taskCode,
        periodId: task.periodId || "",
        action: "TASK_INTERNAL_ASSIGNED",
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
        "Nhiệm vụ đã được phân công nhưng chưa ghi được nhật ký TASK_INTERNAL_ASSIGNED:",
        logError
      );
    }

    if (ownerUserId) {
      await TaskNotificationService.send(
        "TASK_INTERNAL_ASSIGNED",
        task.id,
        {
          sourceAction: "TASK_INTERNAL_ASSIGNED",
          taskCode: task.taskCode || "",
          periodId: task.periodId || "",
          performedByUserId: user.uid,
          performedByName: user.fullName || "",
          performedByRole: user.role || "",
          performedByDepartmentId: user.departmentId || ""
        },
        { eventId: `TASKLOG_${notificationLogReference.id}` }
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
    const notificationLogReference = logRef();
    try {
      await FirebaseService.setDoc(notificationLogReference, TaskLogService.buildTaskLog({
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

    await TaskNotificationService.send(
      "TASK_PERSONAL_ACCEPTED",
      task.id,
      {
        sourceAction: "TASK_ACCEPTED",
        taskCode: task.taskCode || "",
        periodId: task.periodId || "",
        performedByUserId: user.uid,
        performedByName: user.fullName || "",
        performedByRole: user.role || "",
        performedByDepartmentId: user.departmentId || ""
      },
      { eventId: `TASKLOG_${notificationLogReference.id}` }
    );
  },

  async updateProgress(task, changes) {
    const user = UserContext.requireUser();
    if (task.ownerUserId !== user.uid) throw new Error("Chỉ người thực hiện mới được cập nhật trạng thái và minh chứng nhiệm vụ.");
    if (task.assignmentStatus !== "DA_TIEP_NHAN") {
      throw new Error("Bạn cần xác nhận đã nhận nhiệm vụ trước khi cập nhật trạng thái hoặc minh chứng.");
    }
    if (task.active === false || String(task.status || "").toUpperCase() === "HUY") {
      throw new Error("Nhiệm vụ không còn hoạt động.");
    }
    if (String(task.status || "").toUpperCase() === "HOAN_THANH" || task.completedAt) {
      throw new Error("Nhiệm vụ đã hoàn thành; không thể cập nhật trực tiếp.");
    }

    const status = String(changes.status || "").toUpperCase();
    if (!["DANG_XU_LY", "TAM_DUNG", "HOAN_THANH"].includes(status)) {
      throw new Error("Trạng thái cập nhật chưa hợp lệ.");
    }
    if (["DAILY", "WEEKLY", "MONTHLY"].includes(String(task.milestoneMode || "").toUpperCase()) && status === "HOAN_THANH") {
      throw new Error("Nhiệm vụ định kỳ chỉ kết thúc sau khi hoàn thành mốc cuối cùng.");
    }

    const evidenceUrl = changes.evidenceUrl || "";
    const payload = {
      status,
      evidenceType: changes.evidenceType || "",
      evidenceUrl,
      evidenceLink: evidenceUrl,
      evidenceText: changes.evidenceText || "",
      evidenceFileName: changes.evidenceFileName || "",
      evidenceStoragePath: changes.evidenceStoragePath || "",
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: user.uid,
      updatedByName: user.fullName || ""
    };

    // Progress vận hành không còn nhập tay. Chỉ khi hoàn thành thật sự mới ghi 100.
    // Các field legacy progressNote/result/resultSummary/difficulties/proposal không bị xóa/ghi đè.
    if (status === "HOAN_THANH") {
      payload.progress = 100;
      payload.completedAt = FirebaseService.serverTimestamp();
      payload.completedByUserId = user.uid;
      payload.completedByName = user.fullName || "";
    }

    const notificationAction = status === "HOAN_THANH" ? "TASK_COMPLETED" : "TASK_UPDATED";
    const notificationLogReference = logRef();
    const batch = FirebaseService.writeBatch(FirebaseService.db);
    batch.update(taskRef(task.id), payload);
    batch.set(notificationLogReference, TaskLogService.buildTaskLog({
      taskId: task.id,
      taskCode: task.taskCode,
      periodId: task.periodId || "",
      action: notificationAction,
      before: snapshotTask(task),
      after: { ...snapshotTask(task), ...payload, updatedAt: null, completedAt: null },
      note: status === "HOAN_THANH" ? "Hoàn thành nhiệm vụ; tiến độ được hệ thống tự ghi 100%." : "Cập nhật trạng thái/minh chứng nhiệm vụ."
    }));
    await confirmWriteWithServerRecovery(
      batch.commit(),
      () => taskUpdateConfirmedOnServer(task.id, notificationLogReference.id, user.uid, {
        status: payload.status,
        evidenceText: payload.evidenceText,
        evidenceUrl: payload.evidenceUrl
      })
    );

    // TaskNotificationService.send() chỉ enqueue; Push không nằm trên critical path Firestore/UI.
    await TaskNotificationService.send(
      notificationAction,
      task.id,
      {
        sourceAction: notificationAction,
        taskCode: task.taskCode || "",
        periodId: task.periodId || "",
        oldStatus: task.status || "",
        newStatus: payload.status || "",
        oldProgress: Number(task.progress || 0),
        newProgress: status === "HOAN_THANH" ? 100 : Number(task.progress || 0),
        performedByUserId: user.uid,
        performedByName: user.fullName || "",
        performedByRole: user.role || "",
        performedByDepartmentId: user.departmentId || ""
      },
      { eventId: `TASKLOG_${notificationLogReference.id}` }
    );
  },

  async endEventDrivenTracking(task, summary, changes = {}) {
    const user = UserContext.requireUser();
    if (task.ownerUserId !== user.uid) throw new Error("Chỉ người thực hiện mới được kết thúc theo dõi phát sinh.");
    if (String(task.deadlineMode || "").toUpperCase() !== "EVENT_DRIVEN" || String(task.trackingMode || "").toUpperCase() !== "ITEMIZED") {
      throw new Error("Thao tác này chỉ áp dụng cho nhiệm vụ Khi phát sinh.");
    }
    if (task.active === false || String(task.status || "").toUpperCase() === "HUY") throw new Error("Nhiệm vụ không còn hoạt động.");
    if (String(task.status || "").toUpperCase() === "HOAN_THANH" || task.completedAt) throw new Error("Nhiệm vụ đã kết thúc theo dõi.");
    const total = Number(summary?.totalRecordedCount ?? summary?.count ?? task.eventWorkItemCount ?? 0);
    const completed = Number(summary?.completedCount ?? task.eventCompletedCount ?? 0);
    if (total <= 0) throw new Error("Chưa có lượt phát sinh. Nếu cả kỳ không phát sinh, hãy dùng quy trình Đề nghị Không phát sinh.");
    if (completed < total) throw new Error(`Còn ${total - completed} lượt chưa hoàn thành. Hãy xử lý hết các lượt trước khi kết thúc theo dõi trong kỳ.`);
    const kpiProgress = Number(summary?.appliedProgressRate ?? task.eventProgressRate ?? 0);
    const resultRate = summary?.appliedResultRate == null ? null : Number(summary.appliedResultRate);
    const payload = {
      status: "HOAN_THANH",
      // Hoàn thành nghiệp vụ = 100%; KPI đúng/trễ hạn được giữ riêng ở eventProgressRate.
      progress: 100,
      eventProgressRate: kpiProgress,
      eventResultRate: resultRate,
      eventWorkItemCount: total,
      eventCompletedCount: completed,
      eventTrackingClosedAt: FirebaseService.serverTimestamp(),
      eventTrackingClosedByUserId: user.uid,
      eventTrackingClosedByName: user.fullName || "",
      completedAt: FirebaseService.serverTimestamp(),
      completedByUserId: user.uid,
      completedByName: user.fullName || "",
      evidenceType: changes.evidenceType || task.evidenceType || "",
      evidenceUrl: changes.evidenceUrl || task.evidenceUrl || "",
      evidenceLink: changes.evidenceUrl || task.evidenceUrl || "",
      evidenceText: changes.evidenceText ?? task.evidenceText ?? "",
      evidenceFileName: changes.evidenceFileName || task.evidenceFileName || "",
      evidenceStoragePath: changes.evidenceStoragePath || task.evidenceStoragePath || "",
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: user.uid,
      updatedByName: user.fullName || ""
    };
    const notificationLogReference = logRef();
    const batch = FirebaseService.writeBatch(FirebaseService.db);
    batch.update(taskRef(task.id), payload);
    batch.set(notificationLogReference, TaskLogService.buildTaskLog({
      taskId: task.id, taskCode: task.taskCode, periodId: task.periodId || "",
      action: "EVENT_TRACKING_CLOSED", before: snapshotTask(task),
      after: { ...snapshotTask(task), ...payload, updatedAt: null, completedAt: null, eventTrackingClosedAt: null },
      note: `Kết thúc theo dõi phát sinh trong kỳ: hoàn thành nghiệp vụ ${completed}/${total} = 100%; KPI tiến độ ${kpiProgress}%${resultRate == null ? "" : `; KPI kết quả ${resultRate}%`}.`
    }));
    const commitResult = await confirmWriteWithServerRecovery(
      batch.commit(),
      () => eventTrackingClosedOnServer(task.id, notificationLogReference.id, user.uid),
      {
        earlyVerifyAfterMs: 1500,
        overallTimeoutMs: 12000,
        verifyAttempts: 6,
        verifyDelayMs: 900,
        verifyReadTimeoutMs: 3000
      }
    );
    await TaskNotificationService.send("TASK_COMPLETED", task.id, {
      sourceAction: "EVENT_TRACKING_CLOSED", taskCode: task.taskCode || "", periodId: task.periodId || "",
      oldStatus: task.status || "", newStatus: "HOAN_THANH", oldProgress: Number(task.progress || 0), newProgress: 100,
      eventProgressRate: kpiProgress, eventResultRate: resultRate, eventWorkItemCount: total, eventCompletedCount: completed,
      performedByUserId: user.uid, performedByName: user.fullName || "", performedByRole: user.role || "", performedByDepartmentId: user.departmentId || ""
    }, { eventId: `TASKLOG_${notificationLogReference.id}` });
    return {
      closed: true,
      operationalProgress: 100,
      kpiProgressRate: kpiProgress,
      kpiResultRate: resultRate,
      recoveredFromTimeout: commitResult.recovered === true,
      earlyVerified: commitResult.earlyVerified === true
    };
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
    const items = await TaskWorkItemService.list(task);
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
    const items = await TaskWorkItemService.list(task);
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
