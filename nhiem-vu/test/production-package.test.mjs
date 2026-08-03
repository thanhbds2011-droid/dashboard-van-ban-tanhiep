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
  "deployment/apps-script-account-sync-v3.2.1.gs",
  "deployment/apps-script-standard-tasks-v4.1.0.gs",
  "deployment/apps-script-notification-ai-evidence-v6.3.0.gs",
  "nhiem-vu/app-v3.js",
  "nhiem-vu/sw.js",
  "nhiem-vu/icons/icon-192.png",
  "icon-192.png",
  "icon-512.png"
];

test("Gói production có đủ thành phần triển khai", () => {
  for (const relative of required) assert.equal(existsSync(resolve(repo, relative)), true, `Thiếu ${relative}`);
});

test("Không đưa private key hoặc OneSignal API key thật vào GitHub", () => {
  const files = ["nhiem-vu/app-v3.js", "nhiem-vu/firebase-config.js", "deployment/apps-script-notification-ai-evidence-v6.3.0.gs"];
  const content = files.map(file => readFileSync(resolve(repo, file), "utf8")).join("\n");
  assert.doesNotMatch(content, /-----BEGIN PRIVATE KEY-----/);
  assert.doesNotMatch(content, /ONESIGNAL_API_KEY\s*[:=]\s*["'][^"']{20,}["']/);
});
