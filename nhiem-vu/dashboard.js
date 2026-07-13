/*
 * =========================================================
 * DASHBOARD QUẢN LÝ NHIỆM VỤ
 * Trung tâm Bảo trợ xã hội Tân Hiệp
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
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";


const LOGIN_URL =
  "./login.html?v=20260713.2";

const PORTAL_URL =
  "../index.html?v=20260713.2";


const state = {
  user: null,
  profile: null,
  departments: {},
  tasks: [],
  loadingTasks: false
};


/* =========================================================
 * PHẦN TỬ GIAO DIỆN
 * ========================================================= */

const loadingScreen =
  document.getElementById("loadingScreen");

const appShell =
  document.getElementById("appShell");

const logoutButton =
  document.getElementById("logoutButton");

const portalButton =
  document.getElementById("portalButton");

const refreshButton =
  document.getElementById("refreshButton");

const welcomeName =
  document.getElementById("welcomeName");

const welcomeDepartment =
  document.getElementById("welcomeDepartment");

const accountBadge =
  document.getElementById("accountBadge");

const metricTotal =
  document.getElementById("metricTotal");

const metricCompleted =
  document.getElementById("metricCompleted");

const metricProcessing =
  document.getElementById("metricProcessing");

const metricOverdue =
  document.getElementById("metricOverdue");

const searchInput =
  document.getElementById("searchInput");

const statusFilter =
  document.getElementById("statusFilter");

const deadlineFilter =
  document.getElementById("deadlineFilter");

const lastUpdated =
  document.getElementById("lastUpdated");

const taskCount =
  document.getElementById("taskCount");

const errorBox =
  document.getElementById("errorBox");

const taskList =
  document.getElementById("taskList");

const emptyState =
  document.getElementById("emptyState");


/* =========================================================
 * HÀM DÙNG CHUNG
 * ========================================================= */

function hienLoi(message) {
  errorBox.textContent = message;
  errorBox.classList.add("show");
}


function anLoi() {
  errorBox.textContent = "";
  errorBox.classList.remove("show");
}


function chuyenVeDangNhap(reason = "") {
  const suffix = reason
    ? "&reason=" + encodeURIComponent(reason)
    : "";

  window.location.replace(
    LOGIN_URL + suffix
  );
}


function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function boDau(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}


function toDate(value) {
  if (!value) {
    return null;
  }

  if (
    typeof value.toDate === "function"
  ) {
    return value.toDate();
  }

  if (value instanceof Date) {
    return value;
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime())
    ? null
    : parsed;
}


function dauNgay(date) {
  if (!date) {
    return null;
  }

  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );
}


function formatDate(value) {
  const date = toDate(value);

  if (!date) {
    return "Chưa xác định";
  }

  return new Intl.DateTimeFormat(
    "vi-VN",
    {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }
  ).format(date);
}


function formatDateTime(date = new Date()) {
  return new Intl.DateTimeFormat(
    "vi-VN",
    {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }
  ).format(date);
}


function tenVaiTro(role) {
  const map = {
    ADMIN: "Quản trị hệ thống",
    DIRECTOR: "Ban Giám đốc",
    DEPARTMENT_LEADER: "Trưởng/Phó phòng"
  };

  return map[role] || role || "Chưa xác định";
}


function tenTrangThai(status) {
  const map = {
    MOI_TIEP_NHAN: "Mới tiếp nhận",
    DANG_THUC_HIEN: "Đang thực hiện",
    CHO_PHOI_HOP: "Chờ phối hợp",
    HOAN_THANH: "Hoàn thành",
    TAM_DUNG: "Tạm dừng",
    HUY: "Hủy"
  };

  return map[status] || status || "Chưa xác định";
}


function classTrangThai(status) {
  const map = {
    MOI_TIEP_NHAN: "status-new",
    DANG_THUC_HIEN: "status-processing",
    CHO_PHOI_HOP: "status-waiting",
    HOAN_THANH: "status-completed",
    TAM_DUNG: "status-paused",
    HUY: "status-cancelled"
  };

  return map[status] || "status-paused";
}


function tenMucDo(priority) {
  const map = {
    THUONG: "Thường",
    QUAN_TRONG: "Quan trọng",
    KHAN: "Khẩn"
  };

  return map[priority] || priority || "Thường";
}


function classMucDo(priority) {
  const map = {
    THUONG: "priority-normal",
    QUAN_TRONG: "priority-important",
    KHAN: "priority-urgent"
  };

  return map[priority] || "priority-normal";
}


function daKetThucTask(task) {
  return (
    task.status === "HOAN_THANH" ||
    task.status === "HUY"
  );
}


function tinhTinhTrangHan(task) {
  if (task.status === "HOAN_THANH") {
    return {
      code: "COMPLETED",
      text: "Đã hoàn thành",
      badgeClass: "status-completed",
      cardClass: "completed"
    };
  }

  if (task.status === "HUY") {
    return {
      code: "CANCELLED",
      text: "Đã hủy",
      badgeClass: "status-cancelled",
      cardClass: ""
    };
  }

  const deadline = dauNgay(
    toDate(task.deadline)
  );

  if (!deadline) {
    return {
      code: "NO_DEADLINE",
      text: "Chưa có hạn",
      badgeClass: "priority-normal",
      cardClass: ""
    };
  }

  const today = dauNgay(new Date());

  const diffDays =
    Math.round(
      (deadline.getTime() - today.getTime())
      / 86400000
    );

  if (diffDays < 0) {
    return {
      code: "OVERDUE",
      text: "Quá hạn " +
        Math.abs(diffDays) +
        " ngày",
      badgeClass: "deadline-overdue",
      cardClass: "overdue"
    };
  }

  if (diffDays === 0) {
    return {
      code: "DUE_TODAY",
      text: "Đến hạn hôm nay",
      badgeClass: "deadline-today",
      cardClass: "due-today"
    };
  }

  if (diffDays <= 5) {
    return {
      code: "UPCOMING",
      text: "Còn " + diffDays + " ngày",
      badgeClass: "deadline-upcoming",
      cardClass: "upcoming"
    };
  }

  return {
    code: "IN_TIME",
    text: "Còn hạn",
    badgeClass: "priority-normal",
    cardClass: ""
  };
}


/* =========================================================
 * ĐỌC HỒ SƠ VÀ PHÒNG BAN
 * ========================================================= */

async function layHoSoNguoiDung(user) {
  const reference =
    doc(db, "users", user.uid);

  const snapshot =
    await getDoc(reference);

  if (!snapshot.exists()) {
    throw new Error(
      "Không tìm thấy hồ sơ phân quyền của tài khoản."
    );
  }

  const profile = snapshot.data();

  if (profile.active !== true) {
    throw new Error(
      "Tài khoản đã bị khóa hoặc ngừng hoạt động."
    );
  }

  if (
    !profile.fullName ||
    !profile.departmentId ||
    !profile.role
  ) {
    throw new Error(
      "Hồ sơ người dùng chưa đầy đủ thông tin."
    );
  }

  return profile;
}


async function napDanhMucPhongBan() {
  const snapshot =
    await getDocs(
      collection(db, "departments")
    );

  const departments = {};

  snapshot.forEach(function(document) {
    const data = document.data();

    if (data.active === true) {
      departments[document.id] =
        data.name || data.code || document.id;
    }
  });

  state.departments = departments;
}


function hienThiThongTinTaiKhoan() {
  const profile = state.profile;

  const departmentName =
    state.departments[
      profile.departmentId
    ] || profile.departmentId;

  welcomeName.textContent =
    "Xin chào, " + profile.fullName;

  welcomeDepartment.textContent =
    departmentName +
    (profile.position
      ? " • " + profile.position
      : "");

  accountBadge.innerHTML =
    escapeHtml(tenVaiTro(profile.role)) +
    "<span>" +
    escapeHtml(profile.email || state.user.email || "") +
    "</span>";
}


/* =========================================================
 * ĐỌC NHIỆM VỤ
 * ========================================================= */

function chuyenSnapshotThanhMap(
  snapshot,
  destinationMap
) {
  snapshot.forEach(function(document) {
    destinationMap.set(
      document.id,
      {
        id: document.id,
        ...document.data()
      }
    );
  });
}


async function napNhiemVu() {
  if (
    state.loadingTasks ||
    !state.profile
  ) {
    return;
  }

  state.loadingTasks = true;

  refreshButton.disabled = true;
  refreshButton.textContent = "⏳ Đang tải...";

  anLoi();

  try {
    const tasksMap = new Map();

    if (
      state.profile.role === "ADMIN" ||
      state.profile.role === "DIRECTOR"
    ) {
      const snapshot =
        await getDocs(
          collection(db, "tasks")
        );

      chuyenSnapshotThanhMap(
        snapshot,
        tasksMap
      );

    } else if (
      state.profile.role ===
        "DEPARTMENT_LEADER"
    ) {
      const departmentId =
        state.profile.departmentId;

      const primaryQuery =
        query(
          collection(db, "tasks"),
          where(
            "primaryDepartmentId",
            "==",
            departmentId
          )
        );

      const supportQuery =
        query(
          collection(db, "tasks"),
          where(
            "supportDepartmentIds",
            "array-contains",
            departmentId
          )
        );

      const results =
        await Promise.all([
          getDocs(primaryQuery),
          getDocs(supportQuery)
        ]);

      chuyenSnapshotThanhMap(
        results[0],
        tasksMap
      );

      chuyenSnapshotThanhMap(
        results[1],
        tasksMap
      );

    } else {
      throw new Error(
        "Vai trò tài khoản chưa được cấp quyền xem nhiệm vụ."
      );
    }

    state.tasks =
      Array.from(tasksMap.values())
        .filter(function(task) {
          return task.active !== false;
        })
        .sort(function(a, b) {
          const dateA =
            toDate(a.updatedAt) ||
            toDate(a.createdAt) ||
            new Date(0);

          const dateB =
            toDate(b.updatedAt) ||
            toDate(b.createdAt) ||
            new Date(0);

          return dateB.getTime() -
            dateA.getTime();
        });

    capNhatThongKe();
    apDungBoLoc();

    lastUpdated.textContent =
      "Cập nhật lúc " +
      formatDateTime(new Date());

  } catch (error) {
    console.error(
      "Không tải được nhiệm vụ:",
      error
    );

    state.tasks = [];

    capNhatThongKe();
    apDungBoLoc();

    const message =
      error && error.code ===
        "permission-denied"
        ? "Tài khoản chưa được cấp quyền đọc dữ liệu nhiệm vụ."
        : (
          error && error.message
            ? error.message
            : "Không tải được dữ liệu nhiệm vụ."
        );

    hienLoi(message);

  } finally {
    state.loadingTasks = false;

    refreshButton.disabled = false;
    refreshButton.textContent = "🔄 Làm mới";
  }
}


/* =========================================================
 * THỐNG KÊ VÀ BỘ LỌC
 * ========================================================= */

function capNhatThongKe() {
  const tasks = state.tasks;

  const completed =
    tasks.filter(function(task) {
      return task.status === "HOAN_THANH";
    }).length;

  const processing =
    tasks.filter(function(task) {
      return (
        task.status === "DANG_THUC_HIEN" ||
        task.status === "CHO_PHOI_HOP" ||
        task.status === "MOI_TIEP_NHAN"
      );
    }).length;

  const overdue =
    tasks.filter(function(task) {
      return (
        tinhTinhTrangHan(task).code ===
        "OVERDUE"
      );
    }).length;

  metricTotal.textContent =
    String(tasks.length);

  metricCompleted.textContent =
    String(completed);

  metricProcessing.textContent =
    String(processing);

  metricOverdue.textContent =
    String(overdue);
}


function taskPhuHopTimKiem(
  task,
  keyword
) {
  if (!keyword) {
    return true;
  }

  const content = boDau([
    task.taskCode,
    task.title,
    task.description,
    task.ownerName,
    task.assignedByName,
    task.result
  ].filter(Boolean).join(" "));

  return content.includes(keyword);
}


function taskPhuHopTrangThai(
  task,
  status
) {
  return (
    status === "ALL" ||
    task.status === status
  );
}


function taskPhuHopThoiHan(
  task,
  filter
) {
  if (filter === "ALL") {
    return true;
  }

  const deadlineStatus =
    tinhTinhTrangHan(task).code;

  if (filter === "COMPLETED") {
    return task.status === "HOAN_THANH";
  }

  return deadlineStatus === filter;
}


function apDungBoLoc() {
  const keyword =
    boDau(searchInput.value);

  const status =
    statusFilter.value;

  const deadline =
    deadlineFilter.value;

  const filtered =
    state.tasks.filter(function(task) {
      return (
        taskPhuHopTimKiem(task, keyword) &&
        taskPhuHopTrangThai(task, status) &&
        taskPhuHopThoiHan(task, deadline)
      );
    });

  hienThiDanhSach(filtered);
}


/* =========================================================
 * HIỂN THỊ DANH SÁCH
 * ========================================================= */

function tenPhong(departmentId) {
  return (
    state.departments[departmentId] ||
    departmentId ||
    "Chưa xác định"
  );
}


function rutGonNoiDung(value, maxLength) {
  const text =
    String(value || "").trim();

  if (text.length <= maxLength) {
    return text;
  }

  return text.slice(0, maxLength).trim() +
    "...";
}


function taoHtmlNhiemVu(task) {
  const deadlineState =
    tinhTinhTrangHan(task);

  const taskCode =
    task.taskCode || "Chưa có mã";

  const title =
    task.title || "Nhiệm vụ chưa có tiêu đề";

  const description =
    rutGonNoiDung(
      task.description || "",
      240
    );

  const ownerName =
    task.ownerName || "Chưa xác định";

  const departmentName =
    tenPhong(task.primaryDepartmentId);

  const source =
    task.sourceDetail ||
    task.sourceType ||
    "Chưa xác định";

  return `
    <article class="task-card ${deadlineState.cardClass}">
      <div class="task-head">

        <div>
          <div class="task-code">
            ${escapeHtml(taskCode)}
          </div>

          <h3 class="task-title">
            ${escapeHtml(title)}
          </h3>

          ${
            description
              ? `
                <p class="task-description">
                  ${escapeHtml(description)}
                </p>
              `
              : ""
          }
        </div>

        <div class="task-badges">
          <span
            class="badge ${classTrangThai(task.status)}"
          >
            ${escapeHtml(tenTrangThai(task.status))}
          </span>

          <span
            class="badge ${classMucDo(task.priority)}"
          >
            ${escapeHtml(tenMucDo(task.priority))}
          </span>

          <span
            class="badge ${deadlineState.badgeClass}"
          >
            ${escapeHtml(deadlineState.text)}
          </span>
        </div>
      </div>

      <div class="task-meta">

        <div>
          <div class="meta-label">
            Phòng xử lý chính
          </div>

          <div class="meta-value">
            ${escapeHtml(departmentName)}
          </div>
        </div>

        <div>
          <div class="meta-label">
            Lãnh đạo phụ trách
          </div>

          <div class="meta-value">
            ${escapeHtml(ownerName)}
          </div>
        </div>

        <div>
          <div class="meta-label">
            Hạn hoàn thành
          </div>

          <div class="meta-value">
            ${escapeHtml(formatDate(task.deadline))}
          </div>
        </div>

        <div>
          <div class="meta-label">
            Nguồn nhiệm vụ
          </div>

          <div class="meta-value">
            ${escapeHtml(source)}
          </div>
        </div>

      </div>
    </article>
  `;
}


function hienThiDanhSach(tasks) {
  taskCount.textContent =
    tasks.length + " nhiệm vụ";

  if (tasks.length === 0) {
    taskList.innerHTML = "";
    emptyState.classList.add("show");
    return;
  }

  emptyState.classList.remove("show");

  taskList.innerHTML =
    tasks.map(taoHtmlNhiemVu).join("");
}


/* =========================================================
 * KHỞI TẠO DASHBOARD
 * ========================================================= */

async function khoiTaoDashboard(user) {
  try {
    state.user = user;

    state.profile =
      await layHoSoNguoiDung(user);

    await napDanhMucPhongBan();

    hienThiThongTinTaiKhoan();

    loadingScreen.classList.add("hidden");
    appShell.classList.remove("hidden");

    await napNhiemVu();

  } catch (error) {
    console.error(
      "Không khởi tạo được Dashboard:",
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

    chuyenVeDangNhap("profile-error");
  }
}


/* =========================================================
 * SỰ KIỆN
 * ========================================================= */

searchInput.addEventListener(
  "input",
  apDungBoLoc
);

statusFilter.addEventListener(
  "change",
  apDungBoLoc
);

deadlineFilter.addEventListener(
  "change",
  apDungBoLoc
);

refreshButton.addEventListener(
  "click",
  napNhiemVu
);


portalButton.addEventListener(
  "click",
  function() {
    window.location.href =
      PORTAL_URL;
  }
);


logoutButton.addEventListener(
  "click",
  async function() {
    logoutButton.disabled = true;

    try {
      await signOut(auth);

      sessionStorage.clear();

      chuyenVeDangNhap("signed-out");

    } catch (error) {
      console.error(
        "Không đăng xuất được:",
        error
      );

      logoutButton.disabled = false;

      alert(
        "Không đăng xuất được. Vui lòng thử lại."
      );
    }
  }
);


/*
 * Firebase khuyến nghị dùng onAuthStateChanged
 * để chờ Authentication hoàn tất khởi tạo.
 */
onAuthStateChanged(
  auth,
  function(user) {
    if (!user) {
      chuyenVeDangNhap(
        "not-signed-in"
      );
      return;
    }

    khoiTaoDashboard(user);
  }
);
