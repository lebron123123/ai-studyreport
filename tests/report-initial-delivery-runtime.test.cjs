require('../scripts/windows-browser-lockout-guard.cjs');
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const fs=require('node:fs'),vm=require('node:vm');
const I=require('../report-initial-delivery.js');
const R=require('../report-initial-delivery-runtime.js');
const hash=async x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
function fixture(options={}){
  const c={name:'业务',sections:[{t:'明细',content:''},{t:'汇总',content:''}]},chapters=[c],workflow={reportCompletion:{}},calls=[],saves=[];let input='v1',pages=120,now=1000;
  const plan={planId:'p',planningPriority:'pages',proseTotal:20,targetPageRange:{min:110,max:130},sections:[{key:'业务 / 明细',target:10},{key:'业务 / 汇总',target:10}],initialDeliveryAuthorization:{authorized:true,version:I.VERSION,planId:'p',planningPriority:'pages',confirmedAt:'2026-10-10T00:00:00Z',maxAdditionalCalls:2,maxAdditionalCallsPerSection:2,maxElapsedMs:1800000,maxPaginationPasses:3}};
  const ctx={planner:I,chapters:()=>chapters,workflow:()=>workflow,plan:()=>plan,identity:()=>({projectId:'test',input}),contract:()=>({requirements:{basis:false}}),inspect:text=>({status:text.includes('BAD')?'blocked':text?'passed':'blocked',issues:text.includes('BAD')?[{code:'missing-heading',severity:'error',repairable:true}]:[]}),measure:text=>text.length,classify:(c,s)=>({summary:s.t==='汇总'}),capture:()=>({}),guard:async()=>{},save:async()=>{saves.push(JSON.parse(JSON.stringify(workflow)));return {ok:true,remote:true};},hash,now:()=>now,concurrency:()=>4,generate:async(c,s)=>{calls.push('generate:'+s.t);return s.t+'正文事实与条件分析';},revise:async(c,s,instruction,source)=>{calls.push('revise:'+s.t);assert.ok(instruction.includes('完整保留'));return source.replace('BAD','修复');},apply:async(c,s,text)=>{assert.equal(ctx.inspect(text).status,'passed');s.content=text;},bodyHash:()=>hash(chapters),paginate:async({assertCurrent,expectedPlanId})=>{await assertCurrent();const bodyHash=await ctx.bodyHash(),documentSha256='a'.repeat(64);return {pages,bodyHash,planId:expectedPlanId,documentSha256,receipt:{schemaVersion:'report-pagination-receipt-v2',documentSha256,pages,maxPages:130,scope:'pagination-only',contentQualityCertified:false,versionsMatch:true,rulesVersion:'r',documentRulesVersion:'r',templateVersion:'t',documentTemplateVersion:'t',renderer:'WPS',rendererVersion:'12',checkedAt:'2026-10-10T00:01:00Z',validationStatus:pages>130?'over-page-limit':'within-page-limit'},qualityReview:{status:'unverified',factsVerified:false}};}};
  ctx.finalizeDetails=async({assertCurrent})=>{await assertCurrent();return {changed:false,sectionKeys:[]};};
  Object.assign(ctx,options);const runtime=R.createRuntime(ctx);return {runtime,c,chapters,workflow,plan,ctx,calls,saves,setInput:v=>input=v,setPages:v=>pages=v,setTime:v=>now=v};
}
async function initial(f){const out=await f.runtime.start({tasks:f.c.sections.map((s,si)=>({c:f.c,s,si}))});assert.equal(out.tasks.length,1);const t=out.tasks[0];assert.equal(f.runtime.accepts(t.c,t.s),true);t.s.content='明细正文事实与条件分析';await f.runtime.recordGenerated(t.c,t.s);return out;}
test('没有新明确授权不付费、不修改旧稿',async()=>{const f=fixture();delete f.plan.initialDeliveryAuthorization;const out=await f.runtime.start({tasks:[]});assert.equal(out.active,false);assert.equal(f.saves.length,0);assert.equal(f.calls.length,0);});
test('整份状态检查只构建一次当前合同计划，下次检查重新读取而非缓存旧合同',async()=>{
  let batches=0,scalar=0,revision=1;const observed=[];
  const f=fixture({contract:()=>{scalar++;return {requirements:{basis:false},revision};},contracts:rows=>{batches++;return rows.map(()=>({requirements:{basis:false},revision}));},inspect:(text,contract)=>{if(contract)observed.push(contract.revision);return {status:revision===2?'blocked':text?'passed':'blocked',issues:[]};}});
  await initial(f);await f.runtime.finish();
  const before=batches,scalarBefore=scalar;observed.length=0;
  assert.equal(f.runtime.status().complete,true);assert.equal(batches-before,1);assert.equal(scalar,scalarBefore);assert.deepEqual(observed,[1,1]);
  revision=2;observed.length=0;assert.equal(f.runtime.status().complete,false);assert.equal(batches-before,2);assert.deepEqual(observed,[2]);
});
test('真实适配器的多节snapshot共用本次计划，不逐节重建全份计划',async()=>{
  const f=fixture();let plans=0,scalar=0;const contract={requirements:{basis:false}};
  const context={ReportInitialDelivery:I,reportCompletionPlan:()=>{plans++;return {sections:f.c.sections.map(s=>({...contract,sectionKey:f.c.name+' / '+s.t}))};},reportSectionContract:()=>{scalar++;return contract;}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../report-initial-delivery-runtime.js'),'utf8'),context);
  const adapter={...f.ctx};delete adapter.contract;const runtime=context.ReportInitialDeliveryRuntime.createRuntime(adapter);
  const out=await runtime.start({tasks:[{c:f.c,s:f.c.sections[0]}]});assert.equal(out.tasks.length,1);
  // One full snapshot before deciding actions, one before reserving the permit.
  assert.equal(plans,2);assert.equal(scalar,2);
  const oldPlans=plans;await runtime.start({tasks:[]});assert.equal(plans-oldPlans,1);
});
test('核对耗时跨过30分钟时使用结束时间，首次决策即停止而非继续派发',async()=>{
  let f,delay=false;const phases=[];
  f=fixture({hash:async value=>{const result=await hash(value);if(delay){delay=false;f.setTime(1801001);}return result;}});
  await initial(f);delay=true;const out=await f.runtime.finish({onProgress:p=>phases.push(p)});
  assert.equal(out.reason,'elapsed-limit');assert.equal(phases[0].phase,'paused');assert.equal(f.calls.length,0);
});
test('start保存permit后只派明细，finish才汇总和实排',async()=>{const f=fixture(),out=await initial(f);assert.equal(out.tasks[0].si,0);assert.ok(f.saves[0].reportCompletion.initialDelivery);const end=await f.runtime.finish();assert.equal(end.complete,true);assert.equal(end.status,'completed');assert.equal(end.pages,120);assert.deepEqual(f.calls,['generate:汇总']);assert.equal(end.receipt.scope,'pagination-only');assert.equal(end.qualityReview.factsVerified,false);});
test('同一确认token不能重置ledger，force也不重复付费',async()=>{const f=fixture();await initial(f);await f.runtime.finish();const saved=JSON.stringify(f.workflow.reportCompletion.initialDelivery.run),out=await f.runtime.start({force:true,tasks:f.c.sections.map(s=>({c:f.c,s}))});assert.equal(out.active,true);assert.deepEqual(out.tasks,[]);assert.equal(JSON.stringify(out.run),saved);await f.runtime.finish();assert.equal(f.calls.length,1);});
test('刷新无可证明taskId时明确暂停，不能重复POST',async()=>{const f=fixture();await f.runtime.start({tasks:[{c:f.c,s:f.c.sections[0]}]});const other=R.createRuntime(f.ctx),out=await other.start({tasks:[{c:f.c,s:f.c.sections[0]}]});assert.equal(out.status,'recovering');assert.deepEqual(out.tasks,[]);const end=await other.finish();assert.equal(end.status,'paused');assert.equal(end.reason,'unknown-paid-task-id');assert.equal(end.run.permits[0].status,'reserved');assert.equal(f.calls.length,0);});
test('旧稿、候选、锁定不写入，只保留原状态',async()=>{for(const type of ['body','candidate','locked']){const f=fixture(),s=f.c.sections[0];if(type==='body')s.content='用户旧稿';if(type==='candidate')s.pendingRevision={after:'用户候选'};if(type==='locked')s.locked=true;const before=JSON.stringify(s),out=await f.runtime.start({tasks:[{c:f.c,s}]});assert.deepEqual(out.tasks,[]);const end=await f.runtime.finish();if(type!=='body')assert.equal(end.status,'paused');assert.equal(JSON.stringify(s),before);}});
test('初稿质量失败保留后台全文，仅精确许可source可修',async()=>{const f=fixture(),out=await f.runtime.start({tasks:[{c:f.c,s:f.c.sections[0]}]}),s=out.tasks[0].s,q={status:'blocked',issues:[{code:'missing-heading',severity:'error',repairable:true}]};assert.equal(await f.runtime.captureBlocked(f.c,s,{text:'BAD原始标题事实表格',quality:q,taskId:'task-original'}),true);await f.runtime.recordGenerated(f.c,s,{error:Object.assign(new Error('blocked'),{taskId:'task-original'})});assert.equal(s.content,'');const end=await f.runtime.finish();assert.equal(end.complete,true);assert.match(s.content,/修复原始标题事实表格/);assert.deepEqual(f.calls,['revise:明细','generate:汇总']);assert.equal(end.run.additionalCalls,1);});
test('不可修门禁不放宽、坏稿不自动接受',async()=>{const f=fixture(),out=await f.runtime.start({tasks:[{c:f.c,s:f.c.sections[0]}]}),s=out.tasks[0].s;await f.runtime.captureBlocked(f.c,s,{text:'BAD冲突',quality:{status:'blocked',issues:[{code:'source-mismatch',severity:'error',repairable:false}]},taskId:'task-original'});await f.runtime.recordGenerated(f.c,s,{error:Object.assign(new Error('blocked'),{taskId:'task-original'})});const end=await f.runtime.finish();assert.equal(end.status,'paused');assert.equal(s.content,'');assert.equal(f.calls.length,0);});
test('正文、身份与原稿断言阻止串写',async()=>{const f=fixture(),out=await f.runtime.start({tasks:[{c:f.c,s:f.c.sections[0]}]}),s=out.tasks[0].s;s.content='人工输入';assert.equal(f.runtime.accepts(f.c,s),false);await assert.rejects(f.runtime.assertDraftSource(f.c,s,'人工输入'),{code:'INITIAL_DRAFT_SOURCE_CHANGED'});f.setInput('v2');await assert.rejects(f.runtime.finish(),{code:'INITIAL_INPUT_CHANGED'});});
test('未知POST错误记录uncertain，不能自动重复付费',async()=>{const f=fixture(),out=await f.runtime.start({tasks:[{c:f.c,s:f.c.sections[0]}]});await f.runtime.recordGenerated(f.c,out.tasks[0].s,{error:new Error('lost response')});const end=await f.runtime.finish();assert.equal(end.status,'paused');assert.equal(end.reason,'unknown-paid-task-id');assert.equal(end.run.permits[0].status,'uncertain');assert.equal(f.calls.length,0);});
test('真实分页失败不冒称完成',async()=>{const f=fixture({paginate:async()=>{throw new Error('WPS unavailable');}});await initial(f);const end=await f.runtime.finish();assert.equal(end.status,'paused');assert.equal(end.reason,'pagination-failed');assert.ok(f.c.sections.every(s=>s.content));});
test('实排超页不按字数假通过，不截断正文',async()=>{const f=fixture();await initial(f);f.setPages(150);const end=await f.runtime.finish();assert.equal(end.complete,false);assert.equal(end.reason,'page-excess-needs-targeted-review');assert.equal(f.c.sections[0].content,'明细正文事实与条件分析');});
test('用户停止保留已付费任务和正文，不继续调用',async()=>{const f=fixture();await initial(f);const end=await f.runtime.finish({shouldContinue:()=>false});assert.equal(end.reason,'user-stopped');assert.equal(f.calls.length,0);assert.ok(f.c.sections[0].content);});
test('保存失败时不派发AI',async()=>{const f=fixture({save:async()=>({ok:false,local:false,remote:false})});await assert.rejects(f.runtime.start({tasks:[]}),{code:'INITIAL_SAVE_FAILED'});assert.equal(f.calls.length,0);});
test('并行明细回执串行更新CAS，不误拦正常兄弟完成',async()=>{const f=fixture();f.c.sections.splice(1,0,{t:'明细二',content:''});f.plan.sections.splice(1,0,{key:'业务 / 明细二',target:10});const out=await f.runtime.start({tasks:f.c.sections.map(s=>({c:f.c,s}))});assert.equal(out.tasks.length,2);out.tasks.forEach(t=>t.s.content=t.s.t+'事实分析');await Promise.all(out.tasks.map(t=>f.runtime.recordGenerated(t.c,t.s)));const end=await f.runtime.finish();assert.equal(end.complete,true);assert.equal(end.run.sections.filter(s=>s.owned).length,3);});

test('汇总许可前只终验本轮已采用明细，先保存再派发；旧正文合同和任务不改',async()=>{
  const events=[];let f;
  f=fixture({finalizeDetails:async({ownedKeys,assertCurrent})=>{
    events.push('finalize');assert.deepEqual(ownedKeys,['业务 / 明细']);await assertCurrent();
    assert.equal(f.workflow.reportCompletion.initialDelivery.run.permits.filter(p=>p.kind==='summarize').length,0);
    f.c.sections[0].completionContract={planId:'current-table-plan',sectionKey:ownedKeys[0]};
    f.c.sections[0].completionQuality={status:'passed',factsVerified:false};
    return {changed:true,sectionKeys:ownedKeys};
  },save:async()=>{events.push('save');return {ok:true,remote:true};},generate:async(c,s)=>{events.push('generate:'+s.t);return s.t+'正文事实与条件分析';}});
  const protectedSection={t:'原有明细',content:'用户旧正文',editedHtml:'<p>人工编辑正文</p>',completionContract:{planId:'protected-current'},completionQuality:{status:'passed',factsVerified:false},executionTask:{id:'original-task',runId:'original-run'},pendingRevision:{after:'旧候选'}};
  f.c.sections.splice(1,0,protectedSection);f.plan.sections.splice(1,0,{key:'业务 / 原有明细',target:10});
  const before=JSON.stringify(protectedSection);await initial(f);events.length=0;
  const end=await f.runtime.finish();assert.equal(end.complete,true);assert.equal(JSON.stringify(protectedSection),before);
  assert.deepEqual(events.slice(0,4),['finalize','save','save','generate:汇总']);
  assert.equal(f.c.sections[0].completionContract.planId,'current-table-plan');assert.equal(f.c.sections[0].completionQuality.factsVerified,false);
});

test('生产终验适配器未加载时fail closed，明细和任务保留且不创建汇总permit',async()=>{
  const f=fixture();await initial(f);const ctx={...f.ctx};delete ctx.finalizeDetails;
  const runtime=R.createRuntime(ctx);await runtime.start({});const before=JSON.stringify(f.c.sections);
  await assert.rejects(runtime.finish(),{code:'INITIAL_FINALIZE_UNAVAILABLE'});
  assert.equal(JSON.stringify(f.c.sections),before);assert.equal(f.calls.length,0);
  assert.equal(f.workflow.reportCompletion.initialDelivery.run.permits.some(p=>p.kind==='summarize'),false);
});

test('当前结构/财务/来源或受保护合同终验失败保留全部正文，不付费补写',async()=>{
  for(const code of ['STRUCTURE_CHANGED','FINANCIAL_SOURCE_CHANGED','SOURCE_CHANGED','PROTECTED_CONTRACT_STALE']){
    const f=fixture({finalizeDetails:async({assertCurrent})=>{await assertCurrent();throw Object.assign(new Error('真实终验未通过'),{code});}});
    await initial(f);const before=JSON.stringify(f.c.sections);
    await assert.rejects(f.runtime.finish(),{code});assert.equal(JSON.stringify(f.c.sections),before);assert.equal(f.calls.length,0);
    const saved=f.workflow.reportCompletion.initialDelivery;assert.equal(saved.lastOutcome.reason,code);assert.equal(saved.run.permits.some(p=>p.kind==='summarize'),false);
  }
});

test('终验的await边界拒绝正文/task/候选/锁定/输入/计划目标/目录/保护合同/ledger变化',async()=>{
  for(const kind of ['body','task','candidate','locked','identity','target','outline','protected-contract','ledger']){
    let f;f=fixture({finalizeDetails:async({assertCurrent})=>{
      await assertCurrent();await Promise.resolve();const s=f.c.sections[0];
      if(kind==='body')s.content+='人工新正文';if(kind==='task')s.executionTask={id:'other-task'};
      if(kind==='candidate')s.pendingRevision={after:'人工候选'};if(kind==='locked')s.locked=true;
      if(kind==='identity')f.setInput('v2');if(kind==='target')f.plan.sections[0].target++;
      if(kind==='outline')f.c.sections.reverse();if(kind==='protected-contract')f.c.sections[1].completionContract={planId:'tampered'};
      if(kind==='ledger')f.workflow.reportCompletion.initialDelivery.run.additionalCalls++;
      await assertCurrent();return {changed:false,sectionKeys:[]};
    }});await initial(f);await assert.rejects(f.runtime.finish(),error=>['INITIAL_INPUT_CHANGED','INITIAL_DETAIL_FINALIZE_CAS'].includes(error.code),kind);
    assert.equal(f.calls.length,0,kind);assert.equal(f.workflow.reportCompletion.initialDelivery.run.permits.some(p=>p.kind==='summarize'),false,kind);
    if(kind==='body')assert.match(f.c.sections[0].content,/人工新正文/,'不回滚人工输入');
  }
});

test('适配器未主动调用guard也必须通过返回后CAS，错误sectionKeys不得扩权',async()=>{
  for(const mode of ['body','protected','unknown-key','duplicate-key','empty-changed','bad-result']){
    let f;f=fixture({finalizeDetails:async()=>{
      if(mode==='body')f.c.sections[0].content+='迟到人工修改';
      if(mode==='protected')f.c.sections[1].completionQuality={status:'passed'};
      return mode==='bad-result'?null:{changed:true,sectionKeys:mode==='unknown-key'?['业务 / 汇总']:mode==='duplicate-key'?['业务 / 明细','业务 / 明细']:mode==='empty-changed'?[]:['业务 / 明细']};
    }});await initial(f);await assert.rejects(f.runtime.finish(),error=>['INITIAL_DETAIL_FINALIZE_CAS','INITIAL_DETAIL_FINALIZE_RESULT'].includes(error.code),mode);
    assert.equal(f.calls.length,0,mode);assert.equal(f.workflow.reportCompletion.initialDelivery.run.permits.some(p=>p.kind==='summarize'),false,mode);
  }
});

test('终验保存失败保留重绑状态；刷新后changed:false也须可靠重存才能汇总',async()=>{
  let f,fail=false,finalizations=0;const events=[];
  f=fixture({finalizeDetails:async({ownedKeys,assertCurrent})=>{
    await assertCurrent();finalizations++;const changed=!f.c.sections[0].completionContract;
    if(changed)f.c.sections[0].completionContract={planId:'final-current',sectionKey:ownedKeys[0]};
    events.push('finalize:'+changed);return {changed,sectionKeys:changed?ownedKeys:[]};
  },save:async()=>{events.push('save:'+!fail);return {ok:!fail,remote:!fail,local:!fail};},generate:async(c,s)=>{events.push('generate:'+s.t);return s.t+'正文事实与条件分析';}});
  await initial(f);const body=f.c.sections[0].content;fail=true;events.length=0;
  await assert.rejects(f.runtime.finish(),{code:'INITIAL_SAVE_FAILED'});assert.equal(f.c.sections[0].content,body);
  assert.equal(f.c.sections[0].completionContract.planId,'final-current');assert.equal(f.workflow.reportCompletion.initialDelivery.lastOutcome.reason,'INITIAL_SAVE_FAILED');
  assert.deepEqual(events,['finalize:true','save:false']);assert.equal(f.workflow.reportCompletion.initialDelivery.run.permits.some(p=>p.kind==='summarize'),false);
  fail=false;const runtime=R.createRuntime(f.ctx);await runtime.start({});events.length=0;
  const end=await runtime.finish();assert.equal(end.complete,true);assert.equal(finalizations,2);assert.equal(f.c.sections[0].content,body);
  assert.deepEqual(events.slice(0,4),['finalize:false','save:true','save:true','generate:汇总']);
});

test('终验保存的await后再核正文/task与项目，不接着派发汇总',async()=>{
  for(const kind of ['body','task','identity']){
    let f,change=false;f=fixture({save:async()=>{await Promise.resolve();if(change){if(kind==='body')f.c.sections[0].content+='新编辑';if(kind==='task')f.c.sections[0].executionTask={id:'new-task'};if(kind==='identity')f.setInput('new-project-input');}return {ok:true,remote:true};}});
    await initial(f);change=true;await assert.rejects(f.runtime.finish(),error=>['INITIAL_DETAIL_FINALIZE_CAS','INITIAL_INPUT_CHANGED'].includes(error.code),kind);
    assert.equal(f.calls.length,0);assert.equal(f.workflow.reportCompletion.initialDelivery.run.permits.some(p=>p.kind==='summarize'),false);
  }
});

test('hash/权限await期间发生变化仍被再次核对，不用旧snapshot接收',async()=>{
  for(const during of ['hash','guard']){
    let f,armed=false;const guard=async()=>{await Promise.resolve();if(armed&&during==='guard'){armed=false;f.c.sections[0].executionTask={id:'late'};}};
    f=fixture({guard,hash:async value=>{const out=await hash(value);if(armed&&during==='hash'){armed=false;f.c.sections[0].executionTask={id:'late'};}return out;},finalizeDetails:async({assertCurrent})=>{armed=true;await assertCurrent();return {changed:false,sectionKeys:[]};}});
    await initial(f);await assert.rejects(f.runtime.finish(),{code:'INITIAL_DETAIL_FINALIZE_CAS'},during);assert.equal(f.calls.length,0);
  }
});

test('有限补写后再终验明细，再刷新汇总；重复finish不重付费',async()=>{
  let f;const finalized=[];f=fixture({finalizeDetails:async({ownedKeys,assertCurrent})=>{await assertCurrent();finalized.push({keys:ownedKeys,body:f.c.sections[0].content});return {changed:false,sectionKeys:[]};},expansionEvidence:()=>[{kind:'confirmed-fact',source:'真实材料#p2'}],revise:async(c,s,instruction,source)=>{f.calls.push('revise:'+s.t);f.setPages(120);return source+'有依据的新增分析';}});
  await initial(f);f.setPages(95);const end=await f.runtime.finish();assert.equal(end.complete,true);
  assert.equal(finalized.length,2);assert.deepEqual(finalized.map(x=>x.keys),[['业务 / 明细'],['业务 / 明细']]);assert.notEqual(finalized[0].body,finalized[1].body);
  await f.runtime.finish();assert.equal(finalized.length,2);assert.deepEqual(f.calls,['generate:汇总','revise:明细','generate:汇总']);
});

test('终验期间用户停止，保留保存后的明细但不派汇总',async()=>{
  let allowed=true;const f=fixture({finalizeDetails:async({assertCurrent})=>{await assertCurrent();allowed=false;return {changed:false,sectionKeys:[]};}});
  await initial(f);const end=await f.runtime.finish({shouldContinue:()=>allowed});assert.equal(end.reason,'user-stopped');assert.equal(f.calls.length,0);
  assert.equal(f.workflow.reportCompletion.initialDelivery.run.permits.some(p=>p.kind==='summarize'),false);
});
function backendTask(f){return {id:'rsec-original',runId:'backend-run',graph:[{key:'context_snapshot',hash:'exact-input-hash'}],recoveryContext:{contract:{sectionKey:'业务 / 明细'},financialSource:{snapshotId:'calc-current'},generationInputIdentity:{projectId:'test',input:'v1'},bodyAtStart:f.c.sections[0].editedHtml||f.c.sections[0].content||''}};}
test('刷新GET-only恢复精确原任务与合同，再走原质量检查',async()=>{const f=fixture();await f.runtime.start({tasks:[{c:f.c,s:f.c.sections[0]}]});const task=backendTask(f);assert.equal(f.runtime.rememberTask(f.c,f.c.sections[0],task),true);await f.ctx.save();let gets=0;f.ctx.recover=async(c,s,recovery)=>{gets++;assert.equal(recovery.taskId,task.id);assert.deepEqual(recovery.context,task.recoveryContext);return '原后台明细事实与条件分析';};const other=R.createRuntime(f.ctx),out=await other.start({tasks:[]});assert.equal(out.tasks.length,0);assert.equal(out.recoveries.length,1);assert.equal(await other.assertRecoveryTask(f.c,f.c.sections[0],out.recoveries[0]),true);const end=await other.finish();assert.equal(end.complete,true);assert.equal(gets,1);assert.deepEqual(f.calls,['generate:汇总']);assert.equal(f.c.sections[0].content,'原后台明细事实与条件分析');assert.equal(end.run.sections[0].firstCalls,1);});
test('恢复描述符与后台原合同不得篡改或猜旧executionTask',async()=>{const f=fixture();f.c.sections[0].executionTask={id:'old-unrelated'};const out=await f.runtime.start({tasks:[{c:f.c,s:f.c.sections[0]}]});assert.equal(out.recoveries.length,0);const task=backendTask(f);assert.equal(f.runtime.rememberTask(f.c,f.c.sections[0],{...task,runId:'',recoveryContext:null}),false);assert.equal(f.runtime.rememberTask(f.c,f.c.sections[0],task),true);assert.equal(f.runtime.rememberTask(f.c,f.c.sections[0],{...task,id:'other'}),false);const resumed=await f.runtime.start({});for(const field of ['taskId','backendRunId','inputHash','idempotencyKey','permitId'])await assert.rejects(f.runtime.assertRecoveryTask(f.c,f.c.sections[0],{...resumed.recoveries[0],[field]:'forged'}),{code:'INITIAL_RECOVERY_CHANGED'});await assert.rejects(f.runtime.assertRecoveryTask(f.c,f.c.sections[0],{...resumed.recoveries[0],context:{...task.recoveryContext,financialSource:{snapshotId:'other'}}}),{code:'INITIAL_RECOVERY_CHANGED'});f.c.sections[0].content='人工更改';await assert.rejects(f.runtime.assertRecoveryTask(f.c,f.c.sections[0],resumed.recoveries[0]),{code:'INITIAL_RECOVERY_CHANGED'});assert.equal(f.calls.length,0);});
test('GET暂不可达保留原task与uncertain，不新POST也不假完成',async()=>{const f=fixture({recover:async()=>{throw new Error('temporary GET network failure');}});await f.runtime.start({tasks:[{c:f.c,s:f.c.sections[0]}]});assert.equal(f.runtime.rememberTask(f.c,f.c.sections[0],backendTask(f)),true);const end=await f.runtime.finish();assert.equal(end.status,'recovering');assert.equal(end.reason,'original-task-still-pending');assert.equal(end.run.permits[0].status,'uncertain');assert.equal(end.run.permits[0].taskId,'rsec-original');assert.equal(f.calls.length,0);});
test('status页数达标仍拒绝原文、身份、候选、provisional、质量或receipt变化',async()=>{for(const change of ['body','identity','candidate','provisional','quality','receipt','manifest','authorization']){let qualityBlocked=false;const f=fixture({inspect:text=>({status:qualityBlocked||!text?'blocked':'passed',issues:[]})});await initial(f);await f.runtime.finish();assert.equal(f.runtime.status().complete,true);const saved=f.workflow.reportCompletion.initialDelivery;if(change==='body')f.c.sections[0].content+='人工';if(change==='identity')f.setInput('v2');if(change==='candidate')f.c.sections[0].pendingRevision={after:'候选'};if(change==='provisional')saved.bindings['业务 / 明细'].provisional={text:'BAD'};if(change==='quality')qualityBlocked=true;if(change==='receipt')saved.run.pagination.receipt.documentSha256='b'.repeat(64);if(change==='manifest')saved.run.pagination.bodyManifest='changed';if(change==='authorization')f.plan.initialDeliveryAuthorization.authorized=false;assert.equal(f.runtime.status().complete,false,change);}});
test('status为只读拷贝，刷新后有效收据仍可读取，不能变造内部receipt',async()=>{const f=fixture();await initial(f);await f.runtime.finish();const before=JSON.stringify(f.workflow),fresh=R.createRuntime(f.ctx),status=fresh.status();assert.equal(status.complete,true);status.receipt.pages=999;assert.equal(fresh.status().pages,120);assert.equal(JSON.stringify(f.workflow),before);f.setTime(999999999);assert.equal(fresh.status().complete,true);});
test('实排95页且文字已超原目标仍能有依据展开，刷新汇总再实排',async()=>{let instruction='';const f=fixture({expansionEvidence:()=>[{kind:'confirmed-fact',source:'真实材料#p2'}],revise:async(c,s,prompt,source)=>{instruction=prompt;f.calls.push('revise:'+s.t);f.setPages(120);return source+'有依据的比较与条件行动';}});await initial(f);f.setPages(95);const end=await f.runtime.finish();assert.equal(end.complete,true);assert.match(instruction,/measuredPages.*95/);assert.match(instruction,/真实材料#p2/);assert.deepEqual(f.calls,['generate:汇总','revise:明细','generate:汇总']);assert.equal(end.run.additionalCalls,2);assert.equal(f.plan.sections[0].target,10);});
test('实排不足无可展开资料锚不得凑字继续付费',async()=>{const f=fixture({expansionEvidence:()=>[]});await initial(f);f.setPages(95);const end=await f.runtime.finish();assert.equal(end.complete,false);assert.equal(end.reason,'page-shortfall-needs-evidence');assert.deepEqual(f.calls,['generate:汇总']);});

// Use the real browser HTTP client, with a virtual clock and deterministic
// responses. No backend, provider or user data is accessed.
function actualClient(steps){
  let now=0,seq=0;const timers=new Map(),requests=[];
  const context={URLSearchParams,AbortController,TypeError,Error,Date:{now:()=>now},
    setTimeout(fn,delay){const id=++seq;timers.set(id,{at:now+delay,fn});return id;},clearTimeout:id=>timers.delete(id),
    async fetch(url,options){const step=steps[requests.length];requests.push({url,method:options.method,body:options.body});assert.ok(step,'unexpected request '+options.method+' '+url);if(step.throw)throw step.throw;return {ok:true,json:async()=>({ok:true,task:step.task})};}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../report-orchestration-client.js'),'utf8'),context);
  return {requests,async run(input,onTask,options){let done=false,result,error;context.ReportOrchestrationClient.generateSection(input,onTask,options).then(x=>{result=x;done=true;},e=>{error=e;done=true;});for(let n=0;!done&&n<500;n++){for(let i=0;i<40;i++)await Promise.resolve();if(!done&&timers.size){const [id,t]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];timers.delete(id);now=Math.max(now,t.at);t.fn();}}assert.equal(done,true);assert.equal(timers.size,0);if(error)throw error;return result;}};
}

test('真实client轮询断线携带taskId仍记uncertain，刷新后仅GET原任务，不再POST付费',async()=>{
  const f=fixture(),s=f.c.sections[0],task=backendTask(f),queued={...task,status:'running'},client=actualClient([
    {task:queued},...Array.from({length:3},()=>({throw:new TypeError('network disconnected')})),
    {task:{...queued,status:'completed',text:'恢复原任务的明细正文与条件行动',quality:{status:'passed',issues:[]}}}
  ]);
  await f.runtime.start({tasks:[{c:f.c,s}]});let failure;
  try{await client.run({sectionKey:'业务 / 明细',prompt:'mock'},t=>assert.equal(f.runtime.rememberTask(f.c,s,{...t,recoveryContext:task.recoveryContext}),true));}catch(e){failure=e;}
  assert.equal(failure.code,'REPORT_TASK_CONNECTION');assert.equal(failure.taskId,task.id);
  await f.runtime.recordGenerated(f.c,s,{error:failure});
  const permit=f.workflow.reportCompletion.initialDelivery.run.permits[0];assert.equal(permit.status,'uncertain');assert.deepEqual(permit.recoveryContext,task.recoveryContext);
  f.ctx.recover=async(c,s,recovery)=>(await client.run(null,null,{recovery})).text;
  const fresh=R.createRuntime(f.ctx),resumed=await fresh.start({tasks:[]});assert.equal(resumed.recoveries[0].taskId,task.id);
  const end=await fresh.finish();assert.equal(end.complete,true);assert.equal(s.content,'恢复原任务的明细正文与条件行动');
  assert.deepEqual(client.requests.map(r=>r.method),['POST','GET','GET','GET','GET']);assert.equal(client.requests.filter(r=>r.method==='POST').length,1);assert.deepEqual(f.calls,['generate:汇总']);
});

test('真实POST简短回执不触发rememberTask失败，完整GET才绑定原许可并保留一次调用',async()=>{
  const f=fixture(),s=f.c.sections[0],task=backendTask(f),complete={...task,status:'completed',text:'同一次后台返回的完整明细',quality:{status:'passed',issues:[]}};
  const client=actualClient([{task:{id:task.id,runId:task.runId,reused:false}},{task:complete}]);
  await f.runtime.start({tasks:[{c:f.c,s}]});let received=0;
  const result=await client.run({sectionKey:'业务 / 明细',prompt:'mock'},t=>{received++;assert.equal(f.runtime.rememberTask(f.c,s,{...t,recoveryContext:task.recoveryContext}),true);});
  assert.equal(result.text,complete.text);assert.equal(received,1);
  assert.deepEqual(client.requests.map(r=>r.method),['POST','GET']);
  const permit=f.workflow.reportCompletion.initialDelivery.run.permits[0];
  assert.equal(permit.taskId,task.id);assert.equal(permit.backendRunId,task.runId);assert.equal(permit.inputHash,'exact-input-hash');
  assert.equal(f.workflow.reportCompletion.initialDelivery.run.sections[0].firstCalls,1);
  assert.equal(s.content,'','接收任务信息不等于自动采用正文');
});

test('完成后的本地接收异常不冒称终态失败；只有后台明确终态失败才记failed',async()=>{
  for(const definite of [false,true]){const f=fixture(),s=f.c.sections[0];await f.runtime.start({tasks:[{c:f.c,s}]});const task=backendTask(f);assert.equal(f.runtime.rememberTask(f.c,s,task),true);
    const failure=Object.assign(new Error(definite?'backend failed':'local receive guard rejected'),{taskId:task.id,task:{...task,status:definite?'failed':'completed'},...(definite?{requestDefinitelyFailed:true}:{})});
    await f.runtime.recordGenerated(f.c,s,{error:failure});assert.equal(f.workflow.reportCompletion.initialDelivery.run.permits[0].status,definite?'failed':'uncertain');assert.equal(f.calls.length,0);assert.equal(s.content,'');
  }
});
