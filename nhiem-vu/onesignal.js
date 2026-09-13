/**
 * V1.23.2 — ONESIGNAL OFF.
 * Adapter no-op để tránh đăng ký OneSignal/subscription nếu file bị gọi ngoài ý muốn.
 */
(() => {
  const snapshot = Object.freeze({
    subscriptionId: "",
    optedIn: false,
    permission: "disabled",
    oneSignalId: "",
    pushProviderKey: "DISABLED",
    pushOrigin: window.location.origin,
    oneSignalAppId: ""
  });
  window.TaskPush = Object.freeze({
    async identify() { return false; },
    async logout() { return true; },
    async requestPermission() { return false; },
    async getSubscriptionSnapshot() { return snapshot; }
  });
})();
