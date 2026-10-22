// Full-index integration QA. Fresh browser; no credentials, real projects, AI or database writes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const origin='http://localhost:8080';
const rootAssets=['report-completion-contract.js','report-orchestration-client.js','project-workflow.js','report-table-templates.js','report-section-layout.js','report-output-policy.js','report.js','export.js','app.js'];
const localIndex=await fs.readFile(path.resolve('index.html'),'utf8');
const expectedAssetVersions=new Map([...localIndex.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)].map(match=>{const url=new URL(match[1],origin);return [url.pathname.slice(1),url.searchParams.get('v')];}));
const assetReads=[],servedAssets=new Map();
const sha256=content=>crypto.createHash('sha256').update(content).digest('hex');
let executionFixture=null;
const output=path.resolve('outputs/report-standardization','root-ui-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(3).toString('hex'));
await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:1050},serviceWorkers:'block',acceptDownloads:false,extraHTTPHeaders:{'Cache-Control':'no-cache','Pragma':'no-cache'}});
const report={origin,output,startedAt:new Date().toISOString(),scope:'real index and scripts; isolated in-memory fixtures; every API intercepted',tests:[],assetChecks:[],apiRequests:[],externalRequests:[],consoleErrors:[],pageErrors:[],dialogs:[],downloads:0,passed:false};
const page=await context.newPage();
page.on('response',response=>{
  const url=new URL(response.url()),name=url.pathname.slice(1);
  if(url.origin!==origin||!rootAssets.includes(name))return;
  assetReads.push(response.body().then(body=>servedAssets.set(name,{name,url:response.url(),status:response.status(),fromServiceWorker:response.fromServiceWorker(),sha256:sha256(body)})));
});
page.on('pageerror',error=>report.pageErrors.push(error.message));
page.on('console',message=>{if(message.type()==='error')report.consoleErrors.push(message.text());});
page.on('download',download=>{report.downloads++;download.cancel().catch(()=>{});});
page.on('dialog',async dialog=>{report.dialogs.push({type:dialog.type(),message:dialog.message()});await dialog.dismiss();});
await context.addInitScript(()=>{
  // These are fresh test-context stores, never the user's browser profile.
  window.__rootUiStorageWrites=[];
  for(const method of ['setItem','removeItem','clear'])Object.defineProperty(Storage.prototype,method,{configurable:true,value:function(...args){window.__rootUiStorageWrites.push({method,key:args[0]||''});}});
});
await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin===origin&&url.pathname.startsWith('/api/')){
    // Record the action name only; never persist request bodies or credentials.
    let action='';try{action=String(request.postDataJSON()?.action||'');}catch{}
    report.apiRequests.push({path:url.pathname,method:request.method(),action,...(url.pathname==='/api/reportexecution'&&executionFixture?{fixture:'server-blocked'}:{})});
    if(url.pathname==='/api/reportexecution'&&executionFixture)return route.fulfill({json:{ok:true,task:executionFixture}});
    return route.fulfill({json:{ok:false,error:'[系统测试]本轮所有 API 已隔离，无真实数据'}});
  }
  if(url.origin!==origin&&!['data:','blob:','about:'].includes(url.protocol)){
    report.externalRequests.push(url.origin+url.pathname);
    return route.abort('blockedbyclient');
  }
  return route.continue();
});
async function record(name,fn){
  try{const details=await fn();report.tests.push({name,passed:true,details:details??null});}
  catch(error){report.tests.push({name,passed:false,error:error.message,fixture:report.lastFixture??null});throw error;}
}
async function verifyLoadedAssets(phase){
  await Promise.all(assetReads);
  const checks=[];
  for(const name of rootAssets){
    const served=servedAssets.get(name);assert.ok(served,'actual browser did not load '+name);
    const expectedVersion=expectedAssetVersions.get(name);assert.match(expectedVersion,/^20260922\.root\d+$/);
    assert.equal(new URL(served.url).searchParams.get('v'),expectedVersion,name+' must use current local index version');
    assert.equal(served.status,200);assert.equal(served.fromServiceWorker,false);
    const localSha256=sha256(await fs.readFile(path.resolve(name)));
    assert.equal(served.sha256,localSha256,name+' browser response differs from current local file');
    checks.push({...served,localSha256,identical:true});
  }
  report.assetChecks.push({phase,indexSha256:sha256(localIndex),versions:Object.fromEntries(rootAssets.map(name=>[name,expectedAssetVersions.get(name)])),freshBrowser:true,httpCacheDisabledByRouting:true,checks});
}
async function load(reload=false){
  servedAssets.clear();
  if(reload)await page.reload({waitUntil:'domcontentloaded'});else await page.goto(origin+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof renderSheet==='function'&&typeof reportCompletionReviewHtml==='function'&&typeof exportReportCompletionGate==='function'&&!!window.ReportCompletionContract&&!!window.ProjectWorkflow);
  assert.equal(await page.locator('#selfCheckBar').count(),0,'full-index critical script check');
  await verifyLoadedAssets(reload?'reload':'initial');
  await page.evaluate(()=>{
    document.getElementById('gate')?.remove();
    window.__rootUi={saveCalls:0};
    // Redirect the only save function intentionally exercised below to a memory counter.
    window.saveDraft=()=>{window.__rootUi.saveCalls++;};
    currentProjectId='[系统测试]root-ui';currentProjectRole='OWNER';
    Object.assign(project,{name:'[系统测试]标准化成稿界面',owner:'隔离验收',industry:'保障性住房',location:'测试区域',type:'非居改保',scale:'',desc:'仅浏览器内存',businessScenario:'housing_conversion',competitors:[],analysisSites:[]});
    domainKey='gaibao';calcType='gaibao';rptCtype='rent';calcParams={area:1000,units:30,operateYears:6,mode:'分成'};calcResult=null;signed=false;kbEntries=[];
  });
}
async function fixture(kind){
  const result=await page.evaluate(kind=>{
    const section=(t,content,numeric=false)=>({t,content,numeric,editedHtml:'',syncStatus:'current'});
    const content='本节仅说明项目职责边界，原始资料和测算输入分别核对，所有结论应经人工复核后使用。';
    const repeated='项目运营执行须核对实际交付条件、资产边界及双方职责，未完成的条件不得写为已落实，项目风险与合同责任应在审签时逐项核对，所有财务假设须与原件口径对应并保留复核记录。';
    const cases={
      normal:[section('经营边界核验',content)],
      pending:[section('经营边界核验',content+'【待补：协议签署页与生效日期】')],
      overlong:[section('经营边界核验',content.repeat(100))],
      missingTable:[section('财务评价',content)],
      duplicate:[section('边界核验甲',repeated),section('边界核验乙',repeated)],
      emptySection:[section('经营边界核验','')],
      brokenTable:[section('专项结构核验',content+'\n\n@@TABLE_0@@')],
      empty:[]
    };
    chapters=kind==='empty'?[]:[{name:'[系统测试]职责核验',cn:'一',checked:true,sections:cases[kind]}];
    projectWorkflow=ProjectWorkflow.ensureState({});
    projectWorkflow.reportCompletion={facts:[{key:'name',label:'项目名称',value:project.name,status:'confirmed',source:'[系统测试]内存夹具，不是实际项目证据',owner:'',required:false,allocationMode:'background'}]};
    appMode='report';currentStep=4;renderTOC();renderSheet();
    const plan=reportCompletionPlan(),review=ReportCompletionContract.reviewDocument(reportCompletionEntries(),plan);
    return {status:review.status,issues:[...review.issues,...review.reviews.flatMap(r=>r.issues)],sections:review.reviews.length,planId:plan.planId};
  },kind);
  report.lastFixture={kind,...result};return result;
}
async function openPanel(){const el=page.locator('.report-completion-review');if(!await el.evaluate(node=>node.open))await el.locator(':scope > summary').click();return el;}
async function shot(name){await page.screenshot({path:path.join(output,name+'.png'),fullPage:false,animations:'disabled'});}
async function basisFixture(){
  await fixture('normal');
  return page.evaluate(()=>{
    chapters=[{name:'[系统测试]项目总论',cn:'一',checked:true,sections:[{t:'编制依据',content:'原有依据稿保持不变',editedHtml:''},{t:'政策依据',content:'原有政策稿保持不变',editedHtml:''}]}];
    kbEntries=[{title:'[系统测试]待核验合作协议',fileId:'[系统测试]basis-file',content:'首期6年，条款尚待人工核实。'}];
    projectWorkflow=ProjectWorkflow.ensureState({});projectWorkflow.reportCompletion={facts:[]};
    currentStep=4;renderTOC();renderSheet();
    window.__basisUi={saves:0,original:JSON.stringify({chapters,kbEntries}),projectId:currentProjectId};
    window.__basisPersistOriginal=persistReportDraft;
    return {keys:reportCompletionPlan().sections.map(s=>s.sectionKey),basis:reportCompletionPlan().sections.map(s=>s.requirements.basis)};
  });
}
async function closeBasisFixture(){
  await page.evaluate(()=>{document.getElementById('reportBasisEditor')?.remove();if(window.__basisPersistOriginal)persistReportDraft=window.__basisPersistOriginal;if(window.__basisBindOriginal)ReportCompletionContract.bindBasisCatalog=window.__basisBindOriginal;if(window.__basisResearchOriginal)window.ResearchUI=window.__basisResearchOriginal;if(window.__basisUi)currentProjectId=__basisUi.projectId;delete window.__basisPersistOriginal;delete window.__basisBindOriginal;delete window.__basisResearchOriginal;});
}
try{
  await load();
  await record('actual index loads complete report/export/contract modules',async()=>page.evaluate(()=>({scripts:[...document.scripts].filter(s=>s.src).length,hasMainSheet:!!document.getElementById('sheet'),contractVersion:ReportCompletionContract.VERSION})));
  await record('unassigned fact ownership blocks review instead of silently treating the fact as background',async()=>{
    await fixture('normal');
    const result=await page.evaluate(()=>{
      delete projectWorkflow.reportCompletion.facts[0].allocationMode;
      const plan=reportCompletionPlan(),review=ReportCompletionContract.reviewDocument(reportCompletionEntries(),plan);
      return {status:review.status,issues:review.issues,facts:plan.factAllocation.facts.map(f=>({key:f.key,allocationMode:f.allocationMode,allocationIssue:f.allocationIssue}))};
    });
    assert.equal(result.status,'blocked');assert.ok(result.issues.some(i=>i.code==='fact-allocation-invalid'));return result;
  });
  for(let round=0;round<2;round++){
    if(round)await load(true);
    await record('normal report and five collapse cycles'+(round?' after browser refresh':''),async()=>{
      const review=await fixture('normal');assert.equal(review.status,'passed');
      const panel=page.locator('.report-completion-review'),summary=panel.locator(':scope > summary');
      assert.match(await summary.innerText(),/结构通过.*1 小节/);
      for(let n=0;n<5;n++){await summary.click();assert.equal(await panel.evaluate(el=>el.open),n%2===0);}
      assert.equal(await page.locator('#chapterContainer .section-block').count(),1);
      await shot(round?'refresh-normal':'normal');return review;
    });
    await record('real navigation back to chapter scope and reenter'+(round?' after refresh':''),async()=>{
      await page.locator('#backStep3g').click();assert.equal(await page.evaluate(()=>currentStep),3);
      await page.locator('#toStep4g').click();assert.equal(await page.evaluate(()=>currentStep),4);
      assert.match(await page.locator('.report-completion-review > summary').innerText(),/结构通过/);
    });
  }
  for(const [kind,expected,status] of [['pending','pending-evidence','unverified'],['overlong','budget-proseCharacters','blocked'],['missingTable','missing-table','blocked'],['duplicate','duplicate-paragraph','blocked'],['emptySection','empty','blocked']]){
    await record(kind+' renders in actual report page',async()=>{
      const review=await fixture(kind);assert.equal(review.status,status);assert.ok(review.issues.some(x=>x.code===expected),JSON.stringify(review));
      await openPanel();await shot(kind);return review;
    });
  }
  await record('empty chapter list renders without exception and is not a completed report',async()=>{
    const review=await fixture('empty');assert.equal(review.sections,0);assert.equal(review.status,'blocked');
    assert.ok(review.issues.some(x=>x.code==='empty-document'&&x.severity==='error'));
    const summary=await page.locator('.report-completion-review > summary').innerText();
    assert.match(summary,/0 小节/);assert.doesNotMatch(summary,/结构通过/);
    await openPanel();await shot('empty');return review;
  });
  await record('server decoder failure survives durable client and preserves work/candidate drafts',async()=>{
    await fixture('normal');
    const blockedText='此为隔离任务返回的完整候选，结构槽位尚须返修，不可覆盖工作稿。';
    executionFixture={id:'[系统测试]root-ui-blocked',runId:'[系统测试]root-ui-run',status:'completed',text:blockedText,rawText:JSON.stringify({blocks:[{kind:'paragraph',slot:'finding',text:blockedText}]}),outputFormat:'structured',model:'isolated-fixture',provider:'isolated-fixture',quality:{status:'blocked',issues:[{code:'structured-slot-budget',severity:'error',message:'[系统测试]槽位超过预算，纯文本总字数仍在预算内'}]},repair:{round:2,canRetry:false}};
    let result;
    try{
      result=await page.evaluate(async blockedText=>{
        const c=chapters[0],s=c.sections[0],original=s.content,chunks=[];
        const textOnlyStatus=ReportCompletionContract.inspect(blockedText,reportSectionContract(c,s)).status;
        const attempts=[];
        for(const existingCandidate of [false,true]){
          if(existingCandidate)s.pendingRevision={before:original,after:'[系统测试]既有待人工审签候选',reason:'不能被后台失败结果覆盖',quality:{status:'unverified',issues:[]}};
          const candidate=s.pendingRevision,before=JSON.stringify(candidate);
          let error='',errorCode='';try{await reportDurableSectionCall(c,s,'[系统测试]隔离系统提示','[系统测试]隔离任务',text=>chunks.push(text),existingCandidate?{candidateRepair:candidate}:{});}catch(e){error=e.message;errorCode=e.code;}
          attempts.push({existingCandidate,error,errorCode,originalUnchanged:s.content===original,candidateUnchanged:JSON.stringify(s.pendingRevision)===before&&s.pendingRevision===candidate,newCandidateAbsent:existingCandidate?null:s.pendingRevision==null,completionQuality:s.completionQuality||null,executionTask:s.executionTask||null});
        }
        return {textOnlyStatus,chunks,attempts};
      },blockedText);
    }finally{executionFixture=null;}
    assert.equal(result.textOnlyStatus,'passed','fixture must expose the server-only decoder failure');
    assert.deepEqual(result.chunks,[]);
    for(const attempt of result.attempts){
      assert.ok(attempt.error,'server blocked result must stop caller');assert.equal(attempt.errorCode,'REPORT_CANDIDATE_QUALITY_BLOCKED');
      assert.equal(attempt.originalUnchanged,true);assert.equal(attempt.candidateUnchanged,true);
      if(!attempt.existingCandidate)assert.equal(attempt.newCandidateAbsent,true);
      assert.equal(attempt.executionTask?.id,'[系统测试]root-ui-blocked');
      assert.equal(attempt.executionTask?.quality?.status,'blocked');
      assert.ok(attempt.executionTask.quality.issues.some(issue=>issue.code==='structured-slot-budget'));
    }
    return result;
  });
  await record('failed generated candidate and repeated retry preserve original and first candidate',async()=>{
    await fixture('normal');const result=await page.evaluate(()=>{
      const c=chapters[0],s=c.sections[0],original=s.content,after='超长候选须返修，不得覆盖原文。'.repeat(200),errors=[];
      try{reportCheckGeneratedDraft(c,s,after);}catch(e){errors.push(e.message);}
      const first=JSON.stringify(s.pendingRevision);
      try{reportCheckGeneratedDraft(c,s,'后来的不合格候选'.repeat(500));}catch(e){errors.push(e.message);}
      const result={originalUnchanged:s.content===original,firstPreserved:JSON.stringify(s.pendingRevision)===first,fullCandidatePreserved:s.pendingRevision?.after===after,status:s.pendingRevision?.quality?.status,errors,saveCalls:__rootUi.saveCalls};
      currentStep=5;renderTOC();renderSheet();return result;
    });
    assert.equal(result.originalUnchanged,true);assert.equal(result.firstPreserved,true);assert.equal(result.fullCandidatePreserved,true);assert.equal(result.status,'blocked');assert.equal(result.errors.length,2);
    assert.ok(await page.locator('.wf-candidate').count());
    await page.locator('#backStep4r').click();assert.equal(await page.locator('.report-completion-review').count(),1);
    return result;
  });
  await record('basis directory empty selection is blocked; uploaded file is received, never silently verified',async()=>{
    const f=await basisFixture();assert.deepEqual(f.basis,[true,true]);
    try{
      await openPanel();assert.equal(await page.locator('button[onclick="reportEditBasisCatalog(1)"]').count(),1);
      await page.locator('button[onclick="reportEditBasisCatalog(1)"]').click();
      const modal=page.locator('#reportBasisEditor');await modal.waitFor();
      assert.equal(await modal.locator('input[type=checkbox]:checked').count(),0,'materials are not automatically assigned to every basis subsection');
      const before=await page.evaluate(()=>JSON.stringify(projectWorkflow.reportCompletion));
      await page.evaluate(()=>{persistReportDraft=async()=>{__basisUi.saves++;return {ok:true};};});
      await modal.locator('[data-basis-save]').click();await page.waitForFunction(()=>!document.querySelector('[data-basis-save]').disabled);
      assert.match(await modal.locator('[data-basis-status]').innerText(),/至少.*依据|无资料/);assert.equal(await page.evaluate(()=>__basisUi.saves),0);assert.equal(await page.evaluate(()=>JSON.stringify(projectWorkflow.reportCompletion)),before);
      await modal.locator('[data-basis-close]').last().click();
      await page.locator('button[onclick="reportEditBasisCatalog(0)"]').click();await modal.waitFor();
      assert.equal(await modal.locator('input[type=checkbox]:checked').count(),1);assert.match(await modal.innerText(),/已接收，待核验/);
      const catalog=await page.evaluate(async()=>reportBasisCatalogFor(reportCompletionPlan().sections[0]));
      assert.equal(catalog.items.length,1);assert.equal(catalog.items[0].status,'received');assert.equal(catalog.items[0].documentNo,'');assert.equal(catalog.items[0].issuer,'');assert.equal(catalog.items[0].date,'');assert.match(catalog.items[0].evidence.sourceHash,/^[a-f0-9]{64}$/);
      assert.equal(await page.evaluate(()=>JSON.stringify({chapters,kbEntries})===__basisUi.original),true);
      await shot('basis-empty-received');return {emptySaveBlocked:true,saveCalls:0,receivedOnly:true};
    }finally{await closeBasisFixture();}
  });
  await record('basis directory failed save rolls back state and can retry in the same dialog',async()=>{
    await basisFixture();
    try{
      await openPanel();await page.locator('button[onclick="reportEditBasisCatalog(0)"]').click();
      const modal=page.locator('#reportBasisEditor');await modal.waitFor();
      const before=await page.evaluate(()=>({state:JSON.stringify(projectWorkflow.reportCompletion),plan:reportCompletionPlan().planId}));
      await page.evaluate(()=>{persistReportDraft=async()=>({ok:++__basisUi.saves>1});});
      await modal.locator('[data-basis-save]').click();await page.waitForFunction(()=>document.querySelector('[data-basis-save]')&&!document.querySelector('[data-basis-save]').disabled);
      assert.match(await modal.locator('[data-basis-status]').innerText(),/保存|重试/);assert.equal(await page.evaluate(()=>JSON.stringify(projectWorkflow.reportCompletion)),before.state);assert.equal(await page.evaluate(()=>reportCompletionPlan().planId),before.plan);
      assert.equal(await modal.locator('input[type=checkbox]:checked').count(),1,'retry retains the user selection');
      await modal.locator('[data-basis-save]').click();await modal.waitFor({state:'detached'});
      const after=await page.evaluate(()=>({saves:__basisUi.saves,state:projectWorkflow.reportCompletion,unchanged:JSON.stringify({chapters,kbEntries})===__basisUi.original}));
      assert.equal(after.saves,2);assert.equal(after.state.history.length,1);assert.equal(after.state.version,1);assert.equal(Object.keys(after.state.basisCatalogs).length,1);assert.equal(Object.values(after.state.basisCatalogs)[0].items[0].status,'received');assert.equal(after.unchanged,true);
      return {sameDialogRetry:true,failedStateRolledBack:true,saveCalls:after.saves,historyEntries:after.state.history.length};
    }finally{await closeBasisFixture();}
  });
  await record('basis directory project switch during asynchronous binding cannot write into the new project',async()=>{
    await basisFixture();
    try{
      await openPanel();await page.locator('button[onclick="reportEditBasisCatalog(0)"]').click();
      await page.evaluate(()=>{
        window.__basisBindOriginal=ReportCompletionContract.bindBasisCatalog;window.__basisRelease=null;
        ReportCompletionContract.bindBasisCatalog=async(...args)=>{const bound=await __basisBindOriginal(...args);__basisUi.started=true;await new Promise(resolve=>{window.__basisRelease=resolve;});return bound;};
        persistReportDraft=async()=>{__basisUi.saves++;return {ok:true};};
      });
      const modal=page.locator('#reportBasisEditor');await modal.locator('[data-basis-save]').click();await page.waitForFunction(()=>__basisUi.started&&!!__basisRelease);
      const next=await page.evaluate(()=>{currentProjectId='[系统测试]basis-new-project';projectWorkflow=ProjectWorkflow.ensureState({});projectWorkflow.reportCompletion={facts:[],sentinel:'新项目不可覆盖'};const text=JSON.stringify(projectWorkflow);__basisRelease();return text;});
      await page.waitForFunction(()=>!document.querySelector('[data-basis-save]').disabled);
      assert.match(await modal.locator('[data-basis-status]').innerText(),/项目|计划|变化/);assert.equal(await page.evaluate(()=>JSON.stringify(projectWorkflow)),next);assert.equal(await page.evaluate(()=>__basisUi.saves),0);
      return {projectSwitchBlocked:true,saveCalls:0,newProjectUnchanged:true};
    }finally{await closeBasisFixture();}
  });
  await record('basis directory failed pending save rolls back only its captured owner, not a newly opened project',async()=>{
    await basisFixture();
    try{
      await openPanel();await page.locator('button[onclick="reportEditBasisCatalog(0)"]').click();
      const before=await page.evaluate(()=>{window.__basisOldOwner=projectWorkflow;const before=JSON.stringify(projectWorkflow);persistReportDraft=async()=>{__basisUi.saves++;return new Promise(resolve=>{window.__basisSaveRelease=resolve;});};return before;});
      const modal=page.locator('#reportBasisEditor');await modal.locator('[data-basis-save]').click();await page.waitForFunction(()=>!!window.__basisSaveRelease);
      const next=await page.evaluate(()=>{currentProjectId='[系统测试]basis-save-new-project';projectWorkflow=ProjectWorkflow.ensureState({});projectWorkflow.reportCompletion={facts:[],sentinel:'新项目保存状态'};const next=JSON.stringify(projectWorkflow);__basisSaveRelease({ok:false});return next;});
      await page.waitForFunction(()=>!document.querySelector('[data-basis-save]').disabled);
      assert.equal(await page.evaluate(()=>JSON.stringify(projectWorkflow)),next);assert.equal(await page.evaluate(()=>JSON.stringify(__basisOldOwner)),before);assert.equal(await page.evaluate(()=>__basisUi.saves),1);
      return {capturedOwnerRolledBack:true,newProjectUnchanged:true,saveCalls:1};
    }finally{await closeBasisFixture();}
  });
  await record('basis directory research permissions and post-await research identity prevent unauthorized or stale writes',async()=>{
    await basisFixture();
    try{
      await page.evaluate(()=>{window.__basisResearchOriginal=window.ResearchUI;window.ResearchUI={...ResearchUI,active:()=>true,editable:()=>false};});
      const dialogStart=report.dialogs.length;await page.evaluate(()=>reportEditBasisCatalog(0));
      assert.equal(await page.locator('#reportBasisEditor').count(),0);assert.ok(report.dialogs.slice(dialogStart).some(d=>/研究不可编辑/.test(d.message)));
      const before=await page.evaluate(()=>{
        window.__basisResearchToken=1;ResearchUI.editable=()=>true;ResearchUI.capture=()=>({turn:__basisResearchToken});ResearchUI.accepts=guard=>guard.turn===__basisResearchToken;ResearchUI.guard=async()=>new Promise(resolve=>{window.__basisGuardRelease=resolve;});
        persistReportDraft=async()=>{__basisUi.saves++;return {ok:true};};return JSON.stringify(projectWorkflow);
      });
      await page.evaluate(()=>reportEditBasisCatalog(0));const modal=page.locator('#reportBasisEditor');await modal.waitFor();await modal.locator('[data-basis-save]').click();await page.waitForFunction(()=>!!window.__basisGuardRelease);
      await page.evaluate(()=>{__basisResearchToken++;__basisGuardRelease();});await page.waitForFunction(()=>!document.querySelector('[data-basis-save]').disabled);
      assert.match(await modal.locator('[data-basis-status]').innerText(),/项目|计划|变化/);assert.equal(await page.evaluate(()=>JSON.stringify(projectWorkflow)),before);assert.equal(await page.evaluate(()=>__basisUi.saves),0);
      return {readOnlyBlocked:true,postAwaitResearchSwitchBlocked:true,saveCalls:0,workflowUnchanged:true};
    }finally{await closeBasisFixture();}
  });
  await record('actual download button rejects broken table before pagination or file download',async()=>{
    await fixture('brokenTable');
    const before=await page.evaluate(()=>JSON.stringify(chapters)),count=report.dialogs.length;
    await page.locator('#exportWordDraftBtn').click();
    await page.waitForFunction(()=>!document.querySelector('#exportWordDraftBtn').disabled,null,{timeout:30000});
    const dialogs=report.dialogs.slice(count);assert.ok(dialogs.some(d=>/导出失败.*表格/.test(d.message)),JSON.stringify(dialogs));
    assert.equal(await page.evaluate(()=>JSON.stringify(chapters)),before);assert.equal(report.downloads,0);
    assert.equal(report.apiRequests.filter(x=>/pagination/.test(x.path)).length,0);return {dialogs,originalUnchanged:true,downloads:report.downloads};
  });
  await record('cancel noncompliant draft export keeps original and restores button',async()=>{
    await fixture('overlong');const before=await page.evaluate(()=>JSON.stringify(chapters)),count=report.dialogs.length;
    await page.locator('#exportWordDraftBtn').click();await page.waitForFunction(()=>!document.querySelector('#exportWordDraftBtn').disabled);
    const dialogs=report.dialogs.slice(count);assert.ok(dialogs.some(d=>d.type==='confirm'&&/未达标/.test(d.message)));assert.ok(dialogs.some(d=>/已取消.*原报告保留/.test(d.message)));
    assert.equal(await page.evaluate(()=>JSON.stringify(chapters)),before);assert.equal(report.downloads,0);return {dialogs,originalUnchanged:true};
  });
  await fixture('normal');await openPanel();await shot('final-real-page');
  assert.deepEqual(report.pageErrors,[],'new pageerror in actual full-index flow');
  assert.deepEqual(report.consoleErrors,[],'new console error in actual full-index flow');
  assert.equal(report.downloads,0);
  const unexpectedWrites=report.apiRequests.filter(x=>x.method!=='GET'&&!(x.method==='POST'&&x.path==='/api/webresearch'&&['listEvidence','listRequirementRefinements'].includes(x.action))&&!(x.path==='/api/reportexecution'&&x.fixture==='server-blocked'));
  assert.deepEqual(unexpectedWrites,[],'no save/generate request should be attempted in QA; only intercepted read actions are allowed');
  report.storageWritesSuppressed=await page.evaluate(()=>__rootUiStorageWrites);
  report.passed=true;
}catch(error){report.failure={message:error.message,stack:error.stack};try{await shot('failure');}catch{}process.exitCode=1;
}finally{
  report.finishedAt=new Date().toISOString();
  report.boundaries=['Fresh isolated browser only; no login, credentials or user browser storage read.','All API traffic mocked; no database, AI, project-save or successful real export exercised.','Reload test reinjects memory-only fixture; does not claim persistence or authentication restoration.','Mechanical structure checks and screenshots are not semantic fact verification or Word pagination.'];
  await fs.writeFile(path.join(output,'ui-audit.json'),JSON.stringify(report,null,2));
  await browser.close();
  console.log(JSON.stringify({passed:report.passed,tests:report.tests.length,pageErrors:report.pageErrors,output,failure:report.failure?.message}));
}
