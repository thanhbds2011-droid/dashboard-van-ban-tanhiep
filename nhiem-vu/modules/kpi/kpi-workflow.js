import { auth, db } from '../../firebase-config.js';
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, query,
  serverTimestamp, setDoc, updateDoc, where
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { TaskRegistrationService } from '../../services/task-registration-service.js';
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
  holidays: []
};

const el = (id) => document.getElementById(id);
const clean = (value) => String(value ?? '').trim();
const esc = (value) => clean(value).replace(/[&<>'"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const fmt = (n) => Number(n || 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 });
const dateVi = (key) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean(key)); return m ? `${m[3]}/${m[2]}/${m[1]}` : clean(key); };
const normalizeDepartment = (value) => clean(value).toUpperCase();
const activeRole = (...roles) => KpiWorkflowState.profile?.active === true && roles.includes(KpiWorkflowState.profile?.role);
const globalRole = () => activeRole('ADMIN','DIRECTOR','TCHC_COORDINATOR');
const isLeader = () => activeRole('DEPARTMENT_LEADER');
const isStaff = () => activeRole('STAFF');
const isDeputyLeader = () => isLeader() && /ph[oó]\s*trưởng|ph[oó]\s*phòng|ph[oó]\s*khu/i.test(clean(KpiWorkflowState.profile?.position));
const isDepartmentHead = () => isLeader() && !isDeputyLeader();
const reviewerEmailMatches = (registration) => !clean(registration?.reviewerEmail) || clean(registration.reviewerEmail).toLowerCase() === clean(KpiWorkflowState.profile?.email).toLowerCase();
const canApproveRegistration = (registration) => {
  if (!registration || registration.status !== 'PENDING') return false;
  if (activeRole('ADMIN')) return true;
  if (registration.userRole === 'DEPARTMENT_LEADER') {
    const deputy=/ph[oó]\s*(trưởng|phòng|khu)/i.test(clean(registration.userPosition));
    if(deputy) return isDepartmentHead() && sameDepartment(registration) && registration.userId!==KpiWorkflowState.user.uid;
    return activeRole('DIRECTOR') && reviewerEmailMatches(registration);
  }
  return isDepartmentHead() && sameDepartment(registration);
};
const sameDepartment = (data) => normalizeDepartment(data?.departmentId || data?.primaryDepartmentId) === normalizeDepartment(KpiWorkflowState.profile?.departmentId);

function mount() {
  const section = el('kpiSection');
  if (!section) return;
  const mode = KpiWorkflowState.mode || 'plans';
  const heading = mode === 'evaluations' ? 'Đánh giá và xác nhận kết quả' : mode === 'reports' ? 'Báo cáo KPI' : 'Kế hoạch KPI';
  const description = mode === 'evaluations' ? 'Tự đánh giá nhiệm vụ hoàn thành và xác nhận kết quả.' : mode === 'reports' ? 'Xem trước và in Bản tự đánh giá cá nhân sau khi hoàn tất quy trình.' : 'Theo dõi kế hoạch, tự đánh giá, tiêu chí chung và xác nhận kết quả trong kỳ.';
  section.innerHTML = `
    <div class="kpi-header">
      <div>
        <div><span class="kpi-pilot">QUY TRÌNH ĐÁNH GIÁ KPI</span></div>
        <h2>${heading}</h2>
        <p>${description}</p>
        <div id="kpiPeriodLine" class="kpi-period-line"></div>
      </div>
      <div class="kpi-actions kpi-no-print">
        <button id="kpiRefresh" class="kpi-button secondary" type="button">↻ Làm mới</button>
        <button id="kpiOpenReport" class="kpi-button" type="button">🧾 Xem trước báo cáo</button>
      </div>
    </div>
    <div id="kpiMessage"></div>
    <div class="kpi-process">
      <div class="kpi-process-step done"><span>1</span><strong>Kế hoạch KPI</strong><small>Đăng ký và duyệt</small></div>
      <div class="kpi-process-step done"><span>2</span><strong>Thực hiện nhiệm vụ</strong><small>Cập nhật tiến độ</small></div>
      <div class="kpi-process-step"><span>3</span><strong>Tự đánh giá KPI</strong><small>Nhiệm vụ và tiêu chí chung</small></div>
      <div class="kpi-process-step"><span>4</span><strong>Xác nhận kết quả</strong><small>Cá nhân hoặc hàng loạt</small></div>
      <div class="kpi-process-step"><span>5</span><strong>Báo cáo Mẫu 01</strong><small>In kết quả hoàn chỉnh</small></div>
    </div>
    <div class="kpi-metrics">
      <div class="kpi-metric"><span>A · Kế hoạch</span><strong id="kpiMetricA">0</strong></div>
      <div class="kpi-metric"><span>B · Thực tế</span><strong id="kpiMetricB">0</strong><small id="kpiMetricBStatus" class="kpi-small">Chưa tự đánh giá</small></div>
      <div class="kpi-metric"><span>KPI công việc</span><strong id="kpiMetric70">0/70</strong></div>
      <div class="kpi-metric"><span>Tiêu chí chung</span><strong id="kpiMetric30">0/30</strong></div>
      <div class="kpi-metric"><span>Tổng điểm</span><strong id="kpiMetric100">0/100</strong></div>
    </div>
    <div class="kpi-toolbar kpi-no-print" data-mode-toolbar>
      <button id="kpiCommonButton" class="kpi-button secondary" type="button">✍️ Tự chấm tiêu chí chung · 30 điểm</button>
      <button id="kpiLockPlan" class="kpi-button secondary" type="button">🔒 Khóa kế hoạch Phòng/Khu</button>
      <button id="kpiPeriodAdmin" class="kpi-button secondary" type="button">⚙️ Quản lý kỳ</button>
      <span class="kpi-small">A là điểm kế hoạch đã duyệt; B tạm tính hình thành sau khi cá nhân tự đánh giá và trở thành chính thức sau khi cấp có thẩm quyền xác nhận.</span>
    </div>
    <div class="kpi-grid kpi-grid-single" data-mode-grid>
      <section class="kpi-card">
        <h3 id="kpiMainCardTitle">Nhiệm vụ trong kỳ</h3>
        <p id="kpiMainCardHint" class="kpi-small">Tổng hợp theo từng người; bấm Chi tiết để xem đầu việc, hệ số và duyệt.</p>
        <div id="kpiTaskList"></div>
      </section>
      <div id="kpiReviewList" class="kpi-hidden"></div>
    </div>
    <section id="kpiAdminBox" class="kpi-card kpi-admin-danger kpi-hidden kpi-no-print">
      <h3>Quản trị kỳ đánh giá</h3>
      <p>Chỉ xóa dữ liệu phát sinh theo kỳ sau khi báo cáo giấy đã được in, ký và lưu. Không xóa tài khoản, phòng/khu hoặc danh mục chuẩn.</p>
      <div class="kpi-actions">
        <button id="kpiInitPilot" class="kpi-button secondary" type="button">Tạo kỳ mới</button>
        <button id="kpiCompletePeriod" class="kpi-button secondary" type="button">Kết thúc kỳ</button>
        <button id="kpiDeletePeriod" class="kpi-button danger" type="button">Xóa dữ liệu kỳ</button>
      </div>
    </section>`;
  wireEvents();
  section.dataset.kpiMode = mode;
  if (mode === 'reports') {
    el('kpiCommonButton')?.classList.add('kpi-hidden');
    el('kpiLockPlan')?.classList.add('kpi-hidden');
  } else if (mode === 'evaluations') {
    el('kpiLockPlan')?.classList.add('kpi-hidden');
  } else {
    el('kpiOpenReport')?.classList.add('kpi-hidden');
  }
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
  el('kpiCommonButton')?.addEventListener('click', openCommonCriteria);
  el('kpiLockPlan')?.addEventListener('click', lockDepartmentPlan);
  el('kpiPeriodAdmin')?.addEventListener('click', openPeriodManager);
  el('kpiInitPilot')?.addEventListener('click', initializePilotPeriod);
  el('kpiCompletePeriod')?.addEventListener('click', completePeriod);
  el('kpiDeletePeriod')?.addEventListener('click', deletePeriodData);
  el('kpiTaskList')?.addEventListener('click', taskAction);
  el('kpiReviewList')?.addEventListener('click', reviewAction);
}


function periodStatusLabel(period) {
  if (period?.active === true || clean(period?.status).toUpperCase() === 'ACTIVE') {
    return 'Đang hoạt động';
  }
  if (clean(period?.status).toUpperCase() === 'COMPLETED') return 'Đã kết thúc';
  if (clean(period?.status).toUpperCase() === 'DRAFT') return 'Bản nháp';
  return period?.status || 'Không xác định';
}


function openPeriodManager() {
  if (!activeRole('ADMIN')) return;
  const rows = [...KpiWorkflowState.periods]
    .sort((a,b) => clean(b.startDate).localeCompare(clean(a.startDate)))
    .map(period => {
      const isActive = activePeriod(period);
      return `<tr>
        <td><strong>${esc(period.id)}</strong><br><span class="kpi-small">${esc(period.name || '')}</span></td>
        <td>${dateVi(period.startDate)}<br>${dateVi(period.endDate)}</td>
        <td><span class="kpi-status">${esc(periodStatusLabel(period))}</span></td>
        <td><div class="kpi-actions">
          <button class="kpi-button secondary" type="button" data-period-edit="${esc(period.id)}">Sửa</button>
          ${isActive
            ? `<button class="kpi-button secondary" type="button" data-period-complete="${esc(period.id)}">Kết thúc</button>`
            : `<button class="kpi-button" type="button" data-period-activate="${esc(period.id)}">${clean(period.status).toUpperCase()==='COMPLETED'?'Mở lại':'Kích hoạt'}</button>`}
          <button class="kpi-button danger" type="button" data-period-delete="${esc(period.id)}">Xóa vĩnh viễn</button>
        </div></td>
      </tr>`;
    }).join('');
  const root = modal('Quản lý kỳ đánh giá', `
    <div class="period-manager-head">
      <div><p class="kpi-small">Chỉ một kỳ được hoạt động. “Xóa vĩnh viễn” sẽ xóa toàn bộ dữ liệu thuộc kỳ và không lưu nhật ký xóa.</p></div>
      <button id="periodCreateNew" class="kpi-button" type="button">＋ Tạo kỳ mới</button>
    </div>
    ${rows ? `<div class="kpi-table-wrap"><table class="kpi-table period-table"><thead><tr><th>Kỳ</th><th>Thời gian</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="kpi-empty">Chưa có kỳ đánh giá.</div>'}
  `);
  root.querySelector('#periodCreateNew')?.addEventListener('click', () => { closeModal(); initializePilotPeriod(); });
  root.addEventListener('click', async event => {
    const edit = event.target.closest('[data-period-edit]');
    const activate = event.target.closest('[data-period-activate]');
    const complete = event.target.closest('[data-period-complete]');
    const remove = event.target.closest('[data-period-delete]');
    if (edit) return openEditPeriod(edit.dataset.periodEdit);
    if (activate) return activatePeriod(activate.dataset.periodActivate);
    if (complete) return completePeriodById(complete.dataset.periodComplete);
    if (remove) return deletePeriodById(remove.dataset.periodDelete);
  });
}

function openEditPeriod(periodId) {
  const period = KpiWorkflowState.periods.find(item => item.id === periodId);
  if (!period || !activeRole('ADMIN')) return;
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
  return activatePeriodInternal(periodId);
}
async function activatePeriodInternal(periodId) {
  if (!activeRole('ADMIN')) return;
  const others = KpiWorkflowState.periods.filter(period => activePeriod(period) && period.id !== periodId);
  if (others.length) {
    const ok = confirm(`Đang có kỳ ${others[0].name || others[0].id} hoạt động. Hệ thống sẽ kết thúc kỳ đó và mở kỳ ${periodId}. Tiếp tục?`);
    if (!ok) return;
    for (const period of others) {
      await updateDoc(doc(db,'evaluationPeriods',period.id), {
        active:false, status:'COMPLETED', updatedAt:serverTimestamp(),
        completedAt:serverTimestamp(), completedByUserId:KpiWorkflowState.user.uid
      });
    }
  }
  await updateDoc(doc(db,'evaluationPeriods',periodId), {
    active:true, status:'ACTIVE', activatedAt:serverTimestamp(),
    activatedByUserId:KpiWorkflowState.user.uid, updatedAt:serverTimestamp()
  });
  await audit('ACTIVATE_PERIOD',{periodId});
  closeModal(); await loadAll(); openPeriodManager();
}

async function completePeriodById(periodId) {
  if (!activeRole('ADMIN')) return;
  if (!confirm(`Kết thúc kỳ ${periodId}? Sau khi kết thúc, nhiệm vụ mới sẽ không được gắn vào kỳ này.`)) return;
  await updateDoc(doc(db,'evaluationPeriods',periodId), { active:false, status:'COMPLETED', completedAt:serverTimestamp(), completedByUserId:KpiWorkflowState.user.uid, updatedAt:serverTimestamp() });
  await audit('COMPLETE_PERIOD',{periodId});
  closeModal(); await loadAll(); openPeriodManager();
}

async function readProfile(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

function activePeriod(period) {
  return (
    period?.active === true ||
    clean(period?.status).toUpperCase() === 'ACTIVE'
  ) && clean(period?.status).toUpperCase() !== 'DELETED';
}

function scopedQueryFor(collectionName, periodId) {
  const reference = collection(db, collectionName);
  const uid = KpiWorkflowState.user?.uid || '';
  const departmentId = normalizeDepartment(
    KpiWorkflowState.profile?.departmentId
  );

  if (globalRole()) {
    return query(
      reference,
      where('periodId', '==', periodId)
    );
  }

  if (isLeader()) {
    const departmentField = {
      tasks: 'primaryDepartmentId',
      taskRegistrations: 'departmentId',
      taskEvaluations: 'departmentId',
      commonCriteriaAssessments: 'departmentId'
    }[collectionName];

    if (!departmentField || !departmentId) {
      throw new Error(
        'Không xác định được phạm vi Phòng/Khu của tài khoản.'
      );
    }

    return query(
      reference,
      where('periodId', '==', periodId),
      where(departmentField, '==', departmentId)
    );
  }

  const ownerField = {
    tasks: 'ownerUserId',
    taskRegistrations: 'userId',
    taskEvaluations: 'ownerUserId',
    commonCriteriaAssessments: 'userId'
  }[collectionName];

  if (!ownerField || !uid) {
    throw new Error(
      'Không xác định được phạm vi cá nhân của tài khoản.'
    );
  }

  return query(
    reference,
    where('periodId', '==', periodId),
    where(ownerField, '==', uid)
  );
}

function kpiLoadErrorMessage(error) {
  const code = clean(error?.code);
  const detail = clean(error?.message);

  if (code === 'permission-denied') {
    return 'Tài khoản hiện tại chưa được phép đọc một phần dữ liệu KPI theo phạm vi được phân quyền.';
  }

  if (code === 'failed-precondition' && /index/i.test(detail)) {
    return 'Hệ thống chưa hoàn tất cấu hình truy vấn dữ liệu. Vui lòng liên hệ người quản trị.';
  }

  return detail || 'Không tải được dữ liệu KPI.';
}

async function loadAll() {
  if (!KpiWorkflowState.user || !KpiWorkflowState.profile) return;

  try {
    message('Đang tải dữ liệu kỳ đánh giá...');

    const periodSnap = await getDocs(collection(db, 'evaluationPeriods'));
    KpiWorkflowState.periods = periodSnap.docs.map(periodDoc => ({
      id: periodDoc.id,
      ...periodDoc.data()
    }));

    KpiWorkflowState.period =
      KpiWorkflowState.periods.find(activePeriod) ||
      (
        activeRole('ADMIN')
          ? KpiWorkflowState.periods
              .filter(period => clean(period.status).toUpperCase() === 'COMPLETED')
              .sort((a, b) =>
                clean(b.endDate).localeCompare(clean(a.endDate))
              )[0]
          : null
      ) ||
      null;

    if (!KpiWorkflowState.period) {
      KpiWorkflowState.users = [];
      KpiWorkflowState.tasks = [];
      KpiWorkflowState.registrations = [];
      KpiWorkflowState.evaluations = [];
      KpiWorkflowState.commonAll = [];
      KpiWorkflowState.common = null;
      KpiWorkflowState.plan = null;

      render();

      message(
        activeRole('ADMIN')
          ? 'Chưa có kỳ đánh giá đang hoạt động. Admin hãy tạo hoặc kích hoạt một kỳ.'
          : 'Chưa có kỳ đánh giá đang hoạt động.'
      );
      return;
    }

    const periodId = KpiWorkflowState.period.id;
    const departmentId = normalizeDepartment(
      KpiWorkflowState.profile.departmentId
    );

    const [
      usersSnap,
      tasksSnap,
      registrationsSnap,
      evaluationsSnap,
      commonAllSnap,
      planSnap
    ] = await Promise.all([
      getDocs(collection(db, 'users')),
      getDocs(scopedQueryFor('tasks', periodId)),
      getDocs(scopedQueryFor('taskRegistrations', periodId)),
      getDocs(scopedQueryFor('taskEvaluations', periodId)),
      getDocs(scopedQueryFor('commonCriteriaAssessments', periodId)),
      getDoc(doc(db, 'kpiPlans', `${periodId}_${departmentId}`))
    ]);

    KpiWorkflowState.users = usersSnap.docs.map(userDoc => ({
      id: userDoc.id,
      ...userDoc.data()
    }));

    KpiWorkflowState.tasks = tasksSnap.docs.map(taskDoc => ({
      id: taskDoc.id,
      ...taskDoc.data()
    }));

    KpiWorkflowState.registrations = registrationsSnap.docs.map(
      registrationDoc => ({
        id: registrationDoc.id,
        ...registrationDoc.data()
      })
    );

    KpiWorkflowState.evaluations = evaluationsSnap.docs.map(
      evaluationDoc => ({
        id: evaluationDoc.id,
        ...evaluationDoc.data()
      })
    );

    KpiWorkflowState.commonAll = commonAllSnap.docs.map(commonDoc => ({
      id: commonDoc.id,
      ...commonDoc.data()
    }));

    KpiWorkflowState.common =
      KpiWorkflowState.commonAll.find(
        item => item.userId === KpiWorkflowState.user.uid
      ) || null;

    KpiWorkflowState.plan = planSnap.exists()
      ? { id: planSnap.id, ...planSnap.data() }
      : null;

    render();
    message('Thông tin KPI đã được cập nhật.', 'ok');
    const requestedTaskId=sessionStorage.getItem('kpiSelfAssessmentTaskId');
    if(requestedTaskId){sessionStorage.removeItem('kpiSelfAssessmentTaskId');const requested=KpiWorkflowState.tasks.find(t=>t.id===requestedTaskId&&t.ownerUserId===KpiWorkflowState.user.uid);if(requested)setTimeout(()=>openSelfAssessment(requestedTaskId),80);}
  } catch (error) {
    console.error('KPI loadAll error:', {
      code: error?.code,
      message: error?.message,
      stack: error?.stack,
      profile: {
        uid: KpiWorkflowState.user?.uid || '',
        role: KpiWorkflowState.profile?.role || '',
        departmentId: KpiWorkflowState.profile?.departmentId || ''
      },
      periodId: KpiWorkflowState.period?.id || ''
    });

    message(kpiLoadErrorMessage(error));
  }
}

function taskForCurrentUser(task) {
  if (globalRole()) return true;
  if (isLeader()) return sameDepartment(task);
  return task.ownerUserId === KpiWorkflowState.user.uid || task.createdByUserId === KpiWorkflowState.user.uid;
}
function evaluationFor(taskId){ return KpiWorkflowState.evaluations.find(e => e.taskId === taskId); }
function evaluationScore(ev) {
  if (!ev) return { score: 0, confirmed: false, available: false };
  if (ev.status === 'CONFIRMED' && Number.isFinite(Number(ev.confirmedActualScore))) {
    return { score: Number(ev.confirmedActualScore || 0), confirmed: true, available: true };
  }
  if (Number.isFinite(Number(ev.selfActualScore))) {
    return { score: Number(ev.selfActualScore || 0), confirmed: false, available: true };
  }
  return { score: 0, confirmed: false, available: false };
}
function recognizedRowsForUser() {
  return KpiWorkflowState.tasks.filter(t => t.ownerUserId === KpiWorkflowState.user.uid).map(t => {
    const ev = evaluationFor(t.id);
    const scored = evaluationScore(ev);
    return {
      ...t,
      recognized: scored.available,
      confirmedActualScore: scored.score,
      scoreIsConfirmed: scored.confirmed,
      includedInA: t.includedInA === true
    };
  });
}
function summary() {
  const rows = recognizedRowsForUser();
  const result = calculateKpiSummary(rows, Number(KpiWorkflowState.common?.confirmedTotal ?? KpiWorkflowState.common?.selfTotal ?? 0));
  const scored = rows.filter(row => row.recognized === true);
  result.confirmedTaskCount = scored.filter(row => row.scoreIsConfirmed === true).length;
  result.provisionalTaskCount = scored.filter(row => row.scoreIsConfirmed !== true).length;
  result.hasProvisional = result.provisionalTaskCount > 0;
  return result;
}

function render() {
  const periodLine = el('kpiPeriodLine');
  if (periodLine) periodLine.innerHTML = KpiWorkflowState.period ? `
    <span class="kpi-chip">${esc(KpiWorkflowState.period.name || KpiWorkflowState.period.id)}</span>
    <span class="kpi-chip">${dateVi(KpiWorkflowState.period.startDate)} – ${dateVi(KpiWorkflowState.period.endDate)}</span>
    <span class="kpi-chip">${KpiWorkflowState.period.status === 'COMPLETED' ? 'Đã kết thúc' : 'Đang hoạt động'}</span>
    <span class="kpi-chip">Kế hoạch: ${KpiWorkflowState.plan?.locked === true ? 'Đã khóa' : 'Chưa khóa'}</span>` : '<span class="kpi-chip">Chưa có kỳ hoạt động</span>';
  const s = summary();
  el('kpiMetricA').textContent = fmt(s.A);
  el('kpiMetricB').textContent = fmt(s.B);
  if (el('kpiMetricBStatus')) el('kpiMetricBStatus').textContent = s.hasProvisional ? 'Tạm tính theo tự đánh giá; chờ xác nhận' : (s.confirmedTaskCount ? 'Đã xác nhận' : 'Chưa có nhiệm vụ được chấm');
  el('kpiMetric70').textContent = `${fmt(s.kpi70)}/70`;
  el('kpiMetric30').textContent = `${fmt(s.common30)}/30`;
  el('kpiMetric100').textContent = `${fmt(s.total100)}/100`;
  el('kpiPeriodAdmin')?.classList.toggle('kpi-hidden', !activeRole('ADMIN'));
  el('kpiLockPlan')?.classList.toggle('kpi-hidden', !(isDepartmentHead() || activeRole('ADMIN')));
  if(KpiWorkflowState.mode==='plans') renderPlanDashboard();
  else if(KpiWorkflowState.mode==='evaluations') renderEvaluationDashboard();
  else renderReportDashboard();
}

function visiblePeople(){
  const all=[...KpiWorkflowState.users].filter(u=>u.active===true);
  if(globalRole()) return all;
  if(isLeader()) return all.filter(u=>normalizeDepartment(u.departmentId)===normalizeDepartment(KpiWorkflowState.profile.departmentId));
  return all.filter(u=>u.id===KpiWorkflowState.user.uid);
}
function rowsForPerson(uid){return KpiWorkflowState.tasks.filter(t=>t.ownerUserId===uid&&t.active!==false);}
function regsForPerson(uid){return KpiWorkflowState.registrations.filter(r=>r.userId===uid&&r.active!==false);}

function personSummary(uid){
  const regs=regsForPerson(uid);
  const tasks=rowsForPerson(uid);
  const approved=tasks.filter(t=>t.includedInA===true);
  const pending=regs.filter(r=>r.status==='PENDING');
  const rejected=regs.filter(r=>r.status==='REJECTED');
  const completed=tasks.filter(t=>['HOAN_THANH','COMPLETED','DA_HOAN_THANH'].includes(clean(t.status).toUpperCase()) || t.completedAt);
  const evaluated=completed.filter(t=>evaluationFor(t.id));
  const confirmed=evaluated.filter(t=>evaluationFor(t.id)?.status==='CONFIRMED');
  return {
    regs,tasks,approved,pending,rejected,completed,evaluated,confirmed,
    A:round2(approved.reduce((sum,t)=>sum+Number(t.maximumConvertedScore||0),0))
  };
}

function renderPlanDashboard(){
  const target=el('kpiTaskList');
  if(!target)return;
  el('kpiMainCardTitle').textContent='Kế hoạch KPI';
  el('kpiMainCardHint').textContent='Màn hình tổng hợp theo cá nhân. Chọn Chi tiết để xem kế hoạch, nhiệm vụ và thực hiện chấm điểm.';

  const people=visiblePeople()
    .filter(u=>{
      const x=personSummary(u.id);
      return u.id===KpiWorkflowState.user.uid || x.regs.length || x.tasks.length;
    })
    .sort((a,b)=>clean(a.fullName||a.email).localeCompare(clean(b.fullName||b.email),'vi'));

  const pendingReview=KpiWorkflowState.evaluations
    .filter(ev=>['PENDING_REVIEW','NEEDS_REVISION'].includes(ev.status))
    .map(ev=>({ev,task:KpiWorkflowState.tasks.find(t=>t.id===ev.taskId)}))
    .filter(x=>canReviewEvaluation(x.ev,x.task));
  const pendingCommon=KpiWorkflowState.commonAll.filter(item=>item.userId!==KpiWorkflowState.user.uid && item.status==='SELF_COMPLETED' &&
    ((isDepartmentHead() && normalizeDepartment(item.departmentId)===normalizeDepartment(KpiWorkflowState.profile.departmentId)) || globalRole()));
  const ownSummary=personSummary(KpiWorkflowState.user.uid);
  const ownPendingSelf=ownSummary.completed.filter(t=>!evaluationFor(t.id));
  const commonStatus=KpiWorkflowState.common?.status==='CONFIRMED'?'Đã xác nhận':KpiWorkflowState.common?'Chờ xác nhận':'Chưa tự chấm';

  const personRows=people.map((u,index)=>{
    const x=personSummary(u.id);
    const owner=u.id===KpiWorkflowState.user.uid;
    const common=KpiWorkflowState.commonAll.find(item=>item.userId===u.id);
    const commonLabel=common?.status==='CONFIRMED'?'30 điểm đã xác nhận':common?'30 điểm chờ xác nhận':'Chưa tự chấm 30 điểm';
    return `<article class="kpi-person-summary-row">
      <div class="kpi-person-order">${index+1}</div>
      <div class="kpi-person-identity"><strong>${esc(u.fullName||u.email||u.id)}</strong><small>${esc(u.position||'')}</small></div>
      <div class="kpi-person-summary-metrics">
        <span><b>${x.approved.length}</b> đã duyệt</span>
        <span><b>A: ${fmt(x.A)}</b></span>
        ${x.pending.length?`<span class="warning"><b>${x.pending.length}</b> chờ duyệt</span>`:''}
        ${x.rejected.length?`<span class="danger"><b>${x.rejected.length}</b> đã trả lại</span>`:''}
        <span>${esc(commonLabel)}</span>
      </div>
      <button class="kpi-button secondary" data-person-detail="${esc(u.id)}">${owner?'Chi tiết kế hoạch':'Chi tiết'}</button>
    </article>`;
  }).join('');

  target.innerHTML=`
    <div class="kpi-overview-grid compact">
      <article class="kpi-action-panel"><span class="kpi-action-icon">⭐</span><div><strong>Tự đánh giá nhiệm vụ</strong><p>${ownPendingSelf.length?`${ownPendingSelf.length} nhiệm vụ cần tự đánh giá`:'Không có nhiệm vụ đang chờ tự đánh giá'}</p></div>${ownPendingSelf.length?'<button class="kpi-button" data-open-my-plan>Thực hiện</button>':''}</article>
      <article class="kpi-action-panel"><span class="kpi-action-icon">✍️</span><div><strong>Tiêu chí chung 30 điểm</strong><p>${esc(commonStatus)}</p></div><button class="kpi-button secondary" data-open-common>${KpiWorkflowState.common?'Cập nhật':'Tự chấm'}</button></article>
      ${(isLeader()||globalRole())?`<article class="kpi-action-panel"><span class="kpi-action-icon">✅</span><div><strong>Chờ xác nhận</strong><p>${pendingReview.length} nhiệm vụ · ${pendingCommon.length} phiếu tiêu chí chung</p></div><button class="kpi-button" data-open-review>Xem danh sách</button></article>`:''}
    </div>
    <section class="kpi-section-block kpi-plan-directory">
      <div class="kpi-section-title"><div><h4>Kế hoạch KPI</h4><p>${isLeader()||globalRole()?'Danh sách cá nhân thuộc phạm vi quản lý.':'Kế hoạch của tài khoản đang đăng nhập.'}</p></div></div>
      <div class="kpi-person-summary-list">${personRows||'<div class="kpi-empty">Chưa có kế hoạch trong kỳ.</div>'}</div>
    </section>`;

  target.querySelectorAll('[data-person-detail]').forEach(b=>b.addEventListener('click',()=>openPersonPlanDetail(b.dataset.personDetail)));
  target.querySelector('[data-open-my-plan]')?.addEventListener('click',()=>openPersonPlanDetail(KpiWorkflowState.user.uid));
  target.querySelector('[data-open-common]')?.addEventListener('click',openCommonCriteria);
  target.querySelector('[data-open-review]')?.addEventListener('click',openReviewCenter);
}

function planRowStatus(reg,task){
  if(reg?.status==='PENDING') return 'Chờ duyệt';
  if(reg?.status==='REJECTED') return 'Đã trả lại';
  if(task?.planApprovalStatus==='APPROVED'||reg?.status==='APPROVED') return 'Đã duyệt';
  return taskStatus(task||{},evaluationFor(task?.id));
}

function openPlanTaskDetail(taskId){
  const task=KpiWorkflowState.tasks.find(t=>t.id===taskId);
  if(!task)return;
  const ev=evaluationFor(task.id);
  const own=task.ownerUserId===KpiWorkflowState.user.uid;
  if(own && (task.status==='HOAN_THANH'||task.completedAt)) return openSelfAssessment(task.id);
  if(canReviewEvaluation(ev,task)) return openReview(ev.id);
  return openTaskInfo(task.id);
}

async function cancelRegistrationFromPlan(regId, root){
  const reg=KpiWorkflowState.registrations.find(r=>r.id===regId);
  if(!reg)return;
  const title=reg.status==='REJECTED'?'Hủy đăng ký để chọn lại':'Hủy đăng ký đang chờ duyệt';
  const message=reg.status==='REJECTED'
    ? 'Đăng ký bị trả lại sẽ được xóa. Đầu việc chuẩn không bị xóa và sẽ xuất hiện lại trong Danh mục công việc để bạn chọn, đăng ký lại.'
    : 'Đăng ký đang chờ duyệt sẽ được xóa. Đầu việc chuẩn không bị xóa và bạn có thể chọn đầu việc khác.';
  if(!confirm(`${title}?\n\n${message}`))return;
  try{
    await TaskRegistrationService.cancelRegistration(reg);
    closeModal();
    await loadAll();
    openPersonPlanDetail(KpiWorkflowState.user.uid);
  }catch(error){alert(error.message||'Không hủy được đăng ký.');}
}

function openPersonPlanDetail(uid){
  const user=KpiWorkflowState.users.find(u=>u.id===uid)||{id:uid,fullName:'Cá nhân'};
  const owner=uid===KpiWorkflowState.user.uid;
  const regs=regsForPerson(uid);
  const tasks=rowsForPerson(uid);
  const pending=regs.filter(r=>r.status==='PENDING');
  const rejected=regs.filter(r=>r.status==='REJECTED');
  const can=pending.some(canApproveRegistration);

  const currentItems=[];
  regs.filter(r=>r.status!=='REJECTED').forEach(r=>{
    const task=tasks.find(t=>t.id===r.taskId)||null;
    currentItems.push({reg:r,task});
  });
  tasks.filter(t=>!regs.some(r=>r.taskId===t.id)).forEach(task=>currentItems.push({reg:null,task}));

  const currentRows=currentItems.map(({reg,task},index)=>{
    const ev=task?evaluationFor(task.id):null;
    const score=ev?evaluationScore(ev):{available:false};
    return `<tr>
      <td class="center">${index+1}</td>
      <td><button class="kpi-link-button" type="button" ${task?`data-task-score="${esc(task.id)}"`:''}><strong>${esc(reg?.standardTaskCode||task?.taskCode||'')}</strong><br>${esc(reg?.standardTaskName||task?.title||'')}</button></td>
      <td class="center">${fmt(reg?.maximumConvertedScore??task?.maximumConvertedScore)}</td>
      <td><span class="kpi-status">${esc(planRowStatus(reg,task))}</span>${score.available?`<br><small>B: ${fmt(score.score)} · ${score.confirmed?'Đã xác nhận':'Tạm tính'}</small>`:''}</td>
      <td class="kpi-row-actions">
        ${reg?.status==='PENDING'&&canApproveRegistration(reg)?`<input type="checkbox" data-reg-review value="${esc(reg.id)}" checked aria-label="Chọn duyệt">`:''}
        ${owner&&reg?.status==='PENDING'&&!reg.taskId?`<button class="kpi-button danger ghost" type="button" data-cancel-registration="${esc(reg.id)}">Hủy đăng ký</button>`:''}
        ${task?`<button class="kpi-button secondary" type="button" data-task-score="${esc(task.id)}">Xem / chấm điểm</button>`:''}
      </td>
    </tr>`;
  }).join('');

  const rejectedRows=rejected.map((reg,index)=>`<tr>
    <td class="center">${index+1}</td>
    <td><strong>${esc(reg.standardTaskCode||'')}</strong><br>${esc(reg.standardTaskName||reg.title||'')}</td>
    <td>${esc(reg.rejectionReason||'Không có lý do.')}</td>
    <td>${esc(reg.rejectedByName||'')}</td>
    <td>${owner?`<button class="kpi-button danger ghost" type="button" data-cancel-registration="${esc(reg.id)}">Hủy đăng ký để chọn lại</button>`:'<span class="kpi-status danger">Đã trả lại</span>'}</td>
  </tr>`).join('');

  const root=modal(`Kế hoạch của ${user.fullName||''}`,`
    <div class="kpi-person-detail-summary"><span>${currentItems.length} đầu việc hiện tại</span><span>${pending.length} chờ duyệt</span><span>${rejected.length} đã trả lại</span></div>
    <div class="kpi-modal-tabs">
      <button class="kpi-button secondary active" data-plan-tab="current">Kế hoạch hiện tại (${currentItems.length})</button>
      <button class="kpi-button secondary" data-plan-tab="rejected">Đã trả lại (${rejected.length})</button>
    </div>
    <div data-plan-panel="current">
      ${currentRows?`<div class="kpi-table-wrap"><table class="kpi-table compact-table"><thead><tr><th>STT</th><th>Đầu việc</th><th>Điểm A</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>${currentRows}</tbody></table></div>`:'<div class="kpi-empty">Chưa có đầu việc hiện tại.</div>'}
    </div>
    <div class="kpi-hidden" data-plan-panel="rejected">
      <div class="kpi-note">Hủy đăng ký chỉ xóa bản đăng ký bị trả lại; đầu việc chuẩn vẫn được giữ nguyên để đăng ký lại.</div>
      ${rejectedRows?`<div class="kpi-table-wrap"><table class="kpi-table compact-table"><thead><tr><th>STT</th><th>Đầu việc</th><th>Lý do trả lại</th><th>Người trả lại</th><th>Thao tác</th></tr></thead><tbody>${rejectedRows}</tbody></table></div>`:'<div class="kpi-empty">Không có đầu việc đã trả lại.</div>'}
    </div>`,
    can?'<button class="kpi-button secondary" data-kpi-close>Đóng</button><button id="regRejectSelected" class="kpi-button danger">Trả lại mục đã chọn</button><button id="regApproveSelected" class="kpi-button">Duyệt mục đã chọn</button>':'<button class="kpi-button secondary" data-kpi-close>Đóng</button>');

  root.querySelectorAll('[data-plan-tab]').forEach(btn=>btn.addEventListener('click',()=>{
    root.querySelectorAll('[data-plan-tab]').forEach(x=>x.classList.toggle('active',x===btn));
    root.querySelectorAll('[data-plan-panel]').forEach(x=>x.classList.toggle('kpi-hidden',x.dataset.planPanel!==btn.dataset.planTab));
  }));
  root.querySelectorAll('[data-task-score]').forEach(btn=>btn.addEventListener('click',()=>openPlanTaskDetail(btn.dataset.taskScore)));
  root.querySelectorAll('[data-cancel-registration]').forEach(btn=>btn.addEventListener('click',()=>cancelRegistrationFromPlan(btn.dataset.cancelRegistration,root)));
  root.querySelector('#regApproveSelected')?.addEventListener('click',async()=>{
    const ids=[...root.querySelectorAll('[data-reg-review]:checked')].map(x=>x.value);
    const selected=pending.filter(r=>ids.includes(r.id));
    if(!selected.length)return alert('Chưa chọn đầu việc để duyệt.');
    await TaskRegistrationService.approveMany(selected,{periodEndDate:KpiWorkflowState.period?.endDate});
    closeModal();await loadAll();openPersonPlanDetail(uid);
  });
  root.querySelector('#regRejectSelected')?.addEventListener('click',async()=>{
    const ids=[...root.querySelectorAll('[data-reg-review]:checked')].map(x=>x.value);
    const selected=pending.filter(r=>ids.includes(r.id));
    if(!selected.length)return alert('Chưa chọn đầu việc để trả lại.');
    const reason=clean(prompt('Nhập lý do trả lại:')||'');
    if(!reason)return alert('Phải nhập lý do trả lại.');
    await TaskRegistrationService.rejectMany(selected,reason);
    closeModal();await loadAll();openPersonPlanDetail(uid);
  });
}

function renderEvaluationDashboard(){
  const target=el('kpiTaskList');if(!target)return;
  el('kpiMainCardTitle').textContent='Đánh giá nhiệm vụ đã hoàn thành';
  el('kpiMainCardHint').textContent='Trạng thái Hoàn thành luôn tương ứng 100% khối lượng công việc. Tỷ lệ tiến độ KPI được hệ thống tính riêng theo số ngày làm việc chậm; chất lượng do cá nhân đề xuất và cấp có thẩm quyền xác nhận.';
  const rows=KpiWorkflowState.tasks.filter(taskForCurrentUser).filter(t=>t.status==='HOAN_THANH');
  if(!rows.length){target.innerHTML='<div class="kpi-empty">Chưa có nhiệm vụ hoàn thành để đánh giá.</div>';return;}
  target.innerHTML=`<div class="kpi-table-wrap"><table class="kpi-table"><thead><tr><th>Nhiệm vụ</th><th>Người thực hiện</th><th>Tiến độ KPI</th><th>Chất lượng</th><th>Điểm thực tế B</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>${rows.map(t=>{const ev=evaluationFor(t.id),own=t.ownerUserId===KpiWorkflowState.user.uid;const timing=progressRateFromDates(t.deadline,t.completedAt,true,KpiWorkflowState.holidays);const score=evaluationScore(ev);return `<tr><td><strong>${esc(t.taskCode||'')}</strong><br>${esc(t.title||'')}</td><td>${esc(t.ownerName||'')}</td><td><strong>${timing}%</strong><br><span class="kpi-small">Tự động theo hạn và ngày hoàn thành</span></td><td>${ev?.confirmedResultRate??ev?.selfResultRate??'—'}%</td><td><strong>${score.available?fmt(score.score):'—'}</strong><br><span class="kpi-small">${score.confirmed?'Đã xác nhận':score.available?'Tạm tính':'Chưa tự đánh giá'}</span></td><td>${esc(taskStatus(t,ev))}</td><td>${own?`<button class="kpi-button" data-kpi-self="${t.id}">${ev?'Cập nhật tự đánh giá':'Tự đánh giá'}</button>`:canReviewEvaluation(ev,t)?`<button class="kpi-button" data-kpi-review="${ev?.id||''}">Xác nhận</button>`:'Chỉ xem'}</td></tr>`;}).join('')}</tbody></table></div>`;
  target.addEventListener('click',taskAction);target.addEventListener('click',reviewAction);
}
function renderReportDashboard(){
  const target=el('kpiTaskList');if(!target)return;
  el('kpiMainCardTitle').textContent='Báo cáo KPI';
  el('kpiMainCardHint').textContent='Mẫu 01 cá nhân và danh sách chi tiết phục vụ cuộc họp đánh giá.';
  const s=summary();
  target.innerHTML=`<div class="kpi-metrics"><div class="kpi-metric"><span>A · Kế hoạch</span><strong>${fmt(s.A)}</strong></div><div class="kpi-metric"><span>B · Thực tế</span><strong>${fmt(s.B)}</strong></div><div class="kpi-metric"><span>KPI công việc</span><strong>${fmt(s.kpi70)}/70</strong></div><div class="kpi-metric"><span>Tiêu chí chung</span><strong>${fmt(s.common30)}/30</strong></div><div class="kpi-metric"><span>Tổng điểm</span><strong>${fmt(s.total100)}/100</strong></div></div>
  <div class="kpi-report-actions"><button id="reportPersonal" class="kpi-report-choice"><span>📄</span><strong>Mẫu 01 cá nhân</strong><small>Hiển thị đầy đủ từng nhiệm vụ tại phần B.</small></button>${isLeader()||globalRole()?'<button id="reportMeeting" class="kpi-report-choice"><span>👥</span><strong>Danh sách phục vụ cuộc họp</strong><small>Tổng hợp nhân sự, đầu việc và điểm chấm.</small></button>':''}</div>`;
  el('reportPersonal')?.addEventListener('click',()=>openReport(KpiWorkflowState.user.uid));
  el('reportMeeting')?.addEventListener('click',openMeetingReport);
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
    const canApprove = isLeader() && sameDepartment(task) && task.planApprovalStatus === 'PENDING_APPROVAL' && KpiWorkflowState.plan?.locked !== true;
    const canSelf = task.ownerUserId === KpiWorkflowState.user.uid && task.planApprovalStatus === 'APPROVED' && KpiWorkflowState.period.status !== 'COMPLETED';
    return `<tr><td><strong>${esc(task.taskCode || task.standardTaskCode || task.id)}</strong><br>${esc(task.title)}<br><span class="kpi-small">${esc(task.ownerName || 'Chờ phân công')}</span></td>
      <td><span class="kpi-status">${esc(taskStatus(task,ev))}</span><br><span class="kpi-small">${task.includedInA === true ? 'Thuộc A' : (task.planType === 'DOT_XUAT' ? 'Đột xuất · không tăng A' : 'Chưa vào A')}</span>${task.isCoreTask === true ? '<br><strong>⭐ Cốt lõi</strong>' : ''}</td>
      <td>${fmt(task.maximumConvertedScore)}</td>
      <td>${ev ? `Tự chấm: ${fmt(ev.selfActualScore)}<br>Xác nhận: ${fmt(ev.confirmedActualScore)}` : 'Chưa đánh giá'}</td>
      <td><div class="kpi-actions">${canApprove ? `<button class="kpi-button secondary" data-kpi-approve-plan="${task.id}">Duyệt vào kế hoạch</button><button class="kpi-button danger" data-kpi-reject-plan="${task.id}">Trả lại</button>` : ''}${canSelf ? `<button class="kpi-button" data-kpi-self="${task.id}">${ev ? 'Cập nhật tự đánh giá' : 'Tự đánh giá'}</button>` : ''}<button class="kpi-button secondary" data-kpi-view="${task.id}">Chi tiết</button></div></td></tr>`;
  }).join('')}</tbody></table></div>`;
}

function canReviewEvaluation(ev, task) {
  if (!ev || !task || ev.ownerUserId === KpiWorkflowState.user.uid) return false;
  if (globalRole()) {
    if (KpiWorkflowState.profile.role === 'DIRECTOR') return !ev.reviewerEmail || clean(KpiWorkflowState.profile.email).toLowerCase() === clean(ev.reviewerEmail).toLowerCase();
    return true;
  }
  return isLeader() && sameDepartment(task) && (KpiWorkflowState.users.find(u => u.id === ev.ownerUserId)?.role === 'STAFF');
}
function groupPendingRegistrations() {
  const visible = KpiWorkflowState.registrations.filter(r => {
    if (r.status !== 'PENDING') return false;
    if (activeRole('ADMIN')) return true;
    if (activeRole('DIRECTOR')) return r.userRole === 'DEPARTMENT_LEADER' && reviewerEmailMatches(r);
    if (isLeader()) return sameDepartment(r) && r.userRole === 'STAFF';
    return false;
  });
  const groups = new Map();
  visible.forEach(r => {
    const key = r.userId || r.userName;
    if (!groups.has(key)) groups.set(key, { userId:r.userId, userName:r.userName, userPosition:r.userPosition, userRole:r.userRole, items:[] });
    groups.get(key).items.push(r);
  });
  return [...groups.values()];
}

function renderReviews() {
  const target = el('kpiReviewList');
  if (!target) return;
  const groups = groupPendingRegistrations();
  const pending = KpiWorkflowState.evaluations.filter(ev => ['PENDING_REVIEW','NEEDS_REVISION'].includes(ev.status)).map(ev => ({ ev, task:KpiWorkflowState.tasks.find(t=>t.id===ev.taskId) })).filter(x => canReviewEvaluation(x.ev,x.task));
  const pendingCommon = KpiWorkflowState.commonAll.filter(item => item.userId !== KpiWorkflowState.user.uid && item.status === 'SELF_COMPLETED' && ((isDepartmentHead() && normalizeDepartment(item.departmentId) === normalizeDepartment(KpiWorkflowState.profile.departmentId)) || globalRole()));
  if (!groups.length && !pending.length && !pendingCommon.length) { target.innerHTML = '<div class="kpi-empty">Không có hồ sơ chờ xử lý.</div>'; return; }
  const groupHtml = groups.map(group => `<article class="registration-person-card"><div><strong>${esc(group.userName || 'Người đăng ký')}</strong><small>${esc(group.userPosition || '')}</small><span>${group.items.length} đầu việc chờ duyệt</span></div><div class="kpi-actions">${group.items.some(canApproveRegistration) ? `<button class="kpi-button" data-registration-group="${esc(group.userId)}">Xem chi tiết</button>` : '<span class="kpi-status">Chỉ xem</span>'}</div></article>`).join('');
  target.innerHTML = `${groupHtml}${pendingCommon.map(item=>`<div class="kpi-alert"><strong>Chờ xác nhận Mẫu 01 · 30 điểm</strong><br>${esc(item.fullName)} · Tự chấm ${fmt(item.selfTotal)}/30<div class="kpi-actions"><button class="kpi-button" data-kpi-review-common="${item.id}">Mở xác nhận</button></div></div>`).join('')}${pending.map(({ev,task})=>`<div class="kpi-alert ${ev.status==='NEEDS_REVISION'?'':'kpi-ok'}"><strong>${ev.status==='NEEDS_REVISION'?'Đang yêu cầu bổ sung':'Chờ xác nhận điểm'}</strong><br>${esc(task?.ownerName)} · ${esc(task?.title)}<div class="kpi-actions"><button class="kpi-button" data-kpi-review="${ev.id}">Mở xác nhận</button></div></div>`).join('')}`;
}

function openReviewCenter(){
  if(!(isLeader()||globalRole())) return;
  const pending=KpiWorkflowState.evaluations.filter(ev=>['PENDING_REVIEW','NEEDS_REVISION'].includes(ev.status)).map(ev=>({ev,task:KpiWorkflowState.tasks.find(t=>t.id===ev.taskId)})).filter(x=>canReviewEvaluation(x.ev,x.task));
  const pendingCommon=KpiWorkflowState.commonAll.filter(item=>item.userId!==KpiWorkflowState.user.uid && item.status==='SELF_COMPLETED' && ((isDepartmentHead()&&normalizeDepartment(item.departmentId)===normalizeDepartment(KpiWorkflowState.profile.departmentId))||globalRole()));
  const users=new Map();
  pending.forEach(x=>{const uid=x.ev.ownerUserId;if(!users.has(uid))users.set(uid,{uid,name:x.ev.ownerName||x.task?.ownerName||'Cá nhân',tasks:[],common:null});users.get(uid).tasks.push(x);});
  pendingCommon.forEach(c=>{if(!users.has(c.userId))users.set(c.userId,{uid:c.userId,name:c.fullName||'Cá nhân',tasks:[],common:null});users.get(c.userId).common=c;});
  const rows=[...users.values()];
  const root=modal('Xác nhận kết quả sau cuộc họp', rows.length?`<p class="kpi-small">Chọn các cá nhân đã được cuộc họp thống nhất. Hệ thống giữ nguyên mức tự chấm khi xác nhận hàng loạt; trường hợp cần điều chỉnh mở xác nhận riêng.</p><div class="registration-modal-tools"><button id="reviewSelectAll" class="kpi-button secondary" type="button">Chọn tất cả</button><button id="reviewClearAll" class="kpi-button secondary" type="button">Bỏ chọn</button></div><div class="kpi-table-wrap"><table class="kpi-table"><thead><tr><th>Chọn</th><th>Họ và tên</th><th>Nhiệm vụ chờ xác nhận</th><th>Tiêu chí chung</th><th>Thao tác riêng</th></tr></thead><tbody>${rows.map(r=>`<tr><td><input type="checkbox" data-bulk-user value="${esc(r.uid)}" checked></td><td><strong>${esc(r.name)}</strong></td><td>${r.tasks.length}</td><td>${r.common?`${fmt(r.common.selfTotal)}/30`:'—'}</td><td>${r.tasks[0]?`<button class="kpi-button secondary" data-kpi-review="${esc(r.tasks[0].ev.id)}">Mở xác nhận</button>`:r.common?`<button class="kpi-button secondary" data-kpi-review-common="${esc(r.common.id)}">Mở xác nhận</button>`:'—'}</td></tr>`).join('')}</tbody></table></div>`:'<div class="kpi-empty">Không có kết quả chờ xác nhận.</div>', rows.length?'<button class="kpi-button secondary" data-kpi-close type="button">Đóng</button><button id="bulkConfirmMeeting" class="kpi-button" type="button">Xác nhận kết quả đã thống nhất</button>':'<button class="kpi-button secondary" data-kpi-close type="button">Đóng</button>');
  root.querySelector('#reviewSelectAll')?.addEventListener('click',()=>root.querySelectorAll('[data-bulk-user]').forEach(x=>x.checked=true));
  root.querySelector('#reviewClearAll')?.addEventListener('click',()=>root.querySelectorAll('[data-bulk-user]').forEach(x=>x.checked=false));
  root.addEventListener('click',reviewAction);
  root.querySelector('#bulkConfirmMeeting')?.addEventListener('click',async()=>{const ids=[...root.querySelectorAll('[data-bulk-user]:checked')].map(x=>x.value);if(!ids.length)return alert('Chưa chọn cá nhân để xác nhận.');if(!confirm(`Xác nhận kết quả của ${ids.length} cá nhân theo mức đã tự chấm và đã được cuộc họp thống nhất?`))return;const btn=root.querySelector('#bulkConfirmMeeting');btn.disabled=true;btn.textContent='Đang xác nhận...';try{for(const uid of ids){const row=users.get(uid);for(const {ev,task} of row.tasks){const p=Number(ev.selfProgressRate||0),r=Number(ev.selfResultRate||0);const x=calculateTaskScore(task.baseScore,task.difficultyCoefficient,p,r);await updateDoc(doc(db,'taskEvaluations',ev.id),{confirmedProgressRate:p,confirmedResultRate:r,confirmedExecutionScore:x.execution,confirmedActualScore:x.actual,reviewerComment:'Xác nhận theo kết quả cuộc họp.',status:'CONFIRMED',scoreLocked:true,reviewedByUserId:KpiWorkflowState.user.uid,reviewedByName:KpiWorkflowState.profile.fullName||'',confirmedAt:serverTimestamp(),updatedAt:serverTimestamp()});await updateDoc(doc(db,'tasks',task.id),{scoringStatus:'CONFIRMED',scoreLocked:true,confirmedActualScore:x.actual,updatedAt:serverTimestamp()});}if(row.common){const items=(row.common.items||[]).map(i=>({...i,confirmedResult:i.selfResult,confirmedScore:Number(i.selfScore||0),confirmedNote:i.note||''}));await updateDoc(doc(db,'commonCriteriaAssessments',row.common.id),{items,confirmedTotal:Number(row.common.selfTotal||0),status:'CONFIRMED',confirmedByUserId:KpiWorkflowState.user.uid,confirmedByName:KpiWorkflowState.profile.fullName||'',confirmedAt:serverTimestamp(),updatedAt:serverTimestamp()});}}await audit('BULK_CONFIRM_AFTER_MEETING',{userIds:ids,count:ids.length});closeModal();await loadAll();}catch(error){alert(error?.message||'Không xác nhận được kết quả.');btn.disabled=false;btn.textContent='Xác nhận kết quả đã thống nhất';}});
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
  if (!task || !isLeader() || !sameDepartment(task) || KpiWorkflowState.plan?.locked === true) return;
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
  if(!task||!isLeader()||!sameDepartment(task)||KpiWorkflowState.plan?.locked===true)return;
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
  const progress = progressRateFromDates(task.deadline, task.completedAt, task.status === 'HOAN_THANH', KpiWorkflowState.holidays);
  const qualityOptions = [
    [100, '100% — Hoàn thành đầy đủ mục tiêu; đạt chất lượng, không phải chỉnh sửa hoặc chỉ chỉnh sửa không đáng kể'],
    [80, '80% — Hoàn thành mục tiêu; cần chỉnh sửa, bổ sung một số nội dung nhỏ trước khi ban hành'],
    [60, '60% — Hoàn thành cơ bản; cần chỉnh sửa, bổ sung đáng kể nhưng không vượt quá 50% nội dung'],
    [0, '0% — Không đạt yêu cầu; phải thực hiện lại hoặc chỉnh sửa, bổ sung trên 50% nội dung']
  ];
  modal('Tự đánh giá nhiệm vụ', `<form id="kpiSelfForm" class="kpi-form-grid">
    <div class="kpi-field full"><strong>${esc(task.taskCode || '')} — ${esc(task.title)}</strong><span>Điểm tối đa: ${fmt(task.maximumConvertedScore)} · Minh chứng bắt buộc: ${esc(task.standardTaskMandatoryEvidence || task.mandatoryEvidence || 'Theo nhiệm vụ')}</span></div>
    <div class="kpi-field"><label>Mức hoàn thành tiến độ KPI</label><div class="kpi-fixed-rate"><strong>${progress}%</strong><span>${progress===100?'Đúng hạn hoặc trước hạn':progress===80?'Chậm 01–03 ngày làm việc':progress===60?'Chậm 04–05 ngày làm việc':'Chậm trên 05 ngày làm việc hoặc không hoàn thành'}</span></div><small>Hệ thống tự tính từ hạn hoàn thành và ngày hoàn thành thực tế; không nhập bằng tay.</small></div>
    <div class="kpi-field"><label>Mức hoàn thành kết quả/chất lượng</label><select id="kpiSelfResult">${qualityOptions.map(([r,label])=>`<option value="${r}" ${Number(ev.selfResultRate??100)===r?'selected':''}>${label}</option>`).join('')}</select><small>Cá nhân đề xuất; cấp có thẩm quyền xác nhận.</small></div>
    <div class="kpi-field full"><label>Nhận xét kết quả, thành tích và hạn chế</label><textarea id="kpiSelfComment" rows="5" required>${esc(ev.selfComment || '')}</textarea></div>
    <div class="kpi-field full"><label class="kpi-checkbox-line"><input id="kpiExceeded" type="checkbox" ${ev.isExceededRequirement===true?'checked':''}> Đề nghị ghi nhận hoàn thành vượt mức yêu cầu</label><textarea id="kpiExceededText" rows="3" placeholder="Nêu rõ sản phẩm, khối lượng, chất lượng hoặc giá trị bổ sung...">${esc(ev.exceededRequirementDescription || '')}</textarea></div>
    <div class="kpi-field full"><div id="kpiSelfScore" class="kpi-alert"></div></div>
  </form>`, '<button class="kpi-button secondary" data-kpi-close type="button">Hủy</button><button id="kpiSubmitSelf" class="kpi-button" type="button">Gửi xác nhận</button>');
  const recalc=()=>{ const x=calculateTaskScore(task.baseScore,task.difficultyCoefficient,progress,el('kpiSelfResult').value); el('kpiSelfScore').textContent=`Điểm thực tế B tạm tính: ${fmt(x.actual)}/${fmt(x.maximum)} (Tiến độ 30% + Chất lượng 70%)`; };
  el('kpiSelfResult').addEventListener('change',recalc); recalc();
  el('kpiSubmitSelf').addEventListener('click', async()=>{
    const comment=clean(el('kpiSelfComment').value); if(!comment){alert('Vui lòng nhập nhận xét.');return;}
    const result=Number(el('kpiSelfResult').value);
    const score=calculateTaskScore(task.baseScore,task.difficultyCoefficient,progress,result);
    const reviewer=reviewerForOwner(KpiWorkflowState.user.uid);
    const exceeded=el('kpiExceeded').checked, exceededText=clean(el('kpiExceededText').value);
    if(exceeded && !exceededText){alert('Vui lòng nêu căn cứ vượt mức yêu cầu.');return;}
    await setDoc(doc(db,'taskEvaluations',`${KpiWorkflowState.period.id}_${task.id}`),{
      periodId:KpiWorkflowState.period.id, taskId:task.id, taskCode:task.taskCode||'', ownerUserId:KpiWorkflowState.user.uid, ownerName:KpiWorkflowState.profile.fullName||'', ownerRole:KpiWorkflowState.profile.role||'', departmentId:KpiWorkflowState.profile.departmentId||'',
      selfProgressRate:progress,selfResultRate:result,selfExecutionScore:score.execution,selfActualScore:score.actual,selfComment:comment,
      confirmedProgressRate:null,confirmedResultRate:null,confirmedActualScore:null,reviewerEmail:reviewer.email,reviewerUserId:reviewer.uid,reviewerName:reviewer.name,
      isExceededRequirement:exceeded,exceededRequirementDescription:exceededText,status:'PENDING_REVIEW',formulaVersion:'QĐ366_30_70_V2',updatedAt:serverTimestamp(),createdAt:ev.createdAt||serverTimestamp()
    },{merge:true});
    await audit('SUBMIT_SELF_ASSESSMENT',{taskId, selfActualScore:score.actual, progressRate:progress, resultRate:result}); closeModal(); await loadAll();
  });
}

function openReview(evalId) {
  const ev=KpiWorkflowState.evaluations.find(e=>e.id===evalId); const task=KpiWorkflowState.tasks.find(t=>t.id===ev?.taskId); if(!ev||!task||!canReviewEvaluation(ev,task))return;
  const progress=progressRateFromDates(task.deadline,task.completedAt,task.status==='HOAN_THANH',KpiWorkflowState.holidays);
  const rates=[100,80,60,0];
  modal('Xác nhận điểm nhiệm vụ', `<form class="kpi-form-grid"><div class="kpi-field full"><strong>${esc(task.ownerName)} · ${esc(task.title)}</strong><span>Tự chấm: tiến độ ${progress}%, chất lượng ${ev.selfResultRate}%, điểm ${fmt(ev.selfActualScore)}</span></div>
    <div class="kpi-field"><label>Tiến độ xác nhận</label><div class="kpi-fixed-rate"><strong>${progress}%</strong><span>Tự động theo hạn và ngày hoàn thành thực tế</span></div></div>
    <div class="kpi-field"><label>Chất lượng xác nhận</label><select id="kpiConfirmResult">${rates.map(r=>`<option value="${r}" ${Number(ev.confirmedResultRate??ev.selfResultRate)===r?'selected':''}>${r}%</option>`).join('')}</select></div>
    <div class="kpi-field full"><label>Nhận xét/căn cứ</label><textarea id="kpiReviewerComment" rows="4">${esc(ev.reviewerComment||'')}</textarea></div><div class="kpi-field full"><div id="kpiConfirmScore" class="kpi-alert"></div></div></form>`,
    '<button id="kpiNeedRevision" class="kpi-button secondary" type="button">Yêu cầu bổ sung</button><button class="kpi-button secondary" data-kpi-close type="button">Hủy</button><button id="kpiConfirmEvaluation" class="kpi-button" type="button">Xác nhận điểm</button>');
  const recalc=()=>{const x=calculateTaskScore(task.baseScore,task.difficultyCoefficient,progress,el('kpiConfirmResult').value);el('kpiConfirmScore').textContent=`Điểm B xác nhận: ${fmt(x.actual)}/${fmt(x.maximum)}`;};
  el('kpiConfirmResult').addEventListener('change',recalc);recalc();
  el('kpiNeedRevision').addEventListener('click',async()=>{const note=clean(el('kpiReviewerComment').value);if(!note){alert('Nhập nội dung cần bổ sung.');return;}await updateDoc(doc(db,'taskEvaluations',ev.id),{status:'NEEDS_REVISION',reviewerComment:note,reviewedByUserId:KpiWorkflowState.user.uid,reviewedByName:KpiWorkflowState.profile.fullName||'',updatedAt:serverTimestamp()});closeModal();await loadAll();});
  el('kpiConfirmEvaluation').addEventListener('click',async()=>{const r=Number(el('kpiConfirmResult').value),note=clean(el('kpiReviewerComment').value);if(r!==Number(ev.selfResultRate)&&!note){alert('Khi điều chỉnh chất lượng khác tự chấm phải nhập lý do.');return;}const x=calculateTaskScore(task.baseScore,task.difficultyCoefficient,progress,r);await updateDoc(doc(db,'taskEvaluations',ev.id),{confirmedProgressRate:progress,confirmedResultRate:r,confirmedExecutionScore:x.execution,confirmedActualScore:x.actual,reviewerComment:note,status:'CONFIRMED',scoreLocked:true,reviewedByUserId:KpiWorkflowState.user.uid,reviewedByName:KpiWorkflowState.profile.fullName||'',confirmedAt:serverTimestamp(),updatedAt:serverTimestamp()});await updateDoc(doc(db,'tasks',task.id),{scoringStatus:'CONFIRMED',scoreLocked:true,confirmedActualScore:x.actual,updatedAt:serverTimestamp()});await audit('CONFIRM_TASK_SCORE',{taskId:task.id,confirmedActualScore:x.actual,progressRate:progress,resultRate:r});closeModal();await loadAll();});
}

function openTaskInfo(taskId){const t=KpiWorkflowState.tasks.find(x=>x.id===taskId),e=evaluationFor(taskId);if(!t)return;modal('Chi tiết KPI nhiệm vụ',`<div class="kpi-form-grid"><div class="kpi-field full"><strong>${esc(t.taskCode||'')} — ${esc(t.title)}</strong></div><div class="kpi-field"><label>Người thực hiện</label><span>${esc(t.ownerName||'Chờ phân công')}</span></div><div class="kpi-field"><label>Trạng thái kế hoạch</label><span>${esc(taskStatus(t,e))}</span></div><div class="kpi-field"><label>Điểm chuẩn</label><span>${fmt(t.baseScore)}</span></div><div class="kpi-field"><label>Hệ số</label><span>${fmt(t.difficultyCoefficient)}</span></div><div class="kpi-field"><label>Điểm tối đa</label><span>${fmt(t.maximumConvertedScore)}</span></div><div class="kpi-field"><label>Cốt lõi</label><span>${t.isCoreTask===true?'Có':'Không'}</span></div><div class="kpi-field full"><label>Minh chứng bắt buộc</label><span>${esc(t.standardTaskMandatoryEvidence||'—')}</span></div></div>`);}

function openCommonCriteria(){
  if(!KpiWorkflowState.period)return;const items=KpiWorkflowState.common?.items||[];modal('Mẫu 01 · Nhóm tiêu chí chung 30 điểm',`<div class="kpi-criteria-list">${COMMON_CRITERIA.map(c=>{const v=items.find(x=>x.code===c.code)||{};return `<div class="kpi-criterion"><strong>${c.code}<br>${c.max} điểm</strong><p>${esc(c.text)}</p><div><select data-common-code="${c.code}"><option value="DAM_BAO" ${v.selfResult!=='KHONG_DAM_BAO'?'selected':''}>Đảm bảo</option><option value="KHONG_DAM_BAO" ${v.selfResult==='KHONG_DAM_BAO'?'selected':''}>Không đảm bảo</option></select><textarea data-common-note="${c.code}" rows="2" placeholder="Ghi chú/căn cứ">${esc(v.note||'')}</textarea></div></div>`;}).join('')}</div><div id="kpiCommonTotal" class="kpi-alert"></div>`, '<button class="kpi-button secondary" data-kpi-close type="button">Hủy</button><button id="kpiSaveCommon" class="kpi-button" type="button">Lưu tự đánh giá</button>');
  const calc=()=>{let total=0;COMMON_CRITERIA.forEach(c=>{if(document.querySelector(`[data-common-code="${c.code}"]`)?.value==='DAM_BAO')total+=c.max;});el('kpiCommonTotal').textContent=`Tổng điểm tiêu chí chung: ${total}/30`;return total;};document.querySelectorAll('[data-common-code]').forEach(x=>x.addEventListener('change',calc));calc();
  el('kpiSaveCommon').addEventListener('click',async()=>{const data=COMMON_CRITERIA.map(c=>{const result=document.querySelector(`[data-common-code="${c.code}"]`).value;const note=clean(document.querySelector(`[data-common-note="${c.code}"]`).value);if(result==='KHONG_DAM_BAO'&&!note)throw new Error(`Tiêu chí ${c.code} không đảm bảo phải có căn cứ.`);return {code:c.code,max:c.max,text:c.text,selfResult:result,selfScore:result==='DAM_BAO'?c.max:0,note};});try{const total=data.reduce((s,x)=>s+x.selfScore,0);await setDoc(doc(db,'commonCriteriaAssessments',`${KpiWorkflowState.period.id}_${KpiWorkflowState.user.uid}`),{periodId:KpiWorkflowState.period.id,userId:KpiWorkflowState.user.uid,fullName:KpiWorkflowState.profile.fullName||'',departmentId:KpiWorkflowState.profile.departmentId||'',items:data,selfTotal:total,confirmedTotal:total,status:'SELF_COMPLETED',updatedAt:serverTimestamp(),createdAt:KpiWorkflowState.common?.createdAt||serverTimestamp()},{merge:true});await audit('SAVE_COMMON_CRITERIA',{score:total});closeModal();await loadAll();}catch(err){alert(err.message);}});
}

function openCommonReview(assessmentId) {
  const assessment = KpiWorkflowState.commonAll.find(item => item.id === assessmentId);
  if (!assessment || assessment.userId === KpiWorkflowState.user.uid) return;
  const owner = KpiWorkflowState.users.find(user => user.id === assessment.userId);
  const allowed = globalRole() || (isLeader() && normalizeDepartment(assessment.departmentId) === normalizeDepartment(KpiWorkflowState.profile.departmentId) && owner?.role === 'STAFF');
  if (!allowed) return;
  const items = assessment.items || [];
  modal('Xác nhận Mẫu 01 · 30 điểm', `<p><strong>${esc(assessment.fullName)}</strong> · Tự chấm ${fmt(assessment.selfTotal)}/30</p><div class="kpi-criteria-list">${COMMON_CRITERIA.map(c=>{const v=items.find(x=>x.code===c.code)||{};const confirmed=v.confirmedResult||v.selfResult||'DAM_BAO';return `<div class="kpi-criterion"><strong>${c.code}<br>${c.max} điểm</strong><p>${esc(c.text)}<br><span class="kpi-small">Cá nhân: ${v.selfResult==='KHONG_DAM_BAO'?'Không đảm bảo':'Đảm bảo'}</span></p><div><select data-confirm-common-code="${c.code}"><option value="DAM_BAO" ${confirmed==='DAM_BAO'?'selected':''}>Đảm bảo</option><option value="KHONG_DAM_BAO" ${confirmed==='KHONG_DAM_BAO'?'selected':''}>Không đảm bảo</option></select><textarea data-confirm-common-note="${c.code}" rows="2" placeholder="Căn cứ khi điều chỉnh">${esc(v.confirmedNote||v.note||'')}</textarea></div></div>`;}).join('')}</div><div id="kpiConfirmCommonTotal" class="kpi-alert"></div>`, '<button class="kpi-button secondary" data-kpi-close type="button">Hủy</button><button id="kpiConfirmCommonSave" class="kpi-button" type="button">Xác nhận 30 điểm</button>');
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

async function lockDepartmentPlan(){if(!KpiWorkflowState.period||!isLeader())return;if(KpiWorkflowState.plan?.locked===true){alert('Kế hoạch Phòng/Khu đã khóa.');return;}const dept=normalizeDepartment(KpiWorkflowState.profile.departmentId);const approved=KpiWorkflowState.tasks.filter(t=>normalizeDepartment(t.primaryDepartmentId)===dept&&t.planApprovalStatus==='APPROVED'&&t.includedInA===true);const A=round2(approved.reduce((s,t)=>s+Number(t.maximumConvertedScore||0),0));if(!approved.length){alert('Chưa có nhiệm vụ kế hoạch được duyệt.');return;}if(!confirm(`Khóa kế hoạch ${dept} với A = ${fmt(A)}? Sau khi khóa, bổ sung/thay đổi phải thực hiện bằng điều chỉnh.`))return;await setDoc(doc(db,'kpiPlans',`${KpiWorkflowState.period.id}_${dept}`),{periodId:KpiWorkflowState.period.id,departmentId:dept,locked:true,planMaximumScore:A,taskIds:approved.map(t=>t.id),lockedByUserId:KpiWorkflowState.user.uid,lockedByName:KpiWorkflowState.profile.fullName||'',lockedAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:true});await audit('LOCK_DEPARTMENT_PLAN',{departmentId:dept,A});await loadAll();}

function initializePilotPeriod(){
  if(!activeRole('ADMIN')) return;
  const next = nextQuarterDefaults();
  modal('Tạo kỳ đánh giá', `<form id="kpiPeriodForm" class="kpi-form-grid">
    <div class="kpi-field"><label>Mã kỳ</label><input id="kpiPeriodIdInput" value="${esc(next.id)}" required></div>
    <div class="kpi-field"><label>Tên kỳ</label><input id="kpiPeriodNameInput" value="${esc(next.name)}" required></div>
    <div class="kpi-field"><label>Từ ngày</label><input id="kpiPeriodStartInput" type="date" value="${next.start}" required></div>
    <div class="kpi-field"><label>Đến ngày</label><input id="kpiPeriodEndInput" type="date" value="${next.end}" required></div>
    <div class="kpi-field full"><label class="kpi-checkbox-line"><input id="kpiPeriodPilotInput" type="checkbox" checked> Kỳ vận hành thử</label><span>Hệ thống không tự khóa kế hoạch theo ngày. Trưởng phòng/Khu chủ động khóa sau khi rà soát.</span></div>
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
    autoLockPlan:false,pilotMode:el('kpiPeriodPilotInput').checked,status:'ACTIVE',active:true,
    createdByUserId:KpiWorkflowState.user.uid,createdByName:KpiWorkflowState.profile.fullName||'',createdAt:serverTimestamp(),updatedAt:serverTimestamp()
  },{merge:false});
  await audit('CREATE_PERIOD',{periodId,startDate,endDate});
  closeModal(); await loadAll();
}
async function completePeriod(){if(!activeRole('ADMIN')||!KpiWorkflowState.period)return;if(!confirm('Xác nhận đã in và lưu hồ sơ giấy, sau đó kết thúc kỳ?'))return;await updateDoc(doc(db,'evaluationPeriods',KpiWorkflowState.period.id),{status:'COMPLETED',active:false,completedByUserId:KpiWorkflowState.user.uid,completedAt:serverTimestamp(),updatedAt:serverTimestamp()});await audit('COMPLETE_PERIOD',{periodId:KpiWorkflowState.period.id});await loadAll();}

async function deleteDocsByPeriod(collectionName, periodId) {
  const snap = await getDocs(query(collection(db,collectionName),where('periodId','==',periodId)));
  for (const item of snap.docs) await deleteDoc(item.ref);
  return snap.size;
}
async function deletePeriodById(periodId){
  if(!activeRole('ADMIN'))return;
  const period=KpiWorkflowState.periods.find(p=>p.id===periodId);
  const code=prompt(`XÓA VĨNH VIỄN kỳ “${period?.name||periodId}”.
Nhập chính xác: XOA VINH VIEN ${periodId}`);
  if(code!==`XOA VINH VIEN ${periodId}`){alert('Mã xác nhận không đúng.');return;}
  if(!confirm('Thao tác này xóa toàn bộ nhiệm vụ, đăng ký, đánh giá, kế hoạch và nhật ký thuộc kỳ. Dữ liệu không thể khôi phục.'))return;
  message('Đang xóa toàn bộ dữ liệu của kỳ...');
  let count=0;
  const taskSnap=await getDocs(query(collection(db,'tasks'),where('periodId','==',periodId)));
  const taskIds=taskSnap.docs.map(d=>d.id);
  for(const taskId of taskIds){
    const logs=await getDocs(query(collection(db,'taskLogs'),where('taskId','==',taskId)));
    for(const item of logs.docs){await deleteDoc(item.ref);count++;}
  }
  for(const name of ['taskEvaluations','commonCriteriaAssessments','kpiPlans','kpiProfiles','kpiAdjustments','taskRegistrations','kpiAuditLogs','kpiDeletionLogs']){
    count+=await deleteDocsByPeriod(name,periodId);
  }
  for(const item of taskSnap.docs){await deleteDoc(item.ref);count++;}
  await deleteDoc(doc(db,'evaluationPeriods',periodId)); count++;
  closeModal();
  await loadAll();
  alert(`Đã xóa vĩnh viễn ${count} dữ liệu thuộc kỳ ${periodId}.`);
}
async function deletePeriodData(){
  if(!KpiWorkflowState.period)return;
  return deletePeriodById(KpiWorkflowState.period.id);
}

function summaryForUser(uid){
  const rows=KpiWorkflowState.tasks.filter(t=>t.ownerUserId===uid).map(t=>{
    const ev=evaluationFor(t.id);
    const sc=evaluationScore(ev);
    return {...t,recognized:sc.available,confirmedActualScore:Number(sc.score||0),includedInA:t.includedInA===true,scoreIsConfirmed:sc.confirmed};
  });
  const common=KpiWorkflowState.commonAll.find(x=>x.userId===uid);
  const result=calculateKpiSummary(rows,Number(common?.confirmedTotal??common?.selfTotal??0));
  result.hasProvisional=rows.some(r=>r.recognized&&r.scoreIsConfirmed!==true)||Boolean(common&&common.status!=='CONFIRMED');
  return {result,common};
}

function openReport(uid=KpiWorkflowState.user.uid) {
  if (!KpiWorkflowState.period) return;
  const person=KpiWorkflowState.users.find(u=>u.id===uid)||KpiWorkflowState.profile;
  const mine=KpiWorkflowState.tasks.filter(t=>t.ownerUserId===uid);
  const {result:s,common}=summaryForUser(uid);
  const rating=ratingName(proposedRating(s.total100));
  const now=new Date();
  const quarter=KpiWorkflowState.period.quarter||(clean(KpiWorkflowState.period.id).match(/Q([1-4])/)?.[1]||'…');
  const year=KpiWorkflowState.period.year||clean(KpiWorkflowState.period.startDate).slice(0,4)||now.getFullYear();
  const criteriaRows=COMMON_CRITERIA.map(c=>{const x=common?.items?.find(i=>i.code===c.code)||{};const result=x.confirmedResult||x.selfResult||'';const score=result==='DAM_BAO'?c.max:result==='KHONG_DAM_BAO'?0:'';return `<tr><td class="center">${c.code}</td><td>${esc(c.text)}</td><td class="center">${result==='DAM_BAO'?'X':''}</td><td class="center">${result==='KHONG_DAM_BAO'?'X':''}</td><td class="center">${c.max}</td><td class="center">${score}</td><td>${esc(x.confirmedNote||x.note||'')}</td></tr>`;}).join('');
  const taskRows=mine.map((t,i)=>{const e=evaluationFor(t.id)||{};const progress=progressRateFromDates(t.deadline,t.completedAt,t.status==='HOAN_THANH',KpiWorkflowState.holidays);const scored=evaluationScore(e);return `<tr><td class="center">${i+1}</td><td>${esc(t.taskCode||'')}<br>${esc(t.title||'')}</td><td class="center">${fmt(t.maximumConvertedScore)}</td><td class="center">${progress}%</td><td class="center">${e.confirmedResultRate??e.selfResultRate??'—'}%</td><td class="center">${scored.available?fmt(scored.score):'—'}</td><td>${scored.confirmed?'Đã xác nhận':scored.available?'Tạm tính, chờ xác nhận':'Chưa tự đánh giá'}${e.reviewerComment||e.selfComment?`<br>${esc(e.reviewerComment||e.selfComment)}`:''}</td></tr>`;}).join('');
  const html=`<div id="kpiPdfPreview" class="kpi-report kpi-report-print"><section class="mau01-page">
  <div class="mau01-top"><div><strong>TRUNG TÂM<br>BẢO TRỢ XÃ HỘI TÂN HIỆP</strong><div>*</div></div><div><strong>ĐẢNG CỘNG SẢN VIỆT NAM</strong><div class="mau01-underline"></div><em>Đồng Nai, ngày ${String(now.getDate()).padStart(2,'0')} tháng ${String(now.getMonth()+1).padStart(2,'0')} năm ${now.getFullYear()}</em></div></div>
  <div class="mau01-code">Mẫu 01</div><h1>BẢN TỰ ĐÁNH GIÁ, XẾP LOẠI CỦA CÁ NHÂN</h1><h2>Quý ${esc(quarter)}, Năm ${esc(year)}</h2>
  <div class="mau01-info"><p><strong>Họ và tên:</strong> ${esc(person.fullName||'')} &nbsp;&nbsp; <strong>Ngày sinh:</strong> ${esc(person.birthDate||person.dateOfBirth||'')}</p><p><strong>Chức vụ Đảng:</strong> ${esc(person.partyPosition||'')}</p><p><strong>Chức vụ chính quyền:</strong> ${esc(person.governmentPosition||person.position||'')}</p><p><strong>Chức vụ đoàn thể:</strong> ${esc(person.unionPosition||'')}</p><p><strong>Đơn vị công tác:</strong> ${esc(person.departmentName||person.departmentId||'')}</p></div>
  <h3 class="mau01-section-title">I. Tự đánh giá kết quả thực hiện nhiệm vụ</h3><p>Trên cơ sở nhiệm vụ được giao, cá nhân tự đánh giá về kết quả thực hiện nhiệm vụ theo quý như sau:</p>
  <table class="mau01-table"><thead><tr><th colspan="7" class="left">A. NHÓM TIÊU CHÍ CHUNG (30 ĐIỂM)</th></tr><tr><th>TT</th><th>Tiêu chí / Nội dung</th><th>Đảm bảo</th><th>Không đảm bảo</th><th>Điểm tối đa</th><th>Điểm đạt</th><th>Ghi chú</th></tr></thead><tbody>${criteriaRows}<tr class="total-row"><td colspan="4">TỔNG (A)</td><td>30</td><td>${fmt(s.common30)}</td><td></td></tr></tbody></table>
  <table class="mau01-table mau01-b"><thead><tr><th colspan="7" class="left">B. KẾT QUẢ THỰC HIỆN NHIỆM VỤ ĐƯỢC GIAO (70 ĐIỂM)</th></tr><tr><th>STT</th><th>Nội dung nhiệm vụ</th><th>Điểm tối đa</th><th>Tiến độ KPI</th><th>Chất lượng</th><th>Điểm đạt</th><th>Trạng thái / Ghi chú</th></tr></thead><tbody>${taskRows||'<tr><td colspan="7" class="center">Chưa có nhiệm vụ trong kỳ</td></tr>'}<tr class="total-row"><td colspan="2">TỔNG ĐIỂM NHIỆM VỤ</td><td>${fmt(s.A)}</td><td colspan="2"></td><td>${fmt(s.B)}</td><td>${s.hasProvisional?'Có điểm tạm tính chưa xác nhận':'Điểm đã xác nhận'}</td></tr><tr class="total-row"><td colspan="2">ĐIỂM KPI QUY ĐỔI</td><td colspan="3">MIN[(B thực tế / A kế hoạch) × 70; 70]</td><td>${fmt(s.kpi70)}/70</td><td>A = ${fmt(s.A)}; B = ${fmt(s.B)}</td></tr><tr class="total-row"><td colspan="2">TỔNG (A + B)</td><td colspan="3">100</td><td>${fmt(s.total100)}</td><td></td></tr></tbody></table>
  <h3 class="mau01-section-title">II. Tự đề xuất xếp loại mức chất lượng: <span class="dotted">${esc(rating)}</span></h3><p class="mau01-note">Kết quả cuối cùng do cấp có thẩm quyền xem xét, quyết định.</p><div class="mau01-sign-one"><strong>CÁ NHÂN TỰ ĐÁNH GIÁ</strong><br><em>(Ký, ghi rõ họ tên)</em><div class="signature-space"></div><strong>${esc(person.fullName||'')}</strong></div>
  <h3 class="mau01-section-title">III. Nhận xét, đánh giá của cấp có thẩm quyền</h3><p>- Chấm điểm: ....................................................................................................................................</p><p>- Đề xuất xếp loại: ...........................................................................................................................</p><div class="mau01-sign-authority"><strong>XÁC NHẬN CỦA CẤP CÓ THẨM QUYỀN</strong><br><em>(Ký, ghi rõ họ tên và đóng dấu)</em></div></section></div>`;
  modal('Xem trước Mẫu 01',html,'<button class="kpi-button secondary" data-kpi-close type="button">Đóng</button><button id="kpiPrintReport" class="kpi-button" type="button">🖨️ In Mẫu 01</button>');
  el('kpiPrintReport')?.addEventListener('click',()=>window.print());
}

function openMeetingReport(){
  const people=visiblePeople().filter(u=>{const x=personSummary(u.id);return x.tasks.length||x.regs.length;});
  const rows=people.map((u,personIndex)=>{
    const tasks=rowsForPerson(u.id);
    const {result:s}=summaryForUser(u.id);
    const taskLines=tasks.map((t,i)=>{const ev=evaluationFor(t.id)||{};const sc=evaluationScore(ev);const progress=progressRateFromDates(t.deadline,t.completedAt,t.status==='HOAN_THANH',KpiWorkflowState.holidays);return `<tr><td class="center">${i===0?personIndex+1:''}</td><td>${i===0?`<strong>${esc(u.fullName||'')}</strong><br>${esc(u.position||'')}`:''}</td><td>${esc(t.taskCode||'')}<br>${esc(t.title||'')}</td><td class="center">${fmt(t.maximumConvertedScore)}</td><td class="center">${progress}%</td><td class="center">${ev.confirmedResultRate??ev.selfResultRate??'—'}%</td><td class="center">${sc.available?fmt(sc.score):'—'}</td><td>${sc.confirmed?'Đã xác nhận':sc.available?'Chờ xác nhận':'Chưa tự chấm'}</td></tr>`;}).join('');
    return `${taskLines}<tr class="total-row"><td colspan="3">Tổng ${esc(u.fullName||'')}</td><td>${fmt(s.A)}</td><td colspan="2">Tiêu chí chung: ${fmt(s.common30)}/30</td><td>${fmt(s.B)}</td><td>KPI: ${fmt(s.kpi70)}/70 · Tổng: ${fmt(s.total100)}/100</td></tr>`;
  }).join('');
  const html=`<div class="meeting-report kpi-report-print"><h1>DANH SÁCH ĐÁNH GIÁ KPI PHỤC VỤ CUỘC HỌP</h1><h2>${esc(KpiWorkflowState.period?.name||'')}</h2><table class="mau01-table"><thead><tr><th>STT</th><th>Họ và tên</th><th>Mã/Tên nhiệm vụ</th><th>Điểm tối đa</th><th>Tiến độ</th><th>Chất lượng</th><th>Điểm B</th><th>Trạng thái</th></tr></thead><tbody>${rows||'<tr><td colspan="8" class="center">Chưa có dữ liệu</td></tr>'}</tbody></table></div>`;
  modal('Danh sách phục vụ cuộc họp',html,'<button class="kpi-button secondary" data-kpi-close>Đóng</button><button id="printMeetingReport" class="kpi-button">🖨️ In danh sách</button>');
  el('printMeetingReport')?.addEventListener('click',()=>window.print());
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

window.KPI2c = window.KPI2C;

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
