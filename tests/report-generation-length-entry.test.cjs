require('../scripts/windows-browser-lockout-guard.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Workflow=require('../project-workflow.js'),Contract=require('../report-completion-contract.js'),Length=require('../report-length-plan.js'),Structure=require('../report-business-structure.js');
const air=fs.readFileSync(require.resolve('../aireport.js'),'utf8'),report=fs.readFileSync(require.resolve('../report.js'),'utf8');
function part(source,start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,start);return source.slice(a,b);}
const code=part(air,'function airReportGenerationStatus(','function airIsIncompleteGenerationMessage(')
  +part(air,'async function aiReportStartGenerate(','/* ================= 阶段⑤')
  +part(air,'async function aiReportRunGenerate(','function airFindChapterSection(')
  +part(air,'function airCaptureReportMutation(','async function airProposeSectionRevision(')
  +part(air,'async function airGenerateImpactedCandidates(','function airSectionMaterialState(')
  +part(report,'function reportFinancialContext(','function reportCandidateInputIdentity(')
  +part(report,'async function reportConfirmGenerationLength(','async function reportBasisMaterialItems(')
  +part(report,'function reportCaptureGenerationContext(','async function updateStaleSections(');
function fixture(options={}){
  const a={t:'运营管理',content:options.empty?'':'原始运营全文'},b={t:'财务评价',content:options.empty?'':'原始财务全文'},chapter={cn:'一',name:'运营方案',checked:true,sections:[a,b]},events=[],alerts=[];
  const state={round:1,research:!!options.research,editable:true,models:[],confirms:0,outlineLoads:0,confirmed:true};
  const context={setTimeout,clearTimeout,chapters:[chapter],project:{},currentProjectId:options.research?null:'[系统测试]项目A',projectWorkflow:Workflow.ensureState({}),ProjectWorkflow:Workflow,
    ReportCompletionContract:Contract,ReportLengthPlan:Length,ReportBusinessStructure:Structure,ReportLogicCore:{load:async()=>{},outline:()=>null,match:()=>[],current:()=>({data:{}})},
    ReportLengthUI:{confirm:async()=>{state.confirms++;events.push('confirm');if(!state.confirmed)return false;const plan=Length.createPlan(context.chapters,{targetPages:12,proseTotal:2600});plan.confirmedAt='2026-10-08';plan.budgetResolution={policy:'confirmed-length-plan',legacyBudgetFingerprint:Length.legacyBudgetSummary(context.projectWorkflow.reportCompletion?.budgets).fingerprint};context.projectWorkflow.reportCompletion={...(context.projectWorkflow.reportCompletion||{}),lengthPlan:plan};return true;},savedPlan:()=>context.projectWorkflow.reportCompletion?.lengthPlan||null},
    ResearchUI:{active:()=>state.research,capture:()=>({round:state.round}),accepts:token=>state.research&&token.round===state.round,editable:()=>state.editable,guard:async()=>{},flush:async()=>events.push('flush')},
    projectCanEdit:()=>state.editable,getUser:()=> '[系统测试]',AI_DOMAIN_OF:{gaibao:'baozhang_gaibao'},AI_GAIBAO_SCENARIO_CN:{housing:'非居改保'},AI_TYPE_CN:{gaibao:'非居改保'},
    aiReportExtracted:{projectName:'[系统测试]入口核验'},aiReportSuggested:{calcType:'gaibao'},rptCtype:'',calcParams:{},calcResult:{summary:{}},aiReportCalculationMode:'full',appMode:'aireport',
    aiReportBusy:false,aiReportParamsConfirmed:true,aiReportGenerationLockId:null,aiReportStopFlag:false,aiReportChat:[],aiReportPendingTasks:null,aiReportProgressMsg:null,aiReportImpactedProgress:null,airAcceptCandidatesBusy:false,
    fetchOutlines:async()=>events.push('outline'),airBusinessScenario:()=> 'housing',reportLoadDomainSource:(key,outline)=>{state.outlineLoads++;context.chapters=outline;},loadDomain:()=>{state.outlineLoads++;},
    reportHasVisibleBody:s=>!!String(s.editedHtml||s.content||'').replace(/<[^>]*>/g,'').trim(),reportCheckGeneratedDraft:()=>{},reportCompletionFacts:()=>[],reportCompletionEntries:()=>[],rlProjectType:()=> 'gaibao',rlProjectText:()=>'',rlBusinessScenario:()=> 'housing',
    airBuildDocPane:()=>{},airUpdateChapterChipStatus:()=>{},document:{getElementById:()=>null,querySelector:()=>null},airPush:message=>context.aiReportChat.push(message),renderAiReportMsgs:()=>{},airRepairFlowCards:()=>{},airIsIncompleteGenerationMessage:m=>m.kind==='generationIncomplete',
    saveDraft:()=>events.push('save'),airSaveLocalState:()=>{},airSaveState:async()=>{},flushCloudSave:async()=>{},currentReportVersionMeta:reason=>({reason}),airSetBusy:busy=>context.aiReportBusy=busy,
    airGenerationFlowLocked:()=>false,airOpenExistingReport:()=>events.push('open-existing'),reportGenerationConcurrency:()=>4,runReportGenerationPool:async(tasks,worker,concurrency,allowed)=>{for(const task of tasks){if(allowed&&!allowed())break;await worker(task);}},runWorkerPool:async(tasks,worker)=>{for(const task of tasks)await worker(task);},
    airCandidateImpactRows:()=>context.chapters.flatMap(c=>c.sections.map((s,si)=>({c,s,si}))),airReportLogicImpactSummary:()=>({locked:0}),reportLogicRevision:()=>({}),airRefreshSection:()=>{},confirm:()=>true,alert:message=>alerts.push(message),escapeHtml:s=>String(s),
    generateSection:async(c,s,onChunk,options)=>{state.models.push({chapter:c.name,title:s.t,plan:context.reportCompletionPlan(),options});return '完整初稿：'+s.t;},reviseSection:async(c,s)=>'后续候选：'+s.t};
  context.window=context;vm.createContext(context);vm.runInContext(code,context);return {context,state,a,b,chapter,events,alerts};
}
async function runWithGenerationLock(f,options={}){
  const context=f.context,claim=Workflow.claimReportGeneration(context.projectWorkflow,context.chapters,{force:!!options.force});
  assert.equal(claim.ok,true,claim.reason);context.aiReportGenerationLockId=claim.lock.id;
  try{return await context.aiReportRunGenerate(options);}
  finally{
    const status=context.aiReportStopFlag?'paused':(context.airReportGenerationStatus().complete?'completed':'incomplete');
    Workflow.releaseReportGeneration(context.projectWorkflow,context.aiReportGenerationLockId,status);
    context.aiReportGenerationLockId=null;
  }
}
test('生成入口不再用借款或建设投资覆盖登记估算，已有正文保持不变',async()=>{
  for(const scale of ['5240','',undefined]){
    const f=fixture();if(scale!==undefined)f.context.project.scale=scale;
    f.context.calcParams={totalInvestment:123,invest:456,loan:13892};
    f.b.content='';const before=f.a.content;
    await runWithGenerationLock(f);
    assert.equal(f.context.project.scale,scale);assert.equal(Object.hasOwn(f.context.project,'scale'),scale!==undefined);
    assert.equal(f.a.content,before);assert.equal(f.state.models.length,1);
  }
});
test('首次生成取消篇幅确认：零模型调用，原正文和历史版本完全保留',async()=>{
  const f=fixture();f.state.confirmed=false;const before=JSON.stringify(f.context.chapters);f.context.projectWorkflow.reportVersions=[{id:'[系统测试]V9',chapters:Workflow.clone(f.context.chapters)}];const history=JSON.stringify(f.context.projectWorkflow.reportVersions);
  assert.equal(await runWithGenerationLock(f,{force:true}),false);assert.equal(f.state.models.length,0);assert.equal(JSON.stringify(f.context.chapters),before);assert.equal(JSON.stringify(f.context.projectWorkflow.reportVersions),history);assert.equal(f.events.includes('save'),false);
});

test('完整首次生成显式启用有限格式恢复，单节手动操作不暗中加付费修复',async()=>{
  const f=fixture({empty:true});await runWithGenerationLock(f);
  assert.equal(f.state.models.length,2);assert.ok(f.state.models.every(call=>call.options.autoRepair===true));
  const manual=fixture({empty:true});await manual.context.airDriveSectionGen(manual.chapter,manual.a,0,{});
  assert.equal(manual.state.models[0].options.autoRepair,false);
});
test('确认自定义篇幅后才备份并清稿，真实 completionPlan 采用确认分配，锁定正文不动',async()=>{
  const f=fixture();f.b.locked=true;const before=JSON.stringify(f.context.chapters);await runWithGenerationLock(f,{force:true});
  assert.equal(f.state.confirms,1);assert.equal(f.state.models.length,1,JSON.stringify(f.context.aiReportProgressMsg?.failures));assert.equal(f.a.content,'完整初稿：运营管理');assert.equal(f.a.pendingRevision,undefined);assert.equal(f.b.content,'原始财务全文');
  const backup=f.context.projectWorkflow.reportVersions[0].chapters[0].sections;assert.equal(backup[0].content,'原始运营全文');assert.equal(backup[1].content,'原始财务全文');assert.equal(backup[1].locked,true);assert.equal(f.state.models[0].plan.proseTotal,2600);assert.equal(f.state.models[0].plan.sections.reduce((n,s)=>n+s.requirements.proseTarget,0),2600);assert.ok(f.events.indexOf('confirm')<f.events.indexOf('save'));
});
test('目录初始化可更换 chapters 引用，不误判切项目；真正项目/研究切换拒绝生成',async()=>{
  const initialized=fixture({empty:true});initialized.context.ReportLogicCore.outline=()=>[{cn:'一',name:'运营方案',checked:true,sections:[{t:'运营管理',content:''},{t:'财务评价',content:''}]}];await runWithGenerationLock(initialized);assert.equal(initialized.state.outlineLoads,1);assert.equal(initialized.state.models.length,2);
  for(const research of [false,true]){const f=fixture({research});f.context.ReportLengthUI.confirm=async()=>{if(research)f.state.round++;else f.context.currentProjectId='[系统测试]项目B';return true;};await assert.rejects(runWithGenerationLock(f,{force:true}),/已切换/);assert.equal(f.state.models.length,0);assert.equal(f.a.content,'原始运营全文');assert.equal(f.context.projectWorkflow.reportVersions.length,0);}
});
test('无正式项目 ID 的私人研究可生成；只读研究和已有候选均不清稿',async()=>{
  const privateRun=fixture({research:true});await runWithGenerationLock(privateRun,{force:true});assert.equal(privateRun.state.models.length,2);
  const readonly=fixture({research:true});readonly.state.editable=false;await assert.rejects(runWithGenerationLock(readonly,{force:true}),/不可编辑/);assert.equal(readonly.state.models.length,0);
  for(const empty of [false,true]){const f=fixture({empty});f.a.pendingRevision={after:'已有候选'};const before=JSON.stringify(f.context.chapters);await assert.rejects(runWithGenerationLock(f,{force:true}),/候选/);assert.equal(JSON.stringify(f.context.chapters),before);assert.equal(f.state.models.length,0);}
});
test('生成按钮重复点击只启动一次；取消后释放生成锁可重开',async()=>{
  const f=fixture({empty:true});let release;f.context.ReportLengthUI.confirm=()=>new Promise(resolve=>release=resolve);const work=f.context.aiReportStartGenerate();while(!release)await new Promise(resolve=>setTimeout(resolve,1));await f.context.aiReportStartGenerate();assert.equal(f.context.aiReportBusy,true);release(false);await work;assert.equal(f.context.aiReportBusy,false);assert.equal(f.state.models.length,0);assert.equal(f.context.aiReportGenerationLockId,null);release=null;const reopened=f.context.aiReportStartGenerate();while(!release)await new Promise(resolve=>setTimeout(resolve,1));release(false);await reopened;assert.equal(f.context.aiReportBusy,false);
});
test('后续交互只生成候选；单节失败批次保留具体原因，不覆盖原稿或阻断成功节',async()=>{
  const f=fixture();f.context.reviseSection=async(c,s)=>{if(s===f.a){const e=Error('[系统测试]余额不足');e.code='provider-credit';throw e;}return '后续候选';};await f.context.airGenerateImpactedCandidates(true);
  assert.equal(f.a.content,'原始运营全文');assert.equal(f.b.content,'原始财务全文');assert.equal(f.b.pendingRevision.after,'后续候选');assert.equal(f.context.aiReportImpactedProgress.failed,1);assert.equal(f.context.aiReportImpactedProgress.failures[0].code,'provider-credit');assert.equal(f.context.aiReportImpactedProgress.failures[0].sectionKey,'运营方案 / 运营管理');assert.match(f.alerts.at(-1),/余额不足/);
});
test('模型返回后再校验身份、锁定和人工新正文，迟到初稿不得覆盖',async()=>{
  for(const change of ['project','round','locked','body','candidate']){const f=fixture({empty:true,research:change==='round'});f.context.generateSection=async()=>{if(change==='project')f.context.currentProjectId='[系统测试]项目B';if(change==='round')f.state.round++;if(change==='locked')f.a.locked=true;if(change==='body')f.a.content='人工刚输入';if(change==='candidate')f.a.pendingRevision={after:'人工候选'};return '迟到初稿';};const accepted=await f.context.airDriveSectionGen(f.chapter,f.a,0,{});assert.equal(accepted,false,change);assert.notEqual(f.a.content,'迟到初稿',change);if(change==='body')assert.equal(f.a.content,'人工刚输入');if(change==='candidate')assert.equal(f.a.pendingRevision.after,'人工候选');}
});
test('首次失败原因同时落到小节和批次，成功重试只清该节失败记录',async()=>{
  const f=fixture({empty:true});f.context.generateSection=async(c,s)=>{if(s===f.a){const error=Error('[系统测试]模型额度耗尽');error.code='provider-credit';throw error;}return '成功正文';};await runWithGenerationLock(f);
  assert.equal(f.a.content,'');assert.equal(f.a.generationFailure.code,'provider-credit');assert.equal(f.context.aiReportProgressMsg.failures[0].sectionKey,'运营方案 / 运营管理');assert.match(f.context.aiReportProgressMsg.failures[0].message,/额度耗尽/);assert.equal(f.b.content,'成功正文');
  f.context.generateSection=async()=> '重试成功';assert.equal(await f.context.airDriveSectionGen(f.chapter,f.a,0,{}),true);assert.equal(f.a.generationFailure,undefined);assert.equal(f.a.content,'重试成功');
});
test('独立财务报告入口也在篇幅确认后检查项目/研究，纯 report.js fallback 不放过切换',async()=>{
  for(const fallback of [false,true])for(const research of [false,true]){const f=fixture({empty:true,research});if(fallback){delete f.context.airCaptureReportMutation;delete f.context.airCheckReportMutation;delete f.context.airGuardReportMutation;}f.context.ReportLengthUI.confirm=async()=>{if(research)f.state.round++;else f.context.currentProjectId='[系统测试]项目B';return true;};await assert.rejects(f.context.runGeneration(),/已切换/);assert.equal(f.state.models.length,0);assert.equal(f.a.content,'');}
  const cancel=fixture({empty:true});cancel.state.confirmed=false;await cancel.context.runGeneration();assert.equal(cancel.state.models.length,0);assert.equal(cancel.events.includes('save'),false);
});
