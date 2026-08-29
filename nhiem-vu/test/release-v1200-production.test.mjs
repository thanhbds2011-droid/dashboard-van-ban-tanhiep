import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveQualityRating, calculateTaskScore, progressRateFromDates } from '../kpi-engine.js';

const repo = resolve(import.meta.dirname, '../..');
const read = relative => readFileSync(resolve(repo, relative), 'utf8');
const rules = read('firestore.rules');
const deployRules = read('deployment/firestore.rules');
const indexes = JSON.parse(read('firestore.indexes.json'));
const deployIndexes = JSON.parse(read('deployment/firestore.indexes.json'));
const version = read('nhiem-vu/core/app-version.js');
const html = read('nhiem-vu/index.html');
const sw = read('nhiem-vu/sw.js');
const kpi = read('nhiem-vu/modules/kpi/kpi-workflow.js');
const permissions = read('nhiem-vu/core/permissions.js');
const auth = read('nhiem-vu/core/auth-service.js');
const registration = read('nhiem-vu/services/task-registration-service.js');
const standardView = read('nhiem-vu/modules/standard-tasks/standard-tasks-view.js');
const progressModal = read('nhiem-vu/modules/tasks/task-progress-modal.js');
const css = read('nhiem-vu/v3.css');

function indexKey(item) {
  return `${item.collectionGroup}|${item.fields.map(field => `${field.fieldPath}:${field.order || field.arrayConfig}`).join('|')}`;
}

const requiredIndexes = [
  'executiveDirectives|visibleDepartmentIds:CONTAINS|updatedAt:DESCENDING',
  'taskEvidenceFiles|taskId:ASCENDING|departmentId:ASCENDING',
  'taskEvidenceFiles|taskId:ASCENDING|ownerUserId:ASCENDING',
  'taskMilestones|periodId:ASCENDING|departmentId:ASCENDING',
  'taskMilestones|periodId:ASCENDING|ownerUserId:ASCENDING',
  'taskWorkItems|taskId:ASCENDING|departmentId:ASCENDING',
  'taskWorkItems|taskId:ASCENDING|ownerUserId:ASCENDING'
];

test('V1.20.0 dùng version/build/cache thống nhất', () => {
  assert.match(version, /APP_VERSION = "1\.20\.0"/);
  assert.match(version, /BUILD_VERSION = "20260829\.V1_20_0"/);
  assert.match(version, /CACHE_NAME = "nhiem-vu-20260829-v1-20-0"/);
  assert.match(html, /app-build" content="20260829\.V1_20_0"/);
  assert.match(html, /release-v1\.20\.0\.js\?v=20260829\.V1_20_0/);
  assert.match(sw, /BUILD_VERSION = "20260829\.V1_20_0"/);
});

test('Rules/index root và deployment đồng nhất; đủ 21 composite indexes', () => {
  assert.equal(rules, deployRules);
  assert.deepEqual(indexes, deployIndexes);
  assert.equal(indexes.indexes.length, 21);
  const keys = new Set(indexes.indexes.map(indexKey));
  requiredIndexes.forEach(key => assert.ok(keys.has(key), `Thiếu index ${key}`));
});

test('Quyền frontend mirror approvalAuthority của Rules, không fallback khi field đã tồn tại', () => {
  assert.match(permissions, /approvalAuthorityPresent === true/);
  assert.match(permissions, /khi field approvalAuthority đã tồn tại/);
  assert.match(auth, /approvalAuthorityPresent/);
  assert.match(rules, /hasField\(data, "approvalAuthority"\) && data\.approvalAuthority == "HEAD"/);
});

test('Đăng ký Không duyệt có thể gửi lại có audit, không xóa document', () => {
  assert.match(rules, /ownerRejectedRegistrationResubmitOnly/);
  assert.match(rules, /resource\.data\.status == "REJECTED"/);
  assert.match(rules, /request\.resource\.data\.status == "PENDING"/);
  assert.match(registration, /TASK_REGISTRATION_REJECTED/);
  assert.match(registration, /TASK_REGISTRATION_RESUBMITTED/);
  assert.match(registration, /async resubmitRegistration/);
  assert.match(standardView, /Không duyệt/);
  assert.match(standardView, /Đăng ký lại/);
});

test('Reviewer có minh chứng on-demand và quyết định công việc vượt yêu cầu riêng', () => {
  assert.match(kpi, /TaskEvidenceService/);
  assert.match(kpi, /loadReviewEvidence/);
  assert.match(kpi, /confirmedExceededRequirement/);
  assert.match(kpi, /exceededDecision/);
  assert.match(rules, /reviewerExceededDecisionUpdateOnly/);
  assert.match(rules, /confirmedExceededRequirement is bool/);
});

test('Điều kiện 30% chỉ cap mức Xuất sắc, không nâng các mức thấp hơn', () => {
  assert.equal(resolveQualityRating(95, { totalTasks:51, exceededTasks:13, allTasksCompleted:true }), 'HOAN_THANH_TOT');
  assert.equal(resolveQualityRating(95, { totalTasks:51, exceededTasks:16, allTasksCompleted:true }), 'HOAN_THANH_XUAT_SAC');
  assert.equal(resolveQualityRating(85, { totalTasks:51, exceededTasks:30, allTasksCompleted:true }), 'HOAN_THANH_TOT');
  assert.equal(resolveQualityRating(70, { totalTasks:51, exceededTasks:30, allTasksCompleted:true }), 'HOAN_THANH');
});

test('Báo cáo hiển thị pending bonus nhưng không dùng pending bonus làm total chính thức', () => {
  assert.match(kpi, /bonus\.pending/);
  assert.match(kpi, /Chờ xác nhận/);
  assert.match(kpi, /bonusTasks\.filter\(item => item\.approved\)/);
  assert.match(kpi, /resolveQualityRating/);
});

test('Realtime nghe bốn collection theo scope và không còn delay 90–120 giây/loadAll trong callback', () => {
  assert.match(kpi, /subscribeKpiStateCollection\('tasks'/);
  assert.match(kpi, /subscribeKpiStateCollection\('taskRegistrations'/);
  assert.match(kpi, /subscribeKpiStateCollection\('taskEvaluations'/);
  assert.match(kpi, /subscribeKpiStateCollection\('commonCriteriaAssessments'/);
  assert.doesNotMatch(kpi, /startDelayMs:\s*90\s*\*\s*1000/);
  assert.match(kpi, /scheduleKpiLiveRender/);
  assert.match(kpi, /cập nhật state cục bộ ngay sau write thành công/);
});

test('Danh mục sản phẩm và bảng KPI có đủ cột Vượt yêu cầu/Minh chứng', () => {
  assert.match(kpi, /openProductCatalog/);
  assert.match(kpi, /productCatalogTasksForUser/);
  assert.match(kpi, /planApprovalStatus\)\.toUpperCase\(\) === 'APPROVED'/);
  assert.match(kpi, /DANH MỤC SẢN PHẨM CHUẨN QUÝ/);
  assert.match(kpi, /XÁC NHẬN CỦA LÃNH ĐẠO, ĐƠN VỊ/);
  assert.match(kpi, /NGƯỜI LẬP DANH MỤC SẢN PHẨM/);
  assert.match(kpi, /Vượt yêu cầu/);
  assert.match(kpi, /Minh chứng/);
});

test('UI minh chứng được tinh gọn nhưng giữ giới hạn thật', () => {
  assert.match(progressModal, /10 tệp\/lần · tối đa 20 tệp\/nhiệm vụ · 8 MB\/tệp/);
  assert.match(progressModal, /Tệp chờ lưu/);
  assert.match(progressModal, /Tệp đã lưu/);
  assert.doesNotMatch(progressModal, /Có thể bấm × để bỏ tệp chọn nhầm/);
  assert.doesNotMatch(progressModal, /Có thể mở lại nhiệm vụ và bổ sung thêm tệp/);
  assert.match(css, /\.task-workspace-kicker\{display:none!important\}/);
});

test('Các nguyên tắc chấm điểm cốt lõi không thay đổi', () => {
  const score = calculateTaskScore(12, 1.1, 100, 100);
  assert.equal(score.maximumConvertedScore, 13.2);
  assert.equal(score.convertedActualScore, 13.2);
  assert.equal(progressRateFromDates('2026-08-01','2026-08-01',true), 100);
  assert.equal(progressRateFromDates('2026-08-01','2026-08-03',true), 80);
  assert.equal(progressRateFromDates('2026-08-01','2026-08-06',true), 60);
  assert.equal(progressRateFromDates('2026-08-01','2026-08-07',true), 0);
});
