import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequestGet,onRequestPost} from '../functions/api/investmentops.js';
import {signToken} from '../functions/api/_auth.js';
import {deliverySnapshot} from '../functions/api/_delivery.js';
import {reportEvidenceHash} from '../functions/api/_report-trusted-evaluation.js';

function result(){const metrics={irr:5,capitalIrr:6,npv:120,payback:18,capitalPayback:19,totalInvestment:10000},metricMeta={};for(const key of Object.keys(metrics))metricMeta[key]={unit:key.includes('Irr')||key==='irr'?'%':key.toLowerCase().includes('payback')?'年':'万元',currency:'CNY',period:'2026-2046;annual',cashFlow:key.startsWith('capital')?'capital':'project',engineVersion:'fixture',discountRate:3.5};return {summary:{irr:5,totalNpv:120},metrics,metricMeta,invalidMetrics:[],engineVersion:'fixture',configHash:'fixture',period:'2026-2046;annual',currency:'CNY'};}
function db(){
  const state={projects:[{id:'project-ops',name:'[系统测试]运营',user_id:1,updated_at:10,data:JSON.stringify({project:{type:'rent'},workflow:{currentCalcSnapshotId:'calc-v1',calcSnapshots:[{id:'calc-v1',version:1,calcType:'rent',params:{rent:40},summary:result().summary}]}})}],project_memberships:[{project_id:'project-ops',user_id:2,role:'EDITOR',status:'active'},{project_id:'project-ops',user_id:3,role:'VIEWER',status:'active'}],project_artifacts:[{id:'evidence-1',project_id:'project-ops',user_id:1,artifact_type:'evidence',title:'Verified bill',version:'1',meta_json:JSON.stringify({content:'Actual bill content',sourceRef:'bill-1',sourceLocator:'page 1',confirmed:true,confirmedBy:1}),status:'confirmed',updated_at:0}],project_facts:[],project_meetings:[],project_tasks:[],project_risks:[],project_decisions:[],project_scenarios:[],project_events:[],project_evaluations:[],report_deliveries:[],project_decision_packages:[]};
  let tail=Promise.resolve();const DB={state,failSql:'',_transaction(fn){const run=tail.then(async()=>{const backup=structuredClone(state);try{return await fn(DB);}catch(error){for(const key of Object.keys(state))delete state[key];Object.assign(state,backup);throw error;}});tail=run.catch(()=>{});return run;},prepare(sql){let args=[];function selected(){const table=sql.match(/FROM (\w+)/)?.[1],all=state[table]||[];let filtered=all;
    if(sql.includes('WHERE id=?'))filtered=filtered.filter(x=>x.id===args[0]);
    if(sql.includes('WHERE project_id=?'))filtered=filtered.filter(x=>x.project_id===args[0]);
    if(sql.includes('WHERE id=? AND project_id=?'))filtered=filtered.filter(x=>x.project_id===args[1]);
    if(sql.includes('AND user_id=?'))filtered=filtered.filter(x=>Number(x.user_id)===Number(args[sql.includes('WHERE id=? AND project_id=?')?2:1]));
    if(sql.includes("(user_id=? OR status='selected')"))filtered=filtered.filter(x=>Number(x.user_id)===Number(args[1])||x.status==='selected');
    if(sql.includes("(status='selected' OR (status='submitted' AND ?=1))"))filtered=filtered.filter(x=>x.status==='selected'||(x.status==='submitted'&&args[1]===1));
    if(sql.includes("AND status='approved'"))filtered=filtered.filter(x=>x.status==='approved');return filtered;
  }
  return {bind(...a){args=a;return this;},async first(){return selected()[0]||null;},async all(){return {results:selected()};},async run(){
    if(DB.failSql&&sql.includes(DB.failSql))throw Error('injected database failure');
    const insert=sql.match(/^INSERT INTO (\w+)\(([^)]+)\) VALUES\(([^)]+)\)/);
    if(insert){let n=0;const keys=insert[2].split(','),values=insert[3].split(','),row=Object.fromEntries(keys.map((key,i)=>[key,values[i]==='?'?args[n++]:values[i].replace(/^'|'$/g,'')]));state[insert[1]]||=[];if(!state[insert[1]].some(x=>x.id&&x.id===row.id))state[insert[1]].push(row);}
    if(sql.startsWith('UPDATE project_meetings')){const row=state.project_meetings.find(x=>x.id===args[3]);if(row)Object.assign(row,{extraction_json:args[0],status:args[1],updated_at:args[2]});}
    if(sql.startsWith("UPDATE project_scenarios SET status='archived'"))for(const row of state.project_scenarios)if(row.project_id===args[1]&&row.status==='selected'&&row.id!==args[2])row.status='archived';
    if(sql.startsWith("UPDATE project_scenarios SET status='selected'")){const row=state.project_scenarios.find(x=>x.id===args[1]);if(row)row.status='selected';}
    return {success:true};
  }};}};return DB;
}
async function call(DB,body,userId=1,extra={}){
  const env={DB,SESSION_SECRET:'ops-test',INVESTMENT_CALCULATOR:{calculate:({snapshot})=>{assert.equal(snapshot.params.rent,40);return result();}},...extra},token=await signToken(env,userId,'tester'),request=new Request('http://test/api/investmentops?projectId=project-ops',{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:body?JSON.stringify({projectId:'project-ops',...body}):undefined});
  const response=await(body?onRequestPost:onRequestGet)({request,env});return {status:response.status,data:await response.json()};
}
test('会议多标签、空选拒绝、并发重复确认幂等、共享owner空间',async()=>{
  const DB=db(),created=await call(DB,{action:'extractMeeting',content:'会议决定由投资部牵头完成融资风险复核'},2);assert.equal(created.status,200);
  for(const selected of [{},{selectedIds:[]},{confirmAll:true,selectedIds:[]}])assert.equal((await call(DB,{action:'confirmMeeting',meetingId:created.data.id,...selected},2)).status,400);
  const results=await Promise.all([1,2].map(()=>call(DB,{action:'confirmMeeting',meetingId:created.data.id,confirmAll:true},2)));assert.ok(results.every(x=>x.status===200));
  for(const table of ['project_tasks','project_risks','project_decisions']){assert.equal(DB.state[table].length,1);assert.equal(DB.state[table][0].user_id,1);}
  assert.equal(results[1].data.reusedCount,3);assert.equal(DB.state.project_decisions[0].status,'candidate');assert.equal((await call(DB,null,1)).data.ops.meetings.length,0);
});
test('事务失败不留任务、确认标志或成功审计',async()=>{
  const DB=db(),meeting=await call(DB,{action:'extractMeeting',content:'会议决定由投资部牵头完成风险复核'});DB.failSql='INSERT INTO project_risks';
  assert.equal((await call(DB,{action:'confirmMeeting',meetingId:meeting.data.id,confirmAll:true})).status,500);assert.equal(DB.state.project_tasks.length,0);assert.equal(DB.state.project_meetings[0].status,'candidate');assert.equal(DB.state.project_events.filter(x=>x.event_type==='meeting.confirmed').length,0);
});
test('服务端明确快照、拒绝客户端伪白箱及过期参数/配置',async()=>{
  const DB=db();for(const scenario of [{metrics:{irr:99}},{params:{rent:99}},{engine:'whitebox'},{status:'selected'}])assert.equal((await call(DB,{action:'saveScenario',scenario})).status,400);
  assert.equal((await call(DB,{action:'saveScenario',calcSnapshotId:'missing'})).status,409);assert.equal((await call(DB,{action:'saveScenario'},1,{INVESTMENT_CALCULATOR:null})).status,503);
  const saved=await call(DB,{action:'saveScenario',scenario:{kind:'baseline'}});assert.equal(saved.status,200,JSON.stringify(saved.data));assert.equal(saved.data.scenario.verification.sourceVersion,1);assert.equal(saved.data.scenario.metrics.irr,5);
  const data=JSON.parse(DB.state.projects[0].data);data.workflow.calcSnapshots[0].summary.irr=999;DB.state.projects[0].data=JSON.stringify(data);assert.equal((await call(DB,{action:'saveScenario'})).status,409);
});
test('只读/撤销成员拒绝、个人草稿隔离、仅owner显式采纳',async()=>{
  const DB=db(),saved=await call(DB,{action:'saveScenario'});assert.equal((await call(DB,{action:'saveScenario'},3)).status,403);assert.equal((await call(DB,{action:'selectScenario',scenarioId:saved.data.id},2)).status,403);
  assert.equal((await call(DB,null,2)).data.ops.scenarios.length,0);assert.equal((await call(DB,{action:'selectScenario',scenarioId:saved.data.id})).status,200);
  assert.equal((await call(DB,null,2)).data.ops.adoptedScenarioId,saved.data.id);DB.state.project_memberships[0].status='removed';assert.equal((await call(DB,null,2)).status,404);
});
test('真实证据ID/当前独立复核/明确方案缺一不可，客户端通过无效',async()=>{
  const DB=db(),saved=await call(DB,{action:'saveScenario'}),body={action:'createDecisionPackage',scenarioId:saved.data.id,evidenceIds:['evidence-1'],consistencyIssues:[]};
  assert.equal((await call(DB,{...body,evidenceIds:['fake']})).status,404);assert.equal((await call(DB,body)).data.package.status,'blocked');await call(DB,{action:'selectScenario',scenarioId:saved.data.id});
  DB.state.report_deliveries.push({id:'delivery-1',project_id:'project-ops',status:'approved',author_id:1,reviewer_id:3,content_hash:await reportEvidenceHash(deliverySnapshot(JSON.parse(DB.state.projects[0].data))),result_json:'{"passed":true}',note:'{"wordLayoutReviewed":true,"factsReviewed":true}'});
  assert.equal((await call(DB,body)).data.package.status,'ready');DB.state.project_artifacts[0].project_id='other-project';assert.equal((await call(DB,body)).status,404);
});
test('旧自报通过保存为非权威记录，旧passed不计生产通过',async()=>{
  const DB=db(),saved=await call(DB,{action:'saveEvaluation',type:'golden_project',status:'passed',result:{numericErrors:0,passed:true,serverVerified:true}});assert.equal(saved.data.status,'recorded');assert.equal(saved.data.productionEligible,false);assert.equal(saved.data.migrationRequired,true);
  DB.state.project_evaluations[0].status='passed';const listed=await call(DB,null);assert.equal(listed.data.ops.production.passed,false);assert.equal(listed.data.ops.evaluations[0].status,'recorded');
});
