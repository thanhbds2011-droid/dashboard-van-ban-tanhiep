import {
  auth,
  db
} from "./firebase-config.js?v=20260716.2200";

import {
  NOTIFICATION_WEB_APP_URL
} from "./notification-config.js?v=20260716.2200";

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
  getDocs,
  getDocsFromServer,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where
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
  savingAssignment: false,
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
const assignTaskButton = $("assignTaskButton");

const assignmentModal = $("assignmentModal");
const assignmentForm = $("assignmentForm");
const assignmentModalTitle = $("assignmentModalTitle");
const assignmentTaskCode = $("assignmentTaskCode");
const assignmentTaskSummary = $("assignmentTaskSummary");
const internalOwnerUserId = $("internalOwnerUserId");
const assignmentHelp = $("assignmentHelp");
const assignmentMessage = $("assignmentMessage");
const closeAssignmentButton = $("closeAssignmentButton");
const cancelAssignmentButton = $("cancelAssignmentButton");
const saveAssignmentButton = $("saveAssignmentButton");

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
const resultSummaryWrap = $("resultSummaryWrap");
const resultSummary = $("resultSummary");
const evidenceFileWrap = $("evidenceFileWrap");
const evidenceFileInput = $("evidenceFileInput");
const evidenceFileName = $("evidenceFileName");
const existingEvidenceLink = $("existingEvidenceLink");

/* =========================================================
 * GIAO DIá»N CHUNG
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
    !progressModal.classList.contains("hidden") ||
    !assignmentModal.classList.contains("hidden");

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
    .replace(/Ä/g, "d")
    .replace(/Ä/g, "D")
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

  /* ÄÃ³ng giao diá»n theo cÃ¡ch an toÃ n khi phiÃªn ÄÃ£ káº¿t thÃºc. */
  taskModal?.classList.add("hidden");
  detailModal?.classList.add("hidden");
  progressModal?.classList.add("hidden");
  assignmentModal?.classList.add("hidden");
  document.body.classList.remove("modal-open");

  loginForm.reset();
  hideMessage(loginMessage);
  showView("login");
}

/* =========================================================
 * NGÃY THÃNG
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
    return "ChÆ°a xÃ¡c Äá»nh";
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
      text: "ChÆ°a xÃ¡c Äá»nh thá»i Äiá»m hoÃ n thÃ nh",
      className: ""
    };
  }

  const difference = calendarDayDifference(completed, due);

  if (difference < 0) {
    return {
      code: "EARLY",
      days: difference,
      text: `HoÃ n thÃ nh trÆ°á»c háº¡n ${Math.abs(difference)} ngÃ y`,
      className: "completion-early"
    };
  }

  if (difference === 0) {
    return {
      code: "ON_TIME",
      days: 0,
      text: "HoÃ n thÃ nh ÄÃºng háº¡n",
      className: "completion-on-time"
    };
  }

  return {
    code: "LATE",
    days: difference,
    text: `HoÃ n thÃ nh trá» ${difference} ngÃ y`,
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
 * TÃN HIá»N THá»
 * ========================================================= */

function roleName(role) {
  const map = {
    ADMIN: "Quáº£n trá» há» thá»ng",
    DIRECTOR: "Ban GiÃ¡m Äá»c",
    DEPARTMENT_LEADER: "TrÆ°á»ng/PhÃ³ phÃ²ng"
  };

  return map[role] || role || "ChÆ°a xÃ¡c Äá»nh";
}

function statusName(status) {
  const map = {
    MOI_TIEP_NHAN: "Má»i ghi nháº­n",
    DANG_THUC_HIEN: "Äang thá»±c hiá»n",
    CHO_PHOI_HOP: "Chá» phá»i há»£p",
    HOAN_THANH: "HoÃ n thÃ nh",
    TAM_DUNG: "Táº¡m dá»«ng",
    HUY: "Há»§y"
  };

  return map[status] || status || "ChÆ°a xÃ¡c Äá»nh";
}

function priorityName(value) {
  const map = {
    THUONG: "ThÆ°á»ng",
    QUAN_TRONG: "Quan trá»ng",
    KHAN: "Kháº©n"
  };

  return map[value] || value || "ThÆ°á»ng";
}

function sourceName(value) {
  const map = {
    VAN_BAN_CHI_DAO: "VÄn báº£n chá» Äáº¡o",
    HOP_GIAO_BAN: "Cuá»c há»p giao ban",
    HOP_CHUYEN_DE: "Cuá»c há»p chuyÃªn Äá»",
    CHI_DAO_TRUC_TIEP: "Chá» Äáº¡o trá»±c tiáº¿p",
    DOT_XUAT: "Nhiá»m vá»¥ Äá»t xuáº¥t",
    THUONG_XUYEN: "Nhiá»m vá»¥ thÆ°á»ng xuyÃªn",
    KE_HOACH_CONG_TAC: "Káº¿ hoáº¡ch cÃ´ng tÃ¡c",
    DINH_KY: "Nhiá»m vá»¥ Äá»nh ká»³",
    KHAC: "KhÃ¡c"
  };

  return map[value] || value || "ChÆ°a xÃ¡c Äá»nh";
}

function entryModeName(value) {
  const map = {
    SELF_RECORDED: "Tá»± ghi nháº­n",
    DIRECT_ASSIGNED: "BGÄ giao trá»±c tiáº¿p"
  };

  return map[value] || "Nhiá»m vá»¥ cÅ©";
}

function outputTypeName(value) {
  const map = {
    BAO_CAO: "BÃ¡o cÃ¡o",
    KE_HOACH: "Káº¿ hoáº¡ch",
    CONG_VAN: "CÃ´ng vÄn",
    QUYET_DINH: "Quyáº¿t Äá»nh",
    THONG_BAO: "ThÃ´ng bÃ¡o",
    TO_TRINH: "Tá» trÃ¬nh",
    QUY_CHE: "Quy cháº¿",
    BIEN_BAN: "BiÃªn báº£n",
    DANH_SACH: "Danh sÃ¡ch",
    BANG_TONG_HOP: "Báº£ng tá»ng há»£p",
    PHUONG_AN: "PhÆ°Æ¡ng Ã¡n",
    QUY_TRINH: "Quy trÃ¬nh",
    HO_SO: "Há» sÆ¡",
    DU_LIEU_CAP_NHAT: "Dá»¯ liá»u ÄÃ£ cáº­p nháº­t",
    KET_QUA_KIEM_TRA: "Káº¿t quáº£ kiá»m tra",
    KET_QUA_THUC_TE: "Káº¿t quáº£ thá»±c táº¿",
    KHAC: "Sáº£n pháº©m khÃ¡c"
  };

  return map[value] || value || "ChÆ°a xÃ¡c Äá»nh";
}

function evidenceTypeName(value) {
  const map = {
    NONE: "KhÃ´ng cÃ³ minh chá»©ng",
    FILE: "Tá»p/hÃ¬nh áº£nh ÄÃ£ táº£i lÃªn",
    OTHER: "Minh chá»©ng khÃ¡c",

    /* TÆ°Æ¡ng thÃ­ch dá»¯ liá»u cÅ©. */
    LINK: "ÄÆ°á»ng dáº«n liÃªn káº¿t",
    PDF: "Tá»p PDF",
    IMAGE: "HÃ¬nh áº£nh",
    TEXT: "Ná»i dung nháº­p tay"
  };

  return map[value] || value || "ChÆ°a ghi nháº­n";
}

function userDisplayName(uid) {
  const user = userById(uid);

  if (!user) {
    return uid || "ChÆ°a xÃ¡c Äá»nh";
  }

  return [
    user.fullName,
    user.position,
    departmentName(user.departmentId)
  ].filter(Boolean).join(" â ");
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
    : (id || "ChÆ°a xÃ¡c Äá»nh");
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
      text: "ÄÃ£ há»§y",
      className: ""
    };
  }

  const dueDate = toDate(task.deadline);

  if (!dueDate) {
    return {
      code: "NO_DEADLINE",
      text: "ChÆ°a cÃ³ háº¡n",
      className: ""
    };
  }

  const diffDays = Math.round(
    (startOfDay(dueDate) - startOfDay(new Date())) / 86400000
  );

  if (diffDays < 0) {
    return {
      code: "OVERDUE",
      text: `QuÃ¡ háº¡n ${Math.abs(diffDays)} ngÃ y`,
      className: "red"
    };
  }

  if (diffDays === 0) {
    return {
      code: "DUE_TODAY",
      text: "Äáº¿n háº¡n hÃ´m nay",
      className: "orange"
    };
  }

  if (diffDays <= 5) {
    return {
      code: "UPCOMING",
      text: `CÃ²n ${diffDays} ngÃ y`,
      className: "blue"
    };
  }

  return {
    code: "IN_TIME",
    text: "CÃ²n háº¡n",
    className: ""
  };
}

/* =========================================================
 * Äá»C FIRESTORE
 * ========================================================= */

async function loadProfile(user) {
  const userReference = doc(db, "users", user.uid);
  const userSnapshot = await getDoc(userReference);

  if (userSnapshot.exists()) {
    const profile = userSnapshot.data();

    if (profile.active !== true) {
      throw new Error("TÃ i khoáº£n ÄÃ£ bá» khÃ³a hoáº·c ngá»«ng hoáº¡t Äá»ng.");
    }

    if (!profile.fullName || !profile.departmentId || !profile.role) {
      throw new Error("Há» sÆ¡ ngÆ°á»i dÃ¹ng chÆ°a Äáº§y Äá»§ thÃ´ng tin phÃ¢n quyá»n.");
    }

    return {
      id: userSnapshot.id,
      ...profile
    };
  }

  const normalizedEmail = cleanText(user.email).toLowerCase();

  if (!normalizedEmail) {
    throw new Error("TÃ i khoáº£n ÄÄng nháº­p khÃ´ng cung cáº¥p Äá»a chá» email.");
  }

  const accessReference = doc(
    db,
    "accessAccounts",
    normalizedEmail
  );

  const accessSnapshot = await getDoc(accessReference);

  if (!accessSnapshot.exists()) {
    const error = new Error(
      "Email nÃ y chÆ°a ÄÆ°á»£c quáº£n trá» cáº¥p quyá»n sá»­ dá»¥ng há» thá»ng."
    );
    error.code = "app/not-authorized";
    throw error;
  }

  const accessData = accessSnapshot.data();

  if (accessData.active !== true) {
    const error = new Error(
      "TÃ i khoáº£n ÄÃ£ bá» khÃ³a hoáº·c ngá»«ng hoáº¡t Äá»ng."
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
      "ThÃ´ng tin cáº¥p quyá»n cá»§a tÃ i khoáº£n chÆ°a Äáº§y Äá»§."
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
 * PHáº M VI THEO DÃI VÃ Tá»NG Há»¢P
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
  refreshButton.textContent = "â³ Äang táº£i...";
  hideMessage(dashboardMessage);

  try {
    const taskMap = new Map();

    const addSnapshotToMap = (snapshot) => {
      snapshot.forEach((item) => {
        const task = {
          id: item.id,
          ...item.data()
        };

        if (task.active !== false) {
          taskMap.set(item.id, task);
        }
      });
    };

    if (canViewAllTasks()) {
      const snapshot = await getDocsFromServer(
        collection(db, "tasks")
      );
      addSnapshotToMap(snapshot);

    } else if (state.profile.role === "DEPARTMENT_LEADER") {
      const departmentId = cleanText(state.profile.departmentId);
      const tasksRef = collection(db, "tasks");

      if (!departmentId) {
        throw new Error("Há» sÆ¡ tÃ i khoáº£n chÆ°a cÃ³ mÃ£ PhÃ²ng/Khu.");
      }

      /* Truy váº¥n báº¯t buá»c: nhiá»m vá»¥ thuá»c PhÃ²ng/Khu chÃ­nh. */
      const primarySnapshot = await getDocsFromServer(
        query(
          tasksRef,
          where("primaryDepartmentId", "==", departmentId)
        )
      );
      addSnapshotToMap(primarySnapshot);

      /* Truy váº¥n phá»¥: nhiá»m vá»¥ cÃ³ PhÃ²ng/Khu phá»i há»£p. */
      try {
        const visibleSnapshot = await getDocsFromServer(
          query(
            tasksRef,
            where("visibleDepartmentIds", "array-contains", departmentId)
          )
        );
        addSnapshotToMap(visibleSnapshot);
      } catch (visibleError) {
        console.warn(
          "ChÆ°a Äá»c ÄÆ°á»£c nhiá»m vá»¥ phá»i há»£p theo visibleDepartmentIds:",
          visibleError
        );
      }

      /* TÆ°Æ¡ng thÃ­ch dá»¯ liá»u cÅ©. */
      try {
        const supportSnapshot = await getDocsFromServer(
          query(
            tasksRef,
            where("supportDepartmentIds", "array-contains", departmentId)
          )
        );
        addSnapshotToMap(supportSnapshot);
      } catch (supportError) {
        console.warn(
          "ChÆ°a Äá»c ÄÆ°á»£c nhiá»m vá»¥ phá»i há»£p theo supportDepartmentIds:",
          supportError
        );
      }

    } else {
      throw new Error("Vai trÃ² tÃ i khoáº£n chÆ°a ÄÆ°á»£c cáº¥p quyá»n xem nhiá»m vá»¥.");
    }

    state.tasks = Array.from(taskMap.values());

    state.tasks.sort((a, b) => {
      const dateA = toDate(a.updatedAt) || toDate(a.createdAt) || new Date(0);
      const dateB = toDate(b.updatedAt) || toDate(b.createdAt) || new Date(0);
      return dateB.getTime() - dateA.getTime();
    });

    lastUpdated.textContent = `Cáº­p nháº­t lÃºc ${formatDateTime()}`;
    renderMetrics();
    applyFilters();

  } catch (error) {
    console.error("KhÃ´ng táº£i ÄÆ°á»£c nhiá»m vá»¥:", error);

    state.tasks = [];
    renderMetrics();
    applyFilters();

    let message = error?.message || "KhÃ´ng táº£i ÄÆ°á»£c dá»¯ liá»u nhiá»m vá»¥.";

    if (
      error?.code === "permission-denied" ||
      error?.code === "firestore/permission-denied"
    ) {
      message = "Firestore Äang tá»« chá»i truy váº¥n nhiá»m vá»¥. HÃ£y kiá»m tra Rules BÆ°á»c 2 ÄÃ£ Publish thÃ nh cÃ´ng.";
    }

    showMessage(dashboardMessage, message, "error");

  } finally {
    state.loadingTasks = false;
    refreshButton.disabled = false;
    refreshButton.textContent = "ð LÃ m má»i";
  }
}

/* =========================================================
 * TÃI KHOáº¢N VÃ Bá» Lá»C
 * ========================================================= */

function renderAccount() {
  welcomeName.textContent = `Xin chÃ o, ${state.profile.fullName}`;
  welcomeDepartment.textContent = [
    departmentName(state.profile.departmentId),
    state.profile.position
  ].filter(Boolean).join(" â¢ ");

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
    addTaskButton.textContent = "â Ghi nháº­n nhiá»m vá»¥";
  } else if (state.profile.role === "DIRECTOR") {
    addTaskButton.textContent = "â¡ Giao nhiá»m vá»¥ trá»±c tiáº¿p";
  } else {
    addTaskButton.textContent = "â¡ Táº¡o nhiá»m vá»¥ trá»±c tiáº¿p";
  }

  const hasOverviewAccess = canViewAllTasks();
  departmentFilterWrap.classList.toggle("hidden", !hasOverviewAccess);
  exportReportButton?.classList.toggle("hidden", !canExportTaskReport());

  if (isTchcCoordinationAccount()) {
    welcomeDepartment.textContent = [
      departmentName(state.profile.departmentId),
      state.profile.position,
      "Äáº§u má»i theo dÃµi, tá»ng há»£p nhiá»m vá»¥ toÃ n Trung tÃ¢m"
    ].filter(Boolean).join(" â¢ ");
  }

  fillDepartmentFilter();
}

function fillDepartmentFilter() {
  const oldValue = departmentFilter.value || "ALL";

  departmentFilter.innerHTML = '<option value="ALL">Táº¥t cáº£ PhÃ²ng/Khu</option>';

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
 * XUáº¤T BÃO CÃO NHIá»M Vá»¤ â A4 NGANG
 * ========================================================= */

function reportTaskStatusName(task) {
  const due = deadlineState(task);

  if (task.status === "HOAN_THANH") {
    const timing = completionTimingInfo(task);

    if (timing.code === "EARLY") {
      return `HoÃ n thÃ nh sá»m ${Math.abs(Number(timing.days) || 0)} ngÃ y`;
    }

    return timing.text;
  }

  if (task.status === "HUY") {
    return "ÄÃ£ há»§y";
  }

  if (task.status === "TAM_DUNG") {
    return due.code === "OVERDUE"
      ? `Táº¡m dá»«ng â ${due.text}`
      : "Táº¡m dá»«ng";
  }

  const statusMap = {
    MOI_TIEP_NHAN: "ChÆ°a thá»±c hiá»n",
    DANG_THUC_HIEN: "Äang thá»±c hiá»n",
    CHO_PHOI_HOP: "Chá» phá»i há»£p"
  };

  const statusText = statusMap[task.status] || statusName(task.status);

  if (due.code === "OVERDUE" || due.code === "DUE_TODAY" || due.code === "UPCOMING") {
    return `${statusText} â ${due.text}`;
  }

  return statusText;
}

function reportTaskStatusClass(task) {
  const due = deadlineState(task);

  if (task.status === "HOAN_THANH") {
    return completionTimingInfo(task).code === "LATE"
      ? "status-completed-late"
      : "status-completed";
  }

  if (task.status === "HUY") {
    return "status-cancelled";
  }

  if (task.status === "TAM_DUNG") {
    return "status-paused";
  }

  if (due.code === "OVERDUE") {
    return "status-overdue";
  }

  if (["DUE_TODAY", "UPCOMING"].includes(due.code)) {
    return "status-warning";
  }

  return "status-processing";
}

function reportScopeText() {
  const selectedDepartment = departmentFilter?.value || "ALL";

  return selectedDepartment === "ALL"
    ? "ToÃ n Trung tÃ¢m"
    : departmentName(selectedDepartment);
}

function exportTaskReport() {
  if (!canExportTaskReport()) {
    showMessage(
      dashboardMessage,
      "TÃ i khoáº£n khÃ´ng cÃ³ quyá»n xuáº¥t bÃ¡o cÃ¡o tá»ng há»£p.",
      "error"
    );
    return;
  }

  const tasksToExport = Array.isArray(state.filteredTasks)
    ? state.filteredTasks
    : [];

  if (tasksToExport.length === 0) {
    showMessage(
      dashboardMessage,
      "KhÃ´ng cÃ³ nhiá»m vá»¥ trong bá» lá»c hiá»n táº¡i Äá» xuáº¥t bÃ¡o cÃ¡o.",
      "warning"
    );
    return;
  }

  const reportWindow = window.open(
    "",
    "_blank",
    "width=1400,height=900"
  );

  if (!reportWindow) {
    showMessage(
      dashboardMessage,
      "TrÃ¬nh duyá»t Äang cháº·n cá»­a sá» bÃ¡o cÃ¡o. HÃ£y cho phÃ©p cá»­a sá» báº­t lÃªn rá»i thá»­ láº¡i.",
      "error"
    );
    return;
  }

  const now = new Date();
  const totalCount = tasksToExport.length;
  const completedCount = tasksToExport.filter((task) => task.status === "HOAN_THANH").length;
  const overdueCount = tasksToExport.filter((task) => (
    task.status !== "HOAN_THANH" &&
    task.status !== "HUY" &&
    deadlineState(task).code === "OVERDUE"
  )).length;
  const processingCount = tasksToExport.filter((task) => [
    "MOI_TIEP_NHAN",
    "DANG_THUC_HIEN",
    "CHO_PHOI_HOP",
    "TAM_DUNG"
  ].includes(task.status)).length;

  const scopeText = reportScopeText();

  const reportRows = tasksToExport.map((task, index) => {
    const progressValue = Math.max(0, Math.min(100, Number(task.progress) || 0));

    const descriptionHtml = task.description
      ? `<div class="task-description">${escapeHtml(task.description)}</div>`
      : "";

    const resultText = task.status === "HOAN_THANH"
      ? (task.resultSummary || task.result || "â")
      : "â";

    return `
      <tr>
        <td class="column-stt">${index + 1}</td>

        <td class="column-task">
          <strong class="task-title">${escapeHtml(task.title || "Nhiá»m vá»¥ chÆ°a cÃ³ tiÃªu Äá»")}</strong>
          ${descriptionHtml}
        </td>

        <td class="column-department">${escapeHtml(departmentName(task.primaryDepartmentId))}</td>
        <td class="column-owner">${escapeHtml(task.ownerName || "Chá» phÃ¢n cÃ´ng ná»i bá»")}</td>
        <td class="column-deadline">${escapeHtml(formatDate(task.deadline))}</td>
        <td class="column-progress"><strong>${progressValue}%</strong></td>

        <td class="column-status">
          <span class="report-status ${reportTaskStatusClass(task)}">
            ${escapeHtml(reportTaskStatusName(task))}
          </span>
        </td>

        <td class="column-result">${escapeHtml(resultText)}</td>
      </tr>
    `;
  }).join("");

  const reportTitle = `Bao-cao-theo-doi-nhiem-vu_${dateKey(now)}`;

  const reportHtml = `
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${escapeHtml(reportTitle)}</title>

      <style>
        @page {
          size: A4 landscape;
          margin: 9mm 9mm 10mm 9mm;
        }

        * { box-sizing: border-box; }

        html,
        body {
          margin: 0;
          padding: 0;
          background: #ffffff;
          color: #172033;
          font-family: Arial, Helvetica, sans-serif;
        }

        body {
          font-size: 9pt;
          line-height: 1.35;
        }

        .report-page {
          width: 100%;
          margin: 0 auto;
        }

        .print-toolbar {
          position: sticky;
          top: 0;
          z-index: 10;
          display: flex;
          justify-content: center;
          gap: 10px;
          padding: 12px;
          margin-bottom: 16px;
          background: #eaf3fa;
          border-bottom: 1px solid #c7d9e8;
        }

        .print-toolbar button {
          min-height: 42px;
          padding: 0 22px;
          border: 1px solid #1c6798;
          border-radius: 8px;
          background: #1c6798;
          color: #ffffff;
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
        }

        .print-toolbar button.secondary {
          background: #ffffff;
          color: #1c6798;
        }

        .agency-name {
          margin: 0;
          text-align: center;
          font-family: "Times New Roman", Times, serif;
          font-size: 12pt;
          font-weight: 700;
          text-transform: uppercase;
        }

        .agency-line {
          width: 110px;
          height: 1px;
          margin: 5px auto 10px;
          background: #172033;
        }

        .report-heading {
          margin: 0;
          text-align: center;
          font-family: "Times New Roman", Times, serif;
          font-size: 17pt;
          font-weight: 700;
          text-transform: uppercase;
        }

        .report-subheading {
          margin: 4px 0 14px;
          text-align: center;
          font-family: "Times New Roman", Times, serif;
          font-size: 10.5pt;
          font-style: italic;
        }

        .report-information {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 5px 20px;
          margin: 0 0 12px;
          padding: 9px 11px;
          border: 1px solid #a8becf;
          border-radius: 6px;
          background: #f7fafc;
        }

        .report-information strong { color: #174f76; }

        .summary-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 8px;
          margin-bottom: 12px;
        }

        .summary-card {
          padding: 8px 10px;
          border: 1px solid #a8becf;
          border-radius: 6px;
          text-align: center;
          background: #ffffff;
        }

        .summary-card span {
          display: block;
          margin-bottom: 2px;
          color: #536579;
          font-size: 8.5pt;
        }

        .summary-card strong {
          display: block;
          color: #174f76;
          font-size: 15pt;
        }

        .summary-card.completed strong { color: #17834f; }
        .summary-card.overdue strong { color: #c93434; }

        .report-table-wrap {
          width: 100%;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
        }

        table {
          width: 100%;
          min-width: 1060px;
          border-collapse: collapse;
          table-layout: fixed;
          font-size: 8.5pt;
        }

        thead { display: table-header-group; }

        tr {
          break-inside: avoid;
          page-break-inside: avoid;
        }

        th,
        td {
          border: 1px solid #7c8b99;
          padding: 5px;
          vertical-align: top;
          overflow-wrap: break-word;
          word-break: normal;
        }

        th {
          background: #1c6798;
          color: #ffffff;
          text-align: center;
          font-weight: 700;
          text-transform: uppercase;
        }

        tbody tr:nth-child(even) { background: #f5f8fa; }

        .column-stt { width: 4%; text-align: center; white-space: nowrap; }
        .column-task { width: 27%; }
        .column-department { width: 11%; }
        .column-owner { width: 13%; }
        .column-deadline { width: 9%; text-align: center; white-space: nowrap; }
        .column-progress { width: 7%; text-align: center; white-space: nowrap; }
        .column-status { width: 13%; }
        .column-result { width: 16%; }

        .task-title {
          display: block;
          margin-bottom: 3px;
          color: #112f46;
        }

        .task-description {
          color: #495b6b;
          font-size: 8pt;
          line-height: 1.3;
        }

        .report-status { display: inline-block; font-weight: 700; }
        .status-completed { color: #147c48; }
        .status-completed-late { color: #a86400; }
        .status-overdue { color: #c62828; }
        .status-warning { color: #a45e00; }
        .status-processing { color: #155f91; }
        .status-paused,
        .status-cancelled { color: #5f6973; }

        .report-footer {
          display: flex;
          justify-content: space-between;
          gap: 30px;
          margin-top: 15px;
          padding-top: 9px;
          border-top: 1px solid #9caab6;
        }

        .footer-note {
          flex: 1;
          color: #5c6670;
          font-size: 8pt;
          font-style: italic;
        }

        .signature-block {
          width: 270px;
          text-align: center;
          font-family: "Times New Roman", Times, serif;
          font-size: 10pt;
        }

        .signature-block strong {
          display: block;
          text-transform: uppercase;
        }

        .signature-space { height: 45px; }

        @media print {
          .no-print { display: none !important; }

          .report-table-wrap {
            overflow: visible;
          }

          table {
            min-width: 0;
          }

          .report-information,
          .summary-card,
          th,
          tbody tr:nth-child(even) {
            print-color-adjust: exact;
            -webkit-print-color-adjust: exact;
          }
        }
      </style>
    </head>

    <body>
      <div class="print-toolbar no-print">
        <button type="button" onclick="window.print()">In / LÆ°u thÃ nh PDF</button>
        <button type="button" class="secondary" onclick="window.close()">ÄÃ³ng bÃ¡o cÃ¡o</button>
      </div>

      <main class="report-page">
        <p class="agency-name">Trung tÃ¢m Báº£o trá»£ xÃ£ há»i TÃ¢n Hiá»p</p>
        <div class="agency-line"></div>

        <h1 class="report-heading">BÃ¡o cÃ¡o theo dÃµi thá»±c hiá»n nhiá»m vá»¥</h1>
        <p class="report-subheading">Dá»¯ liá»u ÄÆ°á»£c tá»ng há»£p táº¡i thá»i Äiá»m xuáº¥t bÃ¡o cÃ¡o</p>

        <section class="report-information">
          <div>
            <strong>ÄÆ¡n vá» xuáº¥t bÃ¡o cÃ¡o:</strong>
            PHÃNG Tá» CHá»¨C - HÃNH CHÃNH
          </div>

          <div>
            <strong>Thá»i Äiá»m xuáº¥t:</strong>
            ${escapeHtml(formatDateTime(now))}
          </div>

          <div>
            <strong>Pháº¡m vi bÃ¡o cÃ¡o:</strong>
            ${escapeHtml(scopeText)}
          </div>

          <div>
            <strong>Sá» nhiá»m vá»¥:</strong>
            ${totalCount} nhiá»m vá»¥
          </div>
        </section>

        <section class="summary-grid">
          <div class="summary-card">
            <span>Tá»ng nhiá»m vá»¥</span>
            <strong>${totalCount}</strong>
          </div>

          <div class="summary-card completed">
            <span>ÄÃ£ hoÃ n thÃ nh</span>
            <strong>${completedCount}</strong>
          </div>

          <div class="summary-card">
            <span>Äang theo dÃµi</span>
            <strong>${processingCount}</strong>
          </div>

          <div class="summary-card overdue">
            <span>QuÃ¡ háº¡n</span>
            <strong>${overdueCount}</strong>
          </div>
        </section>

        <div class="report-table-wrap">
          <table>
            <thead>
              <tr>
                <th class="column-stt">STT</th>
                <th class="column-task">Ná»i dung nhiá»m vá»¥</th>
                <th class="column-department">PhÃ²ng/Khu</th>
                <th class="column-owner">NgÆ°á»i phá»¥ trÃ¡ch</th>
                <th class="column-deadline">Háº¡n hoÃ n thÃ nh</th>
                <th class="column-progress">Tiáº¿n Äá»</th>
                <th class="column-status">TÃ¬nh tráº¡ng</th>
                <th class="column-result">Káº¿t quáº£ thá»±c hiá»n</th>
              </tr>
            </thead>
            <tbody>${reportRows}</tbody>
          </table>
        </div>

        <footer class="report-footer">
          <div class="footer-note">
            BÃ¡o cÃ¡o ÄÆ°á»£c táº¡o tá»± Äá»ng tá»« Há» thá»ng Quáº£n lÃ½ nhiá»m vá»¥
            cá»§a Trung tÃ¢m Báº£o trá»£ xÃ£ há»i TÃ¢n Hiá»p.
          </div>

          <div class="signature-block">
            <strong>PhÃ²ng Tá» chá»©c - HÃ nh chÃ­nh</strong>
            <div class="signature-space"></div>
          </div>
        </footer>
      </main>
    </body>
    </html>
  `;

  reportWindow.document.open();
  reportWindow.document.write(reportHtml);
  reportWindow.document.close();
  reportWindow.focus();

  window.setTimeout(() => {
    try {
      reportWindow.print();
    } catch (error) {
      console.warn("KhÃ´ng tá»± má» ÄÆ°á»£c há»p thoáº¡i in:", error);
    }
  }, 700);

  showMessage(
    dashboardMessage,
    `â ÄÃ£ táº¡o bÃ¡o cÃ¡o A4 ngang gá»m ${totalCount} nhiá»m vá»¥. Chá»n âLÆ°u thÃ nh PDFâ trong cá»­a sá» in.`,
    "success"
  );
}

/* =========================================================
 * HIá»N THá» DANH SÃCH
 * ========================================================= */

function renderTasks(tasks) {
  taskCount.textContent = `${tasks.length} nhiá»m vá»¥`;

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
        <td><span class="task-code">${escapeHtml(task.taskCode || "ChÆ°a cÃ³ mÃ£")}</span></td>
        <td class="task-title-cell">
          <strong>${escapeHtml(task.title || "Nhiá»m vá»¥ chÆ°a cÃ³ tiÃªu Äá»")}</strong>
          <span class="task-entry-line">
            <span class="badge ${task.entryMode === "DIRECT_ASSIGNED" ? "orange" : "blue"}">
              ${escapeHtml(entryModeName(task.entryMode))}
            </span>
            ${escapeHtml(truncate(task.description, 105))}
          </span>
        </td>
        <td>${escapeHtml(departmentName(task.primaryDepartmentId))}</td>
        <td>${escapeHtml(task.ownerName || "Chá» phÃ¢n cÃ´ng ná»i bá»")}</td>
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
            <span class="task-code">${escapeHtml(task.taskCode || "ChÆ°a cÃ³ mÃ£")}</span>
            <span class="badge ${task.entryMode === "DIRECT_ASSIGNED" ? "orange" : "blue"}">
              ${escapeHtml(entryModeName(task.entryMode))}
            </span>
            <h3>${escapeHtml(task.title || "Nhiá»m vá»¥ chÆ°a cÃ³ tiÃªu Äá»")}</h3>
          </div>
          <span class="badge ${statusBadgeClass(task.status)}">
            ${escapeHtml(statusName(task.status))}
          </span>
        </div>

        <p>${escapeHtml(truncate(task.description, 160))}</p>

        <div class="task-mobile-meta">
          <div>
            <span>PhÃ²ng/Khu chÃ­nh</span>
            <strong>${escapeHtml(departmentName(task.primaryDepartmentId))}</strong>
          </div>
          <div>
            <span>NgÆ°á»i phá»¥ trÃ¡ch</span>
            <strong>${escapeHtml(task.ownerName || "Chá» phÃ¢n cÃ´ng ná»i bá»")}</strong>
          </div>
          <div>
            <span>Háº¡n hoÃ n thÃ nh</span>
            <strong>${escapeHtml(formatDate(task.deadline))}</strong>
          </div>
          <div>
            <span>TÃ¬nh tráº¡ng háº¡n</span>
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

function canAssignTask(task) {
  if (!task || !state.user || !state.profile) {
    return false;
  }

  return (
    state.profile.role === "DEPARTMENT_LEADER" &&
    task.primaryDepartmentId === state.profile.departmentId &&
    task.status !== "HOAN_THANH" &&
    task.status !== "HUY"
  );
}

function canUpdateTask(task) {
  if (!task || !state.user || !state.profile) {
    return false;
  }

  if (state.profile.role === "ADMIN") {
    return true;
  }

  /*
   * Sau khi phÃ¢n cÃ´ng ná»i bá», TrÆ°á»ng/PhÃ³ ÄÆ°á»£c giao trá»±c tiáº¿p
   * má»i cáº­p nháº­t tiáº¿n Äá» vÃ  káº¿t quáº£ nhiá»m vá»¥.
   */
  if (
    state.profile.role === "DEPARTMENT_LEADER" &&
    task.primaryDepartmentId === state.profile.departmentId
  ) {
    return task.ownerUserId === state.user.uid;
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
  const fileName = task.evidenceFileName || "Má» tá»p minh chá»©ng";

  let evidenceContent = evidenceType === "NONE"
    ? "KhÃ´ng cÃ³ minh chá»©ng"
    : "ChÆ°a ghi nháº­n";

  if (evidenceUrl && isValidHttpUrl(evidenceUrl)) {
    evidenceContent = `
      <a href="${escapeHtml(evidenceUrl)}" target="_blank" rel="noopener noreferrer">
        ${escapeHtml(fileName)}
      </a>
    `;
  } else if (evidenceText) {
    evidenceContent = escapeHtml(evidenceText);
  }

  return `
    <div class="result-card">
      <h4>â Káº¿t quáº£ vÃ  minh chá»©ng</h4>
      <div class="result-card-grid">
        <div class="result-card-item">
          <span>NgÃ y hoÃ n thÃ nh thá»±c táº¿</span>
          <strong>${escapeHtml(formatDate(task.completedAt))}</strong>
        </div>
        <div class="result-card-item">
          <span>ÄÃ¡nh giÃ¡ thá»i háº¡n</span>
          <strong>${escapeHtml(completionTimingInfo(task).text)}</strong>
        </div>
        <div class="result-card-item">
          <span>Loáº¡i minh chá»©ng</span>
          <strong>${escapeHtml(evidenceTypeName(evidenceType))}</strong>
        </div>
        <div class="result-card-item result-span-2">
          <span>Káº¿t quáº£ thá»±c hiá»n</span>
          <strong>${escapeHtml(task.resultSummary || task.result || "KhÃ´ng yÃªu cáº§u nháº­p káº¿t quáº£")}</strong>
        </div>
        <div class="result-card-item result-span-2">
          <span>Minh chá»©ng</span>
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

  const relatedDepartmentIds = Array.isArray(task.relatedDepartmentIds)
    ? task.relatedDepartmentIds
    : (
      Array.isArray(task.supportDepartmentIds)
        ? task.supportDepartmentIds
        : []
    );

  const relatedDepartmentsText = relatedDepartmentIds.length > 0
    ? relatedDepartmentIds.map(departmentName).join(", ")
    : "KhÃ´ng cÃ³";

  const progressText = Number.isFinite(Number(task.progress))
    ? `${Number(task.progress)}%`
    : "ChÆ°a cáº­p nháº­t";

  const legacyOutputHtml = (
    task.status !== "HOAN_THANH" &&
    (task.outputType || task.outputDescription)
  )
    ? `
      <div class="detail-item">
        <span>Sáº£n pháº©m dá»± kiáº¿n (dá»¯ liá»u cÅ©)</span>
        <strong>${escapeHtml(outputTypeName(task.outputType))}</strong>
      </div>
      <div class="detail-item detail-span-2">
        <span>MÃ´ táº£ sáº£n pháº©m dá»± kiáº¿n</span>
        <strong>${escapeHtml(task.outputDescription || "ChÆ°a ghi nháº­n")}</strong>
      </div>
    `
    : "";

  detailTaskCode.textContent = task.taskCode || "ChÆ°a cÃ³ mÃ£";

  detailContent.innerHTML = `
    <h3 class="detail-title">${escapeHtml(task.title || "Nhiá»m vá»¥ chÆ°a cÃ³ tiÃªu Äá»")}</h3>
    <p class="detail-description">${escapeHtml(task.description || "ChÆ°a cÃ³ ná»i dung chi tiáº¿t")}</p>

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
        <span>Tráº¡ng thÃ¡i phÃ¢n cÃ´ng ná»i bá»</span>
        <strong>${escapeHtml(
          task.ownerName
            ? `ÄÃ£ phÃ¢n cÃ´ng: ${task.ownerName}`
            : "Chá» PhÃ²ng/Khu phÃ¢n cÃ´ng"
        )}</strong>
      </div>
      <div class="detail-item">
        <span>PhÃ²ng/Khu</span>
        <strong>${escapeHtml(departmentName(task.primaryDepartmentId))}</strong>
      </div>
      <div class="detail-item detail-span-2">
        <span>PhÃ²ng/Khu phá»i há»£p</span>
        <strong>${escapeHtml(relatedDepartmentsText)}</strong>
      </div>
      <div class="detail-item">
        <span>NgÆ°á»i giao/chá» Äáº¡o</span>
        <strong>${escapeHtml(task.assignedByName || "ChÆ°a xÃ¡c Äá»nh")}</strong>
      </div>
      <div class="detail-item">
        <span>Nguá»n nhiá»m vá»¥</span>
        <strong>${escapeHtml(sourceName(task.sourceType))}</strong>
      </div>
      <div class="detail-item detail-span-2">
        <span>CÄn cá»© hoáº·c ná»i dung liÃªn quan</span>
        <strong>${escapeHtml(task.sourceDetail || task.sourceReference || "ChÆ°a xÃ¡c Äá»nh")}</strong>
      </div>
      <div class="detail-item">
        <span>NgÃ y ÄÆ°á»£c chá» Äáº¡o</span>
        <strong>${escapeHtml(formatDate(task.sourceDate || task.assignedAt))}</strong>
      </div>
      <div class="detail-item">
        <span>Háº¡n hoÃ n thÃ nh</span>
        <strong>${escapeHtml(formatDate(task.deadline))}</strong>
      </div>
      <div class="detail-item">
        <span>Tiáº¿n Äá» hiá»n táº¡i</span>
        <strong>${escapeHtml(progressText)}</strong>
      </div>
      <div class="detail-item">
        <span>NgÆ°á»i nháº­p nhiá»m vá»¥</span>
        <strong>${escapeHtml(task.createdByName || "ChÆ°a xÃ¡c Äá»nh")}</strong>
      </div>
      ${legacyOutputHtml}
    </div>

    ${task.status === "HOAN_THANH" ? resultEvidenceHtml(task) : ""}
  `;

  const allowAssign = canAssignTask(task);
  const allowUpdate = canUpdateTask(task);

  detailFooter.classList.toggle(
    "hidden",
    !allowAssign && !allowUpdate
  );

  assignTaskButton.classList.toggle("hidden", !allowAssign);
  assignTaskButton.textContent = task.ownerUserId
    ? "ð¤ PhÃ¢n cÃ´ng láº¡i"
    : "ð¤ PhÃ¢n cÃ´ng ná»i bá»";

  updateTaskButton.classList.toggle("hidden", !allowUpdate);
  updateTaskButton.textContent = task.status === "HOAN_THANH"
    ? "âï¸ Chá»nh sá»­a káº¿t quáº£ hoÃ n thÃ nh"
    : "âï¸ Cáº­p nháº­t / Káº¿t thÃºc nhiá»m vá»¥";

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
 * BIá»U MáºªU THÃM NHIá»M Vá»¤
 * ========================================================= */

function configureEntryMode() {
  const mode = currentEntryMode();
  entryMode.value = mode;

  const selfRecorded = mode === "SELF_RECORDED";

  taskModalTitle.textContent = selfRecorded
    ? "â Ghi nháº­n nhiá»m vá»¥"
    : "â¡ Giao nhiá»m vá»¥ trá»±c tiáº¿p";

  taskModalSubtitle.textContent = selfRecorded
    ? "Ghi nháº­n nhiá»m vá»¥ ÄÃ£ ÄÆ°á»£c Ban GiÃ¡m Äá»c chá» Äáº¡o táº¡i cuá»c há»p, vÄn báº£n hoáº·c trá»±c tiáº¿p."
    : "DÃ¹ng cho nhiá»m vá»¥ Äá»t xuáº¥t cáº§n Ban GiÃ¡m Äá»c giao trá»±c tiáº¿p trÃªn á»©ng dá»¥ng.";

  entryModeBanner.className = selfRecorded
    ? "entry-mode-banner entry-mode-self"
    : "entry-mode-banner entry-mode-direct";

  entryModeBanner.innerHTML = selfRecorded
    ? `
      <strong>Tá»° GHI NHáº¬N</strong>
      <span>NgÆ°á»i Äang ÄÄng nháº­p tá»± bÃ¡o cÃ¡o nhiá»m vá»¥ mÃ¬nh ÄÃ£ ÄÆ°á»£c chá» Äáº¡o.</span>
    `
    : `
      <strong>BGÄ GIAO TRá»°C TIáº¾P</strong>
      <span>Nhiá»m vá»¥ Äá»t xuáº¥t ÄÆ°á»£c nháº­p trá»±c tiáº¿p vÃ  gá»­i thÃ´ng bÃ¡o tá»i ngÆ°á»i nháº­n.</span>
    `;

  saveTaskButton.textContent = selfRecorded
    ? "LÆ°u ghi nháº­n"
    : "Giao nhiá»m vá»¥";
}

function fillAssignedByOptions() {
  const directors = state.users
    .filter((item) => item.active === true && item.role === "DIRECTOR")
    .sort((a, b) => String(a.fullName || "").localeCompare(String(b.fullName || ""), "vi"));

  assignedByUserId.innerHTML = '<option value="">Chá»n ngÆ°á»i giao/chá» Äáº¡o</option>';

  directors.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = [item.fullName, item.position].filter(Boolean).join(" â ");
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
    ].filter(Boolean).join(" â ");

    assignedByUserId.appendChild(option);
    assignedByUserId.value = state.user.uid;
    assignedByUserId.disabled = true;

    return;
  }

  assignedByUserId.disabled = directors.length === 0;

  if (directors.length === 0) {
    assignedByUserId.innerHTML = '<option value="">ChÆ°a cÃ³ tÃ i khoáº£n Ban GiÃ¡m Äá»c</option>';
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
    primaryHelp.textContent = "PhÃ²ng/Khu chá»u trÃ¡ch nhiá»m ÄÆ°á»£c cá» Äá»nh theo tÃ i khoáº£n Äang ÄÄng nháº­p.";
    return;
  }

  primaryDepartmentId.disabled = false;
  primaryDepartmentId.innerHTML = '<option value="">Chá»n PhÃ²ng/Khu chá»u trÃ¡ch nhiá»m</option>';

  state.departments
    .filter((item) => item.id !== "BGD")
    .forEach((item) => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.name || item.code || item.id;
      primaryDepartmentId.appendChild(option);
    });

  primaryHelp.textContent = "Chá»n PhÃ²ng/Khu tiáº¿p nháº­n vÃ  chá»u trÃ¡ch nhiá»m chÃ­nh.";
}

function fillOwnerOptions() {
  /*
   * BÆ°á»c 1: nhiá»m vá»¥ ÄÆ°á»£c giao cho PhÃ²ng/Khu, chÆ°a giao cÃ¡ nhÃ¢n.
   * TrÆ°á»ng/PhÃ³ cá»§a PhÃ²ng/Khu sáº½ thá»±c hiá»n phÃ¢n cÃ´ng ná»i bá» á» bÆ°á»c sau.
   */
  if (ownerUserId) {
    ownerUserId.value = "";
  }

  if (ownerHelp) {
    ownerHelp.textContent =
      "Nhiá»m vá»¥ ÄÆ°á»£c chuyá»n Äáº¿n PhÃ²ng/Khu; chÆ°a phÃ¢n cÃ´ng cÃ¡ nhÃ¢n táº¡i bÆ°á»c táº¡o.";
  }
}

function availableRelatedDepartments() {
  const primaryId = primaryDepartmentId.value || state.profile?.departmentId || "";

  return state.departments
    .filter((item) => (
      item.active !== false &&
      item.id !== "BGD" &&
      item.id !== primaryId
    ))
    .sort((a, b) => (
      Number(a.order || 0) - Number(b.order || 0)
      || String(a.name || a.code || a.id)
        .localeCompare(String(b.name || b.code || b.id), "vi")
    ));
}

function renderSupportOptions() {
  const keyword = normalizeText(supportSearchInput.value);

  const departments = availableRelatedDepartments()
    .filter((item) => normalizeText([
      item.name,
      item.code,
      item.id
    ].filter(Boolean).join(" ")).includes(keyword));

  if (departments.length === 0) {
    supportOptions.innerHTML =
      '<div class="multi-select-empty">KhÃ´ng tÃ¬m tháº¥y PhÃ²ng/Khu phÃ¹ há»£p.</div>';
    return;
  }

  supportOptions.innerHTML = departments.map((item) => {
    const label = item.name || item.code || item.id;

    return `
      <label class="multi-select-option">
        <input
          type="checkbox"
          value="${escapeHtml(item.id)}"
          ${state.selectedSupportIds.has(item.id) ? "checked" : ""}
        >
        <span>
          <strong>${escapeHtml(label)}</strong>
          <small>${escapeHtml(item.code || item.id)}</small>
        </span>
      </label>
    `;
  }).join("");
}

function renderSelectedSupportChips() {
  const availableIds = new Set(
    availableRelatedDepartments().map((item) => item.id)
  );

  const selectedIds = Array.from(state.selectedSupportIds)
    .filter((id) => availableIds.has(id));

  state.selectedSupportIds = new Set(selectedIds);

  if (selectedIds.length === 0) {
    supportSummary.textContent = "Chá»n PhÃ²ng/Khu phá»i há»£p";
    supportSelectedChips.innerHTML = "";
    return;
  }

  supportSummary.textContent = `ÄÃ£ chá»n ${selectedIds.length} PhÃ²ng/Khu`;

  supportSelectedChips.innerHTML = selectedIds.map((id) => {
    const label = departmentName(id);

    return `
      <span class="selected-chip">
        ${escapeHtml(label)}
        <button
          type="button"
          data-remove-support-id="${escapeHtml(id)}"
          aria-label="Bá» ${escapeHtml(label)}"
        >Ã</button>
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
    console.error("KhÃ´ng táº£i ÄÆ°á»£c biá»u máº«u:", error);
    showMessage(
      taskMessage,
      error?.message || "KhÃ´ng táº£i ÄÆ°á»£c danh má»¥c phÃ²ng ban vÃ  ngÆ°á»i dÃ¹ng.",
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
 * LÆ¯U THIáº¾T Bá» NHáº¬N THÃNG BÃO VÃO FIRESTORE
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
    return "Äiá»n thoáº¡i Android";
  }

  if (/Windows/i.test(userAgent)) {
    return "MÃ¡y tÃ­nh Windows";
  }

  if (/Macintosh|Mac OS X/i.test(userAgent)) {
    return "MÃ¡y tÃ­nh Mac";
  }

  return "TrÃ¬nh duyá»t Web";
}


const MAX_EVIDENCE_FILE_SIZE = 8 * 1024 * 1024;
const EVIDENCE_UPLOAD_TIMEOUT_MS = 90000;

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = String(reader.result || "");
      const commaIndex = result.indexOf(",");
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };

    reader.onerror = () => {
      reject(new Error("KhÃ´ng Äá»c ÄÆ°á»£c tá»p ÄÃ£ chá»n."));
    };

    reader.readAsDataURL(file);
  });
}

function evidenceUploadRequestId() {
  return [
    "TASK_UPLOAD",
    Date.now(),
    Math.random().toString(36).slice(2, 10)
  ].join("_");
}

function validateEvidenceFile(file) {
  if (!file) {
    throw new Error("Vui lÃ²ng chá»n tá»p hoáº·c hÃ¬nh áº£nh cáº§n táº£i lÃªn.");
  }

  if (file.size <= 0) {
    throw new Error("Tá»p ÄÃ£ chá»n khÃ´ng cÃ³ dá»¯ liá»u.");
  }

  if (file.size > MAX_EVIDENCE_FILE_SIZE) {
    throw new Error("Dung lÆ°á»£ng tá»p khÃ´ng ÄÆ°á»£c vÆ°á»£t quÃ¡ 8 MB.");
  }

  const allowedExtensions = [
    ".pdf", ".jpg", ".jpeg", ".png", ".webp",
    ".doc", ".docx", ".xls", ".xlsx",
    ".ppt", ".pptx", ".txt"
  ];

  const lowerName = String(file.name || "").toLowerCase();

  if (!allowedExtensions.some((extension) => lowerName.endsWith(extension))) {
    throw new Error(
      "Chá» há» trá»£ PDF, hÃ¬nh áº£nh, Word, Excel, PowerPoint hoáº·c tá»p TXT."
    );
  }
}

async function uploadTaskEvidenceToDrive(file, task) {
  validateEvidenceFile(file);

  if (!NOTIFICATION_WEB_APP_URL) {
    throw new Error("ChÆ°a cáº¥u hÃ¬nh URL Apps Script táº£i minh chá»©ng lÃªn Drive.");
  }

  if (!state.user || !task?.id) {
    throw new Error("PhiÃªn ÄÄng nháº­p hoáº·c nhiá»m vá»¥ khÃ´ng há»£p lá».");
  }

  const requestId = evidenceUploadRequestId();
  const idToken = await state.user.getIdToken();
  const base64Data = await readFileAsBase64(file);

  return new Promise((resolve, reject) => {
    const iframeName = `taskEvidenceUploadFrame_${requestId}`;
    const iframe = document.createElement("iframe");
    const form = document.createElement("form");
    const input = document.createElement("input");

    iframe.name = iframeName;
    iframe.className = "hidden-upload-frame";
    iframe.setAttribute("aria-hidden", "true");

    form.method = "POST";
    form.action = NOTIFICATION_WEB_APP_URL;
    form.target = iframeName;
    form.style.display = "none";

    input.type = "hidden";
    input.name = "payload";
    input.value = JSON.stringify({
      action: "UPLOAD_TASK_EVIDENCE",
      requestId,
      taskId: task.id,
      taskCode: task.taskCode || "",
      idToken,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      base64Data
    });

    form.appendChild(input);

    let settled = false;

    const cleanup = () => {
      window.removeEventListener("message", handleMessage);
      window.clearTimeout(timeoutId);
      form.remove();
      iframe.remove();
    };

    const finish = (callback) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      callback();
    };

    const handleMessage = (event) => {
      const data = event?.data;

      if (
        !data ||
        data.source !== "TASK_EVIDENCE_UPLOAD" ||
        data.requestId !== requestId
      ) {
        return;
      }

      if (data.ok === true && data.fileUrl) {
        finish(() => resolve(data));
        return;
      }

      finish(() => reject(
        new Error(data.error || "KhÃ´ng táº£i ÄÆ°á»£c tá»p lÃªn Google Drive.")
      ));
    };

    const timeoutId = window.setTimeout(() => {
      finish(() => reject(
        new Error("QuÃ¡ thá»i gian táº£i tá»p. HÃ£y kiá»m tra máº¡ng vÃ  thá»­ láº¡i.")
      ));
    }, EVIDENCE_UPLOAD_TIMEOUT_MS);

    window.addEventListener("message", handleMessage);
    document.body.appendChild(iframe);
    document.body.appendChild(form);
    form.submit();
  });
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
    "ÄÃ£ Äá»ng bá» taskPushSubscriptions:",
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
        "OneSignal chÆ°a cÃ³ Subscription ID Äá» Äá»ng bá»."
      );

      return false;
    }

    return await saveTaskPushSubscription(
      snapshot,
      activeOverride
    );

  } catch (error) {
    console.warn(
      "ChÆ°a Äá»ng bá» ÄÆ°á»£c thiáº¿t bá» thÃ´ng bÃ¡o:",
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
          "KhÃ´ng lÆ°u ÄÆ°á»£c thay Äá»i Subscription:",
          error
        );
      }
    );
  }
);


/* =========================================================
 * Gá»I GOOGLE APPS SCRIPT Gá»¬I THÃNG BÃO
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
      "ChÆ°a cáº¥u hÃ¬nh URL Google Apps Script gá»­i thÃ´ng bÃ¡o."
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
     * DÃ¹ng text/plain vÃ  no-cors Äá» gá»­i tá»« GitHub Pages
     * tá»i Google Apps Script mÃ  khÃ´ng phÃ¡t sinh lá»i CORS.
     *
     * PhÃ­a Apps Script váº«n xÃ¡c minh Firebase ID Token
     * trÆ°á»c khi gá»­i thÃ´ng bÃ¡o OneSignal.
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
      "ChÆ°a gá»­i ÄÆ°á»£c yÃªu cáº§u thÃ´ng bÃ¡o:",
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
        ? `Tá»± ghi nháº­n nhiá»m vá»¥: ${title}`
        : `Giao nhiá»m vá»¥ trá»±c tiáº¿p: ${title}`,
      oldValue: null,
      newValue: "MOI_TIEP_NHAN",
      performedByUserId: state.user.uid,
      performedByName: state.profile.fullName,
      performedAt: serverTimestamp()
    });

    return true;
  } catch (error) {
    console.error("KhÃ´ng ghi ÄÆ°á»£c nháº­t kÃ½ nhiá»m vá»¥:", error);
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
    const assignedDate = parseDateInput(assignedAt.value, false);
    const deadlineDate = parseDateInput(deadline.value, true);

    const supportDepartmentIds = Array.from(state.selectedSupportIds)
      .filter((departmentId) => departmentId && departmentId !== primaryId);

    if (!title) {
      throw new Error("Vui lÃ²ng nháº­p tÃªn nhiá»m vá»¥.");
    }

    if (!description) {
      throw new Error("Vui lÃ²ng nháº­p ná»i dung thá»±c hiá»n.");
    }

    if (!selectedSource) {
      throw new Error("Vui lÃ²ng chá»n nguá»n nhiá»m vá»¥.");
    }

    if (!sourceInformation) {
      throw new Error("Vui lÃ²ng nháº­p cÄn cá»© hoáº·c ná»i dung chá» Äáº¡o liÃªn quan.");
    }

    if (!assignedBy) {
      throw new Error("Vui lÃ²ng chá»n ngÆ°á»i giao/chá» Äáº¡o.");
    }

    if (!primaryId) {
      throw new Error("Vui lÃ²ng xÃ¡c Äá»nh PhÃ²ng/Khu chá»u trÃ¡ch nhiá»m.");
    }



    if (
      mode === "SELF_RECORDED" &&
      primaryId !== state.profile.departmentId
    ) {
      throw new Error("PhÃ²ng/Khu cá»§a nhiá»m vá»¥ tá»± ghi nháº­n khÃ´ng há»£p lá».");
    }


    if (!assignedDate) {
      throw new Error("NgÃ y ÄÆ°á»£c chá» Äáº¡o khÃ´ng há»£p lá».");
    }

    if (!deadlineDate) {
      throw new Error("Háº¡n hoÃ n thÃ nh khÃ´ng há»£p lá».");
    }

    if (deadlineDate.getTime() < assignedDate.getTime()) {
      throw new Error("Háº¡n hoÃ n thÃ nh khÃ´ng ÄÆ°á»£c trÆ°á»c ngÃ y ÄÆ°á»£c chá» Äáº¡o.");
    }

    state.savingTask = true;
    saveTaskButton.disabled = true;
    saveTaskButton.textContent = "Äang lÆ°u...";
    showMessage(
      taskMessage,
      mode === "SELF_RECORDED"
        ? "Äang lÆ°u ná»i dung ghi nháº­n..."
        : "Äang giao nhiá»m vá»¥ trá»±c tiáº¿p...",
      "info"
    );

    const taskCode = createTaskCode();

    const relatedDepartmentIds = Array.from(
      new Set(supportDepartmentIds)
    );

    const visibleDepartmentIds = Array.from(new Set([
      primaryId,
      ...relatedDepartmentIds
    ]));

    const visibleUserIds = Array.from(new Set([
      state.user.uid,
      assignedBy.id
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

      /*
       * BÆ°á»c 1: giao cho PhÃ²ng/Khu, chÆ°a giao cÃ¡ nhÃ¢n.
       * CÃ¡c trÆ°á»ng owner ÄÆ°á»£c giá»¯ Äá» tÆ°Æ¡ng thÃ­ch dá»¯ liá»u vÃ  dÃ¹ng cho
       * chá»©c nÄng phÃ¢n cÃ´ng ná»i bá» á» bÆ°á»c tiáº¿p theo.
       */
      ownerUserId: "",
      ownerName: "",
      ownerPosition: "",
      assignmentStatus: "CHO_PHAN_CONG",

      relatedDepartmentIds,
      supportDepartmentIds: relatedDepartmentIds,
      relatedUserIds: [],
      relatedUserNames: [],
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
     * Apps Script sáº½ tá»± xÃ¡c Äá»nh ngÆ°á»i nháº­n:
     * - SELF_RECORDED: chá» ngÆ°á»i cÃ³ liÃªn quan;
     * - DIRECT_ASSIGNED: ngÆ°á»i chá»u trÃ¡ch nhiá»m vÃ  ngÆ°á»i cÃ³ liÃªn quan.
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
            ? `â ÄÃ£ ghi nháº­n nhiá»m vá»¥ ${taskCode}.`
            : `â ÄÃ£ giao nhiá»m vá»¥ ${taskCode}.`
        )
        : `â ÄÃ£ lÆ°u nhiá»m vá»¥ ${taskCode}, nhÆ°ng chÆ°a ghi ÄÆ°á»£c nháº­t kÃ½.`,
      logCreated ? "success" : "warning"
    );

    await loadTasks();

    window.setTimeout(() => {
      closeTaskModal();
    }, 900);
  } catch (error) {
    console.error("KhÃ´ng lÆ°u ÄÆ°á»£c nhiá»m vá»¥:", error);

    const message = error?.code === "permission-denied"
      ? "TÃ i khoáº£n chÆ°a ÄÆ°á»£c cáº¥p quyá»n lÆ°u nhiá»m vá»¥ theo phÆ°Æ¡ng thá»©c nÃ y. HÃ£y cáº­p nháº­t Firestore Rules cá»§a BÆ°á»c 9.3."
      : (error?.message || "KhÃ´ng lÆ°u ÄÆ°á»£c nhiá»m vá»¥.");

    showMessage(taskMessage, message, "error");
  } finally {
    state.savingTask = false;
    saveTaskButton.disabled = false;
    saveTaskButton.textContent = currentEntryMode() === "SELF_RECORDED"
      ? "LÆ°u ghi nháº­n"
      : "Giao nhiá»m vá»¥";
  }
}



/* =========================================================
 * PHÃN CÃNG Ná»I Bá»
 * ========================================================= */

function internalAssigneeOptions(task) {
  return state.users
    .filter((item) => (
      item.active === true &&
      item.role === "DEPARTMENT_LEADER" &&
      item.departmentId === task.primaryDepartmentId
    ))
    .sort((a, b) => String(a.fullName || "").localeCompare(
      String(b.fullName || ""),
      "vi"
    ));
}

function openAssignmentModal(taskId = state.selectedTaskId) {
  const task = findTaskById(taskId);

  if (!task || !canAssignTask(task)) {
    return;
  }

  state.selectedTaskId = task.id;
  hideMessage(assignmentMessage);
  assignmentForm.reset();

  assignmentModalTitle.textContent = task.ownerUserId
    ? "ð¤ PhÃ¢n cÃ´ng láº¡i nhiá»m vá»¥"
    : "ð¤ PhÃ¢n cÃ´ng ná»i bá»";
  assignmentTaskCode.textContent = task.taskCode || "â";
  assignmentTaskSummary.innerHTML = `
    <div>
      <h3>${escapeHtml(task.title || "Nhiá»m vá»¥")}</h3>
      <p>${escapeHtml(truncate(task.description || "", 220))}</p>
    </div>
    <div class="summary-deadline">
      <span>PhÃ²ng/Khu phá»¥ trÃ¡ch</span>
      <strong>${escapeHtml(departmentName(task.primaryDepartmentId))}</strong>
    </div>
  `;

  const assignees = internalAssigneeOptions(task);
  internalOwnerUserId.innerHTML =
    '<option value="">Chá»n TrÆ°á»ng/PhÃ³ phá»¥ trÃ¡ch thá»±c hiá»n</option>';

  assignees.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = [item.fullName, item.position]
      .filter(Boolean)
      .join(" â ");
    internalOwnerUserId.appendChild(option);
  });

  internalOwnerUserId.value = assignees.some(
    (item) => item.id === task.ownerUserId
  )
    ? task.ownerUserId
    : "";

  assignmentHelp.textContent = assignees.length > 0
    ? "Chá» hiá»n thá» TrÆ°á»ng/PhÃ³ Äang hoáº¡t Äá»ng thuá»c PhÃ²ng/Khu chá»u trÃ¡ch nhiá»m chÃ­nh."
    : "PhÃ²ng/Khu nÃ y chÆ°a cÃ³ tÃ i khoáº£n TrÆ°á»ng/PhÃ³ Äang hoáº¡t Äá»ng.";

  internalOwnerUserId.disabled = assignees.length === 0;
  saveAssignmentButton.disabled = assignees.length === 0;

  detailModal.classList.add("hidden");
  assignmentModal.classList.remove("hidden");
  setBodyModalState();
}

function closeAssignmentModal() {
  if (state.savingAssignment) {
    return;
  }

  assignmentModal.classList.add("hidden");
  setBodyModalState();
}

async function createAssignmentLog(task, owner) {
  try {
    await addDoc(collection(db, "taskLogs"), {
      taskId: task.id,
      taskCode: task.taskCode || "",
      action: task.ownerUserId ? "REASSIGN_INTERNAL" : "ASSIGN_INTERNAL",
      description: `PhÃ¢n cÃ´ng ná»i bá» cho ${owner.fullName || ""}`,
      oldValue: task.ownerUserId || "",
      newValue: owner.id,
      performedByUserId: state.user.uid,
      performedByName: state.profile.fullName || "",
      performedAt: serverTimestamp()
    });
  } catch (error) {
    console.warn("KhÃ´ng ghi ÄÆ°á»£c nháº­t kÃ½ phÃ¢n cÃ´ng:", error);
  }
}

async function saveInternalAssignment(event) {
  event.preventDefault();

  if (state.savingAssignment) {
    return;
  }

  const task = findTaskById(state.selectedTaskId);

  if (!task || !canAssignTask(task)) {
    showMessage(
      assignmentMessage,
      "TÃ i khoáº£n khÃ´ng cÃ³ quyá»n phÃ¢n cÃ´ng nhiá»m vá»¥ nÃ y.",
      "error"
    );
    return;
  }

  const owner = userById(internalOwnerUserId.value);

  if (
    !owner ||
    owner.active !== true ||
    owner.role !== "DEPARTMENT_LEADER" ||
    owner.departmentId !== task.primaryDepartmentId
  ) {
    showMessage(
      assignmentMessage,
      "Vui lÃ²ng chá»n ÄÃºng TrÆ°á»ng/PhÃ³ thuá»c PhÃ²ng/Khu phá»¥ trÃ¡ch.",
      "error"
    );
    return;
  }

  state.savingAssignment = true;
  saveAssignmentButton.disabled = true;
  saveAssignmentButton.textContent = "Äang phÃ¢n cÃ´ng...";
  hideMessage(assignmentMessage);

  try {
    const visibleUserIds = Array.from(new Set([
      ...(Array.isArray(task.visibleUserIds) ? task.visibleUserIds : []),
      owner.id,
      state.user.uid
    ]));

    await updateDoc(doc(db, "tasks", task.id), {
      ownerUserId: owner.id,
      ownerName: owner.fullName || "",
      ownerPosition: owner.position || "",
      assignmentStatus: "DA_PHAN_CONG",
      internalAssignedByUserId: state.user.uid,
      internalAssignedByName: state.profile.fullName || "",
      internalAssignedAt: serverTimestamp(),
      visibleUserIds,
      updatedAt: serverTimestamp(),
      updatedByUserId: state.user.uid,
      updatedByName: state.profile.fullName || ""
    });

    await createAssignmentLog(task, owner);
    await sendNotificationEvent("TASK_INTERNAL_ASSIGNED", task.id);

    showMessage(
      assignmentMessage,
      `â ÄÃ£ phÃ¢n cÃ´ng nhiá»m vá»¥ cho ${owner.fullName || "ngÆ°á»i phá»¥ trÃ¡ch"}.`,
      "success"
    );

    await loadTasks();

    window.setTimeout(() => {
      state.savingAssignment = false;
      closeAssignmentModal();

      if (findTaskById(task.id)) {
        openTaskDetail(task.id);
      }
    }, 700);
  } catch (error) {
    console.error("KhÃ´ng phÃ¢n cÃ´ng ÄÆ°á»£c nhiá»m vá»¥:", error);

    showMessage(
      assignmentMessage,
      error?.code === "permission-denied"
        ? "Firestore chÆ°a cho phÃ©p PhÃ²ng/Khu phÃ¢n cÃ´ng ná»i bá». HÃ£y Publish Rules BÆ°á»c 2."
        : (error?.message || "KhÃ´ng phÃ¢n cÃ´ng ÄÆ°á»£c nhiá»m vá»¥."),
      "error"
    );
  } finally {
    state.savingAssignment = false;
    saveAssignmentButton.disabled = false;
    saveAssignmentButton.textContent = "XÃ¡c nháº­n phÃ¢n cÃ´ng";
  }
}

/* =========================================================
 * Cáº¬P NHáº¬T TIáº¾N Äá» VÃ Káº¾T THÃC NHIá»M Vá»¤
 * ========================================================= */

function updateEvidenceFileSelection() {
  const file = evidenceFileInput?.files?.[0] || null;

  if (file) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
    evidenceFileName.textContent = `${file.name} â ${sizeMb} MB`;
    evidenceFileName.classList.add("has-file");
    return;
  }

  const task = findTaskById(state.selectedTaskId);
  const existingUrl = task?.evidenceUrl || task?.evidenceLink || "";

  evidenceFileName.textContent = existingUrl
    ? `Äang sá»­ dá»¥ng tá»p hiá»n táº¡i: ${task?.evidenceFileName || "Má» tá»p minh chá»©ng"}`
    : "ChÆ°a chá»n tá»p";

  evidenceFileName.classList.toggle("has-file", Boolean(existingUrl));
}

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
    ? "â HoÃ n thÃ nh nhiá»m vá»¥"
    : "LÆ°u cáº­p nháº­t";

  const evidenceType = completionProductType.value;
  const showResult = isCompleted && ["FILE", "OTHER"].includes(evidenceType);
  const showFile = isCompleted && evidenceType === "FILE";

  resultSummaryWrap.classList.toggle("hidden", !showResult);
  evidenceFileWrap.classList.toggle("hidden", !showFile);

  resultSummary.required = showResult;

  if (!showResult) {
    resultSummary.value = "";
  }

  if (!showFile) {
    evidenceFileInput.value = "";
  }

  updateEvidenceFileSelection();
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
    completionTimingPreview.textContent = "Chá»n ngÃ y hoÃ n thÃ nh Äá» há» thá»ng xÃ¡c Äá»nh ÄÃºng háº¡n hoáº·c trá» háº¡n.";
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
    ? "âï¸ Chá»nh sá»­a káº¿t quáº£ hoÃ n thÃ nh"
    : "âï¸ Cáº­p nháº­t / Káº¿t thÃºc nhiá»m vá»¥";
  progressTaskCode.textContent = task.taskCode || "â";

  progressTaskSummary.innerHTML = `
    <div>
      <h3>${escapeHtml(task.title || "Nhiá»m vá»¥")}</h3>
      <p>${escapeHtml(truncate(task.description || "", 220))}</p>
    </div>
    <div class="summary-deadline">
      <span>Háº¡n hoÃ n thÃ nh</span>
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

  const savedEvidenceType = task.evidenceType || "";

  completionProductType.value = ["LINK", "PDF", "IMAGE"].includes(savedEvidenceType)
    ? "FILE"
    : (savedEvidenceType === "TEXT" ? "OTHER" : savedEvidenceType);

  resultSummary.value = task.resultSummary || task.result || "";
  evidenceFileInput.value = "";

  const existingUrl = task.evidenceUrl || task.evidenceLink || "";
  existingEvidenceLink.classList.toggle("hidden", !existingUrl);
  existingEvidenceLink.href = existingUrl || "#";
  existingEvidenceLink.textContent = task.evidenceFileName
    ? `Má» tá»p hiá»n táº¡i: ${task.evidenceFileName}`
    : "Má» tá»p minh chá»©ng hiá»n táº¡i";

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
        ? `Káº¿t thÃºc nhiá»m vá»¥: ${task.title || ""}`
        : `Cáº­p nháº­t tiáº¿n Äá» nhiá»m vá»¥: ${task.title || ""}`,
      oldStatus: oldStatus || "",
      newStatus,
      oldProgress: Number(oldProgress) || 0,
      newProgress: Number(newProgress) || 0,
      performedByUserId: state.user.uid,
      performedByName: state.profile.fullName || "",
      performedAt: serverTimestamp()
    });
  } catch (error) {
    console.warn("KhÃ´ng ghi ÄÆ°á»£c nháº­t kÃ½ cáº­p nháº­t nhiá»m vá»¥:", error);
  }
}

async function saveProgress(event) {
  event.preventDefault();

  if (state.savingProgress) {
    return;
  }

  const task = findTaskById(state.selectedTaskId);

  if (!task || !canUpdateTask(task)) {
    showMessage(
      progressMessage,
      "TÃ i khoáº£n khÃ´ng cÃ³ quyá»n cáº­p nháº­t nhiá»m vá»¥ nÃ y.",
      "error"
    );
    return;
  }

  hideMessage(progressMessage);

  try {
    const newStatus = progressStatus.value;
    let newProgress = Math.max(
      0,
      Math.min(100, Number(progressPercent.value) || 0)
    );

    if (newStatus === "HOAN_THANH") {
      newProgress = 100;
    } else if (newProgress >= 100) {
      newProgress = 95;
    }

    state.savingProgress = true;
    saveProgressButton.disabled = true;
    saveProgressButton.textContent = newStatus === "HOAN_THANH"
      ? "Äang káº¿t thÃºc..."
      : "Äang lÆ°u...";

    const updatePayload = {
      status: newStatus,
      progress: newProgress,
      updatedAt: serverTimestamp(),
      updatedByUserId: state.user.uid,
      updatedByName: state.profile.fullName || ""
    };

    if (newStatus === "HOAN_THANH") {
      const completed = parseDateInput(completedDate.value, false);
      const selectedEvidenceType = completionProductType.value;
      const needsResult = ["FILE", "OTHER"].includes(selectedEvidenceType);
      const summary = needsResult ? cleanText(resultSummary.value) : "";

      if (!completed) {
        throw new Error("Vui lÃ²ng chá»n ngÃ y hoÃ n thÃ nh thá»±c táº¿.");
      }

      completed.setHours(12, 0, 0, 0);

      if (!selectedEvidenceType) {
        throw new Error("Vui lÃ²ng chá»n loáº¡i minh chá»©ng.");
      }

      if (needsResult && !summary) {
        throw new Error("Vui lÃ²ng nháº­p káº¿t quáº£ thá»±c hiá»n.");
      }

      let evidenceUrl = "";
      let evidenceText = "";
      let evidenceFileNameValue = "";
      let evidenceStoragePath = "";

      if (selectedEvidenceType === "FILE") {
        const selectedFile = evidenceFileInput.files?.[0] || null;
        const existingUrl = task.evidenceUrl || task.evidenceLink || "";

        if (selectedFile) {
          saveProgressButton.textContent = "Äang táº£i tá»p lÃªn Drive...";

          const uploadResult = await uploadTaskEvidenceToDrive(
            selectedFile,
            task
          );

          evidenceUrl = uploadResult.fileUrl || "";
          evidenceFileNameValue = uploadResult.fileName || selectedFile.name;
          evidenceStoragePath = uploadResult.fileId || "";
        } else if (existingUrl) {
          evidenceUrl = existingUrl;
          evidenceFileNameValue = task.evidenceFileName || "Má» tá»p minh chá»©ng";
          evidenceStoragePath = task.evidenceStoragePath || "";
        } else {
          throw new Error("Vui lÃ²ng chá»n tá»p hoáº·c hÃ¬nh áº£nh cáº§n táº£i lÃªn.");
        }
      }

      const timing = completionTimingInfo(task, completed);

      Object.assign(updatePayload, {
        completedAt: Timestamp.fromDate(completed),
        completionDateKey: dateKey(completed),
        completionTiming: timing.code,
        completionDaysDifference: timing.days,
        result: summary,
        resultSummary: summary,
        evidenceType: selectedEvidenceType,
        evidenceUrl,
        evidenceLink: evidenceUrl,
        evidenceText,
        evidenceFileName: evidenceFileNameValue,
        evidenceStoragePath
      });
    } else {
      Object.assign(updatePayload, {
        completedAt: null,
        completionDateKey: "",
        completionTiming: "",
        completionDaysDifference: null,
        result: "",
        resultSummary: "",
        evidenceType: "",
        evidenceUrl: "",
        evidenceLink: "",
        evidenceText: "",
        evidenceFileName: "",
        evidenceStoragePath: ""
      });
    }

    await updateDoc(
      doc(db, "tasks", task.id),
      updatePayload
    );

    await createProgressLog(
      task,
      task.status,
      newStatus,
      task.progress,
      newProgress
    );

    if (
      newStatus === "HOAN_THANH" &&
      task.status !== "HOAN_THANH"
    ) {
      await sendNotificationEvent(
        "TASK_COMPLETED",
        task.id
      );
    }

    showMessage(
      progressMessage,
      newStatus === "HOAN_THANH"
        ? `â ÄÃ£ káº¿t thÃºc nhiá»m vá»¥. ${completionTimingInfo(task, updatePayload.completedAt).text}.`
        : "â ÄÃ£ cáº­p nháº­t tiáº¿n Äá» nhiá»m vá»¥.",
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
    console.error("KhÃ´ng cáº­p nháº­t ÄÆ°á»£c nhiá»m vá»¥:", error);

    showMessage(
      progressMessage,
      error?.message || "KhÃ´ng cáº­p nháº­t ÄÆ°á»£c nhiá»m vá»¥.",
      "error"
    );
  } finally {
    if (state.savingProgress) {
      state.savingProgress = false;
    }

    saveProgressButton.disabled = false;
    saveProgressButton.textContent = progressStatus.value === "HOAN_THANH"
      ? "â HoÃ n thÃ nh nhiá»m vá»¥"
      : "LÆ°u cáº­p nháº­t";
  }
}

/* =========================================================
 * KHá»I Táº O VÃ ÄÄNG NHáº¬P
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
      /*
       * KhÃ´ng ÄÄng nháº­p External ID vÃ o OneSignal táº¡i phÃ¢n há» nhiá»m vá»¥.
       * Chá» liÃªn káº¿t Subscription ID hiá»n táº¡i vá»i Firebase UID trong
       * collection taskPushSubscriptions.
       */
      await syncCurrentPushSubscription();
    } catch (pushError) {
      console.warn(
        "OneSignal chÆ°a sáºµn sÃ ng; á»©ng dá»¥ng váº«n tiáº¿p tá»¥c hoáº¡t Äá»ng:",
        pushError
      );
    }

    await loadTasks();
  } catch (error) {
    console.error("KhÃ´ng khá»i táº¡o ÄÆ°á»£c ngÆ°á»i dÃ¹ng:", error);

    state.initializedUid = null;

    try {
      await signOut(auth);
    } catch (signOutError) {
      console.error("KhÃ´ng thá» ÄÄng xuáº¥t:", signOutError);
    }

    showView("login");
    showMessage(
      loginMessage,
      error?.message || "KhÃ´ng khá»i táº¡o ÄÆ°á»£c tÃ i khoáº£n.",
      "error"
    );
  }
}

/* =========================================================
 * Sá»° KIá»N
 * ========================================================= */

googleLoginButton.addEventListener("click", async () => {
  hideMessage(loginMessage);

  googleLoginButton.disabled = true;
  googleLoginButton.innerHTML = "<span class=\"google-mark\">G</span><span>Äang má» Google...</span>";

  try {
    await signInWithPopup(auth, googleProvider);
  } catch (error) {
    console.error("KhÃ´ng ÄÄng nháº­p ÄÆ°á»£c báº±ng Google:", error);

    let message = "KhÃ´ng ÄÄng nháº­p ÄÆ°á»£c báº±ng Google. Vui lÃ²ng thá»­ láº¡i.";

    if (error?.code === "auth/popup-closed-by-user") {
      message = "Báº¡n ÄÃ£ ÄÃ³ng cá»­a sá» ÄÄng nháº­p Google trÆ°á»c khi hoÃ n táº¥t.";
    } else if (error?.code === "auth/popup-blocked") {
      message = "TrÃ¬nh duyá»t Äang cháº·n cá»­a sá» ÄÄng nháº­p Google. HÃ£y cho phÃ©p cá»­a sá» báº­t lÃªn rá»i thá»­ láº¡i.";
    } else if (error?.code === "auth/account-exists-with-different-credential") {
      message = "Email nÃ y Äang dÃ¹ng phÆ°Æ¡ng thá»©c Email/Máº­t kháº©u. HÃ£y ÄÄng nháº­p báº±ng máº­t kháº©u hiá»n táº¡i; khÃ´ng táº¡o thÃªm tÃ i khoáº£n trÃ¹ng email.";
    } else if (error?.code === "auth/unauthorized-domain") {
      message = "TÃªn miá»n GitHub Pages chÆ°a ÄÆ°á»£c thÃªm vÃ o Authorized domains cá»§a Firebase Authentication.";
    }

    showMessage(loginMessage, message, "error");
  } finally {
    googleLoginButton.disabled = false;
    googleLoginButton.innerHTML = "<span class=\"google-mark\">G</span><span>ÄÄng nháº­p báº±ng Google</span>";
  }
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideMessage(loginMessage);

  const email = cleanText(loginEmail.value).toLowerCase();
  const passwordValue = loginPassword.value;

  if (!email) {
    showMessage(loginMessage, "Vui lÃ²ng nháº­p email.", "error");
    loginEmail.focus();
    return;
  }

  if (!passwordValue) {
    showMessage(loginMessage, "Vui lÃ²ng nháº­p máº­t kháº©u.", "error");
    loginPassword.focus();
    return;
  }

  loginButton.disabled = true;
  loginButton.textContent = "Äang ÄÄng nháº­p...";

  try {
    await signInWithEmailAndPassword(auth, email, passwordValue);
  } catch (error) {
    const message = [
      "auth/invalid-credential",
      "auth/user-not-found",
      "auth/wrong-password"
    ].includes(error?.code)
      ? "Email hoáº·c máº­t kháº©u khÃ´ng chÃ­nh xÃ¡c."
      : (
        error?.code === "auth/too-many-requests"
          ? "ÄÄng nháº­p sai quÃ¡ nhiá»u láº§n. Vui lÃ²ng thá»­ láº¡i sau."
          : "KhÃ´ng ÄÄng nháº­p ÄÆ°á»£c. Vui lÃ²ng kiá»m tra láº¡i thÃ´ng tin."
      );

    showMessage(loginMessage, message, "error");
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = "ÄÄng nháº­p";
  }
});

togglePasswordButton.addEventListener("click", () => {
  const isHidden = loginPassword.type === "password";
  loginPassword.type = isHidden ? "text" : "password";
  togglePasswordButton.textContent = isHidden ? "ð" : "ð";
  togglePasswordButton.setAttribute(
    "aria-label",
    isHidden ? "áº¨n máº­t kháº©u" : "Hiá»n máº­t kháº©u"
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
  logoutButton.innerHTML = '<span aria-hidden="true">â³</span><span class="top-button-text">Äang ÄÄng xuáº¥t...</span>';

  /* Hiá»n thá» ngay mÃ n hÃ¬nh ÄÄng nháº­p, khÃ´ng giá»¯ ngÆ°á»i dÃ¹ng á» mÃ n hÃ¬nh táº£i. */
  showView("login");
  loginForm.reset();
  showMessage(loginMessage, "Äang káº¿t thÃºc phiÃªn ÄÄng nháº­p...", "info");
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
      "â ÄÃ£ ÄÄng xuáº¥t. Báº¡n cÃ³ thá» ÄÄng nháº­p báº±ng tÃ i khoáº£n khÃ¡c.",
      "success"
    );
    window.history.replaceState(null, "", "./");
  } catch (error) {
    console.error("KhÃ´ng ÄÄng xuáº¥t ÄÆ°á»£c:", error);
    resetSessionState();
    showMessage(
      loginMessage,
      "PhiÃªn trÃªn giao diá»n ÄÃ£ ÄÆ°á»£c ÄÃ³ng. HÃ£y kiá»m tra máº¡ng rá»i ÄÄng nháº­p tÃ i khoáº£n cáº§n sá»­ dá»¥ng.",
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
assignTaskButton.addEventListener("click", () => openAssignmentModal());
updateTaskButton.addEventListener("click", () => openProgressModal());
closeProgressButton.addEventListener("click", closeProgressModal);
cancelProgressButton.addEventListener("click", closeProgressModal);
closeAssignmentButton.addEventListener("click", closeAssignmentModal);
cancelAssignmentButton.addEventListener("click", closeAssignmentModal);
assignmentForm.addEventListener("submit", saveInternalAssignment);
progressForm.addEventListener("submit", saveProgress);
progressStatus.addEventListener("change", syncCompletionEvidenceUI);
completionProductType.addEventListener("change", syncCompletionEvidenceUI);
evidenceFileInput.addEventListener("change", updateEvidenceFileSelection);
completedDate.addEventListener("input", updateCompletionTimingPreview);

filterToggleButton.addEventListener("click", () => {
  const isOpen = filterFields.classList.toggle("open");
  filterToggleButton.setAttribute("aria-expanded", String(isOpen));
  filterToggleButton.textContent = isOpen ? "â ÄÃ³ng lá»c" : "ð Bá» lá»c";
});

searchInput.addEventListener("input", applyFilters);
statusFilter.addEventListener("change", applyFilters);
deadlineFilter.addEventListener("change", applyFilters);
departmentFilter.addEventListener("change", applyFilters);

primaryDepartmentId.addEventListener("change", () => {
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

progressModal.addEventListener("click", (event) => {
  if (event.target === progressModal) {
    closeProgressModal();
  }
});

assignmentModal.addEventListener("click", (event) => {
  if (event.target === assignmentModal) {
    closeAssignmentModal();
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

  if (!assignmentModal.classList.contains("hidden")) {
    closeAssignmentModal();
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
