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
  const evidence=globalThis.PptEvidence.evidenceText(pack);
  assert.match(evidence,/\[结构化数字事实\]/);
  assert.match(evidence,/\[结构化表格/);
  assert.match(evidence,/年度 \| 收入/);
});

test("AI SlideSpec解析并保留动态组件和来源",()=>{
  const raw=JSON.stringify({title:"项目决策汇报",communicationJob:"支持决策",centralTakeaway:"项目可推进",slides:[
    {type:"cover",layoutId:"cover",title:"项目决策汇报"},
    {type:"content",layoutId:"metric",title:"关键指标支撑项目推进",content:{metrics:[{label:"总投资",value:"5.2亿元"}]},sources:["测算.xlsx｜Sheet1!B2"]},
    {type:"conclusion",layoutId:"conclusion",title:"建议完成复核后推进",bullets:["复核参数"]}
  ]});
  const plan=globalThis.PptCore.parseAiPlan(raw,{templateId:"anju-blue"});assert.equal(plan.generationMode,"ai");assert.equal(plan.slides[1].layoutId,"metric");assert.equal(plan.slides[1].contentStatus,"evidence-gap");assert.equal(plan.slides[1].sources.length,1);
});

test("视觉导演会纠正非数字指标卡且不修改人工锁定页",()=>{
  const plan=globalThis.PptCore.buildDeckPlan({slides:[
    {type:"cover",layoutId:"cover",title:"测试"},
    {layoutId:"metric",title:"投资比例",bullets:["土地成本、竣工阶段","平均分摊","前高后低","S型分摊"],content:{metrics:[{label:"一次性投入",value:"土地成本、竣工阶段"},{label:"平均分摊",value:"25%×4季度"},{label:"前高后低",value:"40/30/20/10"},{label:"S型分摊",value:"5/15/30/30/15/5"}]}},
    {layoutId:"metric",title:"人工锁定",locked:true,content:{metrics:[{label:"说明",value:"不是数字"}]}},
    {type:"conclusion",layoutId:"conclusion",title:"结束"}
  ]});
  assert.equal(plan.slides[1].layoutId,"matrix");assert.equal(plan.slides[1].content.items.length,4);
  assert.equal(plan.slides[2].layoutId,"metric");
  assert.ok(globalThis.PptComponents.inspect(plan.slides[2],2).some(x=>x.code==="metric_value_not_numeric"));
});

test("图片材料会保留到证据包并自动配置给图片页",()=>{
  const dataUrl="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4x8AAAAASUVORK5CYII=";
  const pack=globalThis.PptEvidence.buildEvidencePack([{name:"项目效果图.png",kind:"image",text:"图片素材",dataUrl,width:1,height:1}]);
  const plan=globalThis.PptCore.buildDeckPlan({evidencePack:pack,slides:[{type:"cover",layoutId:"cover",title:"测试"},{layoutId:"image-hero",title:"项目效果图",content:{}},{type:"conclusion",layoutId:"conclusion",title:"结束"}]});
  assert.equal(pack.summary.imageCount,1);assert.equal(plan.slides[1].content.image,dataUrl);assert.equal(plan.slides[1].content.imageAssetId,pack.assets[0].id);
});

test("AI不可用时仍能从证据包生成多组件可追溯方案",()=>{
  const pack=globalThis.PptEvidence.buildEvidencePack([{name:"资料.txt",text:"项目总投资52000万元。\n建设期3年。"}]);
  const plan=globalThis.PptCore.fallbackAiPlan({title:"测试汇报",slideCount:8,evidencePack:pack,sourceRefs:pack.sourceRefs});
  assert.equal(plan.slides.length,8);assert.equal(plan.generationMode,"fallback");assert.ok(plan.slides.some(x=>x.layoutId==="metric"));assert.equal(globalThis.PptCore.validateDeckPlan(plan).ok,true);
});
