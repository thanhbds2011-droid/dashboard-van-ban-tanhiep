import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const service = read('nhiem-vu/services/executive-directive-service.js');
const notify = read('nhiem-vu/services/executive-notification-service.js');
const view = read('nhiem-vu/modules/executive-directives/executive-directives-view.js');
const css = read('nhiem-vu/executive-directives.css');
const app = read('nhiem-vu/app-v3.js');
const index = read('nhiem-vu/index.html');
const version = read('nhiem-vu/core/app-version.js');
const push = read('CHI_DAO_DIEU_HANH_PUSH_V1_2_2.gs');

 test('V1.10.9 version/cache synchronized', () => {
  assert.match(version, /APP_VERSION = "1\.10\.9"/);
  assert.match(version, /BUILD_VERSION = "20260810\.V1_10_9"/);
  assert.match(index, /executive-directives\.css\?v=20260810\.V1_10_9/);
  assert.match(index, /release-v1\.10\.9\.js\?v=20260810\.V1_10_9/);
});

test('normal business workflow no longer awaits Push', () => {
  assert.match(service, /function dispatchPushInBackground/);
  assert.doesNotMatch(service, /await notifyPushReliably/);
  assert.match(service, /confirmDelivery: false/);
  assert.match(notify, /options\.confirmDelivery !== true/);
});

test('realtime is primary synchronization after write', () => {
  const start = view.indexOf('async function refreshAfterWrite');
  const end = view.indexOf('function closeDirectiveModal', start);
  const block = view.slice(start, end);
  assert.doesNotMatch(block, /listDirectives\(/);
  assert.doesNotMatch(block, /listUpdates\(/);
  assert.match(block, /onSnapshot/);
});

test('mobile/PWA UX has card list and dynamic viewport safe modal', () => {
  assert.match(view, /directive-mobile-card/);
  assert.match(view, /directive-mobile-list/);
  assert.match(view, /directive-optional-section/);
  assert.match(css, /height:100dvh/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /directive-desktop-list\{display:none!important\}/);
  assert.match(css, /directive-mobile-list\{display:grid/);
});

test('route branding identifies executive module without splitting the application', () => {
  assert.match(app, /Chỉ đạo điều hành/);
  assert.match(app, /is-executive-route/);
  assert.match(index, /id="appBrandTitle"/);
});

test('executive code remains independent from Task/KPI notification collections', () => {
  for (const forbidden of ['taskRegistrations', 'taskWorkItems', 'taskEvaluations', 'taskLogs', 'taskPushSubscriptions', 'TaskNotificationService', 'TaskNotificationBridge']) {
    assert.equal(service.includes(forbidden), false, `service references forbidden ${forbidden}`);
  }
});

test('Push V1.2.2 is concurrent and does not hold a 10-second global lock', () => {
  assert.match(push, /EXEC_PUSH_VERSION_ = '1\.2\.2'/);
  assert.match(push, /function execClaimEvent_/);
  assert.match(push, /lock\.tryLock\(800\)/);
  assert.doesNotMatch(push, /lock\.tryLock\(10000\)/);
  const doPost = push.slice(push.indexOf('function doPost'), push.indexOf('function execClaimEvent_'));
  assert.doesNotMatch(doPost, /getScriptLock\(\)/);
});

test('Push V1.2.2 merges notification logs without read-before-write', () => {
  const start = push.indexOf('function execWriteNotificationLog_');
  const end = push.indexOf('function execFieldsToObject_', start);
  const block = push.slice(start, end);
  assert.match(block, /updateMask\.fieldPaths/);
  assert.doesNotMatch(block, /execGetFirestoreDocument_/);
});

test('Push routing matrix keeps department leaders and managers informed', () => {
  for (const action of ['DIRECTIVE_ASSIGNED','DIRECTIVE_ACCEPTED','DIRECTIVE_INTERNAL_ASSIGNED','DIRECTIVE_PERSON_ACCEPTED','DIRECTIVE_PROGRESS_UPDATED','DIRECTIVE_COMPLETED','DIRECTIVE_REMINDER']) {
    assert.match(push, new RegExp(action));
  }
  assert.match(push, /addDepartmentLeaders/);
  assert.match(push, /addManagers/);
  assert.match(push, /executivePushSubscriptions/);
  assert.doesNotMatch(push, /execListFirestoreDocuments_\('taskPushSubscriptions'/);
});
