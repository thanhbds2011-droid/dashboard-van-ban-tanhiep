/**
 * Production 3B.1 - User Context
 * Lưu ngữ cảnh người dùng hiện tại cho toàn bộ module.
 */

let currentUser = null;

function normalizeText(value) {
  return String(value ?? "").trim();
}

export const UserContext = Object.freeze({
  setUser(user = {}) {
    currentUser = Object.freeze({
      uid: normalizeText(user.uid),
      email: normalizeText(user.email).toLowerCase(),
      fullName: normalizeText(user.fullName),
      role: normalizeText(user.role).toUpperCase(),
      departmentId: normalizeText(user.departmentId).toUpperCase(),
      teamId: normalizeText(user.teamId).toUpperCase(),
      position: normalizeText(user.position),
      employeeCode: normalizeText(user.employeeCode),
      kpiReviewerEmail: normalizeText(user.kpiReviewerEmail).toLowerCase(),
      active: user.active === true
    });

    return currentUser;
  },

  getUser() {
    return currentUser;
  },

  requireUser() {
    if (!currentUser?.uid) {
      throw new Error("Chưa có ngữ cảnh người dùng hợp lệ.");
    }

    return currentUser;
  },

  clear() {
    currentUser = null;
  },

  isAuthenticated() {
    return Boolean(currentUser?.uid && currentUser?.active);
  },

  hasRole(...roles) {
    const normalizedRoles = roles.map(role => normalizeText(role).toUpperCase());
    return normalizedRoles.includes(currentUser?.role || "");
  },

  belongsToDepartment(departmentId) {
    return (
      normalizeText(departmentId).toUpperCase() ===
      (currentUser?.departmentId || "")
    );
  }
});
