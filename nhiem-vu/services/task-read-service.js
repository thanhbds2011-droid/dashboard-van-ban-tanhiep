/** Đọc nhiệm vụ theo kỳ hiện hành, phạm vi tài khoản và bộ nhớ đệm ngắn. */
import { FirebaseService } from "../core/firebase-service.js?v=20260826.V1_18_1";
import { UserContext } from "../core/user-context.js?v=20260826.V1_18_1";
import { Permissions } from "../core/permissions.js?v=20260826.V1_18_1";
import { PeriodReadService } from "./period-read-service.js?v=20260826.V1_18_1";

const TASK_CACHE_MS = 2 * 60 * 1000;
const PROFESSIONAL_DEPARTMENT_IDS = Object.freeze(["BGD", "TCHC", "CTXH", "KHTC", "YT", "KI", "KII", "KIII"]);
let taskCache = { key: "", items: [], loadedAt: 0, period: null };
let taskRequest = null;

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
    .map(documentSnapshot => ({ id: documentSnapshot.id, ...documentSnapshot.data() }))
    .filter(isActiveTask);
}

function scopedReferences(periodId) {
  const user = UserContext.requireUser();
  const reference = FirebaseService.collection(FirebaseService.db, "tasks");
  const periodFilter = FirebaseService.where("periodId", "==", periodId);

  if (Permissions.canViewAllScopes()) {
    return [FirebaseService.query(reference, periodFilter, FirebaseService.limit(5000))];
  }

  if (Permissions.canViewAllDepartments()) {
    const references = [FirebaseService.query(
      reference,
      periodFilter,
      FirebaseService.where("primaryDepartmentId", "in", PROFESSIONAL_DEPARTMENT_IDS),
      FirebaseService.limit(5000)
    )];
    /* Scope Chi đoàn độc lập: chỉ tải thêm khi chính tài khoản có vai trò Chi đoàn. */
    if (Permissions.isCdtnMember()) {
      references.push(
        FirebaseService.query(reference, periodFilter, FirebaseService.where("primaryDepartmentId", "==", "CDTN"), FirebaseService.limit(1000)),
        FirebaseService.query(reference, periodFilter, FirebaseService.where("organizationId", "==", "CDTN"), FirebaseService.limit(1000))
      );
    }
    return references;
  }

  if (Permissions.isDepartmentLeader()) {
    const departmentId = user.departmentId;
    const references = [
      FirebaseService.query(
        reference,
        periodFilter,
        FirebaseService.where("primaryDepartmentId", "==", departmentId),
        FirebaseService.limit(1000)
      ),
      FirebaseService.query(
        reference,
        periodFilter,
        FirebaseService.where("homeDepartmentId", "==", departmentId),
        FirebaseService.limit(1000)
      ),
      FirebaseService.query(
        reference,
        periodFilter,
        FirebaseService.where("visibleDepartmentIds", "array-contains", departmentId),
        FirebaseService.limit(1000)
      ),
      /* Tương thích nhiệm vụ cũ do Ban Giám đốc giao có thể chỉ lưu phòng phối hợp/liên quan. */
      FirebaseService.query(
        reference,
        periodFilter,
        FirebaseService.where("supportDepartmentIds", "array-contains", departmentId),
        FirebaseService.limit(1000)
      ),
      FirebaseService.query(
        reference,
        periodFilter,
        FirebaseService.where("relatedDepartmentIds", "array-contains", departmentId),
        FirebaseService.limit(1000)
      )
    ];
    /*
     * V1.12.0: Không query CDTN cho mọi Trưởng/Phó Phòng/Khu.
     * Firestore Rules chỉ cho thành viên/ban chấp hành Chi đoàn đọc scope này.
     * Việc query thừa trước đây tạo permission-denied hàng loạt khi nhiều tài khoản cùng test.
     */
    if (Permissions.isCdtnMember()) {
      references.push(
        FirebaseService.query(reference, periodFilter, FirebaseService.where("primaryDepartmentId", "==", "CDTN"), FirebaseService.limit(1000)),
        FirebaseService.query(reference, periodFilter, FirebaseService.where("organizationId", "==", "CDTN"), FirebaseService.limit(1000))
      );
    }
    return references;
  }

  const references = [
    FirebaseService.query(
      reference,
      periodFilter,
      FirebaseService.where("ownerUserId", "==", user.uid),
      FirebaseService.limit(300)
    )
  ];
  if (Permissions.isCdtnMember()) {
    references.push(
      FirebaseService.query(reference, periodFilter, FirebaseService.where("primaryDepartmentId", "==", "CDTN"), FirebaseService.limit(1000)),
      FirebaseService.query(reference, periodFilter, FirebaseService.where("organizationId", "==", "CDTN"), FirebaseService.limit(1000))
    );
  }
  return references;
}

function cacheKey(periodId) {
  const user = UserContext.requireUser();
  return [user.uid, user.role, user.departmentId, periodId].join("|");
}

async function runReference(reference) {
  const snapshot = await FirebaseService.getDocs(reference);
  return mapSnapshot(snapshot);
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
  const exempt = String(task?.scoringStatus || "").trim().toUpperCase() === "ADJUSTMENT_EXEMPT";
  const adjustmentPending = String(task?.adjustmentStatus || "").trim().toUpperCase() === "REQUESTED";
  const now = new Date();
  const hoursToDeadline = deadline ? (deadline.getTime() - now.getTime()) / 36e5 : null;
  return {
    ...task,
    _status: taskStatus(task),
    _deadline: deadline,
    _completed: completed,
    _exempt: exempt,
    _adjustmentPending: adjustmentPending,
    _overdue: Boolean(deadline && !completed && !exempt && hoursToDeadline < 0),
    _dueSoon: Boolean(deadline && !completed && !exempt && hoursToDeadline >= 0 && hoursToDeadline <= 72)
  };
}

async function loadScopedTasks(options = {}) {
  const force = options.force === true;
  const period = await PeriodReadService.getActive({ force });
  if (!period?.id) {
    taskCache = { key: "NO_ACTIVE_PERIOD", items: [], loadedAt: Date.now(), period: null };
    return [];
  }

  const key = cacheKey(period.id);
  if (!force && taskCache.key === key && Date.now() - taskCache.loadedAt < TASK_CACHE_MS) {
    return taskCache.items;
  }
  if (!force && taskRequest?.key === key) return taskRequest.promise;

  const promise = (async () => {
    const results = await Promise.allSettled(scopedReferences(period.id).map(runReference));
    const resultSets = results.filter(result => result.status === "fulfilled").map(result => result.value);
    results.filter(result => result.status === "rejected").forEach((result, index) => {
      console.warn(`Không tải được nhánh nhiệm vụ ${index + 1}; tiếp tục với nhánh còn lại:`, result.reason);
    });
    if (!resultSets.length) throw results.find(result => result.status === "rejected")?.reason || new Error("Không tải được nhiệm vụ.");
    const items = uniqueById(resultSets.flat()).map(enrichTask);
    taskCache = { key, items, loadedAt: Date.now(), period };
    return items;
  })();
  taskRequest = { key, promise };

  try {
    return await promise;
  } finally {
    if (taskRequest?.promise === promise) taskRequest = null;
  }
}

function subscribeScopedTasks(onData, onError, options = {}) {
  if (typeof onData !== "function") throw new Error("Thiếu hàm nhận dữ liệu nhiệm vụ.");
  let cancelled = false;
  let unsubscribeAll = () => {};
  let startTimer = null;
  const startDelayMs = Math.max(0, Number(options.startDelayMs || 0));
  const jitterMs = Math.max(0, Number(options.jitterMs || 0));

  PeriodReadService.getActive().then(period => {
    if (cancelled) return;
    if (!period?.id) {
      onData([]);
      return;
    }

    const begin = () => {
      if (cancelled) return;
      const references = scopedReferences(period.id);
    const stores = references.map(() => new Map());
    const initialized = references.map(() => false);
    const failed = references.map(() => false);
    const emit = () => {
      if (cancelled || initialized.some(value => value !== true)) return;
      if (failed.every(Boolean)) {
        onError?.(new Error("Không thể theo dõi bất kỳ nhánh nhiệm vụ nào."));
        return;
      }
      const merged = uniqueById(stores.flatMap(store => [...store.values()])).map(enrichTask);
      taskCache = { key: cacheKey(period.id), items: merged, loadedAt: Date.now(), period };
      onData(merged);
    };
    const unsubscribers = references.map((reference, index) => FirebaseService.onSnapshot(
      reference,
      snapshot => {
        stores[index] = new Map(mapSnapshot(snapshot).map(item => [item.id, item]));
        initialized[index] = true;
        failed[index] = false;
        emit();
      },
      error => {
        console.warn(`Không thể theo dõi nhánh nhiệm vụ ${index + 1}; tiếp tục với nhánh còn lại:`, error);
        stores[index] = new Map();
        initialized[index] = true;
        failed[index] = true;
        emit();
      }
    ));
      unsubscribeAll = () => unsubscribers.forEach(unsubscribe => {
        try { unsubscribe?.(); } catch (_) { /* Đóng listener an toàn. */ }
      });
    };

    const delay = startDelayMs + (jitterMs ? Math.floor(Math.random() * jitterMs) : 0);
    if (delay > 0) startTimer = window.setTimeout(begin, delay);
    else begin();
  }).catch(error => onError?.(error));

  return () => {
    cancelled = true;
    if (startTimer) window.clearTimeout(startTimer);
    startTimer = null;
    unsubscribeAll();
  };
}

export const TaskReadService = Object.freeze({
  async list(options = {}) {
    return loadScopedTasks(options);
  },

  currentPeriod() {
    return taskCache.period;
  },

  invalidate() {
    taskCache = { key: "", items: [], loadedAt: 0, period: null };
    taskRequest = null;
  },

  subscribe(onData, onError, options = {}) {
    return subscribeScopedTasks(onData, onError, options);
  },

  summarize(tasks = []) {
    const all = tasks.map(item => item._status ? item : enrichTask(item));
    return {
      total: all.length,
      completed: all.filter(item => item._completed).length,
      overdue: all.filter(item => item._overdue).length,
      dueSoon: all.filter(item => item._dueSoon).length,
      inProgress: all.filter(item => !item._completed && !item._exempt && !item._overdue && !["CHO_PHAN_CONG", "PENDING_ASSIGNMENT", "MOI_TIEP_NHAN"].includes(item._status)).length,
      waitingAssignment: all.filter(item => !item._exempt && ["CHO_PHAN_CONG", "PENDING_ASSIGNMENT", "MOI_TIEP_NHAN"].includes(item._status)).length,
      adjustmentPending: all.filter(item => item._adjustmentPending).length,
      exempt: all.filter(item => item._exempt).length
    };
  }
});
