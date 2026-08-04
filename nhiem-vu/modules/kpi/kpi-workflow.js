import { auth, db } from '../../firebase-config.js';
import {
  addDoc, collection, deleteDoc, deleteField, doc, getDoc, getDocs, query,
  serverTimestamp, setDoc, Timestamp, updateDoc, where, limit, writeBatch
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { TaskRegistrationService } from '../../services/task-registration-service.js?v=20260804.V1_8_0';
import { TaskWorkItemService } from '../../services/task-work-item-service.js?v=20260804.V1_8_0';
import { PeriodArchiveService } from '../../services/period-archive-service.js?v=20260804.V1_8_0';
import { PeriodReadService } from '../../services/period-read-service.js?v=20260804.V1_8_0';
import { Permissions } from '../../core/permissions.js?v=20260804.V1_8_0';
import { friendlyErrorMessage, isPermissionDeniedError } from '../../core/friendly-error.js?v=20260804.V1_8_0';
import {
  KPI2B as KPI2C, COMMON_CRITERIA, calculateTaskScore, calculateKpiSummary,
  proposedRating, ratingName, round2, progressRateFromDates, convertAppendix04Rate
} from '../../kpi-engine.js?v=20260804.V1_8_0';

export const KpiWorkflowState = {
  user: null,
  profile: null,
  period: null,
  periods: [],
  users: [],
  tasks: [],
  registrations: [],
  evaluations: [],
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

const el = (id) => document.getElementById(id);
const clean = (value) => String(value ?? '').trim();
const esc = (value) => clean(value).replace(/[&<>'"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const fmt = (n) => Number(n || 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 });
const coefficientPercent = (value) => `${Math.round(Number(value || 1) * 100)}%`;
const dateVi = (key) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean(key)); return m ? `${m[3]}/${m[2]}/${m[1]}` : clean(key); };
const normalizeDepartment = (value) => clean(value).toUpperCase();

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
    [100, '100% — Đúng hạn/đạt đầy đủ yêu cầu'],
    [80, '80% — Chậm 1–3 ngày/chỉnh sửa nhỏ'],
    [60, '60% — Chậm 4–5 ngày/hoàn thành cơ bản'],
    [0, '0% — Trên 5 ngày/không đạt yêu cầu']
  ].map(([value, label]) => `<option value="${value}" ${current === value ? 'selected' : ''}>${label}</option>`).join('');
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
  return Permissions.isCdtnLeadership()
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

function canApproveRegistration(registration) {
  if (!registration || registration.status !== 'PENDING') return false;
  if (activeRole('ADMIN')) return true;

  const registrationDepartmentId = normalizeDepartment(registration.departmentId);
  if (registrationDepartmentId === 'CDTN') {
    const directAuthority = Permissions.isCdtnLeadership();
    const delegated = hasActiveApprovalDelegation('APPROVE_REGISTRATIONS', 'CDTN');
    return Boolean(
      sameDepartment(registration)
      && (directAuthority || delegated)
      && (directAuthority || registration.userId !== KpiWorkflowState.user.uid)
    );
  }

  const delegated = hasActiveApprovalDelegation('APPROVE_REGISTRATIONS', profileDepartmentId());
  if (registration.userRole === 'DEPARTMENT_LEADER') {
    const deputy = Permissions.isDepartmentDeputy({
      uid: registration.userId,
      active: true,
      role: registration.userRole,
      position: registration.userPosition,
      leaderLevel: registration.userLeaderLevel,
      isDepartmentHead: registration.userIsDepartmentHead
    });
    if (deputy) {
      return Permissions.canApproveStaffRegistrations(delegated) && sameDepartment(registration) && registration.userId !== KpiWorkflowState.user.uid;
    }
    return activeRole('DIRECTOR');
  }
  return Permissions.canApproveStaffRegistrations(delegated) && sameDepartment(registration);
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
    return Permissions.isAdmin()
      || Permissions.isCdtnLeadership()
      || hasActiveApprovalDelegation('CONFIRM_EVALUATIONS', 'CDTN');
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
        <button id="kpiRefresh" class="kpi-button secondary kpi-icon-sync" type="button" title="Cập nhật dữ liệu" aria-label="Cập nhật dữ liệu">↻</button>
      </div>
    </div>
    <div id="kpiMessage"></div>
    <div class="kpi-metrics">
      <div class="kpi-metric kpi-metric-plan"><span>A · Kế hoạch</span><strong id="kpiMetricA">0</strong><small>Tổng điểm quy đổi tối đa</small></div>
      <div class="kpi-metric kpi-metric-actual"><span>B · Thực tế</span><strong id="kpiMetricB">0</strong><small>Tổng điểm quy đổi thực tế</small></div>
      <div class="kpi-metric kpi-metric-work"><span>KPI công việc</span><strong id="kpiMetric70">0/70</strong><small>Quy đổi theo nhiệm vụ</small></div>
      <div class="kpi-metric kpi-metric-common"><span>Tiêu chí chung</span><strong id="kpiMetric30">0/30</strong><small>Tự chấm hoặc xác nhận</small></div>
      <div class="kpi-metric kpi-metric-total"><span>Tổng điểm</span><strong id="kpiMetric100">0/100</strong><small>Kết quả hiện tại</small></div>
    </div>
    <div id="kpiScoreState" class="kpi-score-state kpi-hidden" aria-live="polite"></div>
    <div id="kpiManagementToolbar" class="kpi-toolbar kpi-no-print kpi-hidden"></div>
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
  return `<div class="kpi-scope-switch" role="tablist" aria-label="Chọn phạm vi KPI">
    <span class="kpi-scope-switch-label">Phạm vi</span>
    <div class="kpi-scope-switch-options">${options.map(option => `<button type="button" role="tab" class="kpi-scope-option ${selectedScope === option.value ? 'is-active' : ''}" aria-selected="${selectedScope === option.value ? 'true' : 'false'}" data-kpi-scope="${esc(option.value)}"><span>${option.value === 'CDTN' ? '🌿' : option.value === 'ALL' ? '🏢' : '📁'}</span><strong>${esc(option.label)}</strong><small>${option.value === 'CDTN' ? 'Chi đoàn' : option.value === 'ALL' ? 'Toàn hệ thống' : 'Chuyên môn'}</small></button>`).join('')}</div>
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
    ? `<span class="kpi-plan-state ${KpiWorkflowState.plan?.locked === true ? 'is-locked' : 'is-open'}">${KpiWorkflowState.plan?.locked === true ? 'Đã khóa đăng ký' : 'Đang mở đăng ký'}</span>`
    : '';
  toolbar.innerHTML = `${status}${parts.join('')}`;
  toolbar.classList.toggle('kpi-hidden', !toolbar.innerHTML.trim());

  toolbar.querySelectorAll('[data-kpi-scope]').forEach(button => button.addEventListener('click', async () => {
    const nextScope = button.dataset.kpiScope || (globalRole() ? 'ALL' : profileDepartmentId());
    if (nextScope === activeScopeDepartmentId()) return;
    KpiWorkflowState.scopeDepartmentId = nextScope;
    KpiWorkflowState.tasks = [];
    KpiWorkflowState.registrations = [];
    KpiWorkflowState.evaluations = [];
    KpiWorkflowState.commonAll = [];
    message(`Đang tải phạm vi ${departmentDisplayName(nextScope)}...`);
    await loadAll();
  }));
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
  el('kpiRefresh')?.addEventListener('click', loadAll);
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
    if (edit) return openEditPeriod(edit.dataset.periodEdit);
    if (activate) return activatePeriod(activate.dataset.periodActivate);
    if (complete) return completePeriodById(complete.dataset.periodComplete);
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
    if (!name || !startDate || !endDate || startDate > endDate) return alert('Thông tin kỳ chưa hợp lệ.');
    await updateDoc(doc(db,'evaluationPeriods',periodId), { name, startDate, endDate, updatedAt:serverTimestamp(), updatedByUserId:KpiWorkflowState.user.uid });
    PeriodReadService.invalidate();
    await audit('UPDATE_PERIOD',{periodId,startDate,endDate});
    closeModal(); await loadAll(); openPeriodManager();
  });
}

async function activatePeriod(periodId) {
  if (!Permissions.canManageEvaluationPeriods()) return;
  if (KpiWorkflowState.periods.some(period => period.active === true && period.id !== periodId)) return alert('Đang có một kỳ hoạt động. Hãy kết thúc kỳ đó trước.');
  await updateDoc(doc(db,'evaluationPeriods',periodId), { active:true, status:'ACTIVE', activatedAt:serverTimestamp(), activatedByUserId:KpiWorkflowState.user.uid, updatedAt:serverTimestamp() });
  PeriodReadService.invalidate();
  await audit('ACTIVATE_PERIOD',{periodId});
  closeModal(); await loadAll(); openPeriodManager();
}

async function completePeriodById(periodId) {
  if (!Permissions.canManageEvaluationPeriods()) return;
  if (KpiWorkflowState.period?.id !== periodId || KpiWorkflowState.period?.active !== true) {
    alert('Chỉ có thể kết thúc kỳ đang hoạt động.');
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
    const periodSnapshot = await getDocs(
      canBrowseCompletedPeriods
        ? collection(db, 'evaluationPeriods')
        : query(collection(db, 'evaluationPeriods'), where('active', '==', true), limit(1))
    );
    KpiWorkflowState.periods = periodSnapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    KpiWorkflowState.period = KpiWorkflowState.periods.find(period => period.active === true && period.status !== 'DELETED')
      || (canBrowseCompletedPeriods ? KpiWorkflowState.periods.filter(period => period.status === 'COMPLETED').sort((a, b) => clean(b.endDate).localeCompare(clean(a.endDate)))[0] : null)
      || null;

    if (!KpiWorkflowState.period) {
      KpiWorkflowState.users = [KpiWorkflowState.profile];
      KpiWorkflowState.tasks = [];
      KpiWorkflowState.registrations = [];
      KpiWorkflowState.evaluations = [];
      KpiWorkflowState.commonAll = [];
      KpiWorkflowState.common = null;
      KpiWorkflowState.plan = null;
      KpiWorkflowState.delegations = [];
      KpiWorkflowState.kpiProfile = null;
      render();
      message(Permissions.canManageEvaluationPeriods() ? 'Chưa có kỳ đánh giá đang hoạt động. Trưởng phòng TCHC có thể tạo hoặc kích hoạt kỳ đánh giá.' : 'Chưa có kỳ đánh giá đang hoạt động.');
      return;
    }

    const homeDepartmentId = profileDepartmentId();
    const periodId = KpiWorkflowState.period.id;

    if (!globalRole() && normalizeDepartment(KpiWorkflowState.scopeDepartmentId) === 'ALL') {
      KpiWorkflowState.scopeDepartmentId = homeDepartmentId;
    }

    KpiWorkflowState.delegations = [];
    const delegationRequests = [];

    if (isDeputyLeader() || isDepartmentHead()) {
      delegationRequests.push(
        getDoc(doc(db, 'approvalDelegations', `${homeDepartmentId}_ACTIVE`))
          .then(snapshot => ({ type: 'DEPARTMENT', snapshot }))
          .catch(error => {
            console.warn('Không đọc được ủy quyền Phòng/Khu:', error);
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
      const isCdtnLeader = result.type === 'CDTN' && Permissions.isCdtnLeadership();
      if (isOwnDepartmentHead || isCdtnLeader || delegation.delegateUserId === KpiWorkflowState.user.uid) {
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
    const combinedDepartmentReportScope = KpiWorkflowState.mode === 'reports'
      && departmentId !== 'ALL'
      && departmentId !== 'CDTN'
      && taskDepartmentScope;

    const taskRequest = fullCenterScope
      ? getDocs(query(collection(db, 'tasks'), where('periodId', '==', periodId)))
      : professionalCenterScope
        ? (KpiWorkflowState.mode === 'reports'
          ? mergeAvailableSnapshotRequests([
              getDocs(query(collection(db, 'tasks'), where('periodId', '==', periodId), where('primaryDepartmentId', 'in', PROFESSIONAL_DEPARTMENT_IDS))),
              getDocs(query(collection(db, 'tasks'), where('periodId', '==', periodId), where('primaryDepartmentId', '==', 'CDTN'))),
              getDocs(query(collection(db, 'tasks'), where('periodId', '==', periodId), where('organizationId', '==', 'CDTN')))
            ], 'nhiệm vụ báo cáo toàn phạm vi được cấp')
          : getDocs(query(collection(db, 'tasks'), where('periodId', '==', periodId), where('primaryDepartmentId', 'in', PROFESSIONAL_DEPARTMENT_IDS))))
        : departmentId === 'CDTN' && taskDepartmentScope
          ? mergeAvailableSnapshotRequests([
              getDocs(query(collection(db, 'tasks'), where('periodId', '==', periodId), where('primaryDepartmentId', '==', 'CDTN'))),
              getDocs(query(collection(db, 'tasks'), where('periodId', '==', periodId), where('organizationId', '==', 'CDTN')))
            ], 'nhiệm vụ Chi đoàn')
          : combinedDepartmentReportScope
            ? mergeAvailableSnapshotRequests([
                getDocs(query(collection(db, 'tasks'), where('periodId', '==', periodId), where('primaryDepartmentId', '==', departmentId))),
                getDocs(query(collection(db, 'tasks'), where('periodId', '==', periodId), where('primaryDepartmentId', '==', 'CDTN'))),
                getDocs(query(collection(db, 'tasks'), where('periodId', '==', periodId), where('organizationId', '==', 'CDTN')))
              ], 'nhiệm vụ chuyên môn và Chi đoàn cho báo cáo')
            : taskDepartmentScope
              ? getDocs(query(collection(db, 'tasks'), where('periodId', '==', periodId), where('primaryDepartmentId', '==', departmentId)))
              : getDocs(query(collection(db, 'tasks'), where('periodId', '==', periodId), where('ownerUserId', '==', KpiWorkflowState.user.uid)));

    const registrationRequest = fullCenterScope
      ? getDocs(query(collection(db, 'taskRegistrations'), where('periodId', '==', periodId)))
      : professionalCenterScope
        ? getDocs(query(collection(db, 'taskRegistrations'), where('periodId', '==', periodId), where('departmentId', 'in', PROFESSIONAL_DEPARTMENT_IDS)))
        : departmentId === 'CDTN' && registrationDepartmentScope
          ? mergeAvailableSnapshotRequests([
              getDocs(query(collection(db, 'taskRegistrations'), where('periodId', '==', periodId), where('departmentId', '==', 'CDTN'))),
              getDocs(query(collection(db, 'taskRegistrations'), where('periodId', '==', periodId), where('organizationId', '==', 'CDTN')))
            ], 'đăng ký nhiệm vụ Chi đoàn')
          : registrationDepartmentScope
            ? getDocs(query(collection(db, 'taskRegistrations'), where('periodId', '==', periodId), where('departmentId', '==', departmentId)))
            : getDocs(query(collection(db, 'taskRegistrations'), where('periodId', '==', periodId), where('userId', '==', KpiWorkflowState.user.uid)));

    const evaluationRequest = fullCenterScope
      ? getDocs(query(collection(db, 'taskEvaluations'), where('periodId', '==', periodId)))
      : professionalCenterScope
        ? (KpiWorkflowState.mode === 'reports'
          ? mergeAvailableSnapshotRequests([
              getDocs(query(collection(db, 'taskEvaluations'), where('periodId', '==', periodId), where('departmentId', 'in', PROFESSIONAL_DEPARTMENT_IDS))),
              getDocs(query(collection(db, 'taskEvaluations'), where('periodId', '==', periodId), where('departmentId', '==', 'CDTN'))),
              getDocs(query(collection(db, 'taskEvaluations'), where('periodId', '==', periodId), where('organizationId', '==', 'CDTN')))
            ], 'đánh giá báo cáo toàn phạm vi được cấp')
          : getDocs(query(collection(db, 'taskEvaluations'), where('periodId', '==', periodId), where('departmentId', 'in', PROFESSIONAL_DEPARTMENT_IDS))))
        : departmentId === 'CDTN' && evaluationDepartmentScope
          ? mergeAvailableSnapshotRequests([
              getDocs(query(collection(db, 'taskEvaluations'), where('periodId', '==', periodId), where('departmentId', '==', 'CDTN'))),
              getDocs(query(collection(db, 'taskEvaluations'), where('periodId', '==', periodId), where('organizationId', '==', 'CDTN')))
            ], 'đánh giá nhiệm vụ Chi đoàn')
          : combinedDepartmentReportScope
            ? mergeAvailableSnapshotRequests([
                getDocs(query(collection(db, 'taskEvaluations'), where('periodId', '==', periodId), where('departmentId', '==', departmentId))),
                getDocs(query(collection(db, 'taskEvaluations'), where('periodId', '==', periodId), where('departmentId', '==', 'CDTN'))),
                getDocs(query(collection(db, 'taskEvaluations'), where('periodId', '==', periodId), where('organizationId', '==', 'CDTN')))
              ], 'đánh giá chuyên môn và Chi đoàn cho báo cáo')
            : evaluationDepartmentScope
              ? getDocs(query(collection(db, 'taskEvaluations'), where('periodId', '==', periodId), where('departmentId', '==', departmentId)))
              : getDocs(query(collection(db, 'taskEvaluations'), where('periodId', '==', periodId), where('ownerUserId', '==', KpiWorkflowState.user.uid)));

    const commonRequest = fullCenterScope
      ? getDocs(query(collection(db, 'commonCriteriaAssessments'), where('periodId', '==', periodId)))
      : professionalCenterScope
        ? getDocs(query(collection(db, 'commonCriteriaAssessments'), where('periodId', '==', periodId), where('departmentId', 'in', PROFESSIONAL_DEPARTMENT_IDS)))
        : departmentId === 'CDTN'
          ? getDocs(query(collection(db, 'commonCriteriaAssessments'), where('periodId', '==', periodId), where('userId', '==', KpiWorkflowState.user.uid)))
          : evaluationDepartmentScope && departmentId !== 'CDTN'
            ? getDocs(query(collection(db, 'commonCriteriaAssessments'), where('periodId', '==', periodId), where('departmentId', '==', departmentId)))
            : getDocs(query(collection(db, 'commonCriteriaAssessments'), where('periodId', '==', periodId), where('userId', '==', KpiWorkflowState.user.uid)));

    const usersRequest = fullCenterScope
      ? getDocs(collection(db, 'users'))
      : professionalCenterScope
        ? getDocs(query(collection(db, 'users'), where('departmentId', 'in', PROFESSIONAL_DEPARTMENT_IDS)))
        : cdtnAggregateScope
          ? loadCdtnUsers()
          : userDepartmentScope
            ? getDocs(query(collection(db, 'users'), where('departmentId', '==', departmentId)))
            : Promise.resolve(null);
    const profileRequest = getDoc(doc(db, 'kpiProfiles', `${periodId}_${KpiWorkflowState.user.uid}`))
      .catch(error => {
        console.warn('Không đọc được hồ sơ Mẫu 01; tiếp tục tải dữ liệu KPI chính:', error);
        return null;
      });

    const loadResults = await Promise.allSettled([
      usersRequest,
      taskRequest,
      registrationRequest,
      evaluationRequest,
      commonRequest,
      getDoc(doc(db, 'kpiPlans', `${periodId}_${departmentId}`)),
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
    const planSnapshot = valueOr(5, null, 'kế hoạch KPI');
    const profileSnapshot = valueOr(6, null, 'hồ sơ Mẫu 01');

    let loadedUsers = Array.isArray(usersResult)
      ? usersResult
      : usersResult?.docs
        ? usersResult.docs.map(item => normalizeUserRecord(item.data(), item.id))
        : [normalizeUserRecord(KpiWorkflowState.profile, KpiWorkflowState.user.uid)];

    KpiWorkflowState.users = globalRole()
      ? loadedUsers
      : cdtnDepartmentScope
        ? loadedUsers
        : userDepartmentScope
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
    KpiWorkflowState.tasks = tasksSnapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    KpiWorkflowState.registrations = registrationsSnapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    KpiWorkflowState.evaluations = evaluationsSnapshot.docs.map(item => ({ id: item.id, ...item.data() }));
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

function taskForCurrentUser(task) {
  if (!itemInActiveScope(task)) return false;
  if (globalRole()) return true;
  if (isCdtnScope() && canViewDepartmentData()) return true;
  if (isLeader()) return true;
  return task.ownerUserId === KpiWorkflowState.user.uid || task.createdByUserId === KpiWorkflowState.user.uid;
}
function evaluationFor(taskId){ return KpiWorkflowState.evaluations.find(e => e.taskId === taskId); }
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
function scoreRowsForUser(userId) {
  return KpiWorkflowState.tasks.filter(task => task.ownerUserId === userId && itemInActiveScope(task)).map(task => {
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
  const taskOfficial = tasks.length > 0 && taskScores.length === tasks.length && taskScores.every(item => item.official);
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
  el('kpiMetricA').textContent = fmt(currentSummary.A);
  el('kpiMetricB').textContent = fmt(currentSummary.B);
  el('kpiMetric70').textContent = currentSummary.hasCalculationBasis ? `${fmt(currentSummary.kpi70)}/70` : 'Chưa đủ cơ sở';
  el('kpiMetric30').textContent = `${fmt(currentSummary.common30)}/30`;
  el('kpiMetric100').textContent = currentSummary.hasCalculationBasis ? `${fmt(currentSummary.total100)}/100` : 'Chưa đủ cơ sở';

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
function rowsForPerson(uid){return KpiWorkflowState.tasks.filter(t=>t.ownerUserId===uid&&t.active!==false&&itemInActiveScope(t));}
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
    return `<tr><td>${index + 1}</td><td><strong>${esc(user.fullName || user.email || user.id)}</strong><br><span class="kpi-small">${esc(user.position || '')}</span></td><td>${registrations.length || tasks.length}</td><td>${fmt(score)}</td><td><span class="kpi-status">${pending ? `${pending} chờ duyệt` : 'Đã cập nhật'}</span></td><td><button class="kpi-button secondary" data-person-detail="${esc(user.id)}">Chi tiết</button></td></tr>`;
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
        <div class="kpi-review-tasks-toolbar"><div><strong>${esc(selectedUser.fullName || selectedUser.email || selectedUser.id)}</strong><span>${tasks.length} nhiệm vụ hoàn thành</span></div>${canConfirmEvaluations() && reviewable.length ? '<div><button id="kpiReviewSelectAll" class="kpi-button secondary" type="button">Chọn tất cả</button><button id="kpiReviewClearAll" class="kpi-button secondary" type="button">Bỏ chọn</button><button id="kpiConfirmSelected" class="kpi-button" type="button">Xác nhận mục đã chọn</button></div>' : ''}</div>
        <div class="kpi-review-task-scroll">${tasks.map(task => {
          const evaluation = evaluationFor(task.id);
          const own = task.ownerUserId === KpiWorkflowState.user.uid;
          const locked = evaluation?.status === 'CONFIRMED' || evaluation?.scoreLocked === true;
          const score = evaluationScoreSnapshot(evaluation || {});
          const canBatch = Boolean(evaluation && canReviewEvaluation(evaluation, task) && !locked);
          return `<article class="kpi-review-task-row">
            <div class="kpi-review-task-check">${canBatch ? `<input type="checkbox" data-kpi-confirm-check value="${esc(evaluation.id)}">` : '<span>—</span>'}</div>
            <div class="kpi-review-task-main"><strong>${esc(task.taskCode || task.id)} — ${esc(task.title || '')}</strong><span>Tiến độ: ${evaluation?.confirmedProgressRate ?? evaluation?.selfProgressRate ?? progressRateFromDates(task.deadline || task.dueDate, task.completedAt, true)}% · Kết quả: ${evaluation?.confirmedResultRate ?? evaluation?.selfResultRate ?? '—'}%</span></div>
            <div class="kpi-review-task-score"><span>Điểm thực tế</span><strong>${score.hasScore ? fmt(score.convertedActualScore) : '—'}</strong></div>
            <div class="kpi-review-task-action">${own
              ? (locked ? '<span class="kpi-status">Đã xác nhận</span>' : `<button class="kpi-button" data-kpi-self="${esc(task.id)}">${evaluation?.id ? 'Cập nhật tự đánh giá' : 'Tự đánh giá'}</button>`)
              : canBatch
                ? `<button class="kpi-button secondary" data-kpi-review="${esc(evaluation.id)}">Mở chi tiết</button>`
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
  target.querySelector('#kpiReviewSelectAll')?.addEventListener('click', () => target.querySelectorAll('[data-kpi-confirm-check]').forEach(input => { input.checked = true; }));
  target.querySelector('#kpiReviewClearAll')?.addEventListener('click', () => target.querySelectorAll('[data-kpi-confirm-check]').forEach(input => { input.checked = false; }));
  target.querySelector('#kpiConfirmSelected')?.addEventListener('click', async event => {
    const ids = [...target.querySelectorAll('[data-kpi-confirm-check]:checked')].map(input => input.value);
    if (!ids.length) return alert('Hãy chọn ít nhất một nhiệm vụ cần xác nhận.');
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await batchConfirmEvaluations(ids);
      await loadAll();
    } catch (error) {
      alert(friendlyErrorMessage(error, 'Không xác nhận được các nhiệm vụ đã chọn.'));
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
  if (!confirm(`Xác nhận ${rows.length} nhiệm vụ theo điểm tự đánh giá hiện tại? Các điểm này sẽ được khóa chính thức.`)) return;

  const batch = writeBatch(db);
  rows.forEach(({ evaluation, task, score }) => {
    batch.update(doc(db, 'taskEvaluations', evaluation.id), {
      confirmedProgressRate: Number(evaluation.selfProgressRate),
      confirmedResultRate: Number(evaluation.selfResultRate),
      confirmedExecutionScore: score.execution,
      confirmedActualScore: score.actual,
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
      updatedAt: serverTimestamp(),
      updatedByUserId: KpiWorkflowState.user.uid,
      updatedByName: KpiWorkflowState.profile.fullName || ''
    });
  });
  await batch.commit();
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

  const root = modal(`Kế hoạch của ${user.fullName || ''}`, `
    <div class="registration-modal-tools">
      ${canApprove ? '<button id="regSelectAll" class="kpi-button secondary" type="button">Chọn tất cả</button><button id="regClearAll" class="kpi-button secondary" type="button">Bỏ chọn tất cả</button>' : ''}
    </div>
    <div class="kpi-table-wrap"><table class="kpi-table"><thead><tr><th>Duyệt</th><th>Đầu việc</th><th>Điểm chuẩn</th><th>Hệ số độ khó</th><th>Điểm tối đa</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>
      ${rows.map(item => {
        const canManagerCancel = item.kind === 'registration' && canCancelRegistrationAsManager(item);
        return `<tr>
          <td>${item.kind === 'registration' && item.status === 'PENDING' ? `<input type="checkbox" data-reg-review value="${esc(item.id)}" ${canApproveRegistration(item) ? 'checked' : 'disabled'}>` : '—'}</td>
          <td><strong>${esc(item.standardTaskCode || item.taskCode || '')}</strong><br>${esc(item.standardTaskName || item.title || '')}</td>
          <td>${fmt(item.baseScore)}</td><td>${coefficientPercent(item.difficultyCoefficient)}</td><td>${fmt(item.maximumConvertedScore)}</td>
          <td>${esc(item.status === 'PENDING' ? 'Chờ duyệt' : item.status === 'REJECTED' ? 'Đã trả lại' : item.planApprovalStatus === 'APPROVED' || item.status === 'APPROVED' ? 'Đã duyệt' : item.status || '')}</td>
          <td>${canManagerCancel ? `<button class="kpi-button danger" type="button" data-cancel-registration-manager="${esc(item.id)}">Hủy đăng ký cho nhân viên</button>` : '—'}</td>
        </tr>`;
      }).join('')}
    </tbody></table></div>`,
    canApprove ? '<button class="kpi-button secondary" data-kpi-close type="button">Đóng</button><button id="regApproveSelected" class="kpi-button" type="button">Duyệt mục đã chọn</button>' : '<button class="kpi-button secondary" data-kpi-close type="button">Đóng</button>'
  );

  root.querySelector('#regSelectAll')?.addEventListener('click', () => root.querySelectorAll('[data-reg-review]:not(:disabled)').forEach(input => { input.checked = true; }));
  root.querySelector('#regClearAll')?.addEventListener('click', () => root.querySelectorAll('[data-reg-review]').forEach(input => { input.checked = false; }));
  root.querySelectorAll('[data-cancel-registration-manager]').forEach(button => {
    button.addEventListener('click', async () => {
      const registration = registrations.find(item => item.id === button.dataset.cancelRegistrationManager);
      if (!registration) return;
      const taskName = registration.standardTaskName || registration.title || 'đầu việc này';
      if (!confirm(`Hủy đăng ký “${taskName}” của ${user.fullName || 'nhân viên'}? Đầu việc sẽ trở lại danh mục để đăng ký lại khi kế hoạch được mở.`)) return;
      button.disabled = true;
      try {
        await TaskRegistrationService.cancelRegistration(registration, { asManager: true });
        closeModal();
        await loadAll();
        openPersonPlanDetail(uid);
      } catch (error) {
        alert(friendlyErrorMessage(error, 'Không thể hủy đăng ký cho nhân viên.'));
        button.disabled = false;
      }
    });
  });
  root.querySelector('#regApproveSelected')?.addEventListener('click', async () => {
    const ids = [...root.querySelectorAll('[data-reg-review]:checked')].map(input => input.value);
    const selected = pending.filter(item => ids.includes(item.id));
    const unselected = pending.filter(item => !ids.includes(item.id));
    if (!selected.length && !unselected.length) return;
    if (selected.length) await TaskRegistrationService.approveMany(selected, { periodEndDate: KpiWorkflowState.period?.endDate });
    if (unselected.length) await TaskRegistrationService.rejectMany(unselected, 'Không được duyệt trong đợt xét kế hoạch này.');
    closeModal();
    await loadAll();
  });
}
function renderEvaluationDashboard() {
  const target = el('kpiTaskList');
  if (!target) return;
  el('kpiMainCardTitle').textContent = 'Đánh giá và xác nhận nhiệm vụ';
  el('kpiMainCardHint').textContent = 'Chọn nhân viên, chọn nhiệm vụ cần xác nhận hoặc mở chi tiết để điều chỉnh điểm có căn cứ.';
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
  el('kpiMainCardTitle').textContent = 'Báo cáo và tổng hợp KPI';
  el('kpiMainCardHint').textContent = 'Báo cáo cá nhân gộp nhiệm vụ chuyên môn và Chi đoàn thành một kết quả tối đa 100 điểm.';
  target.innerHTML = `<div class="kpi-report-options">
    <button id="reportPersonal" class="kpi-report-option is-personal" type="button"><span>📄</span><strong>Báo cáo KPI cá nhân</strong><small>Gộp nhiệm vụ Phòng/Khu${hasCdtn ? ' và Chi đoàn' : ''}; chỉ tạo một kết quả xếp loại.</small></button>
    <button id="reportProfile" class="kpi-report-option is-profile" type="button"><span>🪪</span><strong>Thông tin Mẫu 01</strong><small>Cập nhật ngày sinh, chức vụ và đơn vị công tác.</small></button>
    ${canViewDepartmentReport() ? `<button id="reportDepartment" class="kpi-report-option is-department" type="button"><span>📊</span><strong>${aggregateTitle}</strong><small>${fullScopeRole() ? 'Lọc toàn Trung tâm hoặc từng Phòng/Khu.' : 'Mỗi cá nhân gồm nhiệm vụ chuyên môn và Chi đoàn.'}</small></button>` : ''}
    ${canAggregateCdtn ? '<button id="reportCdtnAggregate" class="kpi-report-option is-department" type="button"><span>📈</span><strong>Tổng hợp Chi đoàn</strong><small>Báo cáo quản trị riêng hoạt động đoàn viên; không tạo xếp loại cá nhân thứ hai.</small></button>' : ''}
  </div>`;
  el('reportPersonal')?.addEventListener('click', () => openReport());
  el('reportProfile')?.addEventListener('click', openKpiProfileEditor);
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
  const summary = calculateKpiSummary(rows, commonScoreSnapshot(common).total);
  const relevantTasks = personalTasksForUser(userId);
  const evaluations = relevantTasks.map(task => KpiWorkflowState.evaluations.find(item => item.taskId === task.id && item.ownerUserId === userId));
  const hasAny = evaluations.some(item => evaluationScoreSnapshot(item).hasScore);
  const allOfficial = relevantTasks.length > 0 && evaluations.every(item => evaluationScoreSnapshot(item).official);
  if (!summary.hasCalculationBasis) return { code:'NO_BASIS', label:'Chưa đủ cơ sở tính', detail:'Tổng điểm kế hoạch của nhiệm vụ chuyên môn và Chi đoàn bằng 0.', className:'is-empty' };
  if (allOfficial) return { code:'OFFICIAL', label:'Điểm chính thức', detail:'Toàn bộ nhiệm vụ chuyên môn và Chi đoàn đã được xác nhận.', className:'is-official' };
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
  const summary = calculateKpiSummary(rows, commonScoreSnapshot(common).total);
  const relevantTasks = KpiWorkflowState.tasks.filter(task => task.ownerUserId === userId && taskScopeDepartmentId(task) === target && task.active !== false);
  const evaluations = relevantTasks.map(task => KpiWorkflowState.evaluations.find(item => item.taskId === task.id && item.ownerUserId === userId));
  const hasAny = evaluations.some(item => evaluationScoreSnapshot(item).hasScore);
  const allOfficial = relevantTasks.length > 0 && evaluations.every(item => evaluationScoreSnapshot(item).official);
  if (!summary.hasCalculationBasis) return { code:'NO_BASIS', label:'Chưa đủ cơ sở tính', detail:'Tổng điểm A của phạm vi này bằng 0.', className:'is-empty' };
  if (allOfficial) return { code:'OFFICIAL', label:'Điểm chính thức', detail:'Các nhiệm vụ trong phạm vi đã được xác nhận.', className:'is-official' };
  if (hasAny) return { code:'SELF', label:'Điểm tự đánh giá', detail:'Kết quả đang dùng điểm tự đánh giá chưa khóa.', className:'is-provisional' };
  return { code:'EMPTY', label:'Chưa tự đánh giá', detail:'Chưa có điểm nhiệm vụ trong phạm vi này.', className:'is-empty' };
}

function openDepartmentReport(options = {}) {
  if (!canViewDepartmentReport()) {
    alert('Tài khoản không có quyền xem báo cáo tổng hợp của Phòng/Khu hoặc Chi đoàn.');
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
      return `<tr><td>${index + 1}</td><td><strong>${esc(user.fullName || user.email || user.id)}</strong><br><span class="kpi-small">${esc(departmentDisplayName(user.departmentId))}</span></td><td>${esc(user.position || '')}</td><td class="m01-center">${esc(taskBreakdown)}${exemptTaskCount ? `<br><span class="kpi-small">${exemptTaskCount} miễn</span>` : ''}</td><td class="m01-center">${data.hasCalculationBasis ? fmt(data.kpi70) : 'Chưa đủ cơ sở'}</td><td class="m01-center">${fmt(data.common30)}</td><td class="m01-center"><strong>${data.hasCalculationBasis ? fmt(data.total100) : '—'}</strong></td><td>${esc(ratingName(proposedRating(data.total100)))}</td><td><span class="kpi-score-badge">${esc(stateLabel)}</span></td></tr>`;
    }).join('');

    const scopeTitle = departmentId === 'ALL' ? 'Toàn Trung tâm' : departmentDisplayName(departmentId);
    const reportHeading = isCdtnAggregate ? 'BẢNG TỔNG HỢP HOẠT ĐỘNG CHI ĐOÀN' : 'BẢNG TỔNG HỢP KẾT QUẢ ĐÁNH GIÁ';
    const reportNote = isCdtnAggregate
      ? 'Báo cáo quản trị riêng nhiệm vụ Chi đoàn; không cộng tiêu chí chung, không tính tổng 100 điểm và không tạo mức xếp loại cá nhân thứ hai.'
      : 'Mỗi cá nhân được tính chung nhiệm vụ chuyên môn và Chi đoàn trong một kết quả tối đa 100 điểm.';
    const tableHead = isCdtnAggregate
      ? '<tr><th>STT</th><th>Họ và tên</th><th>Vai trò Chi đoàn</th><th>Nhiệm vụ Chi đoàn</th><th>Điểm kế hoạch (A)</th><th>Điểm thực tế (B)</th><th>Trạng thái đánh giá</th></tr>'
      : '<tr><th>STT</th><th>Họ và tên</th><th>Chức vụ</th><th>Nhiệm vụ tính KPI</th><th>Điểm nhiệm vụ</th><th>Điểm tiêu chí chung</th><th>Tổng điểm</th><th>Mức xếp loại</th><th>Trạng thái điểm</th></tr>';
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
  if (task.planApprovalStatus === 'REJECTED') return 'Kế hoạch bị trả lại';
  if (task.planApprovalStatus === 'APPROVED') return 'Đã duyệt kế hoạch';
  return task.status === 'HOAN_THANH' ? 'Đã hoàn thành' : 'Đang thực hiện';
}
function renderTasks() {
  const target = el('kpiTaskList');
  if (!target) return;
  if (!KpiWorkflowState.period) { target.innerHTML = '<div class="kpi-empty">Chưa có kỳ đánh giá.</div>'; return; }
  const rows = KpiWorkflowState.tasks.filter(taskForCurrentUser).sort((a,b) => clean(a.taskCode).localeCompare(clean(b.taskCode)));
  const myRegistrations = KpiWorkflowState.registrations.filter(r => r.userId === KpiWorkflowState.user.uid);
  if (!rows.length && !myRegistrations.length) { target.innerHTML = '<div class="kpi-empty">Chưa có đầu việc trong kỳ. Viên chức vào “Danh mục công việc”, tick chọn và đăng ký kế hoạch.</div>'; return; }
  const registrationRows = myRegistrations.filter(r => !r.taskId).map(r => `<tr><td><strong>${esc(r.standardTaskCode || r.id)}</strong><br>${esc(r.standardTaskName || r.title)}</td><td><span class="kpi-status">${r.status === 'PENDING' ? 'Chờ cấp có thẩm quyền duyệt' : r.status === 'REJECTED' ? 'Đã trả lại' : 'Đã duyệt'}</span></td><td>${fmt(r.maximumConvertedScore)}</td><td>Chưa hình thành nhiệm vụ</td><td>${r.rejectionReason ? esc(r.rejectionReason) : '—'}</td></tr>`).join('');
  target.innerHTML = `<div class="kpi-table-wrap"><table class="kpi-table"><thead><tr><th>Mã/Nhiệm vụ</th><th>Kế hoạch</th><th>Điểm tối đa</th><th>Đánh giá</th><th>Thao tác</th></tr></thead><tbody>${registrationRows}${rows.map(task => {
    const ev = evaluationFor(task.id);
    const exemptFromScoring = String(task.scoringStatus || '').toUpperCase() === 'ADJUSTMENT_EXEMPT';
    const canApprove = canApproveDepartmentPlanTask(task) && task.planApprovalStatus === 'PENDING_APPROVAL';
    const canSelf = task.ownerUserId === KpiWorkflowState.user.uid && task.planApprovalStatus === 'APPROVED' && KpiWorkflowState.period.status !== 'COMPLETED' && ev?.status !== 'CONFIRMED' && ev?.scoreLocked !== true && String(task.noOccurrenceStatus || '').toUpperCase() !== 'CONFIRMED'
      && String(task.scoringStatus || '').toUpperCase() !== 'ADJUSTMENT_EXEMPT'
      && String(task.adjustmentStatus || '').toUpperCase() !== 'REQUESTED';
    return `<tr><td><strong>${esc(task.taskCode || task.standardTaskCode || task.id)}</strong><br>${esc(task.title)}<br><span class="kpi-small">${esc(task.ownerName || 'Chờ phân công')}</span></td>
      <td><span class="kpi-status">${esc(taskStatus(task,ev))}</span><br><span class="kpi-small">${task.includedInA === true ? 'Thuộc A' : 'Chưa vào A'}</span>${task.isCoreTask === true ? '<br><strong>⭐ Cốt lõi</strong>' : ''}</td>
      <td>${fmt(task.maximumConvertedScore)}</td>
      <td>${exemptFromScoring ? '<strong>Không áp dụng</strong><br><span class="kpi-small">Miễn đánh giá do điều động</span>' : ev ? (()=>{const score=evaluationScoreSnapshot(ev);return `<strong>${fmt(score.convertedActualScore)}</strong><br><span class="kpi-small">Quy đổi thực tế · ${esc(score.label)}</span>`;})() : 'Chưa đánh giá'}</td>
      <td><div class="kpi-actions">${canApprove ? `<button class="kpi-button secondary" data-kpi-approve-plan="${task.id}">Duyệt vào kế hoạch</button><button class="kpi-button danger" data-kpi-reject-plan="${task.id}">Trả lại</button>` : ''}${canSelf ? `<button class="kpi-button" data-kpi-self="${task.id}">${ev ? 'Cập nhật tự đánh giá' : 'Tự đánh giá'}</button>` : ''}<button class="kpi-button secondary" data-kpi-view="${task.id}">Chi tiết</button></div></td></tr>`;
  }).join('')}</tbody></table></div>`;
}

function canReviewEvaluation(ev, task) {
  if (!ev || !task || ev.ownerUserId === KpiWorkflowState.user.uid || ev.status === 'CONFIRMED' || ev.scoreLocked === true) return false;
  if (activeRole('ADMIN')) return true;
  if (taskScopeDepartmentId(task) === 'CDTN') {
    return canConfirmEvaluations() && sameDepartment(task);
  }
  if (activeRole('DIRECTOR')) {
    return ['DIRECTOR', 'DEPARTMENT_LEADER'].includes(clean(ev.ownerRole).toUpperCase());
  }
  return canConfirmEvaluations() && sameDepartment(task);
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
  const pendingCommon = KpiWorkflowState.commonAll.filter(item => item.userId !== KpiWorkflowState.user.uid && item.status === 'SELF_COMPLETED' && (activeRole('ADMIN') || ((isDepartmentHead() || hasActiveApprovalDelegation('CONFIRM_EVALUATIONS')) && normalizeDepartment(item.departmentId) === activeScopeDepartmentId())));
  if (!groups.length && !pending.length && !pendingCommon.length) { target.innerHTML = '<div class="kpi-empty">Không có hồ sơ chờ xử lý.</div>'; return; }
  const groupHtml = groups.map(group => `<article class="registration-person-card"><div><strong>${esc(group.userName || 'Người đăng ký')}</strong><small>${esc(group.userPosition || '')}</small><span>${group.items.length} đầu việc chờ duyệt</span></div><div class="kpi-actions">${group.items.some(canApproveRegistration) ? `<button class="kpi-button" data-registration-group="${esc(group.userId)}">Xem chi tiết</button>` : '<span class="kpi-status">Chỉ xem</span>'}</div></article>`).join('');
  target.innerHTML = `${groupHtml}${pendingCommon.map(item=>`<div class="kpi-alert"><strong>Chờ xác nhận Mẫu 01 · 30 điểm</strong><br>${esc(item.fullName)} · Tự chấm ${fmt(item.selfTotal)}/30<div class="kpi-actions"><button class="kpi-button" data-kpi-review-common="${item.id}">Mở xác nhận</button></div></div>`).join('')}${pending.map(({ev,task})=>`<div class="kpi-alert ${ev.status==='NEEDS_REVISION'?'':'kpi-ok'}"><strong>${ev.status==='NEEDS_REVISION'?'Đang yêu cầu bổ sung':'Chờ xác nhận điểm'}</strong><br>${esc(task?.ownerName)} · ${esc(task?.title)}<div class="kpi-actions"><button class="kpi-button" data-kpi-review="${ev.id}">Mở xác nhận</button></div></div>`).join('')}`;
}

function openRegistrationGroup(userId) {
  const items = KpiWorkflowState.registrations.filter(r => r.userId === userId && r.status === 'PENDING');
  if (!items.length) return;
  const canApprove = items.some(canApproveRegistration);
  const body = `<div class="registration-modal-tools"><button id="regSelectAll" class="kpi-button secondary" type="button">Chọn tất cả</button><button id="regClearAll" class="kpi-button secondary" type="button">Bỏ chọn tất cả</button></div><div class="registration-approval-list">${items.map(r=>`<label class="registration-approval-row"><input type="checkbox" data-reg-review value="${esc(r.id)}" ${canApproveRegistration(r)?'checked':'disabled'}><span><strong>${esc(r.standardTaskCode || '')} — ${esc(r.standardTaskName || r.title)}</strong><small>Điểm tối đa: ${fmt(r.maximumConvertedScore)}</small></span></label>`).join('')}</div>`;
  const footer = canApprove ? '<button class="kpi-button secondary" data-kpi-close type="button">Đóng</button><button id="regRejectAll" class="kpi-button danger" type="button">Trả lại toàn bộ</button><button id="regApproveSelected" class="kpi-button" type="button">Duyệt các mục đã chọn</button>' : '<button class="kpi-button secondary" data-kpi-close type="button">Đóng</button>';
  modal(`Đăng ký của ${items[0].userName || ''}`, body, footer);
  el('regSelectAll')?.addEventListener('click',()=>document.querySelectorAll('[data-reg-review]:not(:disabled)').forEach(x=>x.checked=true));
  el('regClearAll')?.addEventListener('click',()=>document.querySelectorAll('[data-reg-review]:not(:disabled)').forEach(x=>x.checked=false));
  el('regApproveSelected')?.addEventListener('click', async()=>{ const ids=[...document.querySelectorAll('[data-reg-review]:checked')].map(x=>x.value); const selected=items.filter(r=>ids.includes(r.id)); if(!selected.length)return alert('Chưa chọn đầu việc để duyệt.'); await TaskRegistrationService.approveMany(selected,{periodEndDate:KpiWorkflowState.period?.endDate}); const unselected=items.filter(r=>!ids.includes(r.id)); if(unselected.length) await TaskRegistrationService.rejectMany(unselected,'Không được duyệt trong đợt xét kế hoạch này.'); closeModal(); await loadAll(); });
  el('regRejectAll')?.addEventListener('click', async()=>{ const reason=prompt('Nhập lý do trả lại toàn bộ:'); if(!clean(reason))return; await TaskRegistrationService.rejectMany(items,reason); closeModal(); await loadAll(); });
}

async function handleRegistrationAction(event) {
  const approve = event.target.closest('[data-registration-approve]');
  const reject = event.target.closest('[data-registration-reject]');
  if (!approve && !reject) return false;
  const id = (approve || reject).dataset.registrationApprove || (approve || reject).dataset.registrationReject;
  const registration = KpiWorkflowState.registrations.find(r => r.id === id);
  if (!registration) return true;
  if (approve) {
    const core = window.confirm('Chọn OK nếu đây là đầu việc cốt lõi của cá nhân; chọn Cancel nếu không phải.');
    await TaskRegistrationService.approve(registration, { isCoreTask: core });
  } else {
    const reason = prompt('Nhập lý do trả lại đăng ký:');
    if (!clean(reason)) return true;
    await TaskRegistrationService.reject(registration, reason);
  }
  await loadAll();
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
  const core = window.confirm('Chọn OK nếu đây là nhiệm vụ cốt lõi của cá nhân; chọn Cancel nếu không phải.');
  await updateDoc(doc(db,'tasks',taskId), {
    planApprovalStatus:'APPROVED', includedInA: true, isCoreTask:core,
    planApprovedByUserId:KpiWorkflowState.user.uid, planApprovedByName:KpiWorkflowState.profile.fullName || '', planApprovedAt:serverTimestamp(), scoringEnabled:true, updatedAt:serverTimestamp(), updatedByUserId:KpiWorkflowState.user.uid, updatedByName:KpiWorkflowState.profile.fullName || ''
  });
  await audit('APPROVE_PLAN_TASK', { taskId, isCoreTask:core });
  await loadAll();
}


async function rejectPlanTask(taskId){
  const task=KpiWorkflowState.tasks.find(t=>t.id===taskId);
  if(!canApproveDepartmentPlanTask(task))return;
  const reason=clean(prompt('Nhập lý do trả lại kế hoạch:')||'');
  if(!reason){alert('Phải nhập lý do trả lại.');return;}
  await updateDoc(doc(db,'tasks',taskId),{
    planApprovalStatus:'REJECTED',includedInA:false,planRejectedReason:reason,
    planRejectedByUserId:KpiWorkflowState.user.uid,planRejectedByName:KpiWorkflowState.profile.fullName||'',planRejectedAt:serverTimestamp(),updatedAt:serverTimestamp(),updatedByUserId:KpiWorkflowState.user.uid,updatedByName:KpiWorkflowState.profile.fullName||''
  });
  await audit('REJECT_PLAN_TASK',{taskId,reason});
  await loadAll();
}

function reviewerForOwner(ownerId, task = null) {
  const owner = KpiWorkflowState.users.find(user => user.id === ownerId)
    || (ownerId === KpiWorkflowState.user?.uid ? KpiWorkflowState.profile : null);
  if (!owner) return { email: '', uid: '', name: '' };

  if (normalizeDepartment(task?.primaryDepartmentId) === 'CDTN') {
    const taskApproverUserId = clean(task?.adjustmentApproverUserId || task?.assignedByUserId || task?.createdByUserId);
    if (taskApproverUserId && taskApproverUserId !== ownerId) {
      return {
        email: clean(task?.reviewerEmail),
        uid: taskApproverUserId,
        name: clean(task?.adjustmentApproverName || task?.assignedByName || task?.createdByName) || 'Bí thư/người được ủy quyền'
      };
    }
    const cdtnLeader = KpiWorkflowState.users.find(user => {
      const roles = Array.isArray(user.additionalRoles) ? user.additionalRoles.map(normalizeDepartment) : [];
      return user.active === true
        && user.id !== ownerId
        && roles.some(role => ['CDTN_BI_THU', 'CDTN_PHO_BI_THU'].includes(role));
    });
    const delegated = KpiWorkflowState.delegations.find(item =>
      delegationDepartmentId(item) === 'CDTN'
      && delegationAllows(item, 'CONFIRM_EVALUATIONS')
    );
    if (delegated && delegated.delegateUserId !== ownerId) {
      const delegate = KpiWorkflowState.users.find(user => user.id === delegated.delegateUserId);
      return {
        email: delegate?.email || delegated.delegateEmail || '',
        uid: delegated.delegateUserId || '',
        name: delegate?.fullName || delegated.delegateName || 'Người được lãnh đạo Chi đoàn ủy quyền'
      };
    }
    return {
      email: cdtnLeader?.email || '',
      uid: cdtnLeader?.id || '',
      name: cdtnLeader?.fullName || 'Bí thư/Phó Bí thư Chi đoàn'
    };
  }

  if (owner.role === 'STAFF') {
    const leaders = KpiWorkflowState.users.filter(user =>
      user.active === true
      && user.role === 'DEPARTMENT_LEADER'
      && normalizeDepartment(user.departmentId) === normalizeDepartment(owner.departmentId)
    );
    const leader = leaders.find(user => Permissions.isDepartmentHead(user)) || leaders[0];
    return { email: leader?.email || '', uid: leader?.id || '', name: leader?.fullName || 'Trưởng phòng/Khu' };
  }
  const reviewer = KpiWorkflowState.users.find(user => user.active === true && user.role === 'DIRECTOR' && user.id !== ownerId);
  return { email: reviewer?.email || '', uid: reviewer?.id || '', name: reviewer?.fullName || 'Thành viên Ban Giám đốc khác' };
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
  const task = KpiWorkflowState.tasks.find(t=>t.id===taskId); if (!task) return;
  const ev = evaluationFor(taskId) || {};
  if (String(task.noOccurrenceStatus || '').toUpperCase() === 'CONFIRMED') {
    alert('Đầu việc đã được xác nhận không phát sinh, đã loại khỏi A và không thực hiện chấm điểm.');
    return;
  }
  if (ev.status === 'CONFIRMED' || ev.scoreLocked === true) {
    alert('Kết quả nhiệm vụ đã được xác nhận và không thể chỉnh sửa.');
    return;
  }

  const itemized = String(task.trackingMode || 'FINAL_OUTPUT').toUpperCase() === 'ITEMIZED';
  let workItems = [];
  let workSummary = null;
  if (itemized) {
    try {
      workItems = await TaskWorkItemService.list(task.id);
      workSummary = TaskWorkItemService.calculateSummary(workItems, task.workItemType);
    } catch (error) {
      alert(friendlyErrorMessage(error, 'Không đọc được các công việc phát sinh trong kỳ.'));
      return;
    }
    if (!workSummary.count) {
      alert('Đầu việc chưa có lượt phát sinh nên không được chấm 0% hoặc 100%. Hãy cập nhật lượt chi tiết; nếu cả kỳ không phát sinh, gửi đề nghị “Không phát sinh” tại Chi tiết nhiệm vụ.');
      return;
    }
  }

  const suggestedFinalProgress = progressRateFromDates(
    task.deadline || task.dueDate,
    task.completedAt || task.completedDate,
    true
  );
  const initialProgress = itemized
    ? Number(workSummary.appliedProgressRate)
    : Number(ev.selfProgressRate ?? suggestedFinalProgress);
  const initialResult = itemized
    ? Number(workSummary.appliedResultRate)
    : Number(ev.selfResultRate ?? 100);
  const incompleteWarning = itemized && workSummary.incompleteCount > 0
    ? `<div class="kpi-work-item-incomplete-note"><strong>${workSummary.incompleteCount} lượt chưa hoàn thành vẫn được tính trong N.</strong><span>Các lượt này không thuộc T hoặc K, vì vậy tỷ lệ cuối kỳ phản ánh đúng cả phần việc còn tồn.</span></div>`
    : '';
  const workSummaryHtml = itemized ? `<div class="kpi-field full"><div class="kpi-work-item-evaluation-summary">
    <div><span>Tổng lượt ghi nhận (N)</span><strong>${workSummary.count}</strong></div>
    <div><span>Đã hoàn thành</span><strong>${workSummary.completedCount}/${workSummary.count}</strong></div>
    <div><span>${workSummary.workItemType === 'ATTENDANCE' ? 'Có mặt (T)' : 'Đúng hạn (T)'}</span><strong>${workSummary.onTimeCount}/${workSummary.count}</strong></div>
    <div><span>Đạt yêu cầu (K)</span><strong>${workSummary.qualifiedCount}/${workSummary.count}</strong></div>
    <div><span>Tiến độ thực tế</span><strong>${fmt(workSummary.actualProgressRate)}%</strong></div>
    <div><span>Kết quả thực tế</span><strong>${fmt(workSummary.actualResultRate)}%</strong></div>
    <div class="is-applied"><span>Tỷ lệ đưa vào công thức KPI</span><strong>${workSummary.appliedProgressRate}% tiến độ · ${workSummary.appliedResultRate}% kết quả</strong></div>
  </div>${incompleteWarning}<p class="kpi-small">${workSummary.workItemType === 'ATTENDANCE' ? 'Điểm danh: tính T/N và K/N, sau đó quy về 100%–80%–60%–0%; ví dụ 1/2 = 50% được quy về 0%.' : 'Văn bản/lượt: chấm từng lượt, lấy trung bình chính xác rồi quy về 100%–80%–60%–0%; ví dụ trung bình 90% được quy về 80%.'} Toàn đầu việc chỉ được chấm một lần.</p></div>` : '';

  const node = modal('Tự đánh giá nhiệm vụ', `<form id="kpiSelfForm" class="kpi-form-grid">
    <div class="kpi-field full kpi-assessment-task-heading"><strong>${esc(task.taskCode || '')} — ${esc(task.title)}</strong><span>Điểm tối đa: ${fmt(task.maximumConvertedScore)} · Minh chứng bắt buộc: ${esc(task.standardTaskMandatoryEvidence || task.mandatoryEvidence || 'Theo nhiệm vụ')}</span></div>
    ${workSummaryHtml}
    <div class="kpi-field"><label>Tiến độ áp dụng</label><select id="kpiSelfProgress" ${itemized?'disabled':''}>${appendixRateOptions(initialProgress)}</select><small>${itemized?'Tự động tổng hợp và quy đổi theo Phụ lục 04; không chỉnh thủ công.':`Hệ thống đề xuất ${suggestedFinalProgress}% theo hạn và ngày hoàn thành. Chỉ chọn 100%, 80%, 60% hoặc 0%.`}</small></div>
    <div class="kpi-field"><label>Kết quả áp dụng</label><select id="kpiSelfResult" ${itemized?'disabled':''}>${appendixRateOptions(initialResult)}</select><small>${itemized?'Tự động tổng hợp và quy đổi theo Phụ lục 04; không chỉnh thủ công.':'Chỉ chọn một trong bốn mức 100%, 80%, 60% hoặc 0% và nêu căn cứ trong nhận xét.'}</small></div>
    <div class="kpi-field full"><label>Nhận xét kết quả, thành tích và hạn chế</label><textarea id="kpiSelfComment" rows="5" required>${esc(ev.selfComment || '')}</textarea></div>
    <div class="kpi-field full"><label class="kpi-checkbox-line"><input id="kpiExceeded" type="checkbox" ${ev.isExceededRequirement===true?'checked':''}> Đề nghị ghi nhận hoàn thành vượt mức yêu cầu</label><textarea id="kpiExceededText" rows="3" placeholder="Nêu rõ sản phẩm, khối lượng, chất lượng hoặc giá trị bổ sung...">${esc(ev.exceededRequirementDescription || '')}</textarea></div>
    <div class="kpi-field full"><div id="kpiSelfScore"></div></div>
  </form>`, '<button class="kpi-button secondary" data-kpi-close type="button">Hủy</button><button id="kpiSubmitSelf" class="kpi-button" type="button">Gửi xác nhận</button>');
  const recalc=()=>{ const x=calculateTaskScore(task.baseScore,task.difficultyCoefficient,el('kpiSelfProgress').value,el('kpiSelfResult').value); el('kpiSelfScore').innerHTML=scoreBreakdownHtml(task,x,{title:'Điểm tự đánh giá',actualProgressRate:itemized?workSummary.actualProgressRate:x.progressRate,actualResultRate:itemized?workSummary.actualResultRate:x.resultRate}); };
  el('kpiSelfProgress').addEventListener('change',recalc); el('kpiSelfResult').addEventListener('change',recalc); recalc();
  el('kpiSubmitSelf').addEventListener('click', async()=>{
    const comment=clean(el('kpiSelfComment').value); if(!comment){alert('Vui lòng nhập nhận xét.');return;}
    let progress, result;
    try {
      progress=assessmentRate(el('kpiSelfProgress').value,'Tiến độ áp dụng');
      result=assessmentRate(el('kpiSelfResult').value,'Kết quả áp dụng');
    } catch(error) { alert(friendlyErrorMessage(error)); return; }
    const score=calculateTaskScore(task.baseScore,task.difficultyCoefficient,progress,result);
    const reviewer=reviewerForOwner(KpiWorkflowState.user.uid, task);
    const exceeded=el('kpiExceeded').checked, exceededText=clean(el('kpiExceededText').value);
    if(exceeded && !exceededText){alert('Vui lòng nêu căn cứ vượt mức yêu cầu.');return;}
    const evaluationScope = taskScopeDepartmentId(task) || KpiWorkflowState.profile.departmentId || '';
    const evaluationPayload = {
      periodId:KpiWorkflowState.period.id, taskId:task.id, taskCode:task.taskCode||'', ownerUserId:KpiWorkflowState.user.uid, ownerName:KpiWorkflowState.profile.fullName||'', ownerRole:KpiWorkflowState.profile.role||'', departmentId:clean(ev.departmentId) || evaluationScope,
      trackingMode:itemized?'ITEMIZED':'FINAL_OUTPUT', actualWorkItemCount:itemized?workSummary.count:null, actualCompletedCount:itemized?workSummary.completedCount:null, actualOnTimeCount:itemized?workSummary.onTimeCount:null, actualQualifiedCount:itemized?workSummary.qualifiedCount:null, actualProgressRate:itemized?workSummary.actualProgressRate:null, actualResultRate:itemized?workSummary.actualResultRate:null,
      selfProgressRate:progress,selfResultRate:result,selfExecutionScore:score.execution,selfActualScore:score.actual,selfComment:comment,
      confirmedProgressRate:null,confirmedResultRate:null,confirmedExecutionScore:null,confirmedActualScore:null,reviewerEmail:reviewer.email,reviewerUserId:reviewer.uid,reviewerName:reviewer.name,
      isExceededRequirement:exceeded,exceededRequirementDescription:exceededText,status:'PENDING_REVIEW',formulaVersion:'KPI_2026_PHU_LUC_4_NTK_V3',updatedAt:serverTimestamp(),createdAt:ev.createdAt||serverTimestamp()
    };
    if (!ev.id && evaluationScope === 'CDTN') evaluationPayload.organizationId = 'CDTN';
    await setDoc(doc(db,'taskEvaluations',`${KpiWorkflowState.period.id}_${task.id}`),evaluationPayload,{merge:true});
    await audit('SUBMIT_SELF_ASSESSMENT',{taskId, trackingMode:itemized?'ITEMIZED':'FINAL_OUTPUT', actualWorkItemCount:itemized?workSummary.count:null, selfExecutionScore:score.execution, selfActualScore:score.actual}); closeModal(); await loadAll();
  });
}

function openReview(evalId) {
  const ev=KpiWorkflowState.evaluations.find(e=>e.id===evalId); const task=KpiWorkflowState.tasks.find(t=>t.id===ev?.taskId); if(!ev||!task||!canReviewEvaluation(ev,task))return;
  modal('Xác nhận điểm nhiệm vụ', `<form class="kpi-form-grid"><div class="kpi-field full kpi-assessment-task-heading"><strong>${esc(task.ownerName)} · ${esc(task.title)}</strong><span>Tự chấm: tiến độ ${ev.selfProgressRate}%, kết quả ${ev.selfResultRate}%, điểm thực hiện ${fmt(ev.selfExecutionScore)}, điểm quy đổi thực tế ${fmt(ev.selfActualScore)}</span>${ev.trackingMode==='ITEMIZED'?`<small>Căn cứ N–T–K: ${ev.actualWorkItemCount||0} lượt · Tiến độ thực tế ${fmt(ev.actualProgressRate)}% · Kết quả thực tế ${fmt(ev.actualResultRate)}%.</small>`:''}</div>
    <div class="kpi-field"><label>Tiến độ xác nhận</label><select id="kpiConfirmProgress">${appendixRateOptions(Number(ev.confirmedProgressRate??ev.selfProgressRate))}</select><small>Chỉ chọn 100%, 80%, 60% hoặc 0%.</small></div>
    <div class="kpi-field"><label>Kết quả xác nhận</label><select id="kpiConfirmResult">${appendixRateOptions(Number(ev.confirmedResultRate??ev.selfResultRate))}</select><small>Nếu điều chỉnh khác tự chấm, phải nêu căn cứ.</small></div>
    <div class="kpi-field full"><label>Nhận xét/căn cứ</label><textarea id="kpiReviewerComment" rows="4">${esc(ev.reviewerComment||'')}</textarea></div>
    <div class="kpi-field full"><div id="kpiConfirmScore"></div></div>
    <div class="kpi-field full"><div class="kpi-confirm-once"><strong>Xác nhận một lần</strong><span>Sau khi xác nhận, điểm trở thành điểm chính thức và không thể chỉnh sửa.</span></div></div></form>`,
    '<button id="kpiNeedRevision" class="kpi-button secondary" type="button">Yêu cầu bổ sung</button><button class="kpi-button secondary" data-kpi-close type="button">Hủy</button><button id="kpiConfirmEvaluation" class="kpi-button" type="button">Xác nhận điểm</button>');
  const recalc=()=>{const x=calculateTaskScore(task.baseScore,task.difficultyCoefficient,el('kpiConfirmProgress').value,el('kpiConfirmResult').value);el('kpiConfirmScore').innerHTML=scoreBreakdownHtml(task,x,{title:'Điểm xác nhận'});};
  el('kpiConfirmProgress').addEventListener('change',recalc);el('kpiConfirmResult').addEventListener('change',recalc);recalc();
  el('kpiNeedRevision').addEventListener('click',async()=>{const note=clean(el('kpiReviewerComment').value);if(!note){alert('Nhập nội dung cần bổ sung.');return;}await updateDoc(doc(db,'taskEvaluations',ev.id),{status:'NEEDS_REVISION',reviewerComment:note,reviewedByUserId:KpiWorkflowState.user.uid,reviewedByName:KpiWorkflowState.profile.fullName||'',updatedAt:serverTimestamp()});closeModal();await loadAll();});
  el('kpiConfirmEvaluation').addEventListener('click',async()=>{let p,r;try{p=assessmentRate(el('kpiConfirmProgress').value,'Tiến độ xác nhận');r=assessmentRate(el('kpiConfirmResult').value,'Kết quả xác nhận');}catch(error){alert(friendlyErrorMessage(error));return;}const note=clean(el('kpiReviewerComment').value);if((p!==Number(ev.selfProgressRate)||r!==Number(ev.selfResultRate))&&!note){alert('Khi điều chỉnh khác tự chấm phải nhập lý do.');return;}const x=calculateTaskScore(task.baseScore,task.difficultyCoefficient,p,r);if(!confirm(`Xác nhận điểm thực hiện ${fmt(x.execution)} và điểm quy đổi thực tế ${fmt(x.actual)} là kết quả chính thức? Sau thao tác này không thể chỉnh sửa.`))return;const scoreBatch=writeBatch(db);scoreBatch.update(doc(db,'taskEvaluations',ev.id),{confirmedProgressRate:p,confirmedResultRate:r,confirmedExecutionScore:x.execution,confirmedActualScore:x.actual,reviewerComment:note,status:'CONFIRMED',scoreLocked:true,reviewedByUserId:KpiWorkflowState.user.uid,reviewedByName:KpiWorkflowState.profile.fullName||'',confirmedAt:serverTimestamp(),updatedAt:serverTimestamp()});scoreBatch.update(doc(db,'tasks',task.id),{scoringStatus:'CONFIRMED',scoreLocked:true,confirmedActualScore:x.actual,updatedAt:serverTimestamp(),updatedByUserId:KpiWorkflowState.user.uid,updatedByName:KpiWorkflowState.profile.fullName||''});await scoreBatch.commit();await audit('CONFIRM_TASK_SCORE',{taskId:task.id,confirmedExecutionScore:x.execution,confirmedActualScore:x.actual});closeModal();await loadAll();});
}

function openTaskInfo(taskId){
  const t=KpiWorkflowState.tasks.find(x=>x.id===taskId),e=evaluationFor(taskId);if(!t)return;
  const applied=evaluationScoreSnapshot(e);
  const scoreHtml=applied.hasScore
    ? scoreBreakdownHtml(t,calculateTaskScore(t.baseScore,t.difficultyCoefficient,applied.progressRate,applied.resultRate),{title:applied.label,compact:true})
    : '<div class="kpi-alert">Nhiệm vụ chưa có điểm tự đánh giá.</div>';
  modal('Chi tiết KPI nhiệm vụ',`<div class="kpi-form-grid"><div class="kpi-field full"><strong>${esc(t.taskCode||'')} — ${esc(t.title)}</strong></div><div class="kpi-field"><label>Người thực hiện</label><span>${esc(t.ownerName||'Chờ phân công')}</span></div><div class="kpi-field"><label>Trạng thái kế hoạch</label><span>${esc(taskStatus(t,e))}</span></div><div class="kpi-field"><label>Điểm chuẩn</label><span>${fmt(t.baseScore)}</span></div><div class="kpi-field"><label>Hệ số độ khó</label><span>${coefficientPercent(t.difficultyCoefficient)}</span></div><div class="kpi-field"><label>Điểm quy đổi tối đa</label><span>${fmt(t.maximumConvertedScore)}</span></div><div class="kpi-field"><label>Cốt lõi</label><span>${t.isCoreTask===true?'Có':'Không'}</span></div><div class="kpi-field full"><label>Minh chứng bắt buộc</label><span>${esc(t.standardTaskMandatoryEvidence||'—')}</span></div><div class="kpi-field full">${scoreHtml}</div></div>`);
}

function openCommonCriteria(){
  if(!KpiWorkflowState.period)return;
  if(KpiWorkflowState.common?.status==='CONFIRMED'){alert('Tiêu chí chung đã được xác nhận và không thể chỉnh sửa.');return;}const items=KpiWorkflowState.common?.items||[];modal('Mẫu 01 · Nhóm tiêu chí chung 30 điểm',`<div class="kpi-criteria-list">${COMMON_CRITERIA.map(c=>{const v=items.find(x=>x.code===c.code)||{};return `<div class="kpi-criterion"><strong class="kpi-criterion-score">${c.code}<br>${c.max} điểm</strong><p class="kpi-criterion-text">${esc(c.text)}</p><div class="kpi-criterion-controls"><select data-common-code="${c.code}" aria-label="Kết quả tiêu chí ${c.code}"><option value="DAM_BAO" ${v.selfResult!=='KHONG_DAM_BAO'?'selected':''}>Đảm bảo</option><option value="KHONG_DAM_BAO" ${v.selfResult==='KHONG_DAM_BAO'?'selected':''}>Không đảm bảo</option></select><textarea data-common-note="${c.code}" rows="2" placeholder="Ghi chú/căn cứ" aria-label="Ghi chú tiêu chí ${c.code}">${esc(v.note||'')}</textarea></div></div>`;}).join('')}</div><div id="kpiCommonTotal" class="kpi-alert"></div>`, '<button class="kpi-button secondary" data-kpi-close type="button">Hủy</button><button id="kpiSaveCommon" class="kpi-button" type="button">Lưu tự đánh giá</button>');
  const calc=()=>{let total=0;COMMON_CRITERIA.forEach(c=>{if(document.querySelector(`[data-common-code="${c.code}"]`)?.value==='DAM_BAO')total+=c.max;});el('kpiCommonTotal').textContent=`Tổng điểm tiêu chí chung: ${total}/30`;return total;};document.querySelectorAll('[data-common-code]').forEach(x=>x.addEventListener('change',calc));calc();
  el('kpiSaveCommon').addEventListener('click',async()=>{const data=COMMON_CRITERIA.map(c=>{const result=document.querySelector(`[data-common-code="${c.code}"]`).value;const note=clean(document.querySelector(`[data-common-note="${c.code}"]`).value);if(result==='KHONG_DAM_BAO'&&!note)throw new Error(`Tiêu chí ${c.code} không đảm bảo phải có căn cứ.`);return {code:c.code,max:c.max,text:c.text,selfResult:result,selfScore:result==='DAM_BAO'?c.max:0,note};});try{const total=data.reduce((s,x)=>s+x.selfScore,0);const commonDepartmentId=profileDepartmentId();const commonId=commonAssessmentId(KpiWorkflowState.period.id,KpiWorkflowState.user.uid);await setDoc(doc(db,'commonCriteriaAssessments',commonId),{periodId:KpiWorkflowState.period.id,userId:KpiWorkflowState.user.uid,fullName:KpiWorkflowState.profile.fullName||'',departmentId:commonDepartmentId,scopeType:'PROFESSIONAL',items:data,selfTotal:total,confirmedTotal:null,status:'SELF_COMPLETED',updatedAt:serverTimestamp(),createdAt:KpiWorkflowState.common?.createdAt||serverTimestamp()},{merge:true});await audit('SAVE_COMMON_CRITERIA',{score:total});closeModal();await loadAll();}catch(err){alert(friendlyErrorMessage(err));}});
}

function openCommonReview(assessmentId) {
  const assessment = KpiWorkflowState.commonAll.find(item => item.id === assessmentId);
  if (!assessment || assessment.userId === KpiWorkflowState.user.uid) return;
  const owner = KpiWorkflowState.users.find(user => user.id === assessment.userId);
  const assessmentDepartmentId = normalizeDepartment(assessment.departmentId);
  const allowed = activeRole('ADMIN')
    || (assessmentDepartmentId === 'CDTN'
      ? (Permissions.isCdtnLeadership() || hasActiveApprovalDelegation('CONFIRM_EVALUATIONS', 'CDTN'))
      : ((isDepartmentHead() || hasActiveApprovalDelegation('CONFIRM_EVALUATIONS', assessmentDepartmentId))
        && assessmentDepartmentId === profileDepartmentId()
        && owner?.role === 'STAFF'));
  if (!allowed) return;
  const items = assessment.items || [];
  modal('Xác nhận Mẫu 01 · 30 điểm', `<p><strong>${esc(assessment.fullName)}</strong> · Tự chấm ${fmt(assessment.selfTotal)}/30</p><div class="kpi-criteria-list">${COMMON_CRITERIA.map(c=>{const v=items.find(x=>x.code===c.code)||{};const confirmed=v.confirmedResult||v.selfResult||'DAM_BAO';return `<div class="kpi-criterion"><strong class="kpi-criterion-score">${c.code}<br>${c.max} điểm</strong><p class="kpi-criterion-text">${esc(c.text)}<br><span class="kpi-small">Cá nhân: ${v.selfResult==='KHONG_DAM_BAO'?'Không đảm bảo':'Đảm bảo'}</span></p><div class="kpi-criterion-controls"><select data-confirm-common-code="${c.code}" aria-label="Kết quả xác nhận tiêu chí ${c.code}"><option value="DAM_BAO" ${confirmed==='DAM_BAO'?'selected':''}>Đảm bảo</option><option value="KHONG_DAM_BAO" ${confirmed==='KHONG_DAM_BAO'?'selected':''}>Không đảm bảo</option></select><textarea data-confirm-common-note="${c.code}" rows="2" placeholder="Căn cứ khi điều chỉnh" aria-label="Căn cứ tiêu chí ${c.code}">${esc(v.confirmedNote||v.note||'')}</textarea></div></div>`;}).join('')}</div><div id="kpiConfirmCommonTotal" class="kpi-alert"></div><div class="kpi-confirm-once"><strong>Xác nhận một lần</strong><span>Sau khi xác nhận, 30 điểm tiêu chí chung trở thành điểm chính thức và không thể chỉnh sửa.</span></div>`, '<button class="kpi-button secondary" data-kpi-close type="button">Hủy</button><button id="kpiConfirmCommonSave" class="kpi-button" type="button">Xác nhận 30 điểm</button>');
  const calc=()=>{let total=0;COMMON_CRITERIA.forEach(c=>{if(document.querySelector(`[data-confirm-common-code="${c.code}"]`)?.value==='DAM_BAO')total+=c.max;});el('kpiConfirmCommonTotal').textContent=`Điểm xác nhận: ${total}/30`;return total;};
  document.querySelectorAll('[data-confirm-common-code]').forEach(input=>input.addEventListener('change',calc));calc();
  el('kpiConfirmCommonSave').addEventListener('click', async()=>{
    try {
      const confirmedItems = COMMON_CRITERIA.map(c=>{const original=items.find(x=>x.code===c.code)||{};const result=document.querySelector(`[data-confirm-common-code="${c.code}"]`).value;const note=clean(document.querySelector(`[data-confirm-common-note="${c.code}"]`).value);if(result!==original.selfResult&&!note)throw new Error(`Tiêu chí ${c.code} điều chỉnh khác tự chấm phải có căn cứ.`);return {...original,code:c.code,max:c.max,text:c.text,confirmedResult:result,confirmedScore:result==='DAM_BAO'?c.max:0,confirmedNote:note};});
      const total=confirmedItems.reduce((sum,item)=>sum+item.confirmedScore,0);
      if(!confirm(`Xác nhận ${fmt(total)}/30 điểm tiêu chí chung là điểm chính thức? Sau thao tác này không thể chỉnh sửa.`))return;
      await updateDoc(doc(db,'commonCriteriaAssessments',assessment.id),{items:confirmedItems,confirmedTotal:total,status:'CONFIRMED',confirmedByUserId:KpiWorkflowState.user.uid,confirmedByName:KpiWorkflowState.profile.fullName||'',confirmedAt:serverTimestamp(),updatedAt:serverTimestamp()});
      await audit('CONFIRM_COMMON_CRITERIA',{userId:assessment.userId,score:total});closeModal();await loadAll();
    } catch(error){alert(friendlyErrorMessage(error));}
  });
}

async function lockDepartmentPlan() {
  if (!KpiWorkflowState.period || !canLockPlan()) {
    alert('Tài khoản không có quyền thực hiện thao tác này.');
    return;
  }
  if (KpiWorkflowState.plan?.locked === true) {
    alert('Đăng ký kế hoạch đã được khóa.');
    return;
  }

  const departmentId = activeScopeDepartmentId();
  const approved = KpiWorkflowState.tasks.filter(task =>
    taskScopeDepartmentId(task) === departmentId
    && task.planApprovalStatus === 'APPROVED'
    && task.includedInA === true
  );

  if (!approved.length) {
    alert('Chưa có nhiệm vụ kế hoạch được duyệt.');
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

  if (!confirm(
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
  const departmentId = normalizeDepartment(KpiWorkflowState.profile.departmentId);
  const deputies = KpiWorkflowState.users.filter(user => {
    const candidate = normalizeUserRecord(user, user.id || user.uid);
    return candidate.active === true
      && candidate.id !== KpiWorkflowState.user.uid
      && normalizeDepartment(candidate.departmentId) === departmentId
      && Permissions.isDepartmentDeputy(candidate);
  });
  const active = KpiWorkflowState.delegations.find(item => item.active === true && item.delegatorUserId === KpiWorkflowState.user.uid);
  const allowedPermissions = ['APPROVE_REGISTRATIONS', 'CONFIRM_EVALUATIONS', 'LOCK_PLAN'];
  const selectedPermissions = Array.isArray(active?.permissions) && active.permissions.length
    ? active.permissions.filter(permission => allowedPermissions.includes(permission))
    : ['APPROVE_REGISTRATIONS'];
  const scopePresets = [
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
    .join('|') || 'APPROVE_REGISTRATIONS';
  const activeStatus = active
    ? `<div class="kpi-delegation-active-note"><strong>Ủy quyền đang có hiệu lực</strong><span>${esc(active.delegateName || 'Phó Trưởng phòng')} · ${dateVi(active.startDate)} – ${dateVi(active.endDate)}</span><small>Có thể hủy ngay khi Trưởng phòng trở lại làm việc; dữ liệu ủy quyền cũ vẫn được lưu để đối chiếu.</small></div>`
    : '';
  const footer = [
    '<button class="kpi-button secondary" data-kpi-close type="button">Đóng</button>',
    active ? '<button id="revokeDelegation" class="kpi-button danger" type="button">Hủy ủy quyền</button>' : '',
    '<button id="saveDelegation" class="kpi-button" type="button">Lưu ủy quyền</button>'
  ].filter(Boolean).join('');

  const root = modal('Ủy quyền Phó Trưởng phòng', `
    <div class="kpi-delegation-form">
      ${activeStatus}
      <label class="kpi-field kpi-delegation-person"><span>Người được ủy quyền</span><select id="delegationUser"><option value="">-- Chọn Phó Trưởng phòng --</option>${deputies.map(user => `<option value="${user.id}" ${active?.delegateUserId === user.id ? 'selected' : ''}>${esc(user.fullName || 'Chưa cập nhật họ tên')} — ${esc(user.position || 'Phó Trưởng phòng')}</option>`).join('')}</select></label>
      ${deputies.length ? '' : '<div class="kpi-alert kpi-delegation-warning">Chưa tìm thấy Phó Trưởng phòng đang hoạt động trong cùng Phòng/Khu. Vui lòng kiểm tra lại chức vụ, cấp lãnh đạo và mã Phòng/Khu của tài khoản.</div>'}
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
    if (!delegateUserId) return alert('Hãy chọn Phó Trưởng phòng được ủy quyền.');
    if (!reason) return alert('Phải nhập lý do ủy quyền.');
    if (!permissions.length) return alert('Hãy chọn ít nhất một phạm vi ủy quyền.');
    if (!startDate || !endDate || startDate > endDate) return alert('Thời gian ủy quyền chưa hợp lệ.');

    const reference = doc(db, 'approvalDelegations', `${departmentId}_ACTIVE`);
    const deputy = deputies.find(item => item.id === delegateUserId);
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
    await audit('UPDATE_APPROVAL_DELEGATION', { delegateUserId, permissions, startDate, endDate, reason });
    closeModal();
    await loadAll();
    message('Đã thiết lập ủy quyền.', 'ok');
  });

  root.querySelector('#revokeDelegation')?.addEventListener('click', async () => {
    if (!active) return;
    if (!confirm(`Hủy ủy quyền của ${active.delegateName || 'Phó Trưởng phòng'} ngay bây giờ? Quyền được ủy quyền sẽ hết hiệu lực ngay.`)) return;
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
      await audit('REVOKE_APPROVAL_DELEGATION', { delegateUserId: active.delegateUserId, endedEarly: true });
      closeModal();
      await loadAll();
      message('Đã hủy ủy quyền. Quyền được ủy quyền đã hết hiệu lực.', 'ok');
    } catch (error) {
      alert(friendlyErrorMessage(error, 'Không thể hủy ủy quyền.'));
      button.disabled = false;
    }
  });
}

async function unlockDepartmentPlan() {
  if (!KpiWorkflowState.plan?.locked || !canLockPlan()) {
    alert('Tài khoản không có quyền thực hiện thao tác này.');
    return;
  }
  const hasEvaluation = KpiWorkflowState.evaluations.some(item => ['PENDING_REVIEW', 'CONFIRMED'].includes(item.status));
  if (hasEvaluation && !confirm('Kỳ đã phát sinh dữ liệu tự đánh giá hoặc xác nhận. Trưởng phòng vẫn muốn mở lại đăng ký kế hoạch của Phòng/Khu?')) {
    return;
  }
  const reason = prompt('Nhập lý do mở lại đăng ký kế hoạch:');
  if (!clean(reason)) return;
  await updateDoc(doc(db, 'kpiPlans', KpiWorkflowState.plan.id), {
    locked: false,
    unlockReason: clean(reason),
    unlockedAt: serverTimestamp(),
    unlockedByUserId: KpiWorkflowState.user.uid,
    updatedAt: serverTimestamp()
  });
  await audit('UNLOCK_DEPARTMENT_PLAN', { reason: clean(reason) });
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
  if(!quarterMatch&&!monthMatch){alert('Mã kỳ phải có dạng 2026-Q3 hoặc 2026-M08.');return;}
  if(!name||!startDate||!endDate||startDate>endDate){alert('Thông tin kỳ chưa hợp lệ.');return;}
  if(KpiWorkflowState.periods.some(p=>p.active===true)){alert('Đang có một kỳ hoạt động. Hãy kết thúc kỳ hiện tại trước khi mở kỳ mới.');return;}
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
    alert(`Không thể kết thúc kỳ vì còn ${pendingRegistrations.length} đăng ký kế hoạch chưa được duyệt hoặc trả lại.`);
    return;
  }

  const withoutBasis = participantIds.filter(userId => !summaryForUser(userId).hasCalculationBasis);
  if (withoutBasis.length) {
    const names = withoutBasis.map(userId => {
      const user = KpiWorkflowState.users.find(item => item.id === userId);
      return user?.fullName || user?.email || userId;
    });
    alert(`Không thể kết thúc kỳ vì ${names.length} cá nhân có A = 0, chưa đủ cơ sở tính KPI: ${names.join(', ')}.`);
    return;
  }

  const incompletePeople = participantIds.map(userId => {
    const user = KpiWorkflowState.users.find(item => item.id === userId);
    const name = user?.fullName || user?.email || userId;
    const tasks = periodTasks.filter(task => clean(task.ownerUserId) === userId);
    const unresolvedTasks = tasks.filter(task => {
      const noOccurrenceConfirmed = clean(task.noOccurrenceStatus).toUpperCase() === 'CONFIRMED'
        || clean(task.scoringStatus).toUpperCase() === 'NO_OCCURRENCE_CONFIRMED';
      if (noOccurrenceConfirmed) return false;
      const evaluation = KpiWorkflowState.evaluations.find(item => item.taskId === task.id);
      return evaluation?.status !== 'CONFIRMED' || evaluation?.scoreLocked !== true;
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
    alert(`Không thể kết thúc kỳ. Hồ sơ đánh giá chưa hoàn tất: ${details.join('; ')}${remaining}.`);
    return;
  }

  if(!confirm('Xác nhận đã in và lưu hồ sơ giấy, sau đó kết thúc kỳ?'))return;
  await updateDoc(doc(db,'evaluationPeriods',KpiWorkflowState.period.id),{status:'COMPLETED',active:false,completedByUserId:KpiWorkflowState.user.uid,completedAt:serverTimestamp(),updatedAt:serverTimestamp()});
  PeriodReadService.invalidate();
  await audit('COMPLETE_PERIOD',{periodId:KpiWorkflowState.period.id});
  await loadAll();
}
async function deletePeriodData(){
  if(!activeRole('ADMIN')||!KpiWorkflowState.period)return;
  const period=KpiWorkflowState.period;
  if(period.active===true||period.status!=='COMPLETED'){
    alert('Phải hoàn tất đánh giá và kết thúc kỳ trước khi lưu trữ, dọn dữ liệu.');
    return;
  }
  const confirmation=prompt(`Đây là thao tác xóa dữ liệu vận hành sau khi đã lưu lên Drive.\nNhập chính xác mã kỳ ${period.id} để tiếp tục:`);
  if(clean(confirmation).toUpperCase()!==clean(period.id).toUpperCase()){
    if(confirmation!==null)alert('Mã kỳ xác nhận không đúng. Hệ thống chưa thay đổi dữ liệu.');
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
    alert(`Đã hoàn tất kỳ ${period.id}.\n- Đã lưu ${result.totalRecords} bản ghi lên Google Drive.\n- Đã dọn ${result.deleted} bản ghi khỏi Firestore.\n- Mã kiểm tra: ${result.sha256.slice(0,16)}…`);
    await loadAll();
  }catch(error){
    closeModal();
    alert(`Không thể hoàn tất quy trình: ${friendlyErrorMessage(error)}\nDữ liệu chỉ bị xóa sau khi tệp Drive đã được xác nhận. Có thể chạy lại thao tác để tiếp tục.`);
  }
}

function openReport() {
  if (!KpiWorkflowState.period) return;

  const reportDepartmentId = profileDepartmentId();
  const mine = personalTasksForUser(KpiWorkflowState.user.uid);
  const hasCdtnTasks = mine.some(task => taskScopeDepartmentId(task) === 'CDTN');
  const commonRecord = commonAssessmentForUser(KpiWorkflowState.user.uid, reportDepartmentId);
  const commonScore = commonScoreSnapshot(commonRecord);
  const scoreState = scoreStateForUserCombined(KpiWorkflowState.user.uid);
  const s = summaryForUserCombined(KpiWorkflowState.user.uid);
  const rating = ratingName(proposedRating(s.total100));
  const profile = { ...(KpiWorkflowState.profile || {}), ...(KpiWorkflowState.kpiProfile || {}) };
  const commonItems = commonScore.items;

  const profileValue = (...keys) => {
    for (const key of keys) {
      const value = clean(profile?.[key]);
      if (value) return value;
    }
    return '';
  };

  const m01Groups = [
    {
      code: '1', title: 'Về phẩm chất chính trị, đạo đức, lối sống, thực hiện trách nhiệm nêu gương', max: 18,
      items: [
        ['1.1', 'Tuyệt đối trung thành với Đảng, Tổ quốc và Nhân dân; kiên định chủ nghĩa Mác - Lênin, tư tưởng Hồ Chí Minh, mục tiêu độc lập dân tộc và chủ nghĩa xã hội. Có lập trường, quan điểm, bản lĩnh chính trị vững vàng; kiên quyết bảo vệ nền tảng tư tưởng, Cương lĩnh chính trị, đường lối của Đảng, Hiến pháp, pháp luật của Nhà nước; đấu tranh phản bác các quan điểm sai trái, thù địch, các biểu hiện suy thoái, “tự diễn biến”, “tự chuyển hoá”.', 2],
        ['1.2', 'Có tinh thần yêu nước sâu sắc, tận tuỵ phục vụ Nhân dân, sâu sát cơ sở, luôn hành động vì lợi ích của Nhân dân. Đặt lợi ích của Đảng, quốc gia - dân tộc, Nhân dân, tập thể lên trên lợi ích cá nhân, sẵn sàng hy sinh vì sự nghiệp cách mạng của Đảng, vì độc lập, tự do của Tổ quốc, vì hạnh phúc của Nhân dân.', 2],
        ['1.3', 'Chấp hành nghiêm chủ trương, đường lối, nghị quyết, chỉ thị, quy định, nguyên tắc tổ chức, kỷ luật của Đảng, nhất là nguyên tắc tập trung dân chủ, tự phê bình và phê bình; chấp hành nghiêm pháp luật của Nhà nước và quy định của cơ quan, đơn vị. Tuyệt đối chấp hành sự phân công của tổ chức, yên tâm công tác và hoàn thành tốt mọi nhiệm vụ được giao.', 2],
        ['1.4', 'Có tinh thần tự giác, trách nhiệm cao trong nghiên cứu, học tập chủ nghĩa Mác - Lênin, tư tưởng Hồ Chí Minh, các nghị quyết, chỉ thị của Đảng và các chương trình bồi dưỡng, cập nhật kiến thức mới nhằm nâng cao trình độ về mọi mặt, đáp ứng yêu cầu, nhiệm vụ.', 2],
        ['1.5', 'Có phẩm chất đạo đức, lối sống trong sáng, trung thực, khiêm tốn, chân thành, giản dị; cần, kiệm, liêm, chính, chí công vô tư; chấp hành nghiêm quy định về chuẩn mực đạo đức cách mạng của cán bộ, đảng viên trong giai đoạn mới, trách nhiệm nêu gương; không vi phạm Quy định về những điều đảng viên không được làm. Không né tránh công việc, chạy theo thành tích; không vi phạm đạo đức, lối sống đến mức bị xử lý kỷ luật.', 2],
        ['1.6', 'Không tham vọng quyền lực; không chạy chức, chạy quyền; không tham nhũng, lãng phí, cơ hội, vụ lợi, cục bộ, lợi ích nhóm; không để gia đình, người thân và người khác lợi dụng chức vụ, vị trí công tác để trục lợi. Không có biểu hiện suy thoái về tư tưởng chính trị, đạo đức, lối sống, những biểu hiện “tự diễn biến”, “tự chuyển hoá” trong nội bộ. Kiên quyết đấu tranh chống quan liêu, cửa quyền, tham nhũng, xa hoa, lãng phí, tiêu cực, chủ nghĩa cá nhân, lối sống cơ hội, thực dụng, bè phái, lợi ích nhóm, nói không đi đôi với làm.', 2],
        ['1.7', 'Có uy tín cao, tiêu biểu về phẩm chất đạo đức và phong cách công tác; là trung tâm đoàn kết, thương yêu đồng chí, đồng nghiệp.', 2],
        ['1.8', 'Có tinh thần chủ động, đổi mới sáng tạo; phấn đấu vì mục tiêu phát triển của cơ quan, đơn vị, đóng góp vào mục tiêu chung của đất nước.', 2],
        ['1.9', 'Thực hiện việc kê khai và công khai tài sản, thu nhập theo quy định. Báo cáo đầy đủ, trung thực, cung cấp thông tin chính xác, khách quan về những nội dung liên quan đến việc thực hiện chức trách, nhiệm vụ được giao và hoạt động của cơ quan, tổ chức, đơn vị với cấp trên khi được yêu cầu.', 2]
      ]
    },
    {
      code: '2', title: 'Tư duy đổi mới, chiến lược, khát vọng cống hiến, dám nghĩ dám làm', max: 4,
      items: [
        ['2.1', 'Có tư duy đổi mới, tầm nhìn chiến lược, khả năng lãnh đạo, chỉ đạo thích ứng với sự phát triển của thời đại và xu thế toàn cầu hoá; phương pháp làm việc khoa học, nhạy bén chính trị; có năng lực cụ thể hoá trong lãnh đạo, chỉ đạo cơ quan, đơn vị thực hiện và hoàn thành tốt chức năng, nhiệm vụ được giao.', 1],
        ['2.2', 'Luôn bám sát thực tiễn, có nhiều cách làm hay, sáng tạo, đạt hiệu quả cao trong lãnh đạo, chỉ đạo, tổ chức thực hiện nhiệm vụ; xây dựng cấp uỷ, tổ chức đảng trong sạch, vững mạnh, cơ quan, đơn vị vững mạnh toàn diện.', 1],
        ['2.3', 'Nói đi đôi với làm, dám nghĩ, dám làm, dám chịu trách nhiệm, dám đột phá vì lợi ích chung. Có khả năng phân tích, dự báo tình hình, phát hiện những khó khăn, bất cập, thời cơ, thuận lợi trong thực tiễn; đề xuất hoặc quyết định những giải pháp phù hợp, kịp thời, hiệu quả.', 1],
        ['2.4', 'Có khát vọng phấn đấu, cống hiến; có khả năng quy tụ và phát huy được sức mạnh của tập thể, cá nhân trong cơ quan, đơn vị và các cơ quan, đơn vị có liên quan.', 1]
      ]
    },
    {
      code: '3', title: 'Về tự phê bình và phê bình, tự soi, tự sửa, khắc phục hạn chế, khuyết điểm', max: 8,
      items: [
        ['3.1', 'Chủ động, nghiêm túc thực hiện tự phê bình và phê bình, có tinh thần cầu thị và tiếp thu phản biện, góp ý.', 2],
        ['3.2', 'Có kế hoạch rõ ràng và quyết liệt trong khắc phục hạn chế, khuyết điểm đã được chỉ ra.', 2],
        ['3.3', 'Kết quả khắc phục hoàn thành từ ≥ 80% nội dung, có tiến bộ rõ, được tổ chức đánh giá tốt; không để tái diễn tồn tại.', 2],
        ['3.4', 'Tự soi, tự sửa trên tinh thần trách nhiệm chính trị cao, không né tránh, không đổ lỗi.', 2]
      ]
    }
  ];

  const resultFor = (code) => commonItems.find(item => item.code === code) || {};
  const criterionRows = m01Groups.map(group => {
    const rows = group.items.map(([code, text, max]) => {
      const value = resultFor(code);
      const result = commonScore.official ? (value.confirmedResult || value.selfResult || '') : (value.selfResult || '');
      const ensured = result === 'DAM_BAO';
      const notEnsured = result === 'KHONG_DAM_BAO';
      const score = ensured ? max : notEnsured ? 0 : '';
      return `<tr class="m01-item-row">
        <td class="m01-center">${esc(code)}</td>
        <td>${esc(text)}</td>
        <td class="m01-center m01-check">${ensured ? 'X' : ''}</td>
        <td class="m01-center m01-check">${notEnsured ? 'X' : ''}</td>
        <td class="m01-center">${fmt(max)}</td>
        <td class="m01-center">${score === '' ? '' : fmt(score)}</td>
        <td>${esc(commonScore.official ? (value.confirmedNote || value.note || '') : (value.note || ''))}</td>
      </tr>`;
    }).join('');
    const groupScore = group.items.reduce((total, [code, , max]) => {
      const value = resultFor(code);
      const result = commonScore.official ? (value.confirmedResult || value.selfResult || '') : (value.selfResult || '');
      return total + (result === 'DAM_BAO' ? max : 0);
    }, 0);
    return `<tr class="m01-group-row"><td class="m01-center">${group.code}</td><td>${esc(group.title)}</td><td></td><td></td><td class="m01-center">${fmt(group.max)}</td><td class="m01-center">${fmt(groupScore)}</td><td></td></tr>${rows}`;
  }).join('');

  const taskRows = mine.map((task, index) => {
    const evaluation = evaluationFor(task.id);
    const applied = evaluationScoreSnapshot(evaluation);
    const workspace = taskScopeDepartmentId(task) === 'CDTN' ? 'Chi đoàn' : 'Chuyên môn';
    return `<tr class="m01-task-row">
      <td class="m01-center">${index + 1}</td>
      <td colspan="3"><span class="m01-task-scope">${esc(workspace)}</span> ${esc(task.title || '')}</td>
      <td class="m01-center">${fmt(task.maximumConvertedScore || 0)}</td>
      <td class="m01-center">${applied.hasScore ? fmt(applied.actualScore) : ''}</td>
      <td>${applied.hasScore ? esc(applied.shortLabel) : ''}</td>
    </tr>`;
  }).join('');

  const startMatch = /^(\d{4})-(\d{2})-\d{2}$/.exec(clean(KpiWorkflowState.period.startDate));
  const quarterNumber = startMatch ? Math.ceil(Number(startMatch[2]) / 3) : 0;
  const quarterRoman = ({ 1:'I', 2:'II', 3:'III', 4:'IV' })[quarterNumber] || '';
  const quarterText = quarterRoman && startMatch
    ? `Quý ${quarterRoman}, Năm ${startMatch[1]}`
    : (clean(KpiWorkflowState.period.name) || 'Quý …, Năm …');
  const birthDate = dateVi(profileValue('dateOfBirth', 'birthDate', 'birthday'));
  const partyPosition = profileValue('partyPosition', 'dangPosition');
  const governmentPosition = profileValue('governmentPosition', 'position');
  const unionPosition = profileValue('unionPosition', 'doanThePosition');
  const departmentName = profileValue('departmentName', 'unitName') || departmentDisplayName(reportDepartmentId);
  const reportScopeTitle = hasCdtnTasks || Permissions.isCdtnMember()
    ? `BÁO CÁO CÁ NHÂN – ${departmentDisplayName(reportDepartmentId).toUpperCase()} VÀ CHI ĐOÀN`
    : `BÁO CÁO CÁ NHÂN – ${departmentDisplayName(reportDepartmentId).toUpperCase()}`;
  const currentDate = new Intl.DateTimeFormat('vi-VN', { day:'2-digit', month:'2-digit', year:'numeric' }).format(new Date());

  const pdfHtml = `<div id="kpiPdfPreview" class="kpi-report kpi-report-print m01-report">
    <div class="m01-top">
      <div class="m01-agency"><strong>TRUNG TÂM<br>BẢO TRỢ XÃ HỘI TÂN HIỆP</strong><div>*</div></div>
      <div class="m01-national"><strong>ĐẢNG CỘNG SẢN VIỆT NAM</strong><div><em>Đồng Nai, ngày ${currentDate.slice(0,2)} tháng ${currentDate.slice(3,5)} năm ${currentDate.slice(6)}</em></div></div>
      <div class="m01-form-number">Mẫu 01</div>
    </div>
    <h1>${esc(reportScopeTitle)}</h1>
    <h2>${esc(quarterText)}</h2>
    <div class="m01-profile">
      <div><strong>Họ và tên:</strong> ${esc(profile.fullName || '')}<span class="m01-spacer"></span><strong>Ngày sinh:</strong> ${esc(birthDate)}</div>
      <div><strong>Chức vụ Đảng:</strong> ${esc(partyPosition)}</div>
      <div><strong>Chức vụ chính quyền:</strong> ${esc(governmentPosition)}</div>
      <div><strong>Chức vụ đoàn thể:</strong> ${esc(unionPosition)}</div>
      <div><strong>Đơn vị công tác:</strong> ${esc(departmentName)}</div>
    </div>
    <h3 class="m01-section-title">I. Tự đánh giá kết quả thực hiện nhiệm vụ</h3>
    <p class="m01-intro"><em>Trên cơ sở nhiệm vụ được giao, cá nhân tự đánh giá về kết quả thực hiện nhiệm vụ theo quý như sau:</em></p>
    <div class="m01-score-preview kpi-no-print ${scoreState.className}"><strong>${esc(scoreState.label)}</strong><span>${esc(scoreState.detail)}</span></div>
    <table class="kpi-report-table m01-table">
      <colgroup><col class="m01-col-stt"><col class="m01-col-content"><col class="m01-col-check"><col class="m01-col-check"><col class="m01-col-score"><col class="m01-col-score"><col class="m01-col-note"></colgroup>
      <tbody>
        <tr class="m01-part-row"><td class="m01-center">A</td><td colspan="6">NHÓM TIÊU CHÍ CHUNG (30 ĐIỂM) - Các tiêu chí thực hiện theo Quy định số 366-QĐ/TW của Bộ Chính trị</td></tr>
        <tr class="m01-header-row"><th>TT</th><th>Tiêu chí / Nội dung</th><th>Đảm bảo<br>(Đánh dấu x)</th><th>Không đảm bảo<br>(Đánh dấu x)</th><th>Điểm tối đa</th><th>Điểm đạt<br><small>(Tối đa nếu đảm bảo; 0 điểm nếu không đảm bảo)</small></th><th>Ghi chú</th></tr>
        ${criterionRows}
        <tr class="m01-total-row"><td colspan="4">Tổng (A) =</td><td class="m01-center">30</td><td class="m01-center">${fmt(s.common30)}</td><td></td></tr>
        <tr class="m01-part-row"><td class="m01-center">B</td><td colspan="3">KẾT QUẢ THỰC HIỆN NHIỆM VỤ ĐƯỢC GIAO (70 ĐIỂM)</td><td class="m01-center">Điểm tối đa<br><small>(70 điểm)</small></td><td class="m01-center">Điểm đạt được</td><td>Ghi chú</td></tr>
        ${taskRows || '<tr class="m01-task-row"><td class="m01-center">—</td><td colspan="3">Chưa có nhiệm vụ trong kỳ.</td><td></td><td></td><td></td></tr>'}
        <tr class="m01-total-row"><td colspan="4">TỔNG (B) =</td><td class="m01-center">70</td><td class="m01-center">${s.hasCalculationBasis ? fmt(s.kpi70) : 'Chưa đủ cơ sở tính'}</td><td></td></tr>
        <tr class="m01-grand-total"><td colspan="4">TỔNG (A + B) =</td><td class="m01-center">100</td><td class="m01-center">${s.hasCalculationBasis ? fmt(s.total100) : '—'}</td><td>${esc(s.hasCalculationBasis ? (scoreState.code === 'OFFICIAL' ? 'Điểm chính thức' : 'Điểm tự đánh giá') : 'Chưa đủ cơ sở tính')}</td></tr>
      </tbody>
    </table>
    <div class="m01-proposal"><strong>II. Tự đề xuất xếp loại mức chất lượng:</strong> ${esc(rating)}</div>
    <div class="m01-rating-note"><em>(Theo 04 mức: 1- Hoàn thành xuất sắc nhiệm vụ, 2- Hoàn thành tốt nhiệm vụ, 3- Hoàn thành nhiệm vụ và 4- Không hoàn thành nhiệm vụ)</em></div>
    <p class="m01-legal-note">Tiêu chí đánh giá, xếp loại chất lượng thực hiện theo mục 2.3, khoản 2, phần IV của Kế hoạch số 13-KH/TU của Ban Thường vụ Thành ủy; trong đó, trường hợp cá nhân “Hoàn thành xuất sắc nhiệm vụ” ngoài kết quả tổng điểm đạt từ 90 điểm trở lên, các địa phương, lĩnh vực, cơ quan, đơn vị, bộ phận do cá nhân trực tiếp lãnh đạo, quản lý hoàn thành 100% nhiệm vụ được giao; trong đó có ít nhất 30% số nhiệm vụ hoàn thành vượt mức yêu cầu.</p>
    <div class="m01-self-sign"><strong>CÁ NHÂN TỰ ĐÁNH GIÁ</strong><br><em>(Ký, ghi rõ họ tên)</em></div>
    <div class="m01-authority">
      <h3>III. Nhận xét, đánh giá của cấp có thẩm quyền</h3>
      <p>- Chấm điểm: ....................................................................................................................................................................</p>
      <p>- Đề xuất xếp loại: .............................................................................................................................................................</p>
      <p>- Mức độ đáp ứng đối với các mục tiêu, nhiệm vụ then chốt: ............................................................................................</p>
    </div>
    <div class="m01-confirm-sign"><strong>XÁC NHẬN CỦA BAN THƯỜNG VỤ CẤP ỦY<br>HOẶC TẬP THỂ LÃNH ĐẠO CƠ QUAN, ĐƠN VỊ</strong><br><em>(Xác lập thời điểm, ký, ghi rõ họ tên và đóng dấu)</em></div>
  </div>`;

  const excelHtml = `<div id="kpiExcelPreview" class="kpi-hidden"><div class="kpi-score-state ${scoreState.className}"><span class="kpi-score-state-icon">${scoreState.code === 'OFFICIAL' ? '✓' : '✎'}</span><div><strong>${esc(scoreState.label)}</strong><span>${esc(scoreState.detail)}</span></div></div><div class="kpi-table-wrap"><table class="kpi-table"><thead><tr><th>STT</th><th>Phạm vi</th><th>Tên nhiệm vụ</th><th>Điểm chuẩn</th><th>Hệ số độ khó</th><th>Điểm quy đổi tối đa</th><th>Tiến độ áp dụng</th><th>Kết quả áp dụng</th><th>Điểm thực hiện công việc</th><th>Điểm quy đổi thực tế</th><th>Trạng thái</th></tr></thead><tbody>${mine.map((t, i) => { const applied = evaluationScoreSnapshot(evaluationFor(t.id)); return `<tr><td>${i + 1}</td><td>${taskScopeDepartmentId(t) === 'CDTN' ? 'Chi đoàn' : 'Chuyên môn'}</td><td>${esc(t.title)}</td><td>${fmt(t.baseScore)}</td><td>${coefficientPercent(t.difficultyCoefficient)}</td><td>${fmt(t.maximumConvertedScore)}</td><td>${applied.progressRate ?? ''}</td><td>${applied.resultRate ?? ''}</td><td>${applied.hasScore ? fmt(applied.executionScore) : ''}</td><td><strong>${applied.hasScore ? fmt(applied.convertedActualScore) : ''}</strong></td><td>${esc(applied.label)}</td></tr>`; }).join('')}</tbody></table></div></div>`;

  modal('Báo cáo KPI cá nhân và Mẫu 01', `<div class="kpi-preview-tabs kpi-no-print"><button id="kpiPdfTab" class="kpi-button secondary active" type="button">Mẫu 01</button><button id="kpiExcelTab" class="kpi-button secondary" type="button">Bảng tính điểm</button></div>${pdfHtml}${excelHtml}`, '<button class="kpi-button secondary" data-kpi-close type="button">Đóng</button><button id="kpiExportCsv" class="kpi-button secondary" type="button">📊 Xuất bảng điểm</button><button id="kpiPrintReport" class="kpi-button" type="button">🖨️ In Mẫu 01</button>');
  el('kpiPdfTab').addEventListener('click', () => { el('kpiPdfPreview').classList.remove('kpi-hidden'); el('kpiExcelPreview').classList.add('kpi-hidden'); el('kpiPdfTab').classList.add('active'); el('kpiExcelTab').classList.remove('active'); el('kpiPrintReport').classList.remove('kpi-hidden'); });
  el('kpiExcelTab').addEventListener('click', () => { el('kpiPdfPreview').classList.add('kpi-hidden'); el('kpiExcelPreview').classList.remove('kpi-hidden'); el('kpiPdfTab').classList.remove('active'); el('kpiExcelTab').classList.add('active'); el('kpiPrintReport').classList.add('kpi-hidden'); });
  el('kpiPrintReport').addEventListener('click', () => window.print());
  el('kpiExportCsv')?.addEventListener('click', () => exportReportCsv(mine, s, reportDepartmentId));
}

function exportReportCsv(tasks, summaryData, departmentId = profileDepartmentId()){
  const quote = value => `"${String(value ?? '').replaceAll('\"','\"\"')}"`;
  const state = scoreStateForUserCombined(KpiWorkflowState.user.uid);
  const rows = [['STT','Phạm vi','Tên nhiệm vụ','Điểm chuẩn','Hệ số độ khó','Điểm quy đổi tối đa','Tiến độ áp dụng','Chất lượng áp dụng','Điểm thực hiện công việc','Điểm quy đổi thực tế','Trạng thái điểm']];
  tasks.forEach((task,index)=>{const applied=evaluationScoreSnapshot(evaluationFor(task.id));rows.push([index+1,taskScopeDepartmentId(task)==='CDTN'?'Chi đoàn':'Chuyên môn',task.title||'',task.baseScore||0,coefficientPercent(task.difficultyCoefficient),task.maximumConvertedScore||0,applied.progressRate??'',applied.resultRate??'',applied.hasScore?applied.executionScore:'',applied.hasScore?applied.convertedActualScore:'',applied.label]);});
  rows.push([]);rows.push(['Trạng thái báo cáo',state.label]);rows.push(['A',summaryData.A]);rows.push(['B',summaryData.B]);rows.push(['KPI công việc /70',summaryData.kpi70]);rows.push(['Tiêu chí chung /30',summaryData.common30]);rows.push(['Tổng /100',summaryData.total100]);
  const csv='\ufeff'+rows.map(row=>row.map(quote).join(';')).join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`Bao_cao_KPI_${normalizeDepartment(departmentId)}_${KpiWorkflowState.period?.id||'ky'}_${KpiWorkflowState.profile?.fullName||'ca_nhan'}.csv`;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
}

async function audit(action, detail){try{await addDoc(collection(db,'kpiAuditLogs'),{appVersion:'1.7.2',periodId:KpiWorkflowState.period?.id||'',action,detail,scopeUserId:KpiWorkflowState.user.uid,scopeDepartmentId:activeScopeDepartmentId()||KpiWorkflowState.profile.departmentId||'',performedByUserId:KpiWorkflowState.user.uid,performedByName:KpiWorkflowState.profile.fullName||'',performedByRole:KpiWorkflowState.profile.role||'',performedAt:serverTimestamp()});}catch(error){console.warn('Không ghi được KPI audit log',error);}}

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
  KpiWorkflowState.profile = await readProfile(KpiWorkflowState.user.uid);
  if (!KpiWorkflowState.profile) {
    outlet.innerHTML = '<section class="page-card error-card"><h2>Không tìm thấy hồ sơ người dùng</h2></section>';
    return;
  }
  mount();
  await loadAll();
  if (options.openReport === true && KpiWorkflowState.period) {
    openReport();
  }
}

export { openReport };
