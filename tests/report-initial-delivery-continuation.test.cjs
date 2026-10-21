require('../scripts/windows-browser-lockout-guard.cjs');
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const I=require('../report-initial-delivery.js');
const R=require('../report-initial-delivery-runtime.js');
const C=require('../report-completion-contract.js');
const copy=x=>JSON.parse(JSON.stringify(x));
const hash=async x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const body=s=>({content:String(s.content||''),editedHtml:s.editedHtml==null?null:String(s.editedHtml)});
const core='<h3>一、实施条件</h3><p>租金45元，租期5年。只有取得批准才实施，未经批准不得实施。【待补：批准日期】</p><table><tr><td>条件</td><td>保留原文</td></tr></table>';
function fixture(overrides={}){
  const oldTask={id:'original-a',runId:'original-run',graph:[{key:'context_snapshot',hash:'original-input'}],status:'completed'};
  const chapters=[{name:'业务',checked:true,sections:[{t:'明细甲',content:core+'<p>'+('具体比较及必要分析。'.repeat(90))+'</p>',executionTask:copy(oldTask)},{t:'明细乙',content:core+'<p>'+('同类条件与风险应对。'.repeat(90))+'</p>',executionTask:null},{t:'依据清单',content:'已核实的国家文件、市区文件、集团文件、项目文件。',executionTask:null},{t:'汇总',content:''}]}];
  const workflow={reportCompletion:{}},calls=[],saves=[],identity={projectId:'project-a',input:'input-a'};
  const plan={planId:'confirmed-p',planningPriority:'pages',proseTotal:530,targetPages:120,targetPageRange:{min:110,max:130},sections:chapters[0].sections.map((s,i)=>({key:'业务 / '+s.t,target:[200,200,50,80][i]}))};
  let runtime,pages=137,stop=false;
  const ctx={planner:I,chapters:()=>chapters,workflow:()=>workflow,plan:()=>plan,identity:()=>identity,contract:(c,s)=>({requirements:{basis:s.t==='依据清单'},requiredFacts:[]}),inspect:text=>({status:text?'passed':'unverified',issues:[]}),measure:text=>C.measure(text).proseCharacters,classify:(c,s)=>({summary:s.t==='汇总'}),capture:()=>({projectId:identity.projectId}),guard:async()=>{},save:async()=>{saves.push(copy(workflow));return {ok:true,remote:true};},hash,now:()=>1000,concurrency:()=>2,expansionEvidence:()=>[],canConverge:()=>true,canMeasureDetails:()=>true,bodyHash:()=>hash(chapters),readOriginalTask:async id=>{calls.push('GET:'+id);return {...copy(oldTask),text:'原生成文字可与已独立审读的现稿不同'};},finalizeDetails:async({ownedKeys,assertCurrent})=>{assert.deepEqual(ownedKeys.sort(),['业务 / 明细乙','业务 / 明细甲'].sort());await assertCurrent();return {changed:false,sectionKeys:[]};},generate:async()=>{throw new Error('existing-review-must-not-generate');},revise:async()=>{throw new Error('existing-review-must-not-revise');},converge:async(c,s,o)=>{
    await runtime.assertLengthConvergence(c,s,o);calls.push('AI:'+s.t);assert.ok(saves.some(x=>x.reportCompletion.initialDelivery?.run.permits.some(p=>p.id===o.permitId)));
    const task={id:'new-'+s.t,runId:'new-run',graph:[{key:'context_snapshot',hash:'new-input-'+s.t}],recoveryContext:{contract:{sectionKey:'业务 / '+s.t},generationInputIdentity:copy(identity),bodyAtStart:s.content,initialDraftSource:o.source}};
    assert.equal(runtime.rememberTask(c,s,task),true);s.executionTask=task;return core+'<p>有材料支持的比较、风险与行动保留。</p>';
  },validateConvergence:async(c,s,o)=>{await o.assertCurrent();calls.push('review:'+s.t);return {passed:true,factsPreserved:true,conditionsPreserved:true,analysisPreserved:true};},apply:async(c,s,text)=>{s.content=text;delete s.editedHtml;}};
  const paginate=scope=>async({assertCurrent,expectedPlanId})=>{await assertCurrent();calls.push('paginate:'+scope);const documentSha256='a'.repeat(64);return {planId:expectedPlanId,bodyHash:await ctx.bodyHash(),documentSha256,measurementScope:scope,receipt:{schemaVersion:'report-pagination-receipt-v2',documentSha256,pages,scope:'pagination-only',contentQualityCertified:false,versionsMatch:true,rulesVersion:'r',documentRulesVersion:'r',templateVersion:'t',documentTemplateVersion:'t',renderer:'WPS',rendererVersion:'12',checkedAt:'2026-10-13T00:00:00Z',validationStatus:pages>130?'over-page-limit':'within-page-limit'}};};
  ctx.paginateDetails=paginate('details-only');ctx.paginate=paginate('complete-document');Object.assign(ctx,overrides);runtime=R.createRuntime(ctx);
  async function request(){return {authorization:{authorized:true,purpose:'reviewed-existing-length-convergence',confirmationId:'explicit-user-review-a',confirmedAt:'2026-10-13T00:00:00Z',planId:plan.planId,identity:copy(identity)},sections:await Promise.all(chapters[0].sections.filter(s=>s.content||s.editedHtml).map(async s=>({key:'业务 / '+s.t,allowConverge:s.t!=='依据清单',bodyHash:await hash(body(s)),review:{sourceSha256:await hash(s.editedHtml||s.content),evidenceSha256:'b'.repeat(64),reference:'independent-full-read/result.json',reviewedAt:'2026-10-13T00:00:00Z',reviewer:'independent-full-read',conclusion:'accepted'},originalTask:s.executionTask?{id:s.executionTask.id,runId:s.executionTask.runId,inputHash:s.executionTask.graph[0].hash}:null})))};}
  return {runtime,ctx,chapters,workflow,plan,identity,calls,saves,request,setPages:n=>pages=n,refresh(){runtime=R.createRuntime(ctx);this.runtime=runtime;return runtime;},setStop:()=>stop=true,shouldContinue:()=>!stop};
}

test('普通start仍保护已有稿；缺省计划授权不能启动，显式接续不伪造初稿任务',async()=>{
  const f=fixture(),before=copy(f.chapters),request=await f.request();assert.equal((await f.runtime.start()).active,false);
  const start=await f.runtime.startReviewedContinuation(request);assert.equal(start.status,'detail-pagination');assert.equal(start.tasks.length,0);assert.equal(start.run.permits.length,0);assert.deepEqual(f.chapters,before);assert.equal(f.plan.initialDeliveryAuthorization,undefined);
  assert.deepEqual(f.calls,['GET:original-a']);assert.ok(start.run.sections.every(s=>s.firstCalls===0));
  assert.equal(start.run.sections[0].origin.kind,'reviewed-existing-body-with-task');assert.equal(start.run.sections[1].origin.kind,'reviewed-existing-body');assert.equal(start.run.sections[2].eligible,false);assert.equal(start.run.sections[3].eligible,false);
});
test('真正单节派发，未发节没有permit；刷新续同batch，不重复收费，也不冒充完整报告',async()=>{
  const f=fixture(),request=await f.request(),basis=copy(f.chapters[0].sections[2]),plan=copy(f.plan);await f.runtime.startReviewedContinuation(request);
  const first=await f.runtime.finish({maxDispatchedSections:1,allowedSectionKeys:['业务 / 明细乙']});assert.equal(first.reason,'dispatch-limit-reached');assert.equal(first.dispatchedSections,1);
  const run=f.workflow.reportCompletion.initialDelivery.run;assert.equal(run.lengthConvergence.actions.length,2);assert.deepEqual(run.permits.filter(p=>p.kind==='length-converge').map(p=>p.key),['业务 / 明细乙']);assert.ok(run.permits.every(p=>p.status==='completed'));
  const budget=copy(run.lengthConvergence.actions.find(a=>a.key==='业务 / 明细甲').referenceBudget),resumed=await f.refresh().startReviewedContinuation(request);assert.equal(resumed.resumed,true);
  const second=await f.runtime.finish({maxDispatchedSections:1,allowedSectionKeys:['业务 / 明细甲']});assert.equal(second.complete,false);assert.deepEqual(second.run.permits.find(p=>p.key==='业务 / 明细甲').referenceBudget,budget);
  const result=await f.runtime.finish();assert.equal(result.reason,'reviewed-continuation-finished');assert.equal(result.complete,false);assert.equal(f.runtime.status().complete,false);assert.deepEqual(f.chapters[0].sections[2],basis);assert.equal(f.chapters[0].sections[3].content,'');assert.deepEqual(f.plan,plan);
  assert.equal(f.calls.filter(x=>x.startsWith('AI:')).length,2);assert.equal(f.calls.filter(x=>x.startsWith('GET:')).length,1);
});
test('109页正文不按总字数硬压；接续不生成摘要也不假完成',async()=>{
  const f=fixture();f.setPages(109);await f.runtime.startReviewedContinuation(await f.request());const result=await f.runtime.finish();assert.equal(result.reason,'reviewed-convergence-not-needed');assert.equal(result.complete,false);assert.equal(f.calls.filter(x=>x.startsWith('AI:')).length,0);
});
test('确认缺失、身份/计划、body/source/evidence审读不匹配、依据扩权均在派发前拒绝',async()=>{
  const cases=[r=>r.authorization.authorized=false,r=>r.authorization.purpose='generate',r=>r.authorization.planId='different',r=>r.authorization.identity.projectId='other',r=>r.authorization.confirmedAt='bad',r=>r.sections.pop(),r=>r.sections.push(copy(r.sections[0])),r=>r.sections[0].bodyHash='c'.repeat(64),r=>r.sections[0].review.sourceSha256='c'.repeat(64),r=>r.sections[0].review.evidenceSha256='',r=>r.sections[0].review.reference='',r=>r.sections[0].review.conclusion='pending',r=>r.sections[0].originalTask=null,r=>r.sections[2].allowConverge=true];
  for(const change of cases){const f=fixture(),r=await f.request(),before=copy(f.chapters);change(r);await assert.rejects(f.runtime.startReviewedContinuation(r));assert.deepEqual(f.chapters,before);assert.equal(f.workflow.reportCompletion.initialDelivery,undefined);assert.equal(f.calls.filter(x=>x.startsWith('AI:')).length,0);}
});
test('原任务dead/未完成/id/run/hash错误及权限失效均拒绝，不以已审标记绕过',async()=>{
  for(const changed of [{status:'dead'},{status:'running'},{id:'other'},{runId:'other'},{graph:[{key:'context_snapshot',hash:'other'}]}]){
    const f=fixture({readOriginalTask:async()=>({id:'original-a',runId:'original-run',status:'completed',graph:[{key:'context_snapshot',hash:'original-input'}],...changed})});await assert.rejects(f.runtime.startReviewedContinuation(await f.request()),{code:'INITIAL_CONTINUATION_TASK'});assert.equal(f.workflow.reportCompletion.initialDelivery,undefined);
  }
  const f=fixture({guard:async()=>{throw new Error('permission revoked');}});await assert.rejects(f.runtime.startReviewedContinuation(await f.request()),/permission revoked/);assert.equal(f.calls.length,0);
});
test('正文可来自经完整审读的确定性修复；无现存task可保留显式历史task，不能混同原AI原文',async()=>{
  const f=fixture();f.chapters[0].sections[0].executionTask=null;const r=await f.request();r.sections[0].originalTask={id:'original-a',runId:'original-run',inputHash:'original-input'};await f.runtime.startReviewedContinuation(r);assert.deepEqual(f.calls,['GET:original-a']);assert.equal(f.workflow.reportCompletion.initialDelivery.run.sections[0].origin.originalExecutionTask,null);
});
test('GET/保存等待中修改正文、原任务、计划、身份、候选或锁定则停下',async()=>{
  for(const change of [f=>f.chapters[0].sections[0].content='人工新稿',f=>f.chapters[0].sections[0].executionTask.id='changed',f=>f.plan.proseTotal++,f=>f.identity.input='changed',f=>f.chapters[0].sections[1].pendingRevision={text:'candidate'},f=>f.chapters[0].sections[1].locked=true]){
    let f;f=fixture({readOriginalTask:async()=>{change(f);return {id:'original-a',runId:'original-run',status:'completed',graph:[{key:'context_snapshot',hash:'original-input'}]};}});const r=await f.request();await assert.rejects(f.runtime.startReviewedContinuation(r),{code:'INITIAL_CONTINUATION_CAS'});assert.equal(f.workflow.reportCompletion.initialDelivery,undefined);
  }
  let f;f=fixture({save:async()=>{f.chapters[0].sections[0].content='保存期间人工改稿';return {ok:true};}});await assert.rejects(f.runtime.startReviewedContinuation(await f.request()),{code:'INITIAL_CONTINUATION_CAS'});assert.equal(f.calls.filter(x=>x.startsWith('AI:')).length,0);
});
test('初始有候选、锁定、门禁阻断均不能接续，不能用审读结论掩盖',async()=>{
  for(const kind of ['candidate','locked','quality']){const f=fixture(kind==='quality'?{inspect:()=>({status:'blocked',issues:[]})}:{}),r=await f.request();if(kind==='candidate')f.chapters[0].sections[0].pendingRevision={};if(kind==='locked')f.chapters[0].sections[0].locked=true;await assert.rejects(f.runtime.startReviewedContinuation(r));assert.equal(f.workflow.reportCompletion.initialDelivery,undefined);}
});
test('同一接续刷新后当前稿或计划变了不能继续；原请求未知也不能改确认ID新开一轮',async()=>{
  for(const kind of ['body','plan']){const f=fixture(),r=await f.request();await f.runtime.startReviewedContinuation(r);if(kind==='body')f.chapters[0].sections[0].content+='人工编辑';else f.plan.proseTotal++;await assert.rejects(f.refresh().startReviewedContinuation(r));assert.equal(f.calls.filter(x=>x.startsWith('AI:')).length,0);}
  const f=fixture({converge:async()=>{throw new Error('POST outcome unknown');}}),r=await f.request();await f.runtime.startReviewedContinuation(r);await f.runtime.finish({maxDispatchedSections:1});r.authorization.confirmationId='new';await assert.rejects(f.runtime.startReviewedContinuation(r),{code:'INITIAL_CONTINUATION_PENDING'});assert.equal(f.workflow.reportCompletion.initialDelivery.run.permits.filter(p=>p.kind==='length-converge').length,1);
});
test('单节过滤/数量非法不创建许可，零派发可只准备，已发节不会成为重试目标',async()=>{
  const f=fixture();await f.runtime.startReviewedContinuation(await f.request());for(const options of [{maxDispatchedSections:-1},{maxDispatchedSections:1.5},{allowedSectionKeys:['unknown']},{allowedSectionKeys:['业务 / 明细甲','业务 / 明细甲']}])await assert.rejects(f.runtime.finish(options),{code:'INITIAL_DISPATCH_SELECTION'});
  assert.equal((await f.runtime.finish({maxDispatchedSections:0})).reason,'dispatch-limit-reached');assert.equal(f.workflow.reportCompletion.initialDelivery.run.permits.length,0);
  await f.runtime.finish({maxDispatchedSections:1,allowedSectionKeys:['业务 / 明细乙']});const count=f.workflow.reportCompletion.initialDelivery.run.permits.length;assert.equal((await f.runtime.finish({allowedSectionKeys:['业务 / 明细乙']})).reason,'dispatch-selection-exhausted');assert.equal(f.workflow.reportCompletion.initialDelivery.run.permits.length,count);
});
test('串行派发中用户停止时未发小节不预占permit，恢复时不会误报未知付费请求',async()=>{
  let f;f=fixture({concurrency:()=>1,validateConvergence:async(c,s,o)=>{await o.assertCurrent();f.setStop();return {passed:true,factsPreserved:true,conditionsPreserved:true,analysisPreserved:true};}});await f.runtime.startReviewedContinuation(await f.request());const result=await f.runtime.finish({shouldContinue:f.shouldContinue});assert.equal(result.reason,'user-stopped');assert.equal(result.run.permits.filter(p=>p.kind==='length-converge').length,1);assert.ok(result.run.permits.every(p=>p.status==='completed'));
});
test('精确收敛断言核source/permit/batch/预算全部字段和实际字数，不接受其他开放许可',async()=>{
  let f,checks=0;f=fixture({converge:async(c,s,o)=>{
    for(const mutate of [x=>x.source+='新增',x=>x.permitId='other',x=>x.idempotencyKey='other',x=>x.batchId='other',x=>x.referenceBudget.target++,x=>x.referenceBudget.actual++,x=>x.referenceBudget.extra=true,x=>x.referenceBudget.documentSha256='b'.repeat(64)]){const changed=copy(o);mutate(changed);await assert.rejects(f.runtime.assertLengthConvergence(c,s,changed));checks++;}
    await f.runtime.assertLengthConvergence(c,s,o);return core;
  }});await f.runtime.startReviewedContinuation(await f.request());await f.runtime.finish({maxDispatchedSections:1});assert.equal(checks,8);
  const c=f.chapters[0],s=c.sections[0];await assert.rejects(f.runtime.assertLengthConvergence(c,s,{source:s.content,permitId:'fake'}));
});
test('真实实排绑定丢失/变动时，不因许可仍开放而放宽预算',async()=>{
  for(const kind of ['document','pages','plan','sourceCount','scope','certified','version']){let f;f=fixture({converge:async(c,s,o)=>{
    const batch=f.workflow.reportCompletion.initialDelivery.run.lengthConvergence;
    if(kind==='document')batch.pagination.documentSha256='b'.repeat(64);if(kind==='pages')batch.pagination.pages=120;if(kind==='plan')batch.pagination.planId='other';if(kind==='scope')batch.pagination.measurementScope='full';if(kind==='certified')batch.pagination.receipt.contentQualityCertified=true;if(kind==='version')batch.pagination.receipt.documentTemplateVersion='other';if(kind==='sourceCount'){batch.actions.find(a=>a.key==='业务 / '+s.t).referenceBudget.actual++;f.workflow.reportCompletion.initialDelivery.run.permits.find(p=>p.id===o.permitId).referenceBudget.actual++;o.referenceBudget.actual++;}
    await assert.rejects(f.runtime.assertLengthConvergence(c,s,o),{code:'INITIAL_CONVERGENCE_BINDING'});throw Object.assign(new Error('known denied'),{requestDefinitelyFailed:true});
  }});await f.runtime.startReviewedContinuation(await f.request());const before=copy(f.chapters);await f.runtime.finish({maxDispatchedSections:1});assert.deepEqual(f.chapters,before);}
});
test('已审接续保存失败不生成；合法保存后单节收敛仍必须独立保真审查',async()=>{
  const failed=fixture({save:async()=>false});await assert.rejects(failed.runtime.startReviewedContinuation(await failed.request()),{code:'INITIAL_SAVE_FAILED'});assert.equal(failed.calls.filter(x=>x.startsWith('AI:')).length,0);
  const f=fixture({validateConvergence:async()=>({passed:true,factsPreserved:true,conditionsPreserved:false,analysisPreserved:true})});await f.runtime.startReviewedContinuation(await f.request());const before=f.chapters[0].sections[1].content;await f.runtime.finish({maxDispatchedSections:1,allowedSectionKeys:['业务 / 明细乙']});assert.equal(f.chapters[0].sections[1].content,before);assert.equal(f.workflow.reportCompletion.initialDelivery.run.permits.find(p=>p.key==='业务 / 明细乙').status,'failed');
});

test('完整已审范围分配预算，单节执行与全批同预算但绝不扩调用权限',async()=>{
  const full=fixture(),sample=fixture({finalizeDetails:async({ownedKeys,assertCurrent})=>{assert.deepEqual(ownedKeys,['业务 / 明细乙']);await assertCurrent();return {changed:false,sectionKeys:[]};}}),before=copy(sample.chapters),a=await full.request(),b=await sample.request();
  for(const request of [a,b])for(const s of request.sections)s.allowBudgetAllocation=s.allowConverge;
  for(const s of b.sections)s.allowConverge=s.key==='业务 / 明细乙';
  const fstart=await full.runtime.startReviewedContinuation(a),sstart=await sample.runtime.startReviewedContinuation(b);
  assert.equal(fstart.run.limits.maxAdditionalCalls,2);assert.equal(sstart.run.limits.maxAdditionalCalls,1);assert.deepEqual(sstart.run.sections.filter(s=>s.eligible).map(s=>s.key),['业务 / 明细乙']);
  await full.runtime.finish({maxDispatchedSections:1,allowedSectionKeys:['业务 / 明细乙']});await sample.runtime.finish({maxDispatchedSections:1});
  const fr=full.workflow.reportCompletion.initialDelivery.run,sr=sample.workflow.reportCompletion.initialDelivery.run;
  assert.deepEqual(sr.lengthConvergence.actions.map(s=>s.key),['业务 / 明细乙']);assert.deepEqual(sr.lengthConvergence.actions[0].referenceBudget,fr.lengthConvergence.actions.find(s=>s.key==='业务 / 明细乙').referenceBudget);
  assert.ok(sr.lengthConvergence.actions[0].referenceBudget.plannedBatchReduction>sr.lengthConvergence.actions[0].referenceBudget.actual-sr.lengthConvergence.actions[0].referenceBudget.target);
  await sample.runtime.finish();await sample.refresh().startReviewedContinuation(b);await sample.runtime.finish({allowedSectionKeys:['业务 / 明细甲']});
  assert.deepEqual(sample.calls.filter(x=>x.startsWith('AI:')),['AI:明细乙']);assert.deepEqual(sample.calls.filter(x=>x.startsWith('review:')),['review:明细乙']);assert.deepEqual(sample.chapters[0].sections[0],before[0].sections[0]);assert.deepEqual(sample.chapters[0].sections.slice(2),before[0].sections.slice(2));assert.equal(sr.additionalCalls,1);
});

test('预算范围仍必须完整审读，不能纳入依据、非法标记或反向扩执行权限',async()=>{
  for(const mutate of [r=>r.sections[0].allowBudgetAllocation='yes',r=>r.sections[0].allowBudgetAllocation=false,r=>r.sections[2].allowBudgetAllocation=true,r=>{r.sections[0].allowBudgetAllocation=true;r.sections[0].allowConverge=false;r.sections[0].review.sourceSha256='wrong';}]){
    const f=fixture(),request=await f.request();mutate(request);await assert.rejects(f.runtime.startReviewedContinuation(request));assert.equal(f.workflow.reportCompletion.initialDelivery,undefined);assert.equal(f.calls.filter(x=>x.startsWith('AI:')).length,0);
  }
});
