import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { UserContext } from '../core/user-context.js?v=20260903.V1_22_3';
import { Permissions } from '../core/permissions.js?v=20260903.V1_22_3';
import { calculateTaskScore } from '../kpi-engine.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const releaseRoot = path.resolve(appRoot, '..');
const read = rel => fs.readFileSync(path.join(appRoot, rel), 'utf8');
const readRelease = rel => fs.readFileSync(path.join(releaseRoot, rel), 'utf8');
const sha256 = rel => crypto.createHash('sha256').update(fs.readFileSync(path.join(releaseRoot, rel))).digest('hex');

function setUser(overrides = {}) {
  return UserContext.setUser({
    uid: 'uid-test', email: 'test@tanhiep.local', fullName: 'Tài khoản test',
    role: 'STAFF', departmentId: 'YT', position: 'Nhân viên', active: true,
    approvalAuthorityPresent: true, approvalAuthority: '', additionalRoles: [],
    ...overrides
  });
}

function assertBalanced(text) {
  const pairs = { '}':'{', ')':'(', ']':'[' };
  const opens = new Set(Object.values(pairs));
  const stack = [];
  let state='code', quote='';
  for (let i=0;i<text.length;i++) {
    const c=text[i], n=text[i+1]||'';
    if (state==='line') { if (c==='\n') state='code'; continue; }
    if (state==='block') { if (c==='*' && n==='/') { state='code'; i++; } continue; }
    if (state==='str') { if (c==='\\') { i++; continue; } if (c===quote) state='code'; continue; }
    if (c==='/' && n==='/') { state='line'; i++; continue; }
    if (c==='/' && n==='*') { state='block'; i++; continue; }
    if (c==='"' || c==="'") { state='str'; quote=c; continue; }
    if (opens.has(c)) stack.push(c);
    else if (pairs[c]) { assert.ok(stack.length, `unexpected ${c}`); assert.equal(stack.pop(), pairs[c]); }
  }
  assert.deepEqual(stack, []);
}

test('Current production version/build/cache are synchronized after V1.22.2 baseline', () => {
  const ver = read('core/app-version.js');
  assert.match(ver, /APP_VERSION\s*=\s*["']1\.22\.3["']/);
  assert.match(ver, /BUILD_VERSION\s*=\s*["']20260903\.V1_22_3["']/);
  assert.match(ver, /CACHE_NAME\s*=\s*["']nhiem-vu-20260903-v1-22-3["']/);
  assert.match(read('index.html'), /20260903\.V1_22_3/);
  assert.match(read('sw.js'), /20260903\.V1_22_3/);
});

test('KPI scoring contract 10/12, 30/70 and coefficients stays unchanged', () => {
  const regular = calculateTaskScore(10, 1.1, 100, 80);
  assert.equal(regular.execution, 8.6);
  assert.equal(regular.actual, 9.46);
  const unexpected = calculateTaskScore(12, 1.2, 80, 60);
  assert.equal(unexpected.execution, 7.92);
  assert.equal(unexpected.actual, 9.5);
});

test('ADMIN privilege does not replace Staff/Head/Deputy business position in approval workflow', () => {
  setUser({ role:'ADMIN', departmentId:'YT', position:'Nhân viên', approvalAuthority:'' });
  assert.equal(Permissions.isBusinessStaff(), true);
  assert.equal(Permissions.canRegisterStandardTasks(), true);
  assert.equal(Permissions.canApproveRegistrationForDepartment('YT', false), false);
  assert.equal(Permissions.canConfirmEvaluations(false), false);
  assert.equal(Permissions.canReviewStaffTask(), false);

  setUser({ role:'ADMIN', departmentId:'YT', position:'Trưởng phòng', approvalAuthority:'HEAD' });
  assert.equal(Permissions.isDepartmentHead(), true);
  assert.equal(Permissions.canApproveRegistrationForDepartment('YT', false), true);
  assert.equal(Permissions.canConfirmEvaluations(false), true);

  setUser({ role:'ADMIN', departmentId:'YT', position:'Phó Trưởng phòng', approvalAuthority:'DEPUTY' });
  assert.equal(Permissions.isDepartmentDeputy(), true);
  assert.equal(Permissions.canCreateUnexpectedTask(false), true);
  assert.equal(Permissions.canApproveRegistrationForDepartment('YT', false), false);
  assert.equal(Permissions.canApproveRegistrationForDepartment('YT', true), true);
});

test('Director keeps directive entry point while unexpected-task button is hidden in Tasks UI', () => {
  setUser({ role:'DIRECTOR', departmentId:'BGD', leaderLevel:'HEAD', approvalAuthorityPresent:false });
  assert.equal(Permissions.canCreateUnexpectedTask(false), true);
  const tasks = read('modules/tasks/tasks-view.js');
  assert.match(tasks, /canCreateUnexpectedTask\s*&&\s*!Permissions\.isDirector\(\)/);
});

test('Head/Deputy keep unexpected-task business flow in own unit', () => {
  setUser({ role:'DEPARTMENT_LEADER', departmentId:'CTXH', approvalAuthority:'HEAD', position:'Trưởng phòng' });
  assert.equal(Permissions.canCreateUnexpectedTask(false), true);
  setUser({ role:'DEPARTMENT_LEADER', departmentId:'CTXH', approvalAuthority:'DEPUTY', position:'Phó Trưởng phòng' });
  assert.equal(Permissions.canCreateUnexpectedTask(false), true);
});


test('Role + unit scope generalizes across TCHC/KHTC/YT/CTXH/KI/KII/KIII without test-account hardcode', () => {
  const units = ['TCHC','KHTC','YT','CTXH','KI','KII','KIII'];
  for (const departmentId of units) {
    setUser({ role:'DEPARTMENT_LEADER', departmentId, approvalAuthority:'HEAD', position:'Trưởng phòng' });
    assert.equal(Permissions.isDepartmentHead(), true, `HEAD ${departmentId}`);
    assert.equal(Permissions.canApproveRegistrationForDepartment(departmentId, false), true, `approve ${departmentId}`);
    assert.equal(Permissions.canCreateUnexpectedTask(false), true, `unexpected ${departmentId}`);
    assert.equal(Permissions.canRecordOralExecutiveDirective(), true, `oral own-unit ${departmentId}`);
    assert.equal(Permissions.canRelayOralExecutiveDirective(), departmentId === 'TCHC', `relay ${departmentId}`);

    setUser({ role:'DEPARTMENT_LEADER', departmentId, approvalAuthority:'DEPUTY', position:'Phó Trưởng phòng' });
    assert.equal(Permissions.isDepartmentDeputy(), true, `DEPUTY ${departmentId}`);
    assert.equal(Permissions.canCreateUnexpectedTask(false), true, `deputy unexpected ${departmentId}`);
    assert.equal(Permissions.canApproveRegistrationForDepartment(departmentId, false), false, `deputy no auto approve ${departmentId}`);
    assert.equal(Permissions.canRelayOralExecutiveDirective(), departmentId === 'TCHC', `deputy relay ${departmentId}`);
  }
});

test('Chi đoàn additional role remains independent from primary Phòng/Khu scope', () => {
  const cases = [
    ['CTXH','CDTN_BI_THU'],
    ['YT','CDTN_PHO_BI_THU'],
    ['TCHC','CDTN_UY_VIEN_BCH'],
    ['KHTC','CDTN_DOAN_VIEN']
  ];
  for (const [departmentId, additionalRole] of cases) {
    setUser({ role:'STAFF', departmentId, position:'Nhân viên', additionalRoles:[additionalRole] });
    assert.equal(UserContext.getUser().departmentId, departmentId);
    assert.equal(Permissions.isCdtnMember(), true);
    assert.equal(Permissions.isCdtnSecretary(), additionalRole === 'CDTN_BI_THU');
  }
});

test('Chi đoàn catalog is Secretary-only but CDTN_SECRETARY audience remains Secretary/Deputy-compatible', () => {
  setUser({ additionalRoles:['CDTN_BI_THU'] });
  assert.equal(Permissions.isCdtnCatalogManager(), true);
  setUser({ additionalRoles:['CDTN_PHO_BI_THU'] });
  assert.equal(Permissions.isCdtnCatalogManager(), false);
  setUser({ additionalRoles:['CDTN_UY_VIEN_BCH'] });
  assert.equal(Permissions.isCdtnCatalogManager(), false);
  const readService = read('services/standard-task-read-service.js');
  assert.match(readService, /audience === "CDTN_SECRETARY"\) return Permissions\.isCdtnLeadership\(\)/);
  assert.match(readService, /if \(Permissions\.isCdtnLeadership\(\)\)[\s\S]{0,350}departmentId["'],\s*["']==["'],\s*["']CDTN["']/);
});

test('Secretary self-registration auto-approves; member approval is Secretary/delegate only', () => {
  const service = read('services/task-registration-service.js');
  assert.match(service, /workspaceId === "CDTN"[\s\S]{0,120}Permissions\.isCdtnSecretary\(\)/);
  assert.match(service, /registrationDepartment === "CDTN"[\s\S]{0,220}Permissions\.isCdtnSecretary\(reviewer\)/);
  assert.doesNotMatch(service, /registrationDepartment === "CDTN"[\s\S]{0,220}isCdtnLeadership/);
  const rules = readRelease('firestore.rules');
  assert.match(rules, /function cdtnSecretaryAutoApprovesOwnRegistration\(\)/);
  assert.match(rules, /data\.departmentId == "CDTN"[\s\S]{0,180}isCdtnSecretary\(\) \|\| hasActiveCdtnApprovalDelegation\("APPROVE_REGISTRATIONS"\)/);
});

test('Secretary can delegate CDTN approval/confirmation only to Deputy Secretary or BCH member', () => {
  const service = read('services/task-registration-service.js');
  assert.match(service, /const roles = \["CDTN_PHO_BI_THU", "CDTN_UY_VIEN_BCH"\]/);
  assert.match(service, /permissions:\s*\["APPROVE_REGISTRATIONS", "CONFIRM_EVALUATIONS"\]/);
  const rules = readRelease('firestore.rules');
  assert.match(rules, /CDTN_PHO_BI_THU[\s\S]{0,220}CDTN_UY_VIEN_BCH/);
  assert.match(rules, /hasOnly\(\["APPROVE_REGISTRATIONS", "CONFIRM_EVALUATIONS"\]\)/);
});

test('Secretary own KPI final confirmation routes to BGD, other CDTN members to Secretary/delegate', () => {
  const authority = read('core/kpi-review-authority.js');
  assert.match(authority, /isCdtnSecretary\(owner\)\) return directorReviewers/);
  const rules = readRelease('firestore.rules');
  assert.match(rules, /ownerIsCdtnSecretary\(ownerId\)[\s\S]{0,180}isDirectorHead\(\)[\s\S]{0,100}CONFIRM_EVALUATIONS/);
  assert.match(rules, /!ownerIsCdtnSecretary\(ownerId\)[\s\S]{0,180}isCdtnSecretary\(\) \|\| hasActiveCdtnApprovalDelegation\("CONFIRM_EVALUATIONS"\)/);
  assert.match(rules, /ownerId != request\.auth\.uid/);
});

test('Primary unit can observe CDTN workload without inheriting CDTN scoring authority', () => {
  const rules = readRelease('firestore.rules');
  assert.match(rules, /function homeDepartmentLeaderCanView\(data\)/);
  assert.match(rules, /sameDepartment\(data\.homeDepartmentId\)/);
  assert.match(rules, /scopeDepartmentId == "CDTN"[\s\S]{0,450}ownerIsCdtnSecretary/);
});

test('Catalog delegation accepts business staff even when system role is ADMIN and preflight uses same helper', () => {
  const service = read('services/standard-task-write-service.js');
  assert.match(service, /function standardTaskDelegateCandidate\(user\)/);
  assert.match(service, /role === "ADMIN"[\s\S]{0,200}!Permissions\.hasUnitApprovalAuthority/);
  assert.match(service, /async listDelegationCandidates\(\)[\s\S]{0,1200}standardTaskDelegateCandidate\(item\)/);
  assert.match(service, /if \(!standardTaskDelegateCandidate\(delegate\)\)/);
  const rules = readRelease('firestore.rules');
  assert.match(rules, /function isStandardEditorDelegateProfile\(data\)/);
  assert.match(rules, /data\.role == "ADMIN" && !isHeadProfile\(data\) && !isDeputyProfile\(data\)/);
});


test('Executive-directive center management follows Director/TCHC business position, not ADMIN privilege alone', () => {
  setUser({ role:'ADMIN', departmentId:'YT', position:'Nhân viên', approvalAuthority:'' });
  assert.equal(Permissions.canManageExecutiveDirectives(), false);
  setUser({ role:'ADMIN', departmentId:'TCHC', position:'Nhân viên', approvalAuthority:'' });
  assert.equal(Permissions.canManageExecutiveDirectives(), false);
  setUser({ role:'ADMIN', departmentId:'TCHC', position:'Trưởng phòng', approvalAuthority:'HEAD' });
  assert.equal(Permissions.canManageExecutiveDirectives(), true);
  setUser({ role:'ADMIN', departmentId:'TCHC', position:'Phó Trưởng phòng', approvalAuthority:'DEPUTY' });
  assert.equal(Permissions.canManageExecutiveDirectives(), true);
  setUser({ role:'DIRECTOR', departmentId:'BGD', leaderLevel:'HEAD', approvalAuthorityPresent:false });
  assert.equal(Permissions.canManageExecutiveDirectives(), true);
  const rules = readRelease('firestore.rules');
  const start = rules.indexOf('function canManageExecutiveDirectives()');
  const end = rules.indexOf('function canRecordOralExecutiveDirective', start);
  const block = rules.slice(start, end);
  assert.doesNotMatch(block, /isAdmin\(\)/);
  assert.match(block, /isDirector\(\)/);
  assert.match(block, /sameDepartment\("TCHC"\)/);
});


test('ADMIN + Head/Deputy business profiles keep own-unit directive visibility without gaining cross-unit scope', () => {
  const service = read('services/executive-directive-service.js');
  assert.match(service, /function canReadOwnDirectiveDepartment\(user/);
  assert.match(service, /Permissions\.isDepartmentHead\(user\)/);
  assert.match(service, /Permissions\.isDepartmentDeputy\(user\)/);
  const rules = readRelease('firestore.rules');
  assert.match(rules, /\(isDepartmentHead\(\) \|\| isDepartmentDeputy\(\)\) && currentUser\(\)\.departmentId in data\.visibleDepartmentIds/);
  assert.match(rules, /function canGenerateExecutiveDepartmentReport\(departmentId\)[\s\S]{0,240}isDepartmentHead\(\)[\s\S]{0,80}isDepartmentDeputy\(\)/);
});

test('Ordinary Head records oral BGD directive only for own unit; TCHC Head/Deputy can relay cross-unit', () => {
  setUser({ role:'DEPARTMENT_LEADER', departmentId:'YT', approvalAuthority:'HEAD', position:'Trưởng phòng' });
  assert.equal(Permissions.canRecordOralExecutiveDirective(), true);
  assert.equal(Permissions.canRelayOralExecutiveDirective(), false);
  setUser({ role:'DEPARTMENT_LEADER', departmentId:'YT', approvalAuthority:'DEPUTY', position:'Phó Trưởng phòng' });
  assert.equal(Permissions.canRecordOralExecutiveDirective(), false);
  setUser({ role:'DEPARTMENT_LEADER', departmentId:'TCHC', approvalAuthority:'DEPUTY', position:'Phó Trưởng phòng' });
  assert.equal(Permissions.canRelayOralExecutiveDirective(), true);

  const service = read('services/executive-directive-service.js');
  assert.match(service, /if \(tchcRelay && requestedDepartmentId\)/);
  assert.match(service, /kpiEnabled:\s*false/);
  assert.match(service, /entryMode:\s*"TCHC_ORAL_RELAY"/);
  assert.match(service, /recordedByUserId:\s*user\.uid/);
  assert.match(service, /createdByUserId:\s*user\.uid/);
  const rules = readRelease('firestore.rules');
  assert.match(rules, /function canRecordOralExecutiveDirective\(data\)[\s\S]{0,150}isDepartmentHead\(\)/);
  assert.match(rules, /data\.leadDepartmentId == currentUser\(\)\.departmentId/);
  assert.match(rules, /updateType == "ORAL_RECORDED"[\s\S]{0,220}isDepartmentHead\(\)/);
});

test('Directive recipient can assign a person only after own-unit acceptance', () => {
  const view = read('modules/executive-directives/executive-directives-view.js');
  assert.match(view, /const assignableDepartments = \(ownAccepted && canAssignInternalUi/);
  assert.match(view, /Phân công người thực hiện/);
  assert.match(view, /canAssignInternalUi\(directive, user\.departmentId, user\)/);
  const rules = readRelease('firestore.rules');
  assert.match(rules, /function executiveAssigneeValid\(departmentId, userId\)/);
  assert.match(rules, /getAfter\(executiveDirectivePath\(directiveId\)\)[\s\S]{0,300}departmentId == currentUser\(\)\.departmentId/);
});


test('DIRECT/GROUPED and EVENT_DRIVEN/ITEMIZED contracts remain present', () => {
  const registrations = read('services/task-registration-service.js');
  const writer = read('services/task-write-service.js');
  const workItems = read('services/task-work-item-service.js');
  assert.match(registrations, /personalizationMode:\s*groupMode \? "GROUPED" : "DIRECT"/);
  assert.match(registrations, /personalizationMode:\s*"DIRECT"/);
  assert.match(writer, /deadlineMode[^\n]{0,120}"EVENT_DRIVEN"/);
  assert.match(writer, /trackingMode[^\n]{0,160}"ITEMIZED"/);
  assert.match(workItems, /TRACKING_MODE_ITEMIZED:\s*"ITEMIZED"/);
});

test('Evidence selection is visible before save and upload starts only on save', () => {
  const modal = read('modules/tasks/task-progress-modal.js');
  const uploader = read('services/staged-evidence-uploader.js');
  assert.match(modal, /box\.hidden = snapshot\.length === 0/);
  assert.match(modal, /data-remove-staged-id/);
  assert.match(modal, /staged\.addFiles\(files\)/);
  assert.match(modal, /await staged\.uploadPending\(\)/);
  assert.match(uploader, /status:\s*"SELECTED"/);
  assert.match(uploader, /async uploadPending\(\)[\s\S]{0,800}DriveEvidenceService\.upload/);
  const businessWriteIndex = Math.max(modal.indexOf("await TaskWriteService.updateProgress"), modal.indexOf("await TaskMilestoneService.complete"), modal.indexOf("await TaskWriteService.endEventDrivenTracking"));
  const commitIndex = modal.indexOf("staged.markCommitted(uploadedFiles)");
  assert.ok(commitIndex > businessWriteIndex, "evidence chỉ commit sau business write");
  assert.match(modal, /if \(!confirmedClose\)[\s\S]{0,700}TaskEvidenceService\.remove[\s\S]{0,500}staged\.rollbackUncommitted\(\)/);
});

test('Daily task save uses one-task refresh with scoped fallback rather than unconditional full reload', () => {
  const readService = read('services/task-read-service.js');
  const view = read('modules/tasks/tasks-view.js');
  assert.match(readService, /async function loadTaskById\(taskId\)/);
  assert.match(readService, /async getById\(taskId\)/);
  assert.match(view, /const refreshed = await TaskReadService\.getById\(task\.id\)/);
  assert.match(view, /fallback tải lại phạm vi hiện tại/);
});

test('Firestore rules keep Deputy unexpected-task management scoped to tasks they created', () => {
  const rules = readRelease('firestore.rules');
  assert.match(rules, /isDepartmentDeputy\(\)[\s\S]{0,180}data\.createdByUserId == request\.auth\.uid/);
  assert.doesNotMatch(rules, /function canReviewRegistrationRecord\(data\)[\s\S]{0,500}\bisAdmin\(\)/);
  assert.doesNotMatch(rules, /function canApproveDepartmentRegistrations\(departmentId\)[\s\S]{0,500}\bisAdmin\(\)/);
});

test('Rules are structurally balanced and 21 production indexes are preserved', () => {
  const rules = readRelease('firestore.rules');
  assertBalanced(rules);
  const indexes = JSON.parse(readRelease('firestore.indexes.json'));
  assert.equal(indexes.indexes.length, 21);
});


test('ADMIN corrections are action-scoped and cannot directly overwrite confirmed scores', () => {
  const rules = readRelease('firestore.rules');
  assert.match(rules, /function adminTaskCorrectionOnly\(\)/);
  assert.match(rules, /function adminRegistrationCorrectionOnly\(\)/);
  assert.match(rules, /function adminEvaluationCorrectionOnly\(\)/);
  assert.match(rules, /CANCEL_TASK/);
  assert.match(rules, /REOPEN_TASK/);
  assert.match(rules, /REOPEN_SELF_ASSESSMENT/);
  assert.match(rules, /REOPEN_CONFIRMATION/);
  assert.match(rules, /CANCEL_REGISTRATION/);
  assert.match(rules, /REOPEN_REGISTRATION/);
  const evaluationBlock = rules.slice(rules.indexOf("match /taskEvaluations/{evaluationId}"), rules.indexOf("/* ==================== TIÊU CHÍ CHUNG"));
  const commonBlock = rules.slice(rules.indexOf("match /commonCriteriaAssessments/{assessmentId}"), rules.indexOf("match /kpiAdjustments/{adjustmentId}"));
  assert.match(evaluationBlock, /allow update: if adminEvaluationCorrectionOnly\(\)/);
  assert.doesNotMatch(evaluationBlock, /allow update: if isAdmin\(\)/);
  assert.doesNotMatch(commonBlock, /allow update: if isAdmin\(\)/);
  assert.match(rules, /adminCorrectionAction == "CANCEL_TASK"[\s\S]{0,1400}getAfter\(taskPath\(resource\.data\.taskId\)\)\.data\.adminCorrectionAction == "CANCEL_TASK"/);
  assert.match(rules, /adminCorrectionAction == "REOPEN_CONFIRMATION"[\s\S]{0,2200}getAfter\(taskPath\(resource\.data\.taskId\)\)\.data\.adminCorrectionAction == "REOPEN_CONFIRMATION"/);
});


test('ADMIN system privilege does not become unit task assignment or no-occurrence approval authority', () => {
  const service = read('services/task-write-service.js');
  const assignStart = service.indexOf('async assign(task, assignment)');
  const acceptStart = service.indexOf('async accept(task)', assignStart);
  const assignBlock = service.slice(assignStart, acceptStart > assignStart ? acceptStart : assignStart + 7000);
  assert.doesNotMatch(assignBlock, /const mayAssign = Permissions\.isAdmin\(\)/);
  const confirmStart = service.indexOf('async confirmNoOccurrence(task)');
  const rejectStart = service.indexOf('async rejectNoOccurrence(task, reason)');
  const confirmBlock = service.slice(confirmStart, rejectStart);
  const rejectBlock = service.slice(rejectStart, rejectStart + 4000);
  assert.doesNotMatch(confirmBlock, /Permissions\.isAdmin\(\)/);
  assert.doesNotMatch(rejectBlock, /Permissions\.isAdmin\(\)/);
});

test('Director task service requires real Director business position, not ADMIN privilege', () => {
  const service = read('services/director-task-service.js');
  assert.match(service, /if \(!Permissions\.isDirector\(user\)\)/);
  assert.doesNotMatch(service, /Permissions\.isDirector\(user\)\s*\|\|\s*Permissions\.isAdmin\(user\)/);
});

test('Apps Script StandardTasks V4.9.0 optimizes reverse sync by contiguous block writes without changing sync invariants', () => {
  const s = readRelease('deployment/AppsScript_StandardTasks_V4.9.0.gs');
  assert.match(s, /VERSION:\s*'4\.9\.0'/);
  assert.match(s, /const rowsToUpdate = \[\]/);
  assert.match(s, /rowsToUpdate\.sort/);
  assert.match(s, /sheet\.getRange\(blockStart, 1, blockRows\.length, CFG\.HEADERS\.length\)\.setValues\(blockRows\)/);
  assert.match(s, /CONFLICT_FIRESTORE_NEWER/);
  assert.match(s, /plan\.conflicts\.length > 0/);
  assert.match(s, /BATCH_LIMIT:\s*450/);
});

test('Accounts Apps Script snapshot stays on deployed V3.4.3', () => {
  assert.match(readRelease('deployment/AppsScript_Accounts_V3.4.3.gs'), /3\.4\.3/);
});

const notificationSnapshot = path.join(releaseRoot, 'deployment/AppsScript_Notification_AI_Evidence_Archive_V6.4.1.gs');
test('Notification/AI/Evidence/Archive Apps Script snapshot remains V6.4.1 when bundled', { skip: !fs.existsSync(notificationSnapshot) }, () => {
  assert.match(fs.readFileSync(notificationSnapshot, 'utf8'), /6\.4\.1/);
});

test('Plan lock follows business scope: unit Head/delegate and Chi đoàn leadership/delegate, not ADMIN privilege alone', () => {
  const workflow = read('modules/kpi/kpi-workflow.js');
  const rules = readRelease('firestore.rules');
  assert.match(workflow, /if \(isCdtnScope\(\)\)[\s\S]{0,180}Permissions\.isCdtnLeadership\(\)/);
  const start = rules.indexOf('function canLockDepartmentPlan(departmentId)');
  const end = rules.indexOf('/* ==================== DANH MỤC ĐẦU VIỆC CHUẨN', start);
  const block = rules.slice(start, end);
  assert.doesNotMatch(block, /isAdmin\(\)/);
  assert.match(block, /departmentId == "CDTN"[\s\S]{0,180}isCdtnLeadership\(\)/);
  assert.match(block, /isDepartmentHead\(\) && sameDepartment\(departmentId\)/);
  assert.match(block, /hasActiveApprovalDelegation\(departmentId, "LOCK_PLAN"\)/);
});

test('Standard-task delegation service and Rules share the same per-unit delegation document contract', () => {
  const service = read('services/standard-task-write-service.js');
  const rules = readRelease('firestore.rules');
  assert.match(service, /return `\$\{upper\(departmentId\)\}_STANDARD_TASK_EDITOR`/);
  assert.match(rules, /function standardEditorDelegationId\(departmentId\)[\s\S]{0,120}departmentId \+ "_STANDARD_TASK_EDITOR"/);
  assert.match(service, /delegationType:\s*"STANDARD_TASK_EDITOR"/);
  assert.match(service, /delegatorUserId:\s*user\.uid/);
  assert.match(service, /delegateUserId/);
  assert.match(rules, /data\.delegationType == "STANDARD_TASK_EDITOR"/);
  assert.match(rules, /isStandardEditorDelegateProfile/);
});


test('V1.22.2 checks direct registration authority before optional delegation and optional read fails closed', () => {
  const service = read('services/task-registration-service.js');
  const approve = service.slice(service.indexOf('async approveMany('), service.indexOf('async rejectMany('));
  assert.ok(approve.indexOf('const directAuthority = canApprove(item, reviewer)') < approve.indexOf('hasDelegation(reviewer, registrationDepartment'), 'direct authority must be evaluated before delegation');
  assert.match(service, /if \(isPermissionDenied\(error\)\) return false/);
});

test('V1.22.2 first catalog delegation write tolerates only permission-denied pre-read and still verifies read-back', () => {
  const service = read('services/standard-task-write-service.js');
  const block = service.slice(service.indexOf('async saveDelegation('), service.indexOf('async revokeDelegation('));
  assert.match(block, /try \{[\s\S]{0,220}existing = await FirebaseService\.getDoc\(reference\)/);
  assert.match(block, /if \(!isPermissionDenied\(error\)\) throw error/);
  assert.match(block, /await FirebaseService\.setDoc\(reference, payload, \{ merge: false \}\)/);
  assert.match(block, /const readBack = await FirebaseService\.getDoc\(reference\)/);
});

test('V1.22.2 CDTN milestone path accepts explicit approval delegation without widening general task authority', () => {
  const rules = readRelease('firestore.rules');
  const start = rules.indexOf('function taskMilestoneCreateValid(data)');
  const end = rules.indexOf('function ownerCompletesMilestoneOnly()', start);
  const block = rules.slice(start, end);
  assert.match(block, /data\.departmentId == "CDTN"[\s\S]{0,180}hasActiveCdtnApprovalDelegation\("APPROVE_REGISTRATIONS"\)/);
});

test('V1.22.2 UI refinement keeps task workspaces full-width and removes generic confirm eyebrow', () => {
  const css = read('ui-v1.22.2.css');
  const modal = read('core/modal-service.js');
  const kpi = read('modules/kpi/kpi-workflow.js');
  assert.match(css, /\.task-workspace-grid[\s\S]{0,100}grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(css, /\.tasks-page-card \.task-workspace-panel \.task-list-scroll[\s\S]{0,180}overflow-y:\s*auto/);
  assert.match(css, /\.task-detail-tabbed > \.modal-header \.page-eyebrow/);
  assert.match(kpi, /registration-plan-table/);
  assert.match(modal, /eyebrow:\s*options\.eyebrow \?\? ""/);
});


test('V1.22.2 keeps Firestore Rules V1.22.1 and 21 indexes byte-for-byte unchanged', () => {
  assert.equal(sha256('firestore.rules'), '97e790bbd89afe41867d91dc1656d1f43eff2e7bc60d3c443656e918b811c2c4');
  assert.equal(sha256('firestore.indexes.json'), 'cf681aca804f70acf644471be86f7e99dc1399c75966f37b680d572a8f2ad5bc');
  const indexes = JSON.parse(readRelease('firestore.indexes.json'));
  assert.equal(indexes.indexes.length, 21);
});

test('V1.22.2 desktop KPI scope uses full row without accidental horizontal scrollbar', () => {
  const css = read('ui-v1.22.2.css');
  assert.match(css, /\.kpi-management-toolbar\s*\{[\s\S]{0,180}grid-template-columns:\s*minmax\(0, 1fr\)\s*!important/);
  assert.match(css, /\.kpi-management-context \.kpi-scope-switch-options\s*\{[\s\S]{0,260}flex-wrap:\s*wrap[\s\S]{0,180}overflow-x:\s*visible\s*!important/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]{0,1000}\.kpi-management-context \.kpi-scope-switch-options\s*\{[\s\S]{0,180}overflow-x:\s*auto\s*!important/);
});

test('V1.22.2 Tasks reader adds homeDepartment workload only for department leaders in all-department branch', () => {
  const service = read('services/task-read-service.js');
  const start = service.indexOf('if (Permissions.canViewAllDepartments())');
  const end = service.indexOf('if (Permissions.isDepartmentLeader())', start + 1);
  const block = service.slice(start, end);
  assert.match(block, /Permissions\.isDepartmentLeader\(\)\s*&&\s*user\.departmentId/);
  assert.match(block, /where\("homeDepartmentId",\s*"==",\s*user\.departmentId\)/);
  assert.match(block, /Scope Chi đoàn độc lập/);
});

test('V1.22.2 KPI plans load and realtime mirror manager homeDepartment workload without expanding evaluation authority', () => {
  const kpi = read('modules/kpi/kpi-workflow.js');
  assert.match(kpi, /const managerMonitoringScope = KpiWorkflowState\.mode === 'plans'[\s\S]{0,260}isLeader\(\)[\s\S]{0,260}departmentId === managerHomeDepartmentId/);
  const realtimeTasks = kpi.slice(kpi.indexOf("if (kind === 'tasks')"), kpi.indexOf("if (kind === 'taskRegistrations')"));
  assert.match(realtimeTasks, /managerMonitoringScope[\s\S]{0,280}homeDepartmentId/);
  const realtimeRegistrations = kpi.slice(kpi.indexOf("if (kind === 'taskRegistrations')"), kpi.indexOf("if (kind === 'taskEvaluations')"));
  assert.doesNotMatch(realtimeRegistrations, /managerMonitoringScope/);
  const realtimeEvaluations = kpi.slice(kpi.indexOf("if (kind === 'taskEvaluations')"), kpi.indexOf("if (kind === 'commonCriteriaAssessments')"));
  assert.doesNotMatch(realtimeEvaluations, /managerMonitoringScope/);
  assert.match(kpi, /function taskInPlanMonitoringScope\(task\)[\s\S]{0,520}taskScopeDepartmentId\(task\) === 'CDTN'[\s\S]{0,180}homeDepartmentId/);
  assert.match(kpi, /function rowsForPerson\(uid\)[^\n]*taskInPlanMonitoringScope\(t\)/);
});

test('V1.22.2 changing KPI scope stops old realtime and restarts listener after load', () => {
  const kpi = read('modules/kpi/kpi-workflow.js');
  const start = kpi.indexOf("toolbar.querySelectorAll('[data-kpi-scope]')");
  const end = kpi.indexOf("el('kpiCommonButton')", start);
  const block = kpi.slice(start, end);
  const desktopStop = block.indexOf('stopKpiRealtime();');
  const desktopLoad = block.indexOf('await loadAll();');
  const desktopStart = block.indexOf('startKpiRealtime();', desktopLoad);
  assert.ok(desktopStop >= 0 && desktopStop < desktopLoad && desktopLoad < desktopStart);
  const mobile = block.slice(block.indexOf("#kpiMobileScopeSelect"));
  assert.ok(mobile.indexOf('stopKpiRealtime();') < mobile.indexOf('await loadAll();'));
  assert.ok(mobile.indexOf('await loadAll();') < mobile.indexOf('startKpiRealtime();'));
});

test('V1.22.2 delegation revoke handlers capture button before async confirm', () => {
  const view = read('modules/standard-tasks/standard-tasks-view.js');
  for (const id of ['#revokeCatalogDelegation', '#revokeCdtnApproval']) {
    const start = view.indexOf(`root.querySelector("${id}")`);
    assert.ok(start >= 0, `${id} handler missing`);
    const block = view.slice(start, view.indexOf('});', start) + 3);
    const capture = block.indexOf('const button = event.currentTarget;');
    const confirm = block.indexOf('await ModalService.confirm');
    assert.ok(capture >= 0 && confirm >= 0 && capture < confirm, `${id}: button must be captured before confirm await`);
  }
});

test('V1.22.2 Rules still support delegation soft revoke and keep hard delete Admin-only', () => {
  const rules = readRelease('firestore.rules');
  assert.match(rules, /function validStandardEditorDelegationRevoke\([\s\S]{0,260}data\.active == false[\s\S]{0,120}data\.delegatorUserId == request\.auth\.uid/);
  const start = rules.indexOf('match /approvalDelegations/{delegationDocumentId}');
  const end = rules.indexOf('match /kpiPlans/', start);
  const block = rules.slice(start, end);
  assert.match(block, /validStandardEditorDelegationRevoke/);
  assert.match(block, /resource\.data\.delegationType == "CDTN_APPROVAL" && isCdtnSecretary\(\)/);
  assert.match(block, /allow delete: if isAdmin\(\)/);
});
