import {chromium} from 'playwright';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const params={...JSON.parse(readFileSync('tests/fixtures/nrcalc-reference.json')).cases[0].params,buildStartMonth:'2026-01',buildEndMonth:'2026-09',operateStartMonth:'2026-10',operateEndMonth:'2037-12',rampStartMonth:'2026-10',rampEndMonth:'2026-12',stableStartMonth:'2027-01',occupancyMode:'monthly-phases',rampIntervalMonths:1,rampRates:[.6,.8,.95],costSpan:1,costRate:0,collectPct:50,sharePct:30,firstDecoLoanPct:80,debtModel:'monthly-v2'};
let state='normal',writes=0;const errors=[];
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.addInitScript(()=>{localStorage.setItem('fs_token','isolated-system-test');localStorage.setItem('fs_user','[系统测试]');});
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',route=>{
  if(route.request().method()!=='GET'&&!route.request().url().includes('/adminpass'))writes++;
  if(!route.request().url().includes('/calcexperience'))return route.fulfill({json:{ok:true,config:{},records:[],outlines:[]}});
  return route.fulfill({status:state==='failure'?503:200,json:state==='failure'?{ok:false,error:'隔离测试服务失败'}:{ok:true,metrics:[],records:state==='empty'?[]:[{id:'sensitivity-test',revision:2,projectName:'[系统测试]全量影响验证',projectType:'gaibao',status:'confirmed',payload:{params:state==='incomplete'?{}:params}}]}});
 });
 await page.goto('http://localhost:8080/admin.html');
 await page.evaluate(()=>{document.querySelector('#editBox').style.display='block';renderSensitivity();});
 const host=page.locator('#projectSensitivityHost'),status=host.locator('[data-role=status]');
 await host.locator('[data-role=run]').waitFor();
 await host.locator('[data-role=run]').click();
 await page.waitForFunction(()=>document.querySelector('#projectSensitivityHost [data-role=status]').textContent.includes('分析完成'));
 assert.ok(await host.locator('[data-detail]').count()>25);
 await host.locator('[data-role=metric]').selectOption('npv');
 await host.locator('[data-detail]').first().click();
 assert.ok(await host.locator('[data-role=detail] table tr').count()>100);
 const downloadWait=page.waitForEvent('download');await host.locator('[data-role=save]').click();const stream=await (await downloadWait).createReadStream();const chunks=[];for await(const c of stream)chunks.push(c);
 const result=JSON.parse(Buffer.concat(chunks));assert.equal(result.project.revision,2);assert.equal(result.version,'anju-le-yu-v1.0');assert.ok(result.rows.every(r=>r.reason||r.scenarios.length===2));
 await page.screenshot({path:'.tmp/project-sensitivity.png',fullPage:true});
 await host.locator('[data-role=run]').click();await host.locator('[data-role=cancel]').click();await page.waitForFunction(()=>document.querySelector('#projectSensitivityHost [data-role=status]').textContent.includes('已取消'));
 state='empty';await host.locator('[data-role=reload]').click();await page.waitForFunction(()=>document.querySelector('#projectSensitivityHost [data-role=status]').textContent.includes('没有可用项目'));
 state='failure';await host.locator('[data-role=reload]').click();await page.waitForFunction(()=>document.querySelector('#projectSensitivityHost [data-role=status]').textContent.includes('读取失败'));
 state='incomplete';await host.locator('[data-role=reload]').click();await host.locator('[data-role=run]').waitFor();await host.locator('[data-role=run]').click();await page.waitForFunction(()=>document.querySelector('#projectSensitivityHost [data-role=status]').textContent.includes('不完整'));
 state='normal';await host.locator('[data-role=reload]').click();await host.locator('[data-role=run]').waitFor();await host.locator('[data-role=run]').click();await page.waitForFunction(()=>document.querySelector('#projectSensitivityHost [data-role=status]').textContent.includes('分析完成'));
 assert.equal(writes,0);assert.deepEqual(errors,[]);console.log(JSON.stringify({pass:true,rows:result.rows.length,scenarios:result.rows.filter(r=>!r.reason).length*2,writes,errors}));
}finally{await browser.close();}
