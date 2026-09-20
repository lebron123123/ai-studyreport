const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../aireport.js'),'utf8');
const fn=source.slice(source.indexOf('async function airGenerateImpactedCandidates('),source.indexOf('function airSectionMaterialState('));
test('double click during save starts one batch and refreshes each completed candidate',async()=>{
 let release,calls=0,refresh=0;const gate=new Promise(r=>release=r),section={content:'old'},chapter={checked:true,cn:1,sections:[section]};
 const context={aiReportBusy:false,aiReportImpactedProgress:null,airAcceptCandidatesBusy:false,chapters:[chapter],
  window:{ResearchUI:{active:()=>true}},ResearchUI:{flush:()=>gate},
  airCandidateImpactRows:()=>[{c:chapter,s:section,si:0}],airReportLogicImpactSummary:()=>({locked:0}),confirm:()=>true,alert:()=>{},airBuildDocPane:()=>{},
  document:{querySelector:()=>null},runWorkerPool:async(tasks,work)=>Promise.all(tasks.map(work)),reviseSection:async()=>{calls++;return 'new';},
  reportHasVisibleBody:()=>true,ProjectWorkflow:{setCandidate:(s,t)=>s.pendingRevision=t},reportLogicRevision:()=>null,
  saveDraft:()=>{},airSaveState:()=>{},airRefreshSection:()=>refresh++};
 vm.createContext(context);vm.runInContext(fn,context);
 const first=context.airGenerateImpactedCandidates();await context.airGenerateImpactedCandidates();assert.equal(calls,0);
 release();await first;assert.equal(calls,1);assert.equal(refresh,1);assert.equal(context.aiReportImpactedProgress.done,1);assert.equal(section.content,'old');assert.equal(section.pendingRevision,'new');
});
