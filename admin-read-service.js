/** Production 3C - Admin Read Service (read only). */
import { FirebaseService } from "../core/firebase-service.js";

async function safeCount(collectionName) {
  const reference = FirebaseService.collection(FirebaseService.db, collectionName);
  const snapshot = await FirebaseService.getDocs(reference);
  return snapshot.docs.filter(doc => doc.data()?.active !== false).length;
}

export const AdminReadService = Object.freeze({
  async summary() {
    const results = await Promise.allSettled([
      safeCount("users"),
      safeCount("standardTasks"),
      safeCount("evaluationPeriods")
    ]);
    return {
      activeUsers: results[0].status === "fulfilled" ? results[0].value : null,
      activeStandardTasks: results[1].status === "fulfilled" ? results[1].value : null,
      periods: results[2].status === "fulfilled" ? results[2].value : null,
      warnings: results.map((result, index) => result.status === "rejected" ? ["users", "standardTasks", "evaluationPeriods"][index] : "").filter(Boolean)
    };
  }
});
