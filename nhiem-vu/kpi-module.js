export const KPI2C = Object.freeze({
  VERSION: '2.1.0',
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

export function calculateTaskScore(baseScore, coefficient, progressRate, resultRate) {
  const base = Number(baseScore || 0);
  const coef = Number(coefficient || 0);
  const progress = clampRate(progressRate) / 100;
  const result = clampRate(resultRate) / 100;
  const maximum = round2(base * coef);
  const execution = round2(base * (KPI2C.PROGRESS_WEIGHT * progress + KPI2C.RESULT_WEIGHT * result));
  const actual = round2(Math.min(execution * coef, maximum));
  return { maximum, execution, actual };
}

export function calculateKpiSummary(tasks, commonScore) {
  const recognized = (tasks || []).filter((item) => item.recognized === true);
  const plan = recognized.filter((item) => item.includedInA === true);
  const A = round2(plan.reduce((sum, item) => sum + Number(item.maximumConvertedScore || 0), 0));
  const B = round2(recognized.reduce((sum, item) => sum + Number(item.confirmedActualScore || 0), 0));
  const kpi70 = A > 0 ? round2(Math.min((B / A) * 70, 70)) : 0;
  const common30 = round2(Math.max(0, Math.min(Number(commonScore || 0), 30)));
  return { A, B, kpi70, common30, total100: round2(Math.min(kpi70 + common30, 100)) };
}

export function proposedRating(total) {
  const score = Number(total || 0);
  if (score >= 90) return 'HOAN_THANH_XUAT_SAC';
  if (score >= 80) return 'HOAN_THANH_TOT';
  if (score >= 65) return 'HOAN_THANH';
  return 'KHONG_HOAN_THANH';
}

export function ratingName(code) {
  const names = {
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

// Tương thích ngược với app.js Production 2B.
export const KPI2B = KPI2C;
