import pg from '../local-server/node_modules/pg/lib/index.js';
import {signToken} from '../functions/api/_auth.js';
import assert from 'node:assert/strict';
const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
try{
 const u=(await db.query('SELECT u.id,u.username FROM projects p JOIN users u ON u.id=p.user_id WHERE p.id=$1',['1bb24013-18ce-4819-9588-09fe98e5e0c0'])).rows[0];
 const headers={authorization:'Bearer '+await signToken(process.env,u.id,u.username),'content-type':'application/json','x-admin-pass':process.env.ADMIN_PASS||''};
 async function call(path,body){const r=await fetch('http://localhost:8080'+path,{headers,method:body?'POST':'GET',body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(90000)});assert.equal(r.status,200,path);return r.json();}
 const review=await call('/api/contributions',{action:'listReview',status:'pending'});assert.ok(review.ok);assert.ok(review.items.every(x=>x.suggestion?.category));console.log('live review suggestions: PASS, count='+review.items.length);
 await call('/api/projects');await call('/api/webresearch',{action:'status'});
 await call('/api/rag',{action:'query',query:'保障性租赁住房政策编制依据',topK:2});
 const missing=await fetch('http://localhost:8080/api/contributions',{method:'POST',headers,body:JSON.stringify({action:'approvePublish',id:'[系统测试]不存在的发布项'}),signal:AbortSignal.timeout(10000)});assert.equal(missing.status,404);
 assert.equal((await fetch('http://localhost:8080/admin.html')).status,200);console.log('site, publication handler, live RAG query: PASS');
 const gen=await call('/api/generate',{system:'只输出测试通过',messages:[{role:'user',content:'请回复测试通过'}],max_tokens:200});assert.ok(gen);console.log('adjacent projects, search status, real AI generation: PASS; no review writes');
}finally{await db.end();}
