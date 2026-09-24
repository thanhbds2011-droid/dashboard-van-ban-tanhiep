BỘ KHÔI PHỤC ROOT - HỆ THỐNG NHẮC VIỆC VĂN BẢN
================================================

Mục tiêu:
- Root /dashboard-van-ban-tanhiep/ = Hệ thống nhắc việc văn bản.
- /dashboard-van-ban-tanhiep/nhiem-vu/ = KPI hiện tại, KHÔNG thay đổi.

Cách triển khai an toàn:
1. KHÔNG xóa hoặc ghi đè thư mục /nhiem-vu/.
2. Tải các file trong gói này lên THƯ MỤC GỐC repository.
3. Cho phép GitHub ghi đè các file trùng tên.
4. Không cần đổi Firebase, Firestore Rules, Apps Script hoặc dữ liệu KPI.
5. Sau GitHub Pages deploy, mở URL root và tải lại cứng một lần (Ctrl+F5 trên máy tính).
6. Kiểm tra lại URL /nhiem-vu/ sau đó.

File lõi được khôi phục nguyên bản từ commit đúng a6c71ede9ba01685117d25f5145d2c958baaedfb:
- index.html
- login.html
- manifest.json
- nhap.html
- diagnostic.html
- OneSignalSDKWorker.js
- icon-192.png
- icon-512.png

File chuyển tiếp an toàn được bổ sung:
- sw.js: gỡ đăng ký Service Worker KPI bị chép nhầm ở root, KHÔNG xóa Cache Storage.
- manifest.webmanifest: thay manifest KPI bị chép nhầm ở root bằng manifest Nhắc việc.
- offline.html: thay trang offline KPI bị chép nhầm ở root.

Lưu ý:
- Các file KPI rác còn tồn tại ở root nhưng không được index.html Nhắc việc gọi sẽ không ảnh hưởng vận hành.
- Không xóa hàng loạt file root nếu chưa đối chiếu vì repository còn các file cấu hình/deployment có thể phục vụ KPI.
