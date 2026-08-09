import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const read = rel => readFileSync(resolve(root, rel), 'utf8');

test('V1.10.2 dùng một build version thống nhất ở entry point/PWA', () => {
  const version = read('core/app-version.js');
  const index = read('index.html');
  const pwa = read('pwa.js');
  const sw = read('sw.js');
  assert.match(version, /APP_VERSION = "1\.10\.2"/);
  assert.match(version, /BUILD_VERSION = "20260809\.V1_10_2"/);
  assert.match(index, /ui-v1\.10\.2\.css\?v=20260809\.V1_10_2/);
  assert.match(index, /release-v1\.10\.2\.js\?v=20260809\.V1_10_2/);
  assert.match(pwa, /app-version\.js\?v=20260809\.V1_10_2/);
  assert.match(sw, /20260809\.V1_10_2/);
});

test('Trang chủ đã bỏ hai khối trùng lặp', () => {
  const dashboard = read('modules/dashboard/dashboard-view.js');
  assert.doesNotMatch(dashboard, /<h3>Truy cập nhanh<\/h3>/);
  assert.doesNotMatch(dashboard, /<h3>Tình trạng dữ liệu<\/h3>/);
  assert.match(dashboard, /Theo dõi theo Phòng\/Khu/);
});

test('Danh mục có lọc Phòng/Khu và workspace đúng đơn vị thật', () => {
  const view = read('modules/standard-tasks/standard-tasks-view.js');
  const service = read('services/standard-task-read-service.js');
  assert.match(view, /id="standardTaskDepartmentFilter"/);
  assert.match(view, /id="standardTaskRegistrationFilter"/);
  assert.match(view, /defaultDepartmentScope/);
  assert.match(view, /Đã tạo \$\{result\.code\} trong Danh mục công việc/);
  assert.match(service, /return itemDepartmentId \|\| upper\(user\.departmentId\)/);
  assert.match(service, /Permissions\.isTchcDepartmentLeader\(\)/);
});

test('Push giao việc được gọi chủ động và bridge vẫn là dự phòng chống trùng', () => {
  const writer = read('services/task-write-service.js');
  const director = read('services/director-task-service.js');
  const bridge = read('services/task-notification-bridge.js');
  assert.match(writer, /TaskNotificationService\.send\([\s\S]*TASK_INTERNAL_ASSIGNED/);
  assert.match(writer, /TASK_PERSONAL_ACCEPTED/);
  assert.match(writer, /TASK_DEPARTMENT_ASSIGNED/);
  assert.match(director, /TaskNotificationService\.send\([\s\S]*TASK_TEAM_DIRECT_ASSIGNED/);
  assert.match(bridge, /TASK_DEPARTMENT_ACCEPTED: "TASK_DEPARTMENT_ACCEPTED"/);
  assert.match(bridge, /TASK_ACCEPTED: "TASK_PERSONAL_ACCEPTED"/);
  assert.match(bridge, /eventId: `TASKLOG_\$\{chosen\.id\}`/);
});

test('Mobile menu mở trực tiếp Cài đặt thông báo và có in-app alert', () => {
  const app = read('app-v3.js');
  assert.match(app, /document\.getElementById\("btnMobilePushSettings"\)/);
  assert.match(app, /bindInAppTaskAssignmentAlerts\(user\)/);
  assert.match(app, /Bạn vừa được giao/);
});

test('UI người dùng không còn nhãn Firestore/OneSignal/Subscription ID trong modal thông báo', () => {
  const index = read('index.html');
  assert.doesNotMatch(index, /<dt>Firestore<\/dt>/);
  assert.doesNotMatch(index, /<dt>OneSignal<\/dt>/);
  assert.doesNotMatch(index, /<dt>Subscription ID<\/dt>/);
  assert.match(index, /<dt>Liên kết hệ thống<\/dt>/);
  assert.match(index, /<dt>Mã thiết bị<\/dt>/);
});
