/** Release marker V1.24.1 - quota-safe, notifications off; giữ nguyên nghiệp vụ V1.24.0. */
import { APP_VERSION, BUILD_VERSION } from "./core/app-version.js?v=20260916.V1_24_6";

window.__KPI_RELEASE__ = Object.freeze({
  appVersion: APP_VERSION,
  buildVersion: BUILD_VERSION,
  name: "V1.24.1 – Quota Safe / Notifications Off",
  releasedAt: "2026-09-14",
  notes: "Tắt toàn bộ notification/push; tối ưu bootstrap Dashboard/Nhiệm vụ/KPI và sequence allocation; giữ nguyên scoring, deadline, authority, Phòng/Khu kiêm nhiệm, Chi đoàn và workflow V1.24.0."
});
