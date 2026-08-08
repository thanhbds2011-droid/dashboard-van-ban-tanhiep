import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, '..');
const root = path.resolve(app, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const appRead = p => fs.readFileSync(path.join(app, p), 'utf8');

test('V1.10.1 uses one current build token in runtime entry points', () => {
  const version = appRead('core/app-version.js');
  const index = appRead('index.html');
  const sw = appRead('sw.js');
  const boot = appRead('app-v3.js');
  assert.match(version, /APP_VERSION = "1\.10\.1"/);
  assert.match(version, /BUILD_VERSION = "20260808\.V1_10_1"/);
  assert.match(sw, /20260808\.V1_10_1/);
  assert.match(index, /release-v1\.10\.1\.js\?v=20260808\.V1_10_1/);
  assert.match(index, /ui-v1\.10\.1\.css\?v=20260808\.V1_10_1/);
  assert.doesNotMatch(boot, /20260806\.V1_9_4|20260808\.V1_10_0/);
});

test('standard-task modal no longer renders destructive legacy checkbox controls', () => {
  const view = appRead('modules/standard-tasks/standard-tasks-view.js');
  const release = appRead('release-v1.10.1.js');
  assert.doesNotMatch(view, /id="standardTaskCore"|id="standardTaskManagement"/);
  assert.match(view, /audienceType là nguồn quyền duy nhất/);
  assert.match(release, /querySelectorAll\("small\.field-help,p\.field-help"\)/);
  assert.doesNotMatch(release, /querySelectorAll\("small,p,div"\)/);
});

test('TCHC deputy read scope matches frontend without broadening write authority', () => {
  const rules = read('firestore.rules');
  const permissions = appRead('core/permissions.js');
  assert.match(permissions, /isTchcDepartmentLeader/);
  assert.match(rules, /function canViewAllDepartments\(\)[\s\S]*isDepartmentLeader\(\) && sameDepartment\("TCHC"\)/);
  assert.match(rules, /function isTchcHead\(\)[\s\S]*isDepartmentHead\(\) && sameDepartment\("TCHC"\)/);
});

test('supporting departments inherit parent task READ for logs and work items only', () => {
  const rules = read('firestore.rules');
  assert.match(rules, /function taskChildVisible\(taskId\)/);
  assert.match(rules, /match \/taskLogs\/\{logId\}[\s\S]*taskChildVisible\(resource\.data\.taskId\)/);
  assert.match(rules, /match \/taskWorkItems\/\{workItemId\}[\s\S]*taskChildVisible\(resource\.data\.taskId\)/);
  const manageBlock = rules.match(/function canManageTask\(data\) \{[\s\S]*?\n    \}/)?.[0] || '';
  assert.match(manageBlock, /sameDepartment\(taskScopeDepartmentId\(data\)\)/);
  assert.doesNotMatch(manageBlock, /taskBelongsToCurrentDepartment/);
  const modal = appRead('modules/tasks/task-detail-modal.js');
  assert.match(modal, /TaskWorkItemService\.list\(task\.id\)/);
  assert.match(modal, /catch \(error\)[\s\S]*WORK_ITEM/i);
});

test('employee adjustment request is atomic and cannot change locked score fields', () => {
  const rules = read('firestore.rules');
  const service = appRead('services/task-adjustment-service.js');
  assert.match(service, /batch\.set\(reference, payload\)[\s\S]*batch\.update\(taskRef\(task\.id\)/);
  assert.match(rules, /function ownerRequestsTaskAdjustmentOnly\(taskId\)/);
  assert.match(rules, /existsAfter\(adjustmentPath\(request\.resource\.data\.pendingAdjustmentId\)\)/);
  assert.match(rules, /function ownerCreatesTaskAdjustment\(data, adjustmentId\)/);
  assert.match(rules, /getAfter\(taskPath\(data\.taskId\)\)\.data\.pendingAdjustmentId == adjustmentId/);
  const allowedFields = rules.match(/function ownerRequestsTaskAdjustmentOnly\(taskId\) \{[\s\S]*?affectedKeys\(\)\.hasOnly\(\[([\s\S]*?)\]\);/)?.[1] || '';
  assert.doesNotMatch(allowedFields, /confirmedActualScore|scoreLocked|preCouncilConfirmedActualScore/);
});

test('exact task adjustment approver can process request, including director/deputy assignment', () => {
  const rules = read('firestore.rules');
  assert.match(rules, /function adjustmentApproverUpdateOnly\(data, adjustmentId\)/);
  assert.match(rules, /function adjustmentApproverTaskUpdateOnly\(data, taskId\)/);
  assert.match(rules, /resource\.data\.approverUserId == request\.auth\.uid/);
  assert.match(rules, /data\.adjustmentApproverUserId == request\.auth\.uid/);
});

test('Council manager is Head or Deputy and toolbar enhancement is idempotent', () => {
  const service = appRead('services/council-adjustment-service.js');
  const ui = appRead('modules/kpi/council-adjustment-ui.js');
  const release = appRead('release-v1.10.1.js');
  const rules = read('firestore.rules');
  assert.match(service, /Permissions\.isDepartmentLeader\(user\)/);
  assert.match(ui, /Permissions\.isDepartmentLeader\(user\)/);
  assert.match(rules, /allow create: if isDepartmentManagerFor\(departmentId\)/);
  assert.match(release, /dataset\.councilSignature/);
  assert.match(release, /if \(toolbar\.dataset\.councilSignature !== signature\)/);
});

test('BGD direct team notification keeps TASK_TEAM_DIRECT_ASSIGNED end-to-end', () => {
  const bridge = appRead('services/task-notification-bridge.js');
  const gateway = read('deployment/apps-script-notification-ai-evidence-v6.4.0.gs');
  assert.match(bridge, /TASK_TEAM_DIRECT_ASSIGNED: "TASK_TEAM_DIRECT_ASSIGNED"/);
  assert.doesNotMatch(bridge, /TASK_TEAM_DIRECT_ASSIGNED\s*:\s*"TASK_INTERNAL_ASSIGNED"/);
  assert.match(gateway, /"TASK_TEAM_DIRECT_ASSIGNED"/);
});

test('Director mobile KPI chooses one department instead of rendering ALL by default', () => {
  const workflow = appRead('modules/kpi/kpi-workflow.js');
  const css = appRead('ui-v1.10.1.css');
  assert.match(workflow, /directorMobileScope/);
  assert.match(workflow, /id="kpiMobileScopeSelect"/);
  assert.match(workflow, /scopeDepartmentId\) === 'ALL'[\s\S]*scopeDepartmentId = 'BGD'/);
  assert.match(css, /\.kpi-mobile-scope-select/);
});

test('Firestore index package contains all 14 enabled production composites supplied by admin', () => {
  const indexes = JSON.parse(read('firestore.indexes.json'));
  assert.equal(indexes.indexes.length, 14);
  const sig = item => `${item.collectionGroup}:${item.fields.map(f => `${f.fieldPath}:${f.order || f.arrayConfig}`).join('|')}`;
  const signatures = new Set(indexes.indexes.map(sig));
  for (const expected of [
    'tasks:periodId:ASCENDING|primaryDepartmentId:ASCENDING',
    'tasks:periodId:ASCENDING|organizationId:ASCENDING',
    'tasks:periodId:ASCENDING|supportDepartmentIds:CONTAINS',
    'tasks:periodId:ASCENDING|visibleDepartmentIds:CONTAINS',
    'tasks:periodId:ASCENDING|relatedDepartmentIds:CONTAINS',
    'tasks:periodId:ASCENDING|ownerUserId:ASCENDING'
  ]) assert.ok(signatures.has(expected), expected);
});

test('deployment sources supplied by user are packaged unchanged by version', () => {
  assert.match(read('deployment/apps-script-account-sync-v3.3.1.gs'), /Phiên bản:\s*3\.3\.1/);
  assert.match(read('deployment/apps-script-standard-tasks-v4.2.0.gs'), /Phiên bản 4\.2\.0/);
  assert.match(read('deployment/apps-script-notification-ai-evidence-v6.4.0.gs'), /V6\.4\.0/);
});


test('push subscription cannot be rebound to another UID or External ID', () => {
  const rules = read('firestore.rules');
  assert.match(rules, /request\.resource\.data\.userId == resource\.data\.userId/);
  assert.match(rules, /request\.resource\.data\.uid == request\.auth\.uid/);
  assert.match(rules, /request\.resource\.data\.externalId == request\.auth\.uid/);
});

test('PWA only removes old application caches and leaves OneSignal/other caches alone', () => {
  const sw = appRead('sw.js');
  assert.match(sw, /key\.startsWith\("nhiem-vu-"\) && key !== CACHE_NAME/);
  assert.doesNotMatch(sw, /keys\.filter\(key => key !== CACHE_NAME\)/);
});

test('legacy hard-coded Rules V1.9.0 user-facing error is gone', () => {
  assert.doesNotMatch(appRead('modules/tasks/tasks-view.js'), /Rules V1\.9\.0/);
});
