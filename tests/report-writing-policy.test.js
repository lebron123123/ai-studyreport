const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const policy=require('../report-writing-policy.js');
const workflow=require('../project-workflow.js');
const canonical=require('../data/report-logic-gaibao-v1.json');
const whole=canonical.globalRequirements.housing_conversion;
test('前台章节匹配使用后台非居改保场景名称和完整逻辑，不使用通用底层名称',async()=>{
  const ctx={window:{ReportWritingPolicy:policy},fetch:async()=>({ok:true,json:async()=>({ok:true,set:{version:19,data:canonical}})})};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../report-logic-core.js'),'utf8'),ctx);
  const core=ctx.window.ReportLogicCore;await core.load('gaibao');
  for(const [id,chapter,title] of [['gaibao-v1-022','项目市场分析','需求分析：职住关系与产业分析'],['gaibao-v1-032','项目条件和SWOT分析','项目条件']]){
    const base=canonical.rules.find(r=>r.id===id),backend={...base,...base.scenarioVariants.housing_conversion};
    const frontend=core.match('gaibao',chapter,title,{businessScenario:'housing_conversion'}).find(r=>r.id===id);
    assert.ok(frontend,'实际页面标题必须匹配到同一规则 '+id);
    for(const field of ['section','displayTitle','writingLogic','outputForm'])assert.equal(frontend[field],backend[field]);
  }
});
test('POI补丁只影响街道市场分析和项目选址，不扩大为全篇变更',()=>{
  const ids=['gaibao-v1-022','gaibao-v1-032'];
  const guard=canonical.rules.find(r=>r.id===ids[0]).scenarioVariants.housing_conversion.writingLogic.split('\n').at(-1);
  assert.ok(guard.includes('不得仅把POI改名为公司数量或产业数量'));
  const old=structuredClone(canonical);
  old.globalRequirements.housing_conversion+=guard;
  old.rules.forEach(r=>{const v=r.scenarioVariants?.housing_conversion;if(v)v.writingLogic=v.writingLogic.replace('\n'+guard,'');});
  assert.deepEqual(policy.normalize(old),canonical);
  const chapters=[{cn:'一',sections:Array.from({length:43},(_,i)=>({t:'小节'+i,content:'保留正文'+i,syncStatus:'current',logicSnapshot:{globalRequirements:whole+guard,rules:[{id:i<2?ids[i]:'other'+i,writingLogic:'原方法'}]}}))}];
  const changes=chapters[0].sections.map((s,si)=>({cn:'一',si,logicSnapshot:{globalRequirements:whole,rules:[{...s.logicSnapshot.rules[0],writingLogic:'原方法'+(si<2?'\n'+guard:'')}]}}));
  assert.equal(workflow.markLogicImpacted(chapters,changes).length,2);
  assert.equal(workflow.markLogicImpacted(chapters,changes).length,0);
  assert.ok(chapters[0].sections.every((s,i)=>s.content==='保留正文'+i));
  assert.equal(chapters[0].sections[42].syncStatus,'current');
  assert.equal(policy.requirements(canonical,'housing_conversion'),whole);
  assert.equal(policy.requirements({globalRequirements:{rent:'原规则'}},'rent'),'原规则');
  assert.equal(policy.requirements({globalRequirements:{commercial_renovation:'原规则'}},'commercial_renovation'),'原规则');
});
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
  assert.equal(edited.logicVersions.housing_conversion,'4.1');
  assert.equal(edited.logicVersions.commercial_renovation,'1.0');
  assert.deepEqual(edited.rules.map(r=>r.id),clean.rules.map(r=>r.id));
  assert.throws(()=>validateSet({...canonical,globalRequirements:{housing_conversion:'字'.repeat(12001)}}),/12000/);
});
