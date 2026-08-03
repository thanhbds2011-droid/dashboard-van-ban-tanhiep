import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '../..');
const read = relative => readFileSync(resolve(repo, relative), 'utf8');
const rules = read('firestore.rules');
const accountSync = read('deployment/apps-script-account-sync-v3.2.2.gs');
const registration = read('nhiem-vu/services/task-registration-service.js');
const taskWrite = read('nhiem-vu/services/task-write-service.js');
const dashboard = read('nhiem-vu/modules/dashboard/dashboard-view.js');
const tasks = read('nhiem-vu/modules/tasks/tasks-view.js');
const kpi = read('nhiem-vu/modules/kpi/kpi-workflow.js');
const css = read('nhiem-vu/v3.css');
const sw = read('nhiem-vu/sw.js');

test('Ủy quyền Chi đoàn dùng danh bạ tối thiểu cdtnMembers thay vì list users trực tiếp', () => {
  assert.match(registration, /collection\(FirebaseService\.db, "cdtnMembers"\)/);
  assert.match(registration, /where\("active", "==", true\)/);
  assert.match(rules, /match \/cdtnMembers\/\{userId\}/);
  assert.match(rules, /isCdtnMember\(\)/);
});

test('Apps Script tài khoản V3.2.2 đồng bộ và vô hiệu hóa danh bạ Chi đoàn', () => {
  assert.match(accountSync, /VERSION: '3\.2\.2'/);
  assert.match(accountSync, /CDTN_MEMBER_COLLECTION_NAME: 'cdtnMembers'/);
  assert.match(accountSync, /cdtnMemberUpserts/);
  assert.match(accountSync, /deactivatedCdtnMembers/);
  assert.match(accountSync, /cdtnMemberDirectoryFields_/);
});

test('Tiếp nhận nhiệm vụ không bị rollback bởi lỗi ghi nhật ký bổ sung', () => {
  const acceptBody = /async accept\(task\) \{([\s\S]*?)\n  \},\n\n  async updateProgress/.exec(taskWrite)?.[1] || '';
  assert.match(acceptBody, /await FirebaseService\.updateDoc\(taskRef\(task\.id\), payload\)/);
  assert.match(acceptBody, /try \{/);
  assert.match(acceptBody, /TASK_ACCEPTED/);
  assert.doesNotMatch(acceptBody, /batch\.commit/);
  assert.match(rules, /function ownerCanAcceptTask\(\)/);
});

test('Dashboard dùng nhãn Viên chức, kỳ KPI dạng dòng và sáu thẻ gọn', () => {
  assert.match(dashboard, /STAFF:"Viên chức"/);
  assert.doesNotMatch(dashboard, /Viên chức, người lao động/);
  assert.match(dashboard, /dashboard-period-inline/);
  assert.match(css, /dashboard-summary-grid \{ grid-template-columns: repeat\(6/);
});

test('Nút đồng bộ nhiệm vụ nằm cùng hàng với tìm kiếm và bộ lọc', () => {
  assert.match(tasks, /tasks-toolbar-compact/);
  assert.match(tasks, /compact-sync-button/);
  assert.match(tasks, /aria-label="Cập nhật danh sách nhiệm vụ"/);
});

test('Báo cáo không còn nút xem trước thừa và Chi đoàn vẫn có 30 điểm tiêu chí chung', () => {
  const mountBody = /function mount\(\) \{([\s\S]*?)\n\}/.exec(kpi)?.[1] || '';
  assert.doesNotMatch(mountBody, /Xem trước báo cáo/);
  assert.match(kpi, /Tiêu chí chung/);
  assert.match(kpi, /BÁO CÁO CÁ NHÂN CHI ĐOÀN|Báo cáo cá nhân Chi đoàn/i);
  assert.doesNotMatch(kpi, /Không áp dụng tiêu chí chung trong báo cáo Chi đoàn/);
});

test('Bí thư và Phó Bí thư được đọc 30 điểm của thành viên Chi đoàn qua danh bạ tối thiểu', () => {
  assert.match(rules, /activeCdtnMemberDirectory\(data\.userId\)/);
  assert.match(rules, /isCdtnLeadership\(\)/);
  assert.match(rules, /hasActiveCdtnApprovalDelegation\("CONFIRM_EVALUATIONS"\)/);
});

test('PWA nâng cache lên V1.7.2', () => {
  assert.match(sw, /nhiem-vu-20260803-v1-7-2/);
  assert.match(sw, /app-v3\.js\?v=20260803\.V1_7_2/);
});
