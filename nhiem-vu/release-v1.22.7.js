/** Release marker V1.22.7 - ADMIN mở lại registration recurring sạch và chuyển sang Khi phát sinh. */
import { APP_VERSION, BUILD_VERSION } from "./core/app-version.js?v=20260904.V1_23_0";

window.__KPI_RELEASE__ = Object.freeze({
  appVersion: APP_VERSION,
  buildVersion: BUILD_VERSION,
  name: "V1.22.7 – Admin Reopen as Event-Driven",
  releasedAt: "2026-09-04",
  notes: "ADMIN-only correction: giữ registration, hủy mềm task recurring sạch, đưa registration về PENDING/Khi phát sinh để authority duyệt lại; không thay scoring."
});
