import { UserContext } from "../../core/user-context.js?v=20260904.V1_22_7";
import { Permissions } from "../../core/permissions.js?v=20260904.V1_22_7";
import { ToastService } from "../../core/toast-service.js?v=20260904.V1_22_7";
import { ModalService } from "../../core/modal-service.js?v=20260904.V1_22_7";
import { AdminReadService } from "../../services/admin-read-service.js?v=20260904.V1_22_7";
import { AdminMaintenanceService } from "../../services/admin-maintenance-service.js?v=20260904.V1_22_7";

let currentDiagnostic = null;

export async function renderAdminView(outlet) {
  const user = UserContext.requireUser();
  if (!Permissions.isAdmin()) return renderDenied(outlet, user);
  outlet.innerHTML = loadingCard("Đang kiểm tra dữ liệu production…");
  try {
    currentDiagnostic = await AdminReadService.diagnostics();
    render(outlet, user, currentDiagnostic);
    bindActions(outlet, user);
  } catch (error) {
    outlet.innerHTML = errorCard("Không thể tải dữ liệu quản trị", error);
  }
}

function render(outlet, user, diagnostic) {
  const counts = diagnostic.counts || {};
  const errors = diagnostic.issues.filter(item => item.level === "ERROR").length;
  const repairable = diagnostic.repairableTaskIds.length;
  const warnings = diagnostic.issues.filter(item => item.level === "WARNING").length;
  outlet.innerHTML = `<section class="page-card">
    <div class="page-header"><div><h2>Quản trị hệ thống</h2><p>Chẩn đoán dữ liệu, nhật ký và bảo trì có kiểm soát.</p></div><span class="role-badge">ADMIN · V1.22.7</span></div>
    <div class="success-banner">Tài khoản <strong>${escapeHtml(user.fullName || user.email)}</strong> đang thao tác trong phạm vi quản trị.</div>
    <div class="summary-grid compact-grid">
      ${metric("Tài khoản hoạt động", counts.users ?? "—")}
      ${metric("Đầu việc chuẩn", counts.standardTasks ?? "—")}
      ${metric("Nhiệm vụ trong Firestore", counts.tasks ?? "—")}
      ${metric("Kỳ đánh giá", counts.evaluationPeriods ?? "—")}
      ${metric("Lỗi cần xử lý", errors)}
      ${metric("Cảnh báo", warnings)}
    </div>
    <div class="admin-tools-grid">
      <a class="admin-action-card" href="#/kpi/periods"><span>🗓️</span><strong>Quản lý kỳ đánh giá</strong><small>Tạo, kích hoạt, kết thúc và lưu trữ kỳ.</small></a>
      <button id="btnAdminCheckData" class="admin-action-card" type="button"><span>🔍</span><strong>Kiểm tra lại dữ liệu</strong><small>Quét lại các collection nền theo quyền ADMIN.</small></button>
      <button id="btnAdminAudit" class="admin-action-card" type="button"><span>📜</span><strong>Nhật ký hệ thống</strong><small>Xem taskLogs và kpiAuditLogs mới nhất.</small></button>
      <button id="btnAdminRepair" class="admin-action-card${repairable ? " warning" : ""}" type="button" ${repairable ? "" : "disabled"}><span>🧰</span><strong>Chuẩn hóa phạm vi nhiệm vụ</strong><small>${repairable ? `${repairable} nhiệm vụ có thể sửa tự động.` : "Không có nhiệm vụ cần sửa."}</small></button>
      <button id="btnAdminCorrection" class="admin-action-card warning" type="button"><span>🛠️</span><strong>Sửa sai dữ liệu KPI</strong><small>Hủy/mở lại theo trạng thái, luôn giữ lịch sử và minh chứng.</small></button>
      <button id="btnAdminEventDrivenReset" class="admin-action-card warning" type="button"><span>↩️</span><strong>Mở lại → Khi phát sinh</strong><small>Chỉ ADMIN: mở lại đăng ký recurring sạch, giữ nội dung và hủy mềm task cũ.</small></button>
      <button id="btnAdminCleanup" class="admin-action-card danger" type="button"><span>🗄️</span><strong>Lưu trữ và dọn kỳ</strong><small>Thực hiện tại phân hệ KPI sau khi có tệp Drive và SHA-256.</small></button>
    </div>
    ${diagnostic.unavailable.length ? `<div class="warning-banner">Không đọc được: ${diagnostic.unavailable.map(escapeHtml).join(", ")}.</div>` : ""}
    ${issueTable(diagnostic.issues)}
    <p class="helper-text">Kiểm tra lúc ${escapeHtml(diagnostic.checkedAt.toLocaleString("vi-VN"))}. Không có thao tác sửa nào chạy tự động.</p>
  </section>`;
}

function bindActions(outlet, user) {
  document.getElementById("btnAdminCheckData")?.addEventListener("click", async event => {
    event.currentTarget.disabled = true;
    try {
      currentDiagnostic = await AdminReadService.diagnostics();
      render(outlet, user, currentDiagnostic);
      bindActions(outlet, user);
      ToastService.success("Đã kiểm tra lại dữ liệu.");
    } catch (error) { ToastService.error(error.message || "Không kiểm tra được dữ liệu."); }
  });

  document.getElementById("btnAdminAudit")?.addEventListener("click", showLogs);
  document.getElementById("btnAdminCorrection")?.addEventListener("click", openAdminCorrection);
  document.getElementById("btnAdminEventDrivenReset")?.addEventListener("click", openAdminEventDrivenReset);
  document.getElementById("btnAdminRepair")?.addEventListener("click", async event => {
    const ids = currentDiagnostic?.repairableTaskIds || [];
    if (!ids.length) return;
    const confirmed = await ModalService.open({
      title: "Chuẩn hóa phạm vi nhiệm vụ",
      message: `Hệ thống sẽ bổ sung visibleDepartmentIds và visibleUserIds cho ${ids.length} nhiệm vụ, đồng thời ghi taskLogs. Không xóa nhiệm vụ hoặc điểm KPI.`,
      confirmText: "Thực hiện sửa",
      cancelText: "Hủy",
      danger: true
    });
    if (!confirmed) return;
    event.currentTarget.disabled = true;
    try {
      const result = await AdminMaintenanceService.repairTaskVisibility(ids);
      ToastService.success(`Đã sửa ${result.repaired} nhiệm vụ; bỏ qua ${result.skipped}.`);
      currentDiagnostic = await AdminReadService.diagnostics();
      render(outlet, user, currentDiagnostic);
      bindActions(outlet, user);
    } catch (error) {
      ToastService.error(error.message || "Không thể sửa dữ liệu.");
      event.currentTarget.disabled = false;
    }
  });

  document.getElementById("btnAdminCleanup")?.addEventListener("click", async () => {
    await ModalService.open({ title: "Lưu trữ và dọn dữ liệu kỳ", message: "Mở Kế hoạch KPI → Quản lý kỳ. Chỉ dọn sau khi Apps Script đã lưu tệp Drive, trả SHA-256 và periodArchives chuyển sang ARCHIVED.", confirmText: "Đã hiểu", showCancel: false, danger: true });
  });
}

async function showLogs() {
  try {
    const logs = await AdminReadService.latestLogs();
    const html = logs.length ? `<div class="admin-log-list">${logs.map(log => {
      const date = log[log.timeField]?.toDate?.() || null;
      return `<article><strong>${escapeHtml(log.action || log.source)}</strong><span>${escapeHtml(log.performedByName || log.performedByUserId || "Hệ thống")}</span><small>${escapeHtml(date ? date.toLocaleString("vi-VN") : "Chưa có thời gian")} · ${escapeHtml(log.source)}</small></article>`;
    }).join("")}</div>` : "Chưa có nhật ký.";
    await ModalService.open({ title: "Nhật ký hệ thống gần nhất", messageHtml: html, confirmText: "Đóng", showCancel: false });
  } catch (error) { ToastService.error(error.message || "Không đọc được nhật ký."); }
}



async function openAdminEventDrivenReset() {
  try {
    const candidates = await AdminMaintenanceService.listEventDrivenResetCandidates();
    if (!candidates.length) {
      return ToastService.info?.("Không có đăng ký recurring APPROVED phù hợp để kiểm tra.")
        || ToastService.success("Không có đăng ký recurring APPROVED phù hợp để kiểm tra.");
    }

    const periods = [...new Map(candidates.map(item => [String(item.periodId || "").trim(), item.periodName || item.periodId || ""])).entries()]
      .filter(([id]) => id)
      .sort((a,b) => a[0].localeCompare(b[0]));
    const departments = [...new Set(candidates.map(item => String(item.departmentId || "").trim()).filter(Boolean))]
      .sort((a,b) => a.localeCompare(b, "vi"));
    const periodOptions = `<option value="">Tất cả kỳ</option>` + periods.map(([id,name]) => `<option value="${escapeHtml(id)}">${escapeHtml(name || id)}</option>`).join("");
    const departmentOptions = `<option value="">Tất cả Phòng/Khu/Scope</option>` + departments.map(id => `<option value="${escapeHtml(id)}">${escapeHtml(id)}</option>`).join("");

    const html = `<div class="admin-correction-form">
      <p><strong>Chức năng chỉ dành cho ADMIN.</strong> Hệ thống không xóa registration và không đổi quy tắc chấm điểm. Chỉ đăng ký sạch mới được mở lại; task cũ được hủy mềm, milestone cũ giữ lịch sử.</p>
      <div class="standard-personal-row-grid">
        <label><span>Kỳ</span><select id="adminEventPeriod">${periodOptions}</select></label>
        <label><span>Phòng/Khu/Scope</span><select id="adminEventDepartment">${departmentOptions}</select></label>
      </div>
      <label><span>Tìm nhanh</span><input id="adminEventSearch" type="search" placeholder="Tên nhân viên, mã hoặc nội dung đầu việc"></label>
      <div class="admin-correction-preview"><strong>Chọn tối đa 50 đăng ký.</strong> Sau khi bấm “Kiểm tra trước”, hệ thống sẽ revalidate progress, minh chứng, lượt phát sinh, đánh giá, điều chỉnh, điểm, milestone và trạng thái kỳ.</div>
      <div class="admin-diagnostic-table" style="max-height:48vh;overflow:auto">
        <table style="min-width:980px"><thead><tr>
          <th><input id="adminEventSelectAll" type="checkbox" aria-label="Chọn tất cả đang hiển thị"></th>
          <th>Nhân viên</th><th>Phòng/Khu</th><th>Đầu việc</th><th>Tần suất hiện tại</th><th>Trạng thái</th>
        </tr></thead><tbody id="adminEventRows"></tbody></table>
      </div>
      <div id="adminEventSelectionSummary" class="admin-correction-preview">Chưa chọn đăng ký.</div>
      <label><span>Lý do xử lý *</span><textarea id="adminEventReason" rows="3" maxlength="1000" placeholder="Ví dụ: Điều chỉnh đăng ký trong giai đoạn triển khai ban đầu tháng 09/2026"></textarea></label>
    </div>`;

    const modal = await ModalService.open({
      title:"Mở lại đăng ký và chuyển sang Khi phát sinh",
      eyebrow:"ADMIN · SYSTEM CORRECTION",
      messageHtml:html,
      confirmText:"Kiểm tra trước",
      cancelText:"Hủy",
      danger:true,
      beforeConfirm:async root => {
        const selectedIds = [...root.querySelectorAll('[data-admin-event-registration]:checked')].map(input => input.value);
        const reason = String(root.querySelector("#adminEventReason")?.value || "").trim();
        if (!selectedIds.length) throw new Error("Hãy chọn ít nhất một đăng ký.");
        if (selectedIds.length > 50) throw new Error("Mỗi lần chỉ được chọn tối đa 50 đăng ký.");
        if (!reason) throw new Error("Phải nhập lý do xử lý.");

        const previews = [];
        for (const registrationId of selectedIds) {
          const candidate = candidates.find(item => item.id === registrationId);
          try {
            const preview = await AdminMaintenanceService.eventDrivenResetPreview({ id:registrationId });
            previews.push({ candidate, preview });
          } catch (error) {
            previews.push({ candidate, preview:{ canApply:false, blockers:[error?.message || "Không kiểm tra được dữ liệu."], counts:{} } });
          }
        }
        const safe = previews.filter(item => item.preview?.canApply && !item.preview?.alreadyApplied);
        const already = previews.filter(item => item.preview?.alreadyApplied);
        const blocked = previews.filter(item => !item.preview?.canApply);
        const previewRows = previews.map(({candidate,preview}) => {
          const owner = candidate?.userName || candidate?.ownerName || candidate?.userId || "";
          const code = candidate?.standardTaskCode || candidate?.taskCode || "";
          const title = candidate?.title || candidate?.standardTaskName || "";
          const state = preview?.alreadyApplied ? "Đã xử lý trước đó" : preview?.canApply ? "Có thể xử lý" : "Cần kiểm tra thủ công";
          const detail = preview?.canApply
            ? `Milestone: ${Number(preview.counts?.milestones || 0)} · completed: ${Number(preview.counts?.completedMilestones || 0)} · evidence: ${Number(preview.counts?.evidenceFiles || 0)} · work item: ${Number(preview.counts?.workItems || 0)}`
            : (preview?.blockers || []).join(" ");
          return `<tr><td>${escapeHtml(owner)}</td><td>${escapeHtml(code)} — ${escapeHtml(title)}</td><td><strong>${escapeHtml(state)}</strong><br><small>${escapeHtml(detail)}</small></td></tr>`;
        }).join("");
        const confirmed = await ModalService.open({
          title:"Preview trước khi xử lý",
          eyebrow:"ADMIN · PREVIEW",
          messageHtml:`<div class="admin-correction-preview"><strong>${safe.length}</strong> có thể xử lý · <strong>${blocked.length}</strong> bị khóa · <strong>${already.length}</strong> đã xử lý trước đó.</div><div class="admin-diagnostic-table" style="max-height:50vh;overflow:auto"><table><thead><tr><th>Nhân viên</th><th>Đầu việc</th><th>Kết quả kiểm tra</th></tr></thead><tbody>${previewRows}</tbody></table></div><p><strong>Không thay scoring 100/80/60/0.</strong> Task cũ chỉ hủy mềm; registration gốc được giữ và chuyển về PENDING / Khi phát sinh.</p>`,
          confirmText:safe.length ? `Xử lý ${safe.length} đăng ký` : "Đóng",
          cancelText:"Quay lại",
          danger:true,
          showCancel:safe.length > 0
        });
        if (!confirmed || !safe.length) throw new Error("Chưa thực hiện thay đổi.");

        const result = await AdminMaintenanceService.applyEventDrivenResetBatch({
          records:safe.map(item => ({ id:item.candidate?.id })),
          reason
        });
        const resultRows = result.results.map(item => `<tr><td>${escapeHtml(item.registrationId)}</td><td>${item.ok ? "✅ Thành công" : "⚠️ Không xử lý"}</td><td>${escapeHtml(item.message || "")}</td></tr>`).join("");
        await ModalService.open({
          title:"Kết quả xử lý",
          eyebrow:"ADMIN · AUDIT",
          messageHtml:`<div class="admin-correction-preview">Thành công: <strong>${result.succeeded}</strong> · Không xử lý/lỗi: <strong>${result.failed}</strong>.</div><div class="admin-diagnostic-table"><table><thead><tr><th>Registration ID</th><th>Kết quả</th><th>Ghi chú</th></tr></thead><tbody>${resultRows}</tbody></table></div>`,
          confirmText:"Đóng",
          showCancel:false
        });
      },
      onOpen:async root => {
        const period = root.querySelector("#adminEventPeriod");
        const department = root.querySelector("#adminEventDepartment");
        const search = root.querySelector("#adminEventSearch");
        const rows = root.querySelector("#adminEventRows");
        const selectAll = root.querySelector("#adminEventSelectAll");
        const summary = root.querySelector("#adminEventSelectionSummary");
        const selected = new Set();

        const visibleCandidates = () => {
          const periodValue = String(period?.value || "");
          const departmentValue = String(department?.value || "");
          const query = String(search?.value || "").trim().toLocaleLowerCase("vi");
          return candidates.filter(item => {
            if (periodValue && String(item.periodId || "") !== periodValue) return false;
            if (departmentValue && String(item.departmentId || "") !== departmentValue) return false;
            if (!query) return true;
            return [item.userName,item.standardTaskCode,item.taskCode,item.title,item.standardTaskName,item.frequency]
              .some(value => String(value || "").toLocaleLowerCase("vi").includes(query));
          });
        };
        const updateSummary = () => {
          summary.innerHTML = `Đã chọn <strong>${selected.size}</strong>/50 đăng ký. Chỉ các dòng qua Preview mới được xử lý.`;
        };
        const renderRows = () => {
          const visible = visibleCandidates();
          rows.innerHTML = visible.length ? visible.map(item => `<tr>
            <td><input type="checkbox" data-admin-event-registration value="${escapeHtml(item.id)}" ${selected.has(item.id) ? "checked" : ""}></td>
            <td>${escapeHtml(item.userName || item.userId || "")}</td>
            <td>${escapeHtml(item.departmentId || "")}</td>
            <td><strong>${escapeHtml(item.standardTaskCode || item.taskCode || "")}</strong><br><small>${escapeHtml(item.title || item.standardTaskName || "")}</small></td>
            <td>${escapeHtml(item.frequency || "")}</td>
            <td>${escapeHtml(item.status || "")}</td>
          </tr>`).join("") : `<tr><td colspan="6">Không có đăng ký phù hợp bộ lọc.</td></tr>`;
          rows.querySelectorAll('[data-admin-event-registration]').forEach(input => input.addEventListener("change", event => {
            const id = event.currentTarget.value;
            if (event.currentTarget.checked) {
              if (selected.size >= 50) {
                event.currentTarget.checked = false;
                ToastService.error("Mỗi lần chỉ chọn tối đa 50 đăng ký.");
                return;
              }
              selected.add(id);
            } else selected.delete(id);
            updateSummary();
          }));
          if (selectAll) selectAll.checked = visible.length > 0 && visible.every(item => selected.has(item.id));
        };
        [period,department,search].forEach(control => control?.addEventListener(control === search ? "input" : "change", renderRows));
        selectAll?.addEventListener("change", event => {
          const visible = visibleCandidates();
          if (event.currentTarget.checked) {
            for (const item of visible) {
              if (selected.size >= 50) break;
              selected.add(item.id);
            }
          } else {
            visible.forEach(item => selected.delete(item.id));
          }
          renderRows();
          updateSummary();
        });
        renderRows();
        updateSummary();
      }
    });
    if (modal) ToastService.success("Đã hoàn tất phiên xử lý ADMIN.");
  } catch (error) {
    if ((error?.message || "") !== "Chưa thực hiện thay đổi.") {
      ToastService.error(error?.message || "Không mở được chức năng chuyển Khi phát sinh.");
    }
  }
}

async function openAdminCorrection() {
  try {
    const candidates = await AdminMaintenanceService.listCorrectionCandidates();
    if (!candidates.length) return ToastService.info?.("Không có dữ liệu phù hợp để sửa sai.") || ToastService.success("Không có dữ liệu phù hợp để sửa sai.");
    const label = item => {
      const owner = item.ownerName || item.userName || item.fullName || item.ownerEmail || "";
      const code = item.taskCode || item.standardTaskCode || "";
      const title = item.title || item.standardTaskName || "Không có tên";
      return `${owner ? owner + " · " : ""}${code ? code + " · " : ""}${title} · ${item.status || ""}`;
    };
    const options = candidates.slice(0, 2500).map(item =>
      `<option value="${escapeHtml(item.kind + "::" + item.id)}">${escapeHtml(label(item))}</option>`
    ).join("");
    const html = `<div class="admin-correction-form">
      <p>Chọn đúng bản ghi cần xử lý. Hệ thống chỉ cho hiện thao tác phù hợp với trạng thái hiện tại; không xóa minh chứng và không sửa archive.</p>
      <label><span>Dữ liệu</span><select id="adminCorrectionRecord">${options}</select></label>
      <div id="adminCorrectionPreview" class="admin-correction-preview">Đang kiểm tra…</div>
      <label><span>Thao tác</span><select id="adminCorrectionAction"></select></label>
      <label><span>Lý do xử lý *</span><textarea id="adminCorrectionReason" rows="4" maxlength="1000" placeholder="Ghi rõ lý do người dùng thao tác nhầm hoặc nội dung cần khắc phục"></textarea></label>
    </div>`;
    const modal = await ModalService.open({
      title: "Quản trị sửa sai có kiểm soát",
      messageHtml: html,
      confirmText: "Thực hiện",
      cancelText: "Hủy",
      danger: true,
      beforeConfirm: async root => {
        const key = root.querySelector("#adminCorrectionRecord")?.value || "";
        const [kind,id] = key.split("::");
        const record = candidates.find(item => item.kind === kind && item.id === id);
        const reason = root.querySelector("#adminCorrectionReason")?.value || "";
        const action = root.querySelector("#adminCorrectionAction")?.value || "";
        if (!record || !action) throw new Error("Không có thao tác phù hợp với dữ liệu hiện tại.");
        if (!reason.trim()) throw new Error("Phải nhập lý do sửa sai.");
        await AdminMaintenanceService.applyCorrection({ record, action, reason });
      },
      onOpen: async root => {
        const recordSelect = root.querySelector("#adminCorrectionRecord");
        const actionSelect = root.querySelector("#adminCorrectionAction");
        const previewRoot = root.querySelector("#adminCorrectionPreview");
        const labels = {
          CANCEL_REGISTRATION:"Hủy đăng ký",
          REOPEN_REGISTRATION:"Mở lại đăng ký",
          CANCEL_TASK:"Hủy nhiệm vụ có kiểm soát",
          REOPEN_TASK:"Mở lại nhiệm vụ",
          REOPEN_SELF_ASSESSMENT:"Mở lại tự đánh giá",
          REOPEN_CONFIRMATION:"Mở lại xác nhận KPI"
        };
        const refresh = async () => {
          const [kind,id] = (recordSelect.value || "").split("::");
          const record = candidates.find(item => item.kind === kind && item.id === id);
          if (!record) return;
          previewRoot.textContent = "Đang kiểm tra trạng thái và dữ liệu liên quan…";
          try {
            const result = await AdminMaintenanceService.correctionPreview(record);
            if (result.archived) {
              previewRoot.innerHTML = "<strong>Kỳ đã archive.</strong> Không được sửa trực tiếp dữ liệu này.";
              actionSelect.innerHTML = "";
              return;
            }
            actionSelect.innerHTML = result.actions.map(action => `<option value="${action}">${escapeHtml(labels[action] || action)}</option>`).join("");
            previewRoot.innerHTML = `<strong>${escapeHtml(label(result.record))}</strong><br><small>${result.actions.length ? "Chỉ những thao tác bên dưới được phép." : "Không có thao tác sửa sai an toàn cho trạng thái này."}</small>`;
          } catch (error) {
            previewRoot.textContent = error.message || "Không kiểm tra được dữ liệu.";
            actionSelect.innerHTML = "";
          }
        };
        recordSelect.addEventListener("change", refresh);
        await refresh();
      }
    });
    if (modal) ToastService.success("Đã thực hiện sửa sai và ghi nhật ký.");
  } catch (error) {
    ToastService.error(error.message || "Không mở được chức năng sửa sai.");
  }
}

function issueTable(issues) {
  if (!issues.length) return '<div class="success-banner">Không phát hiện lỗi cấu trúc trong phạm vi đã kiểm tra.</div>';
  const rows = issues.slice(0, 100).map(item => `<tr><td><span class="diagnostic-level ${item.level.toLowerCase()}">${escapeHtml(item.level)}</span></td><td>${escapeHtml(item.code)}</td><td>${escapeHtml(item.collection)}</td><td>${escapeHtml(item.documentId)}</td><td>${escapeHtml(item.message)}</td></tr>`).join("");
  return `<div class="admin-diagnostic-table"><table><thead><tr><th>Mức</th><th>Mã</th><th>Collection</th><th>Document</th><th>Nội dung</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function renderDenied(outlet, user) { outlet.innerHTML = `<section class="page-card"><div class="empty-state"><div class="empty-icon">🔒</div><strong>Không có quyền truy cập</strong><p>Tài khoản ${escapeHtml(user.fullName || user.email)} không có vai trò ADMIN.</p><a class="secondary-button" href="#/dashboard">Quay về Trang chủ</a></div></section>`; }
function metric(label, value) { return `<article class="summary-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`; }
function loadingCard(message) { return `<section class="page-card"><div class="empty-state"><div class="empty-icon">⏳</div><strong>${escapeHtml(message)}</strong></div></section>`; }
function errorCard(title, error) { return `<section class="page-card error-card"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(error?.message || "Lỗi không xác định")}</p></section>`; }
function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
