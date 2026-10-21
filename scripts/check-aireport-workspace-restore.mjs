// Browser integration QA: real index/scripts + read-only tax draft, isolated APIs/profile.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const origin='http://localhost:8080',fixturePath=path.resolve('outputs/report-standardization/tax-source.json');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const liveReadOnly=process.argv.includes('--live-readonly');
const liveProjectId='1bb24013-18ce-4819-9588-09fe98e5e0c0';
async function readLiveSnapshot(){
  const {default:pg}=await import('../local-server/node_modules/pg/lib/index.js');
  const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
  try{
    await db.query('BEGIN READ ONLY');
    const {rows:[row]}=await db.query('SELECT p.id,p.name,p.data,p.updated_at,u.id AS owner_id,u.username FROM projects p JOIN users u ON p.user_id=u.id WHERE p.id=$1',[liveProjectId]);
    assert.ok(row,'Saved tax project must exist');
    const {rows}=await db.query('SELECT data,updated_at FROM aireport_project_sessions WHERE user_id=$1 AND project_id=$2',[row.owner_id,liveProjectId]);
    await db.query('ROLLBACK');
    return {row,sessionRows:rows,hashes:{project:sha(typeof row.data==='string'?row.data:JSON.stringify(row.data)),session:sha(JSON.stringify(rows)),updatedAt:String(row.updated_at)}};
  }finally{await db.end();}
}
let liveBefore=null,liveApi=null,liveSessionState=null,source,sourceBytes;
if(liveReadOnly){
  liveBefore=await readLiveSnapshot();
  const {signToken}=await import('../functions/api/_auth.js');
  const authorization='Bearer '+await signToken(process.env,liveBefore.row.owner_id,liveBefore.row.username);
  // Authorization stays in process memory; only these two explicit read-only GET requests leave the harness.
  const projectResponse=await fetch(origin+'/api/projects?id='+liveProjectId,{headers:{authorization},signal:AbortSignal.timeout(60000)});
  assert.equal(projectResponse.status,200);const projectBody=await projectResponse.json();assert.equal(projectBody.ok,true);
  const sessionResponse=await fetch(origin+'/api/aireport?projectId='+liveProjectId,{headers:{authorization},signal:AbortSignal.timeout(60000)});
  assert.equal(sessionResponse.status,200);const sessionBody=await sessionResponse.json();assert.equal(sessionBody.ok,true);assert.notEqual(sessionBody.migrationRequired,true);
  source=projectBody.project.data;sourceBytes=Buffer.from(JSON.stringify(source));
  const sections=source.chapters.flatMap(c=>c.sections),versions=source.workflow.reportVersions;
  assert.ok(sections.length>0);assert.ok(sections.every(s=>String(s.content||s.editedHtml||'').trim()),'Current saved report must have body in every section');
  liveSessionState=sessionBody.state;
  liveApi={projectGetStatus:projectResponse.status,sessionGetStatus:sessionResponse.status,projectId:liveProjectId,
    currentReportVersionId:source.workflow.currentReportVersionId,currentReportVersion:versions.find(v=>v.id===source.workflow.currentReportVersionId)?.version,
    reportVersions:versions.length,chapters:source.chapters.length,sections:sections.length,generatedSections:sections.filter(s=>String(s.content||s.editedHtml||'').trim()).length,
    currentCalcSnapshotId:source.workflow.currentCalcSnapshotId,sessionRows:liveBefore.sessionRows.length,sessionNull:sessionBody.state===null,sessionKeys:Object.keys(sessionBody.state||{}),sessionHasDoc:!!sessionBody.state?.hasDoc,sessionChatKinds:(sessionBody.state?.chat||[]).map(m=>m.kind),
    embeddedAiSessionType:typeof source.aiReportSession,before:liveBefore.hashes};
  console.log(JSON.stringify({liveReadOnlySource:liveApi}));
}else{sourceBytes=await fs.readFile(fixturePath);source=JSON.parse(sourceBytes).state;}
// Keep current saved facts/content/calculation; historical versions are not needed for tool restoration.
const draft={...source,projectId:'[系统测试]workspace-tax',project:{...source.project,name:'[系统测试]'+source.project.name},
  workflow:{...source.workflow,reportVersions:[],analysisSnapshots:[]},
  chapters:source.chapters.map(c=>({cn:c.cn,name:c.name,checked:c.checked,sections:c.sections.map(s=>({t:s.t,content:s.content,editedHtml:s.editedHtml,numeric:s.numeric}))}))};
const fixtureRules=draft.chapters.flatMap(c=>c.sections.map((s,i)=>({id:'fixture-'+c.cn+'-'+i,sourceNo:i+1,chapter:'第'+c.cn+'章 '+c.name,section:s.t,title:s.t,sourceKinds:['manual_upload','web_search'],requiredSources:'当前项目资料及已审核公开依据',writingLogic:'核对项目事实',outputForm:s.numeric?'表格':'文字',missingPolicy:'search_then_mark'})));
const output=path.resolve('outputs/report-standardization','workspace-restore-ui-'+new Date().toISOString().replace(/[:.]/g,'-'));
await fs.mkdir(output,{recursive:true});
const report={startedAt:new Date().toISOString(),origin,output,scope:liveReadOnly?'real authenticated project/session GET to memory, read-only database before/after hashes; real index browser; fresh profile; all browser APIs intercepted; no real searches/generation or saves':'real index browser; read-only current tax draft; fresh profile; every API intercepted; no real searches/generation or database writes',liveReadOnly:liveApi,source:{path:liveReadOnly?'authenticated GET /api/projects?id='+liveProjectId:fixturePath,sha256:sha(sourceBytes),currentCalcSnapshotId:draft.workflow.currentCalcSnapshotId,sections:draft.chapters.reduce((n,c)=>n+c.sections.length,0)},tests:[],requests:[],externalRequests:[],consoleErrors:[],pageErrors:[],dialogs:[],passed:false};
let apiMode='null',pendingAir=null,airState=null;
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1536,height:1100},serviceWorkers:'block',acceptDownloads:false,extraHTTPHeaders:{'Cache-Control':'no-cache'}}),page=await context.newPage();
page.on('pageerror',e=>report.pageErrors.push(e.message));
page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
page.on('dialog',async d=>{report.dialogs.push(d.message());await d.dismiss();});
await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.origin===origin&&url.pathname.startsWith('/api/')){
    let action=null;try{action=req.postDataJSON()?.action||null;}catch{}
    report.requests.push({path:url.pathname,method:req.method(),action,projectId:url.searchParams.get('projectId')});
    if(url.pathname==='/api/aireport'&&req.method()==='GET'){
      if(apiMode==='delay'){await new Promise(resolve=>{pendingAir=resolve;});return route.fulfill({json:{ok:true,state:airState}});}
      if(apiMode==='failure')return route.fulfill({json:{ok:false,error:'[系统测试]故意模拟会话读取失败'}});
      return route.fulfill({json:{ok:true,state:apiMode==='hasDoc'?{hasDoc:true,chat:[]}:apiMode==='state'?airState:null}});
    }
    if(url.pathname==='/api/reportlogic')return route.fulfill({json:{ok:true,set:{version:1,data:{rules:fixtureRules}}}});
    if(req.method()!=='GET')return route.fulfill({json:{ok:true,isolated:true}});
    return route.fulfill({json:{ok:false,error:'[系统测试]未使用的 API 已隔离'}});
  }
  if(url.origin!==origin&&!['data:','blob:','about:'].includes(url.protocol)){report.externalRequests.push(url.origin+url.pathname);return route.abort('blockedbyclient');}
  return route.continue();
});
async function record(name,fn){try{report.tests.push({name,passed:true,details:await fn()??null});}catch(e){report.tests.push({name,passed:false,error:e.stack});throw e;}}
async function fresh(reload=false){
  if(reload)await page.reload({waitUntil:'domcontentloaded'});else await page.goto(origin+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof airHydrateCurrentWorkspace==='function'&&typeof restoreDraft==='function'&&!!window.ProjectWorkflow);
  assert.equal(await page.locator('#selfCheckBar').count(),0);
  await page.evaluate(()=>{
    document.getElementById('gate')?.remove();
    window.__workspaceTest={saves:0,mapCalls:[],researchEpoch:0,researchActive:false,researchState:null};
    window.saveDraft=()=>{__workspaceTest.saves++;};
    window.reportDraftStore=async()=>null;
    window.openProjectCityMap=place=>{__workspaceTest.mapCalls.push({projectId:currentProjectId,name:project.name,location:project.location,place:structuredClone(place||null),sites:structuredClone(project.analysisSites||[])});};
    window.ResearchUI={...window.ResearchUI,active:()=>__workspaceTest.researchActive,state:()=>__workspaceTest.researchState,mountActions:()=>{},resumeAction:()=>{},editable:()=>true,save:async()=>true,
      capture:chain=>({epoch:__workspaceTest.researchEpoch,chain}),accepts:token=>token.epoch===__workspaceTest.researchEpoch,
      schedule:()=>{__workspaceTest.saves++;},canEdit:()=>true,localKey:()=> '[系统测试]research'};
  });
}
async function install({research=false,variant=null}={}){
  await page.evaluate(({draft,research,variant})=>{
    airSwitchProjectSession();__workspaceTest.researchActive=research;__workspaceTest.researchEpoch++;
    const d=structuredClone(draft);
    if(variant==='noCalc'){d.calcParams=null;d.project.analysisSites=[];d.project.poiLoc='';}
    if(variant==='currentRent'){const selected=d.workflow.calcSnapshots.find(s=>s.calcType==='rent');d.workflow.currentCalcSnapshotId=selected.id;d.calcParams=selected.params;}
    if(variant==='empty'){d.calcParams=null;d.kb=[];d.project={name:'',owner:'',location:'',type:'',desc:''};d.chapters=[];d.domainKey=null;d.workflow={};}
    currentProjectId=research||variant==='empty'?null:d.projectId;currentProjectRole='OWNER';
    __workspaceTest.researchState=research?{draft:d}:null;
    restoreDraft(d,{deferRender:true});appMode='aireport';renderTOC();renderSheet();
  },{draft,research,variant});
}
async function settled(){await page.waitForFunction(()=>aiReportChatLoaded&&!aiReportRestoreLoading);}
async function state(){return page.evaluate(()=>({projectId:currentProjectId,projectName:project.name,kinds:aiReportChat.map(m=>m.kind),extracted:aiReportExtracted&&{name:aiReportExtracted.projectName,calcType:aiReportExtracted.calcType},suggested:!!aiReportSuggested,confirmed:aiReportParamsConfirmed,calcType,engineType:calcResult?.__ctype,calcParamsPresent:!!calcParams,loading:aiReportRestoreLoading,error:aiReportRestoreError,bodySections:chapters.flatMap(c=>c.sections).filter(reportHasVisibleBody).length}));}
async function assertTools(expectedSession=null){
  const s=await state();for(const kind of ['infoCard','calcResult','materialCheck']){assert.ok(s.kinds.includes(kind),kind+' missing '+JSON.stringify(s));assert.ok(await page.locator('[data-air-msg-kind="'+kind+'"]').count());}
  for(const tool of ['project','materials','sources','params','calculation','map','search','logic','report'])assert.equal(await page.locator('.air-module-bar [data-module="'+tool+'"]').count(),1);
  assert.equal(s.confirmed,!!expectedSession?.paramsConfirmed);assert.equal(s.suggested,!!expectedSession?.suggested);assert.equal(s.extracted.name,expectedSession?.extracted?.projectName||draft.project.name);assert.equal(s.calcType,'gaibao');assert.equal(s.engineType,'gaibao');assert.ok(s.bodySections>0);return s;
}
async function shot(name){await page.screenshot({path:path.join(output,name+'.png'),fullPage:false,animations:'disabled'});}
try{
  await fresh();
  await record(liveReadOnly?'actual authenticated project draft and independent AI session restore saved tools':'null AI session restores real saved project cards, calculation, material checklist and fixed tools',async()=>{apiMode=liveReadOnly?'state':'null';airState=liveSessionState;await install();await settled();const s=await assertTools(liveReadOnly?liveSessionState:null);await shot('null-session-restored');return s;});
  await record('generated report locks old intake while exposing saved materials and parameter provenance',async()=>{
    const info=page.locator('[data-air-msg-kind="infoCard"]'),sources=page.locator('[data-air-msg-kind="confirmCard"]');
    assert.equal(await page.locator('#airBackStepBtn').isDisabled(),true);
    assert.equal(await info.locator('input,textarea,select').count(),0);
    assert.equal(await info.locator('button[data-module="projectEdit"]').count(),1);
    assert.ok(await page.locator('[data-air-msg-kind="materialResult"]').count());
    assert.ok(await sources.count());
    assert.equal(await sources.locator('input,textarea,select').count(),0);
    assert.equal(await page.locator('[data-air-msg-kind="materialCheck"] button[data-module="search"]').count(),1);
    assert.match(await page.locator('#airMsgs').innerText(),/可研生成向导已锁定/);
    const before=report.requests.length;await page.evaluate(()=>aiReportStartGenerate());
    assert.equal(report.requests.slice(before).filter(r=>/generate|search|aireport/.test(r.path)).length,0);
    return {readOnlyProject:true,savedMaterials:true,parameterSourceCard:true,generationRequests:0};
  });
  await record('project card edit button changes only saved project facts, not the locked generation flow',async()=>{
    const before=report.requests.length;
    await page.locator('[data-air-msg-kind="infoCard"] [data-module="projectEdit"]').click();
    assert.equal(await page.locator('#airProjectInfoEditor').count(),1);
    await page.locator('#airEditProjectOwner').fill('[系统测试]已核对单位');
    await page.locator('#airSaveProjectInfo').click();
    const values=await page.evaluate(()=>({owner:project.owner,extractedOwner:aiReportExtracted.owner,locked:airGenerationFlowLocked()}));
    assert.equal(values.owner,'[系统测试]已核对单位');assert.equal(values.extractedOwner,values.owner);assert.equal(values.locked,true);
    assert.equal(report.requests.slice(before).filter(r=>/generate|search|poi/.test(r.path)).length,0);
    await install();await settled();return values;
  });
  await record('fixed project entry expands a collapsed info card and chat pane',async()=>{
    await page.evaluate(()=>{aiReportChatCollapsed=true;airApplyDocViewState();document.querySelectorAll('#airMsgs details').forEach(d=>d.open=false);});
    // Module bar itself can be hidden by collapsed chat; simulate the application action directly.
    await page.evaluate(()=>airOpenIndependentModule('project'));
    const s=await page.evaluate(()=>({collapsed:aiReportChatCollapsed,open:[...document.querySelectorAll('[data-air-msg-kind="infoCard"] details')].every(d=>d.open)}));assert.equal(s.collapsed,false);assert.equal(s.open,true);return s;
  });
  await record('map button uses the current saved project and its six confirmed sites without querying',async()=>{
    const before=report.requests.length;await page.locator('.air-module-bar [data-module="map"]').click();
    const calls=await page.evaluate(()=>__workspaceTest.mapCalls);assert.equal(calls.length,1);assert.equal(calls[0].projectId,draft.projectId);assert.equal(calls[0].location,draft.project.location);assert.equal(calls[0].sites.length,6);
    const primary=draft.project.analysisSites.find(site=>site.role==='primary'&&site.confirmed&&site.location)||draft.project.analysisSites.find(site=>site.confirmed&&site.location);
    assert.equal(calls[0].place.location,primary?.location||draft.project.poiLoc);
    assert.equal(report.requests.slice(before).filter(r=>/poi|map|search|generate/.test(r.path)).length,0);return {projectId:calls[0].projectId,sites:calls[0].sites.length};
  });
  await record('bulk search button opens and focuses material search; no external search auto-starts',async()=>{
    const before=report.requests.length;await page.locator('.air-module-bar [data-module="search"]').click();
    await page.waitForFunction(()=>document.activeElement?.id==='airBatchWebSearch');assert.ok(await page.locator('#airBatchWebSearch').isVisible());
    assert.equal(report.requests.slice(before).filter(r=>/web|search|generate/.test(r.path)).length,0);return {focused:await page.evaluate(()=>document.activeElement.id)};
  });
  await record('completed report can independently search missing sources without restarting generation',async()=>{
    const result=await page.evaluate(async()=>{
      const original=WebResearch.batchSearchGaps,calls=[];
      WebResearch.batchSearchGaps=async(items,options)=>{calls.push({count:items.length,continueAfter:options.continueAfter});await options.onContinue();};
      try{await airBatchWebPreflight(false,false);}finally{WebResearch.batchSearchGaps=original;}
      return {calls,locked:airGenerationFlowLocked()};
    });
    assert.equal(result.locked,true);assert.equal(result.calls.length,1);assert.equal(result.calls[0].continueAfter,false);
    return result;
  });
  await record('key parameters and financial calculation repeatedly enter correct snapshot engine then return',async()=>{
    const rounds=[];
    for(const module of ['params','calculation','params']){
      await page.locator('.air-module-bar [data-module="'+module+'"]').click();await page.waitForFunction(()=>appMode==='calc');
      const s=await page.evaluate(()=>({mode:appMode,type:calcType,resultType:scResult?.__ctype,sameParams:JSON.stringify(scParams)===JSON.stringify(calcParams),currentSnapshotId:projectWorkflow.currentCalcSnapshotId}));
      assert.equal(s.type,'gaibao');assert.equal(s.resultType,'gaibao');assert.equal(s.sameParams,true);assert.equal(s.currentSnapshotId,draft.workflow.currentCalcSnapshotId);
      await page.locator('#scReturnAiReport').click();await page.waitForFunction(()=>appMode==='aireport');assert.ok(await page.locator('[data-air-msg-kind="infoCard"]').count());assert.ok(await page.locator('[data-air-msg-kind="materialCheck"]').count());rounds.push(s);
    }return rounds;
  });
  await record('browser refresh then restore reopens the same project tools without generated AI history',async()=>{apiMode='null';await fresh(true);await install();await settled();return assertTools();});
  await record('hasDoc-only legacy session restores all saved draft tools',async()=>{apiMode='hasDoc';await install();await settled();const s=await assertTools();await shot('hasdoc-only-restored');return s;});
  await record('private research draft-only restores tools with no generic project AI/local fallback',async()=>{
    apiMode='failure';const start=report.requests.length;await install({research:true});await settled();const s=await assertTools();assert.equal(s.projectId,null);assert.equal(s.error,'');assert.equal(report.requests.slice(start).filter(r=>r.path==='/api/aireport').length,0);await shot('research-draft-only');return s;
  });
  await record('explicit current calculation snapshot wins over latest snapshot and project category',async()=>{
    apiMode='null';await install({variant:'currentRent'});await settled();const s=await state();assert.equal(s.calcType,'rent');assert.equal(s.engineType,'rent');assert.equal(s.extracted.calcType,'rent');
    await page.locator('.air-module-bar [data-module="calculation"]').click();await page.waitForFunction(()=>appMode==='calc');assert.equal(await page.evaluate(()=>calcType),'rent');
    await page.locator('#scReturnAiReport').click();await page.waitForFunction(()=>appMode==='aireport');return s;
  });
  await record('research round identity rejects old material restore even with the same null project ID',async()=>{
    await page.evaluate(()=>{
      __workspaceTest.originalLogicLoad=ReportLogicCore.load;let held=false;
      ReportLogicCore.load=async(...args)=>{if(!held){held=true;await new Promise(resolve=>{__workspaceTest.releaseLogic=resolve;});}return __workspaceTest.originalLogicLoad(...args);};
    });
    await install({research:true});await page.waitForFunction(()=>typeof __workspaceTest.releaseLogic==='function');
    await page.evaluate(()=>{
      // Deliberately keep the project ID and restore epoch equal: only research token changed.
      __workspaceTest.researchEpoch++;project.name='[系统测试]另一研究轮次';
      aiReportChat=[];aiReportExtracted=null;aiReportSuggested=null;aiReportChatLoaded=false;
      renderTOC();renderSheet();
    });
    await settled();await page.evaluate(()=>{__workspaceTest.releaseLogic();ReportLogicCore.load=__workspaceTest.originalLogicLoad;});await page.waitForTimeout(100);
    const s=await state();assert.equal(s.projectId,null);assert.equal(s.extracted.name,'[系统测试]另一研究轮次');assert.equal(s.kinds.filter(k=>k==='materialCheck').length,1);assert.equal(s.kinds.filter(k=>k==='infoCard').length,1);return s;
  });
  await record('failed session fetch retains draft tools, pauses sync and presents functional retry',async()=>{
    apiMode='failure';await install();await settled();const s=await assertTools();assert.match(s.error,/失败/);assert.equal(await page.getByRole('button',{name:'重试恢复',exact:true}).count(),1);
    const postStart=report.requests.length;await page.evaluate(()=>airSaveState());assert.equal(report.requests.slice(postStart).filter(r=>r.path==='/api/aireport'&&r.method==='POST').length,0);
    await shot('read-failed-retry');apiMode='null';await page.getByRole('button',{name:'重试恢复',exact:true}).click();await settled();const after=await assertTools();assert.equal(after.error,'');return {before:s.error,after:after.error};
  });
  await record('slow old project response cannot overwrite a newly switched project workspace',async()=>{
    apiMode='delay';airState={hasDoc:true,extracted:{projectName:'[系统测试]旧项目迟到内容',calcType:'sale'},chat:[{kind:'text',content:'[系统测试]旧响应不可串写'}]};await install();
    await page.waitForFunction(()=>aiReportRestoreLoading);for(let i=0;!pendingAir&&i<100;i++)await new Promise(r=>setTimeout(r,20));assert.ok(pendingAir,'fixture request did not reach isolated API');
    assert.equal(await page.locator('.air-module-bar [data-module="map"]').isDisabled(),true);await shot('restore-loading');
    apiMode='null';await page.evaluate(()=>{airSwitchProjectSession();currentProjectId='[系统测试]new-project';project.name='[系统测试]新项目';appMode='aireport';renderTOC();renderSheet();});
    pendingAir();pendingAir=null;await settled();await page.waitForTimeout(100);
    const s=await state();assert.equal(s.projectId,'[系统测试]new-project');assert.equal(s.extracted.name,'[系统测试]新项目');assert.equal(s.calcType,'gaibao');assert.equal(await page.locator('#airMsgs').innerText().then(t=>t.includes('旧响应不可串写')),false);return s;
  });
  await record('empty project does not inherit the previous project financial result or analysis sites',async()=>{
    apiMode='null';await install({variant:'empty'});await settled();const s=await state();assert.equal(s.calcParamsPresent,false);assert.equal(s.engineType,undefined);assert.equal(s.extracted,null);assert.equal(s.kinds.includes('calcResult'),false);
    await page.locator('.air-module-bar [data-module="params"]').click();assert.match(report.dialogs.at(-1),/尚无已保存的测算参数/);await shot('empty-project');return s;
  });
  await record('map without a confirmed coordinate does not invent or mark a guessed place',async()=>{
    const before=await page.evaluate(()=>__workspaceTest.mapCalls.length);
    await page.locator('.air-module-bar [data-module="map"]').click();
    assert.equal(await page.evaluate(()=>__workspaceTest.mapCalls.length),before);
    assert.match(report.dialogs.at(-1),/没有有效的已确认地图坐标/);
    return {mapCalls:before};
  });
  await record('source unchanged; no generation/search; console and page scripts are clean',async()=>{
    if(liveReadOnly){const after=await readLiveSnapshot();report.liveReadOnly.after=after.hashes;assert.deepEqual(after.hashes,liveBefore.hashes);}
    else assert.equal(sha(await fs.readFile(fixturePath)),report.source.sha256);
    assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.consoleErrors,[]);assert.equal(report.requests.filter(r=>/\/api\/(generate|search|websearch|geocode|poi)/.test(r.path)).length,0);
    return {sourceUnchanged:true,pageErrors:0,consoleErrors:0,realApiWrites:0,realSearchOrGeneration:0};
  });
  report.passed=true;
}catch(error){report.failure=error.stack;try{await shot('failure');report.finalState=await state();}catch{}}
finally{if(liveReadOnly&&!report.liveReadOnly.after){const after=await readLiveSnapshot();report.liveReadOnly.after=after.hashes;report.liveReadOnly.unchanged=JSON.stringify(after.hashes)===JSON.stringify(liveBefore.hashes);}report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'acceptance.json'),JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({passed:report.passed,tests:report.tests.map(t=>({name:t.name,passed:t.passed})),failure:report.failure,output,pageErrors:report.pageErrors,consoleErrors:report.consoleErrors},null,2));
if(!report.passed)process.exitCode=1;
