import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repo = resolve(import.meta.dirname, "../..");
const read = relative => readFileSync(resolve(repo, relative), "utf8");
const rules = read("firestore.rules");
const indexes = JSON.parse(read("firestore.indexes.json"));
const kpi = read("nhiem-vu/modules/kpi/kpi-workflow.js");
const standardView = read("nhiem-vu/modules/standard-tasks/standard-tasks-view.js");
const registration = read("nhiem-vu/services/task-registration-service.js");
const standardRead = read("nhiem-vu/services/standard-task-read-service.js");
const tasksView = read("nhiem-vu/modules/tasks/tasks-view.js");
const accountSync = read("deployment/apps-script-account-sync-v3.3.1.gs");
const sw = read("nhiem-vu/sw.js");

function hasIndex(collectionGroup, fieldPath) {
  return indexes.indexes.some(index => index.collectionGroup === collectionGroup
    && index.fields.some(field => field.fieldPath === "periodId")
    && index.fields.some(field => field.fieldPath === fieldPath));
}

test("Danh sách ủy quyền hiển thị vai trò Chi đoàn, không dùng chức danh chuyên môn", () => {
  assert.match(standardView, /function cdtnRoleLabel\(item\)/);
  assert.match(standardView, /cdtnRoleLabel\(item\)/);
  assert.doesNotMatch(standardView, /item\.position \|\| "Kiêm nhiệm Chi đoàn"/);
  assert.match(registration, /delegateCdtnRoleLabel: cdtnRoleLabel\(delegate\)/);
});

test("Danh bạ Chi đoàn được đồng bộ vai trò ưu tiên và nhãn hiển thị", () => {
  assert.match(accountSync, /VERSION: '3\.3\.1'/);
  assert.match(accountSync, /cdtnRole:/);
  assert.match(accountSync, /cdtnRoleLabel:/);
  assert.match(accountSync, /Ủy viên BCH Chi đoàn/);
});

test("Rules xác thực người được ủy quyền từ cdtnMembers", () => {
  assert.match(rules, /function validCdtnDirectoryTarget\(userId\)/);
  assert.match(rules, /activeCdtnMemberDirectory\(userId\)/);
  assert.match(rules, /validCdtnApprovalTarget/);
  assert.match(rules, /validCdtnAttendanceTarget/);
});

test("KPI và báo cáo nhận diện nhiệm vụ Chi đoàn cũ bằng phạm vi logic", () => {
  assert.match(kpi, /function taskScopeDepartmentId\(task\)/);
  assert.match(kpi, /organizationId === 'CDTN'/);
  assert.match(kpi, /taskScopeDepartmentId\(task\)/);
  assert.match(tasksView, /function taskWorkspaceId\(task\)/);
});

test("Mỗi cá nhân chỉ dùng một bộ tiêu chí chung 30 điểm trong kỳ", () => {
  assert.match(kpi, /return `\$\{periodId\}_\$\{userId\}`/);
  assert.match(kpi, /const commonDepartmentId=profileDepartmentId\(\)/);
  assert.match(kpi, /scopeType:'PROFESSIONAL'/);
  assert.doesNotMatch(kpi, /`\$\{periodId\}_CDTN_\$\{userId\}`/);
  assert.match(rules, /commonAssessmentDocumentIdValid/);
});

test("Báo cáo tổng hợp Chi đoàn chỉ thống kê nhiệm vụ, không tạo tổng điểm hoặc xếp loại thứ hai", () => {
  assert.match(kpi, /BẢNG TỔNG HỢP HOẠT ĐỘNG CHI ĐOÀN/);
  assert.match(kpi, /taskScopeDepartmentId\(task\) === 'CDTN'/);
  assert.match(kpi, /không cộng tiêu chí chung, không tính tổng 100 điểm/i);
  assert.match(kpi, /Điểm kế hoạch \(A\)/);
  assert.match(kpi, /Điểm thực tế \(B\)/);
});

test("Các truy vấn tương thích organizationId có đủ composite index", () => {
  assert.equal(hasIndex("tasks", "organizationId"), true);
  assert.equal(hasIndex("taskRegistrations", "organizationId"), true);
  assert.equal(hasIndex("taskEvaluations", "organizationId"), true);
});

test("Trưởng/Phó phòng không dùng quyền đọc toàn trung tâm để tải toàn bộ danh mục", () => {
  assert.match(standardRead, /if \(Permissions\.isTchcCoordinator\(\)\)/);
  assert.doesNotMatch(standardRead, /if \(Permissions\.canViewAllDepartments\(\)\) \{[\s\S]*departmentId", "in"/);
});

test("Thanh lọc nhiệm vụ có sync nhỏ cùng hàng", () => {
  assert.match(tasksView, /tasks-toolbar-compact/);
  assert.match(tasksView, /compact-sync-button/);
  assert.match(tasksView, /button\.classList\.add\("is-loading"\)/);
});

test("Service Worker và import graph dùng V1.8.2", () => {
  assert.match(sw, /nhiem-vu-20260804-v1-8-2/);
  assert.match(sw, /app-v3\.js\?v=20260804\.V1_8_2/);
});
