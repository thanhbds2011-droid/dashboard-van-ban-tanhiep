/*
 * =========================================================
 * ĐĂNG NHẬP FIREBASE
 * Hệ thống quản lý nhiệm vụ
 * =========================================================
 */

import {
  auth,
  db
} from "./firebase-config.js";


import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";


import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";


const DASHBOARD_URL =
  "./dashboard.html?v=20260713.1";


const loginForm =
  document.getElementById("loginForm");

const emailInput =
  document.getElementById("email");

const passwordInput =
  document.getElementById("password");

const loginButton =
  document.getElementById("loginButton");

const togglePasswordButton =
  document.getElementById("togglePassword");

const messageBox =
  document.getElementById("message");


let dangXuLy = false;
let dangChuyenTrang = false;


/*
 * Hiển thị thông báo.
 */
function hienThongBao(noiDung, loai = "info") {
  messageBox.textContent = noiDung;

  messageBox.className =
    "message show " + loai;
}


/*
 * Ẩn thông báo.
 */
function anThongBao() {
  messageBox.textContent = "";
  messageBox.className = "message";
}


/*
 * Cập nhật trạng thái nút đăng nhập.
 */
function capNhatNutDangNhap(
  noiDung,
  voHieuHoa
) {
  loginButton.textContent = noiDung;
  loginButton.disabled = Boolean(voHieuHoa);
}


/*
 * Đọc hồ sơ users/{UID}.
 */
async function layHoSoNguoiDung(uid) {
  const userReference =
    doc(db, "users", uid);

  const userSnapshot =
    await getDoc(userReference);

  if (!userSnapshot.exists()) {
    const error = new Error(
      "Tài khoản chưa có hồ sơ phân quyền trong hệ thống."
    );

    error.code = "app/profile-not-found";
    throw error;
  }

  const profile = userSnapshot.data();

  if (profile.active !== true) {
    const error = new Error(
      "Tài khoản đã bị khóa hoặc ngừng hoạt động."
    );

    error.code = "app/account-inactive";
    throw error;
  }

  if (
    !profile.role ||
    !profile.departmentId ||
    !profile.fullName
  ) {
    const error = new Error(
      "Hồ sơ người dùng chưa đầy đủ thông tin phân quyền."
    );

    error.code = "app/profile-incomplete";
    throw error;
  }

  return profile;
}


/*
 * Chuyển tới Dashboard sau khi xác thực:
 * - Firebase Authentication;
 * - hồ sơ users/{UID};
 * - active = true;
 * - có role, departmentId và fullName.
 */
async function xuLyNguoiDungDaDangNhap(user) {
  if (
    !user ||
    dangChuyenTrang
  ) {
    return;
  }

  dangChuyenTrang = true;

  capNhatNutDangNhap(
    "Đang kiểm tra quyền truy cập...",
    true
  );

  hienThongBao(
    "Đã xác thực tài khoản. Đang kiểm tra hồ sơ và quyền sử dụng...",
    "info"
  );

  try {
    const profile =
      await layHoSoNguoiDung(user.uid);

    sessionStorage.setItem(
      "task_user_uid",
      user.uid
    );

    sessionStorage.setItem(
      "task_user_full_name",
      profile.fullName || ""
    );

    sessionStorage.setItem(
      "task_user_department_id",
      profile.departmentId || ""
    );

    sessionStorage.setItem(
      "task_user_position",
      profile.position || ""
    );

    sessionStorage.setItem(
      "task_user_role",
      profile.role || ""
    );

    hienThongBao(
      "Đăng nhập thành công. Đang mở hệ thống...",
      "success"
    );

    window.setTimeout(function() {
      window.location.replace(
        DASHBOARD_URL
      );
    }, 700);

  } catch (error) {
    console.error(
      "Không xác thực được hồ sơ:",
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

    dangChuyenTrang = false;
    dangXuLy = false;

    capNhatNutDangNhap(
      "Đăng nhập",
      false
    );

    hienThongBao(
      error && error.message
        ? error.message
        : "Không xác thực được quyền sử dụng hệ thống.",
      "error"
    );
  }
}


/*
 * Chuyển mã lỗi Firebase thành thông báo dễ hiểu.
 */
function layThongBaoLoiDangNhap(error) {
  const code =
    error && error.code
      ? error.code
      : "";

  switch (code) {
    case "auth/invalid-email":
      return "Địa chỉ email không đúng định dạng.";

    case "auth/missing-password":
      return "Vui lòng nhập mật khẩu.";

    case "auth/invalid-credential":
    case "auth/user-not-found":
    case "auth/wrong-password":
      return "Email hoặc mật khẩu không chính xác.";

    case "auth/user-disabled":
      return "Tài khoản đăng nhập đã bị vô hiệu hóa.";

    case "auth/too-many-requests":
      return "Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau.";

    case "auth/network-request-failed":
      return "Không kết nối được Firebase. Vui lòng kiểm tra mạng.";

    case "auth/operation-not-allowed":
      return "Phương thức đăng nhập Email/Mật khẩu chưa được bật.";

    default:
      return "Không đăng nhập được. Vui lòng kiểm tra lại thông tin.";
  }
}


/*
 * Xử lý gửi biểu mẫu đăng nhập.
 */
loginForm.addEventListener(
  "submit",
  async function(event) {
    event.preventDefault();

    if (dangXuLy) {
      return;
    }

    const email =
      String(emailInput.value || "")
        .trim()
        .toLowerCase();

    const password =
      String(passwordInput.value || "");

    emailInput.value = email;

    if (!email) {
      hienThongBao(
        "Vui lòng nhập email đăng nhập.",
        "error"
      );

      emailInput.focus();
      return;
    }

    if (!password) {
      hienThongBao(
        "Vui lòng nhập mật khẩu.",
        "error"
      );

      passwordInput.focus();
      return;
    }

    dangXuLy = true;
    anThongBao();

    capNhatNutDangNhap(
      "Đang đăng nhập...",
      true
    );

    try {
      /*
       * Sau khi đăng nhập thành công,
       * onAuthStateChanged sẽ tự chạy
       * và kiểm tra hồ sơ Firestore.
       */
      await signInWithEmailAndPassword(
        auth,
        email,
        password
      );

    } catch (error) {
      console.error(
        "Lỗi đăng nhập Firebase:",
        error
      );

      dangXuLy = false;

      capNhatNutDangNhap(
        "Đăng nhập",
        false
      );

      hienThongBao(
        layThongBaoLoiDangNhap(error),
        "error"
      );
    }
  }
);


/*
 * Hiện hoặc ẩn mật khẩu.
 */
togglePasswordButton.addEventListener(
  "click",
  function() {
    const dangAn =
      passwordInput.type === "password";

    passwordInput.type =
      dangAn ? "text" : "password";

    togglePasswordButton.textContent =
      dangAn ? "🙈" : "👁";

    togglePasswordButton.setAttribute(
      "aria-label",
      dangAn
        ? "Ẩn mật khẩu"
        : "Hiện mật khẩu"
    );

    passwordInput.focus();
  }
);


/*
 * Theo dõi trạng thái Authentication.
 *
 * Khi người dùng đã đăng nhập từ trước,
 * trang sẽ kiểm tra hồ sơ rồi chuyển thẳng
 * tới Dashboard.
 */
onAuthStateChanged(
  auth,
  function(user) {
    if (user) {
      xuLyNguoiDungDaDangNhap(user);
      return;
    }

    if (!dangXuLy) {
      capNhatNutDangNhap(
        "Đăng nhập",
        false
      );
    }
  }
);
