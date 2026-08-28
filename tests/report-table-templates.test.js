const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const root=path.resolve(__dirname,"..");
const templatePath=path.join(root,"data","report-table-templates-rent-v1.json");
const templateRaw=fs.readFileSync(templatePath,"utf8");
const templateSet=JSON.parse(templateRaw);
global.fetch=async()=>({ok:true,json:async()=>templateSet});
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
