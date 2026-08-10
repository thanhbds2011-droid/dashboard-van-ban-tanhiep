/**
 * Đăng ký thiết bị nhận Push riêng cho Chỉ đạo điều hành.
 * Dùng chung OneSignal App của Trung tâm nhưng lưu collection riêng:
 * executivePushSubscriptions.
 *
 * Không đọc/ghi taskPushSubscriptions và không gọi TaskNotificationService.
 */
import { FirebaseService } from "../core/firebase-service.js?v=20260810.V1_10_3";

let currentUser = null;
let oneSignalInstance = null;
let changeHandler = null;
let startPromise = null;

function clean(value) { return String(value ?? "").trim(); }
function browserPermission() {
  return "Notification" in window ? Notification.permission : "unsupported";
}
function subscriptionSnapshot(OneSignal = oneSignalInstance) {
  return {
    subscriptionId: clean(OneSignal?.User?.PushSubscription?.id),
    optedIn: OneSignal?.User?.PushSubscription?.optedIn === true,
    permission: browserPermission(),
    oneSignalId: clean(OneSignal?.User?.onesignalId)
  };
}
function subscriptionRef(user, subscriptionId) {
  return FirebaseService.doc(
    FirebaseService.db,
    "executivePushSubscriptions",
    `${user.uid}_${subscriptionId}`
  );
}
async function saveSnapshot(snapshot) {
  if (!currentUser?.uid) return false;
  const subscriptionId = clean(snapshot?.subscriptionId);
  if (!subscriptionId) return false;
  await FirebaseService.setDoc(subscriptionRef(currentUser, subscriptionId), {
    subscriptionId,
    userId: currentUser.uid,
    uid: currentUser.uid,
    departmentId: clean(currentUser.departmentId).toUpperCase(),
    role: clean(currentUser.role).toUpperCase(),
    module: "EXECUTIVE_DIRECTIVES",
    active: snapshot.optedIn === true && snapshot.permission === "granted",
    notificationPermission: snapshot.permission || "default",
    oneSignalId: snapshot.oneSignalId || "",
    platform: "WEB_PUSH",
    updatedAt: FirebaseService.serverTimestamp()
  }, { merge: true });
  return true;
}
function bindOneSignalChange(OneSignal) {
  const subscription = OneSignal?.User?.PushSubscription;
  if (!subscription?.addEventListener || changeHandler) return;
  changeHandler = () => {
    saveSnapshot(subscriptionSnapshot(OneSignal))
      .catch(error => console.warn("Không đồng bộ được thiết bị Chỉ đạo điều hành:", error));
  };
  subscription.addEventListener("change", changeHandler);
}
function unbindOneSignalChange() {
  try {
    if (changeHandler && oneSignalInstance?.User?.PushSubscription?.removeEventListener) {
      oneSignalInstance.User.PushSubscription.removeEventListener("change", changeHandler);
    }
  } catch (_) { /* no-op */ }
  changeHandler = null;
}

export const ExecutivePushSubscriptionService = Object.freeze({
  async start(user) {
    currentUser = user || null;
    if (!currentUser?.uid) return false;
    if (startPromise) return startPromise;

    startPromise = new Promise(resolve => {
      let settled = false;
      const finish = value => { if (!settled) { settled = true; resolve(value); } };
      window.setTimeout(() => finish(false), 20000);
      window.OneSignalDeferred = window.OneSignalDeferred || [];
      window.OneSignalDeferred.push(async OneSignal => {
        try {
          oneSignalInstance = OneSignal;
          bindOneSignalChange(OneSignal);
          await saveSnapshot(subscriptionSnapshot(OneSignal));
          finish(true);
        } catch (error) {
          console.warn("Chưa đăng ký được Push Chỉ đạo điều hành:", error);
          finish(false);
        }
      });
    }).finally(() => { startPromise = null; });

    return startPromise;
  },

  async syncNow() {
    if (!currentUser?.uid || !oneSignalInstance) return false;
    return saveSnapshot(subscriptionSnapshot(oneSignalInstance));
  },

  async stop({ deactivate = false } = {}) {
    try {
      if (deactivate && currentUser?.uid && oneSignalInstance) {
        const snapshot = subscriptionSnapshot(oneSignalInstance);
        if (snapshot.subscriptionId) {
          await FirebaseService.setDoc(subscriptionRef(currentUser, snapshot.subscriptionId), {
            active: false,
            notificationPermission: snapshot.permission || "default",
            updatedAt: FirebaseService.serverTimestamp()
          }, { merge: true });
        }
      }
    } catch (error) {
      console.warn("Không tắt được đăng ký Push Chỉ đạo điều hành:", error);
    } finally {
      unbindOneSignalChange();
      currentUser = null;
      oneSignalInstance = null;
      startPromise = null;
    }
  }
});
