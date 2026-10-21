const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
// Always guard the isolated bundled Chromium launch, even when this file is run directly.
require('../scripts/windows-browser-lockout-guard.cjs');
const {chromium}=require('playwright');

const before='### 一、租赁安排\n\n[系统测试]原正文：租赁合同应当核对收楼条件、维护责任与结算方式。\n\n#### （一）执行条件\n\n保留现有论证及项目事实。\n\n原正文完整末尾。';
const after='### 一、租赁安排\n\n[系统测试]候选正文：核查租赁责任边界，并对退出、争议解决与维修义务形成完整分析。\n\n#### （一）执行条件\n\n在合同确认后开展租赁业务；合同未确认时保留风险。\n\n候选正文完整末尾。';
const repaired=after.replace('核查租赁责任边界','加强核查租赁责任边界，补充风险应对');
const serverIssue='[系统测试]服务端发现租赁责任论证尚需补充（不可仅由文本重新推断）。';
const instruction='加强租赁责任风险论证，保留现有标题、表格及完整分析，不压缩为摘要。';

async function mount(page,snapshot=null){
  await page.evaluate(({before,after,serverIssue,snapshot})=>{
    document.getElementById('gate')?.remove();
    currentProjectId='[系统测试]repair-participation';currentProjectRole='OWNER';getToken=()=> 'isolated';getUser=()=> '[系统测试]';window.ResearchUI=null;projectCanEdit=()=>true;
    project.name='[系统测试]返修参与验收';project.analysisSites=[];calcParams=null;calcResult=null;calcType='gaibao';domainKey='baozhang_gaibao';kbEntries=[];
    appMode='aireport';aiReportHasDoc=true;scheduleCloudSave=()=>{};airSaveState=()=>{};airLoadState=()=>{};airRestoreDocPaneIfNeeded=()=>{};
    window.__calls=[];window.__alerts=[];window.__saves=0;window.__confirmed=0;window.__release=null;
    confirm=()=>{window.__confirmed++;return true;};alert=message=>window.__alerts.push(String(message));
    saveDraft=()=>window.__saves++;persistReportDraft=async()=>{window.__saves++;return {ok:true};};
    projectWorkflow=ProjectWorkflow.ensureState({});projectWorkflow.reportCompletion={facts:[]};
    const contract={version:ReportCompletionContract.VERSION,planId:'[系统测试]repair',sectionKey:'经营方案 / 租赁条款',requirements:{proseTarget:50,proseMax:10000,tableMax:10,tableRowsMax:100,cellCharsMax:2000}};
    reportSectionContract=()=>contract;
    chapters=snapshot||[{cn:'一',name:'经营方案',checked:true,sections:[{t:'租赁条款',content:before,completionContract:contract}]}];
    if(!snapshot){
      const candidate=ProjectWorkflow.setCandidate(chapters[0].sections[0],after,'[系统测试]首轮完整候选',{completionInputPlanId:reportCandidateInputIdentity(),outputPolicyVersion:ReportOutputPolicy.contentVersion});
      // Deliberately not a structured-* issue: only reportReviewCandidate's server receipt merge can retain it.
      candidate.serverQuality={status:'blocked',factsVerified:false,issues:[{code:'server-depth-check',severity:'error',repairable:true,message:serverIssue}]};
    }
    airExpandedCandidateKeys.clear();airCollapsedCandidateKeys.clear();
    reportDurableSectionCall=(...args)=>{
      window.__calls.push({instruction:args[2],source:args[3],candidateId:args[5]?.candidateRepair?.id});
      return new Promise((resolve,reject)=>{window.__release=({mode,text})=>{
        if(mode==='error')return reject(Error('[系统测试]模型暂不可用'));
        ProjectWorkflow.rememberGeneratedContract(chapters[0].sections[0],text,contract,{completionInputPlanId:reportCandidateInputIdentity()});
        if(mode==='blocked'){
          const error=Error('[系统测试]新候选仍需核对');Object.assign(error,{code:'REPORT_CANDIDATE_QUALITY_BLOCKED',candidateText:text,candidateContract:contract,resultQuality:{status:'blocked',factsVerified:false,issues:[{code:'server-depth-check',severity:'error',repairable:true,message:serverIssue}]}});return reject(error);
        }
        resolve(text);
      };});
    };
    document.getElementById('sheet').innerHTML=renderAiReportModule();airBuildDocPane();bindAiReportEvents();airSetDocVisible(true);
  },{before,after,serverIssue,snapshot});
  await page.locator('#airDocPane .air-section-candidate').waitFor({state:'visible'});
}

async function assertFullCandidate(page,expected=after){
  const candidate=page.locator('#airDocPane .air-section-candidate');
  assert.equal(await candidate.locator('.air-candidate-preview-toggle').getAttribute('aria-expanded'),'true');
  assert.equal(await candidate.locator('.wf-diff-old').textContent(),before);
  assert.equal(await candidate.locator('.wf-diff-new').textContent(),expected);
  assert.ok((await candidate.innerText()).includes(serverIssue));
  assert.equal(await candidate.locator('.air-candidate-accept').isDisabled(),true);
  const expectedMetrics=await page.evaluate(()=>{const c=chapters[0].sections[0].pendingRevision;return {before:ReportCompletionContract.measure(c.before).proseCharacters,after:ReportCompletionContract.measure(c.after).proseCharacters};});
  assert.match(await candidate.locator('.air-candidate-metrics').innerText(),new RegExp('修改前正文 '+expectedMetrics.before+' 字 · 候选正文 '+expectedMetrics.after+' 字'));
}

async function startOnce(page){
  const candidate=page.locator('#airDocPane .air-section-candidate');
  const input=candidate.locator('.air-candidate-repair-instruction');await input.fill(instruction);
  assert.equal(await input.inputValue(),instruction);
  await candidate.getByRole('button',{name:'按上述要求返修一次（保留旧候选）',exact:true}).click();
  await page.waitForFunction(()=>window.__calls.length===1&&typeof window.__release==='function');
  assert.equal(await input.isDisabled(),true);
  assert.equal(await candidate.getByRole('button',{name:'正在按要求返修一次，原候选保留…',exact:true}).isDisabled(),true);
  // Real DOM repeated clicks both before and after production re-rendering must not submit another request.
  await page.evaluate(()=>{
    for(let i=0;i<5;i++)document.querySelector('.air-section-candidate button[onclick]')?.click();
    airRefreshSection('一',0);
    for(let i=0;i<5;i++)document.querySelector('.air-section-candidate button[onclick]')?.click();
  });
  assert.equal(await page.evaluate(()=>__calls.length),1);
  const request=await page.evaluate(()=>__calls[0]);
  assert.ok(request.instruction.includes(instruction));assert.match(request.instruction,/不把完整分析改成短摘要/);
  assert.ok(request.source.includes(after));assert.equal(await page.evaluate(()=>__confirmed),1);
}

test('隔离安全 Chromium：生产候选 DOM 正常/错误/空数据/刷新各 5 次及未通过返修保留',{timeout:90000},async t=>{
  if(process.platform==='win32')assert.equal(chromium.__nrWindowsLockoutGuard,true);
  const browser=await chromium.launch({headless:true}),context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage(),errors=[],apiRequests=[],externalRequests=[];
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin!=='http://localhost:8080'){externalRequests.push(url.origin);return route.abort();}
    if(url.pathname.startsWith('/api/')){apiRequests.push({method:route.request().method(),path:url.pathname});return route.fulfill({json:{ok:false,error:'[系统测试]完全隔离，未访问真实项目'}});}
    const file=path.resolve(url.pathname==='/'?'index.html':'.'+decodeURIComponent(url.pathname));
    if(!file.startsWith(process.cwd()+path.sep))return route.abort();
    if(!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
    return route.fulfill({contentType:{'.js':'application/javascript','.mjs':'application/javascript','.html':'text/html','.css':'text/css'}[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
  });
  try{
    await page.goto('http://localhost:8080/',{waitUntil:'load'});
    await page.waitForFunction(()=>typeof airRepairCandidate==='function'&&typeof reportReviewCandidate==='function');
    await t.test('正常态 5 次：前后全文、指令可编辑、只返修一次、历史保留、不自动接受',async()=>{
      for(let i=0;i<5;i++){
        await mount(page);await assertFullCandidate(page);
        const toggle=page.locator('#airDocPane .air-candidate-preview-toggle');await toggle.click();assert.equal(await page.locator('#airDocPane .wf-diff-cols').count(),0);await toggle.click();await assertFullCandidate(page);
        await startOnce(page);await page.evaluate(text=>__release({mode:'ok',text}),repaired);
        await page.waitForFunction(text=>chapters[0].sections[0].pendingRevision.after===text&&!airCandidateRepairsInFlight.has(chapters[0].sections[0].pendingRevision),repaired);
        const state=await page.evaluate(()=>({content:chapters[0].sections[0].content,candidate:chapters[0].sections[0].pendingRevision,calls:__calls.length,alerts:__alerts}));
        assert.equal(state.content,before);assert.equal(state.candidate.after,repaired);assert.equal(state.candidate.history[0].after,after);assert.equal(state.calls,1);assert.deepEqual(state.alerts,[]);
        assert.equal(await page.locator('#airDocPane .air-section-candidate').count(),1);
      }
    });
    await t.test('失败态 5 次：模型失败后原候选全文、问题、可操作按钮均保留',async()=>{
      for(let i=0;i<5;i++){
        await mount(page);const id=await page.evaluate(()=>chapters[0].sections[0].pendingRevision.id);await startOnce(page);
        await page.evaluate(()=>__release({mode:'error'}));await page.waitForFunction(()=>__alerts.length===1);
        await assertFullCandidate(page);assert.match(await page.locator('#airDocPane .air-section-candidate [role=alert]').innerText(),/模型暂不可用/);
        assert.equal(await page.locator('#airDocPane .air-candidate-repair-instruction').isDisabled(),false);
        assert.equal(await page.locator('#airDocPane .air-section-candidate').getByRole('button',{name:'按上述要求返修一次（保留旧候选）',exact:true}).isDisabled(),false);
        assert.deepEqual(await page.evaluate(()=>({id:chapters[0].sections[0].pendingRevision.id,content:chapters[0].sections[0].content,calls:__calls.length})),{id,content:before,calls:1});
      }
    });
    await t.test('空数据态 5 次：无候选无返修入口，空指令不提交',async()=>{
      for(let i=0;i<5;i++){
        await mount(page);await page.locator('#airDocPane .air-candidate-repair-instruction').fill('   ');
        await page.locator('#airDocPane .air-section-candidate').getByRole('button',{name:'按上述要求返修一次（保留旧候选）',exact:true}).click();
        assert.equal(await page.evaluate(()=>__calls.length),0);assert.match(await page.evaluate(()=>__alerts.at(-1)),/请填写本次修订要求/);
        await page.evaluate(()=>{delete chapters[0].sections[0].pendingRevision;chapters[0].sections[0].content='';airRefreshSection('一',0);});
        assert.equal(await page.locator('#airDocPane .air-section-candidate').count(),0);assert.match(await page.locator('#airDocPane .body').innerText(),/本节尚未生成正文/);
        await page.evaluate(()=>{chapters=[];airBuildDocPane();});assert.equal(await page.locator('#airDocPane .air-section-candidate').count(),0);
      }
    });
    await t.test('未通过新返修稿 5 次：新全文、旧历史、服务端质量与错误均保留',async()=>{
      for(let i=0;i<5;i++){
        await mount(page);await startOnce(page);await page.evaluate(text=>__release({mode:'blocked',text}),repaired);await page.waitForFunction(()=>__alerts.length===1);
        await assertFullCandidate(page,repaired);assert.match(await page.locator('#airDocPane .air-section-candidate [role=alert]').innerText(),/新候选仍需核对/);
        const state=await page.evaluate(()=>({content:chapters[0].sections[0].content,candidate:chapters[0].sections[0].pendingRevision,calls:__calls.length}));
        assert.equal(state.content,before);assert.equal(state.candidate.history[0].after,after);assert.equal(state.candidate.serverQuality.status,'blocked');assert.equal(state.calls,1);
      }
    });
    await t.test('实际页面刷新 5 次：测试保存快照重新挂载仍保留 serverQuality、历史及候选全文',async()=>{
      await mount(page);await startOnce(page);await page.evaluate(text=>__release({mode:'blocked',text}),repaired);await page.waitForFunction(()=>__alerts.length===1);
      let snapshot=await page.evaluate(()=>JSON.parse(JSON.stringify(chapters)));
      for(let i=0;i<5;i++){
        await page.reload({waitUntil:'load'});await page.waitForFunction(()=>typeof airRepairCandidate==='function'&&typeof reportReviewCandidate==='function');
        await mount(page,snapshot);await assertFullCandidate(page,repaired);
        const state=await page.evaluate(()=>({quality:reportReviewCandidate(chapters[0],chapters[0].sections[0]),content:chapters[0].sections[0].content,candidate:chapters[0].sections[0].pendingRevision,calls:__calls.length}));
        assert.equal(state.quality.status,'blocked');assert.equal(state.quality.issues.filter(issue=>issue.code==='server-depth-check').length,1);
        assert.equal(state.content,before);assert.equal(state.candidate.history[0].after,after);assert.equal(state.candidate.repairInstruction,instruction);assert.equal(state.calls,0);
        snapshot=await page.evaluate(()=>JSON.parse(JSON.stringify(chapters)));
      }
    });
    fs.mkdirSync('outputs/report-standardization',{recursive:true});
    // A tall viewport keeps nested-scroller element screenshots from resizing the report during capture.
    await page.setViewportSize({width:1600,height:1800});
    await page.locator('#airDocPane .air-doc-fullscreen').click();
    await page.locator('#airDocPane .air-section-candidate').scrollIntoViewIfNeeded();
    await page.locator('#airDocPane .air-section-candidate').screenshot({path:'outputs/report-standardization/0930-repair-participation-browser.png',animations:'disabled'});
    assert.deepEqual(errors,[]);
    t.diagnostic('Bundled headless Chromium only; Windows lockout guard active; normal/error/empty/blocked/refresh: 5 each; page errors: 0; all API routes mocked, all external origins aborted. Refresh validates snapshot serialization + production re-review, not real database persistence.');
    t.diagnostic('Intercepted API requests: '+apiRequests.length+'; aborted external requests: '+externalRequests.length+'; no formal project or live model requests.');
  }finally{await context.close();await browser.close();}
});
