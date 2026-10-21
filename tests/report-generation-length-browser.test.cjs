const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
require('../scripts/windows-browser-lockout-guard.cjs');
const {chromium}=require('playwright');
async function seed(page,render=true){
  await page.evaluate(render=>{
    document.getElementById('gate')?.remove();window.ResearchUI=null;currentProjectId='[系统测试]篇幅入口';currentProjectRole='OWNER';getToken=()=> 'isolated';getUser=()=> '[系统测试]用户';projectCanEdit=()=>true;
    Object.assign(project,{name:'[系统测试]完整入口',businessScenario:'housing_conversion',analysisSites:[]});calcType='gaibao';rptCtype='gaibao';calcParams={};calcResult=null;kbEntries=[];domainKey='baozhang_gaibao';appMode='aireport';
    aiReportExtracted={projectName:project.name,businessScenario:'housing_conversion'};aiReportSuggested={calcType:'gaibao'};aiReportCalculationMode='full';aiReportParamsConfirmed=true;aiReportBusy=false;aiReportChat=[];aiReportHasDoc=true;aiReportProgressMsg=null;
    chapters=Array.from({length:3},(_,i)=>({cn:['一','二','三'][i],name:['运营方案','市场论证','实施保障'][i],checked:true,sections:Array.from({length:8},(_,j)=>({t:'专项分析'+i+'-'+j,content:'[系统测试]原工作稿 '+i+'-'+j}))}));
    chapters[2].sections[7].locked=true;
    projectWorkflow=ProjectWorkflow.ensureState({});projectWorkflow.reportVersions=[{id:'[系统测试]V9',version:9,chapters:JSON.parse(JSON.stringify(chapters))}];projectWorkflow.reportCompletion={facts:[],budgets:{'运营方案 / 专项分析0-0':{proseTarget:400,proseMax:600,tableMax:4,reason:'旧人工审签'}}};
    window.__models=[];window.__saves=0;window.__result='idle';window.__alerts=[];alert=message=>__alerts.push(String(message));
    saveDraft=()=>{__saves++;};scheduleCloudSave=()=>{};airSaveState=async()=>{};airSaveLocalState=()=>{};persistReportDraft=async()=>{__saves++;return {ok:true,remote:true};};flushCloudSave=async()=>{};
    fetchOutlines=async()=>{};ReportLogicCore.load=async()=>{};ReportLogicCore.current=()=>({data:{}});ReportLogicCore.match=()=>[];ReportLogicCore.outline=()=>({label:'[系统测试]目录',chapters:JSON.parse(JSON.stringify(chapters))});
    // Keep the real entry, length modal, completion plan, contract check and pool;
    // isolate unrelated evidence/catalog providers and all paid model requests.
    reportCompletionFacts=()=>[];sectionFormalTemplates=()=>[];reportCompletionEntries=()=>[];
    // This compatibility case deliberately returns tiny mocked drafts and tests
    // the manual short-draft/retry/refresh path, not automatic first delivery.
    // Keep that capability inactive rather than sending those mocks through the
    // real repair/pagination adapters. The full runtime and real entry/DOM path
    // are exercised in report-initial-delivery-{runtime,entry}.test.cjs.
    window.ReportInitialDeliveryRuntime={start:async options=>({active:false,tasks:options.tasks}),finish:async()=>({active:false,complete:false}),status:()=>({active:false,complete:false}),accepts:()=>false};
    generateSection=async(chapter,section)=>{const plan=reportCompletionPlan(),contract=plan.sections.find(s=>s.sectionKey===chapter.name+' / '+section.t);__models.push({key:contract.sectionKey,target:contract.requirements.proseTarget,total:plan.proseTotal,planId:plan.planId});if(window.__failKey===contract.sectionKey){window.__failKey=null;const error=new Error('[系统测试]额度响应失败，稍后仅重试本节');error.code='model-quota';throw error;}return '本项目 '+section.t+' 按职责落实运营和风险控制。对执行条件、履行顺序及现金流影响分别核对，不编造数据。';};
    if(render){document.getElementById('sheet').innerHTML=renderAiReportModule();bindAiReportEvents();airBuildDocPane();airSetDocVisible(true);}
  },render);
}
async function begin(page){await page.evaluate(()=>{
  // Match aiReportStartGenerate's lock lifecycle while retaining the internal
  // cancellation/error result for assertions; never bypass the backup identity.
  const claim=ProjectWorkflow.claimReportGeneration(projectWorkflow,chapters,{force:true});
  if(!claim.ok)throw new Error('[系统测试]无法取得生成锁');
  aiReportGenerationLockId=claim.lock.id;__result='pending';
  window.__work=aiReportRunGenerate({force:true}).then(value=>{__result=value===false?'cancelled':'complete';}).catch(error=>{__result='error:'+error.message;}).finally(()=>{
    ProjectWorkflow.releaseReportGeneration(projectWorkflow,aiReportGenerationLockId,'incomplete');aiReportGenerationLockId=null;
  });
});}
test('完整 index 的Runtime停用兼容入口：短稿不假完成、补足可取消、失败单节重试、刷新恢复',{timeout:120000},async()=>{
  const browser=await chromium.launch({headless:true}),context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage(),errors=[],modelRequests=[];
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());if(url.origin!=='http://localhost:8080')return route.abort();
    if(url.pathname.startsWith('/api/')){if(/generate|reportexecution/.test(url.pathname))modelRequests.push(url.pathname);if(url.pathname==='/api/aireport'&&route.request().method()==='GET')return route.fulfill({json:{ok:true,state:null}});return route.fulfill({json:{ok:false,error:'[系统测试]API隔离'}});}
    const file=path.resolve(url.pathname==='/'?'index.html':'.'+decodeURIComponent(url.pathname));
    if(!file.startsWith(process.cwd()+path.sep))return route.abort();
    if(!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
    await route.fulfill({contentType:{'.js':'application/javascript','.mjs':'application/javascript','.html':'text/html','.css':'text/css'}[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
  });
  try{
    await page.goto('http://localhost:8080/',{waitUntil:'load'});await page.waitForFunction(()=>typeof aiReportRunGenerate==='function'&&!!ReportLengthUI&&!!ReportBusinessStructure);await seed(page);
    const before=await page.evaluate(()=>JSON.stringify({chapters,versions:projectWorkflow.reportVersions}));await begin(page);await page.locator('#reportLengthPlanModal').waitFor();
    assert.equal(await page.locator('#reportLengthPages').inputValue(),'120');assert.equal(await page.locator('#reportLengthWords').inputValue(),'84500');assert.equal(await page.locator('[data-length-chapters] tr').count(),3);await page.locator('[data-length-close]').last().click();await page.waitForFunction(()=>__result==='cancelled');
    assert.equal(await page.evaluate(()=>JSON.stringify({chapters,versions:projectWorkflow.reportVersions})),before);assert.equal(await page.evaluate(()=>__models.length),0);assert.equal(await page.evaluate(()=>__saves),0);
    await begin(page);await page.locator('#reportLengthPlanModal').waitFor();assert.equal(await page.locator('[data-length-confirm]').isDisabled(),true);assert.match(await page.locator('[data-length-legacy]').innerText(),/旧人工正文预算/);
    await page.locator('#reportLengthPages').fill('30');await page.locator('#reportLengthPages').dispatchEvent('change');await page.locator('#reportLengthWords').fill('15000');await page.locator('#reportLengthWords').dispatchEvent('change');await page.locator('[data-length-budget-ack]').check();await page.locator('[data-length-confirm]').click();await page.waitForFunction(()=>__result!=='pending');
    const generated=await page.evaluate(()=>({result:__result,models:__models,chapters,versions:projectWorkflow.reportVersions,plan:projectWorkflow.reportCompletion.lengthPlan,budgets:projectWorkflow.reportCompletion.budgets,progress:aiReportProgressMsg,coverage:airReportGenerationStatus(),lengthSummary:document.querySelector('.air-length-delivery > summary')?.textContent,chat:aiReportChat}));
    assert.equal(generated.result,'complete');assert.equal(generated.models.length,23);assert.ok(generated.models.every(model=>model.total===15000));assert.equal(generated.models[0].target,generated.plan.sections[0].target);assert.notEqual(generated.models[0].target,400);
    assert.equal(generated.plan.targetPages,30);assert.equal(generated.budgets['运营方案 / 专项分析0-0'].proseTarget,400);assert.equal(generated.budgets['运营方案 / 专项分析0-0'].tableMax,4);assert.equal(generated.chapters[2].sections[7].content,'[系统测试]原工作稿 2-7');
    assert.ok(generated.chapters.flatMap(c=>c.sections).every(s=>!s.pendingRevision));assert.equal(generated.progress.failed,0);assert.match(generated.chapters[0].sections[0].content,/按职责落实运营/);assert.equal(generated.versions[0].chapters[0].sections[0].content,'[系统测试]原工作稿 0-0');assert.equal(generated.versions[1].chapters[0].sections[0].content,'[系统测试]原工作稿 0-0');
    assert.equal(generated.coverage.bodyComplete,true);assert.equal(generated.coverage.complete,false);assert.equal(generated.coverage.lengthDelivery.status,'short');assert.equal(generated.coverage.lengthDelivery.target,15000);assert.ok(generated.coverage.lengthDelivery.actual<generated.coverage.lengthDelivery.min);assert.equal(generated.progress.stopped,true);
    assert.ok(generated.chat.some(message=>message.kind==='generationIncomplete'&&/不能算按要求完成/.test(message.content)));assert.ok(!generated.chat.some(message=>/可研报告已经生成啦|当前报告已完整生成/.test(message.content||'')));assert.match(await page.locator('.air-deliver-card').last().innerText(),/正文已保存，还没达到确认篇幅/);assert.doesNotMatch(await page.locator('.air-progress-text').last().innerText(),/本轮生成已完成/);
    assert.equal(generated.lengthSummary,'篇幅核对 · '+generated.coverage.lengthDelivery.actual+' / 15000 字');
    const stage=generated.versions.at(-1);assert.equal(stage.lengthDelivery.status,'short');assert.equal(stage.lengthDelivery.actual,generated.coverage.lengthDelivery.actual);assert.match(stage.reason,/尚未达到确认篇幅/);assert.notEqual(await page.evaluate(id=>ProjectWorkflow.latestCompleteReportVersion(projectWorkflow,id)?.id,stage.id),stage.id);
    // Explicit supplement opens a paid-action confirmation; cancellation must
    // preserve the entire draft and make neither a model call nor an API call.
    const beforeFill=await page.evaluate(()=>JSON.stringify({chapters,versions:projectWorkflow.reportVersions,models:__models}));
    const dialog=page.waitForEvent('dialog');const click=page.locator('.air-length-fill').click();const confirmation=await dialog;assert.equal(confirmation.type(),'confirm');assert.match(confirmation.message(),/篇幅不足小节.*会调用AI/);await confirmation.dismiss();await click;
    assert.equal(await page.evaluate(()=>JSON.stringify({chapters,versions:projectWorkflow.reportVersions,models:__models})),beforeFill);assert.equal(await page.evaluate(()=>aiReportImpactedProgress?.active||false),false);
    // A persisted failure must remain actionable after the whole preview is rebuilt.
    // Exercise a real rejected model result, then click only that section's retry.
    await page.evaluate(async()=>{window.__otherSections=JSON.stringify(chapters.flatMap(c=>c.sections).slice(1));chapters[0].sections[0].content='';window.__failKey='运营方案 / 专项分析0-0';await airRetrySection('一',0);airBuildDocPane();});
    assert.equal(await page.evaluate(()=>chapters[0].sections[0].generationFailure.code),'model-quota');assert.equal(await page.locator('.air-doc-version-select').inputValue(),'current');await page.locator('#sec_一_0').scrollIntoViewIfNeeded();assert.match(await page.locator('#sec_一_0 .body').innerText(),/额度响应失败/);assert.equal(await page.locator('#sec_一_0').getAttribute('data-status'),'failed');await page.locator('#sec_一_0 .air-retry-btn').click();await page.waitForFunction(()=>!chapters[0].sections[0].generationFailure&&chapters[0].sections[0].content.includes('按职责落实运营'));assert.equal(await page.evaluate(()=>__models.length),25);assert.equal(await page.evaluate(()=>JSON.stringify(chapters.flatMap(c=>c.sections).slice(1))===__otherSections),true);
    assert.equal(await page.locator('.air-length-delivery > summary').innerText(),'篇幅核对 · '+await page.evaluate(()=>airReportLengthDelivery().actual)+' / 15000 字');
    // Use the public force-regeneration request: it rejects existing candidates
    // before the newly mandatory force-plan reconfirmation dialog can open.
    await page.evaluate(async()=>{chapters[0].sections[0].pendingRevision={after:'[系统测试]已有候选'};window.__candidateBefore=JSON.stringify(chapters);await airRequestFullRegeneration();});assert.match(await page.evaluate(()=>__alerts.at(-1)),/已有候选稿/);assert.equal(await page.locator('#reportLengthPlanModal').count(),0);assert.equal(await page.evaluate(()=>JSON.stringify(chapters)===__candidateBefore),true);assert.equal(await page.evaluate(()=>__models.length),25);
    // Use the real chunked IndexedDB store inside this disposable browser,
    // never the user's browser profile or the live project's server data.
    const persisted=await page.evaluate(async()=>{
      chapters[1].sections[0].content+='补充已经确认的职责边界和落实顺序。';
      chapters[0].sections[0].pendingRevision.after='未接受候选分析'.repeat(3000);
      const draft=buildDraftData(),session=airSerializableState(),delivery=airReportLengthDelivery();
      await reportDraftStore('put',reportDraftStoreKey(),draft);await reportDraftStore('put','ai/'+airLocalStateKey(),session);
      return {plan:projectWorkflow.reportCompletion.lengthPlan,chapters:JSON.stringify(draft.chapters),actual:delivery.actual,versionIds:projectWorkflow.reportVersions.map(version=>version.id),latestCompleteId:ProjectWorkflow.latestCompleteReportVersion(projectWorkflow)?.id};
    });
    assert.ok(persisted.actual>generated.coverage.lengthDelivery.actual);assert.ok(persisted.actual<15000);
    await page.reload({waitUntil:'load'});await page.waitForFunction(()=>typeof aiReportRunGenerate==='function'&&!!ReportLengthUI&&!!ReportBusinessStructure&&!!ReportCompletionContract);await seed(page,false);
    await page.evaluate(async()=>{
      const draft=await loadDurableDraft();if(!draft)throw Error('[系统测试]刷新后本机原稿缺失');
      restoreDraft(draft,{deferRender:true});aiReportChat=[];aiReportChatLoaded=false;aiReportExtracted=null;aiReportSuggested=null;aiReportProgressMsg=null;
      document.getElementById('sheet').innerHTML=renderAiReportModule();await airLoadState();bindAiReportEvents();await airRestoreDocPaneIfNeeded();
    });
    const restored=await page.evaluate(()=>({plan:projectWorkflow.reportCompletion.lengthPlan,chapters:JSON.stringify(buildDraftData().chapters),coverage:airReportGenerationStatus(),versionIds:projectWorkflow.reportVersions.map(version=>version.id),latestCompleteId:ProjectWorkflow.latestCompleteReportVersion(projectWorkflow)?.id,models:__models.length}));
    assert.deepEqual(restored.plan,persisted.plan);assert.equal(restored.chapters,persisted.chapters);assert.equal(restored.coverage.lengthDelivery.actual,persisted.actual);assert.equal(restored.coverage.lengthDelivery.status,'short');assert.equal(restored.coverage.complete,false);assert.deepEqual(restored.versionIds,persisted.versionIds);assert.equal(restored.latestCompleteId,persisted.latestCompleteId);assert.equal(restored.models,0);
    assert.equal(await page.locator('.air-length-delivery > summary').innerText(),'篇幅核对 · '+persisted.actual+' / 15000 字');assert.match(await page.locator('.air-deliver-card').last().innerText(),/正文已保存，还没达到确认篇幅/);assert.doesNotMatch(await page.locator('#airMsgs').innerText(),/当前报告已完整生成|可研报告已经生成啦/);assert.doesNotMatch(await page.locator('.air-progress-text').last().innerText(),/本轮生成已完成/);
    assert.deepEqual(modelRequests,[]);assert.deepEqual(errors,[]);
  }finally{await context.close();await browser.close();}
});
