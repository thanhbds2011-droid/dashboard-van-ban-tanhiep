/**
 * Quy trình điều chỉnh sau Hội đồng - V1.10.0.
 *
 * Cấu trúc dữ liệu:
 * councilReviewRounds/{periodId}
 * councilReviewRounds/{periodId}/departments/{departmentId}
 * councilReviewRounds/{periodId}/departments/{departmentId}/requests/{userId}_{targetId}
 */
import { FirebaseService } from "../core/firebase-service.js?v=20260904.V1_23_0";
import { UserContext } from "../core/user-context.js?v=20260904.V1_23_0";
import { Permissions } from "../core/permissions.js?v=20260904.V1_23_0";

const REQUEST_TYPES = Object.freeze(["SCORE", "EVIDENCE", "SCORE_AND_EVIDENCE"]);
const OPEN_REQUEST_STATUSES = Object.freeze(["OPEN", "RETURNED"]);

function clean(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function upper(value) { return clean(value).toUpperCase(); }
function finite(value) { return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)); }
function round2(value) { return Math.round(Number(value || 0) * 100) / 100; }
function safeId(value) { return clean(value).replace(/[^A-Za-z0-9_-]+/g, "_"); }

function roundRef(periodId) {
  return FirebaseService.doc(FirebaseService.db, "councilReviewRounds", safeId(periodId));
}
function departmentRef(periodId, departmentId) {
  return FirebaseService.doc(roundRef(periodId), "departments", upper(departmentId));
}
function requestsCollection(periodId, departmentId) {
  return FirebaseService.collection(departmentRef(periodId, departmentId), "requests");
}
function requestRef(periodId, departmentId, requestId) {
  return FirebaseService.doc(requestsCollection(periodId, departmentId), safeId(requestId));
}

function isTchcHead(user = UserContext.getUser()) {
  return Permissions.isAdmin(user) || (
    Permissions.isDepartmentHead(user) && upper(user?.departmentId) === "TCHC"
  );
}

function isDepartmentManagerFor(departmentId, user = UserContext.getUser()) {
  return Permissions.isAdmin(user) || (
    Permissions.isDepartmentLeader(user) && upper(user?.departmentId) === upper(departmentId)
  );
}

async function ensureOpenRound(periodId, departmentId = "") {
  const snapshot = await FirebaseService.getDoc(roundRef(periodId));
  if (!snapshot.exists()) throw new Error("TCHC chưa mở đợt điều chỉnh sau Hội đồng.");
  const round = { id: snapshot.id, ...snapshot.data() };
  if (upper(round.status) !== "OPEN") throw new Error("Đợt điều chỉnh sau Hội đồng hiện đã khóa.");
  if (departmentId) {
    const departmentSnapshot = await FirebaseService.getDoc(departmentRef(periodId, departmentId));
    if (!departmentSnapshot.exists() || departmentSnapshot.data()?.enabled !== true) {
      throw new Error("Phòng/Khu này chưa được TCHC mở quyền điều chỉnh sau Hội đồng.");
    }
  }
  return round;
}

async function findEvaluation(periodId, taskId) {
  const directId = `${periodId}_${taskId}`;
  const direct = await FirebaseService.getDoc(FirebaseService.doc(FirebaseService.db, "taskEvaluations", directId));
  if (direct.exists()) return { id: direct.id, ...direct.data() };
  const snapshot = await FirebaseService.getDocs(
    FirebaseService.query(
      FirebaseService.collection(FirebaseService.db, "taskEvaluations"),
      FirebaseService.where("taskId", "==", taskId),
      FirebaseService.limit(1)
    )
  );
  return snapshot.empty ? null : { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
}

async function findCommonAssessment(periodId, userId) {
  const directId = `${periodId}_${userId}`;
  const direct = await FirebaseService.getDoc(FirebaseService.doc(FirebaseService.db, "commonCriteriaAssessments", directId));
  if (direct.exists()) return { id: direct.id, ...direct.data() };
  const snapshot = await FirebaseService.getDocs(
    FirebaseService.query(
      FirebaseService.collection(FirebaseService.db, "commonCriteriaAssessments"),
      FirebaseService.where("periodId", "==", periodId),
      FirebaseService.where("userId", "==", userId),
      FirebaseService.limit(1)
    )
  );
  return snapshot.empty ? null : { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
}

function criterionIdentity(item, index) {
  return clean(item?.id || item?.criterionId || item?.code || item?.key || `ITEM_${index + 1}`);
}
function criterionLabel(item, index) {
  return clean(item?.name || item?.label || item?.title || item?.criterionName || `Tiêu chí ${index + 1}`);
}
function criterionScore(item) {
  for (const key of ["confirmedScore", "actualScore", "score", "selfScore", "point", "value"]) {
    if (finite(item?.[key])) return Number(item[key]);
  }
  return 0;
}
function criterionMax(item) {
  for (const key of ["maximumScore", "maxScore", "maximum", "pointMax"]) {
    if (finite(item?.[key])) return Number(item[key]);
  }
  return null;
}

function applyCriterionScore(item, finalScore) {
  const next = { ...(item || {}) };
  if ("confirmedScore" in next) next.confirmedScore = finalScore;
  else if ("actualScore" in next) next.actualScore = finalScore;
  else if ("score" in next) next.score = finalScore;
  else next.confirmedScore = finalScore;
  next.councilAdjusted = true;
  return next;
}

function commonTotal(items) {
  return round2((items || []).reduce((sum, item) => sum + Number(criterionScore(item) || 0), 0));
}

function requestDocumentId(userId, targetType, targetId) {
  return safeId(`${userId}_${targetType}_${targetId}`);
}

export const CouncilAdjustmentService = Object.freeze({
  REQUEST_TYPES,

  async getRound(periodId) {
    if (!periodId) return null;
    const snapshot = await FirebaseService.getDoc(roundRef(periodId));
    return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
  },

  async getDepartmentState(periodId, departmentId) {
    if (!periodId || !departmentId) return null;
    const snapshot = await FirebaseService.getDoc(departmentRef(periodId, departmentId));
    return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
  },

  async openRound(period, departmentIds = []) {
    const actor = UserContext.requireUser();
    if (!isTchcHead(actor)) throw new Error("Chỉ Trưởng Phòng Tổ chức - Hành chính được mở đợt điều chỉnh sau Hội đồng.");
    if (!period?.id) throw new Error("Không xác định được kỳ đánh giá.");
    const ids = [...new Set((departmentIds || []).map(upper).filter(Boolean).filter(id => id !== "CDTN"))];
    if (!ids.length) throw new Error("Hãy chọn ít nhất một Phòng/Khu được mở điều chỉnh.");

    const batch = FirebaseService.writeBatch(FirebaseService.db);
    batch.set(roundRef(period.id), {
      periodId: period.id,
      periodName: period.name || period.id,
      status: "OPEN",
      departmentIds: ids,
      openedAt: FirebaseService.serverTimestamp(),
      openedByUserId: actor.uid,
      openedByName: actor.fullName || "",
      closedAt: null,
      closedByUserId: "",
      closedByName: "",
      updatedAt: FirebaseService.serverTimestamp()
    }, { merge: true });
    ids.forEach(departmentId => {
      batch.set(departmentRef(period.id, departmentId), {
        periodId: period.id,
        departmentId,
        enabled: true,
        status: "OPEN",
        openedAt: FirebaseService.serverTimestamp(),
        openedByUserId: actor.uid,
        openedByName: actor.fullName || "",
        updatedAt: FirebaseService.serverTimestamp()
      }, { merge: true });
    });
    await batch.commit();
  },

  async closeRound(periodId) {
    const actor = UserContext.requireUser();
    if (!isTchcHead(actor)) throw new Error("Chỉ Trưởng Phòng Tổ chức - Hành chính được khóa đợt điều chỉnh sau Hội đồng.");
    const round = await this.getRound(periodId);
    if (!round) throw new Error("Chưa có đợt điều chỉnh sau Hội đồng để khóa.");
    await FirebaseService.updateDoc(roundRef(periodId), {
      status: "CLOSED",
      closedAt: FirebaseService.serverTimestamp(),
      closedByUserId: actor.uid,
      closedByName: actor.fullName || "",
      updatedAt: FirebaseService.serverTimestamp()
    });
  },

  async listDepartmentRequests(periodId, departmentId) {
    const actor = UserContext.requireUser();
    const dept = upper(departmentId);
    if (!(isDepartmentManagerFor(dept, actor) || isTchcHead(actor) || Permissions.isDirector(actor))) {
      throw new Error("Tài khoản không có quyền xem yêu cầu sau Hội đồng của Phòng/Khu này.");
    }
    const snapshot = await FirebaseService.getDocs(requestsCollection(periodId, dept));
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => String(a.userName || "").localeCompare(String(b.userName || ""), "vi"));
  },

  async listMyRequests(periodId, departmentId) {
    const user = UserContext.requireUser();
    const snapshot = await FirebaseService.getDocs(
      FirebaseService.query(
        requestsCollection(periodId, upper(departmentId || user.departmentId)),
        FirebaseService.where("userId", "==", user.uid)
      )
    );
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  },

  async listDepartmentTasks(periodId, departmentId) {
    const actor = UserContext.requireUser();
    const dept = upper(departmentId);
    if (!(isDepartmentManagerFor(dept, actor) || isTchcHead(actor) || Permissions.isDirector(actor))) {
      throw new Error("Tài khoản không có quyền xem nhiệm vụ của Phòng/Khu này.");
    }
    const snapshot = await FirebaseService.getDocs(
      FirebaseService.query(
        FirebaseService.collection(FirebaseService.db, "tasks"),
        FirebaseService.where("periodId", "==", periodId),
        FirebaseService.where("primaryDepartmentId", "==", dept)
      )
    );
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(task => task.active !== false);
  },

  async getCommonCriteriaForUser(periodId, userId) {
    return findCommonAssessment(periodId, userId);
  },

  async createTaskRequest({ periodId, departmentId, user, task, requestType, instruction, requestedScore = null }) {
    const actor = UserContext.requireUser();
    const dept = upper(departmentId);
    if (!isDepartmentManagerFor(dept, actor)) throw new Error("Chỉ Trưởng/Phó Phòng/Khu được giao yêu cầu điều chỉnh cho nhân sự của đơn vị mình.");
    await ensureOpenRound(periodId, dept);
    if (!user?.id || upper(user.departmentId) !== dept) throw new Error("Người được chọn không thuộc Phòng/Khu hiện tại.");
    if (!task?.id || task.ownerUserId !== user.id || upper(task.primaryDepartmentId) !== dept) {
      throw new Error("Nhiệm vụ không thuộc đúng cá nhân/Phòng-Khu đang xử lý.");
    }
    const type = upper(requestType);
    if (!REQUEST_TYPES.includes(type)) throw new Error("Loại yêu cầu điều chỉnh chưa hợp lệ.");
    const note = clean(instruction);
    if (!note) throw new Error("Hãy nhập nội dung/kết luận Hội đồng cần cá nhân thực hiện.");

    const evaluation = await findEvaluation(periodId, task.id);
    const beforeScore = finite(evaluation?.confirmedActualScore)
      ? Number(evaluation.confirmedActualScore)
      : finite(task.confirmedActualScore)
        ? Number(task.confirmedActualScore)
        : finite(evaluation?.selfActualScore)
          ? Number(evaluation.selfActualScore)
          : null;
    const maxScore = Number(task.maximumConvertedScore || task.baseScore || 0);
    if ((type === "SCORE" || type === "SCORE_AND_EVIDENCE") && finite(requestedScore)) {
      const n = Number(requestedScore);
      if (n < 0 || (maxScore > 0 && n > maxScore)) throw new Error("Điểm Hội đồng dự kiến nằm ngoài giới hạn của đầu việc.");
    }

    const id = requestDocumentId(user.id, "TASK", task.id);
    await FirebaseService.setDoc(requestRef(periodId, dept, id), {
      id,
      periodId,
      departmentId: dept,
      userId: user.id,
      userName: user.fullName || user.email || "",
      userPosition: user.position || "",
      targetType: "TASK",
      targetId: task.id,
      taskId: task.id,
      taskCode: task.taskCode || "",
      taskTitle: task.title || "",
      evaluationId: evaluation?.id || "",
      requestType: type,
      instruction: note,
      status: "OPEN",
      beforeScore,
      maximumScore: maxScore,
      requestedScore: finite(requestedScore) ? Number(requestedScore) : null,
      employeeProposedScore: null,
      employeeComment: "",
      originalEvidence: {
        evidenceText: task.evidenceText || "",
        evidenceUrl: task.evidenceUrl || task.evidenceLink || "",
        evidenceFileName: task.evidenceFileName || "",
        evidenceStoragePath: task.evidenceStoragePath || ""
      },
      supplementalEvidence: [],
      createdAt: FirebaseService.serverTimestamp(),
      createdByUserId: actor.uid,
      createdByName: actor.fullName || "",
      submittedAt: null,
      confirmedAt: null,
      finalScore: null,
      managerNote: "",
      updatedAt: FirebaseService.serverTimestamp()
    }, { merge: true });
    return id;
  },

  async createCriterionRequest({ periodId, departmentId, user, assessment, criterionIndex, requestType, instruction, requestedScore = null }) {
    const actor = UserContext.requireUser();
    const dept = upper(departmentId);
    if (!isDepartmentManagerFor(dept, actor)) throw new Error("Chỉ Trưởng/Phó Phòng/Khu được giao yêu cầu điều chỉnh tiêu chí chung.");
    await ensureOpenRound(periodId, dept);
    if (!assessment?.id || assessment.userId !== user?.id) throw new Error("Không tìm thấy bộ tiêu chí chung của cá nhân.");
    const items = Array.isArray(assessment.items) ? assessment.items : [];
    const index = Number(criterionIndex);
    const criterion = items[index];
    if (!criterion) throw new Error("Không tìm thấy tiêu chí cần điều chỉnh.");
    const type = upper(requestType);
    if (!REQUEST_TYPES.includes(type)) throw new Error("Loại yêu cầu điều chỉnh chưa hợp lệ.");
    const note = clean(instruction);
    if (!note) throw new Error("Hãy nhập nội dung/kết luận Hội đồng.");
    const criterionId = criterionIdentity(criterion, index);
    const beforeScore = criterionScore(criterion);
    const maxScore = criterionMax(criterion);
    if ((type === "SCORE" || type === "SCORE_AND_EVIDENCE") && finite(requestedScore)) {
      const n = Number(requestedScore);
      if (n < 0 || (finite(maxScore) && n > maxScore)) throw new Error("Điểm tiêu chí vượt quá mức tối đa.");
    }
    const id = requestDocumentId(user.id, "COMMON_CRITERION", criterionId);
    await FirebaseService.setDoc(requestRef(periodId, dept, id), {
      id,
      periodId,
      departmentId: dept,
      userId: user.id,
      userName: user.fullName || user.email || "",
      userPosition: user.position || "",
      targetType: "COMMON_CRITERION",
      targetId: criterionId,
      assessmentId: assessment.id,
      criterionIndex: index,
      criterionId,
      criterionName: criterionLabel(criterion, index),
      requestType: type,
      instruction: note,
      status: "OPEN",
      beforeScore,
      maximumScore: maxScore,
      requestedScore: finite(requestedScore) ? Number(requestedScore) : null,
      employeeProposedScore: null,
      employeeComment: "",
      originalEvidence: {},
      supplementalEvidence: [],
      createdAt: FirebaseService.serverTimestamp(),
      createdByUserId: actor.uid,
      createdByName: actor.fullName || "",
      submittedAt: null,
      confirmedAt: null,
      finalScore: null,
      managerNote: "",
      updatedAt: FirebaseService.serverTimestamp()
    }, { merge: true });
    return id;
  },

  async submitEmployeeUpdate(requestItem, { proposedScore = null, comment = "", evidence = null } = {}) {
    const user = UserContext.requireUser();
    if (!requestItem?.id || requestItem.userId !== user.uid) throw new Error("Yêu cầu điều chỉnh không thuộc tài khoản hiện tại.");
    await ensureOpenRound(requestItem.periodId, requestItem.departmentId);
    if (!OPEN_REQUEST_STATUSES.includes(upper(requestItem.status))) throw new Error("Yêu cầu này không còn ở trạng thái cho phép cá nhân cập nhật.");

    const type = upper(requestItem.requestType);
    if (type === "SCORE" || type === "SCORE_AND_EVIDENCE") {
      if (!finite(proposedScore)) throw new Error("Hãy nhập điểm đề nghị sau khi rà soát.");
      const score = Number(proposedScore);
      if (score < 0 || (finite(requestItem.maximumScore) && score > Number(requestItem.maximumScore))) {
        throw new Error("Điểm đề nghị nằm ngoài giới hạn của đầu việc/tiêu chí.");
      }
    }
    if ((type === "EVIDENCE" || type === "SCORE_AND_EVIDENCE") && !clean(comment) && !evidence) {
      throw new Error("Hãy bổ sung giải trình hoặc minh chứng theo yêu cầu Hội đồng.");
    }

    const evidenceRows = Array.isArray(requestItem.supplementalEvidence)
      ? [...requestItem.supplementalEvidence]
      : [];
    if (evidence && (evidence.evidenceUrl || evidence.evidenceText || evidence.evidenceFileName)) {
      evidenceRows.push({
        evidenceText: clean(evidence.evidenceText),
        evidenceUrl: clean(evidence.evidenceUrl),
        evidenceFileName: clean(evidence.evidenceFileName),
        evidenceStoragePath: clean(evidence.evidenceStoragePath),
        addedByUserId: user.uid,
        addedByName: user.fullName || "",
        addedAtClient: new Date().toISOString()
      });
    }

    await FirebaseService.updateDoc(
      requestRef(requestItem.periodId, requestItem.departmentId, requestItem.id),
      {
        employeeProposedScore: finite(proposedScore) ? Number(proposedScore) : null,
        employeeComment: clean(comment),
        supplementalEvidence: evidenceRows,
        status: "EMPLOYEE_SUBMITTED",
        submittedAt: FirebaseService.serverTimestamp(),
        submittedByUserId: user.uid,
        submittedByName: user.fullName || "",
        updatedAt: FirebaseService.serverTimestamp()
      }
    );
  },

  async returnToEmployee(requestItem, note = "") {
    const actor = UserContext.requireUser();
    if (!isDepartmentManagerFor(requestItem?.departmentId, actor)) throw new Error("Chỉ Trưởng/Phó Phòng/Khu được trả yêu cầu về cho cá nhân bổ sung.");
    await ensureOpenRound(requestItem.periodId, requestItem.departmentId);
    const reason = clean(note);
    if (!reason) throw new Error("Hãy nhập nội dung cần cá nhân bổ sung thêm.");
    await FirebaseService.updateDoc(requestRef(requestItem.periodId, requestItem.departmentId, requestItem.id), {
      status: "RETURNED",
      returnNote: reason,
      returnedAt: FirebaseService.serverTimestamp(),
      returnedByUserId: actor.uid,
      returnedByName: actor.fullName || "",
      updatedAt: FirebaseService.serverTimestamp()
    });
  },

  async confirmRequest(requestItem, { finalScore = null, managerNote = "" } = {}) {
    const actor = UserContext.requireUser();
    if (!isDepartmentManagerFor(requestItem?.departmentId, actor)) throw new Error("Chỉ Trưởng/Phó Phòng/Khu được chốt kết quả sau Hội đồng của đơn vị mình.");
    await ensureOpenRound(requestItem.periodId, requestItem.departmentId);
    if (upper(requestItem.status) !== "EMPLOYEE_SUBMITTED") throw new Error("Cá nhân chưa gửi lại nội dung điều chỉnh để Trưởng/Phó Phòng/Khu chốt.");

    const scoreRequired = ["SCORE", "SCORE_AND_EVIDENCE"].includes(upper(requestItem.requestType));
    const scoreValue = scoreRequired
      ? (finite(finalScore) ? Number(finalScore) : Number(requestItem.employeeProposedScore))
      : (finite(finalScore) ? Number(finalScore) : null);
    if (scoreRequired && !finite(scoreValue)) throw new Error("Hãy xác định điểm cuối cùng sau Hội đồng.");
    if (finite(scoreValue) && (scoreValue < 0 || (finite(requestItem.maximumScore) && scoreValue > Number(requestItem.maximumScore)))) {
      throw new Error("Điểm cuối cùng nằm ngoài giới hạn cho phép.");
    }

    const batch = FirebaseService.writeBatch(FirebaseService.db);
    const requestReference = requestRef(requestItem.periodId, requestItem.departmentId, requestItem.id);

    if (upper(requestItem.targetType) === "TASK") {
      const taskSnapshot = await FirebaseService.getDoc(FirebaseService.doc(FirebaseService.db, "tasks", requestItem.taskId));
      if (!taskSnapshot.exists()) throw new Error("Không tìm thấy nhiệm vụ cần chốt sau Hội đồng.");
      const task = taskSnapshot.data() || {};
      const effectiveScore = finite(scoreValue)
        ? Number(scoreValue)
        : finite(task.confirmedActualScore)
          ? Number(task.confirmedActualScore)
          : finite(requestItem.beforeScore) ? Number(requestItem.beforeScore) : null;
      const taskUpdate = {
        preCouncilConfirmedActualScore: finite(task.preCouncilConfirmedActualScore)
          ? Number(task.preCouncilConfirmedActualScore)
          : (finite(task.confirmedActualScore) ? Number(task.confirmedActualScore) : requestItem.beforeScore ?? null),
        councilAdjusted: true,
        councilAdjustmentType: requestItem.requestType,
        councilAdjustmentRequestId: requestItem.id,
        councilSupplementalEvidence: Array.isArray(requestItem.supplementalEvidence)
          ? requestItem.supplementalEvidence
          : [],
        councilFinalizedAt: FirebaseService.serverTimestamp(),
        councilFinalizedByUserId: actor.uid,
        councilFinalizedByName: actor.fullName || "",
        councilManagerNote: clean(managerNote),
        updatedAt: FirebaseService.serverTimestamp(),
        updatedByUserId: actor.uid,
        updatedByName: actor.fullName || ""
      };
      if (finite(effectiveScore)) {
        taskUpdate.confirmedActualScore = round2(effectiveScore);
        taskUpdate.scoringStatus = "CONFIRMED";
        taskUpdate.scoreLocked = true;
      }
      batch.update(FirebaseService.doc(FirebaseService.db, "tasks", requestItem.taskId), taskUpdate);

      const evaluation = requestItem.evaluationId
        ? await FirebaseService.getDoc(FirebaseService.doc(FirebaseService.db, "taskEvaluations", requestItem.evaluationId))
        : null;
      if (evaluation?.exists?.()) {
        const data = evaluation.data() || {};
        const evaluationUpdate = {
          preCouncilConfirmedActualScore: finite(data.preCouncilConfirmedActualScore)
            ? Number(data.preCouncilConfirmedActualScore)
            : (finite(data.confirmedActualScore) ? Number(data.confirmedActualScore) : requestItem.beforeScore ?? null),
          councilAdjusted: true,
          councilAdjustmentType: requestItem.requestType,
          councilAdjustmentRequestId: requestItem.id,
          councilFinalizedAt: FirebaseService.serverTimestamp(),
          councilFinalizedByUserId: actor.uid,
          councilFinalizedByName: actor.fullName || "",
          councilManagerNote: clean(managerNote),
          updatedAt: FirebaseService.serverTimestamp()
        };
        if (finite(effectiveScore)) {
          evaluationUpdate.confirmedActualScore = round2(effectiveScore);
          evaluationUpdate.status = "CONFIRMED";
          evaluationUpdate.scoreLocked = true;
        }
        batch.update(FirebaseService.doc(FirebaseService.db, "taskEvaluations", requestItem.evaluationId), evaluationUpdate);
      }
    } else if (upper(requestItem.targetType) === "COMMON_CRITERION") {
      const assessmentSnapshot = await FirebaseService.getDoc(FirebaseService.doc(FirebaseService.db, "commonCriteriaAssessments", requestItem.assessmentId));
      if (!assessmentSnapshot.exists()) throw new Error("Không tìm thấy bộ tiêu chí chung cần điều chỉnh.");
      const assessment = assessmentSnapshot.data() || {};
      const items = Array.isArray(assessment.items) ? assessment.items.map(item => ({ ...item })) : [];
      const index = Number(requestItem.criterionIndex);
      if (!items[index]) throw new Error("Tiêu chí cần điều chỉnh không còn tồn tại.");
      const effectiveScore = finite(scoreValue)
        ? Number(scoreValue)
        : criterionScore(items[index]);
      const beforeItems = Array.isArray(assessment.preCouncilItems) ? assessment.preCouncilItems : assessment.items;
      items[index] = applyCriterionScore(items[index], round2(effectiveScore));
      batch.update(FirebaseService.doc(FirebaseService.db, "commonCriteriaAssessments", requestItem.assessmentId), {
        preCouncilItems: beforeItems,
        preCouncilConfirmedTotal: finite(assessment.preCouncilConfirmedTotal)
          ? Number(assessment.preCouncilConfirmedTotal)
          : (finite(assessment.confirmedTotal) ? Number(assessment.confirmedTotal) : null),
        items,
        confirmedTotal: commonTotal(items),
        status: "CONFIRMED",
        councilAdjusted: true,
        councilAdjustmentRequestId: requestItem.id,
        councilFinalizedAt: FirebaseService.serverTimestamp(),
        councilFinalizedByUserId: actor.uid,
        councilFinalizedByName: actor.fullName || "",
        updatedAt: FirebaseService.serverTimestamp()
      });
    } else {
      throw new Error("Loại đối tượng điều chỉnh sau Hội đồng chưa được hỗ trợ.");
    }

    batch.update(requestReference, {
      status: "CONFIRMED",
      finalScore: finite(scoreValue) ? round2(scoreValue) : requestItem.beforeScore ?? null,
      managerNote: clean(managerNote),
      confirmedAt: FirebaseService.serverTimestamp(),
      confirmedByUserId: actor.uid,
      confirmedByName: actor.fullName || "",
      updatedAt: FirebaseService.serverTimestamp()
    });
    await batch.commit();
  },

  requestTypeLabel(type) {
    return ({
      SCORE: "Điều chỉnh điểm",
      EVIDENCE: "Bổ sung/chứng minh kết quả thực hiện",
      SCORE_AND_EVIDENCE: "Điều chỉnh điểm và bổ sung minh chứng"
    })[upper(type)] || clean(type);
  },

  statusLabel(status) {
    return ({
      OPEN: "Chờ cá nhân điều chỉnh",
      RETURNED: "Yêu cầu bổ sung lại",
      EMPLOYEE_SUBMITTED: "Cá nhân đã cập nhật — chờ Trưởng phòng xác nhận",
      CONFIRMED: "Đã chốt sau Hội đồng"
    })[upper(status)] || clean(status);
  }
});
