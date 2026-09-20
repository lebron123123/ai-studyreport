const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const source=fs.readFileSync(require('node:path').join(__dirname,'..','report-delivery-ui.js'),'utf8');

test('未关联正式项目的独立可研进入研究复核说明，不误报未打开项目',()=>{
  assert.match(source,/ResearchUI\?\.active/);
  assert.match(source,/当前是未关联正式项目的独立AI可研/);
  assert.match(source,/airDeliverAction\('review'\)/);
  assert.doesNotMatch(source,/!currentProjectId\)return alert\('请先保存并打开一个项目'/);
});

test('关联正式项目的可研复用正式项目验收，并持续核对目标身份',()=>{
  assert.match(source,/study\?\.formalProjectId\|\|study\?\.formal_project_id/);
  assert.match(source,/deliveryProjectId\(\)===pid/);
});
