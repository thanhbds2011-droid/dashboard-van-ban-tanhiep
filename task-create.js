/*
 * =========================================================
 * TẠO NHIỆM VỤ MỚI
 * Hệ thống quản lý nhiệm vụ - TTBTXH Tân Hiệp
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
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";


/*
 * =========================================================
 * ĐƯỜNG DẪN HỆ THỐNG
 * =========================================================
 */

const DASHBOARD_URL =
  "./dashboard.html?v=20260713.3";

const LOGIN_URL =
  "./login.html?v=20260713.3";


/*
 * =========================================================
 * TRẠNG THÁI DÙNG CHUNG
 * =========================================================
 */

const state = {
  user: null,
  profile: null,
  departments: [],
  users: [],
  saving: false
};


/*
 * =========================================================
 * PHẦN TỬ GIAO DIỆN
 * =========================================================
 */

const loadingScreen =
  document.getElementById("loadingScreen");

const appShell =
  document.getElementById("appShell");

const accessDenied =
  document.getElementById("accessDenied");

const form =
  document.getElementById("taskForm");

const messageBox =
  document.getElementById("messageBox");

const backButton =
  document.getElementById("backButton");

const logoutButton =
  document.getElementById("logoutButton");

const saveButton =
  document.getElementById("saveButton");

const titleInput =
  document.getElementById("title");

const descriptionInput =
  document.getElementById("description");

const sourceTypeSelect =
  document.getElementById("sourceType");

const sourceDetailInput =
  document.getElementById("sourceDetail");

const assignedBySelect =
  document.getElementById("assignedByUserId");

const primaryDepartmentSelect =
  document.getElementById("primaryDepartmentId");

const ownerSelect =
  document.getElementById("ownerUserId");

const supportDepartmentsBox =
  document.getElementById("supportDepartments");

const assignedAtInput =
  document.getElementById("assignedAt");

const deadlineInput =
  document.getElementById("deadline");

const prioritySelect =
  document.getElementById("priority");

const currentUserInfo =
  document.getElementById("currentUserInfo");

const primaryDepartmentHelp =
  document.getElementById("primaryDepartmentHelp");

const ownerHelp =
  document.getElementById("ownerHelp");


/*
 * =========================================================
 * HIỂN THỊ THÔNG BÁO
 * =========================================================
 */

function showMessage(text, type = "info") {
  messageBox.textContent = text;
  messageBox.className =
    `message show ${type}`;
}


function hideMessage() {
  messageBox.textContent = "";
  messageBox.className = "message";
}


function setSaving(isSaving) {
  state.saving = isSaving;

  saveButton.disabled = isSaving;

  saveButton.textContent = isSaving
    ? "Đang lưu nhiệm vụ..."
    : "Lưu nhiệm vụ";
}


/*
 * =========================================================
 * ĐIỀU HƯỚNG
 * =========================================================
 */

function goToLogin(reason = "") {
  const suffix = reason
    ? `&reason=${encodeURIComponent(reason)}`
    : "";

  window.location.replace(
    LOGIN_URL + suffix
  );
}


/*
 * =========================================================
 * XỬ LÝ CHUỖI VÀ NGÀY THÁNG
 * =========================================================
 */

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}


function pad2(value) {
  return String(value).padStart(2, "0");
}


function toLocalDateTimeInput(date) {
  return [
    date.getFullYear(),
    "-",
    pad2(date.getMonth() + 1),
    "-",
    pad2(date.getDate()),
    "T",
    pad2(date.getHours()),
    ":",
    pad2(date.getMinutes())
  ].join("");
}


function toDateInput(date) {
  return [
    date.getFullYear(),
    "-",
    pad2(date.getMonth() + 1),
    "-",
    pad2(date.getDate())
  ].join("");
}


function createLocalDateFromDateInput(
  value,
  endOfDay = false
) {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})$/.exec(
      value || ""
    );

  if (!match) {
    return null;
  }

  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    0
  );

  return Number.isNaN(date.getTime())
    ? null
    : date;
}


function createLocalDateTime(value) {
  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? null
    : date;
}


function getDateKey(date) {
  return [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate())
  ].join("-");
}


function getMonthKey(date) {
  return [
    date.getFullYear(),
    pad2(date.getMonth() + 1)
  ].join("-");
}


function getIsoWeekKey(date) {
  const utcDate = new Date(
    Date.UTC(
      date.getFullYear(),
      date.getMonth(),
      date.getDate()
    )
  );

  const dayNumber =
    utcDate.getUTCDay() || 7;

  utcDate.setUTCDate(
    utcDate.getUTCDate() +
    4 -
    dayNumber
  );

  const yearStart = new Date(
    Date.UTC(
      utcDate.getUTCFullYear(),
      0,
      1
    )
  );

  const weekNumber = Math.ceil(
    (
      (
        (utcDate - yearStart) /
        86400000
      ) + 1
    ) / 7
  );

  return (
    `${utcDate.getUTCFullYear()}` +
    `-W${pad2(weekNumber)}`
  );
}


/*
 * =========================================================
 * TẠO MÃ NHIỆM VỤ
 * =========================================================
 */

function createTaskCode() {
  const now = new Date();

  const datePart = [
    now.getFullYear(),
    pad2(now.getMonth() + 1),
    pad2(now.getDate())
  ].join("");

  const timePart = [
    pad2(now.getHours()),
    pad2(now.getMinutes()),
    pad2(now.getSeconds())
  ].join("");

  const randomPart = Math.random()
    .toString(36)
    .slice(2, 5)
    .toUpperCase();

  return (
    `NV-${datePart}-` +
    `${timePart}-` +
    `${randomPart}`
  );
}


/*
 * =========================================================
 * ĐỌC DANH MỤC TRONG BỘ NHỚ
 * =========================================================
 */

function getDepartmentName(
  departmentId
) {
  const department =
    state.departments.find(
      (item) =>
        item.id === departmentId
    );

  return department
    ? (
      department.name ||
      department.code ||
      department.id
    )
    : departmentId;
}


function getUserById(uid) {
  return (
    state.users.find(
      (item) => item.id === uid
    ) || null
  );
}


function getActiveDirectors() {
  return state.users
    .filter(
      (item) =>
        item.active === true &&
        item.role === "DIRECTOR"
    )
    .sort(
      (a, b) =>
        String(a.fullName || "")
          .localeCompare(
            String(b.fullName || ""),
            "vi"
          )
    );
}


function getDepartmentLeaders(
  departmentId
) {
  return state.users
    .filter(
      (item) =>
        item.active === true &&
        item.role ===
          "DEPARTMENT_LEADER" &&
        item.departmentId ===
          departmentId
    )
    .sort(
      (a, b) =>
        String(a.fullName || "")
          .localeCompare(
            String(b.fullName || ""),
            "vi"
          )
    );
}


/*
 * =========================================================
 * ĐỌC HỒ SƠ NGƯỜI ĐĂNG NHẬP
 * =========================================================
 */

async function loadCurrentUserProfile(
  user
) {
  const snapshot = await getDoc(
    doc(
      db,
      "users",
      user.uid
    )
  );

  if (!snapshot.exists()) {
    throw new Error(
      "Tài khoản chưa có hồ sơ phân quyền trong hệ thống."
    );
  }

  const profile = snapshot.data();

  if (profile.active !== true) {
    throw new Error(
      "Tài khoản đã bị khóa hoặc ngừng hoạt động."
    );
  }

  return {
    id: snapshot.id,
    ...profile
  };
}


/*
 * =========================================================
 * ĐỌC PHÒNG BAN VÀ NGƯỜI DÙNG
 * =========================================================
 */

async function loadReferenceData() {
  const [
    departmentSnapshot,
    userSnapshot
  ] = await Promise.all([
    getDocs(
      collection(
        db,
        "departments"
      )
    ),

    getDocs(
      collection(
        db,
        "users"
      )
    )
  ]);

  state.departments = [];

  departmentSnapshot.forEach(
    (documentSnapshot) => {
      const data =
        documentSnapshot.data();

      if (data.active === true) {
        state.departments.push({
          id: documentSnapshot.id,
          ...data
        });
      }
    }
  );

  state.departments.sort(
    (a, b) =>
      Number(a.order || 0) -
      Number(b.order || 0)
  );

  state.users = [];

  userSnapshot.forEach(
    (documentSnapshot) => {
      state.users.push({
        id: documentSnapshot.id,
        ...documentSnapshot.data()
      });
    }
  );
}


/*
 * =========================================================
 * NGƯỜI GIAO/CHỈ ĐẠO
 * =========================================================
 */

function fillAssignedByOptions() {
  const directors =
    getActiveDirectors();

  assignedBySelect.innerHTML = `
    <option value="">
      Chọn người giao/chỉ đạo
    </option>
  `;

  directors.forEach(
    (director) => {
      const option =
        document.createElement(
          "option"
        );

      option.value = director.id;

      option.textContent = [
        director.fullName,
        director.position
      ]
        .filter(Boolean)
        .join(" — ");

      assignedBySelect.appendChild(
        option
      );
    }
  );

  if (directors.length === 0) {
    assignedBySelect.innerHTML = `
      <option value="">
        Chưa có tài khoản Ban Giám đốc
      </option>
    `;

    assignedBySelect.disabled = true;
  } else {
    assignedBySelect.disabled = false;
  }
}


/*
 * =========================================================
 * PHÒNG XỬ LÝ CHÍNH
 * =========================================================
 */

function fillPrimaryDepartmentOptions() {
  const allowedDepartments =
    state.departments.filter(
      (item) => item.id !== "BGD"
    );

  primaryDepartmentSelect.innerHTML =
    "";

  if (
    state.profile.role ===
    "DEPARTMENT_LEADER"
  ) {
    const departmentId =
      state.profile.departmentId;

    const option =
      document.createElement(
        "option"
      );

    option.value = departmentId;

    option.textContent =
      getDepartmentName(
        departmentId
      );

    primaryDepartmentSelect.appendChild(
      option
    );

    primaryDepartmentSelect.value =
      departmentId;

    primaryDepartmentSelect.disabled =
      true;

    primaryDepartmentHelp.textContent =
      "Trưởng/Phó phòng chỉ được tạo nhiệm vụ do phòng mình xử lý chính.";

    return;
  }

  primaryDepartmentSelect.innerHTML = `
    <option value="">
      Chọn phòng xử lý chính
    </option>
  `;

  allowedDepartments.forEach(
    (department) => {
      const option =
        document.createElement(
          "option"
        );

      option.value =
        department.id;

      option.textContent =
        department.name ||
        department.code ||
        department.id;

      primaryDepartmentSelect.appendChild(
        option
      );
    }
  );

  primaryDepartmentSelect.disabled =
    false;

  primaryDepartmentHelp.textContent =
    "Quản trị chọn phòng xử lý chính để hỗ trợ nhập dữ liệu thử nghiệm.";
}


/*
 * =========================================================
 * LÃNH ĐẠO CHỊU TRÁCH NHIỆM
 * =========================================================
 */

function fillOwnerOptions() {
  const primaryDepartmentId =
    primaryDepartmentSelect.value;

  ownerSelect.innerHTML = "";

  if (
    state.profile.role ===
    "DEPARTMENT_LEADER"
  ) {
    const option =
      document.createElement(
        "option"
      );

    option.value =
      state.user.uid;

    option.textContent = [
      state.profile.fullName,
      state.profile.position
    ]
      .filter(Boolean)
      .join(" — ");

    ownerSelect.appendChild(option);

    ownerSelect.value =
      state.user.uid;

    ownerSelect.disabled = true;

    ownerHelp.textContent =
      "Người chịu trách nhiệm chính là tài khoản đang đăng nhập.";

    return;
  }

  if (!primaryDepartmentId) {
    ownerSelect.innerHTML = `
      <option value="">
        Chọn phòng xử lý chính trước
      </option>
    `;

    ownerSelect.disabled = true;
    ownerHelp.textContent = "";

    return;
  }

  const leaders =
    getDepartmentLeaders(
      primaryDepartmentId
    );

  ownerSelect.innerHTML = `
    <option value="">
      Chọn lãnh đạo chịu trách nhiệm
    </option>
  `;

  leaders.forEach(
    (leader) => {
      const option =
        document.createElement(
          "option"
        );

      option.value = leader.id;

      option.textContent = [
        leader.fullName,
        leader.position
      ]
        .filter(Boolean)
        .join(" — ");

      ownerSelect.appendChild(
        option
      );
    }
  );

  ownerSelect.disabled =
    leaders.length === 0;

  ownerHelp.textContent =
    leaders.length === 0
      ? "Phòng này chưa có hồ sơ Trưởng/Phó phòng đang hoạt động."
      : "Chọn một lãnh đạo chịu trách nhiệm chính về KPI của nhiệm vụ.";
}


/*
 * =========================================================
 * PHÒNG PHỐI HỢP
 * =========================================================
 */

function renderSupportDepartments() {
  const primaryDepartmentId =
    primaryDepartmentSelect.value;

  const supportDepartments =
    state.departments.filter(
      (department) =>
        department.id !== "BGD" &&
        department.id !==
          primaryDepartmentId
    );

  if (
    supportDepartments.length === 0
  ) {
    supportDepartmentsBox.innerHTML = `
      <div class="empty-options">
        Chưa có phòng phối hợp khác trong dữ liệu thử nghiệm.
      </div>
    `;

    return;
  }

  supportDepartmentsBox.innerHTML =
    supportDepartments
      .map(
        (department) => `
          <label class="check-option">
            <input
              type="checkbox"
              name="supportDepartmentIds"
              value="${department.id}"
            >

            <span>
              ${
                department.name ||
                department.code ||
                department.id
              }
            </span>
          </label>
        `
      )
      .join("");
}


function getSelectedSupportDepartmentIds() {
  return Array.from(
    document.querySelectorAll(
      'input[name="supportDepartmentIds"]:checked'
    )
  ).map(
    (input) => input.value
  );
}


/*
 * =========================================================
 * NGÀY MẶC ĐỊNH
 * =========================================================
 */

function setDefaultDates() {
  const now = new Date();

  const sevenDaysLater =
    new Date(now);

  sevenDaysLater.setDate(
    sevenDaysLater.getDate() + 7
  );

  assignedAtInput.value =
    toLocalDateTimeInput(now);

  deadlineInput.min =
    toDateInput(now);

  deadlineInput.value =
    toDateInput(
      sevenDaysLater
    );
}


/*
 * =========================================================
 * KIỂM TRA DỮ LIỆU BIỂU MẪU
 * =========================================================
 */

function validateForm() {
  const title =
    normalizeText(
      titleInput.value
    );

  const description =
    normalizeText(
      descriptionInput.value
    );

  const sourceType =
    sourceTypeSelect.value;

  const sourceDetail =
    normalizeText(
      sourceDetailInput.value
    );

  const assignedByUserId =
    assignedBySelect.value;

  const primaryDepartmentId =
    primaryDepartmentSelect.value;

  const ownerUserId =
    ownerSelect.value;

  const assignedAt =
    createLocalDateTime(
      assignedAtInput.value
    );

  const deadline =
    createLocalDateFromDateInput(
      deadlineInput.value,
      true
    );

  const priority =
    prioritySelect.value;

  titleInput.value = title;
  descriptionInput.value = description;
  sourceDetailInput.value =
    sourceDetail;

  if (!title) {
    throw new Error(
      "Vui lòng nhập tiêu đề nhiệm vụ."
    );
  }

  if (!description) {
    throw new Error(
      "Vui lòng nhập nội dung chi tiết của nhiệm vụ."
    );
  }

  if (!sourceType) {
    throw new Error(
      "Vui lòng chọn nguồn nhiệm vụ."
    );
  }

  if (!sourceDetail) {
    throw new Error(
      "Vui lòng nhập chi tiết nguồn nhiệm vụ."
    );
  }

  if (
    !assignedByUserId ||
    !getUserById(
      assignedByUserId
    )
  ) {
    throw new Error(
      "Vui lòng chọn người giao hoặc chỉ đạo nhiệm vụ."
    );
  }

  if (!primaryDepartmentId) {
    throw new Error(
      "Vui lòng chọn phòng xử lý chính."
    );
  }

  if (
    !ownerUserId ||
    !getUserById(ownerUserId)
  ) {
    throw new Error(
      "Vui lòng chọn lãnh đạo chịu trách nhiệm chính."
    );
  }

  if (!assignedAt) {
    throw new Error(
      "Ngày giao nhiệm vụ không hợp lệ."
    );
  }

  if (!deadline) {
    throw new Error(
      "Hạn hoàn thành không hợp lệ."
    );
  }

  if (
    deadline.getTime() <
    assignedAt.getTime()
  ) {
    throw new Error(
      "Hạn hoàn thành không được trước ngày giao nhiệm vụ."
    );
  }

  if (!priority) {
    throw new Error(
      "Vui lòng chọn mức độ nhiệm vụ."
    );
  }

  return {
    title,
    description,
    sourceType,
    sourceDetail,
    assignedByUserId,
    primaryDepartmentId,
    ownerUserId,
    assignedAt,
    deadline,
    priority,

    supportDepartmentIds:
      getSelectedSupportDepartmentIds()
  };
}


/*
 * =========================================================
 * GHI NHẬT KÝ NHIỆM VỤ
 * =========================================================
 */

async function createTaskLogWithRetry(
  taskId,
  taskCode,
  title
) {
  const payload = {
    taskId,
    taskCode,

    action: "CREATE_TASK",

    description:
      `Tạo nhiệm vụ: ${title}`,

    oldValue: null,

    newValue:
      "MOI_TIEP_NHAN",

    performedByUserId:
      state.user.uid,

    performedByName:
      state.profile.fullName,

    performedAt:
      serverTimestamp()
  };

  let lastError = null;

  for (
    let attempt = 1;
    attempt <= 3;
    attempt += 1
  ) {
    try {
      await addDoc(
        collection(
          db,
          "taskLogs"
        ),
        payload
      );

      return true;

    } catch (error) {
      lastError = error;

      await new Promise(
        (resolve) =>
          setTimeout(
            resolve,
            attempt * 500
          )
      );
    }
  }

  console.error(
    "Không ghi được nhật ký nhiệm vụ:",
    lastError
  );

  return false;
}


/*
 * =========================================================
 * LƯU NHIỆM VỤ
 * =========================================================
 */

async function saveTask(event) {
  event.preventDefault();

  if (state.saving) {
    return;
  }

  hideMessage();

  try {
    const values =
      validateForm();

    const assignedBy =
      getUserById(
        values.assignedByUserId
      );

    const owner =
      getUserById(
        values.ownerUserId
      );

    const taskCode =
      createTaskCode();

    setSaving(true);

    showMessage(
      "Đang lưu nhiệm vụ vào hệ thống...",
      "info"
    );

    const taskPayload = {
      taskCode,

      title:
        values.title,

      description:
        values.description,

      sourceType:
        values.sourceType,

      sourceDetail:
        values.sourceDetail,

      assignedByUserId:
        assignedBy.id,

      assignedByName:
        assignedBy.fullName || "",

      primaryDepartmentId:
        values.primaryDepartmentId,

      supportDepartmentIds:
        values.supportDepartmentIds,

      ownerUserId:
        owner.id,

      ownerName:
        owner.fullName || "",

      createdByUserId:
        state.user.uid,

      createdByName:
        state.profile.fullName || "",

      assignedAt:
        Timestamp.fromDate(
          values.assignedAt
        ),

      assignedDateKey:
        getDateKey(
          values.assignedAt
        ),

      assignedMonthKey:
        getMonthKey(
          values.assignedAt
        ),

      assignedWeekKey:
        getIsoWeekKey(
          values.assignedAt
        ),

      deadline:
        Timestamp.fromDate(
          values.deadline
        ),

      deadlineDateKey:
        getDateKey(
          values.deadline
        ),

      priority:
        values.priority,

      status:
        "MOI_TIEP_NHAN",

      progress: 0,

      result: "",

      evidenceLink: "",

      completedAt: null,

      directorEvaluation: "",

      kpiScore: null,

      active: true,

      createdAt:
        serverTimestamp(),

      updatedAt:
        serverTimestamp(),

      updatedByUserId:
        state.user.uid,

      updatedByName:
        state.profile.fullName || ""
    };

    const taskReference =
      await addDoc(
        collection(
          db,
          "tasks"
        ),
        taskPayload
      );

    const logSaved =
      await createTaskLogWithRetry(
        taskReference.id,
        taskCode,
        values.title
      );

    if (logSaved) {
      showMessage(
        `✅ Đã tạo nhiệm vụ ${taskCode}. Đang trở về Dashboard...`,
        "success"
      );
    } else {
      showMessage(
        `✅ Đã tạo nhiệm vụ ${taskCode}, nhưng nhật ký chưa ghi được. Đang trở về Dashboard...`,
        "warning"
      );
    }

    window.setTimeout(
      () => {
        window.location.replace(
          DASHBOARD_URL
        );
      },
      1200
    );

  } catch (error) {
    console.error(
      "Không tạo được nhiệm vụ:",
      error
    );

    const message =
      error &&
      error.code ===
        "permission-denied"
        ? "Tài khoản không có quyền tạo nhiệm vụ với thông tin đã chọn."
        : (
          error &&
          error.message
            ? error.message
            : "Không tạo được nhiệm vụ. Vui lòng thử lại."
        );

    showMessage(
      message,
      "error"
    );

    setSaving(false);
  }
}


/*
 * =========================================================
 * KHỞI TẠO BIỂU MẪU
 * =========================================================
 */

function initializeForm() {
  currentUserInfo.textContent = [
    state.profile.fullName,
    getDepartmentName(
      state.profile.departmentId
    ),
    state.profile.position
  ]
    .filter(Boolean)
    .join(" • ");

  fillAssignedByOptions();

  fillPrimaryDepartmentOptions();

  fillOwnerOptions();

  renderSupportDepartments();

  setDefaultDates();
}


/*
 * =========================================================
 * KHỞI TẠO TRANG
 * =========================================================
 */

async function initializePage(user) {
  try {
    state.user = user;

    state.profile =
      await loadCurrentUserProfile(
        user
      );

    if (
      ![
        "ADMIN",
        "DEPARTMENT_LEADER"
      ].includes(
        state.profile.role
      )
    ) {
      loadingScreen.classList.add(
        "hidden"
      );

      accessDenied.classList.remove(
        "hidden"
      );

      return;
    }

    await loadReferenceData();

    initializeForm();

    loadingScreen.classList.add(
      "hidden"
    );

    appShell.classList.remove(
      "hidden"
    );

  } catch (error) {
    console.error(
      "Không khởi tạo được trang tạo nhiệm vụ:",
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

    goToLogin(
      "profile-error"
    );
  }
}


/*
 * =========================================================
 * SỰ KIỆN GIAO DIỆN
 * =========================================================
 */

primaryDepartmentSelect.addEventListener(
  "change",
  () => {
    fillOwnerOptions();
    renderSupportDepartments();
  }
);


form.addEventListener(
  "submit",
  saveTask
);


backButton.addEventListener(
  "click",
  () => {
    window.location.href =
      DASHBOARD_URL;
  }
);


logoutButton.addEventListener(
  "click",
  async () => {
    logoutButton.disabled = true;

    try {
      await signOut(auth);

      sessionStorage.clear();

      goToLogin(
        "signed-out"
      );

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
 * =========================================================
 * THEO DÕI TRẠNG THÁI ĐĂNG NHẬP
 * =========================================================
 */

onAuthStateChanged(
  auth,
  (user) => {
    if (!user) {
      goToLogin(
        "not-signed-in"
      );

      return;
    }

    initializePage(user);
  }
);
