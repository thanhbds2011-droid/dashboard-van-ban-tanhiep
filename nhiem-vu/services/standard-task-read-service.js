/** Đọc danh mục đầu việc theo đơn vị, vai trò và vai trò kiêm nhiệm. */
import { FirebaseService } from "../core/firebase-service.js";
import { UserContext } from "../core/user-context.js";
import { Permissions } from "../core/permissions.js?v=20260802.V1_6_0";

const CATALOG_CACHE_MS = 5 * 60 * 1000;
let catalogCache = { key: "", items: [], loadedAt: 0 };
let catalogRequest = null;

const clean = value => String(value ?? "").trim();
const upper = value => clean(value).toUpperCase();
const mapSnapshot = snapshot => snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

function timestampValue(value) {
  if (value?.toMillis) return value.toMillis();
  if (value?.toDate) return value.toDate().getTime();
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function deduplicateByCode(items = []) {
  const byCode = new Map();
  for (const item of items) {
    const key = upper(item.code || item.id);
    if (!key) continue;
    const current = byCode.get(key);
    if (!current) {
      byCode.set(key, item);
      continue;
    }
    const itemExact = upper(item.id) === key;
    const currentExact = upper(current.id) === key;
    if (itemExact && !currentExact) byCode.set(key, item);
    else if (itemExact === currentExact && timestampValue(item.updatedAt) > timestampValue(current.updatedAt)) byCode.set(key, item);
  }
  return [...byCode.values()];
}

function audienceOf(item) {
  return upper(item?.audienceType || (item?.isManagementTask ? "MANAGEMENT" : "ALL_DEPARTMENT"));
}

function canRegisterCdtnItem(item) {
  const audience = audienceOf(item);
  if (audience === "CDTN_SECRETARY") return Permissions.isCdtnSecretary();
  if (audience === "CDTN_EXECUTIVE") return Permissions.isCdtnExecutiveMember();
  return audience === "CDTN_MEMBER" && Permissions.isCdtnMember();
}

/**
 * Chỉ kiểm tra quyền ĐĂNG KÝ, khác với quyền xem để quản trị.
 * - Nhân viên: chỉ đầu việc cốt lõi, không phải đầu việc quản lý.
 * - Trưởng/Phó phòng: được đăng ký đầu việc cốt lõi và đầu việc quản lý của đơn vị.
 * - Ban Giám đốc: được đăng ký danh mục BGD và được duyệt ngay.
 * - Chi đoàn: tách theo additionalRoles, không trộn vào phòng chuyên môn.
 */
function canRegisterItem(item, user = UserContext.requireUser()) {
  const departmentId = upper(item?.departmentId);
  const audience = audienceOf(item);

  if (item?.active === false) return false;
  if (departmentId === "CDTN") return canRegisterCdtnItem(item);
  if (departmentId !== upper(user.departmentId)) return false;

  if (Permissions.isDirector()) return departmentId === "BGD";
  if (Permissions.isDepartmentLeader()) {
    return audience === "MANAGEMENT" || item?.isCoreTaskDefault === true;
  }

  return audience === "ALL_DEPARTMENT"
    && item?.isManagementTask !== true
    && item?.isCoreTaskDefault === true;
}

function canViewItem(item, user = UserContext.requireUser()) {
  const departmentId = upper(item?.departmentId);
  if (Permissions.canViewAllDepartments()) return true;
  if (departmentId === "CDTN") return canRegisterCdtnItem(item) || Permissions.isCdtnCatalogManager();
  if (departmentId !== upper(user.departmentId)) return false;
  if (Permissions.isDepartmentLeader()) return true;
  return canRegisterItem(item, user);
}

function normalize(items = []) {
  const user = UserContext.requireUser();
  return deduplicateByCode(items)
    .filter(item => item.active !== false)
    .filter(item => canViewItem(item, user))
    .sort((a, b) => Number(a.order || 9999) - Number(b.order || 9999)
      || String(a.code || a.id).localeCompare(String(b.code || b.id), "vi"));
}

function audienceQuery(reference, departmentId, audienceType, limitValue = 500) {
  return FirebaseService.query(
    reference,
    FirebaseService.where("departmentId", "==", departmentId),
    FirebaseService.where("audienceType", "==", audienceType),
    FirebaseService.limit(limitValue)
  );
}

function sourceReferences() {
  const user = UserContext.requireUser();
  const reference = FirebaseService.collection(FirebaseService.db, "standardTasks");
  if (Permissions.canViewAllDepartments()) {
    return [FirebaseService.query(reference, FirebaseService.limit(2000))];
  }

  const queries = [];
  if (Permissions.isDepartmentLeader()) {
    queries.push(FirebaseService.query(
      reference,
      FirebaseService.where("departmentId", "==", upper(user.departmentId)),
      FirebaseService.limit(1000)
    ));
  } else {
    /*
     * Nhân viên chỉ đọc đầu việc cốt lõi của đúng đơn vị. Đưa điều kiện
     * isCoreTaskDefault vào chính truy vấn để Firestore Rules có thể chứng minh
     * toàn bộ tập kết quả đều hợp lệ, tránh lỗi “Missing or insufficient permissions”.
     * Đầu việc quản lý được chuẩn hóa isCoreTaskDefault = false nên không lọt vào đây.
     */
    queries.push(FirebaseService.query(
      reference,
      FirebaseService.where("departmentId", "==", upper(user.departmentId)),
      FirebaseService.where("audienceType", "==", "ALL_DEPARTMENT"),
      FirebaseService.where("isCoreTaskDefault", "==", true),
      FirebaseService.where("isManagementTask", "==", false),
      FirebaseService.limit(500)
    ));
  }

  if (Permissions.isCdtnSecretary()) {
    queries.push(FirebaseService.query(
      reference,
      FirebaseService.where("departmentId", "==", "CDTN"),
      FirebaseService.limit(500)
    ));
  } else if (Permissions.isCdtnExecutiveMember()) {
    queries.push(audienceQuery(reference, "CDTN", "CDTN_EXECUTIVE"));
    queries.push(audienceQuery(reference, "CDTN", "CDTN_MEMBER"));
  } else if (Permissions.isCdtnMember()) {
    queries.push(audienceQuery(reference, "CDTN", "CDTN_MEMBER"));
  }
  return queries;
}

function currentCacheKey() {
  const user = UserContext.requireUser();
  return [user.uid, user.role, user.departmentId, ...(user.additionalRoles || [])].join("|");
}

async function readAllReferences(options = {}) {
  const force = options.force === true;
  const key = currentCacheKey();
  if (!force && catalogCache.key === key && Date.now() - catalogCache.loadedAt < CATALOG_CACHE_MS) return catalogCache.items;
  if (!force && catalogRequest?.key === key) return catalogRequest.promise;

  const promise = Promise.all(sourceReferences().map(ref => FirebaseService.getDocs(ref)))
    .then(snapshots => normalize(snapshots.flatMap(mapSnapshot)))
    .then(items => {
      catalogCache = { key, items, loadedAt: Date.now() };
      return items;
    });
  catalogRequest = { key, promise };
  try {
    return await promise;
  } finally {
    if (catalogRequest?.promise === promise) catalogRequest = null;
  }
}

export const StandardTaskReadService = Object.freeze({
  list: readAllReferences,
  invalidate() {
    catalogCache = { key: "", items: [], loadedAt: 0 };
    catalogRequest = null;
  },
  subscribe(onData, onError) {
    if (typeof onData !== "function") throw new Error("Thiếu hàm nhận dữ liệu danh mục công việc.");
    const references = sourceReferences();
    const stores = references.map(() => []);
    const initialized = references.map(() => false);
    const emit = () => initialized.every(Boolean) && onData(normalize(stores.flat()));
    const unsubscribers = references.map((reference, index) => FirebaseService.onSnapshot(
      reference,
      snapshot => {
        stores[index] = mapSnapshot(snapshot);
        initialized[index] = true;
        emit();
      },
      error => {
        console.error("Không thể theo dõi danh mục công việc:", error);
        onError?.(error);
      }
    ));
    return () => unsubscribers.forEach(unsubscribe => unsubscribe?.());
  },
  canRegisterItem,
  canViewItem,
  workspaceId(item, user = UserContext.requireUser()) {
    return upper(item?.departmentId) === "CDTN" ? "CDTN" : upper(user.departmentId);
  },
  summarize(items = []) {
    const regular = items.filter(item => upper(item.workType) === "THUONG_XUYEN").length;
    const unexpected = items.filter(item => upper(item.workType) === "DOT_XUAT").length;
    const average = items.length
      ? items.reduce((sum, item) => sum + Number(item.maximumConvertedScore || 0), 0) / items.length
      : 0;
    return { total: items.length, regular, unexpected, averageMaximumScore: average };
  }
});
