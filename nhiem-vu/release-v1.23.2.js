/** Release marker V1.23.2 - toàn bộ thông báo được tắt để giảm Firestore quota. */
import { APP_VERSION, BUILD_VERSION } from "./core/app-version.js?v=20260913.V1_23_2";

window.__KPI_RELEASE__ = Object.freeze({
  appVersion: APP_VERSION,
  buildVersion: BUILD_VERSION,
  name: "V1.23.2 – Notifications Off",
  releasedAt: "2026-09-13",
  notes: "Tắt OneSignal, Notification Center, task/executive in-app alert, notification bridge và mọi backend dispatch từ frontend; giữ nguyên KPI, nhiệm vụ, minh chứng Drive, AI, lưu trữ kỳ và audit logs."
});
