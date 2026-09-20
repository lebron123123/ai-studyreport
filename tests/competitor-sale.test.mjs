import test from 'node:test';
import assert from 'node:assert/strict';
import {rentalObservation,rentalInRange,rentalQuery} from '../project-map/rental-core.mjs';
import {rentalSearchPlan} from '../functions/api/_rental-search-plan.js';
import {competitorRows} from '../project-map/competitor-core.mjs';
const c={name:'测试苑',kind:'住宅',market:'sale',point:[114,22.6]};
test('价格未取得时区分加载、失败和真实无报价，而非统一待核实',()=>{
 for(const [state,label] of [['running','价格查询中'],['failed','查询失败'],['completed','未取得公开报价']]){
  const row=competitorRows([['售价',{run:{state,competitors:[c]},items:[]}]])[0];assert.ok(row.rent.includes(label));
 }
});
test('售价独立解析、查询、显示，不混入租金与旧记录',()=>{
 const hit={url:'https://sz.fang.com/a',title:'测试苑 二手房',snippet:'参考售价 50,000元/㎡'};
 const row=rentalObservation(hit,c,'search');assert.equal(row.saleUnitPrice,50000);assert.equal(row.monthlyRent,null);
 assert.equal(rentalInRange(row,rentalQuery({point:c.point})),false);
 assert.equal(rentalInRange(row,rentalQuery({point:c.point,market:'sale'})),true);
 assert.ok(rentalSearchPlan(c).every(s=>s.query.includes('房价')&&!s.query.includes('租房')));
 assert.match(competitorRows([['售价',{items:[row]}]])[0].rent,/50000 元\/㎡/);
 for(const snippet of ['租金 100元/㎡·月','50000–60000元/㎡','50000元/㎡ 60000元/㎡'])assert.equal(rentalObservation({...hit,snippet},c,'search').saleUnitPrice,null);
});
