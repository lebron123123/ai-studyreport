const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/HP/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'}),page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 let fail=false,failPost=false,posts=0;
 const state={items:[],meetings:[{id:'meeting-1',title:'[系统测试]总办会'}],members:[{userId:1,role:'OWNER'}],actorId:1,canManage:true};
 await page.route('**/api/investmentops?**',async r=>{
  if(r.request().method()==='POST'){
   posts++;if(failPost)return r.fulfill({status:503,json:{ok:false,error:'模拟保存失败'}});
   const b=r.request().postDataJSON();await new Promise(resolve=>setTimeout(resolve,150));
   if(b.action==='saveHandoff')state.items=[{...b,id:'item-1',meetingTitle:'[系统测试]总办会',version:b.expectedVersion+1,assigneeId:Number(b.assigneeId),status:'pending'}];
   else {state.items[0].status=b.action==='acceptHandoff'?'accepted':'returned';state.items[0].version++;}
   return r.fulfill({json:{ok:true}});
  }
  await new Promise(resolve=>setTimeout(resolve,500));return r.fulfill({status:fail?503:200,json:fail?{ok:false,error:'模拟读取失败'}:{ok:true,handoffs:state}});
 });
 await page.route('**/handoff-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/investment-handoffs.css"><main id="host"></main><script src="/investment-handoffs.js"></script><script>function mount(){InvestmentHandoffs.mount(document.getElementById("host"),{projectId:"test",headers:()=>({})})}mount();</script>'}));
 await page.route(/\/investment-handoffs\.(js|css)$/,r=>{const file=new URL(r.request().url()).pathname.slice(1);return r.fulfill({contentType:file.endsWith('css')?'text/css':'text/javascript',body:fs.readFileSync(path.join(__dirname,'..',file),'utf8')});});
 try{
  await page.goto('http://localhost:8080/handoff-fixture',{waitUntil:'domcontentloaded'});await page.getByText('正在读取交接台账…').waitFor();await page.getByText('暂无交接事项。',{exact:false}).waitFor();
  await page.locator('[data-ho-new]').click();await page.locator('[name=eventId]').selectOption('meeting-1');await page.locator('[name=title]').fill('准备董事会材料');await page.locator('[name=basis]').fill('依据已核对纪要');await page.locator('[name=reason]').fill('首次交接');await page.locator('[name=assigneeId]').selectOption('1');await page.locator('[name=confirmed]').check();
  await page.evaluate(()=>mount());await page.locator('[name=title]').waitFor();assert.equal(await page.locator('[name=title]').inputValue(),'准备董事会材料');
  failPost=true;await page.locator('button[type=submit]').click();await page.getByText('模拟保存失败；输入已保留。').waitFor();assert.equal(await page.locator('[name=basis]').inputValue(),'依据已核对纪要');
  failPost=false;const before=posts;await page.locator('button[type=submit]').evaluate(b=>{b.click();b.click();});await page.getByText('已保存到服务器。',{exact:true}).waitFor();assert.equal(posts,before+1);
  await page.reload();await page.getByText('待承接 · v1').waitFor();assert.equal(await page.locator('.ho-list article').count(),1);
  await page.locator('[data-ho-action=acceptHandoff]').click();await page.getByText('已承接 · v2').waitFor();
  await page.locator('[data-ho-edit]').click();await page.locator('[name=basis]').fill('只更正日期依据');await page.locator('[name=reason]').fill('更正');await page.locator('button[type=submit]').click();await page.getByText('待承接 · v3').waitFor();assert.equal(await page.locator('.ho-list article').count(),1);
  await page.locator('[data-ho-reason]').fill('需要核对职责');await page.locator('[data-ho-action=returnHandoff]').click();await page.getByText('已退回 · v4').waitFor();
  await page.screenshot({path:'outputs/0908-handoff-browser.png'});
  state.canManage=false;state.actorId=2;await page.reload();await page.getByText('已退回 · v4').waitFor();assert.equal(await page.locator('[data-ho-new],[data-ho-edit],[data-ho-action]').count(),0);
  fail=true;await page.reload();await page.getByRole('alert').waitFor();fail=false;await page.getByText('重试',{exact:true}).click();await page.getByText('已退回 · v4').waitFor();
  await page.setViewportSize({width:600,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
  console.log('PASS: loading/empty/create/failure/draft reentry/double click/refresh/accept/correction/return/readonly/retry/mobile; no page errors.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
