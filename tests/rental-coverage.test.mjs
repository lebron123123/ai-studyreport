import test from 'node:test';
import assert from 'node:assert/strict';
import {rentalCoverage} from '../project-map/rental-coverage.mjs';
import {rentalInventory,rentalIsResearchCenter} from '../functions/api/_rental-inventory.js';

test('项目自身别名不计入周边竞品，但不合并其他分期',()=>{
 assert.equal(rentalIsResearchCenter({name:'华越龙苑'},{projectName:'安居华越龙苑'}),true);
 assert.equal(rentalIsResearchCenter({name:'安居·鸣鹿苑北区'},{projectName:'安居鸣鹿苑'}),true);
 assert.equal(rentalIsResearchCenter({name:'曦城二期'},{projectName:'曦城一期'}),false);
});
test('同名异地报价不能填充周边覆盖率，缺定位证据也不算通过',()=>{
 const c={name:'幸福苑',district:'福田区',point:[114,22.6]};
 const row={community:c.name,market:'sale',saleUnitPrice:30000,district:c.district,point:c.point};
 assert.equal(rentalCoverage([c],[row]).direct,1);
 assert.equal(rentalCoverage([c],[{...row,district:'南山区'}]).direct,0);
 assert.equal(rentalCoverage([c],[{...row,point:[113,22.6]}]).direct,0);
 assert.equal(rentalCoverage([c],[{...row,point:undefined}]).direct,0);
});
test('周边固定分母，不以本项目价格或参考价冒充直接覆盖',()=>{
 const communities=Array.from({length:10},(_,i)=>({name:'竞品'+i}));
 const rows=communities.slice(0,8).map(c=>({community:c.name,market:'sale',saleUnitPrice:30000}));
 rows.push({community:'项目自身',market:'sale',saleUnitPrice:50000},{community:'竞品8',market:'sale',saleUnitPrice:31000,referenceKind:'other-phase'});
 const result=rentalCoverage(communities,rows);assert.equal(result.directRate,.8);assert.equal(result.referenceInclusiveRate,.9);assert.equal(result.passed,false);assert.equal(result.missing,1);
 assert.equal(rentalCoverage([],rows).passed,false);
});
test('周边分页完整遍历，不截取最近4个，排除自身并报告截断',async()=>{
 const fetcher=async url=>new Response(JSON.stringify({status:'1',count:26,pois:Array.from({length:Number(url.searchParams.get('page'))===1?25:1},(_,i)=>({id:url.searchParams.get('page')+'-'+i,name:'小区'+url.searchParams.get('page')+'-'+i,location:'114.005,22.597',type:'住宅区'}))}));
 const q={point:[114,22.6],radius:2000,projectName:'小区1-0'};
 const result=await rentalInventory({AMAP_KEY:'test'},q,{fetcher});assert.equal(result.communities.length,25);assert.equal(result.complete,true);assert.equal(result.pages,2);
 assert.equal((await rentalInventory({AMAP_KEY:'test'},q,{fetcher,maxPages:1})).truncated,true);
});
