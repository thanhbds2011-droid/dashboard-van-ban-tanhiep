/**
 * Shared user context V1.16.1.
 *
 * Điểm quan trọng:
 * - Store được đặt trên globalThis thay vì biến module cục bộ.
 * - Nếu trình duyệt vô tình giữ hai URL module khác version, cả hai vẫn dùng cùng một user store.
 * - Hỗ trợ trạng thái chuyển phiên để Router không render trong khoảng logout/login.
 */
const GLOBAL_STORE_KEY = "__TAN_HIEP_KPI_SHARED_USER_CONTEXT_V1__";

function sharedStore() {
  const root = globalThis;
  if (!root[GLOBAL_STORE_KEY]) {
    Object.defineProperty(root, GLOBAL_STORE_KEY, {
      configurable: false,
      enumerable: false,
      writable: false,
      value: {
        user: null,
        generation: 0,
        transitioning: false,
        transitionReason: "",
        transitionStartedAt: 0
      }
    });
  }
  return root[GLOBAL_STORE_KEY];
}

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

function normalizeUser(user = {}) {
  return Object.freeze({
    uid: normalizeText(user.uid),
    email: normalizeText(user.email).toLowerCase(),
    fullName: normalizeText(user.fullName),
    role: normalizeText(user.role).toUpperCase(),
    departmentId: normalizeText(user.departmentId).toUpperCase(),
    teamId: normalizeText(user.teamId).toUpperCase(),
    position: normalizeText(user.position),
    leaderLevel: normalizeText(user.leaderLevel).toUpperCase(),
    approvalAuthority: normalizeText(user.approvalAuthority).toUpperCase(),
    isDepartmentHead: typeof user.isDepartmentHead === "boolean" ? user.isDepartmentHead : null,
    additionalRoles: normalizeAdditionalRoles(user.additionalRoles),
    employeeCode: normalizeText(user.employeeCode),
    active: user.active === true
  });
}

function missingContextError() {
  const store = sharedStore();
  const error = new Error("Phiên người dùng đang được đồng bộ. Vui lòng chờ trong giây lát.");
  error.code = "USER_CONTEXT_MISSING";
  error.transient = store.transitioning === true;
  error.transitionReason = store.transitionReason || "";
  return error;
}

export const UserContext = Object.freeze({
  setUser(user = {}) {
    const store = sharedStore();
    store.user = normalizeUser(user);
    store.generation += 1;
    store.transitioning = false;
    store.transitionReason = "";
    store.transitionStartedAt = 0;
    return store.user;
  },

  getUser() {
    return sharedStore().user;
  },

  requireUser() {
    const user = sharedStore().user;
    if (!user?.uid) throw missingContextError();
    return user;
  },

  beginTransition(reason = "SESSION_TRANSITION") {
    const store = sharedStore();
    store.transitioning = true;
    store.transitionReason = normalizeText(reason) || "SESSION_TRANSITION";
    store.transitionStartedAt = Date.now();
    store.generation += 1;
    return store.generation;
  },

  clear(options = {}) {
    const store = sharedStore();
    store.user = null;
    store.generation += 1;
    if (options.keepTransition !== true) {
      store.transitioning = false;
      store.transitionReason = "";
      store.transitionStartedAt = 0;
    }
  },

  isTransitioning() {
    return sharedStore().transitioning === true;
  },

  getTransitionState() {
    const store = sharedStore();
    return Object.freeze({
      transitioning: store.transitioning === true,
      reason: store.transitionReason || "",
      startedAt: Number(store.transitionStartedAt || 0),
      generation: Number(store.generation || 0)
    });
  },

  getGeneration() {
    return Number(sharedStore().generation || 0);
  },

  isAuthenticated() {
    const user = sharedStore().user;
    return Boolean(user?.uid && user?.active);
  },

  hasRole(...roles) {
    const normalizedRoles = roles.map(role => normalizeText(role).toUpperCase());
    return normalizedRoles.includes(sharedStore().user?.role || "");
  },

  hasAdditionalRole(...roles) {
    const normalizedRoles = roles.map(role => normalizeText(role).toUpperCase());
    return normalizedRoles.some(role => sharedStore().user?.additionalRoles?.includes(role));
  },

  belongsToDepartment(departmentId) {
    return normalizeText(departmentId).toUpperCase() === (sharedStore().user?.departmentId || "");
  }
});
