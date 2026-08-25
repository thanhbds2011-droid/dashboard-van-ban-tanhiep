/**
 * Bộ tính điểm cho đầu việc có nhiều văn bản/lượt và hoạt động điểm danh.
 *
 * Quy tắc nghiệp vụ Production V1.15.0:
 * - Mỗi văn bản/lượt được chấm riêng ở bốn mức 100/80/60/0.
 * - Với văn bản/lượt thông thường: lấy trung bình chính xác từng mức, sau đó
 *   quy trung bình về thang Phụ lục 04: 100; 80–<100 => 80; 60–<80 => 60; <60 => 0.
 * - Với hoạt động điểm danh: tiến độ = T/N, kết quả = K/N, sau đó quy về cùng thang.
 * - Mỗi lượt chỉ là căn cứ; toàn đầu việc chỉ được tính điểm một lần.
 * - Riêng nhiệm vụ EVENT_DRIVEN: lượt đã hoàn thành được tính ngay; lượt chưa hoàn thành và chưa đến hạn chưa vào mẫu số; quá hạn chưa hoàn thành = 0.
 * - Các đầu việc ITEMIZED cũ giữ cách tính trước đây để tương thích ngược.
 */

export const WORK_ITEM_TYPES = Object.freeze({
  GENERIC: "GENERIC",
  DOCUMENT: "DOCUMENT",
  QUANTITY: "QUANTITY",
  ATTENDANCE: "ATTENDANCE"
});

export const ATTENDANCE_STATUSES = Object.freeze(["PRESENT", "EXCUSED", "ABSENT"]);
export const WORK_ITEM_RESULT_PASS_RATE = 80;
export const APPENDIX_04_RATES = Object.freeze([100, 80, 60, 0]);

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampRate(value) {
  return Math.max(0, Math.min(100, finiteNumber(value)));
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function normalizedItemRate(value) {
  const rate = Number(value);
  return APPENDIX_04_RATES.includes(rate) ? rate : 0;
}

function todayDateKey() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function eligibleItem(item, asOfDateKey) {
  if (!item || item.active === false) return false;
  if (item.completedDateKey) return true;
  const deadline = String(item.deadlineDateKey || "").trim();
  return Boolean(deadline && deadline <= asOfDateKey);
}

export function normalizeWorkItemType(value) {
  const type = String(value ?? "").trim().toUpperCase();
  return Object.hasOwn(WORK_ITEM_TYPES, type) ? type : WORK_ITEM_TYPES.GENERIC;
}

/**
 * Quy tỷ lệ trung bình thực tế về bốn mức Phụ lục 04.
 * 100 => 100; [80,100) => 80; [60,80) => 60; dưới 60 => 0.
 */
export function convertActualRate(actualRate) {
  const value = clampRate(actualRate);
  if (value >= 100) return 100;
  if (value >= 80) return 80;
  if (value >= 60) return 60;
  return 0;
}

function emptySummary(workItemType) {
  return {
    workItemType,
    count: 0,
    completedCount: 0,
    incompleteCount: 0,
    onTimeCount: 0,
    qualifiedCount: 0,
    progressRateTotal: 0,
    resultRateTotal: 0,
    actualProgressRate: null,
    actualResultRate: null,
    appliedProgressRate: null,
    appliedResultRate: null,
    readyForAssessment: false,
    totalPlannedQuantity: 0,
    totalActualQuantity: 0,
    presentCount: 0,
    excusedCount: 0,
    absentCount: 0,
    scoringBasis: "NO_OCCURRENCE"
  };
}

function calculateAttendanceSummary(activeItems, workItemType) {
  const count = activeItems.length;
  let completedCount = 0;
  let presentCount = 0;
  let qualifiedCount = 0;
  let excusedCount = 0;
  let absentCount = 0;

  for (const item of activeItems) {
    const status = String(item?.attendanceStatus || "").toUpperCase();
    const recorded = ATTENDANCE_STATUSES.includes(status);
    if (recorded) completedCount += 1;

    if (status === "PRESENT") {
      presentCount += 1;
      if (normalizedItemRate(item?.resultRate) >= WORK_ITEM_RESULT_PASS_RATE) {
        qualifiedCount += 1;
      }
    } else if (status === "EXCUSED") {
      excusedCount += 1;
    } else if (status === "ABSENT") {
      absentCount += 1;
    }
  }

  const actualProgressRate = round2((presentCount / count) * 100);
  const actualResultRate = round2((qualifiedCount / count) * 100);
  return {
    workItemType,
    count,
    completedCount,
    incompleteCount: Math.max(0, count - completedCount),
    onTimeCount: presentCount,
    qualifiedCount,
    progressRateTotal: presentCount,
    resultRateTotal: qualifiedCount,
    actualProgressRate,
    actualResultRate,
    appliedProgressRate: convertActualRate(actualProgressRate),
    appliedResultRate: convertActualRate(actualResultRate),
    readyForAssessment: true,
    totalPlannedQuantity: 0,
    totalActualQuantity: 0,
    presentCount,
    excusedCount,
    absentCount,
    scoringBasis: "ATTENDANCE_NTK"
  };
}

function effectiveResultRate(item, workItemType) {
  if (!item?.completedDateKey) return 0;
  const resultRate = normalizedItemRate(item?.resultRate);
  if (workItemType !== WORK_ITEM_TYPES.QUANTITY) return resultRate;

  const planned = Math.max(0, finiteNumber(item?.plannedQuantity));
  const actual = Math.max(0, finiteNumber(item?.actualQuantity));
  if (planned <= 0 || actual < planned) return 0;
  return resultRate;
}

function calculateItemAverageSummary(activeItems, workItemType) {
  const count = activeItems.length;
  let completedCount = 0;
  let onTimeCount = 0;
  let qualifiedCount = 0;
  let progressRateTotal = 0;
  let resultRateTotal = 0;

  const totalPlannedQuantity = activeItems.reduce(
    (sum, item) => sum + Math.max(0, finiteNumber(item?.plannedQuantity)),
    0
  );
  const totalActualQuantity = activeItems.reduce(
    (sum, item) => sum + Math.max(0, finiteNumber(item?.actualQuantity)),
    0
  );

  for (const item of activeItems) {
    const completed = Boolean(item?.completedDateKey);
    const progressRate = completed ? normalizedItemRate(item?.progressRate) : 0;
    const resultRate = effectiveResultRate(item, workItemType);

    if (completed) completedCount += 1;
    if (progressRate === 100) onTimeCount += 1;
    if (resultRate >= WORK_ITEM_RESULT_PASS_RATE) qualifiedCount += 1;

    progressRateTotal += progressRate;
    resultRateTotal += resultRate;
  }

  const actualProgressRate = round2(progressRateTotal / count);
  const actualResultRate = round2(resultRateTotal / count);
  return {
    workItemType,
    count,
    completedCount,
    incompleteCount: Math.max(0, count - completedCount),
    onTimeCount,
    qualifiedCount,
    progressRateTotal: round2(progressRateTotal),
    resultRateTotal: round2(resultRateTotal),
    actualProgressRate,
    actualResultRate,
    appliedProgressRate: convertActualRate(actualProgressRate),
    appliedResultRate: convertActualRate(actualResultRate),
    readyForAssessment: true,
    totalPlannedQuantity: round2(totalPlannedQuantity),
    totalActualQuantity: round2(totalActualQuantity),
    presentCount: 0,
    excusedCount: 0,
    absentCount: 0,
    scoringBasis: "ITEM_AVERAGE_APPENDIX_04"
  };
}

/**
 * Tổng hợp một đầu việc có nhiều lượt.
 *
 * - ATTENDANCE: N = số buổi phải tham gia, T = số buổi có mặt,
 *   K = số buổi có mặt và đạt yêu cầu; tính T/N và K/N.
 * - Các loại còn lại: lấy trung bình mức tiến độ và kết quả của từng lượt.
 */
export function calculateWorkItemSummary(items, requestedType = "", options = {}) {
  const allActiveItems = (items || []).filter(item => item?.active !== false);
  const workItemType = normalizeWorkItemType(
    requestedType || allActiveItems[0]?.workItemType || WORK_ITEM_TYPES.GENERIC
  );

  if (!allActiveItems.length) return emptySummary(workItemType);
  if (workItemType === WORK_ITEM_TYPES.ATTENDANCE) {
    return calculateAttendanceSummary(allActiveItems, workItemType);
  }

  /*
   * Backward compatibility:
   * - đầu việc ITEMIZED cũ tiếp tục tính toàn bộ lượt như trước;
   * - chỉ nhiệm vụ EVENT_DRIVEN mới loại lượt tương lai chưa hoàn thành khỏi mẫu số.
   * Có thể truyền chuỗi YYYY-MM-DD ở tham số 3 để tương thích test/hàm gọi V1.15.0.
   */
  const config = typeof options === "string"
    ? { asOfDateKey: options, excludeFutureIncomplete: true }
    : (options || {});
  const excludeFutureIncomplete = config.excludeFutureIncomplete === true;
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(String(config.asOfDateKey || ""))
    ? String(config.asOfDateKey)
    : todayDateKey();

  if (!excludeFutureIncomplete) {
    const summary = calculateItemAverageSummary(allActiveItems, workItemType);
    summary.totalRecordedCount = allActiveItems.length;
    summary.futurePendingCount = 0;
    summary.eligibleCount = allActiveItems.length;
    return summary;
  }

  const eligibleItems = allActiveItems.filter(item => eligibleItem(item, asOf));
  if (!eligibleItems.length) {
    const summary = emptySummary(workItemType);
    summary.totalRecordedCount = allActiveItems.length;
    summary.futurePendingCount = allActiveItems.filter(item => !item.completedDateKey && String(item.deadlineDateKey || "") > asOf).length;
    summary.eligibleCount = 0;
    summary.scoringBasis = "NO_ELIGIBLE_OCCURRENCE_YET";
    return summary;
  }

  const summary = calculateItemAverageSummary(eligibleItems, workItemType);
  summary.totalRecordedCount = allActiveItems.length;
  summary.futurePendingCount = allActiveItems.filter(item => !item.completedDateKey && String(item.deadlineDateKey || "") > asOf).length;
  summary.eligibleCount = eligibleItems.length;
  return summary;
}
