// Explicit one-shot recovery of the retained Tax 9.4 test copy. Import is inert.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {loadSnapshots,loadIsolation,openProductionHarness,checkSourceUnchanged} from './report-generation-acceptance.mjs';
// The preparation helper imports a legacy module with argv-based inspector CLI
// branches. Suppress only those branches while loading it; importing us is inert
// even when another caller happens to use a legacy --run argument.
const recoveryTools=await (async()=>{const previous=process.argv;try{process.argv=previous.slice(0,2);return await import('./report-tax94-recovery.mjs');}finally{process.argv=previous;}})();
const {TAX94_RECOVERY:POLICY,reconcileTax94NotDispatched,browserPrepareTax94Analysis,prepareTax94Slots,tax94AnalysisRequest,applyTax94Analyses,tax94ConsumptionPath}=recoveryTools;

const require=createRequire(import.meta.url),SELF=fileURLToPath(import.meta.url),ROOT=path.resolve(path.dirname(SELF),'..');
const SNAPSHOT=path.join(ROOT,'outputs/report-standardization/1010-full-generation-2026-10-10T02-04-51-303Z-3378c9e5');
const OUT=path.join(SNAPSHOT,'generation-runner'),RECOVERY=path.join(OUT,'tax/recovery'),CHECKPOINT=path.join(OUT,'checkpoint.json');
const TARGETS={tax:{id:POLICY.projectId,name:'[系统测试]全量报告验收-tax-8c14644b'},longgang:{id:'2884b7a3-960f-40c0-af89-5d19e0284836',name:'[系统测试]全量报告验收-longgang-d5470f22'}};
const sha=value=>crypto.createHash('sha256').update(Buffer.isBuffer(value)?value:typeof value==='string'?value:JSON.stringify(value??null)).digest('hex');
const assert=(condition,message)=>{if(!condition)throw Error(message);};
const safeError=error=>String(error?.message||error).replace(/Bearer\s+\S+/gi,'Bearer [redacted]').replace(/postgres(?:ql)?:\/\/[^\s]+/gi,'[database URL redacted]').slice(0,500);
const emit=(stage,extra={})=>console.log(JSON.stringify({stage,...extra}));
const draftOf=data=>data?.draft||data;
export function canonicalTax94(value){return Array.isArray(value)?value.map(canonicalTax94):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonicalTax94(value[key])])):value;}

export function parseTax94Args(argv=process.argv.slice(2)){
  const options={proposal:null,execute:false,saveRetained:false,baseUrl:'http://localhost:8080'};
  for(let i=0;i<argv.length;i++){
    if(argv[i]==='--execute'){assert(!options.execute,'Duplicate --execute');options.execute=true;}
    else if(argv[i]==='--save-retained'){assert(!options.saveRetained,'Duplicate --save-retained');options.saveRetained=true;}
    else if(['--proposal','--base-url'].includes(argv[i])){const name=argv[i]==='--proposal'?'proposal':'baseUrl';assert(argv[i+1]&&!argv[i+1].startsWith('--'),'Missing option value');assert(name!=='proposal'||!options.proposal,'Duplicate proposal');options[name]=argv[++i];}
    else throw Error('Only --proposal FILE --execute, --save-retained and --base-url are permitted');
  }
  assert(!options.saveRetained||!options.execute&&!options.proposal,'Retained save cannot dispatch or consume another proposal');
  assert(!options.execute||options.proposal,'--execute requires --proposal FILE');
  const url=new URL(options.baseUrl);
  assert(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/','Only a localhost HTTP origin is permitted');
  options.baseUrl=url.origin;return options;
}

// The retained model response compared factors with different perturbation
// amplitudes. Correct only those two exact sentences, not its table or classes.
export function correctTax94ScenarioWording(text){
  const edits=[
    ['其中租金与装修造价的扰动对收益指标的影响最为突出，出租率变动次之，运营成本变动的影响相对温和。','在表列给定情景下，租金与装修造价对应的收益指标变化较大，出租率对应的指标变化次之，运营成本对应的指标变化相对较小；由于各因素扰动口径不同，该比较不代表标准化敏感系数排序。'],
    ['综合敏感性分析结果，项目收益对租金与装修造价的变化较为敏感，对出租率变化的敏感程度居中，对运营成本变化的敏感程度相对较低。','综合表列情景，租金与装修造价在给定情景下的指标变化较大，出租率对应的指标变化次之，运营成本对应的指标变化相对较小；上述比较仅限表列扰动条件，不据此排列各因素的标准化敏感程度。']
  ];
  let after=text;
  for(const [before,replacement]of edits){assert(after.split(before).length===2,'Exact scenario sentence missing or repeated');after=after.replace(before,replacement);}
  return {after,afterSha256:sha(after),beforeSha256:sha(text),edits:edits.map(([before,after])=>({before,after}))};
}

export function validateTax94Proposal(value){
  const p=POLICY;
  assert(value?.version==='tax-9.4-reconciliation-proposal-v1'&&value.status==='proposal-only-not-a-clearance-receipt'&&value.newPaidAiCalls===0&&value.projectWrites===0,'Exact unapplied proposal required');
  assert(value.target?.key===p.key&&value.target.projectId===p.projectId&&value.target.projectName===TARGETS.tax.name&&value.target.sectionKey===p.sectionKey,'Proposal scope must be the retained Tax 9.4 copy only');
  assert(value.oldTask?.id===p.taskId&&value.oldTask.runId===p.runId&&value.oldTask.inputHash===p.inputHash&&value.oldTask.getStatus==='completed'&&value.oldTask.rulesChanged===false&&value.oldTask.completeBodyAvailable===false&&value.oldTask.textSha256===p.candidateSha256&&value.oldTask.rawTextSha256===p.rawSha256&&value.oldTask.structuredTextSha256===p.rawSha256,'Proposal old task/response changed');
  assert(value.currentSection?.bodyCharacters===0&&value.currentSection.candidateSha256===p.candidateSha256&&JSON.stringify(value.currentSection.requiredHeadings)===JSON.stringify(p.headings.map(text=>({text,level:3}))),'Proposal candidate/headings changed');
  const old=value.legacyBoundedAttempt,calc=value.adoptedCalculation;
  assert(old?.classification==='not-dispatched-empty-plan'&&old.beforeFile==='tax/recovery/'+p.beforeName&&old.beforeFileSha256===p.beforeSha256&&old.queueReceiptFile==='tax/recovery/'+p.queueName&&old.queueReceiptSha256===p.queueSha256&&['paragraphs','headings','tables'].every(key=>old.planCounts?.[key]===0)&&old.remainingPaidRunning===0&&old.resumePaidIntentExists===false&&Array.isArray(old.retainedRawFiles)&&!old.retainedRawFiles.length&&Array.isArray(old.retainedAfterFiles)&&!old.retainedAfterFiles.length,'Proposal non-dispatch evidence changed');
  assert(calc?.snapshotId===p.snapshotId&&calc.snapshotVersion===p.snapshotVersion&&calc.financialSourceSignatureSha256===p.financialSourceSha256&&value.minimalReconciliation?.unresolvedGap?.statement===p.gapStatement,'Proposal frozen financial source/gap changed');
  return true;
}

// State is in-memory only. A failed/uncertain first dispatch never re-arms it.
export function claimTax94Request(state,request,expected){
  assert(state?.armed===true&&state.submitted===false,'Tax 9.4 request already submitted or not armed; never retry');
  const url=new URL(request.url);
  assert(url.origin===expected.origin&&url.pathname==='/api/generate'&&!url.search&&request.method==='POST'&&sha(request.body)===expected.requestSha256,'Out-of-scope AI request blocked');
  const body=JSON.parse(request.body),prompt=JSON.parse(body.messages?.[0]?.content||'null');
  assert(body.projectId===POLICY.projectId&&body.kind==='batch'&&body.stream===false&&body.messages.length===1&&body.messages[0].role==='user'&&prompt.section==='9.4'&&prompt.financialSourceSignatureSha256===POLICY.financialSourceSha256&&prompt.targets?.paragraphs?.length===3&&!prompt.targets.headings.length&&!prompt.targets.tables.length,'Only the exact three analysis slots may be submitted');
  state.submitted=true;state.armed=false;return true;
}

// Exported for a pure mock-page test and page.evaluate; never adopts content.
export async function browserSaveTax94Candidate({policy,prep,text,proof}){
  const clone=value=>JSON.parse(JSON.stringify(value));
  const unchanged=()=>currentProjectId===policy.projectId&&window.__qaDispatchPaused&&projectCanEdit()&&reportCandidateInputIdentity()===prep.sourceIdentity&&JSON.stringify(chapters[8]?.sections[3])===JSON.stringify(prep.originalSection);
  if(!unchanged())throw Error('Tax 9.4 section/source changed; paid response retained');
  const c=chapters[8],s=c.sections[3],originalTask=JSON.stringify(s.executionTask??null),originalBody=s.editedHtml||s.content||'';
  const plan=reportCompletionPlan({sectionKey:policy.sectionKey,html:text});let contract=plan.sections.find(item=>item.sectionKey===policy.sectionKey);
  if(!contract)throw Error('Current completion contract missing');
  // The paid output cannot alter program-owned values. Inspect the exact prepared
  // HTML, rather than composing an intended chapter/body projection.
  // The table was already generated/validated by browserPrepareTax94Analysis.
  // Rendering may compose wrappers, but cannot replace the retained candidate
  // bytes or refresh financial values a second time here.
  const entries=reportCompletionEntries({sectionKey:policy.sectionKey,html:text}),actual=text;
  if(!entries.some(item=>item.key===policy.sectionKey))throw Error('Candidate document entry missing');
  contract=await ReportCompletionContract.bindDocumentReferences(contract,entries);
  contract=await ReportCompletionContract.bindFrozenTables(contract,actual,'tax94-recovery:'+proof.afterSha256);
  contract=await ReportCompletionContract.bindProgramProse(contract,actual);
  const quality=ReportCompletionContract.inspect(actual,contract),financialIssues=reportFinancialCandidateIssues({after:actual,completionContract:contract,completionFinancialSource:prep.financialBinding,completionInputPlanId:prep.sourceIdentity});
  const review=ReportCompletionContract.reviewDocument(entries,{...plan,sections:plan.sections.map(item=>item.sectionKey===policy.sectionKey?contract:item)});
  const refs=(review.reviews.find(item=>item.key===policy.sectionKey)?.issues||[]).filter(item=>item.severity==='error'&&/^(?:bound-)?reference-/.test(item.code));
  const errors=[...quality.issues,...financialIssues,...refs].filter(item=>item.severity==='error');
  if(!unchanged())throw Error('Tax 9.4 changed during final inspection; response retained');
  const candidate=ProjectWorkflow.replaceCandidate(s,actual,'Tax 9.4 独立恢复：仅候选，待全文人工复核',{completionContract:contract,completionFinancialSource:prep.financialBinding,completionInputPlanId:prep.sourceIdentity,outputPolicyVersion:window.ReportOutputPolicy?.contentVersion||''},ProjectWorkflow.candidateToken(s.pendingRevision));
  if(!candidate)throw Error('Candidate compare-and-swap failed');
  candidate.quality=clone(quality);candidate.admissionIssues=clone([...financialIssues,...refs]);
  candidate.qaTax94Recovery={...clone(proof),semanticReviewRequired:true,factsVerified:false,notAccepted:true,originalExecutionTaskPreserved:true,technicalPassed:!errors.length};
  if((s.editedHtml||s.content||'')!==originalBody||JSON.stringify(s.executionTask??null)!==originalTask)throw Error('Candidate replacement changed original body/task');
  const saved=await persistReportDraft();
  if(!saved.ok||!saved.remote)throw Error('Candidate save uncertain; retained intent prohibits resubmission');
  return {status:errors.length?'technical-review-blocked':'semantic-review-pending',candidateId:candidate.id,errors:clone(errors),quality:clone(quality),bodyUnchanged:true,originalExecutionTaskPreserved:true,notAccepted:true,persisted:saved};
}

async function exclusive(file,value){
  const bytes=Buffer.isBuffer(value)?value:Buffer.from(typeof value==='string'?value:JSON.stringify(value,null,2));
  await fs.writeFile(file,bytes,{flag:'wx'});assert(sha(await fs.readFile(file))===sha(bytes),'Receipt readback failed');return {file,sha256:sha(bytes),bytes:bytes.length};
}
async function sourceChecks(snapshot){const result={};for(const key of Object.keys(TARGETS))result[key]=await checkSourceUnchanged(snapshot.sources[key].sourceIdentity);assert(Object.values(result).every(value=>value===true),'Formal source changed; execution forbidden');return result;}
function validateProject(key,project,snapshot){const expected=TARGETS[key],data=project?.data;assert(project?.id===expected.id&&project.name===expected.name&&data?.qaAcceptance?.id===expected.id&&data.qaSourceStateSha256===sha(snapshot.sources[key].state),'Retained test-copy provenance changed');assert(draftOf(data).chapters?.reduce((n,c)=>n+c.sections.length,0)===43,'Exactly 43 retained sections required');return data;}
async function readProposal(file){const absolute=await fs.realpath(path.resolve(file)),relative=path.relative(RECOVERY,absolute);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'Proposal must remain inside the retained Tax recovery directory');const bytes=await fs.readFile(absolute),value=JSON.parse(bytes);validateTax94Proposal(value);return {file:absolute,bytes,value,sha256:sha(bytes)};}
async function paidScan(checkpoint){
  const names=await fs.readdir(RECOVERY),outNames=await fs.readdir(OUT);
  // Receipts created by this executor always carry tax94 prefixes. Old bounded
  // raw/after files and both controllers' fixed intents block as well.
  const rawFiles=names.filter(name=>/^bounded-raw-9\.4-|^tax94-raw-/.test(name));
  const afterFiles=names.filter(name=>/^bounded-after-9\.4-|^tax94-after-/.test(name));
  const paidIntentFiles=outNames.filter(name=>name==='resume-paid-intent-tax-9.4.json');
  const consumptionReceipts=names.filter(name=>/^tax94-reconciliation-consumed-/.test(name));
  const uncertainRequests=names.filter(name=>/^tax94-uncertain-/.test(name));
  return {scanComplete:true,checkpointStatus:checkpoint.sections?.[POLICY.key]?.status,rawFiles,afterFiles,paidIntentFiles,consumptionReceipts,uncertainRequests};
}
async function taskEvidence(session){
  const {Client}=require(path.join(ROOT,'local-server/node_modules/pg')),db=new Client({connectionString:process.env.DATABASE_URL});await db.connect();
  try{await db.query('BEGIN READ ONLY');await db.query("SET LOCAL statement_timeout='15s'");const rows=(await db.query('SELECT id,project_id,user_id,section_key,input_hash,run_id FROM report_section_tasks WHERE project_id=$1 AND section_key=$2',[POLICY.projectId,POLICY.sectionKey])).rows;await db.query('ROLLBACK');const response=await session.request('/api/reportexecution?id='+encodeURIComponent(POLICY.taskId));return {dbRows:rows,task:response.task,expectedUserId:session.user.id};}finally{await db.end();}
}
async function pause(h){return h.page.evaluate(expected=>{if(currentProjectId!==expected||!projectCanEdit()||typeof airDriveSectionGen!=='function')throw Error('Exact editable test copy required');window.__qaDispatchPaused=true;if(!window.__qaOriginalAirDrive)window.__qaOriginalAirDrive=airDriveSectionGen;airDriveSectionGen=async(...args)=>{const error=Object.assign(Error('Tax 9.4 executor paused ordinary dispatch'),{code:'QA_TAX94_DISPATCH_PAUSED'});args[3]?.onFail?.(error);return false;};return {projectId:currentProjectId,paused:true};},POLICY.projectId);}
async function saveActualState(h,isolation,snapshot,runId,phase){
  const actual=await h.page.evaluate(expected=>{if(currentProjectId!==expected||!window.__qaDispatchPaused)throw Error('Paused project changed');return {projectId:currentProjectId,chapters:ProjectWorkflow.clone(chapters),workflow:ProjectWorkflow.clone(projectWorkflow),persistableChapters:ProjectWorkflow.clone(buildDraftData().chapters),sourceIdentity:reportCandidateInputIdentity()};},POLICY.projectId);
  const opened=await isolation.sessions.tax.request('/api/projects?id='+POLICY.projectId),remote=validateProject('tax',opened.project,snapshot),remoteChapters=draftOf(remote).chapters;
  const verified=sha(canonicalTax94(actual.persistableChapters))===sha(canonicalTax94(remoteChapters));
  return {...await exclusive(path.join(OUT,'resume-state-'+runId+'-tax94-'+phase+'.json'),{phase,...actual,remoteSaveVerified:verified,remoteChaptersSha256:sha(remoteChapters),notIntendedProjection:true}),remoteSaveVerified:verified,actual,remote};
}

// Load the real published rules before taking an identity. The independent
// offline replay permits only the audited numeric-only plan compatibility
// change; changed sources, tables, tasks or confirmed budgets still stop here.
export async function prepareTax94RetainedIdentity(h,recovered){
  const {loadTax94IdentityRebindBaseline,browserCaptureTax94IdentityInputs,createTax94IdentityRebindProposal}=await import('./report-tax94-paid-protocol-recovery.mjs');
  await h.page.evaluate(async()=>{
    if(currentProjectId!=='f4395f64-af1b-43bd-b809-580b5ec9406b'||!window.__qaDispatchPaused||!projectCanEdit())throw Error('Exact paused editable Tax copy required before loading rules');
    await ReportLogicCore.load(rlProjectType(),true);
  });
  const baseline=await loadTax94IdentityRebindBaseline(recovered);
  const fresh=await h.page.evaluate(browserPrepareTax94Analysis,POLICY);
  const current=await h.page.evaluate(browserCaptureTax94IdentityInputs);
  const identityRebind={baseline,current,freshPrepared:fresh};
  identityRebind.proposal=createTax94IdentityRebindProposal(recovered,identityRebind);
  return {fresh,identityRebind};
}

// Reuse the single paid response already durably retained. There is deliberately
// no route capable of a new model request in this mode.
async function runTax94RetainedSave(options){
  const {loadTax94PaidEvidence,recoverTax94PaidProtocol,assertTax94PaidRecoveryCas}=await import('./report-tax94-paid-protocol-recovery.mjs');
  const recovered=await recoverTax94PaidProtocol(await loadTax94PaidEvidence()),edited=correctTax94ScenarioWording(recovered.after);
  assert(path.resolve(process.cwd()).toLowerCase()===ROOT.toLowerCase(),'Run from the repository root');
  assert(!globalThis.__qaTax94ExecutorRunning,'Tax 9.4 executor is already active');
  const runId=new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(4).toString('hex'),lock=path.join(OUT,'resume-execute.lock.json');
  const audit={version:'tax94-retained-candidate-only-save-v1',runId,key:POLICY.key,at:new Date().toISOString(),newPaidAiCalls:0,notAccepted:true,checkpointNotModified:true};
  let snapshot,isolation,h,locked=false,failure,checkpointBytes,start;const saveGate={allowed:false};
  globalThis.__qaTax94ExecutorRunning=true;
  try{
    snapshot=await loadSnapshots(SNAPSHOT);audit.sourceUnchangedBefore=await sourceChecks(snapshot);
    await exclusive(lock,{runId,pid:process.pid,at:audit.at});locked=true;
    isolation=await loadIsolation(snapshot,{baseUrl:options.baseUrl});checkpointBytes=await fs.readFile(CHECKPOINT);const checkpoint=JSON.parse(checkpointBytes);
    assert(checkpoint.version==='production-full-generation-v1'&&checkpoint.sections,'Existing checkpoint required');audit.backups={};
    for(const [key,target]of Object.entries(TARGETS)){
      const session=isolation.sessions[key];assert(session.target.id===target.id&&session.target.name===target.name&&checkpoint.projects?.[key]?.id===target.id&&checkpoint.sourceHashes?.[key]===snapshot.sources[key].sourceIdentity.sourceSha256,'Exact isolation/checkpoint identity changed');
      const opened=await session.request('/api/projects?id='+target.id);validateProject(key,opened.project,snapshot);
      audit.backups[key]=await exclusive(path.join(OUT,'tax94-retained-remote-backup-'+runId+'-'+key+'.json'),opened);
    }
    audit.checkpointBackup=await exclusive(path.join(OUT,'tax94-retained-checkpoint-backup-'+runId+'.json'),checkpointBytes);
    h=await openProductionHarness(isolation,'tax',{readOnly:false,allowAi:false});
    assert(!h.ledger.some(item=>item.isAi&&item.allowed),'Unexpected bootstrap AI dispatch');await pause(h);
    await h.context.route('**/api/**',async route=>{
      const req=route.request(),url=new URL(req.url()),method=req.method();
      if(['GET','HEAD','OPTIONS'].includes(method))return route.fallback();
      if(['/api/generate','/api/reportexecution','/api/agent'].some(prefix=>url.pathname.startsWith(prefix)))return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({ok:false,error:'Retained response mode forbids every new AI request.'})});
      if(['/api/projects','/api/aireport'].includes(url.pathname)&&!saveGate.allowed)return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({ok:false,error:'Retained candidate save has not passed fresh CAS.'})});
      return route.fallback();
    });
    start=await saveActualState(h,isolation,snapshot,runId,'retained-start');audit.start={file:start.file,sha256:start.sha256,remoteSaveVerified:start.remoteSaveVerified};assert(start.remoteSaveVerified,'Loaded chapters do not match remote save');
    const {fresh,identityRebind}=await prepareTax94RetainedIdentity(h,recovered),ownership=await taskEvidence(isolation.sessions.tax);
    assert(ownership.dbRows.some(row=>row.id===POLICY.taskId&&row.project_id===POLICY.projectId&&row.user_id===ownership.expectedUserId&&row.section_key===POLICY.sectionKey&&row.input_hash===POLICY.inputHash&&row.run_id===POLICY.runId),'Original task ownership changed');
    const observation=await h.page.evaluate(()=>({projectId:currentProjectId,key:'tax:9.4',paused:window.__qaDispatchPaused===true,canEdit:projectCanEdit(),currentSection:ProjectWorkflow.clone(chapters[8].sections[3])}));
    assertTax94PaidRecoveryCas(recovered,{...observation,sourceIdentity:fresh.sourceIdentity,financialSourceSignature:fresh.financialBinding.sourceSignature,sourceUnchanged:await sourceChecks(snapshot),originalTask:ownership.task,identityRebind});
    assert(sha(canonicalTax94(fresh.originalSection))===sha(canonicalTax94(observation.currentSection)),'Preparation changed the original section');
    assert(sha(await fs.readFile(CHECKPOINT))===sha(checkpointBytes),'Checkpoint changed before retained save');
    const opened=await isolation.sessions.tax.request('/api/projects?id='+POLICY.projectId);validateProject('tax',opened.project,snapshot);
    assert(sha(canonicalTax94(draftOf(opened.project.data).chapters))===sha(canonicalTax94(start.actual.persistableChapters)),'Remote chapters changed before retained save');
    audit.identityRebind=await exclusive(path.join(RECOVERY,'tax94-identity-rebind-'+runId+'.json'),identityRebind.proposal);
    audit.derived=await exclusive(path.join(RECOVERY,'tax94-retained-after-'+runId+'.json'),{runId,recovered,edited,newPaidAiCalls:0,notAccepted:true});
    const proof={version:'tax94-retained-derived-candidate-v1',runId,oldTaskId:POLICY.taskId,oldRunId:POLICY.runId,oldInputHash:POLICY.inputHash,oldCandidateSha256:POLICY.candidateSha256,afterFile:audit.derived.file,afterFileSha256:audit.derived.sha256,afterSha256:edited.afterSha256,protocolAfterSha256:recovered.afterSha256,programTableSha256:recovered.prepared.programTableSha256,financialSourceSignatureSha256:POLICY.financialSourceSha256,evidence:recovered.evidence,identityRebindFile:audit.identityRebind.file,identityRebindFileSha256:audit.identityRebind.sha256,semanticEdits:edited.edits,newPaidAiCalls:0,originalPaidAiCalls:1,notOriginalAiReceipt:true,semanticReviewRequired:true,factsVerified:false,notAccepted:true};
    saveGate.allowed=true;
    try{audit.result=await h.page.evaluate(browserSaveTax94Candidate,{policy:POLICY,prep:fresh,text:edited.after,proof});}finally{saveGate.allowed=false;}
    assert(audit.result.bodyUnchanged&&audit.result.originalExecutionTaskPreserved&&audit.result.notAccepted,'Only an unaccepted candidate may be saved');
    emit('retained-candidate-saved',{sections:1,status:audit.result.status,newPaidAiCalls:0,acceptedBodies:0});
  }catch(error){failure=error;audit.error=safeError(error);}
  finally{
    saveGate.allowed=false;
    if(h){try{const end=await saveActualState(h,isolation,snapshot,runId,'retained-end');audit.end={file:end.file,sha256:end.sha256,remoteSaveVerified:end.remoteSaveVerified};assert(end.remoteSaveVerified,'Final actual chapters are not verified saved');if(start){const before=structuredClone(start.actual.persistableChapters),after=structuredClone(end.actual.persistableChapters);before[8].sections[3].pendingRevision=null;after[8].sections[3].pendingRevision=null;assert(sha(canonicalTax94(before))===sha(canonicalTax94(after)),'Adopted body/task or untargeted sections changed');}}catch(error){failure??=error;audit.endError=safeError(error);}try{await h.close();}catch(error){failure??=error;}}
    if(snapshot)try{audit.sourceUnchangedAfter=await sourceChecks(snapshot);}catch(error){failure??=error;audit.sourceError=safeError(error);}
    if(checkpointBytes)try{assert(sha(await fs.readFile(CHECKPOINT))===sha(checkpointBytes),'Checkpoint unexpectedly changed');}catch(error){failure??=error;}
    if(locked){audit.ok=!failure;audit.completedAt=new Date().toISOString();try{audit.receipt=await exclusive(path.join(OUT,'tax94-retained-save-'+runId+'.json'),audit);}catch(error){failure??=error;}try{if(JSON.parse(await fs.readFile(lock)).runId===runId)await fs.unlink(lock);}catch(error){failure??=error;}}
    globalThis.__qaTax94ExecutorRunning=false;
  }
  emit('finished',{ok:!failure,newPaidAiCalls:0,acceptedBodies:0,receiptFile:audit.receipt?.file||null});
  if(failure){failure.recoveryReceipt=audit.receipt?.file;throw failure;}return audit;
}

export async function runTax94Action(options=parseTax94Args()){
  if(options.saveRetained){options=parseTax94Args(['--save-retained','--base-url',options.baseUrl||'http://localhost:8080']);return runTax94RetainedSave(options);}
  // Supplying a proposal alone is not authorization and performs no I/O.
  if(!options.execute){emit('no-action',{projectWrites:0,newPaidAiCalls:0});return {projectWrites:0,newPaidAiCalls:0};}
  options=parseTax94Args(['--proposal',String(options.proposal||''),'--execute','--base-url',options.baseUrl||'http://localhost:8080']);
  assert(path.resolve(process.cwd()).toLowerCase()===ROOT.toLowerCase(),'Run from the repository root');
  assert(!globalThis.__qaTax94ExecutorRunning,'Tax 9.4 executor is already active');
  const runId=new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(4).toString('hex'),lock=path.join(OUT,'resume-execute.lock.json');
  const audit={version:'tax94-candidate-only-execution-v1',runId,key:POLICY.key,at:new Date().toISOString(),newPaidAiCalls:0,notAccepted:true,checkpointNotModified:true};
  let snapshot,isolation,h,locked=false,failure,checkpointBytes,start,rawReceipt;const dispatch={armed:false,submitted:false},saveGate={allowed:false};
  globalThis.__qaTax94ExecutorRunning=true;
  try{
    const proposal=await readProposal(options.proposal);audit.proposal={file:proposal.file,sha256:proposal.sha256};
    snapshot=await loadSnapshots(SNAPSHOT);audit.sourceUnchangedBefore=await sourceChecks(snapshot);
    await exclusive(lock,{runId,pid:process.pid,at:audit.at});locked=true;
    isolation=await loadIsolation(snapshot,{baseUrl:options.baseUrl});checkpointBytes=await fs.readFile(CHECKPOINT);const checkpoint=JSON.parse(checkpointBytes);
    assert(checkpoint.version==='production-full-generation-v1'&&checkpoint.sections,'Existing checkpoint required');audit.backups={};const remote={};
    for(const [key,target] of Object.entries(TARGETS)){
      const session=isolation.sessions[key];assert(session.target.id===target.id&&session.target.name===target.name&&checkpoint.projects?.[key]?.id===target.id&&checkpoint.sourceHashes?.[key]===snapshot.sources[key].sourceIdentity.sourceSha256,'Exact isolation/checkpoint identity changed');
      const opened=await session.request('/api/projects?id='+target.id);remote[key]=validateProject(key,opened.project,snapshot);audit.backups[key]=await exclusive(path.join(OUT,'tax94-remote-backup-'+runId+'-'+key+'.json'),opened);
    }
    audit.checkpointBackup=await exclusive(path.join(OUT,'tax94-checkpoint-backup-'+runId+'.json'),checkpointBytes);
    const beforeBytes=await fs.readFile(path.join(RECOVERY,POLICY.beforeName)),queueBytes=await fs.readFile(path.join(RECOVERY,POLICY.queueName));
    const currentSection=draftOf(remote.tax).chapters[8].sections[3];
    let declaration=reconcileTax94NotDispatched({beforeBytes,queueBytes,...await taskEvidence(isolation.sessions.tax),currentSection,financialSourceSignature:currentSection.pendingRevision?.completionFinancialSource?.sourceSignature,sourceUnchanged:audit.sourceUnchangedBefore,paidState:await paidScan(checkpoint)});
    emit('backed-up',{sections:1,newPaidAiCalls:0});
    h=await openProductionHarness(isolation,'tax',{readOnly:false,allowAi:false});
    assert(!h.ledger.some(item=>item.isAi&&item.allowed),'Unexpected bootstrap AI dispatch');await pause(h);
    // The base harness remains zero-AI. This later route is the sole paid gate.
    let expectedRequest;
    await h.context.route('**/api/**',async route=>{
      const req=route.request(),url=new URL(req.url()),method=req.method();
      if(['GET','HEAD','OPTIONS'].includes(method))return route.fallback();
      if(['/api/generate','/api/reportexecution','/api/agent'].some(prefix=>url.pathname.startsWith(prefix))){
        try{
          claimTax94Request(dispatch,{url:req.url(),method,body:req.postData()||''},expectedRequest||{});
          audit.newPaidAiCalls=1;
          const response=await route.fetch({timeout:190000,maxRetries:0,maxRedirects:0}),bytes=await response.body();
          rawReceipt=await exclusive(path.join(RECOVERY,'tax94-raw-'+runId+'.json'),{runId,httpStatus:response.status(),bodyBase64:bytes.toString('base64'),bodySha256:sha(bytes),requestSha256:expectedRequest.requestSha256,intentFile:audit.intent.file,consumptionFile:audit.consumption.file});
          audit.raw=rawReceipt;return route.fulfill({response,body:bytes});
        }catch(error){
          if(dispatch.submitted&&!rawReceipt){audit.uncertainRequest=true;await exclusive(path.join(RECOVERY,'tax94-uncertain-'+runId+'.json'),{runId,error:safeError(error),intentFile:audit.intent?.file,automaticRetryForbidden:true}).catch(()=>{});}
          return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({ok:false,error:'Scoped Tax 9.4 request blocked or uncertain; inspect retained receipts, never retry automatically.'})});
        }
      }
      if(['/api/projects','/api/aireport'].includes(url.pathname)&&!saveGate.allowed)return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({ok:false,error:'Tax 9.4 preflight has not authorized a candidate save.'})});
      return route.fallback();
    });
    start=await saveActualState(h,isolation,snapshot,runId,'start');audit.start={file:start.file,sha256:start.sha256,remoteSaveVerified:start.remoteSaveVerified};assert(start.remoteSaveVerified,'Loaded full chapters do not match remote save');
    const prepared=prepareTax94Slots(await h.page.evaluate(browserPrepareTax94Analysis,POLICY));
    assert(sha(canonicalTax94(prepared.originalSection))===sha(canonicalTax94(start.actual.chapters[8].sections[3])),'Prepared section differs from actual start');
    assert(sha(await fs.readFile(CHECKPOINT))===sha(checkpointBytes)&&sha(await fs.readFile(proposal.file))===proposal.sha256,'Checkpoint/proposal changed during bootstrap');
    declaration=reconcileTax94NotDispatched({beforeBytes,queueBytes,...await taskEvidence(isolation.sessions.tax),currentSection:prepared.originalSection,financialSourceSignature:prepared.financialBinding.sourceSignature,sourceUnchanged:await sourceChecks(snapshot),paidState:await paidScan(checkpoint)});
    audit.before=await exclusive(path.join(RECOVERY,'tax94-before-'+runId+'.json'),{runId,proposal:audit.proposal,declaration,prepared,originalExecutionTask:prepared.originalSection.executionTask??null});
    const prompt=tax94AnalysisRequest(prepared),body={kind:'batch',stream:false,projectId:POLICY.projectId,system:'你是可研定性分析编辑。严格按用户指定的三个槽返回纯JSON对象。不得返回HTML、表格、标题或阿拉伯数字；不得编造已核实事实或盈亏平衡临界值。',messages:[{role:'user',content:JSON.stringify(prompt)}],max_tokens:3000,response_format:{type:'json_object'}},requestBody=JSON.stringify(body);
    expectedRequest={origin:options.baseUrl,requestSha256:sha(requestBody)};
    audit.consumption=await exclusive(tax94ConsumptionPath(RECOVERY,declaration),{runId,declaration,proposal:audit.proposal,before:audit.before,notAnAfterReceipt:true,automaticRetryForbidden:true});
    audit.intent=await exclusive(path.join(OUT,'resume-paid-intent-tax-9.4.json'),{version:'tax94-one-shot-intent-v1',runId,key:POLICY.key,projectId:POLICY.projectId,path:'/api/generate',requestBody,requestSha256:sha(requestBody),before:audit.before,consumption:audit.consumption,oldTaskId:POLICY.taskId,oldRunId:POLICY.runId,automaticRetryForbidden:true});
    dispatch.armed=true;emit('one-request-armed',{sections:1,maxPaidRequests:1});
    const response=await h.page.evaluate(async({expected,prep,requestBody})=>{
      if(currentProjectId!==expected||!window.__qaDispatchPaused||!projectCanEdit()||reportCandidateInputIdentity()!==prep.sourceIdentity||JSON.stringify(chapters[8]?.sections[3])!==JSON.stringify(prep.originalSection))throw Error('Input changed immediately before POST; retained intent forbids retry');
      const response=await fetch('/api/generate',{method:'POST',headers:{...authHeaders(),'content-type':'application/json'},body:requestBody,signal:AbortSignal.timeout(200000)});return {status:response.status,body:await response.text()};
    },{expected:POLICY.projectId,prep:prepared,requestBody});
    assert(rawReceipt&&!audit.uncertainRequest,'Paid response is unknown; inspect receipts, never resubmit');
    const retained=JSON.parse(await fs.readFile(rawReceipt.file));assert(sha(response.body)===retained.bodySha256&&response.status===retained.httpStatus,'Returned body differs from retained raw response');
    assert(response.status===200,'AI returned non-200; retained raw response prohibits resubmission');
    const payload=JSON.parse(response.body),text=(payload.content||[]).filter(item=>item.type==='text').map(item=>item.text).join('');
    const edited=applyTax94Analyses(prepared,JSON.parse(text));audit.after=await exclusive(path.join(RECOVERY,'tax94-after-'+runId+'.json'),{runId,...edited,before:audit.before,raw:rawReceipt,intent:audit.intent,consumption:audit.consumption,oldTaskId:POLICY.taskId,oldRunId:POLICY.runId});
    await sourceChecks(snapshot);assert(sha(await fs.readFile(CHECKPOINT))===sha(checkpointBytes),'Checkpoint changed before candidate save');
    const opened=await isolation.sessions.tax.request('/api/projects?id='+POLICY.projectId);validateProject('tax',opened.project,snapshot);
    assert(sha(canonicalTax94(draftOf(opened.project.data).chapters))===sha(canonicalTax94(start.actual.persistableChapters)),'Remote chapters changed; candidate save forbidden');
    const proof={version:'tax94-one-shot-derived-candidate-v1',runId,oldTaskId:POLICY.taskId,oldRunId:POLICY.runId,oldInputHash:POLICY.inputHash,oldCandidateSha256:POLICY.candidateSha256,beforeFile:audit.before.file,rawFile:rawReceipt.file,afterFile:audit.after.file,intentFile:audit.intent.file,consumptionFile:audit.consumption.file,afterSha256:edited.afterSha256,programTableSha256:prepared.programTableSha256,financialSourceSignatureSha256:POLICY.financialSourceSha256,newPaidAiCalls:1,notOriginalAiReceipt:true,semanticReviewRequired:true,factsVerified:false,notAccepted:true};
    saveGate.allowed=true;
    try{audit.result=await h.page.evaluate(browserSaveTax94Candidate,{policy:POLICY,prep:prepared,text:edited.after,proof});}finally{saveGate.allowed=false;}
    assert(audit.result.bodyUnchanged&&audit.result.originalExecutionTaskPreserved&&audit.result.notAccepted,'Only an unaccepted candidate may be saved');
    emit('candidate-saved',{sections:1,status:audit.result.status,newPaidAiCalls:1,acceptedBodies:0});
  }catch(error){failure=error;audit.error=safeError(error);}
  finally{
    dispatch.armed=false;saveGate.allowed=false;
    if(h){try{const end=await saveActualState(h,isolation,snapshot,runId,'end');audit.end={file:end.file,sha256:end.sha256,remoteSaveVerified:end.remoteSaveVerified};assert(end.remoteSaveVerified,'Final actual chapters are not verified saved');if(start){const before=structuredClone(start.actual.persistableChapters),after=structuredClone(end.actual.persistableChapters);before[8].sections[3].pendingRevision=null;after[8].sections[3].pendingRevision=null;assert(sha(canonicalTax94(before))===sha(canonicalTax94(after)),'Adopted body/task or untargeted sections changed');}}catch(error){failure??=error;audit.endError=safeError(error);}try{await h.close();}catch(error){failure??=error;}}
    if(snapshot)try{audit.sourceUnchangedAfter=await sourceChecks(snapshot);}catch(error){failure??=error;audit.sourceError=safeError(error);}
    if(checkpointBytes)try{assert(sha(await fs.readFile(CHECKPOINT))===sha(checkpointBytes),'Checkpoint unexpectedly changed');}catch(error){failure??=error;}
    if(locked){audit.ok=!failure;audit.completedAt=new Date().toISOString();try{audit.receipt=await exclusive(path.join(OUT,'tax94-execute-'+runId+'.json'),audit);}catch(error){failure??=error;}try{if(JSON.parse(await fs.readFile(lock)).runId===runId)await fs.unlink(lock);}catch(error){failure??=error;}}
    globalThis.__qaTax94ExecutorRunning=false;
  }
  emit('finished',{ok:!failure,newPaidAiCalls:audit.newPaidAiCalls,acceptedBodies:0,receiptFile:audit.receipt?.file||null});
  if(failure){failure.recoveryReceipt=audit.receipt?.file;throw failure;}return audit;
}

if(process.argv[1]&&path.resolve(process.argv[1]).toLowerCase()===SELF.toLowerCase()){
  try{await runTax94Action(parseTax94Args());}catch(error){console.error(JSON.stringify({stage:'stopped',error:safeError(error),receiptFile:error.recoveryReceipt||null}));process.exitCode=1;}
}
