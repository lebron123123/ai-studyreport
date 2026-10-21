import {chromium} from 'playwright';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const params={...JSON.parse(readFileSync('tests/fixtures/nrcalc-reference.json')).cases[0].params,buildStartMonth:'2026-01',buildEndMonth:'2026-09',operateStartMonth:'2026-10',operateEndMonth:'2037-12',rampStartMonth:'2026-10',rampEndMonth:'2026-12',stableStartMonth:'2027-01',occupancyMode:'monthly-phases',rampIntervalMonths:1,rampRates:[.6,.8,.95],costSpan:1,costRate:0,collectPct:50,sharePct:30,firstDecoLoanPct:80,debtModel:'monthly-v2'};
let state='normal',writes=0,failApply=true,published;const errors=[];
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(120000);
 await page.addInitScript(()=>{localStorage.setItem('fs_token','isolated-system-test');localStorage.setItem('fs_user','[系统测试]');});
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.route('**/api/**',route=>{
  if(route.request().method()==='POST'&&route.request().url().includes('/calcconfig')){writes++;published=route.request().postDataJSON();return route.fulfill({status:failApply?409:200,json:failApply?{ok:false,error:'测试版本冲突'}:{ok:true}});}
  if(!route.request().url().includes('/calcexperience'))return route.fulfill({json:{ok:true,config:{},records:[],outlines:[]}});
  return route.fulfill({status:state==='failure'?503:200,json:state==='failure'?{ok:false,error:'测试服务失败'}:{ok:true,metrics:[],records:state==='empty'?[]:[{id:'sensitivity-test',revision:2,projectName:'[系统测试]全局影响验证',projectType:'gaibao',status:'confirmed',payload:{params:state==='incomplete'?{}:params}}]}});
 });
 await page.goto('http://localhost:8080/admin.html');await page.evaluate(()=>{document.querySelector('#editBox').style.display='block';clType='gaibao';renderSensitivity();});
 const host=page.locator('#projectSensitivityHost');await host.locator('[data-role=run]').waitFor();
 // Keep all inputs in the coverage ledger; isolate two safe ranges for repeatable UI validation.
 await page.evaluate(p=>{const rows=ProjectSensitivityGlobal.inventory(p);document.querySelectorAll('#projectSensitivityHost [data-range]').forEach(x=>{const r=rows[+x.dataset.range];x.value=r.key==='rent'?(+x.dataset.side?p.rent*1.05:p.rent*.95):r.key==='discount'?(+x.dataset.side?7:5):r.value;});},params);
 await host.locator('[data-role=run]').click();await page.waitForFunction(()=>document.querySelector('#projectSensitivityHost [data-role=threshold]'));
 assert.equal(writes,0);assert.ok((await host.textContent()).includes('IRR 实际影响'));assert.ok(!(await host.textContent()).includes('情景A'));
 assert.equal(await host.locator('[data-pick=discount]').isChecked(),false);assert.equal(await host.locator('[data-pick=discount]').isDisabled(),true);
 assert.equal(await host.locator('[data-range][aria-label^="operateStartMonth"]').count(),0);
 await host.locator('[data-role=rules] > summary').click();await host.locator('[data-policy=discount]').selectOption('assumed');
 await host.locator('[data-role=npv-threshold]').fill('0.01');await host.locator('[data-role=npv-threshold]').dispatchEvent('change');
 assert.equal(await host.locator('[data-pick=discount]').isChecked(),true);
 await host.locator('[data-pick=rent]').uncheck();assert.equal(await host.locator('[data-pick=rent]').isChecked(),false);
 await host.locator('[data-role=sort]').selectOption('npv');assert.equal(await host.locator('[data-pick=rent]').isChecked(),false);
 await host.locator('[data-role=apply]').click();await page.waitForFunction(()=>document.querySelector('#projectSensitivityHost [data-role=status]').textContent.includes('未应用'));
 failApply=false;await host.locator('[data-role=apply]').click();await page.waitForFunction(()=>document.querySelector('#projectSensitivityHost [data-role=status]').textContent.includes('已应用'));
 assert.equal(writes,2);assert.equal(published.data.threshold,.001);assert.equal(published.data.table.find(r=>r.key==='rent').selected,false);assert.equal(published.data.table.find(r=>r.key==='discount').selected,true);
 assert.equal(published.data.selectionMode,'impact-v4');assert.equal(published.data.table.find(r=>r.key==='discount').policy,'assumed');assert.ok(published.data.table.every(r=>!r.points&&!r.baseValue));
 assert.ok((await host.textContent()).includes('综合排名'));assert.ok(!published.data.table.some(r=>r.key==='mode'));
 await host.locator('[data-role=npv-threshold]').fill('');await host.locator('[data-role=npv-threshold]').dispatchEvent('change');
 await host.locator('[data-role=reset-picks]').click();
 await host.locator('[data-role=weighted-threshold]').fill('');await host.locator('[data-role=weighted-threshold]').dispatchEvent('change');
 await host.locator('[data-role=irr-threshold]').fill('100');await host.locator('[data-role=irr-threshold]').dispatchEvent('change');assert.ok((await host.textContent()).includes('入选 0 项'));
 await host.locator('[data-role=threshold]').fill('0.001');await host.locator('[data-role=threshold]').dispatchEvent('change');
 await host.locator('[data-role=npv-threshold]').fill('0.01');await host.locator('[data-role=npv-threshold]').dispatchEvent('change');
 await page.screenshot({path:'.tmp/project-sensitivity-global.png',fullPage:true});
 await host.locator('[data-role=run]').click();await host.locator('[data-role=cancel]').click();await page.waitForFunction(()=>document.querySelector('#projectSensitivityHost [data-role=status]').textContent.includes('已取消'));
 state='empty';await host.locator('[data-role=reload]').click();await page.waitForFunction(()=>document.querySelector('#projectSensitivityHost [data-role=status]').textContent.includes('没有可用项目'));
 state='failure';await host.locator('[data-role=reload]').click();await page.waitForFunction(()=>document.querySelector('#projectSensitivityHost [data-role=status]').textContent.includes('读取失败'));
 state='incomplete';await host.locator('[data-role=reload]').click();await host.locator('[data-role=run]').click();await page.waitForFunction(()=>document.querySelector('#projectSensitivityHost [data-role=status]').textContent.includes('不完整'));
 state='normal';await page.reload();await page.evaluate(()=>{document.querySelector('#editBox').style.display='block';clType='gaibao';renderSensitivity();});await host.locator('[data-role=run]').waitFor();
 for(const type of ['rent','sale','rent','gaibao']){
  await page.locator('[data-senstype="'+type+'"]').click();
  assert.equal(await page.locator('[data-senstype]').count(),3);
  assert.equal(await page.locator('#projectSensitivityHost').count(),type==='gaibao'?1:0);
  if(type!=='gaibao'){
   assert.equal(await page.locator('#runSens').isVisible(),true);
   assert.equal(await page.locator('#sensN').isVisible(),true);
   assert.ok((await page.locator('#editBox').textContent()).includes('尚未接入真实项目范围校准与留出验证'));
   assert.ok(!(await page.locator('#editBox').innerText()).includes('安居乐寓版'));
  }else await host.locator('[data-role=run]').waitFor();
 }
 assert.equal(writes,2);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({pass:true,writes,errors,threshold:published.data.threshold,ranked:published.data.table.length,types:['gaibao','rent','sale']}));
}finally{await browser.close();}
