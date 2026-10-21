// Read-only adjacent APIs and one bounded real generation; no project/config writes.
import pg from '../local-server/node_modules/pg/lib/index.js';
import {signToken} from '../functions/api/_auth.js';
import assert from 'node:assert/strict';
const db=new pg.Client({connectionString:process.env.DATABASE_URL});
await db.connect();
try {
 const user=(await db.query("SELECT id,username FROM users WHERE username LIKE '[系统测试]%' ORDER BY id LIMIT 1")).rows[0];
 assert.ok(user,'No existing isolated system-test account; do not use a formal account');
 const headers={authorization:'Bearer '+await signToken(process.env,user.id,user.username),'content-type':'application/json'};
 async function call(path,body){const r=await fetch('http://localhost:8080'+path,{headers,method:body?'POST':'GET',body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(120000)});assert.equal(r.status,200,path);return r.json();}
 assert.equal((await fetch('http://localhost:8080/')).status,200);console.log('site PASS');
 await call('/api/projects');console.log('projects PASS');
 await call('/api/calcconfig');console.log('calcconfig PASS');
 await call('/api/rag',{action:'query',query:'保障性租赁住房',topK:1});console.log('RAG PASS');
 const result=await call('/api/generate',{system:'只输出一行中文',messages:[{role:'user',content:'请回复服务测试通过'}],max_tokens:100});
 const text=(result.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('');assert.ok(text.trim());console.log('real generation PASS, chars='+text.length);
} finally {await db.end();}
