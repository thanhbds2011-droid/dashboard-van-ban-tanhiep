import { UserContext } from "./user-context.js";

export async function initializeUserContext() {
  const auth = window.firebaseAuth;
  const db = window.firestoreDb;

  if (!auth || !db) {
    throw new Error(
      "Firebase chưa được khởi tạo. Hãy kiểm tra firebase-config.js."
    );
  }

  const firebase = window.firebase;

  if (!firebase?.firestore) {
    throw new Error("Không tìm thấy Firebase Firestore SDK.");
  }

  const user = await waitForAuthenticatedUser(auth);

  if (!user) {
    window.location.href = "./login.html";
    return null;
  }

  const profileSnapshot = await db
    .collection("users")
    .doc(user.uid)
    .get();

  if (!profileSnapshot.exists) {
    throw new Error(
      "Không tìm thấy hồ sơ người dùng trong collection users."
    );
  }

  const profile = profileSnapshot.data() || {};

  if (profile.active !== true) {
    throw new Error("Tài khoản hiện đã ngừng hoạt động.");
  }

  UserContext.setUser({
    uid: user.uid,
    email: profile.email || user.email || "",
    fullName: profile.fullName || user.displayName || "",
    role: profile.role || "",
    departmentId: profile.departmentId || "",
    teamId: profile.teamId || "",
    position: profile.position || "",
    kpiReviewerEmail: profile.kpiReviewerEmail || "",
    active: profile.active === true
  });

  return UserContext.getUser();
}

function waitForAuthenticatedUser(auth) {
  return new Promise((resolve, reject) => {
    const unsubscribe = auth.onAuthStateChanged(
      user => {
        unsubscribe();
        resolve(user || null);
      },
      error => {
        unsubscribe();
        reject(error);
      }
    );
  });
}
