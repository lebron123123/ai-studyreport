const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../report-completion-contract.js');
function fixture(){
  const fact={key:'name',label:'项目名称',value:'甲项目',status:'pending',source:'当前输入，未核对',owner:'总论 / 项目概况',required:true,allocationMode:'owner'};
  const plan=C.createPlan([{name:'总论',sections:[{t:'项目概况'},{t:'研究范围'}]}],{facts:[fact]});
  plan.factAllocation={version:'fact-ownership-v1',status:'ready',issues:[],facts:[fact]};
  return {plan,entries:plan.sections.map((s,i)=>({key:s.sectionKey,text:i?'本节仅说明研究范围。':'甲项目，资料待核实。'}))};
}
test('全篇事实职责：唯一归属不自动核实，旧计划仍兼容',()=>{
  const f=fixture(),before=JSON.stringify(f),r=C.reviewDocument(f.entries,f.plan);
  assert.equal(r.status,'unverified');assert.equal(r.factsVerified,false);assert.equal(r.issues.length,0);assert.equal(JSON.stringify(f),before);
  delete f.plan.factAllocation;assert.equal(C.reviewDocument(f.entries,f.plan).status,'unverified');
});
test('全篇事实职责：空记录、未分配、假ready、重复、丢失和台账冲突都阻断',()=>{
  for(const mutate of [p=>p.factAllocation=null,p=>p.factAllocation.status='blocked',p=>p.factAllocation.issues.push({message:'未分配'}),p=>p.factAllocation.facts[0].owner='不存在',p=>p.factAllocation.facts[0].allocationMode='unassigned',p=>p.factAllocation.facts.push({...p.factAllocation.facts[0]}),p=>p.factAllocation.facts=[],p=>p.factAllocation.facts[0].value='乙项目',p=>p.factAllocation.facts[0].status='confirmed',p=>p.sections[1].requiredFacts.push({...p.sections[0].requiredFacts[0]}),p=>p.sections[0].requiredFacts=[]]){
    const f=fixture();mutate(f.plan);const r=C.reviewDocument(f.entries,f.plan);assert.equal(r.status,'blocked');assert.ok(r.issues.some(i=>i.code==='fact-allocation-invalid'&&i.repairable===false));
  }
});
test('只有显式背景可不重复必填，不能将已绑定必要事实伪装为背景',()=>{
  const f=fixture(),fact=f.plan.factAllocation.facts[0];Object.assign(fact,{owner:'',required:false,allocationMode:'background'});
  assert.equal(C.reviewDocument(f.entries,f.plan).status,'blocked');
  f.plan.sections.forEach(s=>s.requiredFacts=[]);assert.equal(C.reviewDocument(f.entries,f.plan).status,'passed');
  delete fact.allocationMode;assert.equal(C.reviewDocument(f.entries,f.plan).status,'blocked');
});
