import '../../scripts/windows-browser-lockout-guard.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {applyTax94Analyses} from '../../scripts/report-tax94-recovery.mjs';
import {TAX94_RECOVERY as policy} from '../../scripts/report-tax94-recovery.mjs';
import {parseTax94Args,validateTax94Proposal,claimTax94Request,browserSaveTax94Candidate,canonicalTax94,runTax94Action,correctTax94ScenarioWording,prepareTax94RetainedIdentity} from '../../scripts/report-tax94-execute.mjs';
import {loadTax94PaidEvidence,recoverTax94PaidProtocol,loadTax94IdentityRebindBaseline} from '../../scripts/report-tax94-paid-protocol-recovery.mjs';
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
const require=createRequire(import.meta.url),RealWorkflow=require('../../project-workflow.js');
const proposalFile=new URL('../../outputs/report-standardization/1010-full-generation-2026-10-10T02-04-51-303Z-3378c9e5/generation-runner/tax/recovery/tax-9.4-reconciliation-proposal-20261012T022649Z.json',import.meta.url);
function request(){
  const prompt={section:'9.4',financialSourceSignatureSha256:policy.financialSourceSha256,targets:{paragraphs:[{id:'a'},{id:'b'},{id:'c'}],headings:[],tables:[]}};
  const body=JSON.stringify({projectId:policy.projectId,kind:'batch',stream:false,messages:[{role:'user',content:JSON.stringify(prompt)}]});
  return {body,url:'http://localhost:8080/api/generate',method:'POST',expected:{origin:'http://localhost:8080',requestSha256:sha(body)}};
}
function fakePage({changed=false,errors=[],saved=true}={}){
  const original={t:'不确定性分析',content:'',editedHtml:null,executionTask:{id:policy.taskId,runId:policy.runId,immutable:'old evidence'},pendingRevision:{id:'old-candidate',after:'old malformed table',before:''}};
  const section=clone(original),chapters=Array.from({length:9},()=>({name:'unused',sections:[]}));chapters[8]={name:'财务评价',sections:[{},{},{},section]};
  const calls={persist:0,replace:0},sandbox={currentProjectId:changed?'foreign':policy.projectId,window:{__qaDispatchPaused:true,ReportOutputPolicy:{contentVersion:'test'}},projectCanEdit:()=>true,reportCandidateInputIdentity:()=> 'frozen-input',chapters,
    reportCompletionPlan:()=>({sections:[{sectionKey:policy.sectionKey,requiredTables:[]}]}),reportCompletionEntries:({html})=>[{key:policy.sectionKey,text:html}],
    ReportCompletionContract:{bindDocumentReferences:async contract=>contract,bindFrozenTables:async contract=>contract,bindProgramProse:async contract=>contract,inspect:()=>({status:errors.length?'blocked':'passed',issues:clone(errors)}),reviewDocument:()=>({reviews:[]})},
    reportFinancialCandidateIssues:()=>[],ProjectWorkflow:{candidateToken:c=>({id:c.id}),replaceCandidate:(s,text,instruction,meta,token)=>{calls.replace++;assert.equal(token.id,s.pendingRevision.id);s.pendingRevision={id:'new-candidate',before:s.content,after:text,...clone(meta),history:[clone(s.pendingRevision)]};return s.pendingRevision;}},
    persistReportDraft:async()=>{calls.persist++;return {ok:saved,remote:saved};}};
  const invoke=vm.runInNewContext('('+browserSaveTax94Candidate.toString()+')',sandbox);
  return {original,section,calls,sandbox,invoke,args:{policy,prep:{sourceIdentity:'frozen-input',originalSection:clone(original),financialBinding:{snapshotId:policy.snapshotId}},text:'<h3>仅候选</h3><p>独立回包</p>',proof:{afterSha256:'bound-sha',oldTaskId:policy.taskId,newPaidAiCalls:1}}};
}

// Offline replay of private, pinned historical evidence; no AI requests.
test('retained semantic correction changes only two exact scenario sentences and preserves every other byte',async()=>{
  const recovered=await recoverTax94PaidProtocol(await loadTax94PaidEvidence()),edited=correctTax94ScenarioWording(recovered.after);
  assert.equal(edited.beforeSha256,recovered.afterSha256);assert.equal(edited.afterSha256,sha(edited.after));assert.equal(edited.edits.length,2);
  let reversed=edited.after;for(const edit of edited.edits){assert.equal(reversed.split(edit.after).length,2);reversed=reversed.replace(edit.after,edit.before);}
  assert.equal(reversed,recovered.after);assert.match(edited.after,/不代表标准化敏感系数排序/);assert.match(edited.after,/不据此排列各因素的标准化敏感程度/);
  const tables=html=>html.match(/<table\b[\s\S]*?<\/table>/g),heads=html=>html.match(/<h[1-6]\b[\s\S]*?<\/h[1-6]>/g);
  assert.deepEqual(tables(edited.after),tables(recovered.after));assert.deepEqual(heads(edited.after),heads(recovered.after));assert.ok(edited.after.includes(policy.gapStatement));
  assert.throws(()=>correctTax94ScenarioWording(edited.after),/missing or repeated/);assert.throws(()=>correctTax94ScenarioWording(recovered.after+edited.edits[0].before),/missing or repeated/);
});

test('proposal is restricted to exact test copy, old terminal response and canonical frozen source',async()=>{
  const proposal=JSON.parse(await fs.readFile(proposalFile));assert.equal(validateTax94Proposal(proposal),true);
  for(const mutate of [p=>p.target.projectId='formal',p=>p.oldTask.getStatus='running',p=>p.oldTask.rawTextSha256='changed',p=>p.currentSection.requiredHeadings.reverse(),p=>p.legacyBoundedAttempt.planCounts.paragraphs=1,p=>p.legacyBoundedAttempt.resumePaidIntentExists=true,p=>p.adoptedCalculation.financialSourceSignatureSha256='changed',p=>p.minimalReconciliation.unresolvedGap.statement='verified']){const bad=clone(proposal);mutate(bad);assert.throws(()=>validateTax94Proposal(bad));}
});

test('retained controller awaits published rules before preparation/capture, rejects changed complete inputs and never saves',async()=>{
  const recovered=await recoverTax94PaidProtocol(await loadTax94PaidEvidence()),baseline=await loadTax94IdentityRebindBaseline(recovered);
  for(const changed of [false,true]){
    const calls=[],fresh={...clone(recovered.prepared),sourceIdentity:baseline.expected.sourceIdentity},capture=clone(baseline.expected);
    if(changed)capture.fields.project+='changed';
    const page={evaluate:async(fn,args)=>{
      if(fn.name==='browserPrepareTax94Analysis'){assert.deepEqual(calls,['rules-loaded']);calls.push('prepared');assert.equal(args.projectId,policy.projectId);return fresh;}
      if(fn.name==='browserCaptureTax94IdentityInputs'){assert.deepEqual(calls,['rules-loaded','prepared']);calls.push('captured');return capture;}
      const context={currentProjectId:policy.projectId,window:{__qaDispatchPaused:true},projectCanEdit:()=>true,rlProjectType:()=> 'gaibao',ReportLogicCore:{load:async(type,force)=>{assert.equal(type,'gaibao');assert.equal(force,true);await Promise.resolve();calls.push('rules-loaded');}}};
      return vm.runInNewContext('('+fn.toString()+')()',context);
    }};
    if(changed)await assert.rejects(prepareTax94RetainedIdentity({page},recovered),/identity|input/i);
    else {const result=await prepareTax94RetainedIdentity({page},recovered);assert.equal(result.fresh,fresh);assert.equal(result.identityRebind.proposal.newSourceIdentity,baseline.expected.sourceIdentity);assert.equal(result.identityRebind.proposal.newPaidAiCalls,0);assert.equal(result.identityRebind.proposal.projectWrites,0);}
    assert.deepEqual(calls,['rules-loaded','prepared','captured']);
  }
});
