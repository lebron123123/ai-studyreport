'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const Workflow=require('../project-workflow.js');
const source=fs.readFileSync(path.join(__dirname,'../aireport.js'),'utf8');
const acceptance=source.slice(source.indexOf('let airAcceptCandidatesBusy='),source.indexOf('function airFallbackSectionLogic('));
const generator=source.slice(source.indexOf('async function airGenerateImpactedCandidates('),source.indexOf('function airSectionMaterialState('));
const generationUi=source.slice(source.indexOf('function airCurrentPartialCandidateBatch('),source.indexOf('async function airRequestFullRegeneration('))
  +source.slice(source.indexOf('function airDeliverHtml('),source.indexOf('async function airDeliverAction('));

function fixture({count=43,blocked=9,locked=0,cancel=false}={}){
  const chapter={cn:'一',name:'[系统测试]运营',checked:true,sections:Array.from({length:count},(_,i)=>({t:'小节'+(i+1),content:'原稿约定须按合同核实，未落实条款不作确定性承诺。'}))};
  const workflow=Workflow.ensureState({});
  Workflow.createReportVersion(workflow,[chapter],{reason:'原版保留'});
  chapter.sections.forEach((s,i)=>{
    const candidate=Workflow.setCandidate(s,'新稿明确运营职责和合同边界，未签署条款仍须经审签后执行。','更新');
    if(i<blocked)candidate.admissionIssues=[{code:'heading-structure-missing',severity:'error',repairable:true,message:'缺少分类标题'+(i+1)},{code:'required-fact-missing',severity:'error',repairable:false,message:'缺少已登记事实'+(i+1)}];
    if(i>=blocked&&i<blocked+locked)s.locked=true;
    Workflow.refreshCandidateQuality(s);
  });
  const alerts=[],confirms=[],context={chapters:[chapter],projectWorkflow:workflow,ProjectWorkflow:Workflow,window:{ProjectWorkflow:Workflow,ReportCompletionContract:{}},
    document:{getElementById:()=>null,querySelector:()=>null},setTimeout,clearTimeout,console,
    alert:message=>alerts.push(message),confirm:message=>{confirms.push(message);return !cancel;},escapeHtml:value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'),
    airCaptureReportMutation:()=>({projectId:'[系统测试]',chapters:context.chapters}),airGuardReportMutation:async()=>{},airCheckReportMutation:()=>{},
    reportCompletionPlan:()=>({planId:'isolated-plan'}),reportReviewCandidate:(_c,s)=>Workflow.refreshCandidateQuality(s),currentReportVersionMeta:reason=>({reason}),
    persistReportDraft:async()=>({ok:true,remote:true}),airSaveState:()=>{},airBuildDocPane:()=>{},
    airExpandedCandidateKeys:new Set(),airCollapsedCandidateKeys:new Set(),airCandidateKey:(c,si)=>c.cn+'_'+si,
    airFindChapterSection:(cn,si)=>String(cn)===String(chapter.cn)?{chapter,section:chapter.sections[si]}:null};
  vm.createContext(context);vm.runInContext(acceptance,context);
  return {context,chapter,workflow,alerts,confirms};
}

test('34/43 部分接受：九节逐项有原因，警告不误拦，原稿与旧版本保留，新快照不冒充整篇完成',async()=>{
  const {context,chapter,workflow,alerts,confirms}=fixture(),previous=JSON.stringify(workflow.reportVersions[0]);
  const blockedBefore=chapter.sections.slice(0,9).map(s=>JSON.stringify(s.pendingRevision));
  const html=context.airCandidateProblemListHtml();
  assert.match(html,/候选问题清单 · 9 节待处理/);
  for(let i=1;i<=9;i++){assert.match(html,new RegExp('缺少分类标题'+i));assert.match(html,new RegExp('缺少已登记事实'+i));}
  await context.airAcceptAllCandidates();
  assert.equal(chapter.sections.filter(s=>s.pendingRevision).length,9);
  assert.equal(chapter.sections.filter(s=>s.content.startsWith('新稿')).length,34);
  assert.deepEqual(chapter.sections.slice(0,9).map(s=>JSON.stringify(s.pendingRevision)),blockedBefore);
  assert.match(confirms[0],/这是部分更新/);assert.match(confirms[0],/其中 34 个仍有待核实项/);
  for(let i=1;i<=9;i++)assert.match(confirms[0],new RegExp('小节'+i+'：缺少分类标题'+i));
  assert.match(alerts.at(-1),/不是整篇新版完成/);
  assert.equal(JSON.stringify(workflow.reportVersions[0]),previous);
  const version=workflow.reportVersions[1];
  assert.match(version.reason,/部分更新.*9 节仍保留旧稿/);
  assert.equal(version.candidateBatchAcceptance.status,'partial');
  assert.equal(version.candidateBatchAcceptance.accepted,34);assert.equal(version.candidateBatchAcceptance.unresolved,9);
  const restored=JSON.parse(JSON.stringify(workflow));assert.equal(restored.reportVersions[1].candidateBatchAcceptance.problems.length,9);
  await context.airAcceptAllCandidates();assert.equal(workflow.reportVersions.length,2);assert.match(alerts.at(-1),/当前没有可接受/);
});

test('取消、全拦截、锁定和空数据均不接受也不建版本，问题不消失',async()=>{
  for(const options of [{cancel:true},{count:3,blocked:3},{count:2,blocked:0,locked:2},{count:0,blocked:0}]){
    const {context,chapter,workflow,alerts}=fixture(options),bodies=chapter.sections.map(s=>s.content);
    await context.airAcceptAllCandidates();
    assert.equal(workflow.reportVersions.length,1);assert.deepEqual(chapter.sections.map(s=>s.content),bodies);
    if(options.locked)assert.match(alerts[0],/已锁定/);
    if(options.count===0)assert.match(alerts[0],/当前没有待确认/);
  }
});

test('问题定位会展开对应候选并加载该节；原因和标题转义，不执行上传文本',()=>{
  const {context,chapter}=fixture({count:1,blocked:1});
  chapter.sections[0].pendingRevision.quality.issues.find(issue=>issue.severity==='error').message='<script>unsafe</script>';
  assert.match(context.airCandidateProblemListHtml(),/&lt;script&gt;unsafe&lt;\/script&gt;/);
  const calls=[],el={scrollIntoView:()=>calls.push('scroll')};
  context.document.getElementById=()=>el;context.airHydratePreviewSection=()=>calls.push('hydrate');context.airRefreshSection=()=>calls.push('refresh');
  context.airLocateCandidateIssue('一',0);assert.deepEqual(calls,['hydrate','refresh','scroll']);assert.equal(context.airExpandedCandidateKeys.has('一_0'),true);
});

test('生成时与当前检查分开显示；只接受成功候选仍标明另有生成失败未完成',async()=>{
  const {context,chapter,workflow,confirms}=fixture({count:3,blocked:1});
  const candidate=chapter.sections[0].pendingRevision;
  candidate.serverQuality={status:'blocked',issues:[{code:'heading-structure-missing',severity:'error',message:'缺少分类标题1'}]};
  chapter.sections[2].pendingRevision=null;
  chapter.sections[2].candidateGenerationFailure={code:'request-timeout',message:'上游请求超时'};
  const html=context.airCandidateProblemListHtml();
  assert.match(html,/生成时检查（原记录保留）/);assert.match(html,/当前检查/);assert.match(html,/本轮生成失败/);
  await context.airAcceptAllCandidates();
  assert.match(confirms[0],/1 节本轮生成失败/);
  assert.equal(workflow.reportVersions[1].candidateBatchAcceptance.status,'partial');
  assert.equal(workflow.reportVersions[1].candidateBatchAcceptance.unresolved,2);
  assert.equal(workflow.reportVersions[1].candidateBatchAcceptance.failed,1);
  assert.equal(chapter.sections[2].candidateGenerationFailure.message,'上游请求超时');
  assert.deepEqual(candidate.serverQuality.issues,[{code:'heading-structure-missing',severity:'error',message:'缺少分类标题1'}]);
});

test('逐节重试真正获得新候选才清除旧调用失败，锁定或已有候选不能假清除',()=>{
  const {context,chapter}=fixture({count:1,blocked:0});
  const section=chapter.sections[0];section.candidateGenerationFailure={message:'旧请求超时'};
  vm.runInContext(source.slice(source.indexOf('function airStoreNewCandidate('),source.indexOf('async function airProposeSectionRevision(')),context);
  assert.throws(()=>context.airStoreNewCandidate({section},'新内容','重试'),/已有待审候选/);
  assert.equal(section.candidateGenerationFailure.message,'旧请求超时');
  section.pendingRevision=null;context.airStoreNewCandidate({section},'新内容','重试');
  assert.equal(section.candidateGenerationFailure,undefined);assert.ok(section.pendingRevision);
});

test('无候选的调用失败可在刷新恢复后看见具体原因，不误称全部生成成功',async()=>{
  const {context,chapter,alerts}=fixture({count:2,blocked:0});
  chapter.sections.forEach(s=>{s.pendingRevision=null;s.syncStatus='stale';s.staleKind='logic';});
  Object.assign(context,{aiReportBusy:false,aiReportImpactedProgress:null,
    airCandidateImpactRows:()=>chapter.sections.map((s,si)=>({c:chapter,s,si})),airReportLogicImpactSummary:()=>({locked:0}),
    runWorkerPool:async(tasks,work)=>{for(const task of tasks)await work(task);},
    reviseSection:async(_c,s)=>{if(s===chapter.sections[1])throw new Error('上游模型请求超时');return '新稿明确合同运营职责，缺项须按原件核实，不作确定性承诺。';},
    reportHasVisibleBody:({content})=>!!content,reportLogicRevision:()=>null,
    airStoreNewCandidate:(info,text,instruction,meta)=>Workflow.setCandidate(info.section,text,instruction,meta),
    saveDraft:()=>{},airRefreshSection:()=>{}});
  vm.runInContext(generator,context);await context.airGenerateImpactedCandidates();
  assert.equal(chapter.sections[0].content.startsWith('原稿'),true);assert.ok(chapter.sections[0].pendingRevision);
  assert.equal(chapter.sections[1].candidateGenerationFailure.message,'上游模型请求超时');
  assert.match(alerts.at(-1),/已生成 1\/2.*1 个失败/);assert.match(alerts.at(-1),/本轮检查：1 个候选可接受/);
  context.chapters=JSON.parse(JSON.stringify([chapter]));assert.match(context.airCandidateProblemListHtml(),/上游模型请求超时/);
});

test('当前正文匹配部分更新快照时说明尚未完成，保留下载与候选入口；重复开始和继续不调用模型',async()=>{
  const {context,workflow}=fixture();
  await context.airAcceptAllCandidates();
  Object.assign(context,{aiReportBusy:false,aiReportProgressMsg:null,reportHasVisibleBody:s=>!!s.content,airCompletedVersionForProgress:()=>null});
  vm.runInContext(generationUi,context);
  const opened=[];context.airOpenExistingReport=message=>opened.push(message);
  const status=context.airReportGenerationStatus();
  assert.equal(status.complete,false);assert.equal(status.bodyComplete,true);assert.equal(status.partialUpdate.unresolved,9);
  for(const html of [context.airGenerationIncompleteHtml(),context.airDeliverHtml()]){
    assert.match(html,/本轮更新尚未完成/);assert.match(html,/9 节仍待处理/);
    assert.match(html,/查看报告并处理剩余候选/);assert.match(html,/data-act="exportWord"/);
    assert.doesNotMatch(html,/当前报告已完整生成|继续生成剩余 0|disabled/);
  }
  for(let i=0;i<5;i++){await context.airResumeGeneration();await context.aiReportStartGenerate();}
  assert.equal(opened.length,10);assert.equal(opened.every(message=>message.includes('本轮更新尚未完成')),true);
  assert.equal(workflow.reportVersions.length,2);assert.equal(context.chapters[0].sections.filter(s=>s.pendingRevision).length,9);
  context.chapters=JSON.parse(JSON.stringify(context.chapters));context.projectWorkflow=JSON.parse(JSON.stringify(workflow));
  assert.equal(context.airReportGenerationStatus().partialUpdate.unresolved,9);
});

test('人工编辑不能掩盖部分更新；接受剩余候选后才能完成，空数据与缺正文状态不变',async()=>{
  const {context,workflow}=fixture({count:2,blocked:1});
  await context.airAcceptAllCandidates();
  Object.assign(context,{aiReportBusy:false,aiReportProgressMsg:null,reportHasVisibleBody:s=>!!s.content,airCompletedVersionForProgress:()=>null});
  vm.runInContext(generationUi,context);
  const original=JSON.stringify(context.chapters);
  const edits=[rows=>{rows[0].sections[0].content+='后续修改';},rows=>{rows[0].sections[0].editedHtml='<p>后来人工修改</p>';},rows=>{rows[0].sections[0].t='新标题';},rows=>{rows[0].checked=false;}];
  for(const edit of edits){
    context.chapters=JSON.parse(original);edit(context.chapters);
    assert.equal(context.airReportGenerationStatus().partialUpdate.unresolved,1);
    assert.equal(context.airReportGenerationStatus().complete,false);
  }
  context.chapters=JSON.parse(original);context.chapters[0].sections[0].locked=true;
  assert.equal(context.airReportGenerationStatus().partialUpdate.unresolved,1);
  context.chapters[0].sections[0].locked=false;
  delete context.chapters[0].sections[0].pendingRevision.admissionIssues;
  assert.ok(Workflow.acceptCandidate(context.chapters[0].sections[0]));
  Workflow.createReportVersion(workflow,context.chapters,{reason:'补齐整篇新版',candidateBatchAcceptance:Workflow.currentCandidateBatchAcceptance(workflow,context.chapters)});
  assert.equal(context.airReportGenerationStatus().partialUpdate,undefined);
  assert.match(context.airGenerationIncompleteHtml(),/当前报告已完整生成/);
  assert.doesNotMatch(context.airDeliverHtml(),/本轮更新尚未完成/);
  context.projectWorkflow=Workflow.ensureState({});
  context.chapters=[];assert.equal(context.airReportGenerationStatus().complete,false);
  context.chapters=[{cn:'一',name:'空稿',sections:[{t:'一节',content:''}]}];
  assert.equal(context.airReportGenerationStatus().remaining,1);
  assert.match(context.airGenerationIncompleteHtml(),/继续生成剩余 1 节/);
});

test('真实页面：34/43 部分更新，九节问题可定位，取消五次、接受与刷新恢复均不丢稿',{timeout:90000},async()=>{
  require('../scripts/windows-browser-lockout-guard.cjs');
  const {chromium}=require('playwright'),browser=await chromium.launch({headless:true}),browserContext=await browser.newContext({serviceWorkers:'block'}),page=await browserContext.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await browserContext.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin!=='http://localhost:8080')return route.abort();
    if(url.pathname.startsWith('/api/'))return route.fulfill({json:{ok:false,error:'[系统测试]API隔离，不读取正式项目'}});
    const file=path.resolve(url.pathname==='/'?'index.html':'.'+decodeURIComponent(url.pathname));
    if(!file.startsWith(process.cwd()+path.sep))return route.abort();
    if(!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
    return route.fulfill({contentType:{'.js':'application/javascript','.mjs':'application/javascript','.html':'text/html','.css':'text/css','.json':'application/json'}[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
  });
  try{
    const mount=async restored=>{
      await page.goto('http://localhost:8080/',{waitUntil:'load'});
      await page.waitForFunction(()=>typeof airAcceptAllCandidates==='function');
      await page.evaluate(restored=>{
        document.getElementById('gate')?.remove();
        currentProjectId='[系统测试]candidate-problems';currentProjectRole='OWNER';getToken=()=> 'isolated';getUser=()=> '[系统测试]';window.ResearchUI=null;
        project.name='[系统测试]部分接受';project.analysisSites=[];calcParams=null;calcResult=null;domainKey='baozhang_gaibao';calcType='gaibao';kbEntries=[];
        appMode='aireport';aiReportHasDoc=true;projectWorkflow=ProjectWorkflow.ensureState({});projectWorkflow.reportCompletion={facts:[]};
        airSaveState=()=>{};airLoadState=()=>{};airRestoreDocPaneIfNeeded=()=>{};persistReportDraft=async()=>({ok:true,remote:true});
        window.__alerts=[];window.__confirms=[];window.__cancel=true;window.alert=message=>__alerts.push(message);window.confirm=message=>{__confirms.push(message);return !__cancel;};
        if(restored){chapters=restored.chapters;projectWorkflow=restored.projectWorkflow;}
        else{
          chapters=[{cn:'一',name:'[系统测试]运营',checked:true,sections:Array.from({length:43},(_,i)=>({t:'条款'+i,content:'原稿边界须按协议核对，未落实条件不作确定性承诺。'}))}];
          const plan=reportCompletionPlan(),inputPlanId=reportCandidateInputIdentity();
          chapters[0].sections.forEach((s,i)=>{
            s.completionContract=plan.sections[i];
            const candidate=ProjectWorkflow.setCandidate(s,'新稿按合同约定落实运营职责，未签署条款须经审签后执行。','修改',{completionInputPlanId:inputPlanId,outputPolicyVersion:ReportOutputPolicy.contentVersion});
            if(i<9){candidate.serverQuality={status:'blocked',factsVerified:false,issues:[{code:'structured-json',severity:'error',message:'生成结构不完整'+i}]};candidate.quality=ProjectWorkflow.clone(candidate.serverQuality);}
          });
          ProjectWorkflow.createReportVersion(projectWorkflow,chapters,{reason:'隔离原稿'});
        }
        document.getElementById('sheet').innerHTML=renderAiReportModule();airBuildDocPane();bindAiReportEvents();airSetDocVisible(true);
      },restored);
    };
    await mount(null);
    assert.equal(await page.locator('.air-candidate-issue-locate').count(),9);
    assert.match(await page.locator('.air-candidate-problems').innerText(),/生成时检查（原记录保留）/);
    await page.locator('.air-candidate-issue-locate').first().click();
    assert.equal(await page.evaluate(()=>airExpandedCandidateKeys.has('一_0')),true);
    const accept=page.locator('.air-doc-accept-candidates');
    for(let i=0;i<5;i++){await accept.click();await page.waitForFunction(()=>!airAcceptCandidatesBusy);}
    assert.equal(await page.evaluate(()=>chapters[0].sections.filter(s=>s.pendingRevision).length),43);
    assert.equal(await page.evaluate(()=>projectWorkflow.reportVersions.length),1);
    await page.evaluate(()=>{__cancel=false;});await accept.click();await page.waitForFunction(()=>!airAcceptCandidatesBusy);
    assert.equal(await page.evaluate(()=>chapters[0].sections.filter(s=>s.pendingRevision).length),9);
    assert.equal(await page.evaluate(()=>chapters[0].sections.filter(s=>s.content.startsWith('新稿')).length),34);
    assert.equal(await page.evaluate(()=>projectWorkflow.reportVersions[1].candidateBatchAcceptance.status),'partial');
    assert.match(await page.evaluate(()=>__alerts.at(-1)),/不是整篇新版完成/);
    await page.evaluate(()=>{
      const card=document.createElement('div');card.id='isolated-delivery';card.style.cssText='position:fixed;inset:0 0 auto auto;width:500px;max-height:100vh;overflow:auto;background:white;z-index:2147483647';card.innerHTML=airDeliverHtml();document.body.append(card);
      window.__opened=[];airOpenExistingReport=message=>__opened.push(message);bindAiReportEvents();
    });
    assert.match(await page.locator('#isolated-delivery').innerText(),/本轮更新尚未完成/);
    assert.equal(await page.locator('#isolated-delivery [data-act="exportWord"]').isEnabled(),true);
    for(let i=0;i<5;i++)await page.locator('#isolated-delivery .air-resume-inline-btn').click();
    assert.equal(await page.evaluate(()=>__opened.length),5);
    assert.equal(await page.evaluate(()=>__opened.every(message=>message.includes('本轮更新尚未完成'))),true);
    const saved=await page.evaluate(()=>JSON.parse(JSON.stringify({chapters,projectWorkflow})));
    await mount(saved);
    assert.equal(await page.locator('.air-candidate-issue-locate').count(),9);
    assert.equal(await page.evaluate(()=>projectWorkflow.reportVersions[1].candidateBatchAcceptance.unresolved),9);
    assert.equal(await page.evaluate(()=>chapters[0].sections.filter(s=>s.content.startsWith('新稿')).length),34);
    assert.equal(await page.evaluate(()=>airReportGenerationStatus().partialUpdate.unresolved),9);
    assert.match(await page.evaluate(()=>airGenerationIncompleteHtml()),/本轮更新尚未完成/);
    assert.deepEqual(errors,[]);
  }finally{await browserContext.close();await browser.close();}
});
