import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const releaseRoot = path.resolve(appRoot, '..');
const read = rel => fs.readFileSync(path.join(appRoot, rel), 'utf8');
const rules = fs.readFileSync(path.join(releaseRoot, 'firestore.rules'), 'utf8');
const indexes = JSON.parse(fs.readFileSync(path.join(releaseRoot, 'firestore.indexes.json'), 'utf8'));

const { Permissions } = await import(pathToFileURL(path.join(appRoot, 'core/permissions.js')).href + '?test=v1240');
const { resolveKpiReviewers } = await import(pathToFileURL(path.join(appRoot, 'core/kpi-review-authority.js')).href + '?test=v1240');
const xlsxModule = await import(pathToFileURL(path.join(appRoot, 'services/xlsx-export-service.js')).href + '?test=v1240');
const docxModule = await import(pathToFileURL(path.join(appRoot, 'services/docx-export-service.js')).href + '?test=v1240');
const { taskAcceptanceState, taskDisplayGroup } = await import(pathToFileURL(path.join(appRoot, 'core/task-display-order.js')).href + '?test=v1240');

function user(id, role, departmentId, approvalAuthority = 'NONE', extra = {}) {
  return {
    id, uid: id, email: `${id.toLowerCase()}@example.test`, fullName: id,
    role, departmentId, approvalAuthority, approvalAuthorityPresent: true,
    leaderLevel: approvalAuthority === 'HEAD' ? 'HEAD' : approvalAuthority === 'DEPUTY' ? 'DEPUTY' : '',
    isDepartmentHead: approvalAuthority === 'HEAD', active: true, additionalRoles: [],
    actingHeadDepartmentIds: [], actingOversightDepartmentIds: [], ...extra
  };
}

const DEPARTMENTS = ['TCHC','CTXH','KHTC','YT','KI','KII','KIII'];
function otherHome(target) { return DEPARTMENTS.find(id => id !== target); }


async function writeBlob(blob, extension) {
  const out = path.join(os.tmpdir(), `kpi-v1240-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`);
  fs.writeFileSync(out, Buffer.from(await blob.arrayBuffer()));
  return out;
}
function fakeClassList(values = []) { const set = new Set(values); return { contains: value => set.has(value) }; }
function fakeElement(tagName, text = '', children = [], classes = []) {
  return { nodeType:1, tagName, innerText:text, textContent:text, children, classList:fakeClassList(classes), querySelector:() => null };
}
function ids(items) { return items.map(item => item.id || item.uid).sort(); }

function sha(rel) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(appRoot, rel))).digest('hex');
}

function block(source, startPattern, nextPattern) {
  const start = source.search(startPattern);
  if (start < 0) return '';
  const rest = source.slice(start);
  const next = nextPattern ? rest.slice(1).search(nextPattern) : -1;
  return next >= 0 ? rest.slice(0, next + 1) : rest;
}

test('V1.24.0 version, build, cache, release loader and service worker are synchronized', () => {
  const version = read('core/app-version.js');
  assert.match(version, /APP_VERSION\s*=\s*["']1\.24\.0["']/);
  assert.match(version, /BUILD_VERSION\s*=\s*["']20260905\.V1_24_0["']/);
  assert.match(version, /CACHE_NAME\s*=\s*["']nhiem-vu-20260905-v1-24-0["']/);
  assert.match(read('index.html'), /release-v1\.24\.0\.js\?v=20260905\.V1_24_0/);
  assert.match(read('sw.js'), /BUILD_VERSION = "20260905\.V1_24_0"/);
  assert.match(read('release-v1.24.0.js'), /1\.24\.0/);
});

test('42 department/profile capability combinations obey department-invariant permission semantics', () => {
  let cases = 0;
  for (const dep of DEPARTMENTS) {
    const home = otherHome(dep);
    const profiles = [
      ['STAFF', user(`S-${dep}`, 'STAFF', dep, 'NONE'), { register:true, approve:false, direct:false }],
      ['ADMIN_AS_STAFF', user(`A-${dep}`, 'ADMIN', dep, 'NONE'), { register:true, approve:false, direct:false }],
      ['DEPUTY', user(`D-${dep}`, 'DEPARTMENT_LEADER', dep, 'DEPUTY'), { register:true, approve:false, direct:false }],
      ['HEAD', user(`H-${dep}`, 'DEPARTMENT_LEADER', dep, 'HEAD'), { register:true, approve:true, direct:true }],
      ['DIRECT_ACTING_HEAD', user(`X-${dep}`, 'DEPARTMENT_LEADER', home, 'DEPUTY', { actingHeadDepartmentIds:[dep] }), { register:true, approve:true, direct:true }],
      ['OVERSIGHT_HEAD', user(`O-${dep}`, 'DEPARTMENT_LEADER', home, 'HEAD', { actingOversightDepartmentIds:[dep] }), { register:false, approve:true, direct:false }]
    ];
    for (const [label, profile, expected] of profiles) {
      cases++;
      assert.equal(Permissions.canRegisterForDepartment(profile, dep), expected.register, `${dep}/${label} register`);
      assert.equal(Permissions.canApproveForDepartment(profile, dep), expected.approve, `${dep}/${label} approve`);
      assert.equal(Permissions.hasDirectHeadAuthorityForDepartment(profile, dep), expected.direct, `${dep}/${label} direct head`);
      if (label === 'ADMIN_AS_STAFF') assert.equal(Permissions.isBusinessStaff(profile), true, `${dep}/ADMIN business staff`);
    }
  }
  assert.equal(cases, 42);
});

test('registration canonicalizes STAFF authority to NONE and auto-approves only direct head authority', () => {
  const source = read('services/task-registration-service.js');
  assert.match(source, /const canonicalApprovalAuthority = authoritySnapshot\.authority \|\| \(workspaceId === "CDTN" \? "" : "NONE"\)/);
  assert.match(source, /userApprovalAuthority:\s*canonicalApprovalAuthority/);
  assert.match(source, /const autoApprove = workspaceId === "CDTN"[\s\S]*Permissions\.hasDirectHeadAuthorityForDepartment\(user, workspaceId\)/);
  const head = user('H', 'DEPARTMENT_LEADER', 'YT', 'HEAD');
  const staff = user('S', 'STAFF', 'YT', 'NONE');
  assert.equal(Permissions.authorityForDepartment(head, 'YT').authority, 'HEAD');
  assert.equal(Permissions.authorityForDepartment(staff, 'YT').authority, '');
});

test('Director Head auto-approves BGD while Director Deputy requires Head approval', () => {
  const gd = user('GD', 'DIRECTOR', 'BGD', 'HEAD', { leaderLevel:'HEAD', isDepartmentHead:false });
  const pgd = user('PGD', 'DIRECTOR', 'BGD', 'DEPUTY', { leaderLevel:'DEPUTY', isDepartmentHead:false });
  assert.equal(Permissions.isDirectorHead(gd), true);
  assert.equal(Permissions.isDirectorHead(pgd), false);
  assert.equal(Permissions.canApproveForDepartment(gd, 'BGD'), true);
  assert.equal(Permissions.canApproveForDepartment(pgd, 'BGD'), false);
  const ruleBlock = block(rules, /function directorAutoApprovesOwnRegistration\(\)/, /function /);
  assert.match(ruleBlock, /isDirectorHead\(\)/);
  assert.doesNotMatch(ruleBlock, /isDirector\(\)\s*&&/);
});

test('pre-accept cancellation is limited to own clean auto-approved task before personal acceptance', () => {
  const source = read('services/task-registration-service.js');
  const clientBlock = block(source, /function taskDocumentCancellable\(/, /function /);
  assert.match(clientBlock, /registration\.autoApproved === true/);
  assert.match(clientBlock, /approvedByUserId/);
  assert.match(clientBlock, /assignmentStatus === "DA_PHAN_CONG"/);
  assert.match(clientBlock, /emptyTaskField\(task\.acceptedAt\)/);
  const ruleBlock = block(rules, /function ownerCanCancelSelfRegisteredTask\(\)/, /function /);
  assert.match(ruleBlock, /resource\.data\.assignmentStatus == "DA_PHAN_CONG"/);
  assert.match(ruleBlock, /acceptedAt/);
  assert.match(ruleBlock, /autoApproved == true/);
  assert.match(ruleBlock, /approvedByUserId == request\.auth\.uid/);
  assert.match(ruleBlock, /request\.resource\.data\.status == "HUY"/);
});

test('acceptance resolver distinguishes pending, accepted, legacy accepted and terminal tasks', () => {
  const base = { ownerUserId:'U1', active:true, assignmentStatus:'DA_PHAN_CONG', status:'MOI_TIEP_NHAN' };
  assert.equal(taskAcceptanceState(base), 'PENDING');
  assert.equal(taskAcceptanceState({ ...base, assignmentStatus:'DA_TIEP_NHAN', status:'DANG_XU_LY' }), 'ACCEPTED');
  assert.equal(taskAcceptanceState({ ...base, acceptedAt:{ seconds:1 } }), 'ACCEPTED');
  assert.equal(taskAcceptanceState({ ...base, status:'HOAN_THANH', completedAt:{ seconds:2 } }), 'NONE');
  assert.ok(taskDisplayGroup(base) < taskDisplayGroup({ ...base, assignmentStatus:'DA_TIEP_NHAN', status:'DANG_XU_LY' }));
});

test('task list and detail UI expose separate acceptance state with final Vietnamese labels', () => {
  const list = read('modules/tasks/tasks-view.js');
  const modal = read('modules/tasks/task-detail-modal.js');
  assert.match(list, /id="taskAcceptanceFilter"/);
  assert.match(list, />Chưa xác nhận<\/option>/);
  assert.match(list, />Đã xác nhận<\/option>/);
  assert.match(list, /task-acceptance-pill/);
  assert.match(modal, /detail\("Tiếp nhận", acceptanceDisplay\(task\)\)/);
  assert.match(modal, /Chưa xác nhận/);
  assert.match(modal, /Đã xác nhận/);
  assert.match(read('v3.css'), /\.task-acceptance-pill\.pending/);
  assert.match(read('v3.css'), /\.task-acceptance-pill\.accepted/);
});

test('EVENT_DRIVEN progress only records occurrences; non-scoring request is unified under Adjustment', () => {
  const modal = read('modules/tasks/task-detail-modal.js');
  const adjustment = read('modules/tasks/task-adjustment-panel.js');
  assert.match(modal, /Các lượt phát sinh/);
  assert.match(modal, /Ghi nhận phát sinh/);
  assert.doesNotMatch(modal, /Đề nghị “Không phát sinh”/);
  assert.match(adjustment, /Điều chỉnh nhiệm vụ \/ Không tính KPI/);
  assert.match(adjustment, /Đề nghị không tính KPI/);
  assert.match(adjustment, /Không phát sinh trong kỳ/);
  assert.match(adjustment, /Điều động\/chuyển công tác\/lý do khách quan/);
  assert.match(adjustment, /Không thể đề nghị Không phát sinh vì nhiệm vụ đã có công việc thực tế trong kỳ\./);
  assert.doesNotMatch(adjustment, /window\.prompt/);
});

test('no-occurrence workflow is dedicated in Rules and cannot be bypassed by broad owner/manager update paths', () => {
  const ownerKeys = block(rules, /function ownerTaskUpdateKeysOnly\(\)/, /function /);
  assert.doesNotMatch(ownerKeys, /noOccurrenceStatus|noOccurrenceReason|noOccurrenceRequestedAt/);
  const requestBlock = block(rules, /function ownerNoOccurrenceRequestOnly\(\)/, /function /);
  assert.match(requestBlock, /deadlineMode"\) && resource\.data\.deadlineMode == "EVENT_DRIVEN"/);
  assert.match(requestBlock, /trackingMode"\) && resource\.data\.trackingMode == "ITEMIZED"/);
  assert.match(requestBlock, /noOccurrenceStatus == "REQUESTED"/);
  const reviewerBlock = block(rules, /function reviewerNoOccurrenceDecisionOnly\(data\)/, /function /);
  assert.match(reviewerBlock, /canConfirmTaskScore\(data\)/);
  assert.match(reviewerBlock, /NO_OCCURRENCE_CONFIRMED/);
  const manage = block(rules, /function canManageTaskUpdate\(data, taskId\)/, /function /);
  assert.match(manage, /!changesNoOccurrenceWorkflow\(\)/);
  const matchTask = rules.match(/match \/tasks\/\{taskId\} \{[\s\S]*?allow delete:/)?.[0] || '';
  assert.match(matchTask, /ownerNoOccurrenceRequestOnly\(\)/);
  assert.match(matchTask, /reviewerNoOccurrenceDecisionOnly\(resource\.data\)/);
});

test('non-scoring objective exemption uses scoring authority and preserves semantic status', () => {
  const service = read('services/task-adjustment-service.js');
  assert.match(service, /Không tính KPI — Điều động\/lý do khách quan/);
  assert.match(service, /ADJUSTMENT_EXEMPT/);
  assert.match(service, /Permissions\.hasDirectHeadAuthorityForDepartment/);
  const updateBlock = block(rules, /function adjustmentApproverUpdateOnly\(data, adjustmentId\)/, /function /);
  const taskUpdateBlock = block(rules, /function adjustmentApproverTaskUpdateOnly\(data, taskId\)/, /function /);
  assert.match(updateBlock, /EXEMPT_FROM_SCORING[\s\S]*canConfirmTaskScore/);
  assert.match(taskUpdateBlock, /EXEMPT_FROM_SCORING[\s\S]*canConfirmTaskScore/);
  const matchAdj = rules.match(/match \/kpiAdjustments\/\{adjustmentId\} \{[\s\S]*?\n    }/)?.[0] || '';
  assert.match(matchAdj, /allow update: if adjustmentApproverUpdateOnly\(resource\.data, adjustmentId\)/);
  assert.doesNotMatch(matchAdj, /allow update:[^\n]*isAdmin/);
});

test('Executive Directives support ADMIN-as-business-staff without granting center management', () => {
  const rulesBlock = rules.match(/match \/executiveDirectiveUpdates\/\{updateId\} \{[\s\S]*?\n    }/)?.[0] || '';
  assert.match(rulesBlock, /isBusinessStaff\(\)[\s\S]*assignedUserId == request\.auth\.uid/);
  const realtime = read('services/executive-in-app-alert-service.js');
  assert.match(realtime, /Permissions\.isBusinessStaff\(user\)[\s\S]*where\("assignedUserId", "==", user\.uid\)/);
  const adminStaff = user('ADMINSTAFF', 'ADMIN', 'TCHC', 'NONE');
  assert.equal(Permissions.isBusinessStaff(adminStaff), true);
  assert.equal(Permissions.isAdmin(adminStaff), true);
  assert.equal(Permissions.hasDirectHeadAuthorityForDepartment(adminStaff, 'TCHC'), false);
});

test('core scoring and deadline engines are byte-identical to the verified production baseline', () => {
  const expected = {
    'kpi-engine.js': 'bd3f04de8ec762d5a497068ab8fb254537406c2f8de17b9e40838da3517e89c1',
    'work-item-score-engine.js': '253edb052129d6b9e2922ed4b3b0a485686ba8f8a5626ad58974f8daf085ce15',
    'core/deadline-engine.js': '4d1378dd6ec4d81c8d6d474e5c65bfee7373de95e5bcad4cee2d86357474b6ee'
  };
  for (const [rel, expectedHash] of Object.entries(expected)) assert.equal(sha(rel), expectedHash, rel);
});

test('production index snapshot contains exactly all 21 verified composite indexes', () => {
  assert.equal(indexes.indexes.length, 21);
  const signature = item => `${item.collectionGroup}|${item.fields.map(f => `${f.fieldPath}:${f.order || f.arrayConfig}`).join(',')}`;
  const sigs = new Set(indexes.indexes.map(signature));
  for (const expected of [
    'executiveDirectives|visibleDepartmentIds:CONTAINS,updatedAt:DESCENDING',
    'taskEvidenceFiles|taskId:ASCENDING,departmentId:ASCENDING',
    'taskEvidenceFiles|taskId:ASCENDING,ownerUserId:ASCENDING',
    'taskMilestones|periodId:ASCENDING,departmentId:ASCENDING',
    'taskMilestones|periodId:ASCENDING,ownerUserId:ASCENDING',
    'taskWorkItems|taskId:ASCENDING,departmentId:ASCENDING',
    'taskWorkItems|taskId:ASCENDING,ownerUserId:ASCENDING'
  ]) assert.ok(sigs.has(expected), expected);
});

test('Apps Script production sources remain byte-identical to approved versions', () => {
  const expected = {
    'AppsScript_Accounts_V3.5.0.gs': 'fddacf854d69adffe1470fc2349a88cbcdf38d1b0937b4fa76e33a7d34754694',
    'AppsScript_StandardTasks_V4.9.0.gs': '68524e0e73481acc638560db62b784698e12270f5a39d5950b18d005b33ffbe4'
  };
  for (const [name, expectedHash] of Object.entries(expected)) {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(releaseRoot, 'deployment', name))).digest('hex');
    assert.equal(actual, expectedHash, name);
  }
});


test('direct acting scoring reviewer remains target HEAD while oversight is not a KPI reviewer', () => {
  const A = user('A', 'DEPARTMENT_LEADER', 'CTXH', 'HEAD', { actingOversightDepartmentIds:['KII'] });
  const B = user('B', 'DEPARTMENT_LEADER', 'CTXH', 'DEPUTY', { actingHeadDepartmentIds:['KII'] });
  const staff = user('S', 'STAFF', 'KII', 'NONE');
  const gd = user('GD', 'DIRECTOR', 'BGD', 'HEAD', { leaderLevel:'HEAD', isDepartmentHead:false });
  assert.deepEqual(ids(resolveKpiReviewers({ users:[A,B,staff,gd], delegations:[], owner:staff, scopeDepartmentId:'KII' })), ['B']);
  assert.deepEqual(ids(resolveKpiReviewers({ users:[A,B,staff,gd], delegations:[], owner:B, scopeDepartmentId:'KII' })), ['GD']);
});

test('Notification Center remains per-user best-effort and OneSignal keeps singleton initialization', () => {
  const service = read('services/user-notification-service.js');
  const oneSignal = read('onesignal.js');
  assert.match(service, /"userNotifications",\s*user\.uid,\s*"items"/);
  assert.match(service, /Promise\.allSettled/);
  assert.match(rules, /match \/userNotifications\/\{recipientUserId\}\/items\/\{notificationId\}/);
  assert.match(rules, /allow read: if activeUser\(\) && request\.auth\.uid == recipientUserId/);
  assert.match(oneSignal, /GLOBAL_STATE_KEY = "__TAN_HIEP_TASK_PUSH_SINGLETON_V1__"/);
  assert.match(oneSignal, /state\.initializingPromise/);
});

test('Admin correction remains soft/audited and does not become broad business authority', () => {
  const admin = read('services/admin-maintenance-service.js');
  assert.match(admin, /EVENT_DRIVEN_RESET_ACTION = "REOPEN_REGISTRATION_AS_EVENT_DRIVEN"/);
  const correction = admin.match(/async applyEventDrivenResetBatch[\s\S]*?(?=\n  async correctionPreview)/)?.[0] || '';
  assert.match(correction, /status:"HUY"/);
  assert.match(correction, /status:"PENDING"/);
  assert.doesNotMatch(correction, /batch\.delete|deleteDoc/);
  const adminStaff = user('AS','ADMIN','YT','NONE');
  assert.equal(Permissions.isAdmin(adminStaff), true);
  assert.equal(Permissions.canApproveForDepartment(adminStaff, 'YT'), false);
});

test('personal registration frequency hotfix remains intact', () => {
  const source = read('modules/standard-tasks/standard-tasks-view.js');
  assert.match(source, /return String\(registration\?\.frequency \|\| item\?\.frequency \|\| ""\)\.trim\(\)/);
  const available = source.match(/function renderAvailableTask[\s\S]*?(?=\nfunction registeredTaskFrequency)/)?.[0] || '';
  assert.doesNotMatch(available, /registrationFrequency/);
});

test('Product Catalog XLSX remains a valid editable Office package', async () => {
  const blob = xlsxModule.buildProductCatalogWorkbookBlob({
    periodLabel:'Quý III/2026', employeeName:'Nguyễn Văn A', employeePosition:'Trưởng phòng', departmentName:'CTXH',
    rows:[{ index:1, title:'Công việc A', outputRequirement:'Kết quả A', deadlineLabel:'Theo từng lượt phát sinh', workTypeLabel:'Thường xuyên', baseScore:10, coefficientLabel:'110%', maximumConvertedScore:11, evidence:'Văn bản' }], exceededCount:1
  });
  const file = await writeBlob(blob, 'xlsx');
  execFileSync('unzip', ['-t', file], { stdio:'ignore' });
  const list = execFileSync('unzip', ['-Z1', file], { encoding:'utf8' });
  assert.match(list, /xl\/workbook\.xml/);
  assert.match(list, /xl\/worksheets\/sheet1\.xml/);
  fs.unlinkSync(file);
});

test('KPI DOCX remains a valid editable Office Open XML package', async () => {
  const root = fakeElement('DIV', '', [
    fakeElement('H1', 'BÁO CÁO KPI CÁ NHÂN'),
    fakeElement('P', 'Họ và tên: Nguyễn Văn A'),
    fakeElement('P', 'Tổng điểm: 95')
  ]);
  const blob = docxModule.buildDocxBlobFromElement(root, { title:'Báo cáo KPI cá nhân' });
  const file = await writeBlob(blob, 'docx');
  execFileSync('unzip', ['-t', file], { stdio:'ignore' });
  const list = execFileSync('unzip', ['-Z1', file], { encoding:'utf8' });
  assert.match(list, /word\/document\.xml/);
  assert.match(list, /word\/styles\.xml/);
  fs.unlinkSync(file);
});
