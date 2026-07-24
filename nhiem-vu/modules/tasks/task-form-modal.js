/** Production 3D - modal tạo nhiệm vụ. */
import { UserContext } from "../../core/user-context.js";
import { Permissions } from "../../core/permissions.js";
import { TaskWriteService } from "../../services/task-write-service.js";
import { UserReadService } from "../../services/user-read-service.js";
import { DepartmentReadService } from "../../services/department-read-service.js";
import { StandardTaskReadService } from "../../services/standard-task-read-service.js";
import { validateTaskCreateInput, cleanText } from "./task-form-validator.js";

function option(value, label, selected = false) {
  return `<option value="${escapeHtml(value)}" ${selected ? "selected" : ""}>${escapeHtml(label)}</option>`;
}

function dateInputValue(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function openTaskCreateModal({ onSaved }) {
  const current = UserContext.requireUser();
  const [users, departments, standardTasks] = await Promise.all([
    UserReadService.listActive(), DepartmentReadService.listActive(), StandardTaskReadService.list()
  ]);
  const canChooseDepartment = Permissions.isAdmin() || Permissions.isDirector();
  const isStaffSelf = Permissions.isStaff();
  const defaultDepartment = canChooseDepartment ? (current.departmentId || "TCHC") : current.departmentId;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 7);

  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop";
  overlay.innerHTML = `
    <section class="modal-panel modal-large" role="dialog" aria-modal="true" aria-labelledby="createTaskTitle">
      <div class="modal-header"><div><span class="page-eyebrow">PRODUCTION 3D</span><h2 id="createTaskTitle">Ghi nhận nhiệm vụ</h2><p>Chọn đầu việc chuẩn hoặc ghi nhận nhiệm vụ ngoài danh mục.</p></div><button class="icon-button" type="button" data-close>✕</button></div>
      <form id="taskCreateForm" class="modal-body task-form-grid">
        <label class="field-full"><span>Đầu việc chuẩn</span><select id="standardTaskCode"><option value="">— Nhiệm vụ ngoài danh mục —</option>${standardTasks.filter(x => x.active !== false).map(x => option(x.code || x.id, `${x.code || x.id} — ${x.name || ""}`)).join("")}</select></label>
        <label class="field-full"><span>Tên nhiệm vụ *</span><input id="taskTitle" maxlength="300" required></label>
        <label class="field-full"><span>Nội dung/Yêu cầu thực hiện</span><textarea id="taskDescription" rows="4" maxlength="5000"></textarea></label>
        <label><span>Phòng/Khu chính *</span><select id="primaryDepartmentId" ${canChooseDepartment ? "" : "disabled"}>${departments.map(d => option(d.id || d.code, d.name || d.id, (d.id || d.code) === defaultDepartment)).join("")}</select></label>
        <label><span>Người phụ trách</span><select id="ownerUserId" ${isStaffSelf ? "disabled" : ""}><option value="">— Giao cấp Phòng/Khu —</option></select></label>
        <label><span>Tổ/Nhóm</span><input id="teamId" placeholder="Ví dụ: BAO_VE"></label>
        <label><span>Hạn xử lý *</span><input id="deadline" type="date" value="${dateInputValue(tomorrow)}" required></label>
        <label><span>Mức độ ưu tiên *</span><select id="priority"><option value="THUONG">Thường</option><option value="QUAN_TRONG">Quan trọng</option><option value="KHAN">Khẩn</option><option value="DOT_XUAT">Đột xuất</option></select></label>
        <label><span>Loại công việc</span><select id="workType"><option value="THUONG_XUYEN">Thường xuyên</option><option value="DOT_XUAT">Đột xuất</option></select></label>
        <label class="field-full"><span>Phòng/Khu phối hợp</span><div id="supportDepartments" class="checkbox-grid">${departments.map(d => `<label class="check-row"><input type="checkbox" value="${escapeHtml(d.id || d.code)}"><span>${escapeHtml(d.name || d.id)}</span></label>`).join("")}</div></label>
        <label class="field-full"><span>Nguồn/Yêu cầu giao việc</span><input id="sourceReference" maxlength="500" placeholder="Ví dụ: Chỉ đạo tại giao ban, kế hoạch, văn bản..."></label>
        <div id="standardTaskSnapshot" class="field-full info-banner hidden"></div>
      </form>
      <div class="modal-footer"><button class="secondary-button" type="button" data-close>Hủy</button><button id="saveTaskButton" class="primary-button" type="button">Lưu nhiệm vụ</button></div>
    </section>`;
  document.body.appendChild(overlay);

  const $ = id => overlay.querySelector(`#${id}`);
  const departmentSelect = $("primaryDepartmentId");
  const ownerSelect = $("ownerUserId");
  const standardSelect = $("standardTaskCode");

  const refreshUsers = () => {
    const dep = departmentSelect.value;
    ownerSelect.innerHTML = `<option value="">— Giao cấp Phòng/Khu —</option>` + UserReadService.byDepartment(users, dep).map(user => option(user.id, `${user.fullName || user.email} — ${user.position || user.role}`, isStaffSelf && user.id === current.uid)).join("");
    if (isStaffSelf) ownerSelect.value = current.uid;
  };
  refreshUsers();
  departmentSelect.addEventListener("change", refreshUsers);

  standardSelect.addEventListener("change", () => {
    const item = standardTasks.find(x => (x.code || x.id) === standardSelect.value);
    const box = $("standardTaskSnapshot");
    if (!item) {
      box.classList.add("hidden");
      box.innerHTML = "";
      return;
    }
    $("taskTitle").value = item.name || "";
    $("taskDescription").value = item.outputRequirement || "";
    $("workType").value = item.workType || "THUONG_XUYEN";
    box.classList.remove("hidden");
    box.innerHTML = `<strong>${escapeHtml(item.code || item.id)}</strong> • Điểm chuẩn ${Number(item.baseScore || 0)} • Hệ số ${Number(item.difficultyCoefficient || 1)} • Điểm tối đa ${Number(item.maximumConvertedScore || 0)}<br><small>Minh chứng: ${escapeHtml(item.mandatoryEvidence || "Không quy định")}</small>`;
  });

  const close = () => overlay.remove();
  overlay.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", close));
  overlay.addEventListener("click", event => { if (event.target === overlay) close(); });

  $("saveTaskButton").addEventListener("click", async () => {
    const button = $("saveTaskButton");
    try {
      button.disabled = true;
      button.textContent = "Đang lưu...";
      const selectedOwner = users.find(user => user.id === ownerSelect.value);
      const standard = standardTasks.find(item => (item.code || item.id) === standardSelect.value);
      const supportDepartmentIds = [...overlay.querySelectorAll("#supportDepartments input:checked")].map(input => input.value);
      const deadline = new Date(`${$("deadline").value}T23:59:59`);
      const data = {
        title: cleanText($("taskTitle").value, 300),
        description: cleanText($("taskDescription").value, 5000),
        primaryDepartmentId: departmentSelect.value || defaultDepartment,
        ownerUserId: selectedOwner?.id || "",
        ownerName: selectedOwner?.fullName || "",
        ownerPosition: selectedOwner?.position || "",
        teamId: cleanText($("teamId").value, 80).toUpperCase(),
        deadline,
        priority: $("priority").value,
        workType: $("workType").value,
        supportDepartmentIds,
        sourceReference: cleanText($("sourceReference").value, 500),
        standardTaskCode: standard?.code || standard?.id || "",
        standardTaskName: standard?.name || "",
        baseScore: standard?.baseScore || 0,
        difficultyCoefficient: standard?.difficultyCoefficient || 1,
        maximumConvertedScore: standard?.maximumConvertedScore || 0,
        mandatoryEvidence: standard?.mandatoryEvidence || "",
        confirmer: standard?.confirmer || ""
      };
      validateTaskCreateInput(data);
      await TaskWriteService.create(data);
      close();
      await onSaved?.();
    } catch (error) {
      window.alert(error?.message || "Không lưu được nhiệm vụ.");
      button.disabled = false;
      button.textContent = "Lưu nhiệm vụ";
    }
  });
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
}
