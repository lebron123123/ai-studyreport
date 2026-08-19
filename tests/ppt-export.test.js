import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "../local-server/node_modules/jszip/lib/index.js";
import {buildPptxBuffer,validatePptxBuffer} from "../local-server/ppt-export.js";
import "../ppt-design-tokens.js";
import "../ppt-layout-recipes.js";
import "../ppt-component-registry.js";
import "../ppt-components.js";
import "../ppt-core.js";

test("本地PPT导出器生成可解压且包含逐页XML与演讲者备注的PPTX",async()=>{
  const plan=globalThis.PptCore.buildDeckPlan({title:"导出回归测试",slideCount:5,sourceText:"# 背景\n测试背景。\n# 结论\n测试结论。"});
  plan.slides[1].sources=["测试资料.xlsx | Sheet1!B2 | 2026-08"];
  const buf=await buildPptxBuffer(plan);assert.ok(Buffer.isBuffer(buf));assert.ok(buf.length>10000);assert.equal(buf.subarray(0,2).toString(),"PK");
  const zip=await JSZip.loadAsync(buf),files=Object.keys(zip.files);assert.ok(files.includes("ppt/slides/slide1.xml"));assert.equal(files.filter(x=>/^ppt\/slides\/slide\d+\.xml$/.test(x)).length,plan.slides.length);assert.ok(files.some(x=>x.startsWith("ppt/notesSlides/notesSlide")));
  const qa=await validatePptxBuffer(buf,plan);assert.equal(qa.ok,true);assert.equal(qa.slideCount,plan.slides.length);
});

test("PPTX结构质检能拦截空文件与页数不一致",async()=>{
  const empty=await validatePptxBuffer(Buffer.alloc(8),{slides:[{}]});assert.equal(empty.ok,false);
  const plan=globalThis.PptCore.buildDeckPlan({title:"页数校验",slideCount:5}),buf=await buildPptxBuffer(plan),wrong=await validatePptxBuffer(buf,{slides:[{},{}]});
  assert.equal(wrong.ok,false);assert.ok(wrong.errors.some(x=>x.includes("页数")));
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

test("图片页会把本地data URL真正写入PPT媒体资源",async()=>{
  const image="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4x8AAAAASUVORK5CYII=";
  const plan=globalThis.PptCore.buildDeckPlan({slides:[{type:"cover",layoutId:"cover",title:"图片测试"},{layoutId:"image-hero",title:"项目效果",claim:"项目形象清晰",content:{image}},{type:"conclusion",layoutId:"conclusion",title:"结束"}]});
  const buf=await buildPptxBuffer(plan),zip=await JSZip.loadAsync(buf),files=Object.keys(zip.files);
  assert.ok(files.some(x=>x.startsWith("ppt/media/image")));
});

test("高级商务蓝模板能导出并写入真实主色",async()=>{
  const plan=globalThis.PptCore.buildDeckPlan({title:"商务蓝导出",templateId:"business-blue-160",slideCount:5});
  const buf=await buildPptxBuffer(plan),zip=await JSZip.loadAsync(buf);
  const slide1=await zip.file("ppt/slides/slide1.xml").async("text");
  assert.match(slide1,/003591/i);
  const qa=await validatePptxBuffer(buf,plan);assert.equal(qa.ok,true);
});

test("第二三批高级配方可共同输出为可编辑PPTX",async()=>{
  const plan=globalThis.PptCore.buildDeckPlan({title:"高级配方回归",templateId:"business-blue-160",slides:[
    {type:"cover",layoutId:"cover",title:"高级配方回归"},
    {type:"content",layoutId:"bullets",title:"项目判断需要同时看价值与风险",bullets:["政策目标明确","建设条件可控","资金安排可落地","运营边界需确认"]},
    {type:"content",layoutId:"comparison",title:"投资分摊模型对比：选择最优策略",bullets:["一次性投入：节点型支出","平均分摊：简单稳定","前高后低：启动投入较大","S型分摊：与工程进度更匹配"]},
    {type:"content",layoutId:"risk",title:"四类风险均应配置控制动作",bullets:["需求风险：复核客群","工期风险：锁定节点","资金风险：覆盖峰值","合规风险：前置审查"]},
    {type:"content",layoutId:"chart-line",title:"年度指标保持改善趋势",claim:"趋势支持继续推进",content:{series:[{label:"2024",value:42},{label:"2025",value:45},{label:"2026",value:48}]},sources:["测算.xlsx|Sheet1!B2:D2"]},
    {type:"conclusion",layoutId:"conclusion",title:"建议完成复核后推进",bullets:["确认参数","锁定计划","提交决策"]}
  ]});
  assert.equal(plan.slides[2].recipeId,"compare-scorecard");
  const buf=await buildPptxBuffer(plan),qa=await validatePptxBuffer(buf,plan);assert.equal(qa.ok,true);assert.equal(qa.slideCount,6);assert.equal(qa.chartCount,1);
});
