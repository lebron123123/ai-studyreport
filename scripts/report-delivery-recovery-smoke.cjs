// Production delivery UI with in-memory API fixtures. Never touches real reports or approval records.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/HP/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'}),page=await browser.newPage({viewport:{width:1100,height:900}}),errors=[],posts=[];
 page.on('pageerror',e=>errors.push(e.message));
 const state={role:'OWNER',userId:1,hash:'a'.repeat(64),updatedAt:1000,versions:[],failFiles:true,failPost:false,failGet:false,delayGet:120,delayPost:150};
 const version=()=>({id:'frozen-test',created_at:Date.now(),content_hash:state.hash,status:'pending',current:true,reviewer_id:2,result:{passed:true,checks:[]}});
 const fixture='http://delivery.test/fixture.html',source=fs.readFileSync(path.join(__dirname,'../report-delivery-ui.js'),'utf8');
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.pathname==='/fixture.html')return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><body><script>var currentProjectId="project-test-a",testActor="test-owner",reportDocumentRevision=0,reportCloudPersistedRevision=0,reportChapters=[{content:"[系统测试]本地正文不自动覆盖"}];function authHeaders(){return {};}function getUser(){return testActor;}</script><script>'+source+'</script><script>ReportDeliveryUI.open();</script></body>'});
  if(url.pathname==='/api/projectartifacts')return route.fulfill(state.failFiles?{status:503,json:{ok:false,error:'[系统测试]原件暂不可用'}}:{json:{ok:true,items:[]}});
  assert.equal(url.pathname,'/api/reportdelivery');
  if(req.method()==='GET'){
   if(state.failGet)return route.fulfill({status:503,json:{ok:false,error:'[系统测试]版本列表暂不可用'}});
   const result=JSON.parse(JSON.stringify({role:state.role,userId:state.userId,currentHash:state.hash,updatedAt:state.updatedAt,versions:state.versions})),delay=state.delayGet;
   if(delay)await new Promise(r=>setTimeout(r,delay));return route.fulfill({json:{ok:true,result}});
  }
  const body=req.postDataJSON();posts.push(body);
  if(state.delayPost)await new Promise(r=>setTimeout(r,state.delayPost));
  if(state.failPost)return route.abort('failed');
  if(body.action==='freeze'){
   if(body.expectedContentHash!==state.hash)return route.fulfill({status:409,json:{ok:false,error:'后台已保存的正文或测算已变化，请重新读取版本后再冻结'}});
   if(!state.versions.length)state.versions.push(version());
  }else if(body.action==='restoreWorkingDraft'){
   assert.equal(body.confirmRestore,true);
   if(body.expectedContentHash!==state.hash||body.expectedUpdatedAt!==state.updatedAt)return route.fulfill({status:409,json:{ok:false,error:'后台工作稿已变化，请重新读取后再恢复'}});
   state.updatedAt++;state.hash='e'.repeat(64);
   if(state.failGetAfterRestore)state.failGet=true;
   return route.fulfill({json:{ok:true,result:{id:body.id,workingDraft:true,updatedAt:state.updatedAt,requiresReview:true,requiresReload:true}}});
  }else{
   assert.equal(body.action,'approve');assert.equal(body.factsReviewed,true);assert.equal(body.wordLayoutReviewed,true);assert.ok(body.note);state.versions[0].status='approved';
  }
  return route.fulfill({json:{ok:true,result:{id:'frozen-test'}}});
 });
 const button=name=>page.getByRole('button',{name,exact:true}),status=()=>page.locator('#reportDeliveryDialog [role=status]');
 const ready=async()=>{await page.waitForFunction(()=>{const status=document.querySelector('#reportDeliveryDialog [role=status]');return status&&!status.textContent.includes('正在读取');});};
 try{
  await page.goto(fixture);assert.equal(await button('冻结后台已保存版本').isDisabled(),true);await ready();
  assert.equal(await button('冻结后台已保存版本').isDisabled(),false);assert.match(await status().textContent(),/原件暂不可用/);
  await page.getByRole('spinbutton',{name:'复核成员账号ID'}).fill('2');await page.getByRole('textbox',{name:'验收检查合同'}).fill('{"numbers":[{"label":"总投资","value":100,"unit":"万元"}]}');
  await page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent==='冻结后台已保存版本');b.onclick();b.onclick();});
  await page.waitForFunction(()=>document.querySelector('[role=status]').textContent.includes('等待后台'));assert.doesNotMatch(await status().textContent(),/完成|已由后台确认/);
  await page.getByText(/pending · 当前正文/).waitFor();await page.waitForFunction(()=>document.querySelector('[role=status]').textContent==='操作已由后台确认');assert.equal(posts.length,1);assert.equal(posts[0].expectedContentHash,'a'.repeat(64));
  state.failPost=true;await button('冻结后台已保存版本').click();await page.getByText(/提交未获后台确认/).waitFor();assert.equal(await page.getByRole('spinbutton',{name:'复核成员账号ID'}).inputValue(),'2');state.failPost=false;
  state.hash='b'.repeat(64);await button('冻结后台已保存版本').click();await page.getByText(/已变化，请重新读取版本/).waitFor();assert.equal(state.versions.length,1);
  state.failFiles=false;await button('重新读取归档原件').click();await page.getByText('尚无归档原件。',{exact:true}).waitFor();
  const beforeAccountSwitch=posts.length;await page.evaluate(()=>testActor='test-another-owner');await button('冻结后台已保存版本').click();assert.equal(posts.length,beforeAccountSwitch,'old account dialog must not submit under a different account');
  // Explicit independent reviewer confirmation: no prechecked flags or automatic pass.
  state.role='VIEWER';state.userId=2;state.hash='a'.repeat(64);await page.reload();await ready();
  assert.equal(await button('冻结后台已保存版本').isDisabled(),true);assert.equal(await button('确认独立复核通过').isDisabled(),true);
  await page.getByRole('checkbox',{name:'已逐项核实事实数值'}).check();await page.getByRole('checkbox',{name:'已检查实际Word版式'}).check();assert.equal(await button('确认独立复核通过').isDisabled(),true);
  await page.getByRole('textbox',{name:'复核依据'}).fill('[系统测试]模拟核查依据，不是正式审签');assert.equal(await button('确认独立复核通过').isDisabled(),false);
  await button('确认独立复核通过').click();await page.getByText(/approved · 当前正文/).waitFor();assert.equal(posts.filter(x=>x.action==='approve').length,1);await page.reload();await ready();assert.equal(await button('确认独立复核通过').count(),0);
  state.versions=[{...version(),current:false}];await page.reload();await ready();await page.getByRole('checkbox',{name:'已逐项核实事实数值'}).check();await page.getByRole('checkbox',{name:'已检查实际Word版式'}).check();await page.getByRole('textbox',{name:'复核依据'}).fill('旧正文');assert.equal(await button('确认独立复核通过').isDisabled(),true);
  state.role='EDITOR';await page.reload();await ready();assert.equal(await button('确认独立复核通过').count(),0);assert.equal(await button('恢复为未签发工作稿').count(),0);
  // OWNER recovery is explicit, CAS-guarded, and never mutates the open editor or approval history.
  state.role='OWNER';state.userId=1;state.versions=[{...version(),status:'approved'}];await page.reload();await ready();
  const restore=()=>button('恢复为未签发工作稿'),beforeRestore=posts.length,history=JSON.stringify(state.versions);
  await page.evaluate(()=>{reportDocumentRevision=2;reportCloudPersistedRevision=1;});await restore().click();await page.getByText(/存在未获后台保存确认的编辑/).waitFor();assert.equal(posts.length,beforeRestore);
  await page.evaluate(()=>{reportCloudPersistedRevision=2;});page.once('dialog',d=>d.dismiss());await restore().click();await page.getByText('已取消，未修改后台记录',{exact:true}).waitFor();assert.equal(posts.length,beforeRestore);
  state.updatedAt++;page.once('dialog',d=>d.accept());await restore().click();await page.getByText('后台工作稿已变化，请重新读取后再恢复',{exact:true}).waitFor();assert.equal(JSON.stringify(state.versions),history);
  await button('重新读取后台版本').click();await page.waitForFunction(()=>document.querySelector('[role=status]').textContent==='操作已由后台确认');
  state.failGetAfterRestore=true;page.once('dialog',d=>{assert.match(d.message(),/项目事实及测算不回滚/);return d.accept();});
  const restoreCount=posts.filter(x=>x.action==='restoreWorkingDraft').length;
  await page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent==='恢复为未签发工作稿');b.onclick();b.onclick();});
  await page.getByText(/后台已恢复为待复核、未签发工作稿/).waitFor();assert.equal(posts.filter(x=>x.action==='restoreWorkingDraft').length,restoreCount+1);
  assert.match(await status().textContent(),/后续版本列表读取失败/);assert.match(await status().textContent(),/当前测算未回滚/);assert.equal(await restore().isDisabled(),true);assert.equal(await button('冻结后台已保存版本').isDisabled(),true);
  assert.equal(await page.evaluate(()=>reportChapters[0].content),'[系统测试]本地正文不自动覆盖');assert.equal(JSON.stringify(state.versions),history);
  state.failGet=false;state.failGetAfterRestore=false;await button('重新读取后台版本').click();await page.waitForFunction(()=>document.querySelector('[role=status]').textContent==='操作已由后台确认');assert.equal(await restore().isDisabled(),true);
  await page.reload();await ready();assert.equal(await restore().isDisabled(),false);assert.equal(JSON.stringify(state.versions),history);
  // Closing and changing projects invalidates delayed reads from the previous dialog.
  state.delayGet=400;state.versions=[{...version(),content_hash:'c'.repeat(64)}];await page.evaluate(()=>{void ReportDeliveryUI.open();});
  state.delayGet=0;state.versions=[{...version(),content_hash:'d'.repeat(64)}];await page.evaluate(()=>{currentProjectId='project-test-b';void ReportDeliveryUI.open();});await page.getByText(/版本 dddddddddddd/).waitFor();await page.waitForTimeout(450);assert.equal(await page.getByText(/版本 cccccccccccc/).count(),0);assert.equal(await page.locator('#reportDeliveryDialog').count(),1);
  await page.screenshot({path:path.join(__dirname,'../outputs/0907-report-delivery-recovery.png')});await button('关闭').click();await page.locator('#reportDeliveryDialog').waitFor({state:'detached'});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,posts:posts.length,approvalPosts:1,errors,states:['loading','partial-failure','duplicate-freeze','server-confirmation','network-unknown','saved-hash-conflict','file-retry','account-isolation','VIEWER-explicit-confirmation','refresh-persistence','stale-version','EDITOR-denied','restore-unsaved-blocked','restore-cancelled','restore-CAS-conflict','restore-double-click','restore-read-failure','restore-local-and-history-preserved','restore-refresh','close/reopen/late-response']}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
