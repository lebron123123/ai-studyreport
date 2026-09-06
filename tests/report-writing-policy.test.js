const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const policy=require('../report-writing-policy.js');
const workflow=require('../project-workflow.js');
const canonical=require('../data/report-logic-gaibao-v1.json');
const whole=canonical.globalRequirements.housing_conversion;
const legacy={projectType:'gaibao',rules:[{id:'a',chapter:'第一章 项目总论',section:'1.1 编制依据',writingLogic:'通用方法',scenarios:['housing_conversion','commercial_renovation'],scenarioVariants:{housing_conversion:{writingLogic:'逐项核对依据\n全篇执行：'+whole},commercial_renovation:{writingLogic:'分析商业需求'}}}]};
test('全篇规则独立抽取且住房/商业隔离，保留本节方法和输入原件',()=>{
  const before=JSON.stringify(legacy),data=policy.normalize(legacy);
  assert.equal(data.globalRequirements.housing_conversion,whole);
  assert.equal(data.globalRequirements.commercial_renovation,'');
  assert.equal(data.rules[0].scenarioVariants.housing_conversion.writingLogic,'逐项核对依据');
  assert.equal(data.rules[0].scenarioVariants.commercial_renovation.writingLogic,'分析商业需求');
  assert.equal(JSON.stringify(legacy),before);
  assert.deepEqual(policy.normalize(data),data);
  assert.deepEqual(policy.normalize(canonical),canonical);
});
test('显式编辑/清空全篇要求不被历史规则复活；一般小节文字不盲目抽取',()=>{
  const input={...legacy,globalRequirements:{housing_conversion:''}};
  assert.equal(policy.normalize(input).globalRequirements.housing_conversion,'');
  const text='项目名称应写全称与简称；表格列宽按本节要求。';
  assert.equal(policy.split(text).text,text);
});
test('35节旧稿抽取规则后刷新不重新标记，真正改全篇要求才影响35节且保留锁定',()=>{
  const old={version:19,rules:[{id:'a',writingLogic:'逐项核对依据\n全篇执行：'+whole}]};
  const next={version:19,globalRequirements:whole,rules:[{id:'a',writingLogic:'逐项核对依据'}]};
  assert.equal(workflow.logicSnapshotDiff(old,next).changed,false);
  const chapters=[{cn:'一',sections:Array.from({length:35},(_,i)=>({t:'小节'+i,content:'已接受正文'+i,logicSnapshot:structuredClone(old),syncStatus:'current',locked:i===0}))}];
  const changes=chapters[0].sections.map((s,si)=>({cn:'一',si,logicSnapshot:next}));
  for(let i=0;i<3;i++)assert.equal(workflow.markLogicImpacted(chapters,changes).length,0);
  const revised={...next,globalRequirements:whole+'\n行文简洁凝练。'};
  assert.equal(workflow.markLogicImpacted(chapters,changes.map(c=>({...c,logicSnapshot:revised}))).length,35);
  assert.equal(chapters[0].sections[0].syncStatus,'locked-stale');
  assert.equal(chapters[0].sections[34].content,'已接受正文34');
});
test('生成每节及未匹配小节都携带全篇要求，规则只注入一次且保留业务逻辑',async()=>{
  const ctx={window:{ReportWritingPolicy:policy},fetch:async()=>({ok:true,json:async()=>({ok:true,set:{version:19,data:legacy}})})};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../report-logic-core.js'),'utf8'),ctx);
  const core=ctx.window.ReportLogicCore;await core.load('gaibao');
  const result=core.prompt('gaibao','项目总论','编制依据',{businessScenario:'housing_conversion'});
  assert.ok(result.includes('逐项核对依据'));
  assert.equal(result.split(whole).length-1,1);
  assert.ok(core.prompt('gaibao','无匹配章','无匹配节',{businessScenario:'housing_conversion'}).includes(whole));
  assert.ok(!core.prompt('gaibao','项目总论','编制依据',{businessScenario:'commercial_renovation'}).includes(whole));
});
test('后台校验持久化全篇字段，版本更新与原规则ID兼容',async()=>{
  const {validateSet,bumpLogicVersion}=await import('../functions/api/reportlogic.js');
  const clean=validateSet(canonical,'gaibao');
  assert.equal(clean.globalRequirements.housing_conversion,whole);
  const edited=structuredClone(clean);edited.globalRequirements.housing_conversion='行文简洁。';
  bumpLogicVersion(edited,clean,'gaibao','housing_conversion');
  assert.equal(edited.logicVersions.housing_conversion,'2.1');
  assert.equal(edited.logicVersions.commercial_renovation,'1.0');
  assert.deepEqual(edited.rules.map(r=>r.id),clean.rules.map(r=>r.id));
  assert.throws(()=>validateSet({...canonical,globalRequirements:{housing_conversion:'字'.repeat(12001)}}),/12000/);
});
