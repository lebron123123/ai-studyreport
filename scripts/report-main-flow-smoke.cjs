// Actual report/AI-report/review modules; synthetic API and draft persistence only.
// No external model, project database, real report, signing or Word export is used.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/HP/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const files=['project-workflow.js','report-trust.js','report-argument.js','report-evidence-graph.js','report-numeric-audit.js','report-orchestration-client.js','report.js','review.js','aireport.js','app.js'];
const source=new Map(files.map(name=>[name,fs.readFileSync(path.join(__dirname,'..',name),'utf8')]));
const fixtureHtml=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>系统测试：报告主链路</title>
<style>body{font:15px system-ui;margin:24px;max-width:1000px;color:#17304b}button{padding:8px;margin:4px}details{border:1px solid #ccd7e2;padding:12px;margin:10px 0}summary{cursor:pointer}li{padding:10px}.section-block{border-bottom:1px solid #ccc}.air-trust-badge{font-size:12px}#fixtureState{white-space:pre-wrap}</style><body>
<h1>[系统测试] 报告生成与来源复核</h1><button id="fixtureResume">继续生成</button><button id="fixtureStop">停止后续小节</button><button id="fixtureReview">复核预览</button><button id="airSend">发送</button><textarea id="airInput"></textarea><output id="fixtureState"></output><main id="sheet"></main>
<script>var currentProjectId='project-report-fixture',calcType='rent',calcParams={},calcResult=null,CALC_CFG={};function authHeaders(){return {};}function surveyBrief(){return '';}function exportWord(){throw Error('Fixture forbids Word export');}window.alerts=[];window.alert=t=>alerts.push(String(t));</script>
${files.map(name=>'<script src="/'+name+'"></script>').join('')}
<script>
// Infrastructure is memory-only; the business generation, dependency ordering,
// provenance, version creation, preview and source event bindings remain real.
saveDraft=()=>{};airSaveState=async()=>{};airSaveLocalState=()=>{};
window.REPORT_GENERATION_CONCURRENCY=2;
function fixtureReset(){
 currentProjectId='project-report-fixture';calcType='rent';calcParams={};calcResult=null;ragAvailable=false;signed=false;
 Object.assign(project,{name:'[系统测试]报告路径',owner:'测试单位',industry:'住房',location:'测试地点',type:'出租',scale:'',desc:'仅用于浏览器隔离验证'});
 chapters=[{cn:1,name:'总论',checked:true,sections:[{t:'结论与建议',content:''}]},{cn:2,name:'市场分析',checked:true,sections:[{t:'市场需求',content:''}]},{cn:3,name:'项目条件',checked:true,sections:[{t:'建设条件',content:''}]},{cn:4,name:'风险分析',checked:true,sections:[{t:'风险核对',content:''}]}];
 kbEntries=[{id:'fixture-source',title:'市场需求调查',sourceRef:'fixture-material#paragraph-1',version:'fixture-v1',content:'本项目应先核实目标客群的实际住房需求。'}];
 projectWorkflow=ProjectWorkflow.ensureState({projectId:currentProjectId});aiReportChat=[];aiReportMsgSeq=0;aiReportProgressMsg=null;aiReportPendingTasks=null;aiReportStopFlag=false;aiReportBusy=false;aiReportGenerationLockId=null;
 document.getElementById('sheet').innerHTML=chapters.map(c=>'<section class="section-block" id="sec_'+c.cn+'_0"><h4>'+c.name+' / '+c.sections[0].t+'</h4><div class="body"></div></section>').join('');
 document.getElementById('fixtureState').textContent='ready';
}
document.getElementById('fixtureResume').onclick=()=>{void airResumeGeneration().then(()=>{document.getElementById('fixtureState').textContent=JSON.stringify(airReportGenerationStatus());}).catch(e=>{document.getElementById('fixtureState').textContent='ERROR: '+e.stack;});};
document.getElementById('fixtureStop').onclick=()=>{aiReportStopFlag=true;};
document.getElementById('fixtureReview').onclick=()=>{document.getElementById('sheet').innerHTML=stepReview();bindEvents();};
fixtureReset();</script></body></html>`;
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'}),page=await browser.newPage({viewport:{width:1160,height:920}}),errors=[],requests=[],events=[],tasks=new Map();
 const state={delay:100,failSection:null,failOnce:false};let seq=0;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.pathname==='/fixture.html')return route.fulfill({contentType:'text/html',body:fixtureHtml});
  if(source.has(url.pathname.slice(1)))return route.fulfill({contentType:'text/javascript',body:source.get(url.pathname.slice(1))});
  assert.equal(url.pathname,'/api/reportexecution','unexpected external/API call');
  if(req.method()==='POST'){
   const input=req.postDataJSON(),id='fixture-task-'+(++seq);requests.push(input);events.push('start:'+input.sectionKey);
   const task={id,status:'queued',input};tasks.set(id,task);return route.fulfill({json:{ok:true,task:{id,status:'queued'}}});
  }
  const task=tasks.get(url.searchParams.get('id'));assert.ok(task);const delay=state.delay;
  if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
  if(task.input.sectionKey===state.failSection){if(state.failOnce)state.failSection=null;events.push('failed:'+task.input.sectionKey);return route.fulfill({json:{ok:true,task:{id:task.id,status:'dead',error:'[系统测试]后台未能完成本节，可继续恢复'}}});}
  const text=task.input.sectionKey.includes('市场需求')?'本项目应先核实目标客群的实际住房需求。':task.input.sectionKey.includes('结论')?'综合已完成细节，本项目的建设条件仍需独立核查。':task.input.sectionKey.includes('建设条件')?'建设条件应依据正式权属材料与现场资料逐项核对。':'风险分析应分别核实资金条件和运营管理安排。';
  events.push('complete:'+task.input.sectionKey);return route.fulfill({json:{ok:true,task:{id:task.id,status:'completed',text,model:'fixture-model',provider:'fixture-provider'}}});
 });
 const done=()=>page.waitForFunction(()=>!aiReportBusy&&document.getElementById('fixtureState').textContent!=='ready');
 const status=()=>page.evaluate(()=>({busy:aiReportBusy,coverage:airReportGenerationStatus(),versions:projectWorkflow.reportVersions.length,pending:aiReportPendingTasks?.length,chat:aiReportChat.map(x=>({kind:x.kind,content:x.content})),state:document.getElementById('fixtureState').textContent}));
 try{
  await page.goto('http://report-main.test/fixture.html');await page.getByText('ready',{exact:true}).waitFor();
  // Blank editor HTML must not borrow an older raw body to appear complete or skip resuming.
  const blank=await page.evaluate(()=>{
   chapters.forEach((c,i)=>{c.sections[0].content='旧正文必须保留到用户续写成功';c.sections[0].editedHtml=['<p><br></p>','<p>&nbsp;</p>','<p>\u200b\u2060</p>','<table><tr><td>&#160;</td></tr></table>'][i];});
   return {coverage:airReportGenerationStatus(),pending:airRebuildPendingGenerationTasks().length,card:airGenerationIncompleteHtml({}),audit:preSubmitAuditForCurrentReport().ready,generateHtml:stepGenerate()};
  });
  assert.equal(blank.coverage.complete,false);assert.equal(blank.coverage.generated,0);assert.equal(blank.pending,4);assert.equal(blank.audit,false);assert.doesNotMatch(blank.card,/已完整生成/);assert.doesNotMatch(blank.generateHtml,/class="done-stamp"/);
  await page.evaluate(()=>{document.getElementById('fixtureResume').click();document.getElementById('fixtureResume').click();});
  await page.waitForFunction(()=>aiReportBusy);assert.equal(await page.locator('#airSend').isDisabled(),true);await done();
  assert.equal((await status()).coverage.complete,true,JSON.stringify(await status()));assert.equal(requests.length,4);assert.equal((await status()).versions,1);
  assert.equal(await page.evaluate(()=>chapters.every(c=>!c.sections[0].editedHtml&&reportHasVisibleBody(c.sections[0]))),true);
  assert.doesNotMatch(await page.locator('#sheet').textContent(),/旧正文必须保留/);
  const summary=requests.find(x=>x.sectionKey==='总论 / 结论与建议');assert.ok(summary);assert.match(summary.user,/本项目应先核实目标客群/);assert.match(summary.user,/建设条件应依据正式权属材料/);
  for(const input of requests){assert.equal(input.projectId,'project-report-fixture');assert.match(input.system,/【本节论证任务】/);assert.doesNotMatch(input.system,/500-800字/);}
  assert.ok(events.indexOf('start:总论 / 结论与建议')>events.indexOf('complete:风险分析 / 风险核对'));
  const prov=await page.evaluate(()=>chapters[1].sections[0].prov);assert.equal(prov.confidence.score,null);assert.equal(prov.model,'fixture-model');assert.ok(prov.promptVersion);assert.equal(prov.kbDocs[0].sourceRef,'fixture-material#paragraph-1');
  assert.doesNotMatch(await page.locator('.air-trust-badge').allTextContents().then(x=>x.join(' ')),/\d+\s*%|准确率/);
  // The real review renderer and app.bindEvents must make evidence buttons work.
  const beforeReview=requests.length;await page.locator('#fixtureReview').click();
  const audit=page.locator('#sheet > details');await audit.locator(':scope > summary').click();
  await page.getByText(/逐句查看依据/).click();
  const claims=page.locator('details.report-claim-detail');
  // Selector intentionally follows the public evidence-target attribute, not internal state.
  const target=page.locator('[data-report-evidence-target]').first();
  await target.evaluate(el=>{for(let d=el.closest('details');d;d=d.parentElement?.closest('details'))d.open=true;});await target.click();
  assert.match(await page.evaluate(()=>document.activeElement.id),/^report-evidence-/);assert.equal(new URL(page.url()).hash,'');assert.equal(requests.length,beforeReview);
  assert.match(await audit.textContent(),/非准确率|不证明真实性/);assert.equal(await page.evaluate(()=>signed),false);
  await page.screenshot({path:path.join(__dirname,'../outputs/0907-report-main-flow-review.png')});
  // A failed detail must block the summary, preserve completed details, and not create a full version.
  await page.evaluate(()=>fixtureReset());requests.length=0;events.length=0;state.failSection='项目条件 / 建设条件';state.failOnce=true;
  await page.locator('#fixtureResume').click();await done();let snapshot=await status();assert.equal(snapshot.coverage.generated,2,JSON.stringify(snapshot));assert.equal(snapshot.versions,0);assert.equal(requests.some(x=>x.sectionKey.startsWith('总论')),false);assert.equal(await page.locator('#airSend').isDisabled(),false);assert.ok(snapshot.chat.some(x=>x.kind==='generationIncomplete'));
  const originalMarket=await page.evaluate(()=>chapters[1].sections[0].content);await page.locator('#fixtureResume').click();await done();assert.equal((await status()).coverage.complete,true);assert.equal((await status()).versions,1);assert.equal(await page.evaluate(()=>chapters[1].sections[0].content),originalMarket);assert.equal(requests.filter(x=>x.sectionKey==='市场分析 / 市场需求').length,1);
  // Cancel only prevents subsequent work; in-flight results remain recoverable.
  await page.evaluate(()=>fixtureReset());requests.length=0;events.length=0;state.delay=300;
  await page.locator('#fixtureResume').click();await page.waitForFunction(()=>document.querySelectorAll('[data-status=gen]').length===2);await page.locator('#fixtureStop').click();await done();snapshot=await status();assert.equal(snapshot.coverage.generated,2);assert.equal(snapshot.versions,0);assert.equal(snapshot.pending,2);assert.equal(requests.some(x=>x.sectionKey.startsWith('总论')),false);
  await page.locator('#fixtureResume').click();await done();assert.equal((await status()).coverage.complete,true);assert.equal(requests.length,4);
  // Unsaved/mismatched cumulative figures must be blocked in actual review context.
  await page.evaluate(()=>{calcParams={term:10};calcResult={summary:{totalIncome:123}};projectWorkflow.calcSnapshots=[{id:'fixture-calc',calcType:'rent',version:1,reason:'系统测试',params:{term:10},summary:{totalIncome:123}}];projectWorkflow.currentCalcSnapshotId='fixture-calc';chapters[1].sections[0].content='累计总收入为999万元。';});
  const mismatch=await page.evaluate(()=>preSubmitAuditForCurrentReport());assert.equal(mismatch.ready,false);assert.ok(mismatch.issues.some(x=>x.code.startsWith('NUMERIC_')&&x.severity==='blocker'));
  await page.evaluate(()=>{chapters.forEach(c=>c.sections.forEach(s=>s.content=''));});assert.equal((await page.evaluate(()=>preSubmitAuditForCurrentReport())).ready,false);
  const stale=await page.evaluate(()=>{chapters=[{cn:1,name:'项目条件',checked:true,sections:[{t:'建设条件',content:'旧版本正文仍需核对。',syncStatus:'stale'}]}];const before=JSON.stringify(chapters);let summaryBlocked=false;try{ReportArgument.summaryContext(chapters,'总论','结论');}catch(e){summaryBlocked=/等待正文完成/.test(e.message);}return {pending:airRebuildPendingGenerationTasks().length,unchanged:before===JSON.stringify(chapters),summaryBlocked,audit:preSubmitAuditForCurrentReport().ready};});
  assert.deepEqual(stale,{pending:0,unchanged:true,summaryBlocked:true,audit:false});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,consoleErrors:errors,states:['blank-html-not-complete','blank-editor-resume','actual-argument-prompt','details-before-summary','no-fake-confidence','actual-review-evidence-navigation','read-only-review','failure-keeps-details','resume-missing-only','double-start','cancel-resume','numeric-mismatch','empty-report','stale-kept-not-approved'],boundary:'Synthetic API/draft fixture; no external AI, real project, Word export or human approval.'}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
