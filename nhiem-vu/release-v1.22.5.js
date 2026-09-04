/** Release marker V1.22.5 - hiển thị điểm thưởng dự kiến/chính thức + realtime modal báo cáo. */
import { APP_VERSION, BUILD_VERSION } from "./core/app-version.js?v=20260903.V1_22_5";

window.__KPI_RELEASE__ = Object.freeze({
  appVersion: APP_VERSION,
  buildVersion: BUILD_VERSION,
  name: "V1.22.5 – Provisional Bonus & Report Status Realtime",
  releasedAt: "2026-09-03",
  notes: "Giữ scoring/authority; chỉ tách presentation điểm thưởng dự kiến và chính thức, làm sạch Ghi chú biểu mẫu, refresh modal KPI chỉ đọc theo realtime."
});
