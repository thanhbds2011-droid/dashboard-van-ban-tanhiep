/** Lưu ngữ cảnh người dùng hiện tại cho toàn bộ module. */
let currentUser = null;

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeAdditionalRoles(value) {
  const roles = Array.isArray(value) ? value : [];
  return Object.freeze([
    ...new Set(
      roles
        .map(role => normalizeText(role).toUpperCase())
        .filter(Boolean)
    )
  ]);
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
      leaderLevel: normalizeText(user.leaderLevel).toUpperCase(),
      isDepartmentHead: typeof user.isDepartmentHead === "boolean" ? user.isDepartmentHead : null,
      additionalRoles: normalizeAdditionalRoles(user.additionalRoles),
      employeeCode: normalizeText(user.employeeCode),
      active: user.active === true
    });
    return currentUser;
  },

  getUser() {
    return currentUser;
  },

  requireUser() {
    if (!currentUser?.uid) throw new Error("Chưa có ngữ cảnh người dùng hợp lệ.");
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

  hasAdditionalRole(...roles) {
    const normalizedRoles = roles.map(role => normalizeText(role).toUpperCase());
    return normalizedRoles.some(role => currentUser?.additionalRoles?.includes(role));
  },

  belongsToDepartment(departmentId) {
    return normalizeText(departmentId).toUpperCase() === (currentUser?.departmentId || "");
  }
});
