import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { UserContext } from "../core/user-context.js?v=20260810.V1_10_6";
import { Permissions } from "../core/permissions.js?v=20260818.V1_11_4";

function setUser(overrides = {}) {
  return UserContext.setUser({
    uid: "uid-test",
    email: "test@example.com",
    fullName: "Tài khoản kiểm thử",
    role: "STAFF",
    departmentId: "YT",
    position: "Nhân viên",
    active: true,
    ...overrides
  });
}

test("ADMIN, Ban Giám đốc và đầu mối TCHC xem toàn Trung tâm", () => {
  setUser({ role: "ADMIN" });
  assert.equal(Permissions.canViewAllDepartments(), true);

  setUser({ role: "DIRECTOR", departmentId: "BGD" });
  assert.equal(Permissions.canViewAllDepartments(), true);

  setUser({ role: "TCHC_COORDINATOR", departmentId: "TCHC" });
  assert.equal(Permissions.canViewAllDepartments(), true);
});

test("ADMIN/Trưởng TCHC quản lý kỳ; Phó TCHC không tự có quyền", () => {
  setUser({ role: "ADMIN", departmentId: "TCHC", position: "Quản trị" });
  assert.equal(Permissions.canManageEvaluationPeriods(), true);

  setUser({ role: "DEPARTMENT_LEADER", departmentId: "TCHC", position: "Trưởng phòng" });
  assert.equal(Permissions.canViewAllDepartments(), true);
  assert.equal(Permissions.canManageEvaluationPeriods(), true);

  setUser({ role: "DEPARTMENT_LEADER", departmentId: "TCHC", position: "Phó Trưởng phòng" });
  assert.equal(Permissions.canViewAllDepartments(), true);
  assert.equal(Permissions.canManageEvaluationPeriods(), false);
});

test("Lãnh đạo đơn vị khác và nhân viên TCHC không tự động có quyền toàn Trung tâm", () => {
  setUser({ role: "DEPARTMENT_LEADER", departmentId: "YT", position: "Trưởng phòng" });
  assert.equal(Permissions.canViewAllDepartments(), false);

  setUser({ role: "STAFF", departmentId: "TCHC", position: "Chuyên viên" });
  assert.equal(Permissions.canViewAllDepartments(), false);
});

test("Firestore Rules có cùng phạm vi đọc toàn Trung tâm với giao diện", async () => {
  const rulesUrl = new URL("../../firestore.rules", import.meta.url);
  const rules = await readFile(rulesUrl, "utf8");
  assert.match(
    rules,
    /isDepartmentLeader\(\)\s*&&\s*sameDepartment\("TCHC"\)/
  );
});

