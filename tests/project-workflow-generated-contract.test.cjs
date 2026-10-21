const test=require('node:test'),assert=require('node:assert/strict');
const WF=require('../project-workflow.js'),C=require('../report-completion-contract.js');

const base={version:'20260921-root-v1',planId:'finance-plan',sectionKey:'财务评价 / 财务分析',requirements:{proseTarget:10,proseMax:20,tableMax:1,tableRowsMax:4,cellCharsMax:30}};
const table=value=>'<table><tr><th>指标</th><th>数值</th></tr><tr><td>收入</td><td>'+value+'</td></tr></table>';
async function fixture(){
  const before='<p>旧财务正文</p>'+table('21750.94'),after='<p>新财务正文</p>'+table('1116.782');
  const oldContract=await C.bindFrozenTables(base,before,'calc-old'),newContract=await C.bindFrozenTables(base,after,'calc-new');
  const section={content:'保留的原始正文',editedHtml:before,completionContract:WF.clone(oldContract),completionQuality:{status:'unverified',factsVerified:false,issues:[{code:'old-quality'}]},syncStatus:'stale',staleKeys:['rent']};
  return {section,before,after,oldContract,newContract};
}

test('新财务候选使用生成回执，拒绝不改旧正文和旧合同，接受及撤销完整切换',async()=>{
  const {section:s,before,after,oldContract,newContract}=await fixture(),original=WF.clone(s);
  WF.rememberGeneratedContract(s,after,newContract);
  const candidate=WF.setCandidate(s,after,'同步当前测算');
  assert.deepEqual(candidate.completionContract,newContract);assert.notEqual(candidate.quality.status,'blocked');
  assert.deepEqual(s.completionContract,oldContract);assert.equal(s.editedHtml,before);
  WF.rejectCandidate(s);assert.equal(s.pendingRevision,null);
  for(const field of ['content','editedHtml','completionContract','completionQuality','syncStatus','staleKeys'])assert.deepEqual(s[field],original[field]);
  const second=WF.setCandidate(s,after,'再次确认当前测算');
  assert.equal(WF.acceptCandidate(s),second);assert.equal(s.content,after);assert.equal(s.editedHtml,null);assert.deepEqual(s.completionContract,newContract);
  assert.deepEqual(s.undoStack[0].completionContract,oldContract);assert.equal(s.undoStack[0].editedHtml,before);
  const version=WF.createReportVersion({},[{name:'财务评价',sections:[s]}],{});
  assert.deepEqual(version.chapters[0].sections[0].completionContract,newContract);
  assert.equal(WF.undoSection(s),true);
  for(const field of ['content','editedHtml','completionContract','completionQuality','syncStatus','staleKeys'])assert.deepEqual(s[field],original[field]);
  assert.deepEqual(version.chapters[0].sections[0].completionContract,newContract);assert.equal(version.chapters[0].sections[0].content,after);
});

test('生成回执按小节对象和完整文本精确匹配，错文本不能套用新冻结合同',async()=>{
  const {section:s,after,oldContract,newContract}=await fixture();WF.rememberGeneratedContract(s,after,newContract);
  assert.equal(WF.generatedContract(s,after+' '),null);assert.equal(WF.generatedContract({...s},after),null);
  const candidate=WF.setCandidate(s,after+' ','文本不同');
  assert.deepEqual(candidate.completionContract,oldContract);assert.equal(candidate.quality.status,'blocked');
  assert.ok(candidate.quality.issues.some(i=>i.code==='frozen-table-missing'));assert.equal(WF.acceptCandidate(s),null);
  assert.deepEqual(s.completionContract,oldContract);
});

test('生成回执仅在内存保存克隆，重复登记以最近文本为准且显式合同优先',async()=>{
  const {section:s,after,newContract}=await fixture(),original=WF.clone(s),input=WF.clone(newContract);
  WF.rememberGeneratedContract(s,after,input);input.planId='外部修改';
  const read=WF.generatedContract(s,after);assert.equal(read.planId,newContract.planId);read.planId='回执修改';
  assert.equal(WF.generatedContract(s,after).planId,newContract.planId);assert.deepEqual(WF.clone(s),original);
  WF.rememberGeneratedContract(s,after+'\n',newContract);assert.equal(WF.generatedContract(s,after),null);
  WF.rememberGeneratedContract(s,after,newContract);
  const explicit={...newContract,planId:'explicit-plan'},candidate=WF.setCandidate(s,after,'显式合同',{completionContract:explicit});
  assert.deepEqual(candidate.completionContract,explicit);explicit.planId='外部再改';assert.equal(candidate.completionContract.planId,'explicit-plan');
  assert.equal(WF.rememberGeneratedContract(null,after,newContract),null);assert.equal(WF.generatedContract('invalid',after),null);
  WF.rememberGeneratedContract(s,after,null);assert.equal(WF.generatedContract(s,after),null);
});

test('稳定输入计划身份只随精确生成文本进入候选，元数据不改正式正文或合同',async()=>{
  const {section:s,after,newContract}=await fixture(),original=WF.clone(s),meta={completionInputPlanId:'input-plan-1',unrelated:{value:'不传递'}};
  const returned=WF.rememberGeneratedContract(s,after,newContract,meta);meta.completionInputPlanId='外部修改';
  assert.deepEqual(returned,newContract);assert.deepEqual(WF.generatedContract(s,after),newContract);
  assert.equal(WF.generatedInputPlanId(s,after),'input-plan-1');assert.equal(WF.generatedInputPlanId(s,after+' '),null);
  assert.equal(WF.generatedInputPlanId(WF.clone(s),after),null);assert.deepEqual(WF.clone(s),original);
  const candidate=WF.setCandidate(s,after,'采用当前输入计划');assert.equal(candidate.completionInputPlanId,'input-plan-1');assert.equal(candidate.unrelated,undefined);
  assert.equal(candidate.completionContract.completionInputPlanId,undefined);
  const restored=WF.clone(s);assert.equal(restored.pendingRevision.completionInputPlanId,'input-plan-1');assert.equal(restored.completionInputPlanId,undefined);
  const accepted=WF.acceptCandidate(restored);assert.equal(accepted.completionInputPlanId,'input-plan-1');assert.equal(restored.completionInputPlanId,undefined);
  assert.equal(restored.undoStack[0].appliedCandidate.completionInputPlanId,'input-plan-1');assert.deepEqual(restored.completionContract,newContract);
  assert.equal(WF.undoSection(restored),true);assert.deepEqual(restored.completionContract,original.completionContract);assert.equal(restored.completionInputPlanId,undefined);
});

test('输入计划身份校验长度和类型、显式元数据优先，旧文本与替换回执不串用',async()=>{
  const {section:s,after,newContract}=await fixture();
  WF.rememberGeneratedContract(s,after,newContract,{completionInputPlanId:'receipt-plan'});
  let candidate=WF.setCandidate(s,after,'显式输入计划',{completionInputPlanId:'explicit-plan'});assert.equal(candidate.completionInputPlanId,'explicit-plan');WF.rejectCandidate(s);
  candidate=WF.setCandidate(s,after+' ','不匹配文本');assert.equal(candidate.completionInputPlanId,undefined);WF.rejectCandidate(s);
  for(const invalid of [null,10,{},'', ' ', 'p'.repeat(513)]){
    WF.rememberGeneratedContract(s,after,newContract,{completionInputPlanId:invalid});assert.equal(WF.generatedInputPlanId(s,after),null);
    candidate=WF.setCandidate(s,after,'无有效输入计划',{completionInputPlanId:invalid});assert.equal(candidate.completionInputPlanId,undefined);WF.rejectCandidate(s);
  }
  WF.rememberGeneratedContract(s,after,newContract,{completionInputPlanId:'p'.repeat(512)});assert.equal(WF.generatedInputPlanId(s,after),'p'.repeat(512));
  WF.rememberGeneratedContract(s,after+'\n',newContract,{completionInputPlanId:'latest-plan'});assert.equal(WF.generatedInputPlanId(s,after),null);assert.equal(WF.generatedInputPlanId(s,after+'\n'),'latest-plan');
  WF.rememberGeneratedContract(s,after+'\n',null);assert.equal(WF.generatedInputPlanId(s,after+'\n'),null);assert.equal(WF.generatedInputPlanId(null,after),null);
});

test('重检及接受优先候选自身合同，旧正文合同变化不错误覆盖新表合同',async()=>{
  const {section:s,after,newContract}=await fixture();WF.rememberGeneratedContract(s,after,newContract);
  const candidate=WF.setCandidate(s,after,'同步当前测算');s.completionContract.requirements.proseMax=1;
  assert.notEqual(WF.refreshCandidateQuality(s).status,'blocked');assert.deepEqual(candidate.completionContract,newContract);
  assert.equal(WF.acceptCandidate(s),candidate);assert.deepEqual(s.completionContract,newContract);
  const legacy={content:'原稿',completionContract:{...base,requirements:{...base.requirements,proseMax:1}},pendingRevision:{before:'原稿',after:'很长的旧候选'}};
  assert.equal(WF.refreshCandidateQuality(legacy).status,'blocked');assert.equal(WF.acceptCandidate(legacy),null);
});

test('新合同回执不绕过重复候选、锁定、候选CAS或正文基底冲突',async()=>{
  const {section:s,after,newContract}=await fixture();WF.rememberGeneratedContract(s,after,newContract);
  const first=WF.setCandidate(s,after,'同步'),token=WF.candidateToken(first);
  assert.equal(WF.setCandidate(s,after,'重复同步'),null);assert.equal(s.pendingRevision,first);
  s.locked=true;assert.equal(WF.acceptCandidate(s),null);assert.equal(WF.replaceCandidate(s,after,'锁定返修',{},token),null);s.locked=false;
  const revised=after+'\n';WF.rememberGeneratedContract(s,revised,newContract);
  const second=WF.replaceCandidate(s,revised,'显式返修',{},token);assert.deepEqual(second.completionContract,newContract);assert.equal(second.history[0].id,first.id);
  assert.equal(WF.replaceCandidate(s,after,'过时返修',{},token),null);
  s.editedHtml='<p>人工已改正文</p>';
  assert.equal(WF.refreshCandidateQuality(s).status,'blocked');assert.ok(second.quality.issues.some(i=>i.code==='stale-candidate-base'));
  assert.equal(WF.acceptCandidate(s),null);assert.equal(s.undoStack,undefined);assert.equal(s.editedHtml,'<p>人工已改正文</p>');
});

test('当前计划或测算准入错误经重复重检及接受仍保留，只有明确复核清除才可接受',async()=>{
  const {section:s,after,oldContract,newContract}=await fixture();WF.rememberGeneratedContract(s,after,newContract);
  const candidate=WF.setCandidate(s,after,'同步当前测算'),issue={code:'financial-source-changed',severity:'error',repairable:false,message:'当前测算已变化，请重新核对'};
  candidate.admissionIssues=[issue];
  for(let i=0;i<3;i++){
    candidate.quality={status:'passed',factsVerified:true,issues:[]};
    const quality=WF.refreshCandidateQuality(s);assert.equal(quality.status,'blocked');assert.equal(quality.factsVerified,false);
    assert.equal(quality.issues.filter(item=>item.code===issue.code).length,1);assert.notEqual(quality.issues.find(item=>item.code===issue.code),issue);
    assert.equal(WF.acceptCandidate(s),null);assert.equal(s.pendingRevision,candidate);assert.equal(s.undoStack,undefined);
    assert.deepEqual(s.completionContract,oldContract);
  }
  candidate.admissionIssues=[];
  assert.notEqual(WF.refreshCandidateQuality(s).status,'blocked');assert.equal(WF.acceptCandidate(s),candidate);assert.deepEqual(s.completionContract,newContract);
});
