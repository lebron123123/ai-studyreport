// Offline-only recovery of one already-paid response. Import/default CLI are inert.
// No network, project save, adoption, paid retry, or artifact write is implemented.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import vm from 'node:vm';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const OUT=path.join(ROOT,'outputs/report-standardization/1010-full-generation-2026-10-10T02-04-51-303Z-3378c9e5/generation-runner');
const RUN='2026-10-12T02-56-35-438Z-b98c809f';
const sha=value=>crypto.createHash('sha256').update(Buffer.isBuffer(value)?value:typeof value==='string'?value:JSON.stringify(value??null)).digest('hex');
const assert=(condition,message)=>{if(!condition)throw Error(message);};
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const canonicalSha=value=>sha(canonical(value));
const require=createRequire(import.meta.url);
// Lossless production fingerprint text: undefined object members must not be
// discarded by JSON transport. Each semantic top-level field is a text value.
const identityText=value=>value&&typeof value==='object'?Array.isArray(value)?'['+value.map(identityText).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+identityText(value[key])).join(',')+'}':JSON.stringify(value);
const semantic=value=>Array.isArray(value)?value.map(semantic):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>!['updatedAt','createdAt','savedAt','changedAt','confirmedAt','generatedAt','lastSavedAt','lastUpdatedAt','at','audit','history'].includes(key)).map(([key,item])=>[key,semantic(item)])):value;
const IDENTITY_REBIND=Object.freeze({
  projectId:'f4395f64-af1b-43bd-b809-580b5ec9406b',
  remoteFile:'tax94-remote-backup-'+RUN+'-tax.json',remoteSha256:'6633d9eb577e02ab3fd1d2cd466711abff9ed5f2b33492e549abd47dcf04bd63',
  configSha256:'42931ab2bd5063ff755dd204532cb5e7e04a815e69185ffd51c34c1f08434efd',
  oldIdentity:'candidate-input-v1:92bafbe2',newIdentity:'candidate-input-v1:6d80736d',
  oldFieldsSha256:'c0d29c2e7ffe42276f6ce037dc1856bd14d6980f0acba86301fb2c2ce0a4ba8f',
  newFieldsSha256:'2471525ab6bfcfc307939f2040d74263127e3a2da0d9a33683ccf2508d341f3e',
  historicalBasisStructure:'business-structure-basis-v3',
  storedPlanSha256:'95d3a7d7226d77c1d37ed3ebabcdfd4d32320c214c5989e0bbf61ecdca3e5a1c'
});
export const TAX94_PAID_EVIDENCE=Object.freeze({
  execute:Object.freeze({file:'tax94-execute-'+RUN+'.json',sha256:'4e6db2d21ec771000f01b66b19b409b793b2d312ec6b3bd5d8d81786bd0897de'}),
  before:Object.freeze({file:'tax/recovery/tax94-before-'+RUN+'.json',sha256:'aa2d077fdec6d22b24d3eb472c1d8362b7d61215fddfd4af6ca5a2556ee0a6da'}),
  raw:Object.freeze({file:'tax/recovery/tax94-raw-'+RUN+'.json',sha256:'e355bc2d4971348bfe1ccb9d3071ad7ca70cfb764732aca87c532ab3ea16a93d'}),
  intent:Object.freeze({file:'resume-paid-intent-tax-9.4.json',sha256:'923537d6c940df8700d0762e257208f780d6395e036b83656e643e8d3bb17bac'}),
  consumption:Object.freeze({file:'tax/recovery/tax94-reconciliation-consumed-b6cabcb462b17396eb4ac3c0c044249c21b57a1770879335fb216d4b97865c88.json',sha256:'a4fbef860d349a432919173ddabf7bd19e8deffc7050967b5b761e2047390f2a'})
});

// Only this exact metadata error is recoverable. Nested/other unknown keys are
// left to the existing bounded editor, which continues to reject them.
export function stripTax94KnownMetadata(response){
  assert(response&&typeof response==='object'&&!Array.isArray(response),'Expected response object');
  const keys=Object.keys(response);
  assert(keys.length===4&&keys.every(key=>['type','replacements','additions','tables'].includes(key))&&Object.hasOwn(response,'type')&&response.type==='json_object','Only exact type=json_object metadata may be removed');
  const normalized=structuredClone(response);delete normalized.type;
  return {response:normalized,normalizations:[{kind:'known-top-level-metadata-removal',pointer:'/type',value:'json_object'}]};
}

export async function loadTax94PaidEvidence(){
  return Object.fromEntries(await Promise.all(Object.entries(TAX94_PAID_EVIDENCE).map(async([key,entry])=>[key,await fs.readFile(path.join(OUT,entry.file))])));
}

// Delayed import avoids the legacy editor's argv-based CLI on import/default run.
// An explicit recovery call also refuses legacy command-line dispatch switches.
async function recoveryTools(){
  assert(!['--run','--recover-paid'].includes(process.argv[2]),'Legacy dispatch argv is forbidden during offline recovery');
  return import('./report-tax94-recovery.mjs');
}

export async function recoverTax94PaidProtocol(evidence){
  const records={};
  for(const [key,entry]of Object.entries(TAX94_PAID_EVIDENCE)){
    assert(Buffer.isBuffer(evidence?.[key])&&sha(evidence[key])===entry.sha256,'Pinned '+key+' evidence SHA changed');
    records[key]=JSON.parse(evidence[key]);
  }
  const {TAX94_RECOVERY:p,prepareTax94Slots,tax94AnalysisRequest,applyTax94Analyses,tax94ConsumptionPath}=await recoveryTools();
  const {execute,before,raw,intent,consumption}=records;
  assert([execute,before,raw,intent,consumption].every(value=>value.runId===RUN),'Paid run identity changed');
  assert(execute.key===p.key&&execute.newPaidAiCalls===1&&execute.notAccepted===true&&execute.checkpointNotModified===true&&execute.ok===false&&execute.error==='Unknown response field'&&!execute.after&&!execute.uncertainRequest,'Exact retained paid protocol failure required');
  for(const key of ['before','raw','intent','consumption'])assert(execute[key]?.sha256===TAX94_PAID_EVIDENCE[key].sha256&&path.resolve(execute[key].file)===path.join(OUT,TAX94_PAID_EVIDENCE[key].file),'Execution evidence link changed: '+key);
  assert(intent.version==='tax94-one-shot-intent-v1'&&intent.key===p.key&&intent.projectId===p.projectId&&intent.path==='/api/generate'&&intent.oldTaskId===p.taskId&&intent.oldRunId===p.runId&&intent.automaticRetryForbidden===true,'Paid intent identity changed');
  assert(intent.before.sha256===TAX94_PAID_EVIDENCE.before.sha256&&intent.consumption.sha256===TAX94_PAID_EVIDENCE.consumption.sha256&&consumption.before.sha256===TAX94_PAID_EVIDENCE.before.sha256&&consumption.automaticRetryForbidden===true&&consumption.notAnAfterReceipt===true,'Consumption chain changed');
  assert(canonicalSha(before.declaration)===canonicalSha(consumption.declaration)&&path.resolve(tax94ConsumptionPath(path.join(OUT,'tax/recovery'),before.declaration))===path.join(OUT,TAX94_PAID_EVIDENCE.consumption.file),'Consumed declaration changed');
  const prepared=prepareTax94Slots(before.prepared);
  assert(prepared.seedHtml===before.prepared.seedHtml&&prepared.seedSha256===before.prepared.seedSha256&&canonicalSha(prepared.plan)===canonicalSha(before.prepared.plan),'Prepared slot bytes changed');
  assert(canonicalSha(before.originalExecutionTask??null)===canonicalSha(prepared.originalSection.executionTask??null),'Original task receipt changed');
  const request=JSON.parse(intent.requestBody),prompt=JSON.parse(request.messages?.[0]?.content||'null');
  assert(sha(intent.requestBody)===intent.requestSha256&&intent.requestSha256===raw.requestSha256&&request.projectId===p.projectId&&request.kind==='batch'&&request.stream===false&&request.messages.length===1&&request.messages[0].role==='user'&&canonicalSha(prompt)===canonicalSha(tax94AnalysisRequest(prepared)),'Retained request/slot identity changed');
  assert(raw.httpStatus===200&&path.resolve(raw.intentFile)===path.join(OUT,TAX94_PAID_EVIDENCE.intent.file)&&path.resolve(raw.consumptionFile)===path.join(OUT,TAX94_PAID_EVIDENCE.consumption.file),'Retained raw response is not the consumed request');
  const body=Buffer.from(raw.bodyBase64,'base64');assert(body.toString('base64')===raw.bodyBase64&&sha(body)===raw.bodySha256,'Raw body SHA/base64 changed');
  const payload=JSON.parse(body),parts=payload.content;
  assert(Array.isArray(parts)&&parts.length===1&&parts[0].type==='text'&&typeof parts[0].text==='string'&&(!payload.tool_calls||Array.isArray(payload.tool_calls)&&!payload.tool_calls.length),'Exactly one retained text response without tool calls required');
  const normalized=stripTax94KnownMetadata(JSON.parse(parts[0].text)),edited=applyTax94Analyses(prepared,normalized.response);
  return {
    version:'tax94-paid-protocol-recovery-v1',runId:RUN,key:p.key,projectId:p.projectId,
    oldTaskId:p.taskId,oldRunId:p.runId,oldInputHash:p.inputHash,
    ...edited,normalizations:normalized.normalizations,
    evidence:Object.fromEntries(Object.entries(TAX94_PAID_EVIDENCE).map(([key,entry])=>[key,{file:path.join(OUT,entry.file),sha256:entry.sha256,pointer:key==='before'?'/prepared':key==='raw'?'/bodyBase64':''}])),
    decodedRawBodySha256:raw.bodySha256,rawResponseTextSha256:sha(parts[0].text),
    originalPaidAiCalls:1,newPaidAiCalls:0,projectWrites:0,checkpointNotModified:true,
    notOriginalAiReceipt:true,notAccepted:true,semanticReviewRequired:true,factsVerified:false,
    prepared,
    cas:{projectId:p.projectId,key:p.key,currentSectionCanonicalSha256:canonicalSha(prepared.originalSection),actualBodySha256:sha(prepared.originalSection.editedHtml||prepared.originalSection.content||''),pendingRevisionSha256:canonicalSha(prepared.originalSection.pendingRevision??null),candidateSha256:sha(prepared.oldCandidate),executionTaskSha256:canonicalSha(prepared.originalSection.executionTask??null),sourceIdentity:prepared.sourceIdentity,financialSourceSignatureSha256:p.financialSourceSha256},
    semanticFindings:[
      {id:'scenario-amplitude-not-normalized',status:'review-required',slots:['tax94-analysis-0','tax94-analysis-2'],finding:'表中因素扰动幅度不一致；敏感程度措辞只能表示给定情景下指标变化，不能比较标准化敏感系数。'},
      {id:'gap-limitation-paraphrase',status:'review-required',slots:['tax94-analysis-2'],finding:'第三段语义重述独立待核验限定；协议恢复不删除或改写该段。'}
    ]
  };
}

// page.evaluate entry; call only AFTER awaiting ReportLogicCore.load(rlProjectType()).
// The synchronous fingerprint tap is always restored before returning/throwing.
// No AI, project/storage write, or durable global change is made.
export function browserCaptureTax94IdentityInputs(){
  if(currentProjectId!=='f4395f64-af1b-43bd-b809-580b5ec9406b'||window.__qaDispatchPaused!==true||!projectCanEdit())throw Error('Exact paused editable Tax copy required for identity capture');
  const set=ReportLogicCore.current(rlProjectType());
  if(!set||set.version!==7)throw Error('Await the published v7 logic load before identity capture');
  const stable=value=>value&&typeof value==='object'?Array.isArray(value)?'['+value.map(stable).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}':JSON.stringify(value);
  const original=ReportCompletionContract.fingerprint;let fields,sourceIdentity;
  try{
    ReportCompletionContract.fingerprint=value=>{
      if(value?.generationRules&&value?.directory&&value?.logic){if(fields)throw Error('Ambiguous candidate identity capture');fields=Object.fromEntries(Object.keys(value).sort().map(key=>[key,String(stable(value[key]))]));}
      return original(value);
    };
    sourceIdentity=reportCandidateInputIdentity();
  }finally{ReportCompletionContract.fingerprint=original;}
  if(!fields||reportCandidateInputIdentity()!==sourceIdentity)throw Error('Candidate inputs changed during identity capture');
  return {version:'tax94-identity-input-capture-v1',projectId:currentProjectId,key:'tax:9.4',logicLoaded:true,logicVersion:set.version,sourceIdentity,fields,storedPlan:JSON.parse(JSON.stringify(projectWorkflow.reportCompletion.lengthPlan))};
}

function checkIdentityCapture(capture,mode){
  const p=IDENTITY_REBIND,fields=capture?.fields;
  assert(capture?.version==='tax94-identity-input-capture-v1'&&capture.projectId===p.projectId&&capture.key==='tax:9.4'&&capture.logicLoaded===true&&capture.logicVersion===7&&fields&&Object.values(fields).every(value=>typeof value==='string'),'Loaded semantic input capture required');
  const text='{'+Object.keys(fields).sort().map(key=>JSON.stringify(key)+':'+fields[key]).join(',')+'}';let hash=2166136261;
  for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619);
  assert(capture.sourceIdentity==='candidate-input-v1:'+(hash>>>0).toString(16).padStart(8,'0'),'Captured identity does not match complete semantic input');
  assert(capture.sourceIdentity===p[mode+'Identity']&&canonicalSha(fields)===p[mode+'FieldsSha256'],'Semantic input differs from the exact audited '+mode+' loaded baseline');
  assert(sha(identityText(capture.storedPlan))===p.storedPlanSha256,'Saved confirmed plan/confirmation changed');
}

// Independently reconstruct both loaded identities from immutable OLD remote
// inputs and published v7 config. Never infer the old inputs from a fresh draft.
// These filesystem reads/VM executions are offline; the VM fetch is a fixed stub.
export async function loadTax94IdentityRebindBaseline(recovered){
  const p=IDENTITY_REBIND,remoteBytes=await fs.readFile(path.join(OUT,p.remoteFile)),configBytes=await fs.readFile(path.join(OUT,'..','published-config.json'));
  assert(sha(remoteBytes)===p.remoteSha256&&sha(configBytes)===p.configSha256,'Pinned old remote/published logic evidence changed');
  const data=JSON.parse(remoteBytes).project.data,cfg=JSON.parse(configBytes),row=cfg.logic.find(item=>item.project_type==='gaibao');
  assert(data.projectId===p.projectId&&row?.version===7,'Old remote/published logic identity changed');
  const set={version:row.version,data:typeof row.data==='string'?JSON.parse(row.data):row.data};
  const files=['report-writing-standard.js','report-writing-policy.js','report-output-policy.js','report-business-structure.js','report-argument.js','report-logic-core.js','report-gap-registry.js','report-gap-workflow.js','report-length-ui.js','report-financial-tables.js'];
  const sources=Object.fromEntries(await Promise.all([...files,'report.js','report-length-plan.js','report-completion-contract.js'].map(async file=>[file,await fs.readFile(path.join(ROOT,file),'utf8')])));
  const C=require('../report-completion-contract.js'),L=require('../report-length-plan.js'),report=sources['report.js'];
  const part=(start,end)=>{const a=report.indexOf(start),b=report.indexOf(end,a);assert(a>=0&&b>a,'Production identity extraction boundary changed');return report.slice(a,b);};
  async function replay(legacy){
    const input=structuredClone(data),ctx={console,project:input.project,calcParams:input.calcParams,kbEntries:input.kb,chapters:input.chapters,projectWorkflow:input.workflow,currentProjectId:input.projectId,calcResult:JSON.parse(recovered.prepared.financialBinding.sourceSignature).result,projectCanEdit:()=>true,__qaDispatchPaused:true,ReportCompletionContract:{...C},
      ReportLengthPlan:legacy?{...L,validatePlan:(plan,outline)=>outline&&L.createPlan(outline,{targetPages:plan.targetPages,proseTotal:plan.proseTotal,planningPriority:plan.planningPriority,chapterTargets:plan.chapterTargets}).outlineIdentity!==plan.outlineIdentity?{valid:false,errors:[{code:'stale-outline',message:'目录或小节权重已改变，请重新确认篇幅计划'}]}:L.validatePlan(plan,outline)}:L,
      fetch:async()=>({ok:true,json:async()=>({ok:true,set:structuredClone(set)})})};
    ctx.window=ctx;vm.createContext(ctx);
    for(const file of files)vm.runInContext(sources[file],ctx,{filename:file});
    // Replay the historical environment, not today's basis-classification rule.
    // Only this private offline VM uses the audited v3 stamp. Live capture below
    // still reads the actual rules and checkIdentityCapture rejects any upgrade.
    // Both full input SHA pins remain mandatory, including generationRules.
    ctx.ReportBusinessStructure={...ctx.ReportBusinessStructure,BASIS_VERSION:p.historicalBasisStructure};
    await ctx.ReportLogicCore.load('gaibao');
    ctx.rlProjectType=()=> 'gaibao';ctx.rlBusinessScenario=()=>input.project.businessScenario||'housing_conversion';ctx.rlProjectText=()=>[input.project.name,input.project.type,input.project.location,input.project.desc].filter(Boolean).join(' ');
    ctx.airMaterialContext=()=>({businessScenario:ctx.rlBusinessScenario(),location:input.project.location||'',hasKnowledge:input.kb.some(x=>x.source==='rag'||x.source==='knowledge_base'||x.kind==='wiki'),hasWebEvidence:false,hasProviderData:input.kb.some(x=>x.source==='provider'||x.kind==='provider'||x.provider),hasManualMaterial:input.kb.some(x=>x.source==='project_upload'||x.fileName||x.ruleIds?.length),hasCalculation:true,hasDerivedSection:input.chapters.some(c=>c.sections.some(s=>!!(s.content||s.editedHtml))),evidenceByRule:Object.fromEntries([...new Set(input.kb.flatMap(x=>x.ruleIds||[]))].map(id=>[id,input.kb.filter(x=>(x.ruleIds||[]).includes(id)).map(x=>({kind:'all',title:x.title||x.fileName||'项目上传材料',source:'project_upload'}))])),requirementOverrides:{}});
    vm.runInContext(part('function reportGapContext(','function reportLengthReviewHtml(')+part('function reportCompletionFacts(','async function reportConfirmGenerationLength(')+part('function reportFinancialContext(','function reportCompletionEntries('),ctx);
    return vm.runInContext('('+browserCaptureTax94IdentityInputs.toString()+')()',ctx);
  }
  const old=await replay(true),expected=await replay(false);checkIdentityCapture(old,'old');checkIdentityCapture(expected,'new');
  assert(recovered.cas.sourceIdentity===old.sourceIdentity,'Original paid preparation was not the loaded old identity');
  const saved=data.workflow.reportCompletion.lengthPlan,expectedPlan=L.createPlan(data.chapters,{targetPages:saved.targetPages,proseTotal:saved.proseTotal,planningPriority:saved.planningPriority,chapterTargets:saved.chapterTargets});
  assert(L.validatePlan(saved).valid&&L.validatePlan(saved,data.chapters).valid&&expectedPlan.outlineIdentity!==saved.outlineIdentity,'Expected numeric-only compatibility proof absent');
  const numericChanges=expectedPlan.sections.flatMap((section,index)=>section.numeric===saved.sections[index].numeric?[]:[{pointer:'/sections/'+index+'/numeric',before:saved.sections[index].numeric,after:section.numeric}]);
  assert(numericChanges.length===31,'Audited numeric metadata delta changed');
  const baseline={version:'tax94-loaded-identity-baseline-v1',old,expected,numericChanges,evidence:{remote:{file:path.join(OUT,p.remoteFile),sha256:p.remoteSha256},published:{file:path.join(OUT,'..','published-config.json'),sha256:p.configSha256}},codeSha256:Object.fromEntries(Object.entries(sources).map(([file,text])=>[file,sha(text)]))};
  return {...baseline,baselineSha256:canonicalSha(baseline)};
}

// Pure: the caller persists this explicit sidecar with wx and read-back verification.
// Five paid evidence pins, original CAS, table cells, and both complete loaded
// semantic captures are rechecked; no broad identity exception is introduced.
export function createTax94IdentityRebindProposal(recovered,{baseline,current,freshPrepared}={}){
  const p=IDENTITY_REBIND;
  assert(baseline?.version==='tax94-loaded-identity-baseline-v1','Independent loaded baseline required');
  const {baselineSha256,...baselineBody}=baseline;
  assert(baselineSha256===canonicalSha(baselineBody),'Independent baseline proof changed');
  checkIdentityCapture(baseline.old,'old');checkIdentityCapture(baseline.expected,'new');checkIdentityCapture(current,'new');
  assert(canonicalSha(current)===canonicalSha(baseline.expected),'Current complete capture differs from independently replayed inputs');
  assert(baseline.evidence?.remote?.sha256===p.remoteSha256&&baseline.evidence?.published?.sha256===p.configSha256&&baseline.numericChanges?.length===31,'Pinned baseline proof changed');
  for(const [key,entry]of Object.entries(TAX94_PAID_EVIDENCE))assert(recovered.evidence?.[key]?.sha256===entry.sha256&&path.resolve(recovered.evidence[key].file)===path.join(OUT,entry.file),'Paid evidence binding changed: '+key);
  assert(recovered.cas.sourceIdentity===p.oldIdentity&&freshPrepared?.sourceIdentity===current.sourceIdentity&&freshPrepared.projectId===recovered.projectId&&freshPrepared.notWritten===true&&freshPrepared.newPaidAiCalls===0,'Fresh preparation/source binding changed');
  assert(canonicalSha(freshPrepared.originalSection)===recovered.cas.currentSectionCanonicalSha256&&canonicalSha(freshPrepared.originalSection)===canonicalSha(recovered.prepared.originalSection),'Original section/body/pending/task changed');
  for(const key of ['oldCandidate','financialBinding','programTableHtml','programCells','programTableSha256'])assert(canonicalSha(freshPrepared[key])===canonicalSha(recovered.prepared[key]),'Financial snapshot/table/candidate changed: '+key);
  assert(sha(freshPrepared.financialBinding.sourceSignature)===recovered.cas.financialSourceSignatureSha256&&sha(freshPrepared.programTableHtml)===freshPrepared.programTableSha256,'Financial/table SHA mismatch');
  const changed=Object.keys(baseline.old.fields).filter(key=>baseline.old.fields[key]!==current.fields[key]);
  assert(JSON.stringify(changed)===JSON.stringify(['lengthPlan','lengthPlanStatus']),'Only the two audited derived plan fields may change');
  const oldStatus=JSON.parse(baseline.old.fields.lengthPlanStatus),newStatus=JSON.parse(current.fields.lengthPlanStatus),saved=semantic(current.storedPlan);
  assert(oldStatus.status==='stale-confirmed'&&oldStatus.reasons.length===1&&oldStatus.reasons[0].code==='stale-outline'&&newStatus.status==='confirmed'&&newStatus.valid===true&&newStatus.requiresConfirmation===false&&!newStatus.reasons.length&&baseline.old.fields.lengthPlan==='null'&&identityText(saved)===current.fields.lengthPlan&&identityText(saved)===identityText(oldStatus.plan)&&identityText(saved)===identityText(newStatus.plan),'Plan change is not the exact numeric-only compatibility derivation');
  const proposal={version:'tax94-explicit-identity-rebind-v1',key:recovered.key,projectId:recovered.projectId,runId:recovered.runId,oldSourceIdentity:p.oldIdentity,newSourceIdentity:current.sourceIdentity,oldInputFieldsSha256:canonicalSha(baseline.old.fields),newInputFieldsSha256:canonicalSha(current.fields),compareSha256:canonicalSha({old:baseline.old.fields,current:current.fields}),comparisonAlgorithm:'production-fingerprint-canonical-text-preserving-undefined',unchangedFields:Object.keys(current.fields).filter(key=>!changed.includes(key)).map(key=>({pointer:'/'+key,sha256:sha(current.fields[key])})),exactDifferences:changed.map(key=>({pointer:'/'+key,beforeSha256:sha(baseline.old.fields[key]),afterSha256:sha(current.fields[key])})),numericChanges:baseline.numericChanges,storedPlanSha256:p.storedPlanSha256,baselineSha256,baselineEvidence:baseline.evidence,baselineCodeSha256:baseline.codeSha256,paidEvidence:recovered.evidence,cas:recovered.cas,financial:{sourceSignatureSha256:sha(freshPrepared.financialBinding.sourceSignature),snapshotId:freshPrepared.financialBinding.snapshotId,snapshotVersion:freshPrepared.financialBinding.snapshotVersion,programTableSha256:freshPrepared.programTableSha256,programCellsSha256:canonicalSha(freshPrepared.programCells)},newPaidAiCalls:0,projectWrites:0,notOriginalAiReceipt:true,notAccepted:true,semanticReviewRequired:true};
  return {...proposal,proposalSha256:canonicalSha(proposal)};
}

export function assertTax94IdentityRebindProposal(recovered,evidence){
  const {proposal,...inputs}=evidence||{},expected=createTax94IdentityRebindProposal(recovered,inputs);
  assert(canonicalSha(proposal)===canonicalSha(expected),'Explicit identity rebind sidecar changed or incomplete');
  return expected.newSourceIdentity;
}

// A controller must call this with fresh observations immediately before its
// existing candidate-only save path. This function itself remains read-only.
export function assertTax94PaidRecoveryCas(recovered,observed){
  const e=recovered?.cas,s=observed?.currentSection;
  assert(recovered?.version==='tax94-paid-protocol-recovery-v1'&&recovered.newPaidAiCalls===0&&recovered.projectWrites===0&&recovered.notAccepted===true&&sha(recovered.after)===recovered.afterSha256,'Recovered candidate/proof changed');
  assert(observed?.projectId===e.projectId&&observed.key===e.key&&observed.paused===true&&observed.canEdit===true&&s&&!s.locked,'Exact paused editable Tax 9.4 test copy required');
  assert(canonicalSha(s)===e.currentSectionCanonicalSha256&&sha(s.editedHtml||s.content||'')===e.actualBodySha256&&canonicalSha(s.pendingRevision??null)===e.pendingRevisionSha256&&sha(s.pendingRevision?.after||'')===e.candidateSha256&&canonicalSha(s.executionTask??null)===e.executionTaskSha256,'Fresh section/body/candidate/task CAS mismatch');
  const expectedIdentity=observed.identityRebind?assertTax94IdentityRebindProposal(recovered,observed.identityRebind):e.sourceIdentity;
  assert(observed.sourceIdentity===expectedIdentity&&sha(observed.financialSourceSignature||'')===e.financialSourceSignatureSha256&&s.pendingRevision?.completionFinancialSource?.sourceSignature===observed.financialSourceSignature&&observed.sourceUnchanged?.tax===true&&observed.sourceUnchanged?.longgang===true,'Fresh source/financial binding changed or not checked');
  const task=observed.originalTask;
  assert(task?.id===recovered.oldTaskId&&task.runId===recovered.oldRunId&&task.status==='completed'&&task.rulesChanged===false&&task.graph?.find(node=>node.key==='context_snapshot')?.hash===recovered.oldInputHash&&task.usage?.status==='settled'&&sha(task.text||'')===e.candidateSha256,'Fresh original task identity/completion changed');
  return {candidateOnly:true,notAccepted:true,newPaidAiCalls:0,projectWrites:0,originalExecutionTaskPreserved:true,semanticReviewRequired:true};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  console.log(JSON.stringify({status:'inert-offline-helper',newPaidAiCalls:0,projectWrites:0,usage:'Import and explicitly call loadTax94PaidEvidence/recoverTax94PaidProtocol; no execute or save mode exists.'}));
}
