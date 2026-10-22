const {chromium}=require('playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
 const source=fs.readFileSync('project-workspace-ui.js','utf8')+'\n'+fs.readFileSync('project-manager.js','utf8');
 await page.route('**/*',r=>r.request().url().includes('/fixture')?r.fulfill({contentType:'text/html; charset=utf-8',body:'<body><script>'+source+'</script><script>window.calls=[];window.failSave=false;window.ResearchUI={listRecords:async()=>({items:[]})};ProjectManager.open({userId:"test",preserveDraft:async()=>!window.failSave,openAiReport:async(id)=>{window.calls.push(id);}});</script>'}):r.fulfill({json:!r.request().url().includes('/api/projects?')?{ok:false,error:'fixture unavailable'}:{ok:true,list:[{id:'project-test',name:'test report',generated:1,sections:1,permissions:{edit:true},reportVersionItems:[{id:'v9',version:9,current:true}]}]}}));
 await page.goto('http://entry.test/fixture#project/project-test/versions');
 const button=page.locator('.pm-report-versions [data-pm-ai="project-test"]');await button.waitFor();
 for(let i=0;i<5;i++)await button.click();assert.deepEqual(await page.evaluate(()=>calls),Array(5).fill('project-test'));
 await page.evaluate(()=>window.failSave=true);await button.click();assert.equal(await page.evaluate(()=>calls.length),5);assert.ok(await button.isVisible());
 assert.equal(await page.locator('[data-pm-preview-version="v9"]').count(),1);
 await page.reload();await button.waitFor();assert.deepEqual(errors,[]);
 console.log('PASS: current project ID, 5 clicks, failed save blocks navigation, v9 preview preserved, refresh; 0 page errors');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
