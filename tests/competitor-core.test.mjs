import test from 'node:test';
import assert from 'node:assert/strict';
import {competitorRows,rentalUnitPrice,rentalExample} from '../project-map/competitor-core.mjs';
test('discovered competitors without rent remain visible, same-place samples combine without invented prices',()=>{
 const p={name:'甲公寓',point:[114,22.6]},q={name:'乙公寓',point:[114.01,22.6]};
 const sample=(price,url,stale=false)=>({community:p.name,point:p.point,monthlyRent:price,area:50,url,stale});
 const rows=competitorRows([['住宅',{run:{competitors:[p,q]},items:[sample(3200,'a'),sample(4500,'b'),sample(3200,'a'),sample(9000,'c',true)]}]]);
 assert.equal(rows.length,2);assert.equal(rows[0].rent,'挂牌 64.0–90.0 元/㎡·月');assert.equal(rows[0].items.length,3);assert.equal(rows[1].rent,'未取得公开报价');
});
test('unit price uses paired area, refuses missing/invalid inputs and never infers rooms',()=>{
 assert.equal(rentalUnitPrice({monthlyRent:4000,area:40}),100);
 for(const area of [null,0,-1,Infinity,'40'])assert.equal(rentalUnitPrice({monthlyRent:4000,area}),null);
 assert.equal(rentalExample({monthlyRent:4000,area:40,title:'一室一厅',leaseType:'合租'}),'40㎡ 一房（合租）：4000元/月');
 assert.equal(rentalExample({monthlyRent:7000,area:70}),'70㎡ 户型未披露：7000元/月');
 const items=[40,50,60,70].map((area,i)=>({community:'甲',point:[114,22],monthlyRent:4000,area,url:String(i)}));
 const [group]=competitorRows([['住宅',{items}]]);assert.equal(group.examples.length,3);assert.equal(group.rent,'挂牌 57.1–100.0 元/㎡·月');
});
test('invalid positions omitted and kinds and locations kept separate',()=>{
 const a={name:'同名',point:[114,22.6]};
 assert.equal(competitorRows([['住宅',{run:{competitors:[a,{name:'坏点',point:[NaN,22]}]}}],['办公',{run:{competitors:[a]}}]]).length,2);
});
