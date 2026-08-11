/** Ứng dụng quản lý nhiệm vụ và đánh giá KPI. */
import { Router } from "./core/router.js?v=20260810.V1_10_6";
import { APP_VERSION_LABEL, BUILD_VERSION } from "./core/app-version.js?v=20260811.V1_11_0";
import { AuthService } from "./core/auth-service.js?v=20260810.V1_10_6";
import { Permissions } from "./core/permissions.js?v=20260810.V1_10_6";
import { ToastService } from "./core/toast-service.js?v=20260810.V1_10_6";
import { FirebaseService } from "./core/firebase-service.js?v=20260810.V1_10_6";
import { ExecutivePushSubscriptionService } from "./services/executive-push-subscription-service.js?v=20260810.V1_10_6";
import { ExecutiveInAppAlertService } from "./services/executive-in-app-alert-service.js?v=20260810.V1_10_6";

let currentPushUser = null;
let saveCurrentPushSnapshot = null;
let stopInAppTaskAlerts = null;

import { renderDashboardView } from "./modules/dashboard/dashboard-view.js?v=20260810.V1_10_6";
import { renderExecutiveDirectivesView } from "./modules/executive-directives/executive-directives-view.js?v=20260811.V1_11_0";
import { renderTasksView } from "./modules/tasks/tasks-view.js?v=20260810.V1_10_6";
import { renderStandardTasksView } from "./modules/standard-tasks/standard-tasks-view.js?v=20260810.V1_10_6";
import { renderPeriodsView } from "./modules/periods/periods-view.js?v=20260810.V1_10_6";
import { renderPlansView } from "./modules/plans/plans-view.js?v=20260810.V1_10_6";
import { renderEvaluationsView } from "./modules/evaluations/evaluations-view.js?v=20260810.V1_10_6";
import { renderReportsView } from "./modules/reports/reports-view.js?v=20260810.V1_10_6";
import { renderAdminView } from "./modules/admin/admin-view.js?v=20260810.V1_10_6";

async function bootstrap() {
  const outlet = document.getElementById("appOutlet");
  if (!outlet) throw new Error("Không tìm thấy vùng hiển thị appOutlet.");

  setLoadingStatus("Đang xác thực tài khoản…");
  const user = await AuthService.initializeUserContext();
  if (!user) return;

  renderCurrentUser(user);
  document.documentElement.dataset.buildVersion = BUILD_VERSION;
  const versionNode = document.getElementById("appVersionLabel");
  if (versionNode) versionNode.textContent = APP_VERSION_LABEL;
  setLoadingStatus("");
  applyRoleBasedNavigation();
  bindLogout();
  bindMobileNavigation();
  bindRouteBranding();
  initializePushNotifications(user);
  bindPushSubscriptionSync(user);
  bindPushSettings(user);
  bindInAppTaskAssignmentAlerts(user);
  ExecutivePushSubscriptionService.start(user)
    .catch(error => console.warn("Chưa đồng bộ được Push Chỉ đạo điều hành:", error));
  ExecutiveInAppAlertService.start(user);

  const router = new Router({
    outlet,
    routes: {
      "#/dashboard": renderDashboardView,
      "#/directives": renderExecutiveDirectivesView,
      "#/tasks": renderTasksView,
      "#/standard-tasks": renderStandardTasksView,
      "#/kpi": renderPlansView,
      "#/kpi/periods": renderPeriodsView,
      "#/kpi/evaluations": renderEvaluationsView,
      "#/reports": renderReportsView,
      "#/admin": renderAdminView
    }
  });
  router.start();
  ToastService.success("Ứng dụng đã sẵn sàng.", 1800);
}

function applyRouteBrand(route = window.location.hash || "#/dashboard") {
  const executive = route === "#/directives";
  const title = document.getElementById("appBrandTitle");
  const subtitle = document.getElementById("appBrandSubtitle");
  if (title) title.textContent = executive ? "Chỉ đạo điều hành" : "Nhiệm vụ và đánh giá KPI";
  if (subtitle) subtitle.textContent = "Trung tâm Bảo trợ xã hội Tân Hiệp";
  document.body.classList.toggle("is-executive-route", executive);
  document.title = executive ? "Chỉ đạo điều hành - Tân Hiệp" : "Nhiệm vụ và đánh giá KPI";
}

function bindRouteBranding() {
  applyRouteBrand();
  document.addEventListener("v3:route-changed", event => applyRouteBrand(event.detail?.route));
}

function setLoadingStatus(text) {
  const userInfo = document.getElementById("currentUserInfo");
  if (userInfo && text) userInfo.textContent = text;
}

function renderCurrentUser(user) {
  const userInfo = document.getElementById("currentUserInfo");
  if (!userInfo) return;
  userInfo.innerHTML = `<strong>${escapeHtml(user.fullName || "Người dùng")}</strong><span>${escapeHtml(currentUserSubtitle(user))}</span>`;
  const avatar = document.getElementById("currentUserAvatar");
  if (avatar) avatar.textContent = getInitials(user.fullName || user.email);
}

function applyRoleBasedNavigation() {
  const adminMenu = document.getElementById("adminMenuItem");
  if (adminMenu) adminMenu.hidden = !Permissions.canAccessAdmin();
}

function bindLogout() {
  const buttons = [
    document.getElementById("btnLogout"),
    document.getElementById("btnMobileLogout")
  ].filter(Boolean);
  if (!buttons.length) return;

  const logout = async () => {
    buttons.forEach(button => { button.disabled = true; });
    try {
      /* Tắt đúng bản ghi thiết bị của tài khoản hiện tại trước khi Firebase logout. */
      const snapshot = await window.TaskPush?.getSubscriptionSnapshot?.().catch(() => null);
      if (snapshot?.subscriptionId && currentPushUser?.uid) {
        const ref = FirebaseService.doc(
          FirebaseService.db,
          "taskPushSubscriptions",
          `${currentPushUser.uid}_${snapshot.subscriptionId}`
        );
        await FirebaseService.setDoc(ref, {
          active: false,
          notificationPermission: snapshot.permission || "default",
          updatedAt: FirebaseService.serverTimestamp()
        }, { merge: true });
      }
      try { stopInAppTaskAlerts?.(); } catch (_) { /* listener đã dừng */ }
      stopInAppTaskAlerts = null;
      await ExecutivePushSubscriptionService.stop({ deactivate: true });
      ExecutiveInAppAlertService.stop();
      await window.TaskPush?.logout?.();
      await AuthService.logout();
    } catch (error) {
      console.error("Logout error:", error);
      ToastService.error("Không thể đăng xuất. Vui lòng thử lại.");
      buttons.forEach(button => { button.disabled = false; });
    }
  };

  buttons.forEach(button => button.addEventListener("click", logout));
}

function bindMobileNavigation() {
  const toggle = document.getElementById("btnMobileMenu");
  const nav = document.getElementById("v3Navigation");
  const overlay = document.getElementById("navOverlay");
  if (!toggle || !nav || !overlay) return;

  const close = () => {
    nav.classList.remove("open");
    overlay.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
  };
  const open = () => {
    nav.classList.add("open");
    overlay.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
  };
  toggle.addEventListener("click", () => nav.classList.contains("open") ? close() : open());
  overlay.addEventListener("click", close);
  nav.addEventListener("click", event => { if (event.target.closest("a")) close(); });
  document.addEventListener("v3:route-changed", close);
}

function bindPushSubscriptionSync(user) {
  currentPushUser = user;
  const save = async snapshot => {
    const subscriptionId = String(snapshot?.subscriptionId || "").trim();
    if (!subscriptionId) return;
    const subscriptionDocumentId = `${user.uid}_${subscriptionId}`;
    const ref = FirebaseService.doc(FirebaseService.db, "taskPushSubscriptions", subscriptionDocumentId);
    await FirebaseService.setDoc(ref, {
      subscriptionId,
      userId: user.uid,
      uid: user.uid,
      departmentId: user.departmentId || "",
      role: user.role || "",
      module: "TASKS",
      active: snapshot.optedIn === true && snapshot.permission === "granted",
      notificationPermission: snapshot.permission || "default",
      oneSignalId: snapshot.oneSignalId || "",
      externalId: user.uid,
      platform: "WEB_PUSH",
      updatedAt: FirebaseService.serverTimestamp()
    }, { merge: true });
  };
  saveCurrentPushSnapshot = save;
  window.addEventListener("taskpush:subscription-change", event => {
    save(event.detail).catch(error => console.warn("Chưa lưu được thiết bị nhận thông báo:", error));
  });
  window.setTimeout(async () => {
    try {
      const snapshot = await window.TaskPush?.getSubscriptionSnapshot?.();
      await save(snapshot);
    } catch (error) {
      console.warn("Chưa đồng bộ được thiết bị nhận thông báo:", error);
    }
  }, 1500);
}

function bindPushSettings(user) {
  const openButtons = [
    document.getElementById("btnPushSettings"),
    document.getElementById("btnMobilePushSettings")
  ].filter(Boolean);
  const modal = document.getElementById("pushSettingsModal");
  if (!openButtons.length || !modal) return;

  const closeButtons = [
    document.getElementById("btnClosePushSettings"),
    document.getElementById("btnPushSettingsDone")
  ].filter(Boolean);
  const stateBox = document.getElementById("pushSettingsState");
  const syncButton = document.getElementById("btnPushResync");
  const permissionButton = document.getElementById("btnPushRequestPermission");

  const text = (id, value) => {
    const target = document.getElementById(id);
    if (target) target.textContent = String(value ?? "—");
  };

  const permissionLabel = value => ({
    granted: "Đã cho phép",
    denied: "Đang bị chặn",
    default: "Chưa lựa chọn"
  })[String(value || "default")] || String(value || "Không xác định");

  const refresh = async ({ resync = false } = {}) => {
    if (stateBox) {
      stateBox.className = "push-settings-state is-loading";
      stateBox.textContent = resync ? "Đang đồng bộ lại thiết bị…" : "Đang kiểm tra trạng thái…";
    }
    if (syncButton) syncButton.disabled = true;
    try {
      if (resync) await window.TaskPush?.identify?.(user.uid, user);
      const snapshot = await window.TaskPush?.getSubscriptionSnapshot?.();
      if (resync && saveCurrentPushSnapshot) await saveCurrentPushSnapshot(snapshot);
      if (resync) await ExecutivePushSubscriptionService.syncNow().catch(() => false);

      let firestoreState = "Chưa có mã thiết bị";
      let executiveState = "Chưa có mã thiết bị";
      if (snapshot?.subscriptionId) {
        const ref = FirebaseService.doc(
          FirebaseService.db,
          "taskPushSubscriptions",
          `${user.uid}_${snapshot.subscriptionId}`
        );
        const stored = await FirebaseService.getDoc(ref).catch(error => {
          console.warn("Không đọc được trạng thái liên kết thiết bị:", error);
          return null;
        });
        firestoreState = stored?.exists?.()
          ? (stored.data()?.active === true ? "Đã đồng bộ · đang hoạt động" : "Đã đồng bộ · đang tắt")
          : "Chưa liên kết với tài khoản";

        const executiveRef = FirebaseService.doc(
          FirebaseService.db,
          "executivePushSubscriptions",
          `${user.uid}_${snapshot.subscriptionId}`
        );
        const executiveStored = await FirebaseService.getDoc(executiveRef).catch(error => {
          console.warn("Không đọc được trạng thái Push Chỉ đạo điều hành:", error);
          return null;
        });
        executiveState = executiveStored?.exists?.()
          ? (executiveStored.data()?.active === true ? "Đã đồng bộ · đang hoạt động" : "Đã đồng bộ · đang tắt")
          : "Chưa liên kết";
      }

      text("pushSettingPermission", permissionLabel(snapshot?.permission));
      text("pushSettingOptedIn", snapshot?.optedIn === true ? "Đã đăng ký" : "Chưa đăng ký");
      text("pushSettingSubscription", snapshot?.subscriptionId || "Chưa có");
      text("pushSettingUid", user.fullName || user.email || "Tài khoản hiện tại");
      text("pushSettingFirestore", firestoreState);
      text("pushSettingExecutive", executiveState);
      text("pushSettingUpdatedAt", new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "medium" }).format(new Date()));

      const ready = snapshot?.permission === "granted" && snapshot?.optedIn === true && Boolean(snapshot?.subscriptionId);
      if (stateBox) {
        stateBox.className = `push-settings-state ${ready ? "is-ready" : "is-warning"}`;
        stateBox.textContent = ready
          ? "Thiết bị đã sẵn sàng nhận thông báo."
          : "Thiết bị chưa hoàn tất đăng ký thông báo; hãy mở quyền hoặc đồng bộ lại.";
      }
    } catch (error) {
      console.error("Không kiểm tra được cài đặt thông báo:", error);
      if (stateBox) {
        stateBox.className = "push-settings-state is-error";
        stateBox.textContent = error?.message || "Không kiểm tra được trạng thái thông báo.";
      }
    } finally {
      if (syncButton) syncButton.disabled = false;
    }
  };

  const open = () => {
    modal.classList.remove("hidden");
    document.body.classList.add("modal-open");
    void refresh();
  };
  const close = () => {
    modal.classList.add("hidden");
    document.body.classList.remove("modal-open");
  };

  openButtons.forEach(button => {
    if (button.dataset.pushSettingsBound === "V1.10.2") return;
    button.dataset.pushSettingsBound = "V1.10.2";
    button.addEventListener("click", () => {
      open();
      if (button.id === "btnMobilePushSettings") {
        document.getElementById("v3Navigation")?.classList.remove("open");
        const overlay = document.getElementById("navOverlay");
        if (overlay) overlay.hidden = true;
        document.getElementById("btnMobileMenu")?.setAttribute("aria-expanded", "false");
      }
    });
  });
  closeButtons.forEach(button => button.addEventListener("click", close));
  modal.addEventListener("click", event => { if (event.target === modal) close(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && !modal.classList.contains("hidden")) close(); });
  syncButton?.addEventListener("click", () => refresh({ resync: true }));
  permissionButton?.addEventListener("click", async () => {
    permissionButton.disabled = true;
    try {
      await ExecutivePushSubscriptionService.requestPermission().catch(() => false);
      await window.TaskPush?.requestPermission?.();
      await refresh({ resync: true });
    } finally {
      permissionButton.disabled = false;
    }
  });
}

function bindInAppTaskAssignmentAlerts(user) {
  try { stopInAppTaskAlerts?.(); } catch (_) { /* listener cũ đã dừng */ }
  stopInAppTaskAlerts = null;
  if (!user?.uid) return;

  const reference = FirebaseService.query(
    FirebaseService.collection(FirebaseService.db, "tasks"),
    FirebaseService.where("ownerUserId", "==", user.uid)
  );
  const knownTaskIds = new Set();
  let initialized = false;

  stopInAppTaskAlerts = FirebaseService.onSnapshot(reference, snapshot => {
    if (!initialized) {
      snapshot.docs.forEach(doc => knownTaskIds.add(doc.id));
      initialized = true;
      return;
    }

    snapshot.docChanges().forEach(change => {
      if (change.type !== "added") return;
      const task = { id: change.doc.id, ...change.doc.data() };
      if (knownTaskIds.has(task.id)) return;
      knownTaskIds.add(task.id);
      if (task.active === false) return;
      if (String(task.assignmentStatus || "").toUpperCase() === "DA_TIEP_NHAN") return;
      const code = String(task.taskCode || "").trim();
      const title = String(task.title || "Nhiệm vụ mới").trim();
      ToastService.success(
        `Bạn vừa được giao ${code ? `${code} – ` : ""}${title}.`,
        6500
      );
    });
  }, error => {
    console.warn("Không theo dõi được nhiệm vụ mới của tài khoản hiện tại:", error);
  });
}

function initializePushNotifications(user) {
  window.setTimeout(async () => {
    try {
      if (window.TaskPush?.identify) {
        await window.TaskPush.identify(user.uid, user);
      }
    } catch (error) {
      console.warn("Chưa đồng bộ được thông báo đẩy:", error);
    }
  }, 0);
}

function currentUserSubtitle(user) {
  const departments = {
    BGD: "Ban Giám đốc", TCHC: "Phòng Tổ chức – Hành chính", CTXH: "Phòng Công tác xã hội",
    KHTC: "Phòng Kế hoạch – Tài chính", YT: "Phòng Y tế", KI: "Khu I", KII: "Khu II", KIII: "Khu III"
  };
  const additional = {
    CDTN_BI_THU: "Bí thư Chi đoàn", CDTN_PHO_BI_THU: "Phó Bí thư Chi đoàn",
    CDTN_UY_VIEN_BCH: "Ủy viên BCH Chi đoàn", CDTN_DOAN_VIEN: "Đoàn viên Chi đoàn"
  };
  const base = `${user.position || formatRole(user.role)} ${departments[user.departmentId] || user.departmentId || ""}`.trim();
  const labels = (user.additionalRoles || []).map(role => additional[String(role || "").toUpperCase()]).filter(Boolean);
  return labels.length ? `${base}, ${labels.join(", ")}` : base;
}

function formatRole(role) {
  return ({ ADMIN: "Quản trị viên", DIRECTOR: "Ban Giám đốc", DEPARTMENT_LEADER: "Trưởng/Phó phòng, khu", TCHC_COORDINATOR: "Đầu mối TCHC", STAFF: "Viên chức" })[String(role || "").toUpperCase()] || role || "Người dùng";
}
function getInitials(value) {
  return String(value || "ND").trim().split(/\s+/).slice(-2).map(item => item[0] || "").join("").toUpperCase();
}
function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

bootstrap().catch(error => {
  console.error("Lỗi khởi động ứng dụng:", error);
  const userInfo = document.getElementById("currentUserInfo");
  if (userInfo) userInfo.innerHTML = `<strong>Không tải được tài khoản</strong><span>Vui lòng xem thông báo bên dưới</span>`;
  const outlet = document.getElementById("appOutlet");
  if (outlet) outlet.innerHTML = `
    <section class="page-card error-card auth-error-card">
      <h2>Không thể tải tài khoản</h2>
      <p>${escapeHtml(error?.message || "Lỗi không xác định.")}</p>
      <div class="page-actions">
        <button id="btnRetryBootstrap" type="button" class="primary-button">↻ Thử lại</button>
        <button id="btnForceLogout" type="button" class="secondary-button">Đăng xuất và đăng nhập lại</button>
      </div>
      <p class="helper-text">Nếu lỗi lặp lại, vui lòng liên hệ quản trị viên để kiểm tra tài khoản và quyền truy cập.</p>
    </section>`;
  document.getElementById("btnRetryBootstrap")?.addEventListener("click", () => window.location.reload());
  document.getElementById("btnForceLogout")?.addEventListener("click", async () => {
    try { await AuthService.logout(); } catch (_) { window.location.replace("./login.html"); }
  });
});
