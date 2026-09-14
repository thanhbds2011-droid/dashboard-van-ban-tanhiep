import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { resolveKpiReviewer } from '../core/kpi-review-authority.js';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const repoRoot = resolve(appRoot, '..');
const packageRoot = resolve(repoRoot, '../..');
const backendRoot = join(packageRoot, 'backend');
const firestoreRoot = join(packageRoot, 'firestore');
const read = p => readFileSync(p, 'utf8');
const sha256 = p => createHash('sha256').update(readFileSync(p)).digest('hex');
const walk = dir => readdirSync(dir).flatMap(name => {
  const p = join(dir, name);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

const appVersion = read(join(appRoot, 'core/app-version.js'));
const indexHtml = read(join(appRoot, 'index.html'));
const sw = read(join(appRoot, 'sw.js'));
const workflow = read(join(appRoot, 'modules/kpi/kpi-workflow.js'));
const permissions = read(join(appRoot, 'core/permissions.js'));
const reviewer = read(join(appRoot, 'core/kpi-review-authority.js'));
const rules = read(join(firestoreRoot, 'firestore.rules'));
const accounts = read(join(backendRoot, 'AppsScript_Accounts_V3.6.3_CDTN_EVAL_REPAIR_QUOTA_SAFE_FINAL.gs'));

// Release identity / import graph

test('V1.24.2: version/build/cache đồng nhất', () => {
  assert.match(appVersion, /APP_VERSION = "1\.24\.2"/);
  assert.match(appVersion, /BUILD_VERSION = "20260914\.V1_24_2"/);
  assert.match(appVersion, /CACHE_NAME = "nhiem-vu-20260914-v1-24-2"/);
  assert.match(indexHtml, /meta name="app-build" content="20260914\.V1_24_2"/);
  assert.match(indexHtml, /appVersionLabel">V1\.24\.2</);
  assert.match(sw, /BUILD_VERSION = "20260914\.V1_24_2"/);
});

test('V1.24.2: index nạp release marker đúng phiên bản', () => {
  assert.match(indexHtml, /release-v1\.24\.2\.js\?v=20260914\.V1_24_2/);
  assert.ok(read(join(appRoot, 'release-v1.24.2.js')).includes('Release Integrity / CDTN Evaluation Fix'));
});

test('V1.24.2: canonical /nhiem-vu không còn build token V1.23.2/V1.24.1', () => {
  const files = walk(appRoot).filter(p => !p.includes('/test/') && /\.(js|html|css|webmanifest|mjs)$/.test(p));
  for (const file of files) {
    const text = read(file);
    assert.equal(text.includes('20260913.V1_23_2'), false, file);
    assert.equal(text.includes('20260914.V1_24_1'), false, file);
  }
});

// CDTN self-assessment regression

test('CDTN self assessment: scope được canonical về departmentId=CDTN', () => {
  assert.match(workflow, /const evaluationDepartmentId = evaluationScope === 'CDTN'[\s\S]*?\? 'CDTN'/);
  assert.match(workflow, /departmentId: evaluationDepartmentId/);
  assert.match(workflow, /if \(evaluationScope === 'CDTN'\) evaluationPayload\.organizationId = 'CDTN'/);
});

test('CDTN self assessment: không kế thừa departmentId legacy sai scope', () => {
  assert.match(workflow, /ev\.id && existingEvaluationDepartmentId !== 'CDTN'/);
  assert.match(workflow, /V1\.24\.2 - Sửa scope tự đánh giá Chi đoàn/);
});

test('CDTN self assessment: yêu cầu membership trước create mới', () => {
  assert.match(workflow, /evaluationScope === 'CDTN' && !Permissions\.isCdtnMember\(\)/);
  assert.match(permissions, /isCdtnMember\(user = UserContext\.getUser\(\)\)/);
  for (const role of ['CDTN_BI_THU','CDTN_PHO_BI_THU','CDTN_UY_VIEN_BCH','CDTN_DOAN_VIEN']) {
    assert.ok(permissions.includes(role), role);
  }
});

test('CDTN self assessment: homeDepartmentId mới lấy từ Phòng/Khu chính', () => {
  assert.match(workflow, /evaluationHomeDepartmentId = existingEvaluationHomeDepartmentId[\s\S]*?evaluationScope === 'CDTN'[\s\S]*?profileDepartmentId\(\)/);
  assert.match(workflow, /evaluationPayload\.homeDepartmentId = evaluationHomeDepartmentId/);
});

test('CDTN self assessment: deterministic evaluation id không đổi', () => {
  assert.match(workflow, /doc\(db, 'taskEvaluations', `\$\{KpiWorkflowState\.period\.id\}_\$\{task\.id\}`\)/);
});

test('CDTN reviewer matrix frontend vẫn dùng resolveKpiReviewer theo task scope', () => {
  assert.match(workflow, /resolveKpiReviewer\([\s\S]*?scopeDepartmentId: task \? taskScopeDepartmentId\(task\)/);
  assert.match(reviewer, /CDTN_BI_THU/);
  assert.match(reviewer, /CDTN_PHO_BI_THU/);
});

// Rules unchanged + business invariant

test('Firestore Rules V1.24.1 reference giữ nguyên hash baseline supplied package', () => {
  assert.equal(sha256(join(firestoreRoot, 'firestore.rules')), '94ccfa98a289ea313e96250145325a9f615a76d0ff657de36c81e0bef0025b0f');
});

test('Firestore indexes giữ nguyên 21-index baseline hash; do not deploy', () => {
  assert.equal(sha256(join(firestoreRoot, 'firestore.indexes.production-21.DO-NOT-DEPLOY.json')), 'aeb705e769f26850ab1a08ae05680f3aada13f7c4482b0e3aa866c0ea7a31953');
  const data = JSON.parse(read(join(firestoreRoot, 'firestore.indexes.production-21.DO-NOT-DEPLOY.json')));
  assert.equal(Array.isArray(data.indexes) ? data.indexes.length : -1, 21);
});

test('Rules: create taskEvaluations CDTN vẫn yêu cầu member + home dept + organizationId', () => {
  assert.match(rules, /request\.resource\.data\.departmentId == "CDTN"[\s\S]*?isCdtnMember\(\)[\s\S]*?homeDepartmentId[\s\S]*?organizationId[\s\S]*?== "CDTN"/);
});

test('Rules: owner update vẫn không được tự đổi departmentId', () => {
  assert.match(rules, /request\.resource\.data\.departmentId == resource\.data\.departmentId/);
});

test('Rules: scoring rate vẫn chỉ 0\/60\/80\/100', () => {
  assert.match(rules, /function validKpiRate\(value\) \{\s*return value in \[0, 60, 80, 100\];/);
});

// Accounts 3.6.3 maintenance / rollback

test('Accounts V3.6.3 giữ DELTA schema và thêm maintenance CDTN ngoài routine', () => {
  assert.match(accounts, /VERSION: '3\.6\.3'/);
  assert.match(accounts, /DELTA_SCHEMA_VERSION: '1'/);
  assert.match(accounts, /diagnoseCdtnEvaluationScopeV1242/);
  assert.match(accounts, /repairCdtnEvaluationScopeV1242/);
  assert.match(accounts, /rollbackCdtnEvaluationScopeV1242/);
});

test('Accounts V3.6.3 repair chỉ sửa metadata scope taskEvaluations', () => {
  assert.match(accounts, /fields\.departmentId = \{ stringValue: 'CDTN' \}/);
  assert.match(accounts, /fields\.organizationId = \{ stringValue: 'CDTN' \}/);
  assert.match(accounts, /fields\.homeDepartmentId = \{ stringValue: expectedHomeDepartmentId \}/);
  assert.equal(/fields\.(selfActualScore|confirmedActualScore|status|scoreLocked)\s*=/.test(accounts), false);
});

test('Accounts V3.6.3 repair có audit backup trước/đồng transaction', () => {
  assert.match(accounts, /kpiAuditLogs/);
  assert.match(accounts, /previousDepartmentIdPresent/);
  assert.match(accounts, /previousOrganizationIdPresent/);
  assert.match(accounts, /previousHomeDepartmentIdPresent/);
  assert.match(accounts, /status: \{ stringValue: 'APPLIED' \}/);
});

test('Accounts V3.6.3 rollback chặn khi evaluation đã cập nhật sau repair', () => {
  assert.match(accounts, /updatedAtMs > repairedAtMs/);
  assert.match(accounts, /KHÔNG rollback tự động/);
  assert.match(accounts, /status: \{ stringValue: 'ROLLED_BACK' \}/);
});

test('Accounts V3.6.3 maintenance không được gọi từ syncPersonnelToFirestore routine', () => {
  const routineStart = accounts.indexOf('function syncPersonnelToFirestore()');
  assert.notEqual(routineStart, -1);
  const nextFn = accounts.indexOf('\nfunction ', routineStart + 30);
  const routine = accounts.slice(routineStart, nextFn > 0 ? nextFn : routineStart + 15000);
  assert.equal(routine.includes('repairCdtnEvaluationScopeV1242'), false);
  assert.equal(routine.includes('diagnoseCdtnEvaluationScopeV1242'), false);
});

test('Notifications Off vẫn không tái bật taskPushSubscriptions trong Accounts current build', () => {
  // Tên có thể xuất hiện trong comment lịch sử; không được có Firestore operation collectionName/URL tới collection này.
  assert.equal(/collectionName:\s*['"]taskPushSubscriptions['"]/.test(accounts), false);
  assert.equal(/\/taskPushSubscriptions\//.test(accounts), false);
});

// Runtime features preserved

test('KPI workflow vẫn giữ EVENT_DRIVEN + ITEMIZED + work item summary', () => {
  assert.match(workflow, /deadlineMode \|\| ''\)\.toUpperCase\(\) === 'EVENT_DRIVEN'/);
  assert.match(workflow, /trackingMode \|\| 'FINAL_OUTPUT'\)\.toUpperCase\(\) === 'ITEMIZED'/);
  assert.match(workflow, /TaskWorkItemService\.calculateSummary/);
});

test('KPI workflow vẫn giữ milestone auto-progress', () => {
  assert.match(workflow, /calculateMilestoneProgress/);
  assert.match(workflow, /progressCalculationMode: recurring \? 'MILESTONE_AUTO'/);
});

test('KPI workflow vẫn giữ audit SUBMIT_SELF_ASSESSMENT', () => {
  assert.match(workflow, /audit\('SUBMIT_SELF_ASSESSMENT'/);
});

test('Không có private key/service-account JSON trong canonical frontend', () => {
  const files = walk(appRoot).filter(p => !p.includes('/test/'));
  const joined = files.map(p => {
    try { return read(p); } catch { return ''; }
  }).join('\n');
  assert.equal(joined.includes('-----BEGIN PRIVATE KEY-----'), false);
  assert.equal(/"private_key"\s*:/.test(joined), false);
});


test('CDTN reviewer matrix functional: Đoàn viên/BCH/Phó Bí thư -> Bí thư', () => {
  const secretary = { id:'sec', uid:'sec', active:true, role:'STAFF', departmentId:'TCHC', additionalRoles:['CDTN_BI_THU'], fullName:'Bí thư' };
  const director = { id:'dir', uid:'dir', active:true, role:'DIRECTOR', departmentId:'BGD', leaderLevel:'HEAD', approvalAuthority:'HEAD', fullName:'Giám đốc' };
  const users = [secretary, director];
  for (const [id, role] of [['member','CDTN_DOAN_VIEN'], ['bch','CDTN_UY_VIEN_BCH'], ['deputy','CDTN_PHO_BI_THU']]) {
    const owner = { id, uid:id, active:true, role:'STAFF', departmentId:'YT', additionalRoles:[role], fullName:id };
    const reviewerResolved = resolveKpiReviewer({ users:[...users, owner], delegations:[], owner, scopeDepartmentId:'CDTN' });
    assert.equal(reviewerResolved?.id, 'sec', role);
  }
});

test('CDTN reviewer matrix functional: Bí thư tự đánh giá -> BGD HEAD', () => {
  const secretary = { id:'sec', uid:'sec', active:true, role:'STAFF', departmentId:'TCHC', additionalRoles:['CDTN_BI_THU'], fullName:'Bí thư' };
  const director = { id:'dir', uid:'dir', active:true, role:'DIRECTOR', departmentId:'BGD', leaderLevel:'HEAD', approvalAuthority:'HEAD', fullName:'Giám đốc' };
  const reviewerResolved = resolveKpiReviewer({ users:[secretary, director], delegations:[], owner:secretary, scopeDepartmentId:'CDTN' });
  assert.equal(reviewerResolved?.id, 'dir');
});
