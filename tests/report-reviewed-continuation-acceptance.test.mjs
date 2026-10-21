import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);require('../scripts/windows-browser-lockout-guard.cjs');
const {bindReviewedSections,reserveSampleExecution,scopedPaginationRoute,verifySampleAcceptance,continuationExitCode,continuationAuthPreflight,loadContinuationOrigin,proveZeroPostRecovery,validateContinuationResume,scopedContinuationPaidRoute,bindLoadedRuleSupplement,validateLoadedRuleSupplement,encodeIdentityPayload,decodeIdentityPayload,loadedRulePayload,proveExpiredZeroDispatch,bindSampleReauthorization,validateSampleReauthorization,resolveSampleReauthorization,verifyReauthorizedStart}=await import('../scripts/report-reviewed-continuation-acceptance.mjs');
const {fingerprint}=require('../report-completion-contract.js');
const hash=x=>crypto.createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const copy=x=>JSON.parse(JSON.stringify(x));
const PROJECT='2884b7a3-960f-40c0-af89-5d19e0284836';
const {persistContinuationAudit}=await import('../scripts/report-reviewed-continuation-acceptance.mjs');
const {bindSlimStartRecovery,restoreSlimStartMetadata}=await import('../scripts/report-reviewed-continuation-acceptance.mjs');
const {proveRetainedNoop,bindRetainedNoopReauthorization,restoreRetainedNoopTask,resolveRetainedNoopStart,retainedNoopStartedReceipt}=await import('../scripts/report-reviewed-continuation-acceptance.mjs');

// Exact old GET evidence is replayed offline. Terminal mutations below are
// fixture-only, never a receipt authorizing execution or replacing production
// recovery. In particular, the real old run has a completed pagination permit.
const retainedEvidencePromise=(async()=>{
  const out=path.resolve('outputs/report-standardization/1010-full-generation-2026-10-10T02-04-51-303Z-3378c9e5/generation-runner');
  const folder=path.join(out,'lg-production-continuation-2026-10-13T07-07-03-571Z-d408807b'),get=path.join(folder,'resume-2026-10-13T09-33-38-959Z-9e253750');
  const read=async name=>JSON.parse(await fs.readFile(name,'utf8'));
  const original=await loadContinuationOrigin(out,folder),supp=await read(path.join(folder,'hydration-supplement.json'));
  const hydrated=validateLoadedRuleSupplement(original,supp,supp.payloadEnvelope),origin=await validateSampleReauthorization(hydrated,await read(path.join(folder,'sample-reauthorization.json')));
  return {hydrated,origin,get,live:await read(path.join(get,'browser-after.json')),remote:await read(path.join(get,'remote-after.json')),recovery:await read(path.join(get,'slim-start-recovery-proof.json'))};
})();
const retainedSaved=x=>x.workflow.reportCompletion.initialDelivery;
const retainedDraft=x=>x.project.data.draft||x.project.data;
const retainedSection=(x,key)=>x.chapters.flatMap(c=>c.sections.map(s=>({key:c.name+' / '+s.t,s}))).find(r=>r.key===key).s;
async function retainedTerminalFixture(){
  const e=await retainedEvidencePromise,l=copy(e.live),r=copy(e.remote),p=retainedSaved(l).run.permits.find(p=>p.kind==='length-converge');
  p.status='completed';p.outcome='no-effective-reduction';
  retainedSaved(l).bindings[e.origin.sampleKey].convergenceResponse.effectiveness={version:'initial-convergence-effectiveness-v1',effective:false,sourceHash:e.recovery.sourceSha256,textHash:e.recovery.responseSha256};
  retainedDraft(r).workflow=copy(l.workflow);
  const proof=proveRetainedNoop(e.origin,l,r,e.recovery,{now:e.recovery.deadline+3600000});
  proof.evidence=[{file:path.join(e.get,'slim-start-recovery-proof.json'),sha256:hash(e.recovery)}];
  const confirmation={version:'sample-retained-noop-reauthorization-v1',authorized:true,projectId:PROJECT,priorRunId:proof.priorRunId,sectionNumber:'6.3',sectionKey:e.origin.sampleKey,maxElapsedMs:1800000,maxConvergenceCalls:1,maxReviewCalls:1,confirmationId:'OFFLINE-FIXTURE-NOT-HUMAN-AUTHORIZATION',confirmedAt:new Date(e.recovery.deadline+1).toISOString(),userConfirmation:'OFFLINE FIXTURE ONLY',recoveryFolder:e.get};
  return {...e,l,r,proof,confirmation,receipt:bindRetainedNoopReauthorization(e.hydrated,e.origin,proof,confirmation)};
}

test('retained no-op real old GET has two permits and preserves old paid one separately',async()=>{
  const e=await retainedEvidencePromise,now=e.recovery.deadline+3600000;
  assert.equal(retainedSaved(e.live).run.permits.length,2);
  const p=proveRetainedNoop(e.origin,e.live,e.remote,e.recovery,{terminal:false,now});
  assert.equal(p.oldPaidRequests,1);assert.equal(p.preparationPaidRequests,0);
  assert.throws(()=>proveRetainedNoop(e.origin,e.live,e.remote,e.recovery,{now}),/terminal/);
});
test('retained no-op rejects changed paid count, task, response and unrelated pending permit',async()=>{
  const e=await retainedEvidencePromise;
  for(const mutate of [l=>retainedSaved(l).run.additionalCalls=0,l=>retainedSection(l,e.origin.sampleKey).executionTask.id='other-task',l=>retainedSaved(l).bindings[e.origin.sampleKey].convergenceResponse.text+='changed',l=>retainedSaved(l).run.permits.push({kind:'length-converge',key:'other',status:'uncertain'})]){
    const l=copy(e.live),r=copy(e.remote);mutate(l);retainedDraft(r).chapters=copy(l.chapters);retainedDraft(r).workflow=copy(l.workflow);
    assert.throws(()=>proveRetainedNoop(e.origin,l,r,e.recovery,{terminal:false,now:e.recovery.deadline+3600000}));
  }
});
test('retained no-op new receipt has one execution, full29 budget pool and a distinct confirmation',async()=>{
  const f=await retainedTerminalFixture();
  assert.equal(f.receipt.input.sections.filter(s=>s.allowConverge).length,1);
  assert.equal(f.receipt.input.sections.filter(s=>s.allowBudgetAllocation).length,29);
  for(const key of ['maxElapsedMs','maxConvergenceCalls','maxReviewCalls'])assert.throws(()=>bindRetainedNoopReauthorization(f.hydrated,f.origin,f.proof,{...f.confirmation,[key]:9999999}));
  for(const id of [f.hydrated.input.authorization.confirmationId,f.origin.input.authorization.confirmationId])assert.throws(()=>bindRetainedNoopReauthorization(f.hydrated,f.origin,f.proof,{...f.confirmation,confirmationId:id}));
  assert.throws(()=>bindRetainedNoopReauthorization(f.hydrated,f.origin,{...f.proof,oldPaidRequests:0},f.confirmation));
});
test('retained no-op task CAS rejects concurrent task/lock/workflow and nonempty failures before save',async()=>{
  for(const mutate of [r=>retainedSection(retainedDraft(r),'改造运营方案 / 运营方案').executionTask.id='other-task',r=>retainedSection(retainedDraft(r),'改造运营方案 / 运营方案').locked=true,r=>retainedDraft(r).workflow.otherMetadata='concurrent',r=>retainedDraft(r).chapters[0].sections[0].generationFailure={code:'real-error'},r=>retainedDraft(r).chapters[0].sections[0].candidateGenerationFailure={message:'real-error'}]){
    const f=await retainedTerminalFixture();mutate(f.r);let commits=0;
    await assert.rejects(restoreRetainedNoopTask({live:f.l,proof:f.proof,readState:async()=>copy(f.l),readRemote:async()=>copy(f.r),commit:async()=>{commits++;return {remote:true};}}));assert.equal(commits,0);
  }
});
test('retained no-op task CAS accepts only serialized null failure difference and restores original null task',async()=>{
  const f=await retainedTerminalFixture(),before=copy(f.l);let state=copy(f.l),remote=copy(f.r),commits=0;
  const result=await restoreRetainedNoopTask({live:f.l,proof:f.proof,readState:async()=>copy(state),readRemote:async()=>copy(remote),commit:async()=>{commits++;retainedSection(state,f.origin.sampleKey).executionTask=null;retainedDraft(remote).chapters=copy(state.chapters);for(const c of retainedDraft(remote).chapters)for(const s of c.sections){s.generationFailure??=null;s.candidateGenerationFailure??=null;}return {remote:true};}});
  assert.equal(commits,1);assert.equal(result.bodyUnchanged,true);assert.deepEqual(retainedSaved(state),retainedSaved(before));retainedSection(before,f.origin.sampleKey).executionTask=null;assert.deepEqual(state,before);
});
test('retained no-op permanent start identity prevents repeated start and clock/run/history replacement',async()=>{
  const f=await retainedTerminalFixture();assert.deepEqual(resolveRetainedNoopStart(f.receipt,f.l),{newRun:true,runId:null});
  assert.throws(()=>resolveRetainedNoopStart(f.receipt,f.l,{startIntentExists:true}));
  const n=copy(f.l),old=copy(retainedSaved(n).run);
  retainedSaved(n).history=[...(retainedSaved(n).history||[]),{run:old}];retainedSaved(n).run={...old,runId:'OFFLINE-new-run',startedAt:f.recovery.deadline+3601000,additionalCalls:0,permits:[],authorizationToken:'reviewed|'+f.receipt.requestHash};retainedSaved(n).continuation={...retainedSaved(n).continuation,requestHash:f.receipt.requestHash};
  const receipt=retainedNoopStartedReceipt(f.receipt,n);
  assert.deepEqual(resolveRetainedNoopStart(f.receipt,n,{startIntentExists:true,startedReceipt:receipt}),{newRun:false,runId:'OFFLINE-new-run'});
  assert.equal(resolveRetainedNoopStart(f.receipt,n,{startIntentExists:true}).newRun,false);
  for(const mutate of [x=>retainedSaved(x).run.startedAt++,x=>retainedSaved(x).run.runId+='changed',x=>retainedSaved(x).history=[]]){const changed=copy(n);mutate(changed);assert.throws(()=>resolveRetainedNoopStart(f.receipt,changed,{startIntentExists:true,startedReceipt:receipt}));}
});

function slimRecoveryFixture(){
  const key='改造运营方案 / 运营方案',body='<h3>运营主体</h3><p>原文与待核验内容保留。</p>',identity={projectId:PROJECT,research:null,input:'candidate-input-v1:bound'},plan={planId:'confirmed-length',proseTotal:84500},userId=123;
  const input={authorization:{identity,planId:plan.planId,confirmationId:'one-section-authorized'},sections:[{key,allowConverge:true}]};
  const p={id:'permit-sample',key,kind:'length-converge',status:'uncertain',runId:'original-run',planId:plan.planId,identity,idempotencyKey:'original-run:sample',batchId:'same-batch',referenceBudget:{target:1400,referenceOnly:true},expectedBodyHash:hash({content:body,editedHtml:null})};
  const run={runId:p.runId,mode:'reviewed-existing-length-convergence',authorizationToken:'reviewed|'+hash(input),startedAt:1000,limits:{maxAdditionalCalls:1,maxElapsedMs:1800000},sections:[{key,eligible:true}],permits:[p]};
  const binding={expectedBody:{content:body,editedHtml:null},provisional:null,lastCompletedPermitId:null};
  const live={projectId:PROJECT,chapters:[{name:'改造运营方案',sections:[{t:'运营方案',numeric:false,content:body,editedHtml:null}]}],workflow:{reportCompletion:{initialDelivery:{run,bindings:{[key]:binding},continuation:{requestHash:hash(input)}}}},plan,identity,plannerReady:true,workflowReady:true};
  const allocation={sectionKey:key,planId:'section-contract',sourceHash:hash(body),permitId:p.id,idempotencyKey:p.idempotencyKey,batchId:p.batchId,referenceBudget:p.referenceBudget};
  const snapshot={sectionKey:key,initialLengthSource:body,qualityContract:{planId:'section-contract',sectionKey:key,initialLengthConvergence:allocation},user:JSON.stringify({sectionKey:key,source:body,permitId:p.id,idempotencyKey:p.idempotencyKey,batchId:p.batchId,referenceBudget:p.referenceBudget})};
  const inputHash=hash(snapshot),id='rsec_'+hash([userId,PROJECT,inputHash]);p.taskId=id;
  const task={id,runId:'backend-original',status:'completed',rulesChanged:false,text:'<h3>运营主体</h3><p>新文与待核验内容保留。</p>',graph:[{key:'context_snapshot',hash:inputHash}]};
  const row={id,project_id:PROJECT,user_id:userId,section_key:key,run_id:task.runId,input_hash:inputHash,input_json:JSON.stringify(snapshot)};
  const intent={projectId:PROJECT,runId:run.runId,confirmationId:input.authorization.confirmationId,requestHash:hash(input),sectionKey:key,kind:'converge',permitId:p.id,requestSha256:hash('POST-original'),at:'2026-10-13T09:12:58.157Z'};
  const receipt={...intent,status:200,responseSha256:hash('original response bytes'),data:{ok:true,task:{id,reused:false,runId:task.runId}}};
  return {input,live,intent,receipt,row,task,userId};
}
const slimRun=f=>f.live.workflow.reportCompletion.initialDelivery.run;
const slimRemote=live=>({project:{id:PROJECT,data:{draft:copy(live)}}});

test('GET recovery joins only exact original slim receipt, DB snapshot and completed task without adopting or renewing',()=>{
  const f=slimRecoveryFixture(),before=copy(f),proof=bindSlimStartRecovery(f);
  assert.deepEqual(f,before);assert.deepEqual(Object.keys(proof.fields),['backendRunId','inputHash','recoveryContext']);
  assert.equal(proof.fields.backendRunId,f.task.runId);assert.equal(proof.fields.inputHash,f.row.input_hash);
  assert.equal(proof.fields.recoveryContext.initialDraftSource,f.live.chapters[0].sections[0].content);
  assert.equal(proof.deadline,1801000);assert.equal(proof.paidRequests,0);assert.equal(proof.adopted,false);assert.equal(proof.reviewed,false);
  Object.assign(slimRun(f).permits[0],proof.fields);assert.doesNotThrow(()=>bindSlimStartRecovery(f));
});

test('GET recovery refuses mismatched authorization, source, plan, task and unknown results',()=>{
  const changes=[f=>f.live.projectId='formal-source',f=>f.live.identity.research='other',f=>f.input.authorization.confirmationId='new',f=>f.live.plan.planId='other',f=>slimRun(f).limits.maxAdditionalCalls=2,f=>slimRun(f).sections.push({key:'other',eligible:true}),f=>slimRun(f).permits.push(copy(slimRun(f).permits[0])),f=>slimRun(f).permits[0].status='completed',f=>slimRun(f).permits[0].taskId='other',f=>slimRun(f).permits[0].runId='other',f=>slimRun(f).permits[0].identity={...f.live.identity,input:'other'},f=>f.live.chapters[0].sections[0].content+='changed',f=>f.live.chapters[0].sections[0].locked=true,f=>f.live.chapters[0].sections[0].pendingRevision={},f=>f.row.project_id='other',f=>f.row.user_id=444,f=>f.row.section_key='other',f=>f.row.run_id='other',f=>f.row.input_hash='a'.repeat(64),f=>f.task.runId='other',f=>f.task.status='queued',f=>f.task.rulesChanged=true,f=>f.task.text='',f=>f.task.graph=[],f=>f.receipt.data.task.reused=true,f=>f.receipt.status=500,f=>f.receipt.requestHash='other',f=>f.intent.kind='review',f=>f.userId=987];
  for(const change of changes){const f=slimRecoveryFixture();change(f);assert.throws(()=>bindSlimStartRecovery(f));}
});

function rehashSlimSnapshot(f,mutate){
  const snapshot=JSON.parse(f.row.input_json);mutate(snapshot);f.row.input_json=JSON.stringify(snapshot);
  f.row.input_hash=hash(snapshot);f.task.graph[0].hash=f.row.input_hash;
  const id='rsec_'+hash([f.userId,PROJECT,f.row.input_hash]);f.row.id=id;f.task.id=id;f.receipt.data.task.id=id;slimRun(f).permits[0].taskId=id;
}
test('even a self-consistent task hash cannot substitute another source, permit, request, budget or financial contract',()=>{
  const changes=[s=>s.initialLengthSource+='other',s=>s.sectionKey='other',s=>s.research={id:'other'},s=>s.qualityContract.sectionKey='other',s=>s.qualityContract.initialLengthConvergence.sourceHash='a'.repeat(64),s=>s.qualityContract.initialLengthConvergence.permitId='other',s=>s.qualityContract.initialLengthConvergence.idempotencyKey='other',s=>s.qualityContract.initialLengthConvergence.batchId='other',s=>s.qualityContract.initialLengthConvergence.referenceBudget={target:1},s=>s.qualityContract.planId='other',s=>s.qualityContract.frozenTables=[],s=>s.qualityContract.documentReferences={},s=>{const r=JSON.parse(s.user);r.source+='other';s.user=JSON.stringify(r);},s=>{const r=JSON.parse(s.user);r.permitId='other';s.user=JSON.stringify(r);}];
  for(const change of changes){const f=slimRecoveryFixture();rehashSlimSnapshot(f,change);assert.throws(()=>bindSlimStartRecovery(f));}
});
test('GET recovery never overwrites conflicting existing task metadata or a reviewed result',()=>{
  for(const change of [f=>slimRun(f).permits[0].backendRunId='different',f=>slimRun(f).permits[0].inputHash='different',f=>slimRun(f).permits[0].recoveryContext={},f=>f.live.chapters[0].sections[0].executionTask={id:'other'},f=>f.live.workflow.reportCompletion.initialDelivery.bindings['改造运营方案 / 运营方案'].convergenceReview={},f=>f.live.workflow.reportCompletion.initialDelivery.bindings['改造运营方案 / 运营方案'].convergenceResponse={text:f.task.text,validated:true}]){const f=slimRecoveryFixture();change(f);assert.throws(()=>bindSlimStartRecovery(f));}
});
test('metadata restore uses exact browser/remote CAS, confirms readback, and leaves body, permit status and expired deadline unchanged',async()=>{
  const f=slimRecoveryFixture(),proof=bindSlimStartRecovery(f),before=copy(f.live);let current=copy(f.live),commits=0;
  const result=await restoreSlimStartMetadata({live:f.live,proof,readState:async()=>copy(current),readRemote:async()=>slimRemote(current),commit:async(expected,p)=>{assert.deepEqual(expected,before);commits++;Object.assign(current.workflow.reportCompletion.initialDelivery.run.permits[0],p.fields);return {remote:true};}});
  assert.equal(commits,1);assert.equal(result.remoteSaved,true);assert.equal(result.bodyUnchanged,true);assert.equal(result.deadlineUnchanged,true);
  assert.deepEqual(current.chapters,before.chapters);assert.deepEqual(current.plan,before.plan);assert.equal(current.workflow.reportCompletion.initialDelivery.run.permits[0].status,'uncertain');
});
test('metadata recovery does not save when browser or remote changed before the write',async()=>{
  for(const mode of ['browser','remote-body','remote-permit','remote-project']){
    const f=slimRecoveryFixture(),proof=bindSlimStartRecovery(f);let commits=0;
    const state=copy(f.live),remote=slimRemote(f.live);if(mode==='browser')state.plan.planId='changed';if(mode==='remote-body')remote.project.data.draft.chapters[0].sections[0].content+='changed';if(mode==='remote-permit')remote.project.data.draft.workflow.reportCompletion.initialDelivery.run.permits[0].taskId='different';if(mode==='remote-project')remote.project.id='formal';
    await assert.rejects(restoreSlimStartMetadata({live:f.live,proof,readState:async()=>state,readRemote:async()=>remote,commit:async()=>{commits++;return {remote:true};}}));assert.equal(commits,0);
  }
});
test('metadata recovery rejects unconfirmed save, unrelated writes and changed remote readback',async()=>{
  for(const mode of ['unconfirmed','body','deadline','permit-status','remote']){
    const f=slimRecoveryFixture(),proof=bindSlimStartRecovery(f);let current=copy(f.live),committed=false;
    await assert.rejects(restoreSlimStartMetadata({live:f.live,proof,readState:async()=>copy(current),readRemote:async()=>{const r=slimRemote(current);if(committed&&mode==='remote')r.project.data.draft.chapters[0].sections[0].content+='changed';return r;},commit:async(_,p)=>{committed=true;Object.assign(current.workflow.reportCompletion.initialDelivery.run.permits[0],p.fields);if(mode==='body')current.chapters[0].sections[0].content+='changed';if(mode==='deadline')current.workflow.reportCompletion.initialDelivery.run.startedAt++;if(mode==='permit-status')current.workflow.reportCompletion.initialDelivery.run.permits[0].status='reserved';return {remote:mode!=='unconfirmed'};}}));
  }
});

test('source verification failure still saves an honest audit and releases only its owned temporary lock',async t=>{
  const folder=await temp(t),lock=path.join(folder,'temporary-lock.json'),audit={error:'startup failed'},runId='one';
  await fs.writeFile(lock,JSON.stringify({runId,pid:process.pid}));
  await persistContinuationAudit({audit,folder,lock,runId,ownsLock:true,snapshot:{sources:{longgang:{sourceIdentity:'source'}}},checkSource:async()=>{throw Error('database unavailable');}});
  const saved=JSON.parse(await fs.readFile(path.join(folder,'audit.json'),'utf8'));
  assert.equal(saved.sourceUnchangedAfter.longgang,null);assert.equal(saved.sourceCheckErrors.longgang,'database unavailable');assert.equal(continuationExitCode(saved),1);
  await assert.rejects(fs.access(lock),{code:'ENOENT'});
});

test('audit overwrite refusal preserves original evidence and releases own lock, never another owner',async t=>{
  const folder=await temp(t),lock=path.join(folder,'temporary-lock.json'),runId='one';
  await fs.writeFile(path.join(folder,'audit.json'),'original');
  for(const pid of [process.pid,process.pid+1]){
    await fs.writeFile(lock,JSON.stringify({runId,pid}));
    await assert.rejects(persistContinuationAudit({audit:{},folder,lock,runId,ownsLock:true}),{code:'EEXIST'});
    assert.equal(await fs.readFile(path.join(folder,'audit.json'),'utf8'),'original');
    if(pid===process.pid)await assert.rejects(fs.access(lock),{code:'ENOENT'});else assert.equal(JSON.parse(await fs.readFile(lock,'utf8')).pid,pid);
  }
});
function fixture(){
  const chapters=[{name:'项目',sections:Array.from({length:34},(_,i)=>({t:'小节'+i,content:'<h3>分类</h3><p>已核对正文 '+i+'</p>'}))}];
  const rows=chapters[0].sections.map((s,i)=>({number:'1.'+(i+1),projectId:'2884b7a3-960f-40c0-af89-5d19e0284836',fullBodyRead:true,fullSourcesRead:true,exactActualMatch:true,semanticStatus:'acceptable-full-body-at-bound-sha',semanticPassed:true,unresolvedContentIssues:[],bodySha256:hash(s.content),actualBodySha256:hash(s.content),fullActualHtml:s.content}));
  return {chapters,sets:[{file:'review.json',sha256:'a'.repeat(64),data:{createdAtUtc:'2026-10-13T00:00:00.000Z',reviewer:'independent-reviewer',rows}}]};
}
test('binds every actual reviewed body without inventing a backend origin task',()=>{const f=fixture(),r=bindReviewedSections(f.chapters,f.sets);assert.equal(r.length,34);assert.equal(r[0].allowConverge,false);assert.equal(r[1].allowConverge,true);assert.equal(r[1].originalTask,null);assert.equal(r[1].bodyHash,hash({content:f.chapters[0].sections[1].content,editedHtml:null}));});
test('stale review or different editable body is refused',()=>{const f=fixture();f.chapters[0].sections[2].editedHtml='<p>changed</p>';assert.throws(()=>bindReviewedSections(f.chapters,f.sets),/does not bind 1.3/);});
test('missing full review, findings, pending candidate and lock are not bypassed',()=>{for(const change of [f=>f.sets[0].data.rows[3].fullBodyRead=false,f=>f.sets[0].data.rows[3].unresolvedContentIssues=['omission'],f=>f.chapters[0].sections[3].pendingRevision={after:'candidate'},f=>f.chapters[0].sections[3].locked=true]){const f=fixture();change(f);assert.throws(()=>bindReviewedSections(f.chapters,f.sets));}});
test('original task exact immutable identity is kept or rejected when incomplete',()=>{const f=fixture(),s=f.chapters[0].sections[5];s.executionTask={id:'task',runId:'run',status:'completed',graph:[{key:'context_snapshot',hash:'b'.repeat(64)}]};assert.deepEqual(bindReviewedSections(f.chapters,f.sets)[5].originalTask,{id:'task',runId:'run',inputHash:'b'.repeat(64)});s.executionTask.status='dead';assert.throws(()=>bindReviewedSections(f.chapters,f.sets),/Incomplete original task/);});
test('does not allow a partial reviewed-detail set to stand for all 34 details',()=>{const f=fixture();f.chapters[0].sections.pop();assert.throws(()=>bindReviewedSections(f.chapters,f.sets),/exactly the 34/);});

async function temp(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'reviewed-continuation-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
const reservation=()=>({projectId:PROJECT,number:'6.3',runId:'attempt-a'});
test('prepare-only history permits one atomic execution; restart cannot make a new authorization',async t=>{
  const dir=await temp(t),prior=path.join(dir,'lg-production-continuation-prepared');await fs.mkdir(prior);
  await fs.writeFile(path.join(prior,'audit.json'),JSON.stringify({execute:false,paidIntents:[],unknownRequests:[]}));
  await fs.writeFile(path.join(prior,'continuation-input.json'),'old prepare authorization');
  const first=await reserveSampleExecution(dir,reservation()),bytes=await fs.readFile(first.file,'utf8');
  await assert.rejects(reserveSampleExecution(dir,{...reservation(),runId:'new-authorization'}),/execution record already exists/);
  assert.equal(await fs.readFile(first.file,'utf8'),bytes);assert.equal(await fs.readFile(path.join(prior,'continuation-input.json'),'utf8'),'old prepare authorization');
});
test('historical started, intent, response, result or uncertain audit blocks fresh paid execution',async t=>{
  for(const name of ['started.json','converge-intent.json','converge-response.json','review-intent.json','review-response.json','result.json','audit.json']){
    const dir=await temp(t),prior=path.join(dir,'lg-production-continuation-original');await fs.mkdir(prior);
    await fs.writeFile(path.join(prior,name),JSON.stringify(name==='audit.json'?{execute:true,unknownRequests:[{kind:'converge'}]}:{taskId:'original-task'}));
    await assert.rejects(reserveSampleExecution(dir,reservation()),/prior execution/);
    assert.equal((await fs.readdir(dir)).length,1);
  }
});
test('unreadable audit, missing audit execute flag and wrong project/section fail closed',async t=>{
  for(const audit of ['broken JSON','{}',JSON.stringify({execute:false,paidIntents:[{}]})]){
    const dir=await temp(t),prior=path.join(dir,'lg-production-continuation-old');await fs.mkdir(prior);await fs.writeFile(path.join(prior,'audit.json'),audit);
    await assert.rejects(reserveSampleExecution(dir,reservation()));
  }
  const dir=await temp(t);for(const record of [{...reservation(),projectId:'source-project'},{...reservation(),number:'6.2'},{...reservation(),runId:''}])await assert.rejects(reserveSampleExecution(dir,record),/Invalid scoped/);
  assert.deepEqual(await fs.readdir(dir),[]);
});
test('concurrent process reservations cannot both win',async t=>{
  const dir=await temp(t),outcomes=await Promise.allSettled([reserveSampleExecution(dir,reservation()),reserveSampleExecution(dir,{...reservation(),runId:'attempt-b'})]);
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(outcomes.filter(r=>r.status==='rejected').length,1);
});

function paginationFixture(){
  const origin='http://127.0.0.1:8080',planId='confirmed-original',runId='continuation-run';
  const state={projectId:PROJECT,planId,run:{runId,identity:{projectId:PROJECT},plan:{planId},mode:'reviewed-existing-length-convergence',permits:[{id:'pages-permit',kind:'paginate-details',status:'reserved',runId,planId,identity:{projectId:PROJECT}}]}};
  const frame={},payload=Buffer.from([0x50,0x4b,0x03,0x04,1,2,3]),options={url:origin+'/api/report-pagination',method:'POST',mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',payload,frame};
  const receipts=[],calls=[];
  const route=()=>({request:()=>({url:()=>options.url,method:()=>options.method,headers:()=>({'content-type':options.mime}),postDataBuffer:()=>options.payload,frame:()=>options.frame}),fallback:async()=>calls.push('base-harness'),continue:async()=>calls.push('continued'),fulfill:async response=>calls.push(response.status)});
  const config={origin,planId,runId:()=>runId,readState:async()=>state,fromPage:request=>request.frame()===frame,record:async receipt=>receipts.push(receipt)};
  return {state,options,receipts,calls,config,route};
}
test('only the live QA detail-pagination permit bypasses the base allowAi:false write filter',async()=>{
  const f=paginationFixture(),handler=scopedPaginationRoute(f.config);await handler(f.route());
  assert.deepEqual(f.calls,['continued']);assert.equal(f.receipts.length,1);assert.equal(f.receipts[0].projectId,PROJECT);assert.equal(f.receipts[0].permitId,'pages-permit');
  assert.equal(f.receipts[0].documentSha256,crypto.createHash('sha256').update(f.options.payload).digest('hex'));
  await handler(f.route());assert.deepEqual(f.calls,['continued',403]);assert.equal(f.receipts.length,1);
});
test('all other API endpoints retain the original write guard',async()=>{
  for(const endpoint of ['/api/projects','/api/reportexecution','/api/report-pagination-elsewhere','/api/aireport']){
    const f=paginationFixture();f.options.url=f.config.origin+endpoint;await scopedPaginationRoute(f.config)(f.route());assert.deepEqual(f.calls,['base-harness']);assert.equal(f.receipts.length,0);
  }
});
test('pagination wrong origin, method, query, MIME, frame and non-Word bytes cannot escape the guard',async()=>{
  for(const change of [f=>f.options.url='http://other.example/api/report-pagination',f=>f.options.url+='?projectId='+PROJECT,f=>f.options.method='GET',f=>f.options.mime='application/json',f=>f.options.frame={},f=>f.options.payload=Buffer.from('not docx'),f=>f.options.payload=null,f=>f.options.payload=Buffer.from([0x50])]){
    const f=paginationFixture();change(f);await scopedPaginationRoute(f.config)(f.route());assert.deepEqual(f.calls,[403]);assert.equal(f.receipts.length,0);
  }
});
test('pagination requires exact project, original plan, continuation run and a unique reserved detail permit',async()=>{
  const changes=[f=>f.state.projectId='original-source',f=>f.state.planId='changed-plan',f=>f.state.run.runId='old-run',f=>f.state.run.identity.projectId='other',f=>f.state.run.plan.planId='changed',f=>f.state.run.mode='initial',f=>f.state.run.permits=[],f=>f.state.run.permits.push(copy(f.state.run.permits[0])),f=>f.state.run.permits[0].status='completed',f=>f.state.run.permits[0].kind='paginate',f=>f.state.run.permits[0].planId='changed',f=>f.state.run.permits[0].runId='changed',f=>f.state.run.permits[0].identity.projectId='other',f=>f.state.run.permits[0].id=''];
  for(const change of changes){const f=paginationFixture();change(f);await scopedPaginationRoute(f.config)(f.route());assert.deepEqual(f.calls,[403]);assert.equal(f.receipts.length,0);}
});
test('pagination state or durable intent failure stops before the network is released',async()=>{
  for(const field of ['readState','record']){const f=paginationFixture();f.config[field]=async()=>{throw Error('unavailable');};const handler=scopedPaginationRoute(f.config);await handler(f.route());assert.deepEqual(f.calls,[403]);}
});

function acceptedFixture(){
  const selectedKey='六、运营方案 / 运营管理',source='<h3>一、运营安排</h3><p>保留全部事实、条件与分析，以及同段重复表述。</p>',text='<h3>一、运营安排</h3><p>保留全部事实、条件与分析。</p>';
  const original={t:'运营管理',content:source},actual={t:'运营管理',content:text,executionTask:{id:'generation-task'}};
  const before={projectId:PROJECT,plan:{planId:'confirmed-original'},chapters:[{name:'六、运营方案',sections:[original]}]};
  const permit={id:'selected-permit',kind:'length-converge',key:selectedKey,status:'completed',taskId:'generation-task',backendRunId:'generation-run',inputHash:hash('generation-input')};
  const task={taskId:'review-task',backendRunId:'review-run',inputHash:hash('review-input'),status:'completed'};
  const review={version:'initial-length-preservation-v1',sectionKey:selectedKey,sourceHash:hash(source),textHash:hash(text),passed:true,factsPreserved:true,conditionsPreserved:true,analysisPreserved:true,factsVerified:false,findings:[]};
  const raw=JSON.stringify(review),returnedReview={...review,reviewTask:task,reviewResponseHash:hash(raw)};
  const state={version:'initial-length-review-state-v1',binding:{permitId:permit.id,projectId:PROJECT,sectionKey:selectedKey,sourceHash:hash(source),textHash:hash(text)},source,text,status:'passed',task:copy(task),rawResponse:raw,responseText:raw,result:copy(review)};
  const body={content:text,editedHtml:null};
  const run={runId:'continuation-run',mode:'reviewed-existing-length-convergence',plan:copy(before.plan),permits:[permit],sections:[{key:selectedKey,bodyHash:hash(body)}]};
  const binding={expectedBody:body,lastCompletedPermitId:permit.id,provisional:null,convergenceResponse:{permitId:permit.id,text,hash:hash(text),validated:true,review:returnedReview},convergenceReview:{permitId:permit.id,sourceHash:hash(source),textHash:hash(text),state}};
  const after={projectId:PROJECT,chapters:[{name:'六、运营方案',sections:[actual]}],workflow:{reportCompletion:{initialDelivery:{run,bindings:{[selectedKey]:binding}}}}};
  return {selectedKey,before,after,remote:{project:{id:PROJECT,data:copy(after)}},started:{run:{runId:run.runId}},result:{status:'paused',reason:'dispatch-limit-reached',complete:false,run:copy(run)}};
}
const bindingOf=f=>f.after.workflow.reportCompletion.initialDelivery.bindings[f.selectedKey];
test('accepted single sample remains an incomplete paused report, and exits zero only on independent sampleAccepted',()=>{
  const f=acceptedFixture(),original=copy(f.result),result=verifySampleAcceptance(f);assert.deepEqual(result.issues,[]);assert.equal(result.sampleAccepted,true);assert.equal(result.overallComplete,false);assert.equal(result.overallStatus,'paused');assert.deepEqual(f.result,original);
  assert.equal(continuationExitCode({execute:true,result:f.result,sampleAcceptance:result,sourceUnchangedAfter:{tax:true,longgang:true}}),0);
  f.remote.project.data={draft:f.remote.project.data};assert.equal(verifySampleAcceptance(f).sampleAccepted,true);
});
test('missing, reserved, wrong-task or unsaved selected permit never counts as sample completion',()=>{
  for(const change of [f=>f.after.workflow.reportCompletion.initialDelivery.run.permits=[],f=>f.after.workflow.reportCompletion.initialDelivery.run.permits[0].status='reserved',f=>f.after.workflow.reportCompletion.initialDelivery.run.permits[0].inputHash='',f=>bindingOf(f).lastCompletedPermitId='other',f=>f.result.run.permits[0].taskId='other',f=>f.result.reason='content-or-task-not-admitted',f=>f.result.status='failed']){
    const f=acceptedFixture();change(f);assert.equal(verifySampleAcceptance(f).sampleAccepted,false);
  }
});
test('unreviewed or mismatched source, response and independent task cannot count as accepted',()=>{
  const changes=[b=>b.convergenceResponse.validated=false,b=>b.convergenceResponse.review.passed=false,b=>b.convergenceResponse.review.conditionsPreserved=false,b=>b.convergenceResponse.review.factsPreserved=false,b=>b.convergenceResponse.review.analysisPreserved=false,b=>b.convergenceResponse.review.factsVerified=true,b=>b.convergenceResponse.review.findings=['omission'],b=>b.convergenceResponse.review.sourceHash=hash('other'),b=>b.convergenceResponse.review.textHash=hash('other'),b=>b.convergenceResponse.review.reviewTask.taskId='generation-task',b=>b.convergenceResponse.review.reviewTask.status='running',b=>b.convergenceResponse.review.reviewTask.inputHash='',b=>b.convergenceReview.state.status='pending',b=>b.convergenceReview.state.source='different',b=>b.convergenceReview.state.task.backendRunId='other',b=>b.convergenceReview.state.binding.projectId='other',b=>b.convergenceReview.state.rawResponse='changed',b=>delete b.convergenceReview];
  for(const change of changes){const f=acceptedFixture();change(bindingOf(f));assert.equal(verifySampleAcceptance(f).sampleAccepted,false);}
});
test('candidate-only, unapplied, locked, changed-body or remote-unsaved result exits nonzero',()=>{
  const changes=[f=>f.after.chapters[0].sections[0].content=f.before.chapters[0].sections[0].content,f=>f.after.chapters[0].sections[0].pendingRevision={after:bindingOf(f).convergenceResponse.text},f=>f.after.chapters[0].sections[0].locked=true,f=>bindingOf(f).provisional={text:'unadopted'},f=>bindingOf(f).expectedBody.content='different',f=>f.after.chapters[0].sections[0].executionTask.id='other',f=>f.remote.project.data.chapters[0].sections[0].content='old saved body',f=>f.remote.project.data.workflow.reportCompletion.initialDelivery.run.permits[0].status='reserved',f=>f.remote.project.id='other'];
  for(const change of changes){const f=acceptedFixture();change(f);const accepted=verifySampleAcceptance(f);assert.equal(accepted.sampleAccepted,false);assert.equal(continuationExitCode({execute:true,sampleAcceptance:accepted}),1);}
});
test('CLI treats errors, uncertain writes, missing acceptance and source changes as failure; prepare remains read-only',()=>{
  assert.equal(continuationExitCode({execute:false}),0);assert.equal(continuationExitCode({execute:true}),1);
  for(const extra of [{error:'failed'},{captureError:'failed'},{remoteError:'failed'},{unknownRequests:[{}]},{browserErrors:['error']},{sourceUnchangedAfter:{tax:false}}])assert.equal(continuationExitCode({execute:true,sampleAcceptance:{sampleAccepted:true},...extra}),1);
  assert.equal(verifySampleAcceptance({}).sampleAccepted,false);
});

function originalFixture(){
  const sample=acceptedFixture(),counts=[6,6,6,6,7,3];
  const chapters=counts.map((n,ci)=>({name:ci===5?'六、运营方案':'章'+ci,sections:Array.from({length:n},(_,si)=>({t:ci===5&&si===2?'运营管理':'节'+si,content:ci===5&&si===2?sample.before.chapters[0].sections[0].content:'<h3>分类</h3><p>保留事实 '+ci+'-'+si+'</p>'}))}));
  const rows=chapters.flatMap((c,ci)=>c.sections.map((s,si)=>({number:(ci+1)+'.'+(si+1),projectId:PROJECT,fullBodyRead:true,fullSourcesRead:true,exactActualMatch:true,semanticStatus:'acceptable-full-body-at-bound-sha',semanticPassed:true,unresolvedContentIssues:[],bodySha256:hash(s.content),actualBodySha256:hash(s.content),fullActualHtml:s.content})));
  const sections=bindReviewedSections(chapters,[{file:'review.json',sha256:'a'.repeat(64),data:{createdAtUtc:'2026-10-13T00:00:00.000Z',reviewer:'independent-reviewer',rows}}]);
  const identity={projectId:PROJECT,research:null,input:'candidate-input-v1:original'},plan={planId:'confirmed-original',planningPriority:'pages',proseTotal:84500,targetPages:120,targetPageRange:{min:110,max:130}};
  const input={authorization:{authorized:true,purpose:'reviewed-existing-length-convergence',confirmationId:'original-confirmation',confirmedAt:'2026-10-13T00:00:00.000Z',planId:plan.planId,identity},sections:sections.map(({number,...s})=>s)};
  const before={projectId:PROJECT,identity,plan,chapters,workflow:{reportCompletion:{lengthPlan:copy(plan)}},plannerReady:true,workflowReady:true};
  return {input,before,sampleKey:sample.selectedKey,requestHash:hash(input),marker:{runId:'original-run'},sample};
}

function resumedFixture(){
  const origin=originalFixture(),sample=origin.sample,live=copy(origin.before),saved=copy(sample.after.workflow.reportCompletion.initialDelivery);
  saved.run.identity=copy(origin.input.authorization.identity);saved.run.authorizationToken='reviewed|'+origin.requestHash;
  saved.continuation={requestHash:origin.requestHash,authorization:copy(origin.input.authorization),plan:copy(origin.before.plan)};
  const sampleSection=live.chapters[5].sections[2];Object.assign(sampleSection,sample.after.chapters[0].sections[0]);
  saved.run.sections=origin.input.sections.map(entry=>{
    const rowOrigin={key:entry.key,allowConverge:entry.allowConverge,bodyHash:entry.bodyHash,sourceHash:entry.review.sourceSha256,review:copy(entry.review)};
    const section=live.chapters.flatMap(c=>c.sections.map(s=>({key:c.name+' / '+s.t,s}))).find(r=>r.key===entry.key).s;
    saved.bindings[entry.key]||={expectedBody:{content:section.content,editedHtml:null},provisional:null};
    saved.bindings[entry.key].reviewedOrigin=copy(rowOrigin);
    return {key:entry.key,bodyHash:hash({content:section.content,editedHtml:null}),origin:rowOrigin};
  });
  live.workflow.reportCompletion.initialDelivery=saved;
  const remote={project:{id:PROJECT,data:copy(live)}},sampleAudit={runId:origin.marker.runId,started:sample.started,result:sample.result,sampleAcceptance:{sampleAccepted:true}};
  return {origin,live,remote,sampleAudit};
}

test('auth preflight reports the exact failing guard without replacing authorization or plan',()=>{
  const o=originalFixture(),original=copy(o),result=continuationAuthPreflight(o.input,o.before);
  assert.equal(result.passed,true);assert.deepEqual(o,original);
  for(const [name,change] of [['planner',s=>s.plannerReady=false],['workflow',s=>s.workflowReady=false],['pages',s=>s.plan.planningPriority='words'],['planId',s=>s.plan.planId='other'],['identity',s=>s.identity.input='rules-changed']]){
    const state=copy(o.before);change(state);const failed=continuationAuthPreflight(o.input,state);assert.equal(failed.passed,false);assert.equal(failed.checks[name],false);assert.deepEqual(o,original);
  }
  for(const change of [a=>a.authorized=false,a=>a.purpose='other',a=>a.confirmationId='',a=>a.confirmedAt='invalid']){const input=copy(o.input);change(input.authorization);assert.equal(continuationAuthPreflight(input,o.before).passed,false);}
});

async function originOnDisk(t){
  const o=originalFixture(),directory=await temp(t),folder=path.join(directory,'lg-production-continuation-original-run');await fs.mkdir(folder);
  const write=async(name,value)=>{const bytes=JSON.stringify(value,null,2);await fs.writeFile(path.join(folder,name),bytes,{flag:'wx'});return {file:path.join(folder,name),sha256:hash(bytes)};};
  const input=await write('continuation-input.json',o.input),browserBefore=await write('browser-before.json',o.before);
  await write('audit.json',{runId:'original-run',projectId:PROJECT,number:'6.3',execute:true,error:'INITIAL_CONTINUATION_AUTH',input,browserBefore,paidIntents:[],unknownRequests:[]});
  const marker={version:'reviewed-continuation-execution-v1',runId:'original-run',projectId:PROJECT,number:'6.3',folder};
  await fs.writeFile(path.join(directory,'lg-production-continuation.sample-execution.json'),JSON.stringify(marker));
  const origin=await loadContinuationOrigin(directory,folder),remote={project:{id:PROJECT,data:copy(o.before)}};
  return {directory,folder,origin,remote,live:copy(o.before),write};
}

async function expiredRunFixture(t){
  const f=await originOnDisk(t),base=Date.parse('2026-10-13T07:00:00Z');let now=base;
  const ctx={planner:require('../report-initial-delivery.js'),chapters:()=>f.live.chapters,workflow:()=>f.live.workflow,plan:()=>f.live.plan,identity:()=>f.live.identity,contract:()=>({requirements:{}}),inspect:()=>({status:'passed',issues:[]}),measure:text=>text.length,classify:()=>({summary:false}),capture:()=>({projectId:PROJECT}),guard:async()=>{},save:async()=>({ok:true,remote:true}),hash:async x=>hash(x),now:()=>now,expansionEvidence:()=>[],canConverge:()=>true,canMeasureDetails:()=>true};
  const runtime=require('../report-initial-delivery-runtime.js').createRuntime(ctx),started=await runtime.startReviewedContinuation(f.origin.input);
  now=base+32*60000;f.remote={project:{id:PROJECT,data:copy(f.live)}};
  const child=path.join(f.folder,'resume-expired');await fs.mkdir(child);
  const bytes=JSON.stringify(f.remote),file=path.join(child,'remote-after.json');await fs.writeFile(file,bytes);
  await fs.writeFile(path.join(child,'audit.json'),JSON.stringify({started,finishedAt:new Date(now-60000).toISOString(),paidIntents:[],unknownRequests:[],paginationIntents:[],originalProjectWrites:0,sourceUnchangedAfter:{tax:true,longgang:true},remoteAfter:{file,sha256:hash(bytes)}}));
  const confirmation={version:'sample-reauthorization-v1',authorized:true,projectId:PROJECT,priorRunId:started.run.runId,sectionNumber:'6.3',sectionKey:f.origin.sampleKey,maxElapsedMs:1800000,maxConvergenceCalls:1,maxReviewCalls:1,confirmationId:'new-explicit-single-sample-window',confirmedAt:new Date(now-30000).toISOString(),userConfirmation:'允许修复后的程序新开最多30分钟窗口，只处理原定6.3一次。'};
  return {...f,base,child,ctx,runtime,started,confirmation,setNow:value=>now=value,getNow:()=>now};
}

test('explicit renewal preserves original files, creates one eligible sample and retains expired run unchanged',async t=>{
  const f=await expiredRunFixture(t),old=copy(f.live.workflow.reportCompletion.initialDelivery),originalFiles=await Promise.all(['continuation-input.json','browser-before.json','audit.json'].map(name=>fs.readFile(path.join(f.folder,name),'utf8')));
  const proof=await proveExpiredZeroDispatch(f.origin,f.live,f.remote,f.getNow()),receipt=bindSampleReauthorization(f.origin,proof,f.confirmation);
  assert.equal(receipt.version,'reviewed-sample-reauthorization-v2');assert.deepEqual(receipt.input.sections.map(s=>s.allowBudgetAllocation),f.origin.input.sections.map(s=>s.allowConverge));
  assert.equal(receipt.input.sections.filter(s=>s.allowConverge).length,1);assert.equal(receipt.input.sections.find(s=>s.allowConverge).key,f.origin.sampleKey);assert.deepEqual(receipt.input.authorization.identity,f.origin.input.authorization.identity);
  const receiptFile=path.join(f.folder,'sample-reauthorization.json');await fs.writeFile(receiptFile,JSON.stringify(receipt),{flag:'wx'});
  const resolved=await resolveSampleReauthorization(f.origin,receipt,f.live,f.remote,{now:f.getNow()});assert.equal(resolved.newRun,true);
  const started=await f.runtime.startReviewedContinuation(resolved.origin.input);assert.equal(verifyReauthorizedStart(receipt,started,f.live),true);
  assert.equal(started.run.limits.maxAdditionalCalls,1);assert.equal(started.run.limits.maxElapsedMs,1800000);assert.deepEqual(started.run.sections.filter(s=>s.eligible).map(s=>s.key),[f.origin.sampleKey]);
  assert.deepEqual(f.live.workflow.reportCompletion.initialDelivery.history.at(-1),{run:old.run,bindings:old.bindings});assert.equal(old.run.startedAt+old.run.limits.maxElapsedMs,f.base+1800000);
  assert.deepEqual(await Promise.all(['continuation-input.json','browser-before.json','audit.json'].map(name=>fs.readFile(path.join(f.folder,name),'utf8'))),originalFiles);
  await assert.rejects(fs.writeFile(receiptFile,'replacement',{flag:'wx'}),{code:'EEXIST'});
});

test('historical permanent v1 sample receipt remains exact and never silently expands its allocation',async t=>{
  const f=await expiredRunFixture(t),proof=await proveExpiredZeroDispatch(f.origin,f.live,f.remote,f.getNow()),receipt=bindSampleReauthorization(f.origin,proof,f.confirmation,{legacyAllocation:true}),before=copy(receipt);
  assert.equal(receipt.version,'reviewed-sample-reauthorization-v1');assert.ok(receipt.input.sections.every(s=>!Object.hasOwn(s,'allowBudgetAllocation')));await validateSampleReauthorization(f.origin,receipt);
  const resolved=await resolveSampleReauthorization(f.origin,receipt,f.live,f.remote,{now:f.getNow()}),started=await f.runtime.startReviewedContinuation(resolved.origin.input);assert.equal(verifyReauthorizedStart(receipt,started,f.live),true);assert.deepEqual(receipt,before);
  const altered=copy(receipt);altered.version='reviewed-sample-reauthorization-v2';await assert.rejects(validateSampleReauthorization(f.origin,altered),/reauthorization changed/);
});

test('crash after receipt before start reuses input; crash after save resumes the same run, never a third window',async t=>{
  const f=await expiredRunFixture(t),proof=await proveExpiredZeroDispatch(f.origin,f.live,f.remote,f.getNow()),receipt=bindSampleReauthorization(f.origin,proof,f.confirmation);
  const first=await resolveSampleReauthorization(f.origin,receipt,f.live,f.remote,{now:f.getNow()}),again=await resolveSampleReauthorization(f.origin,copy(receipt),f.live,f.remote,{now:f.getNow()});assert.deepEqual(first,again);
  const started=await f.runtime.startReviewedContinuation(first.origin.input);f.remote={project:{id:PROJECT,data:copy(f.live)}};
  const loaded=await resolveSampleReauthorization(f.origin,receipt,f.live,f.remote);assert.equal(loaded.newRun,false);assert.equal(loaded.runId,started.run.runId);
  const refreshed=require('../report-initial-delivery-runtime.js').createRuntime(f.ctx),resumed=await refreshed.startReviewedContinuation(loaded.origin.input);
  assert.equal(resumed.resumed,true);assert.equal(resumed.run.runId,started.run.runId);assert.equal(f.live.workflow.reportCompletion.initialDelivery.history.length,1);
  await assert.rejects(resolveSampleReauthorization(f.origin,receipt,f.live,f.remote,{remaining:true}),/only 6.3/);
  assert.throws(()=>validateContinuationResume(loaded.origin,f.live,f.remote,{remaining:true}),/only 6.3/);
  f.setNow(started.run.startedAt+1800001);const stopped=await refreshed.finish({maxDispatchedSections:1,allowedSectionKeys:[f.origin.sampleKey]});assert.equal(stopped.reason,'elapsed-limit');assert.deepEqual(stopped.run.permits,[]);
});

test('renewal refuses any durable intent or unknown response, unexpired run, altered body or incomplete audit',async t=>{
  for(const file of ['section-x-converge-intent.json','section-x-review-response.json','section-x-converge-unknown.json','pagination-x-intent.json']){
    const f=await expiredRunFixture(t);await fs.writeFile(path.join(f.folder,file),'{}');await assert.rejects(proveExpiredZeroDispatch(f.origin,f.live,f.remote,f.getNow()),/intent or response/);
  }
  const f=await expiredRunFixture(t);await assert.rejects(proveExpiredZeroDispatch(f.origin,f.live,f.remote,f.base+1000),/expired unchanged/);
  f.live.chapters[0].sections[0].content+=' changed';await assert.rejects(proveExpiredZeroDispatch(f.origin,f.live,f.remote,f.getNow()));
  const g=await expiredRunFixture(t);await fs.unlink(path.join(g.child,'audit.json'));await assert.rejects(proveExpiredZeroDispatch(g.origin,g.live,g.remote,g.getNow()),/No completed audit/);
});

test('renewal requires exact human scope, immutable proof and final snapshot evidence',async t=>{
  const f=await expiredRunFixture(t),proof=await proveExpiredZeroDispatch(f.origin,f.live,f.remote,f.getNow());
  for(const change of [c=>c.maxConvergenceCalls=29,c=>c.maxReviewCalls=2,c=>c.maxElapsedMs=3600000,c=>c.sectionKey='other',c=>c.priorRunId='other',c=>c.confirmationId=f.origin.input.authorization.confirmationId,c=>c.confirmedAt='invalid',c=>c.confirmedAt=new Date(f.getNow()+1).toISOString(),c=>c.userConfirmation='']){const c=copy(f.confirmation);change(c);assert.throws(()=>bindSampleReauthorization(f.origin,proof,c),/explicit new/);}
  for(const change of [p=>p.paidRequests=1,p=>p.at='invalid',p=>p.priorDeadline++,p=>p.originalMarkerSha256='changed',p=>p.effectiveRequestHash='changed']){const p=copy(proof);change(p);assert.throws(()=>bindSampleReauthorization(f.origin,p,f.confirmation),/zero-dispatch proof/);}
  const receipt=bindSampleReauthorization(f.origin,proof,f.confirmation),altered=copy(receipt);altered.input.sections.find(s=>!s.allowConverge).allowConverge=true;await assert.rejects(validateSampleReauthorization(f.origin,altered),/reauthorization changed/);
  await fs.appendFile(path.join(f.child,'remote-after.json'),' ');await assert.rejects(validateSampleReauthorization(f.origin,receipt),/evidence changed/);
});

test('unknown source check before any browser entry requires fresh original-source checks; started or changed sources never bypass proof',async t=>{
  const f=await expiredRunFixture(t),dir=path.join(f.folder,'resume-preflight-only');await fs.mkdir(dir);
  const file=path.join(dir,'audit.json'),audit={paidIntents:[],unknownRequests:[],originalProjectWrites:0,newProductionRunCreated:false,newReceiptCreated:false,sourceUnchangedAfter:{tax:null,longgang:null},sourceCheckErrors:{tax:'missing database',longgang:'missing database'}};
  await fs.writeFile(file,JSON.stringify(audit));
  await assert.rejects(proveExpiredZeroDispatch(f.origin,f.live,f.remote,f.getNow()),/unchanged sources/);
  const proof=await proveExpiredZeroDispatch(f.origin,f.live,f.remote,f.getNow(),{tax:true,longgang:true});assert.ok(proof.evidence.some(r=>r.file===file));assert.equal(JSON.parse(await fs.readFile(file,'utf8')).sourceUnchangedAfter.tax,null);
  for(const change of [a=>a.started={},a=>a.input={},a=>a.newReceiptCreated=true,a=>a.sourceUnchangedAfter.tax=false,a=>a.paidIntents=[{}]]){
    const altered=copy(audit);change(altered);await fs.writeFile(file,JSON.stringify(altered));
    await assert.rejects(proveExpiredZeroDispatch(f.origin,f.live,f.remote,f.getNow(),{tax:true,longgang:true}),/unchanged sources/);
  }
  await fs.writeFile(file,JSON.stringify(audit));await fs.writeFile(path.join(dir,'browser-before.json'),'{}');
  await assert.rejects(proveExpiredZeroDispatch(f.origin,f.live,f.remote,f.getNow(),{tax:true,longgang:true}),/unchanged sources/);
});

test('saved renewed state cannot authorize changed limits, missing old history, changed prior state, or missing run',async t=>{
  const f=await expiredRunFixture(t),proof=await proveExpiredZeroDispatch(f.origin,f.live,f.remote,f.getNow()),receipt=bindSampleReauthorization(f.origin,proof,f.confirmation);
  const started=await f.runtime.startReviewedContinuation(receipt.input);f.remote={project:{id:PROJECT,data:copy(f.live)}};
  for(const change of [s=>s.run.limits.maxAdditionalCalls=29,s=>s.run.limits.maxElapsedMs=1800001,s=>s.history=[],s=>s.history[0].run.startedAt++,s=>delete s.run]){
    const live=copy(f.live);change(live.workflow.reportCompletion.initialDelivery);await assert.rejects(resolveSampleReauthorization(f.origin,receipt,live,{project:{id:PROJECT,data:copy(live)}}),/missing or changed/);
  }
  const invalid=copy(started);invalid.resumed=true;assert.throws(()=>verifyReauthorizedStart(receipt,invalid,f.live),/exceeded its authorization/);
});

test('zero-POST recovery loads the identical request and leaves the permanent marker and plan intact',async t=>{
  const f=await originOnDisk(t),markerFile=path.join(f.directory,'lg-production-continuation.sample-execution.json'),bytes=await fs.readFile(markerFile,'utf8');
  const state=validateContinuationResume(f.origin,f.live,f.remote);assert.deepEqual(state,{zeroPost:true,allowedKeys:[f.origin.sampleKey],runId:null});
  const proof=await proveZeroPostRecovery(f.origin,f.live,f.remote);assert.equal(proof.paidRequests,0);assert.equal(proof.originalMarkerPreserved,true);assert.equal(proof.requestHash,hash(f.origin.input));assert.equal(proof.confirmationId,'original-confirmation');assert.equal(await fs.readFile(markerFile,'utf8'),bytes);
  await assert.rejects(reserveSampleExecution(f.directory,{...reservation(),runId:'new-run'}),/execution (?:record already|audit) exists/);
});

test('resume refuses changed input bytes, reviewed bodies, original marker or an unrelated folder',async t=>{
  for(const changed of ['input','before','marker','folder']){
    const f=await originOnDisk(t);
    if(changed==='input')await fs.appendFile(path.join(f.folder,'continuation-input.json'),' ');
    if(changed==='before')await fs.appendFile(path.join(f.folder,'browser-before.json'),' ');
    if(changed==='marker'){const file=path.join(f.directory,'lg-production-continuation.sample-execution.json'),marker=JSON.parse(await fs.readFile(file));marker.runId='changed';await fs.writeFile(file,JSON.stringify(marker));}
    await assert.rejects(loadContinuationOrigin(f.directory,changed==='folder'?f.directory:f.folder));
  }
});

test('zero-POST proof fails closed for any dispatch, unknown response, pagination or saved run',async t=>{
  for(const filename of ['started.json','result.json','converge-intent.json','review-response.json','section-x-review-intent.json','pagination-x-intent.json']){
    const f=await originOnDisk(t),child=path.join(f.folder,'resume-prior');await fs.mkdir(child);await fs.writeFile(path.join(child,filename),'{}');
    await assert.rejects(proveZeroPostRecovery(f.origin,f.live,f.remote),/Prior dispatch/);
  }
  for(const field of ['paidIntents','unknownRequests','paginationIntents']){
    const f=await originOnDisk(t),child=path.join(f.folder,'resume-prior');await fs.mkdir(child);await fs.writeFile(path.join(child,'audit.json'),JSON.stringify({[field]:[{}]}));await assert.rejects(proveZeroPostRecovery(f.origin,f.live,f.remote),/proven zero/);
  }
  const f=await originOnDisk(t);f.live.workflow.reportCompletion.initialDelivery={run:{runId:'already-started'}};await assert.rejects(proveZeroPostRecovery(f.origin,f.live,f.remote),/no saved production run/);
});

test('remaining continuation returns only 28 keys after exact source-bound independent 6.3 adoption',()=>{
  const f=resumedFixture(),snapshot=copy(f),result=validateContinuationResume(f.origin,f.live,f.remote,{remaining:true,sampleAudit:f.sampleAudit});
  assert.equal(result.zeroPost,false);assert.equal(result.runId,'continuation-run');assert.equal(result.allowedKeys.length,28);assert.equal(result.allowedKeys.includes(f.origin.sampleKey),false);
  assert.deepEqual(f,snapshot);assert.equal(f.origin.before.plan.proseTotal,84500);assert.equal(f.origin.input.authorization.confirmationId,'original-confirmation');
});

test('remaining cannot proceed after missing sample approval, hash drift, changed confirmation, plan, source or remote',()=>{
  const changes=[f=>delete f.sampleAudit,f=>f.sampleAudit.sampleAcceptance.sampleAccepted=false,f=>f.live.plan.proseTotal=75000,f=>f.live.identity.input='changed',f=>f.remote.project.id='source-project',f=>f.live.chapters[0].sections[0].content='keep changed',f=>f.live.workflow.reportCompletion.initialDelivery.continuation.requestHash='new',f=>f.live.workflow.reportCompletion.initialDelivery.continuation.authorization.confirmationId='new',f=>f.live.workflow.reportCompletion.initialDelivery.bindings[f.origin.sampleKey].convergenceResponse.review.passed=false,f=>f.live.workflow.reportCompletion.initialDelivery.run.runId='new'];
  for(const change of changes){const f=resumedFixture();change(f);assert.throws(()=>validateContinuationResume(f.origin,f.live,f.remote,{remaining:true,sampleAudit:f.sampleAudit}));}
});

function paidRouteFixture(){
  const f=resumedFixture(),entry=f.origin.input.sections.find(s=>s.allowConverge&&s.key!==f.origin.sampleKey),key=entry.key,saved=f.live.workflow.reportCompletion.initialDelivery,section=f.live.chapters.flatMap(c=>c.sections.map(s=>({key:c.name+' / '+s.t,s}))).find(r=>r.key===key).s;
  const permit={id:'remaining-permit',kind:'length-converge',status:'reserved',key,runId:saved.run.runId,planId:f.live.plan.planId,idempotencyKey:'original-idempotency',batchId:'original-batch',referenceBudget:{target:40,actual:50}};
  saved.run.permits.push(permit);
  const source=section.content,user={purpose:'initial-length-convergence-v1',sectionKey:key,permitId:permit.id,idempotencyKey:permit.idempotencyKey,batchId:permit.batchId,referenceBudget:permit.referenceBudget,source};
  const options={url:'http://localhost:8080/api/reportexecution',method:'POST',body:{projectId:PROJECT,sectionKey:key,user:JSON.stringify(user)},frame:true};
  const calls=[],intents=[],responses=[],unknown=[],claims=new Set();
  const config={origin:'http://localhost:8080',input:f.origin.input,allowedKeys:f.origin.input.sections.filter(s=>s.allowConverge&&s.key!==f.origin.sampleKey).map(s=>s.key),readState:async()=>f.live,fromPage:()=>options.frame,claim:async intent=>{const id=intent.sectionKey+'|'+intent.kind;if(claims.has(id))throw Error('already claimed');claims.add(id);intents.push(intent);},respond:async receipt=>responses.push(receipt),onTask:id=>calls.push('task:'+id),onUnknown:async receipt=>unknown.push(receipt)};
  const route=()=>({request:()=>({url:()=>options.url,method:()=>options.method,postDataJSON:()=>options.body,postData:()=>JSON.stringify(options.body)}),fallback:async()=>calls.push('GET/base'),fulfill:async x=>calls.push(x.status||'fulfilled'),abort:async()=>calls.push('aborted'),fetch:async opts=>{calls.push('POST');assert.equal(intents.length,1);assert.equal(opts.maxRetries,0);if(options.fail)throw Error('response lost');return {status:()=>200,body:async()=>Buffer.from(JSON.stringify({ok:true,task:{id:'original-task'}}))};}});
  return {...f,key,permit,source,user,saved,options,calls,intents,responses,unknown,claims,config,route};
}

test('remaining paid route durably claims before dispatch; restarts never repost the same section/kind',async()=>{
  const f=paidRouteFixture();await scopedContinuationPaidRoute(f.config)(f.route());assert.deepEqual(f.calls,['POST','task:original-task','fulfilled']);
  assert.equal(f.intents.length,1);assert.equal(f.intents[0].requestHash,f.origin.requestHash);assert.equal(f.intents[0].confirmationId,'original-confirmation');
  await scopedContinuationPaidRoute(f.config)(f.route());assert.deepEqual(f.calls,['POST','task:original-task','fulfilled',403]);assert.equal(f.intents.length,1);
  f.options.method='GET';await scopedContinuationPaidRoute(f.config)(f.route());assert.equal(f.calls.at(-1),'GET/base');
});

test('renewed sample paid route refuses expired time window or widened call budget before durable claim',async()=>{
  for(const kind of ['expired','widened','other-section','valid']){
    const f=paidRouteFixture();f.config.input.authorization.sampleReauthorization={sectionKey:f.key};f.saved.run.startedAt=1000;f.saved.run.limits={maxAdditionalCalls:1,maxElapsedMs:1800000};f.config.now=()=>kind==='expired'?1801000:1001;
    if(kind==='widened')f.saved.run.limits.maxAdditionalCalls=29;
    if(kind==='other-section')f.config.input.authorization.sampleReauthorization.sectionKey='only-6.3';
    f.saved.continuation.authorization=copy(f.config.input.authorization);f.saved.continuation.requestHash=hash(f.config.input);f.saved.run.authorizationToken='reviewed|'+hash(f.config.input);
    await scopedContinuationPaidRoute(f.config)(f.route());
    assert.equal(f.intents.length,kind==='valid'?1:0);assert.equal(f.calls.includes('POST'),kind==='valid');
  }
});

test('lost response, failed response and durable receipt failure retain the original request without automatic retry',async()=>{
  for(const kind of ['lost','response-save']){
    const f=paidRouteFixture();if(kind==='lost')f.options.fail=true;else f.config.respond=async()=>{throw Error('disk unavailable');};
    await scopedContinuationPaidRoute(f.config)(f.route());assert.equal(f.unknown.length,1);assert.equal(f.calls.at(-1),'aborted');
    await scopedContinuationPaidRoute(f.config)(f.route());assert.equal(f.calls.filter(c=>c==='POST').length,1);assert.equal(f.calls.at(-1),403);
  }
});

test('6.3, KEEP chapters, wrong project/origin/permit/input and repair POST never reach the network',async()=>{
  const changes=[f=>f.options.body.sectionKey=f.origin.sampleKey,f=>f.options.body.sectionKey=f.origin.input.sections.find(s=>!s.allowConverge).key,f=>f.options.body.projectId='formal-project',f=>f.options.body.action='repair',f=>f.options.url='http://other.example/api/reportexecution',f=>f.options.url+='?id=other',f=>f.options.url='http://localhost:8080/api/generate',f=>f.options.frame=false,f=>f.permit.status='failed',f=>f.permit.taskId='existing-task',f=>f.permit.runId='new',f=>f.live.identity.input='changed',f=>f.saved.continuation.requestHash='changed',f=>f.options.body.user='invalid JSON',f=>{const u=JSON.parse(f.options.body.user);u.source='changed';f.options.body.user=JSON.stringify(u);}];
  for(const change of changes){const f=paidRouteFixture();change(f);await scopedContinuationPaidRoute(f.config)(f.route());assert.deepEqual(f.calls,[403]);assert.equal(f.intents.length,0);}
});

test('independent review POST binds the exact retained response and source, and cannot repeat or reuse a task',async()=>{
  const f=paidRouteFixture(),text='<h3>分类</h3><p>保留事实</p>',binding={permitId:f.permit.id,idempotencyKey:f.permit.idempotencyKey,batchId:f.permit.batchId,referenceBudget:f.permit.referenceBudget,sourceHash:hash(f.source),textHash:hash(text)};
  f.saved.bindings[f.key].convergenceResponse={permitId:f.permit.id,text,hash:hash(text)};
  f.saved.bindings[f.key].convergenceReview={state:{binding:copy(binding),requestIntent:{status:'intent-saved'},task:null}};
  f.options.body.user=JSON.stringify({purpose:'initial-length-preservation-v1',binding,source:f.source,text});
  await scopedContinuationPaidRoute(f.config)(f.route());assert.equal(f.intents[0].kind,'review');assert.equal(f.calls.filter(c=>c==='POST').length,1);
  await scopedContinuationPaidRoute(f.config)(f.route());assert.equal(f.calls.at(-1),403);
  f.saved.bindings[f.key].convergenceReview.state.task={taskId:'existing-review'};f.claims.clear();await scopedContinuationPaidRoute(f.config)(f.route());assert.equal(f.calls.at(-1),403);assert.equal(f.calls.filter(c=>c==='POST').length,1);
});

test('GET-recovered convergence may start only its not-yet-requested review, never another convergence',async()=>{
  const f=paidRouteFixture(),text='<h3>分类</h3><p>保留事实</p>',binding={permitId:f.permit.id,idempotencyKey:f.permit.idempotencyKey,batchId:f.permit.batchId,referenceBudget:f.permit.referenceBudget,sourceHash:hash(f.source),textHash:hash(text)};
  Object.assign(f.permit,{status:'uncertain',taskId:'original-convergence',backendRunId:'original-backend',inputHash:'original-input'});
  await scopedContinuationPaidRoute(f.config)(f.route());assert.deepEqual(f.calls,[403]);
  f.saved.bindings[f.key].convergenceResponse={permitId:f.permit.id,text,hash:hash(text)};
  f.saved.bindings[f.key].convergenceReview={state:{binding:copy(binding),requestIntent:{status:'intent-saved'},task:null}};
  f.options.body.user=JSON.stringify({purpose:'initial-length-preservation-v1',binding,source:f.source,text});
  delete f.permit.inputHash;await scopedContinuationPaidRoute(f.config)(f.route());assert.equal(f.calls.at(-1),403);assert.equal(f.intents.length,0);
  f.permit.inputHash='original-input';await scopedContinuationPaidRoute(f.config)(f.route());assert.equal(f.calls.filter(c=>c==='POST').length,1);assert.equal(f.intents[0].kind,'review');
  await scopedContinuationPaidRoute(f.config)(f.route());assert.equal(f.calls.at(-1),403);assert.equal(f.calls.filter(c=>c==='POST').length,1);
});

test('pagination durable permit claim also rejects the same permit after a route restart',async()=>{
  const f=paginationFixture(),used=new Set();f.config.record=async receipt=>{if(used.has(receipt.permitId))throw Error('already dispatched');used.add(receipt.permitId);};
  await scopedPaginationRoute(f.config)(f.route());await scopedPaginationRoute(f.config)(f.route());assert.deepEqual(f.calls,['continued',403]);
});

test('batch success still reports incomplete overall report and requires all 29 individually accepted',()=>{
  assert.equal(continuationExitCode({execute:true,remaining:true,batchAcceptance:{accepted:true},result:{complete:false}}),0);
  assert.equal(continuationExitCode({execute:true,remaining:true,batchAcceptance:{accepted:false},sampleAcceptance:{sampleAccepted:true}}),1);
});

test('already adopted sample can recover its audit without a new dispatch; unapplied response cannot',()=>{
  const f=acceptedFixture();f.result.reason='dispatch-selection-exhausted';assert.equal(verifySampleAcceptance(f).sampleAccepted,true);
  f.after.chapters[0].sections[0].content=f.before.chapters[0].sections[0].content;assert.equal(verifySampleAcceptance(f).sampleAccepted,false);
});

test('unknown-response audit failure still aborts the request and retains the original durable claim',async()=>{
  const f=paidRouteFixture();f.options.fail=true;f.config.onUnknown=async()=>{throw Error('disk failed again');};
  await assert.rejects(scopedContinuationPaidRoute(f.config)(f.route()),/disk failed again/);assert.equal(f.calls.at(-1),'aborted');
  await scopedContinuationPaidRoute(f.config)(f.route());assert.equal(f.calls.at(-1),403);assert.equal(f.calls.filter(x=>x==='POST').length,1);
});

function hydrationFixture(){
  const origin=originalFixture(),payload={generationRules:{version:'current'},facts:{area:200,optional:undefined},materials:[{id:'original'}],lengthPlan:copy(origin.before.plan),directory:[{name:'c',sections:[{title:'s',checked:undefined}]}],logic:{version:7,scenarioVersion:'v1',globalRequirements:'rules',rules:[{sectionKey:'c / s',rules:[{id:'rule1',missingPolicy:undefined}]}]},gap:{active:true,valid:true,issues:[],records:[{status:'unverified',requirementIds:['req:rule1'],evidenceIds:[],approval:null,assessment:null}]}};
  const unloaded={...payload,gap:null,logic:{version:0,scenarioVersion:null,globalRequirements:'',rules:[{sectionKey:'c / s',rules:[]}]}};
  origin.input.authorization.identity.input='candidate-input-v1:'+fingerprint(unloaded);origin.before.identity=copy(origin.input.authorization.identity);origin.requestHash=hash(origin.input);origin.inputSha256=hash(JSON.stringify(origin.input,null,2));origin.markerSha256='a'.repeat(64);
  const proof={version:'zero-post-recovery-proof-v1',projectId:PROJECT,runId:origin.marker.runId,confirmationId:origin.input.authorization.confirmationId,requestHash:origin.requestHash,markerSha256:origin.markerSha256,inputSha256:origin.inputSha256,at:'2026-10-13T07:00:00Z',paidRequests:0,originalMarkerPreserved:true};
  return {origin,payload,proof};
}

test('zero-POST rule hydration retains the original confirmation, bodies, plan, and immutable request',()=>{
  const f=hydrationFixture(),before=structuredClone(f),envelope=encodeIdentityPayload(f.payload),supplement=copy(bindLoadedRuleSupplement(f.origin,envelope,f.proof)),effective=validateLoadedRuleSupplement(f.origin,supplement,envelope);
  assert.deepEqual(f,before);assert.equal(effective.input.authorization.confirmationId,f.origin.input.authorization.confirmationId);assert.equal(effective.input.authorization.confirmedAt,f.origin.input.authorization.confirmedAt);assert.deepEqual(effective.input.sections,f.origin.input.sections);assert.deepEqual(effective.before.plan,f.origin.before.plan);
  assert.equal(effective.input.authorization.identity.input,'candidate-input-v1:'+fingerprint(f.payload));assert.notEqual(effective.requestHash,f.origin.requestHash);
  assert.equal(supplement.payloadEnvelope.undefinedPaths.length,3);assert.notEqual(fingerprint(copy(f.payload)),fingerprint(f.payload));assert.equal(supplement.payloadSha256,hash(envelope));
  const live=copy(f.origin.before);live.identity=copy(effective.input.authorization.identity);const remote={project:{id:PROJECT,data:copy(live)}};
  assert.equal(validateContinuationResume(effective,live,remote).zeroPost,true);assert.equal(continuationAuthPreflight(effective.input,live).passed,true);
  assert.throws(()=>validateContinuationResume(f.origin,live,remote),/changed/);
});

test('hydration rejects real inputs changing, new evidence, unloaded rules and unproven zero POST',()=>{
  const changes=[f=>f.payload.facts.area++,f=>f.payload.materials.push({id:'new'}),f=>f.payload.lengthPlan.targetPages=100,f=>f.payload.directory[0].sections[0].title='new',f=>f.payload.logic.version=0,f=>f.payload.logic.rules=[],f=>f.payload.gap.valid=false,f=>f.payload.gap.records[0].status='approved',f=>f.payload.gap.records[0].approval={confirmed:true},f=>f.payload.gap.records[0].assessment={},f=>f.payload.gap.records[0].evidenceIds=['new'],f=>f.payload.gap.records[0].requirementIds=['unknown'],f=>f.proof.paidRequests=1,f=>f.proof.originalMarkerPreserved=false,f=>f.proof.inputSha256='different',f=>f.proof.requestHash='different',f=>f.proof.confirmationId='different'];
  for(const change of changes){const f=hydrationFixture();change(f);assert.throws(()=>bindLoadedRuleSupplement(f.origin,encodeIdentityPayload(f.payload),f.proof));}
});

test('a published hydration receipt cannot be replaced or rebound on a later resume',()=>{
  const changes=[(f,s)=>s.input.authorization.confirmedAt='2026-10-14T00:00:00Z',(f,s)=>s.requestHash='new',(f,s)=>s.originalInputSha256='new',(f,s)=>s.payloadSha256='new',(f,s)=>f.payload.logic.version++,(f,s)=>s.proof.paidRequests=1];
  for(const change of changes){const f=hydrationFixture(),supplement=copy(bindLoadedRuleSupplement(f.origin,encodeIdentityPayload(f.payload),f.proof));change(f,supplement);assert.throws(()=>validateLoadedRuleSupplement(f.origin,supplement,encodeIdentityPayload(f.payload)));}
});

test('hydration binds exact production requirement IDs, not bare or unrelated rule IDs',()=>{
  require('../report-logic-core.js');
  const f=hydrationFixture(),rule=f.payload.logic.rules[0].rules[0],requirement=globalThis.ReportLogicCore.dataRequirement(rule,{projectType:'gaibao'});
  f.payload.gap.records[0].requirementIds=[requirement.requirementId];
  assert.equal(requirement.requirementId,'req:rule1');assert.doesNotThrow(()=>bindLoadedRuleSupplement(f.origin,encodeIdentityPayload(f.payload),f.proof));
  for(const ids of [['rule1'],['req:unknown'],['req:rule1','rule1']]){f.payload.gap.records[0].requirementIds=ids;assert.throws(()=>bindLoadedRuleSupplement(f.origin,encodeIdentityPayload(f.payload),f.proof),/Rules are not fully loaded/);}
});

test('identity envelope preserves own undefined keys and array entries through JSON storage without mutating inputs',()=>{
  const value={a:undefined,b:null,nested:[undefined,{missing:undefined,empty:null}],text:'undefined'},before=structuredClone(value);
  const envelope=encodeIdentityPayload(value),restored=decodeIdentityPayload(copy(envelope));
  assert.deepEqual(value,before);assert.deepEqual(restored,value);assert.equal(Object.hasOwn(restored,'a'),true);assert.equal(Object.hasOwn(restored.nested,0),true);
  assert.deepEqual(envelope.undefinedPaths,[['a'],['nested',0],['nested',1,'missing']]);assert.equal(fingerprint(restored),fingerprint(value));assert.notEqual(fingerprint(copy(value)),fingerprint(value));
  assert.deepEqual(decodeIdentityPayload(copy(encodeIdentityPayload({constructor:undefined,['__proto__']:undefined}))),{constructor:undefined,['__proto__']:undefined});
  assert.equal(decodeIdentityPayload(copy(encodeIdentityPayload(undefined))),undefined);
});

test('identity envelope rejects malformed, duplicate, inherited, non-placeholder and unrecorded paths',()=>{
  const mutations=[e=>e.version='old',e=>e.extra=true,e=>e.undefinedPaths.push(['a']),e=>e.undefinedPaths=[['missing']],e=>e.undefinedPaths=[['constructor']],e=>e.undefinedPaths=[['nested','0']],e=>e.undefinedPaths=[['nested',8]],e=>e.undefinedPaths=[['text']],e=>e.undefinedPaths=[['a','child']],e=>e.undefinedPaths=[[]],e=>e.undefinedPaths.reverse(),e=>e.value.newValue=undefined];
  for(const change of mutations){const envelope=encodeIdentityPayload({a:undefined,nested:[undefined],text:'present'});change(envelope);assert.throws(()=>decodeIdentityPayload(envelope));}
  const cycle={};cycle.self=cycle;
  for(const value of [cycle,()=>{},new Date(),NaN,Infinity,[,1]])assert.throws(()=>encodeIdentityPayload(value));
});

test('real browser capture preserves undefined production fingerprint fields and restores the original fingerprint function',{timeout:60000},async()=>{
  const {chromium}=require('playwright'),browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();await page.route('**/*',route=>route.abort());
    await page.addScriptTag({path:path.resolve('report-completion-contract.js')});
    await page.evaluate(()=>{
      window.ReportLogicCore={load:async()=>({data:{rules:[{id:'rule'}]}})};window.rlProjectType=()=> 'gaibao';window.ensureReportTableTemplates=async()=>{};
      window.captureInput={generationRules:{version:'current'},directory:[{title:'小节',checked:undefined}],project:{name:'[系统测试]无损捕获',location:undefined},facts:{known:3,notYetKnown:undefined},values:[undefined,null],logic:{rules:[{missing:undefined}]}};
      window.originalFingerprint=ReportCompletionContract.fingerprint;
      window.reportCandidateInputIdentity=()=> 'candidate-input-v1:'+ReportCompletionContract.fingerprint(captureInput);
    });
    const before=await page.evaluate(()=>({identity:reportCandidateInputIdentity(),lossyIdentity:'candidate-input-v1:'+ReportCompletionContract.fingerprint(JSON.parse(JSON.stringify(captureInput)))}));
    assert.notEqual(before.identity,before.lossyIdentity);
    const envelope=await loadedRulePayload(page),stored=copy(envelope),restored=decodeIdentityPayload(stored);
    assert.equal(envelope.undefinedPaths.length,5);assert.equal('candidate-input-v1:'+fingerprint(restored),before.identity);
    assert.equal(await page.evaluate(()=>ReportCompletionContract.fingerprint===originalFingerprint),true);
    assert.deepEqual(await page.evaluate(()=>captureInput),restored);
    await page.evaluate(()=>{window.reportCandidateInputIdentity=()=>{ReportCompletionContract.fingerprint(captureInput);throw Error('capture rejected');};});
    await assert.rejects(loadedRulePayload(page),/capture rejected/);
    assert.equal(await page.evaluate(()=>ReportCompletionContract.fingerprint===originalFingerprint),true);
  }finally{await browser.close();}
});
