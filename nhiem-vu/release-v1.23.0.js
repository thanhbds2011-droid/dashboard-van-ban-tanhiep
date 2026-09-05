/** Release marker V1.23.0 - acting authority, Notification Center, Office export và production hardening. */
import { APP_VERSION, BUILD_VERSION } from "./core/app-version.js?v=20260904.V1_23_0";

window.__KPI_RELEASE__ = Object.freeze({
  appVersion: APP_VERSION,
  buildVersion: BUILD_VERSION,
  name: "V1.23.0 – Acting Authority + Notification Center + Office Export",
  releasedAt: "2026-09-04",
  notes: "Giữ nguyên scoring 100/80/60/0 và authority nền; bổ sung kiêm nhiệm data-driven, sửa runtime/router/OneSignal, Notification Center, XLSX/DOCX và Admin UI gọn."
});
