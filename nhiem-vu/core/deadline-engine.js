/**
 * Quy tắc thời hạn KPI V1.16.0.
 *
 * Giá trị Chu kỳ/Tần suất chuẩn duy nhất trên toàn hệ thống:
 * - Theo ngày
 * - Theo tuần
 * - Theo tháng
 * - Theo quý
 * - Theo năm
 * - Khi phát sinh
 *
 * Quy tắc:
 * - Theo ngày: 01 nhiệm vụ trong kỳ, 01 mốc cho mỗi ngày trong kỳ; hạn "Trong ngày".
 * - Theo tuần: 01 nhiệm vụ trong kỳ, 01 mốc vào thứ được cấu hình mỗi tuần.
 * - Theo tháng: 01 nhiệm vụ trong kỳ, 01 mốc DD của từng tháng.
 * - Theo quý: hạn DD của tháng cuối quý tương ứng.
 * - Theo năm: hạn DD/MM của năm tương ứng.
 * - Khi phát sinh: kế hoạch được duyệt khi chưa có deadline task; từng lượt thực tế bắt buộc có hạn riêng.
 *
 * Các tên legacy được nhận diện để đọc/migrate dữ liệu cũ nhưng không được dùng làm lựa chọn mới.
 * Mọi date-key dùng YYYY-MM-DD. Timestamp hạn neo 23:59:59 múi giờ Việt Nam (+07:00).
 */

export const KPI_TIME_ZONE = "Asia/Ho_Chi_Minh";
export const KPI_TIME_ZONE_OFFSET = "+07:00";

export const STANDARD_FREQUENCIES = Object.freeze([
  "Theo ngày",
  "Theo tuần",
  "Theo tháng",
  "Theo quý",
  "Theo năm",
  "Khi phát sinh"
]);

export const WEEKDAY_OPTIONS = Object.freeze([
  "Thứ Hai",
  "Thứ Ba",
  "Thứ Tư",
  "Thứ Năm",
  "Thứ Sáu",
  "Thứ Bảy",
  "Chủ Nhật"
]);

const WEEKDAY_INDEX = Object.freeze({
  "THU HAI": 1,
  "THU 2": 1,
  "2": 1,
  "THU BA": 2,
  "THU 3": 2,
  "3": 2,
  "THU TU": 3,
  "THU 4": 3,
  "4": 3,
  "THU NAM": 4,
  "THU 5": 4,
  "5": 4,
  "THU SAU": 5,
  "THU 6": 5,
  "6": 5,
  "THU BAY": 6,
  "THU 7": 6,
  "7": 6,
  "CHU NHAT": 0,
  "CN": 0,
  "8": 0
});

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

export function canonicalFrequency(value) {
  const key = ascii(value);
  if (!key) return "";

  if (key === "THEO NGAY" || key === "THEO CA/NGAY" || key === "THEO LUOT/NGAY") return "Theo ngày";
  if (key === "THEO TUAN") return "Theo tuần";
  if (key === "THEO THANG") return "Theo tháng";
  if (key === "THEO QUY") return "Theo quý";
  if (key === "THEO NAM") return "Theo năm";

  // Các cách gọi cũ này đều có bản chất: chỉ khi có sự kiện/hồ sơ/văn bản/yêu cầu thực tế mới phát sinh lượt xử lý.
  if (
    key === "KHI PHAT SINH"
    || key === "THEO HO SO"
    || key === "THEO VAN BAN"
    || key === "THEO YEU CAU"
    || key === "THEO YEU CAU CUA VAN BAN"
    || key === "THEO KE HOACH/KHI PHAT SINH"
    || key.includes("KHI PHAT SINH")
  ) return "Khi phát sinh";

  return "";
}

export function isStandardFrequency(value) {
  return Boolean(canonicalFrequency(value));
}

export function frequencyKind(value) {
  const canonical = canonicalFrequency(value);
  if (canonical === "Theo ngày") return "DAILY";
  if (canonical === "Theo tuần") return "WEEKLY";
  if (canonical === "Theo tháng") return "MONTHLY";
  if (canonical === "Theo quý") return "QUARTERLY";
  if (canonical === "Theo năm") return "YEARLY";
  if (canonical === "Khi phát sinh") return "ARISING";
  return "MANUAL";
}

export function isRecurringFrequency(value) {
  return ["DAILY", "WEEKLY", "MONTHLY"].includes(frequencyKind(value));
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

function dateKeyFromUtcDate(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function utcDateFromKey(dateKey) {
  const { year, month, day } = dateParts(dateKey);
  return new Date(Date.UTC(year, month - 1, day));
}

export function normalizeWeekday(value) {
  const key = ascii(value).replace(/\./g, "");
  const index = WEEKDAY_INDEX[key];
  if (index === undefined) return "";
  return index === 0 ? "Chủ Nhật" : WEEKDAY_OPTIONS[index - 1];
}

export function normalizeCompletionDeadline(value, frequency) {
  const kind = frequencyKind(frequency);
  const text = clean(value);

  if (kind === "DAILY") {
    // Theo ngày chỉ có một quy tắc chuẩn duy nhất; không cho người dùng sáng tạo câu chữ.
    return "Trong ngày";
  }

  if (kind === "WEEKLY") {
    const weekday = normalizeWeekday(text);
    if (!weekday) throw new Error("Thời hạn hoàn thành của đầu việc Theo tuần phải chọn một thứ trong tuần.");
    return weekday;
  }

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

  if (kind === "ARISING") return "";

  // Chỉ dùng khi đọc dữ liệu legacy chưa chuẩn hóa; form mới không được lưu MANUAL.
  return text.slice(0, 30);
}

export function validateDeadlineConfiguration(frequency, completionDeadline) {
  const kind = frequencyKind(frequency);
  const normalized = normalizeCompletionDeadline(completionDeadline, frequency);
  if (kind === "WEEKLY" && !normalized) throw new Error("Đầu việc Theo tuần bắt buộc chọn thứ hoàn thành.");
  if (["MONTHLY", "QUARTERLY", "YEARLY"].includes(kind) && !normalized) {
    const label = kind === "MONTHLY" ? "Theo tháng" : kind === "QUARTERLY" ? "Theo quý" : "Theo năm";
    throw new Error(`Đầu việc ${label} bắt buộc có “Thời hạn hoàn thành”.`);
  }
  return { kind, completionDeadline: normalized };
}

export function requiresManualDeadline(frequency) {
  return frequencyKind(frequency) === "MANUAL";
}

export function isEventDrivenFrequency(frequency) {
  return frequencyKind(frequency) === "ARISING";
}

export function deadlineDateFromKey(dateKey) {
  if (!isDateKey(dateKey)) return null;
  return new Date(`${dateKey}T23:59:59${KPI_TIME_ZONE_OFFSET}`);
}

function dailyMilestones(periodStartDate, periodEndDate) {
  const start = utcDateFromKey(periodStartDate);
  const end = utcDateFromKey(periodEndDate);
  const result = [];
  for (let current = start; current <= end; current = new Date(current.getTime() + 86400000)) {
    result.push(dateKeyFromUtcDate(current));
  }
  return result;
}

function weeklyMilestones(periodStartDate, periodEndDate, weekdayLabel) {
  const normalized = normalizeWeekday(weekdayLabel);
  const target = normalized === "Chủ Nhật" ? 0 : WEEKDAY_OPTIONS.indexOf(normalized) + 1;
  if (target < 0) throw new Error("Không xác định được thứ hoàn thành của đầu việc Theo tuần.");
  const start = utcDateFromKey(periodStartDate);
  const end = utcDateFromKey(periodEndDate);
  const delta = (target - start.getUTCDay() + 7) % 7;
  let current = new Date(start.getTime() + delta * 86400000);
  const result = [];
  while (current <= end) {
    result.push(dateKeyFromUtcDate(current));
    current = new Date(current.getTime() + 7 * 86400000);
  }
  return result;
}

function monthlyMilestones(periodStartDate, periodEndDate, day) {
  const start = dateParts(periodStartDate);
  const end = dateParts(periodEndDate);
  const result = [];
  let year = start.year;
  let month = start.month;
  while (year < end.year || (year === end.year && month <= end.month)) {
    const key = dateKeyFromParts(year, month, day);
    if (key >= periodStartDate && key <= periodEndDate) result.push(key);
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return result;
}

export function deriveDeadlinePlan({
  frequency,
  completionDeadline,
  periodStartDate,
  periodEndDate,
  manualDeadlineDateKey = "",
  fixedDeadlineDateKey = ""
} = {}) {
  const end = dateParts(periodEndDate);
  dateParts(periodStartDate);

  if (clean(fixedDeadlineDateKey)) {
    if (!isDateKey(fixedDeadlineDateKey)) throw new Error("Ngày hạn cụ thể không hợp lệ.");
    if (fixedDeadlineDateKey < periodStartDate || fixedDeadlineDateKey > periodEndDate) {
      throw new Error("Ngày hạn cụ thể phải nằm trong kỳ KPI hiện tại.");
    }
    return {
      mode: "FIXED",
      recurringKind: "",
      completionDeadline: clean(completionDeadline),
      deadlineDateKey: fixedDeadlineDateKey,
      milestoneDateKeys: [],
      eventDriven: false,
      fixed: true
    };
  }

  const { kind, completionDeadline: normalized } = validateDeadlineConfiguration(frequency, completionDeadline);

  if (kind === "DAILY" || kind === "WEEKLY" || kind === "MONTHLY") {
    const milestones = kind === "DAILY"
      ? dailyMilestones(periodStartDate, periodEndDate)
      : kind === "WEEKLY"
        ? weeklyMilestones(periodStartDate, periodEndDate, normalized)
        : monthlyMilestones(periodStartDate, periodEndDate, Number(normalized));
    if (!milestones.length) {
      throw new Error("Không tạo được mốc định kỳ nằm trong kỳ KPI hiện tại. Hãy kiểm tra kỳ đánh giá và Thời hạn hoàn thành.");
    }
    return {
      mode: `${kind}_MILESTONES`,
      recurringKind: kind,
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

  if (kind === "ARISING") {
    return {
      mode: "EVENT_DRIVEN",
      completionDeadline: "",
      deadlineDateKey: "",
      milestoneDateKeys: [],
      eventDriven: true
    };
  }

  if (!isDateKey(manualDeadlineDateKey)) {
    throw new Error("Đầu việc legacy này không có quy tắc hạn tự động. Hãy nhập Hạn hoàn thành cụ thể khi đăng ký/giao nhiệm vụ.");
  }
  return {
    mode: "SINGLE_MANUAL",
    completionDeadline: normalized,
    deadlineDateKey: clean(manualDeadlineDateKey),
    milestoneDateKeys: [],
    eventDriven: false
  };
}

export function deadlineRuleDescription(frequency, completionDeadline) {
  const kind = frequencyKind(frequency);
  const value = clean(completionDeadline);
  if (kind === "DAILY") return "Hoàn thành trong từng ngày của kỳ KPI";
  if (kind === "WEEKLY") return value ? `Hoàn thành vào ${normalizeWeekday(value) || value} mỗi tuần trong kỳ` : "Chọn thứ hoàn thành mỗi tuần";
  if (kind === "MONTHLY") return value ? `Ngày ${value} mỗi tháng trong kỳ` : "Thiếu ngày hoàn thành mỗi tháng";
  if (kind === "QUARTERLY") return value ? `Ngày ${value} của tháng cuối quý` : "Thiếu ngày hoàn thành quý";
  if (kind === "YEARLY") return value ? `Ngày ${value} của năm` : "Thiếu ngày/tháng hoàn thành năm";
  if (kind === "ARISING") return "Không nhập hạn ở danh mục/kế hoạch; khi có việc thực tế, từng lượt bắt buộc nhập hạn cụ thể";
  return "Dữ liệu cũ chưa theo bộ Chu kỳ/Tần suất chuẩn; cần rà soát trước khi chỉnh sửa";
}
