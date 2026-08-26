/** Chuẩn hóa và kiểm tra dữ liệu form nhiệm vụ. */
import { normalizeSentenceText } from "../../core/text-normalizer.js?v=20260826.V1_18_6";

export function cleanText(value, maxLength = 5000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function cleanTaskSentence(value, maxLength = 5000) {
  return normalizeSentenceText(value, maxLength);
}

export function validateTaskCreateInput(data) {
  const errors = [];
  if (!cleanText(data.title, 300)) errors.push("Vui lòng nhập tên nhiệm vụ.");
  if (!cleanText(data.primaryDepartmentId, 20)) errors.push("Vui lòng chọn Phòng/Khu chịu trách nhiệm chính.");
  if (!(data.deadline instanceof Date) || Number.isNaN(data.deadline.getTime())) errors.push("Vui lòng chọn hạn xử lý hợp lệ.");
  if (data.priority !== "DOT_XUAT") errors.push("Nhiệm vụ phát sinh phải được ghi nhận là nhiệm vụ đột xuất.");
  if (data.workType !== "DOT_XUAT") errors.push("Loại công việc chưa hợp lệ.");

  const assignmentMode = cleanText(data.assignmentMode, 40).toUpperCase();
  if (!["DEPARTMENT", "TEAM_DIRECT", "DEPARTMENT_INTERNAL"].includes(assignmentMode)) {
    errors.push("Phương thức giao nhiệm vụ chưa hợp lệ.");
  }
  if (assignmentMode === "DEPARTMENT") {
    if (cleanText(data.teamId, 80)) errors.push("Giao chung cho Phòng/Khu không được lưu Tổ/Nhóm.");
    if (cleanText(data.ownerUserId, 200)) errors.push("Giao chung cho Phòng/Khu không được lưu người phụ trách cá nhân.");
  }
  if (assignmentMode === "TEAM_DIRECT") {
    if (!cleanText(data.teamId, 80)) errors.push("Ban Giám đốc giao trực tiếp cá nhân phải chọn Tổ/Nhóm trước.");
    if (!cleanText(data.ownerUserId, 200)) errors.push("Ban Giám đốc giao trực tiếp qua Tổ/Nhóm phải chọn người phụ trách.");
  }

  const coefficient = Number(data.difficultyCoefficient);
  if (![1, 1.1, 1.2].some(value => Math.abs(value - coefficient) < 0.000001)) {
    errors.push("Hệ số độ khó chỉ được chọn 100%, 110% hoặc 120%.");
  }
  if (Number(data.baseScore) !== 12) errors.push("Nhiệm vụ đột xuất phải có điểm chuẩn 12.");

  const expected = Math.round(Number(data.baseScore || 0) * coefficient * 100) / 100;
  if (Math.abs(expected - Number(data.maximumConvertedScore || 0)) > 0.000001) {
    errors.push("Điểm tối đa chưa đúng theo điểm chuẩn và hệ số độ khó.");
  }

  if (errors.length) throw new Error(errors.join("\n"));
}

export function validateProgressInput(data, task) {
  const status = cleanText(data?.status, 40).toUpperCase();
  if (!["DANG_XU_LY", "TAM_DUNG", "HOAN_THANH", "MILESTONE_COMPLETED"].includes(status)) {
    throw new Error("Trạng thái cập nhật chưa hợp lệ.");
  }

  const recurringMilestones = ["DAILY", "WEEKLY", "MONTHLY"].includes(String(task?.milestoneMode || "").toUpperCase());
  if (recurringMilestones && status === "HOAN_THANH") {
    throw new Error("Nhiệm vụ định kỳ chỉ được hoàn thành qua mốc cuối cùng; không được kết thúc trực tiếp cả kỳ.");
  }

  if (["HOAN_THANH", "MILESTONE_COMPLETED"].includes(status)) {
    const evidenceRequired = Boolean(task?.mandatoryEvidence || task?.standardTaskMandatoryEvidence || task?.evidenceRequired === true);
    const hasEvidence = Boolean(data?.evidenceUrl || data?.evidenceText || task?.evidenceUrl || task?.evidenceText);
    if (evidenceRequired && !hasEvidence) throw new Error("Đầu việc này bắt buộc phải có minh chứng.");
  }
}
