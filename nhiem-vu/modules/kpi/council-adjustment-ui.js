/** Giao diện quy trình điều chỉnh sau Hội đồng - V1.10.0. */
import { UserContext } from "../../core/user-context.js?v=20260903.V1_22_1";
import { Permissions } from "../../core/permissions.js?v=20260903.V1_22_1";
import { FirebaseService } from "../../core/firebase-service.js?v=20260903.V1_22_1";
import { PeriodReadService } from "../../services/period-read-service.js?v=20260903.V1_22_1";
import { DepartmentReadService } from "../../services/department-read-service.js?v=20260903.V1_22_1";
import { UserReadService } from "../../services/user-read-service.js?v=20260903.V1_22_1";
import { DriveEvidenceService } from "../../services/drive-evidence-service.js?v=20260903.V1_22_1";
import { CouncilAdjustmentService } from "../../services/council-adjustment-service.js?v=20260903.V1_22_1";
import { ModalService } from "../../core/modal-service.js?v=20260903.V1_22_1";

const PROFESSIONAL_DEPARTMENTS = Object.freeze(["TCHC", "CTXH", "KHTC", "YT", "KI", "KII", "KIII"]);

function clean(value) { return String(value ?? "").trim(); }
function upper(value) { return clean(value).toUpperCase(); }
function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function finite(value) { return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)); }
function fmt(value) { return finite(value) ? Number(value).toLocaleString("vi-VN", { maximumFractionDigits: 2 }) : "—"; }
function timeText(value) {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(date) : "—";
}
function isTchcHead(user = UserContext.getUser()) {
  return Permissions.isAdmin(user) || (Permissions.isDepartmentHead(user) && upper(user?.departmentId) === "TCHC");
}
function isDepartmentManager(user = UserContext.getUser()) { return Permissions.isAdmin(user) || Permissions.isDepartmentLeader(user); }

function openModal({ title, subtitle = "", body = "", footer = "" }) {
  const backdrop = document.createElement("div");
  backdrop.className = "council-modal-backdrop";
  backdrop.innerHTML = `<section class="council-modal" role="dialog" aria-modal="true">
    <header class="council-modal-header"><div><span class="page-eyebrow">SAU HỘI ĐỒNG</span><h2>${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ""}</div><button type="button" class="council-close" data-council-close>×</button></header>
    <div class="council-modal-body">${body}</div>
    <footer class="council-modal-footer">${footer || '<button class="secondary-button" type="button" data-council-close>Đóng</button>'}</footer>
  </section>`;
  document.body.appendChild(backdrop);
  document.body.classList.add("modal-open");
  const close = () => { backdrop.remove(); document.body.classList.remove("modal-open"); };
  backdrop.querySelectorAll("[data-council-close]").forEach(button => button.addEventListener("click", close));
  backdrop.addEventListener("click", event => { if (event.target === backdrop) close(); });
  return { root: backdrop, close };
}

function requestTypeOptions(selected = "SCORE") {
  return [
    ["SCORE", "Điều chỉnh điểm"],
    ["EVIDENCE", "Bổ sung/chứng minh kết quả thực hiện"],
    ["SCORE_AND_EVIDENCE", "Điều chỉnh điểm và bổ sung minh chứng"]
  ].map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`).join("");
}

async function requestEditor({ period, departmentId, user, target, onSaved }) {
  const targetName = target.kind === "TASK"
    ? `${target.data.taskCode || ""} — ${target.data.title || "Nhiệm vụ"}`
    : target.name;
  const maximum = target.kind === "TASK"
    ? Number(target.data.maximumConvertedScore || target.data.baseScore || 0)
    : target.maximumScore;
  const modal = openModal({
    title: "Giao yêu cầu điều chỉnh",
    subtitle: `${user.fullName || user.email} • ${targetName}`,
    body: `<div class="council-form-grid">
      <label class="field-full"><span>Loại yêu cầu *</span><select id="councilRequestType">${requestTypeOptions()}</select></label>
      <label id="councilRequestedScoreField"><span>Điểm Hội đồng dự kiến (nếu đã thống nhất)</span><input id="councilRequestedScore" type="number" min="0" ${finite(maximum) ? `max="${esc(maximum)}"` : ""} step="0.01" placeholder="Có thể để trống để cá nhân rà soát"></label>
      <label class="field-full"><span>Nội dung/Kết luận Hội đồng *</span><textarea id="councilInstruction" rows="5" maxlength="3000" placeholder="Nêu rõ nội dung cần sửa, bổ sung hoặc chứng minh lại"></textarea></label>
      <div class="field-full info-banner"><strong>Phạm vi mở quyền</strong><span>Hệ thống chỉ mở đúng cá nhân và đúng đầu việc/tiêu chí này; các nội dung khác vẫn khóa.</span></div>
    </div>`,
    footer: '<button class="secondary-button" type="button" data-council-close>Hủy</button><button id="councilCreateRequest" class="primary-button" type="button">Gửi yêu cầu</button>'
  });
  const typeSelect = modal.root.querySelector("#councilRequestType");
  const scoreField = modal.root.querySelector("#councilRequestedScoreField");
  const sync = () => { scoreField.hidden = typeSelect.value === "EVIDENCE"; };
  typeSelect.addEventListener("change", sync); sync();
  modal.root.querySelector("#councilCreateRequest")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    try {
      button.disabled = true; button.textContent = "Đang gửi…";
      const requestType = typeSelect.value;
      const instruction = modal.root.querySelector("#councilInstruction")?.value || "";
      const scoreRaw = modal.root.querySelector("#councilRequestedScore")?.value;
      const requestedScore = finite(scoreRaw) ? Number(scoreRaw) : null;
      if (target.kind === "TASK") {
        await CouncilAdjustmentService.createTaskRequest({
          periodId: period.id, departmentId, user, task: target.data,
          requestType, instruction, requestedScore
        });
      } else {
        await CouncilAdjustmentService.createCriterionRequest({
          periodId: period.id, departmentId, user, assessment: target.assessment,
          criterionIndex: target.index, requestType, instruction, requestedScore
        });
      }
      modal.close();
      await onSaved?.();
    } catch (error) {
      ModalService.alert(error?.message || "Không tạo được yêu cầu điều chỉnh.");
      button.disabled = false; button.textContent = "Gửi yêu cầu";
    }
  });
}

async function employeeEditor(requestItem, onSaved) {
  const scoreNeeded = ["SCORE", "SCORE_AND_EVIDENCE"].includes(upper(requestItem.requestType));
  const evidenceNeeded = ["EVIDENCE", "SCORE_AND_EVIDENCE"].includes(upper(requestItem.requestType));
  const modal = openModal({
    title: "Thực hiện yêu cầu sau Hội đồng",
    subtitle: requestItem.targetType === "TASK" ? `${requestItem.taskCode || ""} — ${requestItem.taskTitle || "Nhiệm vụ"}` : requestItem.criterionName || "Tiêu chí chung",
    body: `<div class="council-request-summary">
      <div><span>Loại yêu cầu</span><strong>${esc(CouncilAdjustmentService.requestTypeLabel(requestItem.requestType))}</strong></div>
      <div><span>Điểm trước Hội đồng</span><strong>${fmt(requestItem.beforeScore)}</strong></div>
      ${finite(requestItem.requestedScore) ? `<div><span>Điểm Hội đồng dự kiến</span><strong>${fmt(requestItem.requestedScore)}</strong></div>` : ""}
    </div>
    <div class="info-banner"><strong>Nội dung cần thực hiện</strong><span>${esc(requestItem.instruction || "")}</span>${requestItem.returnNote ? `<span class="text-danger">Bổ sung thêm: ${esc(requestItem.returnNote)}</span>` : ""}</div>
    <div class="council-form-grid">
      ${scoreNeeded ? `<label><span>Điểm đề nghị sau khi rà soát *</span><input id="councilEmployeeScore" type="number" min="0" ${finite(requestItem.maximumScore) ? `max="${esc(requestItem.maximumScore)}"` : ""} step="0.01" value="${finite(requestItem.employeeProposedScore) ? esc(requestItem.employeeProposedScore) : finite(requestItem.requestedScore) ? esc(requestItem.requestedScore) : ""}"></label>` : ""}
      <label class="field-full"><span>Giải trình/Kết quả bổ sung${evidenceNeeded ? " *" : ""}</span><textarea id="councilEmployeeComment" rows="4" maxlength="3000" placeholder="Nêu nội dung sửa lại hoặc giải trình minh chứng">${esc(requestItem.employeeComment || "")}</textarea></label>
      ${evidenceNeeded && requestItem.targetType === "TASK" ? `<label class="field-full"><span>Tệp minh chứng bổ sung</span><input id="councilEvidenceFile" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"><small>Minh chứng cũ không bị xóa. Tệp này được lưu riêng là minh chứng bổ sung sau Hội đồng.</small></label>` : ""}
      ${evidenceNeeded ? `<label class="field-full"><span>Mô tả minh chứng bổ sung</span><textarea id="councilEvidenceText" rows="3" maxlength="3000"></textarea></label>` : ""}
      <div id="councilUploadState" class="field-full council-upload-state"></div>
    </div>`,
    footer: '<button class="secondary-button" type="button" data-council-close>Đóng</button><button id="councilSubmitEmployee" class="primary-button" type="button">Gửi Trưởng phòng xác nhận</button>'
  });

  modal.root.querySelector("#councilSubmitEmployee")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    try {
      button.disabled = true; button.textContent = "Đang lưu…";
      let evidence = null;
      const evidenceText = clean(modal.root.querySelector("#councilEvidenceText")?.value);
      const file = modal.root.querySelector("#councilEvidenceFile")?.files?.[0] || null;
      if (file && requestItem.targetType === "TASK") {
        const taskSnapshot = await FirebaseService.getDoc(FirebaseService.doc(FirebaseService.db, "tasks", requestItem.taskId));
        if (!taskSnapshot.exists()) throw new Error("Không tìm thấy nhiệm vụ để lưu minh chứng.");
        const task = { id: taskSnapshot.id, ...taskSnapshot.data() };
        const state = modal.root.querySelector("#councilUploadState");
        const uploaded = await DriveEvidenceService.upload(file, task, {
          onProgress: progress => { if (state) state.textContent = progress.message || "Đang tải minh chứng…"; }
        });
        evidence = {
          evidenceText,
          evidenceUrl: uploaded.fileUrl || uploaded.evidenceUrl || "",
          evidenceFileName: uploaded.fileName || file.name,
          evidenceStoragePath: uploaded.storagePath || uploaded.fileId || ""
        };
      } else if (evidenceText) {
        evidence = { evidenceText, evidenceUrl: "", evidenceFileName: "", evidenceStoragePath: "" };
      }
      await CouncilAdjustmentService.submitEmployeeUpdate(requestItem, {
        proposedScore: modal.root.querySelector("#councilEmployeeScore")?.value ?? null,
        comment: modal.root.querySelector("#councilEmployeeComment")?.value || "",
        evidence
      });
      modal.close();
      await onSaved?.();
    } catch (error) {
      ModalService.alert(error?.message || "Không gửi được nội dung điều chỉnh.");
      button.disabled = false; button.textContent = "Gửi Trưởng phòng xác nhận";
    }
  });
}

async function managerConfirmEditor(requestItem, onSaved) {
  const scoreNeeded = ["SCORE", "SCORE_AND_EVIDENCE"].includes(upper(requestItem.requestType));
  const modal = openModal({
    title: "Chốt kết quả sau Hội đồng",
    subtitle: `${requestItem.userName || "Cá nhân"} • ${requestItem.taskCode || requestItem.criterionName || ""}`,
    body: `<div class="council-request-summary">
      <div><span>Điểm trước Hội đồng</span><strong>${fmt(requestItem.beforeScore)}</strong></div>
      <div><span>Điểm cá nhân đề nghị</span><strong>${fmt(requestItem.employeeProposedScore)}</strong></div>
      <div><span>Minh chứng bổ sung</span><strong>${Array.isArray(requestItem.supplementalEvidence) ? requestItem.supplementalEvidence.length : 0}</strong></div>
    </div>
    <div class="info-banner"><strong>Giải trình cá nhân</strong><span>${esc(requestItem.employeeComment || "Không có giải trình bổ sung")}</span></div>
    <div class="council-form-grid">
      ${scoreNeeded ? `<label><span>Điểm cuối cùng sau Hội đồng *</span><input id="councilFinalScore" type="number" min="0" ${finite(requestItem.maximumScore) ? `max="${esc(requestItem.maximumScore)}"` : ""} step="0.01" value="${finite(requestItem.employeeProposedScore) ? esc(requestItem.employeeProposedScore) : finite(requestItem.requestedScore) ? esc(requestItem.requestedScore) : ""}"></label>` : ""}
      <label class="field-full"><span>Ghi chú chốt</span><textarea id="councilManagerNote" rows="4" maxlength="3000" placeholder="Ghi nhận kết luận sau khi kiểm tra"></textarea></label>
    </div>`,
    footer: '<button id="councilReturnEmployee" class="secondary-button" type="button">Yêu cầu bổ sung lại</button><button class="secondary-button" type="button" data-council-close>Đóng</button><button id="councilConfirmFinal" class="primary-button" type="button">Chốt kết quả</button>'
  });
  modal.root.querySelector("#councilReturnEmployee")?.addEventListener("click", async event => {
    const note = await ModalService.prompt("Nêu rõ nội dung cần cá nhân bổ sung thêm:");
    if (note === null) return;
    try {
      event.currentTarget.disabled = true;
      await CouncilAdjustmentService.returnToEmployee(requestItem, note);
      modal.close(); await onSaved?.();
    } catch (error) { ModalService.alert(error?.message || "Không trả lại được yêu cầu."); event.currentTarget.disabled = false; }
  });
  modal.root.querySelector("#councilConfirmFinal")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    try {
      if (!await ModalService.confirm("Chốt kết quả này là kết quả sau Hội đồng và cập nhật vào báo cáo KPI cuối cùng?")) return;
      button.disabled = true; button.textContent = "Đang chốt…";
      await CouncilAdjustmentService.confirmRequest(requestItem, {
        finalScore: modal.root.querySelector("#councilFinalScore")?.value ?? null,
        managerNote: modal.root.querySelector("#councilManagerNote")?.value || ""
      });
      modal.close(); await onSaved?.();
    } catch (error) { ModalService.alert(error?.message || "Không chốt được kết quả."); button.disabled = false; button.textContent = "Chốt kết quả"; }
  });
}

async function renderMyRequests(container, period, user) {
  const requests = await CouncilAdjustmentService.listMyRequests(period.id, user.departmentId);
  container.innerHTML = requests.length ? `<div class="council-list">${requests.map(item => `<article class="council-request-card">
    <div class="council-request-card-head"><div><strong>${esc(item.taskCode || item.criterionName || "Yêu cầu điều chỉnh")}</strong><span>${esc(item.taskTitle || item.criterionName || "")}</span></div><span class="council-status ${upper(item.status).toLowerCase()}">${esc(CouncilAdjustmentService.statusLabel(item.status))}</span></div>
    <div class="council-request-meta"><span>${esc(CouncilAdjustmentService.requestTypeLabel(item.requestType))}</span><span>Điểm trước HĐ: ${fmt(item.beforeScore)}</span>${finite(item.finalScore) ? `<span>Điểm sau HĐ: ${fmt(item.finalScore)}</span>` : ""}</div>
    <p>${esc(item.instruction || "")}</p>
    ${["OPEN", "RETURNED"].includes(upper(item.status)) ? `<button class="primary-button compact-button" data-my-council-edit="${esc(item.id)}" type="button">Thực hiện yêu cầu</button>` : ""}
  </article>`).join("")}</div>` : '<div class="empty-state compact-empty-state">Hiện chưa có yêu cầu điều chỉnh sau Hội đồng dành cho bạn.</div>';
  container.querySelectorAll("[data-my-council-edit]").forEach(button => button.addEventListener("click", () => {
    const item = requests.find(row => row.id === button.dataset.myCouncilEdit);
    if (item) employeeEditor(item, () => renderMyRequests(container, period, user));
  }));
}

export async function openMyCouncilAdjustments() {
  const user = UserContext.requireUser();
  const period = await PeriodReadService.getActive({ force: true });
  if (!period) return ModalService.alert("Chưa có kỳ đánh giá đang hoạt động.");
  const round = await CouncilAdjustmentService.getRound(period.id);
  if (!round) return ModalService.alert("TCHC chưa mở đợt điều chỉnh sau Hội đồng.");
  const modal = openModal({
    title: "Yêu cầu điều chỉnh sau Hội đồng",
    subtitle: `${period.name || period.id} • ${user.fullName || user.email}`,
    body: '<div id="myCouncilRequests">Đang tải…</div>',
    footer: '<button class="secondary-button" type="button" data-council-close>Đóng</button>'
  });
  await renderMyRequests(modal.root.querySelector("#myCouncilRequests"), period, user);
}

export async function openTchcCouncilManager() {
  const user = UserContext.requireUser();
  if (!isTchcHead(user)) return ModalService.alert("Chỉ Trưởng Phòng Tổ chức - Hành chính được quản lý đợt điều chỉnh sau Hội đồng.");
  const [period, departments] = await Promise.all([
    PeriodReadService.getActive({ force: true }), DepartmentReadService.listActive()
  ]);
  if (!period) return ModalService.alert("Chưa có kỳ đánh giá đang hoạt động.");
  const round = await CouncilAdjustmentService.getRound(period.id);
  const available = departments.filter(item => PROFESSIONAL_DEPARTMENTS.includes(upper(item.id || item.code)));
  const selected = new Set((round?.departmentIds || available.map(d => d.id || d.code)).map(upper));
  const modal = openModal({
    title: "Quản lý điều chỉnh sau Hội đồng",
    subtitle: `${period.name || period.id} • TCHC mở/khóa đợt, Phòng/Khu xử lý nhân sự của mình`,
    body: `<div class="council-round-state ${upper(round?.status).toLowerCase()}"><span>Trạng thái đợt</span><strong>${upper(round?.status) === "OPEN" ? "Đang mở điều chỉnh" : upper(round?.status) === "CLOSED" ? "Đã khóa sau Hội đồng" : "Chưa mở"}</strong></div>
      <div class="council-department-picker"><h3>Phòng/Khu được mở điều chỉnh</h3>${available.map(d => {
        const id = upper(d.id || d.code);
        return `<label><input type="checkbox" value="${esc(id)}" ${selected.has(id) ? "checked" : ""} ${upper(round?.status) === "OPEN" ? "disabled" : ""}><span>${esc(d.name || id)}</span></label>`;
      }).join("")}</div>
      <div id="councilTchcOverview" class="council-overview">${round ? "Đang tổng hợp trạng thái Phòng/Khu…" : "Mở đợt để bắt đầu quy trình sau Hội đồng."}</div>`,
    footer: `${upper(round?.status) === "OPEN"
      ? '<button id="councilCloseRound" class="danger-button" type="button">Khóa điều chỉnh sau Hội đồng</button>'
      : '<button id="councilOpenRound" class="primary-button" type="button">Mở điều chỉnh cho Phòng/Khu</button>'}<button class="secondary-button" type="button" data-council-close>Đóng</button>`
  });

  const renderOverview = async () => {
    const target = modal.root.querySelector("#councilTchcOverview");
    if (!target || !round) return;
    const rows = [];
    for (const d of available) {
      const id = upper(d.id || d.code);
      if (!selected.has(id)) continue;
      try {
        const list = await CouncilAdjustmentService.listDepartmentRequests(period.id, id);
        rows.push({ id, name: d.name || id, total: list.length, pending: list.filter(x => upper(x.status) !== "CONFIRMED").length, confirmed: list.filter(x => upper(x.status) === "CONFIRMED").length });
      } catch (_) { rows.push({ id, name: d.name || id, total: 0, pending: 0, confirmed: 0 }); }
    }
    target.innerHTML = `<h3>Tiến độ xử lý</h3><div class="council-overview-grid">${rows.map(row => `<div><strong>${esc(row.name)}</strong><span>${row.total} yêu cầu • ${row.pending} đang xử lý • ${row.confirmed} đã chốt</span></div>`).join("")}</div>`;
  };
  await renderOverview();

  modal.root.querySelector("#councilOpenRound")?.addEventListener("click", async event => {
    const ids = [...modal.root.querySelectorAll(".council-department-picker input:checked")].map(input => input.value);
    if (!ids.length) return ModalService.alert("Hãy chọn ít nhất một Phòng/Khu.");
    if (!await ModalService.confirm(`Mở đợt điều chỉnh sau Hội đồng cho ${ids.length} Phòng/Khu?`)) return;
    try { event.currentTarget.disabled = true; await CouncilAdjustmentService.openRound(period, ids); modal.close(); await openTchcCouncilManager(); }
    catch (error) { ModalService.alert(error?.message || "Không mở được đợt điều chỉnh."); event.currentTarget.disabled = false; }
  });
  modal.root.querySelector("#councilCloseRound")?.addEventListener("click", async event => {
    if (!await ModalService.confirm("Khóa đợt điều chỉnh sau Hội đồng? Sau khi khóa, cá nhân và Phòng/Khu không thể sửa tiếp.")) return;
    try { event.currentTarget.disabled = true; await CouncilAdjustmentService.closeRound(period.id); modal.close(); await openTchcCouncilManager(); }
    catch (error) { ModalService.alert(error?.message || "Không khóa được đợt điều chỉnh."); event.currentTarget.disabled = false; }
  });
}

async function managerContent(modal, period, departmentId, users) {
  const userSelect = modal.root.querySelector("#councilEmployeeSelect");
  const targets = modal.root.querySelector("#councilManagerTargets");
  const requestsBox = modal.root.querySelector("#councilManagerRequests");

  const refreshRequests = async () => {
    const requests = await CouncilAdjustmentService.listDepartmentRequests(period.id, departmentId);
    requestsBox.innerHTML = requests.length ? `<div class="council-list">${requests.map(item => `<article class="council-request-card">
      <div class="council-request-card-head"><div><strong>${esc(item.userName || "")}</strong><span>${esc(item.taskCode || item.criterionName || "")} ${esc(item.taskTitle || "")}</span></div><span class="council-status ${upper(item.status).toLowerCase()}">${esc(CouncilAdjustmentService.statusLabel(item.status))}</span></div>
      <div class="council-request-meta"><span>${esc(CouncilAdjustmentService.requestTypeLabel(item.requestType))}</span><span>${fmt(item.beforeScore)} → ${finite(item.finalScore) ? fmt(item.finalScore) : "…"}</span></div>
      ${upper(item.status) === "EMPLOYEE_SUBMITTED" ? `<button class="primary-button compact-button" data-manager-confirm="${esc(item.id)}" type="button">Kiểm tra và chốt</button>` : ""}
    </article>`).join("")}</div>` : '<div class="empty-state compact-empty-state">Phòng/Khu chưa tạo yêu cầu điều chỉnh nào.</div>';
    requestsBox.querySelectorAll("[data-manager-confirm]").forEach(button => button.addEventListener("click", () => {
      const item = requests.find(row => row.id === button.dataset.managerConfirm);
      if (item) managerConfirmEditor(item, refreshRequests);
    }));
  };

  const refreshTargets = async () => {
    const uid = userSelect.value;
    const user = users.find(item => item.id === uid);
    if (!user) { targets.innerHTML = '<div class="empty-state compact-empty-state">Chọn một cá nhân để xem đầu việc/tiêu chí.</div>'; return; }
    targets.innerHTML = "Đang tải đầu việc…";
    const [tasks, assessment] = await Promise.all([
      CouncilAdjustmentService.listDepartmentTasks(period.id, departmentId),
      CouncilAdjustmentService.getCommonCriteriaForUser(period.id, uid)
    ]);
    const ownTasks = tasks.filter(task => task.ownerUserId === uid);
    const commonItems = Array.isArray(assessment?.items) ? assessment.items : [];
    targets.innerHTML = `<div class="council-target-group"><h4>Nhiệm vụ của ${esc(user.fullName || user.email)}</h4>
      ${ownTasks.length ? ownTasks.map(task => `<article class="council-target-row"><div><strong>${esc(task.taskCode || "")} — ${esc(task.title || "")}</strong><span>Điểm hiện tại: ${fmt(task.confirmedActualScore)} • Tiến độ ${Number(task.progress || 0)}%</span></div><button class="secondary-button compact-button" data-council-target-task="${esc(task.id)}" type="button">Yêu cầu điều chỉnh</button></article>`).join("") : '<p class="kpi-small">Không có nhiệm vụ trong kỳ.</p>'}
      </div>
      ${commonItems.length ? `<div class="council-target-group"><h4>Tiêu chí chung</h4>${commonItems.map((item, index) => `<article class="council-target-row"><div><strong>${esc(item.name || item.label || item.title || `Tiêu chí ${index + 1}`)}</strong><span>Điểm hiện tại: ${fmt(item.confirmedScore ?? item.actualScore ?? item.score ?? item.selfScore)}</span></div><button class="secondary-button compact-button" data-council-target-criterion="${index}" type="button">Yêu cầu điều chỉnh</button></article>`).join("")}</div>` : ""}`;
    targets.querySelectorAll("[data-council-target-task]").forEach(button => button.addEventListener("click", () => {
      const task = ownTasks.find(row => row.id === button.dataset.councilTargetTask);
      if (task) requestEditor({ period, departmentId, user, target: { kind: "TASK", data: task }, onSaved: refreshRequests });
    }));
    targets.querySelectorAll("[data-council-target-criterion]").forEach(button => button.addEventListener("click", () => {
      const index = Number(button.dataset.councilTargetCriterion);
      const item = commonItems[index];
      if (item) requestEditor({ period, departmentId, user, target: {
        kind: "COMMON_CRITERION", assessment, index,
        name: item.name || item.label || item.title || `Tiêu chí ${index + 1}`,
        maximumScore: item.maximumScore ?? item.maxScore ?? null
      }, onSaved: refreshRequests });
    }));
  };

  userSelect.addEventListener("change", refreshTargets);
  await refreshRequests();
  await refreshTargets();
}

export async function openDepartmentCouncilManager() {
  const current = UserContext.requireUser();
  if (!isDepartmentManager(current)) return ModalService.alert("Chỉ Trưởng/Phó Phòng/Khu được giao yêu cầu điều chỉnh cho nhân sự của đơn vị.");
  const period = await PeriodReadService.getActive({ force: true });
  if (!period) return ModalService.alert("Chưa có kỳ đánh giá đang hoạt động.");
  const departmentId = upper(current.departmentId);
  const [round, state, allUsers] = await Promise.all([
    CouncilAdjustmentService.getRound(period.id),
    CouncilAdjustmentService.getDepartmentState(period.id, departmentId),
    UserReadService.listActive({ force: true })
  ]);
  if (!round || upper(round.status) !== "OPEN" || state?.enabled !== true) {
    return ModalService.alert("TCHC chưa mở quyền điều chỉnh sau Hội đồng cho Phòng/Khu này.");
  }
  const users = allUsers.filter(user => user.active === true && upper(user.departmentId) === departmentId)
    .sort((a, b) => String(a.fullName || "").localeCompare(String(b.fullName || ""), "vi"));
  const modal = openModal({
    title: "Xử lý kết quả sau Hội đồng",
    subtitle: `${period.name || period.id} • ${departmentId}`,
    body: `<div class="council-manager-layout">
      <section><label><span>Chọn cá nhân</span><select id="councilEmployeeSelect"><option value="">— Chọn nhân sự —</option>${users.map(user => `<option value="${esc(user.id)}">${esc(user.fullName || user.email)} — ${esc(user.position || user.role || "")}</option>`).join("")}</select></label><div id="councilManagerTargets" class="council-targets"></div></section>
      <section><h3>Yêu cầu đã tạo</h3><div id="councilManagerRequests">Đang tải…</div></section>
    </div>`,
    footer: '<button class="secondary-button" type="button" data-council-close>Đóng</button>'
  });
  await managerContent(modal, period, departmentId, users);
}

function evidenceSummary(item) {
  const rows = Array.isArray(item?.supplementalEvidence) ? item.supplementalEvidence : [];
  if (!rows.length) return "—";
  return rows.map((evidence, index) => {
    const parts = [evidence?.evidenceFileName, evidence?.evidenceText].map(clean).filter(Boolean);
    return `${index + 1}. ${parts.join(" — ") || "Minh chứng bổ sung"}`;
  }).join(" | ");
}

function printableRows(requests) {
  return requests.map((item, index) => `<tr><td>${index + 1}</td><td>${esc(item.userName || "")}</td><td>${esc(item.taskCode || item.criterionName || "")}</td><td>${esc(item.taskTitle || item.criterionName || "")}</td><td>${fmt(item.beforeScore)}</td><td>${finite(item.finalScore) ? fmt(item.finalScore) : "Chưa chốt"}</td><td>${esc(CouncilAdjustmentService.requestTypeLabel(item.requestType))}</td><td>${esc(evidenceSummary(item))}</td><td>${esc(item.managerNote || item.instruction || "")}</td></tr>`).join("");
}

export async function openCouncilReport() {
  const current = UserContext.requireUser();
  const period = await PeriodReadService.getActive({ force: true });
  if (!period) return ModalService.alert("Chưa có kỳ đánh giá đang hoạt động.");
  const departments = await DepartmentReadService.listActive();
  let departmentIds = [];
  if (Permissions.isDirector(current) || isTchcHead(current) || Permissions.isAdmin(current)) {
    departmentIds = departments.map(d => upper(d.id || d.code)).filter(id => PROFESSIONAL_DEPARTMENTS.includes(id));
  } else if (isDepartmentManager(current)) {
    departmentIds = [upper(current.departmentId)];
  } else {
    departmentIds = [upper(current.departmentId)];
  }
  const all = [];
  for (const departmentId of departmentIds) {
    try {
      const rows = isDepartmentManager(current) || Permissions.isDirector(current) || isTchcHead(current) || Permissions.isAdmin(current)
        ? await CouncilAdjustmentService.listDepartmentRequests(period.id, departmentId)
        : await CouncilAdjustmentService.listMyRequests(period.id, departmentId);
      all.push(...rows);
    } catch (_) { /* Phạm vi không được phép thì bỏ qua. */ }
  }
  const ownOnly = !(Permissions.isDirector(current) || isTchcHead(current) || Permissions.isAdmin(current) || isDepartmentManager(current));
  const rows = ownOnly ? all.filter(item => item.userId === current.uid) : all;
  const modal = openModal({
    title: "Báo cáo điều chỉnh sau Hội đồng",
    subtitle: `${period.name || period.id} • ${rows.length} nội dung`,
    body: rows.length ? `<div class="council-report-table-wrap"><table class="council-report-table"><thead><tr><th>STT</th><th>Cá nhân</th><th>Mã</th><th>Nội dung</th><th>Trước HĐ</th><th>Sau HĐ</th><th>Loại xử lý</th><th>Minh chứng bổ sung</th><th>Ghi chú</th></tr></thead><tbody>${printableRows(rows)}</tbody></table></div>` : '<div class="empty-state">Chưa có nội dung điều chỉnh sau Hội đồng.</div>',
    footer: rows.length ? '<button id="councilPrintReport" class="primary-button" type="button">In/PDF báo cáo điều chỉnh</button><button class="secondary-button" type="button" data-council-close>Đóng</button>' : '<button class="secondary-button" type="button" data-council-close>Đóng</button>'
  });
  modal.root.querySelector("#councilPrintReport")?.addEventListener("click", () => {
    const win = window.open("", "_blank", "noopener,noreferrer");
    if (!win) return ModalService.alert("Trình duyệt đang chặn cửa sổ in. Hãy cho phép pop-up rồi thử lại.");
    win.document.write(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Báo cáo điều chỉnh sau Hội đồng</title><style>body{font-family:Arial,sans-serif;color:#111;margin:24px}h1{font-size:20px;text-align:center}p{text-align:center}table{border-collapse:collapse;width:100%;font-size:11px}th,td{border:1px solid #444;padding:6px;vertical-align:top}th{background:#eee}@page{size:A4 landscape;margin:12mm}</style></head><body><h1>BÁO CÁO ĐIỀU CHỈNH KẾT QUẢ SAU HỘI ĐỒNG</h1><p>${esc(period.name || period.id)}</p><table><thead><tr><th>STT</th><th>Cá nhân</th><th>Mã</th><th>Nội dung</th><th>Trước HĐ</th><th>Sau HĐ</th><th>Loại xử lý</th><th>Minh chứng bổ sung</th><th>Ghi chú</th></tr></thead><tbody>${printableRows(rows)}</tbody></table><script>window.onload=()=>window.print()<\/script></body></html>`);
    win.document.close();
  });
}
