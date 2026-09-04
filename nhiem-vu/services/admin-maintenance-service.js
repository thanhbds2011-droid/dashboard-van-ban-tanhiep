/** Các thao tác bảo trì có chủ đích, chỉ ADMIN mới gọi được. */
import { FirebaseService } from "../core/firebase-service.js?v=20260904.V1_22_7";
import { UserContext } from "../core/user-context.js?v=20260904.V1_22_7";
import { Permissions } from "../core/permissions.js?v=20260904.V1_22_7";
import { TaskLogService } from "./task-log-service.js?v=20260904.V1_22_7";

const unique = values => [...new Set((values || []).map(value => String(value || "").trim()).filter(Boolean))];


const clean = value => String(value ?? "").trim();
const upper = value => clean(value).toUpperCase();


const EVENT_DRIVEN_RESET_ACTION = "REOPEN_REGISTRATION_AS_EVENT_DRIVEN";
const EVENT_DRIVEN_LABEL = "Khi phát sinh";
const RECURRING_FREQUENCIES = new Set(["THEO NGÀY", "THEO TUẦN", "THEO THÁNG", "THEO QUÝ", "THEO NĂM"]);
const MAX_EVENT_DRIVEN_RESET_BATCH = 50;

function emptyValue(value) {
  return value === null || value === undefined || clean(value) === "";
}
function isRecurringFrequency(value) {
  return RECURRING_FREQUENCIES.has(upper(value));
}
function isEventDrivenRegistration(registration) {
  return upper(registration?.frequency) === upper(EVENT_DRIVEN_LABEL)
    && upper(registration?.deadlineMode) === "EVENT_DRIVEN"
    && upper(registration?.trackingMode) === "ITEMIZED";
}
function hasConfirmedScore(task) {
  return !emptyValue(task?.confirmedActualScore) || !emptyValue(task?.preCouncilConfirmedActualScore);
}
function hasLegacyEvidence(task) {
  return [
    task?.evidenceUrl, task?.evidenceLink, task?.evidenceText,
    task?.evidenceFileName, task?.evidenceStoragePath
  ].some(value => !emptyValue(value));
}
function specialRegistrationBlocker(registration, task) {
  if (upper(registration?.sourceType) === "EXECUTIVE_DIRECTIVE"
      || upper(task?.sourceStandardTaskType) === "EXECUTIVE_DIRECTIVE"
      || clean(registration?.sourceDirectiveId)
      || clean(task?.sourceDirectiveId)) {
    return "Đầu việc liên quan Chỉ đạo Ban Giám đốc; không tự động chuyển tần suất.";
  }
  if (clean(registration?.fixedDeadlineDateKey) || clean(registration?.deadlineCeilingDateKey)
      || clean(task?.fixedDeadlineDateKey) || clean(task?.deadlineCeilingDateKey)) {
    return "Đầu việc có hạn cố định/hạn trần; cần kiểm tra thủ công để không làm sai thời hạn được giao.";
  }
  if (registration?.autoApproved === true) {
    return "Đăng ký tự duyệt của người có thẩm quyền; cần kiểm tra thủ công trước khi mở lại.";
  }
  return "";
}
async function docsByTaskId(collectionName, taskId, max = 100) {
  if (!clean(taskId)) return [];
  const snapshot = await FirebaseService.getDocs(FirebaseService.query(
    FirebaseService.collection(FirebaseService.db, collectionName),
    FirebaseService.where("taskId", "==", clean(taskId)),
    FirebaseService.limit(max)
  ));
  return snapshot.docs.map(docItem => ({ id: docItem.id, ...docItem.data() }));
}
async function evaluationPeriodState(periodId) {
  if (!clean(periodId)) return { exists:false, active:false, status:"" };
  const snapshot = await FirebaseService.getDoc(FirebaseService.doc(FirebaseService.db, "evaluationPeriods", clean(periodId)));
  if (!snapshot.exists()) return { exists:false, active:false, status:"" };
  const data = snapshot.data() || {};
  return { exists:true, active:data.active !== false, status:upper(data.status), data };
}
async function archiveState(periodId) {
  if (!clean(periodId)) return { exists:false, status:"" };
  const snapshot = await FirebaseService.getDoc(FirebaseService.doc(FirebaseService.db, "periodArchives", clean(periodId)));
  if (!snapshot.exists()) return { exists:false, status:"" };
  return { exists:true, status:upper(snapshot.data()?.status), data:snapshot.data() };
}
async function planState(periodId, departmentId) {
  if (!clean(periodId) || !clean(departmentId)) return { exists:false, locked:false };
  const snapshot = await FirebaseService.getDoc(
    FirebaseService.doc(FirebaseService.db, "kpiPlans", `${clean(periodId)}_${upper(departmentId)}`)
  );
  if (!snapshot.exists()) return { exists:false, locked:false };
  return { exists:true, locked:snapshot.data()?.locked === true, data:snapshot.data() };
}
function taskResetBlockers(task) {
  const blockers = [];
  if (!task) return ["Không tìm thấy nhiệm vụ đã hình thành từ đăng ký."];
  if (task.active === false || ["HUY", "CANCELLED"].includes(upper(task.status))) blockers.push("Nhiệm vụ hiện không còn hoạt động.");
  if (Number(task.progress || 0) !== 0) blockers.push("Nhiệm vụ đã có tiến độ.");
  if (!emptyValue(task.completedAt)) blockers.push("Nhiệm vụ đã có thời điểm hoàn thành.");
  if (!emptyValue(task.result) || !emptyValue(task.resultSummary)) blockers.push("Nhiệm vụ đã có kết quả thực hiện.");
  if (hasLegacyEvidence(task)) blockers.push("Nhiệm vụ đã có minh chứng legacy.");
  if (!emptyValue(task.pendingAdjustmentId)) blockers.push("Nhiệm vụ đang/có đề nghị điều chỉnh KPI.");
  if (task.scoreLocked === true) blockers.push("Điểm nhiệm vụ đã khóa.");
  if (hasConfirmedScore(task)) blockers.push("Nhiệm vụ đã có điểm xác nhận.");
  if (task.bonusAwarded === true || Number(task.bonusScore || 0) !== 0 || !emptyValue(task.bonusConfirmedAt)) blockers.push("Nhiệm vụ đã có xử lý điểm thưởng.");
  if (Number(task.milestoneCompletedCount || 0) > 0) blockers.push("Nhiệm vụ đã hoàn thành ít nhất một mốc định kỳ.");
  if (Number(task.eventWorkItemCount || 0) > 0) blockers.push("Nhiệm vụ đã có lượt công việc chi tiết.");
  if (["CONFIRMED", "REQUESTED"].includes(upper(task.noOccurrenceStatus))) blockers.push("Nhiệm vụ đã phát sinh xử lý 'không phát sinh'.");
  if (!["", "NOT_ASSESSED"].includes(upper(task.scoringStatus))) blockers.push(`Trạng thái chấm điểm hiện là ${clean(task.scoringStatus)}.`);
  return blockers;
}
function eventDrivenCorrectionMeta(user, reason, now) {
  return {
    adminCorrectionAction: EVENT_DRIVEN_RESET_ACTION,
    adminCorrectionReason: reason,
    adminCorrectedAt: now,
    adminCorrectedByUserId: user.uid,
    adminCorrectedByName: user.fullName || user.email || "ADMIN",
    updatedAt: now
  };
}

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


  async listEventDrivenResetCandidates() {
    requireAdmin();
    const snapshot = await FirebaseService.getDocs(FirebaseService.query(
      FirebaseService.collection(FirebaseService.db, "taskRegistrations"),
      FirebaseService.limit(5000)
    ));
    return snapshot.docs
      .map(docItem => ({ kind:"REGISTRATION", id:docItem.id, ...docItem.data() }))
      .filter(item => item.active !== false)
      .filter(item => upper(item.status) === "APPROVED")
      .filter(item => Boolean(clean(item.taskId)))
      .filter(item => isRecurringFrequency(item.frequency))
      .sort((a,b) => {
        const p = clean(a.periodId).localeCompare(clean(b.periodId));
        if (p) return p;
        const d = clean(a.departmentId).localeCompare(clean(b.departmentId), "vi");
        if (d) return d;
        return clean(a.userName).localeCompare(clean(b.userName), "vi");
      });
  },

  async eventDrivenResetPreview(record = {}) {
    requireAdmin();
    const registrationId = clean(record.id || record.registrationId);
    if (!registrationId) throw new Error("Không xác định được đăng ký cần kiểm tra.");

    const registrationSnapshot = await FirebaseService.getDoc(
      FirebaseService.doc(FirebaseService.db, "taskRegistrations", registrationId)
    );
    if (!registrationSnapshot.exists()) throw new Error("Đăng ký không còn tồn tại.");
    const registration = { id:registrationSnapshot.id, ...registrationSnapshot.data() };

    const alreadyApplied = upper(registration.status) === "PENDING"
      && !clean(registration.taskId)
      && isEventDrivenRegistration(registration)
      && upper(registration.adminCorrectionAction) === EVENT_DRIVEN_RESET_ACTION;
    if (alreadyApplied) {
      return {
        registration,
        task:null,
        canApply:true,
        alreadyApplied:true,
        blockers:[],
        warnings:["Đăng ký đã được ADMIN mở lại và chuyển sang Khi phát sinh trước đó."],
        counts:{ milestones:0, completedMilestones:0, evidenceFiles:0, workItems:0, evaluations:0, adjustments:0 }
      };
    }

    const blockers = [];
    const warnings = [];
    if (registration.active === false) blockers.push("Đăng ký không còn hoạt động.");
    if (upper(registration.status) !== "APPROVED") blockers.push("Chỉ xử lý đăng ký đang ở trạng thái APPROVED.");
    if (!isRecurringFrequency(registration.frequency)) {
      blockers.push(isEventDrivenRegistration(registration)
        ? "Đăng ký đã là Khi phát sinh."
        : "Tần suất hiện tại không thuộc nhóm recurring được phép chuyển.");
    }
    const taskId = clean(registration.taskId);
    if (!taskId) blockers.push("Đăng ký chưa liên kết taskId.");

    const taskSnapshot = taskId
      ? await FirebaseService.getDoc(FirebaseService.doc(FirebaseService.db, "tasks", taskId))
      : null;
    const task = taskSnapshot?.exists?.() ? { id:taskSnapshot.id, ...taskSnapshot.data() } : null;
    if (!task) blockers.push("Không tìm thấy nhiệm vụ liên kết.");
    if (task) {
      if (clean(task.registrationId) !== registration.id) blockers.push("task.registrationId không khớp đăng ký.");
      if (clean(task.ownerUserId) !== clean(registration.userId)) blockers.push("Người thực hiện của task không khớp đăng ký.");
      if (clean(task.periodId) !== clean(registration.periodId)) blockers.push("Kỳ KPI của task không khớp đăng ký.");
      if (clean(task.primaryDepartmentId) !== clean(registration.departmentId)) blockers.push("Phạm vi Phòng/Khu của task không khớp đăng ký.");
      if (upper(task.entryMode) !== "SELF_REGISTERED_APPROVED") blockers.push("Task không được tạo từ luồng đăng ký cá nhân đã duyệt.");
      blockers.push(...taskResetBlockers(task));
    }

    const special = specialRegistrationBlocker(registration, task);
    if (special) blockers.push(special);

    const periodId = clean(registration.periodId || task?.periodId);
    const departmentId = clean(registration.departmentId || task?.primaryDepartmentId);
    const [milestones, evidenceFiles, workItems, evaluations, adjustments, period, archive, plan] = taskId
      ? await Promise.all([
          docsByTaskId("taskMilestones", taskId, 500),
          docsByTaskId("taskEvidenceFiles", taskId, 200),
          docsByTaskId("taskWorkItems", taskId, 500),
          docsByTaskId("taskEvaluations", taskId, 50),
          docsByTaskId("kpiAdjustments", taskId, 50),
          evaluationPeriodState(periodId),
          archiveState(periodId),
          planState(periodId, departmentId)
        ])
      : [[], [], [], [], [], await evaluationPeriodState(periodId), await archiveState(periodId), await planState(periodId, departmentId)];

    const completedMilestones = milestones.filter(item => upper(item.status) === "COMPLETED" || !emptyValue(item.completedAt));
    const activeEvidenceFiles = evidenceFiles.filter(item => item.active !== false);
    if (completedMilestones.length) blockers.push(`Đã có ${completedMilestones.length} mốc định kỳ hoàn thành.`);
    if (activeEvidenceFiles.length) blockers.push(`Đã có ${activeEvidenceFiles.length} tệp minh chứng.`);
    if (workItems.length) blockers.push(`Đã có ${workItems.length} lượt công việc chi tiết.`);
    if (evaluations.length) blockers.push(`Đã có ${evaluations.length} bản ghi đánh giá KPI.`);
    if (adjustments.length) blockers.push(`Đã có ${adjustments.length} đề nghị/điều chỉnh KPI.`);
    if (!period.exists) blockers.push("Không tìm thấy kỳ KPI của đăng ký.");
    if (period.exists && (period.active === false || ["COMPLETED", "PURGED"].includes(period.status))) blockers.push("Kỳ KPI không còn ở trạng thái có thể sửa kỹ thuật an toàn.");
    if (archive.exists && ["ARCHIVED", "PURGING", "PURGED"].includes(archive.status)) blockers.push(`Kỳ đã có trạng thái lưu trữ ${archive.status}.`);
    if (plan.locked) blockers.push("Kế hoạch KPI của Phòng/Khu đã khóa; cần mở khóa theo authority hiện hành trước khi correction.");
    if (milestones.length && !completedMilestones.length) warnings.push(`${milestones.length} mốc định kỳ chưa hoàn thành sẽ được giữ nguyên làm lịch sử dưới task cũ đã hủy mềm.`);

    return {
      registration,
      task,
      canApply:blockers.length === 0,
      alreadyApplied:false,
      blockers:[...new Set(blockers)],
      warnings,
      period,
      archive,
      plan,
      counts:{
        milestones:milestones.length,
        completedMilestones:completedMilestones.length,
        evidenceFiles:activeEvidenceFiles.length,
        workItems:workItems.length,
        evaluations:evaluations.length,
        adjustments:adjustments.length
      }
    };
  },

  async applyEventDrivenResetBatch(input = {}) {
    const user = requireAdmin();
    const reason = clean(input.reason);
    if (!reason) throw new Error("Phải nhập lý do mở lại đăng ký.");
    const ids = unique((input.records || []).map(item => item?.id || item?.registrationId || item));
    if (!ids.length) throw new Error("Chưa chọn đăng ký cần xử lý.");
    if (ids.length > MAX_EVENT_DRIVEN_RESET_BATCH) {
      throw new Error(`Mỗi lần chỉ xử lý tối đa ${MAX_EVENT_DRIVEN_RESET_BATCH} đăng ký để bảo đảm an toàn.`);
    }

    const results = [];
    for (const registrationId of ids) {
      try {
        const preview = await this.eventDrivenResetPreview({ id:registrationId });
        if (preview.alreadyApplied) {
          results.push({ registrationId, ok:true, alreadyApplied:true, message:"Đã ở trạng thái PENDING / Khi phát sinh." });
          continue;
        }
        if (!preview.canApply) {
          results.push({ registrationId, ok:false, skipped:true, message:preview.blockers.join(" ") });
          continue;
        }

        const registration = preview.registration;
        const task = preview.task;
        const now = FirebaseService.serverTimestamp();
        const meta = eventDrivenCorrectionMeta(user, reason, now);
        const batch = FirebaseService.writeBatch(FirebaseService.db);
        const taskBefore = snapshotValue({
          active:task.active, status:task.status, planApprovalStatus:task.planApprovalStatus,
          includedInA:task.includedInA, scoringEnabled:task.scoringEnabled, scoringStatus:task.scoringStatus,
          scoreLocked:task.scoreLocked, progress:task.progress, frequency:task.frequency,
          deadlineMode:task.deadlineMode, milestoneMode:task.milestoneMode, milestoneCount:task.milestoneCount
        });
        const registrationBefore = snapshotValue({
          status:registration.status, taskId:registration.taskId, taskCode:registration.taskCode,
          frequency:registration.frequency, completionDeadline:registration.completionDeadline,
          deadlineMode:registration.deadlineMode, deadlineDateKey:registration.deadlineDateKey,
          milestoneDateKeys:registration.milestoneDateKeys, trackingMode:registration.trackingMode,
          approvedAt:registration.approvedAt, approvedByUserId:registration.approvedByUserId, approvedByName:registration.approvedByName
        });

        batch.update(FirebaseService.doc(FirebaseService.db, "tasks", task.id), {
          active:false,
          status:"HUY",
          planApprovalStatus:"CANCELLED",
          includedInA:false,
          scoringEnabled:false,
          scoringStatus:"CANCELLED",
          scoreLocked:false,
          deletedReason:reason,
          deletedAt:now,
          deletedByUserId:user.uid,
          deletedByName:user.fullName || user.email || "ADMIN",
          adminTransitionPreviousState:taskBefore,
          ...meta
        });

        batch.update(FirebaseService.doc(FirebaseService.db, "taskRegistrations", registration.id), {
          active:true,
          status:"PENDING",
          taskId:null,
          taskCode:"",
          frequency:EVENT_DRIVEN_LABEL,
          completionDeadline:"",
          deadlineMode:"EVENT_DRIVEN",
          deadlineDateKey:"",
          milestoneDateKeys:[],
          manualDeadlineDateKey:"",
          trackingMode:"ITEMIZED",
          approvedAt:null,
          approvedByUserId:"",
          approvedByName:"",
          rejectionReason:"",
          rejectedAt:null,
          rejectedByUserId:"",
          rejectedByName:"",
          ...meta
        });

        batch.set(
          FirebaseService.doc(FirebaseService.collection(FirebaseService.db, "taskLogs")),
          TaskLogService.buildTaskLog({
            taskId:task.id,
            taskCode:task.taskCode || registration.taskCode || registration.standardTaskCode || "",
            periodId:registration.periodId || task.periodId || "",
            action:"ADMIN_REOPEN_REGISTRATION_AS_EVENT_DRIVEN",
            before:taskBefore,
            after:{ active:false, status:"HUY", includedInA:false, scoringEnabled:false, scoringStatus:"CANCELLED" },
            note:`ADMIN mở lại đăng ký và chuyển personal frequency sang Khi phát sinh. Lý do: ${reason}`
          })
        );

        batch.set(correctionAuditRef(), {
          action:"ADMIN_REOPEN_REGISTRATION_AS_EVENT_DRIVEN",
          source:"ADMIN_CORRECTION",
          recordType:"REGISTRATION",
          recordId:registration.id,
          registrationId:registration.id,
          taskId:task.id,
          oldTaskId:task.id,
          periodId:clean(registration.periodId),
          departmentId:clean(registration.departmentId),
          userId:clean(registration.userId),
          oldFrequency:clean(registration.frequency),
          newFrequency:EVENT_DRIVEN_LABEL,
          oldStatus:upper(registration.status),
          newStatus:"PENDING",
          reason,
          before:{ registration:registrationBefore, task:taskBefore, counts:preview.counts },
          after:{
            registration:{ status:"PENDING", taskId:null, frequency:EVENT_DRIVEN_LABEL, deadlineMode:"EVENT_DRIVEN", trackingMode:"ITEMIZED" },
            task:{ active:false, status:"HUY", includedInA:false, scoringEnabled:false, scoringStatus:"CANCELLED" }
          },
          performedByUserId:user.uid,
          performedByName:user.fullName || user.email || "ADMIN",
          performedAt:now,
          createdAt:now
        });

        await batch.commit();
        results.push({ registrationId, ok:true, taskId:task.id, message:"Đã mở lại và chuyển sang Khi phát sinh." });
      } catch (error) {
        results.push({ registrationId, ok:false, message:error?.message || "Không thể xử lý đăng ký." });
      }
    }
    return {
      total:ids.length,
      succeeded:results.filter(item => item.ok === true).length,
      failed:results.filter(item => item.ok !== true).length,
      results
    };
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
