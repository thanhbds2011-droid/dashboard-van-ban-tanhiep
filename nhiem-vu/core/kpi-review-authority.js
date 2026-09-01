/**
 * Ma trận xác nhận KPI V1.19.0.
 *
 * Nguyên tắc:
 * - Quyền phê duyệt đơn vị lấy từ approvalAuthority=HEAD (leaderLevel chỉ là lớp tương thích).
 * - Không hard-code TCHC/YT/KHTC/CTXH: mọi Phòng/Khu dùng cùng một authority resolver.
 * - Ủy quyền BỔ SUNG quyền cho cấp phó, không làm mất quyền gốc của người phụ trách đơn vị.
 * - Người có quyền phê duyệt đơn vị tự chấm phải chuyển lên Ban Giám đốc.
 * - SELF REQUEST != FINAL APPROVAL: không ai tự xác nhận điểm/điểm thưởng của chính mình.
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
  const authority = upper(user.approvalAuthority);
  const authorityFieldPresent = user.approvalAuthorityPresent === true
    || Object.prototype.hasOwnProperty.call(user, "approvalAuthority");
  if (authorityFieldPresent) {
    if (authority === "HEAD") return "HEAD";
    if (authority === "DEPUTY") return "DEPUTY";
    return "";
  }

  const explicit = upper(user.leaderLevel);
  if (["HEAD", "DEPARTMENT_HEAD", "TRUONG"].includes(explicit)) return "HEAD";
  if (["DEPUTY", "DEPARTMENT_DEPUTY", "PHO"].includes(explicit)) return "DEPUTY";
  if (user.isDepartmentHead === true && upper(user.role) === "DEPARTMENT_LEADER") return "HEAD";

  const role = upper(user.role);
  const position = normalize(user.position);
  if (role === "DIRECTOR") {
    if (/^pho\s+giam\s+doc\b/.test(position)) return "DEPUTY";
    if (/^(quyen\s+)?giam\s+doc\b/.test(position)) return "HEAD";
  }
  if (role === "DEPARTMENT_LEADER") {
    if (/\b(phu\s+trach|quyen\s+truong)\b/.test(position)) return "HEAD";
    if (/^(truong\s+phong|truong\s+khu)\b/.test(position)) return "HEAD";
    if (/^(pho\s+truong|pho\s+phong|pho\s+khu|p\s*truong|ptp|ptk)\b/.test(position)) return "DEPUTY";
  }
  return "";
}

export function isDirectorHead(user = {}) { return upper(user.role) === "DIRECTOR" && leaderLevelOf(user) === "HEAD"; }
export function isDirectorDeputy(user = {}) { return upper(user.role) === "DIRECTOR" && leaderLevelOf(user) === "DEPUTY"; }
export function isUnitApprovalAuthorityProfile(user = {}) {
  const role = upper(user.role);
  return ["DEPARTMENT_LEADER", "ADMIN"].includes(role)
    && upper(user.departmentId) !== "BGD"
    && leaderLevelOf(user) === "HEAD";
}
export function isDepartmentHeadProfile(user = {}) { return isUnitApprovalAuthorityProfile(user); }
export function isDepartmentDeputyProfile(user = {}) {
  const role = upper(user.role);
  return ["DEPARTMENT_LEADER", "ADMIN"].includes(role)
    && upper(user.departmentId) !== "BGD"
    && leaderLevelOf(user) === "DEPUTY";
}

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

function userId(user) { return clean(user?.id || user?.uid); }
function findUser(users, id) { return (users || []).find(user => userId(user) === clean(id)) || null; }
function sameDepartment(a, b) { return upper(a?.departmentId) && upper(a?.departmentId) === upper(b?.departmentId); }
function activeCandidates(users, predicate, ownerId) {
  return (users || []).filter(user => user?.active === true && userId(user) !== clean(ownerId) && predicate(user));
}
function uniqueUsers(users = []) {
  const seen = new Set();
  return users.filter(user => {
    const id = userId(user);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
function delegateUser(users, delegations, departmentId, permission, predicate, ownerId) {
  const delegation = (delegations || []).find(item => delegationActive(item, permission, departmentId));
  if (!delegation || clean(delegation.delegateUserId) === clean(ownerId)) return null;
  const user = findUser(users, delegation.delegateUserId);
  return user && user.active === true && predicate(user) ? user : null;
}
function unitAuthorities(users, departmentId, ownerId) {
  const department = upper(departmentId);
  return activeCandidates(
    users,
    user => isUnitApprovalAuthorityProfile(user) && upper(user.departmentId) === department,
    ownerId
  );
}
function directorReviewers(users, delegations, ownerId) {
  const delegated = delegateUser(users, delegations, "BGD", "CONFIRM_EVALUATIONS", isDirectorDeputy, ownerId);
  const heads = activeCandidates(users, isDirectorHead, ownerId);
  return uniqueUsers([delegated, ...heads].filter(Boolean));
}

/** Trả về TOÀN BỘ người có thẩm quyền xác nhận, theo thứ tự ưu tiên nghiệp vụ. */
export function resolveKpiReviewers({ users = [], delegations = [], owner, scopeDepartmentId = "" } = {}) {
  if (!owner) return [];
  const ownerId = userId(owner);
  const scope = upper(scopeDepartmentId || owner.departmentId);

  if (scope === "CDTN") {
    if (isCdtnSecretary(owner)) return directorReviewers(users, delegations, ownerId);
    if (isCdtnDeputySecretary(owner)) {
      return activeCandidates(users, isCdtnSecretary, ownerId);
    }
    if (isCdtnMember(owner)) {
      const delegatedSecretary = delegateUser(users, delegations, "CDTN", "CONFIRM_EVALUATIONS", isCdtnDeputySecretary, ownerId);
      const secretaries = activeCandidates(users, isCdtnSecretary, ownerId);
      return uniqueUsers([delegatedSecretary, ...secretaries].filter(Boolean));
    }
    return [];
  }

  if (isDirectorHead(owner)) return [];
  if (isDirectorDeputy(owner)) return activeCandidates(users, isDirectorHead, ownerId);

  // Người đang giữ Quyền phê duyệt đơn vị (dù chức danh là Trưởng hay Phó phụ trách)
  // tự chấm phải chuyển lên BGD.
  if (isUnitApprovalAuthorityProfile(owner)) {
    return directorReviewers(users, delegations, ownerId);
  }

  const ownerSystemRole = upper(owner.role);
  const ownerIsDeputy = isDepartmentDeputyProfile(owner);
  const ownerIsAdminStaff = ownerSystemRole === "ADMIN" && !isUnitApprovalAuthorityProfile(owner) && !ownerIsDeputy;
  const ownerKpiRole = ownerIsDeputy ? "DEPARTMENT_LEADER" : (ownerIsAdminStaff ? "STAFF" : ownerSystemRole);
  if (["STAFF", "TCHC_COORDINATOR", "DEPARTMENT_LEADER"].includes(ownerKpiRole)) {
    const authorities = unitAuthorities(users, scope || owner.departmentId, ownerId);
    if (ownerKpiRole === "DEPARTMENT_LEADER" && !ownerIsDeputy) return [];

    // Với nhân viên: Phó được ủy quyền có quyền bổ sung, người phụ trách đơn vị vẫn giữ quyền gốc.
    const delegatedDeputy = ownerKpiRole === "DEPARTMENT_LEADER"
      ? null // Phó không được tự dùng ủy quyền để duyệt chính mình.
      : delegateUser(
          users,
          delegations,
          scope || owner.departmentId,
          "CONFIRM_EVALUATIONS",
          user => isDepartmentDeputyProfile(user) && sameDepartment(user, owner),
          ownerId
        );
    const reviewers = uniqueUsers([delegatedDeputy, ...authorities].filter(Boolean));
    // Cấu hình phòng thiếu người có approvalAuthority=HEAD không được làm nghẽn kỳ KPI.
    // Đây là fallback an toàn: chuyển lên BGD; khi Danh mục tài khoản có người phụ trách hợp lệ,
    // reviewer trong đơn vị luôn được ưu tiên và BGD không xuất hiện ở UI.
    return reviewers.length ? reviewers : directorReviewers(users, delegations, ownerId);
  }

  return [];
}

/** Reviewer chính để lưu snapshot/hiển thị routing; quyền thực tế dùng resolveKpiReviewers(). */
export function resolveKpiReviewer(options = {}) {
  return resolveKpiReviewers(options)[0] || null;
}

export function canReviewKpiOwner({ currentUser, users = [], delegations = [], owner, scopeDepartmentId = "" } = {}) {
  if (!currentUser || !owner) return false;
  const currentId = userId(currentUser);
  const ownerId = userId(owner);
  if (!currentId || currentId === ownerId) return false;
  return resolveKpiReviewers({ users, delegations, owner, scopeDepartmentId })
    .some(reviewer => userId(reviewer) === currentId);
}
