import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repo = resolve(import.meta.dirname, "../..");
const read = relative => readFileSync(resolve(repo, relative), "utf8");
const service = read("nhiem-vu/services/task-adjustment-service.js");
const panel = read("nhiem-vu/modules/tasks/task-adjustment-panel.js");
const detail = read("nhiem-vu/modules/tasks/task-detail-modal.js");
const tasksView = read("nhiem-vu/modules/tasks/tasks-view.js");
const kpi = read("nhiem-vu/modules/kpi/kpi-workflow.js");
const taskRead = read("nhiem-vu/services/task-read-service.js");
const dashboard = read("nhiem-vu/modules/dashboard/dashboard-view.js");
const rules = read("firestore.rules");
const appsScript = read("deployment/apps-script-notification-ai-archive-v6.2.0.gs");


test("Chi tiết nhiệm vụ gắn bảng điều chỉnh và biểu mẫu STAFF", () => {
  assert.match(detail, /mountTaskAdjustmentPanel/);
  assert.match(detail, /id="taskAdjustmentPanel"/);
  assert.match(panel, /Miễn đánh giá do điều động/);
  assert.match(panel, /DriveEvidenceService\.upload/);
  assert.match(panel, /Gửi đề nghị/);
});


test("Gửi đề nghị là một giao dịch gồm adjustment, task và nhật ký", () => {
  assert.match(service, /const batch = FirebaseService\.writeBatch/);
  assert.match(service, /batch\.set\(reference, payload\)/);
  assert.match(service, /batch\.update\(taskRef\(task\.id\)/);
  assert.match(service, /TASK_ADJUSTMENT_REQUESTED/);
  assert.match(service, /await batch\.commit\(\)/);
});


test("Phê duyệt miễn đánh giá loại nhiệm vụ khỏi A và khóa chấm điểm", () => {
  assert.match(service, /includedInA: false/);
  assert.match(service, /scoringEnabled: false/);
  assert.match(service, /scoringStatus: "ADJUSTMENT_EXEMPT"/);
  assert.match(service, /recognized: false/);
  assert.match(service, /confirmedActualScore: null/);
});


test("Firestore bắt buộc đề nghị và task được ghi cùng giao dịch", () => {
  assert.match(rules, /function validTaskAdjustmentCreate\(adjustmentId, data\)/);
  assert.match(rules, /taskAfter\.pendingAdjustmentId == adjustmentId/);
  assert.match(rules, /taskAfter\.adjustmentStatus == "REQUESTED"/);
  assert.match(rules, /validTaskAdjustmentCreate\(adjustmentId, request\.resource\.data\)/);
});


test("Chỉ người phụ trách gửi và đúng người giao xử lý", () => {
  assert.match(rules, /task\.ownerUserId == request\.auth\.uid/);
  assert.match(rules, /resource\.data\.approverUserId == request\.auth\.uid/);
  assert.match(rules, /request\.resource\.data\.status in \["APPROVED", "REJECTED"\]/);
});


test("Danh sách nhiệm vụ và KPI hiển thị trạng thái điều chỉnh", () => {
  assert.match(tasksView, /Chờ duyệt điều chỉnh/);
  assert.match(tasksView, /Miễn đánh giá/);
  assert.match(kpi, /ADJUSTMENT_EXEMPT/);
  assert.match(kpi, /Miễn đánh giá do điều động/);
  assert.match(kpi, /\['NO_OCCURRENCE_CONFIRMED', 'ADJUSTMENT_EXEMPT'\]/);
});


test("Nhiệm vụ miễn đánh giá không bị thống kê trễ hạn hoặc đang xử lý", () => {
  assert.match(taskRead, /_exempt: exempt/);
  assert.match(taskRead, /!exempt && hoursToDeadline < 0/);
  assert.match(taskRead, /adjustmentPending:/);
  assert.match(taskRead, /exempt:/);
  assert.match(dashboard, /dashboardAdjustmentPending/);
  assert.match(dashboard, /dashboardExempt/);
});


test("Apps Script V6.2.0 gửi thông báo đúng luồng và có người duyệt dự phòng", () => {
  assert.match(appsScript, /V6\.2\.0/);
  assert.match(appsScript, /TASK_ADJUSTMENT_REQUESTED/);
  assert.match(appsScript, /TASK_ADJUSTMENT_APPROVED/);
  assert.match(appsScript, /TASK_ADJUSTMENT_REJECTED/);
  assert.match(appsScript, /task\.adjustmentApproverUserId \|\| task\.assignedByUserId \|\| task\.createdByUserId/);
});


test("Điều chỉnh phạm vi giữ nguyên trạng thái tham gia KPI hiện có", () => {
  assert.match(service, /includedInA: task\.includedInA === true/);
  assert.match(service, /scoringEnabled: task\.scoringEnabled !== false/);
  assert.match(rules, /request\.resource\.data\.includedInA == \(/);
  assert.match(rules, /hasField\(resource\.data, "includedInA"\) \? resource\.data\.includedInA : false/);
  assert.match(rules, /hasField\(resource\.data, "scoringEnabled"\) \? resource\.data\.scoringEnabled : true/);
});


test("Nhiệm vụ đã miễn đánh giá khóa cập nhật lượt và phân công lại trên giao diện", () => {
  assert.match(detail, /const adjustmentExempt = String\(task\.scoringStatus \|\| ""\)\.toUpperCase\(\) === "ADJUSTMENT_EXEMPT"/);
  assert.match(detail, /const mayAssign = canAssign\(task\) && !adjustmentExempt/);
  assert.match(detail, /\["CONFIRMED", "NO_OCCURRENCE_CONFIRMED", "ADJUSTMENT_EXEMPT"\]/);
});


test("Bảng KPI không hiển thị lại điểm cũ của nhiệm vụ đã miễn", () => {
  assert.match(kpi, /exemptFromScoring/);
  assert.match(kpi, /Không áp dụng/);
  assert.match(kpi, /Nhiệm vụ tính KPI/);
});


test("Rules tương thích nhiệm vụ cũ khi trường người duyệt điều chỉnh rỗng", () => {
  assert.match(rules, /\(!hasField\(data, "adjustmentApproverUserId"\) \|\| data\.adjustmentApproverUserId == ""\)/);
  assert.match(rules, /\(!hasField\(task, "adjustmentApproverUserId"\) \|\| task\.adjustmentApproverUserId == ""\)/);
  assert.match(rules, /data\.taskCode == \(hasField\(task, "taskCode"\)[\s\S]*task\.taskCode : ""\)/);
});


test("PWA cache đầy đủ service gửi thông báo của quy trình điều chỉnh", () => {
  const sw = read("nhiem-vu/sw.js");
  assert.match(sw, /services\/task-notification-service\.js\?v=20260802\.V1_6_0/);
});


test("Nhiệm vụ mới và lần phân công mới ghi rõ người phê duyệt điều chỉnh", () => {
  const registrationService = read("nhiem-vu/services/task-registration-service.js");
  const taskWrite = read("nhiem-vu/services/task-write-service.js");
  assert.match(registrationService, /adjustmentApproverUserId: reviewer\.uid/);
  assert.match(taskWrite, /adjustmentApproverUserId: user\.uid/);
  assert.match(rules, /"adjustmentApproverUserId", "adjustmentApproverName"/);
});


test("Rules không cho người phân công chỉ định UID duyệt điều chỉnh tùy ý", () => {
  assert.match(rules, /request\.resource\.data\.adjustmentApproverUserId == request\.auth\.uid/);
  assert.match(rules, /!hasField\(request\.resource\.data, "adjustmentApproverUserId"\)/);
});


test("Rules buộc người phân công là chính tài khoản đang thao tác", () => {
  assert.match(rules, /request\.resource\.data\.assignedByUserId == request\.auth\.uid/);
});
