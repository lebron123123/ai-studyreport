const test=require('node:test');
const assert=require('node:assert/strict');
global.window=global;require('../nrcalc.js');
const base=require('./fixtures/nrcalc-reference.json').cases[0].params;
const params={...base,buildStartMonth:'2025-01',buildEndMonth:'2025-12',operateStartMonth:'2026-03',operateEndMonth:'2028-12',occupancyMode:'monthly-phases',rampStartMonth:'2026-03',rampEndMonth:'2027-02',stableStartMonth:'2027-03',rampOcc:.5,stableOcc:1};
test('interval ramp supports monthly, annual and partial final intervals with strict counts',()=>{
 const monthly={...params,operateStartMonth:'2026-10',rampStartMonth:'2026-10',rampEndMonth:'2026-12',stableStartMonth:'2027-01',rampIntervalMonths:1,rampRates:[.6,.8,.95]};
 assert.ok(Math.abs(NRCalc.fromParams(monthly).occupancyRamp[2026]-2.35/3)<1e-12);
 assert.equal(NRCalc.fromParams({...monthly,rampIntervalMonths:'1'}).occupancyPhases.interval,1);
 assert.ok(Math.abs(NRCalc.fromParams({...monthly,rampIntervalMonths:2,rampRates:[.6,.9]}).occupancyRamp[2026]-.7)<1e-12);
 const annual={...params,operateStartMonth:'2026-01',rampStartMonth:'2026-01',rampEndMonth:'2027-12',stableStartMonth:'2028-01',rampIntervalMonths:12,rampRates:[.6,.8]};
 assert.ok(Math.abs(NRCalc.fromParams(annual).occupancyRamp[2027]-.8)<1e-12);
 assert.deepEqual(NRCalc.fromParams(JSON.parse(JSON.stringify(monthly))),NRCalc.fromParams(monthly));
 for(const patch of [{rampRates:[.5]},{rampRates:[.5,1.1,.9]},{rampIntervalMonths:0},{rampIntervalMonths:1.5},{rampRates:[]}])assert.throws(()=>NRCalc.fromParams({...monthly,...patch}));
});
test('monthly phase rates weight only actual operating months; stable continues to end',()=>{
 const p=NRCalc.fromParams(params);assert.equal(p.occupancyRamp[2026],.5);assert.equal(p.occupancyRamp[2027],11/12);assert.equal(p.occupancyRamp[2028],1);
 const r=NRCalc.calc(p);assert.equal(r.income[2026].rent,Math.round(params.area*params.rent*.5*10)/10000);
 assert.deepEqual(NRCalc.calc(NRCalc.fromParams(JSON.parse(JSON.stringify(params)))),r);
});
test('monthly phase boundaries reject gaps, overlap and invalid rates',()=>{
 for(const patch of [{rampStartMonth:'2026-04'},{rampEndMonth:'2026-02'},{stableStartMonth:'2027-04'},{stableStartMonth:'2027-02'},{rampOcc:1.1},{stableOcc:-1},{rampEndMonth:'2029-01'}])assert.throws(()=>NRCalc.fromParams({...params,...patch}));
 for(const rate of [0,1])assert.doesNotThrow(()=>NRCalc.calc(NRCalc.fromParams({...params,rampOcc:rate,stableOcc:rate})));
});
