/**
 * Phân hệ Chỉ đạo điều hành V1.14.0 - Free-tier scale & realtime lifecycle hardening.
 * Độc lập hoàn toàn với Nhiệm vụ/KPI.
 *
 * Collections:
 * - executiveDirectives
 * - executiveDirectiveUpdates (lịch sử append-only)
 * - executiveDirectiveStates (trạng thái hiện hành theo Phòng/Khu)
 * - executiveWeeklyReports
 */
import { FirebaseService } from "../core/firebase-service.js?v=20260826.V1_18_5";
import { UserContext } from "../core/user-context.js?v=20260826.V1_18_5";
import { Permissions } from "../core/permissions.js?v=20260826.V1_18_5";
import { ExecutiveNotificationService } from "./executive-notification-service.js?v=20260826.V1_18_5";

const DIRECTIVES = "executiveDirectives";
const UPDATES = "executiveDirectiveUpdates";
const STATES = "executiveDirectiveStates";
const REPORTS = "executiveWeeklyReports";
const MAX_LIST = 2000;

function clean(value) { return String(value ?? "").trim(); }
function upper(value) { return clean(value).toUpperCase(); }
function normalizeDateKey(value) {
  const text = clean(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}
function uniqueUpper(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(upper).filter(Boolean))];
}
function actionDateKey() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}
function assertManager() {
  if (!Permissions.canManageExecutiveDirectives()) {
    throw new Error("Tài khoản không có quyền quản trị Chỉ đạo điều hành.");
  }
}
function assertActiveUser() {
  const user = UserContext.requireUser();
  if (user.active !== true) throw new Error("Tài khoản chưa được kích hoạt.");
  return user;
}
function directiveRef(id) {
  return FirebaseService.doc(FirebaseService.db, DIRECTIVES, clean(id));
}
function updateRef() {
  return FirebaseService.doc(FirebaseService.collection(FirebaseService.db, UPDATES));
}
function acceptanceRef(directiveId, departmentId) {
  return FirebaseService.doc(FirebaseService.db, UPDATES, `ACCEPTED_${clean(directiveId)}_${upper(departmentId)}`);
}
function stateId(directiveId, departmentId) {
  return `${clean(directiveId)}__${upper(departmentId)}`;
}
function stateRef(directiveId, departmentId) {
  return FirebaseService.doc(FirebaseService.db, STATES, stateId(directiveId, departmentId));
}
function reportId(weekStart, departmentId = "ALL") {
  return `${upper(departmentId || "ALL")}_${normalizeDateKey(weekStart)}`;
}
function reportRef(weekStart, departmentId = "ALL") {
  return FirebaseService.doc(FirebaseService.db, REPORTS, reportId(weekStart, departmentId));
}
function mapSnapshot(snapshot) {
  return snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
}
function sortDirectives(items = []) {
  return [...items].sort((a, b) => {
    const date = clean(b.directedDateKey).localeCompare(clean(a.directedDateKey));
    if (date) return date;
    return clean(b.createdAt?.toDate?.()?.toISOString?.() || "").localeCompare(clean(a.createdAt?.toDate?.()?.toISOString?.() || ""));
  });
}
function sortUpdates(items = []) {
  return [...items].sort((a, b) => {
    const ad = clean(a.actionDateKey);
    const bd = clean(b.actionDateKey);
    if (ad !== bd) return bd.localeCompare(ad);
    const at = a.createdAt?.toMillis?.() || 0;
    const bt = b.createdAt?.toMillis?.() || 0;
    return bt - at;
  });
}

function subscribeSnapshotDeferred(reference, onSnapshotData, onError, options = {}) {
  let cancelled = false;
  let timer = null;
  let unsubscribe = null;
  const startDelayMs = Math.max(0, Number(options.startDelayMs || 0));
  const jitterMs = Math.max(0, Number(options.jitterMs || 0));

  const begin = () => {
    if (cancelled) return;
    unsubscribe = FirebaseService.onSnapshot(reference, onSnapshotData, onError);
  };
  const delay = startDelayMs + (jitterMs ? Math.floor(Math.random() * jitterMs) : 0);
  if (delay > 0) timer = window.setTimeout(begin, delay);
  else begin();

  return () => {
    cancelled = true;
    if (timer) window.clearTimeout(timer);
    timer = null;
    try { unsubscribe?.(); } catch (_) { /* Đóng listener an toàn. */ }
    unsubscribe = null;
  };
}
function managerAuditPayload(type, directiveId, message, extras = {}) {
  const user = assertActiveUser();
  return {
    directiveId: clean(directiveId),
    departmentId: "__SYSTEM__",
    updateType: upper(type),
    status: "",
    progressSummary: "",
    resultSummary: "",
    evidenceLinks: [],
    note: clean(message),
    actionDateKey: actionDateKey(),
    createdByUserId: user.uid,
    createdByName: user.fullName || user.email,
    createdByRole: user.role,
    createdByDepartmentId: user.departmentId,
    createdAt: FirebaseService.serverTimestamp(),
    ...extras
  };
}
function isDepartmentOperator(user, departmentId) {
  const target = upper(departmentId);
  if (!target || upper(user?.departmentId) !== target) return false;
  if (upper(user?.role) === "DEPARTMENT_LEADER") return true;
  return target === "TCHC" && upper(user?.role) === "TCHC_COORDINATOR";
}
function canUserAccept(directive, departmentId, user = assertActiveUser()) {
  const target = upper(departmentId);
  const visible = uniqueUpper(directive?.visibleDepartmentIds);
  if (!target || !visible.includes(target)) return false;
  return isDepartmentOperator(user, target);
}
function canUserProgress(directive, departmentId, user = assertActiveUser()) {
  const target = upper(departmentId);
  const visible = uniqueUpper(directive?.visibleDepartmentIds);
  if (!target || !visible.includes(target)) return false;
  return upper(user?.departmentId) === target && clean(directive?.assignedUserId) === clean(user?.uid);
}
function canUserAssignInternal(directive, departmentId, user = assertActiveUser()) {
  const target = upper(departmentId);
  const visible = uniqueUpper(directive?.visibleDepartmentIds);
  if (!target || !visible.includes(target)) return false;
  return isDepartmentOperator(user, target);
}
function resolveAssignment() {
  return {
    assignmentLevel: "DEPARTMENT",
    leadTeamId: "",
    leadTeamName: "",
    leadUserId: "",
    leadUserName: "",
    leadUserPosition: ""
  };
}
function transitionAllowed(previous, next) {
  const from = upper(previous);
  const to = upper(next);
  if (to === "IN_PROGRESS") return ["ACCEPTED", "IN_PROGRESS", "PAUSED"].includes(from);
  if (to === "PAUSED") return ["IN_PROGRESS", "PAUSED"].includes(from);
  if (to === "COMPLETED") return from === "IN_PROGRESS";
  return false;
}
function dispatchPushInBackground(action, directiveId, eventData = {}, options = {}) {
  const normalizedAction = upper(action);
  const normalizedDirectiveId = clean(directiveId);
  const eventId = clean(options?.eventId);

  console.info("[EXEC PUSH] Đã xếp hàng gửi nền:", {
    action: normalizedAction,
    directiveId: normalizedDirectiveId,
    eventId
  });

  // Không await ở critical path: dữ liệu nghiệp vụ đã commit thành công trước khi đến đây.
  // keepalive trong ExecutiveNotificationService giúp request tiếp tục gửi khi UI chuyển trạng thái.
  void ExecutiveNotificationService.send(
    normalizedAction,
    normalizedDirectiveId,
    eventData,
    { ...options, confirmDelivery: false }
  ).then(result => {
    const status = upper(result?.status);
    if (["SENT", "SUBMITTED", "NO_SUBSCRIPTIONS"].includes(status)) {
      console.info("[EXEC PUSH] Đã chuyển sang backend:", {
        action: normalizedAction,
        directiveId: normalizedDirectiveId,
        eventId: clean(result?.eventId) || eventId,
        status
      });
    } else {
      console.warn("[EXEC PUSH] Backend chưa xác nhận nhận sự kiện:", {
        action: normalizedAction,
        directiveId: normalizedDirectiveId,
        eventId: clean(result?.eventId) || eventId,
        status: status || "NO_RESULT",
        result
      });
    }
  }).catch(error => {
    console.error("[EXEC PUSH] Gửi nền gặp lỗi:", {
      action: normalizedAction,
      directiveId: normalizedDirectiveId,
      eventId,
      error: error?.message || String(error)
    });
  });

  return { ok: true, status: "QUEUED", eventId };
}

export const ExecutiveDirectiveService = Object.freeze({
  async listDirectives(options = {}) {
    const user = assertActiveUser();
    const collectionRef = FirebaseService.collection(FirebaseService.db, DIRECTIVES);
    let q;
    if (Permissions.canViewAllExecutiveDirectives()) {
      q = FirebaseService.query(collectionRef, FirebaseService.limit(MAX_LIST));
    } else if (upper(user.role) === "DEPARTMENT_LEADER" || (upper(user.role) === "TCHC_COORDINATOR" && upper(user.departmentId) === "TCHC")) {
      if (!user.departmentId) return [];
      q = FirebaseService.query(
        collectionRef,
        FirebaseService.where("visibleDepartmentIds", "array-contains", user.departmentId),
        FirebaseService.limit(MAX_LIST)
      );
    } else {
      if (!user.uid) return [];
      q = FirebaseService.query(
        collectionRef,
        FirebaseService.where("assignedUserId", "==", user.uid),
        FirebaseService.limit(MAX_LIST)
      );
    }
    const items = mapSnapshot(await FirebaseService.getDocs(q));
    const includeDeleted = options.includeDeleted === true && Permissions.canManageExecutiveDirectives();
    return sortDirectives(items.filter(item => includeDeleted || item.isDeleted !== true));
  },

  subscribeDirectives(onNext, onError = console.warn, options = {}) {
    const user = assertActiveUser();
    const collectionRef = FirebaseService.collection(FirebaseService.db, DIRECTIVES);
    const q = Permissions.canViewAllExecutiveDirectives()
      ? FirebaseService.query(collectionRef, FirebaseService.limit(MAX_LIST))
      : (upper(user.role) === "DEPARTMENT_LEADER" || (upper(user.role) === "TCHC_COORDINATOR" && upper(user.departmentId) === "TCHC"))
        ? FirebaseService.query(
            collectionRef,
            FirebaseService.where("visibleDepartmentIds", "array-contains", user.departmentId),
            FirebaseService.limit(MAX_LIST)
          )
        : FirebaseService.query(
            collectionRef,
            FirebaseService.where("assignedUserId", "==", user.uid),
            FirebaseService.limit(MAX_LIST)
          );
    return subscribeSnapshotDeferred(q, snapshot => {
      const items = sortDirectives(mapSnapshot(snapshot).filter(item => item.isDeleted !== true));
      onNext(items);
    }, onError, options);
  },

  async listUpdates() {
    const user = assertActiveUser();
    const collectionRef = FirebaseService.collection(FirebaseService.db, UPDATES);
    let q;
    if (Permissions.canViewAllExecutiveDirectives()) {
      q = FirebaseService.query(collectionRef, FirebaseService.limit(MAX_LIST));
    } else if (upper(user.role) === "DEPARTMENT_LEADER" || (upper(user.role) === "TCHC_COORDINATOR" && upper(user.departmentId) === "TCHC")) {
      q = FirebaseService.query(
        collectionRef,
        FirebaseService.where("departmentId", "==", user.departmentId),
        FirebaseService.limit(MAX_LIST)
      );
    } else {
      q = FirebaseService.query(
        collectionRef,
        FirebaseService.where("assignedUserId", "==", user.uid),
        FirebaseService.limit(MAX_LIST)
      );
    }
    return sortUpdates(mapSnapshot(await FirebaseService.getDocs(q)));
  },

  subscribeUpdates(onNext, onError = console.warn, options = {}) {
    const user = assertActiveUser();
    const collectionRef = FirebaseService.collection(FirebaseService.db, UPDATES);
    const q = Permissions.canViewAllExecutiveDirectives()
      ? FirebaseService.query(collectionRef, FirebaseService.limit(MAX_LIST))
      : (upper(user.role) === "DEPARTMENT_LEADER" || (upper(user.role) === "TCHC_COORDINATOR" && upper(user.departmentId) === "TCHC"))
        ? FirebaseService.query(
            collectionRef,
            FirebaseService.where("departmentId", "==", user.departmentId),
            FirebaseService.limit(MAX_LIST)
          )
        : FirebaseService.query(
            collectionRef,
            FirebaseService.where("assignedUserId", "==", user.uid),
            FirebaseService.limit(MAX_LIST)
          );
    return subscribeSnapshotDeferred(
      q,
      snapshot => onNext(sortUpdates(mapSnapshot(snapshot))),
      onError,
      options
    );
  },

  canAcceptDepartment(directive, departmentId = "") {
    return canUserAccept(directive, departmentId || UserContext.getUser()?.departmentId);
  },

  canProgressDepartment(directive, departmentId = "") {
    return canUserProgress(directive, departmentId || UserContext.getUser()?.departmentId);
  },

  async createDirective(input = {}) {
    assertManager();
    const user = assertActiveUser();
    const leadDepartmentId = upper(input.leadDepartmentId);
    if (!leadDepartmentId) throw new Error("Chưa chọn Phòng/Khu chủ trì.");
    const assignment = await resolveAssignment(input, leadDepartmentId);
    const supportDepartmentIds = uniqueUpper(input.supportDepartmentIds).filter(id => id !== leadDepartmentId);
    const visibleDepartmentIds = uniqueUpper([leadDepartmentId, ...supportDepartmentIds]);
    const directedDateKey = normalizeDateKey(input.directedDateKey);
    if (!directedDateKey) throw new Error("Ngày chỉ đạo không hợp lệ.");
    const content = clean(input.content);
    if (!content) throw new Error("Chưa nhập nội dung chỉ đạo.");
    const directedByName = clean(input.directedByName);
    if (!directedByName) throw new Error("Chưa xác định người chỉ đạo.");

    const ref = FirebaseService.doc(FirebaseService.collection(FirebaseService.db, DIRECTIVES));
    const payload = {
      code: clean(input.code),
      sourceType: upper(input.sourceType || "DIRECT"),
      meetingName: clean(input.meetingName),
      referenceText: clean(input.referenceText),
      directedDateKey,
      directedByUserId: clean(input.directedByUserId),
      directedByName,
      content,
      leadDepartmentId,
      ...assignment,
      assignedUserId: "",
      assignedUserName: "",
      assignedUserPosition: "",
      supportDepartmentIds,
      visibleDepartmentIds,
      dueDateKey: normalizeDateKey(input.dueDateKey),
      priority: upper(input.priority || "NORMAL"),
      lifecycleStatus: "ACTIVE",
      closeReason: "",
      closedDateKey: "",
      closedByUserId: "",
      isDeleted: false,
      deletedDateKey: "",
      deletedReason: "",
      createdByUserId: user.uid,
      createdByName: user.fullName || user.email,
      createdByRole: user.role,
      createdByDepartmentId: user.departmentId,
      createdAt: FirebaseService.serverTimestamp(),
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: user.uid,
      updatedByName: user.fullName || user.email
    };
    const batch = FirebaseService.writeBatch(FirebaseService.db);
    batch.set(ref, payload);
    batch.set(updateRef(), managerAuditPayload("DIRECTIVE_CREATED", ref.id, "Tạo nội dung chỉ đạo và giao Phòng/Khu thực hiện.", {
      snapshot: {
        directedDateKey, directedByName, leadDepartmentId,
        assignmentLevel: assignment.assignmentLevel,
        leadTeamId: assignment.leadTeamId,
        leadUserId: assignment.leadUserId,
        leadUserName: assignment.leadUserName,
        supportDepartmentIds, dueDateKey: payload.dueDateKey, priority: payload.priority
      }
    }));
    await batch.commit();
    dispatchPushInBackground("DIRECTIVE_ASSIGNED", ref.id, {
      leadDepartmentId,
      assignmentLevel: "DEPARTMENT",
      leadTeamId: "",
      leadUserId: "",
      supportDepartmentIds,
      visibleDepartmentIds,
      directedByName,
      dueDateKey: payload.dueDateKey
    }, { eventId: `DIRECTIVE_CREATED_${ref.id}` });
    return { id: ref.id, ...payload };
  },

  async createOralDirective(input = {}) {
    const user = assertActiveUser();
    if (!Permissions.canRecordOralExecutiveDirective(user)) {
      throw new Error("Chỉ Trưởng/Phó Phòng/Khu mới được ghi nhận chỉ đạo miệng cho đơn vị mình.");
    }

    const leadDepartmentId = upper(user.departmentId);
    const directedDateKey = normalizeDateKey(input.directedDateKey);
    const content = clean(input.content);
    const directedByName = clean(input.directedByName);
    if (!leadDepartmentId) throw new Error("Tài khoản chưa có Phòng/Khu.");
    if (!directedDateKey) throw new Error("Ngày chỉ đạo không hợp lệ.");
    if (!directedByName) throw new Error("Chưa xác định thành viên Ban Giám đốc đã chỉ đạo.");
    if (!content) throw new Error("Chưa nhập nội dung chỉ đạo.");

    const ref = FirebaseService.doc(FirebaseService.collection(FirebaseService.db, DIRECTIVES));
    const oralHistoryRef = updateRef();
    const acceptRef = acceptanceRef(ref.id, leadDepartmentId);
    const currentStateRef = stateRef(ref.id, leadDepartmentId);
    const dateKey = actionDateKey();
    const payload = {
      code: clean(input.code),
      sourceType: upper(input.sourceType || "DIRECT"),
      entryMode: "LEADER_ORAL_CAPTURE",
      oralCapture: true,
      meetingName: clean(input.meetingName),
      referenceText: clean(input.referenceText),
      directedDateKey,
      directedByUserId: clean(input.directedByUserId),
      directedByName,
      content,
      leadDepartmentId,
      assignmentLevel: "DEPARTMENT",
      leadTeamId: "",
      leadTeamName: "",
      leadUserId: "",
      leadUserName: "",
      leadUserPosition: "",
      assignedUserId: "",
      assignedUserName: "",
      assignedUserPosition: "",
      supportDepartmentIds: [],
      visibleDepartmentIds: [leadDepartmentId],
      dueDateKey: normalizeDateKey(input.dueDateKey),
      priority: upper(input.priority || "NORMAL"),
      lifecycleStatus: "ACTIVE",
      closeReason: "",
      closedDateKey: "",
      closedByUserId: "",
      isDeleted: false,
      deletedDateKey: "",
      deletedReason: "",
      recordedByUserId: user.uid,
      recordedByName: user.fullName || user.email,
      recordedByRole: user.role,
      recordedByDepartmentId: leadDepartmentId,
      recordedAt: FirebaseService.serverTimestamp(),
      createdByUserId: user.uid,
      createdByName: user.fullName || user.email,
      createdByRole: user.role,
      createdByDepartmentId: leadDepartmentId,
      createdAt: FirebaseService.serverTimestamp(),
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: user.uid,
      updatedByName: user.fullName || user.email
    };

    const batch = FirebaseService.writeBatch(FirebaseService.db);
    batch.set(ref, payload);
    batch.set(oralHistoryRef, {
      directiveId: ref.id,
      departmentId: leadDepartmentId,
      updateType: "ORAL_RECORDED",
      status: "ACCEPTED",
      progressSummary: "",
      resultSummary: "",
      evidenceLinks: [],
      note: `${user.fullName || user.email} ghi nhận chỉ đạo của ${directedByName} và tiếp nhận cho ${leadDepartmentId}.`,
      actionDateKey: dateKey,
      directedByUserId: clean(input.directedByUserId),
      directedByName,
      sourceType: payload.sourceType,
      createdByUserId: user.uid,
      createdByName: user.fullName || user.email,
      createdByRole: user.role,
      createdByDepartmentId: leadDepartmentId,
      createdAt: FirebaseService.serverTimestamp()
    });
    batch.set(acceptRef, {
      directiveId: ref.id,
      departmentId: leadDepartmentId,
      updateType: "ACCEPTED",
      status: "ACCEPTED",
      progressSummary: "",
      resultSummary: "",
      evidenceLinks: [],
      note: "Trưởng/Phó Phòng/Khu ghi nhận chỉ đạo miệng và đồng thời xác nhận tiếp nhận.",
      actionDateKey: dateKey,
      acceptedDateKey: dateKey,
      createdByUserId: user.uid,
      createdByName: user.fullName || user.email,
      createdByRole: user.role,
      createdByDepartmentId: leadDepartmentId,
      oralCapture: true,
      createdAt: FirebaseService.serverTimestamp()
    });
    batch.set(currentStateRef, {
      directiveId: ref.id,
      departmentId: leadDepartmentId,
      status: "ACCEPTED",
      acceptedDateKey: dateKey,
      acceptedByUserId: user.uid,
      acceptedByName: user.fullName || user.email,
      assignedUserId: "",
      assignedUserName: "",
      assignedUserPosition: "",
      assignedTeamId: "",
      assignedTeamName: "",
      internalAssignmentStatus: "UNASSIGNED",
      assignedDateKey: "",
      assignedByUserId: "",
      assignedByName: "",
      assignmentSource: "",
      assignmentUpdateId: "",
      personAcceptedDateKey: "",
      personAcceptedByUserId: "",
      personAcceptedByName: "",
      personAcceptanceUpdateId: "",
      lastProgressUpdateId: "",
      startedDateKey: "",
      completedDateKey: "",
      oralCapture: true,
      updatedByUserId: user.uid,
      updatedAt: FirebaseService.serverTimestamp()
    });
    await batch.commit();

    dispatchPushInBackground("DIRECTIVE_ORAL_RECORDED", ref.id, {
      updateId: oralHistoryRef.id,
      departmentId: leadDepartmentId,
      directedByUserId: clean(input.directedByUserId),
      directedByName,
      recordedByName: user.fullName || user.email,
      sourceType: payload.sourceType,
      dueDateKey: payload.dueDateKey
    }, { eventId: `DIRECTIVE_ORAL_RECORDED_${oralHistoryRef.id}` });

    return { id: ref.id, ...payload };
  },

  async updateDirective(current = {}, input = {}) {
    assertManager();
    const user = assertActiveUser();
    const id = clean(current.id);
    if (!id) throw new Error("Không xác định được nội dung chỉ đạo cần sửa.");
    const leadDepartmentId = upper(input.leadDepartmentId);
    if (!leadDepartmentId) throw new Error("Chưa chọn Phòng/Khu chủ trì.");
    const assignment = await resolveAssignment(input, leadDepartmentId);
    const supportDepartmentIds = uniqueUpper(input.supportDepartmentIds).filter(id2 => id2 !== leadDepartmentId);
    const visibleDepartmentIds = uniqueUpper([leadDepartmentId, ...supportDepartmentIds]);
    if (clean(current.assignedUserId) && upper(current.leadDepartmentId) !== leadDepartmentId) {
      throw new Error("Không thể đổi Phòng/Khu chủ trì sau khi đã có người thực hiện. Hãy tạo nội dung chỉ đạo mới nếu cần chuyển đơn vị.");
    }
    const patch = {
      sourceType: upper(input.sourceType || current.sourceType || "DIRECT"),
      meetingName: clean(input.meetingName),
      referenceText: clean(input.referenceText),
      directedDateKey: normalizeDateKey(input.directedDateKey),
      directedByUserId: clean(input.directedByUserId),
      directedByName: clean(input.directedByName),
      content: clean(input.content),
      leadDepartmentId,
      ...assignment,
      assignedUserId: clean(current.assignedUserId),
      assignedUserName: clean(current.assignedUserName),
      assignedUserPosition: clean(current.assignedUserPosition),
      supportDepartmentIds,
      visibleDepartmentIds,
      dueDateKey: normalizeDateKey(input.dueDateKey),
      priority: upper(input.priority || "NORMAL"),
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: user.uid,
      updatedByName: user.fullName || user.email
    };
    if (!patch.directedDateKey || !patch.directedByName || !patch.content) {
      throw new Error("Thông tin chỉ đạo chưa đầy đủ.");
    }
    const changed = [];
    const compare = [
      ["sourceType", "hình thức"], ["meetingName", "cuộc họp"], ["referenceText", "nguồn/văn bản"],
      ["directedDateKey", "ngày chỉ đạo"], ["directedByName", "người chỉ đạo"], ["content", "nội dung"],
      ["leadDepartmentId", "đơn vị chủ trì"], ["dueDateKey", "thời hạn"], ["priority", "mức độ"]
    ];
    compare.forEach(([key, label]) => { if (clean(current[key]) !== clean(patch[key])) changed.push(label); });
    if (JSON.stringify(uniqueUpper(current.supportDepartmentIds)) !== JSON.stringify(supportDepartmentIds)) changed.push("đơn vị phối hợp");

    const batch = FirebaseService.writeBatch(FirebaseService.db);
    batch.update(directiveRef(id), patch);
    batch.set(updateRef(), managerAuditPayload("DIRECTIVE_EDITED", id,
      changed.length ? `Đã chỉnh sửa: ${changed.join(", ")}.` : "Đã lưu lại nội dung chỉ đạo.",
      { changedFields: changed }
    ));
    await batch.commit();
    dispatchPushInBackground("DIRECTIVE_UPDATED", id, {
      changedFields: changed,
      previousVisibleDepartmentIds: uniqueUpper(current.visibleDepartmentIds),
      previousLeadUserId: clean(current.leadUserId),
      visibleDepartmentIds,
      leadDepartmentId,
      assignmentLevel: "DEPARTMENT",
      leadTeamId: "",
      leadUserId: ""
    });
  },

  async setLifecycle(current = {}, closed, reason = "") {
    assertManager();
    const user = assertActiveUser();
    const id = clean(current.id);
    if (!id) throw new Error("Không xác định được nội dung chỉ đạo.");
    const patch = closed ? {
      lifecycleStatus: "CLOSED",
      closeReason: clean(reason),
      closedDateKey: actionDateKey(),
      closedByUserId: user.uid,
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: user.uid,
      updatedByName: user.fullName || user.email
    } : {
      lifecycleStatus: "ACTIVE",
      closeReason: "",
      closedDateKey: "",
      closedByUserId: "",
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: user.uid,
      updatedByName: user.fullName || user.email
    };
    const batch = FirebaseService.writeBatch(FirebaseService.db);
    batch.update(directiveRef(id), patch);
    batch.set(updateRef(), managerAuditPayload(closed ? "DIRECTIVE_CLOSED" : "DIRECTIVE_REOPENED", id,
      closed ? `Đóng nội dung chỉ đạo.${clean(reason) ? ` Lý do: ${clean(reason)}` : ""}` : "Mở lại nội dung chỉ đạo để tiếp tục theo dõi."
    ));
    await batch.commit();
    dispatchPushInBackground(closed ? "DIRECTIVE_CLOSED" : "DIRECTIVE_REOPENED", id, { reason: clean(reason) });
  },

  async softDelete(current = {}, reason = "") {
    assertManager();
    const user = assertActiveUser();
    const id = clean(current.id);
    if (!id) throw new Error("Không xác định được nội dung chỉ đạo.");
    const deleteReason = clean(reason);
    if (!deleteReason) throw new Error("Cần nhập lý do xóa.");
    const dateKey = actionDateKey();
    const batch = FirebaseService.writeBatch(FirebaseService.db);
    batch.update(directiveRef(id), {
      isDeleted: true,
      deletedDateKey: dateKey,
      deletedReason: deleteReason,
      deletedByUserId: user.uid,
      deletedByName: user.fullName || user.email,
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: user.uid,
      updatedByName: user.fullName || user.email
    });
    batch.set(updateRef(), managerAuditPayload("DIRECTIVE_DELETED", id, `Xóa nội dung chỉ đạo khỏi danh sách sử dụng. Lý do: ${deleteReason}`));
    await batch.commit();
    dispatchPushInBackground("DIRECTIVE_DELETED", id, { reason: deleteReason });
  },

  async sendReminder(directive = {}, departmentId = "", note = "") {
    assertManager();
    const user = assertActiveUser();
    const id = clean(directive.id);
    const targetDepartmentId = upper(departmentId || directive.leadDepartmentId);
    const reminderNote = clean(note);
    const visible = uniqueUpper(directive.visibleDepartmentIds);
    if (!id || !targetDepartmentId || !visible.includes(targetDepartmentId)) {
      throw new Error("Không xác định được Phòng/Khu cần đôn đốc.");
    }
    if (!reminderNote) throw new Error("Cần nhập nội dung đôn đốc.");
    if (upper(directive.lifecycleStatus) === "CLOSED" || directive.isDeleted === true) {
      throw new Error("Nội dung chỉ đạo đã đóng hoặc đã xóa.");
    }
    const historyRef = updateRef();
    const dateKey = actionDateKey();
    let assignedUserId = "";
    try {
      const stateSnapshot = await FirebaseService.getDoc(stateRef(id, targetDepartmentId));
      if (stateSnapshot.exists()) assignedUserId = clean(stateSnapshot.data()?.assignedUserId);
    } catch (_) { /* Không có state vẫn được phép đôn đốc Phòng/Khu. */ }
    await FirebaseService.setDoc(historyRef, {
      directiveId: id,
      departmentId: targetDepartmentId,
      updateType: "REMINDER",
      status: "",
      progressSummary: "",
      resultSummary: "",
      evidenceLinks: [],
      note: reminderNote,
      actionDateKey: dateKey,
      createdByUserId: user.uid,
      createdByName: user.fullName || user.email,
      createdByRole: user.role,
      createdByDepartmentId: user.departmentId,
      createdAt: FirebaseService.serverTimestamp()
    });
    dispatchPushInBackground("DIRECTIVE_REMINDER", id, {
      updateId: historyRef.id,
      departmentId: targetDepartmentId,
      assignedUserId,
      reminderNote
    }, { eventId: `DIRECTIVE_REMINDER_${historyRef.id}` });
    return historyRef.id;
  },

  async acceptDirective(directive = {}, departmentId = "") {
    const user = assertActiveUser();
    const id = clean(directive.id);
    const targetDepartmentId = upper(departmentId || user.departmentId);
    if (!id || !targetDepartmentId) throw new Error("Không xác định được Phòng/Khu tiếp nhận.");
    if (upper(directive.lifecycleStatus) === "CLOSED" || directive.isDeleted === true) {
      throw new Error("Nội dung chỉ đạo đã đóng hoặc đã xóa, không thể tiếp nhận.");
    }
    if (!canUserAccept(directive, targetDepartmentId, user)) {
      throw new Error("Chỉ Trưởng/Phó Phòng/Khu (hoặc đầu mối TCHC được cấp quyền) mới được xác nhận tiếp nhận.");
    }

    /*
     * V1.11.0 HOTFIX:
     * Không transaction.get() acceptance/state khi hai document chưa tồn tại.
     * Rules đọc dựa trên resource.data nên BatchGetDocs vào document chưa tồn tại có thể bị 403.
     * Acceptance + state được tạo atomically bằng writeBatch; Rules dùng getAfter()/existsAfter() để khóa workflow.
     */
    const acceptRef = acceptanceRef(id, targetDepartmentId);
    const currentStateRef = stateRef(id, targetDepartmentId);
    const directAssignmentRef = upper(directive.assignmentLevel) === "PERSON" && clean(directive.leadUserId) ? updateRef() : null;
    const dateKey = actionDateKey();
    const batch = FirebaseService.writeBatch(FirebaseService.db);

    batch.set(acceptRef, {
      directiveId: id,
      departmentId: targetDepartmentId,
      updateType: "ACCEPTED",
      status: "ACCEPTED",
      progressSummary: "",
      resultSummary: "",
      evidenceLinks: [],
      note: "Đã xác nhận tiếp nhận nội dung chỉ đạo.",
      actionDateKey: dateKey,
      acceptedDateKey: dateKey,
      createdByUserId: user.uid,
      createdByName: user.fullName || user.email,
      createdByRole: user.role,
      createdByDepartmentId: user.departmentId,
      enteredOnBehalfOfDepartment: Permissions.canManageExecutiveDirectives(user) && targetDepartmentId !== upper(user.departmentId),
      createdAt: FirebaseService.serverTimestamp()
    });

    const directPerson = directAssignmentRef ? {
      assignedUserId: clean(directive.leadUserId),
      assignedUserName: clean(directive.leadUserName),
      assignedUserPosition: clean(directive.leadUserPosition),
      assignedTeamId: clean(directive.leadTeamId),
      assignedTeamName: clean(directive.leadTeamName),
      internalAssignmentStatus: "ASSIGNED",
      assignedDateKey: dateKey,
      assignedByUserId: user.uid,
      assignedByName: user.fullName || user.email,
      assignmentSource: "DIRECTOR_DIRECT",
      assignmentUpdateId: directAssignmentRef.id
    } : {
      assignedUserId: "",
      assignedUserName: "",
      assignedUserPosition: "",
      assignedTeamId: "",
      assignedTeamName: "",
      internalAssignmentStatus: "UNASSIGNED",
      assignedDateKey: "",
      assignedByUserId: "",
      assignedByName: "",
      assignmentSource: "",
      assignmentUpdateId: ""
    };

    batch.set(currentStateRef, {
      directiveId: id,
      departmentId: targetDepartmentId,
      status: "ACCEPTED",
      acceptedDateKey: dateKey,
      acceptedByUserId: user.uid,
      acceptedByName: user.fullName || user.email,
      ...directPerson,
      personAcceptedDateKey: "",
      personAcceptedByUserId: "",
      personAcceptedByName: "",
      personAcceptanceUpdateId: "",
      lastProgressUpdateId: "",
      startedDateKey: "",
      completedDateKey: "",
      updatedByUserId: user.uid,
      updatedAt: FirebaseService.serverTimestamp()
    });

    if (directAssignmentRef) {
      batch.update(directiveRef(id), {
        assignedUserId: clean(directive.leadUserId),
        assignedUserName: clean(directive.leadUserName),
        assignedUserPosition: clean(directive.leadUserPosition),
        assignedAt: FirebaseService.serverTimestamp(),
        assignedByUserId: user.uid,
        assignedByName: user.fullName || user.email,
        assignedUpdateId: directAssignmentRef.id,
        updatedAt: FirebaseService.serverTimestamp(),
        updatedByUserId: user.uid,
        updatedByName: user.fullName || user.email
      });
      batch.set(directAssignmentRef, {
        directiveId: id,
        departmentId: targetDepartmentId,
        updateType: "INTERNAL_ASSIGNED",
        status: "ACCEPTED",
        progressSummary: "",
        resultSummary: "",
        evidenceLinks: [],
        note: `Phòng/Khu tiếp nhận chỉ đạo đã được BGĐ giao trực tiếp cho ${clean(directive.leadUserName) || "người phụ trách"}.`,
        actionDateKey: dateKey,
        assignedUserId: clean(directive.leadUserId),
        assignedUserName: clean(directive.leadUserName),
        assignedUserPosition: clean(directive.leadUserPosition),
        assignedTeamId: clean(directive.leadTeamId),
        assignedTeamName: clean(directive.leadTeamName),
        assignmentSource: "DIRECTOR_DIRECT",
        createdByUserId: user.uid,
        createdByName: user.fullName || user.email,
        createdByRole: user.role,
        createdByDepartmentId: user.departmentId,
        createdAt: FirebaseService.serverTimestamp()
      });
    }

    await batch.commit();
    dispatchPushInBackground("DIRECTIVE_ACCEPTED", id, {
      updateId: acceptRef.id,
      departmentId: targetDepartmentId
    }, { eventId: `DIRECTIVE_ACCEPTED_${acceptRef.id}` });

    if (directAssignmentRef) {
      dispatchPushInBackground("DIRECTIVE_INTERNAL_ASSIGNED", id, {
        updateId: directAssignmentRef.id,
        departmentId: targetDepartmentId,
        assignedUserId: clean(directive.leadUserId),
        assignedUserName: clean(directive.leadUserName)
      }, { eventId: `DIRECTIVE_INTERNAL_ASSIGNED_${directAssignmentRef.id}` });
    }
    return acceptRef.id;
  },

  async assignInternal(directive = {}, departmentId = "", assigneeUserId = "") {
    const user = assertActiveUser();
    const id = clean(directive.id);
    const targetDepartmentId = upper(departmentId || user.departmentId);
    const targetUserId = clean(assigneeUserId);
    if (!id || !targetDepartmentId || !targetUserId) throw new Error("Chưa chọn người thực hiện.");
    if (upper(directive.lifecycleStatus) === "CLOSED" || directive.isDeleted === true) {
      throw new Error("Nội dung chỉ đạo đã đóng hoặc đã xóa, không thể phân công.");
    }
    if (!canUserAssignInternal(directive, targetDepartmentId, user)) {
      throw new Error("Chỉ Trưởng/Phó Phòng/Khu hoặc đầu mối quản trị Chỉ đạo điều hành mới được phân công nội bộ.");
    }

    const assigneeSnapshot = await FirebaseService.getDoc(FirebaseService.doc(FirebaseService.db, "users", targetUserId));
    if (!assigneeSnapshot.exists()) throw new Error("Không tìm thấy người thực hiện đã chọn.");
    const assignee = assigneeSnapshot.data() || {};
    if (assignee.active !== true) throw new Error("Người thực hiện đã ngừng hoạt động.");
    if (upper(assignee.departmentId) !== targetDepartmentId) throw new Error("Người thực hiện không thuộc Phòng/Khu này.");

    const acceptRef = acceptanceRef(id, targetDepartmentId);
    const currentStateRef = stateRef(id, targetDepartmentId);
    const historyRef = updateRef();
    const dateKey = actionDateKey();

    await FirebaseService.runTransaction(FirebaseService.db, async transaction => {
      const [acceptanceSnapshot, stateSnapshot] = await Promise.all([
        transaction.get(acceptRef),
        transaction.get(currentStateRef)
      ]);
      if (!acceptanceSnapshot.exists() || !stateSnapshot.exists()) {
        throw new Error("Phòng/Khu phải xác nhận tiếp nhận trước khi phân công người thực hiện.");
      }
      const existingState = stateSnapshot.data() || {};
      if (upper(existingState.status) !== "ACCEPTED") {
        throw new Error("Chỉ được phân công hoặc đổi người thực hiện trước khi bắt đầu thực hiện.");
      }

      const assignmentPayload = {
        assignedUserId: assigneeSnapshot.id,
        assignedUserName: clean(assignee.fullName) || clean(assignee.email) || assigneeSnapshot.id,
        assignedUserPosition: clean(assignee.position),
        assignedTeamId: clean(assignee.teamId),
        assignedTeamName: clean(assignee.teamName) || clean(assignee.teamId),
        internalAssignmentStatus: "ASSIGNED",
        assignedDateKey: dateKey,
        assignedByUserId: user.uid,
        assignedByName: user.fullName || user.email,
        assignmentSource: "DEPARTMENT_INTERNAL",
        assignmentUpdateId: historyRef.id,
        personAcceptedDateKey: "",
        personAcceptedByUserId: "",
        personAcceptedByName: "",
        personAcceptanceUpdateId: "",
        updatedByUserId: user.uid,
        updatedAt: FirebaseService.serverTimestamp()
      };

      transaction.set(historyRef, {
        directiveId: id,
        departmentId: targetDepartmentId,
        updateType: "INTERNAL_ASSIGNED",
        status: "ACCEPTED",
        progressSummary: "",
        resultSummary: "",
        evidenceLinks: [],
        note: `Phân công ${assignmentPayload.assignedUserName} thực hiện nội dung chỉ đạo.`,
        actionDateKey: dateKey,
        assignedUserId: assignmentPayload.assignedUserId,
        assignedUserName: assignmentPayload.assignedUserName,
        assignedUserPosition: assignmentPayload.assignedUserPosition,
        assignedTeamId: assignmentPayload.assignedTeamId,
        assignedTeamName: assignmentPayload.assignedTeamName,
        assignmentSource: assignmentPayload.assignmentSource,
        createdByUserId: user.uid,
        createdByName: user.fullName || user.email,
        createdByRole: user.role,
        createdByDepartmentId: user.departmentId,
        createdAt: FirebaseService.serverTimestamp()
      });
      transaction.set(currentStateRef, assignmentPayload, { merge: true });
      transaction.update(directiveRef(id), {
        assignedUserId: assignmentPayload.assignedUserId,
        assignedUserName: assignmentPayload.assignedUserName,
        assignedUserPosition: assignmentPayload.assignedUserPosition,
        assignedAt: FirebaseService.serverTimestamp(),
        assignedByUserId: user.uid,
        assignedByName: user.fullName || user.email,
        assignedUpdateId: historyRef.id,
        updatedAt: FirebaseService.serverTimestamp(),
        updatedByUserId: user.uid,
        updatedByName: user.fullName || user.email
      });
    });

    dispatchPushInBackground("DIRECTIVE_INTERNAL_ASSIGNED", id, {
      updateId: historyRef.id,
      departmentId: targetDepartmentId,
      assignedUserId: assigneeSnapshot.id,
      assignedUserName: clean(assignee.fullName) || clean(assignee.email)
    }, { eventId: `DIRECTIVE_INTERNAL_ASSIGNED_${historyRef.id}` });
    return historyRef.id;
  },

  async acceptPersonalAssignment(directive = {}, departmentId = "") {
    const user = assertActiveUser();
    const id = clean(directive.id);
    const targetDepartmentId = upper(departmentId || user.departmentId);
    if (!id || !targetDepartmentId) throw new Error("Không xác định được nội dung cần nhận việc.");
    if (upper(directive.lifecycleStatus) === "CLOSED" || directive.isDeleted === true) {
      throw new Error("Nội dung chỉ đạo đã đóng hoặc đã xóa, không thể nhận việc.");
    }

    const acceptRef = acceptanceRef(id, targetDepartmentId);
    const currentStateRef = stateRef(id, targetDepartmentId);
    const historyRef = updateRef();
    const dateKey = actionDateKey();
    let assignedUserName = user.fullName || user.email;

    await FirebaseService.runTransaction(FirebaseService.db, async transaction => {
      const [acceptanceSnapshot, stateSnapshot] = await Promise.all([
        transaction.get(acceptRef),
        transaction.get(currentStateRef)
      ]);
      if (!acceptanceSnapshot.exists() || !stateSnapshot.exists()) {
        throw new Error("Phòng/Khu chưa xác nhận tiếp nhận nội dung chỉ đạo.");
      }
      const existingState = stateSnapshot.data() || {};
      if (upper(existingState.status) !== "ACCEPTED") throw new Error("Nội dung đã bắt đầu thực hiện hoặc đã hoàn thành.");
      if (clean(existingState.assignedUserId) !== user.uid) {
        throw new Error("Nội dung này chưa được phân công cho tài khoản hiện tại.");
      }
      if (upper(existingState.internalAssignmentStatus) === "PERSON_ACCEPTED") return;
      assignedUserName = clean(existingState.assignedUserName) || assignedUserName;

      transaction.set(historyRef, {
        directiveId: id,
        departmentId: targetDepartmentId,
        updateType: "PERSON_ACCEPTED",
        status: "ACCEPTED",
        progressSummary: "",
        resultSummary: "",
        evidenceLinks: [],
        note: `${assignedUserName} đã xác nhận nhận việc.`,
        actionDateKey: dateKey,
        assignedUserId: user.uid,
        assignedUserName,
        assignmentUpdateId: clean(existingState.assignmentUpdateId),
        createdByUserId: user.uid,
        createdByName: user.fullName || user.email,
        createdByRole: user.role,
        createdByDepartmentId: user.departmentId,
        createdAt: FirebaseService.serverTimestamp()
      });
      transaction.set(currentStateRef, {
        internalAssignmentStatus: "PERSON_ACCEPTED",
        personAcceptedDateKey: dateKey,
        personAcceptedByUserId: user.uid,
        personAcceptedByName: user.fullName || user.email,
        personAcceptanceUpdateId: historyRef.id,
        updatedByUserId: user.uid,
        updatedAt: FirebaseService.serverTimestamp()
      }, { merge: true });
    });

    dispatchPushInBackground("DIRECTIVE_PERSON_ACCEPTED", id, {
      updateId: historyRef.id,
      departmentId: targetDepartmentId,
      assignedUserId: user.uid,
      assignedUserName
    }, { eventId: `DIRECTIVE_PERSON_ACCEPTED_${historyRef.id}` });
    return historyRef.id;
  },

  async addProgressUpdate(directive = {}, departmentId = "", input = {}) {
    const user = assertActiveUser();
    const id = clean(directive.id);
    const targetDepartmentId = upper(departmentId || user.departmentId);
    if (!id || !targetDepartmentId) throw new Error("Không xác định được Phòng/Khu cập nhật.");
    if (upper(directive.lifecycleStatus) === "CLOSED" || directive.isDeleted === true) {
      throw new Error("Nội dung chỉ đạo đã đóng hoặc đã xóa, không thể cập nhật thực hiện.");
    }
    if (!canUserProgress(directive, targetDepartmentId, user)) {
      throw new Error("Tài khoản không thuộc phạm vi được cập nhật nội dung này.");
    }

    const status = upper(input.status || "IN_PROGRESS");
    if (!["IN_PROGRESS", "COMPLETED", "PAUSED"].includes(status)) {
      throw new Error("Trạng thái cập nhật không hợp lệ.");
    }
    const resultSummary = clean(input.resultSummary);
    if (status === "COMPLETED" && !resultSummary) {
      throw new Error("Khi hoàn thành phải nhập kết quả thực hiện.");
    }

    const dateKey = actionDateKey();
    const historyRef = updateRef();
    const currentStateRef = stateRef(id, targetDepartmentId);
    const acceptRef = acceptanceRef(id, targetDepartmentId);

    await FirebaseService.runTransaction(FirebaseService.db, async transaction => {
      const [stateSnapshot, acceptanceSnapshot] = await Promise.all([
        transaction.get(currentStateRef),
        transaction.get(acceptRef)
      ]);
      if (!acceptanceSnapshot.exists() || !stateSnapshot.exists()) {
        throw new Error("Phòng/Khu phải xác nhận tiếp nhận trước khi cập nhật thực hiện.");
      }

      const existingState = stateSnapshot.data() || {};
      if (!clean(existingState.assignedUserId)) {
        throw new Error("Trưởng/Phó Phòng/Khu phải phân công một người thực hiện trước.");
      }
      if (upper(existingState.internalAssignmentStatus) !== "PERSON_ACCEPTED") {
        throw new Error("Người được phân công phải xác nhận nhận việc trước khi cập nhật thực hiện.");
      }
      if (clean(existingState.assignedUserId) !== user.uid) {
        throw new Error("Chỉ người đang được phân công thực hiện mới được cập nhật tiến độ.");
      }

      const previousStatus = upper(existingState.status || "ACCEPTED");
      if (!transitionAllowed(previousStatus, status)) {
        if (status === "COMPLETED" && previousStatus !== "IN_PROGRESS") {
          throw new Error("Phải chuyển sang Đang thực hiện trước khi cập nhật Hoàn thành.");
        }
        throw new Error(`Không thể chuyển trạng thái từ ${previousStatus || "chưa xác định"} sang ${status}.`);
      }

      const historyPayload = {
        directiveId: id,
        departmentId: targetDepartmentId,
        updateType: "PROGRESS",
        status,
        previousStatus,
        progressSummary: clean(input.progressSummary),
        resultSummary,
        evidenceLinks: (Array.isArray(input.evidenceLinks) ? input.evidenceLinks : []).map(clean).filter(Boolean).slice(0, 20),
        note: clean(input.note),
        actionDateKey: dateKey,
        completedDateKey: status === "COMPLETED" ? dateKey : "",
        assignedUserId: clean(existingState.assignedUserId),
        assignedUserName: clean(existingState.assignedUserName),
        createdByUserId: user.uid,
        createdByName: user.fullName || user.email,
        createdByRole: user.role,
        createdByDepartmentId: user.departmentId,
        enteredOnBehalfOfDepartment: Permissions.canManageExecutiveDirectives(user) && targetDepartmentId !== upper(user.departmentId),
        createdAt: FirebaseService.serverTimestamp()
      };

      const statePayload = {
        directiveId: id,
        departmentId: targetDepartmentId,
        status,
        acceptedDateKey: clean(existingState.acceptedDateKey) || clean(acceptanceSnapshot.data()?.acceptedDateKey) || dateKey,
        acceptedByUserId: clean(existingState.acceptedByUserId) || clean(acceptanceSnapshot.data()?.createdByUserId),
        startedDateKey: clean(existingState.startedDateKey) || (status === "IN_PROGRESS" ? dateKey : ""),
        completedDateKey: status === "COMPLETED" ? dateKey : "",
        lastProgressUpdateId: historyRef.id,
        updatedByUserId: user.uid,
        updatedAt: FirebaseService.serverTimestamp()
      };
      transaction.set(historyRef, historyPayload);
      transaction.set(currentStateRef, statePayload, { merge: true });
    });

    dispatchPushInBackground(status === "COMPLETED" ? "DIRECTIVE_COMPLETED" : "DIRECTIVE_PROGRESS_UPDATED", id, {
      updateId: historyRef.id,
      departmentId: targetDepartmentId,
      status
    }, { eventId: `DIRECTIVE_PROGRESS_${historyRef.id}` });
    return historyRef.id;
  },

  async saveWeeklyReport(report = {}) {
    const user = assertActiveUser();
    const weekStart = normalizeDateKey(report.weekStart);
    const weekEnd = normalizeDateKey(report.weekEnd);
    const departmentId = upper(report.departmentId || "ALL");
    if (!weekStart || !weekEnd) throw new Error("Khoảng tuần báo cáo không hợp lệ.");
    const centerScope = departmentId === "ALL";
    if (centerScope && !Permissions.canGenerateCenterExecutiveReports()) {
      throw new Error("Tài khoản không có quyền lưu báo cáo toàn Trung tâm.");
    }
    if (!centerScope && !Permissions.canGenerateCenterExecutiveReports() && !(upper(user.role) === "DEPARTMENT_LEADER" && upper(departmentId) === upper(user.departmentId))) {
      throw new Error("Chỉ Trưởng/Phó Phòng/Khu mới được lưu báo cáo của đơn vị.");
    }
    const ref = reportRef(weekStart, departmentId);
    await FirebaseService.setDoc(ref, {
      scopeType: centerScope ? "CENTER" : "DEPARTMENT",
      departmentId,
      weekStart,
      weekEnd,
      title: clean(report.title),
      summary: report.summary || {},
      sections: report.sections || {},
      generatedByUserId: user.uid,
      generatedByName: user.fullName || user.email,
      generatedByDepartmentId: user.departmentId,
      generatedAt: FirebaseService.serverTimestamp(),
      updatedAt: FirebaseService.serverTimestamp()
    }, { merge: true });
    return ref.id;
  },

  async loadWeeklyReport(weekStart, departmentId = "ALL") {
    const user = assertActiveUser();
    const target = upper(departmentId || "ALL");
    if (target === "ALL" && !Permissions.canGenerateCenterExecutiveReports()) return null;
    if (target !== "ALL" && !Permissions.canGenerateCenterExecutiveReports() && !(upper(user.role) === "DEPARTMENT_LEADER" && target === upper(user.departmentId))) return null;
    const snapshot = await FirebaseService.getDoc(reportRef(weekStart, target));
    return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
  }
});
