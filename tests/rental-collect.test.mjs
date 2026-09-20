import test from 'node:test';
import assert from 'node:assert/strict';
import {collectRentalCommunity,rentalSearchMatch,rentalCommunities} from '../functions/api/_rental-collect.js';
const community={name:'测试花园',point:[114,22.6],kind:'住宅'};
test('发现结果不再截断成4个竞品',async()=>{
 const original=globalThis.fetch;
 try{globalThis.fetch=async()=>({ok:true,json:async()=>({status:'1',pois:Array.from({length:12},(_,i)=>({name:'花园'+i,location:'114,22.6',adname:'福田区',type:'住宅小区'}))})});
  const rows=await rentalCommunities({AMAP_KEY:'test'},{point:[114,22.6],radius:2000,kind:'住宅'});assert.equal(rows.length,12);
 }finally{globalThis.fetch=original;}
});
test('小区导航为范围内下一竞品提供入口，仍单独取证且不重复搜索',async()=>{
 const first={...community,market:'sale'},second={...first,name:'邻居花园'},searchCache=new Map();let calls=0;
 searchCache.set(JSON.stringify([first.name,first.kind,first.point,'sale']),{results:[{url:'https://www.fang.com/xiaoqu/sz-1/',title:first.name}]});
 const deps={searchCache,communities:[first,second],search:async()=>{calls++;throw Error('不应重复搜索');},crawler:async url=>({url,html:`<div class="infor_xq"><h2>${url.includes('sz-1/')?first.name:second.name}</h2><p>35000元/㎡（08月参考价）</p></div><a href="https://www.fang.com/xiaoqu/sz-2/">邻居花园</a>`})};
 assert.equal((await collectRentalCommunity({},first,'crawler',deps)).rows[0].saleUnitPrice,35000);
 assert.equal((await collectRentalCommunity({},second,'crawler',deps)).rows[0].community,second.name);
 assert.equal(calls,0);
});
test('具名小区主页即使标题没有租字也作为取证入口，不接受其他小区',()=>{
 const hit={url:'https://shenzhen.leyoujia.com/xq/detail/123.html',title:'测试花园小区'};
 assert.equal(rentalSearchMatch(hit,community),true);
 assert.equal(rentalSearchMatch({...hit,title:'另一小区'},community),false);
 assert.equal(rentalSearchMatch({url:'https://sz.esf.fang.com/loupan/2810894728/strategy.htm',title:'测试花园小区攻略'},community),true);
});
test('搜索找路后爬虫复用同一链接，不重复搜索',async()=>{
 const searchCache=new Map();let searches=0,crawls=0;
 const deps={searchCache,search:async()=>{searches++;return {results:[{title:'测试花园出租',url:'https://sz.lianjia.com/zufang/b'}]};},crawler:async()=>{crawls++;return {title:'测试花园出租',text:'整租 3000元/月 30㎡'};}};
 await collectRentalCommunity({},community,'search',deps);
 await collectRentalCommunity({},community,'crawler',deps);
 assert.equal(searches,5);assert.equal(crawls,1);
});
test('搜索失败在同轮传递给取证阶段，不重复消耗搜索额度',async()=>{
 let count=0;const deps={searchCache:new Map(),search:async()=>{count++;throw Error('timeout');}};
 await assert.rejects(collectRentalCommunity({},community,'search',deps),/未取得/);const searched=count;
 await assert.rejects(collectRentalCommunity({},community,'crawler',deps),/未取得/);assert.equal(count,searched);
});
test('无关网页尝试备用搜索，不记为成功空结果',async()=>{
 const calls=[];
 const result=await collectRentalCommunity({},community,'search',{search:async(e,q,o)=>{
  calls.push(o.providers[0]);return {results:calls.length===1?[{title:'深圳旅游',url:'https://example.com/a'}]:[{title:'测试花园整租',snippet:'3000元/月 30㎡',url:'https://sz.lianjia.com/zufang/b'}]};
 }});
 assert.equal(calls.length,6);assert.equal(result.rows.length,1);assert.equal(result.rows[0].monthlyRent,3000);
 await assert.rejects(collectRentalCommunity({},community,'search',{search:async()=>({results:[{title:'深圳旅游',url:'https://example.com'}]})}),/不匹配/);
});
test('链家、房天下、乐有家分别检索并合并，不因首站命中而提前结束',async()=>{
 const queries=[],searchCache=new Map();
 const result=await collectRentalCommunity({},community,'search',{searchCache,search:async(e,q)=>{
  queries.push(q);const domain=q.match(/site:(\S+)/)[1];
  return {results:[{title:'测试花园整租',snippet:'3000元/月 30㎡',url:`https://${domain}/rent/1`}]};
 }});
 assert.equal(queries.length,3);assert.equal(result.rows.length,3);
 assert.deepEqual(new Set(result.sources.map(x=>x.site)),new Set(['链家','房天下','乐有家']));
 assert.equal(searchCache.size,1);
});
test('住宅排除工地及产业园，不消耗搜索请求',async()=>{
 let called=false;const result=await collectRentalCommunity({}, {...community,name:'中建5局工地生活区6栋'},'search',{search:async()=>{called=true;}});
 assert.equal(called,false);assert.equal(result.rows.length,0);assert.match(result.skipped,/非同类/);
});
test('单路失败不阻断备用通道，真实无匹配保持空结果',async()=>{
 let count=0;
 const result=await collectRentalCommunity({},community,'search',{search:async()=>{if(++count===1)throw Error('timeout');return {results:[{title:'测试花园出租',url:'https://sz.lianjia.com/zufang/b'}]};}});
 assert.equal(result.rows.length,1);
 const empty=await collectRentalCommunity({},community,'search',{search:async()=>({results:[]})});
 assert.deepEqual(empty.rows,[]);assert.deepEqual(empty.errors,[]);assert.equal(empty.sources.length,4);assert.ok(empty.sources.every(s=>s.state==='empty'));
});
test('限定站点未命中时一次跨站补查，保留分期并复用结果',async()=>{
 const calls=[],searchCache=new Map(),target={...community,name:'测试花园二期',market:'sale'};
 const search=async(e,q)=>{calls.push(q);return {results:q.includes('site:')?[]:[{url:'https://www.fang.com/xiaoqu/sz-123/',title:'测试花园二期小区'}]};};
 const result=await collectRentalCommunity({},target,'search',{search,searchCache});
 assert.equal(calls.filter(q=>!q.includes('site:')).length,1);
 assert.match(calls.at(-1),/测试花园二期/);assert.equal(result.hits.length,1);
 await collectRentalCommunity({},target,'crawler',{search,searchCache,crawler:async()=>{throw Error('测试不可达');}});
 assert.equal(calls.filter(q=>!q.includes('site:')).length,1);
});
