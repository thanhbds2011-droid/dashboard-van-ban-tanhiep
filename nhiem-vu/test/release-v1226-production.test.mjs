import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const releaseRoot = path.resolve(appRoot, '..');
const read = rel => fs.readFileSync(path.join(appRoot, rel), 'utf8');
const sha256 = rel => crypto.createHash('sha256').update(fs.readFileSync(path.join(releaseRoot, rel))).digest('hex');

const RULES_SHA = '97e790bbd89afe41867d91dc1656d1f43eff2e7bc60d3c443656e918b811c2c4';
const INDEXES_SHA = 'cf681aca804f70acf644471be86f7e99dc1399c75966f37b680d572a8f2ad5bc';

test('V1.22.6 version/build/cache and release marker are synchronized', () => {
  const version = read('core/app-version.js');
  assert.match(version, /APP_VERSION\s*=\s*["']1\.22\.6["']/);
  assert.match(version, /BUILD_VERSION\s*=\s*["']20260904\.V1_22_6["']/);
  assert.match(version, /CACHE_NAME\s*=\s*["']nhiem-vu-20260904-v1-22-6["']/);
  const index = read('index.html');
  assert.match(index, /release-v1\.22\.6\.js\?v=20260904\.V1_22_6/);
  assert.match(read('sw.js'), /BUILD_VERSION = "20260904\.V1_22_6"/);
});

test('Registered card prefers personal registration frequency and falls back to standard frequency for legacy data', () => {
  const view = read('modules/standard-tasks/standard-tasks-view.js');
  const helperBlock = view.match(/function registeredTaskFrequency[\s\S]*?(?=function renderRegisteredTask)/)?.[0];
  assert.ok(helperBlock, 'registeredTaskFrequency helper must exist');
  const fn = new Function(`${helperBlock}; return registeredTaskFrequency;`)();
  assert.equal(fn({ frequency:'Theo quý' }, { frequency:'Khi phát sinh' }), 'Khi phát sinh');
  assert.equal(fn({ frequency:'Theo quý' }, { frequency:'Theo tháng' }), 'Theo tháng');
  assert.equal(fn({ frequency:'Theo quý' }, { frequency:'' }), 'Theo quý');
  assert.equal(fn({ frequency:'Theo tuần' }, {}), 'Theo tuần');
});

test('Đăng ký của tôi renders registrationFrequency while Danh mục công việc keeps standard item.frequency', () => {
  const view = read('modules/standard-tasks/standard-tasks-view.js');
  const registered = view.match(/function renderRegisteredTask[\s\S]*?(?=function renderCatalogList)/)?.[0];
  const catalog = view.match(/function renderCatalogList[\s\S]*?(?=function renderCatalogGroups)/)?.[0];
  assert.ok(registered && catalog);
  assert.match(registered, /const registrationFrequency = registeredTaskFrequency\(item, registration\)/);
  assert.match(registered, /escapeHtml\(registrationFrequency\)/);
  assert.doesNotMatch(registered, /escapeHtml\(item\.frequency\)/);
  assert.match(catalog, /escapeHtml\(item\.frequency\)/);
});

test('Personalized frequency continues to be stored in registration and used to create approved task', () => {
  const view = read('modules/standard-tasks/standard-tasks-view.js');
  const service = read('services/task-registration-service.js');
  assert.match(view, /const frequency = canonicalFrequency\(row\.querySelector\("\[data-personal-frequency\]"\)\?\.value \|\| ""\) \|\| ""/);
  assert.match(view, /personalItemOrder: index \+ 1,[\s\S]{0,180}\n\s*title,[\s\S]{0,180}\n\s*description,[\s\S]{0,180}\n\s*frequency,/);
  assert.match(service, /deriveDeadlinePlan\(\{[\s\S]{0,180}frequency: registration\?\.frequency \|\| ""/);
  assert.match(service, /frequency: canonicalFrequency\(registration\.frequency\) \|\| registration\.frequency \|\| ""/);
  assert.match(service, /trackingMode: deadlinePlan\.eventDriven === true\s*\? "ITEMIZED"/);
});

test('Hotfix is data-driven and does not hard-code TCHC05 or one department/user', () => {
  const view = read('modules/standard-tasks/standard-tasks-view.js');
  const helperBlock = view.match(/function registeredTaskFrequency[\s\S]*?(?=function renderCatalogList)/)?.[0] || '';
  assert.doesNotMatch(helperBlock, /TCHC05|Nguyễn Chí Thạnh|thanhbds2011@gmail\.com/);
  assert.match(helperBlock, /registration\?\.frequency/);
  assert.match(helperBlock, /item\?\.frequency/);
});

test('Firestore Rules and 21 indexes remain unchanged', () => {
  assert.equal(sha256('firestore.rules'), RULES_SHA);
  assert.equal(sha256('firestore.indexes.json'), INDEXES_SHA);
  const indexes = JSON.parse(fs.readFileSync(path.join(releaseRoot, 'firestore.indexes.json'), 'utf8'));
  assert.equal(indexes.indexes.length, 21);
});
