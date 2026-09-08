const test=require('node:test');
const assert=require('node:assert/strict');
const Ops=require('../investment-ops.js');
function trusted(overrides={}){
  const metrics={irr:5,capitalIrr:7,npv:100,payback:10,totalInvestment:1000},metricMeta={};
  for(const [key,,unit] of Ops.METRICS)metricMeta[key]={unit,currency:'CNY',period:'2026-2046;annual',cashFlow:key==='capitalIrr'?'capital':'project',engineVersion:'test-engine',discountRate:3.5};
  return {kind:'baseline',calcType:'rent',calcSnapshotId:'calc-v1',engine:'whitebox',metrics,metricMeta,verification:{status:'server_recomputed'},...overrides};
}
test('会议一句可以同时构成决定、任务与风险并保留稳定来源ID',()=>{
  const a=Ops.parseMeeting('讨论范围\n会议决定由投资部牵头完成融资风险复核'),b=Ops.parseMeeting('讨论范围\n会议决定由投资部牵头完成融资风险复核');
  assert.deepEqual(a,b);assert.deepEqual(a.summary,{agenda:1,decisions:1,tasks:1,risks:1,requiresConfirmation:3});assert.equal(a.tasks[0].sourceId,a.risks[0].sourceId);assert.notEqual(a.tasks[0].id,a.risks[0].id);
});
test('缺失/非有限指标不会变成0，资本金IRR不代替全投资IRR',()=>{
  assert.deepEqual(Ops.normalizeScenario({metrics:{capitalIrr:8}}).metrics,{capitalIrr:8});
  for(const value of [null,'',false,NaN,Infinity]){const s=Ops.normalizeScenario({metrics:{irr:value}});assert.equal(s.metrics.irr,undefined);assert.deepEqual(s.invalidMetrics,['irr']);}
  assert.equal(Ops.normalizeScenario({metrics:{irr:0}}).metrics.irr,0);
});
test('只有同版本同口径的服务端情景可以直接比较',()=>{
  const a=trusted(),b=trusted({kind:'prudent',metrics:{...a.metrics,irr:3}});assert.equal(Ops.compareScenarios([a,b]).comparable,true);assert.equal(Ops.compareScenarios([a,b]).columns.length,8);
  for(const key of ['unit','currency','period','cashFlow','engineVersion']){const changed=structuredClone(b);changed.metricMeta.irr[key]='different';assert.equal(Ops.compareScenarios([a,changed]).comparable,false);}
  assert.equal(Ops.compareScenarios([a,{...b,verification:{}}]).comparable,false);
});
test('决策包不能以白箱标签、证据ID或空问题清单替代真实核查',()=>{
  const input={projectId:'p1',scenario:trusted(),evidenceIds:['e1'],context:{snapshotVerified:true,evidenceVerified:true,consistencyVerified:true,artifacts:[{artifactType:'report'},{artifactType:'calculation'}]}};
  assert.equal(Ops.buildDecisionPackage(input).status,'ready');
  for(const key of ['snapshotVerified','evidenceVerified','consistencyVerified'])assert.equal(Ops.buildDecisionPackage({...input,context:{...input.context,[key]:false}}).status,'blocked');
  assert.equal(Ops.buildDecisionPackage({...input,scenario:trusted({metrics:{irr:3,capitalIrr:5,npv:1}})}).status,'blocked');
});
test('生产通过必须有受信运行和明确零数字错误，样本不限20个',()=>{
  const slo={passed:true,serverVerified:true,runId:'slo-run'},goldenProjects=Array.from({length:25},(_,i)=>({id:'p'+i,type:['rent','sale','gaibao'][i%3],numericErrors:0,serverVerified:true,runId:'run'+i}));
  assert.equal(Ops.productionGate({goldenProjects,slo}).passed,true);
  for(const value of [undefined,null,'',NaN])assert.equal(Ops.productionGate({goldenProjects:goldenProjects.map(x=>({...x,numericErrors:value})),slo}).passed,false);
  assert.equal(Ops.productionGate({goldenProjects,slo:{passed:true}}).passed,false);assert.equal(Ops.productionGate({goldenProjects:goldenProjects.map(x=>({...x,serverVerified:false})),slo}).passed,false);
});
