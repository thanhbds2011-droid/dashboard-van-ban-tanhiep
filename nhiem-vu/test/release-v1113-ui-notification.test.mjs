import fs from "node:fs";
import assert from "node:assert/strict";

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const view = read("modules/executive-directives/executive-directives-view.js");
const css = read("executive-directives.css");
const version = read("core/app-version.js");
const index = read("index.html");
const push = fs.readFileSync(new URL("../../CHI_DAO_DIEU_HANH_PUSH_V1_3_0.gs", import.meta.url), "utf8");

assert.match(version, /APP_VERSION = "1\.11\.3"/);
assert.match(index, /release-v1\.11\.3\.js/);
assert.ok(!view.includes('<span class="page-eyebrow">CHỈ ĐẠO ĐIỀU HÀNH</span>'));
assert.ok(!view.includes('Ghi nhận chỉ đạo miệng</h2>'));
assert.ok(!view.includes('<strong>Sau khi lưu:</strong>'));
assert.ok(!view.includes('<strong>Luồng giao việc:</strong>'));
assert.match(view, /function renderListResults\(root\)/);
assert.match(view, /renderListResults\(root\);/);
assert.ok(!view.includes('state.search = event.target.value; renderList(root);'));
assert.match(css, /directive-sync-button/);
assert.match(css, /directive-header-actions \.directive-main-action/);
assert.match(push, /EXEC_PUSH_VERSION_ = '1\.3\.0'/);
assert.ok(!push.includes('  addManagers();'));
assert.match(push, /function quetNhacHanChiDaoDieuHanh\(\)/);
assert.match(push, /DIRECTIVE_DUE_TODAY/);
assert.match(push, /DIRECTIVE_OVERDUE_ESCALATION/);
assert.match(push, /function execAddTchcEscalationRecipients_/);
console.log("V1.11.3 UI + Push V1.3.0: PASS");
