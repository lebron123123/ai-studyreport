const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const copy=x=>JSON.parse(JSON.stringify(x));
function harness(){
  const storage=new Map(),calls={alerts:[],modes:[],confirm:0};
  const c={console,setTimeout,clearTimeout,Date,structuredClone,JSON,
    sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},
    document:{getElementById:()=>null,querySelectorAll:()=>[]},
    currentProjectId:'a',project:{name:'[系统测试]项目A'},currentProjectRole:'OWNER',appMode:'aireport',
    getUser:()=> 'tester',projectCanEdit:()=>c.currentProjectRole==='OWNER',
    chapters:[{cn:'一',name:'财务评价',sections:[{t:'现金流',numeric:true,content:'保留原报告正文'}]}],
    projectWorkflow:{calcSnapshots:[],currentCalcSnapshotId:null},
    renderTOC:()=>{},renderSheet:()=>{},escapeHtml:x=>String(x),authHeaders:()=>({}),
    alert:x=>calls.alerts.push(x),confirm:()=>{calls.confirm++;return true;},
    saveDraft:async()=>{calls.modes.push(c.appMode);return true;},
    ResearchUI:{active:()=>false},reportHasVisibleBody:s=>!!s.content,
  };
  c.window=c;vm.createContext(c);
  for(const f of ['project-workflow.js','calc.js','aireport.js'])vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),c,{filename:f});
  const e=s=>vm.runInContext(s,c);
  e("calcType='gaibao';calcParams={area:100,rent:45};calcResult={__ctype:'gaibao',summary:{irr:4}};aiReportExtracted={projectName:project.name,calcType:'gaibao'};aiReportChatLoaded=true;");
  c.airSaveState=async()=>true;c.airPush=m=>e('aiReportChat').push(m);c.airRepairFlowCards=()=>{};
  c.runCalcEngine=(type,p)=>({__ctype:type,summary:{irr:p.rent,totalIncome:p.area*p.rent,totalNetProfit:p.rent,totalNpv:p.rent}});
  const pending=(type='gaibao')=>{e("calcType="+JSON.stringify(type)+";scParams={area:100,rent:55};scResult=runCalcEngine(calcType,scParams);scStep=2;");};
  return {c,e,calls,storage,pending,state:()=>copy(e('({calcParams,calcResult,scParams,scResult,mode:aiReportCalculationMode,confirmed:aiReportParamsConfirmed,chat:aiReportChat,step:scStep})'))};
}
test('two input routes are explicit and entry preserves original calculation',async()=>{
  const h=harness();assert.match(h.c.airCalculationRouteHtml(),/关键参数输入/);assert.match(h.c.airCalculationRouteHtml(),/全量参数测算/);
  const before=h.state();await h.c.airStartFullCalc();assert.equal(h.c.appMode,'calc');assert.equal(h.state().step,1);
  assert.deepEqual(h.state().calcParams,before.calcParams);assert.deepEqual(h.state().calcResult,before.calcResult);assert.ok(h.c.calcAirTicket());
});
test('cancel returns without adoption and persists AI route',async()=>{
  const h=harness();await h.c.airStartFullCalc();h.pending();await h.c.airReturnFromFullCalc(false);
  assert.equal(h.c.appMode,'aireport');assert.equal(h.state().calcParams.rent,45);assert.equal(h.c.calcAirTicket(),null);assert.equal(h.calls.modes.at(-1),'aireport');
});
test('adoption reruns engine, creates one snapshot, preserves body and marks dependent sections',async()=>{
  const h=harness();await h.c.airStartFullCalc();h.pending();await h.c.airReturnFromFullCalc(true);
  assert.deepEqual(h.calls.alerts,[]);assert.equal(h.state().calcParams.rent,55);assert.equal(h.state().confirmed,true);
  assert.equal(h.c.projectWorkflow.calcSnapshots.length,1);assert.equal(h.c.projectWorkflow.calcSnapshots[0].inputMode,'full');
  assert.equal(h.c.chapters[0].sections[0].content,'保留原报告正文');assert.equal(h.c.chapters[0].sections[0].syncStatus,'stale');
  assert.equal(h.c.appMode,'aireport');assert.equal(h.calls.modes.at(-1),'aireport');assert.equal(h.c.calcAirTicket(),null);
  await h.c.airReturnFromFullCalc(true);assert.equal(h.c.projectWorkflow.calcSnapshots.length,1);
});
test('experience application changes pending inputs only until explicit adoption',async()=>{
  const h=harness();let opened;h.c.CalcExperienceLibrary={open:options=>{opened=options;},close:()=>{}};
  h.c.airOpenCalcExperienceLibrary();assert.equal(opened.projectId,'a');assert.equal(opened.projectType,'gaibao');
  await h.c.airStartFullCalc();h.c.calcApplyExperienceMetrics({id:'exp-a',revision:7,projectType:'gaibao',payload:{params:{}}},[{metricKey:'rent',value:60}]);
  assert.equal(h.state().calcParams.rent,45);assert.equal(h.state().scParams.rent,60);assert.equal(h.state().step,1);
});
for(const mismatch of ['project','user','research','type','version','result','permission'])test('rejects '+mismatch+' mismatch without overwrite',async()=>{
  const h=harness();await h.c.airStartFullCalc();h.pending();
  if(mismatch==='project')h.c.currentProjectId='b';
  if(mismatch==='user')h.c.getUser=()=> 'other';
  if(mismatch==='research')h.c.ResearchUI={active:()=>true,capture:()=>({researchId:'r',runId:'new',epoch:2})};
  if(mismatch==='type')h.pending('rent');
  if(mismatch==='version')h.e('calcParams={area:100,rent:46}');
  if(mismatch==='result')h.e('scParams.rent=70');
  if(mismatch==='permission')h.c.currentProjectRole='VIEWER';
  const before=h.state().calcParams;await h.c.airReturnFromFullCalc(true);assert.deepEqual(h.state().calcParams,before);assert.equal(h.c.projectWorkflow.calcSnapshots.length,0);assert.ok(h.calls.alerts.length);
});
test('save failure is recoverable and retry does not create another snapshot',async()=>{
  const h=harness();await h.c.airStartFullCalc();h.pending();h.c.airSaveState=async()=>false;
  await h.c.airReturnFromFullCalc(true);assert.equal(h.c.appMode,'calc');assert.equal(h.c.projectWorkflow.calcSnapshots.length,1);assert.equal(h.c.calcAirTicket().adopted,true);
  await h.c.airReturnFromFullCalc(false);assert.equal(h.c.appMode,'calc');assert.ok(h.c.calcAirTicket());
  h.c.airSaveState=async()=>true;await h.c.airReturnFromFullCalc(true);assert.equal(h.c.appMode,'aireport');assert.equal(h.c.projectWorkflow.calcSnapshots.length,1);
});
test('async permission check rechecks version and project identity',async()=>{
  const h=harness();let resolve;h.c.ResearchUI={active:()=>true,capture:()=>({researchId:'r',runId:'one',epoch:1}),guard:async()=>{},editable:()=>true};
  await h.c.airStartFullCalc();h.pending();h.c.ResearchUI.guard=()=>new Promise(r=>resolve=r);
  const p=h.c.airReturnFromFullCalc(true);await Promise.resolve();h.e('calcParams={rent:99}');resolve();await p;
  assert.equal(h.state().calcParams.rent,99);assert.equal(h.c.projectWorkflow.calcSnapshots.length,0);
});
test('double click during save is single flight',async()=>{
  const h=harness();await h.c.airStartFullCalc();h.pending();let resolve;h.c.saveDraft=()=>new Promise(r=>resolve=r);
  const p=h.c.airReturnFromFullCalc(true);await Promise.resolve();await h.c.airReturnFromFullCalc(true);resolve(true);await p;
  assert.equal(h.c.projectWorkflow.calcSnapshots.length,1);assert.equal(h.calls.confirm,1);
});
test('private research drafts isolate run and epoch, malformed ticket grants nothing',()=>{
  const h=harness();h.c.currentProjectId=null;let epoch=1;h.c.ResearchUI={active:()=>true,capture:()=>({researchId:'r',runId:'run',epoch})};
  const first=h.c.calcDraftKey();epoch=2;assert.notEqual(h.c.calcDraftKey(),first);
  h.storage.set('studyreport:calc-air-handoff:v2','broken');assert.equal(h.c.calcAirTicket(),null);
});
