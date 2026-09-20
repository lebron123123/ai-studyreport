import test from 'node:test';
import assert from 'node:assert/strict';
import {collectPhaseReference} from '../functions/api/_rental-reference.js';
import {competitorRows} from '../project-map/competitor-core.mjs';
import {rentalName} from '../project-map/rental-identity.mjs';
test('phase digits normalize, phases and directions remain distinct',()=>{
 assert.equal(rentalName('曦城2期'),rentalName('曦城二期'));
 assert.notEqual(rentalName('曦城一期'),rentalName('曦城二期'));
 assert.notEqual(rentalName('曦城南区'),rentalName('曦城北区'));
});
test('known phase reference preserves source identity; wrong district never fetches',async()=>{
 const c={name:'曦城南区二期',district:'宝安区',kind:'住宅',market:'sale',point:[113.904,22.592]};
 const crawler=async url=>({url,html:'<title>招商华侨城曦城一期小区详情</title>',text:'招商华侨城曦城一期 在售均价 164387 元/㎡'});
 const rows=await collectPhaseReference(c,crawler);
 assert.equal(rows.length,1);assert.equal(rows[0].community,c.name);assert.equal(rows[0].sourceCommunity,'招商华侨城曦城一期');assert.equal(rows[0].referenceKind,'other-phase');
 assert.deepEqual(await collectPhaseReference({...c,district:'龙岗区'},()=>{throw Error('must not fetch');}),[]);
 const result=competitorRows([['售价',{items:rows}]]);assert.match(result[0].rent,/其他分期/);assert.match(result[0].examples[0],/非本项目报价/);
 const mixed=competitorRows([['售价',{items:[...rows,{...rows[0],url:'https://example.com/direct',referenceKind:null,saleUnitPrice:80000}]}]]);
 assert.equal(mixed[0].rent,'参考售价 80000 元/㎡');assert.deepEqual(mixed[0].examples,[]);
});
