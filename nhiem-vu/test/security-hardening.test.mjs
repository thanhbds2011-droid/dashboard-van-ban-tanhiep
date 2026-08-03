import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repo = resolve(import.meta.dirname, "../..");
const read = relative => readFileSync(resolve(repo, relative), "utf8");
const rules = read("firestore.rules");
const app = read("nhiem-vu/app-v3.js");
const userRead = read("nhiem-vu/services/user-read-service.js");
const standardRead = read("nhiem-vu/services/standard-task-read-service.js");
const kpi = read("nhiem-vu/modules/kpi/kpi-workflow.js");
const sw = read("nhiem-vu/sw.js");
const accountScript = read("deployment/apps-script-account-sync-v3.2.2.gs");

test("STAFF không thể tạo nhiệm vụ trực tiếp trong Rules", () => {
  const body = /function canCreateTask\(\)\s*\{([\s\S]*?)\n\s*\}/.exec(rules)?.[1] || "";
  assert.doesNotMatch(body, /isStaff\(\)/);
  assert.match(body, /isAdmin\(\)/);
  assert.match(body, /isDirector\(\)/);
  assert.match(body, /isDepartmentLeader\(\)/);
});

test("Quyền xem toàn Trung tâm không được tái sử dụng làm quyền sửa", () => {
  const body = /function canManageTask\(data\)\s*\{([\s\S]*?)\n\s*\}/.exec(rules)?.[1] || "";
  assert.doesNotMatch(body, /canViewAllDepartments/);
  assert.match(body, /sameDepartment\(taskScopeDepartmentId\(data\)\)/);
});

test("Subscription giữ bất biến UID và External ID", () => {
  assert.match(rules, /request\.resource\.data\.userId == resource\.data\.userId/);
  assert.match(rules, /request\.resource\.data\.uid == resource\.data\.uid/);
  assert.match(rules, /request\.resource\.data\.uid == request\.auth\.uid/);
  assert.match(rules, /request\.resource\.data\.externalId == request\.auth\.uid/);
  assert.match(app, /externalId: user\.uid/);
});

test("KPI và tiêu chí chung dùng document ID xác định", () => {
  assert.match(rules, /evaluationId == request\.resource\.data\.periodId \+ "_" \+ request\.resource\.data\.taskId/);
  assert.match(rules, /function commonAssessmentDocumentIdValid/);
  assert.match(rules, /data\.periodId \+ "_" \+ data\.departmentId \+ "_" \+ data\.userId/);
  assert.match(rules, /profileId == request\.resource\.data\.periodId \+ "_" \+ request\.resource\.data\.userId/);
  assert.match(kpi, /doc\(db,'taskEvaluations',`\$\{KpiWorkflowState\.period\.id\}_\$\{task\.id\}`\)/);
});

test("Nhật ký nhiệm vụ phải đi cùng dữ liệu nhiệm vụ sau giao dịch", () => {
  assert.match(rules, /existsAfter\(parentTaskPath\(request\.resource\.data\.taskId\)\)/);
  assert.match(rules, /getAfter\(parentTaskPath\(request\.resource\.data\.taskId\)\)\.data\.updatedByUserId == request\.auth\.uid/);
});

test("Truy vấn người dùng và danh mục bám theo phạm vi Rules", () => {
  assert.match(userRead, /where\("departmentId", "==", user\.departmentId\)/);
  assert.match(userRead, /getDoc\([\s\S]*"users", user\.uid/);
  assert.match(standardRead, /where\("audienceType", "==", audienceType\)/);
  assert.match(standardRead, /CDTN_MEMBER/);
});

test("PWA đóng gói app và module đang hoạt động", () => {
  assert.match(sw, /app-v3\.js\?v=20260803\.V1_7_2/);
  assert.match(sw, /modules\/kpi\/kpi-workflow\.js\?v=20260803\.V1_7_2/);
  assert.match(sw, /Promise\.allSettled/);
});


test("Xác nhận điểm nhiệm vụ phải ghi evaluation và task trong cùng batch", () => {
  assert.match(rules, /taskEvaluations\/\$\(resource\.data\.periodId \+ "_" \+ taskId\)/);
  assert.match(rules, /getAfter\([\s\S]*confirmedActualScore == request\.resource\.data\.confirmedActualScore/);
  assert.match(kpi, /const scoreBatch=writeBatch\(db\)/);
  assert.match(kpi, /await scoreBatch\.commit\(\)/);
});

test("Đồng bộ tài khoản kiểm tra ngữ nghĩa role, chức danh và đơn vị", () => {
  assert.match(accountScript, /validateRoleSemantics_/);
  assert.match(accountScript, /DIRECTOR bắt buộc thuộc Phòng\/Khu BGD/);
  assert.match(accountScript, /TCHC_COORDINATOR bắt buộc thuộc TCHC/);
  assert.match(accountScript, /DEPARTMENT_LEADER phải có chức danh/);
});
