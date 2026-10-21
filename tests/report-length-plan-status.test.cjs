const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const L=require('../report-length-plan.js'),C=require('../report-completion-contract.js');
const uiSource=fs.readFileSync(path.join(__dirname,'../report-length-ui.js'),'utf8');

function fixture(options={}){
  const chapters=[{name:'业务分析',checked:true,sections:Array.from({length:43},(_,i)=>({t:'业务主题'+(i+1)}))}],budgets=options.budgets||{};
  const plan={...L.createPlan(chapters),confirmedAt:'2026-10-09T12:00:00.000Z',budgetResolution:{policy:'confirmed-length-plan',legacyBudgetFingerprint:L.legacyBudgetSummary(budgets).fingerprint}};
  const projectWorkflow={reportCompletion:{budgets,lengthPlan:plan}},context={chapters,projectWorkflow,ReportLengthPlan:L,ReportCompletionContract:C};context.window=context;
  vm.createContext(context);vm.runInContext(uiSource,context,{filename:'report-length-ui.js'});
  return {context,chapters,projectWorkflow,plan,ui:context.ReportLengthUI};
}
function entriesAtTotal(plan,total){
  let remaining=total;
  return plan.sections.map((section,index)=>{
    const n=index===plan.sections.length-1?remaining:Math.floor(total*section.target/plan.totalTarget);remaining-=n;
    return {key:section.key,text:'甲'.repeat(n)};
  });
}

test('无确认记录的旧报告仍兼容，不凭新默认目标改成待完成',()=>{
  const f=fixture();delete f.plan.confirmedAt;
  let calls=0;f.context.ReportCompletionContract={reviewLength(){calls++;throw new Error('不应检查旧报告');}};
  const status=f.ui.planStatus();assert.equal(status.status,'unconfirmed');assert.equal(status.valid,false);assert.equal(status.requiresConfirmation,false);
  assert.equal(f.ui.savedPlan(),null);assert.equal(f.ui.reviewDelivery([]),null);assert.equal(calls,0);
  delete f.projectWorkflow.reportCompletion.lengthPlan;
  assert.equal(f.ui.planStatus().status,'unconfirmed');assert.equal(f.ui.planStatus().plan,null);
});

test('有效确认计划复用同一对象，交付检查只委托统一计数接口，不改状态',()=>{
  const f=fixture(),before=JSON.stringify(f.projectWorkflow),entries=entriesAtTotal(f.plan,75000),status=f.ui.planStatus();
  assert.equal(status.status,'confirmed');assert.equal(status.valid,true);assert.equal(status.requiresConfirmation,false);assert.equal(status.plan,f.plan);assert.equal(status.target,75000);assert.equal(status.targetPages,120);assert.equal(status.planId,f.plan.planId);assert.equal(status.reasons.length,0);assert.equal(f.ui.savedPlan(),f.plan);
  let received=null;const expected={applicable:true,status:'within-range'};
  f.context.ReportCompletionContract={reviewLength(...args){received=args;return expected;}};
  assert.equal(f.ui.reviewDelivery(entries),expected);assert.equal(received[0],entries);assert.equal(received[1],f.plan);assert.equal(received[2].status,'confirmed');
  f.context.ReportCompletionContract=C;assert.equal(f.ui.reviewDelivery(entries).status,'within-range');
  assert.equal(JSON.stringify(f.projectWorkflow),before);
});

test('正式逻辑仅补写numeric后仍复用原确认，刷新不回退默认硬字数计划',()=>{
  const f=fixture(),old=f.plan;
  f.plan={...L.createPlan(f.chapters,{planningPriority:'pages'}),confirmedAt:old.confirmedAt,budgetResolution:old.budgetResolution};f.projectWorkflow.reportCompletion.lengthPlan=f.plan;
  const receipt=JSON.stringify(f.projectWorkflow);f.chapters.forEach(c=>c.sections.forEach((s,i)=>{s.numeric=i%2===0;}));
  for(let refresh=0;refresh<2;refresh++){
    const status=f.ui.planStatus(),saved=f.ui.savedPlan();assert.equal(status.status,'confirmed');assert.equal(status.planId,f.plan.planId);assert.equal(status.target,84500);assert.equal(saved,f.context.projectWorkflow.reportCompletion.lengthPlan);
    const current=C.createPlan(f.context.chapters,{lengthPlan:saved,budgets:{}});assert.equal(current.lengthPlanId,f.plan.planId);assert.equal(current.proseTotal,84500);assert.ok(current.sections.every(s=>s.lengthPolicy==='advisory-v1'));
    assert.equal(JSON.stringify(f.context.projectWorkflow),receipt);
    f.context.projectWorkflow=JSON.parse(receipt);f.context.chapters=structuredClone(f.chapters);
  }
});

test('目录变更后保留7.5万字目标，刷新仍为失效确认而非旧报告',()=>{
  const f=fixture();f.chapters[0].sections[0].t='变更后的业务主题';
  const before=JSON.stringify(f.projectWorkflow),status=f.ui.planStatus();
  assert.equal(status.status,'stale-confirmed');assert.equal(status.valid,false);assert.equal(status.requiresConfirmation,true);assert.equal(status.target,75000);assert.equal(status.targetPages,120);assert.equal(status.planId,f.plan.planId);assert.equal(status.plan,f.plan);assert.ok(status.reasons.some(reason=>reason.code==='stale-outline'));assert.match(status.message,/重新确认/);assert.equal(f.ui.savedPlan(),null);
  const q=f.ui.reviewDelivery(entriesAtTotal(f.plan,75000));assert.equal(q.applicable,true);assert.equal(q.status,'stale-plan');assert.equal(q.target,75000);assert.equal(q.actual,75000);assert.equal(q.min,67500);assert.equal(q.max,82500);assert.match(q.message,/尚不能标为完成/);
  assert.equal(JSON.stringify(f.projectWorkflow),before);
  f.context.projectWorkflow=JSON.parse(before);f.context.chapters=JSON.parse(JSON.stringify(f.chapters));
  assert.equal(f.ui.planStatus().status,'stale-confirmed');assert.equal(f.ui.reviewDelivery([]).status,'stale-plan');
});

test('旧人工预算新增、修改、清空均须重新确认，未变化则不误拦',()=>{
  const source={'业务分析 / 业务主题1':{proseTarget:1800,proseMax:2400,reason:'人工目标'}};
  for(const change of ['added','changed','cleared']){
    const f=fixture({budgets:JSON.parse(JSON.stringify(source))});assert.equal(f.ui.planStatus().status,'confirmed');
    if(change==='added')f.projectWorkflow.reportCompletion.budgets['业务分析 / 业务主题2']={proseMax:2000};
    else if(change==='changed')f.projectWorkflow.reportCompletion.budgets['业务分析 / 业务主题1'].proseTarget=1900;
    else f.projectWorkflow.reportCompletion.budgets={};
    const status=f.ui.planStatus();assert.equal(status.status,'stale-confirmed',change);assert.ok(status.reasons.some(reason=>reason.code==='stale-budgets'));assert.equal(f.ui.savedPlan(),null);assert.equal(f.ui.reviewDelivery([]).status,'stale-plan');
  }
  const f=fixture();f.projectWorkflow.reportCompletion.budgets['业务分析 / 业务主题1']={tableCount:2};assert.equal(f.ui.planStatus().status,'confirmed','非正文预算不改变篇幅确认');
});

test('已确认但日期、版本、身份或预算优先级无效，不静默降级兼容',()=>{
  const cases=[
    ['无效日期',f=>{f.plan.confirmedAt='not-a-date';},'invalid-confirmation'],
    ['空日期',f=>{f.plan.confirmedAt='';},'invalid-confirmation'],
    ['非文本日期',f=>{f.plan.confirmedAt=0;},'invalid-confirmation'],
    ['旧版本',f=>{f.plan.version='historical-length-plan';},'plan-version'],
    ['身份被改',f=>{f.plan.planId='length-changed';},'plan-identity'],
    ['未记优先级',f=>{delete f.plan.budgetResolution;},'unconfirmed-budget-policy'],
    ['优先级不明',f=>{f.plan.budgetResolution.policy='legacy';},'unconfirmed-budget-policy'],
    ['未记预算身份',f=>{delete f.plan.budgetResolution.legacyBudgetFingerprint;},'stale-budgets']
  ];
  for(const [label,change,code] of cases){const f=fixture();change(f);const status=f.ui.planStatus();assert.equal(status.status,'stale-confirmed',label);assert.ok(status.reasons.some(reason=>reason.code===code),label);assert.equal(f.ui.savedPlan(),null);assert.equal(f.ui.reviewDelivery([]).status,'stale-plan',label);}
});

test('检查模块不可用不丢失确认目标，检查异常不改原稿',()=>{
  const f=fixture(),before=JSON.stringify(f.projectWorkflow);
  delete f.context.ReportLengthPlan;
  let status=f.ui.planStatus();assert.equal(status.status,'stale-confirmed');assert.equal(status.target,75000);assert.ok(status.reasons.some(reason=>reason.code==='plan-module-unavailable'));
  f.context.ReportLengthPlan={...L,validatePlan(){throw new Error('目录读取失败');}};
  status=f.ui.planStatus();assert.equal(status.status,'stale-confirmed');assert.ok(status.reasons.some(reason=>reason.code==='plan-check-failed'));assert.match(status.message,/目录读取失败/);
  f.context.ReportLengthPlan=L;delete f.context.ReportCompletionContract;
  assert.throws(()=>f.ui.reviewDelivery([]),/篇幅交付检查模块未加载/);assert.equal(JSON.stringify(f.projectWorkflow),before);
});
