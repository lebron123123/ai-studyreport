import test from "node:test";
import assert from "node:assert/strict";
import { parseSlideXml,parseThemeXml } from "../scripts/ppt-template-inventory.mjs";

test("PPT模板盘点能识别图表、图片、文字、颜色和布局指纹",()=>{
  const xml=`<p:sld xmlns:p="p" xmlns:a="a" xmlns:c="c"><p:sp><a:rPr sz="2400"><a:latin typeface="Microsoft YaHei"/></a:rPr><a:t>投资计划结论</a:t><a:solidFill><a:srgbClr val="2387C7"/></a:solidFill></p:sp><p:pic/><p:graphicFrame><c:chart r:id="rId2"/></p:graphicFrame></p:sld>`;
  const rels=`<Relationships><Relationship Id="rId1" Type="http://x/slideLayout" Target="../slideLayouts/slideLayout3.xml"/><Relationship Id="rId2" Type="http://x/chart" Target="../charts/chart1.xml"/></Relationships>`;
  const meta=parseSlideXml(xml,{page:6,layout:"slideLayout3.xml",relationshipXml:rels});
  assert.equal(meta.page,6);assert.equal(meta.title,"投资计划结论");assert.equal(meta.pictureCount,1);assert.equal(meta.chartCount,1);assert.equal(meta.colors[0].value,"2387C7");assert.equal(meta.fonts[0].value,"Microsoft YaHei");assert.equal(meta.family,"chart");assert.match(meta.fingerprint,/chart\|slideLayout3\.xml/);
});

test("PPT模板盘点能把流程节点页面归入流程时间轴",()=>{
  const xml=`<p:sld xmlns:p="p" xmlns:a="a"><p:sp><a:t>项目实施阶段</a:t></p:sp><p:cxnSp/><p:cxnSp/><p:cxnSp/><p:sp/><p:sp/></p:sld>`;
  const meta=parseSlideXml(xml,{page:20,layout:"slideLayout8.xml"});
  assert.equal(meta.connectorCount,3);assert.equal(meta.family,"process-timeline");
});

test("PPT模板盘点能提取主题色与主题字体",()=>{
  const xml=`<a:theme xmlns:a="a"><a:themeElements><a:clrScheme name="商务蓝"><a:dk1><a:sysClr val="windowText" lastClr="111827"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:accent1><a:srgbClr val="2387C7"/></a:accent1></a:clrScheme><a:fontScheme><a:majorFont><a:latin typeface="Arial"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`;
  const theme=parseThemeXml(xml);
  assert.equal(theme.name,"商务蓝");assert.equal(theme.colors.dk1,"111827");assert.equal(theme.colors.accent1,"2387C7");assert.equal(theme.majorFont,"Arial");assert.equal(theme.minorFont,"Calibri");
});
