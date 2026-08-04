/**
 * Production 3C - Dashboard Read Service.
 * Tổng hợp dữ liệu chỉ đọc cho Dashboard.
 */

import { TaskReadService } from "./task-read-service.js?v=20260804.V1_8_0";
import { PeriodReadService } from "./period-read-service.js?v=20260804.V1_8_0";

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
          ? "Chưa tải được số liệu nhiệm vụ. Vui lòng bấm Cập nhật; nếu lỗi vẫn còn, liên hệ quản trị viên."
          : "",

        activePeriodResult.status === "rejected"
          ? "Chưa tải được thông tin kỳ đánh giá. Vui lòng bấm Cập nhật và thử lại."
          : ""
      ].filter(Boolean)
    };
  }
});
