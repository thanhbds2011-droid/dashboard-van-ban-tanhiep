/** Chẩn đoán production dành riêng cho ADMIN. */
import { FirebaseService } from "../core/firebase-service.js?v=20260824.V1_14_1";

const COLLECTION_LIMIT = 2000;
const clean = value => String(value ?? "").trim();
const upper = value => clean(value).toUpperCase();
const mapDocs = snapshot => snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

async function list(name, max = COLLECTION_LIMIT) {
  const reference = FirebaseService.query(
    FirebaseService.collection(FirebaseService.db, name),
    FirebaseService.limit(max)
  );
  return mapDocs(await FirebaseService.getDocs(reference));
}

function issue(code, level, collection, documentId, message) {
  return { code, level, collection, documentId, message };
}

function validateUsers(items) {
  const issues = [];
  const emails = new Map();
  for (const item of items) {
    const email = clean(item.email).toLowerCase();
    const role = upper(item.role);
    const department = upper(item.departmentId);
    const position = clean(item.position).toLowerCase();
    if (!email || !role || !department) issues.push(issue("USER_REQUIRED", "ERROR", "users", item.id, "Thiếu email, vai trò hoặc Phòng/Khu."));
    if (email) {
      if (emails.has(email) && emails.get(email) !== item.id) issues.push(issue("USER_DUPLICATE_EMAIL", "ERROR", "users", item.id, `Trùng email với ${emails.get(email)}.`));
      emails.set(email, item.id);
    }
    if (role === "DIRECTOR" && department !== "BGD") issues.push(issue("DIRECTOR_DEPARTMENT", "ERROR", "users", item.id, "DIRECTOR phải thuộc BGD."));
    if (role === "TCHC_COORDINATOR" && department !== "TCHC") issues.push(issue("COORDINATOR_DEPARTMENT", "ERROR", "users", item.id, "TCHC_COORDINATOR phải thuộc TCHC."));
    if (role === "DEPARTMENT_LEADER" && !/(trưởng|truong|phó|pho|phụ trách|phu trach)/i.test(position)) issues.push(issue("LEADER_POSITION", "WARNING", "users", item.id, "Vai trò lãnh đạo nhưng chức danh chưa thể hiện Trưởng/Phó/Phụ trách."));
  }
  return issues;
}

function validateTasks(items) {
  const issues = [];
  for (const item of items) {
    const departments = Array.isArray(item.visibleDepartmentIds) ? item.visibleDepartmentIds.map(upper) : [];
    const users = Array.isArray(item.visibleUserIds) ? item.visibleUserIds : [];
    const primary = upper(item.primaryDepartmentId);
    if (!primary || !clean(item.periodId) || !clean(item.taskCode)) issues.push(issue("TASK_REQUIRED", "ERROR", "tasks", item.id, "Thiếu mã nhiệm vụ, kỳ hoặc Phòng/Khu chính."));
    if (!departments.includes(primary)) issues.push(issue("TASK_VISIBILITY_DEPARTMENT", "REPAIRABLE", "tasks", item.id, "visibleDepartmentIds chưa chứa Phòng/Khu chính."));
    if (clean(item.ownerUserId) && !users.includes(item.ownerUserId)) issues.push(issue("TASK_VISIBILITY_OWNER", "REPAIRABLE", "tasks", item.id, "visibleUserIds chưa chứa người phụ trách."));
  }
  return issues;
}

function validateStandardTasks(items) {
  const required = ["audienceType", "trackingMode", "workItemType", "active", "order"];
  const issues = [];
  for (const item of items) {
    const missing = required.filter(field => item[field] === undefined || item[field] === null || clean(item[field]) === "");
    if (missing.length) issues.push(issue("STANDARD_TASK_SCHEMA", "WARNING", "standardTasks", item.id, `Thiếu trường V4: ${missing.join(", ")}.`));
    if (upper(item.code || item.id) !== upper(item.id)) issues.push(issue("STANDARD_TASK_ID", "WARNING", "standardTasks", item.id, "Document ID chưa trùng trường code."));
  }
  return issues;
}

function validatePeriods(items) {
  const active = items.filter(item => item.active === true && upper(item.status) !== "DELETED");
  return active.length > 1 ? [issue("MULTIPLE_ACTIVE_PERIODS", "ERROR", "evaluationPeriods", active.map(x => x.id).join(","), `Có ${active.length} kỳ đang hoạt động.`)] : [];
}

async function latestLogs() {
  const read = async (name, timeField, max = 50) => {
    const reference = FirebaseService.query(
      FirebaseService.collection(FirebaseService.db, name),
      FirebaseService.orderBy(timeField, "desc"),
      FirebaseService.limit(max)
    );
    return mapDocs(await FirebaseService.getDocs(reference)).map(item => ({ ...item, source: name, timeField }));
  };
  const results = await Promise.allSettled([
    read("taskLogs", "createdAt"),
    read("kpiAuditLogs", "performedAt")
  ]);
  return results.flatMap(result => result.status === "fulfilled" ? result.value : []);
}

export const AdminReadService = Object.freeze({
  async diagnostics() {
    const names = ["users", "accessAccounts", "standardTasks", "tasks", "evaluationPeriods"];
    const settled = await Promise.allSettled(names.map(name => list(name)));
    const data = Object.fromEntries(names.map((name, index) => [name, settled[index].status === "fulfilled" ? settled[index].value : []]));
    const unavailable = names.filter((_, index) => settled[index].status === "rejected");
    const issues = [
      ...validateUsers(data.users),
      ...validateTasks(data.tasks),
      ...validateStandardTasks(data.standardTasks),
      ...validatePeriods(data.evaluationPeriods)
    ];
    return {
      counts: Object.fromEntries(names.map(name => [name, data[name].filter(item => item.active !== false).length])),
      unavailable,
      issues,
      repairableTaskIds: [...new Set(issues.filter(item => item.level === "REPAIRABLE" && item.collection === "tasks").map(item => item.documentId))],
      checkedAt: new Date()
    };
  },
  latestLogs
});
