import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildKpiWorkbookBlob } from '../services/xlsx-export-service.js?v=20260903.V1_22_5';
import { calculateBonusScore, calculateKpiSummary } from '../kpi-engine.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const releaseRoot = path.resolve(appRoot, '..');
const baselineRoot = '/mnt/data/dashboard-van-ban-tanhiep-v1.22.4-production';
const read = rel => fs.readFileSync(path.join(appRoot, rel), 'utf8');
const sha256File = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('V1.22.5 version/build/cache and release marker are synchronized', () => {
  const version = read('core/app-version.js');
  assert.match(version, /APP_VERSION\s*=\s*["']1\.22\.5["']/);
  assert.match(version, /BUILD_VERSION\s*=\s*["']20260903\.V1_22_5["']/);
  assert.match(version, /CACHE_NAME\s*=\s*["']nhiem-vu-20260903-v1-22-5["']/);
  const index = read('index.html');
  assert.match(index, /release-v1\.22\.5\.js\?v=20260903\.V1_22_5/);
  assert.match(read('sw.js'), /BUILD_VERSION = "20260903\.V1_22_5"/);
});

test('Provisional bonus presentation is separate from official bonus and respects cap 7', () => {
  const workflow = read('modules/kpi/kpi-workflow.js');
  const block = workflow.match(/function bonusPresentationValues[\s\S]*?(?=function bonusPresentationForUser)/)?.[0];
  assert.ok(block, 'bonusPresentationValues helper must exist');
  const round2 = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  const fn = new Function('round2', `${block}; return bonusPresentationValues;`)(round2);
  assert.deepEqual(fn(0, 2), { approvedBonus:0, pendingBonus:2, displayBonus:2, hasPendingBonus:true });
  assert.deepEqual(fn(1.2, 0.8), { approvedBonus:1.2, pendingBonus:0.8, displayBonus:2, hasPendingBonus:true });
  assert.deepEqual(fn(1.6, 0), { approvedBonus:1.6, pendingBonus:0, displayBonus:1.6, hasPendingBonus:false });
  assert.deepEqual(fn(6.8, 1), { approvedBonus:6.8, pendingBonus:1, displayBonus:7, hasPendingBonus:true });
});

test('Scoring engine remains authoritative: pending bonus is not added to official KPI', () => {
  assert.equal(calculateBonusScore(40, 0.05), 2);
  const summary = calculateKpiSummary([
    { active:true, includedInA:true, planApprovalStatus:'APPROVED', maximumConvertedScore:40, recognized:true, confirmedActualScore:40, bonusScore:1.2 },
    { active:true, includedInA:true, planApprovalStatus:'APPROVED', maximumConvertedScore:20, recognized:true, confirmedActualScore:20, bonusScore:0 }
  ], 30);
  assert.equal(summary.bonusC, 1.2);
  assert.equal(summary.total100, 100); // 70 + 30 + 1.2 is capped at 100.
});

test('Scorecard and personal report expose provisional/official status without replacing business comments', () => {
  const workflow = read('modules/kpi/kpi-workflow.js');
  assert.match(workflow, /bonusDisplay/);
  assert.match(workflow, /\(Chưa xác nhận\)/);
  assert.match(workflow, /Đã xác nhận: \$\{fmt\(data\.bonusApproved\)\} điểm/);
  assert.match(workflow, /function evaluationBusinessNotes/);
  assert.match(workflow, /KPI_SYSTEM_REVIEWER_COMMENTS/);
  assert.match(workflow, /Xác nhận theo điểm tự đánh giá đã chọn hàng loạt\./);
  assert.match(workflow, /data-kpi-report-task-note/);
  assert.match(workflow, /statusText: pending \? 'Chưa xác nhận' : ''/);
  assert.doesNotMatch(workflow, /statusText: approved \? 'Đã chấp thuận' : 'Chờ xác nhận'/);
});

test('Readonly KPI modals refresh from realtime state while edit modals remain protected', () => {
  const workflow = read('modules/kpi/kpi-workflow.js');
  assert.match(workflow, /function refreshReadonlyKpiModal/);
  assert.match(workflow, /dataset\.kpiReadonlyModal = 'scorecard'/);
  assert.match(workflow, /dataset\.kpiReadonlyModal = 'report'/);
  assert.match(workflow, /refreshReadonlyKpiModal\(openKpiModal\)/);
  assert.match(workflow, /window\.setTimeout\(renderWhenReady, 700\)/);
});

test('Formatted XLSX shows provisional bonus and partial confirmed amount, but keeps official summary field separate', async () => {
  const blob = buildKpiWorkbookBlob({
    periodLabel:'Quý III năm 2026', employeeName:'Nguyễn Văn A', employeePosition:'Nhân viên Phòng Y tế',
    rows:[{ index:1, taskCode:'YT01', title:'Công việc kiểm thử', baseScore:40, coefficientLabel:'100%', maximumConvertedScore:40, progressLabel:'100%', resultLabel:'100%', executionScore:40, actualScore:40, exceededLabel:'X', evidence:'Báo cáo.pdf' }],
    summary:{ A:40, B:40, kpi70:70, exceededCount:1, bonusC:1.2, bonusApproved:1.2, bonusPending:0.8, bonusDisplay:2, bonusHasPending:true, hasCalculationBasis:true }
  });
  const raw = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()));
  assert.match(raw, /2 điểm \(Chưa xác nhận\)/);
  assert.match(raw, /Trong đó điểm thưởng đã xác nhận/);
  assert.match(raw, />1\.2</);
});

test('Report quarter continues to use period metadata, not startDate month', () => {
  const workflow = read('modules/kpi/kpi-workflow.js');
  assert.match(workflow, /const reportPeriodMeta = periodQuarterMeta\(KpiWorkflowState\.period\)/);
  assert.doesNotMatch(workflow, /const quarterNumber = startMatch \? Math\.ceil\(Number\(startMatch\[2\]\) \/ 3\)/);
});

test('Firestore Rules and indexes remain byte-identical to V1.22.4 package', () => {
  assert.equal(sha256File(path.join(releaseRoot, 'firestore.rules')), sha256File(path.join(baselineRoot, 'firestore.rules')));
  assert.equal(sha256File(path.join(releaseRoot, 'firestore.indexes.json')), sha256File(path.join(baselineRoot, 'firestore.indexes.json')));
  const indexes = JSON.parse(fs.readFileSync(path.join(releaseRoot, 'firestore.indexes.json'), 'utf8'));
  assert.equal(indexes.indexes.length, 21);
});
