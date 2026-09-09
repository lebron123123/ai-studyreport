const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('C:/Users/HP/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fixture=require('../tests/fixtures/nrcalc-reference.json');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  // Offline component fixture, not an authenticated application session.
  // Serve only repository assets; no production API or user data is accessible.
  const path=require('node:path'),root=path.resolve(__dirname,'..');
  await page.addInitScript(()=>{window.checkLogin=()=>false;});
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.hostname!=='fixture.test'||url.pathname.startsWith('/api/'))return route.abort();
   const file=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
   if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.abort();
   let body=fs.readFileSync(file);
   if(file.endsWith('index.html'))body=body.toString().replace(/<script src="auth\.js[^>]*><\/script>/,'');
   await route.fulfill({body,contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'application/octet-stream'});
  });
  await page.goto('http://fixture.test/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof calcFormHtml==='function'&&typeof exportCalcWord==='function');
  // Synthetic in-memory project only. No login, storage or project API mutations.
  await page.evaluate(p=>{appMode='calc';calcType='gaibao';scStep=1;scParams=p;renderSheet();},fixture.cases[1].params);
  await page.locator('#c_operateEndMonth').fill('2037-03');
  await page.locator('#scRun').click();
  await page.waitForFunction(()=>scStep===2);
  const r=await page.evaluate(()=>({months:scResult.summary.totalOperateMonths,summary:scResult.summary}));assert.equal(r.months,132);
  const icr=await page.evaluate(()=>evalScore().rows.find(r=>r.name.includes('利息')));
  assert.equal(icr.v,r.summary.interestCoverageReference);assert.match(icr.name,/待财务复核/);
  await page.locator('#scBack1').click();
  assert.equal(await page.locator('#c_operateEndMonth').inputValue(),'2037-03');
  await page.locator('#c_area').fill('');await page.locator('#scRun').click();
  assert.match(await page.locator('#scRunError').innerText(),/有效数字/);
  assert.deepEqual(await page.evaluate(()=>scResult.summary),r.summary);
  await page.locator('#c_area').fill('20000');await page.locator('#scRun').click();
  assert.deepEqual(await page.evaluate(()=>scResult.summary),r.summary);
  const saved=await page.evaluate(()=>JSON.stringify(scParams));
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>typeof calcFormHtml==='function');
  await page.evaluate(p=>{appMode='calc';calcType='gaibao';scStep=1;scParams=JSON.parse(p);renderSheet();},saved);
  assert.equal(await page.locator('#c_operateStartMonth').inputValue(),'2026-04');
  await page.locator('#scRun').click();
  await page.evaluate(()=>{window.scrollTo(0,0);document.querySelectorAll('*').forEach(e=>{if(e.scrollTop)e.scrollTop=0;});});
  await page.screenshot({path:'outputs/0909-nrcalc-browser.png',fullPage:false,animations:'disabled'});
  const downloadPromise=page.waitForEvent('download');await page.evaluate(()=>exportCalcWord());
  const download=await downloadPromise;await download.saveAs('outputs/0909-nrcalc-smoke.docx');
  await page.evaluate(async()=>{if(!window.XLSX)await loadScript('xlsx.full.min.js');});
  const workbook=await page.evaluate(()=>{const wb=buildCalcWorkbook();return {sheets:wb.SheetNames,parameters:XLSX.utils.sheet_to_json(wb.Sheets['参数'],{header:1}),income:XLSX.utils.sheet_to_json(wb.Sheets['收入'],{header:1}),bytes:Array.from(XLSX.write(wb,{type:'array',bookType:'xlsx'}))};});
  assert.ok(workbook.parameters.some(row=>row[1]==='monthDict'&&row[2].includes('"2037":3')));
  assert.equal(workbook.income[1][1].toFixed(2),r.summary.totalIncome.toFixed(2));
  // ArrayBuffer is serialized separately below.
  const bytes=await page.evaluate(()=>Array.from(new Uint8Array(XLSX.write(buildCalcWorkbook(),{type:'array',bookType:'xlsx'}))));
  fs.writeFileSync('outputs/0909-nrcalc-smoke.xlsx',Buffer.from(bytes));
  fs.writeFileSync('outputs/0909-nrcalc-browser.json',JSON.stringify({summary:r.summary,sheets:workbook.sheets,errors,checks:['normal','return','empty-input-preserves-result','repeat','JSON-restore-after-reload','Word-download','Excel-values']},null,2));
  assert.equal(errors.length,0,errors.join('\n'));console.log('Browser checks passed',r.summary);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
