/** Release marker V1.24.5 - personal-title consistency + official Product Catalog export cleanup; scoring/Rules/Indexes unchanged. */
import { APP_VERSION, BUILD_VERSION } from "./core/app-version.js?v=20260916.V1_24_7";

window.__KPI_RELEASE__ = Object.freeze({
  appVersion: APP_VERSION,
  buildVersion: BUILD_VERSION,
  name: "V1.24.5 – Personal Task Title + Product Catalog Export",
  releasedAt: "2026-09-16",
  notes: "Màn hình Kế hoạch của nhân viên luôn ưu tiên tên đầu việc cá nhân đã đăng ký, chỉ fallback tên danh mục chuẩn khi title trống; file Excel Danh mục sản phẩm chuẩn không còn in mã danh mục nội bộ, chỉ in tên công việc đăng ký. Không thay scoring, reviewer authority, Firestore Rules, indexes, Apps Script hay dữ liệu production."
});
