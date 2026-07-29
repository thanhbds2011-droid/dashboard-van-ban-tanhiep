/** Dịch vụ đọc danh mục đầu việc chuẩn. */
import { FirebaseService } from "../core/firebase-service.js";
import { UserContext } from "../core/user-context.js";
import { Permissions } from "../core/permissions.js";

function mapSnapshot(snapshot) {
  return snapshot.docs.map(documentSnapshot => ({ id: documentSnapshot.id, ...documentSnapshot.data() }));
}

function normalize(items = []) {
  return items
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
