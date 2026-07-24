/**
 * Production 3B.1 - Auth Service
 * Xác thực Firebase và nạp users/{uid} vào UserContext.
 */

import { FirebaseService } from "./firebase-service.js";
import { UserContext } from "./user-context.js";

const LOGIN_URL = "./login.html";

export const AuthService = Object.freeze({
  async initializeUserContext() {
    FirebaseService.assertReady();

    const firebaseUser = await FirebaseService.waitForAuthState();

    if (!firebaseUser) {
      this.redirectToLogin();
      return null;
    }

    const profileRef = FirebaseService.doc(
      FirebaseService.db,
      "users",
      firebaseUser.uid
    );

    const profileSnapshot = await FirebaseService.getDoc(profileRef);

    if (!profileSnapshot.exists()) {
      throw new Error(
        "Không tìm thấy hồ sơ người dùng trong collection users."
      );
    }

    const profile = profileSnapshot.data() || {};

    if (profile.active !== true) {
      throw new Error("Tài khoản hiện đã ngừng hoạt động.");
    }

    if (!profile.role || !profile.departmentId) {
      throw new Error(
        "Hồ sơ người dùng thiếu role hoặc departmentId."
      );
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
    const returnUrl = encodeURIComponent(
      `${window.location.pathname}${window.location.hash}`
    );

    window.location.replace(`${LOGIN_URL}?returnUrl=${returnUrl}`);
  }
});

export async function initializeUserContext() {
  return AuthService.initializeUserContext();
}
