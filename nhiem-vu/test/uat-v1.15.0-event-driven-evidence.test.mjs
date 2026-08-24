import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  deriveDeadlinePlan,
  frequencyKind,
  isEventDrivenFrequency,
  requiresManualDeadline
} from '../core/deadline-engine.js';
import { calculateWorkItemSummary } from '../work-item-score-engine.js';
import { calculateMilestoneProgress } from '../kpi-engine.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const repo = path.resolve(root, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const readRepo = p => fs.readFileSync(path.join(repo, p), 'utf8');

test('V1.15.0: Khi phát sinh là EVENT_DRIVEN, không có deadline ở kế hoạch', () => {
  assert.equal(frequencyKind('Khi phát sinh'), 'ARISING');
  assert.equal(isEventDrivenFrequency('KHI PHÁT SINH'), true);
  assert.equal(requiresManualDeadline('Khi phát sinh'), false);
  const plan = deriveDeadlinePlan({
    frequency: 'Khi phát sinh',
    completionDeadline: '',
    periodStartDate: '2026-07-01',
    periodEndDate: '2026-09-30'
  });
  assert.equal(plan.mode, 'EVENT_DRIVEN');
  assert.equal(plan.deadlineDateKey, '');
  assert.deepEqual(plan.milestoneDateKeys, []);
  assert.equal(plan.eventDriven, true);
});

test('V1.15.0: chu kỳ manual khác vẫn bắt buộc deadline cụ thể khi đăng ký/giao', () => {
  assert.equal(requiresManualDeadline('Khác'), true);
  assert.throws(() => deriveDeadlinePlan({
    frequency: 'Khác',
    completionDeadline: '',
    periodStartDate: '2026-07-01',
    periodEndDate: '2026-09-30',
    manualDeadlineDateKey: ''
  }), /Hạn hoàn thành cụ thể/);
});

test('V1.15.0: lượt hoàn thành sớm được tính ngay; lượt tương lai chưa xong không tính; lượt quá hạn chưa xong = 0', () => {
  const summary = calculateWorkItemSummary([
    {
      id: 'early', active: true, workItemType: 'GENERIC',
      assignedDateKey: '2026-08-20', deadlineDateKey: '2026-09-25', completedDateKey: '2026-08-24',
      progressRate: 100, resultRate: 100
    },
    {
      id: 'future', active: true, workItemType: 'GENERIC',
      assignedDateKey: '2026-08-20', deadlineDateKey: '2026-09-30', completedDateKey: '',
      progressRate: 0, resultRate: 0
    },
    {
      id: 'overdue', active: true, workItemType: 'GENERIC',
      assignedDateKey: '2026-08-10', deadlineDateKey: '2026-08-20', completedDateKey: '',
      progressRate: 0, resultRate: 0
    }
  ], 'GENERIC', '2026-08-24');
  assert.equal(summary.totalRecordedCount, 3);
  assert.equal(summary.eligibleCount, 2);
  assert.equal(summary.futurePendingCount, 1);
  assert.equal(summary.completedCount, 1);
  assert.equal(summary.actualProgressRate, 50);
  assert.equal(summary.appliedProgressRate, 0);
});

test('V1.15.0: registration/task event-driven được canonical và ép ITEMIZED/GENERIC', () => {
  const source = read('services/task-registration-service.js');
  const standard = read('services/standard-task-write-service.js');
  assert.match(source, /deadlineMode:\s*"EVENT_DRIVEN"/);
  assert.match(source, /deadline:\s*null/);
  assert.match(source, /eventDrivenDeadline:\s*deadlinePlan\.eventDriven === true/);
  assert.match(source, /frequency:\s*deadlinePlan\.mode === "EVENT_DRIVEN" \? "Khi phát sinh"/);
  assert.match(source, /trackingMode:\s*deadlinePlan\.mode === "EVENT_DRIVEN"[\s\S]*?"ITEMIZED"/);
  assert.match(source, /workItemType:\s*deadlinePlan\.mode === "EVENT_DRIVEN"[\s\S]*?"GENERIC"/);
  assert.match(standard, /frequency:\s*eventDriven \? "Khi phát sinh"/);
  assert.match(standard, /const trackingMode = eventDriven \? "ITEMIZED"/);
});

test('V1.15.0: Rules cho phép plan Khi phát sinh không deadline nhưng bắt deadline ở từng lượt thực tế', () => {
  const rules = readRepo('firestore.rules');
  assert.match(rules, /data\.deadlineMode == "EVENT_DRIVEN"/);
  assert.match(rules, /data\.frequency == "Khi phát sinh"/);
  assert.match(rules, /data\.trackingMode == "ITEMIZED"/);
  assert.match(rules, /function taskWorkItemDeadlineValid\(data\)/);
  assert.match(rules, /hasField\(data, "assignedDateKey"\)[\s\S]*?hasField\(data, "deadlineDateKey"\)/);
  assert.match(rules, /allow create:[\s\S]*?taskWorkItemDeadlineValid\(request\.resource\.data\)/);
});

test('V1.15.0: UI lượt phát sinh bắt buộc ngày phát sinh và hạn cụ thể', () => {
  const detail = read('modules/tasks/task-detail-modal.js');
  assert.match(detail, /Hạn hoàn thành cụ thể/);
  assert.match(detail, /Ngày phát sinh\/nhận yêu cầu/);
  assert.match(detail, /Ghi nhận việc phát sinh/);
  assert.match(detail, /Theo từng lượt phát sinh/);
  const service = read('services/task-work-item-service.js');
  assert.match(service, /if \(!assignedDateKey\) throw new Error\("Hãy chọn ngày giao\."\)/);
  assert.match(service, /if \(!deadlineDateKey\) throw new Error\("Hãy chọn hạn hoàn thành\."\)/);
});

test('V1.15.0: nhiều minh chứng là collection riêng, chọn nhiều file và không ghi đè reference cũ', () => {
  const evidence = read('services/task-evidence-service.js');
  const progress = read('modules/tasks/task-progress-modal.js');
  const detail = read('modules/tasks/task-detail-modal.js');
  const rules = readRepo('firestore.rules');
  assert.match(evidence, /const COLLECTION = "taskEvidenceFiles"/);
  assert.match(evidence, /MAX_EVIDENCE_FILES_PER_TASK = 20/);
  assert.match(evidence, /MAX_EVIDENCE_FILES_PER_SELECTION = 10/);
  assert.match(evidence, /batch\.set\(reference, payload\)/);
  assert.match(progress, /type="file"[^>]*multiple/);
  assert.match(detail, /type="file"[^>]*multiple/);
  assert.match(progress, /TaskEvidenceService\.addUploadedFiles/);
  assert.match(detail, /TaskEvidenceService\.addUploadedFiles/);
  assert.match(rules, /match \/taskEvidenceFiles\/\{evidenceId\}/);
});

test('V1.15.0: Apps Script V4.4.1 chuẩn hóa Khi phát sinh và migration trigger không lỗi giả vì getUi', () => {
  const script = readRepo('deployment/apps-script-standard-tasks-v4.4.1.gs');
  assert.match(script, /VERSION:\s*'4\.4\.1'/);
  assert.match(script, /if \(key === 'khi phat sinh'\) return 'ARISING'/);
  assert.match(script, /function normalizeEventDrivenRows_/);
  assert.match(script, /frequency:\s*eventDriven \? 'Khi phát sinh'/);
  assert.match(script, /trackingMode = eventDriven \? 'ITEMIZED'/);
  assert.match(script, /function safeUiAlert_/);
  assert.match(script, /safeUiAlert_\([\s\S]*?'Đã tối ưu lịch đồng bộ V4\.4\.1'/);
});

test('V1.15.0: archive/index đã có taskEvidenceFiles và query scope mới', () => {
  const archive = read('services/period-archive-service.js');
  const indexes = JSON.parse(readRepo('firestore.indexes.json'));
  assert.match(archive, /"taskEvidenceFiles"/);
  const groups = indexes.indexes.filter(item => item.collectionGroup === 'taskEvidenceFiles');
  assert.equal(groups.length >= 2, true);
  const fieldSets = groups.map(item => item.fields.map(field => field.fieldPath).join('|'));
  assert.equal(fieldSets.includes('taskId|ownerUserId'), true);
  assert.equal(fieldSets.includes('taskId|departmentId'), true);
});


test('V1.15.0 regression: Theo tháng vẫn là 01 task + nhiều mốc và giữ công thức milestone V1.14.2', () => {
  const plan = deriveDeadlinePlan({
    frequency: 'Theo tháng', completionDeadline: '25',
    periodStartDate: '2026-07-01', periodEndDate: '2026-09-30'
  });
  assert.equal(plan.mode, 'MONTHLY_MILESTONES');
  assert.deepEqual(plan.milestoneDateKeys, ['2026-07-25', '2026-08-25', '2026-09-25']);
  const completed = key => new Date(`${key}T08:00:00+07:00`);
  const score = calculateMilestoneProgress([
    { dueDateKey: '2026-07-25', completedAt: completed('2026-08-10') },
    { dueDateKey: '2026-08-25', completedAt: completed('2026-08-24') },
    { dueDateKey: '2026-09-25', completedAt: completed('2026-08-24') }
  ], new Date('2026-08-24T12:00:00+07:00'));
  assert.deepEqual(score.rates, [0, 100, 100]);
  assert.equal(score.appliedProgressRate, 60);
});

test('V1.15.0 regression: quyền báo cáo Phó và quyền duyệt Trưởng tiếp tục tách biệt', () => {
  const rules = readRepo('firestore.rules');
  assert.match(rules, /canViewDepartmentReportData[\s\S]*isDepartmentLeader\(\) && sameDepartment\(departmentId\)/);
  assert.match(rules, /canApproveDepartmentRegistrations[\s\S]*isDepartmentHead\(\) && sameDepartment\(departmentId\)/);
  assert.match(rules, /canConfirmDepartmentEvaluations[\s\S]*isDepartmentHead\(\) && sameDepartment\(departmentId\)/);
});

test('V1.15.0 regression: Push vẫn non-blocking và score confirm vẫn commit-first', () => {
  const push = read('services/task-notification-service.js');
  const workflow = read('modules/kpi/kpi-workflow.js');
  assert.match(push, /queue|enqueue|Promise/i);
  assert.match(workflow, /scoreBatch\.commit\(\)/);
  assert.match(workflow, /scheduleKpiRealtimeReload/);
});

test('V1.15.0: build/version và release script đã được nâng đồng bộ', () => {
  const version = read('core/app-version.js');
  const index = read('index.html');
  const sw = read('sw.js');
  assert.match(version, /APP_VERSION = "1\.15\.0"/);
  assert.match(version, /BUILD_VERSION = "20260824\.V1_15_0"/);
  assert.match(version, /CACHE_NAME = "nhiem-vu-20260824-v1-15-0"/);
  assert.match(index, /release-v1\.15\.0\.js\?v=20260824\.V1_15_0/);
  assert.match(sw, /const BUILD_VERSION = "20260824\.V1_15_0"/);
  assert.match(sw, /const CACHE_NAME = "nhiem-vu-" \+ BUILD_VERSION/);
});
