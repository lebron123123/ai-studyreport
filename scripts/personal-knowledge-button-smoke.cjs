// Full button regression for the personal knowledge workspace. All data/API calls stay in memory.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/HP/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),assert=require('node:assert/strict'),source=fs.readFileSync('personal-knowledge.js','utf8');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'}),page=await browser.newPage(),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.type()==='prompt'?d.accept('[系统测试]文件夹'):d.accept());
 const items=[{id:'n1',kind:'note',parentId:'',title:'[系统测试]笔记',content:'测试内容',tags:['测试'],favorite:false,revision:1,sourceName:'',sourceType:'',status:'active'}];let seq=1;
 await page.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());
  if(url.pathname==='/fixture')return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><main id="sheet"></main><script>var appMode="personal",collabTab="";function authHeaders(){return {}}function renderTOC(){}function loadCollabTab(){document.getElementById("collabBody").textContent="[系统测试]部门页"}function renderSheet(){sheet.innerHTML=renderPersonalKnowledge();bindPersonalKnowledge()}window.MD={renderHtml:s=>"<p>"+s+"</p>"};</script><script src="/personal-knowledge.js"></script><script>renderSheet()</script>'});
  if(url.pathname==='/personal-knowledge.js')return route.fulfill({contentType:'text/javascript',body:source});
  if(url.pathname==='/api/generate')return route.fulfill({json:{ok:true,content:[{text:'[系统测试]AI回答【P1】'}]}});
  if(url.pathname==='/api/contributions')return route.fulfill({json:{ok:true,id:'c1'}});
  if(url.pathname!=='/api/personalnotes')return route.fulfill({status:404,body:''});
  const b=req.postDataJSON();requests.push(b.action);const find=id=>items.find(x=>x.id===id);
  if(b.action==='list')return route.fulfill({json:{ok:true,items:items.filter(x=>x.status===(b.status||'active'))}});
  if(b.action==='get'){const x=find(b.id);return route.fulfill({json:{ok:true,item:x,backlinks:[],outlinks:[]}});}
  if(b.action==='create'){const x={id:'n'+(++seq),kind:b.kind,parentId:b.parentId||'',title:b.title||'[系统测试]新笔记',content:b.content||'',tags:b.tags||[],favorite:false,revision:1,sourceName:b.sourceName||'',sourceType:b.sourceType||'',status:'active'};items.push(x);return route.fulfill({json:{ok:true,item:x}});}
  if(b.action==='save'){const x=find(b.id);Object.assign(x,{title:b.title,content:b.content,tags:Array.isArray(b.tags)?b.tags:String(b.tags||'').split(/[，,]/),favorite:b.favorite,revision:x.revision+1});return route.fulfill({json:{ok:true,item:x}});}
  if(b.action==='versions')return route.fulfill({json:{ok:true,versions:[{id:'v1',revision:1,created_at:Date.now()}]}});
  if(b.action==='restoreVersion')return route.fulfill({json:{ok:true,item:find(b.id)}});
  if(b.action==='context')return route.fulfill({json:{ok:true,notes:[find(b.id)]}});
  if(b.action==='trash'||b.action==='restore'){find(b.id).status=b.action==='trash'?'trash':'active';return route.fulfill({json:{ok:true}});}
  return route.fulfill({status:400,json:{ok:false,error:'unknown '+b.action}});
 });
 let clicks=0;const click=async sel=>{await page.locator(sel).click();clicks++;};
 try{
  await page.goto('http://pk.test/fixture');await page.locator('[data-pkid="n1"]').waitFor();await click('[data-pkid="n1"]');await page.locator('#pkFavorite').waitFor();
  for(const view of ['knowledge','submit','mine'])for(let i=0;i<5;i++){await click('[data-pkview="'+view+'"]');await click('[data-pkview="personal"]');await page.locator('#pkAll').waitFor();}
  for(let i=0;i<5;i++){await click('#pkOffice');await page.evaluate(()=>{appMode='personal';renderSheet()});await page.locator('#pkAll').waitFor();}
  for(const id of ['pkAll','pkFav','pkTrash'])for(let i=0;i<5;i++){await click('#'+id);await page.waitForTimeout(20);}
  await click('#pkAll');await page.locator('[data-pkid="n1"]').waitFor();await click('[data-pkid="n1"]');await page.locator('#pkFavorite').waitFor();
  for(const scope of ['selection','current','folder','all'])for(let i=0;i<5;i++)await click('[data-pkscope="'+scope+'"]');
  for(let i=0;i<5;i++){await click('#pkMode');await page.locator('#pkMode').waitFor();}
  for(let i=0;i<5;i++){await click('#pkFavorite');await page.waitForTimeout(25);}
  for(let i=0;i<5;i++){await click('#pkVersions');await page.locator('#pkCloseModal').waitFor();await click('#pkCloseModal');}
  await page.locator('#pkAiQuestion').fill('[系统测试]请总结');await click('[data-pkscope="current"]');
  for(let i=0;i<5;i++){await click('#pkAiAsk');await page.waitForFunction(()=>!document.getElementById('pkAiAsk').disabled);}
  for(let i=0;i<5;i++){await click('#pkSubmitDept');await page.waitForTimeout(20);}
  assert.deepEqual(errors,[]);assert.ok(requests.includes('context'));console.log(JSON.stringify({ok:true,buttonTypes:18,clicks,repeat:5,apiCalls:requests.length,consoleErrors:errors,states:['four-views','office-return','all/favorite/trash','four-ai-scopes','edit/preview','favorite-save','versions-open/close','AI-answer','department-submit']}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
