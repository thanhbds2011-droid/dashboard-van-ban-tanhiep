import { UserContext } from "../../core/user-context.js?v=20260903.V1_22_1";
import { Permissions } from "../../core/permissions.js?v=20260903.V1_22_1";
import { ToastService } from "../../core/toast-service.js?v=20260903.V1_22_1";
import { ModalService } from "../../core/modal-service.js?v=20260903.V1_22_1";
import { StandardTaskReadService } from "../../services/standard-task-read-service.js?v=20260903.V1_22_1";
import { PeriodReadService } from "../../services/period-read-service.js?v=20260903.V1_22_1";
import { StandardTaskWriteService } from "../../services/standard-task-write-service.js?v=20260903.V1_22_1";
import { TaskRegistrationService } from "../../services/task-registration-service.js?v=20260903.V1_22_1";
import { deriveDeadlinePlan, deadlineRuleDescription, requiresManualDeadline, isEventDrivenFrequency, canonicalFrequency, STANDARD_FREQUENCIES, WEEKDAY_OPTIONS } from "../../core/deadline-engine.js?v=20260903.V1_22_1";

let currentCatalogAccess = {
  canManage: false,
  canCreate: false,
  creatableDepartmentIds: [],
  authorizationByDepartment: {}
};

export async function renderStandardTasksView(outlet) {
  const user = UserContext.requireUser();
  outlet.innerHTML = loadingCard("Đang tải danh mục công việc…");

  try {
    const [items, period, catalogAccess] = await Promise.all([
      StandardTaskReadService.list(),
      TaskRegistrationService.getActivePeriod(),
      StandardTaskWriteService.getAccess()
    ]);

    const workspacePlans = period
      ? await TaskRegistrationService.getWorkspacePlans(period.id)
      : {};
    currentCatalogAccess = catalogAccess || {
      canManage: false,
      canCreate: false,
      creatableDepartmentIds: [],
      authorizationByDepartment: {}
    };
    const catalogItems = items.map(item => ({
      ...item,
      _workspaceId: StandardTaskReadService.workspaceId(item, user),
      _registrationEligible: StandardTaskReadService.canRegisterItem(item, user)
    }));
    const registrationMode = Permissions.canRegisterStandardTasks();
    const registrations = registrationMode && period
      ? await TaskRegistrationService.listForCurrentUser(period.id)
      : [];
    const registeredMap = createRegistrationMap(registrations);
    const approvedCancellationMap = registrationMode && registrations.length
      ? await TaskRegistrationService.getApprovedCancellationMap(registrations)
      : {};
    const registeredCount = catalogItems.filter(item => findRegistration(item, registeredMap)).length;
    const availableCount = catalogItems.filter(item => (
      item._registrationEligible && !findRegistration(item, registeredMap)
    )).length;
    const regularCount = catalogItems.filter(item => !isUnexpectedTask(item)).length;
    const unexpectedCount = catalogItems.filter(isUnexpectedTask).length;
    const workspaceIds = [...new Set(catalogItems.map(item => item._workspaceId))];
    const departmentIds = [...new Set(catalogItems
      .map(item => String(item.departmentId || item._workspaceId || "").trim().toUpperCase())
      .filter(Boolean))]
      .sort((a, b) => departmentName(a).localeCompare(departmentName(b), "vi"));
    const userDepartmentId = String(user.departmentId || "").trim().toUpperCase();
    const mobileViewport = window.matchMedia?.("(max-width: 760px)")?.matches === true;
    const defaultDepartmentScope = mobileViewport && departmentIds.includes(userDepartmentId)
      ? userDepartmentId
      : "ALL";
    const anyWorkspaceOpen = workspaceIds.some(id => workspacePlans[id]?.locked !== true);

    outlet.innerHTML = `<section class="page-card standard-task-page">
      <div class="page-header">
        <div>
          <h2>${registrationMode ? "Đăng ký kế hoạch công việc" : "Danh mục công việc"}</h2>
          <p>${registrationMode
            ? "Chọn các đầu việc thực hiện trong kỳ."
            : "Tra cứu danh mục công việc theo vị trí việc làm."}</p>
        </div>
        <div class="standard-task-header-actions">
          ${catalogAccess.canCreate ? '<button id="btnAddStandardTask" class="primary-button" type="button">＋ Thêm đầu việc</button>' : ""}
          ${catalogAccess.canDelegateCatalogEditor ? '<button id="btnDelegateCatalogEditor" class="secondary-button" type="button">👤 Ủy quyền nhập danh mục</button>' : ""}
          ${Permissions.canDelegateCdtnApproval() ? '<button id="btnDelegateCdtnApproval" class="secondary-button" type="button">👥 Ủy quyền duyệt Chi đoàn</button>' : ""}
          <button id="btnStandardRefresh" class="secondary-button" type="button">↻ Cập nhật</button>
        </div>
      </div>

      <div class="info-banner standard-task-period-banner">
        ${registrationMode
          ? `<span><strong>${period ? escapeHtml(period.name || period.id) : "Chưa có kỳ hoạt động"}</strong></span><span>${period ? (workspacePlans[userDepartmentId]?.locked === true ? "Đã khóa đăng ký" : "Đang mở đăng ký") : ""}</span>`
          : `<span>Đơn vị chính: <strong>${escapeHtml(user.departmentId || "Toàn hệ thống")}</strong></span><span>${period ? `Kỳ hiện tại: <strong>${escapeHtml(period.name || period.id)}</strong>` : "<strong>Chưa có kỳ hoạt động.</strong>"}</span>`}
      </div>

      <div class="summary-grid compact-grid standard-task-summary">
        ${metric("Tổng đầu việc", catalogItems.length)}
        ${metric("Chưa đăng ký", availableCount)}
        ${metric("Đã đăng ký", registeredCount)}
        ${metric("Đã duyệt", registrations.filter(item => item.status === "APPROVED").length)}
      </div>

      <div class="toolbar standard-task-toolbar standard-task-filter-panel">
        <label class="field-grow standard-task-search-field"><span>Tìm kiếm</span><input id="standardTaskSearch" type="search" placeholder="Tìm mã hoặc tên đầu việc…"></label>
        ${departmentIds.length > 1 ? `<label class="standard-task-department-filter"><span>Phòng/Khu</span><select id="standardTaskDepartmentFilter">
          <option value="ALL" ${defaultDepartmentScope === "ALL" ? "selected" : ""}>Toàn bộ đơn vị (${catalogItems.length})</option>
          ${departmentIds.map(id => `<option value="${escapeHtml(id)}" ${defaultDepartmentScope === id ? "selected" : ""}>${escapeHtml(departmentName(id))} (${catalogItems.filter(item => String(item.departmentId || item._workspaceId || "").trim().toUpperCase() === id).length})</option>`).join("")}
        </select></label>` : ""}
        <label><span>Loại công việc</span><select id="standardTaskTypeFilter">
          <option value="ALL">Tất cả</option>
          <option value="THUONG_XUYEN">Thường xuyên (${regularCount})</option>
          <option value="DOT_XUAT">Đột xuất (${unexpectedCount})</option>
        </select></label>
        ${registrationMode ? `<label><span>Đăng ký</span><select id="standardTaskRegistrationFilter">
          <option value="ALL">Tất cả</option>
          <option value="AVAILABLE">Chưa đăng ký (${availableCount})</option>
          <option value="REGISTERED">Đã đăng ký (${registeredCount})</option>
        </select></label>` : ""}
      </div>
      <div class="standard-task-filter-summary"><strong id="standardTaskVisibleCount">${catalogItems.length}</strong><span>đầu việc đang hiển thị</span></div>

      <div id="standardTaskListContainer"></div>

      ${registrationMode ? `<div class="registration-sticky">
        <div>
          <strong>Đã chọn: <span id="registrationSelectedCount">0</span> đầu việc · Điểm A dự kiến: <span id="registrationSelectedScore">0</span></strong>
          <small>${anyWorkspaceOpen ? "Chỉ các đầu việc thuộc không gian đang mở mới có thể chọn." : "Tất cả không gian đăng ký hiện đã khóa."}</small>
        </div>
        <button id="btnRegisterSelected" class="primary-button" type="button" ${anyWorkspaceOpen ? "" : "disabled"}>Đăng ký đầu việc đã chọn</button>
      </div>` : ""}
    </section>`;

    const search = document.getElementById("standardTaskSearch");
    const listContainer = document.getElementById("standardTaskListContainer");
    const typeFilter = document.getElementById("standardTaskTypeFilter");
    const departmentFilter = document.getElementById("standardTaskDepartmentFilter");
    const registrationFilter = document.getElementById("standardTaskRegistrationFilter");

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
      document.querySelectorAll("[data-registration-check]").forEach(input => input.addEventListener("change", updateCount));

      document.querySelectorAll("[data-delete-registration]").forEach(button => {
        button.addEventListener("click", async () => {
          const registration = registrations.find(item => item.id === button.dataset.deleteRegistration);
          if (!registration) return;
          const confirmation = "Hủy đăng ký đang chờ duyệt?";
          if (!await ModalService.confirm(confirmation, { title: "Xác nhận đăng ký", confirmText: "Xác nhận" })) return;
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

      document.querySelectorAll("[data-resubmit-registration]").forEach(button => {
        button.addEventListener("click", async () => {
          const registration = registrations.find(item => item.id === button.dataset.resubmitRegistration);
          if (!registration) return;
          const changes = await prepareRejectedRegistrationEdit(registration, period);
          if (!changes) return;
          button.disabled = true;
          try {
            await TaskRegistrationService.resubmitRegistration(registration, changes);
            ToastService.success("Đã chỉnh sửa và gửi lại. Đầu việc chuyển về trạng thái Chờ duyệt.");
            reloadRoute();
          } catch (error) {
            ToastService.error(error.message || "Không đăng ký lại được đầu việc.");
            button.disabled = false;
          }
        });
      });

      document.querySelectorAll("[data-cancel-approved-registration]").forEach(button => {
        button.addEventListener("click", async () => {
          const registration = registrations.find(item => item.id === button.dataset.cancelApprovedRegistration);
          if (!registration) return;
          const reason = await ModalService.prompt(
            "Bạn đang hủy đầu việc do chính mình đăng ký. Thao tác chỉ được thực hiện khi nhiệm vụ chưa hoàn thành, chưa đánh giá, chưa khóa điểm và chưa phát sinh tiến độ, lượt công việc hoặc minh chứng.",
            { title: "Hủy đầu việc đã đăng ký", label: "Lý do hủy", defaultValue: "Đăng ký nhầm đầu việc", required: true, confirmText: "Tiếp tục" }
          );
          if (reason === null) return;
          if (!String(reason).trim()) return ToastService.error("Vui lòng nhập lý do hủy đầu việc.");
          if (!await ModalService.confirm("Xác nhận hủy nhiệm vụ tự đăng ký và đưa đầu việc trở lại danh mục lựa chọn? Lịch sử thao tác vẫn được giữ để kiểm tra.", { title: "Xác nhận hủy đầu việc", confirmText: "Hủy đầu việc", danger: true })) return;
          button.disabled = true;
          try {
            await TaskRegistrationService.cancelApprovedRegistration(registration, reason);
            ToastService.success("Đã hủy đầu việc đã duyệt.");
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
          if (item) await confirmAndRemoveStandardTask(item, button);
        });
      });
      updateCount();
    };

    const renderCurrentLists = () => {
      const keyword = String(search?.value || "").trim().toLowerCase();
      const selectedType = String(typeFilter?.value || "ALL").toUpperCase();
      const selectedDepartment = String(departmentFilter?.value || defaultDepartmentScope || "ALL").toUpperCase();
      const selectedRegistration = String(registrationFilter?.value || "ALL").toUpperCase();
      const visibleItems = catalogItems.filter(item => {
        const itemDepartmentId = String(item.departmentId || item._workspaceId || "").trim().toUpperCase();
        const typeMatches = selectedType === "ALL" || normalizedWorkType(item) === selectedType;
        const departmentMatches = selectedDepartment === "ALL" || itemDepartmentId === selectedDepartment;
        const registration = findRegistration(item, registeredMap);
        const registrationMatches = selectedRegistration === "ALL"
          || (selectedRegistration === "REGISTERED" && Boolean(registration))
          || (selectedRegistration === "AVAILABLE" && item._registrationEligible && !registration);
        const textMatches = [item.code, item.name, item.outputRequirement, item.frequency, item.completionDeadline, workTypeLabel(item), departmentName(itemDepartmentId)]
          .join(" ").toLowerCase().includes(keyword);
        return typeMatches && departmentMatches && registrationMatches && textMatches;
      });
      const visibleCount = document.getElementById("standardTaskVisibleCount");
      if (visibleCount) visibleCount.textContent = String(visibleItems.length);

      if (registrationMode) {
        const groups = [...new Set(visibleItems.map(item => item._workspaceId))]
          .map(workspaceId => ({ workspaceId, items: visibleItems.filter(item => item._workspaceId === workspaceId) }));
        listContainer.innerHTML = groups.length
          ? groups.map(group => `<section class="standard-task-workspace" data-workspace="${escapeHtml(group.workspaceId)}">
              <header class="standard-task-workspace-head">
                <div><h3>${escapeHtml(workspaceName(group.workspaceId))}</h3><p><strong>${group.items.length}</strong> đầu việc</p></div>
                <span class="status-pill ${workspacePlans[group.workspaceId]?.locked === true ? "warning" : "success"}">${workspacePlans[group.workspaceId]?.locked === true ? "Đã khóa đăng ký" : "Đang mở đăng ký"}</span>
              </header>
              ${renderRegistrationWorkspace(group.items, registeredMap, workspacePlans[group.workspaceId]?.locked !== true, catalogAccess, approvedCancellationMap)}
            </section>`).join("")
          : compactEmpty("Không có đầu việc phù hợp", "Hãy thay đổi nội dung tìm kiếm.");
      } else {
        listContainer.innerHTML = departmentIds.length > 1
          ? renderCatalogGroups(visibleItems, catalogAccess)
          : renderCatalogList(visibleItems, catalogAccess);
      }
      bindListActions();
    };

    search?.addEventListener("input", renderCurrentLists);
    typeFilter?.addEventListener("change", renderCurrentLists);
    departmentFilter?.addEventListener("change", renderCurrentLists);
    registrationFilter?.addEventListener("change", renderCurrentLists);
    document.getElementById("btnStandardRefresh")?.addEventListener("click", reloadRoute);
    document.getElementById("btnAddStandardTask")?.addEventListener("click", () => openTaskEditor(null));
    document.getElementById("btnDelegateCatalogEditor")?.addEventListener("click", () => openCatalogDelegation(catalogAccess.delegation, period));
    document.getElementById("btnDelegateCdtnApproval")?.addEventListener("click", () => openCdtnApprovalDelegation(period));

    document.getElementById("btnRegisterSelected")?.addEventListener("click", async () => {
      const ids = [...document.querySelectorAll("[data-registration-check]:checked")].map(input => input.value);
      const selected = catalogItems.filter(item => ids.includes(taskKey(item)));
      if (!selected.length) return ToastService.error("Hãy chọn ít nhất một đầu việc ở cột Danh mục công việc.");
      const button = document.getElementById("btnRegisterSelected");
      button.disabled = true;
      try {
        const personalItems = await preparePersonalRegistrationDetails(selected, period);
        if (!personalItems) { button.disabled = false; return; }
        const result = await TaskRegistrationService.registerMany(selected, period, { personalItems });
        ToastService.success(result.pending
          ? `Đã đăng ký ${result.total} đầu việc: ${result.autoApproved} được duyệt ngay, ${result.pending} chờ duyệt.`
          : `Đã đăng ký và duyệt ngay ${result.total} đầu việc.`);
        reloadRoute();
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

function personalFrequencyOptions(currentValue = "") {
  const current = canonicalFrequency(currentValue) || currentValue || "Khi phát sinh";
  return STANDARD_FREQUENCIES.map(value => `<option value="${escapeHtml(value)}" ${value === current ? "selected" : ""}>${escapeHtml(value)}</option>`).join("");
}

function personalDeadlineEditorHtml(rowId, frequency = "", completionDeadline = "", fixedDeadlineDateKey = "", ceilingDateKey = "") {
  const canonical = canonicalFrequency(frequency) || frequency || "Khi phát sinh";
  const ceiling = String(ceilingDateKey || "").trim();
  const fixed = String(fixedDeadlineDateKey || "").trim();
  if (canonical === "Theo ngày") {
    return `<div class="personal-deadline-control"><input type="hidden" data-personal-completion value="Trong ngày"><span class="kpi-readonly-value">Trong ngày</span></div>`;
  }
  if (canonical === "Theo tuần") {
    const value = String(completionDeadline || "").trim();
    return `<div class="personal-deadline-control"><select data-personal-completion>${WEEKDAY_OPTIONS.map(day => `<option value="${escapeHtml(day)}" ${day === value ? "selected" : ""}>${escapeHtml(day)}</option>`).join("")}</select></div>`;
  }
  if (canonical === "Theo tháng" || canonical === "Theo quý") {
    return `<div class="personal-deadline-control"><input data-personal-completion inputmode="numeric" maxlength="2" placeholder="Ngày trong tháng, ví dụ 05" value="${escapeHtml(completionDeadline || "")}"></div>`;
  }
  if (canonical === "Theo năm") {
    return `<div class="personal-deadline-control"><input data-personal-completion maxlength="5" placeholder="DD/MM, ví dụ 31/12" value="${escapeHtml(completionDeadline || "")}"></div>`;
  }
  return `<div class="personal-deadline-control">
    <input type="hidden" data-personal-completion value="">
    <input type="date" data-personal-fixed-deadline value="${escapeHtml(fixed)}" ${ceiling ? `max="${escapeHtml(ceiling)}"` : ""}>
    <small>${ceiling ? `Nếu nhập hạn riêng, không được sau ${escapeHtml(ceiling.split("-").reverse().join("/"))}.` : "Có thể để trống; deadline sẽ bắt buộc ở từng lượt công việc thực tế."}</small>
  </div>`;
}

function preparePersonalRegistrationDetails(items = [], period = {}) {
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay standard-personalize-overlay";
    overlay.innerHTML = `<section class="modal-card standard-personalize-card" role="dialog" aria-modal="true">
      <div class="modal-header"><div><h2>Nội dung công việc cá nhân</h2><p>Một đầu việc Phòng/Khu có thể dùng trực tiếp hoặc cụ thể hóa thành nhiều nhiệm vụ cá nhân.</p></div><button class="modal-x" type="button" aria-label="Đóng">×</button></div>
      <div class="modal-body">
        <div class="standard-personalize-list">${items.map(item => {
          const key = taskKey(item);
          return `<section class="standard-personalize-item" data-personal-item="${escapeHtml(key)}" data-standard-name="${escapeHtml(item.name || "")}" data-parent-fixed="${escapeHtml(item.fixedDeadlineDateKey || "")}">
            <header class="standard-personalize-group-head">
              <div><strong>${escapeHtml(item.code || item.id)} · ${escapeHtml(item.name || "")}</strong><small>Điểm/hệ số/tính chất được kế thừa từ Danh mục Phòng/Khu và không thể thay đổi ở bước này.</small></div>
              <button type="button" class="secondary-button compact" data-add-personal-row>＋ Thêm công việc</button>
            </header>
            <div data-personal-rows></div>
          </section>`;
        }).join("")}</div>
        <div class="app-dialog-error" hidden></div>
      </div>
      <div class="modal-actions"><button class="secondary-button modal-cancel" type="button">Hủy</button><button class="primary-button modal-confirm" type="button">Tiếp tục đăng ký</button></div>
    </section>`;

    const itemByKey = new Map((items || []).map(item => [taskKey(item), item]));
    const nextRowId = () => (globalThis.crypto?.randomUUID?.() || `item_${Date.now()}_${Math.random().toString(36).slice(2,8)}`).replace(/[^A-Za-z0-9_-]/g, "_");

    const addRow = (section, values = {}, isFirst = false) => {
      const key = section.dataset.personalItem || "";
      const item = itemByKey.get(key) || {};
      const rowId = values.personalItemId || nextRowId();
      const frequency = canonicalFrequency(values.frequency || item.frequency) || values.frequency || item.frequency || "Khi phát sinh";
      const parentFixed = String(item.fixedDeadlineDateKey || "").trim();
      const defaultFixed = String(values.fixedDeadlineDateKey || (isFirst ? parentFixed : "")).trim();
      const completion = values.completionDeadline !== undefined ? values.completionDeadline : item.completionDeadline || "";
      const row = document.createElement("article");
      row.className = "standard-personal-row";
      row.dataset.personalRow = rowId;
      row.innerHTML = `<div class="standard-personal-row-head"><strong>${isFirst ? "Công việc cá nhân" : "Công việc bổ sung"}</strong>${isFirst ? "" : '<button type="button" class="icon-button danger" data-remove-personal-row aria-label="Xóa công việc">×</button>'}</div>
        <label><span>Nội dung thực hiện</span><input data-personal-title maxlength="1000" value="${escapeHtml(values.title ?? item.name ?? "")}"></label>
        <label><span>Kết quả đầu ra</span><textarea data-personal-description rows="2" maxlength="3000">${escapeHtml(values.description ?? item.outputRequirement ?? "")}</textarea></label>
        <div class="standard-personal-row-grid">
          <label><span>Chu kỳ/Tần suất</span><select data-personal-frequency>${personalFrequencyOptions(frequency)}</select></label>
          <label><span>Thời hạn</span><div data-personal-deadline-host>${personalDeadlineEditorHtml(rowId, frequency, completion, defaultFixed, parentFixed)}</div></label>
        </div>`;
      section.querySelector("[data-personal-rows]")?.appendChild(row);
      row.querySelector("[data-remove-personal-row]")?.addEventListener("click", () => row.remove());
      row.querySelector("[data-personal-frequency]")?.addEventListener("change", event => {
        const nextFrequency = event.currentTarget.value;
        const host = row.querySelector("[data-personal-deadline-host]");
        if (host) host.innerHTML = personalDeadlineEditorHtml(rowId, nextFrequency, "", "", parentFixed);
      });
    };

    overlay.querySelectorAll("[data-personal-item]").forEach(section => {
      const item = itemByKey.get(section.dataset.personalItem || "") || {};
      addRow(section, {
        title: item.name || "",
        description: item.outputRequirement || "",
        frequency: item.frequency || "",
        completionDeadline: item.completionDeadline || "",
        fixedDeadlineDateKey: item.fixedDeadlineDateKey || ""
      }, true);
      section.querySelector("[data-add-personal-row]")?.addEventListener("click", () => {
        addRow(section, {
          title: "",
          description: "",
          frequency: item.frequency || "",
          completionDeadline: item.completionDeadline || ""
        }, false);
        section.querySelector("[data-personal-rows]")?.lastElementChild?.querySelector("[data-personal-title]")?.focus();
      });
    });

    const finish = value => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("modal-open");
      overlay.classList.remove("modal-visible");
      window.setTimeout(() => overlay.remove(), 160);
      resolve(value);
    };

    const submit = () => {
      try {
        const result = {};
        overlay.querySelectorAll("[data-personal-item]").forEach(section => {
          const key = section.dataset.personalItem || "";
          const item = itemByKey.get(key) || {};
          const rows = [...section.querySelectorAll("[data-personal-row]")];
          if (!rows.length) throw new Error(`Nhóm ${item.code || item.name || ""} phải có ít nhất một công việc cá nhân.`);
          const grouped = rows.length > 1;
          result[key] = rows.map((row, index) => {
            const titleInput = row.querySelector("[data-personal-title]");
            const title = String(titleInput?.value || "").trim();
            const description = String(row.querySelector("[data-personal-description]")?.value || "").trim();
            const frequency = canonicalFrequency(row.querySelector("[data-personal-frequency]")?.value || "") || "";
            const completionDeadline = String(row.querySelector("[data-personal-completion]")?.value || "").trim();
            let fixedDeadlineDateKey = String(row.querySelector("[data-personal-fixed-deadline]")?.value || "").trim();
            const parentFixed = String(item.fixedDeadlineDateKey || "").trim();
            if (!grouped && parentFixed) fixedDeadlineDateKey = parentFixed;
            if (!title) {
              titleInput?.focus();
              throw new Error("Nội dung thực hiện không được để trống.");
            }
            const effectivePeriodEndDate = parentFixed && parentFixed < String(period.endDate || "") ? parentFixed : period.endDate;
            const plan = deriveDeadlinePlan({
              frequency,
              completionDeadline,
              periodStartDate: period.startDate,
              periodEndDate: effectivePeriodEndDate,
              fixedDeadlineDateKey
            });
            if (parentFixed && plan.deadlineDateKey && plan.deadlineDateKey > parentFixed) {
              throw new Error(`Hạn của “${title}” không được vượt quá hạn Ban Giám đốc giao.`);
            }
            return {
              personalItemId: grouped ? String(row.dataset.personalRow || `item${index + 1}`) : "",
              personalizationMode: grouped ? "GROUPED" : "DIRECT",
              personalItemOrder: index + 1,
              title,
              description,
              frequency,
              completionDeadline,
              fixedDeadlineDateKey
            };
          });
        });
        finish(result);
      } catch (error) {
        const target = overlay.querySelector(".app-dialog-error");
        if (target) {
          target.hidden = false;
          target.textContent = error.message || "Thông tin công việc cá nhân chưa hợp lệ.";
        }
      }
    };

    const onKeyDown = event => { if (event.key === "Escape") finish(null); };
    overlay.querySelector(".modal-x")?.addEventListener("click", () => finish(null));
    overlay.querySelector(".modal-cancel")?.addEventListener("click", () => finish(null));
    overlay.querySelector(".modal-confirm")?.addEventListener("click", submit);
    overlay.addEventListener("click", event => { if (event.target === overlay) finish(null); });
    document.addEventListener("keydown", onKeyDown);
    document.body.appendChild(overlay);
    document.body.classList.add("modal-open");
    requestAnimationFrame(() => {
      overlay.classList.add("modal-visible");
      overlay.querySelector("[data-personal-title]")?.focus();
    });
  });
}

function prepareRejectedRegistrationEdit(registration, period = {}) {
  const pseudo = {
    id: registration.standardTaskId || registration.standardTaskCode,
    code: registration.standardTaskCode || "",
    name: registration.title || registration.standardTaskName || "",
    outputRequirement: registration.description || "",
    frequency: registration.frequency || "",
    completionDeadline: registration.completionDeadline || "",
    fixedDeadlineDateKey: registration.fixedDeadlineDateKey || "",
    deadlineCeilingDateKey: registration.deadlineCeilingDateKey || registration.fixedDeadlineDateKey || ""
  };
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay standard-personalize-overlay";
    const frequency = canonicalFrequency(pseudo.frequency) || pseudo.frequency || "Khi phát sinh";
    overlay.innerHTML = `<section class="modal-card standard-personalize-card" role="dialog" aria-modal="true">
      <div class="modal-header"><div><h2>Chỉnh sửa và đăng ký lại</h2><p>Lý do không duyệt: ${escapeHtml(registration.rejectionReason || "Không có ghi chú")}</p></div><button class="modal-x" type="button">×</button></div>
      <div class="modal-body"><div class="standard-personal-row">
        <label><span>Nội dung thực hiện</span><input data-personal-title maxlength="1000" value="${escapeHtml(pseudo.name)}"></label>
        <label><span>Kết quả đầu ra</span><textarea data-personal-description rows="3" maxlength="3000">${escapeHtml(pseudo.outputRequirement)}</textarea></label>
        <div class="standard-personal-row-grid">
          <label><span>Chu kỳ/Tần suất</span><select data-personal-frequency>${personalFrequencyOptions(frequency)}</select></label>
          <label><span>Thời hạn</span><div data-personal-deadline-host>${personalDeadlineEditorHtml("resubmit", frequency, pseudo.completionDeadline, pseudo.fixedDeadlineDateKey, pseudo.deadlineCeilingDateKey)}</div></label>
        </div>
      </div><div class="app-dialog-error" hidden></div></div>
      <div class="modal-actions"><button class="secondary-button modal-cancel" type="button">Hủy</button><button class="primary-button modal-confirm" type="button">Gửi lại</button></div>
    </section>`;
    const host = () => overlay.querySelector("[data-personal-deadline-host]");
    overlay.querySelector("[data-personal-frequency]")?.addEventListener("change", event => {
      if (host()) host().innerHTML = personalDeadlineEditorHtml("resubmit", event.currentTarget.value, "", "", pseudo.deadlineCeilingDateKey);
    });
    const finish = value => {
      document.body.classList.remove("modal-open");
      overlay.remove();
      resolve(value);
    };
    overlay.querySelector(".modal-x")?.addEventListener("click", () => finish(null));
    overlay.querySelector(".modal-cancel")?.addEventListener("click", () => finish(null));
    overlay.querySelector(".modal-confirm")?.addEventListener("click", () => {
      try {
        const title = String(overlay.querySelector("[data-personal-title]")?.value || "").trim();
        const description = String(overlay.querySelector("[data-personal-description]")?.value || "").trim();
        const nextFrequency = canonicalFrequency(overlay.querySelector("[data-personal-frequency]")?.value || "") || "";
        const completionDeadline = String(overlay.querySelector("[data-personal-completion]")?.value || "").trim();
        const fixedDeadlineDateKey = String(overlay.querySelector("[data-personal-fixed-deadline]")?.value || "").trim();
        if (!title) throw new Error("Nội dung thực hiện không được để trống.");
        const effectivePeriodEndDate = pseudo.deadlineCeilingDateKey && pseudo.deadlineCeilingDateKey < String(period.endDate || "")
          ? pseudo.deadlineCeilingDateKey
          : period.endDate;
        const plan = deriveDeadlinePlan({
          frequency: nextFrequency,
          completionDeadline,
          periodStartDate: period.startDate,
          periodEndDate: effectivePeriodEndDate,
          fixedDeadlineDateKey
        });
        if (pseudo.deadlineCeilingDateKey && plan.deadlineDateKey && plan.deadlineDateKey > pseudo.deadlineCeilingDateKey) {
          throw new Error("Hạn mới không được vượt quá hạn Ban Giám đốc giao.");
        }
        finish({ title, description, frequency: nextFrequency, completionDeadline, fixedDeadlineDateKey });
      } catch (error) {
        const target = overlay.querySelector(".app-dialog-error");
        target.hidden = false;
        target.textContent = error.message || "Thông tin chưa hợp lệ.";
      }
    });
    document.body.appendChild(overlay);
    document.body.classList.add("modal-open");
    requestAnimationFrame(() => overlay.classList.add("modal-visible"));
  });
}

function workspaceName(workspaceId) {
  return String(workspaceId || "").toUpperCase() === "CDTN"
    ? "Chi đoàn Trung tâm"
    : departmentName(workspaceId);
}

function renderRegistrationWorkspace(items, registeredMap, registrationOpen, catalogAccess, approvedCancellationMap = {}) {
  const registeredItems = items.filter(item => findRegistrations(item, registeredMap).length > 0);
  const registeredRows = registeredItems.flatMap(item => findRegistrations(item, registeredMap).map(registration => ({ item, registration })));

  return `<div class="registration-workspace">
    <section class="registration-column registration-column-catalog">
      <header class="registration-column-header">
        <div class="registration-column-icon" aria-hidden="true">📚</div>
        <div><h3>Danh mục công việc</h3></div>
        <span class="registration-column-count">${items.length}</span>
      </header>
      <div class="registration-column-list">
        ${items.length
          ? items.map(item => {
              const registrations = findRegistrations(item, registeredMap);
              const registration = findRegistration(item, registeredMap);
              return registrations.length
                ? `${renderRegisteredTask(item, registration, registrationOpen, catalogAccess, approvedCancellationMap, true)}
                   ${registrations.length > 1 ? `<small class="registration-group-summary">${registrations.length} công việc cá nhân trong nhóm này.</small>` : ""}`
                : renderAvailableTask(item, registrationOpen, catalogAccess);
            }).join("")
          : compactEmpty("Chưa có đầu việc phù hợp", "Danh mục chưa có dữ liệu đang hoạt động.")}
      </div>
    </section>

    <section class="registration-column registration-column-selected">
      <header class="registration-column-header">
        <div class="registration-column-icon" aria-hidden="true">✅</div>
        <div><h3>Đăng ký của tôi</h3></div>
        <span class="registration-column-count">${registeredRows.length}</span>
      </header>
      <div class="registration-column-list">
        ${registeredRows.length
          ? registeredRows.map(({ item, registration }) => renderRegisteredTask(item, registration, registrationOpen, catalogAccess, approvedCancellationMap, false)).join("")
          : compactEmpty("Chưa có đầu việc đã đăng ký", "Chọn đầu việc trong danh mục bên trái.")}
      </div>
    </section>
  </div>`;
}

function renderAvailableTask(item, registrationOpen, catalogAccess) {
  const key = taskKey(item);
  const registrationEligible = item._registrationEligible !== false;
  return `<article class="registration-row registration-row-available">
    <label class="registration-check" title="Chọn đầu việc">
      <input type="checkbox" data-registration-check value="${escapeHtml(key)}" ${registrationOpen && registrationEligible ? "" : "disabled"}>
      <span></span>
    </label>
    <div class="data-row-main">
      <strong>${escapeHtml(item.code || item.id)} — ${escapeHtml(item.name || "")}</strong>
      <small>${escapeHtml(item.outputRequirement || "")}</small>
      <div class="standard-task-tags">${standardTaskSourceBadge(item)}${workTypeBadge(item)}${item.frequency ? `<span class="status-pill neutral">${escapeHtml(item.frequency)}</span>` : ""}</div>
      ${registrationEligible ? "" : '<small class="registration-restriction">Đầu việc này chỉ hiển thị để tra cứu; vai trò hiện tại không thuộc đối tượng đăng ký.</small>'}
    </div>
    <div class="data-row-meta">
      <span class="status-pill neutral">Chưa đăng ký</span>
      <small>Điểm tối đa: ${formatNumber(item.maximumConvertedScore || 0)}</small>
      ${catalogActionButtons(item, catalogAccess)}
    </div>
  </article>`;
}

function renderRegisteredTask(item, registration, registrationOpen, catalogAccess, approvedCancellationMap = {}, showCatalogActions = false) {
  const status = ({
    PENDING: "Chờ duyệt",
    APPROVED: "Đã duyệt",
    REJECTED: "Không duyệt"
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
    registration?.status === "PENDING" &&
    Permissions.canCancelOwnRegistration(registration, false)
  );
  const canResubmit = Boolean(
    registrationOpen &&
    registration?.status === "REJECTED" &&
    Permissions.canResubmitOwnRegistration(registration, false)
  );
  const canCancelApproved = Boolean(
    registration?.status === "APPROVED" &&
    approvedCancellationMap?.[registration.id] === true
  );

  return `<article class="registration-row registration-row-registered">
    <div class="registration-state-mark" aria-hidden="true">${registration?.status === "APPROVED" ? "✓" : registration?.status === "REJECTED" ? "↩" : "⌛"}</div>
    <div class="data-row-main">
      <strong>${escapeHtml(item.code || item.id)} — ${escapeHtml(registration?.title || item.name || "")}</strong>
      ${registration?.title && registration.title !== item.name ? `<small>Danh mục chuẩn: ${escapeHtml(item.name || "")}</small>` : `<small>${escapeHtml(item.outputRequirement || "")}</small>`}
      <div class="standard-task-tags">${standardTaskSourceBadge(item)}${workTypeBadge(item)}${item.frequency ? `<span class="status-pill neutral">${escapeHtml(item.frequency)}</span>` : ""}</div>
      ${registration?.rejectionReason ? `<small class="text-danger">Lý do không duyệt: ${escapeHtml(registration.rejectionReason)}</small>` : ""}
    </div>
    <div class="data-row-meta">
      <span class="status-pill ${statusClass}">${escapeHtml(status)}</span>
      <small>Điểm tối đa: ${formatNumber(item.maximumConvertedScore || 0)}</small>
      ${canDelete ? `<button class="registration-delete-button" type="button" data-delete-registration="${escapeHtml(registration.id)}">Hủy đăng ký</button>` : ""}
      ${canResubmit ? `<button class="registration-resubmit-button" type="button" data-resubmit-registration="${escapeHtml(registration.id)}">Đăng ký lại</button>` : ""}
      ${canCancelApproved ? `<button class="registration-cancel-approved-button" type="button" data-cancel-approved-registration="${escapeHtml(registration.id)}">Hủy nhiệm vụ tự đăng ký</button>` : ""}
      ${showCatalogActions ? catalogActionButtons(item, catalogAccess) : ""}
    </div>
  </article>`;
}

function renderCatalogList(items, catalogAccess) {
  if (!items.length) return compactEmpty("Không có đầu việc phù hợp", "Hãy thay đổi nội dung tìm kiếm.");
  return `<div class="registration-list">${items.map(item => `<article class="registration-row registration-row-catalog-only">
    <div class="registration-state-mark" aria-hidden="true">📄</div>
    <div class="data-row-main">
      <strong>${escapeHtml(item.code || item.id)} — ${escapeHtml(item.name || "")}</strong>
      <small>${escapeHtml(item.outputRequirement || "")}</small>
      <div class="standard-task-tags">${standardTaskSourceBadge(item)}${workTypeBadge(item)}${trackingModeBadge(item)}${workItemTypeBadge(item)}${classificationBadge(item)}${audienceBadge(item)}${item.frequency ? `<span class="status-pill neutral">${escapeHtml(item.frequency)}</span>` : ""}${deadlineBadge(item)}</div>
    </div>
    <div class="data-row-meta">
      <small>Điểm tối đa: ${formatNumber(item.maximumConvertedScore || 0)}</small>
      ${catalogActionButtons(item, catalogAccess)}
    </div>
  </article>`).join("")}</div>`;
}

function renderCatalogGroups(items, catalogAccess) {
  if (!items.length) return compactEmpty("Không có đầu việc phù hợp", "Hãy chọn Phòng/Khu khác hoặc thay đổi bộ lọc.");
  const groups = [...new Set(items.map(item => String(item.departmentId || item._workspaceId || "").trim().toUpperCase()).filter(Boolean))]
    .sort((a, b) => departmentName(a).localeCompare(departmentName(b), "vi"));
  return `<div class="standard-task-catalog-groups">${groups.map(departmentId => {
    const rows = items.filter(item => String(item.departmentId || item._workspaceId || "").trim().toUpperCase() === departmentId);
    return `<section class="standard-task-workspace standard-task-catalog-group" data-workspace="${escapeHtml(departmentId)}">
      <header class="standard-task-workspace-head compact-workspace-head">
        <div><h3>${escapeHtml(workspaceName(departmentId))}</h3></div>
        <span class="status-pill neutral">${rows.length} đầu việc</span>
      </header>
      ${renderCatalogList(rows, catalogAccess)}
    </section>`;
  }).join("")}</div>`;
}

function catalogAuthorization(item) {
  const departmentId = String(item?.departmentId || "").toUpperCase();
  return currentCatalogAccess?.authorizationByDepartment?.[departmentId] || null;
}

function mayEditCatalogItem(item) {
  const authorization = catalogAuthorization(item);
  const user = UserContext.getUser();
  if (!authorization || !user) return false;
  if (authorization.canEditAll === true) return true;
  return authorization.canEditOwn === true
    && String(item?.createdByUserId || "") === String(user.uid || "");
}

function mayDeleteCatalogItem(item) {
  return catalogAuthorization(item)?.canDelete === true;
}

function catalogActionButtons(item, catalogAccess = currentCatalogAccess) {
  if (!catalogAccess) return "";
  if (String(item?.sourceType || "").toUpperCase() === "EXECUTIVE_DIRECTIVE" && !Permissions.isAdmin()) return "";
  const canEdit = mayEditCatalogItem(item);
  const canDelete = mayDeleteCatalogItem(item);
  if (!canEdit && !canDelete) return "";
  return `<div class="catalog-row-actions" aria-label="Quản trị danh mục">
    ${canEdit ? `<button class="catalog-edit-button" type="button" data-edit-standard-task="${escapeHtml(item.id)}">Sửa danh mục</button>` : ""}
    ${canDelete ? `<button class="catalog-delete-button" type="button" data-delete-standard-task="${escapeHtml(item.id)}">Xóa danh mục</button>` : ""}
  </div>`;
}

async function confirmAndRemoveStandardTask(item, button = null, modalRoot = null) {
  const code = item?.code || item?.id || "đầu việc";
  if (!await ModalService.confirm(
    `Xóa ${code} khỏi DANH MỤC CÔNG VIỆC CHUẨN? Đây không phải thao tác hủy nhiệm vụ cá nhân. Nếu đầu việc chưa phát sinh đăng ký hoặc nhiệm vụ, document danh mục sẽ được xóa. Nếu đã có lịch sử, hệ thống chỉ đưa đầu việc ra khỏi danh mục hiện hành để không làm mất báo cáo cũ.`,
    { title: "Xóa đầu việc khỏi danh mục", confirmText: "Xóa khỏi danh mục", danger: true }
  )) return false;

  if (button) button.disabled = true;
  try {
    const result = await StandardTaskWriteService.removeTask(item);
    modalRoot && closeStandardModal(modalRoot);
    ToastService.success(
      result.mode === "DELETED"
        ? "Đã xóa đầu việc khỏi Danh mục công việc."
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

function catalogFrequencyOptions(currentValue = "") {
  const current = canonicalFrequency(currentValue);
  const placeholder = current ? "" : `<option value="" selected disabled>Chọn chu kỳ/tần suất chuẩn</option>`;
  return placeholder + STANDARD_FREQUENCIES.map(value => `<option value="${escapeHtml(value)}" ${current === value ? "selected" : ""}>${escapeHtml(value)}</option>`).join("");
}

function dayOptions(selected = "", placeholder = "Chọn ngày") {
  const digits = String(selected || "").replace(/\D/g, "");
  const normalized = digits ? String(Number(digits)).padStart(2, "0") : "";
  const first = `<option value="" ${normalized ? "" : "selected"} disabled>${escapeHtml(placeholder)}</option>`;
  return first + Array.from({ length: 31 }, (_, index) => String(index + 1).padStart(2, "0"))
    .map(day => `<option value="${day}" ${day === normalized ? "selected" : ""}>Ngày ${day}</option>`).join("");
}

function yearlyParts(value = "") {
  const match = /^(\d{1,2})\/(\d{1,2})$/.exec(String(value || "").trim());
  return { day: match ? String(Number(match[1])).padStart(2, "0") : "", month: match ? String(Number(match[2])).padStart(2, "0") : "" };
}

function catalogDeadlineControlHtml(frequency, currentValue = "") {
  const canonical = canonicalFrequency(frequency);
  if (canonical === "Theo ngày") {
    return `<input id="catalogDeadlineFixedDisplay" value="Trong ngày" disabled><input id="catalogTaskCompletionDeadline" type="hidden" value="Trong ngày">`;
  }
  if (canonical === "Theo tuần") {
    const current = WEEKDAY_OPTIONS.includes(currentValue) ? currentValue : "";
    return `<select id="catalogTaskCompletionDeadline"><option value="" ${current ? "" : "selected"} disabled>Chọn thứ hoàn thành</option>${WEEKDAY_OPTIONS.map(value => `<option value="${escapeHtml(value)}" ${value === current ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}</select>`;
  }
  if (canonical === "Theo tháng" || canonical === "Theo quý") {
    return `<select id="catalogTaskCompletionDeadline">${dayOptions(currentValue, canonical === "Theo tháng" ? "Chọn ngày hằng tháng" : "Chọn ngày tháng cuối quý")}</select>`;
  }
  if (canonical === "Theo năm") {
    const parts = yearlyParts(currentValue);
    const monthOptions = `<option value="" ${parts.month ? "" : "selected"} disabled>Chọn tháng</option>` + Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0")).map(month => `<option value="${month}" ${month === parts.month ? "selected" : ""}>Tháng ${month}</option>`).join("");
    const hiddenValue = parts.day && parts.month ? `${parts.day}/${parts.month}` : "";
    return `<div class="deadline-year-selects"><select id="catalogDeadlineYearDay">${dayOptions(parts.day, "Chọn ngày")}</select><select id="catalogDeadlineYearMonth">${monthOptions}</select></div><input id="catalogTaskCompletionDeadline" type="hidden" value="${escapeHtml(hiddenValue)}">`;
  }
  if (canonical === "Khi phát sinh") {
    return `<input id="catalogDeadlineFixedDisplay" value="Nhập tại từng lượt phát sinh" disabled><input id="catalogTaskCompletionDeadline" type="hidden" value="">`;
  }
  return `<input id="catalogDeadlineFixedDisplay" value="Hãy chọn Chu kỳ/Tần suất" disabled><input id="catalogTaskCompletionDeadline" type="hidden" value="">`;
}

async function openTaskEditor(item) {
  const editing = Boolean(item?.id);
  if (editing && !mayEditCatalogItem(item)) {
    ToastService.error("Tài khoản không có quyền sửa đầu việc danh mục này.");
    return;
  }
  const manageableDepartmentIds = Array.isArray(currentCatalogAccess?.creatableDepartmentIds)
    ? currentCatalogAccess.creatableDepartmentIds
    : [];
  const initialDepartmentId = String(
    item?.departmentId || manageableDepartmentIds[0] || UserContext.getUser()?.departmentId || ""
  ).toUpperCase();

  if (!initialDepartmentId) {
    ToastService.error("Không xác định được danh mục Phòng/Khu được phép cập nhật.");
    return;
  }

  const currentWorkType = String(item?.workType || "THUONG_XUYEN").toUpperCase() === "DOT_XUAT"
    ? "DOT_XUAT"
    : "THUONG_XUYEN";

  let previewCode = item?.code || item?.id || "";
  if (!editing) {
    try {
      previewCode = await StandardTaskWriteService.getNextCode(initialDepartmentId, currentWorkType);
    } catch (error) {
      ToastService.error(error.message || "Không xác định được mã đầu việc tiếp theo.");
      return;
    }
  }
  const currentTrackingMode = String(item?.trackingMode || "FINAL_OUTPUT").toUpperCase() === "ITEMIZED"
    ? "ITEMIZED"
    : "FINAL_OUTPUT";
  const currentWorkItemType = StandardTaskWriteService.normalizeWorkItemType(
    item?.workItemType || "GENERIC"
  );
  const currentAudience = String(
    item?.audienceType || (initialDepartmentId === "CDTN" ? "CDTN_MEMBER" : "ALL_DEPARTMENT")
  ).toUpperCase();
  const currentCore = item?.isCoreTaskDefault === true;
  const currentManagement = item?.isManagementTask === true;

  const departmentOptions = manageableDepartmentIds
    .map(departmentId => `<option value="${escapeHtml(departmentId)}" ${departmentId === initialDepartmentId ? "selected" : ""}>${escapeHtml(departmentName(departmentId))}</option>`)
    .join("");
  const departmentField = editing || manageableDepartmentIds.length <= 1
    ? `<label class="kpi-field"><span>Danh mục áp dụng</span><input id="catalogTaskDepartmentDisplay" value="${escapeHtml(departmentName(initialDepartmentId))}" disabled><input id="catalogTaskDepartment" type="hidden" value="${escapeHtml(initialDepartmentId)}"></label>`
    : `<label class="kpi-field"><span>Danh mục áp dụng</span><select id="catalogTaskDepartment">${departmentOptions}</select></label>`;

  const root = openStandardModal(
    editing ? "Cập nhật đầu việc chuẩn" : "Thêm đầu việc chuẩn",
    `<div class="standard-task-editor-intro">
      <strong>${editing ? "Cập nhật trực tiếp trên hệ thống" : "Tạo đầu việc mới và cấp mã tự động"}</strong>
      <span>Mã được cấp theo từng Phòng/Khu và từng tính chất: thường xuyên dạng TCHC01; đột xuất dạng TCHC-DX01. Mã mới luôn tăng theo số lớn nhất hiện có; không quay lại 01 hoặc lấp khoảng trống.</span>
    </div>
    <div class="kpi-form-grid standard-task-editor-form">
      <div class="standard-form-section-title full"><span>1</span><div><strong>Thông tin đầu việc</strong><small>Xác định đúng tên, kết quả đầu ra và chu kỳ thực hiện.</small></div></div>
      ${departmentField}
      <label class="kpi-field"><span>Mã đầu việc</span><div class="standard-task-code-box"><input id="catalogTaskCode" value="${escapeHtml(previewCode)}" readonly autocomplete="off" spellcheck="false" aria-readonly="true"><small>Tự động tăng dần; không nhập thủ công.</small></div></label>
      <label class="kpi-field"><span>Tính chất</span><select id="catalogTaskWorkType"><option value="THUONG_XUYEN" ${currentWorkType === "THUONG_XUYEN" ? "selected" : ""}>Thường xuyên</option><option value="DOT_XUAT" ${currentWorkType === "DOT_XUAT" ? "selected" : ""}>Đột xuất</option></select></label>
      <label class="kpi-field full"><span>Tên đầu việc</span><input id="catalogTaskName" maxlength="1000" value="${escapeHtml(item?.name || "")}" placeholder="Nhập tên đầu việc"><small class="field-help">Tối đa 1.000 ký tự; nội dung được lưu đầy đủ trên Firestore.</small></label>
      <label class="kpi-field full"><span>Kết quả đầu ra/Yêu cầu hoàn thành</span><textarea id="catalogTaskOutput" rows="3" placeholder="Nêu sản phẩm hoặc kết quả phải đạt">${escapeHtml(item?.outputRequirement || "")}</textarea></label>
      <label class="kpi-field full"><span>Chu kỳ/Tần suất</span><select id="catalogTaskFrequency">${catalogFrequencyOptions(item?.frequency || "")}</select><small class="field-help">Chỉ sử dụng bộ giá trị chuẩn toàn hệ thống; không nhập tên chu kỳ tùy ý.</small></label>
      <label class="kpi-field full"><span>Thời hạn hoàn thành</span><div id="catalogTaskCompletionDeadlineHost">${catalogDeadlineControlHtml(item?.frequency || "", item?.completionDeadline || "")}</div><small id="catalogTaskDeadlineHelp" class="field-help">${escapeHtml(deadlineRuleDescription(item?.frequency || "", item?.completionDeadline || ""))}</small></label>
      <div class="standard-form-section-title full"><span>2</span><div><strong>Cách theo dõi và căn cứ đánh giá</strong><small>Chọn theo sản phẩm cuối cùng hoặc theo nhiều lượt phát sinh trong kỳ.</small></div></div>
      <label class="kpi-field full"><span>Cách theo dõi trong kỳ</span><select id="catalogTaskTrackingMode">
        <option value="FINAL_OUTPUT" ${currentTrackingMode === "FINAL_OUTPUT" ? "selected" : ""}>Theo sản phẩm/kết quả cuối cùng</option>
        <option value="ITEMIZED" ${currentTrackingMode === "ITEMIZED" ? "selected" : ""}>Theo từng lượt công việc phát sinh</option>
      </select><small class="field-help">Chọn “Theo từng lượt” cho văn bản, hồ sơ, hoạt động phát sinh nhiều lần trong kỳ. Chọn “Theo sản phẩm cuối cùng” cho báo cáo, đề án hoặc nhiệm vụ chỉ cần nghiệm thu kết quả cuối kỳ.</small></label>
      <label id="catalogWorkItemTypeField" class="kpi-field full"><span>Nội dung chi tiết cần theo dõi</span><select id="catalogTaskWorkItemType">
        <option value="GENERIC" ${currentWorkItemType === "GENERIC" ? "selected" : ""}>Công việc phát sinh thông thường</option>
        <option value="DOCUMENT" ${currentWorkItemType === "DOCUMENT" ? "selected" : ""}>Văn bản/hồ sơ được giao</option>
        <option value="QUANTITY" ${currentWorkItemType === "QUANTITY" ? "selected" : ""}>Sản lượng theo tháng và kết quả quý</option>
        <option value="ATTENDANCE" ${currentWorkItemType === "ATTENDANCE" ? "selected" : ""}>Buổi hoạt động và tình trạng tham dự</option>
      </select><small class="field-help">Mỗi kiểu sẽ hiển thị đúng trường cần nhập trong chi tiết nhiệm vụ.</small></label>
      <label id="catalogQuantityUnitField" class="kpi-field full"><span>Đơn vị sản lượng</span><input id="catalogTaskQuantityUnit" value="${escapeHtml(item?.quantityUnit || "")}" placeholder="Ví dụ: kg rau, suất ăn, hồ sơ"></label>
      <div id="catalogScoringMethodPreview" class="standard-scoring-method-preview full"></div>
      <label class="kpi-field full"><span>Minh chứng bắt buộc</span><textarea id="catalogTaskEvidence" rows="2" placeholder="Nêu loại hồ sơ, báo cáo hoặc tài liệu bắt buộc">${escapeHtml(item?.mandatoryEvidence || "")}</textarea></label>
      <div class="standard-form-section-title full"><span>3</span><div><strong>Điểm và đối tượng áp dụng</strong><small>Điểm của toàn đầu việc được tính một lần theo đúng Phụ lục 04.</small></div></div>
      <div class="standard-task-score-grid full">
        <label class="kpi-field"><span>Điểm chuẩn</span><input id="catalogTaskBaseScore" type="number" value="${escapeHtml(item?.baseScore ?? (currentWorkType === "DOT_XUAT" ? 12 : 10))}" readonly></label>
        <label class="kpi-field"><span>Hệ số độ khó</span><select id="catalogTaskCoefficient">
          <option value="1" ${Math.abs(Number(item?.difficultyCoefficient ?? 1) - 1) < 0.000001 ? "selected" : ""}>100%</option>
          <option value="1.1" ${Math.abs(Number(item?.difficultyCoefficient ?? 1) - 1.1) < 0.000001 ? "selected" : ""}>110%</option>
          <option value="1.2" ${Math.abs(Number(item?.difficultyCoefficient ?? 1) - 1.2) < 0.000001 ? "selected" : ""}>120%</option>
        </select></label>
        <div class="kpi-field standard-task-score-preview"><span>Điểm quy đổi tối đa</span><strong id="catalogTaskMaximum">${formatNumber(Number(item?.baseScore || (currentWorkType === "DOT_XUAT" ? 12 : 10)) * Number(item?.difficultyCoefficient || 1))}</strong></div>
      </div>
      <div id="catalogDepartmentAudience" class="standard-task-audience-grid full">
        <label class="kpi-field full"><span>Đối tượng được nhìn thấy và đăng ký</span><select id="catalogTaskProfessionalAudience">
          <option value="ALL_DEPARTMENT" ${currentAudience === "ALL_DEPARTMENT" ? "selected" : ""}>Toàn Phòng/Khu — nhân viên và lãnh đạo</option>
          <option value="MANAGEMENT" ${currentAudience === "MANAGEMENT" ? "selected" : ""}>Chỉ lãnh đạo, quản lý</option>
        </select><small class="field-help">Đây là trường duy nhất quyết định ai được nhìn thấy và đăng ký đầu việc. Các cờ kỹ thuật cũ vẫn được giữ trong dữ liệu để tương thích nhưng không còn hiển thị trên ứng dụng.</small></label>
      </div>
      <label id="catalogCdtnAudienceField" class="kpi-field full hidden"><span>Đối tượng Chi đoàn</span><select id="catalogTaskCdtnAudience">
        <option value="CDTN_SECRETARY" ${currentAudience === "CDTN_SECRETARY" ? "selected" : ""}>Bí thư/Phó Bí thư</option>
        <option value="CDTN_EXECUTIVE" ${currentAudience === "CDTN_EXECUTIVE" ? "selected" : ""}>Ban Chấp hành Chi đoàn</option>
        <option value="CDTN_MEMBER" ${currentAudience === "CDTN_MEMBER" ? "selected" : ""}>Đoàn viên Chi đoàn</option>
      </select><small class="field-help">Danh mục này được lọc theo vai trò kiêm nhiệm trong hồ sơ tài khoản, không làm thay đổi Phòng/Khu công tác chính.</small></label>
    </div>`,
    `${editing && mayDeleteCatalogItem(item) ? '<button id="deleteCatalogTask" class="kpi-button danger" type="button">Xóa danh mục</button>' : ""}<button class="kpi-button secondary" data-standard-close type="button">Đóng</button><button id="saveCatalogTask" class="kpi-button" type="button">Lưu đầu việc</button>`
  );

  const departmentInput = document.getElementById("catalogTaskDepartment");
  const codeInput = document.getElementById("catalogTaskCode");
  const departmentAudience = document.getElementById("catalogDepartmentAudience");
  const cdtnAudienceField = document.getElementById("catalogCdtnAudienceField");
  const trackingModeInput = document.getElementById("catalogTaskTrackingMode");
  const workItemTypeInput = document.getElementById("catalogTaskWorkItemType");
  const workItemTypeField = document.getElementById("catalogWorkItemTypeField");
  const quantityUnitField = document.getElementById("catalogQuantityUnitField");
  const scoringMethodPreview = document.getElementById("catalogScoringMethodPreview");
  const frequencyInput = document.getElementById("catalogTaskFrequency");
  const deadlineHost = document.getElementById("catalogTaskCompletionDeadlineHost");
  const deadlineHelp = document.getElementById("catalogTaskDeadlineHelp");

  const currentDeadlineValue = () => document.getElementById("catalogTaskCompletionDeadline")?.value || "";

  const bindDeadlinePartListeners = () => {
    const hidden = document.getElementById("catalogTaskCompletionDeadline");
    const day = document.getElementById("catalogDeadlineYearDay");
    const month = document.getElementById("catalogDeadlineYearMonth");
    const syncYear = () => {
      if (hidden && day && month) hidden.value = day.value && month.value ? `${day.value}/${month.value}` : "";
      if (deadlineHelp) deadlineHelp.textContent = deadlineRuleDescription(frequencyInput?.value || "", currentDeadlineValue());
    };
    day?.addEventListener("change", syncYear);
    month?.addEventListener("change", syncYear);
    document.getElementById("catalogTaskCompletionDeadline")?.addEventListener("change", () => {
      if (deadlineHelp) deadlineHelp.textContent = deadlineRuleDescription(frequencyInput?.value || "", currentDeadlineValue());
    });
  };

  const refreshDeadlineHelp = ({ rebuild = false } = {}) => {
    if (rebuild && deadlineHost) {
      deadlineHost.innerHTML = catalogDeadlineControlHtml(frequencyInput?.value || "", "");
      bindDeadlinePartListeners();
    }
    const eventDriven = isEventDrivenFrequency(frequencyInput?.value || "");
    if (eventDriven && trackingModeInput) {
      trackingModeInput.value = "ITEMIZED";
      // Không ép GENERIC: người dùng có thể chọn Công việc / Văn bản-hồ sơ / Hoạt động.
      syncTrackingFields();
    }
    if (deadlineHelp) deadlineHelp.textContent = deadlineRuleDescription(frequencyInput?.value || "", currentDeadlineValue());
  };

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

  const syncTrackingFields = () => {
    const isItemized = trackingModeInput?.value === "ITEMIZED";
    workItemTypeField?.classList.toggle("hidden", !isItemized);
    if (!isItemized && workItemTypeInput) workItemTypeInput.value = "GENERIC";
    quantityUnitField?.classList.toggle(
      "hidden",
      !isItemized || workItemTypeInput?.value !== "QUANTITY"
    );
    if (scoringMethodPreview) {
      scoringMethodPreview.innerHTML = scoringMethodDescription(
        isItemized ? workItemTypeInput?.value : "FINAL_OUTPUT"
      );
    }
  };

  const syncAudienceFields = async (refreshCode = false) => {
    const departmentId = String(departmentInput?.value || initialDepartmentId).toUpperCase();
    const isCdtn = departmentId === "CDTN";
    departmentAudience?.classList.toggle("hidden", isCdtn);
    cdtnAudienceField?.classList.toggle("hidden", !isCdtn);

    if (refreshCode && !editing && codeInput) {
      codeInput.value = "Đang cấp mã…";
      try {
        const workType = document.getElementById("catalogTaskWorkType")?.value || "THUONG_XUYEN";
        codeInput.value = await StandardTaskWriteService.getNextCode(departmentId, workType);
      } catch (error) {
        codeInput.value = "";
        ToastService.error(error.message || "Không cấp được mã đầu việc.");
      }
    }
  };

  /* Cốt lõi và tính chất quản lý là metadata độc lập; audienceType mới quyết định quyền hiển thị. */
  departmentInput?.addEventListener("change", () => syncAudienceFields(true));
  document.getElementById("catalogTaskWorkType")?.addEventListener("change", async () => {
    syncBaseScoreWithWorkType();
    if (!editing) await syncAudienceFields(true);
  });
  document.getElementById("catalogTaskCoefficient")?.addEventListener("change", recalculate);
  frequencyInput?.addEventListener("change", () => refreshDeadlineHelp({ rebuild: true }));
  trackingModeInput?.addEventListener("change", syncTrackingFields);
  workItemTypeInput?.addEventListener("change", syncTrackingFields);
  await syncAudienceFields(false);
  syncTrackingFields();
  bindDeadlinePartListeners();
  refreshDeadlineHelp();
  recalculate();

  root.querySelector("#saveCatalogTask")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const departmentId = String(departmentInput?.value || initialDepartmentId).toUpperCase();
      const isCdtn = departmentId === "CDTN";
      const audienceType = isCdtn
        ? document.getElementById("catalogTaskCdtnAudience")?.value
        : document.getElementById("catalogTaskProfessionalAudience")?.value;

      const result = await StandardTaskWriteService.saveTask({
        departmentId,
        name: document.getElementById("catalogTaskName")?.value,
        frequency: document.getElementById("catalogTaskFrequency")?.value,
        completionDeadline: document.getElementById("catalogTaskCompletionDeadline")?.value,
        workType: document.getElementById("catalogTaskWorkType")?.value,
        outputRequirement: document.getElementById("catalogTaskOutput")?.value,
        mandatoryEvidence: document.getElementById("catalogTaskEvidence")?.value,
        trackingMode: document.getElementById("catalogTaskTrackingMode")?.value,
        workItemType: document.getElementById("catalogTaskWorkItemType")?.value,
        quantityUnit: document.getElementById("catalogTaskQuantityUnit")?.value,
        baseScore: document.getElementById("catalogTaskBaseScore")?.value,
        difficultyCoefficient: document.getElementById("catalogTaskCoefficient")?.value,
        audienceType,
        // V1.10.1: audienceType là nguồn quyền duy nhất. Hai cờ legacy chỉ giữ để tương thích dữ liệu cũ.
        isCoreTaskDefault: editing ? currentCore : false,
        isManagementTask: isCdtn ? currentManagement : audienceType === "MANAGEMENT"
      }, item?.id || "");
      closeStandardModal(root);
      ToastService.success(editing ? `Đã cập nhật ${result.code}.` : `Đã tạo ${result.code} trong Danh mục công việc.`);
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

function departmentName(departmentId) {
  return ({
    BGD: "Ban Giám đốc",
    TCHC: "Phòng Tổ chức - Hành chính",
    CTXH: "Phòng Công tác xã hội",
    KHTC: "Phòng Kế hoạch - Tài chính",
    YT: "Phòng Y tế",
    KI: "Khu I",
    KII: "Khu II",
    KIII: "Khu III",
    CDTN: "Chi đoàn Trung tâm"
  })[String(departmentId || "").toUpperCase()] || departmentId || "Phòng/Khu";
}

const CDTN_ROLE_LABELS = Object.freeze({
  CDTN_BI_THU: "Bí thư Chi đoàn",
  CDTN_PHO_BI_THU: "Phó Bí thư Chi đoàn",
  CDTN_UY_VIEN_BCH: "Ủy viên BCH Chi đoàn",
  CDTN_DOAN_VIEN: "Đoàn viên"
});
const CDTN_ROLE_PRIORITY = Object.freeze([
  "CDTN_BI_THU",
  "CDTN_PHO_BI_THU",
  "CDTN_UY_VIEN_BCH",
  "CDTN_DOAN_VIEN"
]);

function cdtnRoleLabel(item) {
  const roles = Array.isArray(item?.additionalRoles)
    ? item.additionalRoles.map(role => String(role || "").toUpperCase())
    : [];
  const code = String(item?.cdtnRole || CDTN_ROLE_PRIORITY.find(role => roles.includes(role)) || "").toUpperCase();
  return item?.cdtnRoleLabel || CDTN_ROLE_LABELS[code] || "Thành viên Chi đoàn";
}

function audienceBadge(item) {
  const audience = String(item?.audienceType || "").toUpperCase();
  const labels = {
    ALL_DEPARTMENT: ["Toàn Phòng/Khu", "neutral"],
    MANAGEMENT: ["Lãnh đạo, quản lý", "info"],
    CDTN_SECRETARY: ["Bí thư/Phó Bí thư", "info"],
    CDTN_EXECUTIVE: ["Ban Chấp hành", "info"],
    CDTN_MEMBER: ["Đoàn viên", "neutral"]
  };
  const [label, style] = labels[audience] || ["Chưa cấu hình đối tượng", "danger"];
  return `<span class="status-pill ${style}">${escapeHtml(label)}</span>`;
}


function deadlineBadge(item) {
  const description = deadlineRuleDescription(item?.frequency || "", item?.completionDeadline || "");
  const missingAutoRule = !requiresManualDeadline(item?.frequency)
    && !isEventDrivenFrequency(item?.frequency)
    && !String(item?.completionDeadline || "").trim();
  return `<span class="status-pill ${missingAutoRule ? "danger" : "info"}" title="Quy tắc hạn KPI">⏱ ${escapeHtml(description)}</span>`;
}

async function prepareRegistrationDeadlineOptions(items, period) {
  if (!period?.startDate || !period?.endDate) {
    throw new Error("Kỳ KPI chưa có ngày bắt đầu/kết thúc hợp lệ.");
  }

  const manualItems = [];
  for (const item of items || []) {
    if (requiresManualDeadline(item?.frequency)) {
      manualItems.push(item);
      continue;
    }
    // Kiểm tra cấu hình danh mục trước khi tạo registration; tuyệt đối không tự lấy cuối kỳ.
    deriveDeadlinePlan({
      frequency: item?.frequency,
      completionDeadline: item?.completionDeadline,
      periodStartDate: period.startDate,
      periodEndDate: period.endDate
    });
  }

  if (!manualItems.length) return { manualDeadlines: {} };
  return requestManualRegistrationDeadlines(manualItems, period);
}

function requestManualRegistrationDeadlines(items, period) {
  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const body = `<div class="kpi-form-grid">
      <div class="info-banner full"><strong>Nhập hạn hoàn thành cụ thể</strong><span>Các chu kỳ không có quy tắc tự động phải nhập deadline trước khi gửi duyệt. Riêng <strong>Khi phát sinh</strong> được duyệt kế hoạch khi chưa có hạn; deadline sẽ bắt buộc ở từng lượt thực tế.</span></div>
      ${(items || []).map((item, index) => `<label class="kpi-field full"><span>${escapeHtml(item.code || item.id || `Đầu việc ${index + 1}`)} — ${escapeHtml(item.name || "")}</span><input type="date" data-registration-manual-deadline="${escapeHtml(taskKey(item))}" required><small>Hạn cụ thể của nhiệm vụ trong kỳ ${escapeHtml(period?.name || period?.id || "")}</small></label>`).join("")}
    </div>`;
    const root = openStandardModal(
      "Hạn hoàn thành khi đăng ký",
      body,
      '<button class="kpi-button secondary" data-standard-close type="button">Hủy</button><button id="confirmRegistrationDeadlines" class="kpi-button" type="button">Tiếp tục đăng ký</button>'
    );

    const observer = new MutationObserver(() => {
      if (!document.body.contains(root)) {
        observer.disconnect();
        finish(null);
      }
    });
    observer.observe(document.body, { childList: true });

    root.querySelector("#confirmRegistrationDeadlines")?.addEventListener("click", () => {
      try {
        const manualDeadlines = {};
        root.querySelectorAll("[data-registration-manual-deadline]").forEach(input => {
          const key = input.getAttribute("data-registration-manual-deadline") || "";
          const value = String(input.value || "").trim();
          if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Vui lòng nhập đầy đủ Hạn hoàn thành cho tất cả đầu việc phát sinh.");
          manualDeadlines[key] = value;
        });
        observer.disconnect();
        settled = true;
        closeStandardModal(root);
        resolve({ manualDeadlines });
      } catch (error) {
        ToastService.error(error.message || "Hạn hoàn thành chưa hợp lệ.");
      }
    });
  });
}

async function openCatalogDelegation(currentDelegation, period) {
  try {
    const candidates = await StandardTaskWriteService.listDelegationCandidates();
    const active = currentDelegation?.active === true ? currentDelegation : null;
    const today = StandardTaskWriteService.todayKey();
    const defaultEnd = period?.endDate || addDays(today, 30);
    const root = openStandardModal(
      "Ủy quyền thêm đầu việc",
      `<div class="kpi-form-grid standard-task-delegation-form">
        <label class="kpi-field full"><span>Phó/Nhân viên được ủy quyền</span><select id="catalogDelegateUser"><option value="">-- Chọn người được ủy quyền --</option>${candidates.map(item => `<option value="${escapeHtml(item.id)}" ${active?.delegateUserId === item.id ? "selected" : ""}>${escapeHtml(item.fullName || "Chưa cập nhật họ tên")} — ${escapeHtml(item.position || "Nhân viên")}</option>`).join("")}</select></label>
        ${candidates.length ? "" : '<div class="kpi-alert full">Chưa có Phó/Nhân viên đang hoạt động và đủ điều kiện trong cùng Phòng/Khu.</div>'}
        <label class="kpi-field"><span>Từ ngày</span><input id="catalogDelegateStart" type="date" value="${escapeHtml(active?.startDate || today)}"></label>
        <label class="kpi-field"><span>Đến ngày</span><input id="catalogDelegateEnd" type="date" value="${escapeHtml(active?.endDate || defaultEnd)}"></label>
        <label class="kpi-field full"><span>Phạm vi quyền</span>
          <span class="check-row"><input id="catalogDelegateCreateStandard" type="checkbox" ${(!active || (active?.permissions || []).includes("CREATE_STANDARD_TASKS") || (active?.permissions || []).includes("MANAGE_STANDARD_TASKS")) ? "checked" : ""}> Thêm đầu việc trong Danh mục công việc</span>
          <span class="check-row"><input id="catalogDelegateEditStandard" type="checkbox" ${((active?.permissions || []).includes("EDIT_STANDARD_TASKS") || (active?.permissions || []).includes("MANAGE_STANDARD_TASKS")) ? "checked" : ""}> Sửa đầu việc trong Danh mục công việc</span>
          <span class="check-row"><input id="catalogDelegateDeleteStandard" type="checkbox" ${(active?.permissions || []).includes("DELETE_STANDARD_TASKS") ? "checked" : ""}> Xóa/gỡ đầu việc khỏi Danh mục công việc</span>
          <span class="check-row"><input id="catalogDelegateRuntime" type="checkbox" ${(active?.permissions || []).includes("CREATE_TASKS") ? "checked" : ""}> Giao nhiệm vụ đột xuất của Phòng/Khu</span>
          <small>Quyền Thêm, Sửa, Xóa và Giao nhiệm vụ là độc lập. Xóa ở đây là gỡ mềm để giữ lịch sử; hard delete chỉ dành cho Admin khi chưa phát sinh dữ liệu.</small>
        </label>
        <label class="kpi-field full"><span>Lý do</span><textarea id="catalogDelegateReason" rows="3" placeholder="Ví dụ: Phân công phụ trách cập nhật/giao đầu việc">${escapeHtml(active?.reason || "")}</textarea></label>
        <div class="info-banner full">Ủy quyền chỉ có hiệu lực trong đúng Phòng/Khu và đúng phạm vi đã chọn. Quyền duyệt đăng ký, xác nhận KPI và khóa kế hoạch vẫn là quyền riêng.</div>
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
          reason: document.getElementById("catalogDelegateReason")?.value,
          permissions: [
            document.getElementById("catalogDelegateCreateStandard")?.checked ? "CREATE_STANDARD_TASKS" : "",
            document.getElementById("catalogDelegateEditStandard")?.checked ? "EDIT_STANDARD_TASKS" : "",
            document.getElementById("catalogDelegateDeleteStandard")?.checked ? "DELETE_STANDARD_TASKS" : "",
            document.getElementById("catalogDelegateRuntime")?.checked ? "CREATE_TASKS" : ""
          ].filter(Boolean)
        });
        closeStandardModal(root);
        ToastService.success("Đã lưu ủy quyền thêm đầu việc.");
        reloadRoute();
      } catch (error) {
        ToastService.error(error.message || "Không lưu được ủy quyền.");
        button.disabled = false;
      }
    });

    root.querySelector("#revokeCatalogDelegation")?.addEventListener("click", async event => {
      if (!await ModalService.confirm("Hủy ủy quyền thêm đầu việc ngay bây giờ?", { title: "Hủy ủy quyền", confirmText: "Hủy ủy quyền", danger: true })) return;
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

async function openCdtnApprovalDelegation(period) {
  try {
    const [candidates, current] = await Promise.all([
      TaskRegistrationService.listCdtnApprovalCandidates(),
      TaskRegistrationService.getCdtnApprovalDelegation()
    ]);
    const active = current?.active === true ? current : null;
    const today = StandardTaskWriteService.todayKey();
    const defaultEnd = period?.endDate || addDays(today, 30);
    const root = openStandardModal(
      "Ủy quyền duyệt nhiệm vụ Chi đoàn",
      `<div class="kpi-form-grid standard-task-delegation-form">
        <label class="kpi-field full"><span>Người được ủy quyền</span><select id="cdtnApprovalDelegate"><option value="">-- Chọn thành viên Chi đoàn --</option>${candidates.map(item => `<option value="${escapeHtml(item.id)}" ${active?.delegateUserId === item.id ? "selected" : ""}>${escapeHtml(item.fullName || "Chưa cập nhật họ tên")} — ${escapeHtml(cdtnRoleLabel(item))}</option>`).join("")}</select></label>
        <label class="kpi-field"><span>Từ ngày</span><input id="cdtnApprovalStart" type="date" value="${escapeHtml(active?.startDate || today)}"></label>
        <label class="kpi-field"><span>Đến ngày</span><input id="cdtnApprovalEnd" type="date" value="${escapeHtml(active?.endDate || defaultEnd)}"></label>
        <label class="kpi-field full"><span>Lý do</span><textarea id="cdtnApprovalReason" rows="3" placeholder="Ví dụ: Phân công hỗ trợ duyệt kế hoạch và xác nhận nhiệm vụ Chi đoàn">${escapeHtml(active?.reason || "")}</textarea></label>
        <div class="info-banner full">Ủy quyền chỉ áp dụng cho Chi đoàn và không làm thay đổi quyền Phòng/Khu.</div>
      </div>`,
      `${active ? '<button id="revokeCdtnApproval" class="kpi-button danger" type="button">Hủy ủy quyền</button>' : ""}<button class="kpi-button secondary" data-standard-close type="button">Đóng</button><button id="saveCdtnApproval" class="kpi-button" type="button">Lưu ủy quyền</button>`
    );

    root.querySelector("#saveCdtnApproval")?.addEventListener("click", async event => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await TaskRegistrationService.saveCdtnApprovalDelegation({
          delegateUserId: document.getElementById("cdtnApprovalDelegate")?.value,
          startDate: document.getElementById("cdtnApprovalStart")?.value,
          endDate: document.getElementById("cdtnApprovalEnd")?.value,
          reason: document.getElementById("cdtnApprovalReason")?.value
        });
        closeStandardModal(root);
        ToastService.success("Đã thiết lập ủy quyền duyệt nhiệm vụ Chi đoàn.");
        reloadRoute();
      } catch (error) {
        ToastService.error(error.message || "Không lưu được ủy quyền Chi đoàn.");
        button.disabled = false;
      }
    });

    root.querySelector("#revokeCdtnApproval")?.addEventListener("click", async event => {
      if (!await ModalService.confirm("Hủy ủy quyền duyệt nhiệm vụ Chi đoàn ngay bây giờ?", { title: "Hủy ủy quyền Chi đoàn", confirmText: "Hủy ủy quyền", danger: true })) return;
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await TaskRegistrationService.revokeCdtnApprovalDelegation();
        closeStandardModal(root);
        ToastService.success("Đã hủy ủy quyền duyệt Chi đoàn.");
        reloadRoute();
      } catch (error) {
        ToastService.error(error.message || "Không hủy được ủy quyền Chi đoàn.");
        button.disabled = false;
      }
    });
  } catch (error) {
    ToastService.error(error.message || "Không mở được chức năng ủy quyền Chi đoàn.");
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

function standardTaskSourceBadge(item) {
  return String(item?.sourceType || "").toUpperCase() === "EXECUTIVE_DIRECTIVE"
    ? '<span class="status-pill info">BGĐ giao · KPI đột xuất</span>'
    : "";
}

function workTypeBadge(item) {
  return isUnexpectedTask(item)
    ? '<span class="status-pill warning">Đột xuất</span>'
    : '<span class="status-pill success">Thường xuyên</span>';
}

function trackingModeBadge(item) {
  return String(item?.trackingMode || "FINAL_OUTPUT").toUpperCase() === "ITEMIZED"
    ? '<span class="status-pill info">Theo từng lượt</span>'
    : '<span class="status-pill neutral">Theo sản phẩm cuối</span>';
}

function workItemTypeBadge(item) {
  if (String(item?.trackingMode || "FINAL_OUTPUT").toUpperCase() !== "ITEMIZED") return "";
  const labels = {
    GENERIC: "Lượt công việc",
    DOCUMENT: "Văn bản/hồ sơ",
    QUANTITY: "Sản lượng",
    ATTENDANCE: "Buổi tham dự"
  };
  const type = StandardTaskWriteService.normalizeWorkItemType(item?.workItemType);
  return `<span class="status-pill neutral">${labels[type]}</span>`;
}

function scoringMethodDescription(typeValue) {
  const type = String(typeValue || "FINAL_OUTPUT").toUpperCase();
  if (type === "FINAL_OUTPUT") {
    return `<strong>Chấm trực tiếp theo sản phẩm/kết quả cuối cùng</strong>
      <p>Tiến độ và kết quả được đánh giá trên thang 0–100%. Hệ thống tính một lần: Điểm chuẩn × (30% tiến độ + 70% kết quả) × Hệ số độ khó.</p>`;
  }

  const definitions = {
    GENERIC: ["Tổng lượt công việc", "Lượt hoàn thành đúng hạn", "Lượt đạt yêu cầu từ 80%"],
    DOCUMENT: ["Tổng văn bản/hồ sơ được giao", "Văn bản/hồ sơ đúng hạn", "Văn bản/hồ sơ đạt yêu cầu từ 80%"],
    QUANTITY: ["Tổng lượt/tháng phải ghi nhận", "Lượt hoàn thành đúng hạn", "Lượt đạt sản lượng kế hoạch và chất lượng từ 80%"],
    ATTENDANCE: ["Tổng số buổi phải tham gia", "Số buổi có mặt", "Số buổi có mặt và tham gia đạt yêu cầu từ 80%"]
  };
  const [n, t, k] = definitions[type] || definitions.GENERIC;
  return `<strong>Tổng hợp N–T–K trước khi chấm điểm đầu việc</strong>
    <div class="standard-scoring-variables">
      <span><b>N</b>${escapeHtml(n)}</span><span><b>T</b>${escapeHtml(t)}</span><span><b>K</b>${escapeHtml(k)}</span>
    </div>
    <p>Tính trung bình thực tế hoặc T/N và K/N, sau đó quy về thang Phụ lục 04: 100%; 80–dưới 100% → 80%; 60–dưới 80% → 60%; dưới 60% → 0%. Ví dụ 1/2 = 50% nên áp dụng 0%. Chỉ chấm một lần cho toàn đầu việc, không cộng điểm riêng từng lượt.</p>`;
}

function classificationBadge(item) {
  return item?.isCoreTaskDefault === true
    ? '<span class="status-pill core">Cốt lõi</span>'
    : '';
}

function createRegistrationMap(registrations) {
  const map = new Map();
  const add = (key, registration) => {
    if (!key) return;
    const existing = map.get(key) || [];
    if (!existing.some(item => item.id === registration.id)) existing.push(registration);
    existing.sort((a, b) => Number(a.personalItemOrder || 1) - Number(b.personalItemOrder || 1));
    map.set(key, existing);
  };
  for (const registration of registrations) {
    add(String(registration.standardTaskId || ""), registration);
    add(String(registration.standardTaskCode || ""), registration);
  }
  return map;
}

function findRegistrations(item, map) {
  return map.get(String(item.id || "")) || map.get(String(item.code || "")) || [];
}

function findRegistration(item, map) {
  const rows = findRegistrations(item, map);
  if (!rows.length) return null;
  const rank = { APPROVED: 0, PENDING: 1, REJECTED: 2, CANCELLED: 3 };
  return [...rows].sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || Number(a.personalItemOrder || 1) - Number(b.personalItemOrder || 1))[0];
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
  StandardTaskReadService.invalidate();
  PeriodReadService.invalidate();
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
