const test=require('node:test');
const assert=require('node:assert/strict');
global.window=global;require('../nrcalc.js');
const fixture=require('./fixtures/nrcalc-reference.json');
for(const c of fixture.cases) test('NRCalc pinned Python parity: '+c.name,()=>{
 const r=NRCalc.calc(NRCalc.fromParams({...c.params,debtModel:'legacy-annual'}));
 for(const [table,rows] of Object.entries(c.expected)) for(const [year,fields] of Object.entries(rows)) for(const [field,value] of Object.entries(fields)){
  // 旧Python基准扣了VAT；本次明确修正的利润/现金流改由下方新口径行为断言验证，原基准保留不篡改。
  if(table==='cf'||(table==='profit'&&!['incomeAT','costAT','pretax'].includes(field))||(table==='tax'&&!['output','stamp'].includes(field)))continue;
  const tolerance=fixture.toleranceWan*((field==='cumNet'||field==='cumNpv')?r.allYears.indexOf(+year)+1:1);
  assert.ok(Math.abs(r[table][year][field]-value)<=tolerance,`${table}.${year}.${field}: ${r[table][year][field]} != ${value}`);
 }
 let cumulative=0,cumulativeNpv=0;
 for(const [i,year] of r.allYears.entries()){
  const p=r.profit[year],t=r.tax[year],flow=r.cf[year];
  const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<0.00051,`${year}: ${actual} != ${expected}`);
  const expense=r.cost[year];
  if(r.monthDict[year])near(t.input,(expense.collect+expense.eng)*.09/1.09+(expense.op+expense.fin)*.06/1.06);
  else near(t.input,0);
  near(t.vat,Math.max(t.output-t.input,0));
  near(t.total,t.vat+t.surcharge+t.stamp);
  near(p.tax,t.surcharge+t.stamp);near(p.totalProfit,p.incomeAT-p.costAT-t.surcharge-t.stamp);
  const ms=r.monthlyProfit.filter(m=>m.date.startsWith(String(year))),sum=k=>ms.reduce((s,m)=>s+m[k],0);
  near(p.taxable,p.totalProfit-p.makeup);near(p.makeup,sum('makeup'));near(p.incomeTax,sum('incomeTax'));near(p.netProfit,p.totalProfit-p.incomeTax);
  ms.forEach(m=>near(m.incomeTax,Math.max(0,m.taxable)*.25));
  near(flow.outflow,r.cost[year].total+t.total+p.incomeTax);near(flow.net,r.income[year].rent-flow.outflow);
  cumulative+=flow.net;near(flow.cumNet,cumulative);
  near(flow.npv,flow.net/Math.pow(1+c.params.discount/100,i+.5));cumulativeNpv+=flow.npv;near(flow.cumNpv,cumulativeNpv);
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
 for(const patch of [{operateStartMonth:'2027-01'},{firstMonths:13},{debtModel:'legacy-annual',loanPlan:{1900:1}},{occupancyRamp:{2026:1.1}}]) assert.throws(()=>NRCalc.calc(NRCalc.fromParams({...base,...patch})));
 assert.throws(()=>NRCalc.calc({...NRCalc.fromParams(base),monthDict:{}}));
 assert.throws(()=>NRCalc.calc(NRCalc.fromParams({...base,mode:'share',sharePct:101})));
});
test('zero sharing rates remain zero; inputs are not mutated',()=>{
 const p={...fixture.cases[0].params,mode:'share',collectPct:0,sharePct:0},before=JSON.stringify(p);
 const r=NRCalc.calc(NRCalc.fromParams(p));
 assert.equal(r.cost[2026].collect,0);assert.equal(r.cost[2026].share,0);assert.equal(JSON.stringify(p),before);
});
