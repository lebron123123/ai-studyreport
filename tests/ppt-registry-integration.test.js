import test from "node:test";
import assert from "node:assert/strict";
import "../ppt-design-tokens.js";
import "../ppt-layout-recipes.js";
import "../ppt-component-registry.js";
import "../ppt-components.js";
import "../ppt-core.js";

const Core=globalThis.PptCore;

test("高级商务蓝模板进入现有模板列表并保留真实主题色",()=>{
  const preset=Core.TEMPLATE_PRESETS.find(x=>x.id==="business-blue-160");
  assert.ok(preset);assert.equal(preset.accent,"003591");assert.equal(preset.design.density,"high");
  const plan=Core.buildDeckPlan({title:"组件化汇报",templateId:"business-blue-160",slideCount:6});
  assert.equal(plan.templateId,"business-blue-160");assert.equal(plan.designSpec.accent,"003591");
});

test("视觉导演记录可解释候选并将有效趋势数据切换为折线图",()=>{
  const plan=Core.buildDeckPlan({title:"趋势测试",slides:[
    {type:"cover",layoutId:"cover",title:"趋势测试"},
    {type:"content",layoutId:"bullets",title:"近三年租金变化趋势",content:{series:[{label:"2024",value:42},{label:"2025",value:45},{label:"2026",value:48}]},bullets:["租金稳步上涨"]},
    {type:"conclusion",layoutId:"conclusion",title:"建议"}
  ]});
  const directed=Core.applyVisualDirector(plan);
  assert.equal(directed.slides[1].layoutId,"chart-line");assert.ok(directed.slides[1].componentSelection.selected);assert.ok(directed.slides[1].componentSelection.candidates.length>=3);assert.equal(directed.slides[1].componentSelection.applied,true);assert.equal(directed.slides[1].componentSelection.appliedLayoutId,"chart-line");
});

test("人工锁定页不会被组件选型修改",()=>{
  const plan=Core.buildDeckPlan({title:"锁定测试",slides:[{type:"cover",layoutId:"cover",title:"锁定"},{type:"content",layoutId:"bullets",title:"风险与对策",bullets:["A","B","C"],locked:true},{type:"conclusion",layoutId:"conclusion",title:"结论"}]});
  assert.equal(Core.applyVisualDirector(plan).slides[1].layoutId,"bullets");
});

test("视觉导演写入页面角色、密度和高级整页配方",()=>{
  const plan=Core.buildDeckPlan({title:"方案比较",slides:[{type:"cover",layoutId:"cover",title:"方案比较"},{type:"content",layoutId:"comparison",title:"四种投资分摊方式对比",bullets:["一次性投入","平均分摊","前高后低","S型分摊"]},{type:"conclusion",layoutId:"conclusion",title:"建议"}]});
  assert.equal(plan.slides[1].recipeId,"compare-scorecard");assert.equal(plan.slides[1].pageRole,"decision");assert.equal(plan.slides[1].recipeSelection.role,"comparison");assert.ok(plan.slides[1].density);
});

test("超载正文自动拆页而人工锁定页不拆",()=>{
  const overloaded={type:"content",layoutId:"bullets",title:"八项分析",bullets:Array.from({length:8},(_,i)=>"事项"+(i+1))};
  const split=Core.buildDeckPlan({slides:[{type:"cover",layoutId:"cover",title:"测试"},overloaded,{type:"conclusion",layoutId:"conclusion",title:"结论"}]});
  assert.equal(split.slides.length,4);assert.match(split.slides[2].title,/续2/);
  const locked=Core.buildDeckPlan({slides:[{type:"cover",layoutId:"cover",title:"测试"},{...overloaded,locked:true},{type:"conclusion",layoutId:"conclusion",title:"结论"}]});
  assert.equal(locked.slides.length,3);
});

test("比较页只依据明确推荐措辞形成建议判断",()=>{
  const marked={type:"content",layoutId:"comparison",title:"分摊方式对比",bullets:["平均分摊：简单","S型分摊：与进度更匹配"]};Core.enrichSlideContent(marked);assert.match(marked.claim,/S型分摊/);
  const neutral={type:"content",layoutId:"comparison",title:"方案对比",bullets:["方案甲：成本低","方案乙：周期短"]};Core.enrichSlideContent(neutral);assert.match(neutral.claim,/方案甲/);
  const html=globalThis.PptComponents.renderHtml({...neutral,recipeId:"compare-scorecard"});assert.doesNotMatch(html,/推荐候选/);
});
