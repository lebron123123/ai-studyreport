import test from "node:test";
import assert from "node:assert/strict";
import { validateOverrides } from "../functions/api/reporttables.js";

test("表格模板覆盖配置只接受出租类、合法坐标和有限文本",()=>{
  const result=validateOverrides({projectType:"rent",templates:{"rent-main-indicators":{title:"主要技术经济指标表（新版）",cells:{"0:0:0":"序号","0:0:1":"指标名称"}}}},"rent");
  assert.equal(result.templates["rent-main-indicators"].title,"主要技术经济指标表（新版）");
  assert.deepEqual(result.templates["rent-main-indicators"].cells,{"0:0:0":"序号","0:0:1":"指标名称"});
  assert.throws(()=>validateOverrides({templates:{x:{cells:{bad:"值"}}}},"rent"),/坐标格式有误/);
  assert.throws(()=>validateOverrides({templates:{}},"sale"),/仅开放出租类/);
});
