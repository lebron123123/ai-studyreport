// Read-only service checks plus one ordinary AI response; never print credentials.
import pg from '../local-server/node_modules/pg/lib/index.js';
import {signToken} from '../functions/api/_auth.js';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {rentalPriced} from '../project-map/rental-identity.mjs';
const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
try{
 const u=(await db.query('SELECT id,username FROM users WHERE username=$1',[process.argv[2]])).rows[0];assert.ok(u,'Existing acceptance account required');
 const headers={authorization:'Bearer '+await signToken(process.env,u.id,u.username),'content-type':'application/json'};
 async function call(path,body){const response=await fetch('http://localhost:8080'+path,{headers,method:body?'POST':'GET',body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(120000)});assert.equal(response.status,200,path);return response.json();}
 const site=await fetch('http://localhost:8080/');assert.equal(site.status,200);console.log('site PASS');
 await call('/api/projects');console.log('projects PASS');
 await call('/api/rag',{action:'query',query:'保障性租赁住房',topK:1});console.log('RAG query PASS');
 if(process.argv.includes('--surrounding')){
  const report=JSON.parse(await readFile(new URL('../outputs/rental-surrounding-recovery-20260919.json',import.meta.url),'utf8'));
  for(const project of report.projects){
   const result=await call('/api/maprentals',{action:'list',point:project.point,radius:project.radius,kind:'住宅',market:'sale'});
   const expected=new Set(project.observations.filter(r=>r.market==='sale'&&rentalPriced(r)).map(r=>r.community));
   const actual=new Set((result.items||[]).filter(r=>rentalPriced(r)).map(r=>r.community));
   for(const name of expected)assert.ok(actual.has(name),project.name+' surrounding price missing: '+name);
   console.log(project.name+' surrounding readback PASS '+expected.size);
  }
 }
 const report=JSON.parse(await readFile(new URL('../outputs/rental-ten-20260918.json',import.meta.url),'utf8'));
 for(const sample of report.samples){
  for(const market of ['rent','sale']){
   const expected=sample.markets[market]?.rows||[];if(!expected.length)continue;
   const result=await call('/api/maprentals',{action:'list',point:sample.community.point,radius:2000,kind:'住宅',market});
   const rows=(result.items||[]).filter(r=>r.community===sample.community.name&&rentalPriced(r));
   assert.ok(rows.length,sample.community.name+' '+market+' persisted prices');
   console.log(sample.community.name+' '+market+' readback PASS '+rows.length);
  }
 }
 const response=await call('/api/generate',{system:'只输出一行中文',messages:[{role:'user',content:'请回复服务测试通过'}],max_tokens:100});
 const text=(response.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('');assert.ok(text.trim());console.log('real generation PASS, chars='+text.length);
}finally{await db.end();}
