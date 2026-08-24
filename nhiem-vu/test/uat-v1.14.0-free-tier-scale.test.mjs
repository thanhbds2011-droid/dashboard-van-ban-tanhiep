import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const repo = path.resolve(root, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const readRepo = p => fs.readFileSync(path.join(repo, p), 'utf8');

test('V1.14.1 tiếp tục dùng version/cache tập trung', () => {
  const source = read('core/app-version.js');
  assert.match(source, /APP_VERSION = "1\.14\.1"/);
  assert.match(source, /BUILD_VERSION = "20260824\.V1_14_1"/);
  assert.match(source, /CACHE_NAME = "nhiem-vu-20260824-v1-14-1"/);
});

test('App lazy-load route, không tải toàn bộ KPI ngay khi mở ứng dụng', () => {
  const source = read('app-v3.js');
  assert.match(source, /function lazyRoute\(/);
  assert.match(source, /import\(modulePath\)/);
  assert.match(source, /lazyRoute\("\.\/modules\/reports\/reports-view\.js\?v=20260824\.V1_14_1"/);
  assert.match(read('modules/reports/reports-view.js'), /kpi-workflow\.js\?v=20260824\.V1_14_1/);
  assert.doesNotMatch(source, /import\s*\{\s*renderReportsView\s*\}\s*from\s*["']\.\/modules\/reports/);
});

test('Thông báo nhiệm vụ toàn cục chỉ nghe nhiệm vụ của kỳ hiện hành và chính UID', () => {
  const source = read('app-v3.js');
  assert.match(source, /bindInAppTaskAssignmentAlerts/);
  assert.match(source, /where\("periodId", "==", period\.id\)/);
  assert.match(source, /where\("ownerUserId", "==", user\.uid\)/);
  assert.match(source, /limit\(300\)/);
});

test('Push subscription không ghi Firestore lại ở mỗi lần mở app', () => {
  const app = read('app-v3.js');
  const executive = read('services/executive-push-subscription-service.js');
  assert.match(app, /taskPushSync:/);
  assert.match(app, /12 \* 60 \* 60 \* 1000/);
  assert.match(executive, /fingerprint/);
  assert.match(executive, /12 \* 60 \* 60 \* 1000/);
  assert.match(executive, /force: true/);
});

test('TaskRead cache 2 phút và listener có delay+jitter', () => {
  const source = read('services/task-read-service.js');
  assert.match(source, /TASK_CACHE_MS\s*=\s*2 \* 60 \* 1000/);
  assert.match(source, /startDelayMs/);
  assert.match(source, /jitterMs/);
  assert.match(source, /setTimeout\(begin, delay\)/);
});

test('Dashboard/Tasks tải trước rồi mới mở realtime nền', () => {
  const dashboard = read('modules/dashboard/dashboard-view.js');
  const tasks = read('modules/tasks/tasks-view.js');
  for (const source of [dashboard, tasks]) {
    assert.match(source, /startDelayMs:\s*90 \* 1000/);
    assert.match(source, /jitterMs:\s*30 \* 1000/);
  }
});

test('Báo cáo KPI không mở listener rộng; refresh thủ công có dedupe/cooldown', () => {
  const source = read('modules/kpi/kpi-workflow.js');
  assert.match(source, /KpiWorkflowState\.mode === 'reports'/);
  assert.match(source, /Đã tải · bấm ↻ để cập nhật/);
  assert.match(source, /KPI_MANUAL_REFRESH_COOLDOWN_MS = 8000/);
  assert.match(source, /if \(kpiReloadPromise\) return kpiReloadPromise/);
  assert.match(source, /addEventListener\('click', manualRefreshKpi\)/);
});

test('KPI dùng UserContext thay vì đọc lại users/{uid} khi vào route', () => {
  const source = read('modules/kpi/kpi-workflow.js');
  assert.match(source, /normalizeUserRecord\(UserContext\.requireUser\(\), KpiWorkflowState\.user\.uid\)/);
});

test('KPI có giới hạn query chống runaway trên dữ liệu lớn', () => {
  const source = read('modules/kpi/kpi-workflow.js');
  assert.match(source, /limit\(5000\)/);
  assert.match(source, /limit\(2000\)/);
  assert.match(source, /limit\(300\)/);
  assert.match(source, /limit\(10000\)/);
});

test('Profile server check được dedupe/throttle nhưng PWA resume dài vẫn force refresh', () => {
  const source = read('core/auth-service.js');
  assert.match(source, /PROFILE_SERVER_CHECK_MIN_MS = 2 \* 60 \* 1000/);
  assert.match(source, /profileServerCheckPromise/);
  assert.match(source, /app:pwa-resumed/);
  assert.match(source, /refreshProfileScopeFromServer\(currentFirebaseUser, \{ force: true \}\)/);
});

test('PWA chỉ kiểm tra update định kỳ hợp lý, không spam mỗi foreground', () => {
  const source = read('pwa.js');
  assert.match(source, /UPDATE_CHECK_MIN_MS = 30 \* 60 \* 1000/);
  assert.match(source, /updateCheckPromise/);
  assert.match(source, /checkForUpdate\(\{ force/);
});

test('Service Worker cache-first asset versioned và không tái chép cache release cũ', () => {
  const source = read('sw.js');
  assert.match(source, /BUILD_VERSION = "20260824\.V1_14_1"/);
  assert.match(source, /isCurrentVersion/);
  assert.match(source, /caches\.match\(request\)/);
  assert.doesNotMatch(source, /ignoreSearch\s*:\s*true/);
  assert.doesNotMatch(source, /cache:\s*["']no-store["']/);
  assert.doesNotMatch(source, /copy.*old.*cache/i);
});

test('Drive evidence nén ảnh mạnh hơn và giảm polling Apps Script', () => {
  const source = read('services/drive-evidence-service.js');
  assert.match(source, /IMAGE_OPTIMIZE_THRESHOLD = 700 \* 1024/);
  assert.match(source, /IMAGE_MAX_EDGE = 1800/);
  assert.match(source, /IMAGE_QUALITY = 0\.80/);
  assert.match(source, /let pollDelay = 1500/);
  assert.match(source, /Math\.min\(5000/);
  assert.match(source, /setTimeout\(poll, 1500\)/);
});

test('In-app alert Chỉ đạo chỉ nghe 48 giờ gần nhất và tối đa 200 tài liệu', () => {
  const source = read('services/executive-in-app-alert-service.js');
  assert.match(source, /MAX_LIST = 200/);
  assert.match(source, /ALERT_LOOKBACK_MS = 48 \* 60 \* 60 \* 1000/);
  assert.match(source, /where\("updatedAt", ">=", since\)/);
  assert.match(source, /orderBy\("updatedAt", "desc"\)/);
  assert.match(source, /where\("createdAt", ">=", since\)/);
});

test('Route Chỉ đạo load một lần rồi delayed realtime, refresh có cooldown', () => {
  const service = read('services/executive-directive-service.js');
  const view = read('modules/executive-directives/executive-directives-view.js');
  assert.match(service, /subscribeSnapshotDeferred/);
  assert.match(service, /subscribeDirectives\(onNext, onError = console\.warn, options = \{\}\)/);
  assert.match(service, /subscribeUpdates\(onNext, onError = console\.warn, options = \{\}\)/);
  assert.match(view, /startDelayMs:\s*60 \* 1000/);
  assert.match(view, /jitterMs:\s*30 \* 1000/);
  assert.match(view, /DIRECTIVE_REFRESH_COOLDOWN_MS = 8000/);
});

test('Apps Script V4.4.0 chuyển đồng bộ tự động sang 4 giờ và có self-throttle', () => {
  const source = fs.readFileSync(path.join(repo, 'deployment/apps-script-standard-tasks-v4.4.0.gs'), 'utf8');
  assert.match(source, /VERSION:\s*'4\.4\.0'/);
  assert.match(source, /AUTO_SYNC_MIN_INTERVAL_MS:\s*4 \* 60 \* 60 \* 1000/);
  assert.match(source, /everyHours\(4\)/);
  assert.doesNotMatch(source, /everyMinutes\(5\)/);
  assert.match(source, /migrateAutomaticSyncToFreeTierV440/);
  assert.match(source, /skippedByThrottle/);
});

test('Index hỗ trợ listener cảnh báo Chỉ đạo theo phòng + updatedAt', () => {
  const indexes = JSON.parse(readRepo('firestore.indexes.json'));
  const found = indexes.indexes.some(index => index.collectionGroup === 'executiveDirectives'
    && index.fields?.some(f => f.fieldPath === 'visibleDepartmentIds' && f.arrayConfig === 'CONTAINS')
    && index.fields?.some(f => f.fieldPath === 'updatedAt' && f.order === 'DESCENDING'));
  assert.equal(found, true);
  assert.deepEqual(indexes, JSON.parse(readRepo('deployment/firestore.indexes.json')));
});

test('V1.13 business baseline và quyền HEAD/DEPUTY vẫn được giữ trong Rules', () => {
  const rules = readRepo('firestore.rules');
  assert.match(rules, /canViewDepartmentReportData[\s\S]*isDepartmentLeader\(\) && sameDepartment\(departmentId\)/);
  assert.match(rules, /canApproveDepartmentRegistrations[\s\S]*isDepartmentHead\(\) && sameDepartment\(departmentId\)/);
  assert.match(rules, /canConfirmDepartmentEvaluations[\s\S]*isDepartmentHead\(\) && sameDepartment\(departmentId\)/);
  assert.match(rules, /ownerNormalCompletionValid[\s\S]*request\.resource\.data\.progress == 100[\s\S]*request\.resource\.data\.completedAt == request\.time/);
});
