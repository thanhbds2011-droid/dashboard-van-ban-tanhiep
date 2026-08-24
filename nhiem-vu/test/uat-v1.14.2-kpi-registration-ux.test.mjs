import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { calculateMilestoneProgress } from '../kpi-engine.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const repo = path.resolve(root, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const readRepo = p => fs.readFileSync(path.join(repo, p), 'utf8');
const completed = key => new Date(`${key}T08:00:00+07:00`);

test('V1.14.2: mốc hoàn thành trước hạn được tính ngay 100 dù deadline ở tương lai', () => {
  const summary = calculateMilestoneProgress([
    { id: 'm1', sequence: 1, dueDateKey: '2026-07-25', completedAt: completed('2026-08-10') }, // >5 ngày => 0
    { id: 'm2', sequence: 2, dueDateKey: '2026-08-25', completedAt: completed('2026-08-24') }, // sớm => 100
    { id: 'm3', sequence: 3, dueDateKey: '2026-09-25', completedAt: completed('2026-08-24') }  // rất sớm => 100, vẫn tính ngay
  ], new Date('2026-08-24T12:00:00+07:00'));
  assert.deepEqual(summary.rates, [0, 100, 100]);
  assert.equal(summary.eligibleMilestones, 3);
  assert.equal(summary.completedEarlyFutureMilestones, 2);
  assert.equal(summary.averageRate, 66.67);
  assert.equal(summary.appliedProgressRate, 60);
});

test('V1.14.2: mốc chưa hoàn thành và chưa đến hạn không tính; đến hạn chưa hoàn thành = 0', () => {
  const before = calculateMilestoneProgress([
    { dueDateKey: '2026-08-25', completedAt: completed('2026-08-24') },
    { dueDateKey: '2026-09-25', completedAt: null }
  ], new Date('2026-08-24T12:00:00+07:00'));
  assert.deepEqual(before.rates, [100]);
  assert.equal(before.pendingFutureMilestones, 1);
  assert.equal(before.appliedProgressRate, 100);

  const overdue = calculateMilestoneProgress([
    { dueDateKey: '2026-08-25', completedAt: completed('2026-08-24') },
    { dueDateKey: '2026-09-25', completedAt: null }
  ], new Date('2026-09-26T12:00:00+07:00'));
  assert.deepEqual(overdue.rates, [100, 0]);
  assert.equal(overdue.appliedProgressRate, 0); // trung bình 50 -> quy xuống 0
});

test('V1.14.2: đúng/sớm 100; trễ 1-3 =80; trễ 4-5=60; >5=0', () => {
  const summary = calculateMilestoneProgress([
    { dueDateKey: '2026-07-25', completedAt: completed('2026-07-24') },
    { dueDateKey: '2026-08-25', completedAt: completed('2026-08-28') },
    { dueDateKey: '2026-09-25', completedAt: completed('2026-09-30') },
    { dueDateKey: '2026-10-25', completedAt: completed('2026-11-01') }
  ], new Date('2026-11-02T12:00:00+07:00'));
  assert.deepEqual(summary.rates, [100, 80, 60, 0]);
});

test('Rules duyệt registration legacy kiểm tra deadline trên request.resource.data', () => {
  const rules = readRepo('firestore.rules');
  assert.match(rules, /request\.resource\.data\.status != "APPROVED" \|\| registrationHasDeadline\(request\.resource\.data\)/);
  assert.doesNotMatch(rules, /request\.resource\.data\.status != "APPROVED" \|\| registrationHasDeadline\(resource\.data\)/);
});

test('Nút Duyệt mục đã chọn không còn tự reject checkbox không chọn', () => {
  const source = read('modules/kpi/kpi-workflow.js');
  assert.doesNotMatch(source, /rejectMany\(unselected/);
  assert.doesNotMatch(source, /Không được duyệt trong đợt xét kế hoạch này/);
  assert.match(source, /Mục không chọn tiếp tục ở trạng thái PENDING/);
});

test('Tự đánh giá giải thích milestone và không trộn đúng hạn vào Kết quả áp dụng', () => {
  const source = read('modules/kpi/kpi-workflow.js');
  assert.match(source, /Mốc đã hoàn thành được tính ngay, kể cả hoàn thành sớm/);
  assert.match(source, /Đúng\/sớm hạn = 100%/);
  assert.match(source, /100% — Hoàn thành đầy đủ yêu cầu/);
  assert.doesNotMatch(source, /100% — Đúng hạn\/đạt đầy đủ yêu cầu/);
  assert.match(source, /kpiSelfCommentError/);
  assert.match(source, /Vui lòng nhập nhận xét trước khi gửi tự đánh giá/);
});

test('Cập nhật nhiệm vụ không hiển thị completedAt/progress kỹ thuật trong UI', () => {
  const source = read('modules/tasks/task-progress-modal.js');
  assert.doesNotMatch(source, /completedAt được ghi/);
  assert.doesNotMatch(source, /progress = 100/);
  assert.match(source, /Thời điểm hoàn thành được hệ thống ghi tự động/);
  assert.match(source, /Có thể hoàn thành trước hạn/);
  assert.match(source, /taskProgressFormError/);
});

test('Build/version V1.14.2 được tập trung và index nạp release mới', () => {
  const version = read('core/app-version.js');
  const index = read('index.html');
  assert.match(version, /APP_VERSION = "1\.14\.2"/);
  assert.match(version, /BUILD_VERSION = "20260824\.V1_14_2"/);
  assert.match(version, /CACHE_NAME = "nhiem-vu-20260824-v1-14-2"/);
  assert.match(index, /release-v1\.14\.2\.js\?v=20260824\.V1_14_2/);
});
