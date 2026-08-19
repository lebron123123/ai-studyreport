const test=require("node:test");
const assert=require("node:assert/strict");
global.window=global;
require("../ppt-design-ir.js");
require("../ppt-design-ir-v2.js");
const IR=require("../ppt-premium-design.js");
const Director=require("../ppt-content-director.js");

const image="data:image/svg+xml;base64,"+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><rect width="800" height="450" fill="#2387c7"/></svg>').toString("base64");

test("content director chooses a visual form from the communication task",()=>{
  const plan=Director.applyToDeck({evidencePack:{assets:[]},slides:[
    {layoutId:"bullets",title:"方案对比与路径差异",bullets:["方案A成本较低","方案B品质更高"]},
    {layoutId:"bullets",title:"项目风险与应对",bullets:["成本超支","融资波动"]},
    {layoutId:"bullets",title:"建设工期与关键节点",bullets:["立项","报批","施工"]},
    {layoutId:"bullets",title:"汇报结构与讨论顺序",bullets:["核心逻辑","关键指标","风险分析"]},
    {layoutId:"bullets",title:"体系核心指标展示",bullets:["工期计划","投资峰值","财务收益"]}
  ]});
  assert.deepEqual(plan.slides.map(x=>x.layoutId),["comparison","risk","timeline","agenda","metric"]);
  assert.ok(plan.slides.every(x=>x.visualPlan.version===3));
});

test("中间页误用封面或结论版式时会按页面语义自动修复",()=>{
  const plan=Director.applyToDeck({evidencePack:{assets:[]},slides:[
    {type:"cover",layoutId:"cover",title:"项目决策汇报"},
    {type:"cover",layoutId:"cover",title:"项目背景与目标",bullets:["项目来源","建设目标","实施边界"]},
    {type:"content",layoutId:"statement",title:"项目定位与实施条件",bullets:["政策目标","建设条件"]},
    {type:"cover",layoutId:"cover",title:"关键指标与测算判断",bullets:["总投资43亿元","IRR 5.6%"]},
    {type:"content",layoutId:"statement",title:"需求与市场分析",bullets:["目标客群","供需情况"]},
    {type:"conclusion",layoutId:"conclusion",title:"建议明确下一步行动"}
  ]});
  assert.deepEqual(plan.slides.map(x=>x.layoutId),["cover","bullets","two-column","metric","bullets","conclusion"]);
  assert.equal(plan.slides.filter(x=>x.layoutId==="cover").length,1);
});

test("明确标题语义会纠正旧版式并优先召回同主题中文段落",()=>{
  const sourceText="项目投资采用分期安排。\n主要风险包括市场需求波动，应设置预警和应对机制。\n汇报结构包括核心逻辑、关键指标和决策事项。";
  const plan=Director.applyToDeck({sourceText,evidencePack:{assets:[]},slides:[
    {type:"cover",layoutId:"cover",title:"项目汇报"},
    {type:"content",layoutId:"risk",title:"汇报结构与讨论顺序",bullets:["核心逻辑","关键指标","决策事项"]},
    {type:"content",layoutId:"timeline",title:"体系核心指标展示",bullets:["总投资43亿元","IRR 5.6%"]},
    {type:"content",layoutId:"bullets",title:"主要风险与应对措施"},
    {type:"conclusion",layoutId:"conclusion",title:"下一步行动"}
  ]});
  assert.deepEqual(plan.slides.map(x=>x.layoutId),["cover","agenda","metric","risk","conclusion"]);
  assert.match(plan.slides[3].bullets.join(" "),/市场需求波动/);
});

test("旧风险页不会继续沿用与风险无关的历史要点",()=>{
  const plan=Director.applyToDeck({migratingFromVersion:4,sourceText:"项目投资采用分期安排。\n主要风险包括市场需求波动，应设置预警和应对机制。",evidencePack:{assets:[]},slides:[
    {type:"cover",layoutId:"cover",title:"项目汇报"},
    {type:"content",layoutId:"risk",title:"主要风险与应对措施",bullets:["S型投资分摊比例","工期投资计划表"]},
    {type:"content",layoutId:"timeline",title:"从数据到审核的闭环流程",bullets:["数据清洗","规则配置","审核输出"]},
    {type:"conclusion",layoutId:"conclusion",title:"下一步行动"}
  ]});
  assert.equal(plan.slides[1].layoutId,"risk");
  assert.match(plan.slides[1].bullets.join(" "),/市场需求波动/);
  assert.equal(plan.slides[2].layoutId,"process");
});

test("正式材料没有风险证据时转为证据缺口而不是沿用无关内容",()=>{
  const plan=Director.applyToDeck({sourceText:"项目采用S型投资分摊，工期计划按季度安排。",evidencePack:{assets:[]},slides:[
    {type:"cover",layoutId:"cover",title:"项目汇报"},
    {type:"content",layoutId:"risk",title:"主要风险与应对措施",content:{items:[{label:"S型投资分摊",text:"工期投资计划表"},{label:"参数控制",text:"逐季度填写投资比例"},{label:"市场参数",text:"根据项目区位确定"}]}}
  ]});
  assert.equal(plan.slides[1].contentStatus,"evidence-gap");
  assert.doesNotMatch(plan.slides[1].bullets.join(" "),/S型投资分摊比例|工期投资计划表/);
  assert.match(plan.slides[1].claim,/没有足够的风险证据/);
});

test("空风险页不会用材料开头的普通段落填充",()=>{
  const plan=Director.applyToDeck({sourceText:"项目采用S型投资分摊，工期计划按季度安排。",evidencePack:{assets:[]},slides:[
    {type:"cover",layoutId:"cover",title:"项目汇报"},
    {type:"content",layoutId:"risk",title:"主要风险与应对措施",bullets:[],content:{items:[]}}
  ]});
  assert.equal(plan.slides[1].contentStatus,"evidence-gap");
  assert.doesNotMatch(plan.slides[1].bullets.join(" "),/S型投资分摊/);
});

test("project images are scheduled into cover, metrics and image pages with provenance",()=>{
  const evidencePack={assets:[{id:"img-1",name:"项目建筑效果图.svg",kind:"image",dataUrl:image}]};
  const plan=Director.applyToDeck({evidencePack,slides:[
    {type:"cover",layoutId:"cover",title:"项目汇报"},
    {layoutId:"metric",title:"项目核心指标",content:{metrics:[{label:"总投资",value:"43亿元"},{label:"IRR",value:"5.6%"}]}},
    {layoutId:"image-hero",title:"项目建筑形象"}
  ]});
  plan.slides.forEach(slide=>{
    assert.equal(slide.content.image,image);
    assert.equal(slide.assetPlan.status,"matched");
    assert.equal(slide.assetPlan.sourceRef,"项目建筑效果图.svg");
  });
});

test("agenda and verdict scenes use real bullet labels instead of generic placeholders",()=>{
  const slides=[
    {layoutId:"agenda",title:"目录",claim:"围绕四项决策展开",bullets:["项目价值判断","关键指标核验","实施计划安排"]},
    {layoutId:"statement",title:"结论",bullets:["政策方向一致","资金边界明确","风险整体可控"]}
  ],plan={slides};
  const labels=slides.flatMap((slide,index)=>IR.buildScene(slide,plan,index).elements.filter(x=>x.type==="text").map(x=>x.text));
  assert.ok(labels.includes("项目价值判断"));
  assert.ok(labels.includes("政策方向一致"));
  assert.ok(!labels.includes("要点 1"));
});
