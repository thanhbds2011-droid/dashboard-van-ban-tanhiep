/**
 * Lớp kiểm tra quyền dùng thống nhất cho giao diện.
 * Firestore Security Rules vẫn là lớp kiểm soát bắt buộc ở phía dữ liệu.
 */
import { UserContext } from "./user-context.js?v=20260806.V1_9_4";

function clean(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return clean(value).toUpperCase();
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
  const explicit = upper(user?.leaderLevel);
  if (["HEAD", "DEPARTMENT_HEAD", "TRUONG"].includes(explicit)) return "HEAD";
  if (["DEPUTY", "DEPARTMENT_DEPUTY", "PHO"].includes(explicit)) return "DEPUTY";
  if (user?.isDepartmentHead === true) return "HEAD";
  if (user?.isDepartmentHead === false && upper(user?.role) === "DEPARTMENT_LEADER") return "DEPUTY";

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

function roleIs(user, roleName) {
  return activeUser(user) && upper(user?.role) === upper(roleName);
}

function profileHasAdditionalRole(user, ...roles) {
  if (!activeUser(user)) return false;
  const assigned = Array.isArray(user?.additionalRoles)
    ? user.additionalRoles.map(upper)
    : [];
  return roles.map(upper).some(role => assigned.includes(role));
}

function sameDepartment(user, departmentId) {
  return activeUser(user) && upper(user?.departmentId) === upper(departmentId);
}

function createdByCurrentUser(task, user) {
  return Boolean(
    task &&
    user?.uid &&
    clean(task.createdByUserId) &&
    clean(task.createdByUserId) === user.uid
  );
}

export const Permissions = Object.freeze({
  getLeaderLevel(user = UserContext.getUser()) {
    return leaderLevel(user);
  },

  isAdmin(user = UserContext.getUser()) {
    return roleIs(user, "ADMIN");
  },

  isDirector(user = UserContext.getUser()) {
    return roleIs(user, "DIRECTOR");
  },

  isDepartmentLeader(user = UserContext.getUser()) {
    return roleIs(user, "DEPARTMENT_LEADER");
  },

  isStaff(user = UserContext.getUser()) {
    return roleIs(user, "STAFF");
  },

  isTchcCoordinator(user = UserContext.getUser()) {
    return roleIs(user, "TCHC_COORDINATOR");
  },

  isTchcDepartmentLeader(user = UserContext.getUser()) {
    return Boolean(
      this.isDepartmentLeader(user) &&
      upper(user?.departmentId) === "TCHC"
    );
  },

  hasAdditionalRole(...roles) {
    return profileHasAdditionalRole(UserContext.getUser(), ...roles);
  },

  isCdtnSecretary(user = UserContext.getUser()) {
    return profileHasAdditionalRole(user, "CDTN_BI_THU");
  },

  isCdtnDeputySecretary(user = UserContext.getUser()) {
    return profileHasAdditionalRole(user, "CDTN_PHO_BI_THU");
  },

  isCdtnExecutiveMember(user = UserContext.getUser()) {
    return profileHasAdditionalRole(
      user,
      "CDTN_BI_THU",
      "CDTN_PHO_BI_THU",
      "CDTN_UY_VIEN_BCH"
    );
  },

  isCdtnMember(user = UserContext.getUser()) {
    return this.isCdtnExecutiveMember(user) || profileHasAdditionalRole(user, "CDTN_DOAN_VIEN");
  },

  isCdtnLeadership(user = UserContext.getUser()) {
    return this.isCdtnSecretary(user) || this.isCdtnDeputySecretary(user);
  },

  isCdtnCatalogManager(user = UserContext.getUser()) {
    /* V1.9.4: Bí thư, Phó Bí thư và Ủy viên BCH đều được tạo đầu việc Chi đoàn. */
    return this.isCdtnExecutiveMember(user);
  },

  canApproveCdtnRegistrations(hasDelegation = false) {
    return this.isAdmin() || this.isCdtnLeadership() || hasDelegation === true;
  },

  canDelegateCdtnApproval() {
    return this.isCdtnLeadership();
  },

  canManageCdtnAttendance(hasDelegation = false) {
    return this.isAdmin() || this.isCdtnLeadership() || hasDelegation === true;
  },

  canViewCdtnAggregateReport(hasDelegation = false) {
    return this.isAdmin() || this.isDirector() || this.isCdtnLeadership() || hasDelegation === true;
  },

  isDepartmentHead(user = UserContext.getUser()) {
    return Boolean(
      this.isDepartmentLeader(user) &&
      leaderLevel(user) === "HEAD"
    );
  },

  isDepartmentDeputy(user = UserContext.getUser()) {
    return Boolean(
      this.isDepartmentLeader(user) &&
      leaderLevel(user) === "DEPUTY"
    );
  },

  canApproveRegistrationForDepartment(departmentId = "", hasDelegation = false) {
    const user = UserContext.getUser();
    const targetDepartmentId = upper(departmentId);
    if (!targetDepartmentId) return false;
    if (this.isAdmin(user)) return true;
    if (targetDepartmentId === "CDTN") {
      return this.isCdtnLeadership(user) || hasDelegation === true;
    }
    return (this.isDepartmentHead(user) && sameDepartment(user, targetDepartmentId))
      || (this.isDepartmentDeputy(user) && sameDepartment(user, targetDepartmentId) && hasDelegation === true);
  },

  canAccessAdmin() {
    return this.isAdmin();
  },

  canCreatePeriod() {
    return this.canManageEvaluationPeriods();
  },

  canManageEvaluationPeriods() {
    const user = UserContext.getUser();
    return this.isDepartmentHead(user) && upper(user?.departmentId) === "TCHC";
  },

  canRegisterStandardTasks() {
    return this.isStaff() || this.isDepartmentLeader() || this.isDirector() || this.isTchcCoordinator();
  },

  canCreateStandardTask(departmentId = "", hasDelegation = false, user = UserContext.getUser()) {
    const targetDepartment = upper(departmentId || user?.departmentId);
    const delegated = hasDelegation === true;
    if (!activeUser(user) || !targetDepartment) return false;
    if (this.isAdmin(user)) return true;
    if (targetDepartment === "CDTN") return this.isCdtnCatalogManager(user);
    if (targetDepartment === "BGD") {
      return this.isDirector(user) && sameDepartment(user, "BGD");
    }
    if (!sameDepartment(user, targetDepartment)) return false;
    return this.isDepartmentHead(user)
      || this.isDepartmentDeputy(user)
      || (this.isStaff(user) && delegated);
  },

  canUpdateStandardTask(task, hasDelegation = false, user = UserContext.getUser()) {
    const departmentId = upper(task?.departmentId);
    if (!activeUser(user) || !task || !departmentId) return false;
    if (this.isAdmin(user)) return true;
    if (departmentId === "CDTN") {
      return this.isCdtnLeadership(user)
        || (this.isCdtnExecutiveMember(user) && createdByCurrentUser(task, user));
    }
    if (departmentId === "BGD") {
      return this.isDirector(user) && sameDepartment(user, "BGD");
    }
    if (!sameDepartment(user, departmentId)) return false;
    if (this.isDepartmentHead(user)) return true;
    if (this.isDepartmentDeputy(user)) return createdByCurrentUser(task, user);
    return this.isStaff(user) && hasDelegation === true && createdByCurrentUser(task, user);
  },

  canDeleteStandardTask(task, user = UserContext.getUser()) {
    const departmentId = upper(task?.departmentId);
    if (!activeUser(user) || !task || !departmentId) return false;
    if (this.isAdmin(user)) return true;
    if (departmentId === "CDTN") return this.isCdtnLeadership(user);
    if (departmentId === "BGD") return this.isDirector(user) && sameDepartment(user, "BGD");
    return this.isDepartmentHead(user) && sameDepartment(user, departmentId);
  },

  canManageStandardTasks(departmentId = "", hasDelegation = false) {
    /* Tương thích lời gọi cũ: quyền "quản lý" tại UI được hiểu là quyền tạo. */
    if (typeof departmentId === "boolean") {
      return this.canCreateStandardTask("", departmentId);
    }
    return this.canCreateStandardTask(departmentId, hasDelegation);
  },

  canDelegateStandardTaskEditor(user = UserContext.getUser()) {
    return this.isDepartmentHead(user) || this.isDepartmentDeputy(user);
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
      ["PENDING", "REJECTED"].includes(upper(registration.status))
    );
  },

  canCancelOwnApprovedRegistration(registration, user = UserContext.getUser()) {
    const departmentId = upper(registration?.departmentId);
    if (!activeUser(user) || !registration || registration.userId !== user.uid) return false;
    if (upper(registration.status) !== "APPROVED" || !clean(registration.taskId)) return false;

    if (departmentId === "CDTN") return this.isCdtnExecutiveMember(user);
    if (departmentId === "BGD") return this.isDirector(user) && sameDepartment(user, "BGD");
    return sameDepartment(user, departmentId)
      && (this.isDepartmentHead(user) || this.isDepartmentDeputy(user));
  },

  canCancelRegistrationForEmployee(registration, planLocked = false, hasDelegation = false) {
    const user = UserContext.getUser();
    const hasTask = Boolean(clean(registration?.taskId));
    const registrationDepartment = upper(registration?.departmentId);
    const authorizedManager = this.isDepartmentHead(user)
      || (this.isDepartmentDeputy(user) && hasDelegation === true);
    return Boolean(
      activeUser(user) &&
      registration &&
      registration.userId !== user.uid &&
      !hasTask &&
      planLocked === true &&
      sameDepartment(user, registrationDepartment) &&
      authorizedManager &&
      ["PENDING", "REJECTED"].includes(upper(registration.status))
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

  canViewAllScopes() {
    return this.isAdmin() || this.isDirector();
  },

  canViewAllDepartments() {
    return this.canViewAllScopes()
      || this.isTchcCoordinator()
      || this.isTchcDepartmentLeader();
  },

  canViewOwnKpi() {
    return UserContext.isAuthenticated();
  }
});
