import { UserContext } from "../../core/user-context.js?v=20260810.V1_10_6";
import { Permissions } from "../../core/permissions.js?v=20260818.V1_11_4";
import { ToastService } from "../../core/toast-service.js?v=20260810.V1_10_6";
import { StandardTaskReadService } from "../../services/standard-task-read-service.js?v=20260810.V1_10_6";
import { PeriodReadService } from "../../services/period-read-service.js?v=20260810.V1_10_6";
import { StandardTaskWriteService } from "../../services/standard-task-write-service.js?v=20260818.V1_11_4";
import { TaskRegistrationService } from "../../services/task-registration-service.js?v=20260810.V1_10_6";

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
            ? "Danh mục Phòng/Khu và Chi đoàn được tách riêng; đầu việc đã gửi tự chuyển sang cột Đã đăng ký."
            : "Tra cứu danh mục công việc theo vị trí việc làm."}</p>
        </div>
        <div class="standard-task-header-actions">
          ${catalogAccess.canCreate ? '<button id="btnAddStandardTask" class="primary-button" type="button">＋ Thêm đầu việc</button>' : ""}
          ${catalogAccess.canDelegateCatalogEditor ? '<button id="btnDelegateCatalogEditor" class="secondary-button" type="button">👤 Ủy quyền nhập danh mục</button>' : ""}
          ${Permissions.isCdtnLeadership() ? '<button id="btnDelegateCdtnApproval" class="secondary-button" type="button">👥 Ủy quyền duyệt Chi đoàn</button>' : ""}
          <button id="btnStandardRefresh" class="secondary-button" type="button">↻ Cập nhật</button>
        </div>
      </div>

      <div class="info-banner standard-task-period-banner">
        <span>Đơn vị chính: <strong>${escapeHtml(user.departmentId || "Toàn hệ thống")}</strong></span>
        <span>${period ? `Kỳ hiện tại: <strong>${escapeHtml(period.name || period.id)}</strong>` : "<strong>Chưa có kỳ hoạt động.</strong>"}</span>
        ${workspaceIds.map(id => `<span>${escapeHtml(workspaceName(id))}: <strong>${workspacePlans[id]?.locked === true ? "Đã khóa" : "Đang mở"}</strong></span>`).join("")}
        ${catalogAccess.canCreate ? `<span>Quyền thêm danh mục: <strong>${catalogAccess.isDepartmentHead ? "Trưởng phòng" : catalogAccess.isDepartmentDeputy ? "Phó Trưởng phòng" : catalogAccess.isCdtnCatalogManager ? "Ban Chấp hành Chi đoàn" : "Được ủy quyền"}</strong></span>` : ""}
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
            "Bạn đang hủy đầu việc do chính mình đăng ký. Thao tác chỉ được thực hiện khi nhiệm vụ chưa hoàn thành, chưa đánh giá, chưa khóa điểm và chưa phát sinh tiến độ, lượt công việc hoặc minh chứng.\n\nVui lòng nhập lý do hủy:",
            "Đăng ký nhầm đầu việc"
          );
          if (reason === null) return;
          if (!String(reason).trim()) return ToastService.error("Vui lòng nhập lý do hủy đầu việc.");
          if (!window.confirm("Xác nhận hủy nhiệm vụ tự đăng ký và đưa đầu việc trở lại danh mục lựa chọn? Lịch sử thao tác vẫn được giữ để kiểm tra.")) return;
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
        const textMatches = [item.code, item.name, item.outputRequirement, item.frequency, workTypeLabel(item), departmentName(itemDepartmentId)]
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
                <div><span class="page-eyebrow">${group.workspaceId === "CDTN" ? "Chi đoàn" : "Phòng/Khu"}</span><h3>${escapeHtml(workspaceName(group.workspaceId))}</h3><p>${group.workspaceId === "CDTN" ? "Đầu việc và đăng ký thuộc Chi đoàn." : "Đầu việc và đăng ký thuộc Phòng/Khu."}</p></div>
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
        const result = await TaskRegistrationService.registerMany(selected, period);
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

function workspaceName(workspaceId) {
  return String(workspaceId || "").toUpperCase() === "CDTN"
    ? "Chi đoàn Trung tâm"
    : departmentName(workspaceId);
}

function renderRegistrationWorkspace(items, registeredMap, registrationOpen, catalogAccess, approvedCancellationMap = {}) {
  const registeredItems = items.filter(item => findRegistration(item, registeredMap));

  return `<div class="registration-workspace">
    <section class="registration-column registration-column-catalog">
      <header class="registration-column-header">
        <div class="registration-column-icon" aria-hidden="true">📚</div>
        <div>
          <h3>Danh mục công việc</h3>
          <p>Danh mục luôn hiển thị đầy đủ; nhiều người có thể đăng ký cùng một đầu việc.</p>
        </div>
        <span class="registration-column-count">${items.length}</span>
      </header>
      <div class="registration-column-list">
        ${items.length
          ? items.map(item => {
              const registration = findRegistration(item, registeredMap);
              return registration
                ? renderRegisteredTask(item, registration, registrationOpen, catalogAccess, approvedCancellationMap, true)
                : renderAvailableTask(item, registrationOpen, catalogAccess);
            }).join("")
          : compactEmpty("Chưa có đầu việc phù hợp", "Danh mục chưa có dữ liệu đang hoạt động.")}
      </div>
    </section>

    <section class="registration-column registration-column-selected">
      <header class="registration-column-header">
        <div class="registration-column-icon" aria-hidden="true">✅</div>
        <div>
          <h3>Đăng ký của tôi</h3>
          <p>Theo dõi nhanh các đầu việc chính bạn đã đăng ký trong kỳ.</p>
        </div>
        <span class="registration-column-count">${registeredItems.length}</span>
      </header>
      <div class="registration-column-list">
        ${registeredItems.length
          ? registeredItems.map(item => renderRegisteredTask(item, findRegistration(item, registeredMap), registrationOpen, catalogAccess, approvedCancellationMap, false)).join("")
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
      <div class="standard-task-tags">${workTypeBadge(item)}${trackingModeBadge(item)}${workItemTypeBadge(item)}${classificationBadge(item)}${audienceBadge(item)}${item.frequency ? `<span class="status-pill neutral">${escapeHtml(item.frequency)}</span>` : ""}</div>
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
      <div class="standard-task-tags">${workTypeBadge(item)}${trackingModeBadge(item)}${workItemTypeBadge(item)}${classificationBadge(item)}${audienceBadge(item)}${item.frequency ? `<span class="status-pill neutral">${escapeHtml(item.frequency)}</span>` : ""}</div>
      ${registration?.rejectionReason ? `<small class="text-danger">Lý do trả lại: ${escapeHtml(registration.rejectionReason)}</small>` : ""}
    </div>
    <div class="data-row-meta">
      <span class="status-pill ${statusClass}">${escapeHtml(status)}</span>
      <small>Điểm tối đa: ${formatNumber(item.maximumConvertedScore || 0)}</small>
      ${canDelete ? `<button class="registration-delete-button" type="button" data-delete-registration="${escapeHtml(registration.id)}">Hủy đăng ký</button>` : ""}
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
      <div class="standard-task-tags">${workTypeBadge(item)}${trackingModeBadge(item)}${workItemTypeBadge(item)}${classificationBadge(item)}${audienceBadge(item)}${item.frequency ? `<span class="status-pill neutral">${escapeHtml(item.frequency)}</span>` : ""}</div>
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
        <div><span class="page-eyebrow">${departmentId === "CDTN" ? "Chi đoàn" : "Phòng/Khu"}</span><h3>${escapeHtml(workspaceName(departmentId))}</h3></div>
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
  if (!window.confirm(
    `Xóa ${code} khỏi DANH MỤC CÔNG VIỆC CHUẨN?\n\n` +
    "Đây không phải thao tác hủy nhiệm vụ cá nhân. Nếu đầu việc chưa phát sinh đăng ký hoặc nhiệm vụ, document danh mục sẽ được xóa. " +
    "Nếu đã có lịch sử, hệ thống chỉ đưa đầu việc ra khỏi danh mục hiện hành để không làm mất báo cáo cũ."
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
    item?.audienceType || (item?.isManagementTask === true ? "MANAGEMENT" : initialDepartmentId === "CDTN" ? "CDTN_MEMBER" : "ALL_DEPARTMENT")
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
      <label class="kpi-field full"><span>Chu kỳ/Tần suất</span><input id="catalogTaskFrequency" value="${escapeHtml(item?.frequency || "")}" placeholder="Ví dụ: Theo tháng, theo hồ sơ, khi phát sinh"></label>
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
      <label class="kpi-field full"><span>Minh chứng phát sinh</span><textarea id="catalogTaskArisingEvidence" rows="2" placeholder="Không bắt buộc; chỉ nhập khi có loại minh chứng phát sinh">${escapeHtml(item?.arisingEvidence || "")}</textarea></label>
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
  trackingModeInput?.addEventListener("change", syncTrackingFields);
  workItemTypeInput?.addEventListener("change", syncTrackingFields);
  await syncAudienceFields(false);
  syncTrackingFields();
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
        workType: document.getElementById("catalogTaskWorkType")?.value,
        outputRequirement: document.getElementById("catalogTaskOutput")?.value,
        mandatoryEvidence: document.getElementById("catalogTaskEvidence")?.value,
        arisingEvidence: document.getElementById("catalogTaskArisingEvidence")?.value,
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
  const audience = String(item?.audienceType || (item?.isManagementTask ? "MANAGEMENT" : "ALL_DEPARTMENT")).toUpperCase();
  const labels = {
    ALL_DEPARTMENT: ["Toàn Phòng/Khu", "neutral"],
    MANAGEMENT: ["Lãnh đạo, quản lý", "info"],
    CDTN_SECRETARY: ["Bí thư/Phó Bí thư", "info"],
    CDTN_EXECUTIVE: ["Ban Chấp hành", "info"],
    CDTN_MEMBER: ["Đoàn viên", "neutral"]
  };
  const [label, style] = labels[audience] || labels.ALL_DEPARTMENT;
  return `<span class="status-pill ${style}">${escapeHtml(label)}</span>`;
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
      if (!window.confirm("Hủy ủy quyền duyệt nhiệm vụ Chi đoàn ngay bây giờ?")) return;
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
