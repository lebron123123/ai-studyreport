// Real index, production delegated toolbar and IDB, isolated browser/profile and API.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
test('真实工具栏：35稿核查/慢保存/重复点击/失败重试/三次刷新，候选和版本不丢失',{timeout:90000},async()=>{
  const browser=await chromium.launch({headless:true}),context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin!=='http://localhost:8080')return route.abort();
    if(url.pathname.startsWith('/api/'))return route.fulfill({json:{ok:false,error:'[系统测试]API隔离，无正式数据'}});
    const file=path.resolve(url.pathname==='/'?'index.html':'.'+decodeURIComponent(url.pathname));
    if(!file.startsWith(process.cwd()+path.sep))return route.abort();
    if(!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
    const type={'.js':'application/javascript','.mjs':'application/javascript','.html':'text/html','.css':'text/css','.json':'application/json'}[path.extname(file)]||'application/octet-stream';
    return route.fulfill({contentType:type,body:fs.readFileSync(file)});
  });
  try{
    async function mount(restore=false){
      await page.goto('http://localhost:8080/',{waitUntil:'load'});
      await page.waitForFunction(()=>typeof airAcceptAllCandidates==='function'&&typeof reportCompletionPlan==='function');
      await page.evaluate(async restore=>{
        document.getElementById('gate')?.remove();
        currentProjectId='[系统测试]batch-accept-ui';currentProjectRole='OWNER';getToken=()=> 'isolated';getUser=()=> '[系统测试]';
        window.ResearchUI=null;
        project.name='[系统测试]批量确认';project.analysisSites=[];calcParams=null;calcResult=null;domainKey='baozhang_gaibao';calcType='gaibao';kbEntries=[];
        appMode='aireport';aiReportHasDoc=true;
        reportDraftStoreKey=()=> '[系统测试]batch-accept-ui';scheduleCloudSave=()=>{};
        const nativeSet=Storage.prototype.setItem;
        Storage.prototype.setItem=function(key,value){if(key===DRAFT_KEY)throw new DOMException('隔离配额不足','QuotaExceededError');return nativeSet.call(this,key,value);};
        window.alert=msg=>{window.__batchAlert=msg;};window.confirm=()=>!window.__cancel;
        airSaveState=()=>{};airLoadState=()=>{};airRestoreDocPaneIfNeeded=()=>{};
        if(restore){restoreDraft(await loadDurableDraft());}
        else{
          projectWorkflow=ProjectWorkflow.ensureState({});projectWorkflow.reportCompletion={facts:[]};
          chapters=[{cn:'一',name:'[系统测试]运营',checked:true,sections:Array.from({length:35},(_,i)=>({t:'条款'+i,content:'原稿边界须按协议核对，未落实条件不作确定性承诺。',syncStatus:'stale',staleKind:'logic'}))}];
          const plan=reportCompletionPlan();
          const inputPlanId=reportCandidateInputIdentity();
          chapters[0].sections.forEach((s,i)=>{s.completionContract=plan.sections[i];ProjectWorkflow.setCandidate(s,'新稿按合同约定落实运营职责，未签署条款须经审签后执行。','修改',{completionInputPlanId:inputPlanId,outputPolicyVersion:ReportOutputPolicy.contentVersion});});
          ProjectWorkflow.createReportVersion(projectWorkflow,chapters,{reason:'隔离原稿'});
          await saveDraft();await reportLocalSavePending;
        }
        document.getElementById('sheet').innerHTML=renderAiReportModule();
        airBuildDocPane();bindAiReportEvents();airSetDocVisible(true);
        window.__persistOriginal=persistReportDraft;
      },restore);
    }
    await mount();
    // Pending candidates themselves also survive a reload before acceptance.
    await mount(true);
    assert.equal(await page.evaluate(()=>chapters[0].sections.filter(s=>s.pendingRevision).length),35);
    assert.equal(await page.evaluate(()=>projectWorkflow.reportVersions.length),1);
    const accept=page.locator('.air-doc-accept-candidates');
    assert.match(await accept.innerText(),/35/);
    // Cancel retains all 35 candidates, then the same delegated button remains usable.
    await page.evaluate(()=>{window.__cancel=true;});await accept.click();
    await page.waitForFunction(()=>!airAcceptCandidatesBusy);
    assert.equal(await page.evaluate(()=>chapters[0].sections.filter(s=>s.pendingRevision).length),35);
    await page.evaluate(()=>{
      window.__cancel=false;window.__renders=0;window.__plans=0;
      const draw=airBuildDocPane,plan=reportCompletionPlan;
      airBuildDocPane=()=>{window.__renders++;draw();};reportCompletionPlan=()=>{window.__plans++;return plan();};
      persistReportDraft=()=>new Promise(resolve=>{window.__release=()=>resolve({ok:true,remote:true});});
    });
    await accept.click();
    await page.waitForFunction(()=>!!window.__release);
    assert.match(await page.locator('.air-accept-progress').innerText(),/已接受 35.*正在保存/);
    assert.equal(await page.locator('.air-doc-accept-candidates').count(),0);
    assert.equal(await page.evaluate(()=>__renders),1);
    // Redraw itself also reviews the report; batch quality plan work stays bounded.
    assert.ok(await page.evaluate(()=>__plans)<8);
    await page.evaluate(()=>airAcceptAllCandidates());
    assert.equal(await page.evaluate(()=>projectWorkflow.reportVersions.length),2);
    await page.evaluate(()=>__release());await page.waitForFunction(()=>!airAcceptCandidatesBusy);
    assert.match(await page.locator('.air-accept-progress').innerText(),/项目库已保存/);
    // Use real durable saving before refreshing, not the simulated acknowledgement.
    assert.equal(await page.evaluate(async()=>{persistReportDraft=__persistOriginal;return (await persistReportDraft()).local;}),true);
    for(let i=0;i<3;i++){
      await mount(true);
      assert.equal(await page.evaluate(()=>chapters[0].sections.filter(s=>s.pendingRevision).length),0);
      assert.equal(await page.evaluate(()=>chapters[0].sections.filter(s=>s.content.startsWith('新稿')).length),35);
      assert.equal(await page.evaluate(()=>projectWorkflow.reportVersions.length),2);
      assert.equal(await page.locator('.air-doc-accept-candidates').count(),0);
    }
    // Failure then real retry: no repeated acceptance and no extra version.
    await page.evaluate(()=>{
      const s=chapters[0].sections[0];ProjectWorkflow.setCandidate(s,'新稿明确合同运营职责，缺项须保留待核实状态。','修改',{completionInputPlanId:reportCandidateInputIdentity(),outputPolicyVersion:ReportOutputPolicy.contentVersion});airBuildDocPane();
      persistReportDraft=async()=>({ok:false,local:false,remote:false});
    });
    await page.locator('.air-doc-accept-candidates').click();await page.waitForFunction(()=>!airAcceptCandidatesBusy);
    assert.match(await page.locator('.air-accept-progress').innerText(),/尚未保存成功.*请勿刷新/);
    assert.match(await page.evaluate(()=>__batchAlert),/均未保存成功/);
    assert.equal(await page.evaluate(async()=>{persistReportDraft=__persistOriginal;return (await persistReportDraft()).local;}),true);
    await mount(true);assert.equal(await page.evaluate(()=>projectWorkflow.reportVersions.length),3);
    assert.equal(await page.evaluate(()=>chapters[0].sections.filter(s=>s.pendingRevision).length),0);
    await page.evaluate(()=>{chapters=[];airBuildDocPane();});
    assert.equal(await page.locator('.air-doc-accept-candidates').count(),0);
    assert.deepEqual(errors,[]);
    await page.evaluate(()=>reportDraftStore('delete',reportDraftStoreKey()));
  }finally{await context.close();await browser.close();}
});
