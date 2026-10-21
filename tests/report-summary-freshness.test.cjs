const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../report-completion-contract.js'),A=require('../report-argument.js'),MD=require('../md.js'),L=require('../report-length-plan.js');
const source=fs.readFileSync(require.resolve('../report.js'),'utf8');
const code=source.slice(source.indexOf('function reportCompletionFacts('),source.indexOf('async function reportConfirmGenerationLength('))+'\n'+source.slice(source.indexOf('function reportFinancialContext('),source.indexOf('function reportCompletionEntries('))+'\n'+source.slice(source.indexOf('function reportSummarySourceSnapshot('),source.indexOf('async function callGen('));
const table='<table><tr><th>事项</th><th>边界</th></tr><tr><td>经营口径</td><td>尚待确认</td></tr></table>';
const copy=value=>structuredClone(value);

// Actual summaryContext, generation preparation, immutable binding and durable
// admission run together. Only source adapters and model transport are isolated.
function fixture(pauseAt='',{research=true,detail=false,legacy=false,confirmed=false}={}){
  const chapters=[{name:'经营方案',checked:true,cn:'一',sections:[{t:'经营口径',content:'项目事实：经营期限六年。尚须核实协议条件。'},{t:'运营边界',content:'运营方案已列示，消防手续未完成前不得运营。'}]},
    {name:'总论',checked:true,cn:'二',sections:[{t:'研究结论',numeric:true,content:'原总结，不得自动替换。\n\n'+table}]}];
  if(confirmed)chapters[1].sections.push({t:'主要建议',content:'原建议，尚须核实协议。'});
  const lengthPlan=confirmed?{...L.createPlan(chapters,{proseTotal:6000}),confirmedAt:'2026-10-12T12:00:00Z',budgetResolution:{policy:'confirmed-length-plan',legacyBudgetFingerprint:L.legacyBudgetSummary({}).fingerprint}}:undefined;
  const plan=C.createPlan(chapters,{projectType:'gaibao',lengthPlan});
  for(const chapter of chapters)for(const section of chapter.sections)section.completionContract=copy(plan.sections.find(c=>c.sectionKey===chapter.name+' / '+section.t));
  let signal,release,paused=false,saves=0;
  const reached=new Promise(resolve=>signal=resolve),gate=new Promise(resolve=>release=resolve),visited=[],requests=[],chunks=[],retained=[];
  async function boundary(name){visited.push(name);if(name===pauseAt&&!paused){paused=true;signal();await gate;}}
  const c=detail?chapters[0]:chapters[1],s=c.sections[0];
  const ctx={chapters,currentProjectId:research?null:'[系统测试]summary-project',project:{name:'[系统测试]summary'},projectWorkflow:{},calcParams:{},calcResult:null,MD,ReportArgument:A,
    provStart:()=>({projectFields:[]}),provConfidence:()=> 'unverified',rlProjectType:()=> 'gaibao',rlBusinessScenario:()=> 'housing_conversion',rlProjectText:()=> '',
    ensureReportTableTemplates:()=>boundary('templates'),sectionFormalTemplates:()=>[],reportSiteWritingPlan:()=>null,buildCalcDigest:()=>null,renderContent:text=>MD.renderHtml(text),
    excelSourceRetrieve:()=>'',mappedExcelSourceRetrieve:async()=>{await boundary('excel');return '';},reportSectionLogicSnapshot:()=>({}),
    surveyBrief:()=>'',rlRetrieve:()=>'',reportLocalLogicPrompt:()=>'',stdRetrieve:()=>'',exampleRetrieve:()=>'',kbRetrieve:()=>'',webEvidenceRetrieve:()=>'',
    ragRetrieve:async()=>{await boundary('rag');return '';},reportBodyContainsInternalLogic:()=>false,saveDraft:()=>saves++,reportAssertCompletionPlan:p=>p,
    reportCompletionPlan:()=>{
      const current=copy(plan);
      // Same late-bound metadata as the production plan; binding the target
      // summary must not invalidate the detail-input snapshot itself.
      for(const contract of current.sections){const saved=chapters.flatMap(x=>x.sections).find(x=>x.completionContract?.sectionKey===contract.sectionKey)?.completionContract;
        for(const key of ['requiredMarkers','frozenTables','documentReferences','basisCatalog'])if(saved?.[key])contract[key]=copy(saved[key]);}
      return current;
    },
    reportCompletionEntries:()=>chapters.flatMap((c,ci)=>c.sections.map((s,si)=>({key:c.name+' / '+s.t,number:(ci+1)+'.'+(si+1),text:MD.renderHtml(s.editedHtml||s.content||'')}))),
    ReportLogicCore:{load:()=>boundary('logic'),match:()=>[],current:()=>({version:1})}
  };
  ctx.window=ctx;
  ctx.ReportCompletionContract=legacy?null:{...C,
    async bindDocumentReferences(...args){const result=await C.bindDocumentReferences(...args);await boundary('references');return result;},
    async bindFrozenTables(...args){const result=await C.bindFrozenTables(...args);await boundary('frozen');return result;}
  };
  ctx.ResearchUI=research?{active:()=>true,flush:()=>boundary('flush'),capture:()=>({researchId:'[系统测试]research',runId:'[系统测试]run'}),accepts:()=>true,guard:()=>boundary('permission')}:null;
  ctx.ReportOrchestrationClient={generateSection:async(args,onTask)=>{
    requests.push(args);onTask({id:'[系统测试]task',runId:'[系统测试]task-run',status:'queued'});await boundary('provider');
    const paragraphs=(args.qualityContract?.requiredHeadings||[]).flatMap(h=>[{kind:'heading',slot:'finding',level:h.level,text:h.text},{kind:'paragraph',slot:'finding',text:'现有结论仍受协议条件限制。协议尚未完成签署，不能把预计运营收入作为已经确定的回款。应在履约安排和消防条件确认后重新核算现金流，若原方案条件不成立，须调整实施时序并报审，不能直接据当前假设承诺投入。'}]);
    const decoded=args.qualityContract?C.decodeStructured(JSON.stringify({blocks:[...(paragraphs.length?paragraphs:[{kind:'paragraph',slot:'finding',text:'现有结论仍受协议条件限制。'}]),...(args.qualityContract.frozenTables?.tables||[]).map(t=>({kind:'table-ref',id:t.id}))]}),args.qualityContract):{text:'现有结论仍受协议条件限制。'};
    const result={id:'[系统测试]task',runId:'[系统测试]task-run',status:'completed',text:decoded.text,...(args.qualityContract?{quality:C.inspect(decoded.text,args.qualityContract),outputFormat:C.OUTPUT_FORMAT}:{})};
    retained.push(result);onTask(result);return result;
  }};
  vm.createContext(ctx);
  for(const file of ['project-workflow.js','report-financial-tables.js'])vm.runInContext(fs.readFileSync(require.resolve('../'+file),'utf8'),ctx);
  // This VM fixture tests summary-input freshness, not financial DOM parsing.
  // Keep the actual signature/bind/assert implementation; isolate only the DOM
  // scanner for its sole known nonfinancial table. Unknown tables fail closed.
  // Real financial DOM, TABLE Markdown and protection wrappers are exercised in
  // report-financial-generation.test.cjs and report-financial-tables.test.cjs.
  ctx.ReportFinancialTables={...ctx.ReportFinancialTables,hasFinancialTables(html){
    if(!/<table\b/i.test(String(html||'')))return false;
    assert.doesNotMatch(html,/data-report-calc-kind|data-template-id|data-canonical-template/i,'summary fixture received an unexpected classified table');
    const measured=C.measure(html);assert.equal(measured.malformedTables,0);assert.equal(measured.tableCount,1,'summary fixture only supports its one nonfinancial table');
    assert.deepEqual(measured.tables,[[['事项','边界'],['经营口径','尚待确认']]],'unexpected table must not silently bypass financial admission');return false;
  }};
  vm.runInContext(code,ctx);
  return {ctx,c,s,chapters,plan,reached,release:()=>release(),visited,requests,chunks,retained,saves:()=>saves,
    run:()=>ctx.generateSection(c,s,text=>chunks.push(text))};
}
const changes={
  content:f=>{f.chapters[0].sections[0].content+=' 尚未确认新的必要条件。';},
  editedHtml:f=>{f.chapters[0].sections[0].editedHtml='<p>改用当前人工编辑稿：尚未完成消防核验。</p>';},
  checked:f=>{f.chapters[0].checked=false;},
  key:f=>{f.chapters[0].sections[0].t='新的经营口径';},
  stale:f=>{f.chapters[0].sections[0].syncStatus='stale';},
  contract:f=>{f.chapters[0].sections[0].completionContract.requirements.proseMax++;},
  fact:f=>{f.chapters[0].sections[0].completionContract.requiredFacts.push({key:'term',value:'6年',required:true});},
  marker:f=>{f.chapters[0].sections[0].completionContract.requiredMarkers=['【待补：核验消防】'];},
  plan:f=>{f.plan.sections[0].responsibility+=' 必须补充核验。';},
  document:f=>{f.chapters.push({name:'补充明细',checked:true,sections:[{t:'新增条件',content:'尚待核实的新事项'}]});}
};
async function rejectedAt(boundary,mutation='content',options){
  const f=fixture(boundary,options),before=f.s.content,pending=f.run();
  await f.reached;changes[mutation](f);f.release();
  await assert.rejects(pending,error=>error.code==='REPORT_SUMMARY_SOURCE_CHANGED');
  assert.equal(f.s.content,before);assert.equal(f.s.pendingRevision,undefined);assert.equal(f.s.prov,undefined);assert.deepEqual(f.chunks,[]);
  if(['provider','permission'].includes(boundary)){
    assert.equal(f.requests.length,1);assert.equal(f.retained.length,1);assert.equal(f.s.executionTask.id,'[系统测试]task');
  }else assert.equal(f.requests.length,0);
  return f;
}

test('总结多个真实 await 边界均检查其他明细正文，不靠目标小节或 planId 变化',async t=>{
  for(const boundary of ['excel','rag','flush','references','frozen','provider','permission'])await t.test(boundary,()=>rejectedAt(boundary));
});

test('逻辑和表格准备完成后才读取当前明细作为总结来源',async t=>{
  for(const boundary of ['logic','templates'])await t.test(boundary,async()=>{
    const f=fixture(boundary),before=f.s.content,pending=f.run();await f.reached;
    f.chapters[0].sections[0].content+=' 准备期间补充的真实条件。';f.release();await pending;
    assert.equal(f.s.content,before);assert.equal(f.requests.length,1);assert.match(f.requests[0].user,/准备期间补充的真实条件/);
  });
});

test('正文/目录/约束来源各自变更可独立阻断，固定 planId 不能掩盖',async t=>{
  for(const mutation of Object.keys(changes))await t.test(mutation,()=>rejectedAt('provider',mutation));
});

test('正式项目与旧稿兼容路径同样检查总结来源',async t=>{
  await t.test('formal',()=>rejectedAt('provider','content',{research:false}));
  await t.test('legacy',()=>rejectedAt('provider','content',{legacy:true}));
});

test('明细候选/任务/旧quality变化不污染当前已接受正文来源，正常总结可返回',async()=>{
  const f=fixture('provider'),before=f.s.content,pending=f.run();await f.reached;
  const section=f.chapters[0].sections[0];section.pendingRevision={after:'候选不得作为依据'};section.executionTask={id:'another',text:'任务未接受'};section.completionQuality={status:'passed',factsVerified:true};
  f.release();const text=await pending;
  assert.match(text,/现有结论仍受协议条件限制/);assert.equal(f.s.content,before);assert.equal(f.requests.length,1);assert.equal(f.chunks.length,1);
  assert.doesNotMatch(f.requests[0].user,/候选不得作为依据|任务未接受/);assert.ok(f.visited.includes('permission'));
});

test('当前 editedHtml 未变时修改未消费的 content 不误阻断，合同对象键顺序无关',async()=>{
  const f=fixture('provider');f.chapters[0].sections[0].editedHtml='<p>当前已接受编辑正文，协议条件仍待核实。</p>';
  const pending=f.run();await f.reached;const section=f.chapters[0].sections[0];section.content='旧源文本被后台整理';
  section.completionContract=Object.fromEntries(Object.entries(section.completionContract).reverse());
  f.release();await pending;assert.equal(f.chunks.length,1);assert.match(f.requests[0].user,/当前已接受编辑正文/);assert.doesNotMatch(f.requests[0].user,/旧源文本被后台整理/);
});

test('普通明细生成不创建或检查全篇来源快照，不因相邻小节改动中断',async()=>{
  const f=fixture('provider',{detail:true});let snapshots=0;f.ctx.reportSummarySourceSnapshot=()=>{snapshots++;throw new Error('普通明细不应扫描');};
  const pending=f.run();await f.reached;f.chapters[0].sections[1].content+=' 更新其他明细';f.release();await pending;
  assert.equal(snapshots,0);assert.equal(f.requests.length,1);assert.equal(f.chunks.length,1);
});

test('源输入相同正常生成通过全部阶段，冻结目标总结表不造成自我失效',async()=>{
  const f=fixture(),before=copy(f.s.completionContract);const result=await f.run();assert.match(result,/经营口径/);assert.equal(f.chunks.length,1);assert.equal(f.requests.length,1);
  const receipt=f.ctx.ProjectWorkflow.generatedContract(f.s,result),quality=C.inspect(result,receipt);
  assert.ok(receipt.frozenTables);assert.notEqual(quality.status,'blocked');assert.equal(quality.factsVerified,false);
  assert.deepEqual(f.s.completionContract,before);assert.equal(f.s.completionQuality,undefined);
  assert.equal(f.requests[0].qualityContract.planId,f.plan.planId);
});

function acceptSiblingSummary(f){
  const sibling=f.chapters[1].sections[1];
  sibling.content='<h3>实施前提</h3><p>只有协议、消防及运营条件核实后才能实施。</p>';
  f.plan.planId+='-sibling-output';
  for(const contract of f.plan.sections)contract.planId=f.plan.planId;
  f.plan.sections.find(c=>c.sectionKey==='总论 / 主要建议').requiredHeadings=[{level:3,text:'实施前提'}];
}

test('同批兄弟总结写回只改变全篇计划号，不中断在途总结或随后排队的总结',async()=>{
  const f=fixture('provider',{confirmed:true}),firstPlan=f.plan.planId;
  assert.equal(f.plan.lengthPlan.lengthScope,'full-report');
  const pending=f.run();await f.reached;acceptSiblingSummary(f);f.release();await pending;
  assert.equal(f.requests.length,1);assert.equal(f.chunks.length,1);
  const cache=f.ctx.reportPrepareSummaryContext.current;
  assert.equal(cache.plan.planId,firstPlan,'已验证的来源计划必须独立冻结，不能跟随当前计划对象变化');
  await f.ctx.generateSection(f.chapters[1],f.chapters[1].sections[1]);
  assert.equal(f.requests.length,2);
  assert.match(f.requests[1].user,/合同就绪正文的全量论证上下文/);
  assert.ok(f.requests[1].user.includes('计划 '+firstPlan));
  assert.equal(f.requests[1].qualityContract.planId,f.plan.planId,'目标小节仍采用当前成稿约束，不沿用旧生成合同');
  assert.doesNotMatch(f.requests[1].user,/只有协议、消防及运营条件核实后才能实施/,'兄弟总结不能倒灌成明细来源');
});

test('首次总结仍拒绝混合明细计划，不能靠缓存入口洗成有效凭证',async()=>{
  const f=fixture('',{confirmed:true});f.chapters[0].sections[0].completionContract.planId='old-mixed-plan';
  await assert.rejects(f.run(),e=>e.code==='REPORT_SUMMARY_CONTRACT_MISMATCH');
  assert.equal(f.requests.length,0);assert.equal(f.ctx.reportPrepareSummaryContext.current,undefined);
});

test('兄弟总结写回不能掩盖真实来源变化，缓存不跨项目或工作稿复用',async t=>{
  const mutations={
    detail:f=>changes.content(f),detailContract:f=>changes.contract(f),detailAllocation:f=>f.plan.sections[0].requirements.proseTarget++,
    length:f=>f.plan.lengthPlan.targetPages++,template:f=>f.ctx.sectionFormalTemplates=()=>[{id:'changed-template',segments:[]}],
    finance:f=>f.ctx.calcParams.area=99,material:f=>f.ctx.kbEntries=[{title:'新材料',content:'合同条件发生变化'}],
    project:f=>f.ctx.currentProjectId='[系统测试]other-project',research:f=>f.ctx.ResearchUI.capture=()=>({researchId:'other-research',runId:'other-run'}),
    workflow:f=>f.ctx.projectWorkflow={},directory:f=>f.chapters[1].sections[1].t='不同建议'
  };
  for(const [name,change] of Object.entries(mutations))await t.test(name,async()=>{
    const f=fixture('',{confirmed:true});await f.run();acceptSiblingSummary(f);change(f);
    const before=f.requests.length;
    await assert.rejects(f.ctx.generateSection(f.chapters[1],f.chapters[1].sections[1]),e=>e.code==='REPORT_SUMMARY_CONTRACT_MISMATCH'||e.code==='REPORT_SUMMARY_CONTRACT_BLOCKED');
    assert.equal(f.requests.length,before,'真实来源变更不得继续复用已验证旧计划');
  });
});

test('在途总结也核对真实模板、财务输入和明细分配，不能只看正文',async t=>{
  for(const [name,change] of Object.entries({template:f=>f.ctx.sectionFormalTemplates=()=>[{id:'new-template'}],finance:f=>f.ctx.calcParams.rent=88,allocation:f=>f.plan.sections[0].requirements.proseTarget++}))await t.test(name,async()=>{
    const f=fixture('provider',{confirmed:true}),pending=f.run();await f.reached;acceptSiblingSummary(f);change(f);f.release();
    await assert.rejects(pending,e=>e.code==='REPORT_SUMMARY_SOURCE_CHANGED');assert.equal(f.s.content,'原总结，不得自动替换。\n\n'+table);assert.equal(f.s.pendingRevision,undefined);assert.equal(f.retained.length,1);
  });
});
