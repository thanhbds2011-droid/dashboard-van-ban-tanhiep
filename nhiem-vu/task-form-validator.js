/** Production 3D - chuẩn hóa và kiểm tra dữ liệu form nhiệm vụ. */

export function cleanText(value, maxLength = 5000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function validateTaskCreateInput(data) {
  const errors = [];
  if (!cleanText(data.title, 300)) errors.push("Vui lòng nhập tên nhiệm vụ.");
  if (!cleanText(data.primaryDepartmentId, 20)) errors.push("Vui lòng chọn Phòng/Khu chịu trách nhiệm chính.");
  if (!(data.deadline instanceof Date) || Number.isNaN(data.deadline.getTime())) errors.push("Vui lòng chọn hạn xử lý hợp lệ.");
  if (!['THUONG','QUAN_TRONG','KHAN','DOT_XUAT'].includes(data.priority)) errors.push("Mức độ ưu tiên không hợp lệ.");
  if (!['THUONG_XUYEN','DOT_XUAT'].includes(data.workType)) errors.push("Loại công việc không hợp lệ.");
  if (errors.length) throw new Error(errors.join("\n"));
}

export function validateProgressInput(data, task) {
  const progress = Number(data.progress);
  if (!Number.isFinite(progress) || progress < 0 || progress > 100) {
    throw new Error("Tiến độ phải từ 0 đến 100%.");
  }
  if (data.status === "HOAN_THANH") {
    if (progress !== 100) throw new Error("Nhiệm vụ hoàn thành phải có tiến độ 100%.");
    if (!cleanText(data.resultSummary, 5000)) throw new Error("Vui lòng nhập kết quả thực hiện.");
    const evidenceRequired = Boolean(task?.mandatoryEvidence) || task?.evidenceRequired === true;
    const hasEvidence = Boolean(data.evidenceUrl || data.evidenceText || task?.evidenceUrl || task?.evidenceText);
    if (evidenceRequired && !hasEvidence) throw new Error("Đầu việc này bắt buộc phải có minh chứng.");
  } else if (progress === 100) {
    throw new Error("Mốc 100% chỉ áp dụng khi chọn trạng thái Hoàn thành.");
  }
}
