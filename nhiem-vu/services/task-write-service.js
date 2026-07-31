/** Tạo, phân công, tiếp nhận, cập nhật tiến độ và hoàn thành nhiệm vụ. */
import { FirebaseService } from "../core/firebase-service.js";
import { UserContext } from "../core/user-context.js";
import { Permissions } from "../core/permissions.js?v=20260730.V1_1_10";
import { TaskLogService } from "./task-log-service.js";

const MAX_CODE_SCAN = 1000;

function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function normalizeDepartmentId(value) {
  return String(value || "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
}

function parseDepartmentSequence(code, departmentId) {
  const prefix = normalizeDepartmentId(departmentId);
  const text = String(code || "").trim().toUpperCase();
  if (!prefix || !text) return 0;
  const match = new RegExp(`^${prefix}(\\d+)$`).exec(text);
  return match ? Number(match[1]) || 0 : 0;
}

function formatDepartmentTaskCode(departmentId, sequence) {
  const prefix = normalizeDepartmentId(departmentId);
  if (!prefix) throw new Error("Không xác định được mã Phòng/Khu để cấp mã nhiệm vụ.");
  const value = Math.max(1, Number(sequence || 0));
  const width = Math.max(2, String(value).length);
  return `${prefix}${String(value).padStart(width, "0")}`;
}

async function getStartingSequence(departmentId) {
  const normalizedDepartmentId = normalizeDepartmentId(departmentId);
  const [standardSnapshot, taskSnapshot] = await Promise.all([
    FirebaseService.getDocsFromServer(
      FirebaseService.query(
        FirebaseService.collection(FirebaseService.db, "standardTasks"),
        FirebaseService.where("departmentId", "==", normalizedDepartmentId)
      )
    ),
    FirebaseService.getDocsFromServer(
      FirebaseService.query(
        FirebaseService.collection(FirebaseService.db, "tasks"),
        FirebaseService.where("primaryDepartmentId", "==", normalizedDepartmentId)
      )
    )
  ]);

  let maximum = 0;
  standardSnapshot.docs.forEach(snapshot => {
    const data = snapshot.data() || {};
    maximum = Math.max(
      maximum,
      parseDepartmentSequence(data.code || snapshot.id, normalizedDepartmentId)
    );
  });
  taskSnapshot.docs.forEach(snapshot => {
    const data = snapshot.data() || {};
    maximum = Math.max(
      maximum,
      parseDepartmentSequence(data.taskCode || snapshot.id, normalizedDepartmentId)
    );
  });

  return maximum + 1;
}

async function reserveTaskReference(transaction, departmentId, startingSequence) {
  for (let offset = 0; offset < MAX_CODE_SCAN; offset += 1) {
    const sequence = startingSequence + offset;
    const code = formatDepartmentTaskCode(departmentId, sequence);
    const reference = FirebaseService.doc(FirebaseService.db, "tasks", code);
    const standardReference = FirebaseService.doc(FirebaseService.db, "standardTasks", code);
    const [taskSnapshot, standardSnapshot] = await Promise.all([
      transaction.get(reference),
      transaction.get(standardReference)
    ]);
    if (!taskSnapshot.exists() && !standardSnapshot.exists()) return { code, reference };
  }
  throw new Error("Không thể cấp mã nhiệm vụ tiếp theo. Vui lòng thử lại.");
}

async function getActivePeriod() {
  const snap = await FirebaseService.getDocs(FirebaseService.query(
    FirebaseService.collection(FirebaseService.db, "evaluationPeriods"),
    FirebaseService.where("active", "==", true)
  ));
  const docs = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(p => String(p.status || "").toUpperCase() !== "DELETED");
  return docs[0] || null;
}

function taskRef(taskId) {
  return FirebaseService.doc(FirebaseService.db, "tasks", taskId);
}

function logRef() {
  return FirebaseService.doc(FirebaseService.collection(FirebaseService.db, "taskLogs"));
}

function snapshotTask(task) {
  const allowed = [
    "status", "assignmentStatus", "progress", "ownerUserId", "ownerName",
    "ownerPosition", "teamId", "resultSummary", "evidenceUrl",
    "evidenceFileName", "deadline", "priority", "difficultyCoefficient",
    "maximumConvertedScore"
  ];
  return Object.fromEntries(allowed.map(key => [key, task?.[key] ?? null]));
}

export const TaskWriteService = Object.freeze({
  async create(data) {
    const user = UserContext.requireUser();
    if (!Permissions.canCreateUnexpectedTask()) {
      throw new Error("Tài khoản không có quyền giao nhiệm vụ phát sinh.");
    }

    const departmentId = normalizeDepartmentId(data.primaryDepartmentId);
    const [activePeriod, startingSequence] = await Promise.all([
      getActivePeriod(),
      getStartingSequence(departmentId)
    ]);

    if (!activePeriod?.id) {
      throw new Error("Chưa có kỳ đánh giá đang hoạt động. Hãy mở kỳ trước khi giao nhiệm vụ đột xuất để nhiệm vụ được tính vào A.");
    }

    const ownerUserId = data.ownerUserId || "";
    const supportIds = [...new Set((data.supportDepartmentIds || [])
      .map(normalizeDepartmentId)
      .filter(Boolean)
      .filter(id => id !== departmentId))];
    const visibleDepartments = [...new Set([departmentId, ...supportIds])];
    const visibleUsers = [...new Set([ownerUserId].filter(Boolean))];
    const assignmentStatus = ownerUserId ? "DA_PHAN_CONG" : "CHO_PHAN_CONG";
    const status = ownerUserId ? "MOI_TIEP_NHAN" : "CHO_PHAN_CONG";
    const entryMode = Permissions.isDirector() || Permissions.isAdmin()
      ? "DIRECT_ASSIGNED"
      : "DEPARTMENT_ASSIGNED";

    const coefficient = Number(data.difficultyCoefficient || 1);
    const baseScore = Number(data.baseScore || 12);
    const maximumConvertedScore = Math.round(baseScore * coefficient * 100) / 100;

    const result = await FirebaseService.runTransaction(
      FirebaseService.db,
      async transaction => {
        const { code, reference } = await reserveTaskReference(
          transaction,
          departmentId,
          startingSequence
        );

        const payload = {
          active: true,
          taskCode: code,
          title: data.title,
          description: data.description || "",
          sourceType: data.sourceType || "GIAO_NHIEM_VU_DOT_XUAT",
          sourceReference: data.sourceReference || data.title,
          sourceDetail: data.sourceDetail || data.description || "",
          sourceDate: FirebaseService.Timestamp.fromDate(data.sourceDate || new Date()),
          sourceDateKey: dateKey(data.sourceDate || new Date()),
          entryMode,
          primaryDepartmentId: departmentId,
          supportDepartmentIds: supportIds,
          relatedDepartmentIds: supportIds,
          visibleDepartmentIds: visibleDepartments,
          ownerUserId,
          ownerName: data.ownerName || "",
          ownerPosition: data.ownerPosition || "",
          teamId: String(data.teamId || "").toUpperCase(),
          visibleUserIds: visibleUsers,
          assignedByUserId: ownerUserId ? user.uid : "",
          assignedByName: ownerUserId ? (user.fullName || "") : "",
          assignedByPosition: ownerUserId ? (user.position || "") : "",
          assignedAt: ownerUserId ? FirebaseService.serverTimestamp() : null,
          assignmentStatus,
          status,
          progress: 0,
          priority: "DOT_XUAT",
          deadline: FirebaseService.Timestamp.fromDate(data.deadline),
          deadlineDateKey: dateKey(data.deadline),
          standardTaskCode: "",
          standardTaskName: "",
          workType: "DOT_XUAT",
          baseScore,
          difficultyCoefficient: coefficient,
          maximumConvertedScore,
          mandatoryEvidence: data.mandatoryEvidence || "",
          trackingMode: String(data.trackingMode || "FINAL_OUTPUT").toUpperCase() === "ITEMIZED" ? "ITEMIZED" : "FINAL_OUTPUT",
          confirmer: data.confirmer || user.fullName || "",
          scoringVersion: "KPI_2026_V1",
          periodId: activePeriod?.id || "",
          periodName: activePeriod?.name || "",
          planType: "DOT_XUAT",
          planApprovalStatus: "APPROVED",
          includedInA: true,
          scoringEnabled: true,
          scoringStatus: "NOT_ASSESSED",
          result: "",
          resultSummary: "",
          difficulties: "",
          proposal: "",
          evidenceType: "",
          evidenceUrl: "",
          evidenceLink: "",
          evidenceText: "",
          evidenceFileName: "",
          evidenceStoragePath: "",
          completedAt: null,
          createdAt: FirebaseService.serverTimestamp(),
          createdByUserId: user.uid,
          createdByName: user.fullName || "",
          createdByRole: user.role || "",
          updatedAt: FirebaseService.serverTimestamp(),
          updatedByUserId: user.uid,
          updatedByName: user.fullName || ""
        };

        transaction.set(reference, payload);
        transaction.set(logRef(), TaskLogService.buildTaskLog({
          taskId: reference.id,
          taskCode: code,
          action: "TASK_CREATED",
          after: {
            ...payload,
            createdAt: null,
            updatedAt: null,
            assignedAt: null
          },
          note: "Giao nhiệm vụ đột xuất; nhiệm vụ được tính vào A của kỳ đánh giá đang hoạt động."
        }));

        return { id: reference.id, ...payload };
      }
    );

    return result;
  },

  async assign(task, assignment) {
    const user = UserContext.requireUser();
    const before = snapshotTask(task);
    const ownerUserId = assignment.ownerUserId || "";
    const payload = {
      ownerUserId,
      ownerName: assignment.ownerName || "",
      ownerPosition: assignment.ownerPosition || "",
      teamId: assignment.teamId || "",
      visibleUserIds: ownerUserId ? [ownerUserId] : [],
      assignedByUserId: user.uid,
      assignedByName: user.fullName || "",
      assignedByPosition: user.position || "",
      assignedAt: FirebaseService.serverTimestamp(),
      assignmentStatus: ownerUserId ? "DA_PHAN_CONG" : "CHO_PHAN_CONG",
      status: ownerUserId ? "MOI_TIEP_NHAN" : "CHO_PHAN_CONG",
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: user.uid,
      updatedByName: user.fullName || ""
    };
    const batch = FirebaseService.writeBatch(FirebaseService.db);
    batch.update(taskRef(task.id), payload);
    batch.set(logRef(), TaskLogService.buildTaskLog({
      taskId: task.id,
      taskCode: task.taskCode,
      action: "TASK_ASSIGNED",
      before,
      after: { ...before, ...payload, assignedAt: null, updatedAt: null }
    }));
    await batch.commit();
  },

  async accept(task) {
    const user = UserContext.requireUser();
    if (task.ownerUserId !== user.uid) throw new Error("Chỉ người được giao mới được xác nhận đã nhận nhiệm vụ.");
    if (task.active === false) throw new Error("Nhiệm vụ này không còn hiệu lực.");
    if (["HOAN_THANH", "COMPLETED", "DA_HOAN_THANH"].includes(String(task.status || "").toUpperCase()) || task.completedAt) {
      throw new Error("Nhiệm vụ đã hoàn thành nên không cần xác nhận tiếp nhận.");
    }
    if (task.assignmentStatus === "DA_TIEP_NHAN") throw new Error("Nhiệm vụ đã được tiếp nhận trước đó.");
    const payload = {
      assignmentStatus: "DA_TIEP_NHAN",
      status: "DANG_XU_LY",
      acceptedAt: FirebaseService.serverTimestamp(),
      acceptedByUserId: user.uid,
      acceptedByName: user.fullName || "",
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: user.uid,
      updatedByName: user.fullName || ""
    };
    const batch = FirebaseService.writeBatch(FirebaseService.db);
    batch.update(taskRef(task.id), payload);
    batch.set(logRef(), TaskLogService.buildTaskLog({
      taskId: task.id,
      taskCode: task.taskCode,
      action: "TASK_ACCEPTED",
      before: snapshotTask(task),
      after: { ...snapshotTask(task), ...payload, acceptedAt: null, updatedAt: null }
    }));
    await batch.commit();
  },

  async updateProgress(task, changes) {
    const user = UserContext.requireUser();
    if (task.ownerUserId !== user.uid) throw new Error("Chỉ người thực hiện mới được cập nhật tiến độ và hoàn thành nhiệm vụ.");
    if (task.assignmentStatus !== "DA_TIEP_NHAN") {
      throw new Error("Bạn cần xác nhận đã nhận nhiệm vụ trước khi cập nhật tiến độ, kết quả hoặc minh chứng.");
    }
    const payload = {
      status: changes.status,
      progress: Number(changes.progress),
      progressNote: changes.progressNote || "",
      result: changes.resultSummary || "",
      resultSummary: changes.resultSummary || "",
      difficulties: changes.difficulties || "",
      proposal: changes.proposal || "",
      evidenceType: changes.evidenceType || "",
      evidenceUrl: changes.evidenceUrl || "",
      evidenceLink: changes.evidenceUrl || "",
      evidenceText: changes.evidenceText || "",
      evidenceFileName: changes.evidenceFileName || "",
      evidenceStoragePath: changes.evidenceStoragePath || "",
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: user.uid,
      updatedByName: user.fullName || ""
    };
    if (changes.status === "HOAN_THANH") {
      payload.progress = 100;
      payload.completedAt = FirebaseService.serverTimestamp();
      payload.completedByUserId = user.uid;
      payload.completedByName = user.fullName || "";
    }
    const batch = FirebaseService.writeBatch(FirebaseService.db);
    batch.update(taskRef(task.id), payload);
    batch.set(logRef(), TaskLogService.buildTaskLog({
      taskId: task.id,
      taskCode: task.taskCode,
      action: changes.status === "HOAN_THANH" ? "TASK_COMPLETED" : "PROGRESS_UPDATED",
      before: snapshotTask(task),
      after: { ...snapshotTask(task), ...payload, updatedAt: null, completedAt: null },
      note: changes.progressNote || ""
    }));
    await batch.commit();
  }
});
