/**
 * Production 3C - Dashboard Read Service.
 * Tổng hợp dữ liệu chỉ đọc cho Dashboard.
 */

import { TaskReadService } from "./task-read-service.js?v=20260730.V1_1_11";
import { StandardTaskReadService } from "./standard-task-read-service.js?v=20260730.V1_1_11";
import { PeriodReadService } from "./period-read-service.js?v=20260728.V1_1_7";

export const DashboardReadService = Object.freeze({
  async load() {
    const [
      tasksResult,
      standardTasksResult,
      periodsResult
    ] = await Promise.allSettled([
      TaskReadService.list(),
      StandardTaskReadService.list(),
      PeriodReadService.list()
    ]);

    const tasks =
      tasksResult.status === "fulfilled"
        ? tasksResult.value
        : [];

    const standardTasks =
      standardTasksResult.status === "fulfilled"
        ? standardTasksResult.value
        : [];

    const periods =
      periodsResult.status === "fulfilled"
        ? periodsResult.value
        : [];

    return {
      tasks,

      taskSummary:
        TaskReadService.summarize(tasks),

      standardTasks,

      standardTaskSummary:
        StandardTaskReadService.summarize(standardTasks),

      periods,

      activePeriod:
        PeriodReadService.active(periods),

      warnings: [
        tasksResult.status === "rejected"
          ? `Không đọc được tasks: ${
              tasksResult.reason?.message || "Lỗi không xác định"
            }`
          : "",

        standardTasksResult.status === "rejected"
          ? `Không đọc được standardTasks: ${
              standardTasksResult.reason?.message || "Lỗi không xác định"
            }`
          : "",

        periodsResult.status === "rejected"
          ? `Không đọc được evaluationPeriods: ${
              periodsResult.reason?.message || "Lỗi không xác định"
            }`
          : ""
      ].filter(Boolean)
    };
  }
});
