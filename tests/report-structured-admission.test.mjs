import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {reportCandidateOutput,reportCandidateQuality,reportQualityRepairState,reportSlotRepairPlan} from '../functions/api/reportexecution.js';

const require=createRequire(import.meta.url),C=require('../report-completion-contract.js'),WF=require('../project-workflow.js'),P=require('../report-output-policy.js');
const reportSource=fs.readFileSync('report.js','utf8');
const reportPart=(start,end)=>reportSource.slice(reportSource.indexOf(start),reportSource.indexOf(end,reportSource.indexOf(start)));
const durableSource=reportPart('async function reportDurableSectionCall','async function callGen');
const identitySource=[
  reportPart('function reportCompletionFacts(','async function reportConfirmGenerationLength('),
  reportPart('function reportFinancialContext(','function reportCompletionEntries('),
  reportPart('function rlProjectText(','function rlRetrieve(')
].join('\n');
const clientSource=fs.readFileSync('report-orchestration-client.js','utf8');
const plan=C.createPlan([{name:'经营方案',sections:[{t:'合作安排'}]}]);
const contract={...plan.sections[0],requirements:{...plan.sections[0].requirements,proseTarget:700,proseMax:910}};
const paragraph=(slot,text)=>({kind:'paragraph',slot,text});

// The model transport is simulated; the actual backend decoder/quality, task client,
// durable admission and workflow acceptance are executed without AI or database writes.
function runtime(raw,{omitQuality=false,serverPass=false,completion=C,slotRepair=false,beforeComplete}={}){
  const tasks=new Map(),requests=[];
  let saved=0;
  const ctx={currentProjectId:'[系统测试]project',projectWorkflow:{},project:{},calcParams:{},kbEntries:[],chapters:[{name:'经营方案',sections:[{t:'合作安排'}]}],rlProjectType:()=> 'gaibao',ProjectWorkflow:WF,ReportOutputPolicy:P,ReportCompletionContract:completion,reportSectionContract:()=>contract,reportCompletionPlan:()=>({...plan,sections:[contract]}),reportAssertCompletionPlan:p=>p,reportCompletionEntries:()=>[{key:contract.sectionKey,number:'1.1',text:''}],saveDraft:()=>saved++,AbortController,URLSearchParams,setTimeout,clearTimeout};
  ctx.window=ctx;
  ctx.fetch=async(url,options)=>{
    const request={url,method:options.method};requests.push(request);
    if(options.method==='POST'){
      const payload=JSON.parse(options.body),round=payload.action==='repair'?tasks.get(payload.id).round+1:0,id='[系统测试]task-'+tasks.size;
      request.payload=payload;
      let snapshot=payload.action==='repair'?tasks.get(payload.id).snapshot:{qualityContract:payload.qualityContract,outputFormat:C.OUTPUT_FORMAT};
      if(payload.action==='repair'&&slotRepair){
        const previous=tasks.get(payload.id),output=reportCandidateOutput(previous.snapshot,previous.rawText),quality=reportCandidateQuality(previous.snapshot,previous.rawText);
        const patch=reportSlotRepairPlan({rawText:previous.rawText,structuredText:output.structuredText,quality},previous.snapshot.qualityContract);
        snapshot={...snapshot,qualityRepair:{round}};delete snapshot.qualitySlotPatch;if(patch)snapshot.qualitySlotPatch=patch;
      }
      tasks.set(id,{id,round,snapshot,rawText:typeof raw==='function'?raw(snapshot,round,payload):raw});
      return {ok:true,json:async()=>({ok:true,task:{id,runId:'run-'+round,status:'queued'}})};
    }
    const id=new URL(url,'http://test.invalid').searchParams.get('id'),task=tasks.get(id),output=reportCandidateOutput(task.snapshot,task.rawText);
    const quality=serverPass?{status:'passed',issues:[],factsVerified:false}:reportCandidateQuality(task.snapshot,task.rawText);
    const completed={id,runId:'run-'+task.round,status:'completed',text:output.text,rawText:task.rawText,structuredText:output.structuredText,outputFormat:output.format,...(omitQuality?{}:{quality}),repair:reportQualityRepairState({qualityRepair:{round:task.round}},quality)};
    if(beforeComplete)await beforeComplete({ctx,task:completed});
    return {ok:true,json:async()=>({ok:true,task:completed})};
  };
  vm.runInNewContext(clientSource,ctx);
  vm.runInNewContext(identitySource+'\n'+durableSource,ctx);
  return {ctx,tasks,requests,saved:()=>saved};
}

async function blockedResult(promise){
  let blocked;
  await assert.rejects(promise,error=>{blocked=error;return error.code==='REPORT_CANDIDATE_QUALITY_BLOCKED';});
  return blocked;
}
// This is the guarded workflow hand-off performed by airRepairCandidate, not an
// automatic transport repair. Its actual DOM/handler behavior has separate tests.
function retainReplacement(s,text,quality,previous){
  const next=WF.replaceCandidate(s,text,'[系统测试]用户明确返修一次',{},WF.candidateToken(previous));
  assert.ok(next);next.serverQuality=WF.clone(quality);next.quality=WF.clone(quality);
  return next;
}

for(const [name,blocks,issue] of [
  ['单槽超限但整节未超',[paragraph('finding','字'.repeat(C.outputSlots(contract)[0].hardMax+1))],'structured-slot-budget'],
  ['重复槽位但合计很短',[paragraph('finding','事实甲'),paragraph('finding','事实乙')],'structured-slot-duplicate'],
  ['槽位乱序但合计很短',[paragraph('decision','待核对'),paragraph('finding','事实甲')],'structured-slot-order']
])test('后端→任务客户端→候选接受：'+name+'首稿可见，不自动返修或被纯文本检查洗白',async()=>{
  const raw=JSON.stringify({blocks}),backend=reportCandidateOutput({qualityContract:contract,outputFormat:C.OUTPUT_FORMAT},raw);
  assert.equal(C.inspect(backend.text,contract).status,'passed');
  const r=runtime(raw),s={t:'合作安排',content:'正式原稿',completionContract:contract},chunks=[];
  const error=await blockedResult(r.ctx.reportDurableSectionCall({name:'经营方案'},s,'system','user',x=>chunks.push(x)));
  assert.equal(error.taskId,'[系统测试]task-0');assert.equal(error.candidateSaved,true);assert.equal(error.candidateText,backend.text);
  assert.equal(r.tasks.size,1);assert.equal(r.requests.length,2);assert.equal(r.requests.filter(request=>request.method==='POST'&&request.payload.action==='repair').length,0);
  assert.ok([...r.tasks.values()].every(t=>t.rawText===raw));
  assert.equal(s.content,'正式原稿');assert.equal(s.pendingRevision.after,backend.text);assert.equal(s.pendingRevision.before,'正式原稿');assert.equal(s.undoStack,undefined);
  assert.deepEqual(chunks,[]);assert.equal(WF.acceptCandidate(s),null);
  assert.equal(s.executionTask.quality.status,'blocked');assert.equal(s.executionTask.quality.factsVerified,false);
  assert.ok(s.executionTask.quality.issues.some(i=>i.code===issue));assert.equal(s.executionTask.repair.exhausted,false);
  for(let n=0;n<3;n++){
    const restored=JSON.parse(JSON.stringify(s));
    assert.equal(WF.refreshCandidateQuality(restored).status,'blocked');assert.ok(restored.pendingRevision.serverQuality.issues.some(i=>i.code===issue));assert.equal(WF.acceptCandidate(restored),null);
  }
  assert.equal(s.executionTask.outputFormat,C.OUTPUT_FORMAT);assert.equal(s.completionQuality,undefined);assert.ok(r.saved()>0);
});

test('已有候选显式返修失败：保留原候选全文与质量，后台新原始结果仍可定位',async()=>{
  const raw=JSON.stringify({blocks:[paragraph('finding','字'.repeat(C.outputSlots(contract)[0].hardMax+1))]}),r=runtime(raw);
  const s={t:'合作安排',content:'正式原稿',completionContract:contract},old=WF.setCandidate(s,'旧候选'.repeat(400),'初次生成'),before=JSON.stringify(old),chunks=[];
  const error=await blockedResult(r.ctx.reportDurableSectionCall({name:'经营方案'},s,'system','user',x=>chunks.push(x),{candidateRepair:old}));
  assert.equal(s.pendingRevision,old);assert.equal(JSON.stringify(old),before);assert.equal(s.content,'正式原稿');assert.deepEqual(chunks,[]);
  assert.equal(s.executionTask.id,'[系统测试]task-0');assert.equal(r.tasks.size,1);assert.equal(r.requests.length,2);
  assert.equal(error.candidateSaved,false);assert.equal(error.candidateText,reportCandidateOutput(r.tasks.get(s.executionTask.id).snapshot,raw).text);
  assert.equal(error.candidateContract.planId,s.completionContract.planId);assert.ok(error.resultQuality.issues.some(issue=>issue.code==='structured-slot-budget'));
  assert.equal(r.tasks.get(s.executionTask.id).rawText,raw);assert.equal(WF.acceptCandidate(s),null);
  const replacement=retainReplacement(s,error.candidateText,error.resultQuality,old);
  assert.equal(replacement.after,error.candidateText);assert.equal(replacement.history.length,1);assert.equal(replacement.history[0].after,old.after);
  assert.equal(replacement.quality.status,'blocked');assert.equal(s.content,'正式原稿');assert.equal(WF.acceptCandidate(s),null);
  assert.equal(WF.replaceCandidate(s,'过期结果','过期返修',{},WF.candidateToken(old)),null,'旧令牌不能覆盖新候选');
});

test('缺结构化质量回执失败闭合，本地整体超限也不能被服务端passed绕过',async()=>{
  for(const options of [{omitQuality:true},{serverPass:true}]){
    const raw=JSON.stringify({blocks:[paragraph('finding',options.serverPass?'字'.repeat(1000):'短正文')]}),r=runtime(raw,options),s={t:'合作安排',content:'原稿'};
    const error=await blockedResult(r.ctx.reportDurableSectionCall({name:'经营方案'},s,'s','u'));
    assert.equal(s.content,'原稿');assert.equal(error.candidateSaved,true);assert.equal(s.pendingRevision.after,error.candidateText);assert.equal(r.tasks.size,1);
    const issue=options.omitQuality?'structured-quality-missing':'budget-proseCharacters';
    assert.ok(s.executionTask.quality.issues.some(i=>i.code===issue));assert.ok(s.pendingRevision.serverQuality.issues.some(i=>i.code===issue));assert.equal(WF.acceptCandidate(s),null);
  }
});

test('结构合格候选仍经过工作流及人工接受；事实状态不伪造为已认证',async()=>{
  const r=runtime(JSON.stringify({blocks:[paragraph('finding','按已核对合同安排实施。')]})),s={t:'合作安排',content:'正式原稿',completionContract:contract},chunks=[];
  const text=await r.ctx.reportDurableSectionCall({name:'经营方案'},s,'s','u',x=>chunks.push(x));
  assert.equal(r.tasks.size,1);assert.equal(text,'按已核对合同安排实施。');assert.deepEqual(chunks,[text]);assert.equal(s.content,'正式原稿');
  const candidate=WF.setCandidate(s,text,'生成');assert.equal(candidate.quality.status,'passed');assert.equal(candidate.quality.factsVerified,false);
  assert.match(candidate.completionInputPlanId,/^candidate-input-v1:/);assert.equal(candidate.completionInputPlanId,r.ctx.reportCandidateInputIdentity());
  r.ctx.project.desc='[系统测试]修改项目事实';assert.notEqual(candidate.completionInputPlanId,r.ctx.reportCandidateInputIdentity(),'真实身份随外部项目输入变化，不是恒定测试替身');
  assert.ok(WF.acceptCandidate(s));assert.equal(s.content,text);assert.equal(s.completionQuality.factsVerified,false);
});

test('历史解码候选的原有结构错误跨刷新/批量接受仍阻断，只有明确替换形成新稿',()=>{
  const raw=JSON.stringify({blocks:[paragraph('finding','字'.repeat(C.outputSlots(contract)[0].hardMax+1))]}),snapshot={qualityContract:contract,outputFormat:C.OUTPUT_FORMAT};
  const s={content:'原稿',completionContract:contract,pendingRevision:{id:'legacy-decoded',before:'原稿',after:reportCandidateOutput(snapshot,raw).text,quality:reportCandidateQuality(snapshot,raw)}};
  for(let n=0;n<3;n++)assert.equal(WF.refreshCandidateQuality(s).status,'blocked');
  assert.equal(s.pendingRevision.quality.issues.filter(i=>i.code==='structured-slot-budget').length,1);
  const old=s.pendingRevision;assert.equal(WF.acceptCandidate(s),null);assert.equal(s.pendingRevision,old);
  const result=WF.acceptAllCandidates([{checked:true,sections:[s]}]);assert.equal(result.accepted,0);assert.equal(result.blocked,1);
  const replacement=WF.replaceCandidate(s,'已重新核对的短候选','明确返修',{},WF.candidateToken(old));
  assert.equal(replacement.quality.status,'passed');assert.ok(replacement.history[0].quality.issues.some(i=>i.code==='structured-slot-budget'));
  assert.equal(s.content,'原稿');assert.ok(WF.acceptCandidate(s));assert.equal(s.content,'已重新核对的短候选');
});

const originalTable='<table class="rpt"><tr><th rowspan="2">费用</th><th colspan="2">万元</th></tr><tr><th>首期</th><th>合计</th></tr><tr><td>工程</td><td><span style="color:#123456">100.00</span></td><td>100.00</td></tr></table>';
test('定点补丁后端→任务客户端→人工候选：每轮明确请求一次，合并保留好段及原表',async()=>{
  const r=runtime((snapshot,round)=>{
    const patch=snapshot.qualitySlotPatch;
    if(patch)return JSON.stringify({replacements:patch.targets.map(t=>({slot:t.slot,text:round===1&&t.slot==='conditions'?'险'.repeat(t.hardMax+1):t.slot==='evidence'?'已核对的具体实施依据。':'风险条件仍待核实。'}))});
    const slots=C.outputSlots(snapshot.qualityContract);return JSON.stringify({blocks:[paragraph('finding','合格结论保持不变。'),paragraph('evidence','据'.repeat(slots[1].hardMax+8)),{kind:'table-ref',id:snapshot.qualityContract.frozenTables.tables[0].id},paragraph('conditions','险'.repeat(slots[2].hardMax+8)),paragraph('decision','条件未确认，不得实施。')]});
  },{slotRepair:true}),s={t:'合作安排',content:'正式原稿',editedHtml:'<p>正式原稿</p>'+originalTable},chunks=[];
  const initial=await blockedResult(r.ctx.reportDurableSectionCall({name:'经营方案'},s,'s','u',value=>chunks.push(value)));
  assert.equal(initial.candidateSaved,true);assert.equal(r.tasks.size,1);assert.equal(s.pendingRevision.after,initial.candidateText);
  const originalCandidate=s.pendingRevision;
  const firstResult=await r.ctx.ReportOrchestrationClient.generateSection({action:'repair',id:initial.taskId,instruction:'[系统测试]第一轮：只修复超限槽位，保留分析与表格'});
  assert.equal(r.tasks.size,2);assert.equal(firstResult.quality.status,'blocked');assert.equal(s.pendingRevision,originalCandidate);
  const firstCandidate=retainReplacement(s,firstResult.text,firstResult.quality,originalCandidate);
  assert.equal(firstCandidate.history.length,1);assert.equal(WF.acceptCandidate(s),null);
  const lastResult=await r.ctx.ReportOrchestrationClient.generateSection({action:'repair',id:firstResult.id,instruction:'[系统测试]第二轮：仅修复风险条件槽位'});
  assert.equal(r.tasks.size,3);assert.equal(r.requests.length,6);assert.equal(lastResult.quality.status,'passed');assert.equal(s.pendingRevision,firstCandidate);
  const text=lastResult.text;
  assert.deepEqual(chunks,[]);assert.equal(s.content,'正式原稿');assert.equal(s.editedHtml,'<p>正式原稿</p>'+originalTable);
  const first=r.tasks.get('[系统测试]task-1'),last=r.tasks.get('[系统测试]task-2'),firstOutput=reportCandidateOutput(first.snapshot,first.rawText),lastOutput=reportCandidateOutput(last.snapshot,last.rawText);
  assert.deepEqual(last.snapshot.qualitySlotPatch.targets.map(t=>t.slot),['conditions']);assert.equal(last.snapshot.qualitySlotPatch.base,firstOutput.structuredText);
  assert.deepEqual(Object.keys(JSON.parse(last.rawText)),['replacements']);assert.ok(lastOutput.text.includes('已核对的具体实施依据。'));assert.ok(lastOutput.text.includes('合格结论保持不变。'));assert.ok(lastOutput.text.includes('条件未确认，不得实施。'));assert.ok(lastOutput.text.includes(originalTable));assert.equal(text,lastOutput.text);
  const candidate=retainReplacement(s,text,lastResult.quality,firstCandidate);assert.equal(candidate.history.length,2);assert.equal(candidate.quality.status,'passed');assert.equal(candidate.quality.factsVerified,false);
  assert.equal(s.content,'正式原稿');assert.ok(WF.acceptCandidate(s));assert.ok(s.content.includes(originalTable));assert.equal(s.completionQuality.factsVerified,false);
});
test('人工定点补丁企图带blocks改表时保留安全全文和错误，绝不改表或自动接受',async()=>{
  let rootRaw;
  const r=runtime(snapshot=>{
    if(snapshot.qualitySlotPatch)return JSON.stringify({replacements:snapshot.qualitySlotPatch.targets.map(t=>({slot:t.slot,text:'短正文'})),blocks:[{kind:'table',title:'篡改表',headers:['项目','万元'],rows:[['工程','999.00']]}]});
    if(rootRaw)return rootRaw;
    rootRaw=JSON.stringify({blocks:[paragraph('finding','字'.repeat(C.outputSlots(snapshot.qualityContract)[0].hardMax+1)),{kind:'table-ref',id:snapshot.qualityContract.frozenTables.tables[0].id}]});return rootRaw;
  },{slotRepair:true}),s={t:'合作安排',content:'正式原稿',editedHtml:originalTable},chunks=[];
  const initial=await blockedResult(r.ctx.reportDurableSectionCall({name:'经营方案'},s,'s','u',value=>chunks.push(value)));
  assert.equal(initial.candidateSaved,true);assert.equal(r.tasks.size,1);const previous=s.pendingRevision;
  const repaired=await r.ctx.ReportOrchestrationClient.generateSection({action:'repair',id:initial.taskId,instruction:'[系统测试]只修复超限，不改表'});
  assert.equal(r.tasks.size,2);assert.equal(r.requests.length,4);assert.equal(s.pendingRevision,previous);
  assert.equal(s.content,'正式原稿');assert.equal(s.editedHtml,originalTable);assert.deepEqual(chunks,[]);
  const bad=r.tasks.get('[系统测试]task-1'),output=reportCandidateOutput(bad.snapshot,bad.rawText),quality=reportCandidateQuality(bad.snapshot,bad.rawText);
  assert.equal(output.structuredText,bad.snapshot.qualitySlotPatch.base);assert.ok(output.text.includes(originalTable));assert.ok(!output.text.includes('999.00'));
  assert.equal(quality.status,'blocked');assert.ok(quality.issues.some(i=>i.code==='structured-slot-patch'));assert.ok(bad.rawText.includes('999.00'),'非法原始响应保留供追溯');
  const candidate=retainReplacement(s,repaired.text,repaired.quality,previous);assert.equal(candidate.history.length,1);assert.ok(candidate.after.includes(originalTable));assert.ok(!candidate.after.includes('999.00'));
  assert.equal(WF.acceptCandidate(s),null);
});

test('候选人工完整返修返回全稿，由调用方保留历史，未经接受不改正式正文',async()=>{
  const r=runtime((snapshot,round,payload)=>JSON.stringify({blocks:[paragraph('finding',payload.user.includes('用户确认修订')?'保留具体分析后的完整返修结论。':'字'.repeat(C.outputSlots(snapshot.qualityContract)[0].hardMax+1)),{kind:'table-ref',id:snapshot.qualityContract.frozenTables.tables[0].id},paragraph('decision','条件未确认，不得实施。')]}));
  const s={t:'合作安排',content:'正式原稿',editedHtml:'<p>正式原稿</p>'+originalTable},chunks=[];
  const initial=await blockedResult(r.ctx.reportDurableSectionCall({name:'经营方案'},s,'s','首次生成'));
  const previous=s.pendingRevision,before=JSON.stringify(previous);
  const text=await r.ctx.reportDurableSectionCall({name:'经营方案'},s,'保留深度、层级和表格','用户确认修订：保留具体分析',value=>chunks.push(value),{candidateRepair:previous});
  assert.equal(r.tasks.size,2);assert.equal(r.requests.length,4);assert.equal(r.requests[2].payload.action,undefined,'人工完整返修不是隐式质量循环');
  assert.equal(s.pendingRevision,previous);assert.equal(JSON.stringify(previous),before);assert.equal(s.content,'正式原稿');assert.equal(s.editedHtml,'<p>正式原稿</p>'+originalTable);
  assert.equal(initial.candidateSaved,true);assert.ok(text.includes('保留具体分析后的完整返修结论。'));assert.ok(text.includes('条件未确认，不得实施。'));assert.ok(text.includes(originalTable));assert.deepEqual(chunks,[text]);
  assert.equal(s.completionContract,undefined);assert.equal(s.completionQuality,undefined,'未经接受不能把新质量回执写到正式正文');
  const generated=WF.generatedContract(s,text);assert.equal(generated.frozenTables.tables[0].html,originalTable);assert.equal(WF.generatedContract(s,'其他结果'),null);
  const candidate=retainReplacement(s,text,s.executionTask.quality,previous);assert.equal(candidate.history.length,1);assert.equal(candidate.history[0].after,previous.after);assert.equal(candidate.quality.status,'passed');assert.equal(s.content,'正式原稿');
  assert.deepEqual(candidate.completionContract,generated);assert.equal(candidate.completionInputPlanId,r.ctx.reportCandidateInputIdentity());
  assert.ok(WF.acceptCandidate(s));assert.equal(s.content,text);assert.equal(s.completionQuality.factsVerified,false);
});
function suspendedBinding(){
  let signal,release;const started=new Promise(resolve=>{signal=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  return {started,release:()=>release(),completion:{...C,async bindFrozenTables(...args){const bound=await C.bindFrozenTables(...args);signal();await gate;return bound;}}};
}
for(const [name,mutate] of [
  ['锁定',({s})=>{s.locked=true;}],
  ['正文',({s})=>{s.editedHtml='<p>准备期间人工修订</p>'+originalTable;}],
  ['候选',({s})=>{s.pendingRevision={id:'[系统测试]new',after:'新候选'};}],
  ['正式项目身份',({ctx})=>{ctx.currentProjectId='[系统测试]other';}],
  ['用户篇幅预算',({ctx})=>{ctx.projectWorkflow.reportCompletion={budgets:{[contract.sectionKey]:{proseTarget:1800,proseMax:2340}}};}]
])test('冻结表异步绑定期间'+name+'变更，在发起后台任务前拒绝',async()=>{
  const pause=suspendedBinding(),r=runtime('{}',{completion:pause.completion}),s={t:'合作安排',content:'原稿',editedHtml:originalTable},chunks=[];
  const pending=r.ctx.reportDurableSectionCall({name:'经营方案'},s,'s','u',text=>chunks.push(text));
  await pause.started;mutate({ctx:r.ctx,s});const after=JSON.stringify(s);pause.release();
  await assert.rejects(pending,/准备期间/);assert.equal(r.requests.length,0);assert.equal(r.tasks.size,0);assert.equal(JSON.stringify(s),after);assert.deepEqual(chunks,[]);
});

test('私人研究冻结表异步绑定后重新核对轮次，不借用空正式项目身份收取任务',async()=>{
  const pause=suspendedBinding(),r=runtime('{}',{completion:pause.completion}),s={t:'合作安排',editedHtml:originalTable};
  let activeRun='[系统测试]run-1';r.ctx.currentProjectId=null;
  r.ctx.ResearchUI={active:()=>true,flush:async()=>{},capture:()=>({researchId:'[系统测试]research',runId:activeRun}),accepts:token=>token.runId===activeRun,guard:async()=>{}};
  const pending=r.ctx.reportDurableSectionCall({name:'经营方案'},s,'s','u');await pause.started;activeRun='[系统测试]run-2';pause.release();
  await assert.rejects(pending,/准备期间/);assert.equal(r.requests.length,0);assert.equal(s.editedHtml,originalTable);assert.equal(s.completionContract,undefined);
});

for(const [name,mutate] of [
  ['锁定',({s})=>{s.locked=true;}],
  ['正文',({s})=>{s.editedHtml='<p>生成期间人工修订</p>'+originalTable;}],
  ['候选',({s})=>{s.pendingRevision={id:'[系统测试]new-result',before:s.content,after:'人工的新候选'};}],
  ['正式项目身份',({ctx})=>{ctx.currentProjectId='[系统测试]other-result';}],
  ['用户篇幅预算',({ctx})=>{ctx.projectWorkflow.reportCompletion={budgets:{[contract.sectionKey]:{proseTarget:2100,proseMax:2730}}};}]
])test('完整返修结果返回时'+name+'变更，拒绝晚到正文和候选写入',async()=>{
  let expected;
  const s={t:'合作安排',content:'正式原稿',editedHtml:originalTable,completionContract:contract};
  const r=runtime(snapshot=>JSON.stringify({blocks:[paragraph('finding','完整返修正文。'),{kind:'table-ref',id:snapshot.qualityContract.frozenTables.tables[0].id}]}),{beforeComplete:({ctx})=>{mutate({ctx,s});expected={content:s.content,editedHtml:s.editedHtml,locked:s.locked,pendingRevision:s.pendingRevision};}}),old=WF.setCandidate(s,'旧候选'+originalTable,'[系统测试]原候选'),chunks=[];
  await assert.rejects(r.ctx.reportDurableSectionCall({name:'经营方案'},s,'保留全文与表格','用户确认返修',text=>chunks.push(text),{candidateRepair:old}),/生成期间|已切换/);
  assert.equal(r.tasks.size,1);assert.equal(r.requests.length,2);assert.deepEqual(chunks,[]);
  assert.equal(s.content,expected.content);assert.equal(s.editedHtml,expected.editedHtml);assert.equal(s.locked,expected.locked);assert.equal(s.pendingRevision,expected.pendingRevision);
});

test('私人研究完整返修权限复核后再次核对轮次，结果不串写',async()=>{
  const r=runtime(JSON.stringify({blocks:[paragraph('finding','完整返修正文。')]})),s={t:'合作安排',content:'正式原稿',completionContract:contract},old=WF.setCandidate(s,'旧候选','[系统测试]原候选'),chunks=[];
  let activeRun='[系统测试]run-1';r.ctx.currentProjectId=null;
  r.ctx.ResearchUI={active:()=>true,flush:async()=>{},capture:()=>({researchId:'[系统测试]research',runId:activeRun}),accepts:token=>token.runId===activeRun,guard:async()=>{activeRun='[系统测试]run-2';}};
  await assert.rejects(r.ctx.reportDurableSectionCall({name:'经营方案'},s,'s','用户确认返修',text=>chunks.push(text),{candidateRepair:old}),/已切换项目或研究轮次/);
  assert.equal(r.tasks.size,1);assert.equal(r.requests.length,2);assert.equal(s.pendingRevision,old);assert.equal(s.content,'正式原稿');assert.deepEqual(chunks,[]);
});

test('工作稿原表绑定后传给后端，结构化引用解码到候选仍原样保留合并格与单元格格式',async()=>{
  const r=runtime(snapshot=>JSON.stringify({blocks:[paragraph('finding','按工作稿原表列示，待人工核实。'),{kind:'table-ref',id:snapshot.qualityContract.frozenTables.tables[0].id}]}));
  const s={t:'合作安排',content:'原稿',editedHtml:'<p>工作稿</p>'+originalTable},chunks=[];
  const text=await r.ctx.reportDurableSectionCall({name:'经营方案'},s,'s','u',value=>chunks.push(value));
  const submitted=r.requests[0].payload;assert.equal(submitted.sourceHtml,s.editedHtml);assert.equal(submitted.sourceSnapshotId,'[系统测试]project:'+contract.sectionKey);
  assert.equal(submitted.qualityContract.frozenTables.tables[0].html,originalTable);assert.ok(text.includes(originalTable));assert.deepEqual(chunks,[text]);
  assert.equal(s.editedHtml,'<p>工作稿</p>'+originalTable);assert.equal(s.completionContract,undefined);assert.equal(s.completionQuality,undefined,'生成回执不能提前改变正式正文');
  assert.equal(s.executionTask.quality.status,'passed');assert.equal(s.executionTask.quality.factsVerified,false);assert.deepEqual(WF.generatedContract(s,text),submitted.qualityContract);
  const candidate=WF.setCandidate(s,text,'[系统测试]明确候选');assert.equal(candidate.quality.status,'passed');assert.ok(candidate.after.includes(originalTable));
  assert.deepEqual(candidate.completionContract,submitted.qualityContract);assert.equal(candidate.completionInputPlanId,r.ctx.reportCandidateInputIdentity());
  assert.ok(WF.acceptCandidate(s));assert.ok(s.content.includes(originalTable));assert.equal(s.completionQuality.factsVerified,false);
});
