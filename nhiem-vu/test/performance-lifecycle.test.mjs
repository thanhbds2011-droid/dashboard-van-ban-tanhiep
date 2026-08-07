import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = relative => readFileSync(resolve(root, relative), "utf8");

const taskRead = read("services/task-read-service.js");
const dashboardView = read("modules/dashboard/dashboard-view.js");
const tasksView = read("modules/tasks/tasks-view.js");
const catalogView = read("modules/standard-tasks/standard-tasks-view.js");
const kpiWorkflow = read("modules/kpi/kpi-workflow.js");
const archiveService = read("services/period-archive-service.js");
const taskWrite = read("services/task-write-service.js");
const registrationService = read("services/task-registration-service.js");
const rules = readFileSync(resolve(root, "../firestore.rules"), "utf8");
const appsScript = readFileSync(resolve(root, "../deployment/apps-script-notification-ai-evidence-v6.4.0.gs"), "utf8");

assert.match(taskRead, /where\("periodId",\s*"==",\s*periodId\)/, "Nhiệm vụ phải được lọc theo kỳ.");
assert.match(taskRead, /TASK_CACHE_MS/, "Dịch vụ nhiệm vụ phải có bộ nhớ đệm ngắn.");
assert.match(dashboardView, /TaskReadService\.subscribe\(/, "Trang chủ phải nhận thay đổi nhiệm vụ trực tiếp.");
assert.match(dashboardView, /stopDashboardTaskRealtime/, "Trang chủ phải đóng listener khi rời màn hình.");
assert.match(tasksView, /TaskReadService\.subscribe\(/, "Danh sách nhiệm vụ phải nhận thay đổi trực tiếp.");
assert.match(tasksView, /stopTasksRealtime/, "Danh sách nhiệm vụ phải đóng listener khi rời màn hình.");
assert.doesNotMatch(catalogView, /startStandardRealtime/, "Danh mục không mở listener khi không có nhu cầu giao việc trực tiếp.");
assert.match(kpiWorkflow, /startKpiRealtime/, "KPI và Báo cáo phải tự nạp lại khi nhiệm vụ thay đổi.");
assert.match(kpiWorkflow, /stopKpiRealtime/, "KPI phải đóng listener khi rời phân hệ.");
assert.match(kpiWorkflow, /2026-M08/, "Quản lý kỳ phải hỗ trợ mã kỳ tháng.");
assert.match(kpiWorkflow, /PeriodArchiveService\.archiveAndPurge/, "KPI phải lưu Drive trước khi dọn Firestore.");

for (const collection of ["tasks", "taskWorkItems", "taskLogs", "taskRegistrations", "taskEvaluations", "commonCriteriaAssessments"]) {
  assert.match(archiveService, new RegExp(`"${collection}"`), `Thiếu ${collection} trong gói lưu trữ.`);
}
assert.match(archiveService, /sha256/, "Tệp lưu trữ phải được kiểm tra SHA-256.");
assert.match(rules, /function periodArchiveReady/, "Rules phải chặn xóa khi chưa có tệp lưu trữ.");
assert.match(rules, /match \/periodArchives\//, "Rules phải bảo vệ biên nhận lưu trữ.");
assert.match(appsScript, /ARCHIVE_PERIOD_DATA/, "Apps Script phải nhận yêu cầu lưu trữ kỳ.");
assert.match(appsScript, /PERIOD_ARCHIVE_GET_RESULT/, "Apps Script phải trả kết quả lưu trữ kỳ.");

assert.match(taskWrite, /-DX/, "Nhiệm vụ đột xuất phải dùng mã -DX.");
assert.doesNotMatch(registrationService, /`NV-/, "Nhiệm vụ từ danh mục không được sinh mã NV ngẫu nhiên.");

console.log("Performance and lifecycle checks: OK");
