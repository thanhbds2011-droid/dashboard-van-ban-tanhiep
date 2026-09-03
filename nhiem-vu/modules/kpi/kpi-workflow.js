import { auth, db } from '../../firebase-config.js?v=20260903.V1_22_3';
import {
  addDoc, collection, deleteDoc, deleteField, doc, getDoc, getDocs, onSnapshot, query,
  serverTimestamp, setDoc, Timestamp, updateDoc, where, limit, writeBatch
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { TaskRegistrationService } from '../../services/task-registration-service.js?v=20260903.V1_22_3';
import { TaskWorkItemService } from '../../services/task-work-item-service.js?v=20260903.V1_22_3';
import { TaskMilestoneService } from '../../services/task-milestone-service.js?v=20260903.V1_22_3';
import { TaskEvidenceService } from '../../services/task-evidence-service.js?v=20260903.V1_22_3';
import { PeriodArchiveService } from '../../services/period-archive-service.js?v=20260903.V1_22_3';
import { PeriodReadService } from '../../services/period-read-service.js?v=20260903.V1_22_3';
import { TaskReadService } from '../../services/task-read-service.js?v=20260903.V1_22_3';
import { Permissions } from '../../core/permissions.js?v=20260903.V1_22_3';
import { UserContext } from '../../core/user-context.js?v=20260903.V1_22_3';
import { APP_VERSION } from '../../core/app-version.js?v=20260903.V1_22_3';
import { compareTasksForDisplay } from '../../core/task-display-order.js?v=20260903.V1_22_3';
import { friendlyErrorMessage, isPermissionDeniedError } from '../../core/friendly-error.js?v=20260903.V1_22_3';
import {
  KPI2B as KPI2C, M01_GROUPS, COMMON_CRITERIA, commonCriteriaForProfile, reportFormTypeForProfile, calculateTaskScore, calculateKpiSummary,
  proposedRating, resolveQualityRating, ratingName, round2, progressRateFromDates, convertAppendix04Rate, calculateMilestoneProgress, calculateBonusScore
} from '../../kpi-engine.js?v=20260903.V1_22_3';
import { resolveKpiReviewer, canReviewKpiOwner } from '../../core/kpi-review-authority.js?v=20260903.V1_22_3';
import { ModalService } from '../../core/modal-service.js?v=20260903.V1_22_3';
import { exportFormattedKpiWorkbook } from '../../services/xlsx-export-service.js?v=20260903.V1_22_3';

export const KpiWorkflowState = {
  user: null,
  profile: null,
  period: null,
  periods: [],
  users: [],
  tasks: [],
  registrations: [],
  evaluations: [],
  milestones: [],
  common: null,
  commonAll: [],
  plan: null,
  selectedTaskId: null,
  initialized: false,
  mode: 'plans',
  delegations: [],
  kpiProfile: null,
  scopeDepartmentId: 'ALL',
  selectedReviewUserId: ''
};

let kpiPeriodReloading = false;
let stopKpiTaskRealtime = null;
let kpiLiveUnsubscribers = [];
let kpiRealtimeTimer = null;
let kpiRealtimeCleanupBound = false;
let kpiRealtimePrimed = false;
let kpiRealtimeFingerprint = '';
let kpiReloadPromise = null;
let lastManualKpiRefreshAt = 0;
const KPI_MANUAL_REFRESH_COOLDOWN_MS = 8000;

const el = (id) => document.getElementById(id);
function setTextSafe(id, value) { const node = el(id); if (node) node.textContent = value; return node; }
const clean = (value) => String(value ?? '').trim();
const esc = (value) => clean(value).replace(/[&<>'"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const fmt = (n) => Number(n || 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 });
const coefficientPercent = (value) => `${Math.round(Number(value || 1) * 100)}%`;
const dateVi = (key) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean(key)); return m ? `${m[3]}/${m[2]}/${m[1]}` : clean(key); };
const normalizeDepartment = (value) => clean(value).toUpperCase();

function manualDeadlineDateKey(value) {
  const text = clean(value);
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match) {
    const date = new Date(`${text}T12:00:00+07:00`);
    return Number.isNaN(date.getTime()) ? '' : text;
  }
  match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (!match) return '';
  const day = String(Number(match[1])).padStart(2, '0');
  const month = String(Number(match[2])).padStart(2, '0');
  const key = `${match[3]}-${month}-${day}`;
  const date = new Date(`${key}T12:00:00+07:00`);
  if (Number.isNaN(date.getTime())) return '';
  const [yearValue, monthValue, dayValue] = key.split('-').map(Number);
  if (
    date.getUTCFullYear() !== yearValue
    || date.getUTCMonth() + 1 !== monthValue
    || date.getUTCDate() !== dayValue
  ) return '';
  return key;
}

async function approveRegistrationsWithLegacyRecovery(registrations = []) {
  const selected = (registrations || []).filter(Boolean);
  if (!selected.length) return [];
  const manualDeadlines = {};

  while (true) {
    try {
      return await TaskRegistrationService.approveMany(selected, {
        period: KpiWorkflowState.period,
        manualDeadlines
      });
    } catch (error) {
      if (String(error?.code || '') !== 'LEGACY_MANUAL_DEADLINE_REQUIRED') throw error;

      const code = clean(error?.standardTaskCode || error?.standardTaskId || 'đầu việc');
      const input = await ModalService.prompt(
        `Đăng ký cũ ${code} chưa có Hạn hoàn thành cụ thể. Hãy bổ sung hạn để tiếp tục duyệt.`,
        {
          title: 'Bổ sung hạn hoàn thành',
          label: 'Hạn hoàn thành (DD/MM/YYYY hoặc YYYY-MM-DD)',
          multiline: false,
          placeholder: '25/08/2026',
          required: true,
          confirmText: 'Lưu hạn và tiếp tục'
        }
      );
      if (input === null) return null;

      const key = manualDeadlineDateKey(input);
      if (!key) {
        ModalService.alert('Ngày không hợp lệ. Ví dụ: 25/08/2026.');
        continue;
      }

      const mapKey = clean(error?.registrationId || error?.standardTaskId || error?.standardTaskCode);
      if (!mapKey) throw error;
      manualDeadlines[mapKey] = key;
    }
  }
}

function realtimeTimestampKey(value) {
  if (!value) return '';
  if (typeof value.toMillis === 'function') return String(value.toMillis());
  if (Number.isFinite(Number(value.seconds))) return `${value.seconds}:${value.nanoseconds || 0}`;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? String(parsed) : String(value);
}

function realtimeTaskFingerprint(tasks = []) {
  return [...tasks]
    .map(task => [
      task.id || '',
      realtimeTimestampKey(task.updatedAt),
      task.status || '',
      task.assignmentStatus || '',
      task.ownerUserId || '',
      task.adjustmentStatus || '',
      task.scoringStatus || '',
      task.progress ?? ''
    ].join('|'))
    .sort()
    .join('||');
}

function kpiRouteActive() {
  const route = String(window.location.hash || '');
  return route === '#/reports' || route.startsWith('#/kpi');
}

function stopKpiRealtime() {
  try { stopKpiTaskRealtime?.(); } catch (_) { /* Đóng listener legacy an toàn. */ }
  stopKpiTaskRealtime = null;
  kpiLiveUnsubscribers.forEach(unsubscribe => {
    try { unsubscribe?.(); } catch (_) { /* Đóng listener an toàn. */ }
  });
  kpiLiveUnsubscribers = [];
  if (kpiRealtimeTimer) window.clearTimeout(kpiRealtimeTimer);
  kpiRealtimeTimer = null;
  kpiRealtimePrimed = false;
  kpiRealtimeFingerprint = '';
}

function bindKpiRealtimeCleanup() {
  if (kpiRealtimeCleanupBound) return;
  kpiRealtimeCleanupBound = true;
  document.addEventListener('v3:route-changed', () => {
    if (!kpiRouteActive()) stopKpiRealtime();
  });
}

function scheduleKpiLiveRender() {
  if (!kpiRouteActive()) return;
  if (kpiRealtimeTimer) window.clearTimeout(kpiRealtimeTimer);
  kpiRealtimeTimer = window.setTimeout(function renderWhenReady() {
    if (!kpiRouteActive()) return;
    /* Dữ liệu state được cập nhật ngay, nhưng không phá modal người dùng đang nhập. */
    if (document.querySelector('.modal-backdrop:not(.hidden), .kpi-modal:not(.kpi-hidden)')) {
      kpiRealtimeTimer = window.setTimeout(renderWhenReady, 700);
      return;
    }
    try {
      KpiWorkflowState.common = commonAssessmentForUser(KpiWorkflowState.user?.uid, activeScopeDepartmentId());
      render();
      const state = el('kpiRealtimeState');
      if (state) {
        state.textContent = 'Đã cập nhật trực tiếp';
        state.classList.remove('kpi-hidden');
        state.classList.add('is-live');
      }
    } catch (error) {
      console.warn('Không thể render thay đổi KPI trực tiếp:', error);
    }
  }, 220);
}

function scheduleKpiRealtimeReload() {
  /* Alias tương thích các handler cũ: V1.20 chỉ render từ state, không loadAll lại. */
  scheduleKpiLiveRender();
}

async function manualRefreshKpi() {
  const now = Date.now();
  if (kpiReloadPromise) return kpiReloadPromise;
  if (now - lastManualKpiRefreshAt < KPI_MANUAL_REFRESH_COOLDOWN_MS) return null;

  lastManualKpiRefreshAt = now;
  const button = el('kpiRefresh');
  if (button) button.disabled = true;

  kpiReloadPromise = Promise.resolve(loadAll()).finally(() => {
    kpiReloadPromise = null;
    if (button?.isConnected) button.disabled = false;
  });
  return kpiReloadPromise;
}

function kpiRealtimeScope() {
  const departmentId = activeScopeDepartmentId();
  const allCenterScope = departmentId === 'ALL' && globalRole();
  const fullCenterScope = allCenterScope && fullScopeRole();
  const professionalCenterScope = allCenterScope && !fullScopeRole();
  const cdtnDepartmentScope = departmentId === 'CDTN' && canManageCdtnWorkspace();
  const reportDepartmentScope = departmentId !== 'CDTN' && departmentId !== 'ALL' && KpiWorkflowState.mode === 'reports' && isLeader();
  const managerHomeDepartmentId = profileDepartmentId();
  /*
   * V1.22.2: Trưởng/Phó chỉ được mở rộng VIEW workload của nhân viên thuộc chính đơn vị mình.
   * Đây không phải authority duyệt/chấm; registrations/evaluations vẫn dùng ma trận quyền cũ.
   */
  const managerMonitoringScope = KpiWorkflowState.mode === 'plans'
    && isLeader()
    && managerHomeDepartmentId
    && managerHomeDepartmentId !== 'CDTN'
    && (departmentId === managerHomeDepartmentId || (departmentId === 'ALL' && globalRole()));
  const taskDepartmentScope = departmentId !== 'ALL' && (globalRole() || cdtnDepartmentScope || isDepartmentHead() || reportDepartmentScope
    || hasActiveApprovalDelegation('APPROVE_REGISTRATIONS', departmentId)
    || hasActiveApprovalDelegation('CONFIRM_EVALUATIONS', departmentId)
    || hasActiveApprovalDelegation('LOCK_PLAN', departmentId));
  const registrationDepartmentScope = departmentId !== 'ALL' && (globalRole() || cdtnDepartmentScope || isDepartmentHead() || reportDepartmentScope
    || hasActiveApprovalDelegation('APPROVE_REGISTRATIONS', departmentId));
  const evaluationDepartmentScope = departmentId !== 'ALL' && (globalRole() || cdtnDepartmentScope || isDepartmentHead() || reportDepartmentScope
    || hasActiveApprovalDelegation('CONFIRM_EVALUATIONS', departmentId));
  const combinedDepartmentReportScope = KpiWorkflowState.mode === 'reports'
    && departmentId !== 'ALL' && departmentId !== 'CDTN' && taskDepartmentScope;
  return {
    departmentId,
    fullCenterScope,
    professionalCenterScope,
    cdtnDepartmentScope,
    taskDepartmentScope,
    registrationDepartmentScope,
    evaluationDepartmentScope,
    combinedDepartmentReportScope,
    managerMonitoringScope,
    managerHomeDepartmentId
  };
}

function kpiRealtimeQueries(kind) {
  const periodId = KpiWorkflowState.period?.id;
  if (!periodId || !KpiWorkflowState.user?.uid) return [];
  const scope = kpiRealtimeScope();
  const {
    departmentId,
    fullCenterScope,
    professionalCenterScope,
    taskDepartmentScope,
    registrationDepartmentScope,
    evaluationDepartmentScope,
    combinedDepartmentReportScope,
    managerMonitoringScope,
    managerHomeDepartmentId
  } = scope;
  const col = collection(db, kind);
  const q = (...constraints) => query(col, ...constraints);

  if (kind === 'tasks') {
    if (fullCenterScope) return [q(where('periodId','==',periodId), limit(5000))];
    if (professionalCenterScope) {
      const references = [q(where('periodId','==',periodId), where('primaryDepartmentId','in',PROFESSIONAL_DEPARTMENT_IDS), limit(5000))];
      if (managerMonitoringScope) {
        references.push(q(where('periodId','==',periodId), where('homeDepartmentId','==',managerHomeDepartmentId), limit(2000)));
      }
      return references;
    }
    if (departmentId === 'CDTN' && taskDepartmentScope) return [
      q(where('periodId','==',periodId), where('primaryDepartmentId','==','CDTN'), limit(1000)),
      q(where('periodId','==',periodId), where('organizationId','==','CDTN'), limit(1000))
    ];
    if (combinedDepartmentReportScope || managerMonitoringScope) return [
      q(where('periodId','==',periodId), where('primaryDepartmentId','==',departmentId), limit(2000)),
      q(where('periodId','==',periodId), where('homeDepartmentId','==',departmentId), limit(2000))
    ];
    if (taskDepartmentScope) return [q(where('periodId','==',periodId), where('primaryDepartmentId','==',departmentId), limit(2000))];
    return [q(where('periodId','==',periodId), where('ownerUserId','==',KpiWorkflowState.user.uid), limit(300))];
  }

  if (kind === 'taskRegistrations') {
    if (fullCenterScope) return [q(where('periodId','==',periodId), limit(5000))];
    if (professionalCenterScope) return [q(where('periodId','==',periodId), where('departmentId','in',PROFESSIONAL_DEPARTMENT_IDS), limit(5000))];
    if (departmentId === 'CDTN' && registrationDepartmentScope) return [
      q(where('periodId','==',periodId), where('departmentId','==','CDTN'), limit(1000)),
      q(where('periodId','==',periodId), where('organizationId','==','CDTN'), limit(1000))
    ];
    if (combinedDepartmentReportScope) return [
      q(where('periodId','==',periodId), where('departmentId','==',departmentId), limit(2000)),
      q(where('periodId','==',periodId), where('homeDepartmentId','==',departmentId), limit(2000))
    ];
    if (registrationDepartmentScope) return [q(where('periodId','==',periodId), where('departmentId','==',departmentId), limit(2000))];
    return [q(where('periodId','==',periodId), where('userId','==',KpiWorkflowState.user.uid), limit(300))];
  }

  if (kind === 'taskEvaluations') {
    if (fullCenterScope) return [q(where('periodId','==',periodId), limit(5000))];
    if (professionalCenterScope) return [q(where('periodId','==',periodId), where('departmentId','in',PROFESSIONAL_DEPARTMENT_IDS), limit(5000))];
    if (departmentId === 'CDTN' && evaluationDepartmentScope) return [
      q(where('periodId','==',periodId), where('departmentId','==','CDTN'), limit(1000)),
      q(where('periodId','==',periodId), where('organizationId','==','CDTN'), limit(1000))
    ];
    if (combinedDepartmentReportScope) return [
      q(where('periodId','==',periodId), where('departmentId','==',departmentId), limit(2000)),
      q(where('periodId','==',periodId), where('homeDepartmentId','==',departmentId), limit(2000))
    ];
    if (evaluationDepartmentScope) return [q(where('periodId','==',periodId), where('departmentId','==',departmentId), limit(2000))];
    return [q(where('periodId','==',periodId), where('ownerUserId','==',KpiWorkflowState.user.uid), limit(300))];
  }

  if (kind === 'commonCriteriaAssessments') {
    if (fullCenterScope) return [q(where('periodId','==',periodId), limit(2000))];
    if (professionalCenterScope) return [q(where('periodId','==',periodId), where('departmentId','in',PROFESSIONAL_DEPARTMENT_IDS), limit(2000))];
    if (departmentId !== 'ALL' && departmentId !== 'CDTN' && evaluationDepartmentScope) {
      return [q(where('periodId','==',periodId), where('departmentId','==',departmentId), limit(500))];
    }
    return [q(where('periodId','==',periodId), where('userId','==',KpiWorkflowState.user.uid), limit(10))];
  }
  return [];
}

function subscribeKpiStateCollection(collectionName, stateKey) {
  const queryRefs = kpiRealtimeQueries(collectionName);
  if (!queryRefs.length) return;
  const snapshots = queryRefs.map(() => null);
  queryRefs.forEach((queryRef, index) => {
    const unsubscribe = onSnapshot(queryRef, snapshot => {
      snapshots[index] = new Map(snapshot.docs.map(item => [item.id, { id:item.id, ...item.data() }]));
      if (snapshots.some(item => item === null)) return;
      const merged = new Map();
      snapshots.forEach(map => map.forEach((value,key) => merged.set(key,value)));
      KpiWorkflowState[stateKey] = [...merged.values()];
      if (stateKey === 'commonAll') KpiWorkflowState.common = commonAssessmentForUser(KpiWorkflowState.user.uid, activeScopeDepartmentId());
      scheduleKpiLiveRender();
    }, error => {
      console.warn(`Theo dõi trực tiếp ${collectionName} bị gián đoạn:`, error);
      const state = el('kpiRealtimeState');
      if (state) { state.textContent = 'Đồng bộ trực tiếp tạm gián đoạn'; state.classList.remove('is-live'); }
    });
    kpiLiveUnsubscribers.push(unsubscribe);
  });
}

function startKpiRealtime() {
  stopKpiRealtime();
  bindKpiRealtimeCleanup();
  if (!KpiWorkflowState.period || !kpiRouteActive()) return;

  subscribeKpiStateCollection('tasks', 'tasks');
  subscribeKpiStateCollection('taskRegistrations', 'registrations');
  subscribeKpiStateCollection('taskEvaluations', 'evaluations');
  subscribeKpiStateCollection('commonCriteriaAssessments', 'commonAll');

  const state = el('kpiRealtimeState');
  if (state) {
    state.textContent = 'Đang đồng bộ trực tiếp';
    state.classList.remove('kpi-hidden');
    state.classList.add('is-live');
  }
}

function assessmentRate(value, label) {
  const rate = Number(value);
  if (![0, 60, 80, 100].includes(rate)) {
    throw new Error(`${label} chỉ được chọn một trong bốn mức 100%, 80%, 60% hoặc 0%.`);
  }
  return rate;
}

function appendixRateOptions(selected) {
  const current = Number(selected);
  return [
    [100, '100% — Hoàn thành đầy đủ yêu cầu'],
    [80, '80% — Hoàn thành phần lớn yêu cầu'],
    [60, '60% — Hoàn thành một phần/yêu cầu cơ bản'],
    [0, '0% — Không đạt yêu cầu']
  ].map(([value, label]) => `<option value="${value}" ${current === value ? 'selected' : ''}>${label}</option>`).join('');
}

function milestoneTimingText(detail = {}) {
  if (!detail.completed) {
    return detail.dueNow ? 'Quá hạn/chưa hoàn thành' : 'Chưa đến hạn';
  }
  if (Number(detail.dayDelta) === 0) return 'Đúng hạn';
  if (Number(detail.dayDelta) < 0) return `Sớm ${Math.abs(Number(detail.dayDelta))} ngày`;
  return `Trễ ${Number(detail.dayDelta)} ngày`;
}

function milestoneStatusClass(detail = {}) {
  if (!detail.included) return 'is-pending';
  if (!detail.completed) return 'is-overdue';
  if (Number(detail.rate) === 100) return 'is-good';
  if (Number(detail.rate) === 80) return 'is-warning';
  if (Number(detail.rate) === 60) return 'is-warning-strong';
  return 'is-bad';
}

function milestoneDetailsHtml(summary) {
  const details = Array.isArray(summary?.details) ? summary.details : [];
  if (!details.length) return '';
  return `<details class="kpi-milestone-details"><summary>Xem chi tiết cách tính</summary><div class="kpi-milestone-detail-list">${details.map((detail, index) => {
    const completedText = detail.completedDateKey ? dateVi(detail.completedDateKey) : 'Chưa hoàn thành';
    const scoreText = detail.included ? `${Number(detail.rate || 0)}%` : 'Chưa tính';
    const inclusionText = detail.included
      ? (detail.completed && !detail.dueNow ? 'Đã hoàn thành sớm nên được tính ngay' : 'Đang tính')
      : 'Chưa đến hạn và chưa hoàn thành';
    return `<div class="kpi-milestone-detail ${milestoneStatusClass(detail)}"><div class="kpi-milestone-detail-index">${index + 1}</div><div class="kpi-milestone-detail-main"><strong>Mốc ${dateVi(detail.dueDateKey)}</strong><span>Hoàn thành: ${esc(completedText)} · ${esc(milestoneTimingText(detail))}</span><small>${esc(inclusionText)}</small></div><div class="kpi-milestone-detail-score">${scoreText}</div></div>`;
  }).join('')}</div></details>`;
}
const normalizeUserRecord = (data = {}, documentId = '') => {
  const id = clean(documentId || data.id || data.uid);
  return {
    ...data,
    id,
    uid: id,
    email: clean(data.email).toLowerCase(),
    role: clean(data.role).toUpperCase(),
    departmentId: normalizeDepartment(data.departmentId),
    position: clean(data.position),
    leaderLevel: clean(data.leaderLevel).toUpperCase(),
    additionalRoles: Array.isArray(data.additionalRoles) ? data.additionalRoles.map(role => clean(role).toUpperCase()) : [],
    cdtnRole: clean(data.cdtnRole).toUpperCase(),
    cdtnRoleLabel: clean(data.cdtnRoleLabel),
    active: data.active === true
  };
};
const activeRole = (...roles) => KpiWorkflowState.profile?.active === true && roles.includes(KpiWorkflowState.profile?.role);
const globalRole = () => Permissions.canViewAllDepartments();
const fullScopeRole = () => Permissions.canViewAllScopes();
const PROFESSIONAL_DEPARTMENT_IDS = Object.freeze(['BGD', 'TCHC', 'CTXH', 'KHTC', 'YT', 'KI', 'KII', 'KIII']);
const isLeader = () => Permissions.isDepartmentLeader();
const isStaff = () => Permissions.isStaff();
const isDeputyLeader = () => Permissions.isDepartmentDeputy();
const isDepartmentHead = () => Permissions.isDepartmentHead();
const profileDepartmentId = () => normalizeDepartment(KpiWorkflowState.profile?.departmentId);
const todayKey = () => new Date().toISOString().slice(0, 10);
const mobileKpiViewport = () => window.matchMedia?.('(max-width: 700px)')?.matches === true;
const directorMobileScope = () => Permissions.isDirector() && mobileKpiViewport();

function taskScopeDepartmentId(task) {
  const organizationId = normalizeDepartment(task?.organizationId);
  const standardDepartmentId = normalizeDepartment(task?.standardTaskDepartmentId);
  const primaryDepartmentId = normalizeDepartment(task?.primaryDepartmentId || task?.departmentId);
  const taskCode = normalizeDepartment(task?.taskCode || task?.standardTaskCode);
  if (organizationId === 'CDTN' || standardDepartmentId === 'CDTN' || primaryDepartmentId === 'CDTN' || taskCode.startsWith('CDTN')) return 'CDTN';
  return primaryDepartmentId;
}

function commonAssessmentId(periodId, userId) {
  /* Mỗi cá nhân chỉ có một bộ tiêu chí chung 30 điểm trong kỳ. */
  return `${periodId}_${userId}`;
}

function commonAssessmentForUser(userId) {
  const user = KpiWorkflowState.users.find(item => item.id === userId || item.uid === userId);
  const homeDepartmentId = normalizeDepartment(
    user?.departmentId || (userId === KpiWorkflowState.user?.uid ? profileDepartmentId() : '')
  );
  const exact = KpiWorkflowState.commonAll.find(item =>
    item.userId === userId
    && normalizeDepartment(item.departmentId) === homeDepartmentId
    && normalizeDepartment(item.departmentId) !== 'CDTN'
  );
  if (exact) return exact;
  /* Tương thích dữ liệu cũ thiếu departmentId, nhưng không dùng bộ CDTN để tạo xếp loại thứ hai. */
  return KpiWorkflowState.commonAll.find(item =>
    item.userId === userId && normalizeDepartment(item.departmentId) !== 'CDTN'
  ) || null;
}

function mergeSnapshotDocs(snapshots = []) {
  const docsById = new Map();
  snapshots.forEach(snapshot => snapshot?.docs?.forEach(item => docsById.set(item.id, item)));
  return { docs: [...docsById.values()] };
}

async function mergeAvailableSnapshotRequests(requests = [], label = 'dữ liệu') {
  const results = await Promise.allSettled(requests);
  const snapshots = [];
  let firstError = null;

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      snapshots.push(result.value);
      return;
    }
    if (!firstError) firstError = result.reason;
    console.warn(`Không tải được nhánh ${index + 1} của ${label}; tiếp tục với nhánh còn lại:`, result.reason);
  });

  if (!snapshots.length) {
    throw firstError || new Error(`Không tải được ${label}.`);
  }

  return mergeSnapshotDocs(snapshots);
}

function delegationDepartmentId(delegation) {
  return normalizeDepartment(delegation?.departmentId || delegation?.organizationId);
}

function delegationAllows(delegation, permissionName) {
  if (!delegation || delegation.active !== true) return false;
  if (delegation.delegateUserId !== KpiWorkflowState.user?.uid) return false;

  const departmentId = delegationDepartmentId(delegation);
  if (departmentId === 'CDTN') {
    if (!Permissions.isCdtnMember()) return false;
  } else if (departmentId !== profileDepartmentId()) {
    return false;
  }

  const today = todayKey();
  if (delegation.startDate && delegation.startDate > today) return false;
  if (delegation.endDate && delegation.endDate < today) return false;
  const permissions = Array.isArray(delegation.permissions) ? delegation.permissions : [];
  if (permissions.includes(permissionName)) return true;
  return permissions.length === 0 && permissionName === 'APPROVE_REGISTRATIONS';
}

function hasActiveApprovalDelegation(permissionName = 'APPROVE_REGISTRATIONS', departmentId = '') {
  const targetDepartmentId = normalizeDepartment(departmentId);
  return KpiWorkflowState.delegations.some(item => {
    if (targetDepartmentId && delegationDepartmentId(item) !== targetDepartmentId) return false;
    return delegationAllows(item, permissionName);
  });
}

function canManageCdtnWorkspace() {
  return Permissions.isCdtnSecretary()
    || hasActiveApprovalDelegation('APPROVE_REGISTRATIONS', 'CDTN')
    || hasActiveApprovalDelegation('CONFIRM_EVALUATIONS', 'CDTN')
    || hasActiveApprovalDelegation('LOCK_PLAN', 'CDTN');
}

function activeScopeDepartmentId() {
  const selected = normalizeDepartment(KpiWorkflowState.scopeDepartmentId);
  if (selected === 'CDTN') {
    if (fullScopeRole() || Permissions.isCdtnMember()) return 'CDTN';
    return globalRole() ? 'ALL' : profileDepartmentId();
  }
  if (globalRole()) return selected || 'ALL';
  return profileDepartmentId();
}

function isCdtnScope() {
  return activeScopeDepartmentId() === 'CDTN';
}

function sameDepartment(data) {
  const departmentId = data?.primaryDepartmentId || data?.organizationId || data?.standardTaskDepartmentId
    ? taskScopeDepartmentId(data)
    : normalizeDepartment(data?.departmentId);
  return departmentId === activeScopeDepartmentId();
}

/* Quyền duyệt phải theo phòng của hồ sơ người dùng, không theo phạm vi đang xem (có thể là ALL). */
function registrationInApproverDepartment(registration) {
  const departmentId = normalizeDepartment(registration?.departmentId);
  if (!departmentId) return false;
  if (departmentId === 'CDTN') return true;
  return departmentId === profileDepartmentId();
}

function departmentHasActiveHead(departmentId) {
  const target = normalizeDepartment(departmentId);
  if (!target || target === 'CDTN' || target === 'BGD') return false;
  return KpiWorkflowState.users.some(user => (
    user?.active === true
    && normalizeDepartment(user.departmentId) === target
    && Permissions.isDepartmentHead(user)
  ));
}

function directorApprovalAvailable(permissionName = 'APPROVE_REGISTRATIONS') {
  return Permissions.isDirectorHead()
    || (Permissions.isDirectorDeputy() && hasActiveApprovalDelegation(permissionName, 'BGD'));
}

function canApproveRegistration(registration) {
  if (!registration || registration.status !== 'PENDING') return false;

  const registrationDepartmentId = normalizeDepartment(registration.departmentId);
  if (registrationDepartmentId === 'CDTN') {
    const directAuthority = Permissions.isCdtnSecretary();
    const delegated = hasActiveApprovalDelegation('APPROVE_REGISTRATIONS', 'CDTN');
    return Boolean(
      registrationInApproverDepartment(registration)
      && (directAuthority || delegated)
      && (directAuthority || registration.userId !== KpiWorkflowState.user.uid)
    );
  }

  const ownerProfile = {
    uid: registration.userId,
    active: true,
    role: registration.userRole,
    position: registration.userPosition,
    leaderLevel: registration.userLeaderLevel,
    approvalAuthority: registration.userApprovalAuthority,
    isDepartmentHead: registration.userIsDepartmentHead,
    departmentId: registrationDepartmentId
  };
  const ownerIsHead = Permissions.isDepartmentHead(ownerProfile);
  const ownerIsDeputy = Permissions.isDepartmentDeputy(ownerProfile);
  const directorFallback = directorApprovalAvailable('APPROVE_REGISTRATIONS')
    && registration.userId !== KpiWorkflowState.user.uid
    && ownerIsHead;
  if (directorFallback) return true;

  const delegated = hasActiveApprovalDelegation('APPROVE_REGISTRATIONS', profileDepartmentId());
  if (ownerIsHead) return false;
  if (ownerIsDeputy) {
    return Permissions.canApproveRegistrationForDepartment(registrationDepartmentId, delegated)
      && registrationInApproverDepartment(registration)
      && registration.userId !== KpiWorkflowState.user.uid;
  }
  return Permissions.canApproveRegistrationForDepartment(registrationDepartmentId, delegated)
    && registrationInApproverDepartment(registration)
    && registration.userId !== KpiWorkflowState.user.uid;
}

function canViewDepartmentData() {
  const reportScope = KpiWorkflowState.mode === 'reports' && isLeader();
  if (isCdtnScope()) {
    return fullScopeRole()
      || Permissions.isCdtnLeadership()
      || hasActiveApprovalDelegation('APPROVE_REGISTRATIONS', 'CDTN')
      || hasActiveApprovalDelegation('CONFIRM_EVALUATIONS', 'CDTN')
      || hasActiveApprovalDelegation('LOCK_PLAN', 'CDTN');
  }
  return globalRole()
    || isDepartmentHead()
    || reportScope
    || hasActiveApprovalDelegation('APPROVE_REGISTRATIONS', profileDepartmentId())
    || hasActiveApprovalDelegation('CONFIRM_EVALUATIONS', profileDepartmentId())
    || hasActiveApprovalDelegation('LOCK_PLAN', profileDepartmentId());
}

function canViewDepartmentReport() {
  if (isCdtnScope()) {
    return Permissions.canViewCdtnAggregateReport(
      hasActiveApprovalDelegation('CONFIRM_EVALUATIONS', 'CDTN')
        || hasActiveApprovalDelegation('APPROVE_REGISTRATIONS', 'CDTN')
    );
  }
  return Permissions.canViewDepartmentReport();
}

function planManagementDepartmentId() {
  if (isCdtnScope()) return 'CDTN';
  // V1.21.1: Trưởng/Phụ trách khóa đúng Phòng/Khu của mình, kể cả khi đang xem Toàn Trung tâm.
  if (isDepartmentHead()) return profileDepartmentId();
  if (!globalRole()) return profileDepartmentId();
  return activeScopeDepartmentId();
}

function canLockPlan() {
  if (isCdtnScope()) {
    return Permissions.isAdmin()
      || Permissions.isCdtnLeadership()
      || hasActiveApprovalDelegation('LOCK_PLAN', 'CDTN');
  }
  return Permissions.canLockDepartmentPlan(
    hasActiveApprovalDelegation('LOCK_PLAN', profileDepartmentId())
  );
}

function canConfirmEvaluations() {
  if (isCdtnScope()) {
    return Permissions.isCdtnSecretary()
      || hasActiveApprovalDelegation('CONFIRM_EVALUATIONS', 'CDTN')
      || directorApprovalAvailable('CONFIRM_EVALUATIONS');
  }
  return Permissions.canConfirmEvaluations(
    hasActiveApprovalDelegation('CONFIRM_EVALUATIONS', profileDepartmentId())
  );
}

function canApproveDepartmentPlanTask(task) {
  const hasPermission = isCdtnScope()
    ? Permissions.canApproveCdtnRegistrations(
      hasActiveApprovalDelegation('APPROVE_REGISTRATIONS', 'CDTN')
    )
    : Permissions.canApproveStaffRegistrations(
      hasActiveApprovalDelegation('APPROVE_REGISTRATIONS', profileDepartmentId())
    );
  return Boolean(
    task &&
    hasPermission &&
    sameDepartment(task) &&
    KpiWorkflowState.plan?.locked !== true
  );
}

function canCancelRegistrationAsManager(registration) {
  return Permissions.canCancelRegistrationForEmployee(
    registration,
    KpiWorkflowState.plan?.locked === true,
    hasActiveApprovalDelegation('APPROVE_REGISTRATIONS')
  );
}

function mount() {
  const section = el('kpiSection');
  if (!section) return;
  const mode = KpiWorkflowState.mode || 'plans';
  const heading = mode === 'evaluations' ? 'Đánh giá và xác nhận kết quả' : mode === 'reports' ? 'Báo cáo đánh giá' : 'Kế hoạch KPI';
  const description = mode === 'evaluations' ? 'Tự đánh giá nhiệm vụ hoàn thành và xác nhận kết quả.' : mode === 'reports' ? 'Báo cáo cá nhân và báo cáo tổng hợp theo đúng phạm vi.' : 'Đăng ký, duyệt và quản lý kế hoạch công việc trong kỳ.';
  section.innerHTML = `
    <div class="kpi-header">
      <div>
        <h2>${heading}</h2>
        <p>${description}</p>
        <div id="kpiPeriodLine" class="kpi-period-line"></div>
      </div>
      <div class="kpi-actions kpi-no-print">
        <div class="kpi-header-sync"><small id="kpiRealtimeState" class="realtime-state kpi-hidden"></small><button id="kpiRefresh" class="kpi-button secondary kpi-icon-sync" type="button" title="Cập nhật dữ liệu" aria-label="Cập nhật dữ liệu">↻</button></div>
      </div>
    </div>
    <div id="kpiMessage"></div>
    <div class="kpi-metrics">
      <div class="kpi-metric kpi-metric-plan"><span>Điểm kế hoạch</span><strong id="kpiMetricA">0</strong><small>Tổng điểm nhiệm vụ</small></div>
      <div class="kpi-metric kpi-metric-actual"><span>Điểm thực hiện</span><strong id="kpiMetricB">0</strong><small>Điểm đạt được</small></div>
      <div class="kpi-metric kpi-metric-work"><span>Điểm công việc</span><strong id="kpiMetric70">0/70</strong><small id="kpiMetricBonus">Chưa có điểm thưởng</small></div>
      <div class="kpi-metric kpi-metric-common"><span>Điểm tiêu chí chung</span><strong id="kpiMetric30">0/30</strong><small>Tự đánh giá hoặc xác nhận</small></div>
      <div class="kpi-metric kpi-metric-total"><span>Tổng điểm đánh giá</span><strong id="kpiMetric100">0/100</strong><small>Kết quả hiện tại</small></div>
    </div>
    <div id="kpiScoreState" class="kpi-score-state kpi-hidden" aria-live="polite"></div>
    <div id="kpiManagementToolbar" class="kpi-toolbar kpi-management-toolbar kpi-no-print kpi-hidden"></div>
    <div class="kpi-grid kpi-grid-single" data-mode-grid>
      <section class="kpi-card">
        <h3 id="kpiMainCardTitle">Nhiệm vụ trong kỳ</h3>
        <p id="kpiMainCardHint" class="kpi-small">Tổng hợp theo từng người; chọn Chi tiết để xem đầu việc và kết quả.</p>
        <div id="kpiTaskList"></div>
      </section>
      <div id="kpiReviewList" class="kpi-hidden"></div>
    </div>
    <section id="kpiAdminBox" class="kpi-card kpi-admin-danger kpi-hidden kpi-no-print">
      <h3>Lưu trữ và dọn dữ liệu kỳ đánh giá</h3>
      <p>Hệ thống lưu toàn bộ hồ sơ kỳ thành tệp JSON trên Google Drive, kiểm tra mã SHA-256, sau đó mới xóa dữ liệu vận hành khỏi Firestore. Minh chứng trên Drive được giữ nguyên.</p>
      <div class="kpi-actions">
        <button id="kpiDeletePeriod" class="kpi-button danger" type="button">Lưu Drive và dọn Firestore</button>
      </div>
    </section>`;
  wireEvents();
  section.dataset.kpiMode = mode;
}

function scopeSwitchHtml(options, selectedScope) {
  const mobileOptions = directorMobileScope() ? options.filter(option => option.value !== 'ALL') : options;
  return `<div class="kpi-scope-switch" role="group" aria-label="Chọn phạm vi KPI">
    <span class="kpi-scope-switch-label">Phạm vi</span>
    ${directorMobileScope() ? `<label class="kpi-mobile-scope-select"><span>Chọn Phòng/Khu</span><select id="kpiMobileScopeSelect">${mobileOptions.map(option => `<option value="${esc(option.value)}" ${selectedScope === option.value ? 'selected' : ''}>${esc(option.label)}</option>`).join('')}</select></label>` : ''}
    <div class="kpi-scope-switch-options">${options.map(option => `<button type="button" role="tab" class="kpi-scope-option ${selectedScope === option.value ? 'is-active' : ''}" aria-selected="${selectedScope === option.value ? 'true' : 'false'}" data-kpi-scope="${esc(option.value)}"><span>${option.value === 'CDTN' ? '🌿' : option.value === 'ALL' ? '🏢' : '📁'}</span><strong>${esc(option.label)}</strong></button>`).join('')}</div>
  </div>`;
}

function renderManagementToolbar() {
  const toolbar = el('kpiManagementToolbar');
  if (!toolbar) return;
  const mode = KpiWorkflowState.mode || 'plans';
  const parts = [];
  const selectedScope = activeScopeDepartmentId();

  if (globalRole()) {
    const departments = [...new Set([
      ...KpiWorkflowState.users.map(user => normalizeDepartment(user.departmentId)),
      ...KpiWorkflowState.tasks.map(task => taskScopeDepartmentId(task)),
      ...KpiWorkflowState.registrations.map(item => normalizeDepartment(item.departmentId))
    ].filter(Boolean))].sort();
    if (fullScopeRole() && !departments.includes('CDTN') && KpiWorkflowState.tasks.some(task => taskScopeDepartmentId(task) === 'CDTN')) departments.push('CDTN');
    if (Permissions.isCdtnMember() && !departments.includes('CDTN')) departments.push('CDTN');
    parts.push(scopeSwitchHtml([
      { value: 'ALL', label: 'Toàn Trung tâm' },
      ...departments.map(departmentId => ({ value: departmentId, label: departmentDisplayName(departmentId) }))
    ], selectedScope));
  } else if (Permissions.isCdtnMember()) {
    const options = [
      { value: profileDepartmentId(), label: departmentDisplayName(profileDepartmentId()) },
      { value: 'CDTN', label: 'Chi đoàn Trung tâm' }
    ];
    parts.push(scopeSwitchHtml(options, selectedScope));
  }

  if (
    mode === 'plans'
    && Permissions.canViewOwnKpi()
    && KpiWorkflowState.period?.status !== 'COMPLETED'
    && KpiWorkflowState.common?.status !== 'CONFIRMED'
    && !isCdtnScope()
  ) {
    parts.push('<button id="kpiCommonButton" class="kpi-button secondary" type="button">✍️ Tự đánh giá tiêu chí chung</button>');
  }

  if (KpiWorkflowState.period && mode !== 'reports') {
    if (canLockPlan()) {
      if (KpiWorkflowState.plan?.locked === true) {
        parts.push('<button id="kpiUnlockPlan" class="kpi-button secondary" type="button">🔓 Mở lại đăng ký</button>');
      } else {
        parts.push('<button id="kpiLockPlan" class="kpi-button secondary" type="button">🔒 Khóa đăng ký kế hoạch</button>');
      }
    }
    if (!isCdtnScope() && Permissions.canDelegateApproval()) {
      parts.push('<button id="kpiDelegateApproval" class="kpi-button secondary" type="button">👥 Ủy quyền duyệt</button>');
    }
  }

  if (Permissions.canManageEvaluationPeriods() && mode !== 'reports') {
    parts.push('<button id="kpiPeriodAdmin" class="kpi-button secondary" type="button">⚙️ Quản lý kỳ</button>');
  }

  const status = KpiWorkflowState.period && mode !== 'reports'
    ? `<span class="kpi-plan-state ${KpiWorkflowState.plan?.locked === true ? 'is-locked' : 'is-open'}">${KpiWorkflowState.plan?.locked === true ? 'Đã khóa' : 'Mở đăng ký'}</span>`
    : '';
  const scopeParts = parts.filter(part => part.includes('kpi-scope-switch'));
  const actionParts = parts.filter(part => !part.includes('kpi-scope-switch'));
  toolbar.innerHTML = `${(status || scopeParts.length) ? `<div class="kpi-management-context">${status}${scopeParts.join('')}</div>` : ''}${actionParts.length ? `<div class="kpi-management-actions">${actionParts.join('')}</div>` : ''}`;
  toolbar.classList.toggle('kpi-hidden', !toolbar.innerHTML.trim());

  toolbar.querySelectorAll('[data-kpi-scope]').forEach(button => button.addEventListener('click', async () => {
    const nextScope = button.dataset.kpiScope || (globalRole() ? 'ALL' : profileDepartmentId());
    if (nextScope === activeScopeDepartmentId()) return;
    stopKpiRealtime();
    KpiWorkflowState.scopeDepartmentId = nextScope;
    KpiWorkflowState.tasks = [];
    KpiWorkflowState.registrations = [];
    KpiWorkflowState.evaluations = [];
    KpiWorkflowState.commonAll = [];
    message(`Đang tải phạm vi ${departmentDisplayName(nextScope)}...`);
    await loadAll();
    startKpiRealtime();
  }));
  toolbar.querySelector('#kpiMobileScopeSelect')?.addEventListener('change', async event => {
    const nextScope = normalizeDepartment(event.currentTarget.value);
    if (!nextScope || nextScope === 'ALL' || nextScope === activeScopeDepartmentId()) return;
    stopKpiRealtime();
    KpiWorkflowState.scopeDepartmentId = nextScope;
    KpiWorkflowState.tasks = [];
    KpiWorkflowState.registrations = [];
    KpiWorkflowState.evaluations = [];
    KpiWorkflowState.commonAll = [];
    message(`Đang tải phạm vi ${departmentDisplayName(nextScope)}...`);
    await loadAll();
    startKpiRealtime();
  });
  el('kpiCommonButton')?.addEventListener('click', openCommonCriteria);
  el('kpiLockPlan')?.addEventListener('click', lockDepartmentPlan);
  el('kpiDelegateApproval')?.addEventListener('click', openDelegationManager);
  el('kpiUnlockPlan')?.addEventListener('click', unlockDepartmentPlan);
  el('kpiPeriodAdmin')?.addEventListener('click', openPeriodManager);
}

function departmentDisplayName(departmentId) {
  return ({
    BGD: 'Ban Giám đốc',
    TCHC: 'Phòng Tổ chức - Hành chính',
    CTXH: 'Phòng Công tác xã hội',
    KHTC: 'Phòng Kế hoạch - Tài chính',
    YT: 'Phòng Y tế',
    KI: 'Khu I',
    KII: 'Khu II',
    KIII: 'Khu III',
    CDTN: 'Chi đoàn Trung tâm'
  })[normalizeDepartment(departmentId)] || departmentId || 'Phòng/Khu';
}

function message(text, type='info') {
  const box = el('kpiMessage');
  if (!box) return;
  box.className = text ? `kpi-alert ${type === 'ok' ? 'kpi-ok' : ''}` : '';
  box.textContent = text || '';
}

function modal(title, body, footer='') {
  closeModal();
  const node = document.createElement('div');
  node.id = 'kpiModalRoot';
  node.className = 'kpi-modal-backdrop';
  node.innerHTML = `<section class="kpi-modal" role="dialog" aria-modal="true">
    <header class="kpi-modal-head"><h2>${esc(title)}</h2><button class="kpi-button secondary" data-kpi-close type="button">×</button></header>
    <div class="kpi-modal-body">${body}</div>
    <footer class="kpi-modal-foot">${footer || '<button class="kpi-button secondary" data-kpi-close type="button">Đóng</button>'}</footer>
  </section>`;
  document.body.appendChild(node);
  node.addEventListener('click', (event) => {
    if (event.target === node || event.target.closest('[data-kpi-close]')) closeModal();
  });
  return node;
}
function closeModal(){ el('kpiModalRoot')?.remove(); }

function wireEvents() {
  el('kpiRefresh')?.addEventListener('click', manualRefreshKpi);
  el('kpiInitPilot')?.addEventListener('click', initializePilotPeriod);
  el('kpiCompletePeriod')?.addEventListener('click', completePeriod);
  el('kpiDeletePeriod')?.addEventListener('click', deletePeriodData);
  el('kpiTaskList')?.addEventListener('click', taskAction);
  el('kpiReviewList')?.addEventListener('click', reviewAction);
}


function periodStatusLabel(period) {
  if (period?.active === true) return 'Đang hoạt động';
  if (period?.status === 'COMPLETED') return 'Đã kết thúc';
  if (period?.status === 'PURGED') return 'Đã lưu Drive và dọn dữ liệu';
  if (period?.status === 'DRAFT') return 'Bản nháp';
  return period?.status || 'Không xác định';
}

function openPeriodManager() {
  if (!Permissions.canManageEvaluationPeriods()) return;
  const rows = [...KpiWorkflowState.periods]
    .sort((a,b) => clean(b.startDate).localeCompare(clean(a.startDate)))
    .map(period => `<tr>
      <td><strong>${esc(period.id)}</strong><br><span class="kpi-small">${esc(period.name || '')}</span></td>
      <td>${dateVi(period.startDate)}<br>${dateVi(period.endDate)}</td>
      <td><span class="kpi-status">${esc(periodStatusLabel(period))}</span></td>
      <td><div class="kpi-actions">
        ${period.status==='PURGED'?'':`<button class="kpi-button secondary" type="button" data-period-edit="${esc(period.id)}">Sửa</button>`}
        ${period.active === true ? `<button class="kpi-button danger" type="button" data-period-complete="${esc(period.id)}">Kết thúc</button>` : !['COMPLETED','PURGED'].includes(period.status) ? `<button class="kpi-button" type="button" data-period-activate="${esc(period.id)}">Kích hoạt</button>` : ''}
        ${activeRole('ADMIN') && period.status === 'COMPLETED' ? `<button class="kpi-button warning" type="button" data-period-reopen="${esc(period.id)}">Mở lại để điều chỉnh</button>` : ''}
      </div></td>
    </tr>`).join('');
  const root = modal('Quản lý kỳ đánh giá', `
    <div class="period-manager-head"><div><p class="kpi-small">Chỉ một kỳ được hoạt động tại một thời điểm.</p></div><button id="periodCreateNew" class="kpi-button" type="button">＋ Tạo kỳ mới</button></div>
    ${rows ? `<div class="kpi-table-wrap"><table class="kpi-table period-table"><thead><tr><th>Kỳ</th><th>Thời gian</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="kpi-empty">Chưa có kỳ đánh giá.</div>'}
  `);
  root.querySelector('#periodCreateNew')?.addEventListener('click', () => { closeModal(); initializePilotPeriod(); });
  root.addEventListener('click', async event => {
    const edit = event.target.closest('[data-period-edit]');
    const activate = event.target.closest('[data-period-activate]');
    const complete = event.target.closest('[data-period-complete]');
    const reopen = event.target.closest('[data-period-reopen]');
    if (edit) return openEditPeriod(edit.dataset.periodEdit);
    if (activate) return activatePeriod(activate.dataset.periodActivate);
    if (complete) return completePeriodById(complete.dataset.periodComplete);
    if (reopen) return reopenPeriodForCorrection(reopen.dataset.periodReopen);
  });
}

function openEditPeriod(periodId) {
  const period = KpiWorkflowState.periods.find(item => item.id === periodId);
  if (!period || !Permissions.canManageEvaluationPeriods()) return;
  modal('Sửa kỳ đánh giá', `<form class="kpi-form-grid">
    <div class="kpi-field"><label>Mã kỳ</label><input value="${esc(period.id)}" disabled></div>
    <div class="kpi-field"><label>Tên kỳ</label><input id="editPeriodName" value="${esc(period.name || '')}" required></div>
    <div class="kpi-field"><label>Từ ngày</label><input id="editPeriodStart" type="date" value="${esc(period.startDate || '')}" required></div>
    <div class="kpi-field"><label>Đến ngày</label><input id="editPeriodEnd" type="date" value="${esc(period.endDate || '')}" required></div>
  </form>`, '<button class="kpi-button secondary" data-kpi-close type="button">Hủy</button><button id="savePeriodEdit" class="kpi-button" type="button">Lưu thay đổi</button>');
  el('savePeriodEdit')?.addEventListener('click', async () => {
    const name = clean(el('editPeriodName').value);
    const startDate = clean(el('editPeriodStart').value);
    const endDate = clean(el('editPeriodEnd').value);
    if (!name || !startDate || !endDate || startDate > endDate) return ModalService.alert('Thông tin kỳ chưa hợp lệ.');
    await updateDoc(doc(db,'evaluationPeriods',periodId), { name, startDate, endDate, updatedAt:serverTimestamp(), updatedByUserId:KpiWorkflowState.user.uid });
    PeriodReadService.invalidate();
    await audit('UPDATE_PERIOD',{periodId,startDate,endDate});
    closeModal(); await loadAll(); openPeriodManager();
  });
}

async function activatePeriod(periodId) {
  if (!Permissions.canManageEvaluationPeriods()) return;
  if (KpiWorkflowState.periods.some(period => period.active === true && period.id !== periodId)) return ModalService.alert('Đang có một kỳ hoạt động. Hãy kết thúc kỳ đó trước.');
  await updateDoc(doc(db,'evaluationPeriods',periodId), { active:true, status:'ACTIVE', activatedAt:serverTimestamp(), activatedByUserId:KpiWorkflowState.user.uid, updatedAt:serverTimestamp() });
  PeriodReadService.invalidate();
  await audit('ACTIVATE_PERIOD',{periodId});
  closeModal(); await loadAll(); openPeriodManager();
}

async function reopenPeriodForCorrection(periodId) {
  if (!activeRole('ADMIN')) return ModalService.alert('Chỉ ADMIN được mở lại kỳ đã kết thúc để sửa sai.');
  const period = KpiWorkflowState.periods.find(item => item.id === periodId);
  if (!period || period.status !== 'COMPLETED' || period.active === true) return ModalService.alert('Chỉ kỳ đã kết thúc mới được mở lại theo luồng sửa sai.');
  if (KpiWorkflowState.periods.some(item => item.active === true && item.id !== periodId)) {
    return ModalService.alert('Đang có một kỳ khác hoạt động. Hãy kết thúc kỳ đó trước khi mở lại kỳ cũ.');
  }
  const archiveSnap = await getDoc(doc(db, 'periodArchives', periodId));
  if (archiveSnap.exists()) {
    return ModalService.alert('Kỳ này đã có hồ sơ lưu trữ chính thức. Không được mở lại hoặc sửa trực tiếp dữ liệu đã archive.');
  }
  const reason = clean(await ModalService.prompt('Nhập lý do mở lại kỳ để điều chỉnh. Thao tác sẽ được ghi nhật ký.', { title:'Mở lại kỳ để điều chỉnh', confirmText:'Mở lại kỳ' }));
  if (!reason) return;
  if (!await ModalService.confirm(`Mở lại kỳ ${periodId} để xử lý sửa sai? Sau khi điều chỉnh phải thực hiện quy trình xác nhận và Kết thúc kỳ lại.`, { title:'Xác nhận mở lại kỳ', confirmText:'Mở lại', danger:true })) return;
  await updateDoc(doc(db,'evaluationPeriods',periodId), {
    active:true, status:'ACTIVE',
    reopenedForCorrectionAt:serverTimestamp(),
    reopenedForCorrectionByUserId:KpiWorkflowState.user.uid,
    reopenedForCorrectionByName:KpiWorkflowState.profile?.fullName || KpiWorkflowState.user?.email || '',
    reopenedForCorrectionReason:reason,
    previousCompletedAt:period.completedAt || null,
    updatedAt:serverTimestamp()
  });
  PeriodReadService.invalidate();
  await audit('REOPEN_PERIOD_FOR_ADMIN_CORRECTION',{ periodId, reason });
  closeModal();
  await loadAll();
  openPeriodManager();
}

async function completePeriodById(periodId) {
  if (!Permissions.canManageEvaluationPeriods()) return;
  if (KpiWorkflowState.period?.id !== periodId || KpiWorkflowState.period?.active !== true) {
    ModalService.alert('Chỉ có thể kết thúc kỳ đang hoạt động.');
    return;
  }
  closeModal();
  await completePeriod();
}

async function readProfile(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? normalizeUserRecord(snap.data(), snap.id) : null;
}

async function loadCdtnUsers() {
  const snapshot = await getDocs(
    query(collection(db, 'cdtnMembers'), where('active', '==', true), limit(300))
  );
  const users = snapshot.docs
    .map(item => normalizeUserRecord(item.data(), item.id))
    .filter(user => user.active === true)
    .sort((a, b) => clean(a.fullName).localeCompare(clean(b.fullName), 'vi'));
  if (!users.length && Permissions.isCdtnMember()) {
    const self = normalizeUserRecord(KpiWorkflowState.profile, KpiWorkflowState.user?.uid);
    if (self.active === true) users.push(self);
  }
  return users;
}

async function loadAll() {
  if (!KpiWorkflowState.user || !KpiWorkflowState.profile) return;
  try {
    message('Đang tải dữ liệu đánh giá...');
    const canBrowseCompletedPeriods = Permissions.canManageEvaluationPeriods() || activeRole('ADMIN');
    if (canBrowseCompletedPeriods) {
      const periodSnapshot = await getDocs(collection(db, 'evaluationPeriods'));
      KpiWorkflowState.periods = periodSnapshot.docs.map(item => ({ id: item.id, ...item.data() }));
      KpiWorkflowState.period = KpiWorkflowState.periods.find(period => period.active === true && period.status !== 'DELETED')
        || KpiWorkflowState.periods.filter(period => period.status === 'COMPLETED').sort((a, b) => clean(b.endDate).localeCompare(clean(a.endDate)))[0]
        || null;
    } else {
      const activePeriod = await PeriodReadService.getActive({ force: false });
      KpiWorkflowState.periods = activePeriod ? [activePeriod] : [];
      KpiWorkflowState.period = activePeriod || null;
    }

    if (!KpiWorkflowState.period) {
      KpiWorkflowState.users = [KpiWorkflowState.profile];
      KpiWorkflowState.tasks = [];
      KpiWorkflowState.registrations = [];
      KpiWorkflowState.evaluations = [];
      KpiWorkflowState.milestones = [];
      KpiWorkflowState.commonAll = [];
      KpiWorkflowState.common = null;
      KpiWorkflowState.plan = null;
      KpiWorkflowState.delegations = [];
      KpiWorkflowState.kpiProfile = null;
      render();
      message(Permissions.canManageEvaluationPeriods() ? 'Chưa có kỳ đánh giá đang hoạt động. ADMIN hoặc Trưởng phòng TCHC có thể tạo hoặc kích hoạt kỳ đánh giá.' : 'Chưa có kỳ đánh giá đang hoạt động.');
      return;
    }

    const homeDepartmentId = profileDepartmentId();
    const periodId = KpiWorkflowState.period.id;

    if (directorMobileScope() && normalizeDepartment(KpiWorkflowState.scopeDepartmentId) === 'ALL') {
      KpiWorkflowState.scopeDepartmentId = 'BGD';
    } else if (!globalRole() && normalizeDepartment(KpiWorkflowState.scopeDepartmentId) === 'ALL') {
      KpiWorkflowState.scopeDepartmentId = homeDepartmentId;
    }

    KpiWorkflowState.delegations = [];
    const delegationRequests = [];

    if (isDeputyLeader() || isDepartmentHead()) {
      delegationRequests.push(
        getDoc(doc(db, 'approvalDelegations', `${homeDepartmentId}_ACTIVE`))
          .then(snapshot => ({ type: 'DEPARTMENT', snapshot }))
          .catch(error => {
            if(!isPermissionDeniedError(error)) console.warn('Không đọc được ủy quyền Phòng/Khu:', error);
            return null;
          })
      );
    }

    if (Permissions.isDirectorHead() || Permissions.isDirectorDeputy()) {
      delegationRequests.push(
        getDoc(doc(db, 'approvalDelegations', 'BGD_ACTIVE'))
          .then(snapshot => ({ type: 'BGD', snapshot }))
          .catch(error => {
            if(!isPermissionDeniedError(error)) console.warn('Không đọc được ủy quyền Ban Giám đốc:', error);
            return null;
          })
      );
    }

    if (Permissions.isCdtnMember()) {
      delegationRequests.push(
        getDoc(doc(db, 'approvalDelegations', 'CDTN_APPROVAL_ACTIVE'))
          .then(snapshot => ({ type: 'CDTN', snapshot }))
          .catch(error => {
            if (!['permission-denied', 'firestore/permission-denied'].includes(error?.code)) {
              console.warn('Không đọc được ủy quyền Chi đoàn:', error);
            }
            return null;
          })
      );
    }

    const delegationResults = await Promise.all(delegationRequests);
    delegationResults.filter(Boolean).forEach(result => {
      const snapshot = result.snapshot;
      if (!snapshot?.exists?.()) return;
      const delegation = { id: snapshot.id, ...snapshot.data() };
      const isOwnDepartmentHead = result.type === 'DEPARTMENT' && isDepartmentHead();
      const isCdtnLeader = result.type === 'CDTN' && Permissions.isCdtnSecretary();
      const isDirectorDelegator = result.type === 'BGD' && Permissions.isDirectorHead();
      if (isOwnDepartmentHead || isCdtnLeader || isDirectorDelegator || delegation.delegateUserId === KpiWorkflowState.user.uid) {
        KpiWorkflowState.delegations.push(delegation);
      }
    });

    const departmentId = activeScopeDepartmentId();
    const allCenterScope = departmentId === 'ALL' && globalRole();
    const fullCenterScope = allCenterScope && fullScopeRole();
    const professionalCenterScope = allCenterScope && !fullScopeRole();
    const cdtnDepartmentScope = departmentId === 'CDTN' && canManageCdtnWorkspace();
    const cdtnAggregateScope = departmentId === 'CDTN' && (fullScopeRole() || cdtnDepartmentScope);
    const reportDepartmentScope = departmentId !== 'CDTN' && departmentId !== 'ALL' && KpiWorkflowState.mode === 'reports' && isLeader();
    const taskDepartmentScope = departmentId !== 'ALL' && (globalRole() || cdtnDepartmentScope || isDepartmentHead() || reportDepartmentScope
      || hasActiveApprovalDelegation('APPROVE_REGISTRATIONS', departmentId)
      || hasActiveApprovalDelegation('CONFIRM_EVALUATIONS', departmentId)
      || hasActiveApprovalDelegation('LOCK_PLAN', departmentId));
    const registrationDepartmentScope = departmentId !== 'ALL' && (globalRole() || cdtnDepartmentScope || isDepartmentHead() || reportDepartmentScope
      || hasActiveApprovalDelegation('APPROVE_REGISTRATIONS', departmentId));
    const evaluationDepartmentScope = departmentId !== 'ALL' && (globalRole() || cdtnDepartmentScope || isDepartmentHead() || reportDepartmentScope
      || hasActiveApprovalDelegation('CONFIRM_EVALUATIONS', departmentId));
    const userDepartmentScope = taskDepartmentScope || registrationDepartmentScope || evaluationDepartmentScope;
    const managerHomeDepartmentId = profileDepartmentId();
    const managerMonitoringScope = KpiWorkflowState.mode === 'plans'
      && isLeader()
      && managerHomeDepartmentId
      && managerHomeDepartmentId !== 'CDTN'
      && (departmentId === managerHomeDepartmentId || (departmentId === 'ALL' && globalRole()));
    const combinedDepartmentReportScope = KpiWorkflowState.mode === 'reports'
      && departmentId !== 'ALL'
      && departmentId !== 'CDTN'
      && taskDepartmentScope;

    const taskRequest = fullCenterScope
      ? getDocs(query(collection(db, 'tasks'), where('periodId', '==', periodId), limit(5000)))
      : professionalCenterScope
        ? mergeAvailableSnapshotRequests([
            getDocs(query(collection(db, 'tasks'), where('periodId', '==', periodId), where('primaryDepartmentId', 'in', PROFESSIONAL_DEPARTMENT_IDS), limit(5000))),
            ...(managerMonitoringScope
              ? [getDocs(query(collection(db, 'tasks'), where('periodId', '==', periodId), where('homeDepartmentId', '==', managerHomeDepartmentId), limit(2000)))]
              : [])
          ], managerMonitoringScope ? 'nhiệm vụ chuyên môn toàn Trung tâm và workload kiêm nhiệm của đơn vị' : 'nhiệm vụ chuyên môn toàn Trung tâm')
        : departmentId === 'CDTN' && taskDepartmentScope
          ? mergeAvailableSnapshotRequests([
              getDocs(query(collection(db, 'tasks'), where('periodId', '==', periodId), where('primaryDepartmentId', '==', 'CDTN'), limit(1000))),
              getDocs(query(collection(db, 'tasks'), where('periodId', '==', periodId), where('organizationId', '==', 'CDTN'), limit(1000)))
            ], 'nhiệm vụ Chi đoàn')
          : (combinedDepartmentReportScope || managerMonitoringScope)
            ? mergeAvailableSnapshotRequests([
                getDocs(query(collection(db, 'tasks'), where('periodId', '==', periodId), where('primaryDepartmentId', '==', departmentId), limit(2000))),
                getDocs(query(collection(db, 'tasks'), where('periodId', '==', periodId), where('homeDepartmentId', '==', departmentId), limit(2000)))
              ], managerMonitoringScope ? 'nhiệm vụ chuyên môn và workload kiêm nhiệm của đơn vị' : 'nhiệm vụ chuyên môn và Chi đoàn của đơn vị')
            : taskDepartmentScope
              ? getDocs(query(collection(db, 'tasks'), where('periodId', '==', periodId), where('primaryDepartmentId', '==', departmentId), limit(2000)))
              : getDocs(query(collection(db, 'tasks'), where('periodId', '==', periodId), where('ownerUserId', '==', KpiWorkflowState.user.uid), limit(300)));

    const registrationRequest = fullCenterScope
      ? getDocs(query(collection(db, 'taskRegistrations'), where('periodId', '==', periodId), limit(5000)))
      : professionalCenterScope
        ? getDocs(query(collection(db, 'taskRegistrations'), where('periodId', '==', periodId), where('departmentId', 'in', PROFESSIONAL_DEPARTMENT_IDS), limit(5000)))
        : departmentId === 'CDTN' && registrationDepartmentScope
          ? mergeAvailableSnapshotRequests([
              getDocs(query(collection(db, 'taskRegistrations'), where('periodId', '==', periodId), where('departmentId', '==', 'CDTN'), limit(1000))),
              getDocs(query(collection(db, 'taskRegistrations'), where('periodId', '==', periodId), where('organizationId', '==', 'CDTN'), limit(1000)))
            ], 'đăng ký nhiệm vụ Chi đoàn')
          : combinedDepartmentReportScope
            ? mergeAvailableSnapshotRequests([
                getDocs(query(collection(db, 'taskRegistrations'), where('periodId', '==', periodId), where('departmentId', '==', departmentId), limit(2000))),
                getDocs(query(collection(db, 'taskRegistrations'), where('periodId', '==', periodId), where('homeDepartmentId', '==', departmentId), limit(2000)))
              ], 'đăng ký chuyên môn và Chi đoàn của đơn vị')
            : registrationDepartmentScope
              ? getDocs(query(collection(db, 'taskRegistrations'), where('periodId', '==', periodId), where('departmentId', '==', departmentId), limit(2000)))
              : getDocs(query(collection(db, 'taskRegistrations'), where('periodId', '==', periodId), where('userId', '==', KpiWorkflowState.user.uid), limit(300)));

    const evaluationRequest = fullCenterScope
      ? getDocs(query(collection(db, 'taskEvaluations'), where('periodId', '==', periodId), limit(5000)))
      : professionalCenterScope
        ? getDocs(query(collection(db, 'taskEvaluations'), where('periodId', '==', periodId), where('departmentId', 'in', PROFESSIONAL_DEPARTMENT_IDS), limit(5000)))
        : departmentId === 'CDTN' && evaluationDepartmentScope
          ? mergeAvailableSnapshotRequests([
              getDocs(query(collection(db, 'taskEvaluations'), where('periodId', '==', periodId), where('departmentId', '==', 'CDTN'), limit(1000))),
              getDocs(query(collection(db, 'taskEvaluations'), where('periodId', '==', periodId), where('organizationId', '==', 'CDTN'), limit(1000)))
            ], 'đánh giá nhiệm vụ Chi đoàn')
          : combinedDepartmentReportScope
            ? mergeAvailableSnapshotRequests([
                getDocs(query(collection(db, 'taskEvaluations'), where('periodId', '==', periodId), where('departmentId', '==', departmentId), limit(2000))),
                getDocs(query(collection(db, 'taskEvaluations'), where('periodId', '==', periodId), where('homeDepartmentId', '==', departmentId), limit(2000)))
              ], 'đánh giá chuyên môn và Chi đoàn của đơn vị')
            : evaluationDepartmentScope
              ? getDocs(query(collection(db, 'taskEvaluations'), where('periodId', '==', periodId), where('departmentId', '==', departmentId), limit(2000)))
              : getDocs(query(collection(db, 'taskEvaluations'), where('periodId', '==', periodId), where('ownerUserId', '==', KpiWorkflowState.user.uid), limit(300)));

    const commonRequest = fullCenterScope
      ? getDocs(query(collection(db, 'commonCriteriaAssessments'), where('periodId', '==', periodId), limit(2000)))
      : professionalCenterScope
        ? getDocs(query(collection(db, 'commonCriteriaAssessments'), where('periodId', '==', periodId), where('departmentId', 'in', PROFESSIONAL_DEPARTMENT_IDS), limit(2000)))
        : departmentId === 'CDTN'
          ? getDocs(query(collection(db, 'commonCriteriaAssessments'), where('periodId', '==', periodId), where('userId', '==', KpiWorkflowState.user.uid), limit(10)))
          : evaluationDepartmentScope && departmentId !== 'CDTN'
            ? getDocs(query(collection(db, 'commonCriteriaAssessments'), where('periodId', '==', periodId), where('departmentId', '==', departmentId), limit(500)))
            : getDocs(query(collection(db, 'commonCriteriaAssessments'), where('periodId', '==', periodId), where('userId', '==', KpiWorkflowState.user.uid), limit(10)));

    const milestoneRequest = fullCenterScope
      ? getDocs(query(collection(db, 'taskMilestones'), where('periodId', '==', periodId), limit(10000)))
      : professionalCenterScope
        ? getDocs(query(collection(db, 'taskMilestones'), where('periodId', '==', periodId), where('departmentId', 'in', PROFESSIONAL_DEPARTMENT_IDS), limit(10000)))
        : departmentId === 'CDTN' && taskDepartmentScope
          ? getDocs(query(collection(db, 'taskMilestones'), where('periodId', '==', periodId), where('departmentId', '==', 'CDTN'), limit(2000)))
          : taskDepartmentScope
            ? getDocs(query(collection(db, 'taskMilestones'), where('periodId', '==', periodId), where('departmentId', '==', departmentId), limit(5000)))
            : getDocs(query(collection(db, 'taskMilestones'), where('periodId', '==', periodId), where('ownerUserId', '==', KpiWorkflowState.user.uid), limit(1000)));

    const usersRequest = fullCenterScope
      ? getDocs(query(collection(db, 'users'), limit(500)))
      : professionalCenterScope
        ? getDocs(query(collection(db, 'users'), where('departmentId', 'in', PROFESSIONAL_DEPARTMENT_IDS), limit(500)))
        : cdtnAggregateScope
          ? loadCdtnUsers()
          : (userDepartmentScope || managerMonitoringScope)
            ? getDocs(query(collection(db, 'users'), where('departmentId', '==', departmentId), limit(300)))
            : Promise.resolve(null);
    const profileRequest = getDoc(doc(db, 'kpiProfiles', `${periodId}_${KpiWorkflowState.user.uid}`))
      .catch(error => {
        if(!isPermissionDeniedError(error)) console.warn('Không đọc được hồ sơ Mẫu 01; tiếp tục tải dữ liệu KPI chính:', error);
        return null;
      });

    const loadResults = await Promise.allSettled([
      usersRequest,
      taskRequest,
      registrationRequest,
      evaluationRequest,
      commonRequest,
      milestoneRequest,
      getDoc(doc(db, 'kpiPlans', `${periodId}_${planManagementDepartmentId()}`)),
      profileRequest
    ]);

    const valueOr = (index, fallback, label, required = false) => {
      const result = loadResults[index];
      if (result.status === 'fulfilled') return result.value;
      console.warn(`Không tải được ${label}:`, result.reason);
      if (required) throw result.reason;
      return fallback;
    };

    const usersResult = valueOr(0, null, 'danh sách người dùng');
    const tasksSnapshot = valueOr(1, { docs: [] }, 'nhiệm vụ', true);
    const registrationsSnapshot = valueOr(2, { docs: [] }, 'đăng ký nhiệm vụ', true);
    const evaluationsSnapshot = valueOr(3, { docs: [] }, 'đánh giá nhiệm vụ', true);
    const commonSnapshot = valueOr(4, { docs: [] }, 'tiêu chí chung');
    const milestonesSnapshot = valueOr(5, { docs: [] }, 'mốc tiến độ KPI', true);
    const planSnapshot = valueOr(6, null, 'kế hoạch KPI');
    const profileSnapshot = valueOr(7, null, 'hồ sơ Mẫu 01');

    let loadedUsers = Array.isArray(usersResult)
      ? usersResult
      : usersResult?.docs
        ? usersResult.docs.map(item => normalizeUserRecord(item.data(), item.id))
        : [normalizeUserRecord(KpiWorkflowState.profile, KpiWorkflowState.user.uid)];

    KpiWorkflowState.users = globalRole()
      ? loadedUsers
      : cdtnDepartmentScope
        ? loadedUsers
        : (userDepartmentScope || managerMonitoringScope)
          ? loadedUsers.filter(item => normalizeDepartment(item.departmentId) === departmentId)
          : loadedUsers.filter(item => item.id === KpiWorkflowState.user.uid);

    if (cdtnDepartmentScope) {
      KpiWorkflowState.users = loadedUsers.filter(item => {
        const roles = Array.isArray(item.additionalRoles) ? item.additionalRoles.map(normalizeDepartment) : [];
        return roles.some(role => ['CDTN_BI_THU', 'CDTN_PHO_BI_THU', 'CDTN_UY_VIEN_BCH', 'CDTN_DOAN_VIEN'].includes(role));
      });
    }

    if (!KpiWorkflowState.users.some(item => item.id === KpiWorkflowState.user.uid)) {
      KpiWorkflowState.users.push(normalizeUserRecord(KpiWorkflowState.profile, KpiWorkflowState.user.uid));
    }
    // V1.18.0: Trưởng Phòng/Khu và Bí thư cần biết Giám đốc để định tuyến hồ sơ tự chấm lên đúng cấp.
    if ((isDepartmentHead() || Permissions.isCdtnSecretary()) && !KpiWorkflowState.users.some(item => normalizeDepartment(item.departmentId) === 'BGD')) {
      try {
        const bgdSnapshot = await getDocs(query(collection(db, 'users'), where('departmentId', '==', 'BGD'), limit(20)));
        bgdSnapshot.docs.forEach(item => {
          const user = normalizeUserRecord(item.data(), item.id);
          if (!KpiWorkflowState.users.some(existing => existing.id === user.id)) KpiWorkflowState.users.push(user);
        });
      } catch (error) {
        if (!isPermissionDeniedError(error)) console.warn('Không tải được danh sách Ban Giám đốc để định tuyến KPI:', error);
      }
    }
    KpiWorkflowState.tasks = tasksSnapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    KpiWorkflowState.registrations = registrationsSnapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    KpiWorkflowState.evaluations = evaluationsSnapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    KpiWorkflowState.milestones = milestonesSnapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    KpiWorkflowState.commonAll = commonSnapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    if (departmentId === 'CDTN' && cdtnAggregateScope) {
      const legacyCdtnTasks = KpiWorkflowState.tasks.filter(task => taskScopeDepartmentId(task) === 'CDTN' && normalizeDepartment(task.primaryDepartmentId) !== 'CDTN');
      if (legacyCdtnTasks.length) {
        const knownEvaluationIds = new Set(KpiWorkflowState.evaluations.map(item => item.id));
        const legacyEvaluationResults = await Promise.allSettled(legacyCdtnTasks
          .map(task => `${periodId}_${task.id}`)
          .filter(id => !knownEvaluationIds.has(id))
          .map(id => getDoc(doc(db, 'taskEvaluations', id))));
        legacyEvaluationResults.forEach(result => {
          if (result.status === 'fulfilled' && result.value?.exists?.()) {
            KpiWorkflowState.evaluations.push({ id: result.value.id, ...result.value.data() });
          }
        });
      }
    }
    KpiWorkflowState.common = commonAssessmentForUser(KpiWorkflowState.user.uid, departmentId);
    KpiWorkflowState.plan = planSnapshot?.exists?.() ? { id: planSnapshot.id, ...planSnapshot.data() } : null;
    KpiWorkflowState.kpiProfile = profileSnapshot?.exists?.()
      ? { id: profileSnapshot.id, ...profileSnapshot.data() }
      : null;

    render();
    message('');
  } catch (error) {
    console.error(error);
    renderManagementToolbar();
    const permissionDenied = isPermissionDeniedError(error);
    message(permissionDenied
      ? 'Chưa tải được dữ liệu theo phạm vi tài khoản. Vui lòng bấm Cập nhật; nếu lỗi vẫn còn, liên hệ quản trị viên.'
      : friendlyErrorMessage(error, 'Không thể tải dữ liệu đánh giá. Vui lòng bấm Cập nhật và thử lại.'));
  }
}

function itemInActiveScope(item) {
  const scope = activeScopeDepartmentId();
  const itemDepartmentId = item?.primaryDepartmentId || item?.organizationId || item?.standardTaskDepartmentId
    ? taskScopeDepartmentId(item)
    : normalizeDepartment(item?.departmentId);
  return !scope || scope === 'ALL' || itemDepartmentId === scope;
}

function taskInPlanMonitoringScope(task) {
  if (itemInActiveScope(task)) return true;
  if (KpiWorkflowState.mode !== 'plans' || !isLeader()) return false;
  const scope = activeScopeDepartmentId();
  const homeDepartmentId = profileDepartmentId();
  return Boolean(
    scope
    && scope === homeDepartmentId
    && scope !== 'CDTN'
    && taskScopeDepartmentId(task) === 'CDTN'
    && normalizeDepartment(task?.homeDepartmentId) === homeDepartmentId
  );
}

function taskForCurrentUser(task) {
  if (!itemInActiveScope(task)) return false;
  if (globalRole()) return true;
  if (isCdtnScope() && canViewDepartmentData()) return true;
  if (isLeader()) return true;
  return task.ownerUserId === KpiWorkflowState.user.uid || task.createdByUserId === KpiWorkflowState.user.uid;
}
function evaluationFor(taskId){ return KpiWorkflowState.evaluations.find(e => e.taskId === taskId); }
function milestonesForTask(taskId){ return KpiWorkflowState.milestones.filter(item => item.taskId === taskId && item.active !== false).sort((a,b)=>Number(a.sequence||0)-Number(b.sequence||0)||clean(a.dueDateKey).localeCompare(clean(b.dueDateKey))); }
function hasNumericValue(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}
function evaluationScoreSnapshot(evaluation = null) {
  const inactive = evaluation?.active === false || ['CANCELLED', 'HUY'].includes(clean(evaluation?.status).toUpperCase());
  if (inactive) return {
    official:false, provisional:false, hasScore:false,
    executionScore:0, convertedActualScore:0, actualScore:0,
    progressRate:null, resultRate:null,
    label:'Chưa tự đánh giá', shortLabel:'Chưa có điểm'
  };
  const official = Boolean(
    evaluation &&
    (evaluation.status === 'CONFIRMED' || evaluation.scoreLocked === true) &&
    hasNumericValue(evaluation.confirmedActualScore)
  );
  const hasSelfScore = Boolean(evaluation && hasNumericValue(evaluation.selfActualScore));
  const hasScore = official || hasSelfScore;
  const executionScore = official && hasNumericValue(evaluation.confirmedExecutionScore)
    ? Number(evaluation.confirmedExecutionScore)
    : hasNumericValue(evaluation?.selfExecutionScore)
      ? Number(evaluation.selfExecutionScore)
      : 0;
  const convertedActualScore = official
    ? Number(evaluation.confirmedActualScore || 0)
    : hasSelfScore ? Number(evaluation.selfActualScore || 0) : 0;
  const progressRate = official && hasNumericValue(evaluation.confirmedProgressRate)
    ? Number(evaluation.confirmedProgressRate)
    : hasNumericValue(evaluation?.selfProgressRate) ? Number(evaluation.selfProgressRate) : null;
  const resultRate = official && hasNumericValue(evaluation.confirmedResultRate)
    ? Number(evaluation.confirmedResultRate)
    : hasNumericValue(evaluation?.selfResultRate) ? Number(evaluation.selfResultRate) : null;
  const bonusRequested = evaluation?.bonusRequested === true;
  const bonusDecision = clean(evaluation?.bonusDecision || (evaluation?.bonusAwarded === true ? 'APPROVED' : bonusRequested ? 'PENDING' : 'NOT_REQUESTED')).toUpperCase();
  const bonusResolved = !bonusRequested || ['APPROVED','REJECTED'].includes(bonusDecision);
  const bonusAwarded = Boolean(official && bonusDecision === 'APPROVED' && evaluation?.bonusAwarded === true && Number(evaluation?.bonusScore || 0) > 0);
  const bonusScore = bonusAwarded ? round2(Number(evaluation.bonusScore || 0)) : 0;
  return {
    official,
    provisional: hasScore && !official,
    hasScore,
    executionScore,
    convertedActualScore,
    // Giữ alias actualScore để tương thích các phần tổng hợp hiện có.
    actualScore: convertedActualScore,
    progressRate,
    resultRate,
    bonusRequested, bonusRequestType: bonusRequested ? clean(evaluation?.bonusRequestType || '') : '', bonusRequestReason: bonusRequested ? clean(evaluation?.bonusRequestReason || '') : '', bonusRequestedScore: bonusRequested ? Number(evaluation?.bonusRequestedScore || 0) : 0, bonusDecision, bonusResolved, bonusDecisionReason: clean(evaluation?.bonusDecisionReason || ''),
    bonusAwarded,
    bonusType: bonusAwarded ? clean(evaluation?.bonusType || 'OUTSTANDING') : '',
    bonusRate: bonusAwarded ? Number(evaluation?.bonusRate || 0.05) : 0,
    bonusBasisScore: bonusAwarded ? Number(evaluation?.bonusBasisScore || convertedActualScore) : 0,
    bonusScore,
    label: official ? 'Điểm chính thức' : hasScore ? 'Điểm tự đánh giá' : 'Chưa tự đánh giá',
    shortLabel: official ? 'Chính thức' : hasScore ? 'Tự đánh giá' : 'Chưa có điểm'
  };
}
function commonScoreSnapshot(common = null) {
  const inactive = common?.active === false || ['CANCELLED', 'HUY'].includes(clean(common?.status).toUpperCase());
  if (inactive) return { official:false, provisional:false, hasScore:false, total:0, items:[] };
  const official = Boolean(common?.status === 'CONFIRMED' && hasNumericValue(common?.confirmedTotal));
  const hasSelfScore = Boolean(common && hasNumericValue(common.selfTotal));
  const hasScore = official || hasSelfScore;
  return {
    official,
    provisional: hasScore && !official,
    hasScore,
    total: official ? Number(common.confirmedTotal || 0) : hasSelfScore ? Number(common.selfTotal || 0) : 0,
    items: Array.isArray(common?.items) ? common.items : []
  };
}
function taskRequiresOfficialEvaluation(task = {}) {
  const status = clean(task.status).toUpperCase();
  const scoringStatus = clean(task.scoringStatus).toUpperCase();
  if (task.active === false || ['HUY','CANCELLED'].includes(status)) return false;
  if (task.scoringEnabled === false) return false;
  if (clean(task.noOccurrenceStatus).toUpperCase() === 'CONFIRMED') return false;
  if (['NO_OCCURRENCE_CONFIRMED','ADJUSTMENT_EXEMPT'].includes(scoringStatus)) return false;
  return task.includedInA === true && clean(task.planApprovalStatus).toUpperCase() === 'APPROVED';
}

function scoreRowsForUser(userId) {
  return KpiWorkflowState.tasks.filter(task => task.ownerUserId === userId && itemInActiveScope(task)).map(task => {
    const evaluation = KpiWorkflowState.evaluations.find(item => item.taskId === task.id && item.ownerUserId === userId);
    const score = evaluationScoreSnapshot(evaluation);
    return {
      ...task,
      recognized: score.hasScore,
      confirmedActualScore: score.actualScore,
      bonusScore: score.bonusScore || 0,
      appliedScoreStatus: score.official ? 'OFFICIAL' : score.hasScore ? 'SELF' : 'EMPTY',
      includedInA: task.includedInA === true
    };
  });
}
function scoreStateForUser(userId) {
  const tasks = KpiWorkflowState.tasks.filter(task => {
    if (task.ownerUserId !== userId || task.active === false || !itemInActiveScope(task)) return false;
    const scoringStatus = String(task.scoringStatus || '').toUpperCase();
    if (task.scoringEnabled === false
      || String(task.noOccurrenceStatus || '').toUpperCase() === 'CONFIRMED'
      || ['NO_OCCURRENCE_CONFIRMED', 'ADJUSTMENT_EXEMPT'].includes(scoringStatus)) return false;
    const evaluation = KpiWorkflowState.evaluations.find(item => item.taskId === task.id && item.ownerUserId === userId);
    return task.includedInA === true || Boolean(evaluation);
  });
  const evaluations = tasks.map(task => KpiWorkflowState.evaluations.find(item => item.taskId === task.id && item.ownerUserId === userId));
  const common = commonAssessmentForUser(userId, activeScopeDepartmentId())
    || (userId === KpiWorkflowState.user?.uid ? KpiWorkflowState.common : null);
  const commonScore = commonScoreSnapshot(common);
  const calculated = calculateKpiSummary(scoreRowsForUser(userId), commonScore.total);
  const taskScores = evaluations.map(evaluationScoreSnapshot);
  const hasAnyScore = taskScores.some(item => item.hasScore) || commonScore.hasScore;
  const hasNeedsRevision = evaluations.some(item => item?.status === 'NEEDS_REVISION');
  const taskOfficial = tasks.length > 0 && taskScores.length === tasks.length && taskScores.every(item => item.official && item.bonusResolved !== false);
  const allOfficial = taskOfficial && commonScore.official;
  const anyOfficial = taskScores.some(item => item.official) || commonScore.official;

  if (!calculated.hasCalculationBasis) return {
    code: 'NO_BASIS',
    label: 'Chưa đủ cơ sở tính',
    detail: 'Tổng điểm A của kỳ bằng 0. Kỳ chưa thể tính KPI công việc hoặc khóa đánh giá cuối kỳ.',
    className: 'is-empty'
  };

  if (allOfficial) return {
    code: 'OFFICIAL',
    label: 'Điểm chính thức',
    detail: 'Kết quả đã được cấp có thẩm quyền xác nhận và không thể chỉnh sửa.',
    className: 'is-official'
  };
  if (hasNeedsRevision) return {
    code: 'REVISION',
    label: 'Cần cập nhật tự đánh giá',
    detail: 'Báo cáo đang dùng điểm tự đánh giá hiện có. Cá nhân có thể chỉnh sửa và gửi lại trước khi xác nhận.',
    className: 'is-revision'
  };
  if (hasAnyScore && anyOfficial) return {
    code: 'PARTIAL',
    label: 'Điểm tạm tính · đang xác nhận',
    detail: 'Nội dung đã xác nhận dùng điểm chính thức; nội dung còn lại dùng điểm tự đánh giá.',
    className: 'is-pending'
  };
  if (hasAnyScore) return {
    code: 'SELF',
    label: 'Điểm tự đánh giá',
    detail: 'Được dùng để xem trước và in báo cáo; cá nhân vẫn có thể chỉnh sửa trước khi xác nhận chính thức.',
    className: 'is-self'
  };
  return {
    code: 'EMPTY',
    label: 'Chưa có điểm tự đánh giá',
    detail: 'Hoàn thành tự đánh giá nhiệm vụ và tiêu chí chung để hình thành báo cáo.',
    className: 'is-empty'
  };
}
function recognizedRowsForUser() { return scoreRowsForUser(KpiWorkflowState.user.uid); }
function summary() {
  const common = commonScoreSnapshot(KpiWorkflowState.common);
  return calculateKpiSummary(recognizedRowsForUser(), common.total);
}

function render() {
  const periodLine = el('kpiPeriodLine');
  if (periodLine) {
    periodLine.innerHTML = KpiWorkflowState.period ? `
      <span class="kpi-chip">${esc(KpiWorkflowState.period.name || KpiWorkflowState.period.id)}</span>
      <span class="kpi-chip">${dateVi(KpiWorkflowState.period.startDate)} – ${dateVi(KpiWorkflowState.period.endDate)}</span>
      <span class="kpi-chip">${KpiWorkflowState.period.status === 'COMPLETED' ? 'Đã kết thúc' : 'Đang hoạt động'}</span>
      <span class="kpi-chip">${KpiWorkflowState.plan?.locked === true ? 'Đã khóa đăng ký' : 'Đang mở đăng ký'}</span>`
      : '<span class="kpi-chip">Chưa có kỳ hoạt động</span>';
  }

  const currentSummary = summary();
  setTextSafe('kpiMetricA', fmt(currentSummary.A));
  setTextSafe('kpiMetricB', fmt(currentSummary.B));
  setTextSafe('kpiMetric70', currentSummary.hasCalculationBasis ? `${fmt(currentSummary.kpi70)}/70` : 'Chưa đủ cơ sở');
  const bonusMetric = el('kpiMetricBonus');
  if (bonusMetric) bonusMetric.textContent = currentSummary.bonus70 > 0 ? `Điểm thưởng: +${fmt(currentSummary.bonus70)}` : 'Chưa có điểm thưởng';
  setTextSafe('kpiMetric30', `${fmt(currentSummary.common30)}/30`);
  setTextSafe('kpiMetric100', currentSummary.hasCalculationBasis ? `${fmt(currentSummary.total100)}/100` : 'Chưa đủ cơ sở');

  const scoreStateBox = el('kpiScoreState');
  if (scoreStateBox) {
    const shouldShow = Boolean(KpiWorkflowState.period && ['evaluations', 'reports'].includes(KpiWorkflowState.mode));
    const displayScope = activeScopeDepartmentId();
    const state = displayScope && displayScope !== 'ALL'
      ? scoreStateForUserInDepartment(KpiWorkflowState.user.uid, displayScope)
      : scoreStateForUser(KpiWorkflowState.user.uid);
    scoreStateBox.className = `kpi-score-state ${state.className}${shouldShow ? '' : ' kpi-hidden'}`;
    scoreStateBox.innerHTML = shouldShow
      ? `<span class="kpi-score-state-icon">${state.code === 'OFFICIAL' ? '✓' : state.code === 'REVISION' ? '!' : state.code === 'EMPTY' ? '○' : '✎'}</span><div><strong>${esc(state.label)}</strong><span>${esc(state.detail)}</span></div>`
      : '';
  }

  renderManagementToolbar();
  el('kpiAdminBox')?.classList.toggle('kpi-hidden', !activeRole('ADMIN'));
  const cleanupButton = el('kpiDeletePeriod');
  if (cleanupButton) {
    const canPurge = activeRole('ADMIN') && KpiWorkflowState.period?.status === 'COMPLETED' && KpiWorkflowState.period?.active !== true;
    cleanupButton.disabled = !canPurge;
    cleanupButton.title = canPurge ? 'Lưu hồ sơ kỳ lên Drive rồi dọn dữ liệu vận hành.' : 'Phải kết thúc kỳ trước khi dọn dữ liệu.';
  }
  if (KpiWorkflowState.mode === 'plans') renderPlanDashboard();
  else if (KpiWorkflowState.mode === 'evaluations') renderEvaluationDashboard();
  else renderReportDashboard();
}

function visiblePeople() {
  const all = [...KpiWorkflowState.users].filter(user => user.active === true);
  if (globalRole()) {
    const scope = activeScopeDepartmentId();
    if (!scope || scope === 'ALL') return all;
    if (scope === 'CDTN') {
      return all.filter(user => KpiWorkflowState.tasks.some(task => task.ownerUserId === user.id && taskScopeDepartmentId(task) === 'CDTN')
        || KpiWorkflowState.registrations.some(item => item.userId === user.id && normalizeDepartment(item.departmentId) === 'CDTN'));
    }
    return all.filter(user => normalizeDepartment(user.departmentId) === scope);
  }
  if (isCdtnScope() && canViewDepartmentData()) return all;
  if (canViewDepartmentData()) {
    return all.filter(user => normalizeDepartment(user.departmentId) === profileDepartmentId());
  }
  return all.filter(user => user.id === KpiWorkflowState.user.uid);
}
function rowsForPerson(uid){return KpiWorkflowState.tasks.filter(t=>t.ownerUserId===uid&&t.active!==false&&taskInPlanMonitoringScope(t));}
function regsForPerson(uid){return KpiWorkflowState.registrations.filter(r=>r.userId===uid&&r.active!==false&&itemInActiveScope(r));}
function renderPlanDashboard() {
  const target = el('kpiTaskList');
  if (!target) return;
  const people = visiblePeople().filter(user => rowsForPerson(user.id).length || regsForPerson(user.id).length || user.id === KpiWorkflowState.user.uid);
  if (!people.length) {
    target.innerHTML = '<div class="kpi-empty">Chưa có đăng ký hoặc nhiệm vụ trong kỳ.</div>';
    return;
  }

  target.innerHTML = `<div class="kpi-table-wrap kpi-people-plan-table"><table class="kpi-table"><thead><tr><th>STT</th><th>Họ và tên</th><th>Đầu việc đăng ký</th><th>Tổng điểm</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>${people.map((user, index) => {
    const registrations = regsForPerson(user.id);
    const tasks = rowsForPerson(user.id);
    const approved = tasks.filter(task => task.includedInA === true);
    const score = approved.reduce((sum, task) => sum + Number(task.maximumConvertedScore || 0), 0);
    const pending = registrations.filter(registration => registration.status === 'PENDING').length;
    const rejected = registrations.filter(registration => registration.status === 'REJECTED').length;
    const officialTaskCount = approved.length + pending;
    const statusText = pending ? `${pending} chờ duyệt` : rejected ? `Đã cập nhật · ${rejected} không duyệt` : 'Đã cập nhật';
    return `<tr><td>${index + 1}</td><td><strong>${esc(user.fullName || user.email || user.id)}</strong><br><span class="kpi-small">${esc(user.position || '')}</span></td><td>${officialTaskCount}</td><td>${fmt(score)}</td><td><span class="kpi-status">${esc(statusText)}</span></td><td><button class="kpi-button secondary" data-person-detail="${esc(user.id)}">Chi tiết</button></td></tr>`;
  }).join('')}</tbody></table></div><div id="kpiCompactEvaluation"></div>`;

  target.querySelectorAll('[data-person-detail]').forEach(button => button.addEventListener('click', () => openPersonPlanDetail(button.dataset.personDetail)));
  renderCompactEvaluationPanel(el('kpiCompactEvaluation'));
}

function completedTaskForEvaluation(task) {
  return task?.active !== false
    && String(task.scoringStatus || '').toUpperCase() !== 'ADJUSTMENT_EXEMPT'
    && (
      ['HOAN_THANH', 'COMPLETED', 'DA_HOAN_THANH'].includes(clean(task.status).toUpperCase())
      || Boolean(task.completedAt)
    );
}

function completedTasksForUser(userId) {
  return KpiWorkflowState.tasks
    .filter(taskForCurrentUser)
    .filter(completedTaskForEvaluation)
    .filter(task => task.ownerUserId === userId);
}

function renderCompactEvaluationPanel(target) {
  if (!target) return;
  const people = visiblePeople()
    .map(user => ({ ...user, _tasks: completedTasksForUser(user.id) }))
    .filter(user => user._tasks.length > 0);

  if (!people.length) {
    target.innerHTML = '<div class="kpi-subsection"><h3>Đánh giá nhiệm vụ đã hoàn thành</h3><div class="kpi-empty">Chưa có nhiệm vụ hoàn thành để đánh giá.</div></div>';
    return;
  }

  const selectedExists = people.some(user => user.id === KpiWorkflowState.selectedReviewUserId);
  if (!selectedExists) {
    const own = people.find(user => user.id === KpiWorkflowState.user.uid);
    KpiWorkflowState.selectedReviewUserId = (own || people[0]).id;
  }
  const selectedUser = people.find(user => user.id === KpiWorkflowState.selectedReviewUserId) || people[0];
  const tasks = selectedUser._tasks;
  const reviewable = tasks.filter(task => {
    const evaluation = evaluationFor(task.id);
    return evaluation && canReviewEvaluation(evaluation, task)
      && evaluation.status !== 'CONFIRMED'
      && evaluation.scoreLocked !== true;
  });

  target.innerHTML = `<section class="kpi-subsection kpi-compact-review">
    <div class="kpi-compact-review-head"><div><h3>Đánh giá nhiệm vụ đã hoàn thành</h3><p class="kpi-small">Chọn một nhân viên, sau đó chọn từng nhiệm vụ hoặc chọn tất cả để xác nhận theo điểm tự đánh giá. Nhiệm vụ cần điều chỉnh điểm vẫn có nút mở chi tiết.</p></div></div>
    <div class="kpi-review-layout">
      <aside class="kpi-review-people" aria-label="Danh sách nhân viên">${people.map(user => {
        const pendingCount = user._tasks.filter(task => {
          const evaluation = evaluationFor(task.id);
          return evaluation && evaluation.status !== 'CONFIRMED' && evaluation.scoreLocked !== true;
        }).length;
        return `<button class="kpi-review-person ${user.id === selectedUser.id ? 'is-active' : ''}" type="button" data-kpi-review-person="${esc(user.id)}"><strong>${esc(user.fullName || user.email || user.id)}</strong><span>${user._tasks.length} nhiệm vụ · ${pendingCount} chờ xử lý</span></button>`;
      }).join('')}</aside>
      <div class="kpi-review-tasks">
        <div class="kpi-review-tasks-toolbar"><div><strong>${esc(selectedUser.fullName || selectedUser.email || selectedUser.id)}</strong><span>${tasks.length} nhiệm vụ hoàn thành</span></div><div><button class="kpi-button secondary" type="button" data-kpi-scorecard="${esc(selectedUser.id)}">Bảng KPI</button><button class="kpi-button secondary" type="button" data-kpi-product-catalog="${esc(selectedUser.id)}">Danh mục sản phẩm</button>${canConfirmEvaluations() && reviewable.length ? '<button id="kpiReviewSelectAll" class="kpi-button secondary" type="button">Chọn tất cả</button><button id="kpiReviewClearAll" class="kpi-button secondary" type="button">Bỏ chọn</button><button id="kpiConfirmSelected" class="kpi-button" type="button">Xác nhận mục đã chọn</button>' : ''}</div></div>
        <div class="kpi-review-task-scroll">${tasks.map(task => {
          const evaluation = evaluationFor(task.id);
          const own = task.ownerUserId === KpiWorkflowState.user.uid;
          const locked = evaluation?.status === 'CONFIRMED' || evaluation?.scoreLocked === true;
          const score = evaluationScoreSnapshot(evaluation || {});
          const hasBonusRequest = evaluation?.bonusRequested === true;
          const canOpenReview = Boolean(evaluation && canReviewEvaluation(evaluation, task) && !locked);
          const hasExceededRequest = evaluation?.isExceededRequirement === true;
          const needsExceededDecision = Boolean(evaluation && evaluation.status === 'CONFIRMED' && evaluation.scoreLocked === true && hasExceededRequest && typeof evaluation.confirmedExceededRequirement !== 'boolean');
          const canBatch = Boolean(canOpenReview && !hasBonusRequest && !hasExceededRequest);
          return `<article class="kpi-review-task-row">
            <div class="kpi-review-task-check">${canBatch ? `<input type="checkbox" data-kpi-confirm-check value="${esc(evaluation.id)}">` : '<span>—</span>'}</div>
            <div class="kpi-review-task-main"><strong>${esc(task.taskCode || task.id)} — ${esc(task.title || '')}</strong><span>Tiến độ: ${evaluation?.confirmedProgressRate ?? evaluation?.selfProgressRate ?? progressRateFromDates(task.deadline || task.dueDate, task.completedAt, Boolean(task.completedAt))}% · Kết quả: ${evaluation?.confirmedResultRate ?? evaluation?.selfResultRate ?? '—'}%${hasBonusRequest ? ' · ⭐ Có đề nghị điểm thưởng' : ''}${hasExceededRequest ? ' · ✓ Đề nghị vượt yêu cầu' : ''}</span></div>
            <div class="kpi-review-task-score"><span>Điểm thực tế</span><strong>${score.hasScore ? fmt(score.convertedActualScore) : '—'}</strong></div>
            <div class="kpi-review-task-action">${own
              ? (locked ? '<span class="kpi-status">Đã xác nhận</span>' : `<button class="kpi-button" data-kpi-self="${esc(task.id)}">${evaluation?.id ? 'Cập nhật tự đánh giá' : 'Tự đánh giá'}</button>`)
              : (canOpenReview || needsExceededDecision)
                ? `<button class="kpi-button secondary" data-kpi-review="${esc(evaluation.id)}">${needsExceededDecision ? 'Xác nhận vượt' : 'Mở chi tiết'}</button>`
                : `<span class="kpi-status">${evaluation ? taskStatus(task, evaluation) : 'Chưa tự đánh giá'}</span>`}</div>
          </article>`;
        }).join('')}</div>
      </div>
    </div>
  </section>`;

  target.querySelectorAll('[data-kpi-review-person]').forEach(button => button.addEventListener('click', () => {
    KpiWorkflowState.selectedReviewUserId = button.dataset.kpiReviewPerson;
    renderCompactEvaluationPanel(target);
  }));
  target.querySelectorAll('[data-kpi-self]').forEach(button => button.addEventListener('click', () => openSelfAssessment(button.dataset.kpiSelf)));
  target.querySelectorAll('[data-kpi-review]').forEach(button => button.addEventListener('click', () => openReview(button.dataset.kpiReview)));
  target.querySelectorAll('[data-kpi-scorecard]').forEach(button => button.addEventListener('click', () => openUserScorecard(button.dataset.kpiScorecard)));
  target.querySelectorAll('[data-kpi-product-catalog]').forEach(button => button.addEventListener('click', () => openProductCatalog(button.dataset.kpiProductCatalog)));
  target.querySelector('#kpiReviewSelectAll')?.addEventListener('click', () => target.querySelectorAll('[data-kpi-confirm-check]').forEach(input => { input.checked = true; }));
  target.querySelector('#kpiReviewClearAll')?.addEventListener('click', () => target.querySelectorAll('[data-kpi-confirm-check]').forEach(input => { input.checked = false; }));
  target.querySelector('#kpiConfirmSelected')?.addEventListener('click', async event => {
    const ids = [...target.querySelectorAll('[data-kpi-confirm-check]:checked')].map(input => input.value);
    if (!ids.length) return ModalService.alert('Hãy chọn ít nhất một nhiệm vụ cần xác nhận.');
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await batchConfirmEvaluations(ids);
      scheduleKpiLiveRender();
    } catch (error) {
      ModalService.alert(friendlyErrorMessage(error, 'Không xác nhận được các nhiệm vụ đã chọn.'));
      button.disabled = false;
    }
  });
}

async function batchConfirmEvaluations(evaluationIds) {
  const uniqueIds = [...new Set(evaluationIds)].slice(0, 200);
  const rows = uniqueIds.map(id => {
    const evaluation = KpiWorkflowState.evaluations.find(item => item.id === id);
    const task = KpiWorkflowState.tasks.find(item => item.id === evaluation?.taskId);
    if (!evaluation || !task || !canReviewEvaluation(evaluation, task)) return null;
    if (evaluation.bonusRequested === true || evaluation.isExceededRequirement === true) return null;
    if (!hasNumericValue(evaluation.selfProgressRate) || !hasNumericValue(evaluation.selfResultRate)) return null;
    const score = calculateTaskScore(
      Number(task.baseScore || evaluation.baseScore || 0),
      Number(task.difficultyCoefficient || evaluation.difficultyCoefficient || 1),
      Number(evaluation.selfProgressRate),
      Number(evaluation.selfResultRate)
    );
    return { evaluation, task, score };
  }).filter(Boolean);

  if (!rows.length) throw new Error('Các nhiệm vụ đã chọn chưa có tự đánh giá hợp lệ hoặc không thuộc quyền xác nhận.');
  if (!await ModalService.confirm(`Xác nhận ${rows.length} nhiệm vụ theo điểm tự đánh giá hiện tại? Các điểm này sẽ được khóa chính thức.`)) return;

  const batch = writeBatch(db);
  rows.forEach(({ evaluation, task, score }) => {
    batch.update(doc(db, 'taskEvaluations', evaluation.id), {
      confirmedProgressRate: Number(evaluation.selfProgressRate),
      confirmedResultRate: Number(evaluation.selfResultRate),
      confirmedExecutionScore: score.execution,
      confirmedActualScore: score.actual,
      confirmedExceededRequirement: false,
      exceededDecision: 'NOT_REQUESTED', exceededDecisionReason: '', exceededDecisionByUserId: KpiWorkflowState.user.uid, exceededDecisionByName: KpiWorkflowState.profile.fullName || '', exceededDecisionAt: serverTimestamp(),
      bonusDecision: 'NOT_REQUESTED',
      bonusDecisionReason: '',
      bonusDecisionByUserId: KpiWorkflowState.user.uid,
      bonusDecisionByName: KpiWorkflowState.profile.fullName || '',
      bonusDecisionAt: serverTimestamp(),
      bonusAwarded: false,
      bonusType: '',
      bonusRate: 0,
      bonusBasisScore: 0,
      bonusScore: 0,
      bonusConfirmedAt: null,
      bonusConfirmedByUserId: '',
      bonusConfirmedByName: '',
      reviewerComment: 'Xác nhận theo điểm tự đánh giá đã chọn hàng loạt.',
      status: 'CONFIRMED',
      scoreLocked: true,
      reviewedByUserId: KpiWorkflowState.user.uid,
      reviewedByName: KpiWorkflowState.profile.fullName || '',
      confirmedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    batch.update(doc(db, 'tasks', task.id), {
      scoringStatus: 'CONFIRMED',
      scoreLocked: true,
      confirmedActualScore: score.actual,
      bonusDecision: 'NOT_REQUESTED',
      bonusDecisionReason: '',
      bonusDecisionByUserId: KpiWorkflowState.user.uid,
      bonusDecisionByName: KpiWorkflowState.profile.fullName || '',
      bonusDecisionAt: serverTimestamp(),
      bonusAwarded: false,
      bonusType: '',
      bonusRate: 0,
      bonusBasisScore: 0,
      bonusScore: 0,
      bonusConfirmedAt: null,
      bonusConfirmedByUserId: '',
      bonusConfirmedByName: '',
      updatedAt: serverTimestamp(),
      updatedByUserId: KpiWorkflowState.user.uid,
      updatedByName: KpiWorkflowState.profile.fullName || ''
    });
  });
  await batch.commit();

  /* V1.20.0: cập nhật state cục bộ ngay sau write thành công; onSnapshot sẽ
     hòa giải lại serverTimestamp sau đó. Không loadAll toàn phạm vi chỉ vì
     một lô xác nhận vừa thay đổi. */
  rows.forEach(({ evaluation, task, score }) => {
    Object.assign(evaluation, {
      confirmedProgressRate: Number(evaluation.selfProgressRate),
      confirmedResultRate: Number(evaluation.selfResultRate),
      confirmedExecutionScore: score.execution,
      confirmedActualScore: score.actual,
      confirmedExceededRequirement: false,
      exceededDecision: 'NOT_REQUESTED',
      exceededDecisionReason: '',
      exceededDecisionByUserId: KpiWorkflowState.user.uid,
      exceededDecisionByName: KpiWorkflowState.profile.fullName || '',
      bonusDecision: 'NOT_REQUESTED',
      bonusDecisionReason: '',
      bonusDecisionByUserId: KpiWorkflowState.user.uid,
      bonusDecisionByName: KpiWorkflowState.profile.fullName || '',
      bonusAwarded: false,
      bonusType: '',
      bonusRate: 0,
      bonusBasisScore: 0,
      bonusScore: 0,
      reviewerComment: 'Xác nhận theo điểm tự đánh giá đã chọn hàng loạt.',
      status: 'CONFIRMED',
      scoreLocked: true,
      reviewedByUserId: KpiWorkflowState.user.uid,
      reviewedByName: KpiWorkflowState.profile.fullName || ''
    });
    Object.assign(task, {
      scoringStatus: 'CONFIRMED',
      scoreLocked: true,
      confirmedActualScore: score.actual,
      bonusDecision: 'NOT_REQUESTED',
      bonusAwarded: false,
      bonusRate: 0,
      bonusBasisScore: 0,
      bonusScore: 0
    });
  });
  scheduleKpiLiveRender();
  await audit('CONFIRM_TASK_SCORES_BATCH', { count: rows.length, evaluationIds: rows.map(row => row.evaluation.id) });
}

function openPersonPlanDetail(uid) {
  const user = KpiWorkflowState.users.find(item => item.id === uid) || { id: uid, fullName: 'Cá nhân' };
  const registrations = regsForPerson(uid);
  const tasks = rowsForPerson(uid);
  const pending = registrations.filter(item => item.status === 'PENDING');
  const canApprove = pending.some(canApproveRegistration);
  const rows = [
    ...registrations.map(item => ({ kind: 'registration', ...item })),
    ...tasks.filter(task => !registrations.some(item => item.taskId === task.id)).map(item => ({ kind: 'task', ...item }))
  ];

  const groupKeyFor = item => clean(item.registrationGroupId || item.standardTaskId || item.standardTaskCode || item.taskCode || item.id);
  const groupCounts = rows.reduce((map, item) => {
    const key = groupKeyFor(item);
    map.set(key, (map.get(key) || 0) + 1);
    return map;
  }, new Map());
  const emittedGroups = new Set();
  const tableRows = rows.map(item => {
    const key = groupKeyFor(item);
    const count = groupCounts.get(key) || 1;
    let groupHeader = '';
    if (count > 1 && !emittedGroups.has(key)) {
      emittedGroups.add(key);
      const groupPending = registrations.filter(reg => groupKeyFor(reg) === key && reg.status === 'PENDING' && canApproveRegistration(reg));
      const groupName = item.standardTaskName || item.title || '';
      const groupCode = item.standardTaskCode || item.taskCode || '';
      groupHeader = `<tr class="kpi-registration-group-row"><td colspan="7"><div><strong>${esc(groupCode)} — ${esc(groupName)}</strong><span>${count} công việc cá nhân</span>${groupPending.length ? `<button class="kpi-button danger" type="button" data-reject-registration-group="${esc(key)}">Không duyệt cả nhóm</button>` : ''}</div></td></tr>`;
    }
    const canManagerCancel = item.kind === 'registration' && canCancelRegistrationAsManager(item);
    const personalLabel = count > 1 ? (item.title || item.description || item.standardTaskName || '') : (item.standardTaskName || item.title || '');
    return `${groupHeader}<tr>
      <td>${item.kind === 'registration' && item.status === 'PENDING' ? `<input type="checkbox" data-reg-review value="${esc(item.id)}" ${canApproveRegistration(item) ? 'checked' : 'disabled'}>` : '—'}</td>
      <td>${count > 1 ? `<span class="kpi-small">Công việc cá nhân ${Number(item.personalItemOrder || 0) || ''}</span><br>` : `<strong>${esc(item.standardTaskCode || item.taskCode || '')}</strong><br>`}${esc(personalLabel)}</td>
      <td>${fmt(item.baseScore)}</td><td>${coefficientPercent(item.difficultyCoefficient)}</td><td>${fmt(item.maximumConvertedScore)}</td>
      <td>${esc(item.status === 'PENDING' ? 'Chờ duyệt' : item.status === 'REJECTED' ? 'Không duyệt' : item.planApprovalStatus === 'APPROVED' || item.status === 'APPROVED' ? 'Đã duyệt' : item.status || '')}</td>
      <td>${item.kind === 'registration' && item.status === 'PENDING' && canApproveRegistration(item)
        ? `<button class="kpi-button danger" type="button" data-registration-reject="${esc(item.id)}">Không duyệt</button>`
        : canManagerCancel ? `<button class="kpi-button danger" type="button" data-cancel-registration-manager="${esc(item.id)}">Hủy đăng ký cho nhân viên</button>` : '—'}</td>
    </tr>`;
  }).join('');

  const root = modal(`Kế hoạch của ${user.fullName || ''}`, `
    <div class="registration-modal-tools">
      ${canApprove ? '<button id="regSelectAll" class="kpi-button secondary" type="button">Chọn tất cả</button><button id="regClearAll" class="kpi-button secondary" type="button">Bỏ chọn tất cả</button>' : ''}
    </div>
    <div class="kpi-table-wrap registration-plan-table-wrap"><table class="kpi-table registration-plan-table"><thead><tr><th>Duyệt</th><th>Đầu việc</th><th>Điểm chuẩn</th><th>Hệ số độ khó</th><th>Điểm tối đa</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>
      ${tableRows}
    </tbody></table></div>`,
    canApprove ? '<button class="kpi-button secondary" data-kpi-close type="button">Đóng</button><button id="personProductCatalog" class="kpi-button secondary" type="button">Danh mục sản phẩm</button><button id="regApproveSelected" class="kpi-button" type="button">Duyệt mục đã chọn</button>' : '<button class="kpi-button secondary" data-kpi-close type="button">Đóng</button><button id="personProductCatalog" class="kpi-button" type="button">Danh mục sản phẩm</button>'
  );

  root.querySelector('#personProductCatalog')?.addEventListener('click', () => { closeModal(); openProductCatalog(uid); });
  root.querySelector('#regSelectAll')?.addEventListener('click', () => root.querySelectorAll('[data-reg-review]:not(:disabled)').forEach(input => { input.checked = true; }));
  root.querySelector('#regClearAll')?.addEventListener('click', () => root.querySelectorAll('[data-reg-review]').forEach(input => { input.checked = false; }));
  root.querySelectorAll('[data-reject-registration-group]').forEach(button => {
    button.addEventListener('click', async () => {
      const key = button.dataset.rejectRegistrationGroup;
      const groupPending = registrations.filter(item => groupKeyFor(item) === key && item.status === 'PENDING' && canApproveRegistration(item));
      if (!groupPending.length) return;
      const reason = await ModalService.prompt('Nhập lý do không duyệt toàn bộ nhóm công việc này:', { title:'Không duyệt cả nhóm', label:'Lý do', required:true, confirmText:'Không duyệt cả nhóm' });
      if (!clean(reason)) return;
      button.disabled = true;
      try {
        await TaskRegistrationService.rejectMany(groupPending, reason);
        closeModal();
        scheduleKpiLiveRender();
      } catch (error) {
        ModalService.alert(friendlyErrorMessage(error, 'Không thể từ chối toàn bộ nhóm đăng ký.'));
        button.disabled = false;
      }
    });
  });
  root.querySelectorAll('[data-registration-reject]').forEach(button => {
    button.addEventListener('click', async () => {
      const registration = registrations.find(item => item.id === button.dataset.registrationReject);
      if (!registration) return;
      const reason = await ModalService.prompt('Nhập lý do không duyệt đầu việc này:', { title:'Không duyệt đăng ký', label:'Lý do', required:true, confirmText:'Không duyệt' });
      if (!clean(reason)) return;
      button.disabled = true;
      try {
        await TaskRegistrationService.reject(registration, reason);
        closeModal();
      } catch (error) {
        ModalService.alert(friendlyErrorMessage(error, 'Không thể từ chối đăng ký này.'));
        button.disabled = false;
      }
    });
  });
  root.querySelectorAll('[data-cancel-registration-manager]').forEach(button => {
    button.addEventListener('click', async () => {
      const registration = registrations.find(item => item.id === button.dataset.cancelRegistrationManager);
      if (!registration) return;
      const taskName = registration.standardTaskName || registration.title || 'đầu việc này';
      if (!await ModalService.confirm(`Hủy đăng ký “${taskName}” của ${user.fullName || 'nhân viên'}? Đầu việc sẽ trở lại danh mục để đăng ký lại khi kế hoạch được mở.`)) return;
      button.disabled = true;
      try {
        await TaskRegistrationService.cancelRegistration(registration, { asManager: true });
        closeModal();
        scheduleKpiLiveRender();
      } catch (error) {
        ModalService.alert(friendlyErrorMessage(error, 'Không thể hủy đăng ký cho nhân viên.'));
        button.disabled = false;
      }
    });
  });
  root.querySelector('#regApproveSelected')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const ids = [...root.querySelectorAll('[data-reg-review]:checked')].map(input => input.value);
    const selected = pending.filter(item => ids.includes(item.id));
    if (!selected.length) {
      ModalService.alert('Chưa chọn đầu việc để duyệt.');
      return;
    }

    try {
      button.disabled = true;
      button.textContent = 'Đang duyệt...';
      if (selected.length) {
        const approved = await approveRegistrationsWithLegacyRecovery(selected);
        if (approved === null) {
          button.disabled = false;
          button.textContent = 'Duyệt mục đã chọn';
          return;
        }
      }
      // Chỉ các mục được chọn được duyệt; mục không chọn vẫn chờ cho đến khi có quyết định Duyệt/Không duyệt rõ ràng.
      closeModal();
    } catch (error) {
      console.error('TASK_REGISTRATION_BATCH_APPROVE_FAILED', error);
      ModalService.alert(friendlyErrorMessage(error, 'Không duyệt được các đầu việc đã chọn.'));
      if (button?.isConnected) {
        button.disabled = false;
        button.textContent = 'Duyệt mục đã chọn';
      }
    }
  });
}
function renderEvaluationDashboard() {
  const target = el('kpiTaskList');
  if (!target) return;
  setTextSafe('kpiMainCardTitle', 'Đánh giá và xác nhận nhiệm vụ');
  setTextSafe('kpiMainCardHint', 'Chọn nhân viên, chọn nhiệm vụ cần xác nhận hoặc mở chi tiết để điều chỉnh điểm có căn cứ.');
  target.innerHTML = '<div id="kpiCompactEvaluation"></div>';
  renderCompactEvaluationPanel(el('kpiCompactEvaluation'));
}

function renderReportDashboard() {
  const target = el('kpiTaskList');
  if (!target) return;
  const hasCdtn = Permissions.isCdtnMember();
  const canAggregateCdtn = Permissions.canViewCdtnAggregateReport(
    hasActiveApprovalDelegation('CONFIRM_EVALUATIONS', 'CDTN')
      || hasActiveApprovalDelegation('APPROVE_REGISTRATIONS', 'CDTN')
  );
  const aggregateTitle = fullScopeRole() ? 'Tổng hợp toàn Trung tâm' : 'Tổng hợp Phòng/Khu';
  setTextSafe('kpiMainCardTitle', 'Báo cáo và tổng hợp KPI');
  setTextSafe('kpiMainCardHint', 'Xem kết quả đánh giá cá nhân trong kỳ.');
  target.innerHTML = `<div class="kpi-report-options">
    <button id="reportPersonal" class="kpi-report-option is-personal" type="button"><span>📄</span><strong>Báo cáo KPI cá nhân</strong><small>Xem kết quả đánh giá cá nhân.</small></button>
    <button id="reportProfile" class="kpi-report-option is-profile" type="button"><span>🪪</span><strong>Thông tin Mẫu 01</strong><small>Cập nhật thông tin phục vụ báo cáo.</small></button>
    <button id="reportProductCatalog" class="kpi-report-option is-profile" type="button"><span>🗂️</span><strong>Danh mục sản phẩm cá nhân</strong><small>Xem và in các nhiệm vụ đã được duyệt.</small></button>
    ${canViewDepartmentReport() ? `<button id="reportDepartment" class="kpi-report-option is-department" type="button"><span>📊</span><strong>${aggregateTitle}</strong><small>${fullScopeRole() ? 'Lọc toàn Trung tâm hoặc từng Phòng/Khu.' : 'Mỗi cá nhân gồm nhiệm vụ chuyên môn và Chi đoàn.'}</small></button>` : ''}
    ${canAggregateCdtn ? '<button id="reportCdtnAggregate" class="kpi-report-option is-department" type="button"><span>📈</span><strong>Tổng hợp Chi đoàn</strong><small>Báo cáo quản trị riêng hoạt động đoàn viên; không tạo xếp loại cá nhân thứ hai.</small></button>' : ''}
  </div>`;
  el('reportPersonal')?.addEventListener('click', () => openReport());
  el('reportProfile')?.addEventListener('click', openKpiProfileEditor);
  el('reportProductCatalog')?.addEventListener('click', () => openProductCatalog(KpiWorkflowState.user.uid));
  el('reportDepartment')?.addEventListener('click', () => openDepartmentReport({
    forcedDepartmentId: fullScopeRole() ? '' : profileDepartmentId(),
    allowAllCenter: fullScopeRole(),
    title: aggregateTitle
  }));
  el('reportCdtnAggregate')?.addEventListener('click', async () => {
    if (activeScopeDepartmentId() !== 'CDTN' || !KpiWorkflowState.tasks.some(task => taskScopeDepartmentId(task) === 'CDTN')) {
      KpiWorkflowState.scopeDepartmentId = 'CDTN';
      await loadAll();
    }
    openDepartmentReport({ forcedDepartmentId: 'CDTN', title: 'Tổng hợp Chi đoàn' });
  });
}

function openKpiProfileEditor() {
  if (!KpiWorkflowState.period) return;
  const profile = { ...(KpiWorkflowState.profile || {}), ...(KpiWorkflowState.kpiProfile || {}) };
  modal('Thông tin Mẫu 01', `<form class="kpi-form-grid">
    <label class="kpi-field full"><span>Họ và tên</span><input id="profileFullName" value="${esc(profile.fullName || '')}" disabled></label>
    <label class="kpi-field"><span>Ngày sinh</span><input id="profileBirthDate" type="date" value="${esc(profile.dateOfBirth || profile.birthDate || '')}"></label>
    <label class="kpi-field"><span>Chức vụ Đảng</span><input id="profilePartyPosition" value="${esc(profile.partyPosition || profile.dangPosition || '')}"></label>
    <label class="kpi-field"><span>Chức vụ chính quyền</span><input id="profileGovernmentPosition" value="${esc(profile.governmentPosition || profile.position || '')}"></label>
    <label class="kpi-field"><span>Chức vụ đoàn thể</span><input id="profileUnionPosition" value="${esc(profile.unionPosition || profile.doanThePosition || '')}"></label>
    <label class="kpi-field full"><span>Đơn vị công tác</span><input id="profileDepartmentName" value="${esc(profile.departmentName || profile.unitName || profile.departmentId || '')}"></label>
  </form>`, '<button class="kpi-button secondary" data-kpi-close type="button">Hủy</button><button id="saveKpiProfile" class="kpi-button" type="button">Lưu thông tin</button>');

  el('saveKpiProfile')?.addEventListener('click', async () => {
    const recordId = `${KpiWorkflowState.period.id}_${KpiWorkflowState.user.uid}`;
    await setDoc(doc(db, 'kpiProfiles', recordId), {
      periodId: KpiWorkflowState.period.id,
      userId: KpiWorkflowState.user.uid,
      fullName: KpiWorkflowState.profile.fullName || '',
      departmentId: KpiWorkflowState.profile.departmentId || '',
      dateOfBirth: clean(el('profileBirthDate').value),
      partyPosition: clean(el('profilePartyPosition').value),
      governmentPosition: clean(el('profileGovernmentPosition').value),
      unionPosition: clean(el('profileUnionPosition').value),
      departmentName: clean(el('profileDepartmentName').value),
      createdAt: KpiWorkflowState.kpiProfile?.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });
    closeModal();
    await loadAll();
    message('Đã cập nhật thông tin Mẫu 01.', 'ok');
  });
}

function summaryForUser(userId) {
  const departmentId = activeScopeDepartmentId();
  const common = commonAssessmentForUser(userId, departmentId)
    || (userId === KpiWorkflowState.user?.uid ? KpiWorkflowState.common : null);
  return calculateKpiSummary(scoreRowsForUser(userId), commonScoreSnapshot(common).total);
}

function scoreRowsForUserInDepartment(userId, departmentId) {
  const targetDepartmentId = normalizeDepartment(departmentId);
  return KpiWorkflowState.tasks
    .filter(task => task.ownerUserId === userId && taskScopeDepartmentId(task) === targetDepartmentId)
    .map(task => {
      const evaluation = KpiWorkflowState.evaluations.find(item => item.taskId === task.id && item.ownerUserId === userId);
      const score = evaluationScoreSnapshot(evaluation);
      return {
        ...task,
        recognized: score.hasScore,
        confirmedActualScore: score.actualScore,
        appliedScoreStatus: score.official ? 'OFFICIAL' : score.hasScore ? 'SELF' : 'EMPTY',
        includedInA: task.includedInA === true
      };
    });
}

function summaryForUserInDepartment(userId, departmentId) {
  const target = normalizeDepartment(departmentId);
  const common = commonAssessmentForUser(userId, target)
    || (userId === KpiWorkflowState.user?.uid ? commonAssessmentForUser(userId, target) : null);
  return calculateKpiSummary(
    scoreRowsForUserInDepartment(userId, target),
    commonScoreSnapshot(common).total
  );
}

function homeDepartmentForUser(userId) {
  const user = KpiWorkflowState.users.find(item => item.id === userId || item.uid === userId);
  return normalizeDepartment(user?.departmentId || (userId === KpiWorkflowState.user?.uid ? profileDepartmentId() : ''));
}

function personalTasksForUser(userId) {
  const homeDepartmentId = homeDepartmentForUser(userId);
  return KpiWorkflowState.tasks.filter(task => {
    if (task.ownerUserId !== userId || task.active === false) return false;
    const scope = taskScopeDepartmentId(task);
    return scope === homeDepartmentId || scope === 'CDTN';
  });
}

function scoreRowsForUserCombined(userId) {
  return personalTasksForUser(userId).map(task => {
    const evaluation = KpiWorkflowState.evaluations.find(item => item.taskId === task.id && item.ownerUserId === userId);
    const score = evaluationScoreSnapshot(evaluation);
    return {
      ...task,
      recognized: score.hasScore,
      confirmedActualScore: score.actualScore,
      bonusScore: score.bonusScore || 0,
      appliedScoreStatus: score.official ? 'OFFICIAL' : score.hasScore ? 'SELF' : 'EMPTY',
      includedInA: task.includedInA === true
    };
  });
}

function summaryForUserCombined(userId) {
  const homeDepartmentId = homeDepartmentForUser(userId);
  const common = commonAssessmentForUser(userId, homeDepartmentId);
  return calculateKpiSummary(scoreRowsForUserCombined(userId), commonScoreSnapshot(common).total);
}

function scoreStateForUserCombined(userId) {
  const rows = scoreRowsForUserCombined(userId);
  const homeDepartmentId = homeDepartmentForUser(userId);
  const common = commonAssessmentForUser(userId, homeDepartmentId);
  const commonScore = commonScoreSnapshot(common);
  const summary = calculateKpiSummary(rows, commonScore.total);
  const relevantTasks = personalTasksForUser(userId).filter(taskRequiresOfficialEvaluation);
  const evaluations = relevantTasks.map(task => KpiWorkflowState.evaluations.find(item => item.taskId === task.id && item.ownerUserId === userId));
  const taskScores = evaluations.map(evaluationScoreSnapshot);
  const hasAny = taskScores.some(item => item.hasScore) || commonScore.hasScore;
  const allOfficial = relevantTasks.length > 0 && taskScores.every(item => item.official && item.bonusResolved !== false) && commonScore.official;
  if (!summary.hasCalculationBasis) return { code:'NO_BASIS', label:'Chưa đủ cơ sở tính', detail:'Tổng điểm kế hoạch của nhiệm vụ chuyên môn và Chi đoàn bằng 0.', className:'is-empty' };
  if (allOfficial) return { code:'OFFICIAL', label:'Điểm chính thức', detail:'Nhiệm vụ chuyên môn, Chi đoàn và tiêu chí chung đã được xác nhận.', className:'is-official' };
  if (hasAny) return { code:'SELF', label:'Điểm tự đánh giá', detail:'Kết quả đang dùng điểm tự đánh giá chưa khóa.', className:'is-provisional' };
  return { code:'EMPTY', label:'Chưa tự đánh giá', detail:'Chưa có điểm nhiệm vụ chuyên môn hoặc Chi đoàn.', className:'is-empty' };
}

function evaluationStateForUser(userId) {
  return scoreStateForUser(userId).label;
}

function scoreStateForUserInDepartment(userId, departmentId) {
  const target = normalizeDepartment(departmentId);
  const rows = scoreRowsForUserInDepartment(userId, target);
  const common = commonAssessmentForUser(userId, target);
  const commonScore = commonScoreSnapshot(common);
  const summary = calculateKpiSummary(rows, commonScore.total);
  const relevantTasks = KpiWorkflowState.tasks.filter(task => task.ownerUserId === userId && taskScopeDepartmentId(task) === target && taskRequiresOfficialEvaluation(task));
  const evaluations = relevantTasks.map(task => KpiWorkflowState.evaluations.find(item => item.taskId === task.id && item.ownerUserId === userId));
  const taskScores = evaluations.map(evaluationScoreSnapshot);
  const hasAny = taskScores.some(item => item.hasScore) || commonScore.hasScore;
  const allOfficial = relevantTasks.length > 0 && taskScores.every(item => item.official && item.bonusResolved !== false) && commonScore.official;
  if (!summary.hasCalculationBasis) return { code:'NO_BASIS', label:'Chưa đủ cơ sở tính', detail:'Tổng điểm A của phạm vi này bằng 0.', className:'is-empty' };
  if (allOfficial) return { code:'OFFICIAL', label:'Điểm chính thức', detail:'Các nhiệm vụ trong phạm vi đã được xác nhận.', className:'is-official' };
  if (hasAny) return { code:'SELF', label:'Điểm tự đánh giá', detail:'Kết quả đang dùng điểm tự đánh giá chưa khóa.', className:'is-provisional' };
  return { code:'EMPTY', label:'Chưa tự đánh giá', detail:'Chưa có điểm nhiệm vụ trong phạm vi này.', className:'is-empty' };
}

function exceededSummaryForUser(userId, options = {}) {
  const tasks = personalTasksForUser(userId).filter(taskRequiresOfficialEvaluation);
  const allTasksCompleted = tasks.length > 0 && tasks.every(completedTaskForEvaluation);
  const officialOnly = options.officialOnly === true;
  let exceededTasks = 0;
  tasks.forEach(task => {
    const evaluation = KpiWorkflowState.evaluations.find(item => item.taskId === task.id && item.ownerUserId === userId);
    if (!evaluation) return;
    if (officialOnly) {
      if (evaluation.confirmedExceededRequirement === true) exceededTasks += 1;
    } else if (evaluation.status === 'CONFIRMED' && typeof evaluation.confirmedExceededRequirement === 'boolean') {
      if (evaluation.confirmedExceededRequirement === true) exceededTasks += 1;
    } else if (evaluation.isExceededRequirement === true) exceededTasks += 1;
  });
  return { totalTasks:tasks.length, exceededTasks, rate:tasks.length ? round2(exceededTasks * 100 / tasks.length) : 0, allTasksCompleted };
}

function ratingForUser(userId, total, options = {}) {
  const exceeded = exceededSummaryForUser(userId, options);
  return { ...exceeded, code:resolveQualityRating(total, exceeded) };
}

function bonusSummaryForUser(userId) {
  let approved = 0, pending = 0;
  personalTasksForUser(userId).forEach(task => {
    const score = evaluationScoreSnapshot(KpiWorkflowState.evaluations.find(item => item.taskId === task.id && item.ownerUserId === userId));
    approved += Math.max(0, Number(score.bonusScore || 0));
    if (score.bonusDecision === 'PENDING') pending += Math.max(0, Number(score.bonusRequestedScore || 0));
  });
  return { approved:round2(Math.min(7,approved)), pending:round2(pending) };
}

async function evidenceMapForTasks(tasks = []) {
  const entries = await Promise.all((tasks || []).map(async task => {
    try { return [task.id, await TaskEvidenceService.list(task)]; }
    catch (error) { console.warn('Không tải được minh chứng cho bảng KPI:', task.id, error); return [task.id, []]; }
  }));
  return new Map(entries);
}

function scorecardExceededLabel(evaluation) {
  // V1.21.1: Bảng KPI dùng X để đánh dấu công việc cá nhân đã đề nghị vượt yêu cầu phục vụ họp/xem xét.
  // Điều kiện 30% và kết quả chính thức vẫn chỉ dùng confirmedExceededRequirement === true.
  return evaluation?.isExceededRequirement === true || evaluation?.confirmedExceededRequirement === true ? 'X' : '';
}

function evidenceCellHtml(files = [], task = {}) {
  const legacy = clean(task.evidenceText) || safeHttpUrl(task.evidenceUrl || task.evidenceLink);
  if (!files.length && !legacy) return '—';
  const links = files.slice(0,5).map(file => evidenceLinkHtml(file.fileUrl, file.fileName || 'Mở tệp')).filter(Boolean).join('<br>');
  const more = files.length > 5 ? `<span class="kpi-small">+${files.length - 5} tệp</span>` : '';
  return `${clean(task.evidenceText) ? `<span>${esc(task.evidenceText)}</span><br>` : ''}${safeHttpUrl(task.evidenceUrl || task.evidenceLink) ? evidenceLinkHtml(task.evidenceUrl || task.evidenceLink,'Mở liên kết')+'<br>' : ''}${links}${more}`;
}

function scorecardSummaryData(userId, summaryData = summaryForUserCombined(userId)) {
  const scoredTasks = personalTasksForUser(userId).filter(taskRequiresOfficialEvaluation);
  const exceededCount = scoredTasks.reduce((count, task) => {
    const evaluation = KpiWorkflowState.evaluations.find(item => item.taskId === task.id && item.ownerUserId === userId);
    return count + (scorecardExceededLabel(evaluation) === 'X' ? 1 : 0);
  }, 0);
  return {
    A: Number(summaryData?.A || 0),
    B: Number(summaryData?.B || 0),
    kpi70: summaryData?.hasCalculationBasis === true ? Number(summaryData?.kpi70 || 0) : null,
    bonusC: Number(summaryData?.bonusC || 0),
    exceededCount,
    hasCalculationBasis: summaryData?.hasCalculationBasis === true
  };
}

function scorecardSummaryTableHtml(data = {}) {
  const kpiValue = data.hasCalculationBasis ? fmt(data.kpi70) : 'Chưa đủ cơ sở';
  return `<table class="kpi-score-summary-table"><tbody>
    <tr><th colspan="5">Điểm giá trị A</th><td>${fmt(data.A)}</td><th colspan="4">Điểm giá trị B</th><td>${fmt(data.B)}</td></tr>
    <tr><th colspan="10">KPI % (trục 4) = B/A*70 điểm (nếu B&gt;A thì KPI là 70)</th><td>${esc(kpiValue)}</td></tr>
    <tr><th colspan="10">Tổng số công việc vượt tiến độ và đạt yêu cầu chất lượng</th><td>${Number(data.exceededCount || 0)}</td></tr>
    <tr><th colspan="10">Tổng số điểm thưởng đối với các công việc vượt tiến độ và đạt yêu cầu chất lượng <em>(nếu có)</em></th><td>${fmt(data.bonusC)}</td></tr>
  </tbody></table>`;
}

function scorecardSummaryCardsHtml(data = {}) {
  return `<section class="kpi-score-summary-cards">
    <div><span>Điểm giá trị A</span><strong>${fmt(data.A)}</strong></div>
    <div><span>Điểm giá trị B</span><strong>${fmt(data.B)}</strong></div>
    <div><span>KPI trục 4 /70</span><strong>${data.hasCalculationBasis ? fmt(data.kpi70) : 'Chưa đủ cơ sở'}</strong></div>
    <div><span>Công việc vượt yêu cầu</span><strong>${Number(data.exceededCount || 0)}</strong></div>
    <div><span>Tổng điểm thưởng</span><strong>${fmt(data.bonusC)}</strong></div>
  </section>`;
}

function evidenceExportText(files = [], task = {}) {
  const parts = [];
  if (clean(task.evidenceText)) parts.push(clean(task.evidenceText));
  if (safeHttpUrl(task.evidenceUrl || task.evidenceLink)) parts.push(safeHttpUrl(task.evidenceUrl || task.evidenceLink));
  files.forEach(file => {
    const label = clean(file?.fileName || 'Tệp minh chứng');
    const url = safeHttpUrl(file?.fileUrl);
    parts.push(url ? `${label}: ${url}` : label);
  });
  return parts.filter(Boolean).join('\n') || '—';
}

function attachSynchronizedHorizontalScroll(root) {
  const wrap = root?.querySelector('.kpi-scorecard-desktop .kpi-table-wrap');
  const table = wrap?.querySelector('table');
  if (!wrap || !table || wrap.dataset.syncScroll === '1') return;
  wrap.dataset.syncScroll = '1';
  const bar = document.createElement('div');
  bar.className = 'kpi-scrollbar-top';
  const track = document.createElement('div');
  track.className = 'kpi-scrollbar-top-track';
  bar.appendChild(track);
  wrap.parentNode.insertBefore(bar, wrap);
  const refresh = () => { track.style.width = `${Math.max(table.scrollWidth, wrap.clientWidth)}px`; };
  bar.addEventListener('scroll', () => { if (wrap.scrollLeft !== bar.scrollLeft) wrap.scrollLeft = bar.scrollLeft; });
  wrap.addEventListener('scroll', () => { if (bar.scrollLeft !== wrap.scrollLeft) bar.scrollLeft = wrap.scrollLeft; });
  refresh();
  window.setTimeout(refresh, 50);
  window.addEventListener('resize', refresh, { once:true });
}

async function openUserScorecard(userId) {
  const user = KpiWorkflowState.users.find(item => item.id === userId) || (userId === KpiWorkflowState.user.uid ? KpiWorkflowState.profile : null);
  if (!user) return;
  const tasks = personalTasksForUser(userId).filter(taskRequiresOfficialEvaluation);
  const evidenceMap = await evidenceMapForTasks(tasks);
  const rows = tasks.map((task,index) => {
    const evaluation = KpiWorkflowState.evaluations.find(item => item.taskId === task.id && item.ownerUserId === userId);
    const applied = evaluationScoreSnapshot(evaluation);
    return `<tr><td>${index+1}</td><td><strong>${esc(task.taskCode || '')}</strong><br>${esc(task.title || '')}</td><td>${fmt(task.baseScore)}</td><td>${coefficientPercent(task.difficultyCoefficient)}</td><td>${fmt(task.maximumConvertedScore)}</td><td>${applied.progressRate ?? ''}${applied.progressRate !== null ? '%' : ''}</td><td>${applied.resultRate ?? ''}${applied.resultRate !== null ? '%' : ''}</td><td>${applied.hasScore ? fmt(applied.executionScore) : ''}</td><td><strong>${applied.hasScore ? fmt(applied.convertedActualScore) : ''}</strong></td><td class="m01-center">${esc(scorecardExceededLabel(evaluation))}</td><td>${evidenceCellHtml(evidenceMap.get(task.id) || [], task)}</td></tr>`;
  }).join('');
  const cards = tasks.map(task => {
    const evaluation = KpiWorkflowState.evaluations.find(item => item.taskId === task.id && item.ownerUserId === userId);
    const applied = evaluationScoreSnapshot(evaluation);
    const files = evidenceMap.get(task.id) || [];
    return `<article class="kpi-score-card"><strong>${esc(task.taskCode || '')} — ${esc(task.title || '')}</strong><div><span>Điểm chuẩn ${fmt(task.baseScore)}</span><span>Hệ số ${coefficientPercent(task.difficultyCoefficient)}</span><span>Tối đa ${fmt(task.maximumConvertedScore)}</span></div><div><span>Tiến độ ${applied.progressRate ?? '—'}%</span><span>Kết quả ${applied.resultRate ?? '—'}%</span><span>Điểm thực tế <b>${applied.hasScore ? fmt(applied.convertedActualScore) : '—'}</b></span></div><div><span>Vượt yêu cầu: <b>${esc(scorecardExceededLabel(evaluation) || 'Không')}</b></span><span>Minh chứng: ${files.length} tệp</span></div></article>`;
  }).join('');
  const scoreSummary = scorecardSummaryData(userId);
  const root = modal(`Bảng KPI · ${user.fullName || user.email || ''}`, `<div class="kpi-scorecard-desktop"><div class="kpi-table-wrap"><table class="kpi-table kpi-wide-table"><thead><tr><th>STT</th><th>Tên công việc</th><th>Điểm chuẩn</th><th>Hệ số độ khó</th><th>Điểm quy đổi tối đa</th><th>Tiến độ</th><th>Kết quả</th><th>Điểm thực hiện</th><th>Điểm quy đổi thực tế</th><th>Vượt yêu cầu</th><th>Minh chứng</th></tr></thead><tbody>${rows || '<tr><td colspan="11">Chưa có nhiệm vụ KPI đã duyệt.</td></tr>'}</tbody></table>${scorecardSummaryTableHtml(scoreSummary)}</div></div><div class="kpi-scorecard-mobile">${cards || '<div class="kpi-empty">Chưa có nhiệm vụ KPI đã duyệt.</div>'}${scorecardSummaryCardsHtml(scoreSummary)}</div>`, '<button class="kpi-button secondary" data-kpi-close type="button">Đóng</button>');
  attachSynchronizedHorizontalScroll(root);
}

function periodQuarterLabel(period = {}) {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(clean(period.startDate));
  if (!match) return clean(period.name || '');
  const q = Math.ceil(Number(match[2]) / 3);
  return `QUÝ ${({1:'I',2:'II',3:'III',4:'IV'})[q] || q} NĂM ${match[1]}`;
}

function userPositionWithDepartment(user = {}) {
  const position = clean(user.position || '');
  const department = departmentDisplayName(user.departmentId);
  if (!position) return department;
  const lower = position.toLocaleLowerCase('vi');
  if (lower.includes('phòng ') || lower.includes('khu ') || lower.includes('ban giám đốc')) return position;
  if (/^(trưởng|phó trưởng|quyền trưởng|phụ trách)/i.test(position)) {
    return `${position} ${department.replace(/^Phòng\s+/i,'').replace(/^Khu\s+/i,'Khu ')}`.replace(/\s+/g,' ').trim();
  }
  return `${position} ${department}`.replace(/\s+/g,' ').trim();
}

function productCatalogTasksForUser(userId) {
  return personalTasksForUser(userId)
    .filter(task => task.active !== false)
    .filter(task => !['HUY','CANCELLED'].includes(clean(task.status).toUpperCase()))
    .filter(task => clean(task.planApprovalStatus).toUpperCase() === 'APPROVED')
    .sort(compareTasksForDisplay);
}

function productCatalogPeriodTitle(period = {}, departmentName = '') {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(clean(period.startDate));
  if (!match) return `DANH MỤC SẢN PHẨM CHUẨN ${clean(period.name)} ${clean(departmentName).toLocaleUpperCase('vi')}`.replace(/\s+/g,' ').trim();
  const quarter = Math.ceil(Number(match[2]) / 3);
  const roman = ({1:'I',2:'II',3:'III',4:'IV'})[quarter] || quarter;
  return `DANH MỤC SẢN PHẨM CHUẨN QUÝ ${roman} ${clean(departmentName).toLocaleUpperCase('vi')} NĂM ${match[1]}`;
}

function productCatalogDeadlineLabel(task = {}) {
  const fixedDeadline = clean(task.fixedDeadlineDateKey);
  if (fixedDeadline) return dateVi(fixedDeadline);

  const deadlineMode = clean(task.deadlineMode).toUpperCase();
  const frequency = clean(task.frequency);
  const completionDeadline = clean(task.completionDeadline);
  const milestoneCount = Number(task.milestoneCount || 0);

  // Đầu việc có nhiều mốc/lượt không được in ngày cuối cùng như thể đó là hạn duy nhất.
  if (deadlineMode === 'EVENT_DRIVEN') return 'Theo từng lượt phát sinh';
  if (deadlineMode.endsWith('_MILESTONES') || milestoneCount > 1) {
    return [frequency, completionDeadline].filter(Boolean).join(' · ') || 'Theo các mốc trong kỳ';
  }

  const concreteDeadline = clean(task.deadlineDateKey);
  if (concreteDeadline) return dateVi(concreteDeadline);
  return completionDeadline || frequency || '';
}

async function openProductCatalog(userId = KpiWorkflowState.user.uid) {
  const user = KpiWorkflowState.users.find(item => item.id === userId) || (userId === KpiWorkflowState.user.uid ? KpiWorkflowState.profile : null);
  if (!user || !KpiWorkflowState.period) return;
  const tasks = productCatalogTasksForUser(userId);
  const departmentName = departmentDisplayName(user.departmentId);
  const rows = tasks.map((task,index)=> {
    const deadlineLabel = productCatalogDeadlineLabel(task);
    return `<tr><td>${index+1}</td><td>${esc(task.title || task.standardTaskName || '')}</td><td>${esc(task.description || task.outputRequirement || task.standardTaskOutputRequirement || '')}</td><td>${esc(deadlineLabel)}</td><td>${esc(clean(task.workType).toUpperCase()==='DOT_XUAT'?'Đột xuất':'Thường xuyên')}</td><td>${fmt(task.baseScore)}</td><td>${coefficientPercent(task.difficultyCoefficient)}</td><td>${fmt(task.maximumConvertedScore)}</td><td>${esc(task.standardTaskMandatoryEvidence || task.mandatoryEvidence || '—')}</td></tr>`;
  }).join('');
  const title = productCatalogPeriodTitle(KpiWorkflowState.period, departmentName);
  modal('Danh mục sản phẩm cá nhân', `<div id="kpiProductCatalogPrint" class="kpi-product-report kpi-report-print"><div class="m01-top kpi-product-official-header"><div class="m01-agency"><strong>SỞ Y TẾ<br>THÀNH PHỐ HỒ CHÍ MINH<br>TRUNG TÂM BẢO TRỢ XÃ HỘI TÂN HIỆP</strong></div><div class="m01-national"><strong>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</strong><div class="m01-motto"><strong>Độc lập - Tự do - Hạnh phúc</strong></div></div></div><div class="kpi-product-heading"><h2>${esc(title)}</h2><p><strong>Họ và tên:</strong> ${esc(user.fullName || '')}</p><p><strong>Chức vụ:</strong> ${esc(userPositionWithDepartment(user))}</p></div><div class="kpi-table-wrap"><table class="kpi-report-table kpi-product-table"><thead><tr><th>TT</th><th>Tên công việc</th><th>Kết quả đầu ra</th><th>Thời hạn hoàn thành</th><th>Loại công việc</th><th>Điểm chuẩn</th><th>Hệ số độ khó</th><th>Điểm quy đổi tối đa</th><th>Minh chứng</th></tr></thead><tbody>${rows || '<tr><td colspan="9">Chưa có nhiệm vụ được duyệt.</td></tr>'}</tbody></table></div><div class="kpi-product-totals"><p><strong>Tổng số nhiệm vụ thực hiện trong kỳ:</strong> ${tasks.length}</p><p><strong>Tổng số nhiệm vụ vượt tiến độ/chất lượng:</strong> ${exceededSummaryForUser(userId,{officialOnly:true}).exceededTasks}</p></div><div class="kpi-product-signatures"><div><strong>XÁC NHẬN CỦA LÃNH ĐẠO, ĐƠN VỊ</strong><br><em>(Ký, ghi rõ họ tên)</em><div class="kpi-signature-space"></div></div><div><strong>NGƯỜI LẬP DANH MỤC SẢN PHẨM</strong><br><em>(Ký, ghi rõ họ tên)</em><div class="kpi-signature-space"></div><strong>${esc(user.fullName || '')}</strong></div></div></div>`, '<button class="kpi-button secondary" data-kpi-close type="button">Đóng</button><button id="kpiPrintProductCatalog" class="kpi-button" type="button">🖨️ In danh mục</button>');
  el('kpiPrintProductCatalog')?.addEventListener('click',()=>window.print());
}

function openDepartmentReport(options = {}) {
  if (!canViewDepartmentReport()) {
    ModalService.alert('Tài khoản không có quyền xem báo cáo tổng hợp của Phòng/Khu hoặc Chi đoàn.');
    return;
  }

  const forcedDepartmentId = normalizeDepartment(options.forcedDepartmentId);
  const allowAllCenter = options.allowAllCenter === true && fullScopeRole();
  const departments = [...new Set([
    ...KpiWorkflowState.users.map(user => normalizeDepartment(user.departmentId)),
    ...KpiWorkflowState.tasks.map(task => taskScopeDepartmentId(task))
  ].filter(item => item && (item === 'CDTN' || PROFESSIONAL_DEPARTMENT_IDS.includes(item))))].sort();
  const selectableDepartments = allowAllCenter ? ['ALL', ...departments] : departments;
  const activeDepartment = activeScopeDepartmentId();
  const defaultDepartment = forcedDepartmentId || (allowAllCenter ? 'ALL' : (activeDepartment && activeDepartment !== 'ALL' ? activeDepartment : departments[0] || profileDepartmentId()));
  const canChooseDepartment = !forcedDepartmentId && selectableDepartments.length > 1;
  const selector = canChooseDepartment
    ? `<div class="department-report-scope"><span>Phạm vi tổng hợp</span><div class="department-report-scope-options">${selectableDepartments.map(item => `<button type="button" class="department-report-scope-button ${item === defaultDepartment ? 'is-active' : ''}" data-department-report-scope="${esc(item)}">${esc(item === 'ALL' ? 'Toàn Trung tâm' : departmentDisplayName(item))}</button>`).join('')}</div></div>`
    : '';
  const root = modal(options.title || 'Tổng hợp Phòng/Khu', `${selector}<div id="departmentReportContent"></div>`, '<button class="kpi-button secondary" data-kpi-close type="button">Đóng</button><button id="printDepartmentReport" class="kpi-button" type="button">🖨️ In báo cáo</button>');
  let selectedDepartmentId = defaultDepartment;

  const renderDepartment = () => {
    const departmentId = normalizeDepartment(selectedDepartmentId || defaultDepartment);
    const people = KpiWorkflowState.users
      .filter(user => user.active === true)
      .filter(user => {
        if (departmentId === 'ALL') return PROFESSIONAL_DEPARTMENT_IDS.includes(normalizeDepartment(user.departmentId));
        if (departmentId === 'CDTN') {
          const roles = Array.isArray(user.additionalRoles) ? user.additionalRoles.map(normalizeDepartment) : [];
          return roles.some(role => ['CDTN_BI_THU','CDTN_PHO_BI_THU','CDTN_UY_VIEN_BCH','CDTN_DOAN_VIEN'].includes(role))
            || KpiWorkflowState.tasks.some(task => task.ownerUserId === user.id && taskScopeDepartmentId(task) === 'CDTN');
        }
        return normalizeDepartment(user.departmentId) === departmentId;
      })
      .filter(user => {
        if (departmentId === 'CDTN') {
          return KpiWorkflowState.tasks.some(task => task.ownerUserId === user.id && taskScopeDepartmentId(task) === 'CDTN');
        }
        return personalTasksForUser(user.id).length > 0
          || KpiWorkflowState.commonAll.some(item => item.userId === user.id && normalizeDepartment(item.departmentId) === normalizeDepartment(user.departmentId));
      })
      .sort((a, b) => clean(a.fullName).localeCompare(clean(b.fullName), 'vi'));

    const isCdtnAggregate = departmentId === 'CDTN';
    const cdtnRoleName = user => {
      const roles = Array.isArray(user.additionalRoles) ? user.additionalRoles.map(normalizeDepartment) : [];
      if (roles.includes('CDTN_BI_THU')) return 'Bí thư Chi đoàn';
      if (roles.includes('CDTN_PHO_BI_THU')) return 'Phó Bí thư Chi đoàn';
      if (roles.includes('CDTN_UY_VIEN_BCH')) return 'Ủy viên BCH Chi đoàn';
      if (roles.includes('CDTN_DOAN_VIEN')) return 'Đoàn viên';
      return clean(user.cdtnRoleLabel) || 'Thành viên Chi đoàn';
    };

    const body = people.map((user, index) => {
      const data = isCdtnAggregate
        ? summaryForUserInDepartment(user.id, 'CDTN')
        : summaryForUserCombined(user.id);
      const userTasks = isCdtnAggregate
        ? KpiWorkflowState.tasks.filter(task => task.ownerUserId === user.id && task.active !== false && taskScopeDepartmentId(task) === 'CDTN')
        : personalTasksForUser(user.id);
      const professionalCount = userTasks.filter(task => taskScopeDepartmentId(task) !== 'CDTN').length;
      const cdtnCount = userTasks.filter(task => taskScopeDepartmentId(task) === 'CDTN').length;
      const exemptTaskCount = userTasks.filter(task => String(task.scoringStatus || '').toUpperCase() === 'ADJUSTMENT_EXEMPT').length;
      const taskCount = userTasks.length - exemptTaskCount;
      const hasOfficialScore = userTasks.some(task => {
        const evaluation = KpiWorkflowState.evaluations.find(item => item.taskId === task.id && item.ownerUserId === user.id);
        return evaluation?.status === 'CONFIRMED' || evaluation?.scoreLocked === true;
      });
      const hasSelfScore = userTasks.some(task => {
        const evaluation = KpiWorkflowState.evaluations.find(item => item.taskId === task.id && item.ownerUserId === user.id);
        return hasNumericValue(evaluation?.selfActualScore);
      });
      const stateLabel = hasOfficialScore ? 'Có điểm chính thức' : hasSelfScore ? 'Có điểm tự đánh giá' : 'Chưa tự đánh giá';

      if (isCdtnAggregate) {
        return `<tr><td>${index + 1}</td><td><strong>${esc(user.fullName || user.email || user.id)}</strong><br><span class="kpi-small">${esc(departmentDisplayName(user.departmentId))}</span></td><td>${esc(cdtnRoleName(user))}</td><td class="m01-center">${taskCount}${exemptTaskCount ? `<br><span class="kpi-small">${exemptTaskCount} miễn</span>` : ''}</td><td class="m01-center">${data.hasCalculationBasis ? fmt(data.A) : '0'}</td><td class="m01-center">${data.hasCalculationBasis ? fmt(data.B) : 'Chưa đủ cơ sở'}</td><td><span class="kpi-score-badge">${esc(stateLabel)}</span></td></tr>`;
      }

      const taskBreakdown = `${professionalCount} chuyên môn · ${cdtnCount} Chi đoàn`;
      const bonus = bonusSummaryForUser(user.id);
      const officialState = scoreStateForUserCombined(user.id).code === 'OFFICIAL';
      const rating = data.hasCalculationBasis ? ratingForUser(user.id, data.total100, { officialOnly: officialState }) : { code:'NO_BASIS' };
      const bonusDisplay = [
        bonus.approved > 0 ? `<strong>+${fmt(bonus.approved)}</strong><br><span class="kpi-small">Đã xác nhận</span>` : '',
        bonus.pending > 0 ? `<strong class="kpi-bonus-pending">+${fmt(bonus.pending)}</strong><br><span class="kpi-small">Chờ xác nhận</span>` : ''
      ].filter(Boolean).join('<br>') || '0';
      return `<tr><td>${index + 1}</td><td><strong>${esc(user.fullName || user.email || user.id)}</strong><br><span class="kpi-small">${esc(departmentDisplayName(user.departmentId))}</span></td><td>${esc(user.position || '')}</td><td class="m01-center">${esc(taskBreakdown)}${exemptTaskCount ? `<br><span class="kpi-small">${exemptTaskCount} miễn</span>` : ''}</td><td class="m01-center">${data.hasCalculationBasis ? fmt(data.kpi70) : 'Chưa đủ cơ sở'}</td><td class="m01-center">${bonusDisplay}</td><td class="m01-center">${fmt(data.common30)}</td><td class="m01-center"><strong>${data.hasCalculationBasis ? fmt(data.total100) : '—'}</strong></td><td>${esc(ratingName(rating.code))}</td><td><span class="kpi-score-badge">${esc(stateLabel)}</span></td></tr>`;
    }).join('');

    const scopeTitle = departmentId === 'ALL' ? 'Toàn Trung tâm' : departmentDisplayName(departmentId);
    const reportHeading = isCdtnAggregate ? 'BẢNG TỔNG HỢP HOẠT ĐỘNG CHI ĐOÀN' : 'BẢNG TỔNG HỢP KẾT QUẢ ĐÁNH GIÁ';
    const reportNote = isCdtnAggregate
      ? 'Báo cáo quản trị riêng nhiệm vụ Chi đoàn; không cộng tiêu chí chung, không tính tổng 100 điểm và không tạo mức xếp loại cá nhân thứ hai.'
      : 'Kết quả đánh giá theo từng cá nhân trong kỳ.';
    const tableHead = isCdtnAggregate
      ? '<tr><th>STT</th><th>Họ và tên</th><th>Vai trò Chi đoàn</th><th>Nhiệm vụ Chi đoàn</th><th>Điểm kế hoạch (A)</th><th>Điểm thực tế (B)</th><th>Trạng thái đánh giá</th></tr>'
      : '<tr><th>STT</th><th>Họ và tên</th><th>Chức vụ</th><th>Nhiệm vụ tính KPI</th><th>Điểm công việc</th><th>Điểm thưởng</th><th>Điểm tiêu chí chung</th><th>Tổng điểm</th><th>Mức xếp loại</th><th>Trạng thái điểm</th></tr>';
    root.querySelector('#departmentReportContent').innerHTML = people.length ? `<div id="departmentReportPrint" class="department-report kpi-report-print">
      <div class="department-report-heading"><strong>TRUNG TÂM BẢO TRỢ XÃ HỘI TÂN HIỆP</strong><h2>${reportHeading}</h2><p>${esc(KpiWorkflowState.period?.name || '')} · ${esc(scopeTitle)}</p><small>${esc(reportNote)}</small></div>
      <div class="kpi-table-wrap"><table class="kpi-report-table department-report-table"><thead>${tableHead}</thead><tbody>${body}</tbody></table></div>
      <div class="department-report-signatures"><div><strong>NGƯỜI LẬP BIỂU</strong><br><em>(Ký, ghi rõ họ tên)</em></div><div><strong>${isCdtnAggregate ? 'BÍ THƯ/PHÓ BÍ THƯ CHI ĐOÀN' : departmentId === 'ALL' ? 'BAN GIÁM ĐỐC' : 'TRƯỞNG PHÒNG/KHU'}</strong><br><em>(Ký, ghi rõ họ tên)</em></div></div>
    </div>` : '<div class="kpi-empty">Chưa có dữ liệu đánh giá trong kỳ này.</div>';
  };

  root.querySelectorAll('[data-department-report-scope]').forEach(button => button.addEventListener('click', () => {
    selectedDepartmentId = button.dataset.departmentReportScope || defaultDepartment;
    root.querySelectorAll('[data-department-report-scope]').forEach(item => item.classList.toggle('is-active', item === button));
    renderDepartment();
  }));
  root.querySelector('#printDepartmentReport')?.addEventListener('click', () => window.print());
  renderDepartment();
}

function taskStatus(task, ev) {
  if (String(task.scoringStatus || '').toUpperCase() === 'ADJUSTMENT_EXEMPT') return 'Miễn đánh giá do điều động · đã loại khỏi A';
  if (String(task.adjustmentStatus || '').toUpperCase() === 'REQUESTED') return 'Chờ duyệt điều chỉnh/miễn đánh giá';
  if (String(task.noOccurrenceStatus || '').toUpperCase() === 'CONFIRMED') return 'Không phát sinh · đã loại khỏi A';
  if (String(task.noOccurrenceStatus || '').toUpperCase() === 'REQUESTED') return 'Chờ xác nhận không phát sinh';
  if (ev?.status === 'CONFIRMED') return 'Đã xác nhận điểm';
  if (ev?.status === 'PENDING_REVIEW') return 'Chờ xác nhận';
  if (ev?.status === 'NEEDS_REVISION') return 'Yêu cầu bổ sung';
  if (task.planApprovalStatus === 'PENDING_APPROVAL') return 'Chờ duyệt kế hoạch';
  if (task.planApprovalStatus === 'REJECTED') return 'Kế hoạch không duyệt';
  if (task.planApprovalStatus === 'APPROVED') {
    const status = clean(task.status || task.assignmentStatus).toUpperCase();
    if (status === 'CHO_PHONG_KHU_TIEP_NHAN') return 'Chờ Phòng/Khu tiếp nhận';
    if (status === 'CHO_PHAN_CONG') return 'Phòng/Khu đã nhận · chờ phân công';
    if (['DA_PHAN_CONG', 'MOI_TIEP_NHAN'].includes(status)) return 'Chờ cá nhân tiếp nhận';
    return 'Đã duyệt kế hoạch';
  }
  return task.status === 'HOAN_THANH' ? 'Đã hoàn thành' : 'Đang thực hiện';
}
function renderTasks() {
  const target = el('kpiTaskList');
  if (!target) return;
  if (!KpiWorkflowState.period) { target.innerHTML = '<div class="kpi-empty">Chưa có kỳ đánh giá.</div>'; return; }
  const rows = KpiWorkflowState.tasks.filter(taskForCurrentUser).sort(compareTasksForDisplay);
  const myRegistrations = KpiWorkflowState.registrations.filter(r => r.userId === KpiWorkflowState.user.uid);
  if (!rows.length && !myRegistrations.length) { target.innerHTML = '<div class="kpi-empty">Chưa có đầu việc trong kỳ. Viên chức vào “Danh mục công việc”, tick chọn và đăng ký kế hoạch.</div>'; return; }
  const registrationRows = myRegistrations.filter(r => !r.taskId).map(r => `<tr><td><strong>${esc(r.standardTaskCode || r.id)}</strong><br>${esc(r.standardTaskName || r.title)}</td><td><span class="kpi-status">${r.status === 'PENDING' ? 'Chờ cấp có thẩm quyền duyệt' : r.status === 'REJECTED' ? 'Không duyệt' : 'Đã duyệt'}</span></td><td>${fmt(r.maximumConvertedScore)}</td><td>Chưa hình thành nhiệm vụ</td><td>${r.rejectionReason ? esc(r.rejectionReason) : '—'}</td></tr>`).join('');
  target.innerHTML = `<div class="kpi-table-wrap"><table class="kpi-table"><thead><tr><th>Mã/Nhiệm vụ</th><th>Kế hoạch</th><th>Điểm tối đa</th><th>Đánh giá</th><th>Thao tác</th></tr></thead><tbody>${registrationRows}${rows.map(task => {
    const ev = evaluationFor(task.id);
    const exemptFromScoring = String(task.scoringStatus || '').toUpperCase() === 'ADJUSTMENT_EXEMPT';
    const canApprove = canApproveDepartmentPlanTask(task) && task.planApprovalStatus === 'PENDING_APPROVAL';
    const taskEventDriven = String(task.deadlineMode || '').toUpperCase() === 'EVENT_DRIVEN';
    const eventDrivenReadyForAssessment = !taskEventDriven || String(task.status || '').toUpperCase() === 'HOAN_THANH' || Boolean(task.completedAt);
    const canSelf = task.ownerUserId === KpiWorkflowState.user.uid && task.planApprovalStatus === 'APPROVED' && eventDrivenReadyForAssessment && KpiWorkflowState.period.status !== 'COMPLETED' && ev?.status !== 'CONFIRMED' && ev?.scoreLocked !== true && String(task.noOccurrenceStatus || '').toUpperCase() !== 'CONFIRMED'
      && String(task.scoringStatus || '').toUpperCase() !== 'ADJUSTMENT_EXEMPT'
      && String(task.adjustmentStatus || '').toUpperCase() !== 'REQUESTED';
    return `<tr><td><strong>${esc(task.taskCode || task.standardTaskCode || task.id)}</strong><br>${esc(task.title)}<br><span class="kpi-small">${esc(task.ownerName || (clean(task.status).toUpperCase() === 'CHO_PHONG_KHU_TIEP_NHAN' ? 'Phòng/Khu chờ tiếp nhận' : 'Phòng/Khu chờ phân công'))}</span></td>
      <td><span class="kpi-status">${esc(taskStatus(task,ev))}</span><br><span class="kpi-small">${task.includedInA === true ? 'Thuộc A' : 'Chưa vào A'}</span>${task.isCoreTask === true ? '<br><strong>⭐ Cốt lõi</strong>' : ''}</td>
      <td>${fmt(task.maximumConvertedScore)}</td>
      <td>${exemptFromScoring ? '<strong>Không áp dụng</strong><br><span class="kpi-small">Miễn đánh giá do điều động</span>' : ev ? (()=>{const score=evaluationScoreSnapshot(ev);return `<strong>${fmt(score.convertedActualScore)}</strong><br><span class="kpi-small">Quy đổi thực tế · ${esc(score.label)}</span>`;})() : 'Chưa đánh giá'}</td>
      <td><div class="kpi-actions">${canApprove ? `<button class="kpi-button secondary" data-kpi-approve-plan="${task.id}">Duyệt vào kế hoạch</button><button class="kpi-button danger" data-kpi-reject-plan="${task.id}">Không duyệt</button>` : ''}${canSelf ? `<button class="kpi-button" data-kpi-self="${task.id}">${ev ? 'Cập nhật tự đánh giá' : 'Tự đánh giá'}</button>` : ''}<button class="kpi-button secondary" data-kpi-view="${task.id}">Chi tiết</button></div></td></tr>`;
  }).join('')}</tbody></table></div>`;
}

function canReviewEvaluation(ev, task) {
  if (!ev || !task || ev.ownerUserId === KpiWorkflowState.user.uid || ev.status === 'CONFIRMED' || ev.scoreLocked === true) return false;
  const owner = KpiWorkflowState.users.find(user => user.id === ev.ownerUserId)
    || { id: ev.ownerUserId, role: ev.ownerRole, departmentId: ev.homeDepartmentId || ev.departmentId, additionalRoles: ev.ownerAdditionalRoles || [] };
  return canReviewKpiOwner({
    currentUser: { id: KpiWorkflowState.user.uid, ...KpiWorkflowState.profile },
    users: KpiWorkflowState.users,
    delegations: KpiWorkflowState.delegations,
    owner,
    scopeDepartmentId: taskScopeDepartmentId(task)
  });
}

function groupPendingRegistrations() {
  const visible = KpiWorkflowState.registrations.filter(canApproveRegistration);
  const groups = new Map();
  visible.forEach(registration => {
    const key = registration.userId || registration.userName;
    if (!groups.has(key)) groups.set(key, { userId: registration.userId, userName: registration.userName, userPosition: registration.userPosition, userRole: registration.userRole, items: [] });
    groups.get(key).items.push(registration);
  });
  return [...groups.values()];
}

function renderReviews() {
  const target = el('kpiReviewList');
  if (!target) return;
  const groups = groupPendingRegistrations();
  const pending = KpiWorkflowState.evaluations.filter(ev => ['PENDING_REVIEW','NEEDS_REVISION'].includes(ev.status)).map(ev => ({ ev, task:KpiWorkflowState.tasks.find(t=>t.id===ev.taskId) })).filter(x => canReviewEvaluation(x.ev,x.task));
  const pendingCommon = KpiWorkflowState.commonAll.filter(item => {
    if (item.userId === KpiWorkflowState.user.uid || item.status !== 'SELF_COMPLETED') return false;
    const owner = KpiWorkflowState.users.find(user => user.id === item.userId) || { id:item.userId, role:item.ownerRole || 'STAFF', departmentId:item.departmentId, additionalRoles:item.ownerAdditionalRoles || [] };
    return canReviewKpiOwner({ currentUser:{ id:KpiWorkflowState.user.uid, ...KpiWorkflowState.profile }, users:KpiWorkflowState.users, delegations:KpiWorkflowState.delegations, owner, scopeDepartmentId:normalizeDepartment(item.scopeDepartmentId || item.departmentId) });
  });
  if (!groups.length && !pending.length && !pendingCommon.length) { target.innerHTML = '<div class="kpi-empty">Không có hồ sơ chờ xử lý.</div>'; return; }
  const groupHtml = groups.map(group => `<article class="registration-person-card"><div><strong>${esc(group.userName || 'Người đăng ký')}</strong><small>${esc(group.userPosition || '')}</small><span>${group.items.length} đầu việc chờ duyệt</span></div><div class="kpi-actions">${group.items.some(canApproveRegistration) ? `<button class="kpi-button" data-registration-group="${esc(group.userId)}">Xem chi tiết</button>` : '<span class="kpi-status">Chỉ xem</span>'}</div></article>`).join('');
  target.innerHTML = `${groupHtml}${pendingCommon.map(item=>`<div class="kpi-alert"><strong>Chờ xác nhận Mẫu 01 · 30 điểm</strong><br>${esc(item.fullName)} · Tự chấm ${fmt(item.selfTotal)}/30<div class="kpi-actions"><button class="kpi-button" data-kpi-review-common="${item.id}">Mở xác nhận</button></div></div>`).join('')}${pending.map(({ev,task})=>`<div class="kpi-alert ${ev.status==='NEEDS_REVISION'?'':'kpi-ok'}"><strong>${ev.status==='NEEDS_REVISION'?'Đang yêu cầu bổ sung':'Chờ xác nhận điểm'}</strong><br>${esc(task?.ownerName)} · ${esc(task?.title)}<div class="kpi-actions"><button class="kpi-button" data-kpi-review="${ev.id}">Mở xác nhận</button></div></div>`).join('')}`;
}

function openRegistrationGroup(userId) {
  const items = KpiWorkflowState.registrations.filter(r => r.userId === userId && r.status === 'PENDING');
  if (!items.length) return;
  const canApprove = items.some(canApproveRegistration);
  const body = `<div class="registration-modal-tools"><button id="regSelectAll" class="kpi-button secondary" type="button">Chọn tất cả</button><button id="regClearAll" class="kpi-button secondary" type="button">Bỏ chọn tất cả</button></div><div class="registration-approval-list">${items.map(r=>`<div class="registration-approval-row"><input type="checkbox" data-reg-review value="${esc(r.id)}" ${canApproveRegistration(r)?'checked':'disabled'}><span><strong>${esc(r.standardTaskCode || '')} — ${esc(r.title || r.standardTaskName || '')}</strong>${r.title && r.title !== r.standardTaskName ? `<small>Danh mục chuẩn: ${esc(r.standardTaskName || '')}</small>` : ''}<small>Điểm tối đa: ${fmt(r.maximumConvertedScore)}</small></span>${canApproveRegistration(r) ? `<button class="kpi-button danger" type="button" data-reject-one-registration="${esc(r.id)}">Không duyệt</button>` : ''}</div>`).join('')}</div>`;
  const footer = canApprove ? '<button class="kpi-button secondary" data-kpi-close type="button">Đóng</button><button id="regRejectAll" class="kpi-button danger" type="button">Không duyệt toàn bộ</button><button id="regApproveSelected" class="kpi-button" type="button">Duyệt các mục đã chọn</button>' : '<button class="kpi-button secondary" data-kpi-close type="button">Đóng</button>';
  const root = modal(`Đăng ký của ${items[0].userName || ''}`, body, footer);
  root.querySelector('#regSelectAll')?.addEventListener('click',()=>root.querySelectorAll('[data-reg-review]:not(:disabled)').forEach(x=>x.checked=true));
  root.querySelector('#regClearAll')?.addEventListener('click',()=>root.querySelectorAll('[data-reg-review]:not(:disabled)').forEach(x=>x.checked=false));
  root.querySelectorAll('[data-reject-one-registration]').forEach(button => button.addEventListener('click', async () => {
    const registration = items.find(item => item.id === button.dataset.rejectOneRegistration);
    if (!registration) return;
    const reason = await ModalService.prompt('Nhập lý do không duyệt đầu việc này:', { title:'Không duyệt đăng ký', label:'Lý do', required:true, confirmText:'Không duyệt' });
    if (!clean(reason)) return;
    button.disabled = true;
    try { await TaskRegistrationService.reject(registration, reason); closeModal(); }
    catch (error) { ModalService.alert(friendlyErrorMessage(error, 'Không thể từ chối đăng ký này.')); button.disabled = false; }
  }));
  root.querySelector('#regApproveSelected')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const ids = [...root.querySelectorAll('[data-reg-review]:checked')].map(x => x.value);
    const selected = items.filter(r => ids.includes(r.id));
    if (!selected.length) return ModalService.alert('Chưa chọn đầu việc để duyệt.');
    try {
      button.disabled = true;
      button.textContent = 'Đang duyệt...';
      const approved = await approveRegistrationsWithLegacyRecovery(selected);
      if (approved === null) { button.disabled = false; button.textContent = 'Duyệt các mục đã chọn'; return; }
      closeModal();
    } catch (error) {
      console.error('TASK_REGISTRATION_GROUP_APPROVE_FAILED', error);
      ModalService.alert(friendlyErrorMessage(error, 'Không duyệt được các đầu việc đã chọn.'));
      if (button?.isConnected) { button.disabled = false; button.textContent = 'Duyệt các mục đã chọn'; }
    }
  });
  root.querySelector('#regRejectAll')?.addEventListener('click', async()=>{
    const reason=await ModalService.prompt('Nhập lý do không duyệt toàn bộ:', { title:'Không duyệt toàn bộ', label:'Lý do', required:true, confirmText:'Không duyệt' });
    if(!clean(reason)) return;
    try { await TaskRegistrationService.rejectMany(items,reason); closeModal(); }
    catch (error) { ModalService.alert(friendlyErrorMessage(error, 'Không thể từ chối toàn bộ đăng ký.')); }
  });
}

async function handleRegistrationAction(event) {
  const approve = event.target.closest('[data-registration-approve]');
  const reject = event.target.closest('[data-registration-reject]');
  if (!approve && !reject) return false;
  const id = (approve || reject).dataset.registrationApprove || (approve || reject).dataset.registrationReject;
  const registration = KpiWorkflowState.registrations.find(r => r.id === id);
  if (!registration) return true;
  if (approve) {
    const core = await ModalService.confirm('Đầu việc này có phải là nhiệm vụ cốt lõi của cá nhân không?', { title: 'Xác định nhiệm vụ cốt lõi', confirmText: 'Là nhiệm vụ cốt lõi', cancelText: 'Không phải cốt lõi' });
    const approved = await approveRegistrationsWithLegacyRecovery([registration]);
    if (approved === null) return true;
  } else {
    const reason = await ModalService.prompt('Nhập lý do không duyệt đăng ký:');
    if (!clean(reason)) return true;
    await TaskRegistrationService.reject(registration, reason);
  }
  scheduleKpiLiveRender();
  return true;
}

async function taskAction(event) {
  if (await handleRegistrationAction(event)) return;
  const approve = event.target.closest('[data-kpi-approve-plan]');
  const reject = event.target.closest('[data-kpi-reject-plan]');
  const self = event.target.closest('[data-kpi-self]');
  const view = event.target.closest('[data-kpi-view]');
  if (approve) return approvePlanTask(approve.dataset.kpiApprovePlan);
  if (reject) return rejectPlanTask(reject.dataset.kpiRejectPlan);
  if (self) return openSelfAssessment(self.dataset.kpiSelf);
  if (view) return openTaskInfo(view.dataset.kpiView);
}
async function reviewAction(event) {
  const group = event.target.closest('[data-registration-group]');
  if (group) return openRegistrationGroup(group.dataset.registrationGroup);
  if (await handleRegistrationAction(event)) return;
  const approve = event.target.closest('[data-kpi-approve-plan]');
  const reject = event.target.closest('[data-kpi-reject-plan]');
  const review = event.target.closest('[data-kpi-review]');
  const reviewCommon = event.target.closest('[data-kpi-review-common]');
  if (approve) return approvePlanTask(approve.dataset.kpiApprovePlan);
  if (reject) return rejectPlanTask(reject.dataset.kpiRejectPlan);
  if (reviewCommon) return openCommonReview(reviewCommon.dataset.kpiReviewCommon);
  if (review) return openReview(review.dataset.kpiReview);
}

async function approvePlanTask(taskId) {
  const task = KpiWorkflowState.tasks.find(t=>t.id===taskId);
  if (!canApproveDepartmentPlanTask(task)) return;
  const core = await ModalService.confirm('Nhiệm vụ này có phải là nhiệm vụ cốt lõi của cá nhân không?', { title: 'Xác định nhiệm vụ cốt lõi', confirmText: 'Là nhiệm vụ cốt lõi', cancelText: 'Không phải cốt lõi' });
  await updateDoc(doc(db,'tasks',taskId), {
    planApprovalStatus:'APPROVED', includedInA: true, isCoreTask:core,
    planApprovedByUserId:KpiWorkflowState.user.uid, planApprovedByName:KpiWorkflowState.profile.fullName || '', planApprovedAt:serverTimestamp(), scoringEnabled:true, updatedAt:serverTimestamp(), updatedByUserId:KpiWorkflowState.user.uid, updatedByName:KpiWorkflowState.profile.fullName || ''
  });
  await audit('APPROVE_PLAN_TASK', { taskId, isCoreTask:core });
  scheduleKpiLiveRender();
}


async function rejectPlanTask(taskId){
  const task=KpiWorkflowState.tasks.find(t=>t.id===taskId);
  if(!canApproveDepartmentPlanTask(task))return;
  const reason=clean(await ModalService.prompt('Nhập lý do trả lại kế hoạch:')||'');
  if(!reason){ModalService.alert('Phải nhập lý do không duyệt.');return;}
  await updateDoc(doc(db,'tasks',taskId),{
    planApprovalStatus:'REJECTED',includedInA:false,planRejectedReason:reason,
    planRejectedByUserId:KpiWorkflowState.user.uid,planRejectedByName:KpiWorkflowState.profile.fullName||'',planRejectedAt:serverTimestamp(),updatedAt:serverTimestamp(),updatedByUserId:KpiWorkflowState.user.uid,updatedByName:KpiWorkflowState.profile.fullName||''
  });
  await audit('REJECT_PLAN_TASK',{taskId,reason});
  scheduleKpiLiveRender();
}

function reviewerForOwner(ownerId, task = null) {
  const owner = KpiWorkflowState.users.find(user => user.id === ownerId)
    || (ownerId === KpiWorkflowState.user?.uid ? { id: ownerId, ...KpiWorkflowState.profile } : null);
  const reviewer = resolveKpiReviewer({
    users: KpiWorkflowState.users,
    delegations: KpiWorkflowState.delegations,
    owner,
    scopeDepartmentId: task ? taskScopeDepartmentId(task) : normalizeDepartment(owner?.departmentId)
  });
  return { email: reviewer?.email || '', uid: reviewer?.id || reviewer?.uid || '', name: reviewer?.fullName || reviewer?.name || 'Cấp có thẩm quyền' };
}

function scoreBreakdownHtml(task, score, options = {}) {
  const title = options.title || 'Kết quả tính điểm';
  const compact = options.compact === true;
  const formulaProgress = fmt(score.progressRate);
  const formulaResult = fmt(score.resultRate);
  const actualProgress = fmt(options.actualProgressRate ?? score.progressRate);
  const actualResult = fmt(options.actualResultRate ?? score.resultRate);
  return `<div class="kpi-score-breakdown${compact ? ' is-compact' : ''}">
    <div class="kpi-score-breakdown-title">${esc(title)}</div>
    <div class="kpi-score-breakdown-grid">
      <div><span>Điểm chuẩn</span><strong>${fmt(score.baseScore ?? task.baseScore)}</strong></div>
      <div><span>Hệ số độ khó</span><strong>${coefficientPercent(score.coefficient ?? task.difficultyCoefficient)}</strong></div>
      <div><span>Điểm quy đổi tối đa</span><strong>${fmt(score.maximum)}</strong></div>
      <div><span>Tiến độ thực tế</span><strong>${actualProgress}%</strong></div>
      <div><span>Kết quả thực tế</span><strong>${actualResult}%</strong></div>
      <div><span>Tiến độ áp dụng</span><strong>${formulaProgress}%</strong></div>
      <div><span>Kết quả áp dụng</span><strong>${formulaResult}%</strong></div>
      <div class="is-execution"><span>Điểm thực hiện công việc</span><strong>${fmt(score.execution)}</strong></div>
      <div class="is-converted"><span>Điểm quy đổi thực tế</span><strong>${fmt(score.actual)}</strong></div>
    </div>
    <div class="kpi-score-formula">
      <span>Điểm thực hiện = ${fmt(score.baseScore ?? task.baseScore)} × (30% × ${formulaProgress}% + 70% × ${formulaResult}%) = <strong>${fmt(score.execution)}</strong></span>
      <span>Điểm quy đổi thực tế = ${fmt(score.execution)} × ${coefficientPercent(score.coefficient ?? task.difficultyCoefficient)} = <strong>${fmt(score.actual)}</strong></span>
    </div>
  </div>`;
}

async function openSelfAssessment(taskId) {
  const task = KpiWorkflowState.tasks.find(t => t.id === taskId); if (!task) return;
  const ev = evaluationFor(taskId) || {};
  if (String(task.noOccurrenceStatus || '').toUpperCase() === 'CONFIRMED') {
    ModalService.alert('Đầu việc đã được xác nhận không phát sinh, đã loại khỏi A và không thực hiện chấm điểm.');
    return;
  }
  if (ev.status === 'CONFIRMED' || ev.scoreLocked === true) {
    ModalService.alert('Kết quả nhiệm vụ đã được xác nhận và không thể chỉnh sửa.');
    return;
  }

  const itemized = String(task.trackingMode || 'FINAL_OUTPUT').toUpperCase() === 'ITEMIZED';
  const eventDriven = String(task.deadlineMode || '').toUpperCase() === 'EVENT_DRIVEN';
  if (eventDriven && String(task.status || '').toUpperCase() !== 'HOAN_THANH' && !task.completedAt) {
    ModalService.alert('Hãy kết thúc theo dõi phát sinh trong kỳ trước khi tự đánh giá nhiệm vụ.');
    return;
  }
  const recurring = ['DAILY','WEEKLY','MONTHLY'].includes(String(task.milestoneMode || '').toUpperCase());
  let workItems = [];
  let workSummary = null;
  if (itemized) {
    try {
      workItems = await TaskWorkItemService.list(task);
      workSummary = TaskWorkItemService.calculateSummary(workItems, task.workItemType, task);
    } catch (error) {
      ModalService.alert(friendlyErrorMessage(error, 'Không đọc được các công việc phát sinh trong kỳ.'));
      return;
    }
    if (!workSummary.count) {
      if (Number(workSummary.totalRecordedCount || 0) > 0) {
        ModalService.alert('Đã có lượt phát sinh nhưng chưa có lượt nào đủ điều kiện tính KPI. Lượt chưa hoàn thành và chưa đến hạn chưa bị tính 0%; hãy đánh giá khi đã có lượt hoàn thành hoặc đã đến hạn.');
      } else {
        ModalService.alert('Đầu việc chưa có lượt phát sinh. Hãy ghi nhận việc phát sinh khi có yêu cầu thực tế; nếu cả kỳ không phát sinh, gửi đề nghị “Không phát sinh” tại Chi tiết nhiệm vụ.');
      }
      return;
    }
  }

  let milestoneItems = recurring ? milestonesForTask(task.id) : [];
  if (recurring && !milestoneItems.length) {
    try {
      milestoneItems = await TaskMilestoneService.list(task);
    } catch (error) {
      ModalService.alert(friendlyErrorMessage(error, 'Không đọc được mốc tiến độ của nhiệm vụ.'));
      return;
    }
  }
  const milestoneSummary = recurring ? calculateMilestoneProgress(milestoneItems, new Date()) : null;
  if (recurring && !milestoneSummary?.eligibleMilestones) {
    ModalService.alert('Chưa có mốc nào đủ điều kiện tính tiến độ: các mốc tương lai chưa hoàn thành sẽ chưa được đưa vào mẫu số.');
    return;
  }

  // V1.13.0: tiến độ KPI là dữ liệu hệ thống, người dùng không tự chọn.
  const automaticProgress = recurring
    ? Number(milestoneSummary.appliedProgressRate ?? 0)
    : eventDriven && workSummary
      ? Number(workSummary.appliedProgressRate ?? 0)
      : progressRateFromDates(
        task.deadline || task.dueDate,
        task.completedAt || task.completedDate,
        Boolean(task.completedAt || task.completedDate)
      );
  const initialProgress = Number(automaticProgress);
  const initialResult = Number(
    ev.selfResultRate
      ?? (itemized && workSummary ? workSummary.appliedResultRate : 100)
  );

  const incompleteWarning = itemized && workSummary.incompleteCount > 0
    ? `<div class="kpi-work-item-incomplete-note"><strong>${workSummary.incompleteCount} lượt chưa hoàn thành.</strong><span>${eventDriven ? 'Lượt chưa đến hạn chưa hoàn thành chưa bị tính 0%; tiến độ được tính từ các lượt đủ điều kiện.' : 'Các lượt chi tiết được dùng làm căn cứ theo dõi kết quả.'}</span></div>`
    : '';
  const workSummaryHtml = itemized ? `<div class="kpi-field full"><div class="kpi-work-item-evaluation-summary">
    <div><span>Tổng lượt ghi nhận (N)</span><strong>${workSummary.count}</strong></div>
    <div><span>Đã hoàn thành</span><strong>${workSummary.completedCount}/${workSummary.count}</strong></div>
    <div><span>${workSummary.workItemType === 'ATTENDANCE' ? 'Có mặt (T)' : 'Đúng hạn (T)'}</span><strong>${workSummary.onTimeCount}/${workSummary.count}</strong></div>
    <div><span>Đạt yêu cầu (K)</span><strong>${workSummary.qualifiedCount}/${workSummary.count}</strong></div>
    <div><span>Tiến độ theo lượt</span><strong>${fmt(workSummary.appliedProgressRate ?? workSummary.actualProgressRate)}%</strong></div>
    <div><span>Kết quả theo lượt</span><strong>${fmt(workSummary.appliedResultRate ?? workSummary.actualResultRate)}%</strong></div>
  </div>${incompleteWarning}<p class="kpi-small">Tiến độ được hệ thống xác định; cá nhân chỉ chọn <strong>Kết quả áp dụng</strong>.</p></div>` : '';

  const milestoneSummaryHtml = recurring ? `<div class="kpi-field full kpi-milestone-summary-card">
    <div class="kpi-milestone-score-hero"><div><span>Điểm tiến độ KPI do hệ thống tính</span><strong>${initialProgress}%</strong><small>Tạm tính theo ${milestoneSummary.eligibleMilestones}/${milestoneSummary.totalMilestones} mốc đủ điều kiện.</small></div><div class="kpi-milestone-average"><span>Trung bình trước quy đổi</span><strong>${milestoneSummary.averageRate === null ? '—' : fmt(milestoneSummary.averageRate)}%</strong></div></div>
    <div class="kpi-milestone-rule-note"><strong>Cách tính:</strong> Mốc đã hoàn thành được tính ngay, kể cả hoàn thành sớm. Đúng/sớm hạn = 100%; trễ 1–3 ngày = 80%; trễ 4–5 ngày = 60%; trễ trên 5 ngày = 0%. Mốc chưa hoàn thành và chưa đến hạn chưa tính; mốc đã đến hạn mà chưa hoàn thành = 0%.</div>
    ${milestoneDetailsHtml(milestoneSummary)}
  </div>` : '';

  const selfModalRoot = modal('Tự đánh giá nhiệm vụ', `<form id="kpiSelfForm" class="kpi-form-grid">
    <div class="kpi-field full kpi-assessment-task-heading"><strong>${esc(task.taskCode || '')} — ${esc(task.title)}</strong><span>Điểm tối đa: ${fmt(task.maximumConvertedScore)} · Minh chứng bắt buộc: ${esc(task.standardTaskMandatoryEvidence || task.mandatoryEvidence || 'Theo nhiệm vụ')}</span></div>
    ${milestoneSummaryHtml}
    ${workSummaryHtml}
    <input id="kpiSelfProgress" type="hidden" value="${initialProgress}">
    <div class="kpi-field"><label>Tiến độ áp dụng</label><div class="kpi-readonly-value"><strong>${initialProgress}%</strong></div><small>${recurring ? 'Tự động từ các mốc định kỳ đủ điều kiện tính.' : eventDriven ? 'Tự động từ các lượt phát sinh đủ điều kiện tính.' : 'Tự động từ hạn hoàn thành và thời điểm hoàn thành theo ngày lịch thực tế.'} Người dùng không được sửa.</small></div>
    <div class="kpi-field"><label>Kết quả áp dụng</label><select id="kpiSelfResult">${appendixRateOptions(initialResult)}</select><small>Đánh giá mức độ hoàn thành yêu cầu công việc. Yếu tố đúng/trễ hạn đã được hệ thống tính riêng ở Tiến độ áp dụng.</small></div>
    <div class="kpi-field full" id="kpiSelfCommentField"><label>Nhận xét kết quả, thành tích và hạn chế <span class="kpi-required-mark">*</span></label><textarea id="kpiSelfComment" rows="5" required aria-describedby="kpiSelfCommentHelp">${esc(ev.selfComment || '')}</textarea><small id="kpiSelfCommentHelp">Bắt buộc. Nêu ngắn gọn kết quả đạt được, hạn chế hoặc căn cứ tự đánh giá.</small><div id="kpiSelfCommentError" class="kpi-inline-field-error" hidden>Vui lòng nhập nhận xét trước khi gửi tự đánh giá.</div></div>
    <div id="kpiSelfFormError" class="kpi-field full kpi-form-error" hidden role="alert"></div>
    <div class="kpi-field full"><label class="kpi-checkbox-line"><input id="kpiExceeded" type="checkbox" ${ev.isExceededRequirement===true?'checked':''}> Đề nghị ghi nhận hoàn thành vượt mức yêu cầu</label><textarea id="kpiExceededText" rows="3" placeholder="Nêu rõ sản phẩm, khối lượng, chất lượng hoặc giá trị bổ sung...">${esc(ev.exceededRequirementDescription || '')}</textarea></div>
    <div class="kpi-field full kpi-bonus-box"><label class="kpi-checkbox-line"><input id="kpiBonusRequested" type="checkbox" ${ev.bonusRequested===true?'checked':''}> ⭐ Đề nghị điểm thưởng cho công việc nổi trội / sáng kiến mới</label>
      <div id="kpiBonusRequestFields" class="kpi-bonus-fields ${ev.bonusRequested===true?'':'kpi-hidden'}"><label>Loại đề nghị</label><select id="kpiBonusRequestType"><option value="OUTSTANDING" ${clean(ev.bonusRequestType||'OUTSTANDING')==='OUTSTANDING'?'selected':''}>Công việc nổi trội</option><option value="INNOVATION" ${clean(ev.bonusRequestType)==='INNOVATION'?'selected':''}>Sáng kiến / cách làm mới</option><option value="BOTH" ${clean(ev.bonusRequestType)==='BOTH'?'selected':''}>Nổi trội và có sáng kiến</option></select><label>Căn cứ đề nghị</label><textarea id="kpiBonusRequestReason" rows="3" placeholder="Nêu kết quả nổi trội, sáng kiến/cách làm mới và căn cứ minh chứng...">${esc(ev.bonusRequestReason||'')}</textarea><div id="kpiBonusRequestPreview" class="kpi-bonus-preview"></div><small>Điểm hiển thị chỉ là đề nghị tạm tính. Cấp có thẩm quyền có thể chấp thuận hoặc từ chối; điểm chính thức tính trên kết quả đã xác nhận.</small></div>
    </div>
    <div class="kpi-field full"><div id="kpiSelfScore"></div></div>
  </form>`, '<button class="kpi-button secondary" data-kpi-close type="button">Hủy</button><button id="kpiSubmitSelf" class="kpi-button" type="button">Gửi xác nhận</button>');

  const recalc = () => {
    const x = calculateTaskScore(task.baseScore, task.difficultyCoefficient, el('kpiSelfProgress').value, el('kpiSelfResult').value);
    el('kpiSelfScore').innerHTML = scoreBreakdownHtml(task, x, {
      title: 'Điểm tự đánh giá',
      actualProgressRate: recurring ? milestoneSummary.averageRate : (itemized ? workSummary.actualProgressRate : x.progressRate),
      actualResultRate: itemized ? workSummary.actualResultRate : x.resultRate
    });
    const requested = el('kpiBonusRequested')?.checked === true;
    const requestedScore = requested ? calculateBonusScore(x.actual, 0.05) : 0;
    if (el('kpiBonusRequestPreview')) el('kpiBonusRequestPreview').innerHTML = requested ? `<strong>Điểm thưởng đề nghị: +${fmt(requestedScore)}</strong><span>5% × ${fmt(x.actual)} điểm tự đánh giá · Chờ xác nhận.</span>` : '';
  };
  el('kpiSelfResult').addEventListener('change', recalc);
  el('kpiBonusRequested')?.addEventListener('change', event => { el('kpiBonusRequestFields')?.classList.toggle('kpi-hidden', !event.currentTarget.checked); recalc(); });
  recalc();

  const showSelfFormError = (message, field = null) => {
    const box = selfModalRoot?.querySelector('#kpiSelfFormError');
    if (box) { box.hidden = !message; box.textContent = message || ''; }
    selfModalRoot?.querySelectorAll('.kpi-field.is-invalid').forEach(node => node.classList.remove('is-invalid'));
    if (field) {
      const wrapper = field.closest('.kpi-field');
      wrapper?.classList.add('is-invalid');
      field.focus({ preventScroll: true });
      field.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };
  el('kpiSelfComment')?.addEventListener('input', () => {
    const error = el('kpiSelfCommentError');
    if (error) error.hidden = true;
    el('kpiSelfComment')?.closest('.kpi-field')?.classList.remove('is-invalid');
  });

  el('kpiSubmitSelf').addEventListener('click', async () => {
    showSelfFormError('');
    const commentField = el('kpiSelfComment');
    const comment = clean(commentField.value);
    if (!comment) {
      const error = el('kpiSelfCommentError');
      if (error) error.hidden = false;
      showSelfFormError('Vui lòng hoàn thiện trường bắt buộc trước khi gửi.', commentField);
      return;
    }
    let progress, result;
    try {
      progress = assessmentRate(initialProgress, 'Tiến độ áp dụng');
      result = assessmentRate(el('kpiSelfResult').value, 'Kết quả áp dụng');
    } catch (error) { showSelfFormError(friendlyErrorMessage(error)); return; }
    const score = calculateTaskScore(task.baseScore, task.difficultyCoefficient, progress, result);
    const reviewer = reviewerForOwner(KpiWorkflowState.user.uid, task);
    const exceeded = el('kpiExceeded').checked, exceededText = clean(el('kpiExceededText').value);
    if (exceeded && !exceededText) {
      showSelfFormError('Vui lòng nêu căn cứ khi đề nghị ghi nhận hoàn thành vượt mức yêu cầu.', el('kpiExceededText'));
      return;
    }
    const bonusRequested = el('kpiBonusRequested')?.checked === true;
    const bonusRequestType = bonusRequested ? clean(el('kpiBonusRequestType')?.value || 'OUTSTANDING') : '';
    const bonusRequestReason = bonusRequested ? clean(el('kpiBonusRequestReason')?.value) : '';
    if (bonusRequested && !bonusRequestReason) { showSelfFormError('Vui lòng nêu căn cứ khi đề nghị điểm thưởng.', el('kpiBonusRequestReason')); return; }
    const bonusRequestedScore = bonusRequested ? calculateBonusScore(score.actual, 0.05) : 0;
    const evaluationScope = taskScopeDepartmentId(task) || KpiWorkflowState.profile.departmentId || '';
    const evaluationPayload = {
      periodId: KpiWorkflowState.period.id, taskId: task.id, taskCode: task.taskCode || '', ownerUserId: KpiWorkflowState.user.uid, ownerName: KpiWorkflowState.profile.fullName || '', ownerRole: KpiWorkflowState.profile.role || '', departmentId: clean(ev.departmentId) || evaluationScope,
      trackingMode: itemized ? 'ITEMIZED' : 'FINAL_OUTPUT', actualWorkItemCount: itemized ? workSummary.count : null, actualCompletedCount: itemized ? workSummary.completedCount : null, actualOnTimeCount: itemized ? workSummary.onTimeCount : null, actualQualifiedCount: itemized ? workSummary.qualifiedCount : null, actualProgressRate: itemized ? workSummary.actualProgressRate : null, actualResultRate: itemized ? workSummary.actualResultRate : null,
      progressCalculationMode: recurring ? 'MILESTONE_AUTO' : eventDriven ? 'WORK_ITEM_AUTO' : 'DEADLINE_AUTO',
      progressMilestoneDueCount: recurring ? milestoneSummary.dueMilestones : null,
      progressMilestoneAverageRate: recurring ? milestoneSummary.averageRate : null,
      progressCalculatedAt: serverTimestamp(),
      selfProgressRate: progress, selfResultRate: result, selfExecutionScore: score.execution, selfActualScore: score.actual, selfComment: comment,
      confirmedProgressRate: null, confirmedResultRate: null, confirmedExecutionScore: null, confirmedActualScore: null, reviewerEmail: reviewer.email, reviewerUserId: reviewer.uid, reviewerName: reviewer.name,
      isExceededRequirement: exceeded, exceededRequirementDescription: exceededText,
      confirmedExceededRequirement: null, exceededDecision: exceeded ? 'PENDING' : 'NOT_REQUESTED', exceededDecisionReason: '', exceededDecisionByUserId: '', exceededDecisionByName: '', exceededDecisionAt: null,
      bonusRequested, bonusRequestType, bonusRequestReason, bonusRequestRate: bonusRequested ? 0.05 : 0, bonusRequestedBasisScore: bonusRequested ? score.actual : 0, bonusRequestedScore, bonusRequestedAt: bonusRequested ? serverTimestamp() : null,
      bonusDecision: bonusRequested ? 'PENDING' : 'NOT_REQUESTED', bonusDecisionReason: '', bonusDecisionByUserId: '', bonusDecisionByName: '', bonusDecisionAt: null,
      bonusAwarded: false, bonusType: '', bonusRate: 0, bonusBasisScore: 0, bonusScore: 0, bonusConfirmedByUserId: '', bonusConfirmedByName: '', bonusConfirmedAt: null,
      ownerLeaderLevel: clean(KpiWorkflowState.profile.leaderLevel || ''), ownerAdditionalRoles: Array.isArray(KpiWorkflowState.profile.additionalRoles) ? KpiWorkflowState.profile.additionalRoles : [],
      status: 'PENDING_REVIEW', formulaVersion: 'KPI_2026_PHU_LUC_4_AUTO_PROGRESS_V7', updatedAt: serverTimestamp(), createdAt: ev.createdAt || serverTimestamp()
    };
    evaluationPayload.homeDepartmentId = clean(task.homeDepartmentId || KpiWorkflowState.profile.departmentId || '');
    if (evaluationScope === 'CDTN') evaluationPayload.organizationId = 'CDTN';
    try {
      await setDoc(doc(db, 'taskEvaluations', `${KpiWorkflowState.period.id}_${task.id}`), evaluationPayload, { merge: true });
    } catch (error) {
      console.error('KPI_SELF_ASSESSMENT_DENIED', {
        taskId: task.id,
        taskCode: task.taskCode || '',
        ownerUserId: task.ownerUserId || '',
        currentUserId: KpiWorkflowState.user.uid,
        currentRole: KpiWorkflowState.profile.role || '',
        leaderLevel: KpiWorkflowState.profile.leaderLevel || '',
        profileDepartmentId: profileDepartmentId(),
        evaluationDepartmentId: evaluationPayload.departmentId,
        taskScopeDepartmentId: evaluationScope,
        scoringEnabled: task.scoringEnabled,
        active: task.active,
        errorCode: error?.code || '',
        errorMessage: error?.message || String(error)
      });
      showSelfFormError(friendlyErrorMessage(error, 'Không lưu được tự đánh giá.'));
      return;
    }
    try {
      await audit('SUBMIT_SELF_ASSESSMENT', { taskId, trackingMode: itemized ? 'ITEMIZED' : 'FINAL_OUTPUT', progressCalculationMode: evaluationPayload.progressCalculationMode, actualWorkItemCount: itemized ? workSummary.count : null, selfExecutionScore: score.execution, selfActualScore: score.actual, bonusRequested, bonusRequestType, bonusRequestedScore });
    } catch (auditError) {
      console.warn('Đã lưu tự đánh giá nhưng chưa ghi được nhật ký KPI:', auditError);
    }
    closeModal(); scheduleKpiLiveRender();
  });
}

function safeHttpUrl(value) {
  const text = clean(value);
  if (!/^https?:\/\//i.test(text)) return '';
  try { return new URL(text).href; } catch (_) { return ''; }
}

function evidenceLinkHtml(url, label = 'Mở minh chứng') {
  const href = safeHttpUrl(url);
  return href ? `<a class="kpi-evidence-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : '';
}

async function loadReviewEvidence(task) {
  const [filesResult, workItemsResult, milestonesResult] = await Promise.allSettled([
    TaskEvidenceService.list(task),
    TaskWorkItemService.list(task),
    TaskMilestoneService.list(task)
  ]);
  const value = result => result.status === 'fulfilled' && Array.isArray(result.value) ? result.value : [];
  return { files:value(filesResult), workItems:value(workItemsResult), milestones:value(milestonesResult) };
}

function reviewEvidenceHtml(task, context = {}) {
  const files = context.files || [];
  const workItems = context.workItems || [];
  const milestones = context.milestones || [];
  const taskLegacy = [];
  if (clean(task.evidenceText)) taskLegacy.push(`<div class="kpi-evidence-text">${esc(task.evidenceText)}</div>`);
  const legacyUrl = task.evidenceUrl || task.evidenceLink;
  if (safeHttpUrl(legacyUrl)) taskLegacy.push(evidenceLinkHtml(legacyUrl, task.evidenceFileName || 'Mở minh chứng nhiệm vụ'));

  const scopeLabels = { TASK:'Nhiệm vụ', WORK_ITEM:'Lượt công việc', MILESTONE:'Mốc tiến độ' };
  const fileRows = files.map(file => {
    const scopeType = clean(file.scopeType || 'TASK').toUpperCase();
    const scopeId = clean(file.scopeId);
    let scopeName = scopeLabels[scopeType] || 'Minh chứng';
    if (scopeType === 'WORK_ITEM') {
      const item = workItems.find(row => row.id === scopeId || row.id === file.workItemId);
      if (item) scopeName += ` · ${clean(item.title || item.reference || item.id)}`;
    } else if (scopeType === 'MILESTONE') {
      const item = milestones.find(row => row.id === scopeId || row.id === file.milestoneId);
      if (item) scopeName += ` · ${dateVi(item.dueDateKey || '')}`;
    }
    return `<div class="kpi-evidence-file"><div><strong>${esc(file.fileName || 'Tệp minh chứng')}</strong><span>${esc(scopeName)}</span></div>${evidenceLinkHtml(file.fileUrl, 'Mở tệp')}</div>`;
  }).join('');

  const workRows = workItems.filter(item => clean(item.evidenceText) || safeHttpUrl(item.evidenceUrl || item.evidenceLink)).map(item => `<div class="kpi-evidence-subitem"><strong>${esc(item.title || item.reference || 'Lượt công việc')}</strong>${clean(item.evidenceText) ? `<span>${esc(item.evidenceText)}</span>` : ''}${evidenceLinkHtml(item.evidenceUrl || item.evidenceLink, 'Mở minh chứng')}</div>`).join('');
  const milestoneRows = milestones.filter(item => clean(item.evidenceText) || safeHttpUrl(item.evidenceUrl || item.evidenceLink)).map(item => `<div class="kpi-evidence-subitem"><strong>Mốc ${esc(dateVi(item.dueDateKey || ''))}</strong>${clean(item.evidenceText) ? `<span>${esc(item.evidenceText)}</span>` : ''}${evidenceLinkHtml(item.evidenceUrl || item.evidenceLink, 'Mở minh chứng')}</div>`).join('');

  const hasEvidence = taskLegacy.length || fileRows || workRows || milestoneRows;
  return `<section class="kpi-review-evidence"><div class="kpi-review-section-head"><strong>Minh chứng thực hiện</strong><span>${files.length ? `${files.length} tệp đã lưu` : 'Nội dung và tệp do cá nhân cập nhật'}</span></div>${hasEvidence ? `${taskLegacy.join('')}${fileRows}${workRows}${milestoneRows}` : '<div class="kpi-evidence-empty">Chưa có minh chứng được lưu cho nhiệm vụ này.</div>'}</section>`;
}

function canResolveExceededDecision(ev, task) {
  if (!ev || !task || ev.ownerUserId === KpiWorkflowState.user.uid) return false;
  if (ev.status !== 'CONFIRMED' || ev.scoreLocked !== true || ev.isExceededRequirement !== true) return false;
  if (typeof ev.confirmedExceededRequirement === 'boolean') return false;
  const owner = KpiWorkflowState.users.find(user => user.id === ev.ownerUserId)
    || { id:ev.ownerUserId, role:ev.ownerRole, departmentId:ev.homeDepartmentId || ev.departmentId, additionalRoles:ev.ownerAdditionalRoles || [] };
  return canReviewKpiOwner({
    currentUser:{ id:KpiWorkflowState.user.uid, ...KpiWorkflowState.profile },
    users:KpiWorkflowState.users,
    delegations:KpiWorkflowState.delegations,
    owner,
    scopeDepartmentId:taskScopeDepartmentId(task)
  });
}

async function openExceededDecisionOnly(ev, task) {
  if (!canResolveExceededDecision(ev, task)) return;
  const context = await loadReviewEvidence(task);
  const root = modal('Xác nhận công việc vượt yêu cầu', `<div class="kpi-form-grid">
    <div class="kpi-field full"><strong>${esc(task.taskCode || '')} — ${esc(task.title || '')}</strong><span>${esc(task.ownerName || ev.ownerName || '')}</span></div>
    <div class="kpi-field full kpi-exceeded-box"><strong>Đề nghị của cá nhân</strong><span>${esc(ev.exceededRequirementDescription || 'Cá nhân đề nghị ghi nhận công việc vượt yêu cầu.')}</span></div>
    <div class="kpi-field"><label>Quyết định</label><select id="kpiLegacyExceededDecision"><option value="APPROVED">Xác nhận vượt yêu cầu</option><option value="REJECTED">Không xác nhận vượt</option></select></div>
    <div class="kpi-field full"><label>Căn cứ khi không xác nhận</label><textarea id="kpiLegacyExceededReason" rows="3"></textarea></div>
    <div class="kpi-field full">${reviewEvidenceHtml(task, context)}</div>
  </div>`, '<button class="kpi-button secondary" data-kpi-close type="button">Hủy</button><button id="kpiSaveLegacyExceeded" class="kpi-button" type="button">Lưu xác nhận</button>');
  root.querySelector('#kpiSaveLegacyExceeded')?.addEventListener('click', async event => {
    const decision = clean(root.querySelector('#kpiLegacyExceededDecision')?.value || 'APPROVED');
    const reason = clean(root.querySelector('#kpiLegacyExceededReason')?.value || '');
    if (decision === 'REJECTED' && !reason) return ModalService.alert('Hãy nhập căn cứ khi không xác nhận công việc vượt yêu cầu.');
    const button = event.currentTarget; button.disabled = true;
    try {
      await updateDoc(doc(db,'taskEvaluations',ev.id), {
        confirmedExceededRequirement: decision === 'APPROVED',
        exceededDecision: decision,
        exceededDecisionReason: decision === 'REJECTED' ? reason : '',
        exceededDecisionByUserId: KpiWorkflowState.user.uid,
        exceededDecisionByName: KpiWorkflowState.profile.fullName || '',
        exceededDecisionAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
      await audit('CONFIRM_EXCEEDED_REQUIREMENT_LEGACY', { taskId:task.id, evaluationId:ev.id, decision, reason });
      closeModal();
    } catch (error) { button.disabled = false; ModalService.alert(friendlyErrorMessage(error, 'Không lưu được xác nhận vượt yêu cầu.')); }
  });
}

async function openReview(evalId) {
  const ev = KpiWorkflowState.evaluations.find(e => e.id === evalId);
  const task = KpiWorkflowState.tasks.find(t => t.id === ev?.taskId);
  if (!ev || !task) return;
  if (canResolveExceededDecision(ev, task)) return openExceededDecisionOnly(ev, task);
  if (!canReviewEvaluation(ev, task)) return;

  const context = await loadReviewEvidence(task);
  const automaticProgress = assessmentRate(ev.selfProgressRate, 'Tiến độ tự động');
  const bonusRequested = ev.bonusRequested === true;
  const exceededRequested = ev.isExceededRequirement === true;
  const requestType = clean(ev.bonusRequestType || 'OUTSTANDING') || 'OUTSTANDING';
  const requestTypeLabel = ({OUTSTANDING:'Công việc nổi trội',INNOVATION:'Sáng kiến / cách làm mới',BOTH:'Nổi trội và có sáng kiến'})[requestType] || requestType;
  const bonusRequestHtml = bonusRequested ? `<div class="kpi-field full kpi-bonus-box">
    <div class="kpi-bonus-request-head"><strong>⭐ Đề nghị điểm thưởng của cá nhân</strong><span class="kpi-status">Chờ xác nhận</span></div>
    <div class="kpi-bonus-request-summary"><span><b>Loại:</b> ${esc(requestTypeLabel)}</span><span><b>Căn cứ:</b> ${esc(ev.bonusRequestReason || 'Chưa nêu căn cứ')}</span><span><b>Điểm đề nghị tạm tính:</b> +${fmt(ev.bonusRequestedScore || calculateBonusScore(ev.selfActualScore,0.05))}</span></div>
    <div class="kpi-field"><label>Quyết định điểm thưởng</label><select id="kpiBonusDecision"><option value="APPROVED">Chấp thuận điểm thưởng</option><option value="REJECTED">Không chấp thuận điểm thưởng</option></select></div>
    <div class="kpi-field full" id="kpiBonusRejectReasonField"><label>Lý do không chấp thuận</label><textarea id="kpiBonusDecisionReason" rows="3" placeholder="Bắt buộc khi không chấp thuận"></textarea></div>
    <div id="kpiBonusPreview" class="kpi-bonus-preview"></div>
  </div>` : `<div class="kpi-field full kpi-bonus-box"><strong>Điểm thưởng</strong><span>Cá nhân không đề nghị điểm thưởng đối với nhiệm vụ này.</span></div>`;

  const exceededOptions = exceededRequested
    ? '<option value="APPROVED">Xác nhận vượt yêu cầu</option><option value="REJECTED">Không xác nhận vượt</option>'
    : '<option value="NOT_REQUESTED">Không ghi nhận vượt yêu cầu</option><option value="APPROVED">Ghi nhận vượt yêu cầu</option>';
  const exceededHtml = `<div class="kpi-field full kpi-exceeded-box">
    <div class="kpi-review-section-head"><strong>Công việc vượt yêu cầu về tiến độ/chất lượng</strong><span>${exceededRequested ? 'Cá nhân có đề nghị' : 'Cá nhân không đề nghị'}</span></div>
    ${exceededRequested ? `<div class="kpi-evidence-text">${esc(ev.exceededRequirementDescription || 'Chưa nêu căn cứ')}</div>` : ''}
    <div class="kpi-field"><label>Quyết định của người xác nhận</label><select id="kpiExceededDecision">${exceededOptions}</select></div>
    <div class="kpi-field full" id="kpiExceededReasonField"><label>Căn cứ khi không xác nhận</label><textarea id="kpiExceededDecisionReason" rows="3"></textarea></div>
  </div>`;

  const root = modal('Xác nhận điểm nhiệm vụ', `<form class="kpi-form-grid kpi-review-form">
    <section class="kpi-review-section full"><header><strong>Thông tin nhiệm vụ</strong></header><div class="kpi-assessment-task-heading"><strong>${esc(task.ownerName)}</strong><span>${esc(task.title)}</span></div><div class="kpi-review-metrics"><div><span>Tiến độ tự đánh giá</span><strong>${ev.selfProgressRate}%</strong></div><div><span>Kết quả tự đánh giá</span><strong>${ev.selfResultRate}%</strong></div><div><span>Điểm tự đánh giá</span><strong>${fmt(ev.selfActualScore)}</strong></div></div></section>
    <input id="kpiConfirmProgress" type="hidden" value="${automaticProgress}">
    <section class="kpi-review-section full"><header><strong>Xác nhận kết quả</strong></header><div class="kpi-review-two-cols"><div class="kpi-field"><label>Tiến độ xác nhận</label><div class="kpi-readonly-value"><strong>${automaticProgress}%</strong></div></div><div class="kpi-field"><label>Kết quả xác nhận</label><select id="kpiConfirmResult">${appendixRateOptions(Number(ev.confirmedResultRate??ev.selfResultRate))}</select></div></div></section>
    <section class="kpi-review-section full"><header><strong>Minh chứng thực hiện</strong></header>${reviewEvidenceHtml(task, context)}</section>
    ${exceededHtml}
    ${bonusRequestHtml}
    <section class="kpi-review-section full"><header><strong>Nhận xét / căn cứ</strong></header><textarea id="kpiReviewerComment" rows="4">${esc(ev.reviewerComment||'')}</textarea></section>
    <div class="kpi-field full"><div id="kpiConfirmScore"></div></div></form>`,
    '<button id="kpiNeedRevision" class="kpi-button secondary" type="button">Yêu cầu bổ sung</button><button class="kpi-button secondary" data-kpi-close type="button">Hủy</button><button id="kpiConfirmEvaluation" class="kpi-button" type="button">Xác nhận điểm</button>');

  const recalc = () => {
    const x = calculateTaskScore(task.baseScore, task.difficultyCoefficient, automaticProgress, el('kpiConfirmResult').value);
    el('kpiConfirmScore').innerHTML = scoreBreakdownHtml(task, x, { title: 'Điểm xác nhận' });
    if (bonusRequested && el('kpiBonusPreview')) {
      const decision = el('kpiBonusDecision')?.value || 'APPROVED';
      const bonus = decision === 'APPROVED' ? calculateBonusScore(x.actual, 0.05) : 0;
      el('kpiBonusPreview').innerHTML = decision === 'APPROVED'
        ? `<strong>Điểm thưởng xác nhận: +${fmt(bonus)}</strong>`
        : '<strong>Điểm thưởng xác nhận: 0</strong>';
      el('kpiBonusRejectReasonField')?.classList.toggle('kpi-hidden', decision !== 'REJECTED');
    }
    const exceededDecision = el('kpiExceededDecision')?.value || (exceededRequested ? 'APPROVED' : 'NOT_REQUESTED');
    el('kpiExceededReasonField')?.classList.toggle('kpi-hidden', !(exceededRequested && exceededDecision === 'REJECTED'));
  };
  el('kpiConfirmResult')?.addEventListener('change', recalc);
  el('kpiBonusDecision')?.addEventListener('change', recalc);
  el('kpiExceededDecision')?.addEventListener('change', recalc);
  recalc();

  el('kpiNeedRevision')?.addEventListener('click', async () => {
    const note = clean(el('kpiReviewerComment').value);
    if (!note) { ModalService.alert('Nhập nội dung cần bổ sung.'); return; }
    await updateDoc(doc(db, 'taskEvaluations', ev.id), { status: 'NEEDS_REVISION', reviewerComment: note, reviewedByUserId: KpiWorkflowState.user.uid, reviewedByName: KpiWorkflowState.profile.fullName || '', updatedAt: serverTimestamp() });
    closeModal();
  });

  el('kpiConfirmEvaluation')?.addEventListener('click', async () => {
    const button = el('kpiConfirmEvaluation');
    if (button?.dataset?.saving === '1') return;
    let p, r;
    try { p = automaticProgress; r = assessmentRate(el('kpiConfirmResult').value, 'Kết quả xác nhận'); }
    catch (error) { ModalService.alert(friendlyErrorMessage(error)); return; }
    const note = clean(el('kpiReviewerComment').value);
    if (r !== Number(ev.selfResultRate) && !note) { ModalService.alert('Khi điều chỉnh Kết quả áp dụng khác tự đánh giá phải nhập lý do.'); return; }
    const x = calculateTaskScore(task.baseScore, task.difficultyCoefficient, p, r);

    const exceededDecision = clean(el('kpiExceededDecision')?.value || (exceededRequested ? 'APPROVED' : 'NOT_REQUESTED'));
    const exceededReason = exceededRequested && exceededDecision === 'REJECTED' ? clean(el('kpiExceededDecisionReason')?.value) : '';
    if (exceededRequested && exceededDecision === 'REJECTED' && !exceededReason) { ModalService.alert('Khi không xác nhận công việc vượt yêu cầu phải nhập căn cứ.'); return; }
    const confirmedExceededRequirement = exceededDecision === 'APPROVED';

    const bonusDecision = bonusRequested ? clean(el('kpiBonusDecision')?.value || 'APPROVED') : 'NOT_REQUESTED';
    const bonusDecisionReason = bonusRequested && bonusDecision === 'REJECTED' ? clean(el('kpiBonusDecisionReason')?.value) : '';
    if (bonusDecision === 'REJECTED' && !bonusDecisionReason) { ModalService.alert('Khi không chấp thuận điểm thưởng phải nhập lý do.'); el('kpiBonusDecisionReason')?.focus(); return; }
    const bonusAwarded = bonusRequested && bonusDecision === 'APPROVED';
    const bonusType = bonusAwarded ? requestType : '';
    const bonusRate = bonusAwarded ? 0.05 : 0;
    const bonusScore = bonusAwarded ? calculateBonusScore(x.actual, bonusRate) : 0;
    const bonusText = bonusRequested ? (bonusAwarded ? ` Điểm thưởng được chấp thuận +${fmt(bonusScore)}.` : ' Điểm thưởng không được chấp thuận.') : '';
    const exceededText = confirmedExceededRequirement ? ' Công việc được xác nhận vượt yêu cầu.' : '';
    if (!await ModalService.confirm(`Xác nhận điểm thực tế ${fmt(x.actual)} là kết quả chính thức.${exceededText}${bonusText}`)) return;
    if (button) { button.dataset.saving = '1'; button.disabled = true; button.textContent = 'Đang xác nhận…'; }
    try {
      const finalBonusFields = {
        bonusDecision, bonusDecisionReason,
        bonusDecisionByUserId: KpiWorkflowState.user.uid, bonusDecisionByName: KpiWorkflowState.profile.fullName || '', bonusDecisionAt: serverTimestamp(),
        bonusAwarded, bonusType, bonusRate, bonusBasisScore: bonusAwarded ? x.actual : 0, bonusScore,
        bonusConfirmedByUserId: bonusAwarded ? KpiWorkflowState.user.uid : '', bonusConfirmedByName: bonusAwarded ? (KpiWorkflowState.profile.fullName || '') : '', bonusConfirmedAt: bonusAwarded ? serverTimestamp() : null
      };
      const exceededFields = {
        confirmedExceededRequirement, exceededDecision, exceededDecisionReason: exceededReason,
        exceededDecisionByUserId: KpiWorkflowState.user.uid, exceededDecisionByName: KpiWorkflowState.profile.fullName || '', exceededDecisionAt: serverTimestamp()
      };
      const scoreBatch = writeBatch(db);
      scoreBatch.update(doc(db, 'taskEvaluations', ev.id), {
        confirmedProgressRate:p, confirmedResultRate:r, confirmedExecutionScore:x.execution, confirmedActualScore:x.actual,
        ...exceededFields, ...finalBonusFields,
        reviewerComment:note, status:'CONFIRMED', scoreLocked:true,
        reviewedByUserId:KpiWorkflowState.user.uid, reviewedByName:KpiWorkflowState.profile.fullName || '', confirmedAt:serverTimestamp(), updatedAt:serverTimestamp()
      });
      scoreBatch.update(doc(db, 'tasks', task.id), {
        scoringStatus:'CONFIRMED', scoreLocked:true, confirmedActualScore:x.actual,
        ...finalBonusFields,
        updatedAt:serverTimestamp(), updatedByUserId:KpiWorkflowState.user.uid, updatedByName:KpiWorkflowState.profile.fullName || ''
      });
      await scoreBatch.commit();
      Object.assign(ev, { confirmedProgressRate:p, confirmedResultRate:r, confirmedExecutionScore:x.execution, confirmedActualScore:x.actual, ...exceededFields, ...finalBonusFields, reviewerComment:note, status:'CONFIRMED', scoreLocked:true, reviewedByUserId:KpiWorkflowState.user.uid, reviewedByName:KpiWorkflowState.profile.fullName || '' });
      Object.assign(task, { scoringStatus:'CONFIRMED', scoreLocked:true, confirmedActualScore:x.actual, ...finalBonusFields });
      closeModal();
      void audit('CONFIRM_TASK_SCORE', { taskId:task.id, confirmedExecutionScore:x.execution, confirmedActualScore:x.actual, confirmedExceededRequirement, exceededDecision, exceededDecisionReason:exceededReason, bonusRequested, bonusDecision, bonusAwarded, bonusType, bonusRate, bonusScore, bonusDecisionReason });
      scheduleKpiLiveRender();
    } catch (error) {
      if (button) { button.dataset.saving = '0'; button.disabled = false; button.textContent = 'Xác nhận điểm'; }
      ModalService.alert(friendlyErrorMessage(error));
    }
  });
}

function openTaskInfo(taskId){
  const t=KpiWorkflowState.tasks.find(x=>x.id===taskId),e=evaluationFor(taskId);if(!t)return;
  const applied=evaluationScoreSnapshot(e);
  const scoreHtml=applied.hasScore
    ? scoreBreakdownHtml(t,calculateTaskScore(t.baseScore,t.difficultyCoefficient,applied.progressRate,applied.resultRate),{title:applied.label,compact:true})
    : '<div class="kpi-alert">Nhiệm vụ chưa có điểm tự đánh giá.</div>';
  modal('Chi tiết KPI nhiệm vụ',`<div class="kpi-form-grid"><div class="kpi-field full"><strong>${esc(t.taskCode||'')} — ${esc(t.title)}</strong></div><div class="kpi-field"><label>Người thực hiện</label><span>${esc(t.ownerName||'Chờ phân công')}</span></div><div class="kpi-field"><label>Trạng thái kế hoạch</label><span>${esc(taskStatus(t,e))}</span></div><div class="kpi-field"><label>Điểm chuẩn</label><span>${fmt(t.baseScore)}</span></div><div class="kpi-field"><label>Hệ số độ khó</label><span>${coefficientPercent(t.difficultyCoefficient)}</span></div><div class="kpi-field"><label>Điểm quy đổi tối đa</label><span>${fmt(t.maximumConvertedScore)}</span></div><div class="kpi-field"><label>Cốt lõi</label><span>${t.isCoreTask===true?'Có':'Không'}</span></div><div class="kpi-field full"><label>Minh chứng bắt buộc</label><span>${esc(t.standardTaskMandatoryEvidence||'—')}</span></div><div class="kpi-field full">${scoreHtml}</div>${applied.bonusRequested ? `<div class="kpi-field full kpi-bonus-box"><strong>Điểm thưởng</strong><span>${applied.bonusDecision === 'APPROVED' ? `Được chấp thuận · +${fmt(applied.bonusScore)}` : applied.bonusDecision === 'REJECTED' ? `Không được chấp thuận${applied.bonusDecisionReason ? ` · ${esc(applied.bonusDecisionReason)}` : ''}` : `Đã đề nghị · Chờ xác nhận (${fmt(applied.bonusRequestedScore)})`}</span></div>` : ''}</div>`);
}

function criteriaForUser(user = KpiWorkflowState.profile) {
  return commonCriteriaForProfile(user || {});
}

function openCommonCriteria(){
  if(!KpiWorkflowState.period)return;
  if(KpiWorkflowState.common?.status==='CONFIRMED'){ModalService.alert('Tiêu chí chung đã được xác nhận và không thể chỉnh sửa.');return;}
  const formType = reportFormTypeForProfile(KpiWorkflowState.profile || {});
  const criteria = criteriaForUser(KpiWorkflowState.profile);
  const items=KpiWorkflowState.common?.items||[];
  modal(`${formType === '01A' ? 'Mẫu 01A' : 'Mẫu 01B'} · Tiêu chí chung 30 điểm`,`<div class="kpi-criteria-list">${criteria.map(c=>{const v=items.find(x=>x.code===c.code)||{};return `<div class="kpi-criterion"><strong class="kpi-criterion-score">${c.code}<br>${c.max} điểm</strong><p class="kpi-criterion-text">${esc(c.text)}</p><div class="kpi-criterion-controls"><select data-common-code="${c.code}" aria-label="Kết quả tiêu chí ${c.code}"><option value="DAM_BAO" ${v.selfResult!=='KHONG_DAM_BAO'?'selected':''}>Đảm bảo</option><option value="KHONG_DAM_BAO" ${v.selfResult==='KHONG_DAM_BAO'?'selected':''}>Không đảm bảo</option></select><textarea data-common-note="${c.code}" rows="2" placeholder="Ghi chú/căn cứ" aria-label="Ghi chú tiêu chí ${c.code}">${esc(v.note||'')}</textarea></div></div>`;}).join('')}</div><div id="kpiCommonTotal" class="kpi-alert"></div>`, '<button class="kpi-button secondary" data-kpi-close type="button">Hủy</button><button id="kpiSaveCommon" class="kpi-button" type="button">Lưu tự đánh giá</button>');
  const calc=()=>{let total=0;criteria.forEach(c=>{if(document.querySelector(`[data-common-code="${c.code}"]`)?.value==='DAM_BAO')total+=c.max;});el('kpiCommonTotal').textContent=`Tổng điểm tiêu chí chung: ${total}/30`;return total;};document.querySelectorAll('[data-common-code]').forEach(x=>x.addEventListener('change',calc));calc();
  el('kpiSaveCommon').addEventListener('click',async()=>{const data=criteria.map(c=>{const result=document.querySelector(`[data-common-code="${c.code}"]`).value;const note=clean(document.querySelector(`[data-common-note="${c.code}"]`).value);if(result==='KHONG_DAM_BAO'&&!note)throw new Error(`Tiêu chí ${c.code} không đảm bảo phải có căn cứ.`);return {code:c.code,group:c.group,max:c.max,text:c.text,selfResult:result,selfScore:result==='DAM_BAO'?c.max:0,note};});try{const total=data.reduce((sum,x)=>sum+x.selfScore,0);const commonDepartmentId=profileDepartmentId();const commonId=commonAssessmentId(KpiWorkflowState.period.id,KpiWorkflowState.user.uid);const reviewer=reviewerForOwner(KpiWorkflowState.user.uid,null);await setDoc(doc(db,'commonCriteriaAssessments',commonId),{periodId:KpiWorkflowState.period.id,userId:KpiWorkflowState.user.uid,fullName:KpiWorkflowState.profile.fullName||'',ownerRole:KpiWorkflowState.profile.role||'',ownerLeaderLevel:KpiWorkflowState.profile.leaderLevel||'',departmentId:commonDepartmentId,scopeType:'PROFESSIONAL',formType,criteriaVersion:`${formType}-V1.18.0`,items:data,selfTotal:total,confirmedTotal:null,reviewerUserId:reviewer.uid,reviewerName:reviewer.name,status:'SELF_COMPLETED',updatedAt:serverTimestamp(),createdAt:KpiWorkflowState.common?.createdAt||serverTimestamp()},{merge:true});await audit('SAVE_COMMON_CRITERIA',{score:total,formType});closeModal();scheduleKpiLiveRender();}catch(err){ModalService.alert(friendlyErrorMessage(err));}});
}

function openCommonReview(assessmentId) {
  const assessment = KpiWorkflowState.commonAll.find(item => item.id === assessmentId);
  if (!assessment || assessment.userId === KpiWorkflowState.user.uid) return;
  const owner = KpiWorkflowState.users.find(user => user.id === assessment.userId) || { id:assessment.userId, role:assessment.ownerRole || 'STAFF', leaderLevel:assessment.ownerLeaderLevel || '', departmentId:assessment.departmentId };
  const allowed = canReviewKpiOwner({ currentUser:{ id:KpiWorkflowState.user.uid, ...KpiWorkflowState.profile }, users:KpiWorkflowState.users, delegations:KpiWorkflowState.delegations, owner, scopeDepartmentId:normalizeDepartment(assessment.departmentId) });
  if (!allowed) return;
  const formType = assessment.formType || reportFormTypeForProfile(owner);
  const criteria = commonCriteriaForProfile(formType === '01A' ? {role:'DEPARTMENT_LEADER'} : {role:'STAFF'});
  const items = assessment.items || [];
  modal(`Xác nhận ${formType === '01A' ? 'Mẫu 01A' : 'Mẫu 01B'} · 30 điểm`, `<p><strong>${esc(assessment.fullName)}</strong> · Tự chấm ${fmt(assessment.selfTotal)}/30</p><div class="kpi-criteria-list">${criteria.map(c=>{const v=items.find(x=>x.code===c.code)||{};const confirmed=v.confirmedResult||v.selfResult||'DAM_BAO';return `<div class="kpi-criterion"><strong class="kpi-criterion-score">${c.code}<br>${c.max} điểm</strong><p class="kpi-criterion-text">${esc(c.text)}<br><span class="kpi-small">Cá nhân: ${v.selfResult==='KHONG_DAM_BAO'?'Không đảm bảo':'Đảm bảo'}</span></p><div class="kpi-criterion-controls"><select data-confirm-common-code="${c.code}" aria-label="Kết quả xác nhận tiêu chí ${c.code}"><option value="DAM_BAO" ${confirmed==='DAM_BAO'?'selected':''}>Đảm bảo</option><option value="KHONG_DAM_BAO" ${confirmed==='KHONG_DAM_BAO'?'selected':''}>Không đảm bảo</option></select><textarea data-confirm-common-note="${c.code}" rows="2" placeholder="Căn cứ khi điều chỉnh" aria-label="Căn cứ tiêu chí ${c.code}">${esc(v.confirmedNote||v.note||'')}</textarea></div></div>`;}).join('')}</div><div id="kpiConfirmCommonTotal" class="kpi-alert"></div><div class="kpi-confirm-once"><strong>Xác nhận một lần</strong><span>Sau khi xác nhận, 30 điểm tiêu chí chung trở thành điểm chính thức và không thể chỉnh sửa trực tiếp.</span></div>`, '<button class="kpi-button secondary" data-kpi-close type="button">Hủy</button><button id="kpiConfirmCommonSave" class="kpi-button" type="button">Xác nhận 30 điểm</button>');
  const calc=()=>{let total=0;criteria.forEach(c=>{if(document.querySelector(`[data-confirm-common-code="${c.code}"]`)?.value==='DAM_BAO')total+=c.max;});el('kpiConfirmCommonTotal').textContent=`Điểm xác nhận: ${total}/30`;return total;};
  document.querySelectorAll('[data-confirm-common-code]').forEach(input=>input.addEventListener('change',calc));calc();
  el('kpiConfirmCommonSave').addEventListener('click', async()=>{
    try {
      const confirmedItems = criteria.map(c=>{const original=items.find(x=>x.code===c.code)||{};const result=document.querySelector(`[data-confirm-common-code="${c.code}"]`).value;const note=clean(document.querySelector(`[data-confirm-common-note="${c.code}"]`).value);if(result!==original.selfResult&&!note)throw new Error(`Tiêu chí ${c.code} điều chỉnh khác tự chấm phải có căn cứ.`);return {...original,code:c.code,group:c.group,max:c.max,text:c.text,confirmedResult:result,confirmedScore:result==='DAM_BAO'?c.max:0,confirmedNote:note};});
      const total=confirmedItems.reduce((sum,item)=>sum+item.confirmedScore,0);
      if(!await ModalService.confirm(`Xác nhận ${fmt(total)}/30 điểm tiêu chí chung là điểm chính thức? Sau thao tác này không thể chỉnh sửa trực tiếp.`))return;
      await updateDoc(doc(db,'commonCriteriaAssessments',assessment.id),{items:confirmedItems,formType,criteriaVersion:`${formType}-V1.18.0`,confirmedTotal:total,status:'CONFIRMED',confirmedByUserId:KpiWorkflowState.user.uid,confirmedByName:KpiWorkflowState.profile.fullName||'',confirmedAt:serverTimestamp(),updatedAt:serverTimestamp()});
      await audit('CONFIRM_COMMON_CRITERIA',{userId:assessment.userId,score:total,formType});closeModal();scheduleKpiLiveRender();
    } catch(error){ModalService.alert(friendlyErrorMessage(error));}
  });
}

async function lockDepartmentPlan() {
  if (!KpiWorkflowState.period || !canLockPlan()) {
    ModalService.alert('Tài khoản không có quyền thực hiện thao tác này.');
    return;
  }
  if (KpiWorkflowState.plan?.locked === true) {
    ModalService.alert('Đăng ký kế hoạch đã được khóa.');
    return;
  }

  const departmentId = planManagementDepartmentId();
  const approved = KpiWorkflowState.tasks.filter(task =>
    taskScopeDepartmentId(task) === departmentId
    && task.planApprovalStatus === 'APPROVED'
    && task.includedInA === true
  );

  if (!approved.length) {
    ModalService.alert('Chưa có nhiệm vụ kế hoạch được duyệt.');
    return;
  }

  const userPlanScores = {};
  approved.forEach(task => {
    const ownerUserId = clean(task.ownerUserId);
    if (!ownerUserId) return;
    userPlanScores[ownerUserId] = round2(
      Number(userPlanScores[ownerUserId] || 0)
      + Number(task.maximumConvertedScore || 0)
    );
  });
  const approvedUserCount = Object.keys(userPlanScores).length;
  const approvedTaskCount = approved.length;
  const peopleLabel = approvedUserCount > 0
    ? `${approvedUserCount} cá nhân`
    : 'các cá nhân trong Phòng/Khu';

  if (!await ModalService.confirm(
    `Khóa đăng ký kế hoạch của ${departmentId}? Hiện có ${approvedTaskCount} đầu việc `
    + `đã được duyệt cho ${peopleLabel}. Sau khi khóa, người dùng không thể đăng ký thêm.`
  )) return;

  await setDoc(doc(db, 'kpiPlans', `${KpiWorkflowState.period.id}_${departmentId}`), {
    periodId: KpiWorkflowState.period.id,
    departmentId,
    locked: true,
    planMaximumScore: deleteField(),
    approvedTaskCount,
    approvedUserCount,
    userPlanScores,
    taskIds: approved.map(task => task.id),
    lockedByUserId: KpiWorkflowState.user.uid,
    lockedByName: KpiWorkflowState.profile.fullName || '',
    lockedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });

  await audit('LOCK_DEPARTMENT_PLAN', {
    departmentId,
    approvedTaskCount,
    approvedUserCount
  });
  await loadAll();
  message('Đã khóa đăng ký kế hoạch.', 'ok');
}

async function openDelegationManager() {
  if (!Permissions.canDelegateApproval()) return;
  const directorMode = Permissions.isDirectorHead();
  const departmentId = directorMode ? 'BGD' : normalizeDepartment(KpiWorkflowState.profile.departmentId);
  const candidates = KpiWorkflowState.users.filter(user => {
    const candidate = normalizeUserRecord(user, user.id || user.uid);
    if (candidate.active !== true || candidate.id === KpiWorkflowState.user.uid) return false;
    if (directorMode) {
      return clean(candidate.role).toUpperCase() === 'DIRECTOR' && Permissions.isDirectorDeputy(candidate);
    }
    return normalizeDepartment(candidate.departmentId) === departmentId && Permissions.isDepartmentDeputy(candidate);
  });
  const active = KpiWorkflowState.delegations.find(item => (
    item.active === true
    && item.delegatorUserId === KpiWorkflowState.user.uid
    && normalizeDepartment(item.departmentId) === departmentId
  ));
  const allowedPermissions = directorMode
    ? ['APPROVE_REGISTRATIONS', 'CONFIRM_EVALUATIONS']
    : ['APPROVE_REGISTRATIONS', 'CONFIRM_EVALUATIONS', 'LOCK_PLAN'];
  const selectedPermissions = Array.isArray(active?.permissions) && active.permissions.length
    ? active.permissions.filter(permission => allowedPermissions.includes(permission))
    : [directorMode ? 'CONFIRM_EVALUATIONS' : 'APPROVE_REGISTRATIONS'];
  const scopePresets = directorMode
    ? [
      { value: 'APPROVE_REGISTRATIONS', label: 'Duyệt đăng ký của Trưởng/Phụ trách và đơn vị chưa có người đứng đầu' },
      { value: 'CONFIRM_EVALUATIONS', label: 'Xác nhận kết quả đánh giá của Trưởng/Phụ trách, Bí thư và hồ sơ đơn vị chưa có người đứng đầu' },
      { value: 'APPROVE_REGISTRATIONS|CONFIRM_EVALUATIONS', label: 'Duyệt đăng ký và xác nhận kết quả' }
    ]
    : [
      { value: 'APPROVE_REGISTRATIONS', label: 'Duyệt và trả lại đăng ký kế hoạch' },
      { value: 'CONFIRM_EVALUATIONS', label: 'Xác nhận kết quả đánh giá' },
      { value: 'LOCK_PLAN', label: 'Khóa hoặc mở lại đăng ký kế hoạch' },
      { value: 'APPROVE_REGISTRATIONS|CONFIRM_EVALUATIONS', label: 'Duyệt đăng ký và xác nhận kết quả' },
      { value: 'APPROVE_REGISTRATIONS|LOCK_PLAN', label: 'Duyệt đăng ký và khóa/mở kế hoạch' },
      { value: 'CONFIRM_EVALUATIONS|LOCK_PLAN', label: 'Xác nhận kết quả và khóa/mở kế hoạch' },
      { value: 'APPROVE_REGISTRATIONS|CONFIRM_EVALUATIONS|LOCK_PLAN', label: 'Toàn bộ quyền quản lý kế hoạch' }
    ];
  const selectedScope = allowedPermissions
    .filter(permission => selectedPermissions.includes(permission))
    .join('|') || (directorMode ? 'CONFIRM_EVALUATIONS' : 'APPROVE_REGISTRATIONS');
  const delegateLabel = directorMode ? 'Phó Giám đốc' : 'Phó Trưởng phòng';
  const activeStatus = active
    ? `<div class="kpi-delegation-active-note"><strong>Ủy quyền đang có hiệu lực</strong><span>${esc(active.delegateName || delegateLabel)} · ${dateVi(active.startDate)} – ${dateVi(active.endDate)}</span><small>Có thể hủy ngay khi người ủy quyền trở lại xử lý; lịch sử ủy quyền vẫn được lưu để đối chiếu.</small></div>`
    : '';
  const footer = [
    '<button class="kpi-button secondary" data-kpi-close type="button">Đóng</button>',
    active ? '<button id="revokeDelegation" class="kpi-button danger" type="button">Hủy ủy quyền</button>' : '',
    '<button id="saveDelegation" class="kpi-button" type="button">Lưu ủy quyền</button>'
  ].filter(Boolean).join('');

  const root = modal(directorMode ? 'Ủy quyền Phó Giám đốc' : 'Ủy quyền Phó Trưởng phòng', `
    <div class="kpi-delegation-form">
      ${activeStatus}
      <label class="kpi-field kpi-delegation-person"><span>Người được ủy quyền</span><select id="delegationUser"><option value="">-- Chọn ${delegateLabel} --</option>${candidates.map(user => `<option value="${user.id}" ${active?.delegateUserId === user.id ? 'selected' : ''}>${esc(user.fullName || 'Chưa cập nhật họ tên')} — ${esc(user.position || delegateLabel)}</option>`).join('')}</select></label>
      ${candidates.length ? '' : `<div class="kpi-alert kpi-delegation-warning">Chưa tìm thấy ${delegateLabel} đang hoạt động và đủ điều kiện nhận ủy quyền. Vui lòng kiểm tra lại chức vụ/cấp lãnh đạo trong danh mục nhân sự.</div>`}
      <div class="kpi-delegation-dates">
        <label class="kpi-field"><span>Từ ngày</span><input id="delegationStart" type="date" value="${active?.startDate || todayKey()}"></label>
        <label class="kpi-field"><span>Đến ngày</span><input id="delegationEnd" type="date" value="${active?.endDate || KpiWorkflowState.period?.endDate || ''}"></label>
      </div>
      <label class="kpi-field kpi-delegation-scope-select"><span>Phạm vi ủy quyền</span><select id="delegationScope">${scopePresets.map(option => `<option value="${option.value}" ${selectedScope === option.value ? 'selected' : ''}>${esc(option.label)}</option>`).join('')}</select></label>
      <label class="kpi-field kpi-delegation-reason"><span>Lý do</span><textarea id="delegationReason" rows="3" placeholder="Ví dụ: Nghỉ phép, đi công tác…">${esc(active?.reason || '')}</textarea></label>
    </div>`,
    footer
  );

  root.querySelector('#saveDelegation')?.addEventListener('click', async () => {
    const delegateUserId = clean(el('delegationUser').value);
    const reason = clean(el('delegationReason').value);
    const startDate = clean(el('delegationStart').value);
    const endDate = clean(el('delegationEnd').value);
    const permissions = clean(el('delegationScope').value).split('|').filter(permission => allowedPermissions.includes(permission));
    if (!delegateUserId) return ModalService.alert(`Hãy chọn ${delegateLabel} được ủy quyền.`);
    if (!reason) return ModalService.alert('Phải nhập lý do ủy quyền.');
    if (!permissions.length) return ModalService.alert('Hãy chọn ít nhất một phạm vi ủy quyền.');
    if (!startDate || !endDate || startDate > endDate) return ModalService.alert('Thời gian ủy quyền chưa hợp lệ.');

    const reference = doc(db, 'approvalDelegations', `${departmentId}_ACTIVE`);
    const deputy = candidates.find(item => item.id === delegateUserId);
    const startAt = Timestamp.fromDate(new Date(`${startDate}T00:00:00`));
    const endAt = Timestamp.fromDate(new Date(`${endDate}T23:59:59`));
    await setDoc(reference, {
      departmentId,
      delegatorUserId: KpiWorkflowState.user.uid,
      delegatorName: KpiWorkflowState.profile.fullName || '',
      delegateUserId,
      delegateName: deputy?.fullName || '',
      delegateEmail: deputy?.email || '',
      delegatePosition: deputy?.position || '',
      permissions,
      startDate,
      endDate,
      startAt,
      endAt,
      reason,
      active: true,
      revokedAt: null,
      revokedByUserId: '',
      revokedByName: '',
      createdAt: active?.createdAt || serverTimestamp(),
      createdBy: active?.createdBy || KpiWorkflowState.user.uid,
      updatedAt: serverTimestamp(),
      updatedBy: KpiWorkflowState.user.uid
    }, { merge: true });
    await audit('UPDATE_APPROVAL_DELEGATION', { departmentId, delegateUserId, permissions, startDate, endDate, reason });
    closeModal();
    await loadAll();
    message('Đã thiết lập ủy quyền.', 'ok');
  });

  root.querySelector('#revokeDelegation')?.addEventListener('click', async () => {
    if (!active) return;
    if (!await ModalService.confirm(`Hủy ủy quyền của ${active.delegateName || delegateLabel} ngay bây giờ? Quyền được ủy quyền sẽ hết hiệu lực ngay.`)) return;
    const reference = doc(db, 'approvalDelegations', `${departmentId}_ACTIVE`);
    const button = root.querySelector('#revokeDelegation');
    button.disabled = true;
    try {
      await updateDoc(reference, {
        active: false,
        revokedAt: serverTimestamp(),
        revokedByUserId: KpiWorkflowState.user.uid,
        revokedByName: KpiWorkflowState.profile.fullName || '',
        updatedAt: serverTimestamp(),
        updatedBy: KpiWorkflowState.user.uid
      });
      await audit('REVOKE_APPROVAL_DELEGATION', { departmentId, delegateUserId: active.delegateUserId, endedEarly: true });
      closeModal();
      await loadAll();
      message('Đã hủy ủy quyền. Quyền được ủy quyền đã hết hiệu lực.', 'ok');
    } catch (error) {
      ModalService.alert(friendlyErrorMessage(error, 'Không thể hủy ủy quyền.'));
      button.disabled = false;
    }
  });
}

async function unlockDepartmentPlan() {
  if (!KpiWorkflowState.plan?.locked || !canLockPlan()) {
    ModalService.alert('Tài khoản không có quyền thực hiện thao tác này.');
    return;
  }
  const departmentId = planManagementDepartmentId();
  const hasEvaluation = KpiWorkflowState.evaluations.some(item =>
    normalizeDepartment(item.departmentId) === departmentId
    && ['PENDING_REVIEW', 'CONFIRMED'].includes(item.status)
  );
  if (hasEvaluation && !await ModalService.confirm('Kỳ đã phát sinh dữ liệu tự đánh giá hoặc xác nhận trong Phòng/Khu này. Trưởng phòng vẫn muốn mở lại đăng ký kế hoạch?')) {
    return;
  }
  const reason = await ModalService.prompt('Nhập lý do mở lại đăng ký kế hoạch:');
  if (!clean(reason)) return;
  await updateDoc(doc(db, 'kpiPlans', KpiWorkflowState.plan.id), {
    locked: false,
    unlockReason: clean(reason),
    unlockedAt: serverTimestamp(),
    unlockedByUserId: KpiWorkflowState.user.uid,
    updatedAt: serverTimestamp()
  });
  await audit('UNLOCK_DEPARTMENT_PLAN', { departmentId, reason: clean(reason) });
  await loadAll();
  message('Đã mở lại đăng ký kế hoạch.', 'ok');
}

function initializePilotPeriod(){
  if(!Permissions.canManageEvaluationPeriods()) return;
  const next = nextQuarterDefaults();
  modal('Tạo kỳ đánh giá', `<form id="kpiPeriodForm" class="kpi-form-grid">
    <div class="kpi-field"><label>Loại kỳ</label><select id="kpiPeriodTypeInput"><option value="QUARTER">Theo quý</option><option value="MONTH">Theo tháng</option></select></div>
    <div class="kpi-field"><label>Mã kỳ</label><input id="kpiPeriodIdInput" value="${esc(next.id)}" required></div>
    <div class="kpi-field"><label>Tên kỳ</label><input id="kpiPeriodNameInput" value="${esc(next.name)}" required></div>
    <div class="kpi-field"><label>Từ ngày</label><input id="kpiPeriodStartInput" type="date" value="${next.start}" required></div>
    <div class="kpi-field"><label>Đến ngày</label><input id="kpiPeriodEndInput" type="date" value="${next.end}" required></div>
  </form>`, '<button class="kpi-button secondary" data-kpi-close type="button">Hủy</button><button id="kpiCreatePeriodSubmit" class="kpi-button" type="button">Tạo và mở kỳ</button>');
  el('kpiPeriodTypeInput')?.addEventListener('change',event=>{
    const defaults=event.target.value==='MONTH'?nextMonthDefaults():nextQuarterDefaults();
    el('kpiPeriodIdInput').value=defaults.id;
    el('kpiPeriodNameInput').value=defaults.name;
    el('kpiPeriodStartInput').value=defaults.start;
    el('kpiPeriodEndInput').value=defaults.end;
  });
  el('kpiCreatePeriodSubmit').addEventListener('click', createPeriodFromForm);
}

function nextQuarterDefaults(){
  const today = new Date();
  const existing = KpiWorkflowState.periods.map(p=>clean(p.id));
  let year=today.getFullYear(), quarter=Math.floor(today.getMonth()/3)+1;
  for(let i=0;i<12;i++){
    const id=`${year}-Q${quarter}`;
    if(!existing.includes(id)){
      const month=(quarter-1)*3;
      const start=`${year}-${String(month+1).padStart(2,'0')}-01`;
      const endDate=new Date(year,month+3,0);
      const end=`${year}-${String(month+3).padStart(2,'0')}-${String(endDate.getDate()).padStart(2,'0')}`;
      return {id,name:`Quý ${['I','II','III','IV'][quarter-1]} năm ${year}`,start,end,year,quarter};
    }
    quarter++; if(quarter>4){quarter=1;year++;}
  }
  return {id:KPI2C.PILOT_PERIOD_ID,name:KPI2C.PILOT_PERIOD_NAME,start:KPI2C.PILOT_START,end:KPI2C.PILOT_END,year:2026,quarter:3};
}

function nextMonthDefaults(){
  const today=new Date();
  const existing=KpiWorkflowState.periods.map(p=>clean(p.id));
  let year=today.getFullYear(),month=today.getMonth()+1;
  for(let i=0;i<36;i++){
    const id=`${year}-M${String(month).padStart(2,'0')}`;
    if(!existing.includes(id)){
      const endDate=new Date(year,month,0);
      return {
        id,
        name:`Tháng ${month} năm ${year}`,
        start:`${year}-${String(month).padStart(2,'0')}-01`,
        end:`${year}-${String(month).padStart(2,'0')}-${String(endDate.getDate()).padStart(2,'0')}`,
        year,
        month
      };
    }
    month++;if(month>12){month=1;year++;}
  }
  return {id:`${today.getFullYear()}-M${String(today.getMonth()+1).padStart(2,'0')}`,name:`Tháng ${today.getMonth()+1} năm ${today.getFullYear()}`,start:todayKey(),end:todayKey(),year:today.getFullYear(),month:today.getMonth()+1};
}

async function createPeriodFromForm(){
  if (!Permissions.canManageEvaluationPeriods()) return;
  const periodId=clean(el('kpiPeriodIdInput').value).toUpperCase();
  const name=clean(el('kpiPeriodNameInput').value);
  const startDate=clean(el('kpiPeriodStartInput').value);
  const endDate=clean(el('kpiPeriodEndInput').value);
  const quarterMatch=/^(\d{4})-Q([1-4])$/.exec(periodId);
  const monthMatch=/^(\d{4})-M(0[1-9]|1[0-2])$/.exec(periodId);
  if(!quarterMatch&&!monthMatch){ModalService.alert('Mã kỳ phải có dạng 2026-Q3 hoặc 2026-M08.');return;}
  if(!name||!startDate||!endDate||startDate>endDate){ModalService.alert('Thông tin kỳ chưa hợp lệ.');return;}
  if(KpiWorkflowState.periods.some(p=>p.active===true)){ModalService.alert('Đang có một kỳ hoạt động. Hãy kết thúc kỳ hiện tại trước khi mở kỳ mới.');return;}
  const year=Number((quarterMatch||monthMatch)[1]);
  const periodType=quarterMatch?'QUARTER':'MONTH';
  await setDoc(doc(db,'evaluationPeriods',periodId),{
    periodId,name,periodType,year,quarter:quarterMatch?Number(quarterMatch[2]):null,month:monthMatch?Number(monthMatch[2]):null,startDate,endDate,recommendedPlanningDays:10,
    autoLockPlan:false,pilotMode:false,status:'ACTIVE',active:true,
    createdByUserId:KpiWorkflowState.user.uid,createdByName:KpiWorkflowState.profile.fullName||'',createdAt:serverTimestamp(),updatedAt:serverTimestamp()
  },{merge:false});
  PeriodReadService.invalidate();
  await audit('CREATE_PERIOD',{periodId,startDate,endDate});
  closeModal(); await loadAll();
}
async function completePeriod(){
  if(!Permissions.canManageEvaluationPeriods()||!KpiWorkflowState.period)return;
  const periodTasks = KpiWorkflowState.tasks.filter(task => (
    task.active !== false &&
    task.planApprovalStatus === 'APPROVED' &&
    !['HUY','CANCELLED'].includes(clean(task.status).toUpperCase())
  ));
  const participantIds = [...new Set(periodTasks
    .map(task => clean(task.ownerUserId))
    .filter(Boolean))];

  const pendingRegistrations = KpiWorkflowState.registrations.filter(item => (
    item.active !== false
    && ['PENDING', 'REJECTED'].includes(clean(item.status).toUpperCase())
    && !clean(item.taskId)
  ));
  if (pendingRegistrations.length) {
    ModalService.alert(`Không thể kết thúc kỳ vì còn ${pendingRegistrations.length} đăng ký kế hoạch chưa được duyệt hoặc trả lại.`);
    return;
  }

  const withoutBasis = participantIds.filter(userId => !summaryForUser(userId).hasCalculationBasis);
  if (withoutBasis.length) {
    const names = withoutBasis.map(userId => {
      const user = KpiWorkflowState.users.find(item => item.id === userId);
      return user?.fullName || user?.email || userId;
    });
    ModalService.alert(`Không thể kết thúc kỳ vì ${names.length} cá nhân có A = 0, chưa đủ cơ sở tính KPI: ${names.join(', ')}.`);
    return;
  }

  const incompletePeople = participantIds.map(userId => {
    const user = KpiWorkflowState.users.find(item => item.id === userId);
    const name = user?.fullName || user?.email || userId;
    const tasks = periodTasks.filter(task => clean(task.ownerUserId) === userId);
    const unresolvedTasks = tasks.filter(task => {
      if (!taskRequiresOfficialEvaluation(task)) return false;
      const evaluation = KpiWorkflowState.evaluations.find(item => item.taskId === task.id && item.ownerUserId === userId);
      const score = evaluationScoreSnapshot(evaluation);
      return !score.official || score.bonusResolved === false;
    });
    const common = KpiWorkflowState.commonAll.find(item => item.userId === userId);
    const commonConfirmed = common?.status === 'CONFIRMED' && Number.isFinite(Number(common.confirmedTotal));
    return {
      name,
      taskCount: unresolvedTasks.length,
      commonMissing: !commonConfirmed
    };
  }).filter(item => item.taskCount > 0 || item.commonMissing);

  if (incompletePeople.length) {
    const details = incompletePeople.slice(0, 8).map(item => {
      const parts = [];
      if (item.taskCount) parts.push(`${item.taskCount} nhiệm vụ chưa xác nhận điểm`);
      if (item.commonMissing) parts.push('chưa xác nhận 30 điểm tiêu chí chung');
      return `${item.name}: ${parts.join(', ')}`;
    });
    const remaining = incompletePeople.length > details.length
      ? `; và ${incompletePeople.length - details.length} người khác`
      : '';
    ModalService.alert(`Không thể kết thúc kỳ. Hồ sơ đánh giá chưa hoàn tất: ${details.join('; ')}${remaining}.`);
    return;
  }

  if(!await ModalService.confirm('Xác nhận đã in và lưu hồ sơ giấy, sau đó kết thúc kỳ?'))return;
  await updateDoc(doc(db,'evaluationPeriods',KpiWorkflowState.period.id),{status:'COMPLETED',active:false,completedByUserId:KpiWorkflowState.user.uid,completedAt:serverTimestamp(),updatedAt:serverTimestamp()});
  PeriodReadService.invalidate();
  await audit('COMPLETE_PERIOD',{periodId:KpiWorkflowState.period.id});
  await loadAll();
}
async function deletePeriodData(){
  if(!activeRole('ADMIN')||!KpiWorkflowState.period)return;
  const period=KpiWorkflowState.period;
  if(period.active===true||period.status!=='COMPLETED'){
    ModalService.alert('Phải hoàn tất đánh giá và kết thúc kỳ trước khi lưu trữ, dọn dữ liệu.');
    return;
  }
  const confirmation=await ModalService.prompt(`Đây là thao tác xóa dữ liệu vận hành sau khi đã lưu lên Drive.\nNhập chính xác mã kỳ ${period.id} để tiếp tục:`);
  if(clean(confirmation).toUpperCase()!==clean(period.id).toUpperCase()){
    if(confirmation!==null)ModalService.alert('Mã kỳ xác nhận không đúng. Hệ thống chưa thay đổi dữ liệu.');
    return;
  }
  const progressRoot=modal('Lưu trữ và dọn dữ liệu kỳ',`
    <div class="kpi-archive-progress"><div class="progress-track"><span id="kpiArchiveProgressBar" style="width:2%"></span></div><strong id="kpiArchiveProgressText">Đang chuẩn bị…</strong><p class="kpi-small">Không đóng trình duyệt cho đến khi hệ thống báo hoàn tất.</p></div>
  `,'<span class="kpi-small">Đang xử lý an toàn theo từng bước…</span>');
  progressRoot.querySelectorAll('[data-kpi-close]').forEach(button=>button.remove());
  try{
    const result=await PeriodArchiveService.archiveAndPurge(period.id,{onProgress:state=>{
      const bar=el('kpiArchiveProgressBar');if(bar)bar.style.width=`${Math.max(2,Math.min(100,Number(state.percent||0)))}%`;
      const text=el('kpiArchiveProgressText');if(text)text.textContent=state.message||'Đang xử lý…';
    }});
    PeriodReadService.invalidate();
    closeModal();
    ModalService.alert(`Đã hoàn tất kỳ ${period.id}.\n- Đã lưu ${result.totalRecords} bản ghi lên Google Drive.\n- Đã dọn ${result.deleted} bản ghi khỏi Firestore.\n- Mã kiểm tra: ${result.sha256.slice(0,16)}…`);
    await loadAll();
  }catch(error){
    closeModal();
    ModalService.alert(`Không thể hoàn tất quy trình: ${friendlyErrorMessage(error)}\nDữ liệu chỉ bị xóa sau khi tệp Drive đã được xác nhận. Có thể chạy lại thao tác để tiếp tục.`);
  }
}

async function openReport() {
  if (!KpiWorkflowState.period) return;

  const reportDepartmentId = profileDepartmentId();
  const mine = personalTasksForUser(KpiWorkflowState.user.uid).filter(taskRequiresOfficialEvaluation);
  const evidenceMap = await evidenceMapForTasks(mine);
  const commonRecord = commonAssessmentForUser(KpiWorkflowState.user.uid, reportDepartmentId);
  const commonScore = commonScoreSnapshot(commonRecord);
  const scoreState = scoreStateForUserCombined(KpiWorkflowState.user.uid);
  const s = summaryForUserCombined(KpiWorkflowState.user.uid);
  const profile = { ...(KpiWorkflowState.profile || {}), ...(KpiWorkflowState.kpiProfile || {}) };
  const formType = reportFormTypeForProfile(profile);
  const criteria = commonCriteriaForProfile(profile);
  const commonItems = commonScore.items;

  const profileValue = (...keys) => {
    for (const key of keys) { const value = clean(profile?.[key]); if (value) return value; }
    return '';
  };
  const resultFor = code => commonItems.find(item => item.code === code) || {};
  const criterionRows = M01_GROUPS.map(group => {
    const groupCriteria = criteria.filter(item => item.group === group.code);
    const groupSelf = groupCriteria.reduce((sum,c)=>sum+Number(resultFor(c.code).selfScore ?? (resultFor(c.code).selfResult==='DAM_BAO'?c.max:0)),0);
    const groupConfirmed = groupCriteria.reduce((sum,c)=>sum+Number(resultFor(c.code).confirmedScore ?? (resultFor(c.code).confirmedResult==='DAM_BAO'?c.max:0)),0);
    const rows = groupCriteria.map(c => {
      const value = resultFor(c.code);
      const selfScore = value.selfScore ?? (value.selfResult === 'DAM_BAO' ? c.max : value.selfResult === 'KHONG_DAM_BAO' ? 0 : '');
      const confirmedScore = commonScore.official ? (value.confirmedScore ?? (value.confirmedResult === 'DAM_BAO' ? c.max : 0)) : '';
      return `<tr class="m01-item-row"><td class="m01-center">${esc(c.code)}</td><td colspan="3">${esc(c.text)}</td><td class="m01-center">${fmt(c.max)}</td><td class="m01-center">${selfScore === '' ? '' : fmt(selfScore)}</td><td class="m01-center">${confirmedScore === '' ? '' : fmt(confirmedScore)}</td><td>${esc(commonScore.official ? (value.confirmedNote || value.note || '') : (value.note || ''))}</td></tr>`;
    }).join('');
    return `<tr class="m01-group-row"><td class="m01-center">${esc(group.code)}</td><td colspan="3"><strong>${esc(group.title)}</strong></td><td class="m01-center">${fmt(group.max)}</td><td class="m01-center">${fmt(groupSelf)}</td><td class="m01-center">${commonScore.official ? fmt(groupConfirmed) : ''}</td><td></td></tr>${rows}`;
  }).join('');

  const taskRows = mine.map((task, index) => {
    const applied = evaluationScoreSnapshot(evaluationFor(task.id));
    return `<tr class="m01-task-row"><td class="m01-center">${index + 1}</td><td colspan="4">${esc(task.title || '')}</td><td class="m01-center">${fmt(task.maximumConvertedScore || 0)}</td><td class="m01-center">${applied.hasScore ? fmt(applied.actualScore) : ''}</td><td>${applied.hasScore ? esc(applied.shortLabel) : ''}</td></tr>`;
  }).join('');

  const bonusTasks = mine.map(task => {
    const score = evaluationScoreSnapshot(evaluationFor(task.id));
    const pending = score.bonusRequested === true && score.bonusDecision === 'PENDING' && score.bonusRequestedScore > 0;
    const approved = score.official && score.bonusAwarded && score.bonusScore > 0;
    if (!pending && !approved) return null;
    return {
      task, score, pending, approved,
      basisScore: approved ? Number(score.bonusBasisScore || score.actualScore || 0) : Number(score.convertedActualScore || score.actualScore || 0),
      displayBonus: approved ? Number(score.bonusScore || 0) : Number(score.bonusRequestedScore || 0),
      statusText: approved ? 'Đã chấp thuận' : 'Chờ xác nhận'
    };
  }).filter(Boolean);
  const reportBonusC = round2(Math.min(7, bonusTasks.filter(item => item.approved).reduce((sum,item)=>sum+Math.max(0,Number(item.displayBonus||0)),0)));
  const reportTotal100 = s.hasCalculationBasis ? round2(Math.min(100, Number(s.kpi70 || 0) + Number(commonScore.total || 0) + reportBonusC)) : null;
  const officialRatingState = scoreState.code === 'OFFICIAL';
  const reportRatingInfo = reportTotal100 == null ? { code:'NO_BASIS', totalTasks:mine.length, exceededTasks:0, rate:0 } : ratingForUser(KpiWorkflowState.user.uid, reportTotal100, { officialOnly:officialRatingState });
  const reportRating = ratingName(reportRatingInfo.code);
  const exceededSentence = reportTotal100 == null ? '' : `Có ${reportRatingInfo.exceededTasks}/${reportRatingInfo.totalTasks} nhiệm vụ ${officialRatingState ? 'được xác nhận ' : 'tự đánh giá '}hoàn thành vượt mức yêu cầu về tiến độ/chất lượng, đạt tỷ lệ ${fmt(reportRatingInfo.rate)}%. Đề xuất “${reportRating}”.`;
  const bonusRows = bonusTasks.map((item,index)=>`<tr class="m01-bonus-item"><td class="m01-center">${index+1}</td><td colspan="4">${esc(item.task.title || '')}</td><td class="m01-center">${fmt(item.basisScore)} × 5%</td><td class="m01-center"><strong>${fmt(item.displayBonus)}</strong></td><td>${esc(item.statusText)}</td></tr>`).join('');

  const startMatch = /^(\d{4})-(\d{2})-\d{2}$/.exec(clean(KpiWorkflowState.period.startDate));
  const quarterNumber = startMatch ? Math.ceil(Number(startMatch[2]) / 3) : 0;
  const quarterRoman = ({ 1:'I', 2:'II', 3:'III', 4:'IV' })[quarterNumber] || '';
  const quarterText = quarterRoman && startMatch ? `Quý ${quarterRoman}, Năm ${startMatch[1]}` : (clean(KpiWorkflowState.period.name) || 'Quý …, Năm …');
  const birthDate = dateVi(profileValue('dateOfBirth', 'birthDate', 'birthday'));
  const partyPosition = profileValue('partyPosition', 'dangPosition');
  const governmentPosition = profileValue('governmentPosition', 'position');
  const unionPosition = profileValue('unionPosition', 'doanThePosition');
  const departmentName = profileValue('departmentName', 'unitName') || departmentDisplayName(reportDepartmentId);
  const currentDate = new Intl.DateTimeFormat('vi-VN', { day:'2-digit', month:'2-digit', year:'numeric' }).format(new Date());
  const confirmedCommonTotal = commonScore.official ? fmt(commonScore.total) : '';
  const selfCommonTotal = commonRecord && hasNumericValue(commonRecord.selfTotal) ? fmt(commonRecord.selfTotal) : '0';

  const resultAxesText = 'Tập trung vào các trục kết quả trọng tâm: (1) Thực hiện mục tiêu phát triển kinh tế - xã hội và nhiệm vụ chính trị được giao; (2) Hoàn thiện thể chế, đẩy mạnh phân cấp, phân quyền gắn với kiểm tra, giám sát; (3) Thúc đẩy phát triển khoa học, công nghệ, đổi mới sáng tạo và chuyển đổi số; (4) Xây dựng Đảng và hệ thống chính trị trong sạch, vững mạnh; giữ gìn đoàn kết, thống nhất nội bộ; phòng, chống tham nhũng, lãng phí, tiêu cực; (5) Phát triển văn hóa, con người, bảo đảm an sinh xã hội, nâng cao đời sống nhân dân; (6) Củng cố quốc phòng, an ninh, giữ vững ổn định chính trị - xã hội, nâng cao hiệu quả đối ngoại và hội nhập quốc tế.';
  const formLabel = formType === '01A' ? 'Mẫu 01-A' : 'Mẫu 01-B';
  const dateParts = currentDate.split('/');
  const reportDateLine = `Đồng Nai, ngày ${dateParts[0] || '…'} tháng ${dateParts[1] || '…'} năm ${dateParts[2] || '…'}`;

  const pdfHtml = `<div id="kpiPdfPreview" class="kpi-report kpi-report-print m01-report">
    <div class="m01-top">
      <div class="m01-agency"><strong>SỞ Y TẾ<br>THÀNH PHỐ HỒ CHÍ MINH<br>TRUNG TÂM BẢO TRỢ XÃ HỘI TÂN HIỆP</strong></div>
      <div class="m01-national"><strong>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</strong><div class="m01-motto"><strong>Độc lập - Tự do - Hạnh phúc</strong></div><div><em>${esc(reportDateLine)}</em></div></div>
      <div class="m01-form-number">${formLabel}</div>
    </div>
    <h1>BẢN TỰ ĐÁNH GIÁ, XẾP LOẠI CỦA CÁ NHÂN</h1><h2>${esc(quarterText)}</h2>
    <div class="m01-profile"><div><strong>Họ và tên:</strong> ${esc(profile.fullName || '')}<span class="m01-spacer"></span><strong>Ngày sinh:</strong> ${esc(birthDate)}</div><div><strong>Chức vụ Đảng:</strong> ${esc(partyPosition)}</div><div><strong>Chức vụ chính quyền:</strong> ${esc(governmentPosition)}</div><div><strong>Chức vụ đoàn thể:</strong> ${esc(unionPosition)}</div><div><strong>Đơn vị công tác:</strong> ${esc(departmentName)}</div></div>
    <div class="m01-score-preview kpi-no-print ${scoreState.className}"><strong>${esc(scoreState.label)}</strong><span>${esc(scoreState.detail)}</span></div>
    <div class="m01-section-title"><strong>I. Tự đánh giá kết quả thực hiện nhiệm vụ</strong></div>
    <div class="m01-intro">Trên cơ sở nhiệm vụ được giao, cá nhân tự đánh giá về kết quả thực hiện nhiệm vụ theo quý như sau:</div>
    <table class="kpi-report-table m01-table">
      <colgroup>
        <col class="m01-col-a">
        <col class="m01-col-b">
        <col class="m01-col-c">
        <col class="m01-col-d">
        <col class="m01-col-e">
        <col class="m01-col-f">
        <col class="m01-col-g">
        <col class="m01-col-h">
      </colgroup>
      <tbody>
        <tr class="m01-part-row"><td class="m01-center">A</td><td colspan="7">NHÓM TIÊU CHÍ CHUNG (30 ĐIỂM)</td></tr>
        <tr class="m01-column-head"><td class="m01-center">TT</td><td colspan="3">Tiêu chí / Nội dung</td><td class="m01-center">Điểm tối đa</td><td class="m01-center">Điểm cá nhân tự chấm</td><td class="m01-center">Điểm lãnh đạo, cấp có thẩm quyền chấm</td><td>Ghi chú</td></tr>
        ${criterionRows}
        <tr class="m01-total-row"><td colspan="4">Tổng (A) =</td><td class="m01-center">30</td><td class="m01-center">${selfCommonTotal}</td><td class="m01-center">${confirmedCommonTotal}</td><td></td></tr>

        <tr class="m01-part-row"><td class="m01-center">B</td><td colspan="7">KẾT QUẢ THỰC HIỆN NHIỆM VỤ ĐƯỢC GIAO (70 ĐIỂM)</td></tr>
        <tr class="m01-result-axes"><td></td><td colspan="4">${esc(resultAxesText)}</td><td class="m01-center">Điểm tối đa<br>(70 điểm)</td><td class="m01-center">Điểm đạt được<br>= Điểm KPI đã tính tại bảng tính điểm</td><td>Ghi chú</td></tr>
        ${taskRows || '<tr><td class="m01-center">—</td><td colspan="4">Chưa có nhiệm vụ trong kỳ.</td><td></td><td></td><td></td></tr>'}
        <tr class="m01-total-row"><td colspan="5">TỔNG (B) = Điểm KPI đã tính tại bảng tính điểm</td><td class="m01-center">${fmt(s.A || 0)}</td><td class="m01-center">${s.hasCalculationBasis ? fmt(s.kpi70) : 'Chưa đủ cơ sở tính'}</td><td></td></tr>

        <tr class="m01-part-row"><td class="m01-center">C</td><td colspan="4">ĐIỂM THƯỞNG<br><small>(Mỗi công việc được xác nhận nổi trội, sáng kiến mới được tính điểm thưởng bằng 5% tổng điểm KPI đạt được của công việc cụ thể)</small></td><td class="m01-center">Điểm tối đa<br>(07 điểm)</td><td class="m01-center">Điểm đạt được<br>= Tổng điểm thưởng các công việc</td><td></td></tr>
        ${bonusRows || '<tr class="m01-bonus-item"><td class="m01-center">—</td><td colspan="4">Không có công việc đề nghị/được xác nhận điểm thưởng.</td><td></td><td class="m01-center">0</td><td></td></tr>'}
        <tr class="m01-grand-total"><td colspan="5">TỔNG (A + B + C) =</td><td class="m01-center">Tối đa 100 điểm</td><td class="m01-center"><strong>${reportTotal100 == null ? '—' : fmt(reportTotal100)}</strong></td><td></td></tr>
      </tbody>
    </table>
    <div class="m01-proposal"><strong>II. Tự đề xuất xếp loại mức chất lượng:</strong> ${esc(reportRating)}</div>
    <div class="m01-rating-levels">(Theo 04 mức: - Hoàn thành xuất sắc nhiệm vụ, 2- Hoàn thành tốt nhiệm vụ, 3- Hoàn thành nhiệm vụ và 4- Không hoàn thành nhiệm vụ)</div>
    ${exceededSentence ? `<div class="m01-quality-result">${esc(exceededSentence)}</div>` : ''}
    <div class="m01-self-sign"><strong>CÁ NHÂN TỰ ĐÁNH GIÁ</strong><br><em>(Ký, ghi rõ họ tên)</em></div>
    <div class="m01-authority">
      <h3>III. Nhận xét, đánh giá của cấp có thẩm quyền</h3>
      <p>- Chấm điểm: …................................................................................................................................................................................</p>
      <p>- Đề xuất xếp loại: ….........................................................................................................................................................................</p>
      <div class="m01-authority-sign"><strong>XÁC NHẬN CỦA TẬP THỂ LÃNH ĐẠO CƠ QUAN, ĐƠN VỊ</strong><br><em>(Xác lập thời điểm, ký, ghi rõ họ tên và đóng dấu)</em></div>
    </div>
  </div>`;

  const reportScoreSummary = scorecardSummaryData(KpiWorkflowState.user.uid, s);
  const excelHtml = `<div id="kpiExcelPreview" class="kpi-hidden"><div class="kpi-score-state ${scoreState.className}"><span class="kpi-score-state-icon">${scoreState.code === 'OFFICIAL' ? '✓' : '✎'}</span><div><strong>${esc(scoreState.label)}</strong><span>${esc(scoreState.detail)}</span></div></div><div class="kpi-scorecard-desktop"><div class="kpi-table-wrap"><table class="kpi-table kpi-wide-table"><thead><tr><th>STT</th><th>Tên công việc</th><th>Điểm chuẩn</th><th>Hệ số độ khó</th><th>Điểm quy đổi tối đa</th><th>Tiến độ</th><th>Kết quả</th><th>Điểm thực hiện</th><th>Điểm quy đổi thực tế</th><th>Vượt yêu cầu</th><th>Minh chứng</th></tr></thead><tbody>${mine.map((t, i) => { const evaluation=evaluationFor(t.id); const applied=evaluationScoreSnapshot(evaluation); return `<tr><td>${i + 1}</td><td><strong>${esc(t.taskCode || '')}</strong><br>${esc(t.title)}</td><td>${fmt(t.baseScore)}</td><td>${coefficientPercent(t.difficultyCoefficient)}</td><td>${fmt(t.maximumConvertedScore)}</td><td>${applied.progressRate ?? ''}${applied.progressRate !== null ? '%' : ''}</td><td>${applied.resultRate ?? ''}${applied.resultRate !== null ? '%' : ''}</td><td>${applied.hasScore ? fmt(applied.executionScore) : ''}</td><td><strong>${applied.hasScore ? fmt(applied.convertedActualScore) : ''}</strong></td><td class="m01-center">${esc(scorecardExceededLabel(evaluation))}</td><td>${evidenceCellHtml(evidenceMap.get(t.id) || [], t)}</td></tr>`; }).join('')}</tbody></table>${scorecardSummaryTableHtml(reportScoreSummary)}</div></div><div class="kpi-scorecard-mobile">${mine.map(t=>{const evaluation=evaluationFor(t.id);const applied=evaluationScoreSnapshot(evaluation);const files=evidenceMap.get(t.id)||[];return `<article class="kpi-score-card"><strong>${esc(t.taskCode||'')} — ${esc(t.title||'')}</strong><div><span>Điểm chuẩn ${fmt(t.baseScore)}</span><span>Hệ số ${coefficientPercent(t.difficultyCoefficient)}</span><span>Tối đa ${fmt(t.maximumConvertedScore)}</span></div><div><span>Tiến độ ${applied.progressRate??'—'}%</span><span>Kết quả ${applied.resultRate??'—'}%</span><span>Điểm thực tế <b>${applied.hasScore?fmt(applied.convertedActualScore):'—'}</b></span></div><div><span>Vượt yêu cầu: <b>${esc(scorecardExceededLabel(evaluation)||'Không')}</b></span><span>Minh chứng: ${files.length} tệp</span></div></article>`}).join('')}${scorecardSummaryCardsHtml(reportScoreSummary)}</div></div>`;

  modal(`Báo cáo KPI cá nhân · ${formLabel}`, `<div class="kpi-preview-tabs kpi-no-print"><button id="kpiPdfTab" class="kpi-button secondary active" type="button">${formLabel}</button><button id="kpiExcelTab" class="kpi-button secondary" type="button">Bảng tính điểm</button></div>${pdfHtml}${excelHtml}`, '<button class="kpi-button secondary" data-kpi-close type="button">Đóng</button><button id="kpiExportXlsx" class="kpi-button secondary" type="button">📊 Xuất bảng điểm</button><button id="kpiPrintReport" class="kpi-button" type="button">🖨️ In biểu mẫu</button>');
  el('kpiPdfTab').addEventListener('click', () => { el('kpiPdfPreview').classList.remove('kpi-hidden'); el('kpiExcelPreview').classList.add('kpi-hidden'); el('kpiPdfTab').classList.add('active'); el('kpiExcelTab').classList.remove('active'); el('kpiPrintReport').classList.remove('kpi-hidden'); });
  el('kpiExcelTab').addEventListener('click', () => { el('kpiPdfPreview').classList.add('kpi-hidden'); el('kpiExcelPreview').classList.remove('kpi-hidden'); el('kpiPdfTab').classList.remove('active'); el('kpiExcelTab').classList.add('active'); el('kpiPrintReport').classList.add('kpi-hidden'); });
  el('kpiPrintReport').addEventListener('click', () => window.print());
  el('kpiExportXlsx')?.addEventListener('click', () => exportReportXlsx(mine, s, reportDepartmentId, evidenceMap));
}

function exportReportXlsx(tasks, summaryData, departmentId = profileDepartmentId(), evidenceMap = new Map()) {
  const summaryForExport = scorecardSummaryData(KpiWorkflowState.user.uid, summaryData);
  const workbookRows = tasks.map((task, index) => {
    const evaluation = evaluationFor(task.id);
    const applied = evaluationScoreSnapshot(evaluation);
    return {
      index: index + 1,
      taskCode: task.taskCode || '',
      title: task.title || '',
      baseScore: Number(task.baseScore || 0),
      coefficientLabel: coefficientPercent(task.difficultyCoefficient),
      maximumConvertedScore: Number(task.maximumConvertedScore || 0),
      progressLabel: applied.progressRate == null ? '' : `${applied.progressRate}%`,
      resultLabel: applied.resultRate == null ? '' : `${applied.resultRate}%`,
      executionScore: applied.hasScore ? Number(applied.executionScore || 0) : '',
      actualScore: applied.hasScore ? Number(applied.convertedActualScore || 0) : '',
      exceededLabel: scorecardExceededLabel(evaluation),
      evidence: evidenceExportText(evidenceMap.get(task.id) || [], task)
    };
  });
  const periodLabel = clean(KpiWorkflowState.period?.name || KpiWorkflowState.period?.id || '');
  const safeDepartment = normalizeDepartment(departmentId) || 'DON_VI';
  const fullName = clean(KpiWorkflowState.profile?.fullName || 'ca_nhan');
  exportFormattedKpiWorkbook({
    fileName: `Bang_tinh_diem_KPI_${safeDepartment}_${KpiWorkflowState.period?.id || 'ky'}_${fullName}.xlsx`,
    sheetName: 'Bảng tính điểm',
    periodLabel,
    employeeName: fullName,
    employeePosition: userPositionWithDepartment(KpiWorkflowState.profile || {}),
    rows: workbookRows,
    summary: summaryForExport
  });
}

async function audit(action, detail){try{await addDoc(collection(db,'kpiAuditLogs'),{appVersion:APP_VERSION,periodId:KpiWorkflowState.period?.id||'',action,detail,scopeUserId:KpiWorkflowState.user.uid,scopeDepartmentId:activeScopeDepartmentId()||KpiWorkflowState.profile.departmentId||'',performedByUserId:KpiWorkflowState.user.uid,performedByName:KpiWorkflowState.profile.fullName||'',performedByRole:KpiWorkflowState.profile.role||'',performedAt:serverTimestamp()});}catch(error){console.warn('Không ghi được KPI audit log',error);}}

window.KPI2C = {
  getActivePeriodSnapshot: () => KpiWorkflowState.period ? { id:KpiWorkflowState.period.id,name:KpiWorkflowState.period.name,startDate:KpiWorkflowState.period.startDate,endDate:KpiWorkflowState.period.endDate,status:KpiWorkflowState.period.status } : null,
  classifyNewTask: (templateItem, profile) => ({
    periodId: KpiWorkflowState.period?.id || '', periodName:KpiWorkflowState.period?.name || '',
    planType: templateItem?.workType === 'DOT_XUAT' ? 'DOT_XUAT' : 'KE_HOACH',
    planApprovalStatus:'PENDING_APPROVAL',includedInA:false,isCoreTask:Boolean(templateItem?.isCoreTaskDefault),isManagementTask:Boolean(templateItem?.isManagementTask),
    reviewerEmail:'',scoringEnabled:true,scoringStatus:'NOT_ASSESSED'
  })
};



export async function renderKpiWorkflow(outlet, options = {}) {
  KpiWorkflowState.mode = options.mode || 'plans';
  outlet.innerHTML = '<section id="kpiSection"></section>';
  KpiWorkflowState.user = auth.currentUser;
  if (!KpiWorkflowState.user) {
    outlet.innerHTML = '<section class="page-card error-card"><h2>Phiên đăng nhập không hợp lệ</h2></section>';
    return;
  }
  KpiWorkflowState.profile = normalizeUserRecord(UserContext.requireUser(), KpiWorkflowState.user.uid);
  if (!KpiWorkflowState.profile) {
    outlet.innerHTML = '<section class="page-card error-card"><h2>Không tìm thấy hồ sơ người dùng</h2></section>';
    return;
  }
  mount();
  await loadAll();
  startKpiRealtime();
  if (options.openReport === true && KpiWorkflowState.period) {
    openReport();
  }
}

export { openReport };
