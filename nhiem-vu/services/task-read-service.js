/** Dịch vụ đọc nhiệm vụ theo đúng phạm vi tài khoản. */
import { FirebaseService } from "../core/firebase-service.js";
import { UserContext } from "../core/user-context.js";
import { Permissions } from "../core/permissions.js";

function uniqueById(items) {
  const map = new Map();
  items.forEach(item => map.set(item.id, item));
  return [...map.values()];
}

function isActiveTask(task) {
  const status = String(task?.status || "").trim().toUpperCase();
  return task?.active !== false && !["HUY", "CANCELLED", "DELETED"].includes(status);
}

function mapSnapshot(snapshot) {
  return snapshot.docs
    .map(documentSnapshot => ({
      id: documentSnapshot.id,
      ...documentSnapshot.data()
    }))
    .filter(isActiveTask);
}

function scopedReferences() {
  const user = UserContext.requireUser();
  const reference = FirebaseService.collection(FirebaseService.db, "tasks");

  if (Permissions.canViewAllDepartments()) {
    return [reference];
  }

  if (Permissions.isDepartmentLeader()) {
    const departmentId = user.departmentId;
    return [
      FirebaseService.query(reference, FirebaseService.where("primaryDepartmentId", "==", departmentId)),
      FirebaseService.query(reference, FirebaseService.where("visibleDepartmentIds", "array-contains", departmentId)),
      FirebaseService.query(reference, FirebaseService.where("supportDepartmentIds", "array-contains", departmentId))
    ];
  }

  return [
    FirebaseService.query(reference, FirebaseService.where("ownerUserId", "==", user.uid))
  ];
}

async function runReference(reference) {
  const snapshot = await FirebaseService.getDocs(reference);
  return mapSnapshot(snapshot);
}

async function loadScopedTasks() {
  const resultSets = await Promise.all(scopedReferences().map(runReference));
  return uniqueById(resultSets.flat());
}

function timestampToDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function taskStatus(task) {
  return String(task.status || task.assignmentStatus || "").trim().toUpperCase();
}

function isCompleted(task) {
  return ["HOAN_THANH", "COMPLETED", "DA_HOAN_THANH"].includes(taskStatus(task)) || Boolean(task.completedAt);
}

function deadlineOf(task) {
  return timestampToDate(task.deadline) || timestampToDate(task.dueDate) || timestampToDate(task.endDate);
}

function enrichTask(task) {
  const deadline = deadlineOf(task);
  const completed = isCompleted(task);
  const now = new Date();
  const hoursToDeadline = deadline ? (deadline.getTime() - now.getTime()) / 36e5 : null;
  return {
    ...task,
    _status: taskStatus(task),
    _deadline: deadline,
    _completed: completed,
    _overdue: Boolean(deadline && !completed && hoursToDeadline < 0),
    _dueSoon: Boolean(deadline && !completed && hoursToDeadline >= 0 && hoursToDeadline <= 72)
  };
}

function subscribeScopedTasks(onData, onError) {
  if (typeof onData !== "function") throw new Error("Thiếu hàm nhận dữ liệu nhiệm vụ.");

  const references = scopedReferences();
  const stores = references.map(() => new Map());
  const initialized = references.map(() => false);
  let active = true;

  const emit = () => {
    if (!active || initialized.some(value => value !== true)) return;
    const merged = uniqueById(stores.flatMap(store => [...store.values()])).map(enrichTask);
    onData(merged);
  };

  const unsubscribers = references.map((reference, index) => FirebaseService.onSnapshot(
    reference,
    snapshot => {
      stores[index] = new Map(mapSnapshot(snapshot).map(item => [item.id, item]));
      initialized[index] = true;
      emit();
    },
    error => {
      console.error("Không thể theo dõi nhiệm vụ theo thời gian thực:", error);
      onError?.(error);
    }
  ));

  return () => {
    active = false;
    unsubscribers.forEach(unsubscribe => {
      try { unsubscribe?.(); } catch (_) { /* Không cần xử lý khi đóng màn hình. */ }
    });
  };
}

export const TaskReadService = Object.freeze({
  async list() {
    const tasks = await loadScopedTasks();
    return tasks.map(enrichTask);
  },

  subscribe(onData, onError) {
    return subscribeScopedTasks(onData, onError);
  },

  summarize(tasks = []) {
    const all = tasks.map(item => item._status ? item : enrichTask(item));
    return {
      total: all.length,
      completed: all.filter(item => item._completed).length,
      overdue: all.filter(item => item._overdue).length,
      dueSoon: all.filter(item => item._dueSoon).length,
      inProgress: all.filter(item => !item._completed && !item._overdue && !["CHO_PHAN_CONG", "PENDING_ASSIGNMENT", "MOI_TIEP_NHAN"].includes(item._status)).length,
      waitingAssignment: all.filter(item => ["CHO_PHAN_CONG", "PENDING_ASSIGNMENT", "MOI_TIEP_NHAN"].includes(item._status)).length
    };
  }
});
