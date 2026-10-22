import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);require('../../scripts/windows-browser-lockout-guard.cjs');
const {bindReviewedSections,reserveSampleExecution,scopedPaginationRoute,verifySampleAcceptance,continuationExitCode,continuationAuthPreflight,loadContinuationOrigin,proveZeroPostRecovery,validateContinuationResume,scopedContinuationPaidRoute,bindLoadedRuleSupplement,validateLoadedRuleSupplement,encodeIdentityPayload,decodeIdentityPayload,loadedRulePayload,proveExpiredZeroDispatch,bindSampleReauthorization,validateSampleReauthorization,resolveSampleReauthorization,verifyReauthorizedStart}=await import('../../scripts/report-reviewed-continuation-acceptance.mjs');
const {fingerprint}=require('../../report-completion-contract.js');
const hash=x=>crypto.createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const copy=x=>JSON.parse(JSON.stringify(x));
const PROJECT='2884b7a3-960f-40c0-af89-5d19e0284836';
const {persistContinuationAudit}=await import('../../scripts/report-reviewed-continuation-acceptance.mjs');
const {bindSlimStartRecovery,restoreSlimStartMetadata}=await import('../../scripts/report-reviewed-continuation-acceptance.mjs');
const {proveRetainedNoop,bindRetainedNoopReauthorization,restoreRetainedNoopTask,resolveRetainedNoopStart,retainedNoopStartedReceipt}=await import('../../scripts/report-reviewed-continuation-acceptance.mjs');

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
