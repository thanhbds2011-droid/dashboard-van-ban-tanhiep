import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const read = rel => fs.readFileSync(path.join(appRoot, rel), 'utf8');

const VERSION = '1.23.1';
const BUILD = '20260911.V1_23_1';
const CACHE = 'nhiem-vu-20260911-v1-23-1';

test('V1.23.1 version/build/cache and release marker are synchronized', () => {
  const version = read('core/app-version.js');
  assert.match(version, new RegExp(`APP_VERSION\\s*=\\s*["']${VERSION.replaceAll('.', '\\.')}`));
  assert.match(version, new RegExp(`BUILD_VERSION\\s*=\\s*["']${BUILD.replaceAll('.', '\\.')}`));
  assert.match(version, new RegExp(`CACHE_NAME\\s*=\\s*["']${CACHE}`));
  assert.match(read('index.html'), /meta name="app-build" content="20260911\.V1_23_1"/);
  assert.match(read('index.html'), /release-v1\.23\.1\.js\?v=20260911\.V1_23_1/);
  assert.match(read('sw.js'), /BUILD_VERSION = "20260911\.V1_23_1"/);
  assert.match(read('release-v1.23.1.js'), /V1\.23\.1 – Registration Output \+ Evidence UI/);
});

test('all live module cache-busting references use the V1.23.1 build token', () => {
  const candidates = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'test') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(?:js|html)$/.test(entry.name)) candidates.push(full);
    }
  };
  walk(appRoot);
  for (const file of candidates) {
    const rel = path.relative(appRoot, file).replaceAll('\\', '/');
    if (['release-v1.23.0.js', 'release-v1.22.7.js'].includes(rel)) continue;
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /\?v=20260904\.V1_23_0/, `${rel} còn token build cũ V1.23.0`);
  }
  assert.match(read('modules/reports/reports-view.js'), /kpi-workflow\.js\?v=20260911\.V1_23_1/);
  assert.doesNotMatch(read('modules/reports/reports-view.js'), /20260903\.V1_22_5/);
});

test('personal registration modal uses “Đầu việc cá nhân” and removes visible “Nội dung thực hiện” label', () => {
  const source = read('modules/standard-tasks/standard-tasks-view.js');
  const personalize = source.match(/function preparePersonalRegistrationDetails[\s\S]*?(?=\nfunction prepareRejectedRegistrationEdit)/)?.[0] || '';
  const rejected = source.match(/function prepareRejectedRegistrationEdit[\s\S]*?(?=\nfunction |\nexport )/)?.[0] || '';
  assert.match(personalize, /<h2>Đầu việc cá nhân<\/h2>/);
  assert.match(personalize, /isFirst \? "Đầu việc cá nhân" : "Công việc bổ sung"/);
  assert.match(personalize, /data-personal-title aria-label="Đầu việc cá nhân"/);
  assert.doesNotMatch(personalize, /<span>Nội dung thực hiện<\/span>/);
  assert.match(personalize, /<span>Kết quả đầu ra<\/span>/);
  assert.match(personalize, /data-personal-frequency/);
  assert.match(personalize, /data-personal-completion/);
  assert.match(personalize, /data-personal-fixed-deadline/);
  assert.match(rejected, /data-personal-title aria-label="Đầu việc cá nhân"/);
  assert.doesNotMatch(rejected, /<span>Nội dung thực hiện<\/span>/);
});

test('plan approval table shows output requirement without adding a new query/listener', () => {
  const source = read('modules/kpi/kpi-workflow.js');
  const block = source.match(/function openPersonPlanDetail\(uid\)[\s\S]*?(?=\nasync function |\nfunction [A-Za-z_].*\{)/)?.[0] || '';
  assert.match(block, /<th>Đầu việc<\/th><th>Kết quả đầu ra<\/th><th>Điểm chuẩn<\/th>/);
  assert.match(block, /colspan="8"/);
  assert.match(block, /item\.kind === 'registration'[\s\S]*?item\.description[\s\S]*?item\.expectedOutput \|\| item\.description/);
  assert.match(block, /esc\(outputRequirement \|\| '—'\)/);
  assert.doesNotMatch(block, /getDocs\(|onSnapshot\(/, 'Không được tạo query/listener mới chỉ để hiển thị Kết quả đầu ra');
});

test('work-item staged evidence becomes visible after file selection and history re-renders after save refresh', () => {
  const source = read('modules/tasks/task-detail-modal.js');
  const editor = source.match(/function openWorkItemEditor\([\s\S]*?(?=\nfunction noOccurrenceHtml)/)?.[0] || '';
  assert.match(editor, /id="workItemEvidenceStagedBox"[\s\S]*?hidden/);
  assert.match(editor, /const snapshot = staged\.snapshot\(\)/);
  assert.match(editor, /const box = overlay\.querySelector\("#workItemEvidenceStagedBox"\)/);
  assert.match(editor, /box\.hidden = !hasVisible/);
  assert.match(source, /selected \? "Đã chọn · Chưa lưu"/);
  assert.match(editor, /await staged\.uploadPending\(\)/);
  assert.match(editor, /TaskWorkItemService\.save/);
  assert.match(editor, /TaskEvidenceService\.addUploadedFiles/);
  assert.match(editor, /scopeType:\s*"WORK_ITEM"/);
  assert.match(editor, /scopeId:\s*savedWorkItem\.id/);
  assert.match(editor, /staged\.rollbackUncommitted\(\)/);

  assert.match(source, /function taskEvidenceHistoryHtml\(/);
  assert.match(source, /id="taskEvidenceHistoryContent"/);
  const refresh = source.match(/const refreshWorkItems = async \(\) => \{[\s\S]*?\n  \};/)?.[0] || '';
  assert.match(refresh, /TaskWorkItemService\.list\(task\)/);
  assert.match(refresh, /TaskEvidenceService\.list\(task\)/);
  assert.match(refresh, /taskEvidenceHistoryHtml\(task, evidenceFiles\)/);
  assert.doesNotMatch(refresh, /onSnapshot\(/);
});

test('core scoring/deadline engine hashes remain unchanged from verified baseline', () => {
  const expected = {
    'kpi-engine.js': 'bd3f04de8ec762d5a497068ab8fb254537406c2f8de17b9e40838da3517e89c1',
    'work-item-score-engine.js': '253edb052129d6b9e2922ed4b3b0a485686ba8f8a5626ad58974f8daf085ce15',
    'core/deadline-engine.js': '4d1378dd6ec4d81c8d6d474e5c65bfee7373de95e5bcad4cee2d86357474b6ee'
  };
  for (const [rel, hash] of Object.entries(expected)) {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(appRoot, rel))).digest('hex');
    assert.equal(actual, hash, rel);
  }
});
