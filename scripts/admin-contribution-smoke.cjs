const {chromium}=require('C:/Users/HP/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'}),page=await browser.newPage({viewport:{width:1850,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 const rows=[1,2,3].map(i=>({id:String(i),title:'[系统测试]政策'+i,content:'正文来源待核验。'.repeat(50),source_ref:'https://www.gov.cn/a.pdf',kind:'wiki',status:'pending',meta:{},created_at:1,suggestion:{category:'policy',format:'PDF',reason:'政策标题标记'}}));let fail=true,requests=0;
 await page.route('**/api/contributions',async r=>{const b=r.request().postDataJSON();if(b.action==='listReview')return r.fulfill({json:{ok:true,items:rows.filter(x=>x.status===b.status)}});assert.equal(b.action,'approvePublish');requests++;await new Promise(r=>setTimeout(r,100));if(b.id==='2'&&fail){fail=false;return r.fulfill({status:500,json:{ok:false,error:'测试失败'}});}const row=rows.find(x=>x.id===b.id);row.status='approved';row.meta.publication={state:'published'};return r.fulfill({json:{ok:true,message:'已发布，可检索',publication:{state:'published'}}});});
 const html=fs.readFileSync('admin.html','utf8'),block=html.slice(html.indexOf('let contribStatus='),html.indexOf('/* 项目人口/职住/需求数据审核'));
 await page.route('**/fixture-review',r=>r.fulfill({contentType:'text/html',body:'<meta charset="utf-8">'+(html.match(/<style>[\s\S]*?<\/style>/g)||[]).join('')+'<link rel="stylesheet" href="/admin-layout.css"><div class="shell"><aside class="side">后台功能</aside><main class="main"><div id="listBox"></div><div id="editBox"></div></main></div><script>function esc(x){return String(x||"").replaceAll("<","&lt;")}function authHeaders(){return {}}function msg(){}function adminSourceLink(x){return x}</script><script src="/admin-contribution-batch.js"></script><script>'+block+';openContributions()</script>'}));
 try{
 await page.goto('http://localhost:8080/fixture-review');await page.locator('[data-select-all]').waitFor();
 assert.ok((await page.locator('.main').boundingBox()).width>1500);
 await page.locator('[data-batch-approve]').click();assert.match(await page.locator('[role=status]').innerText(),/先勾选/);
 await page.locator('[data-select-all]').check();await page.locator('[data-batch-approve]').click();await page.getByText(/处理结束 3\/3/).waitFor();assert.equal(requests,3);assert.match(await page.locator('[role=status]').innerText(),/成功 2 项/);
 await page.screenshot({path:'outputs/0907-review-batch.png'});
 await page.locator('[data-batch-approve]').click();await page.getByText(/处理结束 1\/1/).waitFor();assert.equal(requests,4);
 await page.reload();await page.getByText('当前没有待审核的投稿').waitFor();
 await page.setViewportSize({width:850,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
 console.log('PASS: wide layout, selection, partial failure, retry, refresh persistence, narrow viewport; no real writes');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
