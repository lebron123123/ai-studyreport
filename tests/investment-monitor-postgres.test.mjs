import test from 'node:test';
import assert from 'node:assert/strict';
import {createD1Shim} from '../local-server/d1-shim.js';
import {testDatabaseUrl} from '../scripts/require-test-database.mjs';
import {ensureInvestmentTables} from '../functions/api/investmentops.js';
import {withProjectMutation} from '../functions/api/_lifecycle-integrity.js';
import {resolveProjectAccess} from '../functions/api/_project-access.js';
import {mutateFormalFact,normalizeFormalFact} from '../functions/api/_investment-formal-facts.js';
import {mutateObligation} from '../functions/api/_investment-obligations.js';
import {ensureInvestmentMonitor,runInvestmentCheck,readInvestmentChecks,investmentMetricYuan,investmentBusinessDate} from '../functions/api/_investment-monitor.js';
const target=testDatabaseUrl();
test('单位换算保留一分钱、北京时间边界、规则不默认发布',()=>{
 assert.equal(investmentMetricYuan(120.000001,'万元'),'1200000.01');
 assert.equal(investmentMetricYuan('1.01','元'),'1.01');
 assert.throws(()=>investmentMetricYuan('1.001','元'));assert.throws(()=>investmentMetricYuan(null,'万元'));
 assert.equal(investmentBusinessDate(Date.parse('2026-09-08T16:00:00Z')),'2026-09-09');
 assert.throws(()=>normalizeFormalFact({kind:'rule',title:'制度',date:'2026-01-01',locator:'第一条',reason:'初次',ruleType:'construction',scope:'整体',validFrom:'2026-01-01',operator:'gt',years:''}));
});
test('批准计时与持久检查：独立核验、原件变化、原基线、重复请求、失败覆盖、历史保留',{skip:!target},async()=>{
 const DB=createD1Shim(target),env={DB,RAG_OBJECTS:{verify:async()=>({ok:true,sizeBytes:10})}},projectId=crypto.randomUUID(),eventId=crypto.randomUUID(),sourceId=crypto.randomUUID();
 try{
  await ensureInvestmentTables(env);await ensureInvestmentMonitor(env);await ensureInvestmentMonitor(env);
  const users=[];for(let i=0;i<2;i++){const name='[系统测试]monitor-'+crypto.randomUUID();await DB.prepare('INSERT INTO users(username,pass_hash,salt,created_at) VALUES(?,?,?,?)').bind(name,'disabled','disabled',Date.now()).run();users.push(Number((await DB.prepare('SELECT id FROM users WHERE username=?').bind(name).first()).id));}
  const [owner,editor]=users;
  await DB.prepare('INSERT INTO projects(id,user_id,name,data,updated_at) VALUES(?,?,?,?,?)').bind(projectId,owner,'[系统测试]规则检查','{}',Date.now()).run();
  await DB.prepare("INSERT INTO project_memberships(project_id,user_id,role,status,created_at,updated_at) VALUES(?,?,'EDITOR','active',?,?)").bind(projectId,editor,Date.now(),Date.now()).run();
  await DB.prepare('INSERT INTO project_meetings(id,project_id,user_id,title,content,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(eventId,projectId,owner,'[系统测试]决议','测试材料',Date.now(),Date.now()).run();
  await DB.prepare('INSERT INTO report_source_artifacts(id,project_id,user_id,content_hash,storage_key,file_name,mime_type,size_bytes,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(sourceId,projectId,owner,'hash','key','test.txt','text/plain',10,Date.now()).run();
  const call=(b,u=owner)=>withProjectMutation(env,{userId:u},projectId,'edit',(tx,a)=>mutateFormalFact(tx,{userId:u},a,b));
  const base={action:'saveFormalFact',eventId,sourceId,round:1,expectedVersion:0,newRoundConfirmed:true,title:'[系统测试]登记',date:'2026-01-02',locator:'第1条',reason:'验证'};
  const verify=(id,expectedVersion=1)=>call({action:'verifyFormalFact',id,expectedVersion,confirmed:true,reason:'已独立核对'},editor);
  const save=async fields=>{const r=await call({...base,...fields});await verify(r.id,Number(fields.expectedVersion||0)+1);return r;};
  await call({action:'grantFactVerifier',userId:editor,basis:'独立核验',active:true,expectedVersion:0});
  await save({kind:'held'});const decision=await save({kind:'decision',result:'passed'});
  const original=await save({kind:'original',amount:'1000000.00',currency:'CNY',amountBasis:'含税总投资',scope:'项目整体',decisionId:decision.id,plannedStart:'2026-02-28'});
  await save({kind:'adjustment',amount:'1200000.00',currency:'CNY',amountBasis:'含税总投资',scope:'项目整体',decisionId:decision.id,originalId:original.id});
  const handoff=await withProjectMutation(env,{userId:owner},projectId,'manage',(tx,a)=>mutateObligation(tx,{userId:owner},a,{action:'saveHandoff',eventId,type:'board',round:1,expectedVersion:0,newRoundConfirmed:true,title:'董事会材料',basis:'决议',dueDate:'2026-09-05',dueBasis:'制度',result:'follow_up',reason:'确认',assigneeId:editor}));
  const run=async(requestId=crypto.randomUUID(),override=env)=>withProjectMutation(override,{userId:owner},projectId,'manage',(tx,a)=>runInvestmentCheck(tx,{userId:owner},a,{requestId},{verifyScenario:async()=>true,now:Date.parse('2026-09-09T00:00Z')}));
  let r=await run();assert.equal(r.result.status,'partial');assert.equal(r.result.checked,0);
  const rule={kind:'rule',scope:'项目整体',validFrom:'2026-01-01',operator:'gt'};
  const deadline=await save({...rule,ruleType:'deadline',validUntil:'2026-12-31',clockStart:'2026-01-02',stacking:'extension-plus-pauses'});
  const pause=await call({...base,kind:'pause',decisionId:decision.id,obligationId:handoff.id,start:'2026-09-01',end:'2026-09-06'});
  r=await run();assert.equal(r.result.results[0].status,'unknown');await verify(pause.id);
  r=await run();assert.equal(r.result.results[0].effectiveDue,'2026-09-10');assert.equal(r.result.results[0].status,'clear');
  await save({kind:'extension',decisionId:decision.id,obligationId:handoff.id,newDue:'2026-09-10'});
  r=await run();assert.equal(r.result.results[0].effectiveDue,'2026-09-15');
  const conflict=await call({...base,...rule,round:4,ruleType:'deadline',clockStart:'2026-01-02',stacking:'no-mix'});await assert.rejects(verify(conflict.id),{status:409});
  // Even a pending conflicting rule must not silently retain green output.
  assert.equal((await run()).result.results[0].status,'unknown');
  await save({...rule,round:4,ruleType:'deadline',clockStart:'2026-01-02',stacking:'no-mix',validFrom:'2027-01-01',expectedVersion:1});
  await save({...rule,round:2,ruleType:'construction',years:2});
  const scenarioId=crypto.randomUUID();
  await DB.prepare('INSERT INTO project_scenarios(id,project_id,user_id,name,kind,calc_snapshot_id,metrics_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(scenarioId,projectId,owner,'[系统测试]采纳情景','forecast','test',JSON.stringify({values:{totalInvestment:120.000001},metricMeta:{totalInvestment:{unit:'万元',currency:'CNY'}}}),'selected',Date.now(),Date.now()).run();
  await save({...rule,round:3,ruleType:'investment',thresholdBps:2000,currency:'CNY',amountBasis:'含税总投资',metricUnit:'万元',scenarioId});
  const requestId=crypto.randomUUID();r=await run(requestId);assert.equal(r.result.status,'complete');assert.equal(r.result.results.find(x=>x.key==='investment').status,'triggered');assert.equal(r.result.results.find(x=>x.key==='investment').baselineId,original.id);
  assert.equal((await run(requestId)).id,r.id);
  const broken={...env,RAG_OBJECTS:{verify:async()=>({ok:false,sizeBytes:10})}};
  const failed=await run(crypto.randomUUID(),broken);assert.equal(failed.result.checked,0);assert.equal(failed.result.status,'partial');
  const access=await resolveProjectAccess(env,owner,projectId),history=await readInvestmentChecks(env,access);assert.ok(history.runs.some(x=>x.id===r.id&&x.status==='complete'));assert.ok(history.runs.some(x=>x.id===failed.id));
  await call({...base,kind:'pause',decisionId:decision.id,obligationId:handoff.id,start:'2026-09-01',end:'2026-09-07',expectedVersion:2});assert.equal((await run()).result.results[0].status,'unknown');
  await assert.rejects(withProjectMutation(env,{userId:editor},projectId,'edit',(tx,a)=>runInvestmentCheck(tx,{userId:editor},a,{requestId:crypto.randomUUID()},{})),{status:403});
  assert.ok(deadline.id);
 }finally{await DB._close();}
});
