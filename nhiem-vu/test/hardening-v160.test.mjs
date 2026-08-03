import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '../..');
const read = relative => readFileSync(resolve(repo, relative), 'utf8');
const rules = read('firestore.rules');
const adjustment = read('nhiem-vu/services/task-adjustment-service.js');
const registration = read('nhiem-vu/services/task-registration-service.js');
const kpi = read('nhiem-vu/modules/kpi/kpi-workflow.js');

test('Lịch sử điều chỉnh của STAFF truy vấn kèm userId để không bị Rules từ chối', () => {
  assert.match(adjustment, /where\("taskId", "==", taskId\)/);
  assert.match(adjustment, /where\("userId", "==", user\.uid\)/);
  assert.match(adjustment, /where\("approverUserId", "==", user\.uid\)/);
});

test('Người được ủy quyền không được tự duyệt đăng ký của chính mình', () => {
  assert.match(registration, /!directAuthority && \(!delegated \|\| item\.userId === reviewer\.uid\)/);
  assert.match(rules, /isDelegatedRegistrationApprover\(resource\.data\.departmentId\)[\s\S]*resource\.data\.userId != request\.auth\.uid/);
  assert.match(rules, /resource\.data\.ownerUserId != request\.auth\.uid/);
});

test('KPI Chi đoàn có không gian riêng, tải thành viên theo vai trò kiêm nhiệm', () => {
  assert.match(kpi, /function loadCdtnUsers\(\)/);
  assert.match(kpi, /collection\(db, 'cdtnMembers'\)/);
  assert.match(kpi, /where\('active', '==', true\)/);
  assert.match(kpi, /Phạm vi/);
  assert.match(kpi, /activeScopeDepartmentId\(\)/);
});

test('Đoàn viên tự đánh giá nhiệm vụ Chi đoàn với departmentId của nhiệm vụ', () => {
  assert.match(kpi, /departmentId:clean\(ev\.departmentId\) \|\| evaluationScope/);
  assert.match(rules, /request\.resource\.data\.departmentId == "CDTN" && isCdtnMember\(\)/);
  assert.match(kpi, /Bí thư Chi đoàn/);
});

test('Người được ủy quyền Chi đoàn có thể đọc đúng dữ liệu cần duyệt và xác nhận', () => {
  assert.match(rules, /hasActiveCdtnApprovalDelegation\("CONFIRM_EVALUATIONS"\)/);
  assert.match(rules, /registrationIsCdtn\(data\)/);
  assert.match(rules, /validCdtnDirectoryTarget/);
});
