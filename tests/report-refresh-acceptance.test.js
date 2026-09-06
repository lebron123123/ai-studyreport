const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const WF=require('../project-workflow.js');
const clone=x=>JSON.parse(JSON.stringify(x));
const report=fs.readFileSync(require.resolve('../report.js'),'utf8');
const air=fs.readFileSync(require.resolve('../aireport.js'),'utf8');
function fixture(){
  return [{cn:'一',name:'总论',checked:true,sections:Array.from({length:41},(_,i)=>({t:'小节'+i,content:'正文'+i,logicSnapshot:{version:19,rules:[{id:String(i),writingLogic:'正式规则'+i}]},syncStatus:'current'}))}];
}
function runtime(){
  const official=fixture();
  const ctx={window:{ProjectWorkflow:WF},ProjectWorkflow:WF,project:{},reportDocumentRevision:0,STEPS:[0],chapters:[],projectWorkflow:{},
    loadDomain(){ctx.chapters=[{cn:'一',name:'总论',sections:Array.from({length:42},(_,i)=>({t:i<6?'小节'+i:'旧小节'+i,content:''}))}];},
    renderTOC(){},renderSheet(){},reportDraftMergeOptions(){return {markNewSectionsStale:true};},airBusinessScenario(){return 'housing_conversion';},
    reportSectionLogicSnapshot(c,s,rules){return {version:19,rules};},airSaveState(){},scheduleCloudSave(){},
    localStorage:{setItem(k,v){ctx.saved=v;}},DRAFT_KEY:'test',kbEntries:[],appMode:'aireport',currentStep:0,calcParams:null,docNo:null,signed:false,
    reportLocalPersistedRevision:-1,reportCloudPersistedRevision:-1,reportLocalSavePending:Promise.resolve(false),reportLocalSaveQueue:Promise.resolve(),reportDraftStoreKey(){return 'test';},
    ReportLogicCore:{outline(){return {chapters:clone(official)};},match(type,name,title){return official[0].sections.find(s=>s.t===title).logicSnapshot.rules;}}
  };
  ctx.window.ReportLogicCore=ctx.ReportLogicCore;
  vm.createContext(ctx);
  vm.runInContext(report.slice(report.indexOf('function buildDraftData('),report.indexOf('function draftBarHtml(')),ctx);
  vm.runInContext(air.slice(air.indexOf('function airReportStructureKey('),air.indexOf('// 从首页/其它模块切回本模块')),ctx);
  return {ctx,official};
}
test('接受35节后保存、连续刷新和返回再进入均保留正文、状态及版本',async()=>{
  const {ctx}=runtime(),chapters=fixture();
  chapters[0].sections.slice(6).forEach((s,i)=>{s.syncStatus='stale';WF.setCandidate(s,'已接受正文'+i,'更新',{logicRevision:s.logicSnapshot});});
  assert.equal(WF.acceptAllCandidates(chapters).accepted,35);
  const workflow=WF.ensureState({});WF.createReportVersion(workflow,chapters,{reason:'批量接受候选稿'});
  let draft={domainKey:'baozhang_gaibao',chapters,workflow,project:{},aiReportSession:true};
  const expected=clone(chapters);
  for(let i=0;i<3;i++){
    ctx.restoreDraft(clone(draft),{openHome:i===1});
    const sync=await ctx.airSyncOfficialHousingLogic();
    assert.equal(sync.impacts.length,0);
    assert.deepEqual(clone(ctx.chapters).map(c=>c.sections.map(s=>s.content)),expected.map(c=>c.sections.map(s=>s.content)));
    assert.equal(WF.logicImpactedTasks(ctx.chapters).length,0);
    assert.equal(ctx.projectWorkflow.reportVersions.length,1);
    assert.equal(ctx.chapters[0].sections[6].undoStack.length,1);
    ctx.saveDraft();draft=JSON.parse(ctx.saved);
  }
  assert.deepEqual(chapters,expected,'恢复不修改传入数据');
});
test('真实规则后续修改仍只标记对应小节，不通过清空状态掩盖变化',async()=>{
  const {ctx,official}=runtime();
  ctx.restoreDraft({domainKey:'baozhang_gaibao',chapters:fixture()});
  official[0].sections[8].logicSnapshot.rules[0].writingLogic='真正的新逻辑';
  const result=await ctx.airSyncOfficialHousingLogic();
  assert.equal(result.impacts.length,1);assert.equal(result.impacts[0].si,8);
  assert.equal(ctx.chapters[0].sections[8].content,'正文8');
});
test('恢复保留锁定和未接受候选稿；旧无标题草稿仍兼容',()=>{
  const {ctx}=runtime(),chapters=fixture();
  chapters[0].sections[0].locked=true;WF.setCandidate(chapters[0].sections[0],'待审稿','待审');
  ctx.restoreDraft({domainKey:'baozhang_gaibao',chapters});
  assert.equal(ctx.chapters[0].sections[0].locked,true);
  assert.equal(ctx.chapters[0].sections[0].pendingRevision.after,'待审稿');
  ctx.restoreDraft({domainKey:'baozhang_gaibao',chapters:[{sections:[{content:'旧格式正文'}]}]});
  assert.equal(ctx.chapters[0].sections[0].content,'旧格式正文');
  ctx.restoreDraft({domainKey:'baozhang_gaibao',chapters:[]});
  assert.equal(ctx.chapters[0].sections.length,42);
});
