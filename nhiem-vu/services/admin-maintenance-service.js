/** Các thao tác bảo trì có chủ đích, chỉ ADMIN mới gọi được. */
import { FirebaseService } from "../core/firebase-service.js?v=20260903.V1_22_1";
import { UserContext } from "../core/user-context.js?v=20260903.V1_22_1";
import { Permissions } from "../core/permissions.js?v=20260903.V1_22_1";
import { TaskLogService } from "./task-log-service.js?v=20260903.V1_22_1";

const unique = values => [...new Set((values || []).map(value => String(value || "").trim()).filter(Boolean))];


const clean = value => String(value ?? "").trim();
const upper = value => clean(value).toUpperCase();

function requireAdmin() {
  if (!Permissions.isAdmin()) throw new Error("Chỉ ADMIN được sử dụng chức năng sửa sai.");
  return UserContext.requireUser();
}
function correctionAuditRef() {
  return FirebaseService.doc(FirebaseService.collection(FirebaseService.db, "kpiAuditLogs"));
}
function snapshotValue(value) {
  if (value === undefined) return null;
  try { return JSON.parse(JSON.stringify(value)); } catch (_) { return String(value); }
}
async function firstByField(collectionName, field, value) {
  if (!clean(value)) return null;
  const snapshot = await FirebaseService.getDocs(FirebaseService.query(
    FirebaseService.collection(FirebaseService.db, collectionName),
    FirebaseService.where(field, "==", value),
    FirebaseService.limit(1)
  ));
  return snapshot.empty ? null : { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
}
async function periodArchived(periodId) {
  if (!clean(periodId)) return false;
  const snap = await FirebaseService.getDoc(FirebaseService.doc(FirebaseService.db, "periodArchives", periodId));
  if (!snap.exists()) return false;
  return upper(snap.data()?.status) === "ARCHIVED";
}
function allowedCorrectionActions(record) {
  if (!record) return [];
  if (record.kind === "REGISTRATION") {
    const status = upper(record.status);
    if (["PENDING", "REJECTED"].includes(status)) return ["CANCEL_REGISTRATION"];
    if (status === "CANCELLED" && !clean(record.taskId)) return ["REOPEN_REGISTRATION"];
    return [];
  }
  const status = upper(record.status);
  if (record.active === false || status === "HUY") {
    return record.adminCorrectionPreviousState ? ["REOPEN_TASK"] : [];
  }
  if (record.evaluationStatus === "CONFIRMED" || record.scoreLocked === true) {
    return record.hasEvaluation ? ["REOPEN_CONFIRMATION"] : [];
  }
  const actions = ["CANCEL_TASK"];
  if (record.hasEvaluation) actions.unshift("REOPEN_SELF_ASSESSMENT");
  return actions;
}

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
          appVersion: "1.8.2",
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
  },

  async listCorrectionCandidates() {
    requireAdmin();
    const [taskSnap, regSnap] = await Promise.all([
      FirebaseService.getDocs(FirebaseService.query(FirebaseService.collection(FirebaseService.db, "tasks"), FirebaseService.limit(2500))),
      FirebaseService.getDocs(FirebaseService.query(FirebaseService.collection(FirebaseService.db, "taskRegistrations"), FirebaseService.limit(3000)))
    ]);
    const tasks = taskSnap.docs.map(docItem => ({ kind: "TASK", id: docItem.id, ...docItem.data() }));
    const registrations = regSnap.docs
      .map(docItem => ({ kind: "REGISTRATION", id: docItem.id, ...docItem.data() }))
      .filter(item => !clean(item.taskId) && ["PENDING","REJECTED","CANCELLED"].includes(upper(item.status)));
    return [...tasks, ...registrations].sort((a,b) =>
      clean(b.updatedAt?.toDate?.()?.toISOString?.() || b.createdAt?.toDate?.()?.toISOString?.() || "")
        .localeCompare(clean(a.updatedAt?.toDate?.()?.toISOString?.() || a.createdAt?.toDate?.()?.toISOString?.() || ""))
    );
  },

  async correctionPreview(record = {}) {
    requireAdmin();
    let source = record;
    let registration = null;
    let evaluation = null;
    if (record.kind === "TASK") {
      const taskSnap = await FirebaseService.getDoc(FirebaseService.doc(FirebaseService.db, "tasks", clean(record.id)));
      if (!taskSnap.exists()) throw new Error("Nhiệm vụ không còn tồn tại.");
      source = { kind: "TASK", id: taskSnap.id, ...taskSnap.data() };
      registration = clean(source.registrationId)
        ? await (async () => {
            const r = await FirebaseService.getDoc(FirebaseService.doc(FirebaseService.db, "taskRegistrations", source.registrationId));
            return r.exists() ? { id:r.id, ...r.data() } : null;
          })()
        : await firstByField("taskRegistrations", "taskId", source.id);
      evaluation = await firstByField("taskEvaluations", "taskId", source.id);
    }
    const archived = await periodArchived(source.periodId);
    const decorated = {
      ...source,
      hasEvaluation: Boolean(evaluation),
      evaluationStatus: upper(evaluation?.status),
      registrationStatus: upper(registration?.status)
    };
    return {
      record: decorated,
      registration,
      evaluation,
      archived,
      actions: archived ? [] : allowedCorrectionActions(decorated)
    };
  },

  async applyCorrection(input = {}) {
    const user = requireAdmin();
    const reason = clean(input.reason);
    const action = upper(input.action);
    if (!reason) throw new Error("Phải nhập lý do sửa sai.");
    const preview = await this.correctionPreview(input.record || {});
    if (preview.archived) throw new Error("Kỳ đã lưu trữ chính thức. Không sửa hoặc xóa archive cũ trực tiếp.");
    if (!preview.actions.includes(action)) throw new Error("Thao tác này không phù hợp với trạng thái dữ liệu hiện tại.");

    const now = FirebaseService.serverTimestamp();
    const batch = FirebaseService.writeBatch(FirebaseService.db);
    const before = {
      record: snapshotValue(preview.record),
      registration: snapshotValue(preview.registration),
      evaluation: snapshotValue(preview.evaluation)
    };
    let after = null;
    const correctionMeta = {
      adminCorrectionAction: action,
      adminCorrectionReason: reason,
      adminCorrectedAt: now,
      adminCorrectedByUserId: user.uid,
      adminCorrectedByName: user.fullName || user.email || "ADMIN",
      updatedAt: now
    };

    if (action === "CANCEL_REGISTRATION") {
      const registrationAfter = {
        active: false, status: "CANCELLED", cancelReason: reason,
        cancelledAt: now, cancelledByUserId: user.uid, cancelledByName: user.fullName || user.email || "ADMIN",
        adminCorrectionPreviousState: { active: preview.record.active !== false, status: upper(preview.record.status) },
        ...correctionMeta
      };
      batch.update(FirebaseService.doc(FirebaseService.db, "taskRegistrations", preview.record.id), registrationAfter);
      after = { record: { active:false, status:"CANCELLED" } };
    } else if (action === "REOPEN_REGISTRATION") {
      batch.update(FirebaseService.doc(FirebaseService.db, "taskRegistrations", preview.record.id), {
        active: true, status: "PENDING", taskId: null,
        cancelReason: "", cancelledAt: null, cancelledByUserId: "", cancelledByName: "",
        rejectionReason: "", rejectedAt: null, rejectedByUserId: "", rejectedByName: "",
        adminCorrectionPreviousState: null,
        ...correctionMeta
      });
      after = { record: { active:true, status:"PENDING", taskId:null } };
    } else if (action === "CANCEL_TASK") {
      if (preview.evaluationStatus === "CONFIRMED" || preview.record.scoreLocked === true) {
        throw new Error("Điểm nhiệm vụ đã được xác nhận/khóa. Hãy Mở lại xác nhận KPI trước khi hủy nhiệm vụ.");
      }
      const taskPreviousState = {
        active: preview.record.active !== false,
        status: clean(preview.record.status),
        planApprovalStatus: clean(preview.record.planApprovalStatus),
        includedInA: preview.record.includedInA !== false,
        scoringEnabled: preview.record.scoringEnabled !== false,
        scoringStatus: clean(preview.record.scoringStatus),
        scoreLocked: preview.record.scoreLocked === true
      };
      batch.update(FirebaseService.doc(FirebaseService.db, "tasks", preview.record.id), {
        active: false, status: "HUY", planApprovalStatus: "CANCELLED",
        includedInA: false, scoringEnabled: false, scoringStatus: "CANCELLED", scoreLocked:false,
        deletedReason: reason, deletedAt: now, deletedByUserId: user.uid, deletedByName: user.fullName || user.email || "ADMIN",
        adminCorrectionPreviousState: taskPreviousState,
        ...correctionMeta
      });
      if (preview.registration?.id) batch.update(FirebaseService.doc(FirebaseService.db, "taskRegistrations", preview.registration.id), {
        active:false, status:"CANCELLED", cancelReason:reason, cancelledAt:now,
        cancelledByUserId:user.uid, cancelledByName:user.fullName || user.email || "ADMIN",
        adminCorrectionPreviousState: { active: preview.registration.active !== false, status: clean(preview.registration.status), taskId: clean(preview.registration.taskId) || null },
        ...correctionMeta
      });
      if (preview.evaluation?.id) batch.update(FirebaseService.doc(FirebaseService.db, "taskEvaluations", preview.evaluation.id), {
        status:"CANCELLED", scoreLocked:false,
        adminCorrectionPreviousState: { status: clean(preview.evaluation.status), scoreLocked: preview.evaluation.scoreLocked === true },
        ...correctionMeta
      });
      after = { record: { active:false, status:"HUY", includedInA:false, scoringEnabled:false, scoringStatus:"CANCELLED" } };
    } else if (action === "REOPEN_TASK") {
      const previous = preview.record.adminCorrectionPreviousState || {};
      if (!previous.status) throw new Error("Không có trạng thái trước khi hủy để khôi phục an toàn.");
      batch.update(FirebaseService.doc(FirebaseService.db, "tasks", preview.record.id), {
        active: previous.active !== false,
        status: previous.status,
        planApprovalStatus: previous.planApprovalStatus || "APPROVED",
        includedInA: previous.includedInA !== false,
        scoringEnabled: previous.scoringEnabled !== false,
        scoringStatus: previous.scoringStatus || "NOT_ASSESSED",
        scoreLocked: previous.scoreLocked === true,
        deletedReason:"", deletedAt:null, deletedByUserId:"", deletedByName:"",
        adminCorrectionPreviousState:null,
        ...correctionMeta
      });
      if (preview.registration?.id && preview.registration.adminCorrectionPreviousState) {
        const rPrev = preview.registration.adminCorrectionPreviousState || {};
        batch.update(FirebaseService.doc(FirebaseService.db, "taskRegistrations", preview.registration.id), {
          active: rPrev.active !== false, status:rPrev.status || "APPROVED", taskId:rPrev.taskId || preview.record.id,
          cancelReason:"", cancelledAt:null, cancelledByUserId:"", cancelledByName:"",
          adminCorrectionPreviousState:null, ...correctionMeta
        });
      }
      if (preview.evaluation?.id && preview.evaluation.adminCorrectionPreviousState) {
        const ePrev = preview.evaluation.adminCorrectionPreviousState || {};
        batch.update(FirebaseService.doc(FirebaseService.db, "taskEvaluations", preview.evaluation.id), {
          status:ePrev.status || "SELF_COMPLETED", scoreLocked:ePrev.scoreLocked === true,
          adminCorrectionPreviousState:null, ...correctionMeta
        });
      }
      after = { record: { active:previous.active !== false, status:previous.status, includedInA:previous.includedInA !== false } };
    } else if (action === "REOPEN_SELF_ASSESSMENT") {
      if (!preview.evaluation?.id) throw new Error("Nhiệm vụ chưa có bản tự đánh giá để mở lại.");
      batch.update(FirebaseService.doc(FirebaseService.db, "taskEvaluations", preview.evaluation.id), {
        status:"NEEDS_REVISION", scoreLocked:false,
        confirmedProgressRate:null, confirmedResultRate:null, confirmedExecutionScore:null, confirmedActualScore:null,
        reviewedByUserId:"", reviewedByName:"", confirmedAt:null,
        ...correctionMeta
      });
      batch.update(FirebaseService.doc(FirebaseService.db, "tasks", preview.record.id), {
        scoringStatus:"NOT_ASSESSED", scoreLocked:false, confirmedActualScore:null, ...correctionMeta
      });
      after = { evaluation:{ status:"NEEDS_REVISION", scoreLocked:false }, record:{ scoringStatus:"NOT_ASSESSED", scoreLocked:false } };
    } else if (action === "REOPEN_CONFIRMATION") {
      if (!preview.evaluation?.id) throw new Error("Nhiệm vụ chưa có kết quả xác nhận để mở lại.");
      batch.update(FirebaseService.doc(FirebaseService.db, "taskEvaluations", preview.evaluation.id), {
        status:"PENDING_REVIEW", scoreLocked:false,
        confirmedProgressRate:null, confirmedResultRate:null, confirmedExecutionScore:null, confirmedActualScore:null,
        confirmedExceededRequirement:null, exceededDecision:"PENDING", exceededDecisionReason:"",
        bonusDecision:"PENDING", bonusDecisionReason:"", bonusAwarded:false, bonusScore:0,
        reviewedByUserId:"", reviewedByName:"", confirmedAt:null,
        ...correctionMeta
      });
      batch.update(FirebaseService.doc(FirebaseService.db, "tasks", preview.record.id), {
        scoringStatus:"PENDING_REVIEW", scoreLocked:false, confirmedActualScore:null,
        confirmedExceededRequirement:null, bonusAwarded:false, bonusScore:0, ...correctionMeta
      });
      after = { evaluation:{ status:"PENDING_REVIEW", scoreLocked:false }, record:{ scoringStatus:"PENDING_REVIEW", scoreLocked:false } };
    }

    batch.set(correctionAuditRef(), {
      action: `ADMIN_CORRECTION_${action}`,
      source: "ADMIN_CORRECTION",
      recordType: preview.record.kind,
      recordId: preview.record.id,
      taskId: preview.record.kind === "TASK" ? preview.record.id : clean(preview.record.taskId),
      registrationId: preview.record.kind === "REGISTRATION" ? preview.record.id : clean(preview.registration?.id),
      periodId: clean(preview.record.periodId),
      departmentId: clean(preview.record.departmentId || preview.record.primaryDepartmentId),
      reason,
      before,
      after: after || { action },
      performedByUserId: user.uid,
      performedByName: user.fullName || user.email || "ADMIN",
      performedAt: now,
      createdAt: now
    });
    await batch.commit();
    return { ok:true, action };

}
});
