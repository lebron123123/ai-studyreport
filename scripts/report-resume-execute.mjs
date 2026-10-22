// Explicit, section-scoped recovery of the two retained acceptance copies only.
// Importing this file never opens a browser, writes a checkpoint, or submits AI.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {loadSnapshots,loadIsolation,openProductionHarness,checkSourceUnchanged,taskBelongsToIsolation} from './report-generation-acceptance.mjs';

const require=createRequire(import.meta.url);
const SELF=fileURLToPath(import.meta.url),ROOT=path.resolve(path.dirname(SELF),'..');
const SNAPSHOT=path.join(ROOT,'outputs/report-standardization/1010-full-generation-2026-10-10T02-04-51-303Z-3378c9e5');
const OUT=path.join(SNAPSHOT,'generation-runner'),CHECKPOINT=path.join(OUT,'checkpoint.json');
const TARGETS=Object.freeze({
  tax:{id:'f4395f64-af1b-43bd-b809-580b5ec9406b',name:'[系统测试]全量报告验收-tax-8c14644b'},
  longgang:{id:'2884b7a3-960f-40c0-af89-5d19e0284836',name:'[系统测试]全量报告验收-longgang-d5470f22'}
});
const SIX=['tax:2.3','tax:6.3','tax:7.1','tax:9.1','longgang:3.8','longgang:10.1'];
const MODES=['restore','review','structure','source','revalidate','missing','bounded'];
const sha=value=>crypto.createHash('sha256').update(Buffer.isBuffer(value)?value:typeof value==='string'?value:JSON.stringify(value??null)).digest('hex');
export function stableResumeJson(value){
  if(Array.isArray(value))return value.map(stableResumeJson);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stableResumeJson(value[key])]));
  return value;
}
function stableResumeChapters(value){
  const canonical=stableResumeJson(value);
  if(Array.isArray(canonical))for(const chapter of canonical){
    if(!Array.isArray(chapter?.sections))continue;
    for(const section of chapter.sections){
      if(!section||typeof section!=='object'||Array.isArray(section))continue;
      // Old drafts omitted these two fields; buildDraftData now emits null for
      // no failure. Normalize only that schema migration, never error objects.
      for(const field of ['generationFailure','candidateGenerationFailure'])if(Object.hasOwn(section,field)&&section[field]===null)delete section[field];
    }
  }
  return canonical;
}
const safeError=error=>String(error?.message||error).replace(/Bearer\s+\S+/gi,'Bearer [redacted]').replace(/postgres(?:ql)?:\/\/[^\s]+/gi,'[database URL redacted]').slice(0,500);
const draftOf=data=>data?.draft||data||{};
const keyParts=key=>{if(!/^(tax|longgang):[1-9]\d*\.[1-9]\d*$/.test(key))throw Error('Use exact keys such as tax:3.2; whole-project keys are forbidden');return key.split(':');};
const keyList=value=>{const keys=String(value||'').split(',').map(x=>x.trim());keys.forEach(keyParts);if(new Set(keys).size!==keys.length)throw Error('Duplicate section key');return keys;};
const emit=(stage,extra={})=>console.log(JSON.stringify({stage,...extra}));

// This is a result summary, not a new admission path. Only the existing
// helpers' exact passed receipts can confirm the explicitly requested scope.
export function summarizeResumeCompletion(keys,receipts,executionSucceeded=true){
  const byKey=new Map(keys.map(key=>[key,[]])),counts=new Map(),receiptIssues=[];
  if(!Array.isArray(receipts)){receiptIssues.push({code:'invalid-receipts'});receipts=[];}
  for(const row of receipts){
    const status=typeof row?.status==='string'&&row.status?row.status:'unknown-status';
    counts.set(status,(counts.get(status)||0)+1);
    const key=typeof row?.key==='string'&&typeof row?.number==='string'?row.key+':'+row.number:null;
    if(!byKey.has(key)){receiptIssues.push({code:'unexpected-receipt',key});continue;}
    byKey.get(key).push(status);
  }
  const sections=keys.map(key=>{
    const statuses=byKey.get(key),status=!statuses.length?'missing-receipt':statuses.length>1?'duplicate-receipt':statuses[0];
    return {key,status,passed:statuses.length===1&&status==='passed'};
  });
  const passed=sections.filter(row=>row.passed).length;
  const complete=executionSucceeded===true&&keys.length>0&&passed===keys.length&&!receiptIssues.length;
  const status=executionSucceeded!==true?'execution-failed':!keys.length?'no-action':complete?'body-complete':'body-incomplete';
  return {status,contentComplete:complete,completion:{scope:'requested-sections',status:complete?'complete':status==='no-action'?'not-requested':executionSucceeded!==true?'unverified':'incomplete',complete,requested:keys.length,passed,remaining:keys.length-passed,counts:Object.fromEntries(counts),outstanding:sections.filter(row=>!row.passed).map(({key,status})=>({key,status})),receiptIssues}};
}

// 0: no action or all requested bodies passed; 1: controller failure;
// 2: controller ran, but bodies still need work/review (including metadata-only).
export function resumeActionExitCode(result){
  if(result?.ok!==true)return 1;
  return result.status==='no-action'||result.completion?.complete===true?0:2;
}

export function parseArgs(argv=process.argv.slice(2)){
  const options={mode:null,value:null,baseUrl:'http://localhost:8080',normalizeReviewedSchema:false};
  for(let i=0;i<argv.length;i++){
    const name=argv[i].replace(/^--/,'');
    if(MODES.includes(name)){
      if(options.mode)throw Error('Select exactly one recovery mode');
      if(!argv[i+1]||argv[i+1].startsWith('--'))throw Error('Missing explicit scope for --'+name);
      options.mode=name;options.value=argv[++i];
    }else if(argv[i]==='--normalize-reviewed-schema')options.normalizeReviewedSchema=true;
    else if(argv[i]==='--base-url'&&argv[i+1])options.baseUrl=argv[++i];
    else throw Error('Unknown recovery option');
  }
  if(options.normalizeReviewedSchema&&options.mode!=='review')throw Error('--normalize-reviewed-schema requires --review FILE');
  const url=new URL(options.baseUrl);
  if(url.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('Only a localhost HTTP origin is permitted');
  options.baseUrl=url.origin;
  if(['revalidate','missing','bounded'].includes(options.mode))options.keys=keyList(options.value);
  return options;
}

async function exclusive(file,bytes){
  const value=Buffer.isBuffer(bytes)?bytes:Buffer.from(typeof bytes==='string'?bytes:JSON.stringify(bytes,null,2));
  await fs.writeFile(file,value,{flag:'wx'});
  if(sha(await fs.readFile(file))!==sha(value))throw Error('Recovery backup readback failed');
  return {file,sha256:sha(value),bytes:value.length};
}

async function readScopedInput(options){
  if(!['restore','review','structure','source'].includes(options.mode))return {keys:options.keys};
  const file=await fs.realpath(path.resolve(options.value)),relative=path.relative(OUT,file);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('Input must remain inside the retained generation-runner directory');
  const bytes=await fs.readFile(file),value=JSON.parse(bytes),rows=options.mode==='source'?value.corrections:value.rows;
  if(!Array.isArray(rows)||!rows.length)throw Error('Explicit nonempty input rows are required');
  const keys=[...new Set(rows.map(row=>row.key))];keys.forEach(keyParts);
  if(options.mode!=='source'&&keys.length!==rows.length)throw Error('Duplicate input rows');
  if(options.mode==='review'){
    if(options.normalizeReviewedSchema){
      if(rows.length!==6||keys.length!==6||SIX.some(key=>!keys.includes(key)))throw Error('Schema normalization is restricted to the six independently reviewed actual bodies');
      if(rows.some(row=>row.exactActualMatch!==true||row.actualEqualsSection!==true||row.fullBodyRead!==true||row.semanticPassed!==true||row.technicalPassed!==true||row.conclusion!=='acceptable'||!Array.isArray(row.findings)||row.findings.length||!/^[a-f0-9]{64}$/.test(row.actualBodySha256)||row.bodySha256!==row.actualBodySha256||row.sectionBodySha256!==row.actualBodySha256||!row.taskId))throw Error('All six full-body review flags/hashes/findings must pass; no inference is permitted');
      if(!value.fullReadAt||!Number.isFinite(Date.parse(value.fullReadAt)))throw Error('Original full-read timestamp is required');
      value.rows=rows.map(row=>({...row,semanticStatus:'acceptable-full-body-at-bound-sha',readAt:row.readAt||value.fullReadAt}));
      value.resumeSchemaNormalization={version:'reviewed-six-schema-only-v1',originalFile:file,originalSha256:sha(bytes),at:new Date().toISOString(),newPaidAiCalls:0,originalReviewUnchanged:true};
    }else if(rows.some(row=>row.semanticStatus!=='acceptable-full-body-at-bound-sha'||row.exactActualMatch!==true))throw Error('Review schema not accepted; the old six-row review requires explicit --normalize-reviewed-schema');
  }
  return {keys,file,bytes,value,sha256:sha(bytes)};
}

async function sourceChecks(snapshot){
  const result={};for(const key of Object.keys(TARGETS))result[key]=await checkSourceUnchanged(snapshot.sources[key].sourceIdentity);
  if(Object.values(result).some(value=>value!==true))throw Error('Immutable formal source changed; recovery is forbidden');
  return result;
}

function validateProject(key,project,snapshot){
  const expected=TARGETS[key],data=project?.data;
  if(project?.id!==expected.id||project.name!==expected.name||data?.qaAcceptance?.id!==expected.id||data.qaSourceStateSha256!==sha(snapshot.sources[key].state))throw Error('Exact retained copy/provenance mismatch: '+key);
  if((draftOf(data).chapters||[]).reduce((n,c)=>n+(c.sections||[]).length,0)!==43)throw Error('The retained copy must contain exactly 43 sections');
  return data;
}

function sectionOf(data,number){const [ci,si]=number.split('.').map(n=>Number(n)-1),c=draftOf(data).chapters?.[ci],s=c?.sections?.[si];if(!s)throw Error('Explicit section does not exist');return {section:s,sectionKey:c.name+' / '+s.t};}

export function validateSourcePreconditions(proposal,states){
  const keys=[...new Set((proposal.corrections||[]).map(row=>row.key))],pre=proposal.sectionPreconditions;
  if(!Array.isArray(pre)||pre.length!==keys.length||new Set(pre.map(row=>row.key)).size!==keys.length||keys.some(key=>!pre.some(row=>row.key===key)))throw Error('Source corrections need one exact body/task precondition for every section');
  for(const row of pre){
    const [key]=keyParts(row.key),state=states[row.key];
    if(!state||state.projectId!==TARGETS[key].id||row.projectId&&row.projectId!==state.projectId)throw Error('Source correction project identity changed: '+row.key);
    if(!Object.hasOwn(row,'taskId')||row.taskId!==state.taskId)throw Error('Source correction original task changed: '+row.key);
    if(!/^[a-f0-9]{64}$/.test(row.actualBodySha256)||sha(state.actual)!==row.actualBodySha256)throw Error('Source correction actual body changed: '+row.key);
    const selectedSha=row.candidateSha256||row.bodySha256||row.actualBodySha256;
    if(!/^[a-f0-9]{64}$/.test(selectedSha)||sha(state.selected)!==selectedSha)throw Error('Source correction preserved candidate changed: '+row.key);
    for(const correction of proposal.corrections.filter(item=>item.key===row.key)){
      if(Object.hasOwn(correction,'taskId')&&correction.taskId!==row.taskId||correction.bodySha256&&correction.bodySha256!==selectedSha)throw Error('Source correction row disagrees with its bound precondition: '+row.key);
    }
  }
  return keys.length;
}

export function validateRestorePrecondition(row,state,task,candidate){
  const [key]=keyParts(row.key);
  if(row.projectId!==TARGETS[key].id||state.projectId!==row.projectId)throw Error('Restore project changed: '+row.key);
  if(sha(state.actual)!==row.actualBodySha256||sha(state.pendingRevision??null)!==row.pendingRevisionSha256||sha(state.executionTask??null)!==row.executionTaskSha256)throw Error('Restore current body/candidate/receipt changed: '+row.key);
  if(state.executionTask!=null)throw Error('Restore never replaces an existing generation receipt: '+row.key);
  if(!task||task.id!==row.originalTaskId||task.runId!==row.runId||task.graph?.find(node=>node.key==='context_snapshot')?.hash!==row.contextHash)throw Error('Restore original task evidence mismatch: '+row.key);
  if(row.candidateEvidence&&(!candidate||sha(candidate)!==row.candidateSha256))throw Error('Restore preserved candidate evidence mismatch: '+row.key);
  if(row.candidateEvidence&&!state.pendingRevision&&(row.createNewPendingOnly!==true||row.pendingRevisionPresent!==false))throw Error('Restore absent candidate requires explicit unaccepted construction: '+row.key);
  if(row.createNewPendingOnly===true&&(!row.candidateEvidence||state.pendingRevision||row.pendingRevisionPresent!==false))throw Error('Restore candidate construction cannot replace an existing pending revision: '+row.key);
  return true;
}

async function readRestoreEvidence(evidence){
  if(!evidence||!evidence.file||!/^\/[\w~\/-]*$/.test(evidence.pointer||''))throw Error('Restore needs an exact evidence file and JSON pointer');
  const file=await fs.realpath(path.resolve(evidence.file)),relative=path.relative(OUT,file);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('Restore evidence must remain inside the retained snapshot');
  const bytes=await fs.readFile(file);if(sha(bytes)!==evidence.sha256)throw Error('Restore evidence file changed');
  let value=JSON.parse(bytes);for(const token of evidence.pointer.slice(1).split('/'))value=value?.[token.replace(/~1/g,'/').replace(/~0/g,'~')];
  if(value===undefined)throw Error('Restore evidence pointer is absent');return value;
}

async function restorePreservedReceipts(harnesses,isolation,proposal,inputFile){
  const receipts=[],prepared=[];
  // Verify every row and its original completed task before the first write.
  for(const row of proposal.rows){
    const [key,number]=keyParts(row.key),h=harnesses[key];
    const state=await h.page.evaluate(({expected,number})=>{
      if(currentProjectId!==expected||!window.__qaDispatchPaused||!projectCanEdit())throw Error('Restore requires the exact paused editable copy');
      const [ci,si]=number.split('.').map(n=>Number(n)-1),s=chapters[ci].sections[si];
      return {projectId:currentProjectId,actual:s.editedHtml||s.content||'',pendingRevision:s.pendingRevision??null,executionTask:s.executionTask??null,section:ProjectWorkflow.clone(s)};
    },{expected:h.target.id,number});
    const task=await readRestoreEvidence(row.taskEvidence),candidate=row.candidateEvidence?await readRestoreEvidence(row.candidateEvidence):null;
    validateRestorePrecondition(row,state,task,candidate);
    const response=await isolation.sessions[key].request('/api/reportexecution?id='+encodeURIComponent(task.id)),fresh=response.task;
    if(fresh?.id!==task.id||fresh.runId!==task.runId||fresh.status!=='completed'||fresh.rulesChanged||fresh.graph?.find(node=>node.key==='context_snapshot')?.hash!==row.contextHash)throw Error('Restore original task GET is incomplete or changed: '+row.key);
    prepared.push({row,h,number,state,task,candidate});
  }
  for(const {row,h,number,state,task,candidate} of prepared){
    const result=await h.page.evaluate(async ({expected,number,original,task,candidate,proposalFile,createNewPendingOnly})=>{
      if(currentProjectId!==expected||!window.__qaDispatchPaused||!projectCanEdit())throw Error('Restore identity changed');
      const [ci,si]=number.split('.').map(n=>Number(n)-1),s=chapters[ci].sections[si];
      if(JSON.stringify(s)!==JSON.stringify(original))throw Error('Restore section changed after preflight');
      s.executionTask=ProjectWorkflow.clone(task);
      if(candidate!==null){
        if(!s.pendingRevision){
          if(!createNewPendingOnly||!ProjectWorkflow.setCandidate(s,candidate,'恢复留存的未接受候选，不调用AI、不接受正文',{completionContract:s.completionContract}))throw Error('Candidate restoration requires an explicit unaccepted candidate record');
        }
        s.pendingRevision={...s.pendingRevision,after:candidate,qaPreservedRecovery:{proposalFile,originalTaskId:task.id,originalRunId:task.runId,notNewAiGeneration:true}};
      }
      const saved=await persistReportDraft();if(!saved.ok||!saved.remote)throw Error('Restore remote save was not acknowledged; retained backup remains');
      return {taskId:s.executionTask.id,bodyUnchanged:(s.editedHtml||s.content||'')===(original.editedHtml||original.content||''),candidateRestored:candidate!==null,persisted:saved};
    },{expected:h.target.id,number,original:state.section,task,candidate,proposalFile:inputFile,createNewPendingOnly:row.createNewPendingOnly===true});
    if(!result.bodyUnchanged)throw Error('Restore must not change adopted content');
    receipts.push({key:row.key.split(':')[0],number,status:'restored-metadata-only',...result});
  }
  return {receipts,newPaidAiCalls:0};
}

async function legacyBoundedClear(key,number){
  const dir=path.join(OUT,key,'recovery');let names;try{names=await fs.readdir(dir);}catch(error){if(error.code==='ENOENT')return;throw error;}
  const before=names.filter(name=>name.startsWith('bounded-before-'+number+'-')&&name.endsWith('.json')).sort((a,b)=>Number(b.match(/-(\d+)-[^-]+\.json$/)?.[1]||0)-Number(a.match(/-(\d+)-[^-]+\.json$/)?.[1]||0))[0];
  if(!before)return;
  for(const name of names.filter(name=>name.startsWith('bounded-after-'+number+'-')&&name.endsWith('.json'))){const result=JSON.parse(await fs.readFile(path.join(dir,name),'utf8'));if(path.resolve(result.beforeFile||'.')===path.join(dir,before))return;}
  throw Error('An earlier bounded attempt lacks a matched retained after receipt; inspect/recover the paid response before any new POST: '+key+':'+number);
}

async function paidPreflight(isolation,remote,checkpoint,keys,mode){
  const {Client}=require(path.join(ROOT,'local-server/node_modules/pg')),client=new Client({connectionString:process.env.DATABASE_URL}),checks=[];
  await client.connect();
  try{
    await client.query('BEGIN READ ONLY');await client.query("SET LOCAL statement_timeout='15s'");
    for(const keyNumber of keys){
      const [key,number]=keyParts(keyNumber),{section,sectionKey}=sectionOf(remote[key],number),session=isolation.sessions[key];
      if(checkpoint.sections[keyNumber]?.status==='running')throw Error('Existing checkpoint task is not terminal; do not resubmit: '+keyNumber);
      const marker=path.join(OUT,'resume-paid-intent-'+key+'-'+number+'.json');
      try{await fs.access(marker);throw Error('Retained paid intent requires explicit reconciliation before another POST: '+keyNumber);}catch(error){if(error.code!=='ENOENT')throw error;}
      const rows=(await client.query('SELECT id,project_id,user_id,section_key,input_hash,run_id FROM report_section_tasks WHERE project_id=$1 AND section_key=$2',[TARGETS[key].id,sectionKey])).rows;
      if(mode==='missing'&&(rows.length||section.executionTask||section.pendingRevision||String(section.editedHtml||section.content||'').trim()))throw Error('Missing generation requires a truly untouched section; an existing body/candidate/task is never resubmitted: '+keyNumber);
      for(const row of rows){
        if(!taskBelongsToIsolation(row,session.target,session.user))throw Error('Existing task ownership mismatch');
        const result=await session.request('/api/reportexecution?id='+encodeURIComponent(row.id)),task=result.task;
        if(task?.id!==row.id||task.runId!==row.run_id||task.graph?.find(n=>n.key==='context_snapshot')?.hash!==row.input_hash||task.status!=='completed'||task.rulesChanged)throw Error('Existing task is incomplete, uncertain, or changed; GET-only recovery is required: '+keyNumber);
        checks.push({key:keyNumber,id:row.id,status:task.status});
      }
      if(section.executionTask?.id&&!rows.some(row=>row.id===section.executionTask.id))throw Error('Retained task identity is not in the scoped task registry');
      if(mode==='bounded')await legacyBoundedClear(key,number);
    }
    await client.query('ROLLBACK');return checks;
  }finally{await client.end();}
}

async function pauseHarness(h,keys){
  return h.page.evaluate(({expected,keys})=>{
    if(currentProjectId!==expected||!projectCanEdit()||typeof airDriveSectionGen!=='function')throw Error('Exact editable retained report is required');
    window.__qaDispatchPaused=true;
    if(!window.__qaOriginalAirDrive)window.__qaOriginalAirDrive=airDriveSectionGen;
    // Ordinary UI/batch dispatch is stopped. Only the explicitly scoped queue
    // may invoke the preserved binding, without toggling the pause flag.
    airDriveSectionGen=async(...args)=>{const error=Object.assign(new Error('Explicit recovery controller has paused ordinary dispatch'),{code:'QA_RESUME_DISPATCH_PAUSED'});args[3]?.onFail?.(error);return false;};
    const raw=window.__qaOriginalAirDrive;
    window.__qaOriginalAirDrive=async(c,s,si,opts)=>{
      const ci=chapters.indexOf(c),number=(ci+1)+'.'+(si+1);
      if(currentProjectId!==expected||!window.__qaDispatchPaused||!projectCanEdit()||!keys.includes(number)||chapters[ci]?.sections[si]!==s)throw Error('Explicit recovery section identity changed');
      if(ReportArgument.contract(c.name,s.t).summary){
        const incomplete=await window.__qaIncompleteCurrentDetails();
        if(incomplete.length){opts?.onFail?.(Object.assign(new Error('Detail sections are incomplete; summary AI was not called'),{code:'detail-sections-incomplete'}));return false;}
      }
      return raw(c,s,si,opts);
    };
    return {projectId:currentProjectId,paused:window.__qaDispatchPaused,sections:chapters.reduce((n,c)=>n+c.sections.length,0)};
  },{expected:h.target.id,keys:keys.filter(key=>key.startsWith(h.key+':')).map(key=>key.split(':')[1])});
}

async function installPaidScope(h,keys,mode,runId,audit){
  const sectionKeys=await h.page.evaluate(()=>chapters.flatMap((c,ci)=>c.sections.map((s,si)=>({number:(ci+1)+'.'+(si+1),sectionKey:c.name+' / '+s.t}))));
  const selected=new Set(keys),createdTasks=new Map(),repairs=new Map(),submitted=new Set();
  await h.context.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url()),method=request.method();
    if(['GET','HEAD','OPTIONS'].includes(method)||!['/api/generate','/api/reportexecution','/api/agent'].some(prefix=>url.pathname.startsWith(prefix)))return route.fallback();
    let body={};try{body=request.postDataJSON()||{};}catch{}
    let number=null,isRepair=false;
    if(mode==='bounded'&&url.pathname==='/api/generate'&&body.projectId===h.target.id){try{number=JSON.parse(body.messages?.find(x=>x.role==='user')?.content||'{}').section;}catch{}}
    if(mode==='missing'&&url.pathname==='/api/reportexecution'){
      if(body.action==='repair'){number=createdTasks.get(body.id);isRepair=true;}
      else if(body.projectId===h.target.id&&!body.action)number=sectionKeys.find(row=>row.sectionKey===body.sectionKey)?.number;
    }
    const keyNumber=h.key+':'+number,count=isRepair?(repairs.get(number)||0)+1:0;
    if(method!=='POST'||!selected.has(keyNumber)||isRepair&&count>2||!isRepair&&submitted.has(number))return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({ok:false,error:'Recovery permits only the explicit section and one initial paid submission; uncertain requests are never repeated.'})});
    if(isRepair)repairs.set(number,count);else submitted.add(number);
    const marker=path.join(OUT,'resume-paid-intent-'+h.key+'-'+number+(isRepair?'-repair-'+count:'')+'.json');
    // Write intent BEFORE the outbound request. Never clear it automatically,
    // even after success: a later paid action requires human reconciliation.
    const intent={runId,key:keyNumber,projectId:h.target.id,mode,path:url.pathname,repairRound:count,taskId:isRepair?body.id:null,at:new Date().toISOString(),requestSha256:sha(request.postData()||'')};
    await exclusive(marker,intent);audit.paidIntents.push({file:marker,...intent});
    try{
      const response=await route.fetch({timeout:190000,maxRetries:0});let result;try{result=await response.json();}catch{}
      if(result?.task?.id){h.taskIds.add(result.task.id);createdTasks.set(result.task.id,number);}
      await exclusive(path.join(OUT,'resume-paid-response-'+runId+'-'+h.key+'-'+number+'-'+count+'.json'),{...intent,httpStatus:response.status(),responseSha256:sha(await response.body()),task:result?.task?{id:result.task.id,runId:result.task.runId,status:result.task.status}:null});
      await route.fulfill({response});
    }catch(error){audit.uncertainPaidRequests.push({key:keyNumber,intentFile:marker,error:safeError(error)});await route.abort('failed').catch(()=>{});}
  });
}

async function saveActualState(h,isolation,snapshot,runId,phase){
  const state=await h.page.evaluate(expected=>{
    if(currentProjectId!==expected||!window.__qaDispatchPaused)throw Error('Exact paused copy changed before state capture');
    return {projectId:currentProjectId,chapters:ProjectWorkflow.clone(chapters),workflow:ProjectWorkflow.clone(projectWorkflow),persistableChapters:ProjectWorkflow.clone(buildDraftData().chapters),inputIdentity:reportCandidateInputIdentity()};
  },h.target.id);
  const remote=await isolation.sessions[h.key].request('/api/projects?id='+encodeURIComponent(h.target.id));validateProject(h.key,remote.project,snapshot);
  const remoteChapters=draftOf(remote.project.data).chapters;
  // PostgreSQL JSONB normalizes object-key order. Compare the complete state
  // with canonical object keys, while retaining raw hashes for diagnostics.
  // Only section-level failure absent/null is equivalent. All other fields,
  // non-null failure values, body strings and array order remain exact.
  const remoteComparableChaptersSha256=sha(stableResumeChapters(remoteChapters)),persistableComparableChaptersSha256=sha(stableResumeChapters(state.persistableChapters));
  const saved=persistableComparableChaptersSha256===remoteComparableChaptersSha256;
  const receipt=await exclusive(path.join(OUT,'resume-state-'+runId+'-'+h.key+'-'+phase+'.json'),{at:new Date().toISOString(),phase,key:h.key,...state,remoteSavedChaptersSha256:sha(remoteChapters),persistableChaptersSha256:sha(state.persistableChapters),remoteComparableChaptersSha256,persistableComparableChaptersSha256,remoteSaveVerified:saved,comparison:'full-state-canonical-keys-section-failure-null-v2',notIntendedProjection:true});
  return {...receipt,remoteSaveVerified:saved,sections:state.chapters.reduce((n,c)=>n+c.sections.length,0)};
}

// The legacy module has inspector-based CLI branches. Clear its argv only while
// importing the requested functions, so imported use cannot trigger those branches.
async function repairFunctions(){const previous=process.argv;try{process.argv=previous.slice(0,2);return await import('./report-runner-bounded-repair.mjs');}finally{process.argv=previous;}}

export async function runResumeAction(options=parseArgs()){
  if(!options.mode){const result={stage:'no-action',ok:true,...summarizeResumeCompletion([],[]),writes:0,newPaidAiCalls:0,modes:MODES};emit('no-action',{writes:0,status:result.status,contentComplete:result.contentComplete,completion:result.completion});return result;}
  if(globalThis.__qaResumeControllerRunning)throw Error('A recovery controller is already active');
  if(path.resolve(process.cwd()).toLowerCase()!==ROOT.toLowerCase())throw Error('Run from the repository root; the existing repair helpers bind this exact snapshot');
  // Validate programmatic options with exactly the same CLI scope rules.
  options=parseArgs(['--'+options.mode,String(options.value||options.keys?.join(',')||''),'--base-url',options.baseUrl||'http://localhost:8080',...(options.normalizeReviewedSchema?['--normalize-reviewed-schema']:[])]);
  const input=await readScopedInput(options),keys=input.keys,paid=['missing','bounded'].includes(options.mode);
  const runId=new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(4).toString('hex');
  const audit={version:'explicit-retained-report-resume-v1',runId,at:new Date().toISOString(),mode:options.mode,keys,allowAi:paid,targets:TARGETS,paidIntents:[],uncertainPaidRequests:[],states:{},sourceUnchangedBefore:null,sourceUnchangedAfter:null};
  const harnesses={},lock=path.join(OUT,'resume-execute.lock.json');let locked=false,snapshot,isolation,checkpoint,result,failure;
  globalThis.__qaResumeControllerRunning=true;
  try{
    snapshot=await loadSnapshots(SNAPSHOT);audit.sourceUnchangedBefore=await sourceChecks(snapshot);
    await exclusive(lock,{runId,pid:process.pid,at:audit.at});locked=true;
    isolation=await loadIsolation(snapshot,{baseUrl:options.baseUrl});
    const checkpointBytes=await fs.readFile(CHECKPOINT);checkpoint=JSON.parse(checkpointBytes);
    if(checkpoint.version!=='production-full-generation-v1'||!checkpoint.sections)throw Error('Existing generation checkpoint is required');
    const remote={};audit.backups={};
    for(const [key,expected] of Object.entries(TARGETS)){
      if(isolation.sessions[key].target.id!==expected.id||isolation.sessions[key].target.name!==expected.name||checkpoint.projects?.[key]?.id!==expected.id||checkpoint.sourceHashes?.[key]!==snapshot.sources[key].sourceIdentity.sourceSha256)throw Error('Old exact isolation/checkpoint identity mismatch');
      const opened=await isolation.sessions[key].request('/api/projects?id='+encodeURIComponent(expected.id));remote[key]=validateProject(key,opened.project,snapshot);
      audit.backups[key]=await exclusive(path.join(OUT,'resume-remote-backup-'+runId+'-'+key+'.json'),opened);
    }
    audit.checkpointBackup=await exclusive(path.join(OUT,'resume-checkpoint-backup-'+runId+'.json'),checkpointBytes);
    for(const key of keys){const [projectKey,number]=keyParts(key);sectionOf(remote[projectKey],number);}
    if(paid)audit.existingTaskChecks=await paidPreflight(isolation,remote,checkpoint,keys,options.mode);
    let inputFile;
    if(input.file){
      if(sha(await fs.readFile(input.file))!==input.sha256)throw Error('Explicit input changed during preflight');
      inputFile=path.join(OUT,'resume-input-'+runId+'-'+options.mode+'.json');
      audit.input={originalFile:input.file,originalSha256:input.sha256,...await exclusive(inputFile,options.normalizeReviewedSchema?input.value:input.bytes)};
    }
    emit('backed-up',{mode:options.mode,sections:keys.length,allowAi:paid});
    for(const key of Object.keys(TARGETS)){
      // Bootstrap itself is always zero-AI: the normal app may schedule restore
      // callbacks before openProductionHarness returns. Paid capability is only
      // enabled by the section-scoped route installed AFTER pausing below.
      const h=harnesses[key]=await openProductionHarness(isolation,key,{readOnly:false,allowAi:false});
      if(h.ledger.some(entry=>entry.isAi&&entry.allowed))throw Error('Unexpected AI dispatch occurred while opening the retained copy; no controller action was started');
      await pauseHarness(h,keys);
      const detailKeys=await h.page.evaluate(key=>chapters.flatMap((c,ci)=>c.sections.map((s,si)=>({key:key+':'+(ci+1)+'.'+(si+1),summary:ReportArgument.contract(c.name,s.t).summary}))).filter(row=>!row.summary).map(row=>row.key),key);
      await h.page.exposeFunction('__qaIncompleteCurrentDetails',()=>detailKeys.filter(name=>checkpoint.sections[name]?.status!=='passed'));
      await installPaidScope(h,keys,options.mode,runId,audit);
      audit.states[key]={start:await saveActualState(h,isolation,snapshot,runId,'start')};
      if(!audit.states[key].start.remoteSaveVerified)throw Error('Loaded actual chapters differ from the retained remote save; compare resume-state before modifying anything');
    }
    if(sha(await fs.readFile(CHECKPOINT))!==sha(checkpointBytes))throw Error('Existing checkpoint changed during bootstrap; no action started');
    await sourceChecks(snapshot);
    if(options.mode==='source'){
      const states={};
      for(const keyNumber of keys){
        const [key,number]=keyParts(keyNumber);
        states[keyNumber]=await harnesses[key].page.evaluate(({expected,number})=>{
          if(currentProjectId!==expected||!window.__qaDispatchPaused||!projectCanEdit())throw Error('Source preflight requires the exact paused editable copy');
          const [ci,si]=number.split('.').map(n=>Number(n)-1),s=chapters[ci].sections[si];
          return {projectId:currentProjectId,taskId:s.executionTask?.id||null,actual:s.editedHtml||s.content||'',selected:s.qaBoundedAiRevision?.candidateText||s.pendingRevision?.after||s.editedHtml||s.content||''};
        },{expected:TARGETS[key].id,number});
      }
      audit.sourcePreconditionsVerified=validateSourcePreconditions(input.value,states);
    }
    const helpers=await repairFunctions(),log=console.log;
    emit('executing',{mode:options.mode,sections:keys.length});
    try{
      console.log=()=>{};
      if(options.mode==='restore')result=await restorePreservedReceipts(harnesses,isolation,input.value,inputFile);
      else if(options.mode==='review')result=await helpers.acceptReviewedBodies(harnesses,checkpoint,inputFile);
      else if(options.mode==='structure')result=await helpers.runExactStructureBatch(harnesses,checkpoint,inputFile);
      else if(options.mode==='source')result=await helpers.runSourceCorrectionBatch(harnesses,checkpoint,inputFile);
      else if(options.mode==='revalidate')result=await helpers.revalidateRenderedCandidates(harnesses,checkpoint,{keys});
      else if(options.mode==='missing')result=await helpers.runMissingGenerationQueue(harnesses,checkpoint,{keys});
      else if(options.mode==='bounded')result=await helpers.runBoundedQueue(harnesses,checkpoint,{keys});
    }finally{console.log=log;}
    audit.action={file:result?.file,receipts:result?.receipts||[],newPaidAiCalls:result?.newPaidAiCalls??audit.paidIntents.length};
    if(audit.uncertainPaidRequests.length)throw Error('Paid response uncertain; retained intent forbids another POST');
  }catch(error){failure=error;audit.error=safeError(error);}
  finally{
    for(const [key,h] of Object.entries(harnesses)){
      try{audit.states[key]??={};audit.states[key].end=await saveActualState(h,isolation,snapshot,runId,'end');if(!audit.states[key].end.remoteSaveVerified)throw Error('Final actual chapters are not confirmed saved; preserved resume-state requires reconciliation');}catch(error){failure??=error;audit.states[key].endError=safeError(error);}
      try{await h.close();}catch(error){failure??=error;}
    }
    if(snapshot)try{audit.sourceUnchangedAfter=await sourceChecks(snapshot);}catch(error){failure??=error;audit.sourceCheckError=safeError(error);}
    if(locked){
      audit.completedAt=new Date().toISOString();audit.ok=!failure;
      Object.assign(audit,summarizeResumeCompletion(keys,result?.receipts,!failure));
      try{audit.receiptFile=path.join(OUT,'resume-action-'+runId+'.json');await exclusive(audit.receiptFile,audit);}catch(error){failure??=error;}
      try{if(JSON.parse(await fs.readFile(lock,'utf8')).runId===runId)await fs.unlink(lock);}catch(error){failure??=error;}
    }
    globalThis.__qaResumeControllerRunning=false;
  }
  audit.ok=!failure;Object.assign(audit,summarizeResumeCompletion(keys,result?.receipts,!failure));
  emit('finished',{ok:audit.ok,status:audit.status,contentComplete:audit.contentComplete,completion:audit.completion,mode:options.mode,requested:keys.length,processed:result?.receipts?.length||0,paidRequests:audit.paidIntents.length,receiptFile:audit.receiptFile||null});
  if(failure){failure.recoveryReceipt=audit.receiptFile;throw failure;}
  return audit;
}

if(process.argv[1]&&path.resolve(process.argv[1]).toLowerCase()===SELF.toLowerCase()){
  try{process.exitCode=resumeActionExitCode(await runResumeAction(parseArgs()));}catch(error){console.error(JSON.stringify({stage:'stopped',status:'execution-failed',error:safeError(error),receiptFile:error.recoveryReceipt||null}));process.exitCode=1;}
}
