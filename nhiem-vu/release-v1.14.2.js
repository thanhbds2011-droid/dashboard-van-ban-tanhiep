/**
 * V1.14.2 - Milestone KPI & Registration Approval Stability.
 * - Mốc đã hoàn thành được tính ngay, kể cả hoàn thành trước hạn.
 * - Đúng/sớm hạn = 100; trễ 1–3 ngày = 80; trễ 4–5 ngày = 60; trễ >5 ngày = 0.
 * - Mốc chưa hoàn thành và chưa đến hạn chưa tính; đã đến hạn chưa hoàn thành = 0.
 * - UX tự đánh giá hiển thị rõ từng mốc và cách tính, bỏ thuật ngữ kỹ thuật.
 * - Duyệt mục đã chọn chỉ duyệt checkbox được chọn; mục khác vẫn PENDING.
 * - Firestore Rules cho phép legacy registration được phục hồi deadline và APPROVED trong cùng batch.
 */
console.info("Nhiệm vụ & KPI V1.14.2: Milestone KPI & Registration Approval Stability đã nạp");
