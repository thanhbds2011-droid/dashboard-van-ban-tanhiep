/**
 * Lớp kiểm tra quyền dùng thống nhất cho giao diện.
 * Firestore Security Rules vẫn là lớp kiểm soát bắt buộc ở phía dữ liệu.
 */
import { UserContext } from "./user-context.js";

function clean(value) {
  return String(value ?? "").trim();
}

function normalize(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function leaderLevel(user) {
  const explicit = clean(user?.leaderLevel).toUpperCase();
  if (["HEAD", "DEPARTMENT_HEAD", "TRUONG"].includes(explicit)) return "HEAD";
  if (["DEPUTY", "DEPARTMENT_DEPUTY", "PHO"].includes(explicit)) return "DEPUTY";
  if (user?.isDepartmentHead === true) return "HEAD";
  if (user?.isDepartmentHead === false && user?.role === "DEPARTMENT_LEADER") return "DEPUTY";

  const position = normalize(user?.position);
  if (!position) return "";

  const deputyPatterns = [
    /^pho\s+truong\s+(phong|khu)\b/,
    /^pho\s+(phong|khu)\b/,
    /^p\s*truong\s+(phong|khu)\b/,
    /^ptp\b/,
    /^ptk\b/
  ];
  if (deputyPatterns.some(pattern => pattern.test(position))) return "DEPUTY";

  const headPatterns = [
    /^truong\s+(phong|khu)\b/,
    /^quyen\s+truong\s+(phong|khu)\b/,
    /^phu\s+trach\s+(phong|khu)\b/
  ];
  if (headPatterns.some(pattern => pattern.test(position))) return "HEAD";

  return "";
}

function activeUser(user = UserContext.getUser()) {
  return Boolean(user?.uid && user?.active === true);
}

export const Permissions = Object.freeze({
  getLeaderLevel(user = UserContext.getUser()) {
    return leaderLevel(user);
  },

  isAdmin() {
    return UserContext.hasRole("ADMIN");
  },

  isDirector() {
    return UserContext.hasRole("DIRECTOR");
  },

  isDepartmentLeader() {
    return UserContext.hasRole("DEPARTMENT_LEADER");
  },

  isStaff() {
    return UserContext.hasRole("STAFF");
  },

  isTchcCoordinator() {
    return UserContext.hasRole("TCHC_COORDINATOR");
  },

  isDepartmentHead(user = UserContext.getUser()) {
    return Boolean(
      activeUser(user) &&
      clean(user?.role).toUpperCase() === "DEPARTMENT_LEADER" &&
      leaderLevel(user) === "HEAD"
    );
  },

  isDepartmentDeputy(user = UserContext.getUser()) {
    return Boolean(
      activeUser(user) &&
      clean(user?.role).toUpperCase() === "DEPARTMENT_LEADER" &&
      leaderLevel(user) === "DEPUTY"
    );
  },

  canAccessAdmin() {
    return this.isAdmin();
  },

  canCreatePeriod() {
    return this.canManageEvaluationPeriods();
  },

  canManageEvaluationPeriods() {
    const user = UserContext.getUser();
    return this.isDepartmentHead(user)
      && clean(user?.departmentId).toUpperCase() === "TCHC";
  },

  canRegisterStandardTasks() {
    return this.isStaff() || this.isDepartmentLeader();
  },

  canManageStandardTasks(hasDelegation = false) {
    return this.isDepartmentHead()
      || (this.isStaff() && hasDelegation === true);
  },

  canCreateUnexpectedTask() {
    return this.isAdmin() || this.isDirector() || this.isDepartmentLeader();
  },

  canRegisterTask() {
    return this.canCreateUnexpectedTask();
  },

  canAssignTask() {
    return this.canCreateUnexpectedTask();
  },

  canApproveStaffRegistrations(hasDelegation = false) {
    return this.isAdmin() || this.isDepartmentHead() || (this.isDepartmentDeputy() && hasDelegation === true);
  },

  canViewStaffRegistrations(hasDelegation = false) {
    return this.isAdmin() || this.isDirector() || this.isDepartmentHead() || (this.isDepartmentDeputy() && hasDelegation === true);
  },

  canApproveLeaderRegistrations(hasDelegation = false) {
    return this.isAdmin() || this.isDirector() || this.isDepartmentHead() || (this.isDepartmentDeputy() && hasDelegation === true);
  },

  canApprovePlan(hasDelegation = false) {
    return this.canApproveStaffRegistrations(hasDelegation) || this.canApproveLeaderRegistrations(hasDelegation);
  },

  canLockDepartmentPlan(hasDelegation = false) {
    return this.isDepartmentHead() || (this.isDepartmentDeputy() && hasDelegation === true);
  },

  canUnlockDepartmentPlan(hasDelegation = false) {
    return this.canLockDepartmentPlan(hasDelegation);
  },

  canDelegateApproval() {
    return this.isDepartmentHead();
  },

  canConfirmEvaluations(hasDelegation = false) {
    return this.isAdmin() || this.isDirector() || this.isDepartmentHead() || (this.isDepartmentDeputy() && hasDelegation === true);
  },

  canViewDepartmentReport() {
    return this.isAdmin() || this.isDirector() || this.isTchcCoordinator() || this.isDepartmentLeader();
  },

  canCancelRegistration(registration) {
    const user = UserContext.getUser();
    if (!activeUser(user) || !registration || registration.taskId) return false;
    if (registration.userId === user.uid) {
      return ["PENDING", "REJECTED"].includes(clean(registration.status).toUpperCase());
    }
    return (
      (this.isAdmin() || this.isDepartmentLeader()) &&
      clean(registration.departmentId).toUpperCase() === clean(user.departmentId).toUpperCase() &&
      clean(registration.status).toUpperCase() === "REJECTED"
    );
  },

  canDeleteRejectedRegistration(registration) {
    return this.canCancelRegistration(registration);
  },

  canReviewStaffTask() {
    return this.isAdmin() || this.isDirector() || this.isDepartmentHead();
  },

  canViewAllDepartments() {
    return this.isAdmin() || this.isDirector() || this.isTchcCoordinator();
  },

  canViewOwnKpi() {
    return UserContext.isAuthenticated();
  }
});
