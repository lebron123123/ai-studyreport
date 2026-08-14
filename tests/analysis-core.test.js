const test=require("node:test");
const assert=require("node:assert/strict");
const A=require("../analysis-core.js");

test("1/3/5km圈层按真实经纬度距离归类",()=>{
  const p={latitude:22.5431,longitude:114.0579},rows=A.assignScopes(p,[{name:"近点",latitude:22.548,longitude:114.058},{name:"远点",latitude:22.59,longitude:114.058}]);
  assert.deepEqual(rows[0].scopes,[1,3,5]);assert.deepEqual(rows[1].scopes,[]);assert.ok(rows[0].distanceKm<1);assert.ok(rows[1].distanceKm>5);
});
test("未审核数字不进入人口与职住正式分析",()=>{
  const r=A.analyze({scopeKm:3,observations:[{metricKey:"resident_population",scopeKm:3,value:100000,reviewStatus:"pending"},{metricKey:"working_population",scopeKm:3,value:150000,reviewStatus:"approved"}]});
  assert.equal(r.balance.available,false);assert.ok(r.missing.includes("resident_population"));
});
test("职住白箱公式及区间解释准确",()=>{
  const r=A.balance({resident_population:100000,working_population:180000,internal_commuters:30000,inbound_commuters:90000,outbound_commuters:10000});
  assert.equal(r.workLiveRatio,1.8);assert.equal(r.level,"就业显著集中");assert.equal(r.netCommuteInflow,80000);assert.equal(r.internalCommuteRate,.3);
});
test("OD来源去向TOP10只采用已审核流量",()=>{
  const r=A.commute([{originName:"龙岗",destinationName:"坪地",population:8200,reviewStatus:"approved"},{originName:"龙岗",destinationName:"龙城",population:1000,reviewStatus:"approved"},{originName:"伪数据",destinationName:"坪地",population:99999,reviewStatus:"pending"}]);
  assert.equal(r.totalFlow,9200);assert.deepEqual(r.originTop10[0],{name:"龙岗",population:9200});assert.equal(r.destinationTop10[0].name,"坪地");
});
test("POI配套计算返回距离、短板和负面预警",()=>{
  const p={latitude:22.5431,longitude:114.0579},pois=[{name:"地铁",category:"transport",latitude:22.548,longitude:114.058,reviewStatus:"approved"},{name:"污染源",category:"negative",latitude:22.55,longitude:114.058,reviewStatus:"approved"}];
  const r=A.facilities(p,pois);assert.equal(r.categories.transport.count,1);assert.ok(r.categories.transport.nearestKm<1);assert.ok(r.shortages.includes("医疗"));assert.equal(r.negativeWarnings[0].name,"污染源");
});
test("需求模型无数据不造数，有数据输出三场景且保持单调",()=>{
  const none=A.demand({target_population:10000});assert.equal(none.available,false);assert.match(none.conclusion,/禁止/);
  const r=A.demand({target_population:10000,rent_propensity:.5,eligibility_rate:.6,affordability_rate:.8,effective_supply:1000,planned_supply:200});
  assert.equal(r.scenarios.length,3);assert.ok(r.scenarios[0].potentialDemand<r.scenarios[1].potentialDemand);assert.ok(r.scenarios[1].potentialDemand<r.scenarios[2].potentialDemand);assert.equal(r.scenarios[1].shortage,1200);
});
test("数据快照变化能映射到受影响可研章节",()=>{
  const before={population:{residentPopulation:10},balance:{workLiveRatio:1},commute:{},facilities:{},demand:{shortage:1}},after={population:{residentPopulation:12},balance:{workLiveRatio:1.2},commute:{},facilities:{},demand:{shortage:2}};
  const p=A.impactPreview(before,after);assert.ok(p.changedDomains.includes("population"));assert.ok(p.changedDomains.includes("commute"));assert.ok(p.changedDomains.includes("demand"));assert.ok(p.affectedChapters.includes("需求分析"));assert.ok(p.affectedChapters.includes("建设必要性"));
});
test("Provider契约预留本地和未来外部数据源",()=>{
  const p=A.providerContract();assert.ok(p.providers.includes("excel"));assert.ok(p.providers.includes("local_database"));assert.ok(p.providers.includes("future_external_api"));
});
test("10项数据研判逻辑完整覆盖输入、公式、缺数处理和章节关联",()=>{
  assert.equal(A.LOGIC_RULES.length,10);
  A.LOGIC_RULES.forEach((r,i)=>{assert.equal(r.order,i+1);assert.ok(r.name);assert.ok(r.domain);assert.ok(r.inputs.length);assert.ok(r.formula);assert.ok(r.missingPolicy);assert.ok(r.outputs.length);assert.ok(r.chapters.length);});
});
test("职住和需求模型采用已发布规则中的机器阈值配置",()=>{
  const balance=A.balance({resident_population:100,working_population:120},{config:{cuts:[.5,.8,1.3,2]}});
  assert.equal(balance.level,"总量相对平衡");
  const demand=A.demand({target_population:1000,rent_propensity:1,eligibility_rate:1,affordability_rate:1,effective_supply:0,planned_supply:0},{config:{scenarioFactors:{cautious:.5,base:1,optimistic:2}}});
  assert.deepEqual(demand.scenarios.map(x=>x.potentialDemand),[500,1000,2000]);
});
