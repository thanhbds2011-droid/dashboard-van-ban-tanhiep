import { UserContext } from "../../core/user-context.js?v=20260826.V1_18_1";
import { Permissions } from "../../core/permissions.js?v=20260826.V1_18_1";
import { ToastService } from "../../core/toast-service.js?v=20260826.V1_18_1";
import { ModalService } from "../../core/modal-service.js?v=20260826.V1_18_1";
import { AdminReadService } from "../../services/admin-read-service.js?v=20260826.V1_18_1";
import { AdminMaintenanceService } from "../../services/admin-maintenance-service.js?v=20260826.V1_18_1";

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
    <div class="page-header"><div><h2>Quản trị hệ thống</h2><p>Chẩn đoán dữ liệu, nhật ký và bảo trì có kiểm soát.</p></div><span class="role-badge">ADMIN · V1.7.2</span></div>
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
