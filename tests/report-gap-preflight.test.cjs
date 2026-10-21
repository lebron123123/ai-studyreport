const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../report.js'),'utf8');
const code=source.slice(source.indexOf('async function reviseSection('),source.indexOf('async function callGen('));
function fixture({research=false,receipts=true}={}){
  const c={cn:'一',name:'市场分析',sections:[]},s={t:'需求分析',content:'原稿保留',numeric:false};c.sections.push(s);
  const events=[],requests=[],chunks=[],hooks={},project={name:'[系统测试]前置核验',source:1},workflow={reportGapRegistry:{records:[{id:'g1',status:'not-applicable'}]},reportGapReceipts:receipts?{g1:{signature:'signed-original'}}:{}};
  let verified=false,runId='run-1',researchActive=research;
  const ctx={chapters:[c],project,projectWorkflow:workflow,currentProjectId:research?null:'p1',currentProjectUpdatedAt:10,calcParams:{},calcResult:null,kbEntries:[],
    ReportArgument:{summaryContext:()=>'',prompt:()=>''},ReportCompletionContract:null,
    ReportGapWorkflow:{sourceRevision:context=>JSON.stringify({key:context.projectKey,source:context.source})},
    reportGapContext:()=>({projectKey:researchActive?'research-1:'+runId:String(ctx.currentProjectId),source:ctx.project.source}),
    persistReportDraft:async()=>{events.push('save');await hooks.save?.();ctx.currentProjectUpdatedAt++;return hooks.receipt||{ok:true,remote:true};},
    ReportGapUI:{ensureVerified:async opts=>{events.push('verify');assert.equal(opts.force,true);assert.ok(ctx.currentProjectUpdatedAt>10);await hooks.verify?.();verified=true;return {verified:true};}},
    ReportLogicCore:{load:async()=>{events.push('logic');await hooks.logic?.();},match:()=>[],current:()=>({version:1})},
    rlProjectType:()=> 'gaibao',rlBusinessScenario:()=> 'housing_conversion',rlProjectText:()=>'',
    rlRetrieve:()=>{events.push('prompt');if(receipts)assert.ok(verified,'prompt cannot precede server verification');return '';},
    reportLocalLogicPrompt:()=>'',kbRetrieve:()=>'',blocksToSource:x=>x,buildCalcDigest:()=>null,
    provStart:()=>({projectFields:[]}),provConfidence:()=> 'unverified',ensureReportTableTemplates:async()=>{events.push('templates');await hooks.templates?.();},
    sectionFormalTemplates:()=>[],reportSiteWritingPlan:()=>null,excelSourceRetrieve:()=>'',mappedExcelSourceRetrieve:async()=>'',surveyBrief:()=>'',reportSectionLogicSnapshot:()=>({}),
    stdRetrieve:()=>'',exampleRetrieve:()=>'',webEvidenceRetrieve:()=>'',ragRetrieve:async()=>{await hooks.rag?.();return '';},reportBodyContainsInternalLogic:()=>false,
    saveDraft:()=>events.push('draft'),reportAssertCompletionPlan:p=>p,
    ReportOrchestrationClient:{generateSection:async(args,onTask)=>{events.push('request');requests.push(args);onTask({id:'task-1',runId:'job-1',status:'completed'});await hooks.provider?.();return {text:'核验后的候选正文',rulesChanged:!!hooks.rulesChanged};}}
  };
  ctx.window=ctx;
  ctx.ResearchUI={active:()=>researchActive,capture:()=>({researchId:'research-1',runId,expectedVersion:ctx.currentProjectUpdatedAt}),accepts:token=>researchActive&&token.runId===runId,
    flush:async()=>{events.push('flush');await hooks.flush?.();},guard:async token=>{events.push('guard');if(!ctx.ResearchUI.accepts(token))throw Error('研究已切换');}};
  vm.createContext(ctx);vm.runInContext(code,ctx);
  return {ctx,c,s,events,requests,chunks,hooks,setRun:id=>runId=id,setResearch:on=>researchActive=on,
    prepare:prepared=>ctx.reportPrepareGapVerification(c,s,prepared),
    run:(name='generateSection')=>name==='reviseSection'?ctx.reviseSection(c,s,'精简文字',v=>chunks.push(v)):name==='reviseSectionExcerpt'?ctx.reviseSectionExcerpt(c,s,'原片段','精简文字',v=>chunks.push(v)):ctx.generateSection(c,s,v=>chunks.push(v))};
}

test('真实生成和两种改写入口：先远端保存、核实再构造提示，每次仅核实一次',async t=>{
  for(const name of ['generateSection','reviseSection','reviseSectionExcerpt'])await t.test(name,async()=>{
    const f=fixture();assert.equal(await f.run(name),'核验后的候选正文');
    assert.ok(f.events.indexOf('save')<f.events.indexOf('verify'));
    assert.ok(f.events.indexOf('verify')<f.events.indexOf('prompt'));
    assert.equal(f.events.filter(x=>x==='save').length,1);assert.equal(f.events.filter(x=>x==='verify').length,1);
    assert.equal(f.requests.length,1);assert.equal(f.s.content,'原稿保留');assert.deepEqual(f.chunks,['核验后的候选正文']);
  });
});

test('保存失败/仅本机成功/核实失败均停止，不能发模型请求或写正文',async t=>{
  for(const kind of ['failed','local-only','verify-failed'])await t.test(kind,async()=>{
    const f=fixture();if(kind==='failed')f.hooks.receipt={ok:false,remote:false};else if(kind==='local-only')f.hooks.receipt={ok:true,local:true,remote:false};else f.hooks.verify=()=>{throw Error('后台核实失败');};
    await assert.rejects(f.run(),/同步|后台核实失败/);assert.equal(f.requests.length,0);assert.deepEqual(f.chunks,[]);assert.equal(f.s.content,'原稿保留');
  });
});

const mutations={
  source:f=>f.ctx.project.source++,receipt:f=>f.ctx.projectWorkflow.reportGapReceipts.g1.signature='changed',
  body:f=>f.s.content='人工修改稿',candidate:f=>f.s.pendingRevision={after:'候选'},lock:f=>f.s.locked=true,
  project:f=>f.ctx.currentProjectId='other-project',owner:f=>f.ctx.projectWorkflow={...f.ctx.projectWorkflow},
  section:f=>f.c.sections.splice(0,1),research:f=>f.setResearch(true)
};
test('保存与核实异步期间逐项保护项目、事实、收据、正文、候选和目录引用',async t=>{
  for(const stage of ['save','verify'])for(const [name,change] of Object.entries(mutations))await t.test(stage+' / '+name,async()=>{
    const f=fixture();f.hooks[stage]=()=>change(f);await assert.rejects(f.prepare(),/已变化/);assert.equal(f.requests.length,0);
  });
});

test('一次性准备凭据可在同调用重用，变化后必须拒绝而不是重绑旧prompt',async t=>{
  const f=fixture(),prepared=await f.prepare();assert.equal(await f.prepare(prepared),prepared);assert.equal(f.events.filter(x=>x==='verify').length,1);
  for(const [name,change] of Object.entries(mutations))await t.test(name,async()=>{
    const f=fixture(),prepared=await f.prepare();change(f);await assert.rejects(f.prepare(prepared),/已变化/);assert.equal(f.events.filter(x=>x==='verify').length,1);
  });
  const removed=fixture(),token=await removed.prepare();delete removed.ctx.projectWorkflow.reportGapReceipts;await assert.rejects(removed.prepare(token),/已变化/);
});

test('模型运行期间后台规则/收据撤销标记拒绝接收，不发送onChunk也不覆盖正文',async()=>{
  const f=fixture();f.hooks.rulesChanged=true;await assert.rejects(f.run(),/后台规则或资料核实状态已变化/);
  assert.equal(f.requests.length,1);assert.equal(f.s.executionTask.id,'task-1');assert.equal(f.s.content,'原稿保留');assert.equal(f.s.pendingRevision,undefined);assert.deepEqual(f.chunks,[]);
});

test('旧无台账收据项目不强制保存/核实；仍按原入口生成',async()=>{
  const f=fixture({receipts:false});assert.equal(await f.run(),'核验后的候选正文');assert.ok(!f.events.includes('verify'));assert.ok(!f.events.includes('save'));
});

test('刷新后的规则须先加载，再核实源版本、构建合同和提示',async()=>{
  const f=fixture();await f.run();assert.ok(f.events.indexOf('logic')<f.events.indexOf('verify'),'published policy must load before source-bound verification');
});

test('私人研究flush期间真实换轮次必须拒绝，不能捕获新run后携旧prompt提交',async()=>{
  const f=fixture({research:true});f.hooks.flush=()=>f.setRun('run-2');await assert.rejects(f.run(),/变化|切换/);assert.equal(f.requests.length,0);assert.deepEqual(f.chunks,[]);
});

test('准备完成后真实检索入口发生变更，不重绑旧提示、不调用模型',async t=>{
  for(const [name,change] of Object.entries(mutations))await t.test(name,async()=>{
    const f=fixture();f.hooks.rag=()=>change(f);await assert.rejects(f.run(),/已变化/);assert.equal(f.requests.length,0);assert.deepEqual(f.chunks,[]);
    assert.equal(f.events.filter(x=>x==='verify').length,1);
  });
});

test('私人研究保存刷新版本后，调用携带刷新后的版本而非旧凭据',async()=>{
  const f=fixture({research:true});f.hooks.flush=()=>{f.ctx.currentProjectUpdatedAt=20;};
  await f.run();assert.equal(f.requests.length,1);assert.equal(f.requests[0].research.expectedVersion,20);assert.equal(f.requests[0].research.runId,'run-1');
  assert.equal(f.events.filter(x=>x==='verify').length,1);
});

test('私人研究flush期间资料或签名收据变化拒绝使用旧prompt',async t=>{
  for(const name of ['source','receipt'])await t.test(name,async()=>{
    const f=fixture({research:true});f.hooks.flush=()=>mutations[name](f);
    await assert.rejects(f.run(),/变化|切换/);assert.equal(f.requests.length,0);assert.deepEqual(f.chunks,[]);
  });
});

function exportFixture(options){
  const f=fixture(options),alerts=[],downloads=[],button={id:'exportWordBtn',disabled:false,textContent:'导出 Word'},ctx=f.ctx;
  ctx.document={getElementById:()=>button,createElement:()=>({click(){downloads.push(this.download);}}),body:{appendChild(){},removeChild(){}}};
  ctx.URL={createObjectURL:()=> 'blob:isolated-test',revokeObjectURL(){}};
  ctx.alert=message=>alerts.push(message);ctx.ensureDocxLib=async()=>{f.events.push('docxlib');await f.hooks.docxlib?.();};
  ctx.buildExportPayload=()=>{f.events.push('payload');return {project:{name:'[系统测试]导出'},chapters:[{name:'市场分析'}],versionNote:'待审工作稿'};};
  ctx.exportReportCompletionGate=()=>f.events.push('completion-gate');
  ctx.buildDocxDocument=(_lib,payload)=>{f.events.push('docx');return payload;};
  ctx.docx={Packer:{toBlob:async payload=>{f.events.push('blob');return payload;}}};
  ctx.verifyReportPageLimit=async blob=>{f.events.push('pagination');await f.hooks.pagination?.();return {downloadBlob:blob};};
  const exportSource=fs.readFileSync(require.resolve('../export.js'),'utf8');
  vm.runInContext(exportSource.slice(exportSource.indexOf('async function exportWord('),exportSource.indexOf('function exportReportCompletionGate(')),ctx);
  return {...f,alerts,downloads,button,exportWord:()=>ctx.exportWord()};
}

test('真实Word工作稿入口核实成功才取导出快照，并保持未签发命名',async()=>{
  const f=exportFixture();await f.exportWord();assert.deepEqual(f.alerts,[]);assert.equal(f.downloads.length,1);assert.match(f.downloads[0],/未签发工作稿/);
  assert.ok(f.events.indexOf('save')<f.events.indexOf('verify'));assert.ok(f.events.indexOf('verify')<f.events.indexOf('payload'));assert.ok(f.events.indexOf('payload')<f.events.indexOf('pagination'));
  assert.equal(f.events.filter(x=>x==='verify').length,1);assert.equal(f.button.disabled,false);
});

test('Word保存/验签失败或切换项目均阻止下载，恢复按钮，不先构造报告',async t=>{
  for(const kind of ['save-failed','verify-failed','formal-switch','enter-research'])await t.test(kind,async()=>{
    const f=exportFixture();
    if(kind==='save-failed')f.hooks.receipt={ok:false,remote:false};
    else if(kind==='verify-failed')f.hooks.verify=()=>{throw Error('核实失败');};
    else f.hooks.docxlib=()=>kind==='formal-switch'?f.ctx.currentProjectId='p2':f.setResearch(true);
    await f.exportWord();assert.equal(f.downloads.length,0);assert.equal(f.alerts.length,1);assert.ok(!f.events.includes('payload'));assert.equal(f.button.disabled,false);
  });
});

test('Word核验排版期间换研究轮次，既有快照不下载到另一个研究',async()=>{
  const f=exportFixture({research:true});f.hooks.pagination=()=>f.setRun('run-2');await f.exportWord();
  assert.equal(f.downloads.length,0);assert.equal(f.alerts.length,1);assert.match(f.alerts[0],/切换/);assert.equal(f.button.disabled,false);
});

test('生产reportCompletionPlan与rlRetrieve都向二次规范化传递已验证trustedApprovals',()=>{
  const approvals=[{actorId:'server-reviewed',gapId:'g1'}],seen=[];
  const chapter={name:'市场分析',sections:[{t:'需求分析'}]},state={active:true,projectKey:'p1',sourceRevision:'s1',registry:{valid:true,issues:[]}};
  const ctx={chapters:[chapter],project:{},calcParams:{},calcResult:null,projectWorkflow:{reportGapRegistry:{}},kbEntries:[],
    reportCompletionFacts:()=>[],sectionFormalTemplates:()=>[],rlProjectType:()=> 'rent',rlBusinessScenario:()=>'',rlProjectText:()=>'',
    reportGapState:()=>state,reportGapContext:()=>({projectKey:'p1',trustedApprovals:approvals}),
    ReportLogicCore:{current:()=>({data:{}}),prompt:(_t,_c,_s,options)=>options.gapPresentation.instructions},
    ReportCompletionContract:{fingerprint:JSON.stringify,createPlan:()=>({planId:'p',sections:[{sectionKey:'市场分析 / 需求分析',requirements:{basis:false}}]})},ReportBusinessStructure:require('../report-business-structure.js'),
    ReportGapWorkflow:{contract:(_r,_key,options)=>{seen.push(options);return {primaryMarkers:[]};},section:(_r,_key,options)=>{seen.push(options);return {instructions:'核验边界'};}}
  };ctx.window=ctx;vm.createContext(ctx);
  vm.runInContext(source.slice(source.indexOf('function reportFinancialContext('),source.indexOf('function reportCandidateInputIdentity(')),ctx);
  vm.runInContext(source.slice(source.indexOf('function reportBusinessStructureBinding('),source.indexOf('async function reportBasisMaterialItems(')),ctx);
  vm.runInContext(source.slice(source.indexOf('function rlRetrieve('),source.indexOf('// 按章节标题匹配最相关的参考资料')),ctx);
  ctx.reportCompletionPlan();assert.equal(ctx.rlRetrieve('市场分析','需求分析'),'核验边界');assert.equal(seen.length,2);
  for(const options of seen){assert.equal(options.trustedApprovals,approvals);assert.equal(options.projectKey,'p1');assert.equal(options.sourceRevision,'s1');}
});
