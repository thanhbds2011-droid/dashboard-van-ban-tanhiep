# Nhiệm vụ và đánh giá KPI – Production V1.8.0

Phạm vi triển khai: chỉ thư mục `/dashboard-van-ban-tanhiep/nhiem-vu/`.

## Thành phần chính

- HTML/CSS/JavaScript ES Module trên GitHub Pages.
- Firebase Authentication và Cloud Firestore.
- PWA/Service Worker cache `nhiem-vu-20260804-v1-8-0`.
- Google Apps Script chỉ dùng cho đồng bộ tài khoản, đồng bộ danh mục, OneSignal, AI, minh chứng Drive và lưu trữ kỳ.

## Thay đổi trọng tâm

- Giao diện Kế hoạch KPI và Báo cáo dùng bộ chọn phạm vi dạng thẻ mềm, không giữ dữ liệu cũ khi đổi phạm vi.
- Báo cáo cá nhân gộp nhiệm vụ chuyên môn và Chi đoàn thành một kết quả tối đa 100 điểm.
- Tổng hợp Chi đoàn phục vụ quản trị hoạt động, không tạo xếp loại cá nhân thứ hai.
- Trưởng/Phó Phòng/Khu được theo dõi nhiệm vụ Chi đoàn trong vùng riêng; quyền xem không tự chuyển thành quyền sửa hoặc duyệt.
- `audienceType` là nguồn quyết định người được thấy/đăng ký danh mục; cờ cốt lõi và quản lý là metadata.
- Cấp mã danh mục dùng transaction và số lớn nhất thực tế cộng một; đồng bộ Sheet không hạ sequence.
- Bổ sung mục `🔔 Thông báo` cố định; khi đăng xuất, thiết bị hiện tại được đánh dấu `active=false` trước Firebase logout.
- Các truy vấn tương thích dữ liệu cũ/mới dùng `Promise.allSettled()` để một nhánh phụ lỗi không làm hỏng toàn trang.

## Phiên bản phụ thuộc

- Firestore Rules: V1.8.0.
- Apps Script tài khoản: V3.3.0.
- Apps Script danh mục: V4.2.0.
- Apps Script thông báo/AI/minh chứng/lưu trữ kỳ: V6.3.0.
- Composite indexes: 12.

## Kiểm tra cục bộ

- 94/94 Node tests đạt.
- 80 tệp JavaScript/MJS hợp lệ cú pháp.
- 5 tệp Apps Script hợp lệ cú pháp.
- Import graph: 44 nodes, 133 edges, không thiếu import.
- Service Worker: 59 tài nguyên shell, không thiếu.
- Không phát hiện private key hoặc OneSignal API key trong gói GitHub.

Chưa thực hiện đăng nhập trực tiếp vào Firebase/OneSignal/Google Drive production trong môi trường đóng gói. Sau triển khai phải chạy checklist nghiệm thu theo tài liệu kèm theo.
