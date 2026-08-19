const test=require("node:test");
const assert=require("node:assert/strict");

global.window=global;
require("../ppt-layout-recipes.js");
require("../ppt-component-registry.js");
require("../ppt-design-learning.js");
const Strategy=require("../ppt-expression-strategy.js");
require("../ppt-design-ir.js");
const IR=require("../ppt-design-ir-v2.js");
const Benchmark=require("../ppt-quality-benchmark.js");
const RenderQA=require("../ppt-render-qa.js");
const VisualQA=require("../ppt-visual-qa.js");
const Golden=require("../ppt-template-golden.js");

const basePlan={title:"项目决策汇报",purpose:"形成决策结论",templateId:"business-blue-160",designSpec:{},slides:[]};

test("表达策略会按数据形态选择指标、风险和图片叙事",()=>{
  assert.equal(Strategy.planSlide({title:"关键指标",content:{metrics:[{value:"43亿元"},{value:"5.6%"}]}}).strategyId,"kpi-dashboard");
  assert.equal(Strategy.planSlide({title:"主要风险与应对",bullets:["工期风险","成本风险"]}).strategyId,"risk-heatmap");
  assert.equal(Strategy.planSlide({title:"项目区位与周边",content:{image:"data:image/png;base64,AA"}}).strategyId,"spatial-story");
});

test("Design IR V2为高频页面提供充实且可编辑的场景",()=>{
  const cases=[
    {layoutId:"bullets",title:"核心判断",claim:"项目具备推进条件",bullets:["需求明确","成本可控","风险可管"]},
    {layoutId:"three-cards",title:"三项价值",bullets:["公共价值","经济价值","实施价值"]},
    {layoutId:"risk",title:"风险与应对",bullets:["工期风险","成本风险","市场风险","审批风险"]},
    {layoutId:"matrix",title:"决策矩阵",bullets:["高价值低风险","高价值高风险","低价值低风险","低价值高风险"]},
    {layoutId:"system-map",title:"协同机制",claim:"项目治理",bullets:["建设","运营","财务","审查"]},
    {layoutId:"conclusion",title:"建议推进下一步",bullets:["确认边界","锁定参数","提交审议"]}
  ];
  const plan={...basePlan,slides:cases};cases.forEach((slide,i)=>{const scene=IR.buildScene(slide,plan,i);assert.equal(scene.version,2);assert.ok(scene.elements.length>=9,slide.layoutId);assert.equal(IR.inspect(scene).ok,true);});
});

test("12类黄金页基准可以识别覆盖率和视觉锚点",()=>{
  const layouts=["cover","agenda","statement","metric","comparison","timeline","process","risk","image-hero","chart-bar","conclusion","conclusion"];
  const plan={...basePlan,slides:layouts.map((layoutId,i)=>({layoutId,title:"页面"+(i+1),bullets:["要点一","要点二","要点三"],content:layoutId==="image-hero"?{image:"data:image/png;base64,AA"}:{}}))};
  const result=Benchmark.inspect(plan);assert.equal(result.dimensions.goldenCoverage,100);assert.equal(result.missingTypes.length,0);assert.equal(Benchmark.buildSuite().length,12);
});

test("视觉QA支持只返工指定页面且最多两轮",()=>{
  const slides=[{layoutId:"cover",title:"封面"},{layoutId:"bullets",title:"第一页",bullets:["A"]},{layoutId:"bullets",title:"第二页",bullets:["B"]}];const plan={...basePlan,slides};
  const result=VisualQA.repairPages(plan,[3],{maxRounds:2});assert.ok(result.changedPages.every(x=>x===3));assert.equal(result.plan.visualQa.scope,"changed-pages");assert.ok(result.plan.visualQa.repairRounds<=2);
  const queue=RenderQA.repairQueue(plan,{issues:[{page:2,severity:"warning",code:"empty"}]},{pages:[{page:3,issues:[{severity:"error",code:"overlap"}]}]});assert.deepEqual(queue.map(x=>x.page),[3,2]);
});

test("模板黄金页选择和形状级组件合同可治理",()=>{
  const library={recipes:Array.from({length:40},(_,i)=>({id:"r"+i,family:i%2?"chart":"timeline",representativePage:i+1,sourcePages:[i+1]})),components:[]};const selected=Golden.selectGoldenPages(library);assert.equal(selected.selected,36);assert.ok(selected.coverage.families.length>=2);
  const contract=Golden.componentContract({page:17,layoutId:"timeline",geometry:{editableShapeCount:12,slots:[{shapeId:"shape_1",role:"title",type:"shape",capacity:30,required:true}]}});assert.equal(contract.cloneMode,"native-ooxml-group");assert.equal(contract.status,"ready-for-visual-review");
});

test("接受或拒绝页面会形成轻量设计偏好",()=>{
  const Learning=require("../ppt-design-learning.js"),before=Learning.adjustment("strategy","kpi-dashboard");Learning.record({action:"accept",strategyId:"kpi-dashboard"});assert.equal(Learning.adjustment("strategy","kpi-dashboard"),before+2);Learning.record({action:"reject",strategyId:"kpi-dashboard"});assert.equal(Learning.adjustment("strategy","kpi-dashboard"),before);
});

test("模板解析器输出坐标、层级和槽位合同",async()=>{
  const {extractTemplateGeometry}=await import("../local-server/ppt-template-analyzer.js"),xml='<p:sld xmlns:p="p" xmlns:a="a"><p:sp><p:spPr><a:xfrm><a:off x="914400" y="457200"/><a:ext cx="3657600" cy="914400"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:rPr sz="3200"/><a:t>项目关键结论</a:t></a:r></a:p></p:txBody></p:sp><p:pic><p:spPr><a:xfrm><a:off x="5486400" y="1371600"/><a:ext cx="3657600" cy="2743200"/></a:xfrm></p:spPr></p:pic></p:sld>',g=extractTemplateGeometry(xml);assert.equal(g.shapes.length,2);assert.equal(g.shapes[0].x,1);assert.equal(g.shapes[0].slot,"title");assert.equal(g.slots.length,2);
});
