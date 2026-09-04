const test=require("node:test"),assert=require("node:assert/strict");

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
