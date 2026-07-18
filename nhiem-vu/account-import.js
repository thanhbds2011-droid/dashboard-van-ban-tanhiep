import {
  auth,
  db
} from "./firebase-config.js";

import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const ALLOWED_ROLES = new Set([
  "ADMIN",
  "DIRECTOR",
  "DEPARTMENT_LEADER",
  "TCHC_COORDINATOR",
  "STAFF"
]);

const REQUIRED_HEADERS = [
  "email",
  "fullName",
  "departmentId",
  "position",
  "role",
  "employeeCode",
  "active"
];

const state = {
  adminUser: null,
  adminProfile: null,
  departments: new Set(),
  rows: []
};

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: "select_account"
});

const $ = (id) => document.getElementById(id);

const accountBox = $("accountBox");
const loginButton = $("loginButton");
const logoutButton = $("logoutButton");
const loginStatus = $("loginStatus");
const importCard = $("importCard");
const previewCard = $("previewCard");
const csvFile = $("csvFile");
const downloadTemplateButton = $("downloadTemplateButton");
const overwriteExisting = $("overwriteExisting");
const fileStatus = $("fileStatus");
const previewBody = $("previewBody");
const totalCount = $("totalCount");
const validCount = $("validCount");
const invalidCount = $("invalidCount");
const duplicateCount = $("duplicateCount");
const importButton = $("importButton");
const importStatus = $("importStatus");

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeEmail(value) {
  return clean(value).toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showStatus(element, message, type = "info") {
  element.textContent = message;
  element.className = `status ${type}`;
}

function hideStatus(element) {
  element.textContent = "";
  element.className = "status hidden";
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function parseBoolean(value) {
  const normalized = clean(value).toLowerCase();

  if (["true", "1", "yes", "y", "có", "co", "đang hoạt động"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "n", "không", "khong", "ngừng hoạt động"].includes(normalized)) {
    return false;
  }

  return null;
}

/*
 * Bộ phân tích CSV hỗ trợ:
 * - dấu phẩy;
 * - trường có dấu ngoặc kép;
 * - dấu phẩy và xuống dòng nằm trong ngoặc kép.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }

      row.push(field);
      field = "";

      if (row.some((item) => clean(item) !== "")) {
        rows.push(row);
      }

      row = [];
      continue;
    }

    field += char;
  }

  row.push(field);

  if (row.some((item) => clean(item) !== "")) {
    rows.push(row);
  }

  return rows;
}

function rowsToObjects(csvRows) {
  if (csvRows.length < 2) {
    throw new Error("Tệp CSV chưa có dữ liệu.");
  }

  const headers = csvRows[0].map((header) =>
    clean(header).replace(/^\uFEFF/, "")
  );

  const missingHeaders = REQUIRED_HEADERS.filter(
    (header) => !headers.includes(header)
  );

  if (missingHeaders.length > 0) {
    throw new Error(
      `Tệp thiếu cột: ${missingHeaders.join(", ")}. Hãy dùng đúng tệp mẫu.`
    );
  }

  return csvRows.slice(1).map((values, rowIndex) => {
    const record = {};

    headers.forEach((header, columnIndex) => {
      record[header] = values[columnIndex] ?? "";
    });

    return {
      rowNumber: rowIndex + 2,
      raw: record
    };
  });
}

function validateRows(inputRows) {
  const emailCounts = new Map();

  inputRows.forEach(({ raw }) => {
    const email = normalizeEmail(raw.email);
    emailCounts.set(email, (emailCounts.get(email) || 0) + 1);
  });

  return inputRows.map(({ rowNumber, raw }) => {
    const email = normalizeEmail(raw.email);
    const fullName = clean(raw.fullName);
    const departmentId = clean(raw.departmentId).toUpperCase();
    const position = clean(raw.position);
    const role = clean(raw.role).toUpperCase();
    const employeeCode = clean(raw.employeeCode);
    const active = parseBoolean(raw.active);
    const errors = [];

    if (!isValidEmail(email)) {
      errors.push("Email không hợp lệ");
    }

    if (!fullName) {
      errors.push("Thiếu họ tên");
    }

    if (!departmentId) {
      errors.push("Thiếu Phòng/Khu");
    } else if (!state.departments.has(departmentId)) {
      errors.push("Mã Phòng/Khu không tồn tại");
    }

    if (!role) {
      errors.push("Thiếu vai trò");
    } else if (!ALLOWED_ROLES.has(role)) {
      errors.push("Vai trò không hợp lệ");
    }

    if (active === null) {
      errors.push("active phải là true hoặc false");
    }

    const duplicateInFile = email && (emailCounts.get(email) || 0) > 1;

    if (duplicateInFile) {
      errors.push("Email trùng trong tệp");
    }

    return {
      rowNumber,
      email,
      fullName,
      departmentId,
      position,
      role,
      employeeCode,
      active,
      duplicateInFile,
      errors,
      valid: errors.length === 0
    };
  });
}

function renderPreview() {
  const rows = state.rows;
  const validRows = rows.filter((row) => row.valid);
  const invalidRows = rows.filter((row) => !row.valid);
  const duplicateRows = rows.filter((row) => row.duplicateInFile);

  totalCount.textContent = String(rows.length);
  validCount.textContent = String(validRows.length);
  invalidCount.textContent = String(invalidRows.length);
  duplicateCount.textContent = String(duplicateRows.length);

  previewBody.innerHTML = rows.map((row, index) => `
    <tr class="${row.valid ? "" : "error-row"}">
      <td>${index + 1}</td>
      <td>${escapeHtml(row.email)}</td>
      <td>${escapeHtml(row.fullName)}</td>
      <td>${escapeHtml(row.departmentId)}</td>
      <td>${escapeHtml(row.position || "—")}</td>
      <td>${escapeHtml(row.role)}</td>
      <td>
        ${row.valid
          ? "Hợp lệ"
          : escapeHtml(row.errors.join("; "))}
      </td>
    </tr>
  `).join("");

  previewCard.classList.remove("hidden");
  importButton.disabled = validRows.length === 0 || invalidRows.length > 0;

  if (invalidRows.length > 0) {
    showStatus(
      fileStatus,
      `Có ${invalidRows.length} dòng lỗi. Hãy sửa tệp CSV rồi chọn lại.`,
      "error"
    );
  } else {
    showStatus(
      fileStatus,
      `Đã đọc ${validRows.length} tài khoản hợp lệ. Có thể tiến hành nhập.`,
      "success"
    );
  }
}

async function loadDepartments() {
  const snapshot = await getDocs(collection(db, "departments"));
  const departmentIds = new Set();

  snapshot.forEach((item) => {
    const data = item.data();

    if (data.active !== false) {
      departmentIds.add(String(item.id).toUpperCase());
    }
  });

  state.departments = departmentIds;
}

async function verifyAdmin(user) {
  const profileSnapshot = await getDoc(doc(db, "users", user.uid));

  if (!profileSnapshot.exists()) {
    throw new Error("Tài khoản này chưa có hồ sơ trong users.");
  }

  const profile = profileSnapshot.data();

  if (profile.active !== true || profile.role !== "ADMIN") {
    throw new Error("Chỉ tài khoản ADMIN đang hoạt động được sử dụng công cụ này.");
  }

  state.adminUser = user;
  state.adminProfile = profile;

  await loadDepartments();

  accountBox.innerHTML = `
    <strong>${escapeHtml(profile.fullName || user.displayName || "ADMIN")}</strong>
    <span>${escapeHtml(user.email || "")} • ADMIN</span>
  `;

  loginButton.classList.add("hidden");
  logoutButton.classList.remove("hidden");
  importCard.classList.remove("hidden");

  showStatus(
    loginStatus,
    "Đăng nhập quản trị thành công. Có thể chọn tệp CSV.",
    "success"
  );
}

async function importAccounts() {
  const validRows = state.rows.filter((row) => row.valid);

  if (!state.adminUser || state.adminProfile?.role !== "ADMIN") {
    throw new Error("Phiên quản trị không hợp lệ.");
  }

  if (validRows.length === 0) {
    throw new Error("Không có dòng hợp lệ để nhập.");
  }

  importButton.disabled = true;
  importButton.textContent = "Đang kiểm tra tài khoản...";

  try {
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors = [];

    /*
     * Firestore giới hạn batch tối đa 500 thao tác.
     * Chia 400 để có khoảng an toàn.
     */
    const chunkSize = 400;

    for (let start = 0; start < validRows.length; start += chunkSize) {
      const chunk = validRows.slice(start, start + chunkSize);
      const writeRows = [];

      importButton.textContent =
        `Đang kiểm tra ${Math.min(start + chunk.length, validRows.length)}/${validRows.length}...`;

      for (const row of chunk) {
        try {
          const accountRef = doc(db, "accessAccounts", row.email);
          const existing = await getDoc(accountRef);

          if (existing.exists() && !overwriteExisting.checked) {
            skipped += 1;
            continue;
          }

          writeRows.push({
            row,
            accountRef,
            exists: existing.exists()
          });
        } catch (error) {
          errors.push(`Dòng ${row.rowNumber}: ${error.message}`);
        }
      }

      if (writeRows.length === 0) {
        continue;
      }

      const batch = writeBatch(db);

      writeRows.forEach(({ row, accountRef, exists }) => {
        batch.set(
          accountRef,
          {
            employeeCode: row.employeeCode,
            fullName: row.fullName,
            email: row.email,
            departmentId: row.departmentId,
            position: row.position,
            role: row.role,
            active: row.active,
            source: "BULK_CSV_IMPORT",
            updatedAt: serverTimestamp(),
            updatedByUserId: state.adminUser.uid,
            updatedByName:
              state.adminProfile.fullName ||
              state.adminUser.displayName ||
              "ADMIN",
            ...(exists ? {} : {
              createdAt: serverTimestamp(),
              createdByUserId: state.adminUser.uid
            })
          },
          { merge: true }
        );

        if (exists) {
          updated += 1;
        } else {
          created += 1;
        }
      });

      importButton.textContent =
        `Đang ghi ${Math.min(start + chunk.length, validRows.length)}/${validRows.length}...`;

      await batch.commit();
    }

    const message = [
      "Hoàn tất nhập tài khoản.",
      `Tạo mới: ${created}`,
      `Cập nhật: ${updated}`,
      `Bỏ qua đã tồn tại: ${skipped}`,
      `Lỗi: ${errors.length}`
    ];

    if (errors.length > 0) {
      message.push("", errors.slice(0, 10).join("\n"));
    }

    showStatus(
      importStatus,
      message.join("\n"),
      errors.length > 0 ? "warning" : "success"
    );
  } finally {
    importButton.disabled = false;
    importButton.textContent = "Tạo tài khoản hàng loạt";
  }
}

function downloadTemplate() {
  const csvContent = [
    REQUIRED_HEADERS.join(","),
    [
      "nguyenvana@gmail.com",
      "Nguyễn Văn A",
      "TCHC",
      "Chuyên viên",
      "STAFF",
      "VC001",
      "true"
    ].join(","),
    [
      "tranthib@gmail.com",
      "Trần Thị B",
      "CTXH",
      "Phó Trưởng phòng",
      "DEPARTMENT_LEADER",
      "VC002",
      "true"
    ].join(",")
  ].join("\r\n");

  const blob = new Blob(
    ["\uFEFF" + csvContent],
    { type: "text/csv;charset=utf-8" }
  );

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "mau-danh-sach-tai-khoan.csv";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

loginButton.addEventListener("click", async () => {
  hideStatus(loginStatus);
  loginButton.disabled = true;

  try {
    await signInWithPopup(auth, googleProvider);
  } catch (error) {
    showStatus(
      loginStatus,
      error?.message || "Không đăng nhập được bằng Google.",
      "error"
    );
  } finally {
    loginButton.disabled = false;
  }
});

logoutButton.addEventListener("click", async () => {
  await signOut(auth);
});

csvFile.addEventListener("change", async () => {
  hideStatus(fileStatus);
  hideStatus(importStatus);
  previewCard.classList.add("hidden");
  state.rows = [];

  const file = csvFile.files?.[0];

  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    const csvRows = parseCsv(text);
    const objects = rowsToObjects(csvRows);
    state.rows = validateRows(objects);
    renderPreview();
  } catch (error) {
    showStatus(
      fileStatus,
      error?.message || "Không đọc được tệp CSV.",
      "error"
    );
  }
});

downloadTemplateButton.addEventListener("click", downloadTemplate);

importButton.addEventListener("click", async () => {
  hideStatus(importStatus);

  try {
    await importAccounts();
  } catch (error) {
    showStatus(
      importStatus,
      error?.message || "Không nhập được danh sách tài khoản.",
      "error"
    );
  }
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    state.adminUser = null;
    state.adminProfile = null;
    state.rows = [];

    accountBox.innerHTML = `
      <strong>Chưa đăng nhập</strong>
      <span>Phải sử dụng đúng tài khoản đang có vai trò ADMIN trong hệ thống.</span>
    `;

    loginButton.classList.remove("hidden");
    logoutButton.classList.add("hidden");
    importCard.classList.add("hidden");
    previewCard.classList.add("hidden");
    hideStatus(loginStatus);
    return;
  }

  try {
    await verifyAdmin(user);
  } catch (error) {
    await signOut(auth);

    showStatus(
      loginStatus,
      error?.message || "Tài khoản không có quyền sử dụng công cụ.",
      "error"
    );
  }
});
