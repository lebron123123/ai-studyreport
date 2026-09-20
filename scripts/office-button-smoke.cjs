// Repeated browser-button regression for AI Office. APIs and exports stay in memory.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/HP/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),assert=require('node:assert/strict'),source=fs.readFileSync('office.js','utf8');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'}),page=await browser.newPage(),errors=[],apiCalls=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());
  if(url.pathname==='/fixture')return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><main id="sheet"></main><script>var officeView="chat";function authHeaders(){return {}}function escapeHtml(s){return String(s||"").replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]))}function renderContent(s){return "<p>"+escapeHtml(s)+"</p>"}function renderSheet(){sheet.innerHTML=officeView==="ppt"?renderPptWorkspace():stepOffice();bindOfficeEvents()}function renderPptWorkspace(){return `<div class="office-mode-tabs"><button data-office-view="chat">AI对话与文稿</button><button class="active" data-office-view="ppt">AI PPT</button></div><p>PPT工作台测试替身</p>`}function bindPptWorkspace(){}window.AgentCore={run:async()=>({text:"[系统测试]办公回答\\n[[TABLE]]\\n项目|状态\\n测试|正常\\n[[/TABLE]]",trace:[]})};window.MD={parseBlocks:s=>[{type:"para",text:s}],renderHtml:s=>"<p>"+escapeHtml(s)+"</p>",stripInline:s=>s};</script><script src="/office.js"></script><script>officeExport=async function(kind){window.__exports=(window.__exports||[]).concat(kind)};renderSheet()</script>'});
  if(url.pathname==='/office.js')return route.fulfill({contentType:'text/javascript',body:source});
  apiCalls.push(req.method()+' '+url.pathname);
  if(url.pathname==='/api/officechat')return route.fulfill({json:{ok:true,chat:[]}});
  if(url.pathname==='/api/generate')return route.fulfill({json:{ok:true,chat:{left:90,limit:100}}});
  if(url.pathname==='/api/rag')return route.fulfill({json:{ok:true,matches:[]}});
  return route.fulfill({status:404,body:''});
 });
 let clicks=0;const click=async sel=>{await page.locator(sel).click();clicks++;};
 try{
  await page.goto('http://office.test/fixture');await page.locator('#officeSend').waitFor();
  for(let i=0;i<5;i++){await click('[data-office-view="ppt"]');await page.locator('[data-office-view="chat"]').waitFor();await click('[data-office-view="chat"]');await page.locator('#officeSend').waitFor();}
  for(let i=0;i<5;i++){await page.locator('#officeInput').fill('[系统测试]第'+i+'次起草周报');await click('#officeSend');await page.waitForFunction(()=>!document.getElementById('officeSend').disabled);}
  for(let i=0;i<5;i++){await click('#officeExportWord');await page.locator('#opClose').waitFor();await click('#opClose');}
  for(let i=0;i<5;i++){await click('#officeExportExcel');await page.locator('#opCancel').waitFor();await click('#opCancel');}
  for(let i=0;i<5;i++){await click('#officeExportWord');await page.locator('#opConfirm').waitFor();await click('#opConfirm');}
  for(let i=0;i<5;i++){await page.evaluate(()=>{officeChat.push({role:'assistant',content:'[系统测试]可清理内容'});renderOfficeMsgs();document.getElementById('officeActions').style.display='block'});await click('#officeClearChat');await page.waitForTimeout(20);}
  const exports=await page.evaluate(()=>window.__exports||[]);
  assert.equal(exports.length,5);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,buttonTypes:9,clicks,repeat:5,apiCalls:apiCalls.length,exports,consoleErrors:errors,states:['chat/ppt-switch','send/restore','word-preview/close','excel-preview/cancel','confirm-export','clear-confirm']}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
