/**
 * Ma trận xác nhận KPI V1.18.1.
 * Quy tắc cốt lõi: SELF REQUEST != FINAL APPROVAL và không ai tự duyệt chính mình.
 */
function clean(value) { return String(value ?? "").trim(); }
function upper(value) { return clean(value).toUpperCase(); }
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

export function leaderLevelOf(user = {}) {
  const explicit = upper(user.leaderLevel);
  if (["HEAD", "DEPARTMENT_HEAD", "TRUONG"].includes(explicit)) return "HEAD";
  if (["DEPUTY", "DEPARTMENT_DEPUTY", "PHO"].includes(explicit)) return "DEPUTY";
  const role = upper(user.role);
  const position = normalize(user.position);
  if (role === "DIRECTOR") {
    if (/^pho\s+giam\s+doc\b/.test(position)) return "DEPUTY";
    if (/^(quyen\s+)?giam\s+doc\b/.test(position)) return "HEAD";
  }
  if (role === "DEPARTMENT_LEADER") {
    /* Dữ liệu cũ có thể ghi “Phó Trưởng phòng, Phụ trách ...”. Phụ trách/Quyền Trưởng phải ưu tiên HEAD. */
    if (/\b(phu\s+trach|quyen\s+truong)\b/.test(position)) return "HEAD";
    if (/^(truong\s+phong|truong\s+khu)\b/.test(position)) return "HEAD";
    if (/^(pho\s+truong|pho\s+phong|pho\s+khu|p\s*truong|ptp|ptk)\b/.test(position)) return "DEPUTY";
  }
  return "";
}

export function isDirectorHead(user = {}) { return upper(user.role) === "DIRECTOR" && leaderLevelOf(user) === "HEAD"; }
export function isDirectorDeputy(user = {}) { return upper(user.role) === "DIRECTOR" && leaderLevelOf(user) === "DEPUTY"; }
export function isDepartmentHeadProfile(user = {}) { return upper(user.role) === "DEPARTMENT_LEADER" && leaderLevelOf(user) === "HEAD"; }
export function isDepartmentDeputyProfile(user = {}) { return upper(user.role) === "DEPARTMENT_LEADER" && leaderLevelOf(user) === "DEPUTY"; }

function additionalRoles(user = {}) {
  return Array.isArray(user.additionalRoles) ? user.additionalRoles.map(upper) : [];
}
export function isCdtnSecretary(user = {}) { return additionalRoles(user).includes("CDTN_BI_THU"); }
export function isCdtnDeputySecretary(user = {}) { return additionalRoles(user).includes("CDTN_PHO_BI_THU"); }
export function isCdtnExecutive(user = {}) {
  const roles = additionalRoles(user);
  return roles.some(role => ["CDTN_BI_THU", "CDTN_PHO_BI_THU", "CDTN_UY_VIEN_BCH"].includes(role));
}
export function isCdtnMember(user = {}) { return isCdtnExecutive(user) || additionalRoles(user).includes("CDTN_DOAN_VIEN"); }

function dateKeyToday() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function delegationActive(delegation, permissionName, departmentId = "", today = dateKeyToday()) {
  if (!delegation || delegation.active !== true) return false;
  if (departmentId && upper(delegation.departmentId || delegation.organizationId) !== upper(departmentId)) return false;
  if (delegation.startDate && delegation.startDate > today) return false;
  if (delegation.endDate && delegation.endDate < today) return false;
  const permissions = Array.isArray(delegation.permissions) ? delegation.permissions.map(upper) : [];
  return permissions.includes(upper(permissionName));
}

function findUser(users, id) { return (users || []).find(user => clean(user.id || user.uid) === clean(id)) || null; }
function sameDepartment(a, b) { return upper(a?.departmentId) && upper(a?.departmentId) === upper(b?.departmentId); }
function candidate(users, predicate, ownerId) {
  return (users || []).find(user => user?.active === true && clean(user.id || user.uid) !== clean(ownerId) && predicate(user)) || null;
}
function delegateUser(users, delegations, departmentId, permission, predicate, ownerId) {
  const delegation = (delegations || []).find(item => delegationActive(item, permission, departmentId));
  if (!delegation || clean(delegation.delegateUserId) === clean(ownerId)) return null;
  const user = findUser(users, delegation.delegateUserId);
  return user && user.active === true && predicate(user) ? user : null;
}

export function resolveKpiReviewer({ users = [], delegations = [], owner, scopeDepartmentId = "" } = {}) {
  if (!owner) return null;
  const ownerId = clean(owner.id || owner.uid);
  const scope = upper(scopeDepartmentId || owner.departmentId);

  if (scope === "CDTN") {
    if (isCdtnSecretary(owner)) {
      const delegatedDirector = delegateUser(users, delegations, "BGD", "CONFIRM_EVALUATIONS", isDirectorDeputy, ownerId);
      if (delegatedDirector) return delegatedDirector;
      return candidate(users, isDirectorHead, ownerId);
    }
    if (isCdtnDeputySecretary(owner)) {
      return candidate(users, isCdtnSecretary, ownerId);
    }
    if (isCdtnMember(owner)) {
      const delegatedSecretary = delegateUser(users, delegations, "CDTN", "CONFIRM_EVALUATIONS", isCdtnDeputySecretary, ownerId);
      if (delegatedSecretary) return delegatedSecretary;
      return candidate(users, isCdtnSecretary, ownerId);
    }
    return null;
  }

  if (upper(owner.role) === "STAFF" || upper(owner.role) === "TCHC_COORDINATOR") {
    const delegatedDeputy = delegateUser(
      users,
      delegations,
      owner.departmentId,
      "CONFIRM_EVALUATIONS",
      user => isDepartmentDeputyProfile(user) && sameDepartment(user, owner),
      ownerId
    );
    if (delegatedDeputy) return delegatedDeputy;
    const departmentHead = candidate(users, user => isDepartmentHeadProfile(user) && sameDepartment(user, owner), ownerId);
    if (departmentHead) return departmentHead;
    /* Phòng/Khu không có Trưởng hoặc người phụ trách: chuyển hồ sơ lên Ban Giám đốc. */
    const delegatedDirector = delegateUser(users, delegations, "BGD", "CONFIRM_EVALUATIONS", isDirectorDeputy, ownerId);
    if (delegatedDirector) return delegatedDirector;
    return candidate(users, isDirectorHead, ownerId);
  }

  if (isDepartmentDeputyProfile(owner)) {
    const departmentHead = candidate(users, user => isDepartmentHeadProfile(user) && sameDepartment(user, owner), ownerId);
    if (departmentHead) return departmentHead;
    const delegatedDirector = delegateUser(users, delegations, "BGD", "CONFIRM_EVALUATIONS", isDirectorDeputy, ownerId);
    if (delegatedDirector) return delegatedDirector;
    return candidate(users, isDirectorHead, ownerId);
  }

  if (isDepartmentHeadProfile(owner)) {
    const delegatedDirector = delegateUser(users, delegations, "BGD", "CONFIRM_EVALUATIONS", isDirectorDeputy, ownerId);
    if (delegatedDirector) return delegatedDirector;
    return candidate(users, isDirectorHead, ownerId);
  }

  if (isDirectorDeputy(owner)) {
    return candidate(users, isDirectorHead, ownerId);
  }

  /* Giám đốc tự đánh giá không được tự duyệt; ngoài ma trận nội bộ đã chốt. */
  if (isDirectorHead(owner)) return null;
  return null;
}

export function canReviewKpiOwner({ currentUser, users = [], delegations = [], owner, scopeDepartmentId = "" } = {}) {
  if (!currentUser || !owner) return false;
  const currentId = clean(currentUser.id || currentUser.uid);
  const ownerId = clean(owner.id || owner.uid);
  if (!currentId || currentId === ownerId) return false;
  if (upper(currentUser.role) === "ADMIN") return true;
  const reviewer = resolveKpiReviewer({ users, delegations, owner, scopeDepartmentId });
  return Boolean(reviewer && clean(reviewer.id || reviewer.uid) === currentId);
}
