/** Release marker V1.22.1 - UAT authorization fixes + UI refinement. */
import { APP_VERSION, BUILD_VERSION } from "./core/app-version.js?v=20260903.V1_22_1";

window.__NHIEM_VU_RELEASE__ = Object.freeze({
  version: APP_VERSION,
  build: BUILD_VERSION,
  name: "V1.22.1 – UAT Authorization Fixes + UI Refinement",
  previous: "V1.22.0",
  changes: Object.freeze([
    "Bí thư Chi đoàn dùng direct authority trước optional delegation; không bị chặn khi CDTN_APPROVAL_ACTIVE chưa tồn tại.",
    "Ủy quyền nhập Danh mục tạo được document *_STANDARD_TASK_EDITOR ở lần đầu mà không nới Rules.",
    "BCH được Bí thư ủy quyền không bị chặn khi approval batch cần tạo taskMilestones.",
    "Nhiệm vụ Phòng/Khu và Chi đoàn full-width theo chiều dọc, danh sách dài cuộn nội bộ.",
    "KPI toolbar gọn hơn; task code rõ hơn; cột Duyệt không bẻ chữ; modal bỏ nhãn xác nhận/thông báo trùng lặp."
  ])
});
