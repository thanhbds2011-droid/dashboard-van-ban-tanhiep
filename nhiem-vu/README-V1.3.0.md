# Quản lý nhiệm vụ – KPI V1.3.0

Phiên bản V1.3.0 tối ưu cho khoảng 135 người dùng và vận hành theo kỳ tháng/quý.

## Điểm chính

- Nhiệm vụ chỉ được đọc theo kỳ đang hoạt động và đúng phạm vi tài khoản.
- Trang chủ, nhiệm vụ, danh mục và KPI không mở listener nền sau lần tải đầu.
- Bộ nhớ đệm ngắn tránh đọc lại khi chuyển nhanh giữa các màn hình.
- Danh mục công việc chỉ tải khi mở đúng phân hệ.
- Kỳ hỗ trợ mã quý `YYYY-Q1..Q4` và tháng `YYYY-M01..M12`.
- Sau khi kết thúc kỳ, ADMIN có thể lưu toàn bộ hồ sơ thành JSON nén lên Drive, đối chiếu SHA-256 rồi dọn dữ liệu vận hành khỏi Firestore.
- Firestore chỉ giữ biên nhận `periodArchives/{periodId}` và trạng thái kỳ `PURGED`; tài khoản, danh mục, phòng/khu, cấu hình và đường dẫn minh chứng được bảo toàn.
- Tỷ lệ nhiều lượt giữ nguyên kết quả N–T–K; `1/2 = 50%`, không ép về `0%`.
- Mã danh mục dùng `TCHC01`, `YT01`…; nhiệm vụ đột xuất dùng `TCHC-DX01`, `YT-DX01`…

## Trình tự kết thúc kỳ

1. Hoàn tất tự đánh giá và xác nhận.
2. Trưởng phòng TCHC kết thúc kỳ.
3. ADMIN mở phân hệ KPI, chọn **Lưu Drive và dọn Firestore**.
4. Nhập chính xác mã kỳ để xác nhận.
5. Chờ tiến trình đạt 100% rồi mới tạo/kích hoạt kỳ tiếp theo.

Không xóa thủ công collection trong Firebase Console vì sẽ bỏ qua bước lưu Drive và kiểm tra toàn vẹn.
