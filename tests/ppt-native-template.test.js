import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "../local-server/node_modules/jszip/lib/index.js";
import { buildNativeTemplatePptx, fillNativeSlideXml, nativeTemplateEligible, replacePresentationSlideList, resolveNativeTemplatePath, selectNativePages } from "../local-server/ppt-native-template.js";
import { validatePptxBuffer } from "../local-server/ppt-export.js";

test("真实模板页面选择会按版式分配并避免常用页重复",()=>{
  const plan={templateId:"business-blue-160",nativeTemplate:true,slides:[
    {layoutId:"cover"},{layoutId:"agenda"},{layoutId:"timeline"},{layoutId:"timeline"},{layoutId:"risk"},{layoutId:"conclusion"}
  ]};
  assert.equal(nativeTemplateEligible(plan),true);
  const pages=selectNativePages(plan).map(x=>x.page);
  assert.equal(pages.length,6);
  assert.equal(new Set(pages).size,6);
  assert.equal(pages[0],1);
  assert.ok([6,7,8,9,10].includes(pages[1]));
});

test("已确认的模板页可通过占位符合同显式锁定",()=>{
  const plan={templateId:"business-blue-160",nativeTemplate:true,slides:[{layoutId:"timeline",templatePage:30}]};
  const selected=selectNativePages(plan)[0];
  assert.equal(selected.page,30);
  assert.equal(selected.selectionMode,"explicit-contract");
});

test("图表和表格页在完成原生数据槽位前不会误用静态模板数据",()=>{
  const plan={templateId:"business-blue-160",nativeTemplate:true,slides:[{layoutId:"cover"},{layoutId:"chart-bar"}]};
  assert.equal(nativeTemplateEligible(plan),false);
});

test("演示文稿页列表可按真实模板源页重新排序",()=>{
  const presentation='<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>';
  const rels='<Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/><Relationship Id="rId2" Target="slides/slide8.xml"/></Relationships>';
  const out=replacePresentationSlideList(presentation,rels,[8,1]);
  assert.ok(out.indexOf('r:id="rId2"')<out.indexOf('r:id="rId1"'));
});

test("真实模板文字槽位替换保留形状结构",()=>{
  const xml='<p:sld><p:cSld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:rPr sz="3200"/><a:t>工作汇报</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:spPr><a:xfrm><a:off x="0" y="1000000"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:rPr sz="1600"/><a:t>Here you can describe the main work report content.</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>';
  const out=fillNativeSlideXml(xml,{layoutId:"cover",title:"项目决策汇报",subtitle:"经营班子审议"},{title:"项目决策汇报",purpose:"经营班子审议"},1);
  assert.match(out,/项目决策汇报/);
  assert.match(out,/经营班子审议/);
  assert.equal((out.match(/<p:sp>/g)||[]).length,2);
});

test("原生模板优先按shape id填充，不依赖旧占位文字",()=>{
  const xml='<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="21" name="标题 1"/></p:nvSpPr><p:txBody><a:p><a:r><a:rPr sz="3200"/><a:t>任意旧标题</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>';
  const slide={layoutId:"bullets",title:"不会覆盖显式值",templateFillPlan:{actions:[{sourceId:"21",action:"replace-text",value:"按槽位合同写入"}]}};
  const out=fillNativeSlideXml(xml,slide,{title:"项目"},57);
  assert.match(out,/按槽位合同写入/);
  assert.doesNotMatch(out,/不会覆盖显式值/);
});

const templatePath=resolveNativeTemplatePath();
test("本机160页模板可生成只展示工程页数的原生PPTX",{skip:!templatePath},async()=>{
  const plan={title:"真实模板回归",templateId:"business-blue-160",nativeTemplate:true,purpose:"验证真实母页",audience:"项目决策人员",designSpec:{brandName:"深安居"},slides:[
    {layoutId:"cover",title:"真实模板回归",subtitle:"直接复用母页"},
    {layoutId:"agenda",title:"汇报结构",content:{items:[{text:"项目背景"},{text:"测算结论"},{text:"风险与行动"}]}},
    {layoutId:"timeline",title:"实施路径",content:{steps:[{label:"资料",text:"完成归集"},{label:"复核",text:"确认口径"},{label:"决策",text:"形成结论"}]}},
    {layoutId:"conclusion",title:"下一步行动",bullets:["确认参数","提交审议"]}
  ]};
  const buffer=await buildNativeTemplatePptx(plan,{templatePath});
  const zip=await JSZip.loadAsync(buffer),presentation=await zip.file("ppt/presentation.xml").async("string");
  assert.equal((presentation.match(/<p:sldId\b/g)||[]).length,4);
  assert.ok(Object.keys(zip.files).filter(x=>x.startsWith("ppt/media/")).length>20);
  const qa=await validatePptxBuffer(buffer,plan);
  assert.equal(qa.ok,true);
  assert.equal(qa.slideCount,4);
  assert.equal(qa.nativeTemplate,true);
});

test("真实模板页和可编辑图表页可混合导出",{skip:!templatePath},async()=>{
  const plan={title:"混合双轨验收",templateId:"business-blue-160",hybridTemplate:true,purpose:"验证逐页双轨",slides:[
    {id:"s1",type:"cover",layoutId:"cover",title:"混合双轨验收",renderTrack:"native"},
    {id:"s2",type:"content",layoutId:"chart-bar",title:"年度投资计划",renderTrack:"editable",content:{series:[{label:"2027",value:40},{label:"2028",value:60}]},sources:["测算引擎"]},
    {id:"s3",type:"conclusion",layoutId:"conclusion",title:"建议推进",renderTrack:"native",bullets:["确认参数","提交审议"]}
  ]};
  const buffer=await (await import("../local-server/ppt-export.js")).buildPptxBuffer(plan),zip=await JSZip.loadAsync(buffer),slide1=await zip.file("ppt/slides/slide1.xml").async("string");
  assert.match(slide1,/混合双轨验收/);assert.ok(Object.keys(zip.files).some(x=>x.startsWith("ppt/charts/chart")));
  const qa=await validatePptxBuffer(buffer,plan);assert.equal(qa.ok,true);assert.equal(qa.slideCount,3);assert.ok(qa.chartCount>=1);
});
