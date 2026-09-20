// Real HTTP / background worker / browser path. UUID-scoped synthetic data only.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createD1Shim} from '../local-server/d1-shim.js';
import {signToken} from '../functions/api/_auth.js';
const {chromium}=createRequire(import.meta.url)('C:/Users/HP/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
assert.ok(['localhost','127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname));
const DB=createD1Shim(process.env.DATABASE_URL),projectId=crypto.randomUUID(),users=[];let browser;
try{
 for(let i=0;i<3;i++){const name='[系统测试]watch-live-'+crypto.randomUUID();await DB.prepare('INSERT INTO users(username,pass_hash,salt,created_at) VALUES(?,?,?,?)').bind(name,'disabled','test-only',Date.now()).run();const id=Number((await DB.prepare('SELECT id FROM users WHERE username=?').bind(name).first()).id);users.push({id,name,token:await signToken({...process.env,DB},id,name)});}
 await DB.prepare('INSERT INTO projects(id,user_id,name,data,updated_at) VALUES(?,?,?,?,?)').bind(projectId,users[0].id,'[系统测试]周月闭环验收','{}',Date.now()).run();
 await DB.prepare("INSERT INTO project_memberships(project_id,user_id,role,status,created_at,updated_at) VALUES(?,?,'EDITOR','active',?,?)").bind(projectId,users[1].id,Date.now(),Date.now()).run();
 const headers=u=>({authorization:'Bearer '+users[u].token,'content-type':'application/json'});
 async function api(body,u=0,status=200){const r=await fetch('http://localhost:8080/api/investmentops?view=watch&projectId='+projectId,{method:body?'POST':'GET',headers:headers(u),body:body?JSON.stringify({...body,projectId}):undefined,signal:AbortSignal.timeout(30000)});const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));return d;}
 assert.equal((await api()).schedule.enabled,false);await api(undefined,2,404);
 await api({action:'grantFactVerifier',userId:users[1].id,active:true,basis:'[系统测试]独立复核',expectedVersion:0});
 const evidence=crypto.randomUUID();await DB.prepare("INSERT INTO project_facts(id,project_id,user_id,fact_type,fact_key,value_json,source_ref,status,version,created_by,created_at,updated_at) VALUES(?,?,?,'test','测试整改证明','1','测试有效依据','confirmed',1,'independent',?,?)").bind(evidence,projectId,users[0].id,Date.now(),Date.now()).run();
 browser=await chromium.launch({headless:true,channel:'msedge'});const page=await browser.newPage({viewport:{width:1440,height:1000},extraHTTPHeaders:headers(0)}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.route('**/watch-check',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/investment-formal-facts.css"><link rel="stylesheet" href="/investment-watch.css"><div id="host"></div><script src="/investment-watch.js"></script><script src="/investment-formal-facts.js"></script><script>InvestmentFormalFacts.mount(document.querySelector('#host'),{projectId:${JSON.stringify(projectId)},headers:()=>({})})</script>`}));
 await page.goto('http://localhost:8080/watch-check');await page.locator('[data-watch-empty]').waitFor();
 await page.locator('[data-watch-toggle]').evaluate(b=>{b.click();b.click();});await page.locator('[data-watch-message]').filter({hasText:'已保存到服务器'}).waitFor();
 await assertEventually(async()=>{assert.equal((await api()).view.totals.unique,3);});
 let state=await api();assert.equal(state.schedule.last.status,'partial');assert.equal(state.schedule.version,1);assert.equal(state.notices.length,3);assert.ok(state.schedule.watermark>0);
 // Only this synthetic schedule: persisted overdue watermark / expired lease simulate restart catch-up.
 const first=state.schedule.watermark;
 await DB.prepare("UPDATE investment_watch SET next_at=0,lease_token='stopped-worker',lease_until=1 WHERE project_id=?").bind(projectId).run();
 await assertEventually(async()=>{assert.ok((await api()).schedule.watermark>first);});assert.equal((await api()).notices.length,3);
 await page.reload();await page.locator('[data-watch-risk]').first().waitFor();assert.equal(await page.locator('[data-watch-risk]').count(),3);
 const card=page.locator('[data-watch-risk]').first(),id=await card.getAttribute('data-watch-risk');
 await card.locator('[name=reason]').fill('认领测试');await card.getByRole('button',{name:'认领（不关闭）'}).click();await page.locator('[data-watch-message]').filter({hasText:'已保存到服务器'}).waitFor();assert.equal((await api()).view.items.find(r=>r.id===id).status,'open');
 const currentCard=()=>page.locator('[data-watch-risk="'+id+'"]');
 await currentCard().locator('[name=reason]').fill('整改完成，请独立复核');await currentCard().locator('[name=evidence]').selectOption(evidence);await currentCard().getByRole('button',{name:'提交整改复核'}).click();await page.locator('[data-watch-message]').filter({hasText:'已保存到服务器'}).waitFor();
 state=await api();const pending=state.view.items.find(r=>r.id===id);assert.equal(pending.status,'review');await api({action:'watchRiskAction',id,expectedVersion:pending.version,operation:'approve',reason:'自审被拒绝'},0,403);
 await page.setExtraHTTPHeaders(headers(1));await page.reload();await currentCard().getByRole('button',{name:'独立复核通过'}).waitFor();await currentCard().locator('[name=reason]').fill('独立核对有效证据');await currentCard().getByRole('button',{name:'独立复核通过'}).click();await page.locator('[data-watch-message]').filter({hasText:'已保存到服务器'}).waitFor();assert.equal((await api()).view.items.find(r=>r.id===id).status,'closed');
 await page.locator('[data-watch-period]').selectOption('month');await currentCard().getByText('绿 · 已复核关闭',{exact:true}).waitFor();await page.reload();await currentCard().getByText('绿 · 已复核关闭',{exact:true}).waitFor();
 await page.screenshot({path:'outputs/0909-watch-browser.png',fullPage:true});
 await page.route('**/api/investmentops?view=watch&**',r=>r.fulfill({status:503,json:{ok:false,error:'[系统测试]暂时不可用'}}));await page.locator('[data-watch-refresh]').click();await page.locator('[data-watch-message]').filter({hasText:'读取失败'}).waitFor();await page.reload();await page.getByRole('alert').waitFor();await page.unroute('**/api/investmentops?view=watch&**');await page.getByText('重试',{exact:true}).click();await currentCard().waitFor();
 await page.setViewportSize({width:600,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
 // Disabled schedules are visibly unknown; old risks and history survive.
 state=await api();await api({action:'watchConfigure',enabled:false,confirmed:true,expectedVersion:state.schedule.version});state=await api();assert.equal(state.schedule.fresh,false);assert.equal(state.view.totals.unique,3);
 console.log('PASS real HTTP/worker/component: opt-in, background scan, overdue persisted lease catch-up, dedup, claim-not-close, independent review, week/month, reload, failure/retry, mobile, console, unauthorized404.');
}finally{
 if(browser)await browser.close();
 // Lock the same project as the worker before cleaning this run; no other project is touched.
 await DB._transaction(async tx=>{await tx.prepare('SELECT id FROM projects WHERE id=? FOR UPDATE').bind(projectId).first();for(const table of ['investment_watch_notices','investment_watch_risks','investment_watch','investment_check_runs','investment_fact_verifiers','project_facts','project_risks','project_events','project_memberships'])await tx.prepare('DELETE FROM '+table+' WHERE project_id=?').bind(projectId).run();await tx.prepare('DELETE FROM projects WHERE id=?').bind(projectId).run();});
 for(const u of users)await DB.prepare('DELETE FROM users WHERE id=? AND username=?').bind(u.id,u.name).run();await DB._close();console.log('Removed only this run’s UUID-scoped synthetic records.');
}
async function assertEventually(check){const until=Date.now()+20000;let error;do{try{await check();return;}catch(e){error=e;await new Promise(r=>setTimeout(r,500));}}while(Date.now()<until);throw error;}
