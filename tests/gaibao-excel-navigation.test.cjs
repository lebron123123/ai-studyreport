const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

test('非居改保年度总览可跳到逐月区块，逐月合计与年度表一致',()=>{
  const context={console};context.window=context;vm.createContext(context);
  for(const file of ['xlsx.full.min.js','nrcalc.js','calc.js','export.js'])vm.runInContext(fs.readFileSync(file,'utf8'),context);
  context.params=require('./fixtures/nrcalc-reference.json').cases[0].params;
  vm.runInContext("calcType='gaibao';scParams={...params,buildStartMonth:'2026-01',buildEndMonth:'2026-12',operateStartMonth:'2027-01',operateEndMonth:'2031-12',firstDecoLoanPct:60,occupancyMode:'monthly-phases',rampStartMonth:'2027-01',rampEndMonth:'2028-06',stableStartMonth:'2028-07'};scResult=NRCalc.calc(NRCalc.fromParams(scParams));",context);
  const workbook=vm.runInContext('buildCalcWorkbook()',context);
  const parsed=context.XLSX.read(context.XLSX.write(workbook,{type:'array',bookType:'xlsx'}),{type:'array',cellFormula:true});
  const result=vm.runInContext('scResult',context),overview=parsed.Sheets['年度总览'],detail=parsed.Sheets['月度核对'];
  assert.equal(parsed.SheetNames[0],'年度总览');
  assert.ok(parsed.Sheets['月度现金流'],'original monthly source and annual formulas remain');
  for(const [i,year] of result.allYears.entries()){
    const cell=context.XLSX.utils.encode_col(i+2)+'4';
    const target=overview[cell].l?.Target;
    assert.match(target||'',/^#'月度核对'!A\d+$/);
    const anchor=Number(target.match(/\d+$/)[0]);
    assert.equal(detail['A'+anchor].v,year+'年逐月明细');
    assert.equal(detail['B'+anchor].l?.Target,"#'年度总览'!"+cell);
    assert.deepEqual(Array.from({length:12},(_,month)=>detail[context.XLSX.utils.encode_col(month+2)+(anchor+1)].v),Array.from({length:12},(_,month)=>String(month+1).padStart(2,'0')+'月'));
  }
  const overviewRows=context.XLSX.utils.sheet_to_json(overview,{header:1});
  const rentRow=overviewRows.findIndex(row=>row[0]==='住宅租金收入')+1;
  assert.equal(overview['D'+rentRow].v,result.income[2027].rent);
  assert.match(overview['D'+rentRow].f,/^'收入'!D\d+$/);
  const detailRows=context.XLSX.utils.sheet_to_json(detail,{header:1});
  for(const [cell,value] of Object.entries(detail))if(/^Q\d+$/.test(cell)&&typeof value?.v==='number')assert.ok(Math.abs(value.v)<0.0012,cell+' difference '+value.v);
  for(const label of ['住宅租金收入','收楼成本','运营费用','归还本金','利息支出','净现金流量']){
    const row=detailRows.findIndex(values=>values[0]===label)+1;
    assert.ok(row>0,label);
    assert.ok(Math.abs(detail['Q'+row].v)<0.0012,label+' should reconcile');
    assert.match(detail['Q'+row].f,/^ROUND\(O\d+-P\d+,4\)$/);
  }
});
