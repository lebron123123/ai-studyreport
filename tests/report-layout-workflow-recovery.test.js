const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const WF=require('../project-workflow.js');

test('双栏对话及同步工具栏不允许压缩内容高度',()=>{
  const css=fs.readFileSync(require.resolve('../index.html'),'utf8');
  assert.match(css,/\.air-chat-pane\s*>\s*\*\s*\{flex-shrink:0;/);
  assert.match(css,/\.air-doc-logicbar\s*\{flex-shrink:0;/);
});

test('迁移别名已经使用的正文不能再次填充其他小节',()=>{
  const old=[{cn:'一',name:'总论',sections:[{t:'旧结论',content:'唯一的旧正文'}]}];
  const next=[{cn:'一',name:'总论',sections:[{t:'新结论'},{t:'旧结论'}]}];
  const result=WF.mergeReportDraft(next,old,{sectionAliases:{'总论|新结论':['旧结论']},markNewSectionsStale:true});
  assert.equal(result[0].sections[0].content,'唯一的旧正文');
  assert.equal(result[0].sections[1].content,undefined);
  assert.equal(result[0].sections[1].syncStatus,'stale');
  assert.equal(old[0].sections[0].content,'唯一的旧正文');
});

test('撤销接受候选稿时恢复待同步状态，不把旧稿错误标成绿色',()=>{
  const section={content:'旧稿',syncStatus:'stale',staleKind:'logic',staleKeys:['report_logic'],staleReason:'逻辑已更新'};
  WF.setCandidate(section,'新稿','调整'); WF.acceptCandidate(section);
  assert.equal(section.syncStatus,'current');
  assert.equal(WF.undoSection(section),true);
  assert.equal(section.content,'旧稿');assert.equal(section.syncStatus,'stale');
  assert.equal(section.staleKind,'logic');assert.deepEqual(section.staleKeys,['report_logic']);
  assert.equal(WF.logicImpactedTasks([{sections:[section]}]).length,1);
  assert.equal(WF.undoSection(section),false);
});

test('旧版撤销记录无同步快照时保持兼容',()=>{
  const section={content:'新稿',syncStatus:'stale',undoStack:[{content:'旧稿',editedHtml:null}]};
  assert.equal(WF.undoSection(section),true);assert.equal(section.content,'旧稿');assert.equal(section.syncStatus,'stale');
});
