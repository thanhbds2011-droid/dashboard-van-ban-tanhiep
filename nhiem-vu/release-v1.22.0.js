/** Release marker V1.22.0 - Production Workflow + Mobile + Performance Safety. */
import { APP_VERSION, BUILD_VERSION } from "./core/app-version.js?v=20260903.V1_22_3";

export const RELEASE_V1220 = Object.freeze({
  version: APP_VERSION,
  build: BUILD_VERSION,
  name: "V1.22.0 – Production Workflow + Mobile + Performance Safety",
  changes: Object.freeze([
    "Hiển thị ngay tệp minh chứng đã chọn trước khi lưu, giữ cơ chế staged upload và Drive hiện hữu.",
    "Ẩn entry point Giao nhiệm vụ đột xuất với Ban Giám đốc; giữ nguyên workflow cho Trưởng/Phó Phòng/Khu.",
    "Khôi phục phân công người thực hiện Chỉ đạo sau khi Phòng/Khu tiếp nhận; không bypass đơn vị nhận.",
    "TCHC được ghi nhận/chuyển tải chỉ đạo miệng của BGĐ đến Phòng/Khu hợp lệ, đồng thời bảo toàn actor/audit và không tự bật KPI.",
    "Chuẩn hóa KPI Chi đoàn: Bí thư quản lý danh mục; Bí thư tự duyệt đăng ký của mình nhưng BGĐ xác nhận điểm cuối; Phó/BCH có thể nhận ủy quyền hợp lệ.",
    "Chuẩn hóa ủy quyền danh mục theo business position + unit/scope, không dùng ADMIN làm quyền nghiệp vụ thay thế.",
    "Tối ưu giao diện mobile/PWA theo giao diện hiện tại, giữ desktop và toàn bộ business workflow.",
    "Tối ưu Apps Script Danh mục theo batch/block write mà không đổi quy tắc đồng bộ, cấp mã, audit hoặc idempotency.",
    "Giữ nguyên KPI 10/12, hệ số 1/1.1/1.2, 30/70, DIRECT/GROUPED, EVENT_DRIVEN, ITEMIZED và 21 composite indexes production."
  ])
});

if (typeof window !== "undefined") window.__APP_RELEASE__ = RELEASE_V1220;
