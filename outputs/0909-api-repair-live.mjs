import assert from 'node:assert/strict';
import {createD1Shim} from '../local-server/d1-shim.js';
import {signToken} from '../functions/api/_auth.js';
const db=createD1Shim(process.env.DATABASE_URL);
try {
 const owner=await db.prepare('SELECT id,username FROM users ORDER BY id LIMIT 1').first();
 const token=await signToken(process.env,owner.id,owner.username);
 const r=await fetch('http://localhost:8080/api/webresearch',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},signal:AbortSignal.timeout(60000),body:JSON.stringify({action:'search',query:'深圳市 2024 国民经济 社会发展 统计公报',chapter:'[系统测试]接口修复',maxQueries:1,limit:5})});
 const d=await r.json(); console.log(JSON.stringify({status:r.status,ok:d.ok,provider:d.provider,results:d.results?.length,errors:d.errors,titles:d.results?.slice(0,3).map(x=>({title:x.title,url:x.url}))}));
 assert.equal(r.status,200);assert.ok(d.results?.length>0,'实际搜索必须返回网页候选');
 const rr=await fetch('http://localhost:8080/api/rag',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},signal:AbortSignal.timeout(30000),body:JSON.stringify({action:'query',query:'保障性租赁住房',topK:2})});
 const rd=await rr.json();console.log('RAG HTTP '+rr.status+'; ok='+rd.ok);assert.equal(rr.status,200);assert.equal(rd.ok,true);
}finally{await db._close();}
