/**
 * Toast realtime riêng cho Chỉ đạo điều hành V1.10.6.
 * Không phụ thuộc Nhiệm vụ/KPI và không thay thế OneSignal Push.
 */
import { FirebaseService } from "../core/firebase-service.js?v=20260824.V1_15_0";
import { UserContext } from "../core/user-context.js?v=20260824.V1_15_0";
import { Permissions } from "../core/permissions.js?v=20260824.V1_15_0";
import { ToastService } from "../core/toast-service.js?v=20260824.V1_15_0";

const MAX_LIST = 200;
const ALERT_LOOKBACK_MS = 48 * 60 * 60 * 1000;
let stopFns = [];
let startedUid = "";
function clean(v) { return String(v ?? "").trim(); }
function upper(v) { return clean(v).toUpperCase(); }
function isLeader(user) { return upper(user?.role) === "DEPARTMENT_LEADER" || (upper(user?.role) === "TCHC_COORDINATOR" && upper(user?.departmentId) === "TCHC"); }
function relevantForAlert(user, directive) {
  if (!user?.uid || directive?.isDeleted === true) return false;
  if (Permissions.canManageExecutiveDirectives(user)) return clean(directive.createdByUserId) !== user.uid;
  const dep = upper(user.departmentId);
  if (!dep || !(directive.visibleDepartmentIds || []).map(upper).includes(dep)) return false;
  if (dep === upper(directive.leadDepartmentId)) {
    if (upper(directive.assignmentLevel) === "PERSON") {
      return clean(directive.leadUserId) === user.uid || isLeader(user);
    }
    return isLeader(user);
  }
  return isLeader(user); // Phòng/Khu phối hợp: thông báo cho lãnh đạo đơn vị.
}
function directiveMessage(directive) {
  const person = clean(directive.leadUserName);
  const team = clean(directive.leadTeamName || directive.leadTeamId);
  const target = person ? `${team ? team + " · " : ""}${person}` : "Phòng/Khu của bạn";
  return `Có chỉ đạo mới giao ${target}: ${clean(directive.content).slice(0, 160)}`;
}
function updateMessage(update) {
  const type = upper(update.updateType);
  const status = upper(update.status);
  if (type === "ACCEPTED") return `${clean(update.createdByName) || "Phòng/Khu"} đã xác nhận tiếp nhận chỉ đạo.`;
  if (type === "PROGRESS" && status === "COMPLETED") return `${clean(update.createdByName) || "Phòng/Khu"} đã cập nhật Hoàn thành chỉ đạo.`;
  if (type === "PROGRESS") return `${clean(update.createdByName) || "Phòng/Khu"} vừa cập nhật tiến độ chỉ đạo.`;
  return "Chỉ đạo điều hành vừa có cập nhật mới.";
}
function stop() {
  stopFns.forEach(fn => { try { fn?.(); } catch (_) {} });
  stopFns = [];
  startedUid = "";
}

export const ExecutiveInAppAlertService = Object.freeze({
  start(user = UserContext.getUser()) {
    if (!user?.uid || user.active !== true) return false;
    if (startedUid === user.uid && stopFns.length) return true;
    stop();
    startedUid = user.uid;

    const since = FirebaseService.Timestamp.fromDate(new Date(Date.now() - ALERT_LOOKBACK_MS));
    const directives = FirebaseService.collection(FirebaseService.db, "executiveDirectives");
    const directiveQuery = Permissions.canViewAllExecutiveDirectives(user)
      ? FirebaseService.query(
          directives,
          FirebaseService.where("updatedAt", ">=", since),
          FirebaseService.orderBy("updatedAt", "desc"),
          FirebaseService.limit(MAX_LIST)
        )
      : FirebaseService.query(
          directives,
          FirebaseService.where("visibleDepartmentIds", "array-contains", user.departmentId),
          FirebaseService.where("updatedAt", ">=", since),
          FirebaseService.orderBy("updatedAt", "desc"),
          FirebaseService.limit(MAX_LIST)
        );
    let directivesReady = false;
    const stopDirectives = FirebaseService.onSnapshot(directiveQuery, snapshot => {
      if (!directivesReady) { directivesReady = true; return; }
      snapshot.docChanges().forEach(change => {
        if (!['added', 'modified'].includes(change.type)) return;
        const directive = { id: change.doc.id, ...change.doc.data() };
        if (!relevantForAlert(user, directive)) return;
        if (clean(directive.updatedByUserId || directive.createdByUserId) === user.uid) return;
        ToastService.success(change.type === 'added' ? directiveMessage(directive) : `Chỉ đạo vừa được cập nhật: ${clean(directive.content).slice(0, 150)}`, 7000);
      });
    }, error => {
      if (!String(error?.code || "").includes("permission-denied")) {
        console.warn("Không theo dõi được Chỉ đạo điều hành realtime:", error);
      }
    });
    stopFns.push(stopDirectives);

    if (Permissions.canManageExecutiveDirectives(user)) {
      const updates = FirebaseService.query(
        FirebaseService.collection(FirebaseService.db, "executiveDirectiveUpdates"),
        FirebaseService.where("createdAt", ">=", since),
        FirebaseService.orderBy("createdAt", "desc"),
        FirebaseService.limit(MAX_LIST)
      );
      let updatesReady = false;
      const stopUpdates = FirebaseService.onSnapshot(updates, snapshot => {
        if (!updatesReady) { updatesReady = true; return; }
        snapshot.docChanges().forEach(change => {
          if (change.type !== "added") return;
          const item = { id: change.doc.id, ...change.doc.data() };
          if (upper(item.departmentId) === "__SYSTEM__" || clean(item.createdByUserId) === user.uid) return;
          ToastService.success(updateMessage(item), 6500);
        });
      }, error => console.warn("Không theo dõi được cập nhật Chỉ đạo điều hành:", error));
      stopFns.push(stopUpdates);
    }
    return true;
  },
  stop
});
