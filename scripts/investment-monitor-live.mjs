// Real component + HTTP + physical original; only UUID-scoped synthetic records.
import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createD1Shim} from '../local-server/d1-shim.js';
import {createRagObjectStore} from '../local-server/rag-object-store.js';
import {signToken} from '../functions/api/_auth.js';
const {chromium}=createRequire(import.meta.url)('C:/Users/HP/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const url=new URL(process.env.DATABASE_URL);assert.ok(['localhost','127.0.0.1'].includes(url.hostname));
const DB=createD1Shim(url.toString()),projectId=crypto.randomUUID(),users=[];let artifact,browser;
try{
 for(let i=0;i<2;i++){const name='[系统测试]monitor-live-'+crypto.randomUUID();await DB.prepare('INSERT INTO users(username,pass_hash,salt,created_at) VALUES(?,?,?,?)').bind(name,'disabled','test-only',Date.now()).run();const id=Number((await DB.prepare('SELECT id FROM users WHERE username=?').bind(name).first()).id);users.push({id,name,token:await signToken({...process.env,DB},id,name)});}
 await DB.prepare('INSERT INTO projects(id,user_id,name,data,updated_at) VALUES(?,?,?,?,?)').bind(projectId,users[0].id,'[系统测试]检查规则真实接口','{}',Date.now()).run();
 await DB.prepare("INSERT INTO project_memberships(project_id,user_id,role,status,created_at,updated_at) VALUES(?,?,'EDITOR','active',?,?)").bind(projectId,users[1].id,Date.now(),Date.now()).run();
 const headers=u=>({authorization:'Bearer '+users[u].token,'content-type':'application/json'});
 async function api(body,u=0,status=200){const r=await fetch('http://localhost:8080/api/investmentops?view=formalFacts&projectId='+projectId,{method:body?'POST':'GET',headers:headers(u),body:body?JSON.stringify({...body,projectId}):undefined,signal:AbortSignal.timeout(30000)});const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));return d;}
 assert.equal((await api()).formalFacts.checks.runs.length,0);
 const meeting=await api({action:'extractMeeting',title:'[系统测试]制度会议',content:'测试制度，不属于真实批准。'});
 const upload=await fetch('http://localhost:8080/api/projectartifacts?projectId='+projectId+'&name=monitor-test.txt',{method:'POST',headers:headers(0),body:'[系统测试]独立原件 '+crypto.randomUUID()});assert.equal(upload.status,200);artifact=(await upload.json()).artifact;
 await api({action:'grantFactVerifier',userId:users[1].id,active:true,basis:'系统测试',expectedVersion:0});
 const base={action:'saveFormalFact',eventId:meeting.id,sourceId:artifact.id,round:1,expectedVersion:0,newRoundConfirmed:true,title:'[系统测试]事实',date:'2026-01-02',locator:'第1条',reason:'接口验收'};
 const verify=id=>api({action:'verifyFormalFact',id,expectedVersion:1,confirmed:true,reason:'已独立核对测试原件'},1);
 const held=await api({...base,kind:'held'});await verify(held.id);const decision=await api({...base,kind:'decision',result:'passed'});await verify(decision.id);
 const handoff=await api({action:'saveHandoff',eventId:meeting.id,type:'board',round:1,expectedVersion:0,newRoundConfirmed:true,title:'[系统测试]董事会材料',basis:'已核验决议',result:'follow_up',reason:'确认',dueDate:'2026-09-01',dueBasis:'测试制度',assigneeId:users[1].id});
 browser=await chromium.launch({headless:true,channel:'msedge'});const page=await browser.newPage({viewport:{width:1280,height:900},extraHTTPHeaders:headers(0)}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.route('**/step2-check',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/investment-formal-facts.css"><div id="host"></div><script src="/investment-formal-facts.js"></script><script>InvestmentFormalFacts.mount(document.querySelector('#host'),{projectId:${JSON.stringify(projectId)},headers:()=>({})})</script>`}));
 await page.goto('http://localhost:8080/step2-check');await page.getByText('尚无检查记录，不能判断健康度。').waitFor();
 await page.locator('[data-ff-new]').click();await page.locator('[name=kind]').selectOption('rule');await page.locator('[name=ruleType]').selectOption('deadline');
 for(const [n,v]of Object.entries({title:'[系统测试]期限规则',date:'2026-01-02',locator:'第一条',scope:'项目整体',validFrom:'2026-01-01',clockStart:'2026-01-02',reason:'登记测试规则'}))await page.locator('[name='+n+']').fill(v);
 await page.locator('[name=eventId]').selectOption(meeting.id);await page.locator('[name=sourceId]').selectOption(artifact.id);await page.locator('[name=operator]').selectOption('gt');await page.locator('[name=stacking]').selectOption('no-mix');await page.locator('[name=confirmed]').check();await page.locator('.ff-form button[type=submit]').click();await page.getByText('已保存到服务器。',{exact:true}).waitFor();
 const rule=(await api()).formalFacts.items.find(x=>x.kind==='rule');assert.ok(rule);await api({action:'verifyFormalFact',id:rule.id,expectedVersion:1,confirmed:true,reason:'不可自审'},0,403);await verify(rule.id);
 await page.reload();await page.locator('[data-ff-run]').waitFor();await page.locator('[data-ff-run]').evaluate(b=>{b.click();b.click();});await page.getByText('已保存到服务器。',{exact:true}).waitFor();
 let state=(await api()).formalFacts;assert.equal(state.checks.runs.length,1);assert.equal(state.checks.runs[0].results[0].status,'overdue');await page.reload();await page.getByText('已逾期 · [系统测试]董事会材料',{exact:false}).waitFor();
 const pause=await api({...base,kind:'pause',decisionId:decision.id,obligationId:handoff.id,start:'2026-01-02',end:''});await verify(pause.id);
 await page.locator('[data-ff-run]').click();await page.getByText('已保存到服务器。',{exact:true}).waitFor();state=(await api()).formalFacts;assert.equal(state.checks.runs.length,2);assert.equal(state.checks.runs[0].results[0].status,'clear');assert.equal(state.checks.runs[1].results[0].status,'overdue');
 await page.screenshot({path:'outputs/0909-step2-monitor-browser.png',fullPage:true});
 await page.route('**/api/investmentops?**',r=>r.fulfill({status:503,json:{ok:false,error:'[系统测试]读取失败'}}));await page.reload();await page.getByRole('alert').waitFor();await page.unroute('**/api/investmentops?**');await page.getByText('重试',{exact:true}).click();await page.locator('[data-ff-run]').waitFor();
 await page.setViewportSize({width:600,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
 console.log('PASS real component/HTTP/original: rule form, self-review403, independent approval, overdue→approved pause, preserved history, double click, reload, failure/retry, mobile, no page errors.');
}finally{
 if(browser)await browser.close();
 if(artifact){const row=await DB.prepare('SELECT storage_key FROM report_source_artifacts WHERE project_id=? AND id=?').bind(projectId,artifact.id).first();await DB.prepare('DELETE FROM report_source_artifacts WHERE project_id=? AND id=?').bind(projectId,artifact.id).run();if(row&&!await DB.prepare('SELECT id FROM report_source_artifacts WHERE storage_key=? LIMIT 1').bind(row.storage_key).first())await createRagObjectStore(process.env.RAG_OBJECT_ROOT||path.resolve('local-data/rag-objects')).remove(row.storage_key);}
 for(const table of ['investment_check_runs','project_obligations','investment_formal_facts','investment_fact_verifiers','project_events','project_meetings','project_memberships','project_profiles','project_work_stages'])await DB.prepare('DELETE FROM '+table+' WHERE project_id=?').bind(projectId).run();
 await DB.prepare('DELETE FROM projects WHERE id=?').bind(projectId).run();for(const u of users)await DB.prepare('DELETE FROM users WHERE id=? AND username=?').bind(u.id,u.name).run();await DB._close();console.log('Only this run’s synthetic records and unique test original removed.');
}
