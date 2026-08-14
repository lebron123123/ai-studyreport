import test from "node:test";
import assert from "node:assert/strict";
import "../ppt-evidence.js";
import "../ppt-components.js";
import "../ppt-core.js";

test("多材料形成含数字事实、表格和来源的Evidence Pack",()=>{
  const pack=globalThis.PptEvidence.buildEvidencePack([
    {name:"项目说明.docx",text:"总建筑面积61900.75㎡。\n项目总投资5.2亿元。"},
    {name:"测算.xlsx",text:"年度,收入\n2028,1200万元",sheets:[{name:"收入表",range:"A1:B2",rows:[["年度","收入"],[2028,1200]]}]}
  ]);
  assert.equal(pack.assets.length,2);assert.ok(pack.facts.length>=2);assert.equal(pack.tables.length,1);assert.equal(pack.sourceRefs[1].label,"测算.xlsx");
});

test("AI SlideSpec解析并保留动态组件和来源",()=>{
  const raw=JSON.stringify({title:"项目决策汇报",communicationJob:"支持决策",centralTakeaway:"项目可推进",slides:[
    {type:"cover",layoutId:"cover",title:"项目决策汇报"},
    {type:"content",layoutId:"metric",title:"关键指标支撑项目推进",content:{metrics:[{label:"总投资",value:"5.2亿元"}]},sources:["测算.xlsx｜Sheet1!B2"]},
    {type:"conclusion",layoutId:"conclusion",title:"建议完成复核后推进",bullets:["复核参数"]}
  ]});
  const plan=globalThis.PptCore.parseAiPlan(raw,{templateId:"anju-blue"});assert.equal(plan.generationMode,"ai");assert.equal(plan.slides[1].layoutId,"metric");assert.equal(plan.slides[1].sources.length,1);
});

test("AI不可用时仍能从证据包生成多组件可追溯方案",()=>{
  const pack=globalThis.PptEvidence.buildEvidencePack([{name:"资料.txt",text:"项目总投资52000万元。\n建设期3年。"}]);
  const plan=globalThis.PptCore.fallbackAiPlan({title:"测试汇报",slideCount:8,evidencePack:pack,sourceRefs:pack.sourceRefs});
  assert.equal(plan.slides.length,8);assert.equal(plan.generationMode,"fallback");assert.ok(plan.slides.some(x=>x.layoutId==="metric"));assert.equal(globalThis.PptCore.validateDeckPlan(plan).ok,true);
});
