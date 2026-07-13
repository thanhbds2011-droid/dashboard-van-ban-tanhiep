import {
  auth,
  db
} from "./firebase-config.js?v=20260713.5";

import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocsFromServer,
  query,
  serverTimestamp,
  Timestamp,
  where
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";


const PORTAL_URL = "../index.html";


const state = {
  user: null,
  profile: null,
  departments: [],
  users: [],
  tasks: [],
  loading: false,
  saving: false,
  initializedUid: null
};


const $ = (id) => document.getElementById(id);

const loadingView = $("loadingView");
const loginView = $("loginView");
const appView = $("appView");

const loginForm = $("loginForm");
const loginEmail = $("loginEmail");
const loginPassword = $("loginPassword");
const loginButton = $("loginButton");
const loginMessage = $("loginMessage");

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
const refreshButton = $("refreshButton");
const addTaskButton = $("addTaskButton");

const lastUpdated = $("lastUpdated");
const dashboardMessage = $("dashboardMessage");
const taskCount = $("taskCount");
const taskList = $("taskList");
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
const supportDepartments = $("supportDepartments");

const assignedAt = $("assignedAt");
const deadline = $("deadline");


/*
 * =========================================================
 * HIỂN THỊ GIAO DIỆN
 * =========================================================
 */

function showView(name) {
  loadingView.classList.toggle(
    "hidden",
    name !== "loading"
  );

  loginView.classList.toggle(
    "hidden",
    name !== "login"
  );

  appView.classList.toggle(
    "hidden",
    name !== "app"
  );
}


function showMessage(
  element,
  text,
  type = "info"
) {
  element.textContent = text;
  element.className =
    `message show ${type}`;
}


function hideMessage(element) {
  element.textContent = "";
  element.className = "message";
}


/*
 * =========================================================
 * HÀM XỬ LÝ CHUỖI
 * =========================================================
 */

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}


function cleanText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}


/*
 * =========================================================
 * XỬ LÝ NGÀY THÁNG
 * =========================================================
 */

function pad2(value) {
  return String(value).padStart(2, "0");
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

  return Number.isNaN(
    parsed.getTime()
  )
    ? null
    : parsed;
}


function startOfDay(date) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );
}


function formatDate(value) {
  const dateValue =
    toDate(value);

  if (!dateValue) {
    return "Chưa xác định";
  }

  return new Intl.DateTimeFormat(
    "vi-VN",
    {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }
  ).format(dateValue);
}


function formatDateTime(
  value = new Date()
) {
  return new Intl.DateTimeFormat(
    "vi-VN",
    {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }
  ).format(value);
}


function toLocalDateTimeInput(
  dateValue
) {
  return (
    `${dateValue.getFullYear()}-` +
    `${pad2(dateValue.getMonth() + 1)}-` +
    `${pad2(dateValue.getDate())}T` +
    `${pad2(dateValue.getHours())}:` +
    `${pad2(dateValue.getMinutes())}`
  );
}


function toDateInput(dateValue) {
  return (
    `${dateValue.getFullYear()}-` +
    `${pad2(dateValue.getMonth() + 1)}-` +
    `${pad2(dateValue.getDate())}`
  );
}


function parseLocalDate(
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

  const dateValue = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0
  );

  return Number.isNaN(
    dateValue.getTime()
  )
    ? null
    : dateValue;
}


function dateKey(dateValue) {
  return (
    `${dateValue.getFullYear()}-` +
    `${pad2(dateValue.getMonth() + 1)}-` +
    `${pad2(dateValue.getDate())}`
  );
}


function monthKey(dateValue) {
  return (
    `${dateValue.getFullYear()}-` +
    `${pad2(dateValue.getMonth() + 1)}`
  );
}


function weekKey(dateValue) {
  const utc = new Date(
    Date.UTC(
      dateValue.getFullYear(),
      dateValue.getMonth(),
      dateValue.getDate()
    )
  );

  const day =
    utc.getUTCDay() || 7;

  utc.setUTCDate(
    utc.getUTCDate() +
    4 -
    day
  );

  const yearStart =
    new Date(
      Date.UTC(
        utc.getUTCFullYear(),
        0,
        1
      )
    );

  const week =
    Math.ceil(
      (
        (
          (utc - yearStart) /
          86400000
        ) + 1
      ) / 7
    );

  return (
    `${utc.getUTCFullYear()}` +
    `-W${pad2(week)}`
  );
}


/*
 * =========================================================
 * TẠO MÃ NHIỆM VỤ
 * =========================================================
 */

function createTaskCode() {
  const now = new Date();

  const random =
    Math.random()
      .toString(36)
      .slice(2, 5)
      .toUpperCase();

  return (
    `NV-` +
    `${now.getFullYear()}` +
    `${pad2(now.getMonth() + 1)}` +
    `${pad2(now.getDate())}-` +
    `${pad2(now.getHours())}` +
    `${pad2(now.getMinutes())}` +
    `${pad2(now.getSeconds())}-` +
    `${random}`
  );
}


/*
 * =========================================================
 * TÊN HIỂN THỊ
 * =========================================================
 */

function roleName(role) {
  return ({
    ADMIN:
      "Quản trị hệ thống",

    DIRECTOR:
      "Ban Giám đốc",

    DEPARTMENT_LEADER:
      "Trưởng/Phó phòng"
  })[role] || role || "Chưa xác định";
}


function statusName(status) {
  return ({
    MOI_TIEP_NHAN:
      "Mới tiếp nhận",

    DANG_THUC_HIEN:
      "Đang thực hiện",

    CHO_PHOI_HOP:
      "Chờ phối hợp",

    HOAN_THANH:
      "Hoàn thành",

    TAM_DUNG:
      "Tạm dừng",

    HUY:
      "Hủy"
  })[status] || status || "Chưa xác định";
}


function priorityName(value) {
  return ({
    THUONG:
      "Thường",

    QUAN_TRONG:
      "Quan trọng",

    KHAN:
      "Khẩn"
  })[value] || value || "Thường";
}


function departmentName(id) {
  const item =
    state.departments.find(
      (department) =>
        department.id === id
    );

  return item
    ? (
      item.name ||
      item.code ||
      item.id
    )
    : (
      id ||
      "Chưa xác định"
    );
}


function userById(uid) {
  return (
    state.users.find(
      (item) =>
        item.id === uid
    ) || null
  );
}


/*
 * =========================================================
 * TÌNH TRẠNG THỜI HẠN
 * =========================================================
 */

function deadlineState(task) {
  if (
    task.status === "HOAN_THANH"
  ) {
    return {
      code: "COMPLETED",
      text: "Đã hoàn thành",
      cls: "green"
    };
  }

  if (
    task.status === "HUY"
  ) {
    return {
      code: "CANCELLED",
      text: "Đã hủy",
      cls: ""
    };
  }

  const due =
    toDate(task.deadline);

  if (!due) {
    return {
      code: "NO_DEADLINE",
      text: "Chưa có hạn",
      cls: ""
    };
  }

  const diff =
    Math.round(
      (
        startOfDay(due) -
        startOfDay(new Date())
      ) / 86400000
    );

  if (diff < 0) {
    return {
      code: "OVERDUE",
      text:
        `Quá hạn ${Math.abs(diff)} ngày`,
      cls: "red"
    };
  }

  if (diff === 0) {
    return {
      code: "DUE_TODAY",
      text: "Đến hạn hôm nay",
      cls: "orange"
    };
  }

  if (diff <= 5) {
    return {
      code: "UPCOMING",
      text: `Còn ${diff} ngày`,
      cls: "blue"
    };
  }

  return {
    code: "IN_TIME",
    text: "Còn hạn",
    cls: ""
  };
}


/*
 * =========================================================
 * ĐỌC HỒ SƠ NGƯỜI DÙNG
 * =========================================================
 */

async function loadProfile(user) {
  const snapshot =
    await getDoc(
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

  const profile =
    snapshot.data();

  if (
    profile.active !== true
  ) {
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

  return {
    id: snapshot.id,
    ...profile
  };
}


/*
 * =========================================================
 * ĐỌC DANH MỤC PHÒNG BAN VÀ NGƯỜI DÙNG
 * =========================================================
 */

async function loadReferenceData() {
  const [
    departmentSnapshot,
    userSnapshot,
    khtcSnapshot
  ] = await Promise.all([
    getDocsFromServer(
      collection(
        db,
        "departments"
      )
    ),

    getDocsFromServer(
      collection(
        db,
        "users"
      )
    ),

    /*
     * Đọc trực tiếp KHTC để bảo đảm
     * Phòng Kế hoạch - Tài chính luôn
     * được kiểm tra từ Firestore.
     */
    getDoc(
      doc(
        db,
        "departments",
        "KHTC"
      )
    )
  ]);


  /*
   * Dùng Map để không bị trùng document.
   */
  const departmentMap =
    new Map();


  departmentSnapshot.forEach(
    (item) => {
      const data =
        item.data();

      /*
       * Chỉ loại phòng có active = false.
       *
       * Cách này vẫn nhận document nếu:
       * - active = true;
       * - hoặc chưa có trường active.
       */
      if (data.active !== false) {
        departmentMap.set(
          item.id,
          {
            id: item.id,
            ...data
          }
        );
      }
    }
  );


  /*
   * Chủ động bổ sung KHTC nếu document tồn tại.
   */
  if (khtcSnapshot.exists()) {
    const khtcData =
      khtcSnapshot.data();

    if (khtcData.active !== false) {
      departmentMap.set(
        "KHTC",
        {
          id: "KHTC",
          ...khtcData
        }
      );
    }
  }


  state.departments =
    Array.from(
      departmentMap.values()
    );


  state.departments.sort(
    (a, b) =>
      Number(a.order || 0) -
      Number(b.order || 0)
  );


  state.users = [];


  userSnapshot.forEach(
    (item) => {
      state.users.push({
        id: item.id,
        ...item.data()
      });
    }
  );


  /*
   * Ghi ra Console để kiểm tra chính xác
   * Firestore đã trả về phòng nào.
   */
  console.log(
    "Danh mục phòng ban đã tải:",
    state.departments.map(
      (item) => ({
        id: item.id,
        name:
          item.name ||
          item.code ||
          item.id,
        active: item.active
      })
    )
  );
}


/*
 * =========================================================
 * HIỂN THỊ THÔNG TIN TÀI KHOẢN
 * =========================================================
 */

function renderAccount() {
  welcomeName.textContent =
    `Xin chào, ${state.profile.fullName}`;

  welcomeDepartment.textContent =
    `${departmentName(
      state.profile.departmentId
    )}${
      state.profile.position
        ? ` • ${state.profile.position}`
        : ""
    }`;

  roleBadge.innerHTML =
    `${escapeHtml(
      roleName(state.profile.role)
    )}` +
    `<span>` +
    `${escapeHtml(
      state.profile.email ||
      state.user.email ||
      ""
    )}` +
    `</span>`;

  addTaskButton.classList.toggle(
    "hidden",
    ![
      "ADMIN",
      "DEPARTMENT_LEADER"
    ].includes(
      state.profile.role
    )
  );
}


/*
 * =========================================================
 * ĐỌC DANH SÁCH NHIỆM VỤ
 * =========================================================
 */
async function loadTasks() {
  if (
    state.loading ||
    !state.profile
  ) {
    return;
  }


  state.loading = true;

  refreshButton.disabled = true;

  hideMessage(
    dashboardMessage
  );


  try {
    /*
     * Tải collection nhiệm vụ một lần.
     *
     * Giai đoạn thử nghiệm có ít dữ liệu,
     * cách này ổn định hơn và không còn
     * xung đột giữa truy vấn với Rules.
     */
    const snapshot =
      await getDocsFromServer(
        collection(
          db,
          "tasks"
        )
      );


    const allTasks = [];


    snapshot.forEach(
      (item) => {
        const task = {
          id: item.id,
          ...item.data()
        };

        if (task.active !== false) {
          allTasks.push(task);
        }
      }
    );


    /*
     * ADMIN và Ban Giám đốc xem toàn bộ.
     */
    if (
      [
        "ADMIN",
        "DIRECTOR"
      ].includes(
        state.profile.role
      )
    ) {
      state.tasks =
        allTasks;

    /*
     * Trưởng/Phó phòng chỉ hiển thị:
     * - nhiệm vụ phòng mình xử lý chính;
     * - hoặc phòng mình được phối hợp;
     * - hoặc có phòng mình trong visibleDepartmentIds.
     */
    } else if (
      state.profile.role ===
      "DEPARTMENT_LEADER"
    ) {
      const departmentId =
        state.profile.departmentId;


      state.tasks =
        allTasks.filter(
          (task) => {
            const isPrimary =
              task.primaryDepartmentId
                === departmentId;


            const isSupport =
              Array.isArray(
                task.supportDepartmentIds
              )
              && task.supportDepartmentIds
                .includes(
                  departmentId
                );


            const isVisible =
              Array.isArray(
                task.visibleDepartmentIds
              )
              && task.visibleDepartmentIds
                .includes(
                  departmentId
                );


            return (
              isPrimary ||
              isSupport ||
              isVisible
            );
          }
        );

    } else {
      throw new Error(
        "Vai trò tài khoản chưa được cấp quyền xem nhiệm vụ."
      );
    }


    state.tasks.sort(
      (a, b) => {
        const aDate =
          toDate(a.updatedAt)
          || toDate(a.createdAt)
          || new Date(0);


        const bDate =
          toDate(b.updatedAt)
          || toDate(b.createdAt)
          || new Date(0);


        return (
          bDate.getTime()
          - aDate.getTime()
        );
      }
    );


    lastUpdated.textContent =
      `Cập nhật lúc ${formatDateTime()}`;


    renderMetrics();

    applyFilters();


    console.log(
      "Tổng nhiệm vụ tải từ Firestore:",
      allTasks.length
    );


    console.log(
      "Nhiệm vụ hiển thị cho tài khoản:",
      state.tasks.length
    );


  } catch (error) {
    console.error(
      "Lỗi tải nhiệm vụ:",
      error
    );


    state.tasks = [];


    renderMetrics();

    applyFilters();


    const text =
      error?.code ===
      "permission-denied"
        ? (
          "Firestore vẫn từ chối quyền đọc. " +
          "Hãy kiểm tra Rules đã bấm Publish thành công."
        )
        : (
          error?.message ||
          "Không tải được dữ liệu nhiệm vụ."
        );


    showMessage(
      dashboardMessage,
      text,
      "error"
    );


  } finally {
    state.loading = false;

    refreshButton.disabled = false;
  }
}
/*
 * =========================================================
 * THỐNG KÊ
 * =========================================================
 */

function renderMetrics() {
  const completed =
    state.tasks.filter(
      (task) =>
        task.status ===
        "HOAN_THANH"
    ).length;

  const processing =
    state.tasks.filter(
      (task) =>
        [
          "MOI_TIEP_NHAN",
          "DANG_THUC_HIEN",
          "CHO_PHOI_HOP"
        ].includes(
          task.status
        )
    ).length;

  const overdue =
    state.tasks.filter(
      (task) =>
        deadlineState(task).code ===
        "OVERDUE"
    ).length;

  metricTotal.textContent =
    String(
      state.tasks.length
    );

  metricCompleted.textContent =
    String(completed);

  metricProcessing.textContent =
    String(processing);

  metricOverdue.textContent =
    String(overdue);
}


/*
 * =========================================================
 * BỘ LỌC
 * =========================================================
 */

function applyFilters() {
  const keyword =
    normalize(
      searchInput.value
    );

  const status =
    statusFilter.value;

  const dueFilter =
    deadlineFilter.value;

  const filtered =
    state.tasks.filter(
      (task) => {
        const content =
          normalize(
            [
              task.taskCode,
              task.title,
              task.description,
              task.ownerName,
              task.assignedByName,
              task.result
            ]
              .filter(Boolean)
              .join(" ")
          );

        const matchKeyword =
          !keyword ||
          content.includes(
            keyword
          );

        const matchStatus =
          status === "ALL" ||
          task.status === status;

        const due =
          deadlineState(task);

        const matchDue =
          dueFilter === "ALL" ||
          (
            dueFilter ===
            "COMPLETED"
              ? (
                task.status ===
                "HOAN_THANH"
              )
              : (
                due.code ===
                dueFilter
              )
          );

        return (
          matchKeyword &&
          matchStatus &&
          matchDue
        );
      }
    );

  renderTasks(filtered);
}


/*
 * =========================================================
 * HIỂN THỊ NHIỆM VỤ
 * =========================================================
 */

function renderTasks(tasks) {
  taskCount.textContent =
    `${tasks.length} nhiệm vụ`;

  emptyState.classList.toggle(
    "hidden",
    tasks.length !== 0
  );

  if (!tasks.length) {
    taskList.innerHTML = "";
    return;
  }

  taskList.innerHTML =
    tasks
      .map(
        (task) => {
          const due =
            deadlineState(task);

          const description =
            cleanText(
              task.description
            );

          const desc =
            description.slice(
              0,
              230
            );

          return `
            <article class="task-card">
              <div class="task-head">

                <div>
                  <div class="task-code">
                    ${escapeHtml(
                      task.taskCode ||
                      "Chưa có mã"
                    )}
                  </div>

                  <h3 class="task-title">
                    ${escapeHtml(
                      task.title ||
                      "Nhiệm vụ chưa có tiêu đề"
                    )}
                  </h3>

                  ${
                    desc
                      ? `
                        <p class="task-desc">
                          ${escapeHtml(desc)}
                          ${
                            description.length > 230
                              ? "..."
                              : ""
                          }
                        </p>
                      `
                      : ""
                  }
                </div>

                <div class="badges">
                  <span class="badge blue">
                    ${escapeHtml(
                      statusName(
                        task.status
                      )
                    )}
                  </span>

                  <span
                    class="badge ${
                      task.priority === "KHAN"
                        ? "red"
                        : (
                          task.priority ===
                          "QUAN_TRONG"
                            ? "orange"
                            : ""
                        )
                    }"
                  >
                    ${escapeHtml(
                      priorityName(
                        task.priority
                      )
                    )}
                  </span>

                  <span
                    class="badge ${due.cls}"
                  >
                    ${escapeHtml(
                      due.text
                    )}
                  </span>
                </div>
              </div>

              <div class="task-meta">

                <div>
                  <div class="meta-label">
                    Phòng xử lý chính
                  </div>

                  <div class="meta-value">
                    ${escapeHtml(
                      departmentName(
                        task.primaryDepartmentId
                      )
                    )}
                  </div>
                </div>

                <div>
                  <div class="meta-label">
                    Lãnh đạo phụ trách
                  </div>

                  <div class="meta-value">
                    ${escapeHtml(
                      task.ownerName ||
                      "Chưa xác định"
                    )}
                  </div>
                </div>

                <div>
                  <div class="meta-label">
                    Hạn hoàn thành
                  </div>

                  <div class="meta-value">
                    ${escapeHtml(
                      formatDate(
                        task.deadline
                      )
                    )}
                  </div>
                </div>

                <div>
                  <div class="meta-label">
                    Người giao/chỉ đạo
                  </div>

                  <div class="meta-value">
                    ${escapeHtml(
                      task.assignedByName ||
                      "Chưa xác định"
                    )}
                  </div>
                </div>

              </div>
            </article>
          `;
        }
      )
      .join("");
}


/*
 * =========================================================
 * DANH SÁCH BAN GIÁM ĐỐC
 * =========================================================
 */

function fillAssignedBy() {
  const directors =
    state.users
      .filter(
        (item) =>
          item.active === true &&
          item.role ===
          "DIRECTOR"
      )
      .sort(
        (a, b) =>
          String(
            a.fullName || ""
          ).localeCompare(
            String(
              b.fullName || ""
            ),
            "vi"
          )
      );

  assignedByUserId.innerHTML =
    '<option value="">Chọn người giao/chỉ đạo</option>';

  directors.forEach(
    (item) => {
      const option =
        document.createElement(
          "option"
        );

      option.value =
        item.id;

      option.textContent =
        [
          item.fullName,
          item.position
        ]
          .filter(Boolean)
          .join(" — ");

      assignedByUserId.appendChild(
        option
      );
    }
  );

  assignedByUserId.disabled =
    directors.length === 0;

  if (!directors.length) {
    assignedByUserId.innerHTML =
      '<option value="">Chưa có tài khoản Ban Giám đốc</option>';
  }
}


/*
 * =========================================================
 * PHÒNG XỬ LÝ CHÍNH
 * =========================================================
 */

function fillPrimaryDepartment() {
  if (
    state.profile.role ===
    "DEPARTMENT_LEADER"
  ) {
    primaryDepartmentId.innerHTML =
      `<option value="${escapeHtml(
        state.profile.departmentId
      )}">` +
      `${escapeHtml(
        departmentName(
          state.profile.departmentId
        )
      )}` +
      `</option>`;

    primaryDepartmentId.value =
      state.profile.departmentId;

    primaryDepartmentId.disabled =
      true;

    primaryHelp.textContent =
      "Phòng xử lý chính được cố định theo tài khoản đăng nhập.";

    return;
  }

  primaryDepartmentId.disabled =
    false;

  primaryDepartmentId.innerHTML =
    '<option value="">Chọn phòng xử lý chính</option>';

  state.departments
    .filter(
      (item) =>
        item.id !== "BGD"
    )
    .forEach(
      (item) => {
        const option =
          document.createElement(
            "option"
          );

        option.value =
          item.id;

        option.textContent =
          item.name ||
          item.code ||
          item.id;

        primaryDepartmentId.appendChild(
          option
        );
      }
    );

  primaryHelp.textContent =
    "Quản trị được chọn phòng xử lý chính.";
}


/*
 * =========================================================
 * LÃNH ĐẠO CHỊU TRÁCH NHIỆM
 * =========================================================
 */

function fillOwner() {
  if (
    state.profile.role ===
    "DEPARTMENT_LEADER"
  ) {
    ownerUserId.innerHTML =
      `<option value="${escapeHtml(
        state.user.uid
      )}">` +
      `${escapeHtml(
        [
          state.profile.fullName,
          state.profile.position
        ]
          .filter(Boolean)
          .join(" — ")
      )}` +
      `</option>`;

    ownerUserId.value =
      state.user.uid;

    ownerUserId.disabled =
      true;

    ownerHelp.textContent =
      "Người chịu trách nhiệm là tài khoản đang đăng nhập.";

    return;
  }

  const departmentId =
    primaryDepartmentId.value;

  ownerUserId.innerHTML =
    '<option value="">Chọn lãnh đạo chịu trách nhiệm</option>';

  if (!departmentId) {
    ownerUserId.disabled =
      true;

    ownerHelp.textContent =
      "Chọn phòng xử lý chính trước.";

    return;
  }

  const leaders =
    state.users.filter(
      (item) =>
        item.active === true &&
        item.role ===
          "DEPARTMENT_LEADER" &&
        item.departmentId ===
          departmentId
    );

  leaders.forEach(
    (item) => {
      const option =
        document.createElement(
          "option"
        );

      option.value =
        item.id;

      option.textContent =
        [
          item.fullName,
          item.position
        ]
          .filter(Boolean)
          .join(" — ");

      ownerUserId.appendChild(
        option
      );
    }
  );

  ownerUserId.disabled =
    leaders.length === 0;

  ownerHelp.textContent =
    leaders.length
      ? (
        "Chọn một Trưởng/Phó phòng chịu trách nhiệm chính."
      )
      : (
        "Phòng này chưa có tài khoản Trưởng/Phó phòng đang hoạt động."
      );
}


/*
 * =========================================================
 * PHÒNG PHỐI HỢP
 * =========================================================
 */

function renderSupportDepartments() {
  const primary =
    primaryDepartmentId.value;

  const list =
    state.departments.filter(
      (item) =>
        item.id !== "BGD" &&
        item.id !== primary
    );

  if (!list.length) {
    supportDepartments.innerHTML =
      '<div class="help">Chưa có phòng phối hợp khác.</div>';

    return;
  }

  supportDepartments.innerHTML =
    list
      .map(
        (item) => `
          <label class="check-item">
            <input
              type="checkbox"
              name="supportDepartmentIds"
              value="${escapeHtml(
                item.id
              )}"
            >

            <span>
              ${escapeHtml(
                item.name ||
                item.code ||
                item.id
              )}
            </span>
          </label>
        `
      )
      .join("");
}


/*
 * =========================================================
 * NGÀY MẶC ĐỊNH
 * =========================================================
 */

function setDefaultDates() {
  const now = new Date();

  const later =
    new Date(now);

  later.setDate(
    later.getDate() + 7
  );

  assignedAt.value =
    toLocalDateTimeInput(now);

  deadline.min =
    toDateInput(now);

  deadline.value =
    toDateInput(later);
}


/*
 * =========================================================
 * MỞ VÀ ĐÓNG BIỂU MẪU
 * =========================================================
 */

async function openTaskModal() {
  hideMessage(
    taskMessage
  );

  taskForm.reset();

  taskModal.classList.remove(
    "hidden"
  );

  document.body.style.overflow =
    "hidden";

  try {
    /*
     * Luôn tải mới danh mục từ Firestore
     * để phòng ban mới thêm được hiển thị ngay.
     */
    await loadReferenceData();

    fillAssignedBy();
    fillPrimaryDepartment();
    fillOwner();
    renderSupportDepartments();
    setDefaultDates();

    taskTitle.focus();

  } catch (error) {
    showMessage(
      taskMessage,
      error?.message ||
      "Không tải được danh mục phòng ban và người dùng.",
      "error"
    );
  }
}


function closeTaskModal() {
  if (state.saving) {
    return;
  }

  taskModal.classList.add(
    "hidden"
  );

  document.body.style.overflow =
    "";
}


function selectedSupportIds() {
  return Array.from(
    document.querySelectorAll(
      'input[name="supportDepartmentIds"]:checked'
    )
  ).map(
    (item) =>
      item.value
  );
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

  hideMessage(
    taskMessage
  );

  try {
    const title =
      cleanText(
        taskTitle.value
      );

    const description =
      cleanText(
        taskDescription.value
      );

    const source =
      sourceType.value;

    const detail =
      cleanText(
        sourceDetail.value
      );

    const assignedBy =
      userById(
        assignedByUserId.value
      );

    const primary =
      primaryDepartmentId.value;

    const owner =
      userById(
        ownerUserId.value
      );

    const assignedDate =
      new Date(
        assignedAt.value
      );

    const deadlineDate =
      parseLocalDate(
        deadline.value,
        true
      );

    const supportIds =
      selectedSupportIds();

    if (!title) {
      throw new Error(
        "Vui lòng nhập tiêu đề nhiệm vụ."
      );
    }

    if (!description) {
      throw new Error(
        "Vui lòng nhập nội dung chi tiết."
      );
    }

    if (!source) {
      throw new Error(
        "Vui lòng chọn nguồn nhiệm vụ."
      );
    }

    if (!detail) {
      throw new Error(
        "Vui lòng nhập chi tiết nguồn nhiệm vụ."
      );
    }

    if (!assignedBy) {
      throw new Error(
        "Vui lòng chọn người giao/chỉ đạo."
      );
    }

    if (!primary) {
      throw new Error(
        "Vui lòng chọn phòng xử lý chính."
      );
    }

    if (!owner) {
      throw new Error(
        "Vui lòng chọn lãnh đạo chịu trách nhiệm."
      );
    }

    if (
      Number.isNaN(
        assignedDate.getTime()
      )
    ) {
      throw new Error(
        "Ngày giao không hợp lệ."
      );
    }

    if (!deadlineDate) {
      throw new Error(
        "Hạn hoàn thành không hợp lệ."
      );
    }

    if (
      deadlineDate <
      assignedDate
    ) {
      throw new Error(
        "Hạn hoàn thành không được trước ngày giao."
      );
    }

    state.saving = true;

    saveTaskButton.disabled =
      true;

    saveTaskButton.textContent =
      "Đang lưu...";

    showMessage(
      taskMessage,
      "Đang lưu nhiệm vụ...",
      "info"
    );

    /*
     * Danh sách phòng được quyền nhìn thấy nhiệm vụ.
     * Bao gồm phòng xử lý chính và các phòng phối hợp.
     */
    const visibleDepartmentIds =
      Array.from(
        new Set([
          primary,
          ...supportIds
        ])
      );

    const taskCode =
      createTaskCode();

    const payload = {
      taskCode,

      title,

      description,

      sourceType:
        source,

      sourceDetail:
        detail,

      assignedByUserId:
        assignedBy.id,

      assignedByName:
        assignedBy.fullName || "",

      primaryDepartmentId:
        primary,

      supportDepartmentIds:
        supportIds,

      visibleDepartmentIds,

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
          assignedDate
        ),

      assignedDateKey:
        dateKey(
          assignedDate
        ),

      assignedMonthKey:
        monthKey(
          assignedDate
        ),

      assignedWeekKey:
        weekKey(
          assignedDate
        ),

      deadline:
        Timestamp.fromDate(
          deadlineDate
        ),

      deadlineDateKey:
        dateKey(
          deadlineDate
        ),

      priority:
        priority.value,

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

    const taskRef =
      await addDoc(
        collection(
          db,
          "tasks"
        ),
        payload
      );

    await addDoc(
      collection(
        db,
        "taskLogs"
      ),
      {
        taskId:
          taskRef.id,

        taskCode,

        action:
          "CREATE_TASK",

        description:
          `Tạo nhiệm vụ: ${title}`,

        oldValue:
          null,

        newValue:
          "MOI_TIEP_NHAN",

        performedByUserId:
          state.user.uid,

        performedByName:
          state.profile.fullName,

        performedAt:
          serverTimestamp()
      }
    );

    showMessage(
      taskMessage,
      `✅ Đã tạo nhiệm vụ ${taskCode}.`,
      "success"
    );

    await loadTasks();

    window.setTimeout(
      closeTaskModal,
      700
    );

  } catch (error) {
    console.error(error);

    const text =
      error?.code ===
      "permission-denied"
        ? (
          "Tài khoản không có quyền tạo nhiệm vụ với thông tin đã chọn. " +
          "Hãy kiểm tra Rules mới."
        )
        : (
          error?.message ||
          "Không tạo được nhiệm vụ."
        );

    showMessage(
      taskMessage,
      text,
      "error"
    );

  } finally {
    state.saving = false;

    saveTaskButton.disabled =
      false;

    saveTaskButton.textContent =
      "Lưu nhiệm vụ";
  }
}


/*
 * =========================================================
 * KHỞI TẠO NGƯỜI DÙNG
 * =========================================================
 */

async function initializeUser(user) {
  if (
    state.initializedUid ===
    user.uid
  ) {
    return;
  }

  state.initializedUid =
    user.uid;

  showView("loading");

  try {
    state.user =
      user;

    state.profile =
      await loadProfile(user);

    await loadReferenceData();

    renderAccount();

    showView("app");

    await loadTasks();

  } catch (error) {
    console.error(error);

    state.initializedUid =
      null;

    try {
      await signOut(auth);
    } catch (_) {
      // Không cần xử lý thêm.
    }

    showView("login");

    showMessage(
      loginMessage,
      error?.message ||
      "Không khởi tạo được tài khoản.",
      "error"
    );
  }
}


/*
 * =========================================================
 * ĐĂNG NHẬP
 * =========================================================
 */

loginForm.addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();

    hideMessage(
      loginMessage
    );

    loginButton.disabled =
      true;

    loginButton.textContent =
      "Đang đăng nhập...";

    try {
      await signInWithEmailAndPassword(
        auth,
        cleanText(
          loginEmail.value
        ).toLowerCase(),
        loginPassword.value
      );

    } catch (error) {
      const message =
        [
          "auth/invalid-credential",
          "auth/user-not-found",
          "auth/wrong-password"
        ].includes(
          error?.code
        )
          ? (
            "Email hoặc mật khẩu không chính xác."
          )
          : (
            error?.code ===
            "auth/too-many-requests"
              ? (
                "Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau."
              )
              : (
                "Không đăng nhập được. Vui lòng kiểm tra lại thông tin."
              )
          );

      showMessage(
        loginMessage,
        message,
        "error"
      );

    } finally {
      loginButton.disabled =
        false;

      loginButton.textContent =
        "Đăng nhập";
    }
  }
);


/*
 * =========================================================
 * ĐĂNG XUẤT
 * =========================================================
 */

logoutButton.addEventListener(
  "click",
  async () => {
    logoutButton.disabled =
      true;

    try {
      await signOut(auth);

      state.initializedUid =
        null;

    } finally {
      logoutButton.disabled =
        false;
    }
  }
);


/*
 * =========================================================
 * SỰ KIỆN GIAO DIỆN
 * =========================================================
 */

portalButton.addEventListener(
  "click",
  () => {
    window.location.href =
      PORTAL_URL;
  }
);


refreshButton.addEventListener(
  "click",
  loadTasks
);


addTaskButton.addEventListener(
  "click",
  openTaskModal
);


closeModalButton.addEventListener(
  "click",
  closeTaskModal
);


cancelTaskButton.addEventListener(
  "click",
  closeTaskModal
);


taskModal.addEventListener(
  "click",
  (event) => {
    if (
      event.target ===
      taskModal
    ) {
      closeTaskModal();
    }
  }
);


primaryDepartmentId.addEventListener(
  "change",
  () => {
    fillOwner();
    renderSupportDepartments();
  }
);


taskForm.addEventListener(
  "submit",
  saveTask
);


searchInput.addEventListener(
  "input",
  applyFilters
);


statusFilter.addEventListener(
  "change",
  applyFilters
);


deadlineFilter.addEventListener(
  "change",
  applyFilters
);


/*
 * =========================================================
 * THEO DÕI TRẠNG THÁI FIREBASE AUTHENTICATION
 * =========================================================
 */

onAuthStateChanged(
  auth,
  (user) => {
    if (!user) {
      state.user = null;
      state.profile = null;
      state.initializedUid = null;

      showView("login");

      return;
    }

    initializeUser(user);
  }
);
