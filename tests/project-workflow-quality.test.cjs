const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const WF=require('../project-workflow.js');
const contract={version:'20260921-root-v1',planId:'test-plan',sectionKey:'经营方案 / 合作安排',requirements:{proseTarget:10,proseMax:20,tableMax:1,tableRowsMax:4,cellCharsMax:20}};
const section=()=>({content:'原正文',completionContract:WF.clone(contract)});

test('候选创建不覆盖已有待审稿或锁定小节，不采用外传通过标记',()=>{
  const s=section(),first=WF.setCandidate(s,'有效短正文','修改',{quality:{status:'passed',factsVerified:true}});
  assert.equal(first.quality.status,'passed');assert.equal(first.quality.factsVerified,false);
  assert.equal(WF.setCandidate(s,'另一个正文','重复点击'),null);assert.equal(s.pendingRevision,first);
  const locked={...section(),locked:true};assert.equal(WF.setCandidate(locked,'不该写入','修改'),null);assert.equal(locked.pendingRevision,undefined);
  s.locked=true;assert.equal(WF.acceptCandidate(s),null);assert.equal(s.pendingRevision,first);assert.equal(s.content,'原正文');
});

test('局部替换检查合并后的全节；阻断时保留全文、原稿和候选，不生成撤销记录',()=>{
  const s=section();s.content='已有冗长背景'.repeat(12)+'需要修改。';
  const merged=WF.replaceSelectedText(s.content,'需要修改。','修订。');assert.equal(merged.ok,true);
  const candidate=WF.setCandidate(s,merged.text,'局部精简');assert.equal(candidate.quality.status,'blocked');
  assert.ok(candidate.quality.metrics.proseCharacters>20);candidate.quality={status:'passed',factsVerified:true};
  assert.equal(WF.acceptCandidate(s),null);assert.equal(s.pendingRevision,candidate);assert.equal(candidate.after,merged.text);assert.equal(s.undoStack,undefined);assert.match(s.content,/需要修改。$/);
  assert.equal(candidate.quality.factsVerified,false);
});

test('接受前重新检查候选自己的合同，旧稿无合同仅为未验证，不能伪造事实认证',()=>{
  const s=section();WF.setCandidate(s,'长度适中的正文','修改');s.pendingRevision.completionContract.requirements={...contract.requirements,proseTarget:2,proseMax:4};
  assert.equal(WF.acceptCandidate(s),null);assert.equal(s.pendingRevision.quality.status,'blocked');
  const old={content:'历史原稿',pendingRevision:{id:'old',before:'历史原稿',after:'历史待审稿',quality:{status:'passed',factsVerified:true}}};
  assert.ok(WF.acceptCandidate(old));assert.equal(old.completionQuality.status,'unverified');assert.equal(old.completionQuality.factsVerified,false);
  const invalid={...section(),completionContract:{version:'wrong'}};const candidate=WF.setCandidate(invalid,'新稿','修改');
  assert.equal(candidate.quality.status,'blocked');assert.equal(WF.acceptCandidate(invalid),null);assert.equal(invalid.pendingRevision,candidate);
});

test('明确返修使用CAS替换，旧候选与质量留在扁平历史；过时回执不能覆盖',()=>{
  const s=section(),first=WF.setCandidate(s,'旧候选很长。'.repeat(10),'首次');
  const captured=WF.candidateToken(first),second=WF.replaceCandidate(s,'返修短正文','精简',{},captured);
  assert.equal(second.quality.status,'passed');assert.equal(second.history.length,1);assert.equal(second.history[0].after,first.after);assert.equal(second.history[0].quality.status,'blocked');assert.equal(s.content,'原正文');
  assert.equal(WF.replaceCandidate(s,'过时响应','精简',{},captured),null);assert.equal(s.pendingRevision,second);
  const secondToken=WF.candidateToken(second);second.after='用户已调整';assert.equal(WF.replaceCandidate(s,'旧内容响应','精简',{},secondToken),null);
  const third=WF.replaceCandidate(s,'新返修','精简',{},second);assert.equal(third.history.length,2);assert.equal(third.history[1].after,'用户已调整');assert.equal(third.history[1].history,undefined);
  s.locked=true;assert.equal(WF.replaceCandidate(s,'不能修改','返修',{},third),null);assert.equal(s.pendingRevision,third);
});

test('接受、版本快照、刷新合并和撤销保留合同与质量；返修旧稿保留在撤销历史',()=>{
  const s=section(),oldQuality={status:'unverified',factsVerified:false,issues:[{code:'old'}]};s.completionQuality=WF.clone(oldQuality);s.outputPolicyVersion='old';
  const first=WF.setCandidate(s,'超长旧候选。'.repeat(12),'初稿'),second=WF.replaceCandidate(s,'已修订','返修',{outputPolicyVersion:'new'},first);
  const accepted=WF.acceptCandidate(s);assert.equal(accepted,second);assert.equal(s.completionQuality.status,'passed');assert.equal(s.completionQuality.factsVerified,false);
  assert.equal(s.undoStack[0].appliedCandidate.history[0].after,first.after);
  const chapters=[{cn:'一',name:'经营方案',sections:[{...s,t:'合作安排'}]}],state={},version=WF.createReportVersion(state,chapters,{}),saved=version.chapters[0].sections[0];
  assert.deepEqual(saved.completionContract,contract);assert.equal(saved.completionQuality.status,'passed');assert.equal(saved.outputPolicyVersion,'new');
  const refreshed=WF.mergeReportDraft([{cn:'一',name:'经营方案',sections:[{t:'合作安排'}]}],chapters)[0].sections[0];
  assert.deepEqual(refreshed.completionContract,contract);assert.equal(refreshed.completionQuality.status,'passed');assert.equal(refreshed.undoStack[0].appliedCandidate.history.length,1);
  assert.equal(WF.undoSection(refreshed),true);assert.equal(refreshed.content,'原正文');assert.deepEqual(refreshed.completionQuality,oldQuality);assert.deepEqual(refreshed.completionContract,contract);assert.equal(refreshed.outputPolicyVersion,'old');assert.equal(saved.content,'已修订');
});

test('返修恢复的旧候选不丢失合同，也不能退回无合同绕过门禁',()=>{
  const s=section(),first=WF.setCandidate(s,'超长候选'.repeat(20),'初稿');delete s.completionContract;
  const replacement=WF.replaceCandidate(s,'仍然超长'.repeat(20),'返修',{},WF.candidateToken(first));
  assert.deepEqual(replacement.completionContract,contract);assert.equal(replacement.quality.status,'blocked');assert.equal(WF.acceptCandidate(s),null);assert.equal(s.pendingRevision,replacement);
});

test('批量接受分开统计锁定与质量阻断，兼容旧返回字段且不碰未选章节',()=>{
  const good=section(),bad=section(),locked=section(),ignored=section();
  WF.setCandidate(good,'短稿','修改');WF.setCandidate(bad,'过长正文'.repeat(30),'修改');WF.setCandidate(locked,'锁定候选','修改');locked.locked=true;WF.setCandidate(ignored,'未选稿','修改');
  const result=WF.acceptAllCandidates([{checked:true,sections:[good,bad,locked]},{checked:false,sections:[ignored]}]);
  assert.deepEqual({total:result.total,accepted:result.accepted,locked:result.locked,blocked:result.blocked},{total:3,accepted:1,locked:1,blocked:1});assert.equal(result.items[0].section,good);assert.equal(result.blockedItems[0].section,bad);assert.equal(result.lockedItems[0].section,locked);
  assert.equal(good.content,'短稿');assert.ok(bad.pendingRevision);assert.ok(locked.pendingRevision);assert.ok(ignored.pendingRevision);
});

test('浏览器缺成稿检查模块时合同稿不得绕过门禁',()=>{
  const context={};vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../project-workflow.js'),'utf8'),context);
  const s=section();context.ProjectWorkflow.setCandidate(s,'短稿','修改');assert.equal(s.pendingRevision.quality.status,'blocked');assert.equal(context.ProjectWorkflow.acceptCandidate(s),null);assert.equal(s.content,'原正文');
});

test('数值删除只提示人工核对，不把旧原文当真值补回或认证事实',()=>{
  const s=section();s.content='租期12年，面积38165平方米';const candidate=WF.setCandidate(s,'协议租期6年','按协议修订');
  assert.equal(candidate.quality.status,'unverified');assert.equal(candidate.quality.factsVerified,false);assert.ok(candidate.quality.issues.some(i=>i.code==='numeric-difference'&&i.message.includes('38165')));
  assert.equal(candidate.after,'协议租期6年');assert.ok(WF.acceptCandidate(s));assert.equal(s.content,'协议租期6年');assert.equal(s.completionQuality.status,'unverified');assert.equal(s.undoStack[0].content,'租期12年，面积38165平方米');
});

test('人工编辑正文后旧候选被阻断，明确重新形成的候选才以当前正文为基底',()=>{
  const s=section(),candidate=WF.setCandidate(s,'旧基底候选','初次修改');
  s.editedHtml='<p>人工更新正文</p>';
  assert.equal(WF.refreshCandidateQuality(s).status,'blocked');assert.ok(candidate.quality.issues.some(i=>i.code==='stale-candidate-base'&&i.repairable===false));
  assert.equal(WF.acceptCandidate(s),null);assert.equal(s.pendingRevision,candidate);assert.equal(s.editedHtml,'<p>人工更新正文</p>');
  const newCandidate=WF.replaceCandidate(s,'重新核对后的候选','按当前正文重新修改',{},WF.candidateToken(candidate));
  assert.equal(newCandidate.before,'<p>人工更新正文</p>');assert.ok(WF.acceptCandidate(s));assert.equal(s.content,'重新核对后的候选');
});
