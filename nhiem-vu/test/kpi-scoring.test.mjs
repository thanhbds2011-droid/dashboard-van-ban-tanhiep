import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateKpiSummary,
  calculateTaskScore,
  convertAppendix04Rate
} from "../kpi-engine.js";
import { calculateWorkItemSummary } from "../work-item-score-engine.js";

test("Phụ lục 04: điểm chuẩn 10, hệ số 110%, tiến độ 100%, kết quả 80%", () => {
  const score = calculateTaskScore(10, 1.1, 100, 80);
  assert.equal(score.execution, 8.6);
  assert.equal(score.actual, 9.46);
  assert.equal(score.maximum, 11);
});

test("Tỷ lệ trung bình phải quy về bốn mức Phụ lục 04", () => {
  assert.equal(convertAppendix04Rate(100), 100);
  assert.equal(convertAppendix04Rate(90), 80);
  assert.equal(convertAppendix04Rate(80), 80);
  assert.equal(convertAppendix04Rate(70), 60);
  assert.equal(convertAppendix04Rate(60), 60);
  assert.equal(convertAppendix04Rate(50), 0);
});

test("calculateTaskScore không dùng trực tiếp tỷ lệ trung gian 90%", () => {
  const score = calculateTaskScore(10, 1, 90, 100);
  assert.equal(score.rawProgressRate, 90);
  assert.equal(score.progressRate, 80);
  assert.equal(score.resultRate, 100);
  assert.equal(score.execution, 9.4);
  assert.equal(score.actual, 9.4);
});

test("Hai văn bản 100% và 80% có trung bình 90% rồi quy về 80%", () => {
  const items = [
    {
      completedDateKey: "2026-07-02",
      deadlineDateKey: "2026-07-02",
      progressRate: 100,
      resultRate: 100
    },
    {
      completedDateKey: "2026-07-05",
      deadlineDateKey: "2026-07-03",
      progressRate: 80,
      resultRate: 100
    }
  ];
  const summary = calculateWorkItemSummary(items, "DOCUMENT");
  assert.equal(summary.count, 2);
  assert.equal(summary.actualProgressRate, 90);
  assert.equal(summary.appliedProgressRate, 80);
  assert.equal(summary.actualResultRate, 100);
  assert.equal(summary.appliedResultRate, 100);
  const score = calculateTaskScore(10, 1, summary.appliedProgressRate, summary.appliedResultRate);
  assert.equal(score.execution, 9.4);
  assert.equal(score.actual, 9.4);
});

test("Văn bản nhiều lượt lấy trung bình từng mức rồi quy đổi", () => {
  const items = [
    { completedDateKey: "2026-07-02", progressRate: 100, resultRate: 100 },
    { completedDateKey: "2026-07-04", progressRate: 100, resultRate: 80 },
    { completedDateKey: "2026-07-05", progressRate: 100, resultRate: 100 },
    { completedDateKey: "2026-07-08", progressRate: 80, resultRate: 60 },
    { completedDateKey: "2026-07-09", progressRate: 100, resultRate: 0 }
  ];
  const summary = calculateWorkItemSummary(items, "DOCUMENT");
  assert.equal(summary.count, 5);
  assert.equal(summary.actualProgressRate, 96);
  assert.equal(summary.actualResultRate, 68);
  assert.equal(summary.appliedProgressRate, 80);
  assert.equal(summary.appliedResultRate, 60);

  const score = calculateTaskScore(10, 1.1, summary.appliedProgressRate, summary.appliedResultRate);
  assert.equal(score.execution, 6.6);
  assert.equal(score.actual, 7.26);
});

test("Lượt chưa hoàn thành vẫn nằm trong N và có tiến độ, kết quả 0%", () => {
  const items = [
    { completedDateKey: "2026-07-02", progressRate: 100, resultRate: 100 },
    { completedDateKey: "2026-07-08", progressRate: 80, resultRate: 80 },
    { completedDateKey: "", progressRate: 100, resultRate: 100 }
  ];
  const summary = calculateWorkItemSummary(items, "GENERIC");
  assert.equal(summary.count, 3);
  assert.equal(summary.completedCount, 2);
  assert.equal(summary.incompleteCount, 1);
  assert.equal(summary.actualProgressRate, 60);
  assert.equal(summary.actualResultRate, 60);
  assert.equal(summary.appliedProgressRate, 60);
  assert.equal(summary.appliedResultRate, 60);
});

test("Điểm danh N=2, T=1, K=1: 50% phải quy về 0%", () => {
  const summary = calculateWorkItemSummary([
    { attendanceStatus: "PRESENT", resultRate: 100 },
    { attendanceStatus: "ABSENT", resultRate: 0 }
  ], "ATTENDANCE");
  assert.equal(summary.count, 2);
  assert.equal(summary.presentCount, 1);
  assert.equal(summary.qualifiedCount, 1);
  assert.equal(summary.actualProgressRate, 50);
  assert.equal(summary.actualResultRate, 50);
  assert.equal(summary.appliedProgressRate, 0);
  assert.equal(summary.appliedResultRate, 0);
  const score = calculateTaskScore(10, 1, summary.appliedProgressRate, summary.appliedResultRate);
  assert.equal(score.actual, 0);
});

test("Điểm danh N=5, T=4, K=4: áp dụng 80%", () => {
  const summary = calculateWorkItemSummary([
    { attendanceStatus: "PRESENT", resultRate: 100 },
    { attendanceStatus: "PRESENT", resultRate: 100 },
    { attendanceStatus: "PRESENT", resultRate: 80 },
    { attendanceStatus: "PRESENT", resultRate: 100 },
    { attendanceStatus: "EXCUSED", resultRate: 0 }
  ], "ATTENDANCE");
  assert.equal(summary.actualProgressRate, 80);
  assert.equal(summary.actualResultRate, 80);
  assert.equal(summary.appliedProgressRate, 80);
  assert.equal(summary.appliedResultRate, 80);
});

test("Điểm danh N=3, T=3, K=2: tiến độ 100%, kết quả 66,67% quy về 60%", () => {
  const summary = calculateWorkItemSummary([
    { attendanceStatus: "PRESENT", resultRate: 100 },
    { attendanceStatus: "PRESENT", resultRate: 80 },
    { attendanceStatus: "PRESENT", resultRate: 60 }
  ], "ATTENDANCE");
  assert.equal(summary.actualProgressRate, 100);
  assert.equal(summary.actualResultRate, 66.67);
  assert.equal(summary.appliedProgressRate, 100);
  assert.equal(summary.appliedResultRate, 60);
});

test("Sản lượng chỉ ghi nhận kết quả khi đạt kế hoạch", () => {
  const items = [
    { completedDateKey: "2026-07-30", progressRate: 100, plannedQuantity: 100, actualQuantity: 110, resultRate: 100 },
    { completedDateKey: "2026-07-31", progressRate: 100, plannedQuantity: 80, actualQuantity: 70, resultRate: 100 },
    { completedDateKey: "2026-08-01", progressRate: 80, plannedQuantity: 50, actualQuantity: 50, resultRate: 80 }
  ];
  const summary = calculateWorkItemSummary(items, "QUANTITY");
  assert.equal(summary.count, 3);
  assert.equal(summary.qualifiedCount, 2);
  assert.equal(summary.totalPlannedQuantity, 230);
  assert.equal(summary.totalActualQuantity, 230);
  assert.equal(summary.actualResultRate, 60);
  assert.equal(summary.appliedResultRate, 60);
});

test("KPI công việc cộng B và trả null khi A bằng 0", () => {
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

test("Nhiệm vụ miễn đánh giá không tham gia A, B hoặc mẫu số KPI", () => {
  const summary = calculateKpiSummary([
    {
      active: true,
      status: "DANG_XU_LY",
      planApprovalStatus: "APPROVED",
      includedInA: false,
      scoringEnabled: false,
      scoringStatus: "ADJUSTMENT_EXEMPT",
      recognized: false,
      maximumConvertedScore: 12,
      confirmedActualScore: 0
    },
    {
      active: true,
      status: "HOAN_THANH",
      planApprovalStatus: "APPROVED",
      includedInA: true,
      scoringEnabled: true,
      scoringStatus: "CONFIRMED",
      recognized: true,
      maximumConvertedScore: 10,
      confirmedActualScore: 8
    }
  ], 25);
  assert.equal(summary.A, 10);
  assert.equal(summary.B, 8);
  assert.equal(summary.kpi70, 56);
  assert.equal(summary.total100, 81);
});
