import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildKpiWorkbookBlob } from '../services/xlsx-export-service.js?v=20260903.V1_22_3';
import { calculateKpiSummary } from '../kpi-engine.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const releaseRoot = path.resolve(appRoot, '..');
const read = rel => fs.readFileSync(path.join(appRoot, rel), 'utf8');
const readRelease = rel => fs.readFileSync(path.join(releaseRoot, rel), 'utf8');

test('V1.22.3 version/build/cache and entry assets are synchronized', () => {
  const version = read('core/app-version.js');
  assert.match(version, /APP_VERSION\s*=\s*["']1\.22\.3["']/);
  assert.match(version, /BUILD_VERSION\s*=\s*["']20260903\.V1_22_3["']/);
  assert.match(version, /CACHE_NAME\s*=\s*["']nhiem-vu-20260903-v1-22-3["']/);
  const index = read('index.html');
  assert.match(index, /ui-v1\.22\.3\.css\?v=20260903\.V1_22_3/);
  assert.match(index, /release-v1\.22\.3\.js\?v=20260903\.V1_22_3/);
  assert.match(read('sw.js'), /BUILD_VERSION = "20260903\.V1_22_3"/);
});

test('Score tables use Tên công việc and expose A/B/KPI/X/bonus summaries without changing scoring engine', () => {
  const workflow = read('modules/kpi/kpi-workflow.js');
  assert.match(workflow, /<th>Tên công việc<\/th>/);
  assert.doesNotMatch(workflow, /<th>Tên nhiệm vụ<\/th>/);
  assert.match(workflow, /Điểm giá trị A/);
  assert.match(workflow, /Điểm giá trị B/);
  assert.match(workflow, /KPI % \(trục 4\) = B\/A\*70 điểm/);
  assert.match(workflow, /Tổng số công việc vượt tiến độ và đạt yêu cầu chất lượng/);
  assert.match(workflow, /Tổng số điểm thưởng đối với các công việc vượt tiến độ/);
  const summary = calculateKpiSummary([
    { active:true, includedInA:true, planApprovalStatus:'APPROVED', maximumConvertedScore:12, recognized:true, confirmedActualScore:10, bonusScore:0.5 },
    { active:true, includedInA:true, planApprovalStatus:'APPROVED', maximumConvertedScore:10, recognized:true, confirmedActualScore:9, bonusScore:0.45 }
  ], 0);
  assert.equal(summary.A, 22);
  assert.equal(summary.B, 19);
  assert.equal(summary.kpi70, 60.45);
  assert.equal(summary.bonusC, 0.95);
});

test('Formatted Excel exporter is native XLSX and contains regulated score summary labels', async () => {
  const blob = buildKpiWorkbookBlob({
    periodLabel:'Quý III năm 2026', employeeName:'Nguyễn Văn A', employeePosition:'Nhân viên Phòng Y tế',
    rows:[{ index:1, taskCode:'YT01', title:'Công việc kiểm thử', baseScore:10, coefficientLabel:'110%', maximumConvertedScore:11, progressLabel:'100%', resultLabel:'100%', executionScore:10, actualScore:11, exceededLabel:'X', evidence:'Báo cáo.pdf' }],
    summary:{ A:11, B:11, kpi70:70, exceededCount:1, bonusC:0.55, hasCalculationBasis:true }
  });
  assert.equal(blob.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.equal(String.fromCharCode(...bytes.slice(0,2)), 'PK');
  const raw = new TextDecoder().decode(bytes);
  assert.match(raw, /Tên công việc/);
  assert.match(raw, /Điểm giá trị A/);
  assert.match(raw, /Điểm giá trị B/);
  assert.match(raw, /Tổng số công việc vượt tiến độ/);
  assert.match(raw, /Tổng số điểm thưởng/);
});

test('Product catalog reuses official two-column agency/national header for popup and print', () => {
  const workflow = read('modules/kpi/kpi-workflow.js');
  assert.match(workflow, /kpi-product-official-header/);
  assert.match(workflow, /SỞ Y TẾ<br>THÀNH PHỐ HỒ CHÍ MINH<br>TRUNG TÂM BẢO TRỢ XÃ HỘI TÂN HIỆP/);
  assert.match(workflow, /CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM/);
  assert.match(workflow, /Độc lập - Tự do - Hạnh phúc/);
  const css = read('ui-v1.22.3.css');
  assert.match(css, /\.kpi-product-official-header/);
  assert.match(css, /@media print[\s\S]*\.kpi-product-official-header/);
});

test('Tasks and Dashboard start existing scoped realtime promptly while keeping lifecycle unsubscribe', () => {
  const tasks = read('modules/tasks/tasks-view.js');
  const dashboard = read('modules/dashboard/dashboard-view.js');
  assert.match(tasks, /startDelayMs:\s*0,\s*jitterMs:\s*1200/);
  assert.match(dashboard, /startDelayMs:\s*0,\s*jitterMs:\s*1200/);
  assert.match(tasks, /stopTasksRealtime\(\)/);
  assert.match(dashboard, /stopDashboardTaskRealtime\(\)/);
  assert.doesNotMatch(tasks, /startDelayMs:\s*90\s*\*\s*1000/);
  assert.doesNotMatch(dashboard, /startDelayMs:\s*90\s*\*\s*1000/);
});

test('Packaged Firestore Rules remain V1.22.1 and indexes remain 21; no rules/index deployment is required', () => {
  const rules = readRelease('firestore.rules');
  assert.match(rules, /Production Rules V1\.22\.1 - 2026-09-03/);
  assert.match(rules, /after\.bonusRate == 0\.05/);
  const indexes = JSON.parse(readRelease('firestore.indexes.json'));
  assert.equal(indexes.indexes.length, 21);
});
