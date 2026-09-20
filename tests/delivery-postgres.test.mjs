import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRagObjectStore} from '../local-server/rag-object-store.js';
import {onRequestPost as upload,onRequestGet as download} from '../functions/api/projectartifacts.js';
import {createD1Shim} from '../local-server/d1-shim.js';
import {signToken,verifyAuth} from '../functions/api/_auth.js';
import {changeAccountSecurity} from '../functions/api/_account-security.js';
import {changeProjectMember} from '../functions/api/_project-members.js';
import {deliveryAction,listDeliveries} from '../functions/api/_delivery.js';
import {createAgentRun} from '../functions/api/_agent-runtime.js';
import {upsertRunGovernance} from '../functions/api/_agent-enterprise.js';
import {reserveAgentCall,markAgentCallUnknown,reconcileAgentCall} from '../functions/api/_agent-budget.js';
import {testDatabaseUrl} from '../scripts/require-test-database.mjs';
const target=testDatabaseUrl();
test('隔离PostgreSQL：冻结审批、撤销登录、账单幂等',{skip:!target},async t=>{
  const url=new URL(target);assert.match(url.pathname,/^\/studyreport_restore_\d+$/);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));
  const DB=createD1Shim(target),env={DB,SESSION_SECRET:crypto.randomUUID()},pid=crypto.randomUUID();
  try{
    async function newUser(){const name='test'+crypto.randomUUID().replaceAll('-','');await DB.prepare('INSERT INTO users(username,pass_hash,salt,created_at) VALUES(?,?,?,?)').bind(name,'not-a-login-hash','test',Date.now()).run();return Number((await DB.prepare('SELECT id FROM users WHERE username=?').bind(name).first()).id);}
    const owner=await newUser(),reviewer=await newUser(),other=await newUser();
    const data={chapters:[{name:'总论',sections:[{t:'投资',content:'总投资：100万元'}]}]};await DB.prepare('INSERT INTO projects(id,user_id,name,data,updated_at) VALUES(?,?,?,?,?)').bind(pid,owner,'[系统测试]验收隔离',JSON.stringify(data),Date.now()).run();
    assert.equal((await changeProjectMember(env,owner,pid,reviewer,'VIEWER')).ok,true);
    await t.test('旧Project Brain表并存：真实上传、下载及跨账号隔离',async()=>{
      env.RAG_OBJECTS=createRagObjectStore(await mkdtemp(path.join(os.tmpdir(),'delivery-artifact-')));
      const token=await signToken(env,owner,'test'),headers={authorization:'Bearer '+token};
      const response=await upload({env,request:new Request('http://test/api/projectartifacts?projectId='+pid+'&name=test.txt',{method:'POST',headers,body:'[系统测试]原件'})});
      const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));
      const url='http://test/api/projectartifacts?projectId='+pid+'&id='+result.artifact.id;
      const saved=await download({env,request:new Request(url,{headers})});assert.equal(await saved.text(),'[系统测试]原件');
      const denied=await download({env,request:new Request(url,{headers:{authorization:'Bearer '+await signToken(env,other,'test')}})});assert.equal(denied.status,403);
      assert.ok(await DB.prepare("SELECT table_name FROM information_schema.tables WHERE table_name='project_artifacts'").first());
    });
    await t.test('自审、越权、版本变化、重复审批均阻止，刷新保留',async()=>{
      const b={action:'freeze',projectId:pid,reviewerId:reviewer,contract:{expected:[{label:'总投资',value:100,unit:'万元',sourceRef:'test-calculation',version:1}]}};
      await assert.rejects(()=>deliveryAction(env,owner,{...b,reviewerId:owner}),/自审/);
      await assert.rejects(()=>deliveryAction(env,owner,{...b,expectedContentHash:'0'.repeat(64)}),/重新读取版本/);
      const frozen=await deliveryAction(env,owner,b);assert.equal((await deliveryAction(env,owner,b)).id,frozen.id);
      await assert.rejects(()=>listDeliveries(env,other,pid),/权限/);
      const approval={action:'approve',projectId:pid,id:frozen.id,note:'[系统测试]人工确认模拟，不是正式签发',factsReviewed:true,wordLayoutReviewed:true};
      await assert.rejects(()=>deliveryAction(env,owner,approval),/复核人/);
      await assert.rejects(()=>deliveryAction(env,reviewer,{...approval,factsReviewed:false}),/确认Word版式和事实数值/);
      await deliveryAction(env,reviewer,approval);await assert.rejects(()=>deliveryAction(env,reviewer,approval),/不可覆盖/);
      const list=await listDeliveries(env,owner,pid);assert.equal(list.versions[0].status,'approved');assert.equal(list.versions[0].current,true);
      data.chapters[0].sections[0].content='总投资：200万元';await DB.prepare('UPDATE projects SET data=? WHERE id=?').bind(JSON.stringify(data),pid).run();assert.equal((await listDeliveries(env,owner,pid)).versions[0].current,false);
      assert.equal((await listDeliveries(env,reviewer,pid,frozen.id)).snapshot.chapters[0].sections[0].content,'总投资：100万元');
    });
    await t.test('撤销旧令牌、禁用账号、重新启用不恢复旧令牌',async()=>{
      const token=await signToken(env,reviewer,'test'),request=new Request('http://test',{headers:{authorization:'Bearer '+token}});assert.ok(await verifyAuth(request,env));
      await changeAccountSecurity(env,owner,reviewer,'revoke','[系统测试]撤销');assert.equal(await verifyAuth(request,env),null);
      const fresh=await signToken(env,reviewer,'test');assert.ok(await verifyAuth(new Request('http://test',{headers:{authorization:'Bearer '+fresh}}),env));
      await changeAccountSecurity(env,owner,reviewer,'disable','[系统测试]停用');await assert.rejects(()=>signToken(env,reviewer,'test'),/停用/);
      await changeAccountSecurity(env,owner,reviewer,'enable','[系统测试]启用');assert.equal(await verifyAuth(request,env),null);
    });
    await t.test('未知账单并发对账只累计一次，不能覆盖且不能重发',async()=>{
      const {run}=await createAgentRun(env,owner,{query:'[系统测试]对账',projectId:pid,idempotencyKey:crypto.randomUUID()});await upsertRunGovernance(env,owner,run.id,{budgetOutputTokens:1000});
      const call={id:crypto.randomUUID(),userId:owner,runId:run.id,provider:'test',model:'test',messages:[{content:'test'}],maxTokens:100};await reserveAgentCall(env,call);await markAgentCallUnknown(env,call.id);
      const bill={prompt_tokens:5,completion_tokens:7,costMicros:12,evidence:'[系统测试]供应商账单ID12345'};await Promise.all([reconcileAgentCall(env,owner,call.id,bill),reconcileAgentCall(env,owner,call.id,bill)]);
      const g=await DB.prepare('SELECT input_tokens,output_tokens,cost_micros FROM agent_run_governance WHERE run_id=?').bind(run.id).first();assert.deepEqual(g,{input_tokens:5,output_tokens:7,cost_micros:12});
      await assert.rejects(()=>reconcileAgentCall(env,owner,call.id,{...bill,costMicros:13}),/不可覆盖/);await assert.rejects(()=>reserveAgentCall(env,call),/禁止自动/);
    });
  }finally{await DB._close();}
});
