import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import JSZip from "../local-server/node_modules/jszip/lib/index.js";
import { buildNativeTemplatePptx, fillNativeSlideXml, nativeTemplateEligible, replacePresentationSlideList, selectNativePages } from "../local-server/ppt-native-template.js";
import { buildPptxBuffer, validatePptxBuffer } from "../local-server/ppt-export.js";

const PptxGenJS=createRequire(new URL('../local-server/package.json',import.meta.url))('pptxgenjs');
const imageBytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY9sAAAAASUVORK5CYII=','base64');
let templatePath,templateDirectory,templateBytes;
const previousTemplate=process.env.PPT_BUSINESS_BLUE_TEMPLATE;

test.before(async()=>{
  // The fixture is authored here: CI never needs a user's private source deck.
  // Use all 160 source slots so normal page selection and relationship rewrites
  // run unchanged, including the end-of-deck conclusion page.
  const pptx=new PptxGenJS();pptx.layout='LAYOUT_WIDE';
  for(let page=1;page<=160;page++){
    const slide=pptx.addSlide();
    slide.addText('工作汇报',{x:0.6,y:0.5,w:10,h:0.8,fontSize:32});
    slide.addText('Here you can describe the main work report content.',{x:0.6,y:1.5,w:9,h:1,fontSize:16});
    slide.addImage({data:'image/png;base64,'+imageBytes.toString('base64'),x:11,y:0.5,w:0.5,h:0.5});
  }
  templateBytes=Buffer.from(await pptx.write({outputType:'nodebuffer',compression:true}));
  templateDirectory=await fs.mkdtemp(path.join(os.tmpdir(),'native-template-ci-'));
  templatePath=path.join(templateDirectory,'synthetic-160.pptx');
  await fs.writeFile(templatePath,templateBytes);
  process.env.PPT_BUSINESS_BLUE_TEMPLATE=templatePath;
});
test.after(async()=>{
  if(previousTemplate===undefined)delete process.env.PPT_BUSINESS_BLUE_TEMPLATE;
  else process.env.PPT_BUSINESS_BLUE_TEMPLATE=previousTemplate;
  if(templateDirectory){
    assert.equal(path.dirname(path.resolve(templateDirectory)),path.resolve(os.tmpdir()));
    assert.ok(path.basename(templateDirectory).startsWith('native-template-ci-'));
    await fs.rm(templateDirectory,{recursive:true,force:true});
  }
});

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

test("合成160页模板完整导出选中页，保留原生形状和图片且不改源文件",async()=>{
  const plan={title:"[系统测试]原生模板",templateId:"business-blue-160",nativeTemplate:true,purpose:"验证模板装配",slides:[
    {layoutId:"cover",title:"[系统测试]原生模板",subtitle:"直接复用母页"},
    {layoutId:"agenda",title:"汇报结构",content:{items:[{text:"项目背景"},{text:"测算结论"},{text:"风险与行动"}]}},
    {layoutId:"timeline",title:"实施路径",content:{steps:[{label:"资料",text:"完成归集"},{label:"复核",text:"确认口径"}]}},
    {layoutId:"conclusion",title:"下一步行动",bullets:["确认参数","提交审议"]}
  ]};
  const buffer=await buildNativeTemplatePptx(plan,{templatePath});
  const zip=await JSZip.loadAsync(buffer),original=await JSZip.loadAsync(templateBytes);
  const presentation=await zip.file("ppt/presentation.xml").async("string");
  assert.equal((presentation.match(/<p:sldId\b/g)||[]).length,4);
  const sourcePages=selectNativePages(plan).map(item=>item.page);
  for(let index=0;index<sourcePages.length;index++){
    const name=`ppt/slides/slide${sourcePages[index]}.xml`;
    const xml=await zip.file(name).async('string'),sourceXml=await original.file(name).async('string');
    assert.ok(xml.includes(plan.slides[index].title));
    assert.equal((xml.match(/<p:sp>/g)||[]).length,(sourceXml.match(/<p:sp>/g)||[]).length);
    assert.equal((xml.match(/<p:pic>/g)||[]).length,1);
  }
  const media=Object.keys(zip.files).filter(name=>name.startsWith('ppt/media/')&&!zip.files[name].dir);
  assert.ok(media.length>0);
  assert.deepEqual(await zip.file(media[0]).async('nodebuffer'),imageBytes);
  assert.deepEqual(await fs.readFile(templatePath),templateBytes);
  const qa=await validatePptxBuffer(buffer,plan);
  assert.equal(qa.ok,true,JSON.stringify(qa.errors));assert.equal(qa.slideCount,4);assert.equal(qa.nativeTemplate,true);
});

test("合成原生封面与可编辑图表通过正式导出入口混合，保留图表数据",async()=>{
  const plan={title:"[系统测试]混合模板",templateId:"business-blue-160",hybridTemplate:true,purpose:"验证逐页双轨",slides:[
    {id:"s1",type:"cover",layoutId:"cover",title:"[系统测试]混合模板",renderTrack:"native"},
    {id:"s2",type:"content",layoutId:"chart-bar",title:"年度投资计划",renderTrack:"editable",content:{series:[{label:"2027",value:40},{label:"2028",value:60}]},sources:["测算引擎"]},
    {id:"s3",type:"conclusion",layoutId:"conclusion",title:"建议推进",renderTrack:"native",bullets:["确认参数","提交审议"]}
  ]};
  const buffer=await buildPptxBuffer(plan),zip=await JSZip.loadAsync(buffer);
  const cover=await zip.file('ppt/slides/slide1.xml').async('string');
  assert.match(cover,/\[系统测试\]混合模板/);assert.equal((cover.match(/<p:pic>/g)||[]).length,1);
  const rels=await zip.file('ppt/slides/_rels/slide1.xml.rels').async('string');
  const nativeImage=rels.match(/Target="\.\.\/media\/(native_[^"]+)"/);
  assert.ok(nativeImage,'Native image relationship must be copied and relinked');
  assert.deepEqual(await zip.file('ppt/media/'+nativeImage[1]).async('nodebuffer'),imageBytes);
  const chartName=Object.keys(zip.files).find(name=>/^ppt\/charts\/chart\d+\.xml$/.test(name));
  assert.ok(chartName,'Editable page must retain a native chart, not a picture');
  const chart=await zip.file(chartName).async('string');
  for(const value of ['2027','2028','40','60'])assert.ok(chart.includes(`<c:v>${value}</c:v>`));
  const qa=await validatePptxBuffer(buffer,plan);
  assert.equal(qa.ok,true,JSON.stringify(qa.errors));assert.equal(qa.slideCount,3);assert.ok(qa.chartCount>=1);
  assert.deepEqual(await fs.readFile(templatePath),templateBytes);
});
