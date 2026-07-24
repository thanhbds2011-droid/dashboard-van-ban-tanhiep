/**
 * Production 3B.1 - UI Permissions
 * Chỉ điều khiển giao diện. Firestore Rules vẫn là lớp bảo vệ cuối cùng.
 */

import { UserContext } from "./user-context.js";

export const Permissions = Object.freeze({
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
    const user = UserContext.getUser();
    return Boolean(
      user?.departmentId === "TCHC" &&
      ["ADMIN", "TCHC_COORDINATOR", "DEPARTMENT_LEADER"].includes(user.role)
    );
  },

  canAccessAdmin() {
    return this.isAdmin();
  },

  canCreatePeriod() {
    return this.isAdmin();
  },

  canRegisterTask() {
    return UserContext.isAuthenticated();
  },

  canAssignTask() {
    return this.isAdmin() || this.isDirector() || this.isDepartmentLeader();
  },

  canApprovePlan() {
    return this.isAdmin() || this.isDirector() || this.isDepartmentLeader();
  },

  canLockDepartmentPlan() {
    return this.isAdmin() || this.isDepartmentLeader();
  },

  canReviewStaffTask() {
    return this.isAdmin() || this.isDirector() || this.isDepartmentLeader();
  },

  canViewAllDepartments() {
    return this.isAdmin() || this.isDirector() || this.isTchcCoordinator();
  }
});
