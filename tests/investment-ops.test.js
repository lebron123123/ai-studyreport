const test=require("node:test");
const assert=require("node:assert/strict");
const Ops=require("../investment-ops.js");

test("会议纪要会分离议题、决定、任务和风险，且保持来源行",()=>{
  const x=Ops.parseMeeting("会议讨论项目边界\n决定采用方案A\n由投资部牵头，2026-09前完成测算复核\n存在融资利率上行风险，需预警");
  assert.deepEqual(x.summary,{agenda:1,decisions:1,tasks:1,risks:1,requiresConfirmation:3});
  assert.equal(x.tasks[0].owner,"投资部牵头");
  assert.equal(x.risks[0].sourceLine,4);
});

test("情景比较覆盖六类决策指标并保留白箱快照",()=>{
  const c=Ops.compareScenarios([
    {kind:"baseline",calcSnapshotId:"calc-v1",engine:"whitebox",metrics:{irr:5,npv:100,totalInvestment:1000}},
    {kind:"prudent",calcSnapshotId:"calc-v2",engine:"whitebox",metrics:{irr:3,npv:-20,totalInvestment:1100}}
  ]);
  assert.equal(c.hasBaseline,true);assert.equal(c.comparable,true);assert.equal(c.columns.length,6);assert.equal(c.scenarios[0].calcSnapshotId,"calc-v1");
});

test("投资决策包缺少快照、证据或存在阻断问题时不能误标通过",()=>{
  const bad=Ops.buildDecisionPackage({projectId:"p1",scenario:{kind:"baseline",engine:"ai",metrics:{irr:5}},evidenceIds:[],consistencyIssues:[{severity:"blocker"}]});
  assert.equal(bad.status,"blocked");assert.ok(bad.audit.blockers.length>=4);
  const good=Ops.buildDecisionPackage({projectId:"p1",scenario:{kind:"baseline",calcSnapshotId:"calc-v1",engine:"whitebox",metrics:{irr:5,npv:20,payback:12,totalInvestment:1000}},evidenceIds:["e1"],context:{artifacts:[{artifactType:"report"},{artifactType:"calculation"}]}});
  assert.equal(good.status,"ready");assert.equal(good.audit.passed,true);
});

test("SLO与生产门槛使用真实样本判断，空样本不会通过",()=>{
  assert.equal(Ops.evaluateSlo({}).passed,false);
  const samples=Array.from({length:50},(_,i)=>({latencyMs:1000+i,ok:true,recovered:true})),slo=Ops.evaluateSlo({concurrency:50,samples,target:{p95Ms:5000,successRate:.99,recoveryRate:.95,concurrency:50}});
  assert.equal(slo.passed,true);
  const gate=Ops.productionGate({goldenProjects:["rent","sale","gaibao","rent","sale"].map((type,i)=>({id:i,type,numericErrors:0})),slo});
  assert.equal(gate.passed,true);
});
