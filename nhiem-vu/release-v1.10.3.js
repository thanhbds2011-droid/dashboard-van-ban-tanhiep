/**
 * Lớp nâng cấp V1.10.3.
 * Chỉ bổ sung/chỉnh đúng các yêu cầu đã chốt, không thay đổi luồng ổn định khác.
 */
import { FirebaseService } from "./core/firebase-service.js?v=20260810.V1_10_3";
import { UserContext } from "./core/user-context.js?v=20260810.V1_10_3";
import { Permissions } from "./core/permissions.js?v=20260810.V1_10_3";
import { TaskRegistrationService } from "./services/task-registration-service.js?v=20260810.V1_10_3";
import { DepartmentReadService } from "./services/department-read-service.js?v=20260810.V1_10_3";
import { DirectorTaskService } from "./services/director-task-service.js?v=20260810.V1_10_3";
import { TaskNotificationBridge } from "./services/task-notification-bridge.js?v=20260810.V1_10_3";
import {
  openTchcCouncilManager,
  openDepartmentCouncilManager,
  openMyCouncilAdjustments,
  openCouncilReport
} from "./modules/kpi/council-adjustment-ui.js?v=20260810.V1_10_3";

const BUILD = "20260810.V1_10_3";
let observer = null;
let scheduled = false;

function clean(value) { return String(value ?? "").trim(); }
function upper(value) { return clean(value).toUpperCase(); }
function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function currentUser() { try { return UserContext.getUser(); } catch (_) { return null; } }
function isStandalone() {
  return window.matchMedia?.("(display-mode: standalone)")?.matches === true || window.navigator.standalone === true;
}

function scheduleEnhance() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    try { enhance(); } catch (error) { console.warn("V1.10.3 enhancement skipped:", error); }
  });
}

function exactText(element) { return clean(element?.textContent).replace(/\s+/g, " "); }

function hideLegacyStandardTaskFlags() {
  if (window.location.hash !== "#/standard-tasks") return;

  const exactBadges = new Set([
    "Cốt lõi",
    "Đầu việc cốt lõi",
    "Dành cho quản lý",
    "Nhiệm vụ quản lý",
    "Nhiệm vụ có tính chất quản lý"
  ]);
  document.querySelectorAll("span,button,strong,label,div").forEach(node => {
    const text = exactText(node);
    if (!exactBadges.has(text)) return;
    // Chỉ ẩn phần tử lá hoặc thẻ chứa đúng checkbox cũ; không ẩn cả modal.
    if (node.matches("label") && node.querySelector("input[type='checkbox']")) {
      node.hidden = true;
      node.classList.add("legacy-standard-task-flag-hidden");
      return;
    }
    if (node.children.length === 0 || node.matches(".tag,.pill,.status-pill,.task-chip,.badge")) {
      node.hidden = true;
      node.classList.add("legacy-standard-task-flag-hidden");
    }
  });

  document.querySelectorAll("label").forEach(label => {
    const text = exactText(label);
    if (/Đầu việc cốt lõi|Nhiệm vụ có tính chất quản lý|Dành cho quản lý/i.test(text)
        && label.querySelector("input[type='checkbox']")) {
      label.hidden = true;
      label.classList.add("legacy-standard-task-flag-hidden");
    }
  });

  document.querySelectorAll("small.field-help,p.field-help").forEach(node => {
    const text = exactText(node);
    if (text.includes("Hai cờ “Cốt lõi”") || text.includes('Hai cờ "Cốt lõi"')) {
      node.textContent = "Trường “Đối tượng được nhìn thấy và đăng ký” là nguồn duy nhất quyết định quyền hiển thị.";
    }
  });
}

function protectDirectorEvaluationUi() {
  const user = currentUser();
  if (!user || !Permissions.isDirector(user) || window.location.hash !== "#/kpi") return;

  /*
   * BGĐ không chấm Trưởng phòng/nhân viên. Tuy nhiên nhiệm vụ của chính Giám đốc/
   * Phó Giám đốc vẫn phải được tự đánh giá và tự chốt như Trưởng phòng.
   * Dựa vào cấu trúc V1.9.4: hàng của chính mình luôn có [data-kpi-self].
   */
  const heading = [...document.querySelectorAll("h2,h3,h4")]
    .find(node => /đánh giá nhiệm vụ đã hoàn thành|theo dõi kết quả nhiệm vụ đã hoàn thành/i.test(exactText(node)));
  const section = heading?.closest("section, .kpi-subsection, .page-card, .kpi-card") || null;
  if (!section) return;

  section.querySelectorAll(".kpi-review-task-row").forEach(row => {
    const isOwnRow = Boolean(row.querySelector("[data-kpi-self]"));
    if (isOwnRow) {
      row.classList.add("director-own-review-row");
      return;
    }
    row.classList.add("director-monitor-only-row");
    row.querySelectorAll("[data-kpi-review], [data-kpi-confirm-check]").forEach(control => {
      control.hidden = true;
      control.disabled = true;
    });
  });

  const ownReviewable = [...section.querySelectorAll(".director-own-review-row [data-kpi-confirm-check]")]
    .some(input => input.disabled !== true);
  const selectAll = section.querySelector("#kpiReviewSelectAll");
  const clearAll = section.querySelector("#kpiReviewClearAll");
  if (selectAll) { selectAll.hidden = true; selectAll.disabled = true; }
  if (clearAll) { clearAll.hidden = true; clearAll.disabled = true; }

  const confirmOwn = section.querySelector("#kpiConfirmSelected");
  if (confirmOwn) {
    confirmOwn.hidden = !ownReviewable;
    confirmOwn.disabled = !ownReviewable;
    if (ownReviewable) confirmOwn.textContent = "Chốt điểm nhiệm vụ của tôi";
  }

  if (heading && !heading.dataset.v110DirectorTitle) {
    heading.dataset.v110DirectorTitle = "true";
    heading.textContent = "Theo dõi kết quả nhiệm vụ đã hoàn thành";
  }
  if (!section.querySelector(".director-monitoring-note")) {
    const note = document.createElement("div");
    note.className = "info-banner director-monitoring-note";
    note.innerHTML = "<strong>Ban Giám đốc: theo dõi, giám sát</strong><span>Không chấm điểm Trưởng phòng hoặc nhân viên. Nhiệm vụ của chính Giám đốc/Phó Giám đốc vẫn được tự đánh giá và tự chốt để phục vụ Hội đồng.</span>";
    heading?.insertAdjacentElement("afterend", note);
  }
}
async function refreshPushButton(snapshot = null) {
  const bell = document.getElementById("btnPushSettings");
  if (!bell || !window.TaskPush?.getSubscriptionSnapshot) return;
  try {
    const state = snapshot || await window.TaskPush.getSubscriptionSnapshot();
    bell.classList.toggle("hidden", state?.ready === true);
    bell.dataset.pushReady = state?.ready === true ? "true" : "false";
    document.body.classList.toggle("push-ready", state?.ready === true);
  } catch (_) {
    bell.classList.remove("hidden");
  }
}

function bindNotificationMenu() {
  const menuButton = document.getElementById("btnMobilePushSettings");
  if (!menuButton || menuButton.dataset.pushSettingsBound === "V1.10.3") return;
  if (menuButton.dataset.bound === BUILD) return;
  menuButton.dataset.bound = BUILD;
  menuButton.addEventListener("click", () => {
    document.getElementById("btnPushSettings")?.click();
    document.getElementById("btnMobileMenu")?.click();
  });
}

function bindInstallState() {
  document.body.classList.toggle("is-installed-app", isStandalone());
}

async function taskByCode(taskCode) {
  const code = clean(taskCode);
  if (!code) return null;
  const snapshot = await FirebaseService.getDocs(
    FirebaseService.query(
      FirebaseService.collection(FirebaseService.db, "tasks"),
      FirebaseService.where("taskCode", "==", code),
      FirebaseService.limit(1)
    )
  );
  return snapshot.empty ? null : { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
}

function closeTaskDetailAndRefresh() {
  const backdrop = document.querySelector(".task-detail-modal")?.closest(".modal-backdrop");
  backdrop?.remove();
  document.body.classList.remove("modal-open");
  window.dispatchEvent(new Event("hashchange"));
}

async function findRegistrationForTask(task, user) {
  if (clean(task.registrationId)) {
    const snapshot = await FirebaseService.getDoc(
      FirebaseService.doc(FirebaseService.db, "taskRegistrations", clean(task.registrationId))
    );
    if (snapshot.exists()) return { id: snapshot.id, ...snapshot.data() };
  }
  const snapshot = await FirebaseService.getDocs(
    FirebaseService.query(
      FirebaseService.collection(FirebaseService.db, "taskRegistrations"),
      FirebaseService.where("taskId", "==", task.id),
      FirebaseService.limit(10)
    )
  );
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
    .find(row => row.userId === user.uid) || null;
}

async function addSelfCancelButton(panel, task) {
  const user = currentUser();
  if (!user || task.ownerUserId !== user.uid) return;
  const selfRegistered = upper(task.entryMode) === "SELF_REGISTERED_APPROVED"
    || (upper(task.sourceType) === "DANG_KY_KE_HOACH" && clean(task.registrationId));
  if (!selfRegistered) return;
  if (panel.querySelector("#v110CancelSelfRegistered")) return;

  const registration = await findRegistrationForTask(task, user);
  if (!registration) return;
  let map = {};
  try { map = await TaskRegistrationService.getApprovedCancellationMap([registration]); }
  catch (_) { return; }
  if (map[registration.id] !== true) return;

  const actions = document.createElement("div");
  actions.className = "v110-task-extra-actions";
  actions.innerHTML = '<button id="v110CancelSelfRegistered" class="danger-button" type="button">Hủy nhiệm vụ tự đăng ký</button><small>Chỉ xuất hiện khi nhiệm vụ chưa có tiến độ, minh chứng, công việc con, điều chỉnh hoặc đánh giá.</small>';
  const body = panel.querySelector(".modal-body") || panel;
  body.appendChild(actions);
  actions.querySelector("#v110CancelSelfRegistered")?.addEventListener("click", async event => {
    const reason = prompt("Nhập lý do hủy nhiệm vụ tự đăng ký:");
    if (reason === null) return;
    try {
      event.currentTarget.disabled = true;
      await TaskRegistrationService.cancelApprovedRegistration(registration, reason);
      alert("Đã hủy nhiệm vụ tự đăng ký. Đầu việc được loại khỏi kế hoạch/KPI của kỳ theo đúng điều kiện an toàn.");
      closeTaskDetailAndRefresh();
    } catch (error) {
      alert(error?.message || "Không thể hủy nhiệm vụ.");
      event.currentTarget.disabled = false;
    }
  });
}

async function openDirectorReassignDialog(task) {
  const departments = await DepartmentReadService.listActive();
  const options = departments
    .filter(d => upper(d.id || d.code) !== "CDTN")
    .map(d => `<option value="${esc(upper(d.id || d.code))}">${esc(d.name || d.id || d.code)}</option>`).join("");
  const backdrop = document.createElement("div");
  backdrop.className = "council-modal-backdrop";
  backdrop.innerHTML = `<section class="council-modal director-control-dialog"><header class="council-modal-header"><div><span class="page-eyebrow">QUYỀN ĐIỀU HÀNH BGĐ</span><h2>Chuyển Phòng/Khu chính</h2><p>${esc(task.taskCode || "")} — ${esc(task.title || "")}</p></div><button data-director-close class="council-close" type="button">×</button></header><div class="council-modal-body"><div class="council-form-grid"><label><span>Phòng/Khu mới *</span><select id="directorNewDepartment"><option value="">— Chọn Phòng/Khu —</option>${options}</select></label><label class="field-full"><span>Lý do chuyển</span><textarea id="directorReassignReason" rows="4" maxlength="2000"></textarea></label><div class="field-full info-banner"><strong>Điều gì sẽ xảy ra?</strong><span>Người/Tổ đã phân công và trạng thái tiếp nhận cũ được xóa khỏi luồng hiện hành; Phòng/Khu mới trở về bước chờ tiếp nhận. Nhật ký cũ vẫn giữ nguyên.</span></div></div></div><footer class="council-modal-footer"><button data-director-close class="secondary-button" type="button">Hủy</button><button id="directorReassignConfirm" class="primary-button" type="button">Chuyển Phòng/Khu</button></footer></section>`;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelectorAll("[data-director-close]").forEach(btn => btn.addEventListener("click", close));
  backdrop.querySelector("#directorReassignConfirm")?.addEventListener("click", async event => {
    const departmentId = backdrop.querySelector("#directorNewDepartment")?.value || "";
    const reason = backdrop.querySelector("#directorReassignReason")?.value || "";
    if (!departmentId) return alert("Hãy chọn Phòng/Khu mới.");
    try {
      event.currentTarget.disabled = true; event.currentTarget.textContent = "Đang chuyển…";
      await DirectorTaskService.reassignDepartment(task, departmentId, reason);
      close(); closeTaskDetailAndRefresh();
    } catch (error) { alert(error?.message || "Không chuyển được Phòng/Khu."); event.currentTarget.disabled = false; event.currentTarget.textContent = "Chuyển Phòng/Khu"; }
  });
}

async function addDirectorControls(panel, task) {
  const user = currentUser();
  if (!user || !(Permissions.isDirector(user) || Permissions.isAdmin(user))) return;
  const bgdTask = ["DIRECTOR", "ADMIN"].includes(upper(task.createdByRole))
    || upper(task.entryMode) === "DIRECT_ASSIGNED"
    || upper(task.assignmentMode) === "TEAM_DIRECT";
  if (!bgdTask || panel.querySelector("#v110DirectorControls")) return;

  const section = document.createElement("section");
  section.id = "v110DirectorControls";
  section.className = "detail-section director-control-panel";
  const completed = Boolean(task.completedAt) || ["HOAN_THANH", "COMPLETED", "DA_HOAN_THANH"].includes(upper(task.status));
  section.innerHTML = `<h3>Quyền điều hành Ban Giám đốc</h3><p>BGĐ được thu hồi, chuyển Phòng/Khu hoặc xóa mềm nhiệm vụ đã giao. Các thao tác đều giữ nhật ký; không dùng khu vực này để chấm điểm KPI.</p><div class="director-control-actions">
    <button id="v110DirectorRecall" class="secondary-button" type="button" ${completed ? "disabled" : ""}>Thu hồi nhiệm vụ</button>
    <button id="v110DirectorReassign" class="secondary-button" type="button" ${completed ? "disabled" : ""}>Chuyển Phòng/Khu</button>
    <button id="v110DirectorDelete" class="danger-button" type="button">Xóa nhiệm vụ</button>
  </div>${completed ? '<small>Nhiệm vụ đã hoàn thành: không thu hồi/chuyển luồng; nếu Hội đồng cần đổi kết quả, dùng “Điều chỉnh sau Hội đồng”.</small>' : ""}`;
  const overview = panel.querySelector('[data-task-panel="overview"]') || panel.querySelector(".modal-body") || panel;
  overview.appendChild(section);

  section.querySelector("#v110DirectorRecall")?.addEventListener("click", async event => {
    const reason = prompt("Nhập lý do thu hồi nhiệm vụ:"); if (reason === null) return;
    if (!confirm("Thu hồi nhiệm vụ về trạng thái tạm dừng và xóa phân công hiện hành?")) return;
    try { event.currentTarget.disabled = true; await DirectorTaskService.recall(task, reason); closeTaskDetailAndRefresh(); }
    catch (error) { alert(error?.message || "Không thu hồi được nhiệm vụ."); event.currentTarget.disabled = false; }
  });
  section.querySelector("#v110DirectorReassign")?.addEventListener("click", () => openDirectorReassignDialog(task));
  section.querySelector("#v110DirectorDelete")?.addEventListener("click", async event => {
    const reason = prompt("Nhập lý do xóa nhiệm vụ:"); if (reason === null) return;
    if (!confirm("Xóa nhiệm vụ khỏi luồng thực hiện và KPI? Dữ liệu không bị xóa cứng; hệ thống giữ nhật ký để kiểm tra sau này.")) return;
    try { event.currentTarget.disabled = true; await DirectorTaskService.softDelete(task, reason); closeTaskDetailAndRefresh(); }
    catch (error) { alert(error?.message || "Không xóa được nhiệm vụ."); event.currentTarget.disabled = false; }
  });
}

async function enhanceTaskDetail() {
  const panel = document.querySelector(".task-detail-modal");
  if (!panel || panel.dataset.v110Enhanced === BUILD) return;
  const code = exactText(panel.querySelector(".page-eyebrow"));
  if (!code) return;
  const task = await taskByCode(code);
  if (!task) return;
  panel.dataset.v110Enhanced = BUILD;
  await Promise.allSettled([addSelfCancelButton(panel, task), addDirectorControls(panel, task)]);
}

function injectCouncilButtons() {
  const user = currentUser();
  if (!user) return;
  const route = window.location.hash;

  if (route === "#/kpi") {
    const pageCard = document.querySelector(".kpi-page, .kpi-shell, #appOutlet > .page-card, #appOutlet section");
    const anchor = document.querySelector("#kpiManagementToolbar") || document.querySelector(".kpi-management-toolbar") || pageCard;
    if (!anchor) return;
    let toolbar = document.getElementById("v110CouncilToolbar");
    if (!toolbar) {
      toolbar = document.createElement("div");
      toolbar.id = "v110CouncilToolbar";
      toolbar.className = "v110-council-toolbar";
      anchor.prepend(toolbar);
    }
    const buttons = [];
    if (Permissions.isDepartmentHead(user) && upper(user.departmentId) === "TCHC") {
      buttons.push('<button id="v110OpenCouncilRound" class="secondary-button" type="button">⚙ Quản lý điều chỉnh sau Hội đồng</button>');
    }
    if (Permissions.isDepartmentLeader(user)) {
      buttons.push('<button id="v110DepartmentCouncil" class="secondary-button" type="button">📝 Xử lý kết quả sau Hội đồng</button>');
    }
    buttons.push('<button id="v110MyCouncil" class="secondary-button" type="button">📌 Yêu cầu điều chỉnh của tôi</button>');
    const signature = buttons.join("|");
    if (toolbar.dataset.councilSignature !== signature) {
      toolbar.dataset.councilSignature = signature;
      toolbar.innerHTML = buttons.join("");
      toolbar.querySelector("#v110OpenCouncilRound")?.addEventListener("click", openTchcCouncilManager);
      toolbar.querySelector("#v110DepartmentCouncil")?.addEventListener("click", openDepartmentCouncilManager);
      toolbar.querySelector("#v110MyCouncil")?.addEventListener("click", openMyCouncilAdjustments);
    }
  }

  if (route === "#/reports") {
    const options = document.querySelector(".kpi-report-options") || document.querySelector("#kpiTaskList");
    if (options && !document.getElementById("v110CouncilReport")) {
      const button = document.createElement("button");
      button.id = "v110CouncilReport";
      button.className = "kpi-report-option is-council";
      button.type = "button";
      button.innerHTML = '<span>🧾</span><strong>Điều chỉnh sau Hội đồng</strong><small>Xem điểm trước/sau Hội đồng, nội dung bổ sung và in/PDF hồ sơ điều chỉnh.</small>';
      button.addEventListener("click", openCouncilReport);
      options.appendChild(button);
    }
  }
}

function enhance() {
  bindNotificationMenu();
  bindInstallState();
  hideLegacyStandardTaskFlags();
  protectDirectorEvaluationUi();
  injectCouncilButtons();
  void enhanceTaskDetail();
}

function bootstrap() {
  console.info("Nhiệm vụ & KPI release enhancement V1.10.3", BUILD);
  observer?.disconnect();
  observer = new MutationObserver(scheduleEnhance);
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener("v3:route-changed", scheduleEnhance);
  window.addEventListener("hashchange", scheduleEnhance);
  window.addEventListener("taskpush:subscription-change", event => void refreshPushButton(event.detail));
  window.matchMedia?.("(display-mode: standalone)")?.addEventListener?.("change", bindInstallState);
  void refreshPushButton();
  void TaskNotificationBridge.start();
  scheduleEnhance();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
else bootstrap();
