/** Release marker V1.22.2 - workload visibility + realtime scope + delegation revoke hotfix. */
import { APP_VERSION, BUILD_VERSION } from "./core/app-version.js?v=20260903.V1_22_5";

window.__NHIEM_VU_RELEASE__ = Object.freeze({
  version: APP_VERSION,
  build: BUILD_VERSION,
  name: "V1.22.2 – Workload Visibility + Realtime + Revoke Hotfix",
  previous: "V1.22.1",
  changes: Object.freeze([
    "KPI Phạm vi dùng toàn chiều ngang, desktop không còn thanh cuộn ngang do scope bị bó bởi cụm hành động.",
    "Trưởng/Phó Phòng/Khu thấy workload Chi đoàn đã duyệt của nhân viên thuộc homeDepartmentId nhưng không nhận quyền duyệt/chấm Chi đoàn.",
    "Đổi scope KPI sẽ hủy listener cũ và khởi tạo lại realtime đúng scope; trạng thái duyệt Chi đoàn cập nhật ngay không cần đổi tab.",
    "Hủy ủy quyền Danh mục và hủy ủy quyền duyệt Chi đoàn giữ button reference trước confirm bất đồng bộ, không còn lỗi event.currentTarget = null.",
    "Firestore Rules V1.22.1 và 21 composite indexes được giữ nguyên."
  ])
});
