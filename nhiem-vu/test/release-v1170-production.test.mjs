import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { calculateBonusScore, calculateKpiSummary } from '../kpi-engine.js';
import { calculateWorkItemSummary } from '../work-item-score-engine.js';

const repo = resolve(import.meta.dirname, '../..');
const read = relative => readFileSync(resolve(repo, relative), 'utf8');
const rules = read('firestore.rules');
const deployRules = read('deployment/firestore.rules');
const indexes = read('firestore.indexes.json');
const deployIndexes = read('deployment/firestore.indexes.json');
const version = read('nhiem-vu/core/app-version.js');
const indexHtml = read('nhiem-vu/index.html');
const sw = read('nhiem-vu/sw.js');
const pwa = read('nhiem-vu/pwa.js');
const app = read('nhiem-vu/app-v3.js');
const auth = read('nhiem-vu/core/auth-service.js');
const permissions = read('nhiem-vu/core/permissions.js');
const taskRead = read('nhiem-vu/services/task-read-service.js');
const catalogRead = read('nhiem-vu/services/standard-task-read-service.js');
const registration = read('nhiem-vu/services/task-registration-service.js');
const workItems = read('nhiem-vu/services/task-work-item-service.js');
const staged = read('nhiem-vu/services/staged-evidence-uploader.js');
const progressModal = read('nhiem-vu/modules/tasks/task-progress-modal.js');
const detailModal = read('nhiem-vu/modules/tasks/task-detail-modal.js');
const tasksView = read('nhiem-vu/modules/tasks/tasks-view.js');
const kpi = read('nhiem-vu/modules/kpi/kpi-workflow.js');
const accountSync = read('deployment/APPS_SCRIPT_DONG_BO_TAI_KHOAN_V3_3_3.gs');
const standardTasksScript = read('deployment/apps-script-standard-tasks-v4.5.0.gs');
const evidenceScript = read('deployment/apps-script-notification-ai-evidence-v6.5.0.gs');

test('V1.17.0 dùng version/build/cache tập trung và index nạp release đúng', () => {
  assert.match(version, /APP_VERSION = "1\.17\.0"/);
  assert.match(version, /BUILD_VERSION = "20260825\.V1_17_0"/);
  assert.match(version, /CACHE_NAME = "nhiem-vu-20260825-v1-17-0"/);
  assert.match(indexHtml, /window\.__APP_HTML_BUILD__ = "20260825\.V1_17_0"/);
  assert.match(indexHtml, /release-v1\.17\.0\.js\?v=20260825\.V1_17_0/);
  assert.match(sw, /BUILD_VERSION = "20260825\.V1_17_0"/);
});

test('Rules và indexes đóng gói ở root/deployment hoàn toàn đồng nhất', () => {
  assert.equal(rules, deployRules);
  assert.equal(indexes, deployIndexes);
});

test('Session/cache hotfix V1.16.1 vẫn được giữ', () => {
  assert.match(app, /__APP_HTML_BUILD__/);
  assert.match(app, /BUILD_VERSION/);
  assert.match(pwa, /pageshow/);
  assert.match(pwa, /persisted/);
  assert.match(auth, /UserContext/);
  assert.match(sw, /GET_BUILD_VERSION/);
  assert.match(sw, /clients\.claim\(\)/);
});

test('additionalRoles không thể tự nâng quyền từ client', () => {
  assert.match(rules, /request\.resource\.data\.additionalRoles == accessAccount\(\)\.additionalRoles/);
  assert.match(rules, /"teamId", "additionalRoles", "taskNotificationCoordinator"/);
  assert.match(rules, /function isCdtnMember\(\)/);
});

test('Scope toàn hệ thống tách khỏi scope toàn chuyên môn', () => {
  assert.match(permissions, /canViewAllScopes\(\)[\s\S]*return this\.isAdmin\(\) \|\| this\.isDirector\(\)/);
  assert.match(rules, /function canViewAllScopes\(\)[\s\S]*return isAdmin\(\) \|\| isDirector\(\)/);
  assert.match(rules, /function canViewCenterScope\(departmentId\)/);
  assert.match(rules, /departmentId == "CDTN" \? canViewAllScopes\(\) : canViewAllDepartments\(\)/);
});

test('Mọi thành viên Chi đoàn thấy đầu việc Chi đoàn; lãnh đạo đơn vị chủ quản cũng thấy để theo dõi', () => {
  assert.match(rules, /isCdtnScopedData\(data\) && isCdtnMember\(\)/);
  assert.match(rules, /homeDepartmentLeaderCanView\(data\)/);
  assert.match(taskRead, /where\("homeDepartmentId", "==", departmentId\)/);
  assert.match(taskRead, /if \(Permissions\.isCdtnMember\(\)\)/);
});

test('TCHC không tự động đọc toàn bộ Chi đoàn nếu không có vai trò Chi đoàn', () => {
  const centerBranch = /if \(Permissions\.canViewAllDepartments\(\)\) \{([\s\S]*?)\n  \}/.exec(taskRead)?.[1] || '';
  assert.match(centerBranch, /PROFESSIONAL_DEPARTMENT_IDS/);
  assert.match(centerBranch, /if \(Permissions\.isCdtnMember\(\)\)/);
  assert.doesNotMatch(centerBranch, /isTchcDepartmentLeader\(\)/);
  assert.doesNotMatch(catalogRead, /if \(departmentId === "CDTN"\) return Permissions\.isDepartmentLeader\(\)/);
});

test('Quyền xem Chi đoàn không làm phát sinh quyền quản trị/chấm điểm cho Trưởng Phó Phòng Khu', () => {
  assert.match(rules, /isCdtnScopedData\(data\)[\s\S]*isCdtnLeadership\(\)/);
  assert.match(rules, /function canConfirmTaskScore\(data\)[\s\S]*isCdtnScopedData\(data\)[\s\S]*isCdtnLeadership\(\)/);
  assert.match(rules, /function canConfirmEvaluationRecord\(data\)/);
  assert.match(rules, /data\.departmentId == "CDTN"[\s\S]*isCdtnLeadership\(\)/);
});

test('Đăng ký Chi đoàn lưu homeDepartmentId và organizationId để phục vụ báo cáo Phòng Khu', () => {
  assert.match(registration, /homeDepartmentId/);
  assert.match(registration, /organizationId/);
  assert.match(registration, /CDTN/);
  assert.match(rules, /cdtnOwnerHomeDepartmentValid/);
});

test('Báo cáo Phòng Khu tải cả nhiệm vụ chuyên môn và nhiệm vụ Chi đoàn của nhân sự cùng đơn vị', () => {
  assert.match(kpi, /where\('homeDepartmentId', '==', departmentId\)/);
  assert.match(kpi, /nhiệm vụ chuyên môn và Chi đoàn của đơn vị/);
  assert.match(kpi, /đánh giá chuyên môn và Chi đoàn của đơn vị/);
  assert.match(kpi, /function personalTasksForUser\(userId\)/);
  assert.match(kpi, /scope === homeDepartmentId \|\| scope === 'CDTN'/);
});

test('Báo cáo toàn chuyên môn của TCHC không tải toàn bộ dữ liệu Chi đoàn', () => {
  const taskBranch = /const taskRequest = fullCenterScope[\s\S]*?: professionalCenterScope\n\s*\? ([\s\S]*?)\n\s*: departmentId === 'CDTN'/.exec(kpi)?.[1] || '';
  assert.match(taskBranch, /PROFESSIONAL_DEPARTMENT_IDS/);
  assert.doesNotMatch(taskBranch, /primaryDepartmentId', '==', 'CDTN'/);
  const evalBranch = /const evaluationRequest = fullCenterScope[\s\S]*?: professionalCenterScope\n\s*\? ([\s\S]*?)\n\s*: departmentId === 'CDTN'/.exec(kpi)?.[1] || '';
  assert.match(evalBranch, /PROFESSIONAL_DEPARTMENT_IDS/);
  assert.doesNotMatch(evalBranch, /departmentId', '==', 'CDTN'/);
});

test('Báo cáo cá nhân chỉ có một bộ tiêu chí chung 30 điểm và chỉ official khi tiêu chí chung đã xác nhận', () => {
  assert.match(kpi, /function scoreStateForUserCombined\(userId\)/);
  assert.match(kpi, /taskScores\.every\(item => item\.official\) && commonScore\.official/);
  assert.match(kpi, /commonAssessmentForUser\(userId, homeDepartmentId\)/);
});

test('Điểm thưởng đúng 5% điểm thực tế nhiệm vụ và tổng xếp loại không vượt 100', () => {
  assert.equal(calculateBonusScore(10, 0.05), 0.5);
  assert.equal(calculateBonusScore(8, 0.05), 0.4);
  assert.equal(calculateBonusScore(10, 0.10), 0.5);
  const result = calculateKpiSummary([
    { active:true, includedInA:true, planApprovalStatus:'APPROVED', maximumConvertedScore:10, recognized:true, confirmedActualScore:10, bonusScore:0.5 }
  ], 30);
  assert.equal(result.kpi70, 70);
  assert.equal(result.bonus70, 3.5);
  assert.equal(result.totalBeforeCap, 103.5);
  assert.equal(result.total100, 100);
});

test('Người tự đánh giá không thể tự cấp điểm thưởng; người xác nhận bị khóa tỷ lệ 5%', () => {
  assert.match(rules, /function bonusFieldsEmptyForSelf\(data\)/);
  assert.match(rules, /function bonusFieldsValidOnConfirmation\(data\)/);
  assert.match(rules, /data\.bonusRate == 0\.05/);
  assert.match(rules, /data\.bonusBasisScore == data\.confirmedActualScore/);
  assert.match(rules, /data\.bonusConfirmedByUserId == request\.auth\.uid/);
  assert.match(rules, /bonusFieldsEmptyForSelf\(request\.resource\.data\)/);
  assert.match(rules, /bonusFieldsValidOnConfirmation\(request\.resource\.data\)/);
});

test('UI xác nhận điểm thưởng chỉ nằm ở bước người xác nhận và lưu audit riêng', () => {
  assert.match(kpi, /kpiBonusAwarded/);
  assert.match(kpi, /calculateBonusScore\(x\.actual, bonusRate\)/);
  assert.match(kpi, /bonusConfirmedByUserId/);
  assert.match(kpi, /CONFIRM_TASK_SCORE/);
  assert.match(kpi, /Điểm thưởng/);
});

test('EVENT_DRIVEN không đóng nhiệm vụ cha; trạng thái hiển thị là Theo dõi phát sinh', () => {
  assert.match(progressModal, /eventDriven \? "Theo dõi phát sinh" : "Đang thực hiện"/);
  assert.match(progressModal, /recurringMilestones \|\| eventDriven \? "" : statusOption\("HOAN_THANH"/);
  assert.match(tasksView, /eventProgressRate/);
  assert.match(tasksView, /Theo dõi phát sinh/);
});

test('EVENT_DRIVEN lấy tiến độ từ các lượt đủ điều kiện, bỏ lượt tương lai chưa hoàn thành khỏi mẫu số', () => {
  const summary = calculateWorkItemSummary([
    { active:true, deadlineDateKey:'2026-08-01', completedDateKey:'2026-08-01', progressRate:100, resultRate:100 },
    { active:true, deadlineDateKey:'2099-12-31', completedDateKey:'', progressRate:0, resultRate:0 }
  ], 'GENERIC', { excludeFutureIncomplete:true, asOfDateKey:'2026-08-25' });
  assert.equal(summary.totalRecordedCount, 2);
  assert.equal(summary.count, 1);
  assert.equal(summary.completedCount, 1);
  assert.equal(summary.appliedProgressRate, 100);
  assert.equal(summary.appliedResultRate, 100);
});

test('Mỗi lần lưu lượt phát sinh cập nhật summary của nhiệm vụ cha', () => {
  assert.match(workItems, /async function syncEventDrivenParentSummary\(task\)/);
  assert.match(workItems, /eventWorkItemCount/);
  assert.match(workItems, /eventProgressRate/);
  assert.match(workItems, /await syncEventDrivenParentSummary\(task\)/);
  assert.match(rules, /"eventWorkItemCount", "eventEligibleCount", "eventCompletedCount", "eventProgressRate", "eventResultRate", "eventSummaryUpdatedAt"/);
});

test('Chọn minh chứng chỉ giữ cục bộ; upload chỉ bắt đầu khi bấm Lưu', () => {
  const addBody = /async addFiles\(fileList\) \{([\s\S]*?)\n  \}/.exec(staged)?.[1] || '';
  assert.match(addBody, /status: "SELECTED"/);
  assert.match(addBody, /Đã chọn · Chưa lưu/);
  assert.doesNotMatch(addBody, /DriveEvidenceService\.upload/);
  assert.match(staged, /async uploadPending\(\)/);
  assert.match(staged, /DriveEvidenceService\.upload/);
  assert.match(progressModal, /const uploadedFiles = await staged\.uploadPending\(\)/);
  assert.match(detailModal, /const uploadedFiles = await staged\.uploadPending\(\)/);
});

test('Bỏ file trước Lưu không gọi Drive; lỗi lưu nghiệp vụ rollback file vừa upload', () => {
  assert.match(staged, /item\.status = "DISCARDED"/);
  assert.match(staged, /async rollbackUncommitted\(\)/);
  assert.match(staged, /DriveEvidenceService\.trash/);
  assert.match(progressModal, /await staged\.rollbackUncommitted\(\)/);
  assert.match(detailModal, /await staged\.rollbackUncommitted\(\)/);
});

test('Minh chứng đã lưu vẫn soft-delete trước khi đưa file Drive vào Thùng rác', () => {
  assert.match(progressModal, /await TaskEvidenceService\.remove\(task, evidence\)/);
  assert.match(progressModal, /await DriveEvidenceService\.trash\(evidence, task\)/);
  assert.match(rules, /"active", "removedAt", "removedByUserId", "removedByName", "updatedAt", "updatedByUserId", "updatedByName"/);
});

test('Lịch sử người dùng map mã sự kiện sang tiếng Việt', () => {
  assert.match(detailModal, /TASK_MILESTONE_COMPLETED: "Hoàn thành mốc công việc"/);
  assert.doesNotMatch(detailModal, />TASK_MILESTONE_COMPLETED</);
});

test('Giao diện Báo cáo đã bỏ câu giải thích nghiệp vụ dài', () => {
  assert.doesNotMatch(kpi, /Báo cáo cá nhân gộp nhiệm vụ chuyên môn và Chi đoàn thành một kết quả tối đa 100 điểm/);
  assert.match(kpi, /Xem kết quả đánh giá cá nhân trong kỳ/);
  assert.match(kpi, /Điểm kế hoạch/);
  assert.match(kpi, /Điểm thực hiện/);
});

test('Apps Script danh mục chuẩn giữ V4.5.0 và 6 tần suất duy nhất', () => {
  assert.match(standardTasksScript, /VERSION: '4\.5\.0'/);
  for (const label of ['Theo ngày','Theo tuần','Theo tháng','Theo quý','Theo năm','Khi phát sinh']) assert.match(standardTasksScript, new RegExp(label));
});

test('Backend minh chứng giữ V6.5.0 và hỗ trợ upload/trash', () => {
  assert.match(evidenceScript, /6\.5\.0/);
  assert.match(evidenceScript, /TRASH_TASK_EVIDENCE/);
});

test('Apps Script tài khoản V3.3.3 có migration V1.17.0 chạy một lần, không xóa lịch sử', () => {
  assert.match(accountSync, /VERSION: '3\.3\.3'/);
  assert.match(accountSync, /migrateProductionDataV117/);
  assert.match(accountSync, /homeDepartmentId/);
  assert.match(accountSync, /organizationId/);
  assert.match(accountSync, /EVENT_DRIVEN/);
  assert.match(accountSync, /Không xóa document, không thay điểm đã xác nhận/);
});

test('Firestore indexes hiện tại được giữ nguyên schema hợp lệ', () => {
  const parsed = JSON.parse(indexes);
  assert.ok(Array.isArray(parsed.indexes));
  assert.ok(parsed.indexes.length >= 4);
  assert.ok(parsed.indexes.some(index => index.collectionGroup === 'taskWorkItems'));
  assert.ok(parsed.indexes.some(index => index.collectionGroup === 'taskEvidenceFiles'));
});
