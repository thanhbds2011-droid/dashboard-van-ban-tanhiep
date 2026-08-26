/**
 * Xác nhận write Firestore hữu hạn cho các thao tác người dùng cuối.
 *
 * V1.18.6:
 * - Giữ cơ chế timeout + đọc lại server của V1.18.5 cho mọi write hiện có.
 * - Bổ sung chế độ early verify cho các write nhạy cảm với WebChannel: nếu server
 *   đã ghi thành công nhưng SDK chưa trả ACK, UI được giải phóng ngay khi verify xác nhận.
 * - operationPromise luôn được gắn handler để không phát sinh unhandled rejection
 *   khi verify xác nhận trước ACK của SDK.
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

async function confirmWithEarlyServerVerification(operationPromise, verifyServer, options = {}) {
  const earlyVerifyAfterMs = Math.max(250, Number(options.earlyVerifyAfterMs || 1500));
  const overallTimeoutMs = Math.max(
    earlyVerifyAfterMs + 1000,
    Number(options.overallTimeoutMs || WRITE_CONFIRMATION_TIMEOUT_MS)
  );
  const verifyAttempts = Math.max(1, Number(options.verifyAttempts || WRITE_VERIFY_ATTEMPTS));
  const verifyDelayMs = Math.max(0, Number(options.verifyDelayMs ?? WRITE_VERIFY_DELAY_MS));
  const verifyReadTimeoutMs = Math.max(1000, Number(options.verifyReadTimeoutMs || WRITE_VERIFY_READ_TIMEOUT_MS));
  const startedAt = Date.now();

  let operationSucceeded = false;
  let operationError = null;
  const operationState = Promise.resolve(operationPromise).then(
    () => {
      operationSucceeded = true;
      return { kind: "operation-success" };
    },
    error => {
      operationError = error;
      return { kind: "operation-error", error };
    }
  );

  const first = await Promise.race([
    operationState,
    delay(earlyVerifyAfterMs).then(() => ({ kind: "probe" }))
  ]);
  if (first.kind === "operation-success") return { recovered: false, earlyVerified: false };
  if (first.kind === "operation-error") throw first.error;

  for (let attempt = 0; attempt < verifyAttempts; attempt += 1) {
    const elapsed = Date.now() - startedAt;
    const remaining = overallTimeoutMs - elapsed;
    if (remaining <= 0) break;

    const verifyBudget = Math.max(1000, Math.min(verifyReadTimeoutMs, remaining));
    const verifyState = withTimeout(
      Promise.resolve().then(() => verifyServer()),
      verifyBudget,
      readTimeoutError
    ).then(
      confirmed => ({ kind: "verify", confirmed: confirmed === true }),
      error => ({ kind: "verify-error", error })
    );

    const outcome = await Promise.race([operationState, verifyState]);
    if (outcome.kind === "operation-success") return { recovered: false, earlyVerified: false };
    if (outcome.kind === "operation-error") throw outcome.error;
    if (outcome.kind === "verify" && outcome.confirmed) {
      return { recovered: true, earlyVerified: true };
    }

    if (attempt < verifyAttempts - 1 && verifyDelayMs > 0) {
      const delayBudget = Math.max(0, Math.min(verifyDelayMs, overallTimeoutMs - (Date.now() - startedAt)));
      if (delayBudget > 0) {
        const duringDelay = await Promise.race([
          operationState,
          delay(delayBudget).then(() => ({ kind: "delay-complete" }))
        ]);
        if (duringDelay.kind === "operation-success") return { recovered: false, earlyVerified: false };
        if (duringDelay.kind === "operation-error") throw duringDelay.error;
      }
    }
  }

  if (operationSucceeded) return { recovered: false, earlyVerified: false };
  if (operationError) throw operationError;
  throw writeTimeoutError();
}

/**
 * @param {Promise<any>} operationPromise Firestore write/transaction đang chạy.
 * @param {Function} verifyServer async function -> true nếu server đã ghi đúng nghiệp vụ.
 */
export async function confirmWriteWithServerRecovery(operationPromise, verifyServer, options = {}) {
  if (Number(options.earlyVerifyAfterMs || 0) > 0) {
    return confirmWithEarlyServerVerification(operationPromise, verifyServer, options);
  }

  const timeoutMs = Number(options.timeoutMs || WRITE_CONFIRMATION_TIMEOUT_MS);
  const verifyAttempts = Math.max(1, Number(options.verifyAttempts || WRITE_VERIFY_ATTEMPTS));
  const verifyDelayMs = Math.max(0, Number(options.verifyDelayMs ?? WRITE_VERIFY_DELAY_MS));
  const verifyReadTimeoutMs = Math.max(1000, Number(options.verifyReadTimeoutMs || WRITE_VERIFY_READ_TIMEOUT_MS));

  try {
    await withTimeout(operationPromise, timeoutMs, writeTimeoutError);
    return { recovered: false, earlyVerified: false };
  } catch (error) {
    if (String(error?.code || "") !== "write-confirmation-timeout") throw error;

    for (let attempt = 0; attempt < verifyAttempts; attempt += 1) {
      try {
        const confirmed = await withTimeout(
          Promise.resolve().then(() => verifyServer()),
          verifyReadTimeoutMs,
          readTimeoutError
        );
        if (confirmed === true) return { recovered: true, earlyVerified: false };
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
