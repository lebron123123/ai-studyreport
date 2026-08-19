const test=require("node:test");
const assert=require("node:assert/strict");
require("../ppt-design-ir.js");
const VisualQA=require("../ppt-visual-qa.js");

function plan(){const slides=[
  {id:"c",layoutId:"cover",title:"项目汇报",subtitle:"决策材料",sources:[],visualPlan:{compositionId:"cover-architectural"}},
  ...Array.from({length:4},(_,i)=>({id:"m"+i,layoutId:"metric",title:"关键指标",content:{metrics:[{label:"总投资",value:"43亿元"},{label:"IRR",value:"5.6%"},{label:"工期",value:"16季度"}]},sources:["测算表"],visualPlan:{compositionId:"metric-hero-grid"}}))
];return{title:"项目汇报",templateId:"anju-blue",designSpec:{},slides};}

test("五维视觉QA输出层级、构图、密度、可读性和素材分数",()=>{
  const r=VisualQA.inspectDeck(plan());assert.ok(r.score>0);assert.deepEqual(Object.keys(r.dimensions),["hierarchy","composition","density","readability","assets"]);assert.ok(r.details.length===5);assert.ok(r.issues.some(x=>x.code==="deck_monotony"));
});

test("自动返修会处理重复构图并留下返修前后记录",()=>{
  const r=VisualQA.repair(plan());assert.ok(r.changedPages.length>=1);assert.ok(r.plan.slides.some(x=>x.visualPlan.variant));assert.ok(r.plan.slides.every(x=>Number.isFinite(x.qa.visualAfter)));
});

test("人工锁定页不参与视觉自动返修",()=>{
  const p=plan();p.slides[3].locked=true;const before=JSON.stringify(p.slides[3]),r=VisualQA.repair(p);assert.equal(JSON.stringify(r.plan.slides[3]),before);
});
