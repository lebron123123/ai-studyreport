import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "../local-server/node_modules/jszip/lib/index.js";
import {buildPptxBuffer} from "../local-server/ppt-export.js";
import "../ppt-core.js";

test("本地PPT导出器生成可解压且包含逐页XML与演讲者备注的PPTX",async()=>{
  const plan=globalThis.PptCore.buildDeckPlan({title:"导出回归测试",slideCount:5,sourceText:"# 背景\n测试背景。\n# 结论\n测试结论。"});
  plan.slides[1].sources=["测试资料.xlsx | Sheet1!B2 | 2026-08"];
  const buf=await buildPptxBuffer(plan);assert.ok(Buffer.isBuffer(buf));assert.ok(buf.length>10000);assert.equal(buf.subarray(0,2).toString(),"PK");
  const zip=await JSZip.loadAsync(buf),files=Object.keys(zip.files);assert.ok(files.includes("ppt/slides/slide1.xml"));assert.equal(files.filter(x=>/^ppt\/slides\/slide\d+\.xml$/.test(x)).length,plan.slides.length);assert.ok(files.some(x=>x.startsWith("ppt/notesSlides/notesSlide")));
});

test("动态组件可在同一份PPTX中输出指标、流程、图表和表格",async()=>{
  const plan=globalThis.PptCore.buildDeckPlan({title:"动态组件测试",slides:[
    {type:"cover",layoutId:"cover",title:"动态组件测试"},
    {layoutId:"metric",title:"核心指标",content:{metrics:[{label:"总投资",value:"5.2亿元"},{label:"IRR",value:"6.8%"}]},sources:["测算.xlsx｜B2"]},
    {layoutId:"timeline",title:"实施步骤",content:{steps:[{label:"启动",text:"资料确认"},{label:"决策",text:"完成审议"}]}},
    {layoutId:"chart-bar",title:"年度投资",content:{series:[{label:"2027",value:40},{label:"2028",value:60}]},sources:["投资计划表.xlsx"]},
    {layoutId:"table",title:"方案对比",content:{headers:["方案","投资"],rows:[["A",100],["B",120]]},sources:["方案表.xlsx"]},
    {type:"conclusion",layoutId:"conclusion",title:"建议推进",bullets:["完成复核后进入决策"]}
  ]});
  const buf=await buildPptxBuffer(plan),zip=await JSZip.loadAsync(buf),files=Object.keys(zip.files);assert.equal(files.filter(x=>/^ppt\/slides\/slide\d+\.xml$/.test(x)).length,6);assert.ok(files.some(x=>x.startsWith("ppt/charts/chart")));
});
