import test from 'node:test';
import assert from 'node:assert/strict';
import {createD1Shim} from '../local-server/d1-shim.js';
import {testDatabaseUrl} from '../scripts/require-test-database.mjs';
import {onRequestGet,onRequestPost} from '../functions/api/projectportfolio.js';
import {signToken} from '../functions/api/_auth.js';
import {sample} from './portfolio.test.mjs';
test('台账真实数据库：幂等、冲突保护、权限与分页',{skip:!testDatabaseUrl()},async()=>{
 const DB=createD1Shim(testDatabaseUrl()),env={DB,SESSION_SECRET:crypto.randomUUID()};
 try{
 const actors=[];for(let i=0;i<2;i++){const name='[系统测试]台账'+crypto.randomUUID();await DB.prepare('INSERT INTO users(username,pass_hash,salt,created_at) VALUES(?,?,?,?)').bind(name,'disabled','disabled',Date.now()).run();const u=await DB.prepare('SELECT id FROM users WHERE username=?').bind(name).first();actors.push(await signToken(env,Number(u.id),name));}
 const call=async(token,body,offset=0)=>{const r=await (body?onRequestPost:onRequestGet)({env,request:new Request('http://test/api/projectportfolio?offset='+offset,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token},...(body?{body:JSON.stringify(body)}:{})})});return {status:r.status,...await r.json()};};
 assert.equal((await call('',null)).status,401);
 const first=await call(actors[0],{action:'import',project:sample});assert.equal(first.created,true);
 const original=(await call(actors[0],null)).items[0];
 const location={name:sample.name,sourceKey:sample.sourceKey,sourceHash:'d'.repeat(64),sourceFile:'位置.xlsx',address:'深圳市福田区景田西路19号',status:'confirmed',crs:'GCJ02',coordinate:[114.037094,22.554502],evidence:'已人工交叉核对'};
 const update={action:'location',id:first.id,expectedUpdatedAt:original.updated_at,location};
 assert.equal((await call(actors[1],update)).status,403);
 assert.equal((await call(actors[0],{...update,expectedUpdatedAt:0})).status,409);
 assert.equal((await call(actors[0],update)).updated,true);
 assert.equal((await call(actors[0],update)).updated,false);
 const located=(await call(actors[0],null)).items[0];assert.equal(located.confirmed,true);assert.equal(located.portfolio.sourceHash,sample.sourceHash);assert.equal(located.portfolio.records[0].fields[0].value,123);
 assert.equal((await call(actors[0],{...update,location:{...location,address:'改变地址'}})).status,409);
 assert.equal((await call(actors[0],{action:'import',project:sample})).created,false);
 assert.equal((await call(actors[0],{action:'import',project:{...sample,sourceHash:'c'.repeat(64)}})).status,409);
 assert.equal((await call(actors[1],null)).items.length,0);
 for(let i=0;i<100;i++)assert.equal((await call(actors[0],{action:'import',project:{...sample,sourceKey:i.toString(16).padStart(32,'0')}})).created,true);
 const page=await call(actors[0],null);assert.equal(page.items.length,100);assert.equal(page.nextOffset,100);assert.equal((await call(actors[0],null,100)).items.length,1);
 assert.equal(page.items[0].permissions.manage,true);
 }finally{await DB._close();}
});
