/**
 * Chuẩn hóa cách viết dữ liệu nghiệp vụ nhưng không phá tên riêng đã nhập đúng.
 *
 * Nguyên tắc:
 * - THỰC HIỆN làm cá / Thực HIỆN LÀM cá -> Thực hiện làm cá.
 * - Tên riêng đã viết dạng Title Case (Công an Xã Minh Đức) được giữ nguyên.
 * - Chữ viết tắt hành chính/KPI được giữ dạng chuẩn.
 * - Sau dấu . ! ? chữ đầu câu được viết hoa.
 */
const ACRONYMS = Object.freeze([
  "KPI", "BGĐ", "TCHC", "CTXH", "KHTC", "BHYT", "BHXH", "CCCD", "UBND",
  "HĐ", "PCCC", "CNTT", "CSDL", "XML", "PDF", "QR", "TP.HCM", "TPHCM",
  "YT", "CDTN", "HIS", "VNPT"
]);

const ACRONYM_MAP = new Map(ACRONYMS.map(value => [value.toLocaleLowerCase("vi-VN"), value]));

function collapseWhitespace(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeWord(token) {
  const lower = token.toLocaleLowerCase("vi-VN");
  const upper = token.toLocaleUpperCase("vi-VN");
  const acronym = ACRONYM_MAP.get(lower);
  if (acronym) return acronym;

  // Mã hành chính/ký hiệu có cả chữ và số: QĐ366, NĐ30, TCHC01...
  if (/\d/u.test(token) && /\p{L}/u.test(token)) return upper;

  const letters = [...token];
  const first = letters[0] || "";
  const rest = letters.slice(1).join("");
  const isLower = token === lower;
  const isUpper = token === upper;
  const isTitle = first === first.toLocaleUpperCase("vi-VN")
    && rest === rest.toLocaleLowerCase("vi-VN");

  if (isLower || isTitle) return token;
  if (isUpper) return lower;
  // Kiểu gõ lẫn bất thường như hiỆN, thỰc -> đưa về chữ thường;
  // bước sau sẽ viết hoa nếu đây là đầu câu.
  return lower;
}

function normalizeWords(text) {
  return text.replace(/[\p{L}\p{N}]+(?:[./-][\p{L}\p{N}]+)*/gu, normalizeWord);
}

function uppercaseSentenceStarts(text) {
  let result = "";
  let capitalizeNext = true;
  for (const char of text) {
    if (capitalizeNext && /\p{L}/u.test(char)) {
      result += char.toLocaleUpperCase("vi-VN");
      capitalizeNext = false;
      continue;
    }
    result += char;
    if (/[.!?]/u.test(char)) capitalizeNext = true;
    else if (!/\s/u.test(char) && capitalizeNext) {
      // Vẫn chờ ký tự chữ nếu câu bắt đầu bằng số/ký hiệu.
    }
  }
  return result;
}

export function normalizeSentenceText(value, maxLength = 5000) {
  const compact = collapseWhitespace(value).slice(0, maxLength);
  if (!compact) return "";
  return uppercaseSentenceStarts(normalizeWords(compact));
}

export function normalizeTaskTextFields(data = {}) {
  return {
    ...data,
    title: normalizeSentenceText(data.title, 300),
    description: normalizeSentenceText(data.description, 5000),
    expectedOutput: normalizeSentenceText(data.expectedOutput, 3000),
    resultRequirement: normalizeSentenceText(data.resultRequirement, 3000),
    sourceReference: normalizeSentenceText(data.sourceReference, 500),
    sourceDetail: normalizeSentenceText(data.sourceDetail, 3000)
  };
}
