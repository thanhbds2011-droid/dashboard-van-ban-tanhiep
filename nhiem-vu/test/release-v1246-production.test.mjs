import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const repoRoot = resolve(appRoot, '..');
const read = rel => readFileSync(join(appRoot, rel), 'utf8');
const sha256 = p => createHash('sha256').update(readFileSync(p)).digest('hex');
const walk = dir => readdirSync(dir).flatMap(name => {
  const p = join(dir, name);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

function between(text, start, end) {
  const a = text.indexOf(start);
  assert.ok(a >= 0, `Không tìm thấy start: ${start}`);
  const b = text.indexOf(end, a + start.length);
  assert.ok(b >= 0, `Không tìm thấy end: ${end}`);
  return text.slice(a, b);
}

test('V1.24.6: version/build/cache/release marker đồng nhất', () => {
  const version = read('core/app-version.js');
  const index = read('index.html');
  const sw = read('sw.js');
  const release = read('release-v1.24.6.js');
  assert.match(version, /APP_VERSION = "1\.24\.6"/);
  assert.match(version, /BUILD_VERSION = "20260916\.V1_24_6"/);
  assert.match(version, /CACHE_NAME = "nhiem-vu-20260916-v1-24-6"/);
  assert.match(index, /meta name="app-build" content="20260916\.V1_24_6"/);
  assert.match(index, /appVersionLabel">V1\.24\.6</);
  assert.match(index, /release-v1\.24\.6\.js\?v=20260916\.V1_24_6/);
  assert.match(sw, /BUILD_VERSION = "20260916\.V1_24_6"/);
  assert.match(release, /Department\/Khu Council Summary/);
});

test('V1.24.6: deployable runtime không còn build token V1.24.5', () => {
  const files = walk(appRoot).filter(p => !p.includes('/test/') && /\.(js|html|css|webmanifest|mjs|json)$/.test(p));
  for (const file of files) assert.equal(readFileSync(file, 'utf8').includes('20260916.V1_24_5'), false, file);
});

test('V1.24.6: active import graph tồn tại đầy đủ và dùng cùng build token', () => {
  const BUILD = '20260916.V1_24_6';
  const entries = ['app-v3.js', 'pwa.js', 'release-v1.24.6.js'];
  const seen = new Set();
  const importPattern = /(?:from\s+|import\s*\(|lazyRoute\s*\()\s*["']([^"']+)["']/g;

  function visit(rel) {
    rel = rel.replaceAll('\\', '/');
    if (seen.has(rel)) return;
    seen.add(rel);
    const full = join(appRoot, rel);
    assert.equal(statSync(full).isFile(), true, `Thiếu module: ${rel}`);
    const source = readFileSync(full, 'utf8');
    for (const match of source.matchAll(importPattern)) {
      const ref = match[1];
      if (/^https?:/i.test(ref) || (!ref.includes('.js') && !ref.includes('.js?'))) continue;
      const [pathPart, query = ''] = ref.split('?');
      if (query.startsWith('v=')) assert.equal(query.slice(2), BUILD, `${rel} -> ${ref}`);
      const target = resolve(dirname(full), pathPart);
      if (!target.startsWith(appRoot)) continue;
      visit(target.slice(appRoot.length + 1));
    }
  }

  entries.forEach(visit);
  assert.ok(seen.has('modules/kpi/kpi-workflow.js'));
});

test('Tổng hợp Phòng/Khu ẩn segment bằng 0 và không còn chuỗi 0 Chi đoàn cố định', () => {
  const workflow = read('modules/kpi/kpi-workflow.js');
  const block = between(workflow, 'function openDepartmentReport(options = {})', 'function taskStatus(task, ev)');
  assert.match(block, /if \(professionalCount > 0\) taskBreakdownParts\.push\(`\$\{professionalCount\} chuyên môn`\);/);
  assert.match(block, /if \(cdtnCount > 0\) taskBreakdownParts\.push\(`\$\{cdtnCount\} Chi đoàn`\);/);
  assert.match(block, /taskBreakdownParts\.join\(' · '\) \|\| '—'/);
  assert.doesNotMatch(block, /`\$\{professionalCount\} chuyên môn · \$\{cdtnCount\} Chi đoàn`/);
});

test('Tổng hợp Hội đồng hiển thị A/B/KPI70/vượt/thưởng/common/tổng/xếp loại/trạng thái từ helper hiện hành', () => {
  const workflow = read('modules/kpi/kpi-workflow.js');
  const block = between(workflow, 'function openDepartmentReport(options = {})', 'function taskStatus(task, ev)');
  assert.match(block, /summaryForUserCombined\(user\.id\)/);
  assert.match(block, /\$\{fmt\(data\.A\)\}/);
  assert.match(block, /\$\{fmt\(data\.B\)\}/);
  assert.match(block, /fmt\(data\.kpi70\)/);
  assert.match(block, /ratingForUser\(user\.id, data\.total100, \{ officialOnly: officialState \}\)/);
  assert.match(block, /Number\(rating\.exceededTasks \|\| 0\)/);
  assert.match(block, /bonusSummaryForUser\(user\.id\)/);
  assert.match(block, /fmt\(data\.common30\)/);
  assert.match(block, /fmt\(data\.total100\)/);
  assert.match(block, /ratingName\(rating\.code\)/);
  assert.match(block, /kpi-score-badge/);
  assert.match(block, /Điểm kế hoạch<br>\(A\)/);
  assert.match(block, /Điểm thực hiện<br>\(B\)/);
  assert.match(block, /Điểm KPI công việc<br>\(70\)/);
  assert.match(block, /Đầu việc<br>vượt/);
});

test('Tổng hợp Phòng/Khu không phát sinh Firestore query/read mới trong renderer', () => {
  const workflow = read('modules/kpi/kpi-workflow.js');
  const block = between(workflow, 'function openDepartmentReport(options = {})', 'function taskStatus(task, ev)');
  assert.doesNotMatch(block, /\bgetDoc\s*\(/);
  assert.doesNotMatch(block, /\bgetDocs\s*\(/);
  assert.doesNotMatch(block, /\bonSnapshot\s*\(/);
  assert.doesNotMatch(block, /FirebaseService\.(?:getDoc|getDocs|onSnapshot)/);
});

test('Báo cáo Phòng/Khu in landscape có mục tiêu, Chi đoàn không bị ép landscape', () => {
  const workflow = read('modules/kpi/kpi-workflow.js');
  const css = read('kpi.css');
  const block = between(workflow, 'function openDepartmentReport(options = {})', 'function taskStatus(task, ev)');
  assert.match(block, /professionalSummary = normalizeDepartment\(selectedDepartmentId \|\| defaultDepartment\) !== 'CDTN'/);
  assert.match(block, /pageStyle\.textContent = '@page \{ size: A4 landscape; margin: 10mm; \}'/);
  assert.match(block, /department-report-kpi-summary-table/);
  assert.match(css, /\.department-report-kpi-summary-table/);
  assert.match(css, /font-size: 7\.6pt/);
  assert.match(css, /\.department-report-kpi-summary \.kpi-table-wrap/);
});

test('V1.24.5 regression guards vẫn còn: personal title và Excel không in mã nội bộ', () => {
  const workflow = read('modules/kpi/kpi-workflow.js');
  const planBlock = between(workflow, 'function openPersonPlanDetail(uid)', 'function renderEvaluationDashboard');
  assert.match(planBlock, /const personalLabel = clean\(item\.title\) \|\| clean\(item\.standardTaskName\) \|\| '';/);
  const catalogBlock = between(workflow, 'async function openProductCatalog', 'function openDepartmentReport');
  assert.match(catalogBlock, /task\.title\|\|task\.standardTaskName/);

  const xlsx = read('services/xlsx-export-service.js');
  const xlsxBlock = between(xlsx, 'export function buildProductCatalogWorkbookBlob', 'export function exportProductCatalogWorkbook');
  assert.match(xlsxBlock, /\{ value:item\.title \|\| '', style:2 \}/);
  assert.doesNotMatch(xlsxBlock, /\[item\.taskCode, item\.title\]/);
});

test('KPI scoring/deadline core và Firestore backend không đổi bytes', () => {
  const expected = {
    'kpi-engine.js': 'bd3f04de8ec762d5a497068ab8fb254537406c2f8de17b9e40838da3517e89c1',
    'work-item-score-engine.js': '253edb052129d6b9e2922ed4b3b0a485686ba8f8a5626ad58974f8daf085ce15',
    'core/deadline-engine.js': '4d1378dd6ec4d81c8d6d474e5c65bfee7373de95e5bcad4cee2d86357474b6ee',
    '../firestore.rules': '41232a7ec4b02ec7997a9ce409a4eb6bda01ea49569a31fca54e5aeb9a526cc8',
    '../firestore.indexes.json': 'a847d118cf8832f0c2408bc85c53c734606e97c7c36ac05ff2b59c92355effaf'
  };
  for (const [rel, hash] of Object.entries(expected)) {
    const path = rel.startsWith('../') ? join(repoRoot, rel.slice(3)) : join(appRoot, rel);
    assert.equal(sha256(path), hash, rel);
  }
});
