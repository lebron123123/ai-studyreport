require('../scripts/windows-browser-lockout-guard.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../report-import-ai.js');
const input=()=>({requestId:'saved-review-request',draftId:'isolated-draft',sourceHash:'a'.repeat(64),baseline:{working:[{blockId:'b1',text:'投资 100 万元。'}]},mode:'append',instruction:'补充客户分析',blocks:[{blockId:'b1',text:'投资 100 万元。',appendTexts:[{candidateId:'already-accepted',text:'已采用的客群分析。'}]}]});
const data=id=>({single_attempt:true,single_attempt_protocol:1,request_id:id,finish_reason:'stop',content:[{type:'text',text:JSON.stringify({edits:[{blockId:'b1',afterText:'【待补：目标客群访谈】'}],explanation:'已结合采用稿，需补资料。'})}]});
function fixture(extra={}) {
 const calls=[];let saved,owner='test-owner';
 const fetch=async(url,init)=>{calls.push({url,init});
  if(init.method==='GET'&&!String(url).includes('?'))return extra.capability ? extra.capability() : Response.json({capabilities:{single_attempt:true,single_attempt_protocol:1,durable_import_request_protocol:1}});
  if(init.method==='POST'){saved=JSON.parse(init.body);if(extra.post)return extra.post(saved,init);return Response.json({durable_import_request_protocol:1,request_id:saved.request_id,binding:saved.binding,status:'completed',retry_allowed:false,result:data(saved.request_id)});}
  if(extra.get)return extra.get(url,init,saved);
  return Response.json({durable_import_request_protocol:1,request_id:saved.request_id,binding:saved.binding,status:'completed',retry_allowed:false,result:data(saved.request_id)});
 };
 return {calls,api:create({fetch,authHeaders:()=>({Authorization:'Bearer isolated'}),getOwner:()=>owner,timeoutMs:extra.timeoutMs}),owner:value=>{owner=value;}};
}
test('产品默认持久API绑定已保存编号和完整上下文，已采用补充进入单次请求',async()=>{
 const f=fixture(),source=input(),before=JSON.stringify(source),result=await f.api.generate(source);
 assert.deepEqual(f.calls.map(c=>[c.url,c.init.method]),[['/api/reportimportrequest','GET'],['/api/reportimportrequest','POST']]);
 const body=JSON.parse(f.calls[1].init.body);assert.equal(body.request_id,source.requestId);assert.equal(body.generation.request_id,source.requestId);assert.match(body.binding.contextHash,/^[a-f0-9]{64}$/);
 assert.deepEqual(JSON.parse(body.generation.messages[0].content).blocks[0].appendTexts,source.blocks[0].appendTexts);assert.match(body.generation.system,/不得重复这些内容/);assert.equal(result.meta.requestId,source.requestId);assert.equal(JSON.stringify(source),before);
});
test('缺少已保存请求ID时不退回generate、无收费请求',async()=>{
 const f=fixture(),source=input();delete source.requestId;await assert.rejects(f.api.generate(source),e=>e.code==='INVALID'&&e.posted===false);assert.equal(f.calls.length,0);
});
test('浏览器等候超时后只GET恢复完整候选，POST保持一次',async()=>{
 const f=fixture({timeoutMs:15,post:()=>new Promise(()=>{})});await assert.rejects(f.api.generate(input()),e=>e.code==='TIMEOUT'&&e.posted===true&&e.outcomeUnknown===true);
 const recovered=await f.api.recover(input());assert.equal(recovered.edits[0].blockId,'b1');assert.equal(f.calls.filter(c=>c.init.method==='POST').length,1);assert.match(f.calls.at(-1).url,/^\/api\/reportimportrequest\?id=saved-review-request&/);
});
test('running/unknown/未登记均只回查，不触发新的POST',async t=>{
 for(const status of ['running','outcome_unknown','missing'])await t.test(status,async()=>{
  const f=fixture({get:(url)=>{const p=new URL(url,'http://test').searchParams;if(status==='missing')return Response.json({code:'NOT_FOUND',error:'旧请求不存在，禁止自动补发'},{status:404});return Response.json({durable_import_request_protocol:1,request_id:p.get('id'),binding:{draftId:p.get('draftId'),sourceHash:p.get('sourceHash'),contextHash:p.get('contextHash')},retry_allowed:false,status});}});
  await assert.rejects(f.api.recover(input()),e=>e.code===({running:'PENDING',outcome_unknown:'OUTCOME_UNKNOWN',missing:'NOT_FOUND'})[status]);assert.equal(f.calls.length,1);assert.equal(f.calls[0].init.method,'GET');
 });
});
test('回执绑定不符、返回范围错误及账号切换都不返回候选',async t=>{
 await t.test('回执绑定',async()=>{const f=fixture({post:b=>Response.json({durable_import_request_protocol:1,request_id:b.request_id,binding:{...b.binding,sourceHash:'different'},status:'completed',retry_allowed:false,result:data(b.request_id)})});await assert.rejects(f.api.generate(input()),e=>e.code==='PROTOCOL');assert.equal(f.calls.length,2);});
 await t.test('恢复时账号变化',async()=>{let release,started;const began=new Promise(r=>{started=r;});const f=fixture({get:()=>new Promise(r=>{release=r;started();})});const pending=f.api.recover(input());await began;f.owner('other');release(Response.json({}));await assert.rejects(pending,e=>e.code==='AUTH_CHANGED');assert.equal(f.calls.length,1);});
});
test('回查取消立即结束，不等伪造fetch回执，不POST',async()=>{
 const controller=new AbortController();let started;const began=new Promise(r=>{started=r;});const f=fixture({get:()=>{started();return new Promise(()=>{});}});
 const pending=f.api.recover({...input(),signal:controller.signal});await began;controller.abort();await assert.rejects(pending,e=>e.code==='ABORTED');assert.equal(f.calls.length,1);
});
test('此前补充也计入12000字边界，不会静默截断或先POST',async()=>{
 const source=input();source.blocks[0].appendTexts[0].text='字'.repeat(12000);const f=fixture();await assert.rejects(f.api.generate(source),e=>e.code==='INVALID');assert.equal(f.calls.length,0);
});

test('可信准入拒绝确认本次未派发，保留一次POST且不会自动重试',async()=>{
 const f=fixture({post:()=>Response.json({code:'ADMISSION_NOT_DISPATCHED',durable_import_request_protocol:1,no_dispatch:true,confirmedNoCharge:true,error:'队列已满'},{status:429})});
 await assert.rejects(f.api.generate(input()),e=>e.code==='ADMISSION_NOT_DISPATCHED'&&e.posted===true&&e.confirmedNoCharge===true&&e.outcomeUnknown===false);
 assert.equal(f.calls.filter(c=>c.init.method==='POST').length,1);
});

test('普通错误或不完整未派发声明均不能释放未知结果',async t=>{
 const trusted={code:'ADMISSION_NOT_DISPATCHED',durable_import_request_protocol:1,no_dispatch:true,confirmedNoCharge:true,error:'不可用'};
 for(const [name,body,status] of [['普通500',{error:'模型错误',confirmedNoCharge:true},500],['缺协议',{...trusted,durable_import_request_protocol:undefined},503],['缺未派发',{...trusted,no_dispatch:undefined},429],['不同错误',{...trusted,code:'MODEL_ERROR'},503],['非准入状态',trusted,500]])await t.test(name,async()=>{
  const f=fixture({post:()=>Response.json(body,{status})});await assert.rejects(f.api.generate(input()),e=>e.posted===true&&e.confirmedNoCharge!==true&&e.outcomeUnknown===true);assert.equal(f.calls.filter(c=>c.init.method==='POST').length,1);
 });
});

test('能力检查单独限时，模型120秒结束后的回执仍可接收且只POST一次',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let startCapability,releaseCapability,startPost,releasePost,settled=false;
 const capabilityStarted=new Promise(r=>{startCapability=r;}),postStarted=new Promise(r=>{startPost=r;});
 const f=fixture({capability:()=>{startCapability();return new Promise(r=>{releaseCapability=r;});},post:body=>{startPost();return new Promise(r=>{releasePost=()=>r(Response.json({durable_import_request_protocol:1,request_id:body.request_id,binding:body.binding,status:'completed',retry_allowed:false,result:data(body.request_id)}));});}});
 const pending=f.api.generate(input());pending.then(()=>{settled=true;},()=>{settled=true;});
 await capabilityStarted;t.mock.timers.tick(10000);
 releaseCapability(Response.json({capabilities:{single_attempt:true,single_attempt_protocol:1,durable_import_request_protocol:1}}));
 await postStarted;t.mock.timers.tick(120001);await Promise.resolve();assert.equal(settled,false);
 releasePost();assert.equal((await pending).edits[0].blockId,'b1');assert.equal(f.calls.filter(c=>c.init.method==='POST').length,1);
});

test('能力检查15秒无响应即结束，尚未产生POST或计费声明',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let started;const began=new Promise(r=>{started=r;});
 const f=fixture({capability:()=>{started();return new Promise(()=>{});}}),pending=f.api.generate(input());
 const assertion=assert.rejects(pending,e=>e.code==='TIMEOUT'&&e.posted===false&&e.outcomeUnknown===false);
 await began;t.mock.timers.tick(15001);await assertion;assert.equal(f.calls.filter(c=>c.init.method==='POST').length,0);
});

test('未知回执区分响应头、保活空行和旧版超时，但均不宣称未收费或重试',async t=>{
 for(const [result,message] of [
  [{upstream_diagnostics:{code:'LLM_TIMEOUT',phase:'awaiting_headers',http_status:null,received_bytes:0,received_non_whitespace:false}},/未返回响应头/],
  [{upstream_diagnostics:{code:'LLM_TIMEOUT',phase:'receiving_body',http_status:200,received_bytes:2,received_non_whitespace:false}},/只收到保活空行/],
  [{upstream_diagnostics:{code:'LLM_TIMEOUT',phase:'receiving_body',http_status:200,received_bytes:0,received_non_whitespace:false}},/未返回完整候选/],
  [{error:'上游AI接口连接失败：deepseek-cloud响应超过120000ms'},/未返回完整候选/],
  [{upstream_diagnostics:{code:'LLM_UPSTREAM_HTTP',http_status:503}},/HTTP 503/]
 ])await t.test(String(message),async()=>{
  const f=fixture({post:body=>Response.json({durable_import_request_protocol:1,request_id:body.request_id,binding:body.binding,status:'outcome_unknown',retry_allowed:false,result})});
  await assert.rejects(f.api.generate(input()),e=>e.code==='OUTCOME_UNKNOWN'&&e.outcomeUnknown===true&&message.test(e.message)&&/费用待核对/.test(e.message));
  assert.equal(f.calls.filter(c=>c.init.method==='POST').length,1);
 });
});
