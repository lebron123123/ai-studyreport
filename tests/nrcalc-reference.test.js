const test=require('node:test');
const assert=require('node:assert/strict');
global.window=global;require('../nrcalc.js');
const fixture=require('./fixtures/nrcalc-reference.json');
for(const c of fixture.cases) test('NRCalc pinned Python parity: '+c.name,()=>{
 const r=NRCalc.calc(NRCalc.fromParams(c.params));
 for(const [table,rows] of Object.entries(c.expected)) for(const [year,fields] of Object.entries(rows)) for(const [field,value] of Object.entries(fields)){
  const tolerance=fixture.toleranceWan*((field==='cumNet'||field==='cumNpv')?r.allYears.indexOf(+year)+1:1);
  assert.ok(Math.abs(r[table][year][field]-value)<=tolerance,`${table}.${year}.${field}: ${r[table][year][field]} != ${value}`);
 }
 assert.equal(r.summary.totalOperateMonths,Object.values(r.monthDict).reduce((a,b)=>a+b,0));
});
test('explicit dates include both endpoints; JSON restore preserves plans and results',()=>{
 const c=fixture.cases.find(c=>c.name==='partial-132-months');
 const p=NRCalc.fromParams(c.params),r=NRCalc.calc(p);
 assert.equal(r.monthDict[2026],9);assert.equal(r.monthDict[2037],3);assert.equal(r.summary.totalOperateMonths,132);
 assert.deepEqual(NRCalc.calc(NRCalc.fromParams(JSON.parse(JSON.stringify(c.params)))),r);
});
test('invalid dates, month maps, plans and percentages fail explicitly',()=>{
 const base=fixture.cases[0].params;
 for(const patch of [{operateStartMonth:'2027-01'},{firstMonths:13},{loanPlan:{1900:1}},{occupancyRamp:{2026:1.1}}]) assert.throws(()=>NRCalc.calc(NRCalc.fromParams({...base,...patch})));
 assert.throws(()=>NRCalc.calc({...NRCalc.fromParams(base),monthDict:{}}));
 assert.throws(()=>NRCalc.calc(NRCalc.fromParams({...base,mode:'share',sharePct:101})));
});
test('zero sharing rates remain zero; inputs are not mutated',()=>{
 const p={...fixture.cases[0].params,mode:'share',collectPct:0,sharePct:0},before=JSON.stringify(p);
 const r=NRCalc.calc(NRCalc.fromParams(p));
 assert.equal(r.cost[2026].collect,0);assert.equal(r.cost[2026].share,0);assert.equal(JSON.stringify(p),before);
});
