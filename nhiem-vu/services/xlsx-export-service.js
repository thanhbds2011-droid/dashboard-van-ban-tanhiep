/**
 * Lightweight XLSX exporter for the KPI score sheet.
 * Produces a native .xlsx file without third-party runtime dependencies.
 */

const encoder = new TextEncoder();

function xmlEscape(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function colName(index) {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function cellXml(rowNumber, colIndex, value, style = 0) {
  const ref = `${colName(colIndex)}${rowNumber}`;
  if (value === null || value === undefined || value === '') {
    return `<c r="${ref}" s="${style}"/>`;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}" s="${style}" t="n"><v>${value}</v></c>`;
  }
  const text = String(value);
  const preserve = /^\s|\s$|\n/.test(text) ? ' xml:space="preserve"' : '';
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t${preserve}>${xmlEscape(text)}</t></is></c>`;
}

function makeRow(rowNumber, cells, options = {}) {
  const height = Number(options.height || 0);
  const attrs = height > 0 ? ` ht="${height}" customHeight="1"` : '';
  return `<row r="${rowNumber}"${attrs}>${cells.map((cell, index) => cellXml(rowNumber, index, cell?.value ?? '', cell?.style ?? 0)).join('')}</row>`;
}

function u16(value) {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value, true);
  return out;
}

function u32(value) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value >>> 0, true);
  return out;
}

function concatBytes(parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: dosDate };
}

function zipStore(files) {
  const localParts = [];
  const centralParts = [];
  const stamp = dosDateTime();
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = typeof file.content === 'string' ? encoder.encode(file.content) : file.content;
    const crc = crc32(data);

    const localHeader = concatBytes([
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(stamp.time), u16(stamp.date),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name
    ]);
    localParts.push(localHeader, data);

    const centralHeader = concatBytes([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(stamp.time), u16(stamp.date),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(offset), name
    ]);
    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }

  const central = concatBytes(centralParts);
  const local = concatBytes(localParts);
  const end = concatBytes([
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(central.length), u32(local.length), u16(0)
  ]);
  return concatBytes([local, central, end]);
}

function sanitizedSheetName(value) {
  return String(value || 'Bảng tính điểm').replace(/[\\/*?:\[\]]/g, ' ').slice(0, 31) || 'Bảng tính điểm';
}

function safeFileName(value) {
  return String(value || 'Bang_tinh_diem_KPI.xlsx')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_');
}

export function buildKpiWorkbookBlob({
  sheetName = 'Bảng tính điểm',
  periodLabel = '',
  employeeName = '',
  employeePosition = '',
  rows = [],
  summary = {}
} = {}) {
  const columns = [
    { title: 'STT', width: 7 },
    { title: 'Tên công việc', width: 48 },
    { title: 'Điểm chuẩn', width: 12 },
    { title: 'Hệ số độ khó', width: 14 },
    { title: 'Điểm quy đổi tối đa', width: 16 },
    { title: 'Tiến độ %', width: 12 },
    { title: 'Kết quả %', width: 12 },
    { title: 'Điểm thực hiện', width: 14 },
    { title: 'Điểm quy đổi thực tế', width: 17 },
    { title: 'Công việc vượt yêu cầu về tiến độ/chất lượng', width: 24 },
    { title: 'Minh chứng', width: 34 }
  ];

  const sheetRows = [];
  sheetRows.push(makeRow(1, [{ value: 'TRUNG TÂM BẢO TRỢ XÃ HỘI TÂN HIỆP', style: 5 }, ...Array(10).fill({ value:'', style:5 })], { height: 23 }));
  const reportTitle = `BẢNG TÍNH ĐIỂM KPI CÁ NHÂN${periodLabel ? ` – ${periodLabel}` : ''}`;
  sheetRows.push(makeRow(2, [{ value: reportTitle, style: 6 }, ...Array(10).fill({ value:'', style:6 })], { height: 30 }));
  sheetRows.push(makeRow(3, [
    { value: `Họ và tên: ${employeeName || ''}`, style: 10 }, ...Array(5).fill({ value:'', style:10 }),
    { value: `Chức vụ: ${employeePosition || ''}`, style: 10 }, ...Array(4).fill({ value:'', style:10 })
  ], { height: 22 }));
  sheetRows.push(makeRow(4, Array(11).fill({ value:'', style:0 }), { height: 8 }));
  sheetRows.push(makeRow(5, columns.map(column => ({ value: column.title, style: 1 })), { height: 44 }));

  let rowNumber = 6;
  for (const row of rows) {
    const taskName = [row.taskCode, row.title].filter(Boolean).join('\n');
    sheetRows.push(makeRow(rowNumber, [
      { value: row.index, style: 3 },
      { value: taskName, style: 2 },
      { value: Number(row.baseScore || 0), style: 4 },
      { value: row.coefficientLabel || '', style: 3 },
      { value: Number(row.maximumConvertedScore || 0), style: 4 },
      { value: row.progressLabel ?? '', style: 3 },
      { value: row.resultLabel ?? '', style: 3 },
      { value: row.executionScore === '' || row.executionScore == null ? '' : Number(row.executionScore), style: 4 },
      { value: row.actualScore === '' || row.actualScore == null ? '' : Number(row.actualScore), style: 4 },
      { value: row.exceededLabel || '', style: 3 },
      { value: row.evidence || '—', style: 2 }
    ], { height: 42 }));
    rowNumber += 1;
  }

  if (!rows.length) {
    sheetRows.push(makeRow(rowNumber, [{ value: 'Chưa có nhiệm vụ KPI đã duyệt.', style: 2 }, ...Array(10).fill({ value:'', style:2 })], { height: 24 }));
    rowNumber += 1;
  }

  rowNumber += 1;
  const summaryStart = rowNumber;
  const hasBasis = summary.hasCalculationBasis === true;
  sheetRows.push(makeRow(rowNumber, [
    { value: 'Điểm giá trị A', style: 7 }, ...Array(4).fill({ value:'', style:7 }),
    { value: Number(summary.A || 0), style: 8 },
    { value: 'Điểm giá trị B', style: 7 }, ...Array(3).fill({ value:'', style:7 }),
    { value: Number(summary.B || 0), style: 8 }
  ], { height: 25 }));
  rowNumber += 1;
  sheetRows.push(makeRow(rowNumber, [
    { value: 'KPI % (trục 4) = B/A*70 điểm (nếu B>A thì KPI là 70)', style: 7 }, ...Array(9).fill({ value:'', style:7 }),
    { value: hasBasis ? Number(summary.kpi70 || 0) : 'Chưa đủ cơ sở', style: hasBasis ? 8 : 9 }
  ], { height: 28 }));
  rowNumber += 1;
  sheetRows.push(makeRow(rowNumber, [
    { value: 'Tổng số công việc vượt tiến độ và đạt yêu cầu chất lượng', style: 7 }, ...Array(9).fill({ value:'', style:7 }),
    { value: Number(summary.exceededCount || 0), style: 8 }
  ], { height: 28 }));
  rowNumber += 1;
  const bonusHasPending = summary.bonusHasPending === true;
  const bonusApproved = Number(summary.bonusApproved ?? summary.bonusC ?? 0);
  const bonusPending = Number(summary.bonusPending || 0);
  const bonusDisplay = Number(summary.bonusDisplay ?? bonusApproved);
  const bonusDisplayText = bonusHasPending
    ? `${bonusDisplay.toLocaleString('vi-VN', { maximumFractionDigits:2 })} điểm (Chưa xác nhận)`
    : bonusApproved;
  sheetRows.push(makeRow(rowNumber, [
    { value: 'Tổng số điểm thưởng đối với các công việc vượt tiến độ và đạt yêu cầu chất lượng (nếu có)', style: 7 }, ...Array(9).fill({ value:'', style:7 }),
    { value: bonusDisplayText, style: bonusHasPending ? 9 : 8 }
  ], { height: 36 }));
  const bonusSummaryRow = rowNumber;

  let confirmedBonusRow = 0;
  if (bonusHasPending && bonusApproved > 0) {
    rowNumber += 1;
    confirmedBonusRow = rowNumber;
    sheetRows.push(makeRow(rowNumber, [
      { value: 'Trong đó điểm thưởng đã xác nhận', style: 7 }, ...Array(9).fill({ value:'', style:7 }),
      { value: bonusApproved, style: 8 }
    ], { height: 25 }));
  }

  const merges = [
    'A1:K1', 'A2:K2', 'A3:F3', 'G3:K3',
    `A${summaryStart}:E${summaryStart}`, `G${summaryStart}:J${summaryStart}`,
    `A${summaryStart + 1}:J${summaryStart + 1}`,
    `A${summaryStart + 2}:J${summaryStart + 2}`,
    `A${bonusSummaryRow}:J${bonusSummaryRow}`
  ];
  if (confirmedBonusRow) merges.push(`A${confirmedBonusRow}:J${confirmedBonusRow}`);

  const colsXml = columns.map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${column.width}" customWidth="1"/>`).join('');
  const mergeXml = `<mergeCells count="${merges.length}">${merges.map(ref => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>`;
  const finalDataRow = Math.max(5, rowNumber);
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
  <dimension ref="A1:K${finalDataRow}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="5" topLeftCell="A6" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>${colsXml}</cols>
  <sheetData>${sheetRows.join('')}</sheetData>
  ${mergeXml}
  <pageMargins left="0.25" right="0.25" top="0.35" bottom="0.35" header="0.2" footer="0.2"/>
  <pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>
  <fonts count="3">
    <font><sz val="11"/><name val="Times New Roman"/><family val="1"/></font>
    <font><b/><sz val="11"/><name val="Times New Roman"/><family val="1"/></font>
    <font><b/><sz val="14"/><name val="Times New Roman"/><family val="1"/></font>
  </fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF3F8"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="2"><border/><border><left style="thin"><color rgb="FF000000"/></left><right style="thin"><color rgb="FF000000"/></right><top style="thin"><color rgb="FF000000"/></top><bottom style="thin"><color rgb="FF000000"/></bottom><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="11">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const name = sanitizedSheetName(sheetName);
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(name)}" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="191029"/></workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
  const now = new Date().toISOString();
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Bảng tính điểm KPI cá nhân</dc:title><dc:creator>Trung tâm Bảo trợ xã hội Tân Hiệp</dc:creator><cp:lastModifiedBy>Ứng dụng Nhiệm vụ và đánh giá KPI</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
  const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Nhiệm vụ và đánh giá KPI - Tân Hiệp</Application></Properties>`;

  const zip = zipStore([
    { name:'[Content_Types].xml', content:contentTypes },
    { name:'_rels/.rels', content:rels },
    { name:'docProps/core.xml', content:core },
    { name:'docProps/app.xml', content:app },
    { name:'xl/workbook.xml', content:workbookXml },
    { name:'xl/_rels/workbook.xml.rels', content:workbookRels },
    { name:'xl/styles.xml', content:stylesXml },
    { name:'xl/worksheets/sheet1.xml', content:sheetXml }
  ]);
  return new Blob([zip], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function exportFormattedKpiWorkbook(options = {}) {
  const blob = buildKpiWorkbookBlob(options);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = safeFileName(options.fileName || 'Bang_tinh_diem_KPI.xlsx');
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}


/**
 * Native XLSX exporter for the approved personal Product Catalog.
 * Export is a read-only snapshot and intentionally contains no Firestore writes.
 */
export function buildProductCatalogWorkbookBlob({
  sheetName = 'Danh mục sản phẩm',
  periodLabel = '',
  employeeName = '',
  employeePosition = '',
  departmentName = '',
  rows = [],
  exceededCount = 0
} = {}) {
  const columns = [
    { title:'TT', width:6 },
    { title:'Tên công việc', width:38 },
    { title:'Kết quả đầu ra', width:34 },
    { title:'Thời hạn hoàn thành', width:22 },
    { title:'Loại công việc', width:18 },
    { title:'Điểm chuẩn', width:12 },
    { title:'Hệ số độ khó', width:13 },
    { title:'Điểm quy đổi tối đa', width:17 },
    { title:'Minh chứng', width:32 }
  ];
  const sheetRows = [];
  const blank9 = () => Array(9).fill(null).map(() => ({ value:'', style:0 }));
  const row = (n, cells, height) => sheetRows.push(makeRow(n, cells, height ? { height } : {}));

  row(1, [
    { value:'SỞ Y TẾ THÀNH PHỐ HỒ CHÍ MINH', style:5 }, { value:'',style:5 }, { value:'',style:5 }, { value:'',style:5 },
    { value:'',style:5 }, { value:'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM',style:5 }, { value:'',style:5 }, { value:'',style:5 }, { value:'',style:5 }
  ], 22);
  row(2, [
    { value:'TRUNG TÂM BẢO TRỢ XÃ HỘI TÂN HIỆP', style:5 }, { value:'',style:5 }, { value:'',style:5 }, { value:'',style:5 },
    { value:'',style:5 }, { value:'Độc lập - Tự do - Hạnh phúc',style:5 }, { value:'',style:5 }, { value:'',style:5 }, { value:'',style:5 }
  ], 22);
  row(3, blank9(), 8);
  row(4, [{ value:`DANH MỤC SẢN PHẨM CHUẨN${periodLabel ? ` – ${periodLabel}` : ''}`, style:6 }, ...blank9().slice(1)], 30);
  row(5, [{ value:`Họ và tên: ${employeeName || ''}`, style:10 }, ...blank9().slice(1)], 22);
  row(6, [
    { value:`Chức vụ: ${employeePosition || ''}`, style:10 }, { value:'',style:10 }, { value:'',style:10 }, { value:'',style:10 },
    { value:`Phòng/Khu: ${departmentName || ''}`, style:10 }, { value:'',style:10 }, { value:'',style:10 }, { value:'',style:10 }, { value:'',style:10 }
  ], 22);
  row(7, blank9(), 8);
  row(8, columns.map(c => ({ value:c.title, style:1 })), 42);

  let rn = 9;
  for (const item of rows) {
    row(rn, [
      { value:item.index ?? '', style:3 },
      { value:[item.taskCode, item.title].filter(Boolean).join('\n'), style:2 },
      { value:item.outputRequirement || '', style:2 },
      { value:item.deadlineLabel || '', style:3 },
      { value:item.workTypeLabel || '', style:3 },
      { value:Number(item.baseScore || 0), style:4 },
      { value:item.coefficientLabel || '', style:3 },
      { value:Number(item.maximumConvertedScore || 0), style:4 },
      { value:item.evidence || '', style:2 }
    ], 42);
    rn += 1;
  }
  if (!rows.length) {
    row(rn, [{ value:'Chưa có nhiệm vụ đã được phê duyệt trong kỳ.', style:2 }, ...blank9().slice(1)], 24);
    rn += 1;
  }
  rn += 1;
  const totalRow = rn;
  row(rn, [{ value:'Tổng số nhiệm vụ thực hiện trong kỳ', style:7 }, ...Array(7).fill(null).map(()=>({value:'',style:7})), { value:Number(rows.length), style:8 }], 25);
  rn += 1;
  const exceedRow = rn;
  row(rn, [{ value:'Tổng số nhiệm vụ vượt tiến độ/chất lượng', style:7 }, ...Array(7).fill(null).map(()=>({value:'',style:7})), { value:Number(exceededCount || 0), style:8 }], 25);
  rn += 2;
  const sigTop = rn;
  row(rn, [
    { value:'XÁC NHẬN CỦA LÃNH ĐẠO, ĐƠN VỊ', style:5 }, {value:'',style:5},{value:'',style:5},{value:'',style:5},
    { value:'',style:5 }, { value:'NGƯỜI LẬP DANH MỤC SẢN PHẨM', style:5 }, {value:'',style:5},{value:'',style:5},{value:'',style:5}
  ], 22);
  rn += 1;
  row(rn, [
    { value:'(Ký, ghi rõ họ tên)', style:10 }, {value:'',style:10},{value:'',style:10},{value:'',style:10},
    { value:'',style:10 }, { value:'(Ký, ghi rõ họ tên)', style:10 }, {value:'',style:10},{value:'',style:10},{value:'',style:10}
  ], 20);
  rn += 4;
  row(rn, [
    { value:'',style:0 },{value:'',style:0},{value:'',style:0},{value:'',style:0},{value:'',style:0},
    { value:employeeName || '',style:5 },{value:'',style:5},{value:'',style:5},{value:'',style:5}
  ], 22);

  const merges = [
    'A1:D1','F1:I1','A2:D2','F2:I2','A4:I4','A5:I5','A6:D6','E6:I6',
    `A${totalRow}:H${totalRow}`, `A${exceedRow}:H${exceedRow}`,
    `A${sigTop}:D${sigTop}`, `F${sigTop}:I${sigTop}`,
    `A${sigTop+1}:D${sigTop+1}`, `F${sigTop+1}:I${sigTop+1}`,
    `F${rn}:I${rn}`
  ];
  if (!rows.length) merges.push('A9:I9');
  const colsXml = columns.map((c,i)=>`<col min="${i+1}" max="${i+1}" width="${c.width}" customWidth="1"/>`).join('');
  const mergeXml = `<mergeCells count="${merges.length}">${merges.map(ref=>`<mergeCell ref="${ref}"/>`).join('')}</mergeCells>`;
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
  <dimension ref="A1:I${rn}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="8" topLeftCell="A9" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>${colsXml}</cols><sheetData>${sheetRows.join('')}</sheetData>${mergeXml}
  <pageMargins left="0.25" right="0.25" top="0.35" bottom="0.35" header="0.2" footer="0.2"/>
  <pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/>
  <printOptions horizontalCentered="1" verticalCentered="0"/>
</worksheet>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>
  <fonts count="3"><font><sz val="11"/><name val="Times New Roman"/><family val="1"/></font><font><b/><sz val="11"/><name val="Times New Roman"/><family val="1"/></font><font><b/><sz val="14"/><name val="Times New Roman"/><family val="1"/></font></fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF3F8"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="2"><border/><border><left style="thin"><color rgb="FF000000"/></left><right style="thin"><color rgb="FF000000"/></right><top style="thin"><color rgb="FF000000"/></top><bottom style="thin"><color rgb="FF000000"/></bottom><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="11">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
  </cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const name = sanitizedSheetName(sheetName);
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(name)}" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="191029"/></workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
  const now = new Date().toISOString();
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Danh mục sản phẩm chuẩn</dc:title><dc:creator>Trung tâm Bảo trợ xã hội Tân Hiệp</dc:creator><cp:lastModifiedBy>Ứng dụng Nhiệm vụ và đánh giá KPI</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
  const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Nhiệm vụ và đánh giá KPI - Tân Hiệp</Application></Properties>`;
  const zip = zipStore([
    {name:'[Content_Types].xml',content:contentTypes},{name:'_rels/.rels',content:rels},{name:'docProps/core.xml',content:core},{name:'docProps/app.xml',content:app},
    {name:'xl/workbook.xml',content:workbookXml},{name:'xl/_rels/workbook.xml.rels',content:workbookRels},{name:'xl/styles.xml',content:stylesXml},{name:'xl/worksheets/sheet1.xml',content:sheetXml}
  ]);
  return new Blob([zip], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function exportProductCatalogWorkbook(options = {}) {
  const blob = buildProductCatalogWorkbookBlob(options);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = safeFileName(options.fileName || 'Danh_muc_san_pham.xlsx');
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
