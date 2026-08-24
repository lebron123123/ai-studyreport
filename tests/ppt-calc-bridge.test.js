const test=require("node:test");
const assert=require("node:assert/strict");
const Bridge=require("../ppt-calc-bridge.js");

const result={
  __ctype:"rent",allYears:[2026,2027,2028],
  summary:{totalIncome:12500,totalCost:7600,totalNetProfit:3100,totalNpv:580,irr:4.62,capitalIrr:5.1,icr:2.35},
  income:{2026:{total:2000},2027:{total:4600},2028:{total:5900}},
  cost:{2026:{manage:300,maint:120,total:1200},2027:{manage:350,maint:180,total:2600},2028:{manage:400,maint:210,total:3800}},
  totalCost:{2026:{total:1200},2027:{total:2600},2028:{total:3800}},
  cf:{2026:{net:-5000},2027:{net:2200},2028:{net:3900}}
};

test("页面尚无测算结果时返回空分析而不抛异常",()=>{
  const a=Bridge.analyze(null);
  assert.equal(a.available,false);
  assert.equal(a.calcType,"");
  assert.deepEqual(a.years,[]);
});

test("三类白箱结果的共同骨架可转换为PPT指标和年度图表",()=>{
  const a=Bridge.analyze(result,{calcType:"rent",snapshotId:"snap_1"});
  assert.equal(a.available,true);assert.equal(a.calcTypeName,"出租类");assert.deepEqual(a.years,["2026","2027","2028"]);
  assert.equal(a.cashflow[0].value,-5000);assert.ok(a.metrics.some(x=>x.label==="项目IRR"&&x.value===4.62));
  assert.ok(a.costs.some(x=>x.label==="管理费用"));assert.equal(a.source.snapshotId,"snap_1");
});

test("测算桥接只在明确调用后插入页面并且重复接入不会重复",()=>{
  const base={title:"项目汇报",slides:[{id:"cover",layoutId:"cover",title:"封面"},{id:"end",layoutId:"conclusion",title:"结论"}],workflow:{stage:"brief"}};
  const once=Bridge.attach(base,result,{calcType:"rent"}),twice=Bridge.attach(once.plan,result,{calcType:"rent"});
  assert.equal(once.added,4);assert.equal(twice.plan.slides.filter(x=>x.calcGenerated).length,4);
  assert.equal(twice.plan.slides.at(-1).id,"end");assert.ok(twice.plan.slides.every((x,i)=>x.order===i+1));
});

test("没有完整年度测算结果时不造数也不生成财务页",()=>{
  const a=Bridge.analyze({summary:{irr:5.2}},{calcType:"sale"});
  assert.equal(a.available,false);assert.deepEqual(Bridge.buildSlides(a),[]);
});
