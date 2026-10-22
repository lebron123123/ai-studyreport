const {chromium}=require('playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const source=fs.readFileSync('project-workspace-ui.js','utf8')+'\n'+fs.readFileSync('project-manager.js','utf8');
  await page.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>{}));
  await page.route('**/*',r=>r.request().url().endsWith('/fixture')?r.fulfill({contentType:'text/html',body:'<body><style>[hidden]{display:none!important}</style><script>'+source+'</script><script>window.ResearchUI={listRecords:async()=>({items:[{id:"study",title:"test research",role:"owner"}]})};ProjectManager.open({userId:"test"});</script>'}):r.fulfill({json:{ok:true,list:[{id:'p1',name:'test formal',permissions:{},updated_at:1}]}}));
  await page.goto('http://library.test/fixture');
  await page.waitForTimeout(300);assert.deepEqual(errors,[]);
  await page.locator('[data-pm-kind="project"]').waitFor();
  for(let i=0;i<5;i++){
   await page.locator('[data-pm-kind="research"]').click();
   await page.locator('[data-pm-research="study"]').waitFor();
   assert.equal(await page.locator('.pm-library-section:visible').count(),1);
   assert.equal(await page.locator('[data-pm-select="p1"]').isVisible(),false);
   await page.locator('#pmSearch').fill('missing');
   assert.equal(await page.locator('[data-pm-research="study"]').count(),0);
   await page.locator('#pmSearch').fill('');
   await page.locator('[data-pm-kind="project"]').click();
   await page.locator('[data-pm-select="p1"]').waitFor();
   assert.equal(await page.locator('.pm-library-section:visible').count(),1);
  }
  await page.reload();await page.locator('[data-pm-select="p1"]').waitFor();
  assert.deepEqual(errors,[]);console.log('PASS: category isolation, repeated switching, search empty/reset, refresh; 0 page errors');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
