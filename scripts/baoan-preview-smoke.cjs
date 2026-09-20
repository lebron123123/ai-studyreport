const {chromium}=require('C:/Users/HP/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const root=path.resolve('project-map');const server=http.createServer((req,res)=>{
  const p=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!p.startsWith(root+path.sep)||!fs.existsSync(p)){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',({'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png'})[path.extname(p)]||'application/octet-stream');fs.createReadStream(p).pipe(res);
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,channel:'msedge'});const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[],external=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1')&&!r.url().startsWith('data:')&&!r.url().startsWith('blob:'))external.push(r.url());});
 try{
 await page.goto(process.env.BAOAN_PREVIEW_URL||`http://127.0.0.1:${server.address().port}/baoan.html`);await page.waitForFunction(()=>document.body.dataset.ready==='true',null,{timeout:90000});
 await page.waitForTimeout(5000);await page.screenshot({path:'outputs/baoan-cesium-preview.png'});
 for(let i=0;i<5;i++){await page.locator('#estimate').check();await page.locator('#estimate').uncheck();await page.locator('#reset').click();}
 await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('本次'));
 const before=await page.locator('#status').textContent();await page.route('**/baoan-data/*.geojson',r=>r.fulfill({status:503,body:'unavailable'}));
 await page.locator('#load').click();await page.locator('#retry').waitFor({state:'visible'});assert.match(await page.locator('#status').textContent(),/原画面保留/);
 await page.unroute('**/baoan-data/*.geojson');await page.locator('#reset').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('本次'));
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log(JSON.stringify({result:'PASS',status:before,repeats:5,errors,external}));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
