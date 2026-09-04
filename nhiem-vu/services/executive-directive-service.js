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
import { FirebaseService } from "../core/firebase-service.js?v=20260903.V1_22_5";
import { UserContext } from "../core/user-context.js?v=20260903.V1_22_5";
import { Permissions } from "../core/permissions.js?v=20260903.V1_22_5";
import { ExecutiveNotificationService } from "./executive-notification-service.js?v=20260903.V1_22_5";
import { PeriodReadService } from "./period-read-service.js?v=20260903.V1_22_5";
import { APP_VERSION } from "../core/app-version.js?v=20260903.V1_22_5";

const DIRECTIVES = "executiveDirectives";
const UPDATES = "executiveDirectiveUpdates";
const STATES = "executiveDirectiveStates";
const REPORTS = "executiveWeeklyReports";
const MAX_LIST = 2000;

const STANDARD_TASKS = "standardTasks";
const STANDARD_SEQUENCES = "standardTaskSequences";
const KPI_COEFFICIENTS = Object.freeze([1, 1.1, 1.2]);

function normalizedCode(value) {
  return upper(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/Đ/g, "D")
    .replace(/[^A-Z0-9_-]+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
}
function numericSuffix(value) {
  const match = /(\d+)$/.exec(normalizedCode(value));
  return match ? Number(match[1]) : 0;
}
function formatUnexpectedCode(departmentId, numberValue) {
  return `${normalizedCode(departmentId)}-DX${String(Math.max(1, Math.trunc(Number(numberValue || 1)))).padStart(2, "0")}`;
}
async function observedUnexpectedNumber(departmentId) {
  const snapshot = await FirebaseService.getDocs(
    FirebaseService.query(
      FirebaseService.collection(FirebaseService.db, STANDARD_TASKS),
      FirebaseService.where("departmentId", "==", upper(departmentId)),
      FirebaseService.limit(2000)
    )
  );
  return snapshot.docs.reduce((highest, docItem) => {
    const data = docItem.data() || {};
    const code = upper(data.code || docItem.id);
    if (!code.startsWith(`${upper(departmentId)}-DX`)) return highest;
    return Math.max(highest, numericSuffix(code));
  }, 0);
}
function validKpiCoefficient(value) {
  const numberValue = Number(value || 1);
  return KPI_COEFFICIENTS.find(item => Math.abs(item - numberValue) < 0.000001) || null;
}

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

function canReadOwnDirectiveDepartment(user = UserContext.getUser()) {
  return Permissions.isDepartmentHead(user)
    || Permissions.isDepartmentDeputy(user)
    || (Permissions.isTchcCoordinator(user) && upper(user?.departmentId) === "TCHC");
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


function executiveKpiAllowedActor(user = assertActiveUser()) {
  return Permissions.isDirector(user);
}
function assertExecutiveKpiActor(user = assertActiveUser()) {
  if (!executiveKpiAllowedActor(user)) {
    throw new Error("Chỉ Ban Giám đốc được quyết định đưa chỉ đạo vào KPI.");
  }
  return user;
}
function sequenceRef(departmentId) {
  return FirebaseService.doc(FirebaseService.db, STANDARD_SEQUENCES, upper(departmentId));
}
function standardTaskRef(code) {
  return FirebaseService.doc(FirebaseService.db, STANDARD_TASKS, clean(code));
}
function moneyRound(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}
function executiveKpiFields(input = {}, current = {}) {
  const enabled = input.kpiEnabled === true;
  const coefficient = validKpiCoefficient(input.kpiCoefficient ?? current.kpiCoefficient ?? 1) || 1;
  return {
    kpiEnabled: enabled,
    kpiCoefficient: coefficient,
    kpiMandatoryEvidence: clean(input.kpiMandatoryEvidence ?? current.kpiMandatoryEvidence),
    kpiConversionStatus: enabled ? clean(current.kpiStandardTaskId) ? "CONVERTED" : "PENDING" : "NOT_REQUESTED"
  };
}

export const ExecutiveDirectiveService = Object.freeze({
  async listDirectives(options = {}) {
    const user = assertActiveUser();
    const collectionRef = FirebaseService.collection(FirebaseService.db, DIRECTIVES);
    let q;
    if (Permissions.canViewAllExecutiveDirectives()) {
      q = FirebaseService.query(collectionRef, FirebaseService.limit(MAX_LIST));
    } else if (canReadOwnDirectiveDepartment(user)) {
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
      : (canReadOwnDirectiveDepartment(user))
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
    } else if (canReadOwnDirectiveDepartment(user)) {
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
      : (canReadOwnDirectiveDepartment(user))
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
    const dueDateKey = normalizeDateKey(input.dueDateKey);
    const kpi = executiveKpiFields(input);
    let period = null;
    if (kpi.kpiEnabled) {
      assertExecutiveKpiActor(user);
      if (!dueDateKey) throw new Error("Chỉ đạo đưa vào KPI phải có thời hạn hoàn thành cụ thể.");
      if (!kpi.kpiMandatoryEvidence) throw new Error("Chỉ đạo đưa vào KPI phải có Minh chứng bắt buộc.");
      period = await PeriodReadService.getActive();
      if (!period?.id) throw new Error("Chưa có kỳ KPI đang hoạt động để đưa chỉ đạo vào KPI.");
    }

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
      dueDateKey,
      priority: upper(input.priority || "NORMAL"),
      ...kpi,
      kpiPeriodId: kpi.kpiEnabled ? period.id : "",
      kpiStandardTaskId: "",
      kpiConvertedAt: null,
      kpiConvertedByUserId: "",
      lifecycleStatus: "ACTIVE",
      closeReason: "",
      closedDateKey: "",
      closedByUserId: "",
      isDeleted: false,
      deletedDateKey: "",
      deletedReason: "",
      ...(input.oralRelay === true ? {
        entryMode: "TCHC_ORAL_RELAY",
        oralCapture: true,
        recordedByUserId: user.uid,
        recordedByName: user.fullName || user.email,
        recordedByRole: user.role,
        recordedByDepartmentId: upper(user.departmentId),
        recordedAt: FirebaseService.serverTimestamp()
      } : {}),
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
    batch.set(updateRef(), managerAuditPayload(input.oralRelay === true ? "DIRECTIVE_ORAL_RELAYED" : "DIRECTIVE_CREATED", ref.id, input.oralRelay === true ? "Ghi nhận/chuyển tải chỉ đạo miệng của Ban Giám đốc đến Phòng/Khu thực hiện." : "Tạo nội dung chỉ đạo và giao Phòng/Khu thực hiện.", {
      snapshot: {
        directedDateKey, directedByName, leadDepartmentId,
        supportDepartmentIds, dueDateKey, priority: payload.priority,
        kpiEnabled: payload.kpiEnabled, kpiCoefficient: payload.kpiCoefficient
      }
    }));
    await batch.commit();

    let result = { id: ref.id, ...payload };
    if (kpi.kpiEnabled) result = await this.ensureKpiStandardTask(ref.id);

    dispatchPushInBackground("DIRECTIVE_ASSIGNED", ref.id, {
      leadDepartmentId, supportDepartmentIds, visibleDepartmentIds, directedByName, dueDateKey
    }, { eventId: `DIRECTIVE_CREATED_${ref.id}` });
    return result;
  },

  async createOralDirective(input = {}) {
    const user = assertActiveUser();
    const ownRecorder = Permissions.canRecordOralExecutiveDirective(user);
    const tchcRelay = Permissions.canRelayOralExecutiveDirective(user);
    if (!ownRecorder && !tchcRelay) {
      throw new Error("Bạn không có quyền ghi nhận chỉ đạo miệng của Ban Giám đốc.");
    }

    const ownDepartmentId = upper(user.departmentId);
    const requestedDepartmentId = upper(input.leadDepartmentId || ownDepartmentId);
    if (tchcRelay && requestedDepartmentId) {
      /* TCHC là đầu mối relay: kể cả giao cho chính TCHC vẫn giữ provenance và đơn vị nhận phải tiếp nhận theo workflow. */
      return this.createDirective({
        ...input,
        leadDepartmentId: requestedDepartmentId,
        supportDepartmentIds: [],
        assignmentLevel: "DEPARTMENT",
        kpiEnabled: false,
        oralRelay: true
      });
    }

    const leadDepartmentId = ownDepartmentId;
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
      note: "Trưởng/Phụ trách Phòng/Khu ghi nhận chỉ đạo miệng và đồng thời xác nhận tiếp nhận.",
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
    const supportDepartmentIds = uniqueUpper(input.supportDepartmentIds).filter(id2 => id2 !== leadDepartmentId);
    const visibleDepartmentIds = uniqueUpper([leadDepartmentId, ...supportDepartmentIds]);
    const linked = clean(current.kpiStandardTaskId);
    const requestedKpi = input.kpiEnabled === true;
    if (linked) {
      const lockedChanges = [
        upper(current.leadDepartmentId) !== leadDepartmentId,
        clean(current.dueDateKey) !== normalizeDateKey(input.dueDateKey),
        Number(current.kpiCoefficient || 1) !== Number(input.kpiCoefficient || current.kpiCoefficient || 1),
        clean(current.kpiMandatoryEvidence) !== clean(input.kpiMandatoryEvidence ?? current.kpiMandatoryEvidence)
      ];
      if (lockedChanges.some(Boolean) || requestedKpi === false) {
        throw new Error("Chỉ đạo đã hình thành KPI. Không thể âm thầm đổi đơn vị, thời hạn, hệ số, minh chứng hoặc hủy KPI; hãy dùng chức năng điều chỉnh/hủy có kiểm soát.");
      }
    }
    if (requestedKpi && !linked) assertExecutiveKpiActor(user);
    const dueDateKey = normalizeDateKey(input.dueDateKey);
    if (requestedKpi && !dueDateKey) throw new Error("Chỉ đạo đưa vào KPI phải có thời hạn hoàn thành cụ thể.");
    const kpi = executiveKpiFields(input, current);
    if (requestedKpi && !kpi.kpiMandatoryEvidence) throw new Error("Chỉ đạo đưa vào KPI phải có Minh chứng bắt buộc.");
    let periodId = clean(current.kpiPeriodId);
    if (requestedKpi && !periodId) {
      const period = await PeriodReadService.getActive();
      periodId = clean(period?.id);
      if (!periodId) throw new Error("Chưa có kỳ KPI đang hoạt động.");
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
      assignmentLevel: "DEPARTMENT",
      leadTeamId: "", leadTeamName: "", leadUserId: "", leadUserName: "", leadUserPosition: "",
      assignedUserId: clean(current.assignedUserId),
      assignedUserName: clean(current.assignedUserName),
      assignedUserPosition: clean(current.assignedUserPosition),
      supportDepartmentIds,
      visibleDepartmentIds,
      dueDateKey,
      priority: upper(input.priority || "NORMAL"),
      ...kpi,
      kpiPeriodId: requestedKpi ? periodId : "",
      kpiStandardTaskId: linked,
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: user.uid,
      updatedByName: user.fullName || user.email
    };
    if (!patch.directedDateKey || !patch.directedByName || !patch.content) throw new Error("Thông tin chỉ đạo chưa đầy đủ.");

    const batch = FirebaseService.writeBatch(FirebaseService.db);
    batch.update(directiveRef(id), patch);
    batch.set(updateRef(), managerAuditPayload("DIRECTIVE_EDITED", id, "Đã cập nhật nội dung chỉ đạo.", {
      kpiEnabled: patch.kpiEnabled
    }));
    await batch.commit();
    if (requestedKpi && !linked) return this.ensureKpiStandardTask(id);
    dispatchPushInBackground("DIRECTIVE_UPDATED", id, { visibleDepartmentIds, leadDepartmentId });
    return { ...current, ...patch };
  },

  async ensureKpiStandardTask(directiveId = "") {
    const user = assertExecutiveKpiActor(assertActiveUser());
    const id = clean(directiveId);
    if (!id) throw new Error("Không xác định được chỉ đạo cần đưa vào KPI.");
    const initial = await FirebaseService.getDoc(directiveRef(id));
    if (!initial.exists()) throw new Error("Nội dung chỉ đạo không còn tồn tại.");
    const directive = { id, ...initial.data() };
    if (directive.kpiEnabled !== true) throw new Error("Chỉ đạo chưa được đánh dấu Đưa vào đánh giá KPI.");
    if (clean(directive.kpiStandardTaskId)) {
      const linked = await FirebaseService.getDoc(standardTaskRef(directive.kpiStandardTaskId));
      if (linked.exists()) return { ...directive, kpiConversionStatus: "CONVERTED" };
      throw new Error("Chỉ đạo đang lưu mã KPI liên kết nhưng đầu việc tương ứng không tồn tại. Hãy dùng Quản trị sửa sai để rà soát; hệ thống không tự cấp mã mới nhằm tránh trùng mã.");
    }
    const departmentId = upper(directive.leadDepartmentId);
    const periodId = clean(directive.kpiPeriodId);
    const dueDateKey = normalizeDateKey(directive.dueDateKey);
    const coefficient = validKpiCoefficient(directive.kpiCoefficient);
    if (!departmentId || !periodId || !dueDateKey || !coefficient) throw new Error("Chỉ đạo KPI thiếu đơn vị, kỳ, thời hạn hoặc hệ số hợp lệ.");
    const observed = await observedUnexpectedNumber(departmentId);
    const dRef = directiveRef(id);
    const seqRef = sequenceRef(departmentId);
    let createdCode = "";

    await FirebaseService.runTransaction(FirebaseService.db, async transaction => {
      const dSnap = await transaction.get(dRef);
      if (!dSnap.exists()) throw new Error("Chỉ đạo không còn tồn tại.");
      const fresh = dSnap.data() || {};
      if (fresh.kpiEnabled !== true) throw new Error("Chỉ đạo đã hủy yêu cầu KPI.");
      if (clean(fresh.kpiStandardTaskId)) {
        createdCode = clean(fresh.kpiStandardTaskId);
        return;
      }
      const seqSnap = await transaction.get(seqRef);
      const seq = seqSnap.exists() ? (seqSnap.data() || {}) : {};
      const floor = Math.max(
        observed,
        Number(seq.unexpectedHighestExistingNumber || 0),
        Number(seq.unexpectedLastNumber || 0),
        Math.max(0, Number(seq.unexpectedNextAvailableNumber || 1) - 1)
      );
      let numberValue = floor + 1;
      let code = formatUnexpectedCode(departmentId, numberValue);
      let taskRef = standardTaskRef(code);
      let candidateSnapshot = await transaction.get(taskRef);
      let attempts = 0;
      while (candidateSnapshot.exists() && attempts < 50) {
        numberValue += 1;
        code = formatUnexpectedCode(departmentId, numberValue);
        taskRef = standardTaskRef(code);
        candidateSnapshot = await transaction.get(taskRef);
        attempts += 1;
      }
      if (candidateSnapshot.exists()) {
        throw new Error("Không tìm được mã KPI đột xuất còn trống trong phạm vi an toàn. Hãy kiểm tra chuỗi mã trước khi thử lại.");
      }
      createdCode = code;
      const maxScore = moneyRound(12 * coefficient);
      transaction.set(taskRef, {
        code,
        name: clean(fresh.content),
        departmentId,
        organizationId: "",
        scopeType: "DEPARTMENT",
        frequency: "Khi phát sinh",
        completionDeadline: "",
        deadlineRuleType: "ARISING",
        workType: "DOT_XUAT",
        outputRequirement: clean(fresh.content),
        mandatoryEvidence: clean(fresh.kpiMandatoryEvidence),
        trackingMode: "FINAL_OUTPUT",
        workItemType: "GENERIC",
        baseScore: 12,
        difficultyCoefficient: coefficient,
        maximumConvertedScore: maxScore,
        audienceType: "ALL_DEPARTMENT",
        isCoreTaskDefault: false,
        isManagementTask: false,
        quantityUnit: "",
        fixedDeadlineDateKey: dueDateKey,
        sourceType: "EXECUTIVE_DIRECTIVE",
        sourceDirectiveId: id,
        sourcePeriodId: periodId,
        kpiSource: "BGD",
        active: true,
        order: numberValue,
        sequenceNumber: numberValue,
        syncSource: "WEB_EXECUTIVE_DIRECTIVE",
        syncVersion: APP_VERSION,
        createdByUserId: user.uid,
        createdByName: user.fullName || user.email,
        createdAt: FirebaseService.serverTimestamp(),
        updatedByUserId: user.uid,
        updatedByName: user.fullName || user.email,
        updatedAt: FirebaseService.serverTimestamp()
      });
      transaction.set(seqRef, {
        departmentId,
        allocationMode: "MONOTONIC_NO_REUSE",
        unexpectedHighestExistingNumber: numberValue,
        unexpectedLastNumber: numberValue,
        unexpectedLastCode: code,
        unexpectedNextAvailableNumber: numberValue + 1,
        unexpectedNextAvailableCode: formatUnexpectedCode(departmentId, numberValue + 1),
        lastExecutiveDirectiveId: id,
        lastAllocationRunId: `EXEC_${id}`,
        syncSource: "WEB_EXECUTIVE_DIRECTIVE",
        syncVersion: APP_VERSION,
        updatedByUserId: user.uid,
        updatedByName: user.fullName || user.email,
        updatedAt: FirebaseService.serverTimestamp()
      }, { merge: true });
      transaction.update(dRef, {
        kpiStandardTaskId: code,
        kpiConversionStatus: "CONVERTED",
        kpiConvertedByUserId: user.uid,
        kpiConvertedAt: FirebaseService.serverTimestamp(),
        updatedByUserId: user.uid,
        updatedByName: user.fullName || user.email,
        updatedAt: FirebaseService.serverTimestamp()
      });
    });
    const freshSnap = await FirebaseService.getDoc(dRef);
    return { id, ...(freshSnap.data() || {}), kpiStandardTaskId: createdCode };
  },

  async cancelDirectiveKpi(current = {}) {
    const user = assertExecutiveKpiActor(assertActiveUser());
    const directiveId = clean(current.id);
    const code = clean(current.kpiStandardTaskId);
    if (!directiveId || !code) throw new Error("Chỉ đạo chưa có đầu việc KPI liên kết.");
    const registrationSnapshot = await FirebaseService.getDocs(FirebaseService.query(
      FirebaseService.collection(FirebaseService.db, "taskRegistrations"),
      FirebaseService.where("standardTaskId", "==", code),
      FirebaseService.limit(1)
    ));
    if (!registrationSnapshot.empty) {
      throw new Error("Đầu việc KPI đã có đăng ký. Không thể hủy âm thầm; hãy dùng Quản trị sửa sai có kiểm soát.");
    }
    const batch = FirebaseService.writeBatch(FirebaseService.db);
    batch.update(standardTaskRef(code), {
      active: false,
      updatedByUserId: user.uid,
      updatedByName: user.fullName || user.email,
      updatedAt: FirebaseService.serverTimestamp(),
      removalReason: "BGĐ hủy đưa chỉ đạo vào KPI trước khi phát sinh đăng ký."
    });
    batch.update(directiveRef(directiveId), {
      kpiEnabled: false,
      kpiConversionStatus: "CANCELLED",
      kpiCancelledAt: FirebaseService.serverTimestamp(),
      kpiCancelledByUserId: user.uid,
      updatedByUserId: user.uid,
      updatedByName: user.fullName || user.email,
      updatedAt: FirebaseService.serverTimestamp()
    });
    batch.set(updateRef(), managerAuditPayload("DIRECTIVE_KPI_CANCELLED", directiveId, `Hủy đưa chỉ đạo vào KPI trước khi phát sinh đăng ký. Đầu việc ${code} được gỡ mềm.`));
    await batch.commit();
    return true;
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
    if (!centerScope && !Permissions.canGenerateCenterExecutiveReports() && !(Permissions.canGenerateOwnExecutiveReports(user) && upper(departmentId) === upper(user.departmentId))) {
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
    if (target !== "ALL" && !Permissions.canGenerateCenterExecutiveReports() && !(Permissions.canGenerateOwnExecutiveReports(user) && target === upper(user.departmentId))) return null;
    const snapshot = await FirebaseService.getDoc(reportRef(weekStart, target));
    return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
  }
});
