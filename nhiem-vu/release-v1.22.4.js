/** Release marker V1.22.4 - tiêu đề Danh mục sản phẩm theo metadata kỳ đánh giá. */
import { APP_VERSION, BUILD_VERSION } from "./core/app-version.js?v=20260903.V1_22_5";

window.__NHIEM_VU_RELEASE__ = Object.freeze({
  version: APP_VERSION,
  build: BUILD_VERSION,
  name: "V1.22.4 – Product Catalog Period Metadata Hotfix",
  previous: "V1.22.3",
  changes: Object.freeze([
    "Danh mục sản phẩm cá nhân lấy Quý/Năm từ metadata kỳ đánh giá (quarter/id/name/year) thay vì suy trực tiếp từ tháng của startDate.",
    "Kỳ 2026-Q3 bắt đầu 22/06/2026 vẫn hiển thị QUÝ III; các kỳ Q1–Q4 tự động theo kỳ đang active, không cố định.",
    "Giữ nguyên scoring, 5% điểm thưởng, workload Chi đoàn, realtime, Firestore Rules V1.22.1 và 21 composite indexes."
  ])
});
