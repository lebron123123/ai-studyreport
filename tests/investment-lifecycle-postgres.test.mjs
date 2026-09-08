import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createD1Shim} from '../local-server/d1-shim.js';
import {createInvestmentCalculator} from '../local-server/investment-calculator.js';
import {onRequestGet,onRequestPost} from '../functions/api/investmentops.js';
import {signToken} from '../functions/api/_auth.js';
import {changeProjectMember} from '../functions/api/_project-members.js';
import {testDatabaseUrl} from '../scripts/require-test-database.mjs';
const target=testDatabaseUrl();
test('隔离PostgreSQL：预测冻结、申请框架、实际值版本与授权汇总',{skip:!target},async t=>{
  const DB=createD1Shim(target),calculator=createInvestmentCalculator(),env={DB,SESSION_SECRET:crypto.randomUUID(),INVESTMENT_CALCULATOR:calculator},projectId=crypto.randomUUID(),otherProjectId=crypto.randomUUID();
  try{
    async function user(){const username='[系统测试]lifecycle-'+crypto.randomUUID();await DB.prepare('INSERT INTO users(username,pass_hash,salt,created_at) VALUES(?,?,?,?)').bind(username,'disabled','test',Date.now()).run();return Number((await DB.prepare('SELECT id FROM users WHERE username=?').bind(username).first()).id);}
    const owner=await user(),editor=await user(),viewer=await user(),outsider=await user();
    const source=readFileSync(new URL('./calc-engines.test.js',import.meta.url),'utf8'),match=source.match(/const GAIBAO_DEFAULT_PARAMS = (\{[\s\S]*?\n\});/),params=JSON.parse(JSON.stringify(vm.runInNewContext('('+match[1]+')'))),snapshot={id:'lifecycle-snapshot-1',version:1,calcType:'gaibao',params};snapshot.summary=calculator.calculate({snapshot}).summary;
    const data={project:{type:'gaibao'},chapters:[],workflow:{currentCalcSnapshotId:snapshot.id,calcSnapshots:[snapshot]}};
    await DB.prepare('INSERT INTO projects(id,user_id,name,data,updated_at) VALUES(?,?,?,?,?)').bind(projectId,owner,'[系统测试]投资周期',JSON.stringify(data),Date.now()).run();
    await DB.prepare('INSERT INTO projects(id,user_id,name,data,updated_at) VALUES(?,?,?,?,?)').bind(otherProjectId,outsider,'[系统测试]其他项目','{}',Date.now()).run();
    await changeProjectMember(env,owner,projectId,editor,'EDITOR');await changeProjectMember(env,owner,projectId,viewer,'VIEWER');
    const evidenceId=crypto.randomUUID();await DB.prepare("INSERT INTO project_facts(id,project_id,user_id,fact_type,fact_key,value_json,status,created_at,updated_at) VALUES(?,?,?,'operations','actual.source','1','confirmed',?,?)").bind(evidenceId,projectId,owner,Date.now(),Date.now()).run();
    async function call(body,actor=owner,query='',extra={}){const request=new Request('http://test/api/investmentops?projectId='+projectId+query,{method:body?'POST':'GET',headers:{authorization:'Bearer '+await signToken(env,actor,'[系统测试]'),'content-type':'application/json'},body:body?JSON.stringify({projectId,...body}):undefined}),response=await(body?onRequestPost:onRequestGet)({env:{...env,...extra},request});return {status:response.status,data:await response.json()};}
    let scenarioId,versionId,secondVersion,annual,actualId;
    await t.test('旧数据不升级批准，明确采纳后冻结幂等，客户端内容不能覆盖',async()=>{
      const empty=await call(null,viewer,'&view=lifecycle');assert.equal(empty.status,200,JSON.stringify(empty.data));assert.equal(empty.data.lifecycle.approvedBaseline,null);assert.equal(empty.data.lifecycle.versions.length,0);
      const saved=await call({action:'saveScenario'});assert.equal(saved.status,200,JSON.stringify(saved.data));scenarioId=saved.data.id;
      const body={action:'freezeForecast',scenarioId,requestKey:crypto.randomUUID(),name:'原始预测'};assert.equal((await call(body)).status,409);await call({action:'selectScenario',scenarioId});assert.equal((await call(body,editor)).status,403);assert.equal((await call({...body,metrics:{irr:99}})).status,400);
      const both=await Promise.all([call(body),call(body)]);assert.ok(both.every(x=>x.status===200),JSON.stringify(both));assert.equal(both[0].data.id,both[1].data.id);versionId=both[0].data.id;assert.equal(both[0].data.formalApproval,false);
      const model=(await call(null,viewer,'&view=lifecycle')).data.lifecycle;assert.equal(model.versions.length,1);annual=model.versions[0].payload.annualValues.find(x=>x.value>0);assert.ok(annual);assert.equal(model.versions[0].payload.parameters.rent,params.rent);
    });
    await t.test('改参数生成新预测；原版本不变，差异不冒充批准调整',async()=>{
      const old=(await DB.prepare('SELECT payload_json FROM investment_versions WHERE id=?').bind(versionId).first()).payload_json;
      const next=structuredClone(snapshot);next.id='lifecycle-snapshot-2';next.version=2;next.params.rent+=5;next.summary=calculator.calculate({snapshot:next}).summary;data.workflow.calcSnapshots.push(next);data.workflow.currentCalcSnapshotId=next.id;await DB.prepare('UPDATE projects SET data=? WHERE id=?').bind(JSON.stringify(data),projectId).run();
      const saved=await call({action:'saveScenario'});assert.equal(saved.status,200,JSON.stringify(saved.data));await call({action:'selectScenario',scenarioId:saved.data.id});const frozen=await call({action:'freezeForecast',scenarioId:saved.data.id,requestKey:crypto.randomUUID()});assert.equal(frozen.status,200,JSON.stringify(frozen.data));secondVersion=frozen.data.id;
      const preview=await call({action:'previewChange',baselineVersionId:versionId,versionId:secondVersion});assert.equal(preview.status,200);assert.deepEqual(preview.data.preview.parameters.map(x=>x.path),['rent']);assert.ok(preview.data.preview.annual.some(x=>x.delta>0));assert.equal(preview.data.preview.formalApproval,false);assert.equal((await DB.prepare('SELECT payload_json FROM investment_versions WHERE id=?').bind(versionId).first()).payload_json,old);
      const request={action:'requestInvestmentApproval',versionId:secondVersion,requestKey:crypto.randomUUID(),reason:'[系统测试]原基准审议申请'};assert.equal((await call({...request,status:'approved'},editor)).status,409);assert.equal((await call({...request,requestType:'adjustment',baselineVersionId:versionId},editor)).status,409);const requested=await call(request,editor);assert.equal(requested.status,200,JSON.stringify(requested.data));assert.equal(requested.data.status,'requested');assert.equal((await call(request,editor)).data.reused,true);assert.equal((await call(null,viewer,'&view=lifecycle')).data.lifecycle.approvedBaseline,null);
    });
    await t.test('真实来源、有限数、角色校验；重复录入返回同一实际值',async()=>{
      const actual={...annual,value:annual.value-10,sourceEvidenceId:evidenceId,sourceRef:'[系统测试]年度已核实账单',confirmed:true,expectedVersion:0,requestKey:crypto.randomUUID()},body={action:'recordActual',actual};
      assert.equal((await call(body,viewer)).status,403);assert.equal((await call({...body,actual:{...actual,value:null}},editor)).status,400);assert.equal((await call({...body,actual:{...actual,sourceEvidenceId:'missing'}},editor)).status,404);
      const saved=await call(body,editor);assert.equal(saved.status,200,JSON.stringify(saved.data));actualId=saved.data.id;assert.equal(saved.data.version,1);assert.equal((await call(body,editor)).data.id,actualId);assert.equal((await call({...body,actual:{...actual,value:10}},editor)).status,409);
      const model=(await call(null,viewer,'&view=lifecycle')).data.lifecycle;assert.equal(model.actuals.length,1);assert.equal(model.variance[0].comparable,true);assert.equal(model.variance[0].attribution.quantity,null);assert.equal(model.actuals[0].confirmation,'actor_confirmed_not_independently_audited');
    });
    await t.test('并发修正采用CAS，旧版本留存；失败事务不留实际值或审计',async()=>{
      const actual={...annual,value:123,sourceEvidenceId:evidenceId,sourceRef:'[系统测试]年度修正',confirmed:true,expectedVersion:1};const both=await Promise.all([1,2].map(i=>call({action:'recordActual',actual:{...actual,value:123+i,requestKey:crypto.randomUUID()}},editor)));assert.deepEqual(both.map(x=>x.status).sort(),[200,409]);const model=(await call(null,viewer,'&view=lifecycle')).data.lifecycle;assert.equal(model.actuals.length,2);assert.equal(model.variance.length,1);assert.equal(model.variance[0].supersedesId,actualId);
      const broken={...DB,_transaction:fn=>DB._transaction(tx=>fn({...tx,prepare(sql){const stmt=tx.prepare(sql);if(!sql.startsWith('INSERT INTO project_events'))return stmt;return {bind(){return this;},run(){throw Error('injected audit failure');}};}}))};const failed=await call({action:'recordActual',actual:{...actual,expectedVersion:2,requestKey:crypto.randomUUID()}},editor,'',{DB:broken});assert.equal(failed.status,500);assert.equal(Number((await DB.prepare('SELECT COUNT(*) AS n FROM investment_actual_values WHERE project_id=?').bind(projectId).first()).n),2);
    });
    await t.test('组合汇总逐项目授权且不跨口径合并；撤权立即阻断',async()=>{
      const response=await call(null,viewer,'&view=lifecyclePortfolio&projectIds='+projectId);assert.equal(response.status,200,JSON.stringify(response.data));assert.equal(response.data.portfolio.groups.length,1);assert.ok(response.data.portfolio.excludedMetrics.includes('irr'));
      assert.equal((await call(null,viewer,'&view=lifecyclePortfolio&projectIds='+projectId+','+otherProjectId)).status,404);await changeProjectMember(env,owner,projectId,viewer,'VIEWER',true);assert.equal((await call(null,viewer,'&view=lifecycle')).status,404);assert.equal((await call(null,viewer,'&view=lifecyclePortfolio&projectIds='+projectId)).status,404);
    });
  }finally{await DB._close();}
});
