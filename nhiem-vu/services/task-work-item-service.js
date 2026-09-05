/** Quản lý các lượt công việc phát sinh bên trong một nhiệm vụ KPI. */
import { FirebaseService } from "../core/firebase-service.js?v=20260904.V1_23_0";
import { UserContext } from "../core/user-context.js?v=20260904.V1_23_0";
import { Permissions } from "../core/permissions.js?v=20260904.V1_23_0";
import { UserNotificationService } from "./user-notification-service.js?v=20260904.V1_23_0";
import { progressRateFromDates } from "../kpi-engine.js?v=20260904.V1_23_0";
import {
  ATTENDANCE_STATUSES,
  WORK_ITEM_TYPES,
  calculateWorkItemSummary,
  convertActualRate,
  normalizeWorkItemType
} from "../work-item-score-engine.js?v=20260904.V1_23_0";

const COLLECTION = "taskWorkItems";
const ALLOWED_RATES = Object.freeze([100, 80, 60, 0]);

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

function taskIsClosed(task) {
  return Boolean(task && (
    String(task.status || "").toUpperCase() === "HOAN_THANH"
    || task.completedAt
    || task.eventTrackingClosedAt
  ));
}

function mayManage(task) {
  const user = UserContext.requireUser();
  return Boolean(
    task &&
    task.active !== false &&
    !taskIsClosed(task) &&
    (
      task.ownerUserId === user.uid ||
      Permissions.isAdmin() ||
      Permissions.isDirector() ||
      (String(task.primaryDepartmentId || "").toUpperCase() === "CDTN" && Permissions.isCdtnLeadership(user)) ||
      (Permissions.isDepartmentLeader(user) && String(task.primaryDepartmentId || "").toUpperCase() === String(user.departmentId || "").toUpperCase()) ||
      Permissions.hasDirectHeadAuthorityForDepartment(user, String(task.primaryDepartmentId || task.departmentId || "").toUpperCase())
    )
  );
}

function mayEditItem(task, item) {
  const user = UserContext.requireUser();
  if (!mayManage(task)) return false;
  if (Permissions.isAdmin() || Permissions.isDirector() || Permissions.isDepartmentLeader(user) || Permissions.hasDirectHeadAuthorityForDepartment(user, String(task?.primaryDepartmentId || task?.departmentId || "").toUpperCase()) || (String(task?.primaryDepartmentId || "").toUpperCase() === "CDTN" && Permissions.isCdtnLeadership(user))) return true;
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

function calculateSummary(items, requestedType = "", task = null) {
  const eventDriven = Boolean(task && (task.deadlineMode === "EVENT_DRIVEN" || task.eventDrivenDeadline === true));
  return calculateWorkItemSummary(items, requestedType, { excludeFutureIncomplete: eventDriven });
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

async function syncEventDrivenParentSummary(task) {
  if (!task?.id || String(task.deadlineMode || "").toUpperCase() !== "EVENT_DRIVEN") return;
  const items = await TaskWorkItemService.list(task);
  const summary = calculateSummary(items, task.workItemType, task);
  const user = UserContext.requireUser();
  await FirebaseService.updateDoc(
    FirebaseService.doc(FirebaseService.db, "tasks", task.id),
    {
      eventWorkItemCount: Number(summary.totalRecordedCount ?? summary.count ?? 0),
      eventEligibleCount: Number(summary.eligibleCount ?? summary.count ?? 0),
      eventCompletedCount: Number(summary.completedCount || 0),
      eventProgressRate: summary.appliedProgressRate === null ? null : Number(summary.appliedProgressRate),
      eventResultRate: summary.appliedResultRate === null ? null : Number(summary.appliedResultRate),
      eventSummaryUpdatedAt: FirebaseService.serverTimestamp(),
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: user.uid,
      updatedByName: user.fullName || ""
    }
  );
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

  async list(taskOrId) {
    const user = UserContext.requireUser();
    const task = taskOrId && typeof taskOrId === "object" ? taskOrId : null;
    const taskId = clean(task?.id || taskOrId, 200);
    if (!taskId) return [];
    const constraints = [FirebaseService.where("taskId", "==", taskId)];
    if (task && clean(task.ownerUserId, 200) === clean(user.uid, 200)) {
      constraints.push(FirebaseService.where("ownerUserId", "==", user.uid));
    } else if (!(Permissions.isAdmin() || Permissions.isDirector())) {
      const departmentId = clean(task?.primaryDepartmentId || task?.departmentId || user.departmentId, 40).toUpperCase();
      if (departmentId) constraints.push(FirebaseService.where("departmentId", "==", departmentId));
      else constraints.push(FirebaseService.where("ownerUserId", "==", user.uid));
    }
    const snapshot = await FirebaseService.getDocs(
      FirebaseService.query(
        FirebaseService.collection(FirebaseService.db, COLLECTION),
        ...constraints
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

    const deadlineCeilingDateKey = dateKey(task?.deadlineCeilingDateKey || task?.fixedDeadlineDateKey);

    if (workItemType === WORK_ITEM_TYPES.ATTENDANCE) {
      if (!sessionDateKey) throw new Error("Hãy chọn ngày tổ chức hoạt động.");
      if (deadlineCeilingDateKey && sessionDateKey > deadlineCeilingDateKey) {
        throw new Error("Ngày hoạt động không được vượt quá hạn cuối Ban Giám đốc giao.");
      }
      if (!ATTENDANCE_STATUSES.includes(attendanceStatus)) {
        throw new Error("Hãy chọn tình trạng tham dự.");
      }
      title = title || `Hoạt động ngày ${sessionDateKey.split("-").reverse().join("/")}`;
    } else {
      validateDates(assignedDateKey, deadlineDateKey, completedDateKey);
      if (deadlineCeilingDateKey && deadlineDateKey > deadlineCeilingDateKey) {
        throw new Error("Hạn của lượt công việc không được vượt quá hạn cuối Ban Giám đốc giao.");
      }
      if (workItemType === WORK_ITEM_TYPES.QUANTITY) {
        if (!reportingPeriod) throw new Error("Hãy chọn tháng ghi nhận sản lượng.");
        if (finiteNumber(data.plannedQuantity) <= 0) {
          throw new Error("Sản lượng kế hoạch phải lớn hơn 0.");
        }
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
      homeDepartmentId: task.homeDepartmentId || (String(task.primaryDepartmentId || "").toUpperCase() === "CDTN" ? (user.departmentId || "") : (task.primaryDepartmentId || "")),
      organizationId: String(task.organizationId || "").toUpperCase() === "CDTN" || String(task.primaryDepartmentId || "").toUpperCase() === "CDTN" ? "CDTN" : "",
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
      resultRate: workItemType === WORK_ITEM_TYPES.ATTENDANCE
        ? (attendanceStatus === "PRESENT" ? normalizeRate(data.resultRate) : 0)
        : (completedDateKey ? normalizeRate(data.resultRate) : 0),
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
    await syncEventDrivenParentSummary(task);
    if (String(task.ownerUserId || "") === String(user.uid || "")) {
      const eventId = `WORKITEM_${existingItem?.id ? "UPDATE" : "CREATE"}_${reference.id}_${Date.now()}`;
      void UserNotificationService.notifyTaskAction("TASK_WORK_ITEM_UPDATED", task.id, {
        taskCode: task.taskCode || "",
        workItemId: reference.id
      }, eventId);
    }
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
    await syncEventDrivenParentSummary(task);
    if (String(task.ownerUserId || "") === String(user.uid || "")) {
      void UserNotificationService.notifyTaskAction("TASK_WORK_ITEM_UPDATED", task.id, {
        taskCode: task.taskCode || "",
        workItemId: item.id
      }, `WORKITEM_REMOVE_${item.id}_${Date.now()}`);
    }
  }
});
