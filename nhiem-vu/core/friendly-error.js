/** Chuẩn hóa lỗi kỹ thuật thành thông báo tiếng Việt dành cho người dùng cuối. */
function rawMessage(error) {
  if (typeof error === "string") return error.trim();
  return String(error?.message || error?.code || "").trim();
}

export function isPermissionDeniedError(error) {
  const code = String(error?.code || "").toLowerCase();
  const message = rawMessage(error).toLowerCase();
  return code.includes("permission-denied")
    || code.includes("permission_denied")
    || /missing or insufficient permissions/.test(message)
    || /insufficient permissions/.test(message);
}

export function friendlyErrorMessage(error, fallback = "Không thực hiện được thao tác. Vui lòng thử lại.") {
  const message = rawMessage(error);
  const code = String(error?.code || "").toLowerCase();
  if (isPermissionDeniedError(error)) {
    return "Tài khoản chưa được cấp quyền phù hợp cho thao tác này. Vui lòng bấm Cập nhật; nếu lỗi vẫn còn, liên hệ quản trị viên.";
  }
  if (code.includes("unavailable") || /network|failed to fetch|offline/i.test(message)) {
    return "Không kết nối được hệ thống. Vui lòng kiểm tra mạng và thử lại.";
  }
  if (code.includes("unauthenticated") || /id token|đăng nhập|authentication/i.test(message)) {
    return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
  }
  if (code.includes("already-exists")) return "Dữ liệu đã tồn tại. Vui lòng bấm Cập nhật và kiểm tra lại.";
  if (code.includes("not-found")) return "Không tìm thấy dữ liệu cần xử lý. Vui lòng bấm Cập nhật.";
  return message || fallback;
}
