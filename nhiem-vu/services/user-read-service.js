/** Đọc người dùng theo đúng phạm vi Firestore Rules. */
import { FirebaseService } from "../core/firebase-service.js";
import { UserContext } from "../core/user-context.js";
import { Permissions } from "../core/permissions.js?v=20260801.V1_5_0";

const CACHE_MS = 5 * 60 * 1000;
const caches = new Map();
const pending = new Map();

function mapSnapshot(snapshot) {
  return snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
}

function normalize(items = []) {
  return items
    .filter(user => user.active === true)
    .sort((a, b) => String(a.fullName || "").localeCompare(String(b.fullName || ""), "vi"));
}

function scopeKey() {
  const user = UserContext.requireUser();
  if (Permissions.canViewAllDepartments()) return `${user.uid}|ALL`;
  if (Permissions.isDepartmentLeader()) return `${user.uid}|DEPARTMENT|${user.departmentId}`;
  return `${user.uid}|SELF`;
}

async function readAuthorizedUsers() {
  const user = UserContext.requireUser();
  const users = FirebaseService.collection(FirebaseService.db, "users");

  if (Permissions.canViewAllDepartments()) {
    return normalize(mapSnapshot(await FirebaseService.getDocs(users)));
  }

  if (Permissions.isDepartmentLeader()) {
    const query = FirebaseService.query(
      users,
      FirebaseService.where("departmentId", "==", user.departmentId),
      FirebaseService.limit(500)
    );
    return normalize(mapSnapshot(await FirebaseService.getDocs(query)));
  }

  const snapshot = await FirebaseService.getDoc(
    FirebaseService.doc(FirebaseService.db, "users", user.uid)
  );
  return snapshot.exists() && snapshot.data()?.active === true
    ? [{ id: snapshot.id, ...snapshot.data() }]
    : [];
}

export const UserReadService = Object.freeze({
  async listActive(options = {}) {
    const force = options.force === true;
    const key = scopeKey();
    const cached = caches.get(key);
    if (!force && cached && Date.now() - cached.loadedAt < CACHE_MS) return cached.items;
    if (!force && pending.has(key)) return pending.get(key);

    const request = readAuthorizedUsers().then(items => {
      caches.set(key, { items, loadedAt: Date.now() });
      return items;
    });
    pending.set(key, request);
    try { return await request; }
    finally { pending.delete(key); }
  },

  invalidate() {
    caches.clear();
    pending.clear();
  },

  byDepartment(users, departmentId) {
    return (users || []).filter(user => user.departmentId === departmentId);
  }
});
