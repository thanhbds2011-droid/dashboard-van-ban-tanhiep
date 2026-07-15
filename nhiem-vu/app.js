import {
  auth,
  db
} from "./firebase-config.js?v=20260715.912";

import {
  NOTIFICATION_WEB_APP_URL
} from "./notification-config.js?v=20260715.912";

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
  Timestamp,
  updateDoc
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";


const PORTAL_URL = "../index.html";

const state = {
  user: null,
  profile: null,
  departments: [],
  users: [],
  tasks: [],
  filteredTasks: [],
  loadingTasks: false,
  savingTask: false,
  savingProgress: false,
  initializedUid: null,
  selectedSupportIds: new Set(),
  selectedTaskId: null
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
const exportReportButton = $("exportReportButton");
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

const taskModalTitle = $("taskModalTitle");
const taskModalSubtitle = $("taskModalSubtitle");
const entryMode = $("entryMode");
const entryModeBanner = $("entryModeBanner");

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
const detailFooter = $("detailFooter");
const updateTaskButton = $("updateTaskButton");

const progressModal = $("progressModal");
const progressForm = $("progressForm");
const progressModalTitle = $("progressModalTitle");
const progressTaskCode = $("progressTaskCode");
const progressTaskSummary = $("progressTaskSummary");
const closeProgressButton = $("closeProgressButton");
const cancelProgressButton = $("cancelProgressButton");
const saveProgressButton = $("saveProgressButton");
const progressMessage = $("progressMessage");
const progressStatus = $("progressStatus");
const progressPercent = $("progressPercent");
const completionSection = $("completionSection");
const completedDate = $("completedDate");
const completionTimingPreview = $("completionTimingPreview");
const completionProductType = $("completionProductType");
const resultSummary = $("resultSummary");
const evidenceLinkWrap = $("evidenceLinkWrap");
const evidenceLinkInput = $("evidenceLinkInput");
const evidenceTextWrap = $("evidenceTextWrap");
const evidenceTextInput = $("evidenceTextInput");

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
    !detailModal.classList.contains("hidden") ||
    !progressModal.classList.contains("hidden");

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

function withTimeout(promise, timeoutMs, fallbackValue = null) {
  return Promise.race([
    Promise.resolve(promise),
    new Promise((resolve) => {
      window.setTimeout(() => resolve(fallbackValue), timeoutMs);
    })
  ]);
}

function isValidHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function resetSessionState() {
  state.user = null;
  state.profile = null;
  state.tasks = [];
  state.filteredTasks = [];
  state.departments = [];
  state.users = [];
  state.initializedUid = null;
  state.selectedTaskId = null;
  state.selectedSupportIds = new Set();

  /* Đóng giao diện theo cách an toàn khi phiên đã kết thúc. */
  taskModal?.classList.add("hidden");
  detailModal?.classList.add("hidden");
  progressModal?.classList.add("hidden");
  document.body.classList.remove("modal-open");

  loginForm.reset();
  hideMessage(loginMessage);
  showView("login");
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

function calendarDayDifference(laterDate, earlierDate) {
  const later = startOfDay(laterDate).getTime();
  const earlier = startOfDay(earlierDate).getTime();
  return Math.round((later - earlier) / 86400000);
}

function completionTimingInfo(task, completedValue = task?.completedAt) {
  const completed = toDate(completedValue);
  const due = toDate(task?.deadline);

  if (!completed || !due) {
    return {
      code: "UNKNOWN",
      days: null,
      text: "Chưa xác định thời điểm hoàn thành",
      className: ""
    };
  }

  const difference = calendarDayDifference(completed, due);

  if (difference < 0) {
    return {
      code: "EARLY",
      days: difference,
      text: `Hoàn thành trước hạn ${Math.abs(difference)} ngày`,
      className: "completion-early"
    };
  }

  if (difference === 0) {
    return {
      code: "ON_TIME",
      days: 0,
      text: "Hoàn thành đúng hạn",
      className: "completion-on-time"
    };
  }

  return {
    code: "LATE",
    days: difference,
    text: `Hoàn thành trễ ${difference} ngày`,
    className: "completion-late"
  };
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
    MOI_TIEP_NHAN: "Mới ghi nhận",
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
    HOP_GIAO_BAN: "Cuộc họp giao ban",
    HOP_CHUYEN_DE: "Cuộc họp chuyên đề",
    CHI_DAO_TRUC_TIEP: "Chỉ đạo trực tiếp",
    DOT_XUAT: "Nhiệm vụ đột xuất",
    THUONG_XUYEN: "Nhiệm vụ thường xuyên",
    KE_HOACH_CONG_TAC: "Kế hoạch công tác",
    DINH_KY: "Nhiệm vụ định kỳ",
    KHAC: "Khác"
  };

  return map[value] || value || "Chưa xác định";
}

function entryModeName(value) {
  const map = {
    SELF_RECORDED: "Tự ghi nhận",
    DIRECT_ASSIGNED: "BGĐ giao trực tiếp"
  };

  return map[value] || "Nhiệm vụ cũ";
}

function outputTypeName(value) {
  const map = {
    BAO_CAO: "Báo cáo",
    KE_HOACH: "Kế hoạch",
    CONG_VAN: "Công văn",
    QUYET_DINH: "Quyết định",
    THONG_BAO: "Thông báo",
    TO_TRINH: "Tờ trình",
    QUY_CHE: "Quy chế",
    BIEN_BAN: "Biên bản",
    DANH_SACH: "Danh sách",
    BANG_TONG_HOP: "Bảng tổng hợp",
    PHUONG_AN: "Phương án",
    QUY_TRINH: "Quy trình",
    HO_SO: "Hồ sơ",
    DU_LIEU_CAP_NHAT: "Dữ liệu đã cập nhật",
    KET_QUA_KIEM_TRA: "Kết quả kiểm tra",
    KET_QUA_THUC_TE: "Kết quả thực tế",
    KHAC: "Sản phẩm khác"
  };

  return map[value] || value || "Chưa xác định";
}

function evidenceTypeName(value) {
  const map = {
    NONE: "Không có minh chứng",
    LINK: "Đường dẫn liên kết",
    PDF: "Tệp PDF",
    IMAGE: "Hình ảnh",
    TEXT: "Nội dung nhập tay",
    OTHER: "Sản phẩm khác"
  };

  return map[value] || value || "Chưa ghi nhận";
}

function userDisplayName(uid) {
  const user = userById(uid);

  if (!user) {
    return uid || "Chưa xác định";
  }

  return [
    user.fullName,
    user.position,
    departmentName(user.departmentId)
  ].filter(Boolean).join(" — ");
}

function currentEntryMode() {
  if (state.profile?.role === "DEPARTMENT_LEADER") {
    return "SELF_RECORDED";
  }

  return "DIRECT_ASSIGNED";
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
    const completion = completionTimingInfo(task);

    return {
      code: completion.code === "LATE" ? "COMPLETED_LATE" : "COMPLETED",
      text: completion.text,
      className: completion.className || "green"
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

/* =========================================================
 * PHẠM VI THEO DÕI VÀ TỔNG HỢP
 * ========================================================= */

function isTchcCoordinationAccount() {
  return (
    state.profile?.departmentId === "TCHC"
    && ["ADMIN", "DEPARTMENT_LEADER"].includes(state.profile?.role)
  );
}

function canViewAllTasks() {
  return (
    ["ADMIN", "DIRECTOR"].includes(state.profile?.role)
    || isTchcCoordinationAccount()
  );
}

function canExportTaskReport() {
  return canViewAllTasks();
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

    if (canViewAllTasks()) {
      /* Ban Giám đốc, ADMIN và đầu mối TCHC xem toàn bộ nhiệm vụ. */
      state.tasks = allTasks;
    } else if (state.profile.role === "DEPARTMENT_LEADER") {
      const departmentId = state.profile.departmentId;
      const currentUid = state.user.uid;

      state.tasks = allTasks.filter((task) => {
        const relatedUserIds = Array.isArray(task.relatedUserIds)
          ? task.relatedUserIds
          : [];

        /*
         * Dữ liệu mới được hiển thị theo đúng cá nhân:
         * - người chịu trách nhiệm;
         * - người có liên quan;
         * - người đã tự ghi nhận.
         */
        if (
          task.entryMode ||
          Array.isArray(task.relatedUserIds)
        ) {
          return (
            task.ownerUserId === currentUid ||
            task.createdByUserId === currentUid ||
            relatedUserIds.includes(currentUid)
          );
        }

        /*
         * Tương thích nhiệm vụ cũ chưa có entryMode/relatedUserIds.
         */
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

  const canCreateTask = [
    "ADMIN",
    "DIRECTOR",
    "DEPARTMENT_LEADER"
  ].includes(state.profile.role);

  addTaskButton.classList.toggle("hidden", !canCreateTask);

  if (state.profile.role === "DEPARTMENT_LEADER") {
    addTaskButton.textContent = "➕ Ghi nhận nhiệm vụ";
  } else if (state.profile.role === "DIRECTOR") {
    addTaskButton.textContent = "⚡ Giao nhiệm vụ trực tiếp";
  } else {
    addTaskButton.textContent = "⚡ Tạo nhiệm vụ trực tiếp";
  }

  const hasOverviewAccess = canViewAllTasks();
  departmentFilterWrap.classList.toggle("hidden", !hasOverviewAccess);
  exportReportButton?.classList.toggle("hidden", !canExportTaskReport());

  if (isTchcCoordinationAccount()) {
    welcomeDepartment.textContent = [
      departmentName(state.profile.departmentId),
      state.profile.position,
      "Đầu mối theo dõi, tổng hợp nhiệm vụ toàn Trung tâm"
    ].filter(Boolean).join(" • ");
  }

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
      task.resultSummary,
      task.evidenceText,
      task.outputDescription,
      task.sourceDetail,
      ...(Array.isArray(task.relatedUserNames) ? task.relatedUserNames : []),
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

  state.filteredTasks = filteredTasks;
  renderTasks(filteredTasks);
}

/* =========================================================
 * XUẤT BÁO CÁO NHIỆM VỤ
 * ========================================================= */

function csvValue(value) {
  const normalized = String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/"/g, '""');

  return `"${normalized}"`;
}

function exportTaskReport() {
  if (!canExportTaskReport()) {
    showMessage(dashboardMessage, "Tài khoản không có quyền xuất báo cáo tổng hợp.", "error");
    return;
  }

  const tasksToExport = Array.isArray(state.filteredTasks)
    ? state.filteredTasks
    : [];

  if (tasksToExport.length === 0) {
    showMessage(dashboardMessage, "Không có nhiệm vụ trong bộ lọc hiện tại để xuất báo cáo.", "warning");
    return;
  }

  const headers = [
    "STT", "Mã nhiệm vụ", "Hình thức ghi nhận", "Nguồn nhiệm vụ",
    "Ngày được chỉ đạo", "Người giao/chỉ đạo", "Tên nhiệm vụ",
    "Nội dung thực hiện", "Phòng/Khu", "Người chịu trách nhiệm",
    "Người có liên quan", "Mức độ", "Hạn hoàn thành", "Trạng thái",
    "Tiến độ (%)", "Tình trạng thời hạn", "Ngày hoàn thành thực tế",
    "Kết quả thực hiện", "Loại minh chứng", "Đường dẫn minh chứng",
    "Nội dung minh chứng", "Cập nhật gần nhất"
  ];

  const rows = tasksToExport.map((task, index) => {
    const due = deadlineState(task);
    const timingText = task.status === "HOAN_THANH"
      ? completionTimingInfo(task).text
      : due.text;

    return [
      index + 1,
      task.taskCode || "",
      entryModeName(task.entryMode),
      sourceName(task.sourceType),
      formatDate(task.assignedAt || task.sourceDate),
      task.assignedByName || "",
      task.title || "",
      task.description || "",
      departmentName(task.primaryDepartmentId),
      task.ownerName || "",
      Array.isArray(task.relatedUserNames) ? task.relatedUserNames.join(", ") : "",
      priorityName(task.priority),
      formatDate(task.deadline),
      statusName(task.status),
      Number(task.progress) || 0,
      timingText,
      task.completedAt ? formatDate(task.completedAt) : "",
      task.resultSummary || task.result || "",
      evidenceTypeName(task.evidenceType),
      task.evidenceUrl || task.evidenceLink || "",
      task.evidenceText || "",
      formatDateTime(task.updatedAt || task.createdAt)
    ];
  });

  const csvContent = [headers, ...rows]
    .map((row) => row.map(csvValue).join(";"))
    .join("\r\n");

  const blob = new Blob(["\uFEFF", csvContent], {
    type: "text/csv;charset=utf-8;"
  });

  const now = new Date();
  const fileName = [
    "bao-cao-nhiem-vu",
    dateKey(now),
    `${pad2(now.getHours())}${pad2(now.getMinutes())}`
  ].join("_") + ".csv";

  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(downloadUrl);

  showMessage(
    dashboardMessage,
    `✅ Đã xuất ${tasksToExport.length} nhiệm vụ theo bộ lọc hiện tại. File CSV mở trực tiếp bằng Excel.`,
    "success"
  );
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
          <span class="task-entry-line">
            <span class="badge ${task.entryMode === "DIRECT_ASSIGNED" ? "orange" : "blue"}">
              ${escapeHtml(entryModeName(task.entryMode))}
            </span>
            ${escapeHtml(truncate(task.description, 105))}
          </span>
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
            <span class="badge ${task.entryMode === "DIRECT_ASSIGNED" ? "orange" : "blue"}">
              ${escapeHtml(entryModeName(task.entryMode))}
            </span>
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

function canUpdateTask(task) {
  if (!task || !state.user || !state.profile) {
    return false;
  }

  if (state.profile.role === "ADMIN") {
    return true;
  }

  if (
    state.profile.role === "DEPARTMENT_LEADER" &&
    task.ownerUserId === state.user.uid
  ) {
    return true;
  }

  return (
    state.profile.role === "DIRECTOR" &&
    task.entryMode === "DIRECT_ASSIGNED" &&
    task.assignedByUserId === state.user.uid
  );
}

function resultEvidenceHtml(task) {
  const evidenceType = task.evidenceType || task.outputType || "";
  const evidenceUrl = task.evidenceUrl || task.evidenceLink || "";
  const evidenceText = task.evidenceText || task.outputDescription || "";
  const fileName = task.evidenceFileName || "Mở tệp minh chứng";

  let evidenceContent = "Chưa ghi nhận";

  if (evidenceUrl && isValidHttpUrl(evidenceUrl)) {
    evidenceContent = `
      <a href="${escapeHtml(evidenceUrl)}" target="_blank" rel="noopener noreferrer">
        ${escapeHtml(fileName || "Mở minh chứng")}
      </a>
    `;
  } else if (evidenceText) {
    evidenceContent = escapeHtml(evidenceText);
  }

  return `
    <div class="result-card">
      <h4>✅ Kết quả và sản phẩm minh chứng</h4>
      <div class="result-card-grid">
        <div class="result-card-item">
          <span>Ngày hoàn thành thực tế</span>
          <strong>${escapeHtml(formatDate(task.completedAt))}</strong>
        </div>
        <div class="result-card-item">
          <span>Đánh giá thời hạn</span>
          <strong>${escapeHtml(completionTimingInfo(task).text)}</strong>
        </div>
        <div class="result-card-item">
          <span>Loại sản phẩm/minh chứng</span>
          <strong>${escapeHtml(evidenceTypeName(evidenceType))}</strong>
        </div>
        <div class="result-card-item result-span-2">
          <span>Mô tả kết quả/sản phẩm</span>
          <strong>${escapeHtml(task.resultSummary || task.result || "Chưa ghi nhận")}</strong>
        </div>
        <div class="result-card-item result-span-2">
          <span>Minh chứng</span>
          <strong>${evidenceContent}</strong>
        </div>
      </div>
    </div>
  `;
}

function openTaskDetail(taskId) {
  const task = findTaskById(taskId);

  if (!task) {
    return;
  }

  state.selectedTaskId = taskId;

  const due = deadlineState(task);

  const relatedNames = Array.isArray(task.relatedUserNames)
    ? task.relatedUserNames
    : (
      Array.isArray(task.relatedUserIds)
        ? task.relatedUserIds.map(userDisplayName)
        : []
    );

  const legacySupportNames = Array.isArray(task.supportDepartmentIds)
    ? task.supportDepartmentIds.map(departmentName)
    : [];

  const peopleRelatedText = relatedNames.length > 0
    ? relatedNames.join(", ")
    : (
      legacySupportNames.length > 0
        ? legacySupportNames.join(", ")
        : "Không có"
    );

  const progressText = Number.isFinite(Number(task.progress))
    ? `${Number(task.progress)}%`
    : "Chưa cập nhật";

  const legacyOutputHtml = (
    task.status !== "HOAN_THANH" &&
    (task.outputType || task.outputDescription)
  )
    ? `
      <div class="detail-item">
        <span>Sản phẩm dự kiến (dữ liệu cũ)</span>
        <strong>${escapeHtml(outputTypeName(task.outputType))}</strong>
      </div>
      <div class="detail-item detail-span-2">
        <span>Mô tả sản phẩm dự kiến</span>
        <strong>${escapeHtml(task.outputDescription || "Chưa ghi nhận")}</strong>
      </div>
    `
    : "";

  detailTaskCode.textContent = task.taskCode || "Chưa có mã";

  detailContent.innerHTML = `
    <h3 class="detail-title">${escapeHtml(task.title || "Nhiệm vụ chưa có tiêu đề")}</h3>
    <p class="detail-description">${escapeHtml(task.description || "Chưa có nội dung chi tiết")}</p>

    <div class="detail-badges">
      <span class="badge ${task.entryMode === "DIRECT_ASSIGNED" ? "orange" : "blue"}">
        ${escapeHtml(entryModeName(task.entryMode))}
      </span>
      <span class="badge ${statusBadgeClass(task.status)}">${escapeHtml(statusName(task.status))}</span>
      <span class="badge ${priorityBadgeClass(task.priority)}">${escapeHtml(priorityName(task.priority))}</span>
      <span class="badge ${due.className}">${escapeHtml(due.text)}</span>
    </div>

    <div class="detail-grid">
      <div class="detail-item">
        <span>Người chịu trách nhiệm chính</span>
        <strong>${escapeHtml(task.ownerName || "Chưa xác định")}</strong>
      </div>
      <div class="detail-item">
        <span>Phòng/Khu</span>
        <strong>${escapeHtml(departmentName(task.primaryDepartmentId))}</strong>
      </div>
      <div class="detail-item detail-span-2">
        <span>Trưởng/Phó có liên quan</span>
        <strong>${escapeHtml(peopleRelatedText)}</strong>
      </div>
      <div class="detail-item">
        <span>Người giao/chỉ đạo</span>
        <strong>${escapeHtml(task.assignedByName || "Chưa xác định")}</strong>
      </div>
      <div class="detail-item">
        <span>Nguồn nhiệm vụ</span>
        <strong>${escapeHtml(sourceName(task.sourceType))}</strong>
      </div>
      <div class="detail-item detail-span-2">
        <span>Căn cứ hoặc nội dung liên quan</span>
        <strong>${escapeHtml(task.sourceDetail || task.sourceReference || "Chưa xác định")}</strong>
      </div>
      <div class="detail-item">
        <span>Ngày được chỉ đạo</span>
        <strong>${escapeHtml(formatDate(task.sourceDate || task.assignedAt))}</strong>
      </div>
      <div class="detail-item">
        <span>Hạn hoàn thành</span>
        <strong>${escapeHtml(formatDate(task.deadline))}</strong>
      </div>
      <div class="detail-item">
        <span>Tiến độ hiện tại</span>
        <strong>${escapeHtml(progressText)}</strong>
      </div>
      <div class="detail-item">
        <span>Người nhập nhiệm vụ</span>
        <strong>${escapeHtml(task.createdByName || "Chưa xác định")}</strong>
      </div>
      ${legacyOutputHtml}
    </div>

    ${task.status === "HOAN_THANH" ? resultEvidenceHtml(task) : ""}
  `;

  const allowUpdate = canUpdateTask(task);
  detailFooter.classList.toggle("hidden", !allowUpdate);
  updateTaskButton.textContent = task.status === "HOAN_THANH"
    ? "✏️ Chỉnh sửa kết quả hoàn thành"
    : "✏️ Cập nhật / Kết thúc nhiệm vụ";

  detailModal.classList.remove("hidden");
  setBodyModalState();
}

function closeTaskDetail() {
  detailModal.classList.add("hidden");
  detailContent.innerHTML = "";
  detailFooter.classList.add("hidden");
  setBodyModalState();
}

/* =========================================================
 * BIỂU MẪU THÊM NHIỆM VỤ
 * ========================================================= */

function configureEntryMode() {
  const mode = currentEntryMode();
  entryMode.value = mode;

  const selfRecorded = mode === "SELF_RECORDED";

  taskModalTitle.textContent = selfRecorded
    ? "➕ Ghi nhận nhiệm vụ"
    : "⚡ Giao nhiệm vụ trực tiếp";

  taskModalSubtitle.textContent = selfRecorded
    ? "Ghi nhận nhiệm vụ đã được Ban Giám đốc chỉ đạo tại cuộc họp, văn bản hoặc trực tiếp."
    : "Dùng cho nhiệm vụ đột xuất cần Ban Giám đốc giao trực tiếp trên ứng dụng.";

  entryModeBanner.className = selfRecorded
    ? "entry-mode-banner entry-mode-self"
    : "entry-mode-banner entry-mode-direct";

  entryModeBanner.innerHTML = selfRecorded
    ? `
      <strong>TỰ GHI NHẬN</strong>
      <span>Người đang đăng nhập tự báo cáo nhiệm vụ mình đã được chỉ đạo.</span>
    `
    : `
      <strong>BGĐ GIAO TRỰC TIẾP</strong>
      <span>Nhiệm vụ đột xuất được nhập trực tiếp và gửi thông báo tới người nhận.</span>
    `;

  saveTaskButton.textContent = selfRecorded
    ? "Lưu ghi nhận"
    : "Giao nhiệm vụ";
}

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

  if (
    currentEntryMode() === "DIRECT_ASSIGNED" &&
    state.profile.role === "DIRECTOR"
  ) {
    const currentDirector = directors.find((item) => item.id === state.user.uid);

    assignedByUserId.innerHTML = "";

    const option = document.createElement("option");
    option.value = state.user.uid;
    option.textContent = [
      state.profile.fullName,
      state.profile.position
    ].filter(Boolean).join(" — ");

    assignedByUserId.appendChild(option);
    assignedByUserId.value = state.user.uid;
    assignedByUserId.disabled = true;

    return;
  }

  assignedByUserId.disabled = directors.length === 0;

  if (directors.length === 0) {
    assignedByUserId.innerHTML = '<option value="">Chưa có tài khoản Ban Giám đốc</option>';
  }
}

function fillPrimaryDepartmentOptions() {
  if (currentEntryMode() === "SELF_RECORDED") {
    primaryDepartmentId.innerHTML = "";

    const option = document.createElement("option");
    option.value = state.profile.departmentId;
    option.textContent = departmentName(state.profile.departmentId);
    primaryDepartmentId.appendChild(option);

    primaryDepartmentId.value = state.profile.departmentId;
    primaryDepartmentId.disabled = true;
    primaryHelp.textContent = "Phòng/Khu được cố định theo tài khoản đang đăng nhập.";
    return;
  }

  primaryDepartmentId.disabled = false;
  primaryDepartmentId.innerHTML = '<option value="">Chọn phòng/khu của người nhận</option>';

  state.departments
    .filter((item) => item.id !== "BGD")
    .forEach((item) => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.name || item.code || item.id;
      primaryDepartmentId.appendChild(option);
    });

  primaryHelp.textContent = "Chọn phòng/khu trước, sau đó chọn người chịu trách nhiệm.";
}

function fillOwnerOptions() {
  if (currentEntryMode() === "SELF_RECORDED") {
    ownerUserId.innerHTML = "";

    const option = document.createElement("option");
    option.value = state.user.uid;
    option.textContent = [state.profile.fullName, state.profile.position]
      .filter(Boolean)
      .join(" — ");

    ownerUserId.appendChild(option);
    ownerUserId.value = state.user.uid;
    ownerUserId.disabled = true;
    ownerHelp.textContent = "Người chịu trách nhiệm chính là tài khoản đang đăng nhập.";
    return;
  }

  const departmentId = primaryDepartmentId.value;
  ownerUserId.innerHTML = '<option value="">Chọn Trưởng/Phó chịu trách nhiệm</option>';

  if (!departmentId) {
    ownerUserId.disabled = true;
    ownerHelp.textContent = "Chọn phòng/khu của người nhận trước.";
    return;
  }

  const leaders = state.users
    .filter((item) => (
      item.active === true &&
      item.role === "DEPARTMENT_LEADER" &&
      item.departmentId === departmentId
    ))
    .sort((a, b) => String(a.fullName || "").localeCompare(String(b.fullName || ""), "vi"));

  leaders.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = [item.fullName, item.position].filter(Boolean).join(" — ");
    ownerUserId.appendChild(option);
  });

  ownerUserId.disabled = leaders.length === 0;
  ownerHelp.textContent = leaders.length > 0
    ? "Chọn một Trưởng/Phó chịu trách nhiệm chính."
    : "Phòng/Khu này chưa có tài khoản Trưởng/Phó đang hoạt động.";
}

function availableRelatedUsers() {
  const ownerId = ownerUserId.value;

  return state.users
    .filter((item) => (
      item.active === true &&
      item.role === "DEPARTMENT_LEADER" &&
      item.id !== ownerId
    ))
    .sort((a, b) => String(a.fullName || "").localeCompare(String(b.fullName || ""), "vi"));
}

function renderSupportOptions() {
  const keyword = normalizeText(supportSearchInput.value);

  const users = availableRelatedUsers()
    .filter((item) => normalizeText([
      item.fullName,
      item.position,
      departmentName(item.departmentId)
    ].filter(Boolean).join(" ")).includes(keyword));

  if (users.length === 0) {
    supportOptions.innerHTML = '<div class="multi-select-empty">Không tìm thấy Trưởng/Phó phù hợp.</div>';
    return;
  }

  supportOptions.innerHTML = users.map((item) => `
    <label class="multi-select-option">
      <input
        type="checkbox"
        value="${escapeHtml(item.id)}"
        ${state.selectedSupportIds.has(item.id) ? "checked" : ""}
      >
      <span>
        <strong>${escapeHtml(item.fullName || "Chưa có họ tên")}</strong>
        <small>${escapeHtml([
          item.position,
          departmentName(item.departmentId)
        ].filter(Boolean).join(" • "))}</small>
      </span>
    </label>
  `).join("");
}

function renderSelectedSupportChips() {
  const availableIds = new Set(availableRelatedUsers().map((item) => item.id));

  const selectedIds = Array.from(state.selectedSupportIds)
    .filter((id) => availableIds.has(id));

  state.selectedSupportIds = new Set(selectedIds);

  if (selectedIds.length === 0) {
    supportSummary.textContent = "Chọn người có liên quan";
    supportSelectedChips.innerHTML = "";
    return;
  }

  supportSummary.textContent = `Đã chọn ${selectedIds.length} người`;

  supportSelectedChips.innerHTML = selectedIds.map((id) => {
    const person = userById(id);
    const label = person?.fullName || id;

    return `
      <span class="selected-chip">
        ${escapeHtml(label)}
        <button type="button" data-remove-support-id="${escapeHtml(id)}" aria-label="Bỏ ${escapeHtml(label)}">×</button>
      </span>
    `;
  }).join("");
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

  assignedAt.value = toDateInput(now);
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
    configureEntryMode();
    fillAssignedByOptions();
    fillPrimaryDepartmentOptions();
    fillOwnerOptions();
    syncSupportDepartmentUI();
    setDefaultDates();
    priority.value = "THUONG";
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



/* =========================================================
 * LƯU THIẾT BỊ NHẬN THÔNG BÁO VÀO FIRESTORE
 * =========================================================
 */

function detectDeviceName() {
  const userAgent =
    navigator.userAgent || "";

  if (/iPhone/i.test(userAgent)) {
    return "iPhone";
  }

  if (/iPad/i.test(userAgent)) {
    return "iPad";
  }

  if (/Android/i.test(userAgent)) {
    return "Điện thoại Android";
  }

  if (/Windows/i.test(userAgent)) {
    return "Máy tính Windows";
  }

  if (/Macintosh|Mac OS X/i.test(userAgent)) {
    return "Máy tính Mac";
  }

  return "Trình duyệt Web";
}


async function saveTaskPushSubscription(
  snapshot,
  activeOverride = null
) {
  if (
    !state.user
    || !state.profile
    || !snapshot?.subscriptionId
  ) {
    return false;
  }

  const subscriptionId =
    cleanText(
      snapshot.subscriptionId
    );

  if (!subscriptionId) {
    return false;
  }

  const subscriptionReference =
    doc(
      db,
      "taskPushSubscriptions",
      subscriptionId
    );

  const existingSnapshot =
    await getDoc(
      subscriptionReference
    );

  const active =
    typeof activeOverride === "boolean"
      ? activeOverride
      : (
        snapshot.optedIn === true
        && snapshot.permission === "granted"
      );

  const payload = {
    subscriptionId,
    uid:
      state.user.uid,
    module:
      "TASKS",
    departmentId:
      state.profile.departmentId,
    role:
      state.profile.role,
    active,
    platform:
      "WEB_PUSH",
    deviceName:
      detectDeviceName(),
    notificationPermission:
      snapshot.permission || "default",
    externalId:
      snapshot.externalId
      || state.user.uid,
    oneSignalId:
      snapshot.oneSignalId || "",
    userAgent:
      String(
        navigator.userAgent || ""
      ).slice(0, 500),
    updatedAt:
      serverTimestamp()
  };

  if (!existingSnapshot.exists()) {
    payload.createdAt =
      serverTimestamp();
  }

  await setDoc(
    subscriptionReference,
    payload,
    {
      merge: true
    }
  );

  console.info(
    "Đã đồng bộ taskPushSubscriptions:",
    {
      subscriptionId,
      uid:
        state.user.uid,
      active
    }
  );

  return true;
}


async function syncCurrentPushSubscription(
  activeOverride = null
) {
  try {
    const snapshot =
      await window.TaskPush
        ?.getSubscriptionSnapshot?.();

    if (!snapshot?.subscriptionId) {
      console.info(
        "OneSignal chưa có Subscription ID để đồng bộ."
      );

      return false;
    }

    return await saveTaskPushSubscription(
      snapshot,
      activeOverride
    );

  } catch (error) {
    console.warn(
      "Chưa đồng bộ được thiết bị thông báo:",
      error
    );

    return false;
  }
}


window.addEventListener(
  "taskpush:subscription-change",
  (event) => {
    if (
      !state.user
      || !state.profile
    ) {
      return;
    }

    saveTaskPushSubscription(
      event.detail
    ).catch(
      (error) => {
        console.warn(
          "Không lưu được thay đổi Subscription:",
          error
        );
      }
    );
  }
);


/* =========================================================
 * GỌI GOOGLE APPS SCRIPT GỬI THÔNG BÁO
 * =========================================================
 */

async function sendNotificationEvent(
  action,
  taskId
) {
  if (
    !NOTIFICATION_WEB_APP_URL
    || NOTIFICATION_WEB_APP_URL.includes(
      "DAN_LINK_WEB_APP"
    )
  ) {
    console.warn(
      "Chưa cấu hình URL Google Apps Script gửi thông báo."
    );

    return false;
  }

  if (
    !state.user
    || !taskId
  ) {
    return false;
  }

  try {
    const idToken =
      await state.user.getIdToken();

    /*
     * Dùng text/plain và no-cors để gửi từ GitHub Pages
     * tới Google Apps Script mà không phát sinh lỗi CORS.
     *
     * Phía Apps Script vẫn xác minh Firebase ID Token
     * trước khi gửi thông báo OneSignal.
     */
    await fetch(
      NOTIFICATION_WEB_APP_URL,
      {
        method: "POST",
        mode: "no-cors",
        cache: "no-store",
        keepalive: true,
        headers: {
          "Content-Type":
            "text/plain;charset=UTF-8"
        },
        body: JSON.stringify({
          action,
          taskId,
          idToken,
          sentAt:
            new Date().toISOString()
        })
      }
    );

    return true;

  } catch (error) {
    console.warn(
      "Chưa gửi được yêu cầu thông báo:",
      error
    );

    return false;
  }
}

async function createTaskLog(taskReference, taskCode, title, mode) {
  const selfRecorded = mode === "SELF_RECORDED";

  try {
    await addDoc(collection(db, "taskLogs"), {
      taskId: taskReference.id,
      taskCode,
      action: selfRecorded ? "SELF_RECORD_TASK" : "DIRECT_ASSIGN_TASK",
      description: selfRecorded
        ? `Tự ghi nhận nhiệm vụ: ${title}`
        : `Giao nhiệm vụ trực tiếp: ${title}`,
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
    const mode = currentEntryMode();
    const title = cleanText(taskTitle.value);
    const description = cleanText(taskDescription.value);
    const selectedSource = sourceType.value;
    const sourceInformation = cleanText(sourceDetail.value);
    const assignedBy = userById(assignedByUserId.value);
    const primaryId = primaryDepartmentId.value;
    const owner = userById(ownerUserId.value);
    const assignedDate = parseDateInput(assignedAt.value, false);
    const deadlineDate = parseDateInput(deadline.value, true);

    const relatedUserIds = Array.from(state.selectedSupportIds)
      .filter((uid) => uid !== owner?.id);

    const relatedUsers = relatedUserIds
      .map(userById)
      .filter(Boolean);

    if (!title) {
      throw new Error("Vui lòng nhập tên nhiệm vụ.");
    }

    if (!description) {
      throw new Error("Vui lòng nhập nội dung thực hiện.");
    }

    if (!selectedSource) {
      throw new Error("Vui lòng chọn nguồn nhiệm vụ.");
    }

    if (!sourceInformation) {
      throw new Error("Vui lòng nhập căn cứ hoặc nội dung chỉ đạo liên quan.");
    }

    if (!assignedBy) {
      throw new Error("Vui lòng chọn người giao/chỉ đạo.");
    }

    if (!primaryId) {
      throw new Error("Vui lòng xác định Phòng/Khu của người chịu trách nhiệm.");
    }

    if (!owner) {
      throw new Error("Vui lòng chọn người chịu trách nhiệm chính.");
    }

    if (
      mode === "SELF_RECORDED" &&
      owner.id !== state.user.uid
    ) {
      throw new Error("Nhiệm vụ tự ghi nhận phải thuộc tài khoản đang đăng nhập.");
    }

    if (
      mode === "SELF_RECORDED" &&
      primaryId !== state.profile.departmentId
    ) {
      throw new Error("Phòng/Khu của nhiệm vụ tự ghi nhận không hợp lệ.");
    }

    if (
      mode === "DIRECT_ASSIGNED" &&
      owner.role !== "DEPARTMENT_LEADER"
    ) {
      throw new Error("Người nhận nhiệm vụ trực tiếp phải là Trưởng/Phó phòng, khu.");
    }

    if (!assignedDate) {
      throw new Error("Ngày được chỉ đạo không hợp lệ.");
    }

    if (!deadlineDate) {
      throw new Error("Hạn hoàn thành không hợp lệ.");
    }

    if (deadlineDate.getTime() < assignedDate.getTime()) {
      throw new Error("Hạn hoàn thành không được trước ngày được chỉ đạo.");
    }

    state.savingTask = true;
    saveTaskButton.disabled = true;
    saveTaskButton.textContent = "Đang lưu...";
    showMessage(
      taskMessage,
      mode === "SELF_RECORDED"
        ? "Đang lưu nội dung ghi nhận..."
        : "Đang giao nhiệm vụ trực tiếp...",
      "info"
    );

    const taskCode = createTaskCode();

    const relatedUserNames = relatedUsers.map((item) => (
      [item.fullName, item.position].filter(Boolean).join(" — ")
    ));

    const supportDepartmentIds = Array.from(new Set(
      relatedUsers
        .map((item) => item.departmentId)
        .filter((id) => id && id !== "BGD" && id !== primaryId)
    ));

    const visibleDepartmentIds = Array.from(new Set([
      primaryId,
      ...supportDepartmentIds
    ]));

    const visibleUserIds = Array.from(new Set([
      owner.id,
      state.user.uid,
      assignedBy.id,
      ...relatedUserIds
    ]));

    const taskPayload = {
      taskCode,
      entryMode: mode,

      title,
      description,

      sourceType: selectedSource,
      sourceDetail: sourceInformation,
      sourceReference: sourceInformation,
      sourceDate: Timestamp.fromDate(assignedDate),
      sourceDateKey: dateKey(assignedDate),

      assignedByUserId: assignedBy.id,
      assignedByName: assignedBy.fullName || "",
      assignedByPosition: assignedBy.position || "",

      primaryDepartmentId: primaryId,
      ownerUserId: owner.id,
      ownerName: owner.fullName || "",
      ownerPosition: owner.position || "",

      relatedUserIds,
      relatedUserNames,
      supportDepartmentIds,
      visibleDepartmentIds,
      visibleUserIds,

      createdByUserId: state.user.uid,
      createdByName: state.profile.fullName || "",
      createdByRole: state.profile.role || "",

      assignedAt: Timestamp.fromDate(assignedDate),
      assignedDateKey: dateKey(assignedDate),
      assignedMonthKey: monthKey(assignedDate),
      assignedWeekKey: isoWeekKey(assignedDate),

      deadline: Timestamp.fromDate(deadlineDate),
      deadlineDateKey: dateKey(deadlineDate),

      priority: priority.value,

      outputType: "",
      outputDescription: "",
      evidenceType: "",
      evidenceUrl: "",
      evidenceText: "",
      evidenceFileName: "",
      evidenceStoragePath: "",

      status: "MOI_TIEP_NHAN",
      progress: 0,
      result: "",
      resultSummary: "",
      evidenceLink: "",
      difficulties: "",
      proposal: "",
      completedAt: null,

      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedByUserId: state.user.uid,
      updatedByName: state.profile.fullName || ""
    };

    const taskReference = await addDoc(collection(db, "tasks"), taskPayload);
    const logCreated = await createTaskLog(
      taskReference,
      taskCode,
      title,
      mode
    );

    /*
     * Apps Script sẽ tự xác định người nhận:
     * - SELF_RECORDED: chỉ người có liên quan;
     * - DIRECT_ASSIGNED: người chịu trách nhiệm và người có liên quan.
     */
    await sendNotificationEvent(
      "TASK_CREATED",
      taskReference.id
    );

    showMessage(
      taskMessage,
      logCreated
        ? (
          mode === "SELF_RECORDED"
            ? `✅ Đã ghi nhận nhiệm vụ ${taskCode}.`
            : `✅ Đã giao nhiệm vụ ${taskCode}.`
        )
        : `✅ Đã lưu nhiệm vụ ${taskCode}, nhưng chưa ghi được nhật ký.`,
      logCreated ? "success" : "warning"
    );

    await loadTasks();

    window.setTimeout(() => {
      closeTaskModal();
    }, 900);
  } catch (error) {
    console.error("Không lưu được nhiệm vụ:", error);

    const message = error?.code === "permission-denied"
      ? "Tài khoản chưa được cấp quyền lưu nhiệm vụ theo phương thức này. Hãy cập nhật Firestore Rules của Bước 9.3."
      : (error?.message || "Không lưu được nhiệm vụ.");

    showMessage(taskMessage, message, "error");
  } finally {
    state.savingTask = false;
    saveTaskButton.disabled = false;
    saveTaskButton.textContent = currentEntryMode() === "SELF_RECORDED"
      ? "Lưu ghi nhận"
      : "Giao nhiệm vụ";
  }
}



/* =========================================================
 * CẬP NHẬT TIẾN ĐỘ VÀ KẾT THÚC NHIỆM VỤ
 * ========================================================= */

function syncCompletionEvidenceUI() {
  const isCompleted = progressStatus.value === "HOAN_THANH";
  completionSection.classList.toggle("hidden", !isCompleted);

  if (isCompleted) {
    progressPercent.value = "100";
    progressPercent.disabled = true;
  } else {
    progressPercent.disabled = false;
    if (Number(progressPercent.value) >= 100) {
      progressPercent.value = "95";
    }
  }

  saveProgressButton.textContent = isCompleted
    ? "✓ Hoàn thành nhiệm vụ"
    : "Lưu cập nhật";

  const type = completionProductType.value;
  evidenceLinkWrap.classList.toggle("hidden", !isCompleted || type !== "LINK");
  evidenceTextWrap.classList.toggle(
    "hidden",
    !isCompleted || !["TEXT", "OTHER"].includes(type)
  );

  updateCompletionTimingPreview();
}

function updateCompletionTimingPreview() {
  completionTimingPreview.className = "field-help completion-preview";

  if (progressStatus.value !== "HOAN_THANH") {
    completionTimingPreview.textContent = "";
    return;
  }

  const task = findTaskById(state.selectedTaskId);
  const completed = parseDateInput(completedDate.value, false);

  if (!task || !completed) {
    completionTimingPreview.textContent = "Chọn ngày hoàn thành để hệ thống xác định đúng hạn hoặc trễ hạn.";
    return;
  }

  const info = completionTimingInfo(task, completed);
  completionTimingPreview.textContent = info.text;
  completionTimingPreview.classList.add(
    info.code === "LATE"
      ? "is-late"
      : (info.code === "EARLY" ? "is-early" : "is-on-time")
  );
}

function openProgressModal(taskId = state.selectedTaskId) {
  const task = findTaskById(taskId);

  if (!task || !canUpdateTask(task)) {
    return;
  }

  state.selectedTaskId = task.id;
  hideMessage(progressMessage);
  progressForm.reset();

  progressModalTitle.textContent = task.status === "HOAN_THANH"
    ? "✏️ Chỉnh sửa kết quả hoàn thành"
    : "✏️ Cập nhật / Kết thúc nhiệm vụ";
  progressTaskCode.textContent = task.taskCode || "—";

  progressTaskSummary.innerHTML = `
    <div>
      <h3>${escapeHtml(task.title || "Nhiệm vụ")}</h3>
      <p>${escapeHtml(truncate(task.description || "", 220))}</p>
    </div>
    <div class="summary-deadline">
      <span>Hạn hoàn thành</span>
      <strong>${escapeHtml(formatDate(task.deadline))}</strong>
    </div>
  `;

  const allowedStatuses = [
    "DANG_THUC_HIEN",
    "CHO_PHOI_HOP",
    "HOAN_THANH",
    "TAM_DUNG"
  ];

  progressStatus.value = allowedStatuses.includes(task.status)
    ? task.status
    : "DANG_THUC_HIEN";
  progressPercent.value = String(Number(task.progress) || 0);

  const completedValue = toDate(task.completedAt) || new Date();
  completedDate.value = toDateInput(completedValue);
  const assignedDate = toDate(task.assignedAt || task.sourceDate);
  completedDate.min = assignedDate ? toDateInput(assignedDate) : "";
  completedDate.max = toDateInput(new Date());

  completionProductType.value = task.evidenceType || "";
  resultSummary.value = task.resultSummary || task.result || "";
  evidenceLinkInput.value = task.evidenceUrl || task.evidenceLink || "";
  evidenceTextInput.value = task.evidenceText || "";

  syncCompletionEvidenceUI();

  detailModal.classList.add("hidden");
  progressModal.classList.remove("hidden");
  setBodyModalState();
}

function closeProgressModal() {
  if (state.savingProgress) {
    return;
  }

  progressModal.classList.add("hidden");
  setBodyModalState();
}

async function createProgressLog(task, oldStatus, newStatus, oldProgress, newProgress) {
  try {
    await addDoc(collection(db, "taskLogs"), {
      taskId: task.id,
      taskCode: task.taskCode || "",
      action: newStatus === "HOAN_THANH" ? "COMPLETE_TASK" : "UPDATE_PROGRESS",
      description: newStatus === "HOAN_THANH"
        ? `Kết thúc nhiệm vụ: ${task.title || ""}`
        : `Cập nhật tiến độ nhiệm vụ: ${task.title || ""}`,
      oldStatus: oldStatus || "",
      newStatus,
      oldProgress: Number(oldProgress) || 0,
      newProgress: Number(newProgress) || 0,
      performedByUserId: state.user.uid,
      performedByName: state.profile.fullName || "",
      performedAt: serverTimestamp()
    });
  } catch (error) {
    console.warn("Không ghi được nhật ký cập nhật nhiệm vụ:", error);
  }
}

async function saveProgress(event) {
  event.preventDefault();

  if (state.savingProgress) {
    return;
  }

  const task = findTaskById(state.selectedTaskId);

  if (!task || !canUpdateTask(task)) {
    showMessage(progressMessage, "Tài khoản không có quyền cập nhật nhiệm vụ này.", "error");
    return;
  }

  hideMessage(progressMessage);

  try {
    const newStatus = progressStatus.value;
    let newProgress = Math.max(0, Math.min(100, Number(progressPercent.value) || 0));
    if (newStatus === "HOAN_THANH") {
      newProgress = 100;
    } else if (newProgress >= 100) {
      newProgress = 95;
    }

    state.savingProgress = true;
    saveProgressButton.disabled = true;
    saveProgressButton.textContent = newStatus === "HOAN_THANH"
      ? "Đang kết thúc..."
      : "Đang lưu...";

    const updatePayload = {
      status: newStatus,
      progress: newProgress,
      updatedAt: serverTimestamp(),
      updatedByUserId: state.user.uid,
      updatedByName: state.profile.fullName || ""
    };

    if (newStatus === "HOAN_THANH") {
      const completed = parseDateInput(completedDate.value, false);
      const productType = completionProductType.value;
      const summary = cleanText(resultSummary.value);

      if (!completed) {
        throw new Error("Vui lòng chọn ngày hoàn thành thực tế.");
      }

      completed.setHours(12, 0, 0, 0);

      if (!productType) {
        throw new Error("Vui lòng chọn loại minh chứng.");
      }

      if (!summary) {
        throw new Error("Vui lòng nhập kết quả thực hiện.");
      }

      let evidenceUrl = task.evidenceUrl || task.evidenceLink || "";
      let evidenceText = task.evidenceText || "";
      let evidenceFileName = task.evidenceFileName || "";
      let evidenceStoragePath = task.evidenceStoragePath || "";

      if (productType === "LINK") {
        evidenceUrl = cleanText(evidenceLinkInput.value);
        evidenceText = "";
        evidenceFileName = "Mở đường dẫn minh chứng";
        evidenceStoragePath = "";

        if (!isValidHttpUrl(evidenceUrl)) {
          throw new Error("Đường dẫn minh chứng phải bắt đầu bằng http:// hoặc https://.");
        }
      } else if (["TEXT", "OTHER"].includes(productType)) {
        evidenceText = cleanText(evidenceTextInput.value);
        evidenceUrl = "";
        evidenceFileName = "";
        evidenceStoragePath = "";

        if (!evidenceText) {
          throw new Error("Vui lòng nhập nội dung minh chứng.");
        }
      } else {
        evidenceUrl = "";
        evidenceText = "";
        evidenceFileName = "";
        evidenceStoragePath = "";
      }

      const timing = completionTimingInfo(task, completed);

      Object.assign(updatePayload, {
        completedAt: Timestamp.fromDate(completed),
        completionDateKey: dateKey(completed),
        completionTiming: timing.code,
        completionDaysDifference: timing.days,
        result: summary,
        resultSummary: summary,
        evidenceType: productType,
        evidenceUrl,
        evidenceLink: evidenceUrl,
        evidenceText,
        evidenceFileName,
        evidenceStoragePath
      });
    } else {
      Object.assign(updatePayload, {
        completedAt: null,
        completionDateKey: "",
        completionTiming: "",
        completionDaysDifference: null
      });
    }

    await updateDoc(doc(db, "tasks", task.id), updatePayload);
    await createProgressLog(
      task,
      task.status,
      newStatus,
      task.progress,
      newProgress
    );

    if (newStatus === "HOAN_THANH" && task.status !== "HOAN_THANH") {
      await sendNotificationEvent("TASK_COMPLETED", task.id);
    }

    showMessage(
      progressMessage,
      newStatus === "HOAN_THANH"
        ? `✅ Đã kết thúc nhiệm vụ. ${completionTimingInfo(task, updatePayload.completedAt).text}.`
        : "✅ Đã cập nhật tiến độ nhiệm vụ.",
      "success"
    );

    await loadTasks();

    window.setTimeout(() => {
      state.savingProgress = false;
      closeProgressModal();
      const refreshedTask = findTaskById(task.id);
      if (refreshedTask) {
        openTaskDetail(task.id);
      }
    }, 700);
  } catch (error) {
    console.error("Không cập nhật được nhiệm vụ:", error);
    showMessage(
      progressMessage,
      error?.message || "Không cập nhật được nhiệm vụ.",
      "error"
    );
  } finally {
    if (state.savingProgress) {
      state.savingProgress = false;
    }
    saveProgressButton.disabled = false;
    saveProgressButton.textContent = progressStatus.value === "HOAN_THANH"
      ? "✓ Hoàn thành nhiệm vụ"
      : "Lưu cập nhật";
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

    try {
      await window.TaskPush?.identify(
        user.uid,
        state.profile
      );

      await syncCurrentPushSubscription();
    } catch (pushError) {
      console.warn(
        "OneSignal chưa sẵn sàng:",
        pushError
      );
    }

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
  if (logoutButton.disabled) {
    return;
  }

  const originalContent = logoutButton.innerHTML;
  logoutButton.disabled = true;
  logoutButton.classList.add("logout-pending");
  logoutButton.innerHTML = '<span aria-hidden="true">⏳</span><span class="top-button-text">Đang đăng xuất...</span>';

  /* Hiển thị ngay màn hình đăng nhập, không giữ người dùng ở màn hình tải. */
  showView("login");
  loginForm.reset();
  showMessage(loginMessage, "Đang kết thúc phiên đăng nhập...", "info");
  googleLoginButton.disabled = true;
  loginButton.disabled = true;

  try {
    await withTimeout(
      syncCurrentPushSubscription(false).catch(() => null),
      1200,
      null
    );

    await withTimeout(
      Promise.resolve(window.TaskPush?.logout?.()).catch(() => null),
      1200,
      null
    );

    await signOut(auth);
    resetSessionState();
    showMessage(
      loginMessage,
      "✅ Đã đăng xuất. Bạn có thể đăng nhập bằng tài khoản khác.",
      "success"
    );
    window.history.replaceState(null, "", "./");
  } catch (error) {
    console.error("Không đăng xuất được:", error);
    resetSessionState();
    showMessage(
      loginMessage,
      "Phiên trên giao diện đã được đóng. Hãy kiểm tra mạng rồi đăng nhập tài khoản cần sử dụng.",
      "warning"
    );
  } finally {
    googleLoginButton.disabled = false;
    loginButton.disabled = false;
    logoutButton.disabled = false;
    logoutButton.classList.remove("logout-pending");
    logoutButton.innerHTML = originalContent;
  }
});

portalButton.addEventListener("click", () => {
  window.location.href = PORTAL_URL;
});

refreshButton.addEventListener("click", loadTasks);
exportReportButton?.addEventListener("click", exportTaskReport);
addTaskButton.addEventListener("click", openTaskModal);
closeModalButton.addEventListener("click", closeTaskModal);
cancelTaskButton.addEventListener("click", closeTaskModal);
closeDetailButton.addEventListener("click", closeTaskDetail);
updateTaskButton.addEventListener("click", () => openProgressModal());
closeProgressButton.addEventListener("click", closeProgressModal);
cancelProgressButton.addEventListener("click", closeProgressModal);
progressForm.addEventListener("submit", saveProgress);
progressStatus.addEventListener("change", syncCompletionEvidenceUI);
completionProductType.addEventListener("change", syncCompletionEvidenceUI);
completedDate.addEventListener("input", updateCompletionTimingPreview);

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
  fillOwnerOptions();
  syncSupportDepartmentUI();
});

ownerUserId.addEventListener("change", () => {
  state.selectedSupportIds.delete(ownerUserId.value);
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

progressModal.addEventListener("click", (event) => {
  if (event.target === progressModal) {
    closeProgressModal();
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

  if (!progressModal.classList.contains("hidden")) {
    closeProgressModal();
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
    resetSessionState();
    return;
  }

  initializeUser(user);
});
