const test=require("node:test");
const assert=require("node:assert/strict");

test("资料版本差异：返回新增与删除行，忽略未变行和空行",async()=>{
  const {diffLines}=await import("../functions/api/materials.js");
  const d=diffLines("第一条 保留\n第二条 旧内容\n","第一条 保留\n第二条 新内容\n第三条 新增");
  assert.deepEqual(d.added,["第二条 新内容","第三条 新增"]);
  assert.deepEqual(d.removed,["第二条 旧内容"]);
});

test("资料版本差异：限制最大返回行数，避免超大文件拖垮页面",async()=>{
  const {diffLines}=await import("../functions/api/materials.js");
  const d=diffLines("",Array.from({length:20},(_,i)=>"新增"+i).join("\n"),5);
  assert.equal(d.added.length,5);
});
