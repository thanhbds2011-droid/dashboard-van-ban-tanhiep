/**
 * Nhiều tệp minh chứng cho nhiệm vụ KPI - V1.16.0.
 * Mỗi tệp là một document riêng để có thể bổ sung dần mà không ghi đè tệp cũ.
 */
import { FirebaseService } from "../core/firebase-service.js?v=20260903.V1_22_2";
import { UserContext } from "../core/user-context.js?v=20260903.V1_22_2";
import { Permissions } from "../core/permissions.js?v=20260903.V1_22_2";

const COLLECTION = "taskEvidenceFiles";
export const MAX_EVIDENCE_FILES_PER_TASK = 20;
export const MAX_EVIDENCE_FILES_PER_SELECTION = 10;

const clean = (value, max = 2000) => String(value ?? "").trim().slice(0, max);

function taskDepartmentId(task) {
  return clean(task?.primaryDepartmentId || task?.departmentId, 40).toUpperCase();
}

function mayManage(task) {
  const user = UserContext.requireUser();
  return Boolean(
    task && (
      task.ownerUserId === user.uid
      || Permissions.isAdmin()
      || Permissions.isDirector()
      || (taskDepartmentId(task) === "CDTN" && Permissions.isCdtnLeadership(user))
      || (Permissions.isDepartmentLeader() && taskDepartmentId(task) === clean(user.departmentId, 40).toUpperCase())
    )
  );
}

function scopedQuery(task) {
  const user = UserContext.requireUser();
  if (!task?.id) return null;
  const constraints = [FirebaseService.where("taskId", "==", task.id)];

  if (clean(task.ownerUserId) === clean(user.uid)) {
    constraints.push(FirebaseService.where("ownerUserId", "==", user.uid));
  } else if (Permissions.isAdmin() || Permissions.isDirector()) {
    // Quyền toàn Trung tâm được Rules xác thực trực tiếp.
  } else {
    const departmentId = taskDepartmentId(task);
    if (!departmentId) return null;
    if (departmentId === "CDTN" && Permissions.isCdtnMember(user)) {
      // Thành viên Chi đoàn được đọc nhiệm vụ Chi đoàn; taskId đã giới hạn đúng một nhiệm vụ.
    } else if (departmentId === "CDTN" && Permissions.isDepartmentLeader(user)) {
      constraints.push(FirebaseService.where("homeDepartmentId", "==", clean(user.departmentId, 40).toUpperCase()));
    } else {
      constraints.push(FirebaseService.where("departmentId", "==", departmentId));
    }
  }

  return FirebaseService.query(
    FirebaseService.collection(FirebaseService.db, COLLECTION),
    ...constraints
  );
}

function mapDoc(snapshot) {
  return { id: snapshot.id, ...snapshot.data() };
}

function filePayload(task, uploaded, meta, user) {
  const scopeType = ["TASK", "MILESTONE", "WORK_ITEM"].includes(String(meta?.scopeType || "").toUpperCase())
    ? String(meta.scopeType).toUpperCase()
    : "TASK";
  const scopeId = clean(meta?.scopeId, 200);
  return {
    taskId: task.id,
    taskCode: clean(task.taskCode, 100),
    periodId: clean(task.periodId, 100),
    departmentId: taskDepartmentId(task),
    homeDepartmentId: clean(task?.homeDepartmentId || (taskDepartmentId(task) === "CDTN" ? user.departmentId : taskDepartmentId(task)), 40).toUpperCase(),
    organizationId: taskDepartmentId(task) === "CDTN" ? "CDTN" : "",
    ownerUserId: clean(task.ownerUserId, 200),
    ownerName: clean(task.ownerName, 300),
    scopeType,
    scopeId,
    milestoneId: scopeType === "MILESTONE" ? scopeId : "",
    workItemId: scopeType === "WORK_ITEM" ? scopeId : "",
    fileName: clean(uploaded?.fileName || uploaded?.name, 500),
    fileUrl: clean(uploaded?.fileUrl || uploaded?.evidenceUrl, 2000),
    driveFileId: clean(uploaded?.fileId || uploaded?.storagePath || uploaded?.evidenceStoragePath, 1000),
    mimeType: clean(uploaded?.mimeType || meta?.mimeType, 200),
    fileSize: Math.max(0, Number(uploaded?.uploadedSize || meta?.fileSize || 0)),
    optimized: uploaded?.optimized === true,
    active: true,
    createdAt: FirebaseService.serverTimestamp(),
    createdByUserId: user.uid,
    createdByName: user.fullName || "",
    updatedAt: FirebaseService.serverTimestamp(),
    updatedByUserId: user.uid,
    updatedByName: user.fullName || ""
  };
}

export const TaskEvidenceService = Object.freeze({
  MAX_PER_TASK: MAX_EVIDENCE_FILES_PER_TASK,
  MAX_PER_SELECTION: MAX_EVIDENCE_FILES_PER_SELECTION,
  mayManage,

  async list(task) {
    const queryRef = scopedQuery(task);
    if (!queryRef) return [];
    const snapshot = await FirebaseService.getDocs(queryRef);
    return snapshot.docs
      .map(mapDoc)
      .filter(item => item.active !== false)
      .sort((a, b) => {
        const left = a.createdAt?.toMillis?.() || 0;
        const right = b.createdAt?.toMillis?.() || 0;
        return left - right || clean(a.fileName).localeCompare(clean(b.fileName), "vi");
      });
  },

  async addUploadedFiles(task, uploadedFiles = [], options = {}) {
    const user = UserContext.requireUser();
    if (!mayManage(task)) throw new Error("Tài khoản không có quyền bổ sung minh chứng cho nhiệm vụ này.");
    const candidates = (uploadedFiles || []).filter(item => item?.fileUrl || item?.evidenceUrl);
    if (!candidates.length) return [];
    if (candidates.length > MAX_EVIDENCE_FILES_PER_SELECTION) {
      throw new Error(`Mỗi lần chỉ được bổ sung tối đa ${MAX_EVIDENCE_FILES_PER_SELECTION} tệp.`);
    }

    const existing = Array.isArray(options.existingFiles) ? options.existingFiles : await this.list(task);
    // Retry-safe: nếu nghiệp vụ lưu nhiệm vụ lỗi sau khi record minh chứng đã được ghi,
    // lần bấm Lưu lại không được tạo document trùng cho cùng một file Drive.
    const existingKeys = new Set((existing || []).map(item =>
      clean(item?.driveFileId || item?.fileUrl, 2000)
    ).filter(Boolean));
    const seen = new Set(existingKeys);
    const files = candidates.filter(item => {
      const key = clean(item?.fileId || item?.driveFileId || item?.storagePath || item?.fileUrl || item?.evidenceUrl, 2000);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!files.length) return [];
    if (existing.length + files.length > MAX_EVIDENCE_FILES_PER_TASK) {
      throw new Error(`Mỗi nhiệm vụ được lưu tối đa ${MAX_EVIDENCE_FILES_PER_TASK} tệp minh chứng. Hiện đã có ${existing.length} tệp.`);
    }

    const batch = FirebaseService.writeBatch(FirebaseService.db);
    const records = [];
    for (const uploaded of files) {
      const reference = FirebaseService.doc(FirebaseService.collection(FirebaseService.db, COLLECTION));
      const payload = filePayload(task, uploaded, options, user);
      if (!payload.fileName || !payload.fileUrl) throw new Error("Tệp minh chứng chưa có tên hoặc liên kết Drive hợp lệ.");
      batch.set(reference, payload);
      records.push({ id: reference.id, ...payload });
    }
    await batch.commit();
    return records;
  },

  async remove(task, evidence) {
    const user = UserContext.requireUser();
    if (!mayManage(task)) throw new Error("Tài khoản không có quyền gỡ minh chứng này.");
    if (!evidence?.id) throw new Error("Không xác định được tệp minh chứng cần gỡ.");
    await FirebaseService.updateDoc(
      FirebaseService.doc(FirebaseService.db, COLLECTION, evidence.id),
      {
        active: false,
        removedAt: FirebaseService.serverTimestamp(),
        removedByUserId: user.uid,
        removedByName: user.fullName || "",
        updatedAt: FirebaseService.serverTimestamp(),
        updatedByUserId: user.uid,
        updatedByName: user.fullName || ""
      }
    );
  },

  forScope(files = [], scopeType = "TASK", scopeId = "") {
    const type = String(scopeType || "TASK").toUpperCase();
    const id = clean(scopeId, 200);
    return (files || []).filter(file => file.active !== false && String(file.scopeType || "TASK").toUpperCase() === type && clean(file.scopeId, 200) === id);
  }
});
