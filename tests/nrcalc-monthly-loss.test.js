const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const scope={};scope.window=scope;vm.createContext(scope);vm.runInContext(fs.readFileSync('nrcalc.js','utf8'),scope);
const N=scope.NRCalc,fixture=require('./fixtures/nrcalc-excel-monthly-loss.json');
const close=(actual,expected,label)=>assert.ok(Math.abs(actual-expected)<=.00005001,`${label}: ${actual} != ${expected}`);

test('税务局原Excel的144个月：补亏、计税基础、所得税逐月一致',()=>{
  const rows=fixture.rows.map(([period,profit])=>({period,profit}));
  N.applyMonthlyLossOffset(rows,.25);
  fixture.rows.forEach(([period,profit,makeup,taxable,incomeTax],i)=>{
    close(rows[i].makeup,makeup,period+' 补亏');
    close(rows[i].taxable,taxable,period+' 计税基础');
    close(rows[i].incomeTax,incomeTax,period+' 所得税');
    close(rows[i].netProfit,profit-rows[i].incomeTax,period+' 净利润');
  });
  close(rows.slice(0,12).reduce((sum,m)=>sum+m.makeup,0),11.8851,'首年逐月补亏汇总');
  for(const [start,end] of [[0,12],[12,24],[0,24]]){
    const expected=fixture.rows.slice(start,end).reduce((sum,row)=>sum+Math.round(row[2]*1e4)/1e4,0);
    close(rows.slice(start,end).reduce((sum,m)=>sum+m.makeup,0),expected,'逐月四位小数汇总');
  }
});

test('跨年及超过五年不重置；部分补亏、转正、亏损后不冲回已缴月税',()=>{
  const profits=[-100,...Array(71).fill(0),30,90,-10,20];
  const rows=N.applyMonthlyLossOffset(profits.map(profit=>({profit})),.25);
  assert.equal(rows[72].makeup,30);assert.equal(rows[72].incomeTax,0);
  assert.equal(rows[73].makeup,70);assert.equal(rows[73].taxable,20);assert.equal(rows[73].incomeTax,5);
  assert.equal(rows[74].incomeTax,0);assert.equal(rows[75].makeup,0);assert.equal(rows[75].incomeTax,5);
});

test('严格复现Excel累计恰好归零的特殊分支；首月及零税率',()=>{
  const rows=N.applyMonthlyLossOffset([-10,10,5].map(profit=>({profit})),.25);
  assert.equal(rows[0].makeup,0);assert.equal(rows[1].makeup,0);
  assert.equal(rows[1].taxable,10);assert.equal(rows[1].incomeTax,2.5);
  assert.equal(N.applyMonthlyLossOffset([{profit:10}],.25)[0].incomeTax,2.5);
  assert.ok(N.applyMonthlyLossOffset([{profit:-10},{profit:20}],0).every(m=>m.incomeTax===0));
});

test('实际引擎年度补亏/税额/净利润只汇总月度，JSON恢复和重复计算一致',()=>{
  const base=require('./fixtures/nrcalc-reference.json').cases[0].params;
  for(const debtModel of ['monthly-v2','legacy']){
    const params={...base,debtModel};
    const result=N.calc(N.fromParams(params));
    assert.equal(result.taxModelVersion,N.taxModelVersion);
    for(const year of result.allYears){
      const rows=result.monthlyProfit.filter(m=>m.date.startsWith(year+'-'));
      for(const key of ['makeup','taxable','incomeTax','netProfit'])close(result.profit[year][key],rows.reduce((sum,m)=>sum+m[key],0),year+' '+key);
      close(result.profit[year].taxable,result.profit[year].totalProfit-result.profit[year].makeup,year+' 勾稽');
    }
    assert.deepEqual(JSON.parse(JSON.stringify(N.calc(N.fromParams(JSON.parse(JSON.stringify(params)))))),JSON.parse(JSON.stringify(result)));
  }
});
