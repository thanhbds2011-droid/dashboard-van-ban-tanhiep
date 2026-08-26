import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  COMMON_CRITERIA_01A,
  COMMON_CRITERIA_01B,
  calculateBonusScore,
  calculateKpiSummary,
  calculateTaskScore,
  commonCriteriaForProfile,
  reportFormTypeForProfile
} from '../kpi-engine.js';
import { calculateWorkItemSummary } from '../work-item-score-engine.js';
import {
  canReviewKpiOwner,
  leaderLevelOf,
  resolveKpiReviewer
} from '../core/kpi-review-authority.js';

const repo = resolve(import.meta.dirname, '../..');
const read = relative => readFileSync(resolve(repo, relative), 'utf8');
const rules = read('firestore.rules');
const deployRules = read('deployment/firestore.rules');
const indexes = read('firestore.indexes.json');
const deployIndexes = read('deployment/firestore.indexes.json');
const version = read('nhiem-vu/core/app-version.js');
const release = read('nhiem-vu/release-v1.18.3.js');
const indexHtml = read('nhiem-vu/index.html');
const sw = read('nhiem-vu/sw.js');
const pwa = read('nhiem-vu/pwa.js');
const app = read('nhiem-vu/app-v3.js');
const auth = read('nhiem-vu/core/auth-service.js');
const permissions = read('nhiem-vu/core/permissions.js');
const taskRead = read('nhiem-vu/services/task-read-service.js');
const registration = read('nhiem-vu/services/task-registration-service.js');
const workItems = read('nhiem-vu/services/task-work-item-service.js');
const taskWrite = read('nhiem-vu/services/task-write-service.js');
const staged = read('nhiem-vu/services/staged-evidence-uploader.js');
const progressModal = read('nhiem-vu/modules/tasks/task-progress-modal.js');
const detailModal = read('nhiem-vu/modules/tasks/task-detail-modal.js');
const tasksView = read('nhiem-vu/modules/tasks/tasks-view.js');
const kpi = read('nhiem-vu/modules/kpi/kpi-workflow.js');
const accountSync = read('deployment/APPS_SCRIPT_DONG_BO_TAI_KHOAN_V3_4_3.gs');
const standardTasksScript = read('deployment/apps-script-standard-tasks-v4.5.0.gs');
const evidenceScript = read('deployment/apps-script-notification-ai-evidence-v6.5.0.gs');
const reportBlock = kpi.slice(kpi.indexOf('function openReport()'), kpi.indexOf('async function audit('));

const users = [
  { id:'staff', active:true, role:'STAFF', departmentId:'YT', fullName:'Nhân viên YT' },
  { id:'dep', active:true, role:'DEPARTMENT_LEADER', leaderLevel:'DEPUTY', departmentId:'YT', fullName:'Phó YT' },
  { id:'head', active:true, role:'DEPARTMENT_LEADER', leaderLevel:'HEAD', departmentId:'YT', fullName:'Trưởng YT' },
  { id:'dirdep', active:true, role:'DIRECTOR', leaderLevel:'DEPUTY', departmentId:'BGD', position:'Phó Giám đốc', fullName:'Phó Giám đốc' },
  { id:'dirhead', active:true, role:'DIRECTOR', leaderLevel:'HEAD', departmentId:'BGD', position:'Giám đốc', fullName:'Giám đốc' },
  { id:'member', active:true, role:'STAFF', departmentId:'YT', additionalRoles:['CDTN_DOAN_VIEN'], fullName:'Đoàn viên' },
  { id:'bch', active:true, role:'STAFF', departmentId:'TCHC', additionalRoles:['CDTN_UY_VIEN_BCH'], fullName:'Ủy viên BCH' },
  { id:'cddep', active:true, role:'STAFF', departmentId:'CTXH', additionalRoles:['CDTN_PHO_BI_THU'], fullName:'Phó Bí thư' },
  { id:'cdhead', active:true, role:'STAFF', departmentId:'CTXH', additionalRoles:['CDTN_BI_THU'], fullName:'Bí thư' },
  { id:'admin', active:true, role:'ADMIN', departmentId:'TCHC', fullName:'Admin' }
];
const uid = user => user?.id || user?.uid || '';
const review = (owner, scope, delegations=[]) => uid(resolveKpiReviewer({ users, owner, scopeDepartmentId:scope, delegations }));

// 1
test('V1.18.3 dùng version/build/cache tập trung và nạp release đúng', () => {
  assert.match(version, /APP_VERSION = "1\.18\.3"/);
  assert.match(version, /BUILD_VERSION = "20260826\.V1_18_3"/);
  assert.match(version, /CACHE_NAME = "nhiem-vu-20260826-v1-18-3"/);
  assert.match(indexHtml, /window\.__APP_HTML_BUILD__ = "20260826\.V1_18_3"/);
  assert.match(indexHtml, /release-v1\.18\.3\.js\?v=20260826\.V1_18_3/);
  assert.match(release, /V1\.18\.3/);
});

// 2
test('Rules và indexes root/deployment đồng nhất', () => {
  assert.equal(rules, deployRules);
  assert.equal(indexes, deployIndexes);
  const parsed = JSON.parse(indexes);
  assert.ok(Array.isArray(parsed.indexes));
  assert.ok(parsed.indexes.some(x => x.collectionGroup === 'taskWorkItems'));
  assert.ok(parsed.indexes.some(x => x.collectionGroup === 'taskEvidenceFiles'));
});

// 3
test('Session/cache V1.16.1 vẫn được giữ trong V1.18.3', () => {
  assert.match(app, /__APP_HTML_BUILD__/);
  assert.match(app, /BUILD_VERSION/);
  assert.match(pwa, /pageshow/);
  assert.match(pwa, /persisted/);
  assert.match(auth, /UserContext/);
  assert.match(sw, /GET_BUILD_VERSION/);
  assert.match(sw, /clients\.claim\(\)/);
});

// 4
test('Mẫu 01A dành cho DIRECTOR và DEPARTMENT_LEADER; nhân viên dùng 01B', () => {
  assert.equal(reportFormTypeForProfile({role:'DIRECTOR'}), '01A');
  assert.equal(reportFormTypeForProfile({role:'DEPARTMENT_LEADER'}), '01A');
  assert.equal(reportFormTypeForProfile({role:'STAFF', additionalRoles:['CDTN_BI_THU']}), '01B');
});

// 5
test('Mẫu 01A có 17 tiêu chí, đúng 30 điểm và nhóm 2 có bốn tiêu chí', () => {
  assert.equal(COMMON_CRITERIA_01A.length, 17);
  assert.equal(COMMON_CRITERIA_01A.reduce((s,x)=>s+x.max,0), 30);
  assert.deepEqual(COMMON_CRITERIA_01A.filter(x=>x.group==='2').map(x=>x.code), ['2.1','2.2','2.3','2.4']);
  assert.equal(commonCriteriaForProfile({role:'DIRECTOR'}), COMMON_CRITERIA_01A);
});

// 6
test('Mẫu 01B có 16 tiêu chí, đúng 30 điểm và nhóm 2 đúng nội dung file chuẩn', () => {
  assert.equal(COMMON_CRITERIA_01B.length, 16);
  assert.equal(COMMON_CRITERIA_01B.reduce((s,x)=>s+x.max,0), 30);
  assert.deepEqual(COMMON_CRITERIA_01B.filter(x=>x.group==='2').map(x=>[x.code,x.max]), [['2.1',2],['2.2',1],['2.3',1]]);
  assert.match(COMMON_CRITERIA_01B.find(x=>x.code==='1.6').text, /lợi dụng vị trí công tác để trục lợi/);
  assert.doesNotMatch(COMMON_CRITERIA_01B.find(x=>x.code==='1.6').text, /lợi dụng chức vụ, vị trí công tác/);
});

// 7
test('Công thức điểm nhiệm vụ giữ Phụ lục 04: 30% tiến độ + 70% kết quả', () => {
  const s = calculateTaskScore(10,1.1,100,80);
  assert.equal(s.progressRate,100);
  assert.equal(s.resultRate,80);
  assert.equal(s.maximumConvertedScore,11);
  assert.equal(s.convertedActualScore,9.46);
});

// 8
test('Điểm thưởng đúng 5% điểm KPI thực tế đã xác nhận', () => {
  assert.equal(calculateBonusScore(10,0.05),0.5);
  assert.equal(calculateBonusScore(8,0.05),0.4);
  assert.equal(calculateBonusScore(10,0.10),0.5);
});

// 9
test('Điểm C tối đa 7 và tổng A+B+C tối đa 100', () => {
  const result=calculateKpiSummary([
    {active:true,includedInA:true,planApprovalStatus:'APPROVED',maximumConvertedScore:100,recognized:true,confirmedActualScore:100,bonusScore:8}
  ],30);
  assert.equal(result.kpi70,70);
  assert.equal(result.bonusC,7);
  assert.equal(result.totalBeforeCap,107);
  assert.equal(result.total100,100);
});

// 10
test('STAFF do Trưởng phòng xác nhận khi không có ủy quyền', () => {
  assert.equal(review(users[0],'YT'),'head');
});

// 11
test('STAFF do Phó trưởng phòng được ủy quyền xác nhận', () => {
  const d=[{active:true,departmentId:'YT',delegateUserId:'dep',permissions:['CONFIRM_EVALUATIONS']}];
  assert.equal(review(users[0],'YT',d),'dep');
});

// 12
test('Phó trưởng phòng tự chấm bắt buộc Trưởng phòng xác nhận', () => {
  const d=[{active:true,departmentId:'YT',delegateUserId:'dep',permissions:['CONFIRM_EVALUATIONS']}];
  assert.equal(review(users[1],'YT',d),'head');
});

// 13
test('Trưởng phòng tự chấm do Giám đốc xác nhận khi không ủy quyền BGD', () => {
  assert.equal(review(users[2],'YT'),'dirhead');
});

// 14
test('Trưởng phòng tự chấm có thể do Phó Giám đốc được Giám đốc ủy quyền xác nhận', () => {
  const d=[{active:true,departmentId:'BGD',delegateUserId:'dirdep',permissions:['CONFIRM_EVALUATIONS']}];
  assert.equal(review(users[2],'YT',d),'dirdep');
});

// 15
test('Phó Giám đốc tự chấm do Giám đốc xác nhận', () => {
  assert.equal(review(users[3],'BGD'),'dirhead');
});

// 16
test('Giám đốc không được tự duyệt chính mình trong ma trận nội bộ', () => {
  assert.equal(review(users[4],'BGD'),'');
});

// 17
test('Đoàn viên Chi đoàn do Bí thư xác nhận', () => {
  assert.equal(review(users[5],'CDTN'),'cdhead');
});

// 18
test('Ủy viên BCH Chi đoàn do Bí thư xác nhận', () => {
  assert.equal(review(users[6],'CDTN'),'cdhead');
});

// 19
test('Đoàn viên/BCH có thể do Phó Bí thư được Bí thư ủy quyền xác nhận', () => {
  const d=[{active:true,departmentId:'CDTN',delegateUserId:'cddep',permissions:['CONFIRM_EVALUATIONS']}];
  assert.equal(review(users[5],'CDTN',d),'cddep');
  assert.equal(review(users[6],'CDTN',d),'cddep');
});

// 20
test('Phó Bí thư tự chấm bắt buộc Bí thư xác nhận', () => {
  const d=[{active:true,departmentId:'CDTN',delegateUserId:'cddep',permissions:['CONFIRM_EVALUATIONS']}];
  assert.equal(review(users[7],'CDTN',d),'cdhead');
});

// 21
test('Bí thư tự chấm do Giám đốc xác nhận hoặc Phó Giám đốc được ủy quyền', () => {
  assert.equal(review(users[8],'CDTN'),'dirhead');
  const d=[{active:true,departmentId:'BGD',delegateUserId:'dirdep',permissions:['CONFIRM_EVALUATIONS']}];
  assert.equal(review(users[8],'CDTN',d),'dirdep');
});

// 22
test('Không ai được tự xác nhận điểm/điểm thưởng của chính mình', () => {
  assert.equal(canReviewKpiOwner({currentUser:users[2],users,owner:users[2],scopeDepartmentId:'YT'}),false);
  assert.equal(canReviewKpiOwner({currentUser:users[8],users,owner:users[8],scopeDepartmentId:'CDTN'}),false);
  assert.equal(canReviewKpiOwner({currentUser:users[9],users,owner:users[0],scopeDepartmentId:'YT'}),true);
});

// 23
test('Nhận diện Giám đốc/Phó Giám đốc đúng HEAD/DEPUTY', () => {
  assert.equal(leaderLevelOf({role:'DIRECTOR',position:'Giám đốc'}),'HEAD');
  assert.equal(leaderLevelOf({role:'DIRECTOR',position:'Phó Giám đốc'}),'DEPUTY');
});

// 24
test('Rules bắt buộc owner khác reviewer và dùng ma trận canConfirmOwnerForScope', () => {
  assert.match(rules,/function canConfirmOwnerForScope\(ownerId, scopeDepartmentId\)/);
  assert.match(rules,/ownerId != request\.auth\.uid/);
  assert.match(rules,/ownerIsCdtnSecretary\(ownerId\)/);
  assert.match(rules,/isDirectorHead\(\) \|\| hasActiveApprovalDelegation\("BGD", "CONFIRM_EVALUATIONS"\)/);
});

// 25
test('Ủy quyền BGD chỉ cho Phó Giám đốc và giới hạn duyệt đăng ký/xác nhận KPI', () => {
  assert.match(rules,/data\.departmentId == "BGD" && isDirectorDeputyProfile/);
  assert.match(rules,/data\.permissions\.toSet\(\)\.hasOnly\(\["APPROVE_REGISTRATIONS", "CONFIRM_EVALUATIONS"\]\)/);
});

// 26
test('Ủy quyền Chi đoàn chỉ cho Phó Bí thư và giới hạn quyền hợp lệ', () => {
  assert.match(rules,/profileHasAdditionalRole\(get\([^\n]+\)\.data, "CDTN_PHO_BI_THU"\)/);
  assert.match(rules,/data\.permissions\.toSet\(\)\.hasOnly\(\["APPROVE_REGISTRATIONS", "CONFIRM_EVALUATIONS"\]\)/);
});

// 27
test('additionalRoles bị khóa theo accessAccounts ở create/update hồ sơ người dùng', () => {
  assert.match(rules,/request\.resource\.data\.additionalRoles == accessAccount\(\)\.additionalRoles/);
  assert.match(rules,/"teamId", "additionalRoles", "taskNotificationCoordinator"/);
});

// 28
test('Thành viên Chi đoàn thấy task Chi đoàn; Trưởng/Phó đơn vị chủ quản thấy để theo dõi', () => {
  assert.match(rules,/isCdtnScopedData\(data\) && isCdtnMember\(\)/);
  assert.match(rules,/homeDepartmentLeaderCanView\(data\)/);
  assert.match(taskRead,/where\("homeDepartmentId", "==", departmentId\)/);
});

// 29
test('Quyền xem Chi đoàn không đồng nghĩa quyền xác nhận Chi đoàn', () => {
  assert.match(rules,/scopeDepartmentId == "CDTN"[\s\S]*ownerIsCdtnSecretary/);
  assert.doesNotMatch(rules,/scopeDepartmentId == "CDTN"[\s\S]{0,550}isDepartmentLeader\(\)/);
});

// 30
test('Đăng ký Chi đoàn lưu homeDepartmentId và organizationId để báo cáo đơn vị chủ quản', () => {
  assert.match(registration,/homeDepartmentId/);
  assert.match(registration,/organizationId/);
  assert.match(rules,/cdtnOwnerHomeDepartmentValid/);
});

// 31
test('EVENT_DRIVEN có hành động Kết thúc theo dõi trong kỳ và Tạm dừng riêng', () => {
  assert.match(progressModal,/value="KET_THUC_THEO_DOI"/);
  assert.match(progressModal,/statusOption\("TAM_DUNG", "Tạm dừng"/);
  assert.match(progressModal,/TaskWriteService\.endEventDrivenTracking/);
});

// 32
test('Kết thúc EVENT_DRIVEN giữ tiến độ từ lượt thực tế, không ép 100%', () => {
  assert.match(taskWrite,/const progress = Number\(summary\?\.appliedProgressRate/);
  assert.match(taskWrite,/status: "HOAN_THANH",\s*progress,/);
  assert.match(taskWrite,/newProgress: progress/);
  assert.doesNotMatch(taskWrite.slice(taskWrite.indexOf('async endEventDrivenTracking'),taskWrite.indexOf('async requestNoOccurrence')),/progress:\s*100/);
});

// 33
test('EVENT_DRIVEN không cho kết thúc khi chưa có lượt hoặc còn lượt chưa hoàn thành', () => {
  assert.match(taskWrite,/if \(total <= 0\).*Đề nghị Không phát sinh/);
  assert.match(taskWrite,/if \(completed < total\).*lượt chưa hoàn thành/);
});

// 34
test('Sau khi kết thúc EVENT_DRIVEN, service khóa thêm/sửa lượt', () => {
  assert.match(workItems,/function taskIsClosed\(task\)/);
  assert.match(workItems,/task\.eventTrackingClosedAt/);
  assert.match(workItems,/!taskIsClosed\(task\)/);
});

// 35
test('Sau khi kết thúc EVENT_DRIVEN, Firestore Rules khóa create/update/delete work-item', () => {
  assert.match(rules,/function taskOpenForWorkItem\(taskId\)/);
  assert.match(rules,/eventTrackingClosedAt/);
  assert.match(rules,/allow update: if \(isAdmin\(\) \|\| taskOpenForWorkItem\(resource\.data\.taskId\)\)/);
});

// 36
test('Card EVENT_DRIVEN hiển thị đúng Theo dõi/Tạm dừng/Đã kết thúc', () => {
  assert.match(tasksView,/Đã kết thúc theo dõi/);
  assert.match(tasksView,/status === "TAM_DUNG"[\s\S]*Tạm dừng/);
  assert.match(tasksView,/Theo dõi phát sinh/);
});

// 37
test('Tab Tiến độ nhiệm vụ milestone đã hoàn thành có summary read-only, không để trắng', () => {
  assert.match(detailModal,/Tiến độ định kỳ/);
  assert.match(detailModal,/Mốc đã hoàn thành/);
  assert.match(detailModal,/Mốc cuối/);
});

// 38
test('EVENT_DRIVEN tính KPI từ lượt thực tế, bỏ lượt tương lai chưa hoàn thành', () => {
  const summary=calculateWorkItemSummary([
    {active:true,deadlineDateKey:'2026-08-01',completedDateKey:'2026-08-01',progressRate:100,resultRate:100},
    {active:true,deadlineDateKey:'2099-12-31',completedDateKey:'',progressRate:0,resultRate:0}
  ],'GENERIC',{excludeFutureIncomplete:true,asOfDateKey:'2026-08-25'});
  assert.equal(summary.totalRecordedCount,2);
  assert.equal(summary.count,1);
  assert.equal(summary.appliedProgressRate,100);
});

// 39
test('Chọn minh chứng chỉ giữ cục bộ; upload Drive chỉ khi Lưu', () => {
  const addBody=/async addFiles\(fileList\) \{([\s\S]*?)\n  \}/.exec(staged)?.[1]||'';
  assert.match(addBody,/status: "SELECTED"/);
  assert.match(addBody,/Đã chọn · Chưa lưu/);
  assert.doesNotMatch(addBody,/DriveEvidenceService\.upload/);
  assert.match(staged,/async uploadPending\(\)/);
  assert.match(progressModal,/const uploadedFiles = await staged\.uploadPending\(\)/);
});

// 40
test('Lỗi lưu nghiệp vụ rollback file vừa upload; file đã lưu vẫn Trash theo audit', () => {
  assert.match(staged,/async rollbackUncommitted\(\)/);
  assert.match(staged,/DriveEvidenceService\.trash/);
  assert.match(progressModal,/await staged\.rollbackUncommitted\(\)/);
  assert.match(progressModal,/TaskEvidenceService\.remove/);
});

// 41
test('Cá nhân được tự đề nghị điểm thưởng nhưng final bonus vẫn rỗng khi tự chấm', () => {
  assert.match(kpi,/bonusRequested/);
  assert.match(kpi,/bonusRequestType/);
  assert.match(kpi,/bonusRequestReason/);
  assert.match(kpi,/bonusRequestedScore/);
  assert.match(rules,/function bonusRequestValidForSelf\(data\)/);
  assert.match(rules,/finalBonusEmpty\(data\)/);
});

// 42
test('Reviewer đồng ý/từ chối thưởng; từ chối bắt buộc lý do và thưởng lấy confirmedActualScore', () => {
  assert.match(rules,/after\.bonusDecision in \["APPROVED", "REJECTED"\]/);
  assert.match(rules,/after\.bonusDecisionReason\.size\(\) > 0/);
  assert.match(rules,/after\.bonusBasisScore == after\.confirmedActualScore/);
  assert.match(rules,/after\.bonusScore >= \(after\.confirmedActualScore \* 0\.05/);
  assert.match(kpi,/calculateBonusScore\(x\.actual, 0\.05\)/);
});

// 43
test('Xác nhận hàng loạt chỉ dành cho nhiệm vụ không đề nghị thưởng và ghi quyết định NOT_REQUESTED', () => {
  assert.match(kpi,/const canBatch = Boolean\(canOpenReview && !hasBonusRequest\)/);
  assert.match(kpi,/if \(evaluation\.bonusRequested === true\) return null/);
  assert.match(kpi,/bonusDecision: 'NOT_REQUESTED'/);
  assert.match(kpi,/bonusDecisionByUserId: KpiWorkflowState\.user\.uid/);
  assert.match(kpi,/bonusDecisionAt: serverTimestamp\(\)/);
});

// 44
test('Nhiệm vụ có đề nghị thưởng vẫn có nút Mở chi tiết để reviewer quyết định', () => {
  assert.match(kpi,/const canOpenReview = Boolean\(evaluation && canReviewEvaluation/);
  assert.match(kpi,/canOpenReview\s*\? `<button class="kpi-button secondary" data-kpi-review/);
  assert.match(kpi,/⭐ Có đề nghị điểm thưởng/);
});

// 45
test('Điểm chính thức yêu cầu tất cả nhiệm vụ bắt buộc + thưởng đã xử lý + tiêu chí chung official', () => {
  assert.match(kpi,/function taskRequiresOfficialEvaluation\(task = \{\}\)/);
  assert.match(kpi,/taskScores\.every\(item => item\.official && item\.bonusResolved !== false\) && commonScore\.official/);
  assert.match(kpi,/ADJUSTMENT_EXEMPT/);
  assert.match(kpi,/NO_OCCURRENCE_CONFIRMED/);
});

// 46
test('Mẫu 01A/01B in đúng tiêu đề hành chính và không dùng tiêu đề Đảng cũ', () => {
  assert.match(reportBlock,/SỞ Y TẾ<br>THÀNH PHỐ HỒ CHÍ MINH<br>TRUNG TÂM BẢO TRỢ XÃ HỘI TÂN HIỆP/);
  assert.match(reportBlock,/CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM/);
  assert.match(reportBlock,/Độc lập - Tự do - Hạnh phúc/);
  assert.match(reportBlock,/Mẫu 01-A/);
  assert.match(reportBlock,/Mẫu 01-B/);
  assert.doesNotMatch(reportBlock,/ĐẢNG CỘNG SẢN VIỆT NAM/);
});

// 47
test('Mẫu báo cáo có đủ I, A, B, C, II, III và nội dung 6 trục kết quả', () => {
  assert.match(reportBlock,/I\. Tự đánh giá kết quả thực hiện nhiệm vụ/);
  assert.match(reportBlock,/NHÓM TIÊU CHÍ CHUNG \(30 ĐIỂM\)/);
  assert.match(reportBlock,/KẾT QUẢ THỰC HIỆN NHIỆM VỤ ĐƯỢC GIAO \(70 ĐIỂM\)/);
  assert.match(reportBlock,/Tập trung vào các trục kết quả trọng tâm/);
  assert.match(reportBlock,/ĐIỂM THƯỞNG/);
  assert.match(reportBlock,/II\. Tự đề xuất xếp loại mức chất lượng/);
  assert.match(reportBlock,/III\. Nhận xét, đánh giá của cấp có thẩm quyền/);
  assert.match(reportBlock,/XÁC NHẬN CỦA TẬP THỂ LÃNH ĐẠO CƠ QUAN, ĐƠN VỊ/);
});

// 48
test('Mẫu chính thức và bảng điểm xuất kèm không thêm nhãn Chuyên môn/Chi đoàn', () => {
  assert.doesNotMatch(reportBlock,/Chuyên môn/);
  assert.doesNotMatch(reportBlock,/Chi đoàn/);
  assert.doesNotMatch(reportBlock,/<th>Phạm vi<\/th>/);
});

// 49
test('Phần C hiển thị cả đề nghị đang chờ và thưởng đã chấp thuận', () => {
  assert.match(reportBlock,/const pending = score\.bonusRequested === true && score\.bonusDecision === 'PENDING'/);
  assert.match(reportBlock,/score\.official && score\.bonusAwarded && score\.bonusScore > 0/);
  assert.match(reportBlock,/statusText: approved \? 'Đã chấp thuận' : 'Chờ xác nhận'/);
  assert.match(reportBlock,/reportBonusC/);
  assert.match(reportBlock,/Điểm tối đa<br>\(07 điểm\)/);
});

// 50
test('CSV báo cáo không có cột Phạm vi/Chuyên môn/Chi đoàn và dùng C điểm thưởng', () => {
  const csvBlock=kpi.slice(kpi.indexOf('function exportReportCsv'),kpi.indexOf('async function audit('));
  assert.doesNotMatch(csvBlock,/Phạm vi/);
  assert.doesNotMatch(csvBlock,/Chuyên môn|Chi đoàn/);
  assert.match(csvBlock,/C · Điểm thưởng/);
  assert.match(csvBlock,/summaryData\.bonusC/);
});

// 51
test('Apps Script tài khoản V3.4.3 có migration V1.18.3 và phân biệt Giám đốc/Phó Giám đốc', () => {
  assert.match(accountSync,/VERSION: '3\.4\.3'/);
  assert.match(accountSync,/migrateProductionDataV1183/);
  assert.match(accountSync,/role === 'DIRECTOR'/);
  assert.match(accountSync,/leaderLevel: 'DEPUTY'/);
  assert.match(accountSync,/leaderLevel: 'HEAD'/);
});

// 52
test('Không còn nhánh legacy cho Giám đốc tự khóa điểm task của chính mình', () => {
  const manage=/function canManageTaskUpdate\(data, taskId\) \{([\s\S]*?)\n    \}/.exec(rules)?.[1]||'';
  assert.doesNotMatch(manage,/directorSelfScoreUpdateOnly/);
  assert.match(manage,/reviewerTaskScoreUpdateOnly/);
});

// 53
test('Apps Script danh mục chuẩn vẫn V4.5.0 và đủ sáu tần suất', () => {
  assert.match(standardTasksScript,/VERSION: '4\.5\.0'/);
  for (const label of ['Theo ngày','Theo tuần','Theo tháng','Theo quý','Theo năm','Khi phát sinh']) assert.match(standardTasksScript,new RegExp(label));
});

// 54
test('Backend minh chứng giữ V6.5.0, upload và Trash', () => {
  assert.match(evidenceScript,/6\.5\.0/);
  assert.match(evidenceScript,/TRASH_TASK_EVIDENCE/);
});

// 55
test('Kết thúc kỳ bỏ nhiệm vụ Không phát sinh/miễn đánh giá khỏi điều kiện xác nhận cuối', () => {
  assert.match(kpi,/if \(!taskRequiresOfficialEvaluation\(task\)\) return false/);
  assert.match(kpi,/score\.bonusResolved === false/);
});


// 56
test('Sheet quản trị hiển thị vai trò và vai trò Chi đoàn bằng tiếng Việt nhưng giữ mã nội bộ', () => {
  for (const label of ['Quản trị viên','Ban Giám đốc','Lãnh đạo Phòng/Khu','Điều phối Tổ chức - Hành chính','Nhân viên','Bí thư Chi đoàn','Phó Bí thư Chi đoàn','Ủy viên BCH Chi đoàn','Đoàn viên']) {
    assert.match(accountSync, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  }
  assert.match(accountSync,/normalizeSystemRole_/);
  assert.match(accountSync,/normalizeAdditionalRoles_/);
  assert.match(accountSync,/role: \{ stringValue: record\.role \}/);
});

// 57
test('Sheet có cột Quyền phê duyệt tại đơn vị và Phó phụ trách được ánh xạ HEAD', () => {
  assert.match(accountSync,/Quyền phê duyệt tại đơn vị/);
  assert.match(accountSync,/Người đứng đầu\/Phụ trách đơn vị/);
  assert.match(accountSync,/Cấp phó/);
  assert.match(accountSync,/\(quyen truong\|phu trach\)/);
  assert.match(accountSync,/approvalAuthority === 'HEAD'/);
});

// 58
test('Legacy “Phó Trưởng phòng, Phụ trách” được ưu tiên HEAD ở frontend', () => {
  assert.equal(leaderLevelOf({role:'DEPARTMENT_LEADER',position:'Phó Trưởng phòng, Phụ trách Phòng Y tế'}),'HEAD');
});

// 59
test('Phòng không có Trưởng/Phụ trách tự động chuyển reviewer KPI lên Giám đốc', () => {
  const noHeadUsers = users.filter(item => item.id !== 'head');
  const staff = noHeadUsers.find(item => item.id === 'staff');
  const deputy = noHeadUsers.find(item => item.id === 'dep');
  assert.equal(uid(resolveKpiReviewer({users:noHeadUsers,owner:staff,scopeDepartmentId:'YT',delegations:[]})),'dirhead');
  assert.equal(uid(resolveKpiReviewer({users:noHeadUsers,owner:deputy,scopeDepartmentId:'YT',delegations:[]})),'dirhead');
});

// 60
test('Phòng không có Trưởng có thể chuyển reviewer lên Phó Giám đốc được ủy quyền', () => {
  const noHeadUsers = users.filter(item => item.id !== 'head');
  const d=[{active:true,departmentId:'BGD',delegateUserId:'dirdep',permissions:['CONFIRM_EVALUATIONS']}];
  assert.equal(uid(resolveKpiReviewer({users:noHeadUsers,owner:noHeadUsers.find(item=>item.id==='staff'),scopeDepartmentId:'YT',delegations:d})),'dirdep');
});

// 61
test('Rules cho phép fallback Ban Giám đốc ở phòng không có người đứng đầu và vẫn cấm tự duyệt', () => {
  assert.match(rules,/departmentId != "CDTN" && \(isDirectorHead\(\) \|\| hasActiveApprovalDelegation\("BGD", "APPROVE_REGISTRATIONS"\)\)/);
  assert.match(rules,/ownerId != request\.auth\.uid/);
  assert.match(rules,/hasActiveApprovalDelegation\("BGD", "CONFIRM_EVALUATIONS"\)/);
});

// 62
test('Rules milestone owner hỗ trợ DAILY WEEKLY MONTHLY thay vì chỉ MONTHLY', () => {
  assert.match(rules,/ownerRecurringMilestoneUpdateValid/);
  assert.match(rules,/milestoneMode in \["DAILY", "WEEKLY", "MONTHLY"\]/);
  assert.doesNotMatch(rules,/ownerMonthlyMilestoneUpdateValid/);
});

// 63
test('EVENT_DRIVEN close tương thích dữ liệu cũ và cho backfill summary an toàn', () => {
  assert.match(rules,/function ownerEventSummaryValidForClose\(\)/);
  assert.match(rules,/request\.resource\.data\.eventWorkItemCount > 0/);
  assert.match(rules,/request\.resource\.data\.eventCompletedCount == request\.resource\.data\.eventWorkItemCount/);
  assert.match(rules,/!hasField\(resource\.data, "eventWorkItemCount"\)/);
});

// 64
test('Các module production không còn native alert confirm prompt', () => {
  const moduleFiles = [
    'nhiem-vu/modules/kpi/kpi-workflow.js',
    'nhiem-vu/modules/kpi/council-adjustment-ui.js',
    'nhiem-vu/modules/tasks/task-progress-modal.js',
    'nhiem-vu/modules/tasks/task-detail-modal.js',
    'nhiem-vu/modules/standard-tasks/standard-tasks-view.js',
    'nhiem-vu/modules/executive-directives/executive-directives-view.js'
  ];
  for (const file of moduleFiles) {
    const source = read(file);
    assert.doesNotMatch(source,/window\.(alert|confirm|prompt)\s*\(/,file);
    assert.doesNotMatch(source,/(^|[^.\w])(alert|confirm|prompt)\s*\(/m,file);
  }
  assert.match(read('nhiem-vu/core/modal-service.js'),/function alert\(/);
  assert.match(read('nhiem-vu/core/modal-service.js'),/function confirm\(/);
  assert.match(read('nhiem-vu/core/modal-service.js'),/function prompt\(/);
});

// 65
test('Popup kết thúc EVENT_DRIVEN nằm trong ứng dụng và hiển thị tiến độ KPI thực tế', () => {
  assert.match(progressModal,/ModalService\.confirm/);
  assert.match(progressModal,/Kết thúc theo dõi trong kỳ/);
  assert.match(progressModal,/Tiến độ KPI/);
  assert.match(progressModal,/không tự chuyển thành 100%/);
});

// 66
test('Mẫu 01A/01B dùng đúng lưới A:H của file Excel gốc', () => {
  const css=read('nhiem-vu/v3.css');
  assert.match(reportBlock,/<colgroup>[\s\S]*m01-col-a[\s\S]*m01-col-h[\s\S]*<\/colgroup>/);
  assert.match(reportBlock,/Tiêu chí \/ Nội dung<\/td><td class="m01-center">Điểm tối đa/);
  assert.match(reportBlock,/m01-result-axes[\s\S]*<td colspan="4">\$\{esc\(resultAxesText\)\}<\/td>[\s\S]*Điểm tối đa<br>\(70 điểm\)[\s\S]*Ghi chú/);
  assert.match(reportBlock,/m01-task-row[\s\S]*<td colspan="4">/);
  for (const cls of ['a','b','c','d','e','f','g','h']) assert.match(css,new RegExp(`\\.m01-col-${cls}\\{width:`));
  assert.doesNotMatch(css,/\.m01-col-stt\{/);
});

// 67
test('approvalAuthority được đồng bộ và bảo vệ như trường phân quyền', () => {
  assert.match(auth,/approvalAuthority/);
  assert.match(rules,/request\.resource\.data\.approvalAuthority == accessAccount\(\)\.approvalAuthority/);
  assert.match(rules,/"leaderLevel", "approvalAuthority", "isDepartmentHead"/);
});


// 68
test('TỔNG(B) dùng tổng điểm kế hoạch thực tế A, không hard-code 70', () => {
  assert.match(reportBlock,/TỔNG \(B\)[\s\S]*\$\{fmt\(s\.A \|\| 0\)\}/);
  assert.doesNotMatch(reportBlock,/TỔNG \(B\)[\s\S]{0,200}<td class="m01-center">70<\/td>/);
  const example=calculateKpiSummary([
    {active:true,includedInA:true,planApprovalStatus:'APPROVED',maximumConvertedScore:12},
    {active:true,includedInA:true,planApprovalStatus:'APPROVED',maximumConvertedScore:12},
    {active:true,includedInA:true,planApprovalStatus:'APPROVED',maximumConvertedScore:11},
    {active:true,includedInA:true,planApprovalStatus:'APPROVED',maximumConvertedScore:10},
    {active:true,includedInA:true,planApprovalStatus:'APPROVED',maximumConvertedScore:10}
  ],0);
  assert.equal(example.A,55);
});

// 69
test('C đề nghị 7 điểm tự chấm hiển thị tạm tính +0,35 trước xác nhận', () => {
  assert.equal(calculateBonusScore(7,0.05),0.35);
  assert.match(reportBlock,/bonusRequestedScore/);
  assert.match(reportBlock,/Chờ xác nhận/);
});

// 70
test('EVENT_DRIVEN close dùng bounded write recovery và kiểm tra lại server, không chờ vô hạn', () => {
  const recovery=read('nhiem-vu/services/firestore-write-recovery.js');
  assert.match(recovery,/WRITE_CONFIRMATION_TIMEOUT_MS = 15000/);
  assert.match(recovery,/WRITE_VERIFY_READ_TIMEOUT_MS = 5000/);
  assert.match(taskWrite,/confirmWriteWithServerRecovery/);
  assert.match(taskWrite,/eventTrackingClosedOnServer/);
  assert.match(taskWrite,/getDocFromServer/);
});

// 71
test('Migration V1.18.3 backfill cả task cha và taskMilestones legacy', () => {
  assert.match(accountSync,/migrateProductionDataV1183/);
  for (const field of ['milestoneMode','milestoneCount','milestoneCompletedCount','finalMilestoneId','lastCompletedMilestoneId']) assert.match(accountSync,new RegExp(field));
  for (const field of ['sequence','previousMilestoneId','dueDateKey','dueAt']) assert.match(accountSync,new RegExp(field));
  assert.match(accountSync,/collectionName: 'taskMilestones'/);
  assert.match(accountSync,/integerValue: String\(index \+ 1\)/);
  assert.match(accountSync,/integerValue: String\(list\.length\)/);
});

// 72
test('Milestone client dùng finalMilestoneId live và báo rõ nếu chưa migration', () => {
  const milestone=read('nhiem-vu/services/task-milestone-service.js');
  assert.match(milestone,/finalMilestone = clean\(liveTask\.finalMilestoneId\) === milestone\.id/);
  assert.match(milestone,/milestone-schema-repair-required/);
});

// 73
test('firestore.indexes canonical có 21 index và relatedDepartmentIds dùng CONTAINS', () => {
  const parsed=JSON.parse(indexes);
  assert.equal(parsed.indexes.length,21);
  const related=parsed.indexes.find(x=>x.collectionGroup==='tasks' && x.fields.some(f=>f.fieldPath==='relatedDepartmentIds'));
  assert.ok(related);
  assert.equal(related.fields.find(f=>f.fieldPath==='relatedDepartmentIds').arrayConfig,'CONTAINS');
  for (const pair of [
    ['taskMilestones','ownerUserId'],['taskMilestones','departmentId'],['executiveDirectives','updatedAt']
  ]) assert.ok(parsed.indexes.some(x=>x.collectionGroup===pair[0] && x.fields.some(f=>f.fieldPath===pair[1])));
});

// 74
test('Rules production giữ milestone strict; migration sửa legacy thay vì nới owner sửa cấu hình', () => {
  assert.match(rules,/ownerRecurringMilestoneUpdateValid/);
  assert.match(rules,/hasField\(resource\.data, "milestoneCount"\)/);
  assert.match(rules,/V1\.18\.3: migration chuẩn hóa cả task cha \+ taskMilestones legacy/);
});


// 75
test('Cập nhật nhiệm vụ thông thường cũng có watchdog + server re-read, không chỉ EVENT_DRIVEN', () => {
  assert.match(taskWrite,/async updateProgress\(task, changes\)/);
  assert.match(taskWrite,/confirmWriteWithServerRecovery\([\s\S]*batch\.commit\(\)[\s\S]*taskUpdateConfirmedOnServer/);
  assert.match(taskWrite,/getDocFromServer\(taskRef\(taskId\)\)/);
});

// 76
test('Write recovery tự giới hạn cả bước verify server để UI không thể treo vô hạn', () => {
  const recovery=read('nhiem-vu/services/firestore-write-recovery.js');
  assert.match(recovery,/WRITE_CONFIRMATION_TIMEOUT_MS = 15000/);
  assert.match(recovery,/WRITE_VERIFY_ATTEMPTS = 3/);
  assert.match(recovery,/WRITE_VERIFY_READ_TIMEOUT_MS = 5000/);
  assert.match(recovery,/Promise\.race/);
  assert.match(recovery,/write-confirmation-timeout/);
});

// 77
test('Hoàn thành milestone có schema preflight và transaction recovery hữu hạn', () => {
  const milestone=read('nhiem-vu/services/task-milestone-service.js');
  assert.match(milestone,/milestoneSchemaReady/);
  assert.match(milestone,/parentMilestoneSchemaReady/);
  assert.match(milestone,/hasOwn\(milestone, "sequence"\)/);
  assert.match(milestone,/hasOwn\(milestone, "dueAt"\)/);
  assert.match(milestone,/typeof task\.milestoneCount === "number"/);
  assert.match(milestone,/confirmWriteWithServerRecovery/);
  assert.match(milestone,/milestoneCompletionConfirmedOnServer/);
});

// 78
test('Mẫu 01 Phần C giữ tiêu đề đúng mẫu và không chèn số thưởng vào ô tiêu đề', () => {
  assert.match(reportBlock,/Điểm đạt được<br>= Tổng điểm thưởng các công việc<\/td>/);
  assert.doesNotMatch(reportBlock,/Điểm đạt được<br>= Tổng điểm thưởng các công việc<br><strong>\$\{fmt\(reportBonusC\)\}<\/strong>/);
  assert.match(reportBlock,/displayBonus/);
  assert.match(reportBlock,/Chờ xác nhận/);
  assert.match(reportBlock,/reportTotal100/);
});

// 79
test('Apps Script V3.4.3 migration không xóa dữ liệu và chuẩn hóa chuỗi mốc', () => {
  assert.match(accountSync,/VERSION: '3\.4\.3'/);
  assert.match(accountSync,/migrateProductionDataV1183/);
  assert.match(accountSync,/previousMilestoneId: \{ stringValue: index > 0 \? list\[index - 1\]\.id : '' \}/);
  assert.match(accountSync,/dueAt = dueDateKey \? timestampForDateKey/);
  assert.match(accountSync,/Không xóa nhiệm vụ\/mốc, không thay điểm KPI, không yêu cầu người dùng đăng ký lại/);
  assert.doesNotMatch(accountSync,/function migrateProductionDataV1183\([\s\S]*?deleteDocument/);
});

// 80
test('Index executiveDirectives canonical dùng visibleDepartmentIds CONTAINS + updatedAt DESCENDING', () => {
  const parsed=JSON.parse(indexes);
  const idx=parsed.indexes.find(x=>x.collectionGroup==='executiveDirectives' && x.fields.some(f=>f.fieldPath==='visibleDepartmentIds'));
  assert.ok(idx);
  assert.equal(idx.fields.find(f=>f.fieldPath==='visibleDepartmentIds').arrayConfig,'CONTAINS');
  assert.equal(idx.fields.find(f=>f.fieldPath==='updatedAt').order,'DESCENDING');
});
