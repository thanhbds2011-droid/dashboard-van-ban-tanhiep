/**
 * V1.23.2 — EXECUTIVE PUSH SUBSCRIPTION OFF.
 * Không đọc/ghi executivePushSubscriptions và không gọi OneSignal.
 */
const EMPTY_SNAPSHOT = Object.freeze({
  subscriptionId: "",
  optedIn: false,
  permission: "disabled",
  oneSignalId: ""
});

export const ExecutivePushSubscriptionService = Object.freeze({
  async start() { return false; },
  async syncNow() { return false; },
  async requestPermission() { return false; },
  getSnapshot() { return EMPTY_SNAPSHOT; },
  async stop() { return true; }
});
