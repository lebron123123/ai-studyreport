import {chromium} from 'playwright';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage();const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const params=JSON.parse(readFileSync('tests/fixtures/nrcalc-reference.json','utf8')).cases[0].params;
 await page.route('**/auth.js*',r=>r.fulfill({contentType:'text/javascript',body:readFileSync('auth.js','utf8')+`;getUser=()=> 'test-refresh';getToken=()=> 'test-only';recalledActiveProjectId=()=> 'test-A';`}));
 await page.route('**/api/**',r=>r.fulfill({json:{ok:true,config:{},projects:[],records:[],items:[],outlines:[],project:{id:'test-A',role:'OWNER',updated_at:1,data:{project:{name:'[系统测试]刷新'},chapters:[],calcType:'gaibao',calcParams:params}}}}));
 await page.goto('http://localhost:8080/#calc');
 await page.locator('[data-sct="gaibao"]').click();await page.locator('#scNext1').click();
 await page.locator('#c_rent').fill('77.25');
 for(let i=0;i<3;i++){
   await page.reload();await page.locator('#c_rent').waitFor({timeout:6000});
   assert.equal(await page.locator('#c_rent').inputValue(),'77.25');
   assert.equal(await page.evaluate(()=>scStep),1);
 }
 await page.locator('#scRun').click();await page.locator('#scBack1').waitFor();
 const result=await page.evaluate(()=>JSON.stringify(scResult));
 for(let i=0;i<3;i++){
   await page.reload();await page.locator('#scBack1').waitFor({timeout:6000});
   assert.equal(await page.evaluate(()=>scStep),2);
   assert.equal(await page.evaluate(()=>JSON.stringify(scResult)),result);
 }
 assert.deepEqual(errors,[]);
 console.log('PASS full index/auth/navigation/project bootstrap: form refresh x3, result refresh x3, unchanged values, no page errors (isolated mocked API)');
}finally{await browser.close()}
