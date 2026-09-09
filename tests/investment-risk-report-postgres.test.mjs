import test from 'node:test';
import assert from 'node:assert/strict';
import {createD1Shim} from '../local-server/d1-shim.js';
import {testDatabaseUrl} from '../scripts/require-test-database.mjs';
import {ensureInvestmentTables} from '../functions/api/investmentops.js';
import {withProjectMutation} from '../functions/api/_lifecycle-integrity.js';
import {ensureRiskReports,createRiskReport,readRiskReports,riskDraftDocument} from '../functions/api/_investment-risk-report.js';
const target=testDatabaseUrl();
test('风险报告冻结：幂等、权限、范围、旧版本不变、校验与状态隔离',{skip:!target},async()=>{
 const DB=createD1Shim(target),env={DB},pid=crypto.randomUUID(),other=crypto.randomUUID();
 try{
  await ensureInvestmentTables(env);await ensureRiskReports(env);await ensureRiskReports(env);
  const users=[];for(let i=0;i<2;i++){const name='[系统测试]riskreport-'+crypto.randomUUID();await DB.prepare('INSERT INTO users(username,pass_hash,salt,created_at) VALUES(?,?,?,?)').bind(name,'disabled','disabled',Date.now()).run();users.push(Number((await DB.prepare('SELECT id FROM users WHERE username=?').bind(name).first()).id));}
  const [owner,outsider]=users;
  for(const id of [pid,other])await DB.prepare('INSERT INTO projects(id,user_id,name,data,updated_at) VALUES(?,?,?,?,?)').bind(id,owner,'[系统测试]风险报告','{}',Date.now()).run();
  const call=(b,userId=owner)=>withProjectMutation(env,{userId},pid,'edit',(tx,a)=>createRiskReport(tx,{userId},a,b));
  const get=q=>withProjectMutation(env,{userId:owner},pid,'view',(tx,a)=>readRiskReports(tx,{userId:owner},a,new URLSearchParams(q)));
  const req={scope:'project',requestId:crypto.randomUUID()};
  await assert.rejects(call(req,outsider),{status:404});await assert.rejects(call({...req,scope:'formal'}),{status:400});
  const empty=await call(req);assert.equal(empty.report.snapshot.totals.unique,0);assert.equal(empty.report.snapshot.coverage.fresh,false);assert.equal(empty.report.snapshot.formal,false);
  const concurrent=await Promise.all([call(req),call(req)]);assert.ok(concurrent.every(r=>r.report.id===empty.report.id&&r.reused));
  await assert.rejects(call({...req,scope:'month'}),{status:409});
  const risk='risk-'+crypto.randomUUID();await DB.prepare("INSERT INTO project_risks(id,project_id,user_id,title,risk_level,owner,source_ref,status,created_at,updated_at) VALUES(?,?,?,?,'high','','manual','open',?,?)").bind(risk,pid,owner,'<script>bad()</script>测试',Date.now(),Date.now()).run();
  const single=await call({scope:'single',riskId:risk,requestId:crypto.randomUUID()});assert.equal(single.report.snapshot.totals.unique,1);assert.equal(single.report.snapshot.totals.unresolved,1);
  const html=single.report.snapshot.delivery.chapters[0].sections.map(s=>s.content).join('');assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));
  await assert.rejects(call({scope:'single',riskId:'other-risk',requestId:crypto.randomUUID()}),{status:404});
  for(const scope of ['week','month'])assert.equal((await call({scope,requestId:crypto.randomUUID()})).report.snapshot.totals.unique,1);
  assert.equal((await get({id:single.report.id})).currentBasisChanged,false);
  await DB.prepare("UPDATE project_risks SET title='新的说明' WHERE id=?").bind(risk).run();
  const reread=await get({id:single.report.id});assert.equal(reread.currentBasisChanged,true);assert.equal(reread.report.contentHash,single.report.contentHash);assert.deepEqual(reread.report.snapshot,single.report.snapshot);
  assert.equal((await DB.prepare('SELECT status FROM project_risks WHERE id=?').bind(risk).first()).status,'open');
  await assert.rejects(withProjectMutation(env,{userId:owner},other,'view',(tx,a)=>readRiskReports(tx,{userId:owner},a,new URLSearchParams({id:single.report.id}))),{status:404});
  assert.equal((await get({})).reports.length,4);await assert.rejects(get({offset:'-1'}),{status:400});
  // Corrupt stored content is never rendered as trusted report output.
  await DB.prepare("UPDATE investment_risk_reports SET snapshot_json='{}' WHERE id=?").bind(single.report.id).run();await assert.rejects(get({id:single.report.id}),{status:409});
 }finally{await DB._close();}
});
test('风险草稿使用现有交付快照格式，不伪造数字或正式状态',()=>{
 const s={selection:{scope:'project'},project:{id:'p',name:'测试'},asOf:'2026-09-09',periodNotice:'当前回看',totals:{unique:0,unresolved:0},coverage:{checked:0,expected:null,notice:'待核实'},risks:[],sources:[],frozenAt:0,templateVersion:'v1'};
 const d=riskDraftDocument(s);assert.equal(d.schemaVersion,3);assert.equal(d.chapters.length,1);assert.match(d.chapters[0].name,/未签发/);assert.match(d.chapters[0].sections[0].content,/未知/);assert.equal(d.chapters[0].sections.filter(x=>x.content.includes('<table>')).length,0);
});
