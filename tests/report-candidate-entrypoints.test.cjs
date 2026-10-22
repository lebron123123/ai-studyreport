const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const WF=require('../project-workflow.js'),Contract=require('../report-completion-contract.js');
const air=fs.readFileSync(require.resolve('../aireport.js'),'utf8'),app=fs.readFileSync(require.resolve('../app.js'),'utf8');
const part=(source,start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const code=part(air,'function airCaptureReportMutation(','async function airRetrySection(')+part(air,'var airExpandedCandidateKeys=','function airSectionToolsHtml(')+part(air,'async function airRepairCandidate(','function airEmptySectionBodyHtml(')+part(air,'async function airResolveRevision(','function airFallbackSectionLogic(')+part(app,'async function appResolveCandidate(','function bindEvents(');
const contract={version:Contract.VERSION,planId:'ui-test',sectionKey:'经营 / 条款',requirements:{proseTarget:10,proseMax:30,tableMax:1,tableRowsMax:4,cellCharsMax:20}};
function fixture(){
  const section={t:'条款',content:'原文',completionContract:WF.clone(contract)},chapter={cn:'一',name:'经营',checked:true,sections:[section]},alerts=[],confirms=[];
  const state={round:1,editable:true,projectEditable:true,calls:0,saves:0,adopts:0,guards:0};
  const context={setTimeout,chapters:[chapter],currentProjectId:null,ProjectWorkflow:WF,ReportCompletionContract:Contract,ReportOutputPolicy:{contentVersion:'test'},projectWorkflow:{},aiReportHasDoc:true,
    ResearchUI:{active:()=>true,capture:()=>({round:state.round}),editable:()=>state.editable,accepts:token=>token.round===state.round&&state.editable,guard:async()=>{state.guards++;}},
    projectCanEdit:()=>state.projectEditable,reviseSection:async()=>{state.calls++;return '新正文';},reportDurableSectionCall:async()=>{state.calls++;return '精简候选';},
    airFindChapterSection:()=>({chapter,section}),findChapterSection:()=>({chapter,section}),reportReviewCandidate:(c,s)=>WF.refreshCandidateQuality(s),
    saveDraft:()=>state.saves++,airSaveState:()=>{},persistReportDraft:async()=>{state.saves++;return {ok:true,remote:true};},airRefreshSection:()=>{},airBuildDocPane:()=>{},airApplyDocMaterialStatuses:()=>{},renderSheet:()=>{},
    currentReportVersionMeta:reason=>({reason}),adoptReportLogicRevision:async()=>{state.adopts++;return {message:'采纳'};},prompt:(message,value)=>value,alert:message=>alerts.push(message),confirm:message=>{confirms.push(message);return true;}};
  context.window=context;vm.createContext(context);vm.runInContext(code,context);return {context,state,section,chapter,alerts,confirms};
}
test('私人研究没有正式项目 ID 仍可生成；项目权限不误伤研究，但研究只读禁止调用',async()=>{
  const f=fixture();f.state.projectEditable=false;
  const result=JSON.parse(await f.context.airProposeSectionRevision({title:'条款',instruction:'精简'}));
  assert.equal(result.ok,true);assert.equal(f.section.pendingRevision.after,'新正文');assert.equal(f.section.content,'原文');assert.equal(f.state.guards,2);
  const denied=fixture();denied.state.editable=false;assert.equal(JSON.parse(await denied.context.airProposeSectionRevision({title:'条款',instruction:'改写'})).ok,false);assert.equal(denied.state.calls,0);
});
test('工具不覆盖已有候选；生成期间锁定或加入新候选均失败，不返回虚假成功',async()=>{
  const existing=fixture();WF.setCandidate(existing.section,'已有候选','先前');const original=existing.section.pendingRevision;
  assert.equal(JSON.parse(await existing.context.airProposeSectionRevision({title:'条款',instruction:'改写'})).ok,false);assert.equal(existing.state.calls,0);assert.equal(existing.section.pendingRevision,original);
  for(const mutation of [s=>s.locked=true,s=>WF.setCandidate(s,'别的候选','并行')]){
    const f=fixture();f.context.reviseSection=async()=>{mutation(f.section);return '迟到候选';};
    assert.equal(JSON.parse(await f.context.airProposeSectionRevision({title:'条款',instruction:'改写'})).ok,false);assert.notEqual(f.section.pendingRevision?.after,'迟到候选');assert.equal(f.state.saves,0);
  }
});
test('异步权限核验后再次核对研究轮次；切换后不接收结果',async()=>{
  const f=fixture();f.context.ResearchUI.guard=async()=>{f.state.round++;};
  assert.equal(JSON.parse(await f.context.airProposeSectionRevision({title:'条款',instruction:'改写'})).ok,false);assert.equal(f.state.calls,0);assert.equal(f.section.pendingRevision,undefined);
});
test('返修捕获内容 hash，原地编辑同一候选对象也不会被迟到结果覆盖',async()=>{
  const f=fixture();WF.setCandidate(f.section,'冗长候选正文'.repeat(15),'原候选');const candidate=f.section.pendingRevision;
  f.context.reportDurableSectionCall=async()=>{candidate.after='人工已调整的候选';return '迟到精简';};
  await f.context.airRepairCandidate('一',0,{disabled:false,isConnected:true});
  assert.equal(f.section.pendingRevision,candidate);assert.equal(candidate.after,'人工已调整的候选');assert.equal(f.section.content,'原文');assert.equal(f.state.saves,0);assert.ok(f.alerts.some(x=>x.includes('已变化')));
});
test('批量确认只报实际可接受数，锁定和质量阻断分别保留',async()=>{
  const f=fixture(),bad={...f.section},locked={...f.section},legacy={t:'旧稿',content:'旧原文'};f.chapter.sections.push(bad,locked,legacy);
  WF.setCandidate(f.section,'新正文','修改');WF.setCandidate(bad,'超长正文'.repeat(30),'修改');WF.setCandidate(locked,'锁定正文','修改');locked.locked=true;WF.setCandidate(legacy,'旧候选','修改');
  await f.context.airAcceptAllCandidates();
  assert.match(f.confirms[0],/接受 2 个候选/);assert.match(f.confirms[0],/1 个未通过检查、1 个锁定/);assert.match(f.confirms[0],/1 个仍有待核实/);
  assert.equal(f.section.content,'新正文');assert.equal(legacy.content,'旧候选');assert.ok(bad.pendingRevision);assert.ok(locked.pendingRevision);
});
test('批量接受在权限回收后拒绝，候选不丢失',async()=>{
  const f=fixture();WF.setCandidate(f.section,'候选','修改');f.context.ResearchUI.guard=async()=>{f.state.editable=false;};await f.context.airAcceptAllCandidates();
  assert.equal(f.section.content,'原文');assert.ok(f.section.pendingRevision);assert.equal(f.confirms.length,0);assert.equal(f.state.saves,0);
});

test('批量核查复用整篇计划；确认后立即刷新正文，不等待慢保存，不重复接受',async()=>{
  const f=fixture();f.chapter.sections=Array.from({length:35},(_,i)=>({t:'节'+i,content:'原稿'+i,completionContract:WF.clone(contract)}));
  f.chapter.sections.forEach(s=>WF.setCandidate(s,'新正文','修改'));
  let plans=0,reviews=0,release,rendered=false;
  const plan={planId:'batch-test',sections:[]};f.context.reportCompletionPlan=()=>{plans++;return plan;};
  f.context.reportReviewCandidate=(c,s,p)=>{assert.equal(p,plan);reviews++;return WF.refreshCandidateQuality(s);};
  f.context.airBuildDocPane=()=>{rendered=true;};
  f.context.persistReportDraft=()=>new Promise(resolve=>{release=resolve;});
  const work=f.context.airAcceptAllCandidates();
  while(!release)await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(rendered,true);assert.equal(plans,2);assert.equal(reviews,35);
  assert.equal(f.context.projectWorkflow.reportVersions.length,1);
  assert.equal(f.chapter.sections.filter(s=>s.pendingRevision).length,0);
  assert.match(vm.runInContext('airAcceptCandidatesProgress',f.context),/已接受 35.*正在保存/);
  await f.context.airAcceptAllCandidates();assert.equal(f.context.projectWorkflow.reportVersions.length,1);
  release({ok:true,remote:true});await work;
  assert.equal(vm.runInContext('airAcceptCandidatesBusy',f.context),false);
  assert.match(vm.runInContext('airAcceptCandidatesProgress',f.context),/项目库已保存/);
});

test('核查期间正文、候选、锁定、轮次、范围、规则变化均中止，不覆写原稿',async()=>{
  for(const kind of ['body','candidate','lock','round','range','rules']){
    const f=fixture();WF.setCandidate(f.section,'新正文','修改');let plans=0;
    f.context.reportCompletionPlan=()=>({planId:kind==='rules'&&++plans>1?'changed':'original',sections:[]});
    const original=f.context.reportReviewCandidate;
    f.context.reportReviewCandidate=(c,s,p)=>{
      const result=original(c,s,p);
      if(kind==='body')s.content='人工新正文';
      if(kind==='candidate')s.pendingRevision.after='人工新候选';
      if(kind==='lock')s.locked=true;
      if(kind==='round')f.state.round++;
      if(kind==='range')c.checked=false;
      return result;
    };
    await f.context.airAcceptAllCandidates();
    assert.equal(f.section.content,kind==='body'?'人工新正文':'原文',kind);
    assert.ok(f.section.pendingRevision,kind);assert.equal(f.state.saves,0,kind);
    assert.equal(f.context.projectWorkflow.reportVersions,undefined,kind);
    assert.equal(vm.runInContext('airAcceptCandidatesBusy',f.context),false,kind);
  }
});

test('取消批量确认不接受；预览失败仍保存接受版本',async()=>{
  const cancelled=fixture();WF.setCandidate(cancelled.section,'新正文','修改');cancelled.context.confirm=()=>false;
  await cancelled.context.airAcceptAllCandidates();assert.ok(cancelled.section.pendingRevision);assert.equal(cancelled.state.saves,0);
  assert.equal(vm.runInContext('airAcceptCandidatesProgress',cancelled.context),null);
  const f=fixture();WF.setCandidate(f.section,'新正文','修改');f.context.airBuildDocPane=()=>{throw Error('预览失败');};
  f.context.document={getElementById:()=>{throw Error('工具栏已脱离');}};
  await f.context.airAcceptAllCandidates();assert.equal(f.state.saves,1);assert.equal(f.section.content,'新正文');
  assert.match(f.alerts[0],/项目库已确认保存/);assert.match(f.alerts[0],/预览未更新/);
});
test('旧复核页接受并采纳不能绕过质量；被阻断时不采纳、不记成功版本',async()=>{
  const f=fixture();WF.setCandidate(f.section,'超长候选'.repeat(40),'修改',{logicRevision:{rules:[]}});await f.context.appResolveCandidate('一',0,'adopt');
  assert.equal(f.section.content,'原文');assert.ok(f.section.pendingRevision);assert.equal(f.state.adopts,0);assert.equal(f.state.saves,0);assert.equal(f.context.projectWorkflow.reportVersions,undefined);
});
test('旧复核页允许保存超预算人工稿，重新标记阻断且撤销保留之前质量',()=>{
  const f=fixture();f.section.completionQuality={status:'passed',factsVerified:false};f.context.appSaveManualSection({chapter:f.chapter,section:f.section},'<p>'+'长人工稿'.repeat(25)+'</p>','原文');
  assert.match(f.section.editedHtml,/长人工稿/);assert.equal(f.section.completionQuality.status,'blocked');assert.equal(f.state.saves,1);assert.equal(f.section.undoStack[0].completionQuality.status,'passed');
});
test('数值差异候选显式警示待核对，取消不接受',async()=>{
  const f=fixture();f.section.content='面积 38165 平方米';WF.setCandidate(f.section,'保留项目情况','精简');
  f.context.confirm=message=>{f.confirms.push(message);return false;};await f.context.airResolveRevision('一',0,'accept');
  assert.equal(f.section.pendingRevision.quality.status,'unverified');assert.match(f.confirms[0],/38165/);assert.equal(f.section.content,'面积 38165 平方米');assert.equal(f.state.saves,0);
});

test('接受后先保存再采纳，保存失败或保存期间切换研究均不采纳逻辑',async()=>{
  for(const scenario of ['saved','failed','switched']){
    const f=fixture(),events=[];WF.setCandidate(f.section,'新正文','修改',{logicRevision:{rules:[]}});
    f.context.persistReportDraft=async()=>{events.push('save');if(scenario==='switched')f.state.round++;return {ok:scenario!=='failed',remote:true};};
    f.context.adoptReportLogicRevision=async()=>{events.push('adopt');return {message:'已采纳'};};
    await f.context.airResolveRevision('一',0,'adopt');
    assert.deepEqual(events,scenario==='saved'?['save','adopt']:['save']);assert.equal(f.section.content,'新正文');assert.equal(f.section.pendingRevision,null);
  }
});
