// Actual index and owned UI, fresh browser; all APIs, signing and persistence are isolated fixtures.
// This tests browser behavior, not production signatures, permissions, PostgreSQL or external AI.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
const require=createRequire(import.meta.url),G=require('../report-gap-registry.js');
const root=path.resolve('.'),out=path.join(root,'outputs/report-standardization','gap-lifecycle-ui-'+new Date().toISOString().replace(/[:.]/g,'-'));
await fs.mkdir(out,{recursive:true});
const server=http.createServer(async(req,res)=>{try{const p=decodeURIComponent(new URL(req.url,'http://test').pathname),file=path.resolve(root,'.'+(p==='/'?'/index.html':p));if(!file.startsWith(root+path.sep))throw Error('outside');const body=await fs.readFile(file);res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json'})[path.extname(file)]||'application/octet-stream');res.end(body);}catch{res.statusCode=404;res.end('not found');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1480,height:1050},serviceWorkers:'block'}),page=await context.newPage();
const result={scope:'actual index and UI; isolated API/AI/persistence/signature fixtures; no real project writes',tests:[],errors:[],apiCalls:[],passed:false};
let saved=null,saveMode='remote',confirmGate=null,verifyGate=null,verifyFailure=false,saveCalls=0,confirmCalls=0,verifyCalls=0;
page.on('pageerror',e=>result.errors.push(e.message));page.on('dialog',d=>d.type()==='confirm'?d.accept():d.dismiss());
function replyFor(registry,extra={}){return {registry,sourceRevision:registry.sourceRevision,trustedApprovals:registry.records.map(r=>r.approval).filter(Boolean),...extra};}
await context.route('**/*',async route=>{
  const u=new URL(route.request().url());if(u.origin!==origin)return route.abort('blockedbyclient');
  if(!u.pathname.startsWith('/api/'))return route.continue();
  result.apiCalls.push(u.pathname);const body=route.request().postDataJSON()||{};
  if(u.pathname==='/api/_gap_test_save'){
    saveCalls++;if(saveMode==='failure')return route.fulfill({json:{ok:false,error:'[系统测试]远端保存失败'}});
    if(saveMode==='local')return route.fulfill({json:{ok:true,remote:false,local:true}});
    saved=structuredClone(body);return route.fulfill({json:{ok:true,remote:true,expectedUpdatedAt:10+saveCalls}});
  }
  if(u.pathname==='/api/reportexecution'&&body.action==='confirmGap'){
    confirmCalls++;if(confirmGate)await confirmGate.promise;
    const registry=saved.workflow.reportGapRegistry,r=registry.records.find(x=>x.id===body.gapId);
    assert.equal(body.sourceRevision,registry.sourceRevision);assert.ok(r);assert.ok(body.projectId.startsWith('[系统测试]'));
    const closed=G.reconcile(registry,[{gapId:r.id,projectKey:registry.projectKey,sourceRevision:registry.sourceRevision,requirementRevision:r.requirementRevision,status:body.status,reason:body.reason,evidenceIds:[]}],{projectKey:registry.projectKey,sourceRevision:registry.sourceRevision,trustedApprovals:registry.records.map(x=>x.approval).filter(Boolean),humanApproval:{confirmed:true,actorId:'isolated-test-reviewer',reason:body.reason,sourceRevision:registry.sourceRevision,gapIds:[r.id],at:new Date().toISOString()}}).registry;
    const approval=closed.records.find(x=>x.id===r.id).approval,receipt={gapId:r.id,approval,signature:'isolated-browser-test-not-production'};
    return route.fulfill({json:{ok:true,gaps:replyFor(closed,{approval,receipt,requiresSave:true,formalApproval:false,expectedUpdatedAt:body.expectedUpdatedAt})}});
  }
  if(u.pathname==='/api/reportexecution'&&body.action==='verifyGaps'){
    verifyCalls++;if(verifyGate)await verifyGate.promise;
    if(verifyFailure)return route.fulfill({status:503,json:{ok:false,error:'[系统测试]验签服务暂不可用'}});
    return route.fulfill({json:{ok:true,gaps:replyFor(saved.workflow.reportGapRegistry)}});
  }
  return route.fulfill({json:{ok:false,error:'[系统测试]其他API已隔离'}});
});
const gate=()=>{let release;return{promise:new Promise(r=>release=r),release:()=>release()};};
async function check(name,fn){try{const details=await fn();result.tests.push({name,passed:true,details});}catch(e){result.tests.push({name,passed:false,error:e.message});throw e;}}
async function fixture(id,restore=null){
  await page.evaluate(({id,restore})=>{
    document.getElementById('gate')?.remove();document.querySelectorAll('#reportGapReview').forEach(e=>e.remove());
    window.ResearchUI={...window.ResearchUI,active:()=>false};currentProjectId=id;currentProjectUpdatedAt=10;currentProjectRole='OWNER';calcType='gaibao';domainKey='gaibao';rptCtype='rent';appMode='report';currentStep=4;
    Object.assign(project,{name:'[系统测试]资料核实闭环',type:'gaibao',location:'测试区域',desc:'仅隔离浏览器内存',businessScenario:'housing_conversion'});
    calcParams={area:100};kbEntries=[{title:'[系统测试]人口资料',content:'项目所在街道常住人口为二十万人，统计口径采用最新公开年度公报。'}];
    chapters=[{name:'市场分析',sections:[{t:'人口需求',content:'[系统测试]原有报告正文和表格保持不变。'},{t:'项目区位',content:'[系统测试]原有区位分析。'}]}];
    projectWorkflow=restore?.workflow||ProjectWorkflow.ensureState({});
    window.__gapData={projectType:'gaibao',rules:[{id:'pop',chapter:'市场分析',section:'人口需求',displayTitle:'人口需求',importance:'★★★',requiredSources:'常住人口统计',writingLogic:'分析需求',sourceKinds:['provider']},{id:'location',chapter:'市场分析',section:'项目区位',displayTitle:'项目区位',importance:'★★★',requiredSources:'区位说明',writingLogic:'说明区位',sourceKinds:['project']}]};
    window.ReportLogicCore={...window.ReportLogicCore,current:()=>({data:__gapData,version:1}),load:async()=>({data:__gapData,version:1})};
    window.__gapUiSaves=0;window.saveDraft=()=>{};window.callGen=async()=>{throw Error('隔离测试禁止调用AI');};
    window.persistReportDraft=async()=>{__gapUiSaves++;const response=await fetch('/api/_gap_test_save',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId:currentProjectId,workflow:projectWorkflow})}),data=await response.json();if(data.expectedUpdatedAt)currentProjectUpdatedAt=data.expectedUpdatedAt;return data;};
    window.__gapOriginal=JSON.stringify({project,calcParams,kbEntries,chapters});renderTOC();renderSheet();
  },{id,restore});
}
async function openProof(index=0){await page.locator('#reportGapReview [data-gap] [data-proof]').nth(index).click();}
async function fillProof(status='satisfied'){
  await page.locator('[data-close-state]').selectOption(status);
  if(status==='satisfied'){
    await page.locator('[data-material]').selectOption({index:1});const details=page.locator('[data-original]').locator('..');if(await details.getAttribute('open')===null)await details.locator('summary').click();
    assert.match(await page.locator('[data-original]').innerText(),/常住人口为二十万人/);
    await page.locator('[data-locator]').fill('资料第一段');await page.locator('[data-quote]').fill('项目所在街道常住人口为二十万人');
  }
  await page.locator('[data-close-reason]').fill(status==='satisfied'?'已经核对该项目所在街道、统计年度与材料原文的实际适用范围':'项目位于单一明确点位，本项补充区位证明不适用于当前决策范围');
}
async function unchanged(){assert.equal(await page.evaluate(()=>JSON.stringify({project,calcParams,kbEntries,chapters})===__gapOriginal),true);}
try{
  await page.goto(origin,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>!!window.ReportGapUI&&typeof reportGapContext==='function');
  await check('actual UI shows legacy no-ID material; unmatched quotation and short reason block before writes',async()=>{
    await fixture('[系统测试]gap-primary');await page.evaluate(()=>ReportGapUI.open());assert.equal(await page.locator('[data-gap]').count(),2);await openProof();await fillProof();await page.locator('[data-quote]').fill('该句不在实际原文材料中的虚假引文');await page.locator('[data-confirm-proof]').click();assert.match(await page.locator('[data-proof-status]').innerText(),/精确匹配/);assert.equal(saveCalls,0);assert.equal(confirmCalls,0);
    await page.locator('[data-quote]').fill('项目所在街道常住人口为二十万人');await page.locator('[data-close-reason]').fill('已核实');await page.locator('[data-confirm-proof]').click();assert.match(await page.locator('[data-proof-status]').innerText(),/12至2000/);await fillProof();await page.screenshot({path:path.join(out,'01-original-and-validation.png')});await unchanged();
  });
  await check('explicit approval saves twice, duplicate clicks issue one confirmation, and original report stays intact',async()=>{
    confirmGate=gate();await page.locator('[data-confirm-proof]').click();await page.waitForFunction(()=>document.querySelector('[data-proof-status]')?.textContent.includes('后台正在校验'));await page.evaluate(()=>{for(let n=0;n<5;n++)document.querySelector('[data-confirm-proof]').click();});assert.equal(confirmCalls,1);assert.equal(await page.locator('[data-confirm-proof]').isDisabled(),true);assert.equal(await page.locator('[data-apply]').isDisabled(),true);await page.screenshot({path:path.join(out,'02-confirmation-loading.png')});confirmGate.release();confirmGate=null;
    await page.waitForFunction(()=>document.querySelector('#reportGapReview [data-status]')?.textContent.includes('人工核实收据已在服务器保存'));assert.equal(saveCalls,2);assert.equal(saved.workflow.reportGapRegistry.records[0].status,'satisfied');assert.match(await page.locator('[data-gap]').first().innerText(),/已核实/);await unchanged();await page.screenshot({path:path.join(out,'03-satisfied.png')});
  });
  await check('critical exemption requires explicit reason and human confirmation; evidence fields hide, no AI',async()=>{
    await openProof(1);await fillProof('not-applicable');assert.equal(await page.locator('[data-evidence]').isVisible(),false);await page.locator('[data-confirm-proof]').click();await page.waitForFunction(()=>!document.querySelector('[data-confirm-proof]'));assert.equal(saved.workflow.reportGapRegistry.records[1].status,'not-applicable');assert.equal(Object.keys(saved.workflow.reportGapReceipts).length,2);assert.match(await page.locator('[data-gap]').nth(1).innerText(),/已确认不适用/);await unchanged();await page.screenshot({path:path.join(out,'04-human-exemption.png')});
  });
  const approved=structuredClone(saved);
  await check('reload clears in-memory trust; concurrent verification requests dedupe then closed statuses recover without opening dialog',async()=>{
    await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>!!window.ReportGapUI);await fixture(approved.projectId,approved);
    assert.equal(await page.evaluate(()=>reportGapContext().trustedApprovals.length),0);verifyGate=gate();const before=verifyCalls,pending=page.evaluate(()=>Promise.all([ReportGapUI.ensureVerified(),ReportGapUI.ensureVerified(),ReportGapUI.ensureVerified()]));
    await page.waitForResponse(r=>r.url().includes('/api/reportexecution')&&r.request().postDataJSON()?.action==='verifyGaps',{timeout:150}).catch(()=>{});assert.equal(verifyCalls-before,1);verifyGate.release();verifyGate=null;await pending;assert.equal(verifyCalls-before,1);
    assert.deepEqual(await page.evaluate(()=>reportGapState().registry.records.map(r=>r.status)),['satisfied','not-applicable']);await page.evaluate(()=>ReportGapUI.open());assert.match(await page.locator('[data-gap]').first().innerText(),/已核实/);await unchanged();await page.screenshot({path:path.join(out,'05-refresh-verified.png')});
  });
  await check('receipt deletion revokes trust immediately and forced verification failure cannot preserve cached authority',async()=>{
    const count=await page.evaluate(()=>{const k=Object.keys(projectWorkflow.reportGapReceipts)[0];window.__heldReceipt=projectWorkflow.reportGapReceipts[k];delete projectWorkflow.reportGapReceipts[k];return reportGapContext().trustedApprovals.length;});assert.equal(count,0);
    await page.evaluate(()=>{projectWorkflow.reportGapReceipts[__heldReceipt.gapId]=__heldReceipt;return ReportGapUI.ensureVerified({force:true});});assert.equal(await page.evaluate(()=>reportGapContext().trustedApprovals.length),2);
    verifyFailure=true;const error=await page.evaluate(()=>ReportGapUI.ensureVerified({force:true}).then(()=>'',e=>e.message));assert.match(error,/验签服务暂不可用/);assert.equal(await page.evaluate(()=>reportGapContext().trustedApprovals.length),0);verifyFailure=false;await unchanged();
  });
  await check('remote save refusal keeps unresolved record and cannot create a receipt or new trust',async()=>{
    await fixture('[系统测试]gap-save-failure');await page.evaluate(()=>ReportGapUI.open());await openProof();await fillProof();saveMode='local';const before=confirmCalls;await page.locator('[data-confirm-proof]').click();await page.waitForFunction(()=>document.querySelector('[data-proof-status]')?.textContent.includes('服务器尚未确认保存'));assert.equal(confirmCalls,before);assert.equal(await page.evaluate(()=>!!projectWorkflow.reportGapRegistry),false);assert.equal(await page.evaluate(()=>reportGapContext().trustedApprovals.length),0);await unchanged();await page.screenshot({path:path.join(out,'06-remote-save-failure.png')});saveMode='remote';
  });
  await check('project switch rejects late approval, preserves target workflow and never stores foreign receipt',async()=>{
    await fixture('[系统测试]gap-switch');await page.evaluate(()=>ReportGapUI.open());await openProof();await fillProof();confirmGate=gate();await page.locator('[data-confirm-proof]').click();await page.waitForFunction(()=>document.querySelector('[data-proof-status]')?.textContent.includes('后台正在校验'));
    await page.evaluate(()=>{currentProjectId='[系统测试]gap-other';projectWorkflow={keep:'target-workflow'};});confirmGate.release();confirmGate=null;await page.waitForFunction(()=>document.querySelector('[data-proof-status]')?.textContent.includes('已变化'));assert.deepEqual(await page.evaluate(()=>projectWorkflow),{keep:'target-workflow'});await page.screenshot({path:path.join(out,'07-project-switch.png')});
  });
  assert.deepEqual(result.errors,[]);result.passed=true;
}catch(e){result.failure=e.stack;process.exitCode=1;}finally{confirmGate?.release();verifyGate?.release();await fs.writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2));await browser.close();await new Promise(r=>server.close(r));console.log(JSON.stringify({output:out,passed:result.passed,tests:result.tests,errors:result.errors,failure:result.failure},null,2));}
