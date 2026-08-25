import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('V1.16.1: hai URL module UserContext khác query vẫn dùng chung store global', async () => {
  const base = pathToFileURL(path.join(root, 'core/user-context.js')).href;
  const a = await import(`${base}?test=A-${Date.now()}`);
  const b = await import(`${base}?test=B-${Date.now()}`);
  a.UserContext.clear();
  a.UserContext.setUser({ uid:'uid-A', email:'a@example.com', fullName:'A', role:'STAFF', departmentId:'CTXH', active:true });
  assert.equal(b.UserContext.getUser()?.uid, 'uid-A');
  b.UserContext.beginTransition('TEST_SWITCH');
  assert.equal(a.UserContext.isTransitioning(), true);
  b.UserContext.setUser({ uid:'uid-B', email:'b@example.com', fullName:'B', role:'STAFF', departmentId:'YT', active:true });
  assert.equal(a.UserContext.getUser()?.uid, 'uid-B');
  assert.equal(a.UserContext.isTransitioning(), false);
  a.UserContext.clear();
});

test('V1.16.1: requireUser trả mã lỗi chuyên biệt thay vì lỗi kỹ thuật chung', async () => {
  const base = pathToFileURL(path.join(root, 'core/user-context.js')).href;
  const { UserContext } = await import(`${base}?test=missing-${Date.now()}`);
  UserContext.clear();
  assert.throws(() => UserContext.requireUser(), error => {
    assert.equal(error.code, 'USER_CONTEXT_MISSING');
    assert.match(error.message, /đang được đồng bộ/i);
    return true;
  });
});

test('V1.16.1: logout giữ context đến sau signOut và phát transition trước', () => {
  const auth = read('core/auth-service.js');
  const start = auth.indexOf('async logout()');
  const block = auth.slice(start, start + 900);
  assert.ok(block.indexOf('UserContext.beginTransition("LOGOUT")') >= 0);
  assert.ok(block.indexOf('app:auth-transition-start') >= 0);
  assert.ok(block.indexOf('await FirebaseService.logout()') >= 0);
  assert.ok(block.indexOf('UserContext.clear({ keepTransition: true })') > block.indexOf('await FirebaseService.logout()'));
});

test('V1.16.1: FirebaseService có auth-state watcher dài hạn', () => {
  const source = read('core/firebase-service.js');
  assert.match(source, /watchAuthState\(next, error\)/);
  assert.match(source, /return onAuthStateChanged\(auth/);
});

test('V1.16.1: Auth guard phát recovery nếu auth UID và context UID lệch nhau', () => {
  const source = read('core/auth-service.js');
  assert.match(source, /startAuthSessionGuard/);
  assert.match(source, /AUTH_CONTEXT_MISMATCH/);
  assert.match(source, /app:session-recovery-needed/);
  assert.match(source, /startAuthSessionGuard\(firebaseUser\.uid\)/);
});

test('V1.16.1: Router stop vô hiệu hóa render async và không lộ lỗi context kỹ thuật', () => {
  const source = read('core/router.js');
  assert.match(source, /this\.resolveSequence \+= 1/);
  assert.match(source, /USER_CONTEXT_MISSING/);
  assert.match(source, /Đang đồng bộ phiên đăng nhập/);
  assert.match(source, /app:session-recovery-needed/);
});

test('V1.16.1: app tự phục hồi session một lần, lần lặp sẽ logout sạch', () => {
  const source = read('app-v3.js');
  assert.match(source, /SESSION_RECOVERY_KEY/);
  assert.match(source, /recoverSession/);
  assert.match(source, /const repeated = previous\?\.at/);
  assert.match(source, /if \(repeated\)[\s\S]*await AuthService\.logout\(\)/);
  assert.match(source, /await Promise\.all\(\[purgeRuntimeCaches\(\), refreshServiceWorkerRegistration\(\)\]\)/);
});

test('V1.16.1: app kiểm tra HTML build so với module build', () => {
  const app = read('app-v3.js');
  const html = read('index.html');
  assert.match(app, /verifyBuildConsistency/);
  assert.match(app, /__APP_HTML_BUILD__/);
  assert.match(html, /meta name="app-build" content="20260825\.V1_16_1"/);
  assert.match(html, /window\.__APP_HTML_BUILD__ = "20260825\.V1_16_1"/);
});

test('V1.16.1: PWA kiểm tra build Service Worker và BFCache trên mọi browser', () => {
  const pwa = read('pwa.js');
  const sw = read('sw.js');
  assert.match(pwa, /controllerBuildVersion/);
  assert.match(pwa, /SERVICE_WORKER_BUILD_MISMATCH/);
  assert.match(pwa, /if \(event\.persisted\)/);
  assert.doesNotMatch(pwa, /event\.persisted && isStandalone\(\)/);
  assert.match(sw, /GET_BUILD_VERSION/);
  assert.match(sw, /APP_BUILD_VERSION/);
});

test('V1.16.1: build query được bump đồng bộ và release marker mới được nạp', () => {
  const version = read('core/app-version.js');
  const index = read('index.html');
  const sw = read('sw.js');
  assert.match(version, /APP_VERSION = "1\.16\.1"/);
  assert.match(version, /BUILD_VERSION = "20260825\.V1_16_1"/);
  assert.match(index, /app-v3\.js\?v=20260825\.V1_16_1/);
  assert.match(index, /release-v1\.16\.1\.js\?v=20260825\.V1_16_1/);
  assert.match(sw, /20260825\.V1_16_1/);
});
