import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createD1Shim} from '../local-server/d1-shim.js';
import {createInvestmentCalculator} from '../local-server/investment-calculator.js';
import {onRequestGet,onRequestPost} from '../functions/api/investmentops.js';
import {signToken} from '../functions/api/_auth.js';
import {changeProjectMember} from '../functions/api/_project-members.js';
import {deliveryAction} from '../functions/api/_delivery.js';
import {testDatabaseUrl} from '../scripts/require-test-database.mjs';
const target=testDatabaseUrl();
test('隔离PostgreSQL：可信情景、独立版本、会议幂等和事务回滚',{skip:!target},async t=>{
  const DB=createD1Shim(target),calculator=createInvestmentCalculator(),env={DB,SESSION_SECRET:crypto.randomUUID(),INVESTMENT_CALCULATOR:calculator},projectId=crypto.randomUUID();
  try{
    async function newUser(){const username='ops-test-'+crypto.randomUUID();await DB.prepare('INSERT INTO users(username,pass_hash,salt,created_at) VALUES(?,?,?,?)').bind(username,'disabled','test',Date.now()).run();return Number((await DB.prepare('SELECT id FROM users WHERE username=?').bind(username).first()).id);}
    const owner=await newUser(),editor=await newUser(),viewer=await newUser(),outside=await newUser();
    const source=readFileSync(new URL('./calc-engines.test.js',import.meta.url),'utf8'),match=source.match(/const GAIBAO_DEFAULT_PARAMS = (\{[\s\S]*?\n\});/),params=JSON.parse(JSON.stringify(vm.runInNewContext('('+match[1]+')')));
    const snapshot={id:'calc-test-v1',version:1,calcType:'gaibao',params};snapshot.summary=calculator.calculate({snapshot}).summary;
    const data={project:{type:'gaibao'},chapters:[{name:'总论',sections:[{t:'净现值',content:'净现值：768.04万元。'}]}],workflow:{currentCalcSnapshotId:snapshot.id,calcSnapshots:[snapshot]}};
    await DB.prepare('INSERT INTO projects(id,user_id,name,data,updated_at) VALUES(?,?,?,?,?)').bind(projectId,owner,'[系统测试]投资运营',JSON.stringify(data),Date.now()).run();
    await changeProjectMember(env,owner,projectId,editor,'EDITOR');await changeProjectMember(env,owner,projectId,viewer,'VIEWER');
    async function call(body,userId=owner,override={}){const headers={authorization:'Bearer '+await signToken(env,userId,'ops-test'),'content-type':'application/json'},request=new Request('http://test/api/investmentops?projectId='+projectId,{method:body?'POST':'GET',headers,body:body?JSON.stringify({projectId,...body}):undefined}),response=await(body?onRequestPost:onRequestGet)({env:{...env,...override},request});return {status:response.status,data:await response.json()};}
    let scenarioId;
    await t.test('三种角色、显式快照、客户端指标与缺失引擎',async()=>{
      assert.equal((await call({action:'saveScenario'},viewer)).status,403);assert.equal((await call(null,outside)).status,404);
      assert.equal((await call({action:'saveScenario',scenario:{metrics:{irr:99}}})).status,400);assert.equal((await call({action:'saveScenario',calcSnapshotId:'missing'})).status,409);assert.equal((await call({action:'saveScenario'},owner,{INVESTMENT_CALCULATOR:null})).status,503);
      const saved=await call({action:'saveScenario',scenario:{kind:'baseline'}});assert.equal(saved.status,200,JSON.stringify(saved.data));scenarioId=saved.data.id;assert.equal(saved.data.scenario.metrics.irr,23.11);
      assert.equal((await call(null,editor)).data.ops.scenarios.length,0);assert.equal((await call({action:'selectScenario',scenarioId},editor)).status,403);assert.equal((await call({action:'selectScenario',scenarioId})).status,200);assert.equal((await call(null,editor)).data.ops.adoptedScenarioId,scenarioId);
    });
    await t.test('只有项目有效证据+当前独立复核能生成就绪包；修改后失效',async()=>{
      const evidenceId=crypto.randomUUID();await DB.prepare("INSERT INTO project_facts(id,project_id,user_id,fact_type,fact_key,value_json,status,source_ref,created_by,created_at,updated_at) VALUES(?,?,?,'investment','verified.input','1','confirmed','test-source','test-reviewer',?,?)").bind(evidenceId,projectId,owner,Date.now(),Date.now()).run();
      const body={action:'createDecisionPackage',scenarioId,evidenceIds:[evidenceId]};assert.equal((await call({...body,evidenceIds:['missing']})).status,404);assert.equal((await call(body)).data.package.status,'blocked');
      const frozen=await deliveryAction(env,owner,{action:'freeze',projectId,reviewerId:viewer,contract:{expected:[{label:'净现值',value:768.04,unit:'万元',sourceRef:'测试白箱快照',version:'1'}]}});await deliveryAction(env,viewer,{action:'approve',projectId,id:frozen.id,note:'[系统测试]模拟独立核验',factsReviewed:true,wordLayoutReviewed:true});
      const ready=await call(body);assert.equal(ready.status,200,JSON.stringify(ready.data));assert.equal(ready.data.package.status,'ready');
      const readReady=async()=>(await call(null)).data.ops.packages.find(x=>x.id===ready.data.id);assert.equal((await readReady()).status,'ready');
      await DB.prepare("UPDATE project_facts SET value_json='2' WHERE id=?").bind(evidenceId).run();assert.equal((await readReady()).status,'blocked');assert.equal((await readReady()).historicalStatus,'ready');
      await DB.prepare("UPDATE project_facts SET value_json='1' WHERE id=?").bind(evidenceId).run();assert.equal((await readReady()).status,'ready');
      await DB.prepare("UPDATE project_facts SET status='candidate' WHERE id=?").bind(evidenceId).run();assert.equal((await readReady()).status,'blocked');await DB.prepare("UPDATE project_facts SET status='confirmed' WHERE id=?").bind(evidenceId).run();
      data.chapters[0].sections[0].content+='文字改动';await DB.prepare('UPDATE projects SET data=? WHERE id=?').bind(JSON.stringify(data),projectId).run();assert.equal((await call(body)).data.package.status,'blocked');
      assert.equal((await readReady()).status,'blocked');
      data.workflow.calcSnapshots[0].summary.irr=999;await DB.prepare('UPDATE projects SET data=? WHERE id=?').bind(JSON.stringify(data),projectId).run();assert.equal((await call({action:'selectScenario',scenarioId})).status,409);assert.equal((await call({action:'saveScenario'})).status,409);
    });
    await t.test('会议多标签：空选拒绝，两次并发仅一组共享记录',async()=>{
      const meeting=await call({action:'extractMeeting',content:'会议决定由投资部牵头完成融资风险复核'},editor);assert.equal(meeting.status,200);
      assert.equal((await call({action:'confirmMeeting',meetingId:meeting.data.id,selectedIds:[]},editor)).status,400);
      const both=await Promise.all([1,2].map(()=>call({action:'confirmMeeting',meetingId:meeting.data.id,confirmAll:true},editor)));assert.ok(both.every(x=>x.status===200),JSON.stringify(both));assert.equal(both.reduce((sum,x)=>sum+x.data.taskCount,0),1);
      for(const table of ['project_tasks','project_risks','project_decisions'])assert.equal(Number((await DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE project_id=? AND user_id=?`).bind(projectId,owner).first()).n),1);
      assert.equal((await call(null,owner)).data.ops.meetings.length,0);
    });
    await t.test('真实事务中风险落账失败，先插任务也回滚',async()=>{
      const meeting=await call({action:'extractMeeting',content:'由投资部牵头完成风险复核'},editor);
      const broken={...DB,_transaction:fn=>DB._transaction(tx=>fn({...tx,prepare(sql){const stmt=tx.prepare(sql);if(!sql.startsWith('INSERT INTO project_risks'))return stmt;return {bind(){return this;},run(){throw Error('injected');}};}}))};
      const failed=await call({action:'confirmMeeting',meetingId:meeting.data.id,confirmAll:true},editor,{DB:broken});assert.equal(failed.status,500);assert.equal((await DB.prepare('SELECT status FROM project_meetings WHERE id=?').bind(meeting.data.id).first()).status,'candidate');assert.equal(Number((await DB.prepare('SELECT COUNT(*) AS n FROM project_tasks WHERE project_id=?').bind(projectId).first()).n),1);
    });
    await t.test('完成证据与阶段里程碑：归属、失效、兼容、幂等及审计原子性',async()=>{
      const now=Date.now(),evidenceId=crypto.randomUUID(),foreignEvidence=crypto.randomUUID(),milestoneId=crypto.randomUUID(),foreignMilestone=crypto.randomUUID();
      for(const [id,project] of [[evidenceId,projectId],[foreignEvidence,'foreign-project']])await DB.prepare("INSERT INTO project_facts(id,project_id,user_id,fact_type,fact_key,value_json,status,source_ref,created_by,created_at,updated_at) VALUES(?,?,?,'investment','completion.input','1','confirmed','test-source','test-reviewer',?,?)").bind(id,project,owner,now,now).run();
      for(const [id,project] of [[milestoneId,projectId],[foreignMilestone,'foreign-project']])await DB.prepare("INSERT INTO project_milestones(id,project_id,name,stage_key,status,created_at,updated_at) VALUES(?,?,'[系统测试]交付核验','implementation','in_progress',?,?)").bind(id,project,now,now).run();
      const initial=(await call(null,editor)).data.ops,task=initial.tasks[0],risk=initial.risks[0],body={action:'updateItem',type:'task',id:task.id,status:'done'};
      assert.equal((await call(body,editor)).status,409);assert.equal((await call({...body,evidenceIds:[foreignEvidence]},editor)).status,404);
      assert.equal((await call({...body,evidenceIds:[evidenceId],stageKey:'bogus'},editor)).status,400);assert.equal((await call({...body,evidenceIds:[evidenceId],milestoneId:foreignMilestone},editor)).status,404);
      assert.equal((await call({...body,evidenceIds:[evidenceId],milestoneId,stageKey:'feasibility'},editor)).status,409);
      await DB.prepare("UPDATE project_facts SET status='candidate' WHERE id=?").bind(evidenceId).run();assert.equal((await call({...body,evidenceIds:[evidenceId]},editor)).status,409);await DB.prepare("UPDATE project_facts SET status='confirmed' WHERE id=?").bind(evidenceId).run();
      const completion={...body,evidenceIds:[evidenceId],milestoneId,expectedVersion:0},done=await call(completion,editor);assert.equal(done.status,200,JSON.stringify(done.data));assert.equal(done.data.contextVersion,1);assert.equal(done.data.stageKey,'implementation');
      const again=await call({...completion,expectedVersion:1},editor);assert.equal(again.data.reused,true);assert.equal(again.data.contextVersion,1);assert.equal((await call(completion,editor)).status,409);assert.equal((await call({...completion,expectedVersion:1},viewer)).status,403);
      const readTask=async()=>(await call(null,editor)).data.ops.tasks.find(x=>x.id===task.id);assert.equal((await readTask()).completionVerification,'evidence_verified');assert.equal((await readTask()).milestoneId,milestoneId);
      await DB.prepare("UPDATE project_facts SET value_json='2' WHERE id=?").bind(evidenceId).run();assert.equal((await readTask()).completionVerification,'evidence_changed_or_unavailable');await DB.prepare("UPDATE project_facts SET value_json='1' WHERE id=?").bind(evidenceId).run();
      const legacyId=crypto.randomUUID();await DB.prepare("INSERT INTO project_tasks(id,project_id,user_id,title,status,created_at,updated_at) VALUES(?,?,?,'[系统测试]旧完成事项','done',?,?)").bind(legacyId,projectId,owner,now,now).run();assert.equal((await call(null)).data.ops.tasks.find(x=>x.id===legacyId).completionVerification,'legacy_unverified');
      const riskBody={action:'updateItem',type:'risk',id:risk.id,status:'mitigated',evidenceIds:[evidenceId],stageKey:'implementation',milestoneId};
      const broken={...DB,_transaction:fn=>DB._transaction(tx=>fn({...tx,prepare(sql){const stmt=tx.prepare(sql);if(!sql.startsWith('INSERT INTO project_events'))return stmt;return {bind(){return this;},run(){throw Error('injected completion audit');}};}}))};
      assert.equal((await call(riskBody,editor,{DB:broken})).status,500);assert.equal((await DB.prepare('SELECT status FROM project_risks WHERE id=?').bind(risk.id).first()).status,'open');assert.equal(await DB.prepare('SELECT * FROM investment_item_context WHERE item_id=?').bind(risk.id).first(),null);
      assert.equal((await call({...riskBody,evidenceIds:[]},editor)).status,409);assert.equal((await call(riskBody,editor)).status,200);assert.equal((await call({...riskBody,status:'closed'},editor)).status,200);
      const meeting=await call({action:'extractMeeting',content:'由项目部负责完成交付核验'},editor),linked=await call({action:'confirmMeeting',meetingId:meeting.data.id,confirmAll:true,stageKey:'implementation',milestoneId},editor);assert.equal(linked.status,200,JSON.stringify(linked.data));assert.ok((await call(null)).data.ops.tasks.some(x=>x.sourceRef.includes(meeting.data.id)&&x.milestoneId===milestoneId&&x.stageKey==='implementation'));
    });
    await t.test('自报通过不能满足生产门槛，撤销角色后读写皆拒绝',async()=>{
      const saved=await call({action:'saveEvaluation',type:'golden_project',status:'passed',result:{numericErrors:0,serverVerified:true}});assert.equal(saved.data.productionEligible,false);assert.equal((await call(null)).data.ops.production.passed,false);
      const removed=await changeProjectMember(env,owner,projectId,editor,'EDITOR',true);assert.equal(removed.ok,true);assert.equal((await call(null,editor)).status,404);
    });
  }finally{await DB._close();}
});
