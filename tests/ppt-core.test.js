import test from "node:test";
import assert from "node:assert/strict";
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
