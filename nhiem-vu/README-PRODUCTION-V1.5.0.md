# Quản lý nhiệm vụ và đánh giá KPI — Production V1.5.0

Bản phát hành hoàn thiện quy trình **đề nghị điều chỉnh/miễn đánh giá do điều động** cho STAFF và người giao nhiệm vụ.

## Thành phần triển khai

- Giao diện GitHub Pages/PWA: thư mục `nhiem-vu/`.
- Firestore Rules: `firestore.rules` hoặc `deployment/firestore.rules`.
- Composite Index: `firestore.indexes.json` — giữ nguyên 09 index.
- Apps Script V6.1.0: `deployment/apps-script-notification-ai-archive-v6.1.0.gs`.
- Apps Script tài khoản V3.1.0 và danh mục V4.0.0: thư mục `deployment/`.
- Hướng dẫn: `HUONG_DAN_TRIEN_KHAI_PRODUCTION_V1_5_0.md`.
- Báo cáo kiểm thử: `TEST_REPORT_V1_5_0.txt`.

## Luồng nghiệp vụ

`STAFF gửi đề nghị → ghi kpiAdjustments + cập nhật tasks + ghi taskLogs trong một batch → người giao duyệt/từ chối → cập nhật KPI → gửi OneSignal`.

Khi miễn đánh giá được duyệt, nhiệm vụ không bị xóa và không bị chấm 0; nhiệm vụ được loại khỏi A, B và mẫu số KPI nhưng vẫn giữ nguyên lịch sử.

## Nguyên tắc dữ liệu

- Không đổi collection cũ.
- Không tự động xóa, chuyển nhiệm vụ hoặc chia điểm giữa nhân sự.
- Không dùng Firebase Storage; minh chứng tiếp tục lưu trên Google Drive.
- Nhiệm vụ mới/phân công mới ghi rõ người phê duyệt điều chỉnh.
- Dữ liệu cũ vẫn tương thích bằng cơ chế dự phòng người giao/người tạo.
- Các thao tác được bảo vệ ở frontend, Firestore Rules và Apps Script.
