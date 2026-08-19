import test from "node:test";
import assert from "node:assert/strict";
import "../ppt-design-tokens.js";
import "../ppt-component-registry.js";

const Tokens=globalThis.PptDesignTokens,Registry=globalThis.PptComponentRegistry;

test("160页商务蓝设计令牌保留真实主题色和来源",()=>{
  const t=Tokens.get("business-blue-160");
  assert.equal(t.colors.accent,"003591");assert.equal(t.colors.secondary,"5385C5");assert.equal(t.colors.background,"FEFFFF");assert.match(t.source,/160页/);
});

test("正式组件注册表首批覆盖常用PPT组件并记录来源页",()=>{
  assert.ok(Registry.components.length>=24);assert.ok(Registry.components.every(x=>x.id&&x.layoutId&&x.sourcePages.length));
  assert.deepEqual(Registry.get("data-table").sourcePages,[16,22,23,25]);
});

test("组件选型能解释风险、趋势和时间计划页面",()=>{
  const risk=Registry.recommend({layoutId:"bullets",title:"项目主要风险与应对",bullets:["需求风险","工期风险","资金风险"]});
  assert.equal(risk.selected.layoutId,"risk");assert.ok(risk.selected.reasons.length);
  const trend=Registry.recommend({layoutId:"bullets",title:"近五年租金变化趋势",content:{series:[{label:"2024",value:42},{label:"2025",value:45},{label:"2026",value:47}]}});
  assert.equal(trend.selected.layoutId,"chart-line");
  const plan=Registry.recommend({layoutId:"bullets",title:"项目建设工期与关键节点",content:{steps:[{label:"立项"},{label:"开工"},{label:"竣工"}]}});
  assert.equal(plan.selected.layoutId,"timeline");
});

test("content pages exclude cover and section-only candidates",()=>{
  const result=Registry.recommend({type:"content",layoutId:"bullets",title:"风险与应对",bullets:[]});
  assert.ok(result.candidates.length);
  assert.ok(result.candidates.every(x=>!["cover","section","agenda","conclusion"].includes(x.layoutId)));
});

test("strong comparison intent wins over incidental stage words",()=>{
  const result=Registry.recommend({type:"content",layoutId:"comparison",title:"投资分摊模型对比：选择最优策略",bullets:["一次性投入","平均分摊","前高后低","S型分摊适合工程推进阶段"]});
  assert.equal(result.selected.layoutId,"comparison");
});
