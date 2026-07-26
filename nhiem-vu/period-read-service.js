/** Production 3C - Evaluation Period Read Service (read only). */
import { FirebaseService } from "../core/firebase-service.js";

function mapSnapshot(snapshot) {
  return snapshot.docs.map(documentSnapshot => ({ id: documentSnapshot.id, ...documentSnapshot.data() }));
}

function normalizeStatus(period) {
  return String(period.status || (period.active ? "OPEN" : "DRAFT")).trim().toUpperCase();
}

export const PeriodReadService = Object.freeze({
  async list() {
    const reference = FirebaseService.collection(FirebaseService.db, "evaluationPeriods");
    const snapshot = await FirebaseService.getDocs(reference);
    return mapSnapshot(snapshot)
      .map(item => ({ ...item, _status: normalizeStatus(item) }))
      .sort((a, b) => String(b.startDateKey || b.id).localeCompare(String(a.startDateKey || a.id)));
  },

  active(periods = []) {
    return periods.find(item => item.active === true || ["OPEN", "IN_PROGRESS", "ASSESSMENT", "REPORTING"].includes(item._status)) || null;
  }
});
