import test from "node:test";
import assert from "node:assert/strict";

import { calculateKpiSummary, calculateTaskScore } from "../kpi-engine.js";
import { calculateWorkItemSummary } from "../work-item-score-engine.js";

test("Phụ lục 04: điểm chuẩn 10, hệ số 110%, tiến độ 100%, kết quả 80%", () => {
  const score = calculateTaskScore(10, 1.1, 100, 80);
  assert.equal(score.execution, 8.6);
  assert.equal(score.actual, 9.46);
  assert.equal(score.maximum, 11);
});

test("Điểm quy đổi thực tế không vượt điểm quy đổi tối đa", () => {
  const score = calculateTaskScore(10, 1.2, 100, 100);
  assert.equal(score.execution, 10);
  assert.equal(score.actual, 12);
  assert.equal(score.maximum, 12);
});

test("Văn bản nhiều lượt tính theo N–T–K rồi mới áp dụng Phụ lục 04", () => {
  const items = [
    { completedDateKey: "2026-07-02", deadlineDateKey: "2026-07-03", resultRate: 100 },
    { completedDateKey: "2026-07-04", deadlineDateKey: "2026-07-04", resultRate: 80 },
    { completedDateKey: "2026-07-05", deadlineDateKey: "2026-07-06", resultRate: 100 },
    { completedDateKey: "2026-07-08", deadlineDateKey: "2026-07-07", resultRate: 60 },
    { completedDateKey: "2026-07-09", deadlineDateKey: "2026-07-09", resultRate: 0 }
  ];
  const summary = calculateWorkItemSummary(items, "DOCUMENT");
  assert.equal(summary.count, 5);
  assert.equal(summary.onTimeCount, 4);
  assert.equal(summary.qualifiedCount, 3);
  assert.equal(summary.actualProgressRate, 80);
  assert.equal(summary.actualResultRate, 60);
  assert.equal(summary.appliedProgressRate, 80);
  assert.equal(summary.appliedResultRate, 60);

  const score = calculateTaskScore(10, 1.1, summary.appliedProgressRate, summary.appliedResultRate);
  assert.equal(score.execution, 6.6);
  assert.equal(score.actual, 7.26);
});

test("Lượt chưa hoàn thành vẫn nằm trong N và không nằm trong T/K", () => {
  const items = [
    { completedDateKey: "2026-07-02", deadlineDateKey: "2026-07-03", resultRate: 100 },
    { completedDateKey: "2026-07-08", deadlineDateKey: "2026-07-07", resultRate: 80 },
    { completedDateKey: "", deadlineDateKey: "2026-07-09", resultRate: 100 }
  ];
  const summary = calculateWorkItemSummary(items, "GENERIC");
  assert.equal(summary.count, 3);
  assert.equal(summary.completedCount, 2);
  assert.equal(summary.incompleteCount, 1);
  assert.equal(summary.onTimeCount, 1);
  assert.equal(summary.qualifiedCount, 2);
  assert.equal(summary.actualProgressRate, 33.33);
  assert.equal(summary.actualResultRate, 66.67);
  assert.equal(summary.appliedProgressRate, 0);
  assert.equal(summary.appliedResultRate, 60);
  assert.equal(summary.readyForAssessment, true);
});

test("Điểm danh: vắng có phép và vắng mặt đều được thống kê, không tính là có mặt", () => {
  const items = [
    { attendanceStatus: "PRESENT", resultRate: 100 },
    { attendanceStatus: "PRESENT", resultRate: 60 },
    { attendanceStatus: "EXCUSED", resultRate: 100 },
    { attendanceStatus: "ABSENT", resultRate: 100 }
  ];
  const summary = calculateWorkItemSummary(items, "ATTENDANCE");
  assert.equal(summary.count, 4);
  assert.equal(summary.presentCount, 2);
  assert.equal(summary.excusedCount, 1);
  assert.equal(summary.absentCount, 1);
  assert.equal(summary.onTimeCount, 2);
  assert.equal(summary.qualifiedCount, 1);
  assert.equal(summary.actualProgressRate, 50);
  assert.equal(summary.actualResultRate, 25);
});

test("Sản lượng chỉ đạt K khi đạt kế hoạch và chất lượng từ 80%", () => {
  const items = [
    { completedDateKey: "2026-07-30", deadlineDateKey: "2026-07-31", plannedQuantity: 100, actualQuantity: 110, resultRate: 100 },
    { completedDateKey: "2026-07-31", deadlineDateKey: "2026-07-31", plannedQuantity: 80, actualQuantity: 70, resultRate: 100 },
    { completedDateKey: "2026-08-01", deadlineDateKey: "2026-07-31", plannedQuantity: 50, actualQuantity: 50, resultRate: 80 }
  ];
  const summary = calculateWorkItemSummary(items, "QUANTITY");
  assert.equal(summary.count, 3);
  assert.equal(summary.onTimeCount, 2);
  assert.equal(summary.qualifiedCount, 2);
  assert.equal(summary.totalPlannedQuantity, 230);
  assert.equal(summary.totalActualQuantity, 230);
});

test("KPI công việc cộng điểm quy đổi thực tế B và trả null khi A bằng 0", () => {
  const regular = calculateKpiSummary([
    { active: true, includedInA: true, planApprovalStatus: "APPROVED", maximumConvertedScore: 10, recognized: true, confirmedActualScore: 8.6 },
    { active: true, includedInA: true, planApprovalStatus: "APPROVED", maximumConvertedScore: 11, recognized: true, confirmedActualScore: 9.46 }
  ], 30);
  assert.equal(regular.A, 21);
  assert.equal(regular.B, 18.06);
  assert.equal(regular.kpi70, 60.2);

  const noBasis = calculateKpiSummary([], 30);
  assert.equal(noBasis.A, 0);
  assert.equal(noBasis.kpi70, null);
  assert.equal(noBasis.total100, null);
});
