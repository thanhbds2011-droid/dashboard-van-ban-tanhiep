/** Đọc kỳ đánh giá với bộ nhớ đệm ngắn để không lặp truy vấn ở mỗi màn hình. */
import { FirebaseService } from "../core/firebase-service.js?v=20260810.V1_10_6";

const ACTIVE_CACHE_MS = 5 * 60 * 1000;
let activeCache = { value: null, loadedAt: 0 };
let activeRequest = null;

function mapSnapshot(snapshot) {
  return snapshot.docs.map(documentSnapshot => ({ id: documentSnapshot.id, ...documentSnapshot.data() }));
}

function normalizeStatus(period) {
  return String(period.status || (period.active ? "ACTIVE" : "DRAFT")).trim().toUpperCase();
}

function normalize(items = []) {
  return items
    .map(item => ({ ...item, _status: normalizeStatus(item) }))
    .filter(item => item._status !== "DELETED")
    .sort((a, b) => String(b.startDateKey || b.startDate || b.id).localeCompare(String(a.startDateKey || a.startDate || a.id)));
}

function selectActive(periods = []) {
  return periods.find(item => item.active === true && item._status !== "DELETED") || null;
}

async function readActivePeriod(force = false) {
  const now = Date.now();
  if (!force && activeCache.loadedAt && now - activeCache.loadedAt < ACTIVE_CACHE_MS) {
    return activeCache.value;
  }
  if (activeRequest) return activeRequest;

  activeRequest = (async () => {
    const reference = FirebaseService.query(
      FirebaseService.collection(FirebaseService.db, "evaluationPeriods"),
      FirebaseService.where("active", "==", true),
      FirebaseService.limit(1)
    );
    const snapshot = await FirebaseService.getDocs(reference);
    const value = selectActive(normalize(mapSnapshot(snapshot)));
    activeCache = { value, loadedAt: Date.now() };
    return value;
  })();

  try {
    return await activeRequest;
  } finally {
    activeRequest = null;
  }
}

export const PeriodReadService = Object.freeze({
  async list() {
    const reference = FirebaseService.collection(FirebaseService.db, "evaluationPeriods");
    const snapshot = await FirebaseService.getDocs(reference);
    return normalize(mapSnapshot(snapshot));
  },

  async getActive(options = {}) {
    return readActivePeriod(options.force === true);
  },

  invalidate() {
    activeCache = { value: null, loadedAt: 0 };
    activeRequest = null;
  },

  subscribe(onData, onError) {
    const reference = FirebaseService.query(
      FirebaseService.collection(FirebaseService.db, "evaluationPeriods"),
      FirebaseService.where("active", "==", true),
      FirebaseService.limit(1)
    );
    return FirebaseService.onSnapshot(
      reference,
      snapshot => {
        const periods = normalize(mapSnapshot(snapshot));
        const value = selectActive(periods);
        activeCache = { value, loadedAt: Date.now() };
        onData?.(periods);
      },
      error => {
        console.error("Không thể theo dõi kỳ đánh giá:", error);
        onError?.(error);
      }
    );
  },

  active(periods = []) {
    return selectActive(periods.map(item => item._status ? item : { ...item, _status: normalizeStatus(item) }));
  }
});
