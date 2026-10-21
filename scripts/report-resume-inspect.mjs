// Inspect retained test copies and already-paid tasks. Never submit or adopt work.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {loadSnapshots,loadIsolation,openProductionHarness,checkSourceUnchanged,taskBelongsToIsolation} from './report-generation-acceptance.mjs';

const require=createRequire(import.meta.url);
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const DEFAULT_SNAPSHOT=path.join(ROOT,'outputs/report-standardization/1010-full-generation-2026-10-10T02-04-51-303Z-3378c9e5');
const TARGETS=Object.freeze({
  tax:{id:'f4395f64-af1b-43bd-b809-580b5ec9406b',name:'[系统测试]全量报告验收-tax-8c14644b'},
  longgang:{id:'2884b7a3-960f-40c0-af89-5d19e0284836',name:'[系统测试]全量报告验收-longgang-d5470f22'}
});
const TERMINAL_FAILURES=new Set(['dead','failed','cancelled','invalidated','missing']);
const sha=value=>crypto.createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value??null)).digest('hex');
const safeError=error=>String(error?.message||error).replace(/Bearer\s+\S+/gi,'Bearer [redacted]').replace(/postgres(?:ql)?:\/\/[^\s]+/gi,'[database URL redacted]').slice(0,500);
const taskIdentity=task=>task?.id?{id:task.id,runId:task.runId||null,inputHash:task.graph?.find(n=>n.key==='context_snapshot')?.hash||null}:null;
const sectionTask=section=>taskIdentity(section?.executionTask)||taskIdentity(section?.task?.task)||taskIdentity(section?.task);
const same=(a,b)=>a!=null&&b!=null?JSON.stringify(a)===JSON.stringify(b):null;
const draftOf=state=>state?.draft||state||{};

export function parseArgs(argv=process.argv.slice(2)){
  const options={snapshotDir:DEFAULT_SNAPSHOT,baseUrl:'http://localhost:8080'};
  for(let i=0;i<argv.length;i++){
    if(argv[i]==='--snapshot-dir'&&argv[i+1])options.snapshotDir=path.resolve(argv[++i]);
    else if(argv[i]==='--base-url'&&argv[i+1])options.baseUrl=argv[++i];
    else throw Error('Only --snapshot-dir and --base-url are supported; this inspector has no generation mode');
  }
  const url=new URL(options.baseUrl);
  if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.protocol!=='http:'||url.username||url.password||url.search||url.hash)throw Error('Only an unauthenticated localhost HTTP base URL is permitted');
  const permitted=path.join(ROOT,'outputs/report-standardization');
  if(!options.snapshotDir.startsWith(permitted+path.sep))throw Error('Snapshot must remain inside outputs/report-standardization');
  return options;
}

function sectionsOf(state){
  const result=new Map();
  for(const [ci,c] of (draftOf(state).chapters||[]).entries())for(const [si,s] of (c.sections||[]).entries()){
    result.set(`${ci+1}.${si+1}`,{...s,sectionKey:(c.name||c.title||'')+' / '+(s.t||s.title||''),active:c.checked!==false});
  }
  return result;
}

function sectionDigest(section){
  if(!section)return null;
  const body=String(section.editedHtml||section.content||'');
  const pending=section.pendingRevision?.after;
  const bounded=section.qaBoundedAiRevision?.candidateText;
  return {
    sectionKey:section.sectionKey||null,active:section.active!==false,
    sectionSha256:sha(section),bodySha256:sha(body),bodyCharacters:body.length,
    bodyFieldsSha256:sha({content:String(section.content||''),editedHtml:section.editedHtml??null}),
    hasBody:!!body.replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').trim(),
    hasPendingRevision:!!section.pendingRevision,pendingSha256:typeof pending==='string'?sha(pending):null,
    boundedCandidateSha256:typeof bounded==='string'?sha(bounded):null,locked:!!section.locked,
    task:sectionTask(section),artifactStatus:section.status||null,errorCode:section.error?.code||null
  };
}

async function localSections(directory){
  const rows=new Map();
  for(const name of await fs.readdir(directory))if(/^\d+\.\d+\.json$/.test(name)){
    const file=path.join(directory,name),bytes=await fs.readFile(file),section=JSON.parse(bytes);
    rows.set(name.slice(0,-5),{section,file,fileSha256:sha(bytes.toString('utf8'))});
  }
  return rows;
}

async function optionalJson(file){
  try{const bytes=await fs.readFile(file);return {file,fileSha256:sha(bytes.toString('utf8')),value:JSON.parse(bytes)};}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
}

async function getTask(h,id){
  return h.page.evaluate(async id=>{
    const digest=async text=>{const bytes=new TextEncoder().encode(String(text||''));return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');};
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    try{
      const response=await fetch('/api/reportexecution?id='+encodeURIComponent(id),{method:'GET',headers:authHeaders(),signal:controller.signal});
      const data=await response.json().catch(()=>null),task=data?.task;
      if(!response.ok||!data?.ok||task?.id!==id)return {id,httpStatus:response.status,readFailed:true,errorCode:task?.id&&task.id!==id?'TASK_ID_MISMATCH':'TASK_GET_FAILED'};
      return {id:task.id,httpStatus:response.status,runId:task.runId||null,status:task.status||null,
        inputHash:task.graph?.find(n=>n.key==='context_snapshot')?.hash||null,rulesChanged:task.rulesChanged===true,
        qualityStatus:task.quality?.status||null,issueCodes:[...new Set((task.quality?.issues||[]).map(x=>x.code).filter(Boolean))],
        hasText:!!task.text,textSha256:await digest(task.text),rawTextSha256:await digest(task.rawText),
        repairRound:task.repair?.round??null,canRetry:task.repair?.canRetry===true};
    }catch(error){return {id,readFailed:true,errorCode:error.name==='AbortError'?'TASK_GET_TIMEOUT':'TASK_GET_CONNECTION'};}
    finally{clearTimeout(timer);}
  },id);
}

function recommendation(row){
  if(row.remote?.locked||row.remote?.hasPendingRevision)return 'Preserve the lock/candidate; compare and request explicit review, never auto-adopt.';
  if(row.remoteDiskBodyMatch===false||row.remoteDiskBodyFieldsMatch===false)return 'Preserve both remote and disk versions; compare immutable task/candidate evidence before any version-checked save.';
  if(row.taskChecks.some(x=>!x.belongsToExactCopy||x.inputHashMatches===false||x.sectionMatches===false||x.api?.rulesChanged))return 'Stop: task ownership, input, section or rules changed; do not POST or attach this result.';
  if(row.taskChecks.some(x=>x.api?.terminalFailure))return 'Retain the terminal task and failure; any new paid request requires a separately bounded decision.';
  if(row.taskChecks.some(x=>x.api?.waiting||x.api?.readFailed))return 'Only GET the same existing task again; do not repeat a paid POST.';
  if(row.taskChecks.some(x=>x.api?.status==='completed'))return 'Completed task is evidence, not accepted prose. Recheck current contract, facts and candidate identity before any writable recovery.';
  return 'No reliable completed task receipt: inspect retained artifacts; do not infer permission to generate.';
}

export async function runResumeInspect(options=parseArgs([])){
  const snapshot=await loadSnapshots(options.snapshotDir),out=path.join(snapshot.out,'generation-runner');
  await fs.access(out);
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const auditFile=path.join(out,`recovery-resume-1011-${stamp}-${crypto.randomUUID().slice(0,8)}.json`);
  const audit={version:'retained-report-resume-inspection-v1',at:new Date().toISOString(),snapshotDir:snapshot.out,
    mode:'read-only-existing-copies-and-existing-task-GET',newPaidAiCalls:0,projectWrites:0,autoAdoptions:0,
    sourceUnchangedBefore:{},sourceUnchangedAfter:{},projects:{},errors:[],
    nextWritableRecovery:{notExecuted:true,requires:'Explicit authorization, preserved remote/disk backups, exact current copy/section/task/input identity and version-checked save.',
      harness:'openProductionHarness(isolation,key,{allowAi:false}) only after the read-only audit is reviewed; installIsolatedProjectSaveAdapter must guard any later copy save.',
      warning:'recoverPaidResponses/browserBoundedAdmission/acceptReviewedBodies can write or adopt. Do not call them automatically. Do not run --run-all --resume merely to reconstruct lost memory.',
      finalGate:'Both actual copies need 43 accepted sections, no unresolved candidates, source unchanged, professional review and actual normal Word layout of 110–130 pages.'}};
  let client;const harnesses=[];
  try{
    for(const key of Object.keys(TARGETS))audit.sourceUnchangedBefore[key]=await checkSourceUnchanged(snapshot.sources[key].sourceIdentity);
    if(Object.values(audit.sourceUnchangedBefore).some(x=>x!==true))throw Error('An immutable source changed; inspection stopped before opening test copies');
    const isolation=await loadIsolation(snapshot,{baseUrl:options.baseUrl});
    const {Client}=require(path.join(ROOT,'local-server/node_modules/pg'));
    client=new Client({connectionString:process.env.DATABASE_URL});await client.connect();await client.query('BEGIN READ ONLY');
    const checkpoint=await optionalJson(path.join(out,'checkpoint.json'));
    for(const [key,expected] of Object.entries(TARGETS)){
      const session=isolation.sessions[key];
      if(session.target.id!==expected.id||session.target.name!==expected.name)throw Error('Retained copy identity differs from the explicitly scoped '+key+' copy');
      const h=await openProductionHarness(isolation,key,{readOnly:true,allowAi:false});harnesses.push(h);
      const opened=await session.request('/api/projects?id='+encodeURIComponent(expected.id));
      const project=opened.project,data=project?.data;
      if(project?.id!==expected.id||project.name!==expected.name||data?.qaAcceptance?.id!==expected.id||data.qaSourceStateSha256!==sha(snapshot.sources[key].state))throw Error('Exact copy/provenance check failed: '+key);
      const remote=sectionsOf(data),disk=await localSections(path.join(out,key,'sections'));
      const oldFinal=await optionalJson(path.join(out,key,'final.json')),prior=sectionsOf(oldFinal?.value);
      const numbers=[...new Set([...remote.keys(),...disk.keys(),...prior.keys()])].sort((a,b)=>{const x=a.split('.').map(Number),y=b.split('.').map(Number);return x[0]-y[0]||x[1]-y[1];});
      const rows=numbers.map(number=>{
        const local=disk.get(number),r=sectionDigest(remote.get(number)),d=sectionDigest(local?.section),f=sectionDigest(prior.get(number));
        return {number,checkpointStatus:checkpoint?.value.sections?.[key+':'+number]?.status||null,
          remote:r,disk:d,oldFinal:f,diskFile:local?.file||null,diskFileSha256:local?.fileSha256||null,
          remoteDiskBodyMatch:same(r?.bodySha256,d?.bodySha256),remoteDiskBodyFieldsMatch:same(r?.bodyFieldsSha256,d?.bodyFieldsSha256),
          remoteFinalBodyMatch:same(r?.bodySha256,f?.bodySha256),diskFinalBodyMatch:same(d?.bodySha256,f?.bodySha256),
          remoteDiskTaskMatch:same(r?.task,d?.task),remoteFinalTaskMatch:same(r?.task,f?.task),taskChecks:[]};
      });
      const ids=[...new Set(rows.flatMap(row=>[row.remote?.task?.id,row.disk?.task?.id,row.oldFinal?.task?.id].filter(Boolean)))];
      const dbRows=ids.length?(await client.query('SELECT id,project_id,user_id,section_key,input_hash,rules_hash,run_id FROM report_section_tasks WHERE id=ANY($1::text[])',[ids])).rows:[];
      const dbById=new Map(dbRows.map(row=>[row.id,row])),taskResults=new Map();
      let cursor=0;
      await Promise.all(Array.from({length:Math.min(4,ids.length)},async()=>{while(cursor<ids.length){const id=ids[cursor++],dbRow=dbById.get(id);if(!taskBelongsToIsolation(dbRow,session.target,session.user)){taskResults.set(id,{id,belongsToExactCopy:false,notFetched:true});continue;}const api=await getTask(h,id);api.terminalFailure=TERMINAL_FAILURES.has(api.status);api.waiting=!api.readFailed&&api.status!=='completed'&&!api.terminalFailure;taskResults.set(id,{id,belongsToExactCopy:true,persistedRunId:dbRow.run_id,api});}}));
      for(const row of rows){
        for(const origin of ['remote','disk','oldFinal']){
          const identity=row[origin]?.task;if(!identity)continue;
          const result=taskResults.get(identity.id),dbRow=dbById.get(identity.id);
          row.taskChecks.push({origin,...result,sectionMatches:dbRow?dbRow.section_key===row[origin].sectionKey:null,
            inputHashMatches:identity.inputHash&&dbRow?identity.inputHash===dbRow.input_hash:null,
            apiRunIdMatches:identity.runId&&result.api?.runId?identity.runId===result.api.runId:null,
            apiInputHashMatches:identity.inputHash&&result.api?.inputHash?identity.inputHash===result.api.inputHash:null});
        }
        row.nextAction=recommendation(row);
      }
      audit.projects[key]={id:project.id,name:project.name,updatedAt:project.updated_at,dataSha256:sha(data),exactIdentityVerified:true,
        sourceStateSha256:data.qaSourceStateSha256,oldFinal:oldFinal?{file:oldFinal.file,fileSha256:oldFinal.fileSha256,at:oldFinal.value.at,noFinalCertification:oldFinal.value.noFinalCertification===true}:null,
        sections:rows,summary:{activeSections:rows.filter(r=>r.remote?.active).length,remoteBodies:rows.filter(r=>r.remote?.hasBody).length,
          diskBodies:rows.filter(r=>r.disk?.hasBody).length,remoteCandidates:rows.filter(r=>r.remote?.hasPendingRevision).length,
          bodyDivergences:rows.filter(r=>r.remoteDiskBodyMatch===false).length,existingTaskIds:ids.length,
          taskGetFailures:[...taskResults.values()].filter(r=>r.api?.readFailed).length,foreignOrMissingTasks:[...taskResults.values()].filter(r=>!r.belongsToExactCopy).length},
        harness:{errors:h.errors.map(safeError),nonReadRequests:h.ledger.map(({path,method,action,allowed,isAi})=>({path,method,action,allowed,isAi}))}};
    }
    await client.query('ROLLBACK');
  }catch(error){audit.errors.push({code:'RESUME_INSPECTION_FAILED',message:safeError(error)});}
  finally{
    for(const h of harnesses)await h.close().catch(()=>{});
    if(client){await client.query('ROLLBACK').catch(()=>{});await client.end().catch(()=>{});}
    for(const key of Object.keys(TARGETS))try{audit.sourceUnchangedAfter[key]=await checkSourceUnchanged(snapshot.sources[key].sourceIdentity);}catch(error){audit.sourceUnchangedAfter[key]=null;audit.errors.push({code:'SOURCE_AFTER_CHECK_FAILED',key,message:safeError(error)});}
  }
  audit.sourceUnchanged=Object.values(audit.sourceUnchangedBefore).length===2&&Object.values(audit.sourceUnchangedAfter).length===2&&[...Object.values(audit.sourceUnchangedBefore),...Object.values(audit.sourceUnchangedAfter)].every(x=>x===true);
  audit.ok=!audit.errors.length&&audit.sourceUnchanged&&Object.keys(audit.projects).length===2;
  await fs.writeFile(auditFile,JSON.stringify(audit,null,2),{flag:'wx',mode:0o600});
  return {ok:audit.ok,auditFile,newPaidAiCalls:0,projectWrites:0,sourceUnchanged:audit.sourceUnchanged,projects:Object.fromEntries(Object.entries(audit.projects).map(([key,p])=>[key,{id:p.id,...p.summary}])),errorCount:audit.errors.length};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const summary=await runResumeInspect(parseArgs());console.log(JSON.stringify(summary));if(!summary.ok)process.exitCode=1;}
  catch(error){console.error(JSON.stringify({ok:false,error:safeError(error),newPaidAiCalls:0,projectWrites:0}));process.exitCode=1;}
}
