/**
 * Production Final Complete - UI permissions.
 * Firestore Rules remains the authoritative security layer.
 */
import { UserContext } from "./user-context.js";

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function isDeputyPosition(position) {
  const text = normalize(position);
  return text.includes("phó trưởng") || text.includes("pho truong") || text.startsWith("phó ") || text.startsWith("pho ");
}

export const Permissions = Object.freeze({
  isAdmin() { return UserContext.hasRole("ADMIN"); },
  isDirector() { return UserContext.hasRole("DIRECTOR"); },
  isDepartmentLeader() { return UserContext.hasRole("DEPARTMENT_LEADER"); },
  isStaff() { return UserContext.hasRole("STAFF"); },

  isDepartmentHead() {
    const user = UserContext.getUser();
    return Boolean(user?.role === "DEPARTMENT_LEADER" && !isDeputyPosition(user.position));
  },

  isDepartmentDeputy() {
    const user = UserContext.getUser();
    return Boolean(user?.role === "DEPARTMENT_LEADER" && isDeputyPosition(user.position));
  },

  isTchcCoordinator() {
    const user = UserContext.getUser();
    return Boolean(
      user?.departmentId === "TCHC" &&
      ["ADMIN", "TCHC_COORDINATOR", "DEPARTMENT_LEADER"].includes(user.role)
    );
  },

  canAccessAdmin() { return this.isAdmin(); },
  canCreatePeriod() { return this.isAdmin(); },

  canRegisterStandardTasks() {
    return this.isStaff() || this.isDepartmentLeader();
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

  canApproveStaffRegistrations() {
    return this.isAdmin() || this.isDepartmentHead();
  },

  canViewStaffRegistrations() {
    return this.isAdmin() || this.isDirector() || this.isDepartmentLeader();
  },

  canApproveLeaderRegistrations() {
    return this.isAdmin() || this.isDirector();
  },

  canApprovePlan() {
    return this.canApproveStaffRegistrations() || this.canApproveLeaderRegistrations();
  },

  canLockDepartmentPlan() {
    return this.isAdmin() || this.isDepartmentHead();
  },

  canReviewStaffTask() {
    return this.isAdmin() || this.isDirector() || this.isDepartmentHead();
  },

  canViewAllDepartments() {
    return this.isAdmin() || this.isDirector() || this.isTchcCoordinator();
  }
});
