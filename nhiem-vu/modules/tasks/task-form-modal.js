/** Biểu mẫu giao nhiệm vụ phát sinh/đột xuất. */
import { UserContext } from "../../core/user-context.js";
import { Permissions } from "../../core/permissions.js?v=20260804.V1_8_2";
import { TaskWriteService } from "../../services/task-write-service.js?v=20260804.V1_8_2";
import { UserReadService } from "../../services/user-read-service.js";
import { DepartmentReadService } from "../../services/department-read-service.js";
import { validateTaskCreateInput, cleanText } from "./task-form-validator.js?v=20260804.V1_8_2";
import { mountTaskAiAssistant } from "../../ai-assistant.js?v=20260804.V1_8_2";
import { ToastService } from "../../core/toast-service.js";

const DIRECT_TASK_BASE_SCORE = 12;
const DIFFICULTY_OPTIONS = Object.freeze([
  { value: 1, label: "100%" },
  { value: 1.1, label: "110%" },
  { value: 1.2, label: "120%" }
]);

const TEAM_LABELS = Object.freeze({
  BAO_VE: "Tổ Bảo vệ",
  DIEN_NUOC: "Tổ Điện nước",
  HAU_CAN: "Tổ Hậu cần"
});

function option(value, label, selected = false) {
  return `<option value="${escapeHtml(value)}" ${selected ? "selected" : ""}>${escapeHtml(label)}</option>`;
}

function dateInputValue(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function normalizeTeamId(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function teamLabel(teamId) {
  const normalized = normalizeTeamId(teamId);
  if (!normalized) return "";
  if (TEAM_LABELS[normalized]) return TEAM_LABELS[normalized];
  return normalized
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function listDepartmentTeams(users, departmentId) {
  const values = new Map();
  for (const user of users || []) {
    if (String(user.departmentId || "") !== String(departmentId || "")) continue;
    const id = normalizeTeamId(user.teamId);
    if (!id) continue;
    values.set(id, teamLabel(id));
  }
  return [...values.entries()]
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "vi"));
}

function formatScore(value) {
  return Number(value || 0).toLocaleString("vi-VN", { maximumFractionDigits: 2 });
}

function departmentPrefix(value) {
  return String(value || "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase() || "NV";
}

export async function openTaskCreateModal({ onSaved }) {
  const current = UserContext.requireUser();
  const [users, departments] = await Promise.all([
    UserReadService.listActive(),
    DepartmentReadService.listActive()
  ]);

  const canChooseDepartment = Permissions.isAdmin() || Permissions.isDirector();
  const defaultDepartment = canChooseDepartment
    ? (current.departmentId || "TCHC")
    : current.departmentId;
  const deadline = new Date();
  deadline.setDate(deadline.getDate() + 7);

  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop";
  overlay.innerHTML = `
    <section class="modal-panel modal-large" role="dialog" aria-modal="true" aria-labelledby="createTaskTitle">
      <div class="modal-header">
        <div>
          <span class="page-eyebrow">NHIỆM VỤ PHÁT SINH</span>
          <h2 id="createTaskTitle">Giao nhiệm vụ đột xuất</h2>
          <p>Ghi nhận nhiệm vụ phát sinh và tự động tính vào tổng điểm nhiệm vụ được giao trong kỳ.</p>
        </div>
        <button class="icon-button" type="button" data-close>✕</button>
      </div>
      <form id="taskCreateForm" class="modal-body task-form-grid">
        <div id="taskCodeHint" class="field-full info-banner">
          Mã nhiệm vụ sẽ được cấp tự động theo Phòng/Khu, bắt đầu từ số tiếp theo sau danh mục hiện có.
        </div>
        <label class="field-full"><span>Tên nhiệm vụ *</span><input id="taskTitle" maxlength="300" required></label>
        <label class="field-full"><span>Nội dung/Yêu cầu thực hiện</span><textarea id="taskDescription" rows="4" maxlength="5000"></textarea></label>
        <label class="field-full"><span>Sản phẩm đầu ra dự kiến</span><textarea id="expectedOutput" rows="2" maxlength="3000" placeholder="Ví dụ: Báo cáo, hồ sơ, văn bản, danh sách hoặc sản phẩm cuối cùng phải bàn giao"></textarea></label>
        <label class="field-full"><span>Kết quả/tiêu chí nghiệm thu</span><textarea id="resultRequirement" rows="2" maxlength="3000" placeholder="Nêu rõ mức hoàn thành, chất lượng, số lượng hoặc điều kiện được xem là hoàn thành"></textarea></label>
        <section id="sixClearDirective" class="field-full six-clear-directive" aria-label="Chỉ đạo theo tinh thần 6 rõ">
          <div class="six-clear-heading"><strong>Chỉ đạo theo tinh thần 6 rõ</strong><span>Luôn hiển thị để người giao kiểm tra trước khi lưu.</span></div>
          <div class="six-clear-grid">
            <div><b>Rõ người</b><span id="sixClearPerson">Giao cấp Phòng/Khu</span></div>
            <div><b>Rõ việc</b><span id="sixClearWork">Chưa nhập tên nhiệm vụ</span></div>
            <div><b>Rõ thời gian</b><span id="sixClearTime">${dateInputValue(deadline)}</span></div>
            <div><b>Rõ trách nhiệm</b><span id="sixClearResponsibility">Phòng/Khu chính chịu trách nhiệm tổ chức thực hiện</span></div>
            <div><b>Rõ sản phẩm</b><span id="sixClearProduct">Chưa nhập sản phẩm đầu ra</span></div>
            <div><b>Rõ kết quả</b><span id="sixClearResult">Chưa nhập tiêu chí nghiệm thu</span></div>
          </div>
        </section>
        <label><span>Phòng/Khu chính *</span><select id="primaryDepartmentId" ${canChooseDepartment ? "" : "disabled"}>${departments.map(d => option(d.id || d.code, d.name || d.id, (d.id || d.code) === defaultDepartment)).join("")}</select></label>
        <label id="teamField" class="task-team-field" hidden><span>Tổ/Nhóm</span><select id="teamId"><option value="">— Không chọn Tổ/Nhóm —</option></select></label>
        <label><span>Người phụ trách</span><select id="ownerUserId"><option value="">— Giao cấp Phòng/Khu —</option></select></label>
        <label><span>Hạn xử lý *</span><input id="deadline" type="date" value="${dateInputValue(deadline)}" required></label>
        <label><span>Hệ số độ khó *</span><select id="difficultyCoefficient">${DIFFICULTY_OPTIONS.map(item => option(item.value, item.label, item.value === 1)).join("")}</select></label>
        <label class="field-full"><span>Cách theo dõi trong kỳ</span><select id="trackingMode"><option value="FINAL_OUTPUT">Theo sản phẩm/kết quả cuối cùng</option><option value="ITEMIZED">Theo từng lượt công việc phát sinh</option></select></label>
        <label id="workItemTypeField" class="field-full" hidden><span>Nội dung chi tiết cần theo dõi</span><select id="workItemType"><option value="GENERIC">Công việc phát sinh thông thường</option><option value="DOCUMENT">Văn bản/hồ sơ được giao</option><option value="QUANTITY">Sản lượng theo tháng và kết quả quý</option><option value="ATTENDANCE">Buổi hoạt động và tình trạng tham dự</option></select></label>
        <label id="quantityUnitField" class="field-full" hidden><span>Đơn vị sản lượng</span><input id="quantityUnit" maxlength="80" placeholder="Ví dụ: kg rau, suất ăn, hồ sơ"></label>
        <div class="task-score-preview">
          <span>Điểm chuẩn nhiệm vụ đột xuất</span>
          <strong id="directTaskScore">${formatScore(DIRECT_TASK_BASE_SCORE)}</strong>
          <small>Điểm tối đa = 12 × hệ số độ khó.</small>
        </div>
        <label class="field-full"><span>Phòng/Khu phối hợp</span><div id="supportDepartments" class="checkbox-grid">${departments.map(d => `<label class="check-row"><input type="checkbox" value="${escapeHtml(d.id || d.code)}"><span>${escapeHtml(d.name || d.id)}</span></label>`).join("")}</div></label>
        <label class="field-full"><span>Nguồn/Yêu cầu giao việc</span><input id="sourceReference" maxlength="500" placeholder="Ví dụ: Chỉ đạo tại giao ban, kế hoạch, văn bản..."></label>
      </form>
      <div class="modal-footer">
        <button class="secondary-button" type="button" data-close>Hủy</button>
        <button id="saveTaskButton" class="primary-button" type="button">Lưu nhiệm vụ</button>
      </div>
    </section>`;

  document.body.appendChild(overlay);
  document.body.classList.add("modal-open");

  const $ = id => overlay.querySelector(`#${id}`);
  const departmentSelect = $("primaryDepartmentId");
  const teamSelect = $("teamId");
  const teamField = $("teamField");
  const ownerSelect = $("ownerUserId");
  const coefficientSelect = $("difficultyCoefficient");
  const trackingModeSelect = $("trackingMode");
  const workItemTypeSelect = $("workItemType");

  const refreshSixClear = () => {
    const selectedOwner = users.find(user => user.id === ownerSelect.value);
    const departmentName = departmentSelect.options?.[departmentSelect.selectedIndex]?.textContent || defaultDepartment;
    const person = selectedOwner?.fullName || `Cấp ${departmentName}`;
    const title = cleanText($("taskTitle")?.value, 300) || "Chưa nhập tên nhiệm vụ";
    const output = cleanText($("expectedOutput")?.value, 3000) || "Chưa nhập sản phẩm đầu ra";
    const result = cleanText($("resultRequirement")?.value, 3000) || "Chưa nhập tiêu chí nghiệm thu";
    const deadlineValue = $("deadline")?.value || "Chưa chọn hạn";
    $("sixClearPerson").textContent = person;
    $("sixClearWork").textContent = title;
    $("sixClearTime").textContent = deadlineValue;
    $("sixClearResponsibility").textContent = `${departmentName} chịu trách nhiệm chính; ${person} chịu trách nhiệm thực hiện và báo cáo.`;
    $("sixClearProduct").textContent = output;
    $("sixClearResult").textContent = result;
  };

  const refreshCodeHint = () => {
    const prefix = departmentPrefix(departmentSelect.value || defaultDepartment);
    const hint = $("taskCodeHint");
    if (hint) {
      hint.innerHTML = `Mã nhiệm vụ sẽ được cấp tự động theo Phòng/Khu: <strong>${escapeHtml(prefix)}…</strong> (ví dụ ${escapeHtml(prefix)}28, ${escapeHtml(prefix)}29).`;
    }
  };

  const refreshTeams = () => {
    const departmentId = departmentSelect.value || defaultDepartment;
    const previous = normalizeTeamId(teamSelect.value);
    const teams = listDepartmentTeams(users, departmentId);
    const hasTeams = teams.length > 0;
    teamField.hidden = !hasTeams;
    teamSelect.disabled = !hasTeams;
    teamSelect.innerHTML = hasTeams
      ? `<option value="">— Không chọn Tổ/Nhóm —</option>${teams.map(team => option(team.id, team.label, team.id === previous)).join("")}`
      : `<option value="">— Không áp dụng —</option>`;
    if (!hasTeams) teamSelect.value = "";
    if (previous && teams.some(team => team.id === previous)) teamSelect.value = previous;
  };

  const refreshUsers = () => {
    const departmentId = departmentSelect.value || defaultDepartment;
    const selectedTeam = normalizeTeamId(teamSelect.value);
    const previousOwnerId = ownerSelect.value;
    const candidates = UserReadService.byDepartment(users, departmentId)
      .filter(user => !selectedTeam || normalizeTeamId(user.teamId) === selectedTeam);

    ownerSelect.innerHTML = `<option value="">— Giao cấp Phòng/Khu —</option>` + candidates
      .map(user => option(
        user.id,
        `${user.fullName || user.email} — ${user.position || user.role}${user.teamId ? ` • ${teamLabel(user.teamId)}` : ""}`,
        user.id === previousOwnerId
      ))
      .join("");

    if (previousOwnerId && candidates.some(user => user.id === previousOwnerId)) {
      ownerSelect.value = previousOwnerId;
    }
  };

  const refreshSupportDepartments = () => {
    const primary = departmentSelect.value || defaultDepartment;
    overlay.querySelectorAll("#supportDepartments input[type='checkbox']").forEach(input => {
      const isPrimary = input.value === primary;
      input.disabled = isPrimary;
      if (isPrimary) input.checked = false;
      input.closest("label")?.classList.toggle("disabled", isPrimary);
    });
  };

  const refreshScore = () => {
    const coefficient = Number(coefficientSelect.value || 1);
    $("directTaskScore").textContent = formatScore(DIRECT_TASK_BASE_SCORE * coefficient);
  };

  const refreshTrackingFields = () => {
    const itemized = trackingModeSelect.value === "ITEMIZED";
    $("workItemTypeField").hidden = !itemized;
    $("quantityUnitField").hidden = !itemized || workItemTypeSelect.value !== "QUANTITY";
  };

  refreshCodeHint();
  refreshTeams();
  refreshUsers();
  refreshSupportDepartments();
  refreshScore();
  refreshTrackingFields();
  refreshSixClear();

  departmentSelect.addEventListener("change", () => {
    refreshCodeHint();
    refreshTeams();
    refreshUsers();
    refreshSupportDepartments();
    refreshSixClear();
  });
  teamSelect.addEventListener("change", () => { refreshUsers(); refreshSixClear(); });
  ownerSelect.addEventListener("change", () => {
    const owner = users.find(user => user.id === ownerSelect.value);
    const ownerTeam = normalizeTeamId(owner?.teamId);
    if (ownerTeam && !teamSelect.disabled) {
      teamSelect.value = ownerTeam;
      refreshUsers();
      ownerSelect.value = owner?.id || "";
    }
    refreshSixClear();
  });
  coefficientSelect.addEventListener("change", refreshScore);
  trackingModeSelect.addEventListener("change", refreshTrackingFields);
  workItemTypeSelect.addEventListener("change", refreshTrackingFields);
  ["taskTitle", "expectedOutput", "resultRequirement", "deadline"].forEach(id => {
    $(id)?.addEventListener("input", refreshSixClear);
    $(id)?.addEventListener("change", refreshSixClear);
  });

  const unmountAi = mountTaskAiAssistant(overlay);

  const close = () => {
    try { unmountAi?.(); } catch (_) { /* Không cần xử lý khi đóng modal. */ }
    overlay.remove();
    document.body.classList.remove("modal-open");
  };
  overlay.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", close));
  overlay.addEventListener("click", event => { if (event.target === overlay) close(); });

  $("saveTaskButton").addEventListener("click", async () => {
    const button = $("saveTaskButton");
    try {
      button.disabled = true;
      button.textContent = "Đang lưu...";
      const selectedOwner = users.find(user => user.id === ownerSelect.value);
      const supportDepartmentIds = [...overlay.querySelectorAll("#supportDepartments input:checked")]
        .map(input => input.value);
      const dueDate = new Date(`${$("deadline").value}T23:59:59`);
      const coefficient = Number(coefficientSelect.value || 1);

      const data = {
        title: cleanText($("taskTitle").value, 300),
        description: cleanText($("taskDescription").value, 5000),
        expectedOutput: cleanText($("expectedOutput").value, 3000),
        resultRequirement: cleanText($("resultRequirement").value, 3000),
        primaryDepartmentId: departmentSelect.value || defaultDepartment,
        ownerUserId: selectedOwner?.id || "",
        ownerName: selectedOwner?.fullName || "",
        ownerPosition: selectedOwner?.position || "",
        teamId: normalizeTeamId(teamSelect.value || selectedOwner?.teamId),
        deadline: dueDate,
        priority: "DOT_XUAT",
        workType: "DOT_XUAT",
        supportDepartmentIds,
        sourceType: "GIAO_NHIEM_VU_DOT_XUAT",
        sourceReference: cleanText($("sourceReference").value, 500),
        standardTaskCode: "",
        standardTaskName: "",
        baseScore: DIRECT_TASK_BASE_SCORE,
        difficultyCoefficient: coefficient,
        maximumConvertedScore: Math.round(DIRECT_TASK_BASE_SCORE * coefficient * 100) / 100,
        mandatoryEvidence: "",
        trackingMode: trackingModeSelect.value,
        workItemType: workItemTypeSelect.value,
        quantityUnit: cleanText($("quantityUnit").value, 80),
        confirmer: current.fullName || ""
      };

      validateTaskCreateInput(data);
      const created = await TaskWriteService.create(data);
      ToastService.success(`Đã giao nhiệm vụ ${created.taskCode || ""} thành công.`);
      close();
      await onSaved?.();
    } catch (error) {
      ToastService.error(error?.message || "Không lưu được nhiệm vụ.");
      button.disabled = false;
      button.textContent = "Lưu nhiệm vụ";
    }
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
