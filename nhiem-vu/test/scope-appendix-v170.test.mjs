import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repo = resolve(import.meta.dirname, "../..");
const read = relative => readFileSync(resolve(repo, relative), "utf8");
const rules = read("firestore.rules");
const permissions = read("nhiem-vu/core/permissions.js");
const taskRead = read("nhiem-vu/services/task-read-service.js");
const catalogRead = read("nhiem-vu/services/standard-task-read-service.js");
const kpi = read("nhiem-vu/modules/kpi/kpi-workflow.js");
const notification = read("deployment/apps-script-notification-ai-evidence-v6.3.1.gs");

test("ADMIN và Ban Giám đốc là hai vai trò duy nhất đọc đồng thời Phòng/Khu và Chi đoàn", () => {
  assert.match(permissions, /canViewAllScopes\(\)[\s\S]*return this\.isAdmin\(\) \|\| this\.isDirector\(\)/);
  assert.match(rules, /function canViewAllScopes\(\)[\s\S]*return isAdmin\(\) \|\| isDirector\(\)/);
  assert.match(rules, /function canViewCenterScope\(departmentId\)/);
});

test("TCHC đọc toàn bộ dữ liệu chuyên môn nhưng không dùng truy vấn toàn collection có Chi đoàn", () => {
  assert.match(taskRead, /where\("primaryDepartmentId", "in", PROFESSIONAL_DEPARTMENT_IDS\)/);
  assert.match(catalogRead, /where\("departmentId", "in", PROFESSIONAL_DEPARTMENT_IDS\)/);
  assert.match(kpi, /professionalCenterScope/);
  assert.match(kpi, /where\('primaryDepartmentId', 'in', PROFESSIONAL_DEPARTMENT_IDS\)/);
});

test("Thành viên Chi đoàn có một báo cáo cá nhân gộp; tổng hợp Chi đoàn được kiểm soát riêng", () => {
  assert.match(kpi, /Permissions\.isCdtnMember\(\)/);
  assert.match(kpi, /Báo cáo KPI cá nhân/i);
  assert.doesNotMatch(kpi, /Cá nhân · Chi đoàn/);
  assert.match(kpi, /canViewCdtnAggregateReport/);
});

test("Rules có đầy đủ hàm thành viên Chi đoàn và không còn tham chiếu hàm không định nghĩa", () => {
  assert.match(rules, /function isCdtnExecutiveMember\(\)/);
  assert.match(rules, /function isCdtnMember\(\)/);
  assert.match(rules, /request\.resource\.data\.departmentId == "CDTN" && isCdtnMember\(\)/);
});

test("Phụ lục 04 được khóa ở bốn mức tại Rules cho lượt và đánh giá nhiệm vụ", () => {
  assert.match(rules, /function appendix04Rate\(value\)/);
  assert.match(rules, /value in \[0, 60, 80, 100\]/);
  assert.match(rules, /validWorkItemScoring/);
  assert.match(rules, /appendix04Rate\(data\.selfProgressRate\)/);
  assert.match(rules, /appendix04Rate\(request\.resource\.data\.confirmedResultRate\)/);
});

test("Apps Script dùng tài khoản dịch vụ để đọc Firestore và vẫn xác minh Firebase ID Token của người thao tác", () => {
  assert.match(notification, /verifyFirebaseIdToken_/);
  assert.match(notification, /FIREBASE_SERVICE_ACCOUNT_EMAIL/);
  assert.match(notification, /FIREBASE_PRIVATE_KEY/);
  assert.match(notification, /firestoreServerBearer_/);
  assert.match(notification, /computeRsaSha256Signature/);
});

test("Thông báo nhiệm vụ Chi đoàn gửi cho cả Bí thư và Phó Bí thư", () => {
  assert.match(notification, /CDTN_BI_THU/);
  assert.match(notification, /CDTN_PHO_BI_THU/);
  assert.match(notification, /professionalLeader \|\| cdtnLeader/);
});
