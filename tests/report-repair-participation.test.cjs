const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const WF=require('../project-workflow.js'),Contract=require('../report-completion-contract.js');
const source=fs.readFileSync(require.resolve('../aireport.js'),'utf8');
const part=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const code=part('function airCaptureReportMutation(','async function airRetrySection(')+part('var airExpandedCandidateKeys=','function airSectionToolsHtml(')+part('function airCandidateHtml(','function airGenerationSkeletonHtml(')+part('async function airRepairCandidate(','function airEmptySectionBodyHtml(');
const contract={version:Contract.VERSION,planId:'[系统测试]repair',sectionKey:'经营 / 条款',requirements:{proseTarget:10,proseMax:30,tableMax:1,tableRowsMax:4,cellCharsMax:20}};
const escapeHtml=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function fixture(){
  const section={t:'条款',content:'原正文',completionContract:WF.clone(contract)},chapter={cn:'一',name:'经营',checked:true,sections:[section]};
  WF.setCandidate(section,'详细分析候选正文'.repeat(12),'原修订说明',{completionInputPlanId:'[系统测试]repair-input',outputPolicyVersion:'test'});
  const state={round:1,editable:true,calls:[],saves:0,refreshes:0,alerts:[],confirms:[]};
  const context={chapters:[chapter],currentProjectId:null,ProjectWorkflow:WF,ReportCompletionContract:Contract,ReportOutputPolicy:{contentVersion:'test'},escapeHtml,
    ResearchUI:{active:()=>true,capture:()=>({round:state.round}),editable:()=>state.editable,accepts:token=>token.round===state.round&&state.editable,guard:async()=>{}},
    airFindChapterSection:()=>({chapter,section}),reportCandidateInputIdentity:()=> '[系统测试]repair-input',reportReviewCandidate:(c,s)=>WF.refreshCandidateQuality(s),
    reportDurableSectionCall:async(...args)=>{state.calls.push(args);return '定向修改后的正文';},
    saveDraft:()=>state.saves++,airSaveState:()=>{},persistReportDraft:async()=>{state.saves++;return {ok:true};},airRefreshSection:()=>state.refreshes++,
    prompt:(message,value)=>value,confirm:message=>{state.confirms.push(message);return true;},alert:message=>state.alerts.push(message)};
  context.window=context;vm.createContext(context);vm.runInContext(code,context);
  return {context,state,section,chapter};
}
function controls(value='加强租赁风险论证，保留原有三级标题和测算表格。'){
  const input={value,disabled:false,isConnected:true};
  const button={disabled:false,isConnected:true,textContent:'按要求返修',closest:()=>({querySelector:()=>input})};
  return {input,button};
}

test('未通过候选默认展开，显示真实正文字符数、具体问题、修订要求和前后对比；可收起再展开',()=>{
  const f=fixture(),candidate=f.section.pendingRevision;
  candidate.instruction='<script>不可执行</script>';
  f.context.reportReviewCandidate=()=>({status:'blocked',issues:[{code:'too-long',severity:'error',repairable:true,message:'超预算 <核对分析>'}]});
  let html=f.context.airCandidateHtml(f.chapter,f.section,0);
  assert.match(html,new RegExp('修改前正文 '+Contract.measure(candidate.before).proseCharacters+' 字'));
  assert.match(html,new RegExp('候选正文 '+Contract.measure(candidate.after).proseCharacters+' 字'));
  assert.match(html,/aria-expanded="true"/);assert.match(html,/wf-diff-old/);assert.match(html,/wf-diff-new/);
  assert.match(html,/超预算 &lt;核对分析&gt;/);assert.match(html,/&lt;script&gt;不可执行/);assert.doesNotMatch(html,/<script>/);
  assert.match(html,/本次修订要求（可修改）/);assert.match(html,/保留业务标题层级及全部必要表格/);
  assert.match(html,/air-candidate-accept" disabled/);
  f.context.airToggleCandidatePreview('一',0,true);html=f.context.airCandidateHtml(f.chapter,f.section,0);
  assert.match(html,/aria-expanded="false"/);assert.doesNotMatch(html,/wf-diff-cols/);
  f.context.airToggleCandidatePreview('一',0,false);assert.match(f.context.airCandidateHtml(f.chapter,f.section,0),/wf-diff-cols/);
});

test('通过的长候选保持按需展开，不把字数当成排版通过',()=>{
  const f=fixture();f.context.reportReviewCandidate=()=>({status:'passed',issues:[]});
  const html=f.context.airCandidateHtml(f.chapter,f.section,0);
  assert.match(html,/aria-expanded="false"/);assert.doesNotMatch(html,/wf-diff-cols/);
  assert.match(html,/字符数不等于实际排版页数/);assert.match(html,/事实仍须人工核对/);
  assert.doesNotMatch(html,/air-candidate-repair-instruction/);
});

test('用户一次返修只请求一次，使用明确指令，保留旧候选历史且不自动接受',async()=>{
  const f=fixture(),previous=f.section.pendingRevision,{button,input}=controls();
  await f.context.airRepairCandidate('一',0,button);
  assert.equal(f.state.calls.length,1);assert.match(f.state.calls[0][2],/加强租赁风险论证/);
  assert.match(f.state.calls[0][2],/保留业务标题层级及全部必要表格/);assert.match(f.state.calls[0][2],/不把完整分析改成短摘要/);
  assert.equal(f.state.calls[0][5].candidateRepair,previous);assert.equal(f.section.content,'原正文');
  assert.equal(f.section.pendingRevision.after,'定向修改后的正文');assert.equal(f.section.pendingRevision.history.length,1);
  assert.equal(f.section.pendingRevision.history[0].after,previous.after);assert.match(f.section.pendingRevision.instruction,/加强租赁风险论证/);
  assert.equal(button.disabled,false);assert.equal(input.disabled,false);assert.equal(f.state.saves,1);
});

test('返修过程中即使重新渲染或重复点击，同一候选最多请求一次；失败保留全文和可操作按钮',async()=>{
  const f=fixture(),previous=f.section.pendingRevision,first=controls(),second=controls();let release;
  f.context.reportDurableSectionCall=(...args)=>{f.state.calls.push(args);return new Promise((resolve,reject)=>{release=()=>reject(Error('模型暂不可用'));});};
  const work=f.context.airRepairCandidate('一',0,first.button);
  while(!release)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(first.button.disabled,true);assert.equal(first.input.disabled,true);
  assert.match(f.context.airCandidateHtml(f.chapter,f.section,0),/正在按要求返修一次/);
  await f.context.airRepairCandidate('一',0,second.button);assert.equal(f.state.calls.length,1);
  release();await work;
  assert.equal(f.section.pendingRevision,previous);assert.equal(previous.after,'详细分析候选正文'.repeat(12));
  assert.match(previous.repairError,/模型暂不可用/);assert.equal(f.section.content,'原正文');
  assert.equal(first.button.disabled,false);assert.equal(first.input.disabled,false);
  assert.equal(vm.runInContext('airCandidateRepairsInFlight.has(chapters[0].sections[0].pendingRevision)',f.context),false);
  assert.match(f.context.airCandidateHtml(f.chapter,f.section,0),/上次返修未完成：模型暂不可用/);
});

test('返修新稿仍未通过时保存新稿、服务端质量和旧候选历史，不自动丢弃新文本',async()=>{
  const f=fixture(),previous=f.section.pendingRevision,{button}=controls();
  const serverQuality={status:'blocked',factsVerified:false,issues:[{code:'structured-heading',severity:'error',repairable:true,message:'三级标题需核对'}]};
  f.context.reportDurableSectionCall=async(...args)=>{f.state.calls.push(args);const error=Error('新稿仍未通过标题检查');Object.assign(error,{code:'REPORT_CANDIDATE_QUALITY_BLOCKED',candidateText:'完整的新返修候选正文',resultQuality:serverQuality,candidateContract:contract});throw error;};
  await f.context.airRepairCandidate('一',0,button);
  assert.equal(f.state.calls.length,1);assert.equal(f.section.pendingRevision.after,'完整的新返修候选正文');
  assert.equal(f.section.pendingRevision.history[0].after,previous.after);assert.equal(f.section.content,'原正文');
  assert.deepEqual(f.section.pendingRevision.serverQuality,serverQuality);assert.equal(f.section.pendingRevision.quality.status,'blocked');
  assert.match(f.state.alerts.at(-1),/新稿及旧候选历史均已保留/);assert.match(f.context.airCandidateHtml(f.chapter,f.section,0),/三级标题需核对/);
});

test('取消、空指令或不可猜测事实不调用AI',async()=>{
  for(const scenario of ['cancel','blank','missing']){
    const f=fixture(),{button}=controls(scenario==='blank'?'   ':'核对标题');
    if(scenario==='cancel')f.context.confirm=()=>false;
    if(scenario==='missing')f.context.reportReviewCandidate=()=>({status:'blocked',issues:[{severity:'error',repairable:false,message:'缺失事实'}]});
    await f.context.airRepairCandidate('一',0,button);assert.equal(f.state.calls.length,0,scenario);assert.equal(f.state.saves,0,scenario);
    assert.equal(f.section.content,'原正文');assert.ok(f.section.pendingRevision);
  }
});

test('返修候选保存失败仍可在当前页面展开核对，不自动接受也不丢失新旧稿',async()=>{
  const f=fixture(),previous=f.section.pendingRevision,{button}=controls();
  f.context.persistReportDraft=async()=>{throw Error('服务器保存失败');};
  await f.context.airRepairCandidate('一',0,button);
  assert.equal(f.section.content,'原正文');assert.equal(f.section.pendingRevision.after,'定向修改后的正文');
  assert.equal(f.section.pendingRevision.history[0].after,previous.after);assert.ok(f.state.refreshes>0);
  assert.match(f.state.alerts.at(-1),/请勿刷新并重试保存/);assert.equal(button.disabled,false);
});

test('返修期间项目轮次、锁定、候选正文或权限变化，不接收迟到新稿，也不写入旧项目',async()=>{
  for(const scenario of ['round','lock','candidate','permission']){
    const f=fixture(),previous=f.section.pendingRevision,{button}=controls();
    f.context.reportDurableSectionCall=async(...args)=>{
      f.state.calls.push(args);
      if(scenario==='round')f.state.round++;
      if(scenario==='lock')f.section.locked=true;
      if(scenario==='candidate')previous.after='人工已修改候选';
      if(scenario==='permission')f.state.editable=false;
      return '迟到新稿';
    };
    await f.context.airRepairCandidate('一',0,button);
    assert.equal(f.section.pendingRevision,previous,scenario);assert.notEqual(previous.after,'迟到新稿',scenario);
    assert.equal(f.section.content,'原正文');assert.equal(f.state.saves,0,scenario);
  }
});
