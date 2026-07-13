/*
 * =========================================================
 * DASHBOARD KIỂM TRA ĐĂNG NHẬP
 * =========================================================
 */

import {
  auth,
  db
} from "./firebase-config.js";


import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";


import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";


const LOGIN_URL =
  "./login.html?v=20260713.1";


const loadingBox =
  document.getElementById("loading");

const userCard =
  document.getElementById("userCard");

const fullNameElement =
  document.getElementById("fullName");

const emailElement =
  document.getElementById("email");

const departmentElement =
  document.getElementById("department");

const positionElement =
  document.getElementById("position");

const roleElement =
  document.getElementById("role");

const statusElement =
  document.getElementById("status");

const logoutButton =
  document.getElementById("logoutButton");


let daXuLyNguoiDung = false;


/*
 * Chuyển mã vai trò sang tên hiển thị.
 */
function tenVaiTro(role) {
  const roles = {
    ADMIN: "Quản trị hệ thống",
    DIRECTOR: "Ban Giám đốc",
    DEPARTMENT_LEADER: "Trưởng/Phó phòng"
  };

  return roles[role] || role || "Chưa xác định";
}


/*
 * Chuyển về trang đăng nhập.
 */
function veTrangDangNhap(reason = "") {
  const query = reason
    ? "&reason=" + encodeURIComponent(reason)
    : "";

  window.location.replace(
    LOGIN_URL + query
  );
}


/*
 * Đọc hồ sơ người dùng và phòng ban.
 */
async function napThongTinNguoiDung(user) {
  const userReference =
    doc(db, "users", user.uid);

  const userSnapshot =
    await getDoc(userReference);

  if (!userSnapshot.exists()) {
    throw new Error(
      "Không tìm thấy hồ sơ người dùng."
    );
  }

  const profile = userSnapshot.data();

  if (profile.active !== true) {
    throw new Error(
      "Tài khoản đã bị khóa hoặc ngừng hoạt động."
    );
  }

  const departmentReference =
    doc(
      db,
      "departments",
      profile.departmentId
    );

  const departmentSnapshot =
    await getDoc(departmentReference);

  const departmentName =
    departmentSnapshot.exists()
      ? departmentSnapshot.data().name
      : profile.departmentId;

  fullNameElement.textContent =
    profile.fullName || "—";

  emailElement.textContent =
    profile.email || user.email || "—";

  departmentElement.textContent =
    departmentName || "—";

  positionElement.textContent =
    profile.position || "—";

  roleElement.textContent =
    tenVaiTro(profile.role);

  statusElement.textContent =
    profile.active === true
      ? "Đang hoạt động"
      : "Ngừng hoạt động";

  loadingBox.style.display = "none";
  userCard.classList.add("show");
}


/*
 * Theo dõi tài khoản hiện tại.
 */
onAuthStateChanged(
  auth,
  async function(user) {
    if (daXuLyNguoiDung) {
      return;
    }

    if (!user) {
      veTrangDangNhap("not-signed-in");
      return;
    }

    daXuLyNguoiDung = true;

    try {
      await napThongTinNguoiDung(user);

    } catch (error) {
      console.error(
        "Không tải được hồ sơ:",
        error
      );

      try {
        await signOut(auth);
      } catch (signOutError) {
        console.error(
          "Không thể đăng xuất:",
          signOutError
        );
      }

      veTrangDangNhap("profile-error");
    }
  }
);


/*
 * Đăng xuất.
 */
logoutButton.addEventListener(
  "click",
  async function() {
    logoutButton.disabled = true;
    logoutButton.textContent = "Đang đăng xuất...";

    try {
      await signOut(auth);

      sessionStorage.removeItem(
        "task_user_uid"
      );

      sessionStorage.removeItem(
        "task_user_full_name"
      );

      sessionStorage.removeItem(
        "task_user_department_id"
      );

      sessionStorage.removeItem(
        "task_user_position"
      );

      sessionStorage.removeItem(
        "task_user_role"
      );

      veTrangDangNhap("signed-out");

    } catch (error) {
      console.error(
        "Lỗi đăng xuất:",
        error
      );

      logoutButton.disabled = false;
      logoutButton.textContent = "Đăng xuất";

      alert(
        "Không đăng xuất được. Vui lòng thử lại."
      );
    }
  }
);
