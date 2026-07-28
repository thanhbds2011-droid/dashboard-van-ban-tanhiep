import { UserContext } from "../../core/user-context.js";
import { Permissions } from "../../core/permissions.js?v=20260728.V1_1_3";
import { ToastService } from "../../core/toast-service.js";
import { StandardTaskReadService } from "../../services/standard-task-read-service.js";
import { TaskRegistrationService } from "../../services/task-registration-service.js?v=20260728.V1_1_3";

export async function renderStandardTasksView(outlet) {
  const user = UserContext.requireUser();
  outlet.innerHTML = loadingCard("Đang tải danh mục công việc…");

  try {
    const [items, period] = await Promise.all([
      StandardTaskReadService.list(),
      TaskRegistrationService.getActivePeriod()
    ]);

    const plan = period ? await TaskRegistrationService.getDepartmentPlan(period.id) : null;
    const regularItems = items.filter(item => String(item.workType || "THUONG_XUYEN").toUpperCase() !== "DOT_XUAT");
    const registrationMode = Permissions.canRegisterStandardTasks();
    const registrations = registrationMode && period
      ? await TaskRegistrationService.listForCurrentUser(period.id)
      : [];
    const registeredMap = createRegistrationMap(registrations);
    const registrationOpen = Boolean(period && plan?.locked !== true);
    const registeredCount = regularItems.filter(item => findRegistration(item, registeredMap)).length;
    const availableCount = Math.max(regularItems.length - registeredCount, 0);

    outlet.innerHTML = `<section class="page-card standard-task-page">
      <div class="page-header">
        <div>
          <h2>${registrationMode ? "Đăng ký kế hoạch công việc" : "Danh mục công việc"}</h2>
          <p>${registrationMode
            ? "Chọn đầu việc ở cột Danh mục công việc; các đầu việc đã gửi sẽ tự chuyển sang cột Đã đăng ký."
            : "Tra cứu danh mục công việc theo vị trí việc làm."}</p>
        </div>
        <button id="btnStandardRefresh" class="secondary-button" type="button">↻ Cập nhật</button>
      </div>

      <div class="info-banner standard-task-period-banner">
        <span>Phòng/Khu: <strong>${escapeHtml(user.departmentId || "Toàn hệ thống")}</strong></span>
        <span>${period ? `Kỳ hiện tại: <strong>${escapeHtml(period.name || period.id)}</strong>` : "<strong>Chưa có kỳ hoạt động.</strong>"}</span>
        ${period ? `<span>Đăng ký: <strong>${registrationOpen ? "Đang mở" : "Đã khóa"}</strong></span>` : ""}
      </div>

      <div class="summary-grid compact-grid standard-task-summary">
        ${metric("Tổng đầu việc", regularItems.length)}
        ${metric("Chưa đăng ký", availableCount)}
        ${metric("Đã đăng ký", registeredCount)}
        ${metric("Đã duyệt", registrations.filter(item => item.status === "APPROVED").length)}
      </div>

      <div class="toolbar standard-task-toolbar">
        <label class="field-grow"><span>Tìm kiếm</span><input id="standardTaskSearch" type="search" placeholder="Tìm theo mã, tên đầu việc hoặc sản phẩm đầu ra…"></label>
      </div>

      <div id="standardTaskListContainer"></div>

      ${registrationMode ? `<div class="registration-sticky">
        <div>
          <strong>Đã chọn: <span id="registrationSelectedCount">0</span> đầu việc · Tổng điểm: <span id="registrationSelectedScore">0</span></strong>
          <small>${registrationOpen ? "Điểm kế hoạch = Điểm chuẩn × Hệ số khó." : "Đăng ký kế hoạch của Phòng/Khu đang được khóa."}</small>
        </div>
        <button id="btnRegisterSelected" class="primary-button" type="button" ${registrationOpen ? "" : "disabled"}>Đăng ký đầu việc đã chọn</button>
      </div>` : ""}
    </section>`;

    const search = document.getElementById("standardTaskSearch");
    const listContainer = document.getElementById("standardTaskListContainer");

    const updateCount = () => {
      const selectedInputs = [...document.querySelectorAll("[data-registration-check]:checked")];
      const ids = selectedInputs.map(input => input.value);
      const countTarget = document.getElementById("registrationSelectedCount");
      if (countTarget) countTarget.textContent = String(ids.length);

      const score = regularItems
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

          const message = registration.status === "REJECTED"
            ? "Xóa đăng ký đã được trả lại để chọn đầu việc này lại?"
            : "Hủy đăng ký đang chờ duyệt?";
          if (!window.confirm(message)) return;

          button.disabled = true;
          try {
            await TaskRegistrationService.cancelRegistration(registration);
            ToastService.success("Đã hủy đăng ký. Đầu việc đã trở lại danh mục để lựa chọn.");
            window.dispatchEvent(new HashChangeEvent("hashchange"));
          } catch (error) {
            ToastService.error(error.message || "Không hủy được đăng ký.");
            button.disabled = false;
          }
        });
      });

      updateCount();
    };

    const renderCurrentLists = () => {
      const keyword = String(search?.value || "").trim().toLowerCase();
      const visibleItems = regularItems.filter(item => [item.code, item.name, item.outputRequirement]
        .join(" ")
        .toLowerCase()
        .includes(keyword));

      listContainer.innerHTML = registrationMode
        ? renderRegistrationWorkspace(visibleItems, registeredMap, registrationOpen)
        : renderCatalogList(visibleItems);
      bindListActions();
    };

    search?.addEventListener("input", renderCurrentLists);
    document.getElementById("btnStandardRefresh")?.addEventListener("click", () => {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });

    document.getElementById("btnRegisterSelected")?.addEventListener("click", async () => {
      const ids = [...document.querySelectorAll("[data-registration-check]:checked")].map(input => input.value);
      const selected = regularItems.filter(item => ids.includes(taskKey(item)));
      if (!selected.length) return ToastService.error("Hãy chọn ít nhất một đầu việc ở cột Danh mục công việc.");

      const button = document.getElementById("btnRegisterSelected");
      button.disabled = true;
      try {
        const count = await TaskRegistrationService.registerMany(selected, period);
        ToastService.success(`Đã gửi đăng ký ${count} đầu việc chờ duyệt.`);
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      } catch (error) {
        ToastService.error(error.message || "Không đăng ký được đầu việc.");
        button.disabled = false;
      }
    });

    renderCurrentLists();
  } catch (error) {
    outlet.innerHTML = errorCard("Không thể tải danh mục công việc", error);
  }
}

function renderRegistrationWorkspace(items, registeredMap, registrationOpen) {
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
          ? availableItems.map(item => renderAvailableTask(item, registrationOpen)).join("")
          : compactEmpty("Không còn đầu việc phù hợp", "Các đầu việc đang hiển thị đã được đăng ký.")}
      </div>
    </section>

    <section class="registration-column registration-column-selected">
      <header class="registration-column-header">
        <div class="registration-column-icon" aria-hidden="true">✅</div>
        <div>
          <h3>Đã đăng ký</h3>
          <p>Theo dõi trạng thái và hủy mục chưa được duyệt.</p>
        </div>
        <span class="registration-column-count">${registeredItems.length}</span>
      </header>
      <div class="registration-column-list">
        ${registeredItems.length
          ? registeredItems.map(item => renderRegisteredTask(item, findRegistration(item, registeredMap))).join("")
          : compactEmpty("Chưa có đầu việc đã đăng ký", "Đầu việc được chọn ở cột bên trái sẽ xuất hiện tại đây.")}
      </div>
    </section>
  </div>`;
}

function renderAvailableTask(item, registrationOpen) {
  const key = taskKey(item);
  return `<article class="registration-row registration-row-available">
    <label class="registration-check" title="Chọn đầu việc">
      <input type="checkbox" data-registration-check value="${escapeHtml(key)}" ${registrationOpen ? "" : "disabled"}>
      <span></span>
    </label>
    <div class="data-row-main">
      <strong>${escapeHtml(item.code || item.id)} — ${escapeHtml(item.name || "")}</strong>
      <small>${escapeHtml(item.outputRequirement || "")}</small>
    </div>
    <div class="data-row-meta">
      <span class="status-pill neutral">Chưa đăng ký</span>
      <small>Điểm tối đa: ${formatNumber(item.maximumConvertedScore || 0)}</small>
    </div>
  </article>`;
}

function renderRegisteredTask(item, registration) {
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
    registration &&
    !registration.taskId &&
    ["PENDING", "REJECTED"].includes(String(registration.status || "").toUpperCase())
  );

  return `<article class="registration-row registration-row-registered">
    <div class="registration-state-mark" aria-hidden="true">${registration?.status === "APPROVED" ? "✓" : registration?.status === "REJECTED" ? "↩" : "⌛"}</div>
    <div class="data-row-main">
      <strong>${escapeHtml(item.code || item.id)} — ${escapeHtml(item.name || "")}</strong>
      <small>${escapeHtml(item.outputRequirement || "")}</small>
      ${registration?.rejectionReason ? `<small class="text-danger">Lý do trả lại: ${escapeHtml(registration.rejectionReason)}</small>` : ""}
    </div>
    <div class="data-row-meta">
      <span class="status-pill ${statusClass}">${escapeHtml(status)}</span>
      <small>Điểm tối đa: ${formatNumber(item.maximumConvertedScore || 0)}</small>
      ${canDelete ? `<button class="registration-delete-button" type="button" data-delete-registration="${escapeHtml(registration.id)}">Hủy đăng ký</button>` : ""}
    </div>
  </article>`;
}

function renderCatalogList(items) {
  if (!items.length) return compactEmpty("Không có đầu việc phù hợp", "Hãy thay đổi nội dung tìm kiếm.");
  return `<div class="registration-list">${items.map(item => `<article class="registration-row registration-row-catalog-only">
    <div class="registration-state-mark" aria-hidden="true">📄</div>
    <div class="data-row-main">
      <strong>${escapeHtml(item.code || item.id)} — ${escapeHtml(item.name || "")}</strong>
      <small>${escapeHtml(item.outputRequirement || "")}</small>
    </div>
    <div class="data-row-meta"><small>Điểm tối đa: ${formatNumber(item.maximumConvertedScore || 0)}</small></div>
  </article>`).join("")}</div>`;
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
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(Number(value || 0));
}

function loadingCard(message) {
  return `<section class="page-card"><div class="empty-state"><div class="empty-icon">⏳</div><strong>${escapeHtml(message)}</strong></div></section>`;
}

function errorCard(title, error) {
  return `<section class="page-card error-card"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(error?.message || "Lỗi không xác định")}</p></section>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
