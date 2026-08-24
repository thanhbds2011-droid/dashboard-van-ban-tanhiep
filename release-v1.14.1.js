/**
 * V1.14.1 - UAT Workflow Compatibility Hotfix.
 * - Sửa query taskMilestones để phù hợp Firestore Rules cho owner/Phòng-Khu.
 * - Phục hồi snapshot deadline của đăng ký cũ từ kỳ KPI + standardTasks khi Trưởng duyệt.
 * - Đầu việc phát sinh cũ yêu cầu nhập hạn cụ thể; tuyệt đối không fallback ngày cuối kỳ.
 * - Bổ sung xử lý lỗi UI để không còn Uncaught Promise khi mở cập nhật/duyệt kế hoạch.
 * - Giữ toàn bộ tối ưu free-tier 140 người của V1.14.0.
 */
console.info("Nhiệm vụ & KPI V1.14.1: Workflow Compatibility Hotfix đã nạp");
