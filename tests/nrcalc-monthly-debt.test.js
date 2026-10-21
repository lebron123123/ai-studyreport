const test=require('node:test');
const assert=require('node:assert/strict');
global.window=global;require('../nrcalc.js');
const base=require('./fixtures/nrcalc-reference.json').cases[0].params;
function run(p={}){return NRCalc.calc(NRCalc.fromParams({...base,area:10000,deco:100,loanRate:12,buildStartMonth:'2025-01',buildEndMonth:'2025-12',operateStartMonth:'2026-01',operateEndMonth:'2035-12',...p}));}
const close=(a,b,t=.00011)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
test('monthly loan ratios 0/60/80/100; ten repayments and no residual interest',()=>{
 for(const pct of [0,60,80,100]){
  const r=run({firstDecoLoanPct:pct}),m=r.monthlyDebt;
  close(r.summary.totalLoan,pct);close(m[2].interest,55*pct/100*.01);
  close(m[5].repay,pct*.025);close(m[59].repay,pct*.775);
  close(m.reduce((s,x)=>s+x.repay,0),pct);
  m.slice(60).forEach(x=>{close(x.interest,0);close(x.end,0);close(x.borrow,0);});
  for(const y of r.allYears){const rows=m.filter(x=>x.date.startsWith(String(y)));for(const k of ['borrow','repay','interest','engineering'])close(rows.reduce((s,x)=>s+x[k],0),r.loan[y][k],.0013);close(r.loan[y].begin+r.loan[y].borrow-r.loan[y].repay,r.loan[y].end);}
 }
 assert.equal(run().summary.totalLoan,80);
});
test('renovation at month121: remaining 12/15/24 months clamp only late payments',()=>{
 for(const [end,lastPayment]of [['2035-12',6],['2036-03',.9],['2036-12',.9]]){
  const r=run({operateEndMonth:end}),m=r.monthlyDebt;
  close(m[120].engineering,6);close(m.at(-1).engineering,lastPayment);
  close(m.slice(120).reduce((s,x)=>s+x.engineering,0),30);
  close(m.reduce((s,x)=>s+x.engineering,0),r.summary.totalEngCost);
 }
});
test('rate bounds, non-January start, short term disclosure, immutable input',()=>{
 for(const pct of [-1,101,NaN])assert.throws(()=>run({firstDecoLoanPct:pct}));
 const r=run({buildStartMonth:'2025-03',operateEndMonth:'2027-12'});
 assert.equal(r.monthlyDebt[0].date,'2025-03');assert.ok(r.warnings.some(x=>x.includes('测算期不足')));
 const p={...base};const before=JSON.stringify(p);NRCalc.calc(NRCalc.fromParams(p));assert.equal(JSON.stringify(p),before);
});
test('configurable principal percentage interval and final balloon preserve loan reconciliation',()=>{
 const r=run({principalRepayMode:'principal-percent',principalRepayIntervalMonths:3,principalRepayPct:5,principalRepayFinalMonth:30});
 const m=r.monthlyDebt;close(m[2].repay,4);close(m[5].repay,4);close(m[29].repay,44);
 close(m[2].interest,(m[2].begin+m[2].borrow)*.01);
 assert.ok(m[2].interest>(m[2].begin+m[2].borrow-m[2].repay)*.01);
 close(m[3].interest,(m[2].end+m[3].borrow)*.01);
 close(m.reduce((sum,row)=>sum+row.repay,0),80);close(m[30].interest,0);
 assert.ok(r.loan[2026].repay>0);
 for(const patch of [{principalRepayIntervalMonths:0},{principalRepayPct:101},{principalRepayFinalMonth:1.5},{principalRepayMode:'invalid'}])assert.throws(()=>run(patch));
});
test('rent less monthly operating expense repays only positive available surplus and caps at balance',()=>{
 const noSurplus=run({principalRepayMode:'rent-surplus',rent:0,unitCost:800});
 close(noSurplus.monthlyDebt.reduce((sum,row)=>sum+row.repay,0),0);
 assert.ok(noSurplus.warnings.some(x=>x.includes('仍有未归还本金')));
 const highRent=run({principalRepayMode:'rent-surplus',rent:1000,unitCost:0,startup:0});
 close(highRent.monthlyDebt.reduce((sum,row)=>sum+row.repay,0),80);
 assert.ok(highRent.monthlyDebt.find(row=>row.repay>0).date>='2026-01');
 assert.ok(highRent.monthlyDebt.every(row=>row.repay>=0&&row.end>=0));
 const percentCost=run({principalRepayMode:'rent-surplus',operateCostMode:'rent-percent',operateRentPct:100,startup:0});
 close(percentCost.monthlyDebt.reduce((sum,row)=>sum+row.repay,0),0);
});
