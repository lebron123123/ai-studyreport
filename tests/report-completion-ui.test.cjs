const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
require('../scripts/windows-browser-lockout-guard.cjs');
const C=require('../report-completion-contract.js'),WF=require('../project-workflow.js');
const BusinessStructure=require('../report-business-structure.js');
const source=fs.readFileSync(require.resolve('../report.js'),'utf8');
const part=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const ui=part('function reportCompletionFacts(','async function reportEditGlobalRequirements(');
function fixture(extra=''){
  const s={t:'项目概况',content:'项目概况',syncStatus:'stale'},c={name:'总论',cn:'一',checked:true,sections:[s]},state={calls:0,saves:0,alerts:[],requests:[]};
  const ctx={chapters:[c],project:{name:'[系统测试]隔离项目',location:'测试区域'},projectWorkflow:{},calcParams:{area:5973,units:195,operateYears:6,mode:'分成'},currentProjectId:'test-a',ReportCompletionContract:C,ReportBusinessStructure:BusinessStructure,ProjectWorkflow:WF,ReportOutputPolicy:{contentVersion:'test'},
    rlProjectType:()=> 'gaibao',rlBusinessScenario:()=> 'housing',sectionFormalTemplates:()=>[],escapeHtml:s=>String(s).replace(/[&<>"']/g,v=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[v])),renderContent:s=>'<p>'+s+'</p>',projectCanEdit:()=>true,
    alert:s=>state.alerts.push(s),prompt:()=>null,saveDraft:()=>state.saves++,persistReportDraft:async()=>{state.saves++;return {ok:true};},document:{querySelectorAll:()=>[],getElementById:()=>null},renderSheet:()=>{},
    runWorkerPool:async(tasks,run)=>{for(const t of tasks)await run(t);},reviseSection:async()=>{state.calls++;return '新正文';},reportLogicRevision:()=>null,authHeaders:()=>({}),ReportLogicCore:{load:async()=>{}},
    fetch:async(url,options)=>{const p=JSON.parse(options.body);state.requests.push({url,...p});return {ok:true,status:200,json:async()=>p.action==='evaluateRuleRevision'?{ok:true,evaluation:{recommended:true,oldScore:75,candidateScore:80}}:p.action==='adminCapability'?{ok:true,isAdmin:false}:{ok:true}};}};
  ctx.window=ctx;vm.createContext(ctx);vm.runInContext(ui+extra,ctx);return {ctx,s,c,state};
}
test('事实确认不改测算；数字格式等价不误报，真正冲突保留两方口径',()=>{
  const f=fixture();f.ctx.projectWorkflow.reportCompletion={facts:[{key:'area',value:'5973.0',status:'confirmed',source:'原件1.1'},{key:'operateYears',value:'12',status:'pending',source:'旧口径'}]};
  const facts=f.ctx.reportCompletionFacts();assert.equal(facts[0].status,'confirmed');assert.equal(facts[1].status,'conflict');assert.match(facts[1].source,/6/);assert.equal(f.ctx.calcParams.operateYears,6);assert.equal(f.ctx.projectWorkflow.reportCompletion.facts[1].status,'pending');
});
test('自动成稿阻断保留完整候选，已有候选不覆盖；事实修改经异步复核防串项目',async()=>{
  const f=fixture(),length=f.ctx.reportSectionContract(f.c,f.s).requirements.proseMax+1;assert.throws(()=>f.ctx.reportCheckGeneratedDraft(f.c,f.s,'长'.repeat(length)),/待返修/);assert.equal(f.s.content,'项目概况');assert.equal(f.s.pendingRevision.after.length,length);const candidate=f.s.pendingRevision;
  assert.throws(()=>f.ctx.reportCheckGeneratedDraft(f.c,f.s,'另稿'.repeat(length)));assert.equal(f.s.pendingRevision,candidate);
  const answers=['运营年限','6','协议2.1','pending',''];f.ctx.prompt=()=>answers.shift();f.ctx.ResearchUI={active:()=>true,editable:()=>true,capture:()=>({}),guard:async()=>{f.ctx.currentProjectId='test-b';},accepts:()=>false};
  await f.ctx.reportEditCompletionFact(-1);assert.equal(f.ctx.projectWorkflow.reportCompletion,undefined);assert.match(f.state.alerts.at(-1),/已变化/);
});
test('同步测算不覆盖候选，迟到锁定不计成功且不保存切换后的报告',async()=>{
  const code=part('async function updateStaleSections(','// 界面渲染：');
  const f=fixture(code);WF.setCandidate(f.s,'已有候选','先前');await f.ctx.updateStaleSections();assert.equal(f.state.calls,0);
  f.s.pendingRevision=null;f.ctx.reviseSection=async()=>{f.s.locked=true;return '迟到正文';};await f.ctx.updateStaleSections();assert.equal(f.s.pendingRevision,null);assert.match(f.state.alerts.at(-1),/失败/);
  f.s.locked=false;const saved=f.state.saves;f.ctx.reviseSection=async()=>{f.ctx.chapters=[];return '别的项目';};await f.ctx.updateStaleSections();assert.equal(f.state.saves,saved);
});
test('逻辑评测期间切换项目不串写；正常提交使用冻结项目定位',async()=>{
  const code=part('async function adoptReportLogicRevision(','function renderReportTableAppendix('),revision={rules:[{id:'rule1',writingLogic:'待审逻辑'}],updatedAt:1};
  const ok=fixture(code);await ok.ctx.adoptReportLogicRevision(ok.c,ok.s,revision);assert.match(ok.state.requests.at(-1).item.source_ref,/project:test-a/);assert.equal(ok.state.requests.at(-1).item.region,'测试区域');
  const switched=fixture(code),fetch=switched.ctx.fetch;switched.ctx.fetch=async(url,opt)=>{const r=await fetch(url,opt);if(JSON.parse(opt.body).action==='adminCapability')switched.ctx.currentProjectId='test-b';return r;};
  await assert.rejects(switched.ctx.adoptReportLogicRevision(switched.c,switched.s,revision),/已变化/);assert.equal(switched.state.requests.some(r=>r.url==='/api/contributions'),false);
});
test('真实浏览器：成稿面板折叠、事实/预算编辑、失败保护、刷新及空数据',{timeout:60000},async()=>{
  const {chromium}=require('playwright'),browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    const bootstrap="var chapters=[{name:'总论',checked:true,sections:[{t:'项目概况',content:'[系统测试]报告，项目面积5973平方米。'}]}],project={name:'[系统测试]报告'},calcParams={area:5973},projectWorkflow={};var currentProjectId='isolated';window.rlProjectType=()=> 'gaibao';window.sectionFormalTemplates=()=>[];window.escapeHtml=s=>String(s).replaceAll('<','&lt;');window.renderContent=s=>'<p>'+s+'</p>';window.projectCanEdit=()=>true;window.persistReportDraft=async()=>({ok:!window.failSave});window.draw=()=>document.querySelector('main').innerHTML=reportCompletionReviewHtml();";
    const dependencies=['report-length-plan.js','report-completion-contract.js','report-business-structure.js'].map(file=>'<script>'+fs.readFileSync(require.resolve('../'+file),'utf8')+'</script>').join('');
    await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><main></main>'+dependencies+'<script>'+bootstrap+'window.rlBusinessScenario=()=> "housing_conversion";window.rlProjectText=()=>project.name;'+ui+';draw()</script>'}));
    await page.goto('http://localhost:8080/[system-test]-completion');
    for(let round=0;round<2;round++){
      if(round)await page.reload();
      const summary=page.locator('.report-completion-review > summary');for(let n=0;n<5;n++){await summary.click();assert.equal(await page.locator('.report-completion-review').evaluate(el=>el.open),n%2===0);}
      assert.match(await page.locator('main').innerText(),/证据待核实/);
      await page.locator('.report-completion-review details > summary').click();
      const facts=['面积','5973','协议第1页','confirmed',''];page.on('dialog',async function handler(d){await d.accept(facts.shift());if(!facts.length)page.off('dialog',handler);});await page.getByText('核对/修改',{exact:true}).last().click();
      assert.equal(await page.evaluate(()=>projectWorkflow.reportCompletion.facts.at(-1).status),'confirmed');assert.equal(await page.evaluate(()=>calcParams.area),5973);
      await page.locator('.report-completion-review > summary').click();
      const budgets=['1500,2000,1,18,1500,180','必要工程说明，经测试核对'];page.on('dialog',async function handler(d){await d.accept(budgets.shift());if(!budgets.length)page.off('dialog',handler);});await page.getByText('调整预算',{exact:true}).click();
      assert.equal(await page.evaluate(()=>reportCompletionPlan().sections[0].requirements.proseMax),2000);
      assert.equal(await page.evaluate(()=>reportCompletionPlan().sections[0].requirements.proseTarget),1500);
    }
    await page.evaluate(()=>{chapters=[];draw();});assert.match(await page.locator('main').innerText(),/0 小节/);
    await page.reload();await page.evaluate(()=>{failSave=true;let n=0;window.prompt=()=>n++?'故障验证':'1500,2000,1,18,1500,180';window.alert=t=>window.lastAlert=t;});await page.evaluate(()=>reportEditCompletionBudget(0));assert.match(await page.evaluate(()=>lastAlert),/尚未保存成功/);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
