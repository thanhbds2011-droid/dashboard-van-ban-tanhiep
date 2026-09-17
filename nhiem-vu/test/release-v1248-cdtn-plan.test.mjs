import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFileSync(join(root,name),'utf8');
const src = read('modules/kpi/kpi-workflow.js');
const helper = src.slice(src.indexOf('function planVisiblePeople() {'),src.indexOf('function renderPlanDashboard() {'));
assert.ok(helper.startsWith('function planVisiblePeople() {'),'Missing source function');
const CDTN = ['CDTN_DOAN_VIEN'];
const reg=(uid, extra={})=>({id:`2026-Q3_${uid}_CDTN01`,userId:uid,userName:uid,userPosition:'Nhân viên',departmentId:'CDTN',organizationId:'CDTN',periodId:'2026-Q3',status:'PENDING',active:true,userAdditionalRoles:CDTN,...extra});
const person=(id,extra={})=>({id,fullName:id,active:true,...extra});
function evaluate({users=[],regs=[],periodId='2026-Q3',scope='CDTN',authorized=true,approvable=true,global=false}={}) {
 const state={users:[...users],registrations:[...regs],tasks:[],user:{uid:'reviewer'},period:{id:periodId}};
 const context={KpiWorkflowState:state,clean:x=>String(x??'').trim(),normalizeDepartment:x=>String(x??'').trim().toUpperCase(),visiblePeople:()=>[...state.users],isCdtnScope:()=>scope==='CDTN',canViewDepartmentData:()=>authorized,itemInActiveScope:obj=>obj.departmentId==='CDTN'&&scope==='CDTN',canApproveRegistration:obj=>approvable&&obj.status==='PENDING'};
 vm.createContext(context);
 vm.runInContext(helper+'\nthis.list=planVisiblePeople();',context);
 return {list:context.list,state};
}

test('CDTN: missing member but valid pending registration becomes one plan row with snapshot name',()=>{
 const {list,state}=evaluate({users:[person('reviewer')],regs:[reg('van',{userName:'Nguyễn Thị Hồng Vân'})]});
 assert.equal(list.length,2);assert.equal(list.find(x=>x.id==='van').fullName,'Nguyễn Thị Hồng Vân');
 assert.equal(list.find(x=>x.id==='van')._cdtnRegistrationSnapshotOnly,true);
 assert.equal(state.users.length,1,'do not mutate global KPI user directory');
});
test('CDTN: registered member already in directory is not duplicated or overwritten',()=>{
 const {list}=evaluate({users:[person('van',{fullName:'Tên danh bạ'})],regs:[reg('van',{userName:'Tên snapshot cũ'}),reg('van',{id:'second'})]});
 assert.equal(list.length,1);assert.equal(list[0].fullName,'Tên danh bạ');
});
test('CDTN: rejects wrong period, wrong unit, deleted, malformed, inactive known member, no membership evidence',()=>{
 const regs=[reg('old',{periodId:'2026-Q2'}),reg('outside',{departmentId:'YT'}),reg('foreign',{organizationId:'OTHER'}),reg('deleted',{active:false}),reg('noid',{userId:''}),reg('inactive'),reg('norole',{userAdditionalRoles:[],status:'APPROVED'})];
 const {list}=evaluate({users:[person('inactive',{active:false})],regs,approvable:false});
 assert.equal(list.length,1); assert.equal(list[0].id,'inactive');
});
test('CDTN: legacy PENDING missing role snapshot only allowed when reviewer can approve',()=>{
 const legacy=reg('legacy',{userAdditionalRoles:[]});
 assert.equal(evaluate({regs:[legacy],approvable:false}).list.length,0);
 assert.equal(evaluate({regs:[legacy],approvable:true}).list.length,1);
});
test('Non-CDTN scope and unauthorized CDTN viewer never union registrations',()=>{
 assert.equal(evaluate({users:[person('other')],regs:[reg('van')],scope:'YT'}).list.length,1);
 assert.equal(evaluate({users:[person('other')],regs:[reg('van')],authorized:false}).list.length,1);
});
test('No extra Firestore reads, writes, listener, scoring or authority changes in helper',()=>{
 assert.doesNotMatch(helper,/\b(?:getDoc|getDocs|onSnapshot|setDoc|updateDoc|addDoc|deleteDoc|writeBatch|calculateTaskScore|calculateKpiSummary)\s*\(/);
 assert.match(src,/const people = planVisiblePeople\(\)\.filter\(/);
 assert.match(src,/const user = planVisiblePeople\(\)\.find\(item => item\.id === uid\)/);
 assert.match(src,/const people = visiblePeople\(\)\s*\.map\(user => \(\{ \.\.\.user, _tasks:/);
});
test('Release 1.24.8 build markers, HTML, PWA SW and active import graph are consistent',()=>{
 const build='20260917.V1_24_8';
 assert.match(read('core/app-version.js'),/APP_VERSION = "1\.24\.8"/);
 assert.ok(read('core/app-version.js').includes(build));
 assert.ok(read('sw.js').includes(build));
 assert.equal(read('core/app-version.js').match(/CACHE_NAME = "([^"]+)/)[1], 'nhiem-vu-'+build.toLowerCase().replace(/[^a-z0-9]+/g,'-')+'-cdtn-plan-visibility-v1248');
 assert.ok(read('index.html').includes(`release-v1.24.8.js?v=${build}`));
 assert.ok(read('index.html').includes(`appVersionLabel">V1.24.8`));
 const seen=new Set();const pat=/(?:from\s+|import\s*\(|lazyRoute\s*\()\s*["']([^"']+)["']/g;
 function visit(rel) {
   if(seen.has(rel))return;
   seen.add(rel);const full=join(root,rel);assert.ok(statSync(full).isFile(),rel);
   const text=readFileSync(full,'utf8');
   for(const m of text.matchAll(pat)){
    if(/^https?:/.test(m[1])||!m[1].includes('.js'))continue;
    const [part,query='']=m[1].split('?');
    assert.equal(query,`v=${build}`,`${rel}: ${m[1]}`);
    const target=resolve(dirname(full),part);
    assert.ok(target.startsWith(root+'/'),`${rel}: ${m[1]}`);
    visit(target.slice(root.length+1));
   }
 }
 ['app-v3.js','pwa.js','release-v1.24.8.js'].forEach(visit);
 assert.ok(seen.has('modules/kpi/kpi-workflow.js'));
 console.log('Active graph modules:',seen.size);
});
test('Integration: plan dashboard renders missing CDTN member with pending count and preserves detail UID',()=>{
  const render=src.slice(src.indexOf('function renderPlanDashboard() {'),src.indexOf('function completedTaskForEvaluation(task) {'));
  assert.ok(render.startsWith('function renderPlanDashboard() {'));
  const target={innerHTML:'',querySelectorAll:()=>[]};
  const state={users:[person('reviewer',{fullName:'Bí thư'})],registrations:[reg('van',{userName:'Nguyễn Thị Hồng Vân'})],tasks:[],user:{uid:'reviewer'},period:{id:'2026-Q3'}};
  const clean=x=>String(x??'').trim();
  const context={KpiWorkflowState:state,clean,normalizeDepartment:x=>clean(x).toUpperCase(),visiblePeople:()=>[...state.users],isCdtnScope:()=>true,canViewDepartmentData:()=>true,itemInActiveScope:r=>r.departmentId==='CDTN',canApproveRegistration:()=>true,el:id=>id==='kpiTaskList'?target:null,rowsForPerson:()=>[],regsForPerson:uid=>state.registrations.filter(r=>r.userId===uid&&r.active!==false),fmt:n=>String(n),esc:x=>String(x??''),renderCompactEvaluationPanel:()=>{},openPersonPlanDetail:()=>{}};
  vm.createContext(context);
  vm.runInContext(helper+'\n'+render+'\nrenderPlanDashboard();',context);
  assert.match(target.innerHTML,/Nguyễn Thị Hồng Vân/);
  assert.match(target.innerHTML,/data-person-detail="van"/);
  assert.match(target.innerHTML,/1 chờ duyệt/);
  assert.equal((target.innerHTML.match(/data-person-detail="van"/g)||[]).length,1);
});
