'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const W=require('../project-workflow.js'),C=require('../report-completion-contract.js'),L=require('../report-length-plan.js');
const source=fs.readFileSync(require.resolve('../aireport.js'),'utf8');
function part(a,b){const start=source.indexOf(a),end=source.indexOf(b,start+a.length);assert.ok(start>=0&&end>start,a);return source.slice(start,end);}
const code=part('function airCurrentPartialCandidateBatch(','async function airRequestFullRegeneration(')
  +part('async function airRunGenTasks(','/* 首次生成(airGenOneSection)')
  +part('function airDeliverHtml(','async function airDeliverAction(')
  +part('async function airGenerateImpactedCandidates(','function airSectionMaterialState(');
const clone=x=>JSON.parse(JSON.stringify(x));
function fixture(ratio=1){
  const chapters=[{cn:'一',name:'总论',checked:true,sections:[{t:'编制依据'},{t:'项目背景'},{t:'项目概况'}]},
    ...['运营方案','财务评价'].map((name,i)=>({cn:['二','三'][i],name,checked:true,sections:Array.from({length:20},(_,j)=>({t:'专项分析'+j}))}))];
  const plan={...L.createPlan(chapters),confirmedAt:'2026-10-09T12:00:00Z',budgetResolution:{policy:'confirmed-length-plan',legacyBudgetFingerprint:L.legacyBudgetSummary({}).fingerprint}};
  const sections=chapters.flatMap(c=>c.sections.map(s=>({c,s,key:c.name+' / '+s.t})));
  sections.forEach(({s,key})=>{const row=plan.sections.find(r=>r.key===key);s.content='甲'.repeat(Math.max(1,Math.floor(row.target*ratio)));});
  const state={models:[],alerts:[],confirms:[],opened:[],saved:0,allow:true},workflow=W.ensureState({reportCompletion:{lengthPlan:plan}});
  const ctx={Set,chapters,projectWorkflow:workflow,ProjectWorkflow:W,ReportCompletionContract:C,ReportLengthPlan:L,
    ReportLengthUI:{savedPlan:()=>ctx.projectWorkflow.reportCompletion?.lengthPlan||null},
    aiReportBusy:false,airAcceptCandidatesBusy:false,aiReportImpactedProgress:null,aiReportProgressMsg:{active:true,total:43,done:43,failed:0},aiReportPendingTasks:[],aiReportStopFlag:false,aiReportChat:[],
    reportHasVisibleBody:W.hasReportBody,escapeHtml:value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),
    document:{querySelector:()=>null,getElementById:()=>null},setTimeout,clearTimeout,
    airCaptureReportMutation:()=>({}),airCheckReportMutation:()=>{},airGuardReportMutation:async()=>{},
    airCandidateImpactRows:()=>[],airReportLogicImpactSummary:()=>({locked:0}),airBuildDocPane:()=>{},airRefreshSection:()=>{},
    reportLogicRevision:()=>({}),reportGenerationConcurrency:()=>4,runWorkerPool:async(tasks,worker)=>{for(const task of tasks)await worker(task);},
    runReportGenerationPool:async(tasks,worker)=>{for(const task of tasks)await worker(task);},airGenOneSection:async()=>{throw Error('unexpected paid generation');},
    airStoreNewCandidate:(info,text,reason,meta)=>W.setCandidate(info.section,text,reason,meta),
    reviseSection:async(c,s,instruction)=>{state.models.push({key:c.name+' / '+s.t,instruction});return '本节补充比较及风险，原稿仍保留。';},
    generateSection:async()=>{throw Error('unexpected first draft');},confirm:message=>{state.confirms.push(message);return state.allow;},alert:message=>state.alerts.push(message),
    saveDraft:()=>state.saved++,airSaveState:async()=>{},flushCloudSave:async()=>{},airSaveLocalState:()=>{},renderAiReportMsgs:()=>{},airRepairFlowCards:()=>{},
    currentReportVersionMeta:reason=>({reason}),airPush:message=>ctx.aiReportChat.push(message),airOpenExistingReport:message=>state.opened.push(message),
    airCompletedVersionForProgress:()=>W.latestCompleteReportVersion(workflow)};
  ctx.window=ctx;vm.createContext(ctx);vm.runInContext(code,ctx);ctx.airOpenExistingReport=message=>state.opened.push(message);return {ctx,state,workflow,chapters,plan,sections};
}

test('确认7.5万后：43节虽都有短正文，交付不说完成，也不显示继续生成剩余0节',async()=>{
  const f=fixture(0.73),status=f.ctx.airReportGenerationStatus();
  assert.equal(status.bodyComplete,true);assert.equal(status.complete,false);assert.equal(status.remaining,0);
  assert.equal(status.lengthDelivery.target,75000);assert.equal(status.lengthDelivery.status,'short');
  for(const html of [f.ctx.airGenerationIncompleteHtml(),f.ctx.airDeliverHtml()]){
    assert.match(html,/没达到确认篇幅/);assert.match(html,/75000/);assert.match(html,/下载当前阶段 Word/);
    assert.doesNotMatch(html,/继续生成剩余 0|已经完整生成|进入复核与签发/);
  }
  await f.ctx.airResumeGeneration();assert.equal(f.state.models.length,0);assert.equal(f.state.opened.length,1);assert.match(f.state.opened[0],/未调用AI/);
});

test('75,000字和偏多正文分别展示真实结果；旧项目未确认目标保持兼容',()=>{
  const full=fixture(),status=full.ctx.airReportGenerationStatus();assert.equal(status.complete,true);assert.equal(status.lengthDelivery.actual,75000);
  assert.match(full.ctx.airLengthDeliveryHtml(),/字数在确认范围内/);assert.match(full.ctx.airLengthDeliveryHtml(),/实际页数以 Word 排版为准/);
  const over=fixture(1.2),before=JSON.stringify(over.chapters);assert.equal(over.ctx.airReportGenerationStatus().complete,false);
  assert.match(over.ctx.airLengthDeliveryHtml(),/不会自动删正文/);assert.doesNotMatch(over.ctx.airLengthDeliveryHtml(),/class="air-doc-tool air-length-fill"/);assert.equal(JSON.stringify(over.chapters),before);
  const old=fixture(0.2);delete old.workflow.reportCompletion.lengthPlan;assert.equal(old.ctx.airReportGenerationStatus().complete,true);assert.equal(old.ctx.airLengthDeliveryHtml(),'');
});

test('刷新后重新按正式正文计数：不把已有候选算进去，接受前预估也仅计指定候选',()=>{
  const f=fixture(0.5),row=f.sections[5],before=f.ctx.airReportLengthDelivery().actual;
  row.s.pendingRevision={after:'乙'.repeat(10000)};assert.equal(f.ctx.airReportLengthDelivery().actual,before);
  const projected=f.ctx.airReportLengthDelivery(new Set([row.s]));assert.equal(projected.actual,before-row.s.content.length+10000);
  const reload=fixture();reload.ctx.chapters=clone(f.chapters);reload.ctx.projectWorkflow=clone(f.workflow);assert.equal(reload.ctx.airReportLengthDelivery().actual,before);
  row.s.editedHtml='<p>丙</p><table><tr><td>'+('表'.repeat(20000))+'</td></tr></table>';
  assert.equal(f.ctx.airReportLengthDelivery().actual,before-row.s.content.length+1);
});

test('空数据、缺少一节和未勾选目录不能报完整；依据清单不列入凑字小节',()=>{
  const f=fixture(0.5),basis=f.plan.sections.find(s=>s.basis);assert.ok(basis);
  const html=f.ctx.airLengthDeliveryHtml();assert.doesNotMatch(html,/data-cn="一" data-si="0"/);
  f.sections[3].s.content='';assert.equal(f.ctx.airReportGenerationStatus().remaining,1);assert.equal(f.ctx.airReportLengthDelivery().status,'incomplete');
  f.ctx.chapters=[];assert.equal(f.ctx.airReportGenerationStatus().complete,false);assert.equal(f.ctx.airReportLengthDelivery().status,'incomplete');
  const hidden=fixture();hidden.chapters[2].checked=false;assert.equal(hidden.ctx.airReportGenerationStatus().complete,false);assert.equal(hidden.ctx.airReportLengthDelivery().status,'incomplete');
});

test('短稿归档为当前阶段，不覆盖旧完整版本；重新查状态不会自动重写',async()=>{
  const f=fixture(0.73),old={id:'[系统测试]V9',version:9,chapters:clone(fixture().chapters)};f.workflow.reportVersions=[old];f.workflow.currentReportVersionId=old.id;
  const original=JSON.stringify(old);await f.ctx.airRunGenTasks();
  assert.equal(f.workflow.reportVersions.length,2);const stage=f.workflow.reportVersions[1];
  assert.equal(stage.lengthDelivery.status,'short');assert.equal(stage.lengthDelivery.actual,f.ctx.airReportLengthDelivery().actual);
  assert.equal(W.latestCompleteReportVersion(f.workflow,stage.id).id,old.id);assert.equal(JSON.stringify(old),original);
  assert.equal(f.ctx.aiReportProgressMsg.active,false);assert.equal(f.ctx.aiReportProgressMsg.stopped,true);assert.equal(f.state.models.length,0);
  assert.ok(f.ctx.aiReportChat.some(m=>m.kind==='generationIncomplete'));assert.ok(!f.ctx.aiReportChat.some(m=>String(m.content||'').includes('🎉')));
});

test('仅补薄弱分析：取消零请求；确认后跳过依据、锁定、已有候选，原正文不变',async()=>{
  const f=fixture(0.5);f.sections[1].s.locked=true;f.sections[2].s.pendingRevision={after:'已有候选，不替换'};
  f.sections[3].s.syncStatus='locked-stale';const before=f.sections.map(r=>r.s.content),basisKey=f.plan.sections.find(r=>r.basis).key;
  f.state.allow=false;await f.ctx.airFillLengthGaps();assert.equal(f.state.models.length,0);assert.match(f.state.confirms[0],/会调用AI/);
  f.state.allow=true;await f.ctx.airFillLengthGaps();
  assert.equal(f.state.models.length,39);assert.ok(f.state.models.every(r=>![basisKey,...f.sections.slice(1,4).map(s=>s.key)].includes(r.key)));
  assert.ok(f.state.models.every(r=>/保留|完整保留/.test(r.instruction)&&/不重复堆字/.test(r.instruction)));
  assert.deepEqual(f.sections.map(r=>r.s.content),before);assert.equal(f.sections[2].s.pendingRevision.after,'已有候选，不替换');
  assert.equal(f.ctx.aiReportImpactedProgress.failed,0);assert.equal(f.ctx.aiReportImpactedProgress.total,39);
  const count=f.state.models.length;await f.ctx.airFillLengthGaps();assert.equal(f.state.models.length,count);assert.match(f.state.alerts.at(-1),/已有候选|已锁定/);
});

test('全部正常范围、加载中或未确认目标，不触发补写；失败只记该节不回滚成功候选',async()=>{
  for(const mode of ['full','busy','unconfirmed']){const f=fixture(mode==='full'?1:0.5);if(mode==='busy')f.ctx.aiReportBusy=true;if(mode==='unconfirmed')delete f.workflow.reportCompletion.lengthPlan;await f.ctx.airFillLengthGaps();assert.equal(f.state.models.length,0,mode);}
  const f=fixture(0.5),keys=f.sections.slice(4,6).map(r=>r.key),before=JSON.stringify(f.sections[4].s);
  f.ctx.reviseSection=async(c,s)=>{if(s===f.sections[4].s){const e=Error('本节响应格式错误，原稿保留');e.code='structured-json';throw e;}return '另一节有效候选';};
  await f.ctx.airGenerateImpactedCandidates(false,false,keys);
  assert.equal(f.ctx.aiReportImpactedProgress.failed,1);assert.equal(f.ctx.aiReportImpactedProgress.failures[0].sectionKey,keys[0]);
  assert.equal(f.sections[4].s.content,JSON.parse(before).content);assert.equal(f.sections[4].s.pendingRevision,undefined);
  assert.equal(f.sections[5].s.pendingRevision.after,'另一节有效候选');assert.match(f.state.alerts.at(-1),/响应格式错误/);
});
