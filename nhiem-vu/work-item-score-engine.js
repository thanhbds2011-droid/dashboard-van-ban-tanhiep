/**
 * Bộ tính N–T–K thuần JavaScript cho đầu việc có nhiều lượt phát sinh.
 *
 * Lưu ý nghiệp vụ:
 * - Mỗi lượt chỉ là căn cứ tạo tỷ lệ tiến độ/kết quả của đầu việc.
 * - Không chấm và không cộng điểm chuẩn riêng cho từng lượt.
 * - Sau khi có mức áp dụng, toàn đầu việc vẫn được chấm đúng một lần theo Phụ lục 04.
 */

export const WORK_ITEM_TYPES = Object.freeze({
  GENERIC: "GENERIC",
  DOCUMENT: "DOCUMENT",
  QUANTITY: "QUANTITY",
  ATTENDANCE: "ATTENDANCE"
});

export const ATTENDANCE_STATUSES = Object.freeze(["PRESENT", "EXCUSED", "ABSENT"]);
export const WORK_ITEM_RESULT_PASS_RATE = 80;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function normalizeWorkItemType(value) {
  const type = String(value ?? "").trim().toUpperCase();
  return Object.hasOwn(WORK_ITEM_TYPES, type) ? type : WORK_ITEM_TYPES.GENERIC;
}

/**
 * Chuẩn hóa tỷ lệ thực tế. Từ V1.2.0 không ép tỷ lệ trung bình về bốn bậc
 * 100–80–60–0: từng lượt được chấm trước, sau đó lấy trung bình chính xác.
 */
export function convertActualRate(actualRate) {
  return round2(Math.max(0, Math.min(100, finiteNumber(actualRate))));
}

/**
 * N = tổng lượt hợp lệ.
 * T = lượt hoàn thành đúng hạn; riêng điểm danh là số buổi có mặt.
 * K = lượt đạt yêu cầu; riêng sản lượng phải đồng thời đạt kế hoạch.
 *
 * Lượt chưa hoàn thành vẫn thuộc N và không thuộc T/K. Nhờ vậy, kết quả cuối kỳ
 * phản ánh đầy đủ cả phần việc tồn đọng thay vì chặn không cho đánh giá.
 */
export function calculateWorkItemSummary(items, requestedType = "") {
  const activeItems = (items || []).filter(item => item?.active !== false);
  const count = activeItems.length;
  const workItemType = normalizeWorkItemType(
    requestedType || activeItems[0]?.workItemType || WORK_ITEM_TYPES.GENERIC
  );

  if (!count) {
    return {
      workItemType,
      count: 0,
      completedCount: 0,
      incompleteCount: 0,
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
      absentCount: 0,
      scoringBasis: "NO_OCCURRENCE"
    };
  }

  let completedCount = 0;
  let onTimeCount = 0;
  let qualifiedCount = 0;
  let presentCount = 0;
  let excusedCount = 0;
  let absentCount = 0;
  let totalProgressRate = 0;
  let totalResultRate = 0;

  const totalPlannedQuantity = activeItems.reduce(
    (sum, item) => sum + Math.max(0, finiteNumber(item?.plannedQuantity)),
    0
  );
  const totalActualQuantity = activeItems.reduce(
    (sum, item) => sum + Math.max(0, finiteNumber(item?.actualQuantity)),
    0
  );

  for (const item of activeItems) {
    const progressRate = Math.max(0, Math.min(100, finiteNumber(item?.progressRate)));
    const resultRate = Math.max(0, Math.min(100, finiteNumber(item?.resultRate)));

    if (workItemType === WORK_ITEM_TYPES.ATTENDANCE) {
      const status = String(item?.attendanceStatus || "").toUpperCase();
      const recorded = ATTENDANCE_STATUSES.includes(status);
      if (recorded) completedCount += 1;

      if (status === "PRESENT") {
        presentCount += 1;
        onTimeCount += 1;
        if (resultRate >= WORK_ITEM_RESULT_PASS_RATE) qualifiedCount += 1;
        totalProgressRate += 100;
        totalResultRate += resultRate;
      } else if (status === "EXCUSED") {
        excusedCount += 1;
      } else if (status === "ABSENT") {
        absentCount += 1;
      }
      continue;
    }

    const completed = Boolean(item?.completedDateKey);
    totalProgressRate += completed ? progressRate : 0;
    totalResultRate += completed ? resultRate : 0;
    if (completed) completedCount += 1;
    if (completed && item?.deadlineDateKey && item.completedDateKey <= item.deadlineDateKey) {
      onTimeCount += 1;
    }
    if (!completed || resultRate < WORK_ITEM_RESULT_PASS_RATE) continue;

    if (workItemType === WORK_ITEM_TYPES.QUANTITY) {
      const planned = Math.max(0, finiteNumber(item?.plannedQuantity));
      const actual = Math.max(0, finiteNumber(item?.actualQuantity));
      if (planned > 0 && actual >= planned) qualifiedCount += 1;
    } else {
      qualifiedCount += 1;
    }
  }

  const actualProgressRate = round2(totalProgressRate / count);
  const actualResultRate = round2(totalResultRate / count);
  return {
    workItemType,
    count,
    completedCount,
    incompleteCount: Math.max(0, count - completedCount),
    onTimeCount,
    qualifiedCount,
    actualProgressRate,
    actualResultRate,
    appliedProgressRate: convertActualRate(actualProgressRate),
    appliedResultRate: convertActualRate(actualResultRate),
    readyForAssessment: true,
    totalPlannedQuantity: round2(totalPlannedQuantity),
    totalActualQuantity: round2(totalActualQuantity),
    presentCount,
    excusedCount,
    absentCount,
    scoringBasis: "ITEM_AVERAGE"
  };
}
