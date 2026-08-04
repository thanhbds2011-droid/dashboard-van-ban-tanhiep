/** Các thao tác bảo trì có chủ đích, chỉ ADMIN mới gọi được. */
import { FirebaseService } from "../core/firebase-service.js";
import { UserContext } from "../core/user-context.js";
import { Permissions } from "../core/permissions.js?v=20260804.V1_8_1";
import { TaskLogService } from "./task-log-service.js?v=20260804.V1_8_1";

const unique = values => [...new Set((values || []).map(value => String(value || "").trim()).filter(Boolean))];

export const AdminMaintenanceService = Object.freeze({
  async repairTaskVisibility(taskIds = []) {
    if (!Permissions.isAdmin()) throw new Error("Chỉ ADMIN được sửa dữ liệu chẩn đoán.");
    const user = UserContext.requireUser();
    const ids = unique(taskIds);
    if (!ids.length) return { repaired: 0, skipped: 0 };

    let repaired = 0;
    let skipped = 0;
    for (let offset = 0; offset < ids.length; offset += 180) {
      const batchIds = ids.slice(offset, offset + 180);
      const snapshots = await Promise.all(batchIds.map(id => FirebaseService.getDoc(FirebaseService.doc(FirebaseService.db, "tasks", id))));
      const batch = FirebaseService.writeBatch(FirebaseService.db);
      for (const snapshot of snapshots) {
        if (!snapshot.exists()) { skipped += 1; continue; }
        const task = { id: snapshot.id, ...snapshot.data() };
        const primary = String(task.primaryDepartmentId || "").trim().toUpperCase();
        if (!primary) { skipped += 1; continue; }
        const visibleDepartmentIds = unique([primary, ...(task.supportDepartmentIds || []), ...(task.relatedDepartmentIds || [])]);
        const visibleUserIds = unique([task.ownerUserId, ...(task.visibleUserIds || [])]);
        const changed = JSON.stringify(visibleDepartmentIds) !== JSON.stringify(task.visibleDepartmentIds || [])
          || JSON.stringify(visibleUserIds) !== JSON.stringify(task.visibleUserIds || []);
        if (!changed) { skipped += 1; continue; }

        const update = {
          supportDepartmentIds: unique(task.supportDepartmentIds || []),
          relatedDepartmentIds: unique(task.relatedDepartmentIds || task.supportDepartmentIds || []),
          visibleDepartmentIds,
          visibleUserIds,
          schemaVersion: 2,
          appVersion: "1.8.1",
          updatedAt: FirebaseService.serverTimestamp(),
          updatedByUserId: user.uid,
          updatedByName: user.fullName || user.email || "ADMIN"
        };
        batch.update(snapshot.ref, update);
        batch.set(
          FirebaseService.doc(FirebaseService.collection(FirebaseService.db, "taskLogs")),
          TaskLogService.buildTaskLog({
            taskId: task.id,
            taskCode: task.taskCode || "",
            periodId: task.periodId || "",
            action: "ADMIN_REPAIR_TASK_VISIBILITY",
            before: { visibleDepartmentIds: task.visibleDepartmentIds || [], visibleUserIds: task.visibleUserIds || [] },
            after: { visibleDepartmentIds, visibleUserIds },
            note: "Chuẩn hóa phạm vi hiển thị theo dữ liệu nhiệm vụ hiện có."
          })
        );
        repaired += 1;
      }
      await batch.commit();
    }
    return { repaired, skipped };
  }
});
