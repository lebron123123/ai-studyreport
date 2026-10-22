// Real production continuation on the retained Longgang acceptance copy only.
// No alternate generator, plan change, source-project write, or hidden retry.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {loadSnapshots,loadIsolation,openProductionHarness,checkSourceUnchanged} from './report-generation-acceptance.mjs';
const require=createRequire(import.meta.url);
require('./windows-browser-lockout-guard.cjs');
const {fingerprint}=require('../report-completion-contract.js');
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const SNAP=path.join(ROOT,'outputs/report-standardization/1010-full-generation-2026-10-10T02-04-51-303Z-3378c9e5');
const OUT=path.join(SNAP,'generation-runner');
const PROJECT='2884b7a3-960f-40c0-af89-5d19e0284836';
const REVIEWS=['lg34-saved-actual-exact-copy-fullread-review-20261013-v1.json','lg11-saved-actual-exact-copy-fullread-review-20261013-v2.json'];
const KEEP=new Set(['1.1','3.1','3.2','3.3','5.1']);
const sha=x=>crypto.createHash('sha256').update(typeof x==='string'||Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
const safe=e=>String(e?.message||e).replace(/Bearer\s+\S+/gi,'Bearer [redacted]').replace(/postgres(?:ql)?:\/\/[^\s]+/gi,'[database redacted]').slice(0,800);
const exclusive=async(file,value)=>{const bytes=JSON.stringify(value,null,2);await fs.writeFile(file,bytes,{flag:'wx'});if(await fs.readFile(file,'utf8')!==bytes)throw Error('Audit readback mismatch');return {file,sha256:sha(bytes)};};
const emit=(stage,more={})=>console.log(JSON.stringify({at:new Date().toISOString(),stage,...more}));
const EXECUTION_RECORD='lg-production-continuation.sample-execution.json';
const bodyOf=s=>({content:String(s?.content||''),editedHtml:s?.editedHtml==null?null:String(s.editedHtml)});
const sectionOf=(chapters,key)=>chapters?.flatMap(c=>(c.sections||[]).map(s=>({key:c.name+' / '+s.t,s}))).find(r=>r.key===key)?.s;

// This marker is deliberately never removed, even after an early failure. A
// lost response must be investigated against its original task, not re-posted.
export async function reserveSampleExecution(directory,record){
  if(record.projectId!==PROJECT||record.number!=='6.3'||!record.runId)throw Error('Invalid scoped sample execution identity');
  for(const entry of await fs.readdir(directory,{withFileTypes:true})){
    if(entry.name===EXECUTION_RECORD)throw Error('An execution record already exists; inspect the original intent/task read-only, never start a new sample');
    if(!entry.isDirectory()||!entry.name.startsWith('lg-production-continuation-'))continue;
    const files=await fs.readdir(path.join(directory,entry.name));
    if(files.some(name=>/^(?:started|result|(?:converge|review)-(?:intent|response))\.json$/.test(name)))throw Error('A prior execution record exists in '+entry.name+'; original task recovery only, no new sample');
    if(files.includes('audit.json')){
      let old;try{old=JSON.parse(await fs.readFile(path.join(directory,entry.name,'audit.json'),'utf8'));}catch{throw Error('A prior audit cannot be verified; no new sample');}
      if(old.execute!==false||old.paidIntents?.length||old.unknownRequests?.length)throw Error('A prior execution audit exists in '+entry.name+'; no new sample');
    }
  }
  return exclusive(path.join(directory,EXECUTION_RECORD),{version:'reviewed-continuation-execution-v1',...record});
}

// Pagination sends binary Word data and therefore has no JSON projectId. Bind
// this one endpoint to the live retained QA run and its open detail-page permit.
// All other requests still fall through to the original restrictive harness.
export function scopedPaginationRoute({origin,planId,runId,readState,fromPage,record=async()=>{}}){
  const used=new Set();
  return async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.pathname!=='/api/report-pagination')return route.fallback();
    const refuse=()=>route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({ok:false,error:'Only this retained QA run may send its bound Word for detail pagination.'})});
    try{
    const bytes=request.postDataBuffer();
    if(url.origin!==origin||url.search||request.method()!=='POST'||request.headers()['content-type']!=='application/vnd.openxmlformats-officedocument.wordprocessingml.document'||!bytes||bytes.length<4||bytes.length>20*1024*1024||bytes.readUInt32LE(0)!==0x04034b50||!fromPage(request))return refuse();
    const state=await readState(),expectedRun=runId(),run=state?.run,permits=run?.permits?.filter(p=>p.kind==='paginate-details'&&p.status==='reserved')||[];
    if(state?.projectId!==PROJECT||state.planId!==planId||!expectedRun||run?.runId!==expectedRun||run.plan?.planId!==planId||run.identity?.projectId!==PROJECT||run.mode!=='reviewed-existing-length-convergence'||permits.length!==1)return refuse();
    const permit=permits[0];
    if(permit.runId!==expectedRun||permit.planId!==planId||permit.identity?.projectId!==PROJECT||!permit.id||used.has(permit.id))return refuse();
    used.add(permit.id);
    await record({projectId:PROJECT,planId,runId:expectedRun,permitId:permit.id,documentSha256:sha(bytes),bytes:bytes.length,at:new Date().toISOString()});
    return route.continue();
    }catch{return refuse();}
  };
}

export function verifySampleAcceptance({selectedKey,before,after,remote,started,result}){
  const issues=[],fail=message=>issues.push(message),saved=after?.workflow?.reportCompletion?.initialDelivery,run=saved?.run;
  const permits=run?.permits?.filter(p=>p.kind==='length-converge'&&p.key===selectedKey)||[],permit=permits[0],binding=saved?.bindings?.[selectedKey];
  const response=binding?.convergenceResponse,review=response?.review,reviewState=binding?.convergenceReview,original=sectionOf(before?.chapters,selectedKey),actual=sectionOf(after?.chapters,selectedKey);
  const source=String(original?.editedHtml||original?.content||''),text=String(actual?.editedHtml||actual?.content||'');
  if(before?.projectId!==PROJECT||after?.projectId!==PROJECT||remote?.project?.id!==PROJECT||run?.mode!=='reviewed-existing-length-convergence'||!run?.runId||run.runId!==started?.run?.runId||run.runId!==result?.run?.runId||run.plan?.planId!==before?.plan?.planId)fail('sample identity changed');
  if(result?.status!=='completed'&&!(result?.status==='paused'&&['dispatch-limit-reached','dispatch-selection-exhausted','reviewed-continuation-finished'].includes(result.reason)))fail('sample stopped before the bounded dispatch completed');
  if(permits.length!==1||permit?.status!=='completed'||!permit.taskId||!permit.backendRunId||!permit.inputHash||binding?.lastCompletedPermitId!==permit.id||JSON.stringify(result?.run?.permits?.find(p=>p.id===permit?.id))!==JSON.stringify(permit))fail('selected permit is not completed with its exact task');
  if(!response?.validated||response.permitId!==permit?.id||!response.text||response.hash!==sha(response.text)||review?.version!=='initial-length-preservation-v1'||review.passed!==true||review.factsPreserved!==true||review.conditionsPreserved!==true||review.analysisPreserved!==true||review.factsVerified!==false||!Array.isArray(review.findings)||review.findings.length||review.sectionKey!==selectedKey||review.sourceHash!==sha(source)||review.textHash!==response.hash||!/^[a-f0-9]{64}$/.test(review.reviewResponseHash||'')||review.reviewTask?.status!=='completed'||!review.reviewTask.taskId||!review.reviewTask.backendRunId||!review.reviewTask.inputHash||review.reviewTask.taskId===permit?.taskId)fail('independent full preservation review is not passed and source-bound');
  const state=reviewState?.state,rb=state?.binding;
  if(reviewState?.permitId!==permit?.id||reviewState?.sourceHash!==sha(source)||reviewState?.textHash!==response?.hash||state?.version!=='initial-length-review-state-v1'||state?.status!=='passed'||state?.source!==source||state?.text!==response?.text||JSON.stringify(state?.task)!==JSON.stringify(review?.reviewTask)||rb?.permitId!==permit?.id||rb?.projectId!==PROJECT||rb?.sectionKey!==selectedKey||rb?.sourceHash!==sha(source)||rb?.textHash!==response?.hash||review?.reviewResponseHash!==sha(state?.rawResponse||state?.responseText||''))fail('saved independent review does not bind this exact response');
  if(!source||!text||text!==response?.text||actual?.pendingRevision||actual?.locked||binding?.provisional||JSON.stringify(bodyOf(actual))!==JSON.stringify(binding?.expectedBody)||sha(bodyOf(actual))!==run?.sections?.find(s=>s.key===selectedKey)?.bodyHash||actual?.executionTask?.id!==permit?.taskId)fail('reviewed response was not actually adopted');
  const draft=remote?.project?.data?.draft||remote?.project?.data;
  const bodies=chapters=>chapters?.map(c=>({name:c.name,sections:c.sections?.map(s=>({t:s.t,...bodyOf(s)}))}));
  if(JSON.stringify(bodies(draft?.chapters))!==JSON.stringify(bodies(after?.chapters))||JSON.stringify(draft?.workflow?.reportCompletion?.initialDelivery)!==JSON.stringify(saved))fail('remote saved bodies or continuation state differ from the browser');
  return {sampleAccepted:issues.length===0,issues,sectionKey:selectedKey,permitId:permit?.id||null,overallComplete:result?.complete===true,overallStatus:result?.status||null};
}

export function continuationExitCode(audit){return audit.error||audit.captureError||audit.remoteError||audit.closeError||audit.unknownRequests?.length||audit.browserErrors?.length||Object.values(audit.sourceUnchangedAfter||{}).some(v=>v!==true)||audit.execute&&(audit.remaining?audit.batchAcceptance?.accepted!==true:audit.sampleAcceptance?.sampleAccepted!==true)?1:0;}

// Failure to verify a source is unknown, not proof of a source change. Neither
// that check nor an audit-write failure may strand this process's own lock.
export async function persistContinuationAudit({audit,folder,lock,runId,ownsLock,snapshot,checkSource=checkSourceUnchanged}){
  if(snapshot)audit.sourceUnchangedAfter=Object.fromEntries(await Promise.all(Object.entries(snapshot.sources).map(async([key,source])=>{
    try{return [key,await checkSource(source.sourceIdentity)];}
    catch(e){(audit.sourceCheckErrors||={})[key]=safe(e);return [key,null];}
  })));
  audit.finishedAt=new Date().toISOString();
  try{return await exclusive(path.join(folder,'audit.json'),audit);}
  finally{
    if(ownsLock){let owner;try{owner=JSON.parse(await fs.readFile(lock,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
      if(owner?.runId===runId&&owner?.pid===process.pid)await fs.unlink(lock);
    }
  }
}

export function bindReviewedSections(chapters,reviewSets){
  const reviews=new Map();
  for(const set of reviewSets)for(const row of set.data.rows||[])reviews.set(row.number,{row,set});
  const sections=[];
  chapters.forEach((c,ci)=>(c.sections||[]).forEach((s,si)=>{
    const number=(ci+1)+'.'+(si+1),source=String(s.editedHtml||s.content||'');if(!source.trim())return;
    const found=reviews.get(number),r=found?.row;
    if(!r||r.projectId!==PROJECT||r.fullBodyRead!==true||r.fullSourcesRead!==true||r.exactActualMatch!==true||r.semanticStatus!=='acceptable-full-body-at-bound-sha'||r.semanticPassed!==true||r.unresolvedContentIssues?.length||r.bodySha256!==sha(source)||r.actualBodySha256!==sha(source)||r.fullActualHtml!==source)throw Error('Current full-body review does not bind '+number);
    if(s.pendingRevision||s.locked)throw Error('Candidate or lock protects '+number);
    const t=s.executionTask,originalTask=t?{id:t.id,runId:t.runId,inputHash:t.graph?.find(x=>x.key==='context_snapshot')?.hash}:null;
    if(t&&(t.status!=='completed'||!originalTask.id||!originalTask.runId||!originalTask.inputHash))throw Error('Incomplete original task identity '+number);
    sections.push({key:c.name+' / '+s.t,number,allowConverge:!KEEP.has(number),bodyHash:sha({content:String(s.content||''),editedHtml:s.editedHtml==null?null:String(s.editedHtml)}),review:{sourceSha256:sha(source),evidenceSha256:found.set.sha256,reference:found.set.file,reviewedAt:found.set.data.createdAtUtc,reviewer:found.set.data.reviewer,conclusion:'accepted'},originalTask});
  }));
  if(sections.length!==34)throw Error('Expected exactly the 34 independently reviewed details, got '+sections.length);
  return sections;
}

// Mirrors the production admission conditions only to explain a refusal. The
// production runtime still performs its own checks; this never grants access.
export function continuationAuthPreflight(input,state){
  const a=input?.authorization,checks={planner:state?.plannerReady===true,workflow:state?.workflowReady===true,authorized:a?.authorized===true,purpose:a?.purpose==='reviewed-existing-length-convergence',confirmation:typeof a?.confirmationId==='string'&&!!a.confirmationId.trim(),confirmedAt:Number.isFinite(Date.parse(a?.confirmedAt)),planId:!!a?.planId&&a.planId===state?.plan?.planId,identity:JSON.stringify(a?.identity)===JSON.stringify(state?.identity),pages:state?.plan?.planningPriority==='pages',sections:Array.isArray(input?.sections)};
  return {passed:Object.values(checks).every(Boolean),checks,identity:state?.identity,authorizationIdentity:a?.identity,planId:state?.plan?.planId,planningPriority:state?.plan?.planningPriority};
}

const readJson=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const draftOf=remote=>remote?.project?.data?.draft||remote?.project?.data;
const savedOf=state=>state?.workflow?.reportCompletion?.initialDelivery;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const bodyList=chapters=>chapters?.map(c=>({name:c.name,sections:c.sections?.map(s=>({t:s.t,...bodyOf(s)}))}));

// JSON omits own object keys whose value is undefined, while the production
// fingerprint includes them. Keep those positions explicitly; null is only a
// storage placeholder, never a replacement input to the production hash.
export function encodeIdentityPayload(payload){
  const undefinedPaths=[],parents=new Set();
  function visit(value,at){
    if(value===undefined){undefinedPaths.push(at);return null;}
    if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return value;
    if(typeof value!=='object'||parents.has(value))throw Error('Identity payload is not a finite acyclic data value');
    parents.add(value);let result;
    if(Array.isArray(value)){
      if(Object.keys(value).length!==value.length||Array.from({length:value.length},(_,i)=>i).some(i=>!Object.hasOwn(value,i)))throw Error('Identity payload contains a sparse or extended array');
      result=value.map((item,i)=>visit(item,[...at,i]));
    }else{
      if(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)throw Error('Identity payload contains a non-data object');
      result=Object.fromEntries(Object.entries(value).map(([key,item])=>[key,visit(item,[...at,key])]));
    }
    parents.delete(value);return result;
  }
  return {version:'identity-payload-v1',value:visit(payload,[]),undefinedPaths};
}

export function decodeIdentityPayload(envelope){
  if(envelope?.version!=='identity-payload-v1'||!same(Object.keys(envelope).sort(),['undefinedPaths','value','version'])||!Array.isArray(envelope.undefinedPaths))throw Error('Invalid identity payload envelope');
  const plain=encodeIdentityPayload(envelope.value);
  if(plain.undefinedPaths.length)throw Error('Identity envelope contains unrecorded undefined fields');
  let value=plain.value;
  for(const at of envelope.undefinedPaths){
    if(!Array.isArray(at))throw Error('Invalid identity undefined path');
    if(!at.length){if(value!==null)throw Error('Invalid identity undefined placeholder');value=undefined;continue;}
    let node=value;
    for(let i=0;i<at.length;i++){
      const key=at[i];
      if(!node||typeof node!=='object'||(Array.isArray(node)?!Number.isInteger(key)||key<0||key>=node.length:typeof key!=='string')||!Object.hasOwn(node,key))throw Error('Invalid identity undefined path');
      if(i===at.length-1){
        if(node[key]!==null)throw Error('Invalid identity undefined placeholder');
        Object.defineProperty(node,key,{value:undefined,writable:true,enumerable:true,configurable:true});
      }else node=node[key];
    }
  }
  if(!same(encodeIdentityPayload(value),envelope))throw Error('Identity payload envelope is not canonical');
  return value;
}

// The first attempt captured its identity before the normal rule GET finished.
// Reconstruct that exact unloaded identity from the fully loaded inputs. This
// exception is possible only with durable zero-POST proof; it never changes a
// production identity check or the user's plan, original input, or marker.
export function bindLoadedRuleSupplement(origin,payloadEnvelope,proof){
  const payload=decodeIdentityPayload(payloadEnvelope);
  const logic=payload?.logic,gap=payload?.gap,rules=logic?.rules?.flatMap(s=>s.rules||[])||[];
  if(proof?.version!=='zero-post-recovery-proof-v1'||proof.paidRequests!==0||proof.originalMarkerPreserved!==true||proof.projectId!==PROJECT||proof.runId!==origin.marker.runId||proof.requestHash!==origin.requestHash||proof.markerSha256!==origin.markerSha256||proof.inputSha256!==origin.inputSha256||proof.confirmationId!==origin.input.authorization.confirmationId||!Number.isFinite(Date.parse(proof.at)))throw Error('Loaded rules require exact durable zero-POST proof');
  // ReportLogicCore.dataRequirement namespaces rule IDs with "req:". Bare
  // rule IDs are not gap requirement IDs and must not be silently accepted.
  const ids=new Set(rules.map(r=>'req:'+r.id));
  if(!(Number(logic?.version)>0)||!rules.length||rules.some(r=>typeof r.id!=='string'||!r.id.trim())||!ids.size||!Array.isArray(gap?.records)||gap.active!==true||gap.valid!==true||gap.issues?.length||gap.records.some(r=>r.status!=='unverified'||r.evidenceIds?.length||r.approval!=null||r.assessment!=null||!r.requirementIds?.length||r.requirementIds.some(id=>!ids.has(id))))throw Error('Rules are not fully loaded or the gap contains new evidence/approval');
  const unloaded={...payload,gap:null,logic:{version:0,scenarioVersion:null,globalRequirements:'',rules:logic.rules.map(s=>({...s,rules:[]}))}};
  const oldIdentity='candidate-input-v1:'+fingerprint(unloaded),loadedIdentity='candidate-input-v1:'+fingerprint(payload);
  if(oldIdentity!==origin.input.authorization.identity.input||oldIdentity===loadedIdentity)throw Error('Changes are not solely unloaded rules and their derived empty-evidence gaps');
  const input=JSON.parse(JSON.stringify(origin.input));input.authorization.identity.input=loadedIdentity;
  return {version:'zero-post-rule-hydration-v1',originalInputSha256:origin.inputSha256,originalMarkerSha256:origin.markerSha256,originalRequestHash:origin.requestHash,originalConfirmationId:input.authorization.confirmationId,proof,payloadEnvelope,payloadSha256:sha(payloadEnvelope),reconstructedUnloadedIdentity:oldIdentity,input,requestHash:sha(input)};
}

export function validateLoadedRuleSupplement(origin,supplement,payloadEnvelope){
  const expected=bindLoadedRuleSupplement(origin,supplement?.payloadEnvelope,supplement?.proof);
  if(!same(expected,supplement)||!same(supplement.payloadEnvelope,payloadEnvelope))throw Error('Saved rule hydration supplement or current loaded inputs changed');
  return {...origin,input:expected.input,requestHash:expected.requestHash};
}

export async function loadedRulePayload(page){
  const captured=await page.evaluate(async()=>{
    const set=await ReportLogicCore.load(rlProjectType());
    if(!set?.data?.rules?.length)throw Error('Project generation rules are not loaded');
    await ensureReportTableTemplates();
    const original=ReportCompletionContract.fingerprint;let payload;
    try{
      ReportCompletionContract.fingerprint=value=>{if(value?.generationRules&&value?.directory)payload=value;return original(value);};
      const identity=reportCandidateInputIdentity();
      if(!payload||identity!=='candidate-input-v1:'+original(payload))throw Error('Could not bind the loaded production input');
      return {payload,identity};
    }finally{ReportCompletionContract.fingerprint=original;}
  });
  // Playwright preserves undefined through its own serializer. Independently
  // verify that boundary before persisting the JSON-friendly envelope.
  const envelope=encodeIdentityPayload(captured.payload);
  if(captured.identity!=='candidate-input-v1:'+fingerprint(decodeIdentityPayload(envelope)))throw Error('Loaded production input changed across browser capture');
  return envelope;
}

// Loading an old attempt does not create a new authorization. The immutable
// sample marker, original input bytes and reviewed original bodies all agree.
export async function loadContinuationOrigin(directory,folder){
  directory=await fs.realpath(directory);folder=await fs.realpath(folder);
  if(path.dirname(folder)!==directory||!path.basename(folder).startsWith('lg-production-continuation-'))throw Error('Resume folder must be the original direct child of the retained QA runner directory');
  const markerBytes=await fs.readFile(path.join(directory,EXECUTION_RECORD),'utf8'),marker=JSON.parse(markerBytes),audit=await readJson(path.join(folder,'audit.json'));
  const inputBytes=await fs.readFile(path.join(folder,'continuation-input.json'),'utf8'),beforeBytes=await fs.readFile(path.join(folder,'browser-before.json'),'utf8');
  const input=JSON.parse(inputBytes),before=JSON.parse(beforeBytes);
  if(marker.projectId!==PROJECT||marker.number!=='6.3'||path.resolve(marker.folder||'')!==folder||marker.runId!==audit.runId||audit.projectId!==PROJECT||audit.execute!==true||audit.number!=='6.3'||sha(inputBytes)!==audit.input?.sha256||sha(beforeBytes)!==audit.browserBefore?.sha256||before.projectId!==PROJECT||input.authorization?.identity?.projectId!==PROJECT||!same(before.identity,input.authorization.identity)||before.plan?.planId!==input.authorization.planId)throw Error('Original execution marker/input/reviewed-source identity mismatch');
  const rows=before.chapters.flatMap((c,ci)=>(c.sections||[]).map((s,si)=>({key:c.name+' / '+s.t,number:(ci+1)+'.'+(si+1),s}))).filter(r=>String(r.s.editedHtml||r.s.content||'').trim());
  if(input.sections?.length!==34||rows.length!==34||new Set(input.sections.map(s=>s.key)).size!==34||input.sections.filter(s=>s.allowConverge).length!==29)throw Error('The original authorization must contain exactly 34 reviewed details / 29 editable details');
  for(const row of rows){const item=input.sections.find(s=>s.key===row.key);if(!item||item.allowConverge!==!KEEP.has(row.number)||item.bodyHash!==sha(bodyOf(row.s))||item.review?.sourceSha256!==sha(String(row.s.editedHtml||row.s.content||''))||item.review.conclusion!=='accepted')throw Error('Original reviewed-source binding changed: '+row.number);}
  const sample=rows.find(s=>s.number==='6.3');if(!sample||!input.sections.find(s=>s.key===sample.key)?.allowConverge)throw Error('Original 6.3 sample is not bound');
  return {folder,marker,audit,input,before,sampleKey:sample.key,rows,requestHash:sha(input),markerSha256:sha(markerBytes),inputSha256:sha(inputBytes)};
}

// A zero-POST recovery is exceptional, explicit and audited. No marker is
// deleted. Any observed request/run changes this into original-task recovery.
export async function proveZeroPostRecovery(origin,live,remote){
  if(savedOf(live)?.run||savedOf(draftOf(remote))?.run||!same(bodyList(live?.chapters),bodyList(origin.before.chapters))||!same(bodyList(draftOf(remote)?.chapters),bodyList(origin.before.chapters)))throw Error('Zero-POST recovery requires unchanged originals and no saved production run');
  const folders=[origin.folder];
  for(const entry of await fs.readdir(origin.folder,{withFileTypes:true}))if(entry.isDirectory()){
    if(!entry.name.startsWith('resume-'))throw Error('Unrecognized prior execution directory');folders.push(path.join(origin.folder,entry.name));
  }
  for(const folder of folders){
    const files=await fs.readdir(folder);
    if(files.some(n=>/^(?:started|result|.*(?:intent|response))\.json$/.test(n)))throw Error('Prior dispatch/pagination intent exists; only original-task GET recovery is permitted');
    if(files.includes('audit.json')){const audit=await readJson(path.join(folder,'audit.json'));if(audit.paidIntents?.length||audit.unknownRequests?.length||audit.started||audit.result||audit.paginationIntents?.length)throw Error('Prior execution cannot be proven zero POST');}
  }
  return {version:'zero-post-recovery-proof-v1',projectId:PROJECT,runId:origin.marker.runId,confirmationId:origin.input.authorization.confirmationId,requestHash:origin.requestHash,markerSha256:origin.markerSha256,inputSha256:origin.inputSha256,at:new Date().toISOString(),paidRequests:0,originalMarkerPreserved:true};
}

export function validateContinuationResume(origin,live,remote,{remaining=false,sampleAudit=null}={}){
  if(remaining&&origin.input.authorization?.sampleReauthorization)throw Error('The renewed authorization covers only 6.3, not the other 28 sections');
  const saved=savedOf(live),run=saved?.run,a=origin.input.authorization;
  if(live?.projectId!==PROJECT||remote?.project?.id!==PROJECT||!same(live.plan,origin.before.plan)||!same(live.identity,a.identity)||!same(bodyList(live.chapters),bodyList(draftOf(remote)?.chapters))||!same(saved,savedOf(draftOf(remote))))throw Error('Current project/plan/input or remote saved bodies changed; no continuation');
  if(!run){if(remaining)throw Error('The original 6.3 sample has not passed');return {zeroPost:true,allowedKeys:[origin.sampleKey],runId:null};}
  if(run.mode!=='reviewed-existing-length-convergence'||!run.runId||!same(run.identity,a.identity)||saved.continuation?.requestHash!==origin.requestHash||run.authorizationToken!=='reviewed|'+origin.requestHash||!same(saved.continuation.authorization,a)||!same(saved.continuation.plan,origin.before.plan))throw Error('Saved production run does not match the original immutable authorization');
  for(const entry of origin.input.sections){
    const s=sectionOf(live.chapters,entry.key),bound=saved.bindings?.[entry.key],row=run.sections?.find(s=>s.key===entry.key);
    if(!s||s.pendingRevision||s.locked||!same(bodyOf(s),bound?.expectedBody)||sha(bodyOf(s))!==row?.bodyHash||row.origin?.bodyHash!==entry.bodyHash||!same(row.origin?.review,entry.review)||!same(bound.reviewedOrigin,row.origin)||!entry.allowConverge&&sha(bodyOf(s))!==entry.bodyHash)throw Error('Live body or reviewed origin binding changed: '+entry.key);
  }
  if(remaining){
    const accepted=verifySampleAcceptance({selectedKey:origin.sampleKey,before:origin.before,after:live,remote,started:sampleAudit?.started,result:sampleAudit?.result});
    if(sampleAudit?.sampleAcceptance?.sampleAccepted!==true||!accepted.sampleAccepted)throw Error('The exact original 6.3 sample must pass independent review and remote adoption before the other 28 sections');
  }
  return {zeroPost:false,runId:run.runId,allowedKeys:remaining?origin.input.sections.filter(s=>s.allowConverge&&s.key!==origin.sampleKey).map(s=>s.key):[origin.sampleKey]};
}

// An expired, never-dispatched run is not silently given more time. The human
// confirmation below creates a separate single-section run through the normal
// production entry. Its old run, permanent marker and input remain untouched.
export async function proveExpiredZeroDispatch(origin,live,remote,now=Date.now(),currentSourceChecks=null){
  const resumed=validateContinuationResume(origin,live,remote),saved=savedOf(live),run=saved?.run;
  if(!resumed.runId||!Number.isFinite(run.startedAt)||run.limits?.maxElapsedMs!==1800000||now<run.startedAt+run.limits.maxElapsedMs||run.permits?.length!==0||run.additionalCalls!==0||run.paginationPasses!==0||!same(bodyList(live.chapters),bodyList(origin.before.chapters))||Object.values(saved.bindings||{}).some(b=>b.convergenceResponse||b.convergenceReview||b.provisional||b.lastCompletedPermitId))throw Error('Renewal requires an expired unchanged run with zero dispatch, pagination and response');
  const folders=[origin.folder],evidence=[];let ended=false;
  for(const e of await fs.readdir(origin.folder,{withFileTypes:true}))if(e.isDirectory()){
    if(!e.name.startsWith('resume-'))throw Error('Unrecognized execution directory');folders.push(path.join(origin.folder,e.name));
  }
  for(const folder of folders){
    const names=await fs.readdir(folder);
    if(names.some(n=>/(?:intent|response|unknown)\.json$/.test(n)))throw Error('An intent or response exists; recover its original task by GET only');
    if(!names.includes('audit.json')){if(names.includes('started.json')||names.includes('result.json'))throw Error('Prior runner has no final audit');continue;}
    const file=path.join(folder,'audit.json'),bytes=await fs.readFile(file),a=JSON.parse(bytes);
    if(a.paidIntents?.length||a.unknownRequests?.length||a.paginationIntents?.length||a.originalProjectWrites)throw Error('Prior audit cannot prove zero dispatch and unchanged sources');
    const sourceChecks=Object.values(a.sourceUnchangedAfter||{});
    if(sourceChecks.some(v=>v!==true)){
      // A failed environment preflight never opened a browser. Keep its unknown
      // source check as unknown; require fresh checks of both originals instead.
      if(sourceChecks.some(v=>v!==true&&v!==null)||names.length!==1||names[0]!=='audit.json'||a.started||a.input||a.backup||a.browserBefore||a.remoteAfter||a.newProductionRunCreated!==false||a.newReceiptCreated!==false||!a.sourceCheckErrors||currentSourceChecks?.tax!==true||currentSourceChecks?.longgang!==true)throw Error('Prior audit cannot prove zero dispatch and unchanged sources');
    }
    if(a.started){
      if(a.started.run?.runId!==run.runId||a.started.run.permits?.length||a.started.run.additionalCalls||a.started.run.paginationPasses||!Number.isFinite(Date.parse(a.finishedAt))||!a.remoteAfter?.file||a.sourceUnchangedAfter?.tax!==true||a.sourceUnchangedAfter?.longgang!==true)throw Error('Prior started run lacks its exact completed zero-dispatch audit');
      if(path.dirname(path.resolve(a.remoteAfter.file))!==folder)throw Error('Final snapshot is outside its audit folder');
      const remoteBytes=await fs.readFile(a.remoteAfter.file),old=JSON.parse(remoteBytes);
      if(sha(remoteBytes)!==a.remoteAfter.sha256||!same(savedOf(draftOf(old)),saved)||!same(bodyList(draftOf(old)?.chapters),bodyList(live.chapters)))throw Error('Final remote snapshot does not bind the expired run');
      ended=true;evidence.push({file:a.remoteAfter.file,sha256:sha(remoteBytes)});
    }
    evidence.push({file,sha256:sha(bytes)});
  }
  if(!ended)throw Error('No completed audit proves the expired run stopped');
  return {version:'expired-zero-dispatch-proof-v1',projectId:PROJECT,originalRunId:origin.marker.runId,priorRunId:run.runId,priorRunSha256:sha(run),priorSessionSha256:sha(saved),originalMarkerSha256:origin.markerSha256,originalInputSha256:origin.inputSha256,effectiveRequestHash:origin.requestHash,bodySha256:sha(bodyList(live.chapters)),priorStartedAt:run.startedAt,priorDeadline:run.startedAt+run.limits.maxElapsedMs,paidRequests:0,paginationRequests:0,at:new Date(now).toISOString(),evidence};
}

export function bindSampleReauthorization(origin,proof,confirmation,{legacyAllocation=false}={}){
  const c=confirmation,p=proof;
  if(p?.version!=='expired-zero-dispatch-proof-v1'||p.projectId!==PROJECT||p.originalRunId!==origin.marker.runId||p.originalMarkerSha256!==origin.markerSha256||p.originalInputSha256!==origin.inputSha256||p.effectiveRequestHash!==origin.requestHash||p.bodySha256!==sha(bodyList(origin.before.chapters))||p.paidRequests!==0||p.paginationRequests!==0||!p.priorRunId||!Number.isFinite(p.priorStartedAt)||p.priorDeadline!==p.priorStartedAt+1800000||!Number.isFinite(Date.parse(p.at))||Date.parse(p.at)<p.priorDeadline||!p.evidence?.length||[p.priorRunSha256,p.priorSessionSha256].some(x=>!/^[a-f0-9]{64}$/.test(x||'')))throw Error('Renewal requires exact expired zero-dispatch proof');
  if(c?.version!=='sample-reauthorization-v1'||c.authorized!==true||c.projectId!==PROJECT||c.priorRunId!==p.priorRunId||c.sectionNumber!=='6.3'||c.sectionKey!==origin.sampleKey||c.maxElapsedMs!==1800000||c.maxConvergenceCalls!==1||c.maxReviewCalls!==1||typeof c.confirmationId!=='string'||!c.confirmationId.trim()||c.confirmationId===origin.input.authorization.confirmationId||!Number.isFinite(Date.parse(c.confirmedAt))||Date.parse(c.confirmedAt)<p.priorDeadline||Date.parse(c.confirmedAt)>Date.parse(p.at)||typeof c.userConfirmation!=='string'||!c.userConfirmation.trim())throw Error('An explicit new 30-minute, 6.3-only human confirmation is required');
  const input=JSON.parse(JSON.stringify(origin.input));
  input.sections.forEach(s=>{if(!legacyAllocation)s.allowBudgetAllocation=s.allowConverge;s.allowConverge=s.key===origin.sampleKey;});
  input.authorization={...input.authorization,confirmationId:c.confirmationId,confirmedAt:c.confirmedAt,sampleReauthorization:{priorRunId:p.priorRunId,priorRunSha256:p.priorRunSha256,proofSha256:sha(p),confirmationSha256:sha(c),sectionKey:origin.sampleKey,maxElapsedMs:1800000,maxConvergenceCalls:1,maxReviewCalls:1}};
  return {version:legacyAllocation?'reviewed-sample-reauthorization-v1':'reviewed-sample-reauthorization-v2',proof:p,confirmation:c,input,requestHash:sha(input)};
}

export async function validateSampleReauthorization(origin,receipt){
  // Existing permanent receipts keep their exact original input and request
  // hash. The new allocation field applies only when creating a new receipt.
  if(!['reviewed-sample-reauthorization-v1','reviewed-sample-reauthorization-v2'].includes(receipt?.version)||!same(receipt,bindSampleReauthorization(origin,receipt?.proof,receipt?.confirmation,{legacyAllocation:receipt.version==='reviewed-sample-reauthorization-v1'})))throw Error('Permanent sample reauthorization changed');
  for(const record of receipt.proof.evidence){
    const relative=path.relative(origin.folder,path.resolve(record.file));
    if(relative.startsWith('..')||path.isAbsolute(relative)||sha(await fs.readFile(record.file))!==record.sha256)throw Error('Renewal zero-dispatch evidence changed');
  }
  return {...origin,input:receipt.input,requestHash:receipt.requestHash};
}

export function verifyReauthorizedStart(receipt,started,state){
  const saved=savedOf(state),run=saved?.run,old=saved?.history?.filter(h=>h.run?.runId===receipt.proof.priorRunId);
  if(started?.resumed!==false||started.run?.runId!==run?.runId||run.runId===receipt.proof.priorRunId||run.authorizationToken!=='reviewed|'+receipt.requestHash||run.limits?.maxElapsedMs!==1800000||run.limits.maxAdditionalCalls!==1||run.limits.maxAdditionalCallsPerSection!==1||run.permits?.length!==0||run.additionalCalls!==0||!same(run.sections.filter(s=>s.eligible).map(s=>s.key),[receipt.confirmation.sectionKey])||old?.length!==1||sha(old[0].run)!==receipt.proof.priorRunSha256||saved.continuation?.requestHash!==receipt.requestHash)throw Error('New sample run exceeded its authorization or did not preserve the exact expired run');
  return true;
}

// A crash before start can use the same receipt once; after start only that
// saved run can resume. Missing/replaced state must never create a third run.
export async function resolveSampleReauthorization(origin,receipt,live,remote,{remaining=false,now=Date.now(),currentSourceChecks=null}={}){
  const renewed=await validateSampleReauthorization(origin,receipt);
  if(remaining)throw Error('The renewed authorization covers only 6.3, not the other 28 sections');
  const saved=savedOf(live),run=saved?.run;
  if(run?.runId===receipt.proof.priorRunId){
    const current=await proveExpiredZeroDispatch(origin,live,remote,now,currentSourceChecks);
    if(current.priorRunSha256!==receipt.proof.priorRunSha256||current.priorSessionSha256!==receipt.proof.priorSessionSha256)throw Error('Expired run changed after human confirmation');
    return {origin:renewed,newRun:true,runId:null,allowedKeys:[origin.sampleKey]};
  }
  if(!run||run.limits?.maxElapsedMs!==1800000||run.limits.maxAdditionalCalls!==1||run.limits.maxAdditionalCallsPerSection!==1||!same(run.sections?.filter(s=>s.eligible).map(s=>s.key),[origin.sampleKey])||!saved.history?.some(h=>h.run?.runId===receipt.proof.priorRunId&&sha(h.run)===receipt.proof.priorRunSha256))throw Error('The one authorized renewed run is missing or changed; no fresh start');
  const resumed=validateContinuationResume(renewed,live,remote);
  return {origin:renewed,newRun:false,...resumed};
}

// This is a new human authorization, not an extension of a paid permit. The
// previous response must reach the production no-effect terminal first.
export function proveRetainedNoop(origin,live,remote,recovery,{terminal=true,now=Date.now()}={}){
  validateContinuationResume(origin,live,remote);
  const saved=savedOf(live),run=saved.run,key=origin.sampleKey,b=saved.bindings[key],s=sectionOf(live.chapters,key),ps=run.permits||[],convergence=ps.filter(p=>p.kind==='length-converge'&&p.key===key),p=convergence[0],r=b?.convergenceResponse,g=recovery;
  const task=s.executionTask??null,original=b?.reviewedOrigin?.originalExecutionTask??null;
  if(g?.version!=='slim-start-get-recovery-v1'||g.projectId!==PROJECT||g.sectionKey!==key||g.runId!==run.runId||g.paidRequests!==0||g.adopted!==false||g.reviewed!==false||g.bodySha256!==sha(bodyList(live.chapters))||g.planSha256!==sha(live.plan)||g.deadline!==run.startedAt+1800000||run.limits.maxElapsedMs!==1800000||run.limits.maxAdditionalCalls!==1||run.additionalCalls!==1||!Number.isFinite(now)||now<g.deadline||convergence.length!==1||ps.some(q=>q!==p&&(q.kind!=='paginate-details'||q.status!=='completed'))||p.id!==g.permitId||p.taskId!==g.taskId||p.backendRunId!==g.backendRunId||p.inputHash!==g.inputHash||!same(run.sections.filter(s=>s.eligible).map(s=>s.key),[key])||!same(bodyList(live.chapters),bodyList(origin.before.chapters))||b.provisional||b.convergenceReview||b.lastCompletedPermitId||!r||r.permitId!==p.id||r.hash!==g.responseSha256||sha(r.text)!==g.responseSha256||r.validated!==false||!same(bodyOf(s),b.expectedBody)||s.pendingRevision||s.locked)throw Error('Exact expired paid response / unchanged unadopted body proof is required');
  if(task&&!same(task,original)&&(task.id!==g.taskId||task.runId!==g.backendRunId||task.graph?.find(n=>n.key==='context_snapshot')?.hash!==g.inputHash))throw Error('Current task is not the retained unadopted original request');
  if(terminal?(p.status!=='completed'||p.outcome!=='no-effective-reduction'||r.effectiveness?.version!=='initial-convergence-effectiveness-v1'||r.effectiveness.effective!==false||r.effectiveness.sourceHash!==g.sourceSha256||r.effectiveness.textHash!==g.responseSha256):!['uncertain','reserved','completed'].includes(p.status))throw Error('Production no-effect terminal / effectiveness evidence is required');
  return {version:'expired-retained-noop-proof-v1',projectId:PROJECT,originalRunId:origin.marker.runId,originalMarkerSha256:origin.markerSha256,originalInputSha256:origin.inputSha256,effectiveRequestHash:origin.requestHash,priorRunId:run.runId,priorRunSha256:sha(run),priorSessionSha256:sha(saved),priorStartedAt:run.startedAt,priorDeadline:g.deadline,bodySha256:g.bodySha256,planSha256:g.planSha256,recovery:g,retainedTask:task,originalExecutionTask:original,oldPaidRequests:1,preparationPaidRequests:0,adopted:false,reviewed:false,at:new Date(now).toISOString()};
}

export function bindRetainedNoopReauthorization(original,oldOrigin,proof,c){
  const p=proof,oldConfirmation=oldOrigin.input.authorization.confirmationId;
  if(p?.version!=='expired-retained-noop-proof-v1'||p.projectId!==PROJECT||p.originalMarkerSha256!==original.markerSha256||p.originalInputSha256!==original.inputSha256||p.effectiveRequestHash!==oldOrigin.requestHash||p.bodySha256!==sha(bodyList(original.before.chapters))||p.oldPaidRequests!==1||p.preparationPaidRequests!==0||p.adopted!==false||p.reviewed!==false||!Number.isFinite(p.priorStartedAt)||p.priorDeadline!==p.priorStartedAt+1800000||!Number.isFinite(Date.parse(p.at))||Date.parse(p.at)<p.priorDeadline||!p.evidence?.length)throw Error('Exact terminal retained no-op proof is required');
  if(c?.version!=='sample-retained-noop-reauthorization-v1'||c.authorized!==true||c.projectId!==PROJECT||c.priorRunId!==p.priorRunId||c.sectionNumber!=='6.3'||c.sectionKey!==original.sampleKey||c.maxElapsedMs!==1800000||c.maxConvergenceCalls!==1||c.maxReviewCalls!==1||typeof c.confirmationId!=='string'||!c.confirmationId.trim()||[original.input.authorization.confirmationId,oldConfirmation].includes(c.confirmationId)||!Number.isFinite(Date.parse(c.confirmedAt))||Date.parse(c.confirmedAt)<=p.priorDeadline||Date.parse(c.confirmedAt)>Date.parse(p.at)||typeof c.userConfirmation!=='string'||!c.userConfirmation.trim()||typeof c.recoveryFolder!=='string'||!c.recoveryFolder.trim())throw Error('A distinct new 6.3-only 30-minute human confirmation is required');
  const input=structuredClone(original.input);
  input.sections.forEach(s=>{s.allowBudgetAllocation=s.allowConverge;s.allowConverge=s.key===original.sampleKey;});
  input.authorization={...input.authorization,confirmationId:c.confirmationId,confirmedAt:c.confirmedAt,sampleReauthorization:{priorRunId:p.priorRunId,priorRunSha256:p.priorRunSha256,proofSha256:sha(p),confirmationSha256:sha(c),sectionKey:original.sampleKey,maxElapsedMs:1800000,maxConvergenceCalls:1,maxReviewCalls:1}};
  return {version:'reviewed-retained-noop-reauthorization-v1',proof:p,confirmation:c,input,requestHash:sha(input),claimNamespace:'resume-authorized-'+sha(c).slice(0,24)};
}

// buildDraftData persists absent failure values as null. Only that exact
// serialization difference is equivalent; nonempty failures remain CAS data.
function retainedNoopSavedChapters(chapters){
  const copy=structuredClone(chapters);
  for(const c of copy||[])for(const s of c.sections||[])for(const key of ['generationFailure','candidateGenerationFailure']){
    const value=s[key];delete s[key];s[key]=value==null?null:value;
  }
  return copy;
}

export async function restoreRetainedNoopTask({live,proof,readState,readRemote,commit}){
  if(proof?.version!=='expired-retained-noop-proof-v1'||proof.priorSessionSha256!==sha(savedOf(live))||!same(sectionOf(live.chapters,proof.recovery.sectionKey)?.executionTask??null,proof.retainedTask??null))throw Error('Retained task restoration proof changed');
  if(!same(await readState(),live))throw Error('Browser changed before retained task restoration');
  const remote=await readRemote();
  if(remote.project?.id!==PROJECT||!isDeepStrictEqual(retainedNoopSavedChapters(draftOf(remote).chapters),retainedNoopSavedChapters(live.chapters))||!same(draftOf(remote).workflow,live.workflow)||!same(await readState(),live))throw Error('Remote/browser changed before retained task restoration');
  const expected=structuredClone(live);sectionOf(expected.chapters,proof.recovery.sectionKey).executionTask=structuredClone(proof.originalExecutionTask);
  if(!same(live,expected)){const result=await commit(live,proof);if(result?.remote!==true)throw Error('Retained task restoration save failed');}
  if(!same(await readState(),expected))throw Error('Retained task restoration changed other state');
  const after=await readRemote();if(after.project?.id!==PROJECT||!isDeepStrictEqual(retainedNoopSavedChapters(draftOf(after).chapters),retainedNoopSavedChapters(expected.chapters))||!same(draftOf(after).workflow,expected.workflow)||!same(await readState(),expected))throw Error('Retained task restoration readback changed');
  return {remoteSaved:true,bodyUnchanged:true,restoredTaskSha256:sha(proof.originalExecutionTask),stateAfterSha256:sha(expected)};
}

export function retainedNoopStartedReceipt(receipt,live){
  const run=savedOf(live)?.run;
  if(!run||!Number.isFinite(run.startedAt))throw Error('Authorized run start identity is missing');
  return {version:'retained-noop-authorized-start-v1',receiptSha256:sha(receipt),confirmationId:receipt.confirmation.confirmationId,requestHash:receipt.requestHash,runId:run.runId,startedAt:run.startedAt,deadline:run.startedAt+1800000};
}

export function resolveRetainedNoopStart(receipt,live,{startIntentExists=false,startedReceipt=null}={}){
  const saved=savedOf(live),run=saved?.run;
  if(run?.runId===receipt.proof.priorRunId){
    if(startIntentExists||startedReceipt)throw Error('A new start was already attempted; do not repeat an uncertain start');
    if(sha(run)!==receipt.proof.priorRunSha256||sha(saved)!==receipt.proof.priorSessionSha256)throw Error('Old terminal run changed after authorization');
    return {newRun:true,runId:null};
  }
  if(!startIntentExists||!run||saved.continuation?.requestHash!==receipt.requestHash||run.authorizationToken!=='reviewed|'+receipt.requestHash||run.limits.maxAdditionalCalls!==1||run.limits.maxAdditionalCallsPerSection!==1||run.limits.maxElapsedMs!==1800000||!same(run.sections.filter(s=>s.eligible).map(s=>s.key),[receipt.confirmation.sectionKey])||saved.history?.filter(h=>h.run?.runId===receipt.proof.priorRunId&&sha(h.run)===receipt.proof.priorRunSha256).length!==1||startedReceipt&&!same(startedReceipt,retainedNoopStartedReceipt(receipt,live)))throw Error('The single new authorized run is missing/replaced; no fresh start');
  return {newRun:false,runId:run.runId};
}

// Durable per-section claims survive process restarts. An intent is written
// before the network call; an unknown/failed response is never another POST.
export function scopedContinuationPaidRoute({origin,input,allowedKeys,readState,fromPage,claim,respond,onTask=()=>{},onUnknown=()=>{},now=()=>Date.now()}){
  const allowed=new Set(allowedKeys);
  return async route=>{
    const request=route.request(),url=new URL(request.url());
    if(request.method()!=='POST'||!['/api/reportexecution','/api/generate','/api/agent'].includes(url.pathname))return route.fallback();
    const refuse=()=>route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({ok:false,error:'Only one bound convergence and one independent review per authorized remaining section; existing requests recover by GET only.'})});
    let intent;
    try{
      const body=request.postDataJSON(),user=JSON.parse(body.user),kind=user.purpose==='initial-length-convergence-v1'?'converge':user.purpose==='initial-length-preservation-v1'?'review':null;
      if(url.origin!==origin||url.search||url.pathname!=='/api/reportexecution'||body.action||body.projectId!==PROJECT||!allowed.has(body.sectionKey)||!kind||!fromPage(request))return refuse();
      const state=await readState(),saved=savedOf(state),run=saved?.run,entry=input.sections.find(s=>s.key===body.sectionKey),binding=saved?.bindings?.[body.sectionKey],wire=kind==='converge'?user:user.binding;
      const renewed=input.authorization?.sampleReauthorization;
      if(renewed&&(body.sectionKey!==renewed.sectionKey||run?.limits?.maxAdditionalCalls!==1||run.limits.maxElapsedMs!==1800000||!Number.isFinite(run.startedAt)||now()>=run.startedAt+1800000))return refuse();
      const permit=run?.permits?.find(p=>p.id===wire?.permitId);
      const open=permit?.status==='reserved'||kind==='review'&&permit?.status==='uncertain'&&!!permit.taskId&&!!permit.backendRunId&&!!permit.inputHash;
      if(!entry?.allowConverge||state.projectId!==PROJECT||saved?.continuation?.requestHash!==sha(input)||!same(saved.continuation.authorization,input.authorization)||!same(state.identity,input.authorization.identity)||!same(state.plan,saved.continuation.plan)||run?.mode!=='reviewed-existing-length-convergence'||!same(run.identity,input.authorization.identity)||run.authorizationToken!=='reviewed|'+sha(input)||permit?.key!==body.sectionKey||permit.kind!=='length-converge'||!open||permit.runId!==run.runId||permit.planId!==input.authorization.planId||wire.idempotencyKey!==permit.idempotencyKey||wire.batchId!==permit.batchId||!same(wire.referenceBudget,permit.referenceBudget)||binding?.reviewedOrigin?.sourceHash!==sha(user.source))return refuse();
      if(kind==='converge'&&(permit.taskId||binding.convergenceResponse||binding.convergenceReview))return refuse();
      if(kind==='review'&&(!binding.convergenceResponse||binding.convergenceResponse.permitId!==permit.id||user.text!==binding.convergenceResponse.text||wire.sourceHash!==sha(user.source)||wire.textHash!==sha(user.text)||binding.convergenceReview?.state?.task||!same(binding.convergenceReview?.state?.binding,wire)))return refuse();
      intent={projectId:PROJECT,runId:run.runId,confirmationId:input.authorization.confirmationId,requestHash:sha(input),sectionKey:body.sectionKey,kind,permitId:permit.id,requestSha256:sha(request.postData()),at:new Date().toISOString()};
      await claim(intent);
    }catch{return refuse();}
    try{
      const response=await route.fetch({timeout:190000,maxRetries:0}),bytes=await response.body();let data;try{data=JSON.parse(bytes);}catch{}
      await respond({...intent,status:response.status(),responseSha256:sha(bytes),data});
      if(data?.task?.id)onTask(data.task.id);await route.fulfill({response});
    }catch(e){try{await onUnknown({...intent,error:safe(e)});}finally{await route.abort('failed').catch(()=>{});}}
  };
}

async function browserState(page){return page.evaluate(()=>({projectId:currentProjectId,chapters:ProjectWorkflow.clone(chapters),workflow:ProjectWorkflow.clone(projectWorkflow),plan:ReportLengthUI.savedPlan(),identity:{projectId:currentProjectId,research:window.ResearchUI?.active()?ResearchUI.capture('report').runId:null,input:reportCandidateInputIdentity()},plannerReady:typeof window.ReportInitialDelivery?.createReviewedContinuation==='function',workflowReady:!!projectWorkflow}));}

// A slim POST receipt is not a completed task. This exceptional recovery joins
// that immutable receipt to the original DB input and its GET response; it can
// only fill missing identity fields, never reset a permit or authorize a call.
export function bindSlimStartRecovery({input,live,intent,receipt,row,task,userId}){
  const saved=savedOf(live),run=saved?.run,key='改造运营方案 / 运营方案',s=sectionOf(live.chapters,key);
  const permits=run?.permits?.filter(p=>p.kind==='length-converge'&&p.key===key)||[],p=permits[0],binding=saved?.bindings?.[key];
  const source=String(s?.editedHtml||s?.content||''),snapshot=typeof row?.input_json==='string'?JSON.parse(row.input_json):row?.input_json;
  const contract=snapshot?.qualityContract,allocation=contract?.initialLengthConvergence;
  let request;try{request=JSON.parse(snapshot?.user);}catch{throw Error('Original task does not have its structured convergence request');}
  const hash=task?.graph?.find(n=>n.key==='context_snapshot')?.hash;
  if(live.projectId!==PROJECT||live.identity?.research!==null||!same(live.identity,input?.authorization?.identity)||saved?.continuation?.requestHash!==sha(input)||run?.authorizationToken!=='reviewed|'+sha(input)||run?.mode!=='reviewed-existing-length-convergence'||run.limits?.maxAdditionalCalls!==1||!same(run.sections.filter(x=>x.eligible).map(x=>x.key),[key])||permits.length!==1||!['reserved','uncertain'].includes(p?.status)||p.taskId!==task?.id||p.runId!==run.runId||p.planId!==live.plan?.planId||!same(p.identity,live.identity)||!source||s.locked||s.pendingRevision||binding?.provisional||binding?.convergenceReview||binding?.lastCompletedPermitId||!same(binding?.expectedBody,bodyOf(s))||sha(bodyOf(s))!==p.expectedBodyHash)throw Error('Original one-section authorization/body/permit no longer matches');
  const {status,responseSha256,data,...receiptIntent}=receipt||{};
  if(!same(receiptIntent,intent)||intent.projectId!==PROJECT||intent.runId!==run.runId||intent.confirmationId!==input.authorization.confirmationId||intent.requestHash!==sha(input)||intent.sectionKey!==key||intent.kind!=='converge'||intent.permitId!==p.id||!/^[a-f0-9]{64}$/.test(intent.requestSha256||'')||status!==200||data?.ok!==true||data.task?.reused!==false||data.task.id!==task?.id||data.task.runId!==task?.runId||!/^[a-f0-9]{64}$/.test(responseSha256||''))throw Error('Permanent POST receipt does not bind this exact task');
  if(row?.id!==task.id||row.project_id!==PROJECT||String(row.user_id)!==String(userId)||row.section_key!==key||row.run_id!==task.runId||row.input_hash!==hash||sha(snapshot)!==hash||'rsec_'+sha([userId,PROJECT,hash])!==task.id||task.status!=='completed'||task.rulesChanged!==false||typeof task.text!=='string'||!task.text.trim())throw Error('GET task/immutable database input binding is incomplete or changed');
  if(snapshot.research||snapshot.sectionKey!==key||snapshot.initialLengthSource!==source||contract?.sectionKey!==key||allocation?.sourceHash!==sha(source)||allocation.permitId!==p.id||allocation.idempotencyKey!==p.idempotencyKey||allocation.batchId!==p.batchId||!same(allocation.referenceBudget,p.referenceBudget)||allocation.planId!==contract.planId||request.sectionKey!==key||request.permitId!==p.id||request.idempotencyKey!==p.idempotencyKey||request.batchId!==p.batchId||!same(request.referenceBudget,p.referenceBudget)||request.source!==source||contract.frozenTables||contract.documentReferences||s.numeric)throw Error('Original source/contract/request is not the exact non-financial sample');
  const context={contract,financialSource:null,generationInputIdentity:live.identity.input,bodyAtStart:source,initialDraftSource:source};
  const fields={backendRunId:task.runId,inputHash:hash,recoveryContext:context};
  for(const [name,value] of Object.entries(fields))if(p[name]!=null&&!same(p[name],value))throw Error('Existing recovery metadata conflicts: '+name);
  if(s.executionTask&&(s.executionTask.id!==task.id||s.executionTask.runId!==task.runId||s.executionTask.graph?.find(n=>n.key==='context_snapshot')?.hash!==hash))throw Error('Section already has another task');
  if(binding.convergenceResponse&&(binding.convergenceResponse.permitId!==p.id||binding.convergenceResponse.text!==task.text||binding.convergenceResponse.hash!==sha(task.text)||binding.convergenceResponse.validated!==false))throw Error('Retained response changed or was already certified');
  return {version:'slim-start-get-recovery-v1',projectId:PROJECT,sectionKey:key,runId:run.runId,permitId:p.id,taskId:task.id,backendRunId:task.runId,inputHash:hash,sourceSha256:sha(source),bodySha256:sha(bodyList(live.chapters)),planSha256:sha(live.plan),runBeforeSha256:sha(run),stateBeforeSha256:sha(live),intentSha256:sha(intent),receiptSha256:sha(receipt),snapshotSha256:sha(snapshot),responseSha256:sha(task.text),deadline:run.startedAt+run.limits.maxElapsedMs,fields,paidRequests:0,adopted:false,reviewed:false};
}

export async function restoreSlimStartMetadata({live,proof,readState,readRemote,commit}){
  if(proof?.version!=='slim-start-get-recovery-v1'||proof.stateBeforeSha256!==sha(live)||proof.projectId!==PROJECT||proof.paidRequests!==0||proof.adopted!==false||proof.reviewed!==false)throw Error('Missing exact recovery proof');
  if(!same(await readState(),live))throw Error('Browser changed before metadata recovery');
  const remote=await readRemote();
  if(remote.project?.id!==PROJECT||!same(bodyList(draftOf(remote)?.chapters),bodyList(live.chapters))||!same(savedOf(draftOf(remote)),savedOf(live)))throw Error('Remote changed before metadata recovery');
  // commit must use the app's versioned save and compare the exact browser state
  // again after its permission await. The source and deadline are not patched.
  const result=await commit(live,proof);
  if(result?.remote!==true)throw Error('Recovery metadata was not confirmed saved remotely');
  const after=await readState(),expected=structuredClone(live),p=savedOf(expected).run.permits.find(p=>p.id===proof.permitId);
  Object.assign(p,proof.fields);
  if(!same(after,expected))throw Error('Metadata recovery changed more than its missing identity fields');
  const saved=await readRemote();
  if(saved.project?.id!==PROJECT||!same(bodyList(draftOf(saved)?.chapters),bodyList(after.chapters))||!same(savedOf(draftOf(saved)),savedOf(after)))throw Error('Metadata recovery remote readback differs');
  return {stateAfterSha256:sha(after),remoteSaved:true,bodyUnchanged:sha(bodyList(after.chapters))===proof.bodySha256,deadlineUnchanged:savedOf(after).run.startedAt+savedOf(after).run.limits.maxElapsedMs===proof.deadline};
}

async function readOriginalTaskRow(taskId){
  const {Client}=require('../local-server/node_modules/pg'),db=new Client({connectionString:process.env.DATABASE_URL});await db.connect();
  try{await db.query('BEGIN READ ONLY');const rows=(await db.query('SELECT id,project_id,user_id,section_key,input_hash,run_id,input_json FROM report_section_tasks WHERE id=$1',[taskId])).rows;await db.query('ROLLBACK');if(rows.length!==1)throw Error('Original task database row is not unique');return rows[0];}finally{await db.end();}
}

async function recoverSlimStart({h,isolation,input,before,folder,recordFolder,audit}){
  const stem='section-'+sha('改造运营方案 / 运营方案').slice(0,24)+'-converge-',intent=await readJson(path.join(recordFolder,stem+'intent.json')),receipt=await readJson(path.join(recordFolder,stem+'response.json'));
  const id=receipt.data?.task?.id;if(!id)throw Error('No original POST task id; GET recovery refused');
  const row=await readOriginalTaskRow(id),data=await isolation.sessions.longgang.request('/api/reportexecution?id='+encodeURIComponent(id));
  const proof=bindSlimStartRecovery({input,live:before,intent,receipt,row,task:data.task,userId:isolation.sessions.longgang.user.id});
  // All backups are exclusive and read back before any metadata write.
  audit.taskInputBackup=await exclusive(path.join(folder,'original-task-input.json'),row);
  audit.taskGetBackup=await exclusive(path.join(folder,'original-task-get.json'),data);
  audit.recoveryProof=await exclusive(path.join(folder,'slim-start-recovery-proof.json'),proof);
  const readRemote=()=>isolation.sessions.longgang.request('/api/projects?id='+PROJECT);
  audit.metadataRecovery=await restoreSlimStartMetadata({live:before,proof,readState:()=>browserState(h.page),readRemote,commit:(expected,proof)=>h.page.evaluate(async({expected,proof})=>{
    const capture=()=>({projectId:currentProjectId,chapters:ProjectWorkflow.clone(chapters),workflow:ProjectWorkflow.clone(projectWorkflow),plan:ReportLengthUI.savedPlan(),identity:{projectId:currentProjectId,research:window.ResearchUI?.active()?ResearchUI.capture('report').runId:null,input:reportCandidateInputIdentity()},plannerReady:typeof window.ReportInitialDelivery?.createReviewedContinuation==='function',workflowReady:!!projectWorkflow});
    const check=()=>{if(JSON.stringify(capture())!==JSON.stringify(expected))throw Error('Browser CAS changed during recovery');};
    check();const guard=reportCaptureGenerationContext();await reportGuardGenerationContext(guard);check();
    const p=projectWorkflow.reportCompletion.initialDelivery.run.permits.find(p=>p.id===proof.permitId);Object.assign(p,proof.fields);
    const patched=capture(),saved=await persistReportDraft();await reportGuardGenerationContext(guard);
    if(JSON.stringify(capture())!==JSON.stringify(patched))throw Error('Browser changed while saving metadata');return saved;
  },{expected,proof})});
  emit('original-task-metadata-restored',{taskId:id,paid:0});
  // The original production recovery performs all contract/source/quality
  // checks. Do not call finish: that would request a separate paid review.
  audit.started=await h.page.evaluate(input=>ReportInitialDeliveryRuntime.startReviewedContinuation(input),input);
  if(audit.started.run?.runId!==proof.runId||audit.started.resumed!==true)throw Error('Original production run was not resumed');
  const recovery={permitId:proof.permitId,taskId:id,idempotencyKey:savedOf(before).run.permits.find(p=>p.id===proof.permitId).idempotencyKey,backendRunId:proof.backendRunId,inputHash:proof.inputHash,context:proof.fields.recoveryContext};
  const result=await h.page.evaluate(async({key,recovery})=>{
    const c=chapters.find(c=>c.sections.some(s=>c.name+' / '+s.t===key)),s=c.sections.find(s=>c.name+' / '+s.t===key);
    const text=await reportRecoverInitialDeliveryTask(c,s,recovery);
    await ReportInitialDeliveryRuntime.assertRecoveryTask(c,s,recovery);
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),n=>n.toString(16).padStart(2,'0')).join('');
    await ReportInitialDeliveryRuntime.assertRecoveryTask(c,s,recovery);
    const binding=projectWorkflow.reportCompletion.initialDelivery.bindings[key],old=binding.convergenceResponse;
    if(old&&(old.permitId!==recovery.permitId||old.text!==text||old.hash!==hash||old.validated!==false))throw Error('Saved response changed during GET recovery');
    binding.convergenceResponse=old||{permitId:recovery.permitId,text,hash,at:Date.now(),validated:false};
    const saved=await persistReportDraft();await ReportInitialDeliveryRuntime.assertRecoveryTask(c,s,recovery);
    if(saved.remote!==true)throw Error('Recovered response remote save not confirmed');
    return {taskId:recovery.taskId,textHash:hash,textLength:text.length,remoteSaved:true,adopted:false,reviewed:false,paidRequests:0};
  },{key:proof.sectionKey,recovery});
  const after=await browserState(h.page),remote=await readRemote(),saved=savedOf(after),p=saved.run.permits.find(p=>p.id===proof.permitId),response=saved.bindings[proof.sectionKey].convergenceResponse;
  if(result.textHash!==proof.responseSha256||response.hash!==proof.responseSha256||response.validated!==false||sha(bodyList(after.chapters))!==proof.bodySha256||sha(after.plan)!==proof.planSha256||saved.run.startedAt+saved.run.limits.maxElapsedMs!==proof.deadline||p.status!==savedOf(before).run.permits.find(x=>x.id===p.id).status||!same(saved,savedOf(draftOf(remote)))||!same(bodyList(after.chapters),bodyList(draftOf(remote).chapters)))throw Error('GET recovery readback/source/deadline mismatch');
  audit.getRecovery={...result,bodyUnchanged:true,deadlineUnchanged:true};await exclusive(path.join(folder,'get-recovery-result.json'),audit.getRecovery);emit('original-task-result-retained',audit.getRecovery);
}

async function acceptedSampleAudit(origin){
  const folders=[origin.folder,...(await fs.readdir(origin.folder,{withFileTypes:true})).filter(e=>e.isDirectory()&&e.name.startsWith('resume-')).map(e=>path.join(origin.folder,e.name))];
  for(const folder of folders){let audit;try{audit=await readJson(path.join(folder,'audit.json'));}catch(e){if(e.code==='ENOENT')continue;throw e;}if(!audit.remaining&&audit.sampleAcceptance?.sampleAccepted===true&&audit.runId===origin.marker.runId)return audit;}
  throw Error('No durable successful 6.3 sample receipt; do not submit the remaining sections');
}

async function retainedRecoveryEvidence(origin,oldOrigin,c,userId){
  const folder=await fs.realpath(path.resolve(c.recoveryFolder));
  if(path.dirname(folder)!==origin.folder||!path.basename(folder).startsWith('resume-'))throw Error('Recovery evidence must be an original-folder direct child');
  const files=['audit.json','browser-before.json','browser-after.json','remote-after.json','original-task-input.json','original-task-get.json','slim-start-recovery-proof.json','get-recovery-result.json'];
  const values={},evidence=[];
  for(const name of files){const file=path.join(folder,name),bytes=await fs.readFile(file);values[name]=JSON.parse(bytes);evidence.push({file,sha256:sha(bytes)});}
  const stem='section-'+sha(origin.sampleKey).slice(0,24)+'-converge-';
  for(const name of ['intent','response']){const file=path.join(origin.folder,stem+name+'.json'),bytes=await fs.readFile(file);values[name]=JSON.parse(bytes);evidence.push({file,sha256:sha(bytes)});}
  const a=values['audit.json'],g=values['get-recovery-result.json'],after=values['browser-after.json'],remote=values['remote-after.json'];
  if(a.projectId!==PROJECT||a.getRecovery?.remoteSaved!==true||a.paidIntents?.length||a.unknownRequests?.length||a.sourceUnchangedAfter?.tax!==true||a.sourceUnchangedAfter?.longgang!==true||a.browserBefore?.sha256!==evidence[1].sha256||a.browserAfter?.sha256!==evidence[2].sha256||a.remoteAfter?.sha256!==evidence[3].sha256||g.paidRequests!==0||g.remoteSaved!==true||g.adopted!==false||g.reviewed!==false||g.bodyUnchanged!==true||g.deadlineUnchanged!==true)throw Error('Immutable GET recovery audit is incomplete');
  const proof=bindSlimStartRecovery({input:oldOrigin.input,live:values['browser-before.json'],intent:values.intent,receipt:values.response,row:values['original-task-input.json'],task:values['original-task-get.json'].task,userId});
  if(!same(proof,values['slim-start-recovery-proof.json'])||proof.responseSha256!==g.textHash||sha(bodyList(after.chapters))!==proof.bodySha256||!same(bodyList(after.chapters),bodyList(draftOf(remote).chapters))||!same(savedOf(after),savedOf(draftOf(remote)))||savedOf(after).bindings[origin.sampleKey]?.convergenceResponse?.hash!==proof.responseSha256)throw Error('Immutable GET response/proof/readback changed');
  return {proof,evidence,retainedTask:sectionOf(after.chapters,origin.sampleKey).executionTask??null};
}

async function prepareRetainedNoop({origin,oldOrigin,c,h,isolation,folder,audit,live,remote,snapshot}){
  const recovered=await retainedRecoveryEvidence(origin,oldOrigin,c,isolation.sessions.longgang.user.id);
  // Validate the human scope before any old-run metadata save. The final proof
  // is obtained only after production computes effectiveness, never fabricated.
  const initial=proveRetainedNoop(oldOrigin,live,remote,recovered.proof,{terminal:false});
  bindRetainedNoopReauthorization(origin,oldOrigin,{...initial,evidence:recovered.evidence},c);
  const block=async route=>{
    const r=route.request(),u=new URL(r.url());
    if(r.method()==='POST'&&['/api/reportexecution','/api/generate','/api/agent','/api/report-pagination'].includes(u.pathname))return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({ok:false,error:'Old retained response recovery is zero paid calls; POST forbidden.'})});
    return route.fallback();
  };
  await h.context.route('**/api/**',block);
  try{
    audit.retainedPreparationBefore=await exclusive(path.join(folder,'retained-preparation-before.json'),live);
    if(savedOf(live).run.permits.find(p=>p.kind==='length-converge'&&p.key===origin.sampleKey)?.status!=='completed'){
      const start=await h.page.evaluate(input=>ReportInitialDeliveryRuntime.startReviewedContinuation(input),oldOrigin.input);
      if(start.resumed!==true||start.run?.runId!==initial.priorRunId)throw Error('Old no-op recovery did not resume the original run');
      audit.retainedOldFinish=await h.page.evaluate(key=>ReportInitialDeliveryRuntime.finish({maxDispatchedSections:1,allowedSectionKeys:[key]}),origin.sampleKey);
    }
    const terminal=await browserState(h.page),savedRemote=await isolation.sessions.longgang.request('/api/projects?id='+PROJECT);
    const strip=x=>{const a=structuredClone(x);delete a.workflow.reportCompletion.initialDelivery;return a;};
    if(!same(strip(terminal),strip(live)))throw Error('Production no-op recovery changed original section/plan/input state');
    const proof=proveRetainedNoop(oldOrigin,terminal,savedRemote,recovered.proof);
    audit.retainedTerminal=await exclusive(path.join(folder,'retained-terminal.json'),terminal);
    proof.evidence=[...recovered.evidence,audit.retainedPreparationBefore,audit.retainedTerminal];
    audit.retainedTaskBackup=await exclusive(path.join(folder,'retained-task-proof.json'),proof);
    audit.retainedTaskRestoration=await restoreRetainedNoopTask({live:terminal,proof,readState:()=>browserState(h.page),readRemote:()=>isolation.sessions.longgang.request('/api/projects?id='+PROJECT),commit:(expected,proof)=>h.page.evaluate(async({expected,proof})=>{
      const capture=()=>({projectId:currentProjectId,chapters:ProjectWorkflow.clone(chapters),workflow:ProjectWorkflow.clone(projectWorkflow),plan:ReportLengthUI.savedPlan(),identity:{projectId:currentProjectId,research:window.ResearchUI?.active()?ResearchUI.capture('report').runId:null,input:reportCandidateInputIdentity()},plannerReady:typeof window.ReportInitialDelivery?.createReviewedContinuation==='function',workflowReady:!!projectWorkflow});
      const check=()=>{if(JSON.stringify(capture())!==JSON.stringify(expected))throw Error('Retained task CAS changed');};
      check();const guard=reportCaptureGenerationContext();await reportGuardGenerationContext(guard);check();
      const key=proof.recovery.sectionKey,c=chapters.find(c=>c.sections.some(s=>c.name+' / '+s.t===key)),s=c.sections.find(s=>c.name+' / '+s.t===key);
      s.executionTask=ProjectWorkflow.clone(proof.originalExecutionTask);
      const patched=capture(),saved=await persistReportDraft();await reportGuardGenerationContext(guard);
      if(JSON.stringify(capture())!==JSON.stringify(patched))throw Error('Retained task changed while saving');return saved;
    },{expected,proof})});
    live=await browserState(h.page);remote=await isolation.sessions.longgang.request('/api/projects?id='+PROJECT);
    const finalProof=proveRetainedNoop(oldOrigin,live,remote,recovered.proof);
    finalProof.retainedTask=recovered.retainedTask; // Immutable GET evidence retains the complete unadopted task even after a prior preparation restored it.
    finalProof.evidence=[...proof.evidence,audit.retainedTaskBackup,await exclusive(path.join(folder,'retained-preparation-after.json'),live)];
    for(const s of Object.values(snapshot.sources))if(await checkSourceUnchanged(s.sourceIdentity)!==true)throw Error('Original source changed during zero-paid preparation');
    audit.retainedPreparation={oldPaidRequests:1,newPaidRequests:0,adopted:false,remoteSaved:true};
    return bindRetainedNoopReauthorization(origin,oldOrigin,finalProof,c);
  }finally{await h.context.unroute('**/api/**',block);}
}

export async function runReviewedContinuation({execute=false,number='6.3',resumeFolder=null,remaining=false,reauthorizationFile=null,retainedNoopAuthorizationFile=null,recoverTaskOnly=false}={}){
  if(number!=='6.3')throw Error('Only the one-section 6.3 production sample is authorized by this runner');
  if(remaining&&!resumeFolder||resumeFolder&&!execute)throw Error('Resume/remaining requires explicit execution of the original sample folder');
  if(reauthorizationFile&&(!resumeFolder||!execute||remaining))throw Error('Sample reauthorization requires the original folder and cannot authorize a batch');
  if(retainedNoopAuthorizationFile&&(!resumeFolder||!execute||remaining||reauthorizationFile||recoverTaskOnly))throw Error('Retained no-op authorization requires the exact original 6.3 sample only');
  if(recoverTaskOnly&&(!resumeFolder||!execute||remaining||reauthorizationFile))throw Error('GET recovery requires the exact original sample only');
  const stamp=new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(4).toString('hex');
  const origin=resumeFolder?await loadContinuationOrigin(OUT,resumeFolder):null,runId=origin?.marker.runId||stamp;
  const folder=origin?path.join(origin.folder,'resume-'+stamp):path.join(OUT,'lg-production-continuation-'+runId);await fs.mkdir(folder);
  let recordFolder=origin?.folder||folder;
  const audit={version:'real-production-reviewed-continuation-v1',runId,projectId:PROJECT,number,execute,remaining,recoverTaskOnly,resumedFrom:origin?.folder||null,paidIntents:[],unknownRequests:[],originalProjectWrites:0};
  const lock=path.join(OUT,'lg-production-continuation.lock.json');let ownsLock=false,h,snapshot,isolation,before,originalBefore,selected,after,remoteAfter,input,allowedKeys,priorRunId,renewal,newRenewedRun=false,retainedStartFile,retainedStartedFile,retainedStartIntent;
  try{
    if(typeof process.env.DATABASE_URL!=='string'||!process.env.DATABASE_URL.trim())throw Error('DATABASE_URL is required; use --env-file=local-server/.env');
    await exclusive(lock,{runId,at:new Date().toISOString(),pid:process.pid});ownsLock=true;
    if(execute&&!origin)audit.executionRecord=await reserveSampleExecution(OUT,{runId,projectId:PROJECT,number,at:new Date().toISOString(),folder});
    snapshot=await loadSnapshots(SNAP);isolation=await loadIsolation(snapshot);
    audit.sourceUnchangedBefore=Object.fromEntries(await Promise.all(Object.entries(snapshot.sources).map(async([k,s])=>[k,await checkSourceUnchanged(s.sourceIdentity)])));
    if(Object.values(audit.sourceUnchangedBefore).some(x=>x!==true))throw Error('An original source changed; no work permitted');
    let remote=await isolation.sessions.longgang.request('/api/projects?id='+PROJECT);
    audit.backup=await exclusive(path.join(folder,'remote-before.json'),remote);
    h=await openProductionHarness(isolation,'longgang',{allowAi:false});
    const runtimeText=await h.page.evaluate(()=>ReportInitialDeliveryRuntime.createRuntime.toString());
    audit.runtime={loadedSha256:sha(runtimeText),localSha256:sha(require('../report-initial-delivery-runtime.js').createRuntime.toString())};
    if(audit.runtime.loadedSha256!==audit.runtime.localSha256)throw Error('Browser did not load the current runtime');
    await h.page.evaluate(expected=>{
      if(currentProjectId!==expected||!projectCanEdit())throw Error('Not the editable retained QA project');
      window.__qaDispatchPaused=true;
      airDriveSectionGen=async()=>false;
    },PROJECT);
    const rulePayload=await loadedRulePayload(h.page);
    before=await browserState(h.page);originalBefore=origin?.before||before;
    audit.browserBefore=await exclusive(path.join(folder,'browser-before.json'),before);
    const remoteDraft=remote.project.data?.draft||remote.project.data;
    for(let ci=0;ci<before.chapters.length;ci++)for(let si=0;si<before.chapters[ci].sections.length;si++){
      const a=before.chapters[ci].sections[si],b=remoteDraft.chapters?.[ci]?.sections?.[si];
      if(!b||String(a.content||'')!==String(b.content||'')||String(a.editedHtml||'')!==String(b.editedHtml||''))throw Error('Browser/remote actual body mismatch');
    }
    if(origin){
      let effectiveOrigin=origin;
      const supplementFile=path.join(origin.folder,'hydration-supplement.json');let supplement;
      try{supplement=await readJson(supplementFile);}catch(e){if(e.code!=='ENOENT')throw e;}
      if(supplement){
        effectiveOrigin=validateLoadedRuleSupplement(origin,supplement,rulePayload);
        audit.ruleHydration={file:supplementFile,sha256:sha(await fs.readFile(supplementFile)),reused:true};
      }else if(!same(before.identity,origin.input.authorization.identity)){
        if(remaining||before.identity.projectId!==origin.input.authorization.identity.projectId||before.identity.research!==origin.input.authorization.identity.research||!same(before.plan,origin.before.plan))throw Error('Project/research/plan changed; rule hydration cannot recover it');
        const proof=await proveZeroPostRecovery(origin,before,remote);
        supplement=bindLoadedRuleSupplement(origin,rulePayload,proof);
        effectiveOrigin=validateLoadedRuleSupplement(origin,supplement,rulePayload);
        // Validate all current bodies and ownership before publishing the receipt.
        validateContinuationResume(effectiveOrigin,before,remote);
        audit.ruleHydration={...await exclusive(supplementFile,supplement),reused:false};
      }
      const receiptFile=path.join(origin.folder,'sample-reauthorization.json');
      try{renewal=await readJson(receiptFile);}catch(e){if(e.code!=='ENOENT')throw e;}
      if(reauthorizationFile){
        if(renewal)throw Error('The permanent sample reauthorization already exists; resume that exact receipt, never replace it');
        const proof=await proveExpiredZeroDispatch(effectiveOrigin,before,remote,Date.now(),audit.sourceUnchangedBefore);
        renewal=bindSampleReauthorization(effectiveOrigin,proof,await readJson(path.resolve(reauthorizationFile)));
        await validateSampleReauthorization(effectiveOrigin,renewal);
        audit.reauthorization={...await exclusive(receiptFile,renewal),reused:false};
      }else if(renewal)audit.reauthorization={file:receiptFile,sha256:sha(await fs.readFile(receiptFile)),reused:true};
      selected={key:origin.sampleKey,allowConverge:true};
      let resumed;
      const retainedReceiptFile=path.join(origin.folder,'sample-retained-noop-reauthorization.json');let retainedReceipt;
      try{retainedReceipt=await readJson(retainedReceiptFile);}catch(e){if(e.code!=='ENOENT')throw e;}
      if(retainedReceipt&&!retainedNoopAuthorizationFile)throw Error('A retained-noop authorization exists; resume only with its exact explicit authorization file');
      if(retainedNoopAuthorizationFile){
        if(!renewal)throw Error('The exact previous renewed paid run receipt is required');
        const hydratedOrigin=effectiveOrigin,oldOrigin=await validateSampleReauthorization(hydratedOrigin,renewal),confirmation=await readJson(path.resolve(retainedNoopAuthorizationFile));
        if(retainedReceipt){
          if(!same(retainedReceipt,bindRetainedNoopReauthorization(hydratedOrigin,oldOrigin,retainedReceipt.proof,confirmation)))throw Error('Permanent retained-noop authorization changed');
          for(const e of retainedReceipt.proof.evidence){const file=await fs.realpath(e.file);if(!file.startsWith(origin.folder+path.sep)||sha(await fs.readFile(file))!==e.sha256)throw Error('Retained-noop evidence changed');}
          audit.retainedReauthorization={file:retainedReceiptFile,sha256:sha(await fs.readFile(retainedReceiptFile)),reused:true};
        }else{
          retainedReceipt=await prepareRetainedNoop({origin:hydratedOrigin,oldOrigin,c:confirmation,h,isolation,folder,audit,live:before,remote,snapshot});
          audit.retainedReauthorization={...await exclusive(retainedReceiptFile,retainedReceipt),reused:false};
        }
        before=await browserState(h.page);remote=await isolation.sessions.longgang.request('/api/projects?id='+PROJECT);
        recordFolder=path.join(origin.folder,retainedReceipt.claimNamespace);await fs.mkdir(recordFolder,{recursive:true});
        retainedStartFile=path.join(recordFolder,'start-intent.json');retainedStartedFile=path.join(recordFolder,'authorized-started.json');
        retainedStartIntent={version:'retained-noop-start-intent-v1',receiptSha256:sha(retainedReceipt),confirmationId:confirmation.confirmationId,requestHash:retainedReceipt.requestHash,priorRunId:retainedReceipt.proof.priorRunId};
        let intent,startedReceipt;
        try{intent=await readJson(retainedStartFile);}catch(e){if(e.code!=='ENOENT')throw e;}
        try{startedReceipt=await readJson(retainedStartedFile);}catch(e){if(e.code!=='ENOENT')throw e;}
        if(intent&&!same(intent,retainedStartIntent))throw Error('Permanent new-start intent changed');
        const resolved=resolveRetainedNoopStart(retainedReceipt,before,{startIntentExists:!!intent,startedReceipt});
        effectiveOrigin={...hydratedOrigin,input:retainedReceipt.input,requestHash:retainedReceipt.requestHash};
        validateContinuationResume(resolved.newRun?oldOrigin:effectiveOrigin,before,remote);
        if(!resolved.newRun&&!startedReceipt)await exclusive(retainedStartedFile,retainedNoopStartedReceipt(retainedReceipt,before));
        resumed={allowedKeys:[origin.sampleKey],runId:resolved.runId};newRenewedRun=resolved.newRun;renewal=retainedReceipt;
        audit.claimNamespace=recordFolder;
      }else if(renewal){
        resumed=await resolveSampleReauthorization(effectiveOrigin,renewal,before,remote,{remaining,currentSourceChecks:audit.sourceUnchangedBefore});
        effectiveOrigin=resumed.origin;newRenewedRun=resumed.newRun;
      }else resumed=validateContinuationResume(effectiveOrigin,before,remote,{remaining,sampleAudit:remaining?await acceptedSampleAudit(origin):null});
      input=effectiveOrigin.input;allowedKeys=resumed.allowedKeys;priorRunId=resumed.runId;
      if(resumed.zeroPost){audit.zeroPostRecovery=await proveZeroPostRecovery(origin,before,remote);await exclusive(path.join(folder,'zero-post-recovery.json'),audit.zeroPostRecovery);}
      audit.originalRequest={runId,requestHash:origin.requestHash,confirmationId:input.authorization.confirmationId,markerSha256:origin.markerSha256,inputSha256:origin.inputSha256,productionRunId:priorRunId};
    }else{
      const reviewSets=await Promise.all(REVIEWS.map(async name=>{const file=path.join(OUT,name),bytes=await fs.readFile(file);return {file,sha256:sha(bytes),data:JSON.parse(bytes)};}));
      const sections=bindReviewedSections(before.chapters,reviewSets);selected=sections.find(s=>s.number===number);
      if(!selected?.allowConverge)throw Error('The selected sample is not eligible');
      const authorization={authorized:true,purpose:'reviewed-existing-length-convergence',confirmationId:'user-full-report-acceptance-20261013-'+runId,confirmedAt:new Date().toISOString(),planId:before.plan.planId,identity:before.identity};
      input={authorization,sections:sections.map(({number,...s})=>s)};allowedKeys=[selected.key];
    }
    audit.input=await exclusive(path.join(folder,'continuation-input.json'),input);
    audit.preflight=continuationAuthPreflight(input,await browserState(h.page));await exclusive(path.join(folder,'auth-preflight.json'),audit.preflight);
    if(!audit.preflight.passed)throw Error('Continuation preflight refused: '+Object.entries(audit.preflight.checks).filter(([,ok])=>!ok).map(([name])=>name).join(', '));
    emit('prepared',{execute,number,remaining,details:input.sections.length,allowed:allowedKeys.length,planId:before.plan.planId,originalPlanProse:before.plan.proseTotal||before.plan.targetProseCharacters,folder});
    if(!execute)return audit;
    if(recoverTaskOnly){if(newRenewedRun||!priorRunId)throw Error('GET recovery cannot create a new production run');await recoverSlimStart({h,isolation,input,before,folder,recordFolder,audit});return audit;}
    await h.context.route('**/api/report-pagination',scopedPaginationRoute({origin:new URL(isolation.baseUrl).origin,planId:before.plan.planId,runId:()=>audit.started?.run?.runId,fromPage:request=>request.frame()===h.page.mainFrame(),readState:()=>h.page.evaluate(()=>({projectId:currentProjectId,planId:ReportLengthUI.savedPlan()?.planId,run:ProjectWorkflow.clone(projectWorkflow.reportCompletion?.initialDelivery?.run)})),record:async receipt=>{
      for(const name of await fs.readdir(recordFolder))if(/^pagination-.*-intent\.json$/.test(name)&&(await readJson(path.join(recordFolder,name))).permitId===receipt.permitId)throw Error('This pagination permit already has a durable request');
      await exclusive(path.join(recordFolder,'pagination-'+sha(receipt.permitId).slice(0,24)+'-intent.json'),receipt);audit.paginationIntents||=[];audit.paginationIntents.push(receipt);
    }}));
    const intentPath=(record,suffix)=>path.join(recordFolder,'section-'+sha(record.sectionKey).slice(0,24)+'-'+record.kind+'-'+suffix+'.json');
    await h.context.route('**/api/**',scopedContinuationPaidRoute({origin:new URL(isolation.baseUrl).origin,input,allowedKeys,readState:()=>browserState(h.page),fromPage:request=>request.frame()===h.page.mainFrame(),claim:async intent=>{
      // Older samples used unkeyed intent names. They remain binding forever.
      if(intent.sectionKey===selected.key)for(const name of [intent.kind+'-intent.json',intent.kind+'-response.json']){try{await fs.access(path.join(recordFolder,name));throw Error('Original sample intent already exists');}catch(e){if(e.code!=='ENOENT')throw e;}}
      const file=intentPath(intent,'intent');await exclusive(file,intent);audit.paidIntents.push({...intent,file});emit('paid-intent',{kind:intent.kind,sectionKey:intent.sectionKey});
    },respond:async receipt=>{await exclusive(intentPath(receipt,'response'),receipt);emit('task-accepted',{kind:receipt.kind,sectionKey:receipt.sectionKey,taskId:receipt.data?.task?.id,status:receipt.data?.task?.status,http:receipt.status});},onTask:id=>h.taskIds.add(id),onUnknown:async receipt=>{audit.unknownRequests.push(receipt);await exclusive(intentPath(receipt,'unknown'),receipt);emit('uncertain-request',{kind:receipt.kind,sectionKey:receipt.sectionKey});}}));
    await h.page.exposeFunction('__qaContinuationProgress',p=>emit('production-progress',p));
    if(retainedStartFile&&newRenewedRun)await exclusive(retainedStartFile,retainedStartIntent);
    const startAt=Date.now();emit('production-start-begin',{renewedSample:!!renewal});
    audit.started=await h.page.evaluate(async input=>{
      if(typeof ReportInitialDeliveryRuntime.startReviewedContinuation!=='function')throw Error('Production reviewed continuation entry is not yet available');
      return ReportInitialDeliveryRuntime.startReviewedContinuation(input);
    },input);
    audit.timings={startMs:Date.now()-startAt};emit('production-start-end',{ms:audit.timings.startMs,productionRunId:audit.started.run?.runId,resumed:audit.started.resumed});
    if(priorRunId&&(audit.started.run?.runId!==priorRunId||audit.started.resumed!==true))throw Error('Runtime did not resume the exact original production run');
    await exclusive(path.join(folder,'started.json'),audit.started);
    if(newRenewedRun)verifyReauthorizedStart(renewal,audit.started,await browserState(h.page));
    if(retainedStartedFile){
      const startedState=await browserState(h.page),receipt=retainedNoopStartedReceipt(renewal,startedState);
      if(newRenewedRun)await exclusive(retainedStartedFile,receipt);
      else if(!same(await readJson(retainedStartedFile),receipt))throw Error('Authorized run start/deadline changed');
    }
    const statusAt=Date.now();audit.statusBeforeFinish=await h.page.evaluate(()=>ReportInitialDeliveryRuntime.status());audit.timings.statusMs=Date.now()-statusAt;emit('production-status-read',{ms:audit.timings.statusMs,status:audit.statusBeforeFinish.status,reason:audit.statusBeforeFinish.reason});
    const finishAt=Date.now();
    audit.result=await h.page.evaluate(async allowed=>ReportInitialDeliveryRuntime.finish({maxDispatchedSections:allowed.length,allowedSectionKeys:allowed,onProgress:p=>window.__qaContinuationProgress(p)}),allowedKeys);
    audit.timings.finishMs=Date.now()-finishAt;
    await exclusive(path.join(folder,'result.json'),audit.result);
    emit('production-finished',{status:audit.result.status,reason:audit.result.reason,complete:audit.result.complete,paid:audit.paidIntents.length});
  }catch(e){audit.error=safe(e);if(h&&input)try{audit.preflightAfterFailure=continuationAuthPreflight(input,await browserState(h.page));}catch{}emit('stopped',{error:audit.error,preflight:audit.preflightAfterFailure?.checks});}
  finally{
    if(h){
      try{after=await browserState(h.page);audit.browserAfter=await exclusive(path.join(folder,'browser-after.json'),after);}catch(e){audit.captureError=safe(e);}
      try{remoteAfter=await isolation.sessions.longgang.request('/api/projects?id='+PROJECT);audit.remoteAfter=await exclusive(path.join(folder,'remote-after.json'),remoteAfter);}catch(e){audit.remoteError=safe(e);}
      audit.browserErrors=h.errors;try{await h.close();}catch(e){audit.closeError=safe(e);}
    }
    if(execute){
      audit.sampleAcceptance=verifySampleAcceptance({selectedKey:selected?.key,before:originalBefore,after,remote:remoteAfter,started:audit.started,result:audit.result});
      if(remaining){const rows=(input?.sections||[]).filter(s=>s.allowConverge).map(s=>verifySampleAcceptance({selectedKey:s.key,before:originalBefore,after,remote:remoteAfter,started:audit.started,result:audit.result}));audit.batchAcceptance={accepted:rows.length===29&&rows.every(r=>r.sampleAccepted),reviewedDetails:rows.filter(r=>r.sampleAccepted).length,rows,overallComplete:false};}
    }
    await persistContinuationAudit({audit,folder,lock,runId,ownsLock,snapshot});
  }
  emit('audit',{file:path.join(folder,'audit.json'),paid:audit.paidIntents.length,sampleAccepted:audit.sampleAcceptance?.sampleAccepted??null,batchAccepted:audit.batchAcceptance?.accepted??null,overallStatus:audit.result?.status??null,overallComplete:audit.result?.complete??false,error:audit.error||null});return audit;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),retained=args[0]==='--reauthorize-retained-noop',renew=args[0]==='--reauthorize-sample'||retained,resume=['--resume-sample','--continue','--reauthorize-sample','--reauthorize-retained-noop','--recover-sample-task'].includes(args[0]);
  if(resume?args.length!==(renew?3:2):args.length!==1||!['--prepare','--sample'].includes(args[0]))throw Error('Use --prepare, --sample, --resume-sample ORIGINAL_FOLDER, --recover-sample-task ORIGINAL_FOLDER, --continue ORIGINAL_FOLDER, --reauthorize-sample ORIGINAL_FOLDER AUTH_JSON, or --reauthorize-retained-noop ORIGINAL_FOLDER AUTH_JSON');
  const result=await runReviewedContinuation({execute:args[0]!=='--prepare',resumeFolder:resume?args[1]:null,remaining:args[0]==='--continue',reauthorizationFile:renew&&!retained?args[2]:null,retainedNoopAuthorizationFile:retained?args[2]:null,recoverTaskOnly:args[0]==='--recover-sample-task'});process.exitCode=result.recoverTaskOnly&&result.getRecovery?.remoteSaved===true&&!result.error&&!result.captureError&&!result.remoteError&&!result.closeError&&!result.browserErrors?.length&&Object.values(result.sourceUnchangedAfter||{}).every(Boolean)?0:continuationExitCode(result);
}
