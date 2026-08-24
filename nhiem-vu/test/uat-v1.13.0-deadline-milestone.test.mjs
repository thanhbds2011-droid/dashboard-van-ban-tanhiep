import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  deriveDeadlinePlan,
  deadlineDateFromKey,
  validateDeadlineConfiguration
} from '../core/deadline-engine.js';
import {
  calculateMilestoneProgress,
  countCalendarDaysLate,
  progressRateFromDates
} from '../kpi-engine.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const repo = path.resolve(root, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const readRepo = p => fs.readFileSync(path.join(repo, p), 'utf8');

const q3 = { periodStartDate: '2026-07-01', periodEndDate: '2026-09-30' };

test('Theo tháng tạo đúng một kế hoạch deadline với ba mốc trong Q3', () => {
  const plan = deriveDeadlinePlan({ frequency: 'Theo tháng', completionDeadline: '05', ...q3 });
  assert.equal(plan.mode, 'MONTHLY_MILESTONES');
  assert.deepEqual(plan.milestoneDateKeys, ['2026-07-05', '2026-08-05', '2026-09-05']);
  assert.equal(plan.deadlineDateKey, '2026-09-05');
});

test('Theo quý và theo năm suy ra đúng deadline', () => {
  const quarter = deriveDeadlinePlan({ frequency: 'Theo quý', completionDeadline: '25', ...q3 });
  assert.equal(quarter.deadlineDateKey, '2026-09-25');
  const year = deriveDeadlinePlan({
    frequency: 'Theo năm', completionDeadline: '31/12',
    periodStartDate: '2026-01-01', periodEndDate: '2026-12-31'
  });
  assert.equal(year.deadlineDateKey, '2026-12-31');
});

test('Ngày 31 được clamp về ngày cuối tháng', () => {
  const plan = deriveDeadlinePlan({
    frequency: 'Theo tháng', completionDeadline: '31',
    periodStartDate: '2026-01-01', periodEndDate: '2026-03-31'
  });
  assert.deepEqual(plan.milestoneDateKeys, ['2026-01-31', '2026-02-28', '2026-03-31']);
});

test('Chu kỳ phát sinh bắt buộc deadline cụ thể và không tự lấy cuối kỳ', () => {
  assert.throws(() => deriveDeadlinePlan({ frequency: 'Khi phát sinh', completionDeadline: '', ...q3 }), /Hạn hoàn thành cụ thể/);
  const plan = deriveDeadlinePlan({ frequency: 'Khi phát sinh', completionDeadline: '', manualDeadlineDateKey: '2026-08-27', ...q3 });
  assert.equal(plan.deadlineDateKey, '2026-08-27');
});

test('KPI dùng ngày lịch: thứ Sáu đến thứ Hai là trễ 3 ngày', () => {
  const deadline = deadlineDateFromKey('2026-08-21'); // Thứ Sáu
  const completed = new Date('2026-08-24T08:00:00+07:00'); // Thứ Hai
  assert.equal(countCalendarDaysLate(deadline, completed), 3);
  assert.equal(progressRateFromDates(deadline, completed, true), 80);
});

test('Nhiều mốc chỉ tính mốc đã đến hạn và quy xuống 100/80/60/0', () => {
  const asOf = new Date('2026-09-30T12:00:00+07:00');
  const completedAt = key => new Date(`${key}T08:00:00+07:00`);
  const result = calculateMilestoneProgress([
    { dueDateKey: '2026-07-05', completedAt: completedAt('2026-07-05') },
    { dueDateKey: '2026-08-05', completedAt: completedAt('2026-08-05') },
    { dueDateKey: '2026-09-05', completedAt: completedAt('2026-09-07') }
  ], asOf);
  assert.deepEqual(result.rates, [100, 100, 80]);
  assert.equal(result.averageRate, 93.33);
  assert.equal(result.appliedProgressRate, 80);

  const notDue = calculateMilestoneProgress([
    { dueDateKey: '2026-08-05', completedAt: completedAt('2026-08-05') },
    { dueDateKey: '2026-09-05', completedAt: null }
  ], new Date('2026-08-20T12:00:00+07:00'));
  assert.deepEqual(notDue.rates, [100]);
  assert.equal(notDue.appliedProgressRate, 100);
});

test('Form cập nhật V1.13.0 không còn 4 trường cũ và không có input % tiến độ', () => {
  const source = read('modules/tasks/task-progress-modal.js');
  assert.doesNotMatch(source, /Nội dung cập nhật/);
  assert.doesNotMatch(source, /Kết quả thực hiện/);
  assert.doesNotMatch(source, /Khó khăn, vướng mắc/);
  assert.doesNotMatch(source, /Đề xuất hỗ trợ/);
  assert.doesNotMatch(source, /type=["']number["'][^>]*progress/i);
  assert.match(source, /Hoàn thành mốc/);
});

test('Tự đánh giá và xác nhận không cho chọn tiến độ KPI', () => {
  const source = read('modules/kpi/kpi-workflow.js');
  assert.match(source, /progressCalculationMode/);
  assert.match(source, /calculateMilestoneProgress/);
  assert.doesNotMatch(source, /id=["']selfProgressRate["'][^>]*<option/i);
  assert.doesNotMatch(source, /id=["']reviewProgressRate["'][^>]*<option/i);
});

test('Registration không còn dùng endOfPeriod và snapshot deadline trước khi duyệt', () => {
  const source = read('services/task-registration-service.js');
  assert.doesNotMatch(source, /function\s+endOfPeriod/);
  assert.match(source, /milestoneDateKeys/);
  assert.match(source, /completionDeadline/);
  assert.match(source, /deadlineDateKey/);
});

test('Rules cho Phó đọc báo cáo đơn vị nhưng không mở quyền duyệt/xác nhận mặc định', () => {
  const rules = readRepo('firestore.rules');
  assert.match(rules, /canViewDepartmentReportData[\s\S]*isDepartmentLeader\(\) && sameDepartment\(departmentId\)/);
  assert.match(rules, /canApproveDepartmentRegistrations[\s\S]*isDepartmentHead\(\) && sameDepartment\(departmentId\)/);
  assert.match(rules, /canConfirmDepartmentEvaluations[\s\S]*isDepartmentHead\(\) && sameDepartment\(departmentId\)/);
});

test('Apps Script V4.3.0 có đúng một cột Thời hạn hoàn thành và đồng bộ Firestore hai chiều', () => {
  const source = fs.readFileSync(path.join(repo, 'deployment/apps-script-standard-tasks-v4.3.0.gs'), 'utf8');
  assert.match(source, /VERSION: '4\.3\.0'/);
  assert.match(source, /'completionDeadline'/);
  assert.match(source, /'Thời hạn hoàn thành'/);
  assert.match(source, /completionDeadline: \{ stringValue: record\.completionDeadline/);
  assert.match(source, /clean_\(data\.completionDeadline\)/);
});

test('AudienceType là nguồn quyền duy nhất, frontend không suy quyền từ isManagementTask', () => {
  const reader = read('services/standard-task-read-service.js');
  const registration = read('services/task-registration-service.js');
  const writer = read('services/standard-task-write-service.js');
  assert.match(reader, /function audienceOf\(item\) \{\s*return upper\(item\?\.audienceType\);\s*\}/);
  assert.doesNotMatch(registration, /audienceType:\s*item\.audienceType\s*\|\|\s*\(item\.isManagementTask/);
  assert.match(writer, /return allowed\.includes\(requested\) \? requested : "";/);
});

test('Rules khóa progress và completedAt khỏi nhánh quản lý rộng', () => {
  const rules = readRepo('firestore.rules');
  assert.match(rules, /function changesSystemManagedTaskProgress\(\)[\s\S]*"progress"[\s\S]*"completedAt"/);
  assert.match(rules, /canManageTask\(data\)\s*&& !changesSystemManagedTaskProgress\(\)/);
  assert.match(rules, /ownerNormalCompletionValid[\s\S]*request\.resource\.data\.progress == 100[\s\S]*request\.resource\.data\.completedAt == request\.time/);
});

test('Giao nhiệm vụ đột xuất bắt buộc deadline cụ thể, không còn mặc định +7 ngày', () => {
  const modal = read('modules/tasks/task-form-modal.js');
  const writer = read('services/task-write-service.js');
  assert.match(modal, /id="deadline" type="date" value="" required/);
  assert.doesNotMatch(modal, /setDate\([^\n]*\+\s*7/);
  assert.match(modal, /deadlineDateKey:/);
  assert.match(writer, /Hạn hoàn thành cụ thể là bắt buộc khi giao nhiệm vụ đột xuất/);
  assert.match(writer, /deadlineDateFromKey\(deadlineDateKey\)/);
});

test('Rules bắt buộc audienceType hợp lệ cho standardTasks', () => {
  const rules = readRepo('firestore.rules');
  assert.match(rules, /function standardTaskAudienceValid\(data\)/);
  assert.match(rules, /data\.departmentId == "CDTN" && data\.audienceType in \["CDTN_SECRETARY", "CDTN_EXECUTIVE", "CDTN_MEMBER"\]/);
  assert.match(rules, /data\.departmentId != "CDTN" && data\.audienceType in \["ALL_DEPARTMENT", "MANAGEMENT"\]/);
});

test('ADDON Sheet chỉ dùng cờ legacy để migrate audience trống, không ghi đè giá trị quản trị đã nhập', () => {
  const source = fs.readFileSync(path.join(repo, 'deployment/ADDON_SHEET_UI_V1_13_0.gs'), 'utf8');
  assert.match(source, /if \(current\) return \[current\];/);
  assert.match(source, /Chỉ dùng cờ legacy đúng một lần để lấp audience trống/);
});

test('PWA/profile refresh đọc lại cả users và accessAccounts từ server trước khi quyết định reload', () => {
  const source = read('core/auth-service.js');
  assert.match(source, /refreshProfileScopeFromServer/);
  assert.match(source, /FirebaseService\.doc\(FirebaseService\.db, \"accessAccounts\", email\)/);
  assert.match(source, /getDocFromServer/);
  assert.match(source, /profileNeedsSync/);
  assert.match(source, /FirebaseService\.setDoc\(profileRef, \{/);
});

test('Visibility báo cáo dùng helper đọc phòng cho registration, evaluation, common criteria và profile', () => {
  const rules = readRepo('firestore.rules');
  assert.match(rules, /function registrationVisible\(data\)[\s\S]*canViewDepartmentReportData\(data\.departmentId\)/);
  assert.match(rules, /function evaluationVisible\(data\)[\s\S]*canViewDepartmentReportData\(data\.departmentId\)/);
  assert.match(rules, /function commonAssessmentVisible\(data\)[\s\S]*canViewDepartmentReportData\(data\.departmentId\)/);
  assert.match(rules, /match \/kpiProfiles\/\{profileId\}[\s\S]*canViewDepartmentReportData\(resource\.data\.departmentId\)/);
});

test('Apps Script tài khoản tiếp tục đồng bộ leaderLevel và isDepartmentHead vào accessAccounts/users', () => {
  const source = fs.readFileSync(path.join(repo, 'deployment/APPS_SCRIPT_DONG_BO_TAI_KHOAN_V3_3_2.gs'), 'utf8');
  assert.match(source, /leaderLevel/);
  assert.match(source, /isDepartmentHead/);
  assert.match(source, /accessAccounts/);
  assert.match(source, /users/);
});

test('Duyệt đăng ký tính lại deadline từ snapshot và không fallback audience legacy', () => {
  const source = read('services/task-registration-service.js');
  assert.match(source, /Không tin tuyệt đối các field deadline do client gửi/);
  assert.match(source, /deriveDeadlinePlan\(\{[\s\S]*periodStartDate[\s\S]*periodEndDate[\s\S]*manualDeadlineDateKey/);
  assert.match(source, /storedDeadlineDateKey !== derived\.deadlineDateKey/);
  assert.match(source, /const allowedAudience = departmentId === "CDTN"/);
  assert.doesNotMatch(source, /audienceType:\s*registration\.audienceType\s*\|\|\s*"ALL_DEPARTMENT"/);
});

test('Workflow HEAD/DEPUTY giữ nguyên: Phó tự đăng ký được nhưng duyệt/xác nhận/khóa chỉ khi được ủy quyền', () => {
  const permissions = read('core/permissions.js');
  assert.match(permissions, /canRegisterStandardTasks\(\)[\s\S]*isDepartmentLeader\(\)/);
  assert.match(permissions, /canApproveStaffRegistrations\(hasDelegation = false\)[\s\S]*isDepartmentHead\(\)[\s\S]*isDepartmentDeputy\(\) && hasDelegation === true/);
  assert.match(permissions, /canLockDepartmentPlan\(hasDelegation = false\)[\s\S]*isDepartmentHead\(\)[\s\S]*isDepartmentDeputy\(\) && hasDelegation === true/);
  assert.match(permissions, /canConfirmEvaluations\(hasDelegation = false\)[\s\S]*isDepartmentHead\(\)[\s\S]*isDepartmentDeputy\(\) && hasDelegation === true/);
});

test('Điều chỉnh deadline task đã duyệt tiếp tục dùng workflow adjustment và cập nhật mốc chưa hoàn thành', () => {
  const service = read('services/task-adjustment-service.js');
  const rules = readRepo('firestore.rules');
  assert.match(service, /taskMilestones/);
  assert.match(service, /completionDeadline/);
  assert.match(service, /TASK_ADJUSTMENT_APPROVED/);
  assert.match(service, /batch\.commit\(\)/);
  assert.match(rules, /function changesTaskDeadline\(\)/);
  assert.match(rules, /data\.planApprovalStatus != "APPROVED"/);
  assert.match(rules, /function adjustmentApproverMilestoneDeadlineUpdateOnly/);
});
