const test=require('node:test');
const assert=require('node:assert/strict');
const wf=require('../project-workflow.js');
const fresh=()=>({t:'编制依据',content:'已定稿',editedHtml:'<p>已定稿</p>',logicSnapshot:{version:5,globalRequirements:'简洁凝练',rules:[{id:'a',writingLogic:'逐项核验'}]},syncStatus:'stale',staleKind:'logic',staleKeys:['report_logic']});
test('41节选择保持原文：正文不改、重复操作幂等、序列化刷新不复活，下一次真正变化仍提醒',()=>{
 const chapters=[{cn:'一',checked:true,sections:Array.from({length:41},fresh)}];
 for(const s of chapters[0].sections.slice(0,35)){assert.equal(wf.keepOriginalLogic(s),true);assert.equal(wf.keepOriginalLogic(s),false);assert.equal(s.editedHtml,'<p>已定稿</p>');}
 const restored=JSON.parse(JSON.stringify(chapters)),changes=restored[0].sections.map((s,si)=>({cn:'一',si,logicSnapshot:{version:5,globalRequirements:'简洁凝练',rules:[{id:'a',writingLogic:'逐项核验'}]}}));
 assert.equal(wf.markLogicImpacted(restored,changes).length,0);
 assert.equal(restored[0].sections.filter(s=>s.syncStatus==='stale').length,6);
 assert.equal(restored[0].sections[0].logicSnapshot.reviewDecision.action,'keep-original');
 assert.equal(wf.markLogicImpacted(restored,changes.map(x=>({...x,logicSnapshot:{...x.logicSnapshot,globalRequirements:'新的全篇要求'}}))).length,41);
});
test('空白、锁定、候选稿、数据变化不能误清；撤销恢复复核标记；版本保留',()=>{
 for(const patch of [{content:'',editedHtml:null},{locked:true},{pendingRevision:{after:'建议'}},{staleKeys:['report_logic','rent']},{staleKind:'data'},{syncStatus:'current'}]){
  const s={...fresh(),...patch},before=JSON.stringify(s);assert.equal(wf.keepOriginalLogic(s),false);assert.equal(JSON.stringify(s),before);
 }
 const s=fresh(),chapters=[{cn:'一',checked:true,sections:[s]}],state=wf.ensureState({});
 wf.createReportVersion(state,chapters,{reason:'修改前'});wf.keepOriginalLogic(s);
 const version=wf.createReportVersion(state,chapters,{reason:'人工复核保持原文'});
 assert.ok(version);assert.equal(state.reportVersions.length,2);
 assert.equal(wf.undoSection(s),true);assert.equal(s.syncStatus,'stale');assert.equal(s.logicSnapshot.reviewDecision,undefined);
});
