import test from "node:test";
import assert from "node:assert/strict";
import { fillNativeSlideXml, nativeTemplateEligible, replaceNativeImageSlots, selectNativePages } from "../local-server/ppt-native-template.js";

test("非160页模板可用显式页码进入原生占位符链路", () => {
  const plan = { templateId: "youth-housing", nativeTemplate: true, nativeTemplateMode: "explicit-pages", slides: [
    { layoutId: "cover", templatePage: 1 },
    { layoutId: "table", templatePage: 22 },
    { layoutId: "image-story", templatePage: 24 }
  ] };
  assert.equal(nativeTemplateEligible(plan), true);
  assert.deepEqual(selectNativePages(plan).map(item => item.page), [1, 22, 24]);
});

test("严格Shape ID模式只改合同指定对象，其他模板文字保持不变", () => {
  const xml = '<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="21" name="标题"/></p:nvSpPr><p:txBody><a:p><a:r><a:t>旧标题</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="22" name="装饰文字"/></p:nvSpPr><p:txBody><a:p><a:r><a:t>必须保留</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>';
  const slide = { templateFillMode: "strict-shape-id", templateFillPlan: { actions: [
    { sourceId: "21", action: "replace-text", value: "青年人才住房项目" }
  ] } };
  const out = fillNativeSlideXml(xml, slide, {}, 1);
  assert.match(out, /青年人才住房项目/);
  assert.match(out, /必须保留/);
});

test("严格Shape ID模式遇到合同中不存在的文字槽位必须失败",()=>{
  const xml='<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="21" name="标题"/></p:nvSpPr><p:txBody><a:p><a:r><a:t>旧标题</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>';
  assert.throws(()=>fillNativeSlideXml(xml,{templateFillMode:"strict-shape-id",templateFillPlan:{actions:[{sourceId:"999",action:"replace-text",value:"新标题"}]}},{},1),/未找到文字Shape ID：999/);
});

test("图片占位符按原始Shape ID替换媒体关系并保留源页构图",async()=>{
  const files=new Map(),zip={file(name,value){if(arguments.length>1){files.set(name,value);return this;}return files.get(name);}},xml='<p:sld><p:cSld><p:spTree><p:pic><p:nvPicPr><p:cNvPr id="31" name="项目图片"/></p:nvPicPr><p:blipFill><a:blip r:embed="rId7"/></p:blipFill></p:pic></p:spTree></p:cSld></p:sld>',rels='<?xml version="1.0"?><Relationships><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>',data='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z8ZkAAAAASUVORK5CYII=';
  const out=await replaceNativeImageSlots(zip,xml,rels,{templateFillPlan:{actions:[{sourceId:"31",action:"replace-image",value:data}]}},4);
  assert.equal(out.replaced,1);
  assert.match(out.relsXml,/\.\.\/media\/custom_tpl_p4_s31_1\.png/);
  assert.ok(files.get("ppt/media/custom_tpl_p4_s31_1.png"));
  assert.equal(out.slideXml,xml);
});
