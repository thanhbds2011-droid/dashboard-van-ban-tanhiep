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

  hasAdditionalRole(...roles) {
    return UserContext.hasAdditionalRole(...roles);
  },

  isCdtnSecretary() {
    return this.hasAdditionalRole("CDTN_BI_THU");
  },

  isCdtnDeputySecretary() {
    return this.hasAdditionalRole("CDTN_PHO_BI_THU");
  },

  isCdtnExecutiveMember() {
    return this.hasAdditionalRole(
      "CDTN_BI_THU",
      "CDTN_PHO_BI_THU",
      "CDTN_UY_VIEN_BCH"
    );
  },

  isCdtnMember() {
    return this.isCdtnExecutiveMember() || this.hasAdditionalRole("CDTN_DOAN_VIEN");
  },

  isCdtnCatalogManager() {
    return this.isCdtnSecretary() || this.isCdtnDeputySecretary();
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
    return this.isStaff() || this.isDepartmentLeader() || this.isDirector() || this.isTchcCoordinator();
  },

  canManageStandardTasks(departmentId = "", hasDelegation = false) {
    const user = UserContext.getUser();
    let targetDepartment = clean(departmentId).toUpperCase();
    let delegated = hasDelegation === true;

    // Tương thích các lời gọi cũ chỉ truyền một giá trị boolean.
    if (typeof departmentId === "boolean") {
      delegated = departmentId === true;
      targetDepartment = clean(user?.departmentId).toUpperCase();
    }
    if (!targetDepartment) targetDepartment = clean(user?.departmentId).toUpperCase();

    if (targetDepartment === "CDTN") return this.isCdtnCatalogManager();
    if (targetDepartment === "BGD") {
      return this.isDirector() && clean(user?.departmentId).toUpperCase() === "BGD";
    }

    const sameDepartment = targetDepartment === clean(user?.departmentId).toUpperCase();
    return sameDepartment && (
      this.isDepartmentHead(user)
      || (this.isStaff() && delegated)
    );
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

  canCancelOwnRegistration(registration, planLocked = false) {
    const user = UserContext.getUser();
    const hasTask = Boolean(clean(registration?.taskId));
    return Boolean(
      activeUser(user) &&
      registration &&
      registration.userId === user.uid &&
      !hasTask &&
      planLocked !== true &&
      ["PENDING", "REJECTED"].includes(clean(registration.status).toUpperCase())
    );
  },

  canCancelOwnApprovedRegistration(registration, hasDelegation = false) {
    const user = UserContext.getUser();
    const sameDepartment = clean(registration?.departmentId).toUpperCase() === clean(user?.departmentId).toUpperCase();
    const authorizedLeader = this.isDepartmentHead(user)
      || (this.isDepartmentDeputy(user) && hasDelegation === true);

    return Boolean(
      activeUser(user) &&
      registration &&
      registration.userId === user.uid &&
      clean(registration.status).toUpperCase() === "APPROVED" &&
      Boolean(clean(registration.taskId)) &&
      sameDepartment &&
      authorizedLeader
    );
  },

  canCancelRegistrationForEmployee(registration, planLocked = false, hasDelegation = false) {
    const user = UserContext.getUser();
    const hasTask = Boolean(clean(registration?.taskId));
    const sameDepartment = clean(registration?.departmentId).toUpperCase() === clean(user?.departmentId).toUpperCase();
    const authorizedManager = this.isDepartmentHead(user) || (this.isDepartmentDeputy(user) && hasDelegation === true);
    return Boolean(
      activeUser(user) &&
      registration &&
      registration.userId !== user.uid &&
      !hasTask &&
      planLocked === true &&
      sameDepartment &&
      authorizedManager &&
      ["PENDING", "REJECTED"].includes(clean(registration.status).toUpperCase())
    );
  },

  canCancelRegistration(registration, options = {}) {
    const planLocked = options.planLocked === true;
    return options.asManager === true
      ? this.canCancelRegistrationForEmployee(registration, planLocked, options.hasDelegation === true)
      : this.canCancelOwnRegistration(registration, planLocked);
  },

  canDeleteRejectedRegistration(registration) {
    return this.canCancelOwnRegistration(registration, false);
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
