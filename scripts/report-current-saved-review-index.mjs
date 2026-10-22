// Index existing independent reviews; never generate, adopt or certify prose.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {loadSnapshots,loadIsolation,openProductionHarness,checkSourceUnchanged} from './report-generation-acceptance.mjs';
import {CURRENT_SAVED_TARGETS,stableWordJson,validateCurrentSavedInput,validateCurrentSavedFinancial} from './report-actual-word-acceptance.mjs';
import {installSavedFinancialBindingsReader} from './report-saved-financial-bindings.mjs';

createRequire(import.meta.url)('./windows-browser-lockout-guard.cjs');
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const OUT=path.join(ROOT,'outputs/report-standardization');
const DEFAULT_SNAPSHOT=path.join(OUT,'1010-full-generation-2026-10-10T02-04-51-303Z-3378c9e5');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(stableWordJson(value));
const objectSha=value=>sha(canonical(value));
const ensure=(ok,message)=>{if(!ok)throw Error(message);};
const inside=(root,file)=>file.startsWith(root+path.sep);
const noProjection=value=>!value?.intendedWorkingOnly&&!value?.diagnosticOnly&&!value?.intendedChapters&&!value?.intendedAcceptedBody;
const safe=error=>String(error?.message||error).replace(/Bearer\s+[^\s"']+/gi,'Bearer [redacted]').replace(/postgres(?:ql)?:\/\/[^\s]+/gi,'[database URL redacted]');

export function parseReviewIndexArgs(argv=process.argv.slice(2)){
  const o={key:null,reviewFiles:[],snapshotDir:DEFAULT_SNAPSHOT,baseUrl:'http://localhost:8080',out:null};
  for(let i=0;i<argv.length;i++){
    const a=argv[i];
    ensure(['--key','--review','--snapshot-dir','--base-url','--out'].includes(a),'Unknown argument: '+a);
    ensure(argv[i+1]&&!argv[i+1].startsWith('--'),'Missing value: '+a);
    const value=argv[++i];
    if(a==='--review')o.reviewFiles.push(path.resolve(value));
    else o[{'--key':'key','--snapshot-dir':'snapshotDir','--base-url':'baseUrl','--out':'out'}[a]]=value;
  }
  ensure(Object.hasOwn(CURRENT_SAVED_TARGETS,o.key),'Explicit --key tax or longgang is required');
  ensure(o.reviewFiles.length>0,'At least one explicit --review JSON file is required');
  ensure(new Set(o.reviewFiles).size===o.reviewFiles.length,'Duplicate review path');
  const url=new URL(o.baseUrl);
  ensure(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&!url.username&&!url.password,'Only a local HTTP acceptance server is allowed');
  o.baseUrl=url.origin;o.snapshotDir=path.resolve(o.snapshotDir);
  ensure(inside(OUT,o.snapshotDir),'Snapshot must remain inside outputs/report-standardization');
  const runner=path.join(o.snapshotDir,'generation-runner');
  o.out=path.resolve(o.out||path.join(runner,o.key+'-current-saved-review-index-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomUUID().slice(0,8)+'.json'));
  ensure(inside(runner,o.out)&&path.extname(o.out)==='.json','Index must be a new JSON file inside generation-runner');
  for(const file of o.reviewFiles)ensure(inside(runner,file)&&file!==o.out,'Review must be a separate file inside generation-runner');
  return o;
}

function boundReview(entry,id,section,projectId){
  const file=entry.value,rows=Array.isArray(file?.rows)?file.rows.filter(row=>row.key===id):[];
  if(rows.length!==1||!noProjection(file)||file.projectId&&file.projectId!==projectId)return false;
  const row=rows[0],bodySha=sha(String(section.editedHtml||section.content||''));
  return noProjection(row)&&(!row.projectId||row.projectId===projectId)&&
    row.actualBodySha256===bodySha&&row.bodySha256===bodySha&&row.sectionBodySha256===bodySha&&
    Object.hasOwn(row,'taskId')&&row.taskId===(section.executionTask?.id??null)?row:null;
}

function acceptableReview(row,file){
  return row.semanticStatus==='acceptable-full-body-at-bound-sha'&&row.exactActualMatch===true&&
    row.fullBodyRead===true&&row.semanticPassed===true&&row.technicalPassed===true&&
    row.conclusion==='acceptable'&&Array.isArray(row.findings)&&row.findings.length===0&&
    Number.isFinite(Date.parse(row.readAt||file.fullReadAt));
}

// Review flags originate ONLY in the unchanged input files. The output contains
// file references and hashes, not newly inferred full-body review conclusions.
export function buildCurrentSavedReviewIndex({key,opened,checkpoint,sources,artifacts,reviewEntries,financialBinding,financialIssues=[]}){
  const target=CURRENT_SAVED_TARGETS[key],draft=opened?.project?.data;
  ensure(target&&opened.project.id===target.id&&opened.project.name===target.name,'Exact saved test-project identity mismatch');
  ensure(Array.isArray(reviewEntries)&&reviewEntries.length,'Independent review files are required');
  ensure(new Set(reviewEntries.map(entry=>entry.file)).size===reviewEntries.length,'Duplicate review path');
  const snapshot=(draft.workflow?.calcSnapshots||[]).find(s=>s.id===draft.workflow.currentCalcSnapshotId);
  ensure(snapshot,'Saved financial snapshot missing');
  const financial={version:'calc-tables-v2',projectId:target.id,snapshotId:snapshot.id,snapshotVersion:snapshot.version??null,snapshotSha256:objectSha(snapshot),paramsSha256:objectSha(draft.calcParams),sourceSignatureSha256:sha(financialBinding?.sourceSignature||'')};
  validateCurrentSavedFinancial(financial,financialBinding,financialIssues);
  const manifest={version:'current-saved-word-review-v1',sources:Object.fromEntries(Object.entries(sources).map(([k,s])=>[k,{sourceSha256:s.sourceIdentity.sourceSha256,stateSha256:sha(JSON.stringify(s.state))}])),projects:{[key]:{...target,financial}},rows:[]},reviews={};
  for(const [ci,chapter] of (draft.chapters||[]).entries())for(const [si,section] of (chapter.sections||[]).entries()){
    const id=key+':'+(ci+1)+'.'+(si+1),matches=reviewEntries.filter(entry=>boundReview(entry,id,section,target.id));
    ensure(matches.length===1,(matches.length?'Ambiguous independent reviews':'No exact acceptable independent review')+': '+id);
    const evidence=matches[0];reviews[id]=evidence;
    ensure(acceptableReview(boundReview(evidence,id,section,target.id),evidence.value),'No exact acceptable independent review: '+id);
    manifest.rows.push({key:id,actualBodySha256:sha(String(section.editedHtml||section.content||'')),taskId:section.executionTask?.id??null,contractSha256:objectSha(section.completionContract),artifactSha256:artifacts[id]?.sha256,reviewEvidence:{file:evidence.file,sha256:evidence.sha256}});
  }
  const validated=validateCurrentSavedInput({key,opened,checkpoint,sources,manifest,artifacts,reviews});
  return {manifest,validated};
}

// Used directly by page.evaluate and by behavior tests; no renderer or save.
export async function readFinancialBindingInPage({draft,projectId}){
  if(currentProjectId!==projectId)throw Error('Read-only financial project identity mismatch');
  saveDraft=()=>{};persistReportDraft=async()=>({ok:false,remote:false,acceptanceReadOnly:true});
  window.__qaDispatchPaused=true;
  restoreDraft(draft,{deferRender:true});appMode='report';currentStep=4;signed=false;
  if(JSON.stringify(chapters)!==JSON.stringify(draft.chapters))throw Error('Restoration changed saved chapters');
  const before=JSON.stringify({project,chapters,calcParams,projectWorkflow});
  await ReportLogicCore.load(rlProjectType());
  await ensureReportTableTemplates();
  const {binding,issues}=await window.__qaReadSavedFinancialBindings({projectId});
  if(currentProjectId!==projectId||before!==JSON.stringify({project,chapters,calcParams,projectWorkflow}))throw Error('Read-only financial binding changed report memory');
  return {binding,issues};
}

export async function readProductionFinancialBinding(isolation,key,draft,dependencies={}){
  const harness=await (dependencies.openProductionHarness||openProductionHarness)(isolation,key,{allowAi:false,readOnly:true});
  try{
    await harness.page.evaluate(installSavedFinancialBindingsReader);
    const result=await harness.page.evaluate(readFinancialBindingInPage,{draft,projectId:CURRENT_SAVED_TARGETS[key].id});
    ensure(!harness.errors.length,'Read-only browser encountered errors: '+harness.errors.join('; '));
    ensure(!(harness.ledger||[]).some(row=>row.isAi||row.allowed===false),'Browser attempted an AI call or blocked mutation');
    return result;
  }finally{await harness.close();}
}

export async function createCurrentSavedReviewIndex({key,snapshot,isolation,reviewFiles,out},dependencies={}){
  const read=dependencies.readFile||fs.readFile,realpath=dependencies.realpath||fs.realpath,write=dependencies.writeFile||fs.writeFile,stat=dependencies.stat||fs.stat;
  const sourceCheck=dependencies.checkSourceUnchanged||checkSourceUnchanged;
  const runner=path.join(snapshot.out,'generation-runner'),root=await realpath(runner),output=path.resolve(out);
  ensure(inside(await realpath(OUT),root),'Snapshot output path escapes outputs/report-standardization');
  ensure(inside(OUT,path.resolve(snapshot.out))&&inside(runner,output)&&path.extname(output)==='.json','Index must remain inside the existing snapshot generation-runner');
  const outputParent=await realpath(path.dirname(output));
  ensure(outputParent===root||inside(root,outputParent),'Output parent escapes generation-runner');
  try{await stat(output);throw Error('Index already exists; refusing overwrite');}catch(error){if(error.code!=='ENOENT')throw error;}
  const files=new Map(),paths=new Map();
  const locked=async file=>{
    file=path.resolve(file);const resolved=await realpath(file),raw=await read(resolved),digest=sha(raw);
    if(paths.has(file))ensure(paths.get(file)===resolved,'Evidence path changed during capture');
    if(files.has(resolved))ensure(files.get(resolved)===digest,'Evidence changed during capture');
    paths.set(file,resolved);files.set(resolved,digest);return {value:JSON.parse(String(raw)),sha256:digest,resolved};
  };
  const frozen=(await locked(path.join(snapshot.out,'manifest.json'))).value;
  ensure(frozen.version==='full-generation-acceptance-snapshot-v1'&&(!snapshot.manifest||canonical(frozen)===canonical(snapshot.manifest)),'Frozen snapshot manifest changed');
  for(const k of ['tax','longgang']){
    const item=await locked(path.join(snapshot.out,k+'-source.json'));
    ensure(item.sha256===frozen.sources?.[k]?.fileSha256&&canonical(item.value)===canonical(snapshot.sources[k]),'Frozen source artifact changed: '+k);
    ensure(await sourceCheck(snapshot.sources[k].sourceIdentity),'Formal source changed: '+k);
  }
  const target=CURRENT_SAVED_TARGETS[key];
  ensure(target&&isolation.projects[key]?.id===target.id&&isolation.projects[key]?.name===target.name,'Exact isolated copy required');
  const get=()=>isolation.sessions[key].request('/api/projects?id='+encodeURIComponent(target.id),undefined,'GET');
  const opened=await get(),remoteSha256=objectSha(opened.project),checkpoint=(await locked(path.join(runner,'checkpoint.json'))).value,artifacts={};
  for(const [ci,c] of (opened.project.data.chapters||[]).entries())for(const [si] of (c.sections||[]).entries()){
    const number=(ci+1)+'.'+(si+1),id=key+':'+number,file=path.join(runner,key,'sections',number+'.json');
    ensure(path.resolve(checkpoint.sections?.[id]?.file||'')===file,'Checkpoint artifact path mismatch: '+id);
    artifacts[id]=await locked(file);
  }
  ensure(Array.isArray(reviewFiles)&&reviewFiles.length,'Explicit independent review paths required');
  const reviewEntries=[];
  for(const file of reviewFiles){
    const entry=await locked(file);
    ensure(inside(root,entry.resolved)&&path.resolve(file)!==output,'Review must be a separate file inside generation-runner');
    ensure(!reviewEntries.some(other=>other.resolved===entry.resolved),'Duplicate independent review path');
    reviewEntries.push({...entry,file:path.relative(root,entry.resolved)});
  }
  const {binding,issues}=await (dependencies.readFinancialBinding||readProductionFinancialBinding)(isolation,key,opened.project.data);
  const {manifest,validated}=buildCurrentSavedReviewIndex({key,opened,checkpoint,sources:snapshot.sources,artifacts,reviewEntries,financialBinding:binding,financialIssues:issues});
  const verify=async()=>{
    ensure(await realpath(path.dirname(output))===outputParent,'Output parent changed');
    for(const [file,resolved] of paths)ensure(await realpath(file)===resolved,'Evidence path changed after capture');
    for(const [file,digest] of files)ensure(sha(await read(file))===digest,'Evidence changed after capture: '+file);
    for(const k of ['tax','longgang'])ensure(await sourceCheck(snapshot.sources[k].sourceIdentity),'Formal source changed after capture: '+k);
    ensure(objectSha((await get()).project)===remoteSha256,'Saved QA project changed during index capture');
  };
  await verify();
  await write(output,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  // A late change makes this run fail. Retain the index as evidence, never use
  // deletion/overwrite to hide the race; actual Word acceptance rechecks it all.
  await verify();
  ensure(sha(await read(output))===sha(JSON.stringify(manifest,null,2)+'\n'),'Saved index differs from validated bytes');
  return {file:output,key,sections:validated.sections.length,remoteSha256,sourceUnchanged:true,qaUnchanged:true,paidAiCalls:0,projectWrites:0};
}

async function main(){
  const options=parseReviewIndexArgs(),snapshot=await loadSnapshots(options.snapshotDir),isolation=await loadIsolation(snapshot,{baseUrl:options.baseUrl});
  console.log(JSON.stringify(await createCurrentSavedReviewIndex({...options,snapshot,isolation})));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(safe(error));process.exitCode=1;});
