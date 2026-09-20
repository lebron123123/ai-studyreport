import test from 'node:test';
import assert from 'node:assert/strict';
import {createD1Shim} from '../local-server/d1-shim.js';
import {testDatabaseUrl} from '../scripts/require-test-database.mjs';
import {rentalService,rentalPendingOrder,rentalTaskErrors} from '../functions/api/_rental-service.js';
test('空结果保留补查，不误记成功；有效候选和非竞品跳过分别处理',()=>{
 assert.match(rentalTaskErrors({rows:[],errors:[]},'crawler')[0],/需补查/);
 assert.match(rentalTaskErrors({rows:[],errors:[]},'search')[0],/需补查/);
 assert.deepEqual(rentalTaskErrors({rows:[],errors:[],hits:[{url:'https://example.com'}]},'search'),[]);
 assert.deepEqual(rentalTaskErrors({rows:[],errors:[],skipped:'非住宅'},'crawler'),[]);
 assert.deepEqual(rentalTaskErrors({rows:[{}],errors:[]},'crawler'),[]);
 assert.deepEqual(rentalTaskErrors({rows:[],errors:['连接超时']},'crawler'),['连接超时']);
});
test('续查优先未尝试竞品，不被前几个失败项长期占满预算',()=>{
 const communities=['失败','完成','未尝试','待取证'].map(name=>({name}));
 const states={search:{tasks:{失败:{state:'failed'},完成:{state:'completed'},待取证:{state:'completed'}}},crawler:{tasks:{失败:{state:'failed'},完成:{state:'completed'}}}};
 assert.deepEqual(rentalPendingOrder(communities,states).map(c=>c.name),['未尝试','待取证','失败','完成']);
 assert.equal(communities[0].name,'失败');
});
test('租金任务：持久化、双通道隔离、缓存复用和只重试失败任务',{skip:!testDatabaseUrl()},async()=>{
 const DB=createD1Shim(testDatabaseUrl()),env={DB},query={point:[114.4,22.7],radius:2000,kind:'住宅'};let pending,calls=[];
 const community={name:'[系统测试]双通道',point:query.point,kind:query.kind,district:'福田区',street:''};
 const dependencies={discover:async()=>[community],collect:async(e,c,channel)=>{calls.push(channel);if(channel==='crawler')throw Error('站点要求验证');return {rows:[{...c,community:c.name,url:'https://example.com/'+crypto.randomUUID(),observedAt:Date.now(),status:'candidate',monthlyRent:3000,area:30}],errors:[],sources:[{site:'链家',state:'matched'},{site:'房天下',state:'empty'}]};}};
 try{
 const first=await rentalService(env,{...query,action:'collect'},p=>pending=p,dependencies);assert.equal(first.run.state,'running');await pending;
 let next=await rentalService(env,{...query,action:'list'},()=>{},dependencies);assert.equal(next.run.state,'failed');assert.equal(next.items.length,1);assert.equal(next.run.channels.search.state,'completed');assert.equal(next.run.channels.crawler.state,'failed');
 assert.equal(next.run.channels.search.tasks[community.name].sources[0].site,'链家');
 await rentalService(env,{...query,action:'collect'},()=>{},dependencies);assert.equal(calls.length,2);
 await DB.prepare('UPDATE map_rental_runs SET updated_at=? WHERE id=?').bind(Date.now()-61000,first.run.id).run();
 await rentalService(env,{...query,action:'retry'},p=>pending=p,{...dependencies,collect:async(e,c,channel)=>{calls.push(channel);return {rows:[],errors:[],skipped:'测试跳过：不再属于同类物业'};}});await pending;
 assert.deepEqual(calls,['search','crawler','crawler']);
 next=await rentalService(env,{...query,action:'list'},()=>{},dependencies);assert.equal(next.run.state,'completed');assert.equal(next.items.length,1);
 assert.equal(Number((await DB.prepare('SELECT COUNT(*) AS n FROM map_rental_slots WHERE lease_until>0').first()).n),0);
 await rentalService(env,{...query,point:[114.4001,22.7],action:'collect'},p=>pending=p,dependencies);await pending;
 assert.deepEqual(calls,['search','crawler','crawler'],'相邻范围复用已完成物业，不重复外网采集');
 const saved=await DB.prepare('SELECT data FROM map_rental_runs WHERE id=?').bind(first.run.id).first();const legacy=JSON.parse(saved.data);delete legacy.strategyVersion;
 await DB.prepare('UPDATE map_rental_runs SET data=? WHERE id=?').bind(JSON.stringify(legacy),first.run.id).run();
 let discovered=0;await rentalService(env,{...query,action:'collect'},p=>pending=p,{...dependencies,discover:async()=>{discovered++;return [{...community,name:'[系统测试]新版竞品'}];}});await pending;
 assert.equal(discovered,1,'旧策略结果不能阻止新住宅筛选与多站查询');
 next=await rentalService(env,{...query,action:'list'},()=>{},dependencies);assert.equal(next.items.length,2,'旧有效样本仍保留');
 const order=[];
 await rentalService(env,{...query,point:[114.5,22.7],action:'collect'},p=>pending=p,{discover:async()=>['甲','乙'].map(name=>({...community,name:'[系统测试]顺序'+name})),collect:async(e,c,channel)=>{order.push(c.name+':'+channel);return {rows:[],errors:[]};}});await pending;
 assert.deepEqual(order,['[系统测试]顺序甲:search','[系统测试]顺序甲:crawler','[系统测试]顺序乙:search','[系统测试]顺序乙:crawler'],'先完成当前竞品取证，不能让全范围搜索耗尽爬虫预算');
 }finally{await DB._close();}
});
