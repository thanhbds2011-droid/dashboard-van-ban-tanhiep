import { UserContext } from "../../core/user-context.js";
import { Permissions } from "../../core/permissions.js";
import { ToastService } from "../../core/toast-service.js";
import { StandardTaskReadService } from "../../services/standard-task-read-service.js";
import { TaskRegistrationService } from "../../services/task-registration-service.js";

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
    const registeredMap = new Map(registrations.map(item => [String(item.standardTaskId || item.standardTaskCode), item]));
    const summary = StandardTaskReadService.summarize(regularItems);
    const registrationOpen = Boolean(period && plan?.locked !== true);

    outlet.innerHTML = `<section class="page-card">
      <div class="page-header">
        <div>
          <h2>${registrationMode ? "Đăng ký kế hoạch công việc" : "Danh mục công việc"}</h2>
          <p>${registrationMode ? "Chọn các đầu việc dự kiến thực hiện trong kỳ và gửi cấp có thẩm quyền duyệt." : "Tra cứu danh mục công việc theo vị trí việc làm."}</p>
        </div>
        <button id="btnStandardRefresh" class="secondary-button" type="button">↻ Cập nhật</button>
      </div>
      <div class="info-banner">
        Phạm vi: <strong>${escapeHtml(user.departmentId || "Toàn hệ thống")}</strong>.
        ${period ? `Kỳ hiện tại: <strong>${escapeHtml(period.name || period.id)}</strong>.` : "<strong>Chưa có kỳ hoạt động.</strong>"}
        ${period ? `<br>Trạng thái đăng ký: <strong>${registrationOpen ? "Đang mở đăng ký" : "Đã khóa đăng ký"}</strong>.` : ""}
      </div>
      <div class="summary-grid compact-grid">
        ${metric("Tổng đầu việc", summary.total)}
        ${metric("Đã đăng ký", registrations.filter(item => item.status !== "REJECTED").length)}
        ${metric("Chờ duyệt", registrations.filter(item => item.status === "PENDING").length)}
        ${metric("Đã duyệt", registrations.filter(item => item.status === "APPROVED").length)}
      </div>
      <div class="toolbar">
        <label class="field-grow"><span>Tìm kiếm</span><input id="standardTaskSearch" type="search" placeholder="Tìm mã, tên, sản phẩm đầu ra…"></label>
      </div>
      <div id="standardTaskListContainer">${renderList(regularItems, registeredMap, registrationMode, registrationOpen)}</div>
      ${registrationMode ? `<div class="registration-sticky"><div><strong>Đã chọn: <span id="registrationSelectedCount">0</span> đầu việc · Tổng điểm: <span id="registrationSelectedScore">0</span></strong><small>${registrationOpen ? "Điểm = Điểm chuẩn × Hệ số khó." : "Đăng ký kế hoạch của Phòng/Khu đang được khóa."}</small></div><button id="btnRegisterSelected" class="primary-button" type="button" ${registrationOpen ? "" : "disabled"}>Đăng ký kế hoạch</button></div>` : ""}
    </section>`;

    let visible = regularItems;
    const search = document.getElementById("standardTaskSearch");

    const bindListActions = () => {
      document.querySelectorAll("[data-registration-check]").forEach(input => input.addEventListener("change", updateCount));
      document.querySelectorAll("[data-delete-registration]").forEach(button => {
        button.addEventListener("click", async () => {
          const registration = registrations.find(item => item.id === button.dataset.deleteRegistration);
          if (!registration) return;
          const label = registration.status === "REJECTED" ? "Xóa đăng ký để chọn lại?" : "Xóa đăng ký đang chờ duyệt?";
          if (!window.confirm(label)) return;
          button.disabled = true;
          try {
            await TaskRegistrationService.cancelRegistration(registration);
            ToastService.success("Đã xóa đăng ký. Bạn có thể chọn lại đầu việc.");
            window.dispatchEvent(new HashChangeEvent("hashchange"));
          } catch (error) {
            ToastService.error(error.message || "Không xóa được đăng ký.");
            button.disabled = false;
          }
        });
      });
      updateCount();
    };

    const apply = () => {
      const keyword = String(search?.value || "").trim().toLowerCase();
      visible = regularItems.filter(item => [item.code, item.name, item.outputRequirement].join(" ").toLowerCase().includes(keyword));
      document.getElementById("standardTaskListContainer").innerHTML = renderList(visible, registeredMap, registrationMode, registrationOpen);
      bindListActions();
    };

    const updateCount = () => {
      const selectedInputs = [...document.querySelectorAll("[data-registration-check]:checked")];
      const ids = selectedInputs.map(input => input.value);
      const countTarget = document.getElementById("registrationSelectedCount");
      if (countTarget) countTarget.textContent = String(ids.length);
      const score = regularItems
        .filter(item => ids.includes(String(item.id || item.code)))
        .reduce((sum, item) => sum + Number(item.maximumConvertedScore || item.baseScore || 0), 0);
      const scoreTarget = document.getElementById("registrationSelectedScore");
      if (scoreTarget) scoreTarget.textContent = formatNumber(score);
    };

    search?.addEventListener("input", apply);
    document.getElementById("btnStandardRefresh")?.addEventListener("click", () => window.dispatchEvent(new HashChangeEvent("hashchange")));
    document.getElementById("btnRegisterSelected")?.addEventListener("click", async () => {
      const ids = [...document.querySelectorAll("[data-registration-check]:checked")].map(input => input.value);
      const selected = regularItems.filter(item => ids.includes(String(item.id || item.code)));
      if (!selected.length) return ToastService.error("Hãy chọn ít nhất một đầu việc.");
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

    bindListActions();
  } catch (error) {
    outlet.innerHTML = errorCard("Không thể tải danh mục công việc", error);
  }
}

function renderList(items, registeredMap, registrationMode, registrationOpen) {
  if (!items.length) return `<div class="empty-state"><div class="empty-icon">📁</div><strong>Không có đầu việc phù hợp</strong></div>`;

  return `<div class="registration-list">${items.map(item => {
    const key = String(item.id || item.code);
    const registration = registeredMap.get(key) || registeredMap.get(String(item.code));
    const disabled = !registrationMode || !registrationOpen || Boolean(registration);
    const status = registration
      ? ({ PENDING: "Chờ duyệt", APPROVED: "Đã duyệt", REJECTED: "Đã trả lại" }[registration.status] || registration.status)
      : "Chưa đăng ký";
    const canDelete = Boolean(
      registration &&
      !registration.taskId &&
      ["PENDING", "REJECTED"].includes(registration.status)
    );

    return `<article class="registration-row">
      ${registrationMode ? `<label class="registration-check"><input type="checkbox" data-registration-check value="${escapeHtml(key)}" ${disabled ? "disabled" : ""}><span></span></label>` : ""}
      <div class="data-row-main">
        <strong>${escapeHtml(item.code || item.id)} — ${escapeHtml(item.name || "")}</strong>
        <small>${escapeHtml(item.outputRequirement || "")}</small>
        ${registration?.rejectionReason ? `<small class="text-danger">Lý do trả lại: ${escapeHtml(registration.rejectionReason)}</small>` : ""}
      </div>
      <div class="data-row-meta">
        <span class="status-pill ${registration?.status === "APPROVED" ? "success" : registration?.status === "PENDING" ? "warning" : registration?.status === "REJECTED" ? "danger" : "neutral"}">${escapeHtml(status)}</span>
        <small>Điểm tối đa: ${formatNumber(item.maximumConvertedScore || 0)}</small>
        ${canDelete ? `<button class="registration-delete-button" type="button" data-delete-registration="${escapeHtml(registration.id)}">Xóa đăng ký để chọn lại</button>` : ""}
      </div>
    </article>`;
  }).join("")}</div>`;
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
