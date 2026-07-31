/** Dịch vụ đọc danh mục đầu việc chuẩn. */
import { FirebaseService } from "../core/firebase-service.js";
import { UserContext } from "../core/user-context.js";
import { Permissions } from "../core/permissions.js";

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

function sourceReference() {
  const user = UserContext.requireUser();
  const reference = FirebaseService.collection(FirebaseService.db, "standardTasks");
  return Permissions.canViewAllDepartments()
    ? reference
    : FirebaseService.query(reference, FirebaseService.where("departmentId", "==", user.departmentId));
}

export const StandardTaskReadService = Object.freeze({
  async list() {
    const snapshot = await FirebaseService.getDocs(sourceReference());
    return normalize(mapSnapshot(snapshot));
  },

  subscribe(onData, onError) {
    if (typeof onData !== "function") throw new Error("Thiếu hàm nhận dữ liệu danh mục công việc.");
    return FirebaseService.onSnapshot(
      sourceReference(),
      snapshot => onData(normalize(mapSnapshot(snapshot))),
      error => {
        console.error("Không thể theo dõi danh mục công việc theo thời gian thực:", error);
        onError?.(error);
      }
    );
  },

  summarize(items = []) {
    const regular = items.filter(item => String(item.workType || "").toUpperCase() === "THUONG_XUYEN").length;
    const unexpected = items.filter(item => String(item.workType || "").toUpperCase() === "DOT_XUAT").length;
    const average = items.length
      ? items.reduce((sum, item) => sum + Number(item.maximumConvertedScore || 0), 0) / items.length
      : 0;
    return { total: items.length, regular, unexpected, averageMaximumScore: average };
  }
});
