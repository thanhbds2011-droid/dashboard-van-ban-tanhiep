/** Release marker V1.24.2 - release-integrity + CDTN self-assessment fix; Rules/Indexes unchanged. */
import { APP_VERSION, BUILD_VERSION } from "./core/app-version.js?v=20260914.V1_24_3";

window.__KPI_RELEASE__ = Object.freeze({
  appVersion: APP_VERSION,
  buildVersion: BUILD_VERSION,
  name: "V1.24.2 – Release Integrity / CDTN Evaluation Fix",
  releasedAt: "2026-09-14",
  notes: "Khôi phục source tree đồng nhất V1.24.2, sửa canonical scope khi tự đánh giá nhiệm vụ Chi đoàn, thêm chẩn đoán dữ liệu legacy; giữ nguyên scoring, authority, Rules V1.24.1, indexes và Notifications Off."
});
