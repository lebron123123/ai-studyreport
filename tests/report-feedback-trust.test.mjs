import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequestPost,onRequestGet} from '../functions/api/reportorchestration.js';
import {signToken} from '../functions/api/_auth.js';
test('前端伪造通过、项目和holdout不能写入评测',async()=>{
  const writes=[],env={SESSION_SECRET:crypto.randomUUID(),DB:{prepare(sql){return {bind(){return this;},async first(){return null;},async run(){writes.push(sql);return {meta:{changes:1}};}};}}};
  const token=await signToken(env,7,'reviewer');
  const response=await onRequestPost({env,request:new Request('http://test/api/reportorchestration',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({action:'feedbackEvaluate',candidateId:'c',evaluation:{passed:true,projectId:'fake',datasetRole:'holdout',score:100}})})});
  assert.equal(response.status,409);assert.equal((await response.json()).code,'TRUSTED_EVALUATION_REQUIRED');assert.equal(writes.filter(x=>/INSERT INTO report_feedback_evaluations/i.test(x)).length,0);
});
test('历史客户端评测保留计数，但不再支撑跨项目准入',async()=>{
  const env={SESSION_SECRET:crypto.randomUUID(),DB:{prepare(sql){return {bind(){return this;},async run(){return {meta:{changes:0}};},async first(){return {id:'c',scope:'project_only',version:1,status:'evaluating',candidate_json:JSON.stringify({projectId:'p',scenario:'housing',evaluations:[{passed:true}]})};},async all(){return {results:[{passed:1,project_id:'fake',dataset_role:'holdout',metrics_json:'{"score":100}'}]};}};}}};
  const token=await signToken(env,7,'reviewer'),r=await onRequestGet({env,request:new Request('http://test/api/reportorchestration?type=feedback&id=c',{headers:{authorization:'Bearer '+token}})}),body=await r.json();
  assert.equal(body.item.legacyEvaluationCount,1);assert.deepEqual(body.item.evaluations,[]);assert.equal(body.item.evaluationStatus,'trusted_runner_required');
});
