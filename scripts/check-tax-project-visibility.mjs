// Read-only project API/browser verification. Never save or restore report content.
import pg from '../local-server/node_modules/pg/lib/index.js';
import {signToken} from '../functions/api/_auth.js';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
let browser;
try{
 const id='1bb24013-18ce-4819-9588-09fe98e5e0c0';
 const {rows:[user]}=await db.query('SELECT u.id,u.username FROM users u JOIN projects p ON p.user_id=u.id WHERE p.id=$1',[id]);
 assert.ok(user);const authorization='Bearer '+await signToken(process.env,user.id,user.username);
 let offset=0,found;const ids=new Set();
 do{const r=await fetch('http://localhost:8080/api/projects?offset='+offset,{headers:{authorization}});assert.equal(r.status,200);const d=await r.json();assert.ok(d.ok);for(const p of d.list){ids.add(p.id);if(p.id===id)found=p;}offset=d.nextOffset??null;}while(offset!==null);
 assert.ok(found,'Tax project must be listed beyond first 100');assert.equal(found.reportVersions,9);assert.equal(found.reportVersionItems.find(v=>v.current)?.version,9);
 browser=await chromium.launch({headless:true});const page=await browser.newPage({extraHTTPHeaders:{authorization},viewport:{width:1600,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/visibility-fixture',r=>r.fulfill({contentType:'text/html',body:'<body><link rel="stylesheet" href="/investment-workspace.css"><script src="/project-workspace-ui.js"></script><script src="/project-manager.js"></script><script>window.ResearchUI={listRecords:async()=>({items:[]})};ProjectManager.open({userId:'+JSON.stringify(user.id)+'});</script>'}));
 await page.goto('http://localhost:8080/visibility-fixture');
 await page.locator('[data-pm-select="'+id+'"]').waitFor({timeout:120000});
 assert.ok(await page.locator('.pm-table-scroll').first().evaluate(el=>el.getBoundingClientRect().height)>340);
 for(let i=0;i<5;i++){
  await page.locator('[data-pm-source="business"]').click();assert.ok(await page.locator('[data-pm-select="'+id+'"]').isVisible());
  await page.locator('[data-pm-source="ledger"]').click();assert.equal(await page.locator('[data-pm-select="'+id+'"]').count(),0);
  await page.locator('[data-pm-clear-filters]').click();assert.ok(await page.locator('[data-pm-select="'+id+'"]').isVisible());
 }
 await page.locator('[data-pm-filter="type"]').selectOption({label:'招拍挂'});
 assert.ok((await page.locator('.pm-library-section').first().locator('tbody tr').allTextContents()).every(t=>t.includes('招拍挂')));
 await page.locator('[data-pm-clear-filters]').click();
 await page.locator('[data-pm-filter="stage"]').selectOption({label:found.stage});
 assert.ok(await page.locator('[data-pm-select="'+id+'"]').isVisible());
 await page.locator('#pmSearch').fill('不存在的筛选测试名称');assert.equal(await page.locator('[data-pm-select]').count(),0);
 await page.locator('[data-pm-clear-filters]').click();assert.equal(await page.locator('#pmSearch').inputValue(),'');
 await page.locator('#pmSearch').fill('税务局');assert.ok(await page.locator('[data-pm-select="'+id+'"]').isVisible());
 await page.locator('[data-pm-kind="research"]').click();assert.ok(await page.locator('.pm-library-section:visible').innerText().then(t=>t.includes('税务局')));
 await page.reload();await page.locator('[data-pm-select="'+id+'"]').waitFor({timeout:120000});assert.deepEqual(errors,[]);
 console.log(JSON.stringify({listedProjects:ids.size,taxVisible:true,currentVersion:9,formalAndResearchVisible:true,sourceFilterFiveCycles:true,typeAndStageFilters:true,emptyAndClear:true,refresh:true,heightExpanded:true,pageErrors:0}));
}finally{await browser?.close();await db.end();}
