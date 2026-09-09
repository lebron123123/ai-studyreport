const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/HP/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'}),page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 let fail=false,failPost=false,posts=0;
 const state={items:[],meetings:[{id:'meeting-1',title:'[系统测试]董事会'}],sources:[{id:'source-1',file_name:'[系统测试]原件.txt'}],members:[1,2],grants:[],actorId:1,canEdit:true,canManage:true,canVerify:true,warning:'外部事实登记，不代替企业审批'};
 await page.route('**/api/investmentops?**',async r=>{
  if(r.request().method()==='POST'){
   posts++;if(failPost)return r.fulfill({status:503,json:{ok:false,error:'模拟保存失败'}});const b=r.request().postDataJSON();await new Promise(resolve=>setTimeout(resolve,150));
   if(b.action==='saveFormalFact')state.items=[{id:'fact-1',event_id:b.eventId,source_id:b.sourceId,kind:b.kind,round:b.round,version:b.expectedVersion+1,created_by:1,status:'pending',payload:b,currentValid:false}];
   else if(b.action==='verifyFormalFact'){state.items[0].status='verified';state.items[0].currentValid=true;state.items[0].verified_by=2;state.items[0].version++;}
   return r.fulfill({json:{ok:true}});
  }
  await new Promise(resolve=>setTimeout(resolve,300));return r.fulfill({status:fail?503:200,json:fail?{ok:false,error:'模拟读取失败'}:{ok:true,formalFacts:state}});
 });
 await page.route('**/formal-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/investment-formal-facts.css"><main id="host"></main><script src="/investment-formal-facts.js"></script><script>function mount(){InvestmentFormalFacts.mount(document.getElementById("host"),{projectId:"test",headers:()=>({})})}mount();</script>'}));
 await page.route(/\/investment-formal-facts\.(js|css)$/,r=>{const file=new URL(r.request().url()).pathname.slice(1);return r.fulfill({contentType:file.endsWith('css')?'text/css':'text/javascript',body:fs.readFileSync(path.join(__dirname,'..',file),'utf8')});});
 try{
  await page.goto('http://localhost:8080/formal-fixture',{waitUntil:'domcontentloaded'});await page.getByText('正在读取正式事实…').waitFor();await page.getByText('暂无正式事实。',{exact:false}).waitFor();
  await page.locator('[data-ff-new]').click();await page.locator('[name=kind]').selectOption('decision');await page.locator('[name=eventId]').selectOption('meeting-1');await page.locator('[name=sourceId]').selectOption('source-1');await page.locator('[name=title]').fill('董事会决议');await page.locator('[name=date]').fill('2026-01-02');await page.locator('[name=locator]').fill('原件第1页');await page.locator('[name=reason]').fill('初次登记');await page.locator('[name=result]').selectOption('conditional');await page.locator('[name=conditions]').fill('完成协议签署');await page.locator('[name=confirmed]').check();
  await page.evaluate(()=>mount());await page.locator('[name=title]').waitFor();assert.equal(await page.locator('[name=conditions]').inputValue(),'完成协议签署');
  failPost=true;await page.locator('.ff-form button[type=submit]').click();await page.getByText('模拟保存失败；输入已保留。').waitFor();assert.equal(await page.locator('[name=title]').inputValue(),'董事会决议');
  failPost=false;const before=posts;await page.locator('.ff-form button[type=submit]').evaluate(b=>{b.click();b.click();});await page.getByText('已保存到服务器。',{exact:true}).waitFor();assert.equal(posts,before+1);assert.equal(await page.locator('[data-ff-verify]').count(),0);
  await page.reload();await page.getByText('待独立核验 · v1').waitFor();assert.equal(await page.locator('.ff-list article').count(),1);
  state.actorId=2;await page.reload();await page.locator('[data-ff-verify]').waitFor();await page.locator('[data-ff-note]').fill('已核对原件');await page.locator('[data-ff-confirm]').check();await page.locator('[data-ff-verify]').click();await page.getByText('已核验 · v2').waitFor();
  await page.locator('[data-ff-edit]').click();await page.locator('[name=reason]').fill('更正日期依据');await page.locator('.ff-form button[type=submit]').click();await page.getByText('待独立核验 · v3').waitFor();assert.equal(await page.locator('.ff-list article').count(),1);
  await page.screenshot({path:'outputs/0909-formal-facts-browser.png',fullPage:true});
  state.canEdit=false;state.canManage=false;state.canVerify=false;await page.reload();await page.getByText('待独立核验 · v3').waitFor();assert.equal(await page.locator('[data-ff-new],[data-ff-edit],[data-ff-verify],[data-ff-grant]').count(),0);
  fail=true;await page.reload();await page.getByRole('alert').waitFor();fail=false;await page.getByText('重试',{exact:true}).click();await page.getByText('待独立核验 · v3').waitFor();
  await page.setViewportSize({width:600,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
  console.log('PASS: loading/empty/form/reentry/failure/double click/refresh/independent verification/correction/readonly/retry/mobile; no page errors.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
