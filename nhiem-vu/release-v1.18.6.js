/** Release marker V1.18.6 - EVENT_DRIVEN close reliability + KPI meaning split. */
import { APP_VERSION, BUILD_VERSION } from "./core/app-version.js?v=20260826.V1_18_6";
export const RELEASE_V1_18_6 = Object.freeze({
  version: APP_VERSION,
  build: BUILD_VERSION,
  name: "V1.18.6 – EVENT_DRIVEN Close Reliability",
  changes: [
    "Hoàn thành nghiệp vụ EVENT_DRIVEN được ghi 100% nhưng KPI tiến độ giữ mức thực tế theo từng lượt.",
    "Xác nhận write sớm bằng server REST để không giữ nút Đang lưu khi WebChannel phản hồi chậm.",
    "Đồng bộ Firestore Rules root/deployment đúng schema production và tách progress vận hành khỏi eventProgressRate KPI.",
    "Làm rõ giao diện: Hoàn thành nghiệp vụ, KPI tiến độ và KPI kết quả là ba chỉ số khác nhau."
  ]
});
