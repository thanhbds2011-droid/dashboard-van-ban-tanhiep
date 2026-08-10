# HƯỚNG DẪN TRIỂN KHAI V1.10.6 – CHỈ ĐẠO ĐIỀU HÀNH

## Phạm vi
V1.10.6 chỉ bổ sung cho phân hệ **Chỉ đạo điều hành**. Không dùng `tasks`, `taskLogs`, `taskPushSubscriptions`, KPI hoặc Hội đồng để vận hành phân hệ mới.

## Nghiệp vụ mới
1. Phòng/Khu phải **Xác nhận tiếp nhận** trước khi cập nhật thực hiện.
2. Trạng thái bắt buộc: **Tiếp nhận → Đang thực hiện → Hoàn thành**. Hoàn thành trực tiếp từ Chưa tiếp nhận/Đã tiếp nhận bị chặn ở UI, service và Firestore Rules.
3. Khi BGĐ/TCHC giao:
   - Chỉ chọn Phòng/Khu: giao cấp Phòng/Khu.
   - Nếu chọn Tổ/Nhóm: bắt buộc chọn một nhân sự active thuộc đúng `departmentId` + `teamId`; người đó là người phụ trách chính.
   - Phòng/Khu vẫn phải tiếp nhận trước khi cá nhân được cập nhật thực hiện.
4. Push dùng `executivePushSubscriptions` + Apps Script riêng V1.1.0; có `executiveNotificationLogs` để biết SENT / NO_SUBSCRIPTIONS / FAILED.

## Thứ tự triển khai
1. Sao lưu repository hiện tại.
2. Upload/dán đè toàn bộ gói FULL V1.10.6 tại đúng thư mục gốc repository.
3. Firebase Console → Firestore Database → Rules → dán toàn bộ `firestore.rules` V1.10.6 → Publish.
4. Apps Script Chỉ đạo điều hành: dán đè toàn bộ `deployment/CHI_DAO_DIEU_HANH_PUSH_V1_1_0.gs` vào project Web App riêng.
5. Apps Script → Deploy → Manage deployments → Edit deployment → New version → Deploy. Nếu URL `/exec` thay đổi, cập nhật `nhiem-vu/executive-notification-config.js`.
6. Kiểm tra Script Properties: FIREBASE_SERVICE_ACCOUNT_EMAIL, FIREBASE_PRIVATE_KEY, FIREBASE_PROJECT_ID, FIREBASE_API_KEY, ONESIGNAL_APP_ID, ONESIGNAL_API_KEY, APP_URL.
7. Chạy `kiemTraHeThongPushChiDaoDieuHanh()` trong Apps Script. `activeSubscriptions` phải > 0 sau khi thiết bị đã bật thông báo.
8. Có thể chạy `guiThuChiDaoDieuHanhTheoEmail("email@...")` để gửi thử trực tiếp.
9. Trên website: đăng xuất/đăng nhập lại, Ctrl+Shift+R nếu cần. Footer phải là **V1.10.6**.

## Kiểm thử bắt buộc
- BGĐ giao cấp Phòng CTXH → CTXH thấy realtime và Trưởng/Phó nhận Push.
- CTXH chưa tiếp nhận → không có nút cập nhật thực hiện; gọi trực tiếp service cũng bị chặn.
- CTXH tiếp nhận → chỉ được chuyển sang Đang thực hiện.
- Đang thực hiện → mới được Hoàn thành.
- BGĐ chọn Phòng TCHC → Tổ Điện nước → chỉ hiện nhân sự có departmentId=TCHC và teamId=DIEN_NUOC.
- Người được giao trực tiếp chỉ cập nhật sau khi Phòng/Khu đã tiếp nhận.
- `executiveNotificationLogs` ghi trạng thái khi phát Push.
- Regression test toàn bộ Nhiệm vụ/KPI hiện đang PASS.
