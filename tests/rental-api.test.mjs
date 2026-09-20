import test from 'node:test';
import assert from 'node:assert/strict';
import {createD1Shim} from '../local-server/d1-shim.js';
import {testDatabaseUrl} from '../scripts/require-test-database.mjs';
import {signToken} from '../functions/api/_auth.js';
import {onRequestPost} from '../functions/api/maprentals.js';
import {ensureRentalStore,saveRentalObservation} from '../functions/api/_rental-store.js';
test('租金API：拒绝未登录、所有登录者共享公开样本、不接受客户端写入',{skip:!testDatabaseUrl()},async()=>{
 const DB=createD1Shim(testDatabaseUrl()),env={DB,SESSION_SECRET:crypto.randomUUID()},tokens=[];
 try{
 await ensureRentalStore(DB);
 for(let i=0;i<2;i++){const name='[系统测试]租金共享'+crypto.randomUUID();await DB.prepare('INSERT INTO users(username,pass_hash,salt,created_at) VALUES(?,?,?,?)').bind(name,'disabled','disabled',Date.now()).run();const user=await DB.prepare('SELECT id FROM users WHERE username=?').bind(name).first();tokens.push(await signToken(env,Number(user.id),name));}
 const query={action:'list',point:[114.06,22.54],radius:500,kind:'住宅'};
 await saveRentalObservation(DB,{url:'https://example.com/'+crypto.randomUUID(),community:'[系统测试]公开',district:'福田区',street:'',kind:'住宅',point:query.point,observedAt:Date.now(),status:'candidate'});
 const call=async(token,body=query)=>{const response=await onRequestPost({env,request:new Request('http://test/api/maprentals',{method:'POST',headers:{authorization:'Bearer '+token},body:JSON.stringify(body)})});return {status:response.status,data:await response.json()};};
 assert.equal((await call('')).status,401);
 const a=await call(tokens[0]),b=await call(tokens[1]);assert.equal(a.status,200);assert.equal(a.data.items.length,1);assert.deepEqual(a.data.items,b.data.items);
 await saveRentalObservation(DB,{url:'https://example.com/'+crypto.randomUUID(),community:'[系统测试]售价',district:'福田区',street:'',kind:'住宅',market:'sale',saleUnitPrice:45000,point:query.point,observedAt:Date.now(),status:'candidate'});
 const sale=await call(tokens[0],{...query,market:'sale'});assert.equal(sale.status,200);assert.equal(sale.data.items.length,1);assert.equal(sale.data.items[0].saleUnitPrice,45000);assert.equal((await call(tokens[0])).data.items.length,1);
 assert.equal((await call(tokens[0],{...query,market:'invalid'})).status,400);
 assert.equal((await call(tokens[0],{...query,action:'import',items:[{}]})).status,400);
 assert.equal((await call(tokens[0],{...query,point:[0,0]})).status,400);
 }finally{await DB._close();}
});
