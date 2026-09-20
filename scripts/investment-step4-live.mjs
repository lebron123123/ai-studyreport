// Live browser acceptance: only UUID-scoped synthetic records; no user session access.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {createD1Shim} from '../local-server/d1-shim.js';
import {signToken} from '../functions/api/_auth.js';
import {reportEvidenceHash as hash} from '../functions/api/_report-trusted-evaluation.js';
const {chromium}=createRequire(import.meta.url)('C:/Users/HP/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
assert.ok(['localhost','127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname));
const DB=createD1Shim(process.env.DATABASE_URL),pid=crypto.randomUUID(),users=[];let browser,page;
try{
  for(let i=0;i<3;i++){const name='[系统测试]step4-'+crypto.randomUUID();await DB.prepare('INSERT INTO users(username,pass_hash,salt,created_at) VALUES(?,?,?,?)').bind(name,'disabled','disabled',Date.now()).run();users.push(Number((await DB.prepare('SELECT id FROM users WHERE username=?').bind(name).first()).id));}
  const [owner,reviewer,outsider]=users;await DB.prepare('INSERT INTO projects(id,user_id,name,data,updated_at) VALUES(?,?,?,?,?)').bind(pid,owner,'[系统测试]后评价','{}',Date.now()).run();
  await DB.prepare("INSERT INTO project_memberships(project_id,user_id,role,status,created_at,updated_at) VALUES(?,?,'EDITOR','active',?,?)").bind(pid,reviewer,Date.now(),Date.now()).run();
  for(const u of [owner,reviewer])await DB.prepare('INSERT INTO investment_fact_verifiers(project_id,user_id,basis,active,version,updated_at) VALUES(?,?,?,1,1,?)').bind(pid,u,'测试授权',Date.now()).run();
  const sourceId=crypto.randomUUID(),approvalId=crypto.randomUUID(),proofId=crypto.randomUUID();
  await DB.prepare('INSERT INTO report_source_artifacts(id,project_id,user_id,content_hash,storage_key,file_name,mime_type,size_bytes,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(sourceId,pid,owner,'test-hash','test-key','[系统测试]批准.txt','text/plain',10,Date.now()).run();
  const source=await DB.prepare('SELECT id,content_hash,storage_key,file_name,size_bytes FROM report_source_artifacts WHERE id=?').bind(sourceId).first();
  await DB.prepare("INSERT INTO investment_formal_facts(id,project_id,event_id,kind,round,version,status,payload_json,source_id,source_hash,created_by,verified_by,updated_at) VALUES(?,?,?,'original',1,2,'verified',?,?,?,?,?,?)").bind(approvalId,pid,'event',JSON.stringify({title:'批准',date:'2026-01-01',amount:'100',currency:'CNY',amountBasis:'含税'}),sourceId,await hash(source),owner,reviewer,Date.now()).run();
  await DB.prepare("INSERT INTO project_facts(id,project_id,user_id,fact_type,fact_key,value_json,status,source_ref,created_by,created_at,updated_at) VALUES(?,?,?,'operations','proof',?,'confirmed','第1页','reviewer',?,?)").bind(proofId,pid,owner,JSON.stringify('完成整改并验收，支出90万元'),Date.now(),Date.now()).run();

 const tokens=await Promise.all(users.map(u=>signToken({...process.env,DB},u,'[系统测试]步骤4')));
 const headers=i=>({authorization:'Bearer '+tokens[i],'content-type':'application/json'});
 const api=async(body,i=0)=>{const r=await fetch('http://localhost:8080/api/investmentops'+(body?'':'?view=step4&projectId='+pid),{method:body?'POST':'GET',headers:headers(i),body:body?JSON.stringify({...body,projectId:pid}):undefined});const j=await r.json();assert.equal(r.status,200,j.error);return j;};
 browser=await chromium.launch({channel:'msedge',headless:true});page=await browser.newPage({viewport:{width:1280,height:900},acceptDownloads:true});await page.setExtraHTTPHeaders(headers(0));const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/step4-live-check',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/investment-step4.css"><div id="host"></div><script src="/investment-step4-ui.js"></script><script>InvestmentStep4.mount(document.querySelector("#host"),{projectId:"'+pid+'",headers:()=>({})})</script>'}));
 const ready=()=>page.locator('[data-s4-form=contractCandidate]').waitFor({state:'attached'});
 const switchUser=async i=>{await page.setExtraHTTPHeaders(headers(i));await page.reload();await ready();};
 const fill=async(kind,values)=>{const f=page.locator('[data-s4-form='+kind+']');await f.evaluate(x=>{const d=x.closest('details');if(d)d.open=true});for(const [k,v] of Object.entries(values)){const e=f.locator('[name="'+k+'"]');if(await e.evaluate(x=>x.tagName==='SELECT'))await e.selectOption(String(v));else await e.fill(String(v));}return f;};
 const save=async f=>{const done=page.waitForResponse(r=>r.url().endsWith('/api/investmentops')&&r.request().method()==='POST');await f.locator('button:not([type=button])').click();const response=await done;assert.equal(response.status(),200,JSON.stringify(await response.json()));await page.locator('[data-s4-message]').filter({hasText:'已保存。'}).waitFor();};
 const act=action=>page.locator('[data-s4-action="'+action+'"]');
 const review=async(action)=>{await act(action).first().click();await save(await fill(action,{approved:'true',reason:'已核对批准原文、数据缺口和证据，不代表独立财务审计'}));};
 await page.goto('http://localhost:8080/step4-live-check');await ready();assert.match(await page.locator('#host').innerText(),/暂无后评价/);
 let f=await fill('contractCandidate',{contractId:'agreement-1',clauseId:'clause-1',title:'补齐整改凭证',sourceEvidenceId:proofId,locator:'第1页',quote:'完成整改并验收',obligor:'项目负责人',condition:'验收完成',offsetDays:30});
 await save(f);assert.equal(Number((await DB.prepare('SELECT COUNT(*) n FROM project_obligations WHERE project_id=?').bind(pid).first()).n),0);
 await act('contractConfirm').click();await save(await fill('contractConfirm',{lifecycle:'effective',conditionStatus:'met',triggerDate:'2026-09-01',triggerEvidenceId:proofId,triggerLocator:'第1页',assigneeId:owner,reason:'凭验收证据人工确认'}));
 assert.equal(Number((await DB.prepare('SELECT COUNT(*) n FROM project_obligations WHERE project_id=?').bind(pid).first()).n),1);
 await act('clauseChange').click();await save(await fill('contractCandidate',{offsetDays:35,reason:'更正期限，沿用同一业务条款'}));await act('contractConfirm').click();await save(await fill('contractConfirm',{lifecycle:'changed',conditionStatus:'met',triggerDate:'2026-09-01',triggerEvidenceId:proofId,triggerLocator:'第1页',assigneeId:owner,reason:'核对更正期限'}));assert.equal(Number((await DB.prepare('SELECT COUNT(*) n FROM project_obligations WHERE project_id=?').bind(pid).first()).n),1);
 f=await fill('evaluationCreate',{title:'[系统测试]专项后评价',approvalId,metricKey:'支出',value:100,basis:'含税',periodStart:'2026-01-01',periodEnd:'2026-12-31',locator:'第1页',quote:'计划支出100万元'});await f.locator('[name=confirmed]').check();
 await page.route('**/api/investmentops',r=>r.fulfill({status:503,json:{ok:false,error:'[系统测试]保存失败，请重试'}}));await f.locator('button:not([type=button])').click();await page.getByRole('alert').filter({hasText:'保存失败'}).waitFor();assert.equal(await f.locator('[name=title]').inputValue(),'[系统测试]专项后评价');await page.unroute('**/api/investmentops');
 await f.locator('button:not([type=button])').evaluate(b=>{b.click();b.click()});await page.locator('[data-s4-message]').filter({hasText:'已保存。'}).waitFor();assert.equal((await api()).evaluations.length,1);
 await act('evaluationSubmit').click();await save(await fill('evaluationSubmit',{reason:'实际尚缺，覆盖范围已明确'}));await act('evaluationReview').click();f=await fill('evaluationReview',{approved:'true',reason:'本人不得自审'});await f.locator('button:not([type=button])').click();await page.getByRole('alert').filter({hasText:'提交人与复核人必须不同'}).waitFor();
 await switchUser(1);await review('evaluationReview');await switchUser(0);
 const evaluationId=(await api()).evaluations[0].id;
 await save(await fill('rectificationCreate',{evaluationId,issue:'补齐台账',cause:'未登记实际',ownerId:owner,dueDate:'2026-10-01',dueBasis:'专项计划'}));await act('rectificationSubmit').click();await save(await fill('rectificationSubmit',{sourceEvidenceId:proofId,locator:'第1页',reason:'整改已完成'}));await switchUser(1);await review('rectificationReview');await switchUser(0);
 await save(await fill('experienceSave',{evaluationId,title:'[系统测试]可复用经验',content:'必须保持批准目标、实际数据及整改证据的完整关联，不能用预测数替代实际数。对于没有完成收集的指标，应当明确标为缺失并注明范围，不得填零或者给出满分。',reviewDate:'2099-01-01'}));
 await act('experienceSubmit').click();await page.locator('[data-s4-message]').filter({hasText:'操作完成'}).waitFor();await switchUser(1);await review('experienceReview');await switchUser(0);await act('experiencePublish').click();await page.locator('[data-s4-message]').filter({hasText:'操作完成'}).waitFor({timeout:90000});
 let state=await api(),exp=state.records.find(x=>x.kind==='experience');assert.equal(exp.status,'published');assert.equal((await DB.prepare('SELECT status FROM wiki_pages WHERE id=?').bind(exp.id).first()).status,'published');assert.ok(Number((await DB.prepare('SELECT COUNT(*) n FROM rag_vectors WHERE id LIKE ?').bind('wiki_'+exp.id+'_%').first()).n)>0);
 const denied=await fetch('http://localhost:8080/api/investmentops?view=step4&projectId='+pid,{headers:headers(2)});assert.equal(denied.status,404);
 const download=page.waitForEvent('download');await act('report').click();const file=await download;await file.saveAs('outputs/0909-step4-live-report.html');const html=await readFile('outputs/0909-step4-live-report.html','utf8');assert.equal((html.match(/<table>/g)||[]).length,4);assert.match(html,/缺少实际/);assert.match(html,/不代替企业正式签发/);
 await save(await fill('evaluationSchedule',{nextDate:'2026-01-01',intervalDays:90,basis:'试点专项评价'}).then(async f=>{await f.locator('[name=enabled]').check();return f;}));await act('refresh').click();await act('evaluationNoticeComplete').waitFor();await act('evaluationNoticeComplete').click();await save(await fill('evaluationNoticeComplete',{evaluationId}));assert.equal((await api()).notices.filter(n=>n.id.startsWith('scheduled-')).length,0);
 await page.reload();await ready();await page.setViewportSize({width:560,height:900});await page.locator('details').evaluateAll(ds=>ds.forEach(d=>d.open=true));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'outputs/0909-step4-live-browser.png',fullPage:true});
 await act('experienceWithdraw').click();await save(await fill('experienceWithdraw',{reason:'验收完成，撤回测试经验'}));assert.equal((await api()).records.find(x=>x.id===exp.id).status,'withdrawn');assert.deepEqual(errors,[]);
 const gen=await fetch('http://localhost:8080/api/generate',{method:'POST',headers:headers(0),body:JSON.stringify({stream:false,max_tokens:20,messages:[{role:'user',content:'只回复OK'}]})});const gj=await gen.json();assert.equal(gen.status,200,gj.error);assert.ok(gj.content);
 console.log('PASS live browser: empty, clause correction/no duplicate, failed save preserved, double submit, independent review, rectification, real Wiki+RAG indexing, permissions, 4-table download, scheduled completion, reload, narrow viewport, withdraw, actual /api/generate.');
} catch(e){if(page)await page.screenshot({path:'outputs/0909-step4-live-failure.png',fullPage:true}).catch(()=>{});throw e;}
finally{
 if(browser)await browser.close();
 await DB._transaction(async tx=>{
  await tx.prepare('SELECT id FROM projects WHERE id=? FOR UPDATE').bind(pid).first();
  const w=(await tx.prepare("SELECT id FROM investment_step4_records WHERE project_id=? AND kind='experience'").bind(pid).all()).results||[];
  for(const r of w){for(const table of ['rag_vectors','rag_text_chunks'])await tx.prepare('DELETE FROM '+table+' WHERE id LIKE ?').bind('wiki_'+r.id+'_%').run();await tx.prepare('DELETE FROM rag_files_v2 WHERE title LIKE ?').bind('【Wiki】'+r.id+'｜%').run();await tx.prepare('DELETE FROM wiki_source_bindings WHERE wiki_id=?').bind(r.id).run();await tx.prepare('DELETE FROM wiki_pages WHERE id=?').bind(r.id).run();}
  await tx.prepare('DELETE FROM investment_step4_history WHERE record_id IN (SELECT id FROM investment_step4_records WHERE project_id=?)').bind(pid).run();
  await tx.prepare('DELETE FROM investment_contract_clause_versions WHERE clause_id IN (SELECT id FROM investment_contract_clauses WHERE project_id=?)').bind(pid).run();
  for(const table of ['investment_step4_records','investment_evaluation_schedule','investment_step4_notices','investment_post_evaluations','investment_contract_clauses','project_obligations','investment_fact_verifiers','investment_formal_facts','report_source_artifacts','project_facts','project_tasks','project_memberships','project_events'])await tx.prepare('DELETE FROM '+table+' WHERE project_id=?').bind(pid).run();
  await tx.prepare('DELETE FROM projects WHERE id=?').bind(pid).run();
 });for(const id of users)await DB.prepare("DELETE FROM users WHERE id=? AND username LIKE '[系统测试]step4-%'").bind(id).run();await DB._close();console.log('Cleaned exact synthetic UUIDs; user records untouched.');
}
