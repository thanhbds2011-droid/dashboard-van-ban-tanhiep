/**
 * Phân hệ Chỉ đạo điều hành V1.10.7 - Push Reliability Hotfix.
 * Độc lập hoàn toàn với Nhiệm vụ/KPI.
 *
 * Collections:
 * - executiveDirectives
 * - executiveDirectiveUpdates (lịch sử append-only)
 * - executiveDirectiveStates (trạng thái hiện hành theo Phòng/Khu)
 * - executiveWeeklyReports
 */
import { FirebaseService } from "../core/firebase-service.js?v=20260810.V1_10_6";
import { UserContext } from "../core/user-context.js?v=20260810.V1_10_6";
import { Permissions } from "../core/permissions.js?v=20260810.V1_10_6";
import { ExecutiveNotificationService } from "./executive-notification-service.js?v=20260810.V1_10_6";

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
function normalizeTeamId(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d").replace(/Đ/g, "D")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
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
  if (Permissions.canManageExecutiveDirectives(user)) return true;
  return isDepartmentOperator(user, target);
}
function canUserProgress(directive, departmentId, user = assertActiveUser()) {
  const target = upper(departmentId);
  const visible = uniqueUpper(directive?.visibleDepartmentIds);
  if (!target || !visible.includes(target)) return false;
  if (Permissions.canManageExecutiveDirectives(user)) return true;
  if (isDepartmentOperator(user, target)) return true;
  return target === upper(directive?.leadDepartmentId)
    && upper(directive?.assignmentLevel) === "PERSON"
    && clean(directive?.leadUserId) === clean(user?.uid);
}
async function resolveAssignment(input, leadDepartmentId) {
  const leadTeamId = normalizeTeamId(input.leadTeamId);
  const leadUserId = clean(input.leadUserId);
  if (!leadTeamId && leadUserId) {
    throw new Error("Muốn giao cụ thể cá nhân phải chọn Tổ/Nhóm trước.");
  }
  if (!leadTeamId) {
    return {
      assignmentLevel: "DEPARTMENT",
      leadTeamId: "",
      leadTeamName: "",
      leadUserId: "",
      leadUserName: "",
      leadUserPosition: ""
    };
  }
  if (!leadUserId) throw new Error("Đã chọn Tổ/Nhóm thì phải chọn Người phụ trách chính.");
  const userSnapshot = await FirebaseService.getDoc(FirebaseService.doc(FirebaseService.db, "users", leadUserId));
  if (!userSnapshot.exists()) throw new Error("Không tìm thấy người phụ trách đã chọn.");
  const selected = userSnapshot.data() || {};
  if (selected.active !== true) throw new Error("Người phụ trách đã ngừng hoạt động.");
  if (upper(selected.departmentId) !== upper(leadDepartmentId)) {
    throw new Error("Người phụ trách không thuộc Phòng/Khu chủ trì đã chọn.");
  }
  if (normalizeTeamId(selected.teamId) !== leadTeamId) {
    throw new Error("Người phụ trách không thuộc Tổ/Nhóm đã chọn.");
  }
  return {
    assignmentLevel: "PERSON",
    // Lưu đúng teamId đang có trong users/{uid} để Firestore Rules đối chiếu chính xác.
    leadTeamId: clean(selected.teamId),
    leadTeamName: clean(input.leadTeamName) || leadTeamId,
    leadUserId: userSnapshot.id,
    leadUserName: clean(selected.fullName) || clean(selected.email) || userSnapshot.id,
    leadUserPosition: clean(selected.position)
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
async function notifyPushReliably(action, directiveId, eventData = {}, options = {}) {
  const normalizedAction = upper(action);
  const normalizedDirectiveId = clean(directiveId);
  const eventId = clean(options?.eventId);

  console.info("[EXEC PUSH] Bắt đầu gửi:", {
    action: normalizedAction,
    directiveId: normalizedDirectiveId,
    eventId
  });

  try {
    const result = await ExecutiveNotificationService.send(
      normalizedAction,
      normalizedDirectiveId,
      eventData,
      options
    );

    const status = upper(result?.status);
    if (["SENT", "SUBMITTED", "NO_SUBSCRIPTIONS"].includes(status)) {
      console.info("[EXEC PUSH] Kết quả:", {
        action: normalizedAction,
        directiveId: normalizedDirectiveId,
        eventId: clean(result?.eventId) || eventId,
        status,
        result
      });
    } else {
      console.warn("[EXEC PUSH] Thông báo chưa gửi thành công:", {
        action: normalizedAction,
        directiveId: normalizedDirectiveId,
        eventId: clean(result?.eventId) || eventId,
        status: status || "NO_RESULT",
        result
      });
    }

    return result || { ok: false, status: "NO_RESULT", eventId };
  } catch (error) {
    const message = error?.message || String(error);
    console.error("[EXEC PUSH] Không gửi được thông báo:", {
      action: normalizedAction,
      directiveId: normalizedDirectiveId,
      eventId,
      error: message
    });
    return { ok: false, status: "CLIENT_ERROR", eventId, error: message };
  }
}

export const ExecutiveDirectiveService = Object.freeze({
  async listDirectives(options = {}) {
    const user = assertActiveUser();
    const collectionRef = FirebaseService.collection(FirebaseService.db, DIRECTIVES);
    let q;
    if (Permissions.canViewAllExecutiveDirectives()) {
      q = FirebaseService.query(collectionRef, FirebaseService.limit(MAX_LIST));
    } else {
      if (!user.departmentId) return [];
      q = FirebaseService.query(
        collectionRef,
        FirebaseService.where("visibleDepartmentIds", "array-contains", user.departmentId),
        FirebaseService.limit(MAX_LIST)
      );
    }
    const items = mapSnapshot(await FirebaseService.getDocs(q));
    const includeDeleted = options.includeDeleted === true && Permissions.canManageExecutiveDirectives();
    return sortDirectives(items.filter(item => includeDeleted || item.isDeleted !== true));
  },

  subscribeDirectives(onNext, onError = console.warn) {
    const user = assertActiveUser();
    const collectionRef = FirebaseService.collection(FirebaseService.db, DIRECTIVES);
    const q = Permissions.canViewAllExecutiveDirectives()
      ? FirebaseService.query(collectionRef, FirebaseService.limit(MAX_LIST))
      : FirebaseService.query(
          collectionRef,
          FirebaseService.where("visibleDepartmentIds", "array-contains", user.departmentId),
          FirebaseService.limit(MAX_LIST)
        );
    return FirebaseService.onSnapshot(q, snapshot => {
      const items = sortDirectives(mapSnapshot(snapshot).filter(item => item.isDeleted !== true));
      onNext(items);
    }, onError);
  },

  async listUpdates() {
    const user = assertActiveUser();
    const collectionRef = FirebaseService.collection(FirebaseService.db, UPDATES);
    const q = Permissions.canViewAllExecutiveDirectives()
      ? FirebaseService.query(collectionRef, FirebaseService.limit(MAX_LIST))
      : FirebaseService.query(
          collectionRef,
          FirebaseService.where("departmentId", "==", user.departmentId),
          FirebaseService.limit(MAX_LIST)
        );
    return sortUpdates(mapSnapshot(await FirebaseService.getDocs(q)));
  },

  subscribeUpdates(onNext, onError = console.warn) {
    const user = assertActiveUser();
    const collectionRef = FirebaseService.collection(FirebaseService.db, UPDATES);
    const q = Permissions.canViewAllExecutiveDirectives()
      ? FirebaseService.query(collectionRef, FirebaseService.limit(MAX_LIST))
      : FirebaseService.query(
          collectionRef,
          FirebaseService.where("departmentId", "==", user.departmentId),
          FirebaseService.limit(MAX_LIST)
        );
    return FirebaseService.onSnapshot(q, snapshot => onNext(sortUpdates(mapSnapshot(snapshot))), onError);
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
    await notifyPushReliably("DIRECTIVE_ASSIGNED", ref.id, {
      leadDepartmentId,
      assignmentLevel: assignment.assignmentLevel,
      leadTeamId: assignment.leadTeamId,
      leadUserId: assignment.leadUserId,
      supportDepartmentIds,
      visibleDepartmentIds,
      directedByName,
      dueDateKey: payload.dueDateKey
    }, { eventId: `DIRECTIVE_CREATED_${ref.id}` });
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
      ["leadDepartmentId", "đơn vị chủ trì"], ["assignmentLevel", "cấp giao"], ["leadTeamId", "Tổ/Nhóm"],
      ["leadUserId", "người phụ trách chính"], ["dueDateKey", "thời hạn"], ["priority", "mức độ"]
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
    await notifyPushReliably("DIRECTIVE_UPDATED", id, {
      changedFields: changed,
      previousVisibleDepartmentIds: uniqueUpper(current.visibleDepartmentIds),
      previousLeadUserId: clean(current.leadUserId),
      visibleDepartmentIds,
      leadDepartmentId,
      assignmentLevel: assignment.assignmentLevel,
      leadTeamId: assignment.leadTeamId,
      leadUserId: assignment.leadUserId
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
    await notifyPushReliably(closed ? "DIRECTIVE_CLOSED" : "DIRECTIVE_REOPENED", id, { reason: clean(reason) });
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
    await notifyPushReliably("DIRECTIVE_DELETED", id, { reason: deleteReason });
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

    const acceptRef = acceptanceRef(id, targetDepartmentId);
    const currentStateRef = stateRef(id, targetDepartmentId);
    const dateKey = actionDateKey();
    await FirebaseService.runTransaction(FirebaseService.db, async transaction => {
      const [acceptSnapshot, stateSnapshot] = await Promise.all([
        transaction.get(acceptRef),
        transaction.get(currentStateRef)
      ]);
      if (acceptSnapshot.exists()) {
        if (!stateSnapshot.exists()) {
          transaction.set(currentStateRef, {
            directiveId: id,
            departmentId: targetDepartmentId,
            status: "ACCEPTED",
            acceptedDateKey: clean(acceptSnapshot.data()?.acceptedDateKey) || dateKey,
            acceptedByUserId: clean(acceptSnapshot.data()?.createdByUserId) || user.uid,
            startedDateKey: "",
            completedDateKey: "",
            updatedByUserId: user.uid,
            updatedAt: FirebaseService.serverTimestamp()
          });
        }
        return;
      }
      transaction.set(acceptRef, {
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
        enteredOnBehalfOfDepartment: Permissions.canManageExecutiveDirectives(user) && targetDepartmentId !== user.departmentId,
        createdAt: FirebaseService.serverTimestamp()
      });
      transaction.set(currentStateRef, {
        directiveId: id,
        departmentId: targetDepartmentId,
        status: "ACCEPTED",
        acceptedDateKey: dateKey,
        acceptedByUserId: user.uid,
        startedDateKey: "",
        completedDateKey: "",
        updatedByUserId: user.uid,
        updatedAt: FirebaseService.serverTimestamp()
      });
    });
    await notifyPushReliably("DIRECTIVE_ACCEPTED", id, {
      updateId: acceptRef.id,
      departmentId: targetDepartmentId
    }, { eventId: `DIRECTIVE_ACCEPTED_${acceptRef.id}` });
    return acceptRef.id;
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
      throw new Error("Tài khoản không phải người có quyền cập nhật thực hiện nội dung này.");
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
      if (!acceptanceSnapshot.exists()) {
        throw new Error("Phòng/Khu phải xác nhận tiếp nhận trước khi cập nhật thực hiện.");
      }

      let previousStatus = "ACCEPTED";
      const existingState = stateSnapshot.exists() ? (stateSnapshot.data() || {}) : null;
      if (existingState) previousStatus = upper(existingState.status || "ACCEPTED");
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
        createdByUserId: user.uid,
        createdByName: user.fullName || user.email,
        createdByRole: user.role,
        createdByDepartmentId: user.departmentId,
        enteredOnBehalfOfDepartment: Permissions.canManageExecutiveDirectives(user) && targetDepartmentId !== user.departmentId,
        createdAt: FirebaseService.serverTimestamp()
      };

      const statePayload = {
        directiveId: id,
        departmentId: targetDepartmentId,
        status,
        acceptedDateKey: clean(existingState?.acceptedDateKey) || clean(acceptanceSnapshot.data()?.acceptedDateKey) || dateKey,
        acceptedByUserId: clean(existingState?.acceptedByUserId) || clean(acceptanceSnapshot.data()?.createdByUserId),
        startedDateKey: clean(existingState?.startedDateKey) || (status === "IN_PROGRESS" ? dateKey : ""),
        completedDateKey: status === "COMPLETED" ? dateKey : "",
        updatedByUserId: user.uid,
        updatedAt: FirebaseService.serverTimestamp()
      };
      transaction.set(historyRef, historyPayload);
      transaction.set(currentStateRef, statePayload, { merge: true });
    });

    await notifyPushReliably(status === "COMPLETED" ? "DIRECTIVE_COMPLETED" : "DIRECTIVE_PROGRESS_UPDATED", id, {
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
    if (!centerScope && !Permissions.canGenerateCenterExecutiveReports() && departmentId !== user.departmentId) {
      throw new Error("Tài khoản chỉ được lưu báo cáo của Phòng/Khu mình.");
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
    if (target !== "ALL" && !Permissions.canGenerateCenterExecutiveReports() && target !== user.departmentId) return null;
    const snapshot = await FirebaseService.getDoc(reportRef(weekStart, target));
    return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
  }
});
