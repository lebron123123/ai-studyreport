const test=require("node:test");
const assert=require("node:assert/strict");
const core=require("../ppt-core.js");
const bridge=require("../ppt-calc-bridge.js");

test("buildDeckPlan preserves workflow, scene and calculation extension state during migration",()=>{
  const input={
    title:"扩展字段恢复测试",
    slides:[
      {id:"cover",type:"cover",layoutId:"cover",title:"封面"},
      {id:"end",type:"conclusion",layoutId:"conclusion",title:"结论"}
    ],
    sceneId:"business-review",
    scenePreset:{id:"business-review",name:"经营分析汇报"},
    workflow:{stage:"design",intakeConfirmedAt:123},
    brief:{centralTakeaway:"经营指标决定下一步动作"},
    calcAnalysis:{type:"sale",metrics:[{key:"irr",value:5.2}]},
    generationProviderId:"local-rule"
  };
  const out=core.buildDeckPlan(input);
  assert.equal(out.sceneId,"business-review");
  assert.equal(out.workflow.stage,"design");
  assert.equal(out.brief.centralTakeaway,"经营指标决定下一步动作");
  assert.equal(out.calcAnalysis.metrics[0].key,"irr");
  assert.equal(out.generationProviderId,"local-rule");
});

test("calculation pages append when a deck has no conclusion page",()=>{
  const result={
    __ctype:"sale",allYears:[2026,2027],
    summary:{totalIncome:100,totalCost:80,totalNetProfit:20,irr:4.5},
    income:{2026:{total:40},2027:{total:60}},
    totalCost:{2026:{total:50},2027:{total:30}},
    cf:{2026:{net:-10},2027:{net:30}}
  };
  const base={slides:[{id:"cover",layoutId:"cover",title:"封面"},{id:"body",layoutId:"statement",title:"判断"}]};
  const out=bridge.attach(base,result,{calcType:"sale"}).plan;
  assert.deepEqual(out.slides.slice(0,2).map(x=>x.id),["cover","body"]);
  assert.equal(out.slides[2].calcGenerated,true);
});
