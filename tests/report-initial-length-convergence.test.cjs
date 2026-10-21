require('../scripts/windows-browser-lockout-guard.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {webcrypto,createHash}=require('node:crypto');
const report=fs.readFileSync(require.resolve('../report.js'),'utf8');
const code=report.slice(report.indexOf('// A length-only edit'),report.indexOf('// 按用户修改意见改写小节'));
const client=fs.readFileSync(require.resolve('../report-orchestration-client.js'),'utf8');
const copy=value=>JSON.parse(JSON.stringify(value)),hash=text=>createHash('sha256').update(text).digest('hex');
const original='<h3>经营边界</h3><p>若消防未落实不得开业。历史租金75元，不能当当前成交价。</p><table><tr><td rowspan="2">甲</td><td>75</td></tr><tr><td>待核</td></tr></table>';
function fixture(){
  const s={t:'风险分析',content:original,editedHtml:null,pendingRevision:null,executionTask:{id:'generation-task',runId:'generation-run',status:'completed'},completionContract:{sectionKey:'运营 / 风险分析',planId:'current-plan'}};
  const c={name:'运营',sections:[s]},calls=[],saved=[],durable=[];
  let latest=null,currentInput='current-input',handler=null,saveHook=null,checkHook=null;
  const f={c,s,calls,saved,durable};
  const ctx={TextEncoder,Uint8Array,AbortController,URLSearchParams,TypeError,setTimeout,clearTimeout,crypto:webcrypto,
    chapters:[c],currentProjectId:'[系统测试]convergence',projectWorkflow:{management:{legacyResearchEpoch:0}},
    rlProjectType:()=> 'gaibao-housing',reportCandidateInputIdentity:()=>currentInput,
    ReportLogicCore:{load:async()=>{},current:()=>({version:7})},
    ReportInitialDeliveryRuntime:{assertDraftSource:async(_c,_s,source)=>{if(source!==original)throw Error('原文已变化');},assertLengthConvergence:async(_c,_s,value)=>{if(value.source!==original||value.permitId!=='permit-1'||value.idempotencyKey!=='idempotency-1'||value.batchId!=='batch-1')throw Error('原文或许可已变化');}},
    reportCaptureGenerationContext:info=>({info,projectId:ctx.currentProjectId,research:null,body:s.editedHtml||s.content,pending:s.pendingRevision,locked:s.locked}),
    reportCheckGenerationContext:context=>{if(context.projectId!==ctx.currentProjectId||context.body!==(s.editedHtml||s.content)||context.pending!==s.pendingRevision||context.locked!==s.locked)throw Error('原稿或项目已变化');},
    reportDurableSectionCall:async(...args)=>{durable.push(args);return '专用收敛结果';},
    fetch:async(url,options)=>{const call={url,method:options.method,payload:options.body?JSON.parse(options.body):null};calls.push(call);if(handler)return handler(call);if(call.method==='POST'){f.input=call.payload;return response({id:'review-task',runId:'review-run'});}return response(completed());}
  };
  ctx.window=ctx;vm.createContext(ctx);vm.runInContext(client+'\n'+code,ctx);
  function completed(overrides={}){
    const binding=f.input?JSON.parse(f.input.user).binding:latest.binding;
    return {id:'review-task',runId:'review-run',status:'completed',graph:[{key:'context_snapshot',hash:'immutable-review-input'}],
      text:JSON.stringify({version:'initial-length-preservation-v1',sectionKey:binding.sectionKey,sourceHash:binding.sourceHash,textHash:binding.textHash,passed:true,factsPreserved:true,conditionsPreserved:true,analysisPreserved:true,factsVerified:false,findings:[]}),...overrides};
  }
  function response(task){return {ok:true,json:async()=>({ok:true,task})};}
  f.ctx=ctx;f.completed=completed;f.response=response;
  f.options=()=>({source:original,text:original,instruction:'同一业务标题内合并冗余，不删独立分析',referenceBudget:{referenceOnly:true,target:1200,actual:1700,min:1000},permitId:'permit-1',idempotencyKey:'idempotency-1',batchId:'batch-1',
    assertCurrent:async()=>{if(checkHook)await checkHook();return true;},
    retainReviewState:async state=>{if(saveHook){const result=await saveHook(state);if(result===false||result?.ok===false)return result;}latest=copy(state);saved.push(copy(state));return {ok:true};}});
  f.run=options=>ctx.reportValidateInitialLengthConvergence(c,s,{...f.options(),...options});
  f.generate=options=>ctx.reportConvergeInitialDeliverySection(c,s,{...f.options(),...options});
  f.latest=()=>copy(latest);f.setHandler=fn=>handler=fn;f.setSave=fn=>saveHook=fn;f.setCheck=fn=>checkHook=fn;f.setIdentity=value=>currentInput=value;
  return f;
}
const stateBefore=f=>JSON.stringify(f.s);
test('专用收敛只走原持久化生成，显式禁自动返修且完整携带原文及参考预算',async()=>{
  const f=fixture(),before=stateBefore(f);assert.equal(await f.generate(),'专用收敛结果');
  const [c,s,system,user,onChunk,options]=f.durable[0];assert.equal(c,f.c);assert.equal(s,f.s);assert.equal(onChunk,null);
  assert.equal(options.autoRepair,false);assert.equal(options.initialDraftSource,original);assert.equal(JSON.parse(user).source,original);
  assert.match(system,/不是补字、扩写或摘要/);assert.match(system,/不要求逐段原样保留并追加/);assert.equal(stateBefore(f),before);assert.equal(f.calls.length,0);
});
test('无许可或非法预算不请求生成或审核',async t=>{
  for(const change of [{permitId:''},{batchId:null},{source:''},{referenceBudget:{referenceOnly:false,target:1200,actual:1700,min:1000}},{referenceBudget:{referenceOnly:true,target:1200,actual:900,min:1000}}])await t.test(JSON.stringify(change),async()=>{const f=fixture();await assert.rejects(f.generate(change));await assert.rejects(f.run(change));assert.equal(f.calls.length,0);assert.equal(f.durable.length,0);});
});
test('同字节也必须真正独立全文审核；意图在POST前持久化，原任务/正文/候选/合同不动',async()=>{
  const f=fixture(),before=stateBefore(f);f.setHandler(call=>{if(call.method==='POST'){assert.equal(f.saved[0].requestIntent.status,'intent-saved');assert.equal(f.saved[0].task,null);f.input=call.payload;return f.response({id:'review-task',runId:'review-run'});}return f.response(f.completed());});
  const result=await f.run();assert.equal(result.passed,true);assert.equal(result.factsVerified,false);assert.equal(result.reviewTask.taskId,'review-task');
  assert.deepEqual(f.calls.map(c=>c.method),['POST','GET']);assert.equal(stateBefore(f),before);
  const input=JSON.parse(f.input.user);assert.equal(input.source,original);assert.equal(input.text,original);assert.equal(input.binding.originalExecutionTask.id,'generation-task');
  assert.equal(input.binding.sourceHash,hash(original));assert.equal(input.binding.textHash,hash(original));assert.equal(f.input.qualityContract,undefined);
  assert.match(f.input.system,/逐段完整阅读两份全文/);assert.equal(result.reviewResponseHash,hash(f.latest().rawResponse));assert.equal(f.latest().status,'passed');
});
test('严格JSON不接受缺字段、额外字段、findings、事实已核实或任何保全失败',async t=>{
  const mutations={missing:r=>delete r.analysisPreserved,extra:r=>r.summary='通过',findings:r=>r.findings.push('条件丢失'),facts:r=>r.factsVerified=true,passed:r=>r.passed=false,conditions:r=>r.conditionsPreserved=false,analysis:r=>r.analysisPreserved=false,hash:r=>r.sourceHash='wrong',key:r=>r.sectionKey='其他 / 节'};
  for(const [name,mutate] of Object.entries(mutations))await t.test(name,async()=>{const f=fixture(),before=stateBefore(f);f.setHandler(call=>{if(call.method==='POST'){f.input=call.payload;return f.response({id:'review-task',runId:'review-run'});}const task=f.completed(),r=JSON.parse(task.text);mutate(r);task.text=JSON.stringify(r);return f.response(task);});await assert.rejects(f.run(),e=>e.code==='INITIAL_CONVERGENCE_REVIEW_REJECTED'&&e.requestDefinitelyFailed===true&&e.taskId===undefined&&e.reviewTaskId==='review-task');assert.equal(stateBefore(f),before);assert.ok(f.latest().rawResponse);assert.equal(f.calls.filter(c=>c.method==='POST').length,1);});
  await t.test('markdown JSON',async()=>{const f=fixture();f.setHandler(call=>{if(call.method==='POST'){f.input=call.payload;return f.response({id:'review-task',runId:'review-run'});}return f.response(f.completed({text:'```json\n{}\n```'}));});await assert.rejects(f.run(),e=>e.code==='INITIAL_CONVERGENCE_REVIEW_JSON');});
  for(const key of ['passed','pa\\u0073sed'])await t.test('duplicate '+key,async()=>{const f=fixture();f.setHandler(call=>{if(call.method==='POST'){f.input=call.payload;return f.response({id:'review-task',runId:'review-run'});}const task=f.completed();task.text=task.text.replace('"passed":true','"'+key+'":false,"passed":true');return f.response(task);});await assert.rejects(f.run(),e=>e.code==='INITIAL_CONVERGENCE_REVIEW_JSON'&&e.requestDefinitelyFailed===true);assert.ok(f.latest().rawResponse);});
});
test('POST未知仅保留意图：刷新不能再POST，错误不把reviewTask伪装成原generation task',async()=>{
  const f=fixture(),before=stateBefore(f);f.setHandler(()=>{throw new TypeError('response lost');});
  await assert.rejects(f.run(),e=>e.recoveryPending===true&&e.taskId===undefined&&e.task===undefined);
  const state=f.latest();assert.equal(state.task,null);await assert.rejects(f.run({reviewState:state}),e=>e.code==='INITIAL_CONVERGENCE_REVIEW_UNKNOWN');
  assert.equal(f.calls.length,1);assert.equal(stateBefore(f),before);
});
test('已知ack丢失首次轮询后刷新仅GET补快照哈希，再GET恢复原任务',async()=>{
  const f=fixture();let failed=false;f.setHandler(call=>{if(call.method==='POST'){f.input=call.payload;return f.response({id:'review-task',runId:'review-run'});}if(!failed){failed=true;return {ok:false,json:async()=>({ok:false,error:'gateway unavailable'})};}return f.response(f.completed());});
  await assert.rejects(f.run(),e=>e.recoveryPending===true&&e.reviewTaskId==='review-task');const state=f.latest();assert.equal(state.task.inputHash,null);
  const result=await f.run({reviewState:state});assert.equal(result.passed,true);assert.deepEqual(f.calls.map(c=>c.method),['POST','GET','GET','GET']);
});

test('审查启动回执独立保存后才GET，保存失败保留任务且不继续请求',async()=>{
  const f=fixture();f.setHandler(call=>{
    if(call.method==='POST'){f.input=call.payload;return f.response({id:'review-task',runId:'review-run'});}
    assert.equal(f.latest().task.taskId,'review-task');assert.equal(f.latest().task.inputHash,null);
    return f.response(f.completed());
  });
  await f.run();assert.deepEqual(f.calls.map(c=>c.method),['POST','GET']);
  const stopped=fixture();stopped.setSave(state=>state.task?{ok:false}:{ok:true});
  await assert.rejects(stopped.run(),e=>e.code==='INITIAL_CONVERGENCE_REVIEW_SAVE'&&e.reviewTaskId==='review-task'&&e.recoveryPending===true);
  assert.deepEqual(stopped.calls.map(c=>c.method),['POST']);assert.equal(stopped.s.content,original);
});
test('已完成记录刷新仍以原task GET复核，不直接用本地passed替代审核',async()=>{
  const f=fixture();await f.run();const state=f.latest(),before=f.calls.length;await f.run({reviewState:state});assert.deepEqual(f.calls.slice(before).map(c=>c.method),['GET']);
});
test('后台终止、身份或规则变化均不创建第二个付费任务',async t=>{
  const changes={failed:{status:'failed',error:'stopped'},run:{runId:'foreign-run'},id:{id:'foreign-task'},rules:{rulesChanged:true},hash:{graph:[{key:'context_snapshot',hash:'changed'}]}};
  for(const [name,change] of Object.entries(changes))await t.test(name,async()=>{const f=fixture();await f.run();const state=f.latest(),before=stateBefore(f);f.setHandler(()=>f.response(f.completed(change)));await assert.rejects(f.run({reviewState:state}));assert.equal(f.calls.filter(c=>c.method==='POST').length,1);assert.equal(stateBefore(f),before);});
});
test('已绑定终止审查是明确失败，仍保留独立review身份；不是未知付费',async t=>{
  for(const status of ['dead','failed','cancelled','invalidated','missing'])await t.test(status,async()=>{const f=fixture();await f.run();const state=f.latest(),before=stateBefore(f);f.setHandler(()=>f.response(f.completed({status,error:'review stopped'})));await assert.rejects(f.run({reviewState:state}),e=>e.requestDefinitelyFailed===true&&!e.recoveryPending&&e.reviewTaskId==='review-task'&&e.taskId===undefined&&e.task===undefined);assert.equal(stateBefore(f),before);assert.equal(f.calls.filter(c=>c.method==='POST').length,1);});
});
test('恢复绑定全文、原任务、许可、预算、真实输入任一变化拒绝且无请求',async t=>{
  for(const name of ['source','text','permit','budget','task','input','intent'])await t.test(name,async()=>{const f=fixture();await f.run();const state=f.latest(),options={reviewState:state};
    if(name==='source')state.source+='改变';if(name==='text')options.text+='改变';if(name==='permit')options.permitId='new-permit';if(name==='budget')options.referenceBudget={...f.options().referenceBudget,target:1250};if(name==='task')f.s.executionTask.id='other';if(name==='input')f.setIdentity('new-input');if(name==='intent')delete state.requestIntent;
    const before=f.calls.length;await assert.rejects(f.run(options),e=>e.code==='INITIAL_CONVERGENCE_REVIEW_BINDING');assert.equal(f.calls.length,before);
  });
});
test('保存意图失败不POST；保存任务/原始响应失败不pass，不改变正文',async t=>{
  await t.test('intent',async()=>{const f=fixture();f.setSave(()=>({ok:false}));await assert.rejects(f.run(),e=>e.code==='INITIAL_CONVERGENCE_REVIEW_SAVE');assert.equal(f.calls.length,0);});
  await t.test('task',async()=>{const f=fixture(),before=stateBefore(f);f.setSave(state=>state.task?{ok:false}:{ok:true});await assert.rejects(f.run(),e=>e.code==='INITIAL_CONVERGENCE_REVIEW_SAVE');assert.equal(stateBefore(f),before);assert.equal(f.calls.filter(c=>c.method==='POST').length,1);});
});
test('任一await期间正文/任务/合同/项目/候选/真实输入变更拒绝结果',async t=>{
  const changes={body:f=>f.s.content+='changed',task:f=>f.s.executionTask.id='new',contract:f=>f.s.completionContract.planId='new',project:f=>f.ctx.currentProjectId='other',candidate:f=>f.s.pendingRevision={after:'new candidate'},input:f=>f.setIdentity('other')};
  for(const [name,change] of Object.entries(changes))await t.test(name,async()=>{const f=fixture();f.setHandler(call=>{if(call.method==='POST'){f.input=call.payload;return f.response({id:'review-task',runId:'review-run'});}const result=f.completed();change(f);return f.response(result);});await assert.rejects(f.run());assert.equal(f.calls.filter(c=>c.method==='POST').length,1);assert.equal(f.s.editedHtml,null);});
});
test('最后response hash await后仍重查CAS，不把过期通过返回runtime',async()=>{
  const f=fixture();let digests=0;f.ctx.crypto={subtle:{digest:async(...args)=>{const result=await webcrypto.subtle.digest(...args);if(++digests===3)f.s.executionTask.id='late-task';return result;}}};
  await assert.rejects(f.run(),e=>e.code==='INITIAL_CONVERGENCE_REVIEW_CAS');assert.equal(f.s.content,original);
});
test('相同permit并发审核仅有一个POST；运行完成后可安全GET恢复',async()=>{
  const f=fixture();let release,entered;const ready=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
  f.setHandler(async call=>{if(call.method==='POST'){f.input=call.payload;entered();await gate;return f.response({id:'review-task',runId:'review-run'});}return f.response(f.completed());});
  const running=f.run();await ready;await assert.rejects(f.run(),e=>e.code==='INITIAL_CONVERGENCE_REVIEW_BUSY');release();await running;assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
});
