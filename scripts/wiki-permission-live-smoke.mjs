import assert from 'node:assert/strict';
import {createD1Shim} from '../local-server/d1-shim.js';
import {signToken} from '../functions/api/_auth.js';
const DB=createD1Shim(process.env.DATABASE_URL),name='[系统测试]wiki-live-'+crypto.randomUUID();let userId;
try{
 assert.ok(['localhost','127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname));
 await DB.prepare('INSERT INTO users(username,pass_hash,salt,created_at) VALUES(?,?,?,?)').bind(name,'disabled','disabled',Date.now()).run();
 userId=Number((await DB.prepare('SELECT id FROM users WHERE username=?').bind(name).first()).id);
 const token=await signToken(process.env,userId,name),headers={authorization:'Bearer '+token,'content-type':'application/json'};
 async function call(path,body){
  const response=await fetch('http://localhost:8080'+path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});
  assert.equal(response.status,200,path);return response.json();
 }
 assert.equal((await fetch('http://localhost:8080/admin.html')).status,200);
 for(let i=0;i<2;i++){
  assert.equal((await call('/api/wiki',{action:'publicList'})).ok,true);
  assert.equal((await call('/api/rag',{action:'query',query:'保障性租赁住房',topK:2})).ok,true);
 }
 await call('/api/projects');
 const generated=await call('/api/generate',{system:'只输出测试通过',messages:[{role:'user',content:'请回复测试通过'}],max_tokens:200});
 assert.ok(generated.text||generated.content?.some?.(part=>part.text));
 console.log('PASS: site, repeated Wiki/RAG requests, adjacent projects, real AI generation.');
}finally{
 if(userId){await DB.prepare('DELETE FROM rag_logs WHERE user_id=?').bind(userId).run();await DB.prepare('DELETE FROM users WHERE id=? AND username=?').bind(userId,name).run();}
 await DB._close();console.log('Cleaned exact synthetic account and its retrieval logs.');
}
