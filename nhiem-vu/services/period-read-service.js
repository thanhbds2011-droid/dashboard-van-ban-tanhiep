/** Dịch vụ đọc kỳ đánh giá. */
import { FirebaseService } from "../core/firebase-service.js";

function mapSnapshot(snapshot) {
  return snapshot.docs.map(documentSnapshot => ({ id: documentSnapshot.id, ...documentSnapshot.data() }));
}

function normalizeStatus(period) {
  return String(period.status || (period.active ? "OPEN" : "DRAFT")).trim().toUpperCase();
}

function normalize(items = []) {
  return items
    .map(item => ({ ...item, _status: normalizeStatus(item) }))
    .sort((a, b) => String(b.startDateKey || b.id).localeCompare(String(a.startDateKey || a.id)));
}

export const PeriodReadService = Object.freeze({
  async list() {
    const reference = FirebaseService.collection(FirebaseService.db, "evaluationPeriods");
    const snapshot = await FirebaseService.getDocs(reference);
    return normalize(mapSnapshot(snapshot));
  },

  subscribe(onData, onError) {
    const reference = FirebaseService.collection(FirebaseService.db, "evaluationPeriods");
    return FirebaseService.onSnapshot(
      reference,
      snapshot => onData?.(normalize(mapSnapshot(snapshot))),
      error => {
        console.error("Không thể theo dõi kỳ đánh giá theo thời gian thực:", error);
        onError?.(error);
      }
    );
  },

  active(periods = []) {
    return periods.find(item => item.active === true || ["OPEN", "IN_PROGRESS", "ASSESSMENT", "REPORTING"].includes(item._status)) || null;
  }
});
