/**
 * Quy tắc thời hạn KPI V1.13.0.
 * - Theo tháng + DD: một nhiệm vụ trong kỳ, nhiều mốc DD của từng tháng.
 * - Theo quý + DD: hạn DD của tháng cuối quý tương ứng.
 * - Theo năm + DD/MM: hạn DD/MM của năm tương ứng.
 * - Các chu kỳ phát sinh/không có quy tắc tự động: bắt buộc nhập hạn cụ thể khi đăng ký/giao.
 *
 * Mọi date-key dùng YYYY-MM-DD. Timestamp hạn được neo 23:59:59 múi giờ Việt Nam (+07:00)
 * để không phụ thuộc timezone của thiết bị người dùng.
 */

export const KPI_TIME_ZONE = "Asia/Ho_Chi_Minh";
export const KPI_TIME_ZONE_OFFSET = "+07:00";

function clean(value) {
  return String(value ?? "").trim();
}

function ascii(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/\s+/g, " ")
    .toUpperCase();
}

export function frequencyKind(value) {
  const key = ascii(value);
  if (key.includes("THEO THANG")) return "MONTHLY";
  if (key.includes("THEO QUY")) return "QUARTERLY";
  if (key.includes("THEO NAM")) return "YEARLY";
  return "MANUAL";
}

export function isDateKey(value) {
  const text = clean(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 2000 || year > 2200 || month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(year, month);
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
}

function dateParts(dateKey) {
  if (!isDateKey(dateKey)) throw new Error(`Ngày không hợp lệ: ${dateKey || "(trống)"}.`);
  const [year, month, day] = dateKey.split("-").map(Number);
  return { year, month, day };
}

function dateKeyFromParts(year, month, day) {
  const safeDay = Math.min(Math.max(1, Number(day)), daysInMonth(year, month));
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;
}

export function normalizeCompletionDeadline(value, frequency) {
  const kind = frequencyKind(frequency);
  const text = clean(value);

  if (kind === "MONTHLY" || kind === "QUARTERLY") {
    if (!text) return "";
    const match = /^(\d{1,2})$/.exec(text);
    if (!match) throw new Error("Thời hạn hoàn thành của đầu việc Theo tháng/Theo quý phải là ngày trong tháng, ví dụ 05 hoặc 25.");
    const day = Number(match[1]);
    if (day < 1 || day > 31) throw new Error("Ngày hoàn thành phải từ 01 đến 31.");
    return String(day).padStart(2, "0");
  }

  if (kind === "YEARLY") {
    if (!text) return "";
    const match = /^(\d{1,2})\/(\d{1,2})$/.exec(text);
    if (!match) throw new Error("Thời hạn hoàn thành của đầu việc Theo năm phải theo dạng DD/MM, ví dụ 31/12.");
    const day = Number(match[1]);
    const month = Number(match[2]);
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth(2000, month)) {
      throw new Error("Ngày/tháng hoàn thành theo năm không hợp lệ.");
    }
    return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}`;
  }

  // Chu kỳ phát sinh/khác không dùng cột này để tự suy ra deadline.
  return text.slice(0, 30);
}

export function validateDeadlineConfiguration(frequency, completionDeadline) {
  const kind = frequencyKind(frequency);
  const normalized = normalizeCompletionDeadline(completionDeadline, frequency);
  if (["MONTHLY", "QUARTERLY", "YEARLY"].includes(kind) && !normalized) {
    const label = kind === "MONTHLY" ? "Theo tháng" : kind === "QUARTERLY" ? "Theo quý" : "Theo năm";
    throw new Error(`Đầu việc ${label} bắt buộc có “Thời hạn hoàn thành”.`);
  }
  return { kind, completionDeadline: normalized };
}

export function requiresManualDeadline(frequency) {
  return frequencyKind(frequency) === "MANUAL";
}

export function deadlineDateFromKey(dateKey) {
  if (!isDateKey(dateKey)) return null;
  return new Date(`${dateKey}T23:59:59${KPI_TIME_ZONE_OFFSET}`);
}

export function deriveDeadlinePlan({
  frequency,
  completionDeadline,
  periodStartDate,
  periodEndDate,
  manualDeadlineDateKey = ""
} = {}) {
  const start = dateParts(periodStartDate);
  const end = dateParts(periodEndDate);
  const { kind, completionDeadline: normalized } = validateDeadlineConfiguration(frequency, completionDeadline);

  if (kind === "MONTHLY") {
    const day = Number(normalized);
    const milestones = [];
    let year = start.year;
    let month = start.month;
    while (year < end.year || (year === end.year && month <= end.month)) {
      const key = dateKeyFromParts(year, month, day);
      if (key >= periodStartDate && key <= periodEndDate) milestones.push(key);
      month += 1;
      if (month > 12) { month = 1; year += 1; }
    }
    if (!milestones.length) {
      throw new Error("Không tạo được mốc tháng nằm trong kỳ KPI hiện tại. Hãy kiểm tra kỳ đánh giá và Thời hạn hoàn thành.");
    }
    return {
      mode: "MONTHLY_MILESTONES",
      completionDeadline: normalized,
      deadlineDateKey: milestones[milestones.length - 1],
      milestoneDateKeys: milestones
    };
  }

  if (kind === "QUARTERLY") {
    const day = Number(normalized);
    const quarter = Math.floor((end.month - 1) / 3) + 1;
    const lastMonth = quarter * 3;
    return {
      mode: "SINGLE_AUTO",
      completionDeadline: normalized,
      deadlineDateKey: dateKeyFromParts(end.year, lastMonth, day),
      milestoneDateKeys: []
    };
  }

  if (kind === "YEARLY") {
    const [day, month] = normalized.split("/").map(Number);
    return {
      mode: "SINGLE_AUTO",
      completionDeadline: normalized,
      deadlineDateKey: dateKeyFromParts(end.year, month, day),
      milestoneDateKeys: []
    };
  }

  if (!isDateKey(manualDeadlineDateKey)) {
    throw new Error("Đầu việc này không có quy tắc hạn tự động. Hãy nhập Hạn hoàn thành cụ thể khi đăng ký/giao nhiệm vụ.");
  }
  return {
    mode: "SINGLE_MANUAL",
    completionDeadline: normalized,
    deadlineDateKey: clean(manualDeadlineDateKey),
    milestoneDateKeys: []
  };
}

export function deadlineRuleDescription(frequency, completionDeadline) {
  const kind = frequencyKind(frequency);
  const value = clean(completionDeadline);
  if (kind === "MONTHLY") return value ? `Ngày ${value} mỗi tháng trong kỳ` : "Thiếu ngày hoàn thành mỗi tháng";
  if (kind === "QUARTERLY") return value ? `Ngày ${value} của tháng cuối quý` : "Thiếu ngày hoàn thành quý";
  if (kind === "YEARLY") return value ? `Ngày ${value} của năm` : "Thiếu ngày/tháng hoàn thành năm";
  return "Nhập hạn hoàn thành cụ thể khi đăng ký/giao nhiệm vụ";
}
