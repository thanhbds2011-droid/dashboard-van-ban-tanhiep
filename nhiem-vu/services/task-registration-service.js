import { FirebaseService } from "../core/firebase-service.js?v=20260902.V1_22_0";
import { UserContext } from "../core/user-context.js?v=20260902.V1_22_0";
import { Permissions } from "../core/permissions.js?v=20260902.V1_22_0";
import { TaskLogService } from "./task-log-service.js?v=20260902.V1_22_0";
import { StandardTaskReadService } from "./standard-task-read-service.js?v=20260902.V1_22_0";
import { PeriodReadService } from "./period-read-service.js?v=20260902.V1_22_0";
import { APP_VERSION } from "../core/app-version.js?v=20260902.V1_22_0";
import { deriveDeadlinePlan, deadlineDateFromKey, isDateKey, requiresManualDeadline, isEventDrivenFrequency, canonicalFrequency } from "../core/deadline-engine.js?v=20260902.V1_22_0";

const clean = value => String(value ?? "").trim();
const upper = value => clean(value).toUpperCase();
const lower = value => clean(value).toLowerCase();

const CDTN_ROLE_LABELS = Object.freeze({
  CDTN_BI_THU: "Bí thư Chi đoàn",
  CDTN_PHO_BI_THU: "Phó Bí thư Chi đoàn",
  CDTN_UY_VIEN_BCH: "Ủy viên BCH Chi đoàn",
  CDTN_DOAN_VIEN: "Đoàn viên"
});
const CDTN_ROLE_PRIORITY = Object.freeze([
  "CDTN_BI_THU", "CDTN_PHO_BI_THU", "CDTN_UY_VIEN_BCH", "CDTN_DOAN_VIEN"
]);

function cdtnRoleCode(member) {
  const roles = Array.isArray(member?.additionalRoles) ? member.additionalRoles.map(upper) : [];
  return upper(member?.cdtnRole) || CDTN_ROLE_PRIORITY.find(role => roles.includes(role)) || "";
}

function cdtnRoleLabel(member) {
  const code = cdtnRoleCode(member);
  return clean(member?.cdtnRoleLabel) || CDTN_ROLE_LABELS[code] || "Thành viên Chi đoàn";
}

function standardWorkType(value) {
  return upper(value) === "DOT_XUAT" ? "DOT_XUAT" : "THUONG_XUYEN";
}

function registrationDepartmentId(registration) {
  const organizationId = upper(registration?.organizationId);
  const standardDepartmentId = upper(registration?.standardTaskDepartmentId);
  const departmentId = upper(registration?.departmentId);
  const code = upper(registration?.standardTaskCode || registration?.standardTaskId);
  return organizationId === "CDTN" || standardDepartmentId === "CDTN" || departmentId === "CDTN" || code.startsWith("CDTN")
    ? "CDTN"
    : departmentId;
}

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

function registrationId(periodId, uid, standardTaskId, personalItemId = "") {
  const suffix = clean(personalItemId);
  return `${periodId}_${uid}_${standardTaskId}${suffix ? `_${suffix}` : ""}`.replace(/[^A-Za-z0-9_-]/g, "_");
}

function personalItemId(value = "") {
  const normalized = clean(value).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
  return normalized || "";
}

function directiveKpiStandardTask(item, periodId = "") {
  return upper(item?.sourceType) === "EXECUTIVE_DIRECTIVE"
    && clean(item?.sourceDirectiveId)
    && clean(item?.sourcePeriodId) === clean(periodId);
}

function taskLogRef() {
  return FirebaseService.doc(FirebaseService.collection(FirebaseService.db, "taskLogs"));
}

function kpiAuditRef() {
  return FirebaseService.doc(FirebaseService.collection(FirebaseService.db, "kpiAuditLogs"));
}

function registrationAuditPayload(action, registration, actor, detail = {}) {
  return {
    appVersion: APP_VERSION,
    periodId: clean(registration?.periodId),
    action,
    detail,
    scopeUserId: clean(registration?.userId),
    scopeDepartmentId: registrationDepartmentId(registration),
    performedByUserId: actor.uid,
    performedByName: actor.fullName || "",
    performedByRole: actor.role || "",
    performedAt: FirebaseService.serverTimestamp()
  };
}


async function activePeriod() {
  return PeriodReadService.getActive();
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
  const department = upper(departmentId);
  const isCdtn = department === "CDTN";
  if (isCdtn) {
    if (!Permissions.isCdtnMember(reviewer)) return false;
  } else if (department === "BGD") {
    if (!Permissions.isDirectorDeputy(reviewer)) return false;
  } else if (!Permissions.isDepartmentDeputy(reviewer)) {
    return false;
  }

  const today = dateKey(new Date());
  const documentId = isCdtn ? "CDTN_APPROVAL_ACTIVE" : `${department}_ACTIVE`;
  const snapshot = await FirebaseService.getDoc(
    FirebaseService.doc(FirebaseService.db, "approvalDelegations", documentId)
  );
  if (!snapshot.exists()) return false;
  const data = snapshot.data();
  return (
    data.active === true &&
    data.delegateUserId === reviewer.uid &&
    upper(data.departmentId || data.organizationId) === department &&
    delegationAllows(data, permissionName) &&
    (!data.startDate || data.startDate <= today) &&
    (!data.endDate || data.endDate >= today)
  );
}

function registrationOwnerProfile(registration) {
  const registrationDepartment = registrationDepartmentId(registration);
  return {
    uid: registration?.userId || "",
    active: true,
    role: registration?.userRole || "",
    position: registration?.userPosition || "",
    leaderLevel: registration?.userLeaderLevel || "",
    approvalAuthority: registration?.userApprovalAuthority || "",
    isDepartmentHead: registration?.userIsDepartmentHead === true,
    departmentId: registrationDepartment
  };
}

function registrationOwnerIsUnitAuthority(registration) {
  return Permissions.hasUnitApprovalAuthority(registrationOwnerProfile(registration));
}

function canApprove(registration, reviewer) {
  if (!reviewer || reviewer.active !== true || !registration || registration.status !== "PENDING") return false;

  const registrationDepartment = registrationDepartmentId(registration);
  if (registrationDepartment === "CDTN") {
    /* Chi đoàn là scope nghiệp vụ riêng: Bí thư duyệt trực tiếp; delegate được kiểm tra ở flow approveMany(). */
    return Permissions.isCdtnSecretary(reviewer);
  }
  const ownerProfile = registrationOwnerProfile(registration);
  const ownerIsAuthority = Permissions.hasUnitApprovalAuthority(ownerProfile);

  if (Permissions.isDirectorHead(reviewer)) {
    return registrationDepartment === "BGD" || ownerIsAuthority;
  }

  if (ownerIsAuthority) {
    /* Trưởng/Phụ trách (kể cả ADMIN + business HEAD) chỉ do BGĐ/phân công BGD duyệt. */
    return false;
  }

  if (Permissions.isDepartmentDeputy(ownerProfile)) {
    return Permissions.isDepartmentHead(reviewer) && upper(reviewer.departmentId) === registrationDepartment;
  }

  return Permissions.isDepartmentHead(reviewer) && upper(reviewer.departmentId) === registrationDepartment;
}

function emptyTaskField(value) {
  return value === null || value === undefined || clean(value) === "";
}

function selfRegisteredTask(task, registration = null) {
  if (!task) return false;
  const sourceType = upper(task.sourceType);
  const entryMode = upper(task.entryMode);
  const registrationId = clean(task.registrationId);
  const sourceMatches = entryMode === "SELF_REGISTERED_APPROVED"
    || (sourceType === "DANG_KY_KE_HOACH" && registrationId !== "");
  const registrationMatches = !registration
    || (registrationId !== "" && registrationId === clean(registration.id));
  return sourceMatches && registrationMatches;
}

function taskDocumentCancellable(task, user, registration = null) {
  if (!task || task.active === false || !user?.uid) return false;
  if (!selfRegisteredTask(task, registration)) return false;
  if (clean(task.ownerUserId) !== user.uid) return false;
  if (clean(task.selfRegisteredByUserId) && clean(task.selfRegisteredByUserId) !== user.uid) return false;

  const status = upper(task.status);
  const assignmentStatus = upper(task.assignmentStatus);
  const scoringStatus = upper(task.scoringStatus);
  const planApprovalStatus = upper(task.planApprovalStatus);

  return (
    Number(task.progress || 0) === 0 &&
    ["MOI_TIEP_NHAN", "CHO_PHAN_CONG", "DA_PHAN_CONG", "DANG_XU_LY"].includes(status) &&
    ["", "DA_PHAN_CONG", "DA_TIEP_NHAN"].includes(assignmentStatus) &&
    ["", "APPROVED"].includes(planApprovalStatus) &&
    emptyTaskField(task.completedAt) &&
    emptyTaskField(task.result) &&
    emptyTaskField(task.resultSummary) &&
    emptyTaskField(task.evidenceUrl) &&
    emptyTaskField(task.evidenceLink) &&
    emptyTaskField(task.evidenceText) &&
    emptyTaskField(task.evidenceFileName) &&
    emptyTaskField(task.evidenceStoragePath) &&
    emptyTaskField(task.pendingAdjustmentId) &&
    emptyTaskField(task.confirmedActualScore) &&
    task.scoreLocked !== true &&
    ["", "NOT_ASSESSED"].includes(scoringStatus) &&
    !["CONFIRMED", "REQUESTED"].includes(upper(task.noOccurrenceStatus))
  );
}

async function canCancelApprovedOwnRegistration(user, registration) {
  return Permissions.canCancelOwnApprovedRegistration(registration, user);
}

async function cancellationBlockers(task, registration, user) {
  const periodId = clean(task?.periodId || registration?.periodId);
  const departmentId = registrationDepartmentId(registration || task);
  const [workItemsSnapshot, evaluationsSnapshot, adjustmentsSnapshot, plan, activeEvaluationPeriod] = await Promise.all([
    FirebaseService.getDocs(
      FirebaseService.query(
        FirebaseService.collection(FirebaseService.db, "taskWorkItems"),
        FirebaseService.where("ownerUserId", "==", user.uid)
      )
    ),
    periodId
      ? FirebaseService.getDocs(
          FirebaseService.query(
            FirebaseService.collection(FirebaseService.db, "taskEvaluations"),
            FirebaseService.where("periodId", "==", periodId),
            FirebaseService.where("ownerUserId", "==", user.uid)
          )
        )
      : Promise.resolve({ docs: [] }),
    FirebaseService.getDocs(
      FirebaseService.query(
        FirebaseService.collection(FirebaseService.db, "kpiAdjustments"),
        FirebaseService.where("userId", "==", user.uid)
      )
    ),
    departmentPlan(periodId, departmentId),
    activePeriod()
  ]);

  const taskId = clean(task?.id || registration?.taskId);
  const hasWorkItems = workItemsSnapshot.docs.some(item => clean(item.data()?.taskId) === taskId);
  const hasEvaluation = evaluationsSnapshot.docs.some(item => clean(item.data()?.taskId) === taskId);
  const hasAdjustment = adjustmentsSnapshot.docs.some(item => clean(item.data()?.taskId) === taskId);
  const planLocked = plan?.locked === true;
  const periodClosed = !activeEvaluationPeriod || clean(activeEvaluationPeriod.id) !== periodId;

  return {
    hasWorkItems,
    hasEvaluation,
    hasAdjustment,
    planLocked,
    periodClosed,
    any: hasWorkItems || hasEvaluation || hasAdjustment || planLocked || periodClosed
  };
}

function cancellationBlockerMessage(blockers) {
  if (blockers?.periodClosed) return "Kỳ đánh giá không còn hoạt động hoặc đã được lưu trữ.";
  if (blockers?.planLocked) return "Kế hoạch KPI của đơn vị đã khóa.";
  if (blockers?.hasEvaluation) return "Nhiệm vụ đã phát sinh dữ liệu tự đánh giá hoặc đánh giá KPI.";
  if (blockers?.hasAdjustment) return "Nhiệm vụ đã phát sinh đề nghị điều chỉnh KPI.";
  if (blockers?.hasWorkItems) return "Nhiệm vụ đã phát sinh lượt công việc chi tiết.";
  return "Nhiệm vụ đã phát sinh dữ liệu nghiệp vụ nên không thể hủy tại đây.";
}

function cancellationTaskSnapshot(task) {
  const fields = [
    "active", "status", "assignmentStatus", "progress", "ownerUserId", "ownerName",
    "primaryDepartmentId", "periodId", "registrationId", "includedInA",
    "scoringEnabled", "scoringStatus", "result", "resultSummary", "evidenceUrl",
    "evidenceText", "evidenceFileName"
  ];
  return Object.fromEntries(fields.map(key => [key, task?.[key] ?? null]));
}

function periodStartKey(period) {
  return clean(period?.startDate || period?.startDateKey);
}

function periodEndKey(period) {
  return clean(period?.endDate || period?.endDateKey);
}

function validAudienceForDepartment(value, departmentId) {
  const audience = upper(value);
  return upper(departmentId) === "CDTN"
    ? ["CDTN_SECRETARY", "CDTN_EXECUTIVE", "CDTN_MEMBER"].includes(audience)
    : ["ALL_DEPARTMENT", "MANAGEMENT"].includes(audience);
}

function optionManualDeadline(options, registration) {
  const map = options?.manualDeadlines && typeof options.manualDeadlines === "object"
    ? options.manualDeadlines
    : {};
  const keys = [
    registration?.id,
    registration?.standardTaskId,
    registration?.standardTaskCode
  ].map(clean).filter(Boolean);
  for (const key of keys) {
    const value = clean(map[key]);
    if (value) return value;
  }
  return clean(options?.manualDeadlineDateKey);
}

async function periodForApproval(registration, options, context) {
  const periodId = clean(registration?.periodId);
  if (!periodId) throw new Error("Đăng ký chưa có mã kỳ KPI.");

  const supplied = options?.period;
  if (supplied && clean(supplied.id) === periodId && periodStartKey(supplied) && periodEndKey(supplied)) {
    return supplied;
  }

  if (context.periods.has(periodId)) return context.periods.get(periodId);

  const active = await PeriodReadService.getActive();
  if (active && clean(active.id) === periodId && periodStartKey(active) && periodEndKey(active)) {
    context.periods.set(periodId, active);
    return active;
  }

  const snapshot = await FirebaseService.getDoc(
    FirebaseService.doc(FirebaseService.db, "evaluationPeriods", periodId)
  );
  if (!snapshot.exists()) throw new Error(`Không tìm thấy kỳ KPI ${periodId} của đăng ký.`);
  const period = { id: snapshot.id, ...snapshot.data() };
  if (!periodStartKey(period) || !periodEndKey(period)) {
    throw new Error(`Kỳ KPI ${periodId} chưa có ngày bắt đầu/kết thúc hợp lệ.`);
  }
  context.periods.set(periodId, period);
  return period;
}

async function catalogForApproval(registration, context) {
  if (!context.catalog) {
    context.catalog = await StandardTaskReadService.list({ force: true });
  }
  const id = upper(registration?.standardTaskId);
  const code = upper(registration?.standardTaskCode);
  return context.catalog.find(item => (
    (id && upper(item.id) === id)
    || (code && upper(item.code || item.id) === code)
  )) || null;
}

function legacyManualDeadlineError(registration) {
  const code = registration?.standardTaskCode || registration?.standardTaskId || "đầu việc";
  const error = new Error(
    `Đăng ký cũ ${code} thuộc nhóm phải nhập Hạn hoàn thành cụ thể. ` +
    "Trưởng phòng hãy nhập hạn cụ thể để duyệt; hệ thống không tự lấy ngày cuối kỳ."
  );
  error.code = "LEGACY_MANUAL_DEADLINE_REQUIRED";
  error.registrationId = clean(registration?.id);
  error.standardTaskId = clean(registration?.standardTaskId);
  error.standardTaskCode = clean(registration?.standardTaskCode);
  return error;
}

async function hydrateRegistrationForApproval(registration, options = {}, context = null) {
  const ctx = context || { periods: new Map(), catalog: null };
  const period = await periodForApproval(registration, options, ctx);
  let recovered = false;
  const recoverySources = [];

  const result = {
    ...registration,
    periodStartDate: clean(registration?.periodStartDate) || periodStartKey(period),
    periodEndDate: clean(registration?.periodEndDate) || periodEndKey(period)
  };

  if (!clean(registration?.periodStartDate) || !clean(registration?.periodEndDate)) {
    recovered = true;
    recoverySources.push("EVALUATION_PERIOD");
  }

  const departmentId = registrationDepartmentId(result);
  const currentFrequency = clean(result.frequency);
  const needsCatalog = (
    !currentFrequency
    || (!requiresManualDeadline(currentFrequency) && !isEventDrivenFrequency(currentFrequency) && !clean(result.completionDeadline))
    || !validAudienceForDepartment(result.audienceType, departmentId)
    || !clean(result.standardTaskDepartmentId)
  );
  let catalog = null;
  if (needsCatalog) {
    catalog = await catalogForApproval(result, ctx);
    if (!catalog) {
      throw new Error(
        `Không tìm thấy đầu việc ${result.standardTaskCode || result.standardTaskId || ""} trong Danh mục công việc để phục hồi đăng ký cũ.`
      );
    }
  }

  if (!clean(result.frequency) && clean(catalog?.frequency)) {
    result.frequency = clean(catalog.frequency);
    recovered = true;
    recoverySources.push("STANDARD_TASK_FREQUENCY");
  }
  if (!clean(result.completionDeadline) && clean(catalog?.completionDeadline)) {
    result.completionDeadline = clean(catalog.completionDeadline);
    recovered = true;
    recoverySources.push("STANDARD_TASK_DEADLINE_RULE");
  }
  if (clean(result.frequency) && !requiresManualDeadline(result.frequency) && !isEventDrivenFrequency(result.frequency) && !clean(result.completionDeadline)) {
    throw new Error(
      `Đầu việc ${result.standardTaskCode || result.standardTaskId || ""} trong Danh mục công việc chưa có “Thời hạn hoàn thành”. ` +
      "Hãy cập nhật Google Sheet và đồng bộ standardTasks trước khi duyệt."
    );
  }
  if (!validAudienceForDepartment(result.audienceType, departmentId) && validAudienceForDepartment(catalog?.audienceType, departmentId)) {
    result.audienceType = clean(catalog.audienceType);
    recovered = true;
    recoverySources.push("STANDARD_TASK_AUDIENCE");
  }
  if (!clean(result.standardTaskDepartmentId) && clean(catalog?.departmentId)) {
    result.standardTaskDepartmentId = clean(catalog.departmentId);
    recovered = true;
    recoverySources.push("STANDARD_TASK_DEPARTMENT");
  }

  let manualDeadlineDateKey = clean(result.manualDeadlineDateKey);
  if (requiresManualDeadline(result.frequency)) {
    const supplied = optionManualDeadline(options, result);
    if (isDateKey(supplied)) {
      manualDeadlineDateKey = supplied;
      if (manualDeadlineDateKey !== clean(result.manualDeadlineDateKey)) {
        recovered = true;
        recoverySources.push("APPROVER_MANUAL_DEADLINE");
      }
    } else if (
      clean(result.deadlineMode) === "SINGLE_MANUAL"
      && isDateKey(result.deadlineDateKey)
    ) {
      manualDeadlineDateKey = clean(result.deadlineDateKey);
    } else {
      throw legacyManualDeadlineError(result);
    }
  }
  result.manualDeadlineDateKey = manualDeadlineDateKey;

  const canonicalFrequencyValue = canonicalFrequency(result.frequency);
  if (canonicalFrequencyValue && clean(result.frequency) !== canonicalFrequencyValue) {
    result.frequency = canonicalFrequencyValue;
    recovered = true;
    recoverySources.push("FREQUENCY_CANONICAL");
  }
  if (isEventDrivenFrequency(result.frequency) && String(result.trackingMode || "").toUpperCase() !== "ITEMIZED") {
    result.trackingMode = "ITEMIZED";
    recovered = true;
    recoverySources.push("EVENT_DRIVEN_TRACKING_MODE");
  }

  const plan = registrationDeadlinePlan(result);
  if (!clean(result.deadlineMode)) result.deadlineMode = plan.deadlineMode;
  if (!clean(result.deadlineDateKey)) result.deadlineDateKey = plan.deadlineDateKey;
  if (!Array.isArray(result.milestoneDateKeys)) result.milestoneDateKeys = plan.milestoneDateKeys;

  if (
    clean(registration?.deadlineMode) !== clean(result.deadlineMode)
    || clean(registration?.deadlineDateKey) !== clean(result.deadlineDateKey)
    || !Array.isArray(registration?.milestoneDateKeys)
  ) {
    recovered = true;
    recoverySources.push("DEADLINE_PLAN");
  }

  result._legacySnapshotRecovered = recovered;
  result._legacySnapshotRecoverySources = [...new Set(recoverySources)];
  return result;
}

function approvalSnapshotPatch(registration, reviewer) {
  const patch = {
    periodStartDate: clean(registration.periodStartDate),
    periodEndDate: clean(registration.periodEndDate),
    frequency: clean(registration.frequency),
    completionDeadline: clean(registration.completionDeadline),
    deadlineMode: clean(registration.deadlineMode),
    deadlineDateKey: clean(registration.deadlineDateKey),
    milestoneDateKeys: Array.isArray(registration.milestoneDateKeys) ? registration.milestoneDateKeys : [],
    manualDeadlineDateKey: clean(registration.manualDeadlineDateKey),
    audienceType: clean(registration.audienceType),
    standardTaskDepartmentId: clean(registration.standardTaskDepartmentId || registrationDepartmentId(registration)),
    trackingMode: clean(registration.trackingMode),
    workItemType: clean(registration.workItemType)
  };
  if (registration._legacySnapshotRecovered === true) {
    patch.legacySnapshotRecovered = true;
    patch.legacySnapshotRecoveredAt = FirebaseService.serverTimestamp();
    patch.legacySnapshotRecoveredByUserId = reviewer.uid;
    patch.legacySnapshotRecoveredByName = reviewer.fullName || "";
    patch.legacySnapshotRecoverySources = Array.isArray(registration._legacySnapshotRecoverySources)
      ? registration._legacySnapshotRecoverySources
      : [];
    patch.legacySnapshotSource = "PERIOD_AND_STANDARD_TASK";
  }
  return patch;
}

function registrationDeadlinePlan(registration) {
  const code = registration?.standardTaskCode || registration?.standardTaskId || "đầu việc";
  const periodStartDate = clean(registration?.periodStartDate);
  const periodEndDate = clean(registration?.periodEndDate);
  if (!periodStartDate || !periodEndDate) {
    throw new Error(`Đăng ký ${code} chưa có snapshot kỳ KPI để xác định deadline. Vui lòng đăng ký lại trên phiên bản hiện tại.`);
  }

  // Không tin tuyệt đối các field deadline do client gửi. Khi duyệt, hệ thống tính lại từ
  // snapshot frequency + completionDeadline + kỳ KPI + manualDeadlineDateKey đã lưu lúc đăng ký.
  const derived = deriveDeadlinePlan({
    frequency: registration?.frequency || "",
    completionDeadline: registration?.completionDeadline || "",
    periodStartDate,
    periodEndDate,
    manualDeadlineDateKey: clean(registration?.manualDeadlineDateKey),
    fixedDeadlineDateKey: clean(registration?.fixedDeadlineDateKey)
  });
  const storedDeadlineDateKey = clean(registration?.deadlineDateKey);
  const storedMode = clean(registration?.deadlineMode);
  const hasStoredMilestones = Array.isArray(registration?.milestoneDateKeys);
  const storedMilestones = hasStoredMilestones
    ? registration.milestoneDateKeys.map(clean)
    : [];
  if ((storedDeadlineDateKey && storedDeadlineDateKey !== derived.deadlineDateKey)
      || (storedMode && storedMode !== derived.mode)
      || (hasStoredMilestones && JSON.stringify(storedMilestones) !== JSON.stringify(derived.milestoneDateKeys))) {
    throw new Error(`Dữ liệu deadline của đăng ký ${code} không còn khớp snapshot nghiệp vụ. Vui lòng kiểm tra lại danh mục hoặc đăng ký.`);
  }

  if (derived.mode === "EVENT_DRIVEN") {
    return {
      deadlineDateKey: "",
      deadline: null,
      milestoneDateKeys: [],
      deadlineMode: "EVENT_DRIVEN",
      eventDriven: true
    };
  }

  const deadline = deadlineDateFromKey(derived.deadlineDateKey);
  if (!deadline) throw new Error(`Hạn hoàn thành của ${code} không hợp lệ.`);
  return {
    deadlineDateKey: derived.deadlineDateKey,
    deadline,
    milestoneDateKeys: derived.milestoneDateKeys,
    deadlineMode: derived.mode,
    eventDriven: false
  };
}

function milestoneDocumentId(taskId, dueDateKey) {
  return `${taskId}_${String(dueDateKey || "").replace(/[^0-9]/g, "")}`;
}

function milestoneLabel(dueDateKey, sequence) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean(dueDateKey));
  return match ? `Mốc ${Number(sequence || 0) + 1} · ${match[3]}/${match[2]}/${match[1]}` : `Mốc ${Number(sequence || 0) + 1}`;
}

function taskPayload(registration, reviewer, options = {}) {
  const code = upper(registration.standardTaskCode || registration.standardTaskId);
  if (!code) throw new Error("Đầu việc đăng ký chưa có mã danh mục hợp lệ.");
  const workType = standardWorkType(registration.workType);
  const audienceType = upper(registration.audienceType);
  const departmentId = registrationDepartmentId(registration);
  const allowedAudience = departmentId === "CDTN"
    ? ["CDTN_SECRETARY", "CDTN_EXECUTIVE", "CDTN_MEMBER"]
    : ["ALL_DEPARTMENT", "MANAGEMENT"];
  if (!allowedAudience.includes(audienceType)) {
    throw new Error(`Đăng ký ${code} chưa có “Đối tượng áp dụng” hợp lệ. Vui lòng cập nhật danh mục và đăng ký lại.`);
  }
  const isUnexpected = workType === "DOT_XUAT";
  const deadlinePlan = registrationDeadlinePlan(registration);
  const milestoneMode = deadlinePlan.eventDriven === true
    ? "EVENT_DRIVEN"
    : (deadlinePlan.recurringKind || (deadlinePlan.milestoneDateKeys.length ? "MONTHLY" : "NONE"));
  return {
    code,
    deadlinePlan,
    payload: {
      appVersion: APP_VERSION,
      active: true,
      taskCode: code,
      title: registration.title || registration.standardTaskName,
      description: registration.description || "",
      sourceType: "DANG_KY_KE_HOACH",
      sourceReference: registration.standardTaskCode || "",
      sourceDetail: isUnexpected ? "Đầu việc đột xuất trong danh mục được cá nhân đăng ký, phê duyệt và tính vào A." : "Đầu việc thường xuyên do cá nhân đăng ký và được phê duyệt.",
      standardTaskId: registration.standardTaskId || registration.standardTaskCode || "",
      registrationGroupId: clean(registration.registrationGroupId),
      personalizationMode: clean(registration.personalizationMode || "DIRECT") || "DIRECT",
      personalItemId: clean(registration.personalItemId),
      personalItemOrder: Number(registration.personalItemOrder || 1),
      sourceStandardTaskType: clean(registration.sourceType),
      sourceDirectiveId: clean(registration.sourceDirectiveId),
      sourcePeriodId: clean(registration.sourcePeriodId),
      fixedDeadlineDateKey: clean(registration.fixedDeadlineDateKey),
      deadlineCeilingDateKey: clean(registration.deadlineCeilingDateKey || registration.fixedDeadlineDateKey),
      sourceDate: FirebaseService.Timestamp.fromDate(new Date()),
      sourceDateKey: dateKey(new Date()),
      entryMode: "SELF_REGISTERED_APPROVED",
      selfRegistered: true,
      selfRegisteredByUserId: registration.userId,
      primaryDepartmentId: registrationDepartmentId(registration),
      homeDepartmentId: registration.homeDepartmentId || (registrationDepartmentId(registration) === "CDTN" ? "" : registrationDepartmentId(registration)),
      supportDepartmentIds: [],
      relatedDepartmentIds: [],
      visibleDepartmentIds: [registrationDepartmentId(registration)],
      ownerUserId: registration.userId,
      ownerName: registration.userName || "",
      ownerPosition: registration.userPosition || "",
      teamId: registration.teamId || "",
      visibleUserIds: [registration.userId],
      assignedByUserId: reviewer.uid,
      assignedByName: reviewer.fullName || "",
      assignedByPosition: reviewer.position || "",
      adjustmentApproverUserId: reviewer.uid,
      adjustmentApproverName: reviewer.fullName || "",
      assignedAt: FirebaseService.serverTimestamp(),
      assignmentStatus: "DA_PHAN_CONG",
      status: "MOI_TIEP_NHAN",
      progress: 0,
      priority: isUnexpected ? "DOT_XUAT" : "THUONG",
      deadline: deadlinePlan.eventDriven ? null : FirebaseService.Timestamp.fromDate(deadlinePlan.deadline),
      deadlineDateKey: deadlinePlan.deadlineDateKey,
      deadlineMode: deadlinePlan.deadlineMode,
      eventDrivenDeadline: deadlinePlan.eventDriven === true,
      frequency: canonicalFrequency(registration.frequency) || registration.frequency || "",
      completionDeadline: registration.completionDeadline || "",
      milestoneMode,
      milestoneCount: deadlinePlan.milestoneDateKeys.length,
      milestoneCompletedCount: 0,
      finalMilestoneId: "",
      standardTaskCode: registration.standardTaskCode || "",
      standardTaskName: registration.standardTaskName || "",
      registrationId: registration.id,
      workType,
      baseScore: Number(registration.baseScore || 0),
      difficultyCoefficient: Number(registration.difficultyCoefficient || 1),
      maximumConvertedScore: Number(registration.maximumConvertedScore || 0),
      mandatoryEvidence: registration.mandatoryEvidence || "",
      trackingMode: deadlinePlan.eventDriven === true
        ? "ITEMIZED"
        : (String(registration.trackingMode || "FINAL_OUTPUT").toUpperCase() === "ITEMIZED" ? "ITEMIZED" : "FINAL_OUTPUT"),
      workItemType: String(registration.workItemType || "GENERIC").toUpperCase(),
      quantityUnit: String(registration.quantityUnit || "").trim(),
      confirmer: reviewer.fullName || "",
      scoringVersion: "KPI_2026_V1_13",
      periodId: registration.periodId,
      periodName: registration.periodName || registration.periodId,
      planType: isUnexpected ? "DOT_XUAT" : "KE_HOACH",
      planApprovalStatus: "APPROVED",
      includedInA: true,
      isCoreTask: registration.isCoreTaskDefault === true,
      isManagementTask: registration.isManagementTask === true,
      audienceType,
      standardTaskDepartmentId: registration.standardTaskDepartmentId || registrationDepartmentId(registration),
      organizationId: registrationDepartmentId(registration) === "CDTN" ? "CDTN" : "",
      scoringEnabled: true,
      scoringStatus: "NOT_ASSESSED",
      // Các field legacy được giữ để dữ liệu cũ vẫn đọc được; UI V1.13.0 không còn yêu cầu nhập mới.
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
  const taskIds = [];
  let batch = FirebaseService.writeBatch(FirebaseService.db);
  let writeCount = 0;

  const commitCurrentBatch = async () => {
    if (!writeCount) return;
    await batch.commit();
    batch = FirebaseService.writeBatch(FirebaseService.db);
    writeCount = 0;
  };

  for (const registration of registrations) {
    const { code, payload, deadlinePlan } = taskPayload(registration, reviewer, options);
    const taskReference = FirebaseService.doc(FirebaseService.collection(FirebaseService.db, "tasks"));
    const registrationReference = FirebaseService.doc(FirebaseService.db, "taskRegistrations", registration.id);
    const milestoneIds = deadlinePlan.milestoneDateKeys.map(key => milestoneDocumentId(taskReference.id, key));
    const expectedWrites = 4 + milestoneIds.length; // task + registration + task log + KPI audit + milestones
    if (expectedWrites > 450) throw new Error("Nhiệm vụ có quá nhiều mốc để duyệt trong một giao dịch an toàn.");
    if (writeCount > 0 && writeCount + expectedWrites > 450) await commitCurrentBatch();

    if (milestoneIds.length) payload.finalMilestoneId = milestoneIds[milestoneIds.length - 1];
    batch.set(taskReference, payload);
    writeCount += 1;

    deadlinePlan.milestoneDateKeys.forEach((dueDateKey, index) => {
      const milestoneReference = FirebaseService.doc(FirebaseService.db, "taskMilestones", milestoneIds[index]);
      batch.set(milestoneReference, {
        appVersion: APP_VERSION,
        active: true,
        taskId: taskReference.id,
        taskCode: code,
        periodId: registration.periodId || "",
        departmentId: registrationDepartmentId(registration),
        homeDepartmentId: registration.homeDepartmentId || (registrationDepartmentId(registration) === "CDTN" ? "" : registrationDepartmentId(registration)),
        organizationId: registrationDepartmentId(registration) === "CDTN" ? "CDTN" : "",
        ownerUserId: registration.userId,
        ownerName: registration.userName || "",
        sequence: index + 1,
        previousMilestoneId: index > 0 ? milestoneIds[index - 1] : "",
        label: milestoneLabel(dueDateKey, index),
        dueDateKey,
        dueAt: FirebaseService.Timestamp.fromDate(deadlineDateFromKey(dueDateKey)),
        status: "PENDING",
        completedAt: null,
        completedByUserId: "",
        completedByName: "",
        evidenceType: "",
        evidenceUrl: "",
        evidenceLink: "",
        evidenceText: "",
        evidenceFileName: "",
        evidenceStoragePath: "",
        createdAt: FirebaseService.serverTimestamp(),
        createdByUserId: reviewer.uid,
        createdByName: reviewer.fullName || "",
        updatedAt: FirebaseService.serverTimestamp(),
        updatedByUserId: reviewer.uid,
        updatedByName: reviewer.fullName || ""
      });
      writeCount += 1;
    });

    batch.set(registrationReference, {
      ...approvalSnapshotPatch(registration, reviewer),
      status: "APPROVED",
      taskId: taskReference.id,
      taskCode: code,
      periodId: registration.periodId || "",
      approvedAt: FirebaseService.serverTimestamp(),
      approvedByUserId: reviewer.uid,
      approvedByName: reviewer.fullName || "",
      updatedAt: FirebaseService.serverTimestamp()
    }, { merge: true });
    writeCount += 1;

    batch.set(taskLogRef(), TaskLogService.buildTaskLog({
      taskId: taskReference.id,
      taskCode: code,
      periodId: registration.periodId || "",
      action: "TASK_REGISTRATION_APPROVED",
      after: { ...payload, createdAt: null, updatedAt: null, assignedAt: null },
      note: [
        milestoneIds.length
          ? `Duyệt ${registration.standardTaskCode || ""} của ${registration.userName || ""}; tạo ${milestoneIds.length} mốc định kỳ.`
          : (deadlinePlan.eventDriven === true
            ? `Duyệt ${registration.standardTaskCode || ""} của ${registration.userName || ""}; thời hạn sẽ được nhập riêng khi từng lượt công việc thực tế phát sinh.`
            : `Duyệt ${registration.standardTaskCode || ""} của ${registration.userName || ""}.`),
        registration._legacySnapshotRecovered === true
          ? "Đã phục hồi snapshot đăng ký cũ từ kỳ KPI và Danh mục công việc trước khi duyệt."
          : ""
      ].filter(Boolean).join(" ")
    }));
    writeCount += 1;

    batch.set(kpiAuditRef(), registrationAuditPayload(
      "TASK_REGISTRATION_APPROVED",
      registration,
      reviewer,
      { registrationId: registration.id, taskId: taskReference.id, taskCode: code, oldStatus: registration.status || "PENDING", newStatus: "APPROVED" }
    ));
    writeCount += 1;
    taskIds.push(taskReference.id);
  }

  await commitCurrentBatch();
  return taskIds;
}


function mapRegistrationSnapshot(snapshot) {
  return snapshot.docs
    .map(item => ({ id: item.id, ...item.data() }))
    .filter(item => item.active !== false);
}

export const TaskRegistrationService = Object.freeze({
  async getActivePeriod() {
    return activePeriod();
  },

  async getDepartmentPlan(periodId, departmentId = "") {
    const user = UserContext.requireUser();
    return departmentPlan(periodId, departmentId || user.departmentId);
  },

  async getWorkspacePlans(periodId) {
    const user = UserContext.requireUser();
    const departments = [upper(user.departmentId)];
    if (Permissions.isCdtnMember()) departments.push("CDTN");
    const entries = await Promise.all(departments.map(async departmentId => [
      departmentId,
      await departmentPlan(periodId, departmentId)
    ]));
    return Object.fromEntries(entries);
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


  subscribeForCurrentUser(periodId, onData, onError) {
    const user = UserContext.requireUser();
    if (!periodId) {
      onData?.([]);
      return () => {};
    }
    const reference = FirebaseService.query(
      FirebaseService.collection(FirebaseService.db, "taskRegistrations"),
      FirebaseService.where("periodId", "==", periodId),
      FirebaseService.where("userId", "==", user.uid)
    );
    return FirebaseService.onSnapshot(
      reference,
      snapshot => onData?.(mapRegistrationSnapshot(snapshot)),
      error => {
        console.error("Không thể theo dõi đăng ký kế hoạch theo thời gian thực:", error);
        onError?.(error);
      }
    );
  },

  subscribeDepartmentPlan(periodId, onData, onError) {
    const user = UserContext.requireUser();
    if (!periodId || !user.departmentId) {
      onData?.(null);
      return () => {};
    }
    const reference = FirebaseService.doc(
      FirebaseService.db,
      "kpiPlans",
      `${periodId}_${upper(user.departmentId)}`
    );
    return FirebaseService.onSnapshot(
      reference,
      snapshot => onData?.(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null),
      error => {
        console.error("Không thể theo dõi trạng thái kế hoạch theo thời gian thực:", error);
        onError?.(error);
      }
    );
  },

  async registerMany(items, period, options = {}) {
    const user = UserContext.requireUser();
    if (!Permissions.canRegisterStandardTasks()) throw new Error("Tài khoản không được đăng ký đầu việc chuẩn.");
    if (!period?.id) throw new Error("Chưa có kỳ đánh giá đang hoạt động.");
    if (!items?.length) throw new Error("Chưa chọn đầu việc để đăng ký.");

    const workspaceIds = [...new Set(items.map(item => StandardTaskReadService.workspaceId(item, user)))];
    const plans = Object.fromEntries(await Promise.all(workspaceIds.map(async departmentId => [
      departmentId,
      await departmentPlan(period.id, departmentId)
    ])));

    const blockedItem = items.find(item => {
      const workspaceId = StandardTaskReadService.workspaceId(item, user);
      return plans[workspaceId]?.locked === true && !directiveKpiStandardTask(item, period.id);
    });
    if (blockedItem) {
      const workspaceId = StandardTaskReadService.workspaceId(blockedItem, user);
      throw new Error(`Đăng ký kế hoạch của ${workspaceId === "CDTN" ? "Chi đoàn" : workspaceId} đã được khóa.`);
    }

    const batch = FirebaseService.writeBatch(FirebaseService.db);
    const registrations = [];
    const autoApproved = [];

    for (const item of items) {
      if (!StandardTaskReadService.canRegisterItem(item, user)) {
        throw new Error(`Vai trò hiện tại không thuộc đối tượng đăng ký đầu việc ${item.code || item.id || ""}.`);
      }

      const workspaceId = StandardTaskReadService.workspaceId(item, user);
      const workType = standardWorkType(item.workType);
      const autoApprove = workspaceId === "CDTN"
        ? Permissions.isCdtnSecretary()
        : (Permissions.isDepartmentHead(user) || (Permissions.isDirector() && workspaceId === "BGD"));
      const itemKey = String(item.id || item.code || "");
      const suppliedRows = Array.isArray(options?.personalItems?.[itemKey])
        ? options.personalItems[itemKey].filter(Boolean)
        : [];
      const legacyDetail = options?.personalDetails?.[itemKey] || null;
      const rows = suppliedRows.length
        ? suppliedRows
        : [{
            title: clean(legacyDetail?.title) || item.name || "",
            description: clean(legacyDetail?.description) || item.outputRequirement || "",
            frequency: item.frequency || "",
            completionDeadline: item.completionDeadline || "",
            manualDeadlineDateKey: clean(options?.manualDeadlines?.[itemKey]),
            fixedDeadlineDateKey: clean(item.fixedDeadlineDateKey),
            personalizationMode: "DIRECT",
            personalItemId: ""
          }];

      const groupMode = rows.length > 1 || rows.some(row => upper(row?.personalizationMode) === "GROUPED");
      const groupId = registrationId(period.id, user.uid, item.id || item.code);

      for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex] || {};
        const pItemId = groupMode
          ? personalItemId(row.personalItemId || `item${String(rowIndex + 1).padStart(2, "0")}`)
          : "";
        const id = registrationId(period.id, user.uid, item.id || item.code, pItemId);
        const frequency = canonicalFrequency(row.frequency || item.frequency) || row.frequency || item.frequency || "";
        const completionDeadline = clean(row.completionDeadline !== undefined ? row.completionDeadline : item.completionDeadline);
        const manualDeadlineDateKey = clean(row.manualDeadlineDateKey);
        const inheritedFixedDeadline = clean(item.fixedDeadlineDateKey);
        const requestedFixedDeadline = clean(row.fixedDeadlineDateKey);
        const fixedDeadlineDateKey = groupMode
          ? requestedFixedDeadline
          : (inheritedFixedDeadline || requestedFixedDeadline);

        if (inheritedFixedDeadline && requestedFixedDeadline && requestedFixedDeadline > inheritedFixedDeadline) {
          throw new Error(`Hạn hoàn thành của “${clean(row.title) || item.name || item.code}” không được vượt quá hạn Ban Giám đốc giao.`);
        }

        const effectivePeriodEndDate = inheritedFixedDeadline && inheritedFixedDeadline < clean(period.endDate)
          ? inheritedFixedDeadline
          : period.endDate;
        const deadlinePlan = deriveDeadlinePlan({
          frequency,
          completionDeadline,
          periodStartDate: period.startDate,
          periodEndDate: effectivePeriodEndDate,
          manualDeadlineDateKey,
          fixedDeadlineDateKey
        });

        const registration = {
          id,
          periodId: period.id,
          periodName: period.name || period.id,
          periodStartDate: period.startDate || "",
          periodEndDate: period.endDate || "",
          frequency,
          completionDeadline: deadlinePlan.mode === "EVENT_DRIVEN" ? "" : deadlinePlan.completionDeadline,
          deadlineMode: deadlinePlan.mode,
          deadlineDateKey: deadlinePlan.deadlineDateKey,
          milestoneDateKeys: deadlinePlan.milestoneDateKeys,
          manualDeadlineDateKey: manualDeadlineDateKey || "",
          fixedDeadlineDateKey: fixedDeadlineDateKey || "",
          deadlineCeilingDateKey: inheritedFixedDeadline || "",
          registrationGroupId: groupId,
          personalizationMode: groupMode ? "GROUPED" : "DIRECT",
          personalItemId: pItemId,
          personalItemOrder: rowIndex + 1,
          standardTaskId: item.id || item.code,
          standardTaskCode: item.code || item.id,
          standardTaskName: item.name || "",
          standardTaskDepartmentId: item.departmentId || workspaceId,
          audienceType: clean(item.audienceType),
          isCoreTaskDefault: item.isCoreTaskDefault === true,
          isManagementTask: item.isManagementTask === true,
          title: clean(row.title) || item.name || "",
          description: clean(row.description) || item.outputRequirement || "",
          departmentId: workspaceId,
          homeDepartmentId: user.departmentId || "",
          organizationId: workspaceId === "CDTN" ? "CDTN" : "",
          teamId: user.teamId || "",
          userId: user.uid,
          userName: user.fullName || "",
          userPosition: user.position || "",
          userRole: user.role || "",
          userLeaderLevel: user.leaderLevel || "",
          userApprovalAuthority: user.approvalAuthority || "",
          userIsDepartmentHead: user.isDepartmentHead === true,
          userAdditionalRoles: Array.isArray(user.additionalRoles) ? user.additionalRoles : [],
          workType,
          planType: workType === "DOT_XUAT" ? "DOT_XUAT" : "KE_HOACH",
          includedInA: true,
          baseScore: Number(item.baseScore || 0),
          difficultyCoefficient: Number(item.difficultyCoefficient || 1),
          maximumConvertedScore: Number(item.maximumConvertedScore || item.baseScore || 0),
          mandatoryEvidence: item.mandatoryEvidence || "",
          trackingMode: deadlinePlan.mode === "EVENT_DRIVEN"
            ? "ITEMIZED"
            : (String(item.trackingMode || "FINAL_OUTPUT").toUpperCase() === "ITEMIZED" ? "ITEMIZED" : "FINAL_OUTPUT"),
          workItemType: String(item.workItemType || "GENERIC").toUpperCase(),
          quantityUnit: String(item.quantityUnit || "").trim(),
          sourceType: clean(item.sourceType),
          sourceDirectiveId: clean(item.sourceDirectiveId),
          sourcePeriodId: clean(item.sourcePeriodId),
          kpiSource: clean(item.kpiSource),
          status: "PENDING",
          taskId: null,
          active: true,
          autoApproved: autoApprove,
          registeredAt: FirebaseService.serverTimestamp(),
          createdAt: FirebaseService.serverTimestamp(),
          createdByUserId: user.uid,
          updatedAt: FirebaseService.serverTimestamp()
        };
        batch.set(FirebaseService.doc(FirebaseService.db, "taskRegistrations", id), registration, { merge: false });
        registrations.push(registration);
        if (autoApprove) autoApproved.push(registration);
      }
    }

    await batch.commit();
    if (autoApproved.length) await createApprovedTasks(autoApproved, user);
    return {
      total: registrations.length,
      autoApproved: autoApproved.length,
      pending: registrations.length - autoApproved.length
    };
  },

  async getCdtnApprovalDelegation() {
    if (!Permissions.isCdtnMember()) return null;
    const snapshot = await FirebaseService.getDoc(
      FirebaseService.doc(FirebaseService.db, "approvalDelegations", "CDTN_APPROVAL_ACTIVE")
    );
    return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
  },

  async listCdtnApprovalCandidates() {
    if (!Permissions.canDelegateCdtnApproval()) return [];
    const roles = ["CDTN_PHO_BI_THU", "CDTN_UY_VIEN_BCH"];
    const snapshot = await FirebaseService.getDocs(
      FirebaseService.query(
        FirebaseService.collection(FirebaseService.db, "cdtnMembers"),
        FirebaseService.where("active", "==", true),
        FirebaseService.limit(300)
      )
    );
    const candidates = snapshot.docs
      .map(item => ({ id: item.id, ...item.data() }))
      .filter(item => item.id !== UserContext.requireUser().uid)
      .filter(item => Array.isArray(item.additionalRoles) && item.additionalRoles.some(role => roles.includes(upper(role))))
      .sort((a, b) => clean(a.fullName).localeCompare(clean(b.fullName), "vi"));

    if (!candidates.length) {
      throw new Error("Chưa tìm thấy Phó Bí thư hoặc Ủy viên BCH Chi đoàn đang hoạt động để nhận ủy quyền. Hãy kiểm tra lại vai trò kiêm nhiệm trong danh mục nhân sự.");
    }
    return candidates;
  },

  async saveCdtnApprovalDelegation({ delegateUserId, startDate, endDate, reason }) {
    const user = UserContext.requireUser();
    if (!Permissions.canDelegateCdtnApproval()) throw new Error("Chỉ Bí thư Chi đoàn được ủy quyền cho Phó Bí thư hoặc Ủy viên BCH.");
    const candidates = await this.listCdtnApprovalCandidates();
    const delegate = candidates.find(item => item.id === delegateUserId);
    if (!delegate) throw new Error("Người được chọn không đủ điều kiện nhận ủy quyền Chi đoàn.");
    if (!startDate || !endDate || startDate > endDate) throw new Error("Thời gian ủy quyền chưa hợp lệ.");
    if (!clean(reason)) throw new Error("Hãy nhập lý do ủy quyền.");
    const reference = FirebaseService.doc(FirebaseService.db, "approvalDelegations", "CDTN_APPROVAL_ACTIVE");
    const existing = await FirebaseService.getDoc(reference);
    await FirebaseService.setDoc(reference, {
      appVersion: APP_VERSION,
      schemaVersion: 2,
      delegationType: "CDTN_APPROVAL",
      departmentId: "CDTN",
      organizationId: "CDTN",
      delegatorUserId: user.uid,
      delegatorName: user.fullName || "",
      delegateUserId: delegate.id,
      delegateName: delegate.fullName || "",
      delegatePosition: cdtnRoleLabel(delegate),
      delegateCdtnRole: cdtnRoleCode(delegate),
      delegateCdtnRoleLabel: cdtnRoleLabel(delegate),
      permissions: ["APPROVE_REGISTRATIONS", "CONFIRM_EVALUATIONS"],
      startDate,
      endDate,
      startAt: FirebaseService.Timestamp.fromDate(dateAtStart(startDate)),
      endAt: FirebaseService.Timestamp.fromDate(dateAtEnd(endDate)),
      reason: clean(reason),
      active: true,
      createdAt: existing.exists() ? (existing.data().createdAt || FirebaseService.serverTimestamp()) : FirebaseService.serverTimestamp(),
      createdBy: existing.exists() ? (existing.data().createdBy || user.uid) : user.uid,
      updatedAt: FirebaseService.serverTimestamp(),
      updatedBy: user.uid
    }, { merge: true });
  },

  async revokeCdtnApprovalDelegation() {
    const user = UserContext.requireUser();
    if (!Permissions.canDelegateCdtnApproval()) throw new Error("Chỉ Bí thư Chi đoàn được hủy ủy quyền.");
    await FirebaseService.updateDoc(
      FirebaseService.doc(FirebaseService.db, "approvalDelegations", "CDTN_APPROVAL_ACTIVE"),
      {
        active: false,
        revokedAt: FirebaseService.serverTimestamp(),
        revokedByUserId: user.uid,
        revokedByName: user.fullName || "",
        updatedAt: FirebaseService.serverTimestamp(),
        updatedBy: user.uid
      }
    );
  },

  async approveMany(registrations, options = {}) {
    const reviewer = UserContext.requireUser();
    const selected = (registrations || []).filter(item => item?.status === "PENDING");
    if (!selected.length) throw new Error("Chưa chọn đầu việc để duyệt.");

    const context = { periods: new Map(), catalog: null };
    const prepared = [];
    for (const item of selected) {
      const delegated = await hasDelegation(reviewer, registrationDepartmentId(item), "APPROVE_REGISTRATIONS");
      const registrationDepartment = registrationDepartmentId(item);
      const directorDelegated = (registrationDepartment === "BGD" || registrationOwnerIsUnitAuthority(item))
        ? await hasDelegation(reviewer, "BGD", "APPROVE_REGISTRATIONS")
        : false;
      const directAuthority = canApprove(item, reviewer);
      if (!directAuthority && (!(delegated || directorDelegated) || item.userId === reviewer.uid)) {
        throw new Error(`Bạn không có quyền duyệt đăng ký của ${item.userName || "người dùng"}.`);
      }
      prepared.push(await hydrateRegistrationForApproval(item, options, context));
    }
    return createApprovedTasks(prepared, reviewer, options);
  },

  async rejectMany(registrations, reason) {
    const reviewer = UserContext.requireUser();
    const rejectionReason = clean(reason);
    const selected = (registrations || []).filter(item => item?.status === "PENDING");
    if (!selected.length) throw new Error("Không có đăng ký để không duyệt.");
    if (!rejectionReason) throw new Error("Hãy nhập lý do không duyệt đầu việc.");

    for (const item of selected) {
      const delegated = await hasDelegation(reviewer, registrationDepartmentId(item), "APPROVE_REGISTRATIONS");
      const registrationDepartment = registrationDepartmentId(item);
      const directorDelegated = (registrationDepartment === "BGD" || registrationOwnerIsUnitAuthority(item))
        ? await hasDelegation(reviewer, "BGD", "APPROVE_REGISTRATIONS")
        : false;
      const directAuthority = canApprove(item, reviewer);
      if (!directAuthority && (!(delegated || directorDelegated) || item.userId === reviewer.uid)) {
        throw new Error("Bạn không có quyền không duyệt đăng ký này.");
      }
    }

    const batch = FirebaseService.writeBatch(FirebaseService.db);
    for (const item of selected) {
      batch.update(FirebaseService.doc(FirebaseService.db, "taskRegistrations", item.id), {
        status: "REJECTED",
        rejectionReason,
        rejectedAt: FirebaseService.serverTimestamp(),
        rejectedByUserId: reviewer.uid,
        rejectedByName: reviewer.fullName || "",
        updatedAt: FirebaseService.serverTimestamp()
      });
      batch.set(kpiAuditRef(), registrationAuditPayload(
        "TASK_REGISTRATION_REJECTED",
        item,
        reviewer,
        { registrationId: item.id, oldStatus: "PENDING", newStatus: "REJECTED", reason: rejectionReason }
      ));
    }
    await batch.commit();
    return selected.length;
  },

  async resubmitRegistration(registration, changes = {}) {
    const user = UserContext.requireUser();
    if (!registration?.id) throw new Error("Không tìm thấy đăng ký cần gửi lại.");
    const plan = await departmentPlan(registration.periodId, registration.departmentId);
    const directiveException = upper(registration.sourceType) === "EXECUTIVE_DIRECTIVE"
      && clean(registration.sourcePeriodId) === clean(registration.periodId);
    if (!Permissions.canResubmitOwnRegistration(registration, plan?.locked === true) && !(directiveException && registration.userId === user.uid)) {
      throw new Error(plan?.locked === true
        ? "Kế hoạch đã khóa nên chưa thể đăng ký lại đầu việc này."
        : "Chỉ người đăng ký mới được gửi lại đầu việc đã không duyệt.");
    }

    const title = clean(changes.title ?? registration.title);
    const description = clean(changes.description ?? registration.description);
    const frequency = canonicalFrequency(changes.frequency ?? registration.frequency) || clean(changes.frequency ?? registration.frequency);
    const completionDeadline = clean(changes.completionDeadline ?? registration.completionDeadline);
    const manualDeadlineDateKey = clean(changes.manualDeadlineDateKey ?? registration.manualDeadlineDateKey);
    const deadlineCeilingDateKey = clean(registration.deadlineCeilingDateKey);
    const requestedFixedDeadlineDateKey = clean(changes.fixedDeadlineDateKey ?? registration.fixedDeadlineDateKey);
    const fixedDeadlineDateKey = upper(registration.personalizationMode) === "DIRECT" && deadlineCeilingDateKey
      ? deadlineCeilingDateKey
      : requestedFixedDeadlineDateKey;
    if (!title) throw new Error("Nội dung thực hiện không được để trống.");
    if (deadlineCeilingDateKey && fixedDeadlineDateKey && fixedDeadlineDateKey > deadlineCeilingDateKey) {
      throw new Error("Hạn hoàn thành không được vượt quá hạn Ban Giám đốc giao.");
    }
    const effectivePeriodEndDate = deadlineCeilingDateKey && deadlineCeilingDateKey < clean(registration.periodEndDate)
      ? deadlineCeilingDateKey
      : registration.periodEndDate;

    const deadlinePlan = deriveDeadlinePlan({
      frequency,
      completionDeadline,
      periodStartDate: registration.periodStartDate,
      periodEndDate: effectivePeriodEndDate,
      manualDeadlineDateKey,
      fixedDeadlineDateKey
    });

    const reference = FirebaseService.doc(FirebaseService.db, "taskRegistrations", registration.id);
    const batch = FirebaseService.writeBatch(FirebaseService.db);
    batch.update(reference, {
      active: true,
      status: "PENDING",
      taskId: null,
      title,
      description,
      frequency,
      completionDeadline: deadlinePlan.mode === "EVENT_DRIVEN" ? "" : deadlinePlan.completionDeadline,
      deadlineMode: deadlinePlan.mode,
      deadlineDateKey: deadlinePlan.deadlineDateKey,
      milestoneDateKeys: deadlinePlan.milestoneDateKeys,
      manualDeadlineDateKey,
      fixedDeadlineDateKey,
      rejectionReason: "",
      rejectedAt: null,
      rejectedByUserId: "",
      rejectedByName: "",
      resubmittedAt: FirebaseService.serverTimestamp(),
      resubmittedByUserId: user.uid,
      resubmittedByName: user.fullName || "",
      updatedAt: FirebaseService.serverTimestamp()
    });
    batch.set(kpiAuditRef(), registrationAuditPayload(
      "TASK_REGISTRATION_RESUBMITTED",
      registration,
      user,
      {
        registrationId: registration.id,
        oldStatus: "REJECTED",
        newStatus: "PENDING",
        changedFields: ["title", "description", "frequency", "completionDeadline", "deadlineDateKey"]
      }
    ));
    await batch.commit();
    return {
      ...registration,
      status: "PENDING",
      active: true,
      rejectionReason: "",
      title, description, frequency,
      completionDeadline: deadlinePlan.completionDeadline,
      deadlineMode: deadlinePlan.mode,
      deadlineDateKey: deadlinePlan.deadlineDateKey,
      milestoneDateKeys: deadlinePlan.milestoneDateKeys,
      manualDeadlineDateKey,
      fixedDeadlineDateKey
    };
  },

  async getApprovedCancellationMap(registrations = []) {
    const user = UserContext.requireUser();
    const candidates = (registrations || []).filter(registration => (
      registration?.userId === user.uid
      && upper(registration?.status) === "APPROVED"
      && Boolean(clean(registration?.taskId))
      && Permissions.canCancelOwnApprovedRegistration(registration, user)
    ));

    if (!candidates.length) return {};

    const entries = await Promise.all(candidates.map(async registration => {
      try {
        const snapshot = await FirebaseService.getDoc(
          FirebaseService.doc(FirebaseService.db, "tasks", registration.taskId)
        );
        const task = snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
        if (!taskDocumentCancellable(task, user, registration)) return [registration.id, false];
        const blockers = await cancellationBlockers(task, registration, user);
        return [registration.id, blockers.any !== true];
      } catch (error) {
        console.warn("Không kiểm tra được điều kiện hủy nhiệm vụ tự đăng ký:", error);
        return [registration.id, false];
      }
    }));

    return Object.fromEntries(entries);
  },

  async cancelApprovedRegistration(registration, reason) {
    const user = UserContext.requireUser();
    const cancellationReason = clean(reason);

    if (!registration?.id) throw new Error("Không tìm thấy đăng ký cần hủy.");
    if (!cancellationReason) throw new Error("Vui lòng nhập lý do hủy đầu việc.");
    if (!(await canCancelApprovedOwnRegistration(user, registration))) {
      throw new Error("Chỉ chính Trưởng/Phó phòng hoặc người có vai trò Chi đoàn phù hợp mới được hủy nhiệm vụ do mình đăng ký.");
    }

    const taskReference = FirebaseService.doc(FirebaseService.db, "tasks", registration.taskId);
    const taskSnapshot = await FirebaseService.getDoc(taskReference);
    if (!taskSnapshot.exists()) {
      throw new Error("Không tìm thấy nhiệm vụ đã hình thành từ đăng ký này.");
    }

    const task = { id: taskSnapshot.id, ...taskSnapshot.data() };
    if (!taskDocumentCancellable(task, user, registration)) {
      throw new Error(
        "Chỉ được hủy nhiệm vụ tự đăng ký của chính mình khi chưa hoàn thành, chưa đánh giá, chưa khóa điểm và chưa phát sinh tiến độ hoặc minh chứng."
      );
    }

    const blockers = await cancellationBlockers(task, registration, user);
    if (blockers.any) throw new Error(cancellationBlockerMessage(blockers));

    const now = FirebaseService.serverTimestamp();
    const taskAfter = {
      active: false,
      status: "HUY",
      planApprovalStatus: "CANCELLED",
      includedInA: false,
      scoringEnabled: false,
      scoringStatus: "CANCELLED",
      deletedReason: cancellationReason,
      deletedAt: now,
      deletedByUserId: user.uid,
      deletedByName: user.fullName || "",
      updatedAt: now,
      updatedByUserId: user.uid,
      updatedByName: user.fullName || ""
    };

    const batch = FirebaseService.writeBatch(FirebaseService.db);
    batch.update(
      FirebaseService.doc(FirebaseService.db, "taskRegistrations", registration.id),
      {
        active: false,
        status: "CANCELLED",
        cancelReason: cancellationReason,
        cancelledAt: now,
        cancelledByUserId: user.uid,
        cancelledByName: user.fullName || "",
        updatedAt: now
      }
    );
    batch.update(taskReference, taskAfter);

    const logPayload = {
      ...TaskLogService.buildTaskLog({
        taskId: task.id,
        taskCode: task.taskCode || registration.taskCode || "",
        periodId: task.periodId || registration.periodId || "",
        action: "TASK_REGISTRATION_CANCELLED",
        before: cancellationTaskSnapshot(task),
        after: {
          ...cancellationTaskSnapshot(task),
          active: false,
          status: "HUY",
          includedInA: false,
          scoringEnabled: false,
          scoringStatus: "CANCELLED"
        },
        note: `Hủy nhiệm vụ do chính người thực hiện đăng ký nhầm. Lý do: ${cancellationReason}`
      }),
      registrationId: registration.id,
      reason: cancellationReason,
      oldStatus: task.status || "",
      newStatus: "HUY"
    };
    batch.set(taskLogRef(), logPayload);

    await batch.commit();
  },

  async cancelRegistration(registration, options = {}) {
    const user = UserContext.requireUser();
    if (!registration?.id) throw new Error("Không tìm thấy đăng ký cần hủy.");
    if (clean(registration.taskId)) throw new Error("Đăng ký đã hình thành nhiệm vụ nên không thể hủy tại đây.");

    const plan = await departmentPlan(registration.periodId, registration.departmentId);
    const planLocked = plan?.locked === true;
    const asManager = options.asManager === true;
    const delegated = asManager
      ? await hasDelegation(user, registration.departmentId, "APPROVE_REGISTRATIONS")
      : false;

    const allowed = Permissions.canCancelRegistration(registration, {
      asManager,
      planLocked,
      hasDelegation: delegated
    });

    if (!allowed) {
      if (!asManager && planLocked) {
        throw new Error("Kế hoạch đã khóa. Người đăng ký không thể tự hủy đầu việc; Trưởng phòng hoặc Phó Trưởng phòng được ủy quyền sẽ xử lý khi cần.");
      }
      if (asManager && !planLocked) {
        throw new Error("Kế hoạch đang mở. Người đăng ký có thể tự hủy đầu việc của mình.");
      }
      throw new Error("Tài khoản không có quyền hủy đăng ký này.");
    }

    await FirebaseService.deleteDoc(
      FirebaseService.doc(FirebaseService.db, "taskRegistrations", registration.id)
    );
  },

  async approve(registration, options = {}) {
    return (await this.approveMany([registration], options))[0];
  },

  async reject(registration, reason) {
    return this.rejectMany([registration], reason);
  }
});
