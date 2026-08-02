/** Đọc danh mục đầu việc theo đơn vị, vai trò và vai trò kiêm nhiệm. */
import { FirebaseService } from "../core/firebase-service.js";
import { UserContext } from "../core/user-context.js";
import { Permissions } from "../core/permissions.js?v=20260801.V1_5_0";

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
    if (!current) { byCode.set(key, item); continue; }
    const itemExact = upper(item.id) === key;
    const currentExact = upper(current.id) === key;
    if (itemExact && !currentExact) byCode.set(key, item);
    else if (itemExact === currentExact && timestampValue(item.updatedAt) > timestampValue(current.updatedAt)) byCode.set(key, item);
  }
  return [...byCode.values()];
}

function canRegisterItem(item, user = UserContext.requireUser()) {
  const departmentId = upper(item?.departmentId);
  const audience = upper(item?.audienceType || (item?.isManagementTask ? "MANAGEMENT" : "ALL_DEPARTMENT"));

  if (departmentId === "CDTN") {
    if (audience === "CDTN_SECRETARY") return Permissions.isCdtnSecretary() || Permissions.isCdtnDeputySecretary();
    if (audience === "CDTN_EXECUTIVE") return Permissions.isCdtnExecutiveMember();
    return audience === "CDTN_MEMBER" && Permissions.isCdtnMember();
  }

  if (departmentId !== upper(user.departmentId)) return false;
  if (audience === "MANAGEMENT") return Permissions.isDepartmentLeader() || Permissions.isDirector();
  return audience === "ALL_DEPARTMENT";
}

function normalize(items = []) {
  const user = UserContext.requireUser();
  const canBrowse = Permissions.canViewAllDepartments() || Permissions.isDepartmentLeader();
  return deduplicateByCode(items)
    .filter(item => item.active !== false)
    .filter(item => canBrowse || canRegisterItem(item, user))
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
  if (Permissions.canViewAllDepartments()) return [FirebaseService.query(reference, FirebaseService.limit(2000))];

  const queries = [];
  if (Permissions.isDepartmentLeader()) {
    queries.push(FirebaseService.query(
      reference,
      FirebaseService.where("departmentId", "==", user.departmentId),
      FirebaseService.limit(1000)
    ));
  } else {
    queries.push(audienceQuery(reference, user.departmentId, "ALL_DEPARTMENT"));
  }

  if (Permissions.isCdtnSecretary() || Permissions.isCdtnDeputySecretary()) {
    queries.push(FirebaseService.query(reference, FirebaseService.where("departmentId", "==", "CDTN"), FirebaseService.limit(500)));
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
  try { return await promise; }
  finally { if (catalogRequest?.promise === promise) catalogRequest = null; }
}

export const StandardTaskReadService = Object.freeze({
  list: readAllReferences,
  invalidate() { catalogCache = { key: "", items: [], loadedAt: 0 }; catalogRequest = null; },
  subscribe(onData, onError) {
    if (typeof onData !== "function") throw new Error("Thiếu hàm nhận dữ liệu danh mục công việc.");
    const references = sourceReferences();
    const stores = references.map(() => []);
    const initialized = references.map(() => false);
    const emit = () => initialized.every(Boolean) && onData(normalize(stores.flat()));
    const unsubscribers = references.map((reference, index) => FirebaseService.onSnapshot(
      reference,
      snapshot => { stores[index] = mapSnapshot(snapshot); initialized[index] = true; emit(); },
      error => { console.error("Không thể theo dõi danh mục công việc:", error); onError?.(error); }
    ));
    return () => unsubscribers.forEach(unsubscribe => unsubscribe?.());
  },
  canRegisterItem,
  summarize(items = []) {
    const regular = items.filter(item => upper(item.workType) === "THUONG_XUYEN").length;
    const unexpected = items.filter(item => upper(item.workType) === "DOT_XUAT").length;
    const average = items.length ? items.reduce((sum, item) => sum + Number(item.maximumConvertedScore || 0), 0) / items.length : 0;
    return { total: items.length, regular, unexpected, averageMaximumScore: average };
  }
});
