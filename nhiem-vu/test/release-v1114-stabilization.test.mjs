import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const repo = resolve(import.meta.dirname, "../..");
const read = relative => readFileSync(resolve(repo, relative), "utf8");

const version = read("nhiem-vu/core/app-version.js");
const index = read("nhiem-vu/index.html");
const permissions = read("nhiem-vu/core/permissions.js");
const standardView = read("nhiem-vu/modules/standard-tasks/standard-tasks-view.js");
const standardWrite = read("nhiem-vu/services/standard-task-write-service.js");
const rules = read("firestore.rules");
const gas = read("deployment/apps-script-standard-tasks-v4.2.1.gs");
const reset = read("deployment/apps-script-handover-reset-v1.0.0.gs");


test("V1.11.4 dùng version/cache mới", () => {
  assert.match(version, /APP_VERSION = "1\.11\.4"/);
  assert.match(version, /BUILD_VERSION = "20260818\.V1_11_4"/);
  assert.match(version, /CACHE_NAME = "nhiem-vu-20260818-v1-11-4"/);
  assert.match(index, /release-v1\.11\.4\.js\?v=20260818\.V1_11_4/);
});

test("Tên đầu việc chuẩn thống nhất giới hạn 1000 ký tự", () => {
  assert.match(standardView, /id="catalogTaskName" maxlength="1000"/);
  assert.match(standardWrite, /MAX_STANDARD_TASK_NAME_LENGTH = 1000/);
  assert.match(standardWrite, /name\.length > MAX_STANDARD_TASK_NAME_LENGTH/);
  assert.match(gas, /Phiên bản 4\.2\.1/);
  assert.match(gas, /name:\s*1000/);
  assert.match(rules, /data\.name\.size\(\) <= 1000/);
});

test("Quyền UI khớp Rules ở các điểm ổn định hóa", () => {
  assert.match(permissions, /return this\.isAdmin\(user\) \|\| \(this\.isDepartmentHead\(user\) && upper\(user\?\.departmentId\) === "TCHC"\)/);
  const confirmBlock = permissions.match(/canConfirmEvaluations\([\s\S]*?\n  },/)?.[0] || "";
  assert.doesNotMatch(confirmBlock, /isDirector/);
});

test("Rules bảo vệ archive trước hard-delete", () => {
  assert.match(rules, /Production Rules V1\.11\.4/);
  assert.match(rules, /function periodArchiveReady\(/);
  assert.match(rules, /function periodArchiveReadyForData\(/);
  assert.match(rules, /match \/periodArchives\/\{periodId\}/);
  assert.match(rules, /status in \["ARCHIVED", "PURGING"\]/);
  assert.match(rules, /allow delete: if isAdmin\(\) && periodArchiveReadyForData\(resource\.data\)/);
});

test("Gói có utility reset bàn giao one-time", () => {
  assert.equal(existsSync(resolve(repo, "deployment/apps-script-handover-reset-v1.0.0.gs")), true);
  assert.match(reset, /HANDOVER_RESET_CONFIRMATION/);
  assert.match(reset, /RESET_TEST_DATA_20260818/);
  assert.match(reset, /standardTaskSequences/);
  assert.match(reset, /standardTasks/);
  assert.match(reset, /HANDOVER_RESET_USED_AT/);
});
