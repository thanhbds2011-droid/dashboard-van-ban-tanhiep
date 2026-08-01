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
const rules = readFileSync(resolve(root, "../../../firestore_V1_3_1.rules"), "utf8");
const appsScript = readFileSync(resolve(root, "../../../APPS_SCRIPT_THONG_BAO_AI_V6_0_0.gs"), "utf8");

assert.match(taskRead, /where\("periodId",\s*"==",\s*periodId\)/, "Nhiệm vụ phải được lọc theo kỳ.");
assert.match(taskRead, /TASK_CACHE_MS/, "Dịch vụ nhiệm vụ phải có bộ nhớ đệm ngắn.");
assert.doesNotMatch(dashboardView, /\.subscribe\(/, "Trang chủ không được mở listener sau lần tải đầu.");
assert.doesNotMatch(tasksView, /\.subscribe\(/, "Danh sách nhiệm vụ không được mở listener nền.");
assert.doesNotMatch(catalogView, /startStandardRealtime/, "Danh mục không được mở listener nền.");

const realtimeBody = /function setupKpiRealtime\(\)\s*\{([\s\S]*?)\n\}/.exec(kpiWorkflow)?.[1] || "";
assert.doesNotMatch(realtimeBody, /onSnapshot\(/, "KPI không được mở listener nền.");
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
