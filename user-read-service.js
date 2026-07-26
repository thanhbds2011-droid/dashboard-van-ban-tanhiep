/** Production 3D - đọc danh sách người dùng hoạt động. */
import { FirebaseService } from "../core/firebase-service.js";

function mapSnapshot(snapshot) {
  return snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
}

export const UserReadService = Object.freeze({
  async listActive() {
    const reference = FirebaseService.collection(FirebaseService.db, "users");
    const snapshot = await FirebaseService.getDocs(reference);
    return mapSnapshot(snapshot)
      .filter(user => user.active === true)
      .sort((a, b) => String(a.fullName || "").localeCompare(String(b.fullName || ""), "vi"));
  },

  byDepartment(users, departmentId) {
    return (users || []).filter(user => user.departmentId === departmentId);
  }
});
