/**
 * Notification Center trong ứng dụng - V1.23.0.
 *
 * taskLogs/kpiAuditLogs vẫn là audit/source of truth. Collection này chỉ là read-model UX.
 * Mọi thao tác phát thông báo là best-effort và tuyệt đối không chặn business write.
 */
import { FirebaseService } from "../core/firebase-service.js?v=20260904.V1_23_0";
import { UserContext } from "../core/user-context.js?v=20260904.V1_23_0";

const clean = value => String(value ?? "").trim();
const upper = value => clean(value).toUpperCase();

const MANAGER_UPDATE_ACTIONS = new Set([
  "TASK_PERSONAL_ACCEPTED",
  "TASK_UPDATED",
  "TASK_EDITED",
  "TASK_COMPLETED",
  "TASK_ADJUSTMENT_REQUESTED",
  "TASK_WORK_ITEM_UPDATED",
  "TASK_EVIDENCE_UPDATED",
  "TASK_MILESTONE_UPDATED"
]);

const ACTION_LABELS = Object.freeze({
  TASK_PERSONAL_ACCEPTED: "đã tiếp nhận nhiệm vụ",
  TASK_UPDATED: "vừa cập nhật nhiệm vụ",
  TASK_EDITED: "vừa cập nhật nhiệm vụ",
  TASK_COMPLETED: "đã hoàn thành nhiệm vụ",
  TASK_ADJUSTMENT_REQUESTED: "vừa gửi đề nghị điều chỉnh nhiệm vụ",
  TASK_WORK_ITEM_UPDATED: "vừa cập nhật lượt công việc",
  TASK_EVIDENCE_UPDATED: "vừa cập nhật minh chứng",
  TASK_MILESTONE_UPDATED: "vừa hoàn thành một mốc nhiệm vụ"
});

function safeId(value) {
  const source = clean(value) || `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${Math.abs(hash >>> 0).toString(36)}_${source.replace(/[^A-Za-z0-9_-]/g, "_").slice(-80)}`.slice(0, 140);
}

function notificationRef(recipientUserId, notificationId) {
  return FirebaseService.doc(
    FirebaseService.db,
    "userNotifications",
    clean(recipientUserId),
    "items",
    clean(notificationId)
  );
}

function taskDepartment(task = {}) {
  return upper(task.primaryDepartmentId || task.departmentId || task.homeDepartmentId || task.organizationId);
}

function taskRoute(taskId) {
  return "#/tasks";
}

async function createNotification(recipientUserId, payload, dedupeKey) {
  const actor = UserContext.requireUser();
  const recipient = clean(recipientUserId);
  if (!recipient || recipient === actor.uid) return false;
  const key = clean(dedupeKey);
  const id = safeId(`${key}|${recipient}`);
  try {
    await FirebaseService.setDoc(notificationRef(recipient, id), {
      recipientUserId: recipient,
      eventType: upper(payload.eventType),
      sourceType: upper(payload.sourceType),
      sourceId: clean(payload.sourceId),
      taskId: clean(payload.taskId),
      registrationId: clean(payload.registrationId),
      taskCode: clean(payload.taskCode),
      periodId: clean(payload.periodId),
      departmentId: upper(payload.departmentId),
      subjectUserId: clean(payload.subjectUserId),
      actorUserId: actor.uid,
      actorName: actor.fullName || actor.email || "Người dùng",
      actorRole: actor.role || "",
      title: clean(payload.title) || "Thông báo",
      message: clean(payload.message),
      route: clean(payload.route),
      dedupeKey: key,
      read: false,
      readAt: null,
      createdAt: FirebaseService.serverTimestamp(),
      updatedAt: FirebaseService.serverTimestamp()
    }, { merge: false });
    return true;
  } catch (error) {
    // Bản ghi deterministic có thể đã tồn tại do retry/bridge; đó không phải lỗi nghiệp vụ.
    console.warn("Không ghi được Notification Center; nghiệp vụ chính vẫn đã hoàn tất:", error);
    return false;
  }
}

async function loadTask(taskId) {
  const id = clean(taskId);
  if (!id) return null;
  const snapshot = await FirebaseService.getDoc(FirebaseService.doc(FirebaseService.db, "tasks", id));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

async function loadAuthorityDirectory(departmentId) {
  const department = upper(departmentId);
  if (!department) return null;
  const snapshot = await FirebaseService.getDoc(
    FirebaseService.doc(FirebaseService.db, "departmentAuthorities", department)
  );
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

const authorityRecipientCache = new Map();
const AUTHORITY_CACHE_TTL_MS = 5 * 60 * 1000;

function profileAuthorityRecipient(user, departmentId) {
  const department = upper(departmentId);
  if (!user || user.active !== true || !department) return false;
  const additionalRoles = Array.isArray(user.additionalRoles) ? user.additionalRoles.map(upper) : [];
  if (department === "CDTN") return additionalRoles.includes("CDTN_BI_THU") || additionalRoles.includes("CDTN_PHO_BI_THU");
  const primaryDepartment = upper(user.departmentId);
  const role = upper(user.role);
  const authority = upper(user.approvalAuthority);
  const actingHead = Array.isArray(user.actingHeadDepartmentIds) && user.actingHeadDepartmentIds.map(upper).includes(department);
  const oversight = Array.isArray(user.actingOversightDepartmentIds) && user.actingOversightDepartmentIds.map(upper).includes(department);
  return (role === "DEPARTMENT_LEADER" && primaryDepartment === department && ["HEAD", "DEPUTY"].includes(authority))
    || actingHead || oversight;
}

async function queryAuthorityProfiles(departmentId) {
  const department = upper(departmentId);
  if (!department) return [];
  const cached = authorityRecipientCache.get(department);
  if (cached && Date.now() - cached.at < AUTHORITY_CACHE_TTL_MS) return cached.uids;

  const users = FirebaseService.collection(FirebaseService.db, "users");
  const queries = [];
  if (department === "CDTN") {
    // Firestore không query được nhiều additionalRoles theo OR an toàn; directory là nguồn nhanh cho CDTN.
  } else {
    queries.push(FirebaseService.query(users, FirebaseService.where("departmentId", "==", department), FirebaseService.limit(100)));
    queries.push(FirebaseService.query(users, FirebaseService.where("actingHeadDepartmentIds", "array-contains", department), FirebaseService.limit(20)));
    queries.push(FirebaseService.query(users, FirebaseService.where("actingOversightDepartmentIds", "array-contains", department), FirebaseService.limit(20)));
  }
  if (!queries.length) return [];
  const settled = await Promise.allSettled(queries.map(queryRef => FirebaseService.getDocs(queryRef)));
  const byId = new Map();
  settled.forEach(result => {
    if (result.status !== "fulfilled") return;
    result.value.docs.forEach(doc => {
      const profile = { id: doc.id, ...doc.data() };
      if (profileAuthorityRecipient(profile, department)) byId.set(doc.id, profile);
    });
  });
  const uids = [...byId.keys()];
  authorityRecipientCache.set(department, { at: Date.now(), uids });
  return uids;
}

async function loadActiveApprovalDelegate(departmentId) {
  const department = upper(departmentId);
  if (!department) return "";
  const id = department === "CDTN" ? "CDTN_APPROVAL_ACTIVE" : `${department}_ACTIVE`;
  try {
    const snapshot = await FirebaseService.getDoc(FirebaseService.doc(FirebaseService.db, "approvalDelegations", id));
    if (!snapshot.exists()) return "";
    const data = snapshot.data() || {};
    if (data.active !== true || upper(data.departmentId) !== department) return "";
    const now = Date.now();
    const start = data.startAt?.toMillis?.() || 0;
    const end = data.endAt?.toMillis?.() || Number.MAX_SAFE_INTEGER;
    if (start && now < start) return "";
    if (end && now > end) return "";
    const permissions = Array.isArray(data.permissions) ? data.permissions.map(upper) : [];
    if (permissions.length && !permissions.includes("APPROVE_REGISTRATIONS") && !permissions.includes("CONFIRM_EVALUATIONS")) return "";
    return clean(data.delegateUserId);
  } catch (error) {
    console.warn("Không tải được ủy quyền để bổ sung recipient thông báo:", error);
    return "";
  }
}

async function notifyManagersFromTaskAction(action, taskId, eventData = {}, eventId = "") {
  const actor = UserContext.requireUser();
  const requestedAction = upper(action);
  const sourceAction = upper(eventData?.sourceAction);
  const normalizedAction = sourceAction === "TASK_MILESTONE_COMPLETED" ? "TASK_MILESTONE_UPDATED" : requestedAction;
  if (!MANAGER_UPDATE_ACTIONS.has(normalizedAction)) return false;

  const task = await loadTask(taskId);
  if (!task || task.active === false) return false;
  // Chỉ các cập nhật do chính người thực hiện nhiệm vụ tạo ra mới gửi lên quản lý.
  if (clean(task.ownerUserId) !== actor.uid) return false;

  const departmentId = taskDepartment(task);
  if (!departmentId) return false;
  const directory = await loadAuthorityDirectory(departmentId);
  const directoryRecipients = Array.isArray(directory?.notificationRecipientUserIds)
    ? directory.notificationRecipientUserIds.map(clean).filter(Boolean)
    : [];
  // Directory do Apps Script duy trì để giảm reads. Profile-query là fallback khi một lãnh đạo mới
  // vừa đăng nhập lần đầu sau lần sync gần nhất; cache 5 phút nên vẫn nhẹ với ~140 tài khoản.
  const [profileRecipients, delegatedRecipient] = await Promise.all([
    queryAuthorityProfiles(departmentId),
    loadActiveApprovalDelegate(departmentId)
  ]);
  const recipients = [...new Set([...directoryRecipients, ...profileRecipients, clean(delegatedRecipient)].filter(Boolean))];
  if (!recipients.length) return false;

  const verb = ACTION_LABELS[normalizedAction] || "vừa cập nhật nhiệm vụ";
  const taskCode = clean(task.taskCode || eventData.taskCode);
  const taskName = clean(task.title || task.standardTaskName || task.name);
  const suffix = [taskCode, taskName].filter(Boolean).join(" – ");
  const key = clean(eventId) || `${normalizedAction}_${task.id}_${clean(task.updatedAt?.seconds || Date.now())}`;

  const results = await Promise.allSettled(recipients
    .filter(uid => uid !== actor.uid)
    .map(uid => createNotification(uid, {
      eventType: normalizedAction,
      sourceType: "TASK",
      sourceId: task.id,
      taskId: task.id,
      registrationId: clean(task.registrationId),
      taskCode,
      periodId: clean(task.periodId),
      departmentId,
      subjectUserId: clean(task.ownerUserId),
      title: "Cập nhật nhiệm vụ",
      message: `${actor.fullName || actor.email} ${verb}${suffix ? ` ${suffix}` : ""}.`,
      route: taskRoute(task.id)
    }, key)));
  return results.some(result => result.status === "fulfilled" && result.value === true);
}

async function notifyRegistrationDecision(registration, reviewer, status, options = {}) {
  const recipient = clean(registration?.userId);
  if (!recipient) return false;
  const normalizedStatus = upper(status);
  const approved = normalizedStatus === "APPROVED";
  const taskCode = clean(options.taskCode || registration?.taskCode || registration?.standardTaskCode);
  const taskId = clean(options.taskId || registration?.taskId);
  const actorName = clean(reviewer?.fullName || reviewer?.email) || "Người phê duyệt";
  const key = clean(options.eventId)
    || `REG_${normalizedStatus}_${clean(registration?.id)}_${taskId || safeId(clean(options.reason || Date.now()))}`;
  return createNotification(recipient, {
    eventType: approved ? "REGISTRATION_APPROVED" : "REGISTRATION_REJECTED",
    sourceType: "TASK_REGISTRATION",
    sourceId: clean(registration?.id),
    registrationId: clean(registration?.id),
    taskId,
    taskCode,
    periodId: clean(registration?.periodId),
    departmentId: upper(registration?.departmentId || registration?.standardTaskDepartmentId),
    subjectUserId: recipient,
    title: approved ? "Đầu việc đã được duyệt" : "Đầu việc chưa được duyệt",
    message: approved
      ? `${actorName} đã duyệt ${taskCode ? `đầu việc ${taskCode}` : "đầu việc"} của bạn.`
      : `${actorName} chưa duyệt ${taskCode ? `đầu việc ${taskCode}` : "đầu việc"} của bạn${clean(options.reason) ? `: ${clean(options.reason)}` : "."}`,
    route: "#/standard-tasks"
  }, key);
}

function mapSnapshot(snapshot) {
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

export const UserNotificationService = Object.freeze({
  subscribeCurrentUser(onData, onError) {
    const user = UserContext.requireUser();
    const reference = FirebaseService.query(
      FirebaseService.collection(FirebaseService.db, "userNotifications", user.uid, "items"),
      FirebaseService.orderBy("createdAt", "desc"),
      FirebaseService.limit(100)
    );
    return FirebaseService.onSnapshot(reference,
      snapshot => onData?.(mapSnapshot(snapshot)),
      error => onError?.(error));
  },

  async markRead(notificationId) {
    const user = UserContext.requireUser();
    await FirebaseService.updateDoc(notificationRef(user.uid, notificationId), {
      read: true,
      readAt: FirebaseService.serverTimestamp(),
      updatedAt: FirebaseService.serverTimestamp()
    });
  },

  async markAllRead(items = []) {
    const user = UserContext.requireUser();
    const unread = items.filter(item => item?.id && item.read !== true).slice(0, 400);
    if (!unread.length) return 0;
    const batch = FirebaseService.writeBatch(FirebaseService.db);
    unread.forEach(item => batch.update(notificationRef(user.uid, item.id), {
      read: true,
      readAt: FirebaseService.serverTimestamp(),
      updatedAt: FirebaseService.serverTimestamp()
    }));
    await batch.commit();
    return unread.length;
  },

  notifyTaskAction(action, taskId, eventData = {}, eventId = "") {
    return notifyManagersFromTaskAction(action, taskId, eventData, eventId);
  },

  notifyRegistrationDecision
});
