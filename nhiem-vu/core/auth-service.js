/**
 * Authentication & profile bootstrap V1.11.1.
 *
 * Nguồn quyền:
 * - Firebase Authentication: danh tính/UID thật.
 * - accessAccounts/{email}: quyền được cấp.
 * - users/{uid}: hồ sơ vận hành.
 *
 * V1.11.1:
 * - Không để bootstrap treo vô hạn: từng bước có timeout + mã lỗi rõ ràng.
 * - Bỏ lượt đọc users/{uid} lần thứ hai sau setDoc; write ACK là đủ cho phiên hiện tại.
 * - Báo tiến độ để UI hiển thị đúng bước đang xử lý.
 * - Giữ nguyên UID Firebase và mô hình accessAccounts hiện hữu.
 */

import { FirebaseService } from "./firebase-service.js?v=20260810.V1_10_6";
import { UserContext } from "./user-context.js?v=20260810.V1_10_6";

const LOGIN_URL = "./login.html";
const AUTH_TIMEOUT_MS = 10000;
const READ_TIMEOUT_MS = 8000;
const WRITE_TIMEOUT_MS = 8000;

let lastDiagnostic = null;

function clean(value) { return String(value ?? "").trim(); }
function normalizeEmail(value) { return clean(value).toLowerCase(); }
function normalizeRole(value) { return clean(value).toUpperCase(); }
function normalizeDepartment(value) { return clean(value).toUpperCase(); }
function normalizeAdditionalRoles(value) {
  const roles = Array.isArray(value) ? value : [];
  return [...new Set(roles.map(normalizeRole).filter(Boolean))].sort();
}
function hasOwn(object, key) { return Object.prototype.hasOwnProperty.call(object || {}, key); }

function codedError(code, message, cause = null) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function withTimeout(promise, timeoutMs, code, message) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = window.setTimeout(() => reject(codedError(code, message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) window.clearTimeout(timer);
  });
}

function normalizeFirebaseError(error, fallbackCode = "AUTH_BOOTSTRAP_FAILED") {
  if (!error) return codedError(fallbackCode, "Không thể tải tài khoản.");
  if (String(error.code || "").startsWith("AUTH_")) return error;
  const firebaseCode = String(error.code || "");
  if (firebaseCode.includes("permission-denied")) {
    return codedError("AUTH_PERMISSION_DENIED", "Firestore từ chối quyền khi tải/đồng bộ tài khoản. Hãy kiểm tra accessAccounts, users và Firestore Rules.", error);
  }
  if (firebaseCode.includes("unavailable")) {
    return codedError("AUTH_FIRESTORE_UNAVAILABLE", "Không kết nối được Firestore. Hãy kiểm tra Internet rồi thử lại.", error);
  }
  if (firebaseCode.includes("unauthenticated")) {
    return codedError("AUTH_SESSION_EXPIRED", "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.", error);
  }
  return codedError(fallbackCode, clean(error.message) || "Không thể tải tài khoản.", error);
}

function emitProgress(callback, stage, message) {
  const data = { stage, message, at: Date.now() };
  lastDiagnostic = { ...(lastDiagnostic || {}), lastStage: stage, lastMessage: message, lastAt: data.at };
  try { callback?.(data); } catch (_) { /* UI callback không được làm hỏng auth */ }
}

async function readAccessAccount(firebaseUser, progress) {
  const email = normalizeEmail(firebaseUser?.email);
  if (!email) throw codedError("AUTH_EMAIL_MISSING", "Tài khoản Google không cung cấp email để kiểm tra quyền truy cập.");

  emitProgress(progress, "ACCESS_ACCOUNT", "Đang kiểm tra quyền truy cập…");
  const accessRef = FirebaseService.doc(FirebaseService.db, "accessAccounts", email);
  let accessSnapshot;
  try {
    accessSnapshot = await withTimeout(
      FirebaseService.getDoc(accessRef),
      READ_TIMEOUT_MS,
      "AUTH_ACCESS_TIMEOUT",
      "Quá thời gian kiểm tra danh sách tài khoản được phép truy cập."
    );
  } catch (error) {
    throw normalizeFirebaseError(error, "AUTH_ACCESS_READ_FAILED");
  }

  if (!accessSnapshot.exists()) {
    throw codedError("AUTH_ACCESS_NOT_FOUND", `Email ${email} chưa được cấp quyền sử dụng hệ thống. Vui lòng liên hệ Phòng Tổ chức – Hành chính.`);
  }
  const access = accessSnapshot.data() || {};
  if (access.active !== true) throw codedError("AUTH_ACCESS_INACTIVE", "Tài khoản hiện đã ngừng hoạt động.");
  return { email, access };
}

function buildProfileFromAccess(firebaseUser, accessEmail, access, existingProfile = null) {
  const role = normalizeRole(access.role);
  const departmentId = normalizeDepartment(access.departmentId);
  if (!role || !departmentId) {
    throw codedError("AUTH_ACCESS_INCOMPLETE", "Dữ liệu tài khoản được cấp quyền thiếu Phòng/Khu hoặc vai trò.");
  }

  const profile = {
    email: accessEmail,
    fullName: clean(access.fullName) || clean(existingProfile?.fullName) || clean(firebaseUser.displayName) || accessEmail,
    departmentId,
    role,
    teamId: clean(access.teamId) || clean(existingProfile?.teamId),
    employeeCode: clean(access.employeeCode) || clean(existingProfile?.employeeCode),
    additionalRoles: hasOwn(access, "additionalRoles")
      ? normalizeAdditionalRoles(access.additionalRoles)
      : normalizeAdditionalRoles(existingProfile?.additionalRoles),
    taskNotificationCoordinator: access.taskNotificationCoordinator === true,
    active: true
  };

  if (hasOwn(access, "position")) profile.position = clean(access.position);
  else if (hasOwn(existingProfile, "position")) profile.position = clean(existingProfile.position);

  if (hasOwn(access, "leaderLevel")) profile.leaderLevel = normalizeRole(access.leaderLevel);
  else if (hasOwn(existingProfile, "leaderLevel")) profile.leaderLevel = normalizeRole(existingProfile.leaderLevel);

  if (typeof access.isDepartmentHead === "boolean") profile.isDepartmentHead = access.isDepartmentHead;
  else if (typeof existingProfile?.isDepartmentHead === "boolean") profile.isDepartmentHead = existingProfile.isDepartmentHead;

  return profile;
}

function profileNeedsSync(existingProfile, desiredProfile) {
  if (!existingProfile) return true;
  const stringFields = ["email", "fullName", "departmentId", "role", "position", "teamId", "employeeCode", "leaderLevel"];
  if (stringFields.some(field => clean(existingProfile[field]) !== clean(desiredProfile[field]))) return true;
  if (existingProfile.active !== true) return true;
  if ((existingProfile.taskNotificationCoordinator === true) !== (desiredProfile.taskNotificationCoordinator === true)) return true;
  if (JSON.stringify(normalizeAdditionalRoles(existingProfile.additionalRoles)) !== JSON.stringify(normalizeAdditionalRoles(desiredProfile.additionalRoles))) return true;
  const existingHead = typeof existingProfile.isDepartmentHead === "boolean" ? existingProfile.isDepartmentHead : null;
  const desiredHead = typeof desiredProfile.isDepartmentHead === "boolean" ? desiredProfile.isDepartmentHead : null;
  return existingHead !== desiredHead;
}

async function loadOrCreateProfile(firebaseUser, progress) {
  emitProgress(progress, "PROFILE_READ", "Đang tải hồ sơ và quyền tài khoản…");
  const profileRef = FirebaseService.doc(FirebaseService.db, "users", firebaseUser.uid);

  let profileSnapshot;
  let accessResult;
  try {
    [profileSnapshot, accessResult] = await Promise.all([
      withTimeout(
        FirebaseService.getDoc(profileRef),
        READ_TIMEOUT_MS,
        "AUTH_PROFILE_TIMEOUT",
        "Quá thời gian tải hồ sơ người dùng."
      ),
      readAccessAccount(firebaseUser, progress)
    ]);
  } catch (error) {
    throw normalizeFirebaseError(error, "AUTH_PROFILE_READ_FAILED");
  }

  const existingProfile = profileSnapshot.exists() ? (profileSnapshot.data() || {}) : null;
  const desiredProfile = buildProfileFromAccess(firebaseUser, accessResult.email, accessResult.access, existingProfile);

  if (!existingProfile || profileNeedsSync(existingProfile, desiredProfile)) {
    emitProgress(progress, "PROFILE_SYNC", existingProfile ? "Đang đồng bộ thay đổi quyền tài khoản…" : "Đang khởi tạo hồ sơ tài khoản…");
    const writePayload = {
      ...desiredProfile,
      ...(!existingProfile ? { createdAt: FirebaseService.serverTimestamp() } : {}),
      updatedAt: FirebaseService.serverTimestamp()
    };
    try {
      await withTimeout(
        FirebaseService.setDoc(profileRef, writePayload, { merge: true }),
        WRITE_TIMEOUT_MS,
        "AUTH_PROFILE_SYNC_TIMEOUT",
        "Quá thời gian đồng bộ hồ sơ tài khoản."
      );
    } catch (error) {
      throw normalizeFirebaseError(error, "AUTH_PROFILE_SYNC_FAILED");
    }
  }

  // Không GET lại lần thứ hai. Firestore đã ACK write; quyền dùng cho phiên hiện tại lấy từ accessAccounts.
  return { ...(existingProfile || {}), ...desiredProfile };
}

export const AuthService = Object.freeze({
  async initializeUserContext(options = {}) {
    const progress = typeof options?.onProgress === "function" ? options.onProgress : null;
    const startedAt = Date.now();
    lastDiagnostic = { startedAt, lastStage: "START", lastMessage: "Bắt đầu xác thực" };

    try {
      FirebaseService.assertReady();
      emitProgress(progress, "AUTH_STATE", "Đang xác thực phiên đăng nhập…");
      const firebaseUser = FirebaseService.auth.currentUser || await withTimeout(
        FirebaseService.waitForAuthState(),
        AUTH_TIMEOUT_MS,
        "AUTH_STATE_TIMEOUT",
        "Không nhận được trạng thái đăng nhập sau 10 giây. Hãy tải lại trang hoặc đăng nhập lại."
      );

      if (!firebaseUser) {
        lastDiagnostic = { ...lastDiagnostic, finishedAt: Date.now(), result: "NO_USER" };
        this.redirectToLogin();
        return null;
      }

      lastDiagnostic = { ...lastDiagnostic, uid: firebaseUser.uid, email: normalizeEmail(firebaseUser.email) };
      const profile = await loadOrCreateProfile(firebaseUser, progress);
      if (profile.active !== true) throw codedError("AUTH_PROFILE_INACTIVE", "Tài khoản hiện đã ngừng hoạt động.");
      if (!profile.role || !profile.departmentId) throw codedError("AUTH_PROFILE_INCOMPLETE", "Hồ sơ người dùng thiếu vai trò hoặc Phòng/Khu.");

      emitProgress(progress, "READY", "Đã tải tài khoản. Đang mở ứng dụng…");
      const context = UserContext.setUser({
        uid: firebaseUser.uid,
        email: profile.email || firebaseUser.email || "",
        fullName: profile.fullName || firebaseUser.displayName || "",
        role: profile.role,
        departmentId: profile.departmentId,
        teamId: profile.teamId || "",
        position: profile.position || "",
        employeeCode: profile.employeeCode || "",
        leaderLevel: profile.leaderLevel || "",
        isDepartmentHead: typeof profile.isDepartmentHead === "boolean" ? profile.isDepartmentHead : null,
        additionalRoles: profile.additionalRoles || [],
        active: profile.active === true
      });
      lastDiagnostic = { ...lastDiagnostic, finishedAt: Date.now(), durationMs: Date.now() - startedAt, result: "READY" };
      return context;
    } catch (error) {
      const normalized = normalizeFirebaseError(error);
      lastDiagnostic = {
        ...(lastDiagnostic || {}),
        finishedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        result: "FAILED",
        errorCode: normalized.code || "AUTH_BOOTSTRAP_FAILED",
        errorMessage: normalized.message || String(normalized)
      };
      throw normalized;
    }
  },

  getLastDiagnostic() {
    return lastDiagnostic ? { ...lastDiagnostic } : null;
  },

  async logout() {
    UserContext.clear();
    await FirebaseService.logout();
    this.redirectToLogin();
  },

  redirectToLogin() {
    const returnUrl = encodeURIComponent(`${window.location.pathname}${window.location.hash}`);
    window.location.replace(`${LOGIN_URL}?returnUrl=${returnUrl}`);
  }
});

export async function initializeUserContext(options = {}) {
  return AuthService.initializeUserContext(options);
}
