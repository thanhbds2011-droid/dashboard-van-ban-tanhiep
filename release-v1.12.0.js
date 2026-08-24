/**
 * V1.12.0 - UAT Stability & Multi-department hardening.
 * - Tự phát hiện thay đổi Phòng/Khu/role/HEAD-DEPUTY và reload phạm vi làm việc.
 * - PWA iOS có watchdog/recovery, giữ một cache trước để tránh trắng màn hình sau update.
 * - Push chạy nền, không còn chặn lưu tiến độ/hoàn thành nhiệm vụ.
 * - Xác nhận điểm kết thúc UI ngay sau Firestore ACK; audit/reload chạy hậu xử lý.
 * - Bỏ query CDTN thừa cho lãnh đạo không thuộc Chi đoàn; giảm permission-denied giả.
 * - Nhật ký nhiệm vụ fallback theo đúng scope người/phòng khi Rules giới hạn.
 */
console.info("Nhiệm vụ & KPI V1.12.0: UAT Stability & Multi-department hardening đã nạp");
