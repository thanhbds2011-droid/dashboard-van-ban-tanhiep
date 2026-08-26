import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { calculateWorkItemSummary } from '../work-item-score-engine.js';
import { progressRateFromDates } from '../kpi-engine.js';
import { confirmWriteWithServerRecovery } from '../services/firestore-write-recovery.js';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const repoRoot = resolve(appRoot, '..');
const read = path => readFile(resolve(repoRoot, path), 'utf8');

function deferred() {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

test('V1.18.6 version/build/cache marker đồng nhất', async () => {
  const [version, index, sw, release] = await Promise.all([
    read('nhiem-vu/core/app-version.js'),
    read('nhiem-vu/index.html'),
    read('nhiem-vu/sw.js'),
    read('nhiem-vu/release-v1.18.6.js')
  ]);
  assert.match(version, /APP_VERSION = "1\.18\.6"/);
  assert.match(version, /BUILD_VERSION = "20260826\.V1_18_6"/);
  assert.match(version, /CACHE_NAME = "nhiem-vu-20260826-v1-18-6"/);
  assert.match(index, /app-build" content="20260826\.V1_18_6"/);
  assert.match(index, /release-v1\.18\.6\.js\?v=20260826\.V1_18_6/);
  assert.match(sw, /BUILD_VERSION = "20260826\.V1_18_6"/);
  assert.match(release, /EVENT_DRIVEN Close Reliability/);
});

test('EVENT_DRIVEN trễ 1 ngày: hoàn thành nghiệp vụ 100%, KPI tiến độ 80%, KPI kết quả 100%', () => {
  const progressRate = progressRateFromDates('2026-08-24T23:59:59', '2026-08-25T23:59:59', true);
  assert.equal(progressRate, 80);
  const summary = calculateWorkItemSummary([
    {
      active: true,
      workItemType: 'GENERIC',
      assignedDateKey: '2026-08-17',
      deadlineDateKey: '2026-08-24',
      completedDateKey: '2026-08-25',
      progressRate,
      resultRate: 100
    }
  ], 'GENERIC', { excludeFutureIncomplete: true, asOfDateKey: '2026-08-26' });
  assert.equal(summary.completedCount, 1);
  assert.equal(summary.count, 1);
  assert.equal(summary.appliedProgressRate, 80);
  assert.equal(summary.appliedResultRate, 100);
});

test('EVENT_DRIVEN close ghi progress vận hành 100 và giữ eventProgressRate KPI riêng', async () => {
  const source = await read('nhiem-vu/services/task-write-service.js');
  const start = source.indexOf('async endEventDrivenTracking');
  const end = source.indexOf('async requestNoOccurrence', start);
  const block = source.slice(start, end);
  assert.match(block, /progress:\s*100/);
  assert.match(block, /eventProgressRate:\s*kpiProgress/);
  assert.match(block, /newProgress:\s*100/);
  assert.match(block, /earlyVerifyAfterMs:\s*1500/);
  assert.match(block, /eventTrackingClosedOnServer/);
  assert.match(source, /firestore\.googleapis\.com\/v1\/projects/);
});

test('Rules V1.18.6 cho owner kết thúc EVENT_DRIVEN với progress=100 và root/deployment giống nhau', async () => {
  const [rootRules, deploymentRules] = await Promise.all([
    read('firestore.rules'),
    read('deployment/firestore.rules')
  ]);
  assert.equal(rootRules, deploymentRules);
  assert.match(rootRules, /Production Rules V1\.18\.6/);
  assert.match(rootRules, /function ownerEventDrivenCompletionValid\(\)/);
  const start = rootRules.indexOf('function ownerEventDrivenCompletionValid()');
  const end = rootRules.indexOf('function ownerRecurringMilestoneUpdateValid', start);
  const block = rootRules.slice(start, end);
  assert.match(block, /request\.resource\.data\.progress == 100/);
  assert.match(block, /request\.resource\.data\.progress == request\.resource\.data\.eventProgressRate/);
  assert.match(block, /tương thích PWA V1\.18\.5/);
  assert.match(rootRules, /allow update: if ownerCanUpdateTask\(taskId\)/);
});

test('firebase.json public đúng root Firestore Rules', async () => {
  const firebase = JSON.parse(await read('firebase.json'));
  assert.equal(firebase.firestore.rules, 'firestore.rules');
  assert.equal(firebase.firestore.indexes, 'firestore.indexes.json');
});

test('UI V1.18.6 nói rõ hoàn thành nghiệp vụ khác KPI tiến độ', async () => {
  const [detail, progress, tasks] = await Promise.all([
    read('nhiem-vu/modules/tasks/task-detail-modal.js'),
    read('nhiem-vu/modules/tasks/task-progress-modal.js'),
    read('nhiem-vu/modules/tasks/tasks-view.js')
  ]);
  assert.match(detail, /Hoàn thành nghiệp vụ/);
  assert.match(detail, /Điểm KPI áp dụng/);
  assert.match(detail, /trễ 1–3 ngày → 80%/);
  assert.match(progress, /100% ở đây là đã làm xong toàn bộ lượt công việc/);
  assert.match(tasks, /100% hoàn thành/);
  assert.match(tasks, /KPI tiến độ/);
});

test('early server verification giải phóng UI trước ACK WebChannel nhưng không che lỗi write thật', async () => {
  const pending = deferred();
  const started = Date.now();
  const result = await confirmWriteWithServerRecovery(
    pending.promise,
    async () => true,
    { earlyVerifyAfterMs: 20, overallTimeoutMs: 500, verifyAttempts: 2, verifyDelayMs: 10, verifyReadTimeoutMs: 100 }
  );
  assert.equal(result.recovered, true);
  assert.equal(result.earlyVerified, true);
  assert.ok(Date.now() - started < 450);
  pending.resolve();

  const denied = Object.assign(new Error('permission denied'), { code: 'permission-denied' });
  await assert.rejects(
    confirmWriteWithServerRecovery(
      Promise.reject(denied),
      async () => true,
      { earlyVerifyAfterMs: 20, overallTimeoutMs: 300, verifyAttempts: 1, verifyReadTimeoutMs: 100 }
    ),
    error => error === denied
  );
});
