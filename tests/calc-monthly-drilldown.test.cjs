const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {chromium}=require('playwright');
global.window=global;
require('../nrcalc.js');

const params=require('./fixtures/nrcalc-reference.json').cases[0].params;
const result=NRCalc.calc(NRCalc.fromParams({...params,debtModel:'monthly-v2'}));

test('非居改保年度表点击年份显示真实逐月借款还本付息，且与年度数勾稽',async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.setContent('<!doctype html><html><body><main id="table"></main></body></html>');
    await page.addScriptTag({path:path.join(__dirname,'..','calc.js')});
    await page.evaluate(R=>{
      scResult=R;
      document.getElementById('table').innerHTML=dtable('还本付息计划表（万元）',R,specGaibao()[2].rows,true,'还本付息');
    },result);
    await page.getByRole('button',{name:'查看2025年逐月明细'}).click();
    const overlay=page.locator('#calcMonthlyOverlay');
    assert.equal(await overlay.count(),1,errors.join('; '));
    await overlay.getByRole('dialog',{name:'2025年逐月测算明细'}).waitFor();
    assert.match(await overlay.textContent(),/当月还本按月末处理，从次月起减少利息/);
    assert.equal(await overlay.locator('tbody tr').count(),14);
    const actual=await overlay.evaluate(root=>({
      months:Array.from(root.querySelectorAll('tbody tr')).slice(0,12).map(row=>row.cells[0].textContent),
      total:Array.from(root.querySelectorAll('tbody tr'))[12].cells[3].textContent,
      annual:Array.from(root.querySelectorAll('tbody tr'))[13].cells[3].textContent,
      warning:root.textContent.includes('需复核')
    }));
    assert.deepEqual(actual.months,Array.from({length:12},(_,i)=>'2025-'+String(i+1).padStart(2,'0')));
    assert.equal(actual.total,actual.annual);
    assert.equal(actual.warning,false);
    await overlay.getByRole('button',{name:'关闭月度明细'}).click();
    assert.equal(await page.locator('#calcMonthlyOverlay').count(),0);
  }finally{await browser.close();}
});

test('月度分类只展示已保存的真实月度口径，不拆分销项和进项税',async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.addScriptTag({path:path.join(__dirname,'..','calc.js')});
    await page.evaluate(R=>{scResult=R;calcOpenMonthlyDetails(2026,'税金');},result);
    const overlay=page.locator('#calcMonthlyOverlay');
    assert.equal(await overlay.getByText('销项税额、进项税额没有独立月度计算口径',{exact:false}).count(),1);
    assert.equal(await overlay.locator('thead th').allTextContents().then(cells=>cells.includes('销项税额')),false);
    await overlay.getByRole('button',{name:'现金流',exact:true}).click();
    assert.equal(await overlay.locator('thead th').allTextContents().then(cells=>cells.includes('净现金流量')),true);
  }finally{await browser.close();}
});

test('各年各类月度合计与年度表对账，不一致须显式提示',async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.addScriptTag({path:path.join(__dirname,'..','calc.js')});
    const audit=await page.evaluate(R=>{
      scResult=R;
      const results=[];
      for(const year of R.allYears)for(const sheet of ['收入','成本','还本付息','税金','利润','现金流']){
        calcOpenMonthlyDetails(year,sheet);
        const overlay=document.getElementById('calcMonthlyOverlay');
        const warning=overlay.querySelector('[data-monthly-content] p:last-child').textContent;
        if(warning.startsWith('需复核'))results.push({year,sheet,warning});
      }
      return results;
    },result);
    assert.deepEqual(audit,[]);
  }finally{await browser.close();}
});

test('无月度底账的年度表不伪造逐月入口',async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.addScriptTag({path:path.join(__dirname,'..','calc.js')});
    const html=await page.evaluate(()=>dtable('年度表',{allYears:[2027,2028]},[],true,'收入'));
    assert.equal(html.includes('calcOpenMonthlyDetails'),false);
    assert.match(html,/<th>2027<\/th>/);
  }finally{await browser.close();}
});

test('利润月度实点：补亏和计税基础可见，连续开关/刷新恢复，错账显式提示',async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    const script=fs.readFileSync(path.join(__dirname,'..','calc.js'),'utf8');
    await page.route('http://nr-regression.test/**',route=>route.fulfill(route.request().url().endsWith('/calc.js')?{contentType:'text/javascript; charset=utf-8',body:script}:{contentType:'text/html; charset=utf-8',body:'<!doctype html><meta charset="utf-8"><main id="table"></main><script src="/calc.js"></script><script>scResult='+JSON.stringify(result)+';document.getElementById("table").innerHTML=dtable("利润",scResult,specGaibao()[4].rows,true,"利润");</script>'}));
    await page.goto('http://nr-regression.test/');
    assert.deepEqual(errors,[]);
    for(let i=0;i<5;i++){
      if(i===3)await page.reload();
      assert.equal(await page.getByRole('button',{name:'查看2025年逐月明细'}).count(),1,`round ${i}: ${errors.join('; ')} ${await page.locator('body').innerText()}`);
      await page.getByRole('button',{name:'查看2025年逐月明细'}).click();
      const overlay=page.locator('#calcMonthlyOverlay');
      await overlay.getByRole('button',{name:'利润与前期补亏（逐月计算）',exact:true}).click();
      const headers=await overlay.locator('thead th').allTextContents();
      for(const label of ['前期补亏','计税基础','所得税','净利润'])assert.ok(headers.includes(label));
      assert.doesNotMatch(await overlay.textContent(),/需复核/);
      const totals=await overlay.locator('tbody tr').allTextContents();
      assert.equal(totals[12].replace('逐月合计 / 期末',''),totals[13].replace('年度表数值',''));
      await overlay.getByRole('button',{name:'关闭月度明细'}).click();
      assert.equal(await overlay.count(),0);
    }
    await page.evaluate(()=>{scResult.profit[2025].makeup+=1;});
    await page.getByRole('button',{name:'查看2025年逐月明细'}).click();
    await page.locator('#calcMonthlyOverlay').getByRole('button',{name:'利润与前期补亏（逐月计算）',exact:true}).click();
    assert.match(await page.locator('#calcMonthlyOverlay').textContent(),/需复核：前期补亏/);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
