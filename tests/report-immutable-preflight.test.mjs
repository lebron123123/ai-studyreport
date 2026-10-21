import test from 'node:test';
import assert from 'node:assert/strict';
import {reportImmutablePreflight,reportQualityRepairState} from '../functions/api/reportexecution.js';
const C=globalThis.ReportCompletionContract;
const base={version:C.VERSION,planId:'immutable-test',sectionKey:'章节 / 小节',requirements:{proseTarget:100,proseMax:200,tableMax:1,tableRowsMax:2,tableCharsMax:20,cellCharsMax:10},requiredTables:[],requiredFacts:[]};
test('原表成本超计划不可交给AI返修；原HTML和合同不变',async()=>{
  const html='<table><tr><th>指标</th><th>值</th></tr><tr><td>数值</td><td>0</td></tr><tr><td>数值2</td><td>-1</td></tr></table>';
  const contract=await C.bindFrozenTables(base,html,'source'),before=JSON.stringify(contract);
  const errors=reportImmutablePreflight(contract);assert.deepEqual(errors.map(e=>e.code),['budget-tableRows']);
  assert.ok(errors.every(e=>e.repairable===false&&e.requiresPlanReview===true));
  assert.equal(reportQualityRepairState({}, {status:'blocked',issues:errors}).canRetry,false);
  assert.equal(JSON.stringify(contract),before);assert.equal(contract.frozenTables.tables[0].html,html);
  assert.deepEqual(reportImmutablePreflight({...contract,requirements:{...contract.requirements,tableRowsMax:3}}),[]);
});
test('必要依据超预算及空目录启动前阻断，不把普通缺正文作为无解',async()=>{
  const contract={...base,requirements:{...base.requirements,basis:true,proseTarget:1,proseMax:10}};
  const catalog=await C.bindBasisCatalog(contract,{items:[{title:'必要原始协议资料文件',status:'unlocated',ownerKey:base.sectionKey,required:true}]},'source');
  assert.ok(reportImmutablePreflight(catalog).some(e=>e.code==='basis-catalog-budget'));
  const empty=await C.bindBasisCatalog(contract,{items:[]},'source');
  assert.ok(reportImmutablePreflight(empty).some(e=>e.code==='basis-catalog-empty'));
  assert.deepEqual(reportImmutablePreflight(base),[]);assert.deepEqual(reportImmutablePreflight(null),[]);
});
