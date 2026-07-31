/** Dịch vụ đọc danh mục đầu việc chuẩn. */
import { FirebaseService } from "../core/firebase-service.js";
import { UserContext } from "../core/user-context.js";
import { Permissions } from "../core/permissions.js?v=20260731.V1_1_18";

function clean(value) {
  return String(value ?? "").trim();
}

function mapSnapshot(snapshot) {
  return snapshot.docs.map(documentSnapshot => ({ id: documentSnapshot.id, ...documentSnapshot.data() }));
}

function timestampValue(value) {
  if (value?.toMillis) return value.toMillis();
  if (value?.toDate) return value.toDate().getTime();
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

/*
 * Một số bản cũ tạo document ID dạng TCHC_TCHC29 trong khi Google Sheet
 * dùng TCHC29. Dedupe theo trường code để giao diện không hiển thị hai lần.
 * Ưu tiên document có ID trùng code, sau đó ưu tiên bản cập nhật mới hơn.
 */
function deduplicateByCode(items = []) {
  const map = new Map();

  for (const item of items) {
    const key = clean(item.code || item.id).toUpperCase();
    if (!key) continue;

    const existing = map.get(key);
    if (!existing) {
      map.set(key, item);
      continue;
    }

    const currentExact = clean(item.id).toUpperCase() === key;
    const existingExact = clean(existing.id).toUpperCase() === key;

    if (currentExact && !existingExact) {
      map.set(key, item);
      continue;
    }

    if (currentExact === existingExact && timestampValue(item.updatedAt) > timestampValue(existing.updatedAt)) {
      map.set(key, item);
    }
  }

  return [...map.values()];
}

function normalize(items = []) {
  return deduplicateByCode(items)
    .filter(item => item.active !== false)
    .sort((a, b) => Number(a.order || 9999) - Number(b.order || 9999) || String(a.code || a.id).localeCompare(String(b.code || b.id), "vi"));
}

function canRegisterItem(item, user = UserContext.requireUser()) {
  const departmentId = clean(item?.departmentId).toUpperCase();
  const audience = clean(
    item?.audienceType || (item?.isManagementTask ? "MANAGEMENT" : "ALL_DEPARTMENT")
  ).toUpperCase();

  if (departmentId === "CDTN") {
    if (audience === "CDTN_SECRETARY") return Permissions.isCdtnSecretary();
    if (audience === "CDTN_EXECUTIVE") return Permissions.isCdtnExecutiveMember();
    return Permissions.isCdtnMember();
  }

  if (departmentId !== clean(user.departmentId).toUpperCase()) return false;
  if (audience === "MANAGEMENT") {
    return Permissions.isDepartmentLeader() || Permissions.isDirector();
  }
  return true;
}

function sourceReferences() {
  const user = UserContext.requireUser();
  const reference = FirebaseService.collection(FirebaseService.db, "standardTasks");
  if (Permissions.canViewAllDepartments()) return [reference];

  const references = [
    FirebaseService.query(reference, FirebaseService.where("departmentId", "==", user.departmentId))
  ];
  if (Permissions.isCdtnMember()) {
    references.push(
      FirebaseService.query(reference, FirebaseService.where("departmentId", "==", "CDTN"))
    );
  }
  return references;
}

async function readAllReferences() {
  const snapshots = await Promise.all(sourceReferences().map(reference => FirebaseService.getDocs(reference)));
  return normalize(snapshots.flatMap(mapSnapshot));
}

export const StandardTaskReadService = Object.freeze({
  async list() {
    return readAllReferences();
  },

  subscribe(onData, onError) {
    if (typeof onData !== "function") throw new Error("Thiếu hàm nhận dữ liệu danh mục công việc.");
    const references = sourceReferences();
    const stores = references.map(() => []);
    const initialized = references.map(() => false);
    const emit = () => {
      if (initialized.some(value => value !== true)) return;
      onData(normalize(stores.flat()));
    };
    const unsubscribers = references.map((reference, index) => FirebaseService.onSnapshot(
      reference,
      snapshot => {
        stores[index] = mapSnapshot(snapshot);
        initialized[index] = true;
        emit();
      },
      error => {
        console.error("Không thể theo dõi danh mục công việc theo thời gian thực:", error);
        onError?.(error);
      }
    ));
    return () => unsubscribers.forEach(unsubscribe => unsubscribe?.());
  },

  canRegisterItem,

  summarize(items = []) {
    const regular = items.filter(item => String(item.workType || "").toUpperCase() === "THUONG_XUYEN").length;
    const unexpected = items.filter(item => String(item.workType || "").toUpperCase() === "DOT_XUAT").length;
    const average = items.length
      ? items.reduce((sum, item) => sum + Number(item.maximumConvertedScore || 0), 0) / items.length
      : 0;
    return { total: items.length, regular, unexpected, averageMaximumScore: average };
  }
});
