# Nhiệm vụ và đánh giá KPI — Production V1.7.2

Bản vá V1.7.2 tập trung vào tài khoản viên chức có vai trò kiêm nhiệm Chi đoàn:

- Sửa luồng ủy quyền duyệt Chi đoàn bằng danh bạ tối thiểu `cdtnMembers`.
- Sửa tiếp nhận nhiệm vụ để lỗi ghi nhật ký bổ sung không làm hủy thao tác hợp lệ.
- Hiển thị nhãn `Viên chức`.
- Thu gọn Dashboard, chuyển kỳ KPI thành dòng thông tin.
- Đưa nút đồng bộ nhiệm vụ và báo cáo về dạng biểu tượng gọn.
- Bỏ nút xem trước báo cáo trùng chức năng.
- Áp dụng nhóm tiêu chí chung 30 điểm cho cả báo cáo chuyên môn và báo cáo cá nhân Chi đoàn.

## Triển khai

1. Tạo 3 composite index mới và chờ trạng thái `Enabled`.
2. Publish Firestore Rules V1.7.2.
3. Dán Apps Script tài khoản V3.2.2, chạy kiểm tra và đồng bộ một lần để tạo `cdtnMembers`.
4. Thay toàn bộ nội dung thư mục `/nhiem-vu/` trên GitHub.
5. Làm mới Service Worker và tải lại ứng dụng.

Không đưa private key hoặc OneSignal REST API key lên GitHub.


## Bổ sung V1.7.2
- Danh sách ủy quyền hiển thị vai trò Chi đoàn.
- KPI/Báo cáo Chi đoàn dùng phạm vi và tiêu chí chung độc lập.
- Tương thích nhiệm vụ Chi đoàn cũ qua organizationId.
- Thanh lọc và nút đồng bộ được căn cùng hàng.
