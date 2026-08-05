import {
  auth,
  db
} from "./firebase-config.js?v=20260724.Prod2C";

import {
  NOTIFICATION_WEB_APP_URL
} from "./notification-config.js?v=20260724.Prod2C";

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
  onSnapshot,
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
  standardTasks: [],
  filteredStandardTasks: [],
  loadingStandardTasks: false,
  standardTasksLoaded: false,
  selectedStandardTaskId: null,
  currentModule: "TASKS",
  loadingTasks: false,
  savingTask: false,
  savingProgress: false,
  savingAssignment: false,
  savingSupport: false,
  deletingTask: false,
  editingTaskId: null,
  initializedUid: null,
  selectedSupportIds: new Set(),
  selectedTaskId: null,
  taskView: "ACTIVE",
  taskRealtimeUnsubscribers: [],
  taskRealtimeTimer: null
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

const tasksModuleTab = $("tasksModuleTab");
const standardTasksModuleTab = $("standardTasksModuleTab");
const kpiModuleTab = $("kpiModuleTab");
const kpiSection = $("kpiSection");
const taskModulePanels = Array.from(document.querySelectorAll(".task-module-panel"));
const standardTasksSection = $("standardTasksSection");
const standardTaskAccessNotice = $("standardTaskAccessNotice");
const standardTaskContent = $("standardTaskContent");
const refreshStandardTasksButton = $("refreshStandardTasksButton");
const standardTaskSearchInput = $("standardTaskSearchInput");
const standardTaskWorkTypeFilter = $("standardTaskWorkTypeFilter");
const standardTaskDepartmentFilterWrap = $("standardTaskDepartmentFilterWrap");
const standardTaskDepartmentFilter = $("standardTaskDepartmentFilter");
const resetStandardTaskFiltersButton = $("resetStandardTaskFiltersButton");
const standardTaskMetricTotal = $("standardTaskMetricTotal");
const standardTaskMetricRegular = $("standardTaskMetricRegular");
const standardTaskMetricUnexpected = $("standardTaskMetricUnexpected");
const standardTaskMetricAverage = $("standardTaskMetricAverage");
const standardTaskLastUpdated = $("standardTaskLastUpdated");
const standardTaskCount = $("standardTaskCount");
const standardTaskMessage = $("standardTaskMessage");
const standardTaskTableWrap = $("standardTaskTableWrap");
const standardTaskTableBody = $("standardTaskTableBody");
const standardTaskCardList = $("standardTaskCardList");
const standardTaskEmptyState = $("standardTaskEmptyState");
const standardTaskDetailModal = $("standardTaskDetailModal");
const standardTaskDetailCode = $("standardTaskDetailCode");
const standardTaskDetailTitle = $("standardTaskDetailTitle");
const standardTaskDetailContent = $("standardTaskDetailContent");
const standardTaskSelfRegisterButton = $("standardTaskSelfRegisterButton");
const standardTaskPendingAssignmentButton = $("standardTaskPendingAssignmentButton");
const standardTaskWorkflowHelp = $("standardTaskWorkflowHelp");
const closeStandardTaskDetailButton = $("closeStandardTaskDetailButton");
const closeStandardTaskDetailFooterButton = $("closeStandardTaskDetailFooterButton");

const metricTotal = $("metricTotal");
const metricCompleted = $("metricCompleted");
const metricProcessing = $("metricProcessing");
const metricWaiting = $("metricWaiting");
const metricOverdue = $("metricOverdue");
const metricPaused = $("metricPaused");

const searchInput = $("searchInput");
const statusFilter = $("statusFilter");
const deadlineFilter = $("deadlineFilter");
const departmentFilterWrap = $("departmentFilterWrap");
const departmentFilter = $("departmentFilter");
const dateFromFilter = $("dateFromFilter");
const dateToFilter = $("dateToFilter");
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
const activeTasksTab = $("activeTasksTab");
const archiveTasksTab = $("archiveTasksTab");
const activeTaskCount = $("activeTaskCount");
const archiveTaskCount = $("archiveTaskCount");
const taskListTitle = $("taskListTitle");
const taskListSubtitle = $("taskListSubtitle");
const emptyStateTitle = $("emptyStateTitle");
const emptyStateText = $("emptyStateText");

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
const standardTaskTemplateBanner = $("standardTaskTemplateBanner");

const taskTitle = $("taskTitle");
const taskDescription = $("taskDescription");
const sourceType = $("sourceType");
const sourceDetail = $("sourceDetail");
const assignedByUserId = $("assignedByUserId");
const priority = $("priority");
const primaryDepartmentId = $("primaryDepartmentId");
const teamId = $("teamId");
const teamHelp = $("teamHelp");
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
const editTaskButton = $("editTaskButton");
const updateTaskButton = $("updateTaskButton");
const assignTaskButton = $("assignTaskButton");
const supportTaskButton = $("supportTaskButton");
const deleteTaskButton = $("deleteTaskButton");

const supportEditModal = $("supportEditModal");
const supportEditForm = $("supportEditForm");
const supportEditTaskCode = $("supportEditTaskCode");
const supportEditSummary = $("supportEditSummary");
const supportEditOptions = $("supportEditOptions");
const supportEditMessage = $("supportEditMessage");
const closeSupportEditButton = $("closeSupportEditButton");
const cancelSupportEditButton = $("cancelSupportEditButton");
const saveSupportEditButton = $("saveSupportEditButton");

const deleteTaskModal = $("deleteTaskModal");
const deleteTaskForm = $("deleteTaskForm");
const deleteTaskCode = $("deleteTaskCode");
const deleteTaskSummary = $("deleteTaskSummary");
const deleteReason = $("deleteReason");
const deleteTaskMessage = $("deleteTaskMessage");
const closeDeleteTaskButton = $("closeDeleteTaskButton");
const cancelDeleteTaskButton = $("cancelDeleteTaskButton");
const confirmDeleteTaskButton = $("confirmDeleteTaskButton");

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
const progressMilestoneHelp = $("progressMilestoneHelp");
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
    !progressModal.classList.contains("hidden") ||
    !assignmentModal.classList.contains("hidden") ||
    !supportEditModal.classList.contains("hidden") ||
    !deleteTaskModal.classList.contains("hidden") ||
    !standardTaskDetailModal.classList.contains("hidden");

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
  state.standardTasks = [];
  state.filteredStandardTasks = [];
  state.standardTasksLoaded = false;
  state.selectedStandardTaskId = null;
  state.currentModule = "TASKS";
  state.departments = [];
  state.users = [];
  state.initializedUid = null;
  state.selectedTaskId = null;
  state.selectedSupportIds = new Set();
  state.taskView = "ACTIVE";

  /* Đóng giao diện theo cách an toàn khi phiên đã kết thúc. */
  taskModal?.classList.add("hidden");
  detailModal?.classList.add("hidden");
  progressModal?.classList.add("hidden");
  assignmentModal?.classList.add("hidden");
  supportEditModal?.classList.add("hidden");
  deleteTaskModal?.classList.add("hidden");
  standardTaskDetailModal?.classList.add("hidden");
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
    KHAN: "Khẩn",
    DOT_XUAT: "Đột xuất"
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
    FILE: "Tệp/hình ảnh đã tải lên",
    OTHER: "Minh chứng khác",

    /* Tương thích dữ liệu cũ. */
    LINK: "Đường dẫn liên kết",
    PDF: "Tệp PDF",
    IMAGE: "Hình ảnh",
    TEXT: "Nội dung nhập tay"
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


const DEPARTMENT_ID_ALIASES = Object.freeze({
  "BGD": "BGD",
  "BAN GIAM DOC": "BGD",
  "BAN GIÁM ĐỐC": "BGD",

  "TCHC": "TCHC",
  "PHONG TO CHUC HANH CHINH": "TCHC",
  "PHÒNG TỔ CHỨC HÀNH CHÍNH": "TCHC",
  "PHONG TO CHUC - HANH CHINH": "TCHC",
  "PHÒNG TỔ CHỨC - HÀNH CHÍNH": "TCHC",
  "PHONG TO CHUC – HANH CHINH": "TCHC",
  "PHÒNG TỔ CHỨC – HÀNH CHÍNH": "TCHC",

  "CTXH": "CTXH",
  "PHONG CONG TAC XA HOI": "CTXH",
  "PHÒNG CÔNG TÁC XÃ HỘI": "CTXH",

  "KHTC": "KHTC",
  "PHONG KE HOACH TAI CHINH": "KHTC",
  "PHÒNG KẾ HOẠCH TÀI CHÍNH": "KHTC",
  "PHONG KE HOACH - TAI CHINH": "KHTC",
  "PHÒNG KẾ HOẠCH - TÀI CHÍNH": "KHTC",
  "PHONG KE HOACH – TAI CHINH": "KHTC",
  "PHÒNG KẾ HOẠCH – TÀI CHÍNH": "KHTC",

  "YT": "YT",
  "PHONG Y TE": "YT",
  "PHÒNG Y TẾ": "YT",

  "KI": "KI",
  "KHU I": "KI",
  "KHU 1": "KI",

  "KII": "KII",
  "KHU II": "KII",
  "KHU 2": "KII",

  "KIII": "KIII",
  "KHU III": "KIII",
  "KHU 3": "KIII"
});

function departmentAliasKey(value) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function normalizeDepartmentId(value) {
  const raw = cleanText(value);

  if (!raw) {
    return "";
  }

  const direct = DEPARTMENT_ID_ALIASES[raw.toUpperCase()];
  if (direct) {
    return direct;
  }

  const normalized = DEPARTMENT_ID_ALIASES[departmentAliasKey(raw)];
  if (normalized) {
    return normalized;
  }

  const matchingDepartment = state.departments.find((item) => {
    const candidates = [
      item.id,
      item.code,
      item.name,
      item.departmentName
    ].filter(Boolean);

    return candidates.some(
      (candidate) => departmentAliasKey(candidate) === departmentAliasKey(raw)
    );
  });

  return matchingDepartment?.id || raw;
}


const TEAM_NAME_MAP = Object.freeze({
  BAO_VE: "Tổ bảo vệ",
  DIEN_NUOC: "Tổ điện nước",
  HO_SO: "Tổ hồ sơ",
  CHAM_SOC: "Tổ chăm sóc",
  VE_SINH: "Tổ vệ sinh"
});

function normalizeTeamId(value) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function teamName(value) {
  const id = normalizeTeamId(value);
  return TEAM_NAME_MAP[id] || id.replace(/_/g, " ") || "Không xác định";
}

function availableTeamIdsForDepartment(departmentId) {
  const department = normalizeDepartmentId(departmentId);

  return Array.from(new Set(
    state.users
      .filter((item) => (
        item.active === true
        && normalizeDepartmentId(item.departmentId) === department
        && normalizeTeamId(item.teamId)
      ))
      .map((item) => normalizeTeamId(item.teamId))
  )).sort((a, b) => teamName(a).localeCompare(teamName(b), "vi"));
}

function departmentIdVariants(value) {
  const canonical = normalizeDepartmentId(value);
  const variants = new Set([canonical]);

  state.departments.forEach((item) => {
    if (normalizeDepartmentId(item.id) === canonical) {
      [item.id, item.code, item.name, item.departmentName]
        .filter(Boolean)
        .forEach((candidate) => variants.add(cleanText(candidate)));
    }
  });

  Object.entries(DEPARTMENT_ID_ALIASES).forEach(([alias, id]) => {
    if (id === canonical) {
      variants.add(alias);
    }
  });

  return Array.from(variants).filter(Boolean);
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
    DOT_XUAT: "purple",
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
  const normalizedEmail = cleanText(user.email).toLowerCase();

  if (!normalizedEmail) {
    const error = new Error(
      "Tài khoản đăng nhập không cung cấp địa chỉ email."
    );
    error.code = "app/email-missing";
    throw error;
  }

  /*
   * accessAccounts là nguồn kiểm soát quyền truy cập chính.
   * Luôn kiểm tra collection này ở mọi lần đăng nhập, kể cả khi
   * users/{UID} đã tồn tại từ trước.
   */
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
  const normalizedDepartmentId = normalizeDepartmentId(accessData.departmentId);

  if (accessData.active !== true) {
    const error = new Error(
      "Tài khoản đã bị khóa hoặc ngừng hoạt động. Liên hệ Phòng Tổ chức – Hành chính."
    );
    error.code = "app/account-inactive";
    throw error;
  }

  if (
    !accessData.fullName ||
    !normalizedDepartmentId ||
    !accessData.role
  ) {
    const error = new Error(
      "Thông tin cấp quyền của tài khoản chưa đầy đủ."
    );
    error.code = "app/access-profile-incomplete";
    throw error;
  }

  const userReference = doc(db, "users", user.uid);
  const userSnapshot = await getDoc(userReference);

  const providerIds = user.providerData
    .map((provider) => provider.providerId)
    .filter(Boolean)
    .join(",");

  /*
   * Đồng bộ users/{UID} từ accessAccounts ở mỗi lần đăng nhập.
   * createdAt chỉ được tạo một lần cho tài khoản mới.
   */
  const profileToSave = {
    employeeCode: accessData.employeeCode || "",
    fullName: accessData.fullName,
    email: normalizedEmail,
    departmentId: normalizedDepartmentId,
    teamId: normalizeTeamId(accessData.teamId),
    position: accessData.position || "",
    role: accessData.role,
    kpiReviewerEmail: cleanText(accessData.kpiReviewerEmail).toLowerCase(),
    active: true,
    authProvider: providerIds || "unknown",
    updatedAt: serverTimestamp()
  };

  if (!userSnapshot.exists()) {
    profileToSave.createdAt = serverTimestamp();
  }

  await setDoc(
    userReference,
    profileToSave,
    { merge: true }
  );

  return {
    id: user.uid,
    ...(userSnapshot.exists() ? userSnapshot.data() : {}),
    ...profileToSave
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
    const data = item.data();
    state.users.push({
      id: item.id,
      ...data,
      departmentId: normalizeDepartmentId(data.departmentId),
      teamId: normalizeTeamId(data.teamId)
    });
  });
}


/* =========================================================
 * DANH MỤC CÔNG VIỆC CHUẨN — THỬ NGHIỆM CHỈ XEM
 * ========================================================= */

const STANDARD_TASK_PILOT = Object.freeze({
  enabled: true,
  mode: "VIEW_ONLY",
  allowedDepartmentIds: Object.freeze(["TCHC"]),
  allowedRoles: Object.freeze([
    "ADMIN",
    "DIRECTOR",
    "TCHC_COORDINATOR",
    "DEPARTMENT_LEADER",
    "STAFF"
  ])
});

function canOpenStandardTaskPilot() {
  if (
    !STANDARD_TASK_PILOT.enabled ||
    state.profile?.active !== true ||
    !STANDARD_TASK_PILOT.allowedRoles.includes(state.profile?.role)
  ) {
    return false;
  }

  if (["ADMIN", "DIRECTOR"].includes(state.profile.role)) {
    return true;
  }

  if (isTchcCoordinationAccount()) {
    return true;
  }

  return STANDARD_TASK_PILOT.allowedDepartmentIds.includes(
    normalizeDepartmentId(state.profile.departmentId)
  );
}

function canReadAllPilotStandardTasks() {
  return (
    ["ADMIN", "DIRECTOR"].includes(state.profile?.role) ||
    isTchcCoordinationAccount()
  );
}

function standardWorkTypeMeta(value) {
  const normalized = cleanText(value).toUpperCase();

  if (normalized === "DOT_XUAT") {
    return {
      text: "Đột xuất",
      className: "unexpected"
    };
  }

  return {
    text: "Thường xuyên",
    className: "regular"
  };
}

function formatStandardScore(value) {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return "—";
  }

  return new Intl.NumberFormat("vi-VN", {
    minimumFractionDigits: Number.isInteger(numberValue) ? 0 : 1,
    maximumFractionDigits: 1
  }).format(numberValue);
}

function configureStandardTaskPilotUI() {
  const hasAccess = canOpenStandardTaskPilot();
  const globalAccess = canReadAllPilotStandardTasks();

  standardTaskAccessNotice.classList.toggle("hidden", hasAccess);
  standardTaskContent.classList.toggle("hidden", !hasAccess);
  refreshStandardTasksButton.classList.toggle("hidden", !hasAccess);
  standardTaskDepartmentFilterWrap.classList.toggle("hidden", !globalAccess);

  fillStandardTaskDepartmentFilter();
}

function fillStandardTaskDepartmentFilter() {
  const oldValue = standardTaskDepartmentFilter.value || "ALL";
  standardTaskDepartmentFilter.innerHTML = '<option value="ALL">Tất cả Phòng/Khu</option>';

  state.departments
    .filter((item) => STANDARD_TASK_PILOT.allowedDepartmentIds.includes(
      normalizeDepartmentId(item.id)
    ))
    .forEach((item) => {
      const option = document.createElement("option");
      option.value = normalizeDepartmentId(item.id);
      option.textContent = item.name || item.code || item.id;
      standardTaskDepartmentFilter.appendChild(option);
    });

  standardTaskDepartmentFilter.value = Array.from(
    standardTaskDepartmentFilter.options
  ).some((option) => option.value === oldValue)
    ? oldValue
    : "ALL";
}

async function switchApplicationModule(moduleName) {
  const normalized = ["STANDARD_TASKS", "KPI"].includes(moduleName)
    ? moduleName
    : "TASKS";

  state.currentModule = normalized;
  const showTasks = normalized === "TASKS";
  const showStandardTasks = normalized === "STANDARD_TASKS";
  const showKpi = normalized === "KPI";

  taskModulePanels.forEach((panel) => {
    panel.classList.toggle("module-hidden", !showTasks);
  });

  standardTasksSection.classList.toggle("hidden", !showStandardTasks);
  kpiSection?.classList.toggle("hidden", !showKpi);
  tasksModuleTab.classList.toggle("active", showTasks);
  standardTasksModuleTab.classList.toggle("active", showStandardTasks);
  kpiModuleTab?.classList.toggle("active", showKpi);
  tasksModuleTab.setAttribute("aria-selected", String(showTasks));
  standardTasksModuleTab.setAttribute("aria-selected", String(showStandardTasks));
  kpiModuleTab?.setAttribute("aria-selected", String(showKpi));

  window.dispatchEvent(new CustomEvent(showKpi ? "kpi:open" : "kpi:hide"));

  if (showStandardTasks) {
    configureStandardTaskPilotUI();

    if (canOpenStandardTaskPilot() && !state.standardTasksLoaded) {
      await loadStandardTasks();
    }
  }
}

async function loadStandardTasks() {
  if (
    state.loadingStandardTasks ||
    !state.profile ||
    !canOpenStandardTaskPilot()
  ) {
    return;
  }

  state.loadingStandardTasks = true;
  refreshStandardTasksButton.disabled = true;
  refreshStandardTasksButton.textContent = "Đang tải...";
  hideMessage(standardTaskMessage);

  try {
    const standardTaskReference = collection(db, "standardTasks");
    let snapshot;

    if (canReadAllPilotStandardTasks()) {
      snapshot = await getDocsFromServer(standardTaskReference);
    } else {
      const departmentId = normalizeDepartmentId(state.profile.departmentId);

      snapshot = await getDocsFromServer(
        query(
          standardTaskReference,
          where("departmentId", "==", departmentId)
        )
      );
    }

    const items = [];

    snapshot.forEach((item) => {
      const data = item.data();
      const departmentId = normalizeDepartmentId(data.departmentId);

      if (
        data.active !== false &&
        STANDARD_TASK_PILOT.allowedDepartmentIds.includes(departmentId)
      ) {
        items.push({
          id: item.id,
          ...data,
          code: cleanText(data.code || item.id).toUpperCase(),
          departmentId
        });
      }
    });

    items.sort((a, b) => {
      const orderDifference = Number(a.order || 0) - Number(b.order || 0);

      if (orderDifference !== 0) {
        return orderDifference;
      }

      return String(a.code || "").localeCompare(String(b.code || ""), "vi");
    });

    state.standardTasks = items;
    state.standardTasksLoaded = true;
    standardTaskLastUpdated.textContent = `Cập nhật lúc ${formatDateTime()}`;
    applyStandardTaskFilters();
  } catch (error) {
    console.error("Không tải được danh mục công việc chuẩn:", error);
    state.standardTasks = [];
    state.filteredStandardTasks = [];
    renderStandardTasks([]);

    const message = ["permission-denied", "firestore/permission-denied"].includes(error?.code)
      ? "Firestore chưa cho phép đọc collection standardTasks. Hãy Publish Firestore Rules trong bộ cập nhật."
      : (error?.message || "Không tải được danh mục công việc chuẩn.");

    showMessage(standardTaskMessage, message, "error");
  } finally {
    state.loadingStandardTasks = false;
    refreshStandardTasksButton.disabled = false;
    refreshStandardTasksButton.textContent = "↻ Làm mới";
  }
}

function applyStandardTaskFilters() {
  const keyword = normalizeText(standardTaskSearchInput.value);
  const workType = standardTaskWorkTypeFilter.value;
  const departmentId = standardTaskDepartmentFilter.value;

  const filtered = state.standardTasks.filter((item) => {
    if (workType !== "ALL" && item.workType !== workType) {
      return false;
    }

    if (
      departmentId !== "ALL" &&
      normalizeDepartmentId(item.departmentId) !== departmentId
    ) {
      return false;
    }

    if (!keyword) {
      return true;
    }

    const searchable = normalizeText([
      item.code,
      item.name,
      item.outputRequirement,
      item.frequency,
      item.mandatoryEvidence,
      item.arisingEvidence,
      item.confirmer,
      departmentName(item.departmentId)
    ].join(" "));

    return searchable.includes(keyword);
  });

  state.filteredStandardTasks = filtered;
  renderStandardTasks(filtered);
}

function renderStandardTaskMetrics(items = state.standardTasks) {
  const source = Array.isArray(items) ? items : [];
  const regular = source.filter((item) => item.workType === "THUONG_XUYEN").length;
  const unexpected = source.filter((item) => item.workType === "DOT_XUAT").length;
  const maximumScores = source
    .map((item) => Number(item.maximumConvertedScore))
    .filter(Number.isFinite);
  const average = maximumScores.length
    ? maximumScores.reduce((sum, value) => sum + value, 0) / maximumScores.length
    : 0;

  standardTaskMetricTotal.textContent = String(source.length);
  standardTaskMetricRegular.textContent = String(regular);
  standardTaskMetricUnexpected.textContent = String(unexpected);
  standardTaskMetricAverage.textContent = formatStandardScore(average);
}

function renderStandardTasks(items) {
  const source = Array.isArray(items) ? items : [];
  renderStandardTaskMetrics(state.standardTasks);
  standardTaskCount.textContent = `${source.length} đầu việc`;

  const isEmpty = source.length === 0;
  standardTaskTableWrap.classList.toggle("hidden", isEmpty);
  standardTaskCardList.classList.toggle("hidden", isEmpty);
  standardTaskEmptyState.classList.toggle("hidden", !isEmpty);

  if (isEmpty) {
    standardTaskTableBody.innerHTML = "";
    standardTaskCardList.innerHTML = "";
    return;
  }

  standardTaskTableBody.innerHTML = source.map((item) => {
    const type = standardWorkTypeMeta(item.workType);

    return `
      <tr
        data-standard-task-id="${escapeHtml(item.id)}"
        tabindex="0"
        role="button"
        aria-label="Xem chi tiết ${escapeHtml(item.code)}"
      >
        <td><strong class="standard-task-code">${escapeHtml(item.code)}</strong></td>
        <td>
          <strong>${escapeHtml(item.name || "Chưa có tên")}</strong>
          <small>${escapeHtml(truncate(item.outputRequirement || "", 110))}</small>
        </td>
        <td>${escapeHtml(item.frequency || "—")}</td>
        <td><span class="standard-work-type ${type.className}">${type.text}</span></td>
        <td>${formatStandardScore(item.baseScore)}</td>
        <td>${formatStandardScore(item.difficultyCoefficient)}</td>
        <td><strong>${formatStandardScore(item.maximumConvertedScore)}</strong></td>
      </tr>
    `;
  }).join("");

  standardTaskCardList.innerHTML = source.map((item) => {
    const type = standardWorkTypeMeta(item.workType);

    return `
      <article
        class="standard-task-card"
        data-standard-task-id="${escapeHtml(item.id)}"
        tabindex="0"
        role="button"
        aria-label="Xem chi tiết ${escapeHtml(item.code)}"
      >
        <div class="standard-task-card-head">
          <strong class="standard-task-code">${escapeHtml(item.code)}</strong>
          <span class="standard-work-type ${type.className}">${type.text}</span>
        </div>
        <h3>${escapeHtml(item.name || "Chưa có tên")}</h3>
        <p>${escapeHtml(truncate(item.outputRequirement || "", 150))}</p>
        <div class="standard-task-score-grid">
          <div><span>Điểm chuẩn</span><strong>${formatStandardScore(item.baseScore)}</strong></div>
          <div><span>Hệ số</span><strong>${formatStandardScore(item.difficultyCoefficient)}</strong></div>
          <div><span>Điểm tối đa</span><strong>${formatStandardScore(item.maximumConvertedScore)}</strong></div>
        </div>
      </article>
    `;
  }).join("");
}

function findStandardTaskById(taskId) {
  return state.standardTasks.find((item) => item.id === taskId) || null;
}


function standardTaskWorkflowPermission(item, action) {
  if (!item || !state.user || !state.profile || item.active === false) {
    return false;
  }

  const sameDepartment =
    normalizeDepartmentId(item.departmentId) ===
    normalizeDepartmentId(state.profile.departmentId);

  if (!sameDepartment) {
    return false;
  }

  if (state.profile.role === "STAFF") {
    return action === "SELF_REGISTER";
  }

  if (state.profile.role === "DEPARTMENT_LEADER") {
    return ["SELF_REGISTER", "PENDING_ASSIGNMENT"].includes(action);
  }

  return false;
}

function currentStandardTaskWorkflowItem() {
  const context = state.standardTaskWorkflowContext;
  return context?.standardTaskId
    ? findStandardTaskById(context.standardTaskId)
    : null;
}

function clearStandardTaskWorkflowContext() {
  state.standardTaskWorkflowContext = null;

  if (standardTaskTemplateBanner) {
    standardTaskTemplateBanner.classList.add("hidden");
    standardTaskTemplateBanner.innerHTML = "";
  }
}

async function startStandardTaskWorkflow(action) {
  const item = findStandardTaskById(state.selectedStandardTaskId);

  if (!item || !standardTaskWorkflowPermission(item, action)) {
    return;
  }

  state.standardTaskWorkflowContext = {
    action,
    standardTaskId: item.id
  };

  closeStandardTaskDetail();
  await openTaskModal();
}

function renderStandardTaskTemplateBanner(item, action) {
  if (!standardTaskTemplateBanner || !item) {
    return;
  }

  const actionText = action === "SELF_REGISTER"
    ? "Đăng ký thực hiện"
    : "Tạo nhiệm vụ chờ phân công";

  standardTaskTemplateBanner.classList.remove("hidden");
  standardTaskTemplateBanner.innerHTML = `
    <div>
      <span>Đầu việc chuẩn</span>
      <strong>${escapeHtml(item.code || item.id)} — ${escapeHtml(item.name || "")}</strong>
    </div>
    <div class="standard-task-template-meta">
      <span>${escapeHtml(actionText)}</span>
      <span>Điểm chuẩn: <strong>${formatStandardScore(item.baseScore)}</strong></span>
      <span>Hệ số: <strong>${formatStandardScore(item.difficultyCoefficient)}</strong></span>
      <span>Điểm tối đa: <strong>${formatStandardScore(item.maximumConvertedScore)}</strong></span>
    </div>
  `;
}

function applyStandardTaskWorkflowContext() {
  const context = state.standardTaskWorkflowContext;
  const item = currentStandardTaskWorkflowItem();

  if (!context || !item) {
    return;
  }

  sourceType.value = item.workType === "DOT_XUAT" ? "DOT_XUAT" : "DINH_KY";
  sourceDetail.value = `Đăng ký từ danh mục công việc chuẩn ${item.code || item.id}`;
  priority.value = item.workType === "DOT_XUAT" ? "DOT_XUAT" : "THUONG";
  taskTitle.value = item.name || "";
  taskDescription.value = item.outputRequirement || item.name || "";

  const departmentId = normalizeDepartmentId(item.departmentId);
  if (departmentId) {
    primaryDepartmentId.value = departmentId;
  }

  renderStandardTaskTemplateBanner(item, context.action);

  taskTitle.readOnly = true;
  taskDescription.readOnly = false;
  sourceType.disabled = true;
  sourceDetail.readOnly = true;
  priority.disabled = item.workType === "DOT_XUAT";

  if (context.action === "SELF_REGISTER") {
    taskModalTitle.textContent = "✅ Đăng ký thực hiện đầu việc chuẩn";
    taskModalSubtitle.textContent =
      "Cá nhân đăng ký trực tiếp thực hiện đầu việc thuộc danh mục chuẩn; nhiệm vụ chỉ vào A sau khi được Trưởng/Phó phòng duyệt.";
    entryModeBanner.className = "entry-mode-banner entry-mode-self";
    entryModeBanner.innerHTML = `
      <strong>TỰ ĐĂNG KÝ THỰC HIỆN</strong>
      <span>Bạn là người thực hiện; sau khi hoàn thành sẽ gửi người có thẩm quyền xác nhận điểm thử nghiệm.</span>
    `;
    saveTaskButton.textContent = "Đăng ký thực hiện";
  } else {
    taskModalTitle.textContent = "📥 Tạo nhiệm vụ chờ phân công";
    taskModalSubtitle.textContent =
      "Tạo trước nhiệm vụ từ danh mục chuẩn. Khi có tài khoản viên chức, Trưởng/Phó phòng mở nhiệm vụ để phân công.";
    entryModeBanner.className = "entry-mode-banner entry-mode-direct";
    entryModeBanner.innerHTML = `
      <strong>CHỜ PHÂN CÔNG NỘI BỘ</strong>
      <span>Nhiệm vụ được lưu cho Phòng/Khu, chưa chỉ định cá nhân thực hiện.</span>
    `;
    saveTaskButton.textContent = "Lưu chờ phân công";
  }
}

function currentTemplateOwner() {
  const context = state.standardTaskWorkflowContext;

  if (context?.action !== "SELF_REGISTER") {
    return null;
  }

  return {
    id: state.user.uid,
    fullName: state.profile.fullName || "",
    position: state.profile.position || "",
    role: state.profile.role || "",
    departmentId: normalizeDepartmentId(state.profile.departmentId),
    active: true
  };
}

function openStandardTaskDetail(taskId) {
  const item = findStandardTaskById(taskId);

  if (!item) {
    return;
  }

  state.selectedStandardTaskId = item.id;
  const type = standardWorkTypeMeta(item.workType);

  standardTaskDetailCode.textContent = item.code || item.id;
  standardTaskDetailTitle.textContent = item.name || "Chi tiết đầu việc";
  standardTaskDetailContent.innerHTML = `
    <div class="standard-task-detail-score-panel">
      <div><span>Điểm chuẩn</span><strong>${formatStandardScore(item.baseScore)}</strong></div>
      <div><span>Hệ số khó</span><strong>${formatStandardScore(item.difficultyCoefficient)}</strong></div>
      <div><span>Điểm tối đa</span><strong>${formatStandardScore(item.maximumConvertedScore)}</strong></div>
      <div><span>Loại công việc</span><strong class="standard-work-type ${type.className}">${type.text}</strong></div>
    </div>

    <div class="standard-task-detail-grid">
      <section>
        <span>Phòng/Khu</span>
        <strong>${escapeHtml(departmentName(item.departmentId))}</strong>
      </section>
      <section>
        <span>Nhóm mã</span>
        <strong>${escapeHtml(item.categoryCode || "—")}</strong>
      </section>
      <section>
        <span>Tần suất</span>
        <strong>${escapeHtml(item.frequency || "—")}</strong>
      </section>
      <section>
        <span>Thứ tự</span>
        <strong>${escapeHtml(item.order ?? "—")}</strong>
      </section>
    </div>

    <div class="standard-task-detail-block">
      <h3>Kết quả/Sản phẩm đầu ra</h3>
      <p>${escapeHtml(item.outputRequirement || "Chưa khai báo")}</p>
    </div>

    <div class="standard-task-detail-block">
      <h3>Minh chứng bắt buộc</h3>
      <p>${escapeHtml(item.mandatoryEvidence || "Chưa khai báo")}</p>
    </div>

    <div class="standard-task-detail-block">
      <h3>Minh chứng phát sinh</h3>
      <p>${escapeHtml(item.arisingEvidence || "Không yêu cầu")}</p>
    </div>

    <div class="standard-task-detail-block">
      <h3>Người/Cấp xác nhận</h3>
      <p>${escapeHtml(item.confirmer || "Chưa khai báo")}</p>
    </div>

    ${item.note ? `
      <div class="standard-task-detail-block">
        <h3>Ghi chú</h3>
        <p>${escapeHtml(item.note)}</p>
      </div>
    ` : ""}
  `;

  const canSelfRegister = standardTaskWorkflowPermission(item, "SELF_REGISTER");
  const canCreatePending = standardTaskWorkflowPermission(item, "PENDING_ASSIGNMENT");

  standardTaskSelfRegisterButton?.classList.toggle("hidden", !canSelfRegister);
  standardTaskPendingAssignmentButton?.classList.toggle("hidden", !canCreatePending);

  if (standardTaskWorkflowHelp) {
    standardTaskWorkflowHelp.textContent = canSelfRegister || canCreatePending
      ? "Chọn hình thức thử nghiệm. Danh mục chuẩn không bị sửa đổi."
      : "Chế độ chỉ xem — dữ liệu quản trị tại Google Sheet.";
  }

  standardTaskDetailModal.classList.remove("hidden");
  setBodyModalState();
}

function closeStandardTaskDetail() {
  state.selectedStandardTaskId = null;
  standardTaskDetailModal.classList.add("hidden");
  setBodyModalState();
}

function handleStandardTaskOpenEvent(event) {
  const target = event.target.closest("[data-standard-task-id]");

  if (!target) {
    return;
  }

  openStandardTaskDetail(target.dataset.standardTaskId);
}

/* =========================================================
 * PHẠM VI THEO DÕI VÀ TỔNG HỢP
 * ========================================================= */

function isTchcCoordinationAccount() {
  return (
    normalizeDepartmentId(state.profile?.departmentId) === "TCHC"
    && ["ADMIN", "TCHC_COORDINATOR", "DEPARTMENT_LEADER"].includes(state.profile?.role)
  );
}

function canViewAllTasks() {
  return (
    ["ADMIN", "DIRECTOR"].includes(state.profile?.role)
    || isTchcCoordinationAccount()
  );
}

function canExportTaskReport() {
  return Boolean(
    state.profile?.active === true &&
    ["ADMIN", "DIRECTOR", "DEPARTMENT_LEADER"].includes(state.profile?.role)
  );
}

async function loadTasks() {
  if (state.loadingTasks || !state.profile) {
    return;
  }

  state.loadingTasks = true;
  refreshButton.disabled = true;
  refreshButton.classList.add("is-loading");
  refreshButton.setAttribute("aria-label", "Đang làm mới dữ liệu");
  refreshButton.title = "Đang làm mới dữ liệu";
  refreshButton.innerHTML = '<span class="refresh-icon" aria-hidden="true">↻</span>';
  hideMessage(dashboardMessage);

  try {
    const taskMap = new Map();

    const addSnapshotToMap = (snapshot) => {
      snapshot.forEach((item) => {
        const rawTask = item.data();
        const task = {
          id: item.id,
          ...rawTask,
          primaryDepartmentId: normalizeDepartmentId(rawTask.primaryDepartmentId),
          visibleDepartmentIds: (rawTask.visibleDepartmentIds || [])
            .map(normalizeDepartmentId)
            .filter(Boolean),
          supportDepartmentIds: (rawTask.supportDepartmentIds || [])
            .map(normalizeDepartmentId)
            .filter(Boolean),
          relatedDepartmentIds: (rawTask.relatedDepartmentIds || [])
            .map(normalizeDepartmentId)
            .filter(Boolean)
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
      const departmentId = normalizeDepartmentId(state.profile.departmentId);
      const departmentIds = departmentIdVariants(departmentId);
      const tasksRef = collection(db, "tasks");

      if (!departmentId) {
        throw new Error("Hồ sơ tài khoản chưa có mã Phòng/Khu.");
      }

      for (const queryDepartmentId of departmentIds) {
        try {
          const primarySnapshot = await getDocsFromServer(
            query(
              tasksRef,
              where("primaryDepartmentId", "==", queryDepartmentId)
            )
          );
          addSnapshotToMap(primarySnapshot);
        } catch (primaryError) {
          console.warn(
            `Chưa đọc được nhiệm vụ chính theo ${queryDepartmentId}:`,
            primaryError
          );
        }

        try {
          const visibleSnapshot = await getDocsFromServer(
            query(
              tasksRef,
              where("visibleDepartmentIds", "array-contains", queryDepartmentId)
            )
          );
          addSnapshotToMap(visibleSnapshot);
        } catch (visibleError) {
          console.warn(
            `Chưa đọc được nhiệm vụ phối hợp theo ${queryDepartmentId}:`,
            visibleError
          );
        }

        try {
          const supportSnapshot = await getDocsFromServer(
            query(
              tasksRef,
              where("supportDepartmentIds", "array-contains", queryDepartmentId)
            )
          );
          addSnapshotToMap(supportSnapshot);
        } catch (supportError) {
          console.warn(
            `Chưa đọc được nhiệm vụ cũ theo ${queryDepartmentId}:`,
            supportError
          );
        }
      }


    } else if (state.profile.role === "STAFF") {
      const tasksRef = collection(db, "tasks");

      /*
       * Nhân viên chỉ đọc nhiệm vụ được phân công trực tiếp.
       * Truy vấn ownerUserId là nguồn chính.
       */
      const ownerSnapshot = await getDocsFromServer(
        query(
          tasksRef,
          where("ownerUserId", "==", state.user.uid)
        )
      );
      addSnapshotToMap(ownerSnapshot);

      /*
       * Tương thích dữ liệu cũ hoặc nhiệm vụ đã thêm UID vào
       * visibleUserIds trước khi hoàn thiện ownerUserId.
       */
      try {
        const visibleUserSnapshot = await getDocsFromServer(
          query(
            tasksRef,
            where("visibleUserIds", "array-contains", state.user.uid)
          )
        );
        addSnapshotToMap(visibleUserSnapshot);
      } catch (visibleUserError) {
        console.warn(
          "Chưa đọc được nhiệm vụ theo visibleUserIds:",
          visibleUserError
        );
      }

    } else {
      throw new Error("Vai trò tài khoản chưa được cấp quyền xem nhiệm vụ.");
    }

    state.tasks = Array.from(taskMap.values());

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

    let message = error?.message || "Không tải được dữ liệu nhiệm vụ.";

    if (
      error?.code === "permission-denied" ||
      error?.code === "firestore/permission-denied"
    ) {
      message = "Firestore đang từ chối truy vấn nhiệm vụ. Hãy kiểm tra Rules Bước 2 đã Publish thành công.";
    }

    showMessage(dashboardMessage, message, "error");

  } finally {
    state.loadingTasks = false;
    refreshButton.disabled = false;
    refreshButton.classList.remove("is-loading");
    refreshButton.setAttribute("aria-label", "Làm mới dữ liệu");
    refreshButton.title = "Làm mới dữ liệu";
    refreshButton.innerHTML = '<span class="refresh-icon" aria-hidden="true">↻</span>';
  }
}


function stopTaskRealtimeListeners() {
  state.taskRealtimeUnsubscribers.forEach((unsubscribe) => {
    try {
      unsubscribe();
    } catch (error) {
      console.warn("Không thể dừng bộ đồng bộ thời gian thực:", error);
    }
  });

  state.taskRealtimeUnsubscribers = [];

  if (state.taskRealtimeTimer) {
    window.clearTimeout(state.taskRealtimeTimer);
    state.taskRealtimeTimer = null;
  }
}

function scheduleRealtimeTaskRefresh() {
  if (state.taskRealtimeTimer) {
    window.clearTimeout(state.taskRealtimeTimer);
  }

  state.taskRealtimeTimer = window.setTimeout(async () => {
    state.taskRealtimeTimer = null;

    if (!state.user || !state.profile || state.loadingTasks) {
      return;
    }

    await loadTasks();
  }, 350);
}

function realtimeTaskQueries() {
  const tasksRef = collection(db, "tasks");

  if (canViewAllTasks()) {
    return [tasksRef];
  }

  if (state.profile?.role === "DEPARTMENT_LEADER") {
    const departmentIds = departmentIdVariants(state.profile.departmentId);
    const queries = [];

    departmentIds.forEach((departmentId) => {
      queries.push(
        query(tasksRef, where("primaryDepartmentId", "==", departmentId)),
        query(tasksRef, where("visibleDepartmentIds", "array-contains", departmentId)),
        query(tasksRef, where("supportDepartmentIds", "array-contains", departmentId))
      );
    });

    return queries;
  }

  if (state.profile?.role === "STAFF") {
    return [
      query(tasksRef, where("ownerUserId", "==", state.user.uid)),
      query(tasksRef, where("visibleUserIds", "array-contains", state.user.uid))
    ];
  }

  return [];
}

function startTaskRealtimeListeners() {
  stopTaskRealtimeListeners();

  const uniqueQueries = realtimeTaskQueries();

  uniqueQueries.forEach((taskQuery) => {
    const unsubscribe = onSnapshot(
      taskQuery,
      () => {
        scheduleRealtimeTaskRefresh();
      },
      (error) => {
        console.warn(
          "Đồng bộ nhiệm vụ thời gian thực tạm thời không hoạt động:",
          error
        );
      }
    );

    state.taskRealtimeUnsubscribers.push(unsubscribe);
  });
}

/* =========================================================
 * TÀI KHOẢN VÀ BỘ LỌC
 * ========================================================= */

function accountPositionTitle() {
  const position = cleanText(state.profile?.position);

  if (position) {
    return position;
  }

  if (state.profile?.role === "ADMIN") {
    return "Quản trị hệ thống";
  }

  if (state.profile?.role === "DIRECTOR") {
    return "Ban Giám đốc";
  }

  return roleName(state.profile?.role);
}

function renderAccount() {
  welcomeName.textContent = `Xin chào, ${state.profile.fullName}`;
  welcomeDepartment.textContent = [
    accountPositionTitle(),
    departmentName(state.profile.departmentId)
  ].filter(Boolean).join(" • ");

  roleBadge.innerHTML = `
    ${escapeHtml(accountPositionTitle())}
    <span>${escapeHtml(state.profile.email || state.user.email || "")}</span>
  `;

  const canCreateTask = [
    "ADMIN",
    "DIRECTOR",
    "DEPARTMENT_LEADER"
  ].includes(state.profile.role);

  addTaskButton.classList.toggle("hidden", !canCreateTask);

  if (state.profile.role === "DEPARTMENT_LEADER") {
    addTaskButton.textContent = "➕ Ghi nhận";
  } else if (state.profile.role === "DIRECTOR") {
    addTaskButton.textContent = "⚡ Giao trực tiếp";
  } else {
    addTaskButton.textContent = "⚡ Tạo nhiệm vụ";
  }

  const hasOverviewAccess = canViewAllTasks();
  departmentFilterWrap.classList.toggle("hidden", !hasOverviewAccess);
  exportReportButton?.classList.toggle("hidden", !canExportTaskReport());

  if (isTchcCoordinationAccount()) {
    welcomeDepartment.textContent = [
      accountPositionTitle(),
      departmentName(state.profile.departmentId),
      "Đầu mối theo dõi, tổng hợp nhiệm vụ toàn Trung tâm"
    ].filter(Boolean).join(" • ");
  }

  fillDepartmentFilter();
  configureStandardTaskPilotUI();
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

function renderMetrics(tasks = state.tasks) {
  const source = Array.isArray(tasks) ? tasks : [];

  const completed = source.filter((task) => task.status === "HOAN_THANH").length;

  const processing = source.filter((task) => [
    "MOI_TIEP_NHAN",
    "DANG_THUC_HIEN"
  ].includes(task.status)).length;

  const waiting = source.filter((task) => task.status === "CHO_PHOI_HOP").length;
  const paused = source.filter((task) => task.status === "TAM_DUNG").length;

  const overdue = source.filter((task) => (
    task.status !== "HOAN_THANH" &&
    task.status !== "HUY" &&
    deadlineState(task).code === "OVERDUE"
  )).length;

  metricTotal.textContent = String(source.length);
  metricCompleted.textContent = String(completed);
  metricProcessing.textContent = String(processing);
  metricWaiting.textContent = String(waiting);
  metricOverdue.textContent = String(overdue);
  metricPaused.textContent = String(paused);

  const activeCount = state.tasks.filter((task) => task.status !== "HOAN_THANH").length;
  const archiveCount = state.tasks.filter((task) => task.status === "HOAN_THANH").length;
  activeTaskCount.textContent = String(activeCount);
  archiveTaskCount.textContent = String(archiveCount);
}

function taskAssignedDate(task) {
  return toDate(task.assignedAt) || toDate(task.sourceDate) || toDate(task.createdAt);
}

function applyFilters() {
  const keyword = normalizeText(searchInput.value);
  const selectedStatus = statusFilter.value;
  const selectedDeadline = deadlineFilter.value;
  const selectedDepartment = departmentFilter.value || "ALL";
  const fromDate = parseDateInput(dateFromFilter?.value || "", false);
  const toDateValue = parseDateInput(dateToFilter?.value || "", true);

  if (fromDate && toDateValue && fromDate.getTime() > toDateValue.getTime()) {
    showMessage(
      dashboardMessage,
      "Ngày bắt đầu không được sau ngày kết thúc.",
      "warning"
    );
    state.filteredTasks = [];
    renderMetrics([]);
    renderTasks([]);
    return;
  }

  hideMessage(dashboardMessage);

  const scopeTasks = state.tasks.filter((task) => {
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

    const assignedDateValue = taskAssignedDate(task);
    const matchesFromDate = !fromDate || (
      assignedDateValue && assignedDateValue.getTime() >= fromDate.getTime()
    );
    const matchesToDate = !toDateValue || (
      assignedDateValue && assignedDateValue.getTime() <= toDateValue.getTime()
    );

    return (
      matchesKeyword &&
      matchesStatus &&
      matchesDeadline &&
      matchesDepartment &&
      matchesFromDate &&
      matchesToDate
    );
  });

  const filteredTasks = scopeTasks.filter((task) => (
    state.taskView === "ARCHIVE"
      ? task.status === "HOAN_THANH"
      : task.status !== "HOAN_THANH"
  ));

  renderMetrics(scopeTasks);
  state.filteredTasks = filteredTasks;
  renderTasks(filteredTasks);
}

/* =========================================================
 * XUẤT BÁO CÁO NHIỆM VỤ — A4 NGANG
 * ========================================================= */

function reportTaskStatusName(task) {
  const due = deadlineState(task);

  if (task.status === "HOAN_THANH") {
    const timing = completionTimingInfo(task);

    if (timing.code === "EARLY") {
      return `Hoàn thành sớm ${Math.abs(Number(timing.days) || 0)} ngày`;
    }

    return timing.text;
  }

  if (task.status === "HUY") {
    return "Đã hủy";
  }

  if (task.status === "TAM_DUNG") {
    return due.code === "OVERDUE"
      ? `Tạm dừng — ${due.text}`
      : "Tạm dừng";
  }

  const statusMap = {
    MOI_TIEP_NHAN: "Chưa thực hiện",
    DANG_THUC_HIEN: "Đang thực hiện",
    CHO_PHOI_HOP: "Chờ phối hợp"
  };

  const statusText = statusMap[task.status] || statusName(task.status);

  if (due.code === "OVERDUE" || due.code === "DUE_TODAY" || due.code === "UPCOMING") {
    return `${statusText} — ${due.text}`;
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
  if (!canViewAllTasks()) {
    return departmentName(state.profile?.departmentId);
  }

  const selectedDepartment = departmentFilter?.value || "ALL";

  return selectedDepartment === "ALL"
    ? "Toàn Trung tâm"
    : departmentName(selectedDepartment);
}

function exportTaskReport() {
  if (!canExportTaskReport()) {
    showMessage(
      dashboardMessage,
      "Tài khoản không có quyền xuất báo cáo tổng hợp.",
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
      "Không có nhiệm vụ trong bộ lọc hiện tại để xuất báo cáo.",
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
      "Trình duyệt đang chặn cửa sổ báo cáo. Hãy cho phép cửa sổ bật lên rồi thử lại.",
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
  const exportUnitText = state.profile?.role === "DIRECTOR"
    ? "BAN GIÁM ĐỐC"
    : departmentName(state.profile?.departmentId).toUpperCase();

  const reportRows = tasksToExport.map((task, index) => {
    const progressValue = Math.max(0, Math.min(100, Number(task.progress) || 0));

    const descriptionHtml = task.description
      ? `<div class="task-description">${escapeHtml(task.description)}</div>`
      : "";

    const resultText = task.status === "HOAN_THANH"
      ? (task.resultSummary || task.result || "—")
      : "—";

    return `
      <tr>
        <td class="column-stt">${index + 1}</td>

        <td class="column-task">
          <strong class="task-title">${escapeHtml(task.title || "Nhiệm vụ chưa có tiêu đề")}</strong>
          ${descriptionHtml}
        </td>

        <td class="column-department">${escapeHtml(departmentName(task.primaryDepartmentId))}</td>
        <td class="column-owner">${escapeHtml(task.ownerName || "Chờ phân công nội bộ")}</td>
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
        <button type="button" onclick="window.print()">In / Lưu thành PDF</button>
        <button type="button" class="secondary" onclick="window.close()">Đóng báo cáo</button>
      </div>

      <main class="report-page">
        <p class="agency-name">Trung tâm Bảo trợ xã hội Tân Hiệp</p>
        <div class="agency-line"></div>

        <h1 class="report-heading">Báo cáo theo dõi thực hiện nhiệm vụ</h1>
        <p class="report-subheading">Dữ liệu được tổng hợp tại thời điểm xuất báo cáo</p>

        <section class="report-information">
          <div>
            <strong>Đơn vị xuất báo cáo:</strong>
            ${escapeHtml(exportUnitText)}
          </div>

          <div>
            <strong>Thời điểm xuất:</strong>
            ${escapeHtml(formatDateTime(now))}
          </div>

          <div>
            <strong>Phạm vi báo cáo:</strong>
            ${escapeHtml(scopeText)}
          </div>

          <div>
            <strong>Số nhiệm vụ:</strong>
            ${totalCount} nhiệm vụ
          </div>
        </section>

        <section class="summary-grid">
          <div class="summary-card">
            <span>Tổng nhiệm vụ</span>
            <strong>${totalCount}</strong>
          </div>

          <div class="summary-card completed">
            <span>Đã hoàn thành</span>
            <strong>${completedCount}</strong>
          </div>

          <div class="summary-card">
            <span>Đang theo dõi</span>
            <strong>${processingCount}</strong>
          </div>

          <div class="summary-card overdue">
            <span>Quá hạn</span>
            <strong>${overdueCount}</strong>
          </div>
        </section>

        <div class="report-table-wrap">
          <table>
            <thead>
              <tr>
                <th class="column-stt">STT</th>
                <th class="column-task">Nội dung nhiệm vụ</th>
                <th class="column-department">Phòng/Khu</th>
                <th class="column-owner">Người phụ trách</th>
                <th class="column-deadline">Hạn hoàn thành</th>
                <th class="column-progress">Tiến độ</th>
                <th class="column-status">Tình trạng</th>
                <th class="column-result">Kết quả thực hiện</th>
              </tr>
            </thead>
            <tbody>${reportRows}</tbody>
          </table>
        </div>

        <footer class="report-footer">
          <div class="footer-note">
            Báo cáo được tạo tự động từ Hệ thống Quản lý nhiệm vụ
            của Trung tâm Bảo trợ xã hội Tân Hiệp.
          </div>

          <div class="signature-block">
            <strong>${escapeHtml(exportUnitText)}</strong>
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
      console.warn("Không tự mở được hộp thoại in:", error);
    }
  }, 700);

  showMessage(
    dashboardMessage,
    `✅ Đã tạo báo cáo A4 ngang gồm ${totalCount} nhiệm vụ. Chọn “Lưu thành PDF” trong cửa sổ in.`,
    "success"
  );
}

/* =========================================================
 * HIỂN THỊ DANH SÁCH
 * ========================================================= */

function renderTasks(tasks) {
  const isArchive = state.taskView === "ARCHIVE";

  taskCount.textContent = `${tasks.length} nhiệm vụ`;
  taskListTitle.textContent = isArchive
    ? "Lưu trữ nhiệm vụ hoàn thành"
    : "Danh sách nhiệm vụ";
  taskListSubtitle.textContent = isArchive
    ? "Các nhiệm vụ đã hoàn thành được lưu riêng để tra cứu và báo cáo."
    : "Danh sách các nhiệm vụ đang được giao, theo dõi hoặc chờ xử lý.";
  emptyStateTitle.textContent = isArchive
    ? "Chưa có nhiệm vụ hoàn thành"
    : "Chưa có nhiệm vụ đang xử lý";
  emptyStateText.textContent = isArchive
    ? "Nhiệm vụ sẽ tự động chuyển vào đây sau khi được cập nhật hoàn thành."
    : "Những nhiệm vụ mới được giao hoặc đang thực hiện sẽ hiển thị tại đây.";

  activeTasksTab.classList.toggle("active", !isArchive);
  archiveTasksTab.classList.toggle("active", isArchive);
  activeTasksTab.setAttribute("aria-selected", String(!isArchive));
  archiveTasksTab.setAttribute("aria-selected", String(isArchive));

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
        <td>${escapeHtml(task.ownerName || "Chờ phân công nội bộ")}</td>
        <td>
          <strong>${escapeHtml(formatDate(task.deadline))}</strong><br>
          <span class="badge ${due.className}">${escapeHtml(due.text)}</span>
        </td>
        <td>
          <span class="badge ${statusBadgeClass(task.status)}">
            ${escapeHtml(statusName(task.status))}
          </span>
        </td>
        <td>
          <div class="task-progress-cell">
            <strong>${Math.max(0, Math.min(100, Number(task.progress) || 0))}%</strong>
            <span class="task-progress-track" aria-hidden="true">
              <span style="width:${Math.max(0, Math.min(100, Number(task.progress) || 0))}%"></span>
            </span>
          </div>
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
            <strong>${escapeHtml(task.ownerName || "Chờ phân công nội bộ")}</strong>
          </div>
          <div>
            <span>Hạn hoàn thành</span>
            <strong>${escapeHtml(formatDate(task.deadline))}</strong>
          </div>
          <div>
            <span>Tình trạng hạn</span>
            <strong class="badge ${due.className}">${escapeHtml(due.text)}</strong>
          </div>
          <div class="task-mobile-progress">
            <span>Tiến độ</span>
            <strong>${Math.max(0, Math.min(100, Number(task.progress) || 0))}%</strong>
            <span class="task-progress-track" aria-hidden="true">
              <span style="width:${Math.max(0, Math.min(100, Number(task.progress) || 0))}%"></span>
            </span>
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
    normalizeDepartmentId(task.primaryDepartmentId) === normalizeDepartmentId(state.profile.departmentId) &&
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
   * Sau khi phân công nội bộ, Trưởng/Phó được giao trực tiếp
   * mới cập nhật tiến độ và kết quả nhiệm vụ.
   */
  if (
    state.profile.role === "DEPARTMENT_LEADER" &&
    normalizeDepartmentId(task.primaryDepartmentId) === normalizeDepartmentId(state.profile.departmentId)
  ) {
    return task.ownerUserId === state.user.uid;
  }

  if (state.profile.role === "STAFF") {
    return task.ownerUserId === state.user.uid;
  }

  return (
    state.profile.role === "DIRECTOR" &&
    task.entryMode === "DIRECT_ASSIGNED" &&
    task.assignedByUserId === state.user.uid
  );
}


function canEditTaskSupport(task) {
  if (!task || !state.user || !state.profile || task.active === false) {
    return false;
  }

  if (state.profile.role === "ADMIN") {
    return true;
  }

  if (
    state.profile.role === "DIRECTOR" &&
    task.entryMode === "DIRECT_ASSIGNED"
  ) {
    return true;
  }

  return (
    state.profile.role === "DEPARTMENT_LEADER" &&
    normalizeDepartmentId(task.primaryDepartmentId) === normalizeDepartmentId(state.profile.departmentId) &&
    task.status !== "HUY"
  );
}

function canDeleteTask(task) {
  if (!task || !state.user || !state.profile || task.active === false) {
    return false;
  }

  if (state.profile.role === "ADMIN") {
    return true;
  }

  if (task.entryMode === "DIRECT_ASSIGNED") {
    return state.profile.role === "DIRECTOR";
  }

  return (
    task.entryMode === "SELF_RECORDED" &&
    state.profile.role === "DEPARTMENT_LEADER" &&
    normalizeDepartmentId(task.primaryDepartmentId) === normalizeDepartmentId(state.profile.departmentId)
  );
}

function resultEvidenceHtml(task) {
  const evidenceType = task.evidenceType || task.outputType || "NONE";
  const evidenceUrl = task.evidenceUrl || task.evidenceLink || "";
  const evidenceText = task.evidenceText || task.outputDescription || "";
  const fileName = task.evidenceFileName || "Mở tệp minh chứng";

  const isFileEvidence = ["FILE", "LINK", "PDF", "IMAGE"].includes(evidenceType);
  const isOtherEvidence = ["OTHER", "TEXT"].includes(evidenceType);

  let optionalContent = "";

  if (isOtherEvidence) {
    optionalContent = `
      <div class="result-card-item result-span-2">
        <span>Kết quả thực hiện</span>
        <strong>${escapeHtml(task.resultSummary || task.result || evidenceText || "Chưa ghi nhận")}</strong>
      </div>
    `;
  } else if (isFileEvidence) {
    const evidenceContent = evidenceUrl && isValidHttpUrl(evidenceUrl)
      ? `
        <a class="evidence-open-link" href="${escapeHtml(evidenceUrl)}" target="_blank" rel="noopener noreferrer">
          📎 ${escapeHtml(fileName)}
        </a>
      `
      : "Chưa ghi nhận tệp minh chứng";

    optionalContent = `
      <div class="result-card-item result-span-2">
        <span>Tệp/hình ảnh minh chứng</span>
        <strong>${evidenceContent}</strong>
      </div>
    `;
  }

  return `
    <div class="result-card">
      <h4>✅ Kết quả hoàn thành</h4>
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
          <span>Loại minh chứng</span>
          <strong>${escapeHtml(evidenceTypeName(evidenceType))}</strong>
        </div>
        ${optionalContent}
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
    : "Không có";

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
        <span>Trạng thái phân công nội bộ</span>
        <strong>${escapeHtml(
          task.ownerName
            ? `Đã phân công: ${task.ownerName}`
            : "Chờ Phòng/Khu phân công"
        )}</strong>
      </div>
      <div class="detail-item">
        <span>Phòng/Khu</span>
        <strong>${escapeHtml(departmentName(task.primaryDepartmentId))}</strong>
      </div>
      <div class="detail-item">
        <span>Tổ/Bộ phận</span>
        <strong>${escapeHtml(task.teamId ? teamName(task.teamId) : "Không chỉ định")}</strong>
      </div>
      <div class="detail-item detail-span-2">
        <span>Phòng/Khu phối hợp</span>
        <strong>${escapeHtml(relatedDepartmentsText)}</strong>
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

  const allowEditDefinition = canEditTaskDefinition(task);
  const allowAssign = canAssignTask(task);
  const allowUpdate = canUpdateTask(task);
  const allowSupportEdit = canEditTaskSupport(task);
  const allowDelete = canDeleteTask(task);

  detailFooter.classList.toggle(
    "hidden",
    !allowEditDefinition && !allowAssign && !allowUpdate && !allowSupportEdit && !allowDelete
  );

  editTaskButton.classList.toggle("hidden", !allowEditDefinition);
  assignTaskButton.classList.toggle("hidden", !allowAssign);
  assignTaskButton.textContent = task.ownerUserId
    ? "👤 Phân công lại"
    : "👤 Phân công nội bộ";

  updateTaskButton.classList.toggle("hidden", !allowUpdate);
  updateTaskButton.textContent = task.status === "HOAN_THANH"
    ? "✏️ Chỉnh sửa kết quả hoàn thành"
    : "✏️ Cập nhật / Kết thúc nhiệm vụ";

  supportTaskButton.classList.toggle("hidden", !allowSupportEdit);
  deleteTaskButton.classList.toggle("hidden", !allowDelete);

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

  if (state.editingTaskId || state.standardTaskWorkflowContext) {
    return;
  }

  const selfRecorded = mode === "SELF_RECORDED";

  taskModalTitle.textContent = selfRecorded
    ? "➕ Ghi nhận nhiệm vụ"
    : "⚡ Giao nhiệm vụ trực tiếp";

  taskModalSubtitle.textContent = selfRecorded
    ? "Ghi nhận nhiệm vụ đã được Ban Giám đốc chỉ đạo tại cuộc họp, văn bản hoặc trực tiếp."
    : "Ban Giám đốc giao Phòng/Khu và có thể chỉ định người thực hiện ngay.";

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
      <span>Chọn Phòng/Khu chịu trách nhiệm; có thể chọn thêm Tổ/Bộ phận và người thực hiện.</span>
    `;

  saveTaskButton.textContent = selfRecorded
    ? "Lưu ghi nhận"
    : "Giao nhiệm vụ";
}

function fillAssignedByOptions() {
  if (state.standardTaskWorkflowContext && state.user && state.profile) {
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
  if (!primaryDepartmentId) {
    return;
  }

  const wrapper = primaryDepartmentId.closest(".system-hidden-fields, .field-block");
  const directAssignment = currentEntryMode() === "DIRECT_ASSIGNED";

  if (wrapper) {
    wrapper.classList.toggle("system-hidden-fields", !directAssignment);
    wrapper.classList.toggle("field-block", directAssignment);
    wrapper.classList.toggle("form-span-2", directAssignment);
    wrapper.setAttribute("aria-hidden", directAssignment ? "false" : "true");

    let label = wrapper.querySelector('label[for="primaryDepartmentId"]');

    if (directAssignment && !label) {
      label = document.createElement("label");
      label.setAttribute("for", "primaryDepartmentId");
      label.innerHTML = 'Phòng/Khu chịu trách nhiệm chính <span>*</span>';
      wrapper.insertBefore(label, primaryDepartmentId);
    }
  }

  primaryDepartmentId.innerHTML = "";

  if (currentEntryMode() === "SELF_RECORDED") {
    const primaryId = normalizeDepartmentId(state.profile?.departmentId);
    const option = document.createElement("option");
    option.value = primaryId;
    option.textContent = departmentName(primaryId);
    primaryDepartmentId.appendChild(option);
    primaryDepartmentId.value = primaryId;
    primaryDepartmentId.disabled = false;

    if (primaryHelp) {
      primaryHelp.textContent = "Phòng/Khu chính được xác định tự động theo tài khoản đăng nhập.";
    }
    return;
  }

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Chọn Phòng/Khu chịu trách nhiệm";
  primaryDepartmentId.appendChild(placeholder);

  state.departments
    .filter((item) => item.id !== "BGD")
    .forEach((item) => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.name || item.code || item.id;
      primaryDepartmentId.appendChild(option);
    });

  primaryDepartmentId.disabled = false;

  if (primaryHelp) {
    primaryHelp.textContent = "Chọn Phòng/Khu tiếp nhận và chịu trách nhiệm chính.";
  }
}

function fillTeamOptions(selectedValue = "") {
  if (!teamId) {
    return;
  }

  const directAssignment = currentEntryMode() === "DIRECT_ASSIGNED";
  const wrapper = teamId.closest(".field-block");
  if (wrapper) {
    wrapper.classList.toggle("hidden", !directAssignment);
  }

  const department = normalizeDepartmentId(primaryDepartmentId?.value);
  const teamIds = availableTeamIdsForDepartment(department);
  const selected = normalizeTeamId(selectedValue || teamId.value);

  teamId.innerHTML = '<option value="">Không chỉ định Tổ/Bộ phận</option>';

  teamIds.forEach((id) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = teamName(id);
    teamId.appendChild(option);
  });

  if (selected && teamIds.includes(selected)) {
    teamId.value = selected;
  }

  teamId.disabled = currentEntryMode() !== "DIRECT_ASSIGNED" || !department;

  if (teamHelp) {
    teamHelp.textContent = teamIds.length
      ? "Có thể chọn Tổ/Bộ phận để lọc danh sách người thực hiện."
      : "Phòng/Khu này chưa có nhân sự được khai báo teamId trong Google Sheet.";
  }
}

function fillOwnerOptions(selectedValue = "") {
  if (!ownerUserId) {
    return;
  }

  const directAssignment = currentEntryMode() === "DIRECT_ASSIGNED";
  const wrapper = ownerUserId.closest(".field-block");
  if (wrapper) {
    wrapper.classList.toggle("hidden", !directAssignment);
  }

  const department = normalizeDepartmentId(primaryDepartmentId?.value);
  const selectedTeam = normalizeTeamId(teamId?.value);
  const selectedOwner = cleanText(selectedValue || ownerUserId.value);

  ownerUserId.innerHTML = '<option value="">Chưa chỉ định — Phòng/Khu phân công sau</option>';

  if (!directAssignment || !department) {
    ownerUserId.disabled = true;

    if (ownerHelp) {
      ownerHelp.textContent =
        "Nhiệm vụ tự ghi nhận không chỉ định cá nhân tại biểu mẫu này.";
    }
    return;
  }

  const assignees = state.users
    .filter((item) => (
      item.active === true
      && ["DEPARTMENT_LEADER", "STAFF"].includes(item.role)
      && normalizeDepartmentId(item.departmentId) === department
      && (!selectedTeam || normalizeTeamId(item.teamId) === selectedTeam)
    ))
    .sort((a, b) => String(a.fullName || "").localeCompare(String(b.fullName || ""), "vi"));

  assignees.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = [
      item.fullName,
      item.position,
      item.teamId ? teamName(item.teamId) : ""
    ].filter(Boolean).join(" — ");
    ownerUserId.appendChild(option);
  });

  if (selectedOwner && assignees.some((item) => item.id === selectedOwner)) {
    ownerUserId.value = selectedOwner;
  }

  ownerUserId.disabled = false;

  if (ownerHelp) {
    ownerHelp.textContent = assignees.length
      ? "Không bắt buộc. Nếu chọn, người này nhận nhiệm vụ ngay; Trưởng/Phó Phòng/Khu vẫn quản lý và có thể phân công lại."
      : "Không tìm thấy nhân sự phù hợp. Có thể để trống để Phòng/Khu phân công sau.";
  }
}

function canEditTaskDefinition(task) {
  if (!task || !state.user || !state.profile || task.active === false) {
    return false;
  }

  if (state.profile.role === "ADMIN") {
    return true;
  }

  return (
    state.profile.role === "DIRECTOR"
    && task.entryMode === "DIRECT_ASSIGNED"
    && (
      task.assignedByUserId === state.user.uid
      || task.createdByUserId === state.user.uid
    )
  );
}

function availableRelatedDepartments() {
  const primaryId = cleanText(
    normalizeDepartmentId(primaryDepartmentId?.value || state.profile?.departmentId || "")
  );

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
      '<div class="multi-select-empty">Không tìm thấy Phòng/Khu phù hợp.</div>';
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
    supportSummary.textContent = "Chọn Phòng/Khu phối hợp";
    supportSelectedChips.innerHTML = "";
    return;
  }

  supportSummary.textContent = `Đã chọn ${selectedIds.length} Phòng/Khu`;

  supportSelectedChips.innerHTML = selectedIds.map((id) => {
    const label = departmentName(id);

    return `
      <span class="selected-chip">
        ${escapeHtml(label)}
        <button
          type="button"
          data-remove-support-id="${escapeHtml(id)}"
          aria-label="Bỏ ${escapeHtml(label)}"
        >×</button>
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
  state.editingTaskId = null;

  taskTitle.readOnly = false;
  taskDescription.readOnly = false;
  sourceType.disabled = false;
  sourceDetail.readOnly = false;
  priority.disabled = false;

  if (!state.standardTaskWorkflowContext && standardTaskTemplateBanner) {
    standardTaskTemplateBanner.classList.add("hidden");
    standardTaskTemplateBanner.innerHTML = "";
  }
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
    fillTeamOptions();
    fillOwnerOptions();
    syncSupportDepartmentUI();
    setDefaultDates();
    priority.value = "THUONG";
    toggleSupportDropdown(false);
    applyStandardTaskWorkflowContext();
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

async function openEditTaskModal(taskId = state.selectedTaskId) {
  const task = findTaskById(taskId);

  if (!task || !canEditTaskDefinition(task)) {
    return;
  }

  hideMessage(taskMessage);
  taskForm.reset();
  state.editingTaskId = task.id;
  state.selectedSupportIds = new Set(currentTaskSupportIds(task));
  supportSearchInput.value = "";

  detailModal.classList.add("hidden");
  taskModal.classList.remove("hidden");
  setBodyModalState();

  try {
    await loadReferenceData();

    entryMode.value = task.entryMode || "DIRECT_ASSIGNED";
    taskModalTitle.textContent = "✏️ Sửa nhiệm vụ đã giao";
    taskModalSubtitle.textContent =
      "Điều chỉnh nội dung, Phòng/Khu, Tổ/Bộ phận hoặc người thực hiện mà không xóa nhiệm vụ.";
    entryModeBanner.className = "entry-mode-banner entry-mode-direct";
    entryModeBanner.innerHTML = `
      <strong>CHỈNH SỬA NHIỆM VỤ</strong>
      <span>Mọi thay đổi được lưu nhật ký. Khi chuyển Phòng/Khu, phân công cũ không phù hợp sẽ được gỡ.</span>
    `;

    fillAssignedByOptions();
    fillPrimaryDepartmentOptions();

    taskTitle.value = task.title || "";
    taskDescription.value = task.description || "";
    sourceType.value = task.sourceType || "";
    sourceDetail.value = task.sourceDetail || task.sourceReference || "";
    priority.value = task.priority || "THUONG";
    assignedAt.value = task.assignedDateKey || task.sourceDateKey || "";
    deadline.value = task.deadlineDateKey || "";
    assignedByUserId.value = task.assignedByUserId || state.user.uid;
    primaryDepartmentId.value = normalizeDepartmentId(task.primaryDepartmentId);

    fillTeamOptions(task.teamId || "");
    fillOwnerOptions(task.ownerUserId || "");
    syncSupportDepartmentUI();
    toggleSupportDropdown(false);

    saveTaskButton.textContent = "Lưu thay đổi";
    taskTitle.focus();
  } catch (error) {
    console.error("Không mở được biểu mẫu sửa:", error);
    showMessage(taskMessage, error?.message || "Không mở được biểu mẫu sửa.", "error");
  }
}

function closeTaskModal() {
  if (state.savingTask) {
    return;
  }

  toggleSupportDropdown(false);
  state.editingTaskId = null;
  clearStandardTaskWorkflowContext();
  taskTitle.readOnly = false;
  taskDescription.readOnly = false;
  sourceType.disabled = false;
  sourceDetail.readOnly = false;
  priority.disabled = false;
  assignedByUserId.disabled = false;
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


const MAX_EVIDENCE_FILE_SIZE = 8 * 1024 * 1024;
const EVIDENCE_UPLOAD_TIMEOUT_MS = 180000;
const EVIDENCE_UPLOAD_POLL_INTERVAL_MS = 2000;

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = String(reader.result || "");
      const commaIndex = result.indexOf(",");
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };

    reader.onerror = () => {
      reject(new Error("Không đọc được tệp đã chọn."));
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

function evidenceUploadPollToken() {
  if (window.crypto?.getRandomValues) {
    const bytes = new Uint8Array(24);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
  }

  return [
    Date.now().toString(36),
    Math.random().toString(36).slice(2),
    Math.random().toString(36).slice(2)
  ].join("");
}

function pollTaskEvidenceUploadResult({
  requestId,
  pollToken,
  onResult,
  onError
}) {
  const callbackName = `taskEvidenceUploadCallback_${requestId.replace(/[^A-Za-z0-9_$]/g, "_")}`;
  let stopped = false;
  let timerId = null;

  const cleanupScript = (script) => {
    if (script?.parentNode) {
      script.parentNode.removeChild(script);
    }
  };

  const stop = () => {
    stopped = true;

    if (timerId) {
      window.clearTimeout(timerId);
      timerId = null;
    }

    try {
      delete window[callbackName];
    } catch (error) {
      window[callbackName] = undefined;
    }
  };

  const run = () => {
    if (stopped) {
      return;
    }

    const script = document.createElement("script");
    const url = new URL(NOTIFICATION_WEB_APP_URL);

    url.searchParams.set("action", "TASK_EVIDENCE_GET_RESULT");
    url.searchParams.set("requestId", requestId);
    url.searchParams.set("pollToken", pollToken);
    url.searchParams.set("callback", callbackName);
    url.searchParams.set("_", String(Date.now()));

    window[callbackName] = (data) => {
      cleanupScript(script);

      if (stopped) {
        return;
      }

      if (data?.ready !== true) {
        timerId = window.setTimeout(run, EVIDENCE_UPLOAD_POLL_INTERVAL_MS);
        return;
      }

      stop();

      if (data.ok === true && data.fileUrl) {
        onResult(data);
      } else {
        onError(new Error(data?.error || "Không tải được tệp lên Google Drive."));
      }
    };

    script.onerror = () => {
      cleanupScript(script);

      if (!stopped) {
        timerId = window.setTimeout(run, EVIDENCE_UPLOAD_POLL_INTERVAL_MS);
      }
    };

    script.src = url.toString();
    document.head.appendChild(script);
  };

  timerId = window.setTimeout(run, 2500);

  return stop;
}

function validateEvidenceFile(file) {
  if (!file) {
    throw new Error("Vui lòng chọn tệp hoặc hình ảnh cần tải lên.");
  }

  if (file.size <= 0) {
    throw new Error("Tệp đã chọn không có dữ liệu.");
  }

  if (file.size > MAX_EVIDENCE_FILE_SIZE) {
    throw new Error("Dung lượng tệp không được vượt quá 8 MB.");
  }

  const allowedExtensions = [
    ".pdf", ".jpg", ".jpeg", ".png", ".webp",
    ".doc", ".docx", ".xls", ".xlsx",
    ".ppt", ".pptx", ".txt"
  ];

  const lowerName = String(file.name || "").toLowerCase();

  if (!allowedExtensions.some((extension) => lowerName.endsWith(extension))) {
    throw new Error(
      "Chỉ hỗ trợ PDF, hình ảnh, Word, Excel, PowerPoint hoặc tệp TXT."
    );
  }
}

async function uploadTaskEvidenceToDrive(file, task) {
  validateEvidenceFile(file);

  if (!NOTIFICATION_WEB_APP_URL) {
    throw new Error("Chưa cấu hình URL Apps Script tải minh chứng lên Drive.");
  }

  if (!state.user || !task?.id) {
    throw new Error("Phiên đăng nhập hoặc nhiệm vụ không hợp lệ.");
  }

  const requestId = evidenceUploadRequestId();
  const pollToken = evidenceUploadPollToken();
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
      pollToken,
      taskId: task.id,
      taskCode: task.taskCode || "",
      idToken,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      base64Data
    });

    form.appendChild(input);

    let settled = false;
    let stopPolling = () => {};

    const cleanup = () => {
      window.removeEventListener("message", handleMessage);
      window.clearTimeout(timeoutId);
      stopPolling();
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
        new Error(data.error || "Không tải được tệp lên Google Drive.")
      ));
    };

    stopPolling = pollTaskEvidenceUploadResult({
      requestId,
      pollToken,
      onResult: (data) => {
        finish(() => resolve(data));
      },
      onError: (error) => {
        finish(() => reject(error));
      }
    });

    const timeoutId = window.setTimeout(() => {
      finish(() => reject(
        new Error("Quá thời gian tải tệp. Hãy kiểm tra mạng và thử lại.")
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
      normalizeDepartmentId(state.profile.departmentId),
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
  taskId,
  eventData = {}
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

    const normalizedEventData =
      eventData
      && typeof eventData === "object"
      && !Array.isArray(eventData)
        ? eventData
        : {};

    /*
     * Dùng text/plain và no-cors để gửi từ GitHub Pages
     * tới Google Apps Script mà không phát sinh lỗi CORS.
     *
     * Phía Apps Script vẫn xác minh Firebase ID Token,
     * người vừa thao tác và dữ liệu nhiệm vụ trước khi gửi.
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
          eventData: normalizedEventData,
          eventId: [
            action,
            taskId,
            Date.now(),
            Math.random().toString(36).slice(2, 10)
          ].join("_"),
          sentAt:
            new Date().toISOString()
        })
      }
    );

    return true;

  } catch (error) {
    console.warn(
      "Không gọi được dịch vụ gửi thông báo:",
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
      periodId: (window.KPI2C || window.KPI2C)?.getActivePeriodSnapshot()?.id || "",
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
    const editingTask = state.editingTaskId
      ? findTaskById(state.editingTaskId)
      : null;
    const mode = editingTask?.entryMode || currentEntryMode();
    const title = cleanText(taskTitle.value);
    const description = cleanText(taskDescription.value);
    const selectedSource = sourceType.value;
    const sourceInformation = cleanText(sourceDetail.value);
    const assignedBy = userById(assignedByUserId.value);
    const primaryId = mode === "SELF_RECORDED"
      ? normalizeDepartmentId(state.profile?.departmentId)
      : normalizeDepartmentId(primaryDepartmentId?.value);
    const selectedTeamId = mode === "DIRECT_ASSIGNED"
      ? normalizeTeamId(teamId?.value)
      : "";
    const selectedOwner = mode === "DIRECT_ASSIGNED" && ownerUserId?.value
      ? userById(ownerUserId.value)
      : null;
    const templateOwner = currentTemplateOwner();
    const effectiveOwner = selectedOwner || templateOwner;
    const templateItem = currentStandardTaskWorkflowItem();
    const templateAction = state.standardTaskWorkflowContext?.action || "";
    const assignedDate = parseDateInput(assignedAt.value, false);
    const deadlineDate = parseDateInput(deadline.value, true);
    const supportDepartmentIds = Array.from(state.selectedSupportIds)
      .map(normalizeDepartmentId)
      .filter((departmentId) => departmentId && departmentId !== primaryId);

    if (editingTask && !canEditTaskDefinition(editingTask)) {
      throw new Error("Tài khoản không có quyền sửa nội dung nhiệm vụ này.");
    }
    if (!title) throw new Error("Vui lòng nhập tên nhiệm vụ.");
    if (!description) throw new Error("Vui lòng nhập nội dung thực hiện.");
    if (!selectedSource) throw new Error("Vui lòng chọn nguồn nhiệm vụ.");
    if (!sourceInformation) throw new Error("Vui lòng nhập căn cứ hoặc nội dung chỉ đạo liên quan.");
    if (!assignedBy) throw new Error("Vui lòng chọn người giao/chỉ đạo.");
    if (!primaryId) throw new Error("Vui lòng xác định Phòng/Khu chịu trách nhiệm.");

    if (
      mode === "SELF_RECORDED"
      && normalizeDepartmentId(primaryId) !== normalizeDepartmentId(state.profile.departmentId)
    ) {
      throw new Error("Phòng/Khu của nhiệm vụ tự ghi nhận không hợp lệ.");
    }

    if (effectiveOwner) {
      if (
        effectiveOwner.active !== true
        || !["DEPARTMENT_LEADER", "STAFF"].includes(effectiveOwner.role)
        || normalizeDepartmentId(effectiveOwner.departmentId) !== primaryId
        || (
          selectedTeamId
          && normalizeTeamId(effectiveOwner.teamId) !== selectedTeamId
        )
      ) {
        throw new Error("Người thực hiện không thuộc đúng Phòng/Khu hoặc Tổ/Bộ phận đã chọn.");
      }
    }

    if (!assignedDate) throw new Error("Ngày được chỉ đạo không hợp lệ.");
    if (!deadlineDate) throw new Error("Hạn hoàn thành không hợp lệ.");
    if (deadlineDate.getTime() < assignedDate.getTime()) {
      throw new Error("Hạn hoàn thành không được trước ngày được chỉ đạo.");
    }

    state.savingTask = true;
    saveTaskButton.disabled = true;
    saveTaskButton.textContent = editingTask ? "Đang lưu thay đổi..." : "Đang lưu...";
    showMessage(
      taskMessage,
      editingTask
        ? "Đang cập nhật nhiệm vụ..."
        : (mode === "SELF_RECORDED" ? "Đang lưu nội dung ghi nhận..." : "Đang giao nhiệm vụ trực tiếp..."),
      "info"
    );

    const relatedDepartmentIds = Array.from(new Set(supportDepartmentIds));
    const visibleDepartmentIds = Array.from(new Set([primaryId, ...relatedDepartmentIds]));
    const visibleUserIds = Array.from(new Set([
      editingTask?.createdByUserId || state.user.uid,
      assignedBy.id,
      effectiveOwner?.id || ""
    ].filter(Boolean)));

    const commonPayload = {
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
      teamId: selectedTeamId,
      teamName: selectedTeamId ? teamName(selectedTeamId) : "",
      ownerUserId: effectiveOwner?.id || "",
      ownerName: effectiveOwner?.fullName || "",
      ownerPosition: effectiveOwner?.position || "",
      assignmentStatus: effectiveOwner ? "DA_PHAN_CONG" : "CHO_PHAN_CONG",
      relatedDepartmentIds,
      supportDepartmentIds: relatedDepartmentIds,
      visibleDepartmentIds,
      visibleUserIds,
      assignedAt: Timestamp.fromDate(assignedDate),
      assignedDateKey: dateKey(assignedDate),
      assignedMonthKey: monthKey(assignedDate),
      assignedWeekKey: isoWeekKey(assignedDate),
      deadline: Timestamp.fromDate(deadlineDate),
      deadlineDateKey: dateKey(deadlineDate),
      priority: priority.value,
      standardTaskId: templateItem?.id || editingTask?.standardTaskId || "",
      standardTaskCode: templateItem?.code || editingTask?.standardTaskCode || "",
      standardTaskName: templateItem?.name || editingTask?.standardTaskName || "",
      standardTaskDepartmentId: templateItem
        ? normalizeDepartmentId(templateItem.departmentId)
        : (editingTask?.standardTaskDepartmentId || ""),
      standardTaskWorkType: templateItem?.workType || editingTask?.standardTaskWorkType || "",
      standardTaskFrequency: templateItem?.frequency || editingTask?.standardTaskFrequency || "",
      standardTaskOutputRequirement: templateItem?.outputRequirement || editingTask?.standardTaskOutputRequirement || "",
      standardTaskMandatoryEvidence: templateItem?.mandatoryEvidence || editingTask?.standardTaskMandatoryEvidence || "",
      standardTaskArisingEvidence: templateItem?.arisingEvidence || editingTask?.standardTaskArisingEvidence || "",
      standardTaskConfirmer: templateItem?.confirmer || editingTask?.standardTaskConfirmer || "",
      baseScore: templateItem ? Number(templateItem.baseScore || 0) : Number(editingTask?.baseScore || 0),
      difficultyCoefficient: templateItem
        ? Number(templateItem.difficultyCoefficient || 0)
        : Number(editingTask?.difficultyCoefficient || 0),
      maximumConvertedScore: templateItem
        ? Number(templateItem.maximumConvertedScore || 0)
        : Number(editingTask?.maximumConvertedScore || 0),
      ...(templateItem && (window.KPI2C || window.KPI2C)
        ? (window.KPI2C || window.KPI2C).classifyNewTask(templateItem, state.profile)
        : {}),
      pilotMode: templateItem ? true : Boolean(editingTask?.pilotMode),
      scoringEnabled: templateItem ? true : Boolean(editingTask?.scoringEnabled),
      scoringStatus: editingTask?.scoringStatus || "NOT_ASSESSED",
      standardTaskWorkflowAction: templateAction || editingTask?.standardTaskWorkflowAction || "",
      updatedAt: serverTimestamp(),
      updatedByUserId: state.user.uid,
      updatedByName: state.profile.fullName || ""
    };

    if (editingTask) {
      const oldPrimaryId = normalizeDepartmentId(editingTask.primaryDepartmentId);
      const oldOwnerUserId = cleanText(editingTask.ownerUserId);
      const departmentChanged = oldPrimaryId !== primaryId;
      const ownerChanged = oldOwnerUserId !== (selectedOwner?.id || "");

      await updateDoc(doc(db, "tasks", editingTask.id), {
        ...commonPayload,
        internalAssignedByUserId: selectedOwner ? state.user.uid : "",
        internalAssignedByName: selectedOwner ? (state.profile.fullName || "") : "",
        internalAssignedAt: selectedOwner ? serverTimestamp() : null
      });

      await addDoc(collection(db, "taskLogs"), {
        taskId: editingTask.id,
        taskCode: editingTask.taskCode || "",
        action: "EDIT_TASK_DEFINITION",
        description: [
          departmentChanged
            ? `Chuyển Phòng/Khu chính từ ${departmentName(oldPrimaryId)} sang ${departmentName(primaryId)}`
            : "Cập nhật nội dung nhiệm vụ",
          ownerChanged
            ? `Người thực hiện: ${selectedOwner?.fullName || "chờ Phòng/Khu phân công"}`
            : ""
        ].filter(Boolean).join("; "),
        oldValue: {
          primaryDepartmentId: oldPrimaryId,
          ownerUserId: oldOwnerUserId,
          teamId: normalizeTeamId(editingTask.teamId)
        },
        newValue: {
          primaryDepartmentId: primaryId,
          ownerUserId: selectedOwner?.id || "",
          teamId: selectedTeamId
        },
        performedByUserId: state.user.uid,
        performedByName: state.profile.fullName || "",
        performedAt: serverTimestamp()
      });

      await sendNotificationEvent("TASK_EDITED", editingTask.id, {
        oldPrimaryDepartmentId: oldPrimaryId,
        newPrimaryDepartmentId: primaryId,
        oldOwnerUserId,
        newOwnerUserId: selectedOwner?.id || "",
        departmentChanged,
        ownerChanged
      });

      showMessage(taskMessage, `✅ Đã cập nhật nhiệm vụ ${editingTask.taskCode || ""}.`, "success");
    } else {
      const taskCode = createTaskCode();
      const taskPayload = {
        taskCode,
        entryMode: mode,
        executionMode: templateAction === "SELF_REGISTER"
          ? "SELF_REGISTERED_STANDARD_TASK"
          : (templateAction === "PENDING_ASSIGNMENT"
            ? "STANDARD_TASK_PENDING_ASSIGNMENT"
            : mode),
        ...commonPayload,
        relatedUserIds: [],
        relatedUserNames: [],
        createdByUserId: state.user.uid,
        createdByName: state.profile.fullName || "",
        createdByRole: state.profile.role || "",
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
        createdAt: serverTimestamp()
      };

      if (effectiveOwner) {
        taskPayload.internalAssignedByUserId = state.user.uid;
        taskPayload.internalAssignedByName = state.profile.fullName || "";
        taskPayload.internalAssignedAt = serverTimestamp();
      }

      const taskReference = await addDoc(collection(db, "tasks"), taskPayload);
      const logCreated = await createTaskLog(taskReference, taskCode, title, mode);
      await sendNotificationEvent("TASK_CREATED", taskReference.id);

      const successText = templateAction === "SELF_REGISTER"
        ? `✅ Đã đăng ký thực hiện ${taskCode}.`
        : (templateAction === "PENDING_ASSIGNMENT"
          ? `✅ Đã tạo ${taskCode} ở trạng thái chờ phân công.`
          : (mode === "SELF_RECORDED"
            ? `✅ Đã ghi nhận nhiệm vụ ${taskCode}.`
            : `✅ Đã giao nhiệm vụ ${taskCode}.`));

      showMessage(
        taskMessage,
        logCreated
          ? successText
          : `✅ Đã lưu nhiệm vụ ${taskCode}, nhưng chưa ghi được nhật ký.`,
        logCreated ? "success" : "warning"
      );
    }

    await loadTasks();

    window.setTimeout(() => closeTaskModal(), 900);
  } catch (error) {
    console.error("Không lưu được nhiệm vụ:", error);
    const message = error?.code === "permission-denied"
      ? "Tài khoản chưa được cấp quyền lưu hoặc sửa nhiệm vụ. Hãy cập nhật và Publish Firestore Rules mới."
      : (error?.message || "Không lưu được nhiệm vụ.");
    showMessage(taskMessage, message, "error");
  } finally {
    state.savingTask = false;
    saveTaskButton.disabled = false;
    saveTaskButton.textContent = state.editingTaskId
      ? "Lưu thay đổi"
      : (currentEntryMode() === "SELF_RECORDED" ? "Lưu ghi nhận" : "Giao nhiệm vụ");
  }
}



/* =========================================================
 * PHÂN CÔNG NỘI BỘ
 * ========================================================= */

function internalAssigneeOptions(task) {
  const allowedRoles = new Set([
    "DEPARTMENT_LEADER",
    "STAFF"
  ]);

  return state.users
    .filter((item) => (
      item.active === true &&
      allowedRoles.has(item.role) &&
      normalizeDepartmentId(item.departmentId) === normalizeDepartmentId(task.primaryDepartmentId)
    ))
    .sort((a, b) => {
      /*
       * Trưởng/Phó hiển thị trước, sau đó đến nhân viên;
       * trong từng nhóm sắp xếp theo họ tên.
       */
      const roleOrder = {
        DEPARTMENT_LEADER: 1,
        STAFF: 2
      };

      const orderDifference =
        Number(roleOrder[a.role] || 99) -
        Number(roleOrder[b.role] || 99);

      if (orderDifference !== 0) {
        return orderDifference;
      }

      return String(a.fullName || "").localeCompare(
        String(b.fullName || ""),
        "vi"
      );
    });
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
    ? "👤 Phân công lại nhiệm vụ"
    : "👤 Phân công nội bộ";
  assignmentTaskCode.textContent = task.taskCode || "—";
  assignmentTaskSummary.innerHTML = `
    <div>
      <h3>${escapeHtml(task.title || "Nhiệm vụ")}</h3>
      <p>${escapeHtml(truncate(task.description || "", 220))}</p>
    </div>
    <div class="summary-deadline">
      <span>Phòng/Khu phụ trách</span>
      <strong>${escapeHtml(departmentName(task.primaryDepartmentId))}</strong>
    </div>
  `;

  const assignees = internalAssigneeOptions(task);
  internalOwnerUserId.innerHTML =
    '<option value="">Chọn người phụ trách thực hiện</option>';

  assignees.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = [item.fullName, item.position]
      .filter(Boolean)
      .join(" — ");
    internalOwnerUserId.appendChild(option);
  });

  internalOwnerUserId.value = assignees.some(
    (item) => item.id === task.ownerUserId
  )
    ? task.ownerUserId
    : "";

  assignmentHelp.textContent = assignees.length > 0
    ? "Hiển thị Trưởng/Phó và nhân viên đang hoạt động thuộc Phòng/Khu chịu trách nhiệm chính."
    : "Phòng/Khu này chưa có tài khoản lãnh đạo hoặc nhân viên đang hoạt động để phân công.";

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
      description: `Phân công nội bộ cho ${owner.fullName || ""}`,
      oldValue: task.ownerUserId || "",
      newValue: owner.id,
      performedByUserId: state.user.uid,
      performedByName: state.profile.fullName || "",
      performedAt: serverTimestamp()
    });
  } catch (error) {
    console.warn("Không ghi được nhật ký phân công:", error);
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
      "Tài khoản không có quyền phân công nhiệm vụ này.",
      "error"
    );
    return;
  }

  const owner = userById(internalOwnerUserId.value);

  if (
    !owner ||
    owner.active !== true ||
    !["DEPARTMENT_LEADER", "STAFF"].includes(owner.role) ||
    normalizeDepartmentId(owner.departmentId) !== normalizeDepartmentId(task.primaryDepartmentId)
  ) {
    showMessage(
      assignmentMessage,
      "Vui lòng chọn đúng người phụ trách đang hoạt động thuộc Phòng/Khu chính.",
      "error"
    );
    return;
  }

  state.savingAssignment = true;
  saveAssignmentButton.disabled = true;
  saveAssignmentButton.textContent = "Đang phân công...";
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
      `✅ Đã phân công nhiệm vụ cho ${owner.fullName || "người phụ trách"}.`,
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
    console.error("Không phân công được nhiệm vụ:", error);

    showMessage(
      assignmentMessage,
      error?.code === "permission-denied"
        ? "Firestore chưa cho phép Phòng/Khu phân công nội bộ. Hãy Publish Rules Bước 2."
        : (error?.message || "Không phân công được nhiệm vụ."),
      "error"
    );
  } finally {
    state.savingAssignment = false;
    saveAssignmentButton.disabled = false;
    saveAssignmentButton.textContent = "Xác nhận phân công";
  }
}


/* =========================================================
 * CẬP NHẬT PHÒNG/KHU PHỐI HỢP
 * ========================================================= */

function currentTaskSupportIds(task) {
  return Array.from(new Set([
    ...(Array.isArray(task?.relatedDepartmentIds) ? task.relatedDepartmentIds : []),
    ...(Array.isArray(task?.supportDepartmentIds) ? task.supportDepartmentIds : [])
  ])).filter((id) => id && id !== task?.primaryDepartmentId);
}

function openSupportEditModal(taskId = state.selectedTaskId) {
  const task = findTaskById(taskId);

  if (!task || !canEditTaskSupport(task)) {
    return;
  }

  state.selectedTaskId = task.id;
  hideMessage(supportEditMessage);

  const selectedIds = new Set(currentTaskSupportIds(task));
  const departments = state.departments
    .filter((item) => item.active !== false && item.id !== "BGD" && item.id !== task.primaryDepartmentId)
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));

  supportEditTaskCode.textContent = task.taskCode || "—";
  supportEditSummary.innerHTML = `
    <div>
      <h3>${escapeHtml(task.title || "Nhiệm vụ")}</h3>
      <p>Phòng/Khu chính: <strong>${escapeHtml(departmentName(task.primaryDepartmentId))}</strong></p>
    </div>
  `;

  supportEditOptions.innerHTML = departments.length
    ? departments.map((item) => `
      <label class="support-edit-option">
        <input
          type="checkbox"
          value="${escapeHtml(item.id)}"
          ${selectedIds.has(item.id) ? "checked" : ""}
        >
        <span>
          <strong>${escapeHtml(item.name || item.code || item.id)}</strong>
          <small>${escapeHtml(item.code || item.id)}</small>
        </span>
      </label>
    `).join("")
    : '<div class="multi-select-empty">Chưa có Phòng/Khu phù hợp để phối hợp.</div>';

  detailModal.classList.add("hidden");
  supportEditModal.classList.remove("hidden");
  setBodyModalState();
}

function closeSupportEditModal() {
  if (state.savingSupport) {
    return;
  }

  supportEditModal.classList.add("hidden");
  setBodyModalState();
}

async function saveTaskSupportDepartments(event) {
  event.preventDefault();

  if (state.savingSupport) {
    return;
  }

  const task = findTaskById(state.selectedTaskId);

  if (!task || !canEditTaskSupport(task)) {
    showMessage(
      supportEditMessage,
      "Tài khoản không có quyền cập nhật Phòng/Khu phối hợp của nhiệm vụ này.",
      "error"
    );
    return;
  }

  const selectedIds = Array.from(
    supportEditOptions.querySelectorAll('input[type="checkbox"]:checked')
  )
    .map((input) => cleanText(input.value))
    .filter((id) => id && id !== task.primaryDepartmentId);

  const uniqueIds = Array.from(new Set(selectedIds));
  const oldIds = currentTaskSupportIds(task);
  const addedIds = uniqueIds.filter((id) => !oldIds.includes(id));
  const removedIds = oldIds.filter((id) => !uniqueIds.includes(id));

  state.savingSupport = true;
  saveSupportEditButton.disabled = true;
  saveSupportEditButton.textContent = "Đang lưu...";
  hideMessage(supportEditMessage);

  try {
    await updateDoc(doc(db, "tasks", task.id), {
      relatedDepartmentIds: uniqueIds,
      supportDepartmentIds: uniqueIds,
      visibleDepartmentIds: Array.from(new Set([
        task.primaryDepartmentId,
        ...uniqueIds
      ])),
      updatedAt: serverTimestamp(),
      updatedByUserId: state.user.uid,
      updatedByName: state.profile.fullName || ""
    });

    await addDoc(collection(db, "taskLogs"), {
      taskId: task.id,
      taskCode: task.taskCode || "",
      action: "UPDATE_SUPPORT_DEPARTMENTS",
      description: [
        addedIds.length
          ? `Thêm phối hợp: ${addedIds.map(departmentName).join(", ")}`
          : "",
        removedIds.length
          ? `Bỏ phối hợp: ${removedIds.map(departmentName).join(", ")}`
          : ""
      ].filter(Boolean).join("; ") || "Không thay đổi danh sách phối hợp",
      oldValue: oldIds,
      newValue: uniqueIds,
      performedByUserId: state.user.uid,
      performedByName: state.profile.fullName || "",
      performedAt: serverTimestamp()
    });

    await sendNotificationEvent(
      "TASK_SUPPORT_UPDATED",
      task.id,
      {
        addedDepartmentIds: addedIds,
        removedDepartmentIds: removedIds
      }
    );

    showMessage(
      supportEditMessage,
      "✅ Đã cập nhật Phòng/Khu phối hợp.",
      "success"
    );

    await loadTasks();

    window.setTimeout(() => {
      state.savingSupport = false;
      closeSupportEditModal();

      if (findTaskById(task.id)) {
        openTaskDetail(task.id);
      }
    }, 650);
  } catch (error) {
    console.error("Không cập nhật được Phòng/Khu phối hợp:", error);
    showMessage(
      supportEditMessage,
      error?.message || "Không cập nhật được Phòng/Khu phối hợp.",
      "error"
    );
  } finally {
    state.savingSupport = false;
    saveSupportEditButton.disabled = false;
    saveSupportEditButton.textContent = "Lưu Phòng/Khu phối hợp";
  }
}

/* =========================================================
 * XÓA MỀM NHIỆM VỤ
 * ========================================================= */

function openDeleteTaskModal(taskId = state.selectedTaskId) {
  const task = findTaskById(taskId);

  if (!task || !canDeleteTask(task)) {
    return;
  }

  state.selectedTaskId = task.id;
  deleteTaskForm.reset();
  hideMessage(deleteTaskMessage);

  deleteTaskCode.textContent = task.taskCode || "—";
  deleteTaskSummary.innerHTML = `
    <h3>${escapeHtml(task.title || "Nhiệm vụ")}</h3>
    <p>${escapeHtml(truncate(task.description || "", 220))}</p>
  `;

  detailModal.classList.add("hidden");
  deleteTaskModal.classList.remove("hidden");
  setBodyModalState();
  deleteReason.focus();
}

function closeDeleteTaskModal() {
  if (state.deletingTask) {
    return;
  }

  deleteTaskModal.classList.add("hidden");
  setBodyModalState();
}

async function softDeleteTask(event) {
  event.preventDefault();

  if (state.deletingTask) {
    return;
  }

  const task = findTaskById(state.selectedTaskId);
  const reason = cleanText(deleteReason.value);

  if (!task || !canDeleteTask(task)) {
    showMessage(
      deleteTaskMessage,
      "Tài khoản không có quyền xóa nhiệm vụ này.",
      "error"
    );
    return;
  }

  if (reason.length < 5) {
    showMessage(
      deleteTaskMessage,
      "Vui lòng nhập lý do xóa rõ ràng, tối thiểu 5 ký tự.",
      "error"
    );
    deleteReason.focus();
    return;
  }

  state.deletingTask = true;
  confirmDeleteTaskButton.disabled = true;
  confirmDeleteTaskButton.textContent = "Đang xóa...";
  hideMessage(deleteTaskMessage);

  try {
    await updateDoc(doc(db, "tasks", task.id), {
      active: false,
      deletedAt: serverTimestamp(),
      deletedByUserId: state.user.uid,
      deletedByName: state.profile.fullName || "",
      deletedReason: reason,
      updatedAt: serverTimestamp(),
      updatedByUserId: state.user.uid,
      updatedByName: state.profile.fullName || ""
    });

    await addDoc(collection(db, "taskLogs"), {
      taskId: task.id,
      taskCode: task.taskCode || "",
      action: "SOFT_DELETE_TASK",
      description: `Xóa nhiệm vụ. Lý do: ${reason}`,
      oldValue: true,
      newValue: false,
      performedByUserId: state.user.uid,
      performedByName: state.profile.fullName || "",
      performedAt: serverTimestamp()
    });

    await sendNotificationEvent("TASK_DELETED", task.id);

    showMessage(
      deleteTaskMessage,
      "✅ Đã xóa nhiệm vụ khỏi danh sách theo dõi.",
      "success"
    );

    await loadTasks();

    window.setTimeout(() => {
      state.deletingTask = false;
      closeDeleteTaskModal();
    }, 650);
  } catch (error) {
    console.error("Không xóa được nhiệm vụ:", error);
    showMessage(
      deleteTaskMessage,
      error?.message || "Không xóa được nhiệm vụ.",
      "error"
    );
  } finally {
    state.deletingTask = false;
    confirmDeleteTaskButton.disabled = false;
    confirmDeleteTaskButton.textContent = "Xác nhận xóa";
  }
}

/* =========================================================
 * CẬP NHẬT TIẾN ĐỘ VÀ KẾT THÚC NHIỆM VỤ
 * ========================================================= */

const PROGRESS_MILESTONES = Object.freeze([0, 25, 50, 75, 90, 100]);

const PROGRESS_MILESTONE_DESCRIPTIONS = Object.freeze({
  0: "Chưa triển khai hoặc chưa phát sinh hoạt động thực hiện.",
  25: "Đã tiếp nhận, xác định cách thực hiện và bắt đầu triển khai.",
  50: "Đang thực hiện; khối lượng công việc đã hoàn thành khoảng một nửa.",
  75: "Đã hoàn thành phần chính; đang hoàn thiện, lấy ý kiến hoặc phối hợp.",
  90: "Đã hoàn tất nội dung; đang chờ ký, ban hành, bàn giao hoặc thủ tục kết thúc.",
  100: "Nhiệm vụ đã hoàn thành và được chuyển sang lưu trữ."
});

function normalizeProgressMilestone(value, isCompleted = false) {
  if (isCompleted) {
    return 100;
  }

  const numericValue = Math.max(0, Math.min(99, Number(value) || 0));
  const availableMilestones = PROGRESS_MILESTONES.filter((item) => item < 100);

  return availableMilestones.reduce((selected, milestone) => (
    milestone <= numericValue ? milestone : selected
  ), 0);
}

function updateProgressMilestoneHelp() {
  if (!progressMilestoneHelp || !progressPercent) {
    return;
  }

  const value = Number(progressPercent.value) || 0;
  progressMilestoneHelp.innerHTML = `
    <strong>${value}%</strong>
    <span>${escapeHtml(PROGRESS_MILESTONE_DESCRIPTIONS[value] || "Chọn đúng mốc phản ánh tình hình thực tế.")}</span>
  `;
}

function updateEvidenceFileSelection() {
  const file = evidenceFileInput?.files?.[0] || null;

  if (file) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
    evidenceFileName.textContent = `${file.name} — ${sizeMb} MB`;
    evidenceFileName.classList.add("has-file");
    return;
  }

  const task = findTaskById(state.selectedTaskId);
  const existingUrl = task?.evidenceUrl || task?.evidenceLink || "";

  evidenceFileName.textContent = existingUrl
    ? `Đang sử dụng tệp hiện tại: ${task?.evidenceFileName || "Mở tệp minh chứng"}`
    : "Chưa chọn tệp";

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

  updateProgressMilestoneHelp();

  saveProgressButton.textContent = isCompleted
    ? "✓ Hoàn thành nhiệm vụ"
    : "Lưu cập nhật";

  const evidenceType = completionProductType.value;

  // Minh chứng khác: chỉ nhập kết quả thực hiện.
  // Tệp/hình ảnh: chỉ đính kèm tệp.
  // Không có minh chứng: không hiển thị thêm trường nào.
  const showResult = isCompleted && evidenceType === "OTHER";
  const showFile = isCompleted && evidenceType === "FILE";

  resultSummaryWrap.classList.toggle("hidden", !showResult);
  evidenceFileWrap.classList.toggle("hidden", !showFile);

  resultSummary.required = showResult;
  evidenceFileInput.required = showFile && !(
    findTaskById(state.selectedTaskId)?.evidenceUrl ||
    findTaskById(state.selectedTaskId)?.evidenceLink
  );

  if (!showResult) {
    resultSummary.value = "";
  }

  if (!showFile) {
    evidenceFileInput.value = "";
    evidenceFileInput.required = false;
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
  progressPercent.value = String(normalizeProgressMilestone(task.progress, task.status === "HOAN_THANH"));

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
    ? `Mở tệp hiện tại: ${task.evidenceFileName}`
    : "Mở tệp minh chứng hiện tại";

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
    showMessage(
      progressMessage,
      "Tài khoản không có quyền cập nhật nhiệm vụ này.",
      "error"
    );
    return;
  }

  hideMessage(progressMessage);

  try {
    const newStatus = progressStatus.value;
    let newProgress = Number(progressPercent.value) || 0;

    if (!PROGRESS_MILESTONES.includes(newProgress)) {
      throw new Error("Vui lòng chọn một mốc tiến độ hợp lệ.");
    }

    if (newStatus === "HOAN_THANH") {
      newProgress = 100;
    } else if (newProgress === 100) {
      throw new Error("Mốc 100% chỉ áp dụng khi chọn trạng thái Hoàn thành / Kết thúc.");
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
      const selectedEvidenceType = completionProductType.value;
      const needsResult = selectedEvidenceType === "OTHER";
      const summary = needsResult ? cleanText(resultSummary.value) : "";

      if (!completed) {
        throw new Error("Vui lòng chọn ngày hoàn thành thực tế.");
      }

      completed.setHours(12, 0, 0, 0);

      if (!selectedEvidenceType) {
        throw new Error("Vui lòng chọn loại minh chứng.");
      }

      if (needsResult && !summary) {
        throw new Error("Vui lòng nhập kết quả thực hiện.");
      }

      let evidenceUrl = "";
      let evidenceText = "";
      let evidenceFileNameValue = "";
      let evidenceStoragePath = "";

      if (selectedEvidenceType === "FILE") {
        const selectedFile = evidenceFileInput.files?.[0] || null;
        const existingUrl = task.evidenceUrl || task.evidenceLink || "";

        if (selectedFile) {
          saveProgressButton.textContent = "Đang tải tệp lên Drive...";

          const uploadResult = await uploadTaskEvidenceToDrive(
            selectedFile,
            task
          );

          evidenceUrl = uploadResult.fileUrl || "";
          evidenceFileNameValue = uploadResult.fileName || selectedFile.name;
          evidenceStoragePath = uploadResult.fileId || "";
        } else if (existingUrl) {
          evidenceUrl = existingUrl;
          evidenceFileNameValue = task.evidenceFileName || "Mở tệp minh chứng";
          evidenceStoragePath = task.evidenceStoragePath || "";
        } else {
          throw new Error("Vui lòng chọn tệp hoặc hình ảnh cần tải lên.");
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
    } else {
      await sendNotificationEvent(
        "TASK_UPDATED",
        task.id,
        {
          oldStatus: task.status || "",
          newStatus,
          oldProgress: Number(task.progress) || 0,
          newProgress
        }
      );
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
    await switchApplicationModule("TASKS");

    try {
      /*
       * Không đăng nhập External ID vào OneSignal tại phân hệ nhiệm vụ.
       * Chỉ liên kết Subscription ID hiện tại với Firebase UID trong
       * collection taskPushSubscriptions.
       */
      await syncCurrentPushSubscription();
    } catch (pushError) {
      console.warn(
        "OneSignal chưa sẵn sàng; ứng dụng vẫn tiếp tục hoạt động:",
        pushError
      );
    }

    await loadTasks();
    startTaskRealtimeListeners();
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


tasksModuleTab.addEventListener("click", () => {
  switchApplicationModule("TASKS");
});

standardTasksModuleTab.addEventListener("click", () => {
  switchApplicationModule("STANDARD_TASKS");
});

kpiModuleTab?.addEventListener("click", () => {
  switchApplicationModule("KPI");
});

refreshStandardTasksButton.addEventListener("click", async () => {
  state.standardTasksLoaded = false;
  await loadStandardTasks();
});

standardTaskSearchInput.addEventListener("input", applyStandardTaskFilters);
standardTaskWorkTypeFilter.addEventListener("change", applyStandardTaskFilters);
standardTaskSelfRegisterButton?.addEventListener("click", () => {
  startStandardTaskWorkflow("SELF_REGISTER");
});
standardTaskPendingAssignmentButton?.addEventListener("click", () => {
  startStandardTaskWorkflow("PENDING_ASSIGNMENT");
});
standardTaskDepartmentFilter.addEventListener("change", applyStandardTaskFilters);

resetStandardTaskFiltersButton.addEventListener("click", () => {
  standardTaskSearchInput.value = "";
  standardTaskWorkTypeFilter.value = "ALL";
  standardTaskDepartmentFilter.value = "ALL";
  applyStandardTaskFilters();
});

standardTaskTableBody.addEventListener("click", handleStandardTaskOpenEvent);
standardTaskCardList.addEventListener("click", handleStandardTaskOpenEvent);

standardTaskTableBody.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    handleStandardTaskOpenEvent(event);
  }
});

standardTaskCardList.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    handleStandardTaskOpenEvent(event);
  }
});

closeStandardTaskDetailButton.addEventListener("click", closeStandardTaskDetail);
closeStandardTaskDetailFooterButton.addEventListener("click", closeStandardTaskDetail);

standardTaskDetailModal.addEventListener("click", (event) => {
  if (event.target === standardTaskDetailModal) {
    closeStandardTaskDetail();
  }
});

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

refreshButton.addEventListener("click", async () => {
  searchInput.value = "";
  statusFilter.value = "ALL";
  deadlineFilter.value = "ALL";
  departmentFilter.value = "ALL";

  if (dateFromFilter) {
    dateFromFilter.value = "";
  }

  if (dateToFilter) {
    dateToFilter.value = "";
  }

  hideMessage(dashboardMessage);
  await loadTasks();
});
exportReportButton?.addEventListener("click", exportTaskReport);
addTaskButton.addEventListener("click", openTaskModal);
closeModalButton.addEventListener("click", closeTaskModal);
cancelTaskButton.addEventListener("click", closeTaskModal);
closeDetailButton.addEventListener("click", closeTaskDetail);
assignTaskButton.addEventListener("click", () => openAssignmentModal());
editTaskButton.addEventListener("click", () => openEditTaskModal());
updateTaskButton.addEventListener("click", () => openProgressModal());
supportTaskButton.addEventListener("click", () => openSupportEditModal());
deleteTaskButton.addEventListener("click", () => openDeleteTaskModal());
closeSupportEditButton.addEventListener("click", closeSupportEditModal);
cancelSupportEditButton.addEventListener("click", closeSupportEditModal);
supportEditForm.addEventListener("submit", saveTaskSupportDepartments);
closeDeleteTaskButton.addEventListener("click", closeDeleteTaskModal);
cancelDeleteTaskButton.addEventListener("click", closeDeleteTaskModal);
deleteTaskForm.addEventListener("submit", softDeleteTask);
closeProgressButton.addEventListener("click", closeProgressModal);
cancelProgressButton.addEventListener("click", closeProgressModal);
closeAssignmentButton.addEventListener("click", closeAssignmentModal);
cancelAssignmentButton.addEventListener("click", closeAssignmentModal);
assignmentForm.addEventListener("submit", saveInternalAssignment);
progressForm.addEventListener("submit", saveProgress);
progressStatus.addEventListener("change", syncCompletionEvidenceUI);
progressPercent.addEventListener("change", updateProgressMilestoneHelp);
completionProductType.addEventListener("change", syncCompletionEvidenceUI);
evidenceFileInput.addEventListener("change", updateEvidenceFileSelection);
completedDate.addEventListener("input", updateCompletionTimingPreview);

filterToggleButton.addEventListener("click", () => {
  const isOpen = filterFields.classList.toggle("open");

  filterToggleButton.setAttribute(
    "aria-expanded",
    String(isOpen)
  );

  filterToggleButton.textContent = isOpen
    ? "✕ Đóng bộ lọc nâng cao"
    : "🔎 Bộ lọc nâng cao";
});

searchInput.addEventListener("input", applyFilters);
statusFilter.addEventListener("change", applyFilters);
deadlineFilter.addEventListener("change", applyFilters);
departmentFilter.addEventListener("change", applyFilters);
dateFromFilter?.addEventListener("change", applyFilters);
dateToFilter?.addEventListener("change", applyFilters);

activeTasksTab.addEventListener("click", () => {
  state.taskView = "ACTIVE";
  statusFilter.value = "ALL";
  deadlineFilter.value = "ALL";
  applyFilters();
});

archiveTasksTab.addEventListener("click", () => {
  state.taskView = "ARCHIVE";
  statusFilter.value = "ALL";
  deadlineFilter.value = "ALL";
  applyFilters();
});

primaryDepartmentId?.addEventListener("change", () => {
  fillTeamOptions();
  fillOwnerOptions();
  state.selectedSupportIds.delete(normalizeDepartmentId(primaryDepartmentId.value));
  syncSupportDepartmentUI();
});

teamId?.addEventListener("change", () => {
  fillOwnerOptions();
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

supportEditModal.addEventListener("click", (event) => {
  if (event.target === supportEditModal) {
    closeSupportEditModal();
  }
});

deleteTaskModal.addEventListener("click", (event) => {
  if (event.target === deleteTaskModal) {
    closeDeleteTaskModal();
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

  if (!standardTaskDetailModal.classList.contains("hidden")) {
    closeStandardTaskDetail();
    return;
  }

  if (!deleteTaskModal.classList.contains("hidden")) {
    closeDeleteTaskModal();
    return;
  }

  if (!supportEditModal.classList.contains("hidden")) {
    closeSupportEditModal();
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
