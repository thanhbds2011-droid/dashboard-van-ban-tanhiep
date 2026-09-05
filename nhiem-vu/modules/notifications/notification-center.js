/** Trung tâm thông báo cá nhân V1.23.0. */
import { UserNotificationService } from "../../services/user-notification-service.js?v=20260904.V1_23_0";
import { ToastService } from "../../core/toast-service.js?v=20260904.V1_23_0";

let items = [];
let unsubscribe = null;
let currentUid = "";

const clean = value => String(value ?? "").trim();
const escapeHtml = value => clean(value)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#039;");

function timestampDate(value) {
  if (value?.toDate) return value.toDate();
  if (value?.seconds) return new Date(Number(value.seconds) * 1000);
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

function relativeTime(value) {
  const date = timestampDate(value);
  if (!date) return "Vừa xong";
  const diff = Math.max(0, Date.now() - date.getTime());
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Vừa xong";
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function ensureBadge(button) {
  if (!button) return null;
  let badge = button.querySelector(".notification-unread-badge");
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "notification-unread-badge hidden";
    badge.setAttribute("aria-label", "Thông báo chưa đọc");
    button.appendChild(badge);
  }
  return badge;
}

function updateBadges() {
  const count = items.filter(item => item.read !== true).length;
  [document.getElementById("btnPushSettings"), document.getElementById("btnMobilePushSettings")].forEach(button => {
    const badge = ensureBadge(button);
    if (!badge) return;
    badge.textContent = count > 99 ? "99+" : String(count);
    badge.classList.toggle("hidden", count === 0);
  });
}

function ensureModal() {
  let modal = document.getElementById("notificationCenterModal");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "notificationCenterModal";
  modal.className = "app-modal-backdrop hidden";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.innerHTML = `<section class="app-modal-card notification-center-card">
    <header class="app-modal-header">
      <div><span class="modal-kicker">Tài khoản hiện tại</span><h2>🔔 Thông báo</h2><p>Theo dõi các phê duyệt và cập nhật nhiệm vụ liên quan đến bạn.</p></div>
      <button id="btnCloseNotificationCenter" class="modal-close-button" type="button" aria-label="Đóng">×</button>
    </header>
    <div class="notification-center-toolbar">
      <button id="btnMarkAllNotificationsRead" class="secondary-button" type="button">✓ Đánh dấu tất cả đã đọc</button>
      <button id="btnOpenPushSettingsFromNotifications" class="secondary-button" type="button">⚙ Cài đặt Push</button>
    </div>
    <div id="notificationCenterList" class="notification-center-list"></div>
  </section>`;
  document.body.appendChild(modal);
  modal.querySelector("#btnCloseNotificationCenter")?.addEventListener("click", close);
  modal.addEventListener("click", event => { if (event.target === modal) close(); });
  modal.querySelector("#btnOpenPushSettingsFromNotifications")?.addEventListener("click", () => {
    close();
    window.dispatchEvent(new CustomEvent("app:open-push-settings"));
  });
  modal.querySelector("#btnMarkAllNotificationsRead")?.addEventListener("click", async event => {
    event.currentTarget.disabled = true;
    try { await UserNotificationService.markAllRead(items); }
    catch (error) { ToastService.error(error?.message || "Không đánh dấu được thông báo."); }
    finally { event.currentTarget.disabled = false; }
  });
  return modal;
}

function renderList() {
  const modal = ensureModal();
  const list = modal.querySelector("#notificationCenterList");
  if (!list) return;
  if (!items.length) {
    list.innerHTML = `<div class="notification-empty"><span>🔔</span><strong>Chưa có thông báo</strong><p>Các phê duyệt và cập nhật liên quan sẽ xuất hiện tại đây.</p></div>`;
    return;
  }
  list.innerHTML = items.map(item => `<button class="notification-item ${item.read === true ? "is-read" : "is-unread"}" type="button" data-notification-id="${escapeHtml(item.id)}" data-route="${escapeHtml(item.route || "")}">
    <span class="notification-dot" aria-hidden="true"></span>
    <span class="notification-item-body"><strong>${escapeHtml(item.title || "Thông báo")}</strong><span>${escapeHtml(item.message || "")}</span><small>${escapeHtml(relativeTime(item.createdAt))}${item.taskCode ? ` · ${escapeHtml(item.taskCode)}` : ""}</small></span>
  </button>`).join("");
  list.querySelectorAll(".notification-item").forEach(button => button.addEventListener("click", async () => {
    const id = button.dataset.notificationId;
    const route = clean(button.dataset.route);
    const item = items.find(entry => entry.id === id);
    if (item?.read !== true) {
      UserNotificationService.markRead(id).catch(error => console.warn("Không đánh dấu được thông báo đã đọc:", error));
    }
    if (route.startsWith("#/")) {
      close();
      window.location.hash = route;
    }
  }));
}

function open() {
  const modal = ensureModal();
  renderList();
  modal.classList.remove("hidden");
  document.body.classList.add("modal-open");
}

function close() {
  document.getElementById("notificationCenterModal")?.classList.add("hidden");
  document.body.classList.remove("modal-open");
}

function bindOpenButtons() {
  const buttons = [document.getElementById("btnPushSettings"), document.getElementById("btnMobilePushSettings")].filter(Boolean);
  buttons.forEach(button => {
    if (button.dataset.notificationCenterBound === "V1.23.0") return;
    button.dataset.notificationCenterBound = "V1.23.0";
    button.title = "Mở trung tâm thông báo";
    const textNode = button.querySelector("span:not(.notification-unread-badge)");
    if (button.id === "btnMobilePushSettings") button.innerHTML = `<span aria-hidden="true">🔔</span>Thông báo`;
    if (textNode && button.id === "btnPushSettings") textNode.textContent = "Thông báo";
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
}

export const NotificationCenter = Object.freeze({
  start(user) {
    if (!user?.uid) return false;
    bindOpenButtons();
    updateBadges();
    if (currentUid === user.uid && unsubscribe) return true;
    unsubscribe?.();
    currentUid = user.uid;
    unsubscribe = UserNotificationService.subscribeCurrentUser(data => {
      items = data;
      updateBadges();
      if (!document.getElementById("notificationCenterModal")?.classList.contains("hidden")) renderList();
    }, error => console.warn("Không theo dõi được Notification Center:", error));
    return true;
  },
  stop() {
    unsubscribe?.();
    unsubscribe = null;
    currentUid = "";
    items = [];
    updateBadges();
    close();
  },
  open
});
