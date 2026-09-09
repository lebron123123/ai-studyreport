import test from 'node:test';
import assert from 'node:assert/strict';
import {createD1Shim} from '../local-server/d1-shim.js';
import {testDatabaseUrl} from '../scripts/require-test-database.mjs';
import {ensureInvestmentTables} from '../functions/api/investmentops.js';
import {ensurePostEvaluation,saveContractCandidate,confirmContractClause} from '../functions/api/_investment-post-evaluation.js';
import {withProjectMutation} from '../functions/api/_lifecycle-integrity.js';
import {mutateObligation,readObligations} from '../functions/api/_investment-obligations.js';
import {resolveProjectAccess} from '../functions/api/_project-access.js';
const target=testDatabaseUrl();
test('协议候选不建义务、确认幂等版本、终止及来源变化不能重新分派',{skip:!target},async()=>{
 const DB=createD1Shim(target),env={DB},projectId=crypto.randomUUID();
 try{
  await ensureInvestmentTables(env);await ensurePostEvaluation(env);await ensurePostEvaluation(env);
  const username='[系统测试]contract-'+crypto.randomUUID();
  await DB.prepare('INSERT INTO users(username,pass_hash,salt,created_at) VALUES(?,?,?,?)').bind(username,'disabled','disabled',Date.now()).run();
  const owner=Number((await DB.prepare('SELECT id FROM users WHERE username=?').bind(username).first()).id),actor={userId:owner};
  await DB.prepare('INSERT INTO projects(id,user_id,name,data,updated_at) VALUES(?,?,?,?,?)').bind(projectId,owner,'[系统测试]协议履责','{}',Date.now()).run();
  const sourceId=crypto.randomUUID(),triggerId=crypto.randomUUID(),quote='协议生效后30天支付首期款';
  for(const [id,content] of [[sourceId,quote],[triggerId,'2026-01-01协议生效']])await DB.prepare("INSERT INTO project_facts(id,project_id,user_id,fact_type,fact_key,value_json,status,source_ref,created_by,created_at,updated_at) VALUES(?,?,?,'operations',?,?,'confirmed','原件第1页','test-reviewer',?,?)").bind(id,projectId,owner,id,JSON.stringify(content),Date.now(),Date.now()).run();
  const call=(fn,b)=>withProjectMutation(env,actor,projectId,'edit',(tx,a)=>fn(tx,actor,a,b));
  const clause={clauseId:'payment-1',title:'首期款',quote,locator:'第1页',obligor:'甲方',condition:'协议生效',conditionStatus:'met',lifecycle:'effective',triggerDate:'2026-01-01',offsetDays:30,triggerEvidenceId:triggerId,triggerLocator:'第1页'};
  const candidate=await call(saveContractCandidate,{contractId:'agreement-1',clause,sourceEvidenceId:sourceId,expectedVersion:0,reason:'提取待核对'});
  assert.equal(Number((await DB.prepare('SELECT COUNT(*) n FROM project_obligations WHERE project_id=?').bind(projectId).first()).n),0);
  await assert.rejects(call(saveContractCandidate,{contractId:'agreement-2',clause:{...clause,quote:'伪造原文'},sourceEvidenceId:sourceId,expectedVersion:0,reason:'候选'}),{status:400});
  const confirmation={id:candidate.id,expectedVersion:1,confirmed:true,assigneeId:owner,reason:'核对原文与触发证据'};
  const formal=await call(confirmContractClause,confirmation);assert.equal(formal.activated,true);
  await assert.rejects(call(confirmContractClause,confirmation),{status:409});
  await call(mutateObligation,{action:'acceptHandoff',id:formal.obligationId,expectedVersion:1});
  const terminated=await call(confirmContractClause,{...confirmation,expectedVersion:2,changeConfirmed:true,clause:{...clause,lifecycle:'terminated'},reason:'终止协议'});
  assert.equal(terminated.obligationId,formal.obligationId);assert.equal(terminated.activated,false);
  await assert.rejects(call(mutateObligation,{action:'assignHandoff',id:formal.obligationId,expectedVersion:3,assigneeId:owner,reason:'试图重新分派'}),{status:409});
  assert.equal((await readObligations(env,actor,await resolveProjectAccess(env,owner,projectId))).items[0].requiresReview,true);
  await call(confirmContractClause,{...confirmation,expectedVersion:3,changeConfirmed:true,clause,reason:'核对后重新生效'});
  await DB.prepare("UPDATE project_facts SET status='rejected' WHERE id=?").bind(triggerId).run();
  await assert.rejects(call(mutateObligation,{action:'acceptHandoff',id:formal.obligationId,expectedVersion:4}),{status:409});
  assert.equal(Number((await DB.prepare('SELECT COUNT(*) n FROM project_obligations WHERE project_id=?').bind(projectId).first()).n),1);
 }finally{await DB._close();}
});
