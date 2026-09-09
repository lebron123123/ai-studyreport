import test from 'node:test';
import assert from 'node:assert/strict';
import {createD1Shim} from '../local-server/d1-shim.js';
import {testDatabaseUrl} from '../scripts/require-test-database.mjs';
import {ensureInvestmentTables} from '../functions/api/investmentops.js';
import {withProjectMutation} from '../functions/api/_lifecycle-integrity.js';
import {resolveProjectAccess} from '../functions/api/_project-access.js';
import {ensureInvestmentWatch,mutateInvestmentWatch,claimInvestmentWatch,executeInvestmentWatch,readInvestmentWatch} from '../functions/api/_investment-watch.js';
const target=testDatabaseUrl();
test('持续检查：租约互斥、重复执行拒绝、灰色覆盖、处置独立复核、失效重开与历史',{skip:!target},async()=>{
 const DB=createD1Shim(target),env={DB},pid=crypto.randomUUID();
 try{
  await ensureInvestmentTables(env);await ensureInvestmentWatch(env);await ensureInvestmentWatch(env);
  const ids=[];for(let i=0;i<2;i++){const name='[系统测试]watch-'+crypto.randomUUID();await DB.prepare('INSERT INTO users(username,pass_hash,salt,created_at) VALUES(?,?,?,?)').bind(name,'disabled','disabled',Date.now()).run();ids.push(Number((await DB.prepare('SELECT id FROM users WHERE username=?').bind(name).first()).id));}
  const [owner,reviewer]=ids;
  await DB.prepare('INSERT INTO projects(id,user_id,name,data,updated_at) VALUES(?,?,?,?,?)').bind(pid,owner,'[系统测试]持续检查','{}',Date.now()).run();
  await DB.prepare("INSERT INTO project_memberships(project_id,user_id,role,status,created_at,updated_at) VALUES(?,?,'EDITOR','active',?,?)").bind(pid,reviewer,Date.now(),Date.now()).run();
  await DB.prepare('INSERT INTO investment_fact_verifiers(project_id,user_id,basis,active,version,updated_at) VALUES(?,?,?,1,1,?)').bind(pid,reviewer,'测试核验授权',Date.now()).run();
  const call=(b,userId=owner)=>withProjectMutation(env,{userId},pid,'edit',(tx,a)=>mutateInvestmentWatch(tx,{userId},a,b));
  await assert.rejects(call({action:'watchConfigure',enabled:true,confirmed:true,expectedVersion:0},reviewer),{status:403});
  await call({action:'watchConfigure',enabled:true,confirmed:true,expectedVersion:0});
  const jobs=await Promise.all([claimInvestmentWatch(env),claimInvestmentWatch(env)]);assert.equal(jobs.filter(Boolean).length,1);
  const job=jobs.find(Boolean);let result=await executeInvestmentWatch(env,job);assert.equal(result.status,'partial');
  await assert.rejects(executeInvestmentWatch(env,job),{status:409});
  const a=await resolveProjectAccess(env,owner,pid);let data=await readInvestmentWatch(env,{userId:owner},a);assert.equal(data.view.coverage.status,'unknown');assert.equal(data.view.totals.unique,3);assert.equal(data.notices.length,3);
  const risk=data.view.items[0];
  await assert.rejects(call({action:'watchRiskAction',id:risk.id,expectedVersion:risk.version,operation:'submit',reason:'整改',evidenceIds:[]}),{status:409});
  const evidence=crypto.randomUUID();await DB.prepare("INSERT INTO project_facts(id,project_id,user_id,fact_type,fact_key,value_json,source_ref,status,version,created_by,created_at,updated_at) VALUES(?,?,?,'test','test','1','test source','confirmed',1,'independent',?,?)").bind(evidence,pid,owner,Date.now(),Date.now()).run();
  await call({action:'watchRiskAction',id:risk.id,expectedVersion:risk.version,operation:'submit',reason:'整改完成',evidenceIds:[evidence]});
  await assert.rejects(call({action:'watchRiskAction',id:risk.id,expectedVersion:risk.version+1,operation:'approve',reason:'自审'}),{status:403});
  await call({action:'watchRiskAction',id:risk.id,expectedVersion:risk.version+1,operation:'approve',reason:'独立复核'},reviewer);
  await DB.prepare("UPDATE project_facts SET status='candidate' WHERE id=?").bind(evidence).run();
  data=await readInvestmentWatch(env,{userId:owner},a);assert.equal(data.view.items.find(x=>x.id===risk.id).closureInvalid,true);assert.equal(data.view.totals.unresolved,3);
  await DB.prepare('UPDATE investment_watch SET next_at=? WHERE project_id=?').bind(Date.now()-3600000,pid).run();
  const next=await claimInvestmentWatch(env);await executeInvestmentWatch(env,next);
  const reopened=await DB.prepare('SELECT * FROM investment_watch_risks WHERE id=?').bind(risk.id).first();assert.equal(reopened.state,'open');assert.equal(Number(reopened.round),2);
  assert.equal(Number((await DB.prepare('SELECT COUNT(*) AS n FROM investment_check_runs WHERE project_id=?').bind(pid).first()).n),2);
  await DB.prepare('UPDATE investment_watch SET next_at=0 WHERE project_id=?').bind(pid).run();const expired=await claimInvestmentWatch(env);await DB.prepare('UPDATE investment_watch SET lease_until=0 WHERE project_id=?').bind(pid).run();const replacement=await claimInvestmentWatch(env);await assert.rejects(executeInvestmentWatch(env,expired),{status:409});await executeInvestmentWatch(env,replacement);
  await DB.prepare("UPDATE project_memberships SET status='removed' WHERE project_id=? AND user_id=?").bind(pid,reviewer).run();await assert.rejects(call({action:'watchRiskAction',id:risk.id,expectedVersion:3,operation:'claim',reason:'已撤权'},reviewer),{status:404});
  await DB.prepare("UPDATE project_memberships SET status='active' WHERE project_id=? AND user_id=?").bind(pid,reviewer).run();
  await DB.prepare("UPDATE project_facts SET status='confirmed' WHERE id=?").bind(evidence).run();
  let current=await DB.prepare('SELECT * FROM investment_watch_risks WHERE id=?').bind(risk.id).first();
  await call({action:'watchRiskAction',id:risk.id,expectedVersion:Number(current.version),operation:'exception',reason:'测试限期例外',evidenceIds:[evidence],until:'2099-12-31'});
  await call({action:'watchRiskAction',id:risk.id,expectedVersion:Number(current.version)+1,operation:'approve',reason:'独立核对例外'},reviewer);
  current=await DB.prepare('SELECT * FROM investment_watch_risks WHERE id=?').bind(risk.id).first();assert.equal(current.state,'exception');
  const detail=JSON.parse(current.detail_json);detail.until='2020-01-01';detail.assignee=reviewer;
  await DB.prepare('UPDATE investment_watch_risks SET detail_json=? WHERE id=?').bind(JSON.stringify(detail),risk.id).run();
  await DB.prepare("UPDATE project_memberships SET status='removed' WHERE project_id=? AND user_id=?").bind(pid,reviewer).run();
  await DB.prepare('UPDATE investment_watch SET next_at=0 WHERE project_id=?').bind(pid).run();await executeInvestmentWatch(env,await claimInvestmentWatch(env));
  assert.equal((await DB.prepare('SELECT state FROM investment_watch_risks WHERE id=?').bind(risk.id).first()).state,'open');
  assert.equal(Number((await DB.prepare('SELECT COUNT(*) AS n FROM investment_watch_notices WHERE recipient_id=?').bind(reviewer).first()).n),0);
  const notices=Number((await DB.prepare('SELECT COUNT(*) AS n FROM investment_watch_notices WHERE project_id=?').bind(pid).first()).n);
  await DB.prepare('UPDATE investment_watch SET next_at=0 WHERE project_id=?').bind(pid).run();await executeInvestmentWatch(env,await claimInvestmentWatch(env));
  assert.equal(Number((await DB.prepare('SELECT COUNT(*) AS n FROM investment_watch_notices WHERE project_id=?').bind(pid).first()).n),notices);
  // No UI-list LIMIT 100 may truncate the period scope or hide old unresolved items.
  for(let i=0;i<121;i++)await DB.prepare("INSERT INTO project_risks(id,project_id,user_id,title,status,created_at,updated_at) VALUES(?,?,?,'legacy','closed',1,1)").bind(crypto.randomUUID(),pid,owner).run();
  data=await readInvestmentWatch(env,{userId:owner},a,'month');assert.equal(data.view.totals.unique,124);assert.equal(data.view.totals.carryover,121);
  // Expired worker cannot advance a watermark; failure is retained and retried.
  await DB.prepare('UPDATE investment_watch SET next_at=0 WHERE project_id=?').bind(pid).run();const failedJob=await claimInvestmentWatch(env);
  const before=(await DB.prepare('SELECT watermark FROM investment_watch WHERE project_id=?').bind(pid).first()).watermark;
  await DB.prepare('UPDATE investment_watch SET lease_until=1 WHERE project_id=?').bind(pid).run();await assert.rejects(executeInvestmentWatch(env,failedJob),{status:409});
  const failed=await DB.prepare('SELECT * FROM investment_watch WHERE project_id=?').bind(pid).first();assert.equal(failed.watermark,before);assert.equal(JSON.parse(failed.last_json).status,'failed');
  assert.equal(JSON.parse((await DB.prepare('SELECT result_json FROM investment_check_runs WHERE request_id=?').bind('watch-failed-'+failedJob.token).first()).result_json).failed,1);
 }finally{await DB._close();}
});
