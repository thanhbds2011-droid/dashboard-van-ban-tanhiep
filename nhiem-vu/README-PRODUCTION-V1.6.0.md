# NHIỆM VỤ VÀ ĐÁNH GIÁ KPI — PRODUCTION V1.6.0

Phân hệ chạy tại:

`https://thanhbds2011-droid.github.io/dashboard-van-ban-tanhiep/nhiem-vu/`

## Cập nhật GitHub

Chỉ ghi đè toàn bộ nội dung của thư mục `/nhiem-vu/` trong repository. Không ghi đè các file ở thư mục gốc vì thư mục gốc đang phục vụ ứng dụng nhắc việc văn bản.

## Thành phần triển khai kèm theo

- Firestore Rules V1.6.0: `../deployment/firestore.rules`.
- Apps Script thông báo/AI/minh chứng V6.2.0: `../deployment/apps-script-notification-ai-archive-v6.2.0.gs`.
- Apps Script tài khoản V3.1.0: `../deployment/apps-script-sync-accounts-v3.1.0.gs`.
- Apps Script danh mục V4.0.2: `../deployment/apps-script-sync-standard-tasks-v4.0.2.gs`.

## Chức năng trọng tâm

- Ban Giám đốc theo dõi toàn Trung tâm và lọc theo Phòng/Khu.
- Trưởng phòng tự duyệt đăng ký; Phó Trưởng phòng và nhân viên chờ đúng người có thẩm quyền duyệt.
- Ủy quyền phê duyệt, nhập danh mục, duyệt Chi đoàn và điểm danh có thời hạn.
- Phân tách không gian Phòng/Khu và Chi đoàn cho người kiêm nhiệm.
- STAFF chỉ thấy đầu việc cốt lõi; đầu việc quản lý chỉ hiện cho lãnh đạo.
- Khung cuộn cho danh mục, nhiệm vụ và màn hình xác nhận KPI.
- Chi tiết nhiệm vụ gồm năm tab; giữ lịch sử và minh chứng.
- Chấm từng văn bản/lượt, tính trung bình chính xác rồi mới áp dụng Phụ lục 04.
- Điều chỉnh phạm vi, miễn đánh giá do điều động và nhiệm vụ phát sinh.
- Xác nhận KPI theo nhân viên, chọn từng nhiệm vụ hoặc chọn tất cả.
- Mã thường xuyên `TCHC01`; mã đột xuất `TCHC-DX01`.
