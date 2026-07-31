import { UserContext } from "../../core/user-context.js";
import { Permissions } from "../../core/permissions.js?v=20260731.V1_1_13";
import { ToastService } from "../../core/toast-service.js";
import { StandardTaskReadService } from "../../services/standard-task-read-service.js?v=20260731.V1_1_13";
import { PeriodReadService } from "../../services/period-read-service.js?v=20260731.V1_1_13";
import { StandardTaskWriteService } from "../../services/standard-task-write-service.js?v=20260731.V1_1_13";
import { TaskRegistrationService } from "../../services/task-registration-service.js?v=20260731.V1_1_13";

let stopStandardRealtime = () => {};
let standardRealtimeTimer = null;
let standardRouteCleanupBound = false;

function bindStandardRouteCleanup() {
  if (standardRouteCleanupBound) return;
  standardRouteCleanupBound = true;
  document.addEventListener("v3:route-changed", event => {
    if (event.detail?.route !== "#/standard-tasks") {
      stopStandardRealtime();
      stopStandardRealtime = () => {};
      window.clearTimeout(standardRealtimeTimer);
    }
  });
}

function scheduleStandardRealtimeRefresh() {
  window.clearTimeout(standardRealtimeTimer);
  standardRealtimeTimer = window.setTimeout(() => {
    if (window.location.hash === "#/standard-tasks" && !document.getElementById("standardTaskModalRoot")) {
      reloadRoute();
    }
  }, 260);
}

function startStandardRealtime(period, registrationMode) {
  stopStandardRealtime();
  const unsubscribers = [];
  const watchAfterInitial = subscribe => {
    let initial = true;
    const unsubscribe = subscribe(() => {
      if (initial) { initial = false; return; }
      scheduleStandardRealtimeRefresh();
    }, error => console.warn("Theo dõi danh mục bị gián đoạn:", error));
    unsubscribers.push(unsubscribe);
  };

  watchAfterInitial((onData, onError) => StandardTaskReadService.subscribe(onData, onError));
  watchAfterInitial((onData, onError) => PeriodReadService.subscribe(onData, onError));
  if (registrationMode && period?.id) {
    watchAfterInitial((onData, onError) => TaskRegistrationService.subscribeForCurrentUser(period.id, onData, onError));
    watchAfterInitial((onData, onError) => TaskRegistrationService.subscribeDepartmentPlan(period.id, onData, onError));
  }

  stopStandardRealtime = () => unsubscribers.forEach(unsubscribe => {
    try { unsubscribe?.(); } catch (_) { /* Không cần xử lý khi đổi trang. */ }
  });
}

export async function renderStandardTasksView(outlet) {
  bindStandardRouteCleanup();
  stopStandardRealtime();
  stopStandardRealtime = () => {};
  const user = UserContext.requireUser();
  outlet.innerHTML = loadingCard("Đang tải danh mục công việc…");

  try {
    const [items, period, catalogAccess] = await Promise.all([
      StandardTaskReadService.list(),
      TaskRegistrationService.getActivePeriod(),
      StandardTaskWriteService.getAccess()
    ]);

    const plan = period ? await TaskRegistrationService.getDepartmentPlan(period.id) : null;
    const catalogItems = items;
    const registrationMode = Permissions.canRegisterStandardTasks();
    const registrations = registrationMode && period
      ? await TaskRegistrationService.listForCurrentUser(period.id)
      : [];
    const registeredMap = createRegistrationMap(registrations);
    const approvedCancellationMap = registrationMode && registrations.length
      ? await TaskRegistrationService.getApprovedCancellationMap(registrations)
      : {};
    const registrationOpen = Boolean(period && plan?.locked !== true);
    const registeredCount = catalogItems.filter(item => findRegistration(item, registeredMap)).length;
    const availableCount = Math.max(catalogItems.length - registeredCount, 0);
    const regularCount = catalogItems.filter(item => !isUnexpectedTask(item)).length;
    const unexpectedCount = catalogItems.filter(isUnexpectedTask).length;

    outlet.innerHTML = `<section class="page-card standard-task-page">
      <div class="page-header">
        <div>
          <h2>${registrationMode ? "Đăng ký kế hoạch công việc" : "Danh mục công việc"}</h2>
          <p>${registrationMode
            ? "Chọn đầu việc ở cột Danh mục công việc; các đầu việc đã gửi sẽ tự chuyển sang cột Đã đăng ký."
            : "Tra cứu danh mục công việc theo vị trí việc làm."}</p>
        </div>
        <div class="standard-task-header-actions">
          ${catalogAccess.canManage ? '<button id="btnAddStandardTask" class="primary-button" type="button">＋ Thêm đầu việc</button>' : ""}
          ${catalogAccess.isDepartmentHead ? '<button id="btnDelegateCatalogEditor" class="secondary-button" type="button">👤 Ủy quyền nhập danh mục</button>' : ""}
          <button id="btnStandardRefresh" class="secondary-button" type="button">↻ Cập nhật</button>
        </div>
      </div>

      <div class="info-banner standard-task-period-banner">
        <span>Phòng/Khu: <strong>${escapeHtml(user.departmentId || "Toàn hệ thống")}</strong></span>
        <span>${period ? `Kỳ hiện tại: <strong>${escapeHtml(period.name || period.id)}</strong>` : "<strong>Chưa có kỳ hoạt động.</strong>"}</span>
        ${period ? `<span>Đăng ký: <strong>${registrationOpen ? "Đang mở" : "Đã khóa"}</strong></span>` : ""}
        ${catalogAccess.canManage ? `<span>Quản lý danh mục: <strong>${catalogAccess.isDepartmentHead ? "Trưởng phòng" : "Được ủy quyền"}</strong></span>` : ""}
      </div>

      <div class="summary-grid compact-grid standard-task-summary">
        ${metric("Tổng đầu việc", catalogItems.length)}
        ${metric("Chưa đăng ký", availableCount)}
        ${metric("Đã đăng ký", registeredCount)}
        ${metric("Đã duyệt", registrations.filter(item => item.status === "APPROVED").length)}
      </div>

      <div class="toolbar standard-task-toolbar">
        <label class="field-grow"><span>Tìm kiếm</span><input id="standardTaskSearch" type="search" placeholder="Tìm theo mã, tên đầu việc, tần suất hoặc sản phẩm đầu ra…"></label>
        <label><span>Loại công việc</span><select id="standardTaskTypeFilter">
          <option value="ALL">Tất cả (${catalogItems.length})</option>
          <option value="THUONG_XUYEN">Thường xuyên (${regularCount})</option>
          <option value="DOT_XUAT">Đột xuất (${unexpectedCount})</option>
        </select></label>
      </div>

      <div id="standardTaskListContainer"></div>

      ${registrationMode ? `<div class="registration-sticky">
        <div>
          <strong>Đã chọn: <span id="registrationSelectedCount">0</span> đầu việc · Điểm A dự kiến: <span id="registrationSelectedScore">0</span></strong>
          <small>${registrationOpen ? "Kiểm tra đầu việc và tổng điểm dự kiến trước khi gửi đăng ký." : "Đăng ký kế hoạch của Phòng/Khu đang được khóa. Trưởng phòng cần mở lại đăng ký trước khi người dùng đăng ký."}</small>
        </div>
        <button id="btnRegisterSelected" class="primary-button" type="button" ${registrationOpen ? "" : "disabled"}>Đăng ký đầu việc đã chọn</button>
      </div>` : ""}
    </section>`;

    const search = document.getElementById("standardTaskSearch");
    const listContainer = document.getElementById("standardTaskListContainer");
    const typeFilter = document.getElementById("standardTaskTypeFilter");

    const updateCount = () => {
      const selectedInputs = [...document.querySelectorAll("[data-registration-check]:checked")];
      const ids = selectedInputs.map(input => input.value);
      const countTarget = document.getElementById("registrationSelectedCount");
      if (countTarget) countTarget.textContent = String(ids.length);

      const score = catalogItems
        .filter(item => ids.includes(taskKey(item)))
        .reduce((sum, item) => sum + Number(item.maximumConvertedScore || item.baseScore || 0), 0);
      const scoreTarget = document.getElementById("registrationSelectedScore");
      if (scoreTarget) scoreTarget.textContent = formatNumber(score);
    };

    const bindListActions = () => {
      document.querySelectorAll("[data-registration-check]").forEach(input => {
        input.addEventListener("change", updateCount);
      });

      document.querySelectorAll("[data-delete-registration]").forEach(button => {
        button.addEventListener("click", async () => {
          const registration = registrations.find(item => item.id === button.dataset.deleteRegistration);
          if (!registration) return;

          const confirmation = registration.status === "REJECTED"
            ? "Xóa đăng ký đã được trả lại để chọn đầu việc này lại?"
            : "Hủy đăng ký đang chờ duyệt?";
          if (!window.confirm(confirmation)) return;

          button.disabled = true;
          try {
            await TaskRegistrationService.cancelRegistration(registration);
            ToastService.success("Đã hủy đăng ký. Đầu việc đã trở lại danh mục để lựa chọn.");
            reloadRoute();
          } catch (error) {
            ToastService.error(error.message || "Không hủy được đăng ký.");
            button.disabled = false;
          }
        });
      });

      document.querySelectorAll("[data-cancel-approved-registration]").forEach(button => {
        button.addEventListener("click", async () => {
          const registration = registrations.find(item => item.id === button.dataset.cancelApprovedRegistration);
          if (!registration) return;

          const reason = window.prompt(
            "Nhập lý do hủy đầu việc đã duyệt. Chỉ được hủy khi nhiệm vụ chưa được tiếp nhận và chưa phát sinh tiến độ hoặc minh chứng.",
            "Đăng ký nhầm đầu việc"
          );
          if (reason === null) return;
          if (!String(reason).trim()) {
            ToastService.error("Vui lòng nhập lý do hủy đầu việc.");
            return;
          }
          if (!window.confirm("Xác nhận hủy đầu việc đã duyệt và đưa đầu việc trở lại danh mục lựa chọn?")) return;

          button.disabled = true;
          try {
            await TaskRegistrationService.cancelApprovedRegistration(registration, reason);
            ToastService.success("Đã hủy đầu việc đã duyệt. Đầu việc đã trở lại danh mục để lựa chọn.");
            reloadRoute();
          } catch (error) {
            ToastService.error(error.message || "Không hủy được đầu việc đã duyệt.");
            button.disabled = false;
          }
        });
      });

      document.querySelectorAll("[data-edit-standard-task]").forEach(button => {
        button.addEventListener("click", () => {
          const item = catalogItems.find(task => task.id === button.dataset.editStandardTask);
          if (item) openTaskEditor(item);
        });
      });

      document.querySelectorAll("[data-delete-standard-task]").forEach(button => {
        button.addEventListener("click", async () => {
          const item = catalogItems.find(task => task.id === button.dataset.deleteStandardTask);
          if (!item) return;
          await confirmAndRemoveStandardTask(item, button);
        });
      });

      updateCount();
    };

    const renderCurrentLists = () => {
      const keyword = String(search?.value || "").trim().toLowerCase();
      const selectedType = String(typeFilter?.value || "ALL").toUpperCase();
      const visibleItems = catalogItems.filter(item => {
        const typeMatches = selectedType === "ALL" || normalizedWorkType(item) === selectedType;
        const textMatches = [item.code, item.name, item.outputRequirement, item.frequency, workTypeLabel(item)]
          .join(" ")
          .toLowerCase()
          .includes(keyword);
        return typeMatches && textMatches;
      });

      listContainer.innerHTML = registrationMode
        ? renderRegistrationWorkspace(visibleItems, registeredMap, registrationOpen, catalogAccess.canManage, approvedCancellationMap)
        : renderCatalogList(visibleItems, catalogAccess.canManage);
      bindListActions();
    };

    search?.addEventListener("input", renderCurrentLists);
    typeFilter?.addEventListener("change", renderCurrentLists);
    document.getElementById("btnStandardRefresh")?.addEventListener("click", reloadRoute);
    document.getElementById("btnAddStandardTask")?.addEventListener("click", () => openTaskEditor(null));
    document.getElementById("btnDelegateCatalogEditor")?.addEventListener("click", () => openCatalogDelegation(catalogAccess.delegation, period));

    document.getElementById("btnRegisterSelected")?.addEventListener("click", async () => {
      const ids = [...document.querySelectorAll("[data-registration-check]:checked")].map(input => input.value);
      const selected = catalogItems.filter(item => ids.includes(taskKey(item)));
      if (!selected.length) return ToastService.error("Hãy chọn ít nhất một đầu việc ở cột Danh mục công việc.");

      const button = document.getElementById("btnRegisterSelected");
      button.disabled = true;
      try {
        const count = await TaskRegistrationService.registerMany(selected, period);
        ToastService.success(`Đã gửi đăng ký ${count} đầu việc chờ duyệt.`);
        reloadRoute();
      } catch (error) {
        ToastService.error(error.message || "Không đăng ký được đầu việc.");
        button.disabled = false;
      }
    });

    renderCurrentLists();
    startStandardRealtime(period, registrationMode);
  } catch (error) {
    outlet.innerHTML = errorCard("Không thể tải danh mục công việc", error);
  }
}

function renderRegistrationWorkspace(items, registeredMap, registrationOpen, canManageCatalog, approvedCancellationMap = {}) {
  const availableItems = items.filter(item => !findRegistration(item, registeredMap));
  const registeredItems = items.filter(item => findRegistration(item, registeredMap));

  return `<div class="registration-workspace">
    <section class="registration-column registration-column-catalog">
      <header class="registration-column-header">
        <div class="registration-column-icon" aria-hidden="true">📚</div>
        <div>
          <h3>Danh mục công việc</h3>
          <p>Chọn các đầu việc dự kiến thực hiện trong kỳ.</p>
        </div>
        <span class="registration-column-count">${availableItems.length}</span>
      </header>
      <div class="registration-column-list">
        ${availableItems.length
          ? availableItems.map(item => renderAvailableTask(item, registrationOpen, canManageCatalog)).join("")
          : compactEmpty("Không còn đầu việc phù hợp", "Các đầu việc đang hiển thị đã được đăng ký.")}
      </div>
    </section>

    <section class="registration-column registration-column-selected">
      <header class="registration-column-header">
        <div class="registration-column-icon" aria-hidden="true">✅</div>
        <div>
          <h3>Đã đăng ký</h3>
          <p>Theo dõi trạng thái các đầu việc đã chọn trong kỳ.</p>
        </div>
        <span class="registration-column-count">${registeredItems.length}</span>
      </header>
      <div class="registration-column-list">
        ${registeredItems.length
          ? registeredItems.map(item => renderRegisteredTask(item, findRegistration(item, registeredMap), registrationOpen, canManageCatalog, approvedCancellationMap)).join("")
          : compactEmpty("Chưa có đầu việc đã đăng ký", "Đầu việc được chọn ở cột bên trái sẽ xuất hiện tại đây.")}
      </div>
    </section>
  </div>`;
}

function renderAvailableTask(item, registrationOpen, canManageCatalog) {
  const key = taskKey(item);
  return `<article class="registration-row registration-row-available">
    <label class="registration-check" title="Chọn đầu việc">
      <input type="checkbox" data-registration-check value="${escapeHtml(key)}" ${registrationOpen ? "" : "disabled"}>
      <span></span>
    </label>
    <div class="data-row-main">
      <strong>${escapeHtml(item.code || item.id)} — ${escapeHtml(item.name || "")}</strong>
      <small>${escapeHtml(item.outputRequirement || "")}</small>
      <div class="standard-task-tags">${workTypeBadge(item)}${item.frequency ? `<span class="status-pill neutral">${escapeHtml(item.frequency)}</span>` : ""}</div>
    </div>
    <div class="data-row-meta">
      <span class="status-pill neutral">Chưa đăng ký</span>
      <small>Điểm tối đa: ${formatNumber(item.maximumConvertedScore || 0)}</small>
      ${catalogActionButtons(item, canManageCatalog)}
    </div>
  </article>`;
}

function renderRegisteredTask(item, registration, registrationOpen, canManageCatalog, approvedCancellationMap = {}) {
  const status = ({
    PENDING: "Chờ duyệt",
    APPROVED: "Đã duyệt",
    REJECTED: "Đã trả lại"
  }[registration?.status] || registration?.status || "Đã đăng ký");
  const statusClass = registration?.status === "APPROVED"
    ? "success"
    : registration?.status === "PENDING"
      ? "warning"
      : registration?.status === "REJECTED"
        ? "danger"
        : "neutral";
  const canDelete = Boolean(
    registrationOpen &&
    Permissions.canCancelOwnRegistration(registration, false)
  );
  const canCancelApproved = Boolean(
    registration?.status === "APPROVED" &&
    approvedCancellationMap?.[registration.id] === true
  );

  return `<article class="registration-row registration-row-registered">
    <div class="registration-state-mark" aria-hidden="true">${registration?.status === "APPROVED" ? "✓" : registration?.status === "REJECTED" ? "↩" : "⌛"}</div>
    <div class="data-row-main">
      <strong>${escapeHtml(item.code || item.id)} — ${escapeHtml(item.name || "")}</strong>
      <small>${escapeHtml(item.outputRequirement || "")}</small>
      <div class="standard-task-tags">${workTypeBadge(item)}${item.frequency ? `<span class="status-pill neutral">${escapeHtml(item.frequency)}</span>` : ""}</div>
      ${registration?.rejectionReason ? `<small class="text-danger">Lý do trả lại: ${escapeHtml(registration.rejectionReason)}</small>` : ""}
    </div>
    <div class="data-row-meta">
      <span class="status-pill ${statusClass}">${escapeHtml(status)}</span>
      <small>Điểm tối đa: ${formatNumber(item.maximumConvertedScore || 0)}</small>
      ${canDelete ? `<button class="registration-delete-button" type="button" data-delete-registration="${escapeHtml(registration.id)}">Hủy đăng ký</button>` : ""}
      ${canCancelApproved ? `<button class="registration-cancel-approved-button" type="button" data-cancel-approved-registration="${escapeHtml(registration.id)}">Hủy đầu việc</button>` : ""}
      ${catalogActionButtons(item, canManageCatalog)}
    </div>
  </article>`;
}

function renderCatalogList(items, canManageCatalog) {
  if (!items.length) return compactEmpty("Không có đầu việc phù hợp", "Hãy thay đổi nội dung tìm kiếm.");
  return `<div class="registration-list">${items.map(item => `<article class="registration-row registration-row-catalog-only">
    <div class="registration-state-mark" aria-hidden="true">📄</div>
    <div class="data-row-main">
      <strong>${escapeHtml(item.code || item.id)} — ${escapeHtml(item.name || "")}</strong>
      <small>${escapeHtml(item.outputRequirement || "")}</small>
      <div class="standard-task-tags">${workTypeBadge(item)}${item.frequency ? `<span class="status-pill neutral">${escapeHtml(item.frequency)}</span>` : ""}</div>
    </div>
    <div class="data-row-meta">
      <small>Điểm tối đa: ${formatNumber(item.maximumConvertedScore || 0)}</small>
      ${catalogActionButtons(item, canManageCatalog)}
    </div>
  </article>`).join("")}</div>`;
}

function catalogActionButtons(item, canManageCatalog) {
  if (!canManageCatalog) return "";
  return `<div class="catalog-row-actions">
    <button class="catalog-edit-button" type="button" data-edit-standard-task="${escapeHtml(item.id)}">Sửa</button>
    <button class="catalog-delete-button" type="button" data-delete-standard-task="${escapeHtml(item.id)}">Xóa</button>
  </div>`;
}

async function confirmAndRemoveStandardTask(item, button = null, modalRoot = null) {
  const code = item?.code || item?.id || "đầu việc";
  if (!window.confirm(
    `Xóa ${code} khỏi danh mục đang sử dụng?

` +
    "Nếu đầu việc chưa phát sinh đăng ký hoặc nhiệm vụ, dữ liệu sẽ được xóa. " +
    "Nếu đã có lịch sử, hệ thống chỉ đưa ra khỏi danh mục hiện hành để không làm mất báo cáo cũ."
  )) return false;

  if (button) button.disabled = true;
  try {
    const result = await StandardTaskWriteService.removeTask(item);
    modalRoot && closeStandardModal(modalRoot);
    ToastService.success(
      result.mode === "DELETED"
        ? "Đã xóa đầu việc khỏi danh mục và Firestore."
        : "Đã đưa đầu việc khỏi danh mục hiện hành; lịch sử cũ vẫn được giữ."
    );
    reloadRoute();
    return true;
  } catch (error) {
    ToastService.error(error.message || "Không xóa được đầu việc.");
    if (button) button.disabled = false;
    return false;
  }
}

function openTaskEditor(item) {
  const editing = Boolean(item?.id);
  const currentWorkType = String(item?.workType || "THUONG_XUYEN").toUpperCase() === "DOT_XUAT"
    ? "DOT_XUAT"
    : "THUONG_XUYEN";
  const root = openStandardModal(
    editing ? "Cập nhật đầu việc chuẩn" : "Thêm đầu việc chuẩn",
    `<div class="standard-task-editor-intro">
      <strong>${editing ? "Cập nhật trực tiếp trên hệ thống" : "Tạo đầu việc mới cho Phòng/Khu"}</strong>
      <span>Dữ liệu được lưu vào Firestore. Google Sheet có thể nhận lại bằng chức năng đồng bộ từ Firestore hoặc lịch đồng bộ tự động.</span>
    </div>
    <div class="kpi-form-grid standard-task-editor-form">
      <label class="kpi-field"><span>Mã đầu việc</span><input id="catalogTaskCode" value="${escapeHtml(item?.code || "")}" ${editing ? "disabled" : ""} placeholder="Ví dụ: TCHC29"></label>
      <label class="kpi-field"><span>Tính chất</span><select id="catalogTaskWorkType"><option value="THUONG_XUYEN" ${currentWorkType === "THUONG_XUYEN" ? "selected" : ""}>Thường xuyên</option><option value="DOT_XUAT" ${currentWorkType === "DOT_XUAT" ? "selected" : ""}>Đột xuất</option></select></label>
      <label class="kpi-field full"><span>Tên đầu việc</span><input id="catalogTaskName" value="${escapeHtml(item?.name || "")}" placeholder="Nhập tên đầu việc"></label>
      <label class="kpi-field full"><span>Kết quả đầu ra/Yêu cầu hoàn thành</span><textarea id="catalogTaskOutput" rows="3" placeholder="Nêu sản phẩm hoặc kết quả phải đạt">${escapeHtml(item?.outputRequirement || "")}</textarea></label>
      <label class="kpi-field full"><span>Chu kỳ/Tần suất</span><input id="catalogTaskFrequency" value="${escapeHtml(item?.frequency || "")}" placeholder="Ví dụ: Theo tháng, theo hồ sơ, khi phát sinh"></label>
      <label class="kpi-field full"><span>Minh chứng bắt buộc</span><textarea id="catalogTaskEvidence" rows="2" placeholder="Nêu loại hồ sơ, báo cáo hoặc tài liệu bắt buộc">${escapeHtml(item?.mandatoryEvidence || "")}</textarea></label>
      <label class="kpi-field full"><span>Minh chứng phát sinh</span><textarea id="catalogTaskArisingEvidence" rows="2" placeholder="Không bắt buộc; chỉ nhập khi có loại minh chứng phát sinh">${escapeHtml(item?.arisingEvidence || "")}</textarea></label>
      <label class="kpi-field"><span>Điểm chuẩn</span><input id="catalogTaskBaseScore" type="number" value="${escapeHtml(item?.baseScore ?? (currentWorkType === "DOT_XUAT" ? 12 : 10))}" readonly></label>
      <label class="kpi-field"><span>Hệ số độ khó</span><select id="catalogTaskCoefficient">
        <option value="1" ${Math.abs(Number(item?.difficultyCoefficient ?? 1) - 1) < 0.000001 ? "selected" : ""}>100%</option>
        <option value="1.1" ${Math.abs(Number(item?.difficultyCoefficient ?? 1) - 1.1) < 0.000001 ? "selected" : ""}>110%</option>
        <option value="1.2" ${Math.abs(Number(item?.difficultyCoefficient ?? 1) - 1.2) < 0.000001 ? "selected" : ""}>120%</option>
      </select></label>
      <label class="kpi-field"><span>Thứ tự hiển thị</span><input id="catalogTaskOrder" type="number" min="1" step="1" value="${escapeHtml(item?.order ?? 9999)}"></label>
      <div class="kpi-field standard-task-score-preview"><span>Điểm tối đa</span><strong id="catalogTaskMaximum">${formatNumber(Number(item?.baseScore || (currentWorkType === "DOT_XUAT" ? 12 : 10)) * Number(item?.difficultyCoefficient || 1))}</strong></div>
      <label class="standard-task-check"><input id="catalogTaskCore" type="checkbox" ${item?.isCoreTaskDefault === true ? "checked" : ""}><span>Đầu việc cốt lõi</span></label>
      <label class="standard-task-check"><input id="catalogTaskManagement" type="checkbox" ${item?.isManagementTask === true ? "checked" : ""}><span>Dành cho lãnh đạo, quản lý</span></label>
    </div>`,
    `${editing ? '<button id="deleteCatalogTask" class="kpi-button danger" type="button">Xóa danh mục</button>' : ""}<button class="kpi-button secondary" data-standard-close type="button">Đóng</button><button id="saveCatalogTask" class="kpi-button" type="button">Lưu đầu việc</button>`
  );

  const recalculate = () => {
    const base = Number(document.getElementById("catalogTaskBaseScore")?.value || 0);
    const coefficient = Number(document.getElementById("catalogTaskCoefficient")?.value || 0);
    const target = document.getElementById("catalogTaskMaximum");
    if (target) target.textContent = formatNumber(base * coefficient);
  };
  const syncBaseScoreWithWorkType = () => {
    const workType = String(document.getElementById("catalogTaskWorkType")?.value || "THUONG_XUYEN").toUpperCase();
    const baseInput = document.getElementById("catalogTaskBaseScore");
    if (baseInput) baseInput.value = workType === "DOT_XUAT" ? "12" : "10";
    recalculate();
  };
  document.getElementById("catalogTaskWorkType")?.addEventListener("change", syncBaseScoreWithWorkType);
  document.getElementById("catalogTaskCoefficient")?.addEventListener("change", recalculate);
  recalculate();

  root.querySelector("#saveCatalogTask")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await StandardTaskWriteService.saveTask({
        code: document.getElementById("catalogTaskCode")?.value,
        name: document.getElementById("catalogTaskName")?.value,
        frequency: document.getElementById("catalogTaskFrequency")?.value,
        workType: document.getElementById("catalogTaskWorkType")?.value,
        outputRequirement: document.getElementById("catalogTaskOutput")?.value,
        mandatoryEvidence: document.getElementById("catalogTaskEvidence")?.value,
        arisingEvidence: document.getElementById("catalogTaskArisingEvidence")?.value,
        baseScore: document.getElementById("catalogTaskBaseScore")?.value,
        difficultyCoefficient: document.getElementById("catalogTaskCoefficient")?.value,
        order: document.getElementById("catalogTaskOrder")?.value,
        isCoreTaskDefault: document.getElementById("catalogTaskCore")?.checked === true,
        isManagementTask: document.getElementById("catalogTaskManagement")?.checked === true
      }, item?.id || "");
      closeStandardModal(root);
      ToastService.success(editing ? "Đã cập nhật đầu việc." : "Đã thêm đầu việc vào danh mục.");
      reloadRoute();
    } catch (error) {
      ToastService.error(error.message || "Không lưu được đầu việc.");
      button.disabled = false;
    }
  });

  root.querySelector("#deleteCatalogTask")?.addEventListener("click", async event => {
    await confirmAndRemoveStandardTask(item, event.currentTarget, root);
  });
}

async function openCatalogDelegation(currentDelegation, period) {
  try {
    const candidates = await StandardTaskWriteService.listDelegationCandidates();
    const active = currentDelegation?.active === true ? currentDelegation : null;
    const today = StandardTaskWriteService.todayKey();
    const defaultEnd = period?.endDate || addDays(today, 30);
    const root = openStandardModal(
      "Ủy quyền nhập danh mục công việc",
      `<div class="kpi-form-grid standard-task-delegation-form">
        <label class="kpi-field full"><span>Nhân viên được ủy quyền</span><select id="catalogDelegateUser"><option value="">-- Chọn nhân viên --</option>${candidates.map(item => `<option value="${escapeHtml(item.id)}" ${active?.delegateUserId === item.id ? "selected" : ""}>${escapeHtml(item.fullName || "Chưa cập nhật họ tên")} — ${escapeHtml(item.position || "Nhân viên")}</option>`).join("")}</select></label>
        ${candidates.length ? "" : '<div class="kpi-alert full">Chưa có tài khoản nhân viên đang hoạt động trong cùng Phòng/Khu.</div>'}
        <label class="kpi-field"><span>Từ ngày</span><input id="catalogDelegateStart" type="date" value="${escapeHtml(active?.startDate || today)}"></label>
        <label class="kpi-field"><span>Đến ngày</span><input id="catalogDelegateEnd" type="date" value="${escapeHtml(active?.endDate || defaultEnd)}"></label>
        <label class="kpi-field full"><span>Lý do</span><textarea id="catalogDelegateReason" rows="3" placeholder="Ví dụ: Phân công phụ trách cập nhật danh mục đầu việc">${escapeHtml(active?.reason || "")}</textarea></label>
        <div class="info-banner full">Nhân viên được ủy quyền chỉ được thêm và chỉnh sửa đầu việc thuộc đúng Phòng/Khu; không có quyền khóa kế hoạch hoặc duyệt KPI.</div>
      </div>`,
      `${active ? '<button id="revokeCatalogDelegation" class="kpi-button danger" type="button">Hủy ủy quyền</button>' : ""}<button class="kpi-button secondary" data-standard-close type="button">Đóng</button><button id="saveCatalogDelegation" class="kpi-button" type="button">Lưu ủy quyền</button>`
    );

    root.querySelector("#saveCatalogDelegation")?.addEventListener("click", async event => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await StandardTaskWriteService.saveDelegation({
          delegateUserId: document.getElementById("catalogDelegateUser")?.value,
          startDate: document.getElementById("catalogDelegateStart")?.value,
          endDate: document.getElementById("catalogDelegateEnd")?.value,
          reason: document.getElementById("catalogDelegateReason")?.value
        });
        closeStandardModal(root);
        ToastService.success("Đã ủy quyền nhập danh mục công việc.");
        reloadRoute();
      } catch (error) {
        ToastService.error(error.message || "Không lưu được ủy quyền.");
        button.disabled = false;
      }
    });

    root.querySelector("#revokeCatalogDelegation")?.addEventListener("click", async event => {
      if (!window.confirm("Hủy ủy quyền nhập danh mục ngay bây giờ?")) return;
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await StandardTaskWriteService.revokeDelegation();
        closeStandardModal(root);
        ToastService.success("Đã hủy ủy quyền nhập danh mục.");
        reloadRoute();
      } catch (error) {
        ToastService.error(error.message || "Không hủy được ủy quyền.");
        button.disabled = false;
      }
    });
  } catch (error) {
    ToastService.error(error.message || "Không mở được chức năng ủy quyền nhập danh mục.");
  }
}

function openStandardModal(title, body, footer) {
  document.getElementById("standardTaskModalRoot")?.remove();
  const root = document.createElement("div");
  root.id = "standardTaskModalRoot";
  root.className = "kpi-modal-backdrop";
  root.innerHTML = `<section class="kpi-modal standard-task-modal" role="dialog" aria-modal="true">
    <header class="kpi-modal-head"><h2>${escapeHtml(title)}</h2><button class="kpi-button secondary" data-standard-close type="button">×</button></header>
    <div class="kpi-modal-body">${body}</div>
    <footer class="kpi-modal-foot">${footer}</footer>
  </section>`;
  root.querySelectorAll("[data-standard-close]").forEach(button => button.addEventListener("click", () => closeStandardModal(root)));
  root.addEventListener("click", event => {
    if (event.target === root) closeStandardModal(root);
  });
  document.body.appendChild(root);
  return root;
}

function closeStandardModal(root) {
  root?.remove();
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00`);
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizedWorkType(item) {
  return String(item?.workType || "THUONG_XUYEN").trim().toUpperCase() === "DOT_XUAT"
    ? "DOT_XUAT"
    : "THUONG_XUYEN";
}

function isUnexpectedTask(item) {
  return normalizedWorkType(item) === "DOT_XUAT";
}

function workTypeLabel(item) {
  return isUnexpectedTask(item) ? "Đột xuất" : "Thường xuyên";
}

function workTypeBadge(item) {
  return isUnexpectedTask(item)
    ? '<span class="status-pill warning">Đột xuất</span>'
    : '<span class="status-pill success">Thường xuyên</span>';
}

function createRegistrationMap(registrations) {
  const map = new Map();
  for (const registration of registrations) {
    const id = String(registration.standardTaskId || "");
    const code = String(registration.standardTaskCode || "");
    if (id) map.set(id, registration);
    if (code) map.set(code, registration);
  }
  return map;
}

function findRegistration(item, map) {
  return map.get(String(item.id || "")) || map.get(String(item.code || "")) || null;
}

function taskKey(item) {
  return String(item.id || item.code || "");
}

function compactEmpty(title, description) {
  return `<div class="registration-column-empty"><span aria-hidden="true">○</span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(description)}</small></div>`;
}

function metric(label, value) {
  return `<article class="summary-card"><span>${label}</span><strong>${value}</strong></article>`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(Number(value || 0));
}

function loadingCard(message) {
  return `<section class="page-card"><div class="empty-state"><div class="empty-icon">⏳</div><strong>${escapeHtml(message)}</strong></div></section>`;
}

function errorCard(title, error) {
  return `<section class="page-card error-card"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(error?.message || "Lỗi không xác định")}</p></section>`;
}

function reloadRoute() {
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
