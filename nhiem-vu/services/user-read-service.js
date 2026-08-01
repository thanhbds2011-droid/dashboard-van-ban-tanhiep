/** Production 3D - đọc danh sách người dùng hoạt động. */
import { FirebaseService } from "../core/firebase-service.js";

const CACHE_MS = 5 * 60 * 1000;
let cache = { items: [], loadedAt: 0 };
let pending = null;

function mapSnapshot(snapshot) {
  return snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
}

export const UserReadService = Object.freeze({
  async listActive(options = {}) {
    const force = options.force === true;
    if (!force && cache.loadedAt && Date.now() - cache.loadedAt < CACHE_MS) return cache.items;
    if (!force && pending) return pending;
    pending = (async () => {
    const reference = FirebaseService.collection(FirebaseService.db, "users");
    const snapshot = await FirebaseService.getDocs(reference);
    const items = mapSnapshot(snapshot)
      .filter(user => user.active === true)
      .sort((a, b) => String(a.fullName || "").localeCompare(String(b.fullName || ""), "vi"));
    cache = { items, loadedAt: Date.now() };
    return items;
    })();
    try { return await pending; }
    finally { pending = null; }
  },

  invalidate() {
    cache = { items: [], loadedAt: 0 };
    pending = null;
  },

  byDepartment(users, departmentId) {
    return (users || []).filter(user => user.departmentId === departmentId);
  }
});
