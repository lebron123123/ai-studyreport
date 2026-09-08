// Isolated browser rendering of the production components. No real project writes.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/HP/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));
 const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 const styles=[...source.matchAll(/<style[^>]*>[\s\S]*?<\/style>/g)].map(x=>x[0]).join('');
 const fixture='http://localhost:8080/tests/fixtures/investment-navigation.html';
 await page.route(/\/(project-workspace-ui\.js|project-manager\.js|investment-workspace\.css)$/,route=>{const file=new URL(route.request().url()).pathname.slice(1);return route.fulfill({contentType:file.endsWith('.css')?'text/css':'text/javascript',body:fs.readFileSync(path.join(__dirname,'..',file),'utf8')});});
 const project={id:'system-test-investment',name:'[系统测试]税务局合作房源改造项目',type:'gaibao',location:'深圳市罗湖区',owner:'投资部',role:'OWNER',permissions:{edit:true,manage:true,delete:true,duplicate:true},status:'review',stage:'复核签发',generated:41,sections:41,materials:8,calcVersions:1,reportVersions:2,updated_at:Date.now(),activity:[],reportVersionItems:[{id:'version-1',version:1,reason:'初稿'}]};
 let failData=false,delayData=false,failList=false;
 await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());requests.push(url.pathname+url.search);
   assert.equal(req.method(),'GET','navigation must not mutate data');
   if(url.pathname==='/api/projects'&&failList)return route.fulfill({status:503,json:{ok:false,error:'[系统测试]索引暂不可用'}});
   if(url.pathname==='/api/projectworkspace'){
     const view=url.searchParams.get('view');assert.ok(['data','files','decisions','spatial','members'].includes(view),'invalid API view '+view);
     if(view==='data'&&delayData)await new Promise(r=>setTimeout(r,650));
     if(view==='data'&&failData)return route.fulfill({status:503,json:{ok:false,error:'[系统测试]数据暂不可用'}});
     return route.fulfill({json:{ok:true,context:{role:'OWNER',permissions:{manage:true}},[view]:{},data:{},files:{},decisions:{},spatial:{},members:{}}});
   }
   const payload=url.pathname==='/api/projects'?{ok:true,list:[project]}:url.pathname==='/api/projectbrain'?{ok:true,context:{facts:[],decisions:[],lifecycle:{stages:[]}}}:url.pathname==='/api/investmentops'?{ok:true,ops:{}}:{ok:true,readModel:{contextContract:{permissions:{edit:true}},stage:{label:'复核签发'},progress:{configured:false},kpis:{},dataHealth:{}}};
   await route.fulfill({json:payload});
 });
 await page.route('**/tests/fixtures/investment-navigation.html',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8">'+styles+'<link rel="stylesheet" href="/investment-workspace.css"><button id="reopen">投资全周期</button><script src="/project-workspace-ui.js"></script><script src="/project-manager.js"></script><script>function enter(){ProjectManager.open({currentId:()=>null});}document.getElementById("reopen").onclick=enter;enter();</script>'}));
 try{
   await page.goto(fixture);await page.locator('[data-pm-select]').waitFor();
   assert.equal(new URL(page.url()).hash,'#investment/projects');
   assert.equal(await page.locator('#pmDetail').isVisible(),false);
   await page.screenshot({path:'outputs/0907-investment-library.png'});
   await page.locator('[data-pm-select]').click();await page.locator('.pm-stage-workspace h3').filter({hasText:'项目寻找'}).waitFor();
   assert.ok(page.url().endsWith('/stages/discovery'));
   await page.locator('#pmSidebar [data-pw-view="overview"]').click();await page.locator('.pm-page-heading h3').filter({hasText:'项目总览'}).waitFor();
   assert.equal(await page.locator('#pmList').isVisible(),false);
   assert.equal(await page.locator('#pmMeetingText').count(),0);
   await page.screenshot({path:'outputs/0907-investment-overview.png'});
   for(const [view,selector] of [['stages','[data-pi-milestone]'],['facts','.pm-fact-row, .pm-detail-empty'],['actions','#pmMeetingText'],['scenarios','#pmScenarioKind'],['acceptance','#pmOptTitle'],['versions','[data-pm-preview-version]'],['members','.pm-workspace-view']]){
     await page.locator('#pmSidebar [data-pw-view="'+view+'"]').click();
     await page.locator('#pmDetail').locator(selector).first().waitFor();
     assert.ok(page.url().endsWith('/'+view));
   }
   await page.reload();await page.locator('#pmDetail .pm-workspace-view').waitFor();assert.ok(page.url().endsWith('/members'));
   await page.locator('#pmSidebar [data-pw-view="actions"]').click();await page.locator('#pmMeetingText').waitFor();
   await page.goBack();await page.locator('#pmDetail .pm-workspace-view').waitFor();assert.ok(page.url().endsWith('/members'));
   await page.goForward();await page.locator('#pmMeetingText').waitFor();
   await page.locator('#pmSidebar [data-pw-view="actions"]').click();assert.equal(await page.locator('#pmMeetingText').count(),1);
   failData=true;delayData=true;
   await page.locator('#pmSidebar [data-pw-view="data"]').click();await page.locator('.pm-workspace-loading').waitFor();await page.locator('[data-pw-retry]').waitFor();
   failData=false;delayData=false;await page.locator('[data-pw-retry]').click();await page.locator('#pmDetail .pm-workspace-view').waitFor();
   await page.locator('[data-pm-library]').click();await page.locator('#pmSearch').fill('找不到这个项目');await page.getByText('没有匹配的项目').waitFor();
   await page.locator('#pmSearch').fill('');await page.locator('[data-pm-select]').waitFor();
   await page.setViewportSize({width:800,height:900});assert.equal(await page.locator('[data-pm-head-view="data"]').isVisible(),true);
   await page.locator('[data-pm-select]').click();await page.locator('#pmSidebar [data-pw-view="members"]').click();await page.locator('#pmDetail .pm-workspace-view').waitFor();
   await page.screenshot({path:'outputs/0907-investment-members-compact.png'});
   await page.locator('#ppClose').click();assert.equal(await page.locator('#projPanel').count(),0);
   failList=true;await page.locator('#reopen').click();await page.locator('#pmRetryList').waitFor();
   failList=false;await page.locator('#pmRetryList').click();await page.locator('[data-pm-select]').waitFor();
   assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,requests:requests.length,consoleErrors:errors,states:['library','overview','stages','facts','actions','scenarios','acceptance','versions','members','loading','failed/retry','empty','refresh','back/forward','repeat','close/reopen','compact'],writes:0}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
