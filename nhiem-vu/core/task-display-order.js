/** Thứ tự và trạng thái hiển thị dùng chung cho toàn bộ phân hệ nhiệm vụ/KPI. */

const NATURAL_COLLATOR = new Intl.Collator("vi", {
  numeric: true,
  sensitivity: "base"
});

const TERMINAL_STATUSES = new Set([
  "HOAN_THANH",
  "COMPLETED",
  "DA_HOAN_THANH",
  "HUY",
  "CANCELLED",
  "DELETED"
]);

function clean(value) {
  return String(value ?? "").trim();
}

export function normalizeTaskStatus(value) {
  return clean(value).toUpperCase();
}

export function timestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return Number(value.toMillis()) || 0;
  if (typeof value.toDate === "function") return value.toDate().getTime() || 0;
  if (value instanceof Date) return value.getTime() || 0;
  if (typeof value === "object" && Number.isFinite(Number(value.seconds))) {
    return Number(value.seconds) * 1000 + Math.floor(Number(value.nanoseconds || 0) / 1e6);
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isTerminalTask(task = {}) {
  const status = normalizeTaskStatus(task.status);
  const scoringStatus = normalizeTaskStatus(task.scoringStatus);
  return TERMINAL_STATUSES.has(status)
    || Boolean(task.completedAt)
    || task.scoreLocked === true
    || scoringStatus === "CONFIRMED";
}

export function effectiveDepartmentAssignmentStatus(task = {}) {
  const explicit = normalizeTaskStatus(task.departmentAssignmentStatus);
  if (explicit) return explicit;

  const status = normalizeTaskStatus(task.status);
  const assignmentStatus = normalizeTaskStatus(task.assignmentStatus);
  const assignmentMode = normalizeTaskStatus(task.assignmentMode);
  const ownerUserId = clean(task.ownerUserId);

  if (status === "CHO_PHONG_KHU_TIEP_NHAN" || assignmentStatus === "CHO_PHONG_KHU_TIEP_NHAN") {
    return "PENDING_ACCEPTANCE";
  }
  if (!ownerUserId && assignmentMode === "DEPARTMENT") {
    return status === "CHO_PHAN_CONG" ? "ACCEPTED" : "PENDING_ACCEPTANCE";
  }
  if (ownerUserId && assignmentMode === "TEAM_DIRECT") return "DIRECT_ASSIGNED";
  if (ownerUserId || ["DA_PHAN_CONG", "DA_TIEP_NHAN"].includes(assignmentStatus)) return "ACCEPTED";
  return "";
}

export function taskDisplayGroup(task = {}) {
  if (isTerminalTask(task)
      || normalizeTaskStatus(task.scoringStatus) === "ADJUSTMENT_EXEMPT"
      || normalizeTaskStatus(task.noOccurrenceStatus) === "CONFIRMED") {
    return 5;
  }

  const ownerUserId = clean(task.ownerUserId);
  const status = normalizeTaskStatus(task.status);
  const assignmentStatus = normalizeTaskStatus(task.assignmentStatus);
  const departmentStatus = effectiveDepartmentAssignmentStatus(task);

  if (!ownerUserId && (
    departmentStatus === "PENDING_ACCEPTANCE"
    || status === "CHO_PHONG_KHU_TIEP_NHAN"
    || assignmentStatus === "CHO_PHONG_KHU_TIEP_NHAN"
  )) return 0;

  if (!ownerUserId && (
    departmentStatus === "ACCEPTED"
    || status === "CHO_PHAN_CONG"
    || assignmentStatus === "CHO_PHAN_CONG"
  )) return 1;

  if (ownerUserId && assignmentStatus !== "DA_TIEP_NHAN") return 2;

  const unexpected = normalizeTaskStatus(task.workType) === "DOT_XUAT"
    || normalizeTaskStatus(task.priority) === "DOT_XUAT"
    || /-DX\d+$/i.test(clean(task.taskCode));
  return unexpected ? 3 : 4;
}

export function taskActivityMillis(task = {}) {
  return Math.max(
    timestampMillis(task.departmentAssignedAt),
    timestampMillis(task.internalAssignedAt),
    timestampMillis(task.assignedAt),
    timestampMillis(task.updatedAt),
    timestampMillis(task.createdAt)
  );
}

export function compareTasksForDisplay(a = {}, b = {}) {
  const groupDifference = taskDisplayGroup(a) - taskDisplayGroup(b);
  if (groupDifference) return groupDifference;

  const activityDifference = taskActivityMillis(b) - taskActivityMillis(a);
  if (activityDifference) return activityDifference;

  const codeDifference = NATURAL_COLLATOR.compare(
    clean(a.taskCode || a.standardTaskCode || a.id),
    clean(b.taskCode || b.standardTaskCode || b.id)
  );
  if (codeDifference) return codeDifference;

  return NATURAL_COLLATOR.compare(clean(a.title), clean(b.title));
}

export function sortTasksForDisplay(tasks = []) {
  return [...tasks].sort(compareTasksForDisplay);
}
