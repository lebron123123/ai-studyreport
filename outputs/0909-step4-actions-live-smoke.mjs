import assert from 'node:assert/strict';
import {createD1Shim} from '../local-server/d1-shim.js';
import {signToken} from '../functions/api/_auth.js';
const db=createD1Shim(process.env.DATABASE_URL);
try{
 const owner=await db.prepare('SELECT id,username FROM users ORDER BY id LIMIT 1').first();
 const token=await signToken(process.env,owner.id,owner.username),headers={'content-type':'application/json',authorization:'Bearer '+token};
 for(const path of ['/','/api/projects','/api/research?action=list','/api/reportlogic?projectType=gaibao']){
  const r=await fetch('http://localhost:8080'+path,{headers,signal:AbortSignal.timeout(15000)});assert.equal(r.status,200,path);console.log(path+' HTTP 200');
 }
 const r=await fetch('http://localhost:8080/api/generate',{method:'POST',headers,signal:AbortSignal.timeout(55000),body:JSON.stringify({system:'只回复 OK。',messages:[{role:'user',content:'连通性测试'}],stream:false,max_tokens:16})});
 const d=await r.json();assert.equal(r.status,200,d.error);assert.ok(d.content?.some(x=>x.text));console.log('/api/generate HTTP 200; real model text received; no project edited');
}finally{await db._close();}
