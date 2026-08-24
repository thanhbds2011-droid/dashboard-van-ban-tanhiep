import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

test('V1.14.1 milestone query ràng buộc owner hoặc department để khớp Firestore Rules', () => {
  const source = read('services/task-milestone-service.js');
  assert.match(source, /where\("taskId", "==", taskId\)/);
  assert.match(source, /where\("ownerUserId", "==", user\.uid\)/);
  assert.match(source, /where\([\s\S]*"departmentId"[\s\S]*task\.primaryDepartmentId/);
  assert.match(source, /async list\(taskOrId\)/);
  assert.match(source, /const all = await this\.list\(task\)/);
});

test('Modal cập nhật truyền đủ task vào milestone service và bắt lỗi mở modal', () => {
  const modal = read('modules/tasks/task-progress-modal.js');
  const detail = read('modules/tasks/task-detail-modal.js');
  assert.match(modal, /TaskMilestoneService\.list\(task\)/);
  assert.match(detail, /TASK_PROGRESS_MODAL_OPEN_FAILED/);
  assert.match(detail, /friendlyErrorMessage\(error, "Không mở được chức năng cập nhật nhiệm vụ\."\)/);
});

test('Điều chỉnh nhiệm vụ dùng chung milestone service thay vì query taskId không đủ scope', () => {
  const source = read('services/task-adjustment-service.js');
  assert.match(source, /import \{ TaskMilestoneService \}/);
  assert.match(source, /return TaskMilestoneService\.list\(task\)/);
  assert.doesNotMatch(source, /collection\(FirebaseService\.db, "taskMilestones"\)[\s\S]{0,180}where\("taskId", "==", taskId\)/);
});

test('Duyệt đăng ký cũ phục hồi snapshot từ kỳ KPI và standardTasks, không fallback cuối kỳ', () => {
  const source = read('services/task-registration-service.js');
  assert.match(source, /hydrateRegistrationForApproval/);
  assert.match(source, /periodForApproval/);
  assert.match(source, /catalogForApproval/);
  assert.match(source, /legacySnapshotRecovered/);
  assert.match(source, /legacySnapshotSource = "PERIOD_AND_STANDARD_TASK"/);
  assert.match(source, /approvalSnapshotPatch\(registration, reviewer\)/);
  assert.match(source, /prepared\.push\(await hydrateRegistrationForApproval/);
  assert.doesNotMatch(source, /function\s+endOfPeriod/);
});

test('Đăng ký legacy chu kỳ phát sinh bắt buộc hạn cụ thể thay vì tự lấy ngày cuối kỳ', () => {
  const service = read('services/task-registration-service.js');
  const workflow = read('modules/kpi/kpi-workflow.js');
  assert.match(service, /LEGACY_MANUAL_DEADLINE_REQUIRED/);
  assert.match(service, /requiresManualDeadline\(result\.frequency\)/);
  assert.match(workflow, /approveRegistrationsWithLegacyRecovery/);
  assert.match(workflow, /Nhập hạn để Trưởng phòng duyệt/);
  assert.match(workflow, /không dùng ngày cuối kỳ/);
});

test('Duyệt hàng loạt bắt lỗi và không còn Uncaught Promise trên nút duyệt', () => {
  const source = read('modules/kpi/kpi-workflow.js');
  assert.match(source, /TASK_REGISTRATION_BATCH_APPROVE_FAILED/);
  assert.match(source, /TASK_REGISTRATION_GROUP_APPROVE_FAILED/);
  assert.match(source, /friendlyErrorMessage\(error, 'Không duyệt được các đầu việc đã chọn\.'/);
});
