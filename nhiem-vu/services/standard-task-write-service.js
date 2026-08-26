/**
 * Dịch vụ quản lý danh mục công việc chuẩn tại ứng dụng.
 * - Mã đầu việc được cấp tự động bằng transaction trên standardTaskSequences.
 * - Trưởng/Phó phòng được tạo đầu việc đúng đơn vị; nhân viên có thể được ủy quyền.
 * - Bí thư, Phó Bí thư và Ủy viên BCH được tạo đầu việc trong phạm vi Chi đoàn.
 * - Quyền tạo, sửa và xóa được tách riêng; Firestore Rules là lớp bảo vệ cuối cùng.
 */
import { FirebaseService } from "../core/firebase-service.js?v=20260826.V1_18_5";
import { UserContext } from "../core/user-context.js?v=20260826.V1_18_5";
import { Permissions } from "../core/permissions.js?v=20260826.V1_18_5";
import { validateDeadlineConfiguration, isEventDrivenFrequency, canonicalFrequency, isStandardFrequency } from "../core/deadline-engine.js?v=20260826.V1_18_5";

const SYNC_VERSION = "20260826.V1_18_5";
const MAX_STANDARD_TASK_NAME_LENGTH = 1000;
const STANDARD_TASK_COLLECTION = "standardTasks";
const SEQUENCE_COLLECTION = "standardTaskSequences";
const PROFESSIONAL_DEPARTMENTS = Object.freeze(["BGD", "TCHC", "CTXH", "KHTC", "YT", "KI", "KII", "KIII"]);
const VALID_COEFFICIENTS = Object.freeze([1, 1.1, 1.2]);
const DEPARTMENT_AUDIENCES = Object.freeze(["ALL_DEPARTMENT", "MANAGEMENT"]);
const CDTN_AUDIENCES = Object.freeze(["CDTN_SECRETARY", "CDTN_EXECUTIVE", "CDTN_MEMBER"]);
const TRACKING_MODES = Object.freeze(["FINAL_OUTPUT", "ITEMIZED"]);
const WORK_ITEM_TYPES = Object.freeze(["GENERIC", "DOCUMENT", "QUANTITY", "ATTENDANCE"]);
const CDTN_CATALOG_ROLES = Object.freeze(["CDTN_BI_THU", "CDTN_PHO_BI_THU", "CDTN_UY_VIEN_BCH"]);
const CDTN_LEADERSHIP_ROLES = Object.freeze(["CDTN_BI_THU", "CDTN_PHO_BI_THU"]);

function clean(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return clean(value).toUpperCase();
}

function normalizedCode(value) {
  return upper(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/Đ/g, "D")
    .replace(/[^A-Z0-9_-]+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
}

function numericSuffix(value, prefix = "") {
  const code = normalizedCode(value);
  const normalizedPrefix = normalizedCode(prefix);
  if (normalizedPrefix && !code.startsWith(normalizedPrefix)) return 0;
  const match = /(\d+)$/.exec(code);
  return match ? Number(match[1]) : 0;
}

function normalizeWorkType(value) {
  return upper(value || "THUONG_XUYEN") === "DOT_XUAT" ? "DOT_XUAT" : "THUONG_XUYEN";
}

function formatTaskCode(departmentId, numberValue, workType = "THUONG_XUYEN") {
  const prefix = normalizedCode(departmentId);
  const sequence = Math.max(1, Math.trunc(Number(numberValue || 1)));
  const suffix = String(sequence).padStart(2, "0");
  return normalizeWorkType(workType) === "DOT_XUAT"
    ? `${prefix}-DX${suffix}`
    : `${prefix}${suffix}`;
}

function taskBelongsToSequence(item, departmentId, workType) {
  const code = normalizedCode(item?.code || item?.id);
  const department = normalizedCode(departmentId);
  const normalizedType = normalizeWorkType(item?.workType || (code.includes("-DX") ? "DOT_XUAT" : "THUONG_XUYEN"));
  if (normalizedType !== normalizeWorkType(workType)) return false;
  if (normalizedType === "DOT_XUAT") {
    return code.startsWith(`${department}-DX`) || code.startsWith(department);
  }
  return code.startsWith(department) && !code.includes("-DX");
}

function dateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function endOfDay(value) {
  return FirebaseService.Timestamp.fromDate(new Date(`${value}T23:59:59`));
}

function startOfDay(value) {
  return FirebaseService.Timestamp.fromDate(new Date(`${value}T00:00:00`));
}

function delegationDocumentId(departmentId) {
  return `${upper(departmentId)}_STANDARD_TASK_EDITOR`;
}

function delegationIsActive(data, user) {
  if (!data || data.active !== true || data.delegateUserId !== user.uid) return false;
  if (upper(data.departmentId) !== upper(user.departmentId)) return false;
  if (!Array.isArray(data.permissions) || !data.permissions.includes("MANAGE_STANDARD_TASKS")) return false;
  const now = Date.now();
  const start = data.startAt?.toDate?.()?.getTime?.() ?? null;
  const end = data.endAt?.toDate?.()?.getTime?.() ?? null;
  return (start === null || start <= now) && (end === null || end >= now);
}

function normalizeAudienceType(value, departmentId) {
  const department = upper(departmentId);
  const requested = upper(value);
  const allowed = department === "CDTN" ? CDTN_AUDIENCES : DEPARTMENT_AUDIENCES;
  return allowed.includes(requested) ? requested : "";
}

function normalizeTrackingMode(value) {
  const mode = upper(value || "FINAL_OUTPUT");
  return TRACKING_MODES.includes(mode) ? mode : "FINAL_OUTPUT";
}

function normalizeWorkItemType(value, trackingMode) {
  if (trackingMode !== undefined && normalizeTrackingMode(trackingMode) !== "ITEMIZED") return "GENERIC";
  const type = upper(value || "GENERIC");
  return WORK_ITEM_TYPES.includes(type) ? type : "GENERIC";
}

function uniqueRoles(...roleGroups) {
  return [...new Set(roleGroups.flat().map(upper).filter(Boolean))];
}

function primaryCdtnCatalogRole(roles = []) {
  const normalized = uniqueRoles(roles);
  return CDTN_CATALOG_ROLES.find(role => normalized.includes(role)) || "";
}

async function readCdtnDirectoryAccess(user) {
  try {
    const snapshot = await FirebaseService.getDoc(
      FirebaseService.doc(FirebaseService.db, "cdtnMembers", user.uid)
    );
    if (!snapshot.exists()) return { active: false, roles: [], catalogManager: false, leadership: false };
    const data = snapshot.data() || {};
    const roles = Array.isArray(data.additionalRoles) ? data.additionalRoles.map(upper) : [];
    const validDirectory = data.active === true && data.userId === user.uid;
    return {
      active: validDirectory,
      roles,
      catalogManager: validDirectory && roles.some(role => CDTN_CATALOG_ROLES.includes(role)),
      leadership: validDirectory && roles.some(role => CDTN_LEADERSHIP_ROLES.includes(role))
    };
  } catch (error) {
    console.warn("Không đọc được danh bạ quyền Chi đoàn; tiếp tục dùng hồ sơ users:", error);
    return { active: false, roles: [], catalogManager: false, leadership: false };
  }
}

function departmentAuthorization(user, departmentId, delegation, combinedCdtnRoles = []) {
  const department = upper(departmentId);
  const userDepartment = upper(user?.departmentId);
  const delegated = department === userDepartment && delegationIsActive(delegation, user);
  const createdUnderAdditionalRole = department === "CDTN"
    ? primaryCdtnCatalogRole(combinedCdtnRoles)
    : "";

  if (Permissions.isAdmin(user)) {
    return {
      canCreate: true,
      canEditAll: true,
      canEditOwn: true,
      canDelete: true,
      createdUnderDelegation: false,
      delegatorUserId: "",
      createdUnderAdditionalRole
    };
  }

  if (department === "CDTN") {
    const canCreate = Boolean(createdUnderAdditionalRole);
    const leadership = CDTN_LEADERSHIP_ROLES.includes(createdUnderAdditionalRole);
    return {
      canCreate,
      canEditAll: leadership,
      canEditOwn: canCreate,
      canDelete: leadership,
      createdUnderDelegation: false,
      delegatorUserId: "",
      createdUnderAdditionalRole
    };
  }

  if (department === "BGD") {
    const director = Permissions.isDirector(user) && userDepartment === "BGD";
    return {
      canCreate: director,
      canEditAll: director,
      canEditOwn: director,
      canDelete: director,
      createdUnderDelegation: false,
      delegatorUserId: "",
      createdUnderAdditionalRole: ""
    };
  }

  const sameDepartment = department === userDepartment;
  const isHead = sameDepartment && Permissions.isDepartmentHead(user);
  const isDeputy = sameDepartment && Permissions.isDepartmentDeputy(user);
  const delegatedStaff = sameDepartment && Permissions.isStaff(user) && delegated;
  return {
    canCreate: isHead || isDeputy || delegatedStaff,
    canEditAll: isHead,
    canEditOwn: isHead || isDeputy || delegatedStaff,
    canDelete: isHead,
    createdUnderDelegation: delegatedStaff,
    delegatorUserId: delegatedStaff ? clean(delegation?.delegatorUserId) : "",
    createdUnderAdditionalRole: ""
  };
}

function canEditExistingTask(task, authorization, user) {
  if (!task || !authorization) return false;
  if (authorization.canEditAll) return true;
  return authorization.canEditOwn === true
    && clean(task.createdByUserId) !== ""
    && clean(task.createdByUserId) === user.uid;
}

async function queryHasDocument(collectionName, fieldName, value) {
  if (!clean(value)) return false;
  const snapshot = await FirebaseService.getDocs(
    FirebaseService.query(
      FirebaseService.collection(FirebaseService.db, collectionName),
      FirebaseService.where(fieldName, "==", value),
      FirebaseService.limit(1)
    )
  );
  return !snapshot.empty;
}

async function taskHasHistory(task) {
  const id = clean(task?.id);
  const code = upper(task?.code || task?.id);
  const checks = await Promise.all([
    queryHasDocument("taskRegistrations", "standardTaskId", id),
    queryHasDocument("taskRegistrations", "standardTaskCode", code),
    queryHasDocument("tasks", "standardTaskCode", code)
  ]);
  return checks.some(Boolean);
}

async function listDepartmentTasks(departmentId) {
  const snapshot = await FirebaseService.getDocs(
    FirebaseService.query(
      FirebaseService.collection(FirebaseService.db, STANDARD_TASK_COLLECTION),
      FirebaseService.where("departmentId", "==", upper(departmentId))
    )
  );
  return snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
}

function departmentSequenceNumbers(items, departmentId, workType = "THUONG_XUYEN") {
  const department = upper(departmentId);
  return new Set(
    (items || [])
      .filter(item => taskBelongsToSequence(item, department, workType))
      .map(item => numericSuffix(item.code || item.id, department))
      .filter(numberValue => Number.isInteger(numberValue) && numberValue > 0)
  );
}

async function observedSequenceState(departmentId, workType = "THUONG_XUYEN") {
  const department = upper(departmentId);
  const normalizedType = normalizeWorkType(workType);
  const items = await listDepartmentTasks(department);
  const usedNumbers = departmentSequenceNumbers(items, department, normalizedType);
  const highestExistingNumber = usedNumbers.size ? Math.max(...usedNumbers) : 0;
  return { items, usedNumbers, highestExistingNumber, workType: normalizedType };
}

async function updateSequenceHint(departmentId, user, workType = "THUONG_XUYEN") {
  const department = upper(departmentId);
  const normalizedType = normalizeWorkType(workType);
  const state = await observedSequenceState(department, normalizedType);
  const reference = FirebaseService.doc(FirebaseService.db, SEQUENCE_COLLECTION, department);
  const currentSnapshot = await FirebaseService.getDoc(reference);
  const current = currentSnapshot.exists() ? currentSnapshot.data() : {};
  const fieldPrefix = normalizedType === "DOT_XUAT" ? "unexpected" : "regular";
  const storedHighest = Number(current?.[`${fieldPrefix}HighestExistingNumber`] || current?.[`${fieldPrefix}LastNumber`] || 0);
  const highestExistingNumber = Math.max(state.highestExistingNumber, storedHighest);
  const nextAvailableNumber = highestExistingNumber + 1;
  await FirebaseService.setDoc(reference, {
    departmentId: department,
    allocationMode: "MONOTONIC_MAX_PLUS_ONE",
    [`${fieldPrefix}NextAvailableNumber`]: nextAvailableNumber,
    [`${fieldPrefix}NextAvailableCode`]: formatTaskCode(department, nextAvailableNumber, normalizedType),
    [`${fieldPrefix}HighestExistingNumber`]: highestExistingNumber,
    updatedAt: FirebaseService.serverTimestamp(),
    updatedByUserId: user.uid,
    updatedByName: user.fullName || ""
  }, { merge: true });
  return { ...state, nextAvailableNumber, highestExistingNumber };
}

function taskPayload({ data, user, departmentId, code, sequence, existing = false, authorization = null }) {
  const workType = normalizeWorkType(data.workType);
  const baseScore = workType === "DOT_XUAT" ? 12 : 10;
  const difficultyCoefficient = Number(data.difficultyCoefficient || 1);
  const audienceType = normalizeAudienceType(data.audienceType, departmentId);
  const isManagementTask = data.isManagementTask === true;
  const isCoreTaskDefault = data.isCoreTaskDefault === true;
  const maximumConvertedScore = Math.round(baseScore * difficultyCoefficient * 10) / 10;
  const canonicalFrequencyValue = canonicalFrequency(data.frequency);
  const eventDriven = isEventDrivenFrequency(canonicalFrequencyValue);
  const trackingMode = eventDriven ? "ITEMIZED" : normalizeTrackingMode(data.trackingMode);
  const workItemType = normalizeWorkItemType(data.workItemType, trackingMode);
  const quantityUnit = workItemType === "QUANTITY" ? clean(data.quantityUnit) : "";
  const deadlineConfig = validateDeadlineConfiguration(canonicalFrequencyValue, data.completionDeadline);
  const isCdtn = departmentId === "CDTN";

  if (workItemType === "QUANTITY" && !quantityUnit) {
    throw new Error("Hãy nhập đơn vị sản lượng, ví dụ: kg rau.");
  }

  return {
    code,
    name: clean(data.name),
    departmentId,
    organizationId: isCdtn ? "CDTN" : "",
    scopeType: isCdtn ? "ORGANIZATION" : "DEPARTMENT",
    frequency: canonicalFrequencyValue,
    completionDeadline: deadlineConfig.completionDeadline,
    deadlineRuleType: deadlineConfig.kind,
    workType,
    outputRequirement: clean(data.outputRequirement),
    mandatoryEvidence: clean(data.mandatoryEvidence),
    arisingEvidence: clean(data.arisingEvidence),
    trackingMode,
    workItemType,
    quantityUnit,
    baseScore,
    difficultyCoefficient,
    maximumConvertedScore,
    audienceType,
    isCoreTaskDefault,
    isManagementTask,
    order: Math.max(1, Math.trunc(Number(sequence || numericSuffix(code, departmentId) || 1))),
    active: true,
    syncSource: "WEB_APP_STANDARD_TASKS",
    syncVersion: SYNC_VERSION,
    updatedAt: FirebaseService.serverTimestamp(),
    updatedByUserId: user.uid,
    updatedByName: user.fullName || "",
    updatedByRole: user.role || "",
    ...(existing ? {} : {
      createdAt: FirebaseService.serverTimestamp(),
      createdByUserId: user.uid,
      createdByName: user.fullName || "",
      createdByRole: user.role || "",
      createdUnderDelegation: authorization?.createdUnderDelegation === true,
      delegatorUserId: clean(authorization?.delegatorUserId),
      createdUnderAdditionalRole: clean(authorization?.createdUnderAdditionalRole)
    })
  };
}

function isPermissionDenied(error) {
  const code = upper(error?.code);
  const message = upper(error?.message);
  return code.includes("PERMISSION-DENIED")
    || code.includes("PERMISSION_DENIED")
    || message.includes("MISSING OR INSUFFICIENT PERMISSIONS")
    || message.includes("PERMISSION-DENIED");
}

export const StandardTaskWriteService = Object.freeze({
  async getEditorDelegation() {
    const user = UserContext.requireUser();
    const departmentId = upper(user.departmentId);
    if (!departmentId || departmentId === "CDTN") return null;
    const reference = FirebaseService.doc(
      FirebaseService.db,
      "approvalDelegations",
      delegationDocumentId(departmentId)
    );
    const snapshot = await FirebaseService.getDoc(reference);
    return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
  },

  async getAccess() {
    const user = UserContext.requireUser();
    let delegation = null;
    try {
      delegation = await this.getEditorDelegation();
    } catch (error) {
      if (!String(error?.code || "").includes("permission-denied")) {
        console.warn("Không đọc được ủy quyền nhập danh mục:", error);
      }
    }

    const cdtnDirectory = await readCdtnDirectoryAccess(user);
    const combinedCdtnRoles = uniqueRoles(user.additionalRoles || [], cdtnDirectory.roles || []);
    const candidateDepartments = Permissions.isAdmin(user)
      ? [...PROFESSIONAL_DEPARTMENTS, "CDTN"]
      : [...new Set([upper(user.departmentId), ...(primaryCdtnCatalogRole(combinedCdtnRoles) ? ["CDTN"] : [])])].filter(Boolean);

    const authorizationByDepartment = Object.fromEntries(
      candidateDepartments.map(departmentId => [
        departmentId,
        departmentAuthorization(user, departmentId, delegation, combinedCdtnRoles)
      ])
    );
    const creatableDepartmentIds = candidateDepartments.filter(id => authorizationByDepartment[id]?.canCreate === true);
    const editableDepartmentIds = candidateDepartments.filter(id => (
      authorizationByDepartment[id]?.canEditAll === true || authorizationByDepartment[id]?.canEditOwn === true
    ));
    const deletableDepartmentIds = candidateDepartments.filter(id => authorizationByDepartment[id]?.canDelete === true);

    return {
      canManage: creatableDepartmentIds.length > 0,
      canCreate: creatableDepartmentIds.length > 0,
      isDepartmentHead: Permissions.isDepartmentHead(user),
      isDepartmentDeputy: Permissions.isDepartmentDeputy(user),
      canDelegateCatalogEditor: Permissions.canDelegateStandardTaskEditor(user),
      isCdtnCatalogManager: primaryCdtnCatalogRole(combinedCdtnRoles) !== "",
      cdtnDirectoryRoles: cdtnDirectory.roles,
      manageableDepartmentIds: creatableDepartmentIds,
      creatableDepartmentIds,
      editableDepartmentIds,
      deletableDepartmentIds,
      authorizationByDepartment,
      delegation
    };
  },

  async getNextCode(departmentId, workType = "THUONG_XUYEN") {
    const access = await this.getAccess();
    const department = upper(departmentId || access.creatableDepartmentIds[0]);
    if (!access.creatableDepartmentIds.includes(department)) {
      throw new Error("Tài khoản không có quyền cấp mã cho danh mục này.");
    }

    const normalizedType = normalizeWorkType(workType);
    const state = await observedSequenceState(department, normalizedType);
    const sequenceSnapshot = await FirebaseService.getDoc(
      FirebaseService.doc(FirebaseService.db, SEQUENCE_COLLECTION, department)
    );
    const sequenceData = sequenceSnapshot.exists() ? sequenceSnapshot.data() : {};
    const fieldPrefix = normalizedType === "DOT_XUAT" ? "unexpected" : "regular";
    const storedHighest = Number(sequenceData?.[`${fieldPrefix}HighestExistingNumber`] || sequenceData?.[`${fieldPrefix}LastNumber`] || 0);
    const nextNumber = Math.max(state.highestExistingNumber, storedHighest) + 1;
    return formatTaskCode(department, nextNumber, normalizedType);
  },

  async listDelegationCandidates() {
    const user = UserContext.requireUser();
    if (!Permissions.canDelegateStandardTaskEditor(user)) return [];
    const snapshot = await FirebaseService.getDocs(
      FirebaseService.query(
        FirebaseService.collection(FirebaseService.db, "users"),
        FirebaseService.where("departmentId", "==", upper(user.departmentId))
      )
    );
    return snapshot.docs
      .map(item => ({ id: item.id, ...item.data() }))
      .filter(item => item.active === true && upper(item.role) === "STAFF" && item.id !== user.uid)
      .sort((a, b) => clean(a.fullName).localeCompare(clean(b.fullName), "vi"));
  },

  async saveDelegation({ delegateUserId, startDate, endDate, reason }) {
    const user = UserContext.requireUser();
    if (!Permissions.canDelegateStandardTaskEditor(user)) {
      throw new Error("Chỉ Trưởng phòng hoặc Phó Trưởng phòng được ủy quyền nhập danh mục công việc.");
    }
    if (!clean(delegateUserId)) throw new Error("Hãy chọn nhân viên được ủy quyền.");
    if (!clean(startDate) || !clean(endDate) || startDate > endDate) {
      throw new Error("Thời gian ủy quyền chưa hợp lệ.");
    }
    if (!clean(reason)) throw new Error("Hãy nhập lý do ủy quyền.");

    const candidates = await this.listDelegationCandidates();
    const delegate = candidates.find(item => item.id === delegateUserId);
    if (!delegate) throw new Error("Nhân viên được chọn không còn đủ điều kiện nhận ủy quyền.");

    const departmentId = upper(user.departmentId);
    const reference = FirebaseService.doc(
      FirebaseService.db,
      "approvalDelegations",
      delegationDocumentId(departmentId)
    );
    const existing = await FirebaseService.getDoc(reference);

    await FirebaseService.setDoc(reference, {
      delegationType: "STANDARD_TASK_EDITOR",
      departmentId,
      delegatorUserId: user.uid,
      delegatorName: user.fullName || "",
      delegatorRole: user.role || "",
      delegatorPosition: user.position || "",
      delegateUserId: delegate.id,
      delegateName: delegate.fullName || "",
      delegatePosition: delegate.position || "Nhân viên",
      permissions: ["MANAGE_STANDARD_TASKS"],
      startDate,
      endDate,
      startAt: startOfDay(startDate),
      endAt: endOfDay(endDate),
      reason: clean(reason),
      active: true,
      revokedAt: null,
      revokedByUserId: "",
      revokedByName: "",
      createdAt: existing.exists() ? (existing.data().createdAt || FirebaseService.serverTimestamp()) : FirebaseService.serverTimestamp(),
      createdBy: existing.exists() ? (existing.data().createdBy || user.uid) : user.uid,
      updatedAt: FirebaseService.serverTimestamp(),
      updatedBy: user.uid
    }, { merge: true });
  },

  async revokeDelegation() {
    const user = UserContext.requireUser();
    if (!Permissions.canDelegateStandardTaskEditor(user)) {
      throw new Error("Chỉ Trưởng phòng hoặc Phó Trưởng phòng được thu hồi ủy quyền nhập danh mục.");
    }
    const reference = FirebaseService.doc(
      FirebaseService.db,
      "approvalDelegations",
      delegationDocumentId(user.departmentId)
    );
    await FirebaseService.updateDoc(reference, {
      active: false,
      revokedAt: FirebaseService.serverTimestamp(),
      revokedByUserId: user.uid,
      revokedByName: user.fullName || "",
      updatedAt: FirebaseService.serverTimestamp(),
      updatedBy: user.uid
    });
  },

  async saveTask(data, existingId = "") {
    const user = UserContext.requireUser();
    const access = await this.getAccess();
    const departmentId = upper(data.departmentId || user.departmentId);
    const authorization = access.authorizationByDepartment?.[departmentId] || null;

    const name = clean(data.name);
    const difficultyCoefficient = Number(data.difficultyCoefficient || 1);
    if (!name) throw new Error("Tên đầu việc là bắt buộc.");
    if (name.length > MAX_STANDARD_TASK_NAME_LENGTH) {
      throw new Error(`Tên đầu việc không được vượt quá ${MAX_STANDARD_TASK_NAME_LENGTH} ký tự.`);
    }
    if (!clean(data.outputRequirement)) throw new Error("Hãy nhập kết quả đầu ra hoặc yêu cầu hoàn thành.");
    if (!clean(data.frequency)) throw new Error("Hãy chọn Chu kỳ/Tần suất.");
    if (!isStandardFrequency(data.frequency)) throw new Error("Chu kỳ/Tần suất phải chọn từ danh sách chuẩn: Theo ngày, Theo tuần, Theo tháng, Theo quý, Theo năm hoặc Khi phát sinh.");
    const audienceType = normalizeAudienceType(data.audienceType, departmentId);
    if (!audienceType) {
      throw new Error(departmentId === "CDTN"
        ? "Hãy chọn Đối tượng áp dụng Chi đoàn."
        : "Hãy chọn Đối tượng áp dụng: ALL_DEPARTMENT hoặc MANAGEMENT.");
    }
    // Bộ chu kỳ chuẩn dùng đúng một quy tắc deadline thống nhất; Khi phát sinh luôn để trống ở danh mục.
    validateDeadlineConfiguration(canonicalFrequency(data.frequency), data.completionDeadline);
    if (!clean(data.mandatoryEvidence)) throw new Error("Hãy nhập loại minh chứng bắt buộc.");
    if (!VALID_COEFFICIENTS.some(value => Math.abs(value - difficultyCoefficient) < 0.000001)) {
      throw new Error("Hệ số độ khó chỉ được dùng 100%, 110% hoặc 120%.");
    }

    if (existingId) {
      const reference = FirebaseService.doc(FirebaseService.db, STANDARD_TASK_COLLECTION, existingId);
      const snapshot = await FirebaseService.getDoc(reference);
      if (!snapshot.exists()) throw new Error("Đầu việc không còn tồn tại.");
      const existing = { id: snapshot.id, ...snapshot.data() };
      if (upper(existing.departmentId) !== departmentId) {
        throw new Error("Không được chuyển đầu việc sang Phòng/Khu khác sau khi đã tạo.");
      }
      if (!canEditExistingTask(existing, authorization, user)) {
        throw new Error("Tài khoản chỉ được sửa đầu việc do mình tạo hoặc đầu việc thuộc phạm vi được quản lý.");
      }
      const code = normalizedCode(existing.code || existingId);
      const sequence = numericSuffix(code, departmentId) || Number(existing.order || 1);
      await FirebaseService.setDoc(
        reference,
        taskPayload({ data, user, departmentId, code, sequence, existing: true, authorization }),
        { merge: true }
      );
      return { documentId: existingId, code, mode: "UPDATED" };
    }

    if (!authorization?.canCreate) {
      throw new Error("Không có quyền thêm đầu việc tại phạm vi đã chọn.");
    }

    const workType = normalizeWorkType(data.workType);
    const sequenceReference = FirebaseService.doc(FirebaseService.db, SEQUENCE_COLLECTION, departmentId);
    let lastError = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const observedState = await observedSequenceState(departmentId, workType);
      try {
        return await FirebaseService.runTransaction(FirebaseService.db, async transaction => {
          const sequenceSnapshot = await transaction.get(sequenceReference);
          const sequenceData = sequenceSnapshot.exists() ? sequenceSnapshot.data() : {};
          const fieldPrefix = workType === "DOT_XUAT" ? "unexpected" : "regular";
          const storedHighest = Number(
            sequenceData?.[`${fieldPrefix}HighestExistingNumber`]
            || sequenceData?.[`${fieldPrefix}LastNumber`]
            || 0
          );
          const sequence = Math.max(observedState.highestExistingNumber, storedHighest) + 1;
          const code = formatTaskCode(departmentId, sequence, workType);
          const reference = FirebaseService.doc(FirebaseService.db, STANDARD_TASK_COLLECTION, code);
          const nextAvailableNumber = sequence + 1;

          /*
           * Không transaction.get() document mã mới. Việc đọc một document chưa tồn tại
           * từng bị Rules từ chối trước khi nhánh create được đánh giá. Sequence document
           * là khóa transaction; update rule của standardTasks bảo vệ không ghi đè mã cũ.
           */
          transaction.set(sequenceReference, {
            departmentId,
            allocationMode: "MONOTONIC_MAX_PLUS_ONE",
            ...(workType === "DOT_XUAT" ? {
              unexpectedLastNumber: sequence,
              unexpectedLastCode: code,
              unexpectedNextAvailableNumber: nextAvailableNumber,
              unexpectedNextAvailableCode: formatTaskCode(departmentId, nextAvailableNumber, workType),
              unexpectedHighestExistingNumber: sequence
            } : {
              regularLastNumber: sequence,
              regularLastCode: code,
              regularNextAvailableNumber: nextAvailableNumber,
              regularNextAvailableCode: formatTaskCode(departmentId, nextAvailableNumber, workType),
              regularHighestExistingNumber: sequence
            }),
            updatedAt: FirebaseService.serverTimestamp(),
            updatedByUserId: user.uid,
            updatedByName: user.fullName || ""
          }, { merge: true });

          transaction.set(
            reference,
            taskPayload({ data, user, departmentId, code, sequence, existing: false, authorization }),
            { merge: false }
          );

          return { documentId: code, code, mode: "CREATED" };
        });
      } catch (error) {
        lastError = error;
        if (!isPermissionDenied(error) || attempt === 2) break;
        console.warn(`Mã dự kiến vừa thay đổi; thử cấp lại mã lần ${attempt + 2}.`, error);
      }
    }

    if (isPermissionDenied(lastError)) {
      throw new Error(
        "Không thể cấp mã đầu việc an toàn. Có thể mã dự kiến vừa được đồng bộ từ nguồn khác hoặc quyền tạo chưa phù hợp. Hãy bấm Cập nhật và thử lại."
      );
    }
    throw lastError || new Error("Không thể tạo đầu việc mới.");
  },

  async removeTask(task) {
    const user = UserContext.requireUser();
    const access = await this.getAccess();
    const taskId = clean(task?.id);
    const departmentId = upper(task?.departmentId);
    const authorization = access.authorizationByDepartment?.[departmentId] || null;

    if (!taskId || !departmentId) throw new Error("Không xác định được đầu việc cần xóa.");
    if (!authorization?.canDelete) {
      throw new Error("Chỉ Admin, Trưởng phòng, Giám đốc trong phạm vi BGD hoặc Bí thư/Phó Bí thư được xóa danh mục.");
    }

    const reference = FirebaseService.doc(FirebaseService.db, STANDARD_TASK_COLLECTION, taskId);
    const hasHistory = await taskHasHistory(task);

    /*
     * Người quản lý nghiệp vụ luôn gỡ mềm để giữ audit. Chỉ ADMIN được xóa cứng
     * một mã hoàn toàn chưa phát sinh dữ liệu, phù hợp lớp bảo vệ trong Rules.
     */
    if (hasHistory || !Permissions.isAdmin(user)) {
      await FirebaseService.updateDoc(reference, {
        active: false,
        removedFromCatalogAt: FirebaseService.serverTimestamp(),
        removedFromCatalogByUserId: user.uid,
        removedFromCatalogByName: user.fullName || "",
        updatedAt: FirebaseService.serverTimestamp(),
        updatedByUserId: user.uid,
        updatedByName: user.fullName || "",
        updatedByRole: user.role || ""
      });
      return { mode: "ARCHIVED" };
    }

    await FirebaseService.deleteDoc(reference);
    try {
      await updateSequenceHint(departmentId, user, task?.workType);
    } catch (error) {
      console.warn("Đã xóa đầu việc nhưng chưa cập nhật được gợi ý mã kế tiếp:", error);
    }
    return { mode: "DELETED" };
  },

  todayKey: dateKey,
  normalizeAudienceType,
  normalizeWorkItemType,
  normalizeWorkType,
  formatTaskCode
});
