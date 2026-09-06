const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('report-orchestration-client.js','utf8');
test("浏览器编排客户端把上下文、任务、查询和反馈统一送入单一API",async()=>{
  const calls=[],oldFetch=global.fetch;
  global.fetch=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({ok:true})};};
  delete require.cache[require.resolve("../report-orchestration-client.js")];
  const client=require("../report-orchestration-client.js");
  try{
    await client.createContext({identity:{projectId:"p1"}});
    await client.createWorkflow("ctx1",{query:"生成可研"});
    await client.createQueryPlan("wf1",{purpose:"核实租金"});
    await client.createFeedback({projectId:"p1",change:{kind:"structure"}});
    assert.deepEqual(calls.map(x=>JSON.parse(x.options.body).action),["contextCreate","workflowCreate","queryPlanCreate","feedbackCreate"]);
    assert.ok(calls.every(x=>x.url==="/api/reportorchestration"));
  }finally{global.fetch=oldFetch;}
});
function client(responses){const calls=[];const context={AbortController,TypeError,URLSearchParams,Date,clearTimeout,setTimeout:(fn,ms)=>ms===1500?setTimeout(fn,0):setTimeout(fn,ms),fetch:async(url,options)=>{calls.push({url,options});const value=responses.shift();if(value instanceof Error)throw value;return {ok:value.ok!==false,json:async()=>value};}};vm.runInNewContext(source,context);return {api:context.ReportOrchestrationClient,calls};}
test('持久化客户端等待后台完成，仅提交一次并报告进度',async()=>{const c=client([{ok:true,task:{id:'a'}},{ok:true,task:{status:'running'}},{ok:true,task:{status:'completed',text:'正文'}}]),states=[];assert.equal((await c.api.generateSection({user:'test'},s=>states.push(s.status))).text,'正文');assert.equal(c.calls.filter(x=>x.options.method==='POST').length,1);assert.equal(states.length,3);});
test('恢复已有成果直接读取；规则失效和断网不显示成功',async()=>{const restored=client([{ok:true,task:{id:'a',reused:true}},{ok:true,task:{status:'completed',text:'已有正文'}}]);assert.equal((await restored.api.generateSection({})).text,'已有正文');const invalid=client([{ok:true,task:{id:'b'}},{ok:true,task:{status:'invalidated',error:'规则已回滚'}}]);await assert.rejects(()=>invalid.api.generateSection({}),/规则已回滚/);const offline=client([new TypeError('fetch failed')]);await assert.rejects(()=>offline.api.generateSection({}),/已有任务不会丢失/);});
