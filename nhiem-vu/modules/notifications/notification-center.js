/**
 * V1.24.1 — NOTIFICATION CENTER OFF.
 * Giữ module export để tương thích import cũ; không mở listener Firestore.
 */
export const NotificationCenter = Object.freeze({
  start() { return false; },
  stop() {},
  open() { return false; }
});
