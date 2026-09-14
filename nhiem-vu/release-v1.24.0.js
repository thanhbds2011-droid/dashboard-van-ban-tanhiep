/** Release marker V1.24.0 - system-wide authority hardening, acceptance UX và unified non-scoring workflow. */
import { APP_VERSION, BUILD_VERSION } from "./core/app-version.js?v=20260914.V1_24_3";

window.__KPI_RELEASE__ = Object.freeze({
  appVersion: APP_VERSION,
  buildVersion: BUILD_VERSION,
  name: "V1.24.0 – Production Authority & Workflow Hardening",
  releasedAt: "2026-09-05",
  notes: "Sửa generic toàn Phòng/Khu: canonical NONE, ADMIN-as-business-staff, acting/oversight, Giám đốc/Phó Giám đốc, pre-accept cancellation, trạng thái Chưa/Đã xác nhận, Chỉ đạo điều hành và workflow Không tính KPI; giữ nguyên scoring 100/80/60/0 và 30/70."
});
