import '../scripts/windows-browser-lockout-guard.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {parseReviewIndexArgs,buildCurrentSavedReviewIndex,createCurrentSavedReviewIndex,readFinancialBindingInPage,readProductionFinancialBinding} from '../scripts/report-current-saved-review-index.mjs';
import {CURRENT_SAVED_TARGETS,stableWordJson,validateCurrentSavedInput,readCurrentSavedInput} from '../scripts/report-actual-word-acceptance.mjs';
import {SOURCE_IDS} from '../scripts/report-generation-acceptance.mjs';
import {installSavedFinancialBindingsReader} from '../scripts/report-saved-financial-bindings.mjs';

const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const bytes=value=>Buffer.from(JSON.stringify(value,null,2));
const objectHash=value=>hash(JSON.stringify(stableWordJson(value)));
function fixture(key='tax'){
  const target=CURRENT_SAVED_TARGETS[key],sources={};
  for(const k of ['tax','longgang'])sources[k]={state:{frozen:k},sourceIdentity:{kind:k==='tax'?'project':'research',[k==='tax'?'projectId':'researchId']:SOURCE_IDS[k],sourceSha256:hash(k)}};
  const sections=Array.from({length:43},(_,i)=>({t:'业务分类'+(i+1),content:'<h3>业务分类</h3><p>真实分析 '+i+'。</p>',editedHtml:null,pendingRevision:null,executionTask:i?{id:'task-'+i,runId:'run-original',status:'completed'}:null,completionContract:{version:'test-contract-v1',requiredHeadings:['业务分类']}}));
  const calc={id:'calc-1',version:7,projectId:target.id,params:{rent:100},summary:{npv:45}};
  const draft={project:{name:target.name},chapters:[{name:'实际章',checked:true,sections}],calcParams:{rent:100},workflow:{currentCalcSnapshotId:calc.id,calcSnapshots:[calc]},qaAcceptance:{version:'full-generation-acceptance-v1',...target},qaSourceIdentity:sources[key].sourceIdentity,qaSourceStateSha256:hash(JSON.stringify(sources[key].state))};
  const opened={project:{...target,updated_at:'saved-v1',data:draft}},checkpoint={version:'production-full-generation-v1',sourceHashes:{[key]:sources[key].sourceIdentity.sourceSha256},projects:{[key]:{...target,sourceIdentity:sources[key].sourceIdentity,chapterCount:1}},sections:{}},artifacts={};
  const evidence={version:'independent-fullbody-review-v1',projectId:target.id,fullReadAt:'2026-10-13T07:00:00Z',rows:[]};
  for(const [i,s] of sections.entries()){
    const number='1.'+(i+1),id=key+':'+number,sectionKey='实际章 / '+s.t,artifact={...structuredClone(s),key,number,sectionKey,status:'passed',errors:[]};
    artifacts[id]={value:artifact,sha256:hash(bytes(artifact))};checkpoint.sections[id]={sectionKey,status:'passed'};
    const bodySha=hash(s.content);
    evidence.rows.push({key:id,projectId:target.id,actualBodySha256:bodySha,bodySha256:bodySha,sectionBodySha256:bodySha,taskId:s.executionTask?.id??null,semanticStatus:'acceptable-full-body-at-bound-sha',exactActualMatch:true,fullBodyRead:true,semanticPassed:true,technicalPassed:true,conclusion:'acceptable',findings:[],factsVerified:false});
  }
  const reviewEntries=[{file:'independent-review.json',value:evidence,sha256:hash(bytes(evidence))}],financialBinding={version:'calc-tables-v2',projectId:target.id,snapshotId:calc.id,snapshotVersion:7,sourceSignature:'production-table-signature'};
  return {key,opened,checkpoint,sources,artifacts,reviewEntries,financialBinding};
}
function ioFixture(key='tax'){
  const f=fixture(key),out=path.resolve('outputs/report-standardization/review-index-fixture'),runner=path.join(out,'generation-runner'),output=path.join(runner,'new-index.json'),files=new Map(),calls=[],sourceChecks=[],writes=[];
  const frozen={version:'full-generation-acceptance-snapshot-v1',sources:{}};
  for(const [k,s] of Object.entries(f.sources)){files.set(path.join(out,k+'-source.json'),bytes(s));frozen.sources[k]={fileSha256:hash(bytes(s))};}
  files.set(path.join(out,'manifest.json'),bytes(frozen));
  for(const [id,entry] of Object.entries(f.artifacts)){
    const file=path.join(runner,key,'sections',id.split(':')[1]+'.json');files.set(file,bytes(entry.value));f.checkpoint.sections[id].file=file;
  }
  files.set(path.join(runner,'checkpoint.json'),bytes(f.checkpoint));
  const reviewFiles=f.reviewEntries.map(entry=>{const file=path.join(runner,entry.file);files.set(file,bytes(entry.value));return file;});
  const snapshot={out,sources:f.sources,manifest:frozen},isolation={projects:{[key]:CURRENT_SAVED_TARGETS[key]},sessions:{[key]:{request:async(url,body,method)=>{calls.push({url,body,method});assert.equal(method,'GET');assert.equal(body,undefined);return structuredClone(f.opened);}}}};
  const dependencies={readFile:async file=>{assert.ok(files.has(file),'Unexpected read: '+file);return files.get(file);},realpath:async file=>path.resolve(file),stat:async file=>{if(files.has(file))return {};throw Object.assign(Error('missing'),{code:'ENOENT'});},writeFile:async(file,data,options)=>{assert.deepEqual(options,{flag:'wx'});assert.equal(files.has(file),false);writes.push(file);files.set(file,Buffer.from(data));},checkSourceUnchanged:async identity=>{sourceChecks.push(identity);return true;},readFinancialBinding:async(actualIsolation,actualKey,draft)=>{assert.equal(actualIsolation,isolation);assert.equal(actualKey,key);assert.deepEqual(draft,f.opened.project.data);return {binding:f.financialBinding,issues:[]};}};
  return {...f,snapshot,isolation,reviewFiles,out:output,runner,files,calls,sourceChecks,writes,dependencies};
}

test('CLI requires one exact key and explicit review paths and stays in existing OUT',()=>{
  const base=path.resolve('outputs/report-standardization/example'),review=path.join(base,'generation-runner','review.json');
  const args=['--key','tax','--snapshot-dir',base,'--review',review];
  const parsed=parseReviewIndexArgs(args);assert.equal(parsed.key,'tax');assert.deepEqual(parsed.reviewFiles,[review]);
  for(const bad of [[],['--key','all','--review',review],['--key','tax'],[...args,'--review',review],[...args,'--out',path.join(base,'not-runner.json')],[...args,'--base-url','https://example.com'],[...args,'--review',path.resolve('project.json')],[...args,'--run']])assert.throws(()=>parseReviewIndexArgs(bad));
});

test('both projects build only a 43-row index and preserve bodies, tasks and independent evidence',()=>{
  for(const key of ['tax','longgang']){
    const f=fixture(key),before=JSON.stringify(f),{manifest,validated}=buildCurrentSavedReviewIndex(f);
    assert.equal(manifest.version,'current-saved-word-review-v1');assert.equal(manifest.rows.length,43);assert.equal(validated.gate.passed,true);
    assert.equal(manifest.rows[0].taskId,null);assert.equal(manifest.rows[0].fullBodyRead,undefined);assert.equal(manifest.rows[0].conclusion,undefined);
    assert.equal(validated.sections[0].factsVerified,false);assert.equal(JSON.stringify(f),before);
    const reviews=Object.fromEntries(manifest.rows.map(row=>[row.key,f.reviewEntries[0]]));
    assert.equal(validateCurrentSavedInput({...f,manifest,reviews}).sections.length,43);
  }
});

test('multiple explicit files can cover disjoint sections; older body/task reviews are not reused',()=>{
  const f=fixture(),original=f.reviewEntries[0];
  f.reviewEntries=[{...structuredClone(original),file:'part-one.json'},{...structuredClone(original),file:'part-two.json'},{...structuredClone(original),file:'old-body.json'},{...structuredClone(original),file:'old-task.json'}];
  f.reviewEntries[0].value.rows=original.value.rows.slice(0,20);f.reviewEntries[1].value.rows=original.value.rows.slice(20);
  for(const row of f.reviewEntries[2].value.rows)row.bodySha256=hash('old body');
  for(const row of f.reviewEntries[3].value.rows)row.taskId='old task';
  for(const entry of f.reviewEntries)entry.sha256=hash(bytes(entry.value));
  const result=buildCurrentSavedReviewIndex(f);assert.equal(result.manifest.rows[19].reviewEvidence.file,'part-one.json');assert.equal(result.manifest.rows[20].reviewEvidence.file,'part-two.json');
});

test('multiple exact accepted matches, duplicate paths and duplicate section rows reject',()=>{
  for(const mode of ['conflict','same-path','duplicate-row']){
    const f=fixture();
    if(mode==='duplicate-row')f.reviewEntries[0].value.rows.push(structuredClone(f.reviewEntries[0].value.rows[0]));
    else f.reviewEntries.push({...structuredClone(f.reviewEntries[0]),file:mode==='same-path'?'independent-review.json':'other-review.json'});
    assert.throws(()=>buildCurrentSavedReviewIndex(f),/Ambiguous|Duplicate|No exact/);
  }
  const conflict=fixture(),negative={...structuredClone(conflict.reviewEntries[0]),file:'negative-review.json'};
  negative.value.rows[0].conclusion='needs-review';negative.value.rows[0].findings=['conflicting finding'];
  conflict.reviewEntries.push(negative);
  assert.throws(()=>buildCurrentSavedReviewIndex(conflict),/Ambiguous independent reviews/);
});

test('project data, task receipts, estimates, incomplete or stale independent reviews cannot certify text',()=>{
  const changes=[
    f=>f.reviewEntries[0].value=f.opened.project.data,
    f=>f.reviewEntries[0].value=f.artifacts['tax:1.1'].value,
    f=>f.reviewEntries[0].value.intendedWorkingOnly=true,
    f=>f.reviewEntries[0].value.rows[0].diagnosticOnly=true,
    f=>f.reviewEntries[0].value.rows[0].semanticStatus='passed',
    f=>f.reviewEntries[0].value.rows[0].fullBodyRead=false,
    f=>f.reviewEntries[0].value.rows[0].exactActualMatch=false,
    f=>f.reviewEntries[0].value.rows[0].technicalPassed=false,
    f=>f.reviewEntries[0].value.rows[0].semanticPassed=false,
    f=>f.reviewEntries[0].value.rows[0].conclusion='needs-review',
    f=>f.reviewEntries[0].value.rows[0].findings=['unresolved'],
    f=>f.reviewEntries[0].value.fullReadAt='invalid',
    f=>delete f.reviewEntries[0].value.rows[0].taskId,
    f=>f.reviewEntries[0].value.rows[0].taskId='old task',
    f=>f.reviewEntries[0].value.rows[0].actualBodySha256=hash('old'),
    f=>f.reviewEntries[0].value.rows[0].sectionBodySha256=hash('old'),
    f=>f.reviewEntries[0].value.projectId=SOURCE_IDS.tax
  ];
  for(const change of changes){const f=fixture();change(f);assert.throws(()=>buildCurrentSavedReviewIndex(f),/No exact/);}
});

test('shared strict validator remains the authority for artifact, checkpoint, contract and source identity',()=>{
  const changes=[
    f=>f.opened.project.data.chapters[0].sections.pop(),
    f=>f.checkpoint.sections['tax:1.1'].status='pending',
    f=>f.artifacts['tax:1.1'].value.content+='changed',
    f=>f.artifacts['tax:1.2'].value.executionTask.runId='other-run',
    f=>f.artifacts['tax:1.1'].value.completionContract.version='other',
    f=>f.artifacts['tax:1.1'].value.pendingRevision={after:'candidate'},
    f=>f.artifacts['tax:1.1'].value.errors=[{severity:'error'}],
    f=>f.opened.project.id=SOURCE_IDS.tax,
    f=>f.opened.project.data.qaSourceStateSha256=hash('other'),
    f=>f.sources.longgang.sourceIdentity.researchId='other',
    f=>f.opened.project.data.intendedChapters=[],
    f=>f.opened.project.data.calcParams.rent=101
  ];
  for(const change of changes){const f=fixture();change(f);assert.throws(()=>buildCurrentSavedReviewIndex(f));}
});

test('real financial binding and stale table checks cannot be replaced with stored calc identifiers',()=>{
  for(const change of [{projectId:'other'},{snapshotId:'other'},{snapshotVersion:8},{version:'calc-tables-v1'}]){
    const f=fixture();Object.assign(f.financialBinding,change);assert.throws(()=>buildCurrentSavedReviewIndex(f),/financial identity/);
  }
  const f=fixture();assert.throws(()=>buildCurrentSavedReviewIndex({...f,financialIssues:[{key:'9.4'}]}),/stale/);
});

test('capture reads current QA by GET, checks immutable inputs before/after and writes a shared-reader-compatible index',async()=>{
  const f=ioFixture(),before=JSON.stringify(f.opened),result=await createCurrentSavedReviewIndex(f,f.dependencies);
  assert.equal(result.sections,43);assert.equal(result.paidAiCalls,0);assert.equal(result.projectWrites,0);assert.equal(result.remoteSha256,objectHash(f.opened.project));
  assert.equal(f.calls.length,3);assert.equal(f.sourceChecks.length,6);assert.deepEqual(f.writes,[f.out]);assert.equal(JSON.stringify(f.opened),before);
  const accepted=await readCurrentSavedInput(f.snapshot,f.isolation,'tax',f.out,f.dependencies);
  assert.equal(accepted.sections.length,43);assert.equal(await accepted.verifyUnchanged(),true);
});

test('input mutation during financial read prevents any output write',async()=>{
  for(const kind of ['qa','source','review','artifact','checkpoint','frozen-manifest']){
    const f=ioFixture(),readFinance=f.dependencies.readFinancialBinding;
    f.dependencies.readFinancialBinding=async(...args)=>{
      const result=await readFinance(...args);
      if(kind==='qa')f.opened.project.updated_at='changed';
      else{
        const file={source:path.join(f.snapshot.out,'tax-source.json'),review:f.reviewFiles[0],artifact:path.join(f.runner,'tax/sections/1.1.json'),checkpoint:path.join(f.runner,'checkpoint.json'),'frozen-manifest':path.join(f.snapshot.out,'manifest.json')}[kind];
        f.files.set(file,Buffer.concat([f.files.get(file),Buffer.from('\n')]));
      }
      return result;
    };
    await assert.rejects(createCurrentSavedReviewIndex(f,f.dependencies),/changed/);assert.equal(f.writes.length,0);
  }
});

test('formal source changes, path retargeting and duplicate aliases stop before write',async()=>{
  const source=ioFixture();let checks=0;source.dependencies.checkSourceUnchanged=async()=>++checks<=2;
  await assert.rejects(createCurrentSavedReviewIndex(source,source.dependencies),/Formal source changed/);assert.equal(source.writes.length,0);
  const retarget=ioFixture(),finance=retarget.dependencies.readFinancialBinding;let moved=false;
  retarget.dependencies.realpath=async file=>moved&&file===retarget.reviewFiles[0]?path.join(retarget.runner,'other.json'):path.resolve(file);
  retarget.dependencies.readFinancialBinding=async(...args)=>{const r=await finance(...args);moved=true;return r;};
  await assert.rejects(createCurrentSavedReviewIndex(retarget,retarget.dependencies),/path changed/);assert.equal(retarget.writes.length,0);
  const alias=ioFixture(),aliasPath=path.join(alias.runner,'alias.json');alias.reviewFiles.push(aliasPath);
  alias.dependencies.realpath=async file=>file===aliasPath?alias.reviewFiles[0]:path.resolve(file);
  await assert.rejects(createCurrentSavedReviewIndex(alias,alias.dependencies),/Duplicate independent/);assert.equal(alias.writes.length,0);
});

test('existing index, outside or self review, wrong artifact path and mismatched source file are rejected',async()=>{
  for(const kind of ['exists','outside','self','artifact-path','frozen','output-parent']){
    const f=ioFixture();
    if(kind==='exists')f.files.set(f.out,Buffer.from('retained old index'));
    if(kind==='outside'){const file=path.join(f.snapshot.out,'outside.json');f.files.set(file,f.files.get(f.reviewFiles[0]));f.reviewFiles=[file];}
    if(kind==='self')f.reviewFiles=[f.out];
    if(kind==='artifact-path'){f.checkpoint.sections['tax:1.1'].file=path.join(f.runner,'other.json');f.files.set(path.join(f.runner,'checkpoint.json'),bytes(f.checkpoint));}
    if(kind==='frozen')f.files.set(path.join(f.snapshot.out,'tax-source.json'),Buffer.from('{}'));
    if(kind==='output-parent')f.dependencies.realpath=async file=>file===path.dirname(f.out)?path.resolve('outside-output'):path.resolve(file);
    await assert.rejects(createCurrentSavedReviewIndex(f,f.dependencies));assert.equal(f.writes.length,0);
  }
});

test('late QA change fails after write and retains evidence without claiming successful verification',async()=>{
  const f=ioFixture(),write=f.dependencies.writeFile;
  f.dependencies.writeFile=async(...args)=>{await write(...args);f.opened.project.updated_at='changed-after-write';};
  await assert.rejects(createCurrentSavedReviewIndex(f,f.dependencies),/QA project changed/);assert.equal(f.writes.length,1);assert.ok(f.files.has(f.out));
});

function pageFixture({mutate=false,stale=false,wrongProject=false,templateFailure=false}={}){
  const f=fixture(),draft=f.opened.project.data,events=[];
  const runtime={currentProjectId:wrongProject?'other':CURRENT_SAVED_TARGETS.tax.id,saveDraft:null,persistReportDraft:null,window:{},appMode:'aireport',currentStep:0,signed:false,project:null,chapters:[],calcParams:null,projectWorkflow:null,
    restoreDraft:value=>{events.push('restore');runtime.project=structuredClone(value.project);runtime.chapters=structuredClone(value.chapters);runtime.calcParams=structuredClone(value.calcParams);runtime.projectWorkflow=structuredClone(value.workflow);},
    rlProjectType:()=> 'gaibao',ReportLogicCore:{load:async()=>events.push('logic')},ensureReportTableTemplates:async()=>{events.push('templates');if(templateFailure)throw Error('templates unavailable');},
    reportFinancialContext:()=>({}),ReportFinancialTables:{bindSource:()=>{events.push('bind');if(mutate)runtime.chapters[0].sections[0].content+='changed';return f.financialBinding;}},
    reportFinancialCandidateIssues:()=>stale?[{code:'stale'}]:[]};
  runtime.window.__qaReadSavedFinancialBindings=async()=>({binding:runtime.ReportFinancialTables.bindSource(),issues:stale?draft.chapters.flatMap((c,ci)=>c.sections.map((s,si)=>({key:(ci+1)+'.'+(si+1),issues:[{code:'stale'}]}))):[]});
  const callback=vm.runInNewContext('('+readFinancialBindingInPage.toString()+')',runtime);
  return {run:()=>callback({draft,projectId:CURRENT_SAVED_TARGETS.tax.id}),events,runtime,draft};
}

test('browser callback loads rules and templates before financial bind, without rendering or saving',async()=>{
  const f=pageFixture(),before=JSON.stringify(f.draft),result=await f.run();
  assert.deepEqual(f.events,['restore','logic','templates','bind']);assert.equal(result.binding.version,'calc-tables-v2');assert.equal(result.issues.length,0);assert.equal(JSON.stringify(f.draft),before);
  assert.equal((await f.runtime.persistReportDraft()).remote,false);assert.equal(f.runtime.window.__qaDispatchPaused,true);
});

test('browser identity, readiness and report-memory mutation remain hard failures; stale rows are returned',async()=>{
  await assert.rejects(pageFixture({wrongProject:true}).run(),/identity mismatch/);
  const readiness=pageFixture({templateFailure:true});await assert.rejects(readiness.run(),/templates unavailable/);assert.deepEqual(readiness.events,['restore','logic','templates']);
  await assert.rejects(pageFixture({mutate:true}).run(),/changed report memory/);
  assert.equal((await pageFixture({stale:true}).run()).issues.length,43);
});

test('harness is read-only/no-AI, closes on success/failure and rejects errors/blocked or AI requests',async()=>{
  for(const mode of ['ok','evaluate-failure','browser-error','ai','blocked']){
    const f=fixture(),events=[],isolation={};
    const dependencies={openProductionHarness:async(actual,key,options)=>{assert.equal(actual,isolation);assert.equal(key,'tax');assert.deepEqual(options,{allowAi:false,readOnly:true});return {errors:mode==='browser-error'?['blocked mutation']:[],ledger:mode==='ai'?[{isAi:true}]:mode==='blocked'?[{allowed:false}]:[],page:{evaluate:async(callback,input)=>{if(callback===installSavedFinancialBindingsReader){events.push('install');return;}assert.equal(callback,readFinancialBindingInPage);assert.deepEqual(input.draft,f.opened.project.data);events.push('read');if(mode==='evaluate-failure')throw Error('read failed');return {binding:f.financialBinding,issues:[]};}},close:async()=>events.push('close')};}};
    if(mode==='ok')assert.equal((await readProductionFinancialBinding(isolation,'tax',f.opened.project.data,dependencies)).binding.version,'calc-tables-v2');
    else await assert.rejects(readProductionFinancialBinding(isolation,'tax',f.opened.project.data,dependencies));
    assert.deepEqual(events,['install','read','close']);
  }
});
