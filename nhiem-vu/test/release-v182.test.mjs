import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repo = resolve(import.meta.dirname, "../..");
const read = relative => readFileSync(resolve(repo, relative), "utf8");

const adjustmentService = read("nhiem-vu/services/task-adjustment-service.js");
const adjustmentPanel = read("nhiem-vu/modules/tasks/task-adjustment-panel.js");
const taskRead = read("nhiem-vu/services/task-read-service.js");
const tasksView = read("nhiem-vu/modules/tasks/tasks-view.js");
const dashboardView = read("nhiem-vu/modules/dashboard/dashboard-view.js");
const kpiWorkflow = read("nhiem-vu/modules/kpi/kpi-workflow.js");
const rules = read("firestore.rules");
const indexes = JSON.parse(read("firestore.indexes.json"));
const sw = read("nhiem-vu/sw.js");
const index = read("nhiem-vu/index.html");

function hasIndex(collectionGroup, fields) {
  return indexes.indexes.some(indexDefinition => {
    if (indexDefinition.collectionGroup !== collectionGroup) return false;
    const actual = indexDefinition.fields.map(field => [field.fieldPath, field.arrayConfig || field.order]);
    return JSON.stringify(actual) === JSON.stringify(fields);
  });
}

test("Miễn đánh giá được phép sau khi hoàn thành nếu điểm chưa khóa", () => {
  assert.match(adjustmentService, /requestedType === TYPES\.EXEMPT_FROM_SCORING[\s\S]*return true/);
  assert.match(adjustmentService, /requestedType === TYPES\.ADJUST_SCOPE && !completedTask\(task\)/);
  assert.match(rules, /request\.resource\.data\.adjustmentType == "EXEMPT_FROM_SCORING"[\s\S]*resource\.data\.status in \["HOAN_THANH", "COMPLETED", "DA_HOAN_THANH"\]/);
  assert.match(rules, /data\.adjustmentType == "EXEMPT_FROM_SCORING"[\s\S]*task\.status in \["HOAN_THANH", "COMPLETED", "DA_HOAN_THANH"\]/);
});

test("Điều chỉnh phạm vi vẫn bị khóa sau khi nhiệm vụ hoàn thành", () => {
  assert.match(adjustmentService, /completedTask\(task\) && requestedType === TYPES\.ADJUST_SCOPE/);
  assert.match(adjustmentPanel, /taskCompleted/);
  assert.match(adjustmentPanel, /<option value="ADJUST_SCOPE" \$\{taskCompleted\(task\) \? "disabled" : ""\}/);
  assert.match(adjustmentPanel, /Miễn đánh giá do điều động/);
});

test("Luồng gửi đề nghị được Rules xét trước các nhánh cập nhật khác", () => {
  assert.match(rules, /allow update: if ownerCanRequestTaskAdjustment\(taskId\)[\s\S]*adjustmentApproverCanUpdateTask\(taskId\)/);
  assert.match(rules, /existsAfter\(\/databases\/\$\(database\)\/documents\/kpiAdjustments\/\$\(request\.resource\.data\.pendingAdjustmentId\)\)/);
  assert.match(rules, /TASK_ADJUSTMENT_REQUESTED/);
});

test("Lãnh đạo Phòng/Khu đọc cả trường nhiệm vụ cũ do Ban Giám đốc giao", () => {
  assert.match(taskRead, /where\("primaryDepartmentId", "==", departmentId\)/);
  assert.match(taskRead, /where\("visibleDepartmentIds", "array-contains", departmentId\)/);
  assert.match(taskRead, /where\("supportDepartmentIds", "array-contains", departmentId\)/);
  assert.match(taskRead, /where\("relatedDepartmentIds", "array-contains", departmentId\)/);
});

test("Có đủ index cho các nhánh phòng phối hợp và phòng liên quan", () => {
  assert.equal(hasIndex("tasks", [["periodId", "ASCENDING"], ["supportDepartmentIds", "CONTAINS"]]), true);
  assert.equal(hasIndex("tasks", [["periodId", "ASCENDING"], ["relatedDepartmentIds", "CONTAINS"]]), true);
});

test("Nhiệm vụ, Trang chủ, KPI và Báo cáo cập nhật trực tiếp", () => {
  assert.match(taskRead, /FirebaseService\.onSnapshot/);
  assert.match(tasksView, /TaskReadService\.subscribe\(/);
  assert.match(tasksView, /stopTasksRealtime/);
  assert.match(dashboardView, /TaskReadService\.subscribe\(/);
  assert.match(dashboardView, /stopDashboardTaskRealtime/);
  assert.match(kpiWorkflow, /startKpiRealtime/);
  assert.match(kpiWorkflow, /TaskReadService\.subscribe\(/);
  assert.match(kpiWorkflow, /stopKpiRealtime/);
});

test("Bản phát hành và cache là V1.8.2", () => {
  assert.match(index, /V1\.8\.2/);
  assert.match(index, /20260804\.V1_8_2/);
  assert.match(sw, /nhiem-vu-20260804-v1-8-2/);
  assert.doesNotMatch(sw, /20260804\.V1_8_1/);
});
