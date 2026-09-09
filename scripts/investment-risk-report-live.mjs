// Real local HTTP with UUID-scoped synthetic records. No user credentials or projects.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createD1Shim} from '../local-server/d1-shim.js';
import {signToken} from '../functions/api/_auth.js';
const {chromium}=createRequire(import.meta.url)('C:/Users/HP/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
assert.ok(['localhost','127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname));
const DB=createD1Shim(process.env.DATABASE_URL),projectId=crypto.randomUUID(),riskId='test-'+crypto.randomUUID(),users=[];let browser;
try{
 for(let i=0;i<2;i++){const name='[系统测试]risk-report-'+crypto.randomUUID();await DB.prepare('INSERT INTO users(username,pass_hash,salt,created_at) VALUES(?,?,?,?)').bind(name,'disabled','test-only',Date.now()).run();const id=Number((await DB.prepare('SELECT id FROM users WHERE username=?').bind(name).first()).id);users.push({id,name,token:await signToken({...process.env,DB},id,name)});}
 await DB.prepare('INSERT INTO projects(id,user_id,name,data,updated_at) VALUES(?,?,?,?,?)').bind(projectId,users[0].id,'[系统测试]风险报告验收','{}',Date.now()).run();
 const headers=u=>({authorization:'Bearer '+users[u].token,'content-type':'application/json'});
 async function api(q={},body,u=0,status=200){const r=await fetch('http://localhost:8080/api/investmentops?'+new URLSearchParams({view:'riskReports',projectId,...q}),{method:body?'POST':'GET',headers:headers(u),body:body?JSON.stringify({...body,projectId}):undefined,signal:AbortSignal.timeout(30000)});const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));return d;}
 await api();await api({},undefined,1,404);
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1200,height:900}});await page.setExtraHTTPHeaders(headers(0));const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/risk-report-check',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/investment-watch.css"><link rel="stylesheet" href="/investment-risk-report.css"><div id="host"></div><script src="/investment-risk-report.js"></script><script src="/investment-watch.js"></script><script>InvestmentWatch.mount(document.querySelector('#host'),{projectId:${JSON.stringify(projectId)},headers:()=>({})})</script>`}));
 await page.goto('http://localhost:8080/risk-report-check');await page.getByText('尚无风险报告草稿。',{exact:true}).waitFor();
 await page.locator('[data-rr-create]').click();await page.locator('[data-rr-status]').filter({hasText:'当前没有可选风险'}).waitFor();
 await DB.prepare("INSERT INTO project_risks(id,project_id,user_id,title,risk_level,owner,source_ref,status,created_at,updated_at) VALUES(?,?,?,?,'high','','manual','open',?,?)").bind(riskId,projectId,users[0].id,'测试项目建设进度待核查',Date.now(),Date.now()).run();
 await page.reload();await page.locator('[data-rr-create]').waitFor();await page.locator('[data-rr-status]').filter({hasText:'列表已更新'}).waitFor();
 await page.locator('[data-rr-create]').evaluate(b=>{b.click();b.click();});await page.locator('[data-rr-status]').filter({hasText:'草稿已保存'}).waitFor();
 const all=await api();assert.equal(all.reports.length,1);const id=all.reports[0].id;const original=await api({id});assert.equal(original.report.snapshot.totals.unique,1);assert.equal(original.report.snapshot.formal,false);
 await page.reload();await page.locator('[data-rr-open]').click();await page.locator('[data-rr-preview]').getByText('风险事项表',{exact:true}).waitFor();
 // Real existing provider, explicitly requested analysis; output remains separate from persisted snapshot.
 await page.locator('[data-rr-ai]').click();await page.locator('[data-rr-ai-status]').filter({hasText:/AI辅助分析·未核验|AI分析未完成/}).waitFor({timeout:70000});assert.match(await page.locator('[data-rr-ai-status]').textContent(),/AI辅助分析·未核验/,await page.locator('[data-rr-status]').textContent());assert.ok((await page.locator('[data-rr-ai-text]').textContent()).length>0);
 assert.equal((await api({id})).report.contentHash,original.report.contentHash);
 await page.route('**/api/generate',r=>r.fulfill({status:503,json:{error:'[系统测试]模型不可用'}}));await page.locator('[data-rr-ai]').click();await page.locator('[data-rr-ai-status]').filter({hasText:'AI分析未完成'}).waitFor();await page.unroute('**/api/generate');
 await DB.prepare("UPDATE project_risks SET title='更正后风险说明' WHERE id=?").bind(riskId).run();await page.locator('[data-rr-open]').click();await page.locator('[data-rr-preview]').getByText('当前风险或依据已变化；以下仍为原冻结草稿，需要重新生成后核对。',{exact:true}).waitFor();assert.equal((await api({id})).report.contentHash,original.report.contentHash);
 await api({id},undefined,1,404);
 await page.route('**/api/investmentops?view=riskReports&**',r=>r.fulfill({status:503,json:{ok:false,error:'[系统测试]读取失败'}}));await page.locator('[data-rr-list-refresh]').click();await page.locator('[data-rr-status]').filter({hasText:'读取失败'}).waitFor();await page.unroute('**/api/investmentops?view=riskReports&**');await page.locator('[data-rr-list-refresh]').click();await page.locator('[data-rr-status]').filter({hasText:'列表已更新'}).waitFor();
 await page.setViewportSize({width:600,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'outputs/0909-risk-report-browser.png',fullPage:true});assert.deepEqual(errors,[]);
 assert.equal((await DB.prepare('SELECT status FROM project_risks WHERE id=?').bind(riskId).first()).status,'open');
 console.log('PASS real HTTP/browser/provider: empty, create, double-click, reload, immutable snapshot, changed-source warning, unauthorized, AI success/failure, API retry, narrow, no risk closure.');
}finally{
 if(browser)await browser.close();
 await DB._transaction(async tx=>{await tx.prepare('SELECT id FROM projects WHERE id=? FOR UPDATE').bind(projectId).first();for(const table of ['investment_risk_reports','project_risks','project_events'])await tx.prepare('DELETE FROM '+table+' WHERE project_id=?').bind(projectId).run();await tx.prepare('DELETE FROM projects WHERE id=?').bind(projectId).run();});
 for(const u of users)await DB.prepare('DELETE FROM users WHERE id=? AND username=?').bind(u.id,u.name).run();await DB._close();console.log('Removed only this run’s synthetic records.');
}
