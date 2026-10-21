// Zero-AI adoption preparation for the two already-paid, retained Tax responses.
import './windows-browser-lockout-guard.cjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {loadSnapshots,loadIsolation,openProductionHarness,checkSourceUnchanged} from './report-generation-acceptance.mjs';
import {browserBoundedAdmission} from './report-runner-bounded-repair.mjs';
import {stableResumeJson} from './report-resume-execute.mjs';
const BASE=path.resolve('outputs/report-standardization/1010-full-generation-2026-10-10T02-04-51-303Z-3378c9e5'),OUT=path.join(BASE,'generation-runner');
const ID='f4395f64-af1b-43bd-b809-580b5ec9406b',NAME='[系统测试]全量报告验收-tax-8c14644b';
const FILES=[['3.7','ad50fc948e04da55da330e9a0af4e586de3d40fd646420b01b2dd8fd2d580159'],['12.1','134330db0ae20ef2d91fc205436a6c90c12f7c2e428da81dd67650cdc047dd70']].map(([number,sha256])=>({number,sha256,file:path.join(OUT,'tax/recovery/tax-summary-replacement-candidate-'+number+'-2026-10-13T07-10-59-216Z-9a2c5fa2.json')}));
export const retainedSha=v=>crypto.createHash('sha256').update(Buffer.isBuffer(v)||typeof v==='string'?v:JSON.stringify(v??null)).digest('hex');
const assert=(v,m)=>{if(!v)throw Error(m);};
const canonical=v=>JSON.stringify(stableResumeJson(v));
function comparableChapters(value){const chapters=stableResumeJson(value);for(const c of chapters)for(const s of c.sections)for(const field of ['generationFailure','candidateGenerationFailure'])if(s[field]===null)delete s[field];return chapters;}
async function wx(file,value){const bytes=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value,null,2)+'\n');await fs.writeFile(file,bytes,{flag:'wx'});assert(retainedSha(await fs.readFile(file))===retainedSha(bytes),'Retained receipt readback failed');return {file,sha256:retainedSha(bytes),bytes:bytes.length};}
async function frozen(receipt){const bytes=await fs.readFile(receipt.file);assert(retainedSha(bytes)===receipt.sha256,'Retained paid evidence changed');return JSON.parse(bytes);}
export function validateRetainedSummary(candidate,raw,intent,{number,projectId,sourceIdentity,section}){
  assert(['3.7','12.1'].includes(number)&&projectId===ID&&candidate.number===number&&candidate.projectId===ID,'Exact retained replacement target required');
  assert(candidate.sourceIdentity===sourceIdentity&&candidate.notAccepted===true&&candidate.semanticReviewRequired===true,'Retained response source identity changed');
  assert(!String(section.editedHtml||section.content||'').trim()&&!section.pendingRevision,'Existing body/candidate cannot be replaced');
  assert(section.executionTask?.id===candidate.oldTaskId&&section.executionTask?.runId===candidate.oldRunId,'Original task identity changed');
  assert(intent.projectId===ID&&intent.number===number&&intent.oldTask?.id===candidate.oldTaskId&&intent.oldTask?.runId===candidate.oldRunId&&intent.oldTask?.inputHash===candidate.oldInputHash,'Retained intent/task/input mismatch');
  assert(raw.httpStatus===200&&raw.ok===true&&raw.number===number&&raw.intentReceipt?.sha256===candidate.intentReceipt.sha256,'Retained raw is incomplete or uncertain');
  const body=Buffer.from(raw.bodyBase64,'base64');assert(retainedSha(body)===raw.bodySha256,'Raw body changed');
  const payload=JSON.parse(body),text=(payload.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('');
  assert(text===candidate.structuredText&&retainedSha(text)===candidate.structuredTextSha256&&text.trim(),'Retained structured response differs');
  assert(canonical(payload.usage||null)===canonical(candidate.usage||null)&&payload.provider===candidate.provider&&payload.model===candidate.model,'Paid usage/provider changed');
  return true;
}
export async function initializeRetainedHarness(h,{execute=false}={}){
  await h.page.evaluate(()=>{window.__qaDispatchPaused=true;window.__qaOriginalAirDrive??=airDriveSectionGen;airDriveSectionGen=async()=>{throw Error('Retained recovery has paused all ordinary dispatch');};});
  // The read-only harness binds identity/access but deliberately does not open
  // the report workspace. Restore it explicitly before comparing saved data.
  if(!execute)await h.page.evaluate(id=>openAiReportProject(id),ID);
  await h.page.waitForFunction(()=>aiReportChatLoaded&&!aiReportRestoreLoading,{timeout:60000});
  await h.page.evaluate(async expected=>{if(currentProjectId!==expected||!projectCanEdit())throw Error('Exact editable QA required');window.__qaDispatchPaused=true;await ReportLogicCore.load(rlProjectType());await ensureReportTableTemplates();},ID);
}
export async function saveRetainedTaxSummaries({execute=false,dryRun=false}={}){
  if(!execute&&!dryRun)return {status:'not-executed',newPaidAiCalls:0,projectWrites:0};
  assert(!(execute&&dryRun),'Select one explicit retained-save mode');
  const runId=new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(4).toString('hex'),audit={version:'tax-retained-summary-zero-ai-save-v1',runId,execute,newPaidAiCalls:0,rows:[],states:{}};
  const lock=path.join(OUT,'resume-execute.lock.json'),checkpointFile=path.join(OUT,'checkpoint.json');let locked=false,h,isolation,snapshot,failure,start;
  async function sources(){const values={};for(const [key,s]of Object.entries(snapshot.sources))values[key]=await checkSourceUnchanged(s.sourceIdentity);assert(Object.values(values).every(Boolean),'Formal source changed');return values;}
  function validateRemote(remote){assert(remote.project?.id===ID&&remote.project.name===NAME&&remote.project.data?.qaAcceptance?.id===ID&&remote.project.data.qaSourceStateSha256===retainedSha(snapshot.sources.tax.state),'Exact QA provenance changed');const data=remote.project.data.draft||remote.project.data;assert(data.chapters.reduce((n,c)=>n+c.sections.length,0)===43,'Exact 43-section QA copy required');return data;}
  async function state(phase){const actual=await h.page.evaluate(()=>({projectId:currentProjectId,chapters:ProjectWorkflow.clone(chapters),workflow:ProjectWorkflow.clone(projectWorkflow),persistableChapters:ProjectWorkflow.clone(buildDraftData().chapters),inputIdentity:reportCandidateInputIdentity(),financial:reportFinancialIdentity()}));assert(actual.projectId===ID,'Current project changed');const remote=await isolation.sessions.tax.request('/api/projects?id='+ID),data=validateRemote(remote),verified=canonical(comparableChapters(data.chapters))===canonical(comparableChapters(actual.persistableChapters));const saved=await wx(path.join(OUT,'resume-state-'+runId+'-tax-retained-'+phase+'.json'),{at:new Date().toISOString(),phase,key:'tax',...actual,remoteSaveVerified:verified,notIntendedProjection:true});audit.states[phase]={...saved,remoteSaveVerified:verified};return {actual,remote,verified};}
  try{
    snapshot=await loadSnapshots(BASE);audit.formalBefore=await sources();await wx(lock,{runId,pid:process.pid,at:new Date().toISOString()});locked=true;
    isolation=await loadIsolation(snapshot);assert(isolation.sessions.tax.target.id===ID&&isolation.sessions.tax.target.name===NAME,'Exact retained Tax session required');
    const remote=await isolation.sessions.tax.request('/api/projects?id='+ID);validateRemote(remote);audit.remoteBackup=await wx(path.join(OUT,'tax-retained-summary-remote-before-'+runId+'.json'),remote);
    const checkpointBytes=await fs.readFile(checkpointFile),checkpoint=JSON.parse(checkpointBytes);assert(checkpoint.version==='production-full-generation-v1'&&checkpoint.projects?.tax?.id===ID&&checkpoint.sourceHashes?.tax===snapshot.sources.tax.sourceIdentity.sourceSha256&&checkpoint.sections,'Exact checkpoint required');audit.checkpointBackup=await wx(path.join(OUT,'tax-retained-summary-checkpoint-before-'+runId+'.json'),checkpointBytes);
    const inputs=[];for(const spec of FILES){const candidate=await frozen(spec),raw=await frozen(candidate.rawReceipt),intent=await frozen(candidate.intentReceipt);inputs.push({spec,candidate,raw,intent});}
    h=await openProductionHarness(isolation,'tax',{readOnly:!execute,allowAi:false});await initializeRetainedHarness(h,{execute});
    start=await state('start');assert(start.verified,'Loaded current full chapters are not saved');
    const prepared=[];for(const {spec,candidate,raw,intent}of inputs){const prep=await h.page.evaluate(number=>{const[ci,si]=number.split('.').map(n=>+n-1),s=chapters[ci].sections[si];return {originalSection:ProjectWorkflow.clone(s),sourceIdentity:reportCandidateInputIdentity(),text:s.qaBoundedAiRevision?.candidateText||s.pendingRevision?.after||s.editedHtml||s.content||''};},spec.number);validateRetainedSummary(candidate,raw,intent,{number:spec.number,projectId:ID,sourceIdentity:prep.sourceIdentity,section:prep.originalSection});const decoded=await h.page.evaluate(({text,contract})=>ReportCompletionContract.decodeStructured(text,contract),{text:candidate.structuredText,contract:candidate.currentContract});assert(decoded.text?.trim()&&!decoded.issues.some(x=>x.severity==='error'),'Retained structured output failed exact decoder: '+spec.number);const decodedReceipt=await wx(path.join(OUT,'tax-retained-summary-decoded-'+spec.number+'-'+runId+'.json'),{number:spec.number,...decoded,candidateEvidence:spec,notAccepted:true});prepared.push({spec,candidate,prep,decoded,decodedReceipt});}
    if(!execute)await h.page.evaluate(()=>{persistReportDraft=async()=>({ok:true,remote:true,offlineSimulation:true});});
    for(const {spec,candidate,prep,decoded,decodedReceipt}of prepared){
      const checked=await h.page.evaluate(browserBoundedAdmission,{expected:ID,number:spec.number,prep,text:decoded.text,proof:{version:'retained-authorized-summary-replacement-v1',candidateEvidence:spec,intentReceipt:candidate.intentReceipt,rawReceipt:candidate.rawReceipt,decodedReceipt,originalTaskId:candidate.oldTaskId,originalRunId:candidate.oldRunId,originalInputHash:candidate.oldInputHash,originalPaidAiCalls:1,newPaidAiCalls:0,semanticReviewRequired:true,originalAiReceiptUnchanged:true,factsVerified:false}});
      const output=await wx(path.join(OUT,'tax-retained-summary-composed-'+spec.number+'-'+runId+'.json'),{number:spec.number,...checked,contentSha256:retainedSha(checked.content||''),notSemanticCertification:true});audit.rows.push({number:spec.number,status:checked.status,errors:checked.errors,contentSha256:retainedSha(checked.content||''),output});
      if(execute){const artifactFile=path.join(OUT,'tax/sections/'+spec.number+'.json'),artifactBytes=await fs.readFile(artifactFile),prior=JSON.parse(artifactBytes);await wx(path.join(OUT,'tax/recovery/retained-summary-artifact-before-'+spec.number+'-'+runId+'.json'),artifactBytes);await fs.writeFile(artifactFile,JSON.stringify({...prior,...checked,key:'tax',number:spec.number,sectionKey:checked.completionContract?.sectionKey||candidate.currentContract.sectionKey,at:new Date().toISOString()},null,2));checkpoint.sections['tax:'+spec.number]={...checkpoint.sections['tax:'+spec.number],status:checked.status,file:artifactFile,at:new Date().toISOString(),error:checked.errors.length?{code:'retained-summary-quality-blocked',issues:checked.errors}:null};await fs.writeFile(checkpointFile,JSON.stringify(checkpoint,null,2));}
      assert(checked.status==='semantic-review-pending'&&!checked.errors.length,'Retained candidate did not pass technical admission: '+spec.number);
    }
    const end=await state('end');if(execute)assert(end.verified,'Final current chapters not saved');else assert(canonical(start.remote)===canonical(end.remote),'Dryrun changed remote');
    assert(end.actual.inputIdentity===start.actual.inputIdentity&&canonical(end.actual.financial)===canonical(start.actual.financial)&&canonical(end.actual.workflow)===canonical(start.actual.workflow),'Source/financial/confirmed workflow changed');
    for(let ci=0;ci<start.actual.chapters.length;ci++)for(let si=0;si<start.actual.chapters[ci].sections.length;si++){const number=(ci+1)+'.'+(si+1),before=start.actual.chapters[ci].sections[si],after=end.actual.chapters[ci].sections[si];if(!FILES.some(x=>x.number===number))assert(canonical(before)===canonical(after),'Untargeted section changed: '+number);else assert(canonical(before.executionTask)===canonical(after.executionTask),'Original executionTask changed: '+number);}
    assert(!h.errors.length&&!h.ledger.some(x=>x.isAi&&x.allowed),'Unexpected AI/browser error');audit.technicalPassed=true;
  }catch(error){failure=error;audit.error=String(error.message).slice(0,600);}
  finally{if(h){if(!audit.states.end)try{await state('end');}catch(error){audit.endError=String(error.message).slice(0,600);}await h.close();}if(snapshot)try{audit.formalAfter=await sources();}catch(error){failure??=error;audit.sourceError=String(error.message);}if(locked){audit.ok=!failure;audit.projectWrites=execute?audit.rows.length:0;audit.receipt=await wx(path.join(OUT,'tax-retained-summary-save-'+runId+'.json'),audit);if(JSON.parse(await fs.readFile(lock,'utf8')).runId===runId)await fs.unlink(lock);}}
  if(failure){failure.receipt=audit.receipt;throw failure;}return audit;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const args=process.argv.slice(2);const valid=args.length===0||args.length===1&&['--execute','--dry-run'].includes(args[0]);if(!valid)throw Error('Only --execute or --dry-run is permitted');saveRetainedTaxSummaries({execute:args[0]==='--execute',dryRun:args[0]==='--dry-run'}).then(a=>console.log(JSON.stringify({ok:a.ok??true,technicalPassed:a.technicalPassed??false,newPaidAiCalls:0,rows:a.rows?.map(x=>({number:x.number,status:x.status,errors:x.errors,output:x.output})),states:a.states,receipt:a.receipt}))).catch(e=>{console.error(JSON.stringify({error:e.message,receipt:e.receipt,newPaidAiCalls:0}));process.exitCode=1;});}
