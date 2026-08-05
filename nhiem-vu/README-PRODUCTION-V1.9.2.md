# Nhiệm vụ và đánh giá KPI – Production V1.9.2

## Build
- Phiên bản: `V1.9.2`
- Build: `20260805.V1_9_2`

## Nội dung
- Đồng bộ toàn bộ chuỗi import JavaScript đang vận hành về cùng một build.
- Giữ hoạt động đồng thời ba luồng: cá nhân tự đăng ký; Trưởng/Phó phòng giao trực tiếp; BGĐ giao Phòng/Khu rồi phân công nội bộ.
- Chuẩn hóa payload phân công nội bộ và dữ liệu tiếp nhận Phòng/Khu cho nhiệm vụ cũ.
- Firestore Rules khóa đầu việc tự đăng ký không được phân công lại.
- PWA phát hiện bản mới và cập nhật qua Service Worker.

## Điểm vào production
- `nhiem-vu/index.html`
- `nhiem-vu/app-v3.js`
- `nhiem-vu/core/`
- `nhiem-vu/services/`
- `nhiem-vu/modules/`
