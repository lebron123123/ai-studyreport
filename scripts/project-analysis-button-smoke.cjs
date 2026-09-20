// Repeated browser-button regression for project analysis. Data and writes stay in memory.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/HP/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),assert=require('node:assert/strict'),source=fs.readFileSync('analysis-workbench.js','utf8');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'}),page=await browser.newPage(),errors=[],actions=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());
  if(url.pathname==='/fixture')return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><main id="sheet"></main><script>var currentProjectId="[系统测试]项目";var projectWorkflow={analysisSnapshots:[]},chapters=[];function authHeaders(){return {}}function saveDraft(){}window.AnalysisCore={impactPreview:()=>({changedDomains:[]})};window.ProjectWorkflow={markAnalysisImpacted(){}};window.AnalysisProviders={template:k=>[{kind:k,value:""}],normalize:()=>({rows:[],errors:[]})};URL.createObjectURL=()=>"blob:test";URL.revokeObjectURL=()=>{};HTMLAnchorElement.prototype.click=function(){window.__downloads=(window.__downloads||0)+1};</script><script src="/analysis-workbench.js"></script><script>sheet.innerHTML=renderAnalysisWorkbench();bindAnalysisWorkbench()</script>'});
  if(url.pathname==='/analysis-workbench.js')return route.fulfill({contentType:'text/javascript',body:source});
  if(url.pathname!='/api/projectanalysis')return route.fulfill({status:404,body:''});
  if(req.method()==='POST'){const b=req.postDataJSON();actions.push(b.action);if(b.action==='snapshot')return route.fulfill({json:{ok:true,snapshot:{id:'snap'+actions.length,version:actions.length,status:'official',result:{population:{available:true},balance:{available:true},commute:{available:true},demand:{available:true,scenarios:[{},{}]},facilities:{available:true}}}}});return route.fulfill({json:{ok:true,message:'已进入审核',saved:1}});}
  if(url.searchParams.get('action')==='catalog')return route.fulfill({json:{ok:true,logicRules:[{id:'r1'}]}});
  return route.fulfill({json:{ok:true,scope:{longitude:114.1,latitude:22.5},officialResult:{ready:true,scopeKm:3,missing:[],population:{available:true},balance:{available:true},commute:{available:true},demand:{available:true,scenarios:[{},{}]},facilities:{available:true,overallScore:80}},observations:[],pois:[],odFlows:[]}});
 });
 let clicks=0;const click=async sel=>{await page.locator(sel).click();clicks++;};
 try{
  await page.goto('http://analysis.test/fixture');await page.locator('#anReload').waitFor();
  for(const tab of ['overview','scope','import','source'])for(let i=0;i<5;i++)await click('[data-atab="'+tab+'"]');
  await click('[data-atab="overview"]');await page.locator('#anReload').waitFor();
  for(let i=0;i<5;i++){await click('#anReload');await page.locator('#anReload').waitFor();}
  for(let i=0;i<5;i++){await click('#anSnapshot');await page.locator('#anSnapshot').waitFor();}
  await click('[data-atab="scope"]');await page.locator('#anSaveScope').waitFor();
  for(let i=0;i<5;i++){await click('#anSaveScope');await page.locator('#anSaveScope').waitFor();}
  await click('[data-atab="import"]');await page.locator('#anTemplate').waitFor();
  for(const kind of ['observation','poi','od']){await page.locator('#anKind').selectOption(kind);for(let i=0;i<5;i++)await click('#anTemplate');}
  for(let i=0;i<5;i++)await click('#anSubmitFile');
  assert.equal(await page.locator('#anImportMsg').textContent(),'请选择文件');assert.equal(await page.evaluate(()=>window.__downloads||0),15);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,buttonTypes:9,clicks,repeat:'5（模板3类各5次）',apiWrites:actions.length,actions,consoleErrors:errors,states:['four-tabs','refresh','snapshot','scope-save','three-template-downloads','empty-upload-protection']}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
