const test=require('node:test');
const assert=require('node:assert/strict');
const WF=require('../project-workflow.js');

function fixture(){
  const chapters=[{cn:'一',name:'项目总论',checked:true,sections:[{t:'项目背景',content:'上一完整版本的背景。'},{t:'实施方案',content:'上一完整版本的方案。'}]}];
  const state=WF.ensureState({});
  const complete=WF.createReportVersion(state,chapters,{reason:'[系统测试]上一完整版本'});
  chapters[0].sections[1].content='本轮已接受的实施方案。';
  const batch={status:'partial',accepted:1,unresolved:1,startedAt:'2026-10-09T00:00:00.000Z',problems:[{sectionKey:'项目总论 / 项目背景',issues:[{code:'candidate-quality-blocked',message:'[系统测试]背景仍未确认。'}]}],resolvedSections:[]};
  const partial=WF.createReportVersion(state,chapters,{reason:'[系统测试]部分接受',candidateBatchAcceptance:batch});
  return {state,chapters,complete,partial};
}

function forceBackup(f){
  const claim=WF.claimReportGeneration(f.state,f.chapters,{force:true});
  assert.equal(claim.ok,true);
  const backup=WF.createReportVersion(f.state,f.chapters,{reason:'[系统测试]重新生成前自动备份',candidateBatchAcceptance:WF.currentCandidateBatchAcceptance(f.state,f.chapters)});
  return {lockId:claim.lock.id,backup};
}

test('整篇重生成重置仅影响工作稿；旧 partial 备份保持原样且不被选为完整版',()=>{
  const f=fixture(),{lockId,backup}=forceBackup(f),before=JSON.stringify(backup);
  assert.equal(WF.currentCandidateBatchAcceptance(f.state,f.chapters).status,'partial');
  f.chapters[0].sections.forEach(section=>{section.content='';});
  assert.equal(WF.resetCandidateBatchForGeneration(f.state,lockId,backup.id),true);
  assert.equal(WF.currentCandidateBatchAcceptance(f.state,f.chapters),null);
  assert.equal(JSON.stringify(backup),before);
  assert.equal(backup.candidateBatchAcceptance.status,'partial');
  assert.equal(WF.latestCompleteReportVersion(f.state,backup.id).id,f.complete.id);
  assert.equal(f.state.reportCandidateBatchReset.backupVersionId,backup.id);
  assert.equal(f.state.reportCandidateBatchReset.generationId,lockId);
  assert.equal(WF.reportGenerationStatus(f.chapters).complete,false);
});

test('重置必须具备匹配的活动 force 锁、当前备份和真实备份记录；拒绝时不改状态',()=>{
  const base=fixture(),{lockId,backup}=forceBackup(base);
  const cases=[
    {name:'缺失锁',change:state=>{delete state.reportGenerationLock;}},
    {name:'已结束锁',change:state=>{state.reportGenerationLock.status='incomplete';}},
    {name:'普通续写锁',change:state=>{state.reportGenerationLock.force=false;}},
    {name:'非布尔 force',change:state=>{state.reportGenerationLock.force='true';}},
    {name:'锁 ID 不匹配',lockId:lockId+'-stale'},
    {name:'空锁 ID',lockId:''},
    {name:'空备份 ID',backupId:''},
    {name:'当前版本不匹配',change:state=>{state.currentReportVersionId=base.complete.id;}},
    {name:'不存在的备份',change:state=>{state.reportVersions=state.reportVersions.filter(version=>version.id!==backup.id);}},
  ];
  for(const entry of cases){
    const state=JSON.parse(JSON.stringify(base.state));entry.change?.(state);
    const before=JSON.stringify(state);
    assert.equal(WF.resetCandidateBatchForGeneration(state,entry.lockId??lockId,entry.backupId??backup.id),false,entry.name);
    assert.equal(JSON.stringify(state),before,entry.name+'必须保留原状态');
  }
});

test('整篇生成取消或没有取得备份时，旧批次仍未完成，不能提前重置',()=>{
  const f=fixture(),claim=WF.claimReportGeneration(f.state,f.chapters,{force:true}),before=JSON.stringify(f.partial);
  assert.equal(claim.ok,true);
  // The page has not confirmed and cleared the draft, so it never calls reset.
  assert.equal(WF.releaseReportGeneration(f.state,claim.lock.id,'incomplete'),true);
  assert.equal(WF.currentCandidateBatchAcceptance(f.state,f.chapters).status,'partial');
  assert.equal(f.state.reportCandidateBatchReset,undefined);
  const next=WF.claimReportGeneration(f.state,f.chapters,{force:true});
  assert.equal(WF.resetCandidateBatchForGeneration(f.state,next.lock.id,'[系统测试]不存在的备份'),false);
  assert.equal(WF.currentCandidateBatchAcceptance(f.state,f.chapters).status,'partial');
  assert.equal(JSON.stringify(f.partial),before);
});

test('整篇生成中断后刷新并普通续写，替换生成锁不会使旧 partial 再粘回工作稿',()=>{
  const f=fixture(),{lockId,backup}=forceBackup(f);
  f.chapters[0].sections.forEach(section=>{section.content='';});
  assert.equal(WF.resetCandidateBatchForGeneration(f.state,lockId,backup.id),true);
  f.chapters[0].sections[0].content='本轮新生成的背景。';
  WF.releaseReportGeneration(f.state,lockId,'incomplete');
  const restored=JSON.parse(JSON.stringify({state:f.state,chapters:f.chapters}));
  restored.state=WF.ensureState(restored.state);
  assert.equal(WF.reportGenerationStatus(restored.chapters).complete,false);
  assert.equal(WF.currentCandidateBatchAcceptance(restored.state,restored.chapters),null);
  const resume=WF.claimReportGeneration(restored.state,restored.chapters,{force:false});
  assert.equal(resume.ok,true);assert.equal(resume.lock.force,false);assert.notEqual(resume.lock.id,lockId);
  assert.equal(WF.currentCandidateBatchAcceptance(restored.state,restored.chapters),null);
  restored.chapters[0].sections[1].content='续写完成的实施方案。';
  assert.equal(WF.reportGenerationStatus(restored.chapters).complete,true);
  const meta=WF.currentCandidateBatchAcceptance(restored.state,restored.chapters);
  const completed=WF.createReportVersion(restored.state,restored.chapters,{reason:'[系统测试]本轮生成完成',...(meta?{candidateBatchAcceptance:meta}:{})});
  assert.equal(completed.candidateBatchAcceptance,undefined);
  assert.equal(WF.latestCompleteReportVersion(restored.state,completed.id).id,completed.id);
  assert.equal(restored.state.reportVersions.find(version=>version.id===backup.id).candidateBatchAcceptance.status,'partial');
});

test('重置只绑定旧备份 ID；后续新的部分候选接受仍必须检查',()=>{
  const f=fixture(),{lockId,backup}=forceBackup(f);
  f.chapters[0].sections.forEach(section=>{section.content='';});
  assert.equal(WF.resetCandidateBatchForGeneration(f.state,lockId,backup.id),true);
  f.chapters[0].sections[0].content='新整篇报告背景。';f.chapters[0].sections[1].content='新整篇报告实施方案。';
  const completed=WF.createReportVersion(f.state,f.chapters,{reason:'[系统测试]新整篇完成'});
  assert.equal(WF.currentCandidateBatchAcceptance(f.state,f.chapters),null);
  const partial=WF.createReportVersion(f.state,f.chapters,{reason:'[系统测试]下一轮部分接受',candidateBatchAcceptance:{status:'partial',startedAt:'2026-10-09T01:00:00.000Z',unresolved:1,problems:[{sectionKey:'项目总论 / 实施方案',issues:[{code:'candidate-update-unresolved',message:'[系统测试]下一轮仍待确认。'}]}],resolvedSections:[]}});
  assert.notEqual(partial.id,backup.id);
  const current=WF.currentCandidateBatchAcceptance(f.state,f.chapters);
  assert.equal(current.status,'partial');assert.equal(current.unresolved,1);assert.equal(current.problems[0].sectionKey,'项目总论 / 实施方案');
  assert.equal(WF.latestCompleteReportVersion(f.state,partial.id).id,completed.id);
});
