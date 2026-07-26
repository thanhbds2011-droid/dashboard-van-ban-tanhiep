/**
 * Production - Auth Service ổn định.
 * - Không để màn hình "Đang tải tài khoản" treo vô thời hạn.
 * - Tự tạo/đồng bộ users/{uid} từ accessAccounts/{email} khi cần.
 * - Hiển thị lỗi rõ ràng để người dùng thử lại hoặc đăng xuất.
 */

import { FirebaseService } from "./firebase-service.js";
import { UserContext } from "./user-context.js";

const LOGIN_URL = "./login.html";
const AUTH_TIMEOUT_MS = 15000;
const PROFILE_TIMEOUT_MS = 15000;

function withTimeout(promise, timeoutMs, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timer));
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

async function loadOrCreateProfile(firebaseUser) {
  const email = normalizeEmail(firebaseUser.email);
  if (!email) {
    throw new Error("Tài khoản Google không cung cấp email để kiểm tra quyền truy cập.");
  }

  const accessRef = FirebaseService.doc(FirebaseService.db, "accessAccounts", email);
  const accessSnapshot = await withTimeout(
    FirebaseService.getDoc(accessRef),
    PROFILE_TIMEOUT_MS,
    "Quá thời gian kiểm tra danh sách tài khoản được phép truy cập."
  );

  if (!accessSnapshot.exists()) {
    throw new Error("Email chưa có trong danh sách accessAccounts. Vui lòng liên hệ Phòng Tổ chức – Hành chính.");
  }

  const access = accessSnapshot.data() || {};
  if (access.active !== true) {
    throw new Error("Tài khoản hiện đã ngừng hoạt động.");
  }
  if (!access.departmentId || !access.role) {
    throw new Error("Dữ liệu accessAccounts thiếu departmentId hoặc role.");
  }

  const profileRef = FirebaseService.doc(FirebaseService.db, "users", firebaseUser.uid);
  const currentSnapshot = await withTimeout(
    FirebaseService.getDoc(profileRef),
    PROFILE_TIMEOUT_MS,
    "Quá thời gian đọc hồ sơ người dùng. Hãy kiểm tra mạng hoặc Firestore Rules."
  );
  const current = currentSnapshot.exists() ? (currentSnapshot.data() || {}) : {};

  // accessAccounts là nguồn thẩm quyền duy nhất cho role/phòng/chức danh.
  // Mỗi lần đăng nhập đều đồng bộ lại để tránh hồ sơ users bị cũ.
  const profile = {
    email,
    fullName: access.fullName || firebaseUser.displayName || current.fullName || email,
    departmentId: access.departmentId,
    role: access.role,
    position: access.position || "",
    teamId: access.teamId || "",
    employeeCode: access.employeeCode || "",
    kpiReviewerEmail: access.kpiReviewerEmail || "",
    taskNotificationCoordinator: access.taskNotificationCoordinator === true,
    active: true,
    authProvider: "google.com",
    updatedAt: FirebaseService.serverTimestamp()
  };
  if (!currentSnapshot.exists()) profile.createdAt = FirebaseService.serverTimestamp();

  await withTimeout(
    FirebaseService.setDoc(profileRef, profile, { merge: true }),
    PROFILE_TIMEOUT_MS,
    "Không thể đồng bộ hồ sơ người dùng từ accessAccounts. Hãy kiểm tra Firestore Rules."
  );

  return { ...current, ...profile, updatedAt: current.updatedAt || null };
}

export const AuthService = Object.freeze({
  async initializeUserContext() {
    FirebaseService.assertReady();

    const firebaseUser = FirebaseService.auth.currentUser || await withTimeout(
      FirebaseService.waitForAuthState(),
      AUTH_TIMEOUT_MS,
      "Không nhận được trạng thái đăng nhập sau 15 giây. Hãy tải lại trang hoặc đăng nhập lại."
    );

    if (!firebaseUser) {
      this.redirectToLogin();
      return null;
    }

    const profile = await loadOrCreateProfile(firebaseUser);

    if (profile.active !== true) {
      throw new Error("Tài khoản hiện đã ngừng hoạt động.");
    }
    if (!profile.role || !profile.departmentId) {
      throw new Error("Hồ sơ người dùng thiếu role hoặc departmentId.");
    }

    return UserContext.setUser({
      uid: firebaseUser.uid,
      email: profile.email || firebaseUser.email || "",
      fullName: profile.fullName || firebaseUser.displayName || "",
      role: profile.role,
      departmentId: profile.departmentId,
      teamId: profile.teamId || "",
      position: profile.position || "",
      employeeCode: profile.employeeCode || "",
      kpiReviewerEmail: profile.kpiReviewerEmail || "",
      active: profile.active === true
    });
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

export async function initializeUserContext() {
  return AuthService.initializeUserContext();
}
