const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright');
test('统一候选入口：默认局部、全篇、取消、重复打开、刷新和忙碌状态',async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CI?{}:{channel:'msedge'})});
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const src=fs.readFileSync('aireport.js','utf8'),functions=src.slice(src.indexOf('function airDocLogicBarHtml(){'),src.indexOf('function airOpenKeepOriginal(){'));
  const boot="var aiReportBusy=false,aiReportImpactedProgress=null,airAcceptCandidatesBusy=false,chapters=[],calls=[];function airReportLogicImpactSummary(){return {total:0,unlocked:0};}function airGenerateImpactedCandidates(all){calls.push(all);} "+functions+"document.body.innerHTML=airDocLogicBarHtml();document.querySelector('.air-doc-update-impacted').onclick=airOpenCandidateScope;";
  await page.setContent('<body></body>');await page.addScriptTag({content:boot});
  const open=()=>page.getByRole('button',{name:'生成候选稿',exact:true}).click();
  await open();assert.equal(await page.locator('input[value=affected]').isChecked(),true);assert.equal(await page.getByRole('button',{name:'继续',exact:true}).isDisabled(),true);assert.match(await page.locator('#airCandidateScope [role=status]').textContent(),/调整本节生成逻辑/);assert.deepEqual(await page.evaluate(()=>calls),[]);
  await page.locator('input[value=all]').check();await page.getByRole('button',{name:'继续',exact:true}).click();assert.deepEqual(await page.evaluate(()=>calls),[true]);
  await page.evaluate(()=>{airReportLogicImpactSummary=()=>({total:1,unlocked:1});});await open();await page.getByRole('button',{name:'继续',exact:true}).click();assert.deepEqual(await page.evaluate(()=>calls),[true,false]);
  await open();await page.getByRole('button',{name:'取消',exact:true}).click();assert.equal(await page.locator('#airCandidateScope').count(),0);
  await page.evaluate(()=>{airOpenCandidateScope();airOpenCandidateScope();});assert.equal(await page.locator('#airCandidateScope').count(),1);await page.getByRole('button',{name:'关闭',exact:true}).click();
  await page.evaluate(()=>{aiReportBusy=true;airOpenCandidateScope();});assert.equal(await page.locator('#airCandidateScope').count(),0);
  await page.reload();await page.addScriptTag({content:boot});await open();assert.equal(await page.locator('input[value=affected]').isChecked(),true);assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
