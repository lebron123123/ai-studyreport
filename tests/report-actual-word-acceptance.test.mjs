import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {CURRENT_SAVED_TARGETS,parseArgs,generationGate,stableWordJson,validateCurrentSavedInput,validateCurrentSavedFinancial,readCurrentSavedInput,verifyCurrentSavedInputs} from '../scripts/report-actual-word-acceptance.mjs';
import {SOURCE_IDS} from '../scripts/report-generation-acceptance.mjs';

const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const objectHash=value=>hash(JSON.stringify(stableWordJson(value)));
const bytes=value=>Buffer.from(JSON.stringify(value,null,2));

function fixture(key='tax'){
  const target=CURRENT_SAVED_TARGETS[key],sources={};
  for(const sourceKey of ['tax','longgang'])sources[sourceKey]={state:{frozen:sourceKey},sourceIdentity:{kind:sourceKey==='tax'?'project':'research',[sourceKey==='tax'?'projectId':'researchId']:SOURCE_IDS[sourceKey],sourceSha256:hash(sourceKey)}};
  const task=index=>index===0?null:{id:'original-task-'+index,runId:'original-run',status:'completed'};
  const sections=Array.from({length:43},(_,index)=>({t:'分类'+(index+1),content:'<h3>业务分类</h3><p>已逐字审读的实质分析 '+index+'。【待补：独立核实】</p>',editedHtml:null,executionTask:task(index),pendingRevision:null,completionContract:{version:'test-contract-v1',requiredHeadings:['业务分类'],financial:{snapshot:'calc-1'}}}));
  const financialSnapshot={id:'calc-1',version:7,projectId:target.id,calcType:'rent',params:{rent:100},summary:{npv:45}};
  const draft={project:{name:target.name},calcParams:{rent:100},chapters:[{name:'真实业务章',checked:true,sections}],workflow:{currentCalcSnapshotId:'calc-1',calcSnapshots:[financialSnapshot]},qaAcceptance:{version:'full-generation-acceptance-v1',...target},qaSourceIdentity:sources[key].sourceIdentity,qaSourceStateSha256:hash(JSON.stringify(sources[key].state))};
  const opened={project:{...target,updated_at:'saved-revision-1',data:draft}};
  const checkpoint={version:'production-full-generation-v1',sourceHashes:{[key]:sources[key].sourceIdentity.sourceSha256},projects:{[key]:{...target,sourceIdentity:sources[key].sourceIdentity,chapterCount:1}},sections:{}};
  const financialBinding={version:'calc-tables-v2',projectId:target.id,snapshotId:'calc-1',snapshotVersion:7,sourceSignature:'canonical-production-result-and-table-cells'};
  const manifest={version:'current-saved-word-review-v1',sources:Object.fromEntries(Object.entries(sources).map(([k,s])=>[k,{sourceSha256:s.sourceIdentity.sourceSha256,stateSha256:hash(JSON.stringify(s.state))}])),projects:{[key]:{...target,financial:{...financialBinding,sourceSignature:undefined,snapshotSha256:objectHash(financialSnapshot),paramsSha256:objectHash(draft.calcParams),sourceSignatureSha256:hash(financialBinding.sourceSignature)}}},rows:[]};
  const evidence={version:'independent-fullbody-review-v1',projectId:target.id,fullReadAt:'2026-10-12T04:00:00.000Z',rows:[]},artifacts={},reviews={};
  for(const [index,section] of sections.entries()){
    const number='1.'+(index+1),id=key+':'+number,sectionKey=draft.chapters[0].name+' / '+section.t,artifact={...structuredClone(section),key,number,sectionKey,status:'passed',errors:[]};
    checkpoint.sections[id]={status:'passed',sectionKey};
    artifacts[id]={value:artifact,sha256:hash(bytes(artifact))};
    const bodySha256=hash(section.content);
    evidence.rows.push({key:id,projectId:target.id,taskId:section.executionTask?.id??null,actualBodySha256:bodySha256,bodySha256,sectionBodySha256:bodySha256,semanticStatus:'acceptable-full-body-at-bound-sha',exactActualMatch:true,fullBodyRead:true,semanticPassed:true,technicalPassed:true,conclusion:'acceptable',findings:[],factsVerified:false,readAt:evidence.fullReadAt});
    manifest.rows.push({key:id,actualBodySha256:bodySha256,taskId:section.executionTask?.id??null,contractSha256:objectHash(section.completionContract),artifactSha256:artifacts[id].sha256,reviewEvidence:{file:'independent-fullbody-review.json',sha256:null}});
  }
  const evidenceSha=hash(bytes(evidence));
  for(const row of manifest.rows){row.reviewEvidence.sha256=evidenceSha;reviews[row.key]={value:evidence,sha256:evidenceSha};}
  return {key,opened,checkpoint,sources,manifest,artifacts,reviews,financialBinding};
}

function ioFixture(key='tax'){
  const f=fixture(key),out=path.resolve('outputs/report-standardization/synthetic-current-saved'),runner=path.join(out,'generation-runner'),reviewManifest=path.join(runner,'review-manifest.json'),files=new Map(),calls=[],sourceChecks=[];
  const sourceManifest={version:'full-generation-acceptance-snapshot-v1',sources:{}};
  for(const [k,s] of Object.entries(f.sources)){
    const file=path.join(out,k+'-source.json');files.set(file,bytes(s));sourceManifest.sources[k]={fileSha256:hash(files.get(file))};
  }
  files.set(path.join(out,'manifest.json'),bytes(sourceManifest));
  for(const [id,entry] of Object.entries(f.artifacts)){
    const file=path.join(runner,key,'sections',id.split(':')[1]+'.json');files.set(file,bytes(entry.value));f.checkpoint.sections[id].file=file;
  }
  files.set(path.join(runner,'checkpoint.json'),bytes(f.checkpoint));
  files.set(reviewManifest,bytes(f.manifest));files.set(path.join(runner,'independent-fullbody-review.json'),bytes(f.reviews[key+':1.1'].value));
  const snapshot={out,sources:f.sources},isolation={projects:{[key]:CURRENT_SAVED_TARGETS[key]},sessions:{[key]:{request:async(url,body,method)=>{calls.push({url,body,method});assert.equal(method,'GET');assert.equal(body,undefined);return structuredClone(f.opened);}}}};
  const dependencies={readFile:async file=>{assert.ok(!file.endsWith('final.json'));assert.ok(files.has(file),'Unexpected read '+file);return files.get(file);},realpath:async file=>path.resolve(file),checkSourceUnchanged:async identity=>{sourceChecks.push(identity);return true;}};
  return {...f,snapshot,isolation,reviewManifest,files,calls,sourceChecks,dependencies,runner};
}

test('current-saved CLI requires explicit independent manifest and excludes diagnostic projections',()=>{
  assert.equal(parseArgs(['--current-saved','--review-manifest','review.json']).currentSaved,true);
  assert.throws(()=>parseArgs(['--current-saved']),/requires --review-manifest/);
  assert.throws(()=>parseArgs(['--review-manifest','review.json']),/requires --current-saved/);
  assert.throws(()=>parseArgs(['--current-saved','--review-manifest','review.json','--diagnostic']),/cannot be diagnostic/);
  assert.throws(()=>parseArgs(['--current-saved','--review-manifest','review.json','--self-test']),/cannot be diagnostic/);
});

test('both exact copies pass only with 43 actual adopted bodies and separate full-body reviews',()=>{
  for(const key of ['tax','longgang']){
    const f=fixture(key),before=JSON.stringify(f),result=validateCurrentSavedInput(f);
    assert.equal(result.gate.passed,true);assert.equal(result.sections.length,43);
    assert.equal(result.sections[0].taskId,null);assert.equal(result.sections[0].factsVerified,false);
    assert.equal(JSON.stringify(f),before,'Validation cannot rewrite bodies or provenance');
    assert.equal(validateCurrentSavedFinancial(result.financial,f.financialBinding),true);
  }
});

test('missing review, missing section, unpassed checkpoint, empty/pending body all reject',()=>{
  const cases=[
    f=>f.manifest.rows.pop(),f=>f.opened.project.data.chapters[0].sections.pop(),
    f=>f.checkpoint.sections['tax:1.1'].status='semantic-review-pending',
    f=>f.opened.project.data.chapters[0].sections[0].content='',
    f=>f.opened.project.data.chapters[0].sections[0].pendingRevision={after:'unadopted'},
    f=>f.opened.project.data.chapters[0].checked=false
  ];
  for(const mutate of cases){const f=fixture();mutate(f);assert.throws(()=>validateCurrentSavedInput(f));}
});

test('any body/artifact/task/contract SHA or exact identity mismatch rejects',()=>{
  const cases=[
    f=>f.manifest.rows[0].artifactSha256=hash('changed artifact'),
    f=>f.manifest.rows[0].actualBodySha256=hash('intended body'),
    f=>f.manifest.rows[0].contractSha256=hash('different contract'),
    f=>f.manifest.rows[0].taskId='new-task',
    f=>delete f.manifest.rows[0].taskId,
    f=>f.opened.project.data.chapters[0].sections[1].executionTask.runId='different-run',
    f=>f.opened.project.data.chapters[0].sections[0].completionContract.requiredHeadings=[],
    f=>f.opened.project.data.chapters[0].sections[0].editedHtml='<p>Projected candidate</p>',
    f=>f.artifacts['tax:1.1'].value.content='<p>Different retained artifact</p>',
    f=>f.artifacts['tax:1.1'].value.sectionKey='另一业务分类',
    f=>f.checkpoint.sections['tax:1.1'].sectionKey='另一父类 / 分类',
    f=>f.opened.project.id=SOURCE_IDS.tax,
    f=>f.opened.project.name='[系统测试]wrong-copy',
    f=>f.manifest.projects.tax.id='another-copy'
  ];
  for(const mutate of cases){const f=fixture();mutate(f);assert.throws(()=>validateCurrentSavedInput(f));}
});

test('QA/source/checkpoint and frozen finance identity changes reject',()=>{
  const cases=[
    f=>f.opened.project.data.qaAcceptance.id='wrong',
    f=>f.opened.project.data.qaSourceStateSha256=hash('new source'),
    f=>f.opened.project.data.qaSourceIdentity.sourceSha256=hash('new source'),
    f=>f.sources.longgang.sourceIdentity.researchId='other-source',
    f=>f.manifest.sources.longgang.stateSha256=hash('other source state'),
    f=>f.checkpoint.sourceHashes.tax=hash('other source'),
    f=>f.checkpoint.projects.tax.sourceIdentity={...f.sources.tax.sourceIdentity,ownerId:'other'},
    f=>f.opened.project.data.workflow.currentCalcSnapshotId='other-snapshot',
    f=>f.opened.project.data.workflow.calcSnapshots[0].version++,
    f=>f.opened.project.data.workflow.calcSnapshots[0].summary.npv++,
    f=>f.opened.project.data.calcParams.rent++,
    f=>f.manifest.projects.tax.financial.version='calc-tables-v1',
    f=>f.manifest.projects.tax.financial.projectId='other-project',
    f=>f.manifest.projects.tax.financial.sourceSignatureSha256='not-a-hash'
  ];
  for(const mutate of cases){const f=fixture();mutate(f);assert.throws(()=>validateCurrentSavedInput(f));}
  const f=fixture();
  for(const change of [{sourceSignature:'changed result/table cells'},{snapshotId:'another'},{snapshotVersion:8},{version:'v1'},{projectId:'other'}])assert.throws(()=>validateCurrentSavedFinancial(f.manifest.projects.tax.financial,{...f.financialBinding,...change}),/financial identity/);
  assert.throws(()=>validateCurrentSavedFinancial(f.manifest.projects.tax.financial,f.financialBinding,[{key:'9.4'}]),/stale/);
});

test('passed flags and intended projections cannot manufacture an independent semantic review',()=>{
  const cases=[
    f=>{f.manifest.rows[0].fullBodyRead=true;delete f.reviews['tax:1.1'];},
    f=>f.reviews['tax:1.1'].value.rows[0].semanticStatus='passed',
    f=>f.reviews['tax:1.1'].value.rows[0].fullBodyRead=false,
    f=>f.reviews['tax:1.1'].value.rows[0].findings=['still unsupported'],
    f=>f.reviews['tax:1.1'].value.rows[0].bodySha256=hash('other body'),
    f=>f.reviews['tax:1.1'].value.rows[0].taskId='old-task',
    f=>f.reviews['tax:1.1'].value.projectId='other-project',
    f=>f.reviews['tax:1.1'].value.intendedWorkingOnly=true,
    f=>f.manifest.intendedAcceptedBody=[],
    f=>f.opened.project.data.intendedChapters=[]
  ];
  for(const mutate of cases){const f=fixture();mutate(f);assert.throws(()=>validateCurrentSavedInput(f));}
  const f=fixture(),state={...f.opened.project.data,projectId:CURRENT_SAVED_TARGETS.tax.id,sourceUnchanged:true,intendedWorkingOnly:true};
  assert.equal(generationGate(state,f.checkpoint,'tax',CURRENT_SAVED_TARGETS.tax,f.sources.tax.sourceIdentity.sourceSha256).passed,false);
});

test('capture uses GET only, ignores final.json, preserves nullable old tasks and checks both formal sources twice',async()=>{
  const f=ioFixture(),before=JSON.stringify(f.opened),result=await readCurrentSavedInput(f.snapshot,f.isolation,'tax',f.reviewManifest,f.dependencies);
  assert.equal(result.sections.length,43);assert.equal(result.state.chapters[0].sections[0].executionTask,null);
  assert.equal(await result.verifyUnchanged(),true);assert.equal(f.calls.length,2);
  assert.equal(f.sourceChecks.length,4);assert.equal(JSON.stringify(f.opened),before);
  // JSONB key ordering is not a content/version change.
  f.opened.project={data:f.opened.project.data,updated_at:f.opened.project.updated_at,name:f.opened.project.name,id:f.opened.project.id};
  assert.equal(await result.verifyUnchanged(),true);
});

test('remote changes before final acceptance reject; no actual body projection is substituted',async()=>{
  for(const mutate of [f=>f.opened.project.updated_at='new-revision',f=>f.opened.project.data.chapters[0].sections[0].content+='changed',f=>f.opened.project.data.chapters[0].sections[1].executionTask.runId='new-run',f=>f.opened.project.data.kb=[{content:'changed input'}]]){
    const f=ioFixture(),result=await readCurrentSavedInput(f.snapshot,f.isolation,'tax',f.reviewManifest,f.dependencies);mutate(f);
    await assert.rejects(result.verifyUnchanged(),/remote project changed/);
  }
});

test('final barrier rechecks both captures, including Tax changes during Longgang rendering',async()=>{
  const tax=ioFixture('tax'),longgang=ioFixture('longgang'),inputs={};
  for(const [key,f] of Object.entries({tax,longgang}))inputs[key]=await readCurrentSavedInput(f.snapshot,f.isolation,key,f.reviewManifest,f.dependencies);
  assert.equal(await verifyCurrentSavedInputs(inputs),true);
  tax.opened.project.data.chapters[0].sections[0].content+='changed while the other report rendered';
  await assert.rejects(verifyCurrentSavedInputs(inputs),/remote project changed/);
  await assert.rejects(verifyCurrentSavedInputs({}),/No current saved captures/);
});

test('artifact/review/manifest/checkpoint/source file changes after capture reject',async()=>{
  for(const suffix of ['tax/sections/1.1.json','independent-fullbody-review.json','review-manifest.json','checkpoint.json','../tax-source.json']){
    const f=ioFixture(),result=await readCurrentSavedInput(f.snapshot,f.isolation,'tax',f.reviewManifest,f.dependencies),file=path.resolve(f.runner,suffix);
    f.files.set(file,Buffer.concat([f.files.get(file),Buffer.from('\n')]));
    await assert.rejects(result.verifyUnchanged(),/evidence changed after capture/);
  }
  const f=ioFixture(),result=await readCurrentSavedInput(f.snapshot,f.isolation,'tax',f.reviewManifest,f.dependencies);
  f.dependencies.checkSourceUnchanged=async()=>false; // captured function is intentionally fixed
  const g=ioFixture();let stable=true;g.dependencies.checkSourceUnchanged=async()=>stable;
  const captured=await readCurrentSavedInput(g.snapshot,g.isolation,'tax',g.reviewManifest,g.dependencies);stable=false;
  await assert.rejects(captured.verifyUnchanged(),/Formal source changed after capture/);
  assert.equal(await result.verifyUnchanged(),true);
});

test('self-referential review index, out-of-scope review and changed evidence bytes reject during capture',async()=>{
  for(const mode of ['self','outside','changed','missing']){
    const f=ioFixture(),m=JSON.parse(String(f.files.get(f.reviewManifest)));
    if(mode==='self')m.rows[0].reviewEvidence.file=f.reviewManifest;
    if(mode==='outside')m.rows[0].reviewEvidence.file=path.join(f.snapshot.out,'outside-review.json');
    if(mode==='changed')f.files.set(path.join(f.runner,'independent-fullbody-review.json'),bytes({rows:[]}));
    if(mode==='missing')delete m.rows[0].reviewEvidence;
    f.files.set(f.reviewManifest,bytes(m));
    await assert.rejects(readCurrentSavedInput(f.snapshot,f.isolation,'tax',f.reviewManifest,f.dependencies));
  }
});

test('importing the CLI/helper does not start main, browser, network or artifact writes',()=>{
  const moduleUrl=new URL('../scripts/report-actual-word-acceptance.mjs',import.meta.url).href;
  const code=`import fs from 'node:fs/promises'; fs.mkdir=fs.writeFile=async()=>{throw Error('unexpected artifact write')}; globalThis.fetch=()=>{throw Error('unexpected network')}; process.env.DATABASE_URL=''; const m=await import(${JSON.stringify(moduleUrl)}); if(typeof m.readCurrentSavedInput!=='function')throw Error('missing export');`;
  assert.equal(execFileSync(process.execPath,['--input-type=module','-e',code],{cwd:path.dirname(fileURLToPath(import.meta.url)),encoding:'utf8'}),'');
});

// Exercise the production page callback itself, with no browser, network or Word
// file writes. The template gate must run before financial/plan consumers.
function wordPageFixture({currentSaved=true,templateFailure=null,staleFinancial=false,mutateRender=false}={}){
  const source=fs.readFileSync(new URL('../scripts/report-actual-word-acceptance.mjs',import.meta.url),'utf8');
  const start=source.indexOf('async ({draft,currentSaved})=>{'),end=source.indexOf('},{draft:memory,currentSaved:!!current});',start);
  assert.ok(start>=0&&end>start,'Production Word page callback must be found');
  const events=[],draft={project:{name:'[系统测试]模板顺序'},calcParams:{rent:100},workflow:{currentCalcSnapshotId:'calc-1'},chapters:[{name:'实际章',checked:true,sections:[{t:'实际节',content:'<p>实际正文</p>',editedHtml:null,completionContract:{planId:'loaded-plan'}}]}]};
  const runtime={window:{},currentProjectId:'qa-fixture',chapters:[],project:null,calcParams:null,projectWorkflow:null,appMode:'report',currentStep:4,signed:false,saveDraft:null,persistReportDraft:null,Uint8Array,btoa:value=>Buffer.from(value,'binary').toString('base64'),
    restoreDraft:value=>{runtime.chapters=structuredClone(value.chapters);runtime.project=structuredClone(value.project);runtime.calcParams=structuredClone(value.calcParams);runtime.projectWorkflow=structuredClone(value.workflow);events.push('restore');},
    ReportLogicCore:{load:async()=>{events.push('logic');runtime.logicReady=true;}},rlProjectType:()=> 'gaibao-housing',
    ensureReportTableTemplates:async()=>{events.push('templates');if(templateFailure)throw Error(templateFailure);if(currentSaved)assert.equal(runtime.logicReady,true);runtime.templatesReady=true;},
    ReportFinancialTables:{bindSource:()=>{events.push('financial');assert.equal(runtime.templatesReady,true);return {snapshotId:'calc-1'};}},reportFinancialContext:()=>({}),
    reportFinancialCandidateIssues:()=>{events.push('financial-plan');assert.equal(runtime.templatesReady,true);return staleFinancial?[{code:'stale-loaded-plan'}]:[];},
    renderTOC:()=>events.push('toc'),renderSheet:()=>{events.push('sheet');if(mutateRender)runtime.chapters[0].sections[0].content+='changed';},ensureDocxLib:async()=>events.push('docx'),
    reportSavedCompletionReviewPlan:async()=>{events.push('saved-basis-proof');return {verified:'current-saved-proof'};},
    buildExportPayload:options=>{events.push('payload-plan');assert.equal(runtime.templatesReady,true);if(currentSaved){assert.equal(options.stateOnly,true);assert.equal(options.savedCompletionReview.verified,'current-saved-proof');}else assert.equal(options,undefined);return {chapters:structuredClone(runtime.chapters)};},renderContent:value=>value,ReportOutputPolicy:{contentVersion:'test-v1'}};
  runtime.window.__qaReadSavedFinancialBindings=async()=>{const binding=runtime.ReportFinancialTables.bindSource(),issues=runtime.reportFinancialCandidateIssues();return {binding,issues:issues.length?[{key:'1.1',issues}]:[]};};
  runtime.window.docx={Packer:{toBlob:async()=>{events.push('pack');return {arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer};}}};
  runtime.window.buildDocxDocument=()=>({});runtime.window.buildDocxDocument.templateVersion='test-v1';
  const callback=vm.runInNewContext('('+source.slice(start,end+1)+')',runtime);
  return {events,draft,runtime,run:()=>callback({draft,currentSaved})};
}

test('current-saved Word loads logic then templates before financial checks and export plans',async()=>{
  const f=wordPageFixture(),before=JSON.stringify(f.draft),result=await f.run();
  assert.deepEqual(f.events,['restore','logic','templates','financial','financial-plan','toc','sheet','docx','saved-basis-proof','payload-plan','pack']);
  assert.equal(result.memoryUnchanged,true);assert.equal(JSON.stringify(f.draft),before);
  assert.equal(JSON.stringify(f.runtime.chapters),JSON.stringify(f.draft.chapters));
});

test('failed template readiness stops before financial checks and Word composition',async()=>{
  for(const failure of ['Template load failed','ReportTableTemplates module unavailable']){
    const f=wordPageFixture({templateFailure:failure});await assert.rejects(f.run(),new RegExp(failure));
    assert.deepEqual(f.events,['restore','logic','templates']);
    assert.equal(JSON.stringify(f.runtime.chapters),JSON.stringify(f.draft.chapters));
  }
});

test('current-saved Word refuses failed basis verification before composing the document',async()=>{
  const f=wordPageFixture();f.runtime.reportSavedCompletionReviewPlan=async()=>{throw Error('Saved basis changed');};
  await assert.rejects(f.run(),/Saved basis changed/);
  assert.equal(f.events.includes('payload-plan'),false);assert.equal(f.events.includes('pack'),false);
});

test('loaded financial-plan mismatches remain blocking after the order correction',async()=>{
  const f=wordPageFixture({staleFinancial:true});await assert.rejects(f.run(),/Saved financial table binding is stale: 1.1/);
  assert.deepEqual(f.events,['restore','logic','templates','financial','financial-plan']);
});

test('current-saved rendering still refuses changes to the exact adopted chapters',async()=>{
  const f=wordPageFixture({mutateRender:true});await assert.rejects(f.run(),/Read-only rendering changed saved chapters/);
  assert.equal(f.events.includes('payload-plan'),false);assert.equal(f.events.includes('pack'),false);
});

test('diagnostic Word also prepares templates once before export without claiming current financial validation',async()=>{
  const f=wordPageFixture({currentSaved:false}),result=await f.run();
  assert.deepEqual(f.events,['restore','templates','toc','sheet','docx','payload-plan','pack']);
  assert.equal(result.financial,null);assert.equal(result.financialIssues.length,0);
});
