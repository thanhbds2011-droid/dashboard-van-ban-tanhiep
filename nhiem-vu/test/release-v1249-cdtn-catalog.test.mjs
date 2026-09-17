import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(join(root, file), 'utf8');
const src = read('modules/kpi/kpi-workflow.js');
function section(start, end) {
  const a = src.indexOf(start), b = src.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `Source section missing: ${start}`);
  return src.slice(a,b);
}
const planHelper = section('function planVisiblePeople() {', 'function renderPlanDashboard() {');
const catalogTasks = section('function productCatalogTasksForUser(userId) {', 'function productCatalogPeriodTitle(');
const openCatalog = section('async function openProductCatalog(', 'function openDepartmentReport(');
const userPositionFunction = section('function userPositionWithDepartment(user = {}) {', 'function productCatalogTasksForUser(userId) {');
const oldHandler = src.match(/root\.querySelector\('#personProductCatalog'\)\?\.addEventListener\('click',\s*\(\)\s*=>\s*\{([^}]+)\}\);/);
assert.ok(oldHandler, 'Cannot locate person catalog click handler');

const clean = value => String(value ?? '').trim();
const normal = value => clean(value).toUpperCase();
const reg = (uid, override={}) => ({
  id:`2026-Q3_${uid}_CDTN01`, userId:uid, userName:'Nguyễn Thị Hồng Vân', userPosition:'Nhân viên',
  homeDepartmentId:'YT', departmentId:'CDTN', organizationId:'CDTN', periodId:'2026-Q3',
  userAdditionalRoles:['CDTN_DOAN_VIEN'], active:true, status:'APPROVED', ...override
});
const task = (uid, override={}) => ({
  id:'task-a', ownerUserId:uid, active:true, status:'DA_PHAN_CONG', planApprovalStatus:'APPROVED',
  primaryDepartmentId:'CDTN', departmentId:'CDTN', title:'Đầu việc được duyệt', description:'Kết quả đầu ra',
  baseScore:10, difficultyCoefficient:1, maximumConvertedScore:10, ...override
});

function makeContext({people=[],registrations=[reg('van')],tasks=[task('van')],scope='CDTN',authorized=true,period={id:'2026-Q3',name:'Quý III'},loggedIn='secretary'}={}) {
  const state = {users:people,registrations,tasks,user:{uid:loggedIn},profile:{id:loggedIn,uid:loggedIn,fullName:'Bí thư',departmentId:'TCHC'},period};
  const calls={modal:[],alerts:[],exports:[],print:0,buttonHandlers:{},currentModal:'DETAIL',firestore:0};
  const el = name => name==='kpiExportProductCatalogXlsx'||name==='kpiPrintProductCatalog'
    ? {addEventListener: (event, callback)=>{calls.buttonHandlers[name]=callback;}}
    : null;
  const context = {
    KpiWorkflowState:state,clean,normalizeDepartment:normal,
    visiblePeople:()=>[...state.users],isCdtnScope:()=>scope==='CDTN',canViewDepartmentData:()=>authorized,
    itemInActiveScope:item=>scope==='CDTN' && item.departmentId==='CDTN',
    canApproveRegistration:item=>authorized && item.status==='PENDING',
    personalTasksForUser:uid=>state.tasks.filter(t=>t.ownerUserId===uid && t.active!==false),
    compareTasksForDisplay:()=>0,
    departmentDisplayName:id=>({YT:'Phòng Y tế',CDTN:'Chi đoàn Trung tâm',TCHC:'Phòng Tổ chức - Hành chính'})[id] || 'Phòng/Khu',
    productCatalogPeriodTitle:()=> 'DANH MỤC SẢN PHẨM CHUẨN',
    productCatalogDeadlineLabel:()=> 'Theo từng lượt phát sinh',
    exceededSummaryForUser:()=>({exceededTasks:0}),
    esc:value=>String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;'),
    fmt:value=>String(value ?? 0),coefficientPercent:()=> '100%',
    modal:(title,body,footer)=>{calls.currentModal='CATALOG';calls.modal.push({title,body,footer});return {}},
    ModalService:{alert:async msg=>{calls.alerts.push(msg)}},
    exportProductCatalogWorkbook:args=>{calls.exports.push(args)},
    el,window:{print:()=>{calls.print++}}
  };
  vm.createContext(context);
  vm.runInContext(`${planHelper}\n${userPositionFunction}\n${catalogTasks}\n${openCatalog}`, context);
  return {context,state,calls,open:uid=>vm.runInContext(`openProductCatalog(${JSON.stringify(uid)})`,context)};
}

test('Root cause: Detail button does not close old popup before catalog validation',()=>{
  assert.doesNotMatch(oldHandler[1],/closeModal\s*\(/);
  assert.match(oldHandler[1],/openProductCatalog\(uid\)/);
});

test('Approved CDTN registration fallback opens full catalog, uses snapshot home department and same UID',async()=>{
  const {open,calls,state}=makeContext();
  await open('van');
  assert.equal(calls.modal.length,1);
  assert.match(calls.modal[0].body,/Nguyễn Thị Hồng Vân/);
  assert.match(calls.modal[0].body,/Phòng Y tế/);
  assert.match(calls.modal[0].body,/Đầu việc được duyệt/);
  assert.match(calls.modal[0].body,/Kết quả đầu ra/);
  assert.equal(state.users.length,0,'must not mutate global directory');
  assert.equal(calls.currentModal,'CATALOG');
  calls.buttonHandlers.kpiExportProductCatalogXlsx();
  assert.equal(calls.exports.length,1);
  assert.equal(calls.exports[0].employeeName,'Nguyễn Thị Hồng Vân');
  assert.equal(calls.exports[0].departmentName,'Phòng Y tế');
  assert.equal(calls.exports[0].rows.length,1);
  calls.buttonHandlers.kpiPrintProductCatalog();
  assert.equal(calls.print,1);
});

test('Existing directory record remains authoritative, no overwrite from registration snapshot',async()=>{
  const {open,calls}=makeContext({people:[{id:'van',fullName:'Tên chính thức',departmentId:'KHTC',position:'Chuyên viên',active:true}]});
  await open('van');
  assert.equal(calls.modal.length,1);
  assert.match(calls.modal[0].body,/Tên chính thức/);
  assert.doesNotMatch(calls.modal[0].body,/Nguyễn Thị Hồng Vân/);
});

test('Only pending registration renders empty product table; does not claim an approved task',async()=>{
  const {open,calls}=makeContext({registrations:[reg('van',{status:'PENDING'})],tasks:[]});
  await open('van');
  assert.equal(calls.modal.length,1);
  assert.match(calls.modal[0].body,/Chưa có nhiệm vụ được duyệt/);
  assert.match(calls.modal[0].body,/Tổng số nhiệm vụ thực hiện trong kỳ:<\/strong> 0/);
});

test('Catalog excludes unapproved, cancelled and inactive tasks',async()=>{
  const {open,calls}=makeContext({tasks:[task('van'),task('van',{id:'unapproved',title:'Không duyệt',planApprovalStatus:'PENDING'}),task('van',{id:'cancelled',title:'Đã hủy',status:'HUY'}),task('van',{id:'inactive',title:'Không hoạt động',active:false})]});
  await open('van');
  assert.equal(calls.modal.length,1);
  assert.match(calls.modal[0].body,/Đầu việc được duyệt/);
  assert.doesNotMatch(calls.modal[0].body,/Không duyệt|Đã hủy|Không hoạt động/);
  calls.buttonHandlers.kpiExportProductCatalogXlsx();
  assert.equal(calls.exports[0].rows.length,1);
});

test('Wrong period, non-CDTN and unauthorized viewer never resolve registration fallback',async()=>{
  for(const config of [
    {registrations:[reg('van',{periodId:'2026-Q2'})]},
    {registrations:[reg('van',{departmentId:'YT'})]},
    {scope:'YT'},
    {authorized:false},
    {registrations:[reg('van',{organizationId:'OTHER'})]},
    {registrations:[reg('van',{active:false})]}
  ]) {
    const {open,calls}=makeContext(config);
    await open('van');
    assert.equal(calls.modal.length,0,JSON.stringify(config));
    assert.equal(calls.alerts.length,1,JSON.stringify(config));
    assert.equal(calls.currentModal,'DETAIL','previous modal must remain open');
  }
});

test('Missing period warns without closing existing Detail',async()=>{
  const {open,calls}=makeContext({period:null});
  await open('van');
  assert.equal(calls.modal.length,0);
  assert.equal(calls.alerts.length,1);
  assert.equal(calls.currentModal,'DETAIL');
});

test('Legacy registration without home department does not fabricate department in catalog or Excel',async()=>{
  const {open,calls}=makeContext({registrations:[reg('van',{homeDepartmentId:''})]});
  await open('van');
  assert.match(calls.modal[0].body,/Chưa xác minh Phòng\/Khu/);
  calls.buttonHandlers.kpiExportProductCatalogXlsx();
  assert.equal(calls.exports[0].departmentName,'Chưa xác minh Phòng/Khu');
});

test('Fallback in catalog causes no extra reads, writes, listeners, auth/scoring changes',()=>{
  assert.doesNotMatch(planHelper+openCatalog,/\b(?:getDoc|getDocs|onSnapshot|setDoc|updateDoc|addDoc|deleteDoc|writeBatch|calculateTaskScore|calculateKpiSummary)\s*\(/);
  assert.match(src,/function planVisiblePeople\(\)/);
  assert.match(src,/const people = planVisiblePeople\(\)\.filter\(/);
  assert.match(src,/root\.querySelector\('#personProductCatalog'\)/);
});

test('V1.24.9 version, active import graph, cache and release metadata consistent',()=>{
  const build='20260917.V1_24_9';
  assert.match(read('core/app-version.js'),/APP_VERSION = "1\.24\.9"/);
  assert.ok(read('core/app-version.js').includes(build));
  assert.ok(read('sw.js').includes(build));
  assert.ok(read('index.html').includes(`release-v1.24.9.js?v=${build}`));
  assert.ok(read('index.html').includes('appVersionLabel">V1.24.9'));
  const cache = read('core/app-version.js').match(/CACHE_NAME = "([^"]+)"/)[1];
  assert.equal(read('sw.js').match(/-cdtn-catalog-v1249"/)[0],'-cdtn-catalog-v1249"');
  assert.equal(cache,`nhiem-vu-${build.toLowerCase().replace(/[^a-z0-9]+/g,'-')}-cdtn-catalog-v1249`);
  const seen=new Set(),pat=/(?:from\s+|import\s*\(|lazyRoute\s*\()\s*["']([^"']+)["']/g;
  function visit(rel) {
    if(seen.has(rel))return;
    seen.add(rel);
    const full=join(root,rel);
    assert.ok(statSync(full).isFile(),rel);
    const text=readFileSync(full,'utf8');
    for(const m of text.matchAll(pat)) {
      if(/^https?:/.test(m[1])||!m[1].includes('.js'))continue;
      const [part,query='']=m[1].split('?');
      assert.equal(query,`v=${build}`,`${rel}: ${m[1]}`);
      const target=resolve(dirname(full),part);
      assert.ok(target.startsWith(root+'/'),`${rel}: ${m[1]}`);
      visit(target.slice(root.length+1));
    }
  }
  ['app-v3.js','pwa.js','release-v1.24.9.js'].forEach(visit);
  assert.ok(seen.has('modules/kpi/kpi-workflow.js'));
  console.log('Verified active JS graph:',seen.size);
});
