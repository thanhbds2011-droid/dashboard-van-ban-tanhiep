/** Production 3C - Standard Task Read Service (read only). */
import { FirebaseService } from "../core/firebase-service.js";
import { UserContext } from "../core/user-context.js";
import { Permissions } from "../core/permissions.js";

function mapSnapshot(snapshot) {
  return snapshot.docs.map(documentSnapshot => ({ id: documentSnapshot.id, ...documentSnapshot.data() }));
}

export const StandardTaskReadService = Object.freeze({
  async list() {
    const user = UserContext.requireUser();
    const reference = FirebaseService.collection(FirebaseService.db, "standardTasks");
    const source = Permissions.canViewAllDepartments()
      ? reference
      : FirebaseService.query(reference, FirebaseService.where("departmentId", "==", user.departmentId));
    const snapshot = await FirebaseService.getDocs(source);
    return mapSnapshot(snapshot)
      .filter(item => item.active !== false)
      .sort((a, b) => Number(a.order || 9999) - Number(b.order || 9999) || String(a.code || a.id).localeCompare(String(b.code || b.id), "vi"));
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
