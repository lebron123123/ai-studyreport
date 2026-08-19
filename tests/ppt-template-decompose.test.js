const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const file=path.resolve(__dirname,"../outputs/ppt-template-design-library.md");
test("模板拆解库达到第一二阶段目标",()=>{assert.ok(fs.existsSync(file),"缺少模板设计语言清单");const text=fs.readFileSync(file,"utf8");assert.match(text,/视觉体系：6套/);assert.match(text,/整页配方：36个/);assert.match(text,/组件候选：100个/);assert.match(text,/准入规则/);});
