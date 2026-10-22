const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
require('../scripts/windows-browser-lockout-guard.cjs');
const Contract=require('../report-completion-contract.js');
const BusinessStructure=require('../report-business-structure.js');
const source=fs.readFileSync(path.resolve('report.js'),'utf8');
const ui=source.slice(source.indexOf('function reportCompletionFacts('),source.indexOf('async function reportEditGlobalRequirements('));
const outline=()=>[{name:'项目总论',checked:true,sections:[{t:'项目本体情况',content:'项目情况待核对'}]},{name:'项目合作模式',checked:true,sections:[{t:'合作模式',content:'合作模式待确认'},{t:'合作核心条款',content:'合作期限待确认'}]}];
test('收楼方式按中文语义核对，兼容旧枚举事实和新台账，参数及待核实状态不变',()=>{
  for(const value of ['rent-percent','按当月实收租金比例收楼']){
    const facts=[{key:'mode',label:'经营模式',value,status:'pending',owner:'项目合作模式 / 合作模式',required:true}],{ctx}=fixture({facts});ctx.calcParams.mode='rent-percent';
    const before=JSON.stringify(facts),f=ctx.reportCompletionFacts()[0];assert.equal(f.value,'按当月实收租金比例收楼');assert.equal(f.inputValue,f.value);assert.equal(f.status,'pending');assert.equal(ctx.calcParams.mode,'rent-percent');assert.equal(JSON.stringify(facts),before);
    ctx.calcParams.mode='lease';assert.equal(ctx.reportCompletionFacts()[0].status,'conflict');
  }
});
function fixture({chapters=outline(),facts}={}){
  const state={alerts:[],saves:0},ctx={chapters,project:{name:'[系统测试]事实归属'},calcParams:{area:5973,units:195,operateYears:6,mode:'投资抵扣后分成'},projectWorkflow:facts?{reportCompletion:{facts}}:{},currentProjectId:'test-fact-a',ReportCompletionContract:Contract,ReportBusinessStructure:BusinessStructure,kbEntries:[],rlBusinessScenario:()=> 'housing_conversion',rlProjectText:()=> '[系统测试]事实归属',
    sectionFormalTemplates:()=>[],rlProjectType:()=> 'gaibao',renderContent:t=>'<p>'+t+'</p>',escapeHtml:t=>String(t).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),projectCanEdit:()=>true,alert:t=>state.alerts.push(t),prompt:()=>null,document:{querySelectorAll:()=>[]},persistReportDraft:async()=>{state.saves++;return {ok:true};}};
  ctx.window=ctx;vm.createContext(ctx);vm.runInContext(ui,ctx);return {ctx,state};
}
test('核心输入仅在唯一职责节设为必要事实，不自动确认、不改原输入',()=>{
  const {ctx}=fixture(),before=JSON.stringify({p:ctx.calcParams,w:ctx.projectWorkflow}),facts=ctx.reportCompletionFacts(),plan=ctx.reportCompletionPlan();
  assert.equal(plan.factAllocation.status,'ready');assert.equal(facts.length,5);
  for(const fact of facts){assert.equal(fact.status,'pending');assert.equal(fact.required,true);assert.ok(fact.owner);assert.equal(plan.sections.filter(s=>s.requiredFacts.some(f=>f.key===fact.key&&f.required)).length,1);}
  assert.equal(facts.find(f=>f.key==='area').owner,'项目总论 / 项目本体情况');
  assert.equal(facts.find(f=>f.key==='operateYears').owner,'项目合作模式 / 合作核心条款');
  assert.equal(facts.find(f=>f.key==='mode').owner,'项目合作模式 / 合作模式');
  assert.equal(JSON.stringify({p:ctx.calcParams,w:ctx.projectWorkflow}),before);
});
test('旧空归属不默认为背景或全篇重复，页面可见且生成前阻断，原值状态不变',()=>{
  const raw=[{key:'area',label:'面积',value:'5973',status:'confirmed',source:'原件第1页',owner:'',required:false}],{ctx}=fixture({facts:raw}),snapshot=JSON.stringify(raw),plan=ctx.reportCompletionPlan();
  assert.equal(plan.factAllocation.status,'blocked');assert.equal(plan.factAllocation.facts[0].suggestedOwner,'项目总论 / 项目本体情况');
  assert.equal(plan.sections.flatMap(s=>s.requiredFacts).length,0);assert.match(ctx.reportCompletionReviewHtml(),/事实职责待分配/);assert.match(ctx.reportCompletionReviewHtml(),/旧事实尚未分配职责/);
  let calls=0;assert.throws(()=>{ctx.reportAssertCompletionPlan(plan);calls++;},/未启动AI.*核对归属/);assert.equal(calls,0);assert.equal(JSON.stringify(raw),snapshot);
});
test('无匹配或同分歧义不猜归属，过期 necessary owner 不使页面渲染抛错',()=>{
  const unknown=fixture({chapters:[{name:'其他',sections:[{t:'说明',content:'待核对'}]}]}).ctx;
  assert.equal(unknown.reportCompletionPlan().factAllocation.status,'blocked');assert.doesNotThrow(()=>unknown.reportCompletionReviewHtml());
  const ambiguous=fixture({chapters:[{name:'甲',sections:[{t:'项目概况',content:'甲'}]},{name:'乙',sections:[{t:'项目概况',content:'乙'}]}],facts:undefined}).ctx;
  assert.equal(ambiguous.reportCompletionFacts().find(f=>f.key==='name').owner,'');
  const expired=fixture({facts:[{key:'risk',label:'约束',value:'经营口径待确认',status:'pending',source:'协议草案',owner:'旧章 / 旧节',required:true}]}).ctx;
  assert.doesNotThrow(()=>expired.reportCompletionReviewHtml());assert.equal(expired.reportCompletionPlan().factAllocation.status,'blocked');assert.throws(()=>expired.reportAssertCompletionPlan(expired.reportCompletionPlan()),/原职责小节不存在/);
});
test('仅显式背景约束可无 owner；非核心人工风险也需要归属或明确背景',()=>{
  const fact={key:'risk',label:'合同风险',value:'以签署后条款为准',status:'pending',source:'协议草案',owner:'',required:false};
  const old=fixture({facts:[fact]}).ctx;assert.equal(old.reportCompletionPlan().factAllocation.status,'blocked');
  const bg=fixture({facts:[{...fact,allocationMode:'background'}]}).ctx,plan=bg.reportCompletionPlan();assert.equal(plan.factAllocation.status,'ready');assert.doesNotThrow(()=>bg.reportAssertCompletionPlan(plan));assert.ok(plan.sections.every(s=>s.requiredFacts.every(f=>!f.required)));assert.match(bg.reportCompletionReviewHtml(),/已明确：仅背景约束/);
  const required=fixture({facts:[{...fact,owner:'项目合作模式 / 合作核心条款',required:false}]}).ctx.reportCompletionPlan();assert.equal(required.sections.flatMap(s=>s.requiredFacts).filter(f=>f.required).length,1);
});
test('同目录内已有归属和冲突原值保留，未自动改为推荐 owner 或 confirmed',()=>{
  const facts=[{key:'operateYears',label:'运营年限',value:'12',status:'pending',source:'旧测算',owner:'项目合作模式 / 合作模式',required:true}],{ctx}=fixture({facts}),snapshot=JSON.stringify(facts),p=JSON.stringify(ctx.calcParams);
  const f=ctx.reportCompletionFacts()[0];assert.equal(f.owner,facts[0].owner);assert.equal(f.value,'12');assert.equal(f.status,'conflict');assert.match(f.source,/当前项目\/测算输入 6/);assert.equal(JSON.stringify(facts),snapshot);assert.equal(JSON.stringify(ctx.calcParams),p);
});
test('人工选择序号或背景保留历史；取消、失配、保存失败不覆盖原台账',async()=>{
  const facts=[{key:'area',label:'面积',value:'5973',status:'pending',source:'输入假设',owner:'',required:false}],{ctx,state}=fixture({facts});
  const setAnswers=last=>{const answers=['面积','5973','原件第1页','pending',last];ctx.prompt=()=>answers.shift();};
  setAnswers('1');await ctx.reportEditCompletionFact(0);assert.equal(ctx.projectWorkflow.reportCompletion.facts[0].owner,'项目总论 / 项目本体情况');assert.equal(ctx.projectWorkflow.reportCompletion.history[0].before[0].owner,'');assert.equal(ctx.calcParams.area,5973);
  setAnswers('仅背景约束');await ctx.reportEditCompletionFact(0);assert.equal(ctx.projectWorkflow.reportCompletion.facts[0].allocationMode,'background');assert.equal(ctx.reportCompletionPlan().factAllocation.status,'ready');
  const before=JSON.stringify(ctx.projectWorkflow);setAnswers('999');await ctx.reportEditCompletionFact(0);assert.equal(JSON.stringify(ctx.projectWorkflow),before);assert.match(state.alerts.at(-1),/未匹配/);
  ctx.persistReportDraft=async()=>({ok:false});setAnswers('1');await ctx.reportEditCompletionFact(0);assert.equal(JSON.stringify(ctx.projectWorkflow),before);assert.match(state.alerts.at(-1),/原台账已保留/);
  ctx.prompt=()=>null;await ctx.reportEditCompletionFact(0);assert.equal(JSON.stringify(ctx.projectWorkflow),before);
});
test('核对权限后身份或计划改变不保存；同 plan 的逻辑缺口标记仍恢复',async()=>{
  const {ctx,state}=fixture();let answers=['风险','待确认','协议','pending',''];ctx.prompt=()=>answers.shift();ctx.ResearchUI={active:()=>true,editable:()=>true,capture:()=>({}),guard:async()=>{ctx.currentProjectId='other';},accepts:()=>false};
  await ctx.reportEditCompletionFact(-1);assert.equal(state.saves,0);assert.equal(ctx.projectWorkflow.reportCompletion,undefined);assert.match(state.alerts[0],/已变化/);
  ctx.ResearchUI=null;const plan=ctx.reportCompletionPlan(),saved=plan.sections[0];saved.requiredMarkers=['【待补：产权证明】'];ctx.chapters[0].sections[0].completionContract=saved;
  assert.deepEqual(Array.from(ctx.reportCompletionPlan().sections[0].requiredMarkers),['【待补：产权证明】']);
});
test('真实浏览器：未归属可见、手工指定后刷新恢复，失败保留及空目录不崩溃',{timeout:60000},async()=>{
  const {chromium}=require('playwright'),browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><main></main>'}));
    async function mount(saved){
      for(const file of ['report-length-plan.js','report-completion-contract.js','report-business-structure.js'])await page.addScriptTag({path:path.resolve(file)});
      await page.evaluate(()=>{window.rlBusinessScenario=()=> 'housing_conversion';window.rlProjectText=()=>project.name;});
      await page.evaluate(({chapters,saved})=>{window.chapters=chapters;window.project={name:'[系统测试]归属'};window.calcParams={area:5973};window.projectWorkflow={reportCompletion:saved||{facts:[{key:'area',label:'面积',value:'5973',status:'pending',source:'输入假设',owner:'',required:false}]}};window.currentProjectId='isolated';window.sectionFormalTemplates=()=>[];window.rlProjectType=()=> 'gaibao';window.renderContent=t=>'<p>'+t+'</p>';window.escapeHtml=t=>String(t).replaceAll('<','&lt;');window.projectCanEdit=()=>true;window.alert=t=>window.lastAlert=t;window.persistReportDraft=async()=>({ok:!window.failSave});},{chapters:outline(),saved});
      await page.addScriptTag({content:ui+'\nwindow.draw=()=>document.querySelector("main").innerHTML=reportCompletionReviewHtml();draw();'});
    }
    await page.goto('http://localhost:8080/[system-test]-fact-owner');await mount();
    for(let i=0;i<4;i++)await page.locator('.report-completion-review > summary').click();assert.match(await page.locator('main').textContent(),/事实职责待分配/);
    await page.evaluate(()=>{window.answers=['面积','5973','原件第1页','pending','1'];window.prompt=()=>answers.shift();});
    await page.locator('.report-completion-review > summary').click();await page.locator('.report-completion-review details > summary').click();await page.getByText('核对/修改',{exact:true}).click();
    const saved=await page.evaluate(()=>projectWorkflow.reportCompletion);assert.equal(saved.facts[0].owner,'项目总论 / 项目本体情况');assert.doesNotMatch(await page.locator('main').textContent(),/事实职责待分配/);
    await page.reload();await mount(saved);assert.match(await page.locator('main').textContent(),/项目总论 \/ 项目本体情况（本节必须保留）/);
    await page.evaluate(async()=>{window.failSave=true;window.answers=['面积','5973','原件第1页','pending','仅背景约束'];window.prompt=()=>answers.shift();await reportEditCompletionFact(0);});assert.match(await page.evaluate(()=>lastAlert),/原台账已保留/);assert.equal(await page.evaluate(()=>projectWorkflow.reportCompletion.facts[0].owner),saved.facts[0].owner);
    await page.evaluate(()=>{chapters=[];draw();});assert.match(await page.locator('main').textContent(),/事实职责待分配/);assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
