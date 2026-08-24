/**
 * V1.14.0 - Free-tier Scale 140 Production.
 * - Deadline danh mục theo chu kỳ + hạn cụ thể.
 * - Theo tháng: 01 task/kỳ + nhiều mốc.
 * - Tiến độ KPI tự động theo ngày lịch 100/80/60/0.
 * - Form cập nhật rút gọn, push/audit không block.
 * - Phó Trưởng phòng được đọc báo cáo đơn vị nhưng không tự có quyền duyệt/xác nhận.
 * - Tối ưu tải theo nhu cầu, giảm Firestore reads/listeners, cache PWA và Drive polling cho khoảng 140 người.
 */
console.info("Nhiệm vụ & KPI V1.14.0: Free-tier Scale 140 Production đã nạp");
