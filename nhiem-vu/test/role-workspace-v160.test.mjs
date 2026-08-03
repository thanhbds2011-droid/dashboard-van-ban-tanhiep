import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const repoRoot = path.resolve(appRoot, '..');
const read = relative => fs.readFileSync(path.resolve(appRoot, relative), 'utf8');
const rules = fs.readFileSync(path.resolve(repoRoot, 'firestore.rules'), 'utf8');
const standardRead = read('services/standard-task-read-service.js');
const standardWrite = read('services/standard-task-write-service.js');
const registration = read('services/task-registration-service.js');
const kpi = read('modules/kpi/kpi-workflow.js');
const detail = read('modules/tasks/task-detail-modal.js');
const tasksView = read('modules/tasks/tasks-view.js');
const dashboard = read('modules/dashboard/dashboard-view.js');
const attendance = read('services/cdtn-attendance-service.js');
const permissions = read('core/permissions.js');


test('STAFF chỉ truy vấn đầu việc cốt lõi, không lấy đầu việc quản lý', () => {
  assert.match(standardRead, /where\("isCoreTaskDefault", "==", true\)/);
  assert.match(standardRead, /where\("isManagementTask", "==", false\)/);
  assert.match(rules, /data\.isCoreTaskDefault == true/);
  assert.match(rules, /data\.isManagementTask != true/);
});

test('Danh mục Phòng\/Khu và Chi đoàn được tách độc lập', () => {
  assert.match(standardRead, /workspaceId\(item/);
  assert.match(standardRead, /=== "CDTN" \? "CDTN"/);
  assert.match(registration, /getWorkspacePlans/);
  assert.match(registration, /organizationId: workspaceId === "CDTN" \? "CDTN" : ""/);
});

test('Trưởng phòng, Ban Giám đốc, Bí thư và Phó Bí thư được duyệt đăng ký của mình ngay', () => {
  assert.match(registration, /Permissions\.isCdtnLeadership\(\)/);
  assert.match(registration, /Permissions\.isDepartmentHead\(user\)/);
  assert.match(registration, /Permissions\.isDirector\(\) && workspaceId === "BGD"/);
  assert.match(registration, /autoApproved: autoApprove/);
  assert.match(permissions, /isCdtnLeadership\(\)/);
  assert.match(rules, /function isCdtnLeadership\(\)/);
});

test('Bí thư và Phó Bí thư ngang quyền ủy quyền duyệt, điểm danh và báo cáo Chi đoàn', () => {
  assert.match(registration, /CDTN_APPROVAL_ACTIVE/);
  assert.match(registration, /Chỉ Bí thư hoặc Phó Bí thư Chi đoàn được ủy quyền duyệt/);
  assert.match(attendance, /CDTN_ATTENDANCE_ACTIVE/);
  assert.match(attendance, /Chỉ Bí thư hoặc Phó Bí thư được ủy quyền điểm danh/);
  assert.match(rules, /isCdtnLeadership\(\)/);
  assert.match(rules, /hasActiveCdtnApprovalDelegation/);
  assert.match(rules, /hasActiveCdtnAttendanceDelegation/);
  assert.match(permissions, /canViewCdtnAggregateReport/);
});

test('Mã thường xuyên và đột xuất dùng hai định dạng chuẩn độc lập', () => {
  assert.match(standardWrite, /`\$\{prefix\}-DX\$\{suffix\}`/);
  assert.match(standardWrite, /`\$\{prefix\}\$\{suffix\}`/);
  assert.match(standardWrite, /LOWEST_AVAILABLE_PER_DEPARTMENT_AND_WORK_TYPE/);
});

test('Chi tiết nhiệm vụ có đủ năm tab nghiệp vụ', () => {
  for (const title of ['Tổng quan', 'Tiến độ', 'Điều chỉnh', 'Đánh giá & KPI', 'Minh chứng & lịch sử']) {
    assert.match(detail, new RegExp(title.replace('&', '\\&')));
  }
});

test('Ban Giám đốc và phạm vi toàn Trung tâm có bộ lọc Phòng\/Khu', () => {
  assert.match(tasksView, /taskDepartmentFilter/);
  assert.match(tasksView, /Toàn Trung tâm/);
  assert.match(dashboard, /dashboardDepartmentFilter/);
  assert.match(dashboard, /dashboardDepartmentBreakdown/);
  assert.match(kpi, /kpiDepartmentScope/);
  assert.match(kpi, /Phạm vi/);
});

test('Xác nhận KPI được thu gọn theo nhân viên và hỗ trợ chọn nhiều nhiệm vụ', () => {
  assert.match(kpi, /data-kpi-review-person/);
  assert.match(kpi, /data-kpi-confirm-check/);
  assert.match(kpi, /batchConfirmEvaluations/);
  assert.match(kpi, /Xác nhận mục đã chọn/);
});

test('Báo cáo và Mẫu 01 lọc chính xác theo Phòng\/Khu hoặc Chi đoàn', () => {
  assert.match(kpi, /normalizeDepartment\(t\.primaryDepartmentId\) === reportDepartmentId/);
  assert.match(kpi, /Báo cáo cá nhân Chi đoàn/);
  assert.match(kpi, /BÁO CÁO CÁ NHÂN – \$\{departmentDisplayName\(reportDepartmentId\)\.toUpperCase\(\)\}/);
  assert.match(kpi, /exportReportCsv\(mine, s, reportDepartmentId\)/);
});

test('Lời chào hiển thị Đồng chí, đơn vị đầy đủ và vai trò kiêm nhiệm', () => {
  assert.match(dashboard, /Đồng chí \$\{escapeHtml\(user\.fullName/);
  assert.match(dashboard, /professionalLine\(user\)/);
  assert.match(dashboard, /Bí thư Chi đoàn/);
  assert.match(dashboard, /Phó Bí thư Chi đoàn/);
});

test('Hồ sơ KPI cá nhân có thể đọc ngay cả khi document chưa tồn tại', () => {
  assert.match(rules, /profileId\.matches\("\^\.\+_" \+ request\.auth\.uid \+ "\$"\)/);
  assert.match(kpi, /profileRequest = getDoc/);
  assert.match(kpi, /tiếp tục tải dữ liệu KPI chính/);
});
