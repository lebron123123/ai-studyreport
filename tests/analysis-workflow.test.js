const test=require('node:test');
const assert=require('node:assert/strict');
const Workflow=require('../project-workflow.js');

test('分析快照变化只标记相关章节并尊重人工锁定',()=>{
  const chapters=[{cn:'二',name:'区域与需求分析',sections:[{t:'人口分析'},{t:'职住平衡',locked:true},{t:'消防设计'}]}];
  const hits=Workflow.markAnalysisImpacted(chapters,['population','commute'],'分析数据变化');
  assert.equal(hits.length,2);assert.equal(chapters[0].sections[0].syncStatus,'stale');assert.equal(chapters[0].sections[1].syncStatus,'locked-stale');assert.equal(chapters[0].sections[2].syncStatus,undefined);
});

test('报告版本同时绑定测算快照和分析快照',()=>{
  const state={currentCalcSnapshotId:'calc-1',currentAnalysisSnapshotId:'analysis-2'};
  const chapters=[{cn:'一',name:'总论',checked:true,sections:[{t:'结论',content:'正文'}]}];
  const v=Workflow.createReportVersion(state,chapters,{reason:'测试'});
  assert.equal(v.calcSnapshotId,'calc-1');assert.equal(v.analysisSnapshotId,'analysis-2');
});

test('工作流状态会保留分析快照数组以支持版本恢复',()=>{
  const s=Workflow.ensureState({});assert.deepEqual(s.analysisSnapshots,[]);
});
