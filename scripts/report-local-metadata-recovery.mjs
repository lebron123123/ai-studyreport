// Local acceptance metadata only. Never changes a project, prose or receipt.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import './windows-browser-lockout-guard.cjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const SNAPSHOT=path.join(ROOT,'outputs/report-standardization/1010-full-generation-2026-10-10T02-04-51-303Z-3378c9e5');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(sort(value));
function sort(value){return Array.isArray(value)?value.map(sort):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,sort(value[k])])):value;}
const equal=(a,b)=>canonical(a)===canonical(b);
const ensure=(ok,message)=>{if(!ok)throw Error(message);};
const body=s=>String(s.editedHtml||s.content||'');
const taskId=s=>s.executionTask?.id??null;
const inside=(root,file)=>file.startsWith(root+path.sep);

export function isExactFullBodyReview(row,section,id){
  const sha=hash(body(section));
  return row?.key===id&&row.semanticStatus==='acceptable-full-body-at-bound-sha'&&
    row.exactActualMatch===true&&row.fullBodyRead===true&&row.semanticPassed===true&&
    row.technicalPassed===true&&row.conclusion==='acceptable'&&Array.isArray(row.findings)&&!row.findings.length&&
    Number.isFinite(Date.parse(row.readAt||''))&&['actualBodySha256','bodySha256','sectionBodySha256'].every(k=>row[k]===sha)&&
    Object.hasOwn(row,'taskId')&&row.taskId===taskId(section);
}

// Called only after the existing browser admission has returned. A failed or
// uncertain save cannot erase earlier errors. Technical-only admission cannot
// erase an independent semantic finding.
export function mergeAdmissionMetadata({prior,checkpoint,checked,proof,reviewRow,id,at,file}){
  const artifact={...prior,...checked,at},next={...checkpoint,status:checked.status,file,at,
    error:checked.errors?.length?{code:'bounded-current-quality-blocked',issues:checked.errors}:checkpoint?.error??null};
  const saved=checked.persisted?.ok===true&&checked.persisted?.remote===true;
  const technical=saved&&['passed','semantic-review-pending'].includes(checked.status)&&!checked.pendingRevision&&Array.isArray(checked.errors)&&!checked.errors.length;
  if(technical){artifact.error=null;next.error=null;}
  const semantic=technical&&checked.status==='passed'&&proof?.version==='independent-semantic-reviewed-actual-v1'&&
    proof.reviewedBodySha256===hash(body(checked))&&proof.reviewedTaskId===taskId(checked)&&
    isExactFullBodyReview(reviewRow,checked,id);
  if(semantic)next.semanticFinding=null;
  return {artifact,checkpoint:next};
}

// Verify ALL 43 current saved sections before proposing any local clear. No
// review flags are manufactured; only unchanged independent files are used.
export function prepareLocalMetadataRecovery({key,opened,checkpoint,artifacts,reviewEntries,actual,receipt,actualFile,actualSha256}){
  const target={tax:{id:'f4395f64-af1b-43bd-b809-580b5ec9406b',name:'[系统测试]全量报告验收-tax-8c14644b'},longgang:{id:'2884b7a3-960f-40c0-af89-5d19e0284836',name:'[系统测试]全量报告验收-longgang-d5470f22'}}[key];
  ensure(target&&opened?.project?.id===target.id&&opened.project.name===target.name,'Exact QA project required');
  ensure(actual?.key===key&&actual.projectId===target.id&&actual.phase==='end'&&actual.remoteSaveVerified===true&&actual.notIntendedProjection===true,'Exact saved actual end proof required');
  ensure(equal(actual.persistableChapters,opened.project.data.chapters),'Actual saved chapters differ from current GET');
  const end=receipt?.states?.[key]?.end;
  ensure(receipt.ok===true&&receipt.sourceUnchangedBefore?.tax===true&&receipt.sourceUnchangedBefore?.longgang===true&&receipt.sourceUnchangedAfter?.tax===true&&receipt.sourceUnchangedAfter?.longgang===true&&end?.remoteSaveVerified===true&&end.sha256===actualSha256&&path.resolve(end.file)===path.resolve(actualFile),'Saved receipt/source proof mismatch');
  const projectedArtifacts=structuredClone(artifacts),projectedCheckpoint=structuredClone(checkpoint),changes=[],rows=[];
  for(const [ci,c] of opened.project.data.chapters.entries())for(const [si,s] of c.sections.entries()){
    const number=(ci+1)+'.'+(si+1),id=key+':'+number,sectionKey=c.name+' / '+s.t,entry=artifacts[id],a=entry?.value,cp=checkpoint.sections?.[id];
    ensure(cp?.status==='passed'&&cp.sectionKey===sectionKey&&a?.status==='passed'&&a.key===key&&a.number===number&&a.sectionKey===sectionKey,'Current passed identity missing: '+id);
    ensure(!s.pendingRevision&&!a.pendingRevision&&Array.isArray(a.errors)&&!a.errors.some(x=>x.severity!=='warning')&&a.persisted?.ok===true&&a.persisted?.remote===true,'Current admission/save not successful: '+id);
    for(const field of ['content','editedHtml'])ensure(String(a[field]||'')===String(s[field]||''),'Current body differs: '+id);
    ensure(equal(a.executionTask??null,s.executionTask??null)&&equal(a.completionContract,s.completionContract)&&s.completionContract?.version,'Current task/contract differs: '+id);
    const matches=reviewEntries.flatMap(e=>(e.value.rows||[]).filter(r=>r.key===id&&r.actualBodySha256===hash(body(s))&&r.taskId===taskId(s)).map(r=>({entry:e,row:r})));
    ensure(matches.length===1,'Independent review absent/ambiguous: '+id);
    const match=matches[0];
    ensure(!match.entry.value.intendedWorkingOnly&&!match.entry.value.diagnosticOnly&&(!match.entry.value.projectId||match.entry.value.projectId===target.id)&&(!match.row.projectId||match.row.projectId===target.id)&&isExactFullBodyReview({...match.row,readAt:match.row.readAt||match.entry.value.fullReadAt},s,id),'Exact acceptable full-body review missing: '+id);
    const fields=[];
    if(a.error!=null){projectedArtifacts[id].value.error=null;fields.push('artifact.error');}
    if(cp.error!=null){projectedCheckpoint.sections[id].error=null;fields.push('checkpoint.error');}
    if(cp.semanticFinding!=null){projectedCheckpoint.sections[id].semanticFinding=null;fields.push('checkpoint.semanticFinding');}
    const row={key:id,bodySha256:hash(body(s)),taskId:taskId(s),contractSha256:hash(canonical(s.completionContract)),artifactSha256:entry.sha256,review:{file:match.entry.file,sha256:match.entry.sha256,readAt:match.row.readAt||match.entry.value.fullReadAt},remoteFailureRetained:s.generationFailure||s.candidateGenerationFailure||null,fields};
    rows.push(row);if(fields.length)changes.push(row);
    if(fields.includes('artifact.error'))projectedArtifacts[id].sha256=hash(JSON.stringify(projectedArtifacts[id].value,null,2)+'\n');
  }
  ensure(rows.length===43,'Exactly 43 current sections required');
  return {projectedArtifacts,projectedCheckpoint,rows,changes};
}

export function parseLocalMetadataArgs(argv=process.argv.slice(2)){
  const o={key:null,actual:null,receipt:null,reviewFiles:[],out:null,proposal:null,execute:false,baseUrl:'http://localhost:8080'};
  for(let i=0;i<argv.length;i++){
    const a=argv[i];if(a==='--execute'){o.execute=true;continue;}
    ensure(['--key','--actual','--receipt','--review','--out','--proposal','--base-url'].includes(a)&&argv[i+1]&&!argv[i+1].startsWith('--'),'Unknown/missing argument: '+a);
    const v=argv[++i];if(a==='--review')o.reviewFiles.push(path.resolve(v));else o[{'--key':'key','--actual':'actual','--receipt':'receipt','--out':'out','--proposal':'proposal','--base-url':'baseUrl'}[a]]=v;
  }
  ensure(['tax','longgang'].includes(o.key)&&o.actual&&o.receipt&&o.reviewFiles.length,'Explicit key, actual, saved receipt and independent reviews required');
  ensure(!o.execute||o.proposal,'Execute requires the exact prior dry-run --proposal');
  const url=new URL(o.baseUrl);ensure(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&!url.username&&!url.password,'Only local HTTP server allowed');o.baseUrl=url.origin;
  return o;
}

export async function runLocalMetadataRecovery(options,dependencies={}){
  const io={...fs,...dependencies.io};
  const {loadSnapshots,loadIsolation,checkSourceUnchanged}=await import('./report-generation-acceptance.mjs');
  const {buildCurrentSavedReviewIndex,readProductionFinancialBinding}=await import('./report-current-saved-review-index.mjs');
  const snapshot=await (dependencies.loadSnapshots||loadSnapshots)(SNAPSHOT),runner=path.join(snapshot.out,'generation-runner'),root=await io.realpath(runner),snapshotRoot=await io.realpath(snapshot.out);
  const isolation=await (dependencies.loadIsolation||loadIsolation)(snapshot,{baseUrl:options.baseUrl});
  const locked=new Map(),paths=new Map(),read=async(file,source=false)=>{const absolute=path.resolve(file),resolved=await io.realpath(absolute);ensure(inside(source?snapshotRoot:root,resolved),'Evidence outside exact snapshot/runner');const raw=await io.readFile(resolved);const old=locked.get(resolved);ensure(!old||old.sha256===hash(raw),'Evidence changed during capture');ensure(!paths.has(absolute)||paths.get(absolute)===resolved,'Evidence path changed');paths.set(absolute,resolved);const e={file:resolved,raw,sha256:hash(raw),value:JSON.parse(raw)};locked.set(resolved,e);return e;};
  const frozen=await read(path.join(snapshot.out,'manifest.json'),true);
  ensure(frozen.value.version==='full-generation-acceptance-snapshot-v1'&&equal(frozen.value,snapshot.manifest),'Frozen manifest changed');
  for(const k of ['tax','longgang']){const source=await read(path.join(snapshot.out,k+'-source.json'),true);ensure(source.sha256===frozen.value.sources?.[k]?.fileSha256&&equal(source.value,snapshot.sources[k]),'Frozen source changed: '+k);}
  const get=()=>isolation.sessions[options.key].request('/api/projects?id='+encodeURIComponent(isolation.projects[options.key].id),undefined,'GET');
  const opened=await get(),remoteSha256=hash(canonical(opened.project));
  const sourceCheck=dependencies.checkSourceUnchanged||checkSourceUnchanged;
  const verify=async()=>{for(const [file,resolved] of paths)ensure(await io.realpath(file)===resolved,'Evidence path changed');for(const e of locked.values())ensure(hash(await io.readFile(e.file))===e.sha256,'Local evidence changed: '+e.file);for(const k of ['tax','longgang'])ensure(await sourceCheck(snapshot.sources[k].sourceIdentity),'Formal source changed: '+k);ensure(hash(canonical((await get()).project))===remoteSha256,'QA saved project changed');};
  const cp=await read(path.join(runner,'checkpoint.json')),actual=await read(options.actual),receipt=await read(options.receipt),artifacts={};
  for(const [ci,c] of opened.project.data.chapters.entries())for(const [si] of c.sections.entries()){
    const number=(ci+1)+'.'+(si+1),id=options.key+':'+number,file=path.join(runner,options.key,'sections',number+'.json');
    ensure(path.resolve(cp.value.sections?.[id]?.file||'')===file,'Checkpoint path mismatch: '+id);artifacts[id]=await read(file);
  }
  const reviewEntries=[];for(const file of options.reviewFiles){const e=await read(file);ensure(!reviewEntries.some(x=>x.file===e.file),'Duplicate review file');reviewEntries.push(e);}
  const prepared=prepareLocalMetadataRecovery({key:options.key,opened,checkpoint:cp.value,artifacts,reviewEntries,actual:actual.value,receipt:receipt.value,actualFile:actual.file,actualSha256:actual.sha256});
  const finalizations=[];
  for(const row of prepared.changes){const proof=artifacts[row.key].value.qaDetailFinalization;if(!proof)continue;
    const after=await read(proof.receiptFile),before=await read(proof.beforeFile),detail=(after.value.details||[]).find(x=>x.number===row.key.split(':')[1]);
    ensure(after.value.remoteSaveVerified===true&&after.value.persisted?.ok===true&&after.value.persisted?.remote===true&&path.resolve(after.value.beforeFile)===before.file,'Finalization saved proof missing: '+row.key);
    // Later genuine saved/reviewed bodies may supersede this historical proof.
    const current=proof.bodySha256===row.bodySha256;
    if(current)ensure(detail&&hash(body(detail))===row.bodySha256&&taskId(detail)===row.taskId&&hash(canonical(detail.completionContract))===row.contractSha256,'Finalization current binding differs: '+row.key);
    finalizations.push({key:row.key,current,after:{file:after.file,sha256:after.sha256},before:{file:before.file,sha256:before.sha256}});
  }
  const {binding,issues}=await (dependencies.readFinancialBinding||readProductionFinancialBinding)(isolation,options.key,opened.project.data);
  const validated=buildCurrentSavedReviewIndex({key:options.key,opened,checkpoint:prepared.projectedCheckpoint,sources:snapshot.sources,artifacts:prepared.projectedArtifacts,reviewEntries,financialBinding:binding,financialIssues:issues});
  await verify();
  const projection={version:'local-acceptance-metadata-recovery-v1',key:options.key,remoteSha256,actual:{file:actual.file,sha256:actual.sha256},receipt:{file:receipt.file,sha256:receipt.sha256},evidence:[...locked.values()].map(e=>({file:e.file,sha256:e.sha256})),financialBinding:binding,finalizations,rows:prepared.rows,changes:prepared.changes,sections:validated.validated.sections.length,projectWrites:0,paidAiCalls:0};
  const runId=new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomUUID().slice(0,8);
  const output=path.resolve(options.out||path.join(runner,'local-metadata-'+(options.execute?'executed-':'dry-run-')+runId+'.json'));
  ensure(inside(root,output)&&path.extname(output)==='.json','Output must be a new runner JSON');
  const outputParent=await io.realpath(path.dirname(output));ensure(outputParent===root||inside(root,outputParent),'Output parent escapes runner');
  const requireNewOutput=async()=>{ensure(await io.realpath(path.dirname(output))===outputParent,'Output parent changed');try{await io.stat(output);throw Error('Output exists; refusing overwrite');}catch(e){if(e.code!=='ENOENT')throw e;}};
  await requireNewOutput();
  const exclusive=async(file,raw)=>{await io.writeFile(file,raw,{flag:'wx'});ensure(hash(await io.readFile(file))===hash(raw),'Exclusive backup/readback differs');return {file,sha256:hash(raw)};};
  let lock,lockAcquired=false;
  try{
    if(options.execute){
      const proposal=await read(options.proposal);ensure(equal(proposal.value.projection,projection),'Dry-run proposal differs from exact current evidence');await verify();
      lock=path.join(runner,'resume-execute.lock.json');await exclusive(lock,JSON.stringify({runId,pid:process.pid,mode:'local-metadata-only'})+'\n');lockAcquired=true;await requireNewOutput();
      const targets=prepared.changes.filter(x=>x.fields.includes('artifact.error')).map(row=>({file:artifacts[row.key].file,old:artifacts[row.key].raw,next:JSON.stringify(prepared.projectedArtifacts[row.key].value,null,2)+'\n'}));
      if(prepared.changes.some(row=>row.fields.some(f=>f.startsWith('checkpoint.'))))targets.push({file:cp.file,old:cp.raw,next:JSON.stringify(prepared.projectedCheckpoint,null,2)+'\n'});
      const backups=[];for(const [i,t] of targets.entries())backups.push(await exclusive(path.join(runner,'local-metadata-cold-'+runId+'-'+i+'.json'),t.old));
      await exclusive(path.join(runner,'local-metadata-intent-'+runId+'.json'),JSON.stringify({projection,backups,targets:targets.map(t=>({file:t.file,beforeSha256:hash(t.old),afterSha256:hash(t.next)})),projectWrites:0,paidAiCalls:0},null,2)+'\n');
      await verify();
      for(const t of targets){await verify();await io.writeFile(t.file,t.next);const e=locked.get(t.file);e.raw=Buffer.from(t.next);e.sha256=hash(e.raw);ensure(hash(await io.readFile(t.file))===e.sha256,'Active metadata readback differs');}
      await verify();
      await exclusive(output,JSON.stringify({projection,execute:true,backups,activeReadback:targets.map(t=>({file:t.file,sha256:locked.get(t.file).sha256})),remoteUnchanged:true,sourceUnchanged:true},null,2)+'\n');
    }else await exclusive(output,JSON.stringify({projection,execute:false,activeMetadataWrites:0,remoteUnchanged:true,sourceUnchanged:true},null,2)+'\n');
    await verify();return {file:output,sha256:hash(await io.readFile(output)),sections:43,changed:prepared.changes.length,execute:!!options.execute,paidAiCalls:0,projectWrites:0};
  }finally{if(lockAcquired)await io.unlink(lock);}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runLocalMetadataRecovery(parseLocalMetadataArgs()).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(String(e.message).replace(/Bearer\s+\S+/gi,'Bearer [redacted]'));process.exitCode=1;});
}
