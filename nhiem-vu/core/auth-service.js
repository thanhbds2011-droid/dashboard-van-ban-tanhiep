/**
 * Dịch vụ xác thực và đồng bộ hồ sơ người dùng.
 *
 * Nguyên tắc:
 * - accessAccounts/{email} là nguồn cấp quyền truy cập.
 * - users/{uid} là hồ sơ vận hành gắn với UID Firebase thật.
 * - Mỗi lần đăng nhập, các trường phân quyền trong users/{uid} được đối chiếu
 *   với accessAccounts để thay đổi vai trò/chức vụ có hiệu lực ổn định.
 */

import { FirebaseService } from "./firebase-service.js?v=20260805.V1_9_3";
import { UserContext } from "./user-context.js?v=20260805.V1_9_3";

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

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeEmail(value) {
  return clean(value).toLowerCase();
}

function normalizeRole(value) {
  return clean(value).toUpperCase();
}

function normalizeDepartment(value) {
  return clean(value).toUpperCase();
}

function normalizeAdditionalRoles(value) {
  const roles = Array.isArray(value) ? value : [];
  return [...new Set(roles.map(normalizeRole).filter(Boolean))].sort();
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

async function readAccessAccount(firebaseUser) {
  const email = normalizeEmail(firebaseUser?.email);
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
    throw new Error("Email chưa được cấp quyền sử dụng hệ thống. Vui lòng liên hệ Phòng Tổ chức – Hành chính.");
  }

  const access = accessSnapshot.data() || {};
  if (access.active !== true) {
    throw new Error("Tài khoản hiện đã ngừng hoạt động.");
  }

  return { email, access };
}

function buildProfileFromAccess(firebaseUser, accessEmail, access, existingProfile = null) {
  const role = normalizeRole(access.role);
  const departmentId = normalizeDepartment(access.departmentId);

  if (!role || !departmentId) {
    throw new Error("Dữ liệu tài khoản được cấp quyền thiếu Phòng/Khu hoặc vai trò.");
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

  // Các trường xác định Trưởng/Phó phòng chỉ lấy từ accessAccounts khi có.
  // Nếu accessAccounts chưa khai báo thì giữ nguyên dữ liệu đang có, không tự suy đoán.
  if (hasOwn(access, "position")) {
    profile.position = clean(access.position);
  } else if (hasOwn(existingProfile, "position")) {
    profile.position = clean(existingProfile.position);
  }

  if (hasOwn(access, "leaderLevel")) {
    profile.leaderLevel = normalizeRole(access.leaderLevel);
  } else if (hasOwn(existingProfile, "leaderLevel")) {
    profile.leaderLevel = normalizeRole(existingProfile.leaderLevel);
  }

  if (typeof access.isDepartmentHead === "boolean") {
    profile.isDepartmentHead = access.isDepartmentHead;
  } else if (typeof existingProfile?.isDepartmentHead === "boolean") {
    profile.isDepartmentHead = existingProfile.isDepartmentHead;
  }

  return profile;
}

function profileNeedsSync(existingProfile, desiredProfile) {
  if (!existingProfile) return true;

  const stringFields = [
    "email",
    "fullName",
    "departmentId",
    "role",
    "position",
    "teamId",
    "employeeCode",
    "leaderLevel"
  ];

  if (stringFields.some(field => clean(existingProfile[field]) !== clean(desiredProfile[field]))) {
    return true;
  }

  if (existingProfile.active !== true) return true;
  if ((existingProfile.taskNotificationCoordinator === true) !== (desiredProfile.taskNotificationCoordinator === true)) return true;
  if (
    JSON.stringify(normalizeAdditionalRoles(existingProfile.additionalRoles))
    !== JSON.stringify(normalizeAdditionalRoles(desiredProfile.additionalRoles))
  ) return true;

  const existingHead = typeof existingProfile.isDepartmentHead === "boolean" ? existingProfile.isDepartmentHead : null;
  const desiredHead = typeof desiredProfile.isDepartmentHead === "boolean" ? desiredProfile.isDepartmentHead : null;
  return existingHead !== desiredHead;
}

async function loadOrCreateProfile(firebaseUser) {
  const profileRef = FirebaseService.doc(FirebaseService.db, "users", firebaseUser.uid);

  const [profileSnapshot, accessResult] = await Promise.all([
    withTimeout(
      FirebaseService.getDoc(profileRef),
      PROFILE_TIMEOUT_MS,
      "Không tải được hồ sơ người dùng. Vui lòng kiểm tra kết nối mạng và thử lại."
    ),
    readAccessAccount(firebaseUser)
  ]);

  const existingProfile = profileSnapshot.exists() ? (profileSnapshot.data() || {}) : null;
  const desiredProfile = buildProfileFromAccess(
    firebaseUser,
    accessResult.email,
    accessResult.access,
    existingProfile
  );

  if (!existingProfile) {
    await withTimeout(
      FirebaseService.setDoc(profileRef, {
        ...desiredProfile,
        createdAt: FirebaseService.serverTimestamp(),
        updatedAt: FirebaseService.serverTimestamp()
      }, { merge: true }),
      PROFILE_TIMEOUT_MS,
      "Không thể khởi tạo hồ sơ người dùng. Vui lòng liên hệ quản trị viên."
    );
  } else if (profileNeedsSync(existingProfile, desiredProfile)) {
    await withTimeout(
      FirebaseService.setDoc(profileRef, {
        ...desiredProfile,
        updatedAt: FirebaseService.serverTimestamp()
      }, { merge: true }),
      PROFILE_TIMEOUT_MS,
      "Không thể đồng bộ thay đổi vai trò hoặc chức vụ. Vui lòng liên hệ quản trị viên."
    );
  }

  const refreshedSnapshot = await withTimeout(
    FirebaseService.getDoc(profileRef),
    PROFILE_TIMEOUT_MS,
    "Không tải được hồ sơ sau khi đồng bộ. Vui lòng thử lại."
  );

  return refreshedSnapshot.exists()
    ? (refreshedSnapshot.data() || desiredProfile)
    : desiredProfile;
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
      throw new Error("Hồ sơ người dùng thiếu vai trò hoặc Phòng/Khu.");
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
      leaderLevel: profile.leaderLevel || "",
      isDepartmentHead: typeof profile.isDepartmentHead === "boolean" ? profile.isDepartmentHead : null,
      additionalRoles: profile.additionalRoles || [],
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
