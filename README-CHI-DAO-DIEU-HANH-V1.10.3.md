# V1.10.3 — PHÂN HỆ CHỈ ĐẠO ĐIỀU HÀNH

## Phạm vi
Bổ sung phân hệ **Chỉ đạo điều hành** độc lập với Nhiệm vụ và KPI.

Luồng nghiệp vụ:

Ban Giám đốc / đầu mối Phòng Tổ chức - Hành chính → ghi nhận chỉ đạo → giao Phòng/Khu chủ trì/phối hợp → Phòng/Khu cập nhật tiến độ/kết quả → tổng hợp báo cáo tuần.

## Phân quyền
- `ADMIN`, `DIRECTOR`, `TCHC_COORDINATOR`, Trưởng/Phó TCHC: xem toàn Trung tâm; tạo, sửa, chuyển đơn vị, đóng/mở lại, xóa mềm; cập nhật thay Phòng/Khu; tổng hợp/lưu báo cáo toàn Trung tâm.
- Tài khoản hoạt động của Phòng/Khu: xem các chỉ đạo có liên quan đơn vị mình; thêm cập nhật tiến độ/kết quả của chính đơn vị; tổng hợp, lưu, xuất Word và in/lưu PDF báo cáo tuần của đơn vị mình.
- Phòng/Khu không sửa nội dung chỉ đạo gốc và không xem chi tiết cập nhật của đơn vị khác.

## Dữ liệu mới
- `executiveDirectives`: nội dung chỉ đạo gốc.
- `executiveDirectiveUpdates`: lịch sử cập nhật tiến độ/kết quả và audit. Chỉ thêm mới, không sửa/xóa.
- `executiveWeeklyReports`: bản báo cáo tuần đã lưu.

Không đọc/ghi các collection nghiệp vụ KPI/Nhiệm vụ để thực hiện chức năng mới.

## File mới
- `nhiem-vu/executive-directives.css`
- `nhiem-vu/services/executive-directive-service.js`
- `nhiem-vu/modules/executive-directives/executive-directives-view.js`
- `nhiem-vu/release-v1.10.3.js`

## File tích hợp thay đổi
- `nhiem-vu/index.html`: thêm menu/CSS/module version V1.10.3.
- `nhiem-vu/app-v3.js`: thêm route `#/directives`.
- `nhiem-vu/core/permissions.js`: thêm quyền Chỉ đạo điều hành.
- `nhiem-vu/core/app-version.js`, `nhiem-vu/pwa.js`, `nhiem-vu/sw.js` và cache-busting module imports: đồng bộ V1.10.3.
- `firestore.rules` và `deployment/firestore.rules`: thêm Rules cho 3 collection mới.

`firestore.indexes.json` giữ nguyên vì các truy vấn mới chỉ dùng single-field/array-contains và không cần composite index mới.
Apps Script V3.3.1 / V4.2.0 / V6.4.0 giữ nguyên.

## Triển khai
1. Sao lưu source đang chạy.
2. Thay source bằng gói FULL V1.10.3, giữ đúng cấu trúc repository hiện tại.
3. Firebase Console → Firestore Database → Rules → dán **toàn bộ** `firestore.rules` của gói V1.10.3 → Publish.
4. Không cần thay Firestore Indexes.
5. Không cần thay Apps Script.
6. Sau GitHub Pages deploy, mở ứng dụng và tải lại cứng một lần. PWA V1.10.3 tự đổi `CACHE_NAME` và loại cache cũ khi service worker activate.

## Smoke test bắt buộc
1. Đăng nhập BGĐ → thấy menu **Chỉ đạo điều hành** → tạo chỉ đạo cho một Phòng/Khu.
2. Đăng nhập đầu mối/Trưởng-Phó TCHC → thấy toàn Trung tâm → sửa và cập nhật thay BGĐ được.
3. Đăng nhập Phòng/Khu được giao → chỉ thấy chỉ đạo liên quan → cập nhật tiến độ/kết quả được.
4. Phòng/Khu → Báo cáo tuần → chỉ tổng hợp được dữ liệu của đơn vị mình → xuất Word và In/Lưu PDF.
5. BGĐ/TCHC → Báo cáo tuần → tổng hợp Toàn Trung tâm hoặc từng Phòng/Khu.
6. Xóa chỉ đạo bằng BGĐ/TCHC → biến mất khỏi danh sách sử dụng nhưng document/lịch sử vẫn còn (soft delete).
7. Regression: kiểm tra lại Nhiệm vụ, Danh mục công việc, KPI, Hội đồng, Báo cáo và Push hiện hữu.
