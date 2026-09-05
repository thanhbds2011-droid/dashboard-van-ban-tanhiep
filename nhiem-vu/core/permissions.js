/**
 * Lớp kiểm tra quyền dùng thống nhất cho giao diện.
 * Firestore Security Rules vẫn là lớp kiểm soát bắt buộc ở phía dữ liệu.
 */
import { UserContext } from "./user-context.js?v=20260904.V1_23_0";

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
  // V1.19.0: approvalAuthority từ Danh mục tài khoản là nguồn chân lý về thẩm quyền đơn vị.
  // Cho phép một Phó Trưởng phòng đang Phụ trách/được giao quyền phê duyệt hoạt động như người đứng đầu
  // mà không hard-code tên Phòng/Khu hay chức danh cụ thể.
  const authority = upper(user?.approvalAuthority);
  const authorityFieldPresent = user?.approvalAuthorityPresent === true;
  if (authorityFieldPresent) {
    if (authority === "HEAD") return "HEAD";
    if (authority === "DEPUTY") return "DEPUTY";
    // Mirror Firestore Rules V1.20.0: khi field approvalAuthority đã tồn tại nhưng
    // rỗng/không hợp lệ, không được suy quyền từ chức danh legacy.
    return "";
  }

  const explicit = upper(user?.leaderLevel);
  if (["HEAD", "DEPARTMENT_HEAD", "TRUONG"].includes(explicit)) return "HEAD";
  if (["DEPUTY", "DEPARTMENT_DEPUTY", "PHO"].includes(explicit)) return "DEPUTY";
  if (user?.isDepartmentHead === true) return "HEAD";
  if (user?.isDepartmentHead === false && upper(user?.role) === "DEPARTMENT_LEADER") return "DEPUTY";

  const position = normalize(user?.position);
  if (!position) return "";

  /* “Phó Trưởng phòng, Phụ trách ...” phải được hiểu là người phụ trách đơn vị. */
  if (/\b(phu\s+trach|quyen\s+truong)\b/.test(position)) return "HEAD";

  const headPatterns = [
    /^truong\s+(phong|khu)\b/
  ];
  if (headPatterns.some(pattern => pattern.test(position))) return "HEAD";

  const deputyPatterns = [
    /^pho\s+truong\s+(phong|khu)\b/,
    /^pho\s+(phong|khu)\b/,
    /^p\s*truong\s+(phong|khu)\b/,
    /^ptp\b/,
    /^ptk\b/
  ];
  if (deputyPatterns.some(pattern => pattern.test(position))) return "DEPUTY";

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


function normalizedDepartmentArray(value) {
  const source = Array.isArray(value) ? value : [];
  return [...new Set(source.map(upper).filter(Boolean))].sort();
}

function actingHeadDepartments(user) {
  return normalizedDepartmentArray(user?.actingHeadDepartmentIds);
}

function actingOversightDepartments(user) {
  return normalizedDepartmentArray(user?.actingOversightDepartmentIds);
}

function hasActingDepartment(user, field, departmentId) {
  if (!activeUser(user)) return false;
  const target = upper(departmentId);
  if (!target || ["BGD", "CDTN"].includes(target)) return false;
  return normalizedDepartmentArray(user?.[field]).includes(target);
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

  isDirectorHead(user = UserContext.getUser()) {
    return Boolean(this.isDirector(user) && leaderLevel(user) === "HEAD");
  },

  isDirectorDeputy(user = UserContext.getUser()) {
    return Boolean(this.isDirector(user) && leaderLevel(user) === "DEPUTY");
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

  isBusinessStaff(user = UserContext.getUser()) {
    if (!activeUser(user)) return false;
    const role = upper(user?.role);
    if (["STAFF", "TCHC_COORDINATOR"].includes(role)) return true;
    /* ADMIN là system privilege; nếu hồ sơ không mang vị trí Head/Deputy/Director thì workflow nghiệp vụ xem như nhân viên. */
    return role === "ADMIN"
      && !this.hasUnitApprovalAuthority(user)
      && !this.isDepartmentDeputy(user)
      && !this.isDirector(user);
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
    /* V1.22.0: Danh mục KPI Chi đoàn do Bí thư quản lý. */
    return this.isCdtnSecretary(user);
  },

  canApproveCdtnRegistrations(hasDelegation = false) {
    /* Bí thư duyệt; Phó Bí thư/Ủy viên BCH chỉ duyệt khi có ủy quyền hợp lệ. */
    return this.isCdtnSecretary() || hasDelegation === true;
  },

  canDelegateCdtnApproval() {
    return this.isCdtnSecretary();
  },

  canManageCdtnAttendance(hasDelegation = false) {
    return this.isAdmin() || this.isCdtnLeadership() || hasDelegation === true;
  },

  canViewCdtnAggregateReport(hasDelegation = false) {
    return this.isAdmin() || this.isDirector() || this.isCdtnLeadership() || hasDelegation === true;
  },

  hasUnitApprovalAuthority(user = UserContext.getUser()) {
    /* System privilege ADMIN không thay business position; mirror Firestore Rules isHeadProfile(). */
    return Boolean(
      activeUser(user) &&
      ["DEPARTMENT_LEADER", "ADMIN"].includes(upper(user?.role)) &&
      leaderLevel(user) === "HEAD"
    );
  },

  // Alias tương thích source cũ. Từ V1.19.0, "HEAD" nghĩa là người có Quyền phê duyệt tại đơn vị,
  // không đồng nghĩa cứng với chuỗi chức danh "Trưởng phòng".
  isDepartmentHead(user = UserContext.getUser()) {
    return this.hasUnitApprovalAuthority(user);
  },

  isDepartmentDeputy(user = UserContext.getUser()) {
    /* Mirror Firestore Rules isDeputyProfile(): ADMIN vẫn giữ business position Phó nếu hồ sơ quy định. */
    return Boolean(
      activeUser(user) &&
      ["DEPARTMENT_LEADER", "ADMIN"].includes(upper(user?.role)) &&
      leaderLevel(user) === "DEPUTY"
    );
  },

  isPrimaryDepartmentHead(user = UserContext.getUser()) {
    return this.isDepartmentHead(user);
  },

  hasActingHeadAuthority(user = UserContext.getUser(), departmentId = "") {
    return hasActingDepartment(user, "actingHeadDepartmentIds", departmentId);
  },

  hasActingOversightAuthority(user = UserContext.getUser(), departmentId = "") {
    return hasActingDepartment(user, "actingOversightDepartmentIds", departmentId);
  },

  hasDirectHeadAuthorityForDepartment(user = UserContext.getUser(), departmentId = "") {
    const target = upper(departmentId);
    if (!activeUser(user) || !target) return false;
    if (target === "BGD") return this.isDirectorHead(user);
    if (target === "CDTN") return this.isCdtnSecretary(user);
    return (this.isDepartmentHead(user) && sameDepartment(user, target))
      || this.hasActingHeadAuthority(user, target);
  },

  hasHeadAuthorityForDepartment(user = UserContext.getUser(), departmentId = "") {
    const target = upper(departmentId);
    if (!activeUser(user) || !target) return false;
    if (target === "BGD") return this.isDirectorHead(user);
    if (target === "CDTN") return this.isCdtnSecretary(user);
    return this.hasDirectHeadAuthorityForDepartment(user, target)
      || this.hasActingOversightAuthority(user, target);
  },

  authorityForDepartment(user = UserContext.getUser(), departmentId = "") {
    const target = upper(departmentId);
    if (!activeUser(user) || !target) return Object.freeze({ authority: "", leaderLevel: "", isDepartmentHead: false, scopeType: "NONE" });
    if (target === "CDTN") {
      const isHead = this.isCdtnSecretary(user);
      return Object.freeze({ authority: isHead ? "HEAD" : "", leaderLevel: isHead ? "HEAD" : "", isDepartmentHead: isHead, scopeType: "CDTN" });
    }
    if (target === "BGD") {
      const level = this.isDirectorHead(user) ? "HEAD" : (this.isDirectorDeputy(user) ? "DEPUTY" : "");
      return Object.freeze({ authority: level, leaderLevel: level, isDepartmentHead: level === "HEAD", scopeType: "BGD" });
    }
    if (this.hasActingHeadAuthority(user, target)) {
      return Object.freeze({ authority: "HEAD", leaderLevel: "HEAD", isDepartmentHead: true, scopeType: "DIRECT_ACTING_SCOPE" });
    }
    if (this.hasActingOversightAuthority(user, target)) {
      return Object.freeze({ authority: "HEAD", leaderLevel: "HEAD", isDepartmentHead: true, scopeType: "OVERSIGHT_SCOPE" });
    }
    if (sameDepartment(user, target)) {
      const level = this.isDepartmentHead(user) ? "HEAD" : (this.isDepartmentDeputy(user) ? "DEPUTY" : "");
      return Object.freeze({ authority: level, leaderLevel: level, isDepartmentHead: level === "HEAD", scopeType: "PRIMARY_SCOPE" });
    }
    return Object.freeze({ authority: "", leaderLevel: "", isDepartmentHead: false, scopeType: "NONE" });
  },

  getViewDepartmentIds(user = UserContext.getUser()) {
    if (!activeUser(user)) return [];
    if (this.canViewAllDepartments(user)) return ["ALL"];
    const ids = new Set([upper(user?.departmentId)]);
    actingHeadDepartments(user).forEach(id => ids.add(id));
    actingOversightDepartments(user).forEach(id => ids.add(id));
    return [...ids].filter(Boolean);
  },

  getRegistrationDepartmentIds(user = UserContext.getUser()) {
    if (!activeUser(user)) return [];
    const ids = new Set([upper(user?.departmentId)]);
    actingHeadDepartments(user).forEach(id => ids.add(id));
    return [...ids].filter(Boolean);
  },

  getApprovalDepartmentIds(user = UserContext.getUser()) {
    if (!activeUser(user)) return [];
    const ids = new Set();
    if (this.isDepartmentHead(user)) ids.add(upper(user?.departmentId));
    actingHeadDepartments(user).forEach(id => ids.add(id));
    actingOversightDepartments(user).forEach(id => ids.add(id));
    return [...ids].filter(Boolean);
  },

  canViewDepartmentScope(user = UserContext.getUser(), departmentId = "") {
    const target = upper(departmentId);
    if (!activeUser(user) || !target) return false;
    if (target === "CDTN") return this.isCdtnMember(user) || this.canViewAllScopes(user);
    if (target === "BGD") return this.isDirector(user) || this.canViewAllScopes(user);
    if (this.canViewAllDepartments(user)) return true;
    return this.getViewDepartmentIds(user).includes(target);
  },

  canRegisterForDepartment(user = UserContext.getUser(), departmentId = "") {
    const target = upper(departmentId);
    if (!activeUser(user) || !target) return false;
    if (target === "CDTN") return this.isCdtnMember(user);
    if (target === "BGD") return this.isDirector(user) && sameDepartment(user, "BGD");
    return this.getRegistrationDepartmentIds(user).includes(target);
  },

  canApproveForDepartment(user = UserContext.getUser(), departmentId = "", hasDelegation = false) {
    const target = upper(departmentId);
    if (!activeUser(user) || !target) return false;
    if (target === "CDTN") return this.isCdtnSecretary(user) || hasDelegation === true;
    if (target === "BGD") return this.isDirectorHead(user) || hasDelegation === true;
    return this.hasHeadAuthorityForDepartment(user, target)
      || (this.isDepartmentDeputy(user) && sameDepartment(user, target) && hasDelegation === true);
  },

  canApproveRegistrationForDepartment(departmentId = "", hasDelegation = false) {
    const user = UserContext.getUser();
    const targetDepartmentId = upper(departmentId);
    if (!targetDepartmentId) return false;
    if (targetDepartmentId === "CDTN") {
      return this.isCdtnSecretary(user) || hasDelegation === true;
    }
    if (targetDepartmentId === "BGD") {
      return this.isDirectorHead(user) || hasDelegation === true;
    }
    return this.canApproveForDepartment(user, targetDepartmentId, hasDelegation);
  },

  canAccessAdmin() {
    return this.isAdmin();
  },

  canCreatePeriod() {
    return this.canManageEvaluationPeriods();
  },

  canManageEvaluationPeriods() {
    const user = UserContext.getUser();
    return this.isAdmin(user) || (this.isDepartmentHead(user) && upper(user?.departmentId) === "TCHC");
  },

  canRegisterStandardTasks(user = UserContext.getUser()) {
    return this.isDirector(user)
      || this.isDepartmentLeader(user)
      || this.isDepartmentHead(user)
      || this.isDepartmentDeputy(user)
      || this.isBusinessStaff(user);
  },

  canCreateStandardTask(departmentId = "", hasDelegation = false, user = UserContext.getUser()) {
    const targetDepartment = upper(departmentId || user?.departmentId);
    const delegated = hasDelegation === true;
    if (!activeUser(user) || !targetDepartment) return false;
    if (targetDepartment === "CDTN") return this.isCdtnCatalogManager(user);
    if (this.isAdmin(user)) return true;
    if (targetDepartment === "BGD") {
      return this.isDirector(user) && sameDepartment(user, "BGD");
    }
    if (!sameDepartment(user, targetDepartment)) return false;
    return this.hasUnitApprovalAuthority(user)
      || ((this.isDepartmentDeputy(user) || this.isStaff(user) || this.isTchcCoordinator(user)) && delegated);
  },

  canUpdateStandardTask(task, hasDelegation = false, user = UserContext.getUser()) {
    const departmentId = upper(task?.departmentId);
    if (!activeUser(user) || !task || !departmentId) return false;
    if (departmentId === "CDTN") return this.isCdtnCatalogManager(user);
    if (this.isAdmin(user)) return true;
    if (departmentId === "BGD") {
      return this.isDirector(user) && sameDepartment(user, "BGD");
    }
    if (!sameDepartment(user, departmentId)) return false;
    if (this.hasUnitApprovalAuthority(user)) return true;
    return (this.isDepartmentDeputy(user) || this.isStaff(user) || this.isTchcCoordinator(user))
      && hasDelegation === true
      && createdByCurrentUser(task, user);
  },

  canDeleteStandardTask(task, user = UserContext.getUser()) {
    const departmentId = upper(task?.departmentId);
    if (!activeUser(user) || !task || !departmentId) return false;
    if (departmentId === "CDTN") return this.isCdtnCatalogManager(user);
    if (this.isAdmin(user)) return true;
    if (departmentId === "BGD") return this.isDirector(user) && sameDepartment(user, "BGD");
    return this.hasUnitApprovalAuthority(user) && sameDepartment(user, departmentId);
  },

  canManageStandardTasks(departmentId = "", hasDelegation = false) {
    /* Tương thích lời gọi cũ: quyền "quản lý" tại UI được hiểu là quyền tạo. */
    if (typeof departmentId === "boolean") {
      return this.canCreateStandardTask("", departmentId);
    }
    return this.canCreateStandardTask(departmentId, hasDelegation);
  },

  canDelegateStandardTaskEditor(user = UserContext.getUser()) {
    return this.hasUnitApprovalAuthority(user);
  },

  canCreateUnexpectedTask(hasDelegation = false, user = UserContext.getUser()) {
    if (!activeUser(user)) return false;
    /* V1.22.0: system ADMIN không thay business position trong luồng giao nhiệm vụ. */
    if (this.isDirector(user)) return true;
    if (this.hasUnitApprovalAuthority(user) || this.isDepartmentDeputy(user)) return true;
    const adminStaffProfile = this.isAdmin(user)
      && !this.hasUnitApprovalAuthority(user)
      && !this.isDepartmentDeputy(user)
      && !this.isDirector(user);
    return hasDelegation === true
      && (this.isStaff(user) || this.isTchcCoordinator(user) || adminStaffProfile);
  },

  canRegisterTask() {
    return this.canCreateUnexpectedTask();
  },

  canAssignTask() {
    return this.canCreateUnexpectedTask();
  },

  canApproveStaffRegistrations(hasDelegation = false) {
    return this.isDepartmentHead() || (this.isDepartmentDeputy() && hasDelegation === true);
  },

  canViewStaffRegistrations(hasDelegation = false) {
    return this.isAdmin() || this.isDirector() || this.isDepartmentHead() || (this.isDepartmentDeputy() && hasDelegation === true);
  },

  canApproveLeaderRegistrations(hasDelegation = false) {
    return this.isDirectorHead() || (this.isDirectorDeputy() && hasDelegation === true);
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
    return this.isDepartmentHead() || this.isDirectorHead();
  },

  canConfirmEvaluations(hasDelegation = false) {
    return this.isDepartmentHead()
      || (this.isDepartmentDeputy() && hasDelegation === true)
      || this.isDirectorHead()
      || (this.isDirectorDeputy() && hasDelegation === true);
  },

  canViewDepartmentReport() {
    return this.isAdmin() || this.isDirector() || this.isTchcCoordinator() || this.isDepartmentLeader();
  },

  canResubmitOwnRegistration(registration, planLocked = false) {
    const user = UserContext.getUser();
    return Boolean(
      activeUser(user)
      && registration
      && registration.userId === user.uid
      && upper(registration.status) === "REJECTED"
      && !clean(registration.taskId)
      && planLocked !== true
    );
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
    return this.hasDirectHeadAuthorityForDepartment(user, departmentId)
      || (sameDepartment(user, departmentId) && this.isDepartmentDeputy(user));
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
    return this.isDirector() || this.isDepartmentHead() || this.isDepartmentDeputy();
  },

  canViewAllScopes() {
    return this.isAdmin() || this.isDirector();
  },

  canViewAllDepartments() {
    return this.canViewAllScopes()
      || this.isTchcCoordinator()
      || this.isTchcDepartmentLeader();
  },

  canManageExecutiveDirectives(user = UserContext.getUser()) {
    /* ADMIN là system privilege; quyền điều hành theo business position. */
    if (this.isDirector(user)) return true;
    if (upper(user?.departmentId) !== "TCHC") return false;
    return this.isTchcCoordinator(user)
      || this.isDepartmentHead(user)
      || this.isDepartmentDeputy(user);
  },

  canViewAllExecutiveDirectives(user = UserContext.getUser()) {
    return this.canManageExecutiveDirectives(user);
  },

  canRecordOralExecutiveDirective(user = UserContext.getUser()) {
    const departmentId = upper(user?.departmentId);
    /* Phòng/Khu thông thường: chỉ Trưởng/Phụ trách (HEAD) ghi nhận BGĐ cho chính đơn vị. TCHC Phó đi qua capability relay riêng. */
    return activeUser(user)
      && this.hasUnitApprovalAuthority(user)
      && Boolean(departmentId)
      && !["BGD", "CDTN"].includes(departmentId);
  },

  canRelayOralExecutiveDirective(user = UserContext.getUser()) {
    /*
     * V1.22.0: TCHC là đầu mối ghi nhận/chuyển tải chỉ đạo miệng BGĐ xuống Phòng/Khu.
     * System privilege ADMIN không tự tạo capability này; phải có business position/capability TCHC phù hợp.
     */
    return activeUser(user)
      && upper(user?.departmentId) === "TCHC"
      && (
        this.isTchcCoordinator(user)
        || this.isTchcDepartmentLeader(user)
        || this.hasUnitApprovalAuthority(user)
        || this.isDepartmentDeputy(user)
      );
  },

  canAccessExecutiveDirectives() {
    return UserContext.isAuthenticated();
  },

  canUpdateOwnDepartmentExecutiveDirectives(user = UserContext.getUser()) {
    return activeUser(user) && Boolean(upper(user?.departmentId));
  },

  canGenerateOwnExecutiveReports(user = UserContext.getUser()) {
    return activeUser(user)
      && (this.canManageExecutiveDirectives(user) || this.isDepartmentHead(user) || this.isDepartmentDeputy(user));
  },

  canGenerateCenterExecutiveReports(user = UserContext.getUser()) {
    return this.canManageExecutiveDirectives(user);
  },

  canViewOwnKpi() {
    return UserContext.isAuthenticated();
  }
});
