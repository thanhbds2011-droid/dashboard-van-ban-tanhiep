/** Production 3D - đọc danh mục phòng/khu. */
import { FirebaseService } from "../core/firebase-service.js";

const FALLBACK = [
  ["BGD", "Ban Giám đốc"], ["TCHC", "Phòng Tổ chức - Hành chính"],
  ["CTXH", "Phòng Công tác xã hội"], ["KHTC", "Phòng Kế hoạch - Tài chính"],
  ["YT", "Phòng Y tế"], ["KI", "Khu I"], ["KII", "Khu II"],
  ["KIII", "Khu III"], ["CDTN", "Chi đoàn"]
].map(([id, name], index) => ({ id, code: id, name, active: true, order: index + 1 }));

const CACHE_MS = 10 * 60 * 1000;
let cache = { items: [], loadedAt: 0 };

export const DepartmentReadService = Object.freeze({
  async listActive(options = {}) {
    if (options.force !== true && cache.loadedAt && Date.now() - cache.loadedAt < CACHE_MS) {
      return cache.items;
    }
    try {
      const reference = FirebaseService.collection(FirebaseService.db, "departments");
      const snapshot = await FirebaseService.getDocs(reference);
      const items = snapshot.docs.map(item => ({ id: item.id, ...item.data() }))
        .filter(item => item.active !== false)
        .sort((a, b) => Number(a.order || 999) - Number(b.order || 999));
      const result = items.length ? items : FALLBACK;
      cache = { items: result, loadedAt: Date.now() };
      return result;
    } catch (error) {
      console.warn("Không đọc được departments, dùng danh mục dự phòng.", error);
      return FALLBACK;
    }
  },

  invalidate() {
    cache = { items: [], loadedAt: 0 };
  }
});
