/** Quản lý quyền điểm danh Chi đoàn như một vai trò kiêm nhiệm. */
import { FirebaseService } from "../core/firebase-service.js?v=20260825.V1_18_0";
import { UserContext } from "../core/user-context.js?v=20260825.V1_18_0";
import { Permissions } from "../core/permissions.js?v=20260825.V1_18_0";

const DOCUMENT_ID = "CDTN_ATTENDANCE_ACTIVE";
const PERMISSION = "MANAGE_CDTN_ATTENDANCE";

function dateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function activeDelegation(data, user = UserContext.getUser()) {
  const today = dateKey();
  return Boolean(
    data?.active === true &&
    data.delegateUserId === user?.uid &&
    Array.isArray(data.permissions) &&
    data.permissions.includes(PERMISSION) &&
    (!data.startDate || data.startDate <= today) &&
    (!data.endDate || data.endDate >= today)
  );
}

async function readDelegation() {
  const snapshot = await FirebaseService.getDoc(
    FirebaseService.doc(FirebaseService.db, "approvalDelegations", DOCUMENT_ID)
  );
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

export const CdtnAttendanceService = Object.freeze({
  DOCUMENT_ID,
  PERMISSION,
  activeDelegation,

  async getDelegation() {
    return readDelegation();
  },

  async canManage() {
    if (Permissions.isAdmin() || Permissions.isCdtnLeadership()) {
      return true;
    }
    if (!Permissions.isCdtnMember()) return false;
    try {
      return activeDelegation(await readDelegation());
    } catch (_) {
      return false;
    }
  },

  async listCandidates() {
    const user = UserContext.requireUser();
    if (!Permissions.isCdtnLeadership()) return [];
    const roles = ["CDTN_BI_THU", "CDTN_PHO_BI_THU", "CDTN_UY_VIEN_BCH", "CDTN_DOAN_VIEN"];
    const snapshots = await Promise.all(roles.map(role => FirebaseService.getDocs(
      FirebaseService.query(
        FirebaseService.collection(FirebaseService.db, "users"),
        FirebaseService.where("additionalRoles", "array-contains", role),
        FirebaseService.limit(300)
      )
    )));
    const byId = new Map();
    snapshots.forEach(snapshot => snapshot.docs.forEach(item => byId.set(item.id, { id: item.id, ...item.data() })));
    return [...byId.values()]
      .filter(item => item.active === true)
      .filter(item => Array.isArray(item.additionalRoles) && item.additionalRoles.some(role => roles.includes(String(role || "").toUpperCase())))
      .filter(item => item.id !== user.uid)
      .sort((a, b) => String(a.fullName || "").localeCompare(String(b.fullName || ""), "vi"));
  },

  async saveDelegation({ delegateUserId, startDate, endDate, reason }) {
    const user = UserContext.requireUser();
    if (!Permissions.isCdtnLeadership()) {
      throw new Error("Chỉ Bí thư hoặc Phó Bí thư được ủy quyền điểm danh.");
    }
    if (!delegateUserId) throw new Error("Hãy chọn người được ủy quyền.");
    if (!startDate || !endDate || startDate > endDate) throw new Error("Thời gian ủy quyền chưa hợp lệ.");
    const candidates = await this.listCandidates();
    const delegate = candidates.find(item => item.id === delegateUserId);
    if (!delegate) throw new Error("Người được chọn không thuộc danh sách Chi đoàn đang hoạt động.");
    const reference = FirebaseService.doc(FirebaseService.db, "approvalDelegations", DOCUMENT_ID);
    await FirebaseService.setDoc(reference, {
      delegationType: "CDTN_ATTENDANCE",
      organizationId: "CDTN",
      departmentId: "CDTN",
      delegatorUserId: user.uid,
      delegatorName: user.fullName || "",
      delegateUserId: delegate.id,
      delegateName: delegate.fullName || "",
      permissions: [PERMISSION],
      startDate,
      endDate,
      startAt: FirebaseService.Timestamp.fromDate(new Date(`${startDate}T00:00:00`)),
      endAt: FirebaseService.Timestamp.fromDate(new Date(`${endDate}T23:59:59`)),
      reason: String(reason || "").trim(),
      active: true,
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: user.uid,
      updatedByName: user.fullName || ""
    }, { merge: true });
  },

  async revokeDelegation() {
    const user = UserContext.requireUser();
    if (!Permissions.isCdtnLeadership()) {
      throw new Error("Chỉ Bí thư hoặc Phó Bí thư được thu hồi ủy quyền điểm danh.");
    }
    await FirebaseService.updateDoc(
      FirebaseService.doc(FirebaseService.db, "approvalDelegations", DOCUMENT_ID),
      {
        active: false,
        revokedAt: FirebaseService.serverTimestamp(),
        revokedByUserId: user.uid,
        revokedByName: user.fullName || "",
        updatedAt: FirebaseService.serverTimestamp(),
        updatedByUserId: user.uid
      }
    );
  }
});
