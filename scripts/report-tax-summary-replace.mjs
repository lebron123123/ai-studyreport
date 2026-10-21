// Explicit, one-shot replacement of two authorized, outcome-unknown Tax calls.
// Import and invocation without --execute perform no I/O. Never adopts text.
import './windows-browser-lockout-guard.cjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadSnapshots,loadIsolation,openProductionHarness,checkSourceUnchanged,taskBelongsToIsolation} from './report-generation-acceptance.mjs';
import {taskContextHash} from './report-tax-summary-recovery.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const SNAPSHOT=path.join(ROOT,'outputs/report-standardization/1010-full-generation-2026-10-10T02-04-51-303Z-3378c9e5');
const OUT=path.join(SNAPSHOT,'generation-runner'),RECOVERY=path.join(OUT,'tax/recovery');
const require=createRequire(import.meta.url);
export const TAX_REPLACEMENT_POLICY=Object.freeze({
  projectId:'f4395f64-af1b-43bd-b809-580b5ec9406b',projectName:'[系统测试]全量报告验收-tax-8c14644b',
  authorization:'User explicitly authorized exactly one replacement each for Tax 3.7 and 12.1, aware that old unknown calls may also have been charged.',
  sections:{
    '3.7':{taskId:'rsec_9a369a5215c8e3d25cdb975e9112bce2be4472e47fd6df69e212e0cc7b65ee0e',runId:'run_a21671e1-62d3-4915-8139-12bab9f08307',inputHash:'6df759053ff1d2e4875a697a9977aca9a8aa21a3a030ddf8056b55795e55ab4b'},
    '12.1':{taskId:'rsec_8275390aabad777b0249be20e1c6a8df4ce736ff9e6da76d8d2b64c3612fdd0b',runId:'run_77c3cfe1-b2f7-4aaf-b6e2-4d927d9806cc',inputHash:'d6672d63f0e2a86d9c7478280ede4b300b86a9ee008799e7d17847e8cc042f2d'}
  }
});
export const replacementSha=value=>crypto.createHash('sha256').update(Buffer.isBuffer(value)||typeof value==='string'?value:JSON.stringify(value)).digest('hex');
// A second 3.7 permit was separately authorized after the retained balance
// failure. It does not reopen the first permit or reconcile either old charge.
export const TAX_ADDITIONAL_37_EVIDENCE=Object.freeze({
  intentSha256:'3cc1c718e67f3a5569f140b14c6c13222941f567b5734ec732f78b7868f9b6d8',
  rawSha256:'559296edf06c5a37ac178c1ca2d5edb1fda2a9f291274f218f3aefa606e630a8',
  stopSha256:'3df0c0bcd394056546c7c96ad83e67b0cf335a51d1137ad7d0ce161e98603b8b',
  responseBodySha256:'66c7f40a463324c7201c4e1abc936f7bdda754fe0a9e9ea42a8cbe124af22f65'
});
const assert=(value,message)=>{if(!value)throw Error(message);};
const assertReplacementOrder=sections=>assert(sections.length!==2||(sections[0]==='3.7'&&sections[1]==='12.1'),'Two-section requests must run 3.7 before 12.1');
const emit=(stage,value={})=>console.log(JSON.stringify({stage,...value}));
const safe=error=>String(error?.message||error).replace(/Bearer\s+\S+/gi,'Bearer [redacted]').replace(/postgres(?:ql)?:\/\/\S+/gi,'[database URL redacted]').slice(0,600);
async function exclusive(file,value){const raw=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value,null,2)+'\n');await fs.writeFile(file,raw,{flag:'wx'});assert(replacementSha(await fs.readFile(file))===replacementSha(raw),'Exclusive receipt readback differs');return {file,sha256:replacementSha(raw),bytes:raw.length};}
export function parseReplacementArgs(argv){
  if(!argv.length)return {execute:false,sections:[]};
  const additional37Once=argv.length===4&&argv[3]==='--additional-37-once';
  assert((argv.length===3||additional37Once)&&argv[0]==='--execute'&&argv[1]==='--sections','Use --execute --sections 3.7,12.1 [--additional-37-once]');
  const sections=argv[2].split(',');assert(sections.length&&new Set(sections).size===sections.length&&sections.every(n=>Object.hasOwn(TAX_REPLACEMENT_POLICY.sections,n)),'Only the two explicitly authorized sections are permitted');
  assertReplacementOrder(sections);
  assert(!additional37Once||sections.includes('3.7'),'Additional permit applies only to 3.7');
  return {execute:true,sections,...(additional37Once?{additional37Once:true}:{})};
}
export function validateAdditional37Evidence({intentBytes,rawBytes,stopBytes}){
  const expected=TAX_ADDITIONAL_37_EVIDENCE;
  assert(replacementSha(intentBytes)===expected.intentSha256&&replacementSha(rawBytes)===expected.rawSha256&&replacementSha(stopBytes)===expected.stopSha256,'Retained first 3.7 failure evidence changed');
  const intent=JSON.parse(intentBytes),raw=JSON.parse(rawBytes),stop=JSON.parse(stopBytes),old=TAX_REPLACEMENT_POLICY.sections['3.7'];
  assert(intent.number==='3.7'&&intent.projectId===TAX_REPLACEMENT_POLICY.projectId&&intent.oldTask?.id===old.taskId&&intent.oldTask.runId===old.runId&&intent.oldTask.inputHash===old.inputHash&&intent.repeatForbidden===true,'First replacement identity changed');
  assert(raw.number==='3.7'&&raw.httpStatus===502&&raw.ok===false&&raw.bodySha256===expected.responseBodySha256&&replacementSha(Buffer.from(raw.bodyBase64,'base64'))===expected.responseBodySha256,'First replacement response differs');
  const body=Buffer.from(raw.bodyBase64,'base64').toString('utf8');
  assert(body.includes('Insufficient Balance')&&!JSON.parse(body).content,'Only the exact retained empty balance failure permits this separately authorized branch');
  assert(stop.number==='3.7'&&stop.repeatForbidden===true&&stop.intentReceipt?.sha256===expected.intentSha256&&stop.rawReceipt?.sha256===expected.rawSha256,'First replacement stop receipt differs');
  return {version:'tax-additional-37-separate-authorization-v1',...expected,oldTaskId:old.taskId,oldRunId:old.runId,oldInputHash:old.inputHash,authorization:'User explicitly authorized one additional Tax 3.7 request after recharging; parent verified official balance available 2026-10-13T06:45:10Z. Original unknown call and first balance-failure attempt remain unchanged and may have incurred charges.',newPaidRequestLimit:1,oldPermitRemainsConsumed:true};
}
async function readAdditional37Evidence(){
  const stem=path.join(RECOVERY,'tax-summary-replacement-once-3.7-'+TAX_REPLACEMENT_POLICY.sections['3.7'].taskId);
  const files={intent:stem+'.json',raw:stem+'.raw.json',stop:stem+'.uncertain.json'};
  const proof=validateAdditional37Evidence({intentBytes:await fs.readFile(files.intent),rawBytes:await fs.readFile(files.raw),stopBytes:await fs.readFile(files.stop)});
  return {...proof,files};
}
export function replacementIntentName(number,{additional37Once=false}={}){
  const old=TAX_REPLACEMENT_POLICY.sections[number];assert(old,'Only exact authorized sections are permitted');
  assert(!additional37Once||number==='3.7','Additional permit applies only to 3.7');
  return 'tax-summary-replacement-'+(additional37Once?'additional-37-once-':'once-')+number+'-'+old.taskId+'.json';
}
export function validateReplacementEvidence(number,{owner,task,jobs,ledger,input,section,projectId,userId}){
  const expected=TAX_REPLACEMENT_POLICY.sections[number];assert(expected&&projectId===TAX_REPLACEMENT_POLICY.projectId,'Exact authorized target required');
  assert(owner?.id===expected.taskId&&owner.run_id===expected.runId&&owner.input_hash===expected.inputHash&&owner.project_id===projectId&&owner.user_id===userId,'Old task identity changed');
  assert(task?.id===expected.taskId&&task.runId===expected.runId&&task.status==='dead'&&!task.text&&taskContextHash(task)===expected.inputHash,'Old task must remain dead without recovered text');
  assert(section?.executionTask?.id===expected.taskId&&!(section.editedHtml||section.content||'').trim()&&!section.pendingRevision,'Target already has body/candidate or original task changed');
  assert(jobs?.length===1&&jobs[0].status==='dead'&&jobs[0].run_id===expected.runId,'Original job must be terminal dead');
  assert(ledger?.length===1&&ledger[0].status==='outcome_unknown'&&!ledger[0].response_json,'Existing unknown ledger or response changed');
  assert(replacementSha(input)===expected.inputHash&&input.sectionKey===owner.section_key&&input.projectType&&input.qualityContract,'Persisted original input changed');
  return true;
}
export function replacementRequest(payload,projectId){
  assert(projectId===TAX_REPLACEMENT_POLICY.projectId&&payload?.projectId===projectId&&typeof payload.system==='string'&&payload.system&&typeof payload.query==='string'&&payload.query&&Number.isFinite(payload.maxTokens),'Original job request is incomplete');
  // Exact original system/query; this branch is a disclosed replacement, not an
  // idempotency-key or prompt mutation intended to evade the unknown ledger.
  return {kind:'batch',stream:false,projectId,system:payload.system,messages:[{role:'user',content:payload.query}],max_tokens:payload.maxTokens,response_format:{type:'json_object'}};
}
export async function dispatchReplacementOnce({intentFile,intent,request,token,baseUrl,fetchImpl=fetch,writeExclusive=exclusive}){
  // An existing intent blocks even when a previous process lost its response.
  // The consumption record is immutable and is never removed in finally.
  const intentReceipt=await writeExclusive(intentFile,{...intent,requestSha256:replacementSha(JSON.stringify(request)),request,newPaidRequestLimit:1,repeatForbidden:true});
  const rawFile=intentFile.replace(/\.json$/,'.raw.json');
  let rawReceipt;
  try{
    const response=await fetchImpl(baseUrl+'/api/generate',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(request),redirect:'error',signal:AbortSignal.timeout(240000)});
    const bytes=Buffer.from(await response.arrayBuffer());
    rawReceipt=await writeExclusive(rawFile,{version:'tax-authorized-replacement-raw-v1',number:intent.number,intentReceipt,at:new Date().toISOString(),httpStatus:response.status,ok:response.ok,bodyBase64:bytes.toString('base64'),bodySha256:replacementSha(bytes),newPaidAiCalls:1,oldTaskUnchanged:true});
    // Decode only after the full raw HTTP response has been retained/read back.
    let data;try{data=JSON.parse(bytes.toString('utf8'));}catch{throw Error('Retained response is not JSON; never resubmit');}
    assert(response.ok,'Replacement HTTP failure retained; never resubmit');
    const text=(data.content||[]).filter(row=>row.type==='text').map(row=>row.text||'').join('');assert(text.trim(),'Replacement response has no text; never resubmit');
    return {intentReceipt,rawReceipt,text,data};
  }catch(error){
    await writeExclusive(intentFile.replace(/\.json$/,'.uncertain.json'),{version:'tax-authorized-replacement-stop-v1',at:new Date().toISOString(),number:intent.number,intentReceipt,rawReceipt:rawReceipt||null,error:safe(error),newPaidAiCalls:1,repeatForbidden:true});
    throw error;
  }
}
async function sources(snapshot){const result={};for(const[key,source]of Object.entries(snapshot.sources))result[key]=await checkSourceUnchanged(source.sourceIdentity);assert(Object.values(result).every(v=>v===true),'Formal source changed');return result;}
export async function runTaxSummaryReplacements(options={execute:false,sections:[]}){
  if(options.execute!==true)return {status:'not-executed',newPaidAiCalls:0,projectWrites:0};
  assert(options.sections?.length&&new Set(options.sections).size===options.sections.length&&options.sections.every(n=>TAX_REPLACEMENT_POLICY.sections[n]),'Exact authorized sections required');
  assertReplacementOrder(options.sections);
  assert(options.additional37Once!==true||options.sections.includes('3.7'),'Additional permit applies only to 3.7');
  const additional37=options.additional37Once===true?await readAdditional37Evidence():null;
  const snapshot=await loadSnapshots(SNAPSHOT),formalBefore=await sources(snapshot),isolation=await loadIsolation(snapshot),session=isolation.sessions.tax;
  assert(session.target.id===TAX_REPLACEMENT_POLICY.projectId&&session.target.name===TAX_REPLACEMENT_POLICY.projectName,'Exact retained Tax copy required');
  const opened=await session.request('/api/projects?id='+session.target.id),remote=opened.project;
  assert(remote?.data?.qaAcceptance?.id===session.target.id&&remote.data.qaSourceStateSha256===replacementSha(snapshot.sources.tax.state),'Tax QA provenance changed');
  const checkpoint=await fs.readFile(path.join(OUT,'checkpoint.json')),at=new Date().toISOString(),stamp=at.replace(/[:.]/g,'-')+'-'+crypto.randomUUID().slice(0,8);
  const backup=await exclusive(path.join(OUT,'tax-summary-replacement-remote-before-'+stamp+'.json'),opened),checkpointBackup=await exclusive(path.join(OUT,'tax-summary-replacement-checkpoint-before-'+stamp+'.json'),checkpoint);
  const {Client}=require(path.join(ROOT,'local-server/node_modules/pg')),db=new Client({connectionString:process.env.DATABASE_URL});await db.connect();
  const prepared=[],results=[];let h;
  try{
    await db.query('BEGIN READ ONLY');
    for(const number of options.sections){
      const expected=TAX_REPLACEMENT_POLICY.sections[number],[ci,si]=number.split('.').map(n=>Number(n)-1),section=remote.data.chapters[ci].sections[si];
      const owner=(await db.query('SELECT id,project_id,user_id,section_key,input_hash,run_id,input_json FROM report_section_tasks WHERE id=$1',[expected.taskId])).rows[0];
      assert(taskBelongsToIsolation(owner,session.target,session.user),'Old task owner differs');
      const task=(await session.request('/api/reportexecution?id='+expected.taskId)).task;
      const jobs=(await db.query('SELECT id,run_id,status,payload_json FROM agent_jobs WHERE run_id=$1 AND user_id=$2',[expected.runId,session.user.id])).rows;
      const ledger=(await db.query('SELECT id,status,response_json,actual_input,actual_output,actual_cost FROM agent_call_ledger WHERE run_id=$1 AND user_id=$2',[expected.runId,session.user.id])).rows;
      const input=JSON.parse(owner.input_json),payload=JSON.parse(jobs[0]?.payload_json||'null');
      validateReplacementEvidence(number,{owner,task,jobs,ledger,input,section,projectId:session.target.id,userId:session.user.id});
      assert(payload.reportSectionTaskId===expected.taskId,'Original job payload task differs');
      prepared.push({number,owner,task,jobs,ledger,input,section,request:replacementRequest(payload,session.target.id)});
    }
    await db.query('ROLLBACK');
    h=await openProductionHarness(isolation,'tax',{readOnly:true,allowAi:false});
    await h.page.evaluate(()=>{window.__qaDispatchPaused=true;});
    await h.page.evaluate(id=>openAiReportProject(id),session.target.id);
    await h.page.waitForFunction(()=>aiReportChatLoaded&&!aiReportRestoreLoading,{timeout:60000});
    await h.page.evaluate(async()=>{await ReportLogicCore.load(rlProjectType());await ensureReportTableTemplates();});
    const preflight=await h.page.evaluate(({projectId,numbers})=>{
      if(currentProjectId!==projectId||!window.__qaDispatchPaused)throw Error('Readonly prepared project changed');
      const plan=reportAssertCompletionPlan(reportCompletionPlan());
      return {sourceIdentity:reportCandidateInputIdentity(),plan,chapters:ProjectWorkflow.clone(chapters),rows:numbers.map(number=>{const[ci,si]=number.split('.').map(n=>Number(n)-1),c=chapters[ci],s=c.sections[si];const prepared=reportPrepareSummaryContext(c,s,plan);return {number,sectionKey:c.name+' / '+s.t,summarySnapshot:prepared.snapshot,summaryContext:prepared.context,contract:plan.sections.find(row=>row.sectionKey===c.name+' / '+s.t),section:ProjectWorkflow.clone(s)};})};
    },{projectId:session.target.id,numbers:options.sections});
    assert(!h.errors.length&&!h.ledger.some(row=>row.isAi&&row.allowed),'Readonly preflight error or unexpected AI');
    const preflightReceipt=await exclusive(path.join(OUT,'tax-summary-replacement-preflight-'+stamp+'.json'),{version:'tax-summary-replacement-preflight-v1',at,preflight,backup,checkpointBackup,formalBefore,projectWrites:0});
    await h.close();h=null;
    for(const item of prepared){
      const current=(await session.request('/api/projects?id='+session.target.id)).project;assert(replacementSha(current)===replacementSha(remote),'Tax remote changed before paid request');await sources(snapshot);
      const row=preflight.rows.find(r=>r.number===item.number);assert(row.contract&&row.summaryContext&&row.section.executionTask?.id===item.owner.id,'Strict summary preflight identity missing');
      const additional=item.number==='3.7'?additional37:null;
      if(additional)assert(replacementSha(await readAdditional37Evidence())===replacementSha(additional),'First 3.7 failure evidence changed before dispatch');
      const intent={version:'tax-authorized-summary-replacement-intent-v1',at:new Date().toISOString(),number:item.number,projectId:session.target.id,projectName:session.target.name,authorization:additional?.authorization||TAX_REPLACEMENT_POLICY.authorization,...(additional?{separateAdditionalPermit:additional}:{}),oldTask:{id:item.owner.id,runId:item.owner.run_id,inputHash:item.owner.input_hash,status:item.task.status,ledger:item.ledger},oldInput:item.input,oldTaskGet:item.task,oldJob:item.jobs,remoteSha256:replacementSha(remote),sectionSha256:replacementSha(item.section),currentContract:row.contract,currentContractSha256:replacementSha(row.contract),sourceIdentity:preflight.sourceIdentity,summarySnapshot:row.summarySnapshot,preflightReceipt,backup,checkpointBackup,oldAccountUnmodified:true,notAccepted:true};
      const intentFile=path.join(RECOVERY,replacementIntentName(item.number,{additional37Once:!!additional}));
      emit('replacement-dispatch',{number:item.number,newPaidRequestLimit:1,oldTaskId:item.owner.id});
      const result=await dispatchReplacementOnce({intentFile,intent,request:item.request,token:session.token,baseUrl:isolation.baseUrl});
      const candidate=await exclusive(path.join(RECOVERY,'tax-summary-replacement-candidate-'+item.number+'-'+stamp+'.json'),{version:'tax-summary-replacement-retained-raw-candidate-v1',at:new Date().toISOString(),number:item.number,projectId:session.target.id,oldTaskId:item.owner.id,oldRunId:item.owner.run_id,oldInputHash:item.owner.input_hash,intentReceipt:result.intentReceipt,rawReceipt:result.rawReceipt,structuredText:result.text,structuredTextSha256:replacementSha(result.text),usage:result.data.usage||null,provider:result.data.provider||null,model:result.data.model||null,currentContract:row.contract,sourceIdentity:preflight.sourceIdentity,notAccepted:true,factsVerified:false,semanticReviewRequired:true,newPaidAiCalls:1});
      results.push({number:item.number,status:'raw-retained-not-adopted',candidate,raw:result.rawReceipt});emit('replacement-raw-retained',{number:item.number,file:candidate.file,rawSha256:result.rawReceipt.sha256});
    }
    const after=(await session.request('/api/projects?id='+session.target.id)).project;assert(replacementSha(after)===replacementSha(remote),'Tax remote changed during replacement capture');assert(replacementSha(await fs.readFile(path.join(OUT,'checkpoint.json')))===replacementSha(checkpoint),'Checkpoint changed');
    const formalAfter=await sources(snapshot),receipt=await exclusive(path.join(OUT,'tax-summary-replacement-receipt-'+stamp+'.json'),{version:'tax-summary-replacement-receipt-v1',at,results,formalBefore,formalAfter,remoteUnchanged:true,checkpointUnchanged:true,oldTasksAndLedgersNotMutated:true,newPaidAiCalls:results.length,projectWrites:0,notAccepted:true});return {...receipt,results};
  }finally{if(h)await h.close();await db.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  runTaxSummaryReplacements(parseReplacementArgs(process.argv.slice(2))).then(result=>emit('replacement-finished',result)).catch(error=>{emit('replacement-stopped',{error:safe(error),repeatForbidden:true});process.exitCode=1;});
}
