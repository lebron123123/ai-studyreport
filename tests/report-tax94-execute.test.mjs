import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {applyTax94Analyses} from '../scripts/report-tax94-recovery.mjs';
import {TAX94_RECOVERY as policy} from '../scripts/report-tax94-recovery.mjs';
import {parseTax94Args,validateTax94Proposal,claimTax94Request,browserSaveTax94Candidate,canonicalTax94,runTax94Action,correctTax94ScenarioWording,prepareTax94RetainedIdentity} from '../scripts/report-tax94-execute.mjs';
import {loadTax94PaidEvidence,recoverTax94PaidProtocol,loadTax94IdentityRebindBaseline} from '../scripts/report-tax94-paid-protocol-recovery.mjs';
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
const require=createRequire(import.meta.url),RealWorkflow=require('../project-workflow.js');
const proposalFile=new URL('../outputs/report-standardization/1010-full-generation-2026-10-10T02-04-51-303Z-3378c9e5/generation-runner/tax/recovery/tax-9.4-reconciliation-proposal-20261012T022649Z.json',import.meta.url);
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
test('explicit flags only; no-mode and proposal-only are inert, including nonexistent proposal',async()=>{
  assert.equal(parseTax94Args([]).execute,false);assert.equal(parseTax94Args(['--proposal','nonexistent']).execute,false);
  assert.deepEqual(await runTax94Action({proposal:'nonexistent',execute:false}),{projectWrites:0,newPaidAiCalls:0});
  for(const args of [['--execute'],['--proposal','x','--bounded','tax:9.4'],['--proposal','x','--execute','--execute'],['--base-url','https://example.com'],['--base-url','http://localhost:8080/api/generate']])assert.throws(()=>parseTax94Args(args));
  assert.equal(parseTax94Args(['--proposal','x','--execute']).execute,true);
  assert.equal(parseTax94Args(['--save-retained']).saveRetained,true);
  for(const args of [['--save-retained','--execute','--proposal','x'],['--save-retained','--proposal','x'],['--save-retained','--save-retained']])assert.throws(()=>parseTax94Args(args));
});

test('retained semantic correction changes only two exact scenario sentences and preserves every other byte',async()=>{
  const recovered=await recoverTax94PaidProtocol(await loadTax94PaidEvidence()),edited=correctTax94ScenarioWording(recovered.after);
  assert.equal(edited.beforeSha256,recovered.afterSha256);assert.equal(edited.afterSha256,sha(edited.after));assert.equal(edited.edits.length,2);
  let reversed=edited.after;for(const edit of edited.edits){assert.equal(reversed.split(edit.after).length,2);reversed=reversed.replace(edit.after,edit.before);}
  assert.equal(reversed,recovered.after);assert.match(edited.after,/不代表标准化敏感系数排序/);assert.match(edited.after,/不据此排列各因素的标准化敏感程度/);
  const tables=html=>html.match(/<table\b[\s\S]*?<\/table>/g),heads=html=>html.match(/<h[1-6]\b[\s\S]*?<\/h[1-6]>/g);
  assert.deepEqual(tables(edited.after),tables(recovered.after));assert.deepEqual(heads(edited.after),heads(recovered.after));assert.ok(edited.after.includes(policy.gapStatement));
  assert.throws(()=>correctTax94ScenarioWording(edited.after),/missing or repeated/);assert.throws(()=>correctTax94ScenarioWording(recovered.after+edited.edits[0].before),/missing or repeated/);
});
test('fresh import cannot activate legacy inspector main branches and restores caller argv',()=>{
  const url=new URL('../scripts/report-tax94-execute.mjs',import.meta.url).href;
  const result=spawnSync(process.execPath,['--input-type=module','-e','process.argv=[process.execPath,"import-only","--run"]; await import('+JSON.stringify(url)+'); if(process.argv[2]!=="--run") throw Error("argv changed"); console.log("inert import");'],{encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'inert import');
});
test('proposal is restricted to exact test copy, old terminal response and canonical frozen source',async()=>{
  const proposal=JSON.parse(await fs.readFile(proposalFile));assert.equal(validateTax94Proposal(proposal),true);
  for(const mutate of [p=>p.target.projectId='formal',p=>p.oldTask.getStatus='running',p=>p.oldTask.rawTextSha256='changed',p=>p.currentSection.requiredHeadings.reverse(),p=>p.legacyBoundedAttempt.planCounts.paragraphs=1,p=>p.legacyBoundedAttempt.resumePaidIntentExists=true,p=>p.adoptedCalculation.financialSourceSignatureSha256='changed',p=>p.minimalReconciliation.unresolvedGap.statement='verified']){const bad=clone(proposal);mutate(bad);assert.throws(()=>validateTax94Proposal(bad));}
});
test('single exact scoped POST consumes its in-memory arm; unknown outcome cannot re-arm/retry',()=>{
  const req=request(),state={armed:true,submitted:false};assert.equal(claimTax94Request(state,req,req.expected),true);assert.deepEqual(state,{armed:false,submitted:true});
  assert.throws(()=>claimTax94Request(state,req,req.expected),/never retry/);state.armed=true;assert.throws(()=>claimTax94Request(state,req,req.expected),/never retry/);
  for(const mutate of [r=>r.url='http://localhost:8080/api/reportexecution',r=>r.url='https://example.com/api/generate',r=>r.method='GET',r=>r.body+=' ']){const bad={...req};mutate(bad);const untouched={armed:true,submitted:false};assert.throws(()=>claimTax94Request(untouched,bad,req.expected));assert.equal(untouched.submitted,false);}
  const badBody=JSON.parse(req.body);badBody.projectId='another-project';const bad={...req,body:JSON.stringify(badBody)};assert.throws(()=>claimTax94Request({armed:true,submitted:false},bad,{...req.expected,requestSha256:sha(bad.body)}));
});
test('candidate save preserves actual body and original task, keeps old candidate history and never auto-adopts',async()=>{
  const page=fakePage(),result=await page.invoke(page.args);assert.equal(result.notAccepted,true);assert.equal(result.status,'semantic-review-pending');assert.equal(page.section.content,'');assert.equal(page.section.editedHtml,null);assert.deepEqual(page.section.executionTask,page.original.executionTask);assert.equal(page.section.pendingRevision.after,page.args.text);assert.equal(page.section.pendingRevision.history[0].id,'old-candidate');assert.equal(page.section.pendingRevision.qaTax94Recovery.factsVerified,false);assert.equal(page.calls.persist,1);assert.equal(page.calls.replace,1);
});
test('technical failures remain candidates; identity/source/CAS failure performs no save',async()=>{
  const blocked=fakePage({errors:[{severity:'error',code:'heading-analysis-missing'}]}),result=await blocked.invoke(blocked.args);assert.equal(result.status,'technical-review-blocked');assert.equal(blocked.section.content,'');assert.equal(blocked.section.pendingRevision.qaTax94Recovery.technicalPassed,false);
  for(const mutate of [p=>p.sandbox.currentProjectId='foreign',p=>p.sandbox.window.__qaDispatchPaused=false,p=>p.sandbox.reportCandidateInputIdentity=()=> 'changed',p=>p.section.pendingRevision.after+='concurrent change']){const page=fakePage();mutate(page);await assert.rejects(page.invoke(page.args),/changed/);assert.equal(page.calls.replace,0);assert.equal(page.calls.persist,0);}
  const lost=fakePage({saved:false});await assert.rejects(lost.invoke(lost.args),/uncertain.*prohibits resubmission/);assert.equal(lost.section.content,'');assert.equal(lost.calls.persist,1);
});
test('real ProjectWorkflow replacement changes only pendingRevision; null original receipt stays null',async()=>{
  for(const task of [null,{id:policy.taskId,runId:policy.runId,immutable:'old evidence'}]){
    const page=fakePage();page.section.executionTask=clone(task);page.args.prep.originalSection=clone(page.section);page.sandbox.ProjectWorkflow=RealWorkflow;
    const before=clone(page.sandbox.chapters),result=await page.invoke(page.args),after=clone(page.sandbox.chapters);
    assert.equal(result.notAccepted,true);assert.deepEqual(page.section.executionTask,task);assert.equal(page.section.pendingRevision.history[0].id,'old-candidate');
    before[8].sections[3].pendingRevision=null;after[8].sections[3].pendingRevision=null;
    assert.deepEqual(canonicalTax94(before),canonicalTax94(after));assert.equal(page.calls.persist,1);
  }
});
test('invalid slot count/numeric AI output is rejected before the candidate-save stage',()=>{
  const prepared={seedHtml:'seed',seedSha256:sha('seed'),plan:{paragraphs:[{id:'a'},{id:'b'},{id:'c'}]}};
  let saveCalls=0;
  const saveAfterValidation=response=>{applyTax94Analyses(prepared,response);saveCalls++;};
  const validProse='当前仅能根据已测情景说明变化方向与经营风险，尚未形成盈亏平衡临界点的独立求解结果，不能把情景净现值为正等同于所有条件均可承受。后续需要按同一测算口径核验临界条件并保留资料待核验边界。';
  for(const replacements of [[{id:'a',text:validProse}],[{id:'a',text:validProse+'虚构出租率42%。'},{id:'b',text:validProse},{id:'c',text:validProse}]])assert.throws(()=>saveAfterValidation({replacements,additions:[],tables:[]}));
  assert.equal(saveCalls,0);
});
test('full-state comparison only normalizes object-key order, never bodies, array order or absent fields',()=>{
  assert.deepEqual(canonicalTax94({b:2,a:{d:4,c:3}}),canonicalTax94({a:{c:3,d:4},b:2}));assert.notDeepEqual(canonicalTax94({a:['one','two']}),canonicalTax94({a:['two','one']}));assert.notDeepEqual(canonicalTax94({content:' x '}),canonicalTax94({content:'x'}));assert.notDeepEqual(canonicalTax94({a:null}),canonicalTax94({}));
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
