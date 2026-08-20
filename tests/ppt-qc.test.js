import test from "node:test";
import assert from "node:assert/strict";
import "../ppt-components.js";
import "../ppt-core.js";
import "../ppt-qc.js";

const {PptCore,PptQC}=globalThis;

test("视觉QA能识别标题、内容容量和低对比度问题",()=>{
  const plan=PptCore.buildDeckPlan({title:"QA",slides:[
    {type:"cover",layoutId:"cover",title:"QA"},
    {layoutId:"three-cards",title:"这是一个明显超过正常展示长度并会造成标题区域拥挤压缩的超长页面标题用于测试视觉质量检查以及自动修复机制",bullets:["一","二","三","四","五"],sources:["测试"]},
    {type:"conclusion",layoutId:"conclusion",title:"结论"}
  ]});
  plan.designSpec={...(plan.designSpec||{}),background:"FFFFFF",text:"FDFDFD"};
  const result=PptQC.inspect(plan);
  assert.equal(result.ok,false);
  assert.ok(result.issues.some(x=>x.code==="title_overflow"));
  assert.ok(result.issues.some(x=>x.code==="content_overflow"));
  assert.ok(result.issues.some(x=>x.code==="contrast_text"));
});

test("视觉QA会拆分超载页面并保持页码、节奏一致",()=>{
  const plan=PptCore.buildDeckPlan({title:"QA",slides:[
    {type:"cover",layoutId:"cover",title:"QA"},
    {layoutId:"three-cards",title:"三项重点",bullets:["一","二","三","四","五","六"],sources:["测试"]},
    {type:"conclusion",layoutId:"conclusion",title:"结论"}
  ]});
  const fixed=PptQC.repair(plan).plan;
  assert.ok(fixed.slides.length>plan.slides.length);
  assert.deepEqual(fixed.slides.map(x=>x.order),fixed.slides.map((_,i)=>i+1));
  assert.equal(fixed.rhythmPlan.length,fixed.slides.length);
});

test("人工锁定页即使超载也保持原样",()=>{
  const plan=PptCore.buildDeckPlan({title:"QA",slides:[
    {type:"cover",layoutId:"cover",title:"QA"},
    {layoutId:"three-cards",title:"锁定页",locked:true,bullets:["一","二","三","四","五"]},
    {type:"conclusion",layoutId:"conclusion",title:"结论"}
  ]}),before=JSON.stringify(plan.slides[1]);
  const fixed=PptQC.repair(plan).plan;
  assert.equal(JSON.stringify(fixed.slides[1]),before);
});

test("视觉QA重复执行不会反复制造续页",()=>{
  const plan=PptCore.buildDeckPlan({title:"QA",slides:[
    {type:"cover",layoutId:"cover",title:"QA"},
    {layoutId:"three-cards",title:"超载页",bullets:["一","二","三","四","五","六"],sources:["测试"]},
    {type:"conclusion",layoutId:"conclusion",title:"结论"}
  ]});
  const once=PptQC.repair(plan).plan,twice=PptQC.repair(once).plan;
  assert.equal(twice.slides.length,once.slides.length);
  assert.equal(twice.slides.filter(x=>String(x.id).includes("_qa_")).length,1);
});
