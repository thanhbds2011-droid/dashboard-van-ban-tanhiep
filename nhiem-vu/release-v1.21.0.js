/** Release marker V1.21.0 - Production KPI Workflow Extension. */
import { APP_VERSION, BUILD_VERSION } from "./core/app-version.js?v=20260830.V1_21_0";

export const RELEASE_V1210 = Object.freeze({
  version: APP_VERSION,
  build: BUILD_VERSION,
  name: "V1.21.0 – KPI Production Workflow Extension",
  changes: Object.freeze([
    "Nhiệm vụ mặc định theo cá nhân; tách chế độ điều hành Phòng/Khu.",
    "DIRECT/GROUPED: một đầu việc chuẩn có thể tạo nhiều nhiệm vụ KPI cá nhân độc lập.",
    "Chuẩn hóa Danh mục sản phẩm, bảng KPI và giao diện xác nhận điểm.",
    "Bỏ Minh chứng phát sinh khỏi Danh mục chuẩn, giữ đầy đủ evidence thực tế.",
    "Khắc phục gỡ danh mục và ủy quyền nhập danh mục theo approvalAuthority.",
    "Cho phép Ban Giám đốc chọn Chỉ đạo điều hành làm nguồn KPI đột xuất có kiểm soát.",
    "Bổ sung Quản trị sửa sai có kiểm soát, giữ audit/evidence/archive.",
    "Giữ nguyên engine KPI, EVENT_DRIVEN/ITEMIZED và 21 composite indexes production."
  ])
});

if (typeof window !== "undefined") window.__APP_RELEASE__ = RELEASE_V1210;
