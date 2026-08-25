import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STANDARD_FREQUENCIES,
  canonicalFrequency,
  deriveDeadlinePlan,
  normalizeCompletionDeadline,
  frequencyKind
} from '../core/deadline-engine.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const packageRoot = path.resolve(root, '..');
const read = relative => fs.readFileSync(path.join(packageRoot, relative), 'utf8');
const readApp = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('V1.16.0: chỉ còn 6 Chu kỳ/Tần suất chuẩn', () => {
  assert.deepEqual(STANDARD_FREQUENCIES, ['Theo ngày','Theo tuần','Theo tháng','Theo quý','Theo năm','Khi phát sinh']);
  assert.equal(canonicalFrequency('Theo ca/ngày'), 'Theo ngày');
  assert.equal(canonicalFrequency('Theo lượt/ngày'), 'Theo ngày');
  assert.equal(canonicalFrequency('Theo hồ sơ'), 'Khi phát sinh');
  assert.equal(canonicalFrequency('Theo văn bản'), 'Khi phát sinh');
  assert.equal(canonicalFrequency('Theo yêu cầu'), 'Khi phát sinh');
  assert.equal(canonicalFrequency('Theo yêu cầu của văn bản'), 'Khi phát sinh');
  assert.equal(canonicalFrequency('Khác'), '');
});

test('V1.16.0: Theo ngày dùng Trong ngày và sinh một mốc cho mỗi ngày', () => {
  assert.equal(normalizeCompletionDeadline('', 'Theo ngày'), 'Trong ngày');
  const plan = deriveDeadlinePlan({ frequency:'Theo ngày', completionDeadline:'', periodStartDate:'2026-07-01', periodEndDate:'2026-07-05' });
  assert.equal(plan.mode, 'DAILY_MILESTONES');
  assert.equal(plan.recurringKind, 'DAILY');
  assert.deepEqual(plan.milestoneDateKeys, ['2026-07-01','2026-07-02','2026-07-03','2026-07-04','2026-07-05']);
});

test('V1.16.0: Theo tuần sinh đúng mốc theo thứ được chọn', () => {
  const plan = deriveDeadlinePlan({ frequency:'Theo tuần', completionDeadline:'Thứ Sáu', periodStartDate:'2026-07-01', periodEndDate:'2026-07-31' });
  assert.equal(plan.mode, 'WEEKLY_MILESTONES');
  assert.equal(plan.recurringKind, 'WEEKLY');
  assert.deepEqual(plan.milestoneDateKeys, ['2026-07-03','2026-07-10','2026-07-17','2026-07-24','2026-07-31']);
});

test('V1.16.0: Theo tháng và Khi phát sinh giữ nguyên nghiệp vụ đã chốt', () => {
  const monthly = deriveDeadlinePlan({ frequency:'Theo tháng', completionDeadline:'25', periodStartDate:'2026-07-01', periodEndDate:'2026-09-30' });
  assert.deepEqual(monthly.milestoneDateKeys, ['2026-07-25','2026-08-25','2026-09-25']);
  const arising = deriveDeadlinePlan({ frequency:'Khi phát sinh', completionDeadline:'Theo yêu cầu', periodStartDate:'2026-07-01', periodEndDate:'2026-09-30' });
  assert.equal(arising.mode, 'EVENT_DRIVEN');
  assert.equal(arising.deadlineDateKey, '');
  assert.deepEqual(arising.milestoneDateKeys, []);
  assert.equal(frequencyKind('Theo yêu cầu của văn bản'), 'ARISING');
});

test('V1.16.0: form Web dùng dropdown, deadline động và không free-text tần suất', () => {
  const source = readApp('modules/standard-tasks/standard-tasks-view.js');
  assert.match(source, /<select id="catalogTaskFrequency">/);
  assert.match(source, /STANDARD_FREQUENCIES\.map/);
  assert.match(source, /catalogDeadlineControlHtml/);
  assert.match(source, /Theo ngày/);
  assert.match(source, /WEEKDAY_OPTIONS/);
  assert.match(source, /Nhập tại từng lượt phát sinh/);
  assert.doesNotMatch(source, /id="catalogTaskFrequency"[^>]*type="text"/);
});

test('V1.16.0: Khi phát sinh ép ITEMIZED nhưng không ép GENERIC', () => {
  const service = readApp('services/standard-task-write-service.js');
  const view = readApp('modules/standard-tasks/standard-tasks-view.js');
  assert.match(service, /const trackingMode = eventDriven \? "ITEMIZED"/);
  assert.match(service, /const workItemType = normalizeWorkItemType\(data\.workItemType, trackingMode\)/);
  assert.doesNotMatch(service, /eventDriven \? "GENERIC"/);
  assert.match(view, /Không ép GENERIC/);
});

test('V1.16.0: registration tạo milestoneMode DAILY/WEEKLY/MONTHLY theo deadline engine', () => {
  const source = readApp('services/task-registration-service.js');
  assert.match(source, /deadlinePlan\.recurringKind/);
  assert.match(source, /milestoneDateKeys\.forEach/);
  assert.match(source, /finalMilestoneId/);
});

test('V1.16.0: KPI và cập nhật nhiệm vụ nhận cả DAILY/WEEKLY/MONTHLY', () => {
  const kpi = readApp('modules/kpi/kpi-workflow.js');
  const progress = readApp('modules/tasks/task-progress-modal.js');
  const milestone = readApp('services/task-milestone-service.js');
  assert.match(kpi, /\['DAILY','WEEKLY','MONTHLY'\]/);
  assert.match(progress, /\["DAILY", "WEEKLY", "MONTHLY"\]/);
  assert.match(milestone, /\["DAILY", "WEEKLY", "MONTHLY"\]/);
});

test('V1.16.0: Apps Script V4.5.0 dùng cùng 6 dropdown và validation deadline động', () => {
  const source = read('deployment/apps-script-standard-tasks-v4.5.0.gs');
  assert.match(source, /VERSION: '4\.5\.0'/);
  assert.match(source, /FREQUENCY_OPTIONS: Object\.freeze\(\[\s*'Theo ngày',\s*'Theo tuần',\s*'Theo tháng',\s*'Theo quý',\s*'Theo năm',\s*'Khi phát sinh'/s);
  assert.match(source, /applyDeadlineValidationsForRows_/);
  assert.match(source, /deadlineValidationForFrequency_/);
  assert.match(source, /migrateFrequencyDeadlineStandardV450/);
  assert.match(source, /setAllowInvalid\(false\)/);
  assert.doesNotMatch(source.match(/FREQUENCY_OPTIONS: Object\.freeze\(\[[\s\S]*?\]\),/)?.[0] || '', /Theo hồ sơ|Theo văn bản|Khác/);
});

test('V1.16.0: Firestore Rules khóa đúng 6 tần suất và deadline tương ứng', () => {
  const rules = read('firestore.rules');
  assert.match(rules, /data\.frequency in \["Theo ngày", "Theo tuần", "Theo tháng", "Theo quý", "Theo năm", "Khi phát sinh"\]/);
  assert.match(rules, /data\.completionDeadline == "Trong ngày"/);
  assert.match(rules, /data\.completionDeadline in \["Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy", "Chủ Nhật"\]/);
  assert.match(rules, /data\.frequency == "Khi phát sinh"/);
});

test('V1.16.0: chọn file tải Drive ngay, không chờ nút Lưu', () => {
  const progress = readApp('modules/tasks/task-progress-modal.js');
  const detail = readApp('modules/tasks/task-detail-modal.js');
  assert.match(progress, /await staged\.addFiles\(files\)/);
  assert.match(detail, /await staged\.addFiles\(files\)/);
  assert.match(progress, /Đã tải lên Drive · Chưa lưu/);
  assert.match(detail, /Đã tải lên Drive · Chưa lưu/);
  assert.doesNotMatch(progress, /sẵn sàng tải khi bấm Lưu/i);
});

test('V1.16.0: staged file có ×, retry và cleanup Drive khi hủy', () => {
  const uploader = readApp('services/staged-evidence-uploader.js');
  const progress = readApp('modules/tasks/task-progress-modal.js');
  assert.match(uploader, /DriveEvidenceService\.trash/);
  assert.match(uploader, /async cleanup\(\)/);
  assert.match(progress, /data-remove-staged-id/);
  assert.match(progress, /data-retry-staged-id/);
  assert.match(progress, /await staged\.cleanup\(\)/);
});

test('V1.16.0: backend Drive hỗ trợ TRASH_TASK_EVIDENCE', () => {
  const backend = read('deployment/apps-script-notification-ai-evidence-v6.5.0.gs');
  const frontend = readApp('services/drive-evidence-service.js');
  assert.match(backend, /TRASH_TASK_EVIDENCE/);
  assert.match(backend, /file\.setTrashed\(true\)/);
  assert.match(backend, /Task ID:/);
  assert.match(frontend, /action:\s*"TRASH_TASK_EVIDENCE"/);
  assert.match(frontend, /async trash\(/);
});

test('V1.16.0: evidence record retry-safe và saved evidence gỡ mềm có audit', () => {
  const evidence = readApp('services/task-evidence-service.js');
  assert.match(evidence, /existingKeys/);
  assert.match(evidence, /seen\.has/);
  assert.match(evidence, /active: false/);
  assert.match(evidence, /removedAt: FirebaseService\.serverTimestamp\(\)/);
  assert.match(evidence, /removedByUserId/);
});

test('V1.16.0: direct progress upload commit-safe, file đã có record không bị cleanup xóa', () => {
  const progress = readApp('modules/tasks/task-progress-modal.js');
  const addPos = progress.indexOf('TaskEvidenceService.addUploadedFiles');
  const commitPos = progress.indexOf('staged.markCommitted(uploadedFiles)', addPos);
  const taskUpdatePos = progress.indexOf('TaskWriteService.updateProgress', addPos);
  assert.ok(addPos >= 0 && commitPos > addPos);
  assert.ok(taskUpdatePos > commitPos, 'markCommitted phải xảy ra trước task update để tránh cleanup xóa file đã có record');
});

test('V1.16.x: build/PWA hiện tại đồng bộ sau hotfix', () => {
  const version = readApp('core/app-version.js');
  const sw = readApp('sw.js');
  const index = readApp('index.html');
  assert.match(version, /APP_VERSION = "1\.16\.1"/);
  assert.match(version, /BUILD_VERSION = "20260825\.V1_16_1"/);
  assert.match(sw, /20260825\.V1_16_1/);
  assert.match(index, /release-v1\.16\.1\.js\?v=20260825\.V1_16_1/);
});
