/**
 * Dịch vụ quản lý danh mục công việc chuẩn tại ứng dụng.
 * - Mã đầu việc được cấp tự động, tăng dần theo từng Phòng/Khu hoặc đoàn thể.
 * - Trưởng phòng quản lý danh mục đơn vị mình; có thể ủy quyền cho một nhân viên.
 * - Bí thư/Phó Bí thư Chi đoàn quản lý danh mục CDTN theo vai trò kiêm nhiệm.
 */
import { FirebaseService } from "../core/firebase-service.js?v=20260805.V1_9_3";
import { UserContext } from "../core/user-context.js?v=20260805.V1_9_3";
import { Permissions } from "../core/permissions.js?v=20260805.V1_9_3";

const SYNC_VERSION = "20260805.V1_9_3";
const STANDARD_TASK_COLLECTION = "standardTasks";
const SEQUENCE_COLLECTION = "standardTaskSequences";
const VALID_COEFFICIENTS = Object.freeze([1, 1.1, 1.2]);
const DEPARTMENT_AUDIENCES = Object.freeze(["ALL_DEPARTMENT", "MANAGEMENT"]);
const CDTN_AUDIENCES = Object.freeze(["CDTN_SECRETARY", "CDTN_EXECUTIVE", "CDTN_MEMBER"]);
const TRACKING_MODES = Object.freeze(["FINAL_OUTPUT", "ITEMIZED"]);
const WORK_ITEM_TYPES = Object.freeze(["GENERIC", "DOCUMENT", "QUANTITY", "ATTENDANCE"]);

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
    /* Hỗ trợ cả mã cũ TCHC29 có workType DOT_XUAT và mã chuẩn mới TCHC-DX01. */
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

function normalizeAudienceType(value, departmentId, legacyManagement = false) {
  const department = upper(departmentId);
  const requested = upper(value);
  const allowed = department === "CDTN" ? CDTN_AUDIENCES : DEPARTMENT_AUDIENCES;

  if (allowed.includes(requested)) return requested;
  if (department === "CDTN") return legacyManagement ? "CDTN_SECRETARY" : "CDTN_MEMBER";
  return legacyManagement ? "MANAGEMENT" : "ALL_DEPARTMENT";
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

function canManageDepartment(user, departmentId, delegation = null) {
  const target = upper(departmentId);
  const delegated = delegationIsActive(delegation, user);
  return Permissions.canManageStandardTasks(target, delegated);
}

async function readCdtnDirectoryAccess(user) {
  try {
    const snapshot = await FirebaseService.getDoc(
      FirebaseService.doc(FirebaseService.db, "cdtnMembers", user.uid)
    );
    if (!snapshot.exists()) return { active: false, roles: [], catalogManager: false };
    const data = snapshot.data() || {};
    const roles = Array.isArray(data.additionalRoles)
      ? data.additionalRoles.map(upper)
      : [];
    const catalogManager = data.active === true
      && data.userId === user.uid
      && roles.some(role => ["CDTN_BI_THU", "CDTN_PHO_BI_THU"].includes(role));
    return { active: data.active === true, roles, catalogManager };
  } catch (error) {
    console.warn("Không đọc được danh bạ quyền Chi đoàn; tiếp tục dùng hồ sơ users:", error);
    return { active: false, roles: [], catalogManager: false };
  }
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

function smallestAvailableNumber(usedNumbers, startAt = 1) {
  let candidate = Math.max(1, Math.trunc(Number(startAt || 1)));
  while (usedNumbers.has(candidate)) candidate += 1;
  return candidate;
}

async function observedSequenceState(departmentId, workType = "THUONG_XUYEN") {
  const department = upper(departmentId);
  const normalizedType = normalizeWorkType(workType);
  const items = await listDepartmentTasks(department);
  const usedNumbers = departmentSequenceNumbers(items, department, normalizedType);
  const highestExistingNumber = usedNumbers.size ? Math.max(...usedNumbers) : 0;
  const nextAvailableNumber = highestExistingNumber + 1;
  return { items, usedNumbers, nextAvailableNumber, highestExistingNumber, workType: normalizedType };
}

async function updateSequenceHint(departmentId, user, workType = "THUONG_XUYEN") {
  const department = upper(departmentId);
  const normalizedType = normalizeWorkType(workType);
  const state = await observedSequenceState(department, normalizedType);
  const reference = FirebaseService.doc(
    FirebaseService.db,
    SEQUENCE_COLLECTION,
    department
  );
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

function taskPayload({ data, user, departmentId, code, sequence, existing = false }) {
  const workType = normalizeWorkType(data.workType);
  const baseScore = workType === "DOT_XUAT" ? 12 : 10;
  const difficultyCoefficient = Number(data.difficultyCoefficient || 1);
  const audienceType = normalizeAudienceType(
    data.audienceType,
    departmentId,
    data.isManagementTask === true
  );
  /* audienceType quyết định quyền nhìn thấy/đăng ký. Hai cờ dưới đây chỉ là metadata KPI. */
  const isManagementTask = data.isManagementTask === true;
  const isCoreTaskDefault = data.isCoreTaskDefault === true;
  const maximumConvertedScore = Math.round(baseScore * difficultyCoefficient * 10) / 10;
  const trackingMode = normalizeTrackingMode(data.trackingMode);
  const workItemType = normalizeWorkItemType(data.workItemType, trackingMode);
  const quantityUnit = workItemType === "QUANTITY" ? clean(data.quantityUnit) : "";
  if (workItemType === "QUANTITY" && !quantityUnit) {
    throw new Error("Hãy nhập đơn vị sản lượng, ví dụ: kg rau.");
  }

  return {
    code,
    name: clean(data.name),
    departmentId,
    frequency: clean(data.frequency),
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
    ...(existing ? {} : {
      createdAt: FirebaseService.serverTimestamp(),
      createdByUserId: user.uid,
      createdByName: user.fullName || ""
    })
  };
}

export const StandardTaskWriteService = Object.freeze({
  async getEditorDelegation() {
    const user = UserContext.requireUser();
    const reference = FirebaseService.doc(
      FirebaseService.db,
      "approvalDelegations",
      delegationDocumentId(user.departmentId)
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
      console.warn("Không đọc được ủy quyền nhập danh mục:", error);
    }

    const cdtnDirectory = await readCdtnDirectoryAccess(user);
    const isCdtnCatalogManager = Permissions.isCdtnCatalogManager(user)
      || cdtnDirectory.catalogManager === true;
    const manageableDepartmentIds = [];
    if (canManageDepartment(user, user.departmentId, delegation)) {
      manageableDepartmentIds.push(upper(user.departmentId));
    }
    if (isCdtnCatalogManager && !manageableDepartmentIds.includes("CDTN")) {
      manageableDepartmentIds.push("CDTN");
    }

    return {
      canManage: manageableDepartmentIds.length > 0,
      isDepartmentHead: Permissions.isDepartmentHead(user),
      isCdtnCatalogManager,
      cdtnDirectoryRoles: cdtnDirectory.roles,
      manageableDepartmentIds,
      delegation
    };
  },

  async getNextCode(departmentId, workType = "THUONG_XUYEN") {
    const user = UserContext.requireUser();
    const access = await this.getAccess();
    const department = upper(departmentId || access.manageableDepartmentIds[0]);

    if (!access.manageableDepartmentIds.includes(department)) {
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
    if (!Permissions.isDepartmentHead(user)) return [];
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
    if (!Permissions.isDepartmentHead(user)) {
      throw new Error("Chỉ Trưởng phòng được ủy quyền nhập danh mục công việc.");
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
    if (!Permissions.isDepartmentHead(user)) {
      throw new Error("Chỉ Trưởng phòng được hủy ủy quyền nhập danh mục.");
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

    if (!access.manageableDepartmentIds.includes(departmentId)) {
      throw new Error("Tài khoản không có quyền quản lý danh mục của Phòng/Khu hoặc đoàn thể đã chọn.");
    }

    const name = clean(data.name);
    const difficultyCoefficient = Number(data.difficultyCoefficient || 1);
    if (!name) throw new Error("Tên đầu việc là bắt buộc.");
    if (!clean(data.outputRequirement)) throw new Error("Hãy nhập kết quả đầu ra hoặc yêu cầu hoàn thành.");
    if (!clean(data.frequency)) throw new Error("Hãy nhập chu kỳ hoặc tần suất thực hiện.");
    if (!clean(data.mandatoryEvidence)) throw new Error("Hãy nhập loại minh chứng bắt buộc.");
    if (!VALID_COEFFICIENTS.some(value => Math.abs(value - difficultyCoefficient) < 0.000001)) {
      throw new Error("Hệ số độ khó chỉ được dùng 100%, 110% hoặc 120%.");
    }

    if (existingId) {
      const reference = FirebaseService.doc(FirebaseService.db, STANDARD_TASK_COLLECTION, existingId);
      const snapshot = await FirebaseService.getDoc(reference);
      if (!snapshot.exists()) throw new Error("Đầu việc không còn tồn tại.");
      const existing = snapshot.data() || {};
      if (upper(existing.departmentId) !== departmentId) {
        throw new Error("Không được chuyển đầu việc sang Phòng/Khu khác sau khi đã tạo.");
      }
      const code = normalizedCode(existing.code || existingId);
      const sequence = numericSuffix(code, departmentId) || Number(existing.order || 1);
      await FirebaseService.setDoc(
        reference,
        taskPayload({ data, user, departmentId, code, sequence, existing: true }),
        { merge: true }
      );
      return { documentId: existingId, code, mode: "UPDATED" };
    }

    const workType = normalizeWorkType(data.workType);
    const observedState = await observedSequenceState(departmentId, workType);
    const sequenceReference = FirebaseService.doc(FirebaseService.db, SEQUENCE_COLLECTION, departmentId);

    return FirebaseService.runTransaction(FirebaseService.db, async transaction => {
      const sequenceSnapshot = await transaction.get(sequenceReference);
      const sequenceData = sequenceSnapshot.exists() ? sequenceSnapshot.data() : {};
      const fieldPrefix = workType === "DOT_XUAT" ? "unexpected" : "regular";
      const storedHighest = Number(
        sequenceData?.[`${fieldPrefix}HighestExistingNumber`]
        || sequenceData?.[`${fieldPrefix}LastNumber`]
        || 0
      );
      let sequence = Math.max(observedState.highestExistingNumber, storedHighest) + 1;
      let code = "";
      let reference = null;

      /*
       * Cấp mã tăng dần theo số lớn nhất thực tế/sequence + 1.
       * Không quay lại lấp khoảng trống nên Sheet đang YT06 thì ứng dụng cấp YT07.
       * Transaction vẫn kiểm tra document để tránh hai người tạo trùng đồng thời.
       */
      for (let attempt = 0; attempt < 500; attempt += 1) {
        code = formatTaskCode(departmentId, sequence, workType);
        reference = FirebaseService.doc(FirebaseService.db, STANDARD_TASK_COLLECTION, code);
        const existingSnapshot = await transaction.get(reference);
        if (!existingSnapshot.exists()) break;
        sequence += 1;
        reference = null;
      }

      if (!reference) {
        throw new Error("Không thể cấp mã đầu việc mới. Hãy đồng bộ lại dữ liệu và thử lại.");
      }

      const nextAvailableNumber = sequence + 1;
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
        taskPayload({ data, user, departmentId, code, sequence, existing: false }),
        { merge: false }
      );

      return { documentId: code, code, mode: "CREATED" };
    });
  },

  async removeTask(task) {
    const user = UserContext.requireUser();
    const access = await this.getAccess();
    const taskId = clean(task?.id);
    const departmentId = upper(task?.departmentId);

    if (!taskId || !departmentId) throw new Error("Không xác định được đầu việc cần xóa.");
    if (!access.manageableDepartmentIds.includes(departmentId)) {
      throw new Error("Tài khoản không có quyền xóa đầu việc thuộc danh mục này.");
    }

    const reference = FirebaseService.doc(FirebaseService.db, STANDARD_TASK_COLLECTION, taskId);
    const hasHistory = await taskHasHistory(task);

    if (hasHistory) {
      await FirebaseService.updateDoc(reference, {
        active: false,
        removedFromCatalogAt: FirebaseService.serverTimestamp(),
        removedFromCatalogByUserId: user.uid,
        removedFromCatalogByName: user.fullName || "",
        updatedAt: FirebaseService.serverTimestamp(),
        updatedByUserId: user.uid,
        updatedByName: user.fullName || ""
      });
      return { mode: "ARCHIVED" };
    }

    await FirebaseService.deleteDoc(reference);

    /* Cập nhật gợi ý mã ngay sau khi xóa thật; lỗi cập nhật gợi ý không làm hỏng thao tác xóa. */
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
