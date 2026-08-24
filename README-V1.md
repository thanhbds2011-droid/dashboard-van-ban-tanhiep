# Hệ thống Nhiệm vụ và đánh giá KPI – Phiên bản 1.0.0

## Mã nguồn đang vận hành
- `index.html`
- `app-v3.js`
- `core/`
- `services/`
- `modules/`
- `v3.css`, `kpi.css`

## Điều chỉnh chính
- Bỏ truy vấn `holidays`; thời hạn tính theo ngày lịch.
- Sửa vòng lặp đăng nhập/chuyển trang bằng trang đăng nhập Google riêng.
- Ngăn nhiều lượt render router chạy chồng nhau.
- Service Worker chỉ cache bộ V3 và không tự tải lại liên tục.
- Rút gọn tiêu đề giao diện, bỏ thuật ngữ kỹ thuật.
- Đồng bộ OneSignal sau khi người dùng đăng nhập.

## Lưu ý
Các file `app.js`, `dashboard.js`, `styles.css`, `kpi-module.js` là mã nguồn thế hệ cũ, không được `index.html` gọi. Giữ lại tạm thời để đối chiếu; không chỉnh sửa khi vận hành bản V1.
