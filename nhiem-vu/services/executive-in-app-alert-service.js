/**
 * V1.24.1 — EXECUTIVE IN-APP ALERTS OFF.
 * Không mở realtime listener executiveDirectives/executiveDirectiveUpdates.
 */
export const ExecutiveInAppAlertService = Object.freeze({
  start() { return false; },
  stop() {}
});
