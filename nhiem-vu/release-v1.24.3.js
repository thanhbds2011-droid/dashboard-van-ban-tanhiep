/** Release marker V1.24.3 - CDTN evaluation state/query hotfix; Rules/Indexes unchanged. */
import { APP_VERSION, BUILD_VERSION } from "./core/app-version.js?v=20260916.V1_24_7";

window.__KPI_RELEASE__ = Object.freeze({
  appVersion: APP_VERSION,
  buildVersion: BUILD_VERSION,
  name: "V1.24.3 – CDTN Evaluation State Hotfix",
  releasedAt: "2026-09-14",
  notes: "Sửa tải state taskEvaluations/taskRegistrations theo homeDepartmentId cho lãnh đạo Phòng/Khu chính, bổ sung fallback tự đánh giá theo owner, tách CREATE/UPDATE tự đánh giá để tương thích Rules hiện hành; giữ nguyên scoring, authority, Rules V1.24.1, indexes và Notifications Off."
});
