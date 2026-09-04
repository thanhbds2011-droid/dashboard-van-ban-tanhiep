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
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const fileSha = rel => sha(fs.readFileSync(path.join(releaseRoot, rel)));
const normalizedBusinessSha = rel => sha(read(rel).replaceAll('20260904.V1_22_7', '20260904.V1_22_6'));

const BASELINE = Object.freeze({
  kpiEngine: 'bd3f04de8ec762d5a497068ab8fb254537406c2f8de17b9e40838da3517e89c1',
  taskRegistration: 'da679d2727c93bf35e5c128cd13055a2b07f00735d843ae9f6333cf809dc6b60',
  taskMilestone: 'fc6cba7857e942f1c77a361c66fafc5d4b0503d6d7cfcffef9bdf7a28990f06f',
  workItemScore: '253edb052129d6b9e2922ed4b3b0a485686ba8f8a5626ad58974f8daf085ce15',
  deadlineEngine: '4d1378dd6ec4d81c8d6d474e5c65bfee7373de95e5bcad4cee2d86357474b6ee',
  standardTasksView: '739155b2bc5185fcc08fd8964486ae9fbefff3465250f43d44512c64dc2d0c2e',
  indexes: 'cf681aca804f70acf644471be86f7e99dc1399c75966f37b680d572a8f2ad5bc',
  appsAccounts: 'bb22bf86474b252738a1e7674b4d8994eefce8b7123a836b22ed91c13fc25126',
  appsStandard: '68524e0e73481acc638560db62b784698e12270f5a39d5950b18d005b33ffbe4'
});

test('V1.22.7 version/build/cache and release marker are synchronized', () => {
  const version = read('core/app-version.js');
  assert.match(version, /APP_VERSION\s*=\s*["']1\.22\.7["']/);
  assert.match(version, /BUILD_VERSION\s*=\s*["']20260904\.V1_22_7["']/);
  assert.match(version, /CACHE_NAME\s*=\s*["']nhiem-vu-20260904-v1-22-7["']/);
  assert.match(read('index.html'), /release-v1\.22\.7\.js\?v=20260904\.V1_22_7/);
  assert.match(read('sw.js'), /BUILD_VERSION = "20260904\.V1_22_7"/);
});

test('Admin-only transition tool exists and is not hard-coded to TCHC', () => {
  const view = read('modules/admin/admin-view.js');
  const service = read('services/admin-maintenance-service.js');
  assert.match(view, /btnAdminEventDrivenReset/);
  assert.match(view, /openAdminEventDrivenReset/);
  assert.match(service, /async listEventDrivenResetCandidates\(\)/);
  assert.match(service, /async eventDrivenResetPreview\(record = \{\}\)/);
  assert.match(service, /async applyEventDrivenResetBatch\(input = \{\}\)/);
  assert.match(service, /function requireAdmin\(\)[\s\S]*Permissions\.isAdmin\(\)/);
  const newBlock = service.match(/const EVENT_DRIVEN_RESET_ACTION[\s\S]*?(?=\n  async correctionPreview)/)?.[0] || '';
  assert.doesNotMatch(newBlock, /if\s*\([^\n]*TCHC|departmentId\s*===\s*["']TCHC["']/i);
});

test('Preview blocks business data and preserves pending milestones as history only', () => {
  const service = read('services/admin-maintenance-service.js');
  assert.match(service, /docsByTaskId\("taskMilestones"/);
  assert.match(service, /docsByTaskId\("taskEvidenceFiles"/);
  assert.match(service, /docsByTaskId\("taskWorkItems"/);
  assert.match(service, /docsByTaskId\("taskEvaluations"/);
  assert.match(service, /docsByTaskId\("kpiAdjustments"/);
  assert.match(service, /completedMilestones\.length/);
  assert.match(service, /activeEvidenceFiles\.length/);
  assert.match(service, /plan\.locked/);
  assert.match(service, /EXECUTIVE_DIRECTIVE/);
  assert.match(service, /fixedDeadlineDateKey/);
  assert.match(service, /deadlineCeilingDateKey/);
  assert.match(service, /autoApproved === true/);
  assert.match(service, /Mỗi lần chỉ xử lý tối đa \$\{MAX_EVENT_DRIVEN_RESET_BATCH\}/);
  assert.match(service, /MAX_EVENT_DRIVEN_RESET_BATCH = 50/);
});

test('Safe correction keeps registration, soft-cancels old task and converts personal registration to event-driven PENDING', () => {
  const service = read('services/admin-maintenance-service.js');
  const block = service.match(/async applyEventDrivenResetBatch[\s\S]*?(?=\n  async correctionPreview)/)?.[0] || '';
  assert.match(block, /batch\.update\(FirebaseService\.doc\(FirebaseService\.db, "tasks", task\.id\)/);
  assert.match(block, /active:false,[\s\S]{0,120}status:"HUY"/);
  assert.match(block, /includedInA:false/);
  assert.match(block, /scoringEnabled:false/);
  assert.match(block, /scoringStatus:"CANCELLED"/);
  assert.match(block, /batch\.update\(FirebaseService\.doc\(FirebaseService\.db, "taskRegistrations", registration\.id\)/);
  assert.match(block, /status:"PENDING"/);
  assert.match(block, /taskId:null/);
  assert.match(block, /frequency:EVENT_DRIVEN_LABEL/);
  assert.match(block, /deadlineMode:"EVENT_DRIVEN"/);
  assert.match(block, /milestoneDateKeys:\[\]/);
  assert.match(block, /trackingMode:"ITEMIZED"/);
  assert.doesNotMatch(block, /deleteDoc|batch\.delete/);
  assert.match(block, /ADMIN_REOPEN_REGISTRATION_AS_EVENT_DRIVEN/);
});

test('Rules V1.22.2 grant only narrow ADMIN correction and require linked same-batch task/registration state', () => {
  const rules = fs.readFileSync(path.join(releaseRoot, 'firestore.rules'), 'utf8');
  assert.match(rules, /Production Rules V1\.22\.2 - 2026-09-04/);
  assert.match(rules, /adminCorrectionAction == "REOPEN_REGISTRATION_AS_EVENT_DRIVEN"/);
  assert.match(rules, /return isAdmin\(\)[\s\S]*adminCorrectionReason\.size\(\) > 0/);
  assert.match(rules, /getAfter\(taskRegistrationPath\(resource\.data\.registrationId\)\)\.data\.status == "PENDING"/);
  assert.match(rules, /getAfter\(taskRegistrationPath\(resource\.data\.registrationId\)\)\.data\.frequency == "Khi phát sinh"/);
  assert.match(rules, /getAfter\(taskPath\(resource\.data\.taskId\)\)\.data\.registrationId == registrationId/);
  assert.match(rules, /getAfter\(taskPath\(resource\.data\.taskId\)\)\.data\.status == "HUY"/);
  assert.match(rules, /request\.resource\.data\.frequency == "Khi phát sinh"/);
  assert.match(rules, /request\.resource\.data\.deadlineMode == "EVENT_DRIVEN"/);
  assert.match(rules, /request\.resource\.data\.trackingMode == "ITEMIZED"/);
  assert.match(rules, /resource\.data\.frequency in \["Theo ngày", "Theo tuần", "Theo tháng", "Theo quý", "Theo năm"\]/);
  assert.match(rules, /allow delete: if isAdmin\(\) && periodArchiveReadyForData\(resource\.data\);/);
});

test('Scoring, registration approval engine, milestone engine and deadline engine retain V1.22.6 business logic', () => {
  assert.equal(normalizedBusinessSha('kpi-engine.js'), BASELINE.kpiEngine);
  assert.equal(normalizedBusinessSha('services/task-registration-service.js'), BASELINE.taskRegistration);
  assert.equal(normalizedBusinessSha('services/task-milestone-service.js'), BASELINE.taskMilestone);
  assert.equal(normalizedBusinessSha('work-item-score-engine.js'), BASELINE.workItemScore);
  assert.equal(normalizedBusinessSha('core/deadline-engine.js'), BASELINE.deadlineEngine);
});

test('V1.22.6 personal-frequency hotfix remains byte-equivalent apart from build stamp', () => {
  assert.equal(normalizedBusinessSha('modules/standard-tasks/standard-tasks-view.js'), BASELINE.standardTasksView);
  const view = read('modules/standard-tasks/standard-tasks-view.js');
  assert.match(view, /return String\(registration\?\.frequency \|\| item\?\.frequency \|\| ""\)\.trim\(\)/);
});


test('Cross-department and Chi đoàn approval authority remain generic and separate from ADMIN correction', () => {
  const service = read('services/admin-maintenance-service.js');
  const rules = fs.readFileSync(path.join(releaseRoot, 'firestore.rules'), 'utf8');
  const view = read('modules/admin/admin-view.js');
  assert.match(view, /Phòng\/Khu\/Scope/);
  assert.doesNotMatch(service.match(/async listEventDrivenResetCandidates[\s\S]*?(?=\n  async eventDrivenResetPreview)/)?.[0] || '', /departmentId\s*===\s*["']TCHC["']/);
  assert.match(rules, /data\.departmentId == "CDTN"[\s\S]{0,240}isCdtnSecretary\(\)/);
  assert.match(rules, /hasActiveCdtnApprovalDelegation\("APPROVE_REGISTRATIONS"\)/);
  const reviewer = rules.match(/function canReviewRegistrationRecord\(data\)[\s\S]*?\n    }/)?.[0] || '';
  assert.doesNotMatch(reviewer, /isAdmin\(\)/);
});

test('21 indexes and Apps Script artifacts remain unchanged', () => {
  assert.equal(fileSha('firestore.indexes.json'), BASELINE.indexes);
  const indexes = JSON.parse(fs.readFileSync(path.join(releaseRoot, 'firestore.indexes.json'), 'utf8'));
  assert.equal(indexes.indexes.length, 21);
  assert.equal(fileSha('deployment/AppsScript_Accounts_V3.4.3.gs'), BASELINE.appsAccounts);
  assert.equal(fileSha('deployment/AppsScript_StandardTasks_V4.9.0.gs'), BASELINE.appsStandard);
});
