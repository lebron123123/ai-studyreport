// Real production renderer in an isolated browser; all API requests are fulfilled in memory.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/HP/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),L=require('../investment-lifecycle.js');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'}),page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[],writes=[],state={actor:1,failGet:false,failPost:false,delayProject:'',readOnly:false};
 const annual={metricKey:'revenue',periodStart:'2026-01-01',periodEnd:'2026-12-31',value:100,unit:'万元',currency:'CNY',basis:'rent:income.total'};
 const models=new Map();function model(id){if(!models.has(id))models.set(id,{projectId:id,actorUserId:1,permissions:{edit:true,manage:true},selectedScenario:{id:'scenario-'+id,name:'[系统测试]采纳方案'},versions:[],requests:[],actuals:[],variance:[],warning:'未配置企业审批，不自动批准'});const m=models.get(id);m.actorUserId=state.actor;m.permissions={edit:!state.readOnly,manage:!state.readOnly};m.variance=L.compareActuals(m.versions[0]?.payload,m.actuals);return m;}
 page.on('pageerror',e=>errors.push(e.message));
 const html='<!doctype html><meta charset="utf-8"><style>'+read('investment-workspace.css')+'</style><main id="host"></main><script>'+read('investment-ops.js')+'</script><script>'+read('investment-lifecycle.js')+'</script><script>window.enter=(projectId,mode)=>{window.controller?.dispose();window.controller=InvestmentOps.mountLifecycle(document.querySelector("#host"),{projectId,mode,headers:()=>({})});return window.controller.ready;};</script>';
 await page.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());if(url.pathname==='/fixture.html')return route.fulfill({contentType:'text/html',body:html});
   if(url.pathname!=='/api/investmentops')return route.fulfill({status:404,body:''});
   if(req.method()==='GET'){
     const id=url.searchParams.get('projectId');if(id===state.delayProject)await new Promise(r=>setTimeout(r,180));
     return route.fulfill(state.failGet?{status:503,json:{ok:false,error:'[系统测试]加载暂不可用'}}:{json:{ok:true,lifecycle:model(id)}}).catch(()=>{});
   }
   const body=req.postDataJSON();writes.push(body);await new Promise(r=>setTimeout(r,60));
   if(state.failPost)return route.fulfill({status:503,json:{ok:false,error:'[系统测试]保存暂不可用'}});
   const m=model(body.projectId);
   if(body.action==='freezeForecast'){m.versions.unshift({id:'v-'+m.versions.length,name:body.name,number:m.versions.length+1,valid:true,kind:'forecast',createdAt:Date.now(),payload:{kind:'forecast',parameters:{rent:40},annualValues:[annual]}});return route.fulfill({json:{ok:true,formalApproval:false}});}
   if(body.action==='recordActual'){
     try{L.normalizeActual(body.actual);}catch(e){return route.fulfill({status:400,json:{ok:false,error:e.message}});}
     const version=Math.max(0,...m.actuals.filter(x=>L.basisKey(x)===L.basisKey(body.actual)).map(x=>x.version));if(version!==body.actual.expectedVersion)return route.fulfill({status:409,json:{ok:false,error:'实际值版本冲突'}});
     m.actuals.push({...body.actual,id:'actual-'+m.actuals.length,version:version+1});return route.fulfill({json:{ok:true,version:version+1}});
   }
   return route.fulfill({json:{ok:true,formalApproval:false,warning:'申请留痕，不自动批准'}});
 });
 try{
   await page.goto('http://investment-ui.test/fixture.html');await page.evaluate(()=>enter('project-test-a','plan'));
   assert.match(await page.locator('#host').innerText(),/原批准基准：未配置/);assert.match(await page.locator('#host').innerText(),/暂无冻结预测/);
   await page.locator('[data-il-field="name"]').fill('[系统测试]首次预测');await page.locator('[data-il-action="freeze"]').evaluate(el=>{el.click();el.click();});await page.waitForFunction(()=>document.querySelector('#host').textContent.includes('V1'));
   assert.equal(writes.length,1);assert.equal(writes[0].scenarioId,'scenario-project-test-a');assert.equal(writes[0].metrics,undefined);
   state.failPost=true;await page.locator('[data-il-field="name"]').fill('[系统测试]失败保留');await page.locator('[data-il-action="freeze"]').click();await page.waitForFunction(()=>document.querySelector('[data-il-message]').textContent.includes('保存暂不可用'));assert.equal(await page.locator('[data-il-field="name"]').inputValue(),'[系统测试]失败保留');
   const retryKey=writes.at(-1).requestKey;state.failPost=false;await page.locator('[data-il-action="freeze"]').click();await page.waitForFunction(()=>document.querySelector('#host').textContent.includes('V2'));assert.equal(writes.at(-1).requestKey,retryKey);
   await page.evaluate(()=>enter('project-test-a','operations'));
   for(const [key,value] of Object.entries({periodStart:'2026-01-01',periodEnd:'2026-12-31',value:'80',basis:'rent:income.total',sourceEvidenceId:'evidence-test',sourceRef:'[系统测试]真实凭证'}))await page.locator('[data-il-field="'+key+'"]').fill(value);
   await page.locator('[data-il-action="actual"]').click();await page.waitForFunction(()=>document.querySelector('[data-il-message]').textContent.includes('明确确认'));assert.equal(await page.locator('[data-il-field="value"]').inputValue(),'80');
   await page.locator('[data-il-field="confirmed"]').check();const before=writes.length;await page.locator('[data-il-action="actual"]').evaluate(el=>{el.click();el.click();});await page.waitForFunction(()=>document.querySelector('#host').textContent.includes('差额 -20'));assert.equal(writes.length,before+1);
   await page.locator('[data-il-correct]').click();assert.equal(await page.locator('[data-il-field="confirmed"]').isChecked(),false);await page.locator('[data-il-field="value"]').fill('81');
   await page.evaluate(()=>enter('project-test-b','operations'));assert.equal(await page.locator('[data-il-field="value"]').inputValue(),'');await page.evaluate(()=>enter('project-test-a','operations'));assert.equal(await page.locator('[data-il-field="value"]').inputValue(),'81');
   state.actor=2;await page.evaluate(()=>enter('project-test-a','operations'));assert.equal(await page.locator('[data-il-field="value"]').inputValue(),'');state.actor=1;
   state.failGet=true;await page.evaluate(()=>enter('project-test-a','operations'));assert.match(await page.locator('[data-il-error]').innerText(),/加载暂不可用/);state.failGet=false;await page.locator('[data-il-retry]').click();await page.locator('[data-il-action="actual"]').waitFor();assert.equal(await page.locator('[data-il-field="value"]').inputValue(),'81');
   state.delayProject='project-test-a';await page.evaluate(()=>{enter('project-test-a','plan');enter('project-test-b','operations');});await page.waitForFunction(()=>document.querySelector('[data-il-project]')?.dataset.ilProject==='project-test-b');await page.waitForTimeout(220);assert.equal(await page.locator('[data-il-project]').getAttribute('data-il-project'),'project-test-b');
   state.readOnly=true;state.delayProject='';await page.evaluate(()=>enter('project-test-a','operations'));assert.equal(await page.locator('[data-il-action="actual"]').count(),0);assert.deepEqual(errors,[]);
   console.log(JSON.stringify({ok:true,checks:['empty/loading/normal','explicit-selected-freeze','duplicate-click','failed-write-preserves-input-and-request-key','actual-confirmation-and-variance','correction-reconfirmation','project-draft-isolation','actor-draft-isolation','read-error-retry','late-response-fencing','viewer-read-only'],requestsWritten:writes.length,browserErrors:errors.length}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
