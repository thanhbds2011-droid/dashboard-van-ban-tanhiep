import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  calculateBonusScore,
  calculateKpiSummary,
  calculateTaskScore,
  progressRateFromDates
} from '../kpi-engine.js';
import {
  canReviewKpiOwner,
  leaderLevelOf,
  resolveKpiReviewer,
  resolveKpiReviewers
} from '../core/kpi-review-authority.js';

const repo = resolve(import.meta.dirname, '../..');
const read = relative => readFileSync(resolve(repo, relative), 'utf8');
const rules = read('firestore.rules');
const deployRules = read('deployment/firestore.rules');
const indexes = JSON.parse(read('firestore.indexes.json'));
const deployIndexes = JSON.parse(read('deployment/firestore.indexes.json'));
const version = read('nhiem-vu/core/app-version.js');
const html = read('nhiem-vu/index.html');
const sw = read('nhiem-vu/sw.js');
const modal = read('nhiem-vu/core/modal-service.js');
const css = read('nhiem-vu/v3.css');
const kpi = read('nhiem-vu/modules/kpi/kpi-workflow.js');
const authority = read('nhiem-vu/core/kpi-review-authority.js');
const permissions = read('nhiem-vu/core/permissions.js');
const registration = read('nhiem-vu/services/task-registration-service.js');
const taskWrite = read('nhiem-vu/services/task-write-service.js');
const taskView = read('nhiem-vu/modules/tasks/tasks-view.js');
const standardWrite = read('nhiem-vu/services/standard-task-write-service.js');
const standardView = read('nhiem-vu/modules/standard-tasks/standard-tasks-view.js');
const standardSync = read('deployment/apps-script-standard-tasks-v4.6.0.gs');
const accountSync = read('deployment/APPS_SCRIPT_DONG_BO_TAI_KHOAN_V3_4_3.gs');

const users = [
  { id:'staff-tchc', active:true, role:'STAFF', departmentId:'TCHC', fullName:'NV TCHC' },
  { id:'dep-tchc', active:true, role:'DEPARTMENT_LEADER', approvalAuthority:'DEPUTY', leaderLevel:'DEPUTY', departmentId:'TCHC', position:'Phó Trưởng phòng', fullName:'Phó TCHC' },
  { id:'head-tchc', active:true, role:'DEPARTMENT_LEADER', approvalAuthority:'HEAD', leaderLevel:'HEAD', departmentId:'TCHC', position:'Trưởng phòng', fullName:'Trưởng TCHC' },
  // YT không có Trưởng: chức danh vẫn là Phó nhưng Danh mục tài khoản cấp Quyền phê duyệt đơn vị.
  { id:'acting-yt', active:true, role:'DEPARTMENT_LEADER', approvalAuthority:'HEAD', leaderLevel:'HEAD', departmentId:'YT', position:'Phó Trưởng phòng', fullName:'Phó phụ trách YT' },
  { id:'staff-yt', active:true, role:'STAFF', departmentId:'YT', fullName:'NV YT' },
  // KHTC có hai Phó: một người giữ quyền đơn vị, một người là cấp phó thông thường.
  { id:'acting-khtc', active:true, role:'DEPARTMENT_LEADER', approvalAuthority:'HEAD', departmentId:'KHTC', position:'Phó Trưởng phòng', fullName:'Phó phụ trách KHTC' },
  { id:'dep-khtc', active:true, role:'DEPARTMENT_LEADER', approvalAuthority:'DEPUTY', departmentId:'KHTC', position:'Phó Trưởng phòng', fullName:'Phó KHTC' },
  { id:'staff-khtc', active:true, role:'STAFF', departmentId:'KHTC', fullName:'NV KHTC' },
  { id:'dir-dep', active:true, role:'DIRECTOR', approvalAuthority:'DEPUTY', leaderLevel:'DEPUTY', departmentId:'BGD', position:'Phó Giám đốc', fullName:'Phó Giám đốc' },
  { id:'dir-head', active:true, role:'DIRECTOR', approvalAuthority:'HEAD', leaderLevel:'HEAD', departmentId:'BGD', position:'Giám đốc', fullName:'Giám đốc' },
  { id:'cd-member', active:true, role:'STAFF', departmentId:'YT', additionalRoles:['CDTN_DOAN_VIEN'], fullName:'Đoàn viên' },
  { id:'cd-dep', active:true, role:'STAFF', departmentId:'CTXH', additionalRoles:['CDTN_PHO_BI_THU'], fullName:'Phó Bí thư' },
  { id:'cd-head', active:true, role:'STAFF', departmentId:'CTXH', additionalRoles:['CDTN_BI_THU'], fullName:'Bí thư' },
  { id:'admin', active:true, role:'ADMIN', departmentId:'TCHC', fullName:'Admin' }
];
const get = id => users.find(x => x.id === id);
const ids = rows => rows.map(x => x.id || x.uid);

// 1
test('V1.19.0 dùng version/build/cache thống nhất', () => {
  assert.match(version, /APP_VERSION = "1\.19\.0"/);
  assert.match(version, /BUILD_VERSION = "20260826\.V1_19_0"/);
  assert.match(version, /CACHE_NAME = "nhiem-vu-20260826-v1-19-0"/);
  assert.match(html, /meta name="app-build" content="20260826\.V1_19_0"/);
  assert.match(html, /window\.__APP_HTML_BUILD__ = "20260826\.V1_19_0"/);
  assert.match(html, /release-v1\.19\.0\.js\?v=20260826\.V1_19_0/);
  assert.match(sw, /BUILD_VERSION = "20260826\.V1_19_0"/);
});

// 2
test('Rules root/deployment và indexes root/deployment đồng nhất', () => {
  assert.equal(rules, deployRules);
  assert.deepEqual(indexes, deployIndexes);
  assert.equal(indexes.indexes.length, 21);
});

// 3
test('approvalAuthority ưu tiên hơn chức danh/leaderLevel legacy', () => {
  assert.equal(leaderLevelOf({ role:'DEPARTMENT_LEADER', position:'Phó Trưởng phòng', leaderLevel:'DEPUTY', approvalAuthority:'HEAD' }), 'HEAD');
  assert.equal(leaderLevelOf({ role:'DEPARTMENT_LEADER', position:'Trưởng phòng', leaderLevel:'HEAD', approvalAuthority:'DEPUTY' }), 'DEPUTY');
});

// 4
test('YT: Phó có Quyền phê duyệt đơn vị xác nhận nhân viên', () => {
  assert.deepEqual(ids(resolveKpiReviewers({ users, owner:get('staff-yt'), scopeDepartmentId:'YT' })), ['acting-yt']);
});

// 5
test('KHTC: Phó thường tự chấm do Phó phụ trách có quyền đơn vị xác nhận', () => {
  assert.deepEqual(ids(resolveKpiReviewers({ users, owner:get('dep-khtc'), scopeDepartmentId:'KHTC' })), ['acting-khtc']);
});

// 6
test('Ủy quyền cho Phó bổ sung quyền, không làm người có quyền gốc mất quyền', () => {
  const delegations = [{ active:true, departmentId:'TCHC', delegateUserId:'dep-tchc', permissions:['CONFIRM_EVALUATIONS'] }];
  assert.deepEqual(ids(resolveKpiReviewers({ users, delegations, owner:get('staff-tchc'), scopeDepartmentId:'TCHC' })), ['dep-tchc','head-tchc']);
  assert.equal(canReviewKpiOwner({ currentUser:get('dep-tchc'), users, delegations, owner:get('staff-tchc'), scopeDepartmentId:'TCHC' }), true);
  assert.equal(canReviewKpiOwner({ currentUser:get('head-tchc'), users, delegations, owner:get('staff-tchc'), scopeDepartmentId:'TCHC' }), true);
});

// 7
test('Phó không được dùng delegation để tự duyệt điểm của chính mình', () => {
  const delegations = [{ active:true, departmentId:'TCHC', delegateUserId:'dep-tchc', permissions:['CONFIRM_EVALUATIONS'] }];
  assert.deepEqual(ids(resolveKpiReviewers({ users, delegations, owner:get('dep-tchc'), scopeDepartmentId:'TCHC' })), ['head-tchc']);
  assert.equal(canReviewKpiOwner({ currentUser:get('dep-tchc'), users, delegations, owner:get('dep-tchc'), scopeDepartmentId:'TCHC' }), false);
});

// 8
test('Người có Quyền phê duyệt đơn vị tự chấm phải chuyển lên BGD', () => {
  assert.deepEqual(ids(resolveKpiReviewers({ users, owner:get('acting-yt'), scopeDepartmentId:'YT' })), ['dir-head']);
});

// 9
test('Phó Giám đốc được ủy quyền bổ sung quyền xác nhận người phụ trách đơn vị', () => {
  const delegations = [{ active:true, departmentId:'BGD', delegateUserId:'dir-dep', permissions:['CONFIRM_EVALUATIONS'] }];
  assert.deepEqual(ids(resolveKpiReviewers({ users, delegations, owner:get('acting-yt'), scopeDepartmentId:'YT' })), ['dir-dep','dir-head']);
});

// 10
test('Phó Giám đốc tự chấm do Giám đốc xác nhận; Giám đốc không tự duyệt mình', () => {
  assert.deepEqual(ids(resolveKpiReviewers({ users, owner:get('dir-dep'), scopeDepartmentId:'BGD' })), ['dir-head']);
  assert.deepEqual(ids(resolveKpiReviewers({ users, owner:get('dir-head'), scopeDepartmentId:'BGD' })), []);
});

// 11
test('Chi đoàn: đoàn viên do Bí thư hoặc Phó Bí thư được ủy quyền xác nhận', () => {
  assert.deepEqual(ids(resolveKpiReviewers({ users, owner:get('cd-member'), scopeDepartmentId:'CDTN' })), ['cd-head']);
  const delegations = [{ active:true, departmentId:'CDTN', delegateUserId:'cd-dep', permissions:['CONFIRM_EVALUATIONS'] }];
  assert.deepEqual(ids(resolveKpiReviewers({ users, delegations, owner:get('cd-member'), scopeDepartmentId:'CDTN' })), ['cd-dep','cd-head']);
});

// 12
test('Chi đoàn: Phó Bí thư tự chấm do Bí thư; Bí thư tự chấm lên BGD', () => {
  assert.deepEqual(ids(resolveKpiReviewers({ users, owner:get('cd-dep'), scopeDepartmentId:'CDTN' })), ['cd-head']);
  assert.deepEqual(ids(resolveKpiReviewers({ users, owner:get('cd-head'), scopeDepartmentId:'CDTN' })), ['dir-head']);
});

// 13
test('TCHC-DX01: 12 điểm, hệ số 110%, tiến độ 60, kết quả 100 => 11.62', () => {
  const score = calculateTaskScore(12, 1.1, 60, 100);
  assert.equal(score.maximumConvertedScore, 13.2);
  assert.equal(score.convertedActualScore, 11.62);
});

// 14
test('Tiến độ KPI giữ đúng thang ngày lịch 100/80/60/0', () => {
  assert.equal(progressRateFromDates('2026-08-24','2026-08-24',true), 100);
  assert.equal(progressRateFromDates('2026-08-24','2026-08-25',true), 80);
  assert.equal(progressRateFromDates('2026-08-24','2026-08-28',true), 60);
  assert.equal(progressRateFromDates('2026-08-24','2026-08-30',true), 0);
});

// 15
test('Điểm thưởng là 5% một lần, kể cả BOTH không thể biến thành 10%', () => {
  assert.equal(calculateBonusScore(11.62, 0.05), 0.58);
  assert.equal(calculateBonusScore(11.62, 0.10), 0.58);
});

// 16
test('Điểm C tối đa 7 và tổng cuối tối đa 100', () => {
  const result = calculateKpiSummary([
    { active:true, includedInA:true, planApprovalStatus:'APPROVED', maximumConvertedScore:100, recognized:true, confirmedActualScore:100, bonusScore:20 }
  ], 30);
  assert.equal(result.bonusC, 7);
  assert.equal(result.total100, 100);
});

// 17
test('EVENT_DRIVEN kết thúc nghiệp vụ 100 nhưng giữ KPI tiến độ/kết quả riêng', () => {
  const block = taskWrite.slice(taskWrite.indexOf('async endEventDrivenTracking'), taskWrite.indexOf('async requestNoOccurrence'));
  assert.match(block, /status:\s*"HOAN_THANH"/);
  assert.match(block, /progress:\s*100/);
  assert.match(block, /eventProgressRate:\s*kpiProgress/);
  assert.match(block, /eventResultRate:\s*resultRate/);
  assert.match(block, /earlyVerifyAfterMs:\s*1500/);
  assert.match(block, /overallTimeoutMs:\s*12000/);
});

// 18
test('Nested confirm luôn nổi trên Task/KPI modal để không treo Đang lưu', () => {
  assert.match(css, /\.modal-overlay\{[^}]*z-index:12000/s);
  assert.match(css, /\.modal-backdrop\{[^}]*z-index:320/s);
  assert.match(modal, /nested-modal-backdrop/);
  assert.match(modal, /\.kpi-modal-backdrop/);
  assert.match(modal, /\.modal-backdrop/);
});

// 19
test('KPI render không gán textContent trực tiếp cho các metric có thể chưa mount', () => {
  assert.match(kpi, /function setTextSafe\(id, value\)/);
  for (const id of ['kpiMetricA','kpiMetricB','kpiMetric70','kpiMetric30','kpiMetric100']) {
    assert.match(kpi, new RegExp(`setTextSafe\\('${id}'`));
  }
});

// 20
test('Authority resolver không hard-code tên các phòng nghiệp vụ', () => {
  assert.doesNotMatch(authority, /scope\s*===\s*["']TCHC["']/);
  assert.doesNotMatch(authority, /scope\s*===\s*["']YT["']/);
  assert.doesNotMatch(authority, /scope\s*===\s*["']KHTC["']/);
  assert.doesNotMatch(authority, /scope\s*===\s*["']CTXH["']/);
});

// 21
test('Permissions dùng approvalAuthority làm nguồn chân lý và ủy quyền CREATE_TASKS riêng', () => {
  assert.match(permissions, /const authority = upper\(user\?\.approvalAuthority\)/);
  assert.match(permissions, /hasUnitApprovalAuthority/);
  assert.match(permissions, /canCreateUnexpectedTask\(hasDelegation = false/);
  assert.match(permissions, /this\.isDepartmentDeputy\(user\) \|\| this\.isStaff\(user\)/);
});

// 22
test('Đăng ký snapshot lưu userApprovalAuthority và auto-approve theo quyền đơn vị', () => {
  assert.match(registration, /userApprovalAuthority:\s*user\.approvalAuthority \|\| ""/);
  assert.match(registration, /Permissions\.isDepartmentHead\(user\)/);
  assert.match(registration, /registrationOwnerIsUnitAuthority/);
});

// 23
test('BGD delegation chỉ xử lý đăng ký của người có quyền đơn vị/BGD, không bypass hồ sơ nhân viên', () => {
  assert.match(registration, /registrationDepartment === "BGD" \|\| registrationOwnerIsUnitAuthority\(item\)/);
});

// 24
test('Ủy quyền danh mục tách độc lập Thêm/Sửa/Xóa và runtime CREATE_TASKS', () => {
  for (const permission of ['CREATE_STANDARD_TASKS','EDIT_STANDARD_TASKS','DELETE_STANDARD_TASKS','CREATE_TASKS']) {
    assert.match(standardWrite, new RegExp(permission));
    assert.match(standardView, new RegExp(permission));
  }
  assert.match(standardWrite, /Permissions\.isDepartmentDeputy\(item\)/);
  assert.match(standardView, /catalogDelegateCreateStandard/);
  assert.match(standardView, /catalogDelegateEditStandard/);
  assert.match(standardView, /catalogDelegateDeleteStandard/);
  assert.match(standardView, /catalogDelegateRuntime/);
});

// 25
test('Task runtime kiểm tra CREATE_TASKS delegation và giới hạn đúng Phòng/Khu', () => {
  assert.match(taskWrite, /hasTaskCreateDelegation/);
  assert.match(taskWrite, /Chỉ được giao nhiệm vụ trong đúng Phòng\/Khu thuộc phạm vi quyền/);
  assert.match(taskWrite, /delegatedTaskCreator && String\(task\?\.createdByUserId/);
  assert.match(taskView, /TaskWriteService\.canCreateUnexpectedTask\(\)/);
});

// 26
test('Rules chặn direct self-create bypass và yêu cầu registration APPROVED trong cùng write', () => {
  assert.match(rules, /function registrationBackedTaskCreateValid\(taskId\)/);
  assert.match(rules, /existsAfter\(taskRegistrationPath/);
  assert.match(rules, /getAfter\(taskRegistrationPath[\s\S]*\.data\.status == "APPROVED"/);
  const createBlock = rules.slice(rules.indexOf('function canCreateTask(taskId)'), rules.indexOf('function taskScopeDepartmentId'));
  assert.doesNotMatch(createBlock, /ownerUserId\s*==\s*request\.auth\.uid/);
});

// 27
test('Rules registration chặn self-approval, trừ auto-approve của đúng người có quyền đơn vị', () => {
  assert.match(rules, /function canReviewRegistrationRecord\(data\)[\s\S]*data\.userId != request\.auth\.uid/);
  assert.match(rules, /function unitAuthorityAutoApprovesOwnRegistration\(\)/);
  assert.match(rules, /hasField\(resource\.data, "autoApproved"\)/);
});

// 28
test('Rules reviewer staff giữ quyền gốc + delegation; người phụ trách tự chấm lên BGD', () => {
  assert.match(rules, /get\(userProfilePath\(ownerId\)\)\.data\.role in \["STAFF", "TCHC_COORDINATOR"\]/);
  assert.match(rules, /\(isDepartmentHead\(\) && sameDepartment/);
  assert.match(rules, /hasActiveApprovalDelegation\(get\(userProfilePath\(ownerId\)\)\.data\.departmentId, "CONFIRM_EVALUATIONS"\)/);
  assert.match(rules, /isHeadProfile\(get\(userProfilePath\(ownerId\)\)\.data\)[\s\S]*isDirectorHead\(\) \|\| hasActiveApprovalDelegation\("BGD", "CONFIRM_EVALUATIONS"\)/);
});

// 29
test('Rules standard delegation giới hạn granular capabilities và target Phó/Nhân viên', () => {
  assert.match(rules, /CREATE_STANDARD_TASKS/);
  assert.match(rules, /EDIT_STANDARD_TASKS/);
  assert.match(rules, /DELETE_STANDARD_TASKS/);
  assert.match(rules, /CREATE_TASKS/);
  assert.match(rules, /function canRemoveStandardTask\(data\)/);
  assert.match(rules, /function standardTaskSoftRemoveOnly\(\)/);
  assert.match(rules, /allow delete: if isAdmin\(\)/);
  assert.match(rules, /get\([^\n]+delegateUserId[^\n]+\)\.data\.role == "STAFF"/);
  assert.match(rules, /isDeputyProfile\(get\([^\n]+delegateUserId/);
});

// 30
test('Apps Script V4.6.0 chặn Sheet cũ ghi đè Firestore mới', () => {
  assert.match(standardSync, /VERSION:\s*'4\.6\.0'/);
  assert.match(standardSync, /conflicts:\s*\[\]/);
  assert.match(standardSync, /firestoreUpdatedAt >= sheetUpdatedAt/);
  assert.match(standardSync, /plan\.conflicts\.length > 0/);
  assert.match(standardSync, /Nhận dữ liệu Firestore về Sheet/);
});

// 31
test('Apps Script tài khoản V3.4.3 đã có Quyền phê duyệt tại đơn vị HEAD/DEPUTY/NONE', () => {
  assert.match(accountSync, /'approvalAuthority'/);
  assert.match(accountSync, /'Quyền phê duyệt tại đơn vị'/);
  assert.match(accountSync, /HEAD:\s*'Người đứng đầu\/Phụ trách đơn vị'/);
  assert.match(accountSync, /DEPUTY:\s*'Cấp phó'/);
  assert.match(accountSync, /leaderLevel:\s*'HEAD'/);
});

// 32
test('Điểm thưởng chỉ thành chính thức khi reviewer quyết định trên confirmedActualScore', () => {
  assert.match(rules, /after\.bonusBasisScore == after\.confirmedActualScore/);
  assert.match(rules, /after\.bonusRate == 0\.05/);
  assert.match(rules, /after\.bonusConfirmedByUserId == request\.auth\.uid/);
  assert.match(kpi, /calculateBonusScore\(x\.actual, bonusRate\)/);
});

// 33
test('Task có bonus request không được batch-confirm mà phải mở chi tiết', () => {
  assert.match(kpi, /const canBatch = Boolean\(canOpenReview && !hasBonusRequest\)/);
  assert.match(kpi, /data-kpi-review=/);
});

// 34
test('Release không thay đổi 21 composite indexes production', () => {
  const groups = new Set(indexes.indexes.map(x => x.collectionGroup));
  for (const required of ['tasks','taskWorkItems','taskMilestones','taskEvidenceFiles','taskEvaluations','taskRegistrations']) {
    assert.ok(groups.has(required), `missing ${required}`);
  }
});

// 35
test('resolveKpiReviewer vẫn trả reviewer chính để lưu routing metadata', () => {
  const delegations = [{ active:true, departmentId:'TCHC', delegateUserId:'dep-tchc', permissions:['CONFIRM_EVALUATIONS'] }];
  assert.equal(resolveKpiReviewer({ users, delegations, owner:get('staff-tchc'), scopeDepartmentId:'TCHC' })?.id, 'dep-tchc');
});

// 36
test('Legacy MANAGE_STANDARD_TASKS chỉ tương thích Create/Edit, không tự cấp Delete', () => {
  assert.match(standardWrite, /Legacy V1\.18\.x:[^\n]*tương thích/i);
  assert.match(standardWrite, /\["CREATE_STANDARD_TASKS", "EDIT_STANDARD_TASKS"\]\.includes\(permission\)/);
  assert.match(rules, /permissionName in \["CREATE_STANDARD_TASKS", "EDIT_STANDARD_TASKS"\]/);
  assert.match(rules, /DELETE_STANDARD_TASKS/);
});

// 37
test('Fallback: đơn vị chưa cấu hình người có Quyền phê duyệt thì KPI chuyển lên BGD', () => {
  const orphanStaff = { id:'orphan', active:true, role:'STAFF', departmentId:'KIV', fullName:'NV KIV' };
  const localUsers = [...users, orphanStaff];
  assert.deepEqual(ids(resolveKpiReviewers({ users:localUsers, owner:orphanStaff, scopeDepartmentId:'KIV' })), ['dir-head']);
  const delegations = [{ active:true, departmentId:'BGD', delegateUserId:'dir-dep', permissions:['CONFIRM_EVALUATIONS'] }];
  assert.deepEqual(ids(resolveKpiReviewers({ users:localUsers, delegations, owner:orphanStaff, scopeDepartmentId:'KIV' })), ['dir-dep','dir-head']);
});


test('Edit capability không thể giả xóa; Delete capability chỉ đi qua soft-remove có audit timestamp', () => {
  assert.match(rules, /function standardTaskNormalUpdateOnly\(\)/);
  assert.match(rules, /function standardTaskNormalUpdateOnly\(\)[\s\S]*?hasAny\(\[[\s\S]*?"active"[\s\S]*?"removedFromCatalogAt"/);
  assert.match(rules, /function standardTaskSoftRemoveOnly\(\)[\s\S]*?removedFromCatalogAt == request\.time[\s\S]*?updatedAt == request\.time[\s\S]*?updatedByUserId == request\.auth\.uid/);
  assert.match(rules, /allow update: if standardTaskNormalUpdateOnly\(\) \|\| standardTaskSoftRemoveOnly\(\)/);
});
