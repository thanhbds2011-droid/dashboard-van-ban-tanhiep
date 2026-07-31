/** Quản lý các lượt công việc phát sinh bên trong một nhiệm vụ KPI. */
import { FirebaseService } from "../core/firebase-service.js";
import { UserContext } from "../core/user-context.js";
import { Permissions } from "../core/permissions.js?v=20260731.V1_1_14";

const COLLECTION = "taskWorkItems";
const ALLOWED_RATES = Object.freeze([100, 80, 60, 0]);

function clean(value, maxLength = 3000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function dateKey(value) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
  const date = value?.toDate ? value.toDate() : value instanceof Date ? value : new Date(value);
  if (!date || Number.isNaN(date.getTime())) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function normalizeRate(value) {
  const rate = Number(value);
  return ALLOWED_RATES.includes(rate) ? rate : 0;
}

function mayManage(task) {
  const user = UserContext.requireUser();
  return Boolean(
    task &&
    task.active !== false &&
    (
      task.ownerUserId === user.uid ||
      Permissions.isAdmin() ||
      Permissions.isDirector() ||
      (Permissions.isDepartmentLeader() && String(task.primaryDepartmentId || "") === String(user.departmentId || ""))
    )
  );
}

function mayEditItem(task, item) {
  const user = UserContext.requireUser();
  if (!mayManage(task)) return false;
  if (Permissions.isAdmin() || Permissions.isDirector() || Permissions.isDepartmentLeader()) return true;
  return task.ownerUserId === user.uid && (!item || item.ownerUserId === user.uid);
}

function normalizeItem(snapshot) {
  const data = snapshot.data ? snapshot.data() : snapshot;
  return {
    id: snapshot.id || data.id || "",
    ...data,
    active: data.active !== false,
    title: clean(data.title, 500),
    reference: clean(data.reference, 500),
    assignedByName: clean(data.assignedByName, 300),
    assignedDateKey: dateKey(data.assignedDateKey || data.assignedDate),
    deadlineDateKey: dateKey(data.deadlineDateKey || data.deadlineDate),
    completedDateKey: dateKey(data.completedDateKey || data.completedDate),
    progressRate: normalizeRate(data.progressRate),
    resultRate: normalizeRate(data.resultRate),
    resultNote: clean(data.resultNote, 3000),
    evidenceText: clean(data.evidenceText, 3000)
  };
}

function convertActualRate(actualRate) {
  const value = Math.max(0, Math.min(100, Number(actualRate || 0)));
  if (value >= 100) return 100;
  if (value >= 80) return 80;
  if (value >= 60) return 60;
  return 0;
}

function calculateSummary(items) {
  const activeItems = (items || []).filter(item => item.active !== false);
  const count = activeItems.length;
  if (!count) {
    return {
      count: 0,
      completedCount: 0,
      onTimeCount: 0,
      qualifiedCount: 0,
      actualProgressRate: null,
      actualResultRate: null,
      appliedProgressRate: null,
      appliedResultRate: null,
      readyForAssessment: false
    };
  }

  const completedCount = activeItems.filter(item => Boolean(item.completedDateKey)).length;
  const onTimeCount = activeItems.filter(item => Number(item.progressRate) === 100).length;
  const qualifiedCount = activeItems.filter(item => Number(item.resultRate) >= 80).length;
  const actualProgressRate = Math.round(
    activeItems.reduce((sum, item) => sum + normalizeRate(item.progressRate), 0) / count * 100
  ) / 100;
  const actualResultRate = Math.round(
    activeItems.reduce((sum, item) => sum + normalizeRate(item.resultRate), 0) / count * 100
  ) / 100;

  return {
    count,
    completedCount,
    onTimeCount,
    qualifiedCount,
    actualProgressRate,
    actualResultRate,
    appliedProgressRate: convertActualRate(actualProgressRate),
    appliedResultRate: convertActualRate(actualResultRate),
    readyForAssessment: completedCount === count
  };
}

export const TaskWorkItemService = Object.freeze({
  TRACKING_MODE_ITEMIZED: "ITEMIZED",
  TRACKING_MODE_FINAL_OUTPUT: "FINAL_OUTPUT",
  ALLOWED_RATES,
  mayManage,
  mayEditItem,
  convertActualRate,
  calculateSummary,

  async list(taskId) {
    if (!taskId) return [];
    const snapshot = await FirebaseService.getDocs(
      FirebaseService.query(
        FirebaseService.collection(FirebaseService.db, COLLECTION),
        FirebaseService.where("taskId", "==", taskId)
      )
    );
    return snapshot.docs
      .map(normalizeItem)
      .filter(item => item.active !== false)
      .sort((a, b) => {
        const first = String(a.assignedDateKey || a.deadlineDateKey || "");
        const second = String(b.assignedDateKey || b.deadlineDateKey || "");
        return first.localeCompare(second) || String(a.title).localeCompare(String(b.title), "vi");
      });
  },

  async save(task, data, existingItem = null) {
    const user = UserContext.requireUser();
    if (!mayEditItem(task, existingItem)) {
      throw new Error("Tài khoản không có quyền cập nhật công việc phát sinh này.");
    }

    const title = clean(data.title, 500);
    const assignedDateKey = dateKey(data.assignedDateKey);
    const deadlineDateKey = dateKey(data.deadlineDateKey);
    const completedDateKey = dateKey(data.completedDateKey);
    if (!title) throw new Error("Hãy nhập nội dung công việc được giao.");
    if (!assignedDateKey) throw new Error("Hãy chọn ngày giao.");
    if (!deadlineDateKey) throw new Error("Hãy chọn hạn hoàn thành.");
    if (completedDateKey && completedDateKey < assignedDateKey) {
      throw new Error("Ngày hoàn thành không được trước ngày giao.");
    }

    const reference = existingItem?.id
      ? FirebaseService.doc(FirebaseService.db, COLLECTION, existingItem.id)
      : FirebaseService.doc(FirebaseService.collection(FirebaseService.db, COLLECTION));

    const payload = {
      taskId: task.id,
      taskCode: task.taskCode || "",
      periodId: task.periodId || "",
      departmentId: task.primaryDepartmentId || "",
      ownerUserId: task.ownerUserId || "",
      ownerName: task.ownerName || "",
      title,
      reference: clean(data.reference, 500),
      assignedByName: clean(data.assignedByName || user.fullName, 300),
      assignedDateKey,
      deadlineDateKey,
      completedDateKey,
      progressRate: normalizeRate(data.progressRate),
      resultRate: normalizeRate(data.resultRate),
      resultNote: clean(data.resultNote, 3000),
      evidenceText: clean(data.evidenceText, 3000),
      active: true,
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: user.uid,
      updatedByName: user.fullName || "",
      ...(existingItem?.id ? {} : {
        createdAt: FirebaseService.serverTimestamp(),
        createdByUserId: user.uid,
        createdByName: user.fullName || ""
      })
    };

    await FirebaseService.setDoc(reference, payload, { merge: true });
    return { id: reference.id, ...payload };
  },

  async remove(task, item) {
    const user = UserContext.requireUser();
    if (!mayEditItem(task, item)) {
      throw new Error("Tài khoản không có quyền xóa công việc phát sinh này.");
    }
    await FirebaseService.updateDoc(
      FirebaseService.doc(FirebaseService.db, COLLECTION, item.id),
      {
        active: false,
        deletedAt: FirebaseService.serverTimestamp(),
        deletedByUserId: user.uid,
        deletedByName: user.fullName || "",
        updatedAt: FirebaseService.serverTimestamp(),
        updatedByUserId: user.uid,
        updatedByName: user.fullName || ""
      }
    );
  }
});
