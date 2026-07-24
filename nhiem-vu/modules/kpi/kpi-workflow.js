import { auth, db } from '../../firebase-config.js';
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, query,
  serverTimestamp, setDoc, updateDoc, where
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import {
  KPI2B as KPI2C, COMMON_CRITERIA, calculateTaskScore, calculateKpiSummary,
  proposedRating, ratingName, round2
} from '../../kpi-engine.js';

export const KpiWorkflowState = {
  user: null,
  profile: null,
  period: null,
  periods: [],
  users: [],
  tasks: [],
  evaluations: [],
  common: null,
  commonAll: [],
  plan: null,
  selectedTaskId: null,
  initialized: false
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
const sameDepartment = (data) => normalizeDepartment(data?.departmentId || data?.primaryDepartmentId) === normalizeDepartment(KpiWorkflowState.profile?.departmentId);

function mount() {
  const section = el('kpiSection');
  if (!section) return;
  section.innerHTML = `
    <div class="kpi-header">
      <div>
        <div><span class="kpi-pilot">PRODUCTION FINAL · VẬN HÀNH</span></div>
        <h2>Đánh giá nhiệm vụ và chấm điểm KPI</h2>
        <p>Quản lý kế hoạch quý, tự đánh giá, xác nhận điểm, Mẫu 01 và báo cáo trình ký.</p>
        <div id="kpiPeriodLine" class="kpi-period-line"></div>
      </div>
      <div class="kpi-actions kpi-no-print">
        <button id="kpiRefresh" class="kpi-button secondary" type="button">↻ Làm mới</button>
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
    <div class="kpi-toolbar kpi-no-print">
      <button id="kpiCommonButton" class="kpi-button secondary" type="button">✍️ Mẫu 01 · 30 điểm</button>
      <button id="kpiLockPlan" class="kpi-button secondary" type="button">🔒 Khóa kế hoạch Phòng/Khu</button>
      <button id="kpiPeriodAdmin" class="kpi-button secondary" type="button">⚙️ Quản lý kỳ</button>
      <span class="kpi-small">Kế hoạch chỉ hình thành A sau khi được duyệt. Trưởng phòng chủ động khóa, hệ thống không tự khóa theo ngày.</span>
    </div>
    <div class="kpi-grid">
      <section class="kpi-card">
        <h3>Nhiệm vụ trong kỳ</h3>
        <p class="kpi-small">Nhiệm vụ thường xuyên được duyệt vào A; nhiệm vụ đột xuất hợp lệ cộng vào B nhưng không mặc nhiên làm tăng A.</p>
        <div id="kpiTaskList"></div>
      </section>
      <section class="kpi-card">
        <h3>Chờ xử lý</h3>
        <div id="kpiReviewList"></div>
      </section>
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
      message(activeRole('ADMIN') ? 'Chưa có kỳ đánh giá đang hoạt động. Admin hãy tạo kỳ thí điểm.' : 'Chưa có kỳ đánh giá đang hoạt động.');
      return;
    }
    const [usersSnap, tasksSnap, evalSnap, commonAllSnap, planSnap] = await Promise.all([
      getDocs(collection(db,'users')),
      getDocs(query(collection(db,'tasks'), where('periodId','==',KpiWorkflowState.period.id))),
      getDocs(query(collection(db,'taskEvaluations'), where('periodId','==',KpiWorkflowState.period.id))),
      getDocs(query(collection(db,'commonCriteriaAssessments'), where('periodId','==',KpiWorkflowState.period.id))),
      getDoc(doc(db,'kpiPlans', `${KpiWorkflowState.period.id}_${normalizeDepartment(KpiWorkflowState.profile.departmentId)}`))
    ]);
    KpiWorkflowState.users = usersSnap.docs.map(d => ({ id:d.id, ...d.data() }));
    KpiWorkflowState.tasks = tasksSnap.docs.map(d => ({ id:d.id, ...d.data() }));
    KpiWorkflowState.evaluations = evalSnap.docs.map(d => ({ id:d.id, ...d.data() }));
    KpiWorkflowState.commonAll = commonAllSnap.docs.map(d => ({ id:d.id, ...d.data() }));
    KpiWorkflowState.common = KpiWorkflowState.commonAll.find(item => item.userId === KpiWorkflowState.user.uid) || null;
    KpiWorkflowState.plan = planSnap.exists() ? { id:planSnap.id, ...planSnap.data() } : null;
    render();
    message('Dữ liệu đã được cập nhật.', 'ok');
  } catch (error) {
    console.error(error);
    message(error?.code === 'permission-denied' ? 'Firestore Rules chưa cho phép đọc dữ liệu KPI. Hãy Publish file firestore.rules Production 2c.' : (error.message || 'Không tải được dữ liệu KPI.'));
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
  el('kpiLockPlan')?.classList.toggle('kpi-hidden', !isLeader());
  renderTasks();
  renderReviews();
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
  if (!rows.length) { target.innerHTML = '<div class="kpi-empty">Chưa có nhiệm vụ gắn với kỳ này. Hãy chọn đầu việc tại “Danh mục công việc” để đăng ký hoặc giao việc.</div>'; return; }
  target.innerHTML = `<div class="kpi-table-wrap"><table class="kpi-table"><thead><tr><th>Mã/Nhiệm vụ</th><th>Kế hoạch</th><th>Điểm tối đa</th><th>Đánh giá</th><th>Thao tác</th></tr></thead><tbody>${rows.map(task => {
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
function renderReviews() {
  const target = el('kpiReviewList');
  if (!target) return;
  const pending = KpiWorkflowState.evaluations.filter(ev => ['PENDING_REVIEW','NEEDS_REVISION'].includes(ev.status)).map(ev => ({ ev, task:KpiWorkflowState.tasks.find(t=>t.id===ev.taskId) })).filter(x => canReviewEvaluation(x.ev,x.task));
  const pendingPlans = isLeader() ? KpiWorkflowState.tasks.filter(t => sameDepartment(t) && t.planApprovalStatus === 'PENDING_APPROVAL') : [];
  const pendingCommon = KpiWorkflowState.commonAll.filter(item => item.userId !== KpiWorkflowState.user.uid && item.status === 'SELF_COMPLETED' && ((isLeader() && normalizeDepartment(item.departmentId) === normalizeDepartment(KpiWorkflowState.profile.departmentId)) || globalRole()));
  if (!pending.length && !pendingPlans.length && !pendingCommon.length) { target.innerHTML = '<div class="kpi-empty">Không có hồ sơ chờ xử lý.</div>'; return; }
  target.innerHTML = `${pendingPlans.map(t=>`<div class="kpi-alert"><strong>Chờ duyệt kế hoạch</strong><br>${esc(t.ownerName || 'Chưa có người')} · ${esc(t.title)}<div class="kpi-actions"><button class="kpi-button secondary" data-kpi-approve-plan="${t.id}">Duyệt</button><button class="kpi-button danger" data-kpi-reject-plan="${t.id}">Trả lại</button></div></div>`).join('')}${pendingCommon.map(item=>`<div class="kpi-alert"><strong>Chờ xác nhận Mẫu 01 · 30 điểm</strong><br>${esc(item.fullName)} · Tự chấm ${fmt(item.selfTotal)}/30<div class="kpi-actions"><button class="kpi-button" data-kpi-review-common="${item.id}">Mở xác nhận</button></div></div>`).join('')}${pending.map(({ev,task})=>`<div class="kpi-alert ${ev.status==='NEEDS_REVISION'?'':'kpi-ok'}"><strong>${ev.status==='NEEDS_REVISION'?'Đang yêu cầu bổ sung':'Chờ xác nhận điểm'}</strong><br>${esc(task?.ownerName)} · ${esc(task?.title)}<br><span class="kpi-small">Tự chấm ${fmt(ev.selfActualScore)}/${fmt(task?.maximumConvertedScore)}</span><div class="kpi-actions"><button class="kpi-button" data-kpi-review="${ev.id}">Mở xác nhận</button></div></div>`).join('')}`;
}

async function taskAction(event) {
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
      isExceededRequirement:exceeded,exceededRequirementDescription:exceededText,status:'PENDING_REVIEW',formulaVersion:'PILOT_2026_V1',updatedAt:serverTimestamp(),createdAt:ev.createdAt||serverTimestamp()
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
async function deletePeriodData(){if(!activeRole('ADMIN')||!KpiWorkflowState.period)return;const code=prompt(`Nhập chính xác: XOA DU LIEU ${KpiWorkflowState.period.id}`);if(code!==`XOA DU LIEU ${KpiWorkflowState.period.id}`){alert('Mã xác nhận không đúng.');return;}const periodId=KpiWorkflowState.period.id;const collections=['taskEvaluations','commonCriteriaAssessments','kpiPlans','kpiProfiles','kpiAdjustments'];let count=0;for(const name of collections){const snap=await getDocs(query(collection(db,name),where('periodId','==',periodId)));for(const d of snap.docs){await deleteDoc(d.ref);count++;}}const taskSnap=await getDocs(query(collection(db,'tasks'),where('periodId','==',periodId)));for(const d of taskSnap.docs){const logSnap=await getDocs(query(collection(db,'taskLogs'),where('taskId','==',d.id)));for(const logDoc of logSnap.docs){await deleteDoc(logDoc.ref);count++;}await deleteDoc(d.ref);count++;}await setDoc(doc(db,'kpiDeletionLogs',`${periodId}_${Date.now()}`),{periodId,deletedCount:count,deletedByUserId:KpiWorkflowState.user.uid,deletedByName:KpiWorkflowState.profile.fullName||'',reason:'Kết thúc kỳ, hồ sơ đã lưu bản giấy',deletedAt:serverTimestamp()});await deleteDoc(doc(db,'evaluationPeriods',periodId));alert(`Đã xóa ${count} bản ghi phát sinh của ${periodId}.`);await loadAll();}

function openReport() {
  if (!KpiWorkflowState.period) return;
  const mine = KpiWorkflowState.tasks.filter(t => t.ownerUserId === KpiWorkflowState.user.uid);
  const s = summary();
  const rating = ratingName(proposedRating(s.total100));
  const taskRows = mine.map((t, i) => {
    const e = evaluationFor(t.id) || {};
    return `<tr><td>${i + 1}</td><td>${esc(t.taskCode || '')}<br>${esc(t.title)}</td><td>${fmt(t.baseScore)}</td><td>${fmt(t.difficultyCoefficient)}</td><td>${fmt(t.maximumConvertedScore)}</td><td>${e.selfProgressRate ?? '—'}% / ${e.selfResultRate ?? '—'}%</td><td>${e.confirmedProgressRate ?? '—'}% / ${e.confirmedResultRate ?? '—'}%</td><td>${fmt(e.confirmedActualScore)}</td></tr>`;
  }).join('');
  const criteriaRows = COMMON_CRITERIA.map(c => {
    const x = KpiWorkflowState.common?.items?.find(i => i.code === c.code) || {};
    const score = (x.confirmedResult || x.selfResult) === 'KHONG_DAM_BAO' ? 0 : c.max;
    return `<tr><td>${c.code}</td><td>${esc(c.text)}</td><td>${c.max}</td><td>${score}</td><td>${esc(x.confirmedNote || x.note || '')}</td></tr>`;
  }).join('');
  const pdfHtml = `<div id="kpiPdfPreview" class="kpi-report kpi-report-print"><div class="report-title"><strong>TRUNG TÂM BẢO TRỢ XÃ HỘI TÂN HIỆP</strong><h1>BẢN TỰ ĐÁNH GIÁ, XẾP LOẠI CỦA CÁ NHÂN</h1></div><h3>${esc(KpiWorkflowState.period.name)}</h3><p><strong>Họ và tên:</strong> ${esc(KpiWorkflowState.profile.fullName || '')} &nbsp; <strong>Chức vụ:</strong> ${esc(KpiWorkflowState.profile.position || '')}</p><p><strong>Đơn vị:</strong> ${esc(KpiWorkflowState.profile.departmentId || '')} &nbsp; <strong>Kỳ:</strong> ${dateVi(KpiWorkflowState.period.startDate)} đến ${dateVi(KpiWorkflowState.period.endDate)}</p><h3>A. NHÓM TIÊU CHÍ CHUNG (30 ĐIỂM)</h3><table class="kpi-report-table"><thead><tr><th>TT</th><th>Tiêu chí</th><th>Điểm tối đa</th><th>Điểm đạt</th><th>Ghi chú</th></tr></thead><tbody>${criteriaRows}<tr><th colspan="2">Tổng</th><th>30</th><th>${fmt(s.common30)}</th><th></th></tr></tbody></table><h3>B. KẾT QUẢ THỰC HIỆN NHIỆM VỤ (70 ĐIỂM)</h3><table class="kpi-report-table"><thead><tr><th>TT</th><th>Mã/Tên nhiệm vụ</th><th>Điểm chuẩn</th><th>Hệ số</th><th>Tối đa</th><th>Tự chấm</th><th>Xác nhận</th><th>Điểm thực tế</th></tr></thead><tbody>${taskRows}</tbody></table><p><strong>A – Tổng điểm tối đa kế hoạch:</strong> ${fmt(s.A)} &nbsp; <strong>B – Tổng điểm thực tế:</strong> ${fmt(s.B)}</p><p><strong>KPI công việc:</strong> ${fmt(s.kpi70)}/70 &nbsp; <strong>Tiêu chí chung:</strong> ${fmt(s.common30)}/30 &nbsp; <strong>Tổng:</strong> ${fmt(s.total100)}/100</p><p><strong>Mức tự đề xuất:</strong> ${esc(rating)}</p><p class="report-note"><strong>Lưu ý:</strong> Tổng điểm từ 60 điểm được hiển thị là hoàn thành nhiệm vụ còn hạn chế; hệ thống không tự động kết luận “không hoàn thành”. Kết quả cuối cùng do cấp có thẩm quyền xem xét.</p><div class="signature-grid"><div><strong>CÁ NHÂN TỰ ĐÁNH GIÁ</strong><br><em>(Ký, ghi rõ họ tên)</em></div><div><strong>XÁC NHẬN CỦA CẤP CÓ THẨM QUYỀN</strong><br><em>(Xác lập thời điểm, ký, ghi rõ họ tên và đóng dấu)</em></div></div></div>`;
  const excelHtml = `<div id="kpiExcelPreview" class="kpi-hidden"><div class="kpi-alert kpi-ok">Bản xem trước dạng bảng Excel — chỉ xem, không tải tệp.</div><div class="kpi-table-wrap"><table class="kpi-table"><thead><tr><th>STT</th><th>Mã nhiệm vụ</th><th>Tên nhiệm vụ</th><th>Điểm chuẩn</th><th>Hệ số</th><th>Điểm tối đa</th><th>Tiến độ tự chấm</th><th>Kết quả tự chấm</th><th>Tiến độ xác nhận</th><th>Kết quả xác nhận</th><th>Điểm thực tế</th></tr></thead><tbody>${mine.map((t, i) => { const e = evaluationFor(t.id) || {}; return `<tr><td>${i + 1}</td><td>${esc(t.taskCode || '')}</td><td>${esc(t.title)}</td><td>${fmt(t.baseScore)}</td><td>${fmt(t.difficultyCoefficient)}</td><td>${fmt(t.maximumConvertedScore)}</td><td>${e.selfProgressRate ?? ''}</td><td>${e.selfResultRate ?? ''}</td><td>${e.confirmedProgressRate ?? ''}</td><td>${e.confirmedResultRate ?? ''}</td><td>${fmt(e.confirmedActualScore)}</td></tr>`; }).join('')}</tbody></table></div><div class="kpi-metrics" style="margin-top:12px"><div class="kpi-metric"><span>A</span><strong>${fmt(s.A)}</strong></div><div class="kpi-metric"><span>B</span><strong>${fmt(s.B)}</strong></div><div class="kpi-metric"><span>KPI 70</span><strong>${fmt(s.kpi70)}</strong></div><div class="kpi-metric"><span>Điểm chung 30</span><strong>${fmt(s.common30)}</strong></div><div class="kpi-metric"><span>Tổng 100</span><strong>${fmt(s.total100)}</strong></div></div></div>`;
  modal('Xem trước báo cáo', `<div class="kpi-preview-tabs kpi-no-print"><button id="kpiPdfTab" class="kpi-button secondary active" type="button">Xem trước PDF</button><button id="kpiExcelTab" class="kpi-button secondary" type="button">Xem dạng bảng Excel</button></div>${pdfHtml}${excelHtml}`, '<button class="kpi-button secondary" data-kpi-close type="button">Đóng</button><button id="kpiPrintReport" class="kpi-button" type="button">🖨️ In báo cáo</button>');
  el('kpiPdfTab').addEventListener('click', () => { el('kpiPdfPreview').classList.remove('kpi-hidden'); el('kpiExcelPreview').classList.add('kpi-hidden'); el('kpiPdfTab').classList.add('active'); el('kpiExcelTab').classList.remove('active'); el('kpiPrintReport').classList.remove('kpi-hidden'); });
  el('kpiExcelTab').addEventListener('click', () => { el('kpiPdfPreview').classList.add('kpi-hidden'); el('kpiExcelPreview').classList.remove('kpi-hidden'); el('kpiPdfTab').classList.remove('active'); el('kpiExcelTab').classList.add('active'); el('kpiPrintReport').classList.add('kpi-hidden'); });
  el('kpiPrintReport').addEventListener('click', () => window.print());
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
