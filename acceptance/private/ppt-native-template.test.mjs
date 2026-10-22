import '../../scripts/windows-browser-lockout-guard.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from '../../local-server/node_modules/jszip/lib/index.js';
import {buildNativeTemplatePptx,resolveNativeTemplatePath} from '../../local-server/ppt-native-template.js';
import {validatePptxBuffer} from '../../local-server/ppt-export.js';

// This acceptance suite requires the actual private template; missing input is
// a failure, never a skipped test. Public CI uses generated samples separately.
const templatePath=resolveNativeTemplatePath();
assert.ok(templatePath,'Private 160-page template is required; configure PPT_BUSINESS_BLUE_TEMPLATE.');
test("本机160页模板可生成只展示工程页数的原生PPTX",async()=>{
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

test("真实模板页和可编辑图表页可混合导出",async()=>{
  const plan={title:"混合双轨验收",templateId:"business-blue-160",hybridTemplate:true,purpose:"验证逐页双轨",slides:[
    {id:"s1",type:"cover",layoutId:"cover",title:"混合双轨验收",renderTrack:"native"},
    {id:"s2",type:"content",layoutId:"chart-bar",title:"年度投资计划",renderTrack:"editable",content:{series:[{label:"2027",value:40},{label:"2028",value:60}]},sources:["测算引擎"]},
    {id:"s3",type:"conclusion",layoutId:"conclusion",title:"建议推进",renderTrack:"native",bullets:["确认参数","提交审议"]}
  ]};
  const buffer=await (await import("../../local-server/ppt-export.js")).buildPptxBuffer(plan),zip=await JSZip.loadAsync(buffer),slide1=await zip.file("ppt/slides/slide1.xml").async("string");
  assert.match(slide1,/混合双轨验收/);assert.ok(Object.keys(zip.files).some(x=>x.startsWith("ppt/charts/chart")));
  const qa=await validatePptxBuffer(buffer,plan);assert.equal(qa.ok,true);assert.equal(qa.slideCount,3);assert.ok(qa.chartCount>=1);
});
