import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {validateMonths,buildParameters} from '../calc-experience-model.mjs';
const dates={buildStartMonth:'2027-01',buildEndMonth:'2027-12',operateStartMonth:'2028-01',operateEndMonth:'2039-12'};
test('repayment entry supports six months and custom intervals without changing annual plan',()=>{
 const values={testInterval:'6',testStart:'2028-06',testAmounts:'500；600',testCustom:'5'};
 const sandbox={window:{},document:{getElementById:id=>({value:values[id]})}};vm.createContext(sandbox);vm.runInContext(fs.readFileSync(new URL('../calc.js',import.meta.url),'utf8'),sandbox);
 assert.deepEqual(JSON.parse(JSON.stringify(sandbox.calcReadRepayment('test'))),{intervalMonths:6,firstMonth:'2028-06',amounts:[500,600]});
 values.testInterval='custom';assert.equal(sandbox.calcReadRepayment('test').intervalMonths,5);
 values.testCustom='0';assert.throws(()=>sandbox.calcReadRepayment('test'),/间隔/);
 values.testCustom='1';values.testAmounts='-5';assert.throws(()=>sandbox.calcReadRepayment('test'),/非负/);
});
test('experience dates retain month precision and reject partial/reversed inputs',()=>{
  assert.deepEqual(validateMonths(buildParameters([],dates)),dates);
  assert.deepEqual(validateMonths({}),{});
  assert.throws(()=>validateMonths({buildStartMonth:'2027-01'}),/完整/);
  assert.throws(()=>validateMonths({...dates,buildEndMonth:'2026-12'}),/结束/);
  assert.throws(()=>validateMonths({...dates,operateStartMonth:'2026-12'}),/运营开始/);
  assert.throws(()=>validateMonths({...dates,operateStartMonth:'2028-13'}),/有效/);
});
test('applying experience restores all four months alongside numeric parameters',()=>{
  const sandbox={window:{},console,renderTOC(){},renderSheet(){},setTimeout(){}};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(new URL('../calc.js',import.meta.url),'utf8'),sandbox);
  sandbox.calcApplyExperienceMetrics({projectType:'gaibao',payload:{params:dates}},[{metricKey:'area',value:100,unit:'㎡'}]);
  const result=JSON.parse(vm.runInContext('JSON.stringify(scParams)',sandbox));
  for(const [key,value] of Object.entries(dates))assert.equal(result[key],value);
  assert.equal(result.area,100);
});
test('applying experience retains the rent-percent operating cost mode',()=>{
  const sandbox={window:{},console,renderTOC(){},renderSheet(){},setTimeout(){}};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(new URL('../calc.js',import.meta.url),'utf8'),sandbox);
  sandbox.calcApplyExperienceMetrics({projectType:'gaibao',payload:{params:{...dates,operateCostMode:'rent-percent'}}},[
    {metricKey:'operateRentPct',value:15.7,unit:'%'},{metricKey:'startup',value:0,unit:'万元'}
  ]);
  const result=JSON.parse(vm.runInContext('JSON.stringify(scParams)',sandbox));
  assert.equal(result.operateCostMode,'rent-percent');
  assert.equal(result.operateRentPct,15.7);
  assert.equal(result.startup,0);
});
test('saved result is recalculated when percentage mode has stale per-unit operating cost',()=>{
  const params={...JSON.parse(fs.readFileSync(new URL('./fixtures/nrcalc-reference.json',import.meta.url),'utf8')).cases[0].params,operateCostMode:'rent-percent',operateRentPct:15.7,startup:0};
  const sandbox={console};sandbox.window=sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(new URL('../nrcalc.js',import.meta.url),'utf8'),sandbox);
  vm.runInContext(fs.readFileSync(new URL('../calc.js',import.meta.url),'utf8'),sandbox);
  sandbox.params=params;
  vm.runInContext("calcType='gaibao';scParams=params;scResult=NRCalc.calc(NRCalc.fromParams({...params,operateCostMode:'per-unit'}));calcRefreshLegacyCashflow();",sandbox);
  const result=JSON.parse(vm.runInContext('JSON.stringify(scResult)',sandbox));
  const firstYear=result.allYears.find(year=>result.monthDict[year]>0);
  assert.equal(result.cost[firstYear].op,Number((result.income[firstYear].rent*.157).toFixed(4)));
});
