const {chromium}=require('C:/Users/HP/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
await page.goto('http://127.0.0.1:8080/project-map/baoan-lod.html?benchmark=1');
await page.waitForFunction(()=>document.body.dataset.ready==='true'&&document.querySelector('#place-count').textContent.includes('2029'),null,{timeout:120000});
await page.locator('summary').click();await page.locator('#place-query').fill('图书馆');await page.locator('#place-results button').first().click();
await page.waitForTimeout(5000);assert.ok(await page.locator('.map-place-labels button').count()>0);assert.ok(await page.locator('.map-place-labels button').count()<=32);
for(let i=0;i<5;i++){await page.getByRole('button',{name:'地名标注：开',exact:true}).click();assert.equal(await page.locator('.map-place-labels').isVisible(),false);await page.getByRole('button',{name:'地名标注：关',exact:true}).click();}
await page.locator('#place-query').fill('不存在的测试地名xyz');assert.equal(await page.locator('#place-results button').count(),0);
await page.locator('#place-query').fill('图书馆');await page.screenshot({path:'outputs/baoan-labels.png'});
await page.route('**/baoan-places.json',r=>r.fulfill({status:503,body:'test'}));await page.reload();await page.waitForFunction(()=>document.body.dataset.ready==='true'&&document.querySelector('#place-count').textContent.includes('失败'),null,{timeout:120000});
await page.unroute('**/baoan-places.json');await page.reload();await page.waitForFunction(()=>document.querySelector('#place-count').textContent.includes('2029'),null,{timeout:120000});assert.deepEqual(errors,[]);console.log('PASS Baoan search, bounded labels, five toggles, empty search, failure isolation, reload; zero page errors');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
