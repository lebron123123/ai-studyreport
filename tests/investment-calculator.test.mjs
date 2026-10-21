import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createInvestmentCalculator} from '../local-server/investment-calculator.js';

// Reuse the reviewed regression fixtures, not a second set of financial defaults.
const fixtures=readFileSync(new URL('./calc-engines.test.js',import.meta.url),'utf8');
function params(type){const name=type.toUpperCase()+'_DEFAULT_PARAMS',match=fixtures.match(new RegExp('const '+name+' = (\\{[\\s\\S]*?\\n\\});'));assert.ok(match);return JSON.parse(JSON.stringify(vm.runInNewContext('('+match[1]+')')));}
const calculator=createInvestmentCalculator();
test('server canonical monthly model honors editable borrowing percentage and ignores retired plans',()=>{
  for(const pct of [0,60,80,100]){
    const p={...params('gaibao'),firstDecoLoanPct:pct,loanPlan:{1900:1},repayPlan:{1900:1}};
    const result=calculator.calculate({snapshot:{calcType:'gaibao',params:p}});
    assert.equal(result.summary.totalLoan,Math.round(p.area*p.deco/10000*pct/100*10000)/10000);
  }
});
test('server canonical calculator reproduces rent and gaibao regression summaries',()=>{
  const rent=calculator.calculate({snapshot:{calcType:'rent',params:params('rent')}});
  assert.equal(rent.summary.totalIncome,24358.56);assert.equal(rent.metrics.irr,.73);assert.equal(rent.metrics.npv,-3487.11);assert.equal(rent.metrics.payback,19.1652);
  assert.notEqual(rent.metricMeta.irr.cashFlow,rent.metricMeta.capitalIrr.cashFlow);assert.equal(rent.metricMeta.irr.unit,'%');assert.equal(rent.metricMeta.npv.unit,'万元');
  const gaibao=calculator.calculate({snapshot:{calcType:'gaibao',params:{...params('gaibao'),debtModel:'legacy-annual'}}});
  assert.equal(gaibao.metrics.irr,31.83);assert.equal(gaibao.metrics.npv,1025.45);assert.equal(gaibao.metrics.payback,6);assert.equal(gaibao.metrics.totalInvestment,undefined);
});
test('sale canonical routing remains deterministic and isolated across configuration runs',()=>{
  const snapshot={calcType:'sale',params:params('sale')},before=structuredClone(snapshot),a=calculator.calculate({snapshot}),b=calculator.calculate({snapshot});
  assert.deepEqual(a,b);assert.deepEqual(snapshot,before);assert.ok(Number.isFinite(a.metrics.totalInvestment));assert.match(a.engineVersion,/^whitebox-sha256:[a-f0-9]{64}$/);
  calculator.calculate({snapshot:{calcType:'rent',params:params('rent')},configuration:{rent:{insuranceRate:.9}}});
  assert.deepEqual(calculator.calculate({snapshot}),a);
});
test('invalid parameters, unsupported currency and unbounded periods fail closed',()=>{
  for(const patch of [{rent:undefined},{area:Infinity},{operateYears:100000},{currency:'USD'}])assert.throws(()=>calculator.calculate({snapshot:{calcType:'rent',params:{...params('rent'),...patch}}}));
  assert.throws(()=>calculator.calculate({snapshot:{calcType:'unknown',params:{}}}));
});
test('server recalculation supports percentage operating expenses without requiring a hidden unit cost',()=>{
  const p={...params('gaibao'),operateCostMode:'rent-percent',operateRentPct:15.7};delete p.unitCost;
  const result=calculator.calculate({snapshot:{calcType:'gaibao',params:p}});
  assert.ok(Number.isFinite(result.metrics.irr));
  assert.ok(Number.isFinite(result.metrics.npv));
  assert.throws(()=>calculator.calculate({snapshot:{calcType:'gaibao',params:{...p,operateRentPct:101}}}),/运营成本/);
});
test('server canonical calculation preserves both principal repayment modes and rejects invalid schedules',()=>{
  const base={...params('gaibao'),debtModel:'monthly-v2',buildStartMonth:'2025-01',buildEndMonth:'2025-12',operateStartMonth:'2026-01',operateEndMonth:'2035-12'};
  const run=patch=>calculator.calculate({snapshot:{calcType:'gaibao',params:{...base,...patch}}});
  const periodic=run({principalRepayMode:'principal-percent',principalRepayIntervalMonths:3,principalRepayPct:5,principalRepayFinalMonth:30});
  const surplus=run({principalRepayMode:'rent-surplus',operateCostMode:'rent-percent',operateRentPct:15.7});
  assert.ok(Number.isFinite(periodic.metrics.irr));assert.ok(Number.isFinite(surplus.metrics.irr));
  assert.notEqual(periodic.metrics.irr,surplus.metrics.irr);
  assert.throws(()=>run({principalRepayMode:'principal-percent',principalRepayIntervalMonths:0}),/还本间隔/);
  assert.throws(()=>run({principalRepayMode:'rent-surplus',operateCostMode:'rent-percent',operateRentPct:101}),/运营成本/);
});
