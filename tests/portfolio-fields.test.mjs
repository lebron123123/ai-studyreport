import test from 'node:test';
import assert from 'node:assert/strict';
import {splitPortfolioFields} from '../project-map/portfolio-fields.mjs';
test('右侧另一项目的独立对照列不能混入项目资料',()=>{
 const fields=[{label:'项目名称',display:'甲'},{label:'投资',display:'100'},{label:'项目名称',display:'乙'},{label:'净现值',display:'20'}];
 const [main,side]=splitPortfolioFields(fields);
 assert.equal(main.length,2);assert.equal(side[0].display,'乙');assert.equal(fields.length,4);
 assert.deepEqual(splitPortfolioFields(main),[main,[]]);
});
