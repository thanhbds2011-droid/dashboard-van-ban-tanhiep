/** Release marker V1.22.6 - hiển thị đúng tần suất đăng ký cá nhân theo registration. */
import { APP_VERSION, BUILD_VERSION } from "./core/app-version.js?v=20260904.V1_22_6";

window.__KPI_RELEASE__ = Object.freeze({
  appVersion: APP_VERSION,
  buildVersion: BUILD_VERSION,
  name: "V1.22.6 – Personal Registration Frequency Display",
  releasedAt: "2026-09-04",
  notes: "Giữ nguyên danh mục chuẩn và toàn bộ workflow; card Đăng ký của tôi ưu tiên registration.frequency, fallback standardTask.frequency cho dữ liệu legacy."
});
