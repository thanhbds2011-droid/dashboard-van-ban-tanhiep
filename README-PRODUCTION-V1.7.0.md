# NHIỆM VỤ VÀ ĐÁNH GIÁ KPI — PRODUCTION V1.7.0

Phân hệ chạy tại:

`https://thanhbds2011-droid.github.io/dashboard-van-ban-tanhiep/nhiem-vu/`

## Cập nhật GitHub

Chỉ ghi đè toàn bộ nội dung thư mục `/nhiem-vu/` trong repository. Không ghi đè thư mục gốc vì thư mục gốc đang phục vụ ứng dụng nhắc việc văn bản.

## Thành phần triển khai

- Firestore Rules V1.7.0: `../deployment/firestore.rules`.
- Firestore Indexes: `../deployment/firestore.indexes.json`.
- Apps Script thông báo/AI/minh chứng V6.3.0: `../deployment/apps-script-notification-ai-evidence-v6.3.0.gs`.
- Apps Script tài khoản V3.2.0: `../deployment/apps-script-account-sync-v3.2.0.gs`.
- Apps Script danh mục V4.1.0: `../deployment/apps-script-standard-tasks-v4.1.0.gs`.

## Nội dung trọng tâm

- Bí thư và Phó Bí thư Chi đoàn có quyền nghiệp vụ ngang nhau.
- Tách dữ liệu, danh mục, KPI, Mẫu 01 và báo cáo Phòng/Khu với Chi đoàn.
- Chỉ ADMIN và Ban Giám đốc được xem đồng thời toàn bộ hai phạm vi.
- TCHC theo dõi toàn bộ dữ liệu chuyên môn nhưng không mặc nhiên xem dữ liệu Chi đoàn.
- Thành viên Chi đoàn có báo cáo cá nhân Chi đoàn riêng.
- Sửa luồng ủy quyền Chi đoàn và tiếp nhận nhiệm vụ cũ thiếu trường trạng thái.
- Chấm từng văn bản/lượt; lấy trung bình rồi quy về 100–80–60–0 theo Phụ lục 04.
- Điểm danh N–T–K: tỷ lệ dưới 60% áp dụng 0%; ví dụ 1/2 = 50% → 0%.
- Nhiệm vụ miễn đánh giá không tính 0, không vào A, B hoặc mẫu số KPI.
- Lỗi quyền được chuyển thành thông báo tiếng Việt.
- Service Worker cache phiên bản `nhiem-vu-20260803-v1-7-0`.
