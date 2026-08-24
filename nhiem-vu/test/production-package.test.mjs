import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const repo = resolve(import.meta.dirname, "../..");
const required = [
  "firestore.rules",
  "firestore.indexes.json",
  "deployment/firestore.rules",
  "deployment/firestore.indexes.json",
  "deployment/APPS_SCRIPT_DONG_BO_TAI_KHOAN_V3_3_2.gs",
  "deployment/apps-script-standard-tasks-v4.3.0.gs",
  "deployment/apps-script-notification-ai-evidence-v6.4.0.gs",
  "nhiem-vu/app-v3.js",
  "nhiem-vu/sw.js",
  "deployment/ADDON_SHEET_UI_V1_13_0.gs",
  "nhiem-vu/icons/icon-192.png",
  "deployment/apps-script-handover-reset-v1.0.1.gs",
];

test("Gói production có đủ thành phần triển khai", () => {
  for (const relative of required) assert.equal(existsSync(resolve(repo, relative)), true, `Thiếu ${relative}`);
});

test("Không đưa private key hoặc OneSignal API key thật vào GitHub", () => {
  const files = ["nhiem-vu/app-v3.js", "nhiem-vu/firebase-config.js", "deployment/apps-script-notification-ai-evidence-v6.4.0.gs"];
  const content = files.map(file => readFileSync(resolve(repo, file), "utf8")).join("\n");
  assert.doesNotMatch(content, /-----BEGIN PRIVATE KEY-----/);
  assert.doesNotMatch(content, /ONESIGNAL_API_KEY\s*[:=]\s*["'][^"']{20,}["']/);
});
