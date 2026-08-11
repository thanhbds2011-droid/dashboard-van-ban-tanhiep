import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const nv = path.join(root, 'nhiem-vu');
const read = p => fs.readFileSync(p, 'utf8');
const appVersion = read(path.join(nv,'core/app-version.js'));
const auth = read(path.join(nv,'core/auth-service.js'));
const permissions = read(path.join(nv,'core/permissions.js'));
const service = read(path.join(nv,'services/executive-directive-service.js'));
const view = read(path.join(nv,'modules/executive-directives/executive-directives-view.js'));
const rules = read(path.join(root,'firestore.rules'));
const push = read(path.join(root,'CHI_DAO_DIEU_HANH_PUSH_V1_2_3.gs'));
const index = read(path.join(nv,'index.html'));

const checks = [];
function check(name, fn){ fn(); checks.push(name); }

check('Version V1.11.1', () => {
  assert.match(appVersion, /APP_VERSION = "1\.11\.1"/);
  assert.match(index, /V1\.11\.1/);
});
check('Auth có timeout + recovery diagnostic', () => {
  assert.match(auth, /AUTH_STATE_TIMEOUT/);
  assert.match(auth, /AUTH_PROFILE_SYNC_TIMEOUT/);
  assert.match(auth, /getLastDiagnostic/);
  assert.doesNotMatch(auth, /refreshedSnapshot/);
});
check('Chỉ Trưởng\/Phó có capability ghi nhận chỉ đạo miệng', () => {
  assert.match(permissions, /canRecordOralExecutiveDirective/);
  assert.match(permissions, /this\.isDepartmentLeader\(user\)/);
});
check('Service tạo oral directive cho đúng đơn vị và auto ACCEPTED', () => {
  assert.match(service, /async createOralDirective/);
  assert.match(service, /entryMode: "LEADER_ORAL_CAPTURE"/);
  assert.match(service, /updateType: "ORAL_RECORDED"/);
  assert.match(service, /updateType: "ACCEPTED"/);
  assert.match(service, /internalAssignmentStatus: "UNASSIGNED"/);
  assert.match(service, /DIRECTIVE_ORAL_RECORDED/);
});
check('Staff chỉ query lịch sử assignedUserId', () => {
  assert.match(service, /where\("assignedUserId", "==", user\.uid\)/);
  assert.match(view, /INTERNAL_ASSIGNED.*PERSON_ACCEPTED.*PROGRESS/s);
});
check('UI có nút và form ghi nhận chỉ đạo BGĐ', () => {
  assert.match(view, /btnRecordOralDirective/);
  assert.match(view, /openOralDirectiveForm/);
  assert.match(view, /Ghi nhận và tiếp nhận/);
});
check('Rules cho oral create nhưng khóa về chính đơn vị', () => {
  assert.match(rules, /canRecordOralExecutiveDirective/);
  assert.match(rules, /data\.leadDepartmentId == currentUser\(\)\.departmentId/);
  assert.match(rules, /data\.visibleDepartmentIds\.size\(\) == 1/);
  assert.match(rules, /ORAL_RECORDED/);
});
check('Rules staff không đọc toàn bộ update phòng', () => {
  assert.match(rules, /isStaff\(\).*assignedUserId.*request\.auth\.uid/s);
});
check('Push V1.2.3 hỗ trợ oral recorded và vẫn concurrent', () => {
  assert.match(push, /EXEC_PUSH_VERSION_ = '1\.2\.3'/);
  assert.match(push, /DIRECTIVE_ORAL_RECORDED/);
  assert.match(push, /lock\.tryLock\(800\)/);
  assert.doesNotMatch(push, /tryLock\(10000\)/);
});
check('Phân hệ executive không dùng task collections trong createOralDirective', () => {
  const start=service.indexOf('async createOralDirective');
  const end=service.indexOf('async updateDirective', start);
  const block=service.slice(start,end);
  assert.doesNotMatch(block,/taskPushSubscriptions|taskLogs|\btasks\b|KPI|Council/i);
});

console.log(`PASS ${checks.length}/${checks.length}`);
for (const name of checks) console.log('✓', name);
