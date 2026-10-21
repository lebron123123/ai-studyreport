const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const s={};s.window=s;vm.createContext(s);vm.runInContext(fs.readFileSync('nrcalc.js','utf8'),s);
const N=s.NRCalc;
test('XIRR uses actual days and handles absent signs, negative return, high return',()=>{
 for(const rate of [.1,-.2,1.5])assert.ok(Math.abs(N.xirr([-100,100*(1+rate)],['2025-01-01','2026-01-01'])-rate)<1e-10);
 assert.equal(N.xirr([0,100],['2025-01-01','2026-01-01']),null);
 assert.equal(N.xirr([-100,110],['2025-01-01','2025-01-01']),null);
 assert.ok(Math.abs(N.xirr([-100,110],['2024-01-01','2025-01-01'])-(Math.pow(1.1,365/366)-1))<1e-10);
});
test('monthly cashflow reconciles every annual amount and XIRR residual',()=>{
 const base=require('./fixtures/nrcalc-reference.json').cases[0].params;
 for(const pct of [0,60,80,100]){
 const p={...base,buildStartMonth:'2026-01',buildEndMonth:'2026-09',operateStartMonth:'2026-10',operateEndMonth:'2037-12',firstDecoLoanPct:pct,occupancyMode:'monthly-phases',rampStartMonth:'2026-10',rampEndMonth:'2026-12',stableStartMonth:'2027-01',rampIntervalMonths:1,rampRates:[.6,.8,.95]};
 const r=N.calc(N.fromParams(p));
 for(const y of r.allYears){
  const ms=r.monthlyCashflow.filter(m=>m.date.startsWith(String(y)));
  const sum=k=>ms.reduce((v,m)=>v+m[k],0);
  for(const [key,v] of Object.entries({net:r.cf[y].net,inflow:r.cf[y].inflow,outflow:r.cf[y].outflow,incomeTax:r.profit[y].incomeTax,profit:r.profit[y].totalProfit,engineering:r.loan[y].engineering,interest:r.loan[y].interest,operations:r.cost[y].op,vat:r.tax[y].vat}))assert.ok(Math.abs(sum(key)-v)<1e-7,`${y} ${key}`);
  ms.forEach(m=>{assert.match(m.date,/-01$/);assert.ok(Math.abs(m.inflow-m.outflow-m.net)<1e-7);assert.ok(Math.abs(m.reconciliation)<.002);});
 }
 const rate=r.summary.monthlyXirr/100,t0=Date.parse(r.monthlyCashflow[0].date);
 const residual=r.monthlyCashflow.reduce((sum,m)=>sum+m.net/Math.pow(1+rate,(Date.parse(m.date)-t0)/86400000/365),0);
 assert.ok(Math.abs(residual)<1e-6);
 assert.equal(r.summary.irr,Math.round(r.summary.monthlyXirr*100)/100);
 assert.ok(Number.isFinite(r.summary.annualIrr));
 }
});
test('Excel monthly tax is not reversed by losses in later months',()=>{
 const p={...require('./fixtures/nrcalc-reference.json').cases[0].params,buildStartMonth:'2026-01',buildEndMonth:'2026-09',operateStartMonth:'2026-10',operateEndMonth:'2027-12',occupancyMode:'monthly-phases',rampStartMonth:'2026-10',rampEndMonth:'2026-12',stableStartMonth:'2027-01',rampIntervalMonths:1,rampRates:[1,0,0],rent:500};
 const r=N.calc(N.fromParams(p)),ms=r.monthlyCashflow.filter(m=>m.date.startsWith('2026'));
 assert.ok(ms.find(m=>m.date==='2026-10-01').incomeTax>0);
 assert.equal(ms.find(m=>m.date==='2026-11-01').incomeTax,0);
 assert.ok(ms.every(m=>m.incomeTax>=0));
 assert.ok(Math.abs(ms.reduce((v,m)=>v+m.incomeTax,0)-r.profit[2026].incomeTax)<1e-7);
});
