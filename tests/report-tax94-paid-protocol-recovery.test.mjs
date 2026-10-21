import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
import CompletionContract from '../report-completion-contract.js';
import BusinessStructure from '../report-business-structure.js';
import ReportArgument from '../report-argument.js';
import {loadTax94PaidEvidence,recoverTax94PaidProtocol,stripTax94KnownMetadata,assertTax94PaidRecoveryCas,loadTax94IdentityRebindBaseline,browserCaptureTax94IdentityInputs,createTax94IdentityRebindProposal,assertTax94IdentityRebindProposal} from '../scripts/report-tax94-paid-protocol-recovery.mjs';
import {applyTax94Analyses} from '../scripts/report-tax94-recovery.mjs';

const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const base=new URL('../outputs/report-standardization/1010-full-generation-2026-10-10T02-04-51-303Z-3378c9e5/generation-runner/',import.meta.url);
async function fixture(){return recoverTax94PaidProtocol(await loadTax94PaidEvidence());}
async function observation(result){
  const task=JSON.parse(await fs.readFile(new URL('tax/recovery/free-protocol-9.4-1791617798838.json',base))).task;
  return {projectId:result.projectId,key:result.key,paused:true,canEdit:true,currentSection:structuredClone(result.prepared.originalSection),sourceIdentity:result.prepared.sourceIdentity,financialSourceSignature:result.prepared.financialBinding.sourceSignature,sourceUnchanged:{tax:true,longgang:true},originalTask:task};
}

test('import under legacy argv and default CLI cannot dispatch, write or adopt',()=>{
  const url=new URL('../scripts/report-tax94-paid-protocol-recovery.mjs',import.meta.url).href;
  const script=`import fs from 'node:fs'; import fsp from 'node:fs/promises'; globalThis.fetch=()=>{throw Error('network forbidden')}; for(const name of ['writeFile','appendFile','unlink','rename','mkdir'])fsp[name]=()=>{throw Error('write forbidden')}; for(const name of ['writeFileSync','appendFileSync','unlinkSync','renameSync','mkdirSync'])fs[name]=()=>{throw Error('write forbidden')}; process.argv=['node','other.mjs','--run']; await import(${JSON.stringify(url)}); console.log('inert');`;
  const imported=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8'});
  assert.equal(imported.status,0,imported.stderr);assert.equal(imported.stdout.trim(),'inert');
  const direct=spawnSync(process.execPath,[new URL('../scripts/report-tax94-paid-protocol-recovery.mjs',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')],{encoding:'utf8'});
  assert.equal(direct.status,0,direct.stderr);assert.equal(JSON.parse(direct.stdout).projectWrites,0);assert.equal(JSON.parse(direct.stdout).newPaidAiCalls,0);
});

test('only exact known top-level metadata is removed without changing nested bytes',()=>{
  const response={type:'json_object',replacements:[{id:'slot',text:'保留原文'}],additions:[],tables:[]},before=JSON.stringify(response),out=stripTax94KnownMetadata(response);
  assert.equal(JSON.stringify(response),before);assert.deepEqual(out.response,{replacements:response.replacements,additions:[],tables:[]});assert.deepEqual(out.normalizations,[{kind:'known-top-level-metadata-removal',pointer:'/type',value:'json_object'}]);
  for(const value of [null,[],{...response,type:'text'},{...response,type:{type:'json_object'}},{...response,unknown:true},{replacements:[],additions:[],tables:[]}])assert.throws(()=>stripTax94KnownMetadata(value));
});

test('real retained paid output is recovered offline with exact prose, frozen table and original task',async()=>{
  const evidence=await loadTax94PaidEvidence(),before=JSON.parse(evidence.before),raw=JSON.parse(evidence.raw),payload=JSON.parse(Buffer.from(raw.bodyBase64,'base64')),response=JSON.parse(payload.content[0].text),result=await recoverTax94PaidProtocol(evidence);
  assert.equal(result.newPaidAiCalls,0);assert.equal(result.projectWrites,0);assert.equal(result.originalPaidAiCalls,1);assert.equal(result.notAccepted,true);assert.equal(result.semanticReviewRequired,true);assert.equal(result.factsVerified,false);
  const direct=applyTax94Analyses(before.prepared,stripTax94KnownMetadata(response).response);
  assert.equal(result.after,direct.after);assert.equal(result.afterSha256,sha(result.after));assert.equal(result.operationCount,3);assert.equal(result.unchangedTables,1);assert.equal(result.unchangedHeadingCount,3);
  for(const item of response.replacements)assert.ok(result.after.includes(item.text));
  assert.ok(result.after.includes(before.prepared.programTableHtml));assert.deepEqual(before.originalExecutionTask,result.prepared.originalSection.executionTask??null);assert.equal(result.cas.executionTaskSha256,sha('null'));
  assert.equal((await recoverTax94PaidProtocol(evidence)).afterSha256,result.afterSha256,'offline derivation is deterministic and never consumes/re-arms intent');
});

test('tampering with any raw/before/intent/consumption/execution artifact is blocked before derivation',async()=>{
  for(const key of ['raw','before','intent','consumption','execute']){const evidence=await loadTax94PaidEvidence();evidence[key]=Buffer.concat([evidence[key],Buffer.from(' ')]);await assert.rejects(recoverTax94PaidProtocol(evidence),/Pinned .* evidence SHA changed/);}
});

test('nested unknown fields, extra/duplicate slots and numeric inventions remain blocked by original editor',async()=>{
  const result=await fixture(),evidence=await loadTax94PaidEvidence(),raw=JSON.parse(evidence.raw),parsed=JSON.parse(JSON.parse(Buffer.from(raw.bodyBase64,'base64')).content[0].text);
  for(const mutate of [r=>r.replacements[0].extra=true,r=>r.replacements[1].id=r.replacements[0].id,r=>r.replacements.pop(),r=>r.replacements[0].text+='临界出租率为15.1%。',r=>r.additions.push({id:'new',text:'新增'}),r=>r.tables.push({id:'new'})]){const changed=structuredClone(parsed);mutate(changed);assert.throws(()=>applyTax94Analyses(result.prepared,stripTax94KnownMetadata(changed).response));}
});

test('fresh CAS permits only same actual body, pending, task, context and frozen source',async()=>{
  const result=await fixture(),observed=await observation(result);assert.equal(assertTax94PaidRecoveryCas(result,observed).candidateOnly,true);
  for(const mutate of [o=>o.projectId='other',o=>o.paused=false,o=>o.canEdit=false,o=>o.currentSection.content='unexpected adopted body',o=>o.currentSection.pendingRevision.after+='changed',o=>o.currentSection.executionTask={id:'other'},o=>o.sourceIdentity+='changed',o=>o.financialSourceSignature+='changed',o=>o.sourceUnchanged.tax=false,o=>o.originalTask.status='running',o=>o.originalTask.rulesChanged=true,o=>o.originalTask.runId='other']){const changed=structuredClone(observed);mutate(changed);assert.throws(()=>assertTax94PaidRecoveryCas(result,changed));}
  const changed=structuredClone(result);changed.after+='changed';assert.throws(()=>assertTax94PaidRecoveryCas(changed,observed),/candidate\/proof changed/);
});

async function rebindFixture(){
  const recovered=await fixture(),baseline=await loadTax94IdentityRebindBaseline(recovered),current=structuredClone(baseline.expected),freshPrepared=structuredClone(recovered.prepared);
  freshPrepared.sourceIdentity=current.sourceIdentity;
  const identityRebind={baseline,current,freshPrepared};identityRebind.proposal=createTax94IdentityRebindProposal(recovered,identityRebind);
  const observed=await observation(recovered);observed.sourceIdentity=current.sourceIdentity;observed.identityRebind=identityRebind;
  return {recovered,identityRebind,observed};
}
function recomputeCaptureIdentity(capture){
  const text='{'+Object.keys(capture.fields).sort().map(key=>JSON.stringify(key)+':'+capture.fields[key]).join(',')+'}';let hash=2166136261;
  for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619);
  capture.sourceIdentity='candidate-input-v1:'+(hash>>>0).toString(16).padStart(8,'0');
}

test('immutable old inputs independently replay both LOADED logic identities; explicit sidecar alone admits new identity',async()=>{
  const {recovered,identityRebind,observed}=await rebindFixture(),before=JSON.stringify(recovered),p=identityRebind.proposal;
  assert.equal(identityRebind.baseline.old.sourceIdentity,'candidate-input-v1:92bafbe2');assert.equal(identityRebind.current.sourceIdentity,'candidate-input-v1:6d80736d');
  assert.deepEqual(p.exactDifferences.map(row=>row.pointer),['/lengthPlan','/lengthPlanStatus']);assert.equal(p.numericChanges.length,31);
  assert.ok(p.numericChanges.every(row=>row.pointer.endsWith('/numeric')&&row.before===false&&row.after===true));
  assert.equal(identityRebind.current.storedPlan.planId,'length-4d644de6');assert.equal(identityRebind.current.storedPlan.confirmedAt,'2026-10-10T02:13:02.948Z');
  assert.equal(recovered.prepared.originalSection.executionTask??null,null);assert.equal(p.cas.executionTaskSha256,sha('null'));
  assert.equal(Object.keys(p.paidEvidence).length,5);assert.equal(p.newPaidAiCalls,0);assert.equal(p.projectWrites,0);assert.equal(p.notOriginalAiReceipt,true);
  assert.equal(assertTax94IdentityRebindProposal(recovered,identityRebind),observed.sourceIdentity);
  assert.equal(assertTax94PaidRecoveryCas(recovered,observed).candidateOnly,true);
  const without=structuredClone(observed);delete without.identityRebind;assert.throws(()=>assertTax94PaidRecoveryCas(recovered,without),/source\/financial binding/);
  assert.equal(JSON.stringify(recovered),before,'No original paid evidence/task/candidate metadata is rewritten');
  assert.deepEqual(createTax94IdentityRebindProposal(recovered,identityRebind),p,'Proposal is deterministic and can be persisted with wx by its controller');
});

test('browser capture refuses unloaded logic and always restores the real fingerprint hook on success/failure',()=>{
  const original=value=>JSON.stringify(value),ctx={currentProjectId:'f4395f64-af1b-43bd-b809-580b5ec9406b',__qaDispatchPaused:true,projectCanEdit:()=>true,rlProjectType:()=> 'gaibao',ReportLogicCore:{current:()=>null},ReportCompletionContract:{fingerprint:original},projectWorkflow:{reportCompletion:{lengthPlan:{planId:'kept'}}}};
  ctx.window=ctx;vm.createContext(ctx);
  const run=()=>vm.runInContext('('+browserCaptureTax94IdentityInputs.toString()+')()',ctx);
  assert.throws(run,/Await the published v7 logic/);assert.equal(ctx.ReportCompletionContract.fingerprint,original);
  ctx.ReportLogicCore.current=()=>({version:7});ctx.reportCandidateInputIdentity=()=>{ctx.ReportCompletionContract.fingerprint({generationRules:{},directory:[],logic:{},undefinedMember:undefined});return 'test-identity';};
  const capture=run();assert.equal(capture.fields.undefinedMember,'undefined');assert.equal(ctx.ReportCompletionContract.fingerprint,original);
  ctx.reportCandidateInputIdentity=()=>{ctx.ReportCompletionContract.fingerprint({generationRules:{},directory:[],logic:{}});throw Error('capture failure');};
  assert.throws(run,/capture failure/);assert.equal(ctx.ReportCompletionContract.fingerprint,original);
});

test('historical replay pins the audited basis rule but live upgraded rules cannot use that old rebind',async()=>{
  const currentBasisVersion=BusinessStructure.BASIS_VERSION;
  const {recovered,identityRebind}=await rebindFixture();
  const rules=JSON.parse(identityRebind.baseline.old.fields.generationRules);
  assert.equal(rules.basisStructure,'business-structure-basis-v3');
  assert.equal(sha(identityRebind.baseline.old.fields.generationRules),'6f4bb6bcdd6681cdb7f89535dcbe5160c7c334a83e85c38de8df6f004dc4e3e9');
  assert.equal(BusinessStructure.BASIS_VERSION,currentBasisVersion,'offline replay cannot downgrade the production module');
  const report=await fs.readFile(new URL('../report.js',import.meta.url),'utf8');
  const start=report.indexOf('function reportGenerationRulesIdentity('),end=report.indexOf('function reportFinancialIdentity(',start);
  assert.ok(start>=0&&end>start);
  const ctx={currentProjectId:recovered.projectId,__qaDispatchPaused:true,projectCanEdit:()=>true,rlProjectType:()=> 'gaibao',ReportLogicCore:{current:()=>({version:7})},ReportCompletionContract:{...CompletionContract},ReportBusinessStructure:BusinessStructure,ReportArgument,projectWorkflow:{reportCompletion:{lengthPlan:identityRebind.current.storedPlan}}};
  ctx.window=ctx;vm.createContext(ctx);
  // Evaluate captured values, including undefined members, without lossy JSON.
  const fields=identityRebind.current.fields;
  ctx.semanticInputs=vm.runInContext('({'+Object.keys(fields).sort().map(key=>JSON.stringify(key)+':'+fields[key]).join(',')+'})',ctx);
  vm.runInContext(report.slice(start,end)+"function reportCandidateInputIdentity(){return 'candidate-input-v1:'+ReportCompletionContract.fingerprint({...semanticInputs,generationRules:reportGenerationRulesIdentity()});}",ctx);
  const current=vm.runInContext('('+browserCaptureTax94IdentityInputs.toString()+')()',ctx);
  assert.equal(JSON.parse(current.fields.generationRules).basisStructure,currentBasisVersion);
  assert.notEqual(current.fields.generationRules,identityRebind.current.fields.generationRules);
  assert.deepEqual(Object.keys(fields).filter(key=>fields[key]!==current.fields[key]),['generationRules']);
  const changed={...identityRebind,current,freshPrepared:{...identityRebind.freshPrepared,sourceIdentity:current.sourceIdentity}};
  assert.throws(()=>createTax94IdentityRebindProposal(recovered,changed),/Semantic input differs from the exact audited new loaded baseline/);
});

test('every actual semantic input is exact, including undefined fields, directory, plan target and confirmations',async()=>{
  const {recovered,identityRebind}=await rebindFixture();
  for(const key of Object.keys(identityRebind.current.fields)){
    const changed=structuredClone(identityRebind);changed.current.fields[key]+=' ';recomputeCaptureIdentity(changed.current);changed.freshPrepared.sourceIdentity=changed.current.sourceIdentity;
    assert.throws(()=>createTax94IdentityRebindProposal(recovered,changed),undefined,'Changed semantic field '+key+' must remain blocked');
  }
  for(const mutate of [
    c=>{const d=JSON.parse(c.fields.directory);d[0].sections.push({title:'新增',checked:true,numeric:false});c.fields.directory=JSON.stringify(d);},
    c=>{const d=JSON.parse(c.fields.directory);d[0].sections.pop();c.fields.directory=JSON.stringify(d);},
    c=>{const d=JSON.parse(c.fields.directory);d.reverse();c.fields.directory=JSON.stringify(d);},
    c=>c.storedPlan.proseTotal++,c=>c.storedPlan.targetPages++,c=>c.storedPlan.sections[0].target++,c=>c.storedPlan.sections[0].weight++,c=>c.storedPlan.sections[0].basis=!c.storedPlan.sections[0].basis,c=>c.storedPlan.confirmedAt='2026-10-12T03:00:00Z',c=>c.storedPlan.planId='new-plan',
    c=>c.logicLoaded=false,c=>c.logicVersion=0,c=>c.sourceIdentity='candidate-input-v1:1e19a411'
  ]){const changed=structuredClone(identityRebind);mutate(changed.current);assert.throws(()=>createTax94IdentityRebindProposal(recovered,changed));}
});

test('explicit rebind never weakens financial/table, old five SHA, actual section/task or formal source CAS',async()=>{
  const {recovered,identityRebind,observed}=await rebindFixture();
  for(const mutate of [
    r=>r.freshPrepared.financialBinding.sourceSignature+='changed',r=>r.freshPrepared.financialBinding.snapshotId='other',r=>r.freshPrepared.financialBinding.snapshotVersion++,r=>r.freshPrepared.programCells[1][2]='15.1',r=>r.freshPrepared.programTableHtml+=' ',r=>r.freshPrepared.oldCandidate+=' ',r=>r.freshPrepared.originalSection.executionTask={id:'forged'},r=>r.freshPrepared.originalSection.content='adopted',r=>r.freshPrepared.originalSection.pendingRevision.after+='changed',r=>r.baseline.numericChanges[0].after=false,r=>r.baseline.codeSha256['report.js']='changed',r=>r.proposal.exactDifferences.pop(),r=>r.proposal.cas.executionTaskSha256='changed',r=>r.proposal.newSourceIdentity='other'
  ]){const changed=structuredClone(identityRebind);mutate(changed);assert.throws(()=>assertTax94IdentityRebindProposal(recovered,changed));}
  for(const key of ['execute','before','raw','intent','consumption']){const changed=structuredClone(recovered);changed.evidence[key].sha256='changed';assert.throws(()=>createTax94IdentityRebindProposal(changed,identityRebind));}
  for(const mutate of [o=>o.sourceUnchanged.tax=false,o=>o.sourceUnchanged.longgang=false,o=>o.currentSection.executionTask={id:'new'},o=>o.currentSection.editedHtml='adopted',o=>o.currentSection.pendingRevision.after+='new',o=>o.originalTask.status='running',o=>o.originalTask.runId='other',o=>o.originalTask.text+='other',o=>o.originalTask.usage.status='unknown',o=>o.financialSourceSignature+='changed',o=>o.sourceIdentity+='changed']){const changed=structuredClone(observed);mutate(changed);assert.throws(()=>assertTax94PaidRecoveryCas(recovered,changed));}
});
