// Isolated production-component browser test; all requests are fulfilled in memory.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/HP/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),read=name=>fs.readFileSync(path.join(root,name),'utf8');
const stages=require('../project-workspace-ui.js').STAGES;
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'}),page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[],requests=[],writes=[],dialogs=[],state={role:'OWNER',failOps:false,failBrain:false,failIntelligence:false,emptyRequirements:false,delayBrain:100,delayFiles:0,failList:false,stage:'feasibility',version:1};
 const requirements=()=>state.emptyRequirements?[]:[{factKey:'asset.area',label:'[系统测试]缺失面积',scopeId:'点位A',requirement:'required',status:'missing'},{factKey:'rent',label:'[系统测试]租金假设',factId:'assumption',scopeId:'点位B',requirement:'required',status:'assumption',sourceRef:'[系统测试]租金比价原件'},{factKey:'ownership',label:'[系统测试]权属冲突',factId:'conflict',requirement:'required',status:'conflict'},{factKey:'parking',label:'[系统测试]停车位NA',requirement:'conditional',status:'not_applicable',naReason:'[系统测试]没有地下空间'},{factKey:'condition',label:'[系统测试]适用条件',requirement:'conditional',status:'condition_pending'}];
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{dialogs.push(d.message());d.accept();});
 const styles=[...read('index.html').matchAll(/<style[^>]*>[\s\S]*?<\/style>/g)].map(x=>x[0]).join('');
 const html='<!doctype html><meta charset="utf-8">'+styles+'<style>'+read('investment-workspace.css')+'</style><button id="reopen">重新进入</button><script>'+read('investment-lifecycle.js')+'</script><script>'+read('investment-ops.js')+'</script><script>'+read('project-workspace-ui.js')+'</script><script>'+read('project-manager.js')+'</script><script>window.testUser="owner-a";window.rejectSave=false;window.saved=[];window.lifecycleStats={mounted:0,disposed:0};const fixtureMount=InvestmentOps.mountLifecycle;InvestmentOps.mountLifecycle=(...args)=>{window.lifecycleStats.mounted++;const state=fixtureMount(...args),dispose=state.dispose;state.dispose=()=>{window.lifecycleStats.disposed++;return dispose();};return state;};function enter(){return ProjectManager.open({userId:window.testUser,currentId:()=>null,preserveDraft:async p=>{if(window.rejectSave)throw Error("[系统测试]草稿暂未保存");window.saved.push(p);}})}document.getElementById("reopen").onclick=enter;enter();</script>';
 const fixture='http://workbench.test/fixture.html';
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.pathname==='/fixture.html')return route.fulfill({contentType:'text/html',body:html});
  if(!url.pathname.startsWith('/api/'))return route.fulfill({status:404,body:''});
  requests.push({path:url.pathname,method:req.method()});
  const id=url.searchParams.get('projectId'),edit=state.role==='OWNER',permissions={edit,manage:edit,delete:edit,duplicate:edit};
  if(req.method()!=='GET'){
   const body=req.postDataJSON();writes.push(body);assert.equal(url.pathname,'/api/projectintelligence');assert.equal(body.action,'updateWorkStage');
   if(body.expectedVersion!==state.version)return route.fulfill({status:409,json:{ok:false,error:'[系统测试]阶段版本冲突'}});
   const previous=state.stage;state.stage=body.stageKey;state.version++;
   return route.fulfill({json:{ok:true,stage:{key:state.stage,version:state.version},undo:{stageKey:previous,expectedVersion:state.version}}});
  }
  if(url.pathname==='/api/projects'){
   if(state.failList)return route.fulfill({status:503,json:{ok:false,error:'[系统测试]索引不可用'}});
   return route.fulfill({json:{ok:true,list:['project-test-a','project-test-b'].map(id=>({id,name:'[系统测试]'+id,type:'rent',location:'深圳',role:state.role,permissions,investmentStage:'feasibility',status:'collecting',stage:'资料准备',generated:0,sections:10,materials:0,activity:[]}))}});
  }
  if(url.pathname==='/api/projectbrain'){
   if(state.failBrain)return route.fulfill({status:503,json:{ok:false,error:'[系统测试]事实暂不可用'}});
   if(state.delayBrain)await new Promise(r=>setTimeout(r,state.delayBrain));
   return route.fulfill({json:{ok:true,context:{lifecycle:{current:state.stage},requirements:{stageKey:state.stage,items:requirements()},facts:[...stages.map((s,i)=>({id:'f'+i,stageKey:s.key,label:id+'-'+s.label,status:'confirmed'})),{id:'assumption',factKey:'rent',scopeId:'点位B',label:'租金输入',factType:'ASSUMPTION',value:80,unit:'元/㎡·月',basis:'仅预演',asOf:'2026-09',sourceLocator:'第3页',status:'confirmed'},{id:'conflict',factKey:'ownership',label:'权属输入',factType:'FACT',conflictValues:['甲','乙'],status:'conflict'}],artifacts:[{id:'shared',name:'共用来源资料'}]}}});
  }
  if(url.pathname==='/api/investmentops')return route.fulfill(state.failOps?{status:503,json:{ok:false,error:'[系统测试]执行台不可用'}}:url.searchParams.get('view')==='lifecycle'?{json:{ok:true,lifecycle:{projectId:id,actorUserId:'fixture-'+state.role,permissions,versions:[],actuals:[],variance:[],requests:[],warning:'[系统测试]未配置正式审批职责'}}}:{json:{ok:true,ops:{tasks:[{id:'task-1',stageKey:'implementation',title:'实施现场核对',status:'open'}]}}});
  if(url.pathname==='/api/projectintelligence')return route.fulfill(state.failIntelligence?{status:503,json:{ok:false,error:'[系统测试]需求模型暂不可用'}}:{json:{ok:true,readModel:{stage:{key:state.stage,label:'可研与尽调',version:state.version},contextContract:{permissions},gates:stages.map(s=>({id:'g-'+s.key,stageKey:s.key,title:s.label+'登记阶段门',status:'not_started'})),progress:{configured:false},kpis:{},dataHealth:{requirements:requirements()}}}});
  if(url.pathname==='/api/projectworkspace'){
   if(url.searchParams.get('view')==='files'&&state.delayFiles)await new Promise(r=>setTimeout(r,state.delayFiles));
   return route.fulfill({json:{ok:true,context:{role:state.role,permissions},data:{permissions,files:[],rows:[],members:[]}}});
  }
  throw Error('Unexpected request: '+url.pathname);
 });
 const select=async id=>{await page.locator('[data-pm-select="'+id+'"]').click();await page.locator('#pmDetail .pm-page-heading').waitFor();};
 const stage=async key=>{await page.locator('.pm-stage-nav [data-pm-stage-view="'+key+'"]').click();await page.waitForFunction(k=>location.hash.endsWith('/stages/'+k),key);};
 const tool=async view=>{const group=await page.evaluate(v=>ProjectWorkspaceUI.navigationGroup(v).key,view);await page.locator('#pmSidebar [data-pw-view="'+group+'"]').click();if(view!==group)await page.locator('#pmDetail .pm-workspace-subtabs [data-pw-view="'+view+'"]').click();await page.waitForFunction(v=>location.hash.endsWith('/'+v),view);};
 try{
  await page.goto(fixture);await page.locator('[data-pm-select]').first().waitFor();await select('project-test-a');
  await page.locator('[data-pm-work-stage]').waitFor();await tool('stages');await stage('feasibility');await page.getByText('project-test-a-可研与尽调',{exact:true}).waitFor();
  assert.equal(await page.locator('#pmSidebar [data-pw-view]').count(),7);
  for(const s of stages){await stage(s.key);await page.getByText('project-test-a-'+s.label,{exact:true}).waitFor();assert.equal(await page.locator('.pm-stage-nav [aria-current="page"]').count(),1);assert.equal(await page.locator('[data-pm-work-stage]').inputValue(),'feasibility');}
  assert.equal(writes.length,0,'eight stage clicks must remain read-only');
  await stage('implementation');await page.getByText('项目计划与冻结版本',{exact:true}).waitFor();
  await page.locator('[data-il-field="name"]').fill('[系统测试]未提交预测名称');const mounts=await page.evaluate(()=>window.lifecycleStats.mounted);
  await stage('implementation');assert.equal(await page.evaluate(()=>window.lifecycleStats.mounted),mounts,'same-screen refresh preserves mounted module');assert.equal(await page.locator('[data-il-field="name"]').inputValue(),'[系统测试]未提交预测名称');
  await stage('post_investment');await page.getByText('投后实际值与差异',{exact:true}).waitFor();await page.locator('[data-il-field="sourceRef"]').fill('[系统测试]未提交实际值来源');assert.equal(await page.locator('[data-il-action="freeze"]').count(),0);
  await stage('implementation');await page.getByText('项目计划与冻结版本',{exact:true}).waitFor();assert.equal(await page.locator('[data-il-field="name"]').inputValue(),'[系统测试]未提交预测名称');assert.equal(await page.locator('[data-il-action="actual"]').count(),0);
  await stage('exit_review');assert.equal(await page.locator('[data-il-project]').count(),0);assert.deepEqual(await page.evaluate(()=>window.lifecycleStats),{mounted:mounts+2,disposed:mounts+2});assert.equal(writes.length,0,'lifecycle mounts and navigation remain GET-only');
  await page.reload();await page.getByText('project-test-a-退出与复盘',{exact:true}).waitFor();assert.ok(page.url().endsWith('/exit_review'));
  await stage('decision');await stage('screening');await page.goBack();await page.waitForFunction(()=>location.hash.endsWith('/decision'));await page.goForward();await page.waitForFunction(()=>location.hash.endsWith('/screening'));
  await tool('meetings');await page.locator('#pmMeetingText').fill('[系统测试]未提交会议草稿');await tool('stages');await stage('decision');await tool('meetings');assert.equal(await page.locator('#pmMeetingText').inputValue(),'[系统测试]未提交会议草稿');
  await tool('stages');await tool('meetings');assert.equal(await page.locator('#pmMeetingText').inputValue(),'[系统测试]未提交会议草稿','management draft survives page navigation without forcing report save');
  await tool('stages');await stage('decision');await page.locator('[data-pm-library]').click();await select('project-test-b');assert.ok(page.url().endsWith('/overview'));
  await tool('stages');await stage('initiation');await page.locator('[data-pm-library]').click();await select('project-test-a');assert.ok(page.url().endsWith('/decision'));
  await page.locator('#ppClose').click();await page.evaluate(()=>{window.testUser='owner-b';return enter();});await select('project-test-a');assert.ok(page.url().endsWith('/overview'),'another user does not inherit navigation');
  for(const view of ['overview','stages','facts','data','files','spatial','decisions','actions','meetings','baseline','handoffs','scenarios','versions','contracts','evaluations','lessons','plans','members','acceptance']){await tool(view);await page.locator('#pmDetail .pm-page-heading').waitFor();}
  await tool('facts');await page.locator('[data-requirement-status="missing"]').waitFor();assert.equal(await page.locator('.pm-requirement-row').count(),5);
  for(const [status,expected] of [['missing','尚未录入'],['assumption','第3页'],['conflict','甲'],['not_applicable','没有地下空间']]){const row=page.locator('[data-requirement-status="'+status+'"]');await row.locator('summary').click();assert.ok((await row.textContent()).includes(expected));}
  await page.screenshot({path:path.join(root,'outputs/0907-lifecycle-requirements-desktop.png')});await page.setViewportSize({width:375,height:900});await page.screenshot({path:path.join(root,'outputs/0907-lifecycle-requirements-375.png')});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.setViewportSize({width:1440,height:1000});
  await page.reload();await page.locator('.pm-requirement-row').first().waitFor();assert.equal(await page.locator('.pm-requirement-row').count(),5);
  state.failIntelligence=true;await page.reload();await page.locator('[data-pm-retry-all]').waitFor();await page.locator('[data-requirement-status="missing"]').waitFor();state.failBrain=true;await page.reload();await page.getByText('资料需求暂不可读取，请重试页面数据。',{exact:true}).waitFor();state.failBrain=state.failIntelligence=false;await page.locator('[data-pm-retry-all]').click();await page.locator('[data-requirement-status="missing"]').waitFor();
  state.emptyRequirements=true;await page.reload();await page.getByText('后台清单当前为零项，不代表资料自动通过专业复核。',{exact:true}).waitFor();state.emptyRequirements=false;await tool('stages');await stage('decision');await page.reload();await page.locator('.pm-stage-workspace').waitFor();await page.waitForFunction(()=>document.querySelectorAll('.pm-stage-workspace .pm-workspace-loading').length===0);
  // Component-local render failure must retain sidebar navigation and recover.
  await page.evaluate(()=>{window.savedStageRenderer=ProjectWorkspaceUI.stageWorkspace;ProjectWorkspaceUI.stageWorkspace=()=>{throw Error('fixture render failure');};});await stage('decision');await page.getByText('此页面暂时无法显示').waitFor();await page.evaluate(()=>ProjectWorkspaceUI.stageWorkspace=window.savedStageRenderer);await page.locator('[data-pm-retry-all]').click();await page.locator('.pm-stage-workspace').waitFor();
  // Partial source error and retry retain independent brain data.
  state.failOps=true;await page.reload();await page.locator('[data-pm-retry-source="ops"]').waitFor();await page.getByText('project-test-a-投资决策',{exact:true}).waitFor();state.failOps=false;await page.locator('[data-pm-retry-source="ops"]').click();await page.locator('[data-pm-retry-source="ops"]').waitFor({state:'detached'});
  // Late file response from project A cannot replace project B's stage page.
  state.delayFiles=350;await tool('files');await page.locator('[data-pm-library]').click();await select('project-test-b');await page.getByText('project-test-b-立项',{exact:true}).waitFor();await page.waitForTimeout(450);assert.ok((await page.locator('#pmDetail h2').textContent()).includes('project-test-b'));assert.equal(await page.locator('#pwFileName').count(),0);state.delayFiles=0;
  assert.equal(writes.length,0,'all normal navigation and retry must remain GET-only');
  // Explicit OWNER work-stage action and versioned undo are separate from browsing.
  await page.locator('[data-pm-work-stage]').selectOption('implementation');await page.locator('[data-pm-undo-stage]').waitFor();assert.equal(writes.length,1);assert.equal(writes[0].expectedVersion,1);assert.ok(page.url().endsWith('/initiation'));
  await page.locator('[data-pm-undo-stage]').click();await page.waitForFunction(()=>document.querySelector('[data-pm-work-stage]')?.value==='feasibility');assert.equal(writes.length,2);assert.equal(writes[1].expectedVersion,2);
  await page.screenshot({path:path.join(root,'outputs/0907-lifecycle-workbench-desktop.png')});
  for(const width of [800,375]){await page.setViewportSize({width,height:900});await page.screenshot({path:path.join(root,'outputs/0907-lifecycle-workbench-'+width+'.png')});assert.equal(await page.locator('.pm-stage-nav button').count(),8);const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false,'viewport horizontal overflow '+width);}
  state.role='VIEWER';await page.reload();await page.locator('.pm-stage-workspace').waitFor();assert.equal(await page.locator('[data-pm-work-stage]').count(),0);assert.equal(await page.locator('[data-pm-ai]').count(),0);for(const s of stages)await stage(s.key);await tool('overview');assert.equal(await page.locator('[data-pm-open]').count(),0);await tool('meetings');assert.equal(await page.locator('[data-pm-extract]').count(),0);assert.equal(await page.locator('#pmMeetingText').isDisabled(),true);
  await tool('facts');await page.locator('[data-requirement-status="missing"]').waitFor();assert.equal(await page.locator('.pm-requirement-row').count(),5);
  await page.locator('#ppClose').click();state.failList=true;await page.locator('#reopen').click();await page.locator('[data-pm-reload]').waitFor();state.failList=false;await page.locator('[data-pm-reload]').click();await page.locator('[data-pm-select]').first().waitFor();
  assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,requests:requests.length,navigationWrites:0,explicitStageWrites:writes.length,consoleErrors:errors,states:['8 stages','19 tools','requirements/missing/assumption/conflict/NA','requirements-fallback/error/empty','refresh','back-forward','draft-preserved','user/project-isolation','partial-failure/retry','component-failure','late-response','OWNER-versioned-stage/undo','VIEWER','375/800/1440px','list-failure/retry']}));
 }finally{await browser.close();}
 async function stageAttempt(key){await page.locator('.pm-stage-nav [data-pm-stage-view="'+key+'"]').click();await page.getByText('[系统测试]草稿暂未保存',{exact:true}).waitFor();}
})().catch(e=>{console.error(e);process.exitCode=1;});
