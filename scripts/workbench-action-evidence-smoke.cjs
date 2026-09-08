// All project/API data are in-memory fixtures. No server or user data is used.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/HP/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),read=name=>fs.readFileSync(path.join(root,name),'utf8');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'}),page=await browser.newPage(),errors=[],writes=[];
 const state={reject:false,task:'open',risk:'open',delay:0};page.on('pageerror',e=>errors.push(e.message));
 const html='<!doctype html><meta charset="utf-8"><body><script>'+read('project-workspace-ui.js')+'</script><script>'+read('project-manager.js')+'</script><script>window.answers=[];window.notices=[];window.prompt=()=>window.answers.shift()??null;window.alert=message=>window.notices.push(message);ProjectManager.open({userId:"[系统测试]actor"});</script>';
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.pathname==='/fixture')return route.fulfill({contentType:'text/html',body:html});
  if(!url.pathname.startsWith('/api/'))return route.fulfill({status:404,body:''});
  if(req.method()==='POST'){
   const body=req.postDataJSON();writes.push(body);assert.equal(url.pathname,'/api/investmentops');assert.equal(body.action,'updateItem');assert.equal(body.projectId,'project-evidence');
   if(state.delay)await new Promise(r=>setTimeout(r,state.delay));
   if(state.reject)return route.fulfill({status:400,json:{ok:false,error:'[系统测试]完成证据不属于当前项目'}});
   state[body.type]=body.status;return route.fulfill({json:{ok:true}});
  }
  if(url.pathname==='/api/projects')return route.fulfill({json:{ok:true,list:[{id:'project-evidence',name:'[系统测试]任务证据',role:'OWNER',permissions:{edit:true,manage:true},investmentStage:'implementation'}]}});
  if(url.pathname==='/api/investmentops')return route.fulfill({json:{ok:true,ops:{tasks:[{id:'task-fixture',title:'[系统测试]验收移交',stageKey:'implementation',status:state.task}],risks:[{id:'risk-fixture',title:'[系统测试]风险缓释',status:state.risk}]}}});
  return route.fulfill({json:{ok:true,context:{},readModel:{}}});
 });
 const act=async answers=>{await page.evaluate(a=>{window.answers=a;},answers);await page.locator('[data-pm-item="task"]').click();};
 try{
  await page.goto('http://workbench-action.test/fixture#project/project-evidence/actions');await page.locator('[data-pm-item="task"]').waitFor();
  for(const answers of [[null],[''],['evidence-fixture',null],['evidence-fixture','invalid-stage'],['evidence-fixture','implementation',null]])await act(answers);
  assert.equal(writes.length,0,'cancelled/empty/invalid evidence form must not POST');
  state.reject=true;await act(['foreign-evidence','implementation','']);await page.waitForFunction(()=>window.notices.some(s=>s.includes('不属于当前项目')));assert.equal(state.task,'open');assert.equal(await page.locator('[data-pm-item="task"]').isEnabled(),true);
  state.reject=false;state.delay=150;await page.evaluate(()=>window.answers=['evidence-fixture,evidence-fixture，evidence-two','implementation','milestone-fixture']);await page.locator('[data-pm-item="task"]').evaluate(button=>{button.click();button.click();});
  await page.locator('[data-pm-item="task"]').waitFor({state:'detached'});assert.equal(writes.length,2,'duplicate completion has one write');assert.deepEqual(writes[1].evidenceIds,['evidence-fixture','evidence-two']);assert.equal(writes[1].stageKey,'implementation');assert.equal(writes[1].milestoneId,'milestone-fixture');assert.equal(state.task,'done');
  await page.evaluate(()=>window.answers=['evidence-risk','','']);await page.locator('[data-pm-item="risk"]').click();await page.locator('[data-pm-item="risk"]').waitFor({state:'detached'});assert.equal(state.risk,'mitigated');assert.equal(writes[2].stageKey,undefined);assert.equal(writes[2].milestoneId,undefined);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,cancelledWrites:0,attempts:writes.length,accepted:2,consoleErrors:errors,states:['cancel','empty','invalid-stage','foreign-evidence-error','explicit-evidence','deduplicate','double-click','optional-association','risk-mitigated']}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
