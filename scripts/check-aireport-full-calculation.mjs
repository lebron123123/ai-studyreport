// Isolated real-page QA. No formal projects, credentials or external AI are touched.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const root=process.cwd(),origin='http://air-calculation.test';
const draft=JSON.parse(await fs.readFile('outputs/report-standardization/tax-source.json','utf8')).state;
const output=path.resolve('outputs/aireport-full-calculation');await fs.mkdir(output,{recursive:true});
const report={scope:'real index and all production scripts, fresh Chromium profile; isolated API/storage callbacks; no formal saves or paid generation',tests:[],pageErrors:[],dialogs:[]};
let savedAir=null;
const browser=await chromium.launch({headless:true});
try{
  const context=await browser.newContext({viewport:{width:1500,height:1050},serviceWorkers:'block'});
  const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>{report.pageErrors.push(e.message);console.log(e.stack);});
  page.on('dialog',async d=>{report.dialogs.push(d.message());await d.accept();});
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin!==origin)return route.abort();
    if(url.pathname.startsWith('/api/')){
      if(url.pathname==='/api/aireport'){
        if(route.request().method()==='POST'){savedAir=route.request().postDataJSON()?.state||savedAir;return route.fulfill({json:{ok:true}});}
        return route.fulfill({json:{ok:true,state:savedAir}});
      }
      return route.fulfill({json:{ok:true,records:[],metrics:[],config:{},set:{version:1,data:{rules:[]}}}});
    }
    const file=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
    if(!file.startsWith(root+path.sep))return route.abort();
    try{const body=await fs.readFile(file);await route.fulfill({body,contentType:({'.js':'application/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream'});}catch{await route.fulfill({status:404,body:''});}
  });
  async function boot(){
    await page.goto(origin,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>typeof airStartFullCalc==='function'&&typeof restoreDraft==='function');
    await page.evaluate(()=>{
      document.getElementById('gate')?.remove();window.getUser=()=> '[系统测试]tester';
      window.__fullCalcTest={savedDraft:null,saves:0};
      window.saveDraft=async()=>{__fullCalcTest.saves++;__fullCalcTest.savedDraft={appMode,calcParams:structuredClone(calcParams),workflow:structuredClone(projectWorkflow)};return true;};
      window.reportDraftStore=async()=>null;window.ResearchUI={...window.ResearchUI,active:()=>false};
    });
  }
  async function install(type='gaibao',generated=true){
    savedAir=null;
    await page.evaluate(({draft,type,generated})=>{
      airSwitchProjectSession();currentProjectId='[系统测试]full-'+type;currentProjectRole='OWNER';
      const d=structuredClone(draft);d.projectId=currentProjectId;d.project.name='[系统测试]全量接续-'+type;d.calcType=type;
      // Leave input seed empty: the actual parameter form supplies and validates defaults.
      d.calcParams={};
      d.workflow={calcSnapshots:[],currentCalcSnapshotId:null,reportVersions:[]};
      if(!generated)d.chapters=d.chapters.map(c=>({...c,sections:c.sections.map(s=>({...s,content:'',editedHtml:''}))}));
      restoreDraft(d,{deferRender:true});calcType=type;calcParams=d.calcParams;calcResult=null;
      aiReportExtracted={projectName:d.project.name,calcType:type};aiReportSuggested={calcType:type,params:structuredClone(calcParams),sources:{},keyFields:[{key:'rent',label:'租金',pct:false}],requiredFields:[]};
      aiReportParamsConfirmed=false;aiReportHasDoc=generated;aiReportChatLoaded=true;aiReportRestoreLoading=false;aiReportRestoreError='';
      aiReportChat=[{role:'assistant',kind:'confirmCard'}];appMode='aireport';renderTOC();renderSheet();
    },{draft,type,generated});
  }
  async function state(){return page.evaluate(()=>({mode:appMode,inputMode:aiReportCalculationMode,params:calcParams,pending:scParams,step:scStep,versions:projectWorkflow.calcSnapshots.length,snapshot:projectWorkflow.calcSnapshots.at(-1),body:JSON.stringify(chapters.map(c=>c.sections.map(s=>[s.content,s.editedHtml]))),confirmed:aiReportParamsConfirmed,persistedMode:__fullCalcTest.savedDraft?.appMode}));}
  async function record(name,fn){console.log('checking: '+name);await fn();report.tests.push({name,passed:true});}
  await boot();
  await record('quick/full selectors render and switch without changing formulas',async()=>{
    await install('gaibao',false);await page.locator('#airChooseQuickCalc').click();assert.equal((await state()).inputMode,'quick');
    await page.locator('#airChooseFullCalc').click();assert.equal((await state()).inputMode,'full');
  });
  for(const type of ['gaibao','rent','sale'])await record(type+' full form → actual engine → explicit adoption → original AI project',async()=>{
    await install(type);const before=await state();
    await page.locator('#airStartFullCalc').click();await page.waitForFunction(()=>appMode==='calc'&&!aiReportFullCalcBusy);
    assert.deepEqual((await state()).params,before.params);assert.equal(await page.locator('#scExperienceLibrary').count(),1);
    await page.locator('#scRun').click();console.log('run-status',type,await page.evaluate(()=>({step:scStep,error:document.getElementById('scRunError')?.textContent})));await page.waitForFunction(()=>scStep===2);
    assert.equal(await page.locator('#scAdoptAiReport').count(),1);assert.equal(await page.locator('#scExperienceLibrary').count(),1);
    if(type==='gaibao'){
      await page.locator('#scAdoptAiReport').scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(output,'full-result-adoption.png'),fullPage:false});
    }
    await page.locator('#scAdoptAiReport').click();await page.waitForFunction(()=>appMode==='aireport'&&!aiReportFullCalcBusy);
    const after=await state();assert.equal(after.versions,1);assert.equal(after.snapshot.calcType,type);assert.equal(after.confirmed,true);assert.equal(after.body,before.body);assert.equal(after.persistedMode,'aireport');
    assert.equal(after.snapshot.inputMode,'full');
  });
  await record('cancel and repeated re-entry preserve report and official parameters',async()=>{
    await install();const before=await state();
    for(let i=0;i<5;i++){
      await page.locator('#airStartFullCalc').click();await page.waitForFunction(()=>appMode==='calc'&&!aiReportFullCalcBusy);
      await page.locator('#c_rent').fill('51');await page.locator('#scRun').click();await page.waitForFunction(()=>scStep===2);
      await page.locator('#scReturnAiReport').click();await page.waitForFunction(()=>appMode==='aireport'&&!aiReportFullCalcBusy);
      assert.deepEqual((await state()).params,before.params);assert.equal((await state()).body,before.body);
    }
  });
  await record('experience library entry uses pending parameters and preserves original until adopt',async()=>{
    await install();const before=await state();await page.locator('#airStartFullCalc').click();await page.waitForFunction(()=>appMode==='calc'&&!aiReportFullCalcBusy);
    await page.evaluate(()=>{window.__experienceOpened=null;CalcExperienceLibrary.open=async o=>{window.__experienceOpened={type:o.projectType,params:o.params};o.onApply({id:'[系统测试]exp',revision:2,projectType:'gaibao',payload:{params:{}}},[{metricKey:'rent',value:52}]);};});
    await page.locator('#scExperienceLibrary').click();assert.equal((await state()).pending.rent,52);assert.deepEqual((await state()).params,before.params);
    await page.locator('#scRun').click();await page.waitForFunction(()=>scStep===2);await page.locator('#scAdoptAiReport').click();await page.waitForFunction(()=>appMode==='aireport'&&!aiReportFullCalcBusy);
    const after=await state();assert.equal(after.params.rent,52);assert.equal(after.snapshot.experienceSource.recordId,'[系统测试]exp');
  });
  await record('refresh restores full pending calculation and retains explicit confirmation',async()=>{
    await install();await page.locator('#airStartFullCalc').click();await page.waitForFunction(()=>appMode==='calc'&&!aiReportFullCalcBusy);
    await page.locator('#c_rent').fill('53');await page.locator('#scRun').click();await page.waitForFunction(()=>scStep===2);
    const persistedProject=await page.evaluate(()=>buildDraftData());
    const beforeRefresh=await state();
    await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>typeof airStartFullCalc==='function');
    await page.evaluate(persistedProject=>{
      document.getElementById('gate')?.remove();window.getUser=()=> '[系统测试]tester';window.ResearchUI={...window.ResearchUI,active:()=>false};
      currentProjectId='[系统测试]full-gaibao';currentProjectRole='OWNER';restoreDraft(persistedProject,{deferRender:true});
      window.__fullCalcTest={savedDraft:null};window.saveDraft=async()=>{__fullCalcTest.savedDraft={appMode};return true;};window.reportDraftStore=async()=>null;
      appMode='calc';renderTOC();renderSheet();
    },persistedProject);
    assert.equal((await state()).step,2);assert.equal((await state()).pending.rent,53);
    await page.locator('#scAdoptAiReport').click();await page.waitForFunction(()=>appMode==='aireport'&&!aiReportFullCalcBusy);assert.equal((await state()).params.rent,53);
    assert.equal((await state()).body,beforeRefresh.body);assert.equal((await state()).versions,1);
  });
  assert.deepEqual(report.pageErrors,[]);report.passed=true;console.log(JSON.stringify(report,null,2));
}finally{await browser.close();await fs.writeFile(path.join(output,'browser-acceptance.json'),JSON.stringify(report,null,2));}
