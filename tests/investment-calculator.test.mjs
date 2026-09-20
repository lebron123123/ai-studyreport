import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createInvestmentCalculator} from '../local-server/investment-calculator.js';

// Reuse the reviewed regression fixtures, not a second set of financial defaults.
const fixtures=readFileSync(new URL('./calc-engines.test.js',import.meta.url),'utf8');
function params(type){const name=type.toUpperCase()+'_DEFAULT_PARAMS',match=fixtures.match(new RegExp('const '+name+' = (\\{[\\s\\S]*?\\n\\});'));assert.ok(match);return JSON.parse(JSON.stringify(vm.runInNewContext('('+match[1]+')')));}
const calculator=createInvestmentCalculator();
test('server canonical calculator reproduces rent and gaibao regression summaries',()=>{
  const rent=calculator.calculate({snapshot:{calcType:'rent',params:params('rent')}});
  assert.equal(rent.summary.totalIncome,24358.56);assert.equal(rent.metrics.irr,.73);assert.equal(rent.metrics.npv,-3487.11);assert.equal(rent.metrics.payback,19.1652);
  assert.notEqual(rent.metricMeta.irr.cashFlow,rent.metricMeta.capitalIrr.cashFlow);assert.equal(rent.metricMeta.irr.unit,'%');assert.equal(rent.metricMeta.npv.unit,'万元');
  const gaibao=calculator.calculate({snapshot:{calcType:'gaibao',params:params('gaibao')}});
  assert.equal(gaibao.metrics.irr,23.11);assert.equal(gaibao.metrics.npv,768.04);assert.equal(gaibao.metrics.payback,8);assert.equal(gaibao.metrics.totalInvestment,undefined);
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
