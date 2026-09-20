const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/HP/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const html=fs.readFileSync('admin.html','utf8'),styles=(html.match(/<style>[\s\S]*?<\/style>/g)||[]).join(''),nav=html.match(/<nav class="side">[\s\S]*?<\/nav>/)[0];
 const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage({viewport:{width:1280,height:850}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/nav-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8">'+styles+'<link rel="stylesheet" href="/admin-navigation.css"><div class="shell">'+nav+'<main class="main"><h1>后台导航验证</h1><div id="content">大纲列表</div></main></div><script>for(const [id,after,title] of [["btnMaterials","btnRag","正式资料台账"],["btnPptAssets","btnPptTemplates","PPT素材审核"]]){const node=document.createElement("div");node.id=id;node.className="nav-item";node.textContent=title;document.getElementById(after).after(node);}window.calls=0;document.querySelectorAll(".nav-item").forEach(n=>n.onclick=()=>{calls++;document.querySelectorAll(".nav-item").forEach(x=>x.classList.remove("active"));n.classList.add("active");document.getElementById("content").textContent=n.id;});</script><script src="/admin-navigation.js"></script>'}));
 try{
  await page.goto('http://localhost:8080/nav-fixture');
  assert.equal(await page.locator('.admin-nav-group').count(),6);
  assert.equal(await page.locator('.admin-nav-group[open]').count(),1);
  assert.equal(await page.locator('.admin-nav-children .nav-item').count(),20);
  const groups=page.locator('.admin-nav-group');
  for(let i=0;i<6;i++){
   const group=groups.nth(i);if(!await group.getAttribute('open')&&!(await group.evaluate(n=>n.open)))await group.locator('summary').click();
   for(const item of await group.locator('.nav-item').all()){
    const id=await item.getAttribute('id');await item.click();assert.equal(await page.locator('#content').innerText(),id);
    assert.equal(await item.getAttribute('aria-current'),'page');
   }
  }
  assert.equal(await page.evaluate(()=>calls),20);
  await page.evaluate(()=>document.getElementById('btnRag').click());
  await page.locator('#btnRag').waitFor({state:'visible'});assert.equal(await page.locator('.admin-nav-group[open]').count(),1);
  await page.screenshot({path:'outputs/0907-admin-navigation.png'});
  const summary=page.locator('.admin-nav-group').filter({has:page.locator('#btnRag')}).locator('summary');
  await summary.click();await page.locator('#btnRag').waitFor({state:'hidden'});
  await summary.focus();await page.keyboard.press('Enter');await page.locator('#btnRag').waitFor({state:'visible'});
  await page.locator('#btnWiki').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('#content').innerText(),'btnWiki');
  await page.reload();assert.equal(await page.locator('.admin-nav-group[open]').count(),1);
  await page.setViewportSize({width:800,height:600});assert.equal(await page.locator('summary').count(),6);
  await page.addScriptTag({url:'http://localhost:8080/admin-navigation.js'});assert.equal(await page.locator('.admin-nav-group').count(),6);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,items:20,groups:6,states:['initial','all entries','programmatic return','collapse','keyboard','refresh','repeat install','compact'],consoleErrors:errors,apiWrites:0}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
