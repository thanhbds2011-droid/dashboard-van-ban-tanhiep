/** Release marker V1.20.0 - Production KPI Workflow, Realtime & UX Completion. */
import { APP_VERSION, BUILD_VERSION } from "./core/app-version.js?v=20260829.V1_20_0";

export const RELEASE_V1200 = Object.freeze({
  version: APP_VERSION,
  build: BUILD_VERSION,
  name: "V1.20.0 – KPI Production Completion",
  changes: Object.freeze([
    "Hoàn thiện duyệt/không duyệt và đăng ký lại nhiệm vụ, giữ audit.",
    "Đồng nhất quyền danh mục với approvalAuthority và Firestore Rules.",
    "Hiển thị minh chứng và xác nhận vượt yêu cầu khi chấm KPI.",
    "Áp điều kiện tỷ lệ nhiệm vụ vượt cho đề xuất xếp loại.",
    "Realtime theo scope cho đăng ký, nhiệm vụ, đánh giá và tiêu chí chung.",
    "Bổ sung Danh mục sản phẩm cá nhân và bảng KPI dùng cho họp/xác nhận.",
    "Tinh chỉnh UI/UX desktop/mobile và chuẩn hóa package triển khai 21 indexes."
  ])
});

if (typeof window !== "undefined") window.__APP_RELEASE__ = RELEASE_V1200;
