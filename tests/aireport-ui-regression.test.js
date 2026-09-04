const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const root=path.resolve(__dirname,"..");
const reportSource=fs.readFileSync(path.join(root,"aireport.js"),"utf8");
const pageSource=fs.readFileSync(path.join(root,"index.html"),"utf8");

test("小节逻辑入口兼容 data 属性字符串和历史数字章节编号",()=>{
  assert.match(reportSource,/String\(item\.cn\)===String\(cn\)/);
  assert.match(reportSource,/void airOpenSectionLogicEditor\([\s\S]*?\.catch\(error=>alert\("打开本节生成逻辑失败："\+error\.message\)\)/);
});

test("共享弹窗自身可滚动且阻止滚动传递到报告正文",()=>{
  assert.match(pageSource,/\.air-modal-overlay\{[^}]*overflow-y:auto;[^}]*overscroll-behavior:contain/);
  assert.match(pageSource,/\.air-modal-card\{[^}]*max-height:calc\(100dvh - 48px\);[^}]*overflow-y:auto;[^}]*overscroll-behavior:contain/);
  assert.match(pageSource,/\.air-modal-head\{[^}]*position:sticky;top:0/);
  assert.match(pageSource,/\.air-modal-actions\{[^}]*position:sticky;bottom:0/);
  assert.match(pageSource,/\.air-enhance-modal>\*\{flex-shrink:0\}/);
});
