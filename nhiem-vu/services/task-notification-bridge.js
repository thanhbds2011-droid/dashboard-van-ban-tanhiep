/**
 * V1.23.2 — TASK NOTIFICATION BRIDGE OFF.
 * Không mở listener taskLogs và không dispatch Push.
 */
export const TaskNotificationBridge = Object.freeze({
  async start() { return false; },
  stop() {}
});
