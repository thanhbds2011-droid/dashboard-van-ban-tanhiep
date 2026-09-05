import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const releaseRoot = path.resolve(appRoot, '..');
const read = rel => fs.readFileSync(path.join(appRoot, rel), 'utf8');
const rules = fs.readFileSync(path.join(releaseRoot, 'firestore.rules'), 'utf8');

const permissionsModule = await import(pathToFileURL(path.join(appRoot, 'core/permissions.js')).href + '?test=v1230');
const authorityModule = await import(pathToFileURL(path.join(appRoot, 'core/kpi-review-authority.js')).href + '?test=v1230');
const xlsxModule = await import(pathToFileURL(path.join(appRoot, 'services/xlsx-export-service.js')).href + '?test=v1230');
const docxModule = await import(pathToFileURL(path.join(appRoot, 'services/docx-export-service.js')).href + '?test=v1230');
const { Permissions } = permissionsModule;
const { resolveKpiReviewers } = authorityModule;

function user(id, role, departmentId, approvalAuthority = 'NONE', extra = {}) {
  return {
    id, uid: id, email: `${id.toLowerCase()}@example.test`, fullName: id,
    role, departmentId, approvalAuthority, approvalAuthorityPresent: true,
    leaderLevel: approvalAuthority === 'HEAD' ? 'HEAD' : approvalAuthority === 'DEPUTY' ? 'DEPUTY' : '',
    isDepartmentHead: approvalAuthority === 'HEAD', active: true, additionalRoles: [],
    actingHeadDepartmentIds: [], actingOversightDepartmentIds: [], ...extra
  };
}

const A = user('A', 'DEPARTMENT_LEADER', 'CTXH', 'HEAD', {
  actingHeadDepartmentIds: ['KI'], actingOversightDepartmentIds: ['KII', 'KIII']
});
const B = user('B', 'DEPARTMENT_LEADER', 'CTXH', 'DEPUTY', { actingHeadDepartmentIds: ['KII'] });
const C = user('C', 'DEPARTMENT_LEADER', 'CTXH', 'DEPUTY', { actingHeadDepartmentIds: ['KIII'] });
const STAFF_KI = user('STAFF_KI', 'STAFF', 'KI');
const STAFF_KII = user('STAFF_KII', 'STAFF', 'KII');
const STAFF_KIII = user('STAFF_KIII', 'STAFF', 'KIII');
const STAFF_CTXH = user('STAFF_CTXH', 'STAFF', 'CTXH');
const GD = user('GD', 'DIRECTOR', 'BGD', 'HEAD', { leaderLevel: 'HEAD', isDepartmentHead: false });

function ids(items) { return items.map(item => item.id || item.uid).sort(); }

async function writeBlob(blob, extension) {
  const p = path.join(os.tmpdir(), `kpi-v1230-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`);
  fs.writeFileSync(p, Buffer.from(await blob.arrayBuffer()));
  return p;
}

function fakeClassList(values = []) {
  const set = new Set(values);
  return { contains: value => set.has(value) };
}
function fakeElement(tagName, text = '', children = [], classes = []) {
  return {
    nodeType: 1,
    tagName,
    innerText: text,
    textContent: text,
    children,
    classList: fakeClassList(classes),
    querySelector: () => null
  };
}

test('V1.23.0 version, build, cache, HTML and service worker are synchronized', () => {
  const version = read('core/app-version.js');
  assert.match(version, /APP_VERSION\s*=\s*["']1\.23\.0["']/);
  assert.match(version, /BUILD_VERSION\s*=\s*["']20260904\.V1_23_0["']/);
  assert.match(version, /CACHE_NAME\s*=\s*["']nhiem-vu-20260904-v1-23-0["']/);
  assert.match(read('index.html'), /release-v1\.23\.0\.js\?v=20260904\.V1_23_0/);
  assert.match(read('sw.js'), /BUILD_VERSION = "20260904\.V1_23_0"/);
});

test('registrationFrequency runtime bug is fixed while personal-frequency hotfix remains', () => {
  const source = read('modules/standard-tasks/standard-tasks-view.js');
  const available = source.match(/function renderAvailableTask[\s\S]*?(?=\nfunction registeredTaskFrequency)/)?.[0] || '';
  assert.doesNotMatch(available, /registrationFrequency/);
  assert.match(available, /item\.frequency/);
  assert.match(source, /return String\(registration\?\.frequency \|\| item\?\.frequency \|\| ""\)\.trim\(\)/);
});

test('Router isolates stale async routes instead of letting them overwrite the current outlet', () => {
  const source = read('core/router.js');
  assert.match(source, /const routeHost = document\.createElement\("div"\)/);
  assert.match(source, /this\.outlet\.replaceChildren\(routeHost\)/);
  assert.match(source, /sequence !== this\.resolveSequence \|\| !routeHost\.isConnected/);
  assert.match(source, /await handler\(routeHost/);
});

test('Admin screen has no automatic dashboard diagnostics and keeps explicit maintenance tools', () => {
  const source = read('modules/admin/admin-view.js');
  const renderView = source.match(/export async function renderAdminView[\s\S]*?(?=\nfunction render\()/)?.[0] || '';
  assert.doesNotMatch(renderView, /AdminReadService\.diagnostics\(/);
  assert.match(source, /btnAdminCheckData/);
  assert.match(source, /btnAdminEventDrivenReset/);
  assert.match(source, /btnAdminCleanup/);
  assert.doesNotMatch(source, /Tài khoản hoạt động|Đầu việc chuẩn|Nhiệm vụ Firestore/);
});

test('Acting scope selectors match the approved A/B/C business rule', () => {
  assert.deepEqual(Permissions.getViewDepartmentIds(A).sort(), ['CTXH','KI','KII','KIII'].sort());
  assert.deepEqual(Permissions.getRegistrationDepartmentIds(A).sort(), ['CTXH','KI'].sort());
  assert.deepEqual(Permissions.getApprovalDepartmentIds(A).sort(), ['CTXH','KI','KII','KIII'].sort());
  assert.deepEqual(Permissions.getViewDepartmentIds(B).sort(), ['CTXH','KII'].sort());
  assert.deepEqual(Permissions.getRegistrationDepartmentIds(B).sort(), ['CTXH','KII'].sort());
  assert.equal(Permissions.hasDirectHeadAuthorityForDepartment(A, 'KII'), false);
  assert.equal(Permissions.hasHeadAuthorityForDepartment(A, 'KII'), true);
  assert.equal(Permissions.hasDirectHeadAuthorityForDepartment(B, 'KII'), true);
  assert.equal(Permissions.canRegisterForDepartment(A, 'KII'), false);
  assert.equal(Permissions.canApproveForDepartment(A, 'KII'), true);
});

test('FINAL A decision: oversight can approve/view but cannot become KPI reviewer', () => {
  const users = [A, B, C, STAFF_KI, STAFF_KII, STAFF_KIII, STAFF_CTXH, GD];
  assert.deepEqual(ids(resolveKpiReviewers({ users, delegations: [], owner: STAFF_KII, scopeDepartmentId: 'KII' })), ['B']);
  assert.deepEqual(ids(resolveKpiReviewers({ users, delegations: [], owner: STAFF_KIII, scopeDepartmentId: 'KIII' })), ['C']);
  assert.deepEqual(ids(resolveKpiReviewers({ users, delegations: [], owner: STAFF_KI, scopeDepartmentId: 'KI' })), ['A']);
  assert.deepEqual(ids(resolveKpiReviewers({ users, delegations: [], owner: STAFF_CTXH, scopeDepartmentId: 'CTXH' })), ['A']);
  assert.deepEqual(ids(resolveKpiReviewers({ users, delegations: [], owner: B, scopeDepartmentId: 'KII' })), ['GD']);
});

test('Firestore Rules separate registration approval from KPI scoring authority', () => {
  const reviewRegistration = rules.match(/function canReviewRegistrationRecord\(data\)[\s\S]*?\n    }/)?.[0] || '';
  const confirmScope = rules.match(/function canConfirmOwnerForScope\(ownerId, scopeDepartmentId\)[\s\S]*?\n    }/)?.[0] || '';
  assert.match(reviewRegistration, /hasHeadAuthorityForDepartment\(data\.departmentId\)/);
  assert.match(confirmScope, /profileIsDirectHeadForScope/);
  assert.match(confirmScope, /hasDirectHeadAuthorityForDepartment\(scopeDepartmentId\)/);
  assert.doesNotMatch(confirmScope, /profileHasActingOversight|hasHeadAuthorityForDepartment/);
});

test('Notification Center is per-user, realtime, read-only scoped and best-effort for business writes', () => {
  const service = read('services/user-notification-service.js');
  const app = read('app-v3.js');
  assert.match(service, /"userNotifications",\s*user\.uid,\s*"items"/);
  assert.match(service, /orderBy\("createdAt", "desc"\)/);
  assert.match(service, /notificationRecipientUserIds/);
  assert.match(service, /Promise\.allSettled/);
  assert.match(app, /NotificationCenter\.start\(user\)/);
  assert.match(rules, /match \/userNotifications\/\{recipientUserId\}\/items\/\{notificationId\}/);
  assert.match(rules, /allow read: if activeUser\(\) && request\.auth\.uid == recipientUserId/);
  assert.doesNotMatch(rules.match(/match \/userNotifications[\s\S]*?allow delete: if false;/)?.[0] || '', /allow create: if activeUser\(\);/);
});

test('OneSignal uses one global initialization state and tolerates already-initialized SDK', () => {
  const source = read('onesignal.js');
  assert.match(source, /GLOBAL_STATE_KEY = "__TAN_HIEP_TASK_PUSH_SINGLETON_V1__"/);
  assert.match(source, /state\.initializingPromise/);
  assert.match(source, /already initialized/);
  assert.match(source, /state\.initialized = true/);
});

test('Admin event-driven correction remains soft, audited and preview-blocked', () => {
  const service = read('services/admin-maintenance-service.js');
  assert.match(service, /EVENT_DRIVEN_RESET_ACTION = "REOPEN_REGISTRATION_AS_EVENT_DRIVEN"/);
  assert.match(service, /async eventDrivenResetPreview/);
  assert.match(service, /taskEvidenceFiles/);
  assert.match(service, /taskWorkItems/);
  assert.match(service, /taskEvaluations/);
  assert.match(service, /kpiAdjustments/);
  const block = service.match(/async applyEventDrivenResetBatch[\s\S]*?(?=\n  async correctionPreview)/)?.[0] || '';
  assert.match(block, /status:"HUY"/);
  assert.match(block, /status:"PENDING"/);
  assert.match(block, /deadlineMode:"EVENT_DRIVEN"/);
  assert.match(block, /trackingMode:"ITEMIZED"/);
  assert.doesNotMatch(block, /batch\.delete|deleteDoc/);
});

test('Core scoring and deadline engines keep the verified V1.22.7 baseline hashes', () => {
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

test('Product Catalog XLSX is a valid editable Office package with print settings', async () => {
  const blob = xlsxModule.buildProductCatalogWorkbookBlob({
    periodLabel: 'Quý III/2026', employeeName: 'Nguyễn Văn A', employeePosition: 'Trưởng phòng', departmentName: 'CTXH',
    rows: [{ index:1, title:'Công việc A', outputRequirement:'Kết quả A', deadlineLabel:'Theo từng lượt phát sinh', workTypeLabel:'Thường xuyên', baseScore:10, coefficientLabel:'110%', maximumConvertedScore:11, evidence:'Văn bản' }], exceededCount:1
  });
  const file = await writeBlob(blob, 'xlsx');
  execFileSync('unzip', ['-t', file], { stdio:'ignore' });
  const list = execFileSync('unzip', ['-Z1', file], { encoding:'utf8' });
  assert.match(list, /xl\/workbook\.xml/);
  assert.match(list, /xl\/worksheets\/sheet1\.xml/);
  const sheet = execFileSync('unzip', ['-p', file, 'xl/worksheets/sheet1.xml'], { encoding:'utf8' });
  assert.match(sheet, /orientation="landscape"/);
  assert.match(sheet, /fitToWidth="1"/);
  assert.match(sheet, /Theo từng lượt phát sinh/);
  fs.unlinkSync(file);
});

test('KPI DOCX generator produces a valid editable Office Open XML package', async () => {
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
  const documentXml = execFileSync('unzip', ['-p', file, 'word/document.xml'], { encoding:'utf8' });
  assert.match(documentXml, /BÁO CÁO KPI CÁ NHÂN/);
  assert.match(documentXml, /Họ và tên: Nguyễn Văn A/);
  fs.unlinkSync(file);
});

test('Apps Script Accounts V3.5.0 is data-driven, clears stale acting authority and blocks accidental mass deactivation', () => {
  const source = fs.readFileSync(path.join(releaseRoot, 'deployment/AppsScript_Accounts_V3.5.0.gs'), 'utf8');
  assert.match(source, /VERSION:\s*'3\.5\.0'/);
  assert.match(source, /ACTING_SHEET_NAME:\s*'KIÊM NHIỆM ĐƠN VỊ'/);
  assert.match(source, /actingHeadDepartmentIds/);
  assert.match(source, /actingOversightDepartmentIds/);
  assert.match(source, /applyActingAuthorityToPersonnel_/);
  assert.match(source, /assertNoAccidentalMassDeactivation_/);
  assert.match(source, /Firestore đang có \$\{active\} tài khoản active nhưng Sheet chỉ có \$\{incoming\}/);
  assert.doesNotMatch(source, /Nguyễn Văn A|Nguyễn Văn B|Nguyễn Văn C/);
});
