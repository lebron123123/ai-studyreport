const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const WF=require('../project-workflow.js'),source=fs.readFileSync('aireport.js','utf8');
const part=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const code=part('function airCaptureReportMutation(','async function airProposeSectionRevision(')+part('async function airGenerateImpactedCandidates(','function airSectionMaterialState(')+part('async function airRunRevision(','async function airResolveRevision(');
function fixture(){
  const old={id:'old',before:'正式全文',after:'旧短版候选',createdAt:'2026-09-30',history:[{id:'older',before:'正式全文',after:'更早候选'}],instruction:'旧要求',quality:{status:'passed'}},s={t:'运营',content:'正式全文',pendingRevision:old},c={cn:'一',name:'运营方案',checked:true,sections:[s]};
  const state={calls:0,saves:0,alerts:[],confirms:0,input:'current-input'};
  const contract={version:'report-completion-v1',requirements:{proseTarget:10}};
  const ctx={chapters:[c],currentProjectId:'[系统测试]A',ProjectWorkflow:WF,ReportOutputPolicy:{contentVersion:'current-policy'},aiReportBusy:false,airAcceptCandidatesBusy:false,aiReportImpactedProgress:null,
    document:{querySelector:()=>null},projectCanEdit:()=>true,airBuildDocPane:()=>{},airSaveState:()=>{},saveDraft:()=>{},airRefreshSection:()=>{},reportLogicRevision:()=>({}),
    confirm:()=>{state.confirms++;return true;},alert:message=>state.alerts.push(message),reportCandidateInputIdentity:()=>state.input,
    airReportLogicImpactSummary:()=>({locked:0}),airCandidateImpactRows:()=>[{c,s,si:0}],reportHasVisibleBody:row=>!!row.content?.trim(),
    reportConfirmGenerationLength:async()=>true,persistReportDraft:async()=>{state.saves++;return {ok:true,remote:true};},
    reviseSection:async()=>{state.calls++;const text='当前计划完整新候选';WF.rememberGeneratedContract(s,text,contract,{completionInputPlanId:state.input});return text;},
    runWorkerPool:async(tasks,worker)=>{for(const task of tasks)await worker(task);}};
  ctx.generateSection=ctx.reviseSection;ctx.window=ctx;vm.createContext(ctx);vm.runInContext(code,ctx);return {ctx,state,s,c,old};
}
test('恢复旧候选或打开入口不等于生成；默认全篇入口仍保护旧候选',async()=>{
  const f=fixture(),before=JSON.stringify(f.s);assert.equal(f.state.calls,0);await f.ctx.airGenerateImpactedCandidates(true);assert.equal(f.state.calls,0);assert.equal(JSON.stringify(f.s),before);
});
test('用户明确重新生成：当前计划回执、旧候选完整历史、正式正文不变，JSON恢复不丢稿',async()=>{
  const f=fixture(),before=JSON.stringify(f.old);await f.ctx.airGenerateImpactedCandidates(true,true);
  assert.equal(f.state.calls,1);assert.equal(f.state.saves,2);assert.equal(f.s.content,'正式全文');assert.equal(f.s.pendingRevision.after,'当前计划完整新候选');
  assert.equal(f.s.pendingRevision.completionInputPlanId,'current-input');assert.equal(f.s.pendingRevision.outputPolicyVersion,'current-policy');assert.equal(JSON.stringify(f.old),before);
  const restored=JSON.parse(JSON.stringify(f.s));assert.equal(restored.pendingRevision.history.length,2);assert.equal(restored.pendingRevision.history[0].after,'更早候选');assert.equal(restored.pendingRevision.history[1].after,'旧短版候选');
  assert.equal(WF.candidateOrigin(restored.pendingRevision,{inputPlanId:'current-input',outputPolicyVersion:'current-policy'}).status,'current');
});
test('保存冲突、本机单独保存、篇幅取消、锁定和用户取消均零AI且保留全部旧稿',async()=>{
  for(const mode of ['conflict','local-only','length-cancel','locked','cancel']){
    const f=fixture(),before=JSON.stringify(f.old);
    if(mode==='conflict')f.ctx.persistReportDraft=async()=>{throw Error('保存冲突');};
    if(mode==='local-only')f.ctx.persistReportDraft=async()=>({ok:true,remote:false});
    if(mode==='length-cancel')f.ctx.reportConfirmGenerationLength=async()=>false;
    if(mode==='locked')f.s.locked=true;if(mode==='cancel')f.ctx.confirm=()=>false;
    await f.ctx.airGenerateImpactedCandidates(true,true);assert.equal(f.state.calls,0,mode);assert.equal(JSON.stringify(f.s.pendingRevision),before,mode);assert.equal(f.s.content,'正式全文');
  }
});
test('AI失败、空稿、缺回执不替换旧候选，也不接受正文',async()=>{
  for(const mode of ['error','empty','receipt']){const f=fixture();f.ctx.reviseSection=async()=>{f.state.calls++;if(mode==='error')throw Error('服务失败');return mode==='empty'?'':'无回执结果';};await f.ctx.airGenerateImpactedCandidates(true,true);assert.equal(f.s.pendingRevision,f.old);assert.equal(f.s.content,'正式全文');assert.equal(f.ctx.aiReportImpactedProgress.failed,1);}
});
test('迟到结果遇到项目、权限、锁定、人工候选变化或输入计划变化均拒收',async()=>{
  for(const mode of ['project','permission','locked','candidate','body','input']){
    const f=fixture(),generate=f.ctx.reviseSection;
    f.ctx.reviseSection=async()=>{const text=await generate();if(mode==='project')f.ctx.currentProjectId='[系统测试]B';if(mode==='permission')f.ctx.projectCanEdit=()=>false;if(mode==='locked')f.s.locked=true;if(mode==='candidate')f.s.pendingRevision={id:'human',after:'人工刚改'};if(mode==='body')f.s.content='人工正文';if(mode==='input')f.state.input='changed-input';return text;};
    await f.ctx.airGenerateImpactedCandidates(true,true);assert.notEqual(f.s.pendingRevision.after,'当前计划完整新候选',mode);assert.equal(f.s.content,mode==='body'?'人工正文':'正式全文',mode);assert.equal(f.ctx.aiReportImpactedProgress.failed,1,mode);
  }
});
test('新稿远端保存失败仍留住新旧候选，明确提示不可刷新',async()=>{
  const f=fixture();f.ctx.persistReportDraft=async()=>++f.state.saves===1?{ok:true,remote:true}:{ok:false,remote:false};await f.ctx.airGenerateImpactedCandidates(true,true);
  assert.equal(f.s.pendingRevision.after,'当前计划完整新候选');assert.equal(f.s.pendingRevision.history.at(-1).after,'旧短版候选');assert.match(f.state.alerts.at(-1),/请勿刷新/);assert.equal(f.s.content,'正式全文');
});
test('重复点击不启动第二个批次；受影响范围显式替换也保留旧候选',async()=>{
  const f=fixture();let release;f.ctx.persistReportDraft=()=>new Promise(resolve=>release=()=>resolve({ok:true,remote:true}));const work=f.ctx.airGenerateImpactedCandidates(false,true);while(!release)await new Promise(resolve=>setImmediate(resolve));await f.ctx.airGenerateImpactedCandidates(false,true);assert.equal(f.state.confirms,1);f.ctx.persistReportDraft=async()=>({ok:true,remote:true});release();await work;assert.equal(f.state.calls,1);assert.equal(f.s.pendingRevision.history.at(-1).after,'旧短版候选');
});

test('替换调用明确传递旧候选令牌；确认篇幅、预保存及排队期间的人工变化均不再调用AI',async()=>{
  const exact=fixture(),generate=exact.ctx.reviseSection,token=WF.candidateToken(exact.old);
  exact.ctx.reviseSection=async(c,s,instruction,onChunk,options)=>{assert.deepEqual(JSON.parse(JSON.stringify(options)),{candidateRegeneration:token,autoRepair:true});return generate();};
  await exact.ctx.airGenerateImpactedCandidates(true,true);assert.equal(exact.state.calls,1);
  for(const phase of ['length','save','queue'])for(const mutation of ['accept','reject','replace','body','range']){
    const f=fixture(),change=()=>{if(mutation==='accept'){f.s.content=f.old.after;f.s.pendingRevision=null;}if(mutation==='reject')f.s.pendingRevision=null;if(mutation==='replace')f.s.pendingRevision={id:'human',after:'人工候选'};if(mutation==='body')f.s.content='人工正文';if(mutation==='range')f.c.checked=false;};
    if(phase==='length')f.ctx.reportConfirmGenerationLength=async()=>{change();return true;};
    if(phase==='save')f.ctx.persistReportDraft=async()=>{change();return {ok:true,remote:true};};
    if(phase==='queue')f.ctx.runWorkerPool=async(tasks,worker)=>{change();for(const task of tasks)await worker(task);};
    await f.ctx.airGenerateImpactedCandidates(true,true);assert.equal(f.state.calls,0,phase+'/'+mutation);assert.notEqual(f.s.pendingRevision?.after,'当前计划完整新候选',phase+'/'+mutation);
  }
});

test('局部AI修改只给精确合并全文转移本次回执，不改正式正文',async()=>{
  const f=fixture();delete f.s.pendingRevision;
  const button={disabled:false},input={value:'加强此段论证'},output={},modal={remove:()=>{f.state.closed=true;}};
  f.ctx.document.getElementById=id=>({airRevisionSubmit:button,airRevisionInstruction:input,airRevisionOutput:output,airRevisionModal:modal}[id]);
  f.ctx.airFindChapterSection=()=>({chapter:f.c,section:f.s});f.ctx.escapeHtml=String;f.ctx.authHeaders=()=>({});f.ctx.fetch=async()=>({ok:true});
  const contract={version:'report-completion-v1',requirements:{proseTarget:10}};
  f.ctx.reviseSectionExcerpt=async()=>{WF.rememberGeneratedContract(f.s,'新片段',contract,{completionInputPlanId:'current-input'});return '新片段';};
  await f.ctx.airRunRevision('一',0,'全文');
  assert.equal(f.s.content,'正式全文');assert.equal(f.s.pendingRevision.after,'正式新片段');
  assert.equal(f.s.pendingRevision.completionInputPlanId,'current-input');assert.deepEqual(f.s.pendingRevision.completionContract,contract);
  assert.equal(WF.generatedInputPlanId(f.s,'正式新片段'),'current-input');assert.equal(WF.generatedContract(f.s,'其他合并全文'),null);assert.equal(f.state.closed,true);
});

test('局部修改缺失回执、计划过期或人工并行修改均不合成候选',async()=>{
  for(const mode of ['missing','stale','body','pending']){
    const f=fixture();delete f.s.pendingRevision;
    const button={disabled:false},input={value:'加强此段论证'},output={};
    f.ctx.document.getElementById=id=>({airRevisionSubmit:button,airRevisionInstruction:input,airRevisionOutput:output}[id]);
    f.ctx.airFindChapterSection=()=>({chapter:f.c,section:f.s});f.ctx.escapeHtml=String;
    f.ctx.reviseSectionExcerpt=async()=>{if(mode!=='missing')WF.rememberGeneratedContract(f.s,'新片段',{version:'report-completion-v1'},{completionInputPlanId:mode==='stale'?'old-input':'current-input'});if(mode==='body')f.s.content='人工正文';if(mode==='pending')f.s.pendingRevision={id:'human',after:'人工候选'};return '新片段';};
    await f.ctx.airRunRevision('一',0,'全文');
    assert.notEqual(f.s.pendingRevision?.after,'正式新片段',mode);assert.equal(f.s.content,mode==='body'?'人工正文':'正式全文',mode);assert.equal(button.disabled,false,mode);assert.match(output.innerHTML,/修改失败/,mode);
  }
});
