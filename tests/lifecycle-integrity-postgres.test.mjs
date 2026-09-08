import test from 'node:test';
import assert from 'node:assert/strict';
import {createD1Shim} from '../local-server/d1-shim.js';
import {signToken} from '../functions/api/_auth.js';
import * as brain from '../functions/api/projectbrain.js';
import * as intelligence from '../functions/api/projectintelligence.js';
import {changeProjectMember} from '../functions/api/_project-members.js';
import {testDatabaseUrl} from '../scripts/require-test-database.mjs';

const target=testDatabaseUrl();
test('全周期完整性：真实PG角色、对象归属、阶段CAS、审计原子性及事实缺口', {skip:!target}, async t=>{
  const DB=createD1Shim(target),env={DB,SESSION_SECRET:crypto.randomUUID(),DEPLOY_MODE:'local'},ids=[];
  const pid=crypto.randomUUID(),other=crypto.randomUUID(),empty=crypto.randomUUID();
  try{
    for(const role of ['owner','editor','viewer','outside'])ids.push(Number((await DB.prepare('INSERT INTO users(username,pass_hash,salt,created_at) VALUES(?,?,?,?) RETURNING id').bind('[系统测试]生命周期'+role+crypto.randomUUID(),'disabled','disabled',Date.now()).first()).id));
    const [owner,editor,viewer,outside]=ids;
    for(const id of [pid,other,empty])await DB.prepare('INSERT INTO projects(id,user_id,name,data,updated_at) VALUES(?,?,?,?,?)').bind(id,owner,'[系统测试]生命周期',JSON.stringify(id===pid?{project:{name:'项目A',investmentStage:'feasibility'}}:{}),1).run();
    await changeProjectMember(env,owner,pid,editor,'EDITOR');await changeProjectMember(env,owner,pid,viewer,'VIEWER');
    async function call(api,uid,body=null,id=pid,override=env){
      const token=await signToken(env,uid,'[系统测试]'),method=body?'POST':'GET',request=new Request('http://test/api/lifecycle?projectId='+id,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body?{body:JSON.stringify({projectId:id,...body})}:{})});
      const r=await api[body?'onRequestPost':'onRequestGet']({request,env:override});return {status:r.status,data:await r.json()};
    }
    await t.test('空项目也显示未录入的必需事实，读取不推断批准或制造阶段历史',async()=>{
      const r=await call(intelligence,owner,null,empty);assert.equal(r.status,200,JSON.stringify(r.data));
      assert.equal(r.data.readModel.dataHealth.score,0);assert.equal(r.data.readModel.dataHealth.missingFacts,4);
      assert.equal(r.data.readModel.progress.value,null);assert.equal(r.data.readModel.stage.key,'discovery');assert.equal(r.data.readModel.stage.version,0);
      assert.equal(Number((await DB.prepare('SELECT COUNT(*) AS n FROM project_work_stages WHERE project_id=?').bind(empty).first()).n),0);
      assert.equal(Number((await DB.prepare('SELECT COUNT(*) AS n FROM project_stage_history WHERE project_id=?').bind(empty).first()).n),0);
    });
    await t.test('EDITOR共享事实，VIEWER只读、外人不可读；点位、冲突和NA理由往返保留',async()=>{
      assert.equal((await call(brain,outside)).status,404);
      assert.equal((await call(brain,viewer,{action:'upsertFact',fact:{factKey:'x',value:1}})).status,403);
      assert.equal((await call(brain,editor,{action:'upsertFact',fact:{factKey:'x',status:'not_applicable'}})).status,400);
      for(const scopeId of ['A','B'])assert.equal((await call(brain,editor,{action:'upsertFact',fact:{factKey:'asset.area',scopeId,value:scopeId==='A'?100:200,status:'confirmed',sourceLocator:'材料第1页',basis:'建筑面积'}})).status,200);
      assert.equal((await call(brain,editor,{action:'upsertFact',fact:{factKey:'asset.ownership',value:'待核',status:'conflict',conflictValues:['甲','乙']}})).status,200);
      assert.equal((await call(brain,editor,{action:'upsertFact',fact:{factKey:'custom.na',status:'not_applicable',naReason:'该项目不涉及'}})).status,200);
      const a=await call(brain,owner),b=await call(brain,viewer);assert.equal(a.status,200);assert.equal(b.status,200);assert.deepEqual(a.data.context.facts,b.data.context.facts);
      const scoped=a.data.context.facts.filter(x=>x.factKey==='asset.area');assert.equal(scoped.length,2);assert.equal(scoped[0].confirmedBy,String(editor));assert.equal(scoped[0].sourceLocator,'材料第1页');
      assert.deepEqual(a.data.context.facts.find(x=>x.factKey==='asset.ownership').conflictValues,['甲','乙']);
      assert.equal(a.data.context.facts.find(x=>x.factKey==='custom.na').naReason,'该项目不涉及');
      assert.equal((await DB.prepare('SELECT DISTINCT user_id FROM project_facts WHERE project_id=?').bind(pid).first()).user_id,owner);
      const e=await DB.prepare("SELECT payload_json FROM project_events WHERE project_id=? AND event_type='fact.updated' ORDER BY created_at DESC LIMIT 1").bind(pid).first();assert.equal(JSON.parse(e.payload_json).actorUserId,editor);
    });
    await t.test('个人变更草案与共享候选决策分开，所有者也不能读取他人私人预演',async()=>{
      const mine=await call(brain,editor,{action:'saveChangeSet',title:'编辑者私有',before:{rent:1},after:{rent:2}});assert.equal(mine.status,200);
      assert.equal((await call(brain,editor)).data.context.changes.some(x=>x.id===mine.data.id),true);
      assert.equal((await call(brain,owner)).data.context.changes.some(x=>x.id===mine.data.id),false);
      const d=await call(brain,editor,{action:'createDecision',decision:{topic:'共享候选',status:'candidate'}});assert.equal(d.status,200);
      assert.equal((await call(brain,viewer)).data.context.decisions.some(x=>x.id===d.data.id),true);
      assert.equal((await call(brain,editor,{action:'saveChangeSet',approvalStatus:'approved'})).status,403);
    });
    const gate='gate-'+crypto.randomUUID(),milestone='milestone-'+crypto.randomUUID(),deliverable='deliverable-'+crypto.randomUUID(),artifact='artifact-'+crypto.randomUUID();
    await t.test('跨项目对象ID和关联不可覆写；成果完成必须有真实登记对象',async()=>{
      assert.equal((await call(intelligence,owner,{action:'saveGate',gate:{id:gate,name:'A阶段门',stageKey:'feasibility',status:'in_progress'}})).status,200);
      assert.equal((await call(intelligence,owner,{action:'saveGate',gate:{id:gate,name:'非法覆盖'}},other)).status,404);
      assert.equal((await call(intelligence,owner,{action:'saveMilestone',milestone:{name:'错误关联',gateId:gate}},other)).status,404);
      assert.equal((await call(intelligence,editor,{action:'saveMilestone',milestone:{id:milestone,name:'A里程碑',gateId:gate,stageKey:'feasibility',progress:40}})).status,200);
      assert.equal((await call(intelligence,owner,{action:'saveMilestone',milestone:{id:milestone,name:'非法覆盖'}},other)).status,404);
      assert.equal((await call(brain,editor,{action:'registerArtifact',artifact:{id:artifact,type:'report',title:'已登记初稿'}})).status,200);
      assert.equal((await call(intelligence,editor,{action:'saveDeliverable',deliverable:{id:deliverable,name:'可研初稿',gateId:gate,milestoneId:milestone,artifactId:artifact,stageKey:'feasibility',status:'done'}})).status,200);
      assert.equal((await call(intelligence,owner,{action:'saveDeliverable',deliverable:{id:deliverable,name:'非法覆盖'}},other)).status,404);
      assert.equal((await call(intelligence,owner,{action:'saveDeliverable',deliverable:{name:'非法引用',artifactId:artifact}},other)).status,404);
      assert.equal((await call(intelligence,editor,{action:'saveDeliverable',deliverable:{name:'没有成果',status:'done'}})).status,400);
      assert.equal((await DB.prepare('SELECT name FROM project_gates WHERE id=?').bind(gate).first()).name,'A阶段门');
      const concurrentId='concurrent-'+crypto.randomUUID(),results=await Promise.all([pid,other].map(id=>call(intelligence,owner,{action:'saveGate',gate:{id:concurrentId,name:id}},id)));
      assert.deepEqual(results.map(x=>x.status).sort(),[200,404]);
    });
    await t.test('编辑权限不等于正式审批，OWNER也不得伪造通过、豁免和签发',async()=>{
      for(const user of [owner,editor])for(const status of ['passed','waived'])assert.equal((await call(intelligence,user,{action:'saveGate',gate:{id:gate,status}})).status,403);
      for(const user of [owner,editor])assert.equal((await call(brain,user,{action:'createDecision',decision:{topic:'假批准',status:'adopted'}})).status,403);
      assert.equal((await call(brain,owner,{action:'registerArtifact',artifact:{type:'report',status:'signed'}})).status,403);
      assert.equal((await call(brain,editor,{action:'upsertMetric',metric:{metricKey:'projectIrr',value:6,calcSnapshotId:'fake'}})).status,400);
      const metric=await call(brain,editor,{action:'upsertMetric',metric:{metricKey:'note',value:6,lineage:{engine:'whitebox'}}});assert.equal(metric.status,200);
      assert.equal(JSON.parse((await DB.prepare('SELECT lineage_json FROM project_metrics WHERE id=?').bind(metric.data.id).first()).lineage_json).trust,'unverified');
      assert.equal((await call(intelligence,owner)).data.readModel.contextContract.permissions.approve,false);
    });
    await t.test('阶段唯一写入口：冲突可见、CAS、并发、撤销、旧Brain兼容且不伪造批准',async()=>{
      await DB.prepare("UPDATE project_profiles SET lifecycle_stage='screening' WHERE project_id=?").bind(pid).run();
      const before=(await call(intelligence,owner)).data.readModel.stage;assert.equal(before.version,0);assert.equal(before.legacyConflict.legacyStage,'feasibility');
      assert.equal((await call(intelligence,owner,{action:'updateWorkStage',stageKey:'decision'})).status,428);
      assert.equal((await call(intelligence,editor,{action:'updateWorkStage',stageKey:'decision',expectedVersion:0})).status,403);
      assert.equal((await call(intelligence,owner,{action:'updateProfile',profile:{lifecycleStage:'decision'}})).status,409);
      const changed=await call(intelligence,owner,{action:'updateWorkStage',stageKey:'feasibility',expectedVersion:0});assert.equal(changed.status,200,JSON.stringify(changed.data));assert.equal(changed.data.stage.version,1);
      const outcomes=await Promise.all(['decision','implementation'].map(stageKey=>call(intelligence,owner,{action:'updateWorkStage',stageKey,expectedVersion:1})));assert.deepEqual(outcomes.map(x=>x.status).sort(),[200,409]);
      const winner=outcomes.find(x=>x.status===200),undo=await call(brain,owner,{action:'setStage',...winner.data.undo});assert.equal(undo.status,200);assert.equal(undo.data.stage.key,'feasibility');assert.equal(undo.data.stage.version,3);
      assert.equal((await call(intelligence,owner)).data.readModel.stage.version,3);assert.equal((await call(brain,viewer)).data.context.lifecycle.version,3);
      const history=(await DB.prepare('SELECT approved_by FROM project_stage_history WHERE project_id=?').bind(pid).all()).results;assert.equal(history.length,3);assert.ok(history.every(x=>x.approved_by===''));
      const event=await DB.prepare("SELECT payload_json FROM project_events WHERE project_id=? AND event_type='project.work_stage.updated' ORDER BY created_at DESC LIMIT 1").bind(pid).first();assert.equal(JSON.parse(event.payload_json).formalApproval,false);
    });
    await t.test('审计写入失败整笔回滚；查询异常返回503，不伪装健康空白',async()=>{
      const failDb={...DB,_transaction:work=>DB._transaction(tx=>work({...tx,prepare(sql){if(sql.startsWith('INSERT INTO project_events'))throw new Error('injected audit failure');return tx.prepare(sql);}}))};
      const before=await DB.prepare('SELECT * FROM project_work_stages WHERE project_id=?').bind(pid).first();
      const r=await call(intelligence,owner,{action:'updateWorkStage',stageKey:'decision',expectedVersion:Number(before.version)},pid,{...env,DB:failDb});assert.equal(r.status,503);
      assert.deepEqual(await DB.prepare('SELECT * FROM project_work_stages WHERE project_id=?').bind(pid).first(),before);
      const fact=await call(brain,editor,{action:'upsertFact',fact:{factKey:'rollback.fact',value:123}},pid,{...env,DB:failDb});assert.equal(fact.status,503);
      assert.equal(Number((await DB.prepare("SELECT COUNT(*) AS n FROM project_facts WHERE project_id=? AND fact_key='rollback.fact'").bind(pid).first()).n),0);
      const readDb={...DB,prepare(sql){if(sql.includes('FROM project_metrics'))throw new Error('injected read failure');return DB.prepare(sql);}};
      assert.equal((await call(intelligence,owner,null,pid,{...env,DB:readDb})).status,503);assert.equal((await call(brain,owner,null,pid,{...env,DB:readDb})).status,503);
    });
    await t.test('采用方案不取私人草案或排序第一项，撤权立即禁止旧Brain和新Read Model',async()=>{
      for(const [id,status,uid] of [['private-draft','draft',editor],['explicit-selected','selected',owner]])await DB.prepare('INSERT INTO project_scenarios(id,project_id,user_id,name,kind,calc_snapshot_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id+pid,pid,uid,id,'base','snapshot',status,Date.now(),Date.now()).run();
      const r=await call(intelligence,viewer);assert.equal(r.status,200);assert.equal(r.data.readModel.contextContract.selectedScenarioId,'explicit-selected'+pid);assert.equal(r.data.readModel.contextContract.activeScenario.name,'explicit-selected');assert.equal(r.data.readModel.kpis.irr,null);assert.equal(r.data.readModel.kpiVerification.status,'unverified');assert.deepEqual(r.data.readModel.contextContract.activeScenario.metrics,{});
      await changeProjectMember(env,owner,pid,editor,'',true);assert.equal((await call(brain,editor)).status,404);assert.equal((await call(intelligence,editor)).status,404);
      assert.equal((await call(brain,editor,{action:'upsertFact',fact:{factKey:'revoked',value:1}})).status,404);
    });
  }finally{await DB._close();}
});
