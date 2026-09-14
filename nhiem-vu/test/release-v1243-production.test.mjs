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
const reviewer = read(join(appRoot, 'core/kpi-review-authority.js'));
const rules = read(join(firestoreRoot, 'firestore.rules'));

test('V1.24.3: version/build/cache đồng nhất', () => {
  assert.match(appVersion, /APP_VERSION = "1\.24\.3"/);
  assert.match(appVersion, /BUILD_VERSION = "20260914\.V1_24_3"/);
  assert.match(appVersion, /CACHE_NAME = "nhiem-vu-20260914-v1-24-3"/);
  assert.match(indexHtml, /meta name="app-build" content="20260914\.V1_24_3"/);
  assert.match(indexHtml, /appVersionLabel">V1\.24\.3</);
  assert.match(sw, /BUILD_VERSION = "20260914\.V1_24_3"/);
});

test('V1.24.3: index nạp release marker đúng phiên bản', () => {
  assert.match(indexHtml, /release-v1\.24\.3\.js\?v=20260914\.V1_24_3/);
  assert.ok(read(join(appRoot, 'release-v1.24.3.js')).includes('CDTN Evaluation State Hotfix'));
});

test('V1.24.3: canonical /nhiem-vu không còn build token V1.24.2 trong runtime', () => {
  const files = walk(appRoot).filter(p => !p.includes('/test/') && /\.(js|html|css|webmanifest|mjs)$/.test(p));
  for (const file of files) {
    const text = read(file);
    assert.equal(text.includes('20260914.V1_24_2'), false, file);
  }
});

test('CDTN evaluation state: lãnh đạo Phòng/Khu chính tải cả departmentId và homeDepartmentId', () => {
  assert.match(workflow, /const primaryHomeDepartmentLeaderScope = isLeader\(\)[\s\S]*?departmentId === managerHomeDepartmentId/);
  const evalBlock = workflow.slice(
    workflow.indexOf("if (kind === 'taskEvaluations')"),
    workflow.indexOf("if (kind === 'commonCriteriaAssessments')")
  );
  assert.match(evalBlock, /combinedDepartmentReportScope \|\| primaryHomeDepartmentLeaderScope/);
  assert.match(evalBlock, /where\('departmentId','==',departmentId\)/);
  assert.match(evalBlock, /where\('homeDepartmentId','==',departmentId\)/);
});

test('CDTN registration state: lãnh đạo Phòng/Khu chính tải homeDepartmentId đồng bộ với Rules', () => {
  const regBlock = workflow.slice(
    workflow.indexOf("if (kind === 'taskRegistrations')"),
    workflow.indexOf("if (kind === 'taskEvaluations')")
  );
  assert.match(regBlock, /combinedDepartmentReportScope \|\| primaryHomeDepartmentLeaderScope/);
  assert.match(regBlock, /where\('homeDepartmentId','==',departmentId\)/);
});

test('loadAll fallback dùng cùng scope homeDepartmentId cho taskEvaluations', () => {
  const loadStart = workflow.indexOf('const evaluationRequest = realtimeBootstrap');
  const loadEnd = workflow.indexOf('const commonRequest =', loadStart);
  const block = workflow.slice(loadStart, loadEnd);
  assert.match(block, /combinedDepartmentReportScope \|\| primaryHomeDepartmentLeaderScope/);
  assert.match(block, /where\('homeDepartmentId', '==', departmentId\)/);
});

test('Tự đánh giá có fallback chỉ đọc evaluations của chính UID trong kỳ', () => {
  assert.match(workflow, /async function loadOwnEvaluationForTask/);
  const helper = workflow.slice(
    workflow.indexOf('async function loadOwnEvaluationForTask'),
    workflow.indexOf('function milestonesForTask')
  );
  assert.match(helper, /where\('periodId', '==', periodId\)/);
  assert.match(helper, /where\('ownerUserId', '==', ownerUserId\)/);
  assert.match(helper, /limit\(300\)/);
  assert.doesNotMatch(helper, /where\('departmentId'/);
});

test('openSelfAssessment hydrate evaluation hiện hữu trước khi mở form', () => {
  const block = workflow.slice(
    workflow.indexOf('async function openSelfAssessment'),
    workflow.indexOf('function safeHttpUrl')
  );
  assert.match(block, /let ev = evaluationFor\(taskId\) \|\| null/);
  assert.match(block, /ev = await loadOwnEvaluationForTask\(taskId\)/);
});

test('Tự đánh giá mới CREATE đầy đủ snapshot ITEMIZED và scope canonical', () => {
  const block = workflow.slice(
    workflow.indexOf('const createPayload = {'),
    workflow.indexOf("try {", workflow.indexOf('const createPayload = {'))
  );
  assert.match(block, /periodId: KpiWorkflowState\.period\.id/);
  assert.match(block, /taskId: task\.id/);
  assert.match(block, /departmentId: evaluationDepartmentId/);
  assert.match(block, /homeDepartmentId: evaluationHomeDepartmentId/);
  assert.match(block, /trackingMode: itemized \? 'ITEMIZED' : 'FINAL_OUTPUT'/);
  assert.match(block, /actualWorkItemCount/);
  assert.match(block, /if \(evaluationScope === 'CDTN'\) createPayload\.organizationId = 'CDTN'/);
});

test('Tự đánh giá hiện hữu UPDATE hẹp, không ghi lại scope/createdAt/tracking snapshot', () => {
  const updateStart = workflow.indexOf("if (ev.id) {", workflow.indexOf('const createPayload = {'));
  const updateEnd = workflow.indexOf('} catch (error) {', updateStart);
  const block = workflow.slice(updateStart, updateEnd);
  assert.match(block, /updateDoc\(doc\(db, 'taskEvaluations', ev\.id\), selfAssessmentFields\)/);
  assert.doesNotMatch(block, /setDoc\(doc\(db, 'taskEvaluations', ev\.id\)/);
  const fieldsStart = workflow.indexOf('const selfAssessmentFields = {');
  const fieldsEnd = workflow.indexOf('const evaluationId =', fieldsStart);
  const fields = workflow.slice(fieldsStart, fieldsEnd);
  for (const forbidden of [
    'periodId:', 'taskId:', 'ownerUserId:', 'departmentId:', 'homeDepartmentId:',
    'organizationId:', 'trackingMode:', 'actualWorkItemCount:', 'actualCompletedCount:',
    'actualOnTimeCount:', 'actualQualifiedCount:', 'actualProgressRate:', 'actualResultRate:',
    'createdAt:'
  ]) {
    assert.equal(fields.includes(forbidden), false, forbidden);
  }
});

test('Sau ghi tự đánh giá, state cá nhân được refresh có mục tiêu', () => {
  assert.match(workflow, /loadOwnEvaluationForTask\(task\.id, \{ force:true \}\)/);
});


test('UPDATE selfAssessmentFields là tập con của whitelist ownerEvaluationUpdateOnly', () => {
  const allowed = rules.slice(
    rules.indexOf('function ownerEvaluationUpdateOnly()'),
    rules.indexOf('function reviewerEvaluationUpdateOnly')
  );
  const updateKeys = [
    'progressCalculationMode','progressMilestoneDueCount','progressMilestoneAverageRate','progressCalculatedAt',
    'selfProgressRate','selfResultRate','selfExecutionScore','selfActualScore','selfComment',
    'confirmedProgressRate','confirmedResultRate','confirmedExecutionScore','confirmedActualScore',
    'reviewerEmail','reviewerUserId','reviewerName',
    'isExceededRequirement','exceededRequirementDescription','confirmedExceededRequirement',
    'exceededDecision','exceededDecisionReason','exceededDecisionByUserId','exceededDecisionByName','exceededDecisionAt',
    'bonusRequested','bonusRequestType','bonusRequestReason','bonusRequestRate','bonusRequestedBasisScore',
    'bonusRequestedScore','bonusRequestedAt','bonusDecision','bonusDecisionReason','bonusDecisionByUserId',
    'bonusDecisionByName','bonusDecisionAt','bonusAwarded','bonusType','bonusRate','bonusBasisScore','bonusScore',
    'bonusConfirmedByUserId','bonusConfirmedByName','bonusConfirmedAt',
    'ownerLeaderLevel','ownerAdditionalRoles','status','formulaVersion','updatedAt'
  ];
  for (const key of updateKeys) {
    assert.ok(allowed.includes(`"${key}"`), `Rules whitelist thiếu ${key}`);
  }
});

test('Rules giữ nguyên: member CDTN + homeDepartmentId + organizationId vẫn bắt buộc khi create', () => {
  assert.match(rules, /request\.resource\.data\.departmentId == "CDTN"[\s\S]*?isCdtnMember\(\)[\s\S]*?homeDepartmentId[\s\S]*?organizationId[\s\S]*?== "CDTN"/);
});

test('Rules giữ nguyên whitelist owner update; hotfix không nới Rules', () => {
  assert.match(rules, /function ownerEvaluationUpdateOnly\(\)/);
  assert.match(rules, /request\.resource\.data\.departmentId == resource\.data\.departmentId/);
  assert.match(rules, /affectedKeys\(\)\.hasOnly/);
  assert.equal(sha256(join(firestoreRoot, 'firestore.rules')), '94ccfa98a289ea313e96250145325a9f615a76d0ff657de36c81e0bef0025b0f');
});

test('Scoring rate Rules vẫn 0/60/80/100', () => {
  assert.match(rules, /function validKpiRate\(value\) \{\s*return value in \[0, 60, 80, 100\];/);
});

test('KPI workflow vẫn giữ EVENT_DRIVEN + ITEMIZED + milestone + audit', () => {
  assert.match(workflow, /TaskWorkItemService\.calculateSummary/);
  assert.match(workflow, /calculateMilestoneProgress/);
  assert.match(workflow, /audit\('SUBMIT_SELF_ASSESSMENT'/);
});

test('Reviewer matrix CDTN không đổi: thành viên -> Bí thư, Bí thư -> BGD HEAD', () => {
  const secretary = { id:'sec', uid:'sec', active:true, role:'STAFF', departmentId:'TCHC', additionalRoles:['CDTN_BI_THU'], fullName:'Bí thư' };
  const director = { id:'dir', uid:'dir', active:true, role:'DIRECTOR', departmentId:'BGD', leaderLevel:'HEAD', approvalAuthority:'HEAD', fullName:'Giám đốc' };
  const member = { id:'member', uid:'member', active:true, role:'STAFF', departmentId:'YT', additionalRoles:['CDTN_DOAN_VIEN'], fullName:'Đoàn viên' };
  assert.equal(resolveKpiReviewer({ users:[secretary,director,member], delegations:[], owner:member, scopeDepartmentId:'CDTN' })?.id, 'sec');
  assert.equal(resolveKpiReviewer({ users:[secretary,director], delegations:[], owner:secretary, scopeDepartmentId:'CDTN' })?.id, 'dir');
});

test('Không có private key/service-account JSON trong canonical frontend', () => {
  const files = walk(appRoot).filter(p => !p.includes('/test/'));
  const joined = files.map(p => {
    try { return read(p); } catch { return ''; }
  }).join('\n');
  assert.equal(joined.includes('-----BEGIN PRIVATE KEY-----'), false);
  assert.equal(/"private_key"\s*:/.test(joined), false);
});
