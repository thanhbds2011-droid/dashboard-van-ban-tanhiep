/** Quản lý các lượt công việc phát sinh bên trong một nhiệm vụ KPI. */
import { FirebaseService } from "../core/firebase-service.js";
import { UserContext } from "../core/user-context.js";
import { Permissions } from "../core/permissions.js?v=20260731.V1_1_18";
import { progressRateFromDates } from "../kpi-engine.js?v=20260731.V1_1_18";

const COLLECTION = "taskWorkItems";
const ALLOWED_RATES = Object.freeze([100, 80, 60, 0]);
const WORK_ITEM_TYPES = Object.freeze({
  GENERIC: "GENERIC",
  DOCUMENT: "DOCUMENT",
  QUANTITY: "QUANTITY",
  ATTENDANCE: "ATTENDANCE"
});
const ATTENDANCE_STATUSES = Object.freeze(["PRESENT", "EXCUSED", "ABSENT"]);

function clean(value, maxLength = 3000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
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

function monthKey(value) {
  const normalized = clean(value, 7);
  return /^\d{4}-\d{2}$/.test(normalized) ? normalized : "";
}

function normalizeRate(value) {
  const rate = Number(value);
  return ALLOWED_RATES.includes(rate) ? rate : 0;
}

function normalizeWorkItemType(value) {
  const type = clean(value, 30).toUpperCase();
  return Object.hasOwn(WORK_ITEM_TYPES, type) ? type : WORK_ITEM_TYPES.GENERIC;
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

function inferredProgressRate(data) {
  if (!data.completedDateKey || !data.deadlineDateKey) return 0;
  return normalizeRate(progressRateFromDates(
    `${data.deadlineDateKey}T23:59:59`,
    `${data.completedDateKey}T23:59:59`,
    true
  ));
}

function normalizeItem(snapshot) {
  const data = snapshot.data ? snapshot.data() : snapshot;
  const workItemType = normalizeWorkItemType(data.workItemType);
  const normalized = {
    id: snapshot.id || data.id || "",
    ...data,
    active: data.active !== false,
    workItemType,
    title: clean(data.title, 500),
    reference: clean(data.reference, 500),
    assignedByName: clean(data.assignedByName, 300),
    assignedDateKey: dateKey(data.assignedDateKey || data.assignedDate),
    deadlineDateKey: dateKey(data.deadlineDateKey || data.deadlineDate),
    completedDateKey: dateKey(data.completedDateKey || data.completedDate),
    reportingPeriod: monthKey(data.reportingPeriod),
    productName: clean(data.productName, 300),
    quantityUnit: clean(data.quantityUnit, 80),
    plannedQuantity: Math.max(0, finiteNumber(data.plannedQuantity)),
    actualQuantity: Math.max(0, finiteNumber(data.actualQuantity)),
    sessionDateKey: dateKey(data.sessionDateKey),
    attendanceStatus: ATTENDANCE_STATUSES.includes(String(data.attendanceStatus || "").toUpperCase())
      ? String(data.attendanceStatus).toUpperCase()
      : "",
    participationNote: clean(data.participationNote, 1000),
    progressRate: normalizeRate(data.progressRate),
    resultRate: normalizeRate(data.resultRate),
    resultNote: clean(data.resultNote, 3000),
    evidenceText: clean(data.evidenceText, 3000),
    evidenceUrl: clean(data.evidenceUrl, 2000),
    evidenceFileName: clean(data.evidenceFileName, 500),
    evidenceStoragePath: clean(data.evidenceStoragePath, 1000)
  };

  if (workItemType !== WORK_ITEM_TYPES.ATTENDANCE) {
    normalized.progressRate = inferredProgressRate(normalized);
  }
  return normalized;
}

function convertActualRate(actualRate) {
  const value = Math.max(0, Math.min(100, Number(actualRate || 0)));
  if (value >= 100) return 100;
  if (value >= 80) return 80;
  if (value >= 60) return 60;
  return 0;
}

/**
 * N = tổng lượt hợp lệ; T = lượt đúng hạn/đã tham dự; K = lượt đạt yêu cầu.
 * Tỷ lệ thực tế bắt buộc tính theo T/N và K/N, không lấy trung bình mức điểm từng lượt.
 */
function calculateSummary(items, requestedType = "") {
  const activeItems = (items || []).filter(item => item.active !== false);
  const count = activeItems.length;
  const workItemType = normalizeWorkItemType(
    requestedType || activeItems[0]?.workItemType || WORK_ITEM_TYPES.GENERIC
  );

  if (!count) {
    return {
      workItemType,
      count: 0,
      completedCount: 0,
      onTimeCount: 0,
      qualifiedCount: 0,
      actualProgressRate: null,
      actualResultRate: null,
      appliedProgressRate: null,
      appliedResultRate: null,
      readyForAssessment: false,
      totalPlannedQuantity: 0,
      totalActualQuantity: 0,
      presentCount: 0,
      excusedCount: 0,
      absentCount: 0
    };
  }

  let completedCount = 0;
  let onTimeCount = 0;
  let qualifiedCount = 0;
  let presentCount = 0;
  let excusedCount = 0;
  let absentCount = 0;

  const totalPlannedQuantity = activeItems.reduce(
    (sum, item) => sum + Math.max(0, finiteNumber(item.plannedQuantity)),
    0
  );
  const totalActualQuantity = activeItems.reduce(
    (sum, item) => sum + Math.max(0, finiteNumber(item.actualQuantity)),
    0
  );

  for (const item of activeItems) {
    if (workItemType === WORK_ITEM_TYPES.ATTENDANCE) {
      const status = String(item.attendanceStatus || "").toUpperCase();
      const recorded = ATTENDANCE_STATUSES.includes(status);
      if (recorded) completedCount += 1;
      if (status === "PRESENT") {
        presentCount += 1;
        onTimeCount += 1;
        if (normalizeRate(item.resultRate) >= 80) qualifiedCount += 1;
      } else if (status === "EXCUSED") {
        excusedCount += 1;
      } else if (status === "ABSENT") {
        absentCount += 1;
      }
      continue;
    }

    const completed = Boolean(item.completedDateKey);
    if (completed) completedCount += 1;
    if (completed && item.deadlineDateKey && item.completedDateKey <= item.deadlineDateKey) {
      onTimeCount += 1;
    }

    if (completed && normalizeRate(item.resultRate) >= 80) {
      if (workItemType !== WORK_ITEM_TYPES.QUANTITY) {
        qualifiedCount += 1;
      } else {
        const planned = Math.max(0, finiteNumber(item.plannedQuantity));
        const actual = Math.max(0, finiteNumber(item.actualQuantity));
        if (planned <= 0 || actual >= planned) qualifiedCount += 1;
      }
    }
  }

  const actualProgressRate = Math.round((onTimeCount / count) * 10000) / 100;
  const actualResultRate = Math.round((qualifiedCount / count) * 10000) / 100;
  return {
    workItemType,
    count,
    completedCount,
    onTimeCount,
    qualifiedCount,
    actualProgressRate,
    actualResultRate,
    appliedProgressRate: convertActualRate(actualProgressRate),
    appliedResultRate: convertActualRate(actualResultRate),
    readyForAssessment: completedCount === count,
    totalPlannedQuantity,
    totalActualQuantity,
    presentCount,
    excusedCount,
    absentCount
  };
}

function validateDates(assignedDateKey, deadlineDateKey, completedDateKey) {
  if (!assignedDateKey) throw new Error("Hãy chọn ngày giao.");
  if (!deadlineDateKey) throw new Error("Hãy chọn hạn hoàn thành.");
  if (deadlineDateKey < assignedDateKey) {
    throw new Error("Hạn hoàn thành không được trước ngày giao.");
  }
  if (completedDateKey && completedDateKey < assignedDateKey) {
    throw new Error("Ngày hoàn thành không được trước ngày giao.");
  }
}

export const TaskWorkItemService = Object.freeze({
  TRACKING_MODE_ITEMIZED: "ITEMIZED",
  TRACKING_MODE_FINAL_OUTPUT: "FINAL_OUTPUT",
  WORK_ITEM_TYPES,
  ATTENDANCE_STATUSES,
  ALLOWED_RATES,
  mayManage,
  mayEditItem,
  normalizeWorkItemType,
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
        const first = String(a.sessionDateKey || a.reportingPeriod || a.assignedDateKey || a.deadlineDateKey || "");
        const second = String(b.sessionDateKey || b.reportingPeriod || b.assignedDateKey || b.deadlineDateKey || "");
        return first.localeCompare(second) || String(a.title).localeCompare(String(b.title), "vi");
      });
  },

  async save(task, data, existingItem = null) {
    const user = UserContext.requireUser();
    if (!mayEditItem(task, existingItem)) {
      throw new Error("Tài khoản không có quyền cập nhật công việc phát sinh này.");
    }

    const workItemType = normalizeWorkItemType(
      data.workItemType || existingItem?.workItemType || task.workItemType
    );
    const assignedDateKey = dateKey(data.assignedDateKey);
    const deadlineDateKey = dateKey(data.deadlineDateKey);
    const completedDateKey = dateKey(data.completedDateKey);
    const sessionDateKey = dateKey(data.sessionDateKey);
    const reportingPeriod = monthKey(data.reportingPeriod);
    const attendanceStatus = String(data.attendanceStatus || "").toUpperCase();
    let title = clean(data.title, 500);

    if (workItemType === WORK_ITEM_TYPES.ATTENDANCE) {
      if (!sessionDateKey) throw new Error("Hãy chọn ngày tổ chức hoạt động.");
      if (!ATTENDANCE_STATUSES.includes(attendanceStatus)) {
        throw new Error("Hãy chọn tình trạng tham dự.");
      }
      title = title || `Hoạt động ngày ${sessionDateKey.split("-").reverse().join("/")}`;
    } else {
      validateDates(assignedDateKey, deadlineDateKey, completedDateKey);
      if (workItemType === WORK_ITEM_TYPES.QUANTITY) {
        if (!reportingPeriod) throw new Error("Hãy chọn tháng ghi nhận sản lượng.");
        title = title || clean(data.productName, 300) || `Sản lượng tháng ${reportingPeriod}`;
      }
      if (!title) {
        throw new Error(workItemType === WORK_ITEM_TYPES.DOCUMENT
          ? "Hãy nhập trích yếu văn bản/hồ sơ được giao."
          : "Hãy nhập nội dung công việc được giao.");
      }
    }

    const reference = existingItem?.id
      ? FirebaseService.doc(FirebaseService.db, COLLECTION, existingItem.id)
      : FirebaseService.doc(FirebaseService.collection(FirebaseService.db, COLLECTION));

    const normalizedForProgress = { deadlineDateKey, completedDateKey };
    const payload = {
      taskId: task.id,
      taskCode: task.taskCode || "",
      periodId: task.periodId || "",
      departmentId: task.primaryDepartmentId || "",
      ownerUserId: task.ownerUserId || "",
      ownerName: task.ownerName || "",
      workItemType,
      title,
      reference: clean(data.reference, 500),
      assignedByName: clean(data.assignedByName || user.fullName, 300),
      assignedDateKey,
      deadlineDateKey,
      completedDateKey,
      reportingPeriod,
      productName: clean(data.productName, 300),
      quantityUnit: clean(data.quantityUnit || task.quantityUnit, 80),
      plannedQuantity: Math.max(0, finiteNumber(data.plannedQuantity)),
      actualQuantity: Math.max(0, finiteNumber(data.actualQuantity)),
      sessionDateKey,
      attendanceStatus: workItemType === WORK_ITEM_TYPES.ATTENDANCE ? attendanceStatus : "",
      participationNote: clean(data.participationNote, 1000),
      progressRate: workItemType === WORK_ITEM_TYPES.ATTENDANCE
        ? (attendanceStatus === "PRESENT" ? 100 : 0)
        : inferredProgressRate(normalizedForProgress),
      resultRate: normalizeRate(data.resultRate),
      resultNote: clean(data.resultNote, 3000),
      evidenceText: clean(data.evidenceText, 3000),
      evidenceUrl: clean(data.evidenceUrl || existingItem?.evidenceUrl, 2000),
      evidenceFileName: clean(data.evidenceFileName || existingItem?.evidenceFileName, 500),
      evidenceStoragePath: clean(data.evidenceStoragePath || existingItem?.evidenceStoragePath, 1000),
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
