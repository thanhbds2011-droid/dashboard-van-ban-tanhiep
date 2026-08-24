# NHIỆM VỤ & KPI — PRODUCTION V1.8.2

## Phạm vi bản sửa

V1.8.2 xử lý đồng bộ ba nhóm lỗi đã được kiểm thử thực tế:

1. Người phụ trách được gửi **Miễn đánh giá do điều động** cho nhiệm vụ đã đánh dấu hoàn thành, với điều kiện điểm chưa xác nhận hoặc khóa. Điều chỉnh khối lượng/phạm vi vẫn bị khóa sau khi hoàn thành.
2. Trưởng/Phó Phòng/Khu đọc được nhiệm vụ do Ban Giám đốc giao xuống đơn vị, kể cả dữ liệu cũ chỉ có `supportDepartmentIds` hoặc `relatedDepartmentIds`.
3. Trang chủ, Nhiệm vụ, Kế hoạch KPI và Báo cáo nhận thay đổi nhiệm vụ trực tiếp bằng Firestore `onSnapshot`, không cần F5 trong quá trình sử dụng bình thường.

## Thành phần phải triển khai cùng nhau

- Toàn bộ thư mục `/nhiem-vu/` V1.8.2.
- Firestore Rules V1.8.2.
- Hai composite index mới cho `supportDepartmentIds` và `relatedDepartmentIds`.

Apps Script tài khoản, danh mục và thông báo/minh chứng không thay đổi trong bản này.

## Lưu ý cache

Sau lần triển khai mã V1.8.2 đầu tiên, cần đóng/mở lại tab hoặc tải lại một lần để trình duyệt nhận Service Worker mới. Khi chân trang đã hiển thị `V1.8.2`, các thay đổi dữ liệu nhiệm vụ sẽ tự đồng bộ giữa các tài khoản mà không cần F5.
