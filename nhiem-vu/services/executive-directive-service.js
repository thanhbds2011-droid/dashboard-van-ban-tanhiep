/**
 * Phân hệ Chỉ đạo điều hành - dữ liệu độc lập với Nhiệm vụ/KPI.
 * Collections: executiveDirectives, executiveDirectiveUpdates, executiveWeeklyReports.
 */
import { FirebaseService } from "../core/firebase-service.js?v=20260810.V1_10_3";
import { UserContext } from "../core/user-context.js?v=20260810.V1_10_3";
import { Permissions } from "../core/permissions.js?v=20260810.V1_10_3";

const DIRECTIVES = "executiveDirectives";
const UPDATES = "executiveDirectiveUpdates";
const REPORTS = "executiveWeeklyReports";
const MAX_LIST = 2000;

function clean(value) { return String(value ?? "").trim(); }
function upper(value) { return clean(value).toUpperCase(); }
function normalizeDateKey(value) {
  const text = clean(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}
function uniqueUpper(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(upper).filter(Boolean))];
}
function actionDateKey() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}
function assertManager() {
  if (!Permissions.canManageExecutiveDirectives()) {
    throw new Error("Tài khoản không có quyền quản trị Chỉ đạo điều hành.");
  }
}
function assertActiveUser() {
  const user = UserContext.requireUser();
  if (user.active !== true) throw new Error("Tài khoản chưa được kích hoạt.");
  return user;
}
function directiveRef(id) {
  return FirebaseService.doc(FirebaseService.db, DIRECTIVES, clean(id));
}
function updateRef() {
  return FirebaseService.doc(FirebaseService.collection(FirebaseService.db, UPDATES));
}
function reportId(weekStart, departmentId = "ALL") {
  return `${upper(departmentId || "ALL")}_${normalizeDateKey(weekStart)}`;
}
function reportRef(weekStart, departmentId = "ALL") {
  return FirebaseService.doc(FirebaseService.db, REPORTS, reportId(weekStart, departmentId));
}
function mapSnapshot(snapshot) {
  return snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
}
function sortDirectives(items = []) {
  return [...items].sort((a, b) => {
    const date = clean(b.directedDateKey).localeCompare(clean(a.directedDateKey));
    if (date) return date;
    return clean(b.createdAt?.toDate?.()?.toISOString?.() || "").localeCompare(clean(a.createdAt?.toDate?.()?.toISOString?.() || ""));
  });
}
function sortUpdates(items = []) {
  return [...items].sort((a, b) => {
    const ad = clean(a.actionDateKey);
    const bd = clean(b.actionDateKey);
    if (ad !== bd) return bd.localeCompare(ad);
    const at = a.createdAt?.toMillis?.() || 0;
    const bt = b.createdAt?.toMillis?.() || 0;
    return bt - at;
  });
}
function managerAuditPayload(type, directiveId, message, extras = {}) {
  const user = assertActiveUser();
  return {
    directiveId: clean(directiveId),
    departmentId: "__SYSTEM__",
    updateType: upper(type),
    status: "",
    progressSummary: "",
    resultSummary: "",
    evidenceLinks: [],
    note: clean(message),
    actionDateKey: actionDateKey(),
    createdByUserId: user.uid,
    createdByName: user.fullName || user.email,
    createdByRole: user.role,
    createdByDepartmentId: user.departmentId,
    createdAt: FirebaseService.serverTimestamp(),
    ...extras
  };
}

export const ExecutiveDirectiveService = Object.freeze({
  async listDirectives(options = {}) {
    const user = assertActiveUser();
    const collectionRef = FirebaseService.collection(FirebaseService.db, DIRECTIVES);
    let q;
    if (Permissions.canViewAllExecutiveDirectives()) {
      q = FirebaseService.query(collectionRef, FirebaseService.limit(MAX_LIST));
    } else {
      if (!user.departmentId) return [];
      q = FirebaseService.query(
        collectionRef,
        FirebaseService.where("visibleDepartmentIds", "array-contains", user.departmentId),
        FirebaseService.limit(MAX_LIST)
      );
    }
    const items = mapSnapshot(await FirebaseService.getDocs(q));
    const includeDeleted = options.includeDeleted === true && Permissions.canManageExecutiveDirectives();
    return sortDirectives(items.filter(item => includeDeleted || item.isDeleted !== true));
  },

  subscribeDirectives(onNext, onError = console.warn) {
    const user = assertActiveUser();
    const collectionRef = FirebaseService.collection(FirebaseService.db, DIRECTIVES);
    const q = Permissions.canViewAllExecutiveDirectives()
      ? FirebaseService.query(collectionRef, FirebaseService.limit(MAX_LIST))
      : FirebaseService.query(
          collectionRef,
          FirebaseService.where("visibleDepartmentIds", "array-contains", user.departmentId),
          FirebaseService.limit(MAX_LIST)
        );
    return FirebaseService.onSnapshot(q, snapshot => {
      const items = sortDirectives(mapSnapshot(snapshot).filter(item => item.isDeleted !== true));
      onNext(items);
    }, onError);
  },

  async listUpdates() {
    const user = assertActiveUser();
    const collectionRef = FirebaseService.collection(FirebaseService.db, UPDATES);
    const q = Permissions.canViewAllExecutiveDirectives()
      ? FirebaseService.query(collectionRef, FirebaseService.limit(MAX_LIST))
      : FirebaseService.query(
          collectionRef,
          FirebaseService.where("departmentId", "==", user.departmentId),
          FirebaseService.limit(MAX_LIST)
        );
    return sortUpdates(mapSnapshot(await FirebaseService.getDocs(q)));
  },

  async createDirective(input = {}) {
    assertManager();
    const user = assertActiveUser();
    const leadDepartmentId = upper(input.leadDepartmentId);
    if (!leadDepartmentId) throw new Error("Chưa chọn Phòng/Khu chủ trì.");
    const supportDepartmentIds = uniqueUpper(input.supportDepartmentIds).filter(id => id !== leadDepartmentId);
    const visibleDepartmentIds = uniqueUpper([leadDepartmentId, ...supportDepartmentIds]);
    const directedDateKey = normalizeDateKey(input.directedDateKey);
    if (!directedDateKey) throw new Error("Ngày chỉ đạo không hợp lệ.");
    const content = clean(input.content);
    if (!content) throw new Error("Chưa nhập nội dung chỉ đạo.");
    const directedByName = clean(input.directedByName);
    if (!directedByName) throw new Error("Chưa xác định người chỉ đạo.");

    const ref = FirebaseService.doc(FirebaseService.collection(FirebaseService.db, DIRECTIVES));
    const payload = {
      code: clean(input.code),
      sourceType: upper(input.sourceType || "DIRECT"),
      meetingName: clean(input.meetingName),
      referenceText: clean(input.referenceText),
      directedDateKey,
      directedByUserId: clean(input.directedByUserId),
      directedByName,
      content,
      leadDepartmentId,
      supportDepartmentIds,
      visibleDepartmentIds,
      dueDateKey: normalizeDateKey(input.dueDateKey),
      priority: upper(input.priority || "NORMAL"),
      lifecycleStatus: "ACTIVE",
      closeReason: "",
      closedDateKey: "",
      closedByUserId: "",
      isDeleted: false,
      deletedDateKey: "",
      deletedReason: "",
      createdByUserId: user.uid,
      createdByName: user.fullName || user.email,
      createdByRole: user.role,
      createdByDepartmentId: user.departmentId,
      createdAt: FirebaseService.serverTimestamp(),
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: user.uid,
      updatedByName: user.fullName || user.email
    };
    const batch = FirebaseService.writeBatch(FirebaseService.db);
    batch.set(ref, payload);
    batch.set(updateRef(), managerAuditPayload("DIRECTIVE_CREATED", ref.id, "Tạo nội dung chỉ đạo và giao Phòng/Khu thực hiện.", {
      snapshot: { directedDateKey, directedByName, leadDepartmentId, supportDepartmentIds, dueDateKey: payload.dueDateKey, priority: payload.priority }
    }));
    await batch.commit();
    return { id: ref.id, ...payload };
  },

  async updateDirective(current = {}, input = {}) {
    assertManager();
    const user = assertActiveUser();
    const id = clean(current.id);
    if (!id) throw new Error("Không xác định được nội dung chỉ đạo cần sửa.");
    const leadDepartmentId = upper(input.leadDepartmentId);
    const supportDepartmentIds = uniqueUpper(input.supportDepartmentIds).filter(id2 => id2 !== leadDepartmentId);
    const visibleDepartmentIds = uniqueUpper([leadDepartmentId, ...supportDepartmentIds]);
    const patch = {
      sourceType: upper(input.sourceType || current.sourceType || "DIRECT"),
      meetingName: clean(input.meetingName),
      referenceText: clean(input.referenceText),
      directedDateKey: normalizeDateKey(input.directedDateKey),
      directedByUserId: clean(input.directedByUserId),
      directedByName: clean(input.directedByName),
      content: clean(input.content),
      leadDepartmentId,
      supportDepartmentIds,
      visibleDepartmentIds,
      dueDateKey: normalizeDateKey(input.dueDateKey),
      priority: upper(input.priority || "NORMAL"),
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: user.uid,
      updatedByName: user.fullName || user.email
    };
    if (!patch.directedDateKey || !patch.directedByName || !patch.content || !patch.leadDepartmentId) {
      throw new Error("Thông tin chỉ đạo chưa đầy đủ.");
    }
    const changed = [];
    const compare = [
      ["sourceType", "hình thức"], ["meetingName", "cuộc họp"], ["referenceText", "nguồn/văn bản"],
      ["directedDateKey", "ngày chỉ đạo"], ["directedByName", "người chỉ đạo"], ["content", "nội dung"],
      ["leadDepartmentId", "đơn vị chủ trì"], ["dueDateKey", "thời hạn"], ["priority", "mức độ"]
    ];
    compare.forEach(([key, label]) => { if (clean(current[key]) !== clean(patch[key])) changed.push(label); });
    if (JSON.stringify(uniqueUpper(current.supportDepartmentIds)) !== JSON.stringify(supportDepartmentIds)) changed.push("đơn vị phối hợp");

    const batch = FirebaseService.writeBatch(FirebaseService.db);
    batch.update(directiveRef(id), patch);
    batch.set(updateRef(), managerAuditPayload("DIRECTIVE_EDITED", id,
      changed.length ? `Đã chỉnh sửa: ${changed.join(", ")}.` : "Đã lưu lại nội dung chỉ đạo.",
      { changedFields: changed }
    ));
    await batch.commit();
  },

  async setLifecycle(current = {}, closed, reason = "") {
    assertManager();
    const user = assertActiveUser();
    const id = clean(current.id);
    if (!id) throw new Error("Không xác định được nội dung chỉ đạo.");
    const patch = closed ? {
      lifecycleStatus: "CLOSED",
      closeReason: clean(reason),
      closedDateKey: actionDateKey(),
      closedByUserId: user.uid,
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: user.uid,
      updatedByName: user.fullName || user.email
    } : {
      lifecycleStatus: "ACTIVE",
      closeReason: "",
      closedDateKey: "",
      closedByUserId: "",
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: user.uid,
      updatedByName: user.fullName || user.email
    };
    const batch = FirebaseService.writeBatch(FirebaseService.db);
    batch.update(directiveRef(id), patch);
    batch.set(updateRef(), managerAuditPayload(closed ? "DIRECTIVE_CLOSED" : "DIRECTIVE_REOPENED", id,
      closed ? `Đóng nội dung chỉ đạo.${clean(reason) ? ` Lý do: ${clean(reason)}` : ""}` : "Mở lại nội dung chỉ đạo để tiếp tục theo dõi."
    ));
    await batch.commit();
  },

  async softDelete(current = {}, reason = "") {
    assertManager();
    const user = assertActiveUser();
    const id = clean(current.id);
    if (!id) throw new Error("Không xác định được nội dung chỉ đạo.");
    const deleteReason = clean(reason);
    if (!deleteReason) throw new Error("Cần nhập lý do xóa.");
    const dateKey = actionDateKey();
    const batch = FirebaseService.writeBatch(FirebaseService.db);
    batch.update(directiveRef(id), {
      isDeleted: true,
      deletedDateKey: dateKey,
      deletedReason: deleteReason,
      deletedByUserId: user.uid,
      deletedByName: user.fullName || user.email,
      updatedAt: FirebaseService.serverTimestamp(),
      updatedByUserId: user.uid,
      updatedByName: user.fullName || user.email
    });
    batch.set(updateRef(), managerAuditPayload("DIRECTIVE_DELETED", id, `Xóa nội dung chỉ đạo khỏi danh sách sử dụng. Lý do: ${deleteReason}`));
    await batch.commit();
  },

  async addProgressUpdate(directive = {}, departmentId = "", input = {}) {
    const user = assertActiveUser();
    const id = clean(directive.id);
    const targetDepartmentId = upper(departmentId || user.departmentId);
    if (!id || !targetDepartmentId) throw new Error("Không xác định được Phòng/Khu cập nhật.");
    const visible = uniqueUpper(directive.visibleDepartmentIds);
    const manager = Permissions.canManageExecutiveDirectives();
    if (!manager && (targetDepartmentId !== user.departmentId || !visible.includes(user.departmentId))) {
      throw new Error("Tài khoản chỉ được cập nhật nội dung liên quan Phòng/Khu của mình.");
    }
    if (!visible.includes(targetDepartmentId)) throw new Error("Phòng/Khu này không thuộc phạm vi nội dung chỉ đạo.");
    const status = upper(input.status || "IN_PROGRESS");
    if (!["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "PAUSED"].includes(status)) {
      throw new Error("Trạng thái cập nhật không hợp lệ.");
    }
    const dateKey = actionDateKey();
    const ref = updateRef();
    await FirebaseService.setDoc(ref, {
      directiveId: id,
      departmentId: targetDepartmentId,
      updateType: "PROGRESS",
      status,
      progressSummary: clean(input.progressSummary),
      resultSummary: clean(input.resultSummary),
      evidenceLinks: (Array.isArray(input.evidenceLinks) ? input.evidenceLinks : [])
        .map(clean).filter(Boolean).slice(0, 20),
      note: clean(input.note),
      actionDateKey: dateKey,
      completedDateKey: status === "COMPLETED" ? dateKey : "",
      createdByUserId: user.uid,
      createdByName: user.fullName || user.email,
      createdByRole: user.role,
      createdByDepartmentId: user.departmentId,
      enteredOnBehalfOfDepartment: manager && targetDepartmentId !== user.departmentId,
      createdAt: FirebaseService.serverTimestamp()
    });
    return ref.id;
  },

  async saveWeeklyReport(report = {}) {
    const user = assertActiveUser();
    const weekStart = normalizeDateKey(report.weekStart);
    const weekEnd = normalizeDateKey(report.weekEnd);
    const departmentId = upper(report.departmentId || "ALL");
    if (!weekStart || !weekEnd) throw new Error("Khoảng tuần báo cáo không hợp lệ.");
    const centerScope = departmentId === "ALL";
    if (centerScope && !Permissions.canGenerateCenterExecutiveReports()) {
      throw new Error("Tài khoản không có quyền lưu báo cáo toàn Trung tâm.");
    }
    if (!centerScope && !Permissions.canGenerateCenterExecutiveReports() && departmentId !== user.departmentId) {
      throw new Error("Tài khoản chỉ được lưu báo cáo của Phòng/Khu mình.");
    }
    const ref = reportRef(weekStart, departmentId);
    await FirebaseService.setDoc(ref, {
      scopeType: centerScope ? "CENTER" : "DEPARTMENT",
      departmentId,
      weekStart,
      weekEnd,
      title: clean(report.title),
      summary: report.summary || {},
      sections: report.sections || {},
      generatedByUserId: user.uid,
      generatedByName: user.fullName || user.email,
      generatedByDepartmentId: user.departmentId,
      generatedAt: FirebaseService.serverTimestamp(),
      updatedAt: FirebaseService.serverTimestamp()
    }, { merge: true });
    return ref.id;
  },

  async loadWeeklyReport(weekStart, departmentId = "ALL") {
    const user = assertActiveUser();
    const target = upper(departmentId || "ALL");
    if (target === "ALL" && !Permissions.canGenerateCenterExecutiveReports()) return null;
    if (target !== "ALL" && !Permissions.canGenerateCenterExecutiveReports() && target !== user.departmentId) return null;
    const snapshot = await FirebaseService.getDoc(reportRef(weekStart, target));
    return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
  }
});
