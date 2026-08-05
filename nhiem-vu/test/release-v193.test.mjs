import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const repoRoot = path.resolve(appRoot, '..');
const read = relative => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

test('V1.9.3 separates department acceptance, internal assignment and personal acceptance', () => {
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
  assert.match(rules, /function departmentTaskReadyForInternalAssignment\(data\)[\s\S]*departmentAssignmentStatus[\s\S]*== "ACCEPTED"/);
  assert.match(rules, /request\.resource\.data\.assignmentMode == "DEPARTMENT"[\s\S]*request\.resource\.data\.departmentAssignmentStatus == "ACCEPTED"/);
});

test('all production asset imports use V1.9.3 build token', () => {
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
  assert.match(read('nhiem-vu/core/app-version.js'), /APP_VERSION = "1\.9\.3"/);
  assert.match(read('nhiem-vu/core/app-version.js'), /BUILD_VERSION = "20260805\.V1_9_3"/);
});
