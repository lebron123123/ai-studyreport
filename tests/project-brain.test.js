const test=require("node:test");
const assert=require("node:assert/strict");
const Brain=require("../project-brain.js");

test("旧项目无需迁移即可形成统一项目上下文",()=>{
  const context=Brain.buildContext({projectId:"project-123",name:"龙华项目",updatedAt:9,data:{project:{name:"龙华项目",type:"rent",location:"龙华区",owner:"投资部"},paramsConfirmed:true,calcParams:{rent:42},calcSummary:{irr:3.2},kb:[{title:"政策"}],workflow:{calcSnapshots:[{version:1}],reportVersions:[{version:1}]},chapters:[{sections:[{content:"正文"},{content:""}]}]}});
  assert.equal(context.project.id,"project-123");assert.equal(context.lifecycle.current,"feasibility");assert.equal(context.summary.facts,6);
  assert.equal(context.summary.confirmedFacts,6);assert.equal(context.summary.generatedSections,1);assert.equal(context.summary.materials,1);
  assert.equal(context.facts.find(x=>x.factKey==="param.rent").factType,"ASSUMPTION");assert.equal(context.facts.find(x=>x.factKey==="metric.irr").factType,"CALCULATION");
});

test("结构化事实按版本覆盖旧值但保留人工确认状态",()=>{
  const context=Brain.buildContext({projectId:"project-123",data:{project:{name:"A"}},facts:[
    {factKey:"project.location",label:"位置",value:"罗湖",version:1,status:"candidate"},
    {factKey:"project.location",label:"位置",value:"龙华",version:2,status:"confirmed"}
  ]});
  const fact=context.facts.find(x=>x.factKey==="project.location");assert.equal(fact.value,"龙华");assert.equal(fact.version,2);assert.equal(fact.status,"confirmed");
});

test("投资全周期固定为八阶段且显式阶段优先于旧流程推断",()=>{
  assert.equal(Brain.STAGES.length,8);assert.equal(Brain.legacyStage({project:{name:"A",investmentStage:"implementation"}}),"implementation");
  assert.equal(Brain.stage("post_investment").label,"投后管理");assert.equal(Brain.stage("bad").key,"feasibility");
});

test("变更预演从参数传播到指标和章节",()=>{
  const graph={parameters:[{id:"param:rent",key:"rent"}],metrics:[{id:"metric:irr",key:"irr"}],sections:[{id:"section:finance",title:"财务评价"}],edges:[{from:"param:rent",to:"metric:irr"},{from:"metric:irr",to:"section:finance"}]};
  const out=Brain.previewChange({before:{rent:40},after:{rent:42},dependencyGraph:graph});
  assert.deepEqual(out.changedKeys,["rent"]);assert.equal(out.affectedMetrics[0].key,"irr");assert.equal(out.affectedSections[0].title,"财务评价");assert.equal(out.requiresApproval,true);
});
