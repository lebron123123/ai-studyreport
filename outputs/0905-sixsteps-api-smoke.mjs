import pg from '../local-server/node_modules/pg/lib/index.js';
import {signToken} from '../functions/api/_auth.js';
import assert from 'node:assert/strict';
const c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();
try{
  const projectId='1bb24013-18ce-4819-9588-09fe98e5e0c0';
  const u=(await c.query('SELECT u.id,u.username FROM projects p JOIN users u ON u.id=p.user_id WHERE p.id=$1',[projectId])).rows[0];assert.ok(u);
  const token=await signToken(process.env,u.id,u.username),headers={authorization:'Bearer '+token,'content-type':'application/json'};
  for(const path of ['/api/agentjobs','/api/reportorchestration?projectId='+projectId]){
    const r=await fetch('http://localhost:8080'+path,{headers,signal:AbortSignal.timeout(15000)});assert.equal(r.status,200);console.log(path+': PASS');
  }
  const r=await fetch('http://localhost:8080/api/reportorchestration',{method:'POST',headers,body:JSON.stringify({action:'feedbackEvaluate',passed:true}),signal:AbortSignal.timeout(15000)});
  assert.equal(r.status,409);assert.equal((await r.json()).code,'TRUSTED_EVALUATION_REQUIRED');console.log('untrusted evaluation rejected: PASS');
}finally{await c.end();}
