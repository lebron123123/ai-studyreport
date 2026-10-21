import '../scripts/windows-browser-lockout-guard.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import crypto from 'node:crypto';
import {prepareLocalMetadataRecovery,mergeAdmissionMetadata,parseLocalMetadataArgs,runLocalMetadataRecovery} from '../scripts/report-local-metadata-recovery.mjs';
import {CURRENT_SAVED_TARGETS} from '../scripts/report-actual-word-acceptance.mjs';
import {SOURCE_IDS} from '../scripts/report-generation-acceptance.mjs';

const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const bytes=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');
function fixture(key='tax'){
  const target=CURRENT_SAVED_TARGETS[key],sources={};
  for(const k of ['tax','longgang'])sources[k]={state:{frozen:k},sourceIdentity:{kind:k==='tax'?'project':'research',[k==='tax'?'projectId':'researchId']:SOURCE_IDS[k],sourceSha256:hash(k)}};
  const sections=Array.from({length:43},(_,i)=>({t:'分类'+i,content:'<h3>分类'+i+'</h3><p>原有分析'+i+'。</p>',editedHtml:null,pendingRevision:null,executionTask:i?{id:'task-'+i,runId:'run',status:'completed'}:null,completionContract:{version:'current',requiredHeadings:['分类'+i]},generationFailure:i===2?{code:'old-remote-failure',message:'原请求保留',at:'2026-10-13T01:00:00Z'}:null}));
  const calc={id:'calc-1',version:5,projectId:target.id,params:{rent:75},summary:{npv:12}};
  const data={project:{name:target.name},chapters:[{name:'原章',checked:true,sections}],calcParams:calc.params,workflow:{currentCalcSnapshotId:calc.id,calcSnapshots:[calc]},qaAcceptance:{version:'full-generation-acceptance-v1',...target},qaSourceIdentity:sources[key].sourceIdentity,qaSourceStateSha256:hash(JSON.stringify(sources[key].state))};
  const opened={project:{...target,updated_at:1,data}},checkpoint={version:'production-full-generation-v1',sourceHashes:{[key]:sources[key].sourceIdentity.sourceSha256},projects:{[key]:{...target,sourceIdentity:sources[key].sourceIdentity,chapterCount:1}},sections:{}},artifacts={};
  const review={version:'independent-fullbody-review-v1',projectId:target.id,fullReadAt:'2026-10-13T08:00:00Z',rows:[]};
  for(const [i,s] of sections.entries()){
    const number='1.'+(i+1),id=key+':'+number,sectionKey='原章 / '+s.t,a={...structuredClone(s),key,number,sectionKey,status:'passed',errors:[],persisted:{ok:true,remote:true},error:i<2?{code:'generation-save-failed'}:null};
    artifacts[id]={value:a,sha256:hash(bytes(a))};checkpoint.sections[id]={sectionKey,status:'passed',error:i===1?{code:'old'}:null,semanticFinding:i===0?{code:'old-finding'}:null};
    const sha=hash(s.content);review.rows.push({key:id,projectId:target.id,actualBodySha256:sha,bodySha256:sha,sectionBodySha256:sha,taskId:s.executionTask?.id??null,semanticStatus:'acceptable-full-body-at-bound-sha',exactActualMatch:true,fullBodyRead:true,semanticPassed:true,technicalPassed:true,conclusion:'acceptable',findings:[],factsVerified:false});
  }
  const actualFile=path.resolve('actual.json'),actual={key,projectId:target.id,phase:'end',remoteSaveVerified:true,notIntendedProjection:true,persistableChapters:structuredClone(data.chapters)},actualSha256=hash(bytes(actual));
  const receipt={ok:true,sourceUnchangedBefore:{tax:true,longgang:true},sourceUnchangedAfter:{tax:true,longgang:true},states:{[key]:{end:{file:actualFile,sha256:actualSha256,remoteSaveVerified:true}}}};
  return {key,opened,checkpoint,artifacts,reviewEntries:[{file:'review.json',value:review,sha256:hash(bytes(review))}],actual,receipt,actualFile,actualSha256,sources,financialBinding:{version:'calc-tables-v2',projectId:target.id,snapshotId:calc.id,snapshotVersion:5,sourceSignature:'current-source'}};
}
function ioFixture(){
  const f=fixture(),out=path.resolve('outputs/report-standardization/local-metadata-test'),runner=path.join(out,'generation-runner'),files=new Map(),writes=[],unlinks=[],gets=[];
  const put=(file,value)=>files.set(file,bytes(value));
  const manifest={version:'full-generation-acceptance-snapshot-v1',sources:{}};
  for(const [k,s] of Object.entries(f.sources)){put(path.join(out,k+'-source.json'),s);manifest.sources[k]={fileSha256:hash(bytes(s))};}put(path.join(out,'manifest.json'),manifest);
  for(const [id,e] of Object.entries(f.artifacts)){e.file=path.join(runner,'tax/sections',id.split(':')[1]+'.json');put(e.file,e.value);f.checkpoint.sections[id].file=e.file;}
  put(path.join(runner,'checkpoint.json'),f.checkpoint);
  f.actualFile=path.join(runner,'actual.json');put(f.actualFile,f.actual);f.actualSha256=hash(files.get(f.actualFile));f.receipt.states.tax.end={file:f.actualFile,sha256:f.actualSha256,remoteSaveVerified:true};
  const receipt=path.join(runner,'receipt.json');put(receipt,f.receipt);const review=path.join(runner,'review.json');put(review,f.reviewEntries[0].value);
  const options={key:'tax',actual:f.actualFile,receipt,reviewFiles:[review],out:path.join(runner,'proposal.json'),baseUrl:'http://localhost:8080',execute:false};
  const snapshot={out,manifest,sources:f.sources},isolation={projects:{tax:CURRENT_SAVED_TARGETS.tax},sessions:{tax:{request:async(url,body,method)=>{gets.push({url,body,method});assert.equal(method,'GET');assert.equal(body,undefined);return structuredClone(f.opened);}}}};
  const dependencies={loadSnapshots:async()=>snapshot,loadIsolation:async()=>isolation,checkSourceUnchanged:async()=>true,readFinancialBinding:async()=>({binding:f.financialBinding,issues:[]}),io:{
    realpath:async file=>path.resolve(file),readFile:async file=>{assert.ok(files.has(file),'Unexpected read: '+file);return files.get(file);},stat:async file=>{if(files.has(file))return {};throw Object.assign(Error('missing'),{code:'ENOENT'});},
    writeFile:async(file,raw,opts)=>{if(opts?.flag==='wx'&&files.has(file))throw Object.assign(Error('exists'),{code:'EEXIST'});writes.push({file,raw:Buffer.from(raw),opts});files.set(file,Buffer.from(raw));},unlink:async file=>{unlinks.push(file);files.delete(file);}
  }};
  return {...f,files,writes,unlinks,gets,options,dependencies,runner,out,receipt,review};
}
function admission(){
  const f=fixture(),s=f.opened.project.data.chapters[0].sections[0],id='tax:1.1',reviewRow={...f.reviewEntries[0].value.rows[0],readAt:f.reviewEntries[0].value.fullReadAt};
  return {prior:f.artifacts[id].value,checkpoint:f.checkpoint.sections[id],checked:{...structuredClone(s),status:'passed',errors:[],persisted:{ok:true,remote:true}},proof:{version:'independent-semantic-reviewed-actual-v1',reviewedBodySha256:hash(s.content),reviewedTaskId:null},reviewRow,id,at:'now',file:'artifact.json'};
}

test('successful exact admission clears only active errors and independently resolved finding',()=>{
  const f=admission(),before=structuredClone(f),r=mergeAdmissionMetadata(f);
  assert.equal(r.artifact.error,null);assert.equal(r.checkpoint.error,null);assert.equal(r.checkpoint.semanticFinding,null);
  assert.deepEqual(r.artifact.completionContract,f.checked.completionContract);assert.deepEqual(r.artifact.executionTask,f.checked.executionTask);assert.equal(r.artifact.content,f.checked.content);assert.deepEqual(f,before);
});
test('technical-only saved admission does not erase semantic finding or remote failures',()=>{
  const f=admission();f.proof.version='exact-rendered-body-revalidation-v1';f.checked.status='semantic-review-pending';f.checked.generationFailure={code:'old-remote'};
  const r=mergeAdmissionMetadata(f);assert.equal(r.artifact.error,null);assert.deepEqual(r.checkpoint.semanticFinding,f.checkpoint.semanticFinding);assert.deepEqual(r.artifact.generationFailure,f.checked.generationFailure);
});
for(const [label,change] of [
  ['save failed',f=>f.checked.persisted.ok=false],['unknown remote',f=>f.checked.persisted.remote=false],['blocked',f=>f.checked.status='failed'],['pending',f=>f.checked.pendingRevision={after:'candidate'}],['hard error',f=>f.checked.errors=[{code:'blocked'}]]
])test('admit preserves unresolved original error/finding on '+label,()=>{const f=admission();change(f);const r=mergeAdmissionMetadata(f);assert.deepEqual(r.artifact.error,f.prior.error);assert.deepEqual(r.checkpoint.semanticFinding,f.checkpoint.semanticFinding);});
for(const [label,change] of [
  ['old body',f=>f.reviewRow.actualBodySha256=hash('old')],['old task',f=>f.reviewRow.taskId='old'],['not read',f=>f.reviewRow.fullBodyRead=false],['finding',f=>f.reviewRow.findings=['unresolved']],['wrong proof',f=>f.proof.reviewedBodySha256=hash('old')]
])test('admit does not clear semantic finding for '+label,()=>{const f=admission();change(f);assert.deepEqual(mergeAdmissionMetadata(f).checkpoint.semanticFinding,f.checkpoint.semanticFinding);});

test('43-section proposal clears only selected local fields; body/task/contract/remote failure remain exact',()=>{
  for(const key of ['tax','longgang']){const f=fixture(key),before=JSON.stringify(f),r=prepareLocalMetadataRecovery(f);assert.equal(r.rows.length,43);assert.equal(r.changes.length,2);assert.equal(JSON.stringify(f),before);
    for(const [id,e] of Object.entries(r.projectedArtifacts)){const original=f.artifacts[id].value,copy=structuredClone(e.value);copy.error=original.error;assert.deepEqual(copy,original);if(!r.changes.find(x=>x.key===id)?.fields.includes('artifact.error'))assert.equal(e.sha256,f.artifacts[id].sha256);}
    assert.deepEqual(r.projectedArtifacts[key+':1.3'].value.generationFailure,{code:'old-remote-failure',message:'原请求保留',at:'2026-10-13T01:00:00Z'});
  }
});
for(const [label,change] of [
  ['wrong QA',f=>f.opened.project.id=SOURCE_IDS.tax],['not saved',f=>f.actual.remoteSaveVerified=false],['old actual',f=>f.actual.persistableChapters[0].sections[0].content+='old'],['wrong receipt SHA',f=>f.receipt.states.tax.end.sha256=hash('old')],['source changed',f=>f.receipt.sourceUnchangedAfter.tax=false],['missing section',f=>f.opened.project.data.chapters[0].sections.pop()],['unpassed',f=>f.checkpoint.sections['tax:1.1'].status='failed'],['body',f=>f.artifacts['tax:1.1'].value.content+='changed'],['task',f=>f.artifacts['tax:1.2'].value.executionTask.id='changed'],['contract',f=>f.artifacts['tax:1.1'].value.completionContract.version='old'],['save unknown',f=>f.artifacts['tax:1.1'].value.persisted.remote=false],['pending',f=>f.artifacts['tax:1.1'].value.pendingRevision={after:'text'}],['review absent',f=>f.reviewEntries[0].value.rows.shift()],['review guessed',f=>f.reviewEntries[0].value.rows[0].fullBodyRead=false],['review duplicate',f=>f.reviewEntries.push(structuredClone(f.reviewEntries[0]))]
])test('metadata recovery rejects '+label,()=>{const f=fixture();change(f);assert.throws(()=>prepareLocalMetadataRecovery(f));});

test('CLI requires exact evidence and execute requires a prior proposal',()=>{
  const args=['--key','tax','--actual','a.json','--receipt','r.json','--review','v.json'];assert.equal(parseLocalMetadataArgs(args).execute,false);
  for(const bad of [[],[...args,'--execute'],[...args,'--base-url','https://example.com'],[...args,'--key','all'],[...args,'--paid']])assert.throws(()=>parseLocalMetadataArgs(bad));
});
test('dry-run only GETs and writes one new audit; all active originals remain byte exact',async()=>{
  const f=ioFixture(),before=new Map(f.files),result=await runLocalMetadataRecovery(f.options,f.dependencies);assert.equal(result.sections,43);assert.equal(result.changed,2);assert.equal(result.execute,false);
  assert.equal(f.writes.length,1);assert.deepEqual(f.writes[0].opts,{flag:'wx'});for(const [file,raw] of before)assert.deepEqual(f.files.get(file),raw);
  assert.equal(JSON.parse(f.files.get(result.file)).activeMetadataWrites,0);assert.equal(f.unlinks.length,0);
});
test('execute binds prior proposal, cold-backs exact originals and only changes error/finding fields',async()=>{
  const f=ioFixture();await runLocalMetadataRecovery(f.options,f.dependencies);const old=new Map(f.files),proposal=f.options.out;
  const r=await runLocalMetadataRecovery({...f.options,execute:true,proposal,out:path.join(f.runner,'executed.json')},f.dependencies);
  assert.equal(r.projectWrites,0);assert.equal(r.paidAiCalls,0);const receipt=JSON.parse(f.files.get(r.file));assert.equal(receipt.backups.length,3);
  const active=f.writes.filter(x=>!x.opts);assert.equal(active.length,3);
  for(const row of receipt.backups){assert.ok([...old.values()].some(raw=>raw.equals(f.files.get(row.file))));assert.equal(hash(f.files.get(row.file)),row.sha256);}
  for(const row of active){const before=JSON.parse(old.get(row.file)),after=JSON.parse(row.raw);if(row.file.endsWith('checkpoint.json')){after.sections['tax:1.1'].semanticFinding=before.sections['tax:1.1'].semanticFinding;after.sections['tax:1.2'].error=before.sections['tax:1.2'].error;}else after.error=before.error;assert.deepEqual(after,before);}
  assert.deepEqual(f.unlinks,[path.join(f.runner,'resume-execute.lock.json')]);
  await assert.rejects(runLocalMetadataRecovery({...f.options,execute:true,proposal,out:path.join(f.runner,'repeat.json')},f.dependencies),/proposal differs/);
});
test('an existing writer lock is never removed or overwritten',async()=>{
  const f=ioFixture();await runLocalMetadataRecovery(f.options,f.dependencies);const lock=path.join(f.runner,'resume-execute.lock.json');f.files.set(lock,Buffer.from('owned by another writer'));
  await assert.rejects(runLocalMetadataRecovery({...f.options,execute:true,proposal:f.options.out,out:path.join(f.runner,'executed.json')},f.dependencies),/exists/);assert.equal(f.files.get(lock).toString(),'owned by another writer');assert.deepEqual(f.unlinks,[]);assert.equal(f.writes.filter(x=>!x.opts).length,0);
});
for(const kind of ['qa','source','artifact','review','checkpoint','manifest','financial'])test('changed '+kind+' stops before active writes',async()=>{
  const f=ioFixture();let sourceChanged=false;f.dependencies.checkSourceUnchanged=async()=>!sourceChanged;f.dependencies.readFinancialBinding=async()=>{if(kind==='qa')f.opened.project.updated_at=2;else if(kind==='source')sourceChanged=true;else if(kind==='financial')return {binding:{...f.financialBinding,snapshotVersion:6},issues:[]};else{const file={artifact:f.artifacts['tax:1.1'].file,review:f.review,checkpoint:path.join(f.runner,'checkpoint.json'),manifest:path.join(f.out,'manifest.json')}[kind];f.files.set(file,Buffer.concat([f.files.get(file),Buffer.from('\n')]));}return {binding:f.financialBinding,issues:[]};};
  await assert.rejects(runLocalMetadataRecovery(f.options,f.dependencies));assert.equal(f.writes.length,0);
});
test('existing output and tampered proposal reject before any active write',async()=>{
  const f=ioFixture();f.files.set(f.options.out,Buffer.from('existing'));await assert.rejects(runLocalMetadataRecovery(f.options,f.dependencies),/exists/);assert.equal(f.writes.length,0);
  f.files.delete(f.options.out);await runLocalMetadataRecovery(f.options,f.dependencies);const p=JSON.parse(f.files.get(f.options.out));p.projection.rows[0].bodySha256=hash('wrong');f.files.set(f.options.out,bytes(p));
  await assert.rejects(runLocalMetadataRecovery({...f.options,execute:true,proposal:f.options.out,out:path.join(f.runner,'executed.json')},f.dependencies),/proposal differs/);assert.equal(f.writes.filter(x=>!x.opts).length,0);
});
test('late QA mutation stops remaining active writes and retains original cold backups',async()=>{
  const f=ioFixture();await runLocalMetadataRecovery(f.options,f.dependencies);const write=f.dependencies.io.writeFile;
  f.dependencies.io.writeFile=async(...args)=>{await write(...args);if(!args[2])f.opened.project.updated_at=2;};
  await assert.rejects(runLocalMetadataRecovery({...f.options,execute:true,proposal:f.options.out,out:path.join(f.runner,'executed.json')},f.dependencies),/QA saved project changed/);
  assert.equal(f.writes.filter(x=>!x.opts).length,1);assert.equal([...f.files.keys()].filter(x=>x.includes('local-metadata-cold-')).length,3);assert.ok([...f.files.keys()].some(x=>x.includes('local-metadata-intent-')));
});
