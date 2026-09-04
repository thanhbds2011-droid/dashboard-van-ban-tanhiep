/** Release marker V1.22.3 - biểu mẫu KPI + Excel XLSX + realtime production. */
import { APP_VERSION, BUILD_VERSION } from "./core/app-version.js?v=20260903.V1_22_5";

window.__NHIEM_VU_RELEASE__ = Object.freeze({
  version: APP_VERSION,
  build: BUILD_VERSION,
  name: "V1.22.3 – KPI Form + Formatted Excel + Realtime",
  previous: "V1.22.2",
  changes: Object.freeze([
    "Bảng tính điểm chuẩn hóa 'Tên công việc' và bổ sung Điểm giá trị A, Điểm giá trị B, KPI trục 4, số công việc đánh dấu X và tổng điểm thưởng đã được xác nhận.",
    "Xuất bảng điểm chuyển từ CSV sang tệp XLSX có định dạng, bố cục bảng và phần tổng hợp theo mẫu quy định; không thay scoring engine.",
    "Danh mục sản phẩm cá nhân dùng header hành chính hai khối thống nhất với Báo cáo KPI cá nhân khi xem và in.",
    "Trang Nhiệm vụ và Trang chủ khởi tạo scoped realtime listener ngay với jitter nhỏ thay vì chờ 90–120 giây; giữ dedupe, cache và unsubscribe.",
    "Firestore Rules V1.22.1 và 21 composite indexes không thay nghiệp vụ và không cần deploy lại."
  ])
});
