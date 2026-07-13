import {
  auth,
  db
} from "./firebase-config.js?v=20260714.82";

import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocsFromServer,
  serverTimestamp,
  setDoc,
  Timestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const PORTAL_URL = "../index.html";

const state = {
  user: null,
  profile: null,
  departments: [],
  users: [],
  tasks: [],
  loadingTasks: false,
  savingTask: false,
  initializedUid: null,
  selectedSupportIds: new Set()
};

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: "select_account"
});

const $ = (id) => document.getElementById(id);

const loadingView = $("loadingView");
const loginView = $("loginView");
const appView = $("appView");

const loginForm = $("loginForm");
const loginEmail = $("loginEmail");
const loginPassword = $("loginPassword");
const loginButton = $("loginButton");
const googleLoginButton = $("googleLoginButton");
const loginMessage = $("loginMessage");
const togglePasswordButton = $("togglePasswordButton");

const logoutButton = $("logoutButton");
const portalButton = $("portalButton");

const welcomeName = $("welcomeName");
const welcomeDepartment = $("welcomeDepartment");
const roleBadge = $("roleBadge");

const metricTotal = $("metricTotal");
const metricCompleted = $("metricCompleted");
const metricProcessing = $("metricProcessing");
const metricOverdue = $("metricOverdue");

const searchInput = $("searchInput");
const statusFilter = $("statusFilter");
const deadlineFilter = $("deadlineFilter");
const departmentFilterWrap = $("departmentFilterWrap");
const departmentFilter = $("departmentFilter");
const filterToggleButton = $("filterToggleButton");
const filterFields = $("filterFields");
const refreshButton = $("refreshButton");
const addTaskButton = $("addTaskButton");
const lastUpdated = $("lastUpdated");

const dashboardMessage = $("dashboardMessage");
const taskCount = $("taskCount");
const taskTableWrap = $("taskTableWrap");
const taskTableBody = $("taskTableBody");
const taskCardList = $("taskCardList");
const emptyState = $("emptyState");

const taskModal = $("taskModal");
const closeModalButton = $("closeModalButton");
const cancelTaskButton = $("cancelTaskButton");
const taskForm = $("taskForm");
const taskMessage = $("taskMessage");
const saveTaskButton = $("saveTaskButton");

const taskTitle = $("taskTitle");
const taskDescription = $("taskDescription");
const sourceType = $("sourceType");
const sourceDetail = $("sourceDetail");
const assignedByUserId = $("assignedByUserId");
const priority = $("priority");
const primaryDepartmentId = $("primaryDepartmentId");
const ownerUserId = $("ownerUserId");
const primaryHelp = $("primaryHelp");
const ownerHelp = $("ownerHelp");
const assignedAt = $("assignedAt");
const deadline = $("deadline");

const supportDropdown = $("supportDropdown");
const supportDropdownButton = $("supportDropdownButton");
const supportDropdownPanel = $("supportDropdownPanel");
const supportSummary = $("supportSummary");
const supportSearchInput = $("supportSearchInput");
const supportOptions = $("supportOptions");
const supportSelectedChips = $("supportSelectedChips");

const detailModal = $("detailModal");
const closeDetailButton = $("closeDetailButton");
const detailTaskCode = $("detailTaskCode");
const detailContent = $("detailContent");

/* =========================================================
 * GIAO DIỆN CHUNG
 * ========================================================= */

function showView(name) {
  loadingView.classList.toggle("hidden", name !== "loading");
  loginView.classList.toggle("hidden", name !== "login");
  appView.classList.toggle("hidden", name !== "app");
}

function showMessage(element, text, type = "info") {
  element.textContent = text;
  element.className = `message show ${type}`;
}

function hideMessage(element) {
  element.textContent = "";
  element.className = "message";
}

function setBodyModalState() {
  const hasOpenModal =
    !taskModal.classList.contains("hidden") ||
    !detailModal.classList.contains("hidden");

  document.body.classList.toggle("modal-open", hasOpenModal);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}

function truncate(value, maxLength) {
  const text = cleanText(value);
  return text.length > maxLength
    ? `${text.slice(0, maxLength).trim()}...`
    : text;
}

/* =========================================================
 * NGÀY THÁNG
 * ========================================================= */

function pad2(value) {
  return String(value).padStart(2, "0");
}

function toDate(value) {
  if (!value) {
    return null;
  }

  if (typeof value.toDate === "function") {
    return value.toDate();
  }

  if (value instanceof Date) {
    return value;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfDay(dateValue) {
  return new Date(
    dateValue.getFullYear(),
    dateValue.getMonth(),
    dateValue.getDate()
  );
}

function formatDate(value) {
  const dateValue = toDate(value);

  if (!dateValue) {
    return "Chưa xác định";
  }

  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(dateValue);
}

function formatDateTime(value = new Date()) {
  const dateValue = toDate(value) || new Date();

  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(dateValue);
}

function toLocalDateTimeInput(dateValue) {
  return [
    dateValue.getFullYear(),
    "-",
    pad2(dateValue.getMonth() + 1),
    "-",
    pad2(dateValue.getDate()),
    "T",
    pad2(dateValue.getHours()),
    ":",
    pad2(dateValue.getMinutes())
  ].join("");
}

function toDateInput(dateValue) {
  return [
    dateValue.getFullYear(),
    "-",
    pad2(dateValue.getMonth() + 1),
    "-",
    pad2(dateValue.getDate())
  ].join("");
}

function parseDateInput(value, endOfDay = false) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");

  if (!match) {
    return null;
  }

  const dateValue = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    0
  );

  return Number.isNaN(dateValue.getTime()) ? null : dateValue;
}

function dateKey(dateValue) {
  return `${dateValue.getFullYear()}-${pad2(dateValue.getMonth() + 1)}-${pad2(dateValue.getDate())}`;
}

function monthKey(dateValue) {
  return `${dateValue.getFullYear()}-${pad2(dateValue.getMonth() + 1)}`;
}

function isoWeekKey(dateValue) {
  const utcDate = new Date(Date.UTC(
    dateValue.getFullYear(),
    dateValue.getMonth(),
    dateValue.getDate()
  ));

  const dayNumber = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - dayNumber);

  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil((((utcDate - yearStart) / 86400000) + 1) / 7);

  return `${utcDate.getUTCFullYear()}-W${pad2(weekNumber)}`;
}

function createTaskCode() {
  const now = new Date();
  const random = Math.random().toString(36).slice(2, 5).toUpperCase();

  return [
    "NV-",
    now.getFullYear(),
    pad2(now.getMonth() + 1),
    pad2(now.getDate()),
    "-",
    pad2(now.getHours()),
    pad2(now.getMinutes()),
    pad2(now.getSeconds()),
    "-",
    random
  ].join("");
}

/* =========================================================
 * TÊN HIỂN THỊ
 * ========================================================= */

function roleName(role) {
  const map = {
    ADMIN: "Quản trị hệ thống",
    DIRECTOR: "Ban Giám đốc",
    DEPARTMENT_LEADER: "Trưởng/Phó phòng"
  };

  return map[role] || role || "Chưa xác định";
}

function statusName(status) {
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

function priorityName(value) {
  const map = {
    THUONG: "Thường",
    QUAN_TRONG: "Quan trọng",
    KHAN: "Khẩn"
  };

  return map[value] || value || "Thường";
}

function sourceName(value) {
  const map = {
    VAN_BAN_CHI_DAO: "Văn bản chỉ đạo",
    HOP_GIAO_BAN: "Họp giao ban",
    CHI_DAO_TRUC_TIEP: "Chỉ đạo trực tiếp",
    DOT_XUAT: "Nhiệm vụ đột xuất",
    THUONG_XUYEN: "Nhiệm vụ thường xuyên",
    KE_HOACH_CONG_TAC: "Kế hoạch công tác",
    DINH_KY: "Nhiệm vụ định kỳ",
    KHAC: "Khác"
  };

  return map[value] || value || "Chưa xác định";
}

function departmentById(id) {
  return state.departments.find((item) => item.id === id) || null;
}

function departmentName(id) {
  const department = departmentById(id);
  return department
    ? (department.name || department.code || department.id)
    : (id || "Chưa xác định");
}

function userById(uid) {
  return state.users.find((item) => item.id === uid) || null;
}

function statusBadgeClass(status) {
  const map = {
    MOI_TIEP_NHAN: "blue",
    DANG_THUC_HIEN: "blue",
    CHO_PHOI_HOP: "purple",
    HOAN_THANH: "green",
    TAM_DUNG: "",
    HUY: ""
  };

  return map[status] || "";
}

function priorityBadgeClass(value) {
  const map = {
    KHAN: "red",
    QUAN_TRONG: "orange",
    THUONG: ""
  };

  return map[value] || "";
}

function deadlineState(task) {
  if (task.status === "HOAN_THANH") {
    return {
      code: "COMPLETED",
      text: "Đã hoàn thành",
      className: "green"
    };
  }

  if (task.status === "HUY") {
    return {
      code: "CANCELLED",
      text: "Đã hủy",
      className: ""
    };
  }

  const dueDate = toDate(task.deadline);

  if (!dueDate) {
    return {
      code: "NO_DEADLINE",
      text: "Chưa có hạn",
      className: ""
    };
  }

  const diffDays = Math.round(
    (startOfDay(dueDate) - startOfDay(new Date())) / 86400000
  );

  if (diffDays < 0) {
    return {
      code: "OVERDUE",
      text: `Quá hạn ${Math.abs(diffDays)} ngày`,
      className: "red"
    };
  }

  if (diffDays === 0) {
    return {
      code: "DUE_TODAY",
      text: "Đến hạn hôm nay",
      className: "orange"
    };
  }

  if (diffDays <= 5) {
    return {
      code: "UPCOMING",
      text: `Còn ${diffDays} ngày`,
      className: "blue"
    };
  }

  return {
    code: "IN_TIME",
    text: "Còn hạn",
    className: ""
  };
}

/* =========================================================
 * ĐỌC FIRESTORE
 * ========================================================= */

async function loadProfile(user) {
  const userReference = doc(db, "users", user.uid);
  const userSnapshot = await getDoc(userReference);

  if (userSnapshot.exists()) {
    const profile = userSnapshot.data();

    if (profile.active !== true) {
      throw new Error("Tài khoản đã bị khóa hoặc ngừng hoạt động.");
    }

    if (!profile.fullName || !profile.departmentId || !profile.role) {
      throw new Error("Hồ sơ người dùng chưa đầy đủ thông tin phân quyền.");
    }

    return {
      id: userSnapshot.id,
      ...profile
    };
  }

  const normalizedEmail = cleanText(user.email).toLowerCase();

  if (!normalizedEmail) {
    throw new Error("Tài khoản đăng nhập không cung cấp địa chỉ email.");
  }

  const accessReference = doc(
    db,
    "accessAccounts",
    normalizedEmail
  );

  const accessSnapshot = await getDoc(accessReference);

  if (!accessSnapshot.exists()) {
    const error = new Error(
      "Email này chưa được quản trị cấp quyền sử dụng hệ thống."
    );
    error.code = "app/not-authorized";
    throw error;
  }

  const accessData = accessSnapshot.data();

  if (accessData.active !== true) {
    const error = new Error(
      "Tài khoản đã bị khóa hoặc ngừng hoạt động."
    );
    error.code = "app/account-inactive";
    throw error;
  }

  if (
    !accessData.fullName ||
    !accessData.departmentId ||
    !accessData.role
  ) {
    throw new Error(
      "Thông tin cấp quyền của tài khoản chưa đầy đủ."
    );
  }

  const providerIds = user.providerData
    .map((provider) => provider.providerId)
    .filter(Boolean)
    .join(",");

  const profile = {
    employeeCode: accessData.employeeCode || "",
    fullName: accessData.fullName,
    email: normalizedEmail,
    departmentId: accessData.departmentId,
    position: accessData.position || "",
    role: accessData.role,
    active: true,
    authProvider: providerIds || "unknown",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  await setDoc(userReference, profile);

  return {
    id: user.uid,
    ...profile
  };
}

async function loadReferenceData() {
  const [departmentSnapshot, userSnapshot, khtcSnapshot] = await Promise.all([
    getDocsFromServer(collection(db, "departments")),
    getDocsFromServer(collection(db, "users")),
    getDoc(doc(db, "departments", "KHTC"))
  ]);

  const departmentMap = new Map();

  departmentSnapshot.forEach((item) => {
    const data = item.data();

    if (data.active !== false) {
      departmentMap.set(item.id, {
        id: item.id,
        ...data
      });
    }
  });

  if (khtcSnapshot.exists()) {
    const data = khtcSnapshot.data();

    if (data.active !== false) {
      departmentMap.set("KHTC", {
        id: "KHTC",
        ...data
      });
    }
  }

  state.departments = Array.from(departmentMap.values())
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));

  state.users = [];

  userSnapshot.forEach((item) => {
    state.users.push({
      id: item.id,
      ...item.data()
    });
  });
}

async function loadTasks() {
  if (state.loadingTasks || !state.profile) {
    return;
  }

  state.loadingTasks = true;
  refreshButton.disabled = true;
  refreshButton.textContent = "⏳ Đang tải...";
  hideMessage(dashboardMessage);

  try {
    const snapshot = await getDocsFromServer(collection(db, "tasks"));
    const allTasks = [];

    snapshot.forEach((item) => {
      const task = {
        id: item.id,
        ...item.data()
      };

      if (task.active !== false) {
        allTasks.push(task);
      }
    });

    if (["ADMIN", "DIRECTOR"].includes(state.profile.role)) {
      state.tasks = allTasks;
    } else if (state.profile.role === "DEPARTMENT_LEADER") {
      const departmentId = state.profile.departmentId;

      state.tasks = allTasks.filter((task) => {
        const supportIds = Array.isArray(task.supportDepartmentIds)
          ? task.supportDepartmentIds
          : [];

        const visibleIds = Array.isArray(task.visibleDepartmentIds)
          ? task.visibleDepartmentIds
          : [];

        return (
          task.primaryDepartmentId === departmentId ||
          supportIds.includes(departmentId) ||
          visibleIds.includes(departmentId)
        );
      });
    } else {
      throw new Error("Vai trò tài khoản chưa được cấp quyền xem nhiệm vụ.");
    }

    state.tasks.sort((a, b) => {
      const dateA = toDate(a.updatedAt) || toDate(a.createdAt) || new Date(0);
      const dateB = toDate(b.updatedAt) || toDate(b.createdAt) || new Date(0);
      return dateB.getTime() - dateA.getTime();
    });

    lastUpdated.textContent = `Cập nhật lúc ${formatDateTime()}`;
    renderMetrics();
    applyFilters();
  } catch (error) {
    console.error("Không tải được nhiệm vụ:", error);

    state.tasks = [];
    renderMetrics();
    applyFilters();

    const message = error?.code === "permission-denied"
      ? "Tài khoản chưa được cấp quyền đọc dữ liệu nhiệm vụ. Hãy kiểm tra Firestore Rules đã Publish thành công."
      : (error?.message || "Không tải được dữ liệu nhiệm vụ.");

    showMessage(dashboardMessage, message, "error");
  } finally {
    state.loadingTasks = false;
    refreshButton.disabled = false;
    refreshButton.textContent = "🔄 Làm mới";
  }
}

/* =========================================================
 * TÀI KHOẢN VÀ BỘ LỌC
 * ========================================================= */

function renderAccount() {
  welcomeName.textContent = `Xin chào, ${state.profile.fullName}`;
  welcomeDepartment.textContent = [
    departmentName(state.profile.departmentId),
    state.profile.position
  ].filter(Boolean).join(" • ");

  roleBadge.innerHTML = `
    ${escapeHtml(roleName(state.profile.role))}
    <span>${escapeHtml(state.profile.email || state.user.email || "")}</span>
  `;

  const canCreateTask = ["ADMIN", "DEPARTMENT_LEADER"].includes(state.profile.role);
  addTaskButton.classList.toggle("hidden", !canCreateTask);

  const canFilterDepartment = ["ADMIN", "DIRECTOR"].includes(state.profile.role);
  departmentFilterWrap.classList.toggle("hidden", !canFilterDepartment);

  fillDepartmentFilter();
}

function fillDepartmentFilter() {
  const oldValue = departmentFilter.value || "ALL";

  departmentFilter.innerHTML = '<option value="ALL">Tất cả Phòng/Khu</option>';

  state.departments
    .filter((item) => item.id !== "BGD")
    .forEach((item) => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.name || item.code || item.id;
      departmentFilter.appendChild(option);
    });

  departmentFilter.value = Array.from(departmentFilter.options)
    .some((option) => option.value === oldValue)
    ? oldValue
    : "ALL";
}

function renderMetrics() {
  const completed = state.tasks.filter((task) => task.status === "HOAN_THANH").length;

  const processing = state.tasks.filter((task) => [
    "MOI_TIEP_NHAN",
    "DANG_THUC_HIEN",
    "CHO_PHOI_HOP"
  ].includes(task.status)).length;

  const overdue = state.tasks.filter((task) => (
    deadlineState(task).code === "OVERDUE"
  )).length;

  metricTotal.textContent = String(state.tasks.length);
  metricCompleted.textContent = String(completed);
  metricProcessing.textContent = String(processing);
  metricOverdue.textContent = String(overdue);
}

function applyFilters() {
  const keyword = normalizeText(searchInput.value);
  const selectedStatus = statusFilter.value;
  const selectedDeadline = deadlineFilter.value;
  const selectedDepartment = departmentFilter.value || "ALL";

  const filteredTasks = state.tasks.filter((task) => {
    const searchableContent = normalizeText([
      task.taskCode,
      task.title,
      task.description,
      task.ownerName,
      task.assignedByName,
      task.result,
      departmentName(task.primaryDepartmentId)
    ].filter(Boolean).join(" "));

    const matchesKeyword = !keyword || searchableContent.includes(keyword);
    const matchesStatus = selectedStatus === "ALL" || task.status === selectedStatus;

    const taskDeadlineState = deadlineState(task);
    const matchesDeadline = selectedDeadline === "ALL" || (
      selectedDeadline === "COMPLETED"
        ? task.status === "HOAN_THANH"
        : taskDeadlineState.code === selectedDeadline
    );

    const matchesDepartment = selectedDepartment === "ALL" || (
      task.primaryDepartmentId === selectedDepartment
    );

    return matchesKeyword && matchesStatus && matchesDeadline && matchesDepartment;
  });

  renderTasks(filteredTasks);
}

/* =========================================================
 * HIỂN THỊ DANH SÁCH
 * ========================================================= */

function renderTasks(tasks) {
  taskCount.textContent = `${tasks.length} nhiệm vụ`;

  const isEmpty = tasks.length === 0;
  emptyState.classList.toggle("hidden", !isEmpty);
  taskTableWrap.classList.toggle("hidden", isEmpty);

  if (isEmpty) {
    taskTableBody.innerHTML = "";
    taskCardList.innerHTML = "";
    return;
  }

  taskTableBody.innerHTML = tasks.map((task) => {
    const due = deadlineState(task);

    return `
      <tr data-task-id="${escapeHtml(task.id)}" tabindex="0">
        <td><span class="task-code">${escapeHtml(task.taskCode || "Chưa có mã")}</span></td>
        <td class="task-title-cell">
          <strong>${escapeHtml(task.title || "Nhiệm vụ chưa có tiêu đề")}</strong>
          <span>${escapeHtml(truncate(task.description, 115))}</span>
        </td>
        <td>${escapeHtml(departmentName(task.primaryDepartmentId))}</td>
        <td>${escapeHtml(task.ownerName || "Chưa xác định")}</td>
        <td>
          <strong>${escapeHtml(formatDate(task.deadline))}</strong><br>
          <span class="badge ${due.className}">${escapeHtml(due.text)}</span>
        </td>
        <td>
          <span class="badge ${statusBadgeClass(task.status)}">
            ${escapeHtml(statusName(task.status))}
          </span>
        </td>
      </tr>
    `;
  }).join("");

  taskCardList.innerHTML = tasks.map((task) => {
    const due = deadlineState(task);

    return `
      <article class="task-mobile-card" data-task-id="${escapeHtml(task.id)}" tabindex="0">
        <div class="task-mobile-card-head">
          <div>
            <span class="task-code">${escapeHtml(task.taskCode || "Chưa có mã")}</span>
            <h3>${escapeHtml(task.title || "Nhiệm vụ chưa có tiêu đề")}</h3>
          </div>
          <span class="badge ${statusBadgeClass(task.status)}">
            ${escapeHtml(statusName(task.status))}
          </span>
        </div>

        <p>${escapeHtml(truncate(task.description, 160))}</p>

        <div class="task-mobile-meta">
          <div>
            <span>Phòng/Khu chính</span>
            <strong>${escapeHtml(departmentName(task.primaryDepartmentId))}</strong>
          </div>
          <div>
            <span>Người phụ trách</span>
            <strong>${escapeHtml(task.ownerName || "Chưa xác định")}</strong>
          </div>
          <div>
            <span>Hạn hoàn thành</span>
            <strong>${escapeHtml(formatDate(task.deadline))}</strong>
          </div>
          <div>
            <span>Tình trạng hạn</span>
            <strong class="badge ${due.className}">${escapeHtml(due.text)}</strong>
          </div>
        </div>
      </article>
    `;
  }).join("");
}

function findTaskById(taskId) {
  return state.tasks.find((task) => task.id === taskId) || null;
}

function openTaskDetail(taskId) {
  const task = findTaskById(taskId);

  if (!task) {
    return;
  }

  const due = deadlineState(task);
  const supportNames = Array.isArray(task.supportDepartmentIds)
    ? task.supportDepartmentIds.map(departmentName).join(", ")
    : "Không có";

  detailTaskCode.textContent = task.taskCode || "Chưa có mã";

  detailContent.innerHTML = `
    <h3 class="detail-title">${escapeHtml(task.title || "Nhiệm vụ chưa có tiêu đề")}</h3>
    <p class="detail-description">${escapeHtml(task.description || "Chưa có nội dung chi tiết")}</p>

    <div class="detail-badges">
      <span class="badge ${statusBadgeClass(task.status)}">${escapeHtml(statusName(task.status))}</span>
      <span class="badge ${priorityBadgeClass(task.priority)}">${escapeHtml(priorityName(task.priority))}</span>
      <span class="badge ${due.className}">${escapeHtml(due.text)}</span>
    </div>

    <div class="detail-grid">
      <div class="detail-item">
        <span>Phòng/Khu xử lý chính</span>
        <strong>${escapeHtml(departmentName(task.primaryDepartmentId))}</strong>
      </div>
      <div class="detail-item">
        <span>Phòng/Khu phối hợp</span>
        <strong>${escapeHtml(supportNames || "Không có")}</strong>
      </div>
      <div class="detail-item">
        <span>Lãnh đạo chịu trách nhiệm</span>
        <strong>${escapeHtml(task.ownerName || "Chưa xác định")}</strong>
      </div>
      <div class="detail-item">
        <span>Người giao/chỉ đạo</span>
        <strong>${escapeHtml(task.assignedByName || "Chưa xác định")}</strong>
      </div>
      <div class="detail-item">
        <span>Nguồn nhiệm vụ</span>
        <strong>${escapeHtml(sourceName(task.sourceType))}</strong>
      </div>
      <div class="detail-item">
        <span>Chi tiết nguồn</span>
        <strong>${escapeHtml(task.sourceDetail || "Chưa xác định")}</strong>
      </div>
      <div class="detail-item">
        <span>Ngày giao</span>
        <strong>${escapeHtml(formatDateTime(task.assignedAt))}</strong>
      </div>
      <div class="detail-item">
        <span>Hạn hoàn thành</span>
        <strong>${escapeHtml(formatDate(task.deadline))}</strong>
      </div>
    </div>
  `;

  detailModal.classList.remove("hidden");
  setBodyModalState();
}

function closeTaskDetail() {
  detailModal.classList.add("hidden");
  detailContent.innerHTML = "";
  setBodyModalState();
}

/* =========================================================
 * BIỂU MẪU THÊM NHIỆM VỤ
 * ========================================================= */

function fillAssignedByOptions() {
  const directors = state.users
    .filter((item) => item.active === true && item.role === "DIRECTOR")
    .sort((a, b) => String(a.fullName || "").localeCompare(String(b.fullName || ""), "vi"));

  assignedByUserId.innerHTML = '<option value="">Chọn người giao/chỉ đạo</option>';

  directors.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = [item.fullName, item.position].filter(Boolean).join(" — ");
    assignedByUserId.appendChild(option);
  });

  assignedByUserId.disabled = directors.length === 0;

  if (directors.length === 0) {
    assignedByUserId.innerHTML = '<option value="">Chưa có tài khoản Ban Giám đốc</option>';
  }
}

function fillPrimaryDepartmentOptions() {
  if (state.profile.role === "DEPARTMENT_LEADER") {
    primaryDepartmentId.innerHTML = "";

    const option = document.createElement("option");
    option.value = state.profile.departmentId;
    option.textContent = departmentName(state.profile.departmentId);
    primaryDepartmentId.appendChild(option);

    primaryDepartmentId.value = state.profile.departmentId;
    primaryDepartmentId.disabled = true;
    primaryHelp.textContent = "Phòng xử lý chính được cố định theo tài khoản đăng nhập.";
    return;
  }

  primaryDepartmentId.disabled = false;
  primaryDepartmentId.innerHTML = '<option value="">Chọn phòng xử lý chính</option>';

  state.departments
    .filter((item) => item.id !== "BGD")
    .forEach((item) => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.name || item.code || item.id;
      primaryDepartmentId.appendChild(option);
    });

  primaryHelp.textContent = "Quản trị được chọn phòng xử lý chính.";
}

function fillOwnerOptions() {
  if (state.profile.role === "DEPARTMENT_LEADER") {
    ownerUserId.innerHTML = "";

    const option = document.createElement("option");
    option.value = state.user.uid;
    option.textContent = [state.profile.fullName, state.profile.position]
      .filter(Boolean)
      .join(" — ");

    ownerUserId.appendChild(option);
    ownerUserId.value = state.user.uid;
    ownerUserId.disabled = true;
    ownerHelp.textContent = "Người chịu trách nhiệm là tài khoản đang đăng nhập.";
    return;
  }

  const departmentId = primaryDepartmentId.value;
  ownerUserId.innerHTML = '<option value="">Chọn lãnh đạo chịu trách nhiệm</option>';

  if (!departmentId) {
    ownerUserId.disabled = true;
    ownerHelp.textContent = "Chọn phòng xử lý chính trước.";
    return;
  }

  const leaders = state.users.filter((item) => (
    item.active === true &&
    item.role === "DEPARTMENT_LEADER" &&
    item.departmentId === departmentId
  ));

  leaders.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = [item.fullName, item.position].filter(Boolean).join(" — ");
    ownerUserId.appendChild(option);
  });

  ownerUserId.disabled = leaders.length === 0;
  ownerHelp.textContent = leaders.length > 0
    ? "Chọn một Trưởng/Phó phòng chịu trách nhiệm chính."
    : "Phòng này chưa có tài khoản Trưởng/Phó phòng đang hoạt động.";
}

function availableSupportDepartments() {
  const primaryId = primaryDepartmentId.value;

  return state.departments.filter((item) => (
    item.id !== "BGD" &&
    item.id !== primaryId
  ));
}

function renderSupportOptions() {
  const keyword = normalizeText(supportSearchInput.value);
  const departments = availableSupportDepartments()
    .filter((item) => normalizeText(item.name || item.code || item.id).includes(keyword));

  if (departments.length === 0) {
    supportOptions.innerHTML = '<div class="multi-select-empty">Không tìm thấy phòng/khu phù hợp.</div>';
    return;
  }

  supportOptions.innerHTML = departments.map((item) => `
    <label class="multi-select-option">
      <input
        type="checkbox"
        value="${escapeHtml(item.id)}"
        ${state.selectedSupportIds.has(item.id) ? "checked" : ""}
      >
      <span>${escapeHtml(item.name || item.code || item.id)}</span>
    </label>
  `).join("");
}

function renderSelectedSupportChips() {
  const selectedIds = Array.from(state.selectedSupportIds)
    .filter((id) => availableSupportDepartments().some((item) => item.id === id));

  state.selectedSupportIds = new Set(selectedIds);

  if (selectedIds.length === 0) {
    supportSummary.textContent = "Chọn phòng, khu phối hợp";
    supportSelectedChips.innerHTML = "";
    return;
  }

  supportSummary.textContent = `Đã chọn ${selectedIds.length} phòng/khu`;

  supportSelectedChips.innerHTML = selectedIds.map((id) => `
    <span class="selected-chip">
      ${escapeHtml(departmentName(id))}
      <button type="button" data-remove-support-id="${escapeHtml(id)}" aria-label="Bỏ ${escapeHtml(departmentName(id))}">×</button>
    </span>
  `).join("");
}

function syncSupportDepartmentUI() {
  renderSupportOptions();
  renderSelectedSupportChips();
}

function toggleSupportDropdown(forceOpen = null) {
  const isOpen = !supportDropdownPanel.classList.contains("hidden");
  const shouldOpen = forceOpen === null ? !isOpen : Boolean(forceOpen);

  supportDropdownPanel.classList.toggle("hidden", !shouldOpen);
  supportDropdownButton.setAttribute("aria-expanded", String(shouldOpen));

  if (shouldOpen) {
    supportSearchInput.focus();
  }
}

function setDefaultDates() {
  const now = new Date();
  const sevenDaysLater = new Date(now);
  sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);

  assignedAt.value = toLocalDateTimeInput(now);
  deadline.min = toDateInput(now);
  deadline.value = toDateInput(sevenDaysLater);
}

async function openTaskModal() {
  hideMessage(taskMessage);
  taskForm.reset();
  state.selectedSupportIds = new Set();
  supportSearchInput.value = "";

  taskModal.classList.remove("hidden");
  setBodyModalState();

  try {
    await loadReferenceData();
    fillDepartmentFilter();
    fillAssignedByOptions();
    fillPrimaryDepartmentOptions();
    fillOwnerOptions();
    syncSupportDepartmentUI();
    setDefaultDates();
    toggleSupportDropdown(false);
    taskTitle.focus();
  } catch (error) {
    console.error("Không tải được biểu mẫu:", error);
    showMessage(
      taskMessage,
      error?.message || "Không tải được danh mục phòng ban và người dùng.",
      "error"
    );
  }
}

function closeTaskModal() {
  if (state.savingTask) {
    return;
  }

  toggleSupportDropdown(false);
  taskModal.classList.add("hidden");
  setBodyModalState();
}

async function createTaskLog(taskReference, taskCode, title) {
  try {
    await addDoc(collection(db, "taskLogs"), {
      taskId: taskReference.id,
      taskCode,
      action: "CREATE_TASK",
      description: `Tạo nhiệm vụ: ${title}`,
      oldValue: null,
      newValue: "MOI_TIEP_NHAN",
      performedByUserId: state.user.uid,
      performedByName: state.profile.fullName,
      performedAt: serverTimestamp()
    });

    return true;
  } catch (error) {
    console.error("Không ghi được nhật ký nhiệm vụ:", error);
    return false;
  }
}

async function saveTask(event) {
  event.preventDefault();

  if (state.savingTask) {
    return;
  }

  hideMessage(taskMessage);

  try {
    const title = cleanText(taskTitle.value);
    const description = cleanText(taskDescription.value);
    const selectedSource = sourceType.value;
    const sourceInformation = cleanText(sourceDetail.value);
    const assignedBy = userById(assignedByUserId.value);
    const primaryId = primaryDepartmentId.value;
    const owner = userById(ownerUserId.value);
    const assignedDate = new Date(assignedAt.value);
    const deadlineDate = parseDateInput(deadline.value, true);
    const supportIds = Array.from(state.selectedSupportIds)
      .filter((id) => id !== primaryId && id !== "BGD");

    if (!title) {
      throw new Error("Vui lòng nhập tiêu đề nhiệm vụ.");
    }

    if (!description) {
      throw new Error("Vui lòng nhập nội dung chi tiết.");
    }

    if (!selectedSource) {
      throw new Error("Vui lòng chọn nguồn nhiệm vụ.");
    }

    if (!sourceInformation) {
      throw new Error("Vui lòng nhập chi tiết nguồn nhiệm vụ.");
    }

    if (!assignedBy) {
      throw new Error("Vui lòng chọn người giao/chỉ đạo.");
    }

    if (!primaryId) {
      throw new Error("Vui lòng chọn phòng xử lý chính.");
    }

    if (!owner) {
      throw new Error("Vui lòng chọn lãnh đạo chịu trách nhiệm.");
    }

    if (Number.isNaN(assignedDate.getTime())) {
      throw new Error("Ngày giao nhiệm vụ không hợp lệ.");
    }

    if (!deadlineDate) {
      throw new Error("Hạn hoàn thành không hợp lệ.");
    }

    if (deadlineDate.getTime() < assignedDate.getTime()) {
      throw new Error("Hạn hoàn thành không được trước ngày giao nhiệm vụ.");
    }

    state.savingTask = true;
    saveTaskButton.disabled = true;
    saveTaskButton.textContent = "Đang lưu...";
    showMessage(taskMessage, "Đang lưu nhiệm vụ vào hệ thống...", "info");

    const taskCode = createTaskCode();
    const visibleDepartmentIds = Array.from(new Set([primaryId, ...supportIds]));

    const taskPayload = {
      taskCode,
      title,
      description,
      sourceType: selectedSource,
      sourceDetail: sourceInformation,
      assignedByUserId: assignedBy.id,
      assignedByName: assignedBy.fullName || "",
      primaryDepartmentId: primaryId,
      supportDepartmentIds: supportIds,
      visibleDepartmentIds,
      ownerUserId: owner.id,
      ownerName: owner.fullName || "",
      createdByUserId: state.user.uid,
      createdByName: state.profile.fullName || "",
      assignedAt: Timestamp.fromDate(assignedDate),
      assignedDateKey: dateKey(assignedDate),
      assignedMonthKey: monthKey(assignedDate),
      assignedWeekKey: isoWeekKey(assignedDate),
      deadline: Timestamp.fromDate(deadlineDate),
      deadlineDateKey: dateKey(deadlineDate),
      priority: priority.value,
      status: "MOI_TIEP_NHAN",
      progress: 0,
      result: "",
      evidenceLink: "",
      completedAt: null,
      directorEvaluation: "",
      kpiScore: null,
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedByUserId: state.user.uid,
      updatedByName: state.profile.fullName || ""
    };

    const taskReference = await addDoc(collection(db, "tasks"), taskPayload);
    const logCreated = await createTaskLog(taskReference, taskCode, title);

    showMessage(
      taskMessage,
      logCreated
        ? `✅ Đã tạo nhiệm vụ ${taskCode}.`
        : `✅ Đã tạo nhiệm vụ ${taskCode}, nhưng chưa ghi được nhật ký.`,
      logCreated ? "success" : "warning"
    );

    await loadTasks();

    window.setTimeout(() => {
      closeTaskModal();
    }, 800);
  } catch (error) {
    console.error("Không tạo được nhiệm vụ:", error);

    const message = error?.code === "permission-denied"
      ? "Tài khoản không có quyền tạo nhiệm vụ với thông tin đã chọn. Hãy kiểm tra Firestore Rules."
      : (error?.message || "Không tạo được nhiệm vụ.");

    showMessage(taskMessage, message, "error");
  } finally {
    state.savingTask = false;
    saveTaskButton.disabled = false;
    saveTaskButton.textContent = "Lưu nhiệm vụ";
  }
}

/* =========================================================
 * KHỞI TẠO VÀ ĐĂNG NHẬP
 * ========================================================= */

async function initializeUser(user) {
  if (state.initializedUid === user.uid) {
    return;
  }

  state.initializedUid = user.uid;
  showView("loading");

  try {
    state.user = user;
    state.profile = await loadProfile(user);
    await loadReferenceData();
    renderAccount();
    showView("app");
    await loadTasks();
  } catch (error) {
    console.error("Không khởi tạo được người dùng:", error);

    state.initializedUid = null;

    try {
      await signOut(auth);
    } catch (signOutError) {
      console.error("Không thể đăng xuất:", signOutError);
    }

    showView("login");
    showMessage(
      loginMessage,
      error?.message || "Không khởi tạo được tài khoản.",
      "error"
    );
  }
}

/* =========================================================
 * SỰ KIỆN
 * ========================================================= */

googleLoginButton.addEventListener("click", async () => {
  hideMessage(loginMessage);

  googleLoginButton.disabled = true;
  googleLoginButton.innerHTML = "<span class=\"google-mark\">G</span><span>Đang mở Google...</span>";

  try {
    await signInWithPopup(auth, googleProvider);
  } catch (error) {
    console.error("Không đăng nhập được bằng Google:", error);

    let message = "Không đăng nhập được bằng Google. Vui lòng thử lại.";

    if (error?.code === "auth/popup-closed-by-user") {
      message = "Bạn đã đóng cửa sổ đăng nhập Google trước khi hoàn tất.";
    } else if (error?.code === "auth/popup-blocked") {
      message = "Trình duyệt đang chặn cửa sổ đăng nhập Google. Hãy cho phép cửa sổ bật lên rồi thử lại.";
    } else if (error?.code === "auth/account-exists-with-different-credential") {
      message = "Email này đang dùng phương thức Email/Mật khẩu. Hãy đăng nhập bằng mật khẩu hiện tại; không tạo thêm tài khoản trùng email.";
    } else if (error?.code === "auth/unauthorized-domain") {
      message = "Tên miền GitHub Pages chưa được thêm vào Authorized domains của Firebase Authentication.";
    }

    showMessage(loginMessage, message, "error");
  } finally {
    googleLoginButton.disabled = false;
    googleLoginButton.innerHTML = "<span class=\"google-mark\">G</span><span>Đăng nhập bằng Google</span>";
  }
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideMessage(loginMessage);

  const email = cleanText(loginEmail.value).toLowerCase();
  const passwordValue = loginPassword.value;

  if (!email) {
    showMessage(loginMessage, "Vui lòng nhập email.", "error");
    loginEmail.focus();
    return;
  }

  if (!passwordValue) {
    showMessage(loginMessage, "Vui lòng nhập mật khẩu.", "error");
    loginPassword.focus();
    return;
  }

  loginButton.disabled = true;
  loginButton.textContent = "Đang đăng nhập...";

  try {
    await signInWithEmailAndPassword(auth, email, passwordValue);
  } catch (error) {
    const message = [
      "auth/invalid-credential",
      "auth/user-not-found",
      "auth/wrong-password"
    ].includes(error?.code)
      ? "Email hoặc mật khẩu không chính xác."
      : (
        error?.code === "auth/too-many-requests"
          ? "Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau."
          : "Không đăng nhập được. Vui lòng kiểm tra lại thông tin."
      );

    showMessage(loginMessage, message, "error");
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = "Đăng nhập";
  }
});

togglePasswordButton.addEventListener("click", () => {
  const isHidden = loginPassword.type === "password";
  loginPassword.type = isHidden ? "text" : "password";
  togglePasswordButton.textContent = isHidden ? "🙈" : "👁";
  togglePasswordButton.setAttribute(
    "aria-label",
    isHidden ? "Ẩn mật khẩu" : "Hiện mật khẩu"
  );
  loginPassword.focus();
});

logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;

  try {
    await signOut(auth);
    state.initializedUid = null;
  } catch (error) {
    console.error("Không đăng xuất được:", error);
    alert("Không đăng xuất được. Vui lòng thử lại.");
  } finally {
    logoutButton.disabled = false;
  }
});

portalButton.addEventListener("click", () => {
  window.location.href = PORTAL_URL;
});

refreshButton.addEventListener("click", loadTasks);
addTaskButton.addEventListener("click", openTaskModal);
closeModalButton.addEventListener("click", closeTaskModal);
cancelTaskButton.addEventListener("click", closeTaskModal);
closeDetailButton.addEventListener("click", closeTaskDetail);

filterToggleButton.addEventListener("click", () => {
  const isOpen = filterFields.classList.toggle("open");
  filterToggleButton.setAttribute("aria-expanded", String(isOpen));
  filterToggleButton.textContent = isOpen ? "✕ Đóng lọc" : "🔎 Bộ lọc";
});

searchInput.addEventListener("input", applyFilters);
statusFilter.addEventListener("change", applyFilters);
deadlineFilter.addEventListener("change", applyFilters);
departmentFilter.addEventListener("change", applyFilters);

primaryDepartmentId.addEventListener("change", () => {
  state.selectedSupportIds.delete(primaryDepartmentId.value);
  fillOwnerOptions();
  syncSupportDepartmentUI();
});

taskForm.addEventListener("submit", saveTask);

supportDropdownButton.addEventListener("click", () => {
  toggleSupportDropdown();
});

supportSearchInput.addEventListener("input", renderSupportOptions);

supportOptions.addEventListener("change", (event) => {
  const input = event.target.closest('input[type="checkbox"]');

  if (!input) {
    return;
  }

  if (input.checked) {
    state.selectedSupportIds.add(input.value);
  } else {
    state.selectedSupportIds.delete(input.value);
  }

  renderSelectedSupportChips();
});

supportSelectedChips.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-remove-support-id]");

  if (!button) {
    return;
  }

  state.selectedSupportIds.delete(button.dataset.removeSupportId);
  syncSupportDepartmentUI();
});

document.addEventListener("click", (event) => {
  if (!supportDropdown.contains(event.target)) {
    toggleSupportDropdown(false);
  }
});

function handleTaskOpenEvent(event) {
  const taskElement = event.target.closest("[data-task-id]");

  if (!taskElement) {
    return;
  }

  openTaskDetail(taskElement.dataset.taskId);
}

taskTableBody.addEventListener("click", handleTaskOpenEvent);
taskCardList.addEventListener("click", handleTaskOpenEvent);

taskTableBody.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    handleTaskOpenEvent(event);
  }
});

taskCardList.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    handleTaskOpenEvent(event);
  }
});

taskModal.addEventListener("click", (event) => {
  if (event.target === taskModal) {
    closeTaskModal();
  }
});

detailModal.addEventListener("click", (event) => {
  if (event.target === detailModal) {
    closeTaskDetail();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") {
    return;
  }

  if (!supportDropdownPanel.classList.contains("hidden")) {
    toggleSupportDropdown(false);
    return;
  }

  if (!detailModal.classList.contains("hidden")) {
    closeTaskDetail();
    return;
  }

  if (!taskModal.classList.contains("hidden")) {
    closeTaskModal();
  }
});

onAuthStateChanged(auth, (user) => {
  if (!user) {
    state.user = null;
    state.profile = null;
    state.initializedUid = null;
    state.tasks = [];
    showView("login");
    return;
  }

  initializeUser(user);
});
