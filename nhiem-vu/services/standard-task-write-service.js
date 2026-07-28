/**
 * Dịch vụ quản lý danh mục công việc chuẩn tại ứng dụng.
 * Trưởng phòng quản lý trực tiếp hoặc ủy quyền cho một nhân viên cùng Phòng/Khu.
 */
import { FirebaseService } from "../core/firebase-service.js";
import { UserContext } from "../core/user-context.js";
import { Permissions } from "../core/permissions.js?v=20260728.V1_1_4";

function clean(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return clean(value).toUpperCase();
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

function taskDocumentId(departmentId, code) {
  const safeCode = upper(code)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/Đ/g, "D")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${upper(departmentId)}_${safeCode}`;
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
    const departmentId = upper(user.departmentId);
    const code = upper(data.code);
    const name = clean(data.name);
    const baseScore = Number(data.baseScore);
    const difficultyCoefficient = Number(data.difficultyCoefficient);
    const order = Number(data.order || 9999);

    if (!code || !name) throw new Error("Mã đầu việc và tên đầu việc là bắt buộc.");
    if (!(baseScore > 0)) throw new Error("Điểm chuẩn phải lớn hơn 0.");
    if (!(difficultyCoefficient > 0)) throw new Error("Hệ số khó phải lớn hơn 0.");

    const documentId = existingId || taskDocumentId(departmentId, code);
    const reference = FirebaseService.doc(FirebaseService.db, "standardTasks", documentId);
    if (!existingId) {
      const duplicate = await FirebaseService.getDoc(reference);
      if (duplicate.exists()) throw new Error("Mã đầu việc đã tồn tại trong Phòng/Khu.");
    }

    const maximumConvertedScore = Math.round(baseScore * difficultyCoefficient * 100) / 100;
    await FirebaseService.setDoc(reference, {
      code,
      name,
      departmentId,
      workType: upper(data.workType || "THUONG_XUYEN"),
      outputRequirement: clean(data.outputRequirement),
      mandatoryEvidence: clean(data.mandatoryEvidence),
      baseScore,
      difficultyCoefficient,
      maximumConvertedScore,
      order: Number.isFinite(order) ? order : 9999,
      active: data.active !== false,
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: user.uid,
      updatedByName: user.fullName || "",
      ...(existingId ? {} : {
        createdAt: FirebaseService.serverTimestamp(),
        createdByUserId: user.uid,
        createdByName: user.fullName || ""
      })
    }, { merge: true });

    return documentId;
  },

  async deactivateTask(taskId) {
    const user = UserContext.requireUser();
    if (!clean(taskId)) throw new Error("Không xác định được đầu việc cần ngừng sử dụng.");
    await FirebaseService.updateDoc(
      FirebaseService.doc(FirebaseService.db, "standardTasks", taskId),
      {
        active: false,
        deactivatedAt: FirebaseService.serverTimestamp(),
        deactivatedByUserId: user.uid,
        deactivatedByName: user.fullName || "",
        updatedAt: FirebaseService.serverTimestamp(),
        updatedByUserId: user.uid,
        updatedByName: user.fullName || ""
      }
    );
  },

  todayKey: dateKey
});
