const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const root=path.resolve(__dirname,"..");
const templateSet=JSON.parse(fs.readFileSync(path.join(root,"data","report-table-templates-rent-v1.json"),"utf8"));
const {chapterGroups,LABELS,TYPES}=require("../report-table-admin.js");

test("后台把出租、非居改保和商业改造作为三个同级表格库入口",()=>{
  assert.deepEqual(TYPES,["rent","gaibao-housing","gaibao-commercial"]);
  assert.equal(LABELS["gaibao-housing"],"非居改保（住房改造）");
  assert.equal(LABELS["gaibao-commercial"],"商业改造（自持改造）");
});

test("非居和商业表格按各自Word章节归组且数量完整",()=>{
  const housing=JSON.parse(fs.readFileSync(path.join(root,"data","report-table-templates-gaibao-housing-v1.json"),"utf8"));
  const commercial=JSON.parse(fs.readFileSync(path.join(root,"data","report-table-templates-gaibao-commercial-v1.json"),"utf8"));
  assert.equal(chapterGroups(housing.templates,false).flatMap(group=>group.items).length,14);
  assert.equal(chapterGroups(commercial.templates,false).flatMap(group=>group.items).length,22);
});

test("出租类标准表格先按章节归组，再保留章内原始表格顺序",()=>{
  const body=chapterGroups(templateSet.templates,false);
  const appendix=chapterGroups(templateSet.templates,true);
  assert.deepEqual(body.map(group=>group.name),[
    "第一章 总论","第三章 项目市场分析","第五章 项目定位与建设规模",
    "第七章 规划建筑方案建议","第九章 项目招投标及实施进度安排",
    "第十章 投资估算与资金筹措","第十一章 财务评价"
  ]);
  assert.equal(body.flatMap(group=>group.items).length,26);
  assert.equal(appendix.length,1);
  assert.equal(appendix[0].name,"财务附表");
  assert.equal(appendix[0].items.length,7);
  assert.equal(body[0].items[0].template.id,"rent-unit-standard");
  assert.equal(body.at(-1).items.at(-1).template.id,"rent-sensitivity");
});
