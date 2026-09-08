// Production admin scripts, isolated browser API fixtures; no real knowledge writes.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/HP/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'}),page=await browser.newPage({viewport:{width:1250,height:950}});
 const errors=[],submissions=[],searches=[];let fail=true,ocrCalls=0,published=false;
 page.on('dialog',d=>d.accept());
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{
  const b=route.request().postDataJSON();
  if(route.request().url().endsWith('/api/local-ocr')){
   ocrCalls++;return route.fulfill({json:{ok:true,text:ocrCalls===2?'':'截图政策名称'}});
  }
  if(b.action==='status')return route.fulfill({json:{ok:true,providers:[],lenses:[]}});
  if(b.action==='listReview')return route.fulfill({json:{ok:true,items:b.status===(published?'approved':'pending')&&submissions.length>1?[{id:'fixture-1',kind:'material',title:'[系统测试]政策',content:submissions[1].item.content,source_ref:'https://www.gov.cn/test',status:published?'approved':'pending',meta:published?{publication:{state:'published'}}:{},suggestion:{category:'policy'}}]:[]}});
  if(b.action==='approvePublish'){assert.equal(b.classification,'policy');published=true;return route.fulfill({json:{ok:true,publication:{state:'published'},message:'已发布，可检索'}});}
  if(b.action==='search'){
   searches.push(b.query);
   await new Promise(r=>setTimeout(r,80));
   if(b.query.startsWith('失败'))return route.fulfill({status:503,json:{ok:false,error:'测试检索失败'}});
   return route.fulfill({json:{ok:true,results:b.query.startsWith('空')?[]:[{title:'[系统测试]政策',url:'https://www.gov.cn/test',snippet:'摘要不是原文'},{title:'[系统测试]PDF',url:'https://www.gov.cn/test.pdf'}]}});
  }
  if(b.action==='fetch')return route.fulfill({json:{ok:true,document:{text:b.url.endsWith('.pdf')?'':'官方网页提取测试文本。'.repeat(20),url:b.url,extractStatus:'text'}}});
  if(b.action==='submit'){
   submissions.push(b);
   if(fail){fail=false;return route.fulfill({status:503,json:{ok:false,error:'测试保存失败'}});}
   return route.fulfill({json:{ok:true,id:'fixture-1',existing:submissions.length>2}});
  }
  throw new Error('Unexpected mutation '+b.action);
 });
 const styles=(fs.readFileSync('admin.html','utf8').match(/<style>[\s\S]*?<\/style>/g)||[]).join('');
 await page.route('**/fixture-source-search',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8">'+styles+'<main style="padding:24px"><div id="listBox"></div><div id="editBox"></div></main><script>function authHeaders(){return {}}</script><script src="/admin-contribution-batch.js"></script><script src="/admin-source-search.js"></script><script src="/web-research-admin.js"></script><script>openWebResearchAdmin()</script>'}));
 try{
  await page.goto('http://localhost:8080/fixture-source-search');
  const q=page.locator('[data-as="queries"]'),start=page.locator('[data-as="search"]'),submit=page.locator('[data-as="submit"]');
  await start.click();await page.getByText('请每行输入一项文件名或检索需求',{exact:true}).waitFor();
  await q.fill('正常\n失败\n空');await start.click();
  await page.locator('[data-as="status"]').filter({hasText:'搜索完成 3/3'}).waitFor();
  assert.equal(await page.locator('[data-row]').count(),2);
  await page.locator('[data-row="0"]').check();await page.locator('[data-row="1"]').check();await submit.click();
  await page.locator('[data-as="status"]').filter({hasText:'正文提取结束 2/2'}).waitFor();
  assert.ok((await page.locator('[data-as="results"]').innerText()).includes('未提交摘要'));
  await submit.click();await page.locator('[data-as="results"]').filter({hasText:'已提交资料审核'}).waitFor();
  assert.equal(submissions.length,2);assert.equal(submissions[1].item.kind,'material');
  assert.ok(!submissions[1].item.content.includes('摘要不是原文'));
  await page.locator('[data-source-review] [data-select-all]').check();await page.locator('[data-source-review] [data-batch-approve]').click();await page.locator('[data-source-review]').getByText('已发布，可检索 ·').waitFor();assert.equal(published,true);
  await page.screenshot({path:'outputs/0907-admin-source-search.png'});
  await page.reload();assert.equal(await page.locator('[data-row]').count(),0);
  await q.fill('正常\n另一项');await start.click();await page.locator('[data-as="stop"]').click();
  await page.locator('[data-as="status"]').filter({hasText:'已停止'}).waitFor();
  await start.waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('[data-as="search"]').disabled);
  await page.locator('[data-row="0"]').check();await submit.click();
  await page.locator('[data-as="results"]').filter({hasText:'未重复提交'}).waitFor();
  await page.evaluate(()=>openWebResearchAdmin());assert.equal(await page.locator('[data-as="queries"]').count(),1);
  await q.fill('原有需求');const before=searches.length;
  await page.locator('[data-as="images"]').setInputFiles([{name:'one.png',mimeType:'image/png',buffer:Buffer.from('fixture')},{name:'empty.png',mimeType:'image/png',buffer:Buffer.from('fixture')}]);
  await page.locator('[data-as="status"]').filter({hasText:'识别完成 2/2'}).waitFor();
  assert.equal(await q.inputValue(),'原有需求\n截图政策名称');assert.equal(searches.length,before);
  assert.match(await page.locator('[data-as="status"]').innerText(),/未识别到文字/);
  await q.evaluate(el=>{const d=new DataTransfer();d.items.add(new File(['fixture'],'paste.png',{type:'image/png'}));el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:d,bubbles:true,cancelable:true}));});
  await page.locator('[data-as="status"]').filter({hasText:'识别完成 1/1'}).waitFor();assert.equal(ocrCalls,3);
  await q.fill(Array.from({length:30},(_,i)=>i===0?'文'.repeat(1000):'政策'+i).join('\n'));await start.click();
  await page.locator('[data-as="status"]').filter({hasText:'搜索完成 30/30'}).waitFor();
  assert.equal(searches[before].length,1012);assert.equal(searches.length-before,30);
  await page.screenshot({path:'outputs/0907-admin-source-search-ocr.png'});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,states:['empty','loading','partial failure','no results','selection','fetch failure','save failure/retry','material routing','duplicate','stop','refresh','reopen'],realWrites:0,consoleErrors:errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
