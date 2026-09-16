import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDepartmentSummaryWorkbookBlob, buildProductCatalogWorkbookBlob } from '../services/xlsx-export-service.js';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(join(appRoot, file), 'utf8');
const between = (s,a,b) => s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)+a.length));
const walk = dir => readdirSync(dir).flatMap(n => { const p=join(dir,n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const sheetXml = async blob => {
  const zip = Buffer.from(await blob.arrayBuffer());
  const files = new Map();
  let pos=0;
  while (pos+30<=zip.length && zip.readUInt32LE(pos)===0x04034b50) {
    const size=zip.readUInt32LE(pos+18);
    const nameLen=zip.readUInt16LE(pos+26);
    const extraLen=zip.readUInt16LE(pos+28);
    const name=zip.subarray(pos+30,pos+30+nameLen).toString('utf8');
    const start=pos+30+nameLen+extraLen;
    files.set(name,zip.subarray(start,start+size).toString('utf8'));
    pos=start+size;
  }
  assert.equal(files.size,8);
  return files;
};
const sample = {
  periodLabel:'Quý III năm 2026',scopeTitle:'Phòng kiểm thử',rows:[
    {index:1,fullName:'Nhân viên mẫu',departmentName:'Phòng mẫu',position:'Nhân viên',taskBreakdown:'12 chuyên môn',A:125,B:124,kpi70:69.44,exceededTasks:2,bonusApproved:0,bonusPending:1.1,common30:30,total100:99.44,ratingName:'Mẫu',scoreState:'Có điểm tự đánh giá'},
    {index:2,fullName:'Nhân viên kiểm tra',position:'Nhân viên',taskBreakdown:'1 chuyên môn',A:10,B:0,kpi70:null,exceededTasks:0,bonusApproved:0,bonusPending:0,common30:0,total100:null,ratingName:'Chưa đủ cơ sở',scoreState:'Chưa tự đánh giá'}
  ]
};

test('V1.24.7 version marker, HTML, SW và import đồng nhất', () => {
  assert.match(read('core/app-version.js'),/APP_VERSION = "1\.24\.7"/);
  assert.match(read('core/app-version.js'),/20260916\.V1_24_7/);
  assert.match(read('index.html'),/release-v1\.24\.7\.js\?v=20260916\.V1_24_7/);
  assert.match(read('index.html'),/appVersionLabel">V1\.24\.7/);
  assert.match(read('sw.js'),/BUILD_VERSION = "20260916\.V1_24_7"/);
  assert.match(read('release-v1.24.7.js'),/Department\/Khu Excel Export/);
});

test('Active import graph: mọi local JS tồn tại, import có token thống nhất', () => {
  const build='20260916.V1_24_7';
  const visited = new Set();
  const pat=/(?:from\s+|import\s*\(|lazyRoute\s*\()\s*["']([^"']+)["']/g;
  const visit = rel => {
    if (visited.has(rel)) return;
    visited.add(rel);
    const file=join(appRoot,rel);
    assert.equal(statSync(file).isFile(),true,rel);
    const text=readFileSync(file,'utf8');
    for (const match of text.matchAll(pat)) {
      const value=match[1];
      if (/^https?:/i.test(value) || !value.includes('.js')) continue;
      const [part,query='']=value.split('?');
      if (query.startsWith('v=')) assert.equal(query.slice(2),build,`${rel} -> ${value}`);
      const target=resolve(dirname(file),part);
      if (target.startsWith(appRoot+'/')) visit(target.slice(appRoot.length+1));
    }
  };
  ['app-v3.js','pwa.js','release-v1.24.7.js'].forEach(visit);
  assert.ok(visited.has('modules/kpi/kpi-workflow.js'));
  assert.ok(visited.has('services/xlsx-export-service.js'));
  console.log('Active JS graph:',visited.size);
});

test('Bảng tổng hợp xuất đúng dữ liệu cùng render, chỉ chuyên môn/ALL và không query mới', () => {
  const block=between(read('modules/kpi/kpi-workflow.js'),'function openDepartmentReport(options = {})','function taskStatus(task, ev)');
  assert.match(block,/exportDepartmentSummaryWorkbook\(/);
  assert.match(block,/let currentWorkbookData = null/);
  assert.match(block,/!isCdtnAggregate && people\.length/);
  assert.match(block,/exportButton\.style\.display = currentWorkbookData/);
  assert.match(block,/summaryForUserCombined\(user\.id\)/);
  assert.match(block,/ratingForUser\(user\.id, data\.total100/);
  assert.match(block,/bonusSummaryForUser\(user\.id\)/);
  assert.match(block,/kpi70: data\.hasCalculationBasis \? Number\(data\.kpi70/);
  assert.doesNotMatch(block,/\b(?:getDocs|getDoc|onSnapshot)\s*\(/);
  assert.match(block,/id="printDepartmentReport"/);
});

test('Native XLSX có 13 cột và điểm numeric, pending được ghi chú thay vì cộng', async () => {
  const files=await sheetXml(buildDepartmentSummaryWorkbookBlob(sample));
  const xml=files.get('xl/worksheets/sheet1.xml');
  assert.equal((xml.match(/<col min=/g)||[]).length,13);
  assert.match(xml,/<c r="E7" s="4" t="n"><v>125<\/v><\/c>/);
  assert.match(xml,/<c r="I7" s="4" t="n"><v>0<\/v><\/c>/);
  assert.match(xml,/Nhân viên mẫu: \+1,1 điểm thưởng chờ xác nhận/);
  assert.match(xml,/Chưa đủ cơ sở/);
  assert.doesNotMatch(xml,/<hyperlinks|<sheetProtection|https?:\/\/(?!schemas\.openxmlformats\.org)/);
});

test('Chữ ký 2 cột cùng row, editable, vùng in chứa signatures, A4 landscape', async () => {
  const files=await sheetXml(buildDepartmentSummaryWorkbookBlob(sample));
  const xml=files.get('xl/worksheets/sheet1.xml');
  const wb=files.get('xl/workbook.xml');
  const n=Number(xml.match(/<c r="A(\d+)" s="10" t="inlineStr"><is><t>NGƯỜI LẬP BIỂU/)[1]);
  assert.match(xml,new RegExp(`<c r="H${n}" s="10" t="inlineStr"><is><t>TRƯỞNG PHÒNG/KHU`));
  for (const r of [n,n+1,n+4]) {
    assert.ok(xml.includes(`ref="A${r}:F${r}"`));
    assert.ok(xml.includes(`ref="H${r}:M${r}"`));
  }
  assert.match(xml,/orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/);
  assert.match(wb,new RegExp(`_xlnm\\.Print_Area[^<]+.*?\\$M\\$${n+4}`));
  assert.doesNotMatch(xml,/<sheetProtection/);
  assert.match(xml,/<oddHeader><\/oddHeader><oddFooter><\/oddFooter>/);
  assert.match(xml,/<c r="A\d+" s="10"\/>/);
});

test('Scope ALL dùng BAN GIÁM ĐỐC, người ký không hard-code',async () => {
  const files=await sheetXml(buildDepartmentSummaryWorkbookBlob({...sample,signerTitle:'BAN GIÁM ĐỐC'}));
  assert.match(files.get('xl/worksheets/sheet1.xml'),/BAN GIÁM ĐỐC/);
});

test('Không dữ liệu phải báo lỗi và không tạo file giả',()=>{
  assert.throws(()=>buildDepartmentSummaryWorkbookBlob({rows:[]}),/Chưa có dữ liệu/);
});

test('Exporter Danh mục sản phẩm chuẩn vẫn còn, không thêm mã nội bộ vào tên',async()=>{
  const files=await sheetXml(buildProductCatalogWorkbookBlob({rows:[{index:1,taskCode:'YT11',title:'Thực hiện quản lý tủ thuốc cấp cứu'}]}));
  const xml=files.get('xl/worksheets/sheet1.xml');
  assert.match(xml,/Thực hiện quản lý tủ thuốc cấp cứu/);
  assert.doesNotMatch(xml,/YT11/);
});

test('Print CSS có selector scoped 2 cột và runtime không còn token build cũ',()=>{
  const css=read('kpi.css');
  assert.match(css,/\.department-report-kpi-summary \.department-report-signatures \{\s*display: grid !important;\s*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\) !important/);
  for(const p of walk(appRoot).filter(x=>!x.includes('/test/') && /\.(js|html|css|json|webmanifest|mjs)$/.test(x))){
    assert.equal(readFileSync(p,'utf8').includes('20260916.V1_24_6'),false,p);
  }
});
