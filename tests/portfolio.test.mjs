import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePortfolio,portfolioMapItem} from '../project-map/portfolio-core.mjs';
export const sample={name:'[系统测试]台账',category:'completed',sourceKey:'a'.repeat(32),sourceHash:'b'.repeat(64),sourceFile:'test.xlsx',records:[{sheet:'清单',row:3,fields:[{label:'投资万元',value:123,display:'123.00',cell:'M3'}]}]};
test('保留原值、未核实坐标不落点',()=>{const p=validatePortfolio({...sample,point:[114,22.6],locationStatus:'confirmed'});assert.equal(p.point,null);assert.equal(p.records[0].fields[0].value,123);assert.equal(portfolioMapItem('id',p).confirmed,false);});
test('核实位置可展示且拒绝无效分类坐标',()=>{const p=validatePortfolio({...sample,point:[114,22.6],locationStatus:'confirmed',locationEvidence:'人工核对地址',address:'深圳'});assert.deepEqual(portfolioMapItem('id',p).point,[114,22.6]);assert.throws(()=>validatePortfolio({...sample,category:'bad'}));assert.throws(()=>validatePortfolio({...sample,point:[999,22]}));});
