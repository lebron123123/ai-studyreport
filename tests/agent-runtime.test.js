const test=require("node:test");
const assert=require("node:assert/strict");
const path=require("node:path");
const {pathToFileURL}=require("node:url");

test("Agent工具契约会规范化风险、审批和超时",async()=>{
  const m=await import(pathToFileURL(path.resolve(__dirname,"../functions/api/_agent-contracts.js")).href);
  const destructive=m.normalizeAgentTool("delete_project",{risk:"destructive",timeoutMs:999999});
  assert.equal(destructive.requiresApproval,true);
  assert.equal(destructive.timeoutMs,120000);
  assert.equal(destructive.toolset,"system");
  const read=m.normalizeAgentTool("search",{risk:"read",toolset:"knowledge"});
  assert.equal(read.requiresApproval,false);
  assert.equal(read.idempotent,true);
});

test("四层上下文只将明确状态、规则和已审核技能注入提示词",async()=>{
  const m=await import(pathToFileURL(path.resolve(__dirname,"../functions/api/_agent-contracts.js")).href);
  const layers=m.buildAgentContextLayers({projectId:"p1",state:{stage:"review"},rules:["数字必须来自测算引擎"],skills:["逐节材料核查"]});
  const prompt=m.contextLayersToPrompt(layers);
  assert.match(prompt,/当前任务状态/);
  assert.match(prompt,/数字必须来自测算引擎/);
  assert.match(prompt,/逐节材料核查/);
  assert.equal(layers.working.projectId,"p1");
});

test("项目上下文只注入固定身份、版本与审批摘要",async()=>{
  const m=await import(pathToFileURL(path.resolve(__dirname,"../functions/api/_agent-contracts.js")).href);
  const layers=m.buildAgentContextLayers({projectContext:{contextId:"ctx1",contextHash:"sha256:abc",identity:{projectId:"p1"},scenario:{projectType:"非居改保"},versions:{report:"v2"},focus:{chapterId:"10"},governance:{approvalStatus:"review"},largePayload:{ignored:true}}});
  const prompt=m.contextLayersToPrompt(layers);
  assert.equal(layers.working.projectId,"p1");assert.match(prompt,/ctx1/);assert.match(prompt,/sha256:abc/);assert.doesNotMatch(prompt,/largePayload/);
});

test("AgentCore把模型轮次、工具步骤、检查点和完成状态写入运行账本",async()=>{
  const oldWindow=global.window, oldFetch=global.fetch;
  const calls=[]; let generateRound=0;
  global.window={authHeaders:()=>({Authorization:"Bearer test"})};
  global.fetch=async(url,opt={})=>{
    const body=opt.body?JSON.parse(opt.body):{};
    calls.push({url,body});
    if(url==="/api/agentruns"){
      if(body.action==="create") return response({ok:true,run:{id:"run_test"}});
      if(body.action==="step") return response({ok:true,step:{stepNo:calls.filter(x=>x.url==="/api/agentruns"&&x.body.action==="step").length}});
      return response({ok:true});
    }
    if(url==="/api/generate"){
      generateRound++;
      if(generateRound===1) return response({content:[],tool_calls:[{id:"tc1",function:{name:"lookup",arguments:'{"q":"坪山"}'}}]});
      return response({content:[{text:"已根据正式快照完成分析。"}]});
    }
    if(url==="/api/agent") return response({ok:true,memory:[]});
    throw new Error("unexpected url "+url);
  };
  delete require.cache[require.resolve("../agent-core.js")];
  const core=require("../agent-core.js");
  core.registerTool("lookup",{risk:"read",toolset:"report",schema:{type:"function",function:{name:"lookup",parameters:{type:"object",properties:{q:{type:"string"}}}}},run:async()=>"正式快照：坪山区",validate:()=>({ok:true})});
  const visibleTrace=[];
  const out=await core.run({system:"test",messages:[{role:"user",content:"分析"}],tools:["lookup"],traceQuery:"分析",useMemory:false,selfCheck:false,maxRounds:3,contextLayers:{projectContext:{contextId:"ctx_runtime",contextHash:"sha256:runtime",identity:{projectId:"p1"}}},onTrace:lines=>visibleTrace.push(lines.slice())});
  assert.equal(out.runId,"run_test");
  assert.equal(out.text,"已根据正式快照完成分析。");
  assert.ok(calls.some(x=>x.body.action==="checkpoint"));
  assert.ok(calls.some(x=>x.body.action==="complete"));
  assert.equal(calls.find(x=>x.body.action==="create").body.input.contextId,"ctx_runtime");
  assert.equal(out.toolCalls[0].risk,"read");
  assert.match(out.trace.join("\n"),/正在理解/);
  assert.match(out.trace.join("\n"),/正在判断/);
  assert.ok(visibleTrace.length>=2,"Agent运行时应持续向界面推送处理阶段");
  global.window=oldWindow; global.fetch=oldFetch;
});

test("高风险工具未获确认时不会执行并生成审批记录",async()=>{
  const oldWindow=global.window, oldFetch=global.fetch;
  let executed=0, approvalCreated=false, round=0;
  global.window={authHeaders:()=>({})};
  global.fetch=async(url,opt={})=>{
    const body=opt.body?JSON.parse(opt.body):{};
    if(url==="/api/agentruns"){
      if(body.action==="create") return response({ok:true,run:{id:"run_approval"}});
      if(body.action==="approvalCreate") approvalCreated=true;
      return response({ok:true});
    }
    if(url==="/api/generate"){
      round++;
      if(round===1)return response({content:[],tool_calls:[{id:"d1",function:{name:"remove_case",arguments:"{}"}}]});
      return response({content:[{text:"已等待人工确认。"}]});
    }
    if(url==="/api/agent")return response({ok:true});
  };
  delete require.cache[require.resolve("../agent-core.js")];
  const core=require("../agent-core.js");
  core.registerTool("remove_case",{risk:"destructive",schema:{type:"function",function:{name:"remove_case",parameters:{type:"object",properties:{}}}},run:async()=>{executed++;return"deleted";}});
  const out=await core.run({messages:[{role:"user",content:"删除"}],tools:["remove_case"],useMemory:false,selfCheck:false,maxRounds:2});
  assert.equal(executed,0);
  assert.equal(approvalCreated,true);
  assert.equal(out.toolCalls[0].waitingApproval,true);
  global.window=oldWindow; global.fetch=oldFetch;
});

test("Agent每次工具执行前重新鉴权，并登记模型Token用量",async()=>{
  const oldWindow=global.window,oldFetch=global.fetch;let round=0,executed=0;const actions=[];
  global.window={authHeaders:()=>({})};
  global.fetch=async(url,opt={})=>{
    const body=opt.body?JSON.parse(opt.body):{};if(url==="/api/agentruns"){actions.push(body.action);if(body.action==="create")return response({ok:true,run:{id:"run_auth"}});return response({ok:true,step:{stepNo:1}});}
    if(url==="/api/generate"){round++;if(round===1)return response({content:[],usage:{prompt_tokens:100,completion_tokens:20},provider:"deepseek",model:"m1",tool_calls:[{id:"a1",function:{name:"secure_lookup",arguments:"{}"}}]});return response({content:[{text:"done"}],usage:{prompt_tokens:30,completion_tokens:10},provider:"deepseek",model:"m1"});}
    if(url==="/api/agent")return response({ok:true});
  };
  delete require.cache[require.resolve("../agent-core.js")];const core=require("../agent-core.js");
  core.registerTool("secure_lookup",{risk:"read",schema:{type:"function",function:{name:"secure_lookup",parameters:{type:"object",properties:{}}}},run:async()=>{executed++;return "ok";}});
  await core.run({messages:[{role:"user",content:"查"}],tools:["secure_lookup"],useMemory:false,selfCheck:false,maxRounds:2});
  assert.equal(executed,1);assert.equal(actions.filter(x=>x==="authorize").length,1);assert.equal(actions.filter(x=>x==="usage").length,2);assert.ok(actions.includes("budget"));
  global.window=oldWindow;global.fetch=oldFetch;
});

test("Agent用量归一化兼容OpenAI与Responses字段",async()=>{
  const m=await import(pathToFileURL(path.resolve(__dirname,"../functions/api/_agent-enterprise.js")).href);
  assert.deepEqual(m.normalizeUsage({prompt_tokens:12,completion_tokens:4}),{inputTokens:12,outputTokens:4});
  assert.deepEqual(m.normalizeUsage({input_tokens:9,output_tokens:3}),{inputTokens:9,outputTokens:3});
});

test("Skill必须具备说明、证据和至少两个用例才能通过发布前评测",async()=>{
  const m=await import(pathToFileURL(path.resolve(__dirname,"../functions/api/agentskills.js")).href);
  const good=m.evaluateCandidate({instruction_md:"这是经过验证的技能操作说明。".repeat(8),description:"用于逐节核查材料来源并输出待补事项，禁止编造。",evidence_json:'[{"run":"r1"}]'},[{input:"a"},{input:"b"}]);
  assert.equal(good.passed,true);assert.equal(good.score,100);
  const bad=m.evaluateCandidate({instruction_md:"短",description:"短",evidence_json:"[]"},[]);assert.equal(bad.passed,false);assert.equal(bad.score,0);
});

function response(data,status=200){return {ok:status>=200&&status<300,status,json:async()=>data};}
