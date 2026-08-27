/** Release marker V1.19.0 - Unit Authority + KPI Review + Production Reliability. */
import { APP_VERSION, BUILD_VERSION } from "./core/app-version.js?v=20260826.V1_19_0";

export const RELEASE_V1_19_0 = Object.freeze({
  version: APP_VERSION,
  build: BUILD_VERSION,
  name: "V1.19.0 – Unit Authority & KPI Workflow Hardening",
  changes: [
    "Chuẩn hóa Quyền phê duyệt tại đơn vị theo approvalAuthority, áp dụng chung cho mọi Phòng/Khu, không hard-code TCHC.",
    "Người phụ trách đơn vị giữ quyền gốc; Phó được ủy quyền có quyền bổ sung nhưng không được tự duyệt chính mình.",
    "Phó Trưởng phòng được gán approvalAuthority=HEAD được xử lý như người phụ trách đơn vị; khi tự chấm KPI phải chuyển lên Ban Giám đốc.",
    "Sửa nested modal để hộp xác nhận luôn nằm trên modal nhiệm vụ/KPI, chấm dứt trạng thái Đang lưu do hộp xác nhận bị che.",
    "Giữ nguyên write recovery EVENT_DRIVEN 100/80/100 và xác minh server khi WebChannel chậm ACK.",
    "Sửa render KPI null-safe và khôi phục nút Mở chi tiết/Xác nhận điểm theo ma trận thẩm quyền thực tế.",
    "Tách capability ủy quyền Danh mục công việc: CREATE_STANDARD_TASKS, EDIT_STANDARD_TASKS, DELETE_STANDARD_TASKS; quyền giao nhiệm vụ runtime dùng CREATE_TASKS riêng.",
    "Legacy MANAGE_STANDARD_TASKS chỉ còn tương thích tạo/sửa do chính delegate tạo và không tự cấp quyền xóa.",
    "Siết Firestore Rules chống direct-create bypass, self-approval đăng ký và quyền quản lý quá rộng.",
    "Apps Script Danh mục công việc V4.6.0 thêm conflict guard, không cho Sheet cũ ghi đè Firestore mới hơn."
  ]
});
