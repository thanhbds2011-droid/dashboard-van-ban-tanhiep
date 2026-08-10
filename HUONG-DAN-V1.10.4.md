# V1.10.4 — CHỈ ĐẠO ĐIỀU HÀNH REALTIME + PUSH ĐỘC LẬP

## 1. Phạm vi

V1.10.4 chỉ hoàn thiện phân hệ **Chỉ đạo điều hành** và hạ tầng dùng chung tối thiểu.

Không thay đổi nghiệp vụ/công thức/collection của:
- Nhiệm vụ;
- KPI;
- Hội đồng;
- taskLogs;
- taskPushSubscriptions;
- TaskNotificationService.

Collection riêng của Chỉ đạo điều hành:
- `executiveDirectives`
- `executiveDirectiveUpdates`
- `executiveWeeklyReports`
- `executivePushSubscriptions`

## 2. Lỗi `Missing or insufficient permissions`

Phải publish **toàn bộ** `firestore.rules` V1.10.4. Rules có quyền riêng cho 3 collection Chỉ đạo điều hành và `executivePushSubscriptions`.

V1.10.4 đồng thời cho phép `users/{uid}` tự đồng bộ các trường vai trò/Phòng-Khu từ `accessAccounts/{email}` khi và chỉ khi giá trị mới khớp đúng danh mục tài khoản đã được cấp quyền. Người dùng không thể tự nâng quyền tùy ý.

## 3. Realtime

Hai listener độc lập:
- `executiveDirectives` → giao/sửa/chuyển/đóng/xóa mềm cập nhật tức thời;
- `executiveDirectiveUpdates` → tiếp nhận/tiến độ/hoàn thành cập nhật tức thời.

Không cần bấm Cập nhật hoặc tải lại trang để người đang mở phân hệ nhìn thấy thay đổi.

Phòng/Khu có nút **Xác nhận tiếp nhận**. Mỗi Phòng/Khu chỉ xác nhận một lần cho một chỉ đạo; lịch sử tiếp nhận được lưu độc lập.

## 4. Push độc lập

Push Chỉ đạo điều hành không dùng `taskPushSubscriptions`.

Frontend lưu thiết bị vào:
`executivePushSubscriptions/{uid}_{subscriptionId}`

Backend riêng:
`deployment/CHI_DAO_DIEU_HANH_PUSH_V1_0_0.gs`

Backend chỉ đọc dữ liệu Chỉ đạo điều hành, `users`, `executivePushSubscriptions` và gửi OneSignal.

### Các sự kiện Push

- BGĐ/TCHC giao chỉ đạo → Phòng/Khu liên quan + BGĐ/TCHC liên quan nhận thông báo (trừ chính tài khoản vừa thao tác).
- Phòng/Khu xác nhận tiếp nhận → BGĐ + TCHC + các đơn vị liên quan nhận.
- Phòng/Khu cập nhật thực hiện → BGĐ + TCHC + các đơn vị liên quan nhận.
- Phòng/Khu hoàn thành → BGĐ + TCHC + các đơn vị liên quan nhận.
- Chỉnh sửa/đóng/mở lại/xóa mềm → các bên liên quan nhận.

## 5. Triển khai GitHub

Có thể upload gói PATCH tại thư mục gốc repository và cho phép GitHub ghi đè file trùng tên.

Sau deploy, footer phải hiển thị **V1.10.4**.

## 6. Publish Firestore Rules

Firebase Console → Firestore Database → Rules → dán toàn bộ `firestore.rules` V1.10.4 → Publish.

Không thay `firestore.indexes.json`.

## 7. Triển khai Apps Script Push riêng

Tạo một Apps Script project mới, ví dụ: `CHI DAO DIEU HANH PUSH`.

Dán toàn bộ file:
`deployment/CHI_DAO_DIEU_HANH_PUSH_V1_0_0.gs`

Trong **Project Settings → Script properties**, cấu hình cùng các tên property đang dùng ở production:
- `FIREBASE_SERVICE_ACCOUNT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_API_KEY`
- `ONESIGNAL_APP_ID`
- `ONESIGNAL_API_KEY`
- `APP_URL`

Không hard-code secret vào GitHub.

Deploy → New deployment → Web app:
- Execute as: Me
- Who has access: Anyone

Copy URL kết thúc bằng `/exec`.

Mở:
`nhiem-vu/executive-notification-config.js`

Thay:
`DAN_LINK_WEB_APP_CHI_DAO_DIEU_HANH_VAO_DAY`

bằng URL Web App vừa deploy, rồi upload lại **chỉ file này** lên GitHub.

## 8. Bật thông báo trên thiết bị

Mỗi tài khoản cần bấm **Bật thông báo** một lần trên từng trình duyệt/thiết bị muốn nhận Push.

Sau khi quyền OneSignal được cấp, frontend tự tạo `executivePushSubscriptions`; không cần đồng bộ thủ công.

Trong cửa sổ **Thông báo**, dòng **Chỉ đạo điều hành** phải hiển thị `Đã đồng bộ · đang hoạt động`.

## 9. Test đề nghị

1. BGĐ đăng nhập thiết bị A, CTXH đăng nhập thiết bị B, TCHC đăng nhập thiết bị C.
2. Cả 3 bật thông báo.
3. BGĐ tạo chỉ đạo giao CTXH.
4. CTXH phải thấy dữ liệu xuất hiện tự động và nhận Push.
5. CTXH bấm **Xác nhận tiếp nhận**.
6. Màn hình BGĐ/TCHC đang mở phải tự đổi trạng thái, không reload; BGĐ/TCHC nhận Push.
7. CTXH cập nhật `Đang thực hiện` → BGĐ/TCHC tự cập nhật và nhận Push.
8. CTXH cập nhật `Hoàn thành` → BGĐ/TCHC tự cập nhật và nhận Push.
9. Kiểm tra báo cáo tuần của CTXH và báo cáo toàn Trung tâm.

### Gửi thử Push theo email từ Apps Script

Có thể chạy:
`guiThuChiDaoDieuHanhTheoEmail('email@domain.com')`

Không cần tìm UID thủ công.
