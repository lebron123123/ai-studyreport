const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const root=path.resolve(__dirname,"..");
const templatePath=path.join(root,"data","report-table-templates-rent-v1.json");
const templateRaw=fs.readFileSync(templatePath,"utf8");
const templateSet=JSON.parse(templateRaw);
const housingSet=JSON.parse(fs.readFileSync(path.join(root,"data","report-table-templates-gaibao-housing-v1.json"),"utf8"));
const commercialSet=JSON.parse(fs.readFileSync(path.join(root,"data","report-table-templates-gaibao-commercial-v1.json"),"utf8"));
global.fetch=async url=>({ok:true,json:async()=>String(url).includes("gaibao-housing")?housingSet:String(url).includes("gaibao-commercial")?commercialSet:templateSet});
const ReportTableTemplates=require("../report-table-templates.js");

test("出租类模板采用无损紧凑存储，运行时结构和展示字段不变",()=>{
  assert.equal(templateRaw,JSON.stringify(templateSet));
  assert.ok(Buffer.byteLength(templateRaw)<1_100_000);
  assert.equal(templateSet.templates.length,33);
  assert.equal(templateSet.templates.flatMap(t=>t.segments).length,61);
});

test("出租类Word表格归并为33套逻辑模板并完整覆盖70张源表",async()=>{
  await ReportTableTemplates.load("rent");
  assert.deepEqual(ReportTableTemplates.stats("rent"),{templates:33,physicalTables:70,appendix:7,longPeriod:6});
  const sourceTables=templateSet.templates.flatMap(t=>t.sourceTableNumbers);
  assert.equal(new Set(sourceTables).size,61);
  assert.equal(templateSet.source.mappedPhysicalTableCount,61);
  assert.equal(templateSet.source.excludedPhysicalTables.flatMap(x=>x.numbers).length,9);
  assert.equal(new Set(sourceTables.concat(templateSet.source.excludedPhysicalTables.flatMap(x=>x.numbers))).size,70);
});

test("项目专属数值全部置空，但表头、行项目和合并关系保留",async()=>{
  await ReportTableTemplates.load("rent");
  const cells=templateSet.templates.flatMap(t=>t.segments.flatMap(s=>s.rows.flatMap(r=>r.cells)));
  assert.ok(cells.some(c=>Number(c.colSpan)>1));
  assert.ok(cells.some(c=>c.vMerge==="restart"));
  assert.equal(cells.filter(c=>c.role==="value"&&String(c.text||"").trim()).length,0);
  assert.ok(cells.filter(c=>c.role==="static"&&String(c.text||"").trim()).length>1000);
});

test("正文小节只命中对应出租类标准表，不污染出售类",async()=>{
  await ReportTableTemplates.load("rent");
  assert.ok(ReportTableTemplates.forSection("rent","总论","项目背景").length>=3);
  assert.ok(ReportTableTemplates.forSection("rent","总论","项目概况").some(t=>t.id==="rent-main-indicators"));
  assert.ok(ReportTableTemplates.forSection("rent","项目市场分析","项目定价分析").some(t=>t.id==="rent-market-cases"));
  assert.deepEqual(ReportTableTemplates.forSection("sale","总论","项目背景"),[]);
});

test("70年附表保留一个逻辑表、多段续表结构",async()=>{
  await ReportTableTemplates.load("rent");
  const app=ReportTableTemplates.appendix("rent");
  const income=app.find(t=>t.id==="rent-appendix-income-tax");
  const equity=app.find(t=>t.id==="rent-appendix-equity-cashflow");
  assert.equal(income.segments.length,6);
  assert.equal(equity.segments.length,7);
  const html=ReportTableTemplates.renderTemplate(income);
  assert.match(html,/rpt-template-period/);
  assert.match(html,/续表第2段/);
});

test("Word构建器可输出含合并单元格和续表的真实docx",async()=>{
  const docx=require("../docx.umd.js");
  const build=require("../docxgen.js");
  const template=templateSet.templates.find(t=>t.id==="rent-appendix-debt");
  const doc=build(docx,{project:{name:"[系统测试]出租类表格"},signed:false,docNo:"",chapters:[{cn:"一",name:"总论",num:1,sections:[{title:"项目概况",blocks:[{type:"templateTable",template:templateSet.templates[3]}]}]}],appendix:null,tableAppendix:[template],provenance:null});
  const buffer=await docx.Packer.toBuffer(doc);
  assert.ok(buffer.length>10000);
  assert.equal(buffer.subarray(0,2).toString(),"PK");
});

test("Word正文待补标记统一红色且正文段前段后为0磅",async()=>{
  const docx=require("../docx.umd.js"),build=require("../docxgen.js"),JSZip=require("../local-server/node_modules/jszip");
  const doc=build(docx,{project:{name:"[系统测试]Word格式"},signed:false,docNo:"",chapters:[{cn:"一",name:"总论",num:1,sections:[{title:"项目概况",blocks:[{type:"p",text:"竞品情况  【待补：竞品租金及出租率实地调研数据】  。"},{type:"p",text:"   "}]}]}],appendix:null,tableAppendix:[],provenance:null});
  const buffer=await docx.Packer.toBuffer(doc),zip=await JSZip.loadAsync(buffer),xml=await zip.file("word/document.xml").async("string");
  const markerAt=xml.indexOf("【待补：竞品租金及出租率实地调研数据】"),start=xml.lastIndexOf("<w:p",markerAt),end=xml.indexOf("</w:p>",markerAt),paragraph=xml.slice(start,end+6);
  assert.ok(markerAt>0,"待补标记应写入Word正文");
  assert.match(paragraph,/w:color w:val="C62828"/);
  assert.match(paragraph,/w:b\/>/);
  assert.match(paragraph,/w:before="0"/);
  assert.match(paragraph,/w:after="0"/);
  assert.doesNotMatch(paragraph,/竞品情况\s{2,}/);
});

test("七套出租类财务附表可一次性打包，70年续表不会使Word构建失败",async()=>{
  const docx=require("../docx.umd.js");
  const build=require("../docxgen.js");
  const doc=build(docx,{project:{name:"[系统测试]七套财务附表"},signed:false,docNo:"",chapters:[],appendix:null,tableAppendix:templateSet.templates.filter(t=>t.appendix),provenance:null});
  const buffer=await docx.Packer.toBuffer(doc);
  assert.ok(buffer.length>20000);
  assert.equal(buffer.subarray(0,2).toString(),"PK");
});

test("管理员表名和固定表头修改只形成差异覆盖，不固化项目数值",()=>{
  const base=structuredClone(templateSet),edited=structuredClone(templateSet),target=edited.templates[0];
  target.title="管理员调整后的表名";
  const staticCell=target.segments[0].rows.flatMap(row=>row.cells).find(cell=>cell.role==="static");
  staticCell.text="调整后的固定表头";
  const valueCell=target.segments[0].rows.flatMap(row=>row.cells).find(cell=>cell.role==="value");
  valueCell.text="999";
  const overrides=ReportTableTemplates.buildOverrides(edited,base),patch=overrides.templates[target.id];
  assert.equal(patch.title,"管理员调整后的表名");
  assert.ok(Object.values(patch.cells).includes("调整后的固定表头"));
  assert.equal(Object.values(patch.cells).includes("999"),false);
  const applied=ReportTableTemplates.applyOverrides(base,overrides),appliedTarget=applied.templates[0];
  assert.equal(appliedTarget.title,"管理员调整后的表名");
  assert.ok(appliedTarget.segments[0].rows.flatMap(row=>row.cells).some(cell=>cell.text==="调整后的固定表头"));
});

test("33套模板可按正文与财务附表两章打包为完整Word查看版",async()=>{
  const docx=require("../docx.umd.js"),build=require("../docxgen.js"),sections=list=>list.map(template=>({title:template.title,blocks:[{type:"templateTable",template}]}));
  const doc=build(docx,{project:{name:"[系统测试]出租类标准表格模板库"},signed:true,docNo:"",chapters:[{cn:"一",num:1,name:"正文标准表格",sections:sections(templateSet.templates.filter(t=>!t.appendix))},{cn:"二",num:2,name:"财务附表",sections:sections(templateSet.templates.filter(t=>t.appendix))}],appendix:null,tableAppendix:[],provenance:null});
  const buffer=await docx.Packer.toBuffer(doc);
  assert.ok(buffer.length>50000);
  assert.equal(buffer.subarray(0,2).toString(),"PK");
});

test("非居改保和商业改造分别加载14张与22张Word表格，场景之间不串表",async()=>{
  await ReportTableTemplates.load("gaibao-housing");await ReportTableTemplates.load("gaibao-commercial");
  assert.deepEqual(ReportTableTemplates.stats("gaibao-housing"),{templates:14,physicalTables:14,appendix:0,longPeriod:0});
  assert.deepEqual(ReportTableTemplates.stats("gaibao-commercial"),{templates:22,physicalTables:22,appendix:0,longPeriod:0});
  assert.equal(ReportTableTemplates.resolveType("gaibao",{businessScenario:"housing_conversion"}),"gaibao-housing");
  assert.equal(ReportTableTemplates.resolveType("gaibao",{businessScenario:"commercial_renovation"}),"gaibao-commercial");
  assert.ok(ReportTableTemplates.forSection("gaibao-housing","项目总论","项目概况").some(t=>t.title==="改建条件可行性研判表"));
  assert.ok(ReportTableTemplates.forSection("gaibao-commercial","项目建设必要性","遏制经营下滑态势").some(t=>t.title==="经营现状及趋势分析表"));
  assert.equal(ReportTableTemplates.forSection("gaibao-housing","项目建设必要性","遏制经营下滑态势").length,0);
});

test("后台差异支持新增、删除、章节与匹配小节修改",()=>{
  const base=structuredClone(housingSet),edited=structuredClone(housingSet),removed=edited.templates.shift();
  edited.templates[0].chapter="第二章 测试章节";edited.templates[0].match=["测试小节"];
  edited.templates.push({...structuredClone(edited.templates[0]),id:"custom-gaibao-housing-test",title:"管理员新增表"});
  const overrides=ReportTableTemplates.buildOverrides(edited,base),applied=ReportTableTemplates.applyOverrides(base,overrides);
  assert.ok(overrides.deletedTemplateIds.includes(removed.id));assert.equal(overrides.addedTemplates.length,1);
  assert.equal(applied.templates.some(t=>t.id===removed.id),false);assert.ok(applied.templates.some(t=>t.id==="custom-gaibao-housing-test"));
  assert.equal(applied.templates.find(t=>t.id===edited.templates[0].id).chapter,"第二章 测试章节");
});

test("两类改造表格均能被74项逻辑的实际章节自动调出",async()=>{
  const logic=JSON.parse(fs.readFileSync(path.join(root,"data","report-logic-gaibao-v1.json"),"utf8"));
  for(const [type,scenario,set] of [["gaibao-housing","housing_conversion",housingSet],["gaibao-commercial","commercial_renovation",commercialSet]]){
    await ReportTableTemplates.load(type);const matched=new Set();
    logic.rules.filter(rule=>!rule.scenarios?.length||rule.scenarios.includes(scenario)).forEach(rule=>ReportTableTemplates.forSection(type,rule.chapter,rule.section).forEach(template=>matched.add(template.id)));
    const missing=set.templates.filter(template=>!matched.has(template.id)).map(template=>template.title);
    assert.deepEqual(missing,[],type+"存在无法自动调出的表格");
  }
});
