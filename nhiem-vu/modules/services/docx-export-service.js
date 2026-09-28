/**
 * Native DOCX exporter for KPI administrative forms.
 * Frontend-only exporter: reads the already-rendered report DOM and creates a real .docx file.
 * No Firestore reads/writes are performed here.
 */
const encoder = new TextEncoder();

const PAGE_WIDTH = 11906;   // A4 portrait, twips
const PAGE_HEIGHT = 16838;
const PAGE_MARGIN = 454;    // ~8 mm, aligned with @page print CSS
const CONTENT_WIDTH = PAGE_WIDTH - (PAGE_MARGIN * 2);
const M01_COLUMN_PCTS = [3.7, 29.4, 16.6, 11.9, 8.9, 8.9, 15.1, 5.5];

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function u16(v) { const a = new Uint8Array(2); new DataView(a.buffer).setUint16(0, v, true); return a; }
function u32(v) { const a = new Uint8Array(4); new DataView(a.buffer).setUint32(0, v >>> 0, true); return a; }
function concat(parts) { const n = parts.reduce((s, p) => s + p.length, 0); const o = new Uint8Array(n); let x = 0; for (const p of parts) { o.set(p, x); x += p.length; } return o; }
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let i = 0; i < 256; i += 1) { let c = i; for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[i] = c >>> 0; } return t; })();
function crc32(bytes) { let c = 0xFFFFFFFF; for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function dosDateTime(d = new Date()) { const y = Math.max(1980, d.getFullYear()); return { time:(d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2), date:((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() }; }
function zipStore(files) {
  const local = [], central = [], stamp = dosDateTime();
  let offset = 0;
  for (const f of files) {
    const name = encoder.encode(f.name);
    const data = typeof f.content === 'string' ? encoder.encode(f.content) : f.content;
    const crc = crc32(data);
    const lh = concat([u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(stamp.time), u16(stamp.date), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name]);
    local.push(lh, data);
    const ch = concat([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(stamp.time), u16(stamp.date), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]);
    central.push(ch);
    offset += lh.length + data.length;
  }
  const l = concat(local), c = concat(central);
  const end = concat([u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(c.length), u32(l.length), u16(0)]);
  return concat([l, c, end]);
}

function safeFileName(v) {
  return String(v || 'Bao_cao_KPI.docx')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_');
}

function cleanText(v) {
  return String(v ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function classHas(el, name) {
  return Boolean(el?.classList?.contains?.(name));
}

function textOf(el) {
  return cleanText(el?.innerText ?? el?.textContent ?? '');
}

function runXml(text, { bold = false, italic = false, size = 22 } = {}) {
  if (text === '') return '';
  const preserve = /^\s|\s$|\n/.test(text) ? ' xml:space="preserve"' : '';
  const props = [
    '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman"/>',
    `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`
  ];
  if (bold) props.push('<w:b/>');
  if (italic) props.push('<w:i/>');
  return `<w:r><w:rPr>${props.join('')}</w:rPr><w:t${preserve}>${esc(text)}</w:t></w:r>`;
}

function paragraphXml(text, {
  bold = false,
  italic = false,
  center = false,
  right = false,
  size = 22,
  after = 40,
  before = 0,
  line = 250,
  keepNext = false
} = {}) {
  const align = center ? 'center' : right ? 'right' : 'both';
  const parts = cleanText(text).split(/\n/);
  const runs = parts.map((part, i) => `${i ? '<w:br/>' : ''}${runXml(part, { bold, italic, size })}`).join('');
  return `<w:p><w:pPr><w:jc w:val="${align}"/><w:spacing w:before="${before}" w:after="${after}" w:line="${line}" w:lineRule="auto"/>${keepNext ? '<w:keepNext/>' : ''}</w:pPr>${runs}</w:p>`;
}

function labelValueParagraphXml(text, options = {}) {
  const value = cleanText(text);
  const match = value.match(/^([^:]{1,60}:)(.*)$/s);
  if (!match) return paragraphXml(value, options);
  const align = options.center ? 'center' : options.right ? 'right' : 'left';
  return `<w:p><w:pPr><w:jc w:val="${align}"/><w:spacing w:after="${options.after ?? 0}" w:line="${options.line ?? 240}" w:lineRule="auto"/></w:pPr>${runXml(match[1], { bold:true, size:options.size ?? 21 })}${runXml(match[2], { size:options.size ?? 21 })}</w:p>`;
}

function emptyParagraph({ size = 22, after = 0 } = {}) {
  return `<w:p><w:pPr><w:spacing w:after="${after}"/></w:pPr>${runXml(' ', { size })}</w:p>`;
}

function borderXml(color = '000000', size = 6) {
  return `<w:tblBorders><w:top w:val="single" w:sz="${size}" w:color="${color}"/><w:left w:val="single" w:sz="${size}" w:color="${color}"/><w:bottom w:val="single" w:sz="${size}" w:color="${color}"/><w:right w:val="single" w:sz="${size}" w:color="${color}"/><w:insideH w:val="single" w:sz="${size}" w:color="${color}"/><w:insideV w:val="single" w:sz="${size}" w:color="${color}"/></w:tblBorders>`;
}

function noBorderXml() {
  return '<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>';
}

function normalizedWidths(percentages, total = CONTENT_WIDTH) {
  const widths = percentages.map(p => Math.max(1, Math.round((Number(p) / 100) * total)));
  const delta = total - widths.reduce((s, n) => s + n, 0);
  widths[widths.length - 1] += delta;
  return widths;
}

function underlineRuleParagraphXml(cellWidth, lineWidth, { after = 25, before = 0 } = {}) {
  const safeLineWidth = Math.max(300, Math.min(Number(lineWidth || 1000), Number(cellWidth || 1000) - 80));
  const indent = Math.max(0, Math.round((Number(cellWidth || 1000) - safeLineWidth) / 2));
  return `<w:p><w:pPr><w:jc w:val="center"/><w:ind w:left="${indent}" w:right="${indent}"/><w:pBdr><w:bottom w:val="single" w:sz="8" w:space="1" w:color="000000"/></w:pBdr><w:spacing w:before="${before}" w:after="${after}" w:line="40" w:lineRule="exact"/></w:pPr>${runXml(' ', { size:2 })}</w:p>`;
}

function topHeaderXml(top) {
  const agency = top?.querySelector?.('.m01-agency');
  const national = top?.querySelector?.('.m01-national');
  const form = top?.querySelector?.('.m01-form-number');
  const leftWidth = Math.round(CONTENT_WIDTH * 0.47);
  const rightWidth = CONTENT_WIDTH - leftWidth;
  const formText = textOf(form);

  // IMPORTANT: use distinct Word paragraphs instead of <w:br/> inside one paragraph.
  // WPS/Word compatibility is much more stable and matches the official 01-A/01-B templates.
  let agencyLines = textOf(agency).split(/\n/).map(cleanText).filter(Boolean);
  if (/01\s*-?\s*B/i.test(formText)) {
    const idx = agencyLines.findIndex(line => /^TRUNG TÂM\s+BẢO TRỢ XÃ HỘI TÂN HIỆP$/i.test(line));
    if (idx >= 0) {
      agencyLines = [
        ...agencyLines.slice(0, idx),
        'TRUNG TÂM',
        'BẢO TRỢ XÃ HỘI TÂN HIỆP',
        ...agencyLines.slice(idx + 1)
      ];
    }
  }

  const leftParts = agencyLines.map((line, index) => {
    const bold = index >= 2;
    return paragraphXml(line, {
      bold,
      center:true,
      size:index >= 2 ? 20 : 19,
      after:0,
      line:220,
      keepNext:true
    });
  });
  if (agencyLines.length) leftParts.push(underlineRuleParagraphXml(leftWidth, /01\s*-?\s*B/i.test(formText) ? 1100 : 1250, { after:30 }));

  const nationalLines = textOf(national).split(/\n/).map(cleanText).filter(Boolean);
  const rightParts = [];
  if (formText) rightParts.push(paragraphXml(formText, { bold:true, right:true, size:18, after:0, line:210, keepNext:true }));

  nationalLines.forEach((line, index) => {
    const isDate = /^(Đồng Nai|TP\.?\s*Hồ Chí Minh|Thành phố)/i.test(line) || /ngày\s+\d+/i.test(line);
    const isMotto = /^Độc lập\s*-\s*Tự do\s*-\s*Hạnh phúc$/i.test(line) || /^Độc lập\s*-\s*Tự do\s*-\s*Hạnh Phúc$/i.test(line);
    rightParts.push(paragraphXml(line, {
      bold:!isDate,
      italic:isDate,
      center:true,
      size:isDate ? 18 : (index === 0 ? 20 : 19),
      after:0,
      line:220,
      keepNext:!isDate
    }));
    if (isMotto) rightParts.push(underlineRuleParagraphXml(rightWidth, 2050, { after:20 }));
  });

  return `<w:tbl><w:tblPr><w:tblW w:w="${CONTENT_WIDTH}" w:type="dxa"/><w:tblLayout w:type="fixed"/>${noBorderXml()}<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="20" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="20" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="${leftWidth}"/><w:gridCol w:w="${rightWidth}"/></w:tblGrid><w:tr><w:trPr><w:cantSplit/></w:trPr><w:tc><w:tcPr><w:tcW w:w="${leftWidth}" w:type="dxa"/><w:vAlign w:val="top"/></w:tcPr>${leftParts.join('')}</w:tc><w:tc><w:tcPr><w:tcW w:w="${rightWidth}" w:type="dxa"/><w:vAlign w:val="top"/></w:tcPr>${rightParts.join('')}</w:tc></w:tr></w:tbl>`;
}

function profileXml(profile) {
  const lines = [...(profile?.children || [])].map(textOf).filter(Boolean);
  if (!lines.length) return '';
  const leftWidth = Math.round(CONTENT_WIDTH * 0.60);
  const rightWidth = CONTENT_WIDTH - leftWidth;
  const rows = [];

  const first = lines[0] || '';
  const dobIndex = first.indexOf('Ngày sinh:');
  if (dobIndex >= 0) {
    const left = cleanText(first.slice(0, dobIndex));
    const right = cleanText(first.slice(dobIndex));
    rows.push(`<w:tr><w:trPr><w:cantSplit/></w:trPr><w:tc><w:tcPr><w:tcW w:w="${leftWidth}" w:type="dxa"/><w:shd w:val="clear" w:fill="F5FBFF"/></w:tcPr>${labelValueParagraphXml(left, { size:20, after:0 })}</w:tc><w:tc><w:tcPr><w:tcW w:w="${rightWidth}" w:type="dxa"/><w:shd w:val="clear" w:fill="F5FBFF"/></w:tcPr>${labelValueParagraphXml(right, { size:20, after:0 })}</w:tc></w:tr>`);
  } else {
    rows.push(`<w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/><w:tcW w:w="${CONTENT_WIDTH}" w:type="dxa"/><w:shd w:val="clear" w:fill="F5FBFF"/></w:tcPr>${labelValueParagraphXml(first, { size:20, after:0 })}</w:tc></w:tr>`);
  }

  for (const line of lines.slice(1)) {
    rows.push(`<w:tr><w:trPr><w:cantSplit/></w:trPr><w:tc><w:tcPr><w:gridSpan w:val="2"/><w:tcW w:w="${CONTENT_WIDTH}" w:type="dxa"/><w:shd w:val="clear" w:fill="F5FBFF"/></w:tcPr>${labelValueParagraphXml(line, { size:20, after:0 })}</w:tc></w:tr>`);
  }

  return `<w:tbl><w:tblPr><w:tblW w:w="${CONTENT_WIDTH}" w:type="dxa"/><w:tblLayout w:type="fixed"/>${borderXml('9EBBD0', 5)}<w:tblCellMar><w:top w:w="45" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="45" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="${leftWidth}"/><w:gridCol w:w="${rightWidth}"/></w:tblGrid>${rows.join('')}</w:tbl>`;
}

function cellXml(text, {
  colspan = 1,
  width = 1000,
  center = false,
  bold = false,
  fill = '',
  size = 18,
  verticalCenter = false
} = {}) {
  const span = colspan > 1 ? `<w:gridSpan w:val="${colspan}"/>` : '';
  const shading = fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : '';
  return `<w:tc><w:tcPr>${span}<w:tcW w:w="${width}" w:type="dxa"/>${shading}<w:vAlign w:val="${verticalCenter ? 'center' : 'top'}"/><w:tcMar><w:top w:w="35" w:type="dxa"/><w:left w:w="45" w:type="dxa"/><w:bottom w:w="35" w:type="dxa"/><w:right w:w="45" w:type="dxa"/></w:tcMar></w:tcPr>${paragraphXml(text, { center, bold, after:0, size, line:210 })}</w:tc>`;
}

function tableRowFill(tr) {
  if (classHas(tr, 'm01-grand-total')) return 'A9D2E8';
  if (classHas(tr, 'm01-column-head')) return 'CFE4F2';
  if (classHas(tr, 'm01-part-row') || classHas(tr, 'm01-group-row') || classHas(tr, 'm01-total-row')) return 'D7EAF6';
  return '';
}

function tableXml(table) {
  const rows = [...(table?.rows || [])];
  if (!rows.length) return '';
  let gridCols = 0;
  for (const tr of rows) {
    let n = 0;
    for (const td of tr.cells || []) n += Number(td.colSpan || 1);
    gridCols = Math.max(gridCols, n);
  }
  if (!gridCols) return '';

  const isM01 = classHas(table, 'm01-table') && gridCols === 8;
  const widths = isM01
    ? normalizedWidths(M01_COLUMN_PCTS)
    : normalizedWidths(Array.from({ length:gridCols }, () => 100 / gridCols));
  const grid = widths.map(w => `<w:gridCol w:w="${w}"/>`).join('');

  const trs = rows.map((tr, ri) => {
    const rowFill = tableRowFill(tr);
    const rowBold = classHas(tr, 'm01-part-row') || classHas(tr, 'm01-group-row') || classHas(tr, 'm01-total-row') || classHas(tr, 'm01-grand-total') || classHas(tr, 'm01-column-head');
    const shouldKeep = rowBold;
    const repeatHeader = classHas(tr, 'm01-column-head');
    let logicalCol = 0;
    const cells = [...(tr.cells || [])].map(td => {
      const colspan = Number(td.colSpan || 1);
      const width = widths.slice(logicalCol, logicalCol + colspan).reduce((s, n) => s + n, 0);
      logicalCol += colspan;
      const center = classHas(td, 'm01-center') || td.tagName === 'TH' || classHas(tr, 'm01-column-head');
      const bold = rowBold || td.tagName === 'TH';
      return cellXml(textOf(td), {
        colspan,
        width,
        center,
        bold,
        fill:rowFill,
        size:isM01 ? 17 : 19,
        verticalCenter:center || classHas(tr, 'm01-bonus-item')
      });
    }).join('');
    return `<w:tr><w:trPr>${shouldKeep ? '<w:cantSplit/>' : ''}${repeatHeader ? '<w:tblHeader/>' : ''}</w:trPr>${cells}</w:tr>`;
  }).join('');

  return `<w:tbl><w:tblPr><w:tblW w:w="${CONTENT_WIDTH}" w:type="dxa"/><w:jc w:val="left"/><w:tblLayout w:type="fixed"/>${borderXml('000000', 5)}<w:tblCellMar><w:top w:w="35" w:type="dxa"/><w:left w:w="45" w:type="dxa"/><w:bottom w:w="35" w:type="dxa"/><w:right w:w="45" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${trs}</w:tbl>`;
}

function signatureBlockXml(el, fraction = 0.45, blankLines = 4) {
  const rightWidth = Math.max(1, Math.round(CONTENT_WIDTH * fraction));
  const leftWidth = CONTENT_WIDTH - rightWidth;
  const heading = cleanText(el?.querySelector?.('strong')?.innerText ?? el?.querySelector?.('strong')?.textContent ?? '');
  const note = cleanText(el?.querySelector?.('em')?.innerText ?? el?.querySelector?.('em')?.textContent ?? '');
  const fallback = textOf(el);

  // Separate paragraphs are intentional. Some WPS builds collapse <w:br/> in generated DOCX.
  // Keeping heading and signing note in two paragraphs guarantees the note stays underneath.
  const contentParts = [];
  if (heading) {
    contentParts.push(paragraphXml(heading, { bold:true, center:true, size:20, after:0, line:225, keepNext:true }));
    if (note) contentParts.push(paragraphXml(note, { italic:true, center:true, size:19, after:0, line:220, keepNext:true }));
  } else if (fallback) {
    const lines = fallback.split(/\n/).map(cleanText).filter(Boolean);
    if (lines[0]) contentParts.push(paragraphXml(lines[0], { bold:true, center:true, size:20, after:0, line:225, keepNext:true }));
    if (lines[1]) contentParts.push(paragraphXml(lines.slice(1).join(' '), { italic:true, center:true, size:19, after:0, line:220, keepNext:true }));
  }
  contentParts.push(...Array.from({ length:blankLines }, () => emptyParagraph({ size:20 })));

  return `<w:tbl><w:tblPr><w:tblW w:w="${CONTENT_WIDTH}" w:type="dxa"/><w:tblLayout w:type="fixed"/>${noBorderXml()}</w:tblPr><w:tblGrid><w:gridCol w:w="${leftWidth}"/><w:gridCol w:w="${rightWidth}"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="${leftWidth}" w:type="dxa"/></w:tcPr>${emptyParagraph({ size:20 })}</w:tc><w:tc><w:tcPr><w:tcW w:w="${rightWidth}" w:type="dxa"/><w:vAlign w:val="top"/></w:tcPr>${contentParts.join('')}</w:tc></w:tr></w:tbl>`;
}

function elementBlocks(root) {
  const blocks = [];
  const pushText = (el, opts = {}) => {
    const text = textOf(el);
    if (text) blocks.push(paragraphXml(text, opts));
  };

  const walk = el => {
    if (!el || el.nodeType !== 1) return;
    if (classHas(el, 'kpi-no-print') || classHas(el, 'kpi-hidden')) return;

    if (classHas(el, 'm01-top')) { blocks.push(topHeaderXml(el)); return; }
    if (classHas(el, 'm01-profile')) { blocks.push(profileXml(el)); return; }
    if (classHas(el, 'm01-self-sign')) { blocks.push(signatureBlockXml(el, 0.45, 2)); return; }
    if (classHas(el, 'm01-authority-sign')) { blocks.push(signatureBlockXml(el, 0.64, 2)); return; }

    const tag = el.tagName;
    if (tag === 'TABLE') { blocks.push(tableXml(el)); return; }
    if (tag === 'H1') { pushText(el, { bold:true, center:true, size:28, before:70, after:10, line:260, keepNext:true }); return; }
    if (tag === 'H2') { pushText(el, { bold:true, center:true, size:23, after:80, line:245, keepNext:true }); return; }
    if (/^H[3-6]$/.test(tag)) { pushText(el, { bold:true, size:21, before:60, after:35, line:240, keepNext:true }); return; }
    if (tag === 'P') { pushText(el, { size:20, after:35, line:240 }); return; }
    if (tag === 'BR') { blocks.push(emptyParagraph()); return; }

    if (classHas(el, 'm01-section-title')) { pushText(el, { bold:true, size:21, before:75, after:20, line:240, keepNext:true }); return; }
    if (classHas(el, 'm01-intro') || classHas(el, 'm01-proposal') || classHas(el, 'm01-rating-levels') || classHas(el, 'm01-quality-result')) { pushText(el, { size:20, after:35, line:240 }); return; }

    const children = [...(el.children || [])];
    if (children.length) {
      for (const child of children) walk(child);
      return;
    }
    pushText(el, { size:20, after:30, line:240 });
  };

  for (const child of root.children || []) walk(child);
  return blocks.join('');
}

export function buildDocxBlobFromElement(root, { title = 'Báo cáo KPI cá nhân', creator = 'Trung tâm Bảo trợ xã hội Tân Hiệp' } = {}) {
  if (!root) throw new Error('Không tìm thấy nội dung biểu mẫu để xuất Word.');
  const body = elementBlocks(root);
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr><w:r><w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr><w:t> </w:t></w:r></w:p><w:sectPr><w:pgSz w:w="${PAGE_WIDTH}" w:h="${PAGE_HEIGHT}"/><w:pgMar w:top="${PAGE_MARGIN}" w:right="${PAGE_MARGIN}" w:bottom="${PAGE_MARGIN}" w:left="${PAGE_MARGIN}" w:header="284" w:footer="284" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="40" w:line="250" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
  const now = new Date().toISOString();
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dc:creator>${esc(creator)}</dc:creator><cp:lastModifiedBy>Ứng dụng Nhiệm vụ và đánh giá KPI</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
  const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Nhiệm vụ và đánh giá KPI - Tân Hiệp</Application></Properties>`;
  const zip = zipStore([
    { name:'[Content_Types].xml', content:types },
    { name:'_rels/.rels', content:rels },
    { name:'docProps/core.xml', content:core },
    { name:'docProps/app.xml', content:app },
    { name:'word/document.xml', content:documentXml },
    { name:'word/styles.xml', content:styles },
    { name:'word/_rels/document.xml.rels', content:docRels }
  ]);
  return new Blob([zip], { type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

export function exportDomToDocx(root, options = {}) {
  const blob = buildDocxBlobFromElement(root, options);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = safeFileName(options.fileName || 'Bao_cao_KPI.docx');
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
