/** Release marker V1.21.1 - Production UAT Hotfix. */
import { APP_VERSION, BUILD_VERSION } from "./core/app-version.js?v=20260901.V1_21_1";

export const RELEASE_V1211 = Object.freeze({
  version: APP_VERSION,
  build: BUILD_VERSION,
  name: "V1.21.1 – Production UAT Hotfix",
  changes: Object.freeze([
    "Bảng KPI đánh dấu X ngay khi cá nhân đề nghị vượt yêu cầu; điều kiện 30% vẫn chỉ tính kết quả đã xác nhận.",
    "Khắc phục ủy quyền nhập danh mục bằng cách chuẩn hóa UID và thẩm quyền Trưởng/Phụ trách trước khi ghi.",
    "Khắc phục Chỉ đạo Ban Giám đốc đưa vào KPI do gọi sai API đọc kỳ hiện hành.",
    "Khắc phục màn hình Quản trị không tải do lỗi cú pháp module Admin Maintenance.",
    "Tách quyền hệ thống ADMIN khỏi vị trí nghiệp vụ KPI để xác nhận đúng Nhân viên/Phó/Trưởng.",
    "Trưởng/Phụ trách khóa và mở đăng ký kế hoạch đúng Phòng/Khu mình, không dùng Toàn Trung tâm làm đơn vị.",
    "Giữ nguyên DIRECT/GROUPED, engine KPI, evidence/audit/archive, EVENT_DRIVEN/ITEMIZED và 21 composite indexes."
  ])
});

if (typeof window !== "undefined") window.__APP_RELEASE__ = RELEASE_V1211;
