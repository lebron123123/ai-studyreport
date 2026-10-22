const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const WF=require('../project-workflow.js'),Contract=require('../report-completion-contract.js');
const source=fs.readFileSync(require.resolve('../report.js'),'utf8');
function production(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,start);return source.slice(a,b);}
const code=production('function reportFinancialContext(','function reportCompletionEntries(')+production('function reportReviewCandidate(','function reportCheckGeneratedDraft(');
function fixture(){
  const contract=Contract.normalize({version:Contract.VERSION,planId:'[系统测试]current-contract',sectionKey:'经营 / 运营分析',requirements:{proseTarget:40,proseMax:150,tableMax:1,tableRowsMax:4,cellCharsMax:30}});
  const section={t:'运营分析',content:'保留的正式正文。',completionContract:WF.clone(contract)},chapter={name:'经营',checked:true,sections:[section]};
  const facts=[{key:'description',value:'既有真实项目事实'}],state={policy:'[系统测试]policy-v1',rules:1,planCalls:0};
  const context={chapters:[chapter],project:{name:'[系统测试]候选凭据准入'},currentProjectId:'[系统测试]receipt-project',projectWorkflow:{},calcParams:{},calcResult:null,kbEntries:[],ReportCompletionContract:Contract,ProjectWorkflow:WF,
    ReportOutputPolicy:{get contentVersion(){return state.policy;}},ReportLogicCore:{current:()=>({version:state.rules,data:{}}),match:()=>[],globalRequirements:()=>''},
    rlProjectType:()=> 'gaibao',rlBusinessScenario:()=> 'housing_conversion',rlProjectText:()=>context.project.name,reportCompletionFacts:()=>facts,
    reportCompletionPlan:()=>{state.planCalls++;return {planId:'[系统测试]current-plan',sections:[contract]};}};
  context.window=context;vm.createContext(context);vm.runInContext(code,context);
  return {context,section,chapter,contract,facts,state,review:()=>context.reportReviewCandidate(chapter,section),identity:()=>context.reportCandidateInputIdentity()};
}
const issue=quality=>quality.issues.find(item=>item.code==='candidate-generation-receipt-missing');

test('恢复的历史候选缺生成凭据时明确阻断；不补新合同、不覆正文、不改候选身份或原文',()=>{
  for(const withContract of [false,true]){
    const f=fixture(),s=f.section,oldContract={...WF.clone(f.contract),planId:'[系统测试]old-contract'};
    s.pendingRevision={id:'[系统测试]old-candidate',createdAt:'2026-09-30T00:00:00.000Z',before:s.content,after:'历史精简候选正文。',instruction:'旧规则生成',...(withContract?{completionContract:oldContract}:{})};
    const original=WF.clone(s),candidate=s.pendingRevision;
    for(let n=0;n<3;n++){
      const quality=f.review();assert.equal(quality.status,'blocked');assert.equal(issue(quality).repairable,false);assert.match(issue(quality).message,/历史候选.*按当前计划重新生成/);
      assert.equal(WF.acceptCandidate(s),null);assert.equal(s.pendingRevision,candidate);assert.equal(s.content,original.content);assert.deepEqual(s.completionContract,original.completionContract);
      for(const key of ['id','createdAt','before','after','instruction'])assert.equal(candidate[key],original.pendingRevision[key]);
      assert.deepEqual(candidate.completionContract,original.pendingRevision.completionContract);assert.equal(candidate.completionInputPlanId,undefined);assert.equal(s.undoStack,undefined);
      assert.equal(Object.hasOwn(candidate,'completionContract'),withContract);
    }
  }
});

test('完整生成回执按精确文本绑定，JSON恢复后当前规则可接受并完整撤销',()=>{
  const f=fixture(),s=f.section,before=WF.clone(s),text='当前规则生成的完整运营分析正文。';
  WF.rememberGeneratedContract(s,text,f.contract,{completionInputPlanId:f.identity()});
  WF.setCandidate(s,text,'按当前计划生成',{outputPolicyVersion:f.state.policy});f.chapter.sections[0]=JSON.parse(JSON.stringify(s));f.section=f.chapter.sections[0];
  const restored=f.section,quality=f.context.reportReviewCandidate(f.chapter,restored);
  assert.notEqual(quality.status,'blocked');assert.equal(issue(quality),undefined);assert.equal(restored.content,before.content);
  assert.ok(WF.acceptCandidate(restored));assert.equal(restored.content,text);assert.equal(restored.pendingRevision,null);
  assert.equal(WF.undoSection(restored),true);assert.equal(restored.content,before.content);assert.deepEqual(restored.completionContract,before.completionContract);
});

test('有输入身份但无原合同仍不补当前合同，错误或不匹配文本不能借用生成凭据',()=>{
  for(const variant of ['missing-contract','wrong-text','empty','invalid-type','overlong']){
    const f=fixture(),s=f.section,text='精确生成文本。';
    WF.rememberGeneratedContract(s,text,f.contract,{completionInputPlanId:f.identity()});
    const c=WF.setCandidate(s,variant==='wrong-text'?text+' ':text,'核查凭据');
    if(variant==='missing-contract')delete c.completionContract;
    if(variant==='empty')c.completionInputPlanId=' ';
    if(variant==='invalid-type')c.completionInputPlanId={plan:f.identity()};
    if(variant==='overlong')c.completionInputPlanId='p'.repeat(513);
    const quality=f.review();assert.equal(quality.status,'blocked',variant);assert.ok(issue(quality),variant);assert.equal(WF.acceptCandidate(s),null,variant);assert.equal(s.content,'保留的正式正文。');
    if(variant==='missing-contract')assert.equal(Object.hasOwn(c,'completionContract'),false);
  }
});

test('旧候选可显式替换为当前精确回执，新稿保存完整历史；旧令牌不能重复替换',()=>{
  const f=fixture(),s=f.section;
  s.pendingRevision={id:'[系统测试]old',before:s.content,after:'旧短稿。',instruction:'旧规则',history:[{id:'[系统测试]earlier',after:'更早短稿。'}]};
  f.review();const previous=WF.clone(s.pendingRevision),token=WF.candidateToken(s.pendingRevision),text='按当前篇幅与规则重新生成的完整正文。';
  WF.rememberGeneratedContract(s,text,f.contract,{completionInputPlanId:f.identity()});
  const replacement=WF.replaceCandidate(s,text,'明确重新生成，保留旧候选历史',{},token);
  assert.ok(replacement);assert.equal(s.content,'保留的正式正文。');assert.equal(replacement.history.length,2);assert.equal(replacement.replacesId,previous.id);
  const expected={...previous};delete expected.history;assert.deepEqual(replacement.history[1],expected);
  assert.notEqual(f.review().status,'blocked');assert.equal(issue(replacement.quality),undefined);
  assert.equal(WF.replaceCandidate(s,'迟到内容','旧令牌',{},token),null);assert.equal(s.pendingRevision,replacement);
  assert.equal(WF.acceptCandidate(s),replacement);assert.deepEqual(s.undoStack[0].appliedCandidate.history,replacement.history);
});

test('有完整生成凭据也必须匹配当前事实、规则和篇幅身份；反复质量刷新不能消除阻断',()=>{
  for(const kind of ['facts','rules','policy']){
    const f=fixture(),s=f.section,text='当前正式生成分析。';WF.rememberGeneratedContract(s,text,f.contract,{completionInputPlanId:f.identity()});WF.setCandidate(s,text,'当前规则');
    const previous=s.pendingRevision.completionInputPlanId;
    if(kind==='facts')f.facts[0].value='改变后的事实';if(kind==='rules')f.state.rules++;if(kind==='policy')f.state.policy='[系统测试]policy-v2';
    assert.notEqual(f.identity(),previous,kind);const quality=f.review();assert.equal(quality.status,'blocked',kind);assert.ok(quality.issues.some(item=>item.code==='candidate-input-plan-changed'),kind);assert.equal(issue(quality),undefined);
    for(let n=0;n<2;n++){assert.equal(WF.refreshCandidateQuality(s).status,'blocked');assert.equal(WF.acceptCandidate(s),null);}
    assert.equal(s.content,'保留的正式正文。');assert.equal(s.pendingRevision.completionInputPlanId,previous);
  }
});

test('生成结构规则升级使旧候选失效，但接受兄弟节正文不会改变输入身份',()=>{
  const f=fixture(),s=f.section,text='当前规则的完整正文。';
  f.context.ReportBusinessStructure={VERSION:'business-structure-v1',BASIS_VERSION:'basis-before'};
  WF.rememberGeneratedContract(s,text,f.contract,{completionInputPlanId:f.identity()});WF.setCandidate(s,text,'当前规则');
  const original=f.identity();
  f.context.chapters[0].sections.push({t:'相邻章节',content:'接受前正文'});const siblingIdentity=f.identity();
  f.context.chapters[0].sections[1].content='接受后的正文及新标题';assert.equal(f.identity(),siblingIdentity);
  f.context.chapters[0].sections.pop();assert.equal(f.identity(),original);
  f.context.ReportBusinessStructure.BASIS_VERSION='basis-after';assert.notEqual(f.identity(),original);
  assert.equal(f.review().status,'blocked');assert.ok(s.pendingRevision.quality.issues.some(item=>item.code==='candidate-input-plan-changed'));
  assert.equal(s.content,'保留的正式正文。');assert.equal(s.pendingRevision.after,text);
});
