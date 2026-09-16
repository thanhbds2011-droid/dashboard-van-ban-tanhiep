/** Release marker V1.24.6 - Department/Khu council summary completeness; scoring/Rules/Indexes unchanged. */
import { APP_VERSION, BUILD_VERSION } from "./core/app-version.js?v=20260916.V1_24_7";

window.__KPI_RELEASE__ = Object.freeze({
  appVersion: APP_VERSION,
  buildVersion: BUILD_VERSION,
  name: "V1.24.6 – Department/Khu Council Summary",
  releasedAt: "2026-09-16",
  notes: "Bảng Tổng hợp Phòng/Khu ẩn phần Chi đoàn khi số lượng bằng 0; bổ sung Điểm kế hoạch (A), Điểm thực hiện (B), Điểm KPI công việc (70), số đầu việc vượt; giữ Điểm thưởng, Tiêu chí chung, Tổng điểm, Mức xếp loại và Trạng thái điểm. Báo cáo Phòng/Khu in A4 ngang có mục tiêu; không thêm Firestore read, không thay scoring, Rules, indexes, Apps Script hay dữ liệu production."
});
