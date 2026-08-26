/**
 * Xác nhận write Firestore hữu hạn cho các thao tác người dùng cuối.
 *
 * Nếu SDK chưa trả kết quả trong thời gian cho phép, hệ thống đọc lại trực tiếp
 * từ server để xác định write đã commit hay chưa. Không yêu cầu hard refresh.
 */
export const WRITE_CONFIRMATION_TIMEOUT_MS = 15000;
export const WRITE_VERIFY_ATTEMPTS = 3;
export const WRITE_VERIFY_DELAY_MS = 1200;
export const WRITE_VERIFY_READ_TIMEOUT_MS = 5000;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function writeTimeoutError(message = "Máy chủ chưa xác nhận thao tác lưu trong thời gian cho phép.") {
  const error = new Error(message);
  error.code = "write-confirmation-timeout";
  return error;
}

function readTimeoutError() {
  const error = new Error("Không đọc được trạng thái xác nhận từ máy chủ trong thời gian cho phép.");
  error.code = "write-verification-timeout";
  return error;
}

async function withTimeout(promise, timeoutMs, errorFactory) {
  let timeoutId;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(errorFactory()), timeoutMs);
      })
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/**
 * @param {Promise<any>} operationPromise Firestore write/transaction đang chạy.
 * @param {Function} verifyServer async function -> true nếu server đã ghi đúng nghiệp vụ.
 */
export async function confirmWriteWithServerRecovery(operationPromise, verifyServer, options = {}) {
  const timeoutMs = Number(options.timeoutMs || WRITE_CONFIRMATION_TIMEOUT_MS);
  const verifyAttempts = Math.max(1, Number(options.verifyAttempts || WRITE_VERIFY_ATTEMPTS));
  const verifyDelayMs = Math.max(0, Number(options.verifyDelayMs ?? WRITE_VERIFY_DELAY_MS));
  const verifyReadTimeoutMs = Math.max(1000, Number(options.verifyReadTimeoutMs || WRITE_VERIFY_READ_TIMEOUT_MS));

  try {
    await withTimeout(operationPromise, timeoutMs, writeTimeoutError);
    return { recovered: false };
  } catch (error) {
    if (String(error?.code || "") !== "write-confirmation-timeout") throw error;

    for (let attempt = 0; attempt < verifyAttempts; attempt += 1) {
      try {
        const confirmed = await withTimeout(
          Promise.resolve().then(() => verifyServer()),
          verifyReadTimeoutMs,
          readTimeoutError
        );
        if (confirmed === true) return { recovered: true };
      } catch (verifyError) {
        // Chỉ retry trạng thái server. Lỗi verify không được che lỗi write gốc.
        if (String(verifyError?.code || "") !== "write-verification-timeout") {
          // permission/network trong bước verify vẫn để vòng retry hữu hạn xử lý.
        }
      }
      if (attempt < verifyAttempts - 1 && verifyDelayMs > 0) await delay(verifyDelayMs);
    }
    throw error;
  }
}
