import assert from 'node:assert/strict';
import {createD1Shim} from '../local-server/d1-shim.js';
import {signToken} from '../functions/api/_auth.js';
const db=createD1Shim(process.env.DATABASE_URL);
try{
 const owner=await db.prepare('SELECT id,username FROM users ORDER BY id LIMIT 1').first();
 const token=await signToken(process.env,owner.id,owner.username);
 const headers={'content-type':'application/json',authorization:'Bearer '+token};
 for(const path of ['/','/api/research?action=list','/api/outlines']){
  const r=await fetch('http://localhost:8080'+path,{headers,signal:AbortSignal.timeout(20000)});
  assert.equal(r.status,200);await r.text();console.log(path,200);
 }
 const r=await fetch('http://localhost:8080/api/generate',{method:'POST',headers,signal:AbortSignal.timeout(60000),body:JSON.stringify({messages:[{role:'user',content:'连通性测试，请只回复：正常'}],max_tokens:200,stream:false})});
 const d=await r.json();assert.equal(r.status,200);assert.ok(JSON.stringify(d).includes('正常'));console.log('真实生成API返回：正常');
}finally{await db._close();}
