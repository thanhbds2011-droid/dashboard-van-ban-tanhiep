import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import * as xlsxModule from '../services/xlsx-export-service.js';

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

async function writeBlob(blob, ext) {
  const file = join(os.tmpdir(), `kpi-v1245-${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`);
  writeFileSync(file, Buffer.from(await blob.arrayBuffer()));
  return file;
}

test('V1.24.5: version/build/cache/release marker đồng nhất', () => {
  const version = read('core/app-version.js');
  const index = read('index.html');
  const sw = read('sw.js');
  assert.match(version, /APP_VERSION = "1\.24\.5"/);
  assert.match(version, /BUILD_VERSION = "20260916\.V1_24_5"/);
  assert.match(version, /CACHE_NAME = "nhiem-vu-20260916-v1-24-5"/);
  assert.match(index, /meta name="app-build" content="20260916\.V1_24_5"/);
  assert.match(index, /appVersionLabel">V1\.24\.5</);
  assert.match(index, /release-v1\.24\.5\.js\?v=20260916\.V1_24_5/);
  assert.match(sw, /BUILD_VERSION = "20260916\.V1_24_5"/);
});

test('V1.24.5: deployable runtime không còn build token V1.24.4', () => {
  const files = walk(appRoot).filter(p => !p.includes('/test/') && /\.(js|html|css|webmanifest|mjs|json)$/.test(p));
  for (const file of files) assert.equal(readFileSync(file, 'utf8').includes('20260914.V1_24_4'), false, file);
});

test('V1.24.5: active import graph tồn tại đầy đủ và dùng cùng build token', () => {
  const BUILD = '20260916.V1_24_5';
  const entries = ['app-v3.js', 'pwa.js', 'release-v1.24.5.js'];
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
  assert.ok(seen.has('services/xlsx-export-service.js'));
});

test('Kế hoạch cá nhân luôn ưu tiên title, không phụ thuộc count', () => {
  const workflow = read('modules/kpi/kpi-workflow.js');
  const block = between(workflow, 'function openPersonPlanDetail(uid)', 'function renderEvaluationDashboard');
  assert.match(block, /const personalLabel = clean\(item\.title\) \|\| clean\(item\.standardTaskName\) \|\| '';/);
  assert.doesNotMatch(block, /count > 1 \? \(item\.title \|\| item\.standardTaskName/);
  assert.match(block, /const groupName = item\.standardTaskName \|\| item\.title \|\| '';/);
});

test('Danh mục sản phẩm UI tiếp tục dùng tên công việc cá nhân, không hiện mã nội bộ', () => {
  const workflow = read('modules/kpi/kpi-workflow.js');
  const block = between(workflow, 'async function openProductCatalog', 'function openDepartmentReport');
  assert.match(block, /task\.title \|\| task\.standardTaskName/);
  const rowHtml = block.match(/return `<tr>[\s\S]*?`;/)?.[0] || '';
  assert.doesNotMatch(rowHtml, /task\.taskCode/);
});

test('Danh mục sản phẩm XLSX chỉ xuất title, không xuất mã danh mục nội bộ', async () => {
  const source = read('services/xlsx-export-service.js');
  const block = between(source, 'export function buildProductCatalogWorkbookBlob', 'export function exportProductCatalogWorkbook');
  assert.match(block, /\{ value:item\.title \|\| '', style:2 \}/);
  assert.doesNotMatch(block, /\[item\.taskCode, item\.title\]/);

  const blob = xlsxModule.buildProductCatalogWorkbookBlob({
    periodLabel:'Quý III năm 2026', employeeName:'Nguyễn Văn A', employeePosition:'Nhân viên', departmentName:'Phòng Y tế',
    rows:[{ index:1, taskCode:'YT11', title:'Thực hiện quản lý tủ thuốc cấp cứu', outputRequirement:'Tủ thuốc được kiểm tra', deadlineLabel:'Theo từng lượt phát sinh', workTypeLabel:'Thường xuyên', baseScore:10, coefficientLabel:'110%', maximumConvertedScore:11, evidence:'Sổ theo dõi' }], exceededCount:0
  });
  const file = await writeBlob(blob, 'xlsx');
  try {
    execFileSync('unzip', ['-t', file], { stdio:'ignore' });
    const sheet = execFileSync('unzip', ['-p', file, 'xl/worksheets/sheet1.xml'], { encoding:'utf8' });
    assert.match(sheet, /Thực hiện quản lý tủ thuốc cấp cứu/);
    assert.doesNotMatch(sheet, />YT11</);
    assert.doesNotMatch(sheet, /YT11\n/);
  } finally {
    unlinkSync(file);
  }
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
