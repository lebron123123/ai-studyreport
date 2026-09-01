import test from "node:test";
import assert from "node:assert/strict";
import { validateOverrides } from "../functions/api/reporttables.js";

test("三类表格模板覆盖配置接受合法增删改并拒绝非法类型与坐标",()=>{
  const result=validateOverrides({projectType:"rent",templates:{"rent-main-indicators":{title:"主要技术经济指标表（新版）",cells:{"0:0:0":"序号","0:0:1":"指标名称"}}}},"rent");
  assert.equal(result.templates["rent-main-indicators"].title,"主要技术经济指标表（新版）");
  assert.deepEqual(result.templates["rent-main-indicators"].cells,{"0:0:0":"序号","0:0:1":"指标名称"});
  assert.throws(()=>validateOverrides({templates:{x:{cells:{bad:"值"}}}},"rent"),/坐标格式有误/);
  const gaibao=validateOverrides({deletedTemplateIds:["gaibao-housing-table-01"],addedTemplates:[{id:"custom-1",title:"新增表",chapter:"第一章",match:["项目概况"],segments:[{gridWidths:[1,1],rows:[{cells:[{text:"字段",col:0,role:"static"},{text:"",col:1,role:"value"}]}]}]}]},"gaibao-housing");
  assert.deepEqual(gaibao.deletedTemplateIds,["gaibao-housing-table-01"]);assert.equal(gaibao.addedTemplates.length,1);
  assert.throws(()=>validateOverrides({templates:{}},"sale"),/不支持/);
});
