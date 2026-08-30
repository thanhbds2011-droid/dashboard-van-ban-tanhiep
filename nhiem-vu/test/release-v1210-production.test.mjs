import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const releaseRoot = path.resolve(appRoot, '..');
const deployment = path.join(releaseRoot, 'deployment');
const read = rel => fs.readFileSync(path.join(appRoot, rel), 'utf8');
const readRelease = rel => fs.readFileSync(path.join(releaseRoot, rel), 'utf8');

function section(text, start, end) {
  const a = text.indexOf(start);
  assert.notEqual(a, -1, `missing start ${start}`);
  const b = end ? text.indexOf(end, a + start.length) : text.length;
  return text.slice(a, b === -1 ? text.length : b);
}

function assertBalancedRules(text) {
  const pairs = { '}':'{', ')':'(', ']':'[' };
  const opens = new Set(Object.values(pairs));
  const stack=[];
  let state='code', quote='', line=1;
  for (let i=0;i<text.length;i++) {
    const c=text[i], n=text[i+1]||'';
    if (c==='\n') line++;
    if (state==='line') { if (c==='\n') state='code'; continue; }
    if (state==='block') { if (c==='*' && n==='/') { state='code'; i++; } continue; }
    if (state==='str') { if (c==='\\') { i++; continue; } if (c===quote) state='code'; continue; }
    if (c==='/' && n==='/') { state='line'; i++; continue; }
    if (c==='/' && n==='*') { state='block'; i++; continue; }
    if (c==='"' || c==="'") { state='str'; quote=c; continue; }
    if (opens.has(c)) stack.push([c,line]);
    else if (pairs[c]) { assert.ok(stack.length, `unexpected ${c} at ${line}`); assert.equal(stack.pop()[0], pairs[c], `unbalanced ${c} at ${line}`); }
  }
  assert.deepEqual(stack, []);
}

test('release marker, cache and canonical imports are V1.21.0', () => {
  const ver = read('core/app-version.js');
  assert.match(ver, /APP_VERSION\s*=\s*["']1\.21\.0["']/);
  assert.match(ver, /BUILD_VERSION\s*=\s*["']20260830\.V1_21_0["']/);
  assert.match(ver, /CACHE_NAME\s*=\s*["']nhiem-vu-20260830-v1-21-0["']/);
  assert.match(read('index.html'), /20260830\.V1_21_0/);
  assert.match(read('sw.js'), /20260830\.V1_21_0/);
});

test('all local JS module imports resolve', () => {
  const roots = ['core','modules','services'];
  const files=[];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir,{withFileTypes:true})) {
      const full=path.join(dir,entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(?:js|mjs)$/.test(entry.name)) files.push(full);
    }
  };
  roots.forEach(r=>walk(path.join(appRoot,r)));
  files.push(path.join(appRoot,'app-v3.js'),path.join(appRoot,'ai-assistant.js'),path.join(appRoot,'pwa.js'));
  for (const file of files) {
    const text=fs.readFileSync(file,'utf8');
    for (const m of text.matchAll(/(?:from\s+|import\s*\()\s*["'](\.{1,2}\/[^"']+)["']/g)) {
      const raw=m[1].split('?')[0];
      const target=path.resolve(path.dirname(file),raw);
      assert.ok(fs.existsSync(target), `${path.relative(appRoot,file)} -> ${raw}`);
    }
  }
});

test('DIRECT/GROUPED supports multiple registrations and independent task instances', () => {
  const s=read('services/task-registration-service.js');
  assert.match(s,/function registrationId\(periodId, uid, standardTaskId, personalItemId = ""\)/);
  assert.match(s,/registrationGroupId/);
  assert.match(s,/personalizationMode:\s*groupMode \? "GROUPED" : "DIRECT"/);
  assert.match(s,/personalItemId/);
  assert.match(s,/async rejectMany\(/);
  assert.match(s,/sourceDirectiveId/);
  assert.match(s,/deadlineCeilingDateKey/);
  assert.match(s,/const workType = standardWorkType\(item\.workType\)/);
  assert.match(s,/workType,/);
  assert.match(s,/baseScore:\s*Number\(item\.baseScore/);
  assert.match(s,/difficultyCoefficient:\s*Number\(item\.difficultyCoefficient/);
});

test('Tasks workspace defaults to mine and keeps a separate management workspace', () => {
  const s=read('modules/tasks/tasks-view.js');
  assert.match(s,/data-task-scope="MINE">Nhiệm vụ của tôi/);
  assert.match(s,/data-task-scope="MANAGEMENT">Điều hành Phòng\/Khu/);
  assert.match(s,/return tasks\.filter\(task => String\(task\.ownerUserId \|\| ""\) === uid\)/);
});

test('official scorecard only marks confirmed exceeded work', () => {
  const s=read('modules/kpi/kpi-workflow.js');
  const fn=section(s,'function scorecardExceededLabel','function evidenceCellHtml');
  assert.match(fn,/confirmedExceededRequirement === true \? 'X' : ''/);
  assert.doesNotMatch(fn,/Đề nghị/);
});

test('KPI desktop gets synchronized horizontal scrollbar while mobile remains CSS-controlled', () => {
  const js=read('modules/kpi/kpi-workflow.js');
  const css=read('kpi.css');
  assert.match(js,/function attachSynchronizedHorizontalScroll/);
  assert.match(js,/kpi-scrollbar-top/);
  assert.match(css,/\.kpi-scrollbar-top\{/);
  assert.match(css,/@media\(max-width:720px\).*\.kpi-scrollbar-top\{display:none\}/s);
});

test('Product Catalog prints real task names, concrete date when valid, and signature space', () => {
  const s=read('modules/kpi/kpi-workflow.js');
  const fn=section(s,'async function openProductCatalog','function openDepartmentReport');
  assert.match(fn,/task\.title \|\| task\.standardTaskName/);
  assert.doesNotMatch(fn,/task\.taskCode/);
  const deadline=section(s,'function productCatalogDeadlineLabel','async function openProductCatalog');
  assert.match(deadline,/fixedDeadlineDateKey/);
  assert.match(deadline,/deadlineDateKey/);
  assert.match(deadline,/EVENT_DRIVEN/);
  assert.match(read('kpi.css'),/\.kpi-signature-space\{height:105px\}/);
});

test('review modal removes helper prose but keeps all business validations and atomic batch', () => {
  const s=read('modules/kpi/kpi-workflow.js');
  const fn=section(s,"const root = modal('Xác nhận điểm nhiệm vụ'",'function openCommonCriteria');
  assert.doesNotMatch(fn,/Hệ thống tự tính; người xác nhận không chỉnh sửa/);
  assert.doesNotMatch(fn,/Nếu điều chỉnh khác tự đánh giá, cần nêu căn cứ/);
  assert.doesNotMatch(fn,/Xác nhận một lần/);
  assert.match(fn,/Khi điều chỉnh Kết quả áp dụng khác tự đánh giá phải nhập lý do/);
  assert.match(fn,/Khi không xác nhận công việc vượt yêu cầu phải nhập căn cứ/);
  assert.match(fn,/Khi không chấp thuận điểm thưởng phải nhập lý do/);
  assert.match(fn,/ModalService\.confirm/);
  assert.match(fn,/const scoreBatch = writeBatch\(db\)/);
  assert.match(fn,/scoreBatch\.update\(doc\(db, 'taskEvaluations'/);
  assert.match(fn,/scoreBatch\.update\(doc\(db, 'tasks'/);
  assert.match(fn,/await scoreBatch\.commit\(\)/);
});

test('standard-task web no longer uses arisingEvidence; actual evidence services remain', () => {
  const activeFiles=['app.js','app-v3.js','modules/standard-tasks/standard-tasks-view.js','services/standard-task-write-service.js','services/standard-task-read-service.js'];
  for (const f of activeFiles) assert.doesNotMatch(read(f),/arisingEvidence|standardTaskArisingEvidence|Minh chứng phát sinh/, f);
  assert.ok(fs.existsSync(path.join(appRoot,'services/task-evidence-service.js')));
  assert.ok(fs.existsSync(path.join(appRoot,'services/drive-evidence-service.js')));
  assert.ok(fs.existsSync(path.join(appRoot,'services/task-work-item-service.js')));
  assert.ok(fs.existsSync(path.join(appRoot,'services/task-milestone-service.js')));
});

test('Apps Script V4.8.0 removes Sheet column with backup migration, not Firestore evidence', () => {
  const s=fs.readFileSync(path.join(deployment,'AppsScript_StandardTasks_V4.8.0.gs'),'utf8');
  assert.match(s,/VERSION:\s*'4\.8\.0'/);
  const heads=section(s,'HEADERS: Object.freeze([','DISPLAY_HEADERS: Object.freeze([');
  assert.doesNotMatch(heads,/arisingEvidence/);
  const display=section(s,'DISPLAY_HEADERS: Object.freeze([','LEGACY_DISPLAY_HEADERS:');
  assert.doesNotMatch(display,/Minh chứng phát sinh/);
  assert.match(s,/migrateRemoveArisingEvidenceV480_/);
  assert.match(s,/copyTo\(/);
  assert.match(s,/deleteColumn\(/);
  assert.match(s,/BACKUP_V480/);
});

test('HEAD soft-remove bypasses broad history query; ADMIN alone checks history', () => {
  const s=read('services/standard-task-write-service.js');
  const fn=section(s,'async removeTask(task)','todayKey: dateKey');
  assert.match(fn,/Permissions\.isAdmin\(user\) \? await taskHasHistory\(task\) : true/);
  assert.match(fn,/active:\s*false/);
});

test('standard-task delegation is HEAD-only, scoped, explicit and legacy-normalized', () => {
  const s=read('services/standard-task-write-service.js');
  const fn=section(s,'async saveDelegation','async revokeDelegation');
  assert.match(s,/CREATE_STANDARD_TASKS/);
  assert.match(s,/EDIT_STANDARD_TASKS/);
  assert.match(s,/DELETE_STANDARD_TASKS/);
  assert.match(s,/CREATE_TASKS/);
  assert.match(fn,/merge:\s*false/);
  assert.match(fn,/sameDepartment|departmentId/);
  assert.match(fn,/const readBack = await FirebaseService\.getDoc\(reference\)/);
  assert.match(fn,/const saved = readBack\.data\(\)/);
  const rules=readRelease('firestore.rules');
  const match=section(rules,'match /approvalDelegations/{delegationDocumentId}','match /kpiPlans/');
  assert.match(match,/delegationType == "STANDARD_TASK_EDITOR"/);
  assert.match(match,/isDepartmentHead\(\)/);
  assert.match(match,/sameDepartment\(request\.resource\.data\.departmentId\)/);
});

test('Executive Directive -> KPI conversion is atomic/idempotent and preserves 12-point unexpected semantics', () => {
  const s=read('services/executive-directive-service.js');
  assert.match(s,/function executiveKpiAllowedActor[\s\S]*Permissions\.isDirector\(user\)/);
  assert.doesNotMatch(section(s,'function executiveKpiAllowedActor','function assertExecutiveKpiActor'),/isAdmin/);
  assert.match(read('modules/executive-directives/executive-directives-view.js'),/const canDecideKpi = Permissions\.isDirector\(actor\)/);
  const fn=section(s,'async ensureKpiStandardTask','async cancelDirectiveKpi');
  assert.match(fn,/runTransaction/);
  assert.match(fn,/fresh\.kpiStandardTaskId/);
  assert.match(fn,/workType:\s*"DOT_XUAT"/);
  assert.match(fn,/baseScore:\s*12/);
  assert.match(fn,/difficultyCoefficient:\s*coefficient/);
  assert.match(fn,/fixedDeadlineDateKey:\s*dueDateKey/);
  assert.match(fn,/sourceType:\s*"EXECUTIVE_DIRECTIVE"/);
  assert.match(fn,/sourceDirectiveId:\s*id/);
  assert.match(fn,/sourcePeriodId:\s*periodId/);
  assert.match(fn,/lastExecutiveDirectiveId:\s*id/);
  assert.match(fn,/kpiStandardTaskId:\s*code/);
});

test('Rules provide a narrow executive-directive exception to plan lock, not a blanket bypass', () => {
  const rules=readRelease('firestore.rules');
  assert.match(rules,/function executiveDirectiveKpiRegistrationAllowed\(data\)/);
  assert.match(rules,/get\(standardTaskPath\(data\.standardTaskId\)\)\.data\.sourceType == "EXECUTIVE_DIRECTIVE"/);
  assert.match(rules,/data\.workType == get\(standardTaskPath\(data\.standardTaskId\)\)\.data\.workType/);
  assert.match(rules,/data\.baseScore == get\(standardTaskPath\(data\.standardTaskId\)\)\.data\.baseScore/);
  assert.match(rules,/function registrationPlanOpenOrExecutive\(data\)/);
  assert.match(rules,/registrationPlanOpen\(data\) \|\| executiveDirectiveKpiRegistrationAllowed\(data\)/);
  assert.match(rules,/executiveDirectiveStandardTaskCreateValid/);
  assert.match(rules,/executiveDirectiveSequenceUpdateValid/);
});

test('Admin Correction is reasoned, audited, evidence-preserving and blocks archived periods', () => {
  const s=read('services/admin-maintenance-service.js');
  ['CANCEL_REGISTRATION','REOPEN_REGISTRATION','CANCEL_TASK','REOPEN_TASK','REOPEN_SELF_ASSESSMENT','REOPEN_CONFIRMATION'].forEach(x=>assert.match(s,new RegExp(x)));
  assert.match(s,/periodArchives/);
  assert.match(s,/Kỳ đã lưu trữ chính thức/);
  assert.match(s,/adminCorrectionReason/);
  assert.match(s,/before,/);
  assert.match(s,/after:/);
  assert.match(s,/kpiAuditLogs/);
  assert.doesNotMatch(s,/deleteDoc\(/);
  assert.doesNotMatch(s,/taskEvidenceFiles/);
});

test('ADMIN can reopen only an unarchived completed period for correction', () => {
  const s=read('modules/kpi/kpi-workflow.js');
  const fn=section(s,'async function reopenPeriodForCorrection','async function completePeriodById');
  assert.match(fn,/activeRole\('ADMIN'\)/);
  assert.match(fn,/period\.status !== 'COMPLETED'/);
  assert.match(fn,/periodArchives/);
  assert.match(fn,/archiveSnap\.exists\(\)/);
  assert.match(fn,/reopenedForCorrectionReason/);
  assert.match(fn,/REOPEN_PERIOD_FOR_ADMIN_CORRECTION/);
  const rules=readRelease('firestore.rules');
  assert.match(rules,/resource\.data\.status == "COMPLETED"[\s\S]*request\.resource\.data\.status == "ACTIVE"[\s\S]*!isAdmin\(\) \|\| exists\(periodArchivePath\(periodId\)\)/);
});

test('Rules deployment copy is exact and structurally balanced', () => {
  const root=readRelease('firestore.rules');
  const deployed=fs.readFileSync(path.join(deployment,'firestore.rules'),'utf8');
  assert.equal(deployed,root);
  assert.match(root,/Production Rules V1\.21\.0/);
  assertBalancedRules(root);
});

test('production indexes remain exactly 21 and deployment copy matches', () => {
  const root=JSON.parse(readRelease('firestore.indexes.json'));
  const dep=JSON.parse(fs.readFileSync(path.join(deployment,'firestore.indexes.json'),'utf8'));
  assert.equal(root.indexes.length,21);
  assert.deepEqual(dep,root);
});

test('KPI engine keeps immutable 30/70, 5% per-task bonus and total C cap 7', () => {
  const e=read('kpi-engine.js');
  assert.match(e,/PROGRESS_WEIGHT:\s*0\.30/);
  assert.match(e,/RESULT_WEIGHT:\s*0\.70/);
  assert.match(e,/Math\.min\(Number\(rate \|\| 0\), 0\.05\)/);
  assert.match(e,/Math\.min\(Number\(bonusRaw \|\| 0\), 7\)/);
});

test('executive deadline ceiling is enforced for real work items and by Firestore child rules', () => {
  const w=read('services/task-work-item-service.js');
  assert.match(w,/deadlineCeilingDateKey/);
  assert.match(w,/deadlineDateKey > deadlineCeilingDateKey/);
  const r=readRelease('firestore.rules');
  assert.match(r,/taskChildDeadlineWithinCeiling|deadlineCeilingDateKey/);
});

test('KPI realtime stays scoped and PWA removes old release caches', () => {
  const k=read('modules/kpi/kpi-workflow.js');
  assert.match(k,/subscribeKpiStateCollection\('tasks', 'tasks'\)/);
  assert.match(k,/subscribeKpiStateCollection\('taskRegistrations', 'registrations'\)/);
  assert.match(k,/subscribeKpiStateCollection\('taskEvaluations', 'evaluations'\)/);
  assert.match(k,/onSnapshot\(queryRef/);
  const sw=read('sw.js');
  assert.match(sw,/BUILD_VERSION = "20260830\.V1_21_0"/);
  assert.match(sw,/key\.startsWith\("nhiem-vu-"\) && key !== CACHE_NAME/);
  assert.match(sw,/caches\.delete\(key\)/);
});
