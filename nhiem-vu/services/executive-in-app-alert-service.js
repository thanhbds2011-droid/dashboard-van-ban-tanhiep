/**
 * V1.23.2 — EXECUTIVE IN-APP ALERTS OFF.
 * Không mở realtime listener executiveDirectives/executiveDirectiveUpdates.
 */
export const ExecutiveInAppAlertService = Object.freeze({
  start() { return false; },
  stop() {}
});
