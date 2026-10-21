const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {chromium}=require('playwright');

function setup(){
  const context={console};context.window=context;vm.createContext(context);
  for(const file of ['xlsx.full.min.js','nrcalc.js','calc.js','export.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context);
  context.params=require('./fixtures/nrcalc-reference.json').cases[0].params;
  vm.runInContext("calcType='gaibao';scParams={...params,debtModel:'legacy-annual'};scResult=NRCalc.calc(NRCalc.fromParams(scParams));",context);
  return context;
}

test('网站销项、进项各有自己的明细，导出税表仍保持原有行结构',()=>{
  const context=setup();
  const {specs,result}=vm.runInContext('({specs:calcSpecs(),result:scResult})',context);
  const rows=specs.find(table=>table.sheet==='税金').rows;
  assert.deepEqual(Array.from(rows.filter(row=>row.detailOf==='t_in'),row=>row.l),['收楼成本进项','工程费用进项','运营费用进项','财务费用进项']);
  assert.deepEqual(Array.from(rows.filter(row=>row.detailOf==='t_out'),row=>row.l),['计税租金收入（含税）','租金销项税率']);
  assert.equal(rows.some(row=>row.detailOf==='t_tot'),false);
  for(const year of result.operateArr||result.allYears){
    const input=rows.find(row=>row.id==='t_in').g(result,year);
    const parts=rows.filter(row=>row.detailOf==='t_in').reduce((sum,row)=>sum+row.g(result,year),0);
    assert.ok(Math.abs(input-parts)<=0.0002,year+': '+input+' != '+parts);
  }
  const wb=vm.runInContext('buildCalcWorkbook()',context);
  const parsed=context.XLSX.read(context.XLSX.write(wb,{type:'array',bookType:'xlsx'}),{type:'array',cellFormula:true});
  const sheet=parsed.Sheets['税金'];
  const labels=context.XLSX.utils.sheet_to_json(sheet,{header:1}).map(row=>row[0]);
  assert.deepEqual(Array.from(labels),['指标','销项税额','进项税额','增值税','增值税附加','印花税','税金及附加总和']);
});

test('网页税金表可分别展开销项与进项，合计不再有重复展开',async()=>{
  const context=setup(), result=vm.runInContext('scResult',context);
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.setContent('<!doctype html><html><body><div id="tax"></div></body></html>');
    await page.addScriptTag({path:path.join(__dirname,'..','nrcalc.js')});
    await page.addScriptTag({path:path.join(__dirname,'..','calc.js')});
    await page.evaluate(R=>{calcType='gaibao';scResult=R;const table=calcSpecs().find(item=>item.sheet==='税金');document.getElementById('tax').innerHTML=dtable(table.title,R,table.rows,true,'税金');},result);
    const out=page.locator('tr[data-detail-id="t_out"] button'),input=page.locator('tr[data-detail-id="t_in"] button');
    assert.equal(await page.locator('tr[data-detail-id="t_tot"] button').count(),0);
    await out.click();assert.equal(await page.locator('tr[data-detail-of="t_out"]:visible').count(),2);
    assert.equal(await page.locator('tr[data-detail-of="t_in"]:visible').count(),0);
    await input.click();assert.equal(await page.locator('tr[data-detail-of="t_in"]:visible').count(),4);
    await out.click();assert.equal(await page.locator('tr[data-detail-of="t_out"]:visible').count(),0);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
