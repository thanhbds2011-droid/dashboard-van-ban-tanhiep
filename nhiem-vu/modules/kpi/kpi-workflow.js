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
  delegations: []
};

const el = (id) => document.getElementById(id);
const clean = (value) => String(value ?? '').trim();
const esc = (value) => clean(value).replace(/[&<>'"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const fmt = (n) => Number(n || 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 });
const dateVi = (key) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean(key)); return m ? `${m[3]}/${m[2]}/${m[1]}` : clean(key); };
const normalizeDepartment = (value) => clean(value).toUpperCase();
const activeRole = (...roles) => KpiWorkflowState.profile?.active === true && roles.includes(KpiWorkflowState.profile?.role);
const globalRole = () => activeRole('ADMIN','DIRECTOR','TCHC_COORDINATOR') || (isLeader() && normalizeDepartment(KpiWorkflowState.profile?.departmentId) === 'TCHC');
const isLeader = () => activeRole('DEPARTMENT_LEADER');
const isStaff = () => activeRole('STAFF');
const isDeputyLeader = () => isLeader() && /ph[oó]\s*trưởng|ph[oó]\s*phòng|ph[oó]\s*khu/i.test(clean(KpiWorkflowState.profile?.position));
const isDepartmentHead = () => isLeader() && !isDeputyLeader();
const reviewerEmailMatches = (registration) => !clean(registration?.reviewerEmail) || clean(registration.reviewerEmail).toLowerCase() === clean(KpiWorkflowState.profile?.email).toLowerCase();
const hasActiveApprovalDelegation = () => {
  const today = new Date().toISOString().slice(0,10);
  return KpiWorkflowState.delegations.some(d => d.active === true && d.delegateUserId === KpiWorkflowState.user?.uid && normalizeDepartment(d.departmentId) === normalizeDepartment(KpiWorkflowState.profile?.departmentId) && (!d.startDate || d.startDate <= today) && (!d.endDate || d.endDate >= today));
};
const canApproveRegistration = (registration) => {
  if (!registration || registration.status !== 'PENDING') return false;
  if (activeRole('ADMIN')) return true;
  if (registration.userRole === 'DEPARTMENT_LEADER') {
    const deputy=/ph[oó]\s*(trưởng|phòng|khu)/i.test(clean(registration.userPosition));
    // Phó Trưởng phòng do Trưởng phòng duyệt. Trưởng phòng được tự động duyệt ngay khi đăng ký.
    if (deputy) return (isDepartmentHead() || hasActiveApprovalDelegation()) && sameDepartment(registration) && registration.userId !== KpiWorkflowState.user.uid;
    return false;
  }
  return (isDepartmentHead() || hasActiveApprovalDelegation()) && sameDepartment(registration);
};
const sameDepartment = (data) => normalizeDepartment(data?.departmentId || data?.primaryDepartmentId) === normalizeDepartment(KpiWorkflowState.profile?.departmentId);

function mount() {
  const section = el('kpiSection');
  if (!section) return;
  const mode = KpiWorkflowState.mode || 'plans';
  const heading = mode === 'evaluations' ? 'Đánh giá và xác nhận kết quả' : mode === 'reports' ? 'Báo cáo đánh giá' : 'Kế hoạch KPI';
  const description = mode === 'evaluations' ? 'Tự đánh giá nhiệm vụ hoàn thành, xác nhận điểm và Mẫu 01.' : mode === 'reports' ? 'Xem trước báo cáo cá nhân, báo cáo Phòng/Khu và bảng tổng hợp.' : 'Đăng ký, duyệt và khóa kế hoạch công việc trong kỳ.';
  section.innerHTML = `
    <div class="kpi-header">
      <div>
        <h2>${heading}</h2>
        <p>${description}</p>
        <div id="kpiPeriodLine" class="kpi-period-line"></div>
      </div>
      <div class="kpi-actions kpi-no-print">
        <button id="kpiRefresh" class="kpi-button secondary" type="button">↻ Cập nhật</button>
        <button id="kpiOpenReport" class="kpi-button" type="button">🧾 Xem trước báo cáo</button>
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
    <div class="kpi-toolbar kpi-no-print" data-mode-toolbar>
      <button id="kpiCommonButton" class="kpi-button secondary" type="button">✍️ Mẫu 01 · 30 điểm</button>
      <button id="kpiLockPlan" class="kpi-button secondary" type="button">🔒 Khóa kế hoạch Phòng/Khu</button>
      <button id="kpiDelegateApproval" class="kpi-button secondary" type="button">👥 Ủy quyền duyệt</button>
      <button id="kpiUnlockPlan" class="kpi-button secondary" type="button">🔓 Mở khóa kế hoạch</button>
      <button id="kpiPeriodAdmin" class="kpi-button secondary" type="button">⚙️ Quản lý kỳ</button>
      <span class="kpi-small">Kế hoạch chỉ hình thành A sau khi được duyệt. Trưởng phòng chủ động khóa, hệ thống không tự khóa theo ngày.</span>
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
    el('kpiCommonButton')?.classList.add('kpi-hidden');
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
  el('kpiDelegateApproval')?.addEventListener('click', openDelegationManager);
  el('kpiUnlockPlan')?.addEventListener('click', unlockDepartmentPlan);
  el('kpiPeriodAdmin')?.addEventListener('click', openPeriodManager);
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
  if (!activeRole('ADMIN')) return;
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
  if (!activeRole('ADMIN')) return;
  if (KpiWorkflowState.periods.some(period => period.active === true && period.id !== periodId)) return alert('Đang có một kỳ hoạt động. Hãy kết thúc kỳ đó trước.');
  await updateDoc(doc(db,'evaluationPeriods',periodId), { active:true, status:'ACTIVE', activatedAt:serverTimestamp(), activatedByUserId:KpiWorkflowState.user.uid, updatedAt:serverTimestamp() });
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

async function loadAll() {
  if (!KpiWorkflowState.user || !KpiWorkflowState.profile) return;
  try {
    message('Đang tải dữ liệu kỳ đánh giá...');
    const periodSnap = await getDocs(collection(db, 'evaluationPeriods'));
    KpiWorkflowState.periods = periodSnap.docs.map(d => ({ id:d.id, ...d.data() }));
    KpiWorkflowState.period = KpiWorkflowState.periods.find(p => p.active === true && p.status !== 'DELETED')
      || (activeRole('ADMIN') ? KpiWorkflowState.periods.filter(p => p.status === 'COMPLETED').sort((a,b) => clean(b.endDate).localeCompare(clean(a.endDate)))[0] : null)
      || null;
    if (!KpiWorkflowState.period) {
      render();
      message(activeRole('ADMIN') ? 'Chưa có kỳ đánh giá đang hoạt động. Vui lòng tạo hoặc kích hoạt một kỳ đánh giá.' : 'Chưa có kỳ đánh giá đang hoạt động.');
      return;
    }
    const dept = normalizeDepartment(KpiWorkflowState.profile.departmentId);
    const periodId = KpiWorkflowState.period.id;
    const taskQuery = globalRole() ? query(collection(db,'tasks'), where('periodId','==',periodId))
      : isLeader() ? query(collection(db,'tasks'), where('periodId','==',periodId), where('primaryDepartmentId','==',dept))
      : query(collection(db,'tasks'), where('periodId','==',periodId), where('ownerUserId','==',KpiWorkflowState.user.uid));
    const registrationQuery = globalRole() ? query(collection(db,'taskRegistrations'), where('periodId','==',periodId))
      : isLeader() ? query(collection(db,'taskRegistrations'), where('periodId','==',periodId), where('departmentId','==',dept))
      : query(collection(db,'taskRegistrations'), where('periodId','==',periodId), where('userId','==',KpiWorkflowState.user.uid));
    const evaluationQuery = globalRole() ? query(collection(db,'taskEvaluations'), where('periodId','==',periodId))
      : isLeader() ? query(collection(db,'taskEvaluations'), where('periodId','==',periodId), where('departmentId','==',dept))
      : query(collection(db,'taskEvaluations'), where('periodId','==',periodId), where('ownerUserId','==',KpiWorkflowState.user.uid));
    const commonQuery = globalRole() ? query(collection(db,'commonCriteriaAssessments'), where('periodId','==',periodId))
      : isLeader() ? query(collection(db,'commonCriteriaAssessments'), where('periodId','==',periodId), where('departmentId','==',dept))
      : query(collection(db,'commonCriteriaAssessments'), where('periodId','==',periodId), where('userId','==',KpiWorkflowState.user.uid));
    const [usersSnap, tasksSnap, registrationsSnap, evalSnap, commonAllSnap, planSnap, delegationSnap] = await Promise.all([
      getDocs(collection(db,'users')), getDocs(taskQuery), getDocs(registrationQuery), getDocs(evaluationQuery), getDocs(commonQuery),
      getDoc(doc(db,'kpiPlans', `${periodId}_${dept}`)),
      getDocs(query(collection(db,'approvalDelegations'), where('departmentId','==',dept)))
    ]);
    KpiWorkflowState.users = usersSnap.docs.map(d => ({ id:d.id, ...d.data() }));
    KpiWorkflowState.tasks = tasksSnap.docs.map(d => ({ id:d.id, ...d.data() }));
    KpiWorkflowState.registrations = registrationsSnap.docs.map(d => ({ id:d.id, ...d.data() }));
    KpiWorkflowState.evaluations = evalSnap.docs.map(d => ({ id:d.id, ...d.data() }));
    KpiWorkflowState.commonAll = commonAllSnap.docs.map(d => ({ id:d.id, ...d.data() }));
    KpiWorkflowState.common = KpiWorkflowState.commonAll.find(item => item.userId === KpiWorkflowState.user.uid) || null;
    KpiWorkflowState.plan = planSnap.exists() ? { id:planSnap.id, ...planSnap.data() } : null;
    KpiWorkflowState.delegations = delegationSnap.docs.map(d => ({ id:d.id, ...d.data() }));
    render();
    message('Dữ liệu đã được cập nhật.', 'ok');
  } catch (error) {
    console.error(error);
    message(error?.code === 'permission-denied' ? 'Không thể tải dữ liệu đánh giá do tài khoản chưa có quyền truy cập. Vui lòng liên hệ quản trị viên.' : (error.message || 'Không tải được dữ liệu đánh giá.'));
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
  if (periodLine) periodLine.innerHTML = KpiWorkflowState.period ? `
    <span class="kpi-chip">${esc(KpiWorkflowState.period.name || KpiWorkflowState.period.id)}</span>
    <span class="kpi-chip">${dateVi(KpiWorkflowState.period.startDate)} – ${dateVi(KpiWorkflowState.period.endDate)}</span>
    <span class="kpi-chip">${KpiWorkflowState.period.status === 'COMPLETED' ? 'Đã kết thúc' : 'Đang hoạt động'}</span>
    <span class="kpi-chip">Kế hoạch: ${KpiWorkflowState.plan?.locked === true ? 'Đã khóa' : 'Chưa khóa'}</span>` : '<span class="kpi-chip">Chưa có kỳ hoạt động</span>';
  const s = summary();
  el('kpiMetricA').textContent = fmt(s.A);
  el('kpiMetricB').textContent = fmt(s.B);
  el('kpiMetric70').textContent = `${fmt(s.kpi70)}/70`;
  el('kpiMetric30').textContent = `${fmt(s.common30)}/30`;
  el('kpiMetric100').textContent = `${fmt(s.total100)}/100`;
  el('kpiPeriodAdmin')?.classList.toggle('kpi-hidden', !activeRole('ADMIN'));
  el('kpiLockPlan')?.classList.toggle('kpi-hidden', !(isDepartmentHead() || activeRole('ADMIN')));
  el('kpiDelegateApproval')?.classList.toggle('kpi-hidden', !isDepartmentHead());
  el('kpiUnlockPlan')?.classList.toggle('kpi-hidden', !(activeRole('ADMIN') || isDepartmentHead()) || KpiWorkflowState.plan?.locked !== true);
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
function renderPlanDashboard(){
  const target=el('kpiTaskList'); if(!target)return;
  const people=visiblePeople().filter(u=>rowsForPerson(u.id).length||regsForPerson(u.id).length||u.id===KpiWorkflowState.user.uid);
  if(!people.length){target.innerHTML='<div class="kpi-empty">Chưa có đăng ký hoặc nhiệm vụ trong kỳ.</div>';return;}
  target.innerHTML=`<div class="kpi-table-wrap"><table class="kpi-table"><thead><tr><th>STT</th><th>Họ và tên</th><th>Đầu việc đăng ký</th><th>Tổng điểm</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>${people.map((u,i)=>{const regs=regsForPerson(u.id),tasks=rowsForPerson(u.id),approved=tasks.filter(t=>t.includedInA===true),score=approved.reduce((a,t)=>a+Number(t.maximumConvertedScore||0),0),pending=regs.filter(r=>r.status==='PENDING').length;return `<tr><td>${i+1}</td><td><strong>${esc(u.fullName||u.email||u.id)}</strong><br><span class="kpi-small">${esc(u.position||'')}</span></td><td>${regs.length||tasks.length}</td><td>${fmt(score)}</td><td><span class="kpi-status">${pending?`${pending} chờ duyệt`:'Đã cập nhật'}</span></td><td><button class="kpi-button secondary" data-person-detail="${esc(u.id)}">Chi tiết</button></td></tr>`;}).join('')}</tbody></table></div>`;
  target.querySelectorAll('[data-person-detail]').forEach(b=>b.addEventListener('click',()=>openPersonPlanDetail(b.dataset.personDetail)));
  const completed = KpiWorkflowState.tasks.filter(taskForCurrentUser).filter(t => ['HOAN_THANH','COMPLETED','DA_HOAN_THANH'].includes(clean(t.status).toUpperCase()) || t.completedAt);
  target.insertAdjacentHTML('beforeend', `<div class="kpi-subsection"><h3>Đánh giá nhiệm vụ đã hoàn thành</h3><p class="kpi-small">Tiến độ được xác định theo thời hạn nhiệm vụ; người thực hiện tự đánh giá kết quả và cấp có thẩm quyền xác nhận.</p>${completed.length ? `<div class="kpi-table-wrap"><table class="kpi-table"><thead><tr><th>Nhiệm vụ</th><th>Người thực hiện</th><th>Tiến độ tự động</th><th>Chất lượng</th><th>Điểm thực tế</th><th>Thao tác</th></tr></thead><tbody>${completed.map(t=>{const ev=evaluationFor(t.id)||{};const progress=progressRateFromDates(t.deadline||t.dueDate,t.completedAt,true);const own=t.ownerUserId===KpiWorkflowState.user.uid;return `<tr><td><strong>${esc(t.taskCode||'')}</strong><br>${esc(t.title||'')}</td><td>${esc(t.ownerName||'')}</td><td>${progress}%</td><td>${ev.confirmedResultRate??ev.selfResultRate??'—'}%</td><td>${fmt(ev.confirmedActualScore||ev.selfActualScore)}</td><td>${own?`<button class="kpi-button" data-kpi-self="${t.id}">${ev?'Cập nhật đề xuất':'Tự đánh giá'}</button>`:canReviewEvaluation(ev,t)?`<button class="kpi-button" data-kpi-review="${ev?.id||''}">Xác nhận</button>`:'Chỉ xem'}</td></tr>`;}).join('')}</tbody></table></div>`:'<div class="kpi-empty">Chưa có nhiệm vụ hoàn thành để đánh giá.</div>'}</div>`);
  target.querySelectorAll('[data-kpi-self]').forEach(b=>b.addEventListener('click',()=>openSelfAssessment(b.dataset.kpiSelf)));
  target.querySelectorAll('[data-kpi-review]').forEach(b=>b.addEventListener('click',()=>openReview(b.dataset.kpiReview)));
}
function openPersonPlanDetail(uid){
  const user=KpiWorkflowState.users.find(u=>u.id===uid)||{id:uid,fullName:'Cá nhân'};
  const regs=regsForPerson(uid), tasks=rowsForPerson(uid), pending=regs.filter(r=>r.status==='PENDING');
  const can=pending.some(canApproveRegistration);
  const rows=[...regs.map(r=>({kind:'reg',...r})),...tasks.filter(t=>!regs.some(r=>r.taskId===t.id)).map(t=>({kind:'task',...t}))];
  const root=modal(`Kế hoạch của ${user.fullName||''}`,`<div class="registration-modal-tools">${can?'<button id="regSelectAll" class="kpi-button secondary">Chọn tất cả</button><button id="regClearAll" class="kpi-button secondary">Bỏ chọn tất cả</button>':''}</div><div class="kpi-table-wrap"><table class="kpi-table"><thead><tr><th>Duyệt</th><th>Mã/Đầu việc</th><th>Điểm chuẩn</th><th>Hệ số</th><th>Điểm tối đa</th><th>Trạng thái</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${x.kind==='reg'&&x.status==='PENDING'?`<input type="checkbox" data-reg-review value="${esc(x.id)}" ${canApproveRegistration(x)?'checked':'disabled'}>`:'—'}</td><td><strong>${esc(x.standardTaskCode||x.taskCode||'')}</strong><br>${esc(x.standardTaskName||x.title||'')}</td><td>${fmt(x.baseScore)}</td><td>${fmt(x.difficultyCoefficient)}</td><td>${fmt(x.maximumConvertedScore)}</td><td>${esc(x.status==='PENDING'?'Chờ duyệt':x.status==='REJECTED'?'Trả lại':x.planApprovalStatus==='APPROVED'||x.status==='APPROVED'?'Đã duyệt':x.status||'')}</td></tr>`).join('')}</tbody></table></div>`,can?'<button class="kpi-button secondary" data-kpi-close>Đóng</button><button id="regApproveSelected" class="kpi-button">Duyệt mục đã chọn</button>':'<button class="kpi-button secondary" data-kpi-close>Đóng</button>');
  root.querySelector('#regSelectAll')?.addEventListener('click',()=>root.querySelectorAll('[data-reg-review]:not(:disabled)').forEach(x=>x.checked=true));root.querySelector('#regClearAll')?.addEventListener('click',()=>root.querySelectorAll('[data-reg-review]').forEach(x=>x.checked=false));
  root.querySelector('#regApproveSelected')?.addEventListener('click',async()=>{const ids=[...root.querySelectorAll('[data-reg-review]:checked')].map(x=>x.value),selected=pending.filter(r=>ids.includes(r.id)),unselected=pending.filter(r=>!ids.includes(r.id));if(!selected.length&&!unselected.length)return; if(selected.length)await TaskRegistrationService.approveMany(selected,{periodEndDate:KpiWorkflowState.period?.endDate});if(unselected.length)await TaskRegistrationService.rejectMany(unselected,'Không được duyệt trong đợt xét kế hoạch này.');closeModal();await loadAll();});
}
function renderEvaluationDashboard(){
  const target=el('kpiTaskList');if(!target)return;el('kpiMainCardTitle').textContent='Đánh giá nhiệm vụ đã hoàn thành';el('kpiMainCardHint').textContent='Cá nhân tự đánh giá nhiệm vụ của chính mình; cấp có thẩm quyền chỉ xác nhận điểm.';
  const rows=KpiWorkflowState.tasks.filter(taskForCurrentUser).filter(t=>t.status==='HOAN_THANH');if(!rows.length){target.innerHTML='<div class="kpi-empty">Chưa có nhiệm vụ hoàn thành để đánh giá.</div>';return;}target.innerHTML=`<div class="kpi-table-wrap"><table class="kpi-table"><thead><tr><th>Nhiệm vụ</th><th>Người thực hiện</th><th>Điểm tối đa</th><th>Trạng thái đánh giá</th><th>Thao tác</th></tr></thead><tbody>${rows.map(t=>{const ev=evaluationFor(t.id),own=t.ownerUserId===KpiWorkflowState.user.uid;return `<tr><td><strong>${esc(t.taskCode||'')}</strong><br>${esc(t.title||'')}</td><td>${esc(t.ownerName||'')}</td><td>${fmt(t.maximumConvertedScore)}</td><td>${esc(taskStatus(t,ev))}</td><td>${own?`<button class="kpi-button" data-kpi-self="${t.id}">${ev?'Cập nhật tự đánh giá':'Tự đánh giá'}</button>`:canReviewEvaluation(ev,t)?`<button class="kpi-button" data-kpi-review="${ev?.id||''}">Xác nhận</button>`:'Chỉ xem'}</td></tr>`;}).join('')}</tbody></table></div>`;target.addEventListener('click',taskAction);target.addEventListener('click',reviewAction);
}
function renderReportDashboard(){
  const target=el('kpiTaskList');if(!target)return;el('kpiMainCardTitle').textContent='Báo cáo và tổng hợp KPI';el('kpiMainCardHint').textContent='Xem báo cáo cá nhân; Trưởng phòng/ADMIN có thể tổng hợp theo Phòng/Khu.';const s=summary();target.innerHTML=`<div class="kpi-metrics"><div class="kpi-metric"><span>A · Kế hoạch</span><strong>${fmt(s.A)}</strong></div><div class="kpi-metric"><span>B · Thực tế</span><strong>${fmt(s.B)}</strong></div><div class="kpi-metric"><span>KPI công việc</span><strong>${fmt(s.kpi70)}/70</strong></div><div class="kpi-metric"><span>Tiêu chí chung</span><strong>${fmt(s.common30)}/30</strong></div><div class="kpi-metric"><span>Tổng điểm</span><strong>${fmt(s.total100)}/100</strong></div></div><div class="kpi-actions" style="margin-top:16px"><button id="reportPersonal" class="kpi-button">Xem báo cáo cá nhân</button>${isLeader()||globalRole()?'<button id="reportDepartment" class="kpi-button secondary">Tổng hợp Phòng/Khu</button>':''}</div>`;el('reportPersonal')?.addEventListener('click',openReport);el('reportDepartment')?.addEventListener('click',()=>alert('Bảng tổng hợp Phòng/Khu dùng dữ liệu theo từng cá nhân trong kỳ; chức năng in tổng hợp sẽ được kiểm thử trên dữ liệu thật.'));
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

async function openDelegationManager(){
  if(!isDepartmentHead()) return;
  const deputies=KpiWorkflowState.users.filter(u=>u.active===true&&normalizeDepartment(u.departmentId)===normalizeDepartment(KpiWorkflowState.profile.departmentId)&&u.role==='DEPARTMENT_LEADER'&&/ph[oó]/i.test(clean(u.position)));
  const active=KpiWorkflowState.delegations.find(d=>d.active===true);
  const root=modal('Ủy quyền Phó Trưởng phòng duyệt kế hoạch',`<div class="kpi-form-grid"><label class="kpi-field full"><span>Người được ủy quyền</span><select id="delegationUser"><option value="">-- Không ủy quyền --</option>${deputies.map(u=>`<option value="${u.id}" ${active?.delegateUserId===u.id?'selected':''}>${esc(u.fullName||u.email)}</option>`).join('')}</select></label><label class="kpi-field"><span>Từ ngày</span><input id="delegationStart" type="date" value="${active?.startDate||new Date().toISOString().slice(0,10)}"></label><label class="kpi-field"><span>Đến ngày</span><input id="delegationEnd" type="date" value="${active?.endDate||KpiWorkflowState.period?.endDate||''}"></label><label class="kpi-field full"><span>Lý do</span><textarea id="delegationReason">${esc(active?.reason||'')}</textarea></label></div>`, '<button class="kpi-button secondary" data-kpi-close>Đóng</button><button id="saveDelegation" class="kpi-button">Lưu ủy quyền</button>');
  root.querySelector('#saveDelegation')?.addEventListener('click',async()=>{const uid=clean(el('delegationUser').value),reason=clean(el('delegationReason').value);if(uid&&!reason){alert('Phải nhập lý do ủy quyền.');return;}for(const d of KpiWorkflowState.delegations.filter(x=>x.active===true))await updateDoc(doc(db,'approvalDelegations',d.id),{active:false,revokedAt:serverTimestamp(),revokedByUserId:KpiWorkflowState.user.uid});if(uid){const deputy=deputies.find(x=>x.id===uid);await setDoc(doc(db,'approvalDelegations',`${normalizeDepartment(KpiWorkflowState.profile.departmentId)}_ACTIVE`),{departmentId:normalizeDepartment(KpiWorkflowState.profile.departmentId),delegatorUserId:KpiWorkflowState.user.uid,delegatorName:KpiWorkflowState.profile.fullName||'',delegateUserId:uid,delegateName:deputy?.fullName||'',startDate:el('delegationStart').value,endDate:el('delegationEnd').value,reason,active:true,createdAt:serverTimestamp()});}await audit('UPDATE_APPROVAL_DELEGATION',{delegateUserId:uid,reason});closeModal();await loadAll();});
}

async function unlockDepartmentPlan(){
  if(!KpiWorkflowState.plan?.locked || !(activeRole('ADMIN')||isDepartmentHead())) return;
  const hasEvaluation=KpiWorkflowState.evaluations.some(e=>['PENDING_REVIEW','CONFIRMED'].includes(e.status));
  if(hasEvaluation && !activeRole('ADMIN') && KpiWorkflowState.period?.pilotMode!==true){alert('Đã bắt đầu đánh giá. Chỉ ADMIN được mở khóa.');return;}
  const reason=prompt('Nhập lý do mở khóa kế hoạch:');if(!clean(reason))return;
  await updateDoc(doc(db,'kpiPlans',KpiWorkflowState.plan.id),{locked:false,unlockReason:clean(reason),unlockedAt:serverTimestamp(),unlockedByUserId:KpiWorkflowState.user.uid,updatedAt:serverTimestamp()});
  await audit('UNLOCK_DEPARTMENT_PLAN',{reason:clean(reason)});await loadAll();
}

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
async function deletePeriodData(){
  if(!activeRole('ADMIN')||!KpiWorkflowState.period)return;
  const reason=prompt('Nhập lý do dọn dữ liệu thử nghiệm theo kỳ:');if(!clean(reason))return;
  const periodId=KpiWorkflowState.period.id;
  const names=['taskRegistrations','tasks','kpiPlans','taskEvaluations','commonCriteriaAssessments'];
  let count=0;
  for(const name of names){
    const snap=await getDocs(query(collection(db,name),where('periodId','==',periodId)));
    for(const item of snap.docs){await updateDoc(item.ref,{active:false,status:'CANCELLED',cancelReason:clean(reason),cancelledAt:serverTimestamp(),cancelledByUserId:KpiWorkflowState.user.uid,updatedAt:serverTimestamp()});count++;}
  }
  await setDoc(doc(db,'kpiDeletionLogs',`${periodId}_${Date.now()}`),{periodId,softDeletedCount:count,reason:clean(reason),deletedByUserId:KpiWorkflowState.user.uid,deletedByName:KpiWorkflowState.profile.fullName||'',deletedAt:serverTimestamp()});
  await audit('SOFT_CLEAN_PERIOD',{periodId,count,reason:clean(reason)});alert(`Đã hủy mềm ${count} bản ghi thử nghiệm. Dữ liệu vẫn còn trong Firestore để kiểm tra nhật ký.`);await loadAll();
}

function openReport() {
  if (!KpiWorkflowState.period) return;

  const mine = KpiWorkflowState.tasks.filter(t => t.ownerUserId === KpiWorkflowState.user.uid && t.active !== false);
  const s = summary();
  const rating = ratingName(proposedRating(s.total100));
  const profile = KpiWorkflowState.profile || {};
  const commonItems = KpiWorkflowState.common?.items || [];

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
      const result = value.confirmedResult || value.selfResult || 'DAM_BAO';
      const ensured = result !== 'KHONG_DAM_BAO';
      const score = ensured ? max : 0;
      return `<tr class="m01-item-row">
        <td class="m01-center">${esc(code)}</td>
        <td>${esc(text)}</td>
        <td class="m01-center m01-check">${ensured ? 'X' : ''}</td>
        <td class="m01-center m01-check">${ensured ? '' : 'X'}</td>
        <td class="m01-center">${fmt(max)}</td>
        <td class="m01-center">${fmt(score)}</td>
        <td>${esc(value.confirmedNote || value.note || '')}</td>
      </tr>`;
    }).join('');
    const groupScore = group.items.reduce((total, [code, , max]) => {
      const value = resultFor(code);
      return total + ((value.confirmedResult || value.selfResult) === 'KHONG_DAM_BAO' ? 0 : max);
    }, 0);
    return `<tr class="m01-group-row"><td class="m01-center">${group.code}</td><td>${esc(group.title)}</td><td></td><td></td><td class="m01-center">${fmt(group.max)}</td><td class="m01-center">${fmt(groupScore)}</td><td></td></tr>${rows}`;
  }).join('');

  const quarterText = clean(KpiWorkflowState.period.name) || 'Quý …, Năm …';
  const birthDate = profileValue('dateOfBirth', 'birthDate', 'birthday');
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
        <tr class="m01-part-row"><td class="m01-center">B</td><td colspan="3">KẾT QUẢ THỰC HIỆN NHIỆM VỤ ĐƯỢC GIAO (70 ĐIỂM)</td><td class="m01-center">Điểm tối đa<br><small>(70 điểm)</small></td><td class="m01-center">Điểm đạt được<br><small>= Điểm KPI đã tính tại hệ thống</small></td><td>Ghi chú</td></tr>
        <tr class="m01-total-row"><td colspan="4">TỔNG (B) = Điểm KPI đã tính tại hệ thống</td><td class="m01-center">70</td><td class="m01-center">${fmt(s.kpi70)}</td><td></td></tr>
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
  const rows = [['STT','Mã nhiệm vụ','Tên nhiệm vụ','Điểm chuẩn','Hệ số','Điểm tối đa','Tiến độ xác nhận','Chất lượng xác nhận','Điểm thực tế']];
  tasks.forEach((task,index)=>{const ev=evaluationFor(task.id)||{};rows.push([index+1,task.taskCode||'',task.title||'',task.baseScore||0,task.difficultyCoefficient||1,task.maximumConvertedScore||0,ev.confirmedProgressRate??ev.selfProgressRate??'',ev.confirmedResultRate??ev.selfResultRate??'',ev.confirmedActualScore??ev.selfActualScore??0]);});
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
