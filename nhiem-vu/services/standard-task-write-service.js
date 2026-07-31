/**
 * Dịch vụ quản lý danh mục công việc chuẩn tại ứng dụng.
 * Trưởng phòng quản lý trực tiếp hoặc ủy quyền cho một nhân viên cùng Phòng/Khu.
 */
import { FirebaseService } from "../core/firebase-service.js";
import { UserContext } from "../core/user-context.js";
import { Permissions } from "../core/permissions.js?v=20260731.V1_1_13";

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
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
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

/*
 * Document ID chuẩn là chính mã đầu việc, ví dụ TCHC29.
 * Các bản cũ từng dùng dạng TCHC_TCHC29 vẫn được đọc và chỉnh sửa bằng existingId.
 */
function taskDocumentId(code) {
  return normalizedCode(code);
}

function legacyTaskDocumentId(departmentId, code) {
  return `${upper(departmentId)}_${taskDocumentId(code)}`;
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
    if (Permissions.isDepartmentHead(user)) {
      return { canManage: true, isDepartmentHead: true, delegation };
    }
    return {
      canManage: Permissions.canManageStandardTasks(delegationIsActive(delegation, user)),
      isDepartmentHead: false,
      delegation
    };
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
    if (!access.canManage) throw new Error("Tài khoản không có quyền quản lý danh mục công việc.");

    const departmentId = upper(user.departmentId);
    const code = taskDocumentId(data.code);
    const name = clean(data.name);
    const baseScore = Number(data.baseScore);
    const difficultyCoefficient = Number(data.difficultyCoefficient);
    const order = Number(data.order || 9999);
    const workType = upper(data.workType || "THUONG_XUYEN") === "DOT_XUAT"
      ? "DOT_XUAT"
      : "THUONG_XUYEN";

    if (!code || !name) throw new Error("Mã đầu việc và tên đầu việc là bắt buộc.");
    if (!code.startsWith(departmentId)) {
      throw new Error(`Mã đầu việc phải bắt đầu bằng mã Phòng/Khu ${departmentId}, ví dụ ${departmentId}01.`);
    }
    if (!(baseScore > 0)) throw new Error("Điểm chuẩn phải lớn hơn 0.");
    if (![1, 1.1, 1.2].some(value => Math.abs(value - difficultyCoefficient) < 0.000001)) {
      throw new Error("Hệ số độ khó chỉ được dùng 100%, 110% hoặc 120%.");
    }

    const documentId = existingId || taskDocumentId(code);
    const reference = FirebaseService.doc(FirebaseService.db, "standardTasks", documentId);
    if (!existingId) {
      const [duplicate, legacyDuplicate] = await Promise.all([
        FirebaseService.getDoc(reference),
        FirebaseService.getDoc(
          FirebaseService.doc(FirebaseService.db, "standardTasks", legacyTaskDocumentId(departmentId, code))
        )
      ]);
      if (duplicate.exists() || legacyDuplicate.exists()) {
        throw new Error("Mã đầu việc đã tồn tại trong Phòng/Khu.");
      }
    }

    const maximumConvertedScore = Math.round(baseScore * difficultyCoefficient * 10) / 10;
    await FirebaseService.setDoc(reference, {
      code,
      name,
      departmentId,
      frequency: clean(data.frequency),
      workType,
      outputRequirement: clean(data.outputRequirement),
      mandatoryEvidence: clean(data.mandatoryEvidence),
      arisingEvidence: clean(data.arisingEvidence),
      baseScore,
      difficultyCoefficient,
      maximumConvertedScore,
      isCoreTaskDefault: data.isCoreTaskDefault === true,
      isManagementTask: data.isManagementTask === true,
      order: Number.isFinite(order) && order > 0 ? Math.trunc(order) : 9999,
      active: true,
      syncSource: "WEB_APP_STANDARD_TASKS",
      syncVersion: "20260731.V1_1_13",
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: user.uid,
      updatedByName: user.fullName || "",
      ...(existingId ? {} : {
        createdAt: FirebaseService.serverTimestamp(),
        createdByUserId: user.uid,
        createdByName: user.fullName || ""
      })
    }, { merge: true });

    return { documentId, code, mode: existingId ? "UPDATED" : "CREATED" };
  },

  async removeTask(task) {
    const user = UserContext.requireUser();
    const access = await this.getAccess();
    if (!access.canManage) throw new Error("Tài khoản không có quyền xóa danh mục công việc.");

    const taskId = clean(task?.id);
    const departmentId = upper(task?.departmentId);
    if (!taskId || !departmentId) throw new Error("Không xác định được đầu việc cần xóa.");
    if (departmentId !== upper(user.departmentId)) {
      throw new Error("Chỉ được xóa đầu việc thuộc đúng Phòng/Khu của tài khoản.");
    }

    const reference = FirebaseService.doc(FirebaseService.db, "standardTasks", taskId);
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
    return { mode: "DELETED" };
  },

  todayKey: dateKey
});
