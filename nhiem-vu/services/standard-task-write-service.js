/**
 * Dịch vụ quản lý danh mục công việc chuẩn tại ứng dụng.
 * - Mã đầu việc được cấp tự động bằng transaction trên standardTaskSequences.
 * - Người có Quyền phê duyệt tại đơn vị được tạo/quản lý; Phó hoặc nhân viên chỉ có quyền khi được ủy quyền đúng capability.
 * - Chỉ Bí thư được tạo/quản lý đầu việc trong phạm vi Chi đoàn; Phó Bí thư/Ủy viên BCH là vai trò thực hiện hoặc được ủy quyền nghiệp vụ khác.
 * - Quyền tạo, sửa và xóa được tách riêng; Firestore Rules là lớp bảo vệ cuối cùng.
 */
import { FirebaseService } from "../core/firebase-service.js?v=20260903.V1_22_5";
import { UserContext } from "../core/user-context.js?v=20260903.V1_22_5";
import { Permissions } from "../core/permissions.js?v=20260903.V1_22_5";
import { validateDeadlineConfiguration, isEventDrivenFrequency, canonicalFrequency, isStandardFrequency } from "../core/deadline-engine.js?v=20260903.V1_22_5";

const SYNC_VERSION = "20260903.V1_22_5";
const MAX_STANDARD_TASK_NAME_LENGTH = 1000;
const STANDARD_TASK_COLLECTION = "standardTasks";
const SEQUENCE_COLLECTION = "standardTaskSequences";
const PROFESSIONAL_DEPARTMENTS = Object.freeze(["BGD", "TCHC", "CTXH", "KHTC", "YT", "KI", "KII", "KIII"]);
const VALID_COEFFICIENTS = Object.freeze([1, 1.1, 1.2]);
const DEPARTMENT_AUDIENCES = Object.freeze(["ALL_DEPARTMENT", "MANAGEMENT"]);
const CDTN_AUDIENCES = Object.freeze(["CDTN_SECRETARY", "CDTN_EXECUTIVE", "CDTN_MEMBER"]);
const TRACKING_MODES = Object.freeze(["FINAL_OUTPUT", "ITEMIZED"]);
const WORK_ITEM_TYPES = Object.freeze(["GENERIC", "DOCUMENT", "QUANTITY", "ATTENDANCE"]);
const CDTN_CATALOG_ROLES = Object.freeze(["CDTN_BI_THU"]);
const CDTN_LEADERSHIP_ROLES = Object.freeze(["CDTN_BI_THU", "CDTN_PHO_BI_THU"]);
const STANDARD_TASK_DELEGATION_PERMISSIONS = Object.freeze([
  "CREATE_STANDARD_TASKS", "EDIT_STANDARD_TASKS", "DELETE_STANDARD_TASKS", "CREATE_TASKS",
  // Legacy V1.18.x: tương thích tạm thời; tương đương CREATE + EDIT-OWN, không bao gồm DELETE.
  "MANAGE_STANDARD_TASKS"
]);

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

function delegationBaseValid(data, user) {
  if (!data || data.active !== true || data.delegateUserId !== user.uid) return false;
  if (upper(data.departmentId) !== upper(user.departmentId)) return false;
  if (!Array.isArray(data.permissions) || data.permissions.length === 0) return false;
  const now = Date.now();
  const start = data.startAt?.toDate?.()?.getTime?.() ?? null;
  const end = data.endAt?.toDate?.()?.getTime?.() ?? null;
  return (start === null || start <= now) && (end === null || end >= now);
}

function delegationPermissionSet(data, user) {
  if (!delegationBaseValid(data, user)) return new Set();
  return new Set((data.permissions || []).map(upper));
}

function delegationHasPermission(data, user, permissionName) {
  const permissions = delegationPermissionSet(data, user);
  const permission = upper(permissionName);
  if (permissions.has(permission)) return true;
  // MANAGE_STANDARD_TASKS là permission legacy: giữ quyền thêm + sửa đầu việc do chính delegate tạo,
  // tuyệt đối không tự nâng thành quyền DELETE trong V1.19.0.
  return permissions.has("MANAGE_STANDARD_TASKS")
    && ["CREATE_STANDARD_TASKS", "EDIT_STANDARD_TASKS"].includes(permission);
}

function delegationHasExplicitPermission(data, user, permissionName) {
  return delegationPermissionSet(data, user).has(upper(permissionName));
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

function standardTaskDelegateCandidate(user) {
  if (!user || user.active !== true) return false;
  if (Permissions.isDepartmentDeputy(user)) return true;
  const role = upper(user.role);
  if (["STAFF", "TCHC_COORDINATOR"].includes(role)) return true;
  /* ADMIN chỉ là system privilege; nếu business position không phải Trưởng/Phó thì vẫn có thể là nhân viên nhận ủy quyền. */
  return role === "ADMIN"
    && !Permissions.hasUnitApprovalAuthority(user)
    && !Permissions.isDepartmentDeputy(user)
    && !Permissions.isDirector(user);
}

function departmentAuthorization(user, departmentId, delegation, combinedCdtnRoles = []) {
  const department = upper(departmentId);
  const userDepartment = upper(user?.departmentId);
  const createdUnderAdditionalRole = department === "CDTN"
    ? primaryCdtnCatalogRole(combinedCdtnRoles)
    : "";

  if (department === "CDTN") {
    const canCreate = createdUnderAdditionalRole === "CDTN_BI_THU";
    return {
      canCreate,
      canEditAll: canCreate,
      canEditOwn: canCreate,
      canDelete: canCreate,
      createdUnderDelegation: false,
      delegatorUserId: "",
      createdUnderAdditionalRole
    };
  }

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
  const isAuthority = sameDepartment && Permissions.hasUnitApprovalAuthority(user);
  const delegateRoleEligible = sameDepartment && standardTaskDelegateCandidate(user);
  const delegatedCreate = delegateRoleEligible && delegationHasPermission(delegation, user, "CREATE_STANDARD_TASKS");
  const delegatedEditExplicit = delegateRoleEligible && delegationHasExplicitPermission(delegation, user, "EDIT_STANDARD_TASKS");
  const delegatedEditLegacy = delegateRoleEligible
    && delegationHasExplicitPermission(delegation, user, "MANAGE_STANDARD_TASKS");
  const delegatedDelete = delegateRoleEligible && delegationHasExplicitPermission(delegation, user, "DELETE_STANDARD_TASKS");
  return {
    canCreate: isAuthority || delegatedCreate,
    // EDIT_STANDARD_TASKS là quyền sửa toàn bộ danh mục của scope; permission legacy chỉ sửa bản ghi do chính delegate tạo.
    canEditAll: isAuthority || delegatedEditExplicit,
    canEditOwn: isAuthority || delegatedEditExplicit || delegatedEditLegacy,
    // DELETE_STANDARD_TASKS chỉ gỡ mềm/ẩn khỏi danh mục; hard delete vẫn chỉ ADMIN.
    canDelete: isAuthority || delegatedDelete,
    createdUnderDelegation: delegatedCreate,
    delegatorUserId: delegatedCreate ? clean(delegation?.delegatorUserId) : "",
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
  return snapshot.docs.map(item => ({ ...item.data(), id: item.id, uid: item.id }));
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
      .map(item => ({ ...item.data(), id: item.id, uid: item.id }))
      .filter(item => item.active === true && item.id !== user.uid)
      .filter(item => standardTaskDelegateCandidate(item))
      .sort((a, b) => clean(a.fullName).localeCompare(clean(b.fullName), "vi"));
  },

  async saveDelegation({ delegateUserId, startDate, endDate, reason, permissions = ["CREATE_STANDARD_TASKS"] }) {
    const user = UserContext.requireUser();
    if (!Permissions.canDelegateStandardTaskEditor(user)) {
      throw new Error("Chỉ Trưởng/Phụ trách đơn vị được ủy quyền nhập Danh mục công việc.");
    }
    if (!clean(delegateUserId)) throw new Error("Hãy chọn Phó/Nhân viên được ủy quyền.");
    if (!clean(startDate) || !clean(endDate) || startDate > endDate) {
      throw new Error("Thời gian ủy quyền chưa hợp lệ.");
    }
    if (!clean(reason)) throw new Error("Hãy nhập lý do ủy quyền.");
    const normalizedPermissions = [...new Set((permissions || []).map(upper).filter(value => STANDARD_TASK_DELEGATION_PERMISSIONS.includes(value) && value !== "MANAGE_STANDARD_TASKS"))];
    if (!normalizedPermissions.length) throw new Error("Hãy chọn ít nhất một phạm vi quyền được ủy quyền.");

    const departmentId = upper(user.departmentId);
    if (!departmentId || departmentId === "BGD" || departmentId === "CDTN") {
      throw new Error("Ủy quyền nhập danh mục này chỉ áp dụng trong Phòng/Khu chuyên môn.");
    }

    // Preflight từ document users là cùng nguồn mà Firestore Rules sử dụng.
    const currentSnapshot = await FirebaseService.getDoc(FirebaseService.doc(FirebaseService.db, "users", user.uid));
    if (!currentSnapshot.exists()) throw new Error("Không tìm thấy hồ sơ quyền của tài khoản đang đăng nhập.");
    const currentProfileData = currentSnapshot.data();
    const currentProfile = { ...currentProfileData, id: currentSnapshot.id, uid: currentSnapshot.id, approvalAuthorityPresent: Object.prototype.hasOwnProperty.call(currentProfileData, 'approvalAuthority') };
    if (currentProfile.active !== true || upper(currentProfile.departmentId) !== departmentId || !Permissions.isDepartmentHead(currentProfile)) {
      throw new Error("Tài khoản hiện chưa được hệ thống nhận diện là Trưởng/Phụ trách đơn vị. Hãy đồng bộ lại Danh mục tài khoản trước khi ủy quyền.");
    }

    const delegateSnapshot = await FirebaseService.getDoc(FirebaseService.doc(FirebaseService.db, "users", delegateUserId));
    if (!delegateSnapshot.exists()) throw new Error("Không tìm thấy hồ sơ người nhận ủy quyền.");
    const delegateData = delegateSnapshot.data();
    const delegate = { ...delegateData, id: delegateSnapshot.id, uid: delegateSnapshot.id, approvalAuthorityPresent: Object.prototype.hasOwnProperty.call(delegateData, 'approvalAuthority') };
    if (delegate.active !== true) throw new Error("Người nhận ủy quyền đang ở trạng thái không hoạt động.");
    if (upper(delegate.departmentId) !== departmentId) throw new Error("Người nhận ủy quyền phải thuộc cùng Phòng/Khu.");
    if (!standardTaskDelegateCandidate(delegate)) {
      throw new Error("Người nhận phải là Phó Trưởng phòng/Phó Trưởng khu hoặc nhân viên cùng đơn vị.");
    }
    if (delegate.id === user.uid) throw new Error("Không thể tự ủy quyền cho chính mình.");

    const reference = FirebaseService.doc(FirebaseService.db, "approvalDelegations", delegationDocumentId(departmentId));
    let existing = null;
    try {
      existing = await FirebaseService.getDoc(reference);
    } catch (error) {
      // Firestore Rules đọc approvalDelegations dựa trên resource.data. Ở lần ủy quyền đầu tiên,
      // document *_STANDARD_TASK_EDITOR chưa tồn tại nên get() có thể trả permission-denied.
      // Đây là pre-read tùy chọn; quyền CREATE vẫn được Rules kiểm tra chặt khi setDoc().
      if (!isPermissionDenied(error)) throw error;
    }
    const hasExisting = existing?.exists() === true;
    const existingData = hasExisting ? existing.data() : {};
    const legacy = hasExisting && (
      upper(existingData.delegationType) !== "STANDARD_TASK_EDITOR"
      || upper(existingData.departmentId) !== departmentId
      || !Array.isArray(existingData.permissions)
    );

    const payload = {
      schemaVersion: 3,
      delegationType: "STANDARD_TASK_EDITOR",
      departmentId,
      delegatorUserId: user.uid,
      delegatorName: user.fullName || "",
      delegatorRole: user.role || "",
      delegatorPosition: user.position || "",
      delegateUserId: delegate.id,
      delegateName: delegate.fullName || "",
      delegatePosition: delegate.position || "",
      permissions: normalizedPermissions,
      startDate,
      endDate,
      startAt: startOfDay(startDate),
      endAt: endOfDay(endDate),
      reason: clean(reason),
      active: true,
      revokedAt: null,
      revokedByUserId: "",
      revokedByName: "",
      legacyNormalized: legacy,
      legacyNormalizedAt: legacy ? FirebaseService.serverTimestamp() : (existingData.legacyNormalizedAt || null),
      createdAt: hasExisting ? (existingData.createdAt || FirebaseService.serverTimestamp()) : FirebaseService.serverTimestamp(),
      createdBy: hasExisting ? (existingData.createdBy || user.uid) : user.uid,
      updatedAt: FirebaseService.serverTimestamp(),
      updatedBy: user.uid
    };

    await FirebaseService.setDoc(reference, payload, { merge: false });

    const readBack = await FirebaseService.getDoc(reference);
    if (!readBack.exists()) throw new Error("Đã ghi nhưng không đọc lại được hồ sơ ủy quyền.");
    const saved = readBack.data();
    if (
      saved.active !== true
      || saved.delegateUserId !== delegate.id
      || upper(saved.departmentId) !== departmentId
      || !normalizedPermissions.every(permission => (saved.permissions || []).includes(permission))
    ) {
      throw new Error("Hồ sơ ủy quyền sau khi lưu chưa khớp thông tin đã chọn. Vui lòng bấm Cập nhật và thử lại.");
    }
    return { id: readBack.id, ...saved, legacyNormalized: legacy };
  },

  async revokeDelegation() {
    const user = UserContext.requireUser();
    if (!Permissions.canDelegateStandardTaskEditor(user)) {
      throw new Error("Chỉ người có Quyền phê duyệt tại đơn vị được thu hồi ủy quyền.");
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
      throw new Error("Tài khoản không có quyền xóa/gỡ đầu việc khỏi danh mục này.");
    }

    const reference = FirebaseService.doc(FirebaseService.db, STANDARD_TASK_COLLECTION, taskId);

    /*
     * Người quản lý nghiệp vụ luôn gỡ mềm để giữ audit. Không chạy query lịch sử rộng
     * cho non-ADMIN vì phạm vi đọc của HEAD/DEPUTY không bao quát dữ liệu người khác.
     * Chỉ ADMIN mới kiểm tra lịch sử để cân nhắc hard-delete mã chưa từng sử dụng.
     */
    const hasHistory = Permissions.isAdmin(user) ? await taskHasHistory(task) : true;
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
