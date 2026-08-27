/** Đọc danh mục đầu việc theo đơn vị, vai trò và vai trò kiêm nhiệm. */
import { FirebaseService } from "../core/firebase-service.js?v=20260826.V1_19_0";
import { UserContext } from "../core/user-context.js?v=20260826.V1_19_0";
import { Permissions } from "../core/permissions.js?v=20260826.V1_19_0";

const CATALOG_CACHE_MS = 5 * 60 * 1000;
const PROFESSIONAL_DEPARTMENT_IDS = Object.freeze(["BGD", "TCHC", "CTXH", "KHTC", "YT", "KI", "KII", "KIII"]);
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
  return upper(item?.audienceType);
}

function canRegisterCdtnItem(item) {
  const audience = audienceOf(item);
  if (audience === "CDTN_SECRETARY") return Permissions.isCdtnLeadership();
  if (audience === "CDTN_EXECUTIVE") return Permissions.isCdtnExecutiveMember();
  return audience === "CDTN_MEMBER" && Permissions.isCdtnMember();
}

/**
 * Chỉ kiểm tra quyền ĐĂNG KÝ, khác với quyền xem để quản trị.
 * - audienceType là nguồn quyết định quyền đăng ký.
 * - ALL_DEPARTMENT: nhân viên và lãnh đạo đúng đơn vị đều được đăng ký.
 * - MANAGEMENT: chỉ lãnh đạo đúng đơn vị được đăng ký.
 * - Ban Giám đốc: được đăng ký danh mục BGD và được duyệt ngay.
 * - Chi đoàn: tách theo additionalRoles, không trộn vào phòng chuyên môn.
 */
function canRegisterItem(item, user = UserContext.requireUser()) {
  const departmentId = upper(item?.departmentId);
  const audience = audienceOf(item);

  if (item?.active === false) return false;
  if (departmentId === "CDTN") return canRegisterCdtnItem(item);
  if (departmentId !== upper(user.departmentId)) return false;

  if (Permissions.isDirector()) return departmentId === "BGD" && ["ALL_DEPARTMENT", "MANAGEMENT"].includes(audience);
  if (Permissions.isDepartmentLeader()) return ["ALL_DEPARTMENT", "MANAGEMENT"].includes(audience);

  return audience === "ALL_DEPARTMENT";
}

function canViewItem(item, user = UserContext.requireUser()) {
  const departmentId = upper(item?.departmentId);
  if (Permissions.canViewAllScopes()) return true;
  if (Permissions.canViewAllDepartments() && PROFESSIONAL_DEPARTMENT_IDS.includes(departmentId)) return true;
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
  if (Permissions.canViewAllScopes()) {
    return [FirebaseService.query(reference, FirebaseService.limit(2000))];
  }

  if (Permissions.isTchcCoordinator()) {
    return [FirebaseService.query(
      reference,
      FirebaseService.where("departmentId", "in", PROFESSIONAL_DEPARTMENT_IDS),
      FirebaseService.limit(2000)
    )];
  }

  if (Permissions.isTchcDepartmentLeader()) {
    // Trưởng/Phó TCHC xem toàn bộ danh mục chuyên môn; Chi đoàn chỉ tải nếu có additionalRoles phù hợp.
    const queries = [FirebaseService.query(
      reference,
      FirebaseService.where("departmentId", "in", PROFESSIONAL_DEPARTMENT_IDS),
      FirebaseService.limit(2000)
    )];
    if (Permissions.isCdtnLeadership()) {
      queries.push(FirebaseService.query(reference, FirebaseService.where("departmentId", "==", "CDTN"), FirebaseService.limit(500)));
    } else if (Permissions.isCdtnExecutiveMember()) {
      queries.push(audienceQuery(reference, "CDTN", "CDTN_EXECUTIVE"));
      queries.push(audienceQuery(reference, "CDTN", "CDTN_MEMBER"));
    } else if (Permissions.isCdtnMember()) {
      queries.push(audienceQuery(reference, "CDTN", "CDTN_MEMBER"));
    }
    return queries;
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
     * Nhân viên đọc toàn bộ đầu việc ALL_DEPARTMENT của đúng đơn vị.
     * isCoreTaskDefault chỉ là metadata KPI; isManagementTask là metadata tương thích cũ.
     * Hai cờ này không được ghi đè audienceType và làm mất đầu việc của nhân viên.
     */
    queries.push(FirebaseService.query(
      reference,
      FirebaseService.where("departmentId", "==", upper(user.departmentId)),
      FirebaseService.where("audienceType", "==", "ALL_DEPARTMENT"),
      FirebaseService.limit(1000)
    ));
  }

  if (Permissions.isCdtnLeadership()) {
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

  const promise = Promise.allSettled(sourceReferences().map(ref => FirebaseService.getDocs(ref)))
    .then(results => {
      const snapshots = results.filter(result => result.status === "fulfilled").map(result => result.value);
      results.filter(result => result.status === "rejected").forEach((result, index) => {
        console.warn(`Không tải được nhánh danh mục ${index + 1}; tiếp tục với nhánh còn lại:`, result.reason);
      });
      if (!snapshots.length) throw results.find(result => result.status === "rejected")?.reason || new Error("Không tải được danh mục công việc.");
      return normalize(snapshots.flatMap(mapSnapshot));
    })
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
    const failed = references.map(() => false);
    const emit = () => {
      if (!initialized.every(Boolean)) return;
      if (failed.every(Boolean)) {
        onError?.(new Error("Không thể theo dõi bất kỳ nhánh danh mục công việc nào."));
        return;
      }
      onData(normalize(stores.flat()));
    };
    const unsubscribers = references.map((reference, index) => FirebaseService.onSnapshot(
      reference,
      snapshot => {
        stores[index] = mapSnapshot(snapshot);
        initialized[index] = true;
        failed[index] = false;
        emit();
      },
      error => {
        console.warn(`Không thể theo dõi nhánh danh mục ${index + 1}; tiếp tục với nhánh còn lại:`, error);
        stores[index] = [];
        initialized[index] = true;
        failed[index] = true;
        emit();
      }
    ));
    return () => unsubscribers.forEach(unsubscribe => unsubscribe?.());
  },
  canRegisterItem,
  canViewItem,
  workspaceId(item, user = UserContext.requireUser()) {
    // V1.10.2: workspace phải theo đúng đơn vị của đầu việc. Trước đây mọi đầu việc
    // chuyên môn có thể bị gom về Phòng/Khu của người đang đăng nhập khi tài khoản
    // có phạm vi đọc rộng, khiến danh mục trên mobile rất dài và sai nhóm.
    const itemDepartmentId = upper(item?.departmentId);
    return itemDepartmentId || upper(user.departmentId);
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
