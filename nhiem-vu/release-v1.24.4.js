/** Release marker V1.24.4 - focused registration/CDTN/UI hotfix; scoring/Rules/Indexes unchanged. */
import { APP_VERSION, BUILD_VERSION } from "./core/app-version.js?v=20260916.V1_24_6";

window.__KPI_RELEASE__ = Object.freeze({
  appVersion: APP_VERSION,
  buildVersion: BUILD_VERSION,
  name: "V1.24.4 – Registration Review + Safe Cancel + CDTN Realtime + Firefox Layout",
  releasedAt: "2026-09-14",
  notes: "Bổ sung Kết quả đầu ra khi duyệt registration; hủy an toàn nhiệm vụ tự đăng ký trước acceptedAt với revalidation quota-safe; reconciliation taskEvaluations/taskRegistrations theo homeDepartmentId ở professional scope; sửa row overlap Firefox tại standard-tasks. Không thay scoring, reviewer authority, Firestore Rules, indexes hay Apps Script."
});
