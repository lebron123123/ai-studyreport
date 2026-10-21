import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/calc-refresh-test',r=>r.fulfill({contentType:'text/html',body:`<div id="sheet"></div>
 <script>let appMode='calc',currentProjectId='test-A',testUser='test-user';function getUser(){return testUser}function escapeHtml(v){return String(v).replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}function renderTOC(){}function renderSheet(){document.getElementById('sheet').innerHTML=renderCalcModule();bindCalcEvents()}</script>
 <script src="/nrcalc.js"></script><script src="/metrics.js"></script><script src="/export.js"></script><script src="/calc.js"></script><script>renderSheet()</script>`}));
 await page.goto('http://localhost:8080/calc-refresh-test');
 await page.locator('[data-sct="gaibao"]').click();await page.locator('#scNext1').click();
 await page.locator('#c_rent').fill('77.25');
 await page.reload();assert.equal(await page.locator('#c_rent').inputValue(),'77.25');
 await page.locator('#scRun').click();
 assert.equal(await page.locator('#scRunError').count()?await page.locator('#scRunError').innerText():'','');
 await page.locator('#scBack1').waitFor();
 const original=await page.evaluate(()=>JSON.stringify({params:scParams,result:scResult}));
 const headline=await page.evaluate(()=>({irr:scResult.summary.irr,xirr:scResult.summary.monthlyXirr}));
 assert.equal(headline.irr,Math.round(headline.xirr*100)/100);
 await page.evaluate(()=>{scResult.summary.irr=scResult.summary.annualIrr;calcSaveDraft();});
 await page.reload();await page.locator('#scBack1').waitFor();
 assert.equal(await page.evaluate(()=>scResult.summary.irr),headline.irr,'old annual headline migrates to monthly XIRR');
 await page.evaluate(()=>{for(const y of scResult.allYears){delete scResult.cf[y].engineering;delete scResult.cf[y].cashCost;scResult.cf[y].outflow=scResult.cost[y].total+scResult.tax[y].total+scResult.profit[y].incomeTax;}calcSaveDraft();});
 await page.reload();await page.locator('#scBack1').waitFor();
 assert.equal(await page.evaluate(()=>JSON.stringify({params:scParams,result:scResult})),original,'old amortization cashflow is recalculated on refresh');
 const cashTable=page.locator('details.dt-block').filter({has:page.locator('summary',{hasText:'现金流量表（万元）'})});
 await cashTable.locator('summary').click();
 await cashTable.getByRole('button',{name:'现金流出（明细）'}).click();
 await cashTable.getByRole('button',{name:'总成本费用（明细）'}).click();
 assert.equal(await cashTable.getByText('IRR(按月度现金流量XIRR公式)',{exact:true}).count(),1);
 assert.match(await cashTable.getByText('IRR(按月度现金流量XIRR公式)',{exact:true}).locator('..').innerText(),/%/);
 assert.equal(await cashTable.getByText('IRR(按年度现金流量IRR公式)',{exact:true}).count(),1);
 const actualRow=cashTable.getByText('工程流出（实际付款）',{exact:true}).locator('..');
 const debtRow=page.getByText('工程流出',{exact:true}).locator('..');
 assert.deepEqual((await actualRow.locator('td').allTextContents()).slice(1),(await debtRow.locator('td').allTextContents()).slice(1),'all displayed years exactly match debt engineering row');
 for(let i=0;i<3;i++){await page.reload();await page.locator('#scBack1').waitFor();assert.equal(await page.evaluate(()=>scStep),2);assert.equal(await page.evaluate(()=>JSON.stringify({params:scParams,result:scResult})),original);}
 await page.evaluate(()=>{currentProjectId='test-B';renderSheet()});assert.equal(await page.evaluate(()=>scStep),0);
 await page.evaluate(()=>{currentProjectId='test-A';renderSheet()});assert.equal(await page.evaluate(()=>scStep),2);
 await page.evaluate(()=>{testUser='other-user';renderSheet()});assert.equal(await page.evaluate(()=>scStep),0);
 await page.evaluate(()=>{testUser='test-user';renderSheet()});assert.equal(await page.evaluate(()=>scStep),2);
 await page.locator('#scBack1').click();await page.locator('#c_rent').fill('');await page.reload();assert.equal(await page.locator('#c_rent').inputValue(),'');
 await page.evaluate(()=>{Storage.prototype.setItem=function(){throw new Error('quota')};document.getElementById('c_rent').value='91';document.getElementById('c_rent').dispatchEvent(new Event('input'))});
 assert.match(await page.locator('#calcDraftWarning').innerText(),/保存失败/);
 await page.reload();
 await page.evaluate(()=>sessionStorage.setItem(calcDraftKey(),'broken draft'));
 await page.reload();
 assert.match(await page.locator('#calcDraftWarning').innerText(),/无法恢复/);
 assert.equal(await page.evaluate(()=>sessionStorage.getItem(calcDraftKey())),'broken draft');
 assert.deepEqual(errors,[]);
 console.log('PASS actual browser reload: unfinished fields, identical results x3, project/account isolation, empty input, storage failure warning, corrupt draft preserved');
}finally{await browser.close()}
