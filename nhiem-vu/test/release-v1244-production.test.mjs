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
const registrations = read(join(appRoot, 'services/task-registration-service.js'));
const css = read(join(appRoot, 'ui-v1.22.3.css'));
const rules = read(join(firestoreRoot, 'firestore.rules'));

function between(text, start, end) {
  const a = text.indexOf(start);
  assert.ok(a >= 0, `Không tìm thấy start: ${start}`);
  const b = text.indexOf(end, a + start.length);
  assert.ok(b >= 0, `Không tìm thấy end: ${end}`);
  return text.slice(a, b);
}

test('V1.24.4: version/build/cache đồng nhất', () => {
  assert.match(appVersion, /APP_VERSION = "1\.24\.4"/);
  assert.match(appVersion, /BUILD_VERSION = "20260914\.V1_24_4"/);
  assert.match(appVersion, /CACHE_NAME = "nhiem-vu-20260914-v1-24-4"/);
  assert.match(indexHtml, /meta name="app-build" content="20260914\.V1_24_4"/);
  assert.match(indexHtml, /appVersionLabel">V1\.24\.4</);
  assert.match(indexHtml, /release-v1\.24\.4\.js\?v=20260914\.V1_24_4/);
  assert.match(sw, /BUILD_VERSION = "20260914\.V1_24_4"/);
});

test('V1.24.4: runtime deployable không còn build token V1.24.3', () => {
  const files = walk(appRoot).filter(p => !p.includes('/test/') && /\.(js|html|css|webmanifest|mjs)$/.test(p));
  for (const file of files) assert.equal(read(file).includes('20260914.V1_24_3'), false, file);
});

test('Approval detail: bảng 8 cột có Kết quả đầu ra từ snapshot description', () => {
  const block = between(workflow, 'function openPersonPlanDetail(uid)', 'function renderEvaluationDashboard');
  assert.match(block, /<th>Duyệt<\/th><th>Đầu việc<\/th><th>Kết quả đầu ra<\/th><th>Điểm chuẩn<\/th><th>Hệ số độ khó<\/th><th>Điểm tối đa<\/th><th>Trạng thái<\/th><th>Thao tác<\/th>/);
  assert.match(block, /colspan="8"/);
  assert.match(block, /const outputSnapshot = clean\(item\.description\)/);
  assert.match(block, /Chưa ghi kết quả đầu ra/);
  assert.doesNotMatch(block, /outputRequirement/);
});

test('Approval group: trước batch approve cũng hiển thị Kết quả đầu ra snapshot', () => {
  const block = between(workflow, 'function openRegistrationGroup(userId)', 'async function handleRegistrationAction');
  assert.match(block, /const outputSnapshot = clean\(r\.description\)/);
  assert.match(block, /Kết quả đầu ra:/);
  assert.match(block, /Chưa ghi kết quả đầu ra/);
});

test('CDTN realtime: professional scope merge homeDepartmentId cho registrations', () => {
  const block = between(workflow, "if (kind === 'taskRegistrations')", "if (kind === 'taskEvaluations')");
  assert.match(block, /if \(professionalCenterScope\) \{/);
  assert.match(block, /managerMonitoringScope/);
  assert.match(block, /where\('homeDepartmentId','==',managerHomeDepartmentId\)/);
});

test('CDTN realtime: professional scope merge homeDepartmentId cho evaluations', () => {
  const block = between(workflow, "if (kind === 'taskEvaluations')", "if (kind === 'commonCriteriaAssessments')");
  assert.match(block, /if \(professionalCenterScope\) \{/);
  assert.match(block, /managerMonitoringScope/);
  assert.match(block, /where\('homeDepartmentId','==',managerHomeDepartmentId\)/);
});

test('CDTN loadAll fallback: registrations và evaluations cùng reconcile homeDepartmentId', () => {
  const reg = between(workflow, 'const registrationRequest = realtimeBootstrap', 'const evaluationRequest = realtimeBootstrap');
  const ev = between(workflow, 'const evaluationRequest = realtimeBootstrap', 'const commonRequest =');
  for (const block of [reg, ev]) {
    assert.match(block, /professionalCenterScope/);
    assert.match(block, /managerMonitoringScope/);
    assert.match(block, /where\('homeDepartmentId', '==', managerHomeDepartmentId\)/);
    assert.match(block, /mergeAvailableSnapshotRequests/);
  }
});

test('Safe cancel: UI availability không chạy blocker collection queries', () => {
  const block = between(registrations, 'async getApprovedCancellationMap(registrations = [])', 'async cancelApprovedRegistration(registration, reason)');
  assert.match(block, /taskDocumentCancellable\(task, user, registration\)/);
  assert.doesNotMatch(block, /cancellationBlockers\(/);
});

test('Safe cancel: authoritative blocker queries target đúng task và giới hạn 1', () => {
  const block = between(registrations, 'async function cancellationBlockers', 'function cancellationBlockerMessage');
  for (const collection of ['taskWorkItems','taskEvidenceFiles','taskEvaluations','kpiAdjustments']) {
    assert.ok(block.includes(`"${collection}"`), collection);
  }
  assert.ok((block.match(/where\("taskId", "==", taskId\)/g) || []).length >= 4);
  assert.ok((block.match(/FirebaseService\.limit\(1\)/g) || []).length >= 4);
  assert.match(block, /where\("ownerUserId", "==", user\.uid\)/);
  assert.match(block, /where\("userId", "==", user\.uid\)/);
});

test('Safe cancel: acceptedAt vẫn là boundary và commit vẫn revalidate blockers', () => {
  const eligibility = between(registrations, 'function taskDocumentCancellable', 'async function canCancelApprovedOwnRegistration');
  assert.match(eligibility, /emptyTaskField\(task\.acceptedAt\)/);
  assert.match(eligibility, /Number\(task\.progress \|\| 0\) === 0/);
  assert.match(eligibility, /Number\(task\.eventWorkItemCount \|\| 0\) === 0/);
  const cancel = between(registrations, 'async cancelApprovedRegistration(registration, reason)', 'async cancelRegistration');
  assert.match(cancel, /const blockers = await cancellationBlockers\(task, registration, user\)/);
  assert.match(cancel, /status: "CANCELLED"/);
  assert.match(cancel, /status: "HUY"/);
  assert.match(cancel, /includedInA: false/);
  assert.match(cancel, /scoringEnabled: false/);
});

test('Firefox layout: standard-task lists dùng flex vertical, row giữ auto height', () => {
  assert.match(css, /\.standard-task-page \.registration-column-list \{[\s\S]*?display: flex !important;[\s\S]*?flex-direction: column;/);
  assert.match(css, /\.standard-task-page \.registration-column-list > \.registration-row \{[\s\S]*?flex: 0 0 auto;[\s\S]*?height: auto !important;/);
});

test('Approval table CSS: 2 text columns flexible, remaining columns compact/no-wrap', () => {
  assert.match(css, /\.registration-plan-table th:nth-child\(2\),[\s\S]*?th:nth-child\(3\)/);
  assert.match(css, /min-width: 280px;[\s\S]*?width: 30%/);
  assert.match(css, /th:nth-child\(8\)/);
  assert.match(css, /min-width: 155px; width: 155px/);
  assert.match(css, /min-width: 1180px !important/);
});

test('Firestore Rules bytes unchanged from V1.24.3 package', () => {
  assert.equal(sha256(join(firestoreRoot, 'firestore.rules')), '94ccfa98a289ea313e96250145325a9f615a76d0ff657de36c81e0bef0025b0f');
});

test('Scoring Rules still 0/60/80/100', () => {
  assert.match(rules, /function validKpiRate\(value\) \{\s*return value in \[0, 60, 80, 100\];/);
});

test('Reviewer matrix CDTN unchanged: member -> Bí thư, Bí thư -> BGD HEAD', () => {
  const secretary = { id:'sec', uid:'sec', active:true, role:'STAFF', departmentId:'TCHC', additionalRoles:['CDTN_BI_THU'], fullName:'Bí thư' };
  const director = { id:'dir', uid:'dir', active:true, role:'DIRECTOR', departmentId:'BGD', leaderLevel:'HEAD', approvalAuthority:'HEAD', fullName:'Giám đốc' };
  const member = { id:'member', uid:'member', active:true, role:'STAFF', departmentId:'YT', additionalRoles:['CDTN_DOAN_VIEN'], fullName:'Đoàn viên' };
  assert.equal(resolveKpiReviewer({ users:[secretary,director,member], delegations:[], owner:member, scopeDepartmentId:'CDTN' })?.id, 'sec');
  assert.equal(resolveKpiReviewer({ users:[secretary,director], delegations:[], owner:secretary, scopeDepartmentId:'CDTN' })?.id, 'dir');
});

test('Không có private key/service-account JSON trong frontend', () => {
  const joined = walk(appRoot).filter(p => !p.includes('/test/')).map(p => { try { return read(p); } catch { return ''; } }).join('\n');
  assert.equal(joined.includes('-----BEGIN PRIVATE KEY-----'), false);
  assert.equal(/"private_key"\s*:/.test(joined), false);
});
