/**
 * V1.24.1 — EXECUTIVE NOTIFICATIONS OFF.
 * Giữ interface để Chỉ đạo điều hành không phải thay đổi nghiệp vụ ghi Firestore.
 */
function clean(value) { return String(value ?? "").trim(); }
function buildEventId(action, directiveId, provided = "") {
  const fixed = clean(provided);
  if (fixed) return fixed.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 180);
  return `EXEC_${clean(action).toUpperCase()}_${clean(directiveId)}_${Date.now()}`;
}

export const ExecutiveNotificationService = Object.freeze({
  isConfigured() { return false; },

  async send(action, directiveId, eventData = {}, options = {}) {
    return {
      ok: true,
      status: "DISABLED",
      notificationsDisabled: true,
      eventId: buildEventId(action, directiveId, options?.eventId)
    };
  }
});
