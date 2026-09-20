import test from 'node:test';
import assert from 'node:assert/strict';
import {createD1Shim} from '../local-server/d1-shim.js';
import {testDatabaseUrl} from '../scripts/require-test-database.mjs';
import {signToken} from '../functions/api/_auth.js';
import {onRequestGet,onRequestPost} from '../functions/api/calcexperience.js';
const target=testDatabaseUrl();
test('经验库 PostgreSQL：真实事务、并发版本保护、私有隔离与历史回读',{skip:!target},async()=>{
 const db=createD1Shim(target),env={DB:db,SESSION_SECRET:'isolated-experience-test',ADMIN_USERS:'admin'};
 try{
  const owner=await signToken(env,901,'owner'),other=await signToken(env,902,'other');
  async function call(handler,token,body,query=''){
   const response=await handler({env,request:new Request('http://test/api/calcexperience'+query,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:body?JSON.stringify(body):undefined})});
   return {status:response.status,data:await response.json()};
  }
  const input={scope:'private',projectType:'gaibao',projectName:'[系统测试]真实数据库经验库',metrics:[{metricKey:'rampOcc',metricName:'首年出租率',metricValue:100,unit:'比例'}]};
  const created=await call(onRequestPost,owner,input);assert.equal(created.status,200,JSON.stringify(created.data));
  const edit={...input,action:'edit',recordId:created.data.id,revision:1,payload:{params:{rampOcc:.85},calculation:{summary:{totalIncome:123}}},metrics:[{metricKey:'rampOcc',metricName:'首年出租率',metricValue:85,unit:'%'}]};
  const races=await Promise.all([call(onRequestPost,owner,edit),call(onRequestPost,owner,edit)]);
  assert.deepEqual(races.map(x=>x.status).sort(),[200,409]);
  const own=await call(onRequestGet,owner,null,'?scope=private');
  const record=own.data.records.find(x=>x.id===created.data.id);assert.equal(record.revision,2);assert.equal(record.payload.calculation.summary.totalIncome,123);
  assert.equal(own.data.metrics.find(x=>x.recordId===record.id).value,85);
  assert.equal((await call(onRequestGet,other,null,'?scope=private')).data.records.some(x=>x.id===record.id),false);
  assert.equal((await call(onRequestGet,other)).data.records.some(x=>x.id===record.id),false);
  const history=await db.prepare('SELECT snapshot FROM calc_experience_history WHERE record_id=?').bind(record.id).all();assert.equal(history.results.length,1);
  assert.match(history.results[0].snapshot,/100/);
 }finally{await db._close();}
});
