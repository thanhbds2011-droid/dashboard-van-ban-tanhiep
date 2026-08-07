import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const repoRoot = path.resolve(appRoot, '..');
const read = relative => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

test('V1.9.4 preserves department acceptance, internal assignment and personal acceptance', () => {
  const service = read('nhiem-vu/services/task-write-service.js');
  assert.match(service, /async acceptDepartment\(task\)/);
  assert.match(service, /departmentAssignmentStatus = directorCreatesDepartmentTask \? "PENDING_ACCEPTANCE" : "ACCEPTED"/);
  assert.match(service, /\? "CHO_PHONG_KHU_TIEP_NHAN"/);
  assert.match(service, /const sourceAccepted = sourceDepartmentStatus === "ACCEPTED"/);
  assert.match(service, /action: "TASK_DEPARTMENT_ACCEPTED"/);
  assert.match(service, /action: "TASK_INTERNAL_ASSIGNED"/);
  assert.match(service, /assignmentStatus: "DA_TIEP_NHAN"/);
});

test('legacy director task is displayed as pending department acceptance', async () => {
  const modulePath = pathToFileURL(path.join(appRoot, 'core/task-display-order.js')).href;
  const { effectiveDepartmentAssignmentStatus } = await import(modulePath);
  assert.equal(effectiveDepartmentAssignmentStatus({
    entryMode: 'DIRECT_ASSIGNED',
    createdByRole: 'DIRECTOR',
    ownerUserId: '',
    assignmentStatus: 'CHO_PHAN_CONG',
    status: 'CHO_PHAN_CONG'
  }), 'PENDING_ACCEPTANCE');
  assert.equal(effectiveDepartmentAssignmentStatus({
    entryMode: 'DIRECT_ASSIGNED',
    ownerUserId: '',
    assignmentMode: 'DEPARTMENT',
    departmentAssignmentStatus: 'ACCEPTED',
    assignmentStatus: 'CHO_PHAN_CONG',
    status: 'CHO_PHAN_CONG'
  }), 'ACCEPTED');
});

test('Firestore Rules require explicit acceptance before internal assignment', () => {
  const rules = read('firestore.rules');
  assert.match(rules, /function legacyDepartmentTaskAwaitingAcceptance\(data\)/);
  assert.doesNotMatch(rules, /function departmentTaskReadyForInternalAssignment\(data\)/);
  assert.match(rules, /function managerCanAssignTask\(\)[\s\S]*hasField\(resource\.data, "departmentAssignmentStatus"\)[\s\S]*resource\.data\.departmentAssignmentStatus == "ACCEPTED"/);
  assert.match(rules, /request\.resource\.data\.assignmentMode == "DEPARTMENT_INTERNAL"[\s\S]*request\.resource\.data\.departmentAssignmentStatus == "ACCEPTED"/);
});



test('Firestore Rules V1.9.4.1 has no locally-defined unused helper functions', () => {
  const rules = read('firestore.rules');
  const definitions = [...rules.matchAll(/\bfunction\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)].map(match => match[1]);
  const unused = definitions.filter(name => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const calls = rules.match(new RegExp(`\\b${escaped}\\s*\\(`, 'g')) || [];
    return calls.length < 2;
  });
  assert.deepEqual(unused, []);
});

test('all production asset imports use V1.9.4 build token', () => {
  const files = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(?:js|html|css|webmanifest)$/.test(entry.name)) files.push(full);
    }
  };
  walk(appRoot);
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    assert.equal(text.includes('20260805.V1_9_2'), false, file);
  }
  assert.match(read('nhiem-vu/core/app-version.js'), /APP_VERSION = "1\.9\.4"/);
  assert.match(read('nhiem-vu/core/app-version.js'), /BUILD_VERSION = "20260806\.V1_9_4"/);
});

test('V1.9.4 creates standard tasks without reading a non-existent candidate document', () => {
  const service = read('nhiem-vu/services/standard-task-write-service.js');
  assert.match(service, /runTransaction\(FirebaseService\.db/);
  assert.match(service, /transaction\.get\(sequenceReference\)/);
  assert.doesNotMatch(service, /transaction\.get\(reference\)/);
  assert.match(service, /transaction\.set\(\s*reference,[\s\S]*merge: false/);
});

test('V1.9.4 separates standard-task create, update and hard-delete permissions', () => {
  const permissions = read('nhiem-vu/core/permissions.js');
  const rules = read('firestore.rules');
  assert.match(permissions, /canCreateStandardTask\(/);
  assert.match(permissions, /canUpdateStandardTask\(/);
  assert.match(permissions, /canDeleteStandardTask\(/);
  assert.match(permissions, /CDTN_UY_VIEN_BCH/);
  assert.match(rules, /function canCreateStandardTask\(departmentId\)/);
  assert.match(rules, /function canUpdateStandardTask\(data\)/);
  assert.match(rules, /function canRemoveStandardTask\(data\)/);
  assert.match(rules, /match \/standardTasks\/\{standardTaskId\}[\s\S]*allow delete: if isAdmin\(\)/);
});

test('V1.9.4 soft-cancels only the actor own self-registered task in the same batch', () => {
  const service = read('nhiem-vu/services/task-registration-service.js');
  const rules = read('firestore.rules');
  assert.match(service, /SELF_REGISTERED_APPROVED/);
  assert.match(service, /sourceType === "DANG_KY_KE_HOACH"/);
  assert.match(service, /batch\.update\([\s\S]*taskRegistrations/);
  assert.match(service, /batch\.update\(taskReference, taskAfter\)/);
  assert.match(service, /TASK_REGISTRATION_CANCELLED/);
  assert.match(rules, /function ownerCanCancelOwnSelfRegisteredTask\(taskId\)/);
  assert.match(rules, /getAfter\(registrationPath\)\.data\.status == "CANCELLED"/);
  assert.match(rules, /ownerLeaderCanCancelApprovedRegistration\(registrationId\)/);
});

test('V1.9.4 keeps the published department assignment regression branches', () => {
  const rules = read('firestore.rules');
  for (const functionName of [
    'ownerCanAcceptTask',
    'departmentLeaderCanAcceptDepartmentTask',
    'managerCanAssignTask',
    'ownerCanUpdateAcceptedTask'
  ]) {
    assert.match(rules, new RegExp(`function ${functionName}\\(`));
  }
  assert.doesNotMatch(rules, /allow\s+read\s*,\s*write\s*:\s*if\s+true/);
});

test('V1.9.4 service worker clones responses before returning and binds cache work to fetch events', () => {
  const worker = read('nhiem-vu/sw.js');
  assert.match(worker, /const cacheCopy = response\.clone\(\)/);
  assert.match(worker, /event\.waitUntil\(cacheResponse/);
  assert.doesNotMatch(worker, /then\(c\s*=>\s*c\.put\([^\n]*response\.clone\(\)/);
});
