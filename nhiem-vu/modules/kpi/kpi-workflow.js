import { auth, db } from '../../firebase-config.js';
import {
  addDoc, collection, deleteDoc, deleteField, doc, getDoc, getDocs, onSnapshot, query,
  serverTimestamp, setDoc, Timestamp, updateDoc, where
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { TaskRegistrationService } from '../../services/task-registration-service.js';
import { Permissions } from '../../core/permissions.js';
import {
  KPI2B as KPI2C, COMMON_CRITERIA, calculateTaskScore, calculateKpiSummary,
  proposedRating, ratingName, round2, progressRateFromDates
} from '../../kpi-engine.js';

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
  kpiProfile: null
};

const el = (id) => document.getElementById(id);
const clean = (value) => String(value ?? '').trim();
const esc = (value) => clean(value).replace(/[&<>'"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const fmt = (n) => Number(n || 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 });
const dateVi = (key) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean(key)); return m ? `${m[3]}/${m[2]}/${m[1]}` : clean(key); };
const normalizeDepartment = (value) => clean(value).toUpperCase();
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
    active: data.active === true
  };
};
const activeRole = (...roles) => KpiWorkflowState.profile?.active === true && roles.includes(KpiWorkflowState.profile?.role);
const globalRole = () => Permissions.canViewAllDepartments();
const isLeader = () => Permissions.isDepartmentLeader();
const isStaff = () => Permissions.isStaff();
const isDeputyLeader = () => Permissions.isDepartmentDeputy();
const isDepartmentHead = () => Permissions.isDepartmentHead();
const sameDepartment = (data) => normalizeDepartment(data?.departmentId || data?.primaryDepartmentId) === normalizeDepartment(KpiWorkflowState.profile?.departmentId);
const reviewerEmailMatches = (registration) => !clean(registration?.reviewerEmail) || clean(registration.reviewerEmail).toLowerCase() === clean(KpiWorkflowState.profile?.email).toLowerCase();
const todayKey = () => new Date().toISOString().slice(0, 10);

function delegationAllows(delegation, permissionName) {
  if (!delegation || delegation.active !== true) return false;
  if (delegation.delegateUserId !== KpiWorkflowState.user?.uid) return false;
  if (normalizeDepartment(delegation.departmentId) !== normalizeDepartment(KpiWorkflowState.profile?.departmentId)) return false;
  const today = todayKey();
  if (delegation.startDate && delegation.startDate > today) return false;
  if (delegation.endDate && delegation.endDate < today) return false;
  const permissions = Array.isArray(delegation.permissions) ? delegation.permissions : [];
  if (permissions.includes(permissionName)) return true;
  return permissions.length === 0 && permissionName === 'APPROVE_REGISTRATIONS';
}

function hasActiveApprovalDelegation(permissionName = 'APPROVE_REGISTRATIONS') {
  return KpiWorkflowState.delegations.some(item => delegationAllows(item, permissionName));
}

function canApproveRegistration(registration) {
  if (!registration || registration.status !== 'PENDING') return false;
  if (activeRole('ADMIN')) return true;
  const delegated = hasActiveApprovalDelegation('APPROVE_REGISTRATIONS');
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
    return activeRole('DIRECTOR') && reviewerEmailMatches(registration);
  }
  return Permissions.canApproveStaffRegistrations(delegated) && sameDepartment(registration);
}

function canViewDepartmentData() {
  const reportScope = KpiWorkflowState.mode === 'reports' && isLeader();
  return globalRole()
    || isDepartmentHead()
    || reportScope
    || hasActiveApprovalDelegation('APPROVE_REGISTRATIONS')
    || hasActiveApprovalDelegation('CONFIRM_EVALUATIONS')
    || hasActiveApprovalDelegation('LOCK_PLAN');
}

function canViewDepartmentReport() {
  return Permissions.canViewDepartmentReport();
}

function canLockPlan() {
  return Permissions.canLockDepartmentPlan(hasActiveApprovalDelegation('LOCK_PLAN'));
}

function canConfirmEvaluations() {
  return Permissions.canConfirmEvaluations(hasActiveApprovalDelegation('CONFIRM_EVALUATIONS'));
}

function canApproveDepartmentPlanTask(task) {
  return Boolean(
    task &&
    Permissions.canApproveStaffRegistrations(hasActiveApprovalDelegation('APPROVE_REGISTRATIONS')) &&
    sameDepartment(task) &&
    KpiWorkflowState.plan?.locked !== true
  );
}

function mount() {
  const section = el('kpiSection');
  if (!section) return;
  const mode = KpiWorkflowState.mode || 'plans';
  const heading = mode === 'evaluations' ? 'Đánh giá và xác nhận kết quả' : mode === 'reports' ? 'Báo cáo đánh giá' : 'Kế hoạch KPI';
  const description = mode === 'evaluations' ? 'Tự đánh giá nhiệm vụ hoàn thành và xác nhận kết quả.' : mode === 'reports' ? 'Xem trước báo cáo cá nhân và báo cáo tổng hợp Phòng/Khu.' : 'Đăng ký, duyệt và quản lý kế hoạch công việc trong kỳ.';
  section.innerHTML = `
    <div class="kpi-header">
      <div>
        <h2>${heading}</h2>
        <p>${description}</p>
        <div id="kpiPeriodLine" class="kpi-period-line"></div>
      </div>
      <div class="kpi-actions kpi-no-print">
        <button id="kpiRefresh" class="kpi-button secondary" type="button">↻ Cập nhật</button>
        ${mode === 'reports' ? '<button id="kpiOpenReport" class="kpi-button" type="button">🧾 Xem trước báo cáo</button>' : ''}
      </div>
    </div>
    <div id="kpiMessage"></div>
    <div class="kpi-metrics">
      <div class="kpi-metric"><span>A · Kế hoạch</span><strong id="kpiMetricA">0</strong></div>
      <div class="kpi-metric"><span>B · Thực tế</span><strong id="kpiMetricB">0</strong></div>
      <div class="kpi-metric"><span>KPI công việc</span><strong id="kpiMetric70">0/70</strong></div>
      <div class="kpi-metric"><span>Tiêu chí chung</span><strong id="kpiMetric30">0/30</strong></div>
      <div class="kpi-metric"><span>Tổng điểm</span><strong id="kpiMetric100">0/100</strong></div>
    </div>
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
      <h3>Quản lý dữ liệu kỳ đánh giá</h3>
      <p>Chỉ sử dụng khi cần hủy dữ liệu nghiệp vụ sau khi đã sao lưu đầy đủ.</p>
      <div class="kpi-actions">
        <button id="kpiDeletePeriod" class="kpi-button danger" type="button">Hủy dữ liệu nghiệp vụ trong kỳ</button>
      </div>
    </section>`;
  wireEvents();
  section.dataset.kpiMode = mode;
}

function renderManagementToolbar() {
  const toolbar = el('kpiManagementToolbar');
  if (!toolbar) return;
  const mode = KpiWorkflowState.mode || 'plans';
  if (mode === 'reports') {
    toolbar.innerHTML = '';
    toolbar.classList.add('kpi-hidden');
    return;
  }

  const parts = [];
  if (mode === 'plans' && Permissions.canViewOwnKpi() && KpiWorkflowState.period?.status !== 'COMPLETED' && KpiWorkflowState.common?.status !== 'CONFIRMED') {
    parts.push('<button id="kpiCommonButton" class="kpi-button secondary" type="button">✍️ Tự đánh giá tiêu chí chung</button>');
  }

  if (KpiWorkflowState.period) {
    if (canLockPlan()) {
      if (KpiWorkflowState.plan?.locked === true) {
        parts.push('<button id="kpiUnlockPlan" class="kpi-button secondary" type="button">🔓 Mở lại đăng ký</button>');
      } else {
        parts.push('<button id="kpiLockPlan" class="kpi-button secondary" type="button">🔒 Khóa đăng ký kế hoạch</button>');
      }
    }
    if (Permissions.canDelegateApproval()) {
      parts.push('<button id="kpiDelegateApproval" class="kpi-button secondary" type="button">👥 Ủy quyền duyệt</button>');
    }
  }

  if (Permissions.canManageEvaluationPeriods()) {
    parts.push('<button id="kpiPeriodAdmin" class="kpi-button secondary" type="button">⚙️ Quản lý kỳ</button>');
  }

  const status = KpiWorkflowState.period
    ? `<span class="kpi-plan-state ${KpiWorkflowState.plan?.locked === true ? 'is-locked' : 'is-open'}">${KpiWorkflowState.plan?.locked === true ? 'Đã khóa đăng ký' : 'Đang mở đăng ký'}</span>`
    : '';
  toolbar.innerHTML = `${status}${parts.join('')}`;
  toolbar.classList.toggle('kpi-hidden', !toolbar.innerHTML.trim());

  el('kpiCommonButton')?.addEventListener('click', openCommonCriteria);
  el('kpiLockPlan')?.addEventListener('click', lockDepartmentPlan);
  el('kpiDelegateApproval')?.addEventListener('click', openDelegationManager);
  el('kpiUnlockPlan')?.addEventListener('click', unlockDepartmentPlan);
  el('kpiPeriodAdmin')?.addEventListener('click', openPeriodManager);
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
  el('kpiOpenReport')?.addEventListener('click', openReport);
  el('kpiInitPilot')?.addEventListener('click', initializePilotPeriod);
  el('kpiCompletePeriod')?.addEventListener('click', completePeriod);
  el('kpiDeletePeriod')?.addEventListener('click', deletePeriodData);
  el('kpiTaskList')?.addEventListener('click', taskAction);
  el('kpiReviewList')?.addEventListener('click', reviewAction);
}


function periodStatusLabel(period) {
  if (period?.active === true) return 'Đang hoạt động';
  if (period?.status === 'COMPLETED') return 'Đã kết thúc';
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
        <button class="kpi-button secondary" type="button" data-period-edit="${esc(period.id)}">Sửa</button>
        ${period.active === true ? `<button class="kpi-button danger" type="button" data-period-complete="${esc(period.id)}">Kết thúc</button>` : period.status !== 'COMPLETED' ? `<button class="kpi-button" type="button" data-period-activate="${esc(period.id)}">Kích hoạt</button>` : ''}
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
    await audit('UPDATE_PERIOD',{periodId,startDate,endDate});
    closeModal(); await loadAll(); openPeriodManager();
  });
}

async function activatePeriod(periodId) {
  if (!Permissions.canManageEvaluationPeriods()) return;
  if (KpiWorkflowState.periods.some(period => period.active === true && period.id !== periodId)) return alert('Đang có một kỳ hoạt động. Hãy kết thúc kỳ đó trước.');
  await updateDoc(doc(db,'evaluationPeriods',periodId), { active:true, status:'ACTIVE', activatedAt:serverTimestamp(), activatedByUserId:KpiWorkflowState.user.uid, updatedAt:serverTimestamp() });
  await audit('ACTIVATE_PERIOD',{periodId});
  closeModal(); await loadAll(); openPeriodManager();
}

async function completePeriodById(periodId) {
  if (!Permissions.canManageEvaluationPeriods()) return;
  if (!confirm(`Kết thúc kỳ ${periodId}? Sau khi kết thúc, nhiệm vụ mới sẽ không được gắn vào kỳ này.`)) return;
  await updateDoc(doc(db,'evaluationPeriods',periodId), { active:false, status:'COMPLETED', completedAt:serverTimestamp(), completedByUserId:KpiWorkflowState.user.uid, updatedAt:serverTimestamp() });
  await audit('COMPLETE_PERIOD',{periodId});
  closeModal(); await loadAll(); openPeriodManager();
}

async function readProfile(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? normalizeUserRecord(snap.data(), snap.id) : null;
}

async function loadAll() {
  if (!KpiWorkflowState.user || !KpiWorkflowState.profile) return;
  try {
    message('Đang tải dữ liệu đánh giá...');
    const periodSnapshot = await getDocs(collection(db, 'evaluationPeriods'));
    KpiWorkflowState.periods = periodSnapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    KpiWorkflowState.period = KpiWorkflowState.periods.find(period => period.active === true && period.status !== 'DELETED')
      || (Permissions.canManageEvaluationPeriods() ? KpiWorkflowState.periods.filter(period => period.status === 'COMPLETED').sort((a, b) => clean(b.endDate).localeCompare(clean(a.endDate)))[0] : null)
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

    const departmentId = normalizeDepartment(KpiWorkflowState.profile.departmentId);
    const periodId = KpiWorkflowState.period.id;

    KpiWorkflowState.delegations = [];
    if (isDeputyLeader() || isDepartmentHead()) {
      const delegationSnapshot = await getDoc(doc(db, 'approvalDelegations', `${departmentId}_ACTIVE`));
      if (delegationSnapshot.exists()) {
        const delegation = { id: delegationSnapshot.id, ...delegationSnapshot.data() };
        if (isDepartmentHead() || delegation.delegateUserId === KpiWorkflowState.user.uid) {
          KpiWorkflowState.delegations = [delegation];
        }
      }
    }

    const reportDepartmentScope = KpiWorkflowState.mode === 'reports' && isLeader();
    const taskDepartmentScope = globalRole() || isDepartmentHead() || reportDepartmentScope
      || hasActiveApprovalDelegation('APPROVE_REGISTRATIONS')
      || hasActiveApprovalDelegation('CONFIRM_EVALUATIONS')
      || hasActiveApprovalDelegation('LOCK_PLAN');
    const registrationDepartmentScope = globalRole() || isDepartmentHead() || reportDepartmentScope
      || hasActiveApprovalDelegation('APPROVE_REGISTRATIONS');
    const evaluationDepartmentScope = globalRole() || isDepartmentHead() || reportDepartmentScope
      || hasActiveApprovalDelegation('CONFIRM_EVALUATIONS');
    const userDepartmentScope = taskDepartmentScope || registrationDepartmentScope || evaluationDepartmentScope;

    const taskQuery = globalRole()
      ? query(collection(db, 'tasks'), where('periodId', '==', periodId))
      : taskDepartmentScope
        ? query(collection(db, 'tasks'), where('periodId', '==', periodId), where('primaryDepartmentId', '==', departmentId))
        : query(collection(db, 'tasks'), where('periodId', '==', periodId), where('ownerUserId', '==', KpiWorkflowState.user.uid));
    const registrationQuery = globalRole()
      ? query(collection(db, 'taskRegistrations'), where('periodId', '==', periodId))
      : registrationDepartmentScope
        ? query(collection(db, 'taskRegistrations'), where('periodId', '==', periodId), where('departmentId', '==', departmentId))
        : query(collection(db, 'taskRegistrations'), where('periodId', '==', periodId), where('userId', '==', KpiWorkflowState.user.uid));
    const evaluationQuery = globalRole()
      ? query(collection(db, 'taskEvaluations'), where('periodId', '==', periodId))
      : evaluationDepartmentScope
        ? query(collection(db, 'taskEvaluations'), where('periodId', '==', periodId), where('departmentId', '==', departmentId))
        : query(collection(db, 'taskEvaluations'), where('periodId', '==', periodId), where('ownerUserId', '==', KpiWorkflowState.user.uid));
    const commonQuery = globalRole()
      ? query(collection(db, 'commonCriteriaAssessments'), where('periodId', '==', periodId))
      : evaluationDepartmentScope
        ? query(collection(db, 'commonCriteriaAssessments'), where('periodId', '==', periodId), where('departmentId', '==', departmentId))
        : query(collection(db, 'commonCriteriaAssessments'), where('periodId', '==', periodId), where('userId', '==', KpiWorkflowState.user.uid));
    // Trưởng/Phó phòng cần đọc danh sách tài khoản rồi lọc theo Phòng/Khu ở phía ứng dụng.
    // Không truy vấn departmentId tuyệt đối vì dữ liệu cũ có thể khác chữ hoa/thường hoặc có khoảng trắng.
    const usersRequest = (globalRole() || userDepartmentScope)
      ? getDocs(collection(db, 'users'))
      : Promise.resolve(null);
    const profileRequest = getDocs(query(collection(db, 'kpiProfiles'), where('userId', '==', KpiWorkflowState.user.uid)));

    const [usersSnapshot, tasksSnapshot, registrationsSnapshot, evaluationsSnapshot, commonSnapshot, planSnapshot, profileSnapshot] = await Promise.all([
      usersRequest,
      getDocs(taskQuery),
      getDocs(registrationQuery),
      getDocs(evaluationQuery),
      getDocs(commonQuery),
      getDoc(doc(db, 'kpiPlans', `${periodId}_${departmentId}`)),
      profileRequest
    ]);

    const loadedUsers = usersSnapshot
      ? usersSnapshot.docs.map(item => normalizeUserRecord(item.data(), item.id))
      : [normalizeUserRecord(KpiWorkflowState.profile, KpiWorkflowState.user.uid)];

    KpiWorkflowState.users = globalRole()
      ? loadedUsers
      : userDepartmentScope
        ? loadedUsers.filter(item => normalizeDepartment(item.departmentId) === departmentId)
        : loadedUsers.filter(item => item.id === KpiWorkflowState.user.uid);

    if (!KpiWorkflowState.users.some(item => item.id === KpiWorkflowState.user.uid)) {
      KpiWorkflowState.users.push(normalizeUserRecord(KpiWorkflowState.profile, KpiWorkflowState.user.uid));
    }
    KpiWorkflowState.tasks = tasksSnapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    KpiWorkflowState.registrations = registrationsSnapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    KpiWorkflowState.evaluations = evaluationsSnapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    KpiWorkflowState.commonAll = commonSnapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    KpiWorkflowState.common = KpiWorkflowState.commonAll.find(item => item.userId === KpiWorkflowState.user.uid) || null;
    KpiWorkflowState.plan = planSnapshot.exists() ? { id: planSnapshot.id, ...planSnapshot.data() } : null;
    const profileRecords = profileSnapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    KpiWorkflowState.kpiProfile = profileRecords.find(item => item.periodId === periodId)
      || profileRecords[0]
      || null;

    render();
    message('Dữ liệu đã được cập nhật.', 'ok');
  } catch (error) {
    console.error(error);
    renderManagementToolbar();
    message(error?.code === 'permission-denied'
      ? 'Tài khoản chưa được cấp quyền phù hợp để xem dữ liệu này. Vui lòng liên hệ quản trị viên.'
      : 'Không thể tải dữ liệu đánh giá. Vui lòng cập nhật và thử lại.');
  }
}

function taskForCurrentUser(task) {
  if (globalRole()) return true;
  if (isLeader()) return sameDepartment(task);
  return task.ownerUserId === KpiWorkflowState.user.uid || task.createdByUserId === KpiWorkflowState.user.uid;
}
function evaluationFor(taskId){ return KpiWorkflowState.evaluations.find(e => e.taskId === taskId); }
function recognizedRowsForUser() {
  return KpiWorkflowState.tasks.filter(t => t.ownerUserId === KpiWorkflowState.user.uid).map(t => {
    const ev = evaluationFor(t.id);
    return {
      ...t,
      recognized: ev?.status === 'CONFIRMED',
      confirmedActualScore: Number(ev?.confirmedActualScore || 0),
      includedInA: t.includedInA === true
    };
  });
}
function summary() { return calculateKpiSummary(recognizedRowsForUser(), Number(KpiWorkflowState.common?.confirmedTotal ?? KpiWorkflowState.common?.selfTotal ?? 0)); }

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
  el('kpiMetric70').textContent = `${fmt(currentSummary.kpi70)}/70`;
  el('kpiMetric30').textContent = `${fmt(currentSummary.common30)}/30`;
  el('kpiMetric100').textContent = `${fmt(currentSummary.total100)}/100`;

  renderManagementToolbar();
  el('kpiAdminBox')?.classList.toggle('kpi-hidden', !activeRole('ADMIN'));
  if (KpiWorkflowState.mode === 'plans') renderPlanDashboard();
  else if (KpiWorkflowState.mode === 'evaluations') renderEvaluationDashboard();
  else renderReportDashboard();
}

function visiblePeople() {
  const all = [...KpiWorkflowState.users].filter(user => user.active === true);
  if (globalRole()) return all;
  if (canViewDepartmentData()) {
    return all.filter(user => normalizeDepartment(user.departmentId) === normalizeDepartment(KpiWorkflowState.profile.departmentId));
  }
  return all.filter(user => user.id === KpiWorkflowState.user.uid);
}
function rowsForPerson(uid){return KpiWorkflowState.tasks.filter(t=>t.ownerUserId===uid&&t.active!==false);}
function regsForPerson(uid){return KpiWorkflowState.registrations.filter(r=>r.userId===uid&&r.active!==false);}
function renderPlanDashboard(){
  const target=el('kpiTaskList'); if(!target)return;
  const people=visiblePeople().filter(u=>rowsForPerson(u.id).length||regsForPerson(u.id).length||u.id===KpiWorkflowState.user.uid);
  if(!people.length){target.innerHTML='<div class="kpi-empty">Chưa có đăng ký hoặc nhiệm vụ trong kỳ.</div>';return;}
  target.innerHTML=`<div class="kpi-table-wrap"><table class="kpi-table"><thead><tr><th>STT</th><th>Họ và tên</th><th>Đầu việc đăng ký</th><th>Tổng điểm</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>${people.map((u,i)=>{const regs=regsForPerson(u.id),tasks=rowsForPerson(u.id),approved=tasks.filter(t=>t.includedInA===true),score=approved.reduce((a,t)=>a+Number(t.maximumConvertedScore||0),0),pending=regs.filter(r=>r.status==='PENDING').length;return `<tr><td>${i+1}</td><td><strong>${esc(u.fullName||u.email||u.id)}</strong><br><span class="kpi-small">${esc(u.position||'')}</span></td><td>${regs.length||tasks.length}</td><td>${fmt(score)}</td><td><span class="kpi-status">${pending?`${pending} chờ duyệt`:'Đã cập nhật'}</span></td><td><button class="kpi-button secondary" data-person-detail="${esc(u.id)}">Chi tiết</button></td></tr>`;}).join('')}</tbody></table></div>`;
  target.querySelectorAll('[data-person-detail]').forEach(b=>b.addEventListener('click',()=>openPersonPlanDetail(b.dataset.personDetail)));
  const completed = KpiWorkflowState.tasks.filter(taskForCurrentUser).filter(t => ['HOAN_THANH','COMPLETED','DA_HOAN_THANH'].includes(clean(t.status).toUpperCase()) || t.completedAt);
  target.insertAdjacentHTML('beforeend', `<div class="kpi-subsection"><h3>Đánh giá nhiệm vụ đã hoàn thành</h3><p class="kpi-small">Tiến độ được xác định theo thời hạn nhiệm vụ; người thực hiện tự đánh giá kết quả và cấp có thẩm quyền xác nhận.</p>${completed.length ? `<div class="kpi-table-wrap"><table class="kpi-table"><thead><tr><th>Nhiệm vụ</th><th>Người thực hiện</th><th>Tiến độ tự động</th><th>Chất lượng</th><th>Điểm thực tế</th><th>Thao tác</th></tr></thead><tbody>${completed.map(t=>{const ev=evaluationFor(t.id)||{};const progress=progressRateFromDates(t.deadline||t.dueDate,t.completedAt,true);const own=t.ownerUserId===KpiWorkflowState.user.uid;const locked=ev.status==='CONFIRMED'||ev.scoreLocked===true;return `<tr><td><strong>${esc(t.taskCode||'')}</strong><br>${esc(t.title||'')}</td><td>${esc(t.ownerName||'')}</td><td>${progress}%</td><td>${ev.confirmedResultRate??ev.selfResultRate??'—'}%</td><td>${fmt(ev.confirmedActualScore||ev.selfActualScore)}</td><td>${own?(locked?'Đã xác nhận':`<button class="kpi-button" data-kpi-self="${t.id}">${ev.id?'Cập nhật đề xuất':'Tự đánh giá'}</button>`):canReviewEvaluation(ev,t)?`<button class="kpi-button" data-kpi-review="${ev?.id||''}">Xác nhận</button>`:'Chỉ xem'}</td></tr>`;}).join('')}</tbody></table></div>`:'<div class="kpi-empty">Chưa có nhiệm vụ hoàn thành để đánh giá.</div>'}</div>`);
  target.querySelectorAll('[data-kpi-self]').forEach(b=>b.addEventListener('click',()=>openSelfAssessment(b.dataset.kpiSelf)));
  target.querySelectorAll('[data-kpi-review]').forEach(b=>b.addEventListener('click',()=>openReview(b.dataset.kpiReview)));
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
    <div class="kpi-table-wrap"><table class="kpi-table"><thead><tr><th>Duyệt</th><th>Đầu việc</th><th>Điểm chuẩn</th><th>Hệ số</th><th>Điểm tối đa</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>
      ${rows.map(item => {
        const canReset = item.kind === 'registration' && item.status === 'REJECTED' && !item.taskId && isLeader() && sameDepartment(item);
        return `<tr>
          <td>${item.kind === 'registration' && item.status === 'PENDING' ? `<input type="checkbox" data-reg-review value="${esc(item.id)}" ${canApproveRegistration(item) ? 'checked' : 'disabled'}>` : '—'}</td>
          <td><strong>${esc(item.standardTaskCode || item.taskCode || '')}</strong><br>${esc(item.standardTaskName || item.title || '')}</td>
          <td>${fmt(item.baseScore)}</td><td>${fmt(item.difficultyCoefficient)}</td><td>${fmt(item.maximumConvertedScore)}</td>
          <td>${esc(item.status === 'PENDING' ? 'Chờ duyệt' : item.status === 'REJECTED' ? 'Đã trả lại' : item.planApprovalStatus === 'APPROVED' || item.status === 'APPROVED' ? 'Đã duyệt' : item.status || '')}</td>
          <td>${canReset ? `<button class="kpi-button secondary" type="button" data-reset-registration="${esc(item.id)}">Cho phép đăng ký lại</button>` : '—'}</td>
        </tr>`;
      }).join('')}
    </tbody></table></div>`,
    canApprove ? '<button class="kpi-button secondary" data-kpi-close type="button">Đóng</button><button id="regApproveSelected" class="kpi-button" type="button">Duyệt mục đã chọn</button>' : '<button class="kpi-button secondary" data-kpi-close type="button">Đóng</button>'
  );

  root.querySelector('#regSelectAll')?.addEventListener('click', () => root.querySelectorAll('[data-reg-review]:not(:disabled)').forEach(input => { input.checked = true; }));
  root.querySelector('#regClearAll')?.addEventListener('click', () => root.querySelectorAll('[data-reg-review]').forEach(input => { input.checked = false; }));
  root.querySelectorAll('[data-reset-registration]').forEach(button => {
    button.addEventListener('click', async () => {
      const registration = registrations.find(item => item.id === button.dataset.resetRegistration);
      if (!registration || !confirm('Cho phép người dùng đăng ký lại đầu việc này?')) return;
      button.disabled = true;
      try {
        await TaskRegistrationService.cancelRegistration(registration);
        closeModal();
        await loadAll();
        openPersonPlanDetail(uid);
      } catch (error) {
        alert(error.message || 'Không thể cho phép đăng ký lại.');
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
function renderEvaluationDashboard(){
  const target=el('kpiTaskList');if(!target)return;el('kpiMainCardTitle').textContent='Đánh giá nhiệm vụ đã hoàn thành';el('kpiMainCardHint').textContent='Cá nhân tự đánh giá nhiệm vụ của chính mình; cấp có thẩm quyền chỉ xác nhận điểm.';
  const rows=KpiWorkflowState.tasks.filter(taskForCurrentUser).filter(t=>t.status==='HOAN_THANH');if(!rows.length){target.innerHTML='<div class="kpi-empty">Chưa có nhiệm vụ hoàn thành để đánh giá.</div>';return;}target.innerHTML=`<div class="kpi-table-wrap"><table class="kpi-table"><thead><tr><th>Nhiệm vụ</th><th>Người thực hiện</th><th>Điểm tối đa</th><th>Trạng thái đánh giá</th><th>Thao tác</th></tr></thead><tbody>${rows.map(t=>{const ev=evaluationFor(t.id),own=t.ownerUserId===KpiWorkflowState.user.uid,locked=ev?.status==='CONFIRMED'||ev?.scoreLocked===true;return `<tr><td><strong>${esc(t.taskCode||'')}</strong><br>${esc(t.title||'')}</td><td>${esc(t.ownerName||'')}</td><td>${fmt(t.maximumConvertedScore)}</td><td>${esc(taskStatus(t,ev))}</td><td>${own?(locked?'Đã xác nhận':`<button class="kpi-button" data-kpi-self="${t.id}">${ev?'Cập nhật tự đánh giá':'Tự đánh giá'}</button>`):canReviewEvaluation(ev,t)?`<button class="kpi-button" data-kpi-review="${ev?.id||''}">Xác nhận</button>`:'Chỉ xem'}</td></tr>`;}).join('')}</tbody></table></div>`;target.addEventListener('click',taskAction);target.addEventListener('click',reviewAction);
}
function renderReportDashboard() {
  const target = el('kpiTaskList');
  if (!target) return;
  el('kpiMainCardTitle').textContent = 'Báo cáo và tổng hợp KPI';
  el('kpiMainCardHint').textContent = canViewDepartmentReport()
    ? 'Xem báo cáo cá nhân hoặc tổng hợp kết quả của Phòng/Khu.'
    : 'Xem báo cáo đánh giá của chính mình.';
  target.innerHTML = `<div class="kpi-report-options">
    <button id="reportPersonal" class="kpi-report-option" type="button"><span>📄</span><strong>Báo cáo cá nhân</strong><small>Xem trước và in Mẫu 01 của cá nhân.</small></button>
    <button id="reportProfile" class="kpi-report-option" type="button"><span>🪪</span><strong>Thông tin Mẫu 01</strong><small>Cập nhật ngày sinh, chức vụ và đơn vị công tác.</small></button>
    ${canViewDepartmentReport() ? '<button id="reportDepartment" class="kpi-report-option" type="button"><span>📊</span><strong>Tổng hợp Phòng/Khu</strong><small>Tổng hợp điểm và mức xếp loại theo từng người.</small></button>' : ''}
  </div>`;
  el('reportPersonal')?.addEventListener('click', openReport);
  el('reportProfile')?.addEventListener('click', openKpiProfileEditor);
  el('reportDepartment')?.addEventListener('click', openDepartmentReport);
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
    const recordId = KpiWorkflowState.kpiProfile?.id || `${KpiWorkflowState.period.id}_${KpiWorkflowState.user.uid}`;
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
  const rows = KpiWorkflowState.tasks
    .filter(task => task.ownerUserId === userId && task.active !== false)
    .map(task => {
      const evaluation = KpiWorkflowState.evaluations.find(item => item.taskId === task.id && item.ownerUserId === userId);
      return {
        ...task,
        recognized: evaluation?.status === 'CONFIRMED',
        confirmedActualScore: Number(evaluation?.confirmedActualScore || 0),
        includedInA: task.includedInA === true
      };
    });
  const common = KpiWorkflowState.commonAll.find(item => item.userId === userId);
  const officialCommon = common?.status === 'CONFIRMED' ? Number(common.confirmedTotal || 0) : 0;
  return calculateKpiSummary(rows, officialCommon);
}

function evaluationStateForUser(userId) {
  const evaluations = KpiWorkflowState.evaluations.filter(item => item.ownerUserId === userId);
  const common = KpiWorkflowState.commonAll.find(item => item.userId === userId);
  if (!evaluations.length && !common) return 'Chưa đánh giá';
  const tasks = KpiWorkflowState.tasks.filter(item => item.ownerUserId === userId && item.active !== false);
  const relevant = tasks.filter(item => ['HOAN_THANH', 'COMPLETED', 'DA_HOAN_THANH'].includes(clean(item.status).toUpperCase()) || item.completedAt);
  const allConfirmed = relevant.length > 0 && relevant.every(task => evaluations.some(item => item.taskId === task.id && item.status === 'CONFIRMED'));
  if (allConfirmed && common?.status === 'CONFIRMED') return 'Đã xác nhận';
  return 'Đang đánh giá';
}

function openDepartmentReport() {
  if (!canViewDepartmentReport()) {
    alert('Tài khoản không có quyền xem báo cáo tổng hợp của Phòng/Khu.');
    return;
  }
  const departments = [...new Set(KpiWorkflowState.users.map(user => normalizeDepartment(user.departmentId)).filter(Boolean))].sort();
  const defaultDepartment = globalRole() ? (departments[0] || normalizeDepartment(KpiWorkflowState.profile.departmentId)) : normalizeDepartment(KpiWorkflowState.profile.departmentId);
  const selector = globalRole() && departments.length > 1
    ? `<label class="kpi-field department-report-filter"><span>Phòng/Khu</span><select id="departmentReportSelect">${departments.map(item => `<option value="${esc(item)}" ${item === defaultDepartment ? 'selected' : ''}>${esc(item)}</option>`).join('')}</select></label>`
    : '';
  const root = modal('Tổng hợp Phòng/Khu', `${selector}<div id="departmentReportContent"></div>`, '<button class="kpi-button secondary" data-kpi-close type="button">Đóng</button><button id="printDepartmentReport" class="kpi-button" type="button">🖨️ In báo cáo</button>');

  const renderDepartment = () => {
    const departmentId = clean(root.querySelector('#departmentReportSelect')?.value || defaultDepartment);
    const people = KpiWorkflowState.users
      .filter(user => user.active === true && normalizeDepartment(user.departmentId) === departmentId)
      .filter(user => KpiWorkflowState.tasks.some(task => task.ownerUserId === user.id) || KpiWorkflowState.commonAll.some(item => item.userId === user.id))
      .sort((a, b) => clean(a.fullName).localeCompare(clean(b.fullName), 'vi'));
    const body = people.map((user, index) => {
      const data = summaryForUser(user.id);
      const taskCount = KpiWorkflowState.tasks.filter(task => task.ownerUserId === user.id && task.active !== false).length;
      return `<tr><td>${index + 1}</td><td><strong>${esc(user.fullName || user.email || user.id)}</strong></td><td>${esc(user.position || '')}</td><td class="m01-center">${taskCount}</td><td class="m01-center">${fmt(data.kpi70)}</td><td class="m01-center">${fmt(data.common30)}</td><td class="m01-center"><strong>${fmt(data.total100)}</strong></td><td>${esc(ratingName(proposedRating(data.total100)))}</td><td>${esc(evaluationStateForUser(user.id))}</td></tr>`;
    }).join('');
    root.querySelector('#departmentReportContent').innerHTML = people.length ? `<div id="departmentReportPrint" class="department-report kpi-report-print">
      <div class="department-report-heading"><strong>TRUNG TÂM BẢO TRỢ XÃ HỘI TÂN HIỆP</strong><h2>BẢNG TỔNG HỢP KẾT QUẢ ĐÁNH GIÁ PHÒNG/KHU</h2><p>${esc(KpiWorkflowState.period?.name || '')} · ${esc(departmentId)}</p></div>
      <div class="kpi-table-wrap"><table class="kpi-report-table department-report-table"><thead><tr><th>STT</th><th>Họ và tên</th><th>Chức vụ</th><th>Số nhiệm vụ</th><th>Điểm nhiệm vụ</th><th>Điểm tiêu chí chung</th><th>Tổng điểm</th><th>Mức xếp loại</th><th>Trạng thái xác nhận</th></tr></thead><tbody>${body}</tbody></table></div>
      <div class="department-report-signatures"><div><strong>NGƯỜI LẬP BIỂU</strong><br><em>(Ký, ghi rõ họ tên)</em></div><div><strong>TRƯỞNG PHÒNG/KHU</strong><br><em>(Ký, ghi rõ họ tên)</em></div></div>
    </div>` : '<div class="kpi-empty">Chưa có dữ liệu đánh giá trong kỳ này.</div>';
  };

  root.querySelector('#departmentReportSelect')?.addEventListener('change', renderDepartment);
  root.querySelector('#printDepartmentReport')?.addEventListener('click', () => window.print());
  renderDepartment();
}
function taskStatus(task, ev) {
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
    const canApprove = canApproveDepartmentPlanTask(task) && task.planApprovalStatus === 'PENDING_APPROVAL';
    const canSelf = task.ownerUserId === KpiWorkflowState.user.uid && task.planApprovalStatus === 'APPROVED' && KpiWorkflowState.period.status !== 'COMPLETED' && ev?.status !== 'CONFIRMED' && ev?.scoreLocked !== true;
    return `<tr><td><strong>${esc(task.taskCode || task.standardTaskCode || task.id)}</strong><br>${esc(task.title)}<br><span class="kpi-small">${esc(task.ownerName || 'Chờ phân công')}</span></td>
      <td><span class="kpi-status">${esc(taskStatus(task,ev))}</span><br><span class="kpi-small">${task.includedInA === true ? 'Thuộc A' : (task.planType === 'DOT_XUAT' ? 'Đột xuất · không tăng A' : 'Chưa vào A')}</span>${task.isCoreTask === true ? '<br><strong>⭐ Cốt lõi</strong>' : ''}</td>
      <td>${fmt(task.maximumConvertedScore)}</td>
      <td>${ev ? `Tự chấm: ${fmt(ev.selfActualScore)}<br>Xác nhận: ${fmt(ev.confirmedActualScore)}` : 'Chưa đánh giá'}</td>
      <td><div class="kpi-actions">${canApprove ? `<button class="kpi-button secondary" data-kpi-approve-plan="${task.id}">Duyệt vào kế hoạch</button><button class="kpi-button danger" data-kpi-reject-plan="${task.id}">Trả lại</button>` : ''}${canSelf ? `<button class="kpi-button" data-kpi-self="${task.id}">${ev ? 'Cập nhật tự đánh giá' : 'Tự đánh giá'}</button>` : ''}<button class="kpi-button secondary" data-kpi-view="${task.id}">Chi tiết</button></div></td></tr>`;
  }).join('')}</tbody></table></div>`;
}

function canReviewEvaluation(ev, task) {
  if (!ev || !task || ev.ownerUserId === KpiWorkflowState.user.uid || ev.status === 'CONFIRMED' || ev.scoreLocked === true) return false;
  if (activeRole('ADMIN')) return true;
  if (activeRole('DIRECTOR')) {
    return ev.ownerRole === 'DEPARTMENT_LEADER'
      && (!ev.reviewerEmail || clean(KpiWorkflowState.profile.email).toLowerCase() === clean(ev.reviewerEmail).toLowerCase());
  }
  return canConfirmEvaluations() && sameDepartment(task);
}
function groupPendingRegistrations() {
  const delegated = hasActiveApprovalDelegation('APPROVE_REGISTRATIONS');
  const visible = KpiWorkflowState.registrations.filter(registration => {
    if (registration.status !== 'PENDING') return false;
    if (activeRole('ADMIN')) return true;
    if (activeRole('DIRECTOR')) return registration.userRole === 'DEPARTMENT_LEADER' && reviewerEmailMatches(registration);
    if (Permissions.canViewStaffRegistrations(delegated)) return sameDepartment(registration) && registration.userId !== KpiWorkflowState.user.uid;
    return false;
  });
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
  const pendingCommon = KpiWorkflowState.commonAll.filter(item => item.userId !== KpiWorkflowState.user.uid && item.status === 'SELF_COMPLETED' && (activeRole('ADMIN') || ((isDepartmentHead() || hasActiveApprovalDelegation('CONFIRM_EVALUATIONS')) && normalizeDepartment(item.departmentId) === normalizeDepartment(KpiWorkflowState.profile.departmentId))));
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
    planApprovalStatus:'APPROVED', includedInA: task.planType !== 'DOT_XUAT', isCoreTask:core,
    planApprovedByUserId:KpiWorkflowState.user.uid, planApprovedByName:KpiWorkflowState.profile.fullName || '', planApprovedAt:serverTimestamp(), scoringEnabled:true, updatedAt:serverTimestamp()
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
    planRejectedByUserId:KpiWorkflowState.user.uid,planRejectedByName:KpiWorkflowState.profile.fullName||'',planRejectedAt:serverTimestamp(),updatedAt:serverTimestamp()
  });
  await audit('REJECT_PLAN_TASK',{taskId,reason});
  await loadAll();
}

function reviewerForOwner(ownerId) {
  const owner = KpiWorkflowState.users.find(u=>u.id===ownerId);
  if (!owner) return { email:'', uid:'', name:'' };
  if (owner.role === 'STAFF') {
    const leader = KpiWorkflowState.users.find(u=>u.active===true && u.role==='DEPARTMENT_LEADER' && normalizeDepartment(u.departmentId)===normalizeDepartment(owner.departmentId));
    return { email:leader?.email || '', uid:leader?.id || '', name:leader?.fullName || 'Trưởng/Phó phòng' };
  }
  const email = clean(owner.kpiReviewerEmail).toLowerCase();
  const reviewer = KpiWorkflowState.users.find(u=>clean(u.email).toLowerCase()===email);
  return { email, uid:reviewer?.id || '', name:reviewer?.fullName || email || 'Ban Giám đốc phụ trách' };
}

function openSelfAssessment(taskId) {
  const task = KpiWorkflowState.tasks.find(t=>t.id===taskId); if (!task) return;
  const ev = evaluationFor(taskId) || {};
  if (ev.status === 'CONFIRMED' || ev.scoreLocked === true) {
    alert('Kết quả nhiệm vụ đã được xác nhận và không thể chỉnh sửa.');
    return;
  }
  const rates = [100,80,60,0];
  const node = modal('Tự đánh giá nhiệm vụ', `<form id="kpiSelfForm" class="kpi-form-grid">
    <div class="kpi-field full"><strong>${esc(task.taskCode || '')} — ${esc(task.title)}</strong><span>Điểm tối đa: ${fmt(task.maximumConvertedScore)} · Minh chứng bắt buộc: ${esc(task.standardTaskMandatoryEvidence || 'Theo nhiệm vụ')}</span></div>
    <div class="kpi-field"><label>Tiến độ tự chấm</label><select id="kpiSelfProgress">${rates.map(r=>`<option value="${r}" ${Number(ev.selfProgressRate??100)===r?'selected':''}>${r}%</option>`).join('')}</select></div>
    <div class="kpi-field"><label>Kết quả tự chấm</label><select id="kpiSelfResult">${rates.map(r=>`<option value="${r}" ${Number(ev.selfResultRate??100)===r?'selected':''}>${r}%</option>`).join('')}</select></div>
    <div class="kpi-field full"><label>Nhận xét kết quả, thành tích và hạn chế</label><textarea id="kpiSelfComment" rows="5" required>${esc(ev.selfComment || '')}</textarea></div>
    <div class="kpi-field full"><label class="kpi-checkbox-line"><input id="kpiExceeded" type="checkbox" ${ev.isExceededRequirement===true?'checked':''}> Đề nghị ghi nhận hoàn thành vượt mức yêu cầu</label><textarea id="kpiExceededText" rows="3" placeholder="Nêu rõ sản phẩm, khối lượng, chất lượng hoặc giá trị bổ sung...">${esc(ev.exceededRequirementDescription || '')}</textarea></div>
    <div class="kpi-field full"><div id="kpiSelfScore" class="kpi-alert"></div></div>
  </form>`, '<button class="kpi-button secondary" data-kpi-close type="button">Hủy</button><button id="kpiSubmitSelf" class="kpi-button" type="button">Gửi xác nhận</button>');
  const recalc=()=>{ const x=calculateTaskScore(task.baseScore,task.difficultyCoefficient,el('kpiSelfProgress').value,el('kpiSelfResult').value); el('kpiSelfScore').textContent=`Điểm tự chấm: ${fmt(x.actual)}/${fmt(x.maximum)}`; };
  el('kpiSelfProgress').addEventListener('change',recalc); el('kpiSelfResult').addEventListener('change',recalc); recalc();
  el('kpiSubmitSelf').addEventListener('click', async()=>{
    const comment=clean(el('kpiSelfComment').value); if(!comment){alert('Vui lòng nhập nhận xét.');return;}
    const progress=Number(el('kpiSelfProgress').value), result=Number(el('kpiSelfResult').value);
    const score=calculateTaskScore(task.baseScore,task.difficultyCoefficient,progress,result);
    const reviewer=reviewerForOwner(KpiWorkflowState.user.uid);
    const exceeded=el('kpiExceeded').checked, exceededText=clean(el('kpiExceededText').value);
    if(exceeded && !exceededText){alert('Vui lòng nêu căn cứ vượt mức yêu cầu.');return;}
    await setDoc(doc(db,'taskEvaluations',`${KpiWorkflowState.period.id}_${task.id}`),{
      periodId:KpiWorkflowState.period.id, taskId:task.id, taskCode:task.taskCode||'', ownerUserId:KpiWorkflowState.user.uid, ownerName:KpiWorkflowState.profile.fullName||'', ownerRole:KpiWorkflowState.profile.role||'', departmentId:KpiWorkflowState.profile.departmentId||'',
      selfProgressRate:progress,selfResultRate:result,selfExecutionScore:score.execution,selfActualScore:score.actual,selfComment:comment,
      confirmedProgressRate:null,confirmedResultRate:null,confirmedActualScore:null,reviewerEmail:reviewer.email,reviewerUserId:reviewer.uid,reviewerName:reviewer.name,
      isExceededRequirement:exceeded,exceededRequirementDescription:exceededText,status:'PENDING_REVIEW',formulaVersion:'KPI_2026_V1',updatedAt:serverTimestamp(),createdAt:ev.createdAt||serverTimestamp()
    },{merge:true});
    await audit('SUBMIT_SELF_ASSESSMENT',{taskId, selfActualScore:score.actual}); closeModal(); await loadAll();
  });
}

function openReview(evalId) {
  const ev=KpiWorkflowState.evaluations.find(e=>e.id===evalId); const task=KpiWorkflowState.tasks.find(t=>t.id===ev?.taskId); if(!ev||!task||!canReviewEvaluation(ev,task))return;
  const rates=[100,80,60,0];
  modal('Xác nhận điểm nhiệm vụ', `<form class="kpi-form-grid"><div class="kpi-field full"><strong>${esc(task.ownerName)} · ${esc(task.title)}</strong><span>Tự chấm: tiến độ ${ev.selfProgressRate}%, kết quả ${ev.selfResultRate}%, điểm ${fmt(ev.selfActualScore)}</span></div>
    <div class="kpi-field"><label>Tiến độ xác nhận</label><select id="kpiConfirmProgress">${rates.map(r=>`<option value="${r}" ${Number(ev.confirmedProgressRate??ev.selfProgressRate)===r?'selected':''}>${r}%</option>`).join('')}</select></div>
    <div class="kpi-field"><label>Kết quả xác nhận</label><select id="kpiConfirmResult">${rates.map(r=>`<option value="${r}" ${Number(ev.confirmedResultRate??ev.selfResultRate)===r?'selected':''}>${r}%</option>`).join('')}</select></div>
    <div class="kpi-field full"><label>Nhận xét/căn cứ</label><textarea id="kpiReviewerComment" rows="4">${esc(ev.reviewerComment||'')}</textarea></div><div class="kpi-field full"><div id="kpiConfirmScore" class="kpi-alert"></div></div></form>`,
    '<button id="kpiNeedRevision" class="kpi-button secondary" type="button">Yêu cầu bổ sung</button><button class="kpi-button secondary" data-kpi-close type="button">Hủy</button><button id="kpiConfirmEvaluation" class="kpi-button" type="button">Xác nhận điểm</button>');
  const recalc=()=>{const x=calculateTaskScore(task.baseScore,task.difficultyCoefficient,el('kpiConfirmProgress').value,el('kpiConfirmResult').value);el('kpiConfirmScore').textContent=`Điểm xác nhận: ${fmt(x.actual)}/${fmt(x.maximum)}`;};
  el('kpiConfirmProgress').addEventListener('change',recalc);el('kpiConfirmResult').addEventListener('change',recalc);recalc();
  el('kpiNeedRevision').addEventListener('click',async()=>{const note=clean(el('kpiReviewerComment').value);if(!note){alert('Nhập nội dung cần bổ sung.');return;}await updateDoc(doc(db,'taskEvaluations',ev.id),{status:'NEEDS_REVISION',reviewerComment:note,reviewedByUserId:KpiWorkflowState.user.uid,reviewedByName:KpiWorkflowState.profile.fullName||'',updatedAt:serverTimestamp()});closeModal();await loadAll();});
  el('kpiConfirmEvaluation').addEventListener('click',async()=>{const p=Number(el('kpiConfirmProgress').value),r=Number(el('kpiConfirmResult').value),note=clean(el('kpiReviewerComment').value);if((p!==Number(ev.selfProgressRate)||r!==Number(ev.selfResultRate))&&!note){alert('Khi điều chỉnh khác tự chấm phải nhập lý do.');return;}const x=calculateTaskScore(task.baseScore,task.difficultyCoefficient,p,r);await updateDoc(doc(db,'taskEvaluations',ev.id),{confirmedProgressRate:p,confirmedResultRate:r,confirmedExecutionScore:x.execution,confirmedActualScore:x.actual,reviewerComment:note,status:'CONFIRMED',scoreLocked:true,reviewedByUserId:KpiWorkflowState.user.uid,reviewedByName:KpiWorkflowState.profile.fullName||'',confirmedAt:serverTimestamp(),updatedAt:serverTimestamp()});await updateDoc(doc(db,'tasks',task.id),{scoringStatus:'CONFIRMED',scoreLocked:true,confirmedActualScore:x.actual,updatedAt:serverTimestamp()});await audit('CONFIRM_TASK_SCORE',{taskId:task.id,confirmedActualScore:x.actual});closeModal();await loadAll();});
}

function openTaskInfo(taskId){const t=KpiWorkflowState.tasks.find(x=>x.id===taskId),e=evaluationFor(taskId);if(!t)return;modal('Chi tiết KPI nhiệm vụ',`<div class="kpi-form-grid"><div class="kpi-field full"><strong>${esc(t.taskCode||'')} — ${esc(t.title)}</strong></div><div class="kpi-field"><label>Người thực hiện</label><span>${esc(t.ownerName||'Chờ phân công')}</span></div><div class="kpi-field"><label>Trạng thái kế hoạch</label><span>${esc(taskStatus(t,e))}</span></div><div class="kpi-field"><label>Điểm chuẩn</label><span>${fmt(t.baseScore)}</span></div><div class="kpi-field"><label>Hệ số</label><span>${fmt(t.difficultyCoefficient)}</span></div><div class="kpi-field"><label>Điểm tối đa</label><span>${fmt(t.maximumConvertedScore)}</span></div><div class="kpi-field"><label>Cốt lõi</label><span>${t.isCoreTask===true?'Có':'Không'}</span></div><div class="kpi-field full"><label>Minh chứng bắt buộc</label><span>${esc(t.standardTaskMandatoryEvidence||'—')}</span></div></div>`);}

function openCommonCriteria(){
  if(!KpiWorkflowState.period)return;
  if(KpiWorkflowState.common?.status==='CONFIRMED'){alert('Tiêu chí chung đã được xác nhận và không thể chỉnh sửa.');return;}const items=KpiWorkflowState.common?.items||[];modal('Mẫu 01 · Nhóm tiêu chí chung 30 điểm',`<div class="kpi-criteria-list">${COMMON_CRITERIA.map(c=>{const v=items.find(x=>x.code===c.code)||{};return `<div class="kpi-criterion"><strong class="kpi-criterion-score">${c.code}<br>${c.max} điểm</strong><p class="kpi-criterion-text">${esc(c.text)}</p><div class="kpi-criterion-controls"><select data-common-code="${c.code}" aria-label="Kết quả tiêu chí ${c.code}"><option value="DAM_BAO" ${v.selfResult!=='KHONG_DAM_BAO'?'selected':''}>Đảm bảo</option><option value="KHONG_DAM_BAO" ${v.selfResult==='KHONG_DAM_BAO'?'selected':''}>Không đảm bảo</option></select><textarea data-common-note="${c.code}" rows="2" placeholder="Ghi chú/căn cứ" aria-label="Ghi chú tiêu chí ${c.code}">${esc(v.note||'')}</textarea></div></div>`;}).join('')}</div><div id="kpiCommonTotal" class="kpi-alert"></div>`, '<button class="kpi-button secondary" data-kpi-close type="button">Hủy</button><button id="kpiSaveCommon" class="kpi-button" type="button">Lưu tự đánh giá</button>');
  const calc=()=>{let total=0;COMMON_CRITERIA.forEach(c=>{if(document.querySelector(`[data-common-code="${c.code}"]`)?.value==='DAM_BAO')total+=c.max;});el('kpiCommonTotal').textContent=`Tổng điểm tiêu chí chung: ${total}/30`;return total;};document.querySelectorAll('[data-common-code]').forEach(x=>x.addEventListener('change',calc));calc();
  el('kpiSaveCommon').addEventListener('click',async()=>{const data=COMMON_CRITERIA.map(c=>{const result=document.querySelector(`[data-common-code="${c.code}"]`).value;const note=clean(document.querySelector(`[data-common-note="${c.code}"]`).value);if(result==='KHONG_DAM_BAO'&&!note)throw new Error(`Tiêu chí ${c.code} không đảm bảo phải có căn cứ.`);return {code:c.code,max:c.max,text:c.text,selfResult:result,selfScore:result==='DAM_BAO'?c.max:0,note};});try{const total=data.reduce((s,x)=>s+x.selfScore,0);await setDoc(doc(db,'commonCriteriaAssessments',`${KpiWorkflowState.period.id}_${KpiWorkflowState.user.uid}`),{periodId:KpiWorkflowState.period.id,userId:KpiWorkflowState.user.uid,fullName:KpiWorkflowState.profile.fullName||'',departmentId:KpiWorkflowState.profile.departmentId||'',items:data,selfTotal:total,confirmedTotal:null,status:'SELF_COMPLETED',updatedAt:serverTimestamp(),createdAt:KpiWorkflowState.common?.createdAt||serverTimestamp()},{merge:true});await audit('SAVE_COMMON_CRITERIA',{score:total});closeModal();await loadAll();}catch(err){alert(err.message);}});
}

function openCommonReview(assessmentId) {
  const assessment = KpiWorkflowState.commonAll.find(item => item.id === assessmentId);
  if (!assessment || assessment.userId === KpiWorkflowState.user.uid) return;
  const owner = KpiWorkflowState.users.find(user => user.id === assessment.userId);
  const allowed = activeRole('ADMIN') || ((isDepartmentHead() || hasActiveApprovalDelegation('CONFIRM_EVALUATIONS')) && normalizeDepartment(assessment.departmentId) === normalizeDepartment(KpiWorkflowState.profile.departmentId) && owner?.role === 'STAFF');
  if (!allowed) return;
  const items = assessment.items || [];
  modal('Xác nhận Mẫu 01 · 30 điểm', `<p><strong>${esc(assessment.fullName)}</strong> · Tự chấm ${fmt(assessment.selfTotal)}/30</p><div class="kpi-criteria-list">${COMMON_CRITERIA.map(c=>{const v=items.find(x=>x.code===c.code)||{};const confirmed=v.confirmedResult||v.selfResult||'DAM_BAO';return `<div class="kpi-criterion"><strong class="kpi-criterion-score">${c.code}<br>${c.max} điểm</strong><p class="kpi-criterion-text">${esc(c.text)}<br><span class="kpi-small">Cá nhân: ${v.selfResult==='KHONG_DAM_BAO'?'Không đảm bảo':'Đảm bảo'}</span></p><div class="kpi-criterion-controls"><select data-confirm-common-code="${c.code}" aria-label="Kết quả xác nhận tiêu chí ${c.code}"><option value="DAM_BAO" ${confirmed==='DAM_BAO'?'selected':''}>Đảm bảo</option><option value="KHONG_DAM_BAO" ${confirmed==='KHONG_DAM_BAO'?'selected':''}>Không đảm bảo</option></select><textarea data-confirm-common-note="${c.code}" rows="2" placeholder="Căn cứ khi điều chỉnh" aria-label="Căn cứ tiêu chí ${c.code}">${esc(v.confirmedNote||v.note||'')}</textarea></div></div>`;}).join('')}</div><div id="kpiConfirmCommonTotal" class="kpi-alert"></div>`, '<button class="kpi-button secondary" data-kpi-close type="button">Hủy</button><button id="kpiConfirmCommonSave" class="kpi-button" type="button">Xác nhận 30 điểm</button>');
  const calc=()=>{let total=0;COMMON_CRITERIA.forEach(c=>{if(document.querySelector(`[data-confirm-common-code="${c.code}"]`)?.value==='DAM_BAO')total+=c.max;});el('kpiConfirmCommonTotal').textContent=`Điểm xác nhận: ${total}/30`;return total;};
  document.querySelectorAll('[data-confirm-common-code]').forEach(input=>input.addEventListener('change',calc));calc();
  el('kpiConfirmCommonSave').addEventListener('click', async()=>{
    try {
      const confirmedItems = COMMON_CRITERIA.map(c=>{const original=items.find(x=>x.code===c.code)||{};const result=document.querySelector(`[data-confirm-common-code="${c.code}"]`).value;const note=clean(document.querySelector(`[data-confirm-common-note="${c.code}"]`).value);if(result!==original.selfResult&&!note)throw new Error(`Tiêu chí ${c.code} điều chỉnh khác tự chấm phải có căn cứ.`);return {...original,code:c.code,max:c.max,text:c.text,confirmedResult:result,confirmedScore:result==='DAM_BAO'?c.max:0,confirmedNote:note};});
      const total=confirmedItems.reduce((sum,item)=>sum+item.confirmedScore,0);
      await updateDoc(doc(db,'commonCriteriaAssessments',assessment.id),{items:confirmedItems,confirmedTotal:total,status:'CONFIRMED',confirmedByUserId:KpiWorkflowState.user.uid,confirmedByName:KpiWorkflowState.profile.fullName||'',confirmedAt:serverTimestamp(),updatedAt:serverTimestamp()});
      await audit('CONFIRM_COMMON_CRITERIA',{userId:assessment.userId,score:total});closeModal();await loadAll();
    } catch(error){alert(error.message);}
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

  const departmentId = normalizeDepartment(KpiWorkflowState.profile.departmentId);
  const approved = KpiWorkflowState.tasks.filter(task =>
    normalizeDepartment(task.primaryDepartmentId) === departmentId
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
      alert(error?.message || 'Không thể hủy ủy quyền.');
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
    <div class="kpi-field"><label>Mã kỳ</label><input id="kpiPeriodIdInput" value="${esc(next.id)}" required></div>
    <div class="kpi-field"><label>Tên kỳ</label><input id="kpiPeriodNameInput" value="${esc(next.name)}" required></div>
    <div class="kpi-field"><label>Từ ngày</label><input id="kpiPeriodStartInput" type="date" value="${next.start}" required></div>
    <div class="kpi-field"><label>Đến ngày</label><input id="kpiPeriodEndInput" type="date" value="${next.end}" required></div>
  </form>`, '<button class="kpi-button secondary" data-kpi-close type="button">Hủy</button><button id="kpiCreatePeriodSubmit" class="kpi-button" type="button">Tạo và mở kỳ</button>');
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

async function createPeriodFromForm(){
  if (!Permissions.canManageEvaluationPeriods()) return;
  const periodId=clean(el('kpiPeriodIdInput').value).toUpperCase();
  const name=clean(el('kpiPeriodNameInput').value);
  const startDate=clean(el('kpiPeriodStartInput').value);
  const endDate=clean(el('kpiPeriodEndInput').value);
  if(!/^\d{4}-Q[1-4]$/.test(periodId)){alert('Mã kỳ phải có dạng 2026-Q3.');return;}
  if(!name||!startDate||!endDate||startDate>endDate){alert('Thông tin kỳ chưa hợp lệ.');return;}
  if(KpiWorkflowState.periods.some(p=>p.active===true)){alert('Đang có một kỳ hoạt động. Hãy kết thúc kỳ hiện tại trước khi mở kỳ mới.');return;}
  const [yearText,quarterText]=periodId.split('-Q');
  await setDoc(doc(db,'evaluationPeriods',periodId),{
    periodId,name,year:Number(yearText),quarter:Number(quarterText),startDate,endDate,recommendedPlanningDays:10,
    autoLockPlan:false,pilotMode:false,status:'ACTIVE',active:true,
    createdByUserId:KpiWorkflowState.user.uid,createdByName:KpiWorkflowState.profile.fullName||'',createdAt:serverTimestamp(),updatedAt:serverTimestamp()
  },{merge:false});
  await audit('CREATE_PERIOD',{periodId,startDate,endDate});
  closeModal(); await loadAll();
}
async function completePeriod(){if(!Permissions.canManageEvaluationPeriods()||!KpiWorkflowState.period)return;if(!confirm('Xác nhận đã in và lưu hồ sơ giấy, sau đó kết thúc kỳ?'))return;await updateDoc(doc(db,'evaluationPeriods',KpiWorkflowState.period.id),{status:'COMPLETED',active:false,completedByUserId:KpiWorkflowState.user.uid,completedAt:serverTimestamp(),updatedAt:serverTimestamp()});await audit('COMPLETE_PERIOD',{periodId:KpiWorkflowState.period.id});await loadAll();}
async function deletePeriodData(){
  if(!activeRole('ADMIN')||!KpiWorkflowState.period)return;
  const reason=prompt('Nhập lý do hủy dữ liệu nghiệp vụ trong kỳ:');if(!clean(reason))return;
  const periodId=KpiWorkflowState.period.id;
  const names=['taskRegistrations','tasks','kpiPlans','taskEvaluations','commonCriteriaAssessments'];
  let count=0;
  for(const name of names){
    const snap=await getDocs(query(collection(db,name),where('periodId','==',periodId)));
    for(const item of snap.docs){await updateDoc(item.ref,{active:false,status:'CANCELLED',cancelReason:clean(reason),cancelledAt:serverTimestamp(),cancelledByUserId:KpiWorkflowState.user.uid,updatedAt:serverTimestamp()});count++;}
  }
  await setDoc(doc(db,'kpiDeletionLogs',`${periodId}_${Date.now()}`),{periodId,softDeletedCount:count,reason:clean(reason),deletedByUserId:KpiWorkflowState.user.uid,deletedByName:KpiWorkflowState.profile.fullName||'',deletedAt:serverTimestamp()});
  await audit('SOFT_CLEAN_PERIOD',{periodId,count,reason:clean(reason)});alert(`Đã hủy mềm ${count} bản ghi trong kỳ. Dữ liệu được đánh dấu hủy để bảo đảm khả năng đối chiếu.`);await loadAll();
}

function openReport() {
  if (!KpiWorkflowState.period) return;

  const mine = KpiWorkflowState.tasks.filter(t => t.ownerUserId === KpiWorkflowState.user.uid && t.active !== false);
  const officialCommonScore = KpiWorkflowState.common?.status === 'CONFIRMED'
    ? Number(KpiWorkflowState.common.confirmedTotal || 0)
    : 0;
  const s = calculateKpiSummary(recognizedRowsForUser(), officialCommonScore);
  const rating = ratingName(proposedRating(s.total100));
  const profile = { ...(KpiWorkflowState.profile || {}), ...(KpiWorkflowState.kpiProfile || {}) };
  const commonItems = KpiWorkflowState.common?.status === 'CONFIRMED'
    ? (KpiWorkflowState.common.items || [])
    : [];

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
      const result = value.confirmedResult || value.selfResult || '';
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
        <td>${esc(value.confirmedNote || value.note || '')}</td>
      </tr>`;
    }).join('');
    const groupScore = group.items.reduce((total, [code, , max]) => {
      const value = resultFor(code);
      const result = value.confirmedResult || value.selfResult || '';
      return total + (result === 'DAM_BAO' ? max : 0);
    }, 0);
    return `<tr class="m01-group-row"><td class="m01-center">${group.code}</td><td>${esc(group.title)}</td><td></td><td></td><td class="m01-center">${fmt(group.max)}</td><td class="m01-center">${fmt(groupScore)}</td><td></td></tr>${rows}`;
  }).join('');

  const taskRows = mine.map((task, index) => {
    const evaluation = evaluationFor(task.id) || {};
    const officialScore = evaluation.status === 'CONFIRMED'
      ? Number(evaluation.confirmedActualScore || 0)
      : '';
    return `<tr class="m01-task-row">
      <td class="m01-center">${index + 1}</td>
      <td colspan="3">${esc(task.title || '')}</td>
      <td class="m01-center">${fmt(task.maximumConvertedScore || 0)}</td>
      <td class="m01-center">${officialScore === '' ? '' : fmt(officialScore)}</td>
      <td></td>
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
  const departmentName = profileValue('departmentName', 'unitName', 'departmentId');
  const currentDate = new Intl.DateTimeFormat('vi-VN', { day:'2-digit', month:'2-digit', year:'numeric' }).format(new Date());

  const pdfHtml = `<div id="kpiPdfPreview" class="kpi-report kpi-report-print m01-report">
    <div class="m01-top">
      <div class="m01-agency"><strong>TRUNG TÂM<br>BẢO TRỢ XÃ HỘI TÂN HIỆP</strong><div>*</div></div>
      <div class="m01-national"><strong>ĐẢNG CỘNG SẢN VIỆT NAM</strong><div><em>Đồng Nai, ngày ${currentDate.slice(0,2)} tháng ${currentDate.slice(3,5)} năm ${currentDate.slice(6)}</em></div></div>
      <div class="m01-form-number">Mẫu 01</div>
    </div>
    <h1>BẢN TỰ ĐÁNH GIÁ, XẾP LOẠI CỦA CÁ NHÂN</h1>
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
    <table class="kpi-report-table m01-table">
      <colgroup><col class="m01-col-stt"><col class="m01-col-content"><col class="m01-col-check"><col class="m01-col-check"><col class="m01-col-score"><col class="m01-col-score"><col class="m01-col-note"></colgroup>
      <tbody>
        <tr class="m01-part-row"><td class="m01-center">A</td><td colspan="6">NHÓM TIÊU CHÍ CHUNG (30 ĐIỂM) - Các tiêu chí thực hiện theo Quy định số 366-QĐ/TW của Bộ Chính trị</td></tr>
        <tr class="m01-header-row"><th>TT</th><th>Tiêu chí / Nội dung</th><th>Đảm bảo<br>(Đánh dấu x)</th><th>Không đảm bảo<br>(Đánh dấu x)</th><th>Điểm tối đa</th><th>Điểm đạt<br><small>(Tối đa nếu đảm bảo; 0 điểm nếu không đảm bảo)</small></th><th>Ghi chú</th></tr>
        ${criterionRows}
        <tr class="m01-total-row"><td colspan="4">Tổng (A) =</td><td class="m01-center">30</td><td class="m01-center">${fmt(s.common30)}</td><td></td></tr>
        <tr class="m01-part-row"><td class="m01-center">B</td><td colspan="3">KẾT QUẢ THỰC HIỆN NHIỆM VỤ ĐƯỢC GIAO (70 ĐIỂM)</td><td class="m01-center">Điểm tối đa<br><small>(70 điểm)</small></td><td class="m01-center">Điểm đạt được</td><td>Ghi chú</td></tr>
        ${taskRows || '<tr class="m01-task-row"><td class="m01-center">—</td><td colspan="3">Chưa có nhiệm vụ trong kỳ.</td><td></td><td></td><td></td></tr>'}
        <tr class="m01-total-row"><td colspan="4">TỔNG (B) =</td><td class="m01-center">70</td><td class="m01-center">${fmt(s.kpi70)}</td><td></td></tr>
        <tr class="m01-grand-total"><td colspan="4">TỔNG (A + B) =</td><td class="m01-center">100</td><td class="m01-center">${fmt(s.total100)}</td><td></td></tr>
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

  const excelHtml = `<div id="kpiExcelPreview" class="kpi-hidden"><div class="kpi-alert kpi-ok">Bảng dữ liệu nhiệm vụ dùng để kiểm tra điểm KPI trước khi in Mẫu 01.</div><div class="kpi-table-wrap"><table class="kpi-table"><thead><tr><th>STT</th><th>Tên nhiệm vụ</th><th>Điểm chuẩn</th><th>Hệ số</th><th>Điểm tối đa</th><th>Tiến độ xác nhận</th><th>Kết quả xác nhận</th><th>Điểm thực tế</th></tr></thead><tbody>${mine.map((t, i) => { const e = evaluationFor(t.id) || {}; return `<tr><td>${i + 1}</td><td>${esc(t.title)}</td><td>${fmt(t.baseScore)}</td><td>${fmt(t.difficultyCoefficient)}</td><td>${fmt(t.maximumConvertedScore)}</td><td>${e.confirmedProgressRate ?? e.selfProgressRate ?? ''}</td><td>${e.confirmedResultRate ?? e.selfResultRate ?? ''}</td><td>${fmt(e.confirmedActualScore ?? e.selfActualScore)}</td></tr>`; }).join('')}</tbody></table></div></div>`;

  modal('Xem trước Mẫu 01', `<div class="kpi-preview-tabs kpi-no-print"><button id="kpiPdfTab" class="kpi-button secondary active" type="button">Mẫu 01</button><button id="kpiExcelTab" class="kpi-button secondary" type="button">Bảng tính điểm</button></div>${pdfHtml}${excelHtml}`, '<button class="kpi-button secondary" data-kpi-close type="button">Đóng</button><button id="kpiExportCsv" class="kpi-button secondary" type="button">📊 Xuất bảng điểm</button><button id="kpiPrintReport" class="kpi-button" type="button">🖨️ In Mẫu 01</button>');
  el('kpiPdfTab').addEventListener('click', () => { el('kpiPdfPreview').classList.remove('kpi-hidden'); el('kpiExcelPreview').classList.add('kpi-hidden'); el('kpiPdfTab').classList.add('active'); el('kpiExcelTab').classList.remove('active'); el('kpiPrintReport').classList.remove('kpi-hidden'); });
  el('kpiExcelTab').addEventListener('click', () => { el('kpiPdfPreview').classList.add('kpi-hidden'); el('kpiExcelPreview').classList.remove('kpi-hidden'); el('kpiPdfTab').classList.remove('active'); el('kpiExcelTab').classList.add('active'); el('kpiPrintReport').classList.add('kpi-hidden'); });
  el('kpiPrintReport').addEventListener('click', () => window.print());
  el('kpiExportCsv')?.addEventListener('click', () => exportReportCsv(mine, s));
}

function exportReportCsv(tasks, summaryData){
  const quote = value => `"${String(value ?? '').replaceAll('\"','\"\"')}"`;
  const rows = [['STT','Tên nhiệm vụ','Điểm chuẩn','Hệ số','Điểm tối đa','Tiến độ xác nhận','Chất lượng xác nhận','Điểm thực tế']];
  tasks.forEach((task,index)=>{const ev=evaluationFor(task.id)||{};rows.push([index+1,task.title||'',task.baseScore||0,task.difficultyCoefficient||1,task.maximumConvertedScore||0,ev.confirmedProgressRate??ev.selfProgressRate??'',ev.confirmedResultRate??ev.selfResultRate??'',ev.confirmedActualScore??ev.selfActualScore??0]);});
  rows.push([]);rows.push(['A',summaryData.A]);rows.push(['B',summaryData.B]);rows.push(['KPI công việc /70',summaryData.kpi70]);rows.push(['Tiêu chí chung /30',summaryData.common30]);rows.push(['Tổng /100',summaryData.total100]);
  const csv='\ufeff'+rows.map(row=>row.map(quote).join(';')).join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`Bao_cao_KPI_${KpiWorkflowState.period?.id||'ky'}_${KpiWorkflowState.profile?.fullName||'ca_nhan'}.csv`;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
}

async function audit(action, detail){try{await addDoc(collection(db,'kpiAuditLogs'),{periodId:KpiWorkflowState.period?.id||'',action,detail,performedByUserId:KpiWorkflowState.user.uid,performedByName:KpiWorkflowState.profile.fullName||'',performedAt:serverTimestamp()});}catch(error){console.warn('Không ghi được KPI audit log',error);}}

window.KPI2C = {
  getActivePeriodSnapshot: () => KpiWorkflowState.period ? { id:KpiWorkflowState.period.id,name:KpiWorkflowState.period.name,startDate:KpiWorkflowState.period.startDate,endDate:KpiWorkflowState.period.endDate,status:KpiWorkflowState.period.status } : null,
  classifyNewTask: (templateItem, profile) => ({
    periodId: KpiWorkflowState.period?.id || '', periodName:KpiWorkflowState.period?.name || '',
    planType: templateItem?.workType === 'DOT_XUAT' ? 'DOT_XUAT' : 'KE_HOACH',
    planApprovalStatus:'PENDING_APPROVAL',includedInA:false,isCoreTask:Boolean(templateItem?.isCoreTaskDefault),isManagementTask:Boolean(templateItem?.isManagementTask),
    reviewerEmail:clean(profile?.kpiReviewerEmail).toLowerCase(),scoringEnabled:true,scoringStatus:'NOT_ASSESSED'
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
