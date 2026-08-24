import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = p => fs.readFileSync(path.join(root,p),'utf8');

test('V1.13.0 version is centralized',()=>{
  const s=read('core/app-version.js');
  assert.match(s,/APP_VERSION = "1\.13\.0"/);
  assert.match(s,/20260824\.V1_13_0/);
});
test('notification send is non blocking',()=>{
  const s=read('services/task-notification-service.js');
  assert.match(s,/enqueue\(/);
  assert.match(s,/caller có await send\(\) cũng không còn chờ/);
});
test('department leaders do not query CDTN unless member',()=>{
  const s=read('services/task-read-service.js');
  assert.match(s,/if \(Permissions\.isCdtnMember\(\)\)/);
});
test('profile watcher reloads scope changes',()=>{
  const s=read('core/auth-service.js');
  assert.match(s,/startProfileScopeWatcher/);
  assert.match(s,/app:profile-scope-changed/);
  assert.match(s,/visibilitychange/);
});
test('kpi confirm no longer awaits audit or loadAll after commit',()=>{
  const s=read('modules/kpi/kpi-workflow.js');
  const pos=s.indexOf("scoreBatch.commit()");
  const chunk=s.slice(pos,pos+1800);
  assert.match(chunk,/void audit\('CONFIRM_TASK_SCORE'/);
  assert.doesNotMatch(chunk,/await audit\('CONFIRM_TASK_SCORE'/);
  assert.match(chunk,/scheduleKpiRealtimeReload\(\)/);
});
test('PWA recovery is present',()=>{
  assert.match(read('index.html'),/startupRecovery/);
  assert.match(read('sw.js'),/Sao chép cache app trước/);
  assert.match(read('sw.js'),/key\.startsWith\("nhiem-vu-"\) && key !== CACHE_NAME/);
});
