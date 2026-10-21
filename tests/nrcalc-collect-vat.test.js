const test=require('node:test');
const assert=require('node:assert/strict');
global.window=global;require('../nrcalc.js');

const base=require('./fixtures/nrcalc-reference.json').cases[0].params;
const calc=changes=>NRCalc.calc(NRCalc.fromParams({...base,debtModel:'legacy-annual',...changes}));
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<0.00011,`${actual} != ${expected}`);

test('no collection cost adds no input VAT',()=>{
  const result=calc({collect:0});
  const year=result.allYears.find(y=>result.cost[y].eng>0);
  const cost=result.cost[year];
  near(result.tax[year].input,Math.round((cost.eng*.09/1.09+(cost.op+cost.fin)*.06/1.06)*10000)/10000);
});

test('fixed and rent-percentage collection both add input VAT on actual collection cost',()=>{
  for(const params of [{mode:'lease',collect:25},{mode:'rent-percent',collectRentPct:20}]){
    const result=calc(params);
    const year=result.allYears.find(y=>result.cost[y].collect>0);
    const cost=result.cost[year];
    const expected=(cost.collect+cost.eng)*.09/1.09+(cost.op+cost.fin)*.06/1.06;
    near(result.tax[year].input,Math.round(expected*10000)/10000);
    const without=calc({...params,collect:0,collectRentPct:0});
    near(result.tax[year].input-without.tax[year].input,cost.collect*.09/1.09);
  }
});
