import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const service = read('nhiem-vu/services/executive-directive-service.js');
const view = read('nhiem-vu/modules/executive-directives/executive-directives-view.js');
const rules = read('firestore.rules');
const push = read('CHI_DAO_DIEU_HANH_PUSH_V1_2_0.gs');
const version = read('nhiem-vu/core/app-version.js');

test('V1.10.8 synchronized', () => {
  assert.match(version, /APP_VERSION = "1\.10\.8"/);
  assert.match(version, /BUILD_VERSION = "20260810\.V1_10_8"/);
});

test('executive workflow stays independent from Task/KPI collections', () => {
  for (const forbidden of ['taskRegistrations', 'taskWorkItems', 'taskEvaluations', 'taskLogs', 'taskPushSubscriptions', 'TaskNotificationService', 'TaskNotificationBridge']) {
    assert.equal(service.includes(forbidden), false, `service references forbidden ${forbidden}`);
  }
});

test('acceptance hotfix does not read missing acceptance/state before first write', () => {
  const start = service.indexOf('async acceptDirective');
  const end = service.indexOf('async assignInternal', start);
  const block = service.slice(start, end);
  assert.match(block, /writeBatch\(FirebaseService\.db\)/);
  assert.doesNotMatch(block, /transaction\.get\(acceptRef\)/);
  assert.doesNotMatch(block, /transaction\.get\(currentStateRef\)/);
});

test('internal assignment workflow is complete', () => {
  assert.match(service, /async assignInternal\(/);
  assert.match(service, /async acceptPersonalAssignment\(/);
  assert.match(service, /internalAssignmentStatus: "ASSIGNED"/);
  assert.match(service, /internalAssignmentStatus: "PERSON_ACCEPTED"/);
  assert.match(service, /Phải chuyển sang Đang thực hiện trước khi cập nhật Hoàn thành/);
  assert.match(view, /Phân công người thực hiện/);
  assert.match(view, /Xác nhận nhận việc/);
  assert.match(view, /Đôn đốc/);
});

test('rules lock internal assignment and personal acceptance', () => {
  assert.match(rules, /function canAssignExecutiveDepartment/);
  assert.match(rules, /function canAcceptExecutivePersonal/);
  assert.match(rules, /updateType == "INTERNAL_ASSIGNED"/);
  assert.match(rules, /updateType == "PERSON_ACCEPTED"/);
  assert.match(rules, /internalAssignmentStatus == "PERSON_ACCEPTED"/);
  assert.match(rules, /allow update, delete: if false;/);
});

test('push gateway has independent new actions', () => {
  for (const action of ['DIRECTIVE_INTERNAL_ASSIGNED', 'DIRECTIVE_PERSON_ACCEPTED', 'DIRECTIVE_REMINDER']) {
    assert.match(push, new RegExp(action));
  }
  assert.match(push, /executivePushSubscriptions/);
  assert.match(push, /executiveNotificationLogs/);
  assert.doesNotMatch(push, /execListFirestoreDocuments_\('taskPushSubscriptions'/);
});
