/** Production 3C - Task Read Service (read only). */
import { FirebaseService } from "../core/firebase-service.js";
import { UserContext } from "../core/user-context.js";
import { Permissions } from "../core/permissions.js";

function uniqueById(items) {
  const map = new Map();
  items.forEach(item => map.set(item.id, item));
  return [...map.values()];
}

function mapSnapshot(snapshot) {
  return snapshot.docs.map(documentSnapshot => ({
    id: documentSnapshot.id,
    ...documentSnapshot.data()
  }));
}

async function runQuery(constraints = []) {
  const reference = FirebaseService.collection(FirebaseService.db, "tasks");
  const builtQuery = constraints.length
    ? FirebaseService.query(reference, ...constraints)
    : reference;
  const snapshot = await FirebaseService.getDocs(builtQuery);
  return mapSnapshot(snapshot);
}

async function loadScopedTasks() {
  const user = UserContext.requireUser();

  if (Permissions.canViewAllDepartments()) {
    return runQuery([]);
  }

  if (Permissions.isDepartmentLeader()) {
    const departmentId = user.departmentId;
    const resultSets = await Promise.all([
      runQuery([FirebaseService.where("primaryDepartmentId", "==", departmentId)]),
      runQuery([FirebaseService.where("visibleDepartmentIds", "array-contains", departmentId)]),
      runQuery([FirebaseService.where("supportDepartmentIds", "array-contains", departmentId)])
    ]);
    return uniqueById(resultSets.flat());
  }

  const resultSets = await Promise.all([
    runQuery([FirebaseService.where("ownerUserId", "==", user.uid)]),
    runQuery([FirebaseService.where("visibleUserIds", "array-contains", user.uid)])
  ]);
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

export const TaskReadService = Object.freeze({
  async list() {
    const tasks = await loadScopedTasks();
    return tasks.map(enrichTask);
  },

  summarize(tasks = []) {
    const all = tasks.map(item => item._status ? item : enrichTask(item));
    return {
      total: all.length,
      completed: all.filter(item => item._completed).length,
      overdue: all.filter(item => item._overdue).length,
      dueSoon: all.filter(item => item._dueSoon).length,
      inProgress: all.filter(item => !item._completed && !item._overdue).length,
      waitingAssignment: all.filter(item => ["CHO_PHAN_CONG", "PENDING_ASSIGNMENT"].includes(item._status)).length
    };
  }
});
