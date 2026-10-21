const test=require('node:test');
const assert=require('node:assert/strict');
global.window=global;require('../nrcalc.js');
const original=require('./fixtures/nrcalc-reference.json').cases[0].params;
const base={...original,mode:'lease',area:1000,rent:50,collect:20,collectRentPct:20,collectReductionPct:30,projectSharePct:60,buildStartMonth:'2025-01',buildEndMonth:'2025-12',operateStartMonth:'2026-05',operateEndMonth:'2027-12',occupancyMode:'monthly-phases',rampStartMonth:'2026-05',rampEndMonth:'2026-06',stableStartMonth:'2026-07',rampIntervalMonths:1,rampRates:[.5,.8],rampOcc:.5,stableOcc:1};
const run=change=>NRCalc.calc(NRCalc.fromParams({...base,...change}));
test('fixed collection is payable for every operating month regardless of occupancy',()=>{
 const result=run({mode:'lease'});
 assert.equal(result.cost[2026].collect,16);
 const monthly=result.monthlyCashflow.filter(m=>m.date.startsWith('2026-'));
 assert.equal(monthly.find(m=>m.date==='2026-05-01').collect,2);
 assert.equal(monthly.find(m=>m.date==='2026-06-01').collect,2);
 assert.equal(monthly.find(m=>m.date==='2026-04-01').collect,0);
});
test('percentage collection follows actual monthly collected rent',()=>{
 const result=run({mode:'rent-percent',collectRentPct:20});
 assert.equal(result.cost[2026].collect,Number((result.income[2026].rent*.2).toFixed(4)));
 assert.ok(Math.abs(result.collectEquivalent[2026].rentRatio-.2)<.00001);
 assert.ok(Math.abs(result.collectEquivalent[2026].fixedPrice-result.cost[2026].collect*10000/(base.area*8))<.00001);
 const may=result.monthlyCashflow.find(m=>m.date==='2026-05-01');
 const june=result.monthlyCashflow.find(m=>m.date==='2026-06-01');
 assert.ok(Math.abs(may.collect-may.inflow*.2)<.0002);
 assert.ok(Math.abs(june.collect-june.inflow*.2)<.0002);
 assert.ok(june.collect>may.collect);
});
test('fixed collection converts to a different actual-rent ratio as occupancy changes',()=>{
 const result=run({mode:'lease',collect:20});
 assert.ok(Math.abs(result.collectEquivalent[2026].fixedPrice-20)<.00001);
 assert.ok(Math.abs(result.collectEquivalent[2027].fixedPrice-20)<.00001);
 assert.notEqual(result.collectEquivalent[2026].rentRatio,result.collectEquivalent[2027].rentRatio);
});
test('reduced fixed rent and 60% retained income start sharing at selected month',()=>{
 const result=run({mode:'share',collectReductionPct:30,projectSharePct:60,shareStartMonth:'2026-07'});
 assert.equal(result.cost[2026].collect,11.2);
 const may=result.monthlyCashflow.find(m=>m.date==='2026-05-01');
 const july=result.monthlyCashflow.find(m=>m.date==='2026-07-01');
 assert.equal(may.share,0);
 assert.ok(Math.abs(july.share-july.inflow*.4)<.0002);
 assert.equal(result.cost[2026].share,Number((result.income[2026].rent-6.5)*.4).toFixed(4)*1);
 assert.throws(()=>NRCalc.fromParams({...base,mode:'share',shareStartMonth:'2028-01'}),/分成起始月/);
});
test('older share parameters still map to the same percentage meaning',()=>{
 const {collectRentPct,collectReductionPct,projectSharePct,...older}=base;
 const p=NRCalc.fromParams({...older,mode:'share',collectPct:70,sharePct:40});
 assert.equal(p.collectFactor,.7);assert.equal(p.shareRatio,.4);
});
test('operating expense percentage uses actual monthly rent and leaves legacy unit mode unchanged',()=>{
 const legacy=run({operateCostMode:undefined});
 const fixed=run({operateCostMode:'per-unit'});
 assert.equal(fixed.cost[2026].op,legacy.cost[2026].op);
 const percent=run({operateCostMode:'rent-percent',operateRentPct:15.7});
 const opMonths=percent.monthlyCashflow.filter(m=>m.date.startsWith('2026-')&&m.date>='2026-05-01');
 assert.equal(percent.cost[2026].op,Number((percent.income[2026].rent*.157+base.startup).toFixed(4)));
 assert.equal(percent.cost[2026].opRecurring,Number((percent.income[2026].rent*.157).toFixed(4)));
 assert.equal(percent.cost[2026].startup,base.startup);
 assert.equal(percent.cost[2027].startup,0);
 assert.ok(Math.abs(percent.cost[2026].op-(percent.cost[2026].opRecurring+percent.cost[2026].startup))<.00011);
 for(const m of opMonths)assert.ok(Math.abs(m.operations-(m.inflow*.157+(m.date==='2026-05-01'?base.startup:0)))<.0002);
 assert.notEqual(percent.summary.monthlyXirr,legacy.summary.monthlyXirr);
 assert.throws(()=>NRCalc.fromParams({...base,operateCostMode:'rent-percent',operateRentPct:101}),/运营成本租金比例/);
});
test('zero startup is the engine default and rent-percent never falls back to unit cost',()=>{
 const params={...base,operateCostMode:'rent-percent',operateRentPct:15.7};
 delete params.startup;
 const result=NRCalc.calc(NRCalc.fromParams(params));
 assert.equal(result.cost[2026].startup,0);
 assert.equal(result.cost[2026].op,Number((result.income[2026].rent*.157).toFixed(4)));
 assert.notEqual(result.cost[2026].op,NRCalc.calc(NRCalc.fromParams({...params,operateCostMode:'per-unit'})).cost[2026].op);
});
