import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '../..');
const read = relative => readFileSync(resolve(repo, relative), 'utf8');
const rules = read('firestore.rules');
const accountSync = read('deployment/apps-script-account-sync-v3.3.0.gs');
const catalogSync = read('deployment/apps-script-standard-tasks-v4.2.0.gs');
const catalogRead = read('nhiem-vu/services/standard-task-read-service.js');
const catalogWrite = read('nhiem-vu/services/standard-task-write-service.js');
const taskRead = read('nhiem-vu/services/task-read-service.js');
const taskView = read('nhiem-vu/modules/tasks/tasks-view.js');
const kpi = read('nhiem-vu/modules/kpi/kpi-workflow.js');
const app = read('nhiem-vu/app-v3.js');
const index = read('nhiem-vu/index.html');
const css = read('nhiem-vu/v3.css');


test('V1.8.0 chuẩn hóa Trưởng/Phó bằng metadata rõ ràng', () => {
  assert.match(accountSync, /VERSION: '3\.3\.0'/);
  assert.match(accountSync, /function derivedLeaderMetadata_/);
  assert.match(accountSync, /leaderLevel: 'HEAD'/);
  assert.match(accountSync, /leaderLevel: 'DEPUTY'/);
  assert.match(accountSync, /isDepartmentHead: \{ booleanValue:/);
  assert.match(rules, /hasField\(data, "leaderLevel"\)/);
  assert.match(rules, /hasField\(data, "isDepartmentHead"\)/);
});


test('audienceType quyết định quyền danh mục, cờ cốt lõi và quản lý chỉ là metadata', () => {
  assert.match(catalogRead, /audienceType là nguồn quyết định quyền đăng ký/);
  assert.match(catalogRead, /audience === "ALL_DEPARTMENT"/);
  assert.match(catalogRead, /\["ALL_DEPARTMENT", "MANAGEMENT"\]\.includes\(audience\)/);
  assert.match(rules, /function standardTaskAudience\(data\)/);
  assert.match(rules, /audience == "ALL_DEPARTMENT"/);
  assert.match(rules, /audience in \["ALL_DEPARTMENT", "MANAGEMENT"\]/);
});


test('cấp mã danh mục dùng số lớn nhất cộng một và Sheet tự chữa sequence', () => {
  assert.match(catalogWrite, /MONOTONIC_MAX_PLUS_ONE/);
  assert.match(catalogWrite, /Math\.max\(observedState\.highestExistingNumber, storedHighest\) \+ 1/);
  assert.match(catalogSync, /VERSION: '4\.2\.0'/);
  assert.match(catalogSync, /standardTaskSequences/);
  assert.match(catalogSync, /MONOTONIC_MAX_PLUS_ONE/);
  assert.match(catalogSync, /sequence/);
});


test('Trưởng/Phó Phòng/Khu theo dõi Chi đoàn trong vùng riêng nhưng không tự có quyền sửa', () => {
  assert.match(catalogRead, /Permissions\.isDepartmentLeader\(\) \|\| canRegisterCdtnItem/);
  assert.match(catalogRead, /where\("departmentId", "==", "CDTN"\)/);
  assert.match(taskRead, /where\("organizationId", "==", "CDTN"\)/);
  assert.match(taskRead, /where\("primaryDepartmentId", "==", "CDTN"\)/);
  assert.match(rules, /taskIsCdtn\(data\)[\s\S]*isDepartmentLeader\(\)/);
  const manageBody = /function canManageTask\(data\) \{([\s\S]*?)\n\s*\}/.exec(rules)?.[1] || '';
  assert.doesNotMatch(manageBody, /isDepartmentLeader\(\)\s*\|\|\s*taskIsCdtn/);
  assert.match(taskView, /Nhiệm vụ Phòng\/Khu/);
  assert.match(taskView, /Nhiệm vụ Chi đoàn/);
  assert.match(css, /task-workspace-grid/);
});


test('Báo cáo cá nhân gộp chuyên môn và Chi đoàn thành một kết quả tối đa 100 điểm', () => {
  assert.match(kpi, /Báo cáo KPI cá nhân/);
  assert.match(kpi, /Gộp nhiệm vụ Phòng\/Khu/);
  assert.match(kpi, /taskScopeDepartmentId\(task\) === 'CDTN'/);
  assert.match(kpi, /NHÓM TIÊU CHÍ CHUNG \(30 ĐIỂM\)/);
  assert.match(kpi, /KẾT QUẢ THỰC HIỆN NHIỆM VỤ ĐƯỢC GIAO \(70 ĐIỂM\)/);
  assert.match(kpi, /TỔNG \(A \+ B\)/);
  assert.doesNotMatch(kpi, /Cá nhân · Chi đoàn/);
});


test('Báo cáo tổng hợp Chi đoàn chỉ phục vụ quản trị và không tạo xếp loại thứ hai', () => {
  assert.match(kpi, /Tổng hợp Chi đoàn/);
  assert.match(kpi, /không tạo xếp loại cá nhân thứ hai/i);
  assert.match(kpi, /Báo cáo quản trị riêng nhiệm vụ Chi đoàn; không cộng tiêu chí chung, không tính tổng 100 điểm/i);
});


test('Cài đặt thông báo cố định và đăng xuất vô hiệu hóa đúng thiết bị', () => {
  assert.match(index, /id="btnPushSettings"/);
  assert.match(index, /id="pushSettingsModal"/);
  assert.match(index, /Subscription ID/);
  assert.match(app, /function bindPushSettings\(user\)/);
  assert.match(app, /`\$\{currentPushUser\.uid\}_\$\{snapshot\.subscriptionId\}`/);
  assert.match(app, /active: false/);
  assert.match(app, /await window\.TaskPush\?\.logout\?\.\(\)/);
  assert.match(rules, /subscriptionDocumentId == request\.auth\.uid \+ "_" \+ request\.resource\.data\.subscriptionId/);
});



test('Tiêu chí chung chỉ được tạo ở Phòng/Khu chuyên môn của người dùng', () => {
  assert.match(kpi, /const commonDepartmentId=profileDepartmentId\(\)/);
  assert.match(rules, /request\.resource\.data\.departmentId == currentUser\(\)\.departmentId/);
  assert.match(rules, /request\.resource\.data\.departmentId != "CDTN"/);
  assert.match(rules, /request\.resource\.data\.scopeType == "PROFESSIONAL"/);
});

test('Một truy vấn phụ bị lỗi không làm hỏng toàn bộ danh mục, nhiệm vụ hoặc KPI', () => {
  assert.match(catalogRead, /Promise\.allSettled/);
  assert.match(taskRead, /Promise\.allSettled/);
  assert.match(kpi, /Promise\.allSettled/);
  assert.match(kpi, /Không tải được nhánh/);
  assert.match(catalogRead, /failed\.every\(Boolean\)/);
  assert.match(taskRead, /failed\.every\(Boolean\)/);
});
