import test from "node:test";
import assert from "node:assert/strict";
import "../ppt-components.js";
import "../ppt-core.js";

const {buildDeckPlan,validateDeckPlan,diffDeckPlans}=globalThis.PptCore;

test("PPT资料按标题拆成逐页大纲并保留基本元数据",()=>{
  const plan=buildDeckPlan({title:"龙华项目汇报",audience:"经营班子",templateId:"data-light",slideCount:7,sourceText:"# 项目背景\n项目位于龙华区。\n# 财务测算\n总投资以测算引擎结果为准。\n# 风险分析\n租金及去化风险需持续跟踪。"});
  assert.equal(plan.title,"龙华项目汇报");assert.equal(plan.templateId,"data-light");
  assert.equal(plan.slides[0].type,"cover");assert.ok(plan.slides.some(x=>x.title==="财务测算"));
  assert.equal(validateDeckPlan(plan).ok,true);
});

test("PPT质量检查能识别缺标题和重复页面ID",()=>{
  const plan=buildDeckPlan({slideCount:5});plan.slides[1].title="";plan.slides[2].id=plan.slides[1].id;
  const qa=validateDeckPlan(plan);assert.equal(qa.ok,false);assert.ok(qa.errors.some(x=>x.includes("缺少标题")));assert.ok(qa.errors.some(x=>x.includes("ID重复")));
});

test("逐页差异能区分修改、新增和删除",()=>{
  const before=buildDeckPlan({slideCount:5}),after=structuredClone(before);after.slides[1].title="新标题";after.slides.pop();after.slides.push({id:"new",title:"新增页",bullets:[]});
  const changes=diffDeckPlans(before,after);assert.ok(changes.some(x=>x.type==="changed"));assert.ok(changes.some(x=>x.type==="added"));assert.ok(changes.some(x=>x.type==="removed"));
});

test("设计规格随品牌方向进入项目并生成页面节奏表",()=>{
  const plan=buildDeckPlan({templateId:"data-light",slideCount:10,designSpec:{density:"high",brandName:"测试品牌"}});
  assert.equal(plan.schemaVersion,5);
  assert.equal(plan.designSpec.direction,"data-light");
  assert.equal(plan.designSpec.brandName,"测试品牌");
  assert.equal(plan.rhythmPlan.length,plan.slides.length);
  assert.ok(new Set(plan.slides.slice(1,-1).map(x=>x.layoutId)).size>=7);
});

test("锁定版式合同能识别容量超限和缺少图表数据",()=>{
  const slide={layoutId:"chart-bar",type:"content",title:"测试图表",bullets:Array.from({length:12},(_,i)=>"要点"+i),content:{}};
  const issues=globalThis.PptComponents.inspect(slide,1);
  assert.ok(issues.some(x=>x.code==="capacity"));
  assert.ok(issues.some(x=>x.code==="missing_series"));
  assert.ok(issues.every(x=>x.severity==="warning"));
});

test("PPT导出模式默认所见即所得，真实母页必须显式选择",()=>{
  assert.equal(buildDeckPlan({templateId:"business-blue-160",slideCount:5}).exportMode,"preview");
  assert.equal(buildDeckPlan({templateId:"business-blue-160",exportMode:"native",slideCount:5}).exportMode,"native");
});
