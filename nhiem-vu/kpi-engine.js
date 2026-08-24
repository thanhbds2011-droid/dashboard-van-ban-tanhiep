export const KPI2B = Object.freeze({
  VERSION: 'FINAL-2026.07-FORMULA-2STEP',
  PILOT_PERIOD_ID: '2026-Q3',
  PILOT_PERIOD_NAME: 'Quý III năm 2026',
  PILOT_START: '2026-07-01',
  PILOT_END: '2026-09-30',
  WORK_WEIGHT: 70,
  COMMON_WEIGHT: 30,
  PROGRESS_WEIGHT: 0.30,
  RESULT_WEIGHT: 0.70
});

export const COMMON_CRITERIA = Object.freeze([
  { code: '1.1', group: '1', max: 2, text: 'Tuyệt đối trung thành với Đảng, Tổ quốc và Nhân dân; có lập trường, quan điểm và bản lĩnh chính trị vững vàng.' },
  { code: '1.2', group: '1', max: 2, text: 'Chấp hành nghiêm nguyên tắc tổ chức, kỷ luật của Đảng, pháp luật của Nhà nước và sự phân công của tổ chức.' },
  { code: '1.3', group: '1', max: 2, text: 'Có tinh thần trách nhiệm, tận tụy với công việc; chủ động phối hợp và hoàn thành nhiệm vụ được giao.' },
  { code: '1.4', group: '1', max: 2, text: 'Tự giác học tập, cập nhật kiến thức, nâng cao trình độ để đáp ứng yêu cầu nhiệm vụ.' },
  { code: '1.5', group: '1', max: 2, text: 'Có phẩm chất đạo đức, lối sống trong sáng, trung thực, khiêm tốn, cần, kiệm, liêm, chính.' },
  { code: '1.6', group: '1', max: 2, text: 'Không tham nhũng, lãng phí, cơ hội, vụ lợi; kiên quyết đấu tranh với biểu hiện tiêu cực và lợi ích nhóm.' },
  { code: '1.7', group: '1', max: 2, text: 'Có uy tín, tinh thần đoàn kết, thương yêu đồng chí, đồng nghiệp; giữ gìn đoàn kết nội bộ.' },
  { code: '1.8', group: '1', max: 2, text: 'Chủ động, đổi mới, sáng tạo; phấn đấu vì mục tiêu phát triển của cơ quan, đơn vị.' },
  { code: '1.9', group: '1', max: 2, text: 'Thực hiện kê khai, công khai tài sản, thu nhập và báo cáo thông tin theo quy định.' },
  { code: '2.1', group: '2', max: 1, text: 'Có tư duy đổi mới, tầm nhìn, phương pháp làm việc khoa học và khả năng thích ứng.' },
  { code: '2.2', group: '2', max: 1, text: 'Bám sát thực tiễn, có cách làm sáng tạo, hiệu quả trong tổ chức thực hiện nhiệm vụ.' },
  { code: '2.3', group: '2', max: 1, text: 'Nói đi đôi với làm; dám nghĩ, dám làm, dám chịu trách nhiệm vì lợi ích chung.' },
  { code: '2.4', group: '2', max: 1, text: 'Có khát vọng cống hiến; biết quy tụ và phát huy sức mạnh tập thể, cá nhân.' },
  { code: '3.1', group: '3', max: 2, text: 'Chủ động, nghiêm túc tự phê bình và phê bình; cầu thị, tiếp thu góp ý.' },
  { code: '3.2', group: '3', max: 2, text: 'Có kế hoạch và quyết liệt khắc phục hạn chế, khuyết điểm đã được chỉ ra.' },
  { code: '3.3', group: '3', max: 2, text: 'Kết quả khắc phục đạt từ 80% nội dung trở lên, có tiến bộ rõ và không để tái diễn.' },
  { code: '3.4', group: '3', max: 2, text: 'Tự soi, tự sửa với trách nhiệm cao; không né tránh, không đổ lỗi.' }
]);

export function clampRate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 0;
}

export function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function convertAppendix04Rate(value) {
  const rate = clampRate(value);
  if (rate >= 100) return 100;
  if (rate >= 80) return 80;
  if (rate >= 60) return 60;
  return 0;
}

export function normalizeDifficultyCoefficient(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return number > 10 ? number / 100 : number;
}

/**
 * Tính điểm nhiệm vụ theo đúng hai bước của Phụ lục 4:
 * 1) Điểm thực hiện = Điểm chuẩn × (30% tiến độ + 70% kết quả).
 * 2) Điểm quy đổi thực tế = Điểm thực hiện × Hệ số độ khó.
 * Điểm quy đổi thực tế không vượt quá Điểm quy đổi tối đa.
 */
export function calculateTaskScore(baseScore, coefficient, progressRate, resultRate) {
  const base = Math.max(0, Number(baseScore || 0));
  const coef = normalizeDifficultyCoefficient(coefficient);
  const rawProgressRate = clampRate(progressRate);
  const rawResultRate = clampRate(resultRate);
  const normalizedProgressRate = convertAppendix04Rate(rawProgressRate);
  const normalizedResultRate = convertAppendix04Rate(rawResultRate);
  const progress = normalizedProgressRate / 100;
  const result = normalizedResultRate / 100;

  const maximum = round2(base * coef);
  const execution = round2(
    base * (KPI2B.PROGRESS_WEIGHT * progress + KPI2B.RESULT_WEIGHT * result)
  );
  const actual = round2(Math.min(execution * coef, maximum));

  return {
    baseScore: base,
    coefficient: coef,
    rawProgressRate,
    rawResultRate,
    progressRate: normalizedProgressRate,
    resultRate: normalizedResultRate,
    maximum,
    maximumConvertedScore: maximum,
    execution,
    executionScore: execution,
    actual,
    convertedActualScore: actual
  };
}

export function calculateKpiSummary(tasks, commonScore) {
  const all = (tasks || []).filter((item) => item.active !== false && item.status !== 'HUY' && item.status !== 'CANCELLED');
  const eligible = all.filter((item) => {
    const scoringStatus = String(item.scoringStatus || '').toUpperCase();
    return item.scoringEnabled !== false
      && String(item.noOccurrenceStatus || '').toUpperCase() !== 'CONFIRMED'
      && !['NO_OCCURRENCE_CONFIRMED', 'ADJUSTMENT_EXEMPT'].includes(scoringStatus);
  });
  const plan = eligible.filter((item) => item.includedInA === true && item.planApprovalStatus === 'APPROVED');
  const recognized = eligible.filter((item) => item.recognized === true);
  const A = round2(plan.reduce((sum, item) => sum + Number(item.maximumConvertedScore || item.maximumScore || 0), 0));
  const B = round2(recognized.reduce((sum, item) => sum + Number(item.confirmedActualScore || 0), 0));
  const hasCalculationBasis = A > 0;
  const kpi70 = hasCalculationBasis ? round2(Math.min((B / A) * 70, 70)) : null;
  const common30 = round2(Math.max(0, Math.min(Number(commonScore || 0), 30)));
  const total100 = hasCalculationBasis
    ? round2(Math.min(kpi70 + common30, 100))
    : null;
  return { A, B, kpi70, common30, total100, hasCalculationBasis };
}

export function parseDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const VI_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

function vietnamDateKey(value) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return value.trim();
  const date = parseDate(value);
  if (!date) return '';
  const parts = Object.fromEntries(
    VI_DATE_FORMATTER.formatToParts(date)
      .filter(part => ['year', 'month', 'day'].includes(part.type))
      .map(part => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function dateKeySerial(value) {
  const key = vietnamDateKey(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86400000);
}

/**
 * Số ngày trễ theo NGÀY LỊCH thực tế tại múi giờ Asia/Ho_Chi_Minh.
 * Thứ Bảy, Chủ Nhật và ngày nghỉ vẫn được tính như ngày bình thường.
 */
export function countCalendarDaysLate(deadlineValue, completedValue) {
  const deadlineDay = dateKeySerial(deadlineValue);
  const completedDay = dateKeySerial(completedValue);
  if (deadlineDay === null || completedDay === null) return 0;
  return Math.max(0, completedDay - deadlineDay);
}

/** Alias tương thích code cũ; từ V1.13.0 hàm này cũng tính ngày lịch. */
export function countWorkingDaysLate(deadlineValue, completedValue) {
  return countCalendarDaysLate(deadlineValue, completedValue);
}

export function progressRateFromDates(deadlineValue, completedValue, isCompleted = true) {
  if (!isCompleted || !completedValue) return 0;
  const late = countCalendarDaysLate(deadlineValue, completedValue);
  if (late <= 0) return 100;
  if (late <= 3) return 80;
  if (late <= 5) return 60;
  return 0;
}

/**
 * Tổng hợp tiến độ của nhiệm vụ có nhiều mốc định kỳ.
 * - Chỉ mốc đã đến hạn (theo ngày lịch Việt Nam) mới tham gia mẫu số.
 * - Đã đến hạn nhưng chưa hoàn thành = 0.
 * - Mỗi mốc hoàn thành tự chấm 100/80/60/0 theo deadline và completedAt.
 * - Trung bình cuối cùng luôn quy XUỐNG 100/80/60/0 bằng convertAppendix04Rate().
 */
export function calculateMilestoneProgress(milestones = [], asOf = new Date()) {
  const asOfSerial = dateKeySerial(asOf);
  const active = (milestones || []).filter(item => item && item.active !== false);
  const due = active.filter(item => {
    const serial = dateKeySerial(item.dueDateKey || item.dueAt);
    return serial !== null && asOfSerial !== null && serial <= asOfSerial;
  });
  const rates = due.map(item => {
    if (!item.completedAt) return 0;
    return progressRateFromDates(item.dueDateKey || item.dueAt, item.completedAt, true);
  });
  const average = rates.length ? round2(rates.reduce((sum, value) => sum + Number(value || 0), 0) / rates.length) : null;
  return {
    totalMilestones: active.length,
    dueMilestones: due.length,
    completedDueMilestones: due.filter(item => Boolean(item.completedAt)).length,
    rates,
    averageRate: average,
    appliedProgressRate: average === null ? null : convertAppendix04Rate(average)
  };
}

export function proposedRating(total) {
  if (total === null || total === undefined || total === '') return 'NO_BASIS';
  const score = Number(total || 0);
  if (score >= 90) return 'HOAN_THANH_XUAT_SAC';
  if (score >= 80) return 'HOAN_THANH_TOT';
  if (score >= 65) return 'HOAN_THANH';
  return 'KHONG_HOAN_THANH';
}

export function ratingName(code) {
  const names = {
    NO_BASIS: 'Chưa đủ cơ sở tính',
    HOAN_THANH_XUAT_SAC: 'Hoàn thành xuất sắc nhiệm vụ',
    HOAN_THANH_TOT: 'Hoàn thành tốt nhiệm vụ',
    HOAN_THANH: 'Hoàn thành nhiệm vụ',
    KHONG_HOAN_THANH: 'Không hoàn thành nhiệm vụ'
  };
  return names[code] || 'Chưa đề xuất';
}

export function periodContains(period, dateKey) {
  return Boolean(period && dateKey && dateKey >= period.startDate && dateKey <= period.endDate);
}
