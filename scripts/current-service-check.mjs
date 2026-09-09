// Scoped local smoke; temporary non-login account, no user projects modified.
import assert from 'node:assert/strict';
import {createD1Shim} from '../local-server/d1-shim.js';
import {signToken} from '../functions/api/_auth.js';
const database=new URL(process.env.DATABASE_URL);assert.ok(['localhost','127.0.0.1'].includes(database.hostname));
const DB=createD1Shim(database.toString()),username='system_check_'+crypto.randomUUID();let id;
try{
 await DB.prepare('INSERT INTO users(username,pass_hash,salt,created_at) VALUES(?,?,?,?)').bind(username,'not-login','test-only',Date.now()).run();
 id=Number((await DB.prepare('SELECT id FROM users WHERE username=?').bind(username).first()).id);
 const token=await signToken({...process.env,DB},id,username),headers={authorization:'Bearer '+token,'content-type':'application/json'};
 for(const [path,body] of [['/index.html'],['/api/projects'],['/api/rag',{action:'query',query:'保障性租赁住房',topK:1}],['/api/generate',{messages:[{role:'user',content:'[系统测试]仅回复：测试通过'}],max_tokens:64,stream:false}]]){
  const r=await fetch('http://localhost:8080'+path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});const text=await r.text();assert.equal(r.status,200,path+': '+text.slice(0,150));
  if(path==='/api/generate'){const data=JSON.parse(text);assert.ok(data.text||data.content||data.result);}
  console.log(JSON.stringify({path,status:r.status,ok:true}));
 }
}finally{if(id)await DB.prepare('DELETE FROM users WHERE id=? AND username=?').bind(id,username).run();await DB._close();}
