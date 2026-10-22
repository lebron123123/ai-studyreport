import '../scripts/windows-browser-lockout-guard.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {browserFinalizeReviewedDetails,runMissingGenerationQueue} from '../scripts/report-runner-bounded-repair.mjs';

function finalizerHarness(mode='ok'){
 const expected='copy',detail={t:'明细',content:'<h3>分类</h3><p>原文</p>',executionTask:{id:'old',runId:'run'},pendingRevision:null,completionContract:{sectionKey:'章 / 明细',planId:'old'},completionQuality:{status:'passed'}},summary={t:'汇总',content:'',completionContract:{planId:'summary-original'}},chapters=[{name:'章',sections:[detail,summary]}],before=structuredClone(chapters),calls={save:0,get:0,finalize:0};let identity='source';
 const context=vm.createContext({currentProjectId:expected,window:{__qaDispatchPaused:true},chapters,projectCanEdit:()=>true,reportCandidateInputIdentity:()=>identity,ReportArgument:{contract:(_c,s)=>({summary:s==='汇总'})},authHeaders:()=>({}),buildDraftData:()=>({chapters:structuredClone(chapters)}),reportFinalizeInitialDeliveryDetails:async({ownedKeys,assertCurrent})=>{calls.finalize++;await assertCurrent();assert.deepEqual(Array.from(ownedKeys),['章 / 明细']);detail.completionContract={sectionKey:'章 / 明细',planId:'real-current'};detail.completionQuality={status:'passed',issues:[]};if(mode==='body')detail.content+='changed';if(mode==='task')detail.executionTask.id='new';if(mode==='summary')summary.completionContract.planId='bad';if(mode==='source')identity='new-source';return {changed:1,sectionKeys:mode==='partial'?[]:['章 / 明细']};},persistReportDraft:async()=>{calls.save++;if(mode==='save-cas')detail.content+='late';return {ok:mode!=='save-failure',remote:mode!=='save-failure'};},fetch:async()=>{calls.get++;if(mode==='get-cas')detail.executionTask.id='late';return {ok:mode!=='get-failure',json:async()=>{const remote=structuredClone(chapters);if(mode==='remote')remote[0].sections[0].content+='foreign';if(mode==='nested-null')remote[0].sections[0].executionTask.generationFailure=null;if(mode==='section-null')remote[0].sections[0].generationFailure=null;return {project:{id:mode==='remote-id'?'foreign':expected,data:{chapters:remote}}};}};}});
 const run=vm.runInContext('('+browserFinalizeReviewedDetails.toString()+')',context);
 return {chapters,before,calls,run:()=>run({expected,details:[{number:'1.1',section:before[0].sections[0]}]})};
}
test('real-finalizer adapter saves and GET-verifies only current detail metadata, preserving body/task/summary',async()=>{for(const mode of ['ok','section-null']){const h=finalizerHarness(mode),result=await h.run();assert.equal(result.remoteSaveVerified,true);assert.equal(h.calls.finalize,1);assert.equal(h.calls.save,1);assert.equal(h.calls.get,1);assert.equal(h.chapters[0].sections[0].completionContract.planId,'real-current');for(const key of ['content','executionTask','pendingRevision'])assert.deepEqual(h.chapters[0].sections[0][key],h.before[0].sections[0][key]);assert.deepEqual(h.chapters[0].sections[1],h.before[0].sections[1]);}});
test('body/task/source/summary changes and incomplete finalizer results fail before save',async()=>{for(const mode of ['body','task','summary','source','partial']){const h=finalizerHarness(mode);await assert.rejects(h.run());assert.equal(h.calls.save,0);assert.equal(h.calls.get,0);}});
test('failed save or remote/CAS mismatch retains recovery state and refuses generation',async()=>{for(const mode of ['save-failure','save-cas','get-failure','get-cas','remote','remote-id','nested-null']){const h=finalizerHarness(mode);await assert.rejects(h.run());assert.equal(h.chapters[0].sections[0].completionContract.planId,'real-current');assert.equal(h.calls.save,1);}});

const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
function queueHarness(mode='ok'){
 const ids={tax:'f4395f64-af1b-43bd-b809-580b5ec9406b',longgang:'2884b7a3-960f-40c0-af89-5d19e0284836'},files=new Map(),artifacts=new Map(),calls={paid:0,finalized:0},checkpoint={sections:{}},harnesses={};
 for(const key of ['tax','longgang']){
  const details=Array.from({length:34},(_,i)=>{const number='1.'+(i+1),section={t:'明细'+i,content:'<p>已全文审读'+i+'</p>',executionTask:{id:key+'-'+i},completionContract:{sectionKey:'章 / 明细'+i,planId:'old'},completionQuality:{status:'passed'}};const artifact={key,number,sectionKey:section.completionContract.sectionKey,status:'passed',content:section.content,executionTask:section.executionTask,completionContract:section.completionContract,qaBoundedAiRevision:{version:'independent-semantic-reviewed-actual-v1',semanticReviewRequired:false,reviewedBodySha256:sha(section.content),originalReview:'immutable-fullread'}};const file='/memory/'+key+'/sections/'+number+'.json';files.set(file,JSON.stringify(artifact));artifacts.set(file,structuredClone(artifact));checkpoint.sections[key+':'+number]={status:'passed'};return {number,summary:false,hasBody:true,pending:false,section};});
  const rows=[...details,...Array.from({length:9},(_,i)=>({number:'2.'+(i+1),summary:true,hasBody:false,pending:false,section:{t:'汇总'+i,content:''}}))];
  harnesses[key]={target:{id:ids[key]},page:{evaluate:async(fn,arg)=>{
   if(fn.toString()===browserFinalizeReviewedDetails.toString()){
    calls.finalized++;if(mode==='second-project-failure'&&key==='longgang')throw Error('Current source changed');
    return {identity:key+'-source',chaptersSnapshot:'snapshot-'+key,remoteSaveVerified:true,details:details.map(row=>({...row.section,number:row.number,editedHtml:null,completionContract:{...row.section.completionContract,planId:'current'},completionQuality:{status:'passed',issues:[]}}))};
   }
   if(arg&&typeof arg==='object'&&'chaptersSnapshot'in arg){if(mode==='late-cas'&&key==='tax')throw Error('Finalized detail CAS changed');return;}
   if(arg&&typeof arg==='object'&&'number'in arg){calls.paid++;return {key,number:arg.number,sectionKey:'章 / 汇总',status:'semantic-review-pending',executionTask:null};}
   return structuredClone(rows);
  }}};
 }
 if(mode==='missing-review')files.delete('/memory/longgang/sections/1.34.json');
 const context=vm.createContext({OUT:'/memory',IDS:ids,path:{join:(...parts)=>parts.join('/')},digest:sha,browserFinalizeReviewedDetails,fs:{readFile:async file=>{if(!files.has(file))throw Error('Missing artifact');if(mode==='artifact-readback'&&file==='/memory/tax/sections/1.1.json'&&files.get(file).includes('qaDetailFinalization'))return 'changed';return files.get(file);},writeFile:async(file,text)=>files.set(file,text)},archive:async(key,name)=>'/memory/'+key+'-'+name+'.json',console:{log:()=>{}}});
 const run=vm.runInContext('('+runMissingGenerationQueue.toString()+')',context);
 return {calls,files,artifacts,checkpoint,run:()=>run(harnesses,checkpoint,{keys:['tax:2.1','longgang:2.1']})};
}
test('shared summary queue finalizes both projects and synchronizes artifact metadata before any paid work',async()=>{const h=queueHarness(),result=await h.run();assert.equal(h.calls.finalized,2);assert.equal(h.calls.paid,2);assert.equal(result.receipts.length,2);for(const[file,old]of h.artifacts){const current=JSON.parse(h.files.get(file));assert.equal(current.completionContract.planId,'current');for(const field of ['key','number','sectionKey','content','executionTask','qaBoundedAiRevision'])assert.deepEqual(current[field],old[field]);assert.equal(current.qaDetailFinalization.reviewIdentityPreserved,true);assert.equal(current.qaDetailFinalization.newPaidAiCalls,0);}});
test('any project preflight, review, readback or final CAS failure forbids every paid request',async()=>{for(const mode of ['second-project-failure','missing-review','artifact-readback','late-cas']){const h=queueHarness(mode);await assert.rejects(h.run());assert.equal(h.calls.paid,0);}});
