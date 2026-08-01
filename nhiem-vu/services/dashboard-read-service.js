/**
 * Production 3C - Dashboard Read Service.
 * Tổng hợp dữ liệu chỉ đọc cho Dashboard.
 */

import { TaskReadService } from "./task-read-service.js?v=20260801.V1_3_0";
import { PeriodReadService } from "./period-read-service.js?v=20260801.V1_3_0";

export const DashboardReadService = Object.freeze({
  async load(options = {}) {
    const force = options.force === true;
    const [
      tasksResult,
      activePeriodResult
    ] = await Promise.allSettled([
      TaskReadService.list({ force }),
      PeriodReadService.getActive({ force })
    ]);

    const tasks =
      tasksResult.status === "fulfilled"
        ? tasksResult.value
        : [];

    const activePeriod = activePeriodResult.status === "fulfilled"
      ? activePeriodResult.value
      : null;

    return {
      tasks,

      taskSummary:
        TaskReadService.summarize(tasks),

      // Danh mục chỉ được tải khi người dùng mở đúng phân hệ, không đọc ở Trang chủ.
      standardTasks: [],
      standardTaskSummary: null,

      periods: activePeriod ? [activePeriod] : [],

      activePeriod,

      warnings: [
        tasksResult.status === "rejected"
          ? `Không đọc được tasks: ${
              tasksResult.reason?.message || "Lỗi không xác định"
            }`
          : "",

        activePeriodResult.status === "rejected"
          ? `Không đọc được evaluationPeriods: ${
              activePeriodResult.reason?.message || "Lỗi không xác định"
            }`
          : ""
      ].filter(Boolean)
    };
  }
});
