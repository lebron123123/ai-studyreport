import test from 'node:test';
import assert from 'node:assert/strict';
import {createD1Shim} from '../local-server/d1-shim.js';
import {testDatabaseUrl} from '../scripts/require-test-database.mjs';
import {ensureRentalStore,saveRentalObservation,readRentalObservations} from '../functions/api/_rental-store.js';
test('公开租金库：重复初始化、去重、空间过滤、保留历史及待核实排除统计',{skip:!testDatabaseUrl()},async()=>{
 const DB=createD1Shim(testDatabaseUrl());
 try{
 await ensureRentalStore(DB);await ensureRentalStore(DB);
 const now=Date.now(),query={point:[114.05,22.55],radius:1000,kind:'住宅'};
 const row={url:'https://sz.lianjia.com/zufang/'+crypto.randomUUID(),community:'[系统测试]租金',point:query.point,kind:'住宅',district:'福田区',street:'',observedAt:now,monthlyRent:5000,area:50,status:'candidate',leaseType:'整租'};
 const id=await saveRentalObservation(DB,row);assert.equal(await saveRentalObservation(DB,row),id);
 await saveRentalObservation(DB,{...row,observedAt:now-86400000,monthlyRent:4900});
 const result=await readRentalObservations(DB,query);assert.equal(result.items.length,1);assert.equal(result.items[0].monthlyRent,5000);assert.equal(result.statistics.count,0);
 assert.equal((await readRentalObservations(DB,{...query,point:[114.2,22.7]})).items.length,0);
 assert.equal(Number((await DB.prepare('SELECT COUNT(*) AS n FROM map_rental_observations WHERE url=?').bind(row.url).first()).n),2);
 }finally{await DB._close();}
});
