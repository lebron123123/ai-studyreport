import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{chromium}=require('playwright'),browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',r=>r.fulfill({json:{ok:false,error:'[系统测试]隔离，无真实数据'}}));
 await page.goto('http://localhost:8080/',{waitUntil:'domcontentloaded'});
 for(let turn=0;turn<2;turn++){
  if(turn)await page.reload({waitUntil:'domcontentloaded'});
  const cases=await page.evaluate(()=>{
   const original=chapters;
   try{
    chapters=[];const empty=reportLengthReviewHtml();
    const paragraph='这是一段需要核对的项目实际论述，包含必要条件，不能直接删除。'.repeat(100);
    chapters=[{name:'测试',sections:[{t:'第一节',content:paragraph},{t:'第二节',content:paragraph},{t:'未生成',content:''}]}];
    const normal=reportLengthReviewHtml();document.body.innerHTML='<main id="testReportLength">'+normal+'</main>';
    return {empty,normal};
   }finally{chapters=original;}
  });
  assert.match(cases.empty,/0 个小节/);assert.match(cases.normal,/超预算/);assert.match(cases.normal,/完全重复/);assert.match(cases.normal,/尚未生成/);
  for(let i=0;i<5;i++){await page.locator('#testReportLength summary').click();assert.equal(await page.locator('#testReportLength details').evaluate(el=>el.open),i%2===0);}
 }
 assert.deepEqual(errors,[]);console.log('Length review browser: empty/over-budget/duplicate/pending/5 toggles/refresh passed; isolated APIs, no user data writes.');
}finally{await browser.close();}
