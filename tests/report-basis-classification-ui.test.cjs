const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
require('../scripts/windows-browser-lockout-guard.cjs');
const source=fs.readFileSync(require.resolve('../report.js'),'utf8'),entry=source.slice(source.indexOf('function reportBasisGroupOptions('),source.indexOf('function reportCompletionEntries('));
test('依据分类选项保留发布层级和已有分类，未登记不按文件名推断',()=>{
  const box=vm.createContext({});vm.runInContext(entry,box);
  const declared={requiredHeadings:[{level:3,text:'地方依据'},{level:4,text:'深圳市'},{level:4,text:'罗湖区'},{level:3,text:'集团依据'}]};
  const choices=JSON.parse(JSON.stringify(box.reportBasisGroupOptions(declared,[{title:'某国家文件',groups:[{level:3,text:'项目专属依据'}]}])));
  assert.deepEqual(choices.map(x=>x.label),['地方依据','地方依据 / 深圳市','地方依据 / 罗湖区','集团依据','项目专属依据']);assert.deepEqual(choices[2].groups,[{level:3,text:'地方依据'},{level:4,text:'罗湖区'}]);
  assert.deepEqual(JSON.parse(JSON.stringify(box.reportBasisGroupOptions({},[{title:'国家字样但未核实文件'}]))).map(x=>x.label),['国家层面依据','地方层面依据','集团层面依据','项目专属依据']);
});
test('真实隔离浏览器：人工依据分类、取消、保存失败重试、重复打开与身份保护',{timeout:45000},async()=>{
  const {chromium}=require('playwright'),browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.route('https://report-basis.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><main>[系统测试]依据分类</main>'}));await page.goto('https://report-basis.test/');
    for(const file of ['report-length-plan.js','report-completion-contract.js','report-argument.js'])await page.addScriptTag({path:require.resolve('../'+file)});
    await page.evaluate(()=>{
      window.currentProjectId='[系统测试]A';window.projectCanEdit=()=>true;window.projectWorkflow={reportCompletion:{budgets:{},history:[]}};window.__saves=0;window.__failure=false;window.__beforeSave=null;
      window.__item={title:'已上传项目协议',status:'received',ownerKey:'总论 / 编制依据',required:true,evidence:{sourceId:'[系统测试]file',sourceHash:'a'.repeat(64),locator:'原件'},verification:{}};
      window.__plan=ReportCompletionContract.createPlan([{name:'总论',sections:[{t:'编制依据'}]}]);
      window.reportCompletionPlan=()=>__plan;window.reportBasisCatalogFor=async()=>structuredClone(projectWorkflow.reportCompletion.basisCatalogs?.['总论 / 编制依据']||{items:[__item]});window.reportBasisMaterialItems=async()=>[structuredClone(__item)];window.reportBasisMaterialCatalog=async()=>({items:[structuredClone(__item)],diagnostics:[]});
      window.escapeHtml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');window.alert=message=>{throw new Error(message);};
      window.persistReportDraft=async()=>{__saves++;if(__beforeSave)await __beforeSave();return {ok:!__failure};};window.reportCompletionReviewHtml=()=>'';
    });await page.addScriptTag({content:entry});
    const original=await page.evaluate(()=>JSON.stringify(projectWorkflow));await page.evaluate(()=>Promise.all([reportEditBasisCatalog(0),reportEditBasisCatalog(0)]));assert.equal(await page.locator('#reportBasisEditor').count(),1);assert.equal(await page.locator('[data-basis-group="0"]').inputValue(),'-1');
    await page.locator('[data-basis-group="0"]').selectOption('0');await page.locator('[data-basis-close]').last().click();assert.equal(await page.evaluate(()=>JSON.stringify(projectWorkflow)),original);assert.equal(await page.evaluate(()=>__saves),0);
    await page.evaluate(()=>reportEditBasisCatalog(0));await page.locator('[data-basis-group="0"]').selectOption('1');await page.evaluate(()=>{__failure=true;});await page.locator('[data-basis-save]').click();await page.waitForFunction(()=>!document.querySelector('[data-basis-save]').disabled);assert.match(await page.locator('[data-basis-status]').innerText(),/原目录未替换/);assert.equal(await page.evaluate(()=>JSON.stringify(projectWorkflow)),original);assert.equal(await page.locator('[data-basis-group="0"]').inputValue(),'1');
    await page.evaluate(()=>{__failure=false;});await page.locator('[data-basis-save]').click();await page.locator('#reportBasisEditor').waitFor({state:'detached'});
    const saved=await page.evaluate(()=>projectWorkflow.reportCompletion.basisCatalogs['总论 / 编制依据']);assert.deepEqual(saved.items[0].groups,[{level:3,text:'地方层面依据'}]);assert.equal(saved.items[0].title,'已上传项目协议');assert.equal(saved.items[0].evidence.sourceHash,'a'.repeat(64));assert.equal(saved.items[0].status,'received');
    for(let i=0;i<3;i++){await page.evaluate(()=>reportEditBasisCatalog(0));assert.equal(await page.locator('[data-basis-group="0"]').inputValue(),'1');await page.locator('[data-basis-close]').last().click();}
    await page.evaluate(()=>reportEditBasisCatalog(0));const before=await page.evaluate(()=>JSON.stringify(projectWorkflow));await page.locator('[data-basis-group="0"]').selectOption('3');await page.evaluate(()=>{currentProjectId='[系统测试]B';});await page.locator('[data-basis-save]').click();await page.waitForFunction(()=>document.querySelector('[data-basis-status]').textContent.includes('项目或计划已变化'));assert.equal(await page.evaluate(()=>JSON.stringify(projectWorkflow)),before);assert.equal(await page.evaluate(()=>__saves),2);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
